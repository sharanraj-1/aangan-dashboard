// Seed Supabase with Aangan's real September-2026 enquiries (+ designers, calendar entry, tool costs).
//
//   npm run seed                              40 real enquiries (idempotent: refuses if enquiries already exist)
//   npm run seed -- --synthetic 160           + 160 simulated enquiries → ~200 for September (flagged is_synthetic)
//   npm run seed:reset -- --yes               wipe ALL dashboard tables first (destructive; requires --yes)
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (run supabase/schema.sql first).

import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import { createClient } from '@supabase/supabase-js';
import { buildDataset } from '../data/build-dataset';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const val = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Put them in .env.local (see .env.example).');
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });
  const synthetic = Number(val('synthetic') ?? 0) || 0;
  const month = val('month') ?? '2026-09';

  const { count, error: countErr } = await db.from('enquiries').select('id', { count: 'exact', head: true });
  if (countErr) {
    console.error(`Cannot read enquiries: ${countErr.message}\nHave you run supabase/schema.sql in the Supabase SQL editor?`);
    process.exit(1);
  }

  if (flag('reset')) {
    if (!flag('yes')) {
      console.error(`--reset deletes ALL data in the dashboard tables of ${new URL(url).host} (${count ?? 0} enquiries now). Re-run with --yes to confirm.`);
      process.exit(1);
    }
    // FK order: children first.
    for (const t of ['outbound_emails', 'consultations', 'escalations', 'pricing_logs', 'transcripts', 'enquiries', 'tool_costs', 'designers']) {
      const { error } = await db.from(t).delete().not('id', 'is', null);
      if (error) throw new Error(`Failed to clear ${t}: ${error.message}`);
    }
    console.log('Cleared existing data.');
  } else if ((count ?? 0) > 0) {
    console.error(`enquiries already has ${count} rows. Seeding again would duplicate them. Use  npm run seed:reset -- --yes  to start clean.`);
    process.exit(1);
  }

  const d = buildDataset(new Date(), synthetic, month);
  const insert = async (table: string, rows: object[]) => {
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db.from(table).insert(rows.slice(i, i + 200) as never);
      if (error) throw new Error(`Insert into ${table} failed: ${error.message}`);
    }
    console.log(`  ${table.padEnd(16)} ${rows.length}`);
  };

  console.log(`Seeding ${new URL(url).host} …`);
  await insert('designers', d.designers);
  await insert('enquiries', d.enquiries);
  await insert('transcripts', d.transcripts);
  await insert('pricing_logs', d.pricingLogs);
  await insert('escalations', d.escalations);
  await insert('consultations', d.consultations);
  await insert('tool_costs', d.toolCosts);

  const real = d.enquiries.filter((e) => !e.is_synthetic).length;
  console.log(`\nDone: ${real} real enquiries${synthetic ? ` + ${d.enquiries.length - real} synthetic (flagged is_synthetic)` : ''}.`);
  console.log('Designer directory contains PLACEHOLDER rows (is_sample) — replace them with the real designers.');
}

main().catch((e) => {
  console.error('Seed failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
