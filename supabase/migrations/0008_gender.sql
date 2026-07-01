-- Gender on the profile. Drives gender-specific content in the app and the
-- avatar fallback icon. Nullable — 'male' | 'female' | null (unspecified).

alter table public.profiles
  add column if not exists gender text
    check (gender in ('male', 'female'));
