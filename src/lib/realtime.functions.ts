import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAccountForUser } from "./trading-service.server";
import { createRealtimeTicket } from "./realtime-ticket";

export const getRealtimeTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { accountId: string }) => {
    if (typeof input.accountId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.accountId)) {
      throw new Error("Invalid trading account");
    }
    return { accountId: input.accountId };
  })
  .handler(async ({ data, context }) => {
    const secret = process.env["REALTIME_TICKET_SECRET"];
    if (!secret) throw new Error("Realtime streaming is not configured");
    const account = await loadAccountForUser(context.supabase, context.userId, data.accountId);
    return createRealtimeTicket(
      { userId: context.userId, accountId: account.id, serverId: account.server_id },
      secret,
    );
  });
