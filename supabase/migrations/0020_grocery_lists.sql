-- Named shopping lists for the Grocery tool (one row per list, keyed by the
-- client-generated id, full item as `data` jsonb). Grocery items reference a
-- list via `data.listId`. Same shape/RLS as the other per-tool list tables in
-- 0019 (see project docs).

create table if not exists public.tool_grocery_lists (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  id         text        not null,
  data       jsonb       not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.tool_grocery_lists enable row level security;
drop policy if exists tool_grocery_lists_rw on public.tool_grocery_lists;
create policy tool_grocery_lists_rw on public.tool_grocery_lists
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
