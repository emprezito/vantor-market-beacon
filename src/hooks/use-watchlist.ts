import { useCallback, useEffect, useState } from "react";
import { isInstrument } from "@/lib/market-data";

const STORAGE_KEY = "vantor.watchlist";

export const DEFAULT_WATCHLIST = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "US30", "BTCUSD"];

function readWatchlist(): string[] {
  if (typeof window === "undefined") return DEFAULT_WATCHLIST;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null) return DEFAULT_WATCHLIST;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_WATCHLIST;
    return parsed.filter((s): s is string => typeof s === "string" && Boolean(s.trim()));
  } catch {
    return DEFAULT_WATCHLIST;
  }
}

export function useWatchlist() {
  const [symbols, setSymbols] = useState<string[]>(readWatchlist);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
    } catch {
      // Storage may be unavailable (private mode); keep the in-memory list.
    }
  }, [symbols]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setSymbols(readWatchlist());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = useCallback((symbol: string) => {
    if (!isInstrument(symbol)) return;
    setSymbols((prev) =>
      prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol],
    );
  }, []);

  const isFavourite = useCallback((symbol: string) => symbols.includes(symbol), [symbols]);

  return { symbols, isFavourite, toggle };
}
