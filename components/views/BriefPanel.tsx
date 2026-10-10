// Follow up tab: "Send to a designer" (with the brief preview) and, in the Details tab, the internal price estimate.

import { assignDesignerAction, handoffStateAction, releaseHandoffAction } from '@/app/actions';
import { Badge, Collapsible, Panel, ReturnTo } from '@/components/ui';
import { buildDesignerBrief } from '@/lib/brief';
import { formatDateTime, formatInr, formatLakhCr, formatRange, titleCase } from '@/lib/format';
import { effectiveQualification } from '@/lib/metrics';
import type { BudgetFlag } from '@/lib/types';
import { DesignerSelect, Field, KV, More, Notice, blockingEscalations, type InspectorData } from './inspector-kit';

export function BriefPanel({ d }: { d: InspectorData }) {
  const { ctx, e, escs, pricing, designers } = d;
  const brief = buildDesignerBrief(e, pricing);
  const eff = effectiveQualification(e);
  const blockers = blockingEscalations(escs, e);
  const notQualified = eff !== 'qualified';
  const cannotRelease = notQualified || blockers.length > 0;
  const handedOff = e.handoff_status !== 'not_sent';

  const status =
    e.handoff_status === 'not_sent' ? 'Not sent yet'
      : e.handoff_status === 'sent' ? `Sent${e.designer_name ? ` to ${e.designer_name}` : ''}${e.handoff_sent_at ? ` on ${formatDateTime(e.handoff_sent_at)}` : ''}`
        : e.handoff_status === 'accepted' ? `${e.designer_name ?? 'The designer'} accepted${e.handoff_accepted_at ? ` on ${formatDateTime(e.handoff_accepted_at)}` : ''}`
          : `${e.designer_name ?? 'The designer'} declined`;

  return (
    <div className="space-y-3">
      <Panel
        title="Send to a designer"
        right={<Badge tone={handedOff ? (e.handoff_status === 'declined' ? 'crit' : 'info') : 'neutral'}>{status}</Badge>}
      >
        <form className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <input type="hidden" name="enquiry_id" value={e.id} />
          <ReturnTo value={ctx.returnTo} />
          <Field
            label="Designer"
            htmlFor="brief-designer"
            hint={designers.length === 0 ? 'No designers have been added yet.' : 'Leave it blank and we pick the designer with the lightest load.'}
          >
            <DesignerSelect id="brief-designer" name="designer_id" designers={designers} value={e.designer_id} blankLabel="Choose for me" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button type="submit" formAction={releaseHandoffAction} className={handedOff ? 'btn' : 'btn-solid'} disabled={cannotRelease}>
              {handedOff ? 'Send again' : 'Send to designer'}
            </button>
            <button type="submit" formAction={assignDesignerAction} className="btn-ghost" disabled={designers.length === 0} title="Pick a designer without sending the brief">
              Just assign
            </button>
          </div>
        </form>

        {cannotRelease && (
          <div className="mt-3">
            <Notice tone="warn">
              {notQualified
                ? `Not ready to send: this is marked "${eff === 'review' ? 'needs a look' : eff === 'unqualified' ? 'not a fit' : 'not a lead'}". Mark it a good fit first.`
                : `Not ready to send: ${blockers.length} thing${blockers.length === 1 ? '' : 's'} still need${blockers.length === 1 ? 's' : ''} attention (${blockers.map((b) => titleCase(b.trigger)).join(', ')}).`}
            </Notice>
          </div>
        )}

        {handedOff && (
          <More title="Designer's reply to the brief">
            <form action={handoffStateAction}>
              <input type="hidden" name="enquiry_id" value={e.id} />
              <ReturnTo value={ctx.returnTo} />
              <div className="flex flex-wrap gap-2">
                <button type="submit" name="action" value="accept" className="btn" disabled={e.handoff_status !== 'sent'}>Designer accepted</button>
                <button type="submit" name="action" value="decline" className="btn-danger" disabled={e.handoff_status !== 'sent'}>Designer declined</button>
                <button type="submit" name="action" value="reasked" className="btn-ghost" disabled={e.designer_reasked} title="Tracks how often a brief is too thin">
                  {e.designer_reasked ? 'Had to re-ask the basics (noted)' : 'Designer had to re-ask the basics'}
                </button>
              </div>
            </form>
          </More>
        )}
      </Panel>

      <Collapsible title="What the designer will receive" hint="the brief card">
        <pre className="scroll-thin max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-subtle p-4 font-mono text-[13px] leading-relaxed" tabIndex={0} aria-label="Designer brief card">
          {brief.text}
        </pre>
      </Collapsible>
    </div>
  );
}

