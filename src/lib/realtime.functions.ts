import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createRealtimeTicket } from "./realtime-ticket";

export const getRealtimeTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const secret = process.env["REALTIME_TICKET_SECRET"];
    if (!secret) throw new Error("Realtime streaming is not configured");
    return createRealtimeTicket(context.userId, secret);
  });
