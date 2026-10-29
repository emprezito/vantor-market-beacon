import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, KeyRound } from "lucide-react";
import {
  listMyServers,
  listServerAccounts,
  resetServerAccountPasswords,
  setServerAccountStatus,
} from "@/lib/partner.functions";
import { openDemoAccount } from "@/lib/accounts.functions";
import {
  ACCOUNT_PASSWORD_MAX,
  ACCOUNT_PASSWORD_MIN,
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
import { canManageServer } from "@/lib/partner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/password-input";

export const Route = createFileRoute("/_authenticated/partner/accounts")({
  head: () => ({
    meta: [
      { title: "Partner accounts — Vantor" },
      { name: "description", content: "Create and manage accounts on your partner servers." },
    ],
  }),
  component: PartnerAccountsPage,
});

const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

type CreatedAccount =
  | {
      mode: "created";
      login: number;
      nickname: string;
      server: string;
    }
  | {
      mode: "reset";
      login: number;
      nickname: string;
      server: string;
      traderPassword: string;
      investorPassword: string;
    };

type AccountDraft = {
  nickname: string;
  accountType: string;
  currency: string;
  leverage: number;
  balance: string;
  traderPassword: string;
  investorPassword: string;
};

function PartnerAccountsPage() {
  const qc = useQueryClient();
  const listServers = useServerFn(listMyServers);
  const listAccounts = useServerFn(listServerAccounts);
  const openAccount = useServerFn(openDemoAccount);
  const resetPasswords = useServerFn(resetServerAccountPasswords);
  const setStatus = useServerFn(setServerAccountStatus);

  const serversQuery = useQuery({ queryKey: ["my-servers"], queryFn: () => listServers() });
  const servers = serversQuery.data ?? [];
  const [selectedId, setSelectedId] = useState("");
  const selected = servers.find((server) => server.id === selectedId) ?? servers[0] ?? null;
  const canManage = selected ? canManageServer(selected.role) : false;
  const canCreate = canManage && selected?.status === "active";

  const [openPanel, setOpenPanel] = useState(false);
  const [expandedAccountId, setExpandedAccountId] = useState<string | null>(null);
  const [createdAccount, setCreatedAccount] = useState<CreatedAccount | null>(null);
  const [accountForm, setAccountForm] = useState<AccountDraft>({
    nickname: "",
    accountType: DEFAULT_ACCOUNT_TYPE,
    currency: DEFAULT_CURRENCY,
    leverage: DEFAULT_LEVERAGE,
    balance: String(DEFAULT_BALANCE),
    traderPassword: "",
    investorPassword: "",
  });

  const accountsQuery = useQuery({
    queryKey: ["server-accounts", selected?.id],
    queryFn: () => listAccounts({ data: { serverId: selected!.id } }),
    enabled: !!selected && canManage,
  });

  useEffect(() => {
    const available = serversQuery.data ?? [];
    setSelectedId((current) =>
      available.length === 0
        ? ""
        : current && available.some((server) => server.id === current)
          ? current
          : available[0]!.id,
    );
  }, [serversQuery.data]);

  const lastServerIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selected) {
      lastServerIdRef.current = null;
      return;
    }
    if (lastServerIdRef.current === selected.id) return;
    lastServerIdRef.current = selected.id;
    const defaults = defaultsForServer(selected);
    setAccountForm({
      nickname: "",
      accountType: defaults.accountType,
      currency: defaults.currency,
      leverage: defaults.leverage,
      balance: String(defaults.balance),
      traderPassword: "",
      investorPassword: "",
    });
    setCreatedAccount(null);
    setExpandedAccountId(null);
  }, [selected]);

  const createAccountMut = useMutation({
    mutationFn: () =>
      openAccount({
        data: {
          serverId: selected!.id,
          nickname: accountForm.nickname,
          accountType: accountForm.accountType,
          currency: accountForm.currency,
          leverage: accountForm.leverage,
          balance: Number(accountForm.balance),
          traderPassword: accountForm.traderPassword,
          investorPassword: accountForm.investorPassword,
        },
      }),
    onSuccess: (account) => {
      qc.invalidateQueries({ queryKey: ["server-accounts", selected!.id] });
      qc.invalidateQueries({ queryKey: ["my-servers"] });
      qc.invalidateQueries({ queryKey: ["my-accounts"] });
      setCreatedAccount({
        mode: "created",
        login: account.login,
        nickname: account.nickname,
        server: account.server,
      });
      setAccountForm((current) => ({
        ...current,
        nickname: "",
        traderPassword: "",
        investorPassword: "",
      }));
      toast.success(`Account #${account.login} was created`);
    },
    onError: (e) => toast.error(e.message),
  });

  const resetPasswordMut = useMutation({
    mutationFn: (account: { id: string }) => {
      if (!selected) throw new Error("Choose a server first");
      return resetPasswords({
        data: { serverId: selected.id, accountId: account.id },
      });
    },
    onSuccess: (result, account) => {
      qc.invalidateQueries({ queryKey: ["server-accounts", selected?.id] });
      const current = accountsQuery.data?.find((item) => item.id === account.id);
      setCreatedAccount({
        mode: "reset",
        login: result.login,
        nickname: current?.nickname ?? "",
        server: current?.server ?? selected?.name ?? "",
        traderPassword: result.traderPassword,
        investorPassword: result.investorPassword,
      });
      toast.success(`Passwords reset for #${result.login}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const statusMut = useMutation({
    mutationFn: (input: { account: { id: string }; status: "active" | "disabled" }) => {
      if (!selected) throw new Error("Choose a server first");
      return setStatus({
        data: { serverId: selected.id, accountId: input.account.id, status: input.status },
      });
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["server-accounts", selected?.id] });
      toast.success(
        result.status === "disabled"
          ? `Account #${result.login} was disabled`
          : `Account #${result.login} was enabled`,
      );
    },
    onError: (e) => toast.error(e.message),
  });

  const accountTypeOptions = selected?.account_types ?? ACCOUNT_TYPES;
  const currencyOptions = selected?.currencies ?? CURRENCIES;
  const leverageOptions = selected?.leverages ?? LEVERAGES;

  return (
    <main className="mx-auto max-w-5xl space-y-4 px-3 pb-6 pt-3 sm:space-y-6 sm:px-6 sm:py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Accounts</h1>
          <p className="text-sm text-muted-foreground">
            Create and manage trading accounts on your partner servers.
          </p>
        </div>
        {selected && canCreate && (
          <Button variant="outline" onClick={() => setOpenPanel((value) => !value)}>
            {openPanel ? "Close form" : "+ Open account"}
          </Button>
        )}
      </div>

      {serversQuery.isPending && <p className="text-sm opacity-75">Loading your servers…</p>}
      {serversQuery.error && (
        <p role="alert" className="text-sm text-destructive">
          {(serversQuery.error as Error).message}
        </p>
      )}

      {!serversQuery.isPending && !serversQuery.error && servers.length === 0 && (
        <section className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          You don’t own or belong to a partner server yet.{" "}
          <Link to="/partner" className="text-primary underline-offset-2 hover:underline">
            Create one on the Partner page.
          </Link>
        </section>
      )}

      {selected && (
        <section className="rounded-lg border bg-card p-4 sm:p-5">
          <Label htmlFor="partner-account-server">Server</Label>
          <select
            id="partner-account-server"
            className={inputCls}
            value={selected.id}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {servers.map((server) => (
              <option key={server.id} value={server.id}>
                {server.name} · {server.visibility} · {server.role}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-muted-foreground">
            {selected.status === "active"
              ? "Active — accepts new accounts."
              : "Paused — existing accounts keep trading, new accounts are blocked."}
          </p>
        </section>
      )}

      {selected && !canManage && (
        <section className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          You are a member of this server. Only owners and admins can manage its accounts.
        </section>
      )}

      {selected && canCreate && openPanel && (
        <section className="rounded-lg border bg-card p-4 sm:p-5">
          <h2 className="font-bold">Open a trading account</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This creates a normal account owned by you on {selected.name}.
          </p>
          <form
            className="mt-3 grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              createAccountMut.mutate();
            }}
          >
            <div>
              <Label htmlFor="account-nickname">Nickname</Label>
              <Input
                id="account-nickname"
                value={accountForm.nickname}
                onChange={(event) =>
                  setAccountForm((current) => ({ ...current, nickname: event.target.value }))
                }
                placeholder="e.g. Evaluation account"
                maxLength={24}
                required
              />
            </div>
            <div>
              <Label htmlFor="account-type">Account type</Label>
              <select
                id="account-type"
                className={inputCls}
                value={accountForm.accountType}
                onChange={(event) =>
                  setAccountForm((current) => ({ ...current, accountType: event.target.value }))
                }
              >
                {accountTypeOptions.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="account-currency">Currency</Label>
              <select
                id="account-currency"
                className={inputCls}
                value={accountForm.currency}
                onChange={(event) =>
                  setAccountForm((current) => ({ ...current, currency: event.target.value }))
                }
              >
                {currencyOptions.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="account-leverage">Leverage</Label>
              <select
                id="account-leverage"
                className={inputCls}
                value={accountForm.leverage}
                onChange={(event) =>
                  setAccountForm((current) => ({
                    ...current,
                    leverage: Number(event.target.value),
                  }))
                }
              >
                {leverageOptions.map((leverage) => (
                  <option key={leverage} value={leverage}>
                    1:{leverage}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="account-balance">Starting balance ({accountForm.currency})</Label>
              <Input
                id="account-balance"
                inputMode="decimal"
                value={accountForm.balance}
                onChange={(event) =>
                  setAccountForm((current) => ({ ...current, balance: event.target.value }))
                }
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Allowed: {Number(selected.min_balance).toLocaleString("en-US")}–
                {Number(selected.max_balance).toLocaleString("en-US")} {accountForm.currency}
              </p>
            </div>
            <div>
              <Label htmlFor="account-trader-password">Trading password</Label>
              <PasswordInput
                id="account-trader-password"
                value={accountForm.traderPassword}
                onChange={(event) =>
                  setAccountForm((current) => ({
                    ...current,
                    traderPassword: event.target.value,
                  }))
                }
                autoComplete="new-password"
                minLength={ACCOUNT_PASSWORD_MIN}
                maxLength={ACCOUNT_PASSWORD_MAX}
                placeholder="Full trading access"
                required
              />
            </div>
            <div>
              <Label htmlFor="account-investor-password">Investor password</Label>
              <PasswordInput
                id="account-investor-password"
                value={accountForm.investorPassword}
                onChange={(event) =>
                  setAccountForm((current) => ({
                    ...current,
                    investorPassword: event.target.value,
                  }))
                }
                autoComplete="new-password"
                minLength={ACCOUNT_PASSWORD_MIN}
                maxLength={ACCOUNT_PASSWORD_MAX}
                placeholder="Read-only access"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <p className="text-[11px] text-muted-foreground">
                Use {ACCOUNT_PASSWORD_MIN}–{ACCOUNT_PASSWORD_MAX} characters with at least one
                letter and one number. The investor password must be different from the trading
                password.
              </p>
              <Button type="submit" className="mt-3" disabled={createAccountMut.isPending}>
                {createAccountMut.isPending ? "Creating…" : "Create account"}
              </Button>
            </div>
          </form>
        </section>
      )}

      {createdAccount && (
        <section className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
          <p className="font-semibold">
            {createdAccount.mode === "created"
              ? `Account #${createdAccount.login} created on ${createdAccount.server}`
              : `Passwords reset for #${createdAccount.login}${createdAccount.server ? ` on ${createdAccount.server}` : ""}`}
          </p>
          {createdAccount.mode === "created" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              The passwords you chose are now active. They are hashed and cannot be shown again.
            </p>
          ) : (
            <>
              <p className="mt-1">
                Trader password: <span className="font-mono">{createdAccount.traderPassword}</span>
              </p>
              <p>
                Investor password:{" "}
                <span className="font-mono">{createdAccount.investorPassword}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                These passwords are shown once. Copy them now.
              </p>
            </>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => setCreatedAccount(null)}
          >
            Dismiss
          </Button>
        </section>
      )}

      {selected && canManage && (
        <>
          {accountsQuery.isPending && <p className="text-sm opacity-75">Loading accounts…</p>}
          {accountsQuery.error && (
            <p role="alert" className="text-sm text-destructive">
              {(accountsQuery.error as Error).message}
            </p>
          )}
          {accountsQuery.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">No trading accounts yet.</p>
          )}

          <div className="space-y-4">
            {accountsQuery.data?.map((account) => {
              const isOpen = expandedAccountId === account.id;
              return (
                <article key={account.id} className="rounded-lg border bg-card p-4 sm:p-5">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-base font-bold">{account.nickname}</span>
                    <span className="rounded bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                      MT5
                    </span>
                    <span className="rounded bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                      {account.label}
                    </span>
                    <span className="font-mono font-semibold"># {account.login}</span>
                    {account.status === "disabled" && (
                      <span className="rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                        Disabled
                      </span>
                    )}
                    <button
                      type="button"
                      className="ml-auto rounded p-1 opacity-60 transition hover:bg-muted hover:opacity-100"
                      onClick={() => setExpandedAccountId(isOpen ? null : account.id)}
                      aria-label="Toggle account details"
                      aria-expanded={isOpen}
                    >
                      {isOpen ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
                    <p className="break-words text-2xl font-extrabold tracking-tight sm:text-3xl">
                      {formatMoney(account.balance, account.currency)}{" "}
                      <span className="text-base font-normal opacity-60">{account.currency}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">Leverage 1:{account.leverage}</p>
                  </div>

                  {isOpen && (
                    <div className="mt-4 border-t pt-4 text-sm">
                      <div className="grid gap-3 rounded-md bg-muted p-4 sm:grid-cols-2">
                        <p className="flex justify-between gap-3">
                          <span className="opacity-60">Server</span>
                          <span className="font-mono">{account.server}</span>
                        </p>
                        <p className="flex justify-between gap-3">
                          <span className="opacity-60">MT5 login</span>
                          <span className="font-mono">{account.login}</span>
                        </p>
                        <p className="flex justify-between gap-3">
                          <span className="opacity-60">Account type</span>
                          <span>{account.label}</span>
                        </p>
                        <p className="flex justify-between gap-3">
                          <span className="opacity-60">Currency</span>
                          <span className="font-mono">{account.currency}</span>
                        </p>
                        <p className="flex justify-between gap-3">
                          <span className="opacity-60">Leverage</span>
                          <span>1:{account.leverage}</span>
                        </p>
                        <p className="flex justify-between gap-3">
                          <span className="opacity-60">Created</span>
                          <span>{new Date(account.created_at).toLocaleDateString()}</span>
                        </p>
                      </div>

                      <div className="mt-3 rounded-md border p-3">
                        <p className="flex items-center gap-2 font-medium">
                          <KeyRound className="h-4 w-4" /> Credentials
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Reset both trading passwords. Existing terminal sessions are signed out.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => resetPasswordMut.mutate(account)}
                            disabled={resetPasswordMut.isPending}
                          >
                            {resetPasswordMut.isPending ? "Resetting…" : "Reset passwords"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              statusMut.mutate({
                                account,
                                status: account.status === "disabled" ? "active" : "disabled",
                              })
                            }
                            disabled={statusMut.isPending}
                          >
                            {statusMut.isPending
                              ? "Saving…"
                              : account.status === "disabled"
                                ? "Enable account"
                                : "Disable account"}
                          </Button>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Disabling an account signs out active terminal sessions and blocks new
                          logins.
                        </p>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
