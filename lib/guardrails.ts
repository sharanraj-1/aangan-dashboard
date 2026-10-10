// Guardrail / triage engine. Pure functions only — no I/O — so the exact same logic runs in the live
// ingest pipeline, in the seed script, and in scripts/test-guardrails.ts.
//
// Design principle (from the brief): a false NEGATIVE (good lead rejected) costs more than a false
// POSITIVE (designer time wasted). So nothing is declined silently when it is uncertain, valuable,
// or low-confidence — and a sample of clear declines is audited so we can *measure* false negatives.

import { BUSINESS_HOURS, GUARDRAILS, SCOPE_RULES, SERVICE_AREA } from './config';
import { evaluatePricing, findAgentPriceDisclosures, sanitizeClientText, type PricingEvaluation } from './pricing';
import type {
  AiQualification, AssignedTo, CallOutcome, Criteria, EnquiryRow, EscalationKind, EscalationTrigger,
  Extraction, Severity, Verdict,
} from './types';

// ---------------------------------------------------------------------------------------------
// Time helpers (IST)
// ---------------------------------------------------------------------------------------------

const istFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_HOURS.tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
});
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function istParts(d: Date): { day: number; hour: number; minute: number } {
  const parts = Object.fromEntries(istFmt.formatToParts(d).map((p) => [p.type, p.value]));
  return { day: WEEKDAY[parts.weekday] ?? 0, hour: Number(parts.hour) % 24, minute: Number(parts.minute) };
}

/** True when the front desk is NOT staffed (qualified.md: calls/messages outside 10am–7pm go unanswered). */
export function isAfterHours(d: Date): boolean {
  const { day, hour } = istParts(d);
  if (!(BUSINESS_HOURS.openDays as readonly number[]).includes(day)) return true;
  return hour < BUSINESS_HOURS.openHour || hour >= BUSINESS_HOURS.closeHour;
}

// ---------------------------------------------------------------------------------------------
// Confidence gate  (failure mode A)
// ---------------------------------------------------------------------------------------------

const INAUDIBLE_RE = /\[(?:inaudible|unclear|uncertain|crosstalk)[^\]]*\]/gi;

/**
 * Composite confidence = the model's own transcription/understanding confidence, minus a penalty for every
 * [inaudible]/[uncertain] marker in the text. NOTE: Gemini does not expose a calibrated STT confidence; the
 * model-reported number is a self-assessment, so the penalty and the field-level ambiguity checks keep the
 * gate from trusting it blindly. Calibrate GUARDRAILS.confidenceMin against real call samples.
 */
export function calculateConfidence(
  x: Pick<Extraction, 'transcription_confidence' | 'inaudible_count'>,
  transcriptText = '',
): number {
  const markers = Math.max(x.inaudible_count ?? 0, (transcriptText.match(INAUDIBLE_RE) ?? []).length);
  const penalty = Math.min(GUARDRAILS.inaudiblePenaltyCap, markers * GUARDRAILS.inaudiblePenalty);
  const base = Number.isFinite(x.transcription_confidence) ? x.transcription_confidence : 0;
  return Math.round(Math.max(0, Math.min(1, base - penalty)) * 1000) / 1000;
}

export type GateTrigger = 'low_confidence' | 'ambiguous_scope' | 'ambiguous_location' | 'ai_failure';

export interface GateResult {
  passed: boolean;
  confidence: number;
  triggers: GateTrigger[];
  reasons: string[];
}

const LEAD_INTENTS = new Set(['new_project', 'advice_only', 'pricing_only', 'follow_up_chase']);

/**
 * Confidence Gate. Fails when:
 *  - the AI step itself failed, or
 *  - composite confidence < threshold (default 85%) — applies to every enquiry, because a mis-heard decline is a
 *    potential false negative, or
 *  - a CORE parameter (scope / location) came through as *ambiguous* (garbled, contradictory) on a real lead.
 * A parameter that was simply never mentioned is not "ambiguous" — that is handled as a rubric clarification.
 */
