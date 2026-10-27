import { randomUUID } from "node:crypto";

const baseUrl = (process.env["BASE_URL"] ?? "").replace(/\/+$/, "");
const serverId = process.env["SERVER_ID"] ?? "";
const login = Number(process.env["LOGIN"] ?? "");
const password = process.env["PASSWORD"] ?? "";
const symbol = process.env["SYMBOL"] ?? "EURUSD";
const side = process.env["SIDE"] === "sell" ? "sell" : "buy";
const lots = Number(process.env["LOTS"] ?? "0.01");

if (!baseUrl || !serverId || !Number.isFinite(login) || login <= 0 || !password) {
  console.error("Set BASE_URL, SERVER_ID, LOGIN and PASSWORD.");
  process.exit(1);
}

const root = `${baseUrl}/api/v1/terminal`;

async function call(path, init = {}) {
  const response = await fetch(`${root}${path}`, init);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : text || response.statusText;
    throw new Error(`${response.status} ${message}`);
  }
  return payload;
}

function authHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function main() {
  const session = await call("/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ serverId, login, password }),
  });
  console.log(`Logged in as ${session.account.nickname} (${session.role})`);
  const token = session.token;
  const headers = authHeaders(token);

  const account = await call("/account", { headers });
  console.log(`Balance: ${account.balance} ${account.account.currency}`);

  const quotes = await call("/quotes?symbols=EURUSD,BTCUSD", { headers });
  for (const quote of quotes.quotes) {
    console.log(`${quote.symbol}: ${quote.bid}/${quote.ask}${quote.stale ? " (stale)" : ""}`);
  }

  const order = await call("/orders", {
    method: "POST",
    headers: { ...headers, "idempotency-key": randomUUID() },
    body: JSON.stringify({ symbol, side, lots, stopLoss: null, takeProfit: null }),
  });
  console.log(
    `Opened ${order.order.symbol} ${order.order.side} ${order.order.lots} at ${order.order.price}`,
  );

  let positionId = order.order.positionId;
  if (!positionId) {
    const current = await call("/account", { headers });
    positionId = current.openPositions.find((position) => position.symbol === symbol)?.id ?? null;
  }
  if (!positionId) throw new Error("Opened position was not returned by the account");

  const closed = await call(`/positions/${positionId}/close`, {
    method: "POST",
    headers: { ...headers, "idempotency-key": randomUUID() },
  });
  console.log(`Closed at ${closed.price}; P/L ${closed.pnl}; balance ${closed.balance}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
