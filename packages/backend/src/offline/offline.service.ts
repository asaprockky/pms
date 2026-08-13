import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma.service';
import { ControlPrismaService } from '../database/control-prisma.service';
import { TenantClientManager } from '../database/tenant-client.manager';
import { TenantContext } from '../database/tenant.context';
import { TelegramService } from '../telegram/telegram.service';
import { EmehmonService } from '../emehmon/emehmon.service';
import { ChannelManagerService } from '../channel-manager/channel-manager.service';

/** Actions that run locally offline (write to the desk DB, replay to server). */
const LOCAL_ACTIONS = new Set(['checkin', 'checkout', 'charge', 'cashPayment', 'closeFolio', 'preFiscal']);
/** Actions that must NOT run offline — queued and fired on reconnect. */
const DEFERRED_ACTIONS = new Set(['emehmon', 'otaSync', 'onlinePay', 'ofdFiscal']);
const BLOCKING = ['confirmed', 'checked_in', 'checked_out'];

@Injectable()
export class OfflineService {
  private readonly logger = new Logger(OfflineService.name);
  /** Dedicated local client for the desk queue (pos.db, not tenant-routed). */
  private readonly local = new PrismaClient();
  private replaying = false;

  constructor(
    private readonly db: PrismaService,
    private readonly events: EventEmitter2,
    private readonly control: ControlPrismaService,
    private readonly tenants: TenantClientManager,
    private readonly telegram: TelegramService,
    private readonly emehmon: EmehmonService,
    private readonly channels: ChannelManagerService,
  ) {}

