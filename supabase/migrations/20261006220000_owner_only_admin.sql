-- Imara Capital: administration belongs to the site owner only.
--
-- The owner is fayann506@gmail.com (Faith Ndung'u). The lock is by user id,
-- so it still holds if the owner later changes the account's email address.
--   * nobody else can ever be given the admin role (any path: console,
--     Edge Function, SQL with the secret key)
--   * the owner's account can never lose the admin role
-- Customers keep using the site normally; employees keep their staff tools.

create table if not exists private.app_settings (
  key   text primary key,
  value text not null
);
revoke all on private.app_settings from public, anon, authenticated;

insert into private.app_settings (key, value)
select 'owner_user_id', id::text from auth.users where lower(email) = 'fayann506@gmail.com'
on conflict (key) do update set value = excluded.value;

create or replace function private.owner_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$ select value::uuid from private.app_settings where key = 'owner_user_id'; $$;
revoke all on function private.owner_id() from public, anon, authenticated;

create or replace function private.enforce_owner_only_admin()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.role = 'admin' and new.user_id is distinct from private.owner_id() then
    raise exception 'Only the site owner can be an administrator' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.user_id = private.owner_id() and new.role <> 'admin' then
    raise exception 'The site owner always stays an administrator' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_owner_only_admin() from public, anon, authenticated;

create trigger user_roles_owner_only_admin
  before insert or update on public.user_roles
  for each row execute function private.enforce_owner_only_admin();

-- Make sure the owner is (and stays) the administrator.
insert into public.user_roles (user_id, role)
select private.owner_id(), 'admin'
where private.owner_id() is not null
on conflict (user_id) do update set role = 'admin', updated_at = now();
