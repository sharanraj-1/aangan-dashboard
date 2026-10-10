// Shared UI primitives — light, calm, minimal. Server components only (no client JS).
// Keep these stable: every view uses them. Design rules: sentence-case labels, soft tinted status pills, rounded cards,
// big serif numbers, generous spacing, detail behind <Collapsible> instead of on the page.

import Link from 'next/link';
import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'ok' | 'warn' | 'crit' | 'info' | 'accent';

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-text', ok: 'text-ok', warn: 'text-warn', crit: 'text-crit', info: 'text-info', accent: 'text-accent',
};
const TONE_PILL: Record<Tone, string> = {
  neutral: 'bg-subtle text-mute', ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', crit: 'bg-crit-soft text-crit',
  info: 'bg-info-soft text-info', accent: 'bg-accent-soft text-accent',
};
export const TONE_BG: Record<Tone, string> = {
  neutral: 'bg-line-strong', ok: 'bg-ok', warn: 'bg-warn', crit: 'bg-crit', info: 'bg-info', accent: 'bg-accent',
};

/** Status pill. Always carries text (never colour alone). */
export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_PILL[tone]}`}>
      {children}
    </span>
  );
}

/** Page title block: a serif headline with an optional one-line explanation and right-aligned actions. */
export function PageHeader({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-[15px] text-mute">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

/** Section heading. (`index` is accepted for backwards compatibility and ignored — no numbering.) */
export function SectionHead({ title, note, right }: { index?: string; title: string; note?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex items-end justify-between gap-4 first:mt-0">
      <div>
        <h2 className="font-display text-xl font-semibold tracking-tight">{title}</h2>
        {note && <p className="mt-0.5 max-w-2xl text-sm text-mute">{note}</p>}
      </div>
      {right}
    </div>
  );
}

export function Panel({ title, right, hot, children, className = '', pad = true }: { title?: ReactNode; right?: ReactNode; hot?: boolean; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`${hot ? 'panel-hot' : 'panel'} ${className}`}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 px-5 pt-4">
          <h3 className="text-sm font-semibold">{title}</h3>
          {right}
        </header>
      )}
      <div className={pad ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

/**
 * Detail on demand: a card whose body is hidden until opened. Use for anything secondary so the page stays calm.
 * Pure HTML <details> — no JavaScript.
 */
export function Collapsible({ title, hint, children, defaultOpen = false }: { title: ReactNode; hint?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group panel">
      <summary className="flex items-center justify-between gap-4 rounded-2xl px-5 py-4 hover:bg-subtle/60">
        <span>
          <span className="text-sm font-semibold">{title}</span>
          {hint && <span className="ml-2 text-sm text-mute">{hint}</span>}
        </span>
        <span aria-hidden className="text-mute transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="border-t border-line p-5">{children}</div>
    </details>
  );
}

/** Big-number KPI card. `hot` = accent outline (use for the one or two numbers that matter most). */
export function Kpi({ label, value, sub, tone = 'neutral', hot, href, unit }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; hot?: boolean; href?: string; unit?: string }) {
  const body = (
    <div className={`${hot ? 'panel-hot' : 'panel'} h-full p-5 transition-shadow ${href ? 'hover:shadow-lift' : ''}`}>
      <div className="label">{label}</div>
      <div className={`num mt-2 text-4xl leading-none sm:text-[2.6rem] ${TONE_TEXT[tone]}`}>
        {value}
        {unit && <span className="ml-1 font-sans text-lg font-normal text-mute">{unit}</span>}
      </div>
      {sub && <div className="mt-2.5 text-sm text-mute">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block rounded-2xl">{body}</Link> : body;
}

/** Thin horizontal bar. value/max in the same units. */
export function Bar({ value, max, tone = 'accent', height = 8, label }: { value: number; max: number; tone?: Tone; height?: number; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="w-full overflow-hidden rounded-full bg-subtle" style={{ height }} role="img" aria-label={label ?? `${Math.round(pct)}%`}>
      <div className={`h-full rounded-full ${TONE_BG[tone]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * How sure the AI is that it understood the conversation. Plain words first; the bar is secondary.
 * `value` and `threshold` are 0–1. Below the threshold the enquiry is held for a person to check.
 */
export function ConfidenceMeter({ value, threshold = 0.85, label = true }: { value: number | null; threshold?: number; label?: boolean }) {
  if (value === null) return <span className="text-xs text-faint">n/a</span>;
  const ok = value >= threshold;
  return (
    <div className="flex items-center gap-2" title={`Needs ${(threshold * 100).toFixed(0)}% or more to go straight to a designer`}>
      <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-subtle" role="img" aria-label={`Confidence ${(value * 100).toFixed(0)}% (needs ${(threshold * 100).toFixed(0)}%)`}>
        <div className={`h-full rounded-full ${ok ? 'bg-ok' : 'bg-crit'}`} style={{ width: `${value * 100}%` }} />
      </div>
      {label && <span className={`text-xs tabular-nums ${ok ? 'text-mute' : 'font-medium text-crit'}`}>{(value * 100).toFixed(0)}%{ok ? '' : ' · needs a check'}</span>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line-strong bg-surface/60 px-4 py-8 text-center text-sm text-mute">{children}</div>;
}

/** Status message shown after an action (?msg=…&ok=1|0). */
export function Flash({ msg, ok }: { msg?: string; ok?: string }) {
  if (!msg) return null;
  const good = ok !== '0';
  return (
    <div role="status" className={`mb-5 flex items-start gap-3 rounded-xl px-4 py-3 text-sm ${good ? 'bg-ok-soft text-ok' : 'bg-crit-soft text-crit'}`}>
      <span aria-hidden className="mt-0.5 font-semibold">{good ? '✓' : '!'}</span>
      <span className="text-text">{msg}</span>
    </div>
  );
}

/** Every form must carry this so actions redirect back to the same view. */
export function ReturnTo({ value }: { value: string }) {
  return <input type="hidden" name="return_to" value={value} />;
}

// ---- tone helpers ----------------------------------------------------------------------------

export const qualTone = (q: string | null | undefined): Tone =>
  q === 'qualified' ? 'ok' : q === 'unqualified' ? 'neutral' : q === 'review' ? 'warn' : 'neutral';
export const qualLabel = (q: string | null | undefined) =>
  q === 'qualified' ? 'Good fit' : q === 'unqualified' ? 'Not a fit' : q === 'review' ? 'Needs a look' : q === 'not_applicable' ? 'Not a lead' : '—';
export const severityTone = (s: string): Tone => (s === 'critical' ? 'crit' : s === 'high' ? 'crit' : s === 'medium' ? 'warn' : 'neutral');
export const statusTone = (s: string): Tone =>
  s === 'won' ? 'ok' : s === 'handed_off' ? 'info' : s === 'escalated' ? 'warn' : s === 'lost' ? 'crit' : 'neutral';
export const channelLabel = (c: string) => (c === 'web_form' ? 'Web form' : c === 'whatsapp' ? 'WhatsApp' : 'Phone');
