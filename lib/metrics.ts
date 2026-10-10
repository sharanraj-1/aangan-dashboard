// Founder / dashboard metrics. Pure functions over a Dataset — they replace the manual monthly pulls.
// Everything here is an aggregate over outcome-level columns, so the same numbers are safe to show the founder
// (who gets a redacted dataset — see lib/store.ts) and the designers.

import { GUARDRAILS } from './config';
import { classifyOverride } from './guardrails';
import type { Channel, ConsultationRow, Dataset, EnquiryRow, EscalationRow, PricingLogRow } from './types';

const IST = 'Asia/Kolkata';
const monthFmt = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' });

export const monthKey = (iso: string | Date): string => monthFmt.format(new Date(iso)).slice(0, 7);
export const dayKey = (iso: string | Date): string => dayFmt.format(new Date(iso));

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** "2026-09" → "Sep ’26" */
export function shortMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' })} ’${String(y).slice(2)}`;
}

export function availableMonths(ds: Dataset): string[] {
  return [...new Set(ds.enquiries.map((e) => monthKey(e.received_at)))].sort().reverse();
}

const minutesBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 60_000;
function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}
const median = (v: number[]) => percentile(v, 0.5);
const sum = (v: (number | null | undefined)[]) => v.reduce<number>((a, b) => a + (b ?? 0), 0);
const rate = (n: number, d: number): number | null => (d > 0 ? n / d : null);

/** Decision that counts: a human's final call overrides the AI's. */
export const effectiveQualification = (e: EnquiryRow): 'qualified' | 'unqualified' | 'review' | 'not_applicable' =>
  e.final_qualification ?? e.ai_qualification;

export const BUCKETS = [
  { key: 'lt1h', label: 'Under 1 hour', max: 60 },
  { key: '1to4h', label: '1 – 4 hours', max: 240 },
  { key: '4to24h', label: '4 – 24 hours', max: 1440 },
  { key: '24to48h', label: '24 – 48 hours', max: 2880 },
  { key: 'gt48h', label: 'Over 48 hours', max: Infinity },
] as const;
export type BucketKey = (typeof BUCKETS)[number]['key'];

export interface BucketStat {
  key: BucketKey;
  label: string;
  n: number;
  won: number;
  lost: number;
  /** won / (won + lost); null until outcomes are logged. */
  conversion: number | null;
  resolved: number;
}

export interface Metrics {
  month: string;
  monthLabel: string;
  hasData: boolean;
  syntheticCount: number;

  volume: {
    total: number;
    byChannel: Record<Channel, { n: number; share: number }>;
    daily: { day: string; phone: number; whatsapp: number; web_form: number; total: number }[];
    afterHours: number;
    afterHoursShare: number | null;
    missedCalls: number;
    droppedCalls: number;
  };

  response: {
    buckets: BucketStat[];
    recorded: number;
    notRecorded: number;
    withinHourShare: number | null;
    over48hShare: number | null;
    medianMinutes: number | null;
    medianByChannel: Record<Channel, number | null>;
    medianInHours: number | null;
    medianAfterHours: number | null;
    awaiting: number; // no response yet on an active lead
    conversionLift: number | null; // <1h conversion ÷ >48h conversion (null until both have outcomes)
  };

  qualification: {
    counts: { qualified: number; unqualified: number; review: number; not_applicable: number };
    qualifiedRate: number | null;
    awaitingReview: number;
    falsePositives: number;
    falseNegatives: number;
    grayRescued: number;
    grayDeclined: number;
    confirmed: number;
    fpRate: number | null; // false positives ÷ AI-qualified
    fnAudited: number;
    fnRate: number | null; // false negatives ÷ audited AI-declines
    estMissedGoodLeads: number | null;
    auditsOpen: number;
    gateTrips: number;
    avgConfidence: number | null;
  };

  handoff: {
    sent: number;
    accepted: number;
    declined: number;
    reasked: number;
    pendingRelease: number; // qualified, not yet sent
    successRate: number | null; // accepted without a re-ask ÷ sent
    reaskRate: number | null;
    medianAcceptMinutes: number | null;
  };

