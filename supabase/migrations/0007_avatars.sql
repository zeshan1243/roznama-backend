-- Profile pictures for the mobile app.
--
-- Adds the avatar_url column and a public "avatars" storage bucket. Files are
-- stored under a per-user folder (`<uid>/...`) so RLS can restrict writes to the
-- owner while keeping reads public (avatars are shown without auth).

alter table public.profiles
  add column if not exists avatar_url text;

-- Public bucket (anyone can read; only the owner can write to their folder).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- storage.objects already has RLS enabled by Supabase. Scope policies to the
-- avatars bucket, keyed on the first path segment being the user's id.
drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars owner insert" on storage.objects;
create policy "avatars owner insert" on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars owner update" on storage.objects;
create policy "avatars owner update" on storage.objects
  for update using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars owner delete" on storage.objects;
create policy "avatars owner delete" on storage.objects
  for delete using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );