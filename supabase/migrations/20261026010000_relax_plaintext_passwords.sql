alter table public.trading_accounts
  alter column trader_password drop not null,
  alter column investor_password drop not null;
