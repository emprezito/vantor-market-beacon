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
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <span className="text-2xl font-extrabold tracking-tight text-primary">vantor</span>
          <nav className="hidden gap-8 text-sm md:flex">
            <Link to="/trade" className="opacity-80 hover:opacity-100">Trading</Link>
            <Link to="/history" className="opacity-80 hover:opacity-100">History</Link>
            <Link to="/wallet" className="opacity-80 hover:opacity-100">Wallet</Link>
          </nav>
          <div className="flex gap-3 text-sm">
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
        <div className="mx-auto grid max-w-7xl gap-12 px-6 py-24 md:grid-cols-2 md:items-center">
          <div>
            <h1 className="text-5xl font-extrabold leading-tight md:text-6xl">
              Trade with a <span className="text-primary">trusted</span> broker
            </h1>
            <p className="mt-6 max-w-md text-lg opacity-75">
              Better-than-market conditions, instant withdrawals and execution in milliseconds.
            </p>
            <div className="mt-8 flex gap-4">
              <Button size="lg" asChild><Link to="/auth" search={{ mode: "up" }}>Open account</Link></Button>
              <Button size="lg" variant="ghost" className="border border-secondary-foreground/30" asChild><Link to={session ? "/trade" : "/auth"} search={{ mode: "up" }}>Try free demo</Link></Button>
            </div>
          </div>
          <div className="rounded-2xl border border-secondary-foreground/10 bg-secondary-foreground/5 p-6">
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

      <section className="mx-auto max-w-7xl px-6 py-20">
        <h2 className="text-4xl font-extrabold">Why traders choose us</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-4">
          {features.map(([t, d]) => (
            <div key={t} className="rounded-xl bg-muted p-6">
              <div className="mb-4 h-1 w-10 bg-primary" />
              <h3 className="text-lg font-bold">{t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-muted py-20">
        <div className="mx-auto max-w-7xl px-6">
          <h2 className="text-4xl font-extrabold">Account types</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-4">
            {accounts.map(([n, dep, sp, com]) => (
              <div key={n} className="rounded-xl bg-background p-6 shadow-sm">
                <h3 className="text-xl font-bold">{n}</h3>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between"><dt className="text-muted-foreground">Min deposit</dt><dd>{dep}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Spread</dt><dd>{sp}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Commission</dt><dd>{com}</dd></div>
                </dl>
                <Button className="mt-6 w-full" asChild><Link to="/auth" search={{ mode: "up" }}>Open account</Link></Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 text-center">
        <h2 className="text-4xl font-extrabold">Start trading in minutes</h2>
        <Button size="lg" className="mt-8" asChild><Link to="/auth" search={{ mode: "up" }}>Register now</Link></Button>
      </section>

      <footer className="bg-secondary py-10 text-xs text-secondary-foreground/60">
        <div className="mx-auto max-w-7xl px-6">
          Risk warning: Trading leveraged products carries a high level of risk and may not be suitable for all investors. © 2026 Vantor.
        </div>
      </footer>
    </div>
  );
}
