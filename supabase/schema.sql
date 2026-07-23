-- Run this once in the Supabase project's SQL Editor (Project > SQL Editor > New query).
-- Credentials themselves (email + hashed password) already live in Supabase's built-in
-- auth.users table — this file only adds the app-owned profile row alongside it.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

-- Safe to re-run: adds these columns if this file was already run before they existed.
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles drop column if exists full_name;

alter table public.profiles enable row level security;

-- Each user may only read/update their own profile row. There is intentionally no
-- policy allowing select/update of other users' rows, and no delete/insert policy for
-- end users (the row is created only by the trigger below, running as the table owner).
drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row whenever someone signs up via Supabase Auth. first_name,
-- last_name and phone are passed in from the sign-up form via supabase.auth.signUp's
-- options.data, which lands in raw_user_meta_data.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, first_name, last_name, phone)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    new.raw_user_meta_data ->> 'phone'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Commercial properties a user has confirmed via the intake flow. One row per
-- property; users can have any number of them, added/deleted from the dashboard.
create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  address text not null,
  cad text,
  account_number text,
  owner_name text,
  property_type text,
  land_value numeric,
  improvement_value numeric,
  total_value numeric,
  tax_year integer,
  created_at timestamptz not null default now()
);

alter table public.properties enable row level security;

-- Users may only see, add, and remove their own properties — no update policy since
-- properties are re-derived from a fresh CAD lookup rather than hand-edited.
drop policy if exists "Users can view their own properties" on public.properties;
create policy "Users can view their own properties"
  on public.properties for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own properties" on public.properties;
create policy "Users can insert their own properties"
  on public.properties for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own properties" on public.properties;
create policy "Users can delete their own properties"
  on public.properties for delete
  using (auth.uid() = user_id);

-- Admin panel support: a manual is_admin flag and a manual plan field (no real
-- billing — matches the 3 tiers in src/routes/pricing.tsx).
alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.profiles add column if not exists plan text not null default 'free_ai_review';

alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles add constraint profiles_plan_check
  check (plan in ('free_ai_review', 'ai_report', 'managed_protest'));

-- security definer bypasses RLS internally, so it can safely be referenced from RLS
-- policies on public.profiles itself without recursively re-evaluating those policies
-- (same convention as handle_new_user() above).
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- Additive: Postgres OR's multiple permissive policies together, so these grant
-- admins access in addition to the existing owner-only policies above, not instead.
drop policy if exists "Admins can view all profiles" on public.profiles;
create policy "Admins can view all profiles"
  on public.profiles for select
  using (public.is_admin());

drop policy if exists "Admins can update all profiles" on public.profiles;
create policy "Admins can update all profiles"
  on public.profiles for update
  using (public.is_admin());

drop policy if exists "Admins can view all properties" on public.properties;
create policy "Admins can view all properties"
  on public.properties for select
  using (public.is_admin());

drop policy if exists "Admins can insert properties for any user" on public.properties;
create policy "Admins can insert properties for any user"
  on public.properties for insert
  with check (public.is_admin());

drop policy if exists "Admins can delete any property" on public.properties;
create policy "Admins can delete any property"
  on public.properties for delete
  using (public.is_admin());

-- Stripe billing: the webhook (supabase/functions/stripe-webhook) writes plan and
-- these two ids; the admin panel's manual plan dropdown still works unchanged since
-- it edits the same `plan` column.
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists stripe_subscription_id text;

-- ── ONE-TIME MANUAL STEP — do NOT run this as part of the routine schema paste ──
-- After you have an account (sign up normally through the app first), run this once,
-- by itself, substituting your real email, to make that account an admin:
--
-- update public.profiles set is_admin = true where email = 'you@example.com';
