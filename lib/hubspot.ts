// HubSpot CRM sync (REST v3, private-app token).
//
// What is synced:   Contact (name / email / phone), one Deal per enquiry whose STAGE tracks the pipeline
//                   (new → qualified → consultation → won / lost), and a Note with the AI summary + scope.
// What is NOT:      transcripts, recordings, the internal pricing range, or declined / non-lead enquiries
//                   (data minimisation — a decline is not a CRM record).
// Failure policy:   HubSpot being down must never block intake. Errors are returned (and stored in
//                   enquiries.hubspot_error), never thrown into the pipeline.
//
// Setup: HubSpot → Settings → Integrations → Private Apps → scopes crm.objects.contacts.read/write,
//        crm.objects.deals.read/write. Put the token in HUBSPOT_ACCESS_TOKEN. Stage IDs default to HubSpot's
//        standard Sales Pipeline; override with HUBSPOT_PIPELINE_ID / HUBSPOT_STAGE_* if yours differs.

import type { ConsultationRow, DesignerRow, EnquiryRow } from './types';

const BASE = 'https://api.hubapi.com';
export const isHubSpotConfigured = () => Boolean(process.env.HUBSPOT_ACCESS_TOKEN);

const STAGES = {
  new: process.env.HUBSPOT_STAGE_NEW || 'appointmentscheduled',
  qualified: process.env.HUBSPOT_STAGE_QUALIFIED || 'qualifiedtobuy',
  consultation: process.env.HUBSPOT_STAGE_CONSULTATION || 'presentationscheduled',
  won: process.env.HUBSPOT_STAGE_WON || 'closedwon',
  lost: process.env.HUBSPOT_STAGE_LOST || 'closedlost',
};
const PIPELINE = process.env.HUBSPOT_PIPELINE_ID || 'default';

// ------------------------------------------------------------------------------------------ pure builders

const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;
export const validEmail = (s: string | null) => (s && EMAIL_RE.test(s.trim()) ? s.trim() : null);
/** Real, dialable number (Vaani masks numbers; "[redacted]" placeholders must not reach the CRM). */
export const validPhone = (s: string | null) => (s && !/[•*x#]/i.test(s) && s.replace(/\D/g, '').length >= 10 ? s.trim() : null);

/** Leads worth a CRM record: qualified, in review, or a human has qualified them. Declines and non-leads are skipped. */
export function shouldSync(e: Pick<EnquiryRow, 'ai_qualification' | 'final_qualification' | 'intent' | 'client_name' | 'client_email' | 'client_phone'>): boolean {
  if (e.final_qualification === 'unqualified') return false;
  if (e.final_qualification !== 'qualified' && (e.ai_qualification === 'unqualified' || e.ai_qualification === 'not_applicable')) return false;
  if (['vendor', 'job_seeker', 'spam', 'wrong_number', 'existing_client_complaint'].includes(e.intent)) return false;
  return Boolean(e.client_name || validEmail(e.client_email) || validPhone(e.client_phone));
}

export function splitName(full: string | null): { firstname?: string; lastname?: string; company?: string } {
  if (!full) return {};
  const company = full.match(/\(([^)]+)\)/)?.[1]?.replace(/^.*?,\s*/, '').trim();
  const name = full.replace(/\(.*?\)/g, '').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { company };
  return { firstname: parts[0], lastname: parts.slice(1).join(' ') || undefined, company };
}

export function contactProperties(e: EnquiryRow): Record<string, string> {
  const n = splitName(e.client_name);
  const props: Record<string, string | undefined> = {
    firstname: n.firstname,
    lastname: n.lastname,
    company: n.company,
    email: validEmail(e.client_email) ?? undefined,
    phone: validPhone(e.client_phone) ?? undefined,
    city: e.location?.split(',').pop()?.trim(),
    lifecyclestage: 'lead',
    hs_lead_status: 'NEW',
  };
  return Object.fromEntries(Object.entries(props).filter(([, v]) => v)) as Record<string, string>;
}

export function dealStageFor(e: Pick<EnquiryRow, 'status' | 'ai_qualification' | 'final_qualification'>, consultation: Pick<ConsultationRow, 'status'> | null): string {
  if (e.status === 'won') return STAGES.won;
  if (e.status === 'lost') return STAGES.lost;
  if (consultation && (consultation.status === 'scheduled' || consultation.status === 'completed')) return STAGES.consultation;
  if (e.final_qualification === 'qualified' || e.ai_qualification === 'qualified') return STAGES.qualified;
  return STAGES.new;
}

const SCOPE: Record<string, string> = { full_home: 'Full home', partial_home: 'Partial home', single_room: 'Single room', office: 'Office fit-out', other: 'Project' };

export function dealProperties(e: EnquiryRow, consultation: ConsultationRow | null, designer: DesignerRow | null): Record<string, string> {
  const name = splitName(e.client_name);
  const who = [name.firstname, name.lastname].filter(Boolean).join(' ') || name.company || 'Enquiry';
  const amount = e.final_value_inr ?? e.estimated_value_inr;
  const desc = [
    e.summary,
    e.scope_summary ? `Scope: ${e.scope_summary}` : null,
    e.location ? `Location: ${e.location}` : null,
    e.timeline_text ? `Timeline: ${e.timeline_text}` : null,
    designer ? `Designer: ${designer.name}` : null,
    `Source: ${e.channel} · ref ${e.source_ref ?? e.id.slice(0, 8)}`,
  ].filter(Boolean).join('\n');
  const props: Record<string, string | undefined> = {
    dealname: [who, e.scope_type ? SCOPE[e.scope_type] : null, e.location?.split(',')[0]].filter(Boolean).join(' — '),
    pipeline: PIPELINE,
    dealstage: dealStageFor(e, consultation),
    amount: amount ? String(Math.round(amount)) : undefined,
    description: desc,
    closedate: e.status === 'won' || e.status === 'lost' ? new Date(e.updated_at).toISOString() : undefined,
  };
  return Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined)) as Record<string, string>;
}

