import { findInstrument } from "./market";

const newYorkClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function newYorkSessionTime(now: number) {
  const parts = Object.fromEntries(
    newYorkClock
      .formatToParts(new Date(now))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    weekday: parts["weekday"],
    minutes: Number(parts["hour"]) * 60 + Number(parts["minute"]),
  };
}

export function forexMarketIsOpen(now = Date.now()): boolean {
  const { weekday, minutes } = newYorkSessionTime(now);
  if (weekday === "Sat") return false;
  if (weekday === "Sun") return minutes >= 17 * 60;
  if (weekday === "Fri") return minutes < 17 * 60;
  return true;
}

export function marketOpenForInstrument(symbol: string, now = Date.now()): boolean | undefined {
  const assetClass = findInstrument(symbol)?.assetClass?.toLowerCase();
  if (!assetClass) return undefined;
  if (assetClass.startsWith("forex")) return forexMarketIsOpen(now);
  if (assetClass.startsWith("crypto")) return true;
  return undefined;
}
