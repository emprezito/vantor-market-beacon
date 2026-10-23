import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { moveFunds } from "@/lib/trading.functions";
import { useAccount } from "@/hooks/use-account";
import { formatMoney } from "@/lib/account-options";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Profile — Vantor" },
      { name: "description", content: "Manage your Vantor profile, accounts and deposits." },
    ],
  }),
  component: ProfilePage,
});

const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

function ProfilePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { accounts, activeAccount, setActiveAccount, data, isPending, error, refetch } = useAccount();
  const move = useServerFn(moveFunds);
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositAccountId, setDepositAccountId] = useState("");
  const [amount, setAmount] = useState("1000");

  const deposit = useMutation({
    mutationFn: async () => {
      const target = accounts.find((a) => a.id === depositAccountId) ?? activeAccount;
      if (!target) throw new Error("Choose a trading account");
      return move({ data: { accountId: target.id, kind: "deposit", amount: Number(amount) } });
    },
    onSuccess: () => {
      const target = accounts.find((a) => a.id === depositAccountId) ?? activeAccount;
      toast.success(target ? `Funds added to ${target.nickname}` : "Funds added");
      qc.invalidateQueries({ queryKey: ["account"] });
      qc.invalidateQueries({ queryKey: ["my-accounts"] });
      setDepositOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isPending) return <main className="px-4 py-6 sm:px-6" role="status">Loading your profile…</main>;
  if (error) return <main className="space-y-4 px-4 py-6 sm:px-6"><p role="alert">{error.message}</p><Button onClick={() => refetch()}>Retry</Button></main>;
  if (!activeAccount) {
    return (
      <main className="space-y-4 px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-bold">Profile</h1>
        <p>Open a trading account to manage your funds and preferences.</p>
        <Button onClick={() => navigate({ to: "/accounts" })}>Open an account</Button>
      </main>
    );
  }

  const currency = activeAccount.currency;
  const balance = Number(data?.balance ?? activeAccount.balance);
  const target = accounts.find((a) => a.id === depositAccountId) ?? activeAccount;
  const parsedAmount = Number(amount);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount >= 1 && parsedAmount <= 1000000;
  const initials = activeAccount.nickname.slice(0, 2).toUpperCase();

  const openDeposit = () => {
    setDepositAccountId(activeAccount.id);
    setAmount("1000");
    setDepositOpen(true);
  };

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-3 pb-6 pt-3 sm:space-y-6 sm:px-6 sm:py-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold sm:text-2xl">Profile</h1>
        <Button onClick={openDeposit}>Deposit</Button>
      </div>

      <section className="rounded-xl border p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
            {initials}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">{activeAccount.nickname}</h2>
            <p className="truncate text-xs text-muted-foreground">#{activeAccount.login} · {activeAccount.server}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Balance", formatMoney(balance, currency)],
            ["Currency", currency],
            ["Leverage", `1:${activeAccount.leverage}`],
            ["Account type", activeAccount.label],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-muted p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs">{label}</div>
              <div className="mt-0.5 break-words text-sm font-semibold">{value}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Your accounts</h2>
          <Link to="/accounts" className="text-xs text-primary underline-offset-2 hover:underline">Manage accounts</Link>
        </div>
        {accounts.map((account) => {
          const active = account.id === activeAccount.id;
          return (
            <button
              key={account.id}
              type="button"
              onClick={() => { setActiveAccount(account.id); toast.success(`Now trading ${account.nickname}`); }}
              aria-pressed={active}
              className={`w-full rounded-lg border p-3 text-left transition ${active ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{account.nickname}</div>
                  <div className="text-xs text-muted-foreground">#{account.login} · {account.currency} · 1:{account.leverage}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-sm font-semibold">{formatMoney(Number(account.balance), account.currency)}</div>
                  {active && <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">Active</span>}
                </div>
              </div>
            </button>
          );
        })}
      </section>

      <Dialog open={depositOpen} onOpenChange={setDepositOpen}>
        <DialogContent className="w-[calc(100%_-_2rem)] rounded-xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Deposit</DialogTitle>
            <DialogDescription>Choose where the funds should go.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-primary bg-primary/5 p-3 text-left">
              <div className="text-sm font-semibold">Demo account</div>
              <div className="text-xs text-muted-foreground">Instant top-up</div>
            </div>
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="cursor-not-allowed rounded-lg border border-dashed p-3 text-left opacity-60"
            >
              <div className="text-sm font-semibold">Real account</div>
              <div className="text-xs text-muted-foreground">Coming soon</div>
            </button>
          </div>

          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Real-money deposits aren't available yet. Funds added here are for practice trading and do not involve real payments.
          </p>

          <div className="space-y-3">
            <div>
              <Label htmlFor="deposit-account">Account</Label>
              <select
                id="deposit-account"
                className={inputCls}
                value={target.id}
                onChange={(e) => setDepositAccountId(e.target.value)}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.nickname} · #{account.login} · {account.currency}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="deposit-amount">Amount ({target.currency})</Label>
              <Input
                id="deposit-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="1000"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Current balance: {formatMoney(Number(target.balance), target.currency)}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDepositOpen(false)}>Cancel</Button>
            <Button onClick={() => deposit.mutate()} disabled={deposit.isPending || !amountValid}>
              {deposit.isPending ? "Adding…" : "Add funds"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
