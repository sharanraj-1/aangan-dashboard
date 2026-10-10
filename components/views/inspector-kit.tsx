// Shared types + small helpers for the Enquiry Inspector (designer-only screen): data bundle, status wording,
// IST datetime helpers, and a few tiny presentational bits.

import type { ReactNode } from 'react';
import type { ViewCtx } from '@/components/types';
import type { Tone } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { effectiveQualification } from '@/lib/metrics';
import type { DesignerRow, EnquiryRow, EscalationRow, EscalationTrigger, PricingLogRow, TranscriptRow } from '@/lib/types';
import { href, type SP } from '@/lib/url';

/** Everything an inspector panel needs, fetched once in Inspector.tsx. */
export interface InspectorData {
  ctx: ViewCtx;
  e: EnquiryRow;
  tr: TranscriptRow | null;
  escs: EscalationRow[];
  pricing: PricingLogRow | null;
  designers: DesignerRow[];
}

export const designerLabel = (d: DesignerRow) => `${d.name}${d.is_sample ? ' (sample)' : ''}`;
export const isOpenEsc = (x: EscalationRow) => x.status !== 'resolved';

// ---- tabs --------------------------------------------------------------------------------------------

export type TabKey = 'overview' | 'conversation' | 'followup' | 'details';
export const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'conversation', label: 'Conversation' },
  { key: 'followup', label: 'Follow up' },
  { key: 'details', label: 'Details' },
];
export const tabFromParam = (v: string | undefined): TabKey => TABS.find((t) => t.key === v)?.key ?? 'overview';

/** Link to a tab of the open enquiry. The default tab drops the param so URLs stay short. */
export function tabHref(sp: SP, tab: TabKey, anchor?: string, extra: Record<string, string | null> = {}): string {
  return `${href(sp, { tab: tab === 'overview' ? null : tab, ...extra })}${anchor ? `#${anchor}` : ''}`;
}

// ---- status wording ----------------------------------------------------------------------------------

/** A person has to look: the AI sent it to review with no final call, or something is still open. */
export const needsLook = (e: EnquiryRow, openEscalations: number): boolean =>
  (e.ai_qualification === 'review' && !e.final_qualification) || openEscalations > 0;

/** A lead that is still being worked (so a missing first reply matters). */
export function isActiveLead(e: EnquiryRow): boolean {
  const eff = effectiveQualification(e);
  return (eff === 'qualified' || eff === 'review') && ['new', 'escalated', 'handed_off'].includes(e.status);
}

/** The one status pill shown for an enquiry, in plain words. */
export function enquiryStatus(e: EnquiryRow, openEscalations: number): { label: string; tone: Tone } {
  if (e.status === 'won') return { label: 'Won', tone: 'ok' };
  if (e.status === 'lost') return { label: 'Lost', tone: 'crit' };
  const eff = effectiveQualification(e);
  if (eff === 'not_applicable') return { label: 'Not a lead', tone: 'neutral' };
  if (needsLook(e, openEscalations)) return { label: 'Needs a look', tone: 'warn' };
  if (eff === 'unqualified') return { label: 'Not a fit', tone: 'neutral' };
  if (eff === 'qualified') return { label: 'Good fit', tone: 'ok' };
  return { label: 'Needs a look', tone: 'warn' };
}

