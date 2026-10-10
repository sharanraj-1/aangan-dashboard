import { after } from 'next/server';
import { Shell, allowedViews } from '@/components/Shell';
import type { View, ViewCtx } from '@/components/types';
import { Calendar } from '@/components/views/Calendar';
import { Calls } from '@/components/views/Calls';
import { Escalations } from '@/components/views/Escalations';
import { Overview } from '@/components/views/Overview';
import { PricingEconomics } from '@/components/views/PricingEconomics';
import { Queue } from '@/components/views/Queue';
import { getRole, isReadOnlyViewer } from '@/lib/auth';
import { availableMonths, computeMetrics, monthKey } from '@/lib/metrics';
import { getStore } from '@/lib/store';
import { href, type SP } from '@/lib/url';
import { backgroundSync, shouldRunOnLoad } from '@/lib/voice/sync';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const sp: SP = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));

  const role = await getRole();
  // Vaani calls are pulled by the scheduled job; this also pulls a few new ones (at most every 2 min per instance) while a
  // designer has the dashboard open, so calls show up within about a minute. De-duplicated, so it can never double-ingest.
  if (role === 'designer' && shouldRunOnLoad()) after(backgroundSync);
  const ds = await getStore().load(role); // founder dataset is already stripped of personal data in the store layer
  const now = new Date();
  const months = availableMonths(ds);
  const month = sp.month && months.includes(sp.month) ? sp.month : months[0] ?? monthKey(now);
  const includeSynthetic = sp.syn !== '0';
  const m = computeMetrics(ds, month, { includeSynthetic, now });

  const allowed = allowedViews(role);
  const view: View = allowed.includes(sp.view as View) ? (sp.view as View) : allowed[0];
  const ctx: ViewCtx = { ds, m, month, months, now, role, includeSynthetic, sp, returnTo: href(sp, {}), readOnly: await isReadOnlyViewer() };
  const openEscalations = ds.escalations.filter((e) => e.status !== 'resolved').length;

  return (
    <Shell ctx={ctx} view={view} openEscalations={role === 'designer' ? openEscalations : 0}>
      {view === 'overview' && <Overview ctx={ctx} />}
      {view === 'pricing' && <PricingEconomics ctx={ctx} />}
      {role === 'designer' && view === 'queue' && <Queue ctx={ctx} />}
      {role === 'designer' && view === 'calls' && <Calls ctx={ctx} />}
      {role === 'designer' && view === 'escalations' && <Escalations ctx={ctx} />}
      {role === 'designer' && view === 'calendar' && <Calendar ctx={ctx} />}
    </Shell>
  );
}
