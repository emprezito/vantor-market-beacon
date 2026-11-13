import { describe, expect, it } from "vitest";
import {
  MERIDIAN_TIMEFRAMES,
  marketQuoteFromMeridian,
  parseMeridianQuote,
  parseMeridianStreamMessage,
} from "@/lib/meridian";

describe("Meridian protocol", () => {
  it("parses ticks and preserves executable bid and ask prices", () => {
    const raw = parseMeridianQuote({
      provider: "MT5",
      symbol: "EURUSDm",
      source_symbol: "EURUSDm",
      bid: 1.08642,
      ask: 1.08668,
      last: 1.08655,
      timestamp: "2026-11-10T14:32:08.412Z",
      timestamp_ms: 1_762_785_128_412,
      received_at: "2026-11-10T14:32:08.418Z",
    });
    expect(raw).not.toBeNull();
    expect(marketQuoteFromMeridian(raw!, "EURUSD")).toMatchObject({
      symbol: "EURUSD",
      bid: 1.08642,
      ask: 1.08668,
      mid: 1.08655,
      ts: 1_762_785_128_412,
      source: "live",
      feed: "meridian",
    });
  });

  it("rejects malformed quotes", () => {
    expect(parseMeridianQuote(null)).toBeNull();
    expect(parseMeridianQuote({ symbol: "EURUSD", bid: 0, ask: 1, timestamp_ms: 1 })).toBeNull();
    expect(parseMeridianQuote({ symbol: "EURUSD", bid: 2, ask: 1, timestamp_ms: 1 })).toBeNull();
  });

  it("maps every chart interval to the Meridian contract", () => {
    expect(MERIDIAN_TIMEFRAMES).toEqual({
      "1min": "M1",
      "5min": "M5",
      "15min": "M15",
      "30min": "M30",
      "1h": "H1",
      "4h": "H4",
      "1day": "D1",
      "1week": "W1",
      "1month": "MN1",
    });
  });

  it("parses WebSocket event envelopes", () => {
    expect(
      parseMeridianStreamMessage({ event: "connected", data: { protocol: "market-data-v1" } }),
    ).toMatchObject({ event: "connected" });
    expect(parseMeridianStreamMessage({ data: {} })).toBeNull();
  });
});
