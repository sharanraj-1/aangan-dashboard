// Storage layer with two interchangeable backends:
//   • Supabase (production)   — service-role client, server-side only
//   • In-memory (demo mode)   — used automatically when Supabase env vars are missing; preloaded with the 40 real
//                               September enquiries so every screen and button works with zero setup.
//
// Role enforcement lives HERE, not just in the UI: the founder role is never given transcripts, contact details,
// summaries or escalation text — only the outcome-level columns the aggregate metrics need.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { buildDataset } from '../data/build-dataset';
import type {
  ConsultationRow, Dataset, DesignerRow, EnquiryRow, EscalationRow, OutboundEmailRow, PricingLogRow, ToolCostRow, TranscriptRow,
} from './types';

export type Role = 'designer' | 'founder';
export type Table =
  | 'enquiries' | 'transcripts' | 'escalations' | 'pricing_logs' | 'tool_costs' | 'designers' | 'outbound_emails' | 'consultations';

export interface Store {
  readonly demo: boolean;
  load(role: Role): Promise<Dataset>;
  transcriptFor(enquiryId: string): Promise<TranscriptRow | null>;
  insert(table: Table, rows: object | object[]): Promise<void>;
  update(table: Table, id: string, patch: Record<string, unknown>): Promise<void>;
  /** For ingest de-duplication (retries / re-pulls): is there already an enquiry with this source_ref? */
  enquiryExists(sourceRef: string): Promise<boolean>;

  // ---- targeted reads (designer-side workflows; never exposed to the founder role) ----
  getEnquiry(id: string): Promise<EnquiryRow | null>;
  getPricing(enquiryId: string): Promise<PricingLogRow | null>;
  getEscalation(id: string): Promise<EscalationRow | null>;
  escalationsFor(enquiryId: string): Promise<EscalationRow[]>;
  listDesigners(): Promise<DesignerRow[]>;
  /** Open (not yet won/lost/closed) handed-off enquiries per designer id — for least-loaded assignment. */
  designerLoad(): Promise<Record<string, number>>;
  consultationsFrom(from: Date): Promise<ConsultationRow[]>;
  getConsultation(id: string): Promise<ConsultationRow | null>;
  /** Enquiries still waiting for a first response (SLA sweep). */
  unrespondedBefore(cutoff: Date): Promise<EnquiryRow[]>;
}

// ------------------------------------------------------------------------------------------ redaction

const PII_ENQUIRY_FIELDS = [
  'client_name', 'client_phone', 'client_email', 'summary', 'scope_summary', 'location', 'timeline_text', 'referral_source', 'response_note',
  'override_note', 'designer_name', 'hubspot_contact_id', 'hubspot_deal_id', 'hubspot_error', 'closed_reason',
] as const;

/** Outcome-level view of an enquiry for the founder: no names, contact details, free text or location. */
export function redactEnquiry(e: EnquiryRow): EnquiryRow {
  const r = { ...e, style_preferences: [], open_questions: [], qualification_reasons: [], source_ref: null } as EnquiryRow;
  for (const f of PII_ENQUIRY_FIELDS) (r as unknown as Record<string, unknown>)[f] = null;
  return r;
}

export function redactEscalation(x: EscalationRow): EscalationRow {
  return { ...x, reason: '', detail: {}, suggested_question: null, resolution_note: null, resolved_by: null, notified_via: [] };
}

/** Columns the founder role is allowed to read from Supabase (everything outcome-level, nothing personal). */
const FOUNDER_ENQUIRY_COLUMNS = [
  'id', 'channel', 'received_at', 'after_hours', 'call_outcome', 'call_duration_seconds', 'first_response_at', 'intent', 'project_type',
  'scope_type', 'in_service_area', 'area_sqft', 'weeks_to_completion', 'budget_low_inr', 'budget_high_inr', 'budget_flexibility',
  'criteria', 'priority_flags', 'transcription_confidence', 'composite_confidence', 'ai_qualification', 'final_qualification',
  'final_decided_by', 'final_decided_at', 'status', 'designer_id', 'handoff_status', 'handoff_sent_at', 'handoff_accepted_at',
  'designer_reasked', 'estimated_value_inr', 'final_value_inr', 'is_synthetic', 'created_at', 'updated_at',
].join(',');
const FOUNDER_ESCALATION_COLUMNS = [
  'id', 'enquiry_id', 'kind', 'trigger', 'severity', 'assigned_to', 'status', 'created_at', 'acknowledged_at', 'resolved_at', 'resolution',
].join(',');

// ------------------------------------------------------------------------------------------ Supabase

let _admin: SupabaseClient | null | undefined;
export function getAdmin(): SupabaseClient | null {
  if (_admin !== undefined) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  _admin = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return _admin;
}

async function fetchAll<T>(db: SupabaseClient, table: Table, select: string, order?: { column: string; ascending?: boolean }, limit = 5000): Promise<T[]> {
  let q = db.from(table).select(select).limit(limit);
  if (order) q = q.order(order.column, { ascending: order.ascending ?? false });
  const { data, error } = await q;
  if (error) throw new Error(`Supabase ${table}: ${error.message}`);
  return (data ?? []) as unknown as T[];
}

