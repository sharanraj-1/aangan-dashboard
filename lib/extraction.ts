// Extraction shape: defaults, validation of model output, small helpers.

import { z } from 'zod';
import type { Criteria, CustomWorkFlag, Extraction, Verdict } from './types';

export const CUSTOM_FLAGS = ['structural_work', 'luxury_spec', 'home_automation', 'hospitality_or_retail', 'oversize_commercial'] as const;

export function blankExtraction(overrides: Partial<Extraction> = {}): Extraction {
  return {
    client_name: null,
    client_phone: null,
    client_email: null,
    intent: 'new_project',
    project_type: null,
    scope_type: null,
    scope_summary: null,
    scope_clarity: 'not_stated',
    location: null,
    location_clarity: 'not_stated',
    in_service_area: null,
    area_sqft: null,
    style_preferences: [],
    timeline_text: null,
    weeks_to_completion: null,
    budget_low_inr: null,
    budget_high_inr: null,
    budget_flexibility: 'unknown',
    referral_source: null,
    founder_connection: false,
    asked_for_pricing: false,
    competitive: false,
    custom_work_flags: [],
    criteria: { real_project: 'unclear', service_area: 'unclear', timeline: 'unclear', budget: 'unclear', decision_maker: 'unclear' },
    criteria_notes: {},
    clarifying_question: null,
    summary: '',
    sentiment: 'neutral',
    ambiguity_flags: [],
    field_confidence: {},
    transcription_confidence: 0.95,
    inaudible_count: 0,
    ...overrides,
  };
}

const V: Record<string, Verdict> = { P: 'pass', U: 'unclear', F: 'fail' };
/** Shorthand for seed data: crit('PPUUP') = real_project, service_area, timeline, budget, decision_maker. */
export function crit(code: string): Criteria {
  const v = code.split('').map((ch) => V[ch] ?? 'unclear');
  return { real_project: v[0], service_area: v[1], timeline: v[2], budget: v[3], decision_maker: v[4] };
}

// ---------------------------------------------------------------------------------------------
// Validation of whatever Gemini returns. Lenient on shape (.catch defaults) so one odd field never
// drops an enquiry; strict on clamping so nonsense numbers can't reach the guardrails.
// ---------------------------------------------------------------------------------------------

const verdict = z.enum(['pass', 'unclear', 'fail']).catch('unclear');
const clarity = z.enum(['clear', 'not_stated', 'ambiguous']).catch('not_stated');
const str = z.string().trim().min(1).nullable().catch(null);
const nonNegInt = z.number().finite().nonnegative().transform(Math.round).nullable().catch(null);
const unit = z.number().finite().transform((n) => Math.max(0, Math.min(1, n)));

export const extractionSchema = z.object({
  client_name: str,
  client_phone: str,
  client_email: str,
  intent: z.enum([
    'new_project', 'advice_only', 'pricing_only', 'existing_client_complaint',
    'follow_up_chase', 'vendor', 'job_seeker', 'spam', 'wrong_number', 'other',
  ]).catch('other'),
  project_type: z.enum(['residential', 'commercial', 'other']).nullable().catch(null),
  scope_type: z.enum(['full_home', 'partial_home', 'single_room', 'office', 'other']).nullable().catch(null),
  scope_summary: str,
  scope_clarity: clarity,
  location: str,
  location_clarity: clarity,
  in_service_area: z.boolean().nullable().catch(null),
  area_sqft: nonNegInt,
  style_preferences: z.array(z.string()).catch([]),
  timeline_text: str,
  weeks_to_completion: nonNegInt,
  budget_low_inr: nonNegInt,
  budget_high_inr: nonNegInt,
  budget_flexibility: z.enum(['rigid', 'flexible', 'unknown']).catch('unknown'),
  referral_source: str,
  founder_connection: z.boolean().catch(false),
  asked_for_pricing: z.boolean().catch(false),
  competitive: z.boolean().catch(false),
  // Unknown flags are dropped, never coerced into one that would trigger an escalation.
  custom_work_flags: z.array(z.string()).catch([]).transform(
    (arr) => arr.filter((f): f is CustomWorkFlag => (CUSTOM_FLAGS as readonly string[]).includes(f)),
  ),
  criteria: z.object({
    real_project: verdict, service_area: verdict, timeline: verdict, budget: verdict, decision_maker: verdict,
  }).catch({ real_project: 'unclear', service_area: 'unclear', timeline: 'unclear', budget: 'unclear', decision_maker: 'unclear' }),
  criteria_notes: z.record(z.string()).catch({}),
  clarifying_question: str,
  summary: z.string().catch(''),
  sentiment: z.enum(['positive', 'neutral', 'frustrated', 'urgent']).catch('neutral'),
  ambiguity_flags: z.array(z.string()).catch([]),
  field_confidence: z.record(unit).catch({}),
  transcription_confidence: unit.catch(0),
  inaudible_count: z.number().int().nonnegative().catch(0),
});

export function parseExtraction(json: unknown): Extraction {
  const parsed = extractionSchema.parse(json);
  return blankExtraction(parsed as Partial<Extraction>);
}

/** Used when the AI step fails entirely: keep the enquiry, force a human look (gate trigger: ai_failure). */
export function failedExtraction(note: string): Extraction {
  return blankExtraction({
    intent: 'other',
    summary: `AI processing unavailable: ${note}`,
    transcription_confidence: 0,
    ambiguity_flags: ['ai_unavailable'],
  });
}
