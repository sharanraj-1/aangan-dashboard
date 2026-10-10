// Run:  npm test
// Verifies the guardrail engine against the 40 real September-2026 enquiries (expected outcomes encode
// Nikhil's rubric) plus targeted unit checks for each failure mode. No network, no database.

import assert from 'node:assert/strict';
import { SEPT_2026, toExtraction } from '../data/sept-2026-enquiries';
import { buildIcs, findConflict, outsideStudioHours, suggestSlots } from '../lib/calendar';
import { composeClientEmail, computeCallbackAt, describeCallback } from '../lib/client-email';
import { contactProperties, dealProperties, dealStageFor, shouldSync, validPhone } from '../lib/hubspot';
import { PRICING_DEFLECTION } from '../lib/config';
import { blankExtraction, crit } from '../lib/extraction';
import { calculateConfidence, classifyOverride, evaluateGate, isAfterHours, isAuditSampled, istParts, triage } from '../lib/guardrails';
import { containsPriceDisclosure, evaluatePricing, findAgentPriceDisclosures, isBudgetProbe, sanitizeClientText } from '../lib/pricing';
import { buildRecords } from '../lib/records';
import type { DesignerRow } from '../lib/types';

let passed = 0;
let failed = 0;
const pending: Promise<void>[] = [];
const pass = (name: string) => { passed++; console.log(`  ✓ ${name}`); };
const fail = (name: string, e: unknown) => { failed++; console.log(`  ✗ ${name}\n      ${(e as Error).message.split('\n').join('\n      ')}`); };
function test(name: string, fn: () => void | Promise<void>) {
  try {
    const r = fn();
    if (r instanceof Promise) pending.push(r.then(() => pass(name), (e) => fail(name, e)));
    else pass(name);
  } catch (e) {
    fail(name, e);
  }
}
const ist = (s: string) => new Date(s.replace(' ', 'T') + ':00+05:30');
const NOW = ist('2026-10-07 12:00');

// ---------------------------------------------------------------------------------------------
console.log('\nReal enquiries → expected outcome (qualified.md / services.md rules)');
const tally: Record<string, number> = {};
for (const r of SEPT_2026) {
  test(`${r.ref} ${r.channel.padEnd(8)} → ${r.expect.outcome}${r.expect.escalations.length ? ' + ' + r.expect.escalations.join(', ') : ''}`, () => {
    const built = buildRecords({
      sourceRef: r.ref, channel: r.channel, receivedAt: ist(r.at), callOutcome: r.callOutcome ?? null,
      firstResponseAt: r.respondedAt ? ist(r.respondedAt) : null, rawText: r.raw, extraction: toExtraction(r),
      sourceStatus: r.sourceStatus ?? null, now: NOW,
    });
    tally[built.enquiry.ai_qualification] = (tally[built.enquiry.ai_qualification] ?? 0) + 1;
    assert.equal(built.enquiry.ai_qualification, r.expect.outcome, `outcome (reasons: ${built.enquiry.qualification_reasons.join(' | ')})`);
    const got = built.escalations.map((e) => e.trigger).filter((t) => t !== 'audit_sample').sort();
    assert.deepEqual(got, [...r.expect.escalations].sort(), 'escalation triggers');
  });
}
console.log('  tally:', JSON.stringify(tally));

// ---------------------------------------------------------------------------------------------
console.log('\nFailure mode A — confidence gate');
test('85% threshold: 0.84 trips, 0.85 passes', () => {
  assert.equal(evaluateGate(blankExtraction({ transcription_confidence: 0.84 })).passed, false);
  assert.equal(evaluateGate(blankExtraction({ transcription_confidence: 0.85 })).passed, true);
});
test('[inaudible] markers lower the composite below the gate', () => {
  const x = blankExtraction({ transcription_confidence: 0.9 });
  assert.equal(calculateConfidence(x, 'I live in [inaudible] near [uncertain: Baner] and [inaudible]'), 0.81);
  assert.equal(evaluateGate(x, 'a [inaudible] b [inaudible] c [inaudible]').passed, false);
});
test('ambiguous scope/location on a real lead trips the gate; merely not-stated does not', () => {
  assert.deepEqual(evaluateGate(blankExtraction({ location_clarity: 'ambiguous' })).triggers, ['ambiguous_location']);
  assert.equal(evaluateGate(blankExtraction({ location_clarity: 'not_stated', scope_clarity: 'not_stated' })).passed, true);
});
test('low-confidence enquiry is held: review + transcription escalation, no designer brief, pricing escalation suppressed', () => {
  const x = blankExtraction({
    transcription_confidence: 0.65, project_type: 'residential', scope_type: 'full_home', area_sqft: 1000, location: 'Baner', location_clarity: 'clear',
    scope_clarity: 'clear', weeks_to_completion: 20, budget_low_inr: 50_000, budget_high_inr: 80_000, criteria: crit('PPPUP'),
  });
  const t = triage(x, { now: NOW, receivedAt: NOW, firstResponseAt: NOW, callOutcome: 'answered', transcriptText: '', auditKey: 'k' });
  assert.equal(t.outcome, 'review');
  assert.deepEqual(t.escalations.map((e) => e.trigger), ['low_confidence']);
  assert.equal(t.briefEligible, false);
  assert.equal(t.escalations[0].severity, 'high');
});
test('AI outage never drops an enquiry — it escalates', () => {
  const x = blankExtraction({ intent: 'other', ambiguity_flags: ['ai_unavailable'], transcription_confidence: 0 });
  const t = triage(x, { now: NOW, receivedAt: NOW, firstResponseAt: null, callOutcome: null, transcriptText: 'raw text', auditKey: 'k' });
  assert.equal(t.escalations[0].trigger, 'ai_failure');
});

