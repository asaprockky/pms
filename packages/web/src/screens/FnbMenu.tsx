import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, CircleCheck, Leaf, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  createFbMenuItem, deleteFbMenuItem, getFbMenu, getOutlets, updateFbMenuItem,
  type FbMenuItem, type Outlet,
} from '@/api';
import { BTN_PRIMARY, Card, Empty, TONE } from '@/components/atlas-ui';
import { ExportMenu } from '@/components/ExportMenu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { CATEGORY_LABEL, CATEGORY_TONE, Segmented, Select, fbMoney, plural } from './fb/fb-shared';
import { INPUT, Labeled } from './FnbFloor';

const CATEGORIES = ['food', 'drink', 'alcohol', 'dessert', 'other'];

export function FnbMenu() {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [outletId, setOutletId] = useState('');
  const [items, setItems] = useState<FbMenuItem[]>([]);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<FbMenuItem | 'new' | null>(null);

  useEffect(() => {
    getOutlets()
      .then((list) => { setOutlets(list); setOutletId((p) => p || list[0]?.id || ''); })
      .catch((e) => toast.error((e as Error).message));
  }, []);

  const load = useCallback(async () => {
    if (!outletId) { setItems([]); setLoading(false); return; }
    try { setItems(await getFbMenu(outletId)); }
    catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }, [outletId]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) =>
      (!category || i.category === category) &&
      (!q || i.name.toLowerCase().includes(q) || (i.ikpuCode ?? '').includes(q)),
    );
  }, [items, category, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, FbMenuItem[]>();
    for (const i of filtered) map.set(i.category, [...(map.get(i.category) ?? []), i]);
    return [...map.entries()].sort((a, b) => CATEGORIES.indexOf(a[0]) - CATEGORIES.indexOf(b[0]));
  }, [filtered]);

  const stopped = items.filter((i) => i.stopList).length;
  const noIkpu = items.filter((i) => !i.ikpuCode).length;

  const buildExport = () => {
    if (!filtered.length) return null;
    return {
      filename: 'fnb-menu',
      columns: ['Название', 'Категория', 'Цена (UZS)', 'НДС %', 'ИКПУ', 'Халяль', 'Стоп-лист'],
      rows: filtered.map((i) => [
        i.name, CATEGORY_LABEL[i.category] ?? i.category, Math.round(i.price),
        i.vatPercent, i.ikpuCode ?? '', i.halal, i.stopList,
      ]),
      json: filtered,
    };
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.4px]">Меню</h1>
          <p className="mt-0.5 text-[12.5px] font-medium text-muted-foreground">
            {items.length} {plural(items.length, 'позиция', 'позиции', 'позиций')}
            {stopped > 0 ? ` · ${stopped} в стоп-листе` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={outletId} onChange={setOutletId}
            options={outlets.map((o) => ({ value: o.id, label: o.name }))}
            className="w-52"
          />
          <ExportMenu build={buildExport} disabled={!filtered.length} />
          <button onClick={() => setEditing('new')} disabled={!outletId} className={cn(BTN_PRIMARY, 'flex items-center gap-1.5')}>
            <Plus className="h-4 w-4" />Позиция
          </button>
        </div>
      </div>

      {/* IKPU is required for the fiscal push — surface the gap rather than
          letting checks fail at close time. */}
      {noIkpu > 0 && (
        <p className={cn('rounded-xl px-4 py-2.5 text-[12.5px] font-semibold', TONE.amber)}>
          У {noIkpu} {plural(noIkpu, 'позиции', 'позиций', 'позиций')} не заполнен ИКПУ — при фискализации
          подставится код точки по умолчанию.
        </p>
      )}

      <Card className="flex flex-wrap items-center gap-2.5 p-4">
        <Segmented
          value={category}
          onChange={setCategory}
          options={[
            { value: '', label: 'Все', count: items.length },
            ...CATEGORIES.filter((c) => items.some((i) => i.category === c)).map((c) => ({
              value: c,
              label: CATEGORY_LABEL[c] ?? c,
              count: items.filter((i) => i.category === c).length,
            })),
          ]}
        />
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Название или ИКПУ" className={cn(INPUT, 'pl-9')}
          />
        </div>
      </Card>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-2xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-8">
          <Empty>
            {items.length === 0
              ? 'В этой точке ещё нет меню. Добавьте позиции — тогда официанты смогут выбирать их в чеке, а не вводить руками.'
              : 'Ничего не найдено.'}
          </Empty>
        </Card>
      ) : (
        grouped.map(([cat, list]) => (
          <div key={cat}>
            <h2 className="mb-2.5 text-[11px] font-extrabold uppercase tracking-[1px] text-muted-foreground">
              {CATEGORY_LABEL[cat] ?? cat} <span className="opacity-60">· {list.length}</span>
            </h2>
            <Card className="overflow-hidden">
              <div className="flex flex-col divide-y divide-border/60">
                {list.map((i) => (
                  <div
                    key={i.id}
                    className={cn('flex flex-wrap items-center gap-3 px-4 py-3', i.stopList && 'bg-red-500/[0.04]')}
                  >
                    {i.imageUrl && (
                      <img
                        src={i.imageUrl}
                        alt={i.name}
                        className="h-11 w-11 shrink-0 rounded-xl object-cover border border-border/40"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={cn('truncate text-[13.5px] font-bold', i.stopList && 'text-muted-foreground line-through')}>
                          {i.name}
                        </span>
                        {i.halal && (
                          <span title="Халяль" className="flex items-center text-emerald-600 dark:text-emerald-400">
                            <Leaf className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </div>
                      {i.description && (
                        <p className="line-clamp-1 text-[11.5px] font-medium text-muted-foreground/90">
                          {i.description}
                        </p>
                      )}
                      <p className="text-[11px] font-semibold text-muted-foreground">
                        НДС {i.vatPercent}% · ИКПУ {i.ikpuCode || <span className="text-amber-600 dark:text-amber-400">не задан</span>}
                      </p>
                    </div>
                    <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold', TONE[CATEGORY_TONE[i.category] ?? 'neutral'])}>
                      {CATEGORY_LABEL[i.category] ?? i.category}
                    </span>
                    <span className="w-32 shrink-0 text-right text-[14px] font-extrabold tabular-nums">
                      {fbMoney(i.price)}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        title={i.stopList ? 'Вернуть в продажу' : 'В стоп-лист'}
                        disabled={busy}
                        onClick={() => act(
                          () => updateFbMenuItem(i.id, { stopList: !i.stopList }),
                          i.stopList ? 'Вернули в продажу' : 'Добавлено в стоп-лист',
                        )}
                        className={cn(
                          'rounded-lg p-1.5 transition-colors',
                          i.stopList
                            ? 'text-emerald-600 hover:bg-emerald-500/12 dark:text-emerald-400'
                            : 'text-muted-foreground hover:bg-amber-500/12 hover:text-amber-600',
                        )}
                      >
                        {i.stopList ? <CircleCheck className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                      </button>
                      <button
                        title="Изменить"
                        onClick={() => setEditing(i)}
                        className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        title="Удалить"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(`Удалить позицию «${i.name}» из меню?`)) return;
                          act(() => deleteFbMenuItem(i.id), 'Позиция удалена');
                        }}
                        className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-red-500/12 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        ))
      )}

      <MenuItemDialog
        target={editing}
        outletId={outletId}
        defaultVat={outlets.find((o) => o.id === outletId)?.defaultVatPercent ?? 12}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />
    </div>
  );
}

function MenuItemDialog({ target, outletId, defaultVat, onClose, onSaved }: {
  target: FbMenuItem | 'new' | null;
  outletId: string;
  defaultVat: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = target === 'new';
  const item = target && target !== 'new' ? target : null;
  const [f, setF] = useState({
    name: '', description: '', imageUrl: '', category: 'food', price: '', vatPercent: String(defaultVat),
    ikpuCode: '', halal: false, stopList: false,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!target) return;
    setF(item
      ? {
          name: item.name, description: item.description ?? '', imageUrl: item.imageUrl ?? '',
          category: item.category, price: String(item.price),
          vatPercent: String(item.vatPercent), ikpuCode: item.ikpuCode ?? '',
          halal: item.halal, stopList: item.stopList,
        }
      : { name: '', description: '', imageUrl: '', category: 'food', price: '', vatPercent: String(defaultVat), ikpuCode: '', halal: false, stopList: false });
  }, [target, item, defaultVat]);

  const submit = async () => {
    if (!f.name.trim()) { toast.error('Укажите название'); return; }
    setBusy(true);
    try {
      const payload = {
        name: f.name.trim(), description: f.description.trim() || undefined,
        imageUrl: f.imageUrl.trim() || undefined, category: f.category,
        price: Number(f.price) || 0, vatPercent: Number(f.vatPercent) || 0,
        ikpuCode: f.ikpuCode.trim(), halal: f.halal, stopList: f.stopList,
      };
      if (item) await updateFbMenuItem(item.id, payload);
      else await createFbMenuItem({ outletId, ...payload });
      toast.success(item ? 'Позиция обновлена' : 'Позиция добавлена');
      onSaved();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={!!target} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader><DialogTitle>{isNew ? 'Новая позиция' : 'Изменить позицию'}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <Labeled label="Название">
            <input
              autoFocus value={f.name}
              onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))}
              placeholder="Плов ташкентский" className={INPUT}
            />
          </Labeled>
          <Labeled label="Описание">
            <input
              value={f.description}
              onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))}
              placeholder="Традиционный узбекский плов с говядиной и нутом" className={INPUT}
            />
          </Labeled>
          <Labeled label="Ссылка на фото">
            <input
              value={f.imageUrl}
              onChange={(e) => setF((p) => ({ ...p, imageUrl: e.target.value }))}
              placeholder="https://images.unsplash.com/..." className={INPUT}
            />
          </Labeled>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Категория">
              <Select
                value={f.category}
                onChange={(v) => setF((p) => ({ ...p, category: v }))}
                options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] ?? c }))}
              />
            </Labeled>
            <Labeled label="Цена, UZS">
              <input
                type="number" min="0" value={f.price}
                onChange={(e) => setF((p) => ({ ...p, price: e.target.value }))}
                className={INPUT}
              />
            </Labeled>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="НДС, %">
              <input
                type="number" min="0" value={f.vatPercent}
                onChange={(e) => setF((p) => ({ ...p, vatPercent: e.target.value }))}
                className={INPUT}
              />
            </Labeled>
            <Labeled label="ИКПУ">
              <input
                value={f.ikpuCode}
                onChange={(e) => setF((p) => ({ ...p, ikpuCode: e.target.value }))}
                placeholder="10113000" className={INPUT}
              />
            </Labeled>
          </div>
          <p className="-mt-1 text-[11px] font-medium text-muted-foreground">
            Цена указывается с НДС — в чеке налог показывается отдельной строкой.
          </p>
          <div className="flex flex-wrap gap-2">
            <Toggle on={f.halal} onClick={() => setF((p) => ({ ...p, halal: !p.halal }))} label="Халяль" />
            <Toggle on={f.stopList} onClick={() => setF((p) => ({ ...p, stopList: !p.stopList }))} label="В стоп-листе" danger />
          </div>
          <button onClick={submit} disabled={busy} className={cn(BTN_PRIMARY, 'mt-1 w-full')}>
            {busy ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Toggle({ on, onClick, label, danger }: {
  on: boolean; onClick: () => void; label: string; danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl border px-3 py-1.5 text-[12px] font-bold transition-colors',
        on
          ? danger
            ? 'border-red-500/40 bg-red-500/12 text-red-600 dark:text-red-400'
            : 'border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'
          : 'border-input bg-card text-muted-foreground hover:bg-muted/50',
      )}
    >
      {label}
    </button>
  );
}
