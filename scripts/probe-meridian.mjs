const apiKey = process.env.MERIDIAN_API_KEY;
const apiBase = (process.env.MERIDIAN_API_BASE_URL ?? "http://localhost:8000/api/v1").replace(
  /\/+$/,
  "",
);
const wsUrl =
  process.env.MERIDIAN_WS_URL ?? process.env.MARKET_WS_URL ?? "ws://localhost:8000/ws/v1/market";
const symbol = process.env.MERIDIAN_TEST_SYMBOL ?? "EURUSD";

if (!apiKey) throw new Error("MERIDIAN_API_KEY is not configured");

const headers = { "X-API-Key": apiKey };
const quoteResponse = await fetch(`${apiBase}/quotes?symbol=${encodeURIComponent(symbol)}`, {
  headers,
});
if (!quoteResponse.ok) throw new Error(`Meridian quotes returned ${quoteResponse.status}`);
const quotes = await quoteResponse.json();
const quote = quotes[0];
console.log(
  `REST quote: symbol=${quote?.symbol ?? "missing"} bid=${quote?.bid ?? "missing"} ask=${quote?.ask ?? "missing"} age_ms=${quote?.timestamp_ms ? Date.now() - quote.timestamp_ms : "unknown"}`,
);

const tokenResponse = await fetch(`${apiBase}/auth/ws-token`, { method: "POST", headers });
if (!tokenResponse.ok) throw new Error(`Meridian token exchange returned ${tokenResponse.status}`);
const { token } = await tokenResponse.json();
if (!token) throw new Error("Meridian token response did not include a token");

const endpoint = new URL(wsUrl);
endpoint.searchParams.set("token", token);

await new Promise((resolve, reject) => {
  const socket = new WebSocket(endpoint);
  let subscribed = false;
  const timeout = setTimeout(() => {
    socket.close();
    if (subscribed) {
      console.log("WS subscription acknowledged; no tick arrived before timeout");
      resolve();
    } else {
      reject(new Error("Meridian WebSocket did not acknowledge the subscription"));
    }
  }, 12_000);

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.event === "connected") {
      socket.send(JSON.stringify({ action: "subscribe", symbols: [symbol], channels: ["tick"] }));
      return;
    }
    if (message.event === "subscribed") {
      subscribed = true;
      console.log(`WS subscribed: ${message.data?.symbols?.join(",") ?? symbol}`);
      return;
    }
    if (message.event === "error") {
      clearTimeout(timeout);
      socket.close();
      reject(
        new Error(`Meridian WS ${message.data?.code ?? "error"}: ${message.data?.message ?? ""}`),
      );
      return;
    }
    if (message.event === "tick") {
      clearTimeout(timeout);
      console.log(
        `WS tick: symbol=${message.data.symbol} bid=${message.data.bid} ask=${message.data.ask} timestamp_ms=${message.data.timestamp_ms}`,
      );
      socket.close();
      resolve();
    }
  });
  socket.addEventListener("error", () => {
    clearTimeout(timeout);
    reject(new Error("Meridian WebSocket connection failed"));
  });
});
