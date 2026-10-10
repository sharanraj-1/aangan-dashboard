// Sanity-check the Gemini key + model, then run the extractor on one real enquiry and diff it against
// the expected outcome. Usage:  npm run gemini:check [-- T10]
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { SEPT_2026 } from '../data/sept-2026-enquiries';
import { extractEntities, isGeminiConfigured, runQualificationCheck } from '../lib/gemini';
import { GEMINI } from '../lib/config';

async function main() {
  if (!isGeminiConfigured()) {
    console.error('GEMINI_API_KEY is not set (put it in .env.local).');
    process.exit(1);
  }
  const ref = process.argv[2] ?? 'T10';
  const rec = SEPT_2026.find((r) => r.ref === ref);
  if (!rec) throw new Error(`No record ${ref}`);
  console.log(`Model: ${GEMINI.model}   Record: ${ref} (${rec.channel})`);

  const receivedAt = new Date(rec.at.replace(' ', 'T') + ':00+05:30');
  const t0 = Date.now();
  const { extraction, inputTokens, outputTokens, costInr } = await extractEntities(rec.raw, { channel: rec.channel, receivedAt });
  console.log(`\nGemini responded in ${Date.now() - t0} ms · ${inputTokens} in / ${outputTokens} out tokens · ≈ ₹${costInr.toFixed(3)}`);
  console.log('\nExtraction:', JSON.stringify({ ...extraction, summary: undefined }, null, 2));
  console.log('\nSummary:', extraction.summary);

  const result = runQualificationCheck(extraction, {
    now: receivedAt, receivedAt, firstResponseAt: receivedAt, callOutcome: rec.callOutcome ?? null, transcriptText: rec.raw, auditKey: ref,
  });
  console.log(`\nGuardrail outcome: ${result.outcome} · confidence ${(result.confidence * 100).toFixed(0)}% · escalations: [${result.escalations.map((e) => e.trigger).join(', ')}]`);
  console.log(`Expected         : ${rec.expect.outcome} · escalations: [${rec.expect.escalations.join(', ')}]`);
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
