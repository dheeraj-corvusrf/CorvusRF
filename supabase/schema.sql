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

-- RLS policies gate which ROWS are visible/writable, not which COLUMNS — the policy
-- above alone would let any signed-in user set their OWN plan/is_admin/subscription_*
-- columns directly (e.g. `supabase.from("profiles").update({ plan: "owner_managed" })`
-- or `{ is_admin: true }`), bypassing Stripe and admin gating entirely. Column-level
-- grants close that regardless of RLS: only the fields a normal profile-edit form
-- actually needs (see src/lib/profile.ts's updateMyProfile) stay client-writable.
-- Everything else — plan, is_admin, subscription/billing fields — becomes writable
-- only by the service-role client, which is exactly what the Stripe webhook and the
-- admin-update-plan/admin-update-admin-status edge functions already use.
revoke update on public.profiles from authenticated;
grant update (first_name, last_name, phone, company_name) on public.profiles to authenticated;

-- Auto-create a profile row whenever someone signs up via Supabase Auth. first_name,
-- last_name and phone are passed in from the sign-up form via supabase.auth.signUp's
-- options.data, which lands in raw_user_meta_data. 'wants_beta' (also passed through
-- options.data, from the sign-up form's beta checkbox) sets plan='beta' right here,
-- in this security-definer trigger — not via a client-side update, which the column
-- grants above no longer allow. Runs at row-creation regardless of whether email
-- confirmation is required, so both signup paths grant beta access correctly.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, first_name, last_name, phone, company_name, plan)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    new.raw_user_meta_data ->> 'phone',
    new.raw_user_meta_data ->> 'company_name',
    case when new.raw_user_meta_data ->> 'wants_beta' = 'true' then 'beta' else 'free_ai_review' end
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

-- Users may see, add, remove, and update their own properties. Most fields are
-- re-derived from a fresh CAD lookup rather than hand-edited, but a few (paid_at,
-- estimated_savings/savings_basis) are legitimately written back onto an existing
-- row after creation — see "Users can update their own properties" below.
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

-- Was missing entirely until this was added, which meant markPropertyPaid()'s
-- update() call was silently rejected by RLS the whole time (no error surfaced —
-- .update() against a row RLS hides from you just updates zero rows).
drop policy if exists "Users can update their own properties" on public.properties;
create policy "Users can update their own properties"
  on public.properties for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Admin panel support: a manual is_admin flag and a manual plan field (no real
-- billing — matches the 3 tiers in src/routes/pricing.tsx).
alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.profiles add column if not exists plan text not null default 'free_ai_review';

-- 'ai_report' and 'managed_protest' are the original flat-rate/contingency tiers,
-- kept in the allow-list for any pre-existing rows; 'owner_managed' and
-- 'corvusrf_managed' are the real per-property monthly tiers new checkouts write.
-- 'beta' is a free, full-access grant set only by handle_new_user() below when
-- someone signs up with the beta checkbox checked — never through Stripe.
alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles add constraint profiles_plan_check
  check (plan in ('free_ai_review', 'ai_report', 'managed_protest', 'owner_managed', 'corvusrf_managed', 'beta'));

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

-- Records who on staff did what in the admin panel (plan changes, admin-access
-- grants, user creation/deletion, protest status/notes edits) and when — none of
-- that was logged anywhere before. actor_id/target_user_id are nullable (set null
-- on delete) so a row stays readable after the account it refers to is gone;
-- actor_email/target_email are denormalized snapshots for the same reason. No
-- jsonb (this schema has none) — detail is a short free-form description, matching
-- how much structure every other "what happened" field here carries.
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id) on delete set null,
  actor_email text not null,
  action text not null,
  target_user_id uuid references auth.users (id) on delete set null,
  target_email text,
  detail text,
  created_at timestamptz not null default now()
);

alter table public.admin_audit_log enable row level security;

drop policy if exists "Admins can view the audit log" on public.admin_audit_log;
create policy "Admins can view the audit log"
  on public.admin_audit_log for select
  using (public.is_admin());

-- actor_id = auth.uid() (on top of is_admin()) so an admin can only ever log
-- themselves as the actor, never write an entry attributing an action to a
-- different admin.
drop policy if exists "Admins can log their own actions" on public.admin_audit_log;
create policy "Admins can log their own actions"
  on public.admin_audit_log for insert
  with check (public.is_admin() and actor_id = auth.uid());

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

