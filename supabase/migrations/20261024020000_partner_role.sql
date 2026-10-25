create table if not exists public.app_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('partner', 'platform_admin')),
  created_at timestamptz not null default now()
);

alter table public.app_roles enable row level security;

drop policy if exists "users can read their own app role" on public.app_roles;
create policy "users can read their own app role"
  on public.app_roles
  for select
  to authenticated
  using (user_id = auth.uid());

revoke all on table public.app_roles from anon;
grant select on table public.app_roles to authenticated;
grant all privileges on table public.app_roles to service_role;

insert into public.app_roles (user_id, role)
select id, 'partner'
from auth.users
where lower(email) = lower('emperorakporhiunu@gmail.com')
on conflict (user_id) do update set role = excluded.role;
