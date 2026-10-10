'use server';

// Server actions behind every button. All are DESIGNER-ONLY (the founder role is read-only and never reaches client data).
// Each action: authorise → validate → call lib/workflow.ts → revalidate → redirect back with a status message.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireDesigner } from '@/lib/auth';
import { getStore } from '@/lib/store';
import { runVoiceSync, voiceSyncConfigured } from '@/lib/voice/sync';
import * as wf from '@/lib/workflow';
import type { ConsultationMode, EmailTemplate } from '@/lib/types';

const str = (f: FormData, k: string): string => String(f.get(k) ?? '').trim();
const opt = (f: FormData, k: string): string | null => str(f, k) || null;
/** 'YYYY-MM-DDTHH:mm' from <input type="datetime-local">, interpreted as IST. */
const ist = (v: string | null): Date | null => {
  if (!v || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const d = new Date(`${v}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
};

function back(f: FormData, r: wf.Result<unknown>): never {
  revalidatePath('/');
  const raw = str(f, 'return_to');
  const target = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
  const u = new URL(target, 'http://local');
  u.searchParams.set('msg', r.message);
  u.searchParams.set('ok', r.ok ? '1' : '0');
  redirect(u.pathname + u.search);
}

export async function resolveEscalationAction(f: FormData) {
  const actor = await requireDesigner();
  const decision = str(f, 'decision') as wf.Decision;
  if (!['qualify', 'reject', 'approve_ai', 'dismiss'].includes(decision)) return back(f, { ok: false, message: 'Unknown decision.' });
  back(f, await wf.resolveEscalation(getStore(), str(f, 'escalation_id'), decision, str(f, 'note').slice(0, 500), actor));
}

export async function acknowledgeEscalationAction(f: FormData) {
  const actor = await requireDesigner();
  back(f, await wf.acknowledgeEscalation(getStore(), str(f, 'escalation_id'), actor));
}

export async function overrideQualificationAction(f: FormData) {
  const actor = await requireDesigner();
  const to = str(f, 'to');
  if (to !== 'qualified' && to !== 'unqualified') return back(f, { ok: false, message: 'Invalid override.' });
  back(f, await wf.overrideQualification(getStore(), str(f, 'enquiry_id'), to, str(f, 'note').slice(0, 500), actor));
}

export async function markRespondedAction(f: FormData) {
  await requireDesigner();
  back(f, await wf.markResponded(getStore(), str(f, 'enquiry_id'), ist(opt(f, 'at')) ?? new Date()));
}

export async function setOutcomeAction(f: FormData) {
  const actor = await requireDesigner();
  const outcome = str(f, 'outcome');
  if (outcome !== 'won' && outcome !== 'lost') return back(f, { ok: false, message: 'Invalid outcome.' });
  const lakh = Number(str(f, 'value_lakh'));
  back(f, await wf.setOutcome(getStore(), str(f, 'enquiry_id'), outcome, { valueInr: Number.isFinite(lakh) && lakh > 0 ? lakh * 100_000 : null, reason: str(f, 'reason').slice(0, 300) }, actor));
}

export async function releaseHandoffAction(f: FormData) {
  const actor = await requireDesigner();
  const r = await wf.releaseHandoff(getStore(), str(f, 'enquiry_id'), actor, opt(f, 'designer_id'));
  back(f, { ok: r.ok, message: r.message });
}

export async function assignDesignerAction(f: FormData) {
  await requireDesigner();
  back(f, await wf.assignDesigner(getStore(), str(f, 'enquiry_id'), str(f, 'designer_id')));
}

export async function handoffStateAction(f: FormData) {
  await requireDesigner();
  const action = str(f, 'action');
  if (action !== 'accept' && action !== 'decline' && action !== 'reasked') return back(f, { ok: false, message: 'Invalid action.' });
  back(f, await wf.setHandoffState(getStore(), str(f, 'enquiry_id'), action));
}

export async function bookConsultationAction(f: FormData) {
  const actor = await requireDesigner();
  const start = ist(opt(f, 'start'));
  if (!start) return back(f, { ok: false, message: 'Pick a valid date and time.' });
  const mode = str(f, 'mode') as ConsultationMode;
  if (!['site_visit', 'studio', 'call'].includes(mode)) return back(f, { ok: false, message: 'Invalid mode.' });
  const minutes = Math.min(240, Math.max(15, Number(str(f, 'minutes')) || 60));
  const r = await wf.bookConsultation(getStore(), {
    enquiryId: str(f, 'enquiry_id'), designerId: opt(f, 'designer_id'), start, minutes, mode, location: opt(f, 'location'), notes: opt(f, 'notes'),
  }, actor);
  back(f, { ok: r.ok, message: r.ok && r.data?.warnings.length ? `${r.message} ${r.data.warnings.join(' ')}` : r.message });
}

export async function cancelConsultationAction(f: FormData) {
  await requireDesigner();
  back(f, await wf.cancelConsultation(getStore(), str(f, 'consultation_id')));
}

export async function consultationStatusAction(f: FormData) {
  await requireDesigner();
  const s = str(f, 'status');
  if (s !== 'completed' && s !== 'no_show') return back(f, { ok: false, message: 'Invalid status.' });
  back(f, await wf.setConsultationStatus(getStore(), str(f, 'consultation_id'), s));
}

export async function sendClientEmailAction(f: FormData) {
  const actor = await requireDesigner();
  const template = str(f, 'template') as EmailTemplate;
  if (!['confirmation', 'clarification', 'decline'].includes(template)) return back(f, { ok: false, message: 'Invalid template.' });
  const r = await wf.sendEmailToClient(getStore(), str(f, 'enquiry_id'), template, {
    designerId: opt(f, 'designer_id'), callbackAt: ist(opt(f, 'callback')), question: opt(f, 'question'), note: opt(f, 'note')?.slice(0, 600) ?? null,
  }, actor);
  back(f, r);
}

export async function syncCallsAction(f: FormData) {
  await requireDesigner();
  if (!voiceSyncConfigured()) return back(f, { ok: false, message: 'The voice agent is not connected yet, so there are no calls to pull in.' });
  const res = await runVoiceSync({ since: new Date(Date.now() - 7 * 24 * 3_600_000), maxCalls: 20 });
  const all = Object.values(res);
  const created = all.reduce((n, r) => n + r.created, 0);
  const pending = all.reduce((n, r) => n + r.pending, 0);
  const errors = all.flatMap((r) => r.errors);
  if (errors.length > 0 && created === 0) return back(f, { ok: false, message: `Could not reach the voice agent: ${errors[0].slice(0, 160)}` });
  const parts = [created === 0 ? 'No new calls.' : `${created} new call${created === 1 ? '' : 's'} added.`];
  if (pending > 0) parts.push(`${pending} still being processed — try again in a minute.`);
  back(f, { ok: true, message: parts.join(' ') });
}
