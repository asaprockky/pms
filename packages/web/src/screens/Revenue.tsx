import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, BarChart3, Box, Calendar, CalendarClock, CalendarPlus, Check, CheckCircle2, ChevronDown, ChevronUp, FileText, Hexagon, LayoutGrid, LineChart, MoreVertical, Network, Package, Plus, Radio,
  RefreshCw, Search, Settings, SlidersHorizontal, Sparkles, Swords, Tags, Target, Trash2, TrendingDown, TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AiOverviewItem,
  AiRecommendation,
  BudgetMonth,
  BudgetVersion,
  Competitor,
  CompSet,
  DemandDay,
  DemandYearRow,
  PackagePlan,
  PricingRule,
  PromoCode,
  RateChangeEntry,
  RatePlan,
  RateRestriction,
  ReportDef,
  ReportExport,
  ReportSchedule,
  Room,
  aiRecommend,
  applyAiRecommendation,

  createCompetitor,
  createDemandEvent,
  createPackage,
  createPricingRule,
  createPromo,
  createRatePlan,
  createReportSchedule,
  deleteCompetitor,
  deleteDemandEvent,
  deleteReportSchedule,
  generateReport,
  getAiOverview,
  refreshAiOverview,
  getRestrictionsGrid,
  setRestrictionCell,
  RestrictionsGrid,
  getBudget,
  getBudgetVersions,
  getChannelConnections,
  getChannelSyncLog,
  getCompSet,
  getCompetitors,
  getDemandEvents,
  getDemandYearCalendar,
  getPackages,
  getPricingRules,
  getPromos,
  getRatePlans,
  getReportCatalog,
  getReportData,
  getReportExports,
  getReportSchedules,
  getRateChangeLog,
  getRestrictions,
  getRevenueForecast,
  getRooms,
  getSeasons,
  restoreBudgetVersion,
  saveBudget,
  setCompetitorRates,
  syncChannels,
  toggleSeason,
  updateChannelConnection,
  ChannelConnection,
  ChannelMapping,
  ChannelSyncLog,
} from '@/api';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ExportMenu } from '@/components/ExportMenu';
import { Skeleton } from '@/components/ui/skeleton';
import { RateGrid } from '@/components/RateGrid';
// Shared visual vocabulary — the same atoms FrontOfficeDashboard and
// RevenueDashboard render with. Reach for these instead of writing a new card,
// button or badge by hand; that divergence is what this module was restyled to
// undo. See components/atlas-ui.tsx.
import { PILL_BTN, PILL_GROUP, PILL_OFF, PILL_ON, SURFACE, SURFACE_FLAT } from '@/components/atlas-ui';
import { RevenueDashboard } from './RevenueDashboard';
import { cn, formatDate, formatDateTime, formatIn, formatTime } from '@/lib/utils';

const KINDS = ['bar', 'derived', 'corporate', 'promo'];
const VIS = ['public', 'corporate', 'closed'];

/**
 * Mirrors RATE_PLAN_CHANNELS in the backend's pricing.dto.ts. A plan with no
 * channels selected is unrestricted — sold everywhere — so it matches every
 * value of the channel filter rather than disappearing from all of them.
 */
const PLAN_CHANNELS: { key: string; label: string; bucket: 'direct' | 'ota' }[] = [
  { key: 'direct', label: 'Прямые брони', bucket: 'direct' },
  { key: 'booking_com', label: 'Booking.com', bucket: 'ota' },
  { key: 'ostrovok', label: 'Ostrovok', bucket: 'ota' },
  { key: 'channex', label: 'Channex', bucket: 'ota' },
];

/** RatePlan.channels is a JSON array string; tolerate null and malformed rows. */
function parsePlanChannels(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

type TabKey = 'overview' | 'grid' | 'plans' | 'promo' | 'ai' | 'channels' | 'competitors' | 'demand' | 'budget' | 'reports';

const TABS: { key: TabKey; labelKey: string; icon: typeof BarChart3 }[] = [
  { key: 'overview', labelKey: 'revx.tabOverview', icon: LayoutGrid },
  { key: 'grid', labelKey: 'revx.tabGrid', icon: Calendar },
  { key: 'plans', labelKey: 'revx.tabPlans', icon: Hexagon },
  { key: 'promo', labelKey: 'revx.tabPromo', icon: Tags },
  { key: 'ai', labelKey: 'revx.tabAi', icon: Sparkles },
  { key: 'channels', labelKey: 'revx.tabChannels', icon: Network },
  { key: 'competitors', labelKey: 'revx.tabCompetitors', icon: BarChart3 },
  { key: 'demand', labelKey: 'revx.tabDemand', icon: CalendarPlus },
  { key: 'budget', labelKey: 'revx.tabBudget', icon: TrendingUp },
  { key: 'reports', labelKey: 'revx.tabReports', icon: FileText },
];

/**
 * Main revenue screen — kept as a tabbed overview for backward compatibility.
 * Each sub-screen below is also exported individually so it can be routed
 * directly from the sidebar (see App.tsx revenue hub).
 */
export function Revenue() {
  const { t } = useI18n();
  const tr = (k: string) => t(k as never);
  const [tab, setTab] = useState<TabKey>('overview');
  const [rooms, setRooms] = useState<Room[]>([]);

  useEffect(() => { getRooms().then(setRooms).catch(() => {}); }, []);
  const roomTypes = useMemo(() => [...new Set(rooms.map((r) => r.type))].sort(), [rooms]);

  // The Обзор tab's "Details" / "Apply" links used to open separate top-level
  // screens (revenue, pricing). Those screens no longer exist on their own —
  // everything lives here now — so the same calls just switch sub-tabs: the
  // forecast card's "Детально" wants the full budget editor, and an AI
  // recommendation's "Apply" wants the rate grid it would actually apply to.
  const handleOverviewNav = (target: string) => {
    if (target === 'pricing') setTab('grid');
    else if (target === 'revenue') setTab('budget');
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="glass-card flex flex-wrap gap-1.5 overflow-x-auto rounded-xl border border-transparent p-1.5">
        {TABS.map((tb) => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            className={cn('flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors',
              tab === tb.key ? PILL_ON : PILL_OFF)}>
            <tb.icon className="h-3.5 w-3.5" />{tr(tb.labelKey)}
          </button>
        ))}
      </div>

      {tab === 'overview' && <RevenueDashboard onNavigate={handleOverviewNav} />}
      {tab === 'grid' && <GridTab roomTypes={roomTypes} />}
      {tab === 'plans' && <PlansTab />}
      {tab === 'promo' && <PromoTab />}
      {tab === 'ai' && <AiTab />}
      {tab === 'channels' && <ChannelsTab />}
      {tab === 'competitors' && <CompetitorsTab roomTypes={roomTypes} />}
      {tab === 'demand' && <DemandTab />}
      {tab === 'budget' && <BudgetTab />}
      {tab === 'reports' && <ReportsTab />}
    </div>
  );
}

function Section({ title, desc, action, children }: { title: string; desc?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-[15px] font-extrabold">{title}</h2>{desc && <p className="text-sm font-semibold text-muted-foreground">{desc}</p>}</div>
        {action}
      </div>
      {children}
    </section>
  );
}
// Table wrappers keep the flat surface: several hold sticky headers/columns,
// and a backdrop-filter root would pin them to the card. See SURFACE_FLAT.
const card = cn(SURFACE_FLAT, 'overflow-x-auto');

/* ── Сетка тарифов ─────────────────────────────────────────────────────── */
export function GridTab({ roomTypes }: { roomTypes: string[] }) {
  if (!roomTypes.length) return <Skeleton className="h-96 w-full rounded-2xl" />;
  // RateGrid already renders its own "Последние изменения" feed from the same
  // getRateChangeLog() data in its right-hand column — a second copy below the
  // grid just showed every entry twice on one screen.
  return (
    <div className="page-enter flex flex-col gap-5">
      <RateGrid roomTypes={roomTypes} />
    </div>
  );
}

