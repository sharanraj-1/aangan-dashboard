// Follow up tab: email the client. Template pills, a clean preview, one Send button, and history.

import Link from 'next/link';
import { sendClientEmailAction } from '@/app/actions';
import { Badge, Collapsible, Panel, ReturnTo, type Tone } from '@/components/ui';
import { formatDateTime, titleCase } from '@/lib/format';
import { effectiveQualification } from '@/lib/metrics';
import { getStore } from '@/lib/store';
import type { EmailTemplate } from '@/lib/types';
import { href } from '@/lib/url';
import { prepareClientEmail } from '@/lib/workflow';
import { DesignerSelect, Field, More, Notice, istInput, parseIstInput, type InspectorData } from './inspector-kit';

const TEMPLATES: { key: EmailTemplate; label: string; hint: string }[] = [
  { key: 'confirmation', label: 'Confirmation', hint: 'Names the designer and the callback or booked consultation' },
  { key: 'clarification', label: 'Ask a question', hint: 'Asks the one question that settles whether it is a fit' },
  { key: 'decline', label: 'Polite no', hint: 'A kind note saying it is not the right fit' },
];
const STATUS: Record<string, { label: string; tone: Tone }> = {
  sent: { label: 'Sent', tone: 'ok' }, dry_run: { label: 'Test only', tone: 'warn' }, failed: { label: 'Failed', tone: 'crit' },
};

