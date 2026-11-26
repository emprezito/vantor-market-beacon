import type { Json } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { bachsWebhookSecret, verifyBachsSignature } from "./bachs.server";

type BachsEvent = {
  id: string;
  type: string;
  data?: Record<string, unknown> | null;
};

type DepositRow = {
  id: string;
  user_id: string;
  account_id: string;
  amount: number | string;
  currency: string;
  status: string;
  provider_checkout_id: string | null;
  provider_reference: string;
};

function eventData(event: BachsEvent): Record<string, unknown> {
  return typeof event.data === "object" && event.data !== null ? event.data : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toCents(value: unknown): number | null {
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  return Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
}

function paidAmount(value: unknown): number | null {
  const cents = toCents(value);
  return cents != null && cents > 0 ? cents / 100 : null;
}

async function findDeposit(
  checkoutId: string | null,
  reference: string | null,
): Promise<DepositRow | null> {
  if (!checkoutId && !reference) return null;
  const select =
    "id, user_id, account_id, amount, currency, status, provider_checkout_id, provider_reference";
  if (checkoutId) {
    const { data, error } = await supabaseAdmin
      .from("deposit_intents")
      .select(select)
      .eq("provider_checkout_id", checkoutId)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("Could not load the deposit");
    if (data) return data as DepositRow;
  }
  if (reference) {
    const { data, error } = await supabaseAdmin
      .from("deposit_intents")
      .select(select)
      .eq("provider_reference", reference)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("Could not load the deposit");
    if (data) return data as DepositRow;
  }
  return null;
}

async function recordEvent(event: BachsEvent): Promise<boolean> {
  const { error } = await supabaseAdmin.from("payment_events").insert({
    id: event.id,
    type: event.type,
    payload: event as Json,
  });
  if (!error) return true;
  if (error.code !== "23505") throw new Error("Could not record the payment event");
  const { data, error: readError } = await supabaseAdmin
    .from("payment_events")
    .select("processed_at, error")
    .eq("id", event.id)
    .maybeSingle();
  if (readError) throw new Error("Could not load the payment event");
  if (data?.processed_at) return false;
  return true;
}

async function markEvent(id: string, error?: string): Promise<void> {
  await supabaseAdmin
    .from("payment_events")
    .update(
      error
        ? { processed_at: null, error: error.slice(0, 500) }
        : { processed_at: new Date().toISOString(), error: null },
    )
    .eq("id", id);
}

async function handleExpired(event: BachsEvent): Promise<boolean> {
  const data = eventData(event);
  const deposit = await findDeposit(text(data["checkout_id"]), text(data["reference"]));
  if (!deposit) {
    await markEvent(event.id, "Deposit not found");
    return true;
  }
  const { error } = await supabaseAdmin
    .from("deposit_intents")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("id", deposit.id)
    .eq("status", "pending");
  if (error) throw new Error("Could not expire the deposit");
  await markEvent(event.id);
  return true;
}

async function handlePaid(event: BachsEvent): Promise<boolean> {
  const data = eventData(event);
  const checkoutId = text(data["checkout_id"]);
  const reference = text(data["reference"]);
  const deposit = await findDeposit(checkoutId, reference);
  if (!deposit) throw new Error("Deposit not found");

  const charge =
    typeof data["charge"] === "object" && data["charge"] !== null
      ? (data["charge"] as Record<string, unknown>)
      : null;
  const amount = paidAmount(data["amount"] ?? charge?.["amount"]);
  const currency = text(data["currency"]) ?? text(charge?.["currency"]);
  const chargeId = text(data["charge_id"]) ?? (charge ? text(charge["id"]) : null);

  if (currency !== deposit.currency || amount == null) {
    await markEvent(event.id, "Payment amount or currency is invalid");
    return true;
  }
  if (deposit.status === "failed") {
    await markEvent(event.id, "Deposit is not payable");
    return true;
  }

  const { error } = await supabaseAdmin.rpc("credit_real_account_deposit", {
    p_deposit: deposit.id,
    p_checkout_id: checkoutId ?? "",
    p_charge_id: chargeId ?? "",
    p_amount: amount,
  });
  if (error) throw new Error("Could not credit the deposit");
  await markEvent(event.id);
  return true;
}

async function processEvent(event: BachsEvent): Promise<boolean> {
  if (event.type === "checkout.expired") return handleExpired(event);
  if (event.type === "collection.succeeded") {
    const data = eventData(event);
    const status = text(data["status"])?.toUpperCase();
    if (status !== "SUCCEEDED" && status !== "OVERPAID" && status !== "ACCEPTED") {
      await markEvent(event.id);
      return true;
    }
    return handlePaid(event);
  }
  if (event.type === "checkout.completed") {
    const data = eventData(event);
    if (data["payment_status"] !== "paid") {
      await markEvent(event.id);
      return true;
    }
    return handlePaid(event);
  }
  await markEvent(event.id);
  return true;
}

export async function handleBachsWebhook(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let secret: string;
  try {
    secret = bachsWebhookSecret();
  } catch {
    return new Response("Payments are not configured", { status: 503 });
  }

  const rawBody = await request.text();
  if (!(await verifyBachsSignature(rawBody, request.headers, secret))) {
    return new Response("Invalid signature", { status: 400 });
  }

  let event: BachsEvent;
  try {
    const payload = JSON.parse(rawBody) as Partial<BachsEvent> | null;
    if (!payload || typeof payload.id !== "string" || typeof payload.type !== "string") {
      return new Response("Invalid event", { status: 400 });
    }
    event = payload as BachsEvent;
  } catch {
    return new Response("Invalid event", { status: 400 });
  }

  try {
    if (!(await recordEvent(event))) {
      return new Response(null, { status: 200 });
    }
    await processEvent(event);
    return new Response(null, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed";
    await markEvent(event.id, message).catch(() => undefined);
    console.error("[bachs] webhook processing failed");
    return new Response("Webhook processing failed", { status: 500 });
  }
}
