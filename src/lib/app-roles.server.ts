import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { isPlatformAdmin } from "./partner";

export async function requirePlatformAdmin(
  admin: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const { data, error } = await admin
    .from("app_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Could not verify access. Please try again.");
  if (!isPlatformAdmin(data?.role)) throw new Error("Not authorized");
}
