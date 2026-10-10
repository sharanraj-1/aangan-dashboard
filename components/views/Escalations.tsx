// Needs attention — designer-only. Shows what is waiting for a person and lets them clear it quickly.
// Open items are global (a held lead stays held whatever month it arrived); "Already handled" is scoped to the selected
// month, using the same rule as lib/metrics.ts (the month the ENQUIRY was received).

import Link from 'next/link';
import type { ReactNode } from 'react';
import { acknowledgeEscalationAction, resolveEscalationAction } from '@/app/actions';
import { GUARDRAILS } from '@/lib/config';
import { classifyOverride, type OverrideClass } from '@/lib/guardrails';
import { formatDateTime, pct } from '@/lib/format';
import { monthKey } from '@/lib/metrics';
import { href } from '@/lib/url';
import type { EnquiryRow, EscalationRow, EscalationTrigger, Severity } from '@/lib/types';
import { Badge, channelLabel, Collapsible, PageHeader, ReturnTo, type Tone } from '../ui';
import type { ViewCtx } from '../types';

// ---------------------------------------------------------------------------------------------- vocab

const OVERDUE_MINUTES = 24 * 60;
const SHOW_FIRST = 6;
const HANDLED_CAP = 10;

const TITLE: Record<EscalationTrigger, string> = {
  needs_clarification: 'Ask one question before passing this on',
  low_confidence: 'The call was hard to understand — please check it',
  ambiguous_scope: 'The call was hard to understand — please check it',
  ambiguous_location: 'The call was hard to understand — please check it',
  ai_failure: 'The AI couldn’t read this — please look',
  high_value_fringe: 'A valuable lead outside our usual area — your call',
  audit_sample: 'Quick check: was this decline right?',
  budget_below_minimum: 'The budget they mentioned looks far below this scope',
  custom_work: 'Unusual work — needs a senior look',
  agent_policy_breach: 'The studio side mentioned a price',
  existing_client_complaint: 'An existing client is unhappy',
  response_sla_breach: 'This person waited too long for a reply',
  missed_call: 'Missed call — call them back',
};

type Group = 'questions' | 'recovery' | 'pricing' | 'spot';
const GROUPS: { key: Group; label: string }[] = [
  { key: 'questions', label: 'Questions to ask' },
  { key: 'recovery', label: 'Unhappy or overdue' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'spot', label: 'Spot checks' },
];

function groupOf(x: EscalationRow): Group {
  if (x.kind === 'service_recovery') return 'recovery';
  if (x.kind === 'pricing') return 'pricing';
  if (x.trigger === 'audit_sample' || x.trigger === 'high_value_fringe') return 'spot';
  return 'questions';
}
const isGroup = (v: string | undefined): v is Group => GROUPS.some((g) => g.key === v);

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const HOW_RESOLVED: Record<string, string> = {
  qualified: 'Marked a good fit',
  unqualified: 'Marked not a fit',
  approved_ai: 'Agreed with the AI',
  dismissed: 'Marked as handled',
};

const RESULT: Record<OverrideClass, { tone: Tone; label: string }> = {
  confirmed: { tone: 'ok', label: 'Confirmed' },
  false_positive: { tone: 'warn', label: 'Turned out not a fit' },
  false_negative: { tone: 'info', label: 'A good lead rescued' },
  gray_to_qualified: { tone: 'info', label: 'A good lead rescued' },
  gray_to_unqualified: { tone: 'neutral', label: 'Declined after a look' },
};

const minutesSince = (iso: string, now: Date) => (now.getTime() - new Date(iso).getTime()) / 60_000;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "waiting 3 days", "waiting 5 hours" — never decimals. */
function waitingText(minutes: number): string {
  if (minutes < 60) return 'waiting less than an hour';
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `waiting ${plural(hours, 'hour')}`;
  return `waiting ${plural(Math.round(hours / 24), 'day')}`;
}

// ---------------------------------------------------------------------------------------------- view

