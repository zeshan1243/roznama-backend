-- Per-tool tables for the account-owned "My Life" tools. Each tool gets its own
-- table so its data is cleanly separated and CRUD'd on its own REST endpoints
-- (/api/me/tools/<name>). Records store their full item as `data` jsonb (lossless
-- for the rich, nested tool models) keyed by the client-generated `id`.
--
-- List tools: one row per record, primary key (user_id, id).
-- Singleton tools (streak, water, baby_budget): one row per user.
--
-- Supersedes the generic user_documents blob store for these tools. RLS is
-- owner-only on every table.

do $$
declare
  t text;
  list_tools text[] := array[
    'todos','notes','reminders','grocery','occasions','recipes','alarms',
    'learning','documents','games','habits','expenses','medications',
    'udhaar','installments','committee'
  ];
  single_tools text[] := array['streak','water','baby_budget'];
begin
  foreach t in array list_tools loop
    execute format($f$
      create table if not exists public.tool_%1$s (
        user_id    uuid        not null references auth.users (id) on delete cascade,
        id         text        not null,
        data       jsonb       not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        primary key (user_id, id)
      );
      alter table public.tool_%1$s enable row level security;
      drop policy if exists tool_%1$s_rw on public.tool_%1$s;
      create policy tool_%1$s_rw on public.tool_%1$s
        for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
    $f$, t);
  end loop;

  foreach t in array single_tools loop
    execute format($f$
      create table if not exists public.tool_%1$s (
        user_id    uuid        not null references auth.users (id) on delete cascade,
        data       jsonb       not null,
        updated_at timestamptz not null default now(),
        primary key (user_id)
      );
      alter table public.tool_%1$s enable row level security;
      drop policy if exists tool_%1$s_rw on public.tool_%1$s;
      create policy tool_%1$s_rw on public.tool_%1$s
        for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
    $f$, t);
  end loop;
end $$;
