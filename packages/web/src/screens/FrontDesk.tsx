import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, BedDouble, Check, ChevronDown, ChevronRight, LogIn, Search, Star, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  FrontDeskWorkstation, Guest, Reservation, Room, cancelReservation, checkIn, checkOut, confirmReservation,
  getGuests, getReservations, getRooms, getFrontDeskWorkstation, updateTask,
} from '@/api';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { StatusDot } from '@/components/StatusDot';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonRows } from '@/components/SkeletonRows';
import { ReservationPanel } from '@/components/ReservationPanel';
import { prefLabel, readyKey, resStatusKey } from '@/lib/labels';
import { cn, formatDate, formatMoney } from '@/lib/utils';
import { avatarColor, initials, isVipGuest } from '@/lib/guest';

const FILTERS = ['all', 'confirmed', 'checked_in', 'pending', 'cancelled', 'checked_out', 'no_show'];

// Front Desk's natural workflow order (Fix 24) — active statuses first,
// resolved ones last. Applied on every render regardless of the active filter.
const STATUS_ORDER: Record<string, number> = {
  confirmed: 0, checked_in: 1, pending: 2, cancelled: 3, checked_out: 4, no_show: 5,
};

// Resolved reservations (past their working life) clutter the desk beyond a
// day — only show the last 24h of each by default (Fix 22).
const DAY_MS = 86_400_000;
const RECENT_STATUSES = ['checked_out', 'cancelled', 'no_show'];
const withinLast24h = (iso: string) => Date.now() - new Date(iso).getTime() <= DAY_MS;
const recencyAnchor = (r: Reservation) => (r.status === 'checked_out' ? r.checkOut : r.checkIn);

