// Shared HTTP plumbing for the /api/ingest/* endpoints.

import { after } from 'next/server';
import { z } from 'zod';
import { checkBearer } from './auth';
import { processEnquiry, type IngestInput } from './pipeline';
import type { CallOutcome, Channel } from './types';

const MAX_AUDIO_BYTES = 4 * 1024 * 1024; // Vercel serverless request-body cap is 4.5 MB

const base = z.object({
  source_ref: z.string().max(200).optional(),
  from: z.string().max(40).optional(),
  name: z.string().max(200).optional(),
  email: z.string().max(200).optional(),
  received_at: z.string().datetime({ offset: true }).optional(),
  first_response_at: z.string().datetime({ offset: true }).optional(),
  duration_sec: z.coerce.number().int().min(0).max(36_000).optional(),
  outcome: z.enum(['completed', 'missed', 'dropped', 'failed']).optional(),
  text: z.string().max(60_000).optional(),
  recording_url: z.string().url().max(2000).optional(),
  language: z.string().max(20).optional(),
  stt_confidence: z.coerce.number().min(0).max(1).optional(),
  async: z.coerce.boolean().optional(),
});

const whatsapp = base.extend({
  thread: z.union([z.string().max(60_000), z.array(z.object({ at: z.string().optional(), from: z.string(), text: z.string() })).max(500)]).optional(),
});

const webForm = base.extend({
  fields: z.record(z.string().max(5000)).optional(),
});

const OUTCOME: Record<string, CallOutcome | null> = { completed: 'answered', missed: 'missed', dropped: 'dropped', failed: 'dropped' };

function toInput(channel: Channel, p: z.infer<typeof base> & { thread?: unknown; fields?: Record<string, string> }, audio?: IngestInput['audio']): IngestInput {
  let text = p.text ?? '';
  if (channel === 'whatsapp' && p.thread) {
    const customer = p.name ?? 'Customer';
    text = typeof p.thread === 'string'
      ? p.thread
      : (p.thread as { at?: string; from: string; text: string }[])
          .map((m) => `${m.at ? m.at + ' — ' : ''}${/studio|front|agent|business/i.test(m.from) ? 'Front Desk' : customer}: ${m.text}`)
          .join('\n');
  }
  if (channel === 'web_form' && p.fields) text = Object.entries(p.fields).map(([k, v]) => `${k}: ${v}`).join('\n');
  return {
    channel,
    sourceRef: p.source_ref ?? null,
    receivedAt: p.received_at ? new Date(p.received_at) : undefined,
    firstResponseAt: p.first_response_at ? new Date(p.first_response_at) : null,
    callerPhone: p.from ?? null,
    callerName: p.name ?? null,
    callerEmail: p.email ?? null,
    text: text || undefined,
    audio,
    audioUrl: p.recording_url ?? null,
    durationSec: p.duration_sec ?? null,
    language: p.language ?? null,
    sttConfidence: p.stt_confidence ?? null,
    callOutcome: channel === 'phone' ? (p.outcome ? OUTCOME[p.outcome] : 'answered') : null,
  };
}

/** Parse + authenticate + run the pipeline. Returns a Response. */
export async function handleIngest(req: Request, channel: Channel): Promise<Response> {
  if (!checkBearer(req, process.env.INGEST_API_KEY)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let input: IngestInput;
  let wantsAsync = false;
  try {
    const ctype = req.headers.get('content-type') ?? '';
    if (ctype.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('audio');
      let audio: IngestInput['audio'];
      if (file instanceof File && file.size > 0) {
        if (file.size > MAX_AUDIO_BYTES) return Response.json({ error: 'Audio too large (4 MB max); send a transcript or a shorter clip' }, { status: 413 });
        audio = { data: Buffer.from(await file.arrayBuffer()), mimeType: file.type || 'audio/mpeg' };
      }
      const fields = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string')) as Record<string, string>;
      const p = base.parse(fields);
      wantsAsync = Boolean(p.async);
      input = toInput(channel, p, audio);
    } else {
      const json = await req.json();
      const schema = channel === 'whatsapp' ? whatsapp : channel === 'web_form' ? webForm : base;
      const p = schema.parse(json);
      wantsAsync = Boolean(p.async);
      input = toInput(channel, p as never);
    }
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : 'Invalid request body';
    return Response.json({ error: msg }, { status: 400 });
  }

  // An empty payload must be rejected, not recorded as a phantom "AI failed" enquiry. Allowed: message text, audio,
  // a recording reference, or a call that never connected (missed / dropped — nothing to transcribe).
  const hasContent = Boolean(input.text || input.audio || input.audioUrl) || input.callOutcome === 'missed' || input.callOutcome === 'dropped';
  if (!hasContent) {
    return Response.json({ error: 'Nothing to process: send text (or thread / fields), an audio file, a recording_url, or outcome "missed"/"dropped".' }, { status: 400 });
  }

  if (wantsAsync) {
    after(async () => {
      try { await processEnquiry(input); } catch (e) { console.error('ingest (async) failed', e); }
    });
    return Response.json({ accepted: true }, { status: 202 });
  }
  try {
    return Response.json(await processEnquiry(input), { status: 200 });
  } catch (err) {
    console.error('ingest failed', err);
    return Response.json({ error: 'Processing failed' }, { status: 500 });
  }
}
