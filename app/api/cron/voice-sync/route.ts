import { checkBearer } from '@/lib/auth';
import { runVoiceSync, voiceSyncConfigured } from '@/lib/voice/sync';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Pull job: asks each configured voice provider (Vaani) for calls since the look-back (default 24 h) and sends each new
 * one through the intake pipeline. Safe to call repeatedly — enquiries are de-duplicated on `vaani:<call_id>`.
 * Auth: `Authorization: Bearer $CRON_SECRET`. Optional `?since=2026-10-07T09:00:00Z` and `?max=20`.
 */
export async function GET(req: Request) {
  if (!checkBearer(req, process.env.CRON_SECRET ?? process.env.INGEST_API_KEY)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!voiceSyncConfigured()) {
    return Response.json({ error: 'No voice provider configured', hint: 'Set VAANI_API_KEY (see lib/voice/vaani.ts)' }, { status: 501 });
  }
  const url = new URL(req.url);
  const sinceParam = url.searchParams.get('since');
  const since = sinceParam ? new Date(sinceParam) : undefined;
  if (since && Number.isNaN(since.getTime())) return Response.json({ error: 'Invalid ?since' }, { status: 400 });
  const max = Math.min(50, Math.max(1, Number(url.searchParams.get('max')) || 20));
  const summary = await runVoiceSync({ since, maxCalls: max });
  return Response.json({ since: (since ?? new Date(Date.now() - 24 * 3_600_000)).toISOString(), summary });
}
