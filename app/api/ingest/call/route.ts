import { handleIngest } from '@/lib/ingest-http';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** POST a phone call: JSON {text|recording_url, from, name, received_at, duration_sec, outcome} or multipart with an `audio` file. */
export const POST = (req: Request) => handleIngest(req, 'phone');
