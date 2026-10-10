// Generates SQL you can paste straight into the Supabase SQL editor — no CLI, keys or Node needed on the target.
//
//   npm run seed:sql                       →  supabase/seed.sql  and  supabase/setup-and-seed.sql (schema + seed, one paste)
//   npm run seed:sql -- --synthetic 160    →  also include 160 simulated (is_synthetic) enquiries
//
// Rows are embedded as JSON and loaded with jsonb_populate_recordset, so arrays, jsonb, timestamps and quoting are all
// handled by Postgres itself. The seed refuses to run twice (it aborts if `enquiries` already has rows).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDataset } from '../data/build-dataset';

const args = process.argv.slice(2);
const i = args.indexOf('--synthetic');
const synthetic = i >= 0 ? Number(args[i + 1]) || 0 : 0;

const d = buildDataset(new Date(), synthetic);

// FK order: parents first.
const tables: [string, object[]][] = [
  ['designers', d.designers],
  ['enquiries', d.enquiries],
  ['transcripts', d.transcripts],
  ['pricing_logs', d.pricingLogs],
  ['escalations', d.escalations],
  ['consultations', d.consultations],
  ['tool_costs', d.toolCosts],
];

const TAG = '$aangan$';
const parts: string[] = [
  '-- ============================================================================',
  `-- Aangan Studio seed data — generated ${new Date().toISOString()}`,
  `-- ${d.enquiries.filter((e) => !e.is_synthetic).length} real (anonymised) September-2026 enquiries${synthetic ? ` + ${d.enquiries.filter((e) => e.is_synthetic).length} synthetic` : ''}.`,
  '-- Run AFTER supabase/schema.sql. Aborts (and changes nothing) if enquiries already has data.',
  '-- ============================================================================',
  '',
  'begin;',
  '',
  'do $$ begin',
  "  if exists (select 1 from public.enquiries) then",
  "    raise exception 'enquiries already has data - seed skipped to avoid duplicates';",
  '  end if;',
  'end $$;',
  '',
];

for (const [table, rows] of tables) {
  const json = JSON.stringify(rows);
  if (json.includes(TAG)) throw new Error(`Dollar-quote tag collision in ${table}`);
  parts.push(
    `-- ${table} (${rows.length})`,
    `insert into public.${table}`,
    `select * from jsonb_populate_recordset(null::public.${table}, ${TAG}${json}${TAG}::jsonb);`,
    '',
  );
}
parts.push('commit;', '');

const seed = parts.join('\n');
const root = join(__dirname, '..', 'supabase');
writeFileSync(join(root, 'seed.sql'), seed);
const schema = readFileSync(join(root, 'schema.sql'), 'utf8');
writeFileSync(join(root, 'setup-and-seed.sql'), `${schema}\n\n${seed}`);

const kb = (s: string) => `${Math.round(Buffer.byteLength(s) / 1024)} KB`;
console.log(`supabase/seed.sql            ${kb(seed)}`);
console.log(`supabase/setup-and-seed.sql  ${kb(schema + seed)}  (schema + seed — paste this one into the SQL editor)`);
for (const [t, r] of tables) console.log(`  ${t.padEnd(14)} ${r.length}`);
