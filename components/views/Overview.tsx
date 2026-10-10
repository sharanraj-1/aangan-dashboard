// "Results" — the founder's main screen (outcome numbers only) and a designer tab.
// A calm one-screen summary; the detail lives in closed sections. Aggregates only:
// nothing in here loops over enquiries or prints per-person data.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge, Bar, Collapsible, Empty, Kpi, PageHeader, Panel } from '../ui';
import { Funnel, SegmentedBar, StackedDailyBars } from '../charts';
import type { ViewCtx } from '../types';
import { formatDuration, formatInr, formatLakhCr, pct } from '@/lib/format';
import { href } from '@/lib/url';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const orDash = (v: number | null, f: (n: number) => string) => (v === null ? '—' : f(v));

const KIND_LABEL: Record<string, string> = {
  transcription: 'Unclear recording',
  lead_qualification: 'Lead decision',
  pricing: 'Price question',
  service_recovery: 'Service recovery',
};

export function Overview({ ctx }: { ctx: ViewCtx }) {
  const { m, role } = ctx;
  const { volume: v, response: r, qualification: q, handoff: h, escalations: e, calendar: c, money, funnel } = m;
  const isDesigner = role === 'designer';
  const realLeads = funnel[1]?.n ?? 0;
  const openEsc = e.open + e.acknowledged;

  // ---- one plain-English sentence for the header
  const clauses: string[] = [];
  if (r.withinHourShare !== null) clauses.push(`${pct(r.withinHourShare)} of those with a recorded reply were answered within an hour`);
  if (realLeads > 0) clauses.push(`${q.counts.qualified} look like a good fit`);
  if (q.awaitingReview > 0) clauses.push(`${q.awaitingReview} ${q.awaitingReview === 1 ? 'is' : 'are'} waiting for a person to look`);
  const summary =
    v.total === 0
      ? 'No enquiries have been recorded for this month yet.'
      : `${plural(v.total, 'enquiry', 'enquiries')} came in${clauses.length ? '. ' : '.'}${
          clauses.length ? `${clauses.length > 1 ? clauses.slice(0, -1).join(', ') + ', and ' + clauses[clauses.length - 1] : clauses[0]}.` : ''
        }`;

  const subtitle = (
    <>
      {summary}
      {m.syntheticCount > 0 && <span className="mt-1 block text-sm text-faint">includes {m.syntheticCount} sample {m.syntheticCount === 1 ? 'enquiry' : 'enquiries'}</span>}
    </>
  );

  if (!m.hasData) {
    return (
      <div>
        <PageHeader title={m.monthLabel} subtitle={subtitle} />
        <Empty>Nothing to show for {m.monthLabel} yet. This page fills in as enquiries arrive.</Empty>
      </div>
    );
  }

  const fastReplyInsight = (): string => {
    const lt1 = r.buckets[0];
    const gt48 = r.buckets[4];
    if (r.conversionLift !== null) return `Enquiries answered within an hour turn into projects ${r.conversionLift.toFixed(1)} times as often as those answered after 48 hours.`;
    if (r.recorded === 0) return 'No replies have been recorded yet this month.';
    return `${lt1.n} ${lt1.n === 1 ? 'enquiry was' : 'enquiries were'} answered within an hour, and ${gt48.n} waited more than 48 hours.`;
  };
  const anyConversion = r.buckets.some((b) => b.conversion !== null);
  const bucketMax = Math.max(1, ...r.buckets.map((b) => b.n));

  return (
    <div className="space-y-6">
      <PageHeader title={m.monthLabel} subtitle={subtitle} />

      {/* ---------------------------------------------------------------- four headline numbers */}
      <section aria-label="Headline numbers" className={`grid grid-cols-2 gap-4 ${money.wonCount > 0 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
        <Kpi
          label="Enquiries"
          value={v.total}
          sub={`${v.byChannel.phone.n} phone, ${v.byChannel.whatsapp.n} WhatsApp, ${v.byChannel.web_form.n} web`}
        />
        <Kpi
          hot
          label="Answered within an hour"
          value={r.withinHourShare === null ? '—' : pct(r.withinHourShare)}
          sub={r.recorded > 0 ? 'Fast replies are the ones that turn into projects.' : 'No replies recorded yet.'}
        />
        <Kpi
          label="Good fit"
          value={q.counts.qualified}
          sub={q.qualifiedRate !== null ? `${pct(q.qualifiedRate)} of ${plural(realLeads, 'real lead')}` : 'No real leads yet.'}
        />
        <Kpi
          hot
          label="Pipeline value"
          value={money.pipelineCount > 0 ? formatLakhCr(money.pipelineInr) : '—'}
          sub={money.pipelineCount > 0 ? 'Internal estimate' : 'No estimates yet'}
        />
        {money.wonCount > 0 && <Kpi label="Won so far" value={formatLakhCr(money.wonInr)} tone="ok" sub={`${plural(money.wonCount, 'project')} signed`} />}
      </section>

      {/* ---------------------------------------------------------------- needs attention */}
      <section aria-label="Needs attention" className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-accent/20 bg-accent-soft p-5">
        <div>
          {openEsc > 0 ? (
            <>
              <h2 className="font-display text-xl font-semibold">{openEsc} {openEsc === 1 ? 'thing is' : 'things are'} waiting for a person</h2>
              <p className="mt-1 text-[15px] text-mute">
                {e.open} new, {e.acknowledged} already being looked at
                {r.awaiting > 0 && <>. {plural(r.awaiting, 'live enquiry', 'live enquiries')} still without a reply.</>}
              </p>
            </>
          ) : r.awaiting > 0 ? (
            <>
              <h2 className="font-display text-xl font-semibold">Nothing is flagged for a person</h2>
              <p className="mt-1 text-[15px] text-mute">{plural(r.awaiting, 'live enquiry', 'live enquiries')} still without a reply.</p>
            </>
          ) : (
            <h2 className="font-display text-xl font-semibold">Nothing is waiting — nice.</h2>
          )}
        </div>
        {isDesigner && openEsc > 0 && (
          <Link href={href(ctx.sp, { view: 'escalations', enquiry: null })} className="btn-solid">Open the list</Link>
        )}
      </section>

      {/* ---------------------------------------------------------------- three compact cards */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Enquiries this month">
          {v.total === 0 ? (
            <p className="text-sm text-mute">No enquiries this month.</p>
          ) : (
            <>
              <StackedDailyBars days={v.daily} stacked={false} />
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge tone="accent">Phone {v.byChannel.phone.n}</Badge>
                <Badge tone="info">WhatsApp {v.byChannel.whatsapp.n}</Badge>
                <Badge>Web form {v.byChannel.web_form.n}</Badge>
              </div>
              <p className="mt-3 text-sm text-mute">
                {v.afterHoursShare !== null ? `${pct(v.afterHoursShare)} arrived outside 10am–7pm` : 'No after-hours data yet'}
                {v.missedCalls > 0 ? `, and ${plural(v.missedCalls, 'call')} ${v.missedCalls === 1 ? 'was' : 'were'} missed.` : ', and no calls were missed.'}
              </p>
            </>
          )}
        </Panel>

        <Panel title="How fast we reply">
          {r.recorded === 0 ? (
            <p className="text-sm text-mute">No replies recorded yet this month.</p>
          ) : (
            <ul className="space-y-3.5">
              {r.buckets.map((b) => (
                <li key={b.key}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span>{b.label}</span>
                    <span className="tabular-nums">
                      {b.n}
                      {anyConversion && (
                        <span className="ml-2 text-mute">{b.conversion === null ? '' : (b.conversion === 0 ? 'none won yet' : `${pct(b.conversion)} became projects`)}</span>
                      )}
                    </span>
                  </div>
                  <div className="mt-1.5"><Bar value={b.n} max={bucketMax} tone={b.key === 'lt1h' ? 'ok' : 'accent'} height={6} label={`${b.label}: ${b.n} enquiries`} /></div>
                </li>
              ))}
            </ul>
          )}
          {r.recorded > 0 && !anyConversion && <p className="mt-3 text-sm text-mute">No results logged yet.</p>}
          <p className="mt-4 text-sm">{fastReplyInsight()}</p>
          {r.notRecorded > 0 && (
            <p className="mt-2 text-sm text-faint">
              {plural(r.notRecorded, 'enquiry', 'enquiries')} {r.notRecorded === 1 ? 'has' : 'have'} no recorded reply. Web-form reply times aren&apos;t recorded.
            </p>
          )}
        </Panel>

        <Panel title="How enquiries were sorted">
          <SegmentedBar
            segments={[
              { label: 'Good fit', n: q.counts.qualified, tone: 'ok' },
              { label: 'Needs a look', n: q.counts.review, tone: 'warn' },
              { label: 'Not a fit', n: q.counts.unqualified, tone: 'neutral' },
              { label: 'Not a lead', n: q.counts.not_applicable, tone: 'info' },
            ]}
          />
          <p className="mt-4 text-sm text-mute">
            {q.awaitingReview > 0
              ? `${plural(q.awaitingReview, 'enquiry', 'enquiries')} ${q.awaitingReview === 1 ? 'is' : 'are'} in the "needs a look" queue. A person decides these, so the AI never quietly turns away a good lead.`
              : 'Anything unclear goes to a person to decide, so the AI never quietly turns away a good lead.'}
          </p>
        </Panel>
      </div>

      {/* ---------------------------------------------------------------- money teaser */}
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex flex-wrap gap-x-10 gap-y-3">
            <div>
              <div className="label">Pipeline value</div>
              <div className="num mt-1 text-3xl leading-none">{money.pipelineCount > 0 ? formatLakhCr(money.pipelineInr) : '—'}</div>
            </div>
            <div>
              <div className="label">Cost to run this system</div>
              <div className="num mt-1 text-3xl leading-none">{money.totalCostInr > 0 ? formatInr(money.totalCostInr) : '—'}</div>
            </div>
          </div>
          <Link href={href(ctx.sp, { view: 'pricing', enquiry: null })} className="btn">Money &amp; costs →</Link>
        </div>
      </Panel>

      {/* ---------------------------------------------------------------- details, closed by default */}
      <div className="space-y-3">
        <Collapsible title="Handing leads to designers">
          {h.sent === 0 ? (
            <p className="text-sm text-mute">
              No leads have been sent to designers yet this month.
              {h.pendingRelease > 0 && ` ${plural(h.pendingRelease, 'good lead')} ${h.pendingRelease === 1 ? 'is' : 'are'} ready to send.`}
            </p>
          ) : (
            <Rows
              rows={[
                ['Sent to designers', h.sent],
                ['Accepted', h.accepted],
                ['Designer had to go back to the client', h.reasked > 0 ? `${h.reasked} (${orDash(h.reaskRate, (n) => pct(n))})` : 'Never'],
                ['Median time to accept', formatDuration(h.medianAcceptMinutes)],
                ['Ready to send', h.pendingRelease],
              ]}
            />
          )}
        </Collapsible>

        <Collapsible title="Needs attention — by type">
          <Rows
            rows={[
              ...Object.entries(KIND_LABEL)
                .filter(([k]) => (e.byKind[k] ?? 0) > 0)
                .map(([k, label]): [string, ReactNode] => [label, e.byKind[k]]),
              ...(e.created === 0 ? ([['Raised this month', 'None']] as [string, ReactNode][]) : []),
              ['Median time to resolve', e.resolved > 0 ? formatDuration(e.medianResolutionMinutes) : 'None resolved yet'],
              ['Oldest open', openEsc > 0 ? formatDuration(e.oldestOpenMinutes) : 'Nothing open'],
              ['Times the AI quoted a price', e.policyBreaches === 0 ? 'None' : <span className="text-crit">{e.policyBreaches}</span>],
            ]}
          />
        </Collapsible>

        <Collapsible title="Consultations">
          <Rows
            rows={[
              ['Booked', c.scheduled],
              ['Held', c.completed],
              ['No-shows', c.noShow],
              ['Coming up in the next 7 days', c.upcoming7d],
              ['Waiting to be marked held', c.awaitingOutcome],
              ['Good-fit leads that booked', orDash(c.bookingRate, (n) => pct(n))],
            ]}
          />
        </Collapsible>

        <Collapsible title="From enquiry to project">
          {v.total === 0 ? <p className="text-sm text-mute">No enquiries this month.</p> : <Funnel steps={funnel} />}
          {v.total > 0 && funnel[funnel.length - 1].n === 0 && <p className="mt-4 text-sm text-mute">No won projects logged yet.</p>}
        </Collapsible>

        <Collapsible title="How often the AI is overruled">
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <div className="label">Good-fit calls later marked bad</div>
              <div className="num mt-1 text-3xl leading-none">{orDash(q.fpRate, (n) => pct(n))}</div>
              <p className="mt-2 text-sm text-mute">
                {q.counts.qualified > 0
                  ? `${q.falsePositives} of ${q.counts.qualified} good-fit leads turned out not to be. The cost is a little designer time.`
                  : 'Nothing has been marked a good fit yet.'}
              </p>
            </div>
            <div>
              <div className="label">Declined leads later rescued</div>
              <div className="num mt-1 text-3xl leading-none">{orDash(q.fnRate, (n) => pct(n))}</div>
              <p className="mt-2 text-sm text-mute">
                {q.fnAudited > 0
                  ? `${q.falseNegatives} of ${q.fnAudited} double-checked declines were good leads${
                      q.estMissedGoodLeads !== null ? `. We estimate about ${q.estMissedGoodLeads} good ${q.estMissedGoodLeads === 1 ? 'lead' : 'leads'} were missed in total.` : '.'
                    }`
                  : 'No declined leads have been double-checked yet.'}
              </p>
            </div>
          </div>
          <p className="mt-5 text-sm">
            Missing a good lead is the costlier mistake: it is revenue we never see, while a wrong good-fit call only costs a designer a few minutes.
          </p>
        </Collapsible>
      </div>
    </div>
  );
}

// ---- small local pieces ---------------------------------------------------------------------------

/** Plain label / value rows, three to six per section. */
function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-line text-sm">
      {rows.map(([k, val]) => (
        <div key={k} className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
          <dt className="text-mute">{k}</dt>
          <dd className="text-right tabular-nums">{val}</dd>
        </div>
      ))}
    </dl>
  );
}
