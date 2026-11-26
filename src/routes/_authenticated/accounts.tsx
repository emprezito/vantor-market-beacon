import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  listMyAccounts,
  listTradingServers,
  openDemoAccount,
  openRealAccount,
} from "@/lib/accounts.functions";
import { createRealDeposit, listRealDeposits } from "@/lib/deposits.functions";
import { getKycStatus } from "@/lib/kyc.functions";
import { moveFunds } from "@/lib/trading.functions";
import { useActiveAccount } from "@/hooks/use-active-account";
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
import {
  depositMinimum,
  depositStatusLabel,
  supportsRealDeposits,
  validateDepositAmount,
} from "@/lib/real-deposits";
import { kycStatusLabel } from "@/lib/kyc";
import { KycChecklist } from "@/components/kyc-checklist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/password-input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/accounts")({
  component: AccountsPage,
  head: () => ({
    meta: [{ title: "My accounts — Vantor" }],
  }),
});

const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

type CreatedAccount = {
  login: number;
  nickname: string;
  server: string;
};

type Account = NonNullable<Awaited<ReturnType<typeof listMyAccounts>>>[number];
type Deposit = Awaited<ReturnType<typeof listRealDeposits>>[number];

function AccountsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const list = useServerFn(listMyAccounts);
  const listServers = useServerFn(listTradingServers);
  const openDemo = useServerFn(openDemoAccount);
  const openReal = useServerFn(openRealAccount);
  const move = useServerFn(moveFunds);
  const listDeposits = useServerFn(listRealDeposits);
  const createDeposit = useServerFn(createRealDeposit);
  const kycStatusFn = useServerFn(getKycStatus);
  const [, setActiveAccount] = useActiveAccount();

  const accountsQuery = useQuery({ queryKey: ["my-accounts"], queryFn: () => list() });
  const serversQuery = useQuery({
    queryKey: ["trading-servers"],
    queryFn: () => listServers(),
    staleTime: 5 * 60_000,
  });
  const kycQuery = useQuery({
    queryKey: ["kyc"],
    queryFn: () => kycStatusFn(),
    refetchOnWindowFocus: true,
  });
  const depositsQuery = useQuery({
    queryKey: ["real-deposits"],
    queryFn: () => listDeposits(),
    refetchInterval: 5_000,
  });

  const [tab, setTab] = useState("demo");
  const [openPanel, setOpenPanel] = useState(false);
  const [realOpenPanel, setRealOpenPanel] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [balanceFor, setBalanceFor] = useState<string | null>(null);
  const [newBalance, setNewBalance] = useState("");
  const [serverId, setServerId] = useState("");
  const [nickname, setNickname] = useState("");
  const [accountType, setAccountType] = useState<string>(DEFAULT_ACCOUNT_TYPE);
  const [currency, setCurrency] = useState<string>(DEFAULT_CURRENCY);
  const [leverage, setLeverage] = useState<number>(DEFAULT_LEVERAGE);
  const [size, setSize] = useState(String(DEFAULT_BALANCE));
  const [traderPassword, setTraderPassword] = useState("");
  const [investorPassword, setInvestorPassword] = useState("");
  const [createdAccount, setCreatedAccount] = useState<CreatedAccount | null>(null);

  const [realServerId, setRealServerId] = useState("");
  const [realNickname, setRealNickname] = useState("");
  const [realAccountType, setRealAccountType] = useState<string>(DEFAULT_ACCOUNT_TYPE);
  const [realCurrency, setRealCurrency] = useState("USD");
  const [realLeverage, setRealLeverage] = useState<number>(DEFAULT_LEVERAGE);
  const [realTraderPassword, setRealTraderPassword] = useState("");
  const [realInvestorPassword, setRealInvestorPassword] = useState("");

  const [depositFor, setDepositFor] = useState<Account | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const defaultTabPicked = useRef(false);
  const seenDeposits = useRef<Set<string> | null>(null);

  const servers = serversQuery.data ?? [];
  const selectedServer = servers.find((server) => server.id === serverId) ?? servers[0] ?? null;
  const accountTypeOptions = selectedServer?.account_types ?? ACCOUNT_TYPES;
  const currencyOptions = selectedServer?.currencies ?? CURRENCIES;
  const leverageOptions = selectedServer?.leverages ?? LEVERAGES;
  const minBalance = Number(selectedServer?.min_balance ?? 100);
  const maxBalance = Number(selectedServer?.max_balance ?? 1000000);

  const realServers = servers.filter((server) =>
    (server.currencies ?? []).some((code) => supportsRealDeposits(code)),
  );
  const selectedRealServer =
    realServers.find((server) => server.id === realServerId) ?? realServers[0] ?? null;
  const realAccountTypeOptions = selectedRealServer?.account_types ?? ACCOUNT_TYPES;
  const realCurrencyOptions = (selectedRealServer?.currencies ?? CURRENCIES).filter((code) =>
    supportsRealDeposits(code),
  );
  const realLeverageOptions = selectedRealServer?.leverages ?? LEVERAGES;

  useEffect(() => {
    const available = serversQuery.data;
    if (!available?.length) return;
    const fallback = available[0]!.id;
    setServerId((current) =>
      current && available.some((server) => server.id === current) ? current : fallback,
    );
  }, [serversQuery.data]);

  useEffect(() => {
    const available = (serversQuery.data ?? []).filter((server) =>
      (server.currencies ?? []).some((code) => supportsRealDeposits(code)),
    );
    if (!available.length) return;
    setRealServerId((current) =>
      current && available.some((server) => server.id === current) ? current : available[0]!.id,
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

  useEffect(() => {
    if (!selectedRealServer) return;
    const supported = (selectedRealServer.currencies ?? []).filter((code) =>
      supportsRealDeposits(code),
    );
    const defaults = defaultsForServer(selectedRealServer);
    setRealAccountType(defaults.accountType);
    setRealLeverage(defaults.leverage);
    setRealCurrency(
      supported.includes(defaults.currency) ? defaults.currency : (supported[0] ?? "USD"),
    );
  }, [selectedRealServer]);

  const accounts = accountsQuery.data ?? [];
  const deposits = useMemo(() => depositsQuery.data ?? [], [depositsQuery.data]);
  const demoAccounts = accounts.filter((account) => account.kind !== "real");
  const realAccounts = accounts.filter((account) => account.kind === "real");
  const kyc = kycQuery.data;
  const kycApproved = kyc?.approved ?? false;

  useEffect(() => {
    if (defaultTabPicked.current || !accountsQuery.data) return;
    defaultTabPicked.current = true;
    if (accountsQuery.data.some((account) => account.kind === "real")) setTab("real");
  }, [accountsQuery.data]);

  useEffect(() => {
    const succeeded = new Set(
      deposits.filter((deposit) => deposit.status === "succeeded").map((deposit) => deposit.id),
    );
    if (seenDeposits.current) {
      const fresh = [...succeeded].some((id) => !seenDeposits.current!.has(id));
      if (fresh) qc.invalidateQueries({ queryKey: ["my-accounts"] });
    }
    seenDeposits.current = succeeded;
  }, [deposits, qc]);

  const openMut = useMutation({
    mutationFn: () =>
      openDemo({
        data: {
          nickname,
          accountType,
          currency,
          leverage,
          balance: Number(size),
          serverId: selectedServer?.id ?? "",
          traderPassword,
          investorPassword,
        },
      }),
    onSuccess: (account) => {
      qc.invalidateQueries({ queryKey: ["my-accounts"] });
      setActiveAccount(account.id);
      setOpenPanel(false);
      setNickname("");
      setTraderPassword("");
      setInvestorPassword("");
      setCreatedAccount({
        login: account.login,
        nickname: account.nickname,
        server: account.server,
      });
      toast.success(`Account #${account.login} was created`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const openRealMut = useMutation({
    mutationFn: () =>
      openReal({
        data: {
          nickname: realNickname,
          accountType: realAccountType,
          currency: realCurrency,
          leverage: realLeverage,
          serverId: selectedRealServer?.id ?? "",
          traderPassword: realTraderPassword,
          investorPassword: realInvestorPassword,
        },
      }),
    onSuccess: (account) => {
      qc.invalidateQueries({ queryKey: ["my-accounts"] });
      setActiveAccount(account.id);
      setRealOpenPanel(false);
      setRealNickname("");
      setRealTraderPassword("");
      setRealInvestorPassword("");
      setCreatedAccount({
        login: account.login,
        nickname: account.nickname,
        server: account.server,
      });
      setTab("real");
      toast.success(`Account #${account.login} was created`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const balanceMut = useMutation({
    mutationFn: async ({ account, target }: { account: Account; target: number }) => {
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
    onError: (error: Error) => toast.error(error.message),
  });

  const depositMut = useMutation({
    mutationFn: ({ account, amount }: { account: Account; amount: number }) =>
      createDeposit({ data: { accountId: account.id, amount } }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["real-deposits"] });
      window.location.assign(result.checkoutUrl);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const openDeposit = (account: Account) => {
    setDepositFor(account);
    setDepositAmount(String(Math.max(depositMinimum(account.currency), 100)));
  };

  let depositValid = false;
  try {
    if (depositFor) {
      validateDepositAmount(Number(depositAmount), depositFor.currency);
      depositValid = true;
    }
  } catch {
    depositValid = false;
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">My accounts</h1>

      <Tabs value={tab} onValueChange={setTab} className="mt-4">
        <TabsList className="grid w-full max-w-xs grid-cols-2">
          <TabsTrigger value="demo">Demo</TabsTrigger>
          <TabsTrigger value="real">Real</TabsTrigger>
        </TabsList>

        <TabsContent value="demo" className="mt-4">
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setOpenPanel((value) => !value)}>
              + Demo account
            </Button>
          </div>

          {openPanel && (
            <section className="mt-4 rounded-lg border bg-card p-4 sm:p-5">
              <form
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  openMut.mutate();
                }}
              >
                <div className="sm:col-span-2">
                  <Label htmlFor="anick">Nickname</Label>
                  <Input
                    id="anick"
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                    maxLength={24}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="aserver">Server</Label>
                  <select
                    id="aserver"
                    className={inputCls}
                    value={selectedServer?.id ?? ""}
                    onChange={(event) => setServerId(event.target.value)}
                    disabled={serversQuery.isPending || servers.length === 0}
                    required
                  >
                    {servers.length === 0 && (
                      <option value="">
                        {serversQuery.isPending ? "Loading" : "No servers available"}
                      </option>
                    )}
                    {servers.map((server) => (
                      <option key={server.id} value={server.id}>
                        {server.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="atype">Account type</Label>
                  <select
                    id="atype"
                    className={inputCls}
                    value={accountType}
                    onChange={(event) => setAccountType(event.target.value)}
                  >
                    {accountTypeOptions.map((value) => (
                      <option key={value} value={value}>
                        {value}
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
                    onChange={(event) => setCurrency(event.target.value)}
                  >
                    {currencyOptions.map((value) => (
                      <option key={value} value={value}>
                        {value}
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
                    onChange={(event) => setLeverage(Number(event.target.value))}
                  >
                    {leverageOptions.map((value) => (
                      <option key={value} value={value}>
                        1:{value}
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
                    onChange={(event) => setSize(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="atraderpass">Trading password</Label>
                  <PasswordInput
                    id="atraderpass"
                    value={traderPassword}
                    onChange={(event) => setTraderPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={ACCOUNT_PASSWORD_MIN}
                    maxLength={ACCOUNT_PASSWORD_MAX}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="ainvestorpass">Investor password</Label>
                  <PasswordInput
                    id="ainvestorpass"
                    value={investorPassword}
                    onChange={(event) => setInvestorPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={ACCOUNT_PASSWORD_MIN}
                    maxLength={ACCOUNT_PASSWORD_MAX}
                    required
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={openMut.isPending || !selectedServer}>
                    {openMut.isPending ? "Creating" : "Create account"}
                  </Button>
                </div>
              </form>
            </section>
          )}

          {serversQuery.error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {(serversQuery.error as Error).message}
            </p>
          )}
          {accountsQuery.isPending && (
            <p className="mt-6 text-sm text-muted-foreground" role="status">
              Loading
            </p>
          )}
          <div className="mt-4 space-y-4">
            {demoAccounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                deposits={deposits}
                expanded={expanded === account.id}
                onToggle={() => setExpanded(expanded === account.id ? null : account.id)}
                onTrade={() => {
                  setActiveAccount(account.id);
                  navigate({ to: "/trade" });
                }}
                onBalance={() => {
                  setBalanceFor(balanceFor === account.id ? null : account.id);
                  setNewBalance(String(account.balance));
                }}
                balanceOpen={balanceFor === account.id}
                newBalance={newBalance}
                onNewBalance={setNewBalance}
                onBalanceSubmit={(event) => {
                  event.preventDefault();
                  balanceMut.mutate({ account, target: Number(newBalance) });
                }}
                balancePending={balanceMut.isPending}
                onDeposit={null}
              />
            ))}
            {!accountsQuery.isPending && demoAccounts.length === 0 && (
              <p className="rounded-lg border px-4 py-8 text-center text-sm text-muted-foreground">
                No demo accounts
              </p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="real" className="mt-4 space-y-4">
          <section className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="font-bold">Verification</h2>
                <span className="rounded bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                  {kycStatusLabel(kyc?.profile?.status)}
                </span>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/kyc">{kyc ? "Open" : "Verify"}</Link>
              </Button>
            </div>
            <div className="mt-3">
              <KycChecklist steps={kyc?.steps} />
            </div>
            {kyc?.profile?.status === "rejected" && kyc.profile.rejectionReason && (
              <p className="mt-2 text-sm text-destructive">{kyc.profile.rejectionReason}</p>
            )}
          </section>

          {kycApproved && (
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setRealOpenPanel((value) => !value)}>
                + Real account
              </Button>
            </div>
          )}

          {kycApproved && realOpenPanel && (
            <section className="rounded-lg border bg-card p-4 sm:p-5">
              <form
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  openRealMut.mutate();
                }}
              >
                <div className="sm:col-span-2">
                  <Label htmlFor="rnick">Nickname</Label>
                  <Input
                    id="rnick"
                    value={realNickname}
                    onChange={(event) => setRealNickname(event.target.value)}
                    maxLength={24}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="rserver">Server</Label>
                  <select
                    id="rserver"
                    className={inputCls}
                    value={selectedRealServer?.id ?? ""}
                    onChange={(event) => setRealServerId(event.target.value)}
                    disabled={serversQuery.isPending || realServers.length === 0}
                    required
                  >
                    {realServers.length === 0 && <option value="">No servers available</option>}
                    {realServers.map((server) => (
                      <option key={server.id} value={server.id}>
                        {server.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="rtype">Account type</Label>
                  <select
                    id="rtype"
                    className={inputCls}
                    value={realAccountType}
                    onChange={(event) => setRealAccountType(event.target.value)}
                  >
                    {realAccountTypeOptions.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="rcur">Currency</Label>
                  <select
                    id="rcur"
                    className={inputCls}
                    value={realCurrency}
                    onChange={(event) => setRealCurrency(event.target.value)}
                  >
                    {realCurrencyOptions.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="rlev">Leverage</Label>
                  <select
                    id="rlev"
                    className={inputCls}
                    value={realLeverage}
                    onChange={(event) => setRealLeverage(Number(event.target.value))}
                  >
                    {realLeverageOptions.map((value) => (
                      <option key={value} value={value}>
                        1:{value}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="rtraderpass">Trading password</Label>
                  <PasswordInput
                    id="rtraderpass"
                    value={realTraderPassword}
                    onChange={(event) => setRealTraderPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={ACCOUNT_PASSWORD_MIN}
                    maxLength={ACCOUNT_PASSWORD_MAX}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="rinvestorpass">Investor password</Label>
                  <PasswordInput
                    id="rinvestorpass"
                    value={realInvestorPassword}
                    onChange={(event) => setRealInvestorPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={ACCOUNT_PASSWORD_MIN}
                    maxLength={ACCOUNT_PASSWORD_MAX}
                    required
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button
                    type="submit"
                    disabled={
                      openRealMut.isPending ||
                      !selectedRealServer ||
                      realCurrencyOptions.length === 0
                    }
                  >
                    {openRealMut.isPending ? "Creating" : "Create account"}
                  </Button>
                </div>
              </form>
            </section>
          )}

          <div className="space-y-4">
            {realAccounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                deposits={deposits}
                expanded={expanded === account.id}
                onToggle={() => setExpanded(expanded === account.id ? null : account.id)}
                onTrade={() => {
                  setActiveAccount(account.id);
                  navigate({ to: "/trade" });
                }}
                onBalance={() => undefined}
                balanceOpen={false}
                newBalance={newBalance}
                onNewBalance={setNewBalance}
                onBalanceSubmit={() => undefined}
                balancePending={false}
                onDeposit={() => openDeposit(account)}
              />
            ))}
            {!accountsQuery.isPending && realAccounts.length === 0 && (
              <p className="rounded-lg border px-4 py-8 text-center text-sm text-muted-foreground">
                No real accounts
              </p>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {createdAccount && (
        <section className="mt-4 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold">
              Account #{createdAccount.login} · {createdAccount.server}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setCreatedAccount(null)}
            >
              Dismiss
            </Button>
          </div>
        </section>
      )}

      <Dialog
        open={!!depositFor}
        onOpenChange={(open) => {
          if (!open) setDepositFor(null);
        }}
      >
        <DialogContent className="w-[calc(100%_-_2rem)] rounded-xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Deposit</DialogTitle>
          </DialogHeader>
          {depositFor && (
            <>
              <div>
                <Label htmlFor="deposit-amount">Amount ({depositFor.currency})</Label>
                <Input
                  id="deposit-amount"
                  inputMode="decimal"
                  value={depositAmount}
                  onChange={(event) => setDepositAmount(event.target.value)}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDepositFor(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={() =>
                    depositMut.mutate({ account: depositFor, amount: Number(depositAmount) })
                  }
                  disabled={depositMut.isPending || !depositValid}
                >
                  {depositMut.isPending ? "Starting" : "Continue"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}

function AccountCard({
  account,
  deposits,
  expanded,
  onToggle,
  onTrade,
  onDeposit,
  onBalance,
  balanceOpen,
  newBalance,
  onNewBalance,
  onBalanceSubmit,
  balancePending,
}: {
  account: Account;
  deposits: Deposit[];
  expanded: boolean;
  onToggle: () => void;
  onTrade: () => void;
  onDeposit: (() => void) | null;
  onBalance: () => void;
  balanceOpen: boolean;
  newBalance: string;
  onNewBalance: (value: string) => void;
  onBalanceSubmit: (event: FormEvent<HTMLFormElement>) => void;
  balancePending: boolean;
}) {
  const isReal = account.kind === "real";
  const readOnly = account.access_role === "investor";
  const disabled = account.status === "disabled";
  const pendingDeposits = isReal
    ? deposits.filter((deposit) => deposit.accountId === account.id && deposit.status === "pending")
    : [];

  return (
    <article className="rounded-lg border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-base font-bold">{account.nickname}</span>
        <span className="rounded bg-muted px-2 py-0.5 font-medium text-muted-foreground">
          {isReal ? "Real" : "Demo"}
        </span>
        <span className="rounded bg-muted px-2 py-0.5 font-medium text-muted-foreground">
          {account.label}
        </span>
        <span className="font-mono font-semibold">#{account.login}</span>
        {readOnly && (
          <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            Investor
          </span>
        )}
        {disabled && (
          <span className="rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
            Disabled
          </span>
        )}
        <button
          className="ml-auto opacity-60"
          onClick={onToggle}
          aria-label="Toggle details"
          type="button"
        >
          {expanded ? "▴" : "▾"}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="break-words text-2xl font-extrabold tracking-tight sm:text-3xl">
          {formatMoney(Number(account.balance), account.currency)}{" "}
          <span className="text-base font-normal opacity-60">{account.currency}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onTrade} disabled={readOnly || disabled}>
            Trade
          </Button>
          {isReal ? (
            <Button variant="outline" onClick={onDeposit ?? undefined} disabled={disabled}>
              Deposit
            </Button>
          ) : (
            <Button variant="outline" onClick={onBalance} disabled={readOnly || disabled}>
              Set balance
            </Button>
          )}
        </div>
      </div>

      {pendingDeposits.length > 0 && (
        <div className="mt-3 space-y-2">
          {pendingDeposits.map((deposit) => (
            <div
              key={deposit.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-sm"
            >
              <span>
                {formatMoney(deposit.amount, deposit.currency)} ·{" "}
                {depositStatusLabel(deposit.status)}
              </span>
              {deposit.checkoutUrl && (
                <Button asChild size="sm" variant="outline">
                  <a href={deposit.checkoutUrl}>Continue</a>
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {balanceOpen && (
        <form
          className="mt-3 flex flex-col items-stretch gap-2 sm:flex-row sm:items-end"
          onSubmit={onBalanceSubmit}
        >
          <div className="w-full">
            <Label htmlFor={`bal-${account.id}`}>Balance ({account.currency})</Label>
            <Input
              id={`bal-${account.id}`}
              inputMode="decimal"
              value={newBalance}
              onChange={(event) => onNewBalance(event.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary" disabled={balancePending}>
            Apply
          </Button>
        </form>
      )}

      {expanded && (
        <div className="mt-4 border-t pt-4 text-sm">
          <div className="grid gap-3 rounded-md bg-muted p-4 sm:grid-cols-2">
            <p className="flex justify-between">
              <span className="opacity-60">Balance</span>
              <span>{formatMoney(Number(account.balance), account.currency)}</span>
            </p>
            <p className="flex justify-between">
              <span className="opacity-60">Max leverage</span>
              <span>1:{account.leverage}</span>
            </p>
            <p className="flex justify-between">
              <span className="opacity-60">Server</span>
              <span className="font-mono">{account.server}</span>
            </p>
            <p className="flex justify-between">
              <span className="opacity-60">Login</span>
              <span className="font-mono">{account.login}</span>
            </p>
          </div>
        </div>
      )}
    </article>
  );
}
