// Verify the HubSpot integration against YOUR portal, end to end, with a throwaway record that is deleted afterwards.
//   HUBSPOT_ACCESS_TOKEN=pat-... npm run hubspot:check
//
// 1. Token + scopes work (lists your deal pipelines).
// 2. The stage IDs this app uses exist in your pipeline (prints the fix if not).
// 3. Runs the REAL sync code (lib/hubspot.ts) on a fake qualified lead: contact + deal + note created,
//    then moves the deal to "won" and checks the stage changed.
// 4. Deletes everything it created.

import { config } from 'dotenv';
config({ path: '.env.local' });

import { blankExtraction, crit } from '../lib/extraction';
import { dealStageFor, isHubSpotConfigured, syncEnquiryToHubSpot } from '../lib/hubspot';
import { buildRecords } from '../lib/records';

const BASE = 'https://api.hubapi.com';
const H = () => ({ authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`, 'content-type': 'application/json' });
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures++; console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`); };

async function api<T>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: T }> {
  const res = await fetch(BASE + path, { method, headers: H(), body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { ok: res.ok, status: res.status, json: (text ? JSON.parse(text) : {}) as T };
}

interface Pipeline { id: string; label: string; stages: { id: string; label: string }[] }

async function main() {
  if (!isHubSpotConfigured()) throw new Error('HUBSPOT_ACCESS_TOKEN is not set.');
  console.log('1. Token & pipelines');
  const pl = await api<{ results: Pipeline[]; message?: string }>('GET', '/crm/v3/pipelines/deals');
  check('token accepted, deals readable', pl.ok, pl.ok ? '' : `HTTP ${pl.status}: ${pl.json.message ?? ''} (needs crm.objects.deals.read)`);
  if (!pl.ok) throw new Error('Cannot continue without a working token.');
  for (const p of pl.json.results) console.log(`     pipeline "${p.label}" (id: ${p.id}): ${p.stages.map((s) => `${s.label}=${s.id}`).join(', ')}`);

  console.log('2. Stage IDs used by the app');
  const wanted = process.env.HUBSPOT_PIPELINE_ID || 'default';
  const pipe = pl.json.results.find((p) => p.id === wanted);
  check(`pipeline "${wanted}" exists`, !!pipe, pipe ? pipe.label : `set HUBSPOT_PIPELINE_ID to one of: ${pl.json.results.map((p) => p.id).join(', ')}`);
  if (pipe) {
    const ids = new Set(pipe.stages.map((s) => s.id));
    const stages = {
      new: dealStageFor({ status: 'new', ai_qualification: 'review', final_qualification: null }, null),
      qualified: dealStageFor({ status: 'new', ai_qualification: 'qualified', final_qualification: null }, null),
      consultation: dealStageFor({ status: 'handed_off', ai_qualification: 'qualified', final_qualification: null }, { status: 'scheduled' }),
      won: dealStageFor({ status: 'won', ai_qualification: 'qualified', final_qualification: null }, null),
      lost: dealStageFor({ status: 'lost', ai_qualification: 'qualified', final_qualification: null }, null),
    };
    for (const [k, id] of Object.entries(stages)) check(`stage "${k}" → ${id}`, ids.has(id), ids.has(id) ? '' : `NOT in this pipeline — set HUBSPOT_STAGE_${k.toUpperCase()} to one of: ${pipe.stages.map((s) => `${s.label}=${s.id}`).join(', ')}`);
  }

  console.log('3. Real sync code on a throwaway lead');
  const now = new Date();
  const tag = Date.now();
  const x = blankExtraction({
    client_name: `Aangan SmokeTest${tag}`, client_email: `aangan.smoketest.${tag}@example.com`, project_type: 'residential', scope_type: 'full_home', scope_clarity: 'clear',
    location: 'Baner, Pune', location_clarity: 'clear', area_sqft: 1000, timeline_text: 'by March', weeks_to_completion: 20, criteria: crit('PPPUP'),
    summary: 'Automated HubSpot integration check — safe to delete.',
  });
  const e = buildRecords({ sourceRef: `hs-check-${tag}`, channel: 'web_form', receivedAt: now, rawText: 'x', extraction: x, now }).enquiry;
  const created: { contact?: string; deal?: string } = {};
  try {
    const r1 = await syncEnquiryToHubSpot(e);
    check('contact + deal + note created', r1.ok && !!r1.contactId && !!r1.dealId, r1.error ?? `contact ${r1.contactId}, deal ${r1.dealId}`);
    created.contact = r1.contactId; created.deal = r1.dealId;
    if (r1.dealId) {
      const d1 = await api<{ properties: { dealstage: string; dealname: string } }>('GET', `/crm/v3/objects/deals/${r1.dealId}?properties=dealstage,dealname`);
      check('deal starts in the "qualified" stage', d1.json.properties?.dealstage === dealStageFor(e, null), `${d1.json.properties?.dealname} → ${d1.json.properties?.dealstage}`);
      const assoc = await api<{ results: { id: string }[] }>('GET', `/crm/v3/objects/deals/${r1.dealId}/associations/contacts`);
      check('deal is associated with the contact', assoc.json.results?.some((a) => a.id === r1.contactId) === true);
    }
    // Move to won and re-sync: must PATCH the same deal (idempotent), not create a second one.
    const won = { ...e, status: 'won' as const, final_value_inr: 1_800_000, hubspot_contact_id: r1.contactId ?? null, hubspot_deal_id: r1.dealId ?? null };
    const r2 = await syncEnquiryToHubSpot(won);
    check('re-sync updates the same deal (idempotent)', r2.ok && r2.dealId === r1.dealId, r2.error ?? '');
    if (r1.dealId) {
      const d2 = await api<{ properties: { dealstage: string; amount: string } }>('GET', `/crm/v3/objects/deals/${r1.dealId}?properties=dealstage,amount`);
      check('deal moved to the "won" stage with the signed amount', d2.json.properties?.dealstage === dealStageFor(won, null) && d2.json.properties?.amount === '1800000', `${d2.json.properties?.dealstage}, ₹${d2.json.properties?.amount}`);
    }
  } finally {
    console.log('4. Cleanup');
    if (created.deal) check('test deal deleted', (await api('DELETE', `/crm/v3/objects/deals/${created.deal}`)).status === 204);
    if (created.contact) check('test contact deleted', (await api('DELETE', `/crm/v3/objects/contacts/${created.contact}`)).status === 204);
    console.log('     (the attached note is removed with the deal; check Notes in HubSpot if one remains)');
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nHubSpot integration verified.');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('HubSpot check failed:', e instanceof Error ? e.message : e); process.exit(1); });
