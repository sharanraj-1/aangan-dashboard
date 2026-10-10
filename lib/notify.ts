// Outbound transport. Everything here is optional: with no credentials configured, calls are logged and
// reported as skipped / dry_run, so local development and demos never send anything real.
//
//   Internal alerts : Telegram bot (preferred) and/or email via Resend
//   Client email    : Resend — only when CLIENT_EMAIL_MODE=live AND RESEND_API_KEY is set

import { escapeHtml, titleCase } from './format';
import type { AssignedTo, EnquiryRow, EscalationRow } from './types';

export type Audience = 'front_desk' | 'founder' | 'designers';

const TELEGRAM_CHAT: Record<Audience, string | undefined> = {
  front_desk: process.env.TELEGRAM_CHAT_ID_FRONT_DESK,
  founder: process.env.TELEGRAM_CHAT_ID_FOUNDER,
  designers: process.env.TELEGRAM_CHAT_ID_DESIGNERS,
};
const ALERT_EMAIL: Record<Audience, string | undefined> = {
  front_desk: process.env.ALERT_EMAIL_FRONT_DESK,
  founder: process.env.ALERT_EMAIL_FOUNDER,
  designers: process.env.ALERT_EMAIL_DESIGNERS,
};

export const audienceFor = (a: AssignedTo): Audience => (a === 'founder' ? 'founder' : a === 'senior_designer' ? 'designers' : 'front_desk');

export async function sendTelegram(aud: Audience, html: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = TELEGRAM_CHAT[aud];
  if (!token || !chat) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: html.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

interface MailResult { status: 'sent' | 'failed' | 'dry_run'; providerId?: string; error?: string }

async function resendSend(payload: Record<string, unknown>): Promise<MailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { status: 'dry_run' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { status: 'failed', error: json.message ?? `HTTP ${res.status}` };
    return { status: 'sent', providerId: json.id };
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendInternalEmail(aud: Audience, subject: string, html: string, text: string): Promise<boolean> {
  const to = ALERT_EMAIL[aud];
  if (!to || !process.env.MAIL_FROM) return false;
  const r = await resendSend({ from: process.env.MAIL_FROM, to: to.split(',').map((s) => s.trim()), subject, html, text });
  return r.status === 'sent';
}

/**
 * Email to an ENQUIRER. Defaults to dry-run: set CLIENT_EMAIL_MODE=live and RESEND_API_KEY to actually send.
 * Addresses on the reserved .example/.invalid/.test domains are never sent (seed data uses them).
 */
export async function sendClientEmail(args: {
  to: string; subject: string; html: string; text: string; replyTo?: string;
  attachments?: { filename: string; content: string; content_type: string }[]; // content = base64
}): Promise<MailResult> {
  if (/\.(example|invalid|test|localhost)$/i.test(args.to.trim())) return { status: 'dry_run' };
  if (process.env.CLIENT_EMAIL_MODE !== 'live' || !process.env.MAIL_FROM) return { status: 'dry_run' };
  return resendSend({
    from: process.env.MAIL_FROM,
    to: [args.to.trim()],
    reply_to: args.replyTo || process.env.STUDIO_EMAIL || undefined,
    subject: args.subject,
    html: args.html,
    text: args.text,
    attachments: args.attachments,
  });
}

/**
 * Alert the owner of an escalation. NOTE the audience split: alerts carry the reason and a one-line summary,
 * never the transcript. The founder in particular only ever receives the outcome-level line.
 */
export async function notifyEscalation(esc: Pick<EscalationRow, 'kind' | 'trigger' | 'severity' | 'assigned_to' | 'reason' | 'suggested_question'>, e: Pick<EnquiryRow, 'client_name' | 'channel' | 'location' | 'source_ref' | 'id'>): Promise<string[]> {
  const aud = audienceFor(esc.assigned_to);
  const sev = { critical: '🚨', high: '🔴', medium: '🟠', low: '🟡' }[esc.severity];
  const who = aud === 'founder' ? `${titleCase(e.channel)} enquiry${e.location ? ` · ${e.location}` : ''}` : `${e.client_name ?? 'Unnamed'} · ${titleCase(e.channel)}${e.location ? ` · ${e.location}` : ''}`;
  const html = [
    `${sev} <b>${escapeHtml(titleCase(esc.trigger))}</b> (${escapeHtml(esc.kind.replace('_', ' '))})`,
    escapeHtml(who),
    escapeHtml(esc.reason),
    ...(esc.suggested_question ? [`<i>Ask: ${escapeHtml(esc.suggested_question)}</i>`] : []),
    `Ref ${escapeHtml(e.source_ref ?? e.id.slice(0, 8))} · assigned to ${escapeHtml(titleCase(esc.assigned_to))}`,
  ].join('\n');
  const text = html.replace(/<[^>]+>/g, '');
  const via: string[] = [];
  if (await sendTelegram(aud, html)) via.push(`telegram:${aud}`);
  if (await sendInternalEmail(aud, `${esc.severity.toUpperCase()}: ${titleCase(esc.trigger)}`, `<pre style="font-family:inherit">${escapeHtml(text)}</pre>`, text)) via.push(`email:${aud}`);
  return via;
}
