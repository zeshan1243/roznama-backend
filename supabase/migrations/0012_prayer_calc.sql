-- Per-user prayer-time calculation preferences, so a user's method/fiqh choice
-- follows their account. Synced from the mobile app alongside the other profile
-- prefs (city/locale/theme/gender/hijri).
--   calc_method — one of the adhan method names (e.g. 'karachi', 'ummAlQura').
--   asr_method  — 'hanafi' | 'shafi' (Asr juristic method).

alter table public.profiles
  add column if not exists calc_method text,
  add column if not exists asr_method  text check (asr_method in ('hanafi', 'shafi'));