-- Real per-property savings estimate (see src/lib/savings-estimate.ts) — "comps"
-- (real comparable-property data, distance- and value-filtered) or "formula"
-- (a deterministic reduction % from real per-county/per-category 2025 Texas
-- protest-outcome data, used when no qualifying comp exists — no AI call, so
-- the same property always produces the same number). "ai" and "baseline" are
-- legacy values from before the estimate was made fully deterministic — still
-- valid to read on old rows, nothing writes them anymore. Persisted so the
-- dashboard shows the same number the user saw during intake instead of
-- losing it once the property is saved; backfilled for properties added
-- before this column existed via the properties dashboard page.
alter table public.properties add column if not exists estimated_savings numeric;
alter table public.properties add column if not exists savings_basis text;
alter table public.properties drop constraint if exists properties_savings_basis_check;
alter table public.properties add constraint properties_savings_basis_check check (savings_basis in ('comps', 'formula', 'ai', 'baseline'));

-- Real CAD-sourced year-over-year value history (land/improvement/market/appraised
-- per year — see src/lib/cad-lookup.ts's CadValueHistoryEntry), one JSON-stringified
-- entry per array element (this schema has no jsonb columns; text[] matches the
-- existing property_ai_scores.factors precedent for "a handful of structured values
-- on one row"). Previously only ever lived in session storage during intake and was
-- lost the moment the user left that screen — persisted so it survives to be shown
-- again later, and so estimateSavings()'s value-trend adjustment (texas-tax-rates.ts)
-- still has data to work with on a return visit, not just the first one.
alter table public.properties add column if not exists value_history text[];

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

-- status check constraint is defined further below, once, after the full set of
-- possible values (added for case-progress tracking) is established.

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

-- AI-generated case prep (see src/lib/protest-case.ts), written by the user's own
-- client right after they request a protest — not a verified filing outcome, same
-- self-reported precedent as tax_bills.paid_at/refund_amount. RLS is row-scoped by
-- user_id like every other table here; it can't distinguish "only these columns,"
-- so this does technically let a user edit their own status/notes too, same as they
-- always could edit their own tax_bills payment fields.
alter table public.protests add column if not exists strategy_recommendation text;
alter table public.protests add column if not exists strategy_confidence_pct integer;
alter table public.protests add column if not exists strategy_rationale text;
alter table public.protests add column if not exists case_prep_generated_at timestamptz;

drop policy if exists "Users can update their own protests" on public.protests;
create policy "Users can update their own protests"
  on public.protests for update
  using (auth.uid() = user_id);

-- Case progress through settlement/hearing/decision/escalation (see
-- src/lib/protest-case.ts) — same self-reported precedent as everything else on
-- this table; there's no live county API, so someone has to enter what actually
-- happened. original_value is a snapshot taken at request time (not read live off
-- properties.total_value), since that can change in later years and the case needs
-- to remember what it actually started from.
alter table public.protests add column if not exists original_value numeric;
alter table public.protests add column if not exists settlement_offer_value numeric;
alter table public.protests add column if not exists settlement_offer_received_at date;
alter table public.protests add column if not exists hearing_date date;
alter table public.protests add column if not exists arb_decision text;
alter table public.protests add column if not exists arb_decision_date date;
alter table public.protests add column if not exists final_value numeric;
alter table public.protests add column if not exists escalation_path text;
alter table public.protests add column if not exists closed_at timestamptz;

-- Which tax year this filing covers — lets a property have one protest row per
-- year instead of one ever, so a resolved prior-year case doesn't block filing
-- again for a new year (see src/routes/dashboard/_layout.properties.tsx's
-- "Re-file for {year}" flow). Nullable/unbackfilled on purpose: every lookup of
-- "the" protest for a property already resolves to the most recent row (ordered
-- by requested_at desc), so older rows without a year don't need one.
alter table public.protests add column if not exists tax_year integer;

-- No delete UI exists for protests today — this exists so the authenticated E2E
-- suite (e2e/authenticated/protest-authorization.spec.ts, run in CI on every push
-- to dev) can clean up the real protest row it creates each run, instead of
-- leaving CI-seeded rows piling up in the real admin queue staff work from.
drop policy if exists "Users can delete their own protests" on public.protests;
create policy "Users can delete their own protests"
  on public.protests for delete
  using (auth.uid() = user_id);

alter table public.protests drop constraint if exists protests_arb_decision_check;
alter table public.protests add constraint protests_arb_decision_check
  check (arb_decision is null or arb_decision in ('approved', 'partial', 'denied'));

alter table public.protests drop constraint if exists protests_escalation_path_check;
alter table public.protests add constraint protests_escalation_path_check
  check (escalation_path is null or escalation_path in ('accept', 'appeal', 'arbitration'));

alter table public.protests drop constraint if exists protests_status_check;
alter table public.protests add constraint protests_status_check
  check (status in ('requested', 'filed', 'under_review', 'offer_received',
    'hearing_scheduled', 'decision_received', 'appealing', 'arbitrating', 'resolved'));

-- Trackable evidence checklist for a protest case — one row per AI-suggested
-- evidence item, optionally linked to an uploaded document once the user provides
-- it. Generated from the same "evidence" AI module the paywalled AI Report page
-- already uses (src/lib/ai-report-modules.ts), just persisted against the real
-- case instead of only rendering once in a report view.
create table if not exists public.protest_evidence_items (
  id uuid primary key default gen_random_uuid(),
  protest_id uuid not null references public.protests (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null,
  -- Legacy — a checklist item now links to zero or more documents via
  -- documents.evidence_item_id instead (see below), which supports more than one
  -- file per item. Left in place (with a one-time backfill) so already-uploaded
  -- evidence isn't lost, but no longer written to by new uploads.
  document_id uuid references public.documents (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.protest_evidence_items enable row level security;

drop policy if exists "Users can view their own evidence items" on public.protest_evidence_items;
create policy "Users can view their own evidence items"
  on public.protest_evidence_items for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own evidence items" on public.protest_evidence_items;
create policy "Users can insert their own evidence items"
  on public.protest_evidence_items for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own evidence items" on public.protest_evidence_items;
create policy "Users can update their own evidence items"
  on public.protest_evidence_items for update
  using (auth.uid() = user_id);

drop policy if exists "Admins can view all evidence items" on public.protest_evidence_items;
create policy "Admins can view all evidence items"
  on public.protest_evidence_items for select
  using (public.is_admin());

-- Lets staff run generateCasePrep()/linkEvidenceDocument() (src/lib/protest-case.ts)
-- on a customer's behalf from the admin panel — inserted/updated rows still carry
-- the CUSTOMER's own user_id (passed explicitly by the client, not auth.uid()), so
-- the customer's own "Users can ..." policies above keep working for them too.
drop policy if exists "Admins can insert evidence items" on public.protest_evidence_items;
create policy "Admins can insert evidence items"
  on public.protest_evidence_items for insert
  with check (public.is_admin());

drop policy if exists "Admins can update all evidence items" on public.protest_evidence_items;
create policy "Admins can update all evidence items"
  on public.protest_evidence_items for update
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

-- Needed so linkEvidenceDocument() (src/lib/protest-case.ts) can set
-- evidence_item_id after upload — RLS only gates which rows are visible, not which
-- columns are writable, so the column grant below (same pattern as profiles' own
-- lockdown above) keeps this to exactly the one field a user should ever change on
-- an existing document row.
drop policy if exists "Users can update their own documents" on public.documents;
create policy "Users can update their own documents"
  on public.documents for update
  using (auth.uid() = user_id);
revoke update on public.documents from authenticated;
grant update (evidence_item_id) on public.documents to authenticated;

drop policy if exists "Admins can view all documents" on public.documents;
create policy "Admins can view all documents"
  on public.documents for select
  using (public.is_admin());

-- Lets staff index an uploaded file (src/lib/documents.ts's uploadDocument()) on a
-- customer's behalf — same "row still carries the customer's own user_id" pattern
-- as the evidence-items admin policies above.
drop policy if exists "Admins can insert documents" on public.documents;
create policy "Admins can insert documents"
  on public.documents for insert
  with check (public.is_admin());

-- Lets staff link evidence on a customer's behalf from the admin panel's copy of
-- CasePlanSection — the "Users can update ..." policy above only matches a
-- document's own owner, not staff acting on someone else's row. Covered by the
-- same evidence_item_id-only column grant above (grants are per-role, not
-- per-policy).
drop policy if exists "Admins can update all documents" on public.documents;
create policy "Admins can update all documents"
  on public.documents for update
  using (public.is_admin());

-- Links a document to the specific evidence-checklist item it satisfies. Nullable
-- and one-directional (document -> item) rather than the old single document_id
-- column on protest_evidence_items, so one checklist item — e.g. "Property Income
-- and Expense Statements (3 Years)" — can hold several uploaded files instead of
-- just one. See CaseDetailModal.tsx's evidence checklist.
alter table public.documents add column if not exists evidence_item_id uuid
  references public.protest_evidence_items (id) on delete set null;

-- Backfill: earlier uploads used protest_evidence_items.document_id (now legacy —
-- superseded by evidence_item_id above) to link a single file. Idempotent, so it's
-- safe to re-run: only touches documents not already linked.
update public.documents d
set evidence_item_id = pei.id
from public.protest_evidence_items pei
where pei.document_id = d.id and d.evidence_item_id is null;

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

-- No path restriction (unlike the user policy above) — staff need to write into the
-- CUSTOMER's own folder, not their own, so the customer can still read it back via
-- their own "Users can view their own documents" policy below.
drop policy if exists "Admins can upload any documents" on storage.objects;
create policy "Admins can upload any documents"
  on storage.objects for insert
  with check (bucket_id = 'documents' and public.is_admin());

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

-- One row per (protest, form) — holds both in-progress edits (Save Progress,
-- no signature) and the final signed record (Sign & Submit) for the two real
-- Comptroller forms (Notice of Protest / Appointment of Agent, see
-- protest-documents.ts). field_values is the whole (dynamic, ~30-40-key)
-- FieldValues map, JSON-stringified into a plain text column rather than a
-- jsonb column — this schema has none (see value_history's text[] precedent
-- above) — since the field set is open-ended and doesn't fit fixed columns.
create table if not exists public.protest_form_submissions (
  id uuid primary key default gen_random_uuid(),
  protest_id uuid not null references public.protests (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  form_type text not null check (form_type in ('notice_of_protest', 'appointment_of_agent')),
  field_values text not null,
  signature_type text,
  signature_data text,
  signed_at timestamptz,
  document_id uuid references public.documents (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (protest_id, form_type)
);

alter table public.protest_form_submissions enable row level security;

drop policy if exists "Users can view their own form submissions" on public.protest_form_submissions;
create policy "Users can view their own form submissions"
  on public.protest_form_submissions for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own form submissions" on public.protest_form_submissions;
create policy "Users can insert their own form submissions"
  on public.protest_form_submissions for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own form submissions" on public.protest_form_submissions;
create policy "Users can update their own form submissions"
  on public.protest_form_submissions for update
  using (auth.uid() = user_id);

drop policy if exists "Admins can view all form submissions" on public.protest_form_submissions;
create policy "Admins can view all form submissions"
  on public.protest_form_submissions for select
  using (public.is_admin());

-- Lets staff use Save Progress (and Download's silent save) on a customer's
-- behalf from the admin panel — signing itself stays customer-only, enforced
-- client-side (AdminCaseProgressModal passes allowSigning={false}), not by
-- these policies; rows still carry the customer's own user_id either way.
drop policy if exists "Admins can insert form submissions" on public.protest_form_submissions;
create policy "Admins can insert form submissions"
  on public.protest_form_submissions for insert
  with check (public.is_admin());

drop policy if exists "Admins can update all form submissions" on public.protest_form_submissions;
create policy "Admins can update all form submissions"
  on public.protest_form_submissions for update
  using (public.is_admin());

-- AI-computed "protest opportunity" score, generated once in the background right
-- after a property is added (see src/lib/property-scores.ts) so the dashboard can
-- show it without the user ever opening the on-demand AI Report page. Write-once,
-- like properties itself — no update/delete policy.
create table if not exists public.property_ai_scores (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  score integer not null,
  summary text not null,
  factors text[] not null default '{}',
  computed_at timestamptz not null default now()
);

alter table public.property_ai_scores enable row level security;

drop policy if exists "Users can view their own property AI scores" on public.property_ai_scores;
create policy "Users can view their own property AI scores"
  on public.property_ai_scores for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own property AI scores" on public.property_ai_scores;
create policy "Users can insert their own property AI scores"
  on public.property_ai_scores for insert
  with check (auth.uid() = user_id);

drop policy if exists "Admins can view all property AI scores" on public.property_ai_scores;
create policy "Admins can view all property AI scores"
  on public.property_ai_scores for select
  using (public.is_admin());

-- Records a user's signed authorization to let CorvusRF act as their tax agent for
-- a given protest (the "CorvusRF Managed" workspace path) — owner/entity details plus
-- a captured signature (drawn PNG data URL or typed text), collected via
-- ProtestAuthorizationFlow.tsx from the dashboard's "Request Protest Filing" action.
create table if not exists public.protest_authorizations (
  id uuid primary key default gen_random_uuid(),
  protest_id uuid references public.protests (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text not null,
  is_entity boolean not null default false,
  entity_name text,
  entity_relationship text,
  entity_type text,
  purchased_recently boolean,
  signature_type text not null check (signature_type in ('draw', 'type')),
  signature_data text not null,
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.protest_authorizations enable row level security;

drop policy if exists "Users can view their own protest authorizations" on public.protest_authorizations;
create policy "Users can view their own protest authorizations"
  on public.protest_authorizations for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own protest authorizations" on public.protest_authorizations;
create policy "Users can insert their own protest authorizations"
  on public.protest_authorizations for insert
  with check (auth.uid() = user_id);

drop policy if exists "Admins can view all protest authorizations" on public.protest_authorizations;
create policy "Admins can view all protest authorizations"
  on public.protest_authorizations for select
  using (public.is_admin());

-- Per-tax-year bill/payment/refund history for a property — closes the loop on the
-- savings estimate shown at intake, which otherwise never gets compared against what
-- the county actually billed. `properties.tax_amount_due`/`payment_due_date`/`paid_at`
-- stay as the "latest bill" snapshot the Deadlines page and dashboard home already
-- read; this table is the real history behind them and is kept in sync on write
-- rather than replacing those columns (see src/lib/tax-bills.ts).
create table if not exists public.tax_bills (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  tax_year integer,
  taxable_value numeric,
  tax_rate numeric,
  amount_due numeric,
  due_date date,
  penalty_date date,
  source_document_id uuid references public.documents (id) on delete set null,
  amount_paid numeric,
  paid_at timestamptz,
  payment_confirmation text,
  refund_amount numeric,
  refund_expected_at date,
  refund_received_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.tax_bills enable row level security;

drop policy if exists "Users can view their own tax bills" on public.tax_bills;
create policy "Users can view their own tax bills"
  on public.tax_bills for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own tax bills" on public.tax_bills;
create policy "Users can insert their own tax bills"
  on public.tax_bills for insert
  with check (auth.uid() = user_id);

-- Unlike properties/documents, tax bills are updated in place (mark paid, record a
-- refund) rather than only ever inserted, so — unusually for this schema — this table
-- needs an update policy.
drop policy if exists "Users can update their own tax bills" on public.tax_bills;
create policy "Users can update their own tax bills"
  on public.tax_bills for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete their own tax bills" on public.tax_bills;
create policy "Users can delete their own tax bills"
  on public.tax_bills for delete
  using (auth.uid() = user_id);

drop policy if exists "Admins can view all tax bills" on public.tax_bills;
create policy "Admins can view all tax bills"
  on public.tax_bills for select
  using (public.is_admin());

-- Property-value-tiered pricing: each paid tier now has 3 price points
-- (per src/lib/billing.ts's PropertyValueBracket) instead of one flat rate,
-- so a subscription's property count is tracked per bracket rather than as
-- a single number. subscription_quantity (above) is kept as the sum of the
-- three, unchanged, so existing "N properties" displays don't need to know
-- about brackets at all — only the checkout/pricing UI does.
alter table public.profiles add column if not exists qty_under_2m integer not null default 0;
alter table public.profiles add column if not exists qty_2m_10m integer not null default 0;
-- Despite the name, this is now the capped $10M-$25M bracket, not open-ended —
-- anything above $25M moved to billing.ts's CUSTOM_TIER, which has no quantity
-- or checkout at all (contact-us only), so it needs no column here.
alter table public.profiles add column if not exists qty_over_10m integer not null default 0;

-- "Add Ownerships" — an LLC/ownership name the user has searched and added
-- properties from (see src/components/AddOwnershipsModal.tsx and
-- cad-owner-search, which already searches by owner name across every county
-- that publishes one). Written once when properties are actually saved from a
-- search, not on every search itself — same "insert once, never edit in
-- place" shape as properties, so no update policy either.
create table if not exists public.ownerships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  role text not null check (role in ('owner', 'agent', 'property_manager')),
  created_at timestamptz not null default now()
);

alter table public.ownerships enable row level security;

drop policy if exists "Users can view their own ownerships" on public.ownerships;
create policy "Users can view their own ownerships"
  on public.ownerships for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own ownerships" on public.ownerships;
create policy "Users can insert their own ownerships"
  on public.ownerships for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own ownerships" on public.ownerships;
create policy "Users can delete their own ownerships"
  on public.ownerships for delete
  using (auth.uid() = user_id);

-- ── ONE-TIME MANUAL STEP — do NOT run this as part of the routine schema paste ──
-- After you have an account (sign up normally through the app first), run this once,
-- by itself, substituting your real email, to make that account an admin:
--
-- update public.profiles set is_admin = true where email = 'you@example.com';
