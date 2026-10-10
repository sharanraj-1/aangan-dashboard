// Pricing guardrail module.
//
// IMPORTANT — how this differs from a "quote the range to the client" design:
// Aangan's pricing guide is explicit that NO number from it may ever be quoted to a client, and the only
// acceptable client-facing answer is a fixed deflection. So this module is INTERNAL ONLY:
//   • it produces an indicative range for the designer brief and pipeline-value totals,
//   • it detects budget misalignment / anchoring risk / custom work and raises escalations,
//   • it guarantees (by linting) that nothing client-facing contains a price.
// This also solves the anchoring dilemma at the root: the client never hears a number we could be held to.

import { GUARDRAILS, PRICING_DEFLECTION, RATE_CARD } from './config';
import type { BudgetFlag, CustomWorkFlag, Extraction, PricingSegment } from './types';

export interface PricingEvaluation {
  segment: PricingSegment;
  areaSqft: number | null;
  rateLowPerSqft: number | null;
  rateHighPerSqft: number | null;
  indicativeLowInr: number | null;
  indicativeHighInr: number | null;
  /** Conservative single figure used for pipeline totals (standard / mid band). Internal. */
  pipelineEstimateInr: number | null;
  /** Cheapest plausible cost for the stated scope; used to judge whether a volunteered budget is "clearly below". */
  floorCostInr: number | null;
  budgetLowInr: number | null;
  budgetHighInr: number | null;
  budgetFlag: BudgetFlag;
  /** The client's number sits below our indicative band — don't let it become the anchor. */
  anchorRisk: boolean;
  customWorkFlags: CustomWorkFlag[];
  requiresReview: boolean;
  reviewReasons: string[];
  /** Always the fixed deflection. Contains no numbers. */
  clientFacingResponse: string;
}

type PricingInput = Pick<
  Extraction,
  'project_type' | 'scope_type' | 'area_sqft' | 'budget_low_inr' | 'budget_high_inr' | 'custom_work_flags'
>;

const roundTo = (n: number, step: number) => Math.round(n / step) * step;

export function evaluatePricing(x: PricingInput): PricingEvaluation {
  const area = x.area_sqft && x.area_sqft > 0 ? x.area_sqft : null;
  const commercial = x.project_type === 'commercial' || x.scope_type === 'office';

  let segment: PricingSegment = 'unknown';
  let rateLow: number | null = null;
  let rateHigh: number | null = null;
  let indLow: number | null = null;
  let indHigh: number | null = null;
  let pipeline: number | null = null;
  let floor: number | null = null;

  if (x.scope_type === 'single_room') {
    segment = 'single_room';
    indLow = RATE_CARD.singleRoom.low;
    indHigh = RATE_CARD.singleRoom.high;
    pipeline = Math.round((indLow + indHigh) / 2);
    floor = RATE_CARD.singleRoom.low;
  } else if (x.scope_type === 'partial_home') {
    // Designed area is unknown for partial scopes (area_sqft is the whole flat), so price by room count.
    // We assume 2 rooms — the minimum a "partial home" scope can be (services.md).
    segment = 'residential';
    indLow = RATE_CARD.singleRoom.low * 2;
    indHigh = RATE_CARD.singleRoom.high * 2;
    pipeline = Math.round((indLow + indHigh) / 2);
    floor = indLow;
  } else if (commercial) {
    segment = 'commercial';
    rateLow = RATE_CARD.commercial.basic.low;
    rateHigh = RATE_CARD.commercial.premium.high;
    if (area) {
      indLow = roundTo(area * rateLow, 10_000);
      indHigh = roundTo(area * rateHigh, 10_000);
      const mid = RATE_CARD.commercial.mid;
      pipeline = roundTo(area * ((mid.low + mid.high) / 2), 10_000);
      floor = indLow;
    }
  } else if (x.project_type === 'residential' || x.scope_type === 'full_home') {
    segment = 'residential';
    rateLow = RATE_CARD.residential.standard.low;
    rateHigh = RATE_CARD.residential.premium.high;
    if (area) {
      indLow = roundTo(area * rateLow, 10_000);
      indHigh = roundTo(area * rateHigh, 10_000);
      const std = RATE_CARD.residential.standard;
      pipeline = roundTo(area * ((std.low + std.high) / 2), 10_000);
      floor = indLow;
    }
  }

  const flags = x.custom_work_flags ?? [];
  const bLow = x.budget_low_inr ?? x.budget_high_inr ?? null;
  const bHigh = x.budget_high_inr ?? x.budget_low_inr ?? null;

  let budgetFlag: BudgetFlag = 'not_stated';
  let anchorRisk = false;
  if (bLow !== null && bHigh !== null) {
    if (floor !== null && bHigh < floor * GUARDRAILS.budgetClearlyBelowRatio) {
      budgetFlag = 'below_minimum';
      anchorRisk = true;
    } else if (indLow !== null && bHigh < indLow) {
      budgetFlag = 'below_range';
      anchorRisk = true;
    } else if (indHigh !== null && bLow > indHigh) {
      budgetFlag = 'above_range';
    } else if (indLow !== null) {
      budgetFlag = 'within_range';
    }
  }

  const reviewReasons: string[] = [];
  if (budgetFlag === 'below_minimum') {
    reviewReasons.push('Volunteered budget is clearly below the cheapest plausible cost for this scope.');
  }
  const reviewFlags = flags.filter((f) => f === 'structural_work' || f === 'luxury_spec' || f === 'home_automation');
  if (reviewFlags.length) {
    reviewReasons.push(`Custom / complex work outside the standard offering: ${reviewFlags.join(', ').replace(/_/g, ' ')}.`);
  }

  return {
    segment,
    areaSqft: area,
    rateLowPerSqft: rateLow,
    rateHighPerSqft: rateHigh,
    indicativeLowInr: indLow,
    indicativeHighInr: indHigh,
    pipelineEstimateInr: pipeline,
    floorCostInr: floor,
    budgetLowInr: bLow,
    budgetHighInr: bHigh,
    budgetFlag,
    anchorRisk,
    customWorkFlags: [...flags],
    requiresReview: reviewReasons.length > 0,
    reviewReasons,
    clientFacingResponse: PRICING_DEFLECTION,
  };
}

