-- Apply only after every account has hashes and Pocket Markets has stopped
-- reading the plain-text columns.

alter table public.trading_accounts
  drop column if exists trader_password,
  drop column if exists investor_password;

revoke select on public.trading_accounts from authenticated;
grant select (
  id,
  user_id,
  issued_by,
  login,
  label,
  kind,
  server,
  server_id,
  access_role,
  balance,
  currency,
  leverage,
  nickname,
  session_epoch,
  status,
  created_at
) on public.trading_accounts to authenticated;
