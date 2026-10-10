// Calls: every phone enquiry in one place — answered by the voice agent, missed, or dropped — with a "Sync now" button.
// Designer-only (callers' numbers live here). Opening a call lands on its Conversation tab inside the Inbox.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { syncCallsAction } from '@/app/actions';
import type { ViewCtx } from '@/components/types';
import { Badge, Empty, Kpi, PageHeader, ReturnTo, qualLabel, qualTone } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { effectiveQualification, monthKey, monthLabel } from '@/lib/metrics';
import type { EnquiryRow } from '@/lib/types';
import { href } from '@/lib/url';
import { lastSync, voiceSyncConfigured } from '@/lib/voice/sync';
import { relativeTime } from './inspector-kit';

const MAX_ROWS = 12;

type CallFilter = 'all' | 'answered' | 'callback';
const FILTERS: { key: CallFilter; label: string }[] = [
  { key: 'all', label: 'All calls' },
  { key: 'answered', label: 'Answered' },
  { key: 'callback', label: 'Missed or dropped' },
];

const isCallback = (e: EnquiryRow) => e.call_outcome === 'missed' || e.call_outcome === 'dropped';
const fromVoiceAgent = (e: EnquiryRow) => (e.source_ref ?? '').startsWith('vaani:');

function lengthLabel(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec <= 0) return '—';
  if (sec < 60) return `${Math.round(sec)} sec`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s === 0 ? `${m} min` : `${m} min ${s} sec`;
}

