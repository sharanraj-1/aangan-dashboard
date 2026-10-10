// Live intake pipeline:  audio / text  →  transcript  →  Gemini extraction  →  guardrails  →  persist  →  alerts  →  handoff.
//
// Guarantees:
//   • No enquiry is ever dropped. If Gemini is down or returns garbage, the raw text is stored and the enquiry is
//     escalated to the front desk (gate trigger `ai_failure`).
//   • Retries are harmless: `sourceRef` de-duplicates (e.g. re-pulling the same voice-provider call).
//   • Nothing is declined silently when it is uncertain / valuable / low-confidence (see lib/guardrails.ts).

import { failedExtraction, blankExtraction } from './extraction';
import { extractEntities, isGeminiConfigured, transcribeAudio } from './gemini';
import { buildRecords } from './records';
import { getStore } from './store';
import { notifyEscalation, releaseHandoff, sendEmailToClient, syncCrm } from './workflow';
import type { CallOutcome, Channel, EmailTemplate } from './types';

export interface IngestInput {
  channel: Channel;
  /** Stable external id, e.g. "vaani:<callId>". Used to de-duplicate. */
  sourceRef?: string | null;
  receivedAt?: Date;
  callerPhone?: string | null;
  callerName?: string | null;
  callerEmail?: string | null;
  /** Message text, form submission, or an already-produced transcript. */
  text?: string;
  /** Recording to transcribe when no transcript is available. */
  audio?: { data: Buffer; mimeType: string };
  audioUrl?: string | null;
  durationSec?: number | null;
  language?: string | null;
  /** Provider-reported STT confidence, if any. */
  sttConfidence?: number | null;
  callOutcome?: CallOutcome | null;
  firstResponseAt?: Date | null;
}

export interface IngestResult {
  duplicate: boolean;
  enquiryId?: string;
  outcome?: string;
  confidence?: number;
  escalations: string[];
  handoff?: string;
  aiFailed?: boolean;
}

export async function processEnquiry(input: IngestInput): Promise<IngestResult> {
  const store = getStore();
  if (input.sourceRef && (await store.enquiryExists(input.sourceRef))) return { duplicate: true, escalations: [] };

  const receivedAt = input.receivedAt ?? new Date();
  const now = new Date();
  const noConversation = input.callOutcome === 'missed' || input.callOutcome === 'dropped';

  let raw = input.text?.trim() ?? '';
  let processed: string | null = null;
  let language = input.language ?? null;
  let sttConf = input.sttConfidence ?? undefined;
  let inaudible = 0;
  let aiFailed = false;
  let failNote = '';
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  let extraction = blankExtraction({ intent: 'other', client_phone: input.callerPhone ?? null, client_name: input.callerName ?? null, client_email: input.callerEmail ?? null });

  try {
    // 1. Speech-to-text, only if we were given audio and no transcript.
    if (!raw && input.audio) {
      if (!isGeminiConfigured()) throw new Error('GEMINI_API_KEY not set');
      const t = await transcribeAudio({ data: input.audio.data, mimeType: input.audio.mimeType, durationSeconds: input.durationSec ?? undefined });
      raw = t.raw; processed = t.processed; language = t.language; sttConf = t.confidence; inaudible = t.inaudibleCount;
    }
    // 2. Structured extraction.
    if (raw && !noConversation) {
      if (!isGeminiConfigured()) throw new Error('GEMINI_API_KEY not set');
      const r = await extractEntities(processed ?? raw, { channel: input.channel, receivedAt, callerPhone: input.callerPhone, transcriptionConfidence: sttConf, inaudibleCount: inaudible });
      extraction = r.extraction;
      usage = { inputTokens: r.inputTokens, outputTokens: r.outputTokens };
      if (!extraction.client_name && input.callerName) extraction.client_name = input.callerName;
      if (!extraction.client_email && input.callerEmail) extraction.client_email = input.callerEmail;
    } else if (!noConversation && !raw) {
      throw new Error('No transcript, text or audio supplied');
    }
  } catch (err) {
    aiFailed = true;
    failNote = err instanceof Error ? err.message : String(err);
    extraction = { ...failedExtraction(failNote), client_phone: input.callerPhone ?? null, client_name: input.callerName ?? null, client_email: input.callerEmail ?? null };
  }

  const built = buildRecords({
    sourceRef: input.sourceRef ?? null,
    channel: input.channel,
    receivedAt,
    callOutcome: input.callOutcome ?? (input.channel === 'phone' ? 'answered' : null),
    durationSec: input.durationSec ?? null,
    firstResponseAt: input.firstResponseAt ?? null,
    rawText: raw || (noConversation ? `${input.callOutcome === 'dropped' ? 'DROPPED' : 'MISSED'} CALL. No conversation.` : ''),
    processedText: processed,
    language,
    audioUrl: input.audioUrl ?? null,
    extraction,
    usage,
    now,
  });

  // Persist parents before children (FKs).
  await store.insert('enquiries', built.enquiry);
  if (built.transcript) await store.insert('transcripts', built.transcript);
  if (built.pricing) await store.insert('pricing_logs', built.pricing);
  if (built.escalations.length) await store.insert('escalations', built.escalations);

  // Alerts (never include transcripts; founder alerts carry no personal details).
  const escalationNames: string[] = [];
  for (const esc of built.escalations) {
    escalationNames.push(esc.trigger);
    const via = await notifyEscalation(esc, built.enquiry);
    if (via.length) await store.update('escalations', esc.id, { notified_via: via });
  }

  let handoff: string | undefined;
  if (built.triage.briefEligible) {
    const r = await releaseHandoff(store, built.enquiry.id, 'system');
    handoff = r.message;
    if (r.ok && process.env.AUTO_SEND_CLIENT_EMAIL === 'true' && built.enquiry.client_email) {
      const tpl: EmailTemplate = 'confirmation';
      const sent = await sendEmailToClient(store, built.enquiry.id, tpl, {}, 'system');
      handoff += ` Client email: ${sent.message}`;
    }
  } else {
    await syncCrm(store, built.enquiry.id);
  }

  return {
    duplicate: false,
    enquiryId: built.enquiry.id,
    outcome: built.enquiry.ai_qualification,
    confidence: built.triage.confidence,
    escalations: escalationNames,
    handoff,
    aiFailed,
  };
}
