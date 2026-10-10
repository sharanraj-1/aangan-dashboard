// Voice-provider seam. The dashboard does not care WHICH voice platform answers the phone — it needs, per
// completed call: a transcript (or a recording to transcribe), who called, when, and how long.
//
// Providers implement `VoiceProvider` and the sync job (/api/cron/voice-sync) PULLS completed calls through the
// provider's API, then runs each through the normal pipeline. Calls can also be PUSHED by anything that can send an
// authenticated POST to /api/ingest/call (same normalised shape).

export interface ProviderCall {
  /** Stable provider-side call id. Used to de-duplicate: enquiries.source_ref = `${provider}:${callId}`. */
  callId: string;
  /** Caller number as the provider reports it (may be masked). */
  callerNumber: string | null;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  /** Provider-side outcome. 'failed' = the call broke mid-way and the caller was not served. */
  outcome: 'completed' | 'missed' | 'failed';
  /** False while the provider is still post-processing (the transcript may not exist yet) — try again on the next run. */
  ready: boolean;
  /** Transcript with "Front Desk:" / "Caller:" labels, when the provider supplies one. */
  transcript: string | null;
  /** Recording to transcribe with Gemini when no transcript is supplied. */
  recordingUrl: string | null;
  language: string | null;
  /** Provider-reported STT confidence 0–1, if any. */
  sttConfidence: number | null;
}

export interface VoiceProvider {
  readonly name: string;
  isConfigured(): boolean;
  /** Calls that started at or after `since` (cheap: no transcripts yet). */
  listCalls(since: Date): Promise<ProviderCall[]>;
  /** Fetch the transcript for ONE call — called only for calls we haven't ingested yet, so repeat runs stay cheap. */
  loadTranscript?(call: ProviderCall): Promise<string | null>;
}

const AGENT_ROLES = /^(assistant|agent|bot|ai|system)$/i;
const CALLER_ROLES = /^(user|caller|customer|human|client)$/i;

/** Turn a provider's turn-array (or plain string) into the "Front Desk: … / Caller: …" format the analyser expects. */
export function formatTranscript(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (!Array.isArray(raw)) return '';
  return raw
    .map((t) => {
      if (typeof t === 'string') return t;
      if (typeof t !== 'object' || t === null) return '';
      const o = t as Record<string, unknown>;
      const role = String(o.role ?? o.speaker ?? '');
      const text = typeof o.text === 'string' ? o.text : typeof o.content === 'string' ? o.content : '';
      if (!text.trim()) return '';
      const label = AGENT_ROLES.test(role) ? 'Front Desk' : CALLER_ROLES.test(role) ? 'Caller' : role || 'Caller';
      return `${label}: ${text.trim()}`;
    })
    .filter(Boolean)
    .join('\n');
}
