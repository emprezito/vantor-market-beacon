-- KYC verification, real-account funding intents and Bachs payment events.

create table if not exists public.kyc_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'approved', 'rejected')),
  first_name text,
  last_name text,
  date_of_birth date,
  phone text,
  country text,
  city text,
  address_line1 text,
  address_line2 text,
  postal_code text,
  rejection_reason text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kyc_profiles_status_submitted
  on public.kyc_profiles (status, submitted_at);

create table if not exists public.kyc_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('identity', 'address')),
  file_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  created_at timestamptz not null default now(),
  unique (user_id, kind)
);

create index if not exists kyc_documents_user on public.kyc_documents (user_id);

create table if not exists public.deposit_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.trading_accounts (id) on delete cascade,
  provider text not null default 'bachs',
  provider_reference text not null unique,
  provider_checkout_id text,
  provider_charge_id text,
  amount numeric(14, 2) not null check (amount >= 1 and amount <= 1000000),
  paid_amount numeric(14, 2) check (paid_amount is null or paid_amount > 0),
  currency text not null,
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed', 'expired')),
  checkout_url text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.deposit_intents
  add column if not exists paid_amount numeric(14, 2)
    check (paid_amount is null or paid_amount > 0);

create index if not exists deposit_intents_user_created
  on public.deposit_intents (user_id, created_at desc);
create unique index if not exists deposit_intents_checkout
  on public.deposit_intents (provider_checkout_id)
  where provider_checkout_id is not null;

create table if not exists public.payment_events (
  id text primary key,
  type text not null,
  payload jsonb not null,
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.kyc_profiles enable row level security;
alter table public.kyc_documents enable row level security;
alter table public.deposit_intents enable row level security;
alter table public.payment_events enable row level security;

drop policy if exists "kyc profiles are private to their owner" on public.kyc_profiles;
create policy "kyc profiles are private to their owner"
  on public.kyc_profiles for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "kyc documents are private to their owner" on public.kyc_documents;
create policy "kyc documents are private to their owner"
  on public.kyc_documents for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "deposits are private to their owner" on public.deposit_intents;
create policy "deposits are private to their owner"
  on public.deposit_intents for select
  to authenticated
  using (user_id = auth.uid());

revoke all on table public.kyc_profiles, public.kyc_documents, public.deposit_intents
  from anon, authenticated;
revoke all on table public.payment_events from anon, authenticated;
grant select on table public.kyc_profiles, public.kyc_documents, public.deposit_intents
  to authenticated;
grant all privileges on table public.kyc_profiles, public.kyc_documents,
  public.deposit_intents, public.payment_events to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'kyc-documents',
  'kyc-documents',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "kyc owners upload documents" on storage.objects;
create policy "kyc owners upload documents"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'kyc-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "kyc owners read documents" on storage.objects;
create policy "kyc owners read documents"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'kyc-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "kyc owners replace documents" on storage.objects;
create policy "kyc owners replace documents"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'kyc-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'kyc-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "kyc owners delete documents" on storage.objects;
create policy "kyc owners delete documents"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'kyc-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop function if exists public.credit_real_account_deposit(uuid, text, text);

create or replace function public.credit_real_account_deposit(
  p_deposit uuid,
  p_checkout_id text,
  p_charge_id text,
  p_amount numeric default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_deposit public.deposit_intents%rowtype;
  v_balance numeric(14, 2);
  v_paid numeric(14, 2);
begin
  select *
    into v_deposit
    from public.deposit_intents
   where id = p_deposit
     for update;

  if not found then
    raise exception 'Deposit not found';
  end if;

  if v_deposit.status = 'succeeded' then
    select balance into v_balance
      from public.trading_accounts
     where id = v_deposit.account_id;

    return jsonb_build_object(
      'balance', v_balance,
      'amount', coalesce(v_deposit.paid_amount, v_deposit.amount),
      'already_processed', true
    );
  end if;

  if v_deposit.status not in ('pending', 'expired') then
    raise exception 'Deposit is not payable';
  end if;

  if nullif(p_checkout_id, '') is not null
     and v_deposit.provider_checkout_id is not null
     and v_deposit.provider_checkout_id <> p_checkout_id then
    raise exception 'Deposit checkout does not match';
  end if;

  v_paid := coalesce(p_amount, v_deposit.amount);
  if v_paid <= 0 or v_paid <> round(v_paid, 2) then
    raise exception 'Deposit amount is invalid';
  end if;

  update public.trading_accounts
     set balance = balance + v_paid
   where id = v_deposit.account_id
     and user_id = v_deposit.user_id
     and kind = 'real'
  returning balance into v_balance;

  if not found then
    raise exception 'Real trading account not found';
  end if;

  update public.deposit_intents
     set status = 'succeeded',
         paid_amount = v_paid,
         provider_checkout_id = coalesce(provider_checkout_id, nullif(p_checkout_id, '')),
         provider_charge_id = coalesce(provider_charge_id, nullif(p_charge_id, '')),
         completed_at = now(),
         updated_at = now()
   where id = v_deposit.id;

  insert into public.transactions (user_id, account_id, kind, amount)
  values (v_deposit.user_id, v_deposit.account_id, 'deposit', v_paid);

  return jsonb_build_object(
    'balance', v_balance,
    'amount', v_paid,
    'already_processed', false
  );
end;
$$;

revoke all on function public.credit_real_account_deposit(uuid, text, text, numeric)
  from public, anon, authenticated;
grant execute on function public.credit_real_account_deposit(uuid, text, text, numeric)
  to service_role;
