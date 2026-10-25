-- Private partner servers are managed by partners only and stay hidden from traders.

drop policy if exists "trading servers readable to public or members" on public.trading_servers;
drop policy if exists "active public trading servers are readable" on public.trading_servers;

create policy "active public trading servers are readable"
  on public.trading_servers for select
  to authenticated
  using (status = 'active' and visibility = 'public');
