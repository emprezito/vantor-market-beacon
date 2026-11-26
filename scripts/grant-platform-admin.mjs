import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function readEnv(file) {
  const values = {};
  if (!fs.existsSync(file)) return values;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

const root = process.cwd();
const env = {
  ...readEnv(path.join(root, ".env")),
  ...readEnv(path.join(root, ".env.local")),
  ...readEnv(path.join(root, ".dev.vars")),
};
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const target = process.argv[2];
if (!target) {
  console.error("Usage: node scripts/grant-platform-admin.mjs <email|user-id>");
  process.exit(1);
}

const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserByEmail(email) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Could not list users: ${error.message}`);
    const user = data.users.find((row) => row.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < 1000) return null;
  }
}

try {
  const user = target.includes("@")
    ? await findUserByEmail(target.toLowerCase())
    : (await client.auth.admin.getUserById(target)).data.user;
  if (!user) throw new Error(`No account found for ${target}`);

  const { data: existing, error: readError } = await client
    .from("app_roles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (readError) throw new Error(`Could not read app role: ${readError.message}`);

  if (existing?.role === "platform_admin") {
    console.log(`Platform admin already granted to ${user.email ?? user.id}`);
  } else if (existing) {
    throw new Error(
      `${user.email ?? user.id} already has the ${existing.role} role; use a separate admin account`,
    );
  } else {
    const { error: insertError } = await client
      .from("app_roles")
      .insert({ user_id: user.id, role: "platform_admin" });
    if (insertError) throw new Error(`Could not grant platform admin: ${insertError.message}`);
    console.log(`Granted platform_admin to ${user.email ?? user.id}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
