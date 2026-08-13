import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma.service';
import { ControlPrismaService } from '../database/control-prisma.service';
import { DeepSeekService, LlmFailure, LlmFailureReason } from '../pricing/deepseek.service';
import { GuestsService } from '../guests/guests.service';
import { RequestUser, Role } from '../auth/roles';
import { computeFolioTotals } from '../common/folio-math';
import {
  canSeeBusinessMoney,
  canSeeGuestMoney,
  canUseTool,
  toolsForRole,
} from './atlas.tools';
import { personaFor } from './atlas.personas';


/**
 * Atlas — the staff-facing AI copilot. Everything it says comes from the live
 * model reasoning over real tool output; there is no scripted intent engine
 * pretending to be intelligent behind it. When the model is unreachable Atlas
 * says so plainly instead of impersonating itself with canned answers.
 *
 * What Atlas may read or do is decided by the caller's role — see atlas.tools.ts.
 */

const DAY_MS = 86_400_000;
const BLOCKING = ['pending', 'confirmed', 'checked_in', 'checked_out'];

export type AtlasMessage = { role: 'user' | 'assistant'; content: string };
export type AtlasLang = 'ru' | 'en' | 'uz';

export interface AtlasAskOptions {
  hotelName?: string;
  lang?: AtlasLang;
  /** Screen the user is looking at, so Atlas can read the room. */
  screen?: string;
}

export interface AtlasResult {
  reply: string;
  card?: AtlasCard;
  /** False when the model was unreachable — the panel shows a degraded state. */
  usedAi: boolean;
}

export type AtlasCard =
  | { kind: 'booking'; guest: string; room: string; checkIn: string; checkOut: string; nights: number; total: number; code: string }
  | { kind: 'guest'; name: string; phone: string; stay?: string; balance?: number; vip?: boolean }
  | { kind: 'availability'; checkIn: string; checkOut: string; rooms: { number: string; type: string; total: number }[] }
  | { kind: 'snapshot'; occupancy: number; arrivals: number; departures: number; inHouse: number; free: number; dueBalance?: number }
  | { kind: 'checklist'; title: string; items: { id: string; title: string }[]; due?: string };

const LANG_NAME: Record<AtlasLang, string> = { ru: 'Russian', en: 'English', uz: 'Uzbek' };

/**
 * Does a reply assert figures about the property? Two or more numbers, or a
 * percentage / money amount, means it is reporting state rather than chatting —
 * and state must come from a tool. Deliberately loose: a false positive only
 * costs one extra grounded call, a false negative ships an invented number.
 */
