-- Imara Capital: roles (admin, employee, user), staff access and admin tooling.
--
--   user      default for everyone: own profile and applications only
--   employee  staff: read all customers/profiles/applications, change
--             application status, add internal notes
--   admin     everything employees can do, plus roles, user accounts
--             (via the admin-users Edge Function), audit log and system health
--
-- Role checks live in the `private` schema, which the Data API does not expose.

-- ── roles ──────────────────────────────────────────────────────────────────
create type public.app_role as enum ('user', 'employee', 'admin');

create table public.user_roles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       public.app_role not null default 'user',
  granted_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table public.user_roles is 'Role per user. No row = user. Changed only through public.admin_set_role() or the admin-users Edge Function.';

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.role_of(uid uuid)
returns public.app_role
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select r.role from public.user_roles r where r.user_id = uid), 'user'::public.app_role);
$$;

create or replace function private.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$ select private.role_of((select auth.uid())) = 'admin'; $$;

create or replace function private.is_staff()
returns boolean
language sql stable security definer
set search_path = ''
as $$ select private.role_of((select auth.uid())) in ('admin', 'employee'); $$;

revoke all on function private.role_of(uuid), private.is_admin(), private.is_staff() from public, anon;
grant execute on function private.role_of(uuid), private.is_admin(), private.is_staff() to authenticated;

alter table public.user_roles enable row level security;
create policy "Users read their own role; staff read all"
  on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_staff()));
revoke all on public.user_roles from anon, authenticated;
grant select on public.user_roles to authenticated;

/* Role of the signed-in user (for the website to decide what to show). */
create or replace function public.my_role()
returns public.app_role
language sql stable security definer
set search_path = ''
as $$ select private.role_of((select auth.uid())); $$;
revoke all on function public.my_role() from public, anon;
grant execute on function public.my_role() to authenticated;

-- ── audit log ──────────────────────────────────────────────────────────────
create table public.audit_log (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  actor_id       uuid,
  actor_email    text,
  action         text not null,
  target_user_id uuid,
  target_email   text,
  details        jsonb not null default '{}'::jsonb
);
create index audit_log_created_at_idx on public.audit_log (created_at desc);
create index audit_log_target_user_idx on public.audit_log (target_user_id);
comment on table public.audit_log is 'Append-only record of staff/admin actions. Readable by admins; written only by database functions and the admin-users Edge Function.';

alter table public.audit_log enable row level security;
create policy "Admins read the audit log"
  on public.audit_log for select to authenticated
  using ((select private.is_admin()));
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

create or replace function private.log_action(p_action text, p_target uuid, p_details jsonb default '{}'::jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (actor_id, actor_email, action, target_user_id, target_email, details)
  values (
    (select auth.uid()),
    (select u.email from auth.users u where u.id = (select auth.uid())),
    p_action,
    p_target,
    (select u.email from auth.users u where u.id = p_target),
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;
revoke all on function private.log_action(text, uuid, jsonb) from public, anon, authenticated;

-- ── staff access to customer data ──────────────────────────────────────────
create policy "Staff read all profiles"
  on public.profiles for select to authenticated
  using ((select private.is_staff()));

create policy "Admins update any profile"
  on public.profiles for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "Staff read all applications"
  on public.loan_applications for select to authenticated
  using ((select private.is_staff()));

create policy "Staff update application status"
  on public.loan_applications for update to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));
-- Only the status column; customers have no UPDATE policy so this grant is inert for them.
grant update (status) on public.loan_applications to authenticated;

create policy "Staff view all avatars"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (select private.is_staff()));

-- Record every application status change.
create or replace function private.log_application_status()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    perform private.log_action('application.status_changed', new.user_id,
      jsonb_build_object('application_id', new.id, 'from', old.status, 'to', new.status,
                         'amount_ksh', new.amount_ksh));
  end if;
  return new;
end;
$$;
create trigger loan_applications_log_status
  after update of status on public.loan_applications
  for each row execute function private.log_application_status();

-- ── internal notes on applications (staff only, never shown to customers) ──
create table public.application_notes (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.loan_applications (id) on delete cascade,
  author_id      uuid default auth.uid() references auth.users (id) on delete set null,
  body           text not null check (char_length(body) between 1 and 2000),
  created_at     timestamptz not null default now()
);
create index application_notes_application_idx on public.application_notes (application_id, created_at desc);
create index application_notes_author_idx on public.application_notes (author_id);
alter table public.application_notes enable row level security;
create policy "Staff read notes"
  on public.application_notes for select to authenticated
  using ((select private.is_staff()));
create policy "Staff add notes as themselves"
  on public.application_notes for insert to authenticated
  with check ((select private.is_staff()) and author_id = (select auth.uid()));
revoke all on public.application_notes from anon, authenticated;
grant select on public.application_notes to authenticated;
grant insert (application_id, body) on public.application_notes to authenticated;

-- ── staff / admin RPCs ─────────────────────────────────────────────────────

/* Customer directory for staff: auth details + profile + role, searchable. */
create or replace function public.admin_list_users(
  p_search text default null,
  p_role   public.app_role default null,
  p_limit  int default 50,
  p_offset int default 0
)
returns table (
  id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz,
  email_confirmed_at timestamptz, banned_until timestamptz, role public.app_role,
  full_name text, phone text, business_name text, city text, sector text,
  profile_completed_at timestamptz, avatar_path text, applications bigint, total_count bigint
)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  q text := nullif(trim(p_search), '');
begin
  if not private.is_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select u.id, u.email::text, u.created_at, u.last_sign_in_at, u.email_confirmed_at, u.banned_until,
         private.role_of(u.id), p.full_name, p.phone, p.business_name, p.city, p.sector,
         p.profile_completed_at, p.avatar_path,
         (select count(*) from public.loan_applications a where a.user_id = u.id),
         count(*) over ()
  from auth.users u
  left join public.profiles p on p.id = u.id
  where (q is null
         or u.email ilike '%' || q || '%'
         or p.full_name ilike '%' || q || '%'
         or p.business_name ilike '%' || q || '%'
         or p.phone ilike '%' || q || '%')
    and (p_role is null or private.role_of(u.id) = p_role)
  order by u.created_at desc
  limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end;