// ---------------------------------------------------------------------------------------------
console.log('\nFailure mode B — lead qualification (false positive vs false negative)');
test('unclear on timeline → gray-area review with ONE question, never a silent decline', () => {
  const x = blankExtraction({ criteria: crit('PPUUU'), location: 'Baner, Pune', location_clarity: 'clear', scope_clarity: 'clear', project_type: 'residential', scope_type: 'full_home' });
  const t = triage(x, { now: NOW, receivedAt: NOW, firstResponseAt: NOW, callOutcome: 'answered', transcriptText: '', auditKey: 'k' });
  assert.equal(t.outcome, 'review');
  assert.equal(t.suggestedQuestion, 'When would you need the project complete?');
});
test('unclear budget / decision-maker never block (qualified.md: treat as qualified, note it)', () => {
  const x = blankExtraction({ criteria: crit('PPPUU'), location: 'Aundh', location_clarity: 'clear', scope_clarity: 'clear', weeks_to_completion: 20, timeline_text: 'by March', project_type: 'residential', scope_type: 'full_home', area_sqft: 900 });
  const t = triage(x, { now: NOW, receivedAt: NOW, firstResponseAt: NOW, callOutcome: 'answered', transcriptText: '', auditKey: 'k' });
  assert.equal(t.outcome, 'qualified');
  assert.ok(t.designerNotes.some((n) => /do not probe/i.test(n)));
});
test('high-value fringe (outside area, ₹15–20L) is reviewed, not declined; a small outside-area lead is declined', () => {
  const base = { criteria: crit('PFPPU'), location: 'Talegaon', location_clarity: 'clear' as const, scope_clarity: 'clear' as const, project_type: 'residential' as const, scope_type: 'full_home' as const, weeks_to_completion: 14 };
  const big = triage(blankExtraction({ ...base, area_sqft: 1400, budget_low_inr: 1_500_000, budget_high_inr: 2_000_000 }), { now: NOW, receivedAt: NOW, firstResponseAt: NOW, callOutcome: 'answered', transcriptText: '', auditKey: 'k' });
  assert.equal(big.outcome, 'review');
  assert.equal(big.escalations[0].trigger, 'high_value_fringe');
  const small = triage(blankExtraction({ ...base, area_sqft: 800 }), { now: NOW, receivedAt: NOW, firstResponseAt: NOW, callOutcome: 'answered', transcriptText: '', auditKey: 'k' });
  assert.equal(small.outcome, 'unqualified');
});
test('service-type exclusions (gym / restaurant) are never rescued by high value', () => {
  const x = blankExtraction({ project_type: 'commercial', area_sqft: 2500, custom_work_flags: ['hospitality_or_retail'], location: 'Kothrud', location_clarity: 'clear', criteria: crit('FPUUU') });
  assert.equal(triage(x, { now: NOW, receivedAt: NOW, firstResponseAt: NOW, callOutcome: 'answered', transcriptText: '', auditKey: 'k' }).outcome, 'unqualified');
});
test('audit sampling is deterministic and ≈ the configured rate', () => {
  assert.equal(isAuditSampled('abc'), isAuditSampled('abc'));
  const hits = Array.from({ length: 4000 }, (_, i) => isAuditSampled(`k${i}`)).filter(Boolean).length;
  assert.ok(hits > 280 && hits < 520, `expected ~400 (10%), got ${hits}`);
});
test('override classification feeds FP / FN rates', () => {
  assert.equal(classifyOverride({ ai_qualification: 'qualified', final_qualification: 'unqualified' }), 'false_positive');
  assert.equal(classifyOverride({ ai_qualification: 'unqualified', final_qualification: 'qualified' }), 'false_negative');
  assert.equal(classifyOverride({ ai_qualification: 'review', final_qualification: 'qualified' }), 'gray_to_qualified');
  assert.equal(classifyOverride({ ai_qualification: 'qualified', final_qualification: 'qualified' }), 'confirmed');
  assert.equal(classifyOverride({ ai_qualification: 'qualified', final_qualification: null }), null);
});

// ---------------------------------------------------------------------------------------------
console.log('\nFailure mode C — pricing & anchoring');
test('₹1–1.5L for kitchen + bedroom is "below minimum"; ₹18–22L for a 1,300 sq ft home is only "below range" (anchor risk, no escalation)', () => {
  const t10 = evaluatePricing({ project_type: 'residential', scope_type: 'partial_home', area_sqft: 550, budget_low_inr: 100_000, budget_high_inr: 150_000, custom_work_flags: [] });
  assert.equal(t10.budgetFlag, 'below_minimum');
  const f10 = evaluatePricing({ project_type: 'residential', scope_type: 'full_home', area_sqft: 1300, budget_low_inr: 1_800_000, budget_high_inr: 2_200_000, custom_work_flags: [] });
  assert.equal(f10.budgetFlag, 'below_range');
  assert.equal(f10.anchorRisk, true);
  assert.equal(f10.requiresReview, false);
});
test('custom / luxury / structural work raises a pricing escalation to senior review', () => {
  const x = blankExtraction({
    project_type: 'residential', scope_type: 'full_home', area_sqft: 1500, location: 'Baner', location_clarity: 'clear', scope_clarity: 'clear',
    weeks_to_completion: 20, custom_work_flags: ['luxury_spec', 'home_automation'], criteria: crit('PPPUP'),
  });
  const t = triage(x, { now: NOW, receivedAt: NOW, firstResponseAt: NOW, callOutcome: 'answered', transcriptText: '', auditKey: 'k' });
  assert.ok(t.escalations.some((e) => e.trigger === 'custom_work'));
  assert.equal(t.briefEligible, false, 'held until the senior designer reviews');
});
test('internal estimate follows pricing.md (standard tier, carpet area)', () => {
  const p = evaluatePricing({ project_type: 'residential', scope_type: 'full_home', area_sqft: 1000, budget_low_inr: null, budget_high_inr: null, custom_work_flags: [] });
  assert.equal(p.indicativeLowInr, 1_800_000);
  assert.equal(p.pipelineEstimateInr, 2_100_000);
});
test('client-facing text can never carry a price (linter)', () => {
  for (const bad of ['Our rates start at ₹1,800 per sq ft', 'It will cost around 12 lakh', 'roughly Rs. 15,00,000', 'about 2000/sq ft', 'Starting from 9 lakhs', 'For a 2BHK it’s typically 15L']) {
    assert.equal(containsPriceDisclosure(bad), true, bad);
  }
  assert.equal(containsPriceDisclosure(PRICING_DEFLECTION), false);
  assert.equal(containsPriceDisclosure('Our design phase takes 3–4 weeks and execution 8–16 weeks.'), false);
});
test('clarifying questions may not probe the budget', () => {
  assert.equal(isBudgetProbe('What is your budget for this?'), true);
  assert.equal(sanitizeClientText('What is your budget?', 'fallback'), 'fallback');
  assert.equal(sanitizeClientText('When would you need the project complete?'), 'When would you need the project complete?');
});

