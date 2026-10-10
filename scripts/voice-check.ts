// Check the Vaani integration against YOUR Vaani account without ingesting anything (read-only).
//   VAANI_API_KEY=vaani_... npm run voice:check [-- --hours 72] [-- --ingest]
// Lists the inbound calls the sync would pick up (phone numbers masked), fetches one transcript to prove the mapping,
// and with --ingest runs the real sync (creating enquiries) for the same window.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { vaani } from '../lib/voice/vaani';
import { runVoiceSync } from '../lib/voice/sync';

const args = process.argv.slice(2);
const hours = Number(args[args.indexOf('--hours') + 1]) || 72;
const mask = (s: string | null) => (s ? s.replace(/\d(?=\d{3})/g, 'x') : '—');

async function main() {
  if (!vaani.isConfigured()) throw new Error('VAANI_API_KEY is not set.');
  const since = new Date(Date.now() - hours * 3_600_000);
  console.log(`Vaani call history, last ${hours} h (inbound only unless VAANI_INCLUDE_OUTBOUND=true)\n`);
  const calls = await vaani.listCalls(since);
  console.log(`${calls.length} call(s)`);
  for (const c of calls.slice(0, 15)) {
    console.log(`  ${c.callId.padEnd(34)} ${c.startedAt.toISOString().slice(0, 16)}Z  ${String(c.durationSec ?? '?').padStart(4)}s  ${c.outcome.padEnd(9)} ${c.ready ? 'ready  ' : 'pending'}  from ${mask(c.callerNumber)}`);
  }
  const sample = calls.find((c) => c.outcome === 'completed' && c.ready);
  if (sample && vaani.loadTranscript) {
    const t = await vaani.loadTranscript(sample);
    console.log(`\nTranscript of ${sample.callId} (${t?.length ?? 0} chars):\n${(t ?? '(none yet)').slice(0, 400)}${t && t.length > 400 ? '…' : ''}`);
  }
  if (args.includes('--ingest')) {
    console.log('\nIngesting…');
    console.log(JSON.stringify(await runVoiceSync({ since }), null, 2));
  } else {
    console.log('\n(dry run — nothing ingested; add --ingest to create enquiries)');
  }
}
main().catch((e) => { console.error('Vaani check failed:', e instanceof Error ? e.message : e); process.exit(1); });
