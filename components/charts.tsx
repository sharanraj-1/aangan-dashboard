// Small server-rendered chart helpers (div bars, CSS-variable colours, no client JS).
// Calm by design: thin rounded marks, a muted palette, direct labels, no gridlines.
// Every chart has role="img" + aria-label and a visible legend/labels, so colour is never the only signal.

import type { ReactNode } from 'react';
import { Bar, TONE_BG, type Tone } from './ui';

const pctText = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;

// ---- Stat: compact numeral cell (sits inside panels / grids) --------------------------------------

const STAT_TEXT: Record<Tone, string> = {
  neutral: 'text-text', ok: 'text-ok', warn: 'text-warn', crit: 'text-crit', info: 'text-info', accent: 'text-accent',
};

/** Mid-size numeral with a caption, on a quiet tinted tile. */
export function Stat({ label, value, sub, tone = 'neutral', unit }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; unit?: string }) {
  return (
    <div className="rounded-xl bg-subtle/60 p-4">
      <div className="label">{label}</div>
      <div className={`num mt-1.5 text-2xl leading-none md:text-3xl ${STAT_TEXT[tone]}`}>
        {value}
        {unit && <span className="ml-1 font-sans text-sm font-normal text-mute">{unit}</span>}
      </div>
      {sub && <div className="mt-1.5 text-sm leading-snug text-mute">{sub}</div>}
    </div>
  );
}

/** Responsive grid wrapper for Stat tiles. */
export function StatGrid({ children, className = 'grid-cols-2 md:grid-cols-4' }: { children: ReactNode; className?: string }) {
  return <div className={`grid gap-3 ${className}`}>{children}</div>;
}

// ---- Daily volume (optionally stacked by channel) -------------------------------------------------

export interface DailyPoint { day: string; phone: number; whatsapp: number; web_form: number; total: number }

// Stack order bottom → top. Three muted, clearly different steps: terracotta, blue, warm grey.
const SERIES = [
  { key: 'phone', label: 'Phone', fill: 'rgb(var(--accent))' },
  { key: 'whatsapp', label: 'WhatsApp', fill: 'rgb(var(--info))' },
  { key: 'web_form', label: 'Web form', fill: 'rgb(var(--line-strong))' },
] as const;

export function ChannelLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-mute" aria-label="Legend">
      {SERIES.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.fill }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * One thin rounded column per day of the month, stacked phone → WhatsApp → web form.
 * Pass `stacked={false}` for a single-colour version. Day-of-month ticks appear every 7 days; no gridlines.
 */
