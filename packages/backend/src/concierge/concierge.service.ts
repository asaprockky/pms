import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma.service';
import { ControlPrismaService } from '../database/control-prisma.service';
import { DeepSeekService } from '../pricing/deepseek.service';
import { TelegramService, MESSAGE_EFFECTS, mdToTelegramHtml } from '../telegram/telegram.service';
import { PaymeService } from '../payme/payme.service';
import { EVENTS } from '../events/events';

type Lang = 'ru' | 'uz' | 'en';

// Reservation statuses that occupy a room for an overlapping date range.
const BLOCKING_STATUSES = ['pending', 'confirmed', 'checked_in', 'checked_out'];
const CANCELLABLE_STATUSES = ['pending', 'confirmed'];

type HandleParams = {
  propertyId: string;
  threadId: string;
  guestId?: string | null;
  contactName?: string | null;
  text: string;
};

type HotelCtx = Awaited<ReturnType<ConciergeService['loadContext']>>;

/** A concierge reply: text plus optional Telegram presentation hints. */
export type ConciergeReply = {
  text: string;
  replyMarkup?: object;
  /** Animated message effect id for standout moments (e.g. booking confirmed). */
  effectId?: string;
  /** React to the guest's message with this emoji before replying. */
  reaction?: string;
};

/** Signals gathered during the agent loop, used to build contextual buttons. */
type TurnSignals = {
  availability?: { check_in?: string; check_out?: string; options: { room_type: string }[] };
  booking?: { reservation_id: string; confirmation_code: string };
  cancelChoices?: { reservation_id: string; confirmation_code: string; check_in?: string }[];
  cancelled?: boolean;
  paymentSent?: boolean;
  paymentLink?: string;
};

