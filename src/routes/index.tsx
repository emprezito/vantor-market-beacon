import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { getHomepageQuotes } from "@/lib/market.functions";
import { fmt } from "@/lib/market";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vantor — Multi-Asset Brokerage" },
      {
        name: "description",
        content:
          "Trade forex, gold, indices and crypto with transparent spreads, millisecond execution and withdrawals handled around the clock.",
      },
      { name: "theme-color", content: "#f2ecdf" },
      { property: "og:title", content: "Vantor — Multi-Asset Brokerage" },
      {
        property: "og:description",
        content:
          "Transparent spreads, millisecond execution and withdrawals handled around the clock.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,400;6..96,500;6..96,600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap",
      },
    ],
  }),
  component: Index,
});

const marketRows = [
  ["EURUSD", "EUR / USD", "1.08542"],
  ["XAUUSD", "XAU / USD", "2384.10"],
  ["GBPUSD", "GBP / USD", "1.27311"],
  ["US30", "US 30", "39102.5"],
  ["BTCUSD", "BTC / USD", "67420.0"],
  ["USDJPY", "USD / JPY", "151.204"],
] as const;

const conditions = [
  ["200+", "Tradeable instruments"],
  ["0.0 pips", "Spreads from"],
  ["1:2000", "Maximum leverage"],
  ["24/7", "Withdrawal processing"],
] as const;

const standards = [
  {
    title: "Pricing that stays legible",
    body: "Spreads from 0.0 pips, with commission shown separately where it applies. The number you see is the number you work from.",
  },
  {
    title: "Execution without theatre",
    body: "Market orders are checked against a live quote and confirmed before a position is opened, so the terms of the trade are clear at submission.",
  },
  {
    title: "Withdrawals on your schedule",
    body: "Withdrawal requests are processed around the clock, without a manual review queue holding your capital.",
  },
  {
    title: "Risk kept inside the account",
    body: "Negative balance protection means a market gap cannot leave you owing more than the balance in your account.",
  },
] as const;

const accounts = [
  {
    name: "Standard",
    description: "A straightforward account for smaller position sizes.",
    minimum: "$10",
    spread: "From 0.2 pips",
    commission: "None",
  },
  {
    name: "Pro",
    description: "Tighter pricing for traders running consistent volume.",
    minimum: "$200",
    spread: "From 0.1 pips",
    commission: "None",
  },
  {
    name: "Raw Spread",
    description: "Market pricing with commission separated from the spread.",
    minimum: "$200",
    spread: "From 0.0 pips",
    commission: "$3.5 / lot",
  },
  {
    name: "Zero",
    description: "The tightest quoted spread, with commission applied per lot.",
    minimum: "$200",
    spread: "0.0 pips",
    commission: "From $0.2 / lot",
  },
] as const;

const inkButton =
  "inline-flex h-12 items-center justify-center bg-vantor-ink px-6 text-[13px] font-medium text-vantor-paper transition-colors hover:bg-vantor-pine focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-vantor-brass";
const outlineButton =
  "inline-flex h-12 items-center justify-center border border-vantor-ink/30 px-6 text-[13px] font-medium text-vantor-ink transition-colors hover:border-vantor-ink hover:bg-vantor-ink/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-vantor-brass";
const brassButton =
  "inline-flex h-12 items-center justify-center bg-vantor-brass px-6 text-[13px] font-semibold text-vantor-ink transition-colors hover:bg-vantor-brass-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-vantor-brass";
const lightOutlineButton =
  "inline-flex h-12 items-center justify-center border border-vantor-paper/30 px-6 text-[13px] font-medium text-vantor-paper transition-colors hover:border-vantor-paper hover:bg-vantor-paper/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-vantor-brass";
const anchorLink =
  "text-[13px] text-vantor-ink/65 transition-colors hover:text-vantor-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-vantor-brass";
const textLink =
  "inline-flex items-center border-b border-vantor-ink/35 pb-0.5 text-[12px] font-medium text-vantor-ink transition-colors hover:border-vantor-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-vantor-brass";

