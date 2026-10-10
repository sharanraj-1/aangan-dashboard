import { timingSafeEqual } from 'node:crypto';
import { headers } from 'next/headers';
import type { Role } from './store';

/** Role set by proxy.ts after Basic auth. Defaults to the LEAST privileged role if the header is ever missing. */
export async function getRole(): Promise<Role> {
  const h = await headers();
  return h.get('x-aangan-role') === 'designer' ? 'designer' : 'founder';
}

export async function getActor(): Promise<string> {
  const h = await headers();
  return h.get('x-aangan-user') ?? 'unknown';
}

/** Server actions that touch client data are designer-only. Throws for any other role. */
export async function requireDesigner(): Promise<string> {
  if ((await getRole()) !== 'designer') throw new Error('Forbidden: designer access required');
  const actor = await getActor();
  // The anonymous public viewer sees designer screens but may never change anything (proxy.ts also blocks the POST).
  if (actor.startsWith('viewer')) throw new Error('Forbidden: sign in to make changes');
  return actor;
}

/** True for the anonymous read-only visitor of the designer screens (PUBLIC_VIEW). */
export async function isReadOnlyViewer(): Promise<boolean> {
  return (await getRole()) === 'designer' && (await getActor()).startsWith('viewer');
}

/** Bearer-token check for machine endpoints (ingest / cron). Constant-time. Fails closed when the secret is unset. */
export function checkBearer(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
