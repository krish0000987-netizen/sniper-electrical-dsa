-- ============================================================================
-- SNIPER × Digitap — Provider Hub (hybrid persistence layer)
-- ----------------------------------------------------------------------------
-- The CRM core keeps its primary Postgres (DATABASE_URL). These tables store
-- integration & compliance data that must survive serverless cold starts:
-- adapter state, provider request audit, consent, verification results and
-- credit pulls.
--
-- SECURITY: every table has RLS ENABLED and NO anon/authenticated policies,
-- so the public PostgREST role can never read or write them. Only the Supabase
-- service_role (BYPASSRLS) reaches these rows — the service key is held in the
-- SNIPER backend env, never in the browser.
--
-- Apply with:  psql "$DATABASE_URL" -f supabase/migrations/0001_provider_hub.sql
-- (or paste into the Supabase SQL editor).
-- ============================================================================

create table if not exists public.integration_state (
  tenant_id         integer not null,
  code              text    not null,
  suite             text,
  product           text,
  environment       text,
  mode              text    not null default 'mock',      -- mock | live
  effective_status  text    not null default 'sandbox',
  last_test_ok      boolean,
  last_test_message text,
  updated_at        timestamptz not null default now(),
  primary key (tenant_id, code)
);

create table if not exists public.provider_requests (
  id                  bigserial primary key,
  tenant_id           integer not null,
  customer_id         integer,
  application_id      integer,
  user_id             integer,
  adapter             text not null,
  endpoint            text,
  request_ref         text,
  provider_request_id text,
  status              text not null,          -- started | success | failed | sandbox
  error_code          text,
  latency_ms          integer,
  created_at          timestamptz not null default now()
);
create index if not exists idx_provider_requests_tenant on public.provider_requests (tenant_id, created_at desc);

create table if not exists public.consent_records (
  id              bigserial primary key,
  tenant_id       integer not null,
  customer_id     integer,
  purpose         text not null,
  consent_version text not null default '1.0',
  status          text not null default 'active',   -- active | withdrawn | expired
  captured_by     integer,
  channel         text,
  payload         jsonb not null default '{}',
  obtained_at     timestamptz not null default now()
);
create index if not exists idx_consent_records_tenant on public.consent_records (tenant_id, obtained_at desc);

create table if not exists public.verification_results (
  id                  bigserial primary key,
  tenant_id           integer not null,
  customer_id         integer,
  application_id      integer,
  adapter             text not null,
  provider            text not null,
  status              text not null,          -- verified | invalid | failed | sandbox
  result              jsonb not null default '{}',   -- normalized, masked, purpose-limited
  provider_request_id text,
  fetched_at          timestamptz not null default now()
);
create index if not exists idx_verification_results_tenant on public.verification_results (tenant_id, fetched_at desc);

create table if not exists public.credit_pulls (
  id              bigserial primary key,
  tenant_id       integer not null,
  customer_id     integer,
  application_id  integer,
  provider        text not null,
  score           integer,
  score_band      text,
  report_available boolean not null default false,
  report_ref      text,
  fetched_at      timestamptz not null default now()
);
create index if not exists idx_credit_pulls_tenant on public.credit_pulls (tenant_id, fetched_at desc);

-- No anon/authenticated policies on any of the above: deny-by-default.
alter table public.integration_state    enable row level security;
alter table public.provider_requests    enable row level security;
alter table public.consent_records      enable row level security;
alter table public.verification_results enable row level security;
alter table public.credit_pulls         enable row level security;
