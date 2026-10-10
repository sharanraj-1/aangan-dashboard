// Shared types. DB row shapes mirror supabase/schema.sql.

export type Channel = 'phone' | 'whatsapp' | 'web_form';
export type CallOutcome = 'answered' | 'missed' | 'dropped';

export type Intent =
  | 'new_project' | 'advice_only' | 'pricing_only' | 'existing_client_complaint'
  | 'follow_up_chase' | 'vendor' | 'job_seeker' | 'spam' | 'wrong_number' | 'other';

export type ProjectType = 'residential' | 'commercial' | 'other';
export type ScopeType = 'full_home' | 'partial_home' | 'single_room' | 'office' | 'other';
export type Sentiment = 'positive' | 'neutral' | 'frustrated' | 'urgent';

/** Nikhil's rubric (qualified.md): each criterion is judged pass / unclear / fail. */
export type Verdict = 'pass' | 'unclear' | 'fail';
export interface Criteria {
  real_project: Verdict;   // 1. wants design + execution, not just advice
  service_area: Verdict;   // 2. Pune city / PCMC
  timeline: Verdict;       // 3. site ready for execution within ~8–10 weeks
  budget: Verdict;         // 4. a *volunteered* budget is not clearly below the scope's cost
  decision_maker: Verdict; // 5. caller decides, or is authorised
}

/** How clearly a core parameter (scope / location) came through the transcript. */
export type Clarity = 'clear' | 'not_stated' | 'ambiguous';

export type CustomWorkFlag =
  | 'structural_work'        // moving walls etc. — outside what Aangan does
  | 'luxury_spec'            // imported / luxury materials → ₹3,500+/sq ft territory
  | 'home_automation'
  | 'hospitality_or_retail'  // restaurant / hotel / retail / gym — out of scope
  | 'oversize_commercial';   // commercial > ~3,000 sq ft

/** What Gemini (or the seed data) says about a conversation. */
export interface Extraction {
  client_name: string | null;
  client_phone: string | null;
  client_email: string | null;
  intent: Intent;
  project_type: ProjectType | null;
  scope_type: ScopeType | null;
  scope_summary: string | null;
  scope_clarity: Clarity;
  location: string | null;
  location_clarity: Clarity;
  in_service_area: boolean | null;
  area_sqft: number | null;
  style_preferences: string[];
  timeline_text: string | null;
  weeks_to_completion: number | null;
  budget_low_inr: number | null;
  budget_high_inr: number | null;
  budget_flexibility: 'rigid' | 'flexible' | 'unknown';
  referral_source: string | null;
  founder_connection: boolean;          // knows Nikhil / a past client of Aangan
  asked_for_pricing: boolean;
  competitive: boolean;                 // shortlisting other studios
  custom_work_flags: CustomWorkFlag[];
  criteria: Criteria;
  /** One line of transcript evidence per criterion (why pass / unclear / fail). */
  criteria_notes: Partial<Record<keyof Criteria, string>>;
  clarifying_question: string | null;   // the ONE direct question (never about budget)
  summary: string;
  sentiment: Sentiment;
  ambiguity_flags: string[];
  field_confidence: Record<string, number>;
  transcription_confidence: number;
  inaudible_count: number;
}

export type AiQualification = 'qualified' | 'unqualified' | 'review' | 'not_applicable';
export type FinalQualification = 'qualified' | 'unqualified';
export type EnquiryStatus = 'new' | 'escalated' | 'handed_off' | 'won' | 'lost' | 'closed';
export type HandoffStatus = 'not_sent' | 'sent' | 'accepted' | 'declined';

export interface EnquiryRow {
  id: string;
  source_ref: string | null;
  channel: Channel;
  received_at: string;
  after_hours: boolean;
  call_outcome: CallOutcome | null;
  call_duration_seconds: number | null;
  first_response_at: string | null;
  response_note: string | null;
  client_name: string | null;
  client_phone: string | null;
  client_email: string | null;
  intent: Intent;
  project_type: ProjectType | null;
  scope_type: ScopeType | null;
  scope_summary: string | null;
  location: string | null;
  in_service_area: boolean | null;
  area_sqft: number | null;
  style_preferences: string[];
  timeline_text: string | null;
  weeks_to_completion: number | null;
  budget_low_inr: number | null;
  budget_high_inr: number | null;
  budget_flexibility: 'rigid' | 'flexible' | 'unknown' | null;
  referral_source: string | null;
  summary: string | null;
  sentiment: Sentiment | null;
  criteria: Partial<Criteria>;
  open_questions: string[];
  priority_flags: string[];
  transcription_confidence: number | null;
  composite_confidence: number | null;
  ai_qualification: AiQualification;
  qualification_reasons: string[];
  final_qualification: FinalQualification | null;
  final_decided_by: string | null;
  final_decided_at: string | null;
  override_note: string | null;
  status: EnquiryStatus;
  designer_id: string | null;
  designer_name: string | null;
  handoff_status: HandoffStatus;
  handoff_sent_at: string | null;
  handoff_accepted_at: string | null;
  designer_reasked: boolean;
  estimated_value_inr: number | null;
  final_value_inr: number | null;
  closed_reason: string | null;
  hubspot_contact_id: string | null;
  hubspot_deal_id: string | null;
  hubspot_synced_at: string | null;
  hubspot_error: string | null;
  is_synthetic: boolean;
  created_at: string;
  updated_at: string;
}