const QUANTITATIVE = /\d+\s*%|\d[\d\s,.]*\s*(UZS|USD|сум|so'm)|(\d+\D+){2}\d+/i;

/**
 * One message per failure cause. "Couldn't reach the AI" is useless when the
 * real problem is an unedited placeholder key in .env — each cause names the
 * thing to actually go and fix.
 */
const UNAVAILABLE: Record<LlmFailureReason, Record<AtlasLang, string>> = {
  no_key: {
    ru: 'ИИ не настроен: в packages/backend/.env нет ключа DEEPSEEK_API_KEY. Добавьте его и перезапустите сервер.',
    en: 'AI is not configured: DEEPSEEK_API_KEY is missing from packages/backend/.env. Add it and restart the server.',
    uz: 'AI sozlanmagan: packages/backend/.env faylida DEEPSEEK_API_KEY yoʻq. Uni qoʻshib, serverni qayta ishga tushiring.',
  },
  auth: {
    ru: 'Ключ ИИ отклонён провайдером. Проверьте DEEPSEEK_API_KEY в packages/backend/.env — часто там остаётся заглушка из .env.example. После изменения перезапустите сервер.',
    en: 'The AI provider rejected the API key. Check DEEPSEEK_API_KEY in packages/backend/.env — it is often still the placeholder from .env.example. Restart the server after changing it.',
    uz: 'AI provayderi kalitni rad etdi. packages/backend/.env dagi DEEPSEEK_API_KEY ni tekshiring — koʻpincha u .env.example dagi namuna boʻlib qoladi. Oʻzgartirgach serverni qayta ishga tushiring.',
  },
  rate_limit: {
    ru: 'Провайдер ИИ временно ограничил запросы. Подождите немного и повторите.',
    en: 'The AI provider is rate-limiting requests. Wait a moment and try again.',
    uz: 'AI provayderi soʻrovlarni vaqtincha cheklamoqda. Biroz kutib, qayta urinib koʻring.',
  },
  network: {
    ru: 'Не удалось достучаться до провайдера ИИ: соединение заблокировано. Проверьте интернет, прокси, файрвол или региональные ограничения — ключ здесь ни при чём.',
    en: 'Could not reach the AI provider: the connection was blocked. Check the internet connection, proxy, firewall or regional restrictions — this is not a problem with the key.',
    uz: 'AI provayderiga ulanib boʻlmadi: ulanish bloklandi. Internet, proksi, firewall yoki mintaqaviy cheklovlarni tekshiring — kalit bilan bogʻliq emas.',
  },
  upstream: {
    ru: 'Провайдер ИИ вернул ошибку. Подробности — в логе сервера.',
    en: 'The AI provider returned an error. See the server log for details.',
    uz: 'AI provayderi xatolik qaytardi. Tafsilotlar server logida.',
  },
};

const unavailableText = (f: LlmFailure | null, lang: AtlasLang) =>
  UNAVAILABLE[f?.reason ?? 'network'][lang];

@Injectable()
export class AtlasService {
  private readonly logger = new Logger(AtlasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly control: ControlPrismaService,
    private readonly ai: DeepSeekService,
    private readonly guests: GuestsService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * @param onDelta when supplied, the final natural-language turn is streamed
   *   token by token; the callback receives the running text so far.
   */
  async ask(
    hotelId: string,
    user: RequestUser,
    messages: AtlasMessage[],
    opts: AtlasAskOptions = {},
    onDelta?: (text: string) => void,
  ): Promise<AtlasResult> {
    const lang: AtlasLang = opts.lang && LANG_NAME[opts.lang] ? opts.lang : 'ru';
    const clean = messages.filter((m) => m.content?.trim()).slice(-12);
    if (!this.ai.hasKey()) return { reply: UNAVAILABLE.no_key[lang], usedAi: false };
    try {
      const agent = await this.runAgent(hotelId, user, clean, lang, opts, onDelta);
      if (agent && agent.reply.trim()) return agent;
    } catch (e) {
      this.logger.warn(`Atlas agent failed: ${(e as Error).message}`);
    }
    return { reply: unavailableText(this.ai.lastError(), lang), usedAi: false };
  }

  /* ─── Agentic loop (OpenAI-compatible function calling) ─────────────────── */
  private async runAgent(
    hotelId: string,
    user: RequestUser,
    history: AtlasMessage[],
    lang: AtlasLang,
    opts: AtlasAskOptions,
    onDelta?: (text: string) => void,
  ): Promise<AtlasResult | null> {
    const messages: any[] = [
      { role: 'system', content: this.systemPrompt(user, lang, opts) },
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ];
    const tools = toolsForRole(user.role);
    let lastCard: AtlasCard | undefined;
    let toolsUsed = 0;
    let forcedOnce = false;
    // Streaming and blocking share this loop; only the transport differs.
    const turn = (tc: 'auto' | 'required' = 'auto') =>
      onDelta
        ? this.ai.chatWithToolsStream(messages, tools, onDelta, tc)
        : this.ai.chatWithTools(messages, tools, tc);

    for (let step = 0; step < 6; step++) {
      const resp = await turn();
      if (!resp) return null;
      if (!resp.toolCalls.length) {
        const reply = (resp.content ?? '').trim();
        // Backstop for the prompt: a first answer full of figures that was
        // produced without reading a single tool is invented. Force one real
        // tool call and let it answer again from actual data.
        if (!toolsUsed && !forcedOnce && QUANTITATIVE.test(reply)) {
          forcedOnce = true;
          this.logger.warn('Atlas answered with figures before calling any tool — forcing a grounded retry');
          const forced = await turn('required');
          if (forced?.toolCalls.length) { resp.toolCalls = forced.toolCalls; resp.content = forced.content; }
          else return { reply, card: lastCard, usedAi: true };
        } else {
          return { reply, card: lastCard, usedAi: true };
        }
      }
      toolsUsed += resp.toolCalls.length;
      messages.push({
        role: 'assistant',
        content: resp.content ?? '',
        tool_calls: resp.toolCalls.map((c) => ({
          id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments },
        })),
      });
      for (const call of resp.toolCalls) {
        let args: any = {};
        try { args = JSON.parse(call.arguments || '{}'); } catch { args = {}; }
        const out = await this.dispatch(hotelId, user, call.name, args)
          .catch((e) => ({ ok: false, error: (e as Error).message }));
        if (out && (out as any).card) lastCard = (out as any).card;
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(stripCard(out)) });
      }
    }
    return null;
  }

  private systemPrompt(user: RequestUser, lang: AtlasLang, opts: AtlasAskOptions): string {
    const today = new Date().toISOString().slice(0, 10);
    const firstName = user.name?.trim().split(/\s+/)[0] || 'there';
    const hotelName = opts.hotelName?.trim() || 'the hotel';
    const persona = personaFor(user.role);
    return [
      `You are Atlas — the AI chief-of-staff for ${hotelName}, a hotel in Uzbekistan. You work alongside ${user.name}, whose role is "${user.role}". Today is ${today}.`,
      ``,
      // The persona shapes how Atlas talks to this role — its identity, focus
      // and tone. It never grants access; the tool catalogue below is the only
      // boundary. A persona only changes how Atlas speaks about what the role
      // is already allowed to see.
      `YOUR ROLE HERE: ${persona.identity}`,
      `WHAT MATTERS MOST TO THEM: ${persona.focus}`,
      `HOW TO SOUND: ${persona.tone}`,

      // Naming the screen used to make the model claim it was "looking at the
      // dashboard" and then invent the figures on it. Say plainly that it is a
      // label only and that Atlas cannot see anything.
      opts.screen
        ? `The page they have open is titled "${opts.screen}". That is the only thing you know about it — you CANNOT see the screen, its numbers, or anything on it.`
        : '',
      ``,
      `GROUNDING — THE MOST IMPORTANT RULE:`,
      `You have no memory or knowledge of this hotel. You cannot see any screen, dashboard or report. The ONLY way you can know a fact about this property — occupancy, room counts, arrivals, departures, guests, prices, balances, tasks, anything — is by calling a tool in this very conversation and reading what it returns.`,
      `If you have not called a tool, you do not know the answer. Never estimate, never illustrate with example figures, never repeat a number from earlier in the chat as if it were fresh. Inventing a plausible-looking number is the worst thing you can do here: staff act on what you say, and a made-up occupancy or balance causes real damage.`,
      `So: any question touching the state of the hotel → call the tool first, answer second. If no tool can answer it, say you don't have that data rather than filling the gap.`,
      ``,
      // Restating the catalogue in plain language markedly improves tool
      // selection over relying on the schema alone — the model is likelier to
      // realise a lookup exists instead of answering from imagination. Generated
      // from the same source as the schema, so the two cannot drift apart.
      `WHAT YOU CAN LOOK UP OR DO (everything available to a "${user.role}", nothing more):`,
      ...toolsForRole(user.role).map((t) => `- ${t.function.name}: ${t.function.description}`),
      `If a question maps to one of these, call it. If it maps to none of them, that data is outside this role's access or the system doesn't hold it — say so.`,
      ``,
      `LANGUAGE: Always reply in the exact SAME language that ${firstName} speaks or writes in (e.g. Russian, Uzbek, English, or any other language they use). Match their language. If their message language is ambiguous or neutral, default to ${LANG_NAME[lang]} (the app interface language). Never force the response to be in the app interface language if ${firstName} is writing in another language.`,
      ``,
      `WHO YOU ARE: Think of the sharpest, calmest manager you've ever worked with — someone who has run a thousand shifts, remembers every guest, and always knows the one thing that actually matters right now. You're a real teammate, not a chatbot. You have judgement, warmth and initiative. You talk like a trusted colleague leaning over the desk.`,
      ``,
      `HOW YOU TALK:`,
      `- Sound human. Natural, warm, direct. Vary your phrasing — never canned. Dry humour is fine when the moment allows.`,
      `- Lead with the answer, then the useful detail. No preamble ("Sure! I can help with that!"), no filler, no restating the question.`,
      `- Never list your capabilities, never say "as an AI", never apologise robotically. If you can't do something, say so like a person would and offer the next best move.`,
      ``,
      `HOW YOU THINK:`,
      `- Anticipate. If someone asks who's arriving today, also flag what needs attention — an unpaid balance, a VIP, a missing document — without being asked.`,
      `- When a request is ambiguous, make the sensible assumption and act, or ask ONE crisp question — never a wall of clarifications.`,
      `- Ground everything in your tools. Never invent a number, name, price, room or availability. If a tool errors, explain it plainly and suggest a fix.`,
      `- Prefer doing over describing. If they ask for a booking, make it. If they ask for a list of things to do, a handover or a checklist, call create_checklist so it becomes real, trackable work rather than text in a chat.`,
      `- Money is UZS unless clearly marked USD. Be exact with numbers.`,
      ``,
      `WHAT YOU CAN SEE: your tools are scoped to ${firstName}'s role and that scope is not negotiable. If they ask for something outside it — another department's data, guest finances they don't handle — say plainly that it isn't part of their access and point them to whoever owns it. Never guess or reconstruct restricted information from memory, and never speculate about what the number "might" be.`,
      ``,
      `Make ${firstName}'s shift easier. Be genuinely useful, genuinely pleasant, never wasteful of a word.`,
    ].filter(Boolean).join('\n');
  }

  /* ─── Dispatch (re-checks permission — never trust the model) ────────────── */
  private async dispatch(hotelId: string, user: RequestUser, name: string, args: any): Promise<any> {
    if (!canUseTool(user.role, name)) {
      return { ok: false, error: `Not permitted for role ${user.role}. Do not retry; tell the user this is outside their access.` };
    }
    const role = user.role;
    switch (name) {
      case 'get_snapshot': return this.toolSnapshot(hotelId, role);
      case 'list_arrivals': return this.toolArrivals(hotelId);
      case 'list_departures': return this.toolDepartures(hotelId, role);
      case 'find_guest': return this.toolFindGuest(hotelId, args.query, role);
      case 'check_availability': return this.toolAvailability(hotelId, args.check_in, args.check_out, args.guests);
      case 'housekeeping_board': return this.toolHousekeepingBoard(hotelId);
      case 'list_work_orders': return this.toolListWorkOrders(hotelId, args.status);
      case 'list_messages': return this.toolListMessages(hotelId, args.status, args.limit);
      case 'list_tasks': return this.toolListTasks(hotelId, args.status);
      case 'revenue_summary': return this.toolRevenueSummary(hotelId);
      case 'get_revenue_forecast': return this.toolRevenueForecast(hotelId);
      case 'get_occupancy_forecast': return this.toolOccupancyForecast(hotelId);
      case 'get_guest_folio': return this.toolGuestFolio(hotelId, args.query, role);
      case 'get_room_status': return this.toolRoomStatus(hotelId, args.room_number);
      case 'list_housekeeping_staff': return this.toolHousekeepingStaff(hotelId);
      case 'get_work_order_detail': return this.toolWorkOrderDetail(hotelId, args.query);
      case 'list_today_events': return this.toolTodayEvents(hotelId);
      case 'list_leads': return this.toolListLeads(hotelId);
      case 'list_deals': return this.toolListDeals(hotelId, args.stage);
      case 'get_deal_detail': return this.toolDealDetail(hotelId, args.query);
      case 'list_proposals': return this.toolListProposals(hotelId, args.sign_status);
      case 'list_group_blocks': return this.toolListGroupBlocks(hotelId);
      case 'list_mice_events': return this.toolListMiceEvents(hotelId);
      case 'list_campaigns': return this.toolListCampaigns(hotelId);
      case 'list_spa_bookings': return this.toolListSpaBookings(hotelId, args.date);
      case 'list_spa_treatments': return this.toolListSpaTreatments(hotelId);
      case 'list_outlet_orders': return this.toolListOutletOrders(hotelId, args.status);
      case 'list_wristbands': return this.toolListWristbands(hotelId);
      case 'list_reviews': return this.toolListReviews(hotelId, args.status);
      case 'list_risks': return this.toolListRisks(hotelId, args.severity);
      case 'create_reservation': return this.toolCreateReservation(hotelId, args);


      case 'assign_housekeeping': return this.toolAssignHousekeeping(hotelId, args);
      case 'create_work_order': return this.toolCreateWorkOrder(hotelId, user, args);
      case 'resolve_work_order': return this.toolResolveWorkOrder(hotelId, args);
      case 'create_checklist': return this.toolCreateChecklist(hotelId, user, args);
      case 'complete_task': return this.toolCompleteTask(hotelId, args.query);
      case 'notify_staff': return this.toolNotify(hotelId, args);
      default: return { ok: false, error: `Unknown tool ${name}` };
    }
  }

  /* ─── Tools ─────────────────────────────────────────────────────────────── */

  private dayWindow() {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return { start, end: new Date(start.getTime() + DAY_MS) };
  }

  private async toolSnapshot(hotelId: string, role: Role) {
    const { start, end } = this.dayWindow();
    const [rooms, res] = await Promise.all([
      this.prisma.room.findMany({ where: { hotelId } }),
      this.prisma.reservation.findMany({
        where: { hotelId, status: { in: ['confirmed', 'checked_in'] } },
        include: { payments: { where: { status: 'completed' } }, charges: true },
      }),
    ]);
    const inHouse = res.filter((r) => r.status === 'checked_in');
    const arrivals = res.filter((r) => r.status === 'confirmed' && r.checkIn >= start && r.checkIn < end);
    const departures = inHouse.filter((r) => r.checkOut >= start && r.checkOut < end);
    const free = rooms.filter((r) => r.status === 'available').length;
    const occupancy = rooms.length ? Math.round((inHouse.length / rooms.length) * 100) : 0;
    const card: AtlasCard = {
      kind: 'snapshot', occupancy, arrivals: arrivals.length,
      departures: departures.length, inHouse: inHouse.length, free,
    };
    // Outstanding money is a finance/desk concern — housekeeping and technical
    // staff get the operational picture without it.
    if (canSeeBusinessMoney(role) || canSeeGuestMoney(role)) {
      const due = inHouse.reduce(
        (s, r) => s + Math.max(0, computeFolioTotals(r.totalPrice, r.charges, r.payments).balance), 0);
      card.dueBalance = Math.round(due);
    }
    return { ok: true, ...card, totalRooms: rooms.length, card };
  }

  private async toolArrivals(hotelId: string) {
    const { start, end } = this.dayWindow();
    const rows = await this.prisma.reservation.findMany({
      where: { hotelId, status: 'confirmed', checkIn: { gte: start, lt: end } },
      include: { guest: true, room: true }, orderBy: { checkIn: 'asc' },
    });
    return { ok: true, count: rows.length, arrivals: rows.map((r) => ({ guest: r.guest.fullName, room: r.room.number, type: r.room.type })) };
  }

  private async toolDepartures(hotelId: string, role: Role) {
    const { start, end } = this.dayWindow();
    const rows = await this.prisma.reservation.findMany({
      where: { hotelId, status: 'checked_in', checkOut: { gte: start, lt: end } },
      include: { guest: true, room: true, payments: { where: { status: 'completed' } }, charges: true },
      orderBy: { checkOut: 'asc' },
    });
    const money = canSeeGuestMoney(role);
    return {
      ok: true, count: rows.length,
      departures: rows.map((r) => ({
        guest: r.guest.fullName, room: r.room.number,
        ...(money ? { balance: Math.round(computeFolioTotals(r.totalPrice, r.charges, r.payments).balance) } : {}),
      })),
    };
  }

  private async toolFindGuest(hotelId: string, query: string | undefined, role: Role) {
    if (!query?.trim()) return { ok: false, error: 'query is required' };
    const matches = await this.guests.findAll(query.trim(), hotelId);
    if (!matches.length) return { ok: true, count: 0, guests: [] };
    const money = canSeeGuestMoney(role);
    const enriched = await Promise.all(matches.slice(0, 5).map(async (g) => {
      const stay = await this.prisma.reservation.findFirst({
        where: { hotelId, guestId: g.id, status: { in: ['confirmed', 'checked_in'] } },
        include: { room: true, payments: { where: { status: 'completed' } }, charges: true },
        orderBy: { checkIn: 'asc' },
      });
      const vip = (() => { try { return (JSON.parse(g.tags ?? '[]') as string[]).includes('vip'); } catch { return false; } })();
      return {
        id: g.id, name: g.fullName, phone: g.phone, vip,
        stay: stay ? `№${stay.room.number} · ${stay.status === 'checked_in' ? 'in house' : 'arrives ' + stay.checkIn.toISOString().slice(0, 10)}` : null,
        balance: money && stay ? Math.round(computeFolioTotals(stay.totalPrice, stay.charges, stay.payments).balance) : null,
      };
    }));
    const first = enriched[0];
    const card: AtlasCard = {
      kind: 'guest', name: first.name, phone: first.phone,
      stay: first.stay ?? undefined, balance: first.balance ?? undefined, vip: first.vip,
    };
    return { ok: true, count: enriched.length, guests: enriched, card };
  }

  private async availableRooms(hotelId: string, checkIn: string, checkOut: string, guests = 1) {
    const start = new Date(checkIn); const end = new Date(checkOut);
    if (!(end > start)) return { ok: false as const, error: 'checkOut must be after checkIn' };
    const nights = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
    const [rooms, overlaps] = await Promise.all([
      this.prisma.room.findMany({ where: { hotelId, status: { not: 'maintenance' } }, orderBy: [{ type: 'asc' }, { number: 'asc' }] }),
      this.prisma.reservation.findMany({ where: { hotelId, status: { in: BLOCKING }, checkIn: { lt: end }, checkOut: { gt: start } }, select: { roomId: true } }),
    ]);
    const busy = new Set(overlaps.map((o) => o.roomId));
    const free = rooms.filter((r) => !busy.has(r.id) && r.capacity >= guests)
      .map((r) => ({ id: r.id, number: r.number, type: r.type, capacity: r.capacity, perNight: r.pricePerNight, total: Math.round(r.pricePerNight * nights) }))
      .sort((a, b) => a.total - b.total);
    return { ok: true as const, nights, rooms: free };
  }

  private async toolAvailability(hotelId: string, checkIn: string, checkOut: string, guests?: number) {
    const a = await this.availableRooms(hotelId, checkIn, checkOut, guests ?? 1);
    if (!a.ok) return a;
    const card: AtlasCard = { kind: 'availability', checkIn, checkOut, rooms: a.rooms.slice(0, 6).map((r) => ({ number: r.number, type: r.type, total: r.total })) };
    return { ok: true, checkIn, checkOut, nights: a.nights, count: a.rooms.length, rooms: a.rooms.slice(0, 10), card };
  }

  private async toolHousekeepingBoard(hotelId: string) {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const [rooms, tasks] = await Promise.all([
      this.prisma.room.findMany({ where: { hotelId }, orderBy: [{ floor: 'asc' }, { number: 'asc' }] }),
      this.prisma.housekeepingTask.findMany({
        where: { hotelId, OR: [{ createdAt: { gte: startOfDay } }, { completedAt: null }] },
      }),
    ]);
    const ids = [...new Set(tasks.map((t) => t.assignedToId).filter(Boolean) as string[])];
    const staff = ids.length
      ? await this.control.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }).catch(() => [])
      : [];
    const nameOf = new Map(staff.map((u) => [u.id, u.name] as const));
    const status = (r: (typeof rooms)[number]) =>
      r.status === 'maintenance' ? 'out_of_order'
        : r.status === 'cleaning' ? 'in_progress'
          : r.status === 'occupied' ? 'occupied'
            : r.housekeepingStatus === 'inspected' ? 'inspected'
              : r.housekeepingStatus === 'dirty' ? 'dirty' : 'clean';
    const list = rooms.map((r) => {
      const task = tasks.filter((t) => t.roomId === r.id && t.note !== 'daily')
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      return {
        room: r.number, floor: r.floor, type: r.type, status: status(r),
        assigned_to: task?.assignedToId ? nameOf.get(task.assignedToId) ?? null : null,
      };
    });
    const dirty = list.filter((r) => r.status === 'dirty' || r.status === 'in_progress');
    return {
      ok: true, total: list.length,
      dirty_count: dirty.length,
      unassigned: dirty.filter((r) => !r.assigned_to).map((r) => r.room),
      rooms: list,
    };
  }

  private async toolListWorkOrders(hotelId: string, status?: string) {
    const where: any = { hotelId };
    if (status) where.status = status;
    const rows = await this.prisma.workOrder.findMany({
      where, include: { room: true }, orderBy: { createdAt: 'desc' }, take: 40,
    });
    return {
      ok: true, count: rows.length,
      work_orders: rows.map((w) => ({
        title: w.title, room: w.room?.number ?? null, priority: w.priority,
        status: w.status, opened: w.createdAt.toISOString().slice(0, 10),
      })),
    };
  }

  private async toolListMessages(hotelId: string, status?: string, limit?: number) {
    const take = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const threads = await this.prisma.inboxThread.findMany({
      where: { hotelId, ...(status === 'closed' ? { status: 'closed' } : { status: 'open' }) },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { lastMessageAt: 'desc' },
      take,
    });
    const now = Date.now();
    return {
      ok: true,
      count: threads.length,
      // Ranking is the model's job, so hand it the raw signals rather than a
      // pre-baked priority: who wrote last, how long we have kept them waiting,
      // and whether the SLA has already been missed.
      threads: threads.map((t) => {
        const last = t.messages[0];
        const waitingMin = Math.round((now - t.lastMessageAt.getTime()) / 60000);
        return {
          from: t.contactName ?? 'Unknown',
          channel: t.channel,
          last_message: last?.text?.slice(0, 300) ?? null,
          last_from: last?.direction === 'in' ? 'guest' : 'hotel',
          awaiting_our_reply: last?.direction === 'in',
          waiting_minutes: waitingMin,
          sla_breached: !!t.slaBreachedAt,
          last_message_at: t.lastMessageAt.toISOString(),
        };
      }),
    };
  }

  private async toolListTasks(hotelId: string, status?: string) {
    const rows = await this.prisma.task.findMany({
      where: { hotelId, status: status === 'done' ? 'done' : 'open' },
      orderBy: { createdAt: 'desc' }, take: 50,
    });
    return {
      ok: true, count: rows.length,
      tasks: rows.map((t) => ({
        title: t.title, note: t.note, priority: t.priority, category: t.category,
        due: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
      })),
    };
  }

  private async toolRevenueSummary(hotelId: string) {
    const { start, end } = this.dayWindow();
    const weekAgo = new Date(start.getTime() - 7 * DAY_MS);
    const [today, week, rooms, inHouse] = await Promise.all([
      this.prisma.payment.findMany({ where: { hotelId, status: 'completed', createdAt: { gte: start, lt: end } } }),
      this.prisma.payment.findMany({ where: { hotelId, status: 'completed', createdAt: { gte: weekAgo, lt: end } } }),
      this.prisma.room.count({ where: { hotelId } }),
      this.prisma.reservation.findMany({
        where: { hotelId, status: 'checked_in' },
        include: { payments: { where: { status: 'completed' } }, charges: true },
      }),
    ]);
    const sum = (rows: { amount: number }[]) => Math.round(rows.reduce((s, p) => s + p.amount, 0));
    const nights = inHouse.length;
    const due = inHouse.reduce((s, r) => s + Math.max(0, computeFolioTotals(r.totalPrice, r.charges, r.payments).balance), 0);
    return {
      ok: true, currency: 'UZS',
      revenue_today: sum(today), revenue_last_7_days: sum(week),
      occupancy_pct: rooms ? Math.round((nights / rooms) * 100) : 0,
      adr: nights ? Math.round(inHouse.reduce((s, r) => s + r.totalPrice, 0) / nights) : 0,
      outstanding_balance: Math.round(due),
    };
  }

  private async toolRevenueForecast(hotelId: string) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const horizon = 7;
    const days = Array.from({ length: horizon }, (_, i) => {
      const d = new Date(today.getTime() + i * DAY_MS);
      return { start: d, end: new Date(d.getTime() + DAY_MS) };
    });
    const [rooms, res] = await Promise.all([
      this.prisma.room.count({ where: { hotelId } }),
      this.prisma.reservation.findMany({
        where: { hotelId, status: { in: BLOCKING }, checkIn: { lt: days[horizon - 1].end }, checkOut: { gt: today } },
      }),
    ]);
    const forecast = days.map(({ start, end }) => {
      const night = res.filter((r) => r.checkIn < end && r.checkOut > start);
      const occupied = night.length;
      const revenue = night.reduce((s, r) => s + r.totalPrice, 0);
      return {
        date: start.toISOString().slice(0, 10),
        occupied,
        occupancy_pct: rooms ? Math.round((occupied / rooms) * 100) : 0,
        expected_revenue: Math.round(revenue),
      };
    });
    return { ok: true, currency: 'UZS', forecast };
  }

  private async toolOccupancyForecast(hotelId: string) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const horizon = 7;
    const days = Array.from({ length: horizon }, (_, i) => {
      const d = new Date(today.getTime() + i * DAY_MS);
      return { start: d, end: new Date(d.getTime() + DAY_MS) };
    });
    const [rooms, res] = await Promise.all([
      this.prisma.room.count({ where: { hotelId } }),
      this.prisma.reservation.findMany({
        where: { hotelId, status: { in: BLOCKING }, checkIn: { lt: days[horizon - 1].end }, checkOut: { gt: today } },
      }),
    ]);
    const forecast = days.map(({ start, end }) => {
      const occupied = res.filter((r) => r.checkIn < end && r.checkOut > start).length;
      return {
        date: start.toISOString().slice(0, 10),
        occupied,
        occupancy_pct: rooms ? Math.round((occupied / rooms) * 100) : 0,
      };
    });
    return { ok: true, forecast };
  }

  private async toolGuestFolio(hotelId: string, query: string | undefined, role: Role) {
    if (!query?.trim()) return { ok: false, error: 'query is required' };
    const matches = await this.guests.findAll(query.trim(), hotelId);
    if (!matches.length) return { ok: true, count: 0, guests: [] };
    const g = matches[0];
    const stay = await this.prisma.reservation.findFirst({
      where: { hotelId, guestId: g.id, status: { in: ['confirmed', 'checked_in'] } },
      include: { room: true, payments: { where: { status: 'completed' } }, charges: true },
      orderBy: { checkIn: 'asc' },
    });
    if (!stay) return { ok: true, guest: g.fullName, folio: null, note: 'no active stay' };
    const totals = computeFolioTotals(stay.totalPrice, stay.charges, stay.payments);
    return {
      ok: true, guest: g.fullName, room: stay.room.number,
      total_charges: Math.round(totals.grandTotal),
      paid: Math.round(totals.totalPaid),
      balance: Math.round(totals.balance),
      currency: 'UZS',
    };

  }

  private async toolRoomStatus(hotelId: string, roomNumber?: string) {
    const number = String(roomNumber ?? '').trim();
    if (!number) return { ok: false, error: 'room_number is required' };
    const room = await this.prisma.room.findFirst({ where: { hotelId, number } });
    if (!room) return { ok: false, error: `room ${number} not found` };
    const [task, wo] = await Promise.all([
      this.prisma.housekeepingTask.findFirst({
        where: { hotelId, roomId: room.id, completedAt: null, OR: [{ note: null }, { note: { not: 'daily' } }] },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.workOrder.findFirst({ where: { hotelId, roomId: room.id, status: { not: 'resolved' } }, orderBy: { createdAt: 'desc' } }),
    ]);
    let assigned: string | null = null;
    if (task?.assignedToId) {
      const u = await this.control.user.findUnique({ where: { id: task.assignedToId }, select: { name: true } }).catch(() => null);
      assigned = u?.name ?? null;
    }
    return {
      ok: true, room: number, type: room.type, floor: room.floor,
      status: room.status, housekeeping: room.housekeepingStatus,
      assigned_to: assigned,
      open_work_order: wo ? { title: wo.title, priority: wo.priority, status: wo.status } : null,
    };
  }

  private async toolHousekeepingStaff(hotelId: string) {
    const staff = await this.control.user.findMany({
      where: { role: 'housekeeping', active: true }, select: { id: true, name: true },
    }).catch(() => []);
    return { ok: true, count: staff.length, staff: staff.map((s) => s.name) };
  }

  private async toolWorkOrderDetail(hotelId: string, query?: string) {
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return { ok: false, error: 'query is required' };
    const rows = await this.prisma.workOrder.findMany({
      where: { hotelId }, include: { room: true }, orderBy: { createdAt: 'desc' }, take: 60,
    });
    const hit = rows.find((w) => w.title.toLowerCase().includes(q) || w.room?.number === query);
    if (!hit) return { ok: false, error: `no ticket matching "${query}"` };
    return {
      ok: true, title: hit.title, room: hit.room?.number ?? null,
      description: hit.description, priority: hit.priority, status: hit.status,
      opened: hit.createdAt.toISOString().slice(0, 10),
      resolved: hit.resolvedAt ? hit.resolvedAt.toISOString().slice(0, 10) : null,
    };
  }

  private async toolTodayEvents(hotelId: string) {
    const { start, end } = this.dayWindow();
    const [groups, events] = await Promise.all([
      this.prisma.groupBlock.findMany({
        where: {
          hotelId,
          OR: [
            { arrivalDate: { gte: start, lt: end } },
            { arrivalDate: { lt: end }, departureDate: { gt: start } },
          ],
        },
      }),
      this.prisma.miceEvent.findMany({ where: { hotelId } }).catch(() => []),
    ]);
    return {
      ok: true,
      groups: groups.map((g) => ({
        name: g.name,
        arrival: g.arrivalDate ? g.arrivalDate.toISOString().slice(0, 10) : null,
        departure: g.departureDate ? g.departureDate.toISOString().slice(0, 10) : null,
        status: g.status,
      })),
      events: events.map((e) => ({ name: e.name, status: e.status })),
    };
  }

  private async toolListLeads(hotelId: string) {
    const leads = await this.prisma.lead.findMany({
      where: { hotelId, stage: { not: 'converted' } }, orderBy: { createdAt: 'desc' }, take: 40,
    }).catch(() => []);
    return {
      ok: true, count: leads.length,
      leads: leads.map((l) => ({ name: l.fullName, phone: l.phone, stage: l.stage, source: l.source })),
    };
  }

  private async toolListDeals(hotelId: string, stage?: string) {
    const where: any = { hotelId, status: 'open' };
    if (stage) where.stage = stage;
    const deals = await this.prisma.deal.findMany({
      where, orderBy: { lastMovedAt: 'desc' }, take: 40,
    }).catch(() => []);
    return {
      ok: true, count: deals.length,
      deals: deals.map((d) => ({
        title: d.title, stage: d.stage, value: Math.round(d.value),
        currency: d.currency, next_step: d.nextStep ?? null,
        expected_close: d.expectedCloseDate ? d.expectedCloseDate.toISOString().slice(0, 10) : null,
        requires_gm_approval: d.requiresGmApproval,
      })),
    };
  }

  private async toolDealDetail(hotelId: string, query?: string) {
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return { ok: false, error: 'query is required' };
    const deals = await this.prisma.deal.findMany({
      where: { hotelId }, include: { blockRows: true, payments: true },
      orderBy: { lastMovedAt: 'desc' }, take: 60,
    }).catch(() => []);
    const hit = deals.find((d) => d.title.toLowerCase().includes(q));
    if (!hit) return { ok: false, error: `no deal matching "${query}"` };
    return {
      ok: true, title: hit.title, stage: hit.stage, status: hit.status,
      value: Math.round(hit.value), currency: hit.currency,
      deposit: Math.round(hit.depositAmount), deposit_paid: hit.depositPaid,
      contract_signed: hit.contractSigned, next_step: hit.nextStep ?? null,
      expected_close: hit.expectedCloseDate ? hit.expectedCloseDate.toISOString().slice(0, 10) : null,
      rooms_count: hit.roomsCount,
      block: hit.blockRows.map((b) => ({ category: b.category, nights: b.nights, qty: b.qty, rate: b.rate })),
      payments: hit.payments.map((p) => ({ label: p.label, amount: Math.round(p.amount), status: p.status, due: p.dueAt ? p.dueAt.toISOString().slice(0, 10) : null })),
    };
  }

  private async toolListProposals(hotelId: string, signStatus?: string) {
    const where: any = { hotelId };
    if (signStatus) where.signStatus = signStatus;
    const rows = await this.prisma.proposal.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 40,
    }).catch(() => []);
    return {
      ok: true, count: rows.length,
      proposals: rows.map((p) => ({
        title: p.title, total_cost: Math.round(p.totalCost),
        sign_status: p.signStatus, sent_at: p.sentAt ? p.sentAt.toISOString().slice(0, 10) : null,
      })),
    };
  }

  private async toolListGroupBlocks(hotelId: string) {
    const rows = await this.prisma.groupBlock.findMany({
      where: { hotelId }, orderBy: { arrivalDate: 'asc' }, take: 40,
    }).catch(() => []);
    return {
      ok: true, count: rows.length,
      groups: rows.map((g) => ({
        name: g.name, status: g.status,
        arrival: g.arrivalDate ? g.arrivalDate.toISOString().slice(0, 10) : null,
        departure: g.departureDate ? g.departureDate.toISOString().slice(0, 10) : null,
      })),
    };
  }

  private async toolListMiceEvents(hotelId: string) {
    const rows = await this.prisma.miceEvent.findMany({
      where: { hotelId }, orderBy: { createdAt: 'desc' }, take: 40,
    }).catch(() => []);
    return {
      ok: true, count: rows.length,
      events: rows.map((e) => ({
        name: e.name, status: e.status, total_cost: Math.round(e.totalCost),
        deposit: Math.round(e.deposit),
      })),
    };
  }

  private async toolListCampaigns(hotelId: string) {
    const rows = await this.prisma.campaign.findMany({
      where: { hotelId }, orderBy: { createdAt: 'desc' }, take: 40,
    }).catch(() => []);
    return {
      ok: true, count: rows.length,
      campaigns: rows.map((c) => ({
        name: c.name, segment: c.segment, channel: c.channel, sent_count: c.sentCount,
      })),
    };
  }

  private async toolListSpaBookings(hotelId: string, date?: string) {
    const day = date ? new Date(date) : new Date();
    const start = new Date(day); start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + DAY_MS);
    const rows = await this.prisma.spaBooking.findMany({
      where: { hotelId, startTime: { gte: start, lt: end } },
      include: { treatment: true, therapist: true },
      orderBy: { startTime: 'asc' },
    }).catch(() => []);
    return {
      ok: true, count: rows.length,
      bookings: rows.map((b) => ({
        guest: b.guestName, treatment: b.treatment?.name ?? null,
        therapist: b.therapist?.name ?? null,
        start: b.startTime.toISOString().slice(0, 16).replace('T', ' '),
        status: b.status,
      })),
    };
  }

  private async toolListSpaTreatments(hotelId: string) {
    const rows = await this.prisma.spaTreatment.findMany({
      where: { hotelId, active: true }, orderBy: { name: 'asc' },
    }).catch(() => []);
    return {
      ok: true, count: rows.length,
      treatments: rows.map((t) => ({
        name: t.name, category: t.category, duration_min: t.durationMin, price: Math.round(t.price),
      })),
    };
  }

  private async toolListOutletOrders(hotelId: string, status?: string) {
    const where: any = { hotelId };
    if (status) where.status = status;
    const rows = await this.prisma.outletOrder.findMany({
      where, include: { outlet: true }, orderBy: { createdAt: 'desc' }, take: 40,
    }).catch(() => []);
    return {
      ok: true, count: rows.length,
      orders: rows.map((o) => ({
        outlet: o.outlet.name, table: o.tableNumber ?? null,
        status: o.status, total: Math.round(o.total),
        opened: o.createdAt.toISOString().slice(0, 16).replace('T', ' '),
      })),
    };
  }

  private async toolListWristbands(hotelId: string) {
    const rows = await this.prisma.wristband.findMany({
      where: { hotelId, status: 'active' }, orderBy: { issuedAt: 'desc' }, take: 40,
    }).catch(() => []);
    return {
      ok: true, count: rows.length,
      wristbands: rows.map((w) => ({
        code: w.code, type: w.type, spending_limit: Math.round(w.spendingLimit),
        issued: w.issuedAt.toISOString().slice(0, 10),
      })),
    };
  }

  private async toolListReviews(hotelId: string, status?: string) {
    const where: any = { hotelId };
    if (status) where.status = status;
    const rows = await this.prisma.platformReview.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 40,
    }).catch(() => []);
    return {
      ok: true, count: rows.length,
      reviews: rows.map((r) => ({
        platform: r.platform, guest: r.guestName ?? null, rating: r.rating,
        sentiment: r.sentiment, status: r.status,
        text: r.text?.slice(0, 300) ?? null,
      })),
    };
  }

  private async toolListRisks(hotelId: string, severity?: string) {
    const where: any = { hotelId, resolvedAt: null };
    if (severity) where.severity = severity;
    const rows = await this.prisma.predictionRisk.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 40,
    }).catch(() => []);
    return {
      ok: true, count: rows.length,
      risks: rows.map((r) => ({
        type: r.type, severity: r.severity, title: r.title,
        detail: r.detail, proposed_action: r.proposedAction ?? null,
      })),
    };
  }


  private async toolCreateReservation(hotelId: string, args: any) {


    const { check_in, check_out } = args;
    if (!check_in || !check_out) return { ok: false, error: 'check_in and check_out are required (YYYY-MM-DD)' };
    const guestsCount = Math.max(1, Number(args.guests) || 1);

    let guest = null as null | { id: string; fullName: string };
    if (args.guest_query?.trim()) {
      const matches = await this.guests.findAll(args.guest_query.trim(), hotelId);
      if (matches.length) guest = { id: matches[0].id, fullName: matches[0].fullName };
    }
    if (!guest && args.guest_name?.trim()) {
      const created = await this.prisma.guest.create({
        data: { hotelId, fullName: args.guest_name.trim(), phone: (args.guest_phone ?? '').trim(), docType: 'passport' },
      });
      guest = { id: created.id, fullName: created.fullName };
    }
    if (!guest) return { ok: false, error: 'guest not found — provide an existing guest name or guest_name for a new profile' };

    const avail = await this.availableRooms(hotelId, check_in, check_out, guestsCount);
    if (!avail.ok) return avail;
    if (!avail.rooms.length) return { ok: false, error: 'no rooms available for those dates' };
    let room = avail.rooms[0];
    if (args.room_number) {
      const byNum = avail.rooms.find((r) => r.number === String(args.room_number));
      if (!byNum) return { ok: false, error: `room ${args.room_number} is not available for those dates` };
      room = byNum;
    } else if (args.room_type) {
      const byType = avail.rooms.find((r) => r.type.toLowerCase() === String(args.room_type).toLowerCase());
      if (byType) room = byType;
    }

    const created = await this.prisma.reservation.create({
      data: {
        hotelId, guestId: guest.id, roomId: room.id,
        checkIn: new Date(check_in), checkOut: new Date(check_out),
        totalPrice: room.total, status: 'confirmed', source: 'atlas', guestCount: guestsCount,
      },
      include: { room: true, guest: true },
    });
    this.events.emit('reservation.created', { reservationId: created.id, hotelId });
    const code = created.id.slice(-6).toUpperCase();
    const card: AtlasCard = { kind: 'booking', guest: guest.fullName, room: room.number, checkIn: check_in, checkOut: check_out, nights: avail.nights, total: room.total, code };
    return { ok: true, reservation_id: created.id, confirmation_code: code, ...card, card };
  }

  private async toolAssignHousekeeping(hotelId: string, args: any) {
    const number = String(args.room_number ?? '').trim();
    if (!number) return { ok: false, error: 'room_number is required' };
    const room = await this.prisma.room.findFirst({ where: { hotelId, number } });
    if (!room) return { ok: false, error: `room ${number} not found` };

    let userId: string | null = null;
    if (!args.clear) {
      const name = String(args.staff_name ?? '').trim();
      if (!name) return { ok: false, error: 'staff_name is required unless clear=true' };
      const staff = await this.control.user.findMany({
        where: { role: 'housekeeping', active: true }, select: { id: true, name: true },
      });
      const hit = staff.find((s) => s.name.toLowerCase().includes(name.toLowerCase()));
      if (!hit) return { ok: false, error: `no housekeeper matching "${name}" — known: ${staff.map((s) => s.name).join(', ') || 'none'}` };
      userId = hit.id;
    }

    const existing = await this.prisma.housekeepingTask.findFirst({
      where: { hotelId, roomId: room.id, completedAt: null, OR: [{ note: null }, { note: { not: 'daily' } }] },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      await this.prisma.housekeepingTask.update({ where: { id: existing.id }, data: { assignedToId: userId } });
    } else {
      await this.prisma.housekeepingTask.create({
        data: { hotelId, roomId: room.id, status: room.housekeepingStatus === 'dirty' ? 'dirty' : 'in_progress', assignedToId: userId },
      });
    }
    return { ok: true, room: number, assigned: !args.clear };
  }

  private async toolCreateWorkOrder(hotelId: string, user: RequestUser, args: any) {
    const title = String(args.title ?? '').trim();
    if (!title) return { ok: false, error: 'title is required' };
    let roomId: string | null = null;
    if (args.room_number) {
      const room = await this.prisma.room.findFirst({ where: { hotelId, number: String(args.room_number).trim() } });
      if (!room) return { ok: false, error: `room ${args.room_number} not found` };
      roomId = room.id;
    }
    const priority = ['low', 'medium', 'high', 'urgent'].includes(args.priority) ? args.priority : 'medium';
    const wo = await this.prisma.workOrder.create({
      data: { hotelId, roomId, title, description: (args.description ?? '').trim() || null, priority, status: 'open', reportedById: user.sub },
    });
    return { ok: true, work_order_id: wo.id, title, priority, room: args.room_number ?? null };
  }

  private async toolResolveWorkOrder(hotelId: string, args: any) {
    const query = String(args.query ?? '').trim();
    const status = args.status === 'resolved' ? 'resolved' : 'in_progress';
    if (!query) return { ok: false, error: 'query is required' };
    const open = await this.prisma.workOrder.findMany({
      where: { hotelId, status: { not: 'resolved' } }, include: { room: true }, orderBy: { createdAt: 'desc' }, take: 40,
    });
    const q = query.toLowerCase();
    const hit = open.find((w) => w.title.toLowerCase().includes(q) || w.room?.number === query);
    if (!hit) return { ok: false, error: `no open ticket matching "${query}"` };
    await this.prisma.workOrder.update({
      where: { id: hit.id },
      data: { status, resolvedAt: status === 'resolved' ? new Date() : null },
    });
    return { ok: true, title: hit.title, status };
  }

  private async toolCreateChecklist(hotelId: string, user: RequestUser, args: any) {
    const title = String(args.title ?? '').trim();
    const items = Array.isArray(args.items)
      ? args.items.map((i: unknown) => String(i ?? '').trim()).filter(Boolean).slice(0, 40)
      : [];
    if (!title) return { ok: false, error: 'title is required' };
    if (!items.length) return { ok: false, error: 'items must be a non-empty list of strings' };
    const priority = ['low', 'medium', 'high'].includes(args.priority) ? args.priority : 'medium';
    const due = args.due_date ? new Date(args.due_date) : null;
    const dueDate = due && !Number.isNaN(due.getTime()) ? due : null;

    // Each item is a real task, so the list is trackable in the platform rather
    // than being text that disappears with the conversation.
    const created = [];
    for (const item of items) {
      const t = await this.prisma.task.create({
        data: {
          hotelId, title: item, note: title, category: 'checklist',
          priority, status: 'open', createdById: user.sub, dueDate,
        },
      });
      created.push({ id: t.id, title: t.title });
    }
    const card: AtlasCard = {
      kind: 'checklist', title, items: created,
      due: dueDate ? dueDate.toISOString().slice(0, 10) : undefined,
    };
    return { ok: true, created: created.length, title, items: created.map((c) => c.title), card };
  }

  private async toolCompleteTask(hotelId: string, query?: string) {
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return { ok: false, error: 'query is required' };
    const open = await this.prisma.task.findMany({ where: { hotelId, status: 'open' }, orderBy: { createdAt: 'desc' }, take: 60 });
    const hit = open.find((t) => t.title.toLowerCase().includes(q));
    if (!hit) return { ok: false, error: `no open task matching "${query}"` };
    await this.prisma.task.update({ where: { id: hit.id }, data: { status: 'done', doneAt: new Date() } });
    return { ok: true, title: hit.title, status: 'done' };
  }

  private async toolNotify(hotelId: string, args: any) {
    const title = String(args.title ?? '').trim();
    if (!title) return { ok: false, error: 'title is required' };
    const priority = ['low', 'medium', 'high'].includes(args.priority) ? args.priority : 'medium';
    await this.prisma.task.create({
      data: { hotelId, title, note: (args.note ?? '').trim() || null, category: 'atlas', priority, status: 'open' },
    });
    return { ok: true, notified: true };
  }
}

const stripCard = (o: any) => { if (o && typeof o === 'object' && 'card' in o) { const { card, ...rest } = o; return rest; } return o; };