// ---------------------------------------------------------------------------------------------
console.log('\nService recovery');
test('response >24h on an active lead raises an SLA escalation; >48h goes to a senior designer', () => {
  const r = SEPT_2026.find((x) => x.ref === 'W08')!;
  const b = buildRecords({ sourceRef: r.ref, channel: r.channel, receivedAt: ist(r.at), firstResponseAt: ist(r.respondedAt!), rawText: r.raw, extraction: toExtraction(r), now: NOW });
  const sla = b.escalations.find((e) => e.trigger === 'response_sla_breach')!;
  assert.equal(sla.assigned_to, 'senior_designer');
  assert.equal(sla.severity, 'high');
});
test('front-desk hours (10am–7pm, Mon–Sat, IST)', () => {
  assert.equal(isAfterHours(ist('2026-09-09 22:47')), true);
  assert.equal(isAfterHours(ist('2026-09-03 19:14')), true);
  assert.equal(isAfterHours(ist('2026-09-04 11:47')), false);
  assert.equal(isAfterHours(ist('2026-09-20 11:00')), true, 'Sunday');
});

// ---------------------------------------------------------------------------------------------
console.log('\nClient email channel');
const designer: DesignerRow = { id: 'd1', name: 'Aryan Kulkarni', email: 'aryan@aangan.example', phone: '+91 00000 00001', role: 'senior_designer', active: true, is_sample: true, created_at: NOW.toISOString() };
const t01 = SEPT_2026[0];
const t01Row = buildRecords({ sourceRef: t01.ref, channel: t01.channel, receivedAt: ist(t01.at), firstResponseAt: ist(t01.at), rawText: t01.raw, extraction: toExtraction(t01), now: NOW }).enquiry;
test('callback promise: in hours → within the hour; after hours → 10:30 next working day; Sunday → Monday', () => {
  assert.equal(computeCallbackAt(ist('2026-10-07 11:10')).toISOString(), ist('2026-10-07 12:15').toISOString());
  assert.equal(computeCallbackAt(ist('2026-10-07 18:30')).toISOString(), ist('2026-10-08 10:30').toISOString());
  assert.equal(computeCallbackAt(ist('2026-10-07 22:47')).toISOString(), ist('2026-10-08 10:30').toISOString());
  assert.equal(computeCallbackAt(ist('2026-10-04 15:00')).toISOString(), ist('2026-10-05 10:30').toISOString(), 'Sunday → Monday');
  assert.equal(computeCallbackAt(ist('2026-10-07 08:00')).toISOString(), ist('2026-10-07 10:30').toISOString(), 'before opening → same day 10:30');
  assert.equal(describeCallback(ist('2026-10-08 10:30'), ist('2026-10-07 22:47')), 'tomorrow (Thursday, 8 October) by 10:30 am');
});
test('confirmation email names the designer, the callback time and next steps — and contains no price', () => {
  const at = computeCallbackAt(NOW);
  const m = composeClientEmail({ template: 'confirmation', enquiry: t01Row, designer, callbackAt: at, now: NOW });
  assert.deepEqual(m.blockers, []);
  assert.match(m.subject, /Aryan will be in touch today by 1:00 pm/);
  assert.match(m.text, /Aryan Kulkarni, Senior Designer/);
  assert.match(m.text, /Phone: \+91 00000 00001/);
  assert.match(m.text, /Pricing depends on the site/);
  assert.match(m.text, /Hello Priya,/);
  assert.equal(containsPriceDisclosure(m.text), false);
});
test('email is blocked without a designer/callback, or if the designer’s note smuggles in a price', () => {
  assert.ok(composeClientEmail({ template: 'confirmation', enquiry: t01Row, designer: null, callbackAt: null, now: NOW }).blockers.length >= 2);
  const m = composeClientEmail({ template: 'confirmation', enquiry: t01Row, designer, callbackAt: NOW, now: NOW, note: 'Projects like yours usually start at ₹20 lakh.' });
  assert.ok(m.blockers.some((b) => /price/i.test(b)));
});
test('HTML body escapes client-controlled text', () => {
  const evil = { ...t01Row, client_name: 'Priya', location: '<script>alert(1)</script>' };
  const m = composeClientEmail({ template: 'confirmation', enquiry: evil, designer, callbackAt: NOW, now: NOW });
  assert.ok(!m.html.includes('<script>'));
  assert.ok(m.html.includes('&lt;script&gt;'));
});
test('apology line appears for a frustrated / delayed prospect; decline email uses the approved script', () => {
  const w08 = SEPT_2026.find((r) => r.ref === 'W08')!;
  const row = buildRecords({ sourceRef: 'W08', channel: 'whatsapp', receivedAt: ist(w08.at), firstResponseAt: ist(w08.respondedAt!), rawText: w08.raw, extraction: toExtraction(w08), now: NOW }).enquiry;
  assert.match(composeClientEmail({ template: 'confirmation', enquiry: row, designer, callbackAt: NOW, now: NOW }).text, /sorry for the delay/);
  const t03 = SEPT_2026.find((r) => r.ref === 'T03')!;
  const dec = buildRecords({ sourceRef: 'T03', channel: 'phone', receivedAt: ist(t03.at), firstResponseAt: ist(t03.at), rawText: t03.raw, extraction: toExtraction(t03), now: NOW }).enquiry;
  const d = composeClientEmail({ template: 'decline', enquiry: dec, designer: null, callbackAt: null, now: NOW });
  assert.match(d.text, /Pune city and PCMC/);
  assert.match(d.text, /may not be the right fit for us right now/);
  assert.deepEqual(d.blockers, []);
});

