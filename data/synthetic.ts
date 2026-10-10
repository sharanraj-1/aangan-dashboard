// OPTIONAL simulated enquiries (flagged is_synthetic) to take a month up to ~200 and to give every dashboard metric
// something to show: resolved escalations, handoffs, consultations, won/lost outcomes. NOT real data.
// Rates below are deliberately illustrative (e.g. faster replies convert better) — they exist to exercise the UI, and
// must never be read as Aangan's actual conversion figures. The dashboard labels these rows SYNTHETIC and can hide them.

import { randomUUID } from 'node:crypto';
import { blankExtraction, crit } from '../lib/extraction';
import { buildRecords } from '../lib/records';
import type {
  ConsultationRow, DesignerRow, EnquiryRow, EscalationRow, Extraction, PricingLogRow, TranscriptRow,
} from '../lib/types';

// ---- tiny deterministic RNG -------------------------------------------------------------------
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T,>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    chance: (p: number) => next() < p,
    weighted: <T,>(items: readonly (readonly [T, number])[]): T => {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [v, w] of items) if ((r -= w) <= 0) return v;
      return items[items.length - 1][0];
    },
  };
}

const FIRST = ['Aditi', 'Rahul', 'Neha', 'Siddharth', 'Kavya', 'Amit', 'Pooja', 'Rohan', 'Sneha', 'Vikram', 'Anjali', 'Karan', 'Meera', 'Nikhil', 'Isha', 'Manish', 'Divya', 'Sanjay', 'Tanvi', 'Yash', 'Ritu', 'Harsh', 'Shweta', 'Omkar', 'Prachi', 'Aniket', 'Gauri', 'Pranav'];
const LAST = ['Kulkarni', 'Joshi', 'Patil', 'Deshmukh', 'Shah', 'Mehta', 'Iyer', 'Bhosale', 'Gokhale', 'Naik', 'Sharma', 'Kapoor', 'Pawar', 'Ranade', 'Menon', 'Jadhav', 'Agarwal', 'Chavan'];
const SERVED = ['Baner', 'Aundh', 'Kothrud', 'Wakad', 'Hinjewadi', 'Viman Nagar', 'Koregaon Park', 'Kalyani Nagar', 'Kharadi', 'Hadapsar', 'Magarpatta', 'NIBM Road', 'Pimple Saudagar', 'Ravet', 'Warje', 'Bavdhan', 'Balewadi', 'Undri', 'Kondhwa', 'Chinchwad'];
const UNSERVED = ['Nashik', 'Mumbai', 'Talegaon', 'Lonavala', 'Kolhapur', 'Nagpur'];
const STYLES = ['warm minimal', 'contemporary', 'earthy', 'modern classic', 'scandinavian', 'industrial'];
const FD = 'Front Desk';

type Scenario =
  | 'full_home' | 'partial' | 'office' | 'clarify' | 'out_of_area' | 'advice_only' | 'timeline_fail' | 'budget_low'
  | 'hospitality' | 'junk' | 'noisy' | 'custom' | 'pricing_only' | 'complaint' | 'missed' | 'price_breach';

const SCENARIOS: readonly (readonly [Scenario, number])[] = [
  ['full_home', 30], ['partial', 8], ['office', 9], ['clarify', 10], ['out_of_area', 5], ['advice_only', 4], ['timeline_fail', 4],
  ['budget_low', 3], ['hospitality', 2], ['junk', 4], ['noisy', 6], ['custom', 3], ['pricing_only', 3], ['complaint', 1], ['missed', 5], ['price_breach', 1],
];

interface Gen {
  extraction: Extraction;
  raw: string;
  processed?: string;
  scenario: Scenario;
}