function Pill({ href: to, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={to}
      aria-current={active ? 'true' : undefined}
      className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${active ? 'border-accent bg-accent text-white' : 'border-line-strong bg-surface text-mute hover:bg-subtle hover:text-text'}`}
    >
      {children}
    </Link>
  );
}

export function Calls({ ctx }: { ctx: ViewCtx }) {
  const { sp } = ctx;
  const connected = voiceSyncConfigured();

  const calls = ctx.ds.enquiries
    .filter((e) => e.channel === 'phone' && monthKey(e.received_at) === ctx.month && (ctx.includeSynthetic || !e.is_synthetic))
    .sort((a, b) => b.received_at.localeCompare(a.received_at));

  const answered = calls.filter((e) => e.call_outcome === 'answered' || e.call_outcome === null);
  const callbacks = calls.filter(isCallback);
  const callbacksOpen = callbacks.filter((e) => !e.first_response_at);
  const timed = calls.map((e) => e.call_duration_seconds).filter((n): n is number => typeof n === 'number' && n > 0);
  const avgSec = timed.length > 0 ? timed.reduce((a, b) => a + b, 0) / timed.length : null;

  const f: CallFilter = FILTERS.some((c) => c.key === sp.f) ? (sp.f as CallFilter) : 'all';
  const rows = f === 'answered' ? answered : f === 'callback' ? callbacks : calls;
  const counts: Record<CallFilter, number> = { all: calls.length, answered: answered.length, callback: callbacks.length };
  const showAll = sp.all === '1';
  const shown = showAll ? rows : rows.slice(0, MAX_ROWS);
  const to = (patch: Record<string, string | null>) => href(sp, { view: 'calls', enquiry: null, ...patch });
  const open = (id: string) => href(sp, { view: 'queue', enquiry: id, tab: 'conversation', tx: null, f: null, all: null });

  const lastErrors = lastSync ? Object.values(lastSync.summary).flatMap((r) => r.errors) : [];
  const failing = connected && lastErrors.length > 0;
  const latest = ctx.ds.enquiries.filter((e) => e.channel === 'phone' && fromVoiceAgent(e)).sort((a, b) => b.received_at.localeCompare(a.received_at))[0];

  return (
    <div>
      <PageHeader
        title="Calls"
        subtitle={calls.length === 0
          ? `No calls in ${monthLabel(ctx.month)} yet.`
          : `${calls.length} call${calls.length === 1 ? '' : 's'} in ${monthLabel(ctx.month)} — ${callbacksOpen.length === 0 ? 'no one is waiting for a callback.' : `${callbacksOpen.length} waiting for a callback.`}`}
      />

      {/* Voice agent status + manual sync */}
      <section className="panel mb-6 flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Voice agent</span>
            <Badge tone={failing || !connected ? 'warn' : 'ok'}>{!connected ? 'Not connected' : failing ? 'Needs setup' : 'Connected'}</Badge>
          </div>
          <p className="mt-1 text-sm text-mute">
            {connected
              ? 'New calls are pulled in automatically about once a minute while this page is open, and once a day in the background.'
              : 'Add the voice agent key to start pulling in calls. Until then, only calls added by hand or from the sample data appear here.'}
          </p>
          {failing && (
            <p className="mt-1 text-sm text-warn">The last check failed — the voice service said: “{lastErrors[0].slice(0, 140)}”. This usually means the voice account is not fully set up yet (for example, no phone number).</p>
          )}
          <p className="mt-1 text-sm text-mute">
            {lastSync ? `Last checked ${relativeTime(lastSync.at.toISOString(), ctx.now)}.` : 'Not checked since this server last started.'}
            {latest ? ` Latest call from the agent: ${formatDateTime(latest.received_at)}.` : connected ? ' No calls from the agent yet.' : ''}
          </p>
        </div>
        {connected && !ctx.readOnly && (
          <form action={syncCallsAction}>
            <ReturnTo value={ctx.returnTo} />
            <button type="submit" className="btn-solid">Sync calls now</button>
          </form>
        )}
      </section>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Calls" value={calls.length} sub={`in ${monthLabel(ctx.month)}`} />
        <Kpi label="Answered" value={answered.length} sub="picked up" tone={answered.length > 0 ? 'ok' : 'neutral'} />
        <Kpi label="Need a callback" value={callbacksOpen.length} sub={`${callbacks.length} missed or dropped in all`} tone={callbacksOpen.length > 0 ? 'warn' : 'neutral'} hot={callbacksOpen.length > 0} />
        <Kpi label="Average length" value={avgSec === null ? '—' : (avgSec / 60).toFixed(1)} unit={avgSec === null ? undefined : 'min'} sub={timed.length > 0 ? `across ${timed.length} timed call${timed.length === 1 ? '' : 's'}` : 'no timings recorded'} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter calls">
        {FILTERS.map((c) => (
          <Pill key={c.key} href={to({ f: c.key, all: null })} active={f === c.key}>
            {c.label}
            <span className={`text-[13px] tabular-nums ${f === c.key ? 'text-white/85' : 'text-faint'}`}>{counts[c.key]}</span>
          </Pill>
        ))}
      </div>

      {shown.length === 0 ? (
        <Empty>{calls.length === 0 ? 'No calls this month.' : f === 'callback' ? 'No missed or dropped calls — nice.' : 'No calls in this view.'}</Empty>
      ) : (
        <ul className="space-y-2">
          {shown.map((e) => {
            const cb = isCallback(e);
            const q = effectiveQualification(e);
            const who = e.client_name ?? e.client_phone ?? 'Unknown caller';
            const meta = [
              e.client_name ? e.client_phone : null,
              e.location,
              formatDateTime(e.received_at),
              cb ? null : lengthLabel(e.call_duration_seconds),
            ].filter((x) => x && x !== '—').join(' · ');
            return (
              <li key={e.id}>
                <Link
                  href={open(e.id)}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 transition-colors hover:border-line-strong hover:shadow-card"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{who}</div>
                    <div className="truncate text-sm text-mute">{meta}</div>
                    {e.summary && !cb && <div className="mt-0.5 line-clamp-1 text-sm text-mute">{e.summary}</div>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                    {fromVoiceAgent(e) && <Badge tone="info">Voice agent</Badge>}
                    {cb ? (
                      <Badge tone={e.first_response_at ? 'neutral' : 'warn'}>
                        {e.call_outcome === 'missed' ? 'Missed' : 'Dropped'}{e.first_response_at ? ' · called back' : ' · call back'}
                      </Badge>
                    ) : (
                      <Badge tone={qualTone(q)}>{qualLabel(q)}</Badge>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {rows.length > MAX_ROWS && (
        <p className="mt-4 text-center text-sm text-mute">
          {showAll ? (
            <Link href={to({ all: null })} className="font-medium text-accent hover:underline">Show fewer</Link>
          ) : (
            <>Showing {MAX_ROWS} of {rows.length}. <Link href={to({ all: '1' })} className="font-medium text-accent hover:underline">Show more</Link></>
          )}
        </p>
      )}
    </div>
  );
}
