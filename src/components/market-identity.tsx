import { Bitcoin, Coins } from "lucide-react";
import type { Instrument } from "@/lib/market";
import { cn } from "@/lib/utils";

const CURRENCY_COUNTRY: Record<string, string> = {
  AUD: "AU",
  CAD: "CA",
  CHF: "CH",
  CNH: "CN",
  CNY: "CN",
  DKK: "DK",
  EUR: "EU",
  GBP: "GB",
  HKD: "HK",
  JPY: "JP",
  MXN: "MX",
  NOK: "NO",
  NZD: "NZ",
  PLN: "PL",
  SEK: "SE",
  SGD: "SG",
  TRY: "TR",
  USD: "US",
  ZAR: "ZA",
};

const CRYPTO = new Set(["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "LTC", "BNB"]);

function flag(currency: string): string | null {
  const country = CURRENCY_COUNTRY[currency];
  if (!country) return null;
  return String.fromCodePoint(
    ...Array.from(country).map((letter) => 127_397 + letter.charCodeAt(0)),
  );
}

function currencies(instrument: Instrument): [string, string] {
  const compact = instrument.symbol.replace(/[^a-zA-Z]/g, "").toUpperCase();
  return [
    instrument.baseCurrency?.toUpperCase() ?? compact.slice(0, 3),
    instrument.quoteCurrency?.toUpperCase() ?? compact.slice(3, 6),
  ];
}

function EthereumMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        d="M12 2 6.5 12.2 12 15.5l5.5-3.3L12 2Zm0 14.7-5.5-3.3L12 22l5.5-8.6-5.5 3.3Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function MarketIdentity({
  instrument,
  compact = false,
  className,
}: {
  instrument: Instrument;
  compact?: boolean;
  className?: string;
}) {
  const [base, quote] = currencies(instrument);
  const baseFlag = flag(base);
  const quoteFlag = flag(quote);
  const size = compact ? "h-5 w-5 text-[11px]" : "h-7 w-7 text-sm";

  if (CRYPTO.has(base)) {
    return (
      <span
        className={cn("relative flex shrink-0 items-center", compact ? "w-8" : "w-11", className)}
        aria-label={`${base} / ${quote}`}
      >
        <span
          className={cn(
            "relative z-10 grid shrink-0 place-items-center rounded-full border border-background bg-warning text-primary-foreground",
            size,
          )}
        >
          {base === "BTC" ? (
            <Bitcoin className={compact ? "h-3 w-3" : "h-4 w-4"} />
          ) : base === "ETH" ? (
            <EthereumMark className={compact ? "h-3 w-3" : "h-4 w-4"} />
          ) : (
            <Coins className={compact ? "h-3 w-3" : "h-4 w-4"} />
          )}
        </span>
        {quoteFlag ? (
          <span
            aria-hidden="true"
            className={cn(
              "grid shrink-0 place-items-center overflow-hidden rounded-full border border-background bg-muted",
              size,
              compact ? "-ml-1.5" : "-ml-2",
            )}
          >
            {quoteFlag}
          </span>
        ) : null}
      </span>
    );
  }

  if (baseFlag && quoteFlag) {
    return (
      <span
        className={cn("relative flex shrink-0 items-center", compact ? "w-8" : "w-11", className)}
        aria-label={`${base} / ${quote}`}
      >
        <span
          aria-hidden="true"
          className={cn(
            "relative z-10 grid shrink-0 place-items-center overflow-hidden rounded-full border border-background bg-muted",
            size,
          )}
        >
          {baseFlag}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "grid shrink-0 place-items-center overflow-hidden rounded-full border border-background bg-muted",
            size,
            compact ? "-ml-1.5" : "-ml-2",
          )}
        >
          {quoteFlag}
        </span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full border border-border bg-accent font-mono font-bold text-muted-foreground",
        size,
        className,
      )}
      aria-label={instrument.name}
    >
      {base.slice(0, 2)}
    </span>
  );
}
