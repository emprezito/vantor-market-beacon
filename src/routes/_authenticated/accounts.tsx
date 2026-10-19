import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { claimTradingAccount, listMyAccounts, openDemoAccount } from "@/lib/accounts.functions";
import { moveFunds } from "@/lib/trading.functions";
import { useAccount } from "@/hooks/use-account";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/accounts")({
  component: AccountsPage,
  head: () => ({
    meta: [
      { title: "My accounts — Vantor" },
      { name: "description", content: "Open and manage your Vantor demo trading accounts." },
    ],
  }),
});

const money = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function AccountsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const list = useServerFn(listMyAccounts);
  const openDemo = useServerFn(openDemoAccount);
  const claim = useServerFn(claimTradingAccount);
  const move = useServerFn(moveFunds);
  const account = useAccount();
  const { data, isLoading } = useQuery({ queryKey: ["my-accounts"], queryFn: () => list() });

  const [tab, setTab] = useState<"demo" | "real">("demo");
  const [openPanel, setOpenPanel] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [balanceFor, setBalanceFor] = useState<string | null>(null);
  const [newBalance, setNewBalance] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [server, setServer] = useState("");

  const balance = account.data?.balance ?? 0;

  const openMut = useMutation({
    mutationFn: () => openDemo(),
    onSuccess: (acc) => {
      qc.invalidateQueries({ queryKey: ["my-accounts"] });
      setOpenPanel(false);
      toast.success(`Demo account #${acc.login} created. Trader password: ${acc.trader_password} — investor password: ${acc.investor_password} — server: ${acc.server}`);
    },
    onError: (e) => toast.error(e.message),
  });
  const claimMut = useMutation({
    mutationFn: () => claim({ data: { login, password, server } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["my-accounts"] });
      setOpenPanel(false); setLogin(""); setPassword(""); setServer("");
      toast.success(r.role === "investor" ? "Account linked with investor (read-only) access" : "Account linked — you can trade on it now");
    },
    onError: (e) => toast.error(e.message),
  });
  const balanceMut = useMutation({
    mutationFn: async (target: number) => {
      const delta = Math.round((target - balance) * 100) / 100;
      if (delta === 0) return;
      if (Math.abs(delta) < 1) throw new Error("Balance changes must be at least $1");
      await move({ data: { kind: delta > 0 ? "deposit" : "withdraw", amount: Math.abs(delta) } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account"] });
      setBalanceFor(null); setNewBalance("");
      toast.success("Balance updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const accounts = (data ?? []).filter((a) => a.kind === tab);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-extrabold tracking-tight">My accounts</h1>
        <Button variant="outline" onClick={() => setOpenPanel((v) => !v)}>+ Open account</Button>
      </div>

      {openPanel && (
        <section className="mt-4 grid gap-4 rounded-lg border bg-card p-5 sm:grid-cols-3">
          <div className="rounded-md border p-4 opacity-60">
            <h3 className="font-bold">Real account</h3>
            <p className="mt-1 text-sm">Real-money trading is not available on this demo platform.</p>
            <Button className="mt-3" disabled>Unavailable</Button>
          </div>
          <div className="rounded-md border p-4">
            <h3 className="font-bold">Demo account</h3>
            <p className="mt-1 text-sm opacity-75">Virtual money, instant setup, MT5-style login and passwords.</p>
            <Button className="mt-3" disabled={openMut.isPending} onClick={() => openMut.mutate()}>
              {openMut.isPending ? "Creating…" : "Create demo account"}
            </Button>
          </div>
          <div className="rounded-md border p-4">
            <h3 className="font-bold">Log in to an existing account</h3>
            <form
              className="mt-2 space-y-2"
              onSubmit={(e) => { e.preventDefault(); claimMut.mutate(); }}
            >
              <div>
                <Label htmlFor="login">Login</Label>
                <Input id="login" inputMode="numeric" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="e.g. 81792377" />
              </div>
              <div>
                <Label htmlFor="tp">Trader or investor password</Label>
                <Input id="tp" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
              </div>
              <div>
                <Label htmlFor="srv">Server</Label>
                <Input id="srv" value={server} onChange={(e) => setServer(e.target.value)} placeholder="e.g. Vantor-Demo01" />
              </div>
              <Button type="submit" disabled={claimMut.isPending}>{claimMut.isPending ? "Linking…" : "Log in"}</Button>
            </form>
          </div>
        </section>
      )}

      <div className="mt-6 inline-flex rounded-md border">
        {(["real", "demo"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-1.5 text-sm capitalize ${tab === t ? "bg-secondary font-semibold" : "opacity-70"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {isLoading && <p className="mt-6 text-sm opacity-75">Loading…</p>}
      {!isLoading && accounts.length === 0 && (
        <p className="mt-6 text-sm opacity-75">
          {tab === "real" ? "Real accounts are not available on this demo platform." : "No demo accounts yet — open one above."}
        </p>
      )}

      <div className="mt-4 space-y-4">
        {accounts.map((a) => {
          const isOpen = expanded === a.id;
          const readOnly = a.access_role === "investor";
          return (
            <article key={a.id} className="rounded-lg border bg-card p-5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded bg-primary/15 px-2 py-0.5 font-medium text-primary capitalize">{a.kind}</span>
                <span className="rounded bg-secondary px-2 py-0.5 font-medium">MT5</span>
                <span className="rounded bg-secondary px-2 py-0.5 font-medium">{a.label}</span>
                <span className="font-mono font-semibold"># {a.login}</span>
                {readOnly && <span className="rounded bg-secondary px-2 py-0.5 text-xs">Investor (read-only)</span>}
                <button className="ml-auto opacity-60" onClick={() => setExpanded(isOpen ? null : a.id)} aria-label="Toggle details">
                  {isOpen ? "▴" : "▾"}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-3xl font-extrabold tracking-tight">
                  {money(balance)} <span className="text-base font-normal opacity-60">USD</span>
                </p>
                <div className="flex gap-2">
                  <Button onClick={() => navigate({ to: "/trade" })} disabled={readOnly}>Trade</Button>
                  <Button variant="outline" onClick={() => setBalanceFor(balanceFor === a.id ? null : a.id)} disabled={readOnly}>Set Balance</Button>
                </div>
              </div>
              {balanceFor === a.id && (
                <form
                  className="mt-3 flex items-end gap-2"
                  onSubmit={(e) => { e.preventDefault(); balanceMut.mutate(Number(newBalance)); }}
                >
                  <div>
                    <Label htmlFor={`bal-${a.id}`}>New balance (USD)</Label>
                    <Input id={`bal-${a.id}`} inputMode="decimal" value={newBalance} onChange={(e) => setNewBalance(e.target.value)} placeholder="e.g. 50000" />
                  </div>
                  <Button type="submit" variant="secondary" disabled={balanceMut.isPending}>Apply</Button>
                </form>
              )}
              {isOpen && (
                <div className="mt-4 border-t pt-4 text-sm">
                  <div className="grid gap-3 rounded-md bg-secondary/50 p-4 sm:grid-cols-2">
                    <p className="flex justify-between"><span className="opacity-60">Floating P/L</span><span>0.00 USD</span></p>
                    <p className="flex justify-between"><span className="opacity-60">Free margin</span><span>{money(balance)} USD</span></p>
                    <p className="flex justify-between"><span className="opacity-60">Equity</span><span>{money(balance)} USD</span></p>
                    <p className="flex justify-between"><span className="opacity-60">Max leverage</span><span>1:100</span></p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-6">
                    <p><span className="opacity-60">Server… </span><span className="font-mono">{a.server}</span></p>
                    <p><span className="opacity-60">MT5 login… </span><span className="font-mono">{a.login}</span></p>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </main>
  );
}
