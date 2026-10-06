-- Imara Capital: email-login accounts.
-- profiles           one row per auth user, created automatically on sign-up
-- loan_applications  applications a signed-in user submits; users see only their own
-- Every table has RLS on; the anon role gets no table access at all.

-- ── helpers ────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── profiles ───────────────────────────────────────────────────────────────
create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  email              text,
  full_name          text check (char_length(full_name) <= 120),
  phone              text check (phone is null or phone ~ '^\+?[0-9]{9,15}$'),
  business_name      text check (char_length(business_name) <= 160),
  city               text check (city is null or city in ('Nairobi','Mombasa','Nakuru','Eldoret','Elsewhere')),
  preferred_language text not null default 'Kiswahili' check (preferred_language in ('Kiswahili','English')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.profiles is 'Borrower profile, one per auth user. Created by trigger on auth.users insert.';

alter table public.profiles enable row level security;

create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Users may edit their details, but never their id/email/timestamps.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, phone, business_name, city, preferred_language) on public.profiles to authenticated;

-- Create the profile row whenever a user signs up (password or magic link).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(left(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profiles.email in step when a user confirms an email change.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_user_email_change() from public, anon, authenticated;

-- ── loan_applications ──────────────────────────────────────────────────────
create type public.application_status as enum
  ('submitted', 'in_review', 'offer_sent', 'disbursed', 'declined', 'withdrawn');

create table public.loan_applications (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  full_name          text not null check (char_length(full_name) between 1 and 120),
  phone              text not null check (phone ~ '^\+?[0-9]{9,15}$'),
  business_name      text not null check (char_length(business_name) between 1 and 160),
  preferred_language text not null default 'Kiswahili' check (preferred_language in ('Kiswahili','English')),
  amount_ksh         integer not null check (amount_ksh between 100000 and 12000000),
  term_months        smallint not null check (term_months in (3, 6, 12, 18, 24)),
  location           text check (location is null or location in ('Nairobi','Mombasa','Nakuru','Eldoret','Elsewhere')),
  revenue_band       text check (revenue_band is null or revenue_band in ('Under 200K','200K – 500K','500K – 2M','Over 2M')),
  time_trading       text check (time_trading is null or time_trading in ('Under 1 year','1 – 3 years','Over 3 years')),
  status             public.application_status not null default 'submitted',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.loan_applications is 'Call-back applications from signed-in borrowers. Status is managed by staff (service role).';

create index loan_applications_user_id_created_at_idx
  on public.loan_applications (user_id, created_at desc);

alter table public.loan_applications enable row level security;

create policy "Users can read their own applications"
  on public.loan_applications for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can submit applications for themselves"
  on public.loan_applications for insert to authenticated
  with check ((select auth.uid()) = user_id and status = 'submitted');

create trigger loan_applications_set_updated_at
  before update on public.loan_applications
  for each row execute function public.set_updated_at();

-- Users insert and read; status changes and deletes are staff-only.
revoke all on public.loan_applications from anon, authenticated;
grant select on public.loan_applications to authenticated;
grant insert (full_name, phone, business_name, preferred_language, amount_ksh, term_months,
              location, revenue_band, time_trading)
  on public.loan_applications to authenticated;

-- Abuse guard: at most 5 applications per user in any 24 hours.
create or replace function public.limit_application_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.loan_applications
      where user_id = new.user_id and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'Too many applications in the last 24 hours. Please call your officer.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger loan_applications_rate_limit
  before insert on public.loan_applications
  for each row execute function public.limit_application_rate();

revoke execute on function public.limit_application_rate() from public, anon, authenticated;
