// "Money & costs" — shown to the founder AND designers.
// Aggregates are visible to both; the per-enquiry table and the internal price guide are designer-only.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge, Collapsible, Empty, Kpi, PageHeader, Panel, statusTone } from '../ui';
import { DistributionList } from '../charts';
import type { ViewCtx } from '../types';
import { RATE_CARD } from '@/lib/config';
import { formatInr, formatLakhCr, formatRange, pct, titleCase } from '@/lib/format';
import type { PricingRow } from '@/lib/metrics';
import { href } from '@/lib/url';
import type { BudgetFlag } from '@/lib/types';
import type { Tone } from '../ui';

const ROW_LIMIT = 12;

const FLAGS: { key: BudgetFlag; label: string; tone: Tone }[] = [
  { key: 'within_range', label: 'Within our usual range', tone: 'ok' },
  { key: 'below_range', label: 'Below our usual range', tone: 'warn' },
  { key: 'below_minimum', label: 'Far below our usual range', tone: 'crit' },
  { key: 'above_range', label: 'Above our usual range', tone: 'info' },
  { key: 'not_stated', label: 'Not mentioned', tone: 'neutral' },
];

export function PricingEconomics({ ctx }: { ctx: ViewCtx }) {
  const { m, role } = ctx;
  const { money, pricing: p } = m;
  const isDesigner = role === 'designer';
  const showAll = ctx.sp.all === '1';

  const known = new Set<string>(FLAGS.map((f) => f.key));
  const extra = Object.entries(p.flagCounts).filter(([k]) => !known.has(k));
  const flagItems = [
    ...FLAGS.map((f) => ({ label: f.label, n: p.flagCounts[f.key] ?? 0, tone: f.tone })),
    ...extra.map(([k, n]) => ({ label: titleCase(k), n, tone: 'neutral' as Tone })),
  ];
  const flagTotal = flagItems.reduce((a, f) => a + f.n, 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href={href(ctx.sp, { view: 'overview', enquiry: null, all: null })} className="btn-ghost -ml-3 mb-2">← Results</Link>
        <PageHeader title="Money & costs" subtitle="Internal estimates only — prices are never quoted to clients." />
      </div>

      {/* ---------------------------------------------------------------- headline numbers */}
      <section aria-label="Headline numbers" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          hot
          label="Pipeline value"
          value={money.pipelineCount > 0 ? formatLakhCr(money.pipelineInr) : '—'}
          sub={money.pipelineCount > 0 ? `${money.pipelineCount} live ${money.pipelineCount === 1 ? 'lead' : 'leads'}, internal estimate` : 'No estimates yet'}
        />
        <Kpi
          label="Won so far"
          value={money.wonCount > 0 ? formatLakhCr(money.wonInr) : '—'}
          tone={money.wonCount > 0 ? 'ok' : 'neutral'}
          sub={money.wonCount > 0 ? `${money.wonCount} ${money.wonCount === 1 ? 'project' : 'projects'} signed` : 'No wins logged yet'}
        />
        <Kpi
          label="Cost to run this system"
          value={formatInr(money.totalCostInr)}
          sub={`AI ${formatInr(money.aiVariableCostInr)} plus tools ${formatInr(money.fixedCostInr)}`}
        />
        <Kpi
          label="Cost per enquiry"
          value={formatInr(money.costPerEnquiryInr)}
          sub={m.volume.total > 0 ? `Across ${m.volume.total} ${m.volume.total === 1 ? 'enquiry' : 'enquiries'}` : 'No enquiries yet'}
        />
      </section>

      {/* ---------------------------------------------------------------- details, closed by default */}
      <div className="space-y-3">
        <Collapsible title="What it costs to run">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse">
              <thead>
                <tr>
                  <th scope="col" className="th pl-0">Cost</th>
                  <th scope="col" className="th">Provider</th>
                  <th scope="col" className="th pr-0 text-right">This month</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row" className="td pl-0 text-left font-normal">AI usage <span className="block text-mute">Grows with each recording</span></th>
                  <td className="td text-mute">Gemini</td>
                  <td className="td pr-0 text-right tabular-nums">{formatInr(money.aiVariableCostInr)}</td>
                </tr>
                {money.costLines.map((l, i) => (
                  <tr key={`${l.category}-${i}`}>
                    <th scope="row" className="td pl-0 text-left font-normal">
                      {titleCase(l.category)}
                      {l.note && <span className="block text-mute">{l.note}</span>}
                    </th>
                    <td className="td text-mute">{l.vendor ?? '—'}</td>
                    <td className="td pr-0 text-right tabular-nums">
                      {l.amount === 0 && <span className="mr-2"><Badge tone="warn">Placeholder</Badge></span>}
                      {formatInr(l.amount)}
                    </td>
                  </tr>
                ))}
                {money.costLines.length === 0 && (
                  <tr><td colSpan={3} className="td pl-0 text-mute">No tool subscriptions recorded for this month.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2} className="px-3 py-3 pl-0 text-left text-sm font-semibold">Total</th>
                  <td className="px-3 py-3 pr-0 text-right text-base font-semibold tabular-nums">{formatInr(money.totalCostInr)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-3 text-sm text-mute">
            Rows showing ₹0 are placeholders. Replace them with real invoice amounts before relying on any figure above.
          </p>
          {money.pipelineMultiple !== null && (
            <p className="mt-2 text-sm text-mute">
              Right now the pipeline is worth about ₹{money.pipelineMultiple >= 100 ? Math.round(money.pipelineMultiple) : money.pipelineMultiple.toFixed(1)} for every ₹1 spent running the system.
            </p>
          )}
        </Collapsible>

        <Collapsible title="Budgets people mentioned">
          <DistributionList items={flagItems} total={flagTotal} scale="max" empty="No enquiries have been priced this month." />
          <p className="mt-4 text-sm text-mute">
            We never ask a client for a budget. If one is mentioned and it is below our usual range, it is flagged so it doesn&apos;t become the anchor for the final price.
          </p>
          {p.avgFinalVsIndicativeLow !== null && (
            <p className="mt-2 text-sm">
              Signed projects land at {p.avgFinalVsIndicativeLow.toFixed(2)} times our first estimate on average
              {p.avgFinalVsIndicativeLow !== 1 && ` (${pct(Math.abs(p.avgFinalVsIndicativeLow - 1))} ${p.avgFinalVsIndicativeLow > 1 ? 'higher' : 'lower'})`}.
            </p>
          )}
        </Collapsible>

        {isDesigner && (
          <Collapsible title="Estimates per enquiry" hint="Designers only" defaultOpen={showAll}>
            <EstimateTable rows={p.rows} ctx={ctx} showAll={showAll} />
          </Collapsible>
        )}

        {isDesigner && (
          <Collapsible title="Internal price guide" hint="Designers only">
            <PriceGuide />
          </Collapsible>
        )}
      </div>
    </div>
  );
}

// ---- designer-only pieces -------------------------------------------------------------------------

function EstimateTable({ rows, ctx, showAll }: { rows: PricingRow[]; ctx: ViewCtx; showAll: boolean }) {
  if (rows.length === 0) return <Empty>No enquiries have been priced this month.</Empty>;
  // Biggest estimates first.
  const sorted = [...rows].sort((a, b) => (b.log.pipeline_estimate_inr ?? 0) - (a.log.pipeline_estimate_inr ?? 0));
  const shown = showAll ? sorted : sorted.slice(0, ROW_LIMIT);
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr>
              <th scope="col" className="th pl-0">Enquiry</th>
              <th scope="col" className="th">Project</th>
              <th scope="col" className="th">Internal estimate</th>
              <th scope="col" className="th">They mentioned</th>
              <th scope="col" className="th">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ enquiryId, log, enquiry }) => {
              const mentioned = log.budget_low_inr === null && log.budget_high_inr === null ? null : formatRange(log.budget_low_inr, log.budget_high_inr);
              const area = log.area_sqft ?? enquiry.area_sqft;
              const estimate = log.pipeline_estimate_inr !== null ? formatLakhCr(log.pipeline_estimate_inr) : formatRange(log.indicative_low_inr, log.indicative_high_inr);
              return (
                <tr key={log.id}>
                  <td className="td pl-0">
                    <Link href={href(ctx.sp, { view: 'queue', enquiry: enquiryId, all: null })} className="font-medium underline decoration-line-strong underline-offset-4 hover:decoration-accent">
                      {enquiry.client_name ?? enquiry.source_ref ?? enquiryId.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="td">
                    {titleCase(log.segment)}
                    <span className="block text-mute">{area ? `${area.toLocaleString('en-IN')} sq ft` : 'area not known'}</span>
                  </td>
                  <td className="td tabular-nums">{estimate}</td>
                  <td className="td tabular-nums">{mentioned ?? <span className="text-mute">—</span>}</td>
                  <td className="td"><Badge tone={statusTone(enquiry.status)}>{titleCase(enquiry.status)}</Badge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-mute">
        <span>
          Showing {shown.length} of {rows.length}, largest first. Internal only — never quote these.
        </span>
        {rows.length > ROW_LIMIT && (
          <Link href={showAll ? href(ctx.sp, { all: null }) : href(ctx.sp, { all: '1' })} className="btn-ghost">
            {showAll ? 'Show fewer' : 'Show all'}
          </Link>
        )}
      </div>
    </div>
  );
}

function PriceGuide() {
  const perSqft = (r: { low: number; high: number }) => `${formatInr(r.low)} – ${formatInr(r.high)} per sq ft`;
  const groups: { title: string; rows: { label: string; value: ReactNode }[] }[] = [
    { title: 'Homes', rows: (['standard', 'premium', 'luxury'] as const).map((k) => ({ label: titleCase(k), value: perSqft(RATE_CARD.residential[k]) })) },
    { title: 'Commercial', rows: (['basic', 'mid', 'premium'] as const).map((k) => ({ label: k === 'mid' ? 'Mid-range' : titleCase(k), value: perSqft(RATE_CARD.commercial[k]) })) },
    { title: 'Single room redesign', rows: [{ label: 'All-in', value: formatRange(RATE_CARD.singleRoom.low, RATE_CARD.singleRoom.high) }] },
  ];
  return (
    <div>
      <div className="grid gap-4 md:grid-cols-3">
        {groups.map((g) => (
          <Panel key={g.title} title={g.title}>
            <dl className="divide-y divide-line text-sm">
              {g.rows.map((r) => (
                <div key={r.label} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <dt className="text-mute">{r.label}</dt>
                  <dd className="text-right tabular-nums">{r.value}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        ))}
      </div>
      <p className="mt-3 text-sm text-mute">Internal. Based on the carpet area of the space being designed. Never quote to a client.</p>
    </div>
  );
}
