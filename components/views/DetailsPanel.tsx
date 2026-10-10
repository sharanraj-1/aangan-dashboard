// Details tab: everything technical, each piece closed until asked for.

import { Collapsible } from '@/components/ui';
import { formatDateTime, formatDuration } from '@/lib/format';
import { PricingPanel } from './BriefPanel';
import { KV, type InspectorData } from './inspector-kit';
import { EscalationsDetail, FitExplanations, OverrideCard } from './RubricPanel';
import { ConfidenceDetails } from './TranscriptPane';

function crm(e: InspectorData['e']): { tone: 'ok' | 'crit' | 'neutral'; text: string } {
  if (e.hubspot_error) return { tone: 'crit', text: `Sync failed: ${e.hubspot_error}` };
  if (e.hubspot_synced_at) return { tone: 'ok', text: `Synced to the CRM on ${formatDateTime(e.hubspot_synced_at)}${e.hubspot_deal_id ? ` (deal ${e.hubspot_deal_id})` : ''}.` };
  return { tone: 'neutral', text: 'Not synced to the CRM yet. This happens automatically once the CRM is connected.' };
}

export function DetailsTab({ d }: { d: InspectorData }) {
  const { e } = d;
  const hs = crm(e);
  const answered = e.first_response_at ? (new Date(e.first_response_at).getTime() - new Date(e.received_at).getTime()) / 60_000 : null;
  return (
    <div className="space-y-3">
      <PricingPanel d={d} />
      <FitExplanations d={d} />
      <EscalationsDetail d={d} />
      <OverrideCard d={d} />
      <ConfidenceDetails d={d} />
      <Collapsible title="CRM sync" hint={hs.tone === 'ok' ? 'synced' : hs.tone === 'crit' ? 'failed' : 'not synced'}>
        <p className={`text-[15px] ${hs.tone === 'crit' ? 'text-crit' : ''}`}>{hs.text}</p>
      </Collapsible>
      <Collapsible title="Timeline">
        <dl>
          <KV k="Received">{formatDateTime(e.received_at)}</KV>
          <KV k="First reply">{e.first_response_at ? `${formatDateTime(e.first_response_at)}${answered !== null ? ` (${formatDuration(Math.max(0, answered))} later)` : ''}` : 'Not recorded'}</KV>
          <KV k="Brief sent">{e.handoff_sent_at ? formatDateTime(e.handoff_sent_at) : 'Not yet'}</KV>
          <KV k="Designer accepted">{e.handoff_accepted_at ? formatDateTime(e.handoff_accepted_at) : 'Not yet'}</KV>
        </dl>
      </Collapsible>
    </div>
  );
}
