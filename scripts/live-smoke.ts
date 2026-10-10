// End-to-end smoke test of the DESIGNER WORKFLOW against a real Supabase database.
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run smoke
// Creates ONE throwaway enquiry (source_ref "smoke-…", email on the reserved .example domain so nothing can be sent),
// drives it through qualify → handoff → consultation → email record → outcome, checks the founder view is redacted,
// then deletes everything it created. Safe to run on a live database; refuses to run in demo mode.

import { config } from 'dotenv';
config({ path: '.env.local' });

import { randomUUID } from 'node:crypto';
import { blankExtraction, crit } from '../lib/extraction';
import { computeMetrics, effectiveQualification, monthKey } from '../lib/metrics';
import { buildRecords } from '../lib/records';
import { getAdmin, getStore } from '../lib/store';
import * as wf from '../lib/workflow';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
};

async function main() {
  const db = getAdmin();
  if (!db) throw new Error('Supabase is not configured (set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY). Refusing to smoke-test the in-memory demo store.');
  const store = getStore();
  const now = new Date();
  const ref = `smoke-${Date.now()}`;
  let enquiryId = '';

  try {
    console.log(`Smoke test against ${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host}\n`);

    // 1. Intake: a gray-area lead (timeline unclear) → must create a needs_clarification escalation.
    const x = blankExtraction({
      client_name: 'Smoke Test', client_email: 'smoke@aangan.example', project_type: 'residential', scope_type: 'full_home', scope_clarity: 'clear',
      location: 'Baner, Pune', location_clarity: 'clear', area_sqft: 1000, criteria: crit('PPUUU'), summary: 'Automated smoke-test enquiry — safe to delete.',
    });
    const b = buildRecords({ sourceRef: ref, channel: 'web_form', receivedAt: new Date(now.getTime() - 2 * 3_600_000), rawText: 'Name: Smoke Test\nLocation: Baner\nNotes: automated test', extraction: x, now });
    enquiryId = b.enquiry.id;
    await store.insert('enquiries', b.enquiry);
    if (b.transcript) await store.insert('transcripts', b.transcript);
    if (b.pricing) await store.insert('pricing_logs', b.pricing);
    await store.insert('escalations', b.escalations);
    const esc = b.escalations[0];
    console.log('1. Intake');
    check('enquiry + transcript + pricing + escalation inserted', (await store.getEnquiry(enquiryId))?.source_ref === ref);
    check('gray-area lead routed to review (not declined, not forwarded)', b.enquiry.ai_qualification === 'review' && esc?.trigger === 'needs_clarification');
    check('pricing log stored with no client-facing price', (await store.getPricing(enquiryId))?.client_facing_response.includes('Pricing depends') === true);

    // 2. Human qualifies it → escalation resolved, final decision recorded, brief released to a designer.
    console.log('2. Resolve escalation → handoff');
    const r = await wf.resolveEscalation(store, esc.id, 'qualify', 'smoke test', 'smoke-test');
    check('resolveEscalation ok', r.ok, r.message);
    const e2 = await store.getEnquiry(enquiryId);
    check('final decision recorded', e2?.final_qualification === 'qualified' && e2.final_decided_by === 'smoke-test');
    check('handed off to a designer', e2?.status === 'handed_off' && e2.handoff_status === 'sent' && !!e2.designer_id, e2?.designer_name ?? '');
    check('escalation marked resolved', (await store.getEscalation(esc.id))?.status === 'resolved');

    // 3. Calendar: book, then prove double-booking is blocked.
    console.log('3. Consultation');
    const designerId = e2!.designer_id!;
    const start = new Date(now.getTime() + 26 * 3_600_000);
    start.setMinutes(0, 0, 0);
    const bk = await wf.bookConsultation(store, { enquiryId, designerId, start, mode: 'site_visit' }, 'smoke-test');
    check('consultation booked', bk.ok, bk.message);
    const dbl = await wf.bookConsultation(store, { enquiryId, designerId, start: new Date(start.getTime() + 30 * 60_000), mode: 'call' }, 'smoke-test');
    check('overlapping booking for the same designer is blocked', !dbl.ok, dbl.message);

    // 4. Client email: recorded as a dry-run (reserved .example domain can never be sent).
    console.log('4. Client email');
    const em = await wf.sendEmailToClient(store, enquiryId, 'confirmation', { designerId }, 'smoke-test');
    check('confirmation email composed + recorded', em.ok && em.data?.status === 'dry_run', em.message);
    const prep = await wf.prepareClientEmail(store, enquiryId, 'confirmation');
    check('email names the booked consultation', !!prep?.composed.text.includes('YOUR CONSULTATION'));

    // 5. Response + outcome.
    console.log('5. Response & outcome');
    check('first response recorded', (await wf.markResponded(store, enquiryId)).ok);
    const won = await wf.setOutcome(store, enquiryId, 'won', { valueInr: 1_200_000 }, 'smoke-test');
    check('marked won with a value', won.ok, won.message);

    // 6. Reads, metrics and founder redaction against real rows.
    console.log('6. Dashboard reads');
    const dd = await store.load('designer');
    const mine = dd.enquiries.find((e) => e.id === enquiryId);
    check('designer dataset has the enquiry with detail', mine?.client_name === 'Smoke Test' && dd.consultations.some((c) => c.enquiry_id === enquiryId) && dd.outboundEmails.some((m) => m.enquiry_id === enquiryId));
    const ff = await store.load('founder');
    const fm = ff.enquiries.find((e) => e.id === enquiryId);
    check('founder dataset has NO personal data for it', !!fm && fm.client_name === null && fm.client_email === null && fm.location === null && fm.summary === null);
    check('founder gets no designers / emails', ff.designers.length === 0 && ff.outboundEmails.length === 0);
    const m = computeMetrics(dd, monthKey(now), { now });
    check('metrics compute on live data', m.volume.total >= 1 && m.money.wonCount >= 1 && effectiveQualification(mine!) === 'qualified');
  } finally {
    if (enquiryId) {
      const { error } = await db.from('enquiries').delete().eq('id', enquiryId); // cascades to transcripts, pricing, escalations, consultations, emails
      const { count } = await db.from('enquiries').select('id', { count: 'exact', head: true }).eq('id', enquiryId);
      console.log(`\nCleanup: ${error ? 'FAILED ' + error.message : count === 0 ? 'test enquiry and all child rows deleted' : 'row still present!'}`);
      if (error || count !== 0) failures++;
    }
  }
  void randomUUID;
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll smoke checks passed.');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('Smoke test crashed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