/** "5 min ago", "3 hours ago", "yesterday", "3 days ago", then a plain date. */
export function relativeTime(iso: string, now: Date): string {
  const mins = (now.getTime() - new Date(iso).getTime()) / 60_000;
  if (!Number.isFinite(mins)) return '';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.round(mins)} min ago`;
  const hours = mins / 60;
  if (hours < 24) { const h = Math.round(hours); return `${h} hour${h === 1 ? '' : 's'} ago`; }
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return formatDate(iso);
}

/** Plain-language names for escalation triggers. */
const TRIGGER_TITLE: Record<EscalationTrigger, string> = {
  low_confidence: 'The AI was not sure it heard this correctly',
  ambiguous_scope: 'It is not clear what work they want',
  ambiguous_location: 'It is not clear where the project is',
  ai_failure: 'The AI could not read this enquiry',
  needs_clarification: 'One thing needs checking with the client',
  high_value_fringe: 'A large enquiry on the edge of our service area',
  audit_sample: 'Spot check: is the AI right about this one?',
  budget_below_minimum: 'Their budget looks below our minimum',
  custom_work: 'This needs custom work, so a person should decide',
  agent_policy_breach: 'The studio side may have quoted a price',
  existing_client_complaint: 'An existing client has a complaint',
  response_sla_breach: 'No reply has gone out yet',
  missed_call: 'A missed call that needs a call back',
};
export const triggerTitle = (t: EscalationTrigger): string => TRIGGER_TITLE[t] ?? t.replace(/_/g, ' ');

/** Escalations that mean "the AI could not decide on its own": the designer's call is good fit / not a fit. */
export const GATE_TRIGGERS: EscalationTrigger[] = ['needs_clarification', 'low_confidence', 'ambiguous_scope', 'ambiguous_location', 'ai_failure'];

/** Mirrors the blocking rule in lib/workflow.ts (releaseHandoff) so the UI can explain why sending is disabled. */
export function blockingEscalations(escs: EscalationRow[], e: Pick<EnquiryRow, 'final_qualification'>): EscalationRow[] {
  return escs.filter(
    (x) =>
      x.status !== 'resolved' &&
      (x.kind === 'transcription' || x.kind === 'lead_qualification' || (x.kind === 'pricing' && x.trigger !== 'agent_policy_breach') ||
        x.trigger === 'existing_client_complaint' || x.trigger === 'missed_call') &&
      (x.kind !== 'lead_qualification' || e.final_qualification !== 'qualified'),
  );
}

// ---- IST datetime-local helpers ----------------------------------------------------------------------

const istFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Date -> 'YYYY-MM-DDTHH:mm' in IST, the value format of <input type="datetime-local">. */
export function istInput(d: Date): string {
  const p: Record<string, string> = {};
  for (const part of istFmt.formatToParts(d)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** 'YYYY-MM-DDTHH:mm' (IST) -> Date, or null if malformed. */
export function parseIstInput(v: string | undefined | null): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const d = new Date(`${v}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseIso(v: string | undefined | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---- tiny presentational bits ------------------------------------------------------------------------

export function Field({ label, htmlFor, hint, children, className = '' }: { label: string; htmlFor?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="label mb-1 block">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[13px] text-mute">{hint}</p>}
    </div>
  );
}

export function DesignerSelect({ id, name, designers, value, blankLabel }: { id: string; name: string; designers: DesignerRow[]; value: string | null | undefined; blankLabel: string }) {
  return (
    <select id={id} name={name} defaultValue={value ?? ''} className="field">
      <option value="">{blankLabel}</option>
      {designers.map((d) => (
        <option key={d.id} value={d.id}>{designerLabel(d)}</option>
      ))}
    </select>
  );
}

/** Quiet "label — value" row used in fact lists. */
export function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="label shrink-0">{k}</dt>
      <dd className="min-w-0 break-words text-sm sm:text-right">{children}</dd>
    </div>
  );
}

/** A small inline "show more" disclosure (plain <details>) for secondary controls inside a card. */
export function More({ title, children, defaultOpen = false }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group mt-4">
      <summary className="inline-flex items-center gap-1.5 rounded-full text-sm font-medium text-mute hover:text-text">
        <span aria-hidden className="text-[13px] transition-transform group-open:rotate-90">›</span>
        {title}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

/** One-line soft notice. */
export function Notice({ tone = 'warn', children }: { tone?: 'warn' | 'crit' | 'info' | 'ok'; children: ReactNode }) {
  const cls = { warn: 'bg-warn-soft', crit: 'bg-crit-soft', info: 'bg-info-soft', ok: 'bg-ok-soft' }[tone];
  return <div className={`rounded-xl px-4 py-2.5 text-sm ${cls}`}>{children}</div>;
}
