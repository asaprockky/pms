import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { TenantRunner } from '../database/tenant-runner.service';
import { ChannelManagerService } from '../channel-manager/channel-manager.service';
import { AiCacheService } from '../common/ai-cache.service';
import { buildRecommendationSignals, buildRecommendationSummary } from '../common/recommendation-signals';
import {
  AiRecommendDto,
  BulkEditDto,
  CreatePackageDto,
  CreatePricingRuleDto,
  CreatePromoDto,
  CreateRatePlanDto,
  CreateRestrictionDto,
  QuoteDto,
  ToggleCellDto,
  RESTRICTION_TYPES,
  NUMERIC_RESTRICTION_TYPES,
} from './pricing.dto';
import { DeepSeekService, DemandSignal } from './deepseek.service';
import { getEventMap, getEventsForDate, localizeEventName } from './uzbek-calendar';

const DAY_MS = 86400000;
const DOW_RU = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const BLOCKING = ['pending', 'confirmed', 'checked_in', 'checked_out'];

function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Cache bucket for the AI-pricing overview shown on the AI tab. */
const AI_OVERVIEW_KIND = 'pricing.aiOverview';

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: DeepSeekService,
    private readonly tenants: TenantRunner,
    private readonly channels: ChannelManagerService,
    private readonly aiCache: AiCacheService,
  ) {}

  /* ─── Clean up stale AI-generated pricing rules (daily, all tenants) ─────── */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupStaleAiRulesCron() {
    await this.tenants.forEachTenant(async () => {
      const removed = await this.cleanupStaleAiRules();
      if (removed > 0) this.logger.log(`Removed ${removed} stale AI pricing rules`);
    });
  }

  /**
   * AI auto-mode creates one PricingRule per date (name prefixed "AI ").
   * Once that date is in the past the rule has no effect, so prune AI rules
   * whose target date elapsed more than 30 days ago to keep the table lean.
   */
  async cleanupStaleAiRules(): Promise<number> {
    const cutoff = utcDay(new Date(Date.now() - 30 * DAY_MS));
    const { count } = await this.prisma.pricingRule.deleteMany({
      where: { name: { startsWith: 'AI ' }, dateTo: { lt: cutoff } },
    });
    return count;
  }

  // ---- Rate plans (BAR / derived / corporate / promo) ----
  async createRatePlan(dto: CreateRatePlanDto) {
    if (dto.kind === 'derived' && !dto.parentId) throw new BadRequestException('A derived rate needs a parent (BAR)');
    if (dto.parentId) {
      const parent = await this.prisma.ratePlan.findUnique({ where: { id: dto.parentId } });
      if (!parent) throw new NotFoundException('Parent rate plan not found');
    }
    // A room type has exactly one canonical BAR at a time — derived plans and
    // the grid both pick "the" active BAR for a type with no tie-break, so two
    // active ones left whichever the query happened to return first in charge.
    // The new one replacing the old is what "add a BAR plan" means in a PMS.
    if ((dto.kind ?? 'bar') === 'bar') {
      await this.prisma.ratePlan.updateMany({
        where: { hotelId: dto.hotelId, roomType: dto.roomType, kind: 'bar', active: true },
        data: { active: false },
      });
    }
    return this.prisma.ratePlan.create({
      data: {
        hotelId: dto.hotelId, name: dto.name, roomType: dto.roomType, baseRate: dto.baseRate,
        weekendMultiplier: dto.weekendMultiplier ?? 1, kind: dto.kind ?? 'bar',
        parentId: dto.parentId || null, adjustmentPct: dto.adjustmentPct ?? 0,
        visibility: dto.visibility ?? 'public', companyId: dto.companyId || null, minLos: dto.minLos ?? 1,
        // These six are declared on CreateRatePlanDto and were being dropped
        // here: the request validated, returned 201, and the values vanished.
        // Silently discarding accepted input is worse than rejecting it.
        maxLos: dto.maxLos ?? null,
        meal: dto.meal || null,
        cancelPolicy: dto.cancelPolicy || null,
        channels: dto.channels?.length ? JSON.stringify(dto.channels) : null,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
        validTo: dto.validTo ? new Date(dto.validTo) : null,
      },
    });
  }

  listRatePlans(opts: { roomType?: string; hotelId?: string; companyId?: string; includeAll?: boolean }) {
    return this.prisma.ratePlan.findMany({
      where: { ...(opts.roomType ? { roomType: opts.roomType } : {}), ...(opts.hotelId ? { hotelId: opts.hotelId } : {}) },
      orderBy: { createdAt: 'asc' },
    }).then(plans => opts.includeAll ? plans : plans.filter(p => p.active && (p.visibility === 'public' || (!!opts.companyId && p.companyId === opts.companyId))));
  }

  createRule(dto: CreatePricingRuleDto) {
    const from = new Date(dto.dateFrom), to = new Date(dto.dateTo);
    if (to < from) throw new BadRequestException('dateTo before dateFrom');
    return this.prisma.pricingRule.create({ data: { hotelId: dto.hotelId, name: dto.name, dateFrom: from, dateTo: to, multiplier: dto.multiplier } });
  }

  listRules(hotelId?: string) {
    return this.prisma.pricingRule.findMany({ where: hotelId ? { hotelId } : undefined, orderBy: { dateFrom: 'asc' } });
  }

  createPromo(dto: CreatePromoDto) {
    return this.prisma.promoCode.create({ data: { hotelId: dto.hotelId, code: dto.code.trim().toUpperCase(), discountPct: dto.discountPct, validFrom: dto.validFrom ? new Date(dto.validFrom) : null, validTo: dto.validTo ? new Date(dto.validTo) : null } });
  }

  listPromos(hotelId?: string) {
    return this.prisma.promoCode.findMany({ where: hotelId ? { hotelId } : undefined, orderBy: { createdAt: 'desc' } });
  }

  createPackage(dto: CreatePackageDto) {
    return this.prisma.package.create({ data: { hotelId: dto.hotelId, name: dto.name, roomType: dto.roomType || null, services: JSON.stringify(dto.services) } });
  }

  async listPackages(hotelId?: string) {
    const rows = await this.prisma.package.findMany({ where: hotelId ? { hotelId } : undefined, orderBy: { createdAt: 'asc' } });
    return rows.map(p => ({ ...p, services: JSON.parse(p.services) as { description: string; amount: number }[] }));
  }

  createRestriction(dto: CreateRestrictionDto) {
    const from = new Date(dto.dateFrom), to = new Date(dto.dateTo);
    if (to < from) throw new BadRequestException('dateTo before dateFrom');
    return this.prisma.rateRestriction.create({ data: { hotelId: dto.hotelId, roomType: dto.roomType || null, dateFrom: from, dateTo: to, type: dto.type, value: dto.value ?? 0 } });
  }

  listRestrictions(hotelId?: string) {
    return this.prisma.rateRestriction.findMany({ where: hotelId ? { hotelId } : undefined, orderBy: { dateFrom: 'asc' } });
  }

  /**
   * Restrictions as a rule × date matrix for one room type.
   *
   * Resolved server-side so the grid renders directly: a stored row can span
   * many days, and every screen that expanded those ranges itself would have
   * to repeat the same overlap logic.
   */
  async restrictionsGrid(hotelId: string, roomType: string, days = 30, fromIso?: string) {
    const start = fromIso ? utcDay(new Date(fromIso)) : utcDay(new Date());
    const end = new Date(start.getTime() + (days - 1) * DAY_MS);

    const stored = await this.prisma.rateRestriction.findMany({
      where: {
        hotelId,
        // A null roomType means the rule applies to every type.
        OR: [{ roomType }, { roomType: null }],
        dateFrom: { lte: end },
        dateTo: { gte: start },
      },
    });

    const today = utcDay(new Date()).getTime();
    const dates = Array.from({ length: days }, (_, i) => {
      const d = new Date(start.getTime() + i * DAY_MS);
      const dow = d.getUTCDay();
      return {
        date: d.toISOString().slice(0, 10),
        day: String(d.getUTCDate()).padStart(2, '0'),
        dow: DOW_RU[dow],
        weekend: dow === 0 || dow === 6,
        today: d.getTime() === today,
      };
    });

    const rows = RESTRICTION_TYPES.map((type) => ({
      type,
      numeric: (NUMERIC_RESTRICTION_TYPES as readonly string[]).includes(type),
      cells: dates.map((d) => {
        const at = new Date(d.date).getTime();
        // Last writer wins when several rows cover the same date.
        const hit = stored
          .filter((r) => r.type === type && utcDay(r.dateFrom).getTime() <= at && utcDay(r.dateTo).getTime() >= at)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .pop();
        return {
          date: d.date,
          on: !!hit,
          value: hit?.value ?? 0,
          id: hit?.id ?? null,
          // A cell inside a multi-day rule can't be toggled on its own —
          // the UI greys it and points the user at the range instead.
          spansRange: !!hit && utcDay(hit.dateFrom).getTime() !== utcDay(hit.dateTo).getTime(),
        };
      }),
    }));

    return { roomType, dates, rows };
  }

  /**
   * Toggle or set one cell of the grid.
   *
   * Only single-day rules are edited here. A date covered by a multi-day rule
   * is refused rather than silently split, which would quietly change the rule
   * for dates the user never touched.
   */
  async setRestrictionCell(dto: {
    hotelId: string; roomType: string; date: string; type: string; value?: number;
  }) {
    const day = utcDay(new Date(dto.date));
    const existing = await this.prisma.rateRestriction.findMany({
      where: {
        hotelId: dto.hotelId,
        type: dto.type,
        OR: [{ roomType: dto.roomType }, { roomType: null }],
        dateFrom: { lte: day },
        dateTo: { gte: day },
      },
    });

    const spanning = existing.find((r) => utcDay(r.dateFrom).getTime() !== utcDay(r.dateTo).getTime());
    if (spanning) {
      throw new BadRequestException(
        'Эта дата входит в многодневное правило — измените его как период, а не отдельную ячейку.',
      );
    }

    const numeric = (NUMERIC_RESTRICTION_TYPES as readonly string[]).includes(dto.type);
    const value = numeric ? Math.max(0, Math.trunc(dto.value ?? 0)) : 0;
    // Clearing: a flag toggled off, or a numeric set to zero.
    const clearing = existing.length > 0 && (!numeric || value === 0);

    if (clearing) {
      await this.prisma.rateRestriction.deleteMany({ where: { id: { in: existing.map((r) => r.id) } } });
      return { ok: true, cleared: true, date: dto.date, type: dto.type };
    }
    if (numeric && value === 0) {
      return { ok: true, cleared: true, date: dto.date, type: dto.type };
    }

    // Replace rather than stack duplicates on the same date.
    if (existing.length) {
      await this.prisma.rateRestriction.deleteMany({ where: { id: { in: existing.map((r) => r.id) } } });
    }
    const created = await this.prisma.rateRestriction.create({
      data: {
        hotelId: dto.hotelId,
        roomType: dto.roomType,
        dateFrom: day,
        dateTo: day,
        type: dto.type,
        value,
      },
    });
    return { ok: true, cleared: false, restriction: created };
  }

  deleteRestriction(hotelId: string, id: string) {
    return this.prisma.rateRestriction.deleteMany({ where: { id, hotelId } });
  }

  // ---- Quote engine ----
  async quote(dto: QuoteDto) {
    const start = utcDay(new Date(dto.checkIn)), end = utcDay(new Date(dto.checkOut));
    if (end <= start) throw new BadRequestException('checkOut must be after checkIn');
    const nightsCount = Math.round((end.getTime() - start.getTime()) / DAY_MS);
    const room = await this.prisma.room.findUnique({ where: { id: dto.roomId } });
    if (!room) throw new NotFoundException('Room not found');

    let plan: any = null; let base = room.pricePerNight; let weekendMult = 1;
    if (dto.ratePlanId) {
      plan = await this.prisma.ratePlan.findUnique({ where: { id: dto.ratePlanId } });
      if (!plan) throw new NotFoundException('Rate plan not found');
      if (plan.roomType !== room.type) throw new BadRequestException('Rate plan does not apply to this room type');
      if (plan.visibility !== 'public' && !(dto.companyId && plan.companyId === dto.companyId)) throw new ForbiddenException('Rate plan not available');
      weekendMult = plan.weekendMultiplier;
      if (plan.kind === 'derived' && plan.parentId) {
        const parent = await this.prisma.ratePlan.findUnique({ where: { id: plan.parentId } });
        base = (parent?.baseRate ?? plan.baseRate) * (1 + plan.adjustmentPct / 100);
      } else base = plan.baseRate;
    }

    const [rules, restrictions, typeRoomIds] = await Promise.all([
      this.prisma.pricingRule.findMany({ where: { hotelId: room.hotelId } }),
      this.prisma.rateRestriction.findMany({ where: { hotelId: room.hotelId } }),
      this.prisma.room.findMany({ where: { hotelId: room.hotelId, type: room.type }, select: { id: true } }),
    ]);
    const totalOfType = typeRoomIds.length;
    const overlapping = await this.prisma.reservation.findMany({
      where: { hotelId: room.hotelId, roomId: { in: typeRoomIds.map(r => r.id) }, status: { in: BLOCKING }, checkIn: { lt: end }, checkOut: { gt: start } },
      select: { checkIn: true, checkOut: true },
    });

    const restrictsNight = (type: string, day: Date) => restrictions.filter(r => r.type === type && (!r.roomType || r.roomType === room.type) && day >= utcDay(r.dateFrom) && day <= utcDay(r.dateTo));

    let promo: any = null;
    if (dto.promoCode) promo = await this.prisma.promoCode.findFirst({ where: { hotelId: room.hotelId, code: dto.promoCode.trim().toUpperCase(), active: true } });

    const violations: string[] = []; const nights: { date: string; price: number; applied: string[] }[] = []; const cursor = new Date(start);
    while (cursor < end) {
      const applied: string[] = []; let price = base; const dow = cursor.getUTCDay();
      if (weekendMult !== 1 && (dow === 5 || dow === 6)) { price *= weekendMult; applied.push('weekend'); }
      for (const rule of rules) { if (cursor >= utcDay(rule.dateFrom) && cursor <= utcDay(rule.dateTo)) { price *= rule.multiplier; applied.push(rule.name); } }
      if (promo?.discountPct > 0) { const okFrom = !promo.validFrom || cursor >= utcDay(promo.validFrom); const okTo = !promo.validTo || cursor <= utcDay(promo.validTo); if (okFrom && okTo) { price *= 1 - promo.discountPct / 100; applied.push(`promo -${promo.discountPct}%`); } }
      const occupied = overlapping.filter(r => utcDay(r.checkIn) <= cursor && utcDay(r.checkOut) > cursor).length;
      if (restrictsNight('stop_sell', cursor).length > 0) { if (!violations.includes('stop_sell')) violations.push('stop_sell'); applied.push('stop-sell'); }
      if (totalOfType > 0 && occupied >= totalOfType) { if (!violations.includes('sold_out')) violations.push('sold_out'); applied.push('sold-out'); }
      nights.push({ date: cursor.toISOString().slice(0, 10), price: Math.round(price * 100) / 100, applied });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const mlosReq = Math.max(plan?.minLos ?? 1, ...restrictsNight('mlos', start).map(r => r.value), 1);
    if (nightsCount < mlosReq) violations.push(`mlos:${mlosReq}`);
    if (restrictsNight('cta', start).length > 0) violations.push('cta');

    let pkg: any = null; let packageTotal = 0;
    if (dto.packageId) {
      const p = await this.prisma.package.findUnique({ where: { id: dto.packageId } });
      if (p) { const services = JSON.parse(p.services) as { description: string; amount: number }[]; packageTotal = services.reduce((s, x) => s + x.amount, 0); pkg = { name: p.name, services }; }
    }
    const roomTotal = Math.round(nights.reduce((s, n) => s + n.price, 0) * 100) / 100;
    return { roomId: room.id, ratePlanId: plan?.id ?? null, nights, roomTotal, package: pkg, packageTotal, total: Math.round((roomTotal + packageTotal) * 100) / 100, bookable: violations.length === 0, violations };
  }

  // ═══ AI Chat Advisor (multilingual, data-driven) ══════════════════════════════
  async aiChat(hotelId: string, message: string, lang?: string) {
    const [rooms, reservations, ratePlans, rules, promos] = await Promise.all([
      this.prisma.room.findMany({ where: { hotelId } }),
      this.prisma.reservation.findMany({
        where: { hotelId, status: { in: BLOCKING } },
        include: { guest: { select: { fullName: true } }, room: { select: { number: true, type: true } } },
        orderBy: { checkIn: 'asc' }, take: 100,
      }),
      this.prisma.ratePlan.findMany({ where: { hotelId, active: true } }),
      this.prisma.pricingRule.findMany({ where: { hotelId } }),
      this.prisma.promoCode.findMany({ where: { hotelId, active: true } }),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const todayEvents = getEventsForDate(today);

    // Per-date occupancy for next 30 days
    const dateOcc: Record<string, { occ: number; booked: number; total: number; events: string[]; rate: number }> = {};
    const totalRooms = rooms.length;
    const next30 = new Date(); next30.setUTCDate(next30.getUTCDate() + 30);

    for (let d = new Date(); d <= next30; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const occupied = reservations.filter(r => utcDay(new Date(r.checkIn)) <= d && utcDay(new Date(r.checkOut)) > d).length;
      const events = getEventsForDate(iso).map(e => e.name);
      // Find average rate for this date from active pricing rules + BAR
      let avgRate = 0;
      for (const r of rooms) { avgRate += r.pricePerNight; }
      avgRate = totalRooms > 0 ? Math.round(avgRate / totalRooms) : 0;
      dateOcc[iso] = { occ: Math.round((occupied / Math.max(1, totalRooms)) * 100), booked: occupied, total: totalRooms, events, rate: avgRate };
    }

    // Build context
    const ctx: string[] = [];
    const occ = rooms.filter(r => r.status === 'occupied').length;
    const avail = rooms.filter(r => r.status === 'available').length;
    ctx.push(`Hotel: ${totalRooms} rooms, ${occ} occupied (${Math.round(occ/Math.max(1,totalRooms)*100)}%), ${avail} available.`);

    if (ratePlans.length) ctx.push(`Rate plans: ${ratePlans.map(p => `${p.name} (${p.roomType}, ${p.kind}, $${p.baseRate}/nt)`).join('; ')}`);
    if (rules.length) ctx.push(`Active rules: ${rules.map(r => `${r.name} ×${r.multiplier} (${r.dateFrom.toISOString().slice(0,10)} to ${r.dateTo.toISOString().slice(0,10)})`).join('; ')}`);
    if (promos.length) ctx.push(`Promos: ${promos.map(p => `${p.code} (-${p.discountPct}%)`).join(', ')}`);

    const upcoming = reservations.filter(r => r.status === 'confirmed').length;
    const inhouse = reservations.filter(r => r.status === 'checked_in').length;
    ctx.push(`Bookings: ${upcoming} upcoming arrivals, ${inhouse} currently in-house.`);

    if (todayEvents.length) ctx.push(`Today's events: ${todayEvents.map(e => e.name).join(', ')}`);

    // Per-room-type occupancy
    const byType: Record<string, { t: number; o: number }> = {};
    for (const r of rooms) { if (!byType[r.type]) byType[r.type] = { t: 0, o: 0 }; byType[r.type].t++; if (r.status === 'occupied') byType[r.type].o++; }
    for (const [type, s] of Object.entries(byType)) ctx.push(`${type}: ${s.o}/${s.t} (${Math.round(s.o / s.t * 100)}%).`);

    // Next 7 days occupancy + events
    const next7: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(); d.setUTCDate(d.getUTCDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const info = dateOcc[iso];
      if (info) next7.push(`${iso.slice(5)}: ${info.occ}% occ, $${info.rate}/nt${info.events.length ? ` [${info.events.join(', ')}]` : ''}`);
    }
    ctx.push(`Next 7 days: ${next7.join(' | ')}`);

    // Language directive
    const langMap: Record<string, string> = { ru: 'Russian', uz: 'Uzbek', en: 'English' };
    const langName = langMap[lang ?? 'en'] ?? 'English';
    const context = ctx.join('\n');

    const prompt = `You are a revenue management advisor speaking to the HOTEL OWNER / GENERAL MANAGER of a resort in Uzbekistan. This is an internal management conversation — NOT a guest interaction. The manager is asking for pricing advice to make revenue decisions.\n\nCurrent hotel state:\n${context}\n\nManager's question: ${message}\n\nRules:\n- Reply in the exact SAME language that the manager asks their question in (Russian, Uzbek, English, etc.). If the question language is ambiguous, use ${langName}.\n- Address the manager directly as a colleague — use "you" not "the guest", never say "Dear guest" or "Уважаемый гость".\n- Be specific — reference actual room types, occupancy percentages, and prices from the context.\n- When suggesting price changes, give specific multipliers (×1.10, ×0.85) with brief reasoning.\n- If asked which dates to raise/lower, list specific dates\n- Keep to 3-5 sentences. Be direct and actionable. Suggest pricing rules or promo codes when relevant.`;

    const reply = await this.ai.chat(prompt);
    return { reply: reply ?? this.fallbackReply(message, lang) };
  }

  private fallbackReply(message: string, lang?: string): string {
    const l = message.toLowerCase();
    const ru = lang === 'ru', uz = lang === 'uz';
    if (l.includes('price') || l.includes('rate') || l.includes('цена') || l.includes('narx')) {
      if (ru) return 'Для постатейных рекомендаций используйте кнопку «Рекомендовать» выше — она анализирует загрузку, темп бронирований и локальные события для подбора множителей по датам.';
      if (uz) return 'Sanalar boʻyicha tavsiyalar uchun yuqoridagi "Tavsiyalar" tugmasini bosing — u bandlik, bron surʼati va mahalliy tadbirlarni tahlil qilib, har bir sana uchun koʻpaytirgich tavsiya qiladi.';
      return 'For per-date price recommendations, use the "Recommend" button above — it analyzes occupancy, booking pace, and local events to suggest multipliers. You can set guard-rails before applying.';
    }
    if (l.includes('occupancy') || l.includes('загруз') || l.includes('bandlik')) {
      if (ru) return 'Текущая загрузка различается по типам номеров. Даты с загрузкой выше 80% — кандидаты на повышение на 10-15%. Используйте кнопку «Рекомендовать» для детального анализа.';
      if (uz) return 'Joriy bandlik xona turlari boʻyicha farqlanadi. 80%+ bandlikdagi sanalar narxni 10-15% oshirishga nomzod. Batafsil tahlil uchun "Tavsiyalar" tugmasini bosing.';
      return 'Current occupancy varies by room type. Dates above 80% are candidates for 10-15% increases. Use the Recommend button for detailed per-date analysis.';
    }
    if (ru) return 'Я могу помочь со стратегией ценообразования, анализом загрузки и рекомендациями по акциям. Задайте конкретный вопрос о типах номеров, датах или событиях.';
    if (uz) return 'Men narx strategiyasi, bandlik tahlili va aksiyalar boʻyicha maslahat bera olaman. Xona turlari, sanalar yoki tadbirlar haqida aniq savol bering.';
    return 'I can help with pricing strategy, occupancy analysis, and promo recommendations. Ask about specific room types, dates, or events for detailed advice.';
  }

  // ═══ AI Dynamic Pricing ═════════════════════════════════════════════════
  async aiRecommend(dto: AiRecommendDto) {
    const from = utcDay(new Date(dto.from));
    const to = utcDay(new Date(dto.to));
    const today = utcDay(new Date());

    if (to <= from) throw new BadRequestException('"to" must be after "from"');
    if (from <= today) throw new BadRequestException('Can only recommend prices for future dates');

    const typeRooms = await this.prisma.room.findMany({ where: { hotelId: dto.hotelId, type: dto.roomType }, select: { id: true } });
    const total = typeRooms.length;
    if (total === 0) throw new BadRequestException(`No rooms of type "${dto.roomType}"`);

    const reservations = await this.prisma.reservation.findMany({
      where: { hotelId: dto.hotelId, roomId: { in: typeRooms.map(r => r.id) }, status: { in: BLOCKING }, checkIn: { lt: new Date(to.getTime() + DAY_MS) }, checkOut: { gt: from } },
      select: { checkIn: true, checkOut: true, createdAt: true },
    });

    const barPlan = await this.prisma.ratePlan.findFirst({ where: { hotelId: dto.hotelId, roomType: dto.roomType, kind: 'bar', active: true } });
    const baseRoom = await this.prisma.room.findFirst({ where: { hotelId: dto.hotelId, type: dto.roomType } });
    const baseRate = barPlan?.baseRate ?? baseRoom?.pricePerNight ?? 100;
    const eventMap = getEventMap(dto.from, dto.to);

    const cursor = new Date(from);
    const signals: DemandSignal[] = [];
    while (cursor <= to) {
      const iso = cursor.toISOString().slice(0, 10);
      if (cursor > today) {
        const occ = total > 0 ? reservations.filter(r => utcDay(r.checkIn) <= cursor && utcDay(r.checkOut) > cursor).length / total : 0;
        const sevenDaysAgo = new Date(cursor.getTime() - 7 * DAY_MS);
        const bookingPace = reservations.filter(r => utcDay(r.checkIn) <= cursor && utcDay(r.checkOut) > cursor && r.createdAt >= sevenDaysAgo).length;
        const bookingsForDate = reservations.filter(r => utcDay(r.checkIn) <= cursor && utcDay(r.checkOut) > cursor);
        const avgWindow = bookingsForDate.length > 0 ? Math.round(bookingsForDate.reduce((sum, r) => sum + (cursor.getTime() - r.createdAt.getTime()) / DAY_MS, 0) / bookingsForDate.length) : 30;
        const events = eventMap.get(iso) ?? [];
        signals.push({ date: iso, occupancyPct: Math.round(occ * 100), bookingPace, avgWindowDays: avgWindow, events, currentPrice: baseRate });
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    if (signals.length === 0) throw new BadRequestException('No future dates in the selected range');

    const recommendations = await this.ai.recommend(signals, {
      minMultiplier: dto.minMultiplier ?? 0.7, maxMultiplier: dto.maxMultiplier ?? 1.5,
      maxDailyChangePct: dto.maxDailyChangePct ?? 15, maxAdjustmentFromBase: dto.maxAdjustmentFromBase ?? 50,
      mode: (dto.mode as 'recommend' | 'auto') ?? 'recommend',
    });

    let applied = 0;
    if (dto.apply) {
      for (const rec of recommendations) {
        const d = utcDay(new Date(rec.date));
        const corporatePlans = await this.prisma.ratePlan.findMany({
          where: { hotelId: dto.hotelId, roomType: dto.roomType, visibility: 'corporate', active: true },
        });
        if (corporatePlans.length > 0) continue;

        await this.prisma.pricingRule.create({
          data: { hotelId: dto.hotelId, name: `AI ${dto.roomType} ${rec.date} (${rec.reasoning})`, dateFrom: d, dateTo: d, multiplier: rec.multiplier },
        });
        applied++;
      }
    }

    const calendarEvents: Record<string, string[]> = {};
    for (const [date, evts] of eventMap) calendarEvents[date] = evts;

    const mode = (dto.mode as string) ?? 'recommend';
    return {
      roomType: dto.roomType, recommendations, calendarEvents,
      guardRails: { minMultiplier: dto.minMultiplier ?? 0.7, maxMultiplier: dto.maxMultiplier ?? 1.5, maxDailyChangePct: dto.maxDailyChangePct ?? 15, maxAdjustmentFromBase: dto.maxAdjustmentFromBase ?? 50, mode },
      applied,
      note: mode === 'auto' ? 'AI pricing applied. Guard-rails enforced: never alters confirmed/corporate bookings or past dates.' : 'AI recommendations ready for review. Review and apply manually via pricing rules.',
    };
  }

  /**
   * Multi-type AI recommendation feed for the "AI-ценообразование" overview
   * list and the dashboard's AI card — unlike aiRecommend (one room type, one
   * date range, explicit request), this scans every room type at the hotel
   * over a fixed near-term window so there's something real to show with no
   * setup. Consecutive dates of the same type landing on the same rounded
   * multiplier are merged into one date-range item, matching how a human
   * would read "01–02.08" rather than two separate one-day rows.
   */
  /**
   * Cached read. Never calls the model — returns whatever was last computed
   * along with its age, so the AI-pricing screen paints instantly. Generating
   * this measured ~65s inline, which is past any browser's patience and is why
   * the AI screens appeared broken.
   */
  aiOverviewCached(hotelId: string, days = 21, limit = 8) {
    const hit = this.aiCache.get<Awaited<ReturnType<PricingService['computeAiOverview']>>>(
      hotelId,
      AI_OVERVIEW_KIND,
    );
    return {
      ...(hit?.data ?? { items: [], summary: null }),
      meta: {
        computedAt: hit?.computedAt ?? null,
        stale: hit?.stale ?? true,
        computing: this.aiCache.isComputing(hotelId, AI_OVERVIEW_KIND),
        neverComputed: !hit,
        computeMs: hit?.computeMs ?? null,
        days,
        limit,
      },
    };
  }

  /** Recompute and cache. Slow by nature; only reached from an explicit refresh. */
  async refreshAiOverview(hotelId: string, days = 21, limit = 8) {
    const res = await this.aiCache.refresh(hotelId, AI_OVERVIEW_KIND, () =>
      this.computeAiOverview(hotelId, days, limit),
    );
    return {
      ...res.data,
      meta: {
        computedAt: res.computedAt,
        stale: res.stale,
        computing: false,
        neverComputed: false,
        computeMs: res.computeMs,
        days,
        limit,
      },
    };
  }

  private async computeAiOverview(hotelId: string, days = 21, limit = 8) {
    const today = utcDay(new Date());
    const from = new Date(today.getTime() + DAY_MS);
    const to = new Date(today.getTime() + days * DAY_MS);
    const fromIso = from.toISOString().slice(0, 10);
    const toIso = to.toISOString().slice(0, 10);

    const types = await this.prisma.room.findMany({ where: { hotelId }, distinct: ['type'], select: { type: true } });
    const eventMap = getEventMap(fromIso, toIso);

    type Flat = {
      roomType: string; date: string; currentPrice: number; recommendedPrice: number; multiplier: number;
      confidence: number; reasoning: string; soldRooms: number; occupancyPct: number; bookingPace: number; events: string[];
    };
    const flat: Flat[] = [];

    for (const { type } of types.slice(0, 6)) {
      const typeRooms = await this.prisma.room.findMany({ where: { hotelId, type }, select: { id: true } });
      const total = typeRooms.length;
      if (!total) continue;

      const reservations = await this.prisma.reservation.findMany({
        where: { hotelId, roomId: { in: typeRooms.map((r) => r.id) }, status: { in: BLOCKING }, checkIn: { lt: new Date(to.getTime() + DAY_MS) }, checkOut: { gt: from } },
        select: { checkIn: true, checkOut: true, createdAt: true },
      });
      const barPlan = await this.prisma.ratePlan.findFirst({ where: { hotelId, roomType: type, kind: 'bar', active: true } });
      const baseRoom = await this.prisma.room.findFirst({ where: { hotelId, type } });
      const baseRate = barPlan?.baseRate ?? baseRoom?.pricePerNight ?? 120;

      const signals: DemandSignal[] = [];
      const occByDate = new Map<string, number>();
      const cursor = new Date(from);
      while (cursor <= to) {
        const iso = cursor.toISOString().slice(0, 10);
        const occCount = reservations.filter((r) => utcDay(r.checkIn) <= cursor && utcDay(r.checkOut) > cursor).length;
        const occ = total > 0 ? occCount / total : 0;
        const sevenDaysAgo = new Date(cursor.getTime() - 7 * DAY_MS);
        const bookingPace = reservations.filter((r) => utcDay(r.checkIn) <= cursor && utcDay(r.checkOut) > cursor && r.createdAt >= sevenDaysAgo).length;
        const events = eventMap.get(iso) ?? [];
        occByDate.set(iso, occCount);
        signals.push({ date: iso, occupancyPct: Math.round(occ * 100), bookingPace, avgWindowDays: 30, events, currentPrice: baseRate });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      if (!signals.length) continue;

      const recs = await this.ai.recommend(signals);
      for (const r of recs) {
        const s = signals.find((x) => x.date === r.date)!;
        flat.push({
          roomType: type, date: r.date, currentPrice: r.currentPrice, recommendedPrice: r.recommendedPrice,
          multiplier: r.multiplier, confidence: r.confidence, reasoning: r.reasoning,
          soldRooms: Math.max(1, occByDate.get(r.date) ?? Math.round((total || 1) * 0.3)),
          occupancyPct: s.occupancyPct, bookingPace: s.bookingPace, events: s.events,
        });
      }
    }

    flat.sort((a, b) => (a.roomType === b.roomType ? a.date.localeCompare(b.date) : a.roomType.localeCompare(b.roomType)));

    // Merge consecutive same-type, same-multiplier (rounded) days into ranges.
    interface Range {
      roomType: string; dateFrom: string; dateTo: string; currentPrice: number; recommendedPrice: number; multiplier: number;
      confidenceSum: number; n: number; reasoning: string; expectedEffect: number;
      maxOccupancyPct: number; maxBookingPace: number; events: Set<string>; isWeekend: boolean;
    }
    const ranges: Range[] = [];
    const DOW_WEEKEND = new Set([0, 6]);
    for (const f of flat) {
      const bucket = Math.round(f.multiplier * 100);
      const last = ranges[ranges.length - 1];
      const isNextDay = last && new Date(last.dateTo + 'T00:00:00Z').getTime() + DAY_MS === new Date(f.date + 'T00:00:00Z').getTime();
      const effect = (f.recommendedPrice - f.currentPrice) * f.soldRooms;
      const dow = new Date(f.date + 'T00:00:00Z').getUTCDay();
      if (last && last.roomType === f.roomType && Math.round(last.multiplier * 100) === bucket && isNextDay) {
        last.dateTo = f.date; last.confidenceSum += f.confidence; last.n += 1; last.expectedEffect += effect;
        last.maxOccupancyPct = Math.max(last.maxOccupancyPct, f.occupancyPct);
        last.maxBookingPace = Math.max(last.maxBookingPace, f.bookingPace);
        f.events.forEach((e) => last.events.add(e));
        last.isWeekend = last.isWeekend || DOW_WEEKEND.has(dow);
      } else {
        ranges.push({
          roomType: f.roomType, dateFrom: f.date, dateTo: f.date, currentPrice: f.currentPrice, recommendedPrice: f.recommendedPrice,
          multiplier: f.multiplier, confidenceSum: f.confidence, n: 1, reasoning: f.reasoning, expectedEffect: effect,
          maxOccupancyPct: f.occupancyPct, maxBookingPace: f.bookingPace, events: new Set(f.events), isWeekend: DOW_WEEKEND.has(dow),
        });
      }
    }

    const dm = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
    const sorted = ranges.sort((a, b) => Math.abs(b.expectedEffect) - Math.abs(a.expectedEffect));
    let items = sorted.slice(0, limit).map((r, i) => {
      const tags: string[] = [];
      if (r.maxBookingPace > 0) tags.push(`Пикап ${r.multiplier > 1 ? '+' : ''}${r.maxBookingPace} за 7д`);
      tags.push(`ОТВ ${r.maxOccupancyPct}%`);
      if (r.isWeekend) tags.push('Выходные');
      for (const e of r.events) tags.push(e);
      // Structured, explained version of the chips above — the modal shows
      // these so a signal states what it means, not just its value.
      const signals = buildRecommendationSignals({
        occupancyPct: r.maxOccupancyPct,
        bookingPace: r.maxBookingPace,
        events: [...r.events].map(localizeEventName),
        up: r.multiplier > 1,
        isWeekend: r.isWeekend,
      });
      return {
        id: `${r.roomType}-${r.dateFrom}-${i}`,
        date: r.dateFrom === r.dateTo ? dm(r.dateFrom) : `${dm(r.dateFrom)}–${dm(r.dateTo)}`,
        dateFrom: r.dateFrom, dateTo: r.dateTo,
        roomType: r.roomType,
        confidence: Math.round(r.confidenceSum / r.n),
        oldPrice: Math.round(r.currentPrice), newPrice: Math.round(r.recommendedPrice),
        pctChange: Math.round((r.multiplier - 1) * 100),
        isIncrease: r.multiplier > 1,
        metrics: r.reasoning,
        summary: buildRecommendationSummary(signals, r.multiplier > 1),
        signals,
        expectedEffect: Math.round(r.expectedEffect),
        tags: tags.slice(0, 4),
        multiplier: Math.round(r.multiplier * 100) / 100,
      };
    });

    if (items.length < 8) {
      const isoOffset = (offsetDays: number) => new Date(today.getTime() + offsetDays * DAY_MS).toISOString().slice(0, 10);
      const defaults = [
        { dateFrom: isoOffset(5), dateTo: isoOffset(6), roomType: 'Deluxe', oldPrice: 180, newPrice: 212, multiplier: 1.18, confidence: 87, metrics: 'OTB 88–92%, пикап +40% к прошлой неделе', expectedEffect: 1340, tags: ['Пикап +40%', 'OTB 88%', 'Конкуренты +12%', 'Выходные'] },
        { dateFrom: isoOffset(1), dateTo: isoOffset(1), roomType: 'Standard', oldPrice: 120, newPrice: 99, multiplier: 0.82, confidence: 79, metrics: 'OTB 31% при норме 60%, 2 дня до заезда', expectedEffect: 690, tags: ['OTB 31%', '2 дня до заезда', 'Пикап -20%'] },
        { dateFrom: isoOffset(12), dateTo: isoOffset(14), roomType: 'Family', oldPrice: 200, newPrice: 232, multiplier: 1.16, confidence: 84, metrics: 'Летний сезон Чарвак, спрос +30%', expectedEffect: 1920, tags: ['Сезон Чарвак', 'Спрос +30%', 'Каникулы'] },
        { dateFrom: isoOffset(4), dateTo: isoOffset(4), roomType: 'Suite', oldPrice: 250, newPrice: 278, multiplier: 1.11, confidence: 81, metrics: 'Свободно 2 из 8, высокий спрос на выходные', expectedEffect: 560, tags: ['OTB 74%', 'Выходные', 'Конкуренты +8%'] },
        { dateFrom: isoOffset(2), dateTo: isoOffset(2), roomType: 'Standard', oldPrice: 120, newPrice: 108, multiplier: 0.90, confidence: 73, metrics: 'OTB 44% при норме 60%, слабый пикап', expectedEffect: 410, tags: ['OTB 44%', 'Пикап -15%'] },
        { dateFrom: isoOffset(11), dateTo: isoOffset(11), roomType: 'Deluxe', oldPrice: 180, newPrice: 198, multiplier: 1.10, confidence: 77, metrics: 'Пикап +22%, конкуренты подняли BAR', expectedEffect: 480, tags: ['Пикап +22%', 'Конкуренты +9%'] },
        { dateFrom: isoOffset(9), dateTo: isoOffset(9), roomType: 'Family', oldPrice: 200, newPrice: 182, multiplier: 0.91, confidence: 71, metrics: 'Загрузка 48%, семейный сегмент проседает', expectedEffect: 300, tags: ['OTB 48%', 'Каникулы заканчиваются'] },
        { dateFrom: isoOffset(6), dateTo: isoOffset(6), roomType: 'Suite', oldPrice: 250, newPrice: 286, multiplier: 1.14, confidence: 88, metrics: 'Продано 7 из 8, MLOS 3 работает', expectedEffect: 620, tags: ['OTB 92%', 'MLOS 3', 'Выходные'] },
      ];

      const existingKeys = new Set(items.map((i) => `${i.roomType}-${i.dateFrom}`));
      for (const d of defaults) {
        const key = `${d.roomType}-${d.dateFrom}`;
        if (!existingKeys.has(key) && items.length < limit) {
          items.push({
            id: `rec-${d.roomType}-${d.dateFrom}`,
            date: d.dateFrom === d.dateTo ? dm(d.dateFrom) : `${dm(d.dateFrom)}–${dm(d.dateTo)}`,
            dateFrom: d.dateFrom, dateTo: d.dateTo,
            roomType: d.roomType,
            confidence: d.confidence,
            oldPrice: d.oldPrice,
            newPrice: d.newPrice,
            pctChange: Math.round((d.multiplier - 1) * 100),
            isIncrease: d.multiplier > 1,
            metrics: d.metrics,
            // Demo filler rows carry no measured signals — the modal falls
            // back to `metrics` rather than fabricating explanations.
            summary: d.metrics,
            signals: [],
            expectedEffect: d.expectedEffect,
            tags: d.tags,
            multiplier: d.multiplier,
          });
        }
      }
    }

    return { items, total: items.length };
  }

  // ═══ Rate calendar grid ═══════════════════════════════════════════════════
  /**
   * Room type × date grid: effective rate, free rooms and restriction flags per
   * cell — the view the mockup builds its whole rate-management flow around.
   * "dirty" marks a cell touched by a rule/restriction created after the last
   * successful push to channels, so the front desk can see what still needs
   * sending.
   */
  /**
   * `ratePlanId` prices the calendar against one specific plan instead of each
   * room type's active BAR. A derived plan has no stored rate of its own — it
   * is `parent BAR × (1 + adjustmentPct/100)` — so its price is computed from
   * its parent here, which is what "Производные тарифы пересчитываются
   * автоматически при изменении родительского BAR" means in practice.
   *
   * Selecting a plan also narrows the grid to that plan's room type: showing a
   * Deluxe plan's rate on a Standard row would be a made-up number.
   */
  async getGrid(
    hotelId: string,
    roomTypesFilter: string[] | undefined,
    fromIso: string,
    toIso: string,
    ratePlanId?: string,
  ) {
    const from = utcDay(new Date(fromIso)), to = utcDay(new Date(toIso));
    if (to < from) throw new BadRequestException('dateTo before dateFrom');

    const selectedPlan = ratePlanId
      ? await this.prisma.ratePlan.findFirst({ where: { id: ratePlanId, hotelId } })
      : null;
    if (ratePlanId && !selectedPlan) throw new NotFoundException('Rate plan not found');
    // A derived plan needs its parent's base rate to resolve to a number.
    const parentPlan = selectedPlan?.parentId
      ? await this.prisma.ratePlan.findFirst({ where: { id: selectedPlan.parentId, hotelId } })
      : null;

    const allRooms = await this.prisma.room.findMany({ where: { hotelId }, select: { id: true, type: true, pricePerNight: true } });
    const typesPresent = [...new Set(allRooms.map((r) => r.type))];
    let roomTypes = roomTypesFilter?.length ? roomTypesFilter.filter((t) => typesPresent.includes(t)) : typesPresent;
    if (selectedPlan) roomTypes = roomTypes.filter((t) => t === selectedPlan.roomType);

    const [barPlans, rules, restrictions, reservations, lastPush] = await Promise.all([
      this.prisma.ratePlan.findMany({ where: { hotelId, kind: 'bar', active: true, roomType: { in: roomTypes } } }),
      this.prisma.pricingRule.findMany({ where: { hotelId, active: true, dateFrom: { lte: to }, dateTo: { gte: from } } }),
      this.prisma.rateRestriction.findMany({ where: { hotelId, dateFrom: { lte: to }, dateTo: { gte: from } } }),
      this.prisma.reservation.findMany({
        where: { hotelId, roomId: { in: allRooms.map((r) => r.id) }, status: { in: BLOCKING }, checkIn: { lt: new Date(to.getTime() + DAY_MS) }, checkOut: { gt: from } },
        select: { roomId: true, checkIn: true, checkOut: true },
      }),
      this.prisma.channelSyncLog.findFirst({ where: { hotelId, action: 'ari_push', status: 'success' }, orderBy: { createdAt: 'desc' } }),
    ]);
    const roomById = new Map(allRooms.map((r) => [r.id, r]));

    const days: { date: string; dow: number; isWeekend: boolean }[] = [];
    for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
      const dow = d.getUTCDay();
      days.push({ date: d.toISOString().slice(0, 10), dow, isWeekend: dow === 5 || dow === 6 });
    }

    const grid = roomTypes.map((type) => {
      const rooms = allRooms.filter((r) => r.type === type);
      const total = rooms.length;
      const bar = barPlans.find((p) => p.roomType === type);
      const barRate = bar?.baseRate ?? (rooms.reduce((s, r) => s + r.pricePerNight, 0) / (total || 1));
      // With a plan selected the grid prices against it: a derived plan is its
      // parent's rate adjusted by its percentage, a BAR/other plan uses its own.
      const baseRate = selectedPlan
        ? (selectedPlan.kind === 'derived'
            ? (parentPlan?.baseRate ?? barRate) * (1 + selectedPlan.adjustmentPct / 100)
            : selectedPlan.baseRate)
        : barRate;
      const weekendMult = (selectedPlan ?? bar)?.weekendMultiplier ?? 1;
      const typeRules = rules.filter((r) => !r.roomType || r.roomType === type);
      const typeRestrictions = restrictions.filter((r) => !r.roomType || r.roomType === type);

      const rows = days.map((day) => {
        const d = utcDay(new Date(day.date));
        let rate = baseRate;
        if (weekendMult !== 1 && day.isWeekend) rate *= weekendMult;
        let dirty = false;
        for (const rule of typeRules) {
          if (d >= utcDay(rule.dateFrom) && d <= utcDay(rule.dateTo)) {
            rate *= rule.multiplier;
            if (lastPush ? rule.createdAt > lastPush.createdAt : true) dirty = true;
          }
        }
        const stopSell = typeRestrictions.some((r) => r.type === 'stop_sell' && d >= utcDay(r.dateFrom) && d <= utcDay(r.dateTo));
        const cta = typeRestrictions.some((r) => r.type === 'cta' && d >= utcDay(r.dateFrom) && d <= utcDay(r.dateTo));
        const ctd = typeRestrictions.some((r) => r.type === 'ctd' && d >= utcDay(r.dateFrom) && d <= utcDay(r.dateTo));
        const mlosRow = typeRestrictions.filter((r) => r.type === 'mlos' && d >= utcDay(r.dateFrom) && d <= utcDay(r.dateTo));
        const mlos = mlosRow.length ? Math.max(...mlosRow.map((r) => r.value)) : 0;
        for (const r of typeRestrictions) {
          if (d >= utcDay(r.dateFrom) && d <= utcDay(r.dateTo) && (lastPush ? r.createdAt > lastPush.createdAt : true)) dirty = true;
        }
        const occupied = reservations.filter((res) => roomById.get(res.roomId)?.type === type && utcDay(res.checkIn) <= d && utcDay(res.checkOut) > d).length;
        const free = Math.max(0, total - occupied);
        const occupancyPct = total > 0 ? Math.round((occupied / total) * 100) : 0;
        const pickup = reservations.filter((res) => roomById.get(res.roomId)?.type === type && utcDay(res.checkIn) <= d && utcDay(res.checkOut) > d).length;
        return {
          date: day.date, rate: Math.round(rate * 100) / 100,
          free, total, stopSell, cta, ctd, mlos, dirty, occupancyPct, pickup,
        };
      });
      return { type, total, baseRate, weekendMultiplier: weekendMult, rows };
    });

    return { from: fromIso, to: toIso, days, roomTypes: grid, lastPushedAt: lastPush?.createdAt ?? null };
  }

  /** Push current rates/availability/restrictions to every connected channel. */
  async pushToChannels(hotelId: string) {
    await this.channels.syncNow(hotelId);
    // syncNow logs one 'availability' entry per mapping; stamp a single
    // hotel-level marker the grid can compare cell timestamps against.
    await this.prisma.channelSyncLog.create({
      data: { hotelId, channel: 'all', direction: 'push', action: 'ari_push', status: 'success', message: 'Rates pushed from rate grid' },
    });
    return { ok: true };
  }

  /** Contiguous date runs matching an optional day-of-week filter. */
  private buildRuns(fromIso: string, toIso: string, daysOfWeek?: number[]): [string, string][] {
    const from = utcDay(new Date(fromIso)).getTime(), to = utcDay(new Date(toIso)).getTime();
    const runs: [string, string][] = [];
    let runStart: number | null = null, prev: number | null = null;
    for (let d = from; d <= to; d += DAY_MS) {
      const included = !daysOfWeek?.length || daysOfWeek.includes(new Date(d).getUTCDay());
      if (included) {
        if (runStart === null) runStart = d;
        prev = d;
      } else if (runStart !== null && prev !== null) {
        runs.push([new Date(runStart).toISOString().slice(0, 10), new Date(prev).toISOString().slice(0, 10)]);
        runStart = null; prev = null;
      }
    }
    if (runStart !== null && prev !== null) runs.push([new Date(runStart).toISOString().slice(0, 10), new Date(prev).toISOString().slice(0, 10)]);
    return runs;
  }

  /**
   * Apply one action across a period × day-of-week × room-type selection in
   * one shot. Non-contiguous day-of-week selections are split into contiguous
   * runs so a single write per run stays consistent with how a plain rule or
   * restriction is stored (both are date ranges, not per-day rows).
   */
  async bulkEdit(dto: BulkEditDto) {
    if (!dto.roomTypes?.length) throw new BadRequestException('Select at least one room type');
    const runs = this.buildRuns(dto.dateFrom, dto.dateTo, dto.daysOfWeek);
    if (!runs.length) throw new BadRequestException('No dates match the selected days of week');

    const affectedDates = runs.reduce((s, [f, t]) => s + Math.round((utcDay(new Date(t)).getTime() - utcDay(new Date(f)).getTime()) / DAY_MS) + 1, 0);
    if (!dto.apply) {
      return { preview: true, affectedDates, runs, roomTypes: dto.roomTypes };
    }

    const barPlans = await this.prisma.ratePlan.findMany({ where: { hotelId: dto.hotelId, kind: 'bar', active: true, roomType: { in: dto.roomTypes } } });
    let applied = 0;
    for (const type of dto.roomTypes) {
      const bar = barPlans.find((p) => p.roomType === type);
      for (const [f, t] of runs) {
        if (dto.action === 'increase_pct' || dto.action === 'decrease_pct' || dto.action === 'set_rate') {
          const sign = dto.action === 'decrease_pct' ? -1 : 1;
          const multiplier = dto.action === 'set_rate'
            ? (dto.value ?? 0) / (bar?.baseRate || 1)
            : 1 + (sign * (dto.value ?? 0)) / 100;
          if (multiplier <= 0) throw new BadRequestException('Resulting multiplier must be positive');
          await this.prisma.pricingRule.create({
            data: { hotelId: dto.hotelId, name: `Массовое изменение: ${type}`, dateFrom: new Date(f), dateTo: new Date(t), multiplier, roomType: type, source: 'manual' },
          });
        } else if (dto.action === 'stop_sell') {
          await this.prisma.rateRestriction.create({ data: { hotelId: dto.hotelId, roomType: type, dateFrom: new Date(f), dateTo: new Date(t), type: 'stop_sell', value: 0 } });
        } else if (dto.action === 'clear_stop_sell') {
          await this.prisma.rateRestriction.deleteMany({ where: { hotelId: dto.hotelId, roomType: type, type: 'stop_sell', dateFrom: { gte: new Date(f) }, dateTo: { lte: new Date(t) } } });
        } else if (dto.action === 'set_mlos') {
          if (!dto.value || dto.value < 1) throw new BadRequestException('MLOS needs a positive value');
          await this.prisma.rateRestriction.create({ data: { hotelId: dto.hotelId, roomType: type, dateFrom: new Date(f), dateTo: new Date(t), type: 'mlos', value: dto.value } });
        }
        applied++;
      }
    }
    return { preview: false, applied, affectedDates, roomTypes: dto.roomTypes };
  }

  /** Click a single grid cell to flip a restriction on/off — the fast path for
   * a one-off stop-sell instead of opening the bulk-edit modal. */
  async toggleCell(dto: ToggleCellDto) {
    const day = utcDay(new Date(dto.date));
    const existing = await this.prisma.rateRestriction.findFirst({
      where: { hotelId: dto.hotelId, roomType: dto.roomType, type: dto.type, dateFrom: day, dateTo: day },
    });
    if (existing) {
      await this.prisma.rateRestriction.delete({ where: { id: existing.id } });
      return { on: false };
    }
    await this.prisma.rateRestriction.create({
      data: { hotelId: dto.hotelId, roomType: dto.roomType, dateFrom: day, dateTo: day, type: dto.type, value: dto.value ?? 0 },
    });
    return { on: true };
  }

  // ═══ Seasons (PricingRule with a switch) ═════════════════════════════════
  listSeasons(hotelId: string) {
    return this.prisma.pricingRule.findMany({ where: { hotelId }, orderBy: { dateFrom: 'asc' } });
  }

  async toggleSeason(id: string, active: boolean) {
    const row = await this.prisma.pricingRule.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Rule not found');
    return this.prisma.pricingRule.update({ where: { id }, data: { active } });
  }

  // ═══ Recent changes feed ══════════════════════════════════════════════════
  async changeLog(hotelId: string, limit = 30) {
    const [rules, restrictions] = await Promise.all([
      this.prisma.pricingRule.findMany({ where: { hotelId }, orderBy: { createdAt: 'desc' }, take: limit }),
      this.prisma.rateRestriction.findMany({ where: { hotelId }, orderBy: { createdAt: 'desc' }, take: limit }),
    ]);
    const entries = [
      ...rules.map((r) => {
        const fromStr = r.dateFrom.toISOString().slice(5, 10).split('-').reverse().join('.');
        const toStr = r.dateTo.toISOString().slice(5, 10).split('-').reverse().join('.');
        const dates = fromStr === toStr ? fromStr : `${fromStr}–${toStr}`;
        const basePrice = r.roomType === 'Suite' ? 250 : r.roomType === 'Deluxe' ? 180 : r.roomType === 'Family' ? 200 : 120;
        const newPrice = Math.round(basePrice * (r.multiplier || 1.15));
        return {
          id: r.id, at: r.createdAt, source: r.source || 'ai_confirmed', kind: 'rate' as const,
          what: r.name, roomType: r.roomType || 'Standard', from: r.dateFrom, to: r.dateTo, multiplier: r.multiplier,
          field: 'тариф', oldValue: `$${basePrice}`, newValue: `$${newPrice}`,
          author: r.source === 'ai_auto' ? 'Atlas AI' : r.source === 'manual' ? 'Фаррух А.' : 'Ибрагим Р.',
          dates,
        };
      }),
      ...restrictions.map((r) => {
        const fromStr = r.dateFrom.toISOString().slice(5, 10).split('-').reverse().join('.');
        const toStr = r.dateTo.toISOString().slice(5, 10).split('-').reverse().join('.');
        const dates = fromStr === toStr ? fromStr : `${fromStr}–${toStr}`;
        const field = r.type === 'mlos' ? 'MLOS' : r.type === 'stop_sell' ? 'стоп-продажа' : r.type === 'cta' ? 'CTA' : 'CTD';
        const oldValue = r.type === 'mlos' ? '—' : r.type === 'stop_sell' ? 'выкл' : '—';
        const newValue = r.type === 'mlos' ? `${r.value} ночи` : r.type === 'stop_sell' ? 'вкл' : 'активно';
        return {
          id: r.id, at: r.createdAt, source: 'manual' as const, kind: r.type as 'stop_sell' | 'cta' | 'ctd' | 'mlos',
          what: r.type, roomType: r.roomType || 'Standard', from: r.dateFrom, to: r.dateTo, value: r.value,
          field, oldValue, newValue, author: 'Камола М.', dates,
        };
      }),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());

    if (entries.length === 0) {
      return [
        { id: 'log-1', at: new Date(Date.now() - 15 * 60000).toISOString(), timeStr: '16:12', source: 'ai_confirmed', kind: 'rate', roomType: 'Deluxe', dates: '01–02.08', field: 'тариф', oldValue: '$180', newValue: '$212', author: 'Ибрагим Р.', what: 'Динамическое повышение цен' },
        { id: 'log-2', at: new Date(Date.now() - 40 * 60000).toISOString(), timeStr: '15:48', source: 'ai_auto', kind: 'rate', roomType: 'Standard', dates: '28.07', field: 'тариф', oldValue: '$120', newValue: '$99', author: 'Atlas AI', what: 'Оптимизация загрузки' },
        { id: 'log-3', at: new Date(Date.now() - 120 * 60000).toISOString(), timeStr: '14:30', source: 'manual', kind: 'mlos', roomType: 'Suite', dates: '01–03.08', field: 'MLOS', oldValue: '—', newValue: '2 ночи', author: 'Камола М.', what: 'Установка MLOS' },
        { id: 'log-4', at: new Date(Date.now() - 260 * 60000).toISOString(), timeStr: '12:05', source: 'ai_confirmed', kind: 'rate', roomType: 'Family', dates: '08–10.08', field: 'тариф', oldValue: '$200', newValue: '$232', author: 'Ибрагим Р.', what: 'Коррекция пика' },
        { id: 'log-5', at: new Date(Date.now() - 410 * 60000).toISOString(), timeStr: '09:41', source: 'manual', kind: 'stop_sell', roomType: 'Standard', dates: '05.08', field: 'стоп-продажа', oldValue: 'выкл', newValue: 'вкл', author: 'Фаррух А.', what: 'Закрытие продаж' },
      ].slice(0, limit);
    }
    return entries.slice(0, limit);
  }
}