function gen(r: ReturnType<typeof rng>, scenario: Scenario, channel: 'phone' | 'whatsapp' | 'web_form'): Gen {
  const name = `${r.pick(FIRST)} ${r.pick(LAST)}`;
  const first = name.split(' ')[0];
  const loc = r.pick(SERVED);
  const area = r.int(7, 24) * 100;
  const weeks = r.int(10, 30);
  const bhk = area < 900 ? '2BHK' : area < 1500 ? '3BHK' : '4BHK';
  const x = blankExtraction({
    client_name: r.chance(0.8) ? name : null, client_phone: '+91 98XXX XXXXX', project_type: 'residential', scope_type: 'full_home',
    scope_clarity: 'clear', location: `${loc}, Pune`, location_clarity: 'clear', in_service_area: true, area_sqft: area,
    timeline_text: `Done in about ${weeks} weeks`, weeks_to_completion: weeks, criteria: crit('PPPUU'), sentiment: 'positive',
    style_preferences: r.chance(0.35) ? [r.pick(STYLES)] : [], transcription_confidence: 0.9 + r.next() * 0.09,
    referral_source: r.chance(0.2) ? `${r.pick(FIRST)} ${r.pick(LAST)} (past client)` : null,
    scope_summary: `Full interiors for a ${bhk} (~${area} sq ft): kitchen, wardrobes, living room and bedrooms.`,
  });
  const say = (lines: string[]) => lines.join('\n');
  const callIntro = [`${FD}: Good ${r.pick(['morning', 'afternoon'])}, Aangan Studio.`];
  let raw = '';

  switch (scenario) {
    case 'full_home':
      x.summary = `${first} owns a ${bhk} in ${loc} (~${area} sq ft) and wants a full redesign, completed in about ${weeks} weeks.`;
      raw = say([...callIntro, `Caller: Hi, I’m ${first}. I have a ${bhk} in ${loc}, about ${area} sq ft carpet. We want to redo the whole home.`, `${FD}: Good scope. What’s your timeline?`, `Caller: Ideally done in about ${weeks} weeks.`, `${FD}: Are you the owner?`, `Caller: Yes, my spouse and I.`, `${FD}: Let me book a consultation.`]);
      break;
    case 'partial':
      x.scope_type = 'partial_home'; x.scope_summary = 'Master bedroom and living room redesign with execution.'; x.criteria = crit('PPPUP');
      x.summary = `${first} wants two rooms of a flat in ${loc} redesigned with execution; timeline about ${weeks} weeks.`;
      raw = say([...callIntro, `Caller: Hello, ${first} here. In ${loc}, I want the living room and master bedroom redesigned, ${area} sq ft flat.`, `${FD}: Full execution?`, `Caller: Yes, everything.`, `${FD}: Timeline?`, `Caller: About ${weeks} weeks.`]);
      break;
    case 'office': {
      const oa = r.int(6, 28) * 100;
      x.project_type = 'commercial'; x.scope_type = 'office'; x.area_sqft = oa; x.scope_summary = `Fitout of a ${oa} sq ft office: workstations, cabins, meeting room.`;
      x.summary = `${first} needs a ${oa} sq ft office in ${loc} fitted out in about ${weeks} weeks.`;
      raw = say([...callIntro, `Caller: Hi, I’m ${first}. We have ${oa} sq ft of bare shell office in ${loc}. Need workstations, cabins and a meeting room.`, `${FD}: Timeline?`, `Caller: About ${weeks} weeks.`, `${FD}: Decision-maker?`, `Caller: Yes.`]);
      break;
    }
    case 'clarify':
      x.timeline_text = null; x.weeks_to_completion = null; x.criteria = crit('PPUUU'); x.criteria_notes = { timeline: 'No timeline discussed.' };
      x.clarifying_question = 'When would you need the project complete?';
      x.summary = `${first} wants a ${bhk} in ${loc} redesigned; timeline never discussed.`;
      raw = say([...callIntro, `Caller: Hi, ${first}. ${bhk} in ${loc}, ${area} sq ft. Want the interiors done.`, `${FD}: Kitchen and rooms?`, `Caller: Yes, all of it.`, `${FD}: Shall I book a consultation?`, `Caller: Sure.`]);
      break;
    case 'out_of_area': {
      const city = r.pick(UNSERVED);
      x.location = city; x.in_service_area = false; x.criteria = crit('PFPUU'); x.criteria_notes = { service_area: `Site is in ${city} — outside Pune / PCMC.` };
      if (r.chance(0.18)) { x.budget_low_inr = 1_500_000; x.budget_high_inr = 2_000_000; x.area_sqft = 1500; }
      x.summary = `${first} wants a ${bhk} done in ${city}, outside Aangan’s service area.`;
      raw = say([...callIntro, `Caller: Hi, I have a ${bhk} in ${city}. Can you take it up?`, `${FD}: We only work in Pune and PCMC, I’m sorry.`, `Caller: Okay.`]);
      break;
    }
    case 'advice_only':
      x.intent = 'advice_only'; x.criteria = crit('FPUUU'); x.criteria_notes = { real_project: 'Wants ideas / advice only.' };
      x.summary = `${first} only wants colour and layout suggestions — not a design-and-execution project.`;
      raw = say([...callIntro, `Caller: Can someone give ideas for my ${r.pick(['living room', 'bedroom'])}? Just suggestions, no execution.`, `${FD}: We do design and execution together.`, `Caller: Then not now.`]);
      break;
    case 'timeline_fail': {
      const w = r.int(2, 5);
      x.weeks_to_completion = w; x.timeline_text = `Needs it in ${w} weeks`; x.criteria = crit('PPFUU'); x.sentiment = 'urgent'; x.scope_type = 'partial_home'; x.area_sqft = r.int(6, 11) * 100;
      x.summary = `${first} needs the work done in ${w} weeks — below Aangan’s minimum lead time.`;
      raw = say([...callIntro, `Caller: I need my living room and kitchen done in ${w} weeks, guests are coming.`, `${FD}: We can’t start execution in under six weeks.`, `Caller: Understood.`]);
      break;
    }
    case 'budget_low': {
      const b = r.int(1, 2) * 100_000;
      x.scope_type = 'partial_home'; x.area_sqft = r.int(5, 9) * 100; x.budget_low_inr = b; x.budget_high_inr = b + 50_000; x.budget_flexibility = 'rigid'; x.criteria = crit('PPUFU');
      x.summary = `${first} wants a kitchen and bedroom redone but volunteered a very small budget.`;
      raw = say([...callIntro, `Caller: Kitchen and one bedroom, ${loc}. My budget is ${b / 100_000} to ${(b + 50_000) / 100_000} lakh maximum.`, `${FD}: That is significantly below what that scope costs with us.`, `Caller: Okay, thanks for being straight.`]);
      break;
    }
    case 'hospitality':
      x.project_type = 'commercial'; x.scope_type = 'other'; x.custom_work_flags = ['hospitality_or_retail']; x.criteria = crit('FPUUU');
      x.summary = `${first} wants a ${r.pick(['restaurant', 'gym', 'retail store'])} designed — out of scope for Aangan.`;
      raw = say([...callIntro, `Caller: I’m opening a ${r.pick(['restaurant', 'gym', 'cafe'])} in ${loc}. Can you design it?`, `${FD}: Hospitality and fitness spaces are outside our scope.`, `Caller: Alright.`]);
      break;
    case 'junk': {
      const k = r.pick(['vendor', 'job_seeker', 'spam', 'wrong_number'] as const);
      x.intent = k; x.client_name = null; x.location = null; x.in_service_area = null; x.area_sqft = null; x.scope_type = null; x.project_type = null; x.scope_clarity = 'not_stated'; x.criteria = crit('UUUUU');
      x.summary = k === 'vendor' ? 'A supplier pitching tiles / hardware.' : k === 'job_seeker' ? 'Someone asking about job openings.' : k === 'spam' ? 'Spam / sales call.' : 'Wrong number.';
      raw = say([...callIntro, k === 'vendor' ? 'Caller: We supply premium tiles, can I send a catalogue?' : k === 'job_seeker' ? 'Caller: Are you hiring designers?' : k === 'spam' ? 'Caller: Congratulations, you have been selected for a loan offer.' : 'Caller: Is this the dentist’s clinic?']);
      break;
    }
    case 'noisy': {
      x.transcription_confidence = 0.55 + r.next() * 0.28; x.inaudible_count = r.int(2, 5);
      if (r.chance(0.5)) { x.location_clarity = 'ambiguous'; x.location = `${loc}?`; x.ambiguity_flags = ['location_garbled']; } else { x.scope_clarity = 'ambiguous'; x.ambiguity_flags = ['scope_contradiction']; }
      x.summary = `${first} wants a ${bhk} redesigned, but the line was poor and key details were unclear.`;
      raw = say([...callIntro, `Caller: Hi, this is ${first}... [inaudible] ... a ${bhk} in [uncertain: ${loc}], about ${area}... [inaudible] ... kitchen and [inaudible].`, `${FD}: Sorry, the line is breaking up. Could you repeat?`, `Caller: [inaudible] ... redo the [inaudible] ... March.`]);
      break;
    }
    case 'custom':
      x.custom_work_flags = [r.pick(['luxury_spec', 'home_automation', 'structural_work'] as const)]; x.area_sqft = r.int(15, 40) * 100;
      x.budget_low_inr = 6_000_000; x.budget_high_inr = 9_000_000;
      x.scope_summary = 'Full home with imported marble, full home automation and some wall changes.';
      x.summary = `${first} wants a premium full-home project with custom / complex elements — needs senior review before any estimate.`;
      raw = say([...callIntro, `Caller: ${loc}, ${x.area_sqft} sq ft villa. Imported marble, full home automation, and we want to move a couple of walls.`, `${FD}: We don’t do structural work, but the interiors we can discuss.`, `Caller: Fine.`]);
      break;
    case 'pricing_only':
      x.intent = 'pricing_only'; x.asked_for_pricing = true; x.scope_clarity = 'not_stated'; x.scope_type = null; x.area_sqft = null; x.criteria = crit('UPUUU'); x.timeline_text = null; x.weeks_to_completion = null;
      x.clarifying_question = 'Are you looking for a full design-and-execution project for the space, or mainly advice and ideas?';
      x.summary = `${first} only asked what Aangan charges per sq ft; no project details yet.`;
      raw = say([...callIntro, 'Caller: What do you charge per sq ft?', `${FD}: Pricing depends on the site, materials and scope; your designer walks you through it at the consultation.`, 'Caller: Okay, I’ll think.']);
      break;
    case 'complaint':
      x.intent = 'existing_client_complaint'; x.sentiment = 'frustrated'; x.criteria = crit('UUUUU');
      x.summary = `EXISTING CLIENT — ${first} says the project team has not replied for days and wants a senior callback.`;
      raw = say([...callIntro, `Caller: ${first} here. My designer hasn’t replied in a week. I want a senior person to call me back today.`, `${FD}: I’m escalating this right now.`]);
      break;
    case 'missed':
      x.intent = 'other'; x.client_name = null; x.client_phone = null; x.location = null; x.summary = 'Missed call, no voicemail.'; x.criteria = crit('UUUUU');
      raw = 'MISSED CALL. No voicemail.';
      break;
    case 'price_breach':
      x.asked_for_pricing = true; x.criteria = crit('PPUUU'); x.timeline_text = null; x.weeks_to_completion = null;
      x.summary = `${first} (${bhk}, ${loc}) asked about price and the studio side quoted a figure — policy breach.`;
      raw = say([...callIntro, `Caller: ${bhk} in ${loc}, ${area} sq ft. What would it cost?`, `${FD}: For a ${bhk} it’s typically around ₹${r.int(14, 22)} lakh.`, 'Caller: Okay, book a consultation.']);
      break;
  }
  if (channel !== 'phone') {
    // Re-skin as a message thread / form for non-phone channels.
    raw = channel === 'web_form'
      ? [`Name: ${x.client_name ?? 'Anonymous'}`, `Location: ${x.location ?? '(not filled)'}`, `Carpet area: ${x.area_sqft ? `~${x.area_sqft} sq ft` : '(not filled)'}`, `Project type: ${x.scope_type ? x.scope_type.replace('_', ' ') : '(not selected)'}`, `Timeline: ${x.timeline_text ?? '(not filled)'}`, `Notes: ${x.summary}`].join('\n')
      : raw.replace(/Good (morning|afternoon), Aangan Studio\./, 'Hi, thanks for messaging Aangan Studio.').replace(/^Caller:/gm, `${x.client_name ?? 'Customer'}:`);
    if (scenario === 'missed') raw = 'No message content.';
  }
  return { extraction: x, raw, scenario };
}

