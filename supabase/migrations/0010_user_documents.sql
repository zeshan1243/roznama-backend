-- Generic per-user document store for the mobile app's local-first tools
-- (expenses, habits, documents, udhaar, installments, committee, prayer log,
-- grocery, reminders, ...). Each tool persists a single JSON blob locally under
-- a stable key (e.g. 'app.expenses'); the app mirrors that blob here so the
-- data follows the account across devices. Last-writer-wins per (user, key).
--
-- User-independent data (live rates, prayer times, reference content) is NOT
-- stored here — it lives in feed_snapshots / ref_* / bundled assets.

create table if not exists public.user_documents (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  key        text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.user_documents enable row level security;
drop policy if exists user_documents_rw on public.user_documents;
create policy user_documents_rw on public.user_documents
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists user_documents_touch on public.user_documents;
create trigger user_documents_touch before update on public.user_documents
  for each row execute function public.touch_updated_at();