export type ConsultationMode = 'site_visit' | 'studio' | 'call';
export type ConsultationStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show';
export interface ConsultationRow {
  id: string;
  enquiry_id: string;
  designer_id: string | null;
  starts_at: string;
  ends_at: string;
  mode: ConsultationMode;
  location: string | null;
  status: ConsultationStatus;
  notes: string | null;
  google_event_id: string | null;
  ics_uid: string;
  created_by: string | null;
  created_at: string;
}

export type DesignerRole = 'designer' | 'senior_designer' | 'principal';
export interface DesignerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: DesignerRole;
  active: boolean;
  is_sample: boolean;
  created_at: string;
}

export type EmailTemplate = 'confirmation' | 'clarification' | 'decline';
export interface OutboundEmailRow {
  id: string;
  enquiry_id: string;
  template: EmailTemplate;
  to_email: string;
  subject: string;
  body_text: string;
  body_html: string;
  designer_id: string | null;
  callback_at: string | null;
  status: 'sent' | 'failed' | 'dry_run';
  provider_id: string | null;
  error: string | null;
  sent_by: string | null;
  created_at: string;
}

export interface TranscriptRow {
  id: string;
  enquiry_id: string;
  source: 'audio' | 'text' | 'form';
  audio_url: string | null;
  raw_text: string;
  processed_text: string | null;
  language: string | null;
  duration_seconds: number | null;
  transcription_confidence: number | null;
  field_confidence: Record<string, number>;
  ambiguity_flags: string[];
  extraction: Extraction | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  ai_cost_inr: number;
  created_at: string;
}

export type EscalationKind = 'transcription' | 'lead_qualification' | 'pricing' | 'service_recovery';
export type EscalationTrigger =
  | 'low_confidence' | 'ambiguous_scope' | 'ambiguous_location' | 'ai_failure'
  | 'needs_clarification' | 'high_value_fringe' | 'audit_sample'
  | 'budget_below_minimum' | 'custom_work' | 'agent_policy_breach'
  | 'existing_client_complaint' | 'response_sla_breach' | 'missed_call';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type AssignedTo = 'front_desk' | 'founder' | 'senior_designer';
export type EscalationResolution = 'qualified' | 'unqualified' | 'approved_ai' | 'dismissed';

export interface EscalationRow {
  id: string;
  enquiry_id: string;
  kind: EscalationKind;
  trigger: EscalationTrigger;
  severity: Severity;
  assigned_to: AssignedTo;
  status: 'open' | 'acknowledged' | 'resolved';
  reason: string;
  detail: Record<string, unknown>;
  suggested_question: string | null;
  notified_via: string[];
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution: EscalationResolution | null;
  resolution_note: string | null;
}

export type BudgetFlag = 'not_stated' | 'within_range' | 'below_range' | 'below_minimum' | 'above_range';
export type PricingSegment = 'residential' | 'commercial' | 'single_room' | 'unknown';

export interface PricingLogRow {
  id: string;
  enquiry_id: string;
  segment: PricingSegment;
  area_sqft: number | null;
  rate_low_per_sqft: number | null;
  rate_high_per_sqft: number | null;
  indicative_low_inr: number | null;
  indicative_high_inr: number | null;
  pipeline_estimate_inr: number | null;
  budget_low_inr: number | null;
  budget_high_inr: number | null;
  budget_flag: BudgetFlag;
  anchor_risk: boolean;
  custom_work_flags: string[];
  requires_review: boolean;
  client_facing_response: string;
  formal_estimate_inr: number | null;
  formal_estimate_at: string | null;
  created_at: string;
}

export interface ToolCostRow {
  id: string;
  month: string;
  category: string;
  vendor: string | null;
  amount_inr: number;
  note: string | null;
  created_at: string;
}

/** Everything the dashboard needs, already in memory. */
export interface Dataset {
  enquiries: EnquiryRow[];
  escalations: EscalationRow[];
  pricingLogs: PricingLogRow[];
  transcriptCosts: { enquiry_id: string; ai_cost_inr: number }[];
  toolCosts: ToolCostRow[];
  designers: DesignerRow[];
  outboundEmails: OutboundEmailRow[];
  consultations: ConsultationRow[];
  demo: boolean;
}
