-- ============================================================================
-- Aangan Studio — Founder Dashboard schema
-- Run in the Supabase SQL editor (or `supabase db push`). Safe to re-run:
-- every object is created with IF NOT EXISTS / OR REPLACE.
--
-- Access model: the dashboard and ingest routes talk to Postgres ONLY through
-- the service-role key on the server. RLS is enabled on every table with NO
-- policies, so the public anon key can read/write nothing.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- designers — directory used for handoff assignment and the client-facing email
-- (name / phone / email of the person the enquirer will hear from)
-- ---------------------------------------------------------------------------
create table if not exists public.designers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text,
  phone       text,
  role        text not null default 'designer' check (role in ('designer','senior_designer','principal')),
  active      boolean not null default true,
  is_sample   boolean not null default false,          -- placeholder rows created by the seed script
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- enquiries — one row per prospect conversation (call / WhatsApp thread / form)
-- ---------------------------------------------------------------------------
create table if not exists public.enquiries (
  id                      uuid primary key default gen_random_uuid(),
  source_ref              text unique,                 -- e.g. 'T01' in the Sept-2026 export; makes seeding idempotent
  channel                 text not null check (channel in ('phone','whatsapp','web_form')),
  received_at             timestamptz not null,
  after_hours             boolean not null default false,   -- received outside front-desk hours
  call_outcome            text check (call_outcome in ('answered','missed','dropped')),
  call_duration_seconds   integer,

  -- Response-time tracking (the <1h vs >48h metric)
  first_response_at       timestamptz,                 -- first successful human contact; null = none recorded
  response_note           text,

  -- Who / what (AI-extracted, then human-verifiable)
  client_name             text,
  client_phone            text,
  client_email            text,
  intent                  text not null default 'new_project'
                          check (intent in ('new_project','advice_only','pricing_only','existing_client_complaint',
                                            'follow_up_chase','vendor','job_seeker','spam','wrong_number','other')),
  project_type            text check (project_type in ('residential','commercial','other')),
  scope_type              text check (scope_type in ('full_home','partial_home','single_room','office','other')),
  scope_summary           text,
  location                text,
  in_service_area         boolean,                     -- null = unknown
  area_sqft               integer,                     -- carpet area
  style_preferences       text[] not null default '{}',
  timeline_text           text,
  weeks_to_completion     integer,                     -- weeks from enquiry until the client needs it done; null = not stated
  budget_low_inr          bigint,                      -- ONLY if the client volunteered it. Never asked for.
  budget_high_inr         bigint,
  budget_flexibility      text check (budget_flexibility in ('rigid','flexible','unknown')),
  referral_source         text,
  summary                 text,                        -- AI-synthesised brief (prevents the "blind forward")
  sentiment               text check (sentiment in ('positive','neutral','frustrated','urgent')),

  -- Nikhil's five-criteria rubric: { real_project, service_area, timeline, budget, decision_maker }
  -- each one of 'pass' | 'unclear' | 'fail'
  criteria                jsonb not null default '{}'::jsonb,
  open_questions          text[] not null default '{}',
  priority_flags          text[] not null default '{}',  -- founder_connection | referral | large_project | asked_pricing | competitive

  -- Confidence (see lib/guardrails.ts for how "composite" is derived)
  transcription_confidence numeric(4,3),
  composite_confidence     numeric(4,3),

  -- Qualification: AI decision vs. final human decision (for FP / FN override rates)
  ai_qualification        text not null default 'review'
                          check (ai_qualification in ('qualified','unqualified','review','not_applicable')),
  qualification_reasons   text[] not null default '{}',
  final_qualification     text check (final_qualification in ('qualified','unqualified')),
  final_decided_by        text,
  final_decided_at        timestamptz,
  override_note           text,

  -- Pipeline
  status                  text not null default 'new'
                          check (status in ('new','escalated','handed_off','won','lost','closed')),
  designer_id             uuid references public.designers(id) on delete set null,
  designer_name           text,
  handoff_status         text not null default 'not_sent'
                          check (handoff_status in ('not_sent','sent','accepted','declined')),
  handoff_sent_at         timestamptz,
  handoff_accepted_at     timestamptz,
  designer_reasked        boolean not null default false,  -- designer had to re-ask basics = failed handoff
  estimated_value_inr     bigint,                      -- internal pipeline estimate (never shown to clients)
  final_value_inr         bigint,                      -- signed project value when won
  closed_reason           text,

  -- HubSpot CRM sync (lib/hubspot.ts). No transcripts are ever sent to HubSpot.
  hubspot_contact_id      text,
  hubspot_deal_id         text,
  hubspot_synced_at       timestamptz,
  hubspot_error           text,

  is_synthetic            boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists enquiries_received_idx   on public.enquiries (received_at desc);
create index if not exists enquiries_status_idx     on public.enquiries (status);
create index if not exists enquiries_channel_idx    on public.enquiries (channel);

-- ---------------------------------------------------------------------------
-- transcripts — raw STT, cleaned text, per-field confidence, full extraction
-- ---------------------------------------------------------------------------
create table if not exists public.transcripts (
  id                       uuid primary key default gen_random_uuid(),
  enquiry_id               uuid not null references public.enquiries(id) on delete cascade,
  source                   text not null check (source in ('audio','text','form')),
  audio_url                text,                        -- reference to the telephony provider's recording
  raw_text                 text not null,               -- verbatim STT / message text
  processed_text           text,                        -- cleaned, speaker-labelled, normalised
  language                 text,
  duration_seconds         integer,
  transcription_confidence numeric(4,3),
  field_confidence         jsonb not null default '{}'::jsonb,
  ambiguity_flags          text[] not null default '{}',
  extraction               jsonb,                       -- full structured JSON returned by Gemini
  model                    text,
  input_tokens             integer,
  output_tokens            integer,
  ai_cost_inr              numeric(10,4) not null default 0,
  created_at               timestamptz not null default now()
);

create index if not exists transcripts_enquiry_idx on public.transcripts (enquiry_id);

-- ---------------------------------------------------------------------------
-- escalations — every guardrail trip, who owns it, how it was resolved
-- ---------------------------------------------------------------------------
create table if not exists public.escalations (
  id                uuid primary key default gen_random_uuid(),
  enquiry_id        uuid not null references public.enquiries(id) on delete cascade,
  kind              text not null check (kind in ('transcription','lead_qualification','pricing','service_recovery')),
  trigger           text not null check (trigger in (
                      'low_confidence','ambiguous_scope','ambiguous_location','ai_failure',            -- transcription
                      'needs_clarification','high_value_fringe','audit_sample',                        -- lead_qualification
                      'budget_below_minimum','custom_work','agent_policy_breach',                      -- pricing
                      'existing_client_complaint','response_sla_breach','missed_call')),               -- service_recovery
  severity          text not null default 'medium' check (severity in ('low','medium','high','critical')),
  assigned_to       text not null check (assigned_to in ('front_desk','founder','senior_designer')),
  status            text not null default 'open' check (status in ('open','acknowledged','resolved')),
  reason            text not null,
  detail            jsonb not null default '{}'::jsonb,
  suggested_question text,                               -- the ONE direct question to ask (never about budget)
  notified_via      text[] not null default '{}',

  created_at        timestamptz not null default now(),
  acknowledged_at   timestamptz,
  resolved_at       timestamptz,
  resolved_by       text,
  resolution        text check (resolution in ('qualified','unqualified','approved_ai','dismissed')),
  resolution_note   text
);

create index if not exists escalations_status_idx  on public.escalations (status, created_at desc);
create index if not exists escalations_enquiry_idx on public.escalations (enquiry_id);

-- ---------------------------------------------------------------------------
-- pricing_logs — INTERNAL indicative estimates. Nothing here is ever quoted
-- to a client (see lib/pricing.ts: client-facing reply is a fixed deflection).
-- ---------------------------------------------------------------------------
create table if not exists public.pricing_logs (
  id                    uuid primary key default gen_random_uuid(),
  enquiry_id            uuid not null references public.enquiries(id) on delete cascade,
  segment               text not null check (segment in ('residential','commercial','single_room','unknown')),
  area_sqft             integer,
  rate_low_per_sqft     integer,
  rate_high_per_sqft    integer,
  indicative_low_inr    bigint,                          -- internal only
  indicative_high_inr   bigint,
  pipeline_estimate_inr bigint,                          -- value used in pipeline totals
  budget_low_inr        bigint,
  budget_high_inr       bigint,
  budget_flag           text not null default 'not_stated'
                        check (budget_flag in ('not_stated','within_range','below_range','below_minimum','above_range')),
  anchor_risk           boolean not null default false,  -- stated budget sits below the indicative band
  custom_work_flags     text[] not null default '{}',
  requires_review       boolean not null default false,
  client_facing_response text not null,                  -- the deflection used; contains no numbers
  formal_estimate_inr   bigint,                          -- set by the designer after consultation
  formal_estimate_at    timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists pricing_logs_enquiry_idx on public.pricing_logs (enquiry_id);

-- ---------------------------------------------------------------------------
-- tool_costs — fixed monthly cost of running this system (variable Gemini
-- cost is summed from transcripts.ai_cost_inr)
-- ---------------------------------------------------------------------------
create table if not exists public.tool_costs (
  id          uuid primary key default gen_random_uuid(),
  month       date not null,                             -- first day of the month
  category    text not null,
  vendor      text,
  amount_inr  numeric(12,2) not null,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists tool_costs_month_idx on public.tool_costs (month);

-- ---------------------------------------------------------------------------
-- outbound_emails — every email sent (or drafted / dry-run) TO an enquirer.
-- Audit trail: what we told the client, who sent it, when, and the callback we promised.
-- ---------------------------------------------------------------------------
create table if not exists public.outbound_emails (
  id            uuid primary key default gen_random_uuid(),
  enquiry_id    uuid not null references public.enquiries(id) on delete cascade,
  template      text not null check (template in ('confirmation','clarification','decline')),
  to_email      text not null,
  subject       text not null,
  body_text     text not null,
  body_html     text not null,
  designer_id   uuid references public.designers(id) on delete set null,
  callback_at   timestamptz,                             -- the time we promised to get back by
  status        text not null check (status in ('sent','failed','dry_run')),
  provider_id   text,
  error         text,
  sent_by       text,
  created_at    timestamptz not null default now()
);

create index if not exists outbound_emails_enquiry_idx on public.outbound_emails (enquiry_id, created_at desc);

-- ---------------------------------------------------------------------------
-- consultations — the calendar. One row per booked consultation / site visit.
-- Mirrored to Google Calendar when configured (lib/calendar.ts); always available as an .ics file.
-- ---------------------------------------------------------------------------
create table if not exists public.consultations (
  id               uuid primary key default gen_random_uuid(),
  enquiry_id       uuid not null references public.enquiries(id) on delete cascade,
  designer_id      uuid references public.designers(id) on delete set null,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  mode             text not null default 'site_visit' check (mode in ('site_visit','studio','call')),
  location         text,
  status           text not null default 'scheduled' check (status in ('scheduled','completed','cancelled','no_show')),
  notes            text,
  google_event_id  text,
  ics_uid          text not null default gen_random_uuid()::text,
  created_by       text,
  created_at       timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists consultations_start_idx    on public.consultations (starts_at);
create index if not exists consultations_designer_idx on public.consultations (designer_id, starts_at);
create index if not exists consultations_enquiry_idx  on public.consultations (enquiry_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists enquiries_touch on public.enquiries;
create trigger enquiries_touch before update on public.enquiries
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: enabled, no policies => anon/authenticated roles get nothing.
-- The service-role key bypasses RLS and is used only server-side.
-- ---------------------------------------------------------------------------
alter table public.enquiries   enable row level security;
alter table public.transcripts enable row level security;
alter table public.escalations enable row level security;
alter table public.pricing_logs enable row level security;
alter table public.tool_costs  enable row level security;
alter table public.designers   enable row level security;
alter table public.outbound_emails enable row level security;
alter table public.consultations enable row level security;
