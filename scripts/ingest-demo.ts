// Push three sample enquiries through the REAL pipeline (live Gemini → guardrails → store) and show what happens.
//   npm run ingest:demo
// With Supabase configured the rows are written to your database; without, they go to the in-memory demo store.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { processEnquiry } from '../lib/pipeline';
import { getStore } from '../lib/store';

const SAMPLES = [
  {
    label: 'Hinglish WhatsApp — clear lead (expect: qualified or one-question review)',
    input: {
      channel: 'whatsapp' as const, callerName: 'Rakesh Pawar', sourceRef: `demo-wa-${Date.now()}`,
      text: 'Rakesh Pawar: Namaste, mera 3BHK flat Baner mein hai, lagbhag 1,250 sq ft. Poora ghar ka interior karwana hai, execution ke saath. Hum March tak shift hona chahte hain, abhi December hai start ke liye.\nFront Desk: Namaste Rakesh ji, Baner hamare service area mein hai. Kya aap owner hain?\nRakesh Pawar: Ji haan, main aur meri wife.',
    },
  },
  {
    label: 'Garbled call — should be HELD by the confidence gate (no brief to a designer)',
    input: {
      channel: 'phone' as const, sourceRef: `demo-call-${Date.now()}`, durationSec: 95,
      text: 'Front Desk: Good afternoon, Aangan Studio.\nCaller: Hello... [inaudible] ... flat in [uncertain: Baner or Banner?] ... [inaudible] ... maybe two thousand or twelve hundred sq... [inaudible] ... kitchen ... [inaudible] ...\nFront Desk: Sorry, the line is breaking up.\nCaller: [inaudible] ... before [inaudible] ...',
    },
  },
  {
    label: 'Out of area, high value — should go to HUMAN REVIEW, not an automatic decline',
    input: {
      channel: 'web_form' as const, callerName: 'Nilesh D', sourceRef: `demo-form-${Date.now()}`,
      text: 'Name: Nilesh D\nProject type: Residential — Full home\nLocation: Talegaon Dabhade\nCarpet area: ~1,600 sq ft (3BHK independent house)\nTimeline: 4 months, flexible\nBudget: ₹18–22 lakh for the full home\nNotes: I know it is outside Pune, can you still take it up?',
    },
  },
];

async function main() {
  const store = getStore();
  console.log(`Store: ${store.demo ? 'in-memory demo' : 'Supabase'}\n`);
  for (const s of SAMPLES) {
    console.log(`▶ ${s.label}`);
    const t0 = Date.now();
    const r = await processEnquiry(s.input);
    console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s · outcome=${r.outcome} · confidence=${r.confidence !== undefined ? (r.confidence * 100).toFixed(0) + '%' : 'n/a'} · escalations=[${r.escalations.join(', ')}]${r.aiFailed ? ' · AI FAILED' : ''}`);
    if (r.handoff) console.log(`  handoff: ${r.handoff}`);
    const e = r.enquiryId ? await store.getEnquiry(r.enquiryId) : null;
    if (e) console.log(`  → ${e.client_name ?? 'Unnamed'} · ${e.location ?? 'no location'} · status=${e.status} · criteria=${JSON.stringify(e.criteria)}\n`);
  }
}

main().catch((e) => { console.error('Failed:', e instanceof Error ? e.message : e); process.exit(1); });