export function evaluateGate(x: Extraction, transcriptText = ''): GateResult {
  const confidence = calculateConfidence(x, transcriptText);
  const triggers: GateTrigger[] = [];
  const reasons: string[] = [];

  if (x.ambiguity_flags.includes('ai_unavailable')) {
    triggers.push('ai_failure');
    reasons.push('AI processing failed — enquiry captured raw and needs manual triage.');
  }
  if (confidence < GUARDRAILS.confidenceMin) {
    triggers.push('low_confidence');
    reasons.push(
      `Transcription confidence ${(confidence * 100).toFixed(0)}% is below the ${(GUARDRAILS.confidenceMin * 100).toFixed(0)}% gate.`,
    );
  }
  if (LEAD_INTENTS.has(x.intent)) {
    if (x.scope_clarity === 'ambiguous') {
      triggers.push('ambiguous_scope');
      reasons.push('Project scope came through ambiguous (garbled or contradictory).');
    }
    if (x.location_clarity === 'ambiguous') {
      triggers.push('ambiguous_location');
      reasons.push('Project location came through ambiguous (garbled or contradictory).');
    }
  }
  return { passed: triggers.length === 0, confidence, triggers, reasons };
}

// ---------------------------------------------------------------------------------------------
// Rubric criteria  (qualified.md)
// ---------------------------------------------------------------------------------------------

export function classifyLocation(location: string | null): 'served' | 'not_served' | 'unknown' {
  if (!location) return 'unknown';
  const l = location.toLowerCase();
  if (SERVICE_AREA.notServed.some((p) => l.includes(p))) return 'not_served';
  if (SERVICE_AREA.served.some((p) => l.includes(p))) return 'served';
  return 'unknown';
}

export interface DerivedCriteria {
  criteria: Criteria;
  failReasons: string[];
  /** Set when the failure is a service-type exclusion (restaurant / hotel / retail / gym / oversize) — never overridden. */
  hardExclusion: boolean;
}

/**
 * The model proposes verdicts; hard facts (a named city, a number of weeks, a rupee figure) override it.
 * Deterministic rules beat model opinion wherever a number or a list can decide.
 */
export function deriveCriteria(x: Extraction, pricing: PricingEvaluation): DerivedCriteria {
  const c: Criteria = { ...x.criteria };
  const failReasons: string[] = [];
  const ruleFailed = new Set<keyof Criteria>();
  let hardExclusion = false;
  const fail = (k: keyof Criteria, why: string, hard = false) => {
    c[k] = 'fail';
    ruleFailed.add(k);
    failReasons.push(why);
    if (hard) hardExclusion = true;
  };

  // 1. Real project (design + execution, not advice) -------------------------------------
  if (x.intent === 'advice_only') {
    fail('real_project', 'Wants advice / ideas only — Aangan’s minimum engagement is a room redesign with full execution.');
  } else if (x.intent === 'pricing_only') {
    c.real_project = 'unclear';
  }
  if (x.custom_work_flags.includes('hospitality_or_retail')) {
    fail('real_project', 'Restaurant / hotel / retail / gym — out of scope.', true);
  }
  if (x.custom_work_flags.includes('oversize_commercial') || (x.project_type === 'commercial' && (x.area_sqft ?? 0) > SCOPE_RULES.maxCommercialSqft)) {
    fail('real_project', `Commercial space above ~${SCOPE_RULES.maxCommercialSqft.toLocaleString('en-IN')} sq ft — out of scope.`, true);
  }
  if (x.project_type === 'commercial' && x.area_sqft && x.area_sqft < SCOPE_RULES.minCommercialSqft) {
    fail('real_project', `Commercial space under ~${SCOPE_RULES.minCommercialSqft} sq ft — below minimum scope.`, true);
  }
  if (c.real_project !== 'fail' && x.scope_clarity === 'not_stated' && LEAD_INTENTS.has(x.intent)) {
    c.real_project = 'unclear';
  }

  // 2. Service area -----------------------------------------------------------------------
  const loc = classifyLocation(x.location);
  if (loc === 'not_served') {
    fail('service_area', `Site (${x.location}) is outside Pune / PCMC — no vendor network there.`);
  } else if (loc === 'served') {
    c.service_area = 'pass';
  } else if (x.in_service_area === false) {
    fail('service_area', 'Site is outside the service area.');
  } else if (x.in_service_area === true) {
    c.service_area = 'pass';
  } else if (!x.location) {
    c.service_area = 'unclear';
  }

  // 3. Timeline ---------------------------------------------------------------------------
  if (x.weeks_to_completion !== null && x.weeks_to_completion !== undefined) {
    if (x.weeks_to_completion < GUARDRAILS.timelineFailWeeks) {
      fail('timeline', `Needs completion in ~${x.weeks_to_completion} weeks — Aangan can’t start execution in under ${GUARDRAILS.timelineFailWeeks} weeks.`);
    } else if (x.weeks_to_completion < GUARDRAILS.timelineUnclearWeeks) {
      c.timeline = 'unclear';
    } else {
      c.timeline = 'pass';
    }
  } else if (!x.timeline_text) {
    c.timeline = 'unclear';
  }

  // 4. Budget (never asked; only a *volunteered* figure can fail) -------------------------
  if (pricing.budgetFlag === 'below_minimum') {
    fail('budget', 'Volunteered budget is clearly below what any project of this scope costs.');
  } else if (pricing.budgetFlag === 'not_stated') {
    c.budget = 'unclear'; // non-blocking: "If budget is not mentioned, treat as qualified."
  } else {
    c.budget = 'pass';
  }

  // 5. Decision-maker (never blocks) ------------------------------------------------------
  c.decision_maker = c.decision_maker ?? 'unclear';
  if (c.decision_maker === 'fail') c.decision_maker = 'unclear'; // qualified.md: unclear on 5 → treat as qualified, note it.

  c.real_project = c.real_project ?? 'unclear';
  c.service_area = c.service_area ?? 'unclear';
  c.timeline = c.timeline ?? 'unclear';

  // A failure the rules above didn't produce came from the model's own judgement — surface its evidence.
  for (const k of ['real_project', 'service_area', 'timeline'] as const) {
    if (c[k] === 'fail' && !ruleFailed.has(k)) {
      failReasons.push(x.criteria_notes?.[k] ?? `Judged failing on ${k.replace('_', ' ')}.`);
    }
  }
  return { criteria: c, failReasons, hardExclusion };
}

