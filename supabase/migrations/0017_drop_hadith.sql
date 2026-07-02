-- Reclaim free-tier space: the app now reads hadith collections via the backend
-- URL proxy (Approach A, see docs/HADITH.md), not from the DB. Drop the imported
-- corpus. To go back to the DB approach, re-apply 0015 + 0016 and run
-- `npm run seed:hadith`.

drop table if exists public.hadiths;
drop table if exists public.hadith_sections;
drop table if exists public.hadith_editions;
drop table if exists public.hadith_books;
