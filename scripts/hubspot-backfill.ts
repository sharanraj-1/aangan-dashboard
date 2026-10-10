// Backfill existing enquiries into HubSpot (contact + deal + note each), using the same code as the live sync.
//
//   HUBSPOT_ACCESS_TOKEN=pat-... NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     npm run hubspot:backfill -- --dry-run     # list what WOULD be created, change nothing
//     npm run hubspot:backfill                  # create them (idempotent: skips enquiries already synced)
//     npm run hubspot:backfill -- --undo        # delete the contacts/deals this script created, clear the stored IDs
//
// Only worthwhile leads sync (qualified / in review; never declined, spam or existing-client complaints) and each needs
// a name, email or dialable phone. HubSpot IDs are stored on the enquiry, so re-running never duplicates.

import { config } from 'dotenv';
config({ path: '.env.local' });

import { dealProperties, dealStageFor, isHubSpotConfigured, shouldSync } from '../lib/hubspot';
import { getAdmin, getStore } from '../lib/store';
import { syncCrm } from '../lib/workflow';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const UNDO = args.includes('--undo');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function del(path: string): Promise<number> {
  const res = await fetch(`https://api.hubapi.com${path}`, { method: 'DELETE', headers: { authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}` } });
  return res.status;
}

async function main() {
  if (!isHubSpotConfigured()) throw new Error('HUBSPOT_ACCESS_TOKEN is not set.');
  const db = getAdmin();
  if (!db) throw new Error('Supabase is not configured; refusing to backfill the in-memory demo store.');
  const store = getStore();
  const { enquiries } = await store.load('designer');
  const sorted = [...enquiries].sort((a, b) => a.received_at.localeCompare(b.received_at));

  if (UNDO) {
    const synced = sorted.filter((e) => e.hubspot_deal_id || e.hubspot_contact_id);
    console.log(`Undo: removing ${synced.length} synced record(s) from HubSpot…`);
    for (const e of synced) {
      const d = e.hubspot_deal_id ? await del(`/crm/v3/objects/deals/${e.hubspot_deal_id}`) : 0;
      const c = e.hubspot_contact_id ? await del(`/crm/v3/objects/contacts/${e.hubspot_contact_id}`) : 0;
      await store.update('enquiries', e.id, { hubspot_contact_id: null, hubspot_deal_id: null, hubspot_synced_at: null, hubspot_error: null });
      console.log(`  ${(e.source_ref ?? e.id.slice(0, 8)).padEnd(8)} deal ${d || '-'} contact ${c || '-'}`);
      await sleep(120);
    }
    return;
  }

  const eligible = sorted.filter((e) => shouldSync(e) && !e.hubspot_deal_id);
  const skipped = sorted.length - eligible.length;
  console.log(`${sorted.length} enquiries · ${eligible.length} to sync · ${skipped} skipped (declined / not a lead / no identity / already synced)\n`);

  let ok = 0, failed = 0;
  for (const e of eligible) {
    const label = `${(e.source_ref ?? e.id.slice(0, 8)).padEnd(6)} ${(e.client_name ?? 'Unnamed').slice(0, 34).padEnd(34)}`;
    if (DRY) {
      const p = dealProperties(e, null, null);
      console.log(`  would sync  ${label} → ${dealStageFor(e, null).padEnd(20)} ${p.amount ? '₹' + Number(p.amount).toLocaleString('en-IN') : '(no amount)'}`);
      continue;
    }
    await syncCrm(store, e.id);
    const after = await store.getEnquiry(e.id);
    if (after?.hubspot_deal_id) { ok++; console.log(`  synced      ${label} deal ${after.hubspot_deal_id}`); }
    else { failed++; console.log(`  FAILED      ${label} ${after?.hubspot_error ?? 'unknown error'}`); }
    await sleep(250); // stay well under HubSpot's burst limits
  }
  if (!DRY) console.log(`\nDone: ${ok} synced, ${failed} failed.`);
}

main().catch((e) => { console.error('Backfill failed:', e instanceof Error ? e.message : e); process.exit(1); });
