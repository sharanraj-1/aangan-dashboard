// Overview tab (key facts, the five-question fit check, designer notes) plus the fit / escalation / override
// pieces that live in the Details tab.

import type { ReactNode } from 'react';
import { acknowledgeEscalationAction, overrideQualificationAction, resolveEscalationAction } from '@/app/actions';
import { Badge, Collapsible, Empty, Panel, ReturnTo, channelLabel, severityTone } from '@/components/ui';
import { formatDateTime, titleCase } from '@/lib/format';
import { classifyOverride, type OverrideClass } from '@/lib/guardrails';
import { effectiveQualification } from '@/lib/metrics';
import type { Criteria, EnquiryRow, Verdict } from '@/lib/types';
import { KV, isOpenEsc, triggerTitle, type InspectorData } from './inspector-kit';

const CRITERIA: { key: keyof Criteria; label: string; hint: string }[] = [
  { key: 'real_project', label: 'Real project', hint: 'Wants design and execution, not just advice' },
  { key: 'service_area', label: 'Service area', hint: 'Pune city or PCMC' },
  { key: 'timeline', label: 'Timeline', hint: 'Site ready for execution within about 8 to 10 weeks' },
  { key: 'budget', label: 'Budget', hint: 'Judged only if the client mentions it. We never ask.' },
  { key: 'decision_maker', label: 'Decision-maker', hint: 'The caller decides, or is allowed to' },
];

const FLAG_LABEL: Record<string, string> = {
  founder_connection: 'Knows the founder', referral: 'Referral', large_project: 'Large project', asked_pricing: 'Asked about price',
  competitive: 'Comparing studios', frustrated: 'Frustrated', after_hours: 'Called after hours',
};

const OVERRIDE_TEXT: Record<OverrideClass, { label: string; tone: 'ok' | 'warn' | 'crit' | 'info' }> = {
  confirmed: { label: 'A person agreed with the AI', tone: 'ok' },
  false_positive: { label: 'The AI said good fit; a person said no', tone: 'crit' },
  false_negative: { label: 'The AI said no; a person said good fit', tone: 'crit' },
  gray_to_qualified: { label: 'The AI was unsure; a person said good fit', tone: 'info' },
  gray_to_unqualified: { label: 'The AI was unsure; a person said not a fit', tone: 'info' },
};

/** One criterion as a compact answer: symbol + word (never colour alone). */
function answer(key: keyof Criteria, v: Verdict | undefined, e: EnquiryRow): { symbol: string; word: string; tone: 'ok' | 'warn' | 'crit' | 'neutral' } {
  if (key === 'budget' && v !== 'fail' && e.budget_low_inr === null && e.budget_high_inr === null) return { symbol: '–', word: 'Not mentioned', tone: 'neutral' };
  if (v === 'pass') return { symbol: '✓', word: 'Yes', tone: 'ok' };
  if (v === 'fail') return { symbol: '✗', word: 'No', tone: 'crit' };
  if (v === 'unclear') return { symbol: '?', word: 'Not sure', tone: 'warn' };
  return { symbol: '–', word: 'Not checked', tone: 'neutral' };
}

