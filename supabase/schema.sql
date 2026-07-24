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

-- Optional business/LLC name captured at signup, used once to search supported CAD
-- sources for properties already owned under that name (see cad-owner-search).
alter table public.profiles add column if not exists company_name text;

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
  insert into public.profiles (id, email, first_name, last_name, phone, company_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    new.raw_user_meta_data ->> 'phone',
    new.raw_user_meta_data ->> 'company_name'
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

-- 'ai_report' and 'managed_protest' are the original flat-rate/contingency tiers,
-- kept in the allow-list for any pre-existing rows; 'owner_managed' and
-- 'corvusrf_managed' are the real per-property monthly tiers new checkouts write.
alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles add constraint profiles_plan_check
  check (plan in ('free_ai_review', 'ai_report', 'managed_protest', 'owner_managed', 'corvusrf_managed'));

-- How many properties the active subscription covers (Stripe line-item quantity) —
-- pricing is per-property, so this drives what "N properties on your plan" means.
alter table public.profiles add column if not exists subscription_quantity integer not null default 1;

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

-- Mirrors Stripe's own subscription status verbatim (active/past_due/unpaid/canceled/
-- etc.) — separate from `plan` so the UI can show a payment-problem banner without
-- prematurely revoking access; Stripe's own dunning schedule governs actual expiry.
alter table public.profiles add column if not exists subscription_status text;

-- Stripe's Customer Portal "cancel" flow defaults to canceling at the end of the
-- current billing period rather than immediately — the subscription's `status` stays
-- "active" the whole time, so without tracking this separately a scheduled
-- cancellation is invisible in the app until it actually takes effect.
alter table public.profiles add column if not exists cancel_at_period_end boolean not null default false;
alter table public.profiles add column if not exists cancel_at timestamptz;

-- Protest deadline extracted from an uploaded notice, persisted so the dashboard's
-- Notifications tab can compute real "N days left" alerts instead of inventing them.
alter table public.properties add column if not exists protest_deadline date;

-- Tax bill data extracted from an uploaded "Tax Bill / Statement" document, persisted
-- so the dashboard's Payments tab can show real due dates and amounts. paid_at is set
-- by the user clicking "Mark as Paid" — CorvusRF has no live payment integration, so
-- payment status is a user-reported fact, not something the app can verify itself.
alter table public.properties add column if not exists payment_due_date date;
alter table public.properties add column if not exists tax_amount_due numeric;
alter table public.properties add column if not exists paid_at timestamptz;

-- Business Personal Property tax accounts — a distinct entity from real property
-- (public.properties): a business can render BPP for a location without owning the
-- real estate it sits in, so this isn't just a property with a type filter.
create table if not exists public.bpp_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  business_name text not null,
  account_number text,
  cad text,
  location_address text,
  created_at timestamptz not null default now()
);

alter table public.bpp_accounts enable row level security;

drop policy if exists "Users can view their own BPP accounts" on public.bpp_accounts;
create policy "Users can view their own BPP accounts"
  on public.bpp_accounts for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own BPP accounts" on public.bpp_accounts;
create policy "Users can insert their own BPP accounts"
  on public.bpp_accounts for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own BPP accounts" on public.bpp_accounts;
create policy "Users can delete their own BPP accounts"
  on public.bpp_accounts for delete
  using (auth.uid() = user_id);

-- Real, staff-actioned protest requests — created when a user clicks "Request Protest
-- Filing" on a property. Status starts at 'requested' and is only ever advanced by an
-- admin (mirrors the manual is_admin()-gated pattern already used for profiles.plan),
-- since actual filing/hearing representation happens off-platform by CorvusRF staff.
create table if not exists public.protests (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'requested',
  notes text,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.protests drop constraint if exists protests_status_check;
alter table public.protests add constraint protests_status_check
  check (status in ('requested', 'filed', 'under_review', 'hearing_scheduled', 'resolved'));

alter table public.protests enable row level security;

drop policy if exists "Users can view their own protests" on public.protests;
create policy "Users can view their own protests"
  on public.protests for select
  using (auth.uid() = user_id);

drop policy if exists "Users can request their own protests" on public.protests;
create policy "Users can request their own protests"
  on public.protests for insert
  with check (auth.uid() = user_id);

drop policy if exists "Admins can view all protests" on public.protests;
create policy "Admins can view all protests"
  on public.protests for select
  using (public.is_admin());

drop policy if exists "Admins can update all protests" on public.protests;
create policy "Admins can update all protests"
  on public.protests for update
  using (public.is_admin());

-- Original uploaded documents (appraisal notices, tax bills, etc.), persisted per
-- property so the dashboard's Documents tab lists real files instead of only the
-- AI-extracted field values. The file itself lives in the "documents" Storage bucket
-- below; this table is the per-user, per-property index over it.
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  document_type text,
  uploaded_at timestamptz not null default now()
);

alter table public.documents enable row level security;

drop policy if exists "Users can view their own documents" on public.documents;
create policy "Users can view their own documents"
  on public.documents for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own documents" on public.documents;
create policy "Users can insert their own documents"
  on public.documents for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own documents" on public.documents;
create policy "Users can delete their own documents"
  on public.documents for delete
  using (auth.uid() = user_id);

drop policy if exists "Admins can view all documents" on public.documents;
create policy "Admins can view all documents"
  on public.documents for select
  using (public.is_admin());

-- Private bucket: objects are stored at "{user_id}/{property_id}/{filename}" so the
-- storage.objects policies below can scope access by the first path segment alone.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists "Users can upload their own documents" on storage.objects;
create policy "Users can upload their own documents"
  on storage.objects for insert
  with check (
    bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can view their own documents" on storage.objects;
create policy "Users can view their own documents"
  on storage.objects for select
  using (
    bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete their own documents" on storage.objects;
create policy "Users can delete their own documents"
  on storage.objects for delete
  using (
    bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── ONE-TIME MANUAL STEP — do NOT run this as part of the routine schema paste ──
-- After you have an account (sign up normally through the app first), run this once,
-- by itself, substituting your real email, to make that account an admin:
--
-- update public.profiles set is_admin = true where email = 'you@example.com';
