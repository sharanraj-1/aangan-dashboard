import { GEMINI } from './config';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Seconds of audio sent to the model (billed at the audio rate). */
  audioSeconds?: number;
}

/** Gemini audio input is ~32 tokens per second of audio. */
export const AUDIO_TOKENS_PER_SECOND = 32;

/** Approximate ₹ cost of one model call from token counts. List prices are env-tunable in config.ts. */
export function estimateCostInr(u: Usage): number {
  const audioTokens = Math.round((u.audioSeconds ?? 0) * AUDIO_TOKENS_PER_SECOND);
  const textIn = Math.max(0, u.inputTokens - audioTokens);
  const usd =
    (textIn * GEMINI.inputUsdPerMTok + audioTokens * GEMINI.audioInputUsdPerMTok + u.outputTokens * GEMINI.outputUsdPerMTok) / 1_000_000;
  return Math.round(usd * GEMINI.usdToInr * 10_000) / 10_000;
}

/** Rough token estimate for text (≈4 chars/token) — used where the API's usage metadata isn't available (seed data). */
export const approxTokens = (text: string): number => Math.ceil(text.length / 4);