export async function ClientEmailPanel({ d }: { d: InspectorData }) {
  const { ctx, e, escs, designers } = d;
  const eff = effectiveQualification(e);
  const defaultTemplate: EmailTemplate = eff === 'unqualified' ? 'decline' : eff === 'review' ? 'clarification' : 'confirmation';
  const template = (TEMPLATES.find((t) => t.key === ctx.sp.email)?.key ?? defaultTemplate) as EmailTemplate;

  const designerId = ctx.sp.ed && designers.some((x) => x.id === ctx.sp.ed) ? ctx.sp.ed : null;
  const callbackAt = parseIstInput(ctx.sp.cb);
  const suggestedQuestion = escs.find((x) => x.suggested_question)?.suggested_question ?? '';
  const question = ctx.sp.eq ?? suggestedQuestion;
  const note = ctx.sp.en ?? '';

  const prep = await prepareClientEmail(getStore(), e.id, template, { designerId, callbackAt, question: template === 'clarification' ? question : null, note: note || null });
  const live = process.env.CLIENT_EMAIL_MODE === 'live';
  const blockers = [...(prep?.composed.blockers ?? []), ...(prep && !prep.to ? ['There is no valid email address for this client.'] : [])];
  const cbValue = ctx.sp.cb && callbackAt ? ctx.sp.cb : prep?.callbackAt ? istInput(prep.callbackAt) : '';
  const effDesignerId = prep?.designer?.id ?? designerId ?? '';
  const history = ctx.ds.outboundEmails.filter((m) => m.enquiry_id === e.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const name = (id: string | null) => designers.find((x) => x.id === id)?.name ?? '—';
  const pill = (t: EmailTemplate) => `${href(ctx.sp, { email: t })}#email`;

  return (
    <div id="email" className="scroll-mt-4 space-y-3">
      <Panel title="Email the client">
        <div role="tablist" aria-label="Email type" className="flex flex-wrap gap-2">
          {TEMPLATES.map((t) => (
            <Link
              key={t.key}
              href={pill(t.key)}
              role="tab"
              aria-selected={t.key === template}
              title={t.hint}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${t.key === template ? 'border-accent bg-accent text-white' : 'border-line-strong bg-surface text-mute hover:bg-subtle hover:text-text'}`}
            >
              {t.label}
            </Link>
          ))}
        </div>
        <p className="mt-2 text-[13px] text-mute">{TEMPLATES.find((t) => t.key === template)?.hint}.</p>

        {!prep ? (
          <p className="mt-4 text-sm text-mute">This enquiry could not be found.</p>
        ) : (
          <>
            <div className="mt-4 overflow-hidden rounded-xl border border-line">
              <div className="space-y-1 bg-subtle px-4 py-3 text-sm">
                <div><span className="text-mute">To </span><span className={prep.to ? '' : 'text-crit'}>{prep.to ?? 'no valid address'}</span></div>
                <div><span className="text-mute">Subject </span><span className="font-medium">{prep.composed.subject}</span></div>
                <div className="text-mute">
                  {prep.designer ? `From the studio, naming ${prep.designer.name}` : 'No designer named'}
                  {' · '}
                  {prep.consultation
                    ? `consultation ${formatDateTime(prep.consultation.starts_at)}`
                    : prep.callbackAt ? `callback by ${formatDateTime(prep.callbackAt)}` : 'no time promised'}
                </div>
              </div>
              <pre className="scroll-thin max-h-80 overflow-auto whitespace-pre-wrap break-words bg-surface p-4 font-mono text-[13px] leading-relaxed" tabIndex={0} aria-label="Email preview">
                {prep.composed.text}
              </pre>
            </div>

            {blockers.length > 0 && (
              <ul className="mt-3 space-y-2" aria-label="Why this cannot be sent">
                {blockers.map((b, i) => <li key={i}><Notice tone="crit"><strong>Cannot send:</strong> {b}</Notice></li>)}
              </ul>
            )}

            <form action={sendClientEmailAction} className="mt-4 flex flex-wrap items-center gap-3">
              <input type="hidden" name="enquiry_id" value={e.id} />
              <input type="hidden" name="template" value={template} />
              <input type="hidden" name="designer_id" value={effDesignerId} />
              <input type="hidden" name="callback" value={prep.consultation ? '' : cbValue} />
              <input type="hidden" name="question" value={template === 'clarification' ? question : ''} />
              <input type="hidden" name="note" value={note} />
              <ReturnTo value={ctx.returnTo} />
              <button type="submit" className="btn-solid" disabled={blockers.length > 0}>Send email</button>
              <span className="text-[13px] text-mute">
                {live
                  ? 'This goes to the real client. It never contains a price.'
                  : 'Test mode: the email is recorded but not delivered. It never contains a price.'}
              </span>
            </form>

            <More title="Change who it names, the time or add a note">
              {/* GET form: only changes what the preview shows. */}
              <form action="/" method="get" className="grid gap-3 sm:grid-cols-2">
                {Object.entries(ctx.sp).filter(([k, v]) => v !== undefined && !['msg', 'ok', 'ed', 'cb', 'eq', 'en', 'email'].includes(k)).map(([k, v]) => (
                  <input key={k} type="hidden" name={k} value={v} />
                ))}
                <input type="hidden" name="email" value={template} />
                <Field label="Designer to name" htmlFor="em-designer">
                  <DesignerSelect key={effDesignerId} id="em-designer" name="ed" designers={designers} value={effDesignerId} blankLabel="The enquiry's designer" />
                </Field>
                <Field label="Call back by (IST)" htmlFor="em-cb" hint={prep.consultation ? 'Ignored while a consultation is booked.' : undefined}>
                  <input key={cbValue} id="em-cb" type="datetime-local" name="cb" defaultValue={cbValue} className="field" />
                </Field>
                {template === 'clarification' && (
                  <Field label="The one question (never about budget)" htmlFor="em-q" className="sm:col-span-2">
                    <input id="em-q" name="eq" defaultValue={question} maxLength={300} className="field" placeholder="e.g. Is the flat ready for work, or still under construction?" />
                  </Field>
                )}
                <Field label="A personal note (optional)" htmlFor="em-note" className="sm:col-span-2">
                  <input id="em-note" name="en" defaultValue={note} maxLength={600} className="field" />
                </Field>
                <div className="sm:col-span-2"><button type="submit" className="btn">Update preview</button></div>
              </form>
            </More>
          </>
        )}
      </Panel>

      <Collapsible title="Emails already sent" hint={history.length === 0 ? 'none yet' : String(history.length)}>
        {history.length === 0 ? (
          <p className="text-sm text-mute">Nothing has been sent to this client yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {history.map((m) => {
              const st = STATUS[m.status] ?? { label: titleCase(m.status), tone: 'neutral' as Tone };
              return (
                <li key={m.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="font-medium">{titleCase(m.template)}</div>
                    <div className="text-sm text-mute">{m.subject}</div>
                    <div className="text-[13px] text-mute">
                      {formatDateTime(m.created_at)}{m.sent_by ? ` · by ${m.sent_by}` : ''}{m.designer_id ? ` · naming ${name(m.designer_id)}` : ''}{m.callback_at ? ` · callback ${formatDateTime(m.callback_at)}` : ''}
                    </div>
                    {m.error && <div className="text-[13px] text-crit">{m.error}</div>}
                  </div>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </li>
              );
            })}
          </ul>
        )}
      </Collapsible>
    </div>
  );
}
