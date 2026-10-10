// The Inbox: a calm list of enquiries, and (when one is open) the enquiry detail beside it. Designer-only.

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ViewCtx } from '@/components/types';
import { Badge, Empty, PageHeader, channelLabel } from '@/components/ui';
import { GUARDRAILS } from '@/lib/config';
import { effectiveQualification, monthKey, monthLabel } from '@/lib/metrics';
import type { Channel, EnquiryRow } from '@/lib/types';
import { href } from '@/lib/url';
import { Inspector } from './Inspector';
import { enquiryStatus, isActiveLead, needsLook, relativeTime } from './inspector-kit';

const MAX_ROWS = 12;

type StatusFilter = 'all' | 'action' | 'qualified' | 'declined' | 'norespons';
const FILTERS: { key: StatusFilter; label: string; hint: string }[] = [
  { key: 'action', label: 'Needs a look', hint: 'The AI was not sure, or something is waiting for a person' },
  { key: 'qualified', label: 'Good fit', hint: 'Worth a designer’s time' },
  { key: 'declined', label: 'Not a fit', hint: 'Politely declined' },
  { key: 'norespons', label: 'Waiting for a reply', hint: 'A live lead we have not replied to yet' },
  { key: 'all', label: 'All', hint: 'Every enquiry this month' },
];
const CHANNELS: { key: Channel; label: string }[] = [
  { key: 'phone', label: 'Phone' }, { key: 'whatsapp', label: 'WhatsApp' }, { key: 'web_form', label: 'Web form' },
];
const PRIORITY_FLAGS = ['founder_connection', 'referral', 'large_project'];

