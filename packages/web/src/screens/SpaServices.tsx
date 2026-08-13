import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Pencil, Plus, Search, Users } from 'lucide-react';
import { toast } from 'sonner';
import {
  createSpaTreatment, getSpaTreatments, updateSpaTreatment, type SpaTreatment,
} from '@/api';
import { BTN_PRIMARY, Card, Empty, TONE } from '@/components/atlas-ui';
import { ExportMenu } from '@/components/ExportMenu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  CATEGORY_LABEL, CATEGORY_TONE, INPUT, Labeled, ROOM_TYPE_LABEL, SPECIALTY_LABEL,
  Segmented, Select, Toggle, minutesLabel, plural, spaMoney,
} from './spa/spa-shared';

const CATEGORIES = ['massage', 'facial', 'nail', 'sauna', 'body', 'other'];
const SPECIALTIES = ['massage', 'facial', 'nail', 'sauna', 'body'];
const ROOM_TYPES = ['massage', 'sauna', 'pool', 'nail', 'facial', 'multi'];

export function SpaServices() {
  const [items, setItems] = useState<SpaTreatment[]>([]);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SpaTreatment | 'new' | null>(null);

  const load = useCallback(async () => {
    try { setItems(await getSpaTreatments(true)); }
    catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) =>
      (!category || i.category === category) &&
      (!q || i.name.toLowerCase().includes(q) || (i.ikpuCode ?? '').includes(q)),
    );
  }, [items, category, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, SpaTreatment[]>();
    for (const i of filtered) map.set(i.category, [...(map.get(i.category) ?? []), i]);
    return [...map.entries()].sort((a, b) => CATEGORIES.indexOf(a[0]) - CATEGORIES.indexOf(b[0]));
  }, [filtered]);

  const noIkpu = items.filter((i) => i.active && !i.ikpuCode).length;

  const buildExport = () => {
    if (!filtered.length) return null;
    return {
      filename: 'spa-uslugi',
      columns: ['Услуга', 'Категория', 'Длительность', 'Цена (UZS)', 'НДС %', 'ИКПУ', 'Специализация', 'Кабинет', 'Парная', 'Буфер после', 'Активна'],
      rows: filtered.map((t) => [
        t.name, CATEGORY_LABEL[t.category] ?? t.category, t.durationMin, Math.round(t.price),
        t.vatPercent, t.ikpuCode ?? '',
        SPECIALTY_LABEL[t.requiredSpecialty] ?? t.requiredSpecialty,
        ROOM_TYPE_LABEL[t.requiredRoomType] ?? t.requiredRoomType,
        t.isCouple, t.bufferAfterMin, t.active,
      ]),
      json: filtered,
    };
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.4px]">Каталог услуг</h1>
          <p className="mt-0.5 text-[12.5px] font-medium text-muted-foreground">
            {items.filter((i) => i.active).length} {plural(items.filter((i) => i.active).length, 'услуга', 'услуги', 'услуг')} в продаже
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu build={buildExport} disabled={!filtered.length} />
          <button onClick={() => setEditing('new')} className={cn(BTN_PRIMARY, 'flex items-center gap-1.5')}>
            <Plus className="h-4 w-4" />Услуга
          </button>
        </div>
      </div>

      {noIkpu > 0 && (
        <p className={cn('rounded-xl px-4 py-2.5 text-[12.5px] font-semibold', TONE.amber)}>
          У {noIkpu} {plural(noIkpu, 'услуги', 'услуг', 'услуг')} не заполнен ИКПУ — он нужен для фискального чека.
        </p>
      )}

      <Card className="flex flex-wrap items-center gap-2.5 p-4">
        <Segmented
          value={category} onChange={setCategory}
          options={[
            { value: '', label: 'Все', count: items.length },
            ...CATEGORIES.filter((c) => items.some((i) => i.category === c)).map((c) => ({
              value: c, label: CATEGORY_LABEL[c] ?? c, count: items.filter((i) => i.category === c).length,
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
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-8">
          <Empty>
            {items.length === 0
              ? 'Каталог пуст. Добавьте услуги — без них записать гостя не получится.'
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
                {list.map((t) => (
                  <div key={t.id} className={cn('flex flex-wrap items-center gap-3 px-4 py-3', !t.active && 'opacity-50')}>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-[13.5px] font-bold">
                        {t.name}
                        {t.isCouple && (
                          <span className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold', TONE.violet)}>
                            <Users className="h-3 w-3" />парная
                          </span>
                        )}
                        {!t.active && <span className="text-[11px] font-bold text-muted-foreground">снята</span>}
                      </p>
                      <p className="truncate text-[11px] font-semibold text-muted-foreground">
                        {SPECIALTY_LABEL[t.requiredSpecialty] ?? t.requiredSpecialty} ·{' '}
                        {ROOM_TYPE_LABEL[t.requiredRoomType] ?? t.requiredRoomType} · НДС {t.vatPercent}% ·{' '}
                        ИКПУ {t.ikpuCode || <span className="text-amber-600 dark:text-amber-400">не задан</span>}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-[12px] font-bold text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />{minutesLabel(t.durationMin)}
                      {t.bufferAfterMin > 0 && <span className="opacity-60">+{t.bufferAfterMin}</span>}
                    </span>
                    <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold', TONE[CATEGORY_TONE[t.category] ?? 'neutral'])}>
                      {CATEGORY_LABEL[t.category] ?? t.category}
                    </span>
                    <span className="w-32 shrink-0 text-right text-[14px] font-extrabold tabular-nums">
                      {spaMoney(t.price)}
                    </span>
                    <button
                      onClick={() => setEditing(t)}
                      className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        ))
      )}

      <ServiceDialog
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />
    </div>
  );
}

function ServiceDialog({ target, onClose, onSaved }: {
  target: SpaTreatment | 'new' | null; onClose: () => void; onSaved: () => void;
}) {
  const item = target && target !== 'new' ? target : null;
  const [f, setF] = useState({
    name: '', category: 'massage', durationMin: '60', price: '',
    vatPercent: '12', ikpuCode: '', requiredSpecialty: 'massage', requiredRoomType: 'massage',
    isCouple: false, bufferBeforeMin: '0', bufferAfterMin: '10', active: true, description: '',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!target) return;
    setF(item ? {
      name: item.name, category: item.category, durationMin: String(item.durationMin),
      price: String(item.price), vatPercent: String(item.vatPercent), ikpuCode: item.ikpuCode ?? '',
      requiredSpecialty: item.requiredSpecialty, requiredRoomType: item.requiredRoomType,
      isCouple: item.isCouple, bufferBeforeMin: String(item.bufferBeforeMin),
      bufferAfterMin: String(item.bufferAfterMin), active: item.active, description: item.description ?? '',
    } : {
      name: '', category: 'massage', durationMin: '60', price: '',
      vatPercent: '12', ikpuCode: '', requiredSpecialty: 'massage', requiredRoomType: 'massage',
      isCouple: false, bufferBeforeMin: '0', bufferAfterMin: '10', active: true, description: '',
    });
  }, [target, item]);

  const submit = async () => {
    if (!f.name.trim()) { toast.error('Укажите название'); return; }
    setBusy(true);
    try {
      const payload = {
        name: f.name.trim(), category: f.category,
        durationMin: Number(f.durationMin) || 60, price: Number(f.price) || 0,
        vatPercent: Number(f.vatPercent) || 0, ikpuCode: f.ikpuCode.trim(),
        requiredSpecialty: f.requiredSpecialty, requiredRoomType: f.requiredRoomType,
        isCouple: f.isCouple,
        bufferBeforeMin: Number(f.bufferBeforeMin) || 0,
        bufferAfterMin: Number(f.bufferAfterMin) || 0,
        active: f.active, description: f.description.trim(),
      };
      if (item) await updateSpaTreatment(item.id, payload);
      else await createSpaTreatment(payload);
      toast.success(item ? 'Услуга обновлена' : 'Услуга добавлена');
      onSaved();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={!!target} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>{item ? 'Изменить услугу' : 'Новая услуга'}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <Labeled label="Название">
            <input
              autoFocus value={f.name}
              onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))}
              placeholder="Классический массаж 60 мин" className={INPUT}
            />
          </Labeled>
          <div className="grid grid-cols-3 gap-3">
            <Labeled label="Категория">
              <Select
                value={f.category} onChange={(v) => setF((p) => ({ ...p, category: v }))}
                options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] ?? c }))}
              />
            </Labeled>
            <Labeled label="Минут">
              <input
                type="number" min="5" step="5" value={f.durationMin}
                onChange={(e) => setF((p) => ({ ...p, durationMin: e.target.value }))} className={INPUT}
              />
            </Labeled>
            <Labeled label="Цена, UZS">
              <input
                type="number" min="0" value={f.price}
                onChange={(e) => setF((p) => ({ ...p, price: e.target.value }))} className={INPUT}
              />
            </Labeled>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Нужна специализация" hint="Мастер без неё не появится в расписании.">
              <Select
                value={f.requiredSpecialty} onChange={(v) => setF((p) => ({ ...p, requiredSpecialty: v }))}
                options={SPECIALTIES.map((s) => ({ value: s, label: SPECIALTY_LABEL[s] ?? s }))}
              />
            </Labeled>
            <Labeled label="Тип кабинета" hint="«Универсальный» подходит под любую услугу.">
              <Select
                value={f.requiredRoomType} onChange={(v) => setF((p) => ({ ...p, requiredRoomType: v }))}
                options={ROOM_TYPES.map((s) => ({ value: s, label: ROOM_TYPE_LABEL[s] ?? s }))}
              />
            </Labeled>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Labeled label="НДС, %">
              <input
                type="number" min="0" value={f.vatPercent}
                onChange={(e) => setF((p) => ({ ...p, vatPercent: e.target.value }))} className={INPUT}
              />
            </Labeled>
            <Labeled label="ИКПУ">
              <input
                value={f.ikpuCode} onChange={(e) => setF((p) => ({ ...p, ikpuCode: e.target.value }))}
                placeholder="96121000" className={INPUT}
              />
            </Labeled>
          </div>
          <p className="-mt-1 text-[11px] font-medium text-muted-foreground">
            Цена указывается с НДС — в чеке налог показывается отдельной строкой.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Подготовка, мин" hint="Блокирует кабинет до начала.">
              <input
                type="number" min="0" value={f.bufferBeforeMin}
                onChange={(e) => setF((p) => ({ ...p, bufferBeforeMin: e.target.value }))} className={INPUT}
              />
            </Labeled>
            <Labeled label="Уборка, мин" hint="Блокирует кабинет после окончания.">
              <input
                type="number" min="0" value={f.bufferAfterMin}
                onChange={(e) => setF((p) => ({ ...p, bufferAfterMin: e.target.value }))} className={INPUT}
              />
            </Labeled>
          </div>

          <div className="flex flex-wrap gap-2">
            <Toggle
              on={f.isCouple} onClick={() => setF((p) => ({ ...p, isCouple: !p.isCouple }))}
              label="Парная процедура"
            />
            <Toggle
              on={f.active} onClick={() => setF((p) => ({ ...p, active: !p.active }))}
              label={f.active ? 'В продаже' : 'Снята с продажи'}
            />
          </div>
          {f.isCouple && (
            <p className={cn('rounded-xl px-3 py-2 text-[11.5px] font-semibold', TONE.violet)}>
              Потребуются два свободных мастера и кабинет минимум на два места одновременно.
            </p>
          )}

          <button onClick={submit} disabled={busy} className={cn(BTN_PRIMARY, 'mt-1 w-full')}>
            {busy ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
