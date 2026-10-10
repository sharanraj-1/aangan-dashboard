import { handleIngest } from '@/lib/ingest-http';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** POST a website form submission: {name, email, from, fields: {"Project type": "...", Location: "...", ...}, received_at}. */
export const POST = (req: Request) => handleIngest(req, 'web_form');
