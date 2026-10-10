// Conversation tab: the transcript typeset like a chat, how sure the AI is, and the technical extraction details.
// (Details tab reuses ConfidenceDetails.)

import Link from 'next/link';
import { Badge, Bar, Collapsible, ConfidenceMeter, Empty, Panel } from '@/components/ui';
import { GUARDRAILS } from '@/lib/config';
import { pct, titleCase } from '@/lib/format';
import { findAgentPriceDisclosures } from '@/lib/pricing';
import { href } from '@/lib/url';
import { KV, Notice, type InspectorData } from './inspector-kit';

// "Front Desk: …", "Caller: …", "4 Sept, 11:47am — Front Desk: …", form rows like "How did you find us: …".
const LINE = /^((?:\d{1,2}\s+\w+,?\s+[\d:]+\s*[apAP][mM]\s*[—-]\s*)?)([A-Z][^:\n—]{0,31}):\s?(.*)$/;
const STUDIO_LABEL = /^(front desk|agent|assistant|ai agent|vaani|vani|aangan|aangan studio|studio)\b/i;
const MARKER = /(\[inaudible\]|\[uncertain[^\]]*\])/gi;

interface ParsedLine { stamp: string; label: string | null; body: string; studio: boolean }

function parseLine(line: string): ParsedLine {
  const m = LINE.exec(line);
  if (!m || /^https?/i.test(m[2].trim())) return { stamp: '', label: null, body: line, studio: false };
  const label = m[2].trim();
  return { stamp: m[1].trim(), label, body: m[3], studio: STUDIO_LABEL.test(label) };
}

function Marked({ text }: { text: string }) {
  const parts = text.split(MARKER);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-warn-soft px-1 font-medium text-warn" title="The AI could not make this out">{p}</mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function Typeset({ text, offenders, label }: { text: string; offenders: Set<string>; label: string }) {
  const lines = text.split(/\r?\n/);
  return (
    <div className="scroll-thin max-h-[520px] space-y-2 overflow-y-auto pr-1" tabIndex={0} role="region" aria-label={label}>
      {lines.map((raw, i) => {
        if (!raw.trim()) return null;
        const p = parseLine(raw);
        const quoted = p.studio && offenders.has(raw.trim().slice(0, 240));
        const tone = quoted ? 'bg-crit-soft' : p.studio ? 'bg-subtle' : p.label ? 'bg-info-soft/60' : '';
        return (
          <div key={i} className={`rounded-xl px-3.5 py-2.5 text-[15px] leading-relaxed ${tone}`}>
            {p.label && (
              <div className="mb-0.5 flex flex-wrap items-baseline gap-x-2">
                <strong className={`text-[13px] font-semibold ${p.studio ? 'text-accent' : 'text-info'}`}>{p.label}</strong>
                {p.stamp && <span className="text-[13px] text-mute">{p.stamp}</span>}
              </div>
            )}
            <div><Marked text={p.body} /></div>
            {quoted && <div className="mt-1"><Badge tone="crit">Quoted a price</Badge></div>}
          </div>
        );
      })}
    </div>
  );
}

