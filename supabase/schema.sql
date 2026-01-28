-- ColdFlow CRM - Supabase schema

create extension if not exists pgcrypto;

create table if not exists public.leads (
  id text primary key,
  updated_at bigint not null,
  deleted_at bigint,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists leads_updated_at_idx on public.leads (updated_at);

alter table public.leads enable row level security;

-- Allowlist by email (adjust as needed)
drop policy if exists "leads_select_allowlist" on public.leads;
create policy "leads_select_allowlist"
  on public.leads
  for select
  using ((auth.jwt()->>'email') in ('brunokalebe@gmail.com', 'bruno@belegante.co'));

drop policy if exists "leads_insert_allowlist" on public.leads;
create policy "leads_insert_allowlist"
  on public.leads
  for insert
  with check ((auth.jwt()->>'email') in ('brunokalebe@gmail.com', 'bruno@belegante.co'));

drop policy if exists "leads_update_allowlist" on public.leads;
create policy "leads_update_allowlist"
  on public.leads
  for update
  using ((auth.jwt()->>'email') in ('brunokalebe@gmail.com', 'bruno@belegante.co'))
  with check ((auth.jwt()->>'email') in ('brunokalebe@gmail.com', 'bruno@belegante.co'));

-- Daily dashboard snapshots (historical stats)
create table if not exists public.stats_daily (
  day date primary key,
  total_pipeline double precision not null default 0,
  forecast_hot double precision not null default 0,
  revenue_realized double precision not null default 0,
  paid_entry double precision not null default 0,
  paid_full double precision not null default 0,
  total_ticket_value double precision not null default 0,
  total_ticket_count integer not null default 0,
  total_leads integer not null default 0,
  hot_leads integer not null default 0,
  decisor_frio integer not null default 0,
  propostas_enviadas integer not null default 0,
  reunioes_agendadas integer not null default 0,
  pagamentos_feitos integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.stats_daily enable row level security;

drop policy if exists "stats_daily_select_allowlist" on public.stats_daily;
create policy "stats_daily_select_allowlist"
  on public.stats_daily
  for select
  using ((auth.jwt()->>'email') in ('brunokalebe@gmail.com', 'bruno@belegante.co'));

drop policy if exists "stats_daily_insert_allowlist" on public.stats_daily;
create policy "stats_daily_insert_allowlist"
  on public.stats_daily
  for insert
  with check ((auth.jwt()->>'email') in ('brunokalebe@gmail.com', 'bruno@belegante.co'));

drop policy if exists "stats_daily_update_allowlist" on public.stats_daily;
create policy "stats_daily_update_allowlist"
  on public.stats_daily
  for update
  using ((auth.jwt()->>'email') in ('brunokalebe@gmail.com', 'bruno@belegante.co'))
  with check ((auth.jwt()->>'email') in ('brunokalebe@gmail.com', 'bruno@belegante.co'));

-- Lead activity tracking (simple analytics)
create table if not exists public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null,
  event_type text not null,
  occurred_at timestamptz not null default now(),
  old_status text,
  new_status text,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists lead_events_occurred_at_idx on public.lead_events (occurred_at desc);
create index if not exists lead_events_lead_id_idx on public.lead_events (lead_id);
create index if not exists lead_events_type_idx on public.lead_events (event_type);

alter table public.lead_events enable row level security;

drop policy if exists "lead_events_select_allowlist" on public.lead_events;
create policy "lead_events_select_allowlist"
  on public.lead_events
  for select
  using ((auth.jwt()->>'email') in ('brunokalebe@gmail.com', 'bruno@belegante.co'));

drop policy if exists "lead_events_insert_allowlist" on public.lead_events;
create policy "lead_events_insert_allowlist"
  on public.lead_events
  for insert
  with check ((auth.jwt()->>'email') in ('brunokalebe@gmail.com', 'bruno@belegante.co'));

-- Tracker daily (helper suggestions)
create table if not exists public.tracker_daily (
  day date primary key,
  contacts_count integer not null default 0,
  callbacks_count integer not null default 0,
  meetings_count integer not null default 0,
  proposals_count integer not null default 0,
  payments_count integer not null default 0,
  next_contacts_count integer not null default 0,
  best_contact_hour integer,
  best_contact_count double precision not null default 0,
  avg_followup_gap_days double precision not null default 0,
  followup_gap_samples integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.tracker_daily enable row level security;

drop policy if exists "tracker_daily_select_allowlist" on public.tracker_daily;
create policy "tracker_daily_select_allowlist"
  on public.tracker_daily
  for select
  using ((auth.jwt()->>'email') in ('brunokalebe@gmail.com', 'bruno@belegante.co'));

drop policy if exists "tracker_daily_insert_allowlist" on public.tracker_daily;
create policy "tracker_daily_insert_allowlist"
  on public.tracker_daily
  for insert
  with check ((auth.jwt()->>'email') in ('brunokalebe@gmail.com', 'bruno@belegante.co'));

drop policy if exists "tracker_daily_update_allowlist" on public.tracker_daily;
create policy "tracker_daily_update_allowlist"
  on public.tracker_daily
  for update
  using ((auth.jwt()->>'email') in ('brunokalebe@gmail.com', 'bruno@belegante.co'))
  with check ((auth.jwt()->>'email') in ('brunokalebe@gmail.com', 'bruno@belegante.co'));

-- RPC: apply lead merge (server-side dedupe)
create or replace function public.apply_lead_merge(
  primary_id text,
  merged_payload jsonb,
  duplicate_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := auth.jwt() ->> 'email';
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
  v_updated int;
  v_deleted int;
begin
  if v_email not in ('brunokalebe@gmail.com', 'bruno@belegante.co') then
    raise exception 'not allowed';
  end if;

  update public.leads
  set updated_at = v_now,
      deleted_at = null,
      payload = merged_payload
  where id = primary_id;
  get diagnostics v_updated = row_count;

  update public.leads
  set updated_at = v_now,
      deleted_at = v_now
  where id = any(duplicate_ids)
    and id <> primary_id;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('updated', v_updated, 'deleted', v_deleted);
end;
$$;

grant execute on function public.apply_lead_merge(text, jsonb, text[]) to anon, authenticated;