function Index() {
  const session = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const previewFn = useServerFn(getHomepageQuotes);
  const preview = useQuery({
    queryKey: ["homepage-market-preview"],
    queryFn: () => previewFn(),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const liveCount = marketRows.filter(([symbol]) => {
    const quote = preview.data?.quotes[symbol];
    return quote?.feed === "meridian" && quote.source === "live";
  }).length;
  const marketState = preview.isPending
    ? "Loading prices"
    : liveCount > 0
      ? "Live pricing"
      : "Indicative pricing";

  return (
    <div className="vantor-home min-h-screen bg-vantor-parchment text-vantor-ink">
      <div className="bg-vantor-ink text-vantor-paper">
        <div className="mx-auto flex h-9 max-w-[1440px] items-center justify-between gap-4 px-5 sm:px-8">
          <span className="vantor-mono flex items-center gap-2 text-[10px] text-vantor-paper/70">
            <span className="size-1.5 shrink-0 bg-vantor-brass" aria-hidden="true" />
            Indicative pricing, refreshed every 30 seconds
          </span>
          <span className="hidden text-[11px] text-vantor-paper/50 sm:block">
            Forex, metals, indices and crypto
          </span>
          <span className="vantor-mono hidden text-[10px] text-vantor-paper/50 md:block">
            {session ? "Client session active" : "Global markets"}
          </span>
        </div>
      </div>

      <header className="sticky top-0 z-40 border-b border-vantor-ink/15 bg-vantor-parchment/95 backdrop-blur supports-[backdrop-filter]:bg-vantor-parchment/85">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center gap-5 px-5 sm:px-8">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-vantor-brass"
            aria-label="Vantor home"
          >
            <span className="vantor-display flex size-9 items-center justify-center bg-vantor-ink text-[19px] leading-none text-vantor-paper">
              V
            </span>
            <span>
              <span className="vantor-display block text-[26px] leading-none tracking-[-0.02em]">
                Vantor
              </span>
              <span className="mt-1 hidden text-[10px] text-vantor-ink/55 sm:block">
                Multi-asset brokerage
              </span>
            </span>
          </Link>

          <nav aria-label="Homepage sections" className="ml-4 hidden items-center gap-7 md:flex">
            <a href="#pricing" className={anchorLink}>
              Pricing
            </a>
            <a href="#standards" className={anchorLink}>
              Standards
            </a>
            <a href="#accounts" className={anchorLink}>
              Accounts
            </a>
          </nav>

          <div className="ml-auto flex items-center gap-2 sm:gap-4">
            {session ? (
              <>
                <button
                  type="button"
                  onClick={signOut}
                  className="hidden text-[13px] text-vantor-ink/65 transition-colors hover:text-vantor-ink sm:inline-flex"
                >
                  Sign out
                </button>
                <Link to="/trade" className={`${inkButton} h-10 px-4`}>
                  Open terminal
                </Link>
              </>
            ) : (
              <>
                <Link
                  to="/auth"
                  search={{ mode: "in" }}
                  className="hidden text-[13px] text-vantor-ink/65 transition-colors hover:text-vantor-ink sm:inline-flex"
                >
                  Sign in
                </Link>
                <Link to="/auth" search={{ mode: "up" }} className={`${inkButton} h-10 px-4`}>
                  Open account
                </Link>
              </>
            )}
          </div>
        </div>

        <nav
          aria-label="Homepage sections"
          className="flex gap-6 overflow-x-auto border-t border-vantor-ink/10 px-5 py-2.5 text-[12px] md:hidden"
        >
          <a href="#pricing" className="whitespace-nowrap text-vantor-ink/65">
            Pricing
          </a>
          <a href="#standards" className="whitespace-nowrap text-vantor-ink/65">
            Standards
          </a>
          <a href="#accounts" className="whitespace-nowrap text-vantor-ink/65">
            Accounts
          </a>
        </nav>
      </header>

      <main>
        <section id="pricing" className="vantor-hero scroll-mt-24 border-b border-vantor-ink/15">
          <div className="mx-auto grid max-w-[1440px] gap-14 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16 lg:py-28">
            <div className="vantor-rise">
              <h1 className="vantor-display max-w-[11ch] text-[clamp(3.35rem,7.2vw,6.8rem)] leading-[0.9] tracking-[-0.045em] text-balance">
                Pricing you can see. Execution you can trust.
              </h1>
              <p className="mt-7 max-w-xl text-[15px] leading-7 text-vantor-ink/70 sm:text-base">
                Vantor gives serious traders direct access to forex, metals, indices and crypto.
                Transparent spreads, millisecond execution and withdrawals handled around the clock.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                {session ? (
                  <Link to="/trade" className={inkButton}>
                    Open terminal
                  </Link>
                ) : (
                  <Link to="/auth" search={{ mode: "up" }} className={inkButton}>
                    Open account
                  </Link>
                )}
                <a href="#accounts" className={outlineButton}>
                  Compare accounts
                </a>
              </div>
              <div className="mt-10 flex flex-wrap gap-x-8 gap-y-3 border-t border-vantor-ink/15 pt-5 text-[12px] text-vantor-ink/60">
                <span>Spreads from 0.0 pips</span>
                <span>Leverage up to 1:2000</span>
                <span>Negative balance protection</span>
              </div>
            </div>

            <aside
              aria-labelledby="market-sheet-heading"
              className="vantor-rise vantor-delay-2 border border-vantor-ink/25 bg-vantor-paper shadow-[10px_10px_0_oklch(0.2206_0.028_175.3/0.08)]"
            >
              <div className="flex items-center justify-between gap-4 border-b border-vantor-ink/20 px-5 py-4 sm:px-6">
                <div>
                  <h2 id="market-sheet-heading" className="vantor-display text-[22px] leading-none">
                    Market sheet
                  </h2>
                  <p className="mt-1.5 text-[10px] text-vantor-ink/50">Indicative mid prices</p>
                </div>
                <span className="vantor-mono flex items-center gap-2 text-[10px] text-vantor-ink/60">
                  <span
                    className={`size-1.5 ${liveCount > 0 ? "bg-vantor-live" : "bg-vantor-ink/25"}`}
                    aria-hidden="true"
                  />
                  {marketState}
                </span>
              </div>

              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-vantor-ink/20 text-[10px] text-vantor-ink/50">
                    <th scope="col" className="py-3 pl-5 pr-3 text-left font-medium sm:pl-6">
                      Instrument
                    </th>
                    <th scope="col" className="py-3 text-right font-medium">
                      Price
                    </th>
                    <th scope="col" className="hidden py-3 text-right font-medium sm:table-cell">
                      Spread
                    </th>
                    <th scope="col" className="py-3 pl-4 pr-5 text-right font-medium sm:pr-6">
                      Feed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {marketRows.map(([symbol, label, fallback]) => {
                    const quote = preview.data?.quotes[symbol];
                    const live = quote?.feed === "meridian" && quote.source === "live";
                    const price = quote && quote.mid > 0 ? fmt(symbol, quote.mid) : fallback;
                    const spread =
                      quote && quote.ask >= quote.bid ? fmt(symbol, quote.ask - quote.bid) : "—";
                    return (
                      <tr
                        key={symbol}
                        className="border-b border-vantor-ink/10 transition-colors last:border-0 hover:bg-vantor-ink/[0.025]"
                      >
                        <td className="py-3.5 pl-5 pr-3 sm:pl-6">
                          <span className="block text-[13px] font-medium">{label}</span>
                          <span className="vantor-mono mt-0.5 block text-[10px] text-vantor-ink/45">
                            {symbol}
                          </span>
                        </td>
                        <td className="vantor-mono py-3.5 text-right text-[13px] tabular-nums">
                          {price}
                        </td>
                        <td className="vantor-mono hidden py-3.5 text-right text-[11px] text-vantor-ink/55 sm:table-cell">
                          {live ? spread : "—"}
                        </td>
                        <td className="py-3.5 pl-4 pr-5 text-right sm:pr-6">
                          <span
                            className={`inline-flex items-center gap-1.5 text-[10px] ${
                              live ? "text-vantor-pine" : "text-vantor-ink/40"
                            }`}
                          >
                            <span
                              className={`size-1.5 shrink-0 ${
                                live ? "bg-vantor-live" : "bg-vantor-ink/20"
                              }`}
                              aria-hidden="true"
                            />
                            {live ? "Live" : "Indicative"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="border-t border-vantor-ink/15 px-5 py-3 text-[10px] leading-5 text-vantor-ink/45 sm:px-6">
                Quotes refresh every 30 seconds. Indicative pricing may differ from executable
                prices.
              </div>
            </aside>
          </div>
        </section>

        <section aria-label="Trading conditions" className="bg-vantor-pine text-vantor-paper">
          <div className="mx-auto grid max-w-[1440px] grid-cols-2 gap-px bg-vantor-paper/15 lg:grid-cols-4">
            {conditions.map(([value, label]) => (
              <div key={label} className="bg-vantor-pine px-5 py-8 sm:px-8 lg:py-10">
                <p className="vantor-display text-[clamp(2rem,3.2vw,3rem)] leading-none tracking-[-0.03em]">
                  {value}
                </p>
                <p className="mt-3 text-[11px] leading-5 text-vantor-paper/60">{label}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="standards" className="scroll-mt-24 border-b border-vantor-ink/15">
          <div className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 sm:py-24 lg:py-28">
            <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-24">
              <div>
                <h2 className="vantor-display max-w-[11ch] text-[clamp(2.5rem,4.6vw,4.5rem)] leading-[0.94] tracking-[-0.04em] text-balance">
                  A brokerage built around the trade.
                </h2>
                <p className="mt-6 max-w-md text-[15px] leading-7 text-vantor-ink/65">
                  The terminal should never be the story. What matters is the quote, the
                  confirmation and the capital you can move when you choose to.
                </p>
                <div className="mt-8">
                  {session ? (
                    <Link to="/trade" className={textLink}>
                      Open the terminal
                    </Link>
                  ) : (
                    <Link to="/auth" search={{ mode: "up" }} className={textLink}>
                      Open an account
                    </Link>
                  )}
                </div>
              </div>

              <div className="border-t border-vantor-ink/20">
                {standards.map((item) => (
                  <div
                    key={item.title}
                    className="grid gap-3 border-b border-vantor-ink/15 py-7 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] sm:gap-8"
                  >
                    <h3 className="vantor-display text-[24px] leading-tight tracking-[-0.02em]">
                      {item.title}
                    </h3>
                    <p className="text-[13px] leading-6 text-vantor-ink/65">{item.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="accounts" className="scroll-mt-24 bg-vantor-paper">
          <div className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 sm:py-24 lg:py-28">
            <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
              <div>
                <h2 className="vantor-display max-w-[12ch] text-[clamp(2.5rem,4.6vw,4.5rem)] leading-[0.94] tracking-[-0.04em] text-balance">
                  Terms you can compare.
                </h2>
                <p className="mt-6 max-w-lg text-[15px] leading-7 text-vantor-ink/65">
                  Four account structures, one set of standards. Choose the pricing model that
                  matches how you trade.
                </p>
              </div>
              <p className="vantor-mono shrink-0 text-[10px] text-vantor-ink/45">
                Minimum funding shown in USD
              </p>
            </div>

            <div className="mt-12 hidden border-t border-vantor-ink/30 lg:block">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-vantor-ink/20 text-[11px] text-vantor-ink/50">
                    <th scope="col" className="py-4 pr-6 font-medium">
                      Account
                    </th>
                    <th scope="col" className="py-4 pr-6 font-medium">
                      Minimum funding
                    </th>
                    <th scope="col" className="py-4 pr-6 font-medium">
                      Typical spread
                    </th>
                    <th scope="col" className="py-4 pr-6 font-medium">
                      Commission
                    </th>
                    <th scope="col" className="py-4 text-right font-medium">
                      Open
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr
                      key={account.name}
                      className="border-b border-vantor-ink/15 transition-colors hover:bg-vantor-ink/[0.025]"
                    >
                      <th scope="row" className="py-7 pr-6 align-top font-normal">
                        <span className="vantor-display block text-[26px] leading-none tracking-[-0.02em]">
                          {account.name}
                        </span>
                        <span className="mt-2 block max-w-[26ch] text-[11px] leading-5 text-vantor-ink/50">
                          {account.description}
                        </span>
                      </th>
                      <td className="vantor-mono py-7 pr-6 align-top text-[13px]">
                        {account.minimum}
                      </td>
                      <td className="py-7 pr-6 align-top text-[13px] text-vantor-ink/75">
                        {account.spread}
                      </td>
                      <td className="py-7 pr-6 align-top text-[13px] text-vantor-ink/75">
                        {account.commission}
                      </td>
                      <td className="py-7 text-right align-top">
                        {session ? (
                          <Link to="/accounts" className={textLink}>
                            Manage accounts
                          </Link>
                        ) : (
                          <Link to="/auth" search={{ mode: "up" }} className={textLink}>
                            Open account
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-10 lg:hidden">
              {accounts.map((account) => (
                <div key={account.name} className="border-t border-vantor-ink/20 py-6">
                  <div className="flex items-baseline justify-between gap-4">
                    <h3 className="vantor-display text-[26px] leading-none tracking-[-0.02em]">
                      {account.name}
                    </h3>
                    <span className="vantor-mono text-[12px]">{account.minimum}</span>
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-vantor-ink/50">
                    {account.description}
                  </p>
                  <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-vantor-ink/10 pt-3 text-[12px]">
                    <dt className="text-vantor-ink/50">Typical spread</dt>
                    <dd className="text-right text-vantor-ink/75">{account.spread}</dd>
                    <dt className="text-vantor-ink/50">Commission</dt>
                    <dd className="text-right text-vantor-ink/75">{account.commission}</dd>
                  </dl>
                  <div className="mt-4">
                    {session ? (
                      <Link to="/accounts" className={textLink}>
                        Manage accounts
                      </Link>
                    ) : (
                      <Link to="/auth" search={{ mode: "up" }} className={textLink}>
                        Open account
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-6 max-w-2xl text-[10px] leading-5 text-vantor-ink/45">
              Spreads are indicative and vary with market conditions. Commission is charged per lot
              where shown.
            </p>
          </div>
        </section>

        <section className="bg-vantor-ink text-vantor-paper">
          <div className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 sm:py-24 lg:py-28">
            <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-end lg:gap-20">
              <h2 className="vantor-display max-w-[12ch] text-[clamp(2.9rem,6vw,6rem)] leading-[0.9] tracking-[-0.045em] text-balance">
                Open your account. Trade with a clearer view.
              </h2>
              <div>
                <p className="max-w-md text-[14px] leading-7 text-vantor-paper/65">
                  Forex, metals, indices and crypto, with the pricing and trade controls in plain
                  sight.
                </p>
                <div className="mt-7 flex flex-col gap-3 sm:flex-row lg:flex-col lg:items-start">
                  {session ? (
                    <Link to="/trade" className={brassButton}>
                      Open terminal
                    </Link>
                  ) : (
                    <Link to="/auth" search={{ mode: "up" }} className={brassButton}>
                      Open account
                    </Link>
                  )}
                  {session ? (
                    <Link to="/accounts" className={lightOutlineButton}>
                      Manage accounts
                    </Link>
                  ) : (
                    <Link to="/auth" search={{ mode: "in" }} className={lightOutlineButton}>
                      Sign in
                    </Link>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-16 flex flex-col gap-3 border-t border-vantor-paper/15 pt-6 text-[11px] leading-5 text-vantor-paper/50 sm:flex-row sm:items-start sm:justify-between">
              <p className="max-w-3xl">
                Risk warning: trading leveraged products carries a high level of risk and may not be
                suitable for every investor. Losses can exceed deposits without negative balance
                protection.
              </p>
              <p className="vantor-mono shrink-0">Capital at risk</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-vantor-paper/10 bg-vantor-ink text-vantor-paper">
        <div className="mx-auto grid max-w-[1440px] gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
          <div>
            <div className="flex items-center gap-3">
              <span className="vantor-display flex size-8 items-center justify-center bg-vantor-brass text-[17px] leading-none text-vantor-ink">
                V
              </span>
              <span className="vantor-display text-[24px] leading-none tracking-[-0.02em]">
                Vantor
              </span>
            </div>
            <p className="mt-4 max-w-xs text-[12px] leading-6 text-vantor-paper/55">
              Multi-asset trading for people who take the market seriously.
            </p>
          </div>

          <div>
            <h2 className="text-[12px] font-medium text-vantor-paper/90">Explore</h2>
            <ul className="mt-4 space-y-2.5 text-[12px] text-vantor-paper/55">
              <li>
                <a href="#pricing" className="transition-colors hover:text-vantor-paper">
                  Live pricing
                </a>
              </li>
              <li>
                <a href="#standards" className="transition-colors hover:text-vantor-paper">
                  Our standards
                </a>
              </li>
              <li>
                <a href="#accounts" className="transition-colors hover:text-vantor-paper">
                  Account types
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-[12px] font-medium text-vantor-paper/90">Account</h2>
            <ul className="mt-4 space-y-2.5 text-[12px] text-vantor-paper/55">
              {session ? (
                <>
                  <li>
                    <Link to="/trade" className="transition-colors hover:text-vantor-paper">
                      Trading terminal
                    </Link>
                  </li>
                  <li>
                    <Link to="/accounts" className="transition-colors hover:text-vantor-paper">
                      Manage accounts
                    </Link>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={signOut}
                      className="transition-colors hover:text-vantor-paper"
                    >
                      Sign out
                    </button>
                  </li>
                </>
              ) : (
                <>
                  <li>
                    <Link
                      to="/auth"
                      search={{ mode: "up" }}
                      className="transition-colors hover:text-vantor-paper"
                    >
                      Open account
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/auth"
                      search={{ mode: "in" }}
                      className="transition-colors hover:text-vantor-paper"
                    >
                      Sign in
                    </Link>
                  </li>
                </>
              )}
            </ul>
          </div>

          <div>
            <h2 className="text-[12px] font-medium text-vantor-paper/90">Risk disclosure</h2>
            <p className="mt-4 text-[11px] leading-6 text-vantor-paper/55">
              Trading forex, metals, indices and crypto involves significant risk. Prices can move
              quickly and past performance is not a reliable indicator of future results. Only trade
              with capital you can afford to lose.
            </p>
          </div>
        </div>

        <div className="border-t border-vantor-paper/10">
          <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-5 py-5 text-[10px] text-vantor-paper/40 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <p>© 2026 Vantor. All rights reserved.</p>
            <p>Pricing shown is indicative and may differ from executable prices.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