const DEFAULT_QUESTIONS: Record<'real_project' | 'service_area' | 'timeline', string> = {
  real_project: 'Are you looking for a full design-and-execution project for the space, or mainly advice and ideas?',
  service_area: 'Which area is the property in?',
  timeline: 'When would you need the project complete?',
};

// ---------------------------------------------------------------------------------------------
// Triage  (failure modes A, B, C + service recovery)
// ---------------------------------------------------------------------------------------------

export interface EscalationSpec {
  kind: EscalationKind;
  trigger: EscalationTrigger;
  severity: Severity;
  assignedTo: AssignedTo;
  reason: string;
  detail: Record<string, unknown>;
  suggestedQuestion?: string | null;
  /** If true the enquiry is held (no designer handoff) until this escalation is resolved. */
  blocksHandoff: boolean;
}

export interface TriageContext {
  now: Date;
  receivedAt: Date;
  firstResponseAt: Date | null;
  callOutcome: CallOutcome | null;
  transcriptText: string;
  /** Stable key (source_ref or enquiry id) for deterministic audit sampling. */
  auditKey: string;
  /** False once the lead is lost / closed — stops SLA-breach noise on dead leads. */
  leadActive?: boolean;
}

export interface TriageResult {
  confidence: number;
  gate: GateResult;
  criteria: Criteria;
  failReasons: string[];
  outcome: AiQualification;
  reasons: string[];
  pricing: PricingEvaluation;
  escalations: EscalationSpec[];
  priorityFlags: string[];
  /** Notes for the designer (e.g. budget not stated — do not ask). */
  designerNotes: string[];
  estimatedValueInr: number | null;
  auditSampled: boolean;
  briefEligible: boolean;
  suggestedQuestion: string | null;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function isAuditSampled(key: string): boolean {
  return fnv1a(`audit:${key}`) / 0xffffffff < GUARDRAILS.auditSampleRate;
}

function isHighValue(x: Extraction, pricing: PricingEvaluation): boolean {
  const budgetHigh = pricing.budgetHighInr ?? 0;
  return budgetHigh >= GUARDRAILS.highValueBudgetInr || (x.area_sqft ?? 0) >= GUARDRAILS.highValueAreaSqft;
}

const HARD_DISQUALIFIER_INTENTS = new Set(['vendor', 'job_seeker', 'spam', 'wrong_number']);

export function triage(x: Extraction, ctx: TriageContext): TriageResult {
  const gate = evaluateGate(x, ctx.transcriptText);
  const pricing = evaluatePricing(x);
  const derived = deriveCriteria(x, pricing);
  const escalations: EscalationSpec[] = [];
  const designerNotes: string[] = [];
  const reasons: string[] = [];
  let outcome: AiQualification = 'review';
  let suggestedQuestion: string | null = null;
  let auditSampled = false;

  // ---- priority flags (informational; never block) --------------------------------------
  const priority: string[] = [];
  if (x.founder_connection) priority.push('founder_connection');
  if (x.referral_source) priority.push('referral');
  if ((x.area_sqft ?? 0) >= GUARDRAILS.largeProjectAreaSqft || (pricing.pipelineEstimateInr ?? 0) >= GUARDRAILS.largeProjectValueInr) priority.push('large_project');
  if (x.asked_for_pricing) priority.push('asked_pricing');
  if (x.competitive) priority.push('competitive');
  if (x.sentiment === 'frustrated') priority.push('frustrated');
  if (isAfterHours(ctx.receivedAt)) priority.push('after_hours');

  const bigTicket = priority.includes('large_project') || priority.includes('founder_connection');
  const pricingOwner: AssignedTo = (pricing.pipelineEstimateInr ?? 0) >= GUARDRAILS.largeProjectValueInr ? 'founder' : 'senior_designer';

  // ---- 0. Not a lead: existing-client complaint → straight to the studio head -----------------
  if (x.intent === 'existing_client_complaint') {
    escalations.push({
      kind: 'service_recovery', trigger: 'existing_client_complaint', severity: 'critical', assignedTo: 'founder',
      reason: 'Existing client is complaining about an unresponsive project team. Wants a senior callback within 15 minutes.',
      detail: { callerAsked: 'Callback from Nikhil or a senior person' }, blocksHandoff: true,
    });
    return finish('not_applicable', ['Existing-client service issue, not a new enquiry.']);
  }

  // ---- 1. Missed call: nobody spoke to them ---------------------------------------------------
  if (ctx.callOutcome === 'missed') {
    escalations.push({
      kind: 'service_recovery', trigger: 'missed_call', severity: 'medium', assignedTo: 'front_desk',
      reason: 'Missed call with no voicemail — prospect has not been reached.',
      detail: { afterHours: isAfterHours(ctx.receivedAt) }, blocksHandoff: true,
    });
    return finish('review', ['Missed call — no conversation to qualify yet.']);
  }

  // ---- 2. Confidence gate (A) ----------------------------------------------------------------
  if (!gate.passed) {
    const trigger: EscalationTrigger = gate.triggers[0];
    escalations.push({
      kind: 'transcription', trigger,
      severity: gate.confidence < 0.7 || trigger === 'ai_failure' ? 'high' : 'medium',
      assignedTo: bigTicket ? 'founder' : 'front_desk',
      reason: `Held before designer handoff. ${gate.reasons.join(' ')}`,
      detail: { confidence: gate.confidence, threshold: GUARDRAILS.confidenceMin, triggers: gate.triggers, ambiguity_flags: x.ambiguity_flags },
      suggestedQuestion: sanitizeClientText(x.clarifying_question), blocksHandoff: true,
    });
    reasons.push(...gate.reasons, 'Provisional outcome only — a human must confirm the details first.');
    // Pricing escalations are deliberately suppressed here: the budget/scope figures may be mis-heard.
    return finish('review', reasons, true);
  }

  // ---- 3. Hard disqualifiers (spam / vendor / job seeker / wrong number) ----------------------
  if (HARD_DISQUALIFIER_INTENTS.has(x.intent)) {
    reasons.push(`Not a prospect (${x.intent.replace('_', ' ')}).`);
    outcome = 'unqualified';
    return finish(outcome, reasons);
  }

  // ---- 4. Rubric (B) -------------------------------------------------------------------------
  const { criteria, failReasons, hardExclusion } = derived;
  const failed = (Object.keys(criteria) as (keyof Criteria)[]).filter((k) => criteria[k] === 'fail');
  const blockingUnclear = (['real_project', 'service_area', 'timeline'] as const).filter((k) => criteria[k] === 'unclear');

  if (failed.length > 0) {
    const practicalOnly = !hardExclusion && failed.every((k) => k === 'service_area' || k === 'timeline');
    if (practicalOnly && isHighValue(x, pricing)) {
      outcome = 'review';
      reasons.push(...failReasons, 'High-value fringe lead — routed to human review instead of an automatic decline.');
      escalations.push({
        kind: 'lead_qualification', trigger: 'high_value_fringe', severity: 'high', assignedTo: 'founder',
        reason: `Fails ${failed.join(' + ').replace(/_/g, ' ')} but looks valuable (${valueSignal(x, pricing)}). Declining would risk a costly false negative.`,
        detail: { failed, failReasons, area_sqft: x.area_sqft, budget_high_inr: pricing.budgetHighInr }, blocksHandoff: true,
      });
    } else {
      outcome = 'unqualified';
      reasons.push(...failReasons);
      if (isAuditSampled(ctx.auditKey)) {
        auditSampled = true;
        escalations.push({
          kind: 'lead_qualification', trigger: 'audit_sample', severity: 'low', assignedTo: 'front_desk',
          reason: 'Random audit of an automatic decline — confirm it was right so the false-negative rate stays measurable.',
          detail: { failed, failReasons }, blocksHandoff: false,
        });
      }
    }
  } else if (blockingUnclear.length > 0) {
    outcome = 'review';
    const first = blockingUnclear[0];
    suggestedQuestion = sanitizeClientText(x.clarifying_question, DEFAULT_QUESTIONS[first]);
    reasons.push(`Unclear on: ${blockingUnclear.map((k) => k.replace('_', ' ')).join(', ')} — ask one direct question before forwarding.`);
    escalations.push({
      kind: 'lead_qualification', trigger: 'needs_clarification', severity: 'low', assignedTo: 'front_desk',
      reason: `Not enough information yet about: ${blockingUnclear.map((k) => k.replace('_', ' ')).join(', ')}. Ask the client, then decide — it has not been declined or forwarded.`,
      detail: { unclear: blockingUnclear }, suggestedQuestion, blocksHandoff: true,
    });
  } else {
    outcome = 'qualified';
    reasons.push('Passes the rubric: real project, in service area, workable timeline.');
  }

  if (criteria.budget === 'unclear' && outcome !== 'unqualified') {
    designerNotes.push('Budget not volunteered — do not probe; establish fit at the consultation.');
  }
  if (criteria.decision_maker === 'unclear' && outcome !== 'unqualified') {
    designerNotes.push('Decision-maker not confirmed on the call — confirm who decides and who attends the consultation.');
  }
  if (x.budget_flexibility === 'rigid') {
    designerNotes.push('Client says the budget is not flexible upward — set expectations early.');
  }
  if (pricing.budgetFlag === 'below_range') {
    designerNotes.push('Volunteered budget sits below our indicative range for this scope — anchoring risk. Do not echo their number; calibrate at the consultation.');
  }
  if (x.asked_for_pricing) {
    designerNotes.push('Asked about pricing on the call and was deflected (no figure given). Expect the question again.');
  }

  // ---- 5. Pricing guardrails (C) — only on reliable data (gate already passed) -------------------
  if (pricing.budgetFlag === 'below_minimum') {
    escalations.push({
      kind: 'pricing', trigger: 'budget_below_minimum', severity: outcome === 'unqualified' ? 'low' : 'high',
      assignedTo: pricingOwner,
      reason: pricing.reviewReasons[0] ?? 'Budget below minimum viability.',
      detail: { budget_low_inr: pricing.budgetLowInr, budget_high_inr: pricing.budgetHighInr, floor_cost_inr: pricing.floorCostInr },
      blocksHandoff: outcome !== 'unqualified',
    });
  }
  const customReview = pricing.customWorkFlags.filter((f) => f === 'structural_work' || f === 'luxury_spec' || f === 'home_automation');
  if (customReview.length > 0 && !hardExclusion) {
    escalations.push({
      kind: 'pricing', trigger: 'custom_work', severity: 'medium', assignedTo: pricingOwner,
      reason: pricing.reviewReasons.find((r) => r.startsWith('Custom')) ?? 'Custom work requires senior review before any estimate.',
      detail: { custom_work_flags: customReview }, blocksHandoff: outcome !== 'unqualified',
    });
  }

  // ---- 5b. Agent policy: the studio's own side must never state a price (pricing.md) -------------------
  const breaches = findAgentPriceDisclosures(ctx.transcriptText);
  if (breaches.length > 0) {
    escalations.push({
      kind: 'pricing', trigger: 'agent_policy_breach', severity: 'high', assignedTo: 'senior_designer',
      reason: 'The studio side of this conversation appears to have quoted a price / rate. The only approved answer is the standard pricing deflection.',
      detail: { lines: breaches.slice(0, 3) }, blocksHandoff: false,
    });
  }

  // ---- 6. Response-time SLA (service recovery) ----------------------------------------------
  // Only judged when a response time is recorded; still-unanswered enquiries are caught by the SLA sweep (/api/cron/sla-check).
  const waitHours = ctx.firstResponseAt ? (ctx.firstResponseAt.getTime() - ctx.receivedAt.getTime()) / 3_600_000 : 0;
  const stillActive = ctx.leadActive !== false && outcome !== 'unqualified';
  if (stillActive && ctx.firstResponseAt && waitHours > GUARDRAILS.slaBreachHours) {
    escalations.push({
      kind: 'service_recovery', trigger: 'response_sla_breach', severity: waitHours > 48 ? 'high' : 'medium',
      assignedTo: waitHours > 48 || x.sentiment === 'frustrated' ? 'senior_designer' : 'front_desk',
      reason: `Prospect waited ${waitHours.toFixed(0)}h for a response${x.sentiment === 'frustrated' ? ' and is frustrated' : ''}. Leads answered after 48h rarely convert.`,
      detail: { wait_hours: Math.round(waitHours), after_hours: isAfterHours(ctx.receivedAt), responded: true }, blocksHandoff: false,
    });
  }

  return finish(outcome, reasons);

  // --------------------------------------------------------------------------------------
  function finish(o: AiQualification, why: string[], gateFailed = false): TriageResult {
    const blocking = escalations.some((e) => e.blocksHandoff);
    return {
      confidence: gate.confidence,
      gate,
      criteria: derived.criteria,
      failReasons: derived.failReasons,
      outcome: o,
      reasons: why,
      pricing,
      escalations,
      priorityFlags: priority,
      designerNotes,
      estimatedValueInr: pricing.pipelineEstimateInr,
      auditSampled,
      briefEligible: o === 'qualified' && !blocking && !gateFailed,
      suggestedQuestion,
    };
  }
}

function valueSignal(x: Extraction, pricing: PricingEvaluation): string {
  const bits: string[] = [];
  if ((pricing.budgetHighInr ?? 0) >= GUARDRAILS.highValueBudgetInr) bits.push(`volunteered budget up to ₹${((pricing.budgetHighInr ?? 0) / 100_000).toFixed(0)}L`);
  if ((x.area_sqft ?? 0) >= GUARDRAILS.highValueAreaSqft) bits.push(`${x.area_sqft!.toLocaleString('en-IN')} sq ft`);
  return bits.join(', ') || 'high value';
}

// ---------------------------------------------------------------------------------------------
// Override classification (feeds the FP / FN rates on the dashboard)
// ---------------------------------------------------------------------------------------------

export type OverrideClass =
  | 'confirmed'            // human agreed with the AI
  | 'false_positive'       // AI said qualified, human said unqualified  → wasted designer time
  | 'false_negative'       // AI said unqualified, human said qualified  → lost opportunity (the costly one)
  | 'gray_to_qualified'    // AI sent to review, human qualified it      → value the review queue saved
  | 'gray_to_unqualified'; // AI sent to review, human declined it

export function classifyOverride(e: Pick<EnquiryRow, 'ai_qualification' | 'final_qualification'>): OverrideClass | null {
  if (!e.final_qualification || e.ai_qualification === 'not_applicable') return null;
  if (e.ai_qualification === 'review') return e.final_qualification === 'qualified' ? 'gray_to_qualified' : 'gray_to_unqualified';
  if (e.ai_qualification === e.final_qualification) return 'confirmed';
  return e.ai_qualification === 'qualified' ? 'false_positive' : 'false_negative';
}

export type { Verdict };
