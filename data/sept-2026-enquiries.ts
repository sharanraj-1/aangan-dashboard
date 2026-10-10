// The 40 real (anonymised) enquiries Aangan received in September 2026:
// 20 phone calls (T01–T20), 10 WhatsApp threads (W01–W10), 10 web forms (F01–F10).
// Source: "Aangan_Sep 2026_Enquiries.pdf". Transcripts are verbatim; names/numbers are anonymised in the source.
//
// Each record also carries:
//   x       — the structured extraction a correct analysis should produce (stand-in for Gemini output)
//   expect  — the outcome + escalation triggers the guardrail rules (qualified.md / services.md / pricing.md)
//             should produce. scripts/test-guardrails.ts asserts the engine reproduces these for all 40.
//
// Facts the source does NOT give are left null/unrecorded rather than invented: web-form response times,
// designer assignments, won/lost outcomes. The dashboard shows those as "not recorded".

import { blankExtraction, crit } from '../lib/extraction';
import type { AiQualification, CallOutcome, Channel, EscalationTrigger, EnquiryStatus, Extraction } from '../lib/types';

export interface RealRecord {
  ref: string;
  channel: Channel;
  /** IST wall-clock, 'YYYY-MM-DD HH:mm' */
  at: string;
  durationSec?: number;
  callOutcome?: CallOutcome;
  /** IST wall-clock of the first successful human contact. For answered calls this equals `at`. */
  respondedAt?: string | null;
  responseNote?: string;
  raw: string;
  processed?: string;
  language?: string;
  conf: number;
  x: Partial<Extraction>;
  /** Status the source itself reports (lost / closed); otherwise derived from triage. */
  sourceStatus?: EnquiryStatus;
  expect: { outcome: AiQualification; escalations: EscalationTrigger[] };
}

const REDACTED = '[redacted in source]';
const FD = 'Front Desk';

