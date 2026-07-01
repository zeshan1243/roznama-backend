-- Roznama web app — initial schema.
-- Run with the Supabase SQL editor or `supabase db push`.
-- Every user-owned table is protected by Row Level Security so a user can only
-- ever read/write their own rows. The Node backend uses the service role and
-- additionally scopes every query by user_id (defence in depth).

-- ----------------------------------------------------------------------------
-- Profiles (settings) — 1:1 with auth.users
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text,
  city          text        not null default 'lhr',
  locale        text        not null default 'en',      -- 'en' | 'ur'
  theme         text        not null default 'system',  -- 'light' | 'dark' | 'system'
  hijri_offset  int         not null default 0,         -- -1 | 0 | 1
  onboarded     boolean     not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Bills
-- ----------------------------------------------------------------------------
create table if not exists public.bills (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users (id) on delete cascade,
  name          text        not null,
  due_day       int         not null check (due_day between 1 and 28),
  amount        numeric,
  notify_hour   int         not null default 9  check (notify_hour between 0 and 23),
  notify_minute int         not null default 0  check (notify_minute between 0 and 59),
  created_at    timestamptz not null default now()
);
create index if not exists bills_user_idx on public.bills (user_id);

-- ----------------------------------------------------------------------------
-- Zakat history (last ~24 kept client/query side)
-- ----------------------------------------------------------------------------
create table if not exists public.zakat_records (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid        not null references auth.users (id) on delete cascade,
  saved_at              timestamptz not null default now(),
  total_assets_pkr      numeric     not null,
  total_liabilities_pkr numeric     not null,
  nisab_pkr             numeric     not null,
  zakat_payable_pkr     numeric     not null,
  breakdown             jsonb
);
create index if not exists zakat_user_idx on public.zakat_records (user_id);

-- ----------------------------------------------------------------------------
-- Tasbih counter state — 1:1 with user
-- ----------------------------------------------------------------------------
create table if not exists public.tasbih_state (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  lifetime_count bigint  not null default 0,
  loops          bigint  not null default 0,
  target         int     not null default 33,
  updated_at     timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- News bookmarks
-- ----------------------------------------------------------------------------
create table if not exists public.bookmarks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users (id) on delete cascade,
  link          text        not null,
  title         text,
  source        text,
  image_url     text,
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (user_id, link)
);
create index if not exists bookmarks_user_idx on public.bookmarks (user_id);

-- ----------------------------------------------------------------------------
-- News preferences — 1:1 with user
-- ----------------------------------------------------------------------------
create table if not exists public.news_prefs (
  user_id               uuid primary key references auth.users (id) on delete cascade,
  subscribed_categories text[] not null default '{}',
  disabled_sources      text[] not null default '{}',
  updated_at            timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Loadshedding presets (up to a handful per user, enforced client-side)
-- ----------------------------------------------------------------------------
create table if not exists public.loadshedding_presets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  disco      text        not null,
  area       text        not null,
  label      text,
  created_at timestamptz not null default now()
);
create index if not exists ls_presets_user_idx on public.loadshedding_presets (user_id);

-- ----------------------------------------------------------------------------
-- FX threshold alerts
-- ----------------------------------------------------------------------------
create table if not exists public.fx_alerts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  pair       text        not null default 'USD',   -- vs PKR
  direction  text        not null check (direction in ('above', 'below')),
  threshold  numeric     not null,
  created_at timestamptz not null default now()
);
create index if not exists fx_alerts_user_idx on public.fx_alerts (user_id);

-- ----------------------------------------------------------------------------
-- Reference tables (public read). Seeded from web/backend/data/*.json via
-- `npm run seed`. Used by the DB requirement + future admin editing; the API
-- currently serves reference data from bundled JSON for resilience.
-- ----------------------------------------------------------------------------
create table if not exists public.ref_trains (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  number     text,
  class      text,
  days       text,
  stops      jsonb
);
create table if not exists public.ref_duas (
  id       uuid primary key default gen_random_uuid(),
  category text not null,
  title_en text,
  title_ur text,
  entries  jsonb
);
create table if not exists public.ref_hadith (
  id  uuid primary key default gen_random_uuid(),
  ar  text, en text, ur text, ref text, ord int
);
create table if not exists public.ref_quran (
  id  uuid primary key default gen_random_uuid(),
  ar  text, en text, ur text, ref text, ord int
);
create table if not exists public.ref_emergency (
  id       uuid primary key default gen_random_uuid(),
  group_key text, label_en text, label_ur text, items jsonb
);
create table if not exists public.ref_packages (
  id       uuid primary key default gen_random_uuid(),
  operator text, color text, packages jsonb
);
create table if not exists public.ref_loadshedding (
  id       uuid primary key default gen_random_uuid(),
  disco    text, name_en text, name_ur text, areas jsonb
);
create table if not exists public.ref_nss (
  id uuid primary key default gen_random_uuid(),
  code text, name_en text, name_ur text, tenor text,
  profit_pct numeric, payout text, min_invest numeric, notes_en text
);

-- ----------------------------------------------------------------------------
-- updated_at trigger
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists tasbih_touch on public.tasbih_state;
create trigger tasbih_touch before update on public.tasbih_state
  for each row execute function public.touch_updated_at();

drop trigger if exists news_prefs_touch on public.news_prefs;
create trigger news_prefs_touch before update on public.news_prefs
  for each row execute function public.touch_updated_at();