const SYMBOL_BG = { ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', crit: 'bg-crit-soft text-crit', neutral: 'bg-subtle text-mute' };

function Fact({ k, children }: { k: string; children: ReactNode }) {
  return <KV k={k}>{children}</KV>;
}

export function OverviewPanel({ d }: { d: InspectorData }) {
  const { e, tr } = d;
  const notes = tr?.extraction?.criteria_notes ?? {};
  const dash = <span className="text-mute">Not given</span>;
  const wants = e.scope_summary ?? (e.scope_type ? titleCase(e.scope_type) : null);
  const flags = e.priority_flags.filter((f) => f !== 'after_hours');

  return (
    <div className="space-y-6">
      <Panel title="About this enquiry">
        <dl className="-mt-1">
          <Fact k="What they want">{wants ?? dash}</Fact>
          <Fact k="Where">{e.location ?? dash}</Fact>
          <Fact k="Size">{e.area_sqft ? `${e.area_sqft.toLocaleString('en-IN')} sq ft` : dash}</Fact>
          <Fact k="Timeline">{e.timeline_text ?? (e.weeks_to_completion ? `About ${e.weeks_to_completion} weeks` : dash)}</Fact>
          <Fact k="Referral">{e.referral_source ?? dash}</Fact>
          <Fact k="How they found us">{channelLabel(e.channel)}{e.after_hours ? ' (after hours)' : ''}</Fact>
          <Fact k="Contact">{e.client_phone || e.client_email ? [e.client_phone, e.client_email].filter(Boolean).join(' · ') : dash}</Fact>
          <Fact k="Designer">{e.designer_name ?? <span className="text-mute">Not assigned yet</span>}</Fact>
        </dl>
        {flags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {flags.map((f) => <Badge key={f} tone="accent">{FLAG_LABEL[f] ?? titleCase(f)}</Badge>)}
          </div>
        )}
      </Panel>

      <Panel title="Is it a good fit?">
        <ul>
          {CRITERIA.map(({ key, label }) => {
            const a = answer(key, e.criteria[key], e);
            const note = notes[key];
            return (
              <li key={key} className="flex items-start gap-3 border-b border-line py-3 first:pt-0 last:border-b-0 last:pb-0">
                <span aria-hidden className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${SYMBOL_BG[a.tone]}`}>{a.symbol}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-medium">{label}</span>
                    <span className={`text-sm font-medium ${a.tone === 'ok' ? 'text-ok' : a.tone === 'crit' ? 'text-crit' : a.tone === 'warn' ? 'text-warn' : 'text-mute'}`}>{a.word}</span>
                  </div>
                  <p className="text-sm text-mute">{note ?? (tr ? 'No note from the conversation.' : 'There is no conversation to quote.')}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="Notes for the designer">
        {e.open_questions.length === 0 && !e.override_note ? (
          <p className="text-sm text-mute">Nothing to flag yet.</p>
        ) : (
          <>
            {e.open_questions.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-[15px]">
                {e.open_questions.map((q, i) => <li key={i}>{q}</li>)}
              </ul>
            )}
            {e.override_note && <p className="mt-3 text-sm text-mute">Last note on the decision: <span className="text-text">{e.override_note}</span></p>}
          </>
        )}
      </Panel>
    </div>
  );
}

// ---- Details tab pieces ------------------------------------------------------------------------------

/** "Why the AI decided this" + what each question means. */
export function FitExplanations({ d }: { d: InspectorData }) {
  const { e } = d;
  const cls = classifyOverride(e);
  return (
    <Collapsible title="Why the AI decided this" hint={e.final_decided_by ? `decided by ${e.final_decided_by}` : undefined}>
      <div className="space-y-4">
        {cls && <Badge tone={OVERRIDE_TEXT[cls].tone}>{OVERRIDE_TEXT[cls].label}</Badge>}
        {e.qualification_reasons.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-[15px]">
            {e.qualification_reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        ) : (
          <p className="text-sm text-mute">The AI did not record a reason.</p>
        )}
        <div>
          <div className="label mb-1.5">What each question means</div>
          <ul className="space-y-1 text-sm text-mute">
            {CRITERIA.map((c) => <li key={c.key}><span className="font-medium text-text">{c.label}:</span> {c.hint}.</li>)}
          </ul>
        </div>
      </div>
    </Collapsible>
  );
}

/** Every escalation for this enquiry: open ones with the full set of actions, resolved ones as a short history. */
export function EscalationsDetail({ d }: { d: InspectorData }) {
  const { ctx, e, escs } = d;
  const open = escs.filter(isOpenEsc);
  const done = escs.filter((x) => !isOpenEsc(x));
  const aiCall = e.ai_qualification === 'qualified' || e.ai_qualification === 'unqualified';

  return (
    <Collapsible title="Things that needed attention" hint={open.length > 0 ? `${open.length} open` : done.length > 0 ? 'all resolved' : 'none'}>
      {open.length === 0 && done.length === 0 && <Empty>Nothing has ever needed attention on this enquiry.</Empty>}
      {open.length > 0 && (
        <ul className="space-y-4">
          {open.map((x) => (
            <li key={x.id} className="rounded-xl bg-subtle p-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={severityTone(x.severity)}>{titleCase(x.severity)}</Badge>
                <Badge tone={x.status === 'acknowledged' ? 'info' : 'warn'}>{x.status === 'acknowledged' ? 'Someone is on it' : 'Open'}</Badge>
                <span className="ml-auto text-[13px] text-mute">For {titleCase(x.assigned_to)} · {formatDateTime(x.created_at)}</span>
              </div>
              <p className="mt-2 font-medium">{triggerTitle(x.trigger)}</p>
              {x.reason && <p className="text-sm text-mute">{x.reason}</p>}
              {x.suggested_question && <p className="mt-1 text-sm text-info">Suggested question: {x.suggested_question}</p>}
              <form action={resolveEscalationAction} className="mt-3 space-y-2">
                <input type="hidden" name="escalation_id" value={x.id} />
                <ReturnTo value={ctx.returnTo} />
                <label htmlFor={`esc-note-${x.id}`} className="sr-only">Note (optional)</label>
                <input id={`esc-note-${x.id}`} name="note" maxLength={500} placeholder="Note (optional)" className="field" />
                <div className="flex flex-wrap gap-2">
                  <button type="submit" name="decision" value="qualify" className="btn">Good fit</button>
                  <button type="submit" name="decision" value="reject" className="btn">Not a fit</button>
                  {aiCall && <button type="submit" name="decision" value="approve_ai" className="btn" title="Accept the AI’s own call as the final decision">Agree with the AI</button>}
                  <button type="submit" name="decision" value="dismiss" className="btn-ghost" title="Close this without changing the decision">Dismiss</button>
                </div>
              </form>
              {x.status === 'open' && (
                <form action={acknowledgeEscalationAction} className="mt-1">
                  <input type="hidden" name="escalation_id" value={x.id} />
                  <ReturnTo value={ctx.returnTo} />
                  <button type="submit" className="btn-ghost -ml-3">I am on it</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <div className={open.length > 0 ? 'mt-5 border-t border-line pt-4' : ''}>
          <div className="label mb-2">Already handled</div>
          <ul className="space-y-2">
            {done.map((x) => (
              <li key={x.id} className="text-sm">
                <span className="font-medium">{triggerTitle(x.trigger)}</span>
                <span className="text-mute"> — {x.resolution ? titleCase(x.resolution) : 'resolved'} by {x.resolved_by ?? 'someone'}, {formatDateTime(x.resolved_at)}</span>
                {x.resolution_note && <div className="text-mute">{x.resolution_note}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Collapsible>
  );
}

/** "Was the AI right?": the override that also feeds the studio's accuracy numbers. */
export function OverrideCard({ d }: { d: InspectorData }) {
  const { ctx, e } = d;
  const eff = effectiveQualification(e);
  return (
    <Collapsible title="Was the AI right?" hint="Correct it if not">
      {eff === 'not_applicable' ? (
        <p className="text-sm text-mute">This is not a lead (spam, a vendor, a wrong number…), so there is nothing to correct.</p>
      ) : (
        <form action={overrideQualificationAction} className="space-y-3">
          <input type="hidden" name="enquiry_id" value={e.id} />
          <ReturnTo value={ctx.returnTo} />
          <p className="text-sm text-mute">
            Right now this is marked <span className="font-medium text-text">{eff === 'qualified' ? 'a good fit' : eff === 'unqualified' ? 'not a fit' : 'needs a look'}</span>.
            Your correction helps the studio see how often the AI gets it wrong. Flagging a bad lead closes it; rescuing a lead reopens it.
          </p>
          <label htmlFor="ovr-note" className="sr-only">Note (optional)</label>
          <input id="ovr-note" name="note" maxLength={500} placeholder="Why? (optional)" className="field" />
          <div className="flex flex-wrap gap-2">
            {(eff === 'qualified' || eff === 'review') && (
              <button type="submit" name="to" value="unqualified" className="btn-danger">{eff === 'qualified' ? 'Flag as bad lead' : 'Not a fit'}</button>
            )}
            {(eff === 'unqualified' || eff === 'review') && (
              <button type="submit" name="to" value="qualified" className="btn">{eff === 'unqualified' ? 'Rescue as good lead' : 'Good fit'}</button>
            )}
          </div>
        </form>
      )}
    </Collapsible>
  );
}
