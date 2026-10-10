// Business rules and thresholds.
//
// Sources of truth (supplied by Aangan):
//   services.md   — what Aangan does / doesn't do, service area, timelines
//   qualified.md  — Nikhil's five-criteria qualification rubric
//   pricing.md    — INTERNAL indicative rates. Never quoted to a client.
//
// Values marked ASSUMPTION are not in those documents; they are env-tunable
// and should be confirmed with Nikhil.

const num = (v: string | undefined, fallback: number): number => {
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const GUARDRAILS = {
  /** Brief spec: below 85% transcription confidence → escalate instead of briefing a designer. */
  confidenceMin: num(process.env.CONFIDENCE_THRESHOLD, 0.85),
  /** Each [inaudible] / [uncertain] marker costs this much confidence (capped). ASSUMPTION */
  inaudiblePenalty: 0.03,
  inaudiblePenaltyCap: 0.15,

  /** Timeline (services.md: can't start execution in < 6 weeks; qualified.md: 8–10 weeks is the target). */
  timelineFailWeeks: num(process.env.TIMELINE_FAIL_WEEKS, 6),
  timelineUnclearWeeks: num(process.env.TIMELINE_UNCLEAR_WEEKS, 8),

  /** Budget is "clearly below" when the top of the volunteered range is below this share of the
   *  cheapest plausible cost for the scope (qualified.md example: ₹1–1.5L for a full flat). ASSUMPTION */
  budgetClearlyBelowRatio: num(process.env.BUDGET_CLEARLY_BELOW_RATIO, 0.5),

  /** "High-value fringe": a lead that fails only a practical criterion (area / timeline) is sent to
   *  human review instead of being declined if it looks this valuable. ASSUMPTION */
  highValueBudgetInr: num(process.env.HIGH_VALUE_BUDGET_INR, 1_500_000),
  highValueAreaSqft: num(process.env.HIGH_VALUE_AREA_SQFT, 2_000),

  /** Share of auto-declines that are sampled into human review so false negatives stay measurable. ASSUMPTION */
  auditSampleRate: num(process.env.AUDIT_SAMPLE_RATE, 0.1),

  /** SLA: a still-active lead with no response for this long raises a service-recovery escalation. */
  slaBreachHours: num(process.env.SLA_BREACH_HOURS, 24),
  /** Brief spec: "<1 hour" is the response target that converts best. */
  fastResponseMinutes: 60,

  /** An enquiry this size is flagged "large project" so Nikhil sees it (informational, not blocking). ASSUMPTION */
  largeProjectAreaSqft: 2_000,
  largeProjectValueInr: num(process.env.LARGE_PROJECT_VALUE_INR, 4_000_000),
} as const;

/** Front desk hours (qualified.md / enquiry export: 10am–7pm). Mon–Sat. ASSUMPTION on Saturday. */
export const BUSINESS_HOURS = {
  tz: 'Asia/Kolkata',
  openHour: 10,
  closeHour: 19,
  openDays: [1, 2, 3, 4, 5, 6], // Mon..Sat (0 = Sun)
} as const;

export const SERVICE_AREA = {
  served: [
    'pune', 'kothrud', 'baner', 'aundh', 'wakad', 'koregaon park', 'kalyani nagar', 'viman nagar',
    'hadapsar', 'magarpatta', 'nibm', 'kondhwa', 'undri', 'shivane', 'warje', 'erandwane', 'deccan',
    'pcmc', 'pimpri', 'chinchwad', 'pimple saudagar', 'pimple nilakh', 'ravet', 'hinjewadi',
    'kharadi', 'nanded city', 'bavdhan', 'balewadi', 'sunderban',
  ],
  notServed: ['talegaon', 'lonavala', 'nashik', 'mumbai', 'thane', 'bangalore', 'bengaluru', 'hyderabad', 'delhi', 'nagpur', 'kolhapur'],
} as const;

export const SCOPE_RULES = {
  /** services.md: commercial "up to approximately 3,000 sq ft". */
  maxCommercialSqft: 3_000,
  /** Front desk told a caller "typically 500 sq ft or more" (T18). ASSUMPTION — enforced softly. */
  minCommercialSqft: num(process.env.MIN_COMMERCIAL_SQFT, 500),
} as const;

/**
 * INTERNAL indicative rates (pricing.md). Carpet area of the designed space, ₹ per sq ft.
 * These feed pipeline-value estimates and the designer brief. They are NEVER shown to clients.
 */
export const RATE_CARD = {
  residential: {
    standard: { low: 1_800, high: 2_400 },
    premium: { low: 2_400, high: 3_500 },
    luxury: { low: 3_500, high: 4_500 }, // pricing.md says "₹3,500+"; upper bound is an ASSUMPTION for estimation only
  },
  commercial: {
    basic: { low: 1_200, high: 1_800 },
    mid: { low: 1_800, high: 2_800 },
    premium: { low: 2_800, high: 4_000 },
  },
  /** "Single room redesign (all-in): ₹3.5 lakh – ₹8 lakh". */
  singleRoom: { low: 350_000, high: 800_000 },
} as const;

/** The only acceptable answer to a pricing question (pricing.md). */
export const PRICING_DEFLECTION =
  'Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation. I can book that for you right now if you’d like.';

export const DECLINE_SCRIPT =
  'This sounds like it may not be the right fit for us right now — but feel free to reach out if your timeline or scope changes.';

export const DESIGNER_COUNT = 14; // 60 staff, 14 designers (brief)

/** Gemini. Cost figures are approximate list prices; override via env. */
export const GEMINI = {
  model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  inputUsdPerMTok: num(process.env.GEMINI_INPUT_USD_PER_MTOK, 0.3),
  audioInputUsdPerMTok: num(process.env.GEMINI_AUDIO_USD_PER_MTOK, 1.0),
  outputUsdPerMTok: num(process.env.GEMINI_OUTPUT_USD_PER_MTOK, 2.5),
  usdToInr: num(process.env.USD_TO_INR, 88),
} as const;
