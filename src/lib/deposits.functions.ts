import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  supportsRealDeposits,
  validateDepositAmount,
  type DepositIntentView,
  type DepositStatus,
} from "./real-deposits";

type DepositRow = {
  id: string;
  account_id: string;
  amount: number | string;
  currency: string;
  status: string;
  checkout_url: string | null;
  failure_reason: string | null;
  created_at: string;
  completed_at: string | null;
};

function depositView(row: DepositRow): DepositIntentView {
  return {
    id: row.id,
    accountId: row.account_id,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status as DepositStatus,
    checkoutUrl: row.checkout_url,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function accountId(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error("Choose a real account");
  }
  return value;
}

function requestOrigin(): string {
  const runtime = (globalThis as typeof globalThis & { __env__?: Record<string, string> }).__env__;
  const fallback = (
    runtime?.["PUBLIC_BROKER_BASE_URL"] ??
    process.env["PUBLIC_BROKER_BASE_URL"] ??
    ""
  ).replace(/\/+$/, "");
  return fallback || "http://localhost:4173";
}

export const listRealDeposits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("deposit_intents")
      .select(
        "id, account_id, amount, currency, status, checkout_url, failure_reason, created_at, completed_at",
      )
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error("Could not load deposits");
    return ((data ?? []) as DepositRow[]).map(depositView);
  });

export const createRealDeposit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { accountId: string; amount: number }) => ({
    accountId: accountId(input.accountId),
    amount: Number(input.amount),
  }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requireKycApproved } = await import("@/lib/kyc.server");
    const { bachsApiKey, bachsWebhookSecret, createBachsCheckout } =
      await import("@/lib/bachs.server");

    const { data: account, error: accountError } = await context.supabase
      .from("trading_accounts")
      .select("id, kind, currency, status")
      .eq("id", data.accountId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (accountError) throw new Error("Could not load the account. Please try again.");
    if (!account) throw new Error("Real account not found");
    if (account.kind !== "real") throw new Error("Choose a real account");
    if (account.status !== "active") throw new Error("This account is not active");
    if (!supportsRealDeposits(account.currency)) {
      throw new Error("Deposits are available in USD and NGN");
    }
    const amount = validateDepositAmount(data.amount, account.currency);
    await requireKycApproved(supabaseAdmin, context.userId);
    bachsApiKey();
    bachsWebhookSecret();

    const reference = `VD-${crypto.randomUUID().replace(/-/g, "")}`;
    const { data: deposit, error: insertError } = await supabaseAdmin
      .from("deposit_intents")
      .insert({
        user_id: context.userId,
        account_id: account.id,
        provider: "bachs",
        provider_reference: reference,
        amount,
        currency: account.currency,
        status: "pending",
      })
      .select("id")
      .single();
    if (insertError || !deposit) throw new Error("Could not create the deposit");

    const email = typeof context.claims.email === "string" ? context.claims.email : undefined;
    let checkout: Awaited<ReturnType<typeof createBachsCheckout>>;
    try {
      checkout = await createBachsCheckout({
        amount,
        currency: account.currency,
        reference,
        metadata: { deposit_id: deposit.id, account_id: account.id },
        successUrl: `${requestOrigin()}/accounts`,
        cancelUrl: `${requestOrigin()}/accounts`,
        ...(email ? { email } : {}),
      });
    } catch (error) {
      await supabaseAdmin
        .from("deposit_intents")
        .update({
          status: "failed",
          failure_reason: error instanceof Error ? error.message.slice(0, 300) : "Payment failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", deposit.id);
      throw error;
    }

    const { error: updateError } = await supabaseAdmin
      .from("deposit_intents")
      .update({
        provider_checkout_id: checkout.checkoutId,
        checkout_url: checkout.checkoutUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", deposit.id);
    if (updateError) {
      await supabaseAdmin
        .from("deposit_intents")
        .update({
          status: "failed",
          failure_reason: "Could not confirm the payment session",
          updated_at: new Date().toISOString(),
        })
        .eq("id", deposit.id);
      throw new Error("Could not start the payment. Please try again.");
    }

    return {
      id: deposit.id,
      checkoutUrl: checkout.checkoutUrl,
      amount,
      currency: account.currency,
      status: "pending" as const,
    };
  });
