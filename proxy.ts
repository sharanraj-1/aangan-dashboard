// Access control for the whole dashboard (Next 16 "proxy", formerly middleware).
//
// Two roles:
//   designer — full working tool (transcripts, escalations, briefs, calendar, emails). HTTP Basic auth REQUIRED.
//   founder  — end results only (aggregate metrics; the data layer also strips personal data for this role).
//              Nikhil needs NO sign-in: an anonymous page load of "/" shows this view (the founder login still works).
//
// /api/ingest/* and /api/cron/* are machine endpoints: they skip Basic auth and check a bearer secret themselves.
// In production the app REFUSES to serve unless both passwords are configured. Locally (no passwords) it runs open,
// and you can preview each role with  ?as=founder  /  ?as=designer.

import { NextResponse, type NextRequest } from 'next/server';

const enc = new TextEncoder();
function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function parseBasic(header: string | null): { user: string; pass: string } | null {
  if (!header?.startsWith('Basic ')) return null;
  try {
    const [user, ...rest] = atob(header.slice(6)).split(':');
    return { user, pass: rest.join(':') };
  } catch {
    return null;
  }
}

const deny = () =>
  new NextResponse('Authentication required', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Aangan Studio", charset="UTF-8"' } });

export function proxy(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  const headers = new Headers(req.headers);
  headers.delete('x-aangan-role'); // never trust a client-supplied role
  headers.delete('x-aangan-user');

  if (pathname.startsWith('/api/ingest') || pathname.startsWith('/api/cron')) return NextResponse.next({ request: { headers } });

  const designerPass = process.env.DESIGNER_PASSWORD;
  const founderPass = process.env.FOUNDER_PASSWORD;
  const prod = process.env.NODE_ENV === 'production';

  // Local / demo: open, with a role switcher.
  if (!designerPass && !founderPass) {
    if (prod) return new NextResponse('Dashboard locked: set DESIGNER_PASSWORD and FOUNDER_PASSWORD in the environment.', { status: 503 });
    const asParam = searchParams.get('as');
    const role = asParam === 'founder' || asParam === 'designer' ? asParam : req.cookies.get('aangan_role')?.value === 'founder' ? 'founder' : 'designer';
    headers.set('x-aangan-role', role);
    headers.set('x-aangan-user', role === 'founder' ? 'founder (local)' : 'designer (local)');
    const res = NextResponse.next({ request: { headers } });
    if (asParam) res.cookies.set('aangan_role', role, { path: '/', sameSite: 'lax' });
    return res;
  }

  const cred = parseBasic(req.headers.get('authorization'));
  const wantsLogin = searchParams.get('login') === '1';

  // PUBLIC RESULTS: with no credentials, a plain page load of "/" shows the founder's results view — aggregates only,
  // no names, contact details, transcripts or locations (the data layer strips them for this role). Anything else
  // without credentials (server actions, other paths, or the explicit "?login=1" sign-in link) gets the login prompt,
  // so the designers' tool is never reachable anonymously.
  // PUBLIC VIEW (env PUBLIC_VIEW=true): anyone can READ the designer screens (enquiries, transcripts, escalations, calendar)
  // with no login, but cannot CHANGE anything. Only plain page loads of "/" are served anonymously; every button is a POST
  // (server action), which falls through to the login prompt below. The anonymous viewer is marked "viewer (read-only)", and
  // the actions themselves refuse that identity as a second line of defence. ?as=founder selects the results-only view
  // (cookie-remembered; it can only reduce access). Machine endpoints keep their bearer secrets. Unset the switch to lock
  // the designer screens behind the login again.
  //
  // PUBLIC EDIT (env PUBLIC_EDIT=true): the same, but the buttons work too — NO login anywhere on the dashboard. Anyone with
  // the link can read everything AND change it (qualify, reject, assign, book, mark won, send emails when enabled). Only the
  // dashboard page "/" is opened this way; every other path still needs its credentials, and the machine endpoints
  // (/api/ingest, /api/cron) always keep their bearer secrets. Unset PUBLIC_EDIT to restore the read-only/locked behaviour.
  const publicEdit = process.env.PUBLIC_EDIT === 'true';
  const publicRead = process.env.PUBLIC_VIEW === 'true' && (req.method === 'GET' || req.method === 'HEAD');
  if (!cred && pathname === '/' && !wantsLogin && (publicEdit || publicRead)) {
    const asParam = searchParams.get('as');
    const picked = asParam === 'founder' || asParam === 'designer' ? asParam : req.cookies.get('aangan_role')?.value === 'founder' ? 'founder' : 'designer';
    headers.set('x-aangan-role', picked);
    headers.set('x-aangan-user', picked === 'founder' ? 'public' : publicEdit ? 'open access' : 'viewer (read-only)');
    const res = NextResponse.next({ request: { headers } });
    if (asParam === 'founder' || asParam === 'designer') res.cookies.set('aangan_role', asParam, { path: '/', sameSite: 'lax' });
    return res;
  }

  if (!cred) {
    const isPageLoad = (req.method === 'GET' || req.method === 'HEAD') && pathname === '/';
    if (!isPageLoad || wantsLogin) return deny();
    headers.set('x-aangan-role', 'founder');
    headers.set('x-aangan-user', 'public');
    return NextResponse.next({ request: { headers } });
  }
  const dUser = process.env.DESIGNER_USER || 'designer';
  const fUser = process.env.FOUNDER_USER || 'nikhil';
  let role: 'designer' | 'founder' | null = null;
  if (designerPass && safeEqual(cred.user, dUser) && safeEqual(cred.pass, designerPass)) role = 'designer';
  else if (founderPass && safeEqual(cred.user, fUser) && safeEqual(cred.pass, founderPass)) role = 'founder';
  if (!role) return deny();

  // After a successful "?login=1" sign-in, drop the parameter so the address bar is clean.
  if (wantsLogin) {
    const clean = req.nextUrl.clone();
    clean.searchParams.delete('login');
    return NextResponse.redirect(clean);
  }

  headers.set('x-aangan-role', role);
  headers.set('x-aangan-user', cred.user);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
