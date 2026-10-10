// Turns (extraction + context) into the database rows. One implementation, used by the live ingest
// pipeline, the seed script and the tests — so what you see in demo data is exactly what production writes.

import { randomUUID } from 'node:crypto';
import { GEMINI } from './config';
import { approxTokens, estimateCostInr } from './cost';
import { isAfterHours, triage, type TriageResult } from './guardrails';
import type {
  CallOutcome, Channel, EnquiryRow, EnquiryStatus, EscalationRow, Extraction, PricingLogRow, TranscriptRow,
} from './types';

export interface BuildInput {
  id?: string;
  sourceRef?: string | null;
  channel: Channel;
  receivedAt: Date;
  callOutcome?: CallOutcome | null;
  durationSec?: number | null;
  firstResponseAt?: Date | null;
  responseNote?: string | null;
  rawText: string;
  processedText?: string | null;
  language?: string | null;
  audioUrl?: string | null;
  extraction: Extraction;
  model?: string | null;
  usage?: { inputTokens: number; outputTokens: number };
  /** Status the source reports (lost / closed); otherwise derived from the triage result. */
  sourceStatus?: EnquiryStatus | null;
  now: Date;
  isSynthetic?: boolean;
}

export interface BuiltRecords {
  enquiry: EnquiryRow;
  transcript: TranscriptRow | null;
  pricing: PricingLogRow | null;
  escalations: EscalationRow[];
  triage: TriageResult;
}

const iso = (d: Date) => d.toISOString();
const plusMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

