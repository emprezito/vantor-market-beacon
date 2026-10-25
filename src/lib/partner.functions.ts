import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  TRADING_SERVER_SELECT,
  normalizeServer,
  validateServerId,
  type TradingServer,
} from "@/lib/account-options";
import {
  asServerRole,
  canRemoveServerMember,
  isPartnerRole,
  slugifyServerName,
  type ServerRole,
} from "@/lib/partner";

type ServerUpdate = Database["public"]["Tables"]["trading_servers"]["Update"];

export type { ServerRole } from "@/lib/partner";

export type PartnerServer = TradingServer & {
  role: ServerRole;
  member_count: number;
  account_count: number;
};

export type ServerMember = {
  server_id: string;
  user_id: string;
  role: ServerRole;
  created_at: string;
  email: string | null;
};

export type ServerAccount = {
  id: string;
  login: number;
  nickname: string;
  label: string;
  kind: string;
  server: string;
  server_id: string;
  access_role: string | null;
  balance: number;
  currency: string;
  leverage: number;
  user_id: string | null;
  created_at: string;
};

async function requirePartnerAccess(admin: SupabaseClient<Database>, userId: string) {
  const { data, error } = await admin
    .from("app_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Could not check your partner access. Please try again.");
  if (!isPartnerRole(data?.role)) throw new Error("Partner access is required");
}

async function requireServerRole(
  admin: SupabaseClient<Database>,
  serverId: string,
  userId: string,
  allowed: ServerRole[],
) {
  const { data, error } = await admin
    .from("server_members")
    .select("role")
    .eq("server_id", serverId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Could not check your server access. Please try again.");
  const role = data ? asServerRole(data.role) : null;
  if (!role || !allowed.includes(role)) {
    throw new Error("You do not have permission to manage this server");
  }
  return role;
}

export const listMyServers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requirePartnerAccess(supabaseAdmin, context.userId);
    const { data: memberships, error } = await supabaseAdmin
      .from("server_members")
      .select("server_id, role")
      .eq("user_id", context.userId);
    if (error) throw new Error("Could not load your partner servers");
    if (!memberships?.length) return [] as PartnerServer[];

    const roleById = new Map(
      memberships.map((member) => [member.server_id, asServerRole(member.role)]),
    );
    const { data: servers, error: serverError } = await supabaseAdmin
      .from("trading_servers")
      .select(TRADING_SERVER_SELECT)
      .in("id", [...roleById.keys()])
      .order("name");
    if (serverError) throw new Error("Could not load your partner servers");

    return Promise.all(
      (servers ?? []).map(async (server) => {
        const [{ count: memberCount }, { count: accountCount }] = await Promise.all([
          supabaseAdmin
            .from("server_members")
            .select("server_id", { count: "exact", head: true })
            .eq("server_id", server.id),
          supabaseAdmin
            .from("trading_accounts")
            .select("id", { count: "exact", head: true })
            .eq("server_id", server.id),
        ]);
        return {
          ...normalizeServer(server as TradingServer),
          role: roleById.get(server.id) ?? "member",
          member_count: memberCount ?? 0,
          account_count: accountCount ?? 0,
        } satisfies PartnerServer;
      }),
    );
  });

export const createPartnerServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (i: { name: string; slug?: string; description?: string; visibility?: string }) => {
      const name = typeof i.name === "string" ? i.name.trim() : "";
      if (name.length < 2 || name.length > 64)
        throw new Error("Server name must be 2-64 characters");
      const description = typeof i.description === "string" ? i.description.trim() : "";
      if (description.length > 280) throw new Error("Description must be 280 characters or fewer");
      const slug = slugifyServerName(typeof i.slug === "string" && i.slug.trim() ? i.slug : name);
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
        throw new Error("Use a slug with letters, numbers and hyphens");
      }
      return {
        name,
        slug,
        description,
        visibility: i.visibility === "public" ? "public" : "private",
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requirePartnerAccess(supabaseAdmin, context.userId);
    const { data: server, error } = await supabaseAdmin
      .from("trading_servers")
      .insert({
        slug: data.slug,
        name: data.name,
        description: data.description,
        kind: "partner",
        status: "active",
        visibility: data.visibility,
        sort_order: 100,
      })
      .select(TRADING_SERVER_SELECT)
      .single();
    if (error || !server) {
      if (error?.code === "23505") throw new Error("That slug is already taken");
      throw new Error("Could not create the server. Please try again.");
    }

    const { error: memberError } = await supabaseAdmin.from("server_members").insert({
      server_id: server.id,
      user_id: context.userId,
      role: "owner",
      created_by: context.userId,
    });
    if (memberError) {
      await supabaseAdmin.from("trading_servers").delete().eq("id", server.id);
      throw new Error("Could not create the server. Please try again.");
    }
    return normalizeServer(server as TradingServer);
  });

