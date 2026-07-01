-- Row Level Security policies.
-- Enables RLS on every user-owned table and restricts access to the row owner.
-- Reference tables are readable by anyone (including anon) but not writable.

-- Helper macro pattern repeated per table (Postgres has no macros, so explicit).

-- profiles
alter table public.profiles enable row level security;
drop policy if exists profiles_rw on public.profiles;
create policy profiles_rw on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- bills
alter table public.bills enable row level security;
drop policy if exists bills_rw on public.bills;
create policy bills_rw on public.bills
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- zakat_records
alter table public.zakat_records enable row level security;
drop policy if exists zakat_rw on public.zakat_records;
create policy zakat_rw on public.zakat_records
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- tasbih_state
alter table public.tasbih_state enable row level security;
drop policy if exists tasbih_rw on public.tasbih_state;
create policy tasbih_rw on public.tasbih_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- bookmarks
alter table public.bookmarks enable row level security;
drop policy if exists bookmarks_rw on public.bookmarks;
create policy bookmarks_rw on public.bookmarks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- news_prefs
alter table public.news_prefs enable row level security;
drop policy if exists news_prefs_rw on public.news_prefs;
create policy news_prefs_rw on public.news_prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- loadshedding_presets
alter table public.loadshedding_presets enable row level security;
drop policy if exists ls_presets_rw on public.loadshedding_presets;
create policy ls_presets_rw on public.loadshedding_presets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- fx_alerts
alter table public.fx_alerts enable row level security;
drop policy if exists fx_alerts_rw on public.fx_alerts;
create policy fx_alerts_rw on public.fx_alerts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Reference tables: public read-only.
do $$
declare t text;
begin
  foreach t in array array[
    'ref_trains','ref_duas','ref_hadith','ref_quran',
    'ref_emergency','ref_packages','ref_loadshedding','ref_nss'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I_read on public.%I;', t, t);
    execute format('create policy %I_read on public.%I for select using (true);', t, t);
  end loop;
end $$;
