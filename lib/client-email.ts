// Client-facing email channel: composes the email sent TO the enquirer.
//
// Safety properties (this text goes to a prospect, so it is deliberately boring and template-driven):
//   • No free-form AI text is interpolated. Only enum-mapped labels, the designer's directory entry, the
//     promised callback time and a few escaped extracted fields (first name, location).
//   • Every body is run through the price-disclosure linter. Nothing with a rupee figure, rate or
//     "starts at" can be sent — pricing.md: "No number … should be quoted to a client."
//   • The designer's optional personal note is escaped AND linted.
//   • The callback time is computed from front-desk hours, so we never promise "within the hour" at 9pm.

import { BUSINESS_HOURS, DECLINE_SCRIPT } from './config';
import { escapeHtml, formatLongDate, formatTime } from './format';
import { isAfterHours, istParts } from './guardrails';
import { containsPriceDisclosure } from './pricing';
import type { Criteria, DesignerRow, EmailTemplate, EnquiryRow, ScopeType } from './types';

export const STUDIO = {
  name: 'Aangan Studio',
  phone: process.env.STUDIO_PHONE || '',
  email: process.env.STUDIO_EMAIL || '',
  address: process.env.STUDIO_ADDRESS || '',
  hours: process.env.STUDIO_HOURS || 'Monday to Saturday, 10:00 am – 7:00 pm',
};

// ------------------------------------------------------------------ callback-time promise

const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_HOURS.tz, year: 'numeric', month: '2-digit', day: '2-digit' });
const pad = (n: number) => String(n).padStart(2, '0');

/** Build a Date from an IST wall-clock time. */
function istDate(ymd: string, hour: number, minute: number): Date {
  return new Date(`${ymd}T${pad(hour)}:${pad(minute)}:00+05:30`);
}

/** The next front-desk opening instant strictly after `from` (e.g. 10:00 am on the next working day). */
export function nextOpeningAfter(from: Date): Date {
  let d = from;
  for (let i = 0; i < 9; i++) {
    const ymd = ymdFmt.format(d);
    const { day } = istParts(d);
    const open = istDate(ymd, BUSINESS_HOURS.openHour, 0);
    if ((BUSINESS_HOURS.openDays as readonly number[]).includes(day) && open > from) return open;
    d = new Date(istDate(ymd, 12, 0).getTime() + 24 * 3_600_000); // noon the next day
  }
  return from;
}

/**
 * When we can honestly promise a callback by: within `withinMinutes` if the desk is open and there is still
 * time before closing, otherwise 30 minutes after the next opening.
 */
export function computeCallbackAt(now: Date, withinMinutes = 60): Date {
  if (!isAfterHours(now)) {
    const target = roundUpTo15(new Date(now.getTime() + withinMinutes * 60_000));
    if (target <= istDate(ymdFmt.format(now), BUSINESS_HOURS.closeHour, 0)) return target;
  }
  return new Date(nextOpeningAfter(now).getTime() + 30 * 60_000);
}

function roundUpTo15(d: Date): Date {
  const ms = 15 * 60_000;
  return new Date(Math.ceil(d.getTime() / ms) * ms);
}

/** "today by 11:30 am", "tomorrow (Wednesday 8 October) by 10:30 am". */
export function describeCallback(at: Date, now: Date): string {
  const today = ymdFmt.format(now);
  const day = ymdFmt.format(at);
  const tomorrow = ymdFmt.format(new Date(now.getTime() + 24 * 3_600_000));
  const time = formatTime(at);
  if (day === today) return `today by ${time}`;
  if (day === tomorrow) return `tomorrow (${formatLongDate(at)}) by ${time}`;
  return `on ${formatLongDate(at)} by ${time}`;
}

// ------------------------------------------------------------------ composition

const SCOPE_LABEL: Record<ScopeType, string> = {
  full_home: 'a full-home interior design project',
  partial_home: 'a redesign of part of your home',
  single_room: 'a single-room redesign',
  office: 'an office fit-out',
  other: 'an interior design project',
};

const ROLE_TITLE: Record<DesignerRow['role'], string> = {
  designer: 'Interior Designer',
  senior_designer: 'Senior Designer',
  principal: 'Principal Designer',
};