  async isOnline(): Promise<boolean> {
    try {
      const res = await fetch('http://localhost:3000/health', { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch { return false; }
  }

  /** Queue an action. If online and purely local, execute immediately. */
  async enqueue(hotelId: string, action: string, payload: any) {
    const serialized = JSON.stringify({ ...payload, _offlineTimestamp: new Date().toISOString() });
    if ((await this.isOnline()) && LOCAL_ACTIONS.has(action)) {
      await this.withTenant(hotelId, () => this.execute(action, serialized, hotelId));
      return { executed: true };
    }
    await this.local.offlineAction.create({ data: { hotelId, action, payload: serialized, status: 'pending' } });
    this.logger.log(`Offline action queued: ${action} (${hotelId})`);
    return { queued: true };
  }

  /** Run `fn` in the tenant context for a hotel so PrismaService routes correctly. */
  private async withTenant<T>(hotelId: string, fn: () => Promise<T>): Promise<T | undefined> {
    const property = await this.control.property.findUnique({ where: { id: hotelId } });
    if (!property?.organizationId) {
      this.logger.warn(`No org for hotel ${hotelId}; skipping`);
      return undefined;
    }
    const client = await this.tenants.getTenant(property.organizationId);
    return TenantContext.run({ orgId: property.organizationId, client }, fn);
  }

  private async log(hotelId: string, action: string, status: string, detail?: string, refId?: string) {
    await this.db.syncLog
      .create({ data: { hotelId, action, status, detail: detail ?? null, refId: refId ?? null } })
      .catch(() => undefined);
  }

  /* ─── Local action execution (runs inside tenant context) ──────────────── */
  private async execute(action: string, payload: string, hotelId: string) {
    const p = JSON.parse(payload);
    switch (action) {
      case 'checkin':
        await this.db.reservation.update({ where: { id: p.reservationId }, data: { status: 'checked_in', keyCode: p.keyCode ?? null } });
        this.events.emit('reservation.checked_in', { reservationId: p.reservationId, hotelId });
        break;
      case 'checkout':
        await this.db.reservation.update({ where: { id: p.reservationId }, data: { status: 'checked_out' } });
        this.events.emit('reservation.checked_out', { reservationId: p.reservationId, hotelId });
        break;
      case 'charge': {
        const folio = await this.db.folio.findFirst({ where: { reservationId: p.reservationId } });
        await this.db.charge.create({ data: { hotelId, reservationId: p.reservationId, folioId: folio?.id ?? null, description: p.description, category: p.category, amount: p.amount, staffId: p.staffId ?? null } });
        break;
      }
      case 'cashPayment':
        await this.db.payment.create({ data: { hotelId, reservationId: p.reservationId, folioId: p.folioId ?? null, amount: p.amount, method: 'cash', status: 'completed' } });
        break;
      case 'closeFolio':
        await this.db.folio.updateMany({ where: { reservationId: p.reservationId }, data: { status: 'closed', closedAt: new Date() } });
        break;
      case 'preFiscal':
        await this.db.document.create({ data: { hotelId, type: 'pre_fiscal', status: 'issued', number: `OFFLINE-${Date.now()}`, reservationId: p.reservationId ?? null, paymentId: p.paymentId ?? null, payload: JSON.stringify({ offline: true, ...p }) } });
        break;
    }
  }

  /* ─── Conflict detection: same room/date sold offline AND online ───────── */
  /** Returns 'ok' | 'resolved' | 'conflict'; reassigns the room when it can. */
  private async resolveRoomConflict(reservationId: string): Promise<{ outcome: 'ok' | 'resolved' | 'conflict'; note?: string }> {
    const r = await this.db.reservation.findUnique({ where: { id: reservationId } });
    if (!r) return { outcome: 'ok' };
    const clash = await this.db.reservation.findFirst({
      where: {
        id: { not: r.id }, roomId: r.roomId, status: { in: BLOCKING },
        checkIn: { lt: r.checkOut }, checkOut: { gt: r.checkIn },
      },
    });
    if (!clash) return { outcome: 'ok' };

    // The room was double-sold. Business rule: try to move the offline booking
    // to an equivalent free room; escalate only if none exists.
    const room = await this.db.room.findUnique({ where: { id: r.roomId } });
    const candidates = await this.db.room.findMany({
      where: { hotelId: r.hotelId, type: room?.type, status: { not: 'out_of_order' }, id: { not: r.roomId } },
    });
    for (const c of candidates) {
      const taken = await this.db.reservation.findFirst({
        where: { roomId: c.id, status: { in: BLOCKING }, checkIn: { lt: r.checkOut }, checkOut: { gt: r.checkIn } },
      });
      if (!taken) {
        await this.db.reservation.update({ where: { id: r.id }, data: { roomId: c.id } });
        await this.db.stay.updateMany({ where: { reservationId: r.id }, data: { roomId: c.id } }).catch(() => undefined);
        return { outcome: 'resolved', note: `Room double-booked; moved to room ${c.number}` };
      }
    }
    return { outcome: 'conflict', note: `Room ${room?.number ?? r.roomId} double-sold for ${r.checkIn.toISOString().slice(0, 10)}; no free ${room?.type ?? ''} room` };
  }

  /* ─── Replay queued actions in original order (on reconnect) ────────────── */
  async replay() {
    if (this.replaying) return;
    this.replaying = true;
    try {
      // The control DB may not have the OfflineAction table yet (fresh install
      // / pending migration). Never let that crash the app — just skip replay.
      let pending: Awaited<ReturnType<typeof this.local.offlineAction.findMany>>;
      try {
        pending = await this.local.offlineAction.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, take: 50 });
      } catch (e) {
        this.logger.warn(`Offline replay skipped: ${(e as Error).message}`);
        return;
      }
      for (const item of pending) {
        if (!(await this.isOnline())) break;
        try {
          await this.withTenant(item.hotelId, async () => {
            const p = JSON.parse(item.payload);

            if (DEFERRED_ACTIONS.has(item.action)) {
              await this.runDeferred(item.action, item.hotelId);
              await this.local.offlineAction.update({ where: { id: item.id }, data: { status: 'done', doneAt: new Date() } });
              await this.log(item.hotelId, item.action, 'deferred', 'External action fired on reconnect', p.reservationId);
              return;
            }

            // Local action — check for a double-sell before applying a check-in.
            if (item.action === 'checkin' && p.reservationId) {
              const res = await this.resolveRoomConflict(p.reservationId);
              if (res.outcome === 'conflict') {
                await this.local.offlineAction.update({ where: { id: item.id }, data: { status: 'conflict', lastError: res.note } });
                await this.log(item.hotelId, item.action, 'conflict', res.note, p.reservationId);
                await this.telegram.notifyStaff(item.hotelId, ['gm', 'front_desk'],
                  `⚠️ <b>Sync conflict — needs you</b>\n${res.note}\nResolve manually in the room grid.`).catch(() => undefined);
                return; // leave un-applied for manual resolution
              }
              if (res.outcome === 'resolved') {
                await this.execute(item.action, item.payload, item.hotelId);
                await this.local.offlineAction.update({ where: { id: item.id }, data: { status: 'done', doneAt: new Date() } });
                await this.log(item.hotelId, item.action, 'resolved', res.note, p.reservationId);
                return;
              }
            }

            await this.execute(item.action, item.payload, item.hotelId);
            await this.local.offlineAction.update({ where: { id: item.id }, data: { status: 'done', doneAt: new Date() } });
            await this.log(item.hotelId, item.action, 'synced', undefined, p.reservationId);
          });
        } catch (e) {
          const retries = item.retries + 1;
          await this.local.offlineAction.update({
            where: { id: item.id },
            data: { retries: { increment: 1 }, lastError: (e as Error).message, status: retries >= 5 ? 'failed' : 'pending' },
          });
          if (retries >= 5) await this.withTenant(item.hotelId, () => this.log(item.hotelId, item.action, 'failed', (e as Error).message));
        }
      }

      // After the queue drains, fire the per-hotel deferred external sweep
      // (E-Mehmon / OFD / OTA) so nothing held back offline is forgotten.
      const hotels = [...new Set(pending.map((p) => p.hotelId))];
      for (const hotelId of hotels) {
        if (!(await this.isOnline())) break;
        await this.withTenant(hotelId, () => this.runDeferredSweep(hotelId)).catch(() => undefined);
      }
    } finally {
      this.replaying = false;
    }
  }

  /** Fire a single queued deferred action (inside tenant context). */
  private async runDeferred(action: string, hotelId: string) {
    switch (action) {
      case 'emehmon': await this.emehmon.flushQueued(hotelId); break;
      case 'otaSync': await this.channels.syncNow(hotelId).catch(() => undefined); break;
      case 'ofdFiscal': await this.resendFiscal(hotelId); break;
      case 'onlinePay': /* online payment links are re-issued by staff; no-op */ break;
    }
  }

  /** Per-hotel catch-up of everything that couldn't go out while offline. */
  async runDeferredSweep(hotelId: string) {
    const em = await this.emehmon.flushQueued(hotelId).catch(() => ({ flushed: 0 }));
    if ((em as { flushed: number }).flushed) await this.log(hotelId, 'emehmon', 'deferred', `${(em as { flushed: number }).flushed} registration(s) sent`);
    const fisc = await this.resendFiscal(hotelId);
    if (fisc) await this.log(hotelId, 'ofdFiscal', 'deferred', `${fisc} receipt(s) fiscalized`);
    await this.channels.syncNow(hotelId).catch(() => undefined);
    await this.log(hotelId, 'otaSync', 'deferred', 'Channel availability re-synced');
  }

  /** Turn offline pre-fiscal slips into real OFD receipts on reconnect. */
  private async resendFiscal(hotelId: string): Promise<number> {
    const slips = await this.db.document.findMany({ where: { hotelId, type: 'pre_fiscal', status: 'issued' }, take: 100 });
    let done = 0;
    for (const s of slips) {
      try {
        if (s.paymentId) {
          const existing = await this.db.receipt.findFirst({ where: { paymentId: s.paymentId } });
          if (!existing) {
            const sign = `OFD-${Date.now().toString(36).toUpperCase()}-${done}`;
            await this.db.receipt.create({ data: { hotelId, paymentId: s.paymentId, fiscalSign: sign, qrPayload: `https://ofd.soliq.uz/check?t=${sign}`, offline: false } });
          }
        }
        await this.db.document.update({ where: { id: s.id }, data: { type: 'fiscal_receipt', status: 'issued' } });
        done += 1;
      } catch { /* best-effort */ }
    }
    return done;
  }

  /* ─── Auto-replay on a short interval (the reconnect loop) ──────────────── */
  @Cron('*/15 * * * * *')
  async syncCron() {
    if (await this.isOnline()) await this.replay().catch((e) => this.logger.warn(`replay failed: ${(e as Error).message}`));
  }

  /* ─── API ──────────────────────────────────────────────────────────────── */
  async pendingCount(hotelId: string) {
    const [pending, conflicts, failed] = await Promise.all([
      this.local.offlineAction.count({ where: { hotelId, status: 'pending' } }),
      this.local.offlineAction.count({ where: { hotelId, status: 'conflict' } }),
      this.local.offlineAction.count({ where: { hotelId, status: 'failed' } }),
    ]);
    return { pending, conflicts, failed, online: await this.isOnline() };
  }

  async getSyncLog(hotelId: string) {
    return (await this.withTenant(hotelId, () =>
      this.db.syncLog.findMany({ where: { hotelId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    )) ?? [];
  }

  /** Manual "sync now" trigger from the UI. */
  async syncNow() {
    await this.replay();
    return { ok: true };
  }
}
