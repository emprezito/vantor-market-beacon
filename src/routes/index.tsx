import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vantor — Trade Forex, Gold & Indices" },
      { name: "description", content: "Low spreads, instant withdrawals and fast execution on 200+ instruments." },
      { property: "og:title", content: "Vantor — Trade Forex, Gold & Indices" },
      { property: "og:description", content: "Low spreads, instant withdrawals and fast execution." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const quotes = [
  ["EUR/USD", "1.08542", "+0.12%"],
  ["XAU/USD", "2384.10", "+0.48%"],
  ["GBP/USD", "1.27311", "-0.05%"],
  ["US30", "39102.5", "+0.31%"],
  ["BTC/USD", "67420.0", "+1.20%"],
  ["USD/JPY", "151.204", "-0.18%"],
];

const features = [
  ["Instant withdrawals", "Get your money in seconds, 24/7, with no manual review."],
  ["Spreads from 0.0", "Tight, stable pricing even during high-impact news."],
  ["Negative balance protection", "Never lose more than your account balance."],
  ["Leverage up to 1:2000", "Flexible conditions tailored to your trading style."],
];

const accounts = [
  ["Standard", "$10", "From 0.2 pips", "No commission"],
  ["Pro", "$200", "From 0.1 pips", "No commission"],
  ["Raw Spread", "$200", "From 0.0 pips", "$3.5 / lot"],
  ["Zero", "$200", "0.0 pips", "From $0.2 / lot"],
];

function Index() {
  const session = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 bg-secondary text-secondary-foreground">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6 sm:py-4">
          <span className="text-2xl font-extrabold tracking-tight text-primary">vantor</span>
          <nav className="order-3 flex w-full gap-5 overflow-x-auto text-sm md:order-none md:w-auto md:gap-8">
            <Link to="/trade" className="whitespace-nowrap opacity-80 hover:opacity-100">Trading</Link>
            <Link to="/history" className="whitespace-nowrap opacity-80 hover:opacity-100">History</Link>
            <Link to="/wallet" className="whitespace-nowrap opacity-80 hover:opacity-100">Wallet</Link>
          </nav>
          <div className="ml-auto flex gap-2 text-sm sm:gap-3">
            {session ? <>
              <Button variant="ghost" onClick={signOut}>Sign out</Button>
              <Button asChild><Link to="/trade">Trade</Link></Button>
            </> : <>
              <Button variant="ghost" asChild><Link to="/auth" search={{ mode: "in" }}>Sign in</Link></Button>
              <Button asChild><Link to="/auth" search={{ mode: "up" }}>Register</Link></Button>
            </>}
          </div>
        </div>
      </header>

      <section className="bg-secondary text-secondary-foreground">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 sm:py-20 md:grid-cols-2 md:items-center md:gap-12 md:py-24">
          <div>
            <h1 className="text-4xl font-extrabold leading-tight sm:text-5xl md:text-6xl">
              Trade with a <span className="text-primary">trusted</span> broker
            </h1>
            <p className="mt-5 max-w-md text-base opacity-75 sm:mt-6 sm:text-lg">
              Better-than-market conditions, instant withdrawals and execution in milliseconds.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:gap-4">
              <Button size="lg" asChild><Link to="/auth" search={{ mode: "up" }}>Open account</Link></Button>
              <Button size="lg" variant="ghost" className="border border-secondary-foreground/30" asChild><Link to={session ? "/trade" : "/auth"} search={{ mode: "up" }}>Start trading</Link></Button>
            </div>
          </div>
          <div className="rounded-2xl border border-secondary-foreground/10 bg-secondary-foreground/5 p-4 sm:p-6">
            {quotes.map(([s, p, c]) => (
              <div key={s} className="flex justify-between border-b border-secondary-foreground/10 py-3 last:border-0">
                <span className="font-semibold">{s}</span>
                <span className="font-mono">{p}</span>
                <span className={c?.startsWith("+") ? "text-accent" : "text-destructive"}>{c}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20">
        <h2 className="text-3xl font-extrabold sm:text-4xl">Why traders choose us</h2>
        <div className="mt-8 grid gap-4 sm:mt-10 sm:grid-cols-2 sm:gap-6 md:grid-cols-4">
          {features.map(([t, d]) => (
            <div key={t} className="rounded-xl bg-muted p-5 sm:p-6">
              <div className="mb-4 h-1 w-10 bg-primary" />
              <h3 className="text-lg font-bold">{t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-muted py-14 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <h2 className="text-3xl font-extrabold sm:text-4xl">Account types</h2>
          <div className="mt-8 grid gap-4 sm:mt-10 sm:grid-cols-2 sm:gap-6 md:grid-cols-4">
            {accounts.map(([n, dep, sp, com]) => (
              <div key={n} className="rounded-xl bg-background p-5 shadow-sm sm:p-6">
                <h3 className="text-xl font-bold">{n}</h3>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Min deposit</dt><dd>{dep}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Spread</dt><dd>{sp}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Commission</dt><dd>{com}</dd></div>
                </dl>
                <Button className="mt-6 w-full" asChild><Link to="/auth" search={{ mode: "up" }}>Open account</Link></Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 text-center sm:px-6 sm:py-20">
        <h2 className="text-3xl font-extrabold sm:text-4xl">Start trading in minutes</h2>
        <Button size="lg" className="mt-8" asChild><Link to="/auth" search={{ mode: "up" }}>Register now</Link></Button>
      </section>

      <footer className="bg-secondary py-8 text-xs text-secondary-foreground/60 sm:py-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          Risk warning: Trading leveraged products carries a high level of risk and may not be suitable for all investors. © 2026 Vantor.
        </div>
      </footer>
    </div>
  );
}
