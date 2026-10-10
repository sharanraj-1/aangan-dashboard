// Business operations shared by the server actions (designer clicks) and the ingest pipeline (automation).
// Every function takes the Store, so it behaves identically against Supabase and the in-memory demo store.
// Functions return { ok, message } style results instead of throwing for expected failures, so the UI can show them.

import { randomUUID } from 'node:crypto';
import { buildDesignerBrief } from './brief';
import { CONSULT_MINUTES, buildIcs, createGoogleEvent, deleteGoogleEvent, findConflict, outsideStudioHours } from './calendar';
import { STUDIO, composeClientEmail, computeCallbackAt, isValidEmail } from './client-email';
import { formatDateTime } from './format';
import { isHubSpotConfigured, syncEnquiryToHubSpot } from './hubspot';
import { notifyEscalation, sendClientEmail, sendInternalEmail, sendTelegram } from './notify';
import type { Store } from './store';
import type {
  ConsultationMode, ConsultationRow, DesignerRow, EmailTemplate, EnquiryRow, EscalationRow, OutboundEmailRow,
} from './types';

export interface Result<T = undefined> { ok: boolean; message: string; data?: T }
const ok = <T = undefined>(message: string, data?: T): Result<T> => ({ ok: true, message, data });
const fail = <T = undefined>(message: string): Result<T> => ({ ok: false, message });
const iso = (d = new Date()) => d.toISOString();

// ------------------------------------------------------------------------------------------ assignment

/** Least-loaded active designer. Big / founder-connected leads prefer senior designers and the principal. */
export async function pickDesigner(store: Store, e: Pick<EnquiryRow, 'priority_flags'>): Promise<DesignerRow | null> {
  const [pool0, load] = await Promise.all([store.listDesigners(), store.designerLoad()]);
  const senior = e.priority_flags.includes('large_project') || e.priority_flags.includes('founder_connection');
  const pool = senior && pool0.some((d) => d.role !== 'designer') ? pool0.filter((d) => d.role !== 'designer') : pool0;
  return [...pool].sort((a, b) => (load[a.id] ?? 0) - (load[b.id] ?? 0) || a.name.localeCompare(b.name))[0] ?? null;
}

export async function assignDesigner(store: Store, enquiryId: string, designerId: string): Promise<Result> {
  const designers = await store.listDesigners();
  const d = designers.find((x) => x.id === designerId);
  if (!d) return fail('Designer not found.');
  await store.update('enquiries', enquiryId, { designer_id: d.id, designer_name: d.name });
  return ok(`Assigned to ${d.name}.`);
}

// ------------------------------------------------------------------------------------------ handoff

const blockingOpen = (escs: EscalationRow[]) => escs.filter((x) => x.status !== 'resolved' && (x.kind === 'transcription' || x.kind === 'lead_qualification' || (x.kind === 'pricing' && x.trigger !== 'agent_policy_breach') || x.trigger === 'existing_client_complaint' || x.trigger === 'missed_call'));

/**
 * Send the structured Designer Brief to the designer channel and mark the enquiry handed off.
 * Refuses while the enquiry is held by an unresolved gate / qualification / pricing escalation.
 */
export async function releaseHandoff(store: Store, enquiryId: string, actor: string, designerId?: string | null): Promise<Result<{ designer: DesignerRow | null }>> {
  const e = await store.getEnquiry(enquiryId);
  if (!e) return fail('Enquiry not found.');
  const decision = e.final_qualification ?? e.ai_qualification;
  if (decision !== 'qualified') return fail('Only qualified enquiries can be handed to a designer.');
  const open = blockingOpen(await store.escalationsFor(enquiryId)).filter((x) => x.kind !== 'lead_qualification' || e.final_qualification !== 'qualified');
  if (open.length) return fail(`Held by ${open.length} open escalation(s) — resolve them first.`);

  const designers = await store.listDesigners();
  let designer = designerId ? designers.find((d) => d.id === designerId) ?? null : designers.find((d) => d.id === e.designer_id) ?? null;
  if (!designer) designer = await pickDesigner(store, e);

  const pricing = await store.getPricing(enquiryId);
  const brief = buildDesignerBrief({ ...e, designer_name: designer?.name ?? null }, pricing);
  const sent: string[] = [];
  if (await sendTelegram('designers', brief.telegramHtml)) sent.push('telegram');
  if (await sendInternalEmail('designers', brief.subject, brief.emailHtml, brief.text)) sent.push('email');

  await store.update('enquiries', enquiryId, {
    status: 'handed_off', handoff_status: 'sent', handoff_sent_at: iso(),
    designer_id: designer?.id ?? null, designer_name: designer?.name ?? null,
  });
  await syncCrm(store, enquiryId);
  return ok(`Brief released${designer ? ` to ${designer.name}` : ''}${sent.length ? ` (${sent.join(' + ')})` : ' (no alert channel configured — visible on the dashboard)'}.`, { designer });
}