function supabaseStore(db: SupabaseClient): Store {
  return {
    demo: false,
    async load(role) {
      const founder = role === 'founder';
      const [enquiries, escalations, pricingLogs, transcriptCosts, toolCosts] = await Promise.all([
        fetchAll<EnquiryRow>(db, 'enquiries', founder ? FOUNDER_ENQUIRY_COLUMNS : '*', { column: 'received_at' }),
        fetchAll<EscalationRow>(db, 'escalations', founder ? FOUNDER_ESCALATION_COLUMNS : '*', { column: 'created_at' }),
        fetchAll<PricingLogRow>(db, 'pricing_logs', '*', { column: 'created_at' }),
        fetchAll<{ enquiry_id: string; ai_cost_inr: number }>(db, 'transcripts', 'enquiry_id,ai_cost_inr'),
        fetchAll<ToolCostRow>(db, 'tool_costs', '*', { column: 'month' }),
      ]);
      const [designers, outboundEmails, consultations] = founder
        ? [[] as DesignerRow[], [] as OutboundEmailRow[], await fetchAll<ConsultationRow>(db, 'consultations', 'id,enquiry_id,designer_id,starts_at,ends_at,mode,status,created_at')]
        : await Promise.all([
            fetchAll<DesignerRow>(db, 'designers', '*', { column: 'name', ascending: true }),
            fetchAll<OutboundEmailRow>(db, 'outbound_emails', '*', { column: 'created_at' }, 1000),
            fetchAll<ConsultationRow>(db, 'consultations', '*', { column: 'starts_at', ascending: true }),
          ]);
      const fill = (e: EnquiryRow): EnquiryRow => (founder ? redactEnquiry({ ...blankPii(), ...e } as EnquiryRow) : e);
      return {
        enquiries: enquiries.map(fill),
        escalations: founder ? escalations.map((x) => redactEscalation({ ...blankEsc(), ...x } as EscalationRow)) : escalations,
        pricingLogs: founder ? pricingLogs.map((p) => ({ ...p, client_facing_response: '' })) : pricingLogs,
        transcriptCosts,
        toolCosts,
        designers,
        outboundEmails,
        consultations: founder ? consultations.map((c) => ({ ...c, location: null, notes: null, google_event_id: null, ics_uid: '', created_by: null })) : consultations,
        demo: false,
      };
    },
    async transcriptFor(enquiryId) {
      const { data, error } = await db.from('transcripts').select('*').eq('enquiry_id', enquiryId).order('created_at', { ascending: true }).limit(1);
      if (error) throw new Error(error.message);
      return (data?.[0] as TranscriptRow | undefined) ?? null;
    },
    async insert(table, rows) {
      const { error } = await db.from(table).insert(rows as never);
      if (error) throw new Error(`Insert into ${table} failed: ${error.message}`);
    },
    async update(table, id, patch) {
      const { error } = await db.from(table).update(patch).eq('id', id);
      if (error) throw new Error(`Update ${table} failed: ${error.message}`);
    },
    async enquiryExists(sourceRef) {
      const { data } = await db.from('enquiries').select('id').eq('source_ref', sourceRef).limit(1);
      return Boolean(data?.length);
    },
    async getEnquiry(id) {
      const { data } = await db.from('enquiries').select('*').eq('id', id).maybeSingle();
      return (data as EnquiryRow | null) ?? null;
    },
    async getPricing(enquiryId) {
      const { data } = await db.from('pricing_logs').select('*').eq('enquiry_id', enquiryId).order('created_at', { ascending: false }).limit(1);
      return (data?.[0] as PricingLogRow | undefined) ?? null;
    },
    async getEscalation(id) {
      const { data } = await db.from('escalations').select('*').eq('id', id).maybeSingle();
      return (data as EscalationRow | null) ?? null;
    },
    async escalationsFor(enquiryId) {
      const { data } = await db.from('escalations').select('*').eq('enquiry_id', enquiryId).order('created_at');
      return (data ?? []) as EscalationRow[];
    },
    async listDesigners() {
      const { data } = await db.from('designers').select('*').eq('active', true).order('name');
      return (data ?? []) as DesignerRow[];
    },
    async designerLoad() {
      const { data } = await db.from('enquiries').select('designer_id').eq('status', 'handed_off').not('designer_id', 'is', null).limit(5000);
      const out: Record<string, number> = {};
      for (const r of (data ?? []) as { designer_id: string }[]) out[r.designer_id] = (out[r.designer_id] ?? 0) + 1;
      return out;
    },
    async consultationsFrom(from) {
      const { data } = await db.from('consultations').select('*').gte('ends_at', from.toISOString()).order('starts_at');
      return (data ?? []) as ConsultationRow[];
    },
    async getConsultation(id) {
      const { data } = await db.from('consultations').select('*').eq('id', id).maybeSingle();
      return (data as ConsultationRow | null) ?? null;
    },
    async unrespondedBefore(cutoff) {
      // Only recent enquiries: a 3-week-old gap is history, not something to page people about.
      const floor = new Date(cutoff.getTime() - 14 * 24 * 3_600_000);
      const { data } = await db.from('enquiries').select('*').is('first_response_at', null).lt('received_at', cutoff.toISOString()).gte('received_at', floor.toISOString())
        .in('status', ['new', 'escalated']).neq('ai_qualification', 'unqualified').neq('ai_qualification', 'not_applicable').limit(500);
      return (data ?? []) as EnquiryRow[];
    },
  };
}

