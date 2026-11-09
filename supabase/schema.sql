-- Familjeskärm – Supabase-schema
-- Modell: en delad hushållsinloggning. Bara e-post som finns i household_emails
-- får läsa/skriva (skydd även om publik registrering är påslagen).

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null, date date not null, start time, "end" time,
  person text not null default 'gemensamt' check (person in ('niklas','sambo','gemensamt')),
  example boolean default false, created_at timestamptz not null default now()
);
create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  title text not null, done boolean not null default false,
  person text not null default 'gemensamt' check (person in ('niklas','sambo','gemensamt')),
  example boolean default false, created_at timestamptz not null default now()
);
create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  title text not null, image text, ingredients text[] not null default '{}', steps text[] not null default '{}',
  example boolean default false, created_at timestamptz not null default now()
);
create table if not exists public.meal_plan (
  id uuid primary key default gen_random_uuid(),
  date date not null unique, recipe_id uuid not null references public.recipes(id) on delete cascade,
  example boolean default false, created_at timestamptz not null default now()
);
create index if not exists meal_plan_recipe_idx on public.meal_plan(recipe_id);
create table if not exists public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  title text not null, done boolean not null default false, person text default 'gemensamt', source text,
  example boolean default false, created_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['events','todos','recipes','meal_plan','shopping_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists household_all on public.%I', t);
    execute format('create policy household_all on public.%I for all to authenticated using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null)', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop; end $$;

-- 002: hushållets tillåtna e-postadresser
-- Publik registrering är påslagen i projektet, så "alla inloggade" räcker inte.
-- Endast e-postadresser i household_emails får läsa/skriva.
create table if not exists public.household_emails (email text primary key);
alter table public.household_emails enable row level security;
revoke all on public.household_emails from anon, authenticated;

create or replace function public.is_household() returns boolean
language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.household_emails h where lower(h.email) = lower(coalesce((select auth.jwt()->>'email'), ''))) $$;
revoke all on function public.is_household() from public, anon;
grant execute on function public.is_household() to authenticated;

do $$ declare t text; begin
  foreach t in array array['events','todos','recipes','meal_plan','shopping_items'] loop
    execute format('drop policy if exists household_all on public.%I', t);
    execute format('create policy household_all on public.%I for all to authenticated using ((select public.is_household())) with check ((select public.is_household()))', t);
  end loop; end $$;

-- Lägg till hushållets inloggning:
-- insert into public.household_emails(email) values ('familj@example.com');

-- 003: iCloud-kalenderflöden (läsbara, URL hemlig)
create table if not exists public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  name text not null, url text not null,
  person text not null default 'gemensamt' check (person in ('niklas','sambo','gemensamt')),
  color text, created_at timestamptz not null default now()
);
alter table public.calendar_feeds enable row level security;
revoke all on public.calendar_feeds from anon;
grant select, insert, update, delete on public.calendar_feeds to authenticated;
drop policy if exists household_all on public.calendar_feeds;
create policy household_all on public.calendar_feeds for all to authenticated using ((select public.is_household())) with check ((select public.is_household()));
do $$ begin if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='calendar_feeds') then
  alter publication supabase_realtime add table public.calendar_feeds; end if; end $$;