$$;

/* Change a user's role (admin only). Never leaves the site without an admin. */
create or replace function public.admin_set_role(p_user uuid, p_role public.app_role)
returns public.app_role
language plpgsql security definer
set search_path = ''
as $$
declare
  old_role public.app_role;
begin
  if not private.is_admin() then
    raise exception 'Only administrators can change roles' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  old_role := private.role_of(p_user);
  if old_role = p_role then
    return p_role;
  end if;
  if old_role = 'admin' and p_role <> 'admin'
     and (select count(*) from public.user_roles where role = 'admin') <= 1 then
    raise exception 'You cannot remove the last administrator' using errcode = 'P0001';
  end if;
  insert into public.user_roles (user_id, role, granted_by, updated_at)
  values (p_user, p_role, (select auth.uid()), now())
  on conflict (user_id) do update
    set role = excluded.role, granted_by = excluded.granted_by, updated_at = now();
  perform private.log_action('role.changed', p_user, jsonb_build_object('from', old_role, 'to', p_role));
  return p_role;
end;
$$;

/* Headline numbers for the staff overview (employees and admins). */
create or replace function public.staff_stats()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.is_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'users',               (select count(*) from auth.users),
    'new_users_7d',        (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'active_24h',          (select count(*) from auth.users where last_sign_in_at > now() - interval '24 hours'),
    'profiles_complete',   (select count(*) from public.profiles where profile_completed_at is not null),
    'applications',        (select count(*) from public.loan_applications),
    'applications_7d',     (select count(*) from public.loan_applications where created_at > now() - interval '7 days'),
    'amount_requested_ksh',(select coalesce(sum(amount_ksh), 0) from public.loan_applications),
    'applications_by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                               from (select status, count(*) n from public.loan_applications group by status) s),
    'signups_by_day',      (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'n', n) order by d), '[]'::jsonb)
                            from (select gs d, (select count(*) from auth.users u
                                               where u.created_at >= gs and u.created_at < gs + interval '1 day') n
                                  from generate_series(date_trunc('day', now()) - interval '13 days',
                                                       date_trunc('day', now()), interval '1 day') gs) x)
  );
end;
$$;

/* Database and platform health for administrators. */
create or replace function public.admin_system_status()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Only administrators can view system status' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'checked_at',      now(),
    'postgres',        split_part(version(), ' on ', 1),
    'started_at',      pg_postmaster_start_time(),
    'db_size_bytes',   pg_database_size(current_database()),
    'connections',     (select count(*) from pg_stat_activity where datname = current_database()),
    'max_connections', current_setting('max_connections')::int,
    'users', jsonb_build_object(
       'total',        (select count(*) from auth.users),
       'confirmed',    (select count(*) from auth.users where email_confirmed_at is not null),
       'unconfirmed',  (select count(*) from auth.users where email_confirmed_at is null),
       'suspended',    (select count(*) from auth.users where banned_until > now()),
       'active_7d',    (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
       'admins',       (select count(*) from public.user_roles where role = 'admin'),
       'employees',    (select count(*) from public.user_roles where role = 'employee'),
       'open_sessions',(select count(*) from auth.sessions)),
    'storage', jsonb_build_object(
       'avatars',      (select count(*) from storage.objects where bucket_id = 'avatars'),
       'avatar_bytes', (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects where bucket_id = 'avatars')),
    'tables', (select coalesce(jsonb_agg(jsonb_build_object(
                 'name', c.relname,
                 'rows', greatest(c.reltuples, 0)::bigint,
                 'exact_rows', case c.relname
                    when 'profiles' then (select count(*) from public.profiles)
                    when 'loan_applications' then (select count(*) from public.loan_applications)
                    when 'user_roles' then (select count(*) from public.user_roles)
                    when 'audit_log' then (select count(*) from public.audit_log)
                    when 'application_notes' then (select count(*) from public.application_notes)
                    end,
                 'size_bytes', pg_total_relation_size(c.oid),
                 'rls', c.relrowsecurity) order by c.relname), '[]'::jsonb)
               from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relkind = 'r'),
    'migrations', (select coalesce(jsonb_agg(jsonb_build_object('version', m.version, 'name', m.name) order by m.version desc), '[]'::jsonb)
                   from supabase_migrations.schema_migrations m),
    'recent_errors_note', 'Detailed API and database logs are in the Supabase dashboard (Logs).'
  );
end;
$$;

revoke all on function public.admin_list_users(text, public.app_role, int, int),
                       public.admin_set_role(uuid, public.app_role),
                       public.staff_stats(),
                       public.admin_system_status() from public, anon;
grant execute on function public.admin_list_users(text, public.app_role, int, int),
                          public.admin_set_role(uuid, public.app_role),
                             public.staff_stats(),
                          public.admin_system_status() to authenticated;

-- ── first administrator: the site owner's account ───────────────────────────
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where lower(email) = 'fayann506@gmail.com'
on conflict (user_id) do update set role = 'admin', updated_at = now();

insert into public.audit_log (action, target_user_id, target_email, details)
select 'role.changed', id, email, jsonb_build_object('from', 'user', 'to', 'admin', 'via', 'initial setup migration')
from auth.users where lower(email) = 'fayann506@gmail.com';
