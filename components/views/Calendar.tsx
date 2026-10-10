// Calendar — designer-only. Who is meeting whom this week, and an easy way to book a consultation.
// Server component: navigation is links (?week=, ?des=, ?slot=, ?book=), mutations are server-action forms.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { bookConsultationAction, cancelConsultationAction, consultationStatusAction } from '@/app/actions';
import { BUSINESS_HOURS } from '@/lib/config';
import { isGoogleCalendarConfigured, suggestSlots } from '@/lib/calendar';
import { formatDateTime, formatTime } from '@/lib/format';
import { isHubSpotConfigured } from '@/lib/hubspot';
import { dayKey, effectiveQualification } from '@/lib/metrics';
import type { ConsultationMode, ConsultationRow, DesignerRow, EnquiryRow } from '@/lib/types';
import { href } from '@/lib/url';
import { Badge, Empty, PageHeader, ReturnTo, type Tone } from '../ui';
import type { ViewCtx } from '../types';

// ---------------------------------------------------------------------------------------------- vocab + date helpers

const TZ = BUSINESS_HOURS.tz;
const MODE_LABEL: Record<ConsultationMode, string> = { site_visit: 'Site visit', studio: 'At the studio', call: 'Phone or video call' };
const STATUS_LABEL: Record<ConsultationRow['status'], { label: string; tone: Tone }> = {
  scheduled: { label: 'Scheduled', tone: 'accent' },
  completed: { label: 'Held', tone: 'ok' },
  no_show: { label: 'No-show', tone: 'crit' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const hmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
// Calendar dates (no time zone of their own) are formatted from a noon-UTC anchor so they never slip a day.
const dayLabelFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' });

const anchor = (ymd: string) => new Date(`${ymd}T12:00:00Z`);
const addDays = (ymd: string, n: number) => { const d = anchor(ymd); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekdayOf = (ymd: string) => anchor(ymd).getUTCDay();
const weekStartOf = (ymd: string) => addDays(ymd, -((weekdayOf(ymd) + 6) % 7));
/** 'YYYY-MM-DDTHH:mm' in IST, the value format of <input type="datetime-local">. */
const toLocalInput = (d: Date) => `${ymdFmt.format(d)}T${hmFmt.format(d)}`;
const timeRange = (c: ConsultationRow) => `${formatTime(new Date(c.starts_at))} – ${formatTime(new Date(c.ends_at))}`;
const clientName = (e: EnquiryRow | undefined) => e?.client_name ?? 'Unnamed enquirer';
const designerLabel = (d: DesignerRow) => `${d.name}${d.is_sample ? ' (sample)' : ''}`;
const byStart = (a: ConsultationRow, b: ConsultationRow) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------------------------------------- view

export function Calendar({ ctx }: { ctx: ViewCtx }) {
  const { ds, sp, now } = ctx;
  const visible = new Map(ds.enquiries.filter((e) => ctx.includeSynthetic || !e.is_synthetic).map((e) => [e.id, e]));
  const designers = new Map(ds.designers.map((d) => [d.id, d]));
  const consults = ds.consultations.filter((c) => visible.has(c.enquiry_id));
  const activeDesigners = ds.designers.filter((d) => d.active);

  // Week selection
  const parsed = Number.parseInt(sp.week ?? '0', 10);
  const offset = Number.isFinite(parsed) ? Math.max(-104, Math.min(104, parsed)) : 0;
  const today = ymdFmt.format(now);
  const monday = addDays(weekStartOf(today), offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const weekLabel = `${dayLabelFmt.format(anchor(days[0]))} – ${dayLabelFmt.format(anchor(days[6]))}`;
  const weekHref = (o: number) => href(sp, { week: o === 0 ? null : String(o), slot: null, book: null });

  // Designer filter (des=<id> | none)
  const desParam = sp.des;
  const desActive = desParam === 'none' || (desParam !== undefined && designers.has(desParam)) ? desParam : null;
  const matchDes = (c: ConsultationRow) => !desActive || (desActive === 'none' ? !c.designer_id : c.designer_id === desActive);

  const weekRows = consults.filter((c) => days.includes(dayKey(c.starts_at)) && matchDes(c)).sort(byStart);
  const liveCount = weekRows.filter((c) => c.status !== 'cancelled').length;
  const awaiting = consults.filter((c) => c.status === 'scheduled' && new Date(c.ends_at) < now && matchDes(c)).sort(byStart);

  // Days with something booked vs. quiet days (collapsed into one line).
  const busyDays = days.filter((ymd) => weekRows.some((c) => dayKey(c.starts_at) === ymd));
  const quietDays = days.filter((ymd) => !busyDays.includes(ymd));

  // Where the bookings are, for an empty week.
  const pool = consults.filter((c) => c.status !== 'cancelled' && matchDes(c));
  const nearest = weekRows.length === 0 && pool.length > 0
    ? [...pool].sort((a, b) => Math.abs(new Date(a.starts_at).getTime() - now.getTime()) - Math.abs(new Date(b.starts_at).getTime() - now.getTime()))[0]
    : null;
  const nearestOffset = nearest ? Math.round((anchor(weekStartOf(dayKey(nearest.starts_at))).getTime() - anchor(weekStartOf(today)).getTime()) / (7 * 86_400_000)) : null;

  const bookOpen = Boolean(sp.book || sp.slot);
  const weekWord = offset === 0 ? 'this week' : 'that week';

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle={`${weekLabel} · ${plural(liveCount, 'consultation')} ${weekWord}`}
        right={
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href={weekHref(offset - 1)} className="btn-ghost" aria-label="Previous week">← Previous</Link>
            <Link href={weekHref(0)} className={offset === 0 ? 'btn-ghost' : 'btn'} aria-current={offset === 0 ? 'date' : undefined}>This week</Link>
            <Link href={weekHref(offset + 1)} className="btn-ghost" aria-label="Next week">Next →</Link>
          </div>
        }
      />

      {/* ------------------------------------------------------------------ book a consultation */}
      <details id="book" open={bookOpen} className="group mb-6 scroll-mt-4">
        <summary className="btn-solid cursor-pointer list-none group-open:mb-3">
          <span aria-hidden className="text-lg leading-none group-open:hidden">+</span>
          <span className="group-open:hidden">Book a consultation</span>
          <span className="hidden group-open:inline">Close booking form</span>
        </summary>
        <BookingForm ctx={ctx} enquiries={bookable(ds.enquiries, consults, ctx.includeSynthetic)} designers={activeDesigners} desActive={desActive} consults={ds.consultations} />
      </details>

      {/* ------------------------------------------------------------------ waiting for an outcome */}
      {awaiting.length > 0 && (
        <section aria-labelledby="awaiting-head" className="mb-6 rounded-2xl border border-warn/30 bg-warn-soft p-5">
          <h2 id="awaiting-head" className="font-display text-xl font-semibold tracking-tight">Waiting for an outcome</h2>
          <p className="mt-0.5 text-[15px] text-mute">These have already taken place. Did they happen?</p>
          <ul className="mt-4 space-y-3">
            {awaiting.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface p-4">
                <div className="min-w-0">
                  <Link href={href(sp, { view: 'queue', enquiry: c.enquiry_id })} className="text-[15px] font-medium underline underline-offset-2 hover:text-accent">
                    {clientName(visible.get(c.enquiry_id))}
                  </Link>
                  <p className="text-sm text-mute">{formatDateTime(c.starts_at)} · {designerName(c, designers)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusButton c={c} status="completed" label="Held" className="btn-solid" returnTo={ctx.returnTo} />
                  <StatusButton c={c} status="no_show" label="No-show" className="btn" returnTo={ctx.returnTo} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------------------------ designer filter */}
      {activeDesigners.length > 1 && (
        <details className="mb-5" open={desActive !== null}>
          <summary className="inline-block cursor-pointer text-sm font-medium text-mute hover:text-text">
            Filter by designer{desActive ? ` · ${desActive === 'none' ? 'Not assigned yet' : designers.get(desActive)?.name ?? ''}` : ''}
          </summary>
          <div className="mt-2 flex flex-wrap gap-2">
            <Pill to={href(sp, { des: null })} active={!desActive}>Everyone</Pill>
            {activeDesigners.map((d) => <Pill key={d.id} to={href(sp, { des: d.id })} active={desActive === d.id}>{designerLabel(d)}</Pill>)}
            <Pill to={href(sp, { des: 'none' })} active={desActive === 'none'}>Not assigned yet</Pill>
          </div>
        </details>
      )}

      {/* ------------------------------------------------------------------ agenda */}
      {weekRows.length === 0 ? (
        <Empty>
          <p className="text-[15px] font-medium text-text">{desActive ? 'Nothing booked for this designer this week.' : 'No consultations this week.'}</p>
          <p className="mt-1">Use “Book a consultation” above to add one.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {desActive && <Link href={href(sp, { des: null })} className="btn">Show everyone</Link>}
            {nearest && nearestOffset !== null && nearestOffset !== offset && (
              <Link href={weekHref(nearestOffset)} className="btn">Go to the week of {formatDateTime(nearest.starts_at).split(',')[0]}</Link>
            )}
          </div>
        </Empty>
      ) : (
        <div className="space-y-6">
          {busyDays.map((ymd) => (
            <section key={ymd} aria-labelledby={`day-${ymd}`}>
              <h2 id={`day-${ymd}`} className="mb-2 flex items-center gap-2 font-display text-xl font-semibold tracking-tight">
                {WEEKDAY_LONG[weekdayOf(ymd)]} {dayLabelFmt.format(anchor(ymd))}
                {ymd === today && <Badge tone="accent">Today</Badge>}
              </h2>
              <ul className="space-y-3">
                {weekRows.filter((c) => dayKey(c.starts_at) === ymd).map((c) => (
                  <li key={c.id}><ConsultCard c={c} enquiry={visible.get(c.enquiry_id)} designers={designers} ctx={ctx} /></li>
                ))}
              </ul>
            </section>
          ))}
          {quietDays.length > 0 && (
            <p className="text-[15px] text-mute">Nothing booked {quietDays.map((ymd) => WEEKDAY_LONG[weekdayOf(ymd)].slice(0, 3)).join(', ')}</p>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------ integrations */}
      <p className="mt-10 text-sm text-mute">
        Google Calendar: {isGoogleCalendarConfigured() ? 'connected' : 'not connected'} · Client invite file: attached to every confirmation email · HubSpot: {isHubSpotConfigured() ? 'connected' : 'off'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- agenda pieces

const designerName = (c: ConsultationRow, designers: Map<string, DesignerRow>): ReactNode => {
  const d = c.designer_id ? designers.get(c.designer_id) : undefined;
  return d ? d.name : <span className="text-warn">Not assigned yet</span>;
};

function Pill({ to, active, children }: { to: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={to}
      aria-current={active ? 'true' : undefined}
      className={`inline-flex items-center rounded-full border px-3.5 py-1 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
        active ? 'border-accent bg-accent text-white' : 'border-line-strong bg-surface text-text hover:bg-subtle'
      }`}
    >
      {children}
    </Link>
  );
}

function ConsultCard({ c, enquiry, designers, ctx }: { c: ConsultationRow; enquiry: EnquiryRow | undefined; designers: Map<string, DesignerRow>; ctx: ViewCtx }) {
  const cancelled = c.status === 'cancelled';
  const status = STATUS_LABEL[c.status];
  const place = enquiry?.location ?? c.location;
  return (
    <article className={`panel p-5 ${cancelled ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-[15px] font-semibold ${cancelled ? 'line-through' : ''}`}>{timeRange(c)}</p>
          <Link href={href(ctx.sp, { view: 'queue', enquiry: c.enquiry_id })} className="font-display text-xl font-semibold tracking-tight underline-offset-2 hover:text-accent hover:underline">
            {clientName(enquiry)}
          </Link>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <p className="mt-1.5 text-[15px] text-mute">
        {MODE_LABEL[c.mode]}
        {place ? ` · ${place}` : ''}
        {' · '}{designerName(c, designers)}
      </p>
      {c.status === 'scheduled' && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
          <StatusButton c={c} status="completed" label="Held" className="btn-ghost" returnTo={ctx.returnTo} />
          <StatusButton c={c} status="no_show" label="No-show" className="btn-ghost" returnTo={ctx.returnTo} />
          <form action={cancelConsultationAction}>
            <ReturnTo value={ctx.returnTo} />
            <input type="hidden" name="consultation_id" value={c.id} />
            <button type="submit" className="btn-ghost !text-crit hover:!bg-crit-soft" title="Cancel this consultation (removes the Google Calendar event if synced)">Cancel</button>
          </form>
        </div>
      )}
    </article>
  );
}

function StatusButton({ c, status, label, className, returnTo }: { c: ConsultationRow; status: 'completed' | 'no_show'; label: string; className: string; returnTo: string }) {
  return (
    <form action={consultationStatusAction}>
      <ReturnTo value={returnTo} />
      <input type="hidden" name="consultation_id" value={c.id} />
      <button type="submit" name="status" value={status} className={className}>{label}</button>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------- booking

/** Qualified, still-live enquiries that have no scheduled or held consultation yet. */
function bookable(enquiries: EnquiryRow[], consults: ConsultationRow[], includeSynthetic: boolean): EnquiryRow[] {
  const taken = new Set(consults.filter((c) => c.status === 'scheduled' || c.status === 'completed').map((c) => c.enquiry_id));
  return enquiries
    .filter((e) => (includeSynthetic || !e.is_synthetic) && effectiveQualification(e) === 'qualified' && !['won', 'lost', 'closed'].includes(e.status) && !taken.has(e.id))
    .sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime())
    .slice(0, 200);
}

function BookingForm({ ctx, enquiries, designers, desActive, consults }: {
  ctx: ViewCtx; enquiries: EnquiryRow[]; designers: DesignerRow[]; desActive: string | null; consults: ConsultationRow[];
}) {
  const { sp, now } = ctx;
  if (enquiries.length === 0) {
    return (
      <Empty>
        Nobody is waiting for a consultation. Once a lead is marked a good fit in{' '}
        <Link className="font-medium text-accent underline" href={href(sp, { view: 'escalations' })}>Needs attention</Link> or the{' '}
        <Link className="font-medium text-accent underline" href={href(sp, { view: 'queue' })}>enquiries list</Link>, you can book them here.
      </Empty>
    );
  }
  const slot = sp.slot && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(sp.slot) ? sp.slot : undefined;
  const preselect = sp.book && enquiries.some((e) => e.id === sp.book) ? sp.book : undefined;
  const defaultDesigner = desActive && desActive !== 'none' && designers.some((d) => d.id === desActive) ? desActive : '';
  const f = 'flex flex-col gap-1.5';
  return (
    <form action={bookConsultationAction} className="panel space-y-5 p-5">
      <ReturnTo value={ctx.returnTo} />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={`${f} sm:col-span-2`}>
          <span className="label">Who is it for?</span>
          <select name="enquiry_id" required defaultValue={preselect ?? ''} className="field">
            <option value="" disabled>Choose an enquiry…</option>
            {enquiries.map((e) => (
              <option key={e.id} value={e.id}>{e.client_name ?? e.source_ref ?? e.id.slice(0, 6)} — {e.location ?? 'place not stated'}</option>
            ))}
          </select>
        </label>
        <label className={f}>
          <span className="label">Designer</span>
          <select name="designer_id" defaultValue={defaultDesigner} className="field">
            <option value="">Not assigned yet</option>
            {designers.map((d) => <option key={d.id} value={d.id}>{designerLabel(d)}</option>)}
          </select>
        </label>
        <label className={f}>
          <span className="label">How</span>
          <select name="mode" defaultValue="site_visit" className="field">
            <option value="site_visit">Site visit</option>
            <option value="studio">At the studio</option>
            <option value="call">Phone or video call</option>
          </select>
        </label>
        <label className={f}>
          <span className="label">When (India time)</span>
          <input type="datetime-local" name="start" required defaultValue={slot} min={toLocalInput(now)} className="field" />
        </label>
        <label className={f}>
          <span className="label">How long (minutes)</span>
          <input type="number" name="minutes" defaultValue={60} min={15} max={240} step={15} className="field" />
        </label>
        <label className={`${f} sm:col-span-2`}>
          <span className="label">Where (leave blank to use the enquiry’s place)</span>
          <input type="text" name="location" className="field" placeholder="Site address, studio, or video link" />
        </label>
        <label className={`${f} sm:col-span-2`}>
          <span className="label">Notes for the designer (optional)</span>
          <textarea name="notes" rows={2} className="field" placeholder="Access details, who will be there, anything the brief missed" />
        </label>
      </div>

      <Slots ctx={ctx} designers={designers} desActive={desActive} consults={consults} />

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="max-w-md text-sm text-mute">Booking the same designer twice at once is blocked. The client’s confirmation email carries a calendar invite.</p>
        <button type="submit" className="btn-solid">Book consultation</button>
      </div>
    </form>
  );
}

/** Quiet quick-picks: clicking one reloads the page with the time prefilled. */
function Slots({ ctx, designers, desActive, consults }: { ctx: ViewCtx; designers: DesignerRow[]; desActive: string | null; consults: ConsultationRow[] }) {
  const designer = designers.find((d) => d.id === desActive) ?? designers[0];
  if (!designer) return <p className="text-sm text-mute">Add an active designer to see free times.</p>;
  const slots = suggestSlots(designer.id, ctx.now, consults, 6);
  // Only switch the designer filter when there is more than one designer to choose from.
  const desPatch = designers.length > 1 ? designer.id : null;
  return (
    <div>
      <p className="text-sm text-mute">Next free times for {designerLabel(designer)}{designers.length > 1 && !desActive ? ' (use “Filter by designer” to see someone else’s)' : ''}</p>
      {slots.length === 0 ? (
        <p className="mt-1.5 text-sm text-mute">No free times in the next three weeks.</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-2">
          {slots.map((s) => (
            <li key={s.toISOString()}>
              <Link
                href={`${href(ctx.sp, { des: desPatch, slot: toLocalInput(s) })}#book`}
                className="inline-flex rounded-full bg-subtle px-3 py-1 text-sm text-text transition-colors hover:bg-accent-soft hover:text-accent"
              >
                {formatDateTime(s)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
