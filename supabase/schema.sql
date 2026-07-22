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
