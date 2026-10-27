create table if not exists public.terminal_idempotency (
  account_id uuid not null references public.trading_accounts (id) on delete cascade,
  idempotency_key uuid not null,
  request_hash text not null,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  response jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  primary key (account_id, idempotency_key)
);

create index if not exists terminal_idempotency_expiry on public.terminal_idempotency (expires_at);

alter table public.terminal_idempotency enable row level security;
revoke all on public.terminal_idempotency from public, anon, authenticated;
grant all privileges on public.terminal_idempotency to service_role;

create or replace function public.apply_demo_operation(
  p_user uuid,
  p_account uuid,
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
  v_owner uuid;
  v_balance numeric(14, 2);
  v_ids uuid[];
  v_expected uuid[];
  v_amount numeric;
  v_pnl numeric;
  v_used numeric;
  v_floating numeric;
  v_margin numeric;
  v_position_id uuid;
  v_order_id uuid;
  v_order public.pending_orders%rowtype;
begin
  select user_id, balance into v_owner, v_balance
    from public.trading_accounts
   where id = p_account
     for update;

  if not found then
    raise exception 'Trading account not found';
  end if;

  if v_owner <> p_user then
    raise exception 'Trading account not found';
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
   where account_id = p_account
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

    insert into public.positions (user_id, account_id, symbol, side, lots, open_price, stop_loss, take_profit)
    values (
      p_user,
      p_account,
      p_payload->>'symbol',
      p_payload->>'side',
      (p_payload->>'lots')::numeric,
      (p_payload->>'price')::numeric,
      (p_payload->>'stopLoss')::numeric,
      (p_payload->>'takeProfit')::numeric
    )
    returning id into v_position_id;

  elsif p_action = 'place_limit' then
    insert into public.pending_orders (user_id, account_id, symbol, side, lots, limit_price, stop_loss, take_profit)
    values (
      p_user,
      p_account,
      p_payload->>'symbol',
      p_payload->>'side',
      (p_payload->>'lots')::numeric,
      (p_payload->>'limitPrice')::numeric,
      (p_payload->>'stopLoss')::numeric,
      (p_payload->>'takeProfit')::numeric
    )
    returning id into v_order_id;

  elsif p_action = 'cancel_limit' then
    update public.pending_orders
       set status = 'cancelled',
           cancelled_at = now()
     where id = (p_payload->>'id')::uuid
       and account_id = p_account
       and status = 'pending';

    if not found then
      raise exception 'Pending order not found';
    end if;

  elsif p_action = 'fill_limit' then
    select *
      into v_order
      from public.pending_orders
     where id = (p_payload->>'id')::uuid
       and account_id = p_account
       and status = 'pending'
       for update;

    if not found then
      raise exception 'Pending order not found';
    end if;

    v_margin := (p_payload->>'margin')::numeric;
    v_used := (p_payload->>'used')::numeric;
    v_floating := (p_payload->>'floating')::numeric;

    if v_margin > v_balance + v_floating - v_used then
      raise exception 'Not enough free margin';
    end if;

    insert into public.positions (user_id, account_id, symbol, side, lots, open_price, stop_loss, take_profit)
    values (
      p_user,
      p_account,
      v_order.symbol,
      v_order.side,
      v_order.lots,
      (p_payload->>'price')::numeric,
      v_order.stop_loss,
      v_order.take_profit
    )
    returning id into v_position_id;

    update public.pending_orders
       set status = 'filled',
           triggered_at = now(),
           position_id = v_position_id
     where id = v_order.id;

  elsif p_action = 'close' then
    v_pnl := (p_payload->>'pnl')::numeric;

    update public.positions
       set closed_at = now(),
           close_price = (p_payload->>'price')::numeric,
           close_reason = p_payload->>'reason',
           pnl = v_pnl
     where id = (p_payload->>'id')::uuid
       and account_id = p_account
       and closed_at is null;

    if not found then
      raise exception 'Position not found';
    end if;

    update public.trading_accounts set balance = balance + v_pnl where id = p_account;

  elsif p_action = 'modify' then
    update public.positions
       set stop_loss = case
             when p_payload ? 'stopLoss' then nullif(p_payload->>'stopLoss', '')::numeric
             else stop_loss
           end,
           take_profit = case
             when p_payload ? 'takeProfit' then nullif(p_payload->>'takeProfit', '')::numeric
             else take_profit
           end
     where id = (p_payload->>'id')::uuid
       and account_id = p_account
       and closed_at is null;

    if not found then
      raise exception 'Position not found';
    end if;

  elsif p_action in ('deposit', 'withdraw') then
    v_amount := (p_payload->>'amount')::numeric;
    v_used := (p_payload->>'used')::numeric;
    v_floating := (p_payload->>'floating')::numeric;

    if p_action = 'withdraw' and v_amount > v_balance + v_floating - v_used then
      raise exception 'You can not withdraw money used as margin or more than your available funds';
    end if;

    update public.trading_accounts
       set balance = balance + case when p_action = 'deposit' then v_amount else -v_amount end
     where id = p_account;

    insert into public.transactions (user_id, account_id, kind, amount)
    values (p_user, p_account, p_action, v_amount);

  else
    raise exception 'Unknown demo operation';
  end if;

  return jsonb_build_object(
    'balance',
    (select balance from public.trading_accounts where id = p_account),
    'position_id',
    v_position_id,
    'pending_order_id',
    v_order_id
  );
end;
$$;

revoke all on function public.apply_demo_operation(uuid, uuid, text, numeric, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.apply_demo_operation(uuid, uuid, text, numeric, uuid[], jsonb) to service_role;
