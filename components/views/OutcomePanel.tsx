// Follow up tab: the first reply, and the outcome (won / lost).

import { markRespondedAction, setOutcomeAction } from '@/app/actions';
import { Badge, Collapsible, Panel, ReturnTo } from '@/components/ui';
import { formatDateTime, formatDuration, formatLakhCr } from '@/lib/format';
import { Field, More, type InspectorData } from './inspector-kit';

/** One compact card: has the client had a first reply? */
export function RepliedCard({ d }: { d: InspectorData }) {
  const { ctx, e } = d;
  const answered = e.first_response_at ? (new Date(e.first_response_at).getTime() - new Date(e.received_at).getTime()) / 60_000 : null;
  return (
    <Panel title="First reply" right={e.first_response_at ? <Badge tone="ok">Replied</Badge> : <Badge tone="warn">Not recorded</Badge>}>
      {e.first_response_at ? (
        <p className="text-[15px]">
          Replied {formatDateTime(e.first_response_at)}
          {answered !== null && <span className="text-mute"> · {formatDuration(Math.max(0, answered))} after the enquiry arrived</span>}
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-mute">
            {e.channel === 'web_form' ? 'Replies to web-form enquiries were never logged. ' : ''}
            If you have been in touch another way, record it here. A real email sent from this page records it automatically.
          </p>
          <form action={markRespondedAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="enquiry_id" value={e.id} />
            <ReturnTo value={ctx.returnTo} />
            <button type="submit" className="btn-solid">Mark as replied</button>
          </form>
          <More title="It was at a different time">
            <form action={markRespondedAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <input type="hidden" name="enquiry_id" value={e.id} />
              <ReturnTo value={ctx.returnTo} />
              <Field label="Replied at (IST)" htmlFor="resp-at" className="sm:w-64">
                <input id="resp-at" type="datetime-local" name="at" className="field" />
              </Field>
              <button type="submit" className="btn">Record this time</button>
            </form>
          </More>
        </>
      )}
    </Panel>
  );
}

export function OutcomePanel({ d }: { d: InspectorData }) {
  const { ctx, e } = d;
  const closed = e.status === 'won' || e.status === 'lost';
  const handedOff = e.handoff_status !== 'not_sent';

  const forms = (
    <div className="grid gap-4 sm:grid-cols-2">
      <form action={setOutcomeAction} className="space-y-3 rounded-xl bg-subtle p-4">
        <input type="hidden" name="enquiry_id" value={e.id} />
        <input type="hidden" name="outcome" value="won" />
        <ReturnTo value={ctx.returnTo} />
        <Field label="Project value (₹ lakh)" htmlFor="won-val" hint="For example 18.5 means ₹18.5 lakh.">
          <input id="won-val" name="value_lakh" type="number" min="0.1" step="0.1" required inputMode="decimal" placeholder="18.5" className="field" />
        </Field>
        <button type="submit" className="btn-solid">Mark won</button>
      </form>
      <form action={setOutcomeAction} className="space-y-3 rounded-xl bg-subtle p-4">
        <input type="hidden" name="enquiry_id" value={e.id} />
        <input type="hidden" name="outcome" value="lost" />
        <ReturnTo value={ctx.returnTo} />
        <Field label="Why was it lost?" htmlFor="lost-reason" hint="For example chose another studio, budget, or went quiet.">
          <input id="lost-reason" name="reason" maxLength={300} className="field" />
        </Field>
        <button type="submit" className="btn-danger">Mark lost</button>
      </form>
    </div>
  );

  if (closed) {
    return (
      <Panel title="Outcome" right={<Badge tone={e.status === 'won' ? 'ok' : 'crit'}>{e.status === 'won' ? 'Won' : 'Lost'}</Badge>}>
        <p className="text-[15px]">
          {e.status === 'won'
            ? <>Won, with a project value of <strong>{formatLakhCr(e.final_value_inr)}</strong>.</>
            : <>Lost{e.closed_reason ? `: ${e.closed_reason}` : ' (no reason recorded)'}.</>}
        </p>
        <More title="Change the outcome">{forms}</More>
      </Panel>
    );
  }

  // Only once the brief has gone to a designer is an outcome something you would record every day.
  if (handedOff) return <Panel title="Outcome">{forms}</Panel>;
  return (
    <Collapsible title="Outcome" hint="won or lost, when it is decided">
      {forms}
    </Collapsible>
  );
}
