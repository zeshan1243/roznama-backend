-- Feed snapshots: the backend scrapers/fetchers write the latest payload here,
-- and the API reads from here. One row per feed key (e.g. 'currency',
-- 'weather:lhr', 'fxhistory:d30'). RLS is enabled with NO policy, so only the
-- service role (the backend) can read/write — clients go through the API.

create table if not exists public.feed_snapshots (
  key         text primary key,
  data        jsonb       not null,
  fetched_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.feed_snapshots enable row level security;
-- (no policy → anon/authed clients cannot touch it; service role bypasses RLS)

-- USD/PKR daily history, self-populated from each currency scrape (ECB-based
-- sources don't carry PKR, so we accumulate our own series over time).
create table if not exists public.fx_history (
  day        date primary key,
  usd_pkr    numeric     not null,
  updated_at timestamptz not null default now()
);
alter table public.fx_history enable row level security;
-- service-role only (served through the API)
