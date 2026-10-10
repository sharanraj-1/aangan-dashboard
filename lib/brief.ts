// Structured Designer Brief handoff card (Telegram / email). Fixes the "blind forward" problem: the designer
// gets the verified scope, contact, style, timeline and a synthesised summary — never a raw forwarded message.
//
// INTERNAL ONLY. The indicative range is for the designer's calibration; it must never be quoted to a client.

import { escapeHtml, formatDateTime, formatRange, pct, titleCase } from './format';
import type { EnquiryRow, PricingLogRow } from './types';

export interface Brief {
  subject: string;
  /** Plain text (also used in logs / dry-run). */
  text: string;
  /** Telegram HTML parse-mode. */
  telegramHtml: string;
  emailHtml: string;
}

const dash = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '—' : String(v));

export function buildDesignerBrief(e: EnquiryRow, pricing: PricingLogRow | null): Brief {
  const contact = [e.client_phone, e.client_email].filter(Boolean).join(' · ') || '— (see telephony log)';
  const timeline = e.timeline_text ?? 'Not stated';
  const style = e.style_preferences.length ? e.style_preferences.join(', ') : 'Not stated';
  const scope = [e.scope_summary, e.area_sqft ? `~${e.area_sqft.toLocaleString('en-IN')} sq ft carpet` : null, e.location].filter(Boolean).join(' · ') || 'Not stated';
  const flags = e.priority_flags.filter((f) => f !== 'after_hours').map(titleCase);
  const verified = e.final_decided_by ? `Verified by ${e.final_decided_by}` : `AI-extracted (confidence ${e.composite_confidence !== null ? pct(e.composite_confidence) : 'n/a'})`;

  const rows: [string, string][] = [
    ['Client', dash(e.client_name)],
    ['Contact', contact],
    ['Verified scope', scope],
    ['Style preferences', style],
    ['Timeline', timeline],
    ['Channel / received', `${titleCase(e.channel)} · ${formatDateTime(e.received_at)}`],
    ['Referral', dash(e.referral_source)],
  ];
  const notes = e.open_questions;
  const internal = pricing && (pricing.indicative_low_inr || pricing.indicative_high_inr)
    ? `INTERNAL indicative range ${formatRange(pricing.indicative_low_inr, pricing.indicative_high_inr)} — do NOT quote. Client budget: ${pricing.budget_low_inr ? formatRange(pricing.budget_low_inr, pricing.budget_high_inr) : 'not volunteered'}.`
    : null;

  const subject = `New brief: ${e.client_name ?? 'Unnamed enquirer'} — ${e.location ?? 'location TBC'}`;

  const text = [
    `DESIGNER BRIEF — ${e.source_ref ?? e.id.slice(0, 8)}`,
    ...(flags.length ? [`Priority: ${flags.join(', ')}`] : []),
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'Summary:',
    e.summary ?? '—',
    ...(notes.length ? ['', 'Notes:', ...notes.map((n) => `• ${n}`)] : []),
    ...(internal ? ['', internal] : []),
    '',
    verified,
  ].join('\n');

  const tgRows = rows.map(([k, v]) => `<b>${escapeHtml(k)}:</b> ${escapeHtml(v)}`).join('\n');
  const telegramHtml = [
    `<b>📐 DESIGNER BRIEF</b> · ${escapeHtml(e.source_ref ?? e.id.slice(0, 8))}`,
    ...(flags.length ? [`⭐ ${escapeHtml(flags.join(' · '))}`] : []),
    '',
    tgRows,
    '',
    `<b>Summary</b>\n${escapeHtml(e.summary ?? '—')}`,
    ...(notes.length ? ['', `<b>Notes</b>\n${notes.map((n) => `• ${escapeHtml(n)}`).join('\n')}`] : []),
    ...(internal ? ['', `<i>${escapeHtml(internal)}</i>`] : []),
    '',
    `<i>${escapeHtml(verified)}</i>`,
  ].join('\n');

  const emailRows = rows
    .map(([k, v]) => `<tr><td style="padding:6px 14px 6px 0;color:#666;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:6px 0;font-weight:600">${escapeHtml(v)}</td></tr>`)
    .join('');
  const emailHtml =
    `<div style="font-family:Helvetica,Arial,sans-serif;max-width:600px;color:#111">` +
    `<div style="background:#111;color:#fff;padding:14px 18px;font-weight:700;letter-spacing:.06em">DESIGNER BRIEF · ${escapeHtml(e.source_ref ?? e.id.slice(0, 8))}</div>` +
    `<div style="border:1px solid #111;border-top:0;padding:16px 18px">` +
    (flags.length ? `<div style="color:#c2410c;font-weight:700;margin-bottom:8px">★ ${escapeHtml(flags.join(' · '))}</div>` : '') +
    `<table style="border-collapse:collapse;font-size:14px">${emailRows}</table>` +
    `<p style="margin:14px 0 4px;font-weight:700">Summary</p><p style="margin:0;line-height:1.5">${escapeHtml(e.summary ?? '—')}</p>` +
    (notes.length ? `<p style="margin:14px 0 4px;font-weight:700">Notes</p><ul style="margin:0;padding-left:18px">${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : '') +
    (internal ? `<p style="margin:14px 0 0;font-size:12px;color:#8a4b1f"><i>${escapeHtml(internal)}</i></p>` : '') +
    `<p style="margin:14px 0 0;font-size:12px;color:#666">${escapeHtml(verified)}</p>` +
    `</div></div>`;

  return { subject, text, telegramHtml, emailHtml };
}