  escalations: {
    open: number;
    acknowledged: number;
    resolved: number;
    created: number;
    byKind: Record<string, number>;
    byTrigger: Record<string, number>;
    openByOwner: Record<string, number>;
    openOver24h: number;
    oldestOpenMinutes: number | null;
    medianResolutionMinutes: number | null;
    p90ResolutionMinutes: number | null;
    resolutionMix: Record<string, number>;
    policyBreaches: number;
  };

  calendar: {
    scheduled: number;
    completed: number;
    cancelled: number;
    noShow: number;
    upcoming7d: number;
    awaitingOutcome: number;
    bookingRate: number | null; // enquiries with a booking ÷ qualified
  };

  money: {
    pipelineInr: number;
    pipelineCount: number;
    wonInr: number;
    wonCount: number;
    lostCount: number;
    avgProjectInr: number | null;
    avgProjectBasis: 'won' | 'estimate' | null;
    winRate: number | null;
    aiVariableCostInr: number;
    fixedCostInr: number;
    totalCostInr: number;
    costPerEnquiryInr: number | null;
    costPerQualifiedInr: number | null;
    pipelineMultiple: number | null; // pipeline ÷ cost
    wonMultiple: number | null; // won ÷ cost
    costLines: { category: string; vendor: string | null; amount: number; note: string | null }[];
  };

  pricing: {
    flagCounts: Record<string, number>;
    statedBudgetCount: number;
    anchorRisk: number;
    requiresReview: number;
    formalEstimates: number;
    avgFinalVsIndicativeLow: number | null; // won deals: final ÷ indicative low (shows anchoring drift)
    rows: PricingRow[];
  };

  funnel: { label: string; n: number }[];
  hubspot: { synced: number; errors: number };
}

export interface PricingRow {
  enquiryId: string;
  log: PricingLogRow;
  enquiry: EnquiryRow;
}

// ------------------------------------------------------------------------------------------------

