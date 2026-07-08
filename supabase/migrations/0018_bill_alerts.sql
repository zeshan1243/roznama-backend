-- Electricity bill alerts.
-- Users save a connection (DISCO + reference/customer-id); a backend job polls
-- the PITC portal and pushes a notification when a new monthly bill appears.
-- Both tables are user-owned and RLS-protected; the Node backend reads them with
-- the service role and additionally scopes by user_id (defence in depth).

-- ----------------------------------------------------------------------------
-- Saved connections to watch.
-- ----------------------------------------------------------------------------
create table if not exists public.electricity_connections (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid        not null references auth.users (id) on delete cascade,
  disco               text        not null,                     -- PITC portal segment, e.g. 'iescobill'
  reference           text        not null,                     -- reference no. or customer id (digits only)
  search_by           text        not null default 'refno' check (search_by in ('refno','appno')),
  nickname            text,
  notify              boolean     not null default true,
  last_bill_month     text,                                     -- last seen, e.g. 'JUN 26'
  last_notified_month text,                                     -- dedup: month we last pushed for
  last_amount         numeric,
  last_due_date       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (user_id, disco, reference)
);
create index if not exists elec_conn_user_idx on public.electricity_connections (user_id);

-- ----------------------------------------------------------------------------
-- FCM device tokens (a user may have several devices).
-- ----------------------------------------------------------------------------
create table if not exists public.push_tokens (
  token       text        primary key,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  platform    text,                                             -- 'android' | 'ios'
  updated_at  timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on public.push_tokens (user_id);

-- ----------------------------------------------------------------------------
-- RLS — owner-only.
-- ----------------------------------------------------------------------------
alter table public.electricity_connections enable row level security;
drop policy if exists elec_conn_rw on public.electricity_connections;
create policy elec_conn_rw on public.electricity_connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.push_tokens enable row level security;
drop policy if exists push_tokens_rw on public.push_tokens;
create policy push_tokens_rw on public.push_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