function Pill({ href: to, active, children, title }: { href: string; active: boolean; children: ReactNode; title?: string }) {
  return (
    <Link
      href={to}
      title={title}
      aria-current={active ? 'true' : undefined}
      className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${active ? 'border-accent bg-accent text-white' : 'border-line-strong bg-surface text-mute hover:bg-subtle hover:text-text'}`}
    >
      {children}
    </Link>
  );
}

export async function Queue({ ctx }: { ctx: ViewCtx }) {
  if (ctx.role !== 'designer') return <Empty>The inbox is for designers only.</Empty>;
  const { sp } = ctx;

  // ---- this month, respecting the synthetic toggle, newest first ----
  const month = ctx.ds.enquiries
    .filter((e) => monthKey(e.received_at) === ctx.month && (ctx.includeSynthetic || !e.is_synthetic))
    .sort((a, b) => b.received_at.localeCompare(a.received_at));

  const openEsc = new Map<string, number>();
  for (const x of ctx.ds.escalations) if (x.status !== 'resolved') openEsc.set(x.enquiry_id, (openEsc.get(x.enquiry_id) ?? 0) + 1);
  const openCount = (e: EnquiryRow) => openEsc.get(e.id) ?? 0;

  // With no explicit choice, start on what needs a person (when there is anything); a search always looks at everything.
  const hasLook = month.some((e) => needsLook(e, openCount(e)));
  const f: StatusFilter = FILTERS.some((c) => c.key === sp.f) ? (sp.f as StatusFilter) : hasLook && !(sp.q ?? '').trim() ? 'action' : 'all';
  const ch = CHANNELS.find((c) => c.key === sp.ch)?.key ?? null;
  const q = (sp.q ?? '').trim();
  const ql = q.toLowerCase();

  const matchesStatus = (e: EnquiryRow, key: StatusFilter): boolean => {
    switch (key) {
      case 'action': return needsLook(e, openCount(e));
      case 'qualified': return effectiveQualification(e) === 'qualified';
      case 'declined': return effectiveQualification(e) === 'unqualified';
      case 'norespons': return !e.first_response_at && isActiveLead(e);
      default: return true;
    }
  };
  const matchesChannel = (e: EnquiryRow) => !ch || e.channel === ch;
  const matchesQuery = (e: EnquiryRow) => !ql || [e.client_name, e.location, e.source_ref, e.client_phone].some((v) => v?.toLowerCase().includes(ql));

  const counts = Object.fromEntries(FILTERS.map((c) => [c.key, month.filter((e) => matchesChannel(e) && matchesQuery(e) && matchesStatus(e, c.key)).length])) as Record<StatusFilter, number>;
  const rows = month.filter((e) => matchesStatus(e, f) && matchesChannel(e) && matchesQuery(e));
  const showAll = sp.all === '1';
  const shown = showAll ? rows : rows.slice(0, MAX_ROWS);

  const selected = sp.enquiry ? ctx.ds.enquiries.find((e) => e.id === sp.enquiry) ?? null : null;
  const needLookTotal = month.filter((e) => needsLook(e, openCount(e))).length;
  const to = (patch: Record<string, string | null>) => href(sp, patch);
  // Opening an enquiry always lands on its Overview with no leftover form state.
  const openLink = (id: string) => to({ view: 'queue', enquiry: id, tab: null, tx: null, slot: null, sd: null, email: null, ed: null, cb: null, eq: null, en: null });

  // Hidden inputs so the GET search form keeps month / filters / selection.
  const keep = Object.entries(sp).filter(([k, v]) => v !== undefined && !['q', 'all', 'msg', 'ok'].includes(k)) as [string, string][];

  const header = (
    <PageHeader
      title="Inbox"
      subtitle={`${month.length} enquir${month.length === 1 ? 'y' : 'ies'} in ${monthLabel(ctx.month)}${month.length > 0 ? ` — ${needLookTotal === 0 ? 'nothing needs a look.' : `${needLookTotal} need${needLookTotal === 1 ? 's' : ''} a look.`}` : '.'}`}
    />
  );

  const list = (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter enquiries">
        {FILTERS.map((c) => (
          <Pill key={c.key} href={to({ f: c.key, all: null })} active={f === c.key} title={c.hint}>
            {c.label}
            <span className={`text-[13px] tabular-nums ${f === c.key ? 'text-white/85' : 'text-faint'}`}>{counts[c.key]}</span>
          </Pill>
        ))}
      </div>

      <form action="/" method="get" role="search" className="mb-4 flex gap-2">
        {keep.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <label htmlFor="q" className="sr-only">Search by name, place or reference</label>
        <input id="q" name="q" type="search" defaultValue={q} placeholder="Search by name or place" className="field" />
        <button type="submit" className="btn shrink-0">Search</button>
        {q && <Link href={to({ q: null, all: null })} className="btn-ghost shrink-0">Clear</Link>}
      </form>

      <details className="mb-4" open={Boolean(ch)}>
        <summary className="inline-flex items-center gap-1.5 text-sm font-medium text-mute hover:text-text">
          <span aria-hidden>›</span> Filter by how they got in touch{ch ? ` (${CHANNELS.find((c) => c.key === ch)?.label})` : ''}
        </summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <Pill href={to({ ch: null, all: null })} active={!ch}>Any</Pill>
          {CHANNELS.map((c) => <Pill key={c.key} href={to({ ch: c.key, all: null })} active={ch === c.key}>{c.label}</Pill>)}
        </div>
      </details>

      {shown.length === 0 ? (
        <Empty>
          {month.length === 0
            ? `No enquiries in ${monthLabel(ctx.month)} yet.`
            : q ? `Nothing matches “${q}” here.` : f === 'action' ? 'Nothing needs a look — nice.' : 'No enquiries in this view.'}
        </Empty>
      ) : (
        <ul className="space-y-2">
          {shown.map((e) => {
            const on = e.id === selected?.id;
            const st = enquiryStatus(e, openCount(e));
            const overdue = isActiveLead(e) && !e.first_response_at && e.channel !== 'web_form'
              && (ctx.now.getTime() - new Date(e.received_at).getTime()) / 3_600_000 > GUARDRAILS.slaBreachHours;
            const priority = e.priority_flags.some((p) => PRIORITY_FLAGS.includes(p));
            const meta = [e.location, channelLabel(e.channel), relativeTime(e.received_at, ctx.now)].filter(Boolean).join(' · ');
            return (
              <li key={e.id}>
                <Link
                  href={openLink(e.id)}
                  aria-current={on ? 'true' : undefined}
                  className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3.5 transition-colors ${on ? 'border-accent/40 bg-accent-soft/60' : 'border-line bg-surface hover:border-line-strong hover:shadow-card'}`}
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{e.client_name ?? 'Unnamed enquirer'}</div>
                    <div className="truncate text-sm text-mute">{meta}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                    {overdue && <Badge tone="warn">Reply overdue</Badge>}
                    {priority && <Badge tone="warn">Priority</Badge>}
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {rows.length > MAX_ROWS && (
        <p className="mt-4 text-center text-sm text-mute">
          {showAll ? (
            <Link href={to({ all: null })} className="font-medium text-accent hover:underline">Show fewer</Link>
          ) : (
            <>Showing {MAX_ROWS} of {rows.length}. <Link href={to({ all: '1' })} className="font-medium text-accent hover:underline">Show more</Link></>
          )}
        </p>
      )}
    </div>
  );

  if (!selected) {
    return (
      <div className="max-w-3xl">
        {sp.enquiry && <div className="mb-4 rounded-xl bg-warn-soft px-4 py-2.5 text-sm">That enquiry could not be found. Pick one from the list.</div>}
        {header}
        {list}
      </div>
    );
  }

  const outsideMonth = monthKey(selected.received_at) !== ctx.month;
  const closeLink = to({ enquiry: null, tab: null, tx: null, slot: null, sd: null, email: null, ed: null, cb: null, eq: null, en: null });
  return (
    <div>
      <div className="hidden lg:block">{header}</div>
      <div className="grid gap-6 lg:grid-cols-5">
        {/* On phones only the open enquiry is shown; the list is one tap away. */}
        <div className="hidden lg:col-span-2 lg:block">{list}</div>
        <div className="min-w-0 lg:col-span-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto lg:pr-1 scroll-thin" id="inspector">
          <Link href={closeLink} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-mute hover:text-text">
            <span aria-hidden>←</span> Inbox
          </Link>
          {outsideMonth && (
            <div className="mb-4 rounded-xl bg-info-soft px-4 py-2.5 text-sm">
              This enquiry is from {monthLabel(monthKey(selected.received_at))}, outside the month shown in the list.
            </div>
          )}
          <Inspector ctx={ctx} e={selected} />
        </div>
      </div>
    </div>
  );
}
