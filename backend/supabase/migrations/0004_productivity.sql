-- Productivity modules: tasks, notes, calendar events, and planner time-blocks.
-- All user-owned and protected by RLS (owner-only), same pattern as 0002.

create table if not exists public.tasks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  title      text        not null,
  notes      text,
  due_date   date,
  priority   text        not null default 'med' check (priority in ('low','med','high')),
  status     text        not null default 'todo' check (status in ('todo','done')),
  position   int         not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_user_idx on public.tasks (user_id);

create table if not exists public.notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  title      text        not null default '',
  body       text        not null default '',
  color      text        not null default 'default',
  pinned     boolean     not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notes_user_idx on public.notes (user_id);

create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  title       text        not null,
  description text,
  start_at    timestamptz not null,
  end_at      timestamptz,
  all_day     boolean     not null default false,
  color       text        not null default 'blue',
  created_at  timestamptz not null default now()
);
create index if not exists events_user_idx on public.events (user_id, start_at);

create table if not exists public.planner_blocks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  day        date        not null,
  start_min  int         not null check (start_min between 0 and 1439),
  end_min    int         not null check (end_min between 1 and 1440),
  title      text        not null,
  task_id    uuid        references public.tasks (id) on delete set null,
  color      text        not null default 'blue',
  created_at timestamptz not null default now()
);
create index if not exists planner_user_day_idx on public.planner_blocks (user_id, day);

-- updated_at triggers (function defined in 0001)
drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();
drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before update on public.notes
  for each row execute function public.touch_updated_at();

-- RLS: owner-only for every table.
do $$
declare t text;
begin
  foreach t in array array['tasks','notes','events','planner_blocks'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I_rw on public.%I;', t, t);
    execute format(
      'create policy %I_rw on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id);',
      t, t);
  end loop;
end $$;
