// Load the 14-person MOCK designer roster into Supabase (replacing any existing SAMPLE designers).
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run designers:mock
// Only rows flagged is_sample are removed/replaced — real designers (is_sample = false) are never touched, and
// "Aryan" (named in the source data) is kept if already present. Enquiries pointing at a removed sample designer
// just lose the assignment (FK is ON DELETE SET NULL).

import { config } from 'dotenv';
config({ path: '.env.local' });

import { sampleDesigners } from '../data/build-dataset';
import { getAdmin } from '../lib/store';

async function main() {
  const db = getAdmin();
  if (!db) throw new Error('Supabase is not configured (set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).');

  const { data: existing, error: e1 } = await db.from('designers').select('id,name,is_sample');
  if (e1) throw new Error(e1.message);
  const have = new Set((existing ?? []).filter((d) => !d.is_sample).map((d) => d.name.toLowerCase()));

  const del = await db.from('designers').delete().eq('is_sample', true);
  if (del.error) throw new Error(del.error.message);

  const roster = sampleDesigners(new Date()).filter((d) => d.is_sample || !have.has(d.name.toLowerCase()));
  const { error } = await db.from('designers').insert(roster);
  if (error) throw new Error(error.message);

  const { data: after } = await db.from('designers').select('name,role,is_sample').order('role').order('name');
  console.log(`Roster now has ${after?.length} designers:`);
  for (const d of after ?? []) console.log(`  ${d.is_sample ? '○ mock' : '● real'}  ${d.role.padEnd(16)} ${d.name}`);
}

main().catch((e) => { console.error('Failed:', e instanceof Error ? e.message : e); process.exit(1); });
