CREATE TABLE public.trader_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  trader_user_id uuid NOT NULL UNIQUE,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.trader_accounts TO authenticated;
GRANT ALL ON public.trader_accounts TO service_role;
ALTER TABLE public.trader_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners read own trader accounts" ON public.trader_accounts FOR SELECT TO authenticated USING (auth.uid() = owner_user_id);
CREATE POLICY "owners insert own trader accounts" ON public.trader_accounts FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "owners delete own trader accounts" ON public.trader_accounts FOR DELETE TO authenticated USING (auth.uid() = owner_user_id);