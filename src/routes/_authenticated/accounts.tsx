import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listMyAccounts, listTradingServers, openDemoAccount } from "@/lib/accounts.functions";
import { moveFunds } from "@/lib/trading.functions";
import { useActiveAccount } from "@/hooks/use-active-account";
import {
  ACCOUNT_TYPES,
  CURRENCIES,
  DEFAULT_ACCOUNT_TYPE,
  DEFAULT_BALANCE,
  DEFAULT_CURRENCY,
  DEFAULT_LEVERAGE,
  LEVERAGES,
  defaultsForServer,
  formatMoney,
} from "@/lib/account-options";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/accounts")({
  component: AccountsPage,
  head: () => ({
    meta: [
      { title: "My accounts — Vantor" },
      { name: "description", content: "Open and manage your Vantor trading accounts." },
    ],
  }),
});

const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

function AccountsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const list = useServerFn(listMyAccounts);
  const listServers = useServerFn(listTradingServers);
  const openDemo = useServerFn(openDemoAccount);
  const move = useServerFn(moveFunds);
  const [, setActiveAccount] = useActiveAccount();
  const { data, isLoading } = useQuery({ queryKey: ["my-accounts"], queryFn: () => list() });
  const serversQuery = useQuery({
    queryKey: ["trading-servers"],
    queryFn: () => listServers(),
    staleTime: 5 * 60_000,
  });

  const [openPanel, setOpenPanel] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [balanceFor, setBalanceFor] = useState<string | null>(null);
  const [newBalance, setNewBalance] = useState("");
  const [serverId, setServerId] = useState("");
  const [nickname, setNickname] = useState("");
  const [accountType, setAccountType] = useState<string>(DEFAULT_ACCOUNT_TYPE);
  const [currency, setCurrency] = useState<string>(DEFAULT_CURRENCY);
  const [leverage, setLeverage] = useState<number>(DEFAULT_LEVERAGE);
  const [size, setSize] = useState(String(DEFAULT_BALANCE));
  const [traderPass, setTraderPass] = useState("");

  const servers = serversQuery.data ?? [];
  const selectedServer = servers.find((server) => server.id === serverId) ?? servers[0] ?? null;
  const accountTypeOptions = selectedServer?.account_types ?? ACCOUNT_TYPES;
  const currencyOptions = selectedServer?.currencies ?? CURRENCIES;
  const leverageOptions = selectedServer?.leverages ?? LEVERAGES;
  const minBalance = Number(selectedServer?.min_balance ?? 100);
  const maxBalance = Number(selectedServer?.max_balance ?? 1000000);

  useEffect(() => {
    const available = serversQuery.data;
    if (!available?.length) return;
    const fallback = available[0]!.id;
    setServerId((current) =>
      current && available.some((server) => server.id === current) ? current : fallback,
    );
  }, [serversQuery.data]);

  useEffect(() => {
    if (!selectedServer) return;
    const defaults = defaultsForServer(selectedServer);
    setAccountType(defaults.accountType);
    setCurrency(defaults.currency);
    setLeverage(defaults.leverage);
    setSize(String(defaults.balance));
  }, [selectedServer]);

  const openMut = useMutation({
    mutationFn: () =>
      openDemo({
        data: {
          nickname,
          accountType,
          currency,
          leverage,
          balance: Number(size),
          password: traderPass,
          serverId: selectedServer?.id ?? "",
        },
      }),
    onSuccess: (acc) => {
      qc.invalidateQueries({ queryKey: ["my-accounts"] });
      setActiveAccount(acc.id);
      setOpenPanel(false);
      setNickname("");
      setTraderPass("");
      toast.success(
        `Account "${acc.nickname}" (#${acc.login}) created on ${acc.server}. Trader password: ${acc.trader_password} — investor password: ${acc.investor_password}`,
      );
    },
    onError: (e) => toast.error(e.message),
  });
  const balanceMut = useMutation({
    mutationFn: async ({
      account,
      target,
    }: {
      account: { id: string; balance: number; currency: string };
      target: number;
    }) => {
      const delta = Math.round((target - Number(account.balance)) * 100) / 100;
      if (delta === 0) return;
      if (Math.abs(delta) < 1) throw new Error("Balance changes must be at least 1");
      await move({
        data: {
          accountId: account.id,
          kind: delta > 0 ? "deposit" : "withdraw",
          amount: Math.abs(delta),
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account"] });
      qc.invalidateQueries({ queryKey: ["my-accounts"] });
      setBalanceFor(null);
      setNewBalance("");
      toast.success("Balance updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const accounts = data ?? [];

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">My accounts</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setOpenPanel((v) => !v)}>
            + Open account
          </Button>
        </div>
      </div>

      {openPanel && (
        <section className="mt-4 rounded-lg border bg-card p-4 sm:p-5">
          <div>
            <h3 className="font-bold">Trading account</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Instant setup with MT5-style login and passwords.
            </p>
            <form
              className="mt-3 grid gap-3 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                openMut.mutate();
              }}
            >
              <div className="sm:col-span-2">
                <Label htmlFor="anick">Nickname</Label>
                <Input
                  id="anick"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="e.g. Scalping account"
                  maxLength={24}
                  required
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="aserver">Trading server</Label>
                <select
                  id="aserver"
                  className={inputCls}
                  value={selectedServer?.id ?? ""}
                  onChange={(e) => setServerId(e.target.value)}
                  disabled={serversQuery.isPending || servers.length === 0}
                  required
                >
                  {servers.length === 0 && (
                    <option value="">
                      {serversQuery.isPending ? "Loading servers…" : "No servers available"}
                    </option>
                  )}
                  {servers.map((server) => (
                    <option key={server.id} value={server.id}>
                      {server.name}
                    </option>
                  ))}
                </select>
                {selectedServer && (
                  <div className="mt-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                    <p>
                      <span className="font-medium text-foreground">{selectedServer.name}</span>
                    </p>
                    <p>{selectedServer.description}</p>
                    <p className="mt-1">
                      {selectedServer.account_types.join(" · ")} ·{" "}
                      {selectedServer.currencies.join(" / ")} · leverage up to 1:
                      {Math.max(...selectedServer.leverages)} · balance{" "}
                      {minBalance.toLocaleString("en-US")}–{maxBalance.toLocaleString("en-US")}
                    </p>
                  </div>
                )}
                {serversQuery.error && (
                  <p role="alert" className="mt-1 text-xs text-destructive">
                    {(serversQuery.error as Error).message}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="atype">Account type</Label>
                <select
                  id="atype"
                  className={inputCls}
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value)}
                >
                  {accountTypeOptions.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="acur">Currency</Label>
                <select
                  id="acur"
                  className={inputCls}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {currencyOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="alev">Leverage</Label>
                <select
                  id="alev"
                  className={inputCls}
                  value={leverage}
                  onChange={(e) => setLeverage(Number(e.target.value))}
                >
                  {leverageOptions.map((l) => (
                    <option key={l} value={l}>
                      1:{l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="asize">Starting balance ({currency})</Label>
                <Input
                  id="asize"
                  inputMode="decimal"
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Allowed: {minBalance.toLocaleString("en-US")}–{maxBalance.toLocaleString("en-US")}{" "}
                  {currency}
                </p>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="apass">Trader password</Label>
                <Input
                  id="apass"
                  type="text"
                  value={traderPass}
                  onChange={(e) => setTraderPass(e.target.value)}
                  placeholder="Min. 8 characters"
                />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={openMut.isPending || !selectedServer}>
                  {openMut.isPending ? "Creating…" : "Create account"}
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                  An investor password is generated automatically after creation.
                </p>
              </div>
            </form>
          </div>
        </section>
      )}

      {isLoading && <p className="mt-6 text-sm opacity-75">Loading…</p>}
      {!isLoading && accounts.length === 0 && (
        <p className="mt-6 text-sm opacity-75">No accounts yet — open one above.</p>
      )}

      <div className="mt-4 space-y-4">
        {accounts.map((a) => {
          const isOpen = expanded === a.id;
          const readOnly = a.access_role === "investor";
          return (
            <article key={a.id} className="rounded-lg border bg-card p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-base font-bold">{a.nickname}</span>
                <span className="rounded bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                  MT5
                </span>
                <span className="rounded bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                  {a.label}
                </span>
                <span className="font-mono font-semibold"># {a.login}</span>
                {readOnly && (
                  <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    Investor (read-only)
                  </span>
                )}
                <button
                  className="ml-auto opacity-60"
                  onClick={() => setExpanded(isOpen ? null : a.id)}
                  aria-label="Toggle details"
                >
                  {isOpen ? "▴" : "▾"}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="break-words text-2xl font-extrabold tracking-tight sm:text-3xl">
                  {formatMoney(Number(a.balance), a.currency)}{" "}
                  <span className="text-base font-normal opacity-60">{a.currency}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      setActiveAccount(a.id);
                      navigate({ to: "/trade" });
                    }}
                    disabled={readOnly}
                  >
                    Trade
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setBalanceFor(balanceFor === a.id ? null : a.id)}
                    disabled={readOnly}
                  >
                    Set Balance
                  </Button>
                </div>
              </div>
              {balanceFor === a.id && (
                <form
                  className="mt-3 flex flex-col items-stretch gap-2 sm:flex-row sm:items-end"
                  onSubmit={(e) => {
                    e.preventDefault();
                    balanceMut.mutate({ account: a, target: Number(newBalance) });
                  }}
                >
                  <div className="w-full">
                    <Label htmlFor={`bal-${a.id}`}>New balance ({a.currency})</Label>
                    <Input
                      id={`bal-${a.id}`}
                      inputMode="decimal"
                      value={newBalance}
                      onChange={(e) => setNewBalance(e.target.value)}
                      placeholder="e.g. 50000"
                    />
                  </div>
                  <Button type="submit" variant="secondary" disabled={balanceMut.isPending}>
                    Apply
                  </Button>
                </form>
              )}
              {isOpen && (
                <div className="mt-4 border-t pt-4 text-sm">
                  <div className="grid gap-3 rounded-md bg-muted p-4 sm:grid-cols-2">
                    <p className="flex justify-between">
                      <span className="opacity-60">Floating P/L</span>
                      <span>0.00 {a.currency}</span>
                    </p>
                    <p className="flex justify-between">
                      <span className="opacity-60">Free margin</span>
                      <span>{formatMoney(Number(a.balance), a.currency)}</span>
                    </p>
                    <p className="flex justify-between">
                      <span className="opacity-60">Equity</span>
                      <span>{formatMoney(Number(a.balance), a.currency)}</span>
                    </p>
                    <p className="flex justify-between">
                      <span className="opacity-60">Max leverage</span>
                      <span>1:{a.leverage}</span>
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-6">
                    <p>
                      <span className="opacity-60">Server… </span>
                      <span className="font-mono">{a.server}</span>
                    </p>
                    <p>
                      <span className="opacity-60">MT5 login… </span>
                      <span className="font-mono">{a.login}</span>
                    </p>
                    <p>
                      <span className="opacity-60">Currency… </span>
                      <span className="font-mono">{a.currency}</span>
                    </p>
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