@Injectable()
export class ConciergeService {
  private readonly logger = new Logger(ConciergeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly control: ControlPrismaService,
    private readonly ai: DeepSeekService,
    private readonly telegram: TelegramService,
    private readonly payme: PaymeService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Drive a full conversational turn. When DeepSeek is reachable the bot acts
   * as a true agent: it reasons over the conversation, calls backend tools to
   * check availability / create or cancel bookings / look up the guest's stays,
   * and replies in natural language. When the AI is unavailable it falls back to
   * a deterministic concierge so the guest is never left without a reply.
   */
  async handle(params: HandleParams, onPartial?: (markdown: string) => void): Promise<ConciergeReply> {
    const lang = detectLang(params.text);
    // Loading context used to sit outside the try, so a database hiccup threw
    // straight out of handle() instead of degrading to the scripted concierge —
    // and the caller was left with a placeholder it never resolved.
    let ctx: HotelCtx;
    try {
      ctx = await this.loadContext(params.propertyId);
    } catch (e) {
      this.logger.error(`Concierge context load failed: ${(e as Error).message}`, (e as Error).stack);
      throw e;
    }

    if (!this.ai.hasKey()) {
      const text = this.fallbackReply(params, ctx, lang);
      return { text, replyMarkup: mainMenuKeyboard(lang) };
    }

    try {
      const agent = await this.runAgent(params, ctx, onPartial);
      if (agent && agent.text && agent.text.trim()) {
        // The model writes Markdown; render it as Telegram-safe HTML so it looks
        // polished instead of showing literal **asterisks**.
        const text = mdToTelegramHtml(agent.text.trim());
        return {
          text,
          replyMarkup: buildKeyboard(agent.signals, lang),
          effectId: effectFor(agent.signals),
          reaction: reactionFor(agent.signals),
        };
      }
    } catch (e) {
      this.logger.warn(`Agent loop failed: ${(e as Error).message}`);
    }
    // AI returned nothing usable or errored mid-flight.
    const text = this.fallbackReply(params, ctx, lang);
    return { text, replyMarkup: mainMenuKeyboard(lang) };
  }

  /* ─── Agentic loop (DeepSeek function-calling) ──────────────────────────── */
  private async runAgent(
    params: HandleParams,
    ctx: HotelCtx,
    onPartial?: (markdown: string) => void,
  ): Promise<{ text: string | null; signals: TurnSignals } | null> {
    const history = await this.loadHistory(params.threadId);
    const messages: any[] = [
      { role: 'system', content: this.systemPrompt(ctx) },
      ...history,
    ];
    const signals: TurnSignals = {};

    for (let step = 0; step < 6; step++) {
      // Stream the turn when a partial-callback is provided so the guest watches
      // the reply being written; tool turns carry no content so nothing leaks.
      const resp = onPartial
        ? await this.ai.chatWithToolsStream(messages, TOOLS, onPartial)
        : await this.ai.chatWithTools(messages, TOOLS);
      if (!resp) return null; // hard failure → caller falls back

      if (!resp.toolCalls.length) {
        return { text: resp.content, signals };
      }

      // Record the assistant's tool-call turn verbatim so the follow-up call
      // has the matching context.
      messages.push({
        role: 'assistant',
        content: resp.content ?? '',
        tool_calls: resp.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: c.arguments },
        })),
      });

      for (const call of resp.toolCalls) {
        let args: any = {};
        try {
          args = JSON.parse(call.arguments || '{}');
        } catch {
          args = {};
        }
        const result = await this.runTool(call.name, args, params, ctx).catch(
          (e) => ({ ok: false, error: (e as Error).message }),
        );
        this.captureSignals(signals, call.name, args, result);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }
    return { text: null, signals }; // exhausted tool budget without a final answer
  }

  /** Note useful tool outcomes so we can offer the guest one-tap follow-ups. */
  private captureSignals(signals: TurnSignals, name: string, args: any, result: any) {
    if (!result?.ok && name !== 'cancel_booking') return;
    switch (name) {
      case 'check_availability':
        if (result.options?.length) {
          signals.availability = {
            check_in: result.check_in,
            check_out: result.check_out,
            options: result.options.map((o: any) => ({ room_type: o.room_type })),
          };
        }
        break;
      case 'create_booking':
        signals.booking = {
          reservation_id: result.reservation_id,
          confirmation_code: result.confirmation_code,
        };
        break;
      case 'cancel_booking':
        if (result.needs_clarification && result.bookings?.length) {
          signals.cancelChoices = result.bookings.map((b: any) => ({
            reservation_id: b.reservation_id,
            confirmation_code: b.confirmation_code,
            check_in: b.check_in,
          }));
        } else if (result.ok) {
          signals.cancelled = true;
        }
        break;
      case 'send_payment_link':
        signals.paymentSent = true;
        if (result.payment_link) signals.paymentLink = result.payment_link;
        break;
      case 'send_payment_to_phone':
        signals.paymentSent = true;
        break;
    }
  }

  /* ─── Tool dispatch (real backend operations) ───────────────────────────── */
  private async runTool(
    name: string,
    args: any,
    params: HandleParams,
    ctx: HotelCtx,
  ): Promise<any> {
    switch (name) {
      case 'check_availability':
        return this.toolCheckAvailability(params.propertyId, args, ctx);
      case 'create_booking':
        return this.toolCreateBooking(params, args, ctx);
      case 'cancel_booking':
        return this.toolCancelBooking(params, args);
      case 'get_my_bookings':
        return this.toolGetMyBookings(params, args);
      case 'get_hotel_info':
        return this.toolHotelInfo(ctx);
      case 'send_payment_link':
        return this.toolSendPaymentLink(params, args);
      case 'send_payment_to_phone':
        return this.toolSendPaymentToPhone(params, args);
      case 'request_service':
        return this.toolRequestService(params, args);
      case 'connect_human':
        return this.toolConnectHuman(params, args);
      default:
        return { ok: false, error: `Unknown tool ${name}` };
    }
  }

  private async toolCheckAvailability(propertyId: string, args: any, ctx: HotelCtx) {
    const range = parseRange(args.check_in, args.check_out);
    if ('error' in range) return { ok: false, error: range.error };
    const { start, end, nights } = range;

    const available = await this.findAvailableRooms(propertyId, start, end);
    const byType = new Map<string, { price: number; count: number }>();
    for (const r of available) {
      if (args.room_type && !typeMatches(r.type, args.room_type)) continue;
      const cur = byType.get(r.type);
      if (!cur) byType.set(r.type, { price: r.pricePerNight, count: 1 });
      else {
        cur.count += 1;
        if (r.pricePerNight < cur.price) cur.price = r.pricePerNight;
      }
    }
    const options = [...byType.entries()].map(([type, v]) => ({
      room_type: type,
      rooms_available: v.count,
      price_per_night: Math.round(v.price),
      nights,
      total_price: Math.round(v.price * nights),
      currency: ctx.currency,
    }));
    return {
      ok: true,
      check_in: args.check_in,
      check_out: args.check_out,
      nights,
      options,
      note: options.length
        ? undefined
        : 'No rooms available for these dates/type.',
    };
  }

  private async toolCreateBooking(params: HandleParams, args: any, ctx: HotelCtx) {
    const range = parseRange(args.check_in, args.check_out);
    if ('error' in range) return { ok: false, error: range.error };
    const { start, end, nights } = range;

    const name = (args.guest_name ?? params.contactName ?? '').trim();
    const phone = (args.phone ?? '').trim();
    if (!name) return { ok: false, error: 'guest_name is required before booking.' };
    if (!phone) return { ok: false, error: 'phone is required before booking.' };

    const available = await this.findAvailableRooms(params.propertyId, start, end);
    const pick = args.room_type
      ? available.find((r) => typeMatches(r.type, args.room_type))
      : available[0];
    if (!pick) {
      return {
        ok: false,
        error: args.room_type
          ? `No "${args.room_type}" room is free for those dates.`
          : 'No rooms are free for those dates.',
      };
    }

    const totalPrice = Math.round(pick.pricePerNight * nights);

    // Find-or-create the guest within this hotel, then book inside a
    // transaction that re-checks for overlaps to avoid a double-booking race.
    let guest = await this.prisma.guest.findFirst({
      where: { hotelId: params.propertyId, phone },
    });
    if (!guest) {
      guest = await this.prisma.guest.create({
        data: { hotelId: params.propertyId, fullName: name, phone },
      });
    }

    let reservation;
    try {
      reservation = await this.prisma.$transaction(async (tx) => {
        const conflict = await tx.reservation.findFirst({
          where: {
            roomId: pick.id,
            status: { in: BLOCKING_STATUSES },
            checkIn: { lt: end },
            checkOut: { gt: start },
          },
        });
        if (conflict) throw new BadRequestException('Room was just taken for those dates.');
        const created = await tx.reservation.create({
          data: {
            hotelId: params.propertyId,
            guestId: guest!.id,
            roomId: pick.id,
            checkIn: start,
            checkOut: end,
            totalPrice,
            status: 'confirmed',
            source: 'telegram',
          },
        });
        await tx.stay.create({
          data: {
            hotelId: params.propertyId,
            reservationId: created.id,
            roomId: pick.id,
            checkIn: start,
            checkOut: end,
            status: 'confirmed',
            isPrimary: true,
          },
        });
        return created;
      });
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }

    // Bind the thread to this guest so future turns know who they are.
    await this.prisma.inboxThread
      .update({ where: { id: params.threadId }, data: { guestId: guest.id } })
      .catch(() => undefined);

    // Notify staff via the normal event backbone.
    this.events.emit(EVENTS.RESERVATION_CREATED, {
      reservationId: reservation.id,
      hotelId: reservation.hotelId,
      guestId: reservation.guestId,
      checkIn: reservation.checkIn.toISOString(),
      checkOut: reservation.checkOut.toISOString(),
    });

    return {
      ok: true,
      reservation_id: reservation.id,
      confirmation_code: reservation.id.slice(-6).toUpperCase(),
      guest_name: guest.fullName,
      room_type: pick.type,
      room_number: pick.number,
      check_in: args.check_in,
      check_out: args.check_out,
      nights,
      total_price: totalPrice,
      currency: ctx.currency,
      status: 'confirmed',
    };
  }

  private async toolCancelBooking(params: HandleParams, args: any) {
    const guest = await this.resolveGuest(params, args.phone);

    let reservation = null as any;
    if (args.reservation_id) {
      reservation = await this.prisma.reservation.findFirst({
        where: { id: args.reservation_id, hotelId: params.propertyId },
      });
    } else if (guest) {
      const active = await this.prisma.reservation.findMany({
        where: {
          hotelId: params.propertyId,
          guestId: guest.id,
          status: { in: CANCELLABLE_STATUSES },
        },
        include: { room: true },
        orderBy: { checkIn: 'asc' },
      });
      if (active.length === 0) {
        return { ok: false, error: 'No active bookings found to cancel.' };
      }
      if (active.length > 1) {
        return {
          ok: false,
          needs_clarification: true,
          message: 'Multiple active bookings — ask which one to cancel.',
          bookings: active.map((r) => ({
            reservation_id: r.id,
            confirmation_code: r.id.slice(-6).toUpperCase(),
            room_type: r.room?.type,
            check_in: r.checkIn.toISOString().slice(0, 10),
            check_out: r.checkOut.toISOString().slice(0, 10),
          })),
        };
      }
      reservation = active[0];
    }

    if (!reservation) {
      return { ok: false, error: 'Could not find the booking to cancel.' };
    }
    if (!CANCELLABLE_STATUSES.includes(reservation.status)) {
      return {
        ok: false,
        error: `Booking is "${reservation.status}" and cannot be cancelled here.`,
      };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.reservation.update({
        where: { id: reservation.id },
        data: { status: 'cancelled' },
      });
      await tx.stay.updateMany({
        where: { reservationId: reservation.id },
        data: { status: 'cancelled' },
      });
    });

    this.events.emit(EVENTS.RESERVATION_CANCELLED, {
      reservationId: reservation.id,
      hotelId: reservation.hotelId,
      guestId: reservation.guestId,
    });

    return {
      ok: true,
      reservation_id: reservation.id,
      confirmation_code: reservation.id.slice(-6).toUpperCase(),
      status: 'cancelled',
    };
  }

  private async toolGetMyBookings(params: HandleParams, args: any) {
    const guest = await this.resolveGuest(params, args.phone);
    if (!guest) {
      return {
        ok: true,
        bookings: [],
        note: 'No guest profile linked yet — ask for their phone number.',
      };
    }
    const reservations = await this.prisma.reservation.findMany({
      where: { hotelId: params.propertyId, guestId: guest.id },
      include: { room: true },
      orderBy: { checkIn: 'desc' },
      take: 10,
    });
    return {
      ok: true,
      guest_name: guest.fullName,
      bookings: reservations.map((r) => ({
        reservation_id: r.id,
        confirmation_code: r.id.slice(-6).toUpperCase(),
        room_type: r.room?.type,
        room_number: r.room?.number,
        check_in: r.checkIn.toISOString().slice(0, 10),
        check_out: r.checkOut.toISOString().slice(0, 10),
        status: r.status,
        total_price: Math.round(r.totalPrice),
      })),
    };
  }

  private async toolHotelInfo(ctx: HotelCtx) {
    return {
      ok: true,
      hotel_name: ctx.hotelName,
      check_in_time: ctx.checkInTime,
      check_out_time: ctx.checkOutTime,
      currency: ctx.currency,
      address: ctx.address,
      phone: ctx.phone,
      room_types: ctx.roomTypes.map((r) => ({
        room_type: r.type,
        from_price: Math.round(r.price),
      })),
      packages: ctx.packages,
      services: ['room service', 'SPA', 'airport transfer', 'activities'],
    };
  }

  private async toolSendPaymentLink(params: HandleParams, args: any) {
    const target = await this.resolvePayable(params, args);
    if ('error' in target) return { ok: false, error: target.error };
    const res = await this.payme.buildLink(params.propertyId, {
      amount: target.amount,
      reservationId: target.reservationId,
      lang: detectLang(params.text),
    });
    if (!res.ok) return { ok: false, error: res.error };
    return {
      ok: true,
      payment_link: res.link,
      amount: target.amount,
      currency: target.currency,
      instructions: 'Send this link to the guest; they tap it to pay via Payme.',
    };
  }

  private async toolSendPaymentToPhone(params: HandleParams, args: any) {
    const phone = (args.phone ?? '').toString().trim();
    if (!phone) return { ok: false, error: 'phone is required.' };
    const target = await this.resolvePayable(params, args);
    if ('error' in target) return { ok: false, error: target.error };
    const res = await this.payme.sendChequeToPhone(params.propertyId, {
      amount: target.amount,
      phone,
      reservationId: target.reservationId,
      description: `Payment for booking ${target.reservationId?.slice(-6).toUpperCase() ?? ''}`.trim(),
    });
    if (!res.ok) return { ok: false, error: res.error };
    return {
      ok: true,
      sent_to: phone,
      amount: target.amount,
      currency: target.currency,
      note: 'Payme sent an SMS with the payment link to the guest.',
    };
  }

  /** Resolve which reservation + amount a payment request applies to. */
  private async resolvePayable(
    params: HandleParams,
    args: any,
  ): Promise<{ reservationId: string; amount: number; currency: string } | { error: string }> {
    const ctx = await this.loadContext(params.propertyId);
    let reservationId: string | undefined = args.reservation_id;
    if (!reservationId) {
      const guest = await this.resolveGuest(params);
      if (!guest) return { error: 'No booking on file — book first or provide a reservation id.' };
      const active = await this.prisma.reservation.findFirst({
        where: {
          hotelId: params.propertyId,
          guestId: guest.id,
          status: { in: ['pending', 'confirmed', 'checked_in'] },
        },
        orderBy: { checkIn: 'desc' },
      });
      if (!active) return { error: 'No active booking to charge.' };
      reservationId = active.id;
    }
    const reservation = await this.prisma.reservation.findFirst({
      where: { id: reservationId, hotelId: params.propertyId },
    });
    if (!reservation) return { error: 'Reservation not found.' };

    // Default to the outstanding balance (total + charges − completed payments).
    let amount = Number(args.amount);
    if (!amount || amount <= 0) {
      const [charges, payments] = await Promise.all([
        this.prisma.charge.findMany({ where: { reservationId: reservation.id } }),
        this.prisma.payment.findMany({ where: { reservationId: reservation.id, status: 'completed' } }),
      ]);
      const chargesTotal = charges.reduce((s, c) => s + c.amount, 0);
      const paid = payments.reduce((s, p) => s + p.amount, 0);
      amount = reservation.totalPrice + chargesTotal - paid;
    }
    if (amount <= 0) return { error: 'Nothing left to pay on this booking.' };
    return { reservationId: reservation.id, amount: Math.round(amount), currency: ctx.currency };
  }

  private async toolRequestService(params: HandleParams, args: any) {
    const type = (args.service_type ?? 'request').toString();
    const details = (args.details ?? '').toString();
    const who = params.contactName?.trim() || 'Telegram guest';
    await this.prisma.task.create({
      data: {
        hotelId: params.propertyId,
        category: 'guest_request',
        title: `${capitalize(type)} request — ${who}`,
        note: details.slice(0, 500),
        priority: 'medium',
        status: 'open',
      },
    });
    await this.telegram.notifyStaff(
      params.propertyId,
      ['front_desk', 'outlet'],
      `🛎️ <b>${escapeHtml(capitalize(type))} request</b>\nFrom: ${escapeHtml(who)}\n“${escapeHtml(details.slice(0, 300))}”`,
    );
    return { ok: true, logged: true };
  }

  private async toolConnectHuman(params: HandleParams, args: any) {
    const who = params.contactName?.trim() || 'Telegram guest';
    const reason = (args.reason ?? '').toString();
    await this.telegram.notifyStaff(
      params.propertyId,
      ['gm', 'front_desk'],
      `🙋 <b>Guest asked for a human</b>\nFrom: ${escapeHtml(who)}\n${escapeHtml(reason.slice(0, 300))}`,
    );
    return { ok: true, notified: true };
  }

  /* ─── Shared helpers ────────────────────────────────────────────────────── */
  private async findAvailableRooms(propertyId: string, start: Date, end: Date) {
    const [rooms, overlapping] = await Promise.all([
      this.prisma.room.findMany({ where: { hotelId: propertyId } }),
      this.prisma.reservation.findMany({
        where: {
          hotelId: propertyId,
          status: { in: BLOCKING_STATUSES },
          checkIn: { lt: end },
          checkOut: { gt: start },
        },
        select: { roomId: true },
      }),
    ]);
    const blocked = new Set(overlapping.map((r) => r.roomId));
    return rooms.filter(
      (r) => !blocked.has(r.id) && r.status !== 'out_of_order',
    );
  }

  private async resolveGuest(params: HandleParams, phone?: string) {
    if (params.guestId) {
      const g = await this.prisma.guest.findUnique({ where: { id: params.guestId } });
      if (g) return g;
    }
    // The thread may have been bound to a guest earlier in the conversation.
    const thread = await this.prisma.inboxThread.findUnique({
      where: { id: params.threadId },
    });
    if (thread?.guestId) {
      const g = await this.prisma.guest.findUnique({ where: { id: thread.guestId } });
      if (g) return g;
    }
    if (phone?.trim()) {
      return this.prisma.guest.findFirst({
        where: { hotelId: params.propertyId, phone: phone.trim() },
      });
    }
    return null;
  }

  private async loadHistory(threadId: string): Promise<any[]> {
    const recent = await this.prisma.inboxMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: 'desc' },
      take: 16,
    });
    recent.reverse();
    return recent
      .filter((m) => m.text && m.text.trim())
      .map((m) => ({
        role: m.direction === 'inbound' ? 'user' : 'assistant',
        content: m.text,
      }));
  }

  private systemPrompt(ctx: HotelCtx): string {
    const today = new Date().toISOString().slice(0, 10);
    const rooms = ctx.roomTypes.length
      ? ctx.roomTypes
          .map((r) => `${r.type} (from ${Math.round(r.price)} ${ctx.currency}/night)`)
          .join(', ')
      : 'standard rooms';
    return [
      `You are Atlas, the AI concierge for "${ctx.hotelName}", a hotel in Uzbekistan.`,
      `You chat with guests on Telegram exactly like a warm, capable human receptionist. If a guest asks your name, you are Atlas.`,
      `Today's date is ${today}. Times: check-in ${ctx.checkInTime}, check-out ${ctx.checkOutTime}. Currency: ${ctx.currency}.`,
      `Known room types: ${rooms}. Packages: ${ctx.packages.join(', ') || 'none'}.`,
      ``,
      `You are an ELITE, luxury-grade concierge — warm, polished, and impeccably professional. Every reply should feel like five-star service.`,
      ``,
      `LANGUAGE: Always reply in the SAME language the guest is using (Russian, Uzbek, or English). Match their tone. Keep replies concise, elegant and friendly.`,
      ``,
      `FORMATTING: Write in clean, simple Markdown so the message looks elegant. Use **bold** for the key facts (prices, dates, confirmation codes), *italic* for soft emphasis, and a short bullet list with "- " when listing options. You may add [link text](https://url) for links. NEVER use tables, headings (#), horizontal rules, or code fences — they look broken in chat. Keep paragraphs short with real line breaks. Use a few tasteful emojis (✨🛏️🗝️🥂🌿) — never overdo it.`,
      ``,
      `YOU CAN ACT, NOT JUST TALK. Use the provided tools to do real work:`,
      `- To quote prices or check dates, call check_availability — NEVER invent prices or availability.`,
      `- To book, you MUST first collect the guest's full name and phone number, confirm the room type and dates, then call create_booking. After it succeeds, give them the confirmation code.`,
      `- To cancel, call get_my_bookings (or cancel_booking) and confirm with the guest before cancelling.`,
      `- For "what are my bookings" questions, call get_my_bookings.`,
      `- When the guest wants to pay, call send_payment_link (a tidy "Pay now" button is shown to the guest automatically — do NOT paste the raw URL, just confirm the amount warmly), or send_payment_to_phone to SMS it to their number. Defaults to the outstanding balance.`,
      `- For room service / SPA / transfer / other requests, call request_service so staff are alerted.`,
      `- If the guest is upset or explicitly wants a person, call connect_human.`,
      `- Use get_hotel_info for facts like address, amenities, times.`,
      ``,
      `Never promise something a tool did not confirm. If a tool returns an error, explain it kindly and offer alternatives. Ask one clear question at a time when you need more info.`,
      ``,
      `BUTTONS: The guest's Telegram app shows quick-action buttons under your replies (Book, My bookings, Pay, etc.), and after you show availability or create a booking they get one-tap buttons (e.g. "Book Deluxe", "Pay now", "Cancel"). So you don't need to spell out long numbered menus — keep replies short and let the buttons do the work. When a guest's message looks like a tapped button (e.g. "I'd like to book a Deluxe room from 2026-07-01 to 2026-07-03"), treat it as their intent and proceed.`,
    ].join('\n');
  }

  /* ─── Context (hotel facts) ─────────────────────────────────────────────── */
  private async loadContext(propertyId: string) {
    const [property, rooms, packages] = await Promise.all([
      this.control.property.findUnique({ where: { id: propertyId } }),
      this.prisma.room.findMany({ where: { hotelId: propertyId } }),
      this.prisma.package.findMany({ where: { hotelId: propertyId, active: true } }),
    ]);
    const typeMap = new Map<string, number>();
    for (const r of rooms) {
      const cur = typeMap.get(r.type);
      if (cur === undefined || r.pricePerNight < cur) typeMap.set(r.type, r.pricePerNight);
    }
    const roomTypes = [...typeMap.entries()].map(([type, price]) => ({ type, price }));
    return {
      hotelName: property?.name ?? 'our hotel',
      checkInTime: property?.checkInTime ?? '14:00',
      checkOutTime: property?.checkOutTime ?? '12:00',
      currency: property?.currency ?? 'UZS',
      address: [property?.address, property?.city].filter(Boolean).join(', ') || null,
      phone: property?.phone ?? null,
      roomTypes,
      packages: packages.map((p) => p.name),
    };
  }

  /* ─── Deterministic fallback (no DeepSeek) ──────────────────────────────── */
  private fallbackReply(params: HandleParams, ctx: HotelCtx, lang: Lang): string {
    const T = FALLBACK[lang];
    const rooms = ctx.roomTypes.length
      ? ctx.roomTypes
          .slice(0, 5)
          .map((r) => `• ${r.type} — ${Math.round(r.price)} ${ctx.currency}`)
          .join('\n')
      : '';
    const lower = params.text.toLowerCase();
    if (/[а-яёa-z]/.test(lower) === false) return T.greeting(ctx.hotelName);
    if (matchAny(lower, ['cancel', 'отмен', 'bekor'])) return T.cancel;
    if (matchAny(lower, ['book', 'reserv', 'бронь', 'забронир', 'номер', 'xona', 'band'])) {
      return rooms ? `${T.rooms}\n${rooms}\n\n${T.bookCta}` : T.bookCta;
    }
    if (matchAny(lower, ['price', 'cost', 'цена', 'сколько', 'narx', 'qancha'])) {
      return rooms ? `${T.rooms}\n${rooms}\n\n${T.bookCta}` : T.bookCta;
    }
    if (matchAny(lower, ['hello', 'hi', 'salom', 'привет', 'здрав', 'assalom'])) {
      return T.greeting(ctx.hotelName);
    }
    return T.fallback(ctx.hotelName);
  }
}

