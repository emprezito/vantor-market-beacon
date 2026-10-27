import fs from "node:fs";
import path from "node:path";
import { pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";

const derive = promisify(pbkdf2);
const ITERATIONS = 100_000;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const PAGE_SIZE = 100;

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

async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, ITERATIONS, KEY_BYTES, "sha256");
  return `pbkdf2$${ITERATIONS}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

async function verifyPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1_000 || iterations > 1_000_000) {
    return false;
  }
  const salt = Buffer.from(parts[2], "base64url");
  const expected = Buffer.from(parts[3], "base64url");
  if (salt.length < 8 || expected.length < 16) return false;
  const actual = await derive(password, salt, iterations, expected.length, "sha256");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function hashAndVerify(password, label, login) {
  const hash = await hashPassword(password);
  if (!(await verifyPassword(password, hash))) {
    throw new Error(`Generated ${label} hash failed verification for account #${login}`);
  }
  return hash;
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

const dryRun = process.argv.includes("--dry-run");
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let lastId = "00000000-0000-0000-0000-000000000000";
let traderHashed = 0;
let investorHashed = 0;
let unresolved = 0;

try {
  const { data: epochsBefore, error: epochsError } = await client
    .from("trading_accounts")
    .select("id, session_epoch");
  if (epochsError) throw new Error(`Could not load session epochs: ${epochsError.message}`);
  const expectedEpochs = new Map((epochsBefore ?? []).map((row) => [row.id, row.session_epoch]));

  for (;;) {
    const { data, error } = await client
      .from("trading_accounts")
      .select("id, login, trader_password, investor_password, trader_hash, investor_hash")
      .or("trader_hash.is.null,investor_hash.is.null")
      .gt("id", lastId)
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (error) throw new Error(`Could not load accounts: ${error.message}`);
    if (!data?.length) break;

    for (const account of data) {
      lastId = account.id;

      if (!account.trader_hash) {
        if (!account.trader_password) {
          unresolved += 1;
          console.warn(`Account #${account.login} has no trader password or hash`);
        } else {
          const traderHash = await hashAndVerify(account.trader_password, "trader", account.login);
          if (!dryRun) {
            const { error: updateError } = await client
              .from("trading_accounts")
              .update({ trader_hash: traderHash })
              .eq("id", account.id)
              .is("trader_hash", null);
            if (updateError) throw new Error(`Could not update account #${account.login}`);
          }
          traderHashed += 1;
        }
      }

      if (!account.investor_hash) {
        if (!account.investor_password) {
          unresolved += 1;
          console.warn(`Account #${account.login} has no investor password or hash`);
        } else {
          const investorHash = await hashAndVerify(
            account.investor_password,
            "investor",
            account.login,
          );
          if (!dryRun) {
            const { error: updateError } = await client
              .from("trading_accounts")
              .update({ investor_hash: investorHash })
              .eq("id", account.id)
              .is("investor_hash", null);
            if (updateError) throw new Error(`Could not update account #${account.login}`);
          }
          investorHashed += 1;
        }
      }
    }
  }

  const { data: allAccounts, error: verifyError } = await client
    .from("trading_accounts")
    .select(
      "id, login, session_epoch, trader_password, investor_password, trader_hash, investor_hash",
    )
    .order("id", { ascending: true });
  if (verifyError) throw new Error(`Could not verify hashes: ${verifyError.message}`);

  let missing = 0;
  let traderFailed = 0;
  let investorFailed = 0;
  let traderVerified = 0;
  let investorVerified = 0;
  let epochChanged = 0;

  for (const account of allAccounts ?? []) {
    if (expectedEpochs.get(account.id) !== account.session_epoch) epochChanged += 1;

    const traderMissing = !account.trader_hash || !account.trader_password;
    const investorMissing = !account.investor_hash || !account.investor_password;
    const traderOk =
      !traderMissing && (await verifyPassword(account.trader_password, account.trader_hash));
    const investorOk =
      !investorMissing && (await verifyPassword(account.investor_password, account.investor_hash));

    if (traderMissing || investorMissing) missing += 1;
    if (traderOk) traderVerified += 1;
    else if (!traderMissing) traderFailed += 1;
    if (investorOk) investorVerified += 1;
    else if (!investorMissing) investorFailed += 1;
  }

  console.log(`${dryRun ? "Dry run" : "Backfill"} complete`);
  console.log(`Trader hashes written: ${traderHashed}`);
  console.log(`Investor hashes written: ${investorHashed}`);
  console.log(`Unresolved passwords: ${unresolved}`);
  console.log(`Accounts missing hashes: ${missing}`);
  console.log(`Trader hashes verified: ${traderVerified}/${(allAccounts ?? []).length}`);
  console.log(`Investor hashes verified: ${investorVerified}/${(allAccounts ?? []).length}`);
  console.log(`Session epochs changed: ${epochChanged}`);

  if (unresolved > 0 || traderFailed > 0 || investorFailed > 0 || epochChanged > 0) {
    process.exitCode = 1;
  }
  if (!dryRun && missing > 0) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
