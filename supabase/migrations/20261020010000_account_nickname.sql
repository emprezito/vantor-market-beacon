-- Give every trading account a user-facing nickname so traders can tell
-- multiple accounts apart at a glance.
alter table public.trading_accounts
  add column if not exists nickname text;

update public.trading_accounts
   set nickname = 'Account ' || login
 where nickname is null;

alter table public.trading_accounts
  alter column nickname set default 'Demo account';

alter table public.trading_accounts
  alter column nickname set not null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'trading_accounts_nickname_length'
       and conrelid = 'public.trading_accounts'::regclass
  ) then
    alter table public.trading_accounts
      add constraint trading_accounts_nickname_length
      check (char_length(nickname) between 1 and 24);
  end if;
end $$;
