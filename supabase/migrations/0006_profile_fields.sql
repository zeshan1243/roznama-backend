-- Extra profile fields for the account/profile screen in the mobile app.
-- Everything else the profile needs (city, locale, theme, hijri_offset,
-- onboarded, email) already exists from 0001.

alter table public.profiles
  add column if not exists full_name text,
  add column if not exists phone     text;
