-- Imara Capital: users create and manage their own borrower profile.
-- Additive: keeps every existing profile row and the sign-up trigger.
--
-- profiles gains business details, a profile photo and profile_completed_at,
-- which the database (not the browser) sets once the required fields are
-- filled in. Users may INSERT their own row as well as UPDATE it, so the
-- app can upsert the profile even if the sign-up trigger never ran.
-- A private "avatars" storage bucket holds photos; each user can only touch
-- files inside their own folder: avatars/<user id>/...

-- ── new profile columns ────────────────────────────────────────────────────
alter table public.profiles
  alter column id set default auth.uid(),
  add column avatar_path          text,
  add column business_type        text,
  add column sector               text,
  add column registration_number  text,
  add column town                 text,
  add column years_trading        text,
  add column monthly_revenue      text,
  add column employees            text,
  add column business_description text,
  add column profile_completed_at timestamptz;

alter table public.profiles
  add constraint profiles_avatar_path_own_folder
    check (avatar_path is null or avatar_path like id::text || '/%'),
  add constraint profiles_business_type_valid
    check (business_type is null or business_type in
      ('Sole proprietor','Partnership','Limited company','Cooperative / Sacco','Other')),
  add constraint profiles_sector_valid
    check (sector is null or sector in
      ('Retail shop','Wholesale & distribution','Hardware & building materials','Agribusiness & farming',
       'Manufacturing','Transport & logistics','Hospitality & food','Textiles & tailoring',
       'Health & pharmacy','Services','Other')),
  add constraint profiles_registration_number_valid
    check (registration_number is null or registration_number ~ '^[A-Za-z0-9/ -]{3,40}$'),
  add constraint profiles_town_valid
    check (town is null or char_length(town) between 1 and 80),
  add constraint profiles_years_trading_valid
    check (years_trading is null or years_trading in ('Under 1 year','1 – 3 years','Over 3 years')),
  add constraint profiles_monthly_revenue_valid
    check (monthly_revenue is null or monthly_revenue in ('Under 200K','200K – 500K','500K – 2M','Over 2M')),
  add constraint profiles_employees_valid
    check (employees is null or employees in ('Just me','2 – 5','6 – 20','21 – 50','Over 50')),
  add constraint profiles_business_description_valid
    check (business_description is null or char_length(business_description) <= 500);

comment on column public.profiles.profile_completed_at is
  'Set by trigger when all required profile fields are present; cleared if any is removed. Not writable by users.';

-- ── completeness is decided by the database ────────────────────────────────
create or replace function public.set_profile_completed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.full_name is not null and new.phone is not null and new.business_name is not null
     and new.business_type is not null and new.sector is not null and new.city is not null
     and new.years_trading is not null and new.monthly_revenue is not null then
    new.profile_completed_at := coalesce(
      case when tg_op = 'UPDATE' then old.profile_completed_at end, now());
  else
    new.profile_completed_at := null;
  end if;
  return new;
end;
$$;

create trigger profiles_set_completed
  before insert or update on public.profiles
  for each row execute function public.set_profile_completed();

-- ── users can create their own profile row ─────────────────────────────────
create policy "Users can create their own profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

-- Column-level grants: identity, email and timestamps stay server-controlled.
grant insert (id, full_name, phone, business_name, city, preferred_language,
              avatar_path, business_type, sector, registration_number, town,
              years_trading, monthly_revenue, employees, business_description)
  on public.profiles to authenticated;
grant update (avatar_path, business_type, sector, registration_number, town,
              years_trading, monthly_revenue, employees, business_description)
  on public.profiles to authenticated;

-- ── profile photos: private bucket, one folder per user ────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "Users can view their own avatar"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users can upload their own avatar"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users can replace their own avatar"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users can delete their own avatar"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