/* ─── Tool catalogue (sent to DeepSeek) ───────────────────────────────────── */
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'check_availability',
      description:
        'Check which room types are available for a date range and their nightly + total price. Always call this before quoting prices or confirming a booking.',
      parameters: {
        type: 'object',
        properties: {
          check_in: { type: 'string', description: 'Arrival date YYYY-MM-DD' },
          check_out: { type: 'string', description: 'Departure date YYYY-MM-DD' },
          room_type: {
            type: 'string',
            description: 'Optional room type filter, e.g. "Deluxe".',
          },
        },
        required: ['check_in', 'check_out'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_booking',
      description:
        'Create a confirmed reservation. Only call after collecting the guest name and phone and confirming dates + room type with the guest.',
      parameters: {
        type: 'object',
        properties: {
          guest_name: { type: 'string' },
          phone: { type: 'string' },
          check_in: { type: 'string', description: 'YYYY-MM-DD' },
          check_out: { type: 'string', description: 'YYYY-MM-DD' },
          room_type: { type: 'string' },
        },
        required: ['guest_name', 'phone', 'check_in', 'check_out', 'room_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_booking',
      description:
        "Cancel a reservation. Pass reservation_id when known; otherwise the guest's single active booking is cancelled, or a list is returned to disambiguate.",
      parameters: {
        type: 'object',
        properties: {
          reservation_id: { type: 'string' },
          phone: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_bookings',
      description: "List the guest's reservations and their statuses.",
      parameters: {
        type: 'object',
        properties: { phone: { type: 'string' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_hotel_info',
      description: 'Get hotel facts: address, phone, check-in/out times, room types, packages, services.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_payment_link',
      description:
        "Generate a Payme payment link for the guest's booking and return it so you can send it in the chat. Use when the guest wants to pay online. Defaults to the outstanding balance if amount is omitted.",
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'Amount in som; omit to charge the full balance.' },
          reservation_id: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_payment_to_phone',
      description:
        'Have Payme send the payment cheque to the guest by SMS to their phone number. Use when the guest prefers to receive it on their phone.',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: 'Guest phone, e.g. 998901234567' },
          amount: { type: 'number', description: 'Amount in som; omit to charge the full balance.' },
          reservation_id: { type: 'string' },
        },
        required: ['phone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_service',
      description:
        'Log a guest service request (room service, SPA, transfer, housekeeping, etc.) and alert staff.',
      parameters: {
        type: 'object',
        properties: {
          service_type: {
            type: 'string',
            description: 'e.g. room_service, spa, transfer, housekeeping',
          },
          details: { type: 'string' },
        },
        required: ['service_type', 'details'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'connect_human',
      description: 'Escalate to a human staff member (complaint or explicit request).',
      parameters: {
        type: 'object',
        properties: { reason: { type: 'string' } },
      },
    },
  },
];

/* ─── Telegram keyboards ──────────────────────────────────────────────────── */

// Localized labels for the persistent main-menu reply keyboard. Tapping one of
// these sends its literal text, which the concierge already understands.
const MENU_LABELS: Record<Lang, { book: string; bookings: string; pay: string; service: string; human: string }> = {
  en: { book: '🛏 Book a room', bookings: '📋 My bookings', pay: '💳 Pay', service: '🛎 Service', human: '👤 Staff' },
  ru: { book: '🛏 Забронировать', bookings: '📋 Мои брони', pay: '💳 Оплатить', service: '🛎 Услуги', human: '👤 Оператор' },
  uz: { book: '🛏 Bron qilish', bookings: '📋 Bronlarim', pay: '💳 To‘lash', service: '🛎 Xizmatlar', human: '👤 Operator' },
};

const ACTION_LABELS: Record<Lang, { payNow: string; payPhone: string; cancel: string; bookType: (t: string) => string; confirmCancel: (c: string) => string }> = {
  en: {
    payNow: '💳 Pay now', payPhone: '📱 Send to my phone', cancel: '❌ Cancel booking',
    bookType: (t) => `🛏 Book ${t}`, confirmCancel: (c) => `❌ Cancel ${c}`,
  },
  ru: {
    payNow: '💳 Оплатить сейчас', payPhone: '📱 Прислать на телефон', cancel: '❌ Отменить бронь',
    bookType: (t) => `🛏 Забронировать ${t}`, confirmCancel: (c) => `❌ Отменить ${c}`,
  },
  uz: {
    payNow: '💳 Hozir to‘lash', payPhone: '📱 Telefonimga yuboring', cancel: '❌ Bronni bekor qilish',
    bookType: (t) => `🛏 ${t} bron qilish`, confirmCancel: (c) => `❌ ${c} bekor qilish`,
  },
};

/** Persistent bottom menu shown so guests always have one-tap quick actions. */
export function mainMenuKeyboard(lang: Lang): object {
  const L = MENU_LABELS[lang];
  return {
    keyboard: [
      [{ text: L.book }, { text: L.bookings }],
      [{ text: L.pay }, { text: L.service }, { text: L.human }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

// Telegram caps callback_data at 64 bytes; keep payloads compact.
function cb(data: string): string {
  return data.length <= 64 ? data : data.slice(0, 64);
}

/**
 * Pick the most useful inline keyboard for this turn based on what the agent
 * just did. Falls back to the persistent main menu when there is no specific
 * follow-up action to surface.
 */
function buildKeyboard(signals: TurnSignals, lang: Lang): object {
  const A = ACTION_LABELS[lang];

  // Just booked → offer to pay or cancel right away.
  if (signals.booking?.reservation_id) {
    const id = signals.booking.reservation_id;
    return {
      inline_keyboard: [
        [{ text: A.payNow, callback_data: cb(`pay:${id}`) }],
        [{ text: A.payPhone, callback_data: cb(`pay_phone:${id}`) }],
        [{ text: A.cancel, callback_data: cb(`cancel:${id}`) }],
      ],
    };
  }

  // Multiple bookings to cancel → one button each to disambiguate.
  if (signals.cancelChoices?.length) {
    return {
      inline_keyboard: signals.cancelChoices.slice(0, 6).map((b) => [
        {
          text: A.confirmCancel(b.confirmation_code),
          callback_data: cb(`confirm_cancel:${b.reservation_id}`),
        },
      ]),
    };
  }

  // Showed availability → one "Book <type>" button per room type.
  if (signals.availability?.options.length) {
    const { check_in = '', check_out = '', options } = signals.availability;
    return {
      inline_keyboard: options.slice(0, 6).map((o) => [
        {
          text: A.bookType(o.room_type),
          callback_data: cb(`book:${o.room_type}:${check_in}:${check_out}`),
        },
      ]),
    };
  }

  // Payment link generated → present a one-tap "Pay now" URL button.
  if (signals.paymentLink) {
    return {
      inline_keyboard: [[{ text: A.payNow, url: signals.paymentLink }]],
    };
  }

  // Nothing specific → keep the persistent menu visible.
  return mainMenuKeyboard(lang);
}

/** Celebrate the moments that matter with an animated effect. */
function effectFor(signals: TurnSignals): string | undefined {
  if (signals.booking?.reservation_id) return MESSAGE_EFFECTS.celebrate;
  if (signals.paymentSent) return MESSAGE_EFFECTS.fire;
  return undefined;
}

/** A tasteful emoji reaction on the guest's message acknowledging the outcome. */
function reactionFor(signals: TurnSignals): string | undefined {
  if (signals.booking?.reservation_id) return '🎉';
  if (signals.paymentSent) return '💳';
  if (signals.cancelled) return '👌';
  return undefined;
}

/* ─── Pure helpers ────────────────────────────────────────────────────────── */
function parseRange(
  checkIn?: string,
  checkOut?: string,
): { start: Date; end: Date; nights: number } | { error: string } {
  if (!checkIn || !checkOut) return { error: 'check_in and check_out are required.' };
  const start = new Date(`${checkIn}T00:00:00`);
  const end = new Date(`${checkOut}T00:00:00`);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { error: 'Dates must be valid YYYY-MM-DD.' };
  }
  if (end <= start) return { error: 'check_out must be after check_in.' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (start < today) return { error: 'check_in cannot be in the past.' };
  const nights = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return { start, end, nights };
}

function typeMatches(actual: string, wanted: string): boolean {
  const a = actual.toLowerCase().trim();
  const w = wanted.toLowerCase().trim();
  return a === w || a.includes(w) || w.includes(a);
}

export function detectLang(text: string): 'ru' | 'uz' | 'en' {
  if (/[Ѐ-ӿ]/.test(text)) return 'ru';
  const uz = ['salom', 'rahmat', 'raxmat', 'xona', 'qancha', 'narx', 'ovqat', 'buyurtma', 'kerak', 'qachon', 'qayer', 'mumkin', 'bron', 'bekor'];
  const lower = text.toLowerCase();
  if (uz.some((w) => lower.includes(w))) return 'uz';
  return 'en';
}

/** True when a reply_markup is an inline keyboard (can be set via editMessageText). */
export function isInlineKeyboard(markup: any): boolean {
  return !!markup && Array.isArray(markup.inline_keyboard);
}

function matchAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const FALLBACK: Record<Lang, any> = {
  en: {
    greeting: (h: string) =>
      `Hello! 👋 Welcome to ${h}. I can help you check availability, book or cancel a room, or answer any questions. What would you like?`,
    rooms: 'Here are our room types and nightly rates:',
    bookCta: 'Tell me your check-in and check-out dates, room type, and your name & phone — I’ll book it for you.',
    cancel: 'I can help cancel your booking. Please share your name or phone number so I can find it.',
    fallback: (h: string) =>
      `Thanks for reaching out to ${h}! I can help with bookings, cancellations, prices and info. What would you like to do?`,
  },
  ru: {
    greeting: (h: string) =>
      `Здравствуйте! 👋 Добро пожаловать в ${h}. Помогу проверить наличие, забронировать или отменить номер, отвечу на вопросы. Что вас интересует?`,
    rooms: 'Наши категории номеров и цены за ночь:',
    bookCta: 'Напишите даты заезда и выезда, тип номера, ваше имя и телефон — и я оформлю бронь.',
    cancel: 'Помогу отменить бронь. Напишите ваше имя или номер телефона, чтобы я нашёл бронирование.',
    fallback: (h: string) =>
      `Спасибо, что написали в ${h}! Помогу с бронированием, отменой, ценами и информацией. Что бы вы хотели?`,
  },
  uz: {
    greeting: (h: string) =>
      `Assalomu alaykum! 👋 ${h} ga xush kelibsiz. Bo‘sh xonalarni tekshirish, bron qilish yoki bekor qilishda yordam beraman. Nima xohlaysiz?`,
    rooms: 'Xona turlari va bir kecha narxlari:',
    bookCta: 'Kelish va ketish sanalari, xona turi, ismingiz va telefoningizni yozing — bron qilib beraman.',
    cancel: 'Bronni bekor qilishda yordam beraman. Ismingiz yoki telefon raqamingizni yozing.',
    fallback: (h: string) =>
      `${h} ga yozganingiz uchun rahmat! Bron, bekor qilish, narxlar va ma’lumot bo‘yicha yordam beraman. Nima qilamiz?`,
  },
};
