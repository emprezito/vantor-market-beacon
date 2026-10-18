CREATE TABLE public.wallets (
  user_id uuid PRIMARY KEY,
  balance numeric(14,2) NOT NULL DEFAULT 10000,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.wallets TO authenticated;
GRANT ALL ON public.wallets TO service_role;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own wallet" ON public.wallets FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  symbol text NOT NULL,
  side text NOT NULL,
  lots numeric(10,2) NOT NULL,
  open_price numeric(18,6) NOT NULL,
  stop_loss numeric(18,6),
  take_profit numeric(18,6),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  close_price numeric(18,6),
  pnl numeric(14,2),
  close_reason text
);
CREATE INDEX positions_user_idx ON public.positions(user_id, closed_at);
GRANT SELECT ON public.positions TO authenticated;
GRANT ALL ON public.positions TO service_role;
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own positions" ON public.positions FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  amount numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own tx" ON public.transactions FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.handle_new_wallet()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.wallets(user_id, balance) VALUES (NEW.id, 10000) ON CONFLICT DO NOTHING;
  INSERT INTO public.transactions(user_id, kind, amount) VALUES (NEW.id, 'bonus', 10000);
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created_wallet AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_wallet();