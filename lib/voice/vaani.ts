// Vaani Voice (vaanivoice.ai) — pull integration. NO webhooks: we poll the REST API.
//
// Documented API (https://docs.vaanivoice.ai, OpenAPI 2.0.0):
//   base        https://api.vaanivoice.ai
//   auth        header  X-API-Key: vaani_…          (the client/org is resolved from the key)
//   history     GET /api/call-history?page=&page_size=(max 200)   → { data: [call…], pagination: {…} }
//   transcript  GET /api/transcript/{call_id}                      → { transcript: "AGENT: …\n\n USER: …" }
//   recording   GET /api/stream/{call_id}  (the history's `recording_api` URL; needs the key — we store it as a reference)
//
// Observed facts we rely on:  Start_time / End_time are naive ISO strings in UTC (checked against the epoch embedded in
// call ids); `duration_ms` is NOT milliseconds (a 34 s call reports 742.269), so duration is computed from the timestamps;
// the transcript labels turns "AGENT:" and "USER:"; a call is ready once post_processing_status = "completed".
// Response bodies are loosely documented ("additionalProperties"), so every field is read defensively.

import type { ProviderCall, VoiceProvider } from './provider';

export class VaaniError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

interface VaaniCall {
  call_id?: string;
  direction?: string;
  call_type?: string;
  call_status?: string;
  from_number?: string;
  to_number?: string;
  Start_time?: string;
  End_time?: string;
  post_processing_status?: string;
  recording_api?: string;
}
interface HistoryPage {
  data?: VaaniCall[];
  pagination?: { page?: number; total_pages?: number; has_next?: boolean };
}

const MAX_PAGES = 10;
const PAGE_SIZE = 200;

/** Vaani timestamps are timezone-less UTC. */
export function parseVaaniTime(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "AGENT: …" / "USER: …" → the "Front Desk:" / "Caller:" labels the analyser and the price-policy scan expect. */
export function normaliseVaaniTranscript(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw
    // [ \t] (not \s): Vaani writes "\n\n USER:" and \s would swallow the blank line before the label.
    .replace(/^[ \t]*AGENT[ \t]*:/gim, 'Front Desk:')
    .replace(/^[ \t]*(?:USER|CUSTOMER|CALLER)[ \t]*:/gim, 'Caller:')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t.length > 0 ? t : null;
}

function mapCall(c: VaaniCall, includeOutbound: boolean): ProviderCall | null {
  if (!c.call_id) return null;
  const inbound = /inbound/i.test(c.direction ?? c.call_type ?? '');
  if (!inbound && !includeOutbound) return null; // outbound calls are the agent calling out, not enquiries
  const startedAt = parseVaaniTime(c.Start_time);
  if (!startedAt) return null;
  const endedAt = parseVaaniTime(c.End_time);
  const durationSec = endedAt ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)) : null;
  const status = c.call_status ?? '';
  let outcome: ProviderCall['outcome'] = 'completed';
  if (/no.?answer|not.?answered|missed|busy|unreachable|reject|voicemail/i.test(status)) outcome = 'missed';
  else if (/fail|error|timeout/i.test(status)) outcome = 'failed';
  else if (durationSec !== null && durationSec < 3) outcome = 'missed'; // nobody actually spoke
  const post = c.post_processing_status;
  return {
    callId: c.call_id,
    callerNumber: (inbound ? c.from_number : c.to_number) ?? null,
    startedAt,
    endedAt,
    durationSec,
    outcome,
    ready: !post || /complete|done|success/i.test(post),
    transcript: null,
    recordingUrl: c.recording_api ?? null,
    language: null,
    sttConfidence: null,
  };
}

export interface VaaniOptions {
  apiKey?: string;
  baseUrl?: string;
  includeOutbound?: boolean;
  fetchImpl?: typeof fetch;
}

export function createVaaniProvider(opts: VaaniOptions = {}): VoiceProvider {
  const key = () => opts.apiKey ?? process.env.VAANI_API_KEY;
  const base = () => (opts.baseUrl ?? process.env.VAANI_BASE_URL ?? 'https://api.vaanivoice.ai').replace(/\/+$/, '');
  const includeOutbound = () => opts.includeOutbound ?? process.env.VAANI_INCLUDE_OUTBOUND === 'true';
  const doFetch = opts.fetchImpl ?? fetch;

  async function get<T>(path: string): Promise<T> {
    const res = await doFetch(base() + path, {
      headers: { 'X-API-Key': key() ?? '', accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
    if (!res.ok) {
      const msg = (json as { message?: string; detail?: string } | null)?.message ?? (json as { detail?: string } | null)?.detail ?? text.slice(0, 160);
      throw new VaaniError(`Vaani ${res.status}: ${msg}`, res.status);
    }
    return json as T;
  }

  return {
    name: 'vaani',

    isConfigured: () => Boolean(key()),

    async listCalls(since) {
      const out: ProviderCall[] = [];
      const first = await get<HistoryPage>(`/api/call-history?page=1&page_size=${PAGE_SIZE}`);
      const totalPages = Math.max(1, first.pagination?.total_pages ?? (first.pagination?.has_next ? 2 : 1));
      const firstItems = first.data ?? [];
      // The docs don't say how history is ordered. Detect it from page 1 so we always walk newest → oldest.
      const times = firstItems.map((c) => parseVaaniTime(c.Start_time)?.getTime()).filter((t): t is number => t !== undefined);
      const ascending = times.length > 1 && times[0] < times[times.length - 1];
      const order = Array.from({ length: Math.min(totalPages, MAX_PAGES) }, (_, i) => (ascending ? totalPages - i : i + 1)).filter((p) => p >= 1);

      for (const page of order) {
        const items = page === 1 ? firstItems : (await get<HistoryPage>(`/api/call-history?page=${page}&page_size=${PAGE_SIZE}`)).data ?? [];
        let anyRecent = false;
        for (const c of items) {
          const mapped = mapCall(c, includeOutbound());
          const t = parseVaaniTime(c.Start_time);
          if (t && t >= since) anyRecent = true;
          if (mapped && mapped.startedAt >= since) out.push(mapped);
        }
        if (!anyRecent && items.length > 0) break; // this whole page is older than the look-back — nothing newer follows
      }
      return out;
    },

    async loadTranscript(call) {
      try {
        const r = await get<{ transcript?: unknown }>(`/api/transcript/${encodeURIComponent(call.callId)}`);
        return normaliseVaaniTranscript(r.transcript);
      } catch (err) {
        if (err instanceof VaaniError && err.status === 404) return null; // transcript still being generated
        throw err;
      }
    },
  };
}

export const vaani: VoiceProvider = createVaaniProvider();
