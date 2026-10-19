CREATE TABLE public.trading_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login bigint NOT NULL UNIQUE,
  label text NOT NULL DEFAULT 'Standard',
  kind text NOT NULL DEFAULT 'demo',
  server text NOT NULL DEFAULT 'Vantor-Demo01',
  trader_password text NOT NULL,
  investor_password text NOT NULL,
  user_id uuid,
  access_role text,
  issued_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.trading_accounts TO authenticated;
GRANT ALL ON public.trading_accounts TO service_role;
ALTER TABLE public.trading_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own or issued accounts" ON public.trading_accounts FOR SELECT TO authenticated USING (auth.uid() = user_id OR auth.uid() = issued_by);
CREATE POLICY "insert own accounts" ON public.trading_accounts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);