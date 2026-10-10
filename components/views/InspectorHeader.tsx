// Top of the enquiry detail: the identity header and the single "What to do next" card.

import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  markRespondedAction, overrideQualificationAction, releaseHandoffAction, resolveEscalationAction, acknowledgeEscalationAction,
} from '@/app/actions';
import { Badge, ReturnTo, channelLabel } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { effectiveQualification } from '@/lib/metrics';
import type { EscalationRow } from '@/lib/types';
import {
  DesignerSelect, GATE_TRIGGERS, Field, More, blockingEscalations, enquiryStatus, isActiveLead, isOpenEsc, tabHref, triggerTitle,
  type InspectorData,
} from './inspector-kit';

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function InspectorBar({ d }: { d: InspectorData }) {
  const { e, escs } = d;
  const st = enquiryStatus(e, escs.filter(isOpenEsc).length);
  const sub = [e.location, channelLabel(e.channel), `received ${formatDateTime(e.received_at)}`].filter(Boolean).join(' · ');
  return (
    <header>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h2 className="min-w-0 font-display text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{e.client_name ?? 'Unnamed enquirer'}</h2>
        <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
          <Badge tone={st.tone}>{st.label}</Badge>
          {e.is_synthetic && <Badge tone="info" title="Simulated row, not a real enquiry">Practice data</Badge>}
        </div>
      </div>
      <p className="mt-1 text-sm text-mute">{sub}</p>
      {e.summary && <p className="mt-2 line-clamp-2 text-[15px]">{e.summary}</p>}
    </header>
  );
}

// ---- what to do next ---------------------------------------------------------------------------------

export type NextStep =
  | { kind: 'clarify'; esc: EscalationRow; question: string | null; others: number }
  | { kind: 'escalation'; esc: EscalationRow; others: number }
  | { kind: 'decide'; question: string | null }
  | { kind: 'release' }
  | { kind: 'book' }
  | { kind: 'email' }
  | { kind: 'reply' }
  | { kind: 'none'; text: string };

/** Picks the one thing the designer should do next from the enquiry's state. Pure: easy to reason about and test. */
export function nextStep(d: InspectorData): NextStep {
  const { ctx, e, tr, escs } = d;
  const open = escs.filter(isOpenEsc);
  const eff = effectiveQualification(e);
  const suggested = open.find((x) => x.suggested_question)?.suggested_question ?? escs.find((x) => x.suggested_question)?.suggested_question ?? tr?.extraction?.clarifying_question ?? null;

  const clarify = open.find((x) => GATE_TRIGGERS.includes(x.trigger) || x.kind === 'transcription');
  if (clarify) return { kind: 'clarify', esc: clarify, question: clarify.suggested_question ?? suggested, others: open.length - 1 };

  const other = [...open].sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9))[0];
  if (other) return { kind: 'escalation', esc: other, others: open.length - 1 };

  if (e.ai_qualification === 'review' && !e.final_qualification) return { kind: 'decide', question: suggested };

  const closed = ['won', 'lost', 'closed'].includes(e.status);
  if (!closed && eff === 'qualified' && e.handoff_status === 'not_sent') return { kind: 'release' };

  const consults = ctx.ds.consultations.filter((c) => c.enquiry_id === e.id && c.status !== 'cancelled');
  const emailed = ctx.ds.outboundEmails.some((m) => m.enquiry_id === e.id && m.status !== 'failed');
  if (!closed && eff === 'qualified' && e.handoff_status !== 'not_sent' && consults.length === 0) return { kind: 'book' };
  if (!closed && consults.length > 0 && !emailed) return { kind: 'email' };
  if (isActiveLead(e) && !e.first_response_at) return { kind: 'reply' };

  const label = enquiryStatus(e, 0).label.toLowerCase();
  return { kind: 'none', text: `Nothing to do — ${label}.` };
}

function Quote({ children }: { children: string }) {
  return <blockquote className="rounded-xl border-l-4 border-accent/40 bg-subtle px-4 py-3 text-[15px] italic">{children}</blockquote>;
}

function NoteField({ id }: { id: string }) {
  return (
    <More title="Add a note">
      <label htmlFor={id} className="sr-only">Note (optional)</label>
      <input id={id} name="note" maxLength={500} placeholder="Why? (optional)" className="field" />
    </More>
  );
}

