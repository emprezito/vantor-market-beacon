-- Trading servers are logical tenants on the shared Vantor engine. Each
-- account belongs to exactly one server, and account logins are unique per
-- server (MT5-style) rather than globally.

create table if not exists public.trading_servers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  kind text not null default 'vantor' check (kind in ('vantor', 'partner')),
  status text not null default 'active' check (status in ('active', 'paused')),
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  account_types text[] not null default array['Standard', 'Pro', 'Raw Spread'],
  currencies text[] not null default array['USD', 'EUR', 'GBP', 'NGN'],
  leverages integer[] not null default array[1, 10, 50, 100, 200, 500, 1000, 2000],
  min_balance numeric(14, 2) not null default 100,
  max_balance numeric(14, 2) not null default 1000000,
  default_account_type text not null default 'Standard',
  default_currency text not null default 'USD',
  default_leverage integer not null default 100,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint trading_servers_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint trading_servers_non_empty check (
    cardinality(account_types) > 0
    and cardinality(currencies) > 0
    and cardinality(leverages) > 0
  ),
  constraint trading_servers_balance_range check (
    min_balance >= 100
    and max_balance <= 1000000
    and max_balance >= min_balance
  ),
  constraint trading_servers_defaults check (
    default_account_type = any(account_types)
    and default_currency = any(currencies)
    and default_leverage = any(leverages)
  )
);

insert into public.trading_servers (slug, name, description, sort_order)
values (
  'vantor-1',
  'Vantor Server 1',
  'Trade forex, metals, indices and crypto on Vantor''s primary server.',
  0
)
on conflict (slug) do nothing;

alter table public.trading_accounts
  add column if not exists server_id uuid references public.trading_servers (id) on delete restrict;

update public.trading_accounts
   set server_id = (
     select id from public.trading_servers where slug = 'vantor-1'
   )
 where server_id is null;

update public.trading_accounts
   set server = 'Vantor Server 1'
 where server_id = (
   select id from public.trading_servers where slug = 'vantor-1'
 )
   and server in ('Vantor-Demo01', 'Vantor-server 1');

alter table public.trading_accounts
  alter column server_id set not null;

create index if not exists trading_accounts_by_server on public.trading_accounts (server_id);

-- Logins are unique within a server, not across the whole platform.
alter table public.trading_accounts
  drop constraint if exists trading_accounts_login_key;

create unique index if not exists trading_accounts_server_login_key
  on public.trading_accounts (server_id, login);

alter table public.trading_servers enable row level security;

drop policy if exists "active public trading servers are readable" on public.trading_servers;
create policy "active public trading servers are readable"
  on public.trading_servers for select
  to authenticated
  using (status = 'active' and visibility = 'public');

grant select on public.trading_servers to authenticated;
grant all privileges on public.trading_servers to service_role;
