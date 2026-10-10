// Calendar: consultation scheduling helpers.
//
//  • Always available (no credentials): conflict detection, slot suggestions, and an RFC 5545 .ics file that is
//    attached to the client's confirmation email so the booking lands in whatever calendar they use.
//  • Optional Google Calendar sync (OAuth refresh token — a service account can't invite attendees without
//    Workspace domain-wide delegation, so we use the studio account's refresh token): creates the event on the
//    studio calendar and can read free/busy so designers aren't double-booked against their own calendars.
//
// Outward-facing safety: the CLIENT is only added as a Google attendee (which makes Google email them) when
// GOOGLE_INVITE_CLIENT=true. Default is to send the .ics via the reviewed confirmation email instead.

import { createSign } from 'node:crypto';
import { BUSINESS_HOURS } from './config';
import { istParts } from './guardrails';
import type { ConsultationRow } from './types';

export const CONSULT_MINUTES = 60;
const TZ = BUSINESS_HOURS.tz;

// ------------------------------------------------------------------------------------------ conflicts

export const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && bStart < aEnd;

/** First active consultation for the same designer that overlaps [start, end). */
export function findConflict(
  designerId: string | null,
  start: Date,
  end: Date,
  existing: Pick<ConsultationRow, 'id' | 'designer_id' | 'starts_at' | 'ends_at' | 'status'>[],
  excludeId?: string,
): typeof existing[number] | null {
  if (!designerId) return null;
  return (
    existing.find(
      (c) =>
        c.id !== excludeId &&
        c.designer_id === designerId &&
        c.status === 'scheduled' &&
        overlaps(start, end, new Date(c.starts_at), new Date(c.ends_at)),
    ) ?? null
  );
}

// ------------------------------------------------------------------------------------------ slot suggestions

const SLOT_TIMES: [number, number][] = [[10, 30], [12, 0], [15, 0], [16, 30]];
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const istDate = (ymd: string, h: number, m: number) => new Date(`${ymd}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+05:30`);

/** Next open consultation slots for a designer (working days, four slots a day), skipping anything already booked. */
export function suggestSlots(
  designerId: string | null,
  from: Date,
  existing: Pick<ConsultationRow, 'id' | 'designer_id' | 'starts_at' | 'ends_at' | 'status'>[],
  count = 6,
): Date[] {
  const out: Date[] = [];
  const earliest = new Date(from.getTime() + 2 * 3_600_000); // never suggest "in 20 minutes"
  let cursor = from;
  for (let i = 0; i < 21 && out.length < count; i++) {
    const ymd = ymdFmt.format(cursor);
    if ((BUSINESS_HOURS.openDays as readonly number[]).includes(istParts(cursor).day)) {
      for (const [h, m] of SLOT_TIMES) {
        const start = istDate(ymd, h, m);
        const end = new Date(start.getTime() + CONSULT_MINUTES * 60_000);
        if (start >= earliest && !findConflict(designerId, start, end, existing)) out.push(start);
        if (out.length >= count) break;
      }
    }
    cursor = new Date(istDate(ymd, 12, 0).getTime() + 24 * 3_600_000);
  }
  return out;
}

/** True if a booking falls outside normal front-desk hours (allowed — clients often want evenings — but flagged). */
export function outsideStudioHours(start: Date): boolean {
  const { day, hour } = istParts(start);
  return !(BUSINESS_HOURS.openDays as readonly number[]).includes(day) || hour < BUSINESS_HOURS.openHour || hour >= BUSINESS_HOURS.closeHour;
}

// ------------------------------------------------------------------------------------------ ICS

export interface IcsEvent {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  location?: string;
  organizer?: { name: string; email: string };
  attendees?: { name?: string; email: string }[];
  /** 'CANCEL' marks the event cancelled in clients that already have it. Default: REQUEST with an organizer, else PUBLISH. */
  method?: 'REQUEST' | 'CANCEL' | 'PUBLISH';
  sequence?: number;
}

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Fold to ≤75 chars per line as RFC 5545 requires. */
function fold(line: string): string {
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    parts.push(rest.slice(0, 74));
    rest = ' ' + rest.slice(74);
  }
  parts.push(rest);
  return parts.join('\r\n');
}