export async function setHandoffState(store: Store, enquiryId: string, action: 'accept' | 'decline' | 'reasked'): Promise<Result> {
  if (action === 'accept') await store.update('enquiries', enquiryId, { handoff_status: 'accepted', handoff_accepted_at: iso() });
  else if (action === 'decline') await store.update('enquiries', enquiryId, { handoff_status: 'declined', designer_id: null, designer_name: null });
  else await store.update('enquiries', enquiryId, { designer_reasked: true });
  return ok(action === 'accept' ? 'Handoff accepted.' : action === 'decline' ? 'Handoff declined — returned to the pool.' : 'Marked: designer had to re-ask basics.');
}

// ------------------------------------------------------------------------------------------ escalations & overrides

export type Decision = 'qualify' | 'reject' | 'approve_ai' | 'dismiss';

/** Resolve one escalation. `qualify` / `reject` / `approve_ai` set the enquiry's FINAL qualification (the override signal). */
export async function resolveEscalation(store: Store, escalationId: string, decision: Decision, note: string, actor: string): Promise<Result> {
  const esc = await store.getEscalation(escalationId);
  if (!esc) return fail('Escalation not found.');
  if (esc.status === 'resolved') return fail('Already resolved.');
  const e = await store.getEnquiry(esc.enquiry_id);
  if (!e) return fail('Enquiry not found.');

  let final: 'qualified' | 'unqualified' | null = null;
  let resolution: EscalationRow['resolution'];
  if (decision === 'qualify') { final = 'qualified'; resolution = 'qualified'; }
  else if (decision === 'reject') { final = 'unqualified'; resolution = 'unqualified'; }
  else if (decision === 'approve_ai') {
    if (e.ai_qualification !== 'qualified' && e.ai_qualification !== 'unqualified') return fail('The AI made no qualify/decline call to approve — choose Qualify or Reject.');
    final = e.ai_qualification; resolution = 'approved_ai';
  } else resolution = 'dismissed';

  const now = iso();
  await store.update('escalations', esc.id, { status: 'resolved', resolved_at: now, resolved_by: actor, resolution, resolution_note: note || null });

  if (final) {
    await store.update('enquiries', e.id, { final_qualification: final, final_decided_by: actor, final_decided_at: now, override_note: note || null });
    // A human qualification call makes the other qualification-level escalations on this enquiry moot.
    for (const sib of await store.escalationsFor(e.id)) {
      if (sib.id !== esc.id && sib.status !== 'resolved' && (sib.kind === 'transcription' || sib.kind === 'lead_qualification')) {
        await store.update('escalations', sib.id, { status: 'resolved', resolved_at: now, resolved_by: actor, resolution, resolution_note: `Resolved together with ${esc.trigger}` });
      }
    }
    if (final === 'unqualified') {
      await store.update('enquiries', e.id, { status: 'closed' });
    } else {
      const still = blockingOpen(await store.escalationsFor(e.id));
      if (still.length === 0 && e.handoff_status === 'not_sent') {
        const r = await releaseHandoff(store, e.id, actor);
        await syncCrm(store, e.id);
        return ok(`Resolved: qualified. ${r.message}`);
      }
      await store.update('enquiries', e.id, { status: still.length ? 'escalated' : e.status === 'escalated' ? 'new' : e.status });
    }
    await syncCrm(store, e.id);
    return ok(final === 'qualified' ? 'Resolved: qualified.' : 'Resolved: rejected — enquiry closed.');
  }
  return ok('Resolved: dismissed.');
}

