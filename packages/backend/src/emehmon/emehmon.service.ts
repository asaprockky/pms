import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { recordDocument } from '../documents/documents.helper';

const DAY_MS = 86_400_000;
const HISTORY_DAYS = 14;

type GuestEmehmonEntry = { status: string; submittedAt: string | null; ref?: string | null };
type GuestEmehmonMap = Record<string, GuestEmehmonEntry>;

const parseMap = (raw: string | null): GuestEmehmonMap => {
  if (!raw) return {};
  try { return JSON.parse(raw) as GuestEmehmonMap; } catch { return {}; }
};

const parseIds = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
};

/** MVD registration needs identity data — flag what's missing per guest. */
const missingDocs = (g: { passportNo: string | null; citizenship: string | null; dob: Date | null }) => {
  const missing: string[] = [];
  if (!g.passportNo?.trim()) missing.push('passport');
  if (!g.citizenship?.trim()) missing.push('citizenship');
  if (!g.dob) missing.push('dob');
  return missing;
};

/**
 * E-Mehmon (foreigner registration) adapter. Compliance-first and swappable:
 * a mock gateway today, a certified partner gateway in Phase 2. When offline
 * (mountain resorts), submissions are queued and flushed on reconnect — a
 * registration is never silently dropped.
 */
@Injectable()
export class EmehmonService {
  private offline = process.env.ATLAS_EMEHMON_OFFLINE === '1';

  constructor(private readonly prisma: PrismaService) {}

  setOffline(v: boolean) {
    this.offline = v;
  }
  isOffline() {
    return this.offline;
  }

  // Returns the new E-Mehmon status for a check-in submission. Required for
  // every guest regardless of citizenship (Fix 41) — no exemption for UZ.
  async submit(): Promise<{ status: 'submitted' | 'queued'; ref?: string }> {
    if (this.offline) return { status: 'queued' };
    return { status: 'submitted', ref: 'EM-' + randomBytes(4).toString('hex').toUpperCase() };
  }

  /**
   * The registration workstation payload: every reservation that still has
   * MVD work attached (upcoming arrivals to collect documents for, in-house
   * guests to register/retry) with per-guest statuses, refs, deadlines and
   * document completeness — plus the recent registration journal from the
   * Document table. Everything is read from live data; nothing is invented.
   */
  async queue(hotelId: string) {
    const now = new Date();
    const since = new Date(now.getTime() - HISTORY_DAYS * DAY_MS);
    const [reservations, docs] = await Promise.all([
      this.prisma.reservation.findMany({
        where: {
          hotelId,
          OR: [
            { status: 'checked_in' },
            // Upcoming arrivals: collect passport data before the guest shows up.
            { status: 'confirmed', checkOut: { gte: now } },
            // Recently departed stays stay visible while their paperwork is fresh.
            { status: 'checked_out', checkOut: { gte: since } },
          ],
        },
        include: { room: true },
        orderBy: { checkIn: 'asc' },
      }),
      this.prisma.document.findMany({
        where: { hotelId, type: 'emehmon', issuedAt: { gte: since } },
        orderBy: { issuedAt: 'desc' },
        take: 100,
      }),
    ]);

    // One guest fetch for every person referenced by a reservation group or a
    // journal row.
    const guestIds = new Set<string>();
    for (const r of reservations) {
      guestIds.add(r.guestId);
      for (const gid of parseIds(r.extraGuestIds)) guestIds.add(gid);
    }
    for (const d of docs) if (d.guestId) guestIds.add(d.guestId);
    const guests = await this.prisma.guest.findMany({ where: { id: { in: [...guestIds] } } });
    const guestById = new Map(guests.map((g) => [g.id, g]));

    let queuedCount = 0;
    const rows = reservations.map((r) => {
      const ids = [r.guestId, ...parseIds(r.extraGuestIds).filter((id) => id !== r.guestId)];
      const map = parseMap(r.guestEmehmon);
      const guestRows = ids.map((gid) => {
        const g = guestById.get(gid);
        const entry = map[gid];
        const fallback = gid === r.guestId ? r.emehmonStatus : 'pending';
        const status = entry?.status ?? fallback;
        if (status === 'queued') queuedCount++;
        return {
          guestId: gid,
          isPrimary: gid === r.guestId,
          name: g?.fullName ?? '—',
          citizenship: g?.citizenship ?? null,
          docType: g?.docType ?? null,
          passportNo: g?.passportNo ?? null,
          dob: g?.dob ?? null,
          status,
          submittedAt: entry?.submittedAt
            ?? (gid === r.guestId ? r.emehmonSubmittedAt?.toISOString() ?? null : null),
          ref: entry?.ref ?? null,
          missingDocs: g ? missingDocs(g) : ['passport', 'citizenship', 'dob'],
        };
      });
      return {
        id: r.id,
        status: r.status,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        roomNumber: r.room.number,
        roomType: r.room.type,
        emehmonStatus: r.emehmonStatus,
        deadline: r.emehmonDeadline,
        guests: guestRows,
      };
    });

    const history = docs.map((d) => ({
      id: d.id,
      number: d.number,
      status: d.status,
      issuedAt: d.issuedAt,
      reservationId: d.reservationId,
      guestId: d.guestId,
      guestName: d.guestId ? guestById.get(d.guestId)?.fullName ?? '—' : '—',
    }));

    return { offline: this.offline, queuedCount, rows, history };
  }

