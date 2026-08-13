import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import { TenantRunner } from '../database/tenant-runner.service';
import {
  BLOCKING_STATUSES, BOOKING_FLOW, DAY_KEYS, DAY_MS, DEFAULT_CLOSE, DEFAULT_OPEN,
  FOLIO_METHODS, MIN_MS, NO_SHOW_GRACE_MIN, PAYMENT_METHODS, SLOT_STEP_MIN,
  hhmmToMin, isoDate, minToHhmm, parseJsonArray, plural, roomTypeMatches,
} from './spa.constants';

/** A booking window widened by the treatment's prep/cleanup buffers. */
interface Busy {
  therapistId: string | null;
  secondTherapistId: string | null;
  roomId: string | null;
  from: number;
  to: number;
}

@Injectable()
export class SpaService {
  private readonly logger = new Logger(SpaService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly tg: TelegramService,
    private readonly runner: TenantRunner,
  ) {}

  /* ─── Masters ──────────────────────────────────────────────────────────── */

  async getTherapists(hotelId: string, includeInactive = false) {
    const rows = await this.prisma.spaTherapist.findMany({
      where: { hotelId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { name: 'asc' },
    });
    return rows.map((t) => ({
      ...t,
      specialties: parseJsonArray(t.specialties),
      shiftSchedule: t.shiftSchedule ? safeJson(t.shiftSchedule) : null,
    }));
  }

  async createTherapist(hotelId: string, dto: Record<string, any>) {
    const name = String(dto.name ?? '').trim();
    if (!name) throw new BadRequestException('Master name is required');
    return this.prisma.spaTherapist.create({
      data: {
        hotelId, name,
        specialties: JSON.stringify(dto.specialties ?? []),
        phone: dto.phone?.trim() || null,
        shiftSchedule: dto.shiftSchedule ? JSON.stringify(dto.shiftSchedule) : null,
        color: dto.color || '#6366F1',
      },
    });
  }

  async updateTherapist(hotelId: string, id: string, dto: Record<string, any>) {
    const t = await this.prisma.spaTherapist.findFirst({ where: { id, hotelId } });
    if (!t) throw new NotFoundException('Master not found');

    // Deactivating someone with work on the books orphans those appointments.
    // Refuse and say how many rather than silently stranding them.
    if (dto.active === false && t.active) {
      const future = await this.countFutureFor({ therapistId: id });
      if (future > 0) {
        throw new BadRequestException(
          `У мастера ещё ${future} ${plural(future, 'запись', 'записи', 'записей')} впереди — перенесите или отмените их перед отключением`,
        );
      }
    }
    const data: Record<string, any> = {};
    if (dto.name !== undefined) data.name = String(dto.name).trim();
    if (dto.phone !== undefined) data.phone = dto.phone?.trim() || null;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.active !== undefined) data.active = Boolean(dto.active);
    if (dto.specialties !== undefined) data.specialties = JSON.stringify(dto.specialties ?? []);
    if (dto.shiftSchedule !== undefined) {
      data.shiftSchedule = dto.shiftSchedule ? JSON.stringify(dto.shiftSchedule) : null;
    }
    return this.prisma.spaTherapist.update({ where: { id }, data });
  }

  /* ─── Cabinets ─────────────────────────────────────────────────────────── */