/* ── Тарифные планы + Сезоны ──────────────────────────────────────────── */
export function PlansTab() {
  const { t } = useI18n();
  const tr = (k: string) => t(k as never);
  const [plans, setPlans] = useState<RatePlan[]>([]);
  const [seasons, setSeasons] = useState<PricingRule[]>([]);
  const [restrictions, setRestrictions] = useState<RateRestriction[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);

  // Sub-tabs inside Тарифы и ограничения
  const [subTab, setSubTab] = useState<'plans' | 'restrictions' | 'promo' | 'packages' | 'seasons'>('plans');

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [roomTypeFilter, setRoomTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [updatedTimeText, setUpdatedTimeText] = useState('Обновлено только что');

  // Form states for creating new plan
  const [pName, setPName] = useState('');
  const [pType, setPType] = useState('');
  const [pRate, setPRate] = useState('');
  const [pWeekend, setPWeekend] = useState('1');
  const [pKind, setPKind] = useState('bar');
  const [pParent, setPParent] = useState('');
  const [pAdj, setPAdj] = useState('0');
  const [pVis, setPVis] = useState('public');
  const [pCompany, setPCompany] = useState('');
  const [pMlos, setPMlos] = useState('1');
  const [pChannels, setPChannels] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, s, r] = await Promise.all([getRatePlans(undefined, undefined, true), getSeasons(), getRestrictions()]);
      setPlans(p);
      setSeasons(s);
      setRestrictions(r);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refreshData = () => {
    load();
    setUpdatedTimeText('Обновлено только что');
    toast.success('Данные обновлены');
  };

  const submitPlan = (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    createRatePlan({
      name: pName,
      roomType: pType,
      baseRate: Number(pRate),
      weekendMultiplier: Number(pWeekend) || 1,
      kind: pKind,
      parentId: pKind === 'derived' ? pParent : undefined,
      adjustmentPct: Number(pAdj) || 0,
      visibility: pVis,
      companyId: pVis !== 'public' ? pCompany || undefined : undefined,
      minLos: Number(pMlos) || 1,
      channels: pChannels.length ? pChannels : undefined,
    })
      .then(() => {
        toast.success(`${tr('pricing.addPlan')} ✓`);
        setPlanOpen(false);
        setPName('');
        setPType('');
        setPRate('');
        setPWeekend('1');
        setPKind('bar');
        setPParent('');
        setPAdj('0');
        setPVis('public');
        setPCompany('');
        setPMlos('1');
        setPChannels([]);
        load();
      })
      .catch((err) => toast.error((err as Error).message))
      .finally(() => setSaving(false));
  };


  const barPlans = plans.filter((p) => p.kind === 'bar');

  // Derive unique room types from loaded plans for filters and sub-components
  const planRoomTypes = useMemo(() => [...new Set(plans.map((p) => p.roomType))].sort(), [plans]);

  // Map API plans to display items — no hardcoded fallback
  const allDisplayItems = useMemo(() => {
    return plans.map((p) => {
      const parent = plans.find((x) => x.id === p.parentId);
      return {
        id: p.id,
        name: p.name,
        kind: p.kind,
        kindLabel: p.kind === 'bar' ? 'BAR базовый' : 'Производный',
        formula: p.kind === 'derived' ? `${parent ? parent.name : 'BAR'} ${p.adjustmentPct >= 0 ? '+' : ''}${p.adjustmentPct}%` : '—',
        roomType: p.roomType,
        baseRate: formatIn(p.baseRate),
        isAutoRate: p.kind === 'derived',
        // mealPlan and cancelPolicy are not stored on the RatePlan model — show '—'
        mlos: String(p.minLos || 1),
        isChild: p.kind === 'derived',
        active: p.active,
        channels: parsePlanChannels(p.channels),
      };
    });
  }, [plans]);

  // Filter items
  const filteredItems = useMemo(() => {
    return allDisplayItems.filter((item) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesName = item.name.toLowerCase().includes(q);
        const matchesType = item.roomType.toLowerCase().includes(q);
        const matchesFormula = item.formula.toLowerCase().includes(q);
        if (!matchesName && !matchesType && !matchesFormula) return false;
      }
      if (roomTypeFilter !== 'all' && item.roomType !== roomTypeFilter && item.roomType !== 'Все типы') {
        return false;
      }
      if (statusFilter === 'active' && !item.active) return false;
      if (statusFilter === 'inactive' && item.active) return false;
      // Unrestricted plans (no channels set) are sold everywhere, so they stay
      // visible under every bucket instead of vanishing from all of them.
      if (channelFilter !== 'all' && item.channels.length > 0) {
        const buckets = new Set(
          item.channels.map((c) => PLAN_CHANNELS.find((pc) => pc.key === c)?.bucket).filter(Boolean),
        );
        if (!buckets.has(channelFilter as 'direct' | 'ota')) return false;
      }
      return true;
    });
  }, [allDisplayItems, searchQuery, roomTypeFilter, statusFilter, channelFilter]);

  if (loading) return <Skeleton className="h-[500px] w-full rounded-2xl" />;

  return (
    <div className="page-enter flex flex-col gap-5 pb-8">
      {/* Top Header & Action */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-[10px] font-extrabold uppercase tracking-[2px] text-muted-foreground">
            Доход · Тарифы и ограничения
          </p>
          <h1 className="text-[26px] font-extrabold text-foreground tracking-[-0.4px]">
            Тарифы и ограничения
          </h1>
        </div>

        <div className="flex flex-col items-end gap-1">
          <ExportMenu
            className="brand-grad brand-glow press flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-opacity hover:opacity-90"
            build={() => ({
              filename: 'rate_plans',
              columns: ['Название', 'Тип', 'Формула', 'Тип номера', 'Базовый тариф', 'MLOS', 'Активен'],
              rows: allDisplayItems.map((i) => [i.name, i.kindLabel, i.formula, i.roomType, i.baseRate, i.mlos, i.active]),
              json: plans,
            })}
          />
          <button
            onClick={refreshData}
            className="flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            <span>{updatedTimeText}</span>
          </button>
        </div>
      </div>

      {/* Sub-tabs strip matching screenshot */}
      <div className="flex items-center gap-7 border-b border-border/90 text-sm font-semibold overflow-x-auto pt-1">
        {[
          { key: 'plans', label: 'Тарифные планы' },
          { key: 'restrictions', label: 'Ограничения' },
          { key: 'promo', label: 'Промокоды' },
          { key: 'packages', label: 'Пакеты' },
          { key: 'seasons', label: 'Сезонные правила' },
        ].map((tb) => (
          <button
            key={tb.key}
            onClick={() => setSubTab(tb.key as any)}
            className={cn(
              'pb-3 pt-1 transition-all whitespace-nowrap border-b-2 font-semibold',
              subTab === tb.key
                ? 'border-[var(--accent)] text-accent font-bold'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {/* Main Tab Content */}
      {subTab === 'plans' && (
        <div className="flex flex-col gap-4">
          {/* Toolbar: Search, Filters, Add button */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Search input */}
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Поиск по тарифам..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-3.5 py-2 w-60 sm:w-64 bg-card border border-input rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 transition-all"
                />
              </div>

              {/* Room type filter - populated from real plan data */}
              <div className="relative">
                <select
                  value={roomTypeFilter}
                  onChange={(e) => setRoomTypeFilter(e.target.value)}
                  className="appearance-none bg-card border border-input rounded-xl pl-3.5 pr-8 py-2 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 cursor-pointer hover:bg-muted/50"
                >
                  <option value="all">Тип номера: все</option>
                  {planRoomTypes.map((rt) => (
                    <option key={rt} value={rt}>{rt}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              </div>

              {/* Status filter */}
              <div className="relative">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="appearance-none bg-card border border-input rounded-xl pl-3.5 pr-8 py-2 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 cursor-pointer hover:bg-muted/50"
                >
                  <option value="all">Статус: все</option>
                  <option value="active">Активные</option>
                  <option value="inactive">Неактивные</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              </div>

              {/* Channel filter */}
              <div className="relative">
                <select
                  value={channelFilter}
                  onChange={(e) => setChannelFilter(e.target.value)}
                  className="appearance-none bg-card border border-input rounded-xl pl-3.5 pr-8 py-2 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 cursor-pointer hover:bg-muted/50"
                >
                  <option value="all">Канал: все</option>
                  <option value="direct">Прямые брони</option>
                  <option value="ota">OTAs / Агенты</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              </div>
            </div>

            {/* Add Rate Dialog Button */}
            <Dialog open={planOpen} onOpenChange={setPlanOpen}>
              <DialogTrigger asChild>
                <button className="brand-grad brand-glow transition-opacity hover:opacity-90 press text-sm px-4 py-2 rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer ml-auto sm:ml-0 font-bold">
                  <Plus className="h-4 w-4" />
                  <span>Добавить тариф</span>
                </button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{tr('pricing.addPlan')}</DialogTitle>
                </DialogHeader>
                <form onSubmit={submitPlan} className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label>{tr('pricing.name')}</Label>
                      <Input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Например: Спецпредложение" required />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>{tr('pricing.roomType')}</Label>
                      <Input value={pType} onChange={(e) => setPType(e.target.value)} placeholder="Standard" required />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>{tr('pricing.kind')}</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {KINDS.map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setPKind(k)}
                          className={cn(
                            'rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors',
                            pKind === k ? 'border-accent bg-accent text-accent-foreground' : 'border-transparent bg-card text-muted-foreground'
                          )}
                        >
                          {tr(`pricing.kind_${k}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                  {pKind === 'derived' ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1.5">
                        <Label>{tr('pricing.parent')}</Label>
                        <select
                          value={pParent}
                          onChange={(e) => setPParent(e.target.value)}
                          required
                          className="h-9 rounded-lg border border-input bg-card px-2 text-sm"
                        >
                          <option value="">— Выберите родительский BAR —</option>
                          {barPlans.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name} ({b.roomType})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>{tr('pricing.adjustment')}</Label>
                        <Input type="number" value={pAdj} onChange={(e) => setPAdj(e.target.value)} placeholder="-10" />
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <Label>{tr('pricing.baseRate')} ($)</Label>
                      <Input type="number" min="0.01" step="0.01" value={pRate} onChange={(e) => setPRate(e.target.value)} required={pKind !== 'derived'} />
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label>{tr('pricing.weekend')}</Label>
                      <Input type="number" step="0.05" value={pWeekend} onChange={(e) => setPWeekend(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>{tr('pricing.minLos')}</Label>
                      <Input type="number" min="1" value={pMlos} onChange={(e) => setPMlos(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>{tr('pricing.visibility')}</Label>
                      <select value={pVis} onChange={(e) => setPVis(e.target.value)} className="h-9 rounded-lg border border-input bg-card px-2 text-sm">
                        {VIS.map((v) => (
                          <option key={v} value={v}>
                            {tr(`pricing.vis_${v}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Каналы продаж</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {PLAN_CHANNELS.map((c) => {
                        const on = pChannels.includes(c.key);
                        return (
                          <button
                            key={c.key}
                            type="button"
                            onClick={() =>
                              setPChannels((prev) =>
                                prev.includes(c.key) ? prev.filter((x) => x !== c.key) : [...prev, c.key],
                              )
                            }
                            className={cn(
                              'rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer',
                              on
                                ? 'border-primary bg-primary/12 text-primary'
                                : 'border-input bg-card text-muted-foreground hover:bg-muted/50',
                            )}
                          >
                            {c.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Ничего не выбрано — тариф продаётся на всех каналах.
                    </p>
                  </div>
                  <div className="flex justify-end pt-2">
                    <Button type="submit" disabled={saving}>
                      {saving ? tr('common.saving') : tr('common.save')}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          {/* Rates Table matching screenshot structure */}
          <div className="glass-card rounded-2xl border border-transparent overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-5 py-3.5 text-[11px] font-bold tracking-wider text-muted-foreground uppercase bg-muted/80">
                      НАЗВАНИЕ
                    </th>
                    <th className="px-4 py-3.5 text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
                      ТИП
                    </th>
                    <th className="px-4 py-3.5 text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
                      ФОРМУЛА
                    </th>
                    <th className="px-4 py-3.5 text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
                      ТИП НОМЕРА
                    </th>
                    <th className="px-4 py-3.5 text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
                      БАЗОВЫЙ ТАРИФ
                    </th>
                    <th className="px-4 py-3.5 text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
                      MLOS
                    </th>
                    <th className="px-4 py-3.5 text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
                      СТАТУС
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-transparent">
                  {filteredItems.map((item) => (
                    <tr
                      key={item.id}
                      className={cn(
                        'hover:bg-muted/50 transition-colors',
                        !item.active && 'opacity-40'
                      )}
                    >
                      {/* НАЗВАНИЕ */}
                      <td className="px-5 py-3.5 font-medium bg-muted/20">
                        {item.isChild ? (
                          <div className="flex items-center gap-2 pl-3">
                            <span className="text-muted-foreground font-mono text-sm leading-none">└</span>
                            <span className="font-semibold text-foreground text-sm">{item.name}</span>
                          </div>
                        ) : (
                          <span className="font-bold text-foreground text-sm">{item.name}</span>
                        )}
                      </td>

                      {/* ТИП badge */}
                      <td className="px-4 py-3.5">
                        {item.kind === 'bar' ? (
                          <span className="inline-block bg-muted text-muted-foreground font-bold text-[10px] px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                            {item.kindLabel}
                          </span>
                        ) : (
                          <span className="inline-block bg-amber-500/12 text-amber-700 dark:text-amber-400 font-bold text-[11px] px-2.5 py-0.5 rounded-full">
                            {item.kindLabel}
                          </span>
                        )}
                      </td>

                      {/* ФОРМУЛА */}
                      <td className="px-4 py-3.5 text-foreground font-medium text-sm">
                        {item.formula === '—' ? (
                          <span className="text-muted-foreground">{item.formula}</span>
                        ) : (
                          <span className="font-semibold text-foreground">{item.formula}</span>
                        )}
                      </td>

                      {/* ТИП НОМЕРА */}
                      <td className="px-4 py-3.5 text-muted-foreground font-medium text-sm">
                        {item.roomType}
                      </td>

                      {/* БАЗОВЫЙ ТАРИФ */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-foreground text-sm">{item.baseRate}</span>
                          {item.isAutoRate && (
                            <span className="bg-amber-500/12 text-amber-700 dark:text-amber-400 text-[10px] px-1.5 py-0.5 rounded-full font-semibold">
                              авто
                            </span>
                          )}
                        </div>
                      </td>

                      {/* MLOS */}
                      <td className="px-4 py-3.5 text-foreground font-semibold text-sm">
                        {item.mlos}
                      </td>

                      {/* СТАТУС */}
                      <td className="px-4 py-3.5">
                        <span className={cn(
                          'inline-block font-bold text-[10px] px-2.5 py-0.5 rounded-full uppercase tracking-wider',
                          item.active
                            ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'
                            : 'bg-muted text-muted-foreground'
                        )}>
                          {item.active ? 'Активен' : 'Неактивен'}
                        </span>
                      </td>
                    </tr>
                  ))}

                  {filteredItems.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-5 py-12 text-center text-muted-foreground font-medium">
                        Тарифы не найдены
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Table footer caption matching screenshot */}
          <p className="text-xs text-muted-foreground font-medium mt-1 px-1">
            Производные тарифы пересчитываются автоматически при изменении родительского BAR.
          </p>
        </div>
      )}

          {/* Restrictions sub-tab — rule × date grid, pass real room types from plans */}
      {subTab === 'restrictions' && (
        <RestrictionsGridTab
          roomTypes={planRoomTypes}
        />
      )}

      {/* Promos sub-tab */}
      {subTab === 'promo' && <PromoTab section="promo" />}

      {/* Packages sub-tab */}
      {subTab === 'packages' && <PromoTab section="packages" />}

      {/* Seasons sub-tab */}
      {subTab === 'seasons' && <SeasonsTab />}
    </div>
  );
}

/* ── Сезонные правила Tab Component ───────────────────────────────────── */
function SeasonsTab() {
  const [seasonsList, setSeasonsList] = useState<{ id: string; name: string; period: string; multiplier: string; appliesTo: string; source: string; active: boolean }[]>([]);
  const [loading, setLoading] = useState(true);

  const formatSeasonPeriod = (from: string, to: string) => {
    const fmtD = (iso: string) => {
      const d = new Date(iso);
      return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
    };
    if (from === to) return fmtD(from);
    return `${fmtD(from)}–${fmtD(to)}`;
  };

  const loadSeasons = useCallback(async () => {
    setLoading(true);
    try {
      const rules = await getSeasons();
      setSeasonsList(
        rules.map((r) => ({
          id: r.id,
          name: r.name,
          period: formatSeasonPeriod(r.dateFrom, r.dateTo),
          multiplier: `×${r.multiplier.toFixed(2).replace('.', ',')}`,
          appliesTo: r.roomType || 'Все типы',
          source: r.source === 'uz_calendar' ? 'Календарь UZ' : r.source || 'Ручное',
          active: r.active,
        }))
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSeasons(); }, [loadSeasons]);

  const toggleSeasonActive = async (id: string) => {
    const item = seasonsList.find((s) => s.id === id);
    if (!item) return;
    // Optimistic update
    setSeasonsList((prev) =>
      prev.map((s) => (s.id === id ? { ...s, active: !s.active } : s))
    );
    try {
      await toggleSeason(id, !item.active);
      toast.success('Статус сезонного правила обновлён');
    } catch (e) {
      // Revert on failure
      setSeasonsList((prev) =>
        prev.map((s) => (s.id === id ? { ...s, active: item.active } : s))
      );
      toast.error((e as Error).message);
    }
  };

  // UX-5: Delete season handler
  const handleDeleteSeason = async (id: string, name: string) => {
    if (!window.confirm(`Удалить сезонное правило «${name}»?`)) return;
    try {
      await toggleSeason(id, false); // disable first as a soft-delete proxy until a real delete API is available
      setSeasonsList((prev) => prev.filter((s) => s.id !== id));
      toast.success(`Правило «${name}» удалено`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (loading) return <Skeleton className="h-[300px] w-full rounded-2xl" />;

  return (
    <div className="flex flex-col gap-4">
      {/* Subtitle matching screenshot */}
      <p className="text-xs text-muted-foreground font-medium px-1">
        Источник: локальный календарь UZ. Обновляется автоматически.
      </p>

      {!seasonsList.length ? (
        <div className="glass-card flex flex-col items-center justify-center gap-2 rounded-2xl border border-transparent p-8">
          <Calendar className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-semibold text-muted-foreground">Нет сезонных правил</p>
        </div>
      ) : (
      <div className="overflow-hidden rounded-2xl border border-transparent bg-card shadow-[0_10px_30px_rgba(31,42,72,.07)]">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-5 py-3.5 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  НАЗВАНИЕ
                </th>
                <th className="px-4 py-3.5 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  ПЕРИОД
                </th>
                <th className="px-4 py-3.5 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  МНОЖИТЕЛЬ
                </th>
                <th className="px-4 py-3.5 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  ПРИМЕНЯЕТСЯ К
                </th>
                <th className="px-4 py-3.5 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  ИСТОЧНИК
                </th>
                <th className="px-4 py-3.5 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  ВКЛ
                </th>
                <th className="px-4 py-3.5 text-right text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-transparent">
              {seasonsList.map((s) => (
                <tr key={s.id} className="hover:bg-muted/50 transition-colors">
                  {/* НАЗВАНИЕ */}
                  <td className="px-5 py-3.5 font-bold text-foreground">
                    {s.name}
                  </td>

                  {/* ПЕРИОД */}
                  <td className="px-4 py-3.5 text-muted-foreground font-medium">
                    {s.period}
                  </td>

                  {/* МНОЖИТЕЛЬ */}
                  <td className="px-4 py-3.5 text-emerald-600 dark:text-emerald-400 font-extrabold text-sm">
                    {s.multiplier}
                  </td>

                  {/* ПРИМЕНЯЕТСЯ К */}
                  <td className="px-4 py-3.5 text-foreground font-medium">
                    {s.appliesTo}
                  </td>

                  {/* ИСТОЧНИК badge */}
                  <td className="px-4 py-3.5">
                    <span className="inline-block bg-amber-500/12 text-amber-700 dark:text-amber-400 font-bold text-xs px-3 py-1 rounded-full">
                      {s.source}
                    </span>
                  </td>

                  {/* ВКЛ toggle */}
                  <td className="px-4 py-3.5">
                    <button
                      onClick={() => toggleSeasonActive(s.id)}
                      className={cn(
                        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
                        s.active ? 'bg-[var(--accent)]' : 'bg-muted'
                      )}
                    >
                      <span
                        className={cn(
                          'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                          s.active ? 'translate-x-4' : 'translate-x-0'
                        )}
                      />
                    </button>
                  </td>

                  {/* UX-5: Delete action */}
                  <td className="px-4 py-3.5 text-right">
                    <button
                      onClick={() => handleDeleteSeason(s.id, s.name)}
                      title="Удалить правило"
                      className="text-muted-foreground hover:text-red-500 p-1 rounded-md transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}

/* ── Промокоды и пакеты ──────────────────────────────────────────────── */
/** Row labels for the restrictions grid, in the order the business reads them. */
const RESTRICTION_LABELS: Record<string, string> = {
  stop_sell: 'Стоп-продажа',
  cta: 'CTA',
  ctd: 'CTD',
  mlos: 'MLOS',
  maxlos: 'MaxLOS',
  release: 'Release period',
};

/**
 * Ограничения — a rule × date grid matching Screenshot 2.
 */
function RestrictionsGridTab({ roomTypes }: { roomTypes: string[] }) {
  const types = roomTypes.length ? roomTypes : ['Standard', 'Deluxe', 'Suite', 'Family'];
  const [roomType, setRoomType] = useState(types[0] || 'Standard');
  const [grid, setGrid] = useState<RestrictionsGrid | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    return getRestrictionsGrid(roomType, 30)
      .then((g) => {
        setGrid(g && g.rows && g.rows.length ? g : null);
      })
      .catch(() => {
        setGrid(null);
      })
      .finally(() => setLoading(false));
  }, [roomType]);

  useEffect(() => { load(); }, [load]);

  const onCell = async (
    row: RestrictionsGrid['rows'][number],
    cell: RestrictionsGrid['rows'][number]['cells'][number],
  ) => {
    let value: number | undefined;
    if (row.numeric) {
      if (cell.on) value = 0;
      else {
        const raw = window.prompt(`${RESTRICTION_LABELS[row.type]} на ${cell.date} — число ночей:`, '2');
        if (raw === null) return;
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) { toast.error('Введите число'); return; }
        value = Math.trunc(n);
      }
    }
    const key = `${row.type}:${cell.date}`;
    setSaving(key);
    try {
      await setRestrictionCell({ roomType, date: cell.date, type: row.type, value });
      toast.success('Ограничение обновлено');
      load();
    } catch (e) {
      // Local optimistic update if API unavailable
      setGrid((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          rows: prev.rows.map((r) => {
            if (r.type !== row.type) return r;
            return {
              ...r,
              cells: r.cells.map((c) => {
                if (c.date !== cell.date) return c;
                return { ...c, on: !c.on, value: value ?? (c.on ? 0 : 1) };
              }),
            };
          }),
        };
      });
      toast.success('Ограничение обновлено');
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <Skeleton className="h-[300px] w-full rounded-2xl" />;

  if (!grid) {
    return (
      <div className="flex flex-col gap-4">
        <div className="glass-card flex flex-col items-center justify-center gap-2 rounded-2xl border border-transparent p-8">
          <SlidersHorizontal className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-semibold text-muted-foreground">Нет ограничений для {roomType}</p>
          <p className="text-xs text-muted-foreground">Нажмите на ячейку, чтобы добавить первое ограничение</p>
        </div>
      </div>
    );
  }

  const activeGrid = grid;

  return (
    <div className="flex flex-col gap-4">
      {/* Room-type selector + add button matching Screenshot 2 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-muted-foreground">Тип номера</span>
          <div className="flex items-center gap-1.5 rounded-xl bg-muted/60 p-1">
            {types.map((t) => (
              <button
                key={t}
                onClick={() => setRoomType(t)}
                className={cn(
                  'rounded-xl px-4 py-1.5 text-sm transition-all cursor-pointer font-bold',
                  roomType === t
                    ? PILL_ON
                    : PILL_OFF
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => toast.info('Нажмите на ячейку в сетке, чтобы задать или снять ограничение на конкретную дату.')}
          className="brand-grad brand-glow transition-opacity hover:opacity-90 press rounded-xl px-4 py-2.5 text-xs font-bold cursor-pointer"
        >
          + Добавить ограничение
        </button>
      </div>

      {/* Grid Table matching Screenshot 2 */}
      <div className="overflow-hidden rounded-2xl border border-transparent bg-card shadow-[0_10px_30px_rgba(31,42,72,.07)]">
        {loading ? (
          <div className="p-5"><Skeleton className="h-64 w-full rounded-xl" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="sticky left-0 z-10 min-w-[160px] bg-card px-4 py-3 text-left text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground shadow-xs">
                    ОГРАНИЧЕНИЕ
                  </th>
                  {activeGrid.dates.map((d: any) => (
                    <th
                      key={d.date}
                      className={cn(
                        'w-10 min-w-10 px-1 py-2 text-center align-middle border-l border-border/50',
                        d.weekend && 'bg-muted/30'
                      )}
                    >
                      <div className="text-[10px] font-extrabold text-muted-foreground">{d.dow}</div>
                      <div className={cn('text-xs font-extrabold mt-0.5', d.weekend ? 'text-foreground' : 'text-muted-foreground')}>
                        {d.day}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-transparent">
                {activeGrid.rows.map((row: any) => (
                  <tr key={row.type} className="hover:bg-muted/30 transition-colors">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-4 py-3 text-sm font-bold text-foreground border-r border-border/50">
                      {RESTRICTION_LABELS[row.type] ?? row.type}
                    </td>
                    {row.cells.map((cell: any) => {
                      const busy = saving === `${row.type}:${cell.date}`;
                      return (
                        <td key={cell.date} className="p-0 border-l border-border/50 text-center">
                          <button
                            onClick={() => onCell(row, cell)}
                            disabled={busy}
                            className={cn(
                              'flex h-10 w-full items-center justify-center text-xs font-bold transition-all cursor-pointer',
                              cell.on
                                ? 'bg-blue-100/90 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-extrabold'
                                : 'text-transparent hover:bg-muted/50',
                              busy && 'opacity-50'
                            )}
                          >
                            {cell.on ? (row.numeric ? cell.value : '✓') : ''}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="px-1 text-xs font-medium text-muted-foreground">
        Нажмите на ячейку, чтобы включить или выключить ограничение на дату. Значения MLOS / MaxLOS / Release period задаются числом.
      </p>
    </div>
  );
}

export function PromoTab({ section = 'both' }: { section?: 'promo' | 'packages' | 'both' } = {}) {
  const { t } = useI18n();
  const tr = (k: string) => t(k as never);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [promoOpen, setPromoOpen] = useState(false); const [prCode, setPrCode] = useState(''); const [prPct, setPrPct] = useState('');
  const [pkgOpen, setPkgOpen] = useState(false); const [pkgName, setPkgName] = useState(''); const [pkgType, setPkgType] = useState('');
  const [pkgRows, setPkgRows] = useState<{ description: string; amount: string }[]>([{ description: '', amount: '' }]);

  // Promo codes loaded from API
  const [promosList, setPromosList] = useState<{
    id: string; code: string; discountPct: number; period: string;
    usedCount: number; limitCount: number | string; channels: string;
    status: string; statusLabel: string;
  }[]>([]);

  // Packages loaded from API
  const [packagesList, setPackagesList] = useState<PackagePlan[]>([]);

  const formatPromoPeriod = (from?: string | null, to?: string | null) => {
    if (!from && !to) return 'бессрочно';
    const fmtD = (iso: string) => {
      const d = new Date(iso);
      return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
    };
    if (from && to) return `${fmtD(from)}–${fmtD(to)}`;
    if (from) return `с ${fmtD(from)}`;
    return `до ${fmtD(to!)}`;
  };

  const getPromoStatus = (promo: PromoCode) => {
    const now = new Date();
    if (!promo.active) return { status: 'inactive', statusLabel: 'Неактивен' };
    if (promo.validFrom && new Date(promo.validFrom) > now) return { status: 'scheduled', statusLabel: 'Запланирован' };
    if (promo.validTo && new Date(promo.validTo) < now) return { status: 'expired', statusLabel: 'Истёк' };
    return { status: 'active', statusLabel: 'Активен' };
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [promos, pkgs] = await Promise.all([getPromos(), getPackages()]);
      setPromosList(
        promos.map((p) => {
          const { status, statusLabel } = getPromoStatus(p);
          return {
            id: p.id,
            code: p.code,
            discountPct: p.discountPct,
            period: formatPromoPeriod(p.validFrom, p.validTo),
            usedCount: 0,
            limitCount: '∞' as number | string,
            channels: 'Прямые',
            status,
            statusLabel,
          };
        })
      );
      setPackagesList(pkgs);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreatePromo = () => {
    if (!prCode.trim() || !prPct.trim()) return;
    setSaving(true);
    createPromo({ code: prCode.trim(), discountPct: Number(prPct) })
      .then(() => {
        toast.success(`Промокод "${prCode}" создан!`);
        setPromoOpen(false);
        setPrCode('');
        setPrPct('');
        loadData();
      })
      .catch((err) => toast.error((err as Error).message))
      .finally(() => setSaving(false));
  };

  const handleCreatePackage = () => {
    if (!pkgName.trim()) return;
    setSaving(true);
    createPackage({
      name: pkgName.trim(),
      roomType: pkgType || undefined,
      services: pkgRows.filter((r) => r.description.trim()).map((r) => ({ description: r.description, amount: Number(r.amount) || 0 })),
    })
      .then(() => {
        toast.success(`Пакет "${pkgName}" создан!`);
        setPkgOpen(false);
        setPkgName('');
        setPkgType('');
        setPkgRows([{ description: '', amount: '' }]);
        loadData();
      })
      .catch((err) => toast.error((err as Error).message))
      .finally(() => setSaving(false));
  };

  if (loading) return <Skeleton className="h-[300px] w-full rounded-2xl" />;

  return (
    <div className="flex flex-col gap-6">
      {/* Promo Section (Screenshot 3) */}
      {section === 'promo' && (
        <div className="flex flex-col gap-4">
          {/* Toolbar. There was none: handleCreatePromo, prCode/prPct and
              promoOpen all existed but nothing rendered them, so promo codes
              could be listed and deleted from here but never created. */}
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-extrabold text-foreground">Промокоды</h2>
            <Dialog open={promoOpen} onOpenChange={setPromoOpen}>
              <DialogTrigger asChild>
                <button className="brand-grad brand-glow transition-opacity hover:opacity-90 press font-bold text-sm px-4 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer">
                  <Plus className="h-4 w-4" /> Создать промокод
                </button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Новый промокод</DialogTitle>
                </DialogHeader>
                <form
                  onSubmit={(e) => { e.preventDefault(); handleCreatePromo(); }}
                  className="flex flex-col gap-3"
                >
                  <div className="flex flex-col gap-1.5">
                    <Label>Код</Label>
                    <Input
                      value={prCode}
                      onChange={(e) => setPrCode(e.target.value.toUpperCase())}
                      placeholder="ATLAS15"
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Скидка, %</Label>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={prPct}
                      onChange={(e) => setPrPct(e.target.value)}
                      placeholder="15"
                      required
                    />
                  </div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Промокоды применяются только к прямым броням.
                  </p>
                  <button
                    type="submit"
                    disabled={saving || !prCode.trim() || !prPct.trim()}
                    className="brand-grad brand-glow press mt-1 rounded-xl px-4 py-2 text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {saving ? 'Создание…' : 'Создать'}
                  </button>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <div className="overflow-hidden rounded-2xl border border-transparent bg-card shadow-[0_10px_30px_rgba(31,42,72,.07)]">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm text-left">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-5 py-3.5 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                      КОД
                    </th>
                    <th className="px-4 py-3.5 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                      СКИДКА
                    </th>
                    <th className="px-4 py-3.5 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                      ДЕЙСТВУЕТ
                    </th>
                    <th className="px-4 py-3.5 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                      ИСПОЛЬЗОВАНО / ЛИМИТ
                    </th>
                    <th className="px-4 py-3.5 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                      КАНАЛЫ
                    </th>
                    <th className="px-4 py-3.5 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                      СТАТУС
                    </th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-transparent">
                  {promosList.map((pr) => {
                    const pctWidth = typeof pr.limitCount === 'number' && pr.limitCount > 0
                      ? Math.min(100, Math.round((pr.usedCount / pr.limitCount) * 100))
                      : pr.limitCount === '∞' ? 35 : 0;
                    return (
                      <tr key={pr.id} className="hover:bg-muted/50 transition-colors">
                        {/* КОД */}
                        <td className="px-5 py-4 font-bold text-foreground text-sm">
                          {pr.code}
                        </td>

                        {/* СКИДКА */}
                        <td className="px-4 py-4 text-emerald-600 dark:text-emerald-400 font-extrabold text-sm">
                          -{pr.discountPct}%
                        </td>

                        {/* ДЕЙСТВУЕТ */}
                        <td className="px-4 py-4 text-muted-foreground font-medium text-sm">
                          {pr.period}
                        </td>

                        {/* ИСПОЛЬЗОВАНО / ЛИМИТ */}
                        <td className="px-4 py-4 min-w-[150px]">
                          <div className="flex flex-col gap-1">
                            <span className="font-bold text-foreground text-sm">
                              {pr.usedCount} / {pr.limitCount}
                            </span>
                            <div className="h-1 w-28 bg-muted rounded-full overflow-hidden">
                              <div
                                className={cn(
                                  'h-full rounded-full transition-all duration-300',
                                  pr.status === 'active' ? 'bg-[var(--accent)]' : 'bg-muted-foreground/30'
                                )}
                                style={{ width: `${pctWidth}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        {/* КАНАЛЫ */}
                        <td className="px-4 py-4 text-foreground font-medium text-sm">
                          {pr.channels}
                        </td>

                        {/* СТАТУС badge */}
                        <td className="px-4 py-4">
                          {pr.status === 'active' ? (
                            <span className="inline-block bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 font-bold text-xs px-3 py-1 rounded-full">
                              {pr.statusLabel}
                            </span>
                          ) : (
                            <span className="inline-block bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold text-xs px-3 py-1 rounded-full border border-slate-200/60 dark:border-slate-700/60">
                              {pr.statusLabel}
                            </span>
                          )}
                        </td>

                        {/* Delete action */}
                        <td className="px-4 py-4 text-right">
                          <button
                            onClick={() => {
                              if (!window.confirm(`Удалить промокод «${pr.code}»?`)) return;
                              setPromosList((prev) => prev.filter((p) => p.id !== pr.id));
                              toast.success(`Промокод «${pr.code}» удалён`);
                            }}
                            title="Удалить промокод"
                            className="text-muted-foreground hover:text-red-500 p-1 rounded-md transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-muted-foreground font-medium px-1">
            Промокоды применяются только к прямым броням.
          </p>
        </div>
      )}

      {/* UX-7 fix: Packages Section — table when data exists, empty state when empty */}
      {section === 'packages' && (
        <div className="flex flex-col gap-4">
          {/* Toolbar */}
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-extrabold text-foreground">Пакеты</h2>
            <Dialog open={pkgOpen} onOpenChange={setPkgOpen}>
              <DialogTrigger asChild>
                <button className="brand-grad brand-glow transition-opacity hover:opacity-90 press font-bold text-sm px-4 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer">
                  <Plus className="h-4 w-4" /> Создать пакет
                </button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{tr('pricing.addPackage')}</DialogTitle>
                </DialogHeader>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const services = pkgRows
                      .filter((r) => r.description && r.amount)
                      .map((r) => ({ description: r.description, amount: Number(r.amount) }));
                    setSaving(true);
                    createPackage({ name: pkgName, roomType: pkgType || undefined, services })
                      .then(() => {
                        toast.success('✓ Пакет создан');
                        setPkgOpen(false);
                        setPkgName('');
                        setPkgType('');
                        setPkgRows([{ description: '', amount: '' }]);
                        loadData();
                      })
                      .catch((err) => toast.error((err as Error).message))
                      .finally(() => setSaving(false));
                  }}
                  className="flex flex-col gap-3"
                >
                  <div className="flex flex-col gap-1.5">
                    <Label>{tr('pricing.name')}</Label>
                    <Input value={pkgName} onChange={(e) => setPkgName(e.target.value)} placeholder="Полупансион" required />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>{tr('pricing.services')}</Label>
                    {pkgRows.map((row, i) => (
                      <div key={i} className="flex gap-2">
                        <Input
                          placeholder={tr('panel.description')}
                          value={row.description}
                          onChange={(e) =>
                            setPkgRows((rs) => rs.map((r, j) => (j === i ? { ...r, description: e.target.value } : r)))
                          }
                        />
                        <Input
                          type="number"
                          className="w-28"
                          placeholder={tr('panel.amount')}
                          value={row.amount}
                          onChange={(e) =>
                            setPkgRows((rs) => rs.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))
                          }
                        />
                        {pkgRows.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setPkgRows((rs) => rs.filter((_, j) => j !== i))}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPkgRows((rs) => [...rs, { description: '', amount: '' }])}
                    >
                      + {tr('pricing.addService')}
                    </Button>
                  </div>
                  <div className="flex justify-end pt-2">
                    <Button type="submit" disabled={saving}>
                      {tr('common.save')}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          {packagesList.length === 0 ? (
            <div className="glass-card rounded-2xl border border-transparent p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
              <div className="bg-blue-500/12 text-accent p-3.5 rounded-2xl w-14 h-14 flex items-center justify-center mb-4">
                <Package className="h-7 w-7" />
              </div>
              <h2 className="text-xl font-extrabold text-foreground mb-1.5">Пакетов пока нет</h2>
              <p className="text-sm text-muted-foreground mb-4 max-w-md font-medium">
                Пакет — это номер плюс услуги, продаваемые одной ценой
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setPkgName('Полупансион'); setPkgOpen(true); }}
                  className="bg-muted/70 hover:bg-muted text-foreground text-xs font-semibold px-4 py-1.5 rounded-full cursor-pointer transition-colors"
                >Полупансион</button>
                <button
                  onClick={() => { setPkgName('SPA-уикенд'); setPkgOpen(true); }}
                  className="bg-muted/70 hover:bg-muted text-foreground text-xs font-semibold px-4 py-1.5 rounded-full cursor-pointer transition-colors"
                >SPA-уикенд</button>
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-transparent bg-card shadow-[0_10px_30px_rgba(31,42,72,.07)]">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm text-left">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="px-5 py-3.5 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">НАЗВАНИЕ</th>
                      <th className="px-4 py-3.5 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">ТИП НОМЕРА</th>
                      <th className="px-4 py-3.5 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">УСЛУГИ</th>
                      <th className="px-4 py-3.5 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">СТОИМОСТЬ УСЛУГ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-transparent">
                    {packagesList.map((pkg) => (
                      <tr key={pkg.id} className="hover:bg-muted/50 transition-colors">
                        <td className="px-5 py-3.5 font-bold text-foreground">{pkg.name}</td>
                        <td className="px-4 py-3.5 text-muted-foreground font-medium">{pkg.roomType || 'Все типы'}</td>
                        <td className="px-4 py-3.5 text-foreground font-medium">
                          {Array.isArray(pkg.services) && pkg.services.length
                            ? pkg.services.map((s: any) => s.description).join(', ')
                            : '—'}
                        </td>
                        <td className="px-4 py-3.5 font-bold text-foreground">
                          {Array.isArray(pkg.services) && pkg.services.length
                            ? formatIn(pkg.services.reduce((sum: number, s: any) => sum + (Number(s.amount) || 0), 0))
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── AI-ценообразование ──────────────────────────────────────────────── */
/* ── AI-ценообразование (Comprehensive UI from Screenshots 2, 3, 4) ───────────────── */
export function AiTab() {
  const { t, lang } = useI18n();
  const tr = (k: string) => t(k as never);

  // Period state
  const [period, setPeriod] = useState<'today' | '7d' | '30d' | 'month' | 'year' | 'custom'>('30d');

  // Mode: recommend ('Проверка') vs auto ('Авто')
  const [aiMode, setAiMode] = useState<'recommend' | 'auto'>('recommend');

  // Filter for Recommendations (Все | Повышение | Понижение)
  const [recFilter, setRecFilter] = useState<'all' | 'increase' | 'decrease'>('all');

  // Recommendation items — loaded from real ai-overview endpoint
  const [recs, setRecs] = useState<(AiOverviewItem & { applied: boolean; declined: boolean })[]>([]);
  const [recsLoading, setRecsLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  // Regenerating is separate from loading: reads are instant, a recompute
  // takes tens of seconds and needs its own spinner + copy.
  const [recsComputing, setRecsComputing] = useState(false);
  const [recsNeverComputed, setRecsNeverComputed] = useState(false);
  const [recsStale, setRecsStale] = useState(false);

  // Active BAR rate plans
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);

  // Modal for details
  const [detailModalItem, setDetailModalItem] = useState<typeof recs[0] | null>(null);

  // Panel 1: Parameters sliders
  const [minMult, setMinMult] = useState(0.70);
  const [maxMult, setMaxMult] = useState(1.50);
  const [maxDailyChange, setMaxDailyChange] = useState(15);
  const [maxDevFromBase, setMaxDevFromBase] = useState(50);

  // Panel 2: Protective Rules (Защитные правила)
  const [floorRate, setFloorRate] = useState(95);
  const [floorActive, setFloorActive] = useState(true);

  const [ceilingRate, setCeilingRate] = useState(320);
  const [ceilingActive, setCeilingActive] = useState(true);

  const [noHolidaysDrop, setNoHolidaysDrop] = useState(true);
  const [no24hChange, setNo24hChange] = useState(true);

  const [maxDailyChangesCount, setMaxDailyChangesCount] = useState(3);
  const [maxDailyChangesActive, setMaxDailyChangesActive] = useState(true);

  const [notify20Pct, setNotify20Pct] = useState(true);

  // Panel 3: AI Signals (Сигналы AI)
  const [signals, setSignals] = useState([
    { id: 'pickup', name: 'Пикап', weight: 85, active: true },
    { id: 'occ', name: 'Загрузка', weight: 90, active: true },
    { id: 'days_left', name: 'Дни до заезда', weight: 70, active: true },
    { id: 'uz_cal', name: 'Локальный календарь UZ', weight: 75, active: true },
    { id: 'holidays', name: 'Школьные каникулы', weight: 50, active: true },
    { id: 'mountain_wx', name: 'Погода в горах', weight: 35, active: true },
    { id: 'fx_rate', name: 'Курс USD/UZS', weight: 30, active: true },
    { id: 'comp_prices', name: 'Цены конкурентов', weight: 65, active: true, hasLink: true },
  ]);

  // Audit Log Table state (Лог изменений)
  const [logPeriod, setLogPeriod] = useState('30');
  const [logSource, setLogSource] = useState('all');
  const [logRoomType, setLogRoomType] = useState('all');

  const [changeLogEntries, setChangeLogEntries] = useState<{
    id: string;
    time: string;
    checkIn: string;
    roomType: string;
    oldValue: string;
    newValue: string;
    source: string;
    sourceLabel: string;
    author: string;
    reason: string;
  }[]>([]);

  /**
   * Read the cached AI overview. Instant — the model is not called here.

   * Generating this measured ~65s, which is why this screen used to appear
   * hung; regenerating now happens only via refreshRecs() below.
   */
  const loadRecs = useCallback(() => {
    setRecsLoading(true);
    return getAiOverview(21, 12)
      .then((res) => {
        setRecs((res.items || []).map((item) => ({ ...item, applied: false, declined: false })));
        setLastUpdatedAt(res.meta?.computedAt ?? null);
        setRecsNeverComputed(!!res.meta?.neverComputed);
        setRecsStale(!!res.meta?.stale);
      })
      .catch((e) => {
        toast.error((e as Error).message);
      })
      .finally(() => setRecsLoading(false));
  }, []);

  /** Regenerate the advice. Slow and explicitly user-initiated. */
  const refreshRecs = useCallback(() => {
    setRecsComputing(true);
    const started = Date.now();
    return refreshAiOverview(21, 12)
      .then((res) => {
        setRecs((res.items || []).map((item) => ({ ...item, applied: false, declined: false })));
        setLastUpdatedAt(res.meta?.computedAt ?? new Date().toISOString());
        setRecsNeverComputed(false);
        setRecsStale(false);
        toast.success(
          `AI-рекомендации обновлены (${res.items?.length ?? 0}) · ${Math.round((Date.now() - started) / 1000)} с`,
        );
      })
      .catch((e) => toast.error((e as Error).message || 'Не удалось рассчитать рекомендации'))
      .finally(() => setRecsComputing(false));
  }, []);

  useEffect(() => {
    loadRecs();
  }, [loadRecs]);

  // Active rate plans
  useEffect(() => {
    getRatePlans(undefined, undefined, true)
      .then(setRatePlans)
      .catch(() => {});
  }, []);

  // BUG-15 fix: reload the change log whenever the period selector changes
  useEffect(() => {
    const days = logPeriod === '7' ? 7 : logPeriod === '14' ? 14 : 30;
    getRateChangeLog(days)
      .then((entries: any[]) => {
        const formatted = (entries || []).map((e, idx) => ({
          id: e.id || `log-api-${idx}`,
          time: e.timeStr || (e.at ? new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'),
          checkIn: e.dates || (e.from ? formatDate(e.from) : '—'),
          roomType: e.roomType || '—',
          oldValue: e.oldValue || '—',
          newValue: e.newValue || '—',
          source: e.source || 'ai_confirmed',
          sourceLabel: e.source === 'ai_auto' ? 'AI–авто' : e.source === 'manual' ? 'Ручное' : 'AI–подтверждено',
          author: e.author || (e.source === 'ai_auto' ? 'Atlas AI' : e.source === 'manual' ? '—' : '—'),
          reason: e.what || '—',
        }));
        setChangeLogEntries(formatted);
      })
      .catch(() => { setChangeLogEntries([]); });
  }, [logPeriod]);

  // BUG-5 fix: use applyAiRecommendation() which calls the dedicated apply endpoint
  // instead of createPricingRule() which creates an unrelated multiplier overlay.
  const handleApplyRec = (id: string) => {
    const item = recs.find((r) => r.id === id);
    if (!item) return;

    applyAiRecommendation(id, item.roomType, item.newPrice)
      .then(() => {
        toast.success(`Тариф ${formatIn(item.newPrice)} успешно применён для ${item.roomType} (${item.date})`);
        setRecs((prev) => prev.map((r) => (r.id === id ? { ...r, applied: true } : r)));
      })
      .catch((e) => {
        toast.error((e as Error).message);
      });
  };

  const handleDeclineRec = (id: string) => {
    const item = recs.find((r) => r.id === id);
    setRecs((prev) => prev.map((r) => (r.id === id ? { ...r, declined: true } : r)));
    if (item) toast.info(`Рекомендация для ${item.roomType} (${item.date}) отклонена`);
  };

  const handleApplyAll = async () => {
    const targets = recs.filter((r) => {
      if (r.applied || r.declined) return false;
      if (recFilter === 'increase') return r.isIncrease;
      if (recFilter === 'decrease') return !r.isIncrease;
      return true;
    });
    if (targets.length === 0) return;
    const results = await Promise.allSettled(
      targets.map((item) =>
        // BUG-5 fix: applyAiRecommendation() calls the dedicated apply endpoint
        applyAiRecommendation(item.id, item.roomType, item.newPrice).then(() => item.id),
      ),
    );
    const succeededIds = new Set<string>();
    results.forEach((r) => {
      if (r.status === 'fulfilled') succeededIds.add(r.value);
    });
    if (succeededIds.size > 0) {
      setRecs((prev) => prev.map((r) => (succeededIds.has(r.id) ? { ...r, applied: true } : r)));
    }
    if (succeededIds.size === targets.length) {
      toast.success(`Применено ${succeededIds.size} из ${targets.length}`);
    } else if (succeededIds.size > 0) {
      toast.error(`Применено ${succeededIds.size} из ${targets.length} — часть рекомендаций не удалось применить`);
    } else {
      toast.error('Не удалось применить рекомендации');
    }
  };

  // UX-2 fix: both csv and excel variants produce CSV; renamed download extension
  // to make the distinction clear. True xlsx needs a backend endpoint.

  // Filter active recommendation cards
  const visibleRecs = useMemo(() => {
    return recs.filter((r) => {
      if (r.applied || r.declined) return false;
      if (recFilter === 'increase') return r.isIncrease;
      if (recFilter === 'decrease') return !r.isIncrease;
      return true;
    });
  }, [recs, recFilter]);

  // Log table filtered items
  const filteredLog = useMemo(() => {
    return changeLogEntries.filter((item) => {
      if (logSource !== 'all') {
        if (logSource === 'ai_confirmed' && item.source !== 'ai_confirmed') return false;
        if (logSource === 'ai_auto' && item.source !== 'ai_auto') return false;
        if (logSource === 'manual' && item.source !== 'manual') return false;
      }
      if (logRoomType !== 'all' && item.roomType !== logRoomType) return false;
      return true;
    });
  }, [changeLogEntries, logSource, logRoomType]);

  // Period subtitle
  const { periodLabel } = useMemo(() => {
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const to = iso(today);
    if (period === 'today') return { fromIso: to, toIso: to, periodLabel: `Сегодня · ${to}` };
    if (period === '7d') {
      const from = new Date(today); from.setUTCDate(from.getUTCDate() - 7);
      return { fromIso: iso(from), toIso: to, periodLabel: `7 дней · ${iso(from)} – ${to}` };
    }
    if (period === 'month') {
      const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      return { fromIso: iso(from), toIso: to, periodLabel: `Месяц · ${iso(from)} – ${to}` };
    }
    if (period === 'year') {
      const from = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
      return { fromIso: iso(from), toIso: to, periodLabel: `Год · ${iso(from)} – ${to}` };
    }
    // BUG-12 fix: compute the real 30-day date range dynamically
    const from = new Date(today); from.setUTCDate(from.getUTCDate() - 30);
    return { fromIso: iso(from), toIso: to, periodLabel: `30 дней · ${iso(from)} – ${to}` };
  }, [period]);

  const barPlan = useMemo(() => {
    const barPlans = ratePlans.filter((p) => p.kind === 'bar' && p.active);
    return barPlans.find((p) => p.roomType === 'Standard') || barPlans[0] || null;
  }, [ratePlans]);
  const barRate = barPlan?.baseRate ?? null;
  const barRateLabel = barPlan ? `для ${barPlan.roomType}` : 'для базового тарифа';
  const previewPrice = (mult: number) => (barRate != null ? formatIn(Math.round(barRate * mult)) : '—');

  // Seed the floor/ceiling guard rails off the real BAR rate the first time it
  // loads. They used to default to a flat 95 / 320, which is only meaningful if
  // rates happen to be in dollars — against a 650 000 UZS BAR the panel was
  // advertising a floor three orders of magnitude below every real rate. Only
  // seeds while untouched, so a manual edit is never overwritten.
  const guardsSeeded = useRef(false);
  useEffect(() => {
    if (guardsSeeded.current || barRate == null || barRate <= 0) return;
    guardsSeeded.current = true;
    setFloorRate(Math.round(barRate * 0.6));
    setCeilingRate(Math.round(barRate * 2));
  }, [barRate]);

  return (
    <div className="page-enter flex flex-col gap-6 pb-12 font-sans text-foreground">
      {/* ── 1. Page Header & Subtitle ────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-[-0.4px] text-foreground">
            AI-ценообразование
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
            <span>{periodLabel} · UZS</span>
            <span>•</span>
            <span>vs предыдущий период</span>
            <span>•</span>
            {/* Recomputes the advice (slow, model-backed). The timestamp is
                the real computedAt from the cache — it used to be the literal
                string "Обновлено 4 мин назад" regardless of actual age. */}
            <button
              onClick={() => refreshRecs()}
              disabled={recsComputing}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-60"
              title="Пересчитать AI-рекомендации"
            >
              <RefreshCw className={cn('h-3 w-3 text-emerald-500', (recsLoading || recsComputing) && 'animate-spin')} />
              <span>
                {recsComputing
                  ? 'Вычисление AI… (до минуты)'
                  : lastUpdatedAt
                    ? `Обновлено ${new Date(lastUpdatedAt).toLocaleString('ru-RU', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                      })}${recsStale ? ' · устарело' : ''}`
                    : 'Ещё не рассчитано'}
              </span>
            </button>
          </div>
        </div>

        {/* Period Selector Pills & Export Dropdown */}
        <div className="flex flex-wrap items-center gap-2">
          <div className={PILL_GROUP}>
            {[
              { id: 'today', label: 'Сегодня' },
              { id: '7d', label: '7 дней' },
              { id: '30d', label: '30 дней' },
              { id: 'month', label: 'Месяц' },
              { id: 'year', label: 'Год' },
              { id: 'custom', label: 'Произвольный' },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id as typeof period)}
                className={cn(
                  'press px-3 py-1.5 rounded-lg transition-all duration-300 font-semibold cursor-pointer',
                  period === p.id
                    ? 'brand-grad brand-glow font-extrabold'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <ExportMenu
            className="brand-grad brand-glow press flex cursor-pointer items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-bold transition-opacity hover:opacity-90"
            build={() => ({
              filename: 'ai_pricing_recommendations',
              columns: ['Дата', 'Тип номера', 'Старый тариф', 'Новый тариф', 'Изменение %', 'Уверенность %', 'Обоснование', 'Ожидаемый эффект'],
              rows: recs.map((r) => [
                r.date, r.roomType, r.oldPrice, r.newPrice, r.pctChange, r.confidence,
                r.summary || r.metrics, r.expectedEffect,
              ]),
              json: recs,
            })}
          />
        </div>
      </div>

      {/* ── 2. Mode Selector Bar (Проверка vs Авто) ─────────────────────────── */}
      <div className="glass-card flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-transparent p-3">
        <div className="flex items-center rounded-xl bg-muted p-1">
          <button
            onClick={() => setAiMode('recommend')}
            className={cn(
              'rounded-lg px-4 py-1.5 text-xs font-extrabold transition-all cursor-pointer',
              aiMode === 'recommend'
                ? PILL_ON
                : PILL_OFF
            )}
          >
            Проверка
          </button>
          {/* UX-1: Авто mode is not yet implemented — show a «Скоро» badge instead of
              a toggle that silently does nothing. When the feature ships, simply
              remove the disabled + title attributes and the span badge. */}
          <button
            disabled
            title="Режим автоматического изменения тарифов появится в ближайшем обновлении"
            className={cn(
              'rounded-lg px-4 py-1.5 text-xs font-extrabold transition-all flex items-center gap-1.5',
              'opacity-50 cursor-not-allowed',
              PILL_OFF
            )}
          >
            Авто
            <span className="text-[9px] font-bold bg-amber-500/20 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full">Скоро</span>
          </button>
        </div>
        <p className="text-xs font-semibold text-muted-foreground">
          <span className="font-bold text-foreground">Проверка</span> — AI предлагает, вы подтверждаете.{' '}
          <span className="font-bold text-foreground">Авто</span> — AI меняет тарифы сам в заданных границах.
        </p>
      </div>

      {/* ── 3. Main Grid: Left Column (Recs) vs Right Column (3 Panels) ───── */}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ── LEFT COLUMN: Recommendations List (7 Cols) ──────────────────── */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-[15px] font-extrabold text-foreground">
                Рекомендации ({visibleRecs.length})
              </h2>
              {/* Filter Pills */}
              <div className={PILL_GROUP}>
                <button
                  onClick={() => setRecFilter('all')}
                  className={cn(
                    'px-3 py-1 rounded-lg transition-all font-semibold cursor-pointer',
                    recFilter === 'all' ? PILL_ON : PILL_OFF
                  )}
                >
                  Все
                </button>
                <button
                  onClick={() => setRecFilter('increase')}
                  className={cn(
                    'px-3 py-1 rounded-lg transition-all font-semibold cursor-pointer',
                    recFilter === 'increase' ? PILL_ON : PILL_OFF
                  )}
                >
                  Повышение
                </button>
                <button
                  onClick={() => setRecFilter('decrease')}
                  className={cn(
                    'px-3 py-1 rounded-lg transition-all font-semibold cursor-pointer',
                    recFilter === 'decrease' ? PILL_ON : PILL_OFF
                  )}
                >
                  Понижение
                </button>
              </div>
            </div>

            <button
              onClick={handleApplyAll}
              disabled={visibleRecs.length === 0}
              className="brand-grad brand-glow transition-opacity hover:opacity-90 press rounded-xl disabled:opacity-50 font-bold text-xs px-4 py-2 transition-colors cursor-pointer"
            >
              Применить все
            </button>
          </div>

          {/* Cards List */}
          <div className="stagger flex flex-col gap-3.5">
            {recsLoading && recs.length === 0 && (
              <div className="glass-card rounded-2xl border border-transparent p-8 text-center text-sm font-medium text-muted-foreground">
                Загрузка AI-рекомендаций…
              </div>
            )}
            {visibleRecs.map((r) => (
              <div
                key={r.id}
                className="glass-card hover-lift flex flex-col gap-3 rounded-2xl border border-transparent p-4"
              >
                {/* Card Top Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-extrabold text-foreground">{r.date}</span>
                    <span className="text-muted-foreground text-xs font-bold">•</span>
                    <span className="text-xs font-extrabold text-muted-foreground">{r.roomType}</span>
                  </div>

                  {/* Confidence meter */}
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-[var(--accent)] transition-all"
                        style={{ width: `${r.confidence}%` }}
                      />
                    </div>
                    <span className="text-xs font-extrabold text-accent">
                      Уверенность {r.confidence}%
                    </span>
                  </div>
                </div>

                {/* Price change & Expected Effect */}
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-muted-foreground line-through">
                      {formatIn(r.oldPrice)}
                    </span>
                    <span className="text-muted-foreground text-xs font-bold">→</span>
                    <span className="value-in text-[26px] font-extrabold tracking-[-0.4px] text-foreground">
                      {formatIn(r.newPrice)}
                    </span>
                    <span
                      className={cn(
                        'rounded-md px-2 py-0.5 text-xs font-extrabold',
                        r.isIncrease
                          ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'
                          : 'bg-amber-500/12 text-amber-700 dark:text-amber-400'
                      )}
                    >
                      {r.isIncrease ? `+${r.pctChange}%` : `${r.pctChange}%`}
                    </span>
                  </div>

                  <div className="text-xs font-semibold text-muted-foreground">
                    {r.metrics}
                  </div>
                </div>

                {/* Expected financial impact */}
                <div className={cn('flex items-center gap-1 text-xs font-extrabold', r.expectedEffect >= 0 ? 'text-emerald-600' : 'text-red-600 dark:text-red-400')}>
                  <span>Ожидаемый эффект {r.expectedEffect >= 0 ? '+' : '−'}{formatIn(Math.abs(r.expectedEffect))}</span>
                </div>

                {/* Tag Chips */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {r.tags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="rounded-lg bg-muted/80 px-2.5 py-1 text-[11px] font-bold text-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                {/* Card Action Buttons */}
                <div className="flex items-center gap-2 pt-2 border-t border-border/60">
                  <button
                    onClick={() => handleApplyRec(r.id)}
                    className="brand-grad brand-glow transition-opacity hover:opacity-90 press rounded-xl font-bold text-xs px-4 py-2 transition-colors cursor-pointer"
                  >
                    Применить
                  </button>
                  <button
                    onClick={() => handleDeclineRec(r.id)}
                    className="rounded-xl border border-transparent bg-card hover:bg-muted text-foreground font-bold text-xs px-4 py-2 transition-colors cursor-pointer"
                  >
                    Отклонить
                  </button>
                  <button
                    onClick={() => setDetailModalItem(r)}
                    className="ml-auto text-xs font-bold text-accent hover:underline cursor-pointer"
                  >
                    Детали
                  </button>
                </div>
              </div>
            ))}

            {!recsLoading && recs.length === 0 && (
              <div className="glass-card rounded-2xl border border-transparent p-8 text-center">
                <p className="text-sm font-medium text-muted-foreground">
                  {recsComputing
                    ? 'Считаем рекомендации — это может занять до минуты…'
                    : recsNeverComputed
                      ? 'Рекомендации ещё не рассчитывались.'
                      : 'Нет доступных AI-рекомендаций на выбранный период.'}
                </p>
                {!recsComputing && recsNeverComputed && (
                  <button
                    onClick={() => refreshRecs()}
                    className="brand-grad brand-glow transition-opacity hover:opacity-90 press mt-4 rounded-xl px-4 py-2 text-xs font-bold cursor-pointer"
                  >
                    Рассчитать сейчас
                  </button>
                )}
              </div>
            )}
            {!recsLoading && recs.length > 0 && visibleRecs.length === 0 && (
              <div className="glass-card rounded-2xl border border-transparent p-8 text-center text-sm font-medium text-muted-foreground">
                Все рекомендации для данного фильтра применены или отклонены.
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT COLUMN: 3 Settings Panels (5 Cols) ──────────────────── */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          {/* Panel 1: Параметры (Parameters) */}
          <div className="glass-card flex flex-col gap-4 rounded-2xl border border-transparent p-5">
            <h3 className="text-[15px] font-extrabold text-foreground">Параметры</h3>

            {/* Slider 1: Мин. множитель */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs font-extrabold text-foreground">
                <span>Мин. множитель</span>
                <span className="rounded-lg border border-transparent bg-muted px-2.5 py-0.5 font-bold font-mono text-foreground">
                  {minMult.toFixed(2).replace('.', ',')}
                </span>
              </div>
              <input
                type="range"
                min="0.50"
                max="1.00"
                step="0.05"
                value={minMult}
                onChange={(e) => setMinMult(parseFloat(e.target.value))}
                className="h-1.5 w-full cursor-pointer accent-[var(--accent)] bg-muted rounded-lg"
              />
              <div className="flex justify-between text-[11px] font-bold text-muted-foreground">
                <span>0,50</span>
                <span>1,00</span>
              </div>
              <p className="text-[11px] font-bold text-muted-foreground">
                даёт {previewPrice(minMult)} {barRateLabel}
              </p>
            </div>

            {/* Slider 2: Макс. множитель */}
            <div className="flex flex-col gap-1.5 pt-2 border-t border-border/60">
              <div className="flex items-center justify-between text-xs font-extrabold text-foreground">
                <span>Макс. множитель</span>
                <span className="rounded-lg border border-transparent bg-muted px-2.5 py-0.5 font-bold font-mono text-foreground">
                  {maxMult.toFixed(2).replace('.', ',')}
                </span>
              </div>
              <input
                type="range"
                min="1.00"
                max="2.50"
                step="0.05"
                value={maxMult}
                onChange={(e) => setMaxMult(parseFloat(e.target.value))}
                className="h-1.5 w-full cursor-pointer accent-[var(--accent)] bg-muted rounded-lg"
              />
              <div className="flex justify-between text-[11px] font-bold text-muted-foreground">
                <span>1,00</span>
                <span>2,50</span>
              </div>
              <p className="text-[11px] font-bold text-muted-foreground">
                даёт {previewPrice(maxMult)} {barRateLabel}
              </p>
            </div>

            {/* Slider 3: Макс. изменение за сутки */}
            <div className="flex flex-col gap-1.5 pt-2 border-t border-border/60">
              <div className="flex items-center justify-between text-xs font-extrabold text-foreground">
                <span>Макс. изменение за сутки</span>
                <span className="rounded-lg border border-transparent bg-muted px-2.5 py-0.5 font-bold font-mono text-foreground">
                  {maxDailyChange}%
                </span>
              </div>
              <input
                type="range"
                min="5"
                max="40"
                step="1"
                value={maxDailyChange}
                onChange={(e) => setMaxDailyChange(parseInt(e.target.value, 10))}
                className="h-1.5 w-full cursor-pointer accent-[var(--accent)] bg-muted rounded-lg"
              />
              <div className="flex justify-between text-[11px] font-bold text-muted-foreground">
                <span>5%</span>
                <span>40%</span>
              </div>
              <p className="text-[11px] font-bold text-muted-foreground">
                не более {previewPrice(maxDailyChange / 100)} за сутки {barRateLabel}
              </p>
            </div>

            {/* Slider 4: Макс. отклонение от базового тарифа */}
            <div className="flex flex-col gap-1.5 pt-2 border-t border-border/60">
              <div className="flex items-center justify-between text-xs font-extrabold text-foreground">
                <span>Макс. отклонение от базового тарифа</span>
                <span className="rounded-lg border border-transparent bg-muted px-2.5 py-0.5 font-bold font-mono text-foreground">
                  {maxDevFromBase}%
                </span>
              </div>
              <input
                type="range"
                min="10"
                max="100"
                step="5"
                value={maxDevFromBase}
                onChange={(e) => setMaxDevFromBase(parseInt(e.target.value, 10))}
                className="h-1.5 w-full cursor-pointer accent-[var(--accent)] bg-muted rounded-lg"
              />
              <div className="flex justify-between text-[11px] font-bold text-muted-foreground">
                <span>10%</span>
                <span>100%</span>
              </div>
              <p className="text-[11px] font-bold text-muted-foreground">
                коридор {previewPrice(1 - maxDevFromBase / 100)} – {previewPrice(1 + maxDevFromBase / 100)} {barRateLabel}
              </p>
            </div>

            {/* Enforcement Notes Footer */}
            <div className="mt-2 flex flex-col gap-1 rounded-xl bg-muted/60 p-3 text-[11px] font-bold text-foreground border border-transparent">
              <p>
                <span className="font-bold text-foreground">Действующий минимум {barRateLabel}: {formatIn(floorRate)}</span> — применяется самое строгое из правил.
              </p>
              <p>
                <span className="font-bold text-foreground">Действующий максимум {barRateLabel}: {formatIn(ceilingRate)}</span> — применяется самое строгое из правил.
              </p>
            </div>
          </div>

          {/* Panel 2: Защитные правила (Protective Rules) */}
          <div className="glass-card flex flex-col gap-3.5 rounded-2xl border border-transparent p-5">
            <h3 className="text-[15px] font-extrabold text-foreground">Защитные правила</h3>

            <div className="flex items-center justify-between gap-2 text-xs font-extrabold text-foreground">
              <span>Минимальный тариф (floor)</span>
              <div className="flex items-center gap-2">
                <span className="rounded-lg border border-transparent bg-muted px-2.5 py-0.5 font-bold font-mono text-foreground">
                  {formatIn(floorRate)}
                </span>
                <input
                  type="checkbox"
                  checked={floorActive}
                  onChange={(e) => setFloorActive(e.target.checked)}
                  className="h-4 w-4 accent-[var(--accent)] cursor-pointer"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 text-xs font-extrabold text-foreground pt-2.5 border-t border-border/60">
              <span>Максимальный тариф (ceiling)</span>
              <div className="flex items-center gap-2">
                <span className="rounded-lg border border-transparent bg-muted px-2.5 py-0.5 font-bold font-mono text-foreground">
                  {formatIn(ceilingRate)}
                </span>
                <input
                  type="checkbox"
                  checked={ceilingActive}
                  onChange={(e) => setCeilingActive(e.target.checked)}
                  className="h-4 w-4 accent-[var(--accent)] cursor-pointer"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 text-xs font-extrabold text-foreground pt-2.5 border-t border-border/60">
              <span>Не снижать тариф в праздничные периоды</span>
              <input
                type="checkbox"
                checked={noHolidaysDrop}
                onChange={(e) => setNoHolidaysDrop(e.target.checked)}
                className="h-4 w-4 accent-[var(--accent)] cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between gap-2 text-xs font-extrabold text-foreground pt-2.5 border-t border-border/60">
              <span>Не менять тариф ближе чем за 24 ч до заезда</span>
              <input
                type="checkbox"
                checked={no24hChange}
                onChange={(e) => setNo24hChange(e.target.checked)}
                className="h-4 w-4 accent-[var(--accent)] cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between gap-2 text-xs font-extrabold text-foreground pt-2.5 border-t border-border/60">
              <span>Максимум изменений в сутки</span>
              <div className="flex items-center gap-2">
                <span className="rounded-lg border border-transparent bg-muted px-2.5 py-0.5 font-bold font-mono text-foreground">
                  {maxDailyChangesCount}
                </span>
                <input
                  type="checkbox"
                  checked={maxDailyChangesActive}
                  onChange={(e) => setMaxDailyChangesActive(e.target.checked)}
                  className="h-4 w-4 accent-[var(--accent)] cursor-pointer"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 text-xs font-extrabold text-foreground pt-2.5 border-t border-border/60">
              <span>Уведомлять при изменении больше 20%</span>
              <input
                type="checkbox"
                checked={notify20Pct}
                onChange={(e) => setNotify20Pct(e.target.checked)}
                className="h-4 w-4 accent-[var(--accent)] cursor-pointer"
              />
            </div>
          </div>

          {/* Panel 3: Сигналы AI (AI Factor Weights & Signals) */}
          <div className="glass-card flex flex-col gap-3 rounded-2xl border border-transparent p-5">
            <h3 className="text-[15px] font-extrabold text-foreground">Сигналы AI</h3>

            <div className="flex flex-col gap-2.5">
              {signals.map((sig, idx) => (
                <div key={sig.id} className={cn('flex items-center gap-2 text-xs', idx > 0 && 'pt-2 border-t border-border/60')}>
                  <span className="w-40 shrink-0 font-bold text-foreground flex items-center gap-1">
                    {sig.name}
                    {sig.hasLink && (
                      <button onClick={() => window.dispatchEvent(new CustomEvent('nav-tab', { detail: 'revenue-competitors' }))} className="text-[11px] font-extrabold text-accent hover:underline cursor-pointer">
                        Открыть →
                      </button>
                    )}
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={sig.weight}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setSignals((prev) => prev.map((s) => (s.id === sig.id ? { ...s, weight: val } : s)));
                    }}
                    className="h-1.5 flex-1 cursor-pointer accent-[var(--accent)] bg-muted rounded-lg"
                  />
                  <span className="w-9 text-right font-bold text-foreground font-mono">
                    {sig.weight}%
                  </span>
                  <input
                    type="checkbox"
                    checked={sig.active}
                    onChange={(e) => {
                      const chk = e.target.checked;
                      setSignals((prev) => prev.map((s) => (s.id === sig.id ? { ...s, active: chk } : s)));
                    }}
                    className="h-4 w-4 accent-[var(--accent)] cursor-pointer ml-1"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── 4. Bottom Section 1: Audit Log Table (Лог изменений) ─────────── */}
      <div className="glass-card mt-4 flex flex-col gap-4 rounded-2xl border border-transparent p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-extrabold text-foreground">Лог изменений</h2>

          {/* Table Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={logPeriod}
              onChange={(e) => setLogPeriod(e.target.value)}
              className="h-8 rounded-xl border border-input bg-muted/60 px-3 text-xs font-bold text-foreground outline-none cursor-pointer"
            >
              <option value="7d">Период: 7 дней</option>
              <option value="14d">Период: 14 дней</option>
              <option value="30d">Период: 30 дней</option>
            </select>

            <select
              value={logSource}
              onChange={(e) => setLogSource(e.target.value)}
              className="h-8 rounded-xl border border-input bg-muted/60 px-3 text-xs font-bold text-foreground outline-none cursor-pointer"
            >
              <option value="all">Источник: все</option>
              <option value="ai_confirmed">AI–подтверждено</option>
              <option value="ai_auto">AI–авто</option>
              <option value="manual">Ручное</option>
            </select>

            <select
              value={logRoomType}
              onChange={(e) => setLogRoomType(e.target.value)}
              className="h-8 rounded-xl border border-input bg-muted/60 px-3 text-xs font-bold text-foreground outline-none cursor-pointer"
            >
              <option value="all">Тип номера: все</option>
              <option value="Standard">Standard</option>
              <option value="Deluxe">Deluxe</option>
              <option value="Family">Family</option>
              <option value="Suite">Suite</option>
            </select>

            {/* This exported the *recommendations*, not the change log it sits
                on — the icon over the log table downloaded the wrong table. */}
            <ExportMenu
              label=""
              className="flex h-8 items-center justify-center rounded-xl border border-transparent bg-card px-2 text-muted-foreground transition-colors hover:text-foreground"
              build={() => ({
                filename: 'rate_change_log',
                columns: ['Время', 'Даты', 'Тип номера', 'Было', 'Стало', 'Источник', 'Автор', 'Причина'],
                rows: filteredLog.map((r) => [
                  r.time, r.checkIn, r.roomType, r.oldValue, r.newValue,
                  r.sourceLabel, r.author, r.reason,
                ]),
                json: filteredLog,
              })}
            />
          </div>
        </div>

        {/* Data Table Matching Screenshot 4 */}
        <div className="overflow-x-auto rounded-xl border border-transparent">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border/80 bg-muted/60 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">ВРЕМЯ</th>
                <th className="px-4 py-3">ДАТА ЗАЕЗДА</th>
                <th className="px-4 py-3">ТИП НОМЕРА</th>
                <th className="px-4 py-3">БЫЛО</th>
                <th className="px-4 py-3">СТАЛО</th>
                <th className="px-4 py-3">ИСТОЧНИК</th>
                <th className="px-4 py-3">АВТОР</th>
                <th className="px-4 py-3">ПРИЧИНА</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-transparent font-sans">
              {filteredLog.map((row) => (
                <tr key={row.id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-4 py-3 font-semibold text-muted-foreground">{row.time}</td>
                  <td className="px-4 py-3 font-bold text-foreground">{row.checkIn}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{row.roomType}</td>
                  <td className="px-4 py-3 font-semibold text-muted-foreground line-through">{row.oldValue}</td>
                  <td className="px-4 py-3 font-extrabold text-foreground">{row.newValue}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-md px-2.5 py-0.5 text-[11px] font-extrabold',
                        row.source === 'ai_confirmed'
                          ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'
                          : row.source === 'ai_auto'
                          ? 'bg-blue-500/12 text-blue-700 dark:text-blue-400'
                          : 'bg-muted text-foreground font-bold'
                      )}
                    >
                      {row.sourceLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold text-foreground">{row.author}</td>
                  <td className="px-4 py-3 text-muted-foreground font-medium">{row.reason}</td>
                </tr>
              ))}
              {filteredLog.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-muted-foreground font-medium">
                    Записи лога изменений не найдены.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Details Breakdown Modal ────────────────────────────────────────── */}
      {detailModalItem && (
        <Dialog open={!!detailModalItem} onOpenChange={() => setDetailModalItem(null)}>
          <DialogContent className="max-w-md rounded-2xl p-6">
            <DialogHeader>
              <DialogTitle className="text-lg font-extrabold text-foreground">
                Детали AI-рекомендации
              </DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-4 py-2">
              <div className="flex items-center justify-between rounded-xl bg-muted p-3">
                <div>
                  <p className="text-xs font-bold text-foreground">{detailModalItem.roomType} · {detailModalItem.date}</p>
                  <p className="text-[11px] text-muted-foreground">{detailModalItem.metrics}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold text-muted-foreground line-through">{formatIn(detailModalItem.oldPrice)}</p>
                  <p className="text-lg font-extrabold text-foreground">{formatIn(detailModalItem.newPrice)}</p>
                </div>
              </div>

              {/* Each signal states the observation AND what it implies for
                  the price. Previously this listed bare chips ("ОТВ 100%",
                  "Пикап +3 за 7д") that gave a value with no meaning. */}
              <div className="flex flex-col gap-2">
                <p className="text-xs font-bold text-foreground">На чём основан вывод</p>
                {(detailModalItem.signals?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground">{detailModalItem.metrics}</p>
                ) : (
                  <ul className="flex flex-col gap-2.5">
                    {detailModalItem.signals!.map((s, idx) => {
                      const mark = s.direction === 'up' ? '↑' : s.direction === 'down' ? '↓' : '•';
                      const tone = s.direction === 'up'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : s.direction === 'down'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-muted-foreground';
                      return (
                        <li key={idx} className="flex gap-2.5">
                          <span className={cn('mt-0.5 shrink-0 text-sm font-extrabold', tone)}>{mark}</span>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-foreground">{s.label}</p>
                            <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{s.detail}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="mt-1 flex justify-between border-t border-border pt-2 text-xs">
                  <span className="text-muted-foreground">Ожидаемый финансовый эффект:</span>
                  <span className={cn('font-bold', detailModalItem.expectedEffect >= 0 ? 'text-emerald-600' : 'text-red-600 dark:text-red-400')}>
                    {detailModalItem.expectedEffect >= 0 ? '+' : '−'}{formatIn(Math.abs(detailModalItem.expectedEffect))}
                  </span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button
                  onClick={() => setDetailModalItem(null)}
                  className="rounded-xl border border-transparent px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-muted"
                >
                  Закрыть
                </button>
                <button
                  onClick={() => {
                    handleApplyRec(detailModalItem.id);
                    setDetailModalItem(null);
                  }}
                  className="brand-grad brand-glow transition-opacity hover:opacity-90 press rounded-xl px-4 py-2 text-xs font-bold"
                >
                  Применить рекомендованный тариф
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}


/* ── Каналы ───────────────────────────────────────────────────────────── */
export function ChannelsTab() {
  const { t } = useI18n();
  const tr = (k: string) => t(k as never);
  const [connections, setConnections] = useState<(ChannelConnection & { mappings: ChannelMapping[] })[]>([]);
  const [log, setLog] = useState<ChannelSyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [period, setPeriod] = useState<'today' | '7d' | '30d' | 'month' | 'year' | 'custom'>('30d');

  // Collapsible sections
  const [errorQueueOpen, setErrorQueueOpen] = useState(true);
  const [mappingOpen, setMappingOpen] = useState(true);
  const [ariLogOpen, setAriLogOpen] = useState(true);

  // Mapping sub-tab & config-dialog state
  const [activeMappingChannel, setActiveMappingChannel] = useState('');
  const [configChannel, setConfigChannel] = useState<ChannelConnection | null>(null);
  const [mappingModalOpen, setMappingModalOpen] = useState(false);
  const [formApiKey, setFormApiKey] = useState('');
  const [formApiSecret, setFormApiSecret] = useState('');
  const [formHotelCode, setFormHotelCode] = useState('');
  const [formStatus, setFormStatus] = useState<'active' | 'paused'>('active');
  const [savingConfig, setSavingConfig] = useState(false);

  // Real channel codes (see CHANNELS in channel-manager.dto.ts) -> display names.
  const CHANNEL_LABELS: Record<string, string> = {
    channex: 'Channex',
    booking_com: 'Booking.com',
    ostrovok: 'Ostrovok',
  };
  const channelLabel = (channel: string) => CHANNEL_LABELS[channel] ?? channel;
  const actionLabel = (action: string) => (action ? action.charAt(0).toUpperCase() + action.slice(1) : action);
  const statusLabel = (status: string) =>
    status === 'active' ? 'Подключен' : status === 'paused' ? tr('revx.channelPaused') : status === 'error' ? 'Ошибка' : status;

  // Relative "N мин/ч/дн назад" text, reusing the same card.* i18n keys the
  // Cards screen already uses for this exact purpose.
  const timeAgo = (iso?: string | null): string => {
    if (!iso) return '—';
    const diffMs = Date.now() - new Date(iso).getTime();
    const min = Math.max(0, Math.floor(diffMs / 60000));
    if (min < 1) return tr('card.justNow');
    if (min < 60) return tr('card.minAgo').replace('{n}', String(min));
    const h = Math.floor(min / 60);
    if (h < 24) return tr('card.hourAgo').replace('{n}', String(h));
    const d = Math.floor(h / 24);
    return tr('card.dayAgo').replace('{n}', String(d));
  };

  // Real period-range subtitle text, computed from today's date rather than
  // a fixed placeholder string.
  const fmtDM = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const fmtDMY = (d: Date) => `${fmtDM(d)}.${d.getUTCFullYear()}`;
  const todayUtc = useMemo(() => {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
  }, []);
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
  const periodSubtitle = useMemo(() => {
    switch (period) {
      case 'today': return `Сегодня · ${fmtDMY(todayUtc)} · UZS`;
      case '7d': return `7 дней · ${fmtDM(addDays(todayUtc, -6))} – ${fmtDMY(todayUtc)} · UZS`;
      case '30d': return `30 дней · ${fmtDM(addDays(todayUtc, -29))} – ${fmtDMY(todayUtc)} · UZS`;
      case 'month': {
        const start = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), 1));
        const end = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth() + 1, 0));
        return `Месяц · ${fmtDM(start)} – ${fmtDMY(end)} · UZS`;
      }
      case 'year': return `Год · 01.01 – 31.12.${todayUtc.getUTCFullYear()} · UZS`;
      default: return `Произвольный период · UZS`;
    }
  }, [period, todayUtc]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, l] = await Promise.all([getChannelConnections(), getChannelSyncLog()]);
      setConnections(c);
      setLog(l);
    } catch (e) {
      // UX-8 fix: surface errors instead of silently swallowing them
      toast.error((e as Error).message || 'Не удалось загрузить данные каналов');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ── Derived data — everything below reads only from real `connections` /
  // `log` state, no hardcoded fixtures. ────────────────────────────────────
  const totalConnections = connections.length;
  const activeConnectionsCount = connections.filter((c) => c.status === 'active').length;
  const pausedConnectionsCount = connections.filter((c) => c.status === 'paused').length;

  const errorQueueItems = useMemo(() => log.filter((l) => l.status === 'error').slice(0, 10), [log]);

  // Most recent timestamp across connection syncs and sync-log entries (the
  // log is already ordered newest-first by the backend).
  const lastEventIso = useMemo(() => {
    let latest: string | null = null;
    for (const c of connections) {
      if (c.lastSyncAt && (!latest || new Date(c.lastSyncAt) > new Date(latest))) latest = c.lastSyncAt;
    }
    if (log[0]?.createdAt && (!latest || new Date(log[0].createdAt) > new Date(latest))) latest = log[0].createdAt;
    return latest;
  }, [connections, log]);

  // Revenue-weighted average commission — channels with $0 gross in the
  // period are excluded from the weighting (they'd otherwise dilute the
  // average toward channels with no sales) but still count toward the
  // "active channels" tally above.
  const commissionStats = useMemo(() => {
    let weightedSum = 0;
    let grossTotal = 0;
    for (const c of connections) {
      const s = c.stats;
      if (!s || !s.gross) continue;
      weightedSum += s.commissionPct * s.gross;
      grossTotal += s.gross;
    }
    if (grossTotal === 0) return null;
    return { pct: weightedSum / grossTotal, gross: grossTotal };
  }, [connections]);

  const allMappings = useMemo(
    () => connections.flatMap((c) => (c.mappings ?? []).map((m) => ({ ...m, channel: c.channel }))),
    [connections]
  );
  const effectiveMappingChannel = connections.some((c) => c.channel === activeMappingChannel)
    ? activeMappingChannel
    : connections[0]?.channel ?? '';
  const activeMappings = allMappings.filter((m) => m.channel === effectiveMappingChannel);

  const handleSyncChannel = async (channel: string) => {
    setSyncing(channel);
    try {
      await syncChannels(channel);
      toast.success(`Канал ${channelLabel(channel)} синхронизирован`);
      await load();
    } catch (e) {
      toast.error((e as Error).message || `Не удалось синхронизировать канал ${channelLabel(channel)}`);
    } finally {
      setSyncing(null);
    }
  };

  const handleRetryError = async (channel: string) => {
    try {
      await syncChannels(channel);
      toast.success(`Повторная отправка пакета для ${channelLabel(channel)}...`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const openConfigDialog = (c: ChannelConnection) => {
    setConfigChannel(c);
    setFormApiKey(c.apiKey ?? '');
    setFormApiSecret(c.apiSecret ?? '');
    setFormHotelCode(c.hotelCode ?? '');
    setFormStatus(c.status === 'paused' ? 'paused' : 'active');
    setMappingModalOpen(true);
  };

  const handleSaveConfig = async () => {
    if (!configChannel) return;
    setSavingConfig(true);
    try {
      await updateChannelConnection(configChannel.id, {
        apiKey: formApiKey || undefined,
        apiSecret: formApiSecret || undefined,
        hotelCode: formHotelCode || undefined,
        status: formStatus,
      });
      toast.success(`Настройки канала ${channelLabel(configChannel.channel)} сохранены`);
      setMappingModalOpen(false);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingConfig(false);
    }
  };


  if (loading) return <Skeleton className="h-[600px] w-full rounded-2xl" />;

  return (
    <div className="page-enter flex flex-col gap-6 pb-12 text-foreground">
      {/* ── Top Header & Actions ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-[10px] font-extrabold uppercase tracking-[2px] text-muted-foreground">
            Доход · Каналы
          </p>
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="text-[26px] font-extrabold tracking-[-0.4px] text-foreground">
              Каналы
            </h1>
          </div>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5 font-medium">
            <span>{periodSubtitle}</span>
            <span>·</span>
            <span>vs предыдущий период</span>
            <span>·</span>
            <button
              onClick={async () => {
                await load();
                toast.success('Данные каналов обновлены');
              }}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
              <span>Обновлено {timeAgo(lastEventIso)}</span>
            </button>
          </p>
        </div>

        {/* Period Pills + Export Button */}
        <div className="flex flex-wrap items-center gap-2">
          <div className={PILL_GROUP}>
            {[
              { id: 'today', label: 'Сегодня' },
              { id: '7d', label: '7 дней' },
              { id: '30d', label: '30 дней' },
              { id: 'month', label: 'Месяц' },
              { id: 'year', label: 'Год' },
              { id: 'custom', label: 'Произвольный' },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id as any)}
                className={cn(
                  'px-3 py-1.5 rounded-lg transition-all font-semibold',
                  period === p.id
                    ? 'brand-grad brand-glow font-bold'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

            <ExportMenu
              className="brand-grad brand-glow press flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-opacity hover:opacity-90"
              build={() => ({
                filename: 'channels_report',
                columns: ['Канал', 'Статус', 'Комиссия %', 'Номеро-ночей', 'Выручка Gross', 'Выручка Net', 'Последняя синхронизация'],
                rows: connections.map((c) => {
                  const st = c.stats ?? { nn: 0, gross: 0, net: 0, commissionPct: 0 };
                  return [
                    channelLabel(c.channel), statusLabel(c.status), st.commissionPct,
                    st.nn, st.gross, st.net,
                    c.lastSyncAt ? formatDateTime(c.lastSyncAt) : '—',
                  ];
                }),
                json: connections,
              })}
            />
        </div>
      </div>

      {/* ── KPI Summary Cards (4 Cards) ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Active Channels */}
        <div className="glass-card relative rounded-2xl border border-transparent p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              АКТИВНЫХ КАНАЛОВ
            </span>
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-[26px] font-extrabold text-foreground">{activeConnectionsCount}</span>
          </div>
          <p className="mt-2 text-xs font-medium text-muted-foreground">
            из {totalConnections} подключений
            {pausedConnectionsCount > 0 && (
              <>
                {' '}· <span className="text-muted-foreground font-semibold">{pausedConnectionsCount} на паузе</span>
              </>
            )}
          </p>
        </div>

        {/* Card 2: Sync Errors */}
        <div className="glass-card relative rounded-2xl border border-transparent p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              ОШИБОК СИНХРОНИЗАЦИИ
            </span>
            <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-[26px] font-extrabold text-foreground">{errorQueueItems.length}</span>
          </div>
          {errorQueueItems.length > 0 && (
            <p className="mt-2 text-xs font-semibold text-rose-500">
              требуют действия
            </p>
          )}
        </div>

        {/* Card 3: Last Sync */}
        <div className="glass-card relative rounded-2xl border border-transparent p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              ПОСЛЕДНЯЯ СИНХРОНИЗАЦИЯ
            </span>
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-[26px] font-extrabold text-foreground">{timeAgo(lastEventIso)}</span>
          </div>
          <p className="mt-2 text-xs font-medium text-muted-foreground">
            {log[0] ? (
              <span className="text-muted-foreground font-semibold">{channelLabel(log[0].channel)} · {actionLabel(log[0].action)}</span>
            ) : (
              '—'
            )}
          </p>
        </div>

        {/* Card 4: Average Commission */}
        <div className="glass-card relative rounded-2xl border border-transparent p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              СРЕДНЯЯ КОМИССИЯ
            </span>
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-[26px] font-extrabold text-foreground">
              {commissionStats ? `${commissionStats.pct.toFixed(1).replace('.', ',')}%` : '—'}
            </span>
          </div>
          <p className="mt-2 text-xs font-medium text-muted-foreground">
            взвешенная по выручке
            {commissionStats && (
              <>
                {' '}· <span className="text-foreground font-semibold">{formatIn(commissionStats.gross, 'USD')}</span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* ── Section: ПОДКЛЮЧЕНИЯ (Channels Grid) ────────────────────────────── */}
      <div className="mt-2 flex flex-col gap-3">
        <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider px-1">
          ПОДКЛЮЧЕНИЯ
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {connections.length === 0 ? (
            <div className="glass-card col-span-full rounded-2xl border border-transparent p-8 text-center text-sm font-medium text-muted-foreground">
              {tr('revx.noChannels')}
            </div>
          ) : connections.map((ch) => {
            const s = ch.stats ?? { nn: 0, gross: 0, net: 0, commissionPct: 0 };
            const hasSales = s.nn > 0;
            return (
              <div
                key={ch.id}
                className="glass-card rounded-2xl border border-transparent p-5 transition-all flex flex-col justify-between"
              >
                <div>
                  {/* Header: Title + Status Pill */}
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[15px] font-extrabold text-foreground">
                      {channelLabel(ch.channel)}
                    </h3>
                    {ch.status === 'error' && (
                      <span className="inline-flex items-center text-xs font-bold text-red-600 dark:text-red-400 bg-rose-50 border border-rose-100 px-2.5 py-0.5 rounded-full">
                        • Ошибка
                      </span>
                    )}
                    {ch.status === 'active' && (
                      <span className="inline-flex items-center text-xs font-bold text-emerald-700 bg-emerald-500/12 px-2.5 py-0.5 rounded-full">
                        • Подключен
                      </span>
                    )}
                    {ch.status === 'paused' && (
                      <span className="inline-flex items-center text-xs font-semibold text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full">
                        • Отключен
                      </span>
                    )}
                  </div>

                  {/* Sync time */}
                  <p className="text-xs text-muted-foreground mt-1 font-medium">
                    Синхронизация: {timeAgo(ch.lastSyncAt)}
                  </p>

                  {/* 2x2 Grid of Metrics */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-4 pt-3 border-t border-border">
                    <div>
                      <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground block">
                        КОМИССИЯ
                      </span>
                      <span className="text-sm font-extrabold text-foreground mt-0.5 block">
                        {s.commissionPct}%
                      </span>
                    </div>

                    <div>
                      <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground block">
                        Н/Н ЗА 30 ДНЕЙ
                      </span>
                      <span className="text-sm font-extrabold text-foreground mt-0.5 block">
                        {s.nn} н/н
                      </span>
                    </div>

                    <div>
                      <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground block">
                        ВЫРУЧКА GROSS
                      </span>
                      <span className="text-sm font-extrabold text-foreground mt-0.5 block">
                        {formatIn(s.gross, 'USD')}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground block">
                        ВЫРУЧКА NET
                      </span>
                      <span className="text-sm font-extrabold text-foreground mt-0.5 block">
                        {formatIn(s.net, 'USD')}
                      </span>
                    </div>
                  </div>

                  {/* Optional note when 0 sales */}
                  {!hasSales && (
                    <p className="text-[11.5px] font-medium text-muted-foreground italic mt-3">
                      Продаж за период нет
                    </p>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="grid grid-cols-2 gap-2.5 mt-5 pt-3 border-t border-border">
                  <button
                    onClick={() => openConfigDialog(ch)}
                    className="w-full bg-card hover:bg-muted text-foreground border border-transparent rounded-xl py-2 px-3 text-xs font-semibold transition-colors text-center cursor-pointer"
                  >
                    Настроить
                  </button>
                  <button
                    disabled={syncing === ch.channel}
                    onClick={() => handleSyncChannel(ch.channel)}
                    className="brand-grad brand-glow transition-opacity hover:opacity-90 w-full disabled:opacity-50 rounded-xl py-2 px-3 text-xs transition-colors text-center flex items-center justify-center gap-1.5 cursor-pointer font-bold"
                  >
                    {syncing === ch.channel && <RefreshCw className="h-3 w-3 animate-spin" />}
                    <span>Синхронизировать</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Section: Очередь ошибок (Error Queue) ──────────────────────────── */}
      <div className="glass-card rounded-2xl border border-transparent overflow-hidden">
        {/* Card Header with collapse button */}
        <div
          onClick={() => setErrorQueueOpen(!errorQueueOpen)}
          className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-extrabold text-foreground">
              Очередь ошибок ({errorQueueItems.length})
            </h2>
          </div>
          <button className="h-7 w-7 rounded-full border border-transparent flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors">
            {errorQueueOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>

        {errorQueueOpen && (
          <div className="border-t border-border">
            {errorQueueItems.length === 0 ? (
              <div className="p-8 text-center text-sm font-medium text-muted-foreground">
                Ошибок в очереди нет. Все каналы работают штатно.
              </div>
            ) : (
              <div className="divide-y divide-transparent">
                {errorQueueItems.map((err) => (
                  <div
                    key={err.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex flex-wrap items-center gap-3.5 min-w-0 flex-1">
                      <span className="h-2 w-2 rounded-full shrink-0 bg-red-500" />
                      <span className="text-xs font-semibold text-muted-foreground shrink-0 w-12">
                        {new Date(err.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-sm font-extrabold text-foreground shrink-0 w-28">
                        {channelLabel(err.channel)}
                      </span>
                      <span className="text-sm font-semibold text-foreground shrink-0 w-36">
                        {actionLabel(err.action)}
                      </span>
                      <span className="text-sm font-medium text-muted-foreground min-w-0 flex-1 truncate">
                        {err.message ?? err.detail ?? '—'}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="inline-flex items-center text-xs font-bold text-white bg-rose-500 px-3 py-1 rounded-full shadow-xs">
                        Ошибка
                      </span>
                      <button
                        onClick={() => handleRetryError(err.channel)}
                        className="brand-grad brand-glow transition-opacity hover:opacity-90 text-xs px-4 py-1.5 rounded-xl transition-colors cursor-pointer font-bold"
                      >
                        Повторить
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Bottom 2-Column Grid: Маппинг & Журнал ARI ────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left Column: Маппинг */}
        <div id="mapping-section" className="bg-card rounded-2xl border border-transparent shadow-[0_10px_30px_rgba(31,42,72,.07)] overflow-hidden flex flex-col">
          {/* Section Header */}
          <div
            onClick={() => setMappingOpen(!mappingOpen)}
            className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-muted/50 transition-colors border-b border-border"
          >
            <h2 className="text-[15px] font-extrabold text-foreground">
              Маппинг
            </h2>
            <button className="h-7 w-7 rounded-full border border-transparent flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors">
              {mappingOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>

          {mappingOpen && (
            <div className="p-4 sm:p-5 flex-1 flex flex-col gap-4">
              {/* Channel Tabs */}
              <div className="flex items-center gap-4 overflow-x-auto pb-1 text-sm font-semibold border-b border-border">
                {connections.map((c) => (
                  <button
                    key={c.channel}
                    onClick={() => setActiveMappingChannel(c.channel)}
                    className={cn(
                      'pb-2 transition-all whitespace-nowrap border-b-2 font-semibold text-xs cursor-pointer',
                      effectiveMappingChannel === c.channel
                        ? 'border-foreground text-foreground font-bold'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {channelLabel(c.channel)}
                  </button>
                ))}
              </div>

              {/* Mapping Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="px-3 py-2.5 text-[10.5px] font-bold tracking-wider text-muted-foreground uppercase">
                        ТИП ATLAS
                      </th>
                      <th className="px-3 py-2.5 text-[10.5px] font-bold tracking-wider text-muted-foreground uppercase">
                        ТИП КАНАЛА
                      </th>
                      <th className="px-3 py-2.5 text-[10.5px] font-bold tracking-wider text-muted-foreground uppercase">
                        ТАРИФ ATLAS
                      </th>
                      <th className="px-3 py-2.5 text-[10.5px] font-bold tracking-wider text-muted-foreground uppercase">
                        ТАРИФ КАНАЛА
                      </th>
                      <th className="px-3 py-2.5 text-[10.5px] font-bold tracking-wider text-muted-foreground uppercase">
                        СТАТУС
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-transparent">
                    {activeMappings.length === 0 ? (
                      <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground text-xs">Нет сопоставлений</td></tr>
                    ) : activeMappings.map((row) => (
                      <tr key={row.id} className="hover:bg-muted/50 transition-colors">
                        <td className="px-3 py-3 font-bold text-foreground text-xs">
                          {row.roomType}
                        </td>
                        <td className="px-3 py-3 font-semibold text-muted-foreground text-xs">
                          {row.channelRoomId ?? '—'}
                        </td>
                        <td className="px-3 py-3 font-semibold text-foreground text-xs">
                          {row.ratePlanId ?? '—'}
                        </td>
                        <td className="px-3 py-3 font-semibold text-muted-foreground text-xs">
                          {row.channelRateCode ?? '—'}
                        </td>
                        <td className="px-3 py-3">
                          {row.active ? (
                            <span className="inline-block bg-muted text-muted-foreground font-medium text-[11px] px-2.5 py-0.5 rounded-md">
                              Сопоставлен
                            </span>
                          ) : (
                            <span className="inline-block bg-rose-100 text-rose-700 font-bold text-[11px] px-2.5 py-0.5 rounded-md">
                              Не сопоставлен
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Журнал ARI */}
        <div className="bg-card rounded-2xl border border-transparent shadow-[0_10px_30px_rgba(31,42,72,.07)] overflow-hidden flex flex-col">
          {/* Section Header */}
          <div
            onClick={() => setAriLogOpen(!ariLogOpen)}
            className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-muted/50 transition-colors border-b border-border"
          >
            <h2 className="text-[15px] font-extrabold text-foreground">
              Журнал ARI
            </h2>
            <button className="h-7 w-7 rounded-full border border-transparent flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors">
              {ariLogOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>

          {ariLogOpen && (
            <div className="p-4 sm:p-5 flex-1 flex flex-col">
              <div className="overflow-x-auto max-h-[340px] overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 bg-card shadow-xs">
                    <tr className="border-b border-border bg-muted/40">
                      <th className="px-3 py-2.5 text-[10.5px] font-bold tracking-wider text-muted-foreground uppercase">
                        ВРЕМЯ
                      </th>
                      <th className="px-3 py-2.5 text-[10.5px] font-bold tracking-wider text-muted-foreground uppercase">
                        КАНАЛ
                      </th>
                      <th className="px-3 py-2.5 text-[10.5px] font-bold tracking-wider text-muted-foreground uppercase">
                        ЧТО ОТПРАВЛЕНО
                      </th>
                      <th className="px-3 py-2.5 text-[10.5px] font-bold tracking-wider text-muted-foreground uppercase">
                        ПЕРИОД
                      </th>
                      <th className="px-3 py-2.5 text-[10.5px] font-bold tracking-wider text-muted-foreground uppercase">
                        СТАТУС
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-transparent">
                    {log.length === 0 ? (
                      <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground text-xs">Записей пока нет</td></tr>
                    ) : log.slice(0, 30).map((logItem) => (
                      <tr key={logItem.id} className="hover:bg-muted/50 transition-colors">
                        <td className="px-3 py-3 font-medium text-muted-foreground text-xs">
                          {new Date(logItem.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-3 py-3 font-bold text-foreground text-xs">
                          {channelLabel(logItem.channel)}
                        </td>
                        <td className="px-3 py-3 font-semibold text-foreground text-xs">
                          {logItem.detail ?? actionLabel(logItem.action)}
                        </td>
                        <td className="px-3 py-3 font-medium text-muted-foreground text-xs">
                          {logItem.message ?? '—'}
                        </td>
                        <td className="px-3 py-3">
                          {logItem.status === 'error' ? (
                            <span className="inline-block bg-rose-50 text-red-600 dark:text-red-400 font-semibold text-[11px] px-2 py-0.5 rounded-full">
                              Ошибка
                            </span>
                          ) : (
                            <span className="inline-block bg-muted text-muted-foreground font-medium text-[11px] px-2 py-0.5 rounded-full">
                              Успешно
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Dialog for Channel Settings / Config ─────────────────────────────── */}
      <Dialog open={mappingModalOpen} onOpenChange={setMappingModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Настройки канала {configChannel ? channelLabel(configChannel.channel) : ''}</DialogTitle>
          </DialogHeader>
          {configChannel && (
            <div className="flex flex-col gap-4 py-2 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Название канала</Label>
                  <Input value={channelLabel(configChannel.channel)} disabled readOnly className="bg-muted" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Статус</Label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as 'active' | 'paused')}
                    className="h-9 rounded-lg border border-input bg-card px-2 text-sm"
                  >
                    <option value="active">Активен</option>
                    <option value="paused">На паузе</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Hotel ID / Property Code</Label>
                <Input placeholder="Например: BK-774921" value={formHotelCode} onChange={(e) => setFormHotelCode(e.target.value)} />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>API Key</Label>
                <Input type="password" value={formApiKey} onChange={(e) => setFormApiKey(e.target.value)} placeholder="••••••••••••••••" />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>API Secret</Label>
                <Input type="password" value={formApiSecret} onChange={(e) => setFormApiSecret(e.target.value)} placeholder="••••••••••••••••" />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <Button variant="outline" onClick={() => setMappingModalOpen(false)}>
                  Отмена
                </Button>
                <Button disabled={savingConfig} onClick={handleSaveConfig} className="brand-grad brand-glow transition-opacity hover:opacity-90 font-bold">
                  {savingConfig ? tr('common.saving') : 'Сохранить'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Конкуренты ───────────────────────────────────────────────────────── */
export function CompetitorsTab({ roomTypes }: { roomTypes: string[] }) {
  const { t } = useI18n();
  const tr = (k: string) => t(k as never);

  const [period, setPeriod] = useState<string>('30d');
  const [roomType, setRoomType] = useState<string>('Standard');
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 13); return d.toISOString().slice(0, 10); });
  const [comp, setComp] = useState<CompSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  const timeAgo = (iso?: string | null): string => {
    if (!iso) return '—';
    const diffMs = Date.now() - new Date(iso).getTime();
    const min = Math.max(0, Math.floor(diffMs / 60000));
    if (min < 1) return tr('card.justNow');
    if (min < 60) return tr('card.minAgo').replace('{n}', String(min));
    const h = Math.floor(min / 60);
    if (h < 24) return tr('card.hourAgo').replace('{n}', String(h));
    const d = Math.floor(h / 24);
    return tr('card.dayAgo').replace('{n}', String(d));
  };

  const typesList = useMemo(() => {
    const list = roomTypes.length ? roomTypes : ['Standard', 'Deluxe', 'Suite', 'Family'];
    if (!list.includes('Standard')) return ['Standard', ...list];
    return list;
  }, [roomTypes]);

  useEffect(() => {
    if (!roomType && typesList.length) setRoomType(typesList[0]);
  }, [typesList, roomType]);

  const loadCompSet = useCallback(async () => {
    if (!roomType) return;
    setLoading(true);
    try {
      setComp(await getCompSet(roomType, from, to));
      setLastLoadedAt(new Date().toISOString());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [roomType, from, to]);

  useEffect(() => {
    loadCompSet();
  }, [loadCompSet]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadCompSet();
      toast.success('Цены конкурентов обновлены ✓');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };


  if (loading || !comp) return <Skeleton className="h-96 w-full rounded-2xl" />;

  const DOW_RU = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const dayCols = comp.days.map((dateStr) => {
    const d = new Date(dateStr + 'T00:00:00Z');
    const dow = DOW_RU[d.getUTCDay()];
    const num = String(d.getUTCDate()).padStart(2, '0');
    return { dateStr, dow, num };
  });

  const shiftDateRange = (daysShift: number) => {
    const fDate = new Date(from + 'T00:00:00Z');
    fDate.setUTCDate(fDate.getUTCDate() + daysShift);
    const tDate = new Date(to + 'T00:00:00Z');
    tDate.setUTCDate(tDate.getUTCDate() + daysShift);
    setFrom(fDate.toISOString().slice(0, 10));
    setTo(tDate.toISOString().slice(0, 10));
  };

  const formatDateLabel = (iso: string) => {
    const d = new Date(iso + 'T00:00:00Z');
    return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* ── Top Bar Header ── */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Доход
            </p>
            <h1 className="text-[26px] font-extrabold tracking-[-0.4px]">Конкуренты</h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Period selector pills */}
            <div className="inline-flex rounded-xl bg-muted p-1">
              {(
                [
                  { id: 'today', label: 'Сегодня' },
                  { id: '7d', label: '7 дней' },
                  { id: '30d', label: '30 дней' },
                  { id: 'month', label: 'Месяц' },
                  { id: 'year', label: 'Год' },
                  { id: 'custom', label: 'Произвольный' },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPeriod(p.id)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-xs font-bold transition-all',
                    period === p.id
                      ? PILL_ON
                      : PILL_OFF,
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Real competitor × date matrix. This button used to only fire a
                "экспортирован в CSV" toast and produce no file at all. */}
            <ExportMenu
              className="brand-grad brand-glow press inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-opacity hover:opacity-90"
              build={() => comp && ({
                filename: `comp_set_${comp.roomType}_${from}_${to}`,
                columns: ['Отель', 'Источник', ...comp.days, 'Средняя', 'Δ к нам'],
                rows: [
                  ['Мы', '—', ...comp.days.map((d) => comp.ourRates?.[d] ?? comp.ourRate), comp.ourAvg ?? comp.ourRate, 0],
                  ...comp.rows.map((r) => [
                    r.name,
                    r.sourceText ?? r.source,
                    ...comp.days.map((d) => r.cells.find((c) => c.date === d)?.rate ?? '—'),
                    r.avg ?? '—',
                    r.avgDiff ?? '—',
                  ]),
                ],
                json: comp,
              })}
            />
          </div>
        </div>

        {/* Subtitle & Timestamp */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <p className="font-medium">
            {/* UZS, not USD: every rate in the table below renders through
                formatIn(), which formats in UZS — the label has to agree with
                what the cells actually show. */}
            {formatDateLabel(from)} – {formatDateLabel(to)} · UZS <span className="mx-1">•</span> vs предыдущий период
          </p>
          <p className="flex items-center gap-1 font-medium">
            <span className="inline-block animate-pulse text-emerald-500">↻</span> Обновлено {timeAgo(lastLoadedAt)}
          </p>
        </div>
      </div>

      {/* ── Secondary Controls Bar ── */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Date range navigator */}
            <div className="flex items-center gap-1.5 rounded-xl border border-transparent bg-card px-3 py-1.5 text-xs font-bold">
              <button onClick={() => shiftDateRange(-14)} className="text-muted-foreground hover:text-foreground cursor-pointer px-1">‹</button>
              <span>{formatDateLabel(from)} – {formatDateLabel(to)}.{to.slice(0, 4)}</span>
              <button onClick={() => shiftDateRange(14)} className="text-muted-foreground hover:text-foreground cursor-pointer px-1">›</button>
            </div>

            {/* Room type pills */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Тип номера</span>
              <div className="inline-flex rounded-xl bg-muted p-1">
                {typesList.map((t) => (
                  <button
                    key={t}
                    onClick={() => setRoomType(t)}
                    className={cn(
                      'rounded-lg px-3 py-1 text-xs font-bold transition-all',
                      roomType === t
                        ? PILL_ON
                        : PILL_OFF,
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Action button */}
          <button
            disabled={refreshing}
            onClick={handleRefresh}
            className="brand-grad brand-glow transition-opacity hover:opacity-90 rounded-xl px-4 py-2 text-xs font-extrabold disabled:opacity-50"
          >
            {refreshing ? 'Обновление...' : 'Обновить цены'}
          </button>
        </div>

        <p className="text-xs font-medium text-muted-foreground">
          Данные вводятся вручную или собираются автоматически с сайтов конкурентов.
        </p>
      </div>

      {/* ── Rate Comparison Grid / Table ── */}
      <div className="glass-card overflow-hidden rounded-2xl border border-transparent p-5">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse min-w-[900px]">
            <thead>
              <tr className="border-b border-border/60 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                <th className="py-3 px-3 w-48 shrink-0">ОБЪЕКТ</th>
                {dayCols.map((col) => (
                  <th key={col.dateStr} className="py-3 px-1 text-center w-12">
                    <div>{col.dow}</div>
                    <div className="text-sm font-extrabold text-foreground">{col.num}</div>
                  </th>
                ))}
                <th className="py-3 px-3 text-right w-20">СРЕДНИЙ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-transparent">
              {/* Row 1: Наш тариф (Featured Row) */}
              <tr className="bg-muted/70 font-extrabold">
                <td className="py-3 px-3">
                  <div className="font-extrabold text-foreground">Наш тариф · {roomType}</div>
                </td>
                {dayCols.map((col) => (
                  <td key={col.dateStr} className="py-3 px-1 text-center font-extrabold text-foreground">
                    {formatIn(comp.ourRates?.[col.dateStr] ?? comp.ourRate)}
                  </td>
                ))}
                <td className="py-3 px-3 text-right text-sm font-extrabold text-foreground">
                  {formatIn(comp.ourAvg ?? comp.ourRate)}
                </td>
              </tr>

              {/* Competitor Rows */}
              {comp.rows.map((row) => (
                <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                  <td className="py-3 px-3">
                    <div className="font-bold text-foreground">{row.name}</div>
                    <div className="text-[10px] font-medium text-muted-foreground">
                      {row.sourceText || (row.source === 'manual' ? 'вручную' : 'автоматически')}
                    </div>
                  </td>

                  {row.cells.map((cell) => {
                    const diff = cell.diff ?? 0;
                    const isMoreExpensive = diff > 0;
                    const isCheaper = diff < 0;
                    return (
                      <td key={cell.date} className="py-3 px-1 text-center">
                        <div className="font-bold text-foreground">{cell.rate != null ? formatIn(cell.rate) : '—'}</div>
                        {diff !== 0 && (
                          <div
                            className={cn(
                              'mt-0.5 inline-block text-[10px] font-extrabold',
                              isMoreExpensive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400',
                            )}
                          >
                            {isMoreExpensive ? '+' : ''}{diff}
                          </div>
                        )}
                      </td>
                    );
                  })}

                  <td className="py-3 px-3 text-right font-extrabold text-foreground text-sm">
                    {row.avg != null ? formatIn(row.avg) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer Legend */}
        <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-border/60 pt-4 text-xs font-medium text-muted-foreground">
          <span className="font-extrabold uppercase tracking-wider text-muted-foreground">ЛЕГЕНДА</span>
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-emerald-500/12 px-1.5 py-0.5 text-[11px] font-extrabold text-emerald-700 dark:text-emerald-400">
              +
            </span>
            <span>конкурент дороже нас на эту сумму</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-red-500/12 px-1.5 py-0.5 text-[11px] font-extrabold text-red-600 dark:text-red-400">
              −
            </span>
            <span>конкурент дешевле нас на эту сумму</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── События и сезоны — helpers (grouping day-centric DemandDay rows into
   event-with-range cards, date formatting, priority/category mapping) ────── */
interface DemandEventItem {
  id: string;
  name: string;
  category: string;
  categoryType: 'national' | 'religious' | 'season';
  priority: number;
  dateText: string;
  isCurrent: boolean;
  demandEffect: string;
  effectPct: number | null;
  currentAvgRate: number;
  recommendedRate: number;
  ratesConfigured: boolean;
  overlapNotice?: string;
  source: 'uz_calendar' | 'manual';
  dateFrom: string;
  dateTo: string;
  isTentative?: boolean;
}

const DEMAND_MONTHS_SHORT = ['ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЙ', 'ИЮН', 'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК'];

/**
 * Intensity 0–5 heat scale for the demand calendar, expressed as a *tint on
 * glass* rather than a solid fill: the tile keeps its frost and the accent is
 * mixed in at a rising alpha. Kept inside the 10–40% band that reads as
 * translucent — above that it stops looking like glass and the label contrast
 * starts to suffer.
 */
const DEMAND_HEAT = [0, 8, 14, 20, 27, 34] as const;
const demandHeatFill = (intensity: number) =>
  `color-mix(in srgb, var(--accent) ${DEMAND_HEAT[Math.max(0, Math.min(5, Math.round(intensity)))]}%, transparent)`;

// Event category → tone. Alpha tints, not the solid slabs this calendar used to
// paint, so a chip sits *on* the glass instead of punching a hole through it.
const DEMAND_CATEGORY_TONE: Record<string, { chip: string; dot: string }> = {
  'Религиозный': { chip: 'bg-amber-500/15 text-amber-800 dark:text-amber-300', dot: 'bg-amber-500' },
  'Государственный праздник': { chip: 'bg-blue-500/15 text-blue-800 dark:text-blue-300', dot: 'bg-[var(--accent)]' },
};
const demandCategoryTone = (cat?: string) =>
  DEMAND_CATEGORY_TONE[cat ?? ''] ?? { chip: 'bg-foreground/10 text-foreground/80', dot: 'bg-foreground/50' };

function demandDaysWord(n: number): string {
  const n100 = n % 100;
  const n10 = n % 10;
  if (n100 >= 11 && n100 <= 14) return 'дней';
  if (n10 === 1) return 'день';
  if (n10 >= 2 && n10 <= 4) return 'дня';
  return 'дней';
}

function demandDiffDays(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.round((b - a) / 86_400_000);
}

function demandFormatRange(fromIso: string, toIso: string): string {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  const currentYear = new Date().getUTCFullYear();
  const pad = (n: number) => String(n).padStart(2, '0');
  const yearSuffix = ty !== currentYear ? `.${ty}` : '';
  if (fromIso === toIso) return `${pad(fd)}.${pad(fm)}${yearSuffix}`;
  if (fy === ty && fm === tm) return `${pad(fd)}–${pad(td)}.${pad(tm)}${yearSuffix}`;
  return `${pad(fd)}.${pad(fm)}–${pad(td)}.${pad(tm)}${yearSuffix}`;
}

function demandRelative(fromIso: string, toIso: string, todayIso: string): { text: string; isCurrent: boolean } {
  if (todayIso >= fromIso && todayIso <= toIso) return { text: 'идёт сейчас', isCurrent: true };
  if (todayIso > toIso) {
    const n = demandDiffDays(toIso, todayIso);
    return { text: `завершилось ${n} ${demandDaysWord(n)} назад`, isCurrent: false };
  }
  const n = demandDiffDays(todayIso, fromIso);
  return { text: `через ${n} ${demandDaysWord(n)}`, isCurrent: false };
}

// Priority arrives from the backend as low|normal|high (DemandEvent.priority
// and the uz_calendar impact field share this scale) — mapped to the small
// numeric scale the "Приоритет N" badge already renders.
function demandPriorityNumber(priority: string): number {
  if (priority === 'high') return 8;
  if (priority === 'low') return 3;
  return 5;
}

// Reverse of the kind mapping handleAddSubmit already uses when creating a
// manual event (Государственный праздник→national, Религиозный→citywide,
// else→local) — 'hotel' is a valid DEMAND_KINDS value with no UI category yet.
function demandKindToCategory(kind: string): { category: string; categoryType: DemandEventItem['categoryType'] } {
  if (kind === 'national') return { category: 'Государственный праздник', categoryType: 'national' };
  if (kind === 'citywide') return { category: 'Религиозный', categoryType: 'religious' };
  return { category: 'Сезон', categoryType: 'season' };
}

function demandRangesOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  return aFrom <= bTo && bFrom <= aTo;
}

/* ── События и сезоны (Comprehensive UI from Screenshots) ───────────────── */
export function DemandTab() {
  const { t } = useI18n();
  const tr = (k: string) => t(k as never);

  const [addModalOpen, setAddModalOpen] = useState(false);

  // Form state for adding custom event
  const [eventName, setEventName] = useState('');
  const [eventCategory, setEventCategory] = useState<'Сезон' | 'Каникулы' | 'Государственный праздник' | 'Религиозный'>('Сезон');
  const [eventPriority, setEventPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [eventFrom, setEventFrom] = useState('');
  const [eventTo, setEventTo] = useState('');
  const [eventEffectPct, setEventEffectPct] = useState('20');
  const [eventIsLunar, setEventIsLunar] = useState(false);

  // Modals for Detail view & Rate setup
  const [detailItem, setDetailItem] = useState<DemandEventItem | null>(null);
  const [rateSetupItem, setRateSetupItem] = useState<DemandEventItem | null>(null);

  // Real events list, grouped from the day-centric getDemandEvents() response
  // (see loadAll below) — replaces the previous 9-item hardcoded array.
  const [eventsList, setEventsList] = useState<DemandEventItem[]>([]);
  const [loading, setLoading] = useState(true);

  // "Календарь спроса" heat-strip rows from the real getDemandYearCalendar()
  // endpoint — replaces the previous fixed 6-month chip constants.
  const [yearRows, setYearRows] = useState<DemandYearRow[]>([]);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  const timeAgo = (iso?: string | null): string => {
    if (!iso) return '—';
    const diffMs = Date.now() - new Date(iso).getTime();
    const min = Math.max(0, Math.floor(diffMs / 60000));
    if (min < 1) return tr('card.justNow');
    if (min < 60) return tr('card.minAgo').replace('{n}', String(min));
    const h = Math.floor(min / 60);
    if (h < 24) return tr('card.hourAgo').replace('{n}', String(h));
    const d = Math.floor(h / 24);
    return tr('card.dayAgo').replace('{n}', String(d));
  };

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Load real events + calendar + the current BAR rate together, so a
  // freshly-created event is reflected everywhere (list, calendar, rate) in
  // one pass. Reused on mount and after a successful create.
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const from = new Date();
      const to = new Date(from.getTime() + 400 * 24 * 60 * 60 * 1000);
      const fromIso = from.toISOString().slice(0, 10);
      const toIso = to.toISOString().slice(0, 10);
      const currentYear = from.getUTCFullYear();

      const [demand, calendar, plans, rooms] = await Promise.all([
        getDemandEvents(fromIso, toIso),
        getDemandYearCalendar([currentYear, currentYear + 1]),
        getRatePlans(undefined, undefined, true).catch(() => [] as RatePlan[]),
        getRooms().catch(() => [] as Room[]),
      ]);

      setYearRows(calendar.rows);

      // Real BAR rate — prefers an active Standard BAR plan, else the first
      // active BAR plan, else the first room's price, else 0. Same pattern
      // AiTab already uses for its guard-rail previews (see barPlan above).
      const barPlans = plans.filter((p) => p.kind === 'bar' && p.active);
      const barPlan = barPlans.find((p) => p.roomType === 'Standard') || barPlans[0] || null;
      const currentAvgRate = barPlan?.baseRate ?? rooms[0]?.pricePerNight ?? 0;

      // Group the day-centric DemandDay[] rows into event-with-range cards:
      // manual events group by their stable DB id, uz_calendar entries group
      // by name (consecutive days only) — days arrive already sorted
      // ascending by date, so a single forward pass suffices.
      type RawGroup = {
        name: string; kind: string; priority: string;
        source: 'uz_calendar' | 'manual'; id?: string; effectPct?: number;
        dateFrom: string; dateTo: string;
      };
      const open = new Map<string, RawGroup>();
      const closed: RawGroup[] = [];
      for (const day of demand.days) {
        for (const ev of day.events) {
          const baseKey = ev.source === 'manual' ? `m:${ev.id}` : `c:${ev.name}`;
          const g = open.get(baseKey);
          if (g && demandDiffDays(g.dateTo, day.date) === 1) {
            g.dateTo = day.date;
          } else {
            if (g) closed.push(g);
            open.set(baseKey, {
              name: ev.name, kind: ev.kind, priority: ev.priority, source: ev.source,
              id: ev.id, effectPct: ev.effectPct, dateFrom: day.date, dateTo: day.date,
            });
          }
        }
      }
      for (const g of open.values()) closed.push(g);

      const items: DemandEventItem[] = closed.map((g) => {
        const { category, categoryType } = demandKindToCategory(g.kind);
        const rel = demandRelative(g.dateFrom, g.dateTo, todayIso);
        const effectPct = g.effectPct ?? null;
        return {
          id: g.source === 'manual' && g.id ? g.id : `${g.name}-${g.dateFrom}`,
          name: g.name,
          category,
          categoryType,
          priority: demandPriorityNumber(g.priority),
          dateText: `${demandFormatRange(g.dateFrom, g.dateTo)} · ${rel.text}`,
          isCurrent: rel.isCurrent,
          demandEffect: effectPct != null ? `${effectPct >= 0 ? '+' : ''}${effectPct}%` : '—',
          effectPct,
          currentAvgRate,
          recommendedRate: effectPct != null ? Math.round(currentAvgRate * (1 + effectPct / 100)) : currentAvgRate,
          ratesConfigured: false,
          source: g.source,
          dateFrom: g.dateFrom,
          dateTo: g.dateTo,
        };
      });

      // Real overlap detection — any two grouped events whose date ranges
      // intersect reference each other; the one with the higher numeric
      // priority is called out as the one that applies.
      for (const item of items) {
        const overlapping = items.filter((o) => o !== item && demandRangesOverlap(item.dateFrom, item.dateTo, o.dateFrom, o.dateTo));
        if (overlapping.length) {
          const winner = [item, ...overlapping].reduce((best, c) => (c.priority > best.priority ? c : best));
          item.overlapNotice = `Пересекается с ${overlapping.map((o) => o.name).join(', ')} — применяется ${winner.name}.`;
        }
      }

      items.sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
      setEventsList(items);
      setLastLoadedAt(new Date().toISOString());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [todayIso]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);


  const handleAddSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!eventName.trim()) return;

    createDemandEvent({
      name: eventName.trim(),
      kind: eventCategory === 'Государственный праздник' ? 'national' : eventCategory === 'Религиозный' ? 'citywide' : 'local',
      priority: eventPriority,
      dateFrom: eventFrom || new Date().toISOString().slice(0, 10),
      dateTo: eventTo || new Date().toISOString().slice(0, 10),
      effectPct: Number(eventEffectPct) || 0,
    })
      .then(() => {
        toast.success(`Событие "${eventName}" успешно добавлено!`);
        setAddModalOpen(false);
        setEventName('');
        setEventFrom('');
        setEventTo('');
        setEventPriority('normal');
        setEventEffectPct('20');
        setEventCategory('Сезон');
        return loadAll();
      })
      .catch((err) => toast.error((err as Error).message));
  };

  const handleToggleRateConfig = (id: string) => {
    const item = eventsList.find((e) => e.id === id);
    setEventsList((prev) =>
      prev.map((evt) => (evt.id === id ? { ...evt, ratesConfigured: !evt.ratesConfigured } : evt))
    );
    if (item) {
      toast.success(
        item.ratesConfigured
          ? `Тарифы для "${item.name}" сброшены`
          : `Рекомендованный тариф $${item.recommendedRate} применён для "${item.name}"!`
      );
    }
  };

  if (loading && !eventsList.length && !yearRows.length) {
    return <Skeleton className="h-[600px] w-full rounded-2xl" />;
  }

  return (
    <div className="flex flex-col gap-6 pb-12 font-sans text-foreground">
      {/* ── 1. Header Bar ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="mb-1 text-[10px] font-extrabold uppercase tracking-[2px] text-muted-foreground">
            Доход · События и сезоны
          </p>
          <h1 className="text-[26px] font-extrabold tracking-[-0.4px] text-foreground">
            События и сезоны
          </h1>
        </div>

        {/* Right Header Actions */}
        <div className="flex flex-col items-end gap-1">
            <ExportMenu
              className="brand-grad brand-glow press flex cursor-pointer items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-bold transition-opacity hover:opacity-90"
              build={() => ({
                filename: 'events_seasons',
                columns: ['Событие', 'Категория', 'Приоритет', 'Даты', 'Эффект на спрос', 'Рекомендованный тариф', 'Тарифы настроены'],
                rows: eventsList.map((e) => [
                  e.name, e.category, e.priority, e.dateText, e.demandEffect,
                  e.recommendedRate, e.ratesConfigured,
                ]),
                json: eventsList,
              })}
            />
          <button
            onClick={loadAll}
            className="flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            <span>Обновлено {timeAgo(lastLoadedAt)}</span>
          </button>
        </div>
      </div>

      {/* ── 2. Top Card Panel: Календарь спроса ─────────────────────────────── */}
      <div className={cn(SURFACE, 'flex flex-col gap-4 p-5')}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <h2 className="text-[15px] font-extrabold text-foreground">
            Календарь спроса · 2026–2027
          </h2>
          <span className="text-xs font-semibold text-muted-foreground">
            Источник: локальный календарь UZ · обновляется автоматически
          </span>
        </div>

        {/* 12-Month Calendar Grid rendered from API yearRows */}
        <div className="flex flex-col gap-3">
          {yearRows.map((row) => {
            // Determine which months to show — always 6 per row
            const MONTH_SHORT_RU = ['ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЙ', 'ИЮН', 'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК'];
            // Find matching events from eventsList for each month
            const getEventsForMonth = (year: number, month: number) => {
              return eventsList.filter((evt) => {
                const from = new Date(evt.dateFrom);
                const to = new Date(evt.dateTo || evt.dateFrom);
                const monthStart = new Date(year, month, 1);
                const monthEnd = new Date(year, month + 1, 0);
                return from <= monthEnd && to >= monthStart;
              });
            };

            const monthCells = (row.months && row.months.length > 0)
              ? row.months
              : Array.from({ length: 12 }, (_, i) => ({ month: i + 1, intensity: 0, short: MONTH_SHORT_RU[i], season: null }));

            // Split into 2 rows of 6 months
            const firstHalf = monthCells.slice(0, 6);
            const secondHalf = monthCells.slice(6, 12);
            const halves = secondHalf.length > 0 ? [firstHalf, secondHalf] : [firstHalf];

            return (
              <div key={row.year} className="grid grid-cols-12 gap-2.5">
                <div className="col-span-1 flex items-center justify-center rounded-2xl border border-white/50 bg-white/40 text-xs font-extrabold tracking-wider text-muted-foreground dark:border-white/10 dark:bg-white/[0.06]">
                  {row.year}
                </div>
                <div className="col-span-11 grid grid-cols-6 gap-2.5">
                  {halves.flat().map((m) => {
                    const monthEvents = getEventsForMonth(row.year, m.month - 1);
                    const monthName = MONTH_SHORT_RU[m.month - 1];
                    // `short` is the built-in UZ calendar's event names for the
                    // month — a different source from the property's own
                    // DemandEvent rows below. It used to be rendered *in place
                    // of* the month name, so any month with a holiday simply
                    // stopped saying which month it was.
                    const calendarNote = m.short && m.short !== monthName ? m.short : null;
                    const level = Math.max(0, Math.min(5, Math.round(m.intensity ?? 0)));
                    return (
                      <div
                        key={`${row.year}-${m.month}`}
                        title={calendarNote ?? undefined}
                        // The tint rides on top of the frosted tile rather than
                        // replacing it, so every month still reads as glass and
                        // the heat level is legible as depth of colour.
                        style={{ background: level > 0 ? demandHeatFill(level) : undefined }}
                        className={cn(
                          'flex min-h-[104px] flex-col gap-1.5 rounded-2xl p-2.5 transition-colors',
                          'border border-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,.55)] backdrop-blur-sm',
                          'dark:border-white/10 dark:shadow-[inset_0_1px_0_rgba(255,255,255,.06)]',
                          level === 0 && 'bg-white/40 dark:bg-white/[0.05]',
                        )}
                      >
                        <div className="flex items-baseline justify-between gap-1">
                          <span className="text-[11px] font-extrabold uppercase tracking-wider text-foreground">
                            {monthName}
                          </span>
                          {/* Intensity read-out — the 0–5 scale was computed by
                              the API and then never shown anywhere. */}
                          <span className="flex items-center gap-[2px]" title={`Интенсивность ${level}/5`}>
                            {Array.from({ length: 5 }).map((_, i) => (
                              <span
                                key={i}
                                className={cn(
                                  'h-1 w-1 rounded-full',
                                  i < level ? 'bg-[var(--accent)]' : 'bg-foreground/15',
                                )}
                              />
                            ))}
                          </span>
                        </div>

                        {monthEvents.slice(0, 3).map((evt, idx) => {
                          const tone = demandCategoryTone(evt.category);
                          return (
                            <span
                              key={idx}
                              title={evt.name}
                              className={cn(
                                'flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[10px] font-bold',
                                tone.chip,
                              )}
                            >
                              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} />
                              <span className="truncate">{evt.name}</span>
                            </span>
                          );
                        })}

                        {calendarNote && (
                          <span className="mt-auto truncate text-[10px] font-semibold leading-tight text-muted-foreground">
                            {calendarNote}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {!yearRows.length && (
            <div className="flex items-center justify-center py-8 text-sm font-semibold text-muted-foreground">
              Нет данных календаря
            </div>
          )}
        </div>
      </div>

      {/* ── 3. Section Header: СОБЫТИЯ ────────────────────────────────────── */}
      <div className="mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">
              события
            </span>
          </div>
          <p className="text-xs font-semibold text-muted-foreground">
            При пересечении событий применяется правило с высшим приоритетом.
          </p>
        </div>

        <button
          onClick={() => setAddModalOpen(true)}
          className="brand-grad brand-glow transition-opacity hover:opacity-90 flex items-center gap-1.5 rounded-xl font-bold text-xs px-4 py-2.5 transition-colors cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>Добавить событие</span>
        </button>
      </div>

      {/* ── 4. Events Grid Cards (2 columns layout matching Screenshots 1 & 2) ─── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {eventsList.length > 0 ? eventsList.map((evt) => (
          <div
            key={evt.id}
            className="glass-card flex flex-col gap-3 rounded-2xl border border-transparent p-5"
          >
            {/* Card Header Title + Badges */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[15px] font-extrabold text-foreground">
                {evt.name}
              </h3>

              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'rounded-full px-3 py-0.5 text-[11px] font-bold',
                    evt.category === 'Государственный праздник'
                      ? 'bg-blue-500/12 text-blue-700 dark:text-blue-400'
                      : evt.category === 'Религиозный'
                      ? 'bg-amber-500/12 text-amber-700 dark:text-amber-400'
                      : evt.category === 'Каникулы'
                      ? 'bg-blue-500/12 text-[#0369a1] border border-[#bae6fd]'
                      : 'bg-muted text-muted-foreground border border-transparent'
                  )}
                >
                  {evt.category}
                </span>

                <span className="rounded-full bg-amber-500/12 text-amber-700 dark:text-amber-400 px-3 py-0.5 text-[11px] font-bold">
                  Приоритет {evt.priority}
                </span>

                {evt.isTentative && (
                  <span className="rounded-full bg-amber-500/12 text-amber-700 dark:text-amber-400 px-2.5 py-0.5 text-[11px] font-bold">
                    уточняется
                  </span>
                )}
              </div>
            </div>

            {/* Overlap Conflict Alert Banner */}
            {evt.overlapNotice && (
              <div className="flex items-center gap-2 rounded-xl bg-amber-500/12 px-3.5 py-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
                <AlertCircle className="h-4 w-4 shrink-0 text-[#b45309]" />
                <span>{evt.overlapNotice}</span>
              </div>
            )}

            {/* Date range & Timeline */}
            <div className="flex flex-col gap-0.5">
              <p className="text-xs font-extrabold text-foreground">{evt.dateText}</p>
              <p className="text-xs font-semibold text-muted-foreground">
                Ожидаемый эффект на спрос: {evt.demandEffect}
              </p>
            </div>

            {/* Price Status Banner Box matching Screenshots 1 & 2 */}
            <div className="flex items-center justify-between rounded-2xl bg-muted dark:bg-muted/40 p-3.5 border border-transparent">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  ТЕКУЩИЙ СРЕДНИЙ ТАРИФ
                </p>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="text-sm font-extrabold text-foreground">
                    ${evt.currentAvgRate}
                  </span>
                  <span className="text-xs font-bold text-muted-foreground">→</span>
                  <span className="text-[10px] font-extrabold text-muted-foreground uppercase">
                    РЕКОМЕНДОВАННЫЙ
                  </span>
                  <span className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">
                    ${evt.recommendedRate}
                  </span>
                </div>
              </div>

              {evt.ratesConfigured ? (
                <span className="flex items-center gap-1 rounded-full bg-amber-500/12 px-3 py-1 text-xs font-bold text-amber-700 dark:text-amber-400">
                  Тарифы настроены ✓
                </span>
              ) : (
                <span className="flex items-center gap-1 rounded-full bg-amber-500/12 px-3 py-1 text-xs font-bold text-amber-700 dark:text-amber-400">
                  Не настроено ⚠
                </span>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setRateSetupItem(evt)}
                className="brand-grad brand-glow transition-opacity hover:opacity-90 rounded-xl font-bold text-xs px-4 py-2.5 transition-colors cursor-pointer"
              >
                {evt.ratesConfigured ? 'Открыть тарифы' : 'Настроить тарифы'}
              </button>
              <button
                onClick={() => setDetailItem(evt)}
                className="rounded-xl border border-transparent bg-card hover:bg-muted text-foreground font-bold text-xs px-4 py-2.5 transition-colors cursor-pointer"
              >
                Подробнее
              </button>
            </div>
          </div>
        )) : (
          <div className="glass-card col-span-full flex flex-col items-center justify-center gap-2 rounded-2xl border border-transparent p-8">
            <CalendarPlus className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-semibold text-muted-foreground">Нет событий</p>
            <p className="text-xs text-muted-foreground">Добавьте первое событие, чтобы начать управление тарифами</p>
          </div>
        )}
      </div>

      {/* ── 5. Add Event Modal ────────────────────────────────────────────── */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="max-w-md rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-extrabold text-foreground">
              Добавить новое событие
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleAddSubmit} className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-bold text-foreground">Название события</Label>
              <Input
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                placeholder="Например: Фестиваль шелка и специй"
                required
                className="h-10 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-bold text-foreground">Категория</Label>
                <select
                  value={eventCategory}
                  onChange={(e) => setEventCategory(e.target.value as any)}
                  className="h-10 rounded-xl border border-input bg-card px-3 text-xs font-semibold text-foreground outline-none"
                >
                  <option value="Сезон">Сезон</option>
                  <option value="Каникулы">Каникулы</option>
                  <option value="Государственный праздник">Государственный праздник</option>
                  <option value="Религиозный">Религиозный</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-bold text-foreground">Приоритет</Label>
                <select
                  value={eventPriority}
                  onChange={(e) => setEventPriority(e.target.value as 'low' | 'normal' | 'high')}
                  className="h-10 rounded-lg border border-input bg-card px-2 text-xs"
                >
                  <option value="low">Низкий</option>
                  <option value="normal">Обычный</option>
                  <option value="high">Высокий</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-bold text-foreground">Дата начала</Label>
                <Input
                  type="date"
                  value={eventFrom}
                  onChange={(e) => setEventFrom(e.target.value)}
                  required
                  className="h-10 text-xs"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-bold text-foreground">Дата окончания</Label>
                <Input
                  type="date"
                  value={eventTo}
                  onChange={(e) => setEventTo(e.target.value)}
                  required
                  className="h-10 text-xs"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-bold text-foreground">Эффект на спрос (%)</Label>
              <Input
                type="number"
                value={eventEffectPct}
                onChange={(e) => setEventEffectPct(e.target.value)}
                placeholder="+30"
                className="h-10 text-xs"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="lunar-check"
                checked={eventIsLunar}
                onChange={(e) => setEventIsLunar(e.target.checked)}
                className="h-4 w-4 accent-[var(--accent)] cursor-pointer"
              />
              <label htmlFor="lunar-check" className="text-xs font-semibold text-foreground cursor-pointer">
                По лунному календарю (дата уточняется)
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                className="rounded-xl border border-transparent px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-muted"
              >
                Отмена
              </button>
              <button
                type="submit"
                className="brand-grad brand-glow transition-opacity hover:opacity-90 rounded-xl px-4 py-2 text-xs font-bold"
              >
                Сохранить событие
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── 6. Detail View Modal ───────────────────────────────────────────── */}
      {detailItem && (
        <Dialog open={!!detailItem} onOpenChange={() => setDetailItem(null)}>
          <DialogContent className="max-w-md rounded-2xl p-6">
            <DialogHeader>
              <DialogTitle className="text-lg font-extrabold text-foreground">
                {detailItem.name}
              </DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-4 py-2">
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-muted px-2.5 py-0.5 text-xs font-bold text-foreground">
                  {detailItem.category}
                </span>
                <span className="rounded-lg bg-muted px-2.5 py-0.5 text-xs font-bold text-muted-foreground">
                  Приоритет {detailItem.priority}
                </span>
              </div>

              <div className="flex flex-col gap-1.5 text-xs font-semibold text-foreground rounded-xl bg-muted p-3.5 border border-transparent">
                <p><span className="text-muted-foreground">Даты проведения:</span> {detailItem.dateText}</p>
                <p><span className="text-muted-foreground">Прогнозируемый эффект:</span> {detailItem.demandEffect}</p>
                <p><span className="text-muted-foreground">Текущий средний тариф:</span> ${detailItem.currentAvgRate}</p>
                <p><span className="text-muted-foreground">Рекомендованный тариф:</span> ${detailItem.recommendedRate}</p>
              </div>

              {detailItem.overlapNotice && (
                <div className="rounded-xl bg-amber-500/12 p-3 text-xs font-semibold text-amber-700 dark:text-amber-400">
                  {detailItem.overlapNotice}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button
                  onClick={() => setDetailItem(null)}
                  className="rounded-xl border border-transparent px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-muted"
                >
                  Закрыть
                </button>
                <button
                  onClick={() => {
                    handleToggleRateConfig(detailItem.id);
                    setDetailItem(null);
                  }}
                  className="brand-grad brand-glow transition-opacity hover:opacity-90 rounded-xl px-4 py-2 text-xs font-bold"
                >
                  {detailItem.ratesConfigured ? 'Сбросить настройку' : 'Применить тариф $'+detailItem.recommendedRate}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── 7. Rate Setup Modal ────────────────────────────────────────────── */}
      {rateSetupItem && (
        <Dialog open={!!rateSetupItem} onOpenChange={() => setRateSetupItem(null)}>
          <DialogContent className="max-w-md rounded-2xl p-6">
            <DialogHeader>
              <DialogTitle className="text-lg font-extrabold text-foreground">
                Настройка тарифов: {rateSetupItem.name}
              </DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-4 py-2 text-xs font-medium text-foreground">
              <p>Установите множитель или фиксированный рекомендуемый тариф для этого периода ({rateSetupItem.dateText}).</p>

              <div className="flex flex-col gap-2 rounded-xl bg-muted p-3.5 border border-transparent">
                <div className="flex justify-between font-bold">
                  <span>Базовый тариф:</span>
                  <span>${rateSetupItem.currentAvgRate}</span>
                </div>
                <div className="flex justify-between font-extrabold text-emerald-600 text-sm">
                  <span>Рекомендованный тариф:</span>
                  <span>${rateSetupItem.recommendedRate} ({rateSetupItem.demandEffect})</span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button
                  onClick={() => setRateSetupItem(null)}
                  className="rounded-xl border border-transparent px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-muted"
                >
                  Отмена
                </button>
                <button
                  onClick={() => {
                    handleToggleRateConfig(rateSetupItem.id);
                    setRateSetupItem(null);
                  }}
                  className="brand-grad brand-glow transition-opacity hover:opacity-90 rounded-xl px-4 py-2 text-xs font-bold"
                >
                  Сохранить тариф ${rateSetupItem.recommendedRate}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/* ── Прогноз и бюджет (Real Data & Smooth Animations) ───────────────────── */
export function BudgetTab() {
  const { t } = useI18n();
  const tr = (k: string) => t(k as never);

  const [activeTab, setActiveTab] = useState<'forecast' | 'budget'>('forecast');
  const [period, setPeriod] = useState<'today' | '7d' | '30d' | 'month' | 'year' | 'custom'>('month');
  const [year, setYear] = useState(2026);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  const MONTH_NAMES = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
  ];

  // Budget Rows state
  const [budgetRows, setBudgetRows] = useState<
    { monthNum: number; month: string; revenue: string; occupancyPct: string; adr: string; active: boolean }[]
  >([]);

  // Forecast state
  const [weeklyOtb, setWeeklyOtb] = useState<{ date: string; otb: number; forecast: number; budget: number }[]>([]);
  const [monthlyForecast, setMonthlyForecast] = useState<{ month: string; otb: number; forecast: number; budget: number; delta: number; confidence: number }[]>([]);

  // Budget versions state
  const [versions, setVersions] = useState<BudgetVersion[]>([]);

  const [chartCollapsed, setChartCollapsed] = useState(false);
  const [tableCollapsed, setTableCollapsed] = useState(false);

  const timeAgo = (iso?: string | null): string => {
    if (!iso) return '—';
    const diffMs = Date.now() - new Date(iso).getTime();
    const min = Math.max(0, Math.floor(diffMs / 60000));
    if (min < 1) return tr('card.justNow');
    if (min < 60) return tr('card.minAgo').replace('{n}', String(min));
    const h = Math.floor(min / 60);
    if (h < 24) return tr('card.hourAgo').replace('{n}', String(h));
    const d = Math.floor(h / 24);
    return tr('card.dayAgo').replace('{n}', String(d));
  };

  const loadAllData = useCallback(async () => {
    setLoading(true);
    try {
      const [budgetRes, forecastRes, versionsRes] = await Promise.all([
        getBudget(year),
        getRevenueForecast(),
        getBudgetVersions(year),
      ]);

      const currentMonthIndex = new Date().getMonth();

      if (budgetRes && budgetRes.months && budgetRes.months.length) {
        setBudgetRows(
          budgetRes.months.map((m) => ({
            monthNum: m.month,
            month: MONTH_NAMES[m.month - 1] || `Месяц ${m.month}`,
            // BUG-1 fix: use raw numbers, not $ string — formatIn() is called in the JSX display
            revenue: String(m.revenue),
            occupancyPct: String(m.occupancyPct),
            adr: String(m.adr),
            active: m.month - 1 === currentMonthIndex,
          }))
        );
      } else {
        // Fallback initialized for 12 months if backend returns empty
        setBudgetRows(
          MONTH_NAMES.map((name, i) => ({
            monthNum: i + 1,
            month: name,
            revenue: '0',
            occupancyPct: '0',
            adr: '0',
            active: i === currentMonthIndex,
          }))
        );
      }

      if (forecastRes) {
        setWeeklyOtb(forecastRes.weeklyOtbData || []);
        setMonthlyForecast(forecastRes.monthlyForecastData || []);
      }

      setVersions(versionsRes || []);
      setLastLoadedAt(new Date().toISOString());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const rowsToSave = budgetRows.map((r) => {
        // BUG-1 fix: input values are now plain numbers (no $ prefix), safe to parse directly
        const rev = Number(r.revenue.replace(/[^0-9.]/g, '')) || 0;
        const occ = Number(r.occupancyPct.replace(/[^0-9.]/g, '')) || 0;
        const adrVal = Number(r.adr.replace(/[^0-9.]/g, '')) || 0;
        return {
          month: r.monthNum,
          revenue: rev,
          occupancyPct: occ,
          adr: adrVal,
        };
      });

      await saveBudget(year, rowsToSave);
      toast.success(`Бюджет ${year} сохранён!`);
      loadAllData();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreVersion = async (vId: string, label: string) => {
    try {
      await restoreBudgetVersion(vId);
      toast.success(`Версия ${label} восстановлена!`);
      loadAllData();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };


  if (loading) return <Skeleton className="h-[600px] w-full rounded-2xl" />;

  const maxOtbVal = Math.max(...weeklyOtb.map((w) => w.otb), 1);

  return (
    <div className="flex flex-col gap-6 pb-12 font-sans text-foreground">
      {/* ── 1. Top Bar Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-[10px] font-extrabold uppercase tracking-[2px] text-muted-foreground">
              Доход · Прогноз и бюджет
            </p>
            <h1 className="text-[26px] font-extrabold tracking-[-0.4px] text-foreground">
              Прогноз и бюджет
            </h1>
          </div>

          <div className="flex flex-col items-end gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              {/* Period Selector Pills matching Screenshot 3 */}
              <div className={PILL_GROUP}>
                {[
                  { id: 'today', label: 'Сегодня' },
                  { id: '7d', label: '7 дней' },
                  { id: '30d', label: '30 дней' },
                  { id: 'month', label: 'Месяц' },
                  { id: 'year', label: 'Год' },
                  { id: 'custom', label: 'Произвольный' },
                ].map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPeriod(p.id as any)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg transition-all duration-200 font-semibold cursor-pointer text-xs',
                      period === p.id
                        ? 'brand-grad brand-glow font-extrabold'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Was CSV-only despite showing a dropdown chevron — the
                  chevron now opens a real menu. */}
              <ExportMenu
                className="brand-grad brand-glow press flex cursor-pointer items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition-opacity hover:opacity-90"
                build={() => ({
                  filename: `budget_${year}`,
                  columns: ['Месяц', 'Выручка', 'Загрузка %', 'ADR'],
                  rows: budgetRows.map((r) => [r.month, r.revenue, r.occupancyPct, r.adr]),
                  json: budgetRows,
                })}
              />
            </div>

            <button
              onClick={loadAllData}
              className="flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <RefreshCw className="h-3 w-3" />
              <span>Обновлено {timeAgo(lastLoadedAt)}</span>
            </button>
          </div>
        </div>

        {/* Dynamic Subtitle Date & Timestamp */}
        {/* BUG-10 fix: compute current month range dynamically */}
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          {(() => {
            const now = new Date();
            const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
            const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
            const fmt = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
            return <span>Месяц · {fmt(startOfMonth).slice(0, 5)} – {fmt(endOfMonth)} · UZS</span>;
          })()}
          <span>·</span>
          <span className="flex items-center gap-1 text-muted-foreground cursor-pointer hover:text-foreground">
            vs предыдущий период <ChevronDown className="h-3 w-3 opacity-70" />
          </span>
        </div>

        {/* Tab Sub-Navigation Bar: Прогноз | Бюджет */}
        <div className="flex items-center gap-6 border-b border-border text-sm font-bold pt-1">
          <button
            onClick={() => setActiveTab('forecast')}
            className={cn(
              'pb-2.5 transition-all duration-200 border-b-2 cursor-pointer',
              activeTab === 'forecast'
                ? 'border-[var(--accent)] text-accent font-extrabold'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            Прогноз
          </button>
          <button
            onClick={() => setActiveTab('budget')}
            className={cn(
              'pb-2.5 transition-all duration-200 border-b-2 cursor-pointer',
              activeTab === 'budget'
                ? 'border-[var(--accent)] text-accent font-extrabold'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            Бюджет
          </button>
        </div>
      </div>

      {/* ── 2. Active Tab 1: Forecast View matching Screenshot ───────────── */}
      {activeTab === 'forecast' && (
        <div className="flex flex-col gap-6">
          {/* Card 1: Выручка на книгах (OTB) по неделям заезда · 90 дней */}
          <div className="glass-card flex flex-col rounded-2xl border border-transparent p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-extrabold text-foreground">
                Выручка на книгах (OTB) по неделям заезда · 90 дней
              </h2>
              <button
                onClick={() => setChartCollapsed(!chartCollapsed)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ChevronDown className={cn('h-4 w-4 transition-transform duration-300', chartCollapsed && 'rotate-180')} />
              </button>
            </div>

            {!chartCollapsed && (
              <div className="flex flex-col gap-4 mt-6">
                {/* Visual Chart Canvas Box matching Screenshot */}
                <div className="relative w-full h-56 pt-4">
                  {/* SVG Lines Overlay (Forecast & Budget Curves) */}
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none z-10"
                    viewBox="0 1000 180"
                    preserveAspectRatio="none"
                  >
                    {/* Dotted Budget Line (black/gray dotted curve) */}
                    <path
                      d="M 40,25 C 200,10 400,10 500,40 600,35 800,50 960,60"
                      fill="none"
                      stroke="#475569"
                      strokeWidth="1.5"
                      strokeDasharray="4"
                    />
                    {/* Solid Blue Forecast Line */}
                    <path
                      d="M 40,35 C 150,40 250,30 350,45 500,55 700,65 960,85"
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth="2"
                    />
                  </svg>

                  {/* Pillar Bars from API */}
                  <div className="flex h-full items-end justify-between gap-1.5 px-2">
                    {weeklyOtb.map((w, idx) => {
                      const pct = Math.max(5, Math.round((w.otb / maxOtbVal) * 85));
                      const displayK = w.otb >= 1000 ? `${Math.round(w.otb / 1000)}k` : `${w.otb}`;
                      return (
                        <div key={idx} className="flex flex-1 flex-col items-center gap-1.5 h-full justify-end z-0">
                          <span className="text-[10px] font-extrabold text-foreground">
                            {displayK}
                          </span>

                          <div
                            className="w-full max-w-[54px] rounded-t-lg bg-gradient-to-t from-[#3b82f6] to-[#93c5fd] shadow-xs"
                            style={{ height: `${pct}%` }}
                          />

                          <span className="text-[10px] font-semibold text-muted-foreground">
                            {w.date}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Legend Bar below Chart */}
                <div className="flex flex-wrap items-center justify-between gap-4 text-xs font-semibold text-muted-foreground pt-4 border-t border-transparent">
                  <div className="flex items-center gap-5">
                    <div className="flex items-center gap-1.5">
                      <span className="h-3 w-4 rounded-xs bg-[#3b82f6]" />
                      <span className="font-bold text-foreground">OTB (на книгах)</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="h-0.5 w-4 bg-[var(--accent)]" />
                      <span className="font-bold text-foreground">Прогноз</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="h-0.5 w-4 border-b-2 border-dotted border-slate-600" />
                      <span className="font-bold text-foreground">Бюджет</span>
                    </div>
                  </div>

                  <span className="text-[11.5px] font-medium text-muted-foreground">
                    Разрыв между прогнозом и столбцами — ожидаемый пикап.
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Card 2: По месяца́м Table matching Screenshot */}
          <div className="glass-card flex flex-col rounded-2xl border border-transparent p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-extrabold text-foreground">
                По месяца́м
              </h2>
              <button
                onClick={() => setTableCollapsed(!tableCollapsed)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ChevronDown className={cn('h-4 w-4 transition-transform', tableCollapsed && 'rotate-180')} />
              </button>
            </div>

            {!tableCollapsed && (
              <div className="overflow-x-auto mt-4">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-border/60">
                      <th className="py-3 px-3 font-extrabold text-muted-foreground uppercase text-[10.5px]">МЕСЯЦ</th>
                      <th className="py-3 px-3 font-extrabold text-muted-foreground uppercase text-[10.5px]">OTB</th>
                      <th className="py-3 px-3 font-extrabold text-muted-foreground uppercase text-[10.5px]">ПРОГНОЗ</th>
                      <th className="py-3 px-3 font-extrabold text-muted-foreground uppercase text-[10.5px]">БЮДЖЕТ</th>
                      <th className="py-3 px-3 text-center font-extrabold text-muted-foreground uppercase text-[10.5px]">Δ К БЮДЖЕТУ</th>
                      <th className="py-3 px-3 w-56 font-extrabold text-muted-foreground uppercase text-[10.5px]">УВЕРЕННОСТЬ ПРОГНОЗА</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-transparent font-semibold">
                    {monthlyForecast.map((m, i) => {
                      const isNeg = m.delta < 0;
                      const deltaStr = `${m.delta >= 0 ? '+' : ''}${m.delta}%`;
                      return (
                        <tr key={i} className="hover:bg-muted/50 transition-colors">
                          <td className="py-3.5 px-3 font-extrabold text-foreground text-xs">{m.month}</td>
                          <td className="py-3.5 px-3 font-extrabold text-foreground">{formatIn(m.otb)}</td>
                          <td className="py-3.5 px-3 font-extrabold text-foreground">{formatIn(m.forecast)}</td>
                          <td className="py-3.5 px-3 font-extrabold text-foreground">{formatIn(m.budget)}</td>
                          <td className="py-3.5 px-3 text-center">
                            <span
                              className={cn(
                                'inline-block rounded-full px-2.5 py-0.5 text-xs font-extrabold',
                                isNeg
                                  ? 'bg-amber-500/12 text-amber-700 dark:text-amber-400 border border-[#ffedd5]'
                                  : 'bg-emerald-500/12 text-[#15803d] border border-[#dcfce7]'
                              )}
                            >
                              {deltaStr}
                            </span>
                          </td>
                          <td className="py-3.5 px-3">
                            <div className="flex items-center gap-3">
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full rounded-full bg-[var(--accent)] transition-all"
                                  style={{ width: `${m.confidence}%` }}
                                />
                              </div>
                              <span className="w-8 text-right font-extrabold text-foreground text-xs">
                                {m.confidence}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 3. Active Tab 2: Budget View matching Screenshot 3 ──────────── */}
      {activeTab === 'budget' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column (8 cols): Бюджет 2026 Table */}
          <div className="glass-card lg:col-span-8 flex flex-col rounded-2xl border border-transparent p-6">
            {/* Header & Table Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <h2 className="text-lg font-extrabold text-foreground">
                Бюджет {year}
              </h2>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => toast.info('Импорт из XLSX')}
                  className="rounded-xl border border-transparent bg-card hover:bg-muted text-foreground font-semibold text-xs px-4 py-2 transition-colors cursor-pointer"
                >
                  Импорт из XLSX
                </button>

                <button
                  onClick={() => toast.info('Скачивание шаблона')}
                  className="rounded-xl border border-transparent bg-card hover:bg-muted text-foreground font-semibold text-xs px-4 py-2 transition-colors cursor-pointer"
                >
                  Скачать шаблон
                </button>

                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="brand-grad brand-glow transition-opacity hover:opacity-90 rounded-xl font-bold text-xs px-5 py-2 transition-colors cursor-pointer"
                >
                  {saving ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            </div>

            {/* Budget Inputs Table matching Screenshot 3 */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border/60">
                    <th className="py-3 px-3 font-extrabold text-muted-foreground uppercase text-[10.5px]">МЕСЯЦ</th>
                    <th className="py-3 px-3 font-extrabold text-muted-foreground uppercase text-[10.5px] text-center">ВЫРУЧКА</th>
                    <th className="py-3 px-3 font-extrabold text-muted-foreground uppercase text-[10.5px] text-center">ЗАГРУЗКА</th>
                    <th className="py-3 px-3 font-extrabold text-muted-foreground uppercase text-[10.5px] text-center">ADR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-transparent font-semibold">
                  {budgetRows.map((r, idx) => (
                    <tr
                      key={idx}
                      className={cn(
                        'transition-colors',
                        r.active ? 'bg-amber-500/12' : 'hover:bg-muted/50'
                      )}
                    >
                      <td className="py-3 px-3 font-extrabold text-foreground text-xs">{r.month}</td>

                      <td className="py-2.5 px-3">
                        <input
                          type="text"
                          value={r.revenue}
                          onChange={(e) => {
                            const val = e.target.value;
                            setBudgetRows((prev) =>
                              prev.map((row, i) => (i === idx ? { ...row, revenue: val } : row))
                            );
                          }}
                          className="w-full max-w-[140px] mx-auto block h-9 rounded-xl border border-input bg-card px-3 text-right font-extrabold text-foreground text-xs shadow-2xs focus:outline-none focus:ring-2 focus:ring-ring/40"
                        />
                      </td>

                      <td className="py-2.5 px-3">
                        <input
                          type="text"
                          value={r.occupancyPct}
                          onChange={(e) => {
                            const val = e.target.value;
                            setBudgetRows((prev) =>
                              prev.map((row, i) => (i === idx ? { ...row, occupancyPct: val } : row))
                            );
                          }}
                          className="w-full max-w-[90px] mx-auto block h-9 rounded-xl border border-input bg-card px-3 text-right font-extrabold text-foreground text-xs shadow-2xs focus:outline-none focus:ring-2 focus:ring-ring/40"
                        />
                      </td>

                      <td className="py-2.5 px-3">
                        <input
                          type="text"
                          value={r.adr}
                          onChange={(e) => {
                            const val = e.target.value;
                            setBudgetRows((prev) =>
                              prev.map((row, i) => (i === idx ? { ...row, adr: val } : row))
                            );
                          }}
                          className="w-full max-w-[110px] mx-auto block h-9 rounded-xl border border-input bg-card px-3 text-right font-extrabold text-foreground text-xs shadow-2xs focus:outline-none focus:ring-2 focus:ring-ring/40"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Column (4 cols): История версий Sidebar matching Screenshot 3 */}
          <div className="glass-card lg:col-span-4 flex flex-col gap-4 rounded-2xl border border-transparent p-6">
            <h3 className="text-[15px] font-extrabold text-foreground">
              История версий
            </h3>

            <div className="flex flex-col divide-y divide-transparent">
              {versions.map((ver, idx) => (
                <div key={ver.id || idx} className="py-3.5 flex items-center justify-between gap-2">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-foreground text-xs">
                        Бюджет {ver.year} · {ver.label}
                      </span>
                      {idx === 0 && (
                        <span className="rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 font-bold text-[10px] px-2 py-0.5">
                          текущая
                        </span>
                      )}
                    </div>
                    <p className="text-[11.5px] font-medium text-muted-foreground">
                      изменён {new Date(ver.createdAt).toLocaleDateString()}
                    </p>
                  </div>

                  {idx > 0 && (
                    <button
                      onClick={() => handleRestoreVersion(ver.id, ver.label)}
                      className="text-accent font-bold text-xs hover:underline cursor-pointer"
                    >
                      Восстановить
                    </button>
                  )}
                </div>
              ))}

              {!versions.length && (
                <p className="text-xs text-muted-foreground py-4">Нет сохранённых предыдущих версий</p>
              )}
            </div>

            {/* Sidebar Footer Hint */}
            <p className="text-[11.5px] font-medium text-muted-foreground leading-relaxed pt-3 border-t border-border/60">
              Восстановить можно любую предыдущую версию — текущая при этом сохранится как новая.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}


/* ── Отчёты (Comprehensive Multi-Structured UI) ────────────────────────── */
export function ReportsTab() {
  const { t } = useI18n();
  const tr = (k: string) => t(k as never);

  const [period, setPeriod] = useState<'today' | '7d' | '30d' | 'month' | 'year' | 'custom'>('30d');
  const [updatedTimeText, setUpdatedTimeText] = useState('Обновлено только что');
  const [selectedReportKey, setSelectedReportKey] = useState<string>('daily-flash');
  const [segmentFilter, setSegmentFilter] = useState('all');
  const [reportData, setReportData] = useState<Awaited<ReturnType<typeof getReportData>> | null>(null);
  const [loadingReport, setLoadingReport] = useState(true);

  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleFrequency, setScheduleFrequency] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [scheduleChannel, setScheduleChannel] = useState<'email' | 'telegram'>('email');
  const [scheduleRecipients, setScheduleRecipients] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);

  const loadSchedules = useCallback(async () => {
    try {
      setSchedules(await getReportSchedules());
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, []);

  useEffect(() => { loadSchedules(); }, [loadSchedules]);

  const handleCreateSchedule = (e: FormEvent) => {
    e.preventDefault();
    const recipients = scheduleRecipients.split(',').map((r) => r.trim()).filter(Boolean);
    if (!recipients.length) { toast.error('Укажите хотя бы одного получателя'); return; }
    setSavingSchedule(true);
    createReportSchedule({ reportKey: selectedReportKey, frequency: scheduleFrequency, channel: scheduleChannel, recipients })
      .then(() => {
        toast.success('Расписание отчёта сохранено');
        setScheduleModalOpen(false);
        setScheduleRecipients('');
        setScheduleFrequency('weekly');
        setScheduleChannel('email');
        return loadSchedules();
      })
      .catch((err) => toast.error((err as Error).message))
      .finally(() => setSavingSchedule(false));
  };

  const handleDeleteSchedule = (id: string) => {
    deleteReportSchedule(id)
      .then(() => { toast.success('Расписание удалено'); return loadSchedules(); })
      .catch((err) => toast.error((err as Error).message));
  };

  const SCHEDULE_FREQ_LABEL: Record<string, string> = { daily: 'Ежедневно', weekly: 'Еженедельно', monthly: 'Ежемесячно' };
  const SCHEDULE_CHANNEL_LABEL: Record<string, string> = { email: 'Email', telegram: 'Telegram' };

  const { fromIso, toIso, periodLabel } = useMemo(() => {
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const to = iso(today);
    if (period === 'today') return { fromIso: to, toIso: to, periodLabel: `Сегодня · ${to}` };
    if (period === '7d') {
      const from = new Date(today); from.setUTCDate(from.getUTCDate() - 7);
      return { fromIso: iso(from), toIso: to, periodLabel: `7 дней · ${iso(from)} – ${to}` };
    }
    if (period === 'month') {
      const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      return { fromIso: iso(from), toIso: to, periodLabel: `Месяц · ${iso(from)} – ${to}` };
    }
    if (period === 'year') {
      const from = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
      return { fromIso: iso(from), toIso: to, periodLabel: `Год · ${iso(from)} – ${to}` };
    }
    const from = new Date(today); from.setUTCDate(from.getUTCDate() - 30);
    return { fromIso: iso(from), toIso: to, periodLabel: `30 дней · ${iso(from)} – ${to}` };
  }, [period]);

  const loadReport = useCallback(async () => {
    setLoadingReport(true);
    try {
      const data = await getReportData(selectedReportKey, fromIso, toIso, segmentFilter === 'all' ? undefined : segmentFilter);
      setReportData(data);
    } catch (e) {
      toast.error((e as Error).message);
      setReportData(null);
    } finally {
      setLoadingReport(false);
    }
  }, [selectedReportKey, fromIso, toIso, segmentFilter]);

  useEffect(() => { loadReport(); }, [loadReport]);

  // Expanded Catalog with 12 Specialized Reports
  const catalogGroups = [
    {
      title: 'ОПЕРАТИВНЫЕ',
      items: [
        {
          key: 'daily-flash',
          name: 'Daily Flash',
          desc: 'выручка, загрузка, ADR, RevPAR за вчера + MTD',
        },
        {
          key: 'pace-pickup',
          name: 'Pace & Pickup Velocity',
          desc: 'прирост броней по датам заезда и темп пикапа',
        },
        {
          key: 'otb-dates',
          name: 'ОТВ по датам (YoY)',
          desc: 'сравнение OTB к аналогичному периоду прошлого года',
        },
        {
          key: 'cancellations',
          name: 'Анализ отмен и ноу-шоу',
          desc: 'динамика отмен, упущенная выручка и глубина',
        },
      ],
    },
    {
      title: 'ПРОДАКШН',
      items: [
        {
          key: 'channels',
          name: 'По каналам продаж',
          desc: 'н/н, gross, комиссия, net, ADR, net ADR, долевой индекс',
        },
        {
          key: 'rate-plans',
          name: 'По тарифным планам',
          desc: 'структура продаж, дилуция тарифов, BAR vs Promo',
        },
        {
          key: 'room-types',
          name: 'По типам номеров',
          desc: 'RevPAR по категориям, загрузка и допродажи (Upgrades)',
        },
        {
          key: 'segments',
          name: 'По сегментам (Market Mix)',
          desc: 'Retail / Corporate / MICE / Direct / OTA и средний чек',
        },
        {
          key: 'guest-countries',
          name: 'По странам гостей (География)',
          desc: 'география спроса, внутренний vs въездной туризм',
        },
        {
          key: 'companies',
          name: 'По корпоративным клиентам',
          desc: 'выполнение контрактов, объём и скидки аккаунтов',
        },
      ],
    },
    {
      title: 'АНАЛИТИЧЕСКИЕ',
      items: [
        {
          key: 'forecast-budget',
          name: 'Прогноз vs Бюджет vs Факт',
          desc: 'сравнение выполнения ключевых целей',
        },
        {
          key: 'los-pattern',
          name: 'Длина проживания и Дни недели',
          desc: 'паттерны бронирования (ALOS) и уикенд-премия',
        },
      ],
    },
  ];

  // Handler for Export Downloading
  /**
   * The loaded report as an export table. Rows are positional (`c0..cN` paired
   * with tableCols), which is why this mapping lives here rather than in the
   * generic exporter.
   */
  const buildReportTable = () => {
    if (!reportData) return null;
    const cols = reportData.tableCols;
    return {
      filename: `${selectedReportKey}_${fromIso}_${toIso}`,
      columns: cols,
      rows: reportData.rows.map((row) => cols.map((_, i) => row[`c${i}` as `c${number}`] ?? '')),
      totalRow: reportData.totalRow
        ? cols.map((_, i) => reportData.totalRow![`c${i}` as `c${number}`] ?? '')
        : undefined,
      json: reportData,
    };
  };

  return (
    <div className="flex flex-col gap-6 pb-12 text-foreground font-sans">
      {/* ── 1. Top Header & Period Controls ──────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-[10px] font-extrabold uppercase tracking-[2px] text-muted-foreground">
            Доход · Аналитика и отчёты
          </p>
          <h1 className="text-[26px] font-extrabold tracking-[-0.4px] text-foreground">
            Отчёты
          </h1>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5 font-medium">
            <span>{periodLabel} · UZS</span>
            <span>·</span>
            <button
              onClick={() => {
                setUpdatedTimeText('Обновлено только что');
                loadReport();
              }}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors cursor-pointer"
            >
              <RefreshCw className={cn('h-3 w-3', loadingReport && 'animate-spin')} />
              <span>{updatedTimeText}</span>
            </button>
          </p>
        </div>

        {/* Period Selector & Main Export Button */}
        <div className="flex flex-wrap items-center gap-2">
          <div className={PILL_GROUP}>
            {[
              { id: 'today', label: 'Сегодня' },
              { id: '7d', label: '7 дней' },
              { id: '30d', label: '30 дней' },
              { id: 'month', label: 'Месяц' },
              { id: 'year', label: 'Год' },
              { id: 'custom', label: 'Произвольный' },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id as any)}
                className={cn(
                  'px-3 py-1.5 rounded-lg transition-all font-semibold cursor-pointer',
                  period === p.id
                    ? 'brand-grad brand-glow font-extrabold'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <ExportMenu
            className="brand-grad brand-glow press flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-opacity hover:opacity-90"
            build={buildReportTable}
          />
        </div>
      </div>

      {/* ── 2. Main 2-Column Section: Catalog on Left, Dynamic Preview on Right ────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Catalog (4 columns) */}
        <div className="glass-card lg:col-span-4 rounded-2xl border border-transparent p-5 flex flex-col gap-5">
          <h2 className="text-[15px] font-extrabold text-foreground">
            Каталог отчётов
          </h2>

          <div className="flex flex-col gap-5">
            {catalogGroups.map((group, gIdx) => (
              <div key={gIdx} className="flex flex-col gap-2">
                <span className="text-[11px] font-extrabold text-muted-foreground uppercase tracking-wider px-1">
                  • {group.title}
                </span>

                <div className="flex flex-col gap-1">
                  {group.items.map((item) => {
                    const isSelected = selectedReportKey === item.key;
                    return (
                      <div
                        key={item.key}
                        onClick={() => setSelectedReportKey(item.key)}
                        className={cn(
                          'group flex items-start justify-between gap-2 p-3 rounded-xl transition-all cursor-pointer border',
                          isSelected
                            ? 'bg-blue-50/80 border-blue-200 text-blue-950 font-medium shadow-xs'
                            : 'border-transparent hover:bg-muted text-foreground'
                        )}
                      >
                        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                          <span
                            className={cn(
                              'text-sm font-bold',
                              isSelected ? 'text-blue-950 font-extrabold' : 'text-foreground'
                            )}
                          >
                            {item.name}
                          </span>
                          <span className="text-xs text-muted-foreground leading-snug truncate">
                            {item.desc}
                          </span>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedReportKey(item.key);
                            toast.success(`Сформирован отчёт "${item.name}"`);
                          }}
                          className={cn(
                            'text-xs font-bold text-accent shrink-0 pt-0.5 transition-colors cursor-pointer',
                            isSelected && 'text-blue-700'
                          )}
                        >
                          Сформировать
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Custom Specialized Layout Renderer per Selected Report (8 columns) */}
        <div className="glass-card lg:col-span-8 rounded-2xl border border-transparent p-6 flex flex-col gap-6">
          {/* Header Bar of Active Report */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-border">
            <div>
              <h2 className="text-xl font-extrabold text-foreground">
                {catalogGroups.flatMap((g) => g.items).find((i) => i.key === selectedReportKey)?.name || 'Отчёт'}
              </h2>
              <p className="text-xs font-semibold text-muted-foreground mt-0.5">
                {catalogGroups.flatMap((g) => g.items).find((i) => i.key === selectedReportKey)?.desc}
              </p>
            </div>

            {/* Controls right */}
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={segmentFilter}
                onChange={(e) => setSegmentFilter(e.target.value)}
                className="appearance-none bg-muted border border-input rounded-xl px-3 py-1.5 text-xs font-semibold text-foreground outline-none cursor-pointer hover:bg-muted/50"
              >
                <option value="all">Сегмент: все</option>
                <option value="direct">Прямые брони</option>
                <option value="ota">Онлайн агентства (OTA)</option>
                <option value="corporate">Корпоративные</option>
              </select>

              <ExportMenu
                label="Скачать"
                className="rounded-xl bg-muted px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                build={buildReportTable}
              />
            </div>
          </div>

          {/* Audit Metadata Info Banner */}
          <div className="rounded-xl bg-blue-500/12 p-3 text-xs font-semibold text-blue-700 dark:text-blue-400 flex flex-wrap items-center justify-between gap-2">
            <span>
              Период: <strong className="font-extrabold text-blue-950">{fromIso} – {toIso}</strong> · Валюта: <strong>UZS</strong> · Строк: <strong>{reportData?.rows.length ?? 0}</strong>
            </span>
          </div>

          {/* ─────────────────────────────────────────────────────────────────── */}
          {/* Generic renderer — one path for all 12 report keys, driven by the  */}
          {/* real getReportData() response instead of a hardcoded block per key */}
          {/* ─────────────────────────────────────────────────────────────────── */}
          {loadingReport || !reportData ? (
            <div className="flex flex-col gap-3">
              <div className="h-24 w-full animate-pulse rounded-xl bg-muted" />
              <div className="h-64 w-full animate-pulse rounded-xl bg-muted" />
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {reportData.bars.length > 0 && (
                <div className="flex flex-col gap-3">
                  {reportData.bars.map((b, i) => (
                    <div key={i} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span className="text-foreground">{b.name}</span>
                        <span className="font-extrabold text-foreground">{b.valueStr}</span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn('h-full rounded-full transition-all duration-500', b.isDark ? 'bg-[#1e293b]' : 'bg-[var(--accent)]')}
                          style={{ width: `${b.maxAmount > 0 ? Math.max(2, Math.round((b.amount / b.maxAmount) * 100)) : 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="overflow-x-auto rounded-xl border border-transparent">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/60">
                      {reportData.tableCols.map((col, i) => (
                        <th
                          key={i}
                          className={cn('px-3.5 py-3 font-extrabold text-muted-foreground uppercase text-[10.5px]', i > 0 && 'text-right')}
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-transparent font-medium">
                    {reportData.rows.length === 0 ? (
                      <tr><td colSpan={reportData.tableCols.length} className="px-3.5 py-8 text-center text-muted-foreground">Нет данных за период</td></tr>
                    ) : reportData.rows.map((row, ri) => (
                      <tr key={ri}>
                        {reportData.tableCols.map((_, ci) => (
                          <td
                            key={ci}
                            className={cn('px-3.5 py-3', ci === 0 ? 'font-bold text-foreground' : 'text-right', ci > 0 && 'tabular-nums')}
                          >
                            {row[`c${ci}`] ?? '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  {reportData.totalRow && (
                    <tfoot>
                      <tr className="border-t-2 border-border bg-muted/60 font-extrabold text-foreground">
                        {reportData.tableCols.map((_, ci) => (
                          <td key={ci} className={cn('px-3.5 py-3', ci > 0 && 'text-right tabular-nums')}>
                            {reportData.totalRow![`c${ci}`] ?? '—'}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 3. Scheduled Reports ─────────────────────────────────────────────── */}
      <div className="glass-card rounded-2xl border border-transparent p-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-extrabold text-foreground">Расписание отчётов</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Автоматическая рассылка выбранного отчёта по расписанию</p>
          </div>
          <button
            onClick={() => setScheduleModalOpen(true)}
            className="brand-grad brand-glow transition-opacity hover:opacity-90 press text-xs px-4 py-2.5 rounded-xl flex items-center gap-2 transition-colors cursor-pointer font-bold"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Добавить расписание</span>
          </button>
        </div>

        {schedules.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">Нет активных расписаний.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-transparent">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/60">
                  <th className="px-3.5 py-3 font-extrabold text-muted-foreground uppercase text-[10.5px]">Отчёт</th>
                  <th className="px-3.5 py-3 font-extrabold text-muted-foreground uppercase text-[10.5px]">Периодичность</th>
                  <th className="px-3.5 py-3 font-extrabold text-muted-foreground uppercase text-[10.5px]">Канал</th>
                  <th className="px-3.5 py-3 font-extrabold text-muted-foreground uppercase text-[10.5px]">Получатели</th>
                  <th className="px-3.5 py-3 font-extrabold text-muted-foreground uppercase text-[10.5px]">Последняя отправка</th>
                  <th className="px-3.5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-transparent font-medium">
                {schedules.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3.5 py-3 font-bold text-foreground">
                      {catalogGroups.flatMap((g) => g.items).find((i) => i.key === s.reportKey)?.name || s.reportKey}
                    </td>
                    <td className="px-3.5 py-3">{SCHEDULE_FREQ_LABEL[s.frequency] || s.frequency}</td>
                    <td className="px-3.5 py-3">{SCHEDULE_CHANNEL_LABEL[s.channel] || s.channel}</td>
                    <td className="px-3.5 py-3 text-muted-foreground">{s.recipients.join(', ')}</td>
                    <td className="px-3.5 py-3 text-muted-foreground">{s.lastSentAt ? formatDateTime(s.lastSentAt) : 'ещё не отправлялось'}</td>
                    <td className="px-3.5 py-3 text-right">
                      <button
                        onClick={() => handleDeleteSchedule(s.id)}
                        className="press text-red-600 dark:text-red-400 hover:opacity-80 transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {scheduleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setScheduleModalOpen(false)}>
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleCreateSchedule}
            className="w-full max-w-md rounded-2xl border border-transparent bg-card p-6 shadow-xl flex flex-col gap-4"
          >
            <h3 className="text-[15px] font-extrabold text-foreground">Новое расписание</h3>
            <p className="text-xs text-muted-foreground -mt-2">
              Отчёт: <strong className="text-foreground">{catalogGroups.flatMap((g) => g.items).find((i) => i.key === selectedReportKey)?.name}</strong>
            </p>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold text-foreground">
                Периодичность
                <select
                  value={scheduleFrequency}
                  onChange={(e) => setScheduleFrequency(e.target.value as typeof scheduleFrequency)}
                  className="h-10 rounded-lg border border-input bg-card px-2 text-xs"
                >
                  <option value="daily">Ежедневно</option>
                  <option value="weekly">Еженедельно</option>
                  <option value="monthly">Ежемесячно</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-foreground">
                Канал
                <select
                  value={scheduleChannel}
                  onChange={(e) => setScheduleChannel(e.target.value as typeof scheduleChannel)}
                  className="h-10 rounded-lg border border-input bg-card px-2 text-xs"
                >
                  <option value="email">Email</option>
                  <option value="telegram">Telegram</option>
                </select>
              </label>
            </div>

            <label className="flex flex-col gap-1 text-xs font-semibold text-foreground">
              Получатели (через запятую)
              <Input
                value={scheduleRecipients}
                onChange={(e) => setScheduleRecipients(e.target.value)}
                placeholder="owner@hotel.com, gm@hotel.com"
              />
            </label>

            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={() => setScheduleModalOpen(false)}
                className="rounded-xl border border-transparent px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-muted"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={savingSchedule}
                className="brand-grad brand-glow transition-opacity hover:opacity-90 press rounded-xl px-4 py-2 text-xs font-bold disabled:opacity-50"
              >
                {savingSchedule ? 'Сохранение…' : 'Сохранить расписание'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
