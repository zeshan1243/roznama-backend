-- Full hadith corpus stored in our DB (immutable reference data), imported once
-- from Fawaz Ahmed's Hadith API via `npm run seed:hadith`. The app reads these
-- tables directly (public read), so it never depends on the upstream CDN or the
-- Node backend at runtime.
--
--   hadith_books     — the 10 collections (display order)
--   hadith_editions  — each language edition of a book (e.g. 'urd-bukhari')
--   hadith_sections  — chapters per edition (name + hadith range)
--   hadiths          — every hadith, one row per edition + hadith number

create table if not exists public.hadith_books (
  key        text primary key,
  name       text not null,
  sort_order int  not null default 99
);

create table if not exists public.hadith_editions (
  edition    text primary key,           -- e.g. 'urd-bukhari'
  collection text not null references public.hadith_books (key) on delete cascade,
  language   text not null
);
create index if not exists hadith_editions_collection_idx
  on public.hadith_editions (collection);

create table if not exists public.hadith_sections (
  edition text not null,
  num     int  not null,
  name    text not null default '',
  first   int,
  last    int,
  primary key (edition, num)
);

create table if not exists public.hadiths (
  edition       text not null,
  hadith_number int  not null,
  arabic_number int,
  section       int,
  text          text not null,
  book          int,
  hadith        int,
  grade         text,
  primary key (edition, hadith_number)
);
create index if not exists hadiths_edition_section_idx
  on public.hadiths (edition, section);

-- Public, read-only (reference content, not user data).
do $$
declare t text;
begin
  foreach t in array array['hadith_books','hadith_editions','hadith_sections','hadiths'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I_read on public.%I;', t, t);
    execute format('create policy %I_read on public.%I for select using (true);', t, t);
  end loop;
end $$;