const CHANNEL_PHRASE = { phone: 'call', whatsapp: 'WhatsApp message', web_form: 'enquiry form' } as const;

const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;
export const isValidEmail = (s: string | null | undefined): s is string => !!s && EMAIL_RE.test(s.trim());

export function firstName(name: string | null): string | null {
  if (!name) return null;
  const cleaned = name.replace(/\(.*?\)/g, '').trim();
  const first = cleaned.split(/\s+/)[0];
  return first && /^[\p{L}.'-]+$/u.test(first) ? first : null;
}

export interface ComposeInput {
  template: EmailTemplate;
  enquiry: Pick<EnquiryRow, 'client_name' | 'channel' | 'scope_type' | 'location' | 'sentiment' | 'received_at' | 'first_response_at' | 'criteria' | 'open_questions' | 'qualification_reasons'>;
  designer: DesignerRow | null;
  /** When we promise to call. Not needed if a consultation is already booked. */
  callbackAt: Date | null;
  /** A booked consultation / site visit — replaces the callback promise with the confirmed slot. */
  consultation?: { startsAt: Date; mode: 'site_visit' | 'studio' | 'call'; location: string | null } | null;
  now: Date;
  /** The ONE clarifying question (clarification template). Must not probe budget. */
  question?: string | null;
  /** Optional personal line from the designer. Escaped and linted. */
  note?: string | null;
}

export interface ComposedEmail {
  subject: string;
  text: string;
  html: string;
  /** Non-empty means "do not send" (e.g. the linter caught a price, or a required field is missing). */
  blockers: string[];
}

const DECLINE_REASON: Partial<Record<keyof Criteria, string>> = {
  service_area: 'We currently take on projects in Pune city and PCMC only, because our execution depends on our own network of contractors and vendors.',
  timeline: 'Our design and execution process needs a longer runway than your timeline allows, and we would rather be honest than rush your project.',
  real_project: 'Our work is full design and execution together, so we are not the right fit for advice-only or out-of-scope requests.',
  budget: 'Based on the scope you described, we do not think we could do justice to the project in the way we would want to.',
};

export function composeClientEmail(i: ComposeInput): ComposedEmail {
  const blockers: string[] = [];
  const e = i.enquiry;
  const first = firstName(e.client_name);
  const hello = first ? `Hello ${first},` : 'Hello,';
  const delayedHours = e.first_response_at ? (new Date(e.first_response_at).getTime() - new Date(e.received_at).getTime()) / 3_600_000 : (i.now.getTime() - new Date(e.received_at).getTime()) / 3_600_000;
  const apology = e.sentiment === 'frustrated' || delayedHours > 24 ? 'We are sorry for the delay in getting back to you — that is not the experience we want anyone to have.' : null;
  const where = e.location ? ` in ${e.location}` : '';
  const scope = e.scope_type ? SCOPE_LABEL[e.scope_type] : 'an interior design project';
  const lines: string[] = [];
  let subject = '';

  const designer = i.designer;
  const contactLine = STUDIO.phone ? `call us on ${STUDIO.phone} (${STUDIO.hours})` : `reach us during ${STUDIO.hours}`;
  const signoff = ['Warm regards,', STUDIO.name, ...(STUDIO.phone ? [STUDIO.phone] : []), ...(STUDIO.email ? [STUDIO.email] : []), ...(STUDIO.address ? [STUDIO.address] : [])];

  if (i.template === 'confirmation') {
    const c = i.consultation ?? null;
    if (!designer) blockers.push('No designer assigned.');
    if (!c && !i.callbackAt) blockers.push('No callback time or consultation set.');
    const when = i.callbackAt ? describeCallback(i.callbackAt, i.now) : '';
    const dFirst = designer?.name.split(/\s+/)[0] ?? 'Your designer';
    const slot = c ? `${formatLongDate(c.startsAt)} at ${formatTime(c.startsAt)}` : '';
    subject = c
      ? `Your Aangan Studio consultation is booked — ${slot}`
      : `Your Aangan Studio enquiry — ${dFirst} will be in touch ${when}`.trim();
    const place = !c ? '' : c.mode === 'site_visit'
      ? `a site visit${c.location ? ` at your property (${c.location})` : ' at your property'}`
      : c.mode === 'studio' ? `at our studio${STUDIO.address ? ` (${STUDIO.address})` : ''}` : 'by phone / video call';
    lines.push(hello, '');
    if (apology) lines.push(apology, '');
    lines.push(
      `Thank you for getting in touch with ${STUDIO.name}. From your ${CHANNEL_PHRASE[e.channel]} we have noted that you are looking for ${scope}${where}.`,
      '',
      'YOUR DESIGNER',
      designer ? `${designer.name}, ${ROLE_TITLE[designer.role]}` : '—',
      ...(designer?.phone ? [`Phone: ${designer.phone}`] : []),
      ...(designer?.email ? [`Email: ${designer.email}`] : []),
      ...(c ? ['', 'YOUR CONSULTATION', `${slot} — ${place}`, 'A calendar invite is attached to this email. If the time does not suit you, just reply and we will move it.'] : []),
      '',
      'WHAT HAPPENS NEXT',
      c
        ? `1. ${dFirst} will meet you ${place} on the date above. The consultation is free, and there is no obligation.`
        : `1. ${dFirst} will call you ${when} to introduce themselves and agree a time for your consultation. If that time does not suit you, just reply to this email.`,
      '2. At the consultation your designer looks at the space with you (a site visit is possible), listens to what you want, and talks through timelines and how pricing works for your scope. Pricing depends on the site, the materials you choose and the scope, so it is confirmed in person. The consultation is free and there is no obligation.',
      '3. Our design phase usually takes 3–4 weeks from the first consultation, and execution 8–16 weeks depending on the size of the project and how ready the site is.',
      '',
      'HELPFUL TO HAVE READY (all optional)',
      '• A floor plan or the builder’s layout, if you have one',
      '• A few photos or a short video of the space',
      '• Any reference images or a Pinterest board you like',
      '• Who else will be at the consultation, so everyone who decides can be there',
      '',
      `If you need us sooner, reply to this email or ${contactLine}.`,
    );
  } else if (i.template === 'clarification') {
    subject = 'A quick question about your Aangan Studio enquiry';
    const q = i.question?.trim();
    if (!q) blockers.push('No clarifying question provided.');
    lines.push(hello, '');
    if (apology) lines.push(apology, '');
    lines.push(
      `Thank you for getting in touch with ${STUDIO.name}. We would love to help, and there is just one thing we need to confirm so we can match you with the right designer:`,
      '',
      q ?? '',
      '',
      `A one-line reply to this email is all we need, or you can ${contactLine}.`,
    );
  } else {
    subject = `Your enquiry with ${STUDIO.name}`;
    const failed = (Object.keys(DECLINE_REASON) as (keyof Criteria)[]).filter((k) => e.criteria?.[k] === 'fail');
    lines.push(hello, '', `Thank you for thinking of ${STUDIO.name}.`, '');
    for (const k of failed.slice(0, 2)) lines.push(DECLINE_REASON[k] as string, '');
    lines.push(DECLINE_SCRIPT);
  }

  if (i.note?.trim()) lines.push('', i.note.trim());
  lines.push('', ...signoff);

  const text = lines.join('\n');
  if (containsPriceDisclosure(text)) blockers.push('Email contains something that looks like a price — emails to clients must never include a figure.');
  if (i.template === 'confirmation' && !text.includes('Pricing depends')) blockers.push('Required pricing deflection missing.');

  return { subject, text, html: toHtml(subject, lines), blockers };
}

// Minimal, client-safe HTML: all dynamic text is escaped; headings are the ALL-CAPS lines.
function toHtml(subject: string, lines: string[]): string {
  const body = lines
    .map((l) => {
      if (l === '') return '<div style="height:10px"></div>';
      const safe = escapeHtml(l);
      if (/^[A-Z][A-Z ]{5,}$/.test(l)) return `<div style="font-size:12px;letter-spacing:.12em;font-weight:700;color:#8a4b1f;margin-top:6px">${safe}</div>`;
      return `<div style="margin:2px 0">${safe}</div>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>` +
    `<body style="margin:0;padding:24px;background:#f6f3ee;font-family:Georgia,'Times New Roman',serif;color:#1c1c1c;font-size:15px;line-height:1.55">` +
    `<div style="max-width:560px;margin:0 auto;background:#fff;padding:28px 30px;border-top:4px solid #c2410c">${body}</div></body></html>`;
}
