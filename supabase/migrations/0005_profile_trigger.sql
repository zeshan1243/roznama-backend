-- Auto-provision a profile row for every new auth user.
--
-- The web backend creates a profile lazily on the first `GET /api/me/profile`
-- (see src/routes/user.ts). The mobile app, however, talks to Supabase Auth
-- directly and never hits that endpoint — so without this trigger a mobile
-- signup would have no row in public.profiles. This trigger fires for BOTH
-- web and mobile signups, so profile creation no longer depends on the API.
--
-- Idempotent: `on conflict do nothing` coexists with the API's upsert, so a
-- profile is never duplicated regardless of which path runs first.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