export async function acknowledgeEscalation(store: Store, escalationId: string, actor: string): Promise<Result> {
  const esc = await store.getEscalation(escalationId);
  if (!esc || esc.status !== 'open') return fail('Nothing to acknowledge.');
  await store.update('escalations', escalationId, { status: 'acknowledged', acknowledged_at: iso(), resolved_by: null });
  void actor;
  return ok('Acknowledged.');
}

/** Flip a decision after the fact: designer says the lead was bad (false positive) or rescues a declined one (false negative). */
export async function overrideQualification(store: Store, enquiryId: string, to: 'qualified' | 'unqualified', note: string, actor: string): Promise<Result> {
  const e = await store.getEnquiry(enquiryId);
  if (!e) return fail('Enquiry not found.');
  await store.update('enquiries', enquiryId, {
    final_qualification: to, final_decided_by: actor, final_decided_at: iso(), override_note: note || null,
    status: to === 'unqualified' ? 'closed' : e.status === 'closed' ? 'new' : e.status,
  });
  await syncCrm(store, enquiryId);
  return ok(to === 'qualified' ? 'Marked as a good lead.' : 'Marked as a bad lead.');
}

// ------------------------------------------------------------------------------------------ response & outcome

export async function markResponded(store: Store, enquiryId: string, at: Date = new Date()): Promise<Result> {
  const e = await store.getEnquiry(enquiryId);
  if (!e) return fail('Enquiry not found.');
  if (e.first_response_at) return fail('First response already recorded.');
  await store.update('enquiries', enquiryId, { first_response_at: at.toISOString() });
  return ok(`First response recorded (${formatDateTime(at)}).`);
}

export async function setOutcome(store: Store, enquiryId: string, outcome: 'won' | 'lost', opts: { valueInr?: number | null; reason?: string }, actor: string): Promise<Result> {
  const e = await store.getEnquiry(enquiryId);
  if (!e) return fail('Enquiry not found.');
  if (outcome === 'won' && (!opts.valueInr || opts.valueInr <= 0)) return fail('Enter the signed project value to mark a win.');
  await store.update('enquiries', enquiryId, {
    status: outcome, final_value_inr: outcome === 'won' ? Math.round(opts.valueInr!) : null, closed_reason: opts.reason || null,
    ...(e.final_qualification ? {} : { final_qualification: 'qualified', final_decided_by: actor, final_decided_at: iso() }),
  });
  await syncCrm(store, enquiryId);
  return ok(outcome === 'won' ? 'Marked won.' : 'Marked lost.');
}

// ------------------------------------------------------------------------------------------ consultations (calendar)

export interface BookingInput {
  enquiryId: string;
  designerId: string | null;
  start: Date;
  minutes?: number;
  mode: ConsultationMode;
  location?: string | null;
  notes?: string | null;
}

