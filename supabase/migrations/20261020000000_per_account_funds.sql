alter table public.trading_accounts
  add column if not exists balance numeric(14, 2) not null default 10000.00,
  add column if not exists currency text not null default 'USD',
  add column if not exists leverage integer not null default 100;

alter table public.positions
  add column if not exists account_id uuid references public.trading_accounts (id) on delete cascade;
create index if not exists positions_by_account on public.positions (account_id) where closed_at is null;

alter table public.transactions
  add column if not exists account_id uuid references public.trading_accounts (id) on delete cascade;
create index if not exists transactions_by_account on public.transactions (account_id, created_at desc);

update public.trading_accounts ta
   set balance = w.balance
  from public.wallets w
 where ta.user_id = w.user_id
   and ta.id = (
     select t2.id
       from public.trading_accounts t2
      where t2.user_id = ta.user_id
      order by t2.created_at desc, t2.id
      limit 1
   );

update public.positions p
   set account_id = (
     select ta.id
       from public.trading_accounts ta
      where ta.user_id = p.user_id
      order by ta.created_at desc, ta.id
      limit 1
   )
 where p.account_id is null;

update public.transactions t
   set account_id = (
     select ta.id
       from public.trading_accounts ta
      where ta.user_id = t.user_id
      order by ta.created_at desc, ta.id
      limit 1
   )
 where t.account_id is null;

drop function if exists public.apply_demo_operation(uuid, text, numeric, uuid[], jsonb);

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
    );

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
    (select balance from public.trading_accounts where id = p_account)
  );
end;
$$;

revoke all on function public.apply_demo_operation(uuid, uuid, text, numeric, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.apply_demo_operation(uuid, uuid, text, numeric, uuid[], jsonb) to service_role;
