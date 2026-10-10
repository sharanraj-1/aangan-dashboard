import { randomUUID } from 'node:crypto';
import { checkBearer } from '@/lib/auth';
import { GUARDRAILS } from '@/lib/config';
import { getStore } from '@/lib/store';
import { notifyEscalation } from '@/lib/workflow';
import type { EscalationRow } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Response-time sweep. Finds active enquiries nobody has responded to within SLA_BREACH_HOURS and raises a
 * `response_sla_breach` escalation (once per enquiry). Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`.
 * On Vercel Hobby, cron jobs run at most once a day; Pro allows e.g. every 30 minutes (edit vercel.json).
 */
export async function GET(req: Request) {
  if (!checkBearer(req, process.env.CRON_SECRET ?? process.env.INGEST_API_KEY)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const store = getStore();
  const now = new Date();
  const cutoff = new Date(now.getTime() - GUARDRAILS.slaBreachHours * 3_600_000);
  const overdue = await store.unrespondedBefore(cutoff);
  let raised = 0;

  for (const e of overdue) {
    const existing = await store.escalationsFor(e.id);
    if (existing.some((x) => x.trigger === 'response_sla_breach')) continue;
    const hours = Math.round((now.getTime() - new Date(e.received_at).getTime()) / 3_600_000);
    const esc: EscalationRow = {
      id: randomUUID(), enquiry_id: e.id, kind: 'service_recovery', trigger: 'response_sla_breach',
      severity: hours > 48 ? 'high' : 'medium', assigned_to: hours > 48 || e.sentiment === 'frustrated' ? 'senior_designer' : 'front_desk',
      status: 'open', reason: `No response for ${hours}h and counting. Leads answered after 48h rarely convert.`,
      detail: { wait_hours: hours, responded: false, after_hours: e.after_hours }, suggested_question: null, notified_via: [],
      created_at: now.toISOString(), acknowledged_at: null, resolved_at: null, resolved_by: null, resolution: null, resolution_note: null,
    };
    await store.insert('escalations', esc);
    const via = await notifyEscalation(esc, e);
    if (via.length) await store.update('escalations', esc.id, { notified_via: via });
    raised++;
  }
  return Response.json({ checked: overdue.length, raised });
}