function MoreCount({ n }: { n: number }) {
  return n > 0 ? <p className="mt-3 text-[13px] text-mute">{n} more thing{n === 1 ? '' : 's'} need attention — see Details.</p> : null;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label="What to do next" className="panel-hot p-5">
      <div className="label mb-1">What to do next</div>
      <h3 className="font-display text-xl font-semibold tracking-tight">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function NextActionCard({ d }: { d: InspectorData }) {
  const { ctx, e, escs, designers } = d;
  const step = nextStep(d);
  const aiCall = e.ai_qualification === 'qualified' || e.ai_qualification === 'unqualified';

  if (step.kind === 'clarify') {
    const x = step.esc;
    return (
      <Card title="Is this a good fit?">
        <p className="text-[15px] text-mute">{x.reason || triggerTitle(x.trigger)}</p>
        {step.question && (
          <div>
            <div className="label mb-1.5">A good question to ask</div>
            <Quote>{step.question}</Quote>
          </div>
        )}
        <form action={resolveEscalationAction}>
          <input type="hidden" name="escalation_id" value={x.id} />
          <ReturnTo value={ctx.returnTo} />
          <div className="flex flex-wrap gap-2">
            <button type="submit" name="decision" value="qualify" className="btn-solid">This is a good fit</button>
            <button type="submit" name="decision" value="reject" className="btn">Not a fit</button>
          </div>
          <NoteField id="next-note" />
        </form>
        <MoreCount n={step.others} />
      </Card>
    );
  }

  if (step.kind === 'escalation') {
    const x = step.esc;
    const isQual = x.kind === 'lead_qualification';
    const slaBreach = x.trigger === 'response_sla_breach' && !e.first_response_at;
    return (
      <Card title={triggerTitle(x.trigger)}>
        {x.reason && <p className="text-[15px] text-mute">{x.reason}</p>}
        {x.suggested_question && <Quote>{x.suggested_question}</Quote>}
        {slaBreach && (
          <form action={markRespondedAction}>
            <input type="hidden" name="enquiry_id" value={e.id} />
            <ReturnTo value={ctx.returnTo} />
            <button type="submit" className="btn-solid">Mark as replied</button>
          </form>
        )}
        <form action={resolveEscalationAction}>
          <input type="hidden" name="escalation_id" value={x.id} />
          <ReturnTo value={ctx.returnTo} />
          <div className="flex flex-wrap gap-2">
            {isQual && aiCall && (
              <button type="submit" name="decision" value="approve_ai" className="btn-solid">
                Agree with the AI ({e.ai_qualification === 'qualified' ? 'good fit' : 'not a fit'})
              </button>
            )}
            {isQual && e.ai_qualification !== 'qualified' && (
              <button type="submit" name="decision" value="qualify" className={aiCall ? 'btn' : 'btn-solid'}>This is a good fit</button>
            )}
            {isQual && e.ai_qualification !== 'unqualified' && (
              <button type="submit" name="decision" value="reject" className="btn">Not a fit</button>
            )}
            {!isQual && (
              <button type="submit" name="decision" value="dismiss" className={slaBreach ? 'btn' : 'btn-solid'}>
                {slaBreach ? 'Dismiss this alert' : 'I have dealt with this'}
              </button>
            )}
            {!isQual && x.kind === 'pricing' && <button type="submit" name="decision" value="reject" className="btn-danger">Not a fit</button>}
          </div>
          <NoteField id="next-note" />
        </form>
        {x.status === 'open' && (
          <form action={acknowledgeEscalationAction}>
            <input type="hidden" name="escalation_id" value={x.id} />
            <ReturnTo value={ctx.returnTo} />
            <button type="submit" className="btn-ghost -ml-3">I am on it</button>
          </form>
        )}
        <MoreCount n={step.others} />
      </Card>
    );
  }

  if (step.kind === 'decide') {
    return (
      <Card title="Is this a good fit?">
        <p className="text-[15px] text-mute">The AI was not sure either way, so it is your call.</p>
        {step.question && (
          <div>
            <div className="label mb-1.5">A good question to ask</div>
            <Quote>{step.question}</Quote>
          </div>
        )}
        <form action={overrideQualificationAction}>
          <input type="hidden" name="enquiry_id" value={e.id} />
          <ReturnTo value={ctx.returnTo} />
          <div className="flex flex-wrap gap-2">
            <button type="submit" name="to" value="qualified" className="btn-solid">This is a good fit</button>
            <button type="submit" name="to" value="unqualified" className="btn">Not a fit</button>
          </div>
          <NoteField id="next-note" />
        </form>
      </Card>
    );
  }

  if (step.kind === 'release') {
    const blockers = blockingEscalations(escs, e);
    return (
      <Card title="Send to a designer">
        <p className="text-[15px] text-mute">This looks like a good fit. Pick a designer to send the brief to, or leave it blank and we will choose.</p>
        <form action={releaseHandoffAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <input type="hidden" name="enquiry_id" value={e.id} />
          <ReturnTo value={ctx.returnTo} />
          <Field label="Designer" htmlFor="next-designer" className="sm:w-64">
            <DesignerSelect id="next-designer" name="designer_id" designers={designers} value={e.designer_id} blankLabel="Choose for me" />
          </Field>
          <button type="submit" className="btn-solid" disabled={blockers.length > 0}>Send to designer</button>
        </form>
      </Card>
    );
  }

  if (step.kind === 'book') {
    return (
      <Card title="Book a consultation">
        <p className="text-[15px] text-mute">{e.designer_name ? `${e.designer_name} has the brief.` : 'The brief has gone to a designer.'} Next, find a time to meet the client.</p>
        <Link href={tabHref(ctx.sp, 'followup', 'consult')} className="btn-solid">Book a consultation</Link>
      </Card>
    );
  }

  if (step.kind === 'email') {
    return (
      <Card title="Email the client">
        <p className="text-[15px] text-mute">A consultation is booked. Let the client know with a short confirmation email.</p>
        <Link href={tabHref(ctx.sp, 'followup', 'email', { email: 'confirmation' })} className="btn-solid">Email the client</Link>
      </Card>
    );
  }

  if (step.kind === 'reply') {
    return (
      <Card title="Reply to the client">
        <p className="text-[15px] text-mute">No first reply is recorded yet. Once you have been in touch, mark it so the response time is right.</p>
        <form action={markRespondedAction}>
          <input type="hidden" name="enquiry_id" value={e.id} />
          <ReturnTo value={ctx.returnTo} />
          <button type="submit" className="btn-solid">Mark as replied</button>
        </form>
      </Card>
    );
  }

  return (
    <section aria-label="What to do next" className="panel p-5">
      <div className="label mb-1">What to do next</div>
      <p className="text-[15px] text-mute">{step.text}</p>
    </section>
  );
}
