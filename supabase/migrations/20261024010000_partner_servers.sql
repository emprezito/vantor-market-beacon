-- Phase 2: private/invite servers, memberships and partner administration.

create table if not exists public.server_members (
  server_id uuid not null references public.trading_servers (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create index if not exists server_members_by_user on public.server_members (user_id);
create unique index if not exists server_members_one_owner
  on public.server_members (server_id)
  where role = 'owner';

create table if not exists public.server_access_codes (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.trading_servers (id) on delete cascade,
  code text not null unique,
  role text not null default 'member' check (role in ('admin', 'member')),
  max_uses integer not null default 1 check (max_uses > 0 and max_uses <= 1000),
  uses integer not null default 0 check (uses >= 0),
  expires_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint server_access_codes_uses_within_limit check (uses <= max_uses)
);

create index if not exists server_access_codes_by_server
  on public.server_access_codes (server_id, created_at desc);

alter table public.server_members enable row level security;
alter table public.server_access_codes enable row level security;

drop policy if exists "members can read their own server memberships" on public.server_members;
create policy "members can read their own server memberships"
  on public.server_members for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "active public trading servers are readable" on public.trading_servers;
drop policy if exists "trading servers readable to public or members" on public.trading_servers;
create policy "trading servers readable to public or members"
  on public.trading_servers for select
  to authenticated
  using (
    (status = 'active' and visibility = 'public')
    or exists (
      select 1
        from public.server_members m
       where m.server_id = trading_servers.id
         and m.user_id = auth.uid()
    )
  );

grant select on public.server_members to authenticated;
grant all privileges on public.server_members, public.server_access_codes to service_role;

create or replace function public.redeem_server_access_code(p_user uuid, p_code text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_code public.server_access_codes%rowtype;
  v_server public.trading_servers%rowtype;
  v_rows integer := 0;
  v_role text;
begin
  if p_user is null then
    raise exception 'You must be signed in';
  end if;
  if p_code is null or length(trim(p_code)) = 0 then
    raise exception 'Enter an access code';
  end if;

  select *
    into v_code
    from public.server_access_codes
   where code = upper(trim(p_code))
     for update;

  if not found then
    raise exception 'Invalid access code';
  end if;
  if v_code.revoked_at is not null then
    raise exception 'This access code has been revoked';
  end if;
  if v_code.expires_at is not null and v_code.expires_at <= now() then
    raise exception 'This access code has expired';
  end if;
  if v_code.uses >= v_code.max_uses then
    raise exception 'This access code has already been used';
  end if;

  select *
    into v_server
    from public.trading_servers
   where id = v_code.server_id;

  if not found then
    raise exception 'Trading server not found';
  end if;
  if v_server.status <> 'active' then
    raise exception 'This server is not accepting new members';
  end if;

  insert into public.server_members (server_id, user_id, role, created_by)
  values (v_code.server_id, p_user, v_code.role, v_code.created_by)
  on conflict (server_id, user_id) do nothing;

  get diagnostics v_rows = row_count;

  if v_rows = 0 and v_code.role = 'admin' then
    update public.server_members
       set role = 'admin'
     where server_id = v_code.server_id
       and user_id = p_user
       and role = 'member';
    get diagnostics v_rows = row_count;
  end if;

  if v_rows > 0 then
    update public.server_access_codes
       set uses = uses + 1
     where id = v_code.id;
  end if;

  select role
    into v_role
    from public.server_members
   where server_id = v_code.server_id
     and user_id = p_user;

  return jsonb_build_object(
    'server_id', v_server.id,
    'server_name', v_server.name,
    'role', v_role,
    'joined', v_rows > 0
  );
end;
$$;

revoke all on function public.redeem_server_access_code(uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_server_access_code(uuid, text) to service_role;
