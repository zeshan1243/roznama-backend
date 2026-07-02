-- Some hadith numbers are fractional (sub-narrations, e.g. 402.2), so the
-- number columns must be numeric, not integer. (Chapter/section numbers stay
-- integer.) Safe to run after 0015 whether or not data was partially imported.

alter table public.hadiths
  alter column hadith_number type numeric using hadith_number::numeric,
  alter column arabic_number type numeric using arabic_number::numeric,
  alter column hadith        type numeric using hadith::numeric;

alter table public.hadith_sections
  alter column first type numeric using first::numeric,
  alter column last  type numeric using last::numeric;
