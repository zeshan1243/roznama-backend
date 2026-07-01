-- Self-service account deletion.
--
-- Deleting an auth user needs admin rights, which the client doesn't have. This
-- SECURITY DEFINER function lets a signed-in user delete ONLY their own account
-- (scoped by auth.uid()). Removing the auth.users row cascades to profiles and
-- every user-owned table (all reference auth.users on delete cascade); avatar
-- files in storage aren't cascaded, so we remove them explicitly first.

create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Remove the user's avatar files (storage is not FK-cascaded from auth.users).
  delete from storage.objects
    where bucket_id = 'avatars'
      and (storage.foldername(name))[1] = uid::text;

  -- Cascades to profiles, bills, tasks, notes, ... everything owned by the user.
  delete from auth.users where id = uid;
end $$;

-- Only signed-in users may call it; each can only ever delete themselves.
revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