export async function bookConsultation(store: Store, b: BookingInput, actor: string): Promise<Result<{ consultation: ConsultationRow; warnings: string[] }>> {
  const e = await store.getEnquiry(b.enquiryId);
  if (!e) return fail('Enquiry not found.');
  if (b.start.getTime() < Date.now() - 5 * 60_000) return fail('That time is in the past.');
  const end = new Date(b.start.getTime() + (b.minutes ?? CONSULT_MINUTES) * 60_000);
  const existing = await store.consultationsFrom(new Date(b.start.getTime() - 24 * 3_600_000));
  const conflict = findConflict(b.designerId, b.start, end, existing);
  if (conflict) return fail(`Double-booking: that designer already has a consultation at ${formatDateTime(conflict.starts_at)}.`);

  const designers = await store.listDesigners();
  const designer = designers.find((d) => d.id === b.designerId) ?? null;
  const warnings: string[] = [];
  if (outsideStudioHours(b.start)) warnings.push('Outside normal studio hours — confirm with the client and the designer.');

  const row: ConsultationRow = {
    id: randomUUID(), enquiry_id: b.enquiryId, designer_id: designer?.id ?? null, starts_at: b.start.toISOString(), ends_at: end.toISOString(),
    mode: b.mode, location: b.location || e.location, status: 'scheduled', notes: b.notes ?? null, google_event_id: null, ics_uid: randomUUID(), created_by: actor, created_at: iso(),
  };
  await store.insert('consultations', row);
  if (designer && !e.designer_id) await store.update('enquiries', e.id, { designer_id: designer.id, designer_name: designer.name });

  // Google Calendar (optional). Client is only invited by Google if explicitly enabled.
  const attendees = [designer?.email, process.env.GOOGLE_INVITE_CLIENT === 'true' ? e.client_email : null].filter(isValidEmail).filter((a) => !/\.example$/i.test(a));
  const g = await createGoogleEvent({
    summary: `Consultation — ${e.client_name ?? 'New enquiry'}${e.location ? ` (${e.location})` : ''}`,
    description: [e.summary, designer ? `Designer: ${designer.name}` : null, e.client_phone ? `Phone: ${e.client_phone}` : null].filter(Boolean).join('\n'),
    location: row.location ?? undefined, start: b.start, end, attendeeEmails: attendees,
  });
  if (g.ok) { row.google_event_id = g.id; await store.update('consultations', row.id, { google_event_id: g.id }); }
  else if (!/not configured/i.test(g.error)) warnings.push(`Saved, but Google Calendar sync failed: ${g.error}`);

  await syncCrm(store, e.id);
  return ok(`Consultation booked for ${formatDateTime(b.start)}.`, { consultation: row, warnings });
}

export async function cancelConsultation(store: Store, consultationId: string): Promise<Result> {
  const c = await store.getConsultation(consultationId);
  if (!c) return fail('Consultation not found.');
  await store.update('consultations', consultationId, { status: 'cancelled' });
  if (c.google_event_id) await deleteGoogleEvent(c.google_event_id);
  await syncCrm(store, c.enquiry_id);
  return ok('Consultation cancelled.');
}

export async function setConsultationStatus(store: Store, consultationId: string, status: 'completed' | 'no_show'): Promise<Result> {
  await store.update('consultations', consultationId, { status });
  return ok(status === 'completed' ? 'Marked as held.' : 'Marked as no-show.');
}

// ------------------------------------------------------------------------------------------ client email

export interface EmailPrep {
  to: string | null;
  designer: DesignerRow | null;
  consultation: ConsultationRow | null;
  callbackAt: Date | null;
  composed: ReturnType<typeof composeClientEmail>;
}

export async function prepareClientEmail(
  store: Store,
  enquiryId: string,
  template: EmailTemplate,
  opts: { designerId?: string | null; callbackAt?: Date | null; question?: string | null; note?: string | null } = {},
): Promise<EmailPrep | null> {
  const e = await store.getEnquiry(enquiryId);
  if (!e) return null;
  const now = new Date();
  const designers = await store.listDesigners();
  const designer = designers.find((d) => d.id === (opts.designerId ?? e.designer_id)) ?? null;
  const consults = (await store.consultationsFrom(new Date(now.getTime() - 90 * 24 * 3_600_000))).filter((c) => c.enquiry_id === enquiryId && c.status === 'scheduled');
  const consultation = consults.find((c) => new Date(c.starts_at) > now) ?? null;
  const callbackAt = opts.callbackAt ?? (consultation ? null : computeCallbackAt(now));
  let question = opts.question ?? null;
  if (template === 'clarification' && !question) question = (await store.escalationsFor(enquiryId)).find((x) => x.suggested_question)?.suggested_question ?? null;
  const composed = composeClientEmail({
    template, enquiry: e, designer, callbackAt, now, question, note: opts.note ?? null,
    consultation: consultation ? { startsAt: new Date(consultation.starts_at), mode: consultation.mode, location: consultation.location } : null,
  });
  return { to: isValidEmail(e.client_email) ? e.client_email.trim() : null, designer, consultation, callbackAt, composed };
}