const blankPii = () => ({ client_name: null, client_phone: null, client_email: null, summary: null, scope_summary: null, location: null, timeline_text: null });
const blankEsc = () => ({ reason: '', detail: {}, suggested_question: null });

// ------------------------------------------------------------------------------------------ in-memory (demo)

interface Mem {
  enquiries: EnquiryRow[]; transcripts: TranscriptRow[]; escalations: EscalationRow[]; pricing_logs: PricingLogRow[];
  tool_costs: ToolCostRow[]; designers: DesignerRow[]; outbound_emails: OutboundEmailRow[]; consultations: ConsultationRow[];
}
const g = globalThis as unknown as { __aanganMem?: Mem };

function mem(): Mem {
  if (!g.__aanganMem) {
    const d = buildDataset(new Date(), Number(process.env.DEMO_SYNTHETIC) || 0);
    g.__aanganMem = {
      enquiries: d.enquiries, transcripts: d.transcripts, escalations: d.escalations, pricing_logs: d.pricingLogs,
      tool_costs: d.toolCosts, designers: d.designers, outbound_emails: d.outboundEmails, consultations: d.consultations,
    };
  }
  return g.__aanganMem;
}

function memoryStore(): Store {
  return {
    demo: true,
    async load(role) {
      const m = mem();
      const founder = role === 'founder';
      return {
        enquiries: founder ? m.enquiries.map(redactEnquiry) : m.enquiries,
        escalations: founder ? m.escalations.map(redactEscalation) : m.escalations,
        pricingLogs: founder ? m.pricing_logs.map((p) => ({ ...p, client_facing_response: '' })) : m.pricing_logs,
        transcriptCosts: m.transcripts.map((t) => ({ enquiry_id: t.enquiry_id, ai_cost_inr: t.ai_cost_inr })),
        toolCosts: m.tool_costs,
        designers: founder ? [] : m.designers,
        outboundEmails: founder ? [] : m.outbound_emails,
        consultations: founder ? m.consultations.map((c) => ({ ...c, location: null, notes: null, google_event_id: null, ics_uid: '', created_by: null })) : m.consultations,
        demo: true,
      };
    },
    async transcriptFor(enquiryId) {
      return mem().transcripts.find((t) => t.enquiry_id === enquiryId) ?? null;
    },
    async insert(table, rows) {
      const arr = (Array.isArray(rows) ? rows : [rows]) as never[];
      (mem()[table] as unknown[]).push(...arr);
    },
    async update(table, id, patch) {
      const row = (mem()[table] as { id: string }[]).find((r) => r.id === id);
      if (!row) throw new Error(`No ${table} row ${id}`);
      Object.assign(row, patch);
    },
    async enquiryExists(sourceRef) {
      return mem().enquiries.some((e) => e.source_ref === sourceRef);
    },
    async getEnquiry(id) {
      return mem().enquiries.find((e) => e.id === id) ?? null;
    },
    async getPricing(enquiryId) {
      return mem().pricing_logs.find((p) => p.enquiry_id === enquiryId) ?? null;
    },
    async getEscalation(id) {
      return mem().escalations.find((e) => e.id === id) ?? null;
    },
    async escalationsFor(enquiryId) {
      return mem().escalations.filter((e) => e.enquiry_id === enquiryId);
    },
    async listDesigners() {
      return mem().designers.filter((d) => d.active);
    },
    async designerLoad() {
      const out: Record<string, number> = {};
      for (const e of mem().enquiries) if (e.status === 'handed_off' && e.designer_id) out[e.designer_id] = (out[e.designer_id] ?? 0) + 1;
      return out;
    },
    async consultationsFrom(from) {
      return mem().consultations.filter((c) => new Date(c.ends_at) >= from).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    },
    async getConsultation(id) {
      return mem().consultations.find((c) => c.id === id) ?? null;
    },
    async unrespondedBefore(cutoff) {
      const floor = new Date(cutoff.getTime() - 14 * 24 * 3_600_000);
      return mem().enquiries.filter(
        (e) => !e.first_response_at && new Date(e.received_at) < cutoff && new Date(e.received_at) >= floor && ['new', 'escalated'].includes(e.status)
          && e.ai_qualification !== 'unqualified' && e.ai_qualification !== 'not_applicable',
      );
    },
  };
}

let _store: Store | null = null;
export function getStore(): Store {
  const db = getAdmin();
  if (db) return (_store = _store && !_store.demo ? _store : supabaseStore(db));
  return (_store = _store && _store.demo ? _store : memoryStore());
}

export const isDemoMode = () => getAdmin() === null;
