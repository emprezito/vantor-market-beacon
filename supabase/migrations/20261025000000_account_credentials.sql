-- Credential hardening for trading accounts. This migration is additive so the
-- legacy plain-text columns keep working until the backfill and the Pocket
-- cutover are complete.

alter table public.trading_accounts
  add column if not exists trader_hash text,
  add column if not exists investor_hash text,
  add column if not exists session_epoch integer not null default 0,
  add column if not exists status text not null default 'active';

alter table public.trading_accounts
  drop constraint if exists trading_accounts_status_check;
alter table public.trading_accounts
  add constraint trading_accounts_status_check check (status in ('active', 'disabled'));

create table if not exists public.login_attempts (
  ip text not null,
  login text not null,
  attempts integer not null default 0 check (attempts >= 0),
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (ip, login)
);

create index if not exists login_attempts_by_updated_at
  on public.login_attempts (updated_at);

alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from public, anon, authenticated;
grant all privileges on public.login_attempts to service_role;

-- Atomically records a failed login for both the (IP, login) pair and the IP
-- as a whole. Returns whether either bucket is blocked and for how long.
create or replace function public.record_login_failure(p_ip text, p_login text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip text := nullif(trim(p_ip), '');
  v_login text := nullif(trim(p_login), '');
  v_login_row public.login_attempts%rowtype;
  v_ip_row public.login_attempts%rowtype;
  v_login_limit constant integer := 5;
  v_ip_limit constant integer := 20;
  v_window constant interval := interval '15 minutes';
  v_retry integer := 0;
begin
  if v_ip is null then
    raise exception 'Missing client address';
  end if;
  if v_login is null then
    raise exception 'Missing login';
  end if;

  delete from public.login_attempts
   where updated_at < now() - interval '24 hours';

  insert into public.login_attempts as a
    (ip, login, attempts, window_started_at, blocked_until, updated_at)
  values
    (v_ip, v_login, 1, now(), null, now())
  on conflict (ip, login) do update
    set attempts = case
          when a.window_started_at <= now() - v_window then 1
          when a.blocked_until is not null and a.blocked_until > now() then a.attempts
          else a.attempts + 1
        end,
        window_started_at = case
          when a.window_started_at <= now() - v_window then now()
          else a.window_started_at
        end,
        blocked_until = case
          when a.blocked_until is not null and a.blocked_until > now() then a.blocked_until
          when (
            case
              when a.window_started_at <= now() - v_window then 1
              else a.attempts + 1
            end
          ) >= v_login_limit then now() + v_window
          else null
        end,
        updated_at = now()
  returning * into v_login_row;

  insert into public.login_attempts as a
    (ip, login, attempts, window_started_at, blocked_until, updated_at)
  values
    (v_ip, '*', 1, now(), null, now())
  on conflict (ip, login) do update
    set attempts = case
          when a.window_started_at <= now() - v_window then 1
          when a.blocked_until is not null and a.blocked_until > now() then a.attempts
          else a.attempts + 1
        end,
        window_started_at = case
          when a.window_started_at <= now() - v_window then now()
          else a.window_started_at
        end,
        blocked_until = case
          when a.blocked_until is not null and a.blocked_until > now() then a.blocked_until
          when (
            case
              when a.window_started_at <= now() - v_window then 1
              else a.attempts + 1
            end
          ) >= v_ip_limit then now() + v_window
          else null
        end,
        updated_at = now()
  returning * into v_ip_row;

  if v_login_row.blocked_until is not null and v_login_row.blocked_until > now() then
    v_retry := greatest(
      v_retry,
      ceil(extract(epoch from (v_login_row.blocked_until - now())))::integer
    );
  end if;

  if v_ip_row.blocked_until is not null and v_ip_row.blocked_until > now() then
    v_retry := greatest(
      v_retry,
      ceil(extract(epoch from (v_ip_row.blocked_until - now())))::integer
    );
  end if;

  return jsonb_build_object(
    'blocked', v_retry > 0,
    'retry_after_seconds', v_retry,
    'attempts', v_login_row.attempts,
    'ip_attempts', v_ip_row.attempts
  );
end;
$$;

revoke all on function public.record_login_failure(text, text)
  from public, anon, authenticated;
grant execute on function public.record_login_failure(text, text) to service_role;
