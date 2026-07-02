-- Backend-hosted reference content (Quran ayahs, hadith, duas, 99 Names, ...),
-- so it can be updated without an app release. Each row holds the exact JSON
-- blob the app already bundles, keyed by content name (e.g. 'hadith', 'duas',
-- 'asma', 'quran'). Public read-only; only the service role (seed) writes.
-- The app falls back to its bundled asset when offline or a key is missing.

create table if not exists public.app_content (
  key        text        primary key,
  data       jsonb       not null,
  updated_at timestamptz not null default now()
);

alter table public.app_content enable row level security;
drop policy if exists app_content_read on public.app_content;
create policy app_content_read on public.app_content
  for select using (true);

drop trigger if exists app_content_touch on public.app_content;
create trigger app_content_touch before update on public.app_content
  for each row execute function public.touch_updated_at();