const FLAG_TEXT: Record<BudgetFlag, { label: string; tone: 'ok' | 'warn' | 'crit' | 'neutral' }> = {
  not_stated: { label: 'Not mentioned', tone: 'neutral' },
  within_range: { label: 'Within range', tone: 'ok' },
  below_range: { label: 'Below range', tone: 'warn' },
  below_minimum: { label: 'Below our minimum', tone: 'crit' },
  above_range: { label: 'Above range', tone: 'ok' },
};

/** Internal price estimate: for the designer's own calibration. Never quoted to a client. */
export function PricingPanel({ d }: { d: InspectorData }) {
  const { e, pricing, escs } = d;
  const pricingEsc = escs.filter((x) => x.kind === 'pricing' && x.status !== 'resolved');
  return (
    <Collapsible title="Internal price estimate" hint="internal — never quote">
      <div className="mb-4"><Notice tone="crit"><strong>Internal only.</strong> These numbers are to help you judge the project. Never quote them to the client, on a call or in writing.</Notice></div>
      {!pricing ? (
        <p className="text-sm text-mute">No price check was logged for this enquiry (there was no size or scope to price).</p>
      ) : (
        <>
          <dl className="grid gap-x-8 sm:grid-cols-2">
            <KV k="Type of project">{titleCase(pricing.segment)}</KV>
            <KV k="Size">{pricing.area_sqft ? `${pricing.area_sqft.toLocaleString('en-IN')} sq ft` : '—'}</KV>
            <KV k="Rate card">{pricing.rate_low_per_sqft && pricing.rate_high_per_sqft ? `${formatInr(pricing.rate_low_per_sqft)} – ${formatInr(pricing.rate_high_per_sqft)} / sq ft` : '—'}</KV>
            <KV k="Rough range">{formatRange(pricing.indicative_low_inr, pricing.indicative_high_inr)}</KV>
            <KV k="Pipeline estimate">{formatLakhCr(pricing.pipeline_estimate_inr)}</KV>
            <KV k="Budget they mentioned">{pricing.budget_low_inr ? formatRange(pricing.budget_low_inr, pricing.budget_high_inr) : 'Not mentioned'}</KV>
            <KV k="Budget vs our range"><Badge tone={FLAG_TEXT[pricing.budget_flag].tone}>{FLAG_TEXT[pricing.budget_flag].label}</Badge></KV>
            <KV k="Risk of anchoring">{pricing.anchor_risk ? <Badge tone="warn">Yes: do not let their number anchor</Badge> : 'No'}</KV>
            <KV k="Needs a pricing check">{pricing.requires_review ? <Badge tone="warn">Yes</Badge> : 'No'}</KV>
            <KV k="Custom work">{pricing.custom_work_flags.length ? pricing.custom_work_flags.map(titleCase).join(', ') : 'None'}</KV>
            {pricing.formal_estimate_inr && <KV k="Formal estimate">{formatLakhCr(pricing.formal_estimate_inr)}</KV>}
            {e.estimated_value_inr && <KV k="Value used in the pipeline">{formatLakhCr(e.estimated_value_inr)}</KV>}
          </dl>
          {pricingEsc.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {pricingEsc.map((x) => <li key={x.id}><span className="font-medium text-warn">{titleCase(x.trigger)}:</span> {x.reason}</li>)}
            </ul>
          )}
          <div className="mt-4 rounded-xl bg-ok-soft p-4">
            <div className="label mb-1 text-ok">The only thing a client is ever told about price</div>
            <p className="text-[15px] italic">{pricing.client_facing_response}</p>
          </div>
        </>
      )}
    </Collapsible>
  );
}