export function StackedDailyBars({ days, height = 120, stacked = true }: { days: DailyPoint[]; height?: number; stacked?: boolean }) {
  const n = days.length;
  const max = Math.max(1, ...days.map((d) => d.total));
  const total = days.reduce((a, d) => a + d.total, 0);
  const peak = days.reduce((a, d) => (d.total > a.total ? d : a), days[0]);
  const label = `Daily enquiries${stacked ? ', stacked by channel' : ''}. ${total} in total across ${n} days; busiest day ${peak ? Number(peak.day.slice(8)) : ''} with ${peak?.total ?? 0}.`;

  return (
    <figure className="m-0">
      <div className="flex items-end gap-[2px]" style={{ height }} role="img" aria-label={label}>
        {days.map((d) => {
          // Top-most non-empty series gets the rounded cap (columns render top → bottom).
          const topKey = [...SERIES].reverse().find((s) => d[s.key] > 0)?.key;
          return (
            <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${Number(d.day.slice(8))}: ${d.total} ${d.total === 1 ? 'enquiry' : 'enquiries'}`}>
              {stacked ? (
                [...SERIES].reverse().map((s) => {
                  const v = d[s.key];
                  if (!v) return null;
                  return <div key={s.key} className={s.key === topKey ? 'rounded-t-full' : ''} style={{ height: `${(v / max) * 100}%`, minHeight: 2, background: s.fill }} />;
                })
              ) : (
                d.total > 0 && <div className="rounded-t-full" style={{ height: `${(d.total / max) * 100}%`, minHeight: 2, background: 'rgb(var(--accent))' }} />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-[2px]" aria-hidden>
        {days.map((d, i) => (
          <span key={d.day} className="relative min-w-0 flex-1 text-[13px] leading-none text-mute">
            {i % 7 === 0 && <span className="absolute left-0 whitespace-nowrap">{Number(d.day.slice(8))}</span>}
          </span>
        ))}
      </div>
      {stacked && <figcaption className="mt-6"><ChannelLegend /></figcaption>}
    </figure>
  );
}

// ---- Horizontal distribution list ----------------------------------------------------------------

export interface DistItem { label: string; n: number; tone?: Tone; sub?: ReactNode }

/** Label · count · share, with a thin rounded bar. Bars are scaled to the largest item (or `total` if given). */
export function DistributionList({ items, total, scale = 'max', empty = 'Nothing recorded yet.' }: { items: DistItem[]; total?: number; scale?: 'max' | 'total'; empty?: string }) {
  const sumN = total ?? items.reduce((a, i) => a + i.n, 0);
  const max = scale === 'total' ? sumN : Math.max(1, ...items.map((i) => i.n));
  if (sumN === 0) return <p className="text-sm text-mute">{empty}</p>;
  return (
    <ul className="space-y-3.5">
      {items.map((it) => (
        <li key={it.label}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm">{it.label}</span>
            <span className="text-sm tabular-nums">
              {it.n}
              <span className="ml-2 text-mute">{pctText(it.n / sumN)}</span>
            </span>
          </div>
          <div className="mt-1.5"><Bar value={it.n} max={max} tone={it.tone ?? 'accent'} height={6} label={`${it.label}: ${it.n} of ${sumN}`} /></div>
          {it.sub && <div className="mt-1 text-sm text-mute">{it.sub}</div>}
        </li>
      ))}
    </ul>
  );
}

// ---- Segmented bar (parts of a whole) ------------------------------------------------------------

export interface Segment { label: string; n: number; tone: Tone }

/** One rounded bar split into segments, with a legend that carries the counts (not colour alone). */
export function SegmentedBar({ segments, height = 12 }: { segments: Segment[]; height?: number }) {
  const total = segments.reduce((a, s) => a + s.n, 0);
  if (total === 0) return <p className="text-sm text-mute">Nothing recorded yet.</p>;
  const label = segments.map((s) => `${s.label} ${s.n}`).join(', ') + `; total ${total}`;
  return (
    <div>
      <div className="flex w-full gap-0.5 overflow-hidden rounded-full" style={{ height }} role="img" aria-label={label}>
        {segments.filter((s) => s.n > 0).map((s) => (
          <div key={s.label} className={TONE_BG[s.tone]} style={{ width: `${(s.n / total) * 100}%` }} title={`${s.label}: ${s.n}`} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${TONE_BG[s.tone]}`} aria-hidden />
            <span className="text-mute">{s.label}</span>
            <span className="ml-auto tabular-nums sm:ml-1">{s.n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- Funnel --------------------------------------------------------------------------------------

/** Simple horizontal list: each step shows its count and what share of the step above made it through. */
export function Funnel({ steps }: { steps: { label: string; n: number }[] }) {
  const top = Math.max(1, steps[0]?.n ?? 0);
  return (
    <ol className="space-y-4" aria-label="From enquiry to won project">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].n : null;
        const step = prev !== null && prev > 0 ? s.n / prev : null;
        const widthPct = Math.max(s.n > 0 ? 2 : 0, (s.n / top) * 100);
        return (
          <li key={s.label}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span>{s.label}</span>
              <span className="tabular-nums">
                {s.n}
                <span className="ml-2 text-mute">{i === 0 ? '' : step === null ? '—' : `${pctText(step)} of the step before`}</span>
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-subtle" role="img" aria-label={`${s.label}: ${s.n} (${pctText(s.n / top)} of all enquiries)`}>
              <div className="h-full rounded-full" style={{ width: `${widthPct}%`, background: i === steps.length - 1 ? 'rgb(var(--ok))' : 'rgb(var(--accent))' }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