const parseExtraGuestIds = (raw?: string | null): string[] => {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

// Colored dot + low-saturation pill per room readiness state (green=clean,
// red=dirty, yellow=cleaning, gray=OOO, blue=occupied).
const READINESS_STYLE: Record<string, { dot: string; pill: string }> = {
  clean:    { dot: 'bg-emerald-500', pill: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  dirty:    { dot: 'bg-red-500',     pill: 'border-red-200 bg-red-50 text-red-700' },
  cleaning: { dot: 'bg-amber-400',   pill: 'border-amber-200 bg-amber-50 text-amber-700' },
  occupied: { dot: 'bg-blue-500',    pill: 'border-blue-200 bg-blue-50 text-blue-700' },
  ooo:      { dot: 'bg-zinc-400',    pill: 'border-transparent bg-muted text-muted-foreground' },
};
const READINESS_ORDER = ['clean', 'dirty', 'cleaning', 'occupied', 'ooo'] as const;

export function FrontDesk({ onNew, onOpenFolio }: { onNew: () => void; onOpenFolio?: (id: string) => void }) {
  const { t } = useI18n();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Reservation | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [ws, setWs] = useState<FrontDeskWorkstation | null>(null);
  const [wsFailed, setWsFailed] = useState(false);
  // Handover tasks completed this session — optimistic, struck through
  // immediately and reverted if the save fails.
  const [doneTasks, setDoneTasks] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, g, r, wsData] = await Promise.all([
        getReservations(filter === 'all' ? undefined : filter),
        getGuests(), getRooms(),
        getFrontDeskWorkstation().catch(() => null),
      ]);
      setReservations(res); setGuests(g); setRooms(r); setWs(wsData);
      setWsFailed(wsData === null);
      return res;
    } catch (e) {
      // Core lists failed (offline / server down): keep whatever is on screen,
      // but say so — never fail silently into a fake "no reservations" state.
      setWsFailed(true);
      toast.error((e as Error).message);
      return [];
    }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  // The open panel holds a snapshot of its reservation — after an action
  // (check-in, move, extend…) re-sync it from the fresh list so its own
  // status-dependent UI (E-Mehmon, bottom actions) updates immediately,
  // without closing/reopening the sheet (Fix 35).
  const handlePanelChanged = useCallback(async () => {
    const fresh = await load();
    setSelected((cur) => (cur ? fresh.find((r) => r.id === cur.id) ?? cur : cur));
  }, [load]);

  const guestOf = (id: string) => guests.find((g) => g.id === id);
  const guestName = (id: string) => guestOf(id)?.fullName ?? '—';
  const roomOf = (id: string) => rooms.find((x) => x.id === id);
  const roomLabel = (id: string) => { const r = roomOf(id); return r ? `№ ${r.number} · ${r.type}` : '—'; };
  // VIP if ANY guest inside the reservation's group (primary + co-guests) is
  // VIP (Fix 19). A guest is VIP when the computed LTV+RFM score flags them
  // (ws.vipGuestIds) — the manual tag check is only a fallback for guests
  // outside today's board (e.g. checked-out rows).
  const vipIds = useMemo(() => new Set(ws?.vipGuestIds ?? []), [ws]);
  const groupGuestIds = (r: Reservation) => [r.guestId, ...parseExtraGuestIds(r.extraGuestIds)];
  const isVipRow = (r: Reservation) => groupGuestIds(r).some((gid) => vipIds.has(gid) || isVipGuest(guestOf(gid)));
  const quickAction = async (id: string, label: string, fn: () => Promise<unknown>) => {
    setBusyId(id); try { await fn(); toast.success(label); await load(); } catch (e) { toast.error((e as Error).message); } finally { setBusyId(null); }
  };
  const toggleExpand = (id: string) => setExpanded((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const completeHandoverTask = async (taskId: string) => {
    setDoneTasks((prev) => new Set(prev).add(taskId));
    try {
      await updateTask(taskId, { status: 'done' });
      toast.success(`${t('fd.taskDone')} ✓`);
    } catch (e) {
      setDoneTasks((prev) => { const next = new Set(prev); next.delete(taskId); return next; });
      toast.error((e as Error).message);
    }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reservations
      .filter((r) => {
        if (RECENT_STATUSES.includes(r.status) && !withinLast24h(recencyAnchor(r))) return false;
        if (!q) return true;
        const hay = `${guestName(r.guestId)} ${roomOf(r.roomId)?.number ?? ''}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)
        || new Date(b.checkIn).getTime() - new Date(a.checkIn).getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservations, query, guests, rooms]);

  const stats = ws?.stats;
  const vipCount = ws?.vipArrivals.length ?? 0;
  const arrivals = useMemo(() => {
    const list = [...(ws?.arrivals ?? [])];
    // VIPs first, then by highest score — the guests worth greeting by name.
    return list.sort((a, b) => Number(b.vip) - Number(a.vip) || b.vipScore - a.vipScore || a.checkIn.localeCompare(b.checkIn));
  }, [ws]);
  const handover = ws?.handover;
  const roomGrid = ws?.roomGrid ?? [];
  const readinessCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of roomGrid) counts[r.readiness] = (counts[r.readiness] ?? 0) + 1;
    return counts;
  }, [roomGrid]);
  const showRecencyNote = filter !== 'all' && RECENT_STATUSES.includes(filter);

  return (
    <div className="flex flex-col gap-5">
      {/* ═══ Stats bar ══════════════════════════════════════════════════════ */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-2xl bg-card p-3 shadow-[0_10px_30px_rgba(31,42,72,.07)]"><div className="flex items-center gap-2"><ArrowDownToLine className="h-4 w-4 text-blue-500"/><span className="text-xs text-muted-foreground">{t('fo.kpiArrivals')}</span></div><p className="text-lg font-bold">{stats.arrivals}</p></div>
          <div className="rounded-2xl bg-card p-3 shadow-[0_10px_30px_rgba(31,42,72,.07)]"><div className="flex items-center gap-2"><ArrowUpFromLine className="h-4 w-4 text-amber-500"/><span className="text-xs text-muted-foreground">{t('fo.kpiDepartures')}</span></div><p className="text-lg font-bold">{stats.departures}</p></div>
          <div className="rounded-2xl bg-card p-3 shadow-[0_10px_30px_rgba(31,42,72,.07)]"><div className="flex items-center gap-2"><BedDouble className="h-4 w-4 text-emerald-500"/><span className="text-xs text-muted-foreground">{t('fo.kpiInhouse')}</span></div><p className="text-lg font-bold">{stats.inHouse}</p></div>
          <div className="rounded-2xl bg-card p-3 shadow-[0_10px_30px_rgba(31,42,72,.07)]"><div className="flex items-center gap-2"><Star className={cn('h-4 w-4', vipCount > 0 ? 'text-amber-500' : 'text-muted-foreground')}/><span className="text-xs text-muted-foreground">VIP</span></div><p className={cn('text-lg font-bold', vipCount > 0 && 'text-amber-600')}>{vipCount}</p></div>
        </div>
      )}

      {/* Workstation fetch failed (offline / backend hiccup): the reservation
          table may be stale or empty, but say so instead of failing silently. */}
      {wsFailed && !loading && (
        <div className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800 shadow-[0_10px_30px_rgba(31,42,72,.07)]">{t('fd.wsError')}</div>
      )}

      {/* ═══ Arrivals today — cards with VIP score + quick check-in ═════════ */}
      {ws && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ArrowDownToLine className="h-4 w-4 text-blue-500" />
            {t('fd.arrivalsToday')}
            <span className="text-muted-foreground font-normal">({arrivals.length})</span>
          </h3>
          {arrivals.length === 0 ? (
            <p className="rounded-xl bg-muted/40 px-4 py-3 text-sm text-muted-foreground">{t('fd.noArrivals')}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {arrivals.map((a) => (
                <div key={a.id} className={cn('flex flex-col gap-2 rounded-2xl bg-card p-3 shadow-[0_10px_30px_rgba(31,42,72,.07)]', a.vip && 'bg-amber-50/70 ring-1 ring-amber-300/50')}>
                  <div className="flex items-start gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ backgroundColor: avatarColor(a.guestName) }}>{initials(a.guestName)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold" title={a.guestName}>{a.guestName}</span>
                        <span title={`${t('fd.vipScore')}: ${a.vipScore}/100`}
                          className={cn('inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold',
                            a.vip ? 'bg-amber-200 text-amber-900' : 'bg-muted text-muted-foreground')}>
                          <Star className={cn('h-3 w-3', a.vip && 'fill-amber-500 text-amber-600')} />{a.vipScore}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">№{a.roomNumber} · {a.roomType} · {formatDate(a.checkIn)} → {formatDate(a.checkOut)}</p>
                      {(a.stays > 0 || a.ltv > 0) && (
                        <p className="text-[11px] text-muted-foreground">
                          {a.stays > 0 && <>{a.stays}× {t('fd.stays')}</>}
                          {a.stays > 0 && a.ltv > 0 && ' · '}
                          {a.ltv > 0 && <>LTV {formatMoney(a.ltv)}</>}
                        </p>
                      )}
                    </div>
                  </div>
                  {a.preferences.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {a.preferences.map((p) => (
                        <span key={p} className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">{prefLabel(p, t)}</span>
                      ))}
                    </div>
                  )}
                  <Button size="sm" disabled={busyId === a.id} className="mt-auto w-full"
                    onClick={() => quickAction(a.id, `${t('fd.checkin')} ✓`, () => checkIn(a.id))}>
                    <LogIn className="mr-1.5 h-3.5 w-3.5" />{t('fd.checkinNow')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ═══ Handover — optimistic complete ══════════════════════════════════ */}
      {handover && handover.tasks.length > 0 && (
        <div className="rounded-xl bg-blue-50 p-3 text-sm shadow-[0_10px_30px_rgba(31,42,72,.07)]">
          <p className="font-semibold text-blue-800 mb-1.5">{t('fd.handover')} ({handover.tasks.filter((x) => !doneTasks.has(x.id)).length})</p>
          <div className="space-y-1">
            {handover.tasks.map((task) => {
              const done = doneTasks.has(task.id);
              return (
                <div key={task.id} className="flex items-center justify-between gap-2">
                  <span className={cn('text-xs text-blue-700 transition-all', done && 'text-blue-400 line-through')}>
                    • {task.title}{task.note ? ` — ${task.note}` : ''}
                  </span>
                  {done ? (
                    <span className="inline-flex h-6 shrink-0 items-center gap-1 px-2 text-[11px] font-medium text-emerald-600"><Check className="h-3.5 w-3.5" />{t('fd.taskDone')}</span>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => completeHandoverTask(task.id)} className="h-6 shrink-0 px-2 text-[11px]">
                      {t('fd.taskDone')}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ Room readiness — per-room grid ══════════════════════════════════ */}
      {roomGrid.length > 0 && (
        <section className="rounded-2xl bg-card p-4 shadow-[0_10px_30px_rgba(31,42,72,.07)]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h3 className="text-sm font-semibold">{t('fd.roomsReady')}</h3>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {READINESS_ORDER.filter((k) => (readinessCounts[k] ?? 0) > 0).map((k) => (
                <span key={k} className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium', READINESS_STYLE[k].pill)}>
                  <span className={cn('h-1.5 w-1.5 rounded-full', READINESS_STYLE[k].dot)} />
                  {t(readyKey(k))}: <b>{readinessCounts[k]}</b>
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ═══ Filter bar + search ═══════════════════════════════════════════════ */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn('rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors', filter === f ? 'border-accent bg-accent text-accent-foreground' : 'border-transparent bg-card text-muted-foreground hover:text-foreground')}>
            {f === 'all' ? t('common.all') : t(resStatusKey(f))}
          </button>
        ))}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('fd.searchPh')}
            className="h-9 w-full rounded-lg border border-input bg-card pl-8 pr-8 text-sm outline-none focus:border-ring"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label={t('em.clear')}>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {showRecencyNote && (
        <p className="-mt-3 text-xs text-muted-foreground">{t('fd.recencyNote')}</p>
      )}

      {/* ═══ Table ═══════════════════════════════════════════════════════════ */}
      <div className="overflow-x-auto rounded-2xl bg-card shadow-[0_10px_30px_rgba(31,42,72,.07)]">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t('common.status')}</TableHead>
              <TableHead>{t('res.guest')}</TableHead>
              <TableHead>{t('res.room')}</TableHead>
              <TableHead className="hidden md:table-cell">{t('res.roomType')}</TableHead>
              <TableHead className="hidden sm:table-cell">{t('res.checkIn')}</TableHead>
              <TableHead className="hidden sm:table-cell">{t('res.checkOut')}</TableHead>
              <TableHead className="text-right">{t('common.total')}</TableHead>
              <TableHead className="w-[210px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (<SkeletonRows cols={8} />) : (
              visible.map((r) => {
                const gName = guestName(r.guestId);
                const vipRow = isVipRow(r);
                const extraCount = Math.max(0, (r.guestCount ?? 1) - 1);
                const isExpanded = expanded.has(r.id);
                const extraIds = parseExtraGuestIds(r.extraGuestIds);
                return (
                <Fragment key={r.id}>
                <TableRow className={cn('group cursor-pointer align-middle', vipRow && 'bg-amber-50/40 hover:bg-amber-50/60')} onClick={() => setSelected(r)}>
                  <TableCell className="whitespace-nowrap"><StatusDot status={r.status} label={t(resStatusKey(r.status))} /></TableCell>
                  <TableCell className="font-medium max-w-[200px]">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ backgroundColor: avatarColor(gName) }}>{initials(gName)}</span>
                      <span className="truncate" title={gName}>{gName}</span>
                      {vipRow && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" aria-label="VIP" />}
                      {extraCount > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleExpand(r.id); }}
                          aria-label={t('fd.showGroup')}
                          className="press inline-flex shrink-0 items-center gap-0.5 rounded-full bg-accent/10 py-0.5 pl-2 pr-1.5 text-[11px] font-bold text-accent transition-colors hover:bg-accent/20">
                          +{extraCount}
                          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        </button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{roomOf(r.roomId)?.number ?? '—'}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{roomOf(r.roomId)?.type ?? '—'}</TableCell>
                  <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">{formatDate(r.checkIn)}</TableCell>
                  <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">{formatDate(r.checkOut)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-medium">{formatMoney(r.totalPrice)}</TableCell>
                  <TableCell className="py-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1.5">
                      {r.status === 'pending' && (<><Button size="sm" variant="outline" className="shrink-0" disabled={busyId === r.id} onClick={() => quickAction(r.id, `${t('rp.confirmed')} ✓`, () => confirmReservation(r.id))}>{t('fd.confirm')}</Button><Button size="sm" variant="destructive" className="shrink-0" disabled={busyId === r.id} onClick={() => quickAction(r.id, `${t('fd.cancel')} ✓`, () => cancelReservation(r.id))}>{t('fd.cancel')}</Button></>)}
                      {r.status === 'confirmed' && (<><Button size="sm" variant="outline" className="shrink-0" disabled={busyId === r.id} onClick={() => quickAction(r.id, `${t('fd.checkin')} ✓`, () => checkIn(r.id))}>{t('fd.checkin')}</Button><Button size="sm" variant="destructive" className="shrink-0" disabled={busyId === r.id} onClick={() => quickAction(r.id, `${t('fd.cancel')} ✓`, () => cancelReservation(r.id))}>{t('fd.cancel')}</Button></>)}
                      {r.status === 'checked_in' && (<Button size="sm" variant="outline" className="shrink-0" disabled={busyId === r.id} onClick={() => quickAction(r.id, `${t('fd.checkout')} ✓`, () => checkOut(r.id))}>{t('fd.checkout')}</Button>)}
                    </div>
                  </TableCell>
                </TableRow>
                {isExpanded && extraIds.length > 0 && (
                  <TableRow className="bg-muted/20 hover:bg-muted/20">
                    <TableCell colSpan={8} className="py-2">
                      <ul className="flex flex-wrap gap-2">
                        {extraIds.map((gid) => {
                          const g = guestOf(gid);
                          if (!g) return null;
                          return (
                            <li key={gid} className="flex items-center gap-1.5 rounded-full border border-transparent bg-card px-2.5 py-1 text-xs">
                              <span className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold text-white" style={{ backgroundColor: avatarColor(g.fullName) }}>{initials(g.fullName)}</span>
                              {g.fullName}
                              {(vipIds.has(gid) || isVipGuest(g)) && <Star className="h-3 w-3 fill-amber-400 text-amber-500" />}
                            </li>
                          );
                        })}
                      </ul>
                    </TableCell>
                  </TableRow>
                )}
                </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
        {!loading && visible.length === 0 && <EmptyState message={t('fd.empty')} action={<Button onClick={onNew}>{t('dash.quickNew')}</Button>} />}
      </div>

      <Sheet open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent className="w-full">
          {selected && <ReservationPanel reservation={selected} guestName={guestName(selected.guestId)} roomLabel={roomLabel(selected.roomId)} onChanged={handlePanelChanged} onOpenFolio={onOpenFolio} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