// ---- lifecycle simulation ---------------------------------------------------------------------

export interface SyntheticSet {
  enquiries: EnquiryRow[]; transcripts: TranscriptRow[]; pricingLogs: PricingLogRow[]; escalations: EscalationRow[]; consultations: ConsultationRow[];
}

const BUCKET_WEIGHTS: readonly (readonly [[number, number], number])[] = [
  [[1, 55], 35], [[60, 235], 22], [[245, 1400], 25], [[1445, 2870], 10], [[2890, 5500], 8],
];
const WIN_BY_BUCKET = [0.32, 0.24, 0.15, 0.08, 0.03]; // illustrative only

const ist = (ymd: string, h: number, m: number) => new Date(`${ymd}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+05:30`);

export function buildSynthetic(count: number, month: string, now: Date, designers: DesignerRow[], seed = 20260907): SyntheticSet {
  const r = rng(seed);
  const out: SyntheticSet = { enquiries: [], transcripts: [], pricingLogs: [], escalations: [], consultations: [] };
  const [y, mo] = month.split('-').map(Number);
  const days = new Date(y, mo, 0).getDate();
  const pool = designers.filter((d) => d.active);

  for (let i = 0; i < count; i++) {
    const scenario = r.weighted(SCENARIOS);
    const channel = scenario === 'missed' ? 'phone' : r.weighted([['phone', 55], ['whatsapp', 28], ['web_form', 17]] as const);
    const day = r.int(1, days);
    const ymd = `${month}-${String(day).padStart(2, '0')}`;
    const inHours = r.chance(0.78);
    const hour = inHours ? r.int(10, 18) : r.pick([7, 8, 9, 19, 20, 21, 22]);
    const receivedAt = ist(ymd, hour, r.int(0, 59));
    const g = gen(r, scenario, channel);
    const missed = scenario === 'missed' || (channel === 'phone' && !inHours && r.chance(0.7));

    // First-response time: live for answered calls, otherwise drawn from the bucket distribution (never before opening).
    let respondedAt: Date | null = null;
    if (!missed && channel === 'phone') respondedAt = receivedAt;
    else if (channel !== 'web_form' || r.chance(0.9)) {
      const [lo, hi] = r.weighted(BUCKET_WEIGHTS);
      respondedAt = new Date(receivedAt.getTime() + r.int(lo, hi) * 60_000);
    }
    if (respondedAt && respondedAt > now) respondedAt = null;

    const raw = missed ? 'MISSED CALL. No voicemail.' : g.raw;
    const built = buildRecords({
      sourceRef: `S-${month}-${String(i + 1).padStart(3, '0')}`, channel, receivedAt, callOutcome: channel === 'phone' ? (missed ? 'missed' : 'answered') : null,
      durationSec: channel === 'phone' && !missed ? r.int(90, 420) : null, firstResponseAt: missed ? null : respondedAt, rawText: raw, processedText: g.processed ?? null,
      extraction: missed ? blankExtraction({ intent: 'other', summary: 'Missed call, no voicemail.' }) : g.extraction,
      sourceStatus: null, now, isSynthetic: true,
    });
    simulate(built.enquiry, built.escalations, built.pricing, out, r, now, pool, g.scenario);
    out.enquiries.push(built.enquiry);
    if (built.transcript) out.transcripts.push(built.transcript);
    if (built.pricing) out.pricingLogs.push(built.pricing);
    out.escalations.push(...built.escalations);
  }
  return out;
}

