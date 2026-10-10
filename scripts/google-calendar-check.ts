// Verify Google Calendar sync against YOUR calendar, then clean up.
//   GOOGLE_SERVICE_ACCOUNT_JSON=... GOOGLE_CALENDAR_ID=... npm run calendar:check
// 1. Authenticates (service account or OAuth, whichever is configured).
// 2. Creates a test event on the calendar, 3. reads it back through free/busy, 4. deletes it.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createGoogleEvent, deleteGoogleEvent, googleBusy, googleMode, readServiceAccount } from '../lib/calendar';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures++; console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`); };

async function main() {
  const mode = googleMode();
  if (!mode) throw new Error('Google Calendar is not configured (set GOOGLE_SERVICE_ACCOUNT_JSON + GOOGLE_CALENDAR_ID, or the OAuth trio).');
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  const sa = readServiceAccount();
  console.log(`Mode: ${mode}${sa ? ` (${sa.email})` : ''} · calendar: ${calendarId}\n`);
  if (mode === 'service_account' && calendarId === 'primary') console.log('  ! A service account has its own empty "primary" calendar. Set GOOGLE_CALENDAR_ID to the studio calendar you shared with it.\n');

  const start = new Date(Date.now() + 3 * 24 * 3_600_000); start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 3_600_000);
  const created = await createGoogleEvent({ summary: 'Aangan integration check — safe to delete', description: 'Created by npm run calendar:check', start, end });
  check('event created on the studio calendar', created.ok, created.ok ? created.id : created.error);
  if (!created.ok) throw new Error('Cannot continue. If the error is 404/403, share the calendar with the service account email ("Make changes to events") and check GOOGLE_CALENDAR_ID.');

  const busy = await googleBusy(calendarId, new Date(start.getTime() - 60_000), new Date(end.getTime() + 60_000));
  check('free/busy sees the event', busy.some((b) => b.start.getTime() === start.getTime()), `${busy.length} busy block(s)`);

  const del = await deleteGoogleEvent(created.id);
  check('event deleted', del.ok, del.ok ? '' : del.error);
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nGoogle Calendar verified.');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error('Calendar check failed:', e instanceof Error ? e.message : e); process.exit(1); });
