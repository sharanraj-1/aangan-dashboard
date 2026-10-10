import { handleIngest } from '@/lib/ingest-http';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST a WhatsApp thread: {from, name, thread: string | [{at, from, text}], received_at, first_response_at}.
 * Structural placeholder for the WhatsApp channel: wire the WhatsApp Business / BSP webhook to a small adapter that
 * posts here (this route is bearer-authenticated, so it is NOT the provider's webhook endpoint itself).
 */
export const POST = (req: Request) => handleIngest(req, 'whatsapp');
