// Follow up tab: this enquiry's consultations, quick-pick slots and a compact booking form.

import Link from 'next/link';
import { bookConsultationAction, cancelConsultationAction, consultationStatusAction } from '@/app/actions';
import { Badge, Panel, ReturnTo, type Tone } from '@/components/ui';
import { CONSULT_MINUTES, outsideStudioHours, suggestSlots } from '@/lib/calendar';
import { formatDateTime } from '@/lib/format';
import type { ConsultationStatus } from '@/lib/types';
import { href } from '@/lib/url';
import { DesignerSelect, Field, More, istInput, parseIso, type InspectorData } from './inspector-kit';

const STATUS: Record<ConsultationStatus, { label: string; tone: Tone }> = {
  scheduled: { label: 'Booked', tone: 'info' },
  completed: { label: 'Held', tone: 'ok' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  no_show: { label: 'No-show', tone: 'crit' },
};
const MODE_LABEL = { site_visit: 'Site visit', studio: 'At the studio', call: 'Phone or video call' } as const;

export function ConsultationPanel({ d }: { d: InspectorData }) {
  const { ctx, e, designers } = d;
  const mine = ctx.ds.consultations.filter((c) => c.enquiry_id === e.id).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const name = (id: string | null) => designers.find((x) => x.id === id)?.name ?? 'No designer yet';

  const designerId = (ctx.sp.sd && designers.some((x) => x.id === ctx.sp.sd) ? ctx.sp.sd : null) ?? e.designer_id ?? null;
  const slots = suggestSlots(designerId, ctx.now, ctx.ds.consultations, 6);
  const picked = parseIso(ctx.sp.slot);
  const slotLink = (patch: Record<string, string | null>) => `${href(ctx.sp, patch)}#consult`;
  const hasScheduled = mine.some((c) => c.status === 'scheduled');

  const bookingForm = (
    <div className="space-y-4">
      <div>
        <div className="label mb-1.5">Pick a time{designerId ? ` that suits ${name(designerId)}` : ''}</div>
        {designers.length > 1 && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {designers.map((x) => (
              <Link
                key={x.id}
                href={slotLink({ sd: x.id, slot: null })}
                aria-current={x.id === designerId ? 'true' : undefined}
                className={`rounded-full border px-3 py-1 text-sm ${x.id === designerId ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-line-strong text-mute hover:bg-subtle hover:text-text'}`}
              >
                {x.name}{x.is_sample ? ' (sample)' : ''}
              </Link>
            ))}
          </div>
        )}
        {slots.length === 0 ? (
          <p className="text-sm text-mute">No free slots in the next three weeks. Pick a time yourself below.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {slots.map((s) => {
              const iso = s.toISOString();
              const on = picked?.getTime() === s.getTime();
              return (
                <li key={iso}>
                  <Link
                    href={slotLink({ slot: iso, sd: designerId })}
                    aria-current={on ? 'true' : undefined}
                    className={`inline-block rounded-full border px-3.5 py-1.5 text-sm ${on ? 'border-accent bg-accent text-white' : 'border-line-strong bg-surface hover:bg-subtle'}`}
                  >
                    {formatDateTime(s)}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <form action={bookConsultationAction} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="enquiry_id" value={e.id} />
        <input type="hidden" name="minutes" value={CONSULT_MINUTES} />
        <ReturnTo value={ctx.returnTo} />
        <Field label="Designer" htmlFor="book-designer">
          <DesignerSelect key={designerId ?? 'none'} id="book-designer" name="designer_id" designers={designers} value={designerId} blankLabel="No designer yet" />
        </Field>
        <Field label="Date and time (IST)" htmlFor="book-start">
          <input key={picked ? picked.toISOString() : 'none'} id="book-start" type="datetime-local" name="start" required defaultValue={picked ? istInput(picked) : ''} className="field" />
        </Field>
        <Field label="How" htmlFor="book-mode">
          <select id="book-mode" name="mode" defaultValue="site_visit" className="field">
            <option value="site_visit">Site visit</option>
            <option value="studio">At the studio</option>
            <option value="call">Phone or video call</option>
          </select>
        </Field>
        <Field label="Place" htmlFor="book-loc">
          <input id="book-loc" name="location" defaultValue={e.location ?? ''} placeholder="Site address or studio" className="field" />
        </Field>
        <div className="sm:col-span-2">
          <details>
            <summary className="inline-flex text-sm font-medium text-mute hover:text-text">Add a note for the designer</summary>
            <input id="book-notes" name="notes" maxLength={300} aria-label="Note for the designer" placeholder="Anything the designer should know" className="field mt-2" />
          </details>
        </div>
        <div className="sm:col-span-2">
          <button type="submit" className="btn-solid">Book consultation</button>
          <p className="mt-2 text-[13px] text-mute">A designer cannot be double-booked. Times outside studio hours are allowed but flagged.</p>
        </div>
      </form>
    </div>
  );

  return (
    <div id="consult" className="scroll-mt-4">
      <Panel title="Consultation" right={hasScheduled ? <Badge tone="info">Booked</Badge> : <Badge>Not booked</Badge>}>
        {mine.length > 0 && (
          <ul className="mb-2 space-y-2">
            {mine.map((c) => (
              <li key={c.id} className="rounded-xl bg-subtle p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{formatDateTime(c.starts_at)}</span>
                  <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                  {outsideStudioHours(new Date(c.starts_at)) && <Badge tone="warn">Outside studio hours</Badge>}
                </div>
                <div className="mt-1 text-sm text-mute">
                  {MODE_LABEL[c.mode]} · {name(c.designer_id)}{c.location ? ` · ${c.location}` : ''}{c.notes ? ` · ${c.notes}` : ''}
                  {c.google_event_id ? ' · On the studio calendar' : ''}
                </div>
                {c.status === 'scheduled' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <form action={consultationStatusAction} className="flex flex-wrap gap-2">
                      <input type="hidden" name="consultation_id" value={c.id} />
                      <ReturnTo value={ctx.returnTo} />
                      <button type="submit" name="status" value="completed" className="btn">Mark as held</button>
                      <button type="submit" name="status" value="no_show" className="btn-ghost">No-show</button>
                    </form>
                    <form action={cancelConsultationAction}>
                      <input type="hidden" name="consultation_id" value={c.id} />
                      <ReturnTo value={ctx.returnTo} />
                      <button type="submit" className="btn-danger">Cancel</button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {mine.length === 0 ? bookingForm : <More title={hasScheduled ? 'Book another time' : 'Book a new consultation'} defaultOpen={Boolean(picked)}>{bookingForm}</More>}
      </Panel>
    </div>
  );
}