export function Escalations({ ctx }: { ctx: ViewCtx }) {
  const { ds, m, sp, now, month } = ctx;
  const byId = new Map(ds.enquiries.filter((e) => ctx.includeSynthetic || !e.is_synthetic).map((e) => [e.id, e]));
  const visible = ds.escalations.filter((x) => byId.has(x.enquiry_id));

  const group = isGroup(sp.kind) ? sp.kind : null;
  const showAll = sp.all === '1';

  const openAll = visible.filter((x) => x.status !== 'resolved');
  const resolvedAll = visible
    .filter((x) => x.status === 'resolved' && x.resolved_at && monthKey(byId.get(x.enquiry_id)!.received_at) === month)
    .sort((a, b) => new Date(b.resolved_at!).getTime() - new Date(a.resolved_at!).getTime());

  const openRows = openAll
    .filter((x) => !group || groupOf(x) === group)
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const shown = showAll ? openRows : openRows.slice(0, SHOW_FIRST);
  const countOf = (g: Group) => openAll.filter((x) => groupOf(x) === g).length;

  const link = (patch: Record<string, string | null>) => href(sp, { all: null, ...patch });

  return (
    <div>
      <PageHeader
        title="Needs attention"
        subtitle={openAll.length === 0 ? 'Everything has been looked at.' : `${plural(openAll.length, 'thing is', 'things are')} waiting for a person.`}
      />

      {openAll.length === 0 ? (
        <div className="panel px-6 py-12 text-center">
          <p className="font-display text-2xl font-semibold">Nothing is waiting — nice.</p>
          <p className="mx-auto mt-2 max-w-md text-[15px] text-mute">
            If a call is hard to understand, a lead needs one more question, or someone is waiting too long, it will show up here.
          </p>
        </div>
      ) : (
        <>
          <nav aria-label="Filter by type" className="mb-5 flex flex-wrap gap-2">
            <Pill to={link({ kind: null })} active={!group}>All <Count n={openAll.length} /></Pill>
            {GROUPS.map((g) => (
              <Pill key={g.key} to={link({ kind: g.key })} active={group === g.key}>{g.label} <Count n={countOf(g.key)} /></Pill>
            ))}
          </nav>

          {openRows.length === 0 ? (
            <div className="panel px-6 py-10 text-center text-[15px] text-mute">
              Nothing of this type is waiting.{' '}
              <Link className="font-medium text-accent underline underline-offset-2" href={link({ kind: null })}>Show everything</Link>
            </div>
          ) : (
            <>
              <ul className="space-y-4">
                {shown.map((x) => (
                  <li key={x.id}>
                    <AttentionCard esc={x} enquiry={byId.get(x.enquiry_id)!} ctx={ctx} />
                  </li>
                ))}
              </ul>
              {openRows.length > SHOW_FIRST && (
                <div className="mt-4 text-center">
                  {showAll ? (
                    <Link href={link({})} className="btn-ghost">Show fewer</Link>
                  ) : (
                    <Link href={link({ all: '1' })} className="btn">Show all {openRows.length}</Link>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      <div className="mt-10 space-y-3">
        <Collapsible title="Already handled" hint={resolvedAll.length > 0 ? `${resolvedAll.length} this month` : undefined}>
          <HandledList rows={resolvedAll.slice(0, HANDLED_CAP)} total={resolvedAll.length} byId={byId} ctx={ctx} />
        </Collapsible>
        <Collapsible title="How this works">
          <HowItWorks ctx={ctx} />
        </Collapsible>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- pieces

function Pill({ to, active, children }: { to: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={to}
      aria-current={active ? 'true' : undefined}
      className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
        active ? 'border-accent bg-accent text-white' : 'border-line-strong bg-surface text-text hover:bg-subtle'
      }`}
    >
      {children}
    </Link>
  );
}

const Count = ({ n }: { n: number }) => <span className="tabular-nums opacity-70">{n}</span>;

function AttentionCard({ esc, enquiry, ctx }: { esc: EscalationRow; enquiry: EnquiryRow; ctx: ViewCtx }) {
  const age = minutesSince(esc.created_at, ctx.now);
  const overdue = age > OVERDUE_MINUTES;
  const enquiryHref = href(ctx.sp, { view: 'queue', enquiry: enquiry.id });
  const name = enquiry.client_name ?? 'Unnamed enquirer';

  return (
    <article className="panel p-5" aria-label={`${TITLE[esc.trigger]} — ${name}`}>
      <h2 className="font-display text-xl font-semibold leading-snug tracking-tight">{TITLE[esc.trigger]}</h2>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[15px] text-mute">
        <span className="font-medium text-text">{name}</span>
        {enquiry.location && <><span aria-hidden>·</span><span>{enquiry.location}</span></>}
        <span aria-hidden>·</span><span>{channelLabel(enquiry.channel)}</span>
        <span aria-hidden>·</span><span>{waitingText(age)}</span>
        {overdue && <Badge tone="warn">Overdue</Badge>}
        {esc.status === 'acknowledged' && <Badge tone="info">Someone is on it</Badge>}
        <Link href={enquiryHref} className="ml-auto font-medium text-accent underline underline-offset-2">Open enquiry</Link>
      </div>

      <p className="mt-3 text-[15px] leading-relaxed">{esc.reason}</p>

      {esc.suggested_question && (
        <blockquote className="mt-3 rounded-xl border-l-4 border-accent bg-accent-soft px-4 py-3 text-[15px] leading-snug">
          <span className="block text-sm font-medium text-mute">A question you could ask</span>
          <span className="select-all">{esc.suggested_question}</span>
        </blockquote>
      )}

      <div className="mt-4 border-t border-line pt-4">
        <ResolveForm esc={esc} enquiry={enquiry} returnTo={ctx.returnTo} enquiryHref={enquiryHref} />
        {esc.status === 'open' && (
          <form action={acknowledgeEscalationAction} className="mt-2">
            <ReturnTo value={ctx.returnTo} />
            <input type="hidden" name="escalation_id" value={esc.id} />
            <button type="submit" className="btn-ghost">I’m on it</button>
          </form>
        )}
      </div>
    </article>
  );
}

type Decision = 'qualify' | 'reject' | 'approve_ai' | 'dismiss';
interface Choice { decision: Decision; label: string }

/** One primary choice plus at most two secondary ones, picked from what makes sense for this kind of item. */
function choicesFor(esc: EscalationRow, enquiry: EnquiryRow): { primary: Choice; secondary: Choice[] } | null {
  const ai = enquiry.ai_qualification;
  const aiDecided = ai === 'qualified' || ai === 'unqualified';
  const goodFit: Choice = { decision: 'qualify', label: 'This is a good fit' };
  const notFit: Choice = { decision: 'reject', label: 'Not a fit' };
  const handled: Choice = { decision: 'dismiss', label: 'Done — handled' };
  const looksRight: Choice = { decision: 'approve_ai', label: 'Looks right' };
  const wrong: Choice = { decision: 'qualify', label: 'Wrong — it’s a good lead' };

  if (esc.kind === 'service_recovery') return { primary: handled, secondary: [] };
  switch (esc.trigger) {
    case 'audit_sample':
      // No dismiss here: keeping the answer binary keeps the false-negative measurement clean.
      return aiDecided
        ? { primary: { decision: 'approve_ai', label: 'Decline was right' }, secondary: [wrong] }
        : { primary: wrong, secondary: [] };
    case 'high_value_fringe':
      return { primary: goodFit, secondary: [notFit] };
    case 'needs_clarification':
      return { primary: goodFit, secondary: [notFit, handled] };
    case 'low_confidence':
    case 'ambiguous_scope':
    case 'ambiguous_location':
    case 'ai_failure':
      if (ai === 'qualified') return { primary: looksRight, secondary: [notFit] };
      if (ai === 'unqualified') return { primary: looksRight, secondary: [wrong] };
      return { primary: goodFit, secondary: [notFit, handled] };
    case 'agent_policy_breach':
      return { primary: handled, secondary: [] };
    default: {
      // Pricing items: usually just "handled"; offer a fit call only while nobody has made one.
      const open = enquiry.final_qualification === null && ai !== 'not_applicable';
      return { primary: handled, secondary: open ? [goodFit, notFit] : [] };
    }
  }
}

function ResolveForm({ esc, enquiry, returnTo, enquiryHref }: { esc: EscalationRow; enquiry: EnquiryRow; returnTo: string; enquiryHref: string }) {
  const choices = choicesFor(esc, enquiry);
  if (!choices) return <Link href={enquiryHref} className="btn">Open enquiry</Link>;
  const noteId = `note-${esc.id}`;
  return (
    <form action={resolveEscalationAction}>
      <ReturnTo value={returnTo} />
      <input type="hidden" name="escalation_id" value={esc.id} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" name="decision" value={choices.primary.decision} className="btn-solid">{choices.primary.label}</button>
        {choices.secondary.map((c) => (
          <button key={c.label} type="submit" name="decision" value={c.decision} className="btn">{c.label}</button>
        ))}
      </div>
      <details className="mt-3">
        <summary className="inline-block cursor-pointer text-sm font-medium text-mute hover:text-text">Add a note</summary>
        <label htmlFor={noteId} className="sr-only">Note</label>
        <input
          id={noteId}
          name="note"
          type="text"
          maxLength={500}
          className="field mt-2"
          placeholder={esc.kind === 'service_recovery' ? 'How was it handled? e.g. called back, apologised' : 'Why this call? (optional)'}
        />
      </details>
    </form>
  );
}

function HandledList({ rows, total, byId, ctx }: { rows: EscalationRow[]; total: number; byId: Map<string, EnquiryRow>; ctx: ViewCtx }) {
  if (rows.length === 0) {
    return <p className="text-[15px] text-mute">Nothing has been handled yet this month. Items you clear will be listed here.</p>;
  }
  return (
    <>
      <ul className="divide-y divide-line">
        {rows.map((x) => {
          const enq = byId.get(x.enquiry_id)!;
          const cls = classifyOverride(enq);
          const result = cls ? RESULT[cls] : null;
          return (
            <li key={x.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[15px] font-medium">{TITLE[x.trigger]}</p>
                {result && <Badge tone={result.tone}>{result.label}</Badge>}
              </div>
              <p className="mt-0.5 text-sm text-mute">
                <Link className="underline underline-offset-2 hover:text-text" href={href(ctx.sp, { view: 'queue', enquiry: enq.id })}>
                  {enq.client_name ?? 'Unnamed enquirer'}
                </Link>
                {' · '}{x.resolution ? HOW_RESOLVED[x.resolution] ?? 'Handled' : 'Handled'}
                {x.resolved_by ? ` by ${x.resolved_by}` : ''}
                {' · '}{formatDateTime(x.resolved_at)}
              </p>
              {x.resolution_note && <p className="mt-1 text-sm text-mute">“{x.resolution_note}”</p>}
            </li>
          );
        })}
      </ul>
      {total > rows.length && <p className="mt-3 text-sm text-mute">Showing the latest {rows.length} of {total}.</p>}
    </>
  );
}

function HowItWorks({ ctx }: { ctx: ViewCtx }) {
  const q = ctx.m.qualification;
  const G = GUARDRAILS;
  const oneIn = G.auditSampleRate > 0 ? Math.max(1, Math.round(1 / G.auditSampleRate)) : null;
  return (
    <div className="space-y-5 text-[15px] leading-relaxed">
      <ul className="list-disc space-y-2 pl-5">
        <li>A call goes on hold when the AI is less than <strong>{pct(G.confidenceMin)}</strong> sure it understood it, so nobody works from a shaky summary.</li>
        <li>Leads that aren’t clearly good or clearly bad get a person’s look, or one simple question, instead of being turned away silently.</li>
        <li>{oneIn ? <>About <strong>1 in {oneIn}</strong> declines is double-checked by a person</> : <>Declines are not currently double-checked</>}, so we can tell whether good leads are slipping through.</li>
        <li>Prices are never quoted to clients. If a number slips out or a budget looks far off, it shows up here.</li>
        <li>Anyone who has waited more than <strong>{G.slaBreachHours} hours</strong> for a reply is flagged so they get a call back.</li>
      </ul>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-subtle p-4">
          <div className="num text-3xl">{q.fpRate === null ? '—' : pct(q.fpRate)}</div>
          <p className="mt-1.5 text-sm text-mute">
            {q.fpRate === null
              ? 'Not enough yet: no leads the AI called a good fit have been checked this month.'
              : `Of the leads the AI called a good fit, ${q.falsePositives} of ${q.counts.qualified} turned out not to be. Lower is better.`}
          </p>
        </div>
        <div className="rounded-xl bg-subtle p-4">
          <div className="num text-3xl">{q.fnRate === null ? '—' : pct(q.fnRate)}</div>
          <p className="mt-1.5 text-sm text-mute">
            {q.fnRate === null
              ? 'Not enough yet: no declines have been double-checked this month.'
              : `Of the declines a person double-checked, ${q.falseNegatives} of ${q.fnAudited} were actually good leads. Small samples can swing a lot.`}
          </p>
        </div>
      </div>
    </div>
  );
}