// ---------------------------------------------------------------------------------------------
console.log('\nVoice-agent policy (never quote a price)');
test('a studio line that states a price is flagged; echoing the caller’s own figure is not', () => {
  const breach = 'Caller: What would a 3BHK cost?\nFront Desk: For a 3BHK it’s typically around ₹18 lakh.';
  assert.equal(findAgentPriceDisclosures(breach).length, 1);
  const echo = 'Caller: My budget is 1 to 1.5 lakh.\nFront Desk: 1 to 1.5 lakh would be significantly below what that scope costs.';
  assert.equal(findAgentPriceDisclosures(echo).length, 0);
  const wa = '3 Sept, 7:14pm — Rohit: how much per sq ft?\n4 Sept, 11:47am — Front Desk: Our rates start at 2000 per sq ft.';
  assert.equal(findAgentPriceDisclosures(wa).length, 1);
  assert.equal(findAgentPriceDisclosures(PRICING_DEFLECTION).length, 0);
});

console.log('\nCalendar');
test('ICS: valid structure, UTC times, escaped text, CRLF line endings', () => {
  const ics = buildIcs({ uid: 'u1', start: ist('2026-10-08 10:30'), end: ist('2026-10-08 11:30'), summary: 'Consultation, site visit', description: 'Line1\nLine2; ok', location: 'Baner, Pune' });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20261008T050000Z/);
  assert.match(ics, /SUMMARY:Consultation\\, site visit/);
  assert.match(ics, /DESCRIPTION:Line1\\nLine2\\; ok/);
  assert.match(ics, /METHOD:PUBLISH/);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});
test('double-booking is detected per designer; suggested slots skip busy times and non-working days', () => {
  const busy = [{ id: 'c1', designer_id: 'd1', starts_at: ist('2026-10-09 10:30').toISOString(), ends_at: ist('2026-10-09 11:30').toISOString(), status: 'scheduled' as const }];
  assert.ok(findConflict('d1', ist('2026-10-09 11:00'), ist('2026-10-09 12:00'), busy));
  assert.equal(findConflict('d2', ist('2026-10-09 11:00'), ist('2026-10-09 12:00'), busy), null);
  assert.equal(findConflict('d1', ist('2026-10-09 11:30'), ist('2026-10-09 12:30'), busy), null, 'back-to-back is fine');
  const slots = suggestSlots('d1', ist('2026-10-09 08:00'), busy, 8);
  assert.ok(!slots.some((s) => s.toISOString() === ist('2026-10-09 10:30').toISOString()));
  assert.ok(slots.every((s) => istParts(s).day !== 0), 'never Sunday');
  assert.ok(outsideStudioHours(ist('2026-10-10 20:00')) && !outsideStudioHours(ist('2026-10-09 12:00')));
});
test('confirmation email for a booked consultation names the slot and promises an attachment', () => {
  const m = composeClientEmail({
    template: 'confirmation', enquiry: t01Row, designer, callbackAt: null, now: NOW,
    consultation: { startsAt: ist('2026-10-10 11:00'), mode: 'site_visit', location: 'Kothrud, Pune' },
  });
  assert.deepEqual(m.blockers, []);
  assert.match(m.subject, /consultation is booked — Saturday, 10 October at 11:00 am/);
  assert.match(m.text, /site visit at your property \(Kothrud, Pune\)/);
  assert.match(m.text, /calendar invite is attached/);
});

test('a SAMPLE designer can never appear in a LIVE client email; assignment spreads across the roster', async () => {
  const { getStore } = await import('../lib/store');
  const wf = await import('../lib/workflow');
  const store = getStore();
  const t01 = (await store.load('designer')).enquiries.find((e) => e.source_ref === 'T01')!;
  await store.update('enquiries', t01.id, { client_email: 'priya@example.org' });
  const sample = (await store.listDesigners()).find((d) => d.is_sample)!;
  const prev = process.env.CLIENT_EMAIL_MODE;
  process.env.CLIENT_EMAIL_MODE = 'live';
  try {
    const live = await wf.sendEmailToClient(store, t01.id, 'confirmation', { designerId: sample.id, callbackAt: new Date(Date.now() + 3_600_000) }, 'test');
    assert.equal(live.ok, false);
    assert.match(live.message, /sample designer/i);
    process.env.CLIENT_EMAIL_MODE = 'dry_run';
    const dry = await wf.sendEmailToClient(store, t01.id, 'confirmation', { designerId: sample.id, callbackAt: new Date(Date.now() + 3_600_000) }, 'test');
    assert.equal(dry.ok, true, 'dry-run with a sample designer is fine');
  } finally {
    if (prev === undefined) delete process.env.CLIENT_EMAIL_MODE; else process.env.CLIENT_EMAIL_MODE = prev;
  }
  const picks = new Set<string>();
  for (let i = 0; i < 6; i++) {
    const d = await wf.pickDesigner(store, { priority_flags: [] });
    picks.add(d!.name);
    await store.update('enquiries', (await store.load('designer')).enquiries.filter((e) => !e.designer_id)[i].id, { designer_id: d!.id, designer_name: d!.name, status: 'handed_off' });
  }
  assert.ok(picks.size >= 5, `load-balancing should spread leads across designers, got ${[...picks].join(', ')}`);
  const big = await wf.pickDesigner(store, { priority_flags: ['large_project'] });
  assert.notEqual(big!.role, 'designer', 'large projects go to a senior designer or the principal');
});

