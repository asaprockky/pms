import { PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ArrowUp, CalendarCheck, CheckSquare, Download, ListChecks, Sparkles, Star, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { AtlasCard, AtlasMessage, AtlasSuggestions, askAtlasStream, getAtlasSuggestions } from '@/api';

import { useAuth } from '@/auth';
import { useI18n } from '@/i18n';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Markdown } from '@/components/Markdown';
import { formatMoney } from '@/lib/utils';

type Turn = { role: 'user' | 'assistant'; content: string; card?: AtlasCard; offline?: boolean; streaming?: boolean };

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

const WIDTH_KEY = 'atlas.panelWidth';
const DEFAULT_WIDTH = 440;
const MIN_WIDTH = 360;
/** Always leave a strip of the app visible so the panel never feels like a page. */
const maxWidth = () => Math.max(MIN_WIDTH, window.innerWidth - 120);

export function AtlasPanel({
  open,
  onOpenChange,
  screen,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Screen the user is on, so Atlas can read the room. */
  screen?: string;
  onNavigate?: (key: string) => void;
}) {
  const { t, lang } = useI18n();
  const { session } = useAuth();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<AtlasSuggestions | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Role-scoped suggested prompts, fetched once when the panel opens. Derived
  // server-side from the authenticated role, so a user can never request
  // another role's suggestions.
  useEffect(() => {
    if (!open || suggestions) return;
    getAtlasSuggestions()
      .then(setSuggestions)
      .catch(() => { /* non-fatal — the panel still works without chips */ });
  }, [open, suggestions]);


  // Panel width is the user's to set — a long table or a checklist needs more
  // room than a one-line answer. Remembered across sessions.
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return saved >= MIN_WIDTH ? saved : DEFAULT_WIDTH;
  });
  const dragging = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, busy]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  const send = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    const next: Turn[] = [...turns, { role: 'user', content: q }];
    setTurns(next);
    setInput('');
    setBusy(true);
    const history: AtlasMessage[] = next.map((m) => ({ role: m.role, content: m.content }));
    // Placeholder bubble the stream types into.
    const slot = next.length;
    setTurns([...next, { role: 'assistant', content: '', streaming: true }]);
    try {
      const res = await askAtlasStream(
        history,
        { hotelName: session?.hotel?.name, lang, screen },
        (text) => setTurns((cur) => {
          const copy = [...cur];
          if (copy[slot]) copy[slot] = { ...copy[slot], content: text, streaming: true };
          return copy;
        }),
      );
      setTurns((cur) => {
        const copy = [...cur];
        copy[slot] = { role: 'assistant', content: res.reply, card: res.card, offline: !res.usedAi };
        return copy;
      });
    } catch (e) {
      setTurns((cur) => {
        const copy = [...cur];
        copy[slot] = { role: 'assistant', content: (e as Error).message || t('atlas.error'), offline: true };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  };

  // Pointer capture keeps the drag alive even when the cursor outruns the
  // 6px handle, which is easy to do when flinging the panel wide.
  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const next = Math.min(Math.max(window.innerWidth - e.clientX, MIN_WIDTH), maxWidth());
    setWidth(next);
  };
  const endResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    localStorage.setItem(WIDTH_KEY, String(width));
  };
  const resetWidth = () => {
    setWidth(DEFAULT_WIDTH);
    localStorage.setItem(WIDTH_KEY, String(DEFAULT_WIDTH));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="flex w-full flex-col overflow-hidden p-0 sm:max-w-none"
        style={{ width: `min(${width}px, 100vw)` }}
      >
        <DialogPrimitive.Title className="sr-only">{t('atlas.title')}</DialogPrimitive.Title>

        {/* Drag to resize; double-click to snap back. Pointer-events only —
            no layout cost when idle. */}
        <div
          onPointerDown={startResize}
          onPointerMove={onResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onDoubleClick={resetWidth}
          title={t('atlas.resizeHint')}
          className="group absolute inset-y-0 left-0 z-10 hidden w-1.5 cursor-col-resize touch-none sm:block"
        >
          <span className="absolute inset-y-0 left-0 w-px bg-transparent transition-colors group-hover:bg-accent/60" />
          <span className="absolute left-0 top-1/2 h-10 w-1 -translate-y-1/2 rounded-r bg-foreground/10 opacity-0 transition-opacity group-hover:opacity-100" />
        </div>

        <div className="relative flex items-center gap-3 border-b border-transparent px-5 py-4">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-accent/[0.07] to-transparent" />
          <span className="brand-grad brand-glow relative flex h-10 w-10 items-center justify-center rounded-2xl"><Sparkles className="h-5 w-5 text-white" /></span>
          <div className="relative min-w-0">
            <p className="text-[15px] font-extrabold">Atlas AI</p>
            <p className="truncate text-[11.5px] font-semibold text-muted-foreground">{t('atlas.subtitle')}</p>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {turns.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <span className="brand-grad brand-glow flex h-14 w-14 items-center justify-center rounded-[20px]"><Sparkles className="h-7 w-7 text-white" /></span>
              <p className="text-[15px] font-extrabold">{t('atlas.emptyTitle')}</p>
              <p className="max-w-[300px] text-[13px] font-medium leading-relaxed text-muted-foreground">{t('atlas.emptyHint')}</p>
              {suggestions && suggestions.suggestions.length > 0 && (
                <div className="mt-2 flex w-full max-w-[320px] flex-col gap-2">
                  <p className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                    {t('atlas.suggestedFor')} {suggestions.persona}
                  </p>
                  {suggestions.suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      disabled={busy}
                      className="rounded-xl border border-transparent bg-card px-3.5 py-2.5 text-left text-[12.5px] font-semibold text-foreground/85 transition-colors hover:border-accent/40 hover:bg-accent/5 disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (

            turns.map((m, i) => <Bubble key={i} turn={m} onNavigate={onNavigate} />)
          )}
          {/* Dots only until the first token lands; after that the text itself
              is the progress indicator. */}
          {busy && !turns[turns.length - 1]?.content && (
            <div className="flex items-center gap-1.5 px-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.2s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.1s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
            </div>
          )}
        </div>

        <div className="border-t border-transparent p-3">
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              rows={1}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter breaks the line — chat convention.
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              placeholder={t('atlas.placeholder')}
              className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-input bg-input px-3.5 py-3 text-sm outline-none focus:border-ring"
            />
            <button type="submit" disabled={!input.trim() || busy}
              className="brand-grad brand-glow flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-opacity hover:opacity-90 disabled:opacity-40">
              <ArrowUp className="h-5 w-5 text-white" />
            </button>
          </form>
          <p className="mt-1.5 px-1 text-center text-[10.5px] font-medium text-muted-foreground">{t('atlas.disclaimer')}</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Reveals text progressively, easing out so it finishes quickly on long
 * answers. Sits on top of whatever the transport delivers: with streaming it
 * smooths the chunky token bursts, and when the answer arrives in one piece
 * (non-streaming fallback) it still types out. Respects reduced-motion.
 */
function useTypewriter(target: string): string {
  const [shown, setShown] = useState(target);
  const frame = useRef<number>();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const instant = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // Never un-reveal: if the final text replaces the streamed draft, keep what
    // is already on screen and continue from there.
    if (instant || !target.startsWith(shown.slice(0, Math.min(shown.length, target.length)))) {
      setShown(target);
      return;
    }
    if (shown.length >= target.length) { if (shown !== target) setShown(target); return; }

    const step = () => {
      setShown((cur) => {
        if (cur.length >= target.length) return target;
        const remaining = target.length - cur.length;
        const advance = Math.max(2, Math.ceil(remaining * 0.09));
        return target.slice(0, cur.length + advance);
      });
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => { if (frame.current) cancelAnimationFrame(frame.current); };
  }, [target, shown]);

  return shown;
}

function Bubble({ turn, onNavigate }: { turn: Turn; onNavigate?: (key: string) => void }) {
  const { t } = useI18n();
  const shown = useTypewriter(turn.role === 'assistant' ? turn.content : '');
  const typing = turn.role === 'assistant' && (shown.length < turn.content.length || !!turn.streaming);

  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="brand-grad max-w-[85%] whitespace-pre-line rounded-2xl rounded-br-md px-3.5 py-2 text-[13.5px] font-medium text-white">{turn.content}</div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="flex max-w-[92%] gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"><Sparkles className="h-4 w-4" /></span>
        <div className="min-w-0 space-y-2">
          <div className="rounded-2xl rounded-tl-md border border-transparent bg-card px-3.5 py-2.5 text-[13.5px] leading-relaxed text-foreground/90">
            <Markdown>{shown}</Markdown>
            {/* Caret while there is still text left to reveal. */}
            {typing && <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-accent align-middle" />}
          </div>
          {turn.offline && (
            <p className="px-1 text-[10.5px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">{t('atlas.offline')}</p>
          )}
          {turn.card && <CardView card={turn.card} onNavigate={onNavigate} />}
        </div>
      </div>
    </div>
  );
}

function CardView({ card, onNavigate }: { card: AtlasCard; onNavigate?: (key: string) => void }) {
  const { t } = useI18n();

  if (card.kind === 'snapshot') {
    const tiles = [
      { label: t('atlas.tileOccupancy'), value: `${card.occupancy}%` },
      { label: t('atlas.tileArrivals'), value: card.arrivals },
      { label: t('atlas.tileDepartures'), value: card.departures },
      { label: t('atlas.tileFree'), value: card.free },
    ];
    return (
      <div className="rounded-xl border border-transparent bg-card p-3">
        <div className="grid grid-cols-4 gap-2">
          {tiles.map((tl) => (
            <div key={tl.label} className="text-center">
              <p className="text-[15px] font-extrabold">{tl.value}</p>
              <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{tl.label}</p>
            </div>
          ))}
        </div>
        {card.dueBalance != null && card.dueBalance > 0 && (
          <p className="mt-2 border-t border-transparent pt-2 text-center text-[11.5px] font-semibold text-muted-foreground">
            {t('atlas.dueColonLabel')} {fmt(card.dueBalance)} UZS
          </p>
        )}
      </div>
    );
  }

  if (card.kind === 'checklist') {
    // Excel opens UTF-8 CSV correctly only with a BOM; without it Cyrillic
    // arrives as mojibake on Windows.
    const exportCsv = () => {
      const rows = [
        [t('atlas.csvItem'), t('atlas.csvStatus')],
        ...card.items.map((i) => [i.title, t('atlas.csvOpen')]),
      ];
      const csv = rows
        .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
        .join('\r\n');
      const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${card.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'checklist'}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t('atlas.exported'));
    };

    return (
      <div className="rounded-xl border border-transparent bg-card p-3">
        <div className="mb-2 flex items-start gap-2">
          <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-extrabold leading-tight">{card.title}</p>
            <p className="text-[11px] font-semibold text-muted-foreground">
              {card.items.length} {t('atlas.checklistItems')}
              {card.due ? ` · ${t('atlas.checklistDue')} ${card.due}` : ''}
            </p>
          </div>
        </div>
        <ul className="mb-2.5 space-y-1">
          {card.items.map((i) => (
            <li key={i.id} className="flex items-start gap-1.5 text-[12.5px] leading-snug">
              <CheckSquare className="mt-[3px] h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
              <span>{i.title}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-1.5">
          {onNavigate && (
            <button onClick={() => onNavigate('tasks')}
              className="rounded-lg bg-accent/10 px-2.5 py-1.5 text-[11.5px] font-bold text-accent transition-colors hover:bg-accent/20">
              {t('atlas.checklistOpen')}
            </button>
          )}
          <button onClick={exportCsv}
            className="flex items-center gap-1 rounded-lg bg-muted px-2.5 py-1.5 text-[11.5px] font-bold text-muted-foreground transition-colors hover:text-foreground">
            <Download className="h-3.5 w-3.5" />{t('atlas.checklistExport')}
          </button>
        </div>
      </div>
    );
  }

  if (card.kind === 'guest') {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-transparent bg-card p-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent"><UserRound className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 truncate text-[13px] font-extrabold">{card.name}{card.vip && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />}</p>
          <p className="truncate text-[11.5px] font-semibold text-muted-foreground">{card.phone || '—'}{card.stay ? ` · ${card.stay}` : ''}</p>
        </div>
        {card.balance != null && card.balance > 0 && <span className="shrink-0 rounded-full bg-amber-500/12 px-2.5 py-1 text-[11px] font-bold text-amber-700 dark:text-amber-400">{fmt(card.balance)} UZS</span>}
      </div>
    );
  }

  if (card.kind === 'availability') {
    return (
      <div className="rounded-xl border border-transparent bg-card p-3">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{card.checkIn} → {card.checkOut}</p>
        <ul className="space-y-1">
          {card.rooms.map((r) => (
            <li key={r.number} className="flex items-center justify-between text-[12.5px]">
              <span className="font-semibold">№{r.number} · {r.type}</span>
              <span className="font-extrabold">{fmt(r.total)} UZS</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] p-3">
      <p className="mb-1 flex items-center gap-1.5 text-[12px] font-extrabold text-emerald-700 dark:text-emerald-400"><CalendarCheck className="h-4 w-4" /> {t('atlas.bookingCreatedLabel')} {card.code}</p>
      <p className="text-[12.5px] font-semibold">{card.guest}</p>
      <p className="text-[11.5px] font-medium text-muted-foreground">№{card.room} · {card.checkIn} → {card.checkOut} · {card.nights} {t('grp.nightsAbbr')} · {formatMoney(card.total)}</p>
    </div>
  );
}