export function computeMetrics(ds: Dataset, month: string, opts: { includeSynthetic?: boolean; now?: Date } = {}): Metrics {
  const now = opts.now ?? new Date();
  const inc = opts.includeSynthetic !== false;
  const all = ds.enquiries.filter((e) => inc || !e.is_synthetic);
  const E = all.filter((e) => monthKey(e.received_at) === month);
  const ids = new Set(E.map((e) => e.id));
  const byId = new Map(all.map((e) => [e.id, e]));

  // ---------------------------------------------------------------- volume
  const channels: Channel[] = ['phone', 'whatsapp', 'web_form'];
  const chCount = Object.fromEntries(channels.map((c) => [c, E.filter((e) => e.channel === c).length])) as Record<Channel, number>;
  const byChannel = Object.fromEntries(channels.map((c) => [c, { n: chCount[c], share: E.length ? chCount[c] / E.length : 0 }])) as Metrics['volume']['byChannel'];
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const daily = Array.from({ length: daysInMonth }, (_, i) => {
    const day = `${month}-${String(i + 1).padStart(2, '0')}`;
    const rows = E.filter((e) => dayKey(e.received_at) === day);
    return { day, phone: rows.filter((r) => r.channel === 'phone').length, whatsapp: rows.filter((r) => r.channel === 'whatsapp').length, web_form: rows.filter((r) => r.channel === 'web_form').length, total: rows.length };
  });
  const afterHours = E.filter((e) => e.after_hours).length;

  // ---------------------------------------------------------------- response time
  const active = (e: EnquiryRow) => e.ai_qualification !== 'unqualified' && e.ai_qualification !== 'not_applicable' && e.status !== 'lost' && e.status !== 'closed';
  const timed = E.filter((e) => e.first_response_at).map((e) => ({ e, min: Math.max(0, minutesBetween(e.received_at, e.first_response_at!)) }));
  const buckets: BucketStat[] = BUCKETS.map((b, i) => {
    const lo = i === 0 ? -1 : BUCKETS[i - 1].max;
    const rows = timed.filter((t) => t.min > lo && t.min <= b.max || (i === 0 && t.min <= b.max));
    const won = rows.filter((t) => t.e.status === 'won').length;
    const lost = rows.filter((t) => t.e.status === 'lost').length;
    return { key: b.key, label: b.label, n: rows.length, won, lost, resolved: won + lost, conversion: rate(won, won + lost) };
  });
  const medianBy = (rows: typeof timed) => median(rows.map((t) => t.min));
  const lt1 = buckets[0], gt48 = buckets[4];
  const conversionLift = lt1.conversion !== null && gt48.conversion !== null && gt48.conversion > 0 ? lt1.conversion / gt48.conversion : null;

  // ---------------------------------------------------------------- qualification
  const counts = { qualified: 0, unqualified: 0, review: 0, not_applicable: 0 };
  for (const e of E) counts[e.ai_qualification]++;
  const leads = E.length - counts.not_applicable;
  const classes = E.map((e) => classifyOverride(e));
  const cnt = (k: string) => classes.filter((c) => c === k).length;
  const fp = cnt('false_positive'), fn = cnt('false_negative');
  // Audited AI-declines = declines that a human actually looked at (via audit sample or manual rescue / confirmation).
  const auditedDeclines = E.filter((e) => e.ai_qualification === 'unqualified' && e.final_qualification !== null);
  const fnRate = rate(fn, auditedDeclines.length);
  const unqualifiedUnreviewed = E.filter((e) => e.ai_qualification === 'unqualified' && e.final_qualification === null).length;

  const escE = ds.escalations.filter((x) => ids.has(x.enquiry_id));
  const conf = E.map((e) => e.composite_confidence).filter((v): v is number => v !== null);

  // ---------------------------------------------------------------- handoff
  const sentRows = E.filter((e) => e.handoff_status !== 'not_sent');
  const accepted = sentRows.filter((e) => e.handoff_status === 'accepted');
  const reasked = sentRows.filter((e) => e.designer_reasked);
  const acceptLat = accepted.filter((e) => e.handoff_sent_at && e.handoff_accepted_at).map((e) => minutesBetween(e.handoff_sent_at!, e.handoff_accepted_at!));
  const pendingRelease = E.filter((e) => effectiveQualification(e) === 'qualified' && e.handoff_status === 'not_sent' && e.status !== 'escalated' && e.status !== 'lost' && e.status !== 'closed').length;

  // ---------------------------------------------------------------- escalations (open ones are global, not month-scoped)
  const allEsc = ds.escalations.filter((x) => byId.has(x.enquiry_id));
  const openEsc = allEsc.filter((x) => x.status !== 'resolved');
  const resolvedEsc = escE.filter((x) => x.status === 'resolved' && x.resolved_at);
  const resMin = resolvedEsc.map((x) => minutesBetween(x.created_at, x.resolved_at!));
  const tally = (rows: EscalationRow[], f: (x: EscalationRow) => string) => rows.reduce<Record<string, number>>((a, x) => ((a[f(x)] = (a[f(x)] ?? 0) + 1), a), {});

  // ---------------------------------------------------------------- calendar
  const consults = ds.consultations.filter((c) => byId.has(c.enquiry_id));
  const cMonth = consults.filter((c) => monthKey(c.starts_at) === month);
  const in7 = new Date(now.getTime() + 7 * 24 * 3_600_000);
  const bookedEnq = new Set(consults.filter((c) => c.status !== 'cancelled' && ids.has(c.enquiry_id)).map((c) => c.enquiry_id));
  const qualifiedEnq = E.filter((e) => effectiveQualification(e) === 'qualified');

  // ---------------------------------------------------------------- money
  const qualifiedLive = E.filter((e) => effectiveQualification(e) === 'qualified' && e.status !== 'won' && e.status !== 'lost' && e.status !== 'closed');
  const won = E.filter((e) => e.status === 'won');
  const lost = E.filter((e) => e.status === 'lost');
  const aiCost = ds.transcriptCosts.filter((t) => ids.has(t.enquiry_id)).reduce((a, t) => a + Number(t.ai_cost_inr), 0);
  const fixedLines = ds.toolCosts.filter((t) => monthKey(t.month + 'T12:00:00+05:30') === month);
  const fixed = sum(fixedLines.map((l) => Number(l.amount_inr)));
  const totalCost = aiCost + fixed;
  const pipelineInr = sum(qualifiedLive.map((e) => e.estimated_value_inr));
  const wonInr = sum(won.map((e) => e.final_value_inr));
  const estVals = E.filter((e) => effectiveQualification(e) === 'qualified' && e.estimated_value_inr).map((e) => e.estimated_value_inr!);
  const avgProject = won.length ? { v: wonInr / won.length, b: 'won' as const } : estVals.length ? { v: sum(estVals) / estVals.length, b: 'estimate' as const } : null;

  // ---------------------------------------------------------------- pricing
  const logs = ds.pricingLogs.filter((p) => ids.has(p.enquiry_id));
  const flagCounts = logs.reduce<Record<string, number>>((a, p) => ((a[p.budget_flag] = (a[p.budget_flag] ?? 0) + 1), a), {});
  const drift = logs
    .map((p) => ({ p, e: byId.get(p.enquiry_id)! }))
    .filter(({ p, e }) => e.status === 'won' && e.final_value_inr && p.indicative_low_inr)
    .map(({ p, e }) => e.final_value_inr! / p.indicative_low_inr!);

  const funnel = [
    { label: 'Enquiries', n: E.length },
    { label: 'Real leads', n: leads },
    { label: 'Qualified', n: qualifiedEnq.length },
    { label: 'Handed to designer', n: E.filter((e) => e.handoff_status !== 'not_sent').length },
    { label: 'Consultation booked', n: bookedEnq.size },
    { label: 'Won', n: won.length },
  ];

  return {
    month,
    monthLabel: monthLabel(month),
    hasData: E.length > 0,
    syntheticCount: E.filter((e) => e.is_synthetic).length,
    volume: {
      total: E.length, byChannel, daily, afterHours, afterHoursShare: rate(afterHours, E.length),
      missedCalls: E.filter((e) => e.call_outcome === 'missed').length, droppedCalls: E.filter((e) => e.call_outcome === 'dropped').length,
    },
    response: {
      buckets, recorded: timed.length, notRecorded: E.length - timed.length,
      withinHourShare: rate(timed.filter((t) => t.min <= GUARDRAILS.fastResponseMinutes).length, timed.length),
      over48hShare: rate(timed.filter((t) => t.min > 2880).length, timed.length),
      medianMinutes: medianBy(timed),
      medianByChannel: Object.fromEntries(channels.map((c) => [c, medianBy(timed.filter((t) => t.e.channel === c))])) as Record<Channel, number | null>,
      medianInHours: medianBy(timed.filter((t) => !t.e.after_hours)),
      medianAfterHours: medianBy(timed.filter((t) => t.e.after_hours)),
      awaiting: E.filter((e) => !e.first_response_at && active(e)).length,
      conversionLift,
    },
    qualification: {
      counts, qualifiedRate: rate(counts.qualified, leads),
      awaitingReview: E.filter((e) => e.ai_qualification === 'review' && e.final_qualification === null && e.status !== 'lost' && e.status !== 'closed').length,
      falsePositives: fp, falseNegatives: fn, grayRescued: cnt('gray_to_qualified'), grayDeclined: cnt('gray_to_unqualified'), confirmed: cnt('confirmed'),
      fpRate: rate(fp, counts.qualified), fnAudited: auditedDeclines.length, fnRate,
      estMissedGoodLeads: fnRate !== null ? Math.round(fnRate * (unqualifiedUnreviewed + auditedDeclines.length)) : null,
      auditsOpen: allEsc.filter((x) => x.trigger === 'audit_sample' && x.status !== 'resolved').length,
      gateTrips: escE.filter((x) => x.kind === 'transcription').length,
      avgConfidence: conf.length ? sum(conf) / conf.length : null,
    },
    handoff: {
      sent: sentRows.length, accepted: accepted.length, declined: sentRows.filter((e) => e.handoff_status === 'declined').length,
      reasked: reasked.length, pendingRelease,
      successRate: rate(accepted.filter((e) => !e.designer_reasked).length, sentRows.length), reaskRate: rate(reasked.length, sentRows.length),
      medianAcceptMinutes: median(acceptLat),
    },
    escalations: {
      open: openEsc.filter((x) => x.status === 'open').length,
      acknowledged: openEsc.filter((x) => x.status === 'acknowledged').length,
      resolved: resolvedEsc.length,
      created: escE.length,
      byKind: tally(escE, (x) => x.kind),
      byTrigger: tally(escE, (x) => x.trigger),
      openByOwner: tally(openEsc, (x) => x.assigned_to),
      openOver24h: openEsc.filter((x) => minutesBetween(x.created_at, now.toISOString()) > 1440).length,
      oldestOpenMinutes: openEsc.length ? Math.max(...openEsc.map((x) => minutesBetween(x.created_at, now.toISOString()))) : null,
      medianResolutionMinutes: median(resMin), p90ResolutionMinutes: percentile(resMin, 0.9),
      resolutionMix: tally(resolvedEsc, (x) => x.resolution ?? 'unknown'),
      policyBreaches: escE.filter((x) => x.trigger === 'agent_policy_breach').length,
    },
    calendar: {
      scheduled: cMonth.filter((c) => c.status === 'scheduled').length, completed: cMonth.filter((c) => c.status === 'completed').length,
      cancelled: cMonth.filter((c) => c.status === 'cancelled').length, noShow: cMonth.filter((c) => c.status === 'no_show').length,
      upcoming7d: consults.filter((c) => c.status === 'scheduled' && new Date(c.starts_at) >= now && new Date(c.starts_at) <= in7).length,
      awaitingOutcome: consults.filter((c) => c.status === 'scheduled' && new Date(c.ends_at) < now).length,
      bookingRate: rate(qualifiedEnq.filter((e) => bookedEnq.has(e.id)).length, qualifiedEnq.length),
    },
    money: {
      pipelineInr, pipelineCount: qualifiedLive.filter((e) => e.estimated_value_inr).length, wonInr, wonCount: won.length, lostCount: lost.length,
      avgProjectInr: avgProject?.v ?? null, avgProjectBasis: avgProject?.b ?? null, winRate: rate(won.length, won.length + lost.length),
      aiVariableCostInr: aiCost, fixedCostInr: fixed, totalCostInr: totalCost,
      costPerEnquiryInr: rate(totalCost, E.length), costPerQualifiedInr: rate(totalCost, qualifiedEnq.length),
      pipelineMultiple: totalCost > 0 && pipelineInr > 0 ? pipelineInr / totalCost : null, wonMultiple: totalCost > 0 && wonInr > 0 ? wonInr / totalCost : null,
      costLines: fixedLines.map((l) => ({ category: l.category, vendor: l.vendor, amount: Number(l.amount_inr), note: l.note })),
    },
    pricing: {
      flagCounts, statedBudgetCount: logs.filter((p) => p.budget_low_inr !== null).length,
      anchorRisk: logs.filter((p) => p.anchor_risk).length, requiresReview: logs.filter((p) => p.requires_review).length,
      formalEstimates: logs.filter((p) => p.formal_estimate_inr).length,
      avgFinalVsIndicativeLow: drift.length ? sum(drift) / drift.length : null,
      rows: logs.map((p) => ({ enquiryId: p.enquiry_id, log: p, enquiry: byId.get(p.enquiry_id)! })).filter((r) => r.enquiry),
    },
    funnel,
    hubspot: { synced: E.filter((e) => e.hubspot_synced_at).length, errors: E.filter((e) => e.hubspot_error).length },
  };
}

export type { ConsultationRow };
