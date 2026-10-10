// Pull completed calls from the configured voice provider(s) and run each through the intake pipeline.
//
// Safe to run repeatedly and concurrently-ish: enquiries are de-duplicated on `${provider}:${callId}`, calls Vaani is still
// post-processing are left for the next run (nothing is ingested half-finished), and the work per run is capped so a
// serverless invocation never runs out of time.

import { processEnquiry } from '../pipeline';
import { getStore } from '../store';
import { fetchRecording } from './fetch-recording';
import type { VoiceProvider } from './provider';
import { vaani } from './vaani';

export interface SyncSummary {
  pulled: number;
  created: number;
  duplicates: number;
  pending: number;
  skipped: number;
  errors: string[];
}

/** The most recent sync this server instance ran (in memory only — shown on the Calls tab as a hint, not a source of truth). */
export let lastSync: { at: Date; summary: Record<string, SyncSummary> } | null = null;

export const DEFAULT_PROVIDERS: VoiceProvider[] = [vaani];

export async function runVoiceSync(opts: { since?: Date; maxCalls?: number; providers?: VoiceProvider[] } = {}): Promise<Record<string, SyncSummary>> {
  const since = opts.since ?? new Date(Date.now() - 24 * 3_600_000);
  const maxCalls = opts.maxCalls ?? 20;
  const store = getStore();
  const result: Record<string, SyncSummary> = {};

  for (const provider of (opts.providers ?? DEFAULT_PROVIDERS).filter((p) => p.isConfigured())) {
    const s: SyncSummary = (result[provider.name] = { pulled: 0, created: 0, duplicates: 0, pending: 0, skipped: 0, errors: [] });
    let calls;
    try {
      calls = await provider.listCalls(since);
    } catch (err) {
      s.errors.push(err instanceof Error ? err.message : String(err));
      continue;
    }
    s.pulled = calls.length;
    calls.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime()); // oldest first, so a backlog drains in order

    for (const c of calls) {
      if (s.created >= maxCalls) { s.skipped++; continue; }
      const ref = `${provider.name}:${c.callId}`;
      try {
        if (await store.enquiryExists(ref)) { s.duplicates++; continue; }
        if (c.outcome === 'completed' && !c.ready) { s.pending++; continue; } // still post-processing
        let transcript = c.transcript;
        if (c.outcome === 'completed' && !transcript && provider.loadTranscript) transcript = await provider.loadTranscript(c);
        if (c.outcome === 'completed' && !transcript && !c.ready) { s.pending++; continue; }

        let audio;
        if (c.outcome === 'completed' && !transcript && c.recordingUrl) audio = await fetchRecording(c.recordingUrl).catch(() => undefined);

        // A "completed" call with no transcript and no audio is recorded as a dropped call (callback needed) — never lost.
        const outcome = c.outcome === 'completed' && !transcript && !audio ? 'dropped' : c.outcome === 'completed' ? 'answered' : c.outcome === 'missed' ? 'missed' : 'dropped';
        await processEnquiry({
          channel: 'phone', sourceRef: ref, receivedAt: c.startedAt, callerPhone: c.callerNumber,
          text: transcript ?? undefined, audio, audioUrl: c.recordingUrl, durationSec: c.durationSec, language: c.language,
          sttConfidence: c.sttConfidence, callOutcome: outcome,
          // The voice agent picks up immediately, so a completed call is answered at its start (the <1 h response metric).
          firstResponseAt: c.outcome === 'completed' ? c.startedAt : null,
        });
        s.created++;
      } catch (err) {
        s.errors.push(`${c.callId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  lastSync = { at: new Date(), summary: result };
  return result;
}

// ---- opportunistic sync on dashboard load (for plans without sub-daily cron) --------------------------------------

let lastRun = 0;
let running = false;

/** True when at least one provider is configured. */
export const voiceSyncConfigured = (): boolean => DEFAULT_PROVIDERS.some((p) => p.isConfigured());

/**
 * Called from the dashboard page for signed-in/designer views: kicks off a small background sync at most once every
 * `minGapMs` per server instance. Correctness never depends on it (the scheduled cron and de-duplication cover gaps);
 * it just makes new calls appear within about a minute whenever someone has the dashboard open.
 */
export function shouldRunOnLoad(minGapMs = 120_000, now = Date.now()): boolean {
  if (running || now - lastRun < minGapMs || !voiceSyncConfigured()) return false;
  lastRun = now;
  return true;
}

export async function backgroundSync(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await runVoiceSync({ since: new Date(Date.now() - 6 * 3_600_000), maxCalls: 5 });
  } catch (err) {
    console.error('voice background sync failed', err);
  } finally {
    running = false;
  }
}
