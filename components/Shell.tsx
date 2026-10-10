import Link from 'next/link';
import type { ReactNode } from 'react';
import { monthLabel, shortMonth } from '@/lib/metrics';
import { href } from '@/lib/url';
import { LiveRefresh } from './LiveRefresh';
import { Flash } from './ui';
import type { View, ViewCtx } from './types';

// Five tabs for designers; the money details ("pricing") hang off the Results page rather than being a tab of their own.
const TABS: Record<'designer' | 'founder', { view: View; label: string }[]> = {
  designer: [
    { view: 'queue', label: 'Inbox' },
    { view: 'calls', label: 'Calls' },
    { view: 'escalations', label: 'Needs attention' },
    { view: 'calendar', label: 'Calendar' },
    { view: 'overview', label: 'Results' },
  ],
  founder: [{ view: 'overview', label: 'Results' }],
};

export const allowedViews = (role: 'designer' | 'founder'): View[] =>
  role === 'designer' ? ['queue', 'calls', 'escalations', 'calendar', 'overview', 'pricing'] : ['overview', 'pricing'];

export function Shell({ ctx, view, openEscalations, children }: { ctx: ViewCtx; view: View; openEscalations: number; children: ReactNode }) {
  const { role, sp, month, months, ds, includeSynthetic } = ctx;
  const synthetic = ds.enquiries.some((e) => e.is_synthetic);
  const publicEdit = process.env.PUBLIC_EDIT === 'true';
  const publicView = publicEdit || process.env.PUBLIC_VIEW === 'true';
  const tabs = TABS[role];
  const activeTab = view === 'pricing' ? 'overview' : view;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Link href={href(sp, { view: null, enquiry: null, week: null })} className="flex items-baseline gap-2">
            <span className="font-display text-xl font-semibold tracking-tight">Aangan</span>
            <span className="hidden text-sm text-mute sm:inline">Enquiry desk</span>
          </Link>

          {tabs.length > 1 && (
            <nav aria-label="Views" className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto sm:flex-1">
              {tabs.map((t) => {
                const active = t.view === activeTab;
                return (
                  <Link
                    key={t.view}
                    href={href(sp, { view: t.view, enquiry: null, week: null })}
                    aria-current={active ? 'page' : undefined}
                    className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${active ? 'bg-text text-canvas' : 'text-mute hover:bg-subtle hover:text-text'}`}
                  >
                    {t.label}
                    {t.view === 'escalations' && openEscalations > 0 && (
                      <span className={`rounded-full px-1.5 text-xs tabular-nums ${active ? 'bg-canvas text-text' : 'bg-accent text-white'}`}>{openEscalations}</span>
                    )}
                  </Link>
                );
              })}
            </nav>
          )}
          {tabs.length === 1 && <div className="flex-1" />}

          <div className="ml-auto flex items-center gap-2">
            {/* Month picker */}
            <details className="relative">
              <summary className="btn-ghost cursor-pointer select-none" aria-label="Choose month">{shortMonth(month)} <span aria-hidden className="text-faint">⌄</span></summary>
              <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-line bg-surface p-2 shadow-lift">
                {months.slice(0, 6).map((mo) => (
                  <Link key={mo} href={href(sp, { month: mo, enquiry: null })} aria-current={mo === month ? 'true' : undefined}
                    className={`block rounded-xl px-3 py-2 text-sm ${mo === month ? 'bg-subtle font-medium' : 'hover:bg-subtle'}`}>
                    {monthLabel(mo)}
                  </Link>
                ))}
                {synthetic && (
                  <Link href={href(sp, { syn: includeSynthetic ? '0' : '1' })} className="mt-1 block rounded-xl border-t border-line px-3 py-2 text-sm text-mute hover:bg-subtle">
                    {includeSynthetic ? 'Hide' : 'Show'} sample data
                  </Link>
                )}
              </div>
            </details>

            {/* Switch between the two views when the site is open to everyone */}
            {role === 'founder' && publicView && <Link href="/?as=designer" className="btn-ghost">Team view</Link>}
            {role === 'founder' && !publicView && <Link href="/?login=1" className="btn-ghost">Team sign-in</Link>}
            {role === 'designer' && publicView && !ctx.readOnly && <Link href="/?as=founder" className="btn-ghost">Results only</Link>}
            {ctx.readOnly && (
              <>
                <Link href="/?as=founder" className="btn-ghost">Results only</Link>
                <Link href={href(sp, { login: '1' })} className="btn-solid">Sign in to edit</Link>
              </>
            )}
            <LiveRefresh seconds={30} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6">
        {ds.demo && (
          <p className="mb-5 rounded-xl bg-warn-soft px-4 py-2.5 text-sm text-warn">
            <span className="font-medium">Demo mode.</span> <span className="text-text">Showing the 40 real September enquiries held in memory; changes reset on restart.</span>
          </p>
        )}
        {ctx.readOnly && (
          <p className="mb-5 rounded-xl bg-warn-soft px-4 py-2.5 text-sm text-warn">
            <span className="font-medium">View only.</span> <span className="text-text">You can read everything; the buttons need the team login.</span>
          </p>
        )}
        <Flash msg={sp.msg} ok={sp.ok} />
        {children}
      </main>
    </div>
  );
}
