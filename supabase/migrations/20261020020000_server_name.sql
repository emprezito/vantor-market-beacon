alter table public.trading_accounts
  alter column server set default 'Vantor-server 1';

update public.trading_accounts
   set server = 'Vantor-server 1'
 where server = 'Vantor-Demo01';
