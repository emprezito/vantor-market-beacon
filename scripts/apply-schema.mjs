import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("Missing SUPABASE_DB_URL (direct or session-pooler connection string).");
  process.exit(1);
}

const file = process.argv[2] ?? "supabase/migrations/20261019000000_init.sql";
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

try {
  const text = readFileSync(resolve(process.cwd(), file), "utf8");
  await sql.unsafe(text);
  console.log(`Applied ${file}`);
} finally {
  await sql.end();
}