export const SEPT_2026: RealRecord[] = [
  // ============================== PHONE ==============================
  {
    ref: 'T01', channel: 'phone', at: '2026-09-02 10:23', durationSec: 252, respondedAt: '2026-09-02 10:23', callOutcome: 'answered', conf: 0.97,
    raw: `${FD}: Good morning, Aangan Studio.
Caller: Hi, I’m Priya. I got your number from a friend — Shruti Joshi. She had her flat done by you in Aundh.
${FD}: Of course — thank you for calling. What are you looking to do?
Caller: We have a 3BHK in Kothrud — Dahanukar Colony. We bought it two years ago and it still looks like the builder flat. We want to redo the whole thing — kitchen, living room, both bedrooms.
${FD}: That sounds like a complete redesign. How big is the apartment?
Caller: About 1,400 sq ft carpet.
${FD}: And your timeline?
Caller: We’d like to be done by March. We’re in no rush.
${FD}: Perfect. Are you the owner?
Caller: Yes — myself and my husband. He knows we’re calling and is happy to go ahead.
${FD}: Lovely. Can I take your number and schedule a consultation?
Caller: Sure. (gives number)`,
    x: {
      client_name: 'Priya', client_phone: REDACTED, project_type: 'residential', scope_type: 'full_home',
      scope_summary: 'Full redesign of a 3BHK: kitchen, living room and both bedrooms.', scope_clarity: 'clear',
      location: 'Kothrud (Dahanukar Colony), Pune', location_clarity: 'clear', in_service_area: true, area_sqft: 1400,
      timeline_text: 'Done by March; no rush.', weeks_to_completion: 26, referral_source: 'Shruti Joshi (past client, Aundh)',
      criteria: crit('PPPUP'), sentiment: 'positive',
      summary: 'Owner (with husband’s consent) of a 3BHK in Kothrud wants a full redesign — kitchen, living room, both bedrooms — about 1,400 sq ft carpet, finished by March. Referred by past client Shruti Joshi. Consultation to be scheduled.',
    },
    expect: { outcome: 'qualified', escalations: [] },
  },
  {
    ref: 'T02', channel: 'phone', at: '2026-09-03 14:41', durationSec: 308, respondedAt: '2026-09-03 14:41', callOutcome: 'answered', conf: 0.96,
    raw: `${FD}: Good afternoon, Aangan Studio.
Caller: Hi. I was looking at your work on Instagram. I have a 2BHK in Wakad — can you tell me roughly how much something like that would cost?
${FD}: Our pricing depends on the materials and the scope — the best way to get a clear picture is a consultation with one of our designers, who can walk you through everything. What are you planning to do?
Caller: Full redesign — modular kitchen, wardrobes, living room, both bedrooms. About 950 sq ft.
${FD}: Good scope. What’s your timeline?
Caller: We move in November — so maybe starting design from October?
${FD}: That works well. Shall I set up a consultation?
Caller: Yes, but can you give me a rough ballpark first? Even a range?
${FD}: I genuinely can’t — it varies quite a bit based on materials. Giving you a number without seeing the site would be misleading. The designer will go through all of that with you — the consultation is free and there’s no obligation.
Caller: Okay, fair enough. Let’s book it.`,
    x: {
      client_phone: REDACTED, project_type: 'residential', scope_type: 'full_home',
      scope_summary: 'Full redesign of a 2BHK: modular kitchen, wardrobes, living room, both bedrooms.', scope_clarity: 'clear',
      location: 'Wakad, Pune', location_clarity: 'clear', in_service_area: true, area_sqft: 950,
      timeline_text: 'Moving in November; wants design to start in October.', weeks_to_completion: 9, asked_for_pricing: true,
      criteria: crit('PPPUU'), sentiment: 'neutral',
      summary: '2BHK in Wakad (~950 sq ft), full redesign incl. modular kitchen and wardrobes, moving in November so design should start in October. Asked twice for a price range and was correctly deflected; accepted a free consultation. Name not captured.',
    },
    expect: { outcome: 'qualified', escalations: [] },
  },
  {
    ref: 'T03', channel: 'phone', at: '2026-09-03 16:15', durationSec: 160, respondedAt: '2026-09-03 16:15', callOutcome: 'answered', conf: 0.96,
    raw: `${FD}: Good afternoon, Aangan Studio.
Caller: Hello, I saw your work on LinkedIn. My name is Suresh Patil. I’m in Nashik — would you be able to take on a project here? I want to redo my home office and study.
${FD}: Thank you for calling. We only work in Pune and PCMC at the moment — we don’t have the vendor network to take on projects outside Pune.
Caller: Not even for a smaller project?
${FD}: Even for a smaller project, our execution depends on our contractors being on-site. I’m sorry we can’t help.
Caller: Alright, understood. Thanks.`,
    x: {
      client_name: 'Suresh Patil', client_phone: REDACTED, project_type: 'residential', scope_type: 'partial_home',
      scope_summary: 'Home office and study redesign.', scope_clarity: 'clear', location: 'Nashik', location_clarity: 'clear',
      in_service_area: false, criteria: crit('PFUUU'), sentiment: 'neutral',
      criteria_notes: { service_area: 'Caller is in Nashik — outside Pune / PCMC.' },
      summary: 'Suresh Patil wants his home office and study redone, but the site is in Nashik — outside Aangan’s Pune/PCMC service area. Declined politely on the call.',
    },
    expect: { outcome: 'unqualified', escalations: [] },
  },
  {
    ref: 'T04', channel: 'phone', at: '2026-09-04 11:07', durationSec: 202, respondedAt: '2026-09-04 11:07', callOutcome: 'answered', conf: 0.95,
    raw: `${FD}: Good morning, Aangan Studio.
Caller: Hi — can someone come and give us some ideas for our living room? We’re not planning to do the full thing right now. Just want suggestions on colours, furniture arrangement, what to change.
${FD}: We’re a full-service studio — our projects include design and execution together. We don’t do advisory or consultation-only visits. If you’re planning a full redesign with execution, we’d be a great fit.
Caller: Oh I see. No, we’re just exploring for now. Maybe later.
${FD}: Of course — feel free to call back when you’re ready to go ahead with a full project.`,
    x: {
      client_phone: REDACTED, intent: 'advice_only', project_type: 'residential', scope_type: 'single_room',
      scope_summary: 'Living-room ideas only: colours, furniture arrangement.', scope_clarity: 'clear',
      criteria: crit('FUUUU'), sentiment: 'neutral', criteria_notes: { real_project: 'Wants colour / layout suggestions, not design + execution.' },
      summary: 'Caller wants advice on living-room colours and furniture arrangement, not a full design-and-execution project. Location not given. Told to call back when ready for a full project.',
    },
    expect: { outcome: 'unqualified', escalations: [] },
  },
  {
    ref: 'T05', channel: 'phone', at: '2026-09-05 10:52', durationSec: 404, respondedAt: '2026-09-05 10:52', callOutcome: 'answered', conf: 0.97,
    raw: `${FD}: Good morning, Aangan Studio.
Caller: Hi, this is Aarti Mehta. Vikram Agarwal asked me to call — he’s a close friend of Nikhil’s.
${FD}: Of course, thank you. What are you looking for?
Caller: We have a 4BHK in Koregaon Park — about 2,400 sq ft carpet. Complete redesign. New flooring, kitchen, all four bedrooms. We’ve already moved out temporarily.
${FD}: That’s a significant project. Do you have a timeline?
Caller: We want to move back in by February. About 4 months.
${FD}: That should work well. Would you prefer a site visit for the consultation?
Caller: Yes please — Vikram said your team does that.
${FD}: Absolutely. Can I check your availability for early next week?`,
    x: {
      client_name: 'Aarti Mehta', client_phone: REDACTED, project_type: 'residential', scope_type: 'full_home',
      scope_summary: 'Complete redesign of a 4BHK: new flooring, kitchen, all four bedrooms. Currently vacated.', scope_clarity: 'clear',
      location: 'Koregaon Park, Pune', location_clarity: 'clear', in_service_area: true, area_sqft: 2400,
      timeline_text: 'Move back in by February (~4 months).', weeks_to_completion: 17,
      referral_source: 'Vikram Agarwal (close friend of Nikhil)', founder_connection: true,
      criteria: crit('PPPUP'), sentiment: 'positive',
      summary: 'Large 4BHK (~2,400 sq ft) in Koregaon Park, complete redesign, family already moved out, wants to return by February. Introduced by Vikram Agarwal, a close friend of Nikhil — treat as a priority. Site-visit consultation requested for early next week.',
    },
    expect: { outcome: 'qualified', escalations: [] },
  },
  {
    ref: 'T06', channel: 'phone', at: '2026-09-05 15:28', durationSec: 301, respondedAt: '2026-09-05 15:28', callOutcome: 'answered', conf: 0.96,
    raw: `${FD}: Good afternoon, Aangan Studio.
Caller: Hi, I’m calling about a commercial project. We’re a startup — just got our first proper office space in Baner. About 800 sq ft. We need workstations for 20 people, a small cabin, a meeting room, and a break area.
${FD}: We do commercial fitouts up to about 3,000 sq ft. What’s the state of the space right now?
Caller: Bare shell — just columns and floor. Nothing else.
${FD}: Full fitout from scratch. And the timeline?
Caller: We want to be operational by December. Our team is working from home currently.
${FD}: December is doable. Are you the decision-maker for this?
Caller: Yes, I’m the founder.
${FD}: Perfect. Let’s set up a consultation.`,
    x: {
      client_phone: REDACTED, project_type: 'commercial', scope_type: 'office',
      scope_summary: 'Full fitout of a bare-shell office: 20 workstations, small cabin, meeting room, break area.', scope_clarity: 'clear',
      location: 'Baner, Pune', location_clarity: 'clear', in_service_area: true, area_sqft: 800,
      timeline_text: 'Operational by December.', weeks_to_completion: 13, criteria: crit('PPPUP'), sentiment: 'positive',
      summary: 'Startup founder (decision-maker) needs a full fitout of an 800 sq ft bare-shell office in Baner — 20 workstations, cabin, meeting room, break area — operational by December. Consultation being set up.',
    },
    expect: { outcome: 'qualified', escalations: [] },
  },
  {
    ref: 'T07', channel: 'phone', at: '2026-09-08 09:44', durationSec: 195, respondedAt: '2026-09-08 09:44', callOutcome: 'answered', conf: 0.94, // opens at 9:44 — before the desk is staffed
    raw: `${FD}: Good morning, Aangan Studio.
Caller: Hello — I want to redo my living room and kitchen before Diwali. Can you take it up?
${FD}: Diwali is about three weeks away. Our design phase alone takes 3–4 weeks, and execution follows. We couldn’t do justice to a project in that time.
Caller: Even just the living room?
${FD}: Even so — a room redesign with execution takes at least 8–10 weeks from start to finish. We wouldn’t want to rush it.
Caller: What if I start after Diwali?
${FD}: A November start would work well. Shall I note your details for that?
Caller: Let me think and call back.`,
    x: {
      client_phone: REDACTED, project_type: 'residential', scope_type: 'partial_home',
      scope_summary: 'Living room and kitchen redesign.', scope_clarity: 'clear', location_clarity: 'not_stated',
      timeline_text: 'Wanted it done before Diwali (~3 weeks); open to a post-Diwali (November) start.',
      criteria: crit('PUUUU'), sentiment: 'neutral',
      criteria_notes: { timeline: 'Original deadline impossible, but caller is open to a November start.', service_area: 'Location never stated.' },
      clarifying_question: 'Which area is the property in?',
      summary: 'Wants living room + kitchen redone before Diwali (~3 weeks) — not feasible. Caller is open to starting after Diwali and will call back. Location not captured.',
    },
    expect: { outcome: 'review', escalations: ['needs_clarification'] },
  },
  {
    ref: 'T08', channel: 'phone', at: '2026-09-09 22:47', callOutcome: 'missed', respondedAt: null,
    responseNote: 'Call-back attempted 10 Sept 10:15am — no answer.', conf: 0.95,
    raw: `MISSED CALL. No voicemail. Number associated with Nanded City area (Pune).
Call-back attempted following morning at 10:15am — no answer.`,
    x: { intent: 'other', location: 'Nanded City, Pune (from number)', summary: 'Missed call at 10:47pm, no voicemail. Call-back at 10:15am next day went unanswered. Prospect not yet reached.' },
    expect: { outcome: 'review', escalations: ['missed_call'] },
  },
  {
    ref: 'T09', channel: 'phone', at: '2026-09-10 11:32', durationSec: 352, respondedAt: '2026-09-10 11:32', callOutcome: 'answered', conf: 0.97,
    raw: `${FD}: Good morning, Aangan Studio.
Caller: I need to speak to someone right now. My project has been going for three months and my designer hasn’t replied in five days. This is not acceptable.
${FD}: I’m very sorry. Can I take your name and project details?
Caller: Sheetal Deshpande. My designer is Aryan. Flat in Viman Nagar — 2BHK. I’ve sent three messages and called twice.
${FD}: Sheetal, I’m getting this to our project team right now. Would you prefer to hold for two minutes, or should I have someone senior call you back within 15 minutes?
Caller: Callback. And I want it from Nikhil or a senior person — not just whoever picks up.
${FD}: Noted. I’ll make sure of that.
Note: Existing project complaint. Escalated to studio head immediately.`,
    x: {
      client_name: 'Sheetal Deshpande', client_phone: REDACTED, intent: 'existing_client_complaint', project_type: 'residential',
      location: 'Viman Nagar, Pune', location_clarity: 'clear', in_service_area: true, sentiment: 'frustrated',
      summary: 'EXISTING CLIENT — not a new lead. Sheetal Deshpande (2BHK, Viman Nagar, designer Aryan) says her designer has not replied in five days after three messages and two calls, three months into the project. Wants a callback from Nikhil or a senior person within 15 minutes.',
    },
    expect: { outcome: 'not_applicable', escalations: ['existing_client_complaint'] },
  },
  {
    ref: 'T10', channel: 'phone', at: '2026-09-11 14:04', durationSec: 220, respondedAt: '2026-09-11 14:04', callOutcome: 'answered', conf: 0.97,
    raw: `${FD}: Good afternoon, Aangan Studio.
Caller: Hi. I have a 1BHK in Kharadi — about 550 sq ft. I want to do the kitchen and one bedroom. My budget is 1 to 1.5 lakh maximum for everything. Is that possible with you?
${FD}: I appreciate you sharing that. For a kitchen redesign and a bedroom with full execution — materials, furniture, and contractor work — 1 to 1.5 lakh would be significantly below what a project of that scope would cost with us.
Caller: Even for one bedroom?
${FD}: Even for one room. I wouldn’t want to bring you to a consultation if the numbers don’t align. I’d suggest checking with local contractors who work at that price point.
Caller: Okay, thank you for being straight.`,
    x: {
      client_phone: REDACTED, project_type: 'residential', scope_type: 'partial_home',
      scope_summary: 'Kitchen and one bedroom of a 1BHK, full execution.', scope_clarity: 'clear',
      location: 'Kharadi, Pune', location_clarity: 'clear', in_service_area: true, area_sqft: 550,
      budget_low_inr: 100_000, budget_high_inr: 150_000, budget_flexibility: 'rigid',
      criteria: crit('PPUFU'), sentiment: 'neutral',
      summary: 'Volunteered a ₹1–1.5 lakh maximum for a kitchen + bedroom with full execution in a 550 sq ft 1BHK in Kharadi — clearly below what that scope costs. Misalignment addressed on the call; not forwarded.',
    },
    expect: { outcome: 'unqualified', escalations: ['budget_below_minimum'] },
  },
  {
    ref: 'T11', channel: 'phone', at: '2026-09-12 10:18', durationSec: 382, respondedAt: '2026-09-12 10:18', callOutcome: 'answered', conf: 0.96,
    raw: `${FD}: Good morning, Aangan Studio.
Caller: Hi — I have a question. I’m in a rented apartment. Can you still take up a project?
${FD}: It depends on the scope. What are you looking to do?
Caller: It’s a 2BHK in Baner. I’ve been here a year, I have a 3-year lease, and the place is quite bare. I want to properly design the living room, bedroom, and kitchen — no structural changes, just design and fittings.
${FD}: That’s fine — we’ve done rented apartments before. For the kitchen we’d do a modular unit that can come out cleanly. The rest is largely flooring, lighting, and furniture — all reversible. Have you checked with your landlord?
Caller: Yes — they’re fine with it as long as we don’t break walls.
${FD}: Perfect. No wall-breaking from us. Shall we set up a consultation?
Caller: Yes please.`,
    x: {
      client_phone: REDACTED, project_type: 'residential', scope_type: 'partial_home',
      scope_summary: 'Design and fittings for living room, bedroom and kitchen of a rented 2BHK. No structural changes; landlord has agreed.', scope_clarity: 'clear',
      location: 'Baner, Pune', location_clarity: 'clear', in_service_area: true, criteria: crit('PPUUP'), sentiment: 'positive',
      criteria_notes: { timeline: 'No timeline discussed.' },
      clarifying_question: 'When would you need the project complete?',
      summary: 'Tenant (3-year lease) of a 2BHK in Baner wants living room, bedroom and kitchen designed — no structural changes, landlord agreed. Consultation booked, but timeline and area were not discussed.',
    },
    expect: { outcome: 'review', escalations: ['needs_clarification'] },
  },
  {
    ref: 'T12', channel: 'phone', at: '2026-09-15 10:05', durationSec: 450, respondedAt: '2026-09-15 10:05', callOutcome: 'answered', conf: 0.97,
    raw: `${FD}: Good morning, Aangan Studio.
Caller: I’m calling about a villa project in Kalyani Nagar. My name is Anand Sharma. The property is about 5,500 sq ft — ground plus two floors. Full end-to-end design.
${FD}: That’s a significant project. Is this a new property or an existing home?
Caller: New construction. Possession was last month. Completely empty.
${FD}: And your timeline?
Caller: March next year to move in. No rush.
${FD}: Good time to start. Would you like our principal designer to come to site for the first consultation?
Caller: Yes — this week or next if possible.
${FD}: Let me check the calendar and revert by end of day.`,
    x: {
      client_name: 'Anand Sharma', client_phone: REDACTED, project_type: 'residential', scope_type: 'full_home',
      scope_summary: 'Full end-to-end design of a new 5,500 sq ft villa (ground + two floors), currently empty.', scope_clarity: 'clear',
      location: 'Kalyani Nagar, Pune', location_clarity: 'clear', in_service_area: true, area_sqft: 5500,
      timeline_text: 'Move in March next year; no rush.', weeks_to_completion: 25, criteria: crit('PPPUP'), sentiment: 'positive',
      summary: 'New-construction villa in Kalyani Nagar, ~5,500 sq ft over three floors, empty and ready for full end-to-end design; move-in March. Wants the principal designer on site this week or next. Very large project.',
    },
    expect: { outcome: 'qualified', escalations: [] },
  },
  {
    ref: 'T13', channel: 'phone', at: '2026-09-16 12:19', durationSec: 368, respondedAt: '2026-09-16 12:19', callOutcome: 'answered', conf: 0.96,
    raw: `${FD}: Good afternoon, Aangan Studio.
Caller: Hi — I want to redo my flat in Aundh. 3BHK, about 1,100 sq ft. What might it cost?
${FD}: Our pricing depends on the materials and scope — the designers go through that at the consultation. What are you planning?
Caller: Kitchen, wardrobes in both bedrooms, living room. But seriously — can’t you give me even a rough range? I just want to know if we’re in the same ballpark.
${FD}: I really can’t give a number that would mean anything without seeing the site and the spec. The difference between a standard and a premium kitchen alone can be 3× the cost. The consultation is free — the designer will give you a proper number by the end of it.
Caller: Fine. Let’s book then.
${FD}: Perfect. What days work for you?`,
    x: {
      client_phone: REDACTED, project_type: 'residential', scope_type: 'full_home',
      scope_summary: 'Redo of a 3BHK: kitchen, wardrobes in both bedrooms, living room.', scope_clarity: 'clear',
      location: 'Aundh, Pune', location_clarity: 'clear', in_service_area: true, area_sqft: 1100, asked_for_pricing: true,
      criteria: crit('PPUUU'), sentiment: 'neutral', criteria_notes: { timeline: 'No timeline discussed.' },
      clarifying_question: 'When would you need the project complete?',
      summary: '3BHK in Aundh (~1,100 sq ft): kitchen, two wardrobes, living room. Pressed twice for a price range and was deflected; agreed to book a consultation. Timeline and decision-maker not discussed.',
    },
    expect: { outcome: 'review', escalations: ['needs_clarification'] },
  },
  {
    ref: 'T14', channel: 'phone', at: '2026-09-17 11:41', durationSec: 295, respondedAt: '2026-09-17 11:41', callOutcome: 'answered', conf: 0.95,
    raw: `${FD}: Good morning, Aangan Studio.
Caller: Hi — I wanted to inquire about an interior project for my parents. They have a 3BHK in Hadapsar — new possession. They want a proper design.
${FD}: That sounds good. Will your parents be involved in the decision?
Caller: Yes — I’m doing the initial checking. They don’t really use phones much. I’ll tell them about the consultation and they’ll decide.
${FD}: Sure — just so we know: your parents would be at the consultation, right? Our designers like to understand the brief directly from the people who’ll live in the space.
Caller: Yes, they would come. I’m just calling to see if it’s worth pursuing.
${FD}: Absolutely. Should I note your details and explain what the consultation involves?
Caller: Please. (gives number)
Note: Caller is son. Owners are parents; both will attend consultation. Decision with parents.`,
    x: {
      client_phone: REDACTED, project_type: 'residential', scope_type: 'full_home',
      scope_summary: 'Interior design for parents’ new-possession 3BHK.', scope_clarity: 'clear',
      location: 'Hadapsar, Pune', location_clarity: 'clear', in_service_area: true, criteria: crit('PPUUU'), sentiment: 'neutral',
      criteria_notes: { decision_maker: 'Son is doing initial checking; parents (owners) decide and will attend.', timeline: 'No timeline discussed.' },
      clarifying_question: 'When would you need the project complete?',
      summary: 'Son enquiring for his parents’ new 3BHK in Hadapsar. The parents (owners, decision-makers) will attend the consultation. Timeline and area not discussed.',
    },
    expect: { outcome: 'review', escalations: ['needs_clarification'] },
  },
  {
    ref: 'T15', channel: 'phone', at: '2026-09-18 15:12', durationSec: 344, respondedAt: '2026-09-18 15:12', callOutcome: 'answered', conf: 0.97,
    raw: `${FD}: Good afternoon, Aangan Studio.
Caller: Hi, I’m Smita. I’m getting possession of my flat in Undri in about six weeks. 2BHK, 875 sq ft. I want to start the design right away.
${FD}: Six weeks is just enough lead time to get the design finalised before execution begins. What are you planning?
Caller: Full home — kitchen, wardrobes, living room. The full package.
${FD}: Good scope. Are you the owner?
Caller: Yes — my husband and I. He said to go ahead and book the consultation.
${FD}: Can we see the site in its current state, or do you need to wait for possession?
Caller: We can go now — the builder will let us in.
${FD}: Even better. Let me get a designer’s availability.`,
    x: {
      client_name: 'Smita', client_phone: REDACTED, project_type: 'residential', scope_type: 'full_home',
      scope_summary: 'Full-home package for a 2BHK: kitchen, wardrobes, living room.', scope_clarity: 'clear',
      location: 'Undri, Pune', location_clarity: 'clear', in_service_area: true, area_sqft: 875,
      timeline_text: 'Possession in ~6 weeks; wants design to start right away.', criteria: crit('PPPUP'), sentiment: 'positive',
      summary: 'Smita and her husband (owners) take possession of a 2BHK in Undri in ~6 weeks and want the full package (kitchen, wardrobes, living room) designed now. Builder will allow a site visit immediately.',
    },
    expect: { outcome: 'qualified', escalations: [] },
  },
  {
    ref: 'T16', channel: 'phone', at: '2026-09-15 15:00', durationSec: 318, respondedAt: '2026-09-19 10:38', callOutcome: 'answered', conf: 0.9,
    responseNote: 'Original enquiry (Monday afternoon) was never logged; prospect chased on Friday. Received time estimated from caller’s account.',
    raw: `${FD}: Good afternoon, Aangan Studio.
Caller: Hi — I’d called on Monday about a project. Someone said they’d get back to me. It’s been two days.
${FD}: I’m very sorry. Can I get your name?
Caller: Girish Nair. I called Monday afternoon. I told someone about my 3BHK in Viman Nagar and gave my number.
${FD}: I apologise — I don’t see a note. Can you give me your details again? I’ll book the consultation directly now so it doesn’t slip again.
Caller: This is not a good sign if you forget before you even start.
${FD}: You’re absolutely right, and I’m sorry. Let me make this right now.
Note: Enquiry originally received Monday — no follow-up. Re-logged Friday. Caller frustrated. Handle with care.`,
    x: {
      client_name: 'Girish Nair', client_phone: REDACTED, intent: 'follow_up_chase', project_type: 'residential',
      scope_clarity: 'not_stated', location: 'Viman Nagar, Pune', location_clarity: 'clear', in_service_area: true,
      criteria: crit('UPUUU'), sentiment: 'frustrated',
      criteria_notes: { real_project: 'Only said "3BHK in Viman Nagar" — scope never captured.', timeline: 'No timeline captured.' },
      clarifying_question: 'Are you looking for a full design-and-execution project for the space, or mainly advice and ideas?',
      summary: 'FRUSTRATED. Girish Nair called on Monday about a 3BHK in Viman Nagar and was never called back; the enquiry was not logged. He chased on Friday (~90h later). Scope and timeline were still never captured. Handle with care.',
    },
    expect: { outcome: 'review', escalations: ['needs_clarification', 'response_sla_breach'] },
  },
  {
    ref: 'T17', channel: 'phone', at: '2026-09-22 14:16', durationSec: 270, respondedAt: '2026-09-22 14:16', callOutcome: 'answered', conf: 0.96,
    responseNote: 'First call at 2:14pm dropped after 1m12s; caller rang back at 2:16pm.',
    raw: `First call — disconnected at 1 min 12 sec
${FD}: Good afternoon, Aangan Studio.
Caller: Hi, I wanted to inquire about — (line drops)

Second call — 4 min 30 sec
${FD}: Good afternoon, Aangan Studio.
Caller: Hi — I called just now and got cut off. I’m Ritu Kapoor from Pimple Saudagar. 3BHK, about 1,050 sq ft. We’ve been here two years but never properly did the interiors. We want to start now.
${FD}: Thanks for calling back. Pimple Saudagar is in our service area. What are you looking to do?
Caller: Kitchen, wardrobes, living room. We moved in with builder furniture and it’s very basic.
${FD}: Standard full-home scope. Timeline?
Caller: Ideally done by March. Plenty of time.
${FD}: Perfect. Let me book a consultation.`,
    x: {
      client_name: 'Ritu Kapoor', client_phone: REDACTED, project_type: 'residential', scope_type: 'full_home',
      scope_summary: 'Full-home scope for a 3BHK: kitchen, wardrobes, living room (replacing builder furniture).', scope_clarity: 'clear',
      location: 'Pimple Saudagar, PCMC', location_clarity: 'clear', in_service_area: true, area_sqft: 1050,
      timeline_text: 'Ideally done by March; plenty of time.', weeks_to_completion: 23, criteria: crit('PPPUU'), sentiment: 'positive',
      summary: 'Ritu Kapoor, 3BHK (~1,050 sq ft) in Pimple Saudagar, wants kitchen, wardrobes and living room done by March. Her first call dropped after 1m12s; she called straight back.',
    },
    expect: { outcome: 'qualified', escalations: [] },
  },
  {
    ref: 'T18', channel: 'phone', at: '2026-09-23 11:55', durationSec: 182, respondedAt: '2026-09-23 11:55', callOutcome: 'answered', conf: 0.96,
    raw: `${FD}: Good morning, Aangan Studio.
Caller: Hi — I run a small coworking space. I have a 180 sq ft pod I want to make look really nice. Good lighting, a nice desk, some storage. Can you help?
${FD}: Our commercial projects are typically 500 sq ft or more. A 180 sq ft pod is below our minimum scope.
Caller: Not even for a smaller fee?
${FD}: It’s not about the fee — it’s that our design and execution team is set up for a certain scale. A 180 sq ft space isn’t one we could do well at the quality we’d want to promise. I’d suggest a local designer who specialises in smaller commercial spaces.
Caller: Fair enough. Thanks.`,
    x: {
      client_phone: REDACTED, project_type: 'commercial', scope_type: 'office', scope_summary: 'Lighting, desk and storage for a 180 sq ft coworking pod.',
      scope_clarity: 'clear', area_sqft: 180, criteria: crit('FUUUU'), sentiment: 'neutral',
      summary: 'Coworking operator wants a 180 sq ft pod made to look good (lighting, desk, storage) — below Aangan’s minimum commercial scope (~500 sq ft). Declined and pointed to a smaller-space specialist.',
    },
    expect: { outcome: 'unqualified', escalations: [] },
  },
  {
    ref: 'T19', channel: 'phone', at: '2026-09-24 16:02', durationSec: 170, respondedAt: '2026-09-24 16:02', callOutcome: 'answered', conf: 0.97,
    raw: `${FD}: Good afternoon, Aangan Studio.
Caller: Hi — I’m planning to open a restaurant in Koregaon Park. I’ve seen your work and I love it. Would you be able to design the interiors?
${FD}: We appreciate you reaching out. Restaurant and hospitality interiors are outside our current scope — we focus on residential and office spaces. For a restaurant you’d need a studio that specialises in commercial hospitality, which has very different material and compliance requirements.
Caller: Do you know anyone you could refer?
${FD}: I don’t have a specific referral I could make confidently, but searching for hospitality interior designers in Pune would give you more relevant options.
Caller: Alright, thanks.`,
    x: {
      client_phone: REDACTED, project_type: 'commercial', scope_type: 'other', scope_summary: 'Restaurant interiors.', scope_clarity: 'clear',
      location: 'Koregaon Park, Pune', location_clarity: 'clear', in_service_area: true, custom_work_flags: ['hospitality_or_retail'],
      criteria: crit('FPUUU'), sentiment: 'neutral',
      summary: 'Wants a restaurant designed in Koregaon Park. Restaurants / hospitality are out of Aangan’s scope; declined, no referral given.',
    },
    expect: { outcome: 'unqualified', escalations: [] },
  },
  {
    ref: 'T20', channel: 'phone', at: '2026-09-25 09:15', durationSec: 284, respondedAt: '2026-09-25 09:15', callOutcome: 'answered', conf: 0.97, // picked up before 10am
    raw: `${FD}: Good morning, Aangan Studio.
Caller: Good morning. I’m Pooja. I have a 2BHK in Magarpatta — Cybercity area. We’ve been wanting to properly design the interiors for a while. Kitchen, both bedrooms, living room. About 900 sq ft.
${FD}: Good scope for us. How soon are you looking to start?
Caller: We’re flexible — a January start for execution would be ideal.
${FD}: That works well. Are you the owner?
Caller: Yes — my husband and I. We both want to be at the consultation.
${FD}: Excellent. Can I book that now?
Caller: Please.`,
    x: {
      client_name: 'Pooja', client_phone: REDACTED, project_type: 'residential', scope_type: 'full_home',
      scope_summary: 'Design of a 2BHK: kitchen, both bedrooms, living room.', scope_clarity: 'clear',
      location: 'Magarpatta (Cybercity), Pune', location_clarity: 'clear', in_service_area: true, area_sqft: 900,
      timeline_text: 'Flexible; January start for execution.', weeks_to_completion: 14, criteria: crit('PPPUP'), sentiment: 'positive',
      summary: 'Pooja and husband (owners) want their 2BHK in Magarpatta (~900 sq ft) designed — kitchen, both bedrooms, living room — with execution starting in January. Both will attend the consultation.',
    },
    expect: { outcome: 'qualified', escalations: [] },
  },

  // ============================== WHATSAPP ==============================
  {
    ref: 'W01', channel: 'whatsapp', at: '2026-09-03 19:14', respondedAt: '2026-09-04 11:47', conf: 0.96,
    raw: `3 Sept, 7:14pm — Kiran Mazumdar: Hi, I got your number from Sonali Patel — you did her flat last year in Viman Nagar. We have a 4BHK in Viman Nagar and want to do the full interiors. Who should I speak to?
[No reply — message received after hours]
4 Sept, 9:32am — Kiran Mazumdar: Hi — following up on my message from yesterday?
[No reply — front desk not yet in]
4 Sept, 11:47am — ${FD}: Hi Kiran, sorry for the delay — our WhatsApp is monitored from 10am. Thanks for reaching out, and for the referral from Sonali. What size is the flat, and when are you looking to start?
4 Sept, 12:03pm — Kiran Mazumdar: About 1,800 sq ft carpet. We have possession already — flat is empty. Want to start as soon as possible. Design in October, execution starting November?
4 Sept, 12:08pm — ${FD}: That timeline works. Should I book a consultation — we can do a site visit to your flat.
4 Sept, 12:15pm — Kiran Mazumdar: Yes please. Weekdays after 6pm or weekends only for us.`,
    x: {
      client_name: 'Kiran Mazumdar', project_type: 'residential', scope_type: 'full_home', scope_summary: 'Full interiors for an empty 4BHK.', scope_clarity: 'clear',
      location: 'Viman Nagar, Pune', location_clarity: 'clear', in_service_area: true, area_sqft: 1800,
      timeline_text: 'Design in October, execution from November; wants to start ASAP.', weeks_to_completion: 17,
      referral_source: 'Sonali Patel (past client, Viman Nagar)', criteria: crit('PPPUU'), sentiment: 'positive',
      summary: 'Kiran Mazumdar has an empty 4BHK (~1,800 sq ft) in Viman Nagar and wants full interiors — design in October, execution from November. Referred by past client Sonali Patel. Messaged after hours and waited ~16.5h for a reply. Available weekdays after 6pm or weekends.',
    },
    expect: { outcome: 'qualified', escalations: [] },
  },
  {
    ref: 'W02', channel: 'whatsapp', at: '2026-09-08 14:31', respondedAt: '2026-09-10 10:22', conf: 0.9, sourceStatus: 'lost',
    raw: `8 Sept, 2:31pm — Unknown number: hi, how much do you charge per sq ft for a 2bhk?
[No reply — message missed for 2 days]
10 Sept, 10:22am — ${FD}: Hi, sorry for the delay in responding. Our pricing depends on materials and scope — our designers go through all of this at a free consultation. Can you tell us about your project?
[No reply received]
Status: Lead unresponsive after follow-up.`,
    x: {
      intent: 'pricing_only', project_type: 'residential', scope_type: 'full_home', scope_clarity: 'not_stated', asked_for_pricing: true,
      criteria: crit('UUUUU'), sentiment: 'neutral',
      clarifying_question: 'Which area is the property in?',
      summary: 'Anonymous number asked only for a per-sq-ft rate for a 2BHK. The first reply took ~44 hours and the prospect never responded. Marked lost.',
    },
    expect: { outcome: 'review', escalations: ['needs_clarification'] },
  },
  {
    ref: 'W03', channel: 'whatsapp', at: '2026-09-12 10:45', respondedAt: '2026-09-12 11:02', conf: 0.92, language: 'Hinglish',
    raw: `12 Sept, 10:45am — Sunil Yadav: Namaste. Mera flat hai Pimple Nilakh mein. 3BHK. Interior design karwana hai poora ghar. Budget bhi hai. Kaise contact karein?
12 Sept, 11:02am — ${FD}: Namaste Sunil ji! Zaroor. Pimple Nilakh hamare service area mein hai. Aap kab available hain consultation ke liye? Humara designer aapke flat pe aa sakta hai.
12 Sept, 11:30am — Sunil Yadav: Koi bhi Saturday subah theek hai.
12 Sept, 11:35am — ${FD}: Bilkul. Main Saturday 4 October ke liye note karti hoon — morning 10:30 AM. Confirm karo please.
12 Sept, 11:42am — Sunil Yadav: Confirm hai. Thanks.`,
    processed: `Sunil Yadav: Hello. I have a 3BHK flat in Pimple Nilakh. I want interior design for the whole house. I have a budget too. How do I get in touch?
Front Desk: Hello Sunil! Of course. Pimple Nilakh is in our service area. When are you available for a consultation? Our designer can come to your flat.
Sunil Yadav: Any Saturday morning is fine.
Front Desk: Certainly. I’ll note Saturday 4 October, morning 10:30 AM. Please confirm.
Sunil Yadav: Confirmed. Thanks.`,
    x: {
      client_name: 'Sunil Yadav', project_type: 'residential', scope_type: 'full_home', scope_summary: 'Full-house interior design for a 3BHK.', scope_clarity: 'clear',
      location: 'Pimple Nilakh, PCMC', location_clarity: 'clear', in_service_area: true, criteria: crit('PPUUU'), sentiment: 'positive',
      criteria_notes: { timeline: 'Consultation confirmed for 4 Oct, but no project timeline given.' },
      clarifying_question: 'When would you need the project complete?',
      summary: 'Sunil Yadav (Hinglish) has a 3BHK in Pimple Nilakh and wants the whole house designed. Mentions a budget exists but gave no figure (not probed). Consultation confirmed for Saturday 4 October, 10:30am. Timeline and area not captured.',
    },
    expect: { outcome: 'review', escalations: ['needs_clarification'] },
  },
  {
    ref: 'W04', channel: 'whatsapp', at: '2026-09-15 15:18', respondedAt: '2026-09-15 15:45', conf: 0.96,
    raw: `15 Sept, 3:18pm — Chinmay Kulkarni: Hello — do you take up commercial projects in Chinchwad? We have a 1,200 sq ft office space we want to fit out.
15 Sept, 3:45pm — ${FD}: Yes, Chinchwad is in our service area. We do office fitouts up to around 3,000 sq ft. What’s the current state of the space?
15 Sept, 3:58pm — Chinmay Kulkarni: Bare shell. Just moved in. Need workstations for 30 people, two cabins, one meeting room.
15 Sept, 4:03pm — ${FD}: Good scope for us. When are you targeting to be operational?
15 Sept, 4:12pm — Chinmay Kulkarni: January if possible. Is that doable?
15 Sept, 4:15pm — ${FD}: Yes — if we start the design process in October, January is achievable. Want to book a site visit?
15 Sept, 4:22pm — Chinmay Kulkarni: Yes. Can you send me a calendar link?`,
    x: {
      client_name: 'Chinmay Kulkarni', project_type: 'commercial', scope_type: 'office',
      scope_summary: 'Fitout of a bare-shell office: 30 workstations, two cabins, one meeting room.', scope_clarity: 'clear',
      location: 'Chinchwad, PCMC', location_clarity: 'clear', in_service_area: true, area_sqft: 1200,
      timeline_text: 'Operational by January.', weeks_to_completion: 16, criteria: crit('PPPUU'), sentiment: 'positive',
      summary: 'Chinmay Kulkarni needs a 1,200 sq ft bare-shell office in Chinchwad fitted out (30 workstations, 2 cabins, meeting room) by January. Replied to in 27 min; wants a calendar link for a site visit.',
    },
    expect: { outcome: 'qualified', escalations: [] },
  },
  {
    ref: 'W05', channel: 'whatsapp', at: '2026-09-20 18:44', respondedAt: '2026-09-22 10:15', conf: 0.93, sourceStatus: 'lost',
    raw: `20 Sept, 6:44pm (Saturday) — Meena Joshi: Hello — I wanted to inquire about getting my home designed. 2BHK in Baner. Please let me know if you can help and what the process is.
[No reply — Saturday after hours]
22 Sept, 10:15am (Monday) — ${FD}: Hi Meena, sorry for the delay — we’re closed over the weekend. We’d love to help with your 2BHK in Baner. Can you tell me more about what you’re looking to design?
[No reply]
22 Sept, 3:00pm — ${FD}: Hi Meena, just following up on my earlier message.
[No reply]
Status: Lead lost. No response after two follow-up messages.`,
    x: {
      client_name: 'Meena Joshi', project_type: 'residential', scope_type: 'full_home', scope_summary: 'Wants her 2BHK designed; scope unspecified.',
      scope_clarity: 'not_stated', location: 'Baner, Pune', location_clarity: 'clear', in_service_area: true,
      criteria: crit('UPUUU'), sentiment: 'neutral',
      clarifying_question: 'Are you looking for a full design-and-execution project for the space, or mainly advice and ideas?',
      summary: 'Meena Joshi asked about getting her 2BHK in Baner designed on a Saturday evening; the first reply came ~39.5h later and two follow-ups got no answer. Marked lost.',
    },
    expect: { outcome: 'review', escalations: ['needs_clarification'] },
  },
  {
    ref: 'W06', channel: 'whatsapp', at: '2026-09-17 11:22', respondedAt: '2026-09-17 11:41', conf: 0.97,
    raw: `17 Sept, 11:22am — Tanvi Kulkarni: Hi — Ashok Bhosale asked me to message directly. We’ve just bought a 3BHK in Koregaon Park — possession next month. We want end-to-end design. Ashok said you’re the best, so no need to look further.
17 Sept, 11:41am — ${FD}: Hi Tanvi — Ashok’s trust means a lot to us. Congratulations on the new flat! When’s possession?
17 Sept, 11:55am — Tanvi Kulkarni: October 15th.
17 Sept, 12:01pm — ${FD}: Perfect. Can we schedule a site visit for the week of October 20?
17 Sept, 12:09pm — Tanvi Kulkarni: Yes — 21st or 22nd works.`,
    x: {
      client_name: 'Tanvi Kulkarni', project_type: 'residential', scope_type: 'full_home', scope_summary: 'End-to-end design of a newly bought 3BHK.', scope_clarity: 'clear',
      location: 'Koregaon Park, Pune', location_clarity: 'clear', in_service_area: true,
      timeline_text: 'Possession 15 October; site visit 21–22 October.', referral_source: 'Ashok Bhosale', criteria: crit('PPPUP'), sentiment: 'positive',
      summary: 'Tanvi Kulkarni just bought a 3BHK in Koregaon Park (possession 15 Oct) and wants end-to-end design; referred by Ashok Bhosale and not shopping around. Site visit pencilled for 21 or 22 October.',
    },
    expect: { outcome: 'qualified', escalations: [] },
  },
  {
    ref: 'W07', channel: 'whatsapp', at: '2026-09-05 16:52', respondedAt: '2026-09-06 10:30', conf: 0.97,
    raw: `5 Sept, 4:52pm — Rohit Singh: Hi — I’m opening a gym in Kothrud. About 2,500 sq ft. Would you design the interiors? Looking for something modern and high-energy.
6 Sept, 10:30am — ${FD}: Hi Rohit — we focus on residential and office interiors. Gym and fitness spaces have specific requirements — equipment anchoring, rubber flooring, safety specs — that we’re not set up for. You’d need a specialist for this one. Sorry we can’t help.
6 Sept, 10:44am — Rohit Singh: Ok thanks.`,
    x: {
      client_name: 'Rohit Singh', project_type: 'commercial', scope_type: 'other', scope_summary: 'Interiors for a new gym.', scope_clarity: 'clear',
      location: 'Kothrud, Pune', location_clarity: 'clear', in_service_area: true, area_sqft: 2500, custom_work_flags: ['hospitality_or_retail'],
      criteria: crit('FPUUU'), sentiment: 'neutral',
      summary: 'Rohit Singh is opening a 2,500 sq ft gym in Kothrud. Gyms are out of Aangan’s scope; declined.',
    },
    expect: { outcome: 'unqualified', escalations: [] },
  },
  {
    ref: 'W08', channel: 'whatsapp', at: '2026-09-06 12:00', respondedAt: '2026-09-10 10:02', conf: 0.94,
    responseNote: 'Original message (~4 days earlier) never appears in the thread; received time estimated.',
    raw: `10 Sept, 8:44am — Pradeep Garg: Hello — I messaged 4 days ago about my flat in Aundh. No one replied. Is anyone monitoring this number?
10 Sept, 10:02am — ${FD}: Hi Pradeep — I sincerely apologise. Your earlier message doesn’t appear in this thread — it may have gone to a different number. Please tell me about your project and I’ll make sure we respond promptly.
10 Sept, 10:17am — Pradeep Garg: It was this number. 2BHK in Aundh. 850 sq ft. Full interiors. But now I’m not sure I want to work with a studio that doesn’t reply for 4 days.
10 Sept, 10:21am — ${FD}: I completely understand. This isn’t the experience we want anyone to have. If you’re open to it, I’d like to connect you directly with our designer today — not in a few days. Would that work?
10 Sept, 10:35am — Pradeep Garg: Fine. Yes.
Note: Lead highly frustrated. Response-time failure. Escalate to senior designer for same-day outreach.`,
    x: {
      client_name: 'Pradeep Garg', intent: 'follow_up_chase', project_type: 'residential', scope_type: 'full_home', scope_summary: 'Full interiors for a 2BHK.', scope_clarity: 'clear',
      location: 'Aundh, Pune', location_clarity: 'clear', in_service_area: true, area_sqft: 850, criteria: crit('PPUUU'), sentiment: 'frustrated',
      criteria_notes: { timeline: 'No timeline given.' }, clarifying_question: 'When would you need the project complete?',
      summary: 'FRUSTRATED. Pradeep Garg messaged ~4 days earlier about a 2BHK in Aundh (850 sq ft, full interiors) and got no reply. Now doubts the studio. Agreed to a same-day call with a designer. Timeline not yet captured.',
    },
    expect: { outcome: 'review', escalations: ['needs_clarification', 'response_sla_breach'] },
  },
  {
    ref: 'W09', channel: 'whatsapp', at: '2026-09-25 15:18', respondedAt: '2026-09-26 11:08', conf: 0.95,
    raw: `25 Sept, 3:18pm — Neha Deshpande: Hi! I want to redo my living room in Aundh. Here’s what it looks like. [3 photos attached — living room, open dining area, partial kitchen view]
25 Sept, 3:19pm — Neha Deshpande: It’s a 3BHK apartment. We want to start with the living room and dining area. Maybe the kitchen too.
[No reply — message received late afternoon, missed]
26 Sept, 11:08am — ${FD}: Hi Neha, sorry for the delay — the photos are great reference, lovely natural light. We’d love to redesign the space. Is this a full execution project, or just design advice?
26 Sept, 11:15am — Neha Deshpande: Full execution — design, materials, furniture, all of it.
26 Sept, 11:18am — ${FD}: Perfect, that’s our scope. Location is Aundh?
26 Sept, 11:20am — Neha Deshpande: Yes — Sunderban area.
26 Sept, 11:22am — ${FD}: Great — that’s in our area. Shall we set up a site visit?`,
    x: {
      client_name: 'Neha Deshpande', project_type: 'residential', scope_type: 'partial_home',
      scope_summary: 'Living room + dining area (maybe kitchen) of a 3BHK, full execution. Sent 3 photos.', scope_clarity: 'clear',
      location: 'Aundh (Sunderban), Pune', location_clarity: 'clear', in_service_area: true, criteria: crit('PPUUP'), sentiment: 'positive',
      criteria_notes: { timeline: 'No timeline given.' }, clarifying_question: 'When would you need the project complete?',
      summary: 'Neha Deshpande wants the living and dining area (maybe the kitchen) of her 3BHK in Aundh redesigned with full execution; shared 3 photos. A message sent mid-afternoon went unanswered for ~20h. Site visit being set up; timeline not captured.',
    },
    expect: { outcome: 'review', escalations: ['needs_clarification'] },
  },
  {
    ref: 'W10', channel: 'whatsapp', at: '2026-09-22 18:12', respondedAt: '2026-09-23 10:19', conf: 0.96, sourceStatus: 'closed',
    raw: `22 Sept, 6:12pm — Vivek Rao: Hi — wanted to explore options for my home. Any brochure or portfolio you can share?
23 Sept, 10:19am — ${FD}: Hi Vivek — you can see our portfolio at [website]. What kind of project are you thinking about?
23 Sept, 6:44pm — Vivek Rao: 3BHK in Hinjewadi. But we’re still early stage — just exploring.
24 Sept, 10:05am — ${FD}: No problem. When you’re ready to take it forward, feel free to call or message — happy to schedule a consultation.
[No reply]
Status: Early-stage interest, no commitment. Re-engage in 4–6 weeks.`,
    x: {
      client_name: 'Vivek Rao', project_type: 'residential', scope_type: 'full_home', scope_clarity: 'not_stated', location: 'Hinjewadi, PCMC', location_clarity: 'clear', in_service_area: true,
      criteria: crit('FPUUU'), sentiment: 'neutral', criteria_notes: { real_project: 'Said "still early stage — just exploring"; asked only for a portfolio.' },
      summary: 'Vivek Rao has a 3BHK in Hinjewadi but is only exploring and asked for a portfolio. No commitment. Nurture: re-engage in 4–6 weeks.',
    },
    expect: { outcome: 'unqualified', escalations: [] },
  },

  // ============================== WEB FORMS ==============================
  {
    ref: 'F01', channel: 'web_form', at: '2026-09-01 09:44', conf: 0.98, respondedAt: null,
    raw: `Name: Sumit Bhatt
Phone: [redacted]  Email: [redacted]
Project type: Residential — Full home
Location: Kalyani Nagar, Pune
Carpet area: ~920 sq ft (2BHK)
Current state: Moved in 8 months ago with basic furniture. Want to redo the kitchen (modular), both bedrooms (wardrobes, storage, beds), living room, and add a home office corner.
Timeline: Execution starting December, complete by February.
Budget: Prefer not to mention — will discuss at consultation
How did you find us: Instagram
Notes: Both my wife and I will be at the consultation. We’ve wanted to do this for months and are now ready to commit.`,
    x: {
      client_name: 'Sumit Bhatt', client_phone: REDACTED, client_email: REDACTED, project_type: 'residential', scope_type: 'full_home',
      scope_summary: 'Redo of a 2BHK: modular kitchen, both bedrooms (wardrobes, storage, beds), living room, plus a home-office corner.', scope_clarity: 'clear',
      location: 'Kalyani Nagar, Pune', location_clarity: 'clear', in_service_area: true, area_sqft: 920,
      timeline_text: 'Execution from December, complete by February.', weeks_to_completion: 24, criteria: crit('PPPUP'), sentiment: 'positive',
      summary: 'Sumit Bhatt (with his wife) wants a full redo of a 920 sq ft 2BHK in Kalyani Nagar plus a home-office corner; execution December–February. Chose not to state a budget. Ready to commit.',
    },
    expect: { outcome: 'qualified', escalations: [] },
  },
  {
    ref: 'F02', channel: 'web_form', at: '2026-09-04 19:12', conf: 0.97, respondedAt: null,
    raw: `Name: Laleh Contractor
Phone: [redacted]  Email: [redacted]
Project type: Residential — Partial (2 rooms)
Location: Baner, Pune
Carpet area: 1,100 sq ft (3BHK — redesigning bedroom + living room only)
Current state: Builder flat, very basic. Want to make the master bedroom and living room feel designed.
Timeline: No specific deadline — whenever we can start.
Budget: Not sure yet. Will discuss.
How did you find us: Friend’s recommendation (Priya Wadia)
Notes: First time doing interiors professionally. Looking forward to understanding the process.`,
    x: {
      client_name: 'Laleh Contractor', client_phone: REDACTED, client_email: REDACTED, project_type: 'residential', scope_type: 'partial_home',
      scope_summary: 'Master bedroom and living room of a 3BHK builder flat.', scope_clarity: 'clear',
      location: 'Baner, Pune', location_clarity: 'clear', in_service_area: true, area_sqft: 1100,
      timeline_text: 'No specific deadline — whenever we can start.', referral_source: 'Priya Wadia (friend)', criteria: crit('PPPUU'), sentiment: 'positive',
      summary: 'Laleh Contractor, first-time interiors client, wants her master bedroom and living room (3BHK, 1,100 sq ft, Baner) designed. No deadline. Referred by Priya Wadia.',
    },
    expect: { outcome: 'qualified', escalations: [] },
  },
  {
    ref: 'F03', channel: 'web_form', at: '2026-09-06 11:18', conf: 0.97, respondedAt: null,
    raw: `Name: Nilesh Dhamdhere
Phone: [redacted]  Email: [redacted]
Project type: Residential — Full home
Location: Talegaon Dabhade, near Pune
Carpet area: ~1,400 sq ft (3BHK independent house)
Current state: Just got possession. Need to do everything from scratch.
Timeline: 3–4 months, flexible.
Budget: ₹15–20 lakh for the full home.
How did you find us: Google — "interior design Pune"
Notes: I know Talegaon is a bit outside Pune — wanted to check if you can still take up the project.`,
    x: {
      client_name: 'Nilesh Dhamdhere', client_phone: REDACTED, client_email: REDACTED, project_type: 'residential', scope_type: 'full_home',
      scope_summary: 'Everything from scratch in a new 3BHK independent house.', scope_clarity: 'clear',
      location: 'Talegaon Dabhade (near Pune)', location_clarity: 'clear', in_service_area: false, area_sqft: 1400,
      timeline_text: '3–4 months, flexible.', weeks_to_completion: 14, budget_low_inr: 1_500_000, budget_high_inr: 2_000_000, budget_flexibility: 'unknown',
      criteria: crit('PFPPU'), sentiment: 'neutral', criteria_notes: { service_area: 'Talegaon Dabhade — outside Pune / PCMC (customer acknowledges this).' },
      summary: 'Nilesh Dhamdhere has a new 1,400 sq ft 3BHK independent house in Talegaon Dabhade — outside the service area, and he knows it. Volunteered ₹15–20 lakh for the full home and a 3–4 month timeline.',
    },
    expect: { outcome: 'review', escalations: ['high_value_fringe'] },
  },
  {
    ref: 'F04', channel: 'web_form', at: '2026-09-09 14:37', conf: 0.9, respondedAt: null,
    raw: `Name: Rajesh
Phone: [redacted]  Email: (not filled)
Project type: Other
Location: Pune
Carpet area: (not filled)
Current state: I want to know the cost of interior design
Timeline: as soon as possible
Budget: reasonable
How did you find us: WhatsApp forward
Notes: please call me`,
    x: {
      client_name: 'Rajesh', client_phone: REDACTED, intent: 'pricing_only', project_type: 'other', scope_clarity: 'not_stated',
      location: 'Pune', location_clarity: 'clear', timeline_text: 'As soon as possible', asked_for_pricing: true, criteria: crit('UPUUU'), sentiment: 'neutral',
      criteria_notes: { real_project: 'Only wants "the cost of interior design" — no scope given.', timeline: '"As soon as possible" is not a usable timeline.' },
      clarifying_question: 'Are you looking for a full design-and-execution project for the space, or mainly advice and ideas?',
      summary: 'Rajesh (no surname, no area, no project type) wants to know "the cost of interior design" and asks for a call. Location only "Pune". Budget "reasonable". Needs one clarifying call.',
    },
    expect: { outcome: 'review', escalations: ['needs_clarification'] },
  },
  {
    ref: 'F05', channel: 'web_form', at: '2026-09-11 10:05', conf: 0.98, respondedAt: null,
    raw: `Name: Sheena Menon (Operations Head, NovaSpark Technologies)
Phone: [redacted]  Email: [redacted]
Project type: Commercial — Office
Location: Hinjewadi Phase 1, Pune
Carpet area: ~2,200 sq ft
Current state: Shell and core — just signed the lease. Planning fitout now.
Timeline: Operational by January 15. Team of 60 will use the space.
Budget: ₹60–80 lakh all-in (including furniture)
How did you find us: Our CEO previously worked with you (Amey Joshi, Innov8 office in Baner)
Notes: Need workstations for 55, four cabins, one boardroom, two meeting rooms, a lounge, and a pantry. Speed matters. We are ready to move fast.`,
    x: {
      client_name: 'Sheena Menon (NovaSpark Technologies)', client_phone: REDACTED, client_email: REDACTED, project_type: 'commercial', scope_type: 'office',
      scope_summary: 'Fitout of a 2,200 sq ft shell-and-core office: 55 workstations, 4 cabins, boardroom, 2 meeting rooms, lounge, pantry.', scope_clarity: 'clear',
      location: 'Hinjewadi Phase 1, PCMC', location_clarity: 'clear', in_service_area: true, area_sqft: 2200,
      timeline_text: 'Operational by 15 January; team of 60.', weeks_to_completion: 18, budget_low_inr: 6_000_000, budget_high_inr: 8_000_000,
      referral_source: 'Amey Joshi (CEO of NovaSpark worked with Aangan on the Innov8 office, Baner)', criteria: crit('PPPPP'), sentiment: 'urgent',
      summary: 'NovaSpark Technologies (Ops Head Sheena Menon) just signed a lease on 2,200 sq ft in Hinjewadi Phase 1 and needs a full fitout for 60 people by 15 January. Volunteered ₹60–80 lakh all-in. Repeat-client referral via their CEO. Speed matters.',
    },
    expect: { outcome: 'qualified', escalations: [] },
  },
  {
    ref: 'F06', channel: 'web_form', at: '2026-09-14 20:52', conf: 0.98, respondedAt: null,
    raw: `Name: Preethi Nair
Phone: [redacted]  Email: [redacted]
Project type: Residential — Full home
Location: NIBM Road, Pune
Carpet area: ~1,950 sq ft (4BHK, ground floor)
Current state: Lived here 5 years. Kitchen needs full replacement, master bedroom is okay, all other bedrooms need redoing, living room needs new flooring and design, want to add a proper study.
Timeline: Planning to move out temporarily for execution — starting February 2027.
Budget: ₹35–40 lakh for the above scope. Not flexible upward.
How did you find us: Pune Mirror article (2024)
Notes: We’ve shortlisted 3 studios. We’d like the consultation to include an honest conversation about whether your aesthetic matches ours — we love warm, earthy, minimal. We’re serious about moving forward but not in a rush to decide.`,
    x: {
      client_name: 'Preethi Nair', client_phone: REDACTED, client_email: REDACTED, project_type: 'residential', scope_type: 'full_home',
      scope_summary: 'Full kitchen replacement, redo of all bedrooms except master, living-room flooring and design, new study. Owner will move out for execution.', scope_clarity: 'clear',
      location: 'NIBM Road, Pune', location_clarity: 'clear', in_service_area: true, area_sqft: 1950, style_preferences: ['warm', 'earthy', 'minimal'],
      timeline_text: 'Execution from February 2027 (moving out temporarily).', weeks_to_completion: 21, budget_low_inr: 3_500_000, budget_high_inr: 4_000_000,
      budget_flexibility: 'rigid', competitive: true, criteria: crit('PPPPP'), sentiment: 'positive',
      summary: 'Preethi Nair, 4BHK (~1,950 sq ft) on NIBM Road, wants a kitchen replacement, most bedrooms redone, new living-room flooring and a study; execution from Feb 2027. Volunteered ₹35–40 lakh and says it is not flexible upward. Has shortlisted 3 studios; style: warm, earthy, minimal. Wants an honest aesthetic-fit conversation.',
    },
    expect: { outcome: 'qualified', escalations: [] },
  },
  {
    ref: 'F07', channel: 'web_form', at: '2026-09-16 15:11', conf: 0.9, respondedAt: null,
    raw: `Name: Anonymous
Phone: (not filled)  Email: [redacted]
Project type: (not selected)
Location: Pune
Carpet area: (not filled)
Current state: (not filled)
Timeline: (not filled)
Budget: (not filled)
How did you find us: Instagram
Notes: I just wanted to know your per sq ft rate before deciding whether to enquire further. Can you email me the price list?`,
    x: {
      client_name: null, client_email: REDACTED, intent: 'pricing_only', scope_clarity: 'not_stated', location: 'Pune', location_clarity: 'clear',
      asked_for_pricing: true, criteria: crit('UPUUU'), sentiment: 'neutral',
      criteria_notes: { real_project: 'Only wants a per-sq-ft rate / price list before deciding whether to enquire.' },
      clarifying_question: 'Are you looking for a full design-and-execution project for the space, or mainly advice and ideas?',
      summary: 'Anonymous, email-only enquiry asking for a per-sq-ft rate and price list before deciding to enquire. No project details. Pricing cannot be shared; one reply asking about the project is the next step.',
    },
    expect: { outcome: 'review', escalations: ['needs_clarification'] },
  },
  {
    ref: 'F08', channel: 'web_form', at: '2026-09-18 18:44', conf: 0.97, respondedAt: null,
    raw: `Name: Divya Hegde
Phone: [redacted]  Email: [redacted]
Project type: Residential — Partial (living room + kitchen)
Location: Wakad, Pune
Carpet area: ~875 sq ft (2BHK)
Current state: We have guests arriving from the US in 3 weeks. We want to make the living room and kitchen look presentable before they arrive.
Timeline: 3 weeks maximum.
Budget: ₹4–5 lakh
How did you find us: Google
Notes: I know it’s urgent but wanted to check if you can make it work.`,
    x: {
      client_name: 'Divya Hegde', client_phone: REDACTED, client_email: REDACTED, project_type: 'residential', scope_type: 'partial_home',
      scope_summary: 'Make the living room and kitchen of a 2BHK presentable before guests arrive.', scope_clarity: 'clear',
      location: 'Wakad, Pune', location_clarity: 'clear', in_service_area: true, area_sqft: 875, timeline_text: '3 weeks maximum (guests arriving).', weeks_to_completion: 3,
      budget_low_inr: 400_000, budget_high_inr: 500_000, criteria: crit('PPFUU'), sentiment: 'urgent',
      summary: 'Divya Hegde needs her living room and kitchen (2BHK, Wakad) presentable within 3 weeks for visiting guests; volunteered ₹4–5 lakh. Aangan cannot start execution in under 6 weeks.',
    },
    expect: { outcome: 'unqualified', escalations: [] },
  },
  {
    ref: 'F09', channel: 'web_form', at: '2026-09-20 11:30', conf: 0.98, respondedAt: null,
    raw: `Name: Amol Patil
Phone: [redacted]  Email: [redacted]
Project type: Residential — Full home
Location: Kondhwa, Pune
Carpet area: 1,150 sq ft (3BHK)
Current state: Possession in August. Completely bare — builder handover.
Timeline: Move in by March 2027.
Budget: Will discuss at consultation.
How did you find us: Referred by builder (Rohan Lifescapes)
Notes: Ready to book a consultation at your earliest availability.`,
    x: {
      client_name: 'Amol Patil', client_phone: REDACTED, client_email: REDACTED, project_type: 'residential', scope_type: 'full_home',
      scope_summary: 'Full home design for a bare 3BHK builder handover.', scope_clarity: 'clear',
      location: 'Kondhwa, Pune', location_clarity: 'clear', in_service_area: true, area_sqft: 1150, timeline_text: 'Move in by March 2027.', weeks_to_completion: 24,
      referral_source: 'Rohan Lifescapes (builder)', criteria: crit('PPPUU'), sentiment: 'positive',
      summary: 'Amol Patil has a bare 1,150 sq ft 3BHK in Kondhwa (builder handover) and wants full design, moving in by March 2027. Referred by builder Rohan Lifescapes. Ready to book at the earliest.',
    },
    expect: { outcome: 'qualified', escalations: [] },
  },
  {
    ref: 'F10', channel: 'web_form', at: '2026-09-26 16:22', conf: 0.98, respondedAt: null,
    raw: `Name: Siddharth Gupta
Phone: [redacted]  Email: [redacted]
Project type: Residential — Full home + home office
Location: Aundh, Pune
Carpet area: ~1,300 sq ft (3BHK)
Current state: Moved in 6 months ago, using builder furniture. Both my wife and I work from home full-time and need a dedicated workspace for each of us, plus a proper design for the rest of the flat.
Timeline: Ready to start immediately. Design process can begin this month.
Budget: ₹18–22 lakh for the full scope.
How did you find us: LinkedIn
Notes: We’re both product designers by profession, so we’ll be opinionated. We want a collaborative process — not a studio that presents us with one option and calls it done.`,
    x: {
      client_name: 'Siddharth Gupta', client_phone: REDACTED, client_email: REDACTED, project_type: 'residential', scope_type: 'full_home',
      scope_summary: 'Full redesign of a 3BHK plus two dedicated home-office workspaces.', scope_clarity: 'clear',
      location: 'Aundh, Pune', location_clarity: 'clear', in_service_area: true, area_sqft: 1300, timeline_text: 'Ready to start immediately; design can begin this month.',
      budget_low_inr: 1_800_000, budget_high_inr: 2_200_000, budget_flexibility: 'unknown', criteria: crit('PPPPP'), sentiment: 'positive',
      summary: 'Siddharth Gupta (with wife; both product designers) wants a 1,300 sq ft 3BHK in Aundh redesigned with two dedicated home offices; ready to start now. Volunteered ₹18–22 lakh. Expect an opinionated, collaborative client — wants options, not a single concept.',
    },
    expect: { outcome: 'qualified', escalations: [] },
  },
];

export function toExtraction(r: RealRecord): Extraction {
  return blankExtraction({ transcription_confidence: r.conf, ...r.x });
}
