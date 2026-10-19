CREATE OR REPLACE FUNCTION public.apply_demo_operation(p_user uuid, p_action text, p_expected_balance numeric, p_expected_positions uuid[], p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_balance numeric; v_ids uuid[]; v_amount numeric; v_next numeric; v_id uuid; v_pnl numeric;
BEGIN
  SELECT balance INTO v_balance FROM public.wallets WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demo wallet not found'; END IF;
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]) INTO v_ids FROM public.positions WHERE user_id = p_user AND closed_at IS NULL;
  IF v_balance IS DISTINCT FROM p_expected_balance OR v_ids IS DISTINCT FROM COALESCE(p_expected_positions, ARRAY[]::uuid[]) THEN RAISE EXCEPTION 'Account changed. Please try again.'; END IF;
  IF p_action = 'open' THEN
    IF (p_payload->>'margin')::numeric > v_balance + (p_payload->>'floating')::numeric - (p_payload->>'used')::numeric THEN RAISE EXCEPTION 'Not enough free margin'; END IF;
    INSERT INTO public.positions(user_id, symbol, side, lots, open_price, stop_loss, take_profit) VALUES (p_user, p_payload->>'symbol', p_payload->>'side', (p_payload->>'lots')::numeric, (p_payload->>'price')::numeric, (p_payload->>'stopLoss')::numeric, (p_payload->>'takeProfit')::numeric) RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id);
  ELSIF p_action = 'close' THEN
    v_pnl := round((p_payload->>'pnl')::numeric, 2);
    UPDATE public.positions SET closed_at = now(), close_price = (p_payload->>'price')::numeric, pnl = v_pnl, close_reason = p_payload->>'reason' WHERE id = (p_payload->>'id')::uuid AND user_id = p_user AND closed_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Position not found'; END IF;
    UPDATE public.wallets SET balance = balance + v_pnl WHERE user_id = p_user;
  ELSIF p_action IN ('deposit', 'withdraw') THEN
    v_amount := (p_payload->>'amount')::numeric;
    IF v_amount < 1 OR v_amount > 1000000 OR v_amount <> round(v_amount, 2) THEN RAISE EXCEPTION 'Amount must be between $1 and $1,000,000 with at most two decimals'; END IF;
    IF p_action = 'withdraw' AND v_amount > LEAST(v_balance, v_balance + (p_payload->>'floating')::numeric - (p_payload->>'used')::numeric) THEN RAISE EXCEPTION 'Not enough available funds'; END IF;
    v_next := v_balance + CASE WHEN p_action = 'deposit' THEN v_amount ELSE -v_amount END;
    UPDATE public.wallets SET balance = v_next WHERE user_id = p_user;
    INSERT INTO public.transactions(user_id, kind, amount) VALUES (p_user, p_action, v_amount);
  ELSE RAISE EXCEPTION 'Invalid demo operation'; END IF;
  SELECT balance INTO v_balance FROM public.wallets WHERE user_id = p_user;
  RETURN jsonb_build_object('balance', v_balance);
END $$;
REVOKE ALL ON FUNCTION public.apply_demo_operation(uuid, text, numeric, uuid[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_demo_operation(uuid, text, numeric, uuid[], jsonb) TO service_role;