function scalar(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') : '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const SKIP_ENTITY_KEYS = new Set(['field_confidence', 'criteria', 'criteria_notes']);

function fieldConfidence(d: InspectorData): Record<string, number> {
  const { tr } = d;
  return tr?.field_confidence && Object.keys(tr.field_confidence).length ? tr.field_confidence : tr?.extraction?.field_confidence ?? {};
}

/** The plain-language "how sure the AI is" line. */
function HowSure({ d }: { d: InspectorData }) {
  const { e, tr } = d;
  const thr = GUARDRAILS.confidenceMin;
  const v = e.composite_confidence;
  const flags = [...new Set([...(tr?.ambiguity_flags ?? []), ...(tr?.extraction?.ambiguity_flags ?? [])])];
  return (
    <Panel title="How sure the AI is">
      {v === null ? (
        <p className="text-sm text-mute">Nothing was scored, because there was no conversation to read.</p>
      ) : (
        <div className="space-y-2">
          <ConfidenceMeter value={v} threshold={thr} />
          <p className="text-[15px]">
            {v >= thr
              ? `The AI is fairly sure it understood this conversation (${pct(v)}), so it can go straight to a designer.`
              : `The AI is not fully sure it understood this conversation (${pct(v)}), so a person should check it first.`}
          </p>
        </div>
      )}
      {flags.length > 0 && (
        <div className="mt-4">
          <div className="label mb-1.5">Things that were unclear</div>
          <div className="flex flex-wrap gap-1.5">
            {flags.map((f) => <Badge key={f} tone="warn">{f}</Badge>)}
          </div>
        </div>
      )}
    </Panel>
  );
}

export function ConversationTab({ d }: { d: InspectorData }) {
  const { ctx, e, tr, escs } = d;
  const hasText = Boolean(tr && tr.raw_text.trim());

  if (!tr || !hasText) {
    const missed = e.call_outcome === 'missed' || e.call_outcome === 'dropped';
    return (
      <div className="space-y-6">
        <Empty>
          <strong className="text-text">No conversation to show.</strong>{' '}
          {missed
            ? `This was a ${e.call_outcome} call, so there is no recording or transcript. Call them back, then mark the enquiry as replied.`
            : 'No transcript was saved for this enquiry.'}
        </Empty>
        <HowSure d={d} />
      </div>
    );
  }

  const breach = escs.some((x) => x.trigger === 'agent_policy_breach');
  const offenders = new Set(breach ? [...findAgentPriceDisclosures(tr.raw_text), ...findAgentPriceDisclosures(tr.processed_text ?? '')] : []);
  const hasProcessed = Boolean(tr.processed_text && tr.processed_text.trim());
  const clean = hasProcessed && ctx.sp.tx === 'clean';
  const dur = tr.duration_seconds ?? e.call_duration_seconds;
  const entities = tr.extraction ? Object.entries(tr.extraction).filter(([k]) => !SKIP_ENTITY_KEYS.has(k)) : [];
  const conf = fieldConfidence(d);
  const thr = GUARDRAILS.confidenceMin;
  const source = tr.source === 'audio' ? 'Phone call' : tr.source === 'form' ? 'Web form' : 'Chat';

  return (
    <div className="space-y-6">
      {breach && (
        <Notice tone="crit">
          <strong>Heads up:</strong> the studio side may have quoted a price.{' '}
          {offenders.size > 0 ? `${offenders.size === 1 ? 'The line is' : 'The lines are'} marked below.` : 'No single line matched, so read the studio lines.'}
        </Notice>
      )}

      <Panel
        title={clean ? 'Conversation (cleaned up)' : 'Conversation'}
        right={
          <div className="flex items-center gap-3">
            <Badge>{source}</Badge>
            {hasProcessed && (
              <Link href={href(ctx.sp, { tx: clean ? null : 'clean' })} className="text-sm font-medium text-accent hover:underline">
                {clean ? 'Show the original' : 'Show the cleaned-up version'}
              </Link>
            )}
          </div>
        }
      >
        <Typeset
          text={clean ? (tr.processed_text as string) : tr.raw_text}
          offenders={offenders}
          label={clean ? 'Cleaned-up conversation' : 'Conversation'}
        />
      </Panel>

      <HowSure d={d} />

      <Collapsible title="Extracted data and confidence" hint={entities.length > 0 ? `${entities.length} fields` : undefined}>
        <dl className="mb-4 grid gap-x-8 sm:grid-cols-2">
          <KV k="Language">{tr.language ?? '—'}</KV>
          <KV k="Length">{dur ? `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')} min` : '—'}</KV>
          <KV k="Model">{tr.model ?? '—'}</KV>
          <KV k="Tokens in / out">{tr.input_tokens !== null || tr.output_tokens !== null ? `${tr.input_tokens ?? 0} / ${tr.output_tokens ?? 0}` : '—'}</KV>
          <KV k="AI cost">{`₹${tr.ai_cost_inr.toFixed(2)}`}</KV>
          <KV k="Recording">{tr.audio_url ? 'Audio on file' : 'Text only'}</KV>
        </dl>
        {entities.length === 0 ? (
          <p className="text-sm text-mute">Nothing was extracted from this conversation.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse">
              <thead>
                <tr>
                  <th scope="col" className="th">Field</th>
                  <th scope="col" className="th">What the AI found</th>
                  <th scope="col" className="th text-right">How sure</th>
                </tr>
              </thead>
              <tbody>
                {entities.map(([k, v]) => {
                  const c = conf[k];
                  return (
                    <tr key={k}>
                      <th scope="row" className="td whitespace-nowrap text-left font-normal text-mute">{titleCase(k)}</th>
                      <td className="td break-words">{scalar(v)}</td>
                      <td className={`td text-right tabular-nums ${c === undefined ? 'text-faint' : c < thr ? 'font-medium text-crit' : 'text-ok'}`}>{c === undefined ? '—' : pct(c)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Collapsible>
    </div>
  );
}

/** Gate explanation + per-field confidence bars (used in the Details tab). */
export function ConfidenceDetails({ d }: { d: InspectorData }) {
  const { e, tr, escs } = d;
  const thr = GUARDRAILS.confidenceMin;
  const fields = Object.entries(fieldConfidence(d)).sort((a, b) => a[1] - b[1]);
  const trEsc = escs.filter((x) => x.kind === 'transcription');
  const held = (e.composite_confidence !== null && e.composite_confidence < thr) || trEsc.length > 0;
  const noData = e.composite_confidence === null && e.transcription_confidence === null;
  const inaudible = tr?.extraction?.inaudible_count ?? null;

  return (
    <Collapsible title="How sure the AI is, field by field" hint={noData ? 'no scores' : held ? 'held for a check' : 'passed'}>
      {noData ? (
        <p className="text-sm text-mute">Nothing was scored, because nothing was transcribed (for example a missed call).</p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="label mb-1">Overall</div>
              <ConfidenceMeter value={e.composite_confidence} threshold={thr} />
              <p className="mt-1 text-[13px] text-mute">Blends how well the speech was heard with how clearly the scope and place came through.</p>
            </div>
            <div>
              <div className="label mb-1">Speech heard correctly</div>
              <ConfidenceMeter value={e.transcription_confidence ?? tr?.transcription_confidence ?? null} threshold={thr} />
              <p className="mt-1 text-[13px] text-mute">
                {inaudible !== null ? `${inaudible} spot${inaudible === 1 ? '' : 's'} could not be made out.` : 'No extraction was stored.'}
              </p>
            </div>
          </div>
          <p className="text-sm text-mute">
            Anything below {pct(thr)} is held for a person instead of going to a designer. {held ? 'This one is being held.' : 'This one cleared it.'}
          </p>
          {fields.length > 0 && (
            <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {fields.map(([k, v]) => (
                <li key={k} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2">
                  <span className="truncate text-sm text-mute" title={k}>{titleCase(k)}</span>
                  <Bar value={v} max={1} tone={v >= thr ? 'ok' : 'crit'} label={`${titleCase(k)} ${pct(v)}`} />
                  <span className={`text-right text-[13px] tabular-nums ${v >= thr ? 'text-ok' : 'text-crit'}`}>{pct(v)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Collapsible>
  );
}