export function noteBody(e: EnquiryRow, designer: DesignerRow | null): string {
  return [
    `Aangan enquiry ${e.source_ref ?? e.id.slice(0, 8)} (${e.channel})`,
    e.summary ?? '',
    ...(e.open_questions.length ? ['Notes for designer:', ...e.open_questions.map((q) => `• ${q}`)] : []),
    ...(e.priority_flags.length ? [`Flags: ${e.priority_flags.join(', ')}`] : []),
    ...(designer ? [`Assigned designer: ${designer.name}`] : []),
  ].filter(Boolean).join('\n');
}

// ------------------------------------------------------------------------------------------ HTTP

class HsError extends Error {}

async function hs<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: { authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new HsError(`HubSpot ${method} ${path} → ${res.status}: ${(json as { message?: string }).message ?? text.slice(0, 200)}`);
  return json as T;
}

async function findContact(e: EnquiryRow): Promise<string | null> {
  const email = validEmail(e.client_email);
  const phone = validPhone(e.client_phone);
  for (const [prop, value] of [['email', email], ['phone', phone]] as const) {
    if (!value) continue;
    const r = await hs<{ results: { id: string }[] }>('POST', '/crm/v3/objects/contacts/search', {
      filterGroups: [{ filters: [{ propertyName: prop, operator: 'EQ', value }] }], limit: 1,
    });
    if (r.results[0]) return r.results[0].id;
  }
  return null;
}

export interface HubSpotResult {
  ok: boolean;
  skipped?: string;
  contactId?: string;
  dealId?: string;
  error?: string;
}

/**
 * Create-or-update the contact and the deal for an enquiry. Idempotent: existing HubSpot ids on the enquiry are
 * reused, so calling it again after a status change just moves the deal stage.
 */
export async function syncEnquiryToHubSpot(
  e: EnquiryRow,
  ctx: { consultation?: ConsultationRow | null; designer?: DesignerRow | null } = {},
): Promise<HubSpotResult> {
  if (!isHubSpotConfigured()) return { ok: false, skipped: 'HubSpot not configured' };
  if (!shouldSync(e)) return { ok: false, skipped: 'Not a lead worth a CRM record' };
  try {
    const props = contactProperties(e);
    let contactId = e.hubspot_contact_id ?? (await findContact(e));
    if (contactId) {
      if (Object.keys(props).length) await hs('PATCH', `/crm/v3/objects/contacts/${contactId}`, { properties: props });
    } else {
      contactId = (await hs<{ id: string }>('POST', '/crm/v3/objects/contacts', { properties: props })).id;
    }

    const dealProps = dealProperties(e, ctx.consultation ?? null, ctx.designer ?? null);
    let dealId = e.hubspot_deal_id;
    if (dealId) {
      await hs('PATCH', `/crm/v3/objects/deals/${dealId}`, { properties: dealProps });
    } else {
      dealId = (
        await hs<{ id: string }>('POST', '/crm/v3/objects/deals', {
          properties: dealProps,
          // 3 = deal → contact (HubSpot-defined association)
          associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] }],
        })
      ).id;
      // First sync only: attach the summary note to the deal (214 = note → deal).
      await hs('POST', '/crm/v3/objects/notes', {
        properties: { hs_note_body: noteBody(e, ctx.designer ?? null), hs_timestamp: new Date().toISOString() },
        associations: [{ to: { id: dealId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 214 }] }],
      });
    }
    return { ok: true, contactId, dealId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
