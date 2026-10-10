// Downloads a call recording for Gemini transcription. SSRF-hardened: https only, host must be on an explicit
// allowlist (VOICE_RECORDING_HOSTS="recordings.example.com,cdn.vendor.com"), no redirects to other hosts, size-capped.

const MAX_BYTES = 4 * 1024 * 1024;

export async function fetchRecording(url: string): Promise<{ data: Buffer; mimeType: string }> {
  const u = new URL(url);
  const allowed = (process.env.VOICE_RECORDING_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (u.protocol !== 'https:') throw new Error('Recording URL must be https');
  if (!allowed.includes(u.hostname.toLowerCase())) throw new Error(`Recording host ${u.hostname} is not in VOICE_RECORDING_HOSTS`);
  const res = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Recording download failed: HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES) throw new Error('Recording too large (4 MB max)');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new Error('Recording too large (4 MB max)');
  return { data: buf, mimeType: res.headers.get('content-type')?.split(';')[0] || 'audio/mpeg' };
}