  async getRooms(hotelId: string, includeInactive = false) {
    return this.prisma.spaRoom.findMany({
      where: { hotelId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { name: 'asc' },
    });
  }

  async createRoom(hotelId: string, dto: Record<string, any>) {
    const name = String(dto.name ?? '').trim();
    if (!name) throw new BadRequestException('Cabinet name is required');
    return this.prisma.spaRoom.create({
      data: {
        hotelId, name,
        type: dto.type ?? 'massage',
        capacity: Number(dto.capacity) || 1,
        status: dto.status ?? 'active',
      },
    });
  }

  async updateRoom(hotelId: string, id: string, dto: Record<string, any>) {
    const r = await this.prisma.spaRoom.findFirst({ where: { id, hotelId } });
    if (!r) throw new NotFoundException('Cabinet not found');
    if ((dto.active === false && r.active) || (dto.status === 'maintenance' && r.status !== 'maintenance')) {
      const future = await this.countFutureFor({ roomId: id });
      if (future > 0) {
        throw new BadRequestException(
          `В кабинете ещё ${future} ${plural(future, 'запись', 'записи', 'записей')} впереди — перенесите или отмените их`,
        );
      }
    }
    const data: Record<string, any> = {};
    if (dto.name !== undefined) data.name = String(dto.name).trim();
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.capacity !== undefined) data.capacity = Number(dto.capacity) || 1;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.active !== undefined) data.active = Boolean(dto.active);
    return this.prisma.spaRoom.update({ where: { id }, data });
  }

  /* ─── Service catalog ──────────────────────────────────────────────────── */

  async getTreatments(hotelId: string, includeInactive = false) {
    return this.prisma.spaTreatment.findMany({
      where: { hotelId, ...(includeInactive ? {} : { active: true }) },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async createTreatment(hotelId: string, dto: Record<string, any>) {
    const name = String(dto.name ?? '').trim();
    if (!name) throw new BadRequestException('Service name is required');
    const isCouple = Boolean(dto.isCouple);
    return this.prisma.spaTreatment.create({
      data: {
        hotelId, name,
        category: dto.category ?? 'massage',
        durationMin: Number(dto.durationMin) || 60,
        price: Number(dto.price) || 0,
        description: dto.description?.trim() || null,
        vatPercent: dto.vatPercent !== undefined ? Number(dto.vatPercent) : 12,
        ikpuCode: dto.ikpuCode?.trim() || null,
        requiredSpecialty: dto.requiredSpecialty ?? 'massage',
        requiredRoomType: dto.requiredRoomType ?? 'massage',
        isCouple,
        bufferBeforeMin: Number(dto.bufferBeforeMin) || 0,
        bufferAfterMin: dto.bufferAfterMin !== undefined ? Number(dto.bufferAfterMin) : 10,
      },
    });
  }

  async updateTreatment(hotelId: string, id: string, dto: Record<string, any>) {
    const t = await this.prisma.spaTreatment.findFirst({ where: { id, hotelId } });
    if (!t) throw new NotFoundException('Service not found');
    const data: Record<string, any> = {};
    for (const k of ['name', 'category', 'requiredSpecialty', 'requiredRoomType'] as const) {
      if (dto[k] !== undefined) data[k] = String(dto[k]).trim();
    }
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.ikpuCode !== undefined) data.ikpuCode = dto.ikpuCode?.trim() || null;
    for (const k of ['durationMin', 'price', 'vatPercent', 'bufferBeforeMin', 'bufferAfterMin'] as const) {
      if (dto[k] !== undefined) data[k] = Number(dto[k]) || 0;
    }
    if (dto.isCouple !== undefined) data.isCouple = Boolean(dto.isCouple);
    if (dto.active !== undefined) data.active = Boolean(dto.active);
    // Existing bookings keep their snapshot, so a price edit here cannot move
    // an appointment somebody has already agreed to.
    return this.prisma.spaTreatment.update({ where: { id }, data });
  }

  /* ─── Availability ─────────────────────────────────────────────────────── */

  /**
   * The one scheduling engine. The calendar, the booking form and any future
   * guest-facing widget all call this — forking the logic is how a system ends
   * up double-booking a cabinet.
   *
   * A slot is offered only when, for the treatment's duration *plus* its
   * buffers, a qualified master is free AND a cabinet of the right type is
   * free. Couple treatments need two masters and a cabinet seating two.
   */
  async availability(hotelId: string, treatmentId: string, dateIso: string) {
    const treatment = await this.prisma.spaTreatment.findFirst({ where: { id: treatmentId, hotelId } });
    if (!treatment) throw new NotFoundException('Service not found');

    const dayStart = new Date(`${dateIso}T00:00:00.000Z`);
    if (Number.isNaN(dayStart.getTime())) throw new BadRequestException('Invalid date');
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const dayKey = DAY_KEYS[dayStart.getUTCDay()];

    const [therapists, rooms, bookings] = await Promise.all([
      this.prisma.spaTherapist.findMany({ where: { hotelId, active: true } }),
      this.prisma.spaRoom.findMany({ where: { hotelId, active: true, status: 'active' } }),
      this.prisma.spaBooking.findMany({
        where: {
          hotelId,
          status: { in: [...BLOCKING_STATUSES] },
          startTime: { lt: new Date(dayEnd.getTime() + DAY_MS) },
          endTime: { gt: new Date(dayStart.getTime() - DAY_MS) },
        },
        include: { treatment: { select: { bufferBeforeMin: true, bufferAfterMin: true } } },
      }),
    ]);

    const qualified = therapists.filter((t) => parseJsonArray(t.specialties).includes(treatment.requiredSpecialty));
    const usableRooms = rooms.filter(
      (r) => roomTypeMatches(r.type, treatment.requiredRoomType) && (!treatment.isCouple || r.capacity >= 2),
    );

    // Why nothing is bookable is far more useful than an empty list.
    if (!qualified.length) {
      return {
        date: dateIso, slots: [],
        reason: `Нет мастера со специализацией «${treatment.requiredSpecialty}»`,
        therapists: [], rooms: usableRooms.map((r) => ({ id: r.id, name: r.name })),
      };
    }
    if (!usableRooms.length) {
      return {
        date: dateIso, slots: [],
        reason: treatment.isCouple
          ? 'Нет свободного кабинета на двоих для парной процедуры'
          : `Нет кабинета типа «${treatment.requiredRoomType}»`,
        therapists: qualified.map((t) => ({ id: t.id, name: t.name })), rooms: [],
      };
    }
    if (treatment.isCouple && qualified.length < 2) {
      return {
        date: dateIso, slots: [],
        reason: 'Для парной процедуры нужно два свободных мастера',
        therapists: qualified.map((t) => ({ id: t.id, name: t.name })), rooms: [],
      };
    }

    const busy = this.toBusy(bookings);
    const needed = treatment.durationMin + treatment.bufferBeforeMin + treatment.bufferAfterMin;

    // Search the union of everyone's shift, then check each candidate start.
    const windows = qualified.map((t) => this.shiftWindow(t.shiftSchedule, dayKey));
    const openFrom = Math.min(...windows.map((w) => w.from));
    const openTo = Math.max(...windows.map((w) => w.to));

    const slots: {
      start: string; end: string; therapistIds: string[]; roomId: string; roomName: string;
    }[] = [];

    for (let m = openFrom; m + treatment.durationMin <= openTo; m += SLOT_STEP_MIN) {
      const start = new Date(dayStart.getTime() + m * MIN_MS);
      const end = new Date(start.getTime() + treatment.durationMin * MIN_MS);
      const blockFrom = start.getTime() - treatment.bufferBeforeMin * MIN_MS;
      const blockTo = end.getTime() + treatment.bufferAfterMin * MIN_MS;

      const freeMasters = qualified.filter((t, i) => {
        const w = windows[i];
        if (m < w.from || m + treatment.durationMin > w.to) return false;
        return !busy.some(
          (b) => (b.therapistId === t.id || b.secondTherapistId === t.id) && b.from < blockTo && b.to > blockFrom,
        );
      });
      const need = treatment.isCouple ? 2 : 1;
      if (freeMasters.length < need) continue;

      const freeRoom = usableRooms.find(
        (r) => !busy.some((b) => b.roomId === r.id && b.from < blockTo && b.to > blockFrom),
      );
      if (!freeRoom) continue;

      slots.push({
        start: start.toISOString(),
        end: end.toISOString(),
        therapistIds: freeMasters.slice(0, need).map((t) => t.id),
        roomId: freeRoom.id,
        roomName: freeRoom.name,
      });
    }

    return {
      date: dateIso,
      slots,
      reason: slots.length ? null : 'На этот день всё занято',
      therapists: qualified.map((t) => ({ id: t.id, name: t.name })),
      rooms: usableRooms.map((r) => ({ id: r.id, name: r.name })),
      durationMin: treatment.durationMin,
      needed,
    };
  }

  /* ─── Bookings ─────────────────────────────────────────────────────────── */

  async getBookings(
    hotelId: string,
    opts: { date?: string; from?: string; to?: string; status?: string; therapistId?: string; guestType?: string; search?: string } = {},
  ) {
    const where: Record<string, any> = { hotelId };

    // The day-2 upsell cron writes placeholder rows to remember it messaged a
    // guest. They are not appointments and must never show up as bookings.
    where.upsellOffer = false;

    if (opts.date) {
      const d = new Date(`${opts.date}T00:00:00.000Z`);
      where.startTime = { gte: d, lt: new Date(d.getTime() + DAY_MS) };
    } else if (opts.from || opts.to) {
      const gte = opts.from ? new Date(`${opts.from}T00:00:00.000Z`) : undefined;
      const lt = opts.to ? new Date(new Date(`${opts.to}T00:00:00.000Z`).getTime() + DAY_MS) : undefined;
      where.startTime = { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) };
    }
    if (opts.status === 'active') where.status = { in: [...BLOCKING_STATUSES] };
    else if (opts.status) where.status = opts.status;
    if (opts.therapistId) {
      where.OR = [{ therapistId: opts.therapistId }, { secondTherapistId: opts.therapistId }];
    }
    if (opts.guestType) where.guestType = opts.guestType;

    const rows = await this.prisma.spaBooking.findMany({
      where,
      orderBy: { startTime: 'asc' },
      include: {
        therapist: { select: { id: true, name: true, color: true } },
        secondTherapist: { select: { id: true, name: true } },
        room: { select: { id: true, name: true, type: true } },
        treatment: { select: { id: true, name: true, category: true, isCouple: true } },
      },
      take: 500,
    });
    if (!opts.search) return rows;
    const q = opts.search.toLowerCase();
    return rows.filter(
      (b) =>
        b.guestName.toLowerCase().includes(q) ||
        (b.guestPhone ?? '').includes(q) ||
        (b.treatment?.name ?? '').toLowerCase().includes(q),
    );
  }

  async getBooking(hotelId: string, id: string) {
    const b = await this.prisma.spaBooking.findFirst({
      where: { id, hotelId },
      include: { therapist: true, secondTherapist: true, room: true, treatment: true },
    });
    if (!b) throw new NotFoundException('Booking not found');
    return b;
  }

  /**
   * Create an appointment. Availability is re-checked here, server-side, even
   * though the caller already saw a free slot — two people booking the same
   * slot seconds apart is the normal case, not the edge case.
   */
  async createBooking(hotelId: string, dto: Record<string, any>, staffId?: string) {
    const guestName = String(dto.guestName ?? '').trim();
    if (!guestName) throw new BadRequestException('Guest name is required');
    if (!dto.treatmentId) throw new BadRequestException('Pick a service');
    if (!dto.startTime) throw new BadRequestException('Pick a time');

    const treatment = await this.prisma.spaTreatment.findFirst({ where: { id: dto.treatmentId, hotelId } });
    if (!treatment) throw new NotFoundException('Service not found');

    const guestType = dto.guestType === 'external' ? 'external' : 'in_house';
    if (guestType === 'in_house' && !dto.reservationId) {
      throw new BadRequestException('Для гостя отеля нужна бронь — или отметьте клиента как внешнего');
    }

    const start = new Date(dto.startTime);
    if (Number.isNaN(start.getTime())) throw new BadRequestException('Invalid start time');
    const durationMin = Number(dto.durationMin) || treatment.durationMin;
    const end = new Date(start.getTime() + durationMin * MIN_MS);

    const therapistIds: string[] = (dto.therapistIds ?? [dto.therapistId]).filter(Boolean);
    if (treatment.isCouple && therapistIds.length < 2) {
      throw new BadRequestException('Парная процедура требует двух мастеров');
    }
    if (!therapistIds.length) throw new BadRequestException('Выберите мастера');
    if (!dto.roomId) throw new BadRequestException('Выберите кабинет');

    await this.assertSlotFree(hotelId, {
      start, end,
      bufferBefore: treatment.bufferBeforeMin,
      bufferAfter: treatment.bufferAfterMin,
      therapistIds,
      roomId: dto.roomId,
      treatment,
    });

    // External clients get a lightweight CRM record so repeat visits and
    // marketing lists work the same way they do for hotel guests.
    let guestId: string | null = dto.guestId || null;
    if (!guestId && guestType === 'external' && dto.guestPhone?.trim()) {
      const phone = dto.guestPhone.trim();
      const existing = await this.prisma.guest.findFirst({ where: { hotelId, phone } });
      guestId = existing
        ? existing.id
        : (await this.prisma.guest.create({
            data: { hotelId, fullName: guestName, phone, tags: JSON.stringify(['spa', 'external']) },
          })).id;
    }

    return this.prisma.spaBooking.create({
      data: {
        hotelId,
        guestName,
        guestPhone: dto.guestPhone?.trim() || null,
        guestType,
        guestId,
        reservationId: guestType === 'in_house' ? dto.reservationId : null,
        treatmentId: treatment.id,
        therapistId: therapistIds[0],
        secondTherapistId: therapistIds[1] ?? null,
        roomId: dto.roomId,
        startTime: start,
        endTime: end,
        status: dto.status === 'requested' ? 'requested' : 'confirmed',
        source: dto.source ?? 'front_desk',
        notes: dto.notes?.trim() || null,
        staffId: staffId ?? null,
        // Frozen now — a later catalog edit must not move this price.
        priceSnapshot: treatment.price,
        vatSnapshot: treatment.vatPercent,
        durationSnapshot: durationMin,
      },
      include: { therapist: true, room: true, treatment: true },
    });
  }

  async setStatus(hotelId: string, id: string, status: string, reason?: string) {
    const b = await this.getBooking(hotelId, id);
    if (status === 'completed') {
      throw new BadRequestException('Use the complete endpoint — completing resolves payment');
    }
    const allowed = BOOKING_FLOW[b.status] ?? [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(`Нельзя перевести запись из «${b.status}» в «${status}»`);
    }
    if (status === 'no_show') {
      // Only after the guest has actually had time to be late.
      const graceEnd = b.startTime.getTime() + NO_SHOW_GRACE_MIN * MIN_MS;
      if (Date.now() < graceEnd) {
        throw new BadRequestException(
          `Неявку можно отметить через ${NO_SHOW_GRACE_MIN} мин после начала (в ${new Date(graceEnd).toISOString().slice(11, 16)} UTC)`,
        );
      }
    }
    return this.prisma.spaBooking.update({
      where: { id },
      data: {
        status,
        ...(status === 'cancelled' ? { cancelledAt: new Date(), cancelReason: reason?.trim() || null } : {}),
      },
      include: { therapist: true, room: true, treatment: true },
    });
  }

  /**
   * Completion is where the module's one real fork happens.
   *
   * in_house  → resolve (or create) the folio and post a Charge, exactly like
   *             F&B does, so it lands on the guest's bill.
   * external  → take payment now and record a Payment.
   *
   * The previous version ran on a cron and posted a Charge for every finished
   * booking regardless of who the client was, so a walk-in day-spa customer
   * produced a Charge attached to no reservation and no folio — money recorded
   * against nothing.
   */
  async completeBooking(hotelId: string, id: string, dto: Record<string, any>, actor?: { id?: string; name?: string }) {
    const b = await this.getBooking(hotelId, id);
    if (b.status === 'completed') throw new BadRequestException('Запись уже завершена');
    if (['cancelled', 'no_show'].includes(b.status)) {
      throw new BadRequestException('Отменённую запись нельзя завершить');
    }

    const method = String(dto.paymentMethod ?? '');
    if (!(PAYMENT_METHODS as readonly string[]).includes(method)) {
      throw new BadRequestException(`paymentMethod must be one of ${PAYMENT_METHODS.join(', ')}`);
    }
    const toFolio = (FOLIO_METHODS as readonly string[]).includes(method);
    if (toFolio && b.guestType !== 'in_house') {
      throw new BadRequestException('Внешний клиент не может списать на счёт номера — возьмите оплату наличными или картой');
    }

    const gross = b.priceSnapshot > 0 ? b.priceSnapshot : (b.treatment?.price ?? 0);
    if (gross <= 0) throw new BadRequestException('У услуги нулевая цена — задайте её в каталоге');
    const vatPct = b.vatSnapshot || b.treatment?.vatPercent || 0;
    // Prices are VAT-inclusive, so back the tax out rather than adding it on.
    const net = Math.round(gross / (1 + vatPct / 100));
    const vat = Math.round(gross) - net;

    let folioId: string | null = b.folioId;
    let chargeId: string | null = null;
    let paymentId: string | null = null;

    if (toFolio) {
      const reservationId = dto.reservationId || b.reservationId;
      if (!reservationId) {
        throw new BadRequestException('Нет брони для списания на номер — возьмите оплату напрямую');
      }
      const reservation = await this.prisma.reservation.findFirst({ where: { id: reservationId, hotelId } });
      if (!reservation) throw new NotFoundException('Reservation not found');

      let folio = await this.prisma.folio.findFirst({ where: { reservationId, status: 'open' } })
        ?? await this.prisma.folio.findFirst({ where: { reservationId } });
      if (!folio) folio = await this.prisma.folio.create({ data: { hotelId, reservationId, type: 'guest' } });
      folioId = folio.id;

      const charge = await this.prisma.charge.create({
        data: {
          hotelId, reservationId, folioId: folio.id,
          description: `SPA — ${b.treatment?.name ?? 'процедура'}`,
          category: 'spa', outlet: 'spa',
          amount: Math.round(gross), taxRate: vatPct,
          staffId: actor?.id ?? b.staffId ?? undefined,
          serviceTime: b.startTime,
        },
      });
      chargeId = charge.id;
      this.logger.log(`SPA charge ${charge.id} → folio ${folio.id}: ${gross}`);
    } else {
      const payment = await this.prisma.payment.create({
        data: {
          hotelId,
          reservationId: b.reservationId || null,
          folioId: b.folioId || null,
          amount: Math.round(gross),
          method,
          cashier: actor?.name ?? null,
        },
      });
      paymentId = payment.id;
    }

    // Fiscalization never blocks completion — a dead OFD must not stop the spa.
    let fiscalized = false;
    try {
      await this.prisma.document.create({
        data: {
          hotelId, type: 'fiscal_receipt', status: 'issued',
          number: `SPA-${Date.now()}`,
          folioId, paymentId, reservationId: b.reservationId || null, guestId: b.guestId || null,
          payload: JSON.stringify({
            outletCode: 'SPA-01', outletType: 'spa', bookingId: b.id,
            guestType: b.guestType, paymentMethod: method,
            subtotal: net, vat, total: Math.round(gross),
            items: [{
              name: b.treatment?.name ?? 'SPA', qty: 1,
              price: Math.round(gross), vat_percent: vatPct,
              ikpu: b.treatment?.ikpuCode ?? null,
            }],
          }),
        },
      });
      fiscalized = true;
    } catch (e) {
      this.logger.error(`SPA fiscal push queued after failure for ${id}: ${(e as Error).message}`);
    }

    return this.prisma.spaBooking.update({
      where: { id },
      data: {
        status: 'completed',
        completedAt: new Date(),
        paymentMethod: method,
        folioId, chargeId,
        chargePosted: !!chargeId,
        priceSnapshot: Math.round(gross),
        vatSnapshot: vatPct,
        staffId: actor?.id ?? b.staffId,
      },
      include: { therapist: true, room: true, treatment: true },
    }).then((row) => ({ ...row, fiscalized }));
  }

  /* ─── Dashboard & reports ──────────────────────────────────────────────── */

  async getSummary(hotelId: string) {
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const now = Date.now();

    const [today, therapists, rooms, treatments] = await Promise.all([
      this.prisma.spaBooking.findMany({
        where: { hotelId, upsellOffer: false, startTime: { gte: dayStart, lt: dayEnd } },
        include: {
          treatment: { select: { name: true, durationMin: true } },
          therapist: { select: { id: true, name: true } },
          room: { select: { id: true, name: true } },
        },
        orderBy: { startTime: 'asc' },
      }),
      this.prisma.spaTherapist.findMany({ where: { hotelId, active: true } }),
      this.prisma.spaRoom.findMany({ where: { hotelId, active: true, status: 'active' } }),
      this.prisma.spaTreatment.count({ where: { hotelId, active: true } }),
    ]);

    const completed = today.filter((b) => b.status === 'completed');
    const revenue = completed.reduce((s, b) => s + (b.priceSnapshot || 0), 0);
    const inHouseRevenue = completed
      .filter((b) => b.guestType === 'in_house')
      .reduce((s, b) => s + (b.priceSnapshot || 0), 0);

    // Utilisation: booked minutes against each master's actual shift today.
    const dayKey = DAY_KEYS[dayStart.getUTCDay()];
    const utilisation = therapists.map((t) => {
      const w = this.shiftWindow(t.shiftSchedule, dayKey);
      const capacity = Math.max(1, w.to - w.from);
      const mins = today
        .filter((b) => (b.therapistId === t.id || b.secondTherapistId === t.id)
          && !['cancelled', 'no_show'].includes(b.status))
        .reduce((s, b) => s + (b.endTime.getTime() - b.startTime.getTime()) / MIN_MS, 0);
      return {
        id: t.id, name: t.name,
        bookedMin: Math.round(mins),
        capacityMin: capacity,
        pct: Math.min(100, Math.round((mins / capacity) * 100)),
      };
    }).sort((a, b) => b.pct - a.pct);

    const upcoming = today
      .filter((b) => ['confirmed', 'in_progress'].includes(b.status)
        && b.startTime.getTime() >= now - 30 * MIN_MS
        && b.startTime.getTime() <= now + 2 * 60 * MIN_MS)
      .slice(0, 10);

    const alerts: { kind: string; severity: string; message: string; bookingId?: string }[] = [];
    const requested = today.filter((b) => b.status === 'requested');
    if (requested.length) {
      alerts.push({
        kind: 'unconfirmed', severity: 'critical',
        message: `${requested.length} ${plural(requested.length, 'заявка ждёт', 'заявки ждут', 'заявок ждут')} подтверждения`,
      });
    }
    const late = today.filter(
      (b) => b.status === 'confirmed' && now > b.startTime.getTime() + NO_SHOW_GRACE_MIN * MIN_MS,
    );
    for (const b of late.slice(0, 5)) {
      alerts.push({
        kind: 'late', severity: 'warning',
        message: `${b.guestName} не пришёл на ${b.treatment?.name ?? 'процедуру'} — можно отметить неявку`,
        bookingId: b.id,
      });
    }
    const idleMasters = utilisation.filter((u) => u.bookedMin === 0);
    if (idleMasters.length) {
      alerts.push({
        kind: 'idle', severity: 'info',
        message: `Без записей сегодня: ${idleMasters.map((m) => m.name).join(', ')}`,
      });
    }
    const noShows = today.filter((b) => b.status === 'no_show').length;

    return {
      todayRevenue: revenue,
      inHouseRevenue,
      externalRevenue: revenue - inHouseRevenue,
      completedCount: completed.length,
      bookingsToday: today.filter((b) => b.status !== 'cancelled').length,
      requestedCount: requested.length,
      noShows,
      avgTicket: completed.length ? Math.round(revenue / completed.length) : 0,
      masters: therapists.length,
      rooms: rooms.length,
      treatments,
      avgUtilisation: utilisation.length
        ? Math.round(utilisation.reduce((s, u) => s + u.pct, 0) / utilisation.length)
        : 0,
      utilisation,
      upcoming: upcoming.map((b) => ({
        id: b.id, guestName: b.guestName, guestType: b.guestType, status: b.status,
        startTime: b.startTime, endTime: b.endTime,
        treatmentName: b.treatment?.name ?? null,
        therapistName: b.therapist?.name ?? null,
        roomName: b.room?.name ?? null,
      })),
      alerts,
    };
  }

  async getReports(hotelId: string, fromIso?: string, toIso?: string) {
    const to = toIso ? new Date(`${toIso}T00:00:00.000Z`) : startOfUtcDay(new Date());
    const from = fromIso ? new Date(`${fromIso}T00:00:00.000Z`) : new Date(to.getTime() - 29 * DAY_MS);
    const toExclusive = new Date(to.getTime() + DAY_MS);

    const [rows, therapists, rooms] = await Promise.all([
      this.prisma.spaBooking.findMany({
        where: { hotelId, upsellOffer: false, startTime: { gte: from, lt: toExclusive } },
        include: {
          treatment: { select: { name: true, category: true } },
          therapist: { select: { id: true, name: true } },
          room: { select: { id: true, name: true } },
        },
      }),
      this.prisma.spaTherapist.findMany({ where: { hotelId, active: true } }),
      this.prisma.spaRoom.findMany({ where: { hotelId, active: true } }),
    ]);

    const completed = rows.filter((b) => b.status === 'completed');
    const revenue = completed.reduce((s, b) => s + (b.priceSnapshot || 0), 0);
    const inHouse = completed.filter((b) => b.guestType === 'in_house');
    const inHouseRevenue = inHouse.reduce((s, b) => s + (b.priceSnapshot || 0), 0);

    const byDay = new Map<string, number>();
    const byService = new Map<string, { name: string; count: number; revenue: number; category: string }>();
    const byMaster = new Map<string, { id: string; name: string; count: number; revenue: number; minutes: number }>();

    for (const b of completed) {
      const d = isoDate(b.startTime);
      byDay.set(d, (byDay.get(d) ?? 0) + (b.priceSnapshot || 0));

      const key = b.treatment?.name ?? '—';
      const svc = byService.get(key) ?? { name: key, count: 0, revenue: 0, category: b.treatment?.category ?? 'other' };
      svc.count++; svc.revenue += b.priceSnapshot || 0;
      byService.set(key, svc);

      for (const tid of [b.therapistId, b.secondTherapistId].filter(Boolean) as string[]) {
        const t = therapists.find((x) => x.id === tid);
        const row = byMaster.get(tid) ?? { id: tid, name: t?.name ?? '—', count: 0, revenue: 0, minutes: 0 };
        row.count++;
        // Couple treatments split the revenue between the two masters so the
        // per-master column still sums to the real total.
        row.revenue += (b.priceSnapshot || 0) / (b.secondTherapistId ? 2 : 1);
        row.minutes += (b.endTime.getTime() - b.startTime.getTime()) / MIN_MS;
        byMaster.set(tid, row);
      }
    }

    const series: { date: string; revenue: number }[] = [];
    for (let t = from.getTime(); t < toExclusive.getTime(); t += DAY_MS) {
      const d = isoDate(new Date(t));
      series.push({ date: d, revenue: Math.round(byDay.get(d) ?? 0) });
    }

    const days = Math.max(1, Math.round((toExclusive.getTime() - from.getTime()) / DAY_MS));
    const noShow = rows.filter((b) => b.status === 'no_show').length;
    const cancelled = rows.filter((b) => b.status === 'cancelled').length;
    const finishedOrMissed = completed.length + noShow;

    return {
      range: { from: isoDate(from), to: isoDate(to) },
      totals: {
        revenue,
        bookings: rows.length,
        completed: completed.length,
        cancelled,
        noShow,
        noShowRate: finishedOrMissed ? Math.round((noShow / finishedOrMissed) * 100) : 0,
        avgTicket: completed.length ? Math.round(revenue / completed.length) : 0,
        inHouseRevenue,
        externalRevenue: revenue - inHouseRevenue,
        inHousePct: revenue > 0 ? Math.round((inHouseRevenue / revenue) * 100) : 0,
      },
      series,
      topServices: [...byService.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 15),
      byMaster: [...byMaster.values()]
        .map((m) => ({
          ...m,
          revenue: Math.round(m.revenue),
          // Against a nominal 8-hour day across the period.
          utilisationPct: Math.min(100, Math.round((m.minutes / (days * 8 * 60)) * 100)),
        }))
        .sort((a, b) => b.revenue - a.revenue),
      roomsCount: rooms.length,
    };
  }

  /** Does this in-house guest already have a SPA booking? Used by the upsell graph. */
  async guestHasBooking(hotelId: string, reservationId: string) {
    const count = await this.prisma.spaBooking.count({
      where: { hotelId, reservationId, upsellOffer: false, status: { notIn: ['cancelled'] } },
    });
    return { reservationId, hasBooking: count > 0, count };
  }

  /* ─── internals ────────────────────────────────────────────────────────── */

  /** Widen each booking by its treatment's buffers — that is the real busy window. */
  private toBusy(rows: {
    therapistId: string | null; secondTherapistId: string | null; roomId: string | null;
    startTime: Date; endTime: Date;
    treatment?: { bufferBeforeMin: number; bufferAfterMin: number } | null;
  }[]): Busy[] {
    return rows.map((b) => ({
      therapistId: b.therapistId,
      secondTherapistId: b.secondTherapistId,
      roomId: b.roomId,
      from: b.startTime.getTime() - (b.treatment?.bufferBeforeMin ?? 0) * MIN_MS,
      to: b.endTime.getTime() + (b.treatment?.bufferAfterMin ?? 0) * MIN_MS,
    }));
  }

  /** A master's working window for a weekday, in minutes past midnight. */
  private shiftWindow(raw: string | null, dayKey: string): { from: number; to: number } {
    const fallback = { from: hhmmToMin(DEFAULT_OPEN)!, to: hhmmToMin(DEFAULT_CLOSE)! };
    if (!raw) return fallback;
    const parsed = safeJson(raw) as Record<string, [string, string]> | null;
    const win = parsed?.[dayKey];
    if (!Array.isArray(win) || win.length < 2) return { from: 0, to: 0 }; // day off
    const from = hhmmToMin(win[0]);
    const to = hhmmToMin(win[1]);
    if (from === null || to === null || to <= from) return fallback;
    return { from, to };
  }

  /** Server-side re-validation — the caller's view of the slot may be stale. */
  private async assertSlotFree(hotelId: string, p: {
    start: Date; end: Date; bufferBefore: number; bufferAfter: number;
    therapistIds: string[]; roomId: string;
    treatment: { requiredSpecialty: string; requiredRoomType: string; isCouple: boolean };
    ignoreBookingId?: string;
  }) {
    const blockFrom = p.start.getTime() - p.bufferBefore * MIN_MS;
    const blockTo = p.end.getTime() + p.bufferAfter * MIN_MS;

    const room = await this.prisma.spaRoom.findFirst({ where: { id: p.roomId, hotelId } });
    if (!room) throw new NotFoundException('Cabinet not found');
    if (!room.active || room.status !== 'active') throw new BadRequestException(`Кабинет «${room.name}» недоступен`);
    if (!roomTypeMatches(room.type, p.treatment.requiredRoomType)) {
      throw new BadRequestException(`Кабинет «${room.name}» не подходит для этой процедуры`);
    }
    if (p.treatment.isCouple && room.capacity < 2) {
      throw new BadRequestException(`В кабинете «${room.name}» только одно место — нужен кабинет на двоих`);
    }

    const masters = await this.prisma.spaTherapist.findMany({ where: { id: { in: p.therapistIds }, hotelId } });
    if (masters.length !== p.therapistIds.length) throw new NotFoundException('Master not found');
    for (const m of masters) {
      if (!m.active) throw new BadRequestException(`Мастер ${m.name} отключён`);
      if (!parseJsonArray(m.specialties).includes(p.treatment.requiredSpecialty)) {
        throw new BadRequestException(`У мастера ${m.name} нет специализации «${p.treatment.requiredSpecialty}»`);
      }
    }

    const overlapping = await this.prisma.spaBooking.findMany({
      where: {
        hotelId,
        status: { in: [...BLOCKING_STATUSES] },
        ...(p.ignoreBookingId ? { id: { not: p.ignoreBookingId } } : {}),
        startTime: { lt: new Date(blockTo + 60 * MIN_MS) },
        endTime: { gt: new Date(blockFrom - 60 * MIN_MS) },
      },
      include: {
        treatment: { select: { bufferBeforeMin: true, bufferAfterMin: true } },
        therapist: { select: { name: true } },
        room: { select: { name: true } },
      },
    });

    for (const b of this.toBusy(overlapping).map((busy, i) => ({ busy, src: overlapping[i] }))) {
      if (b.busy.from >= blockTo || b.busy.to <= blockFrom) continue;
      if (b.src.roomId === p.roomId) {
        throw new BadRequestException(`Кабинет «${room.name}» занят в это время`);
      }
      const clash = p.therapistIds.find((id) => b.busy.therapistId === id || b.busy.secondTherapistId === id);
      if (clash) {
        const name = masters.find((m) => m.id === clash)?.name ?? 'Мастер';
        throw new BadRequestException(`${name} занят в это время`);
      }
    }
  }

  private countFutureFor(where: { therapistId?: string; roomId?: string }) {
    const or = where.therapistId
      ? { OR: [{ therapistId: where.therapistId }, { secondTherapistId: where.therapistId }] }
      : { roomId: where.roomId };
    return this.prisma.spaBooking.count({
      where: { ...or, upsellOffer: false, status: { in: [...BLOCKING_STATUSES] }, startTime: { gte: new Date() } },
    });
  }

  /* ─── Scheduled jobs ───────────────────────────────────────────────────── */

  /**
   * Reminder an hour out. Completion is no longer automated: money now needs a
   * payment method, and only a human at the desk knows how the guest paid.
   */
  @Cron('*/5 * * * *')
  async sendReminders() {
    await this.runner.forEachTenant(() => this.remindersForTenant());
  }

  async remindersForTenant() {
    const windowStart = new Date(Date.now() + 55 * MIN_MS);
    const windowEnd = new Date(Date.now() + 65 * MIN_MS);
    const upcoming = await this.prisma.spaBooking.findMany({
      where: {
        status: 'confirmed', reminderSent: false, upsellOffer: false,
        startTime: { gte: windowStart, lt: windowEnd },
      },
      include: { treatment: { select: { name: true } } },
    });
    for (const b of upcoming) {
      if (b.guestPhone) {
        await this.tg.sendMessage(
          b.hotelId, b.guestPhone,
          `💆 Напоминание: ${b.treatment?.name ?? 'процедура'} через час. Ждём вас!`,
        );
      }
      await this.prisma.spaBooking.update({ where: { id: b.id }, data: { reminderSent: true } });
    }
  }

  /** Day-2 upsell nudge for in-house guests with no SPA booking yet. */
  @Cron('0 10 * * *')
  async upsellDay2Guests() {
    await this.runner.forEachTenant(() => this.upsellDay2ForTenant());
  }

  async upsellDay2ForTenant() {
    const today = startOfUtcDay(new Date());
    const from = new Date(today.getTime() - 2 * DAY_MS);
    const to = new Date(today.getTime() - 1 * DAY_MS);
    const reservations = await this.prisma.reservation.findMany({
      where: { status: 'checked_in', checkIn: { gte: from, lt: to } },
      include: { guest: true },
    });
    for (const r of reservations) {
      const already = await this.prisma.spaBooking.findFirst({ where: { reservationId: r.id } });
      if (already) continue;
      const phone = r.guest?.phone ?? '';
      if (phone) {
        await this.tg.sendMessage(
          r.hotelId, phone,
          '💆‍♀️ Второй день отдыха — самое время для SPA. Массаж, уход за лицом и не только. Спросите на стойке или ответьте здесь.',
        );
      }
      // The placeholder marks "already nudged". It is flagged upsellOffer so
      // every listing and report filters it out — it is not an appointment.
      await this.prisma.spaBooking.create({
        data: {
          hotelId: r.hotelId, reservationId: r.id,
          guestName: r.guest?.fullName ?? 'Guest', guestPhone: phone,
          startTime: today, endTime: today,
          status: 'cancelled', upsellOffer: true, guestType: 'in_house',
        },
      });
    }
  }
}

function safeJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