test('Google service-account auth: JWT is a valid RS256 signature with the right claims; key parsing accepts raw JSON or base64', async () => {
  const { generateKeyPairSync, createVerify } = await import('node:crypto');
  const { buildServiceAccountJwt, readServiceAccount, googleMode } = await import('../lib/calendar');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const sa = { email: 'bot@proj.iam.gserviceaccount.com', key: pem };
  const jwt = buildServiceAccountJwt(sa, 1_700_000_000);
  const [h, c, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
  const claim = JSON.parse(Buffer.from(c, 'base64url').toString());
  assert.equal(claim.iss, sa.email);
  assert.equal(claim.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(claim.scope, 'https://www.googleapis.com/auth/calendar');
  assert.equal(claim.exp - claim.iat, 3600);
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url')), 'signature verifies with the public key');
  const json = JSON.stringify({ client_email: sa.email, private_key: pem });
  assert.equal(readServiceAccount(json)?.email, sa.email);
  assert.equal(readServiceAccount(Buffer.from(json).toString('base64'))?.email, sa.email);
  assert.equal(readServiceAccount('not json'), null);
  assert.equal(readServiceAccount('{"client_email":"x"}'), null);
  const prev = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = json;
  try { assert.equal(googleMode(), 'service_account'); } finally { if (prev === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON; else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = prev; }
});

console.log('\nHubSpot sync (payloads only — no network)');
test('only worthwhile leads are synced; masked phones and placeholders never reach the CRM', () => {
  const row = (ref: string) => {
    const r = SEPT_2026.find((x) => x.ref === ref)!;
    return buildRecords({ sourceRef: ref, channel: r.channel, receivedAt: ist(r.at), firstResponseAt: r.respondedAt ? ist(r.respondedAt) : null, rawText: r.raw, extraction: toExtraction(r), now: NOW }).enquiry;
  };
  assert.equal(shouldSync(row('T01')), true, 'qualified');
  assert.equal(shouldSync(row('W03')), true, 'in review still counts');
  assert.equal(shouldSync(row('T03')), false, 'declined — data minimisation');
  assert.equal(shouldSync(row('T09')), false, 'existing-client complaint is not a lead');
  assert.deepEqual(contactProperties(row('F05')), { firstname: 'Sheena', lastname: 'Menon', company: 'NovaSpark Technologies', city: 'PCMC', lifecyclestage: 'lead', hs_lead_status: 'NEW' });
  assert.equal(validPhone('+91 98765 43210'), '+91 98765 43210');
  assert.equal(validPhone('[redacted in source]'), null);
  assert.equal(validPhone('+91 98XXX XXXXX'), null);
});
test('deal stage follows the pipeline; deal never carries transcript text', () => {
  assert.equal(dealStageFor({ status: 'won', ai_qualification: 'qualified', final_qualification: null }, null), 'closedwon');
  assert.equal(dealStageFor({ status: 'handed_off', ai_qualification: 'qualified', final_qualification: null }, { status: 'scheduled' }), 'presentationscheduled');
  assert.equal(dealStageFor({ status: 'new', ai_qualification: 'qualified', final_qualification: null }, null), 'qualifiedtobuy');
  assert.equal(dealStageFor({ status: 'new', ai_qualification: 'review', final_qualification: null }, null), 'appointmentscheduled');
  const e = buildRecords({ sourceRef: 'T01', channel: 'phone', receivedAt: ist(t01.at), firstResponseAt: ist(t01.at), rawText: t01.raw, extraction: toExtraction(t01), now: NOW }).enquiry;
  const props = dealProperties(e, null, null);
  assert.ok(!JSON.stringify(props).includes('Good morning, Aangan Studio'));
  assert.match(props.dealname, /Priya — Full home — Kothrud/);
  assert.equal(props.amount, '2940000');
});

console.log('\nRole separation (founder = results only)');
test('founder dataset has no names, contact details, summaries, locations, transcripts, designers or emails', async () => {
  const { getStore } = await import('../lib/store');
  const f = await getStore().load('founder');
  assert.equal(f.demo, true);
  assert.ok(f.enquiries.length >= 40);
  for (const e of f.enquiries) {
    for (const k of ['client_name', 'client_phone', 'client_email', 'summary', 'scope_summary', 'location', 'timeline_text', 'referral_source'] as const) assert.equal(e[k], null, k);
    assert.equal(e.open_questions.length, 0);
  }
  assert.ok(f.escalations.every((x) => x.reason === '' && Object.keys(x.detail).length === 0));
  assert.equal(f.designers.length, 0);
  assert.equal(f.outboundEmails.length, 0);
  const d = await getStore().load('designer');
  assert.ok(d.enquiries.some((e) => e.client_name === 'Priya'));
});

console.log('\nAccess rules (proxy.ts)');
test('anonymous visitors get the aggregate-only founder results page and NOTHING else', async () => {
  const { NextRequest } = await import('next/server');
  const { proxy } = await import('../proxy');
  const env = { DESIGNER_PASSWORD: 'dpw', FOUNDER_PASSWORD: 'fpw', NODE_ENV: process.env.NODE_ENV };
  const prev = { ...env, DESIGNER_USER: process.env.DESIGNER_USER, FOUNDER_USER: process.env.FOUNDER_USER };
  Object.assign(process.env, { DESIGNER_PASSWORD: 'dpw', FOUNDER_PASSWORD: 'fpw' });
  const basic = (u: string, p: string) => ({ authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64') });
  const run = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) => proxy(new NextRequest(`https://x.test${path}`, init));
  const role = (r: Response) => r.headers.get('x-middleware-request-x-aangan-role');
  try {
    const anon = run('/');
    assert.equal(anon.status, 200);
    assert.equal(role(anon), 'founder', 'anonymous page load = founder (aggregate-only) view');
    assert.equal(role(run('/?view=pricing&month=2026-09')), 'founder');
    assert.equal(run('/?login=1').status, 401, 'explicit sign-in link prompts for a login');
    assert.equal(run('/', { method: 'POST' }).status, 401, 'server actions need a login');
    assert.equal(run('/anything-else').status, 401, 'other paths need a login');
    assert.equal(run('/', { headers: { 'x-aangan-role': 'designer' } }).headers.get('x-middleware-request-x-aangan-role'), 'founder', 'a spoofed role header is ignored');
    assert.equal(role(run('/', { headers: basic('designer', 'dpw') })), 'designer');
    assert.equal(role(run('/', { headers: basic('nikhil', 'fpw') })), 'founder');
    assert.equal(run('/', { headers: basic('designer', 'wrong') }).status, 401, 'wrong credentials are refused, not downgraded to public');
    assert.equal(run('/?login=1&view=queue', { headers: basic('designer', 'dpw') }).status, 307, 'after signing in, the login parameter is stripped');
    assert.equal(run('/api/ingest/call', { method: 'POST' }).status, 200, 'machine endpoints do their own bearer check');
  } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('PUBLIC_VIEW=true lets anyone READ the designer screens but never change anything; machine endpoints stay bearer-protected', async () => {
  const { NextRequest } = await import('next/server');
  const { proxy } = await import('../proxy');
  const keep = { DESIGNER_PASSWORD: process.env.DESIGNER_PASSWORD, FOUNDER_PASSWORD: process.env.FOUNDER_PASSWORD, PUBLIC_VIEW: process.env.PUBLIC_VIEW };
  Object.assign(process.env, { DESIGNER_PASSWORD: 'dpw', FOUNDER_PASSWORD: 'fpw', PUBLIC_VIEW: 'true' });
  const basic = (u: string, p: string) => ({ authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64') });
  const run = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) => proxy(new NextRequest(`https://x.test${path}`, init));
  const hdr = (r: Response, n: string) => r.headers.get(`x-middleware-request-${n}`);
  try {
    const view = run('/?view=queue');
    assert.equal(view.status, 200);
    assert.equal(hdr(view, 'x-aangan-role'), 'designer', 'anonymous page load shows the designer screens');
    assert.match(hdr(view, 'x-aangan-user') ?? '', /^viewer/, 'but as a read-only viewer');
    assert.equal(run('/', { method: 'POST' }).status, 401, 'every button (a POST / server action) needs the login');
    assert.equal(run('/other').status, 401, 'other paths need the login');
    assert.equal(run('/?login=1').status, 401, 'the sign-in link prompts for the login');
    const f = run('/?as=founder');
    assert.equal(hdr(f, 'x-aangan-role'), 'founder', '?as=founder selects results only');
    assert.match(f.headers.get('set-cookie') ?? '', /aangan_role=founder/);
    assert.equal(hdr(run('/', { headers: { cookie: 'aangan_role=founder' } }), 'x-aangan-role'), 'founder');
    assert.equal(hdr(run('/', { headers: { cookie: 'aangan_role=junk' } }), 'x-aangan-role'), 'designer');
    assert.equal(hdr(run('/', { headers: { 'x-aangan-role': 'designer', 'x-aangan-user': 'bob' } }), 'x-aangan-user')?.startsWith('viewer'), true, 'a spoofed identity header is ignored');
    assert.equal(hdr(run('/', { headers: basic('designer', 'dpw') }), 'x-aangan-user'), 'designer', 'real designers still get full access');
    assert.equal(run('/', { method: 'POST', headers: basic('designer', 'dpw') }).status, 200, 'and their buttons work');
    assert.equal(run('/', { method: 'POST', headers: basic('designer', 'bad') }).status, 401);
    assert.equal(hdr(run('/api/ingest/call', { method: 'POST' }), 'x-aangan-role'), null, 'machine endpoints get no role — they check their own bearer key');
    // The server action itself also refuses the viewer identity (defence in depth).
    process.env.PUBLIC_VIEW = 'false';
    assert.equal(run('/?view=queue').status, 200);
    assert.equal(hdr(run('/?view=queue'), 'x-aangan-role'), 'founder', 'switch off → anonymous visitors only get the aggregate results page');
  } finally {
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('PUBLIC_EDIT=true removes the login from the dashboard (buttons work) but nothing else; machine endpoints stay bearer-protected', async () => {
  const { NextRequest } = await import('next/server');
  const { proxy } = await import('../proxy');
  const keep = { DESIGNER_PASSWORD: process.env.DESIGNER_PASSWORD, FOUNDER_PASSWORD: process.env.FOUNDER_PASSWORD, PUBLIC_EDIT: process.env.PUBLIC_EDIT, PUBLIC_VIEW: process.env.PUBLIC_VIEW };
  Object.assign(process.env, { DESIGNER_PASSWORD: 'dpw', FOUNDER_PASSWORD: 'fpw', PUBLIC_EDIT: 'true' });
  delete process.env.PUBLIC_VIEW;
  const run = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) => proxy(new NextRequest(`https://x.test${path}`, init));
  const hdr = (r: Response, n: string) => r.headers.get(`x-middleware-request-${n}`);
  try {
    assert.equal(hdr(run('/'), 'x-aangan-role'), 'designer', 'no login → the full designer tool');
    assert.equal(run('/', { method: 'POST' }).status, 200, 'buttons (server actions) work with no login');
    assert.equal(hdr(run('/', { method: 'POST' }), 'x-aangan-user'), 'open access', 'and are NOT treated as the read-only viewer');
    assert.equal(hdr(run('/?as=founder'), 'x-aangan-role'), 'founder', 'results-only view stays one click away');
    assert.equal(run('/other').status, 401, 'other paths still need credentials');
    assert.equal(run('/other', { method: 'POST' }).status, 401);
    assert.equal(hdr(run('/api/ingest/call', { method: 'POST' }), 'x-aangan-role'), null, 'machine endpoints get no role — they check their own bearer key');
    assert.equal(hdr(run('/', { headers: { 'x-aangan-role': 'founder', 'x-aangan-user': 'viewer' } }), 'x-aangan-role'), 'designer', 'spoofed headers are ignored');
    process.env.PUBLIC_EDIT = 'false';
    assert.equal(run('/', { method: 'POST' }).status, 401, 'switch off → buttons locked again');
  } finally {
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

// ---------------------------------------------------------------------------------------------
console.log('\nVaani voice integration (simulated API, shaped like the documented responses)');
const vcall = (id: string, over: Record<string, unknown> = {}) => ({
  call_id: id, call_type: 'Inbound', direction: 'Inbound', call_status: 'User disconnected', agent_name: 'studio-agent', from_number: '+919800000001', to_number: '+912000000000',
  Start_time: '2026-10-07T04:00:00.000000', End_time: '2026-10-07T04:03:10.000000', duration_ms: 742.269, post_processing_status: 'completed',
  recording_api: `https://api.vaanivoice.ai/api/stream/${id}`, call_transcription: `https://api.vaanivoice.ai/api/transcript/${id}`, ...over,
});
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const page = (data: unknown[], p: number, total: number) => ({ data, pagination: { page: p, page_size: 200, total_count: data.length, total_pages: total, has_next: p < total, has_previous: p > 1 } });

test('Vaani: auth header, inbound-only filter, UTC timestamps, computed duration, outcome + readiness mapping', async () => {
  const { createVaaniProvider } = await import('../lib/voice/vaani');
  const seen: { url: string; key: string | null }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), key: new Headers(init?.headers).get('x-api-key') });
    return jsonRes(page([
      vcall('in-1'),
      vcall('out-1', { direction: 'Outbound', call_type: 'Outbound' }),
      vcall('in-noans', { call_status: 'No answer' }),
      vcall('in-blip', { End_time: '2026-10-07T04:00:02.000000' }),
      vcall('in-pending', { post_processing_status: 'in_progress' }),
      vcall('in-old', { Start_time: '2026-09-01T04:00:00.000000', End_time: '2026-09-01T04:05:00.000000' }),
    ], 1, 1));
  }) as unknown as typeof fetch;
  const vp = createVaaniProvider({ apiKey: 'vaani_test', fetchImpl });
  const calls = await vp.listCalls(new Date('2026-10-01T00:00:00Z'));
  assert.deepEqual(calls.map((c) => c.callId).sort(), ['in-1', 'in-blip', 'in-noans', 'in-pending'], 'outbound and out-of-window calls are excluded');
  const c1 = calls.find((c) => c.callId === 'in-1')!;
  assert.equal(c1.startedAt.toISOString(), '2026-10-07T04:00:00.000Z', 'naive timestamps are UTC');
  assert.equal(c1.durationSec, 190, 'duration comes from the timestamps, not the bogus duration_ms');
  assert.equal(c1.callerNumber, '+919800000001', 'caller = from_number on an inbound call');
  assert.equal(c1.outcome, 'completed');
  assert.equal(c1.ready, true);
  assert.equal(calls.find((c) => c.callId === 'in-noans')!.outcome, 'missed');
  assert.equal(calls.find((c) => c.callId === 'in-blip')!.outcome, 'missed', 'a 2-second call is treated as nobody-spoke');
  assert.equal(calls.find((c) => c.callId === 'in-pending')!.ready, false);
  assert.ok(seen.every((s) => s.key === 'vaani_test'), 'X-API-Key is sent on every request');
  assert.ok(seen.every((s) => !s.url.includes('vaani_test')), 'the key never appears in a URL');
});

test('Vaani: walks history newest-first whichever way it is ordered, and stops once pages are older than the look-back', async () => {
  const { createVaaniProvider } = await import('../lib/voice/vaani');
  const requested: string[] = [];
  // Ascending (oldest first) history across 3 pages: the newest call is on the LAST page.
  const pages: Record<string, unknown[]> = {
    '1': [vcall('a1', { Start_time: '2026-08-01T04:00:00', End_time: '2026-08-01T04:02:00' }), vcall('a2', { Start_time: '2026-08-02T04:00:00', End_time: '2026-08-02T04:02:00' })],
    '2': [vcall('b1', { Start_time: '2026-09-01T04:00:00', End_time: '2026-09-01T04:02:00' }), vcall('b2', { Start_time: '2026-09-02T04:00:00', End_time: '2026-09-02T04:02:00' })],
    '3': [vcall('c1', { Start_time: '2026-10-06T04:00:00', End_time: '2026-10-06T04:02:00' }), vcall('c2', { Start_time: '2026-10-07T04:00:00', End_time: '2026-10-07T04:02:00' })],
  };
  const fetchImpl = (async (url: string | URL) => {
    const p = new URL(String(url)).searchParams.get('page')!;
    requested.push(p);
    return jsonRes(page(pages[p], Number(p), 3));
  }) as unknown as typeof fetch;
  const calls = await createVaaniProvider({ apiKey: 'k', fetchImpl }).listCalls(new Date('2026-10-01T00:00:00Z'));
  assert.deepEqual(calls.map((c) => c.callId).sort(), ['c1', 'c2']);
  assert.deepEqual(requested, ['1', '3', '2'], 'page 1 to learn the order, the newest page, then one older page to confirm it is out of the window — and no further');
});

test('Vaani: transcript labels are normalised; 404 means "not ready"; API errors surface Vaani’s own message', async () => {
  const { createVaaniProvider, normaliseVaaniTranscript, VaaniError } = await import('../lib/voice/vaani');
  assert.equal(
    normaliseVaaniTranscript('AGENT: Hi, Aangan Studio.\n\n USER: Hello, I have a 3BHK in Baner.\n\n\n\nAGENT: Great.'),
    'Front Desk: Hi, Aangan Studio.\n\nCaller: Hello, I have a 3BHK in Baner.\n\nFront Desk: Great.',
  );
  assert.equal(normaliseVaaniTranscript('   '), null);
  assert.equal(normaliseVaaniTranscript(undefined), null);
  const base = { callId: 'x', callerNumber: null, startedAt: new Date(), endedAt: null, durationSec: 60, outcome: 'completed' as const, ready: true, transcript: null, recordingUrl: null, language: null, sttConfidence: null };
  const notReady = createVaaniProvider({ apiKey: 'k', fetchImpl: (async () => jsonRes({ detail: 'pending' }, 404)) as unknown as typeof fetch });
  assert.equal(await notReady.loadTranscript!(base), null);
  const ok = createVaaniProvider({ apiKey: 'k', fetchImpl: (async () => jsonRes({ transcript: 'USER: hi', status_code: 200, function: 'get_transcript' })) as unknown as typeof fetch });
  assert.equal(await ok.loadTranscript!(base), 'Caller: hi');
  const broken = createVaaniProvider({ apiKey: 'k', fetchImpl: (async () => jsonRes({ status_code: 500, message: 'Error fetching call history: 400: Invalid client_id format' }, 500)) as unknown as typeof fetch });
  await assert.rejects(() => broken.listCalls(new Date(0)), (e: unknown) => e instanceof VaaniError && /Invalid client_id format/.test((e as Error).message) && (e as { status?: number }).status === 500);
});

test('Vaani sync: new calls become phone enquiries once; re-runs de-duplicate; unfinished calls wait; a call with no transcript is never lost', async () => {
  const { runVoiceSync } = await import('../lib/voice/sync');
  const { getStore } = await import('../lib/store');
  const prevKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY; // exercise the AI-outage path too: the enquiry must still be captured and escalated
  const t0 = new Date(Date.now() - 3_600_000);
  const mk = (id: string, over: Record<string, unknown> = {}) => ({
    callId: id, callerNumber: '+919811111111', startedAt: new Date(t0.getTime() + Number(id.slice(-1)) * 60_000), endedAt: null, durationSec: 120,
    outcome: 'completed' as const, ready: true, transcript: null, recordingUrl: null, language: null, sttConfidence: null, ...over,
  });
  const fake = {
    name: 'fake', isConfigured: () => true,
    listCalls: async () => [mk('c1'), mk('c2', { ready: false }), mk('c3', { outcome: 'missed' as const }), mk('c4')],
    loadTranscript: async (c: { callId: string }) => (c.callId === 'c1' ? 'Front Desk: Aangan Studio.\n\nCaller: Hi, I have a 3BHK in Baner.' : null),
  };
  try {
    const r1 = (await runVoiceSync({ since: new Date(0), providers: [fake] })).fake;
    assert.deepEqual({ created: r1.created, pending: r1.pending, dup: r1.duplicates, err: r1.errors }, { created: 3, pending: 1, dup: 0, err: [] });
    const rows = (await getStore().load('designer')).enquiries.filter((e) => e.source_ref?.startsWith('fake:'));
    assert.deepEqual(rows.map((e) => e.source_ref).sort(), ['fake:c1', 'fake:c3', 'fake:c4']);
    assert.ok(rows.every((e) => e.channel === 'phone'));
    assert.equal(rows.find((e) => e.source_ref === 'fake:c3')!.call_outcome, 'missed');
    assert.equal(rows.find((e) => e.source_ref === 'fake:c4')!.call_outcome, 'dropped', 'completed but no transcript → recorded as a dropped call that needs a callback');
    assert.ok(rows.find((e) => e.source_ref === 'fake:c1')!.first_response_at, 'an answered call counts as responded at its start');
    const r2 = (await runVoiceSync({ since: new Date(0), providers: [fake] })).fake;
    assert.deepEqual({ created: r2.created, pending: r2.pending, dup: r2.duplicates }, { created: 0, pending: 1, dup: 3 }, 'second run creates nothing new');
  } finally {
    if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
  }
});

console.log('\nMetrics on the real month');
test('September 2026: volume, channel mix, qualification split and response buckets', async () => {
  const { getStore } = await import('../lib/store');
  const { computeMetrics } = await import('../lib/metrics');
  const ds = await getStore().load('designer');
  const m = computeMetrics(ds, '2026-09', { now: NOW });
  assert.equal(m.volume.total, 40);
  assert.deepEqual([m.volume.byChannel.phone.n, m.volume.byChannel.whatsapp.n, m.volume.byChannel.web_form.n], [20, 10, 10]);
  assert.deepEqual(m.qualification.counts, { qualified: 17, unqualified: 8, review: 14, not_applicable: 1 });
  assert.equal(m.volume.missedCalls, 1);
  assert.equal(m.response.recorded, 29, 'forms and the missed call have no recorded response — not guessed');
  assert.equal(m.response.notRecorded, 11);
  assert.ok(m.response.buckets[4].n >= 2, 'T16 and W08 waited > 48h');
  assert.equal(m.response.buckets.reduce((s, b) => s + b.n, 0), 29);
  assert.equal(m.response.conversionLift, null, 'no won/lost outcomes logged in the real data → no invented lift');
  assert.equal(m.qualification.fpRate, 0);
  assert.equal(m.handoff.sent, 0);
  assert.ok(m.money.pipelineInr > 0);
  assert.equal(m.money.wonInr, 0);
});
test('synthetic padding reaches ~200 and exercises every metric', async () => {
  const { buildDataset } = await import('../data/build-dataset');
  const { computeMetrics } = await import('../lib/metrics');
  const d = buildDataset(new Date('2026-10-07T12:00:00+05:30'), 160);
  assert.equal(d.enquiries.length, 200);
  assert.equal(d.enquiries.filter((e) => e.is_synthetic).length, 160);
  const m = computeMetrics({ ...d, transcriptCosts: d.transcripts.map((t) => ({ enquiry_id: t.enquiry_id, ai_cost_inr: t.ai_cost_inr })), demo: true }, '2026-09', { now: new Date('2026-10-07T12:00:00+05:30') });
  assert.equal(m.volume.total, 200);
  assert.ok(m.escalations.resolved > 10, 'resolved escalations exist');
  assert.ok(m.handoff.sent > 20 && m.handoff.successRate !== null);
  assert.ok(m.money.wonCount > 0 && m.money.wonInr > 0);
  assert.ok(m.response.buckets[0].conversion !== null);
  assert.ok(m.calendar.completed + m.calendar.scheduled > 5);
  assert.ok(m.qualification.falseNegatives + m.qualification.grayRescued > 0);
  // The guardrail engine, not the generator, decided every outcome — and nothing synthetic carries a price into client text.
  assert.ok(d.enquiries.every((e) => ['qualified', 'unqualified', 'review', 'not_applicable'].includes(e.ai_qualification)));
});

// ---------------------------------------------------------------------------------------------
Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