/** Compose, lint, (optionally) send, and record the email. Only a real send counts as the first response. */
export async function sendEmailToClient(
  store: Store,
  enquiryId: string,
  template: EmailTemplate,
  opts: { designerId?: string | null; callbackAt?: Date | null; question?: string | null; note?: string | null },
  actor: string,
): Promise<Result<{ status: OutboundEmailRow['status'] }>> {
  const prep = await prepareClientEmail(store, enquiryId, template, opts);
  if (!prep) return fail('Enquiry not found.');
  if (!prep.to) return fail('No valid email address on this enquiry.');
  if (prep.composed.blockers.length) return fail(`Not sent: ${prep.composed.blockers.join(' ')}`);
  // A placeholder designer has fake contact details — never let one reach a real client.
  if (prep.designer?.is_sample && process.env.CLIENT_EMAIL_MODE === 'live') {
    return fail(`Not sent: ${prep.designer.name} is a sample designer with placeholder contact details. Assign a real designer first.`);
  }
  const e = (await store.getEnquiry(enquiryId))!;

  const attachments = prep.consultation && template === 'confirmation' && prep.designer
    ? [{
        filename: 'aangan-consultation.ics', content_type: 'text/calendar; method=PUBLISH',
        content: Buffer.from(buildIcs({
          uid: prep.consultation.ics_uid, start: new Date(prep.consultation.starts_at), end: new Date(prep.consultation.ends_at),
          summary: `Aangan Studio consultation with ${prep.designer.name}`,
          description: `Designer: ${prep.designer.name}${prep.designer.phone ? ` · ${prep.designer.phone}` : ''}\nYou can reply to the confirmation email to reschedule.`,
          location: prep.consultation.location ?? undefined,
        })).toString('base64'),
      }]
    : undefined;

  const r = await sendClientEmail({ to: prep.to, subject: prep.composed.subject, html: prep.composed.html, text: prep.composed.text, replyTo: prep.designer?.email ?? STUDIO.email, attachments });
  const row: OutboundEmailRow = {
    id: randomUUID(), enquiry_id: enquiryId, template, to_email: prep.to, subject: prep.composed.subject, body_text: prep.composed.text, body_html: prep.composed.html,
    designer_id: prep.designer?.id ?? null, callback_at: prep.callbackAt ? prep.callbackAt.toISOString() : null,
    status: r.status, provider_id: r.providerId ?? null, error: r.error ?? null, sent_by: actor, created_at: iso(),
  };
  await store.insert('outbound_emails', row);
  if (r.status === 'failed') return fail(`Email failed: ${r.error}`);

  if (r.status === 'sent') {
    if (!e.first_response_at) await store.update('enquiries', enquiryId, { first_response_at: iso() });
    if (template === 'confirmation' && prep.designer && !e.designer_id) await store.update('enquiries', enquiryId, { designer_id: prep.designer.id, designer_name: prep.designer.name });
    return ok(`Email sent to ${prep.to}.`, { status: 'sent' });
  }
  return ok(`Dry run: email recorded but NOT sent (set CLIENT_EMAIL_MODE=live with a Resend key to send).`, { status: 'dry_run' });
}

// ------------------------------------------------------------------------------------------ CRM

export async function syncCrm(store: Store, enquiryId: string): Promise<void> {
  if (!isHubSpotConfigured()) return;
  try {
    const e = await store.getEnquiry(enquiryId);
    if (!e) return;
    const designers = await store.listDesigners();
    const consults = (await store.consultationsFrom(new Date(Date.now() - 90 * 24 * 3_600_000))).filter((c) => c.enquiry_id === enquiryId && c.status !== 'cancelled');
    const r = await syncEnquiryToHubSpot(e, { designer: designers.find((d) => d.id === e.designer_id) ?? null, consultation: consults[0] ?? null });
    if (r.skipped) return;
    await store.update('enquiries', enquiryId, r.ok
      ? { hubspot_contact_id: r.contactId, hubspot_deal_id: r.dealId, hubspot_synced_at: iso(), hubspot_error: null }
      : { hubspot_error: r.error ?? 'Unknown HubSpot error' });
  } catch (err) {
    await store.update('enquiries', enquiryId, { hubspot_error: err instanceof Error ? err.message : String(err) }).catch(() => undefined);
  }
}

export { notifyEscalation };