export const updatePartnerServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (i: {
      serverId: string;
      name?: string;
      description?: string;
      status?: string;
      visibility?: string;
    }) => {
      const serverId = validateServerId(i.serverId);
      const patch: ServerUpdate = {};
      if (i.name !== undefined) {
        const name = String(i.name).trim();
        if (name.length < 2 || name.length > 64)
          throw new Error("Server name must be 2-64 characters");
        patch.name = name;
      }
      if (i.description !== undefined) {
        const description = String(i.description).trim();
        if (description.length > 280)
          throw new Error("Description must be 280 characters or fewer");
        patch.description = description;
      }
      if (i.status !== undefined) {
        if (i.status !== "active" && i.status !== "paused")
          throw new Error("Choose a valid server status");
        patch.status = i.status;
      }
      if (i.visibility !== undefined) {
        if (i.visibility !== "public" && i.visibility !== "private") {
          throw new Error("Choose a valid server visibility");
        }
        patch.visibility = i.visibility;
      }
      if (Object.keys(patch).length === 0) throw new Error("Nothing to update");
      return { serverId, patch };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requirePartnerAccess(supabaseAdmin, context.userId);
    await requireServerRole(supabaseAdmin, data.serverId, context.userId, ["owner", "admin"]);
    const { data: server, error } = await supabaseAdmin
      .from("trading_servers")
      .update(data.patch)
      .eq("id", data.serverId)
      .select(TRADING_SERVER_SELECT)
      .single();
    if (error || !server) throw new Error("Could not update the server. Please try again.");
    return normalizeServer(server as TradingServer);
  });

export const listServerMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { serverId: string }) => ({ serverId: validateServerId(i.serverId) }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requirePartnerAccess(supabaseAdmin, context.userId);
    await requireServerRole(supabaseAdmin, data.serverId, context.userId, ["owner", "admin"]);
    const { data: members, error } = await supabaseAdmin
      .from("server_members")
      .select("server_id, user_id, role, created_at")
      .eq("server_id", data.serverId)
      .order("created_at");
    if (error) throw new Error("Could not load server members");

    const rows = await Promise.all(
      (members ?? []).map(async (member) => {
        let email: string | null = null;
        try {
          const { data: user } = await supabaseAdmin.auth.admin.getUserById(member.user_id);
          email = user.user?.email ?? null;
        } catch {
          email = null;
        }
        return {
          ...member,
          role: asServerRole(member.role),
          email,
        } satisfies ServerMember;
      }),
    );
    const order: Record<ServerRole, number> = { owner: 0, admin: 1, member: 2 };
    return rows.sort(
      (a, b) => order[a.role] - order[b.role] || a.created_at.localeCompare(b.created_at),
    );
  });

export const removeServerMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { serverId: string; userId: string }) => ({
    serverId: validateServerId(i.serverId),
    userId: validateServerId(i.userId),
  }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requirePartnerAccess(supabaseAdmin, context.userId);
    const callerRole = await requireServerRole(supabaseAdmin, data.serverId, context.userId, [
      "owner",
      "admin",
    ]);
    const { data: target, error: targetError } = await supabaseAdmin
      .from("server_members")
      .select("role")
      .eq("server_id", data.serverId)
      .eq("user_id", data.userId)
      .maybeSingle();
    if (targetError) throw new Error("Could not load that member");
    if (!target) throw new Error("That user is not a member of this server");
    const targetRole = asServerRole(target.role);
    if (targetRole === "owner") throw new Error("The server owner cannot be removed");
    if (!canRemoveServerMember(callerRole, targetRole)) {
      throw new Error("Only the owner can remove an admin");
    }
    const { error } = await supabaseAdmin
      .from("server_members")
      .delete()
      .eq("server_id", data.serverId)
      .eq("user_id", data.userId);
    if (error) throw new Error("Could not remove that member. Please try again.");
    return { ok: true };
  });

export const listServerAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { serverId: string }) => ({ serverId: validateServerId(i.serverId) }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requirePartnerAccess(supabaseAdmin, context.userId);
    await requireServerRole(supabaseAdmin, data.serverId, context.userId, ["owner", "admin"]);
    const { data: accounts, error } = await supabaseAdmin
      .from("trading_accounts")
      .select(
        "id, login, nickname, label, kind, server, server_id, access_role, balance, currency, leverage, user_id, created_at",
      )
      .eq("server_id", data.serverId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error("Could not load server accounts");
    return (accounts ?? []).map((account) => ({
      ...account,
      balance: Number(account.balance),
    })) as ServerAccount[];
  });

export const changeServerAccountPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { serverId: string; accountId: string; password: string }) => {
    const serverId = validateServerId(i.serverId);
    const accountId = validateServerId(i.accountId);
    if (typeof i.password !== "string" || i.password.length < 8 || i.password.length > 64) {
      throw new Error("Trading password must be 8-64 characters");
    }
    return { serverId, accountId, password: i.password };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requirePartnerAccess(supabaseAdmin, context.userId);
    await requireServerRole(supabaseAdmin, data.serverId, context.userId, ["owner", "admin"]);
    const { data: account, error } = await supabaseAdmin
      .from("trading_accounts")
      .update({ trader_password: data.password })
      .eq("id", data.accountId)
      .eq("server_id", data.serverId)
      .select("id, login")
      .maybeSingle();
    if (error) throw new Error("Could not update the trading password. Please try again.");
    if (!account) throw new Error("That account is not on this server");
    return { ok: true, login: account.login };
  });
