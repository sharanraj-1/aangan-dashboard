// The enquiry detail: loads everything for one enquiry once, then shows a header, the one thing to do next, and four tabs.
// Designer-only. Per-person data lives here, so it refuses to render for any other role.

import Link from 'next/link';
import { Empty } from '@/components/ui';
import type { ViewCtx } from '@/components/types';
import { getStore } from '@/lib/store';
import type { EnquiryRow } from '@/lib/types';
import { BriefPanel } from './BriefPanel';
import { ClientEmailPanel } from './ClientEmailPanel';
import { ConsultationPanel } from './ConsultationPanel';
import { DetailsTab } from './DetailsPanel';
import { InspectorBar, NextActionCard } from './InspectorHeader';
import { TABS, tabFromParam, tabHref, type InspectorData } from './inspector-kit';
import { OutcomePanel, RepliedCard } from './OutcomePanel';
import { OverviewPanel } from './RubricPanel';
import { ConversationTab } from './TranscriptPane';

export async function Inspector({ ctx, e }: { ctx: ViewCtx; e: EnquiryRow }) {
  if (ctx.role !== 'designer') return <Empty>Enquiry detail is for designers only.</Empty>;
  const store = getStore();
  const [tr, escs, pricing, designers] = await Promise.all([
    store.transcriptFor(e.id), store.escalationsFor(e.id), store.getPricing(e.id), store.listDesigners(),
  ]);
  const d: InspectorData = { ctx, e, tr, escs, pricing, designers };
  const tab = tabFromParam(ctx.sp.tab);

  return (
    <div className="space-y-6 pb-8">
      <InspectorBar d={d} />
      <NextActionCard d={d} />

      <nav aria-label="Enquiry sections" className="scroll-thin flex gap-1 overflow-x-auto rounded-full bg-subtle p-1">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={tabHref(ctx.sp, t.key, undefined, { tx: null })}
            aria-current={t.key === tab ? 'page' : undefined}
            className={`flex-1 whitespace-nowrap rounded-full px-4 py-1.5 text-center text-sm font-medium transition-colors ${t.key === tab ? 'bg-surface text-text shadow-card' : 'text-mute hover:text-text'}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'overview' && <OverviewPanel d={d} />}
      {tab === 'conversation' && <ConversationTab d={d} />}
      {tab === 'followup' && (
        <div className="space-y-6">
          <BriefPanel d={d} />
          <ConsultationPanel d={d} />
          <ClientEmailPanel d={d} />
          <RepliedCard d={d} />
          <OutcomePanel d={d} />
        </div>
      )}
      {tab === 'details' && <DetailsTab d={d} />}
    </div>
  );
}
