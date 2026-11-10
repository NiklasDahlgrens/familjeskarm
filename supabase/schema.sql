-- Familjeskärm – Supabase-schema
-- Modell: en delad hushållsinloggning. Bara konton som finns i household_members
-- (se 004 längst ner) får läsa/skriva – även om publik registrering skulle vara påslagen.
-- Stäng ändå av registrering: Authentication → Sign In / Providers → "Allow new users to sign up".

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

-- 004: knyt hushållet till användar-id i stället för e-postadress
-- En e-postadress i en lista är bara så säker som kontot bakom den: en adress utan konto kan registreras av den som
-- kontrollerar adressen. Ett användar-id kan däremot bara tillhöra ett konto som redan finns.
-- Säkert att köra på en befintlig installation: konton som matchar household_emails flyttas över först,
-- så ingen som har åtkomst i dag tappar den.
create table if not exists public.household_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.household_members enable row level security;
revoke all on public.household_members from anon, authenticated;

insert into public.household_members(user_id)
  select u.id from auth.users u join public.household_emails h on lower(h.email) = lower(u.email)
  on conflict do nothing;

create or replace function public.is_household() returns boolean
language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.household_members m where m.user_id = (select auth.uid())) $$;
revoke all on function public.is_household() from public, anon;
grant execute on function public.is_household() to authenticated;

-- Lägg till ett konto i hushållet (kör i SQL Editor, med kontots e-post):
-- insert into public.household_members(user_id) select id from auth.users where lower(email) = lower('familj@example.com');
-- household_emails används inte längre av policyerna och kan tas bort när ni ser att inloggningen fungerar:
-- drop table public.household_emails;
