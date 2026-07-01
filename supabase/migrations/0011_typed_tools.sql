-- Typed relational tables for the high-value tools (hybrid model). Each row
-- keeps the queryable metadata as typed columns AND the full item as `data`
-- jsonb, so server-side metadata queries are clean while the client round-trips
-- losslessly. Nested sub-lists (payments, members, collections, paid months,
-- reminder times, completed days) live inside `data`.
--
-- The remaining tools continue to sync as blobs via user_documents (0010).
-- `id` is the client-generated item id; (user_id, id) is the primary key.

create table if not exists public.expenses (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  id         text        not null,
  title      text        not null,
  amount     numeric     not null,
  spent_at   timestamptz not null,
  category   text,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.documents (
  user_id      uuid        not null references auth.users (id) on delete cascade,
  id           text        not null,
  name         text        not null,
  type         text,
  number       text,
  issue_date   timestamptz,
  expiry_date  timestamptz,
  data         jsonb       not null,
  updated_at   timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.medications (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  id         text        not null,
  name       text        not null,
  enabled    boolean     not null default true,
  created_at timestamptz,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.habits (
  user_id     uuid        not null references auth.users (id) on delete cascade,
  id          text        not null,
  name        text        not null,
  created_at  timestamptz,
  days_count  int         not null default 0,
  data        jsonb       not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.udhaar_entries (
  user_id     uuid        not null references auth.users (id) on delete cascade,
  id          text        not null,
  person_name text        not null,
  direction   text        not null,      -- 'gave' | 'took'
  principal   numeric     not null,
  date        timestamptz not null,
  data        jsonb       not null,      -- includes repayments[]
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.installment_plans (
  user_id       uuid        not null references auth.users (id) on delete cascade,
  id            text        not null,
  title         text        not null,
  monthly_amount numeric    not null,
  total_months  int         not null,
  start_date    timestamptz not null,
  data          jsonb       not null,    -- includes paid_months[]
  updated_at    timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.committees (
  user_id        uuid        not null references auth.users (id) on delete cascade,
  id             text        not null,
  name           text        not null,
  monthly_amount numeric     not null,
  start_date     timestamptz not null,
  data           jsonb       not null,   -- includes members[] and collections{}
  updated_at     timestamptz not null default now(),
  primary key (user_id, id)
);

-- Owner-only RLS + updated_at trigger for each table.
do $$
declare t text;
begin
  foreach t in array array[
    'expenses','documents','medications','habits',
    'udhaar_entries','installment_plans','committees'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I_rw on public.%I;', t, t);
    execute format(
      'create policy %I_rw on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id);',
      t, t);
    execute format('drop trigger if exists %I_touch on public.%I;', t, t);
    execute format(
      'create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at();',
      t, t);
  end loop;
end $$;