// ---------------------------------------------------------------------------------------------
// Client-facing text linter. Anything that could be read or sent to a prospect must pass this.
// ---------------------------------------------------------------------------------------------

const PRICE_PATTERNS: RegExp[] = [
  /₹|\brs\.?\s*\d|\binr\b/i,
  /\b(lakh|lakhs|lac|lacs|crore|crores|cr)\b/i,
  /\bper\s*(sq\.?\s*ft|square\s*f)/i,
  /\/\s*(sq\.?\s*ft|sqft)/i,
  /\b\d[\d,.]*\s*(k|l)\b/i,
  /\b(starts?|starting)\s+(at|from)\b/i,
  /\b(it'?ll|it will|would|will|should)\s+(cost|be around)\b/i,
  /\b(ballpark|rough(ly)?\s+(range|figure|number))\b/i,
  /\btypically\s+(it'?s|costs?|runs?)\b/i,
];

export function containsPriceDisclosure(text: string): boolean {
  return PRICE_PATTERNS.some((p) => p.test(text));
}

/** Questions to a prospect must never probe the budget (qualified.md: "Don't quote. Don't probe."). */
const BUDGET_PROBE = /\b(budget|cost|price|pricing|how much|afford|spend|invest|rate|rates|quote)\b/i;
export function isBudgetProbe(text: string): boolean {
  return BUDGET_PROBE.test(text);
}

// Staff / voice-agent lines look like "Front Desk: …", "Agent: …" or "4 Sept, 11:47am — Front Desk: …".
const AGENT_LABEL = /(?:^|—\s*)(front desk|agent|assistant|ai agent|vaani|vani|aangan)\b[^:\n]*:/i;
const NUMBER_TOKEN = /\d[\d,.]*/g;

/**
 * Policy check for the studio's OWN side of a conversation (human front desk or the voice agent): pricing.md says
 * the agent must never state a number, range or per-sq-ft figure. Repeating a figure the CALLER just said is
 * allowed (qualified.md: a clearly-too-low volunteered budget is addressed on the call), so lines whose figures all
 * appear in the caller's own words are not flagged. Returns the offending lines.
 */
export function findAgentPriceDisclosures(transcript: string): string[] {
  const lines = transcript.split(/\r?\n/);
  const callerNumbers = new Set<string>();
  for (const l of lines) {
    if (AGENT_LABEL.test(l)) continue;
    for (const n of l.match(NUMBER_TOKEN) ?? []) callerNumbers.add(n.replace(/[.,]+$/, ''));
  }
  const offenders: string[] = [];
  for (const l of lines) {
    if (!AGENT_LABEL.test(l) || !containsPriceDisclosure(l)) continue;
    const nums = (l.match(NUMBER_TOKEN) ?? []).map((n) => n.replace(/[.,]+$/, ''));
    const echoOnly = nums.length > 0 && nums.every((n) => callerNumbers.has(n));
    if (!echoOnly) offenders.push(l.trim().slice(0, 240));
  }
  return offenders;
}

/** Returns the text if it is safe to show a client, else the fallback. */
export function sanitizeClientText(text: string | null | undefined, fallback: string | null = null): string | null {
  if (!text) return fallback;
  if (containsPriceDisclosure(text) || isBudgetProbe(text)) return fallback;
  return text;
}