export function buildRecords(input: BuildInput): BuiltRecords {
  const x = input.extraction;
  const id = input.id ?? randomUUID();
  const received = input.receivedAt;

  const t = triage(x, {
    now: input.now,
    receivedAt: received,
    firstResponseAt: input.firstResponseAt ?? null,
    callOutcome: input.callOutcome ?? null,
    transcriptText: input.rawText,
    auditKey: input.sourceRef ?? id,
    leadActive: input.sourceStatus !== 'lost' && input.sourceStatus !== 'closed',
  });

  const blocking = t.escalations.some((e) => e.blocksHandoff);
  let status: EnquiryStatus;
  if (input.sourceStatus) status = input.sourceStatus;
  else if (blocking) status = 'escalated';
  else if (t.outcome === 'unqualified' || t.outcome === 'not_applicable') status = 'closed';
  else status = 'new';

  const noPriceForUnqualified = t.outcome === 'unqualified' || t.outcome === 'not_applicable';

  const enquiry: EnquiryRow = {
    id,
    source_ref: input.sourceRef ?? null,
    channel: input.channel,
    received_at: iso(received),
    after_hours: isAfterHours(received),
    call_outcome: input.callOutcome ?? null,
    call_duration_seconds: input.durationSec ?? null,
    first_response_at: input.firstResponseAt ? iso(input.firstResponseAt) : null,
    response_note: input.responseNote ?? null,
    client_name: x.client_name,
    client_phone: x.client_phone,
    client_email: x.client_email,
    intent: x.intent,
    project_type: x.project_type,
    scope_type: x.scope_type,
    scope_summary: x.scope_summary,
    location: x.location,
    in_service_area: t.criteria.service_area === 'pass' ? true : t.criteria.service_area === 'fail' ? false : x.in_service_area,
    area_sqft: x.area_sqft,
    style_preferences: x.style_preferences,
    timeline_text: x.timeline_text,
    weeks_to_completion: x.weeks_to_completion,
    budget_low_inr: x.budget_low_inr,
    budget_high_inr: x.budget_high_inr,
    budget_flexibility: x.budget_flexibility,
    referral_source: x.referral_source,
    summary: x.summary || null,
    sentiment: x.sentiment,
    criteria: t.criteria,
    open_questions: t.designerNotes,
    priority_flags: t.priorityFlags,
    transcription_confidence: input.callOutcome === 'missed' ? null : x.transcription_confidence,
    composite_confidence: input.callOutcome === 'missed' ? null : t.confidence,
    ai_qualification: t.outcome,
    qualification_reasons: t.reasons,
    final_qualification: null,
    final_decided_by: null,
    final_decided_at: null,
    override_note: null,
    status,
    designer_id: null,
    designer_name: null,
    handoff_status: 'not_sent',
    handoff_sent_at: null,
    handoff_accepted_at: null,
    designer_reasked: false,
    estimated_value_inr: noPriceForUnqualified ? null : t.estimatedValueInr,
    final_value_inr: null,
    closed_reason: null,
    hubspot_contact_id: null,
    hubspot_deal_id: null,
    hubspot_synced_at: null,
    hubspot_error: null,
    is_synthetic: input.isSynthetic ?? false,
    created_at: iso(plusMin(received, 1)),
    updated_at: iso(plusMin(received, 1)),
  };

  let transcript: TranscriptRow | null = null;
  if (input.callOutcome !== 'missed') {
    const inTok = approxTokens(input.rawText) + 900; // + system prompt
    const outTok = 750;
    const usage = input.usage ?? { inputTokens: inTok, outputTokens: outTok };
    transcript = {
      id: randomUUID(),
      enquiry_id: id,
      source: input.channel === 'phone' ? 'audio' : input.channel === 'web_form' ? 'form' : 'text',
      audio_url: input.audioUrl ?? null,
      raw_text: input.rawText,
      processed_text: input.processedText ?? null,
      language: input.language ?? 'en',
      duration_seconds: input.durationSec ?? null,
      transcription_confidence: x.transcription_confidence,
      field_confidence: x.field_confidence,
      ambiguity_flags: x.ambiguity_flags,
      extraction: x,
      model: input.model ?? GEMINI.model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      ai_cost_inr: estimateCostInr({ ...usage, audioSeconds: input.channel === 'phone' ? input.durationSec ?? 0 : 0 }),
      created_at: iso(plusMin(received, 1)),
    };
  }

  const p = t.pricing;
  let pricing: PricingLogRow | null = null;
  if (p.segment !== 'unknown' || p.budgetFlag !== 'not_stated') {
    pricing = {
      id: randomUUID(),
      enquiry_id: id,
      segment: p.segment,
      area_sqft: p.areaSqft,
      rate_low_per_sqft: p.rateLowPerSqft,
      rate_high_per_sqft: p.rateHighPerSqft,
      indicative_low_inr: p.indicativeLowInr,
      indicative_high_inr: p.indicativeHighInr,
      pipeline_estimate_inr: p.pipelineEstimateInr,
      budget_low_inr: p.budgetLowInr,
      budget_high_inr: p.budgetHighInr,
      budget_flag: p.budgetFlag,
      anchor_risk: p.anchorRisk,
      custom_work_flags: p.customWorkFlags,
      requires_review: p.requiresReview,
      client_facing_response: p.clientFacingResponse,
      formal_estimate_inr: null,
      formal_estimate_at: null,
      created_at: iso(plusMin(received, 1)),
    };
  }

  const escalations: EscalationRow[] = t.escalations.map((e) => ({
    id: randomUUID(),
    enquiry_id: id,
    kind: e.kind,
    trigger: e.trigger,
    severity: e.severity,
    assigned_to: e.assignedTo,
    status: 'open',
    reason: e.reason,
    detail: e.detail,
    suggested_question: e.suggestedQuestion ?? null,
    notified_via: [],
    created_at: iso(e.trigger === 'response_sla_breach' && input.firstResponseAt ? input.firstResponseAt : plusMin(received, 2)),
    acknowledged_at: null,
    resolved_at: null,
    resolved_by: null,
    resolution: null,
    resolution_note: null,
  }));

  return { enquiry, transcript, pricing, escalations, triage: t };
}
