-- Vantor Market Beacon — initial schema for a fresh Supabase project.
-- Apply with the direct/session-pooler Postgres connection string:
--   bun run db:apply -- "postgresql://postgres.<ref>:<password>@<host>:5432/postgres"

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.wallets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance numeric(14, 2) not null default 10000.00,
  created_at timestamptz not null default now()
);

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null,
  side text not null,
  lots numeric(10, 2) not null,
  open_price numeric(18, 6) not null,
  stop_loss numeric(18, 6),
  take_profit numeric(18, 6),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  close_price numeric(18, 6),
  close_reason text,
  pnl numeric(14, 2)
);
create index if not exists positions_open_by_user on public.positions (user_id) where closed_at is null;

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  amount numeric(14, 2) not null,
  created_at timestamptz not null default now()
);
create index if not exists transactions_by_user on public.transactions (user_id, created_at desc);

create table if not exists public.trading_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  issued_by uuid references auth.users (id) on delete set null,
  login bigint not null unique,
  label text not null default 'Standard',
  kind text not null default 'demo',
  server text not null default 'Vantor-Demo01',
  trader_password text not null,
  investor_password text not null,
  access_role text,
  created_at timestamptz not null default now()
);
create index if not exists trading_accounts_by_user on public.trading_accounts (user_id);
create index if not exists trading_accounts_by_issuer on public.trading_accounts (issued_by);

create table if not exists public.trader_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  trader_user_id uuid not null references auth.users (id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now()
);
create index if not exists trader_accounts_by_owner on public.trader_accounts (owner_user_id);

-- ---------------------------------------------------------------------------
-- Row level security: authenticated users can read their own rows only.
-- All mutations go through server functions using the service role.
-- ---------------------------------------------------------------------------

alter table public.wallets enable row level security;
alter table public.positions enable row level security;
alter table public.transactions enable row level security;
alter table public.trading_accounts enable row level security;
alter table public.trader_accounts enable row level security;

drop policy if exists "wallets are private to their owner" on public.wallets;
create policy "wallets are private to their owner"
  on public.wallets for select
  using (auth.uid() = user_id);

drop policy if exists "positions are private to their owner" on public.positions;
create policy "positions are private to their owner"
  on public.positions for select
  using (auth.uid() = user_id);

drop policy if exists "transactions are private to their owner" on public.transactions;
create policy "transactions are private to their owner"
  on public.transactions for select
  using (auth.uid() = user_id);

drop policy if exists "trading accounts visible to owner and issuer" on public.trading_accounts;
create policy "trading accounts visible to owner and issuer"
  on public.trading_accounts for select
  using (auth.uid() = user_id or auth.uid() = issued_by);

drop policy if exists "trader links visible to their owner" on public.trader_accounts;
create policy "trader links visible to their owner"
  on public.trader_accounts for select
  using (auth.uid() = owner_user_id);

drop policy if exists "owners create trader links" on public.trader_accounts;
create policy "owners create trader links"
  on public.trader_accounts for insert
  with check (auth.uid() = owner_user_id);

drop policy if exists "owners remove trader links" on public.trader_accounts;
create policy "owners remove trader links"
  on public.trader_accounts for delete
  using (auth.uid() = owner_user_id);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;
grant select on public.wallets, public.positions, public.transactions, public.trading_accounts to authenticated;
grant select, insert, delete on public.trader_accounts to authenticated;
grant all privileges on public.wallets, public.positions, public.transactions, public.trading_accounts, public.trader_accounts to service_role;

-- ---------------------------------------------------------------------------
-- New auth users get a demo wallet with $10,000 and the matching bonus entry.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.wallets (user_id) values (new.id)
  on conflict (user_id) do nothing;

  insert into public.transactions (user_id, kind, amount)
  values (new.id, 'bonus', 10000.00);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Atomic demo operations (open/close/deposit/withdraw).
-- Callable by the service role only. Rejects stale snapshots so concurrent
-- tabs cannot double-spend or close a position twice.
-- ---------------------------------------------------------------------------

create or replace function public.apply_demo_operation(
  p_user uuid,
  p_action text,
  p_expected_balance numeric,
  p_expected_positions uuid[],
  p_payload jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_balance numeric(14, 2);
  v_ids uuid[];
  v_expected uuid[];
  v_amount numeric;
  v_pnl numeric;
  v_used numeric;
  v_floating numeric;
  v_margin numeric;
begin
  select balance into v_balance
    from public.wallets
   where user_id = p_user
     for update;

  if not found then
    raise exception 'Demo account not found';
  end if;

  if v_balance <> p_expected_balance then
    raise exception 'Your account changed while this request was processed. Please try again.';
  end if;

  select coalesce(array_agg(x order by x), '{}')
    into v_expected
    from unnest(coalesce(p_expected_positions, '{}')) as x;

  select coalesce(array_agg(id order by id), '{}')
    into v_ids
    from public.positions
   where user_id = p_user
     and closed_at is null;

  if v_ids <> v_expected then
    raise exception 'Your open positions changed while this request was processed. Please try again.';
  end if;

  if p_action = 'open' then
    v_margin := (p_payload->>'margin')::numeric;
    v_used := (p_payload->>'used')::numeric;
    v_floating := (p_payload->>'floating')::numeric;

    if v_margin > v_balance + v_floating - v_used then
      raise exception 'Not enough free margin';
    end if;

    insert into public.positions (user_id, symbol, side, lots, open_price, stop_loss, take_profit)
    values (
      p_user,
      p_payload->>'symbol',
      p_payload->>'side',
      (p_payload->>'lots')::numeric,
      (p_payload->>'price')::numeric,
      (p_payload->>'stopLoss')::numeric,
      (p_payload->>'takeProfit')::numeric
    );

  elsif p_action = 'close' then
    v_pnl := (p_payload->>'pnl')::numeric;

    update public.positions
       set closed_at = now(),
           close_price = (p_payload->>'price')::numeric,
           close_reason = p_payload->>'reason',
           pnl = v_pnl
     where id = (p_payload->>'id')::uuid
       and user_id = p_user
       and closed_at is null;

    if not found then
      raise exception 'Position not found';
    end if;

    update public.wallets set balance = balance + v_pnl where user_id = p_user;

  elsif p_action in ('deposit', 'withdraw') then
    v_amount := (p_payload->>'amount')::numeric;
    v_used := (p_payload->>'used')::numeric;
    v_floating := (p_payload->>'floating')::numeric;

    if p_action = 'withdraw' and v_amount > v_balance + v_floating - v_used then
      raise exception 'You can not withdraw money used as margin or more than your available funds';
    end if;

    update public.wallets
       set balance = balance + case when p_action = 'deposit' then v_amount else -v_amount end
     where user_id = p_user;

    insert into public.transactions (user_id, kind, amount)
    values (p_user, p_action, v_amount);

  else
    raise exception 'Unknown demo operation';
  end if;

  return jsonb_build_object(
    'balance',
    (select balance from public.wallets where user_id = p_user)
  );
end;
$$;

revoke all on function public.apply_demo_operation(uuid, text, numeric, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.apply_demo_operation(uuid, text, numeric, uuid[], jsonb) to service_role;
revoke all on function public.handle_new_user() from public, anon, authenticated;