function simulate(e: EnquiryRow, escs: EscalationRow[], pricing: PricingLogRow | null, out: SyntheticSet, r: ReturnType<typeof rng>, now: Date, designers: DesignerRow[], scenario: Scenario) {
  const ageH = (now.getTime() - new Date(e.received_at).getTime()) / 3_600_000;
  const iso = (d: Date) => d.toISOString();
  const after = (d: Date | string, h: number) => new Date(new Date(d).getTime() + h * 3_600_000);

  // 1. Resolve escalations older than ~2 days, with outcomes drawn from illustrative ground-truth rates.
  for (const esc of escs) {
    const age = (now.getTime() - new Date(esc.created_at).getTime()) / 3_600_000;
    if (age < 48) continue;
    const t = esc.trigger;
    const lat = t === 'needs_clarification' ? r.int(1, 6) : t === 'low_confidence' || t === 'ambiguous_location' || t === 'ambiguous_scope' ? r.int(1, 5)
      : t === 'high_value_fringe' ? r.int(4, 30) : t === 'audit_sample' ? r.int(6, 50) : t === 'existing_client_complaint' ? 1 : r.int(2, 36);
    esc.status = 'resolved'; esc.resolved_at = iso(after(esc.created_at, lat)); esc.resolved_by = 'seed';
    const service = esc.kind === 'service_recovery' || t === 'agent_policy_breach';
    if (service) { esc.resolution = 'dismissed'; esc.resolution_note = 'Handled'; continue; }
    const pQualify = t === 'needs_clarification' ? 0.62 : t === 'low_confidence' || t === 'ambiguous_location' || t === 'ambiguous_scope' ? 0.7 : t === 'high_value_fringe' ? 0.45
      : t === 'audit_sample' ? 0.12 : t === 'budget_below_minimum' ? 0.15 : t === 'custom_work' ? 0.8 : 0.5;
    const qualify = r.chance(pQualify);
    const confirmsAi = e.ai_qualification !== 'review' && ((qualify && e.ai_qualification === 'qualified') || (!qualify && e.ai_qualification === 'unqualified'));
    esc.resolution = confirmsAi ? 'approved_ai' : qualify ? 'qualified' : 'unqualified';
    e.final_qualification = qualify ? 'qualified' : 'unqualified';
    e.final_decided_by = 'seed'; e.final_decided_at = esc.resolved_at;
    e.status = qualify ? 'new' : 'closed';
  }

  const effective = e.final_qualification ?? e.ai_qualification;
  const heldOpen = escs.some((x) => x.status !== 'resolved' && x.kind !== 'service_recovery' && x.trigger !== 'audit_sample' && x.trigger !== 'agent_policy_breach');
  if (effective !== 'qualified' || heldOpen) return;

  // 2. Handoff to a designer.
  const sentAt = after(e.final_decided_at ?? e.received_at, r.int(0, 3) + 0.1);
  if (sentAt > now) return;
  const d = r.pick(designers);
  e.designer_id = d.id; e.designer_name = d.name; e.handoff_sent_at = iso(sentAt); e.status = 'handed_off';
  const hs = r.weighted([['accepted', 88], ['sent', 7], ['declined', 5]] as const);
  e.handoff_status = hs;
  if (hs === 'accepted') { e.handoff_accepted_at = iso(after(sentAt, r.int(10, 180) / 60)); e.designer_reasked = r.chance(scenario === 'noisy' ? 0.2 : 0.08); }
  if (hs === 'declined') { e.designer_id = null; e.designer_name = null; return; }

  // 3. Designers sometimes flag a qualified lead as bad (a false positive).
  if (hs === 'accepted' && e.ai_qualification === 'qualified' && ageH > 24 * 8 && r.chance(0.07)) {
    e.final_qualification = 'unqualified'; e.final_decided_by = d.name; e.final_decided_at = iso(after(sentAt, r.int(24, 120))); e.override_note = 'Not a serious prospect'; e.status = 'closed';
    return;
  }

  // 4. Formal estimate, consultation, outcome.
  if (pricing?.pipeline_estimate_inr && ageH > 24 * 6) {
    pricing.formal_estimate_inr = Math.round((pricing.pipeline_estimate_inr * (1 + r.next() * 0.3)) / 10_000) * 10_000;
    pricing.formal_estimate_at = iso(after(sentAt, r.int(100, 260)));
  }
  if (hs === 'accepted' && r.chance(0.7)) {
    const start = after(sentAt, r.int(30, 140));
    start.setMinutes(0, 0, 0);
    const status: ConsultationRow['status'] = start > now ? 'scheduled' : r.weighted([['completed', 80], ['no_show', 6], ['cancelled', 8], ['scheduled', 6]] as const);
    out.consultations.push({
      id: randomUUID(), enquiry_id: e.id, designer_id: d.id, starts_at: iso(start), ends_at: iso(after(start, 1)),
      mode: r.pick(['site_visit', 'site_visit', 'studio', 'call'] as const), location: e.location, status, notes: null, google_event_id: null, ics_uid: randomUUID(), created_by: 'seed', created_at: iso(after(sentAt, 2)),
    });
  }
  if (hs === 'accepted' && ageH > 24 * 10 && e.estimated_value_inr) {
    const bucket = e.first_response_at ? (() => { const m = (new Date(e.first_response_at).getTime() - new Date(e.received_at).getTime()) / 60_000; return m <= 60 ? 0 : m <= 240 ? 1 : m <= 1440 ? 2 : m <= 2880 ? 3 : 4; })() : 3;
    if (r.chance(WIN_BY_BUCKET[bucket])) {
      e.status = 'won';
      e.final_value_inr = Math.round((e.estimated_value_inr * (0.95 + r.next() * 0.45)) / 10_000) * 10_000; // signed values drift above the standard-spec estimate
    } else if (r.chance(0.8)) { e.status = 'lost'; e.closed_reason = r.pick(['Chose another studio', 'Postponed project', 'Budget mismatch', 'No response']); }
  }
}