  /**
   * Flush queued registrations after reconnect: re-submit every guest entry
   * stuck in 'queued', persist the returned refs into the per-guest map and
   * the reservation aggregate, and upgrade the queued journal documents.
   * (Previously only the reservation-level flag flipped, so per-guest rows
   * stayed 'queued' forever.)
   */
  async flushQueued(hotelId: string) {
    if (this.offline) return { flushed: 0, stillOffline: true };
    const candidates = await this.prisma.reservation.findMany({
      where: {
        hotelId,
        OR: [{ emehmonStatus: 'queued' }, { guestEmehmon: { contains: '"queued"' } }],
      },
      include: { guest: true },
    });

    let flushed = 0;
    for (const r of candidates) {
      const ids = [r.guestId, ...parseIds(r.extraGuestIds).filter((id) => id !== r.guestId)];
      const map = parseMap(r.guestEmehmon);
      let touched = false;
      for (const gid of ids) {
        const entry = map[gid] ?? (gid === r.guestId && r.emehmonStatus === 'queued'
          ? { status: 'queued', submittedAt: null }
          : null);
        if (!entry || entry.status !== 'queued') continue;
        const res = await this.submit();
        if (res.status !== 'submitted') continue; // gateway went away again mid-flush
        map[gid] = { status: 'submitted', submittedAt: new Date().toISOString(), ref: res.ref ?? null };
        touched = true;
        flushed++;
        // Upgrade the queued journal row for this guest, or write one if the
        // submission was queued before the journal existed.
        const upgraded = await this.prisma.document.updateMany({
          where: { hotelId, type: 'emehmon', reservationId: r.id, guestId: gid, status: 'queued' },
          data: { status: 'issued', number: res.ref ?? null },
        });
        if (upgraded.count === 0) {
          const g = gid === r.guestId ? r.guest : await this.prisma.guest.findUnique({ where: { id: gid } });
          await recordDocument(this.prisma, {
            hotelId, type: 'emehmon', status: 'issued', number: res.ref ?? null,
            reservationId: r.id, guestId: gid,
            payload: { citizenship: g?.citizenship ?? null, passportNo: g?.passportNo ?? null },
          });
        }
      }
      if (!touched) continue;
      const statuses = ids.map((gid) => map[gid]?.status ?? 'pending');
      const aggregate = statuses.includes('pending') ? 'pending'
        : statuses.includes('queued') ? 'queued'
        : statuses.every((s) => s === 'not_required') ? 'not_required'
        : 'submitted';
      const primary = map[r.guestId];
      await this.prisma.reservation.update({
        where: { id: r.id },
        data: {
          guestEmehmon: JSON.stringify(map),
          emehmonStatus: aggregate,
          ...(primary?.submittedAt ? { emehmonSubmittedAt: new Date(primary.submittedAt) } : {}),
        },
      });
    }
    return { flushed, stillOffline: false };
  }
}