export function buildIcs(e: IcsEvent): string {
  const method = e.method ?? (e.organizer ? 'REQUEST' : 'PUBLISH');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Aangan Studio//Enquiry Dashboard//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${e.uid}@aangan-dashboard`,
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${utc(e.start)}`,
    `DTEND:${utc(e.end)}`,
    `SEQUENCE:${e.sequence ?? 0}`,
    `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    `SUMMARY:${esc(e.summary)}`,
    ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
    ...(e.location ? [`LOCATION:${esc(e.location)}`] : []),
    ...(e.organizer ? [`ORGANIZER;CN=${esc(e.organizer.name)}:mailto:${e.organizer.email}`] : []),
    ...(e.attendees ?? []).map((a) => `ATTENDEE;CN=${esc(a.name ?? a.email)};ROLE=REQ-PARTICIPANT:mailto:${a.email}`),
    'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', 'DESCRIPTION:Consultation tomorrow', 'END:VALARM',
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:Consultation in 1 hour', 'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ------------------------------------------------------------------------------------------ Google Calendar

const G = {
  clientId: () => process.env.GOOGLE_CLIENT_ID,
  clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
  refreshToken: () => process.env.GOOGLE_REFRESH_TOKEN,
  calendarId: () => process.env.GOOGLE_CALENDAR_ID || 'primary',
};

// Two ways to authenticate (service account preferred — it never expires):
//   1. GOOGLE_SERVICE_ACCOUNT_JSON  — the downloaded key file, raw JSON or base64. Share the studio calendar with the
//      service account's email ("Make changes to events"). Service accounts cannot invite attendees, so in this mode
//      events carry the designer's name in the description instead of an invite.
//   2. GOOGLE_CLIENT_ID / _SECRET / _REFRESH_TOKEN — OAuth as a real user (can invite attendees; note refresh tokens of
//      apps left in "Testing" mode expire after 7 days).
export interface ServiceAccount { email: string; key: string }

export function readServiceAccount(raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON): ServiceAccount | null {
  if (!raw?.trim()) return null;
  try {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw.trim(), 'base64').toString('utf8');
    const j = JSON.parse(text) as { client_email?: string; private_key?: string };
    return j.client_email && j.private_key ? { email: j.client_email, key: j.private_key } : null;
  } catch {
    return null;
  }
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** Signed JWT assertion (RS256) for Google's service-account token exchange. Exported for testing. */
export function buildServiceAccountJwt(sa: ServiceAccount, nowSec = Math.floor(Date.now() / 1000)): string {
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({
    iss: sa.email, scope: 'https://www.googleapis.com/auth/calendar', aud: 'https://oauth2.googleapis.com/token', iat: nowSec, exp: nowSec + 3600,
  }));
  const sig = createSign('RSA-SHA256').update(`${head}.${claim}`).sign(sa.key);
  return `${head}.${claim}.${b64u(sig)}`;
}

export const googleMode = (): 'service_account' | 'oauth' | null =>
  readServiceAccount() ? 'service_account' : G.clientId() && G.clientSecret() && G.refreshToken() ? 'oauth' : null;

export const isGoogleCalendarConfigured = () => googleMode() !== null;

let tokenCache: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 30_000) return tokenCache.token;
  const sa = readServiceAccount();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: sa
      ? new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: buildServiceAccountJwt(sa) })
      : new URLSearchParams({ client_id: G.clientId()!, client_secret: G.clientSecret()!, refresh_token: G.refreshToken()!, grant_type: 'refresh_token' }),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(`Google auth failed: ${j.error_description ?? res.status}`);
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return tokenCache.token;
}

export type CalResult = { ok: true; id: string } | { ok: false; error: string };

export async function createGoogleEvent(e: {
  summary: string; description?: string; location?: string; start: Date; end: Date; attendeeEmails?: string[];
}): Promise<CalResult> {
  if (!isGoogleCalendarConfigured()) return { ok: false, error: 'Google Calendar not configured' };
  // Service accounts can't invite attendees (Google rejects it) — drop them in that mode.
  const attendees = googleMode() === 'oauth' ? e.attendeeEmails : undefined;
  try {
    const token = await accessToken();
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(G.calendarId())}/events?sendUpdates=${attendees?.length ? 'all' : 'none'}`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          summary: e.summary,
          description: e.description,
          location: e.location,
          start: { dateTime: e.start.toISOString(), timeZone: TZ },
          end: { dateTime: e.end.toISOString(), timeZone: TZ },
          attendees: attendees?.map((email) => ({ email })),
          reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }, { method: 'popup', minutes: 1440 }] },
        }),
      },
    );
    const j = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    return res.ok && j.id ? { ok: true, id: j.id } : { ok: false, error: j.error?.message ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteGoogleEvent(eventId: string): Promise<CalResult> {
  if (!isGoogleCalendarConfigured()) return { ok: false, error: 'Google Calendar not configured' };
  try {
    const token = await accessToken();
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(G.calendarId())}/events/${encodeURIComponent(eventId)}?sendUpdates=none`, {
      method: 'DELETE', headers: { authorization: `Bearer ${token}` },
    });
    return res.ok || res.status === 410 ? { ok: true, id: eventId } : { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Busy intervals on a calendar (designer's own email, or the studio calendar). Empty list on any failure. */
export async function googleBusy(calendarId: string, from: Date, to: Date): Promise<{ start: Date; end: Date }[]> {
  if (!isGoogleCalendarConfigured()) return [];
  try {
    const token = await accessToken();
    const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: calendarId }] }),
    });
    const j = (await res.json()) as { calendars?: Record<string, { busy?: { start: string; end: string }[] }> };
    return (j.calendars?.[calendarId]?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  } catch {
    return [];
  }
}
