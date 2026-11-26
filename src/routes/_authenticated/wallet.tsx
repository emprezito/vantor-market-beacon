import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { moveFunds } from "@/lib/trading.functions";
import { createRealDeposit, listRealDeposits } from "@/lib/deposits.functions";
import { useAccount } from "@/hooks/use-account";
import { formatMoney } from "@/lib/account-options";
import { depositStatusLabel, validateDepositAmount } from "@/lib/real-deposits";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/wallet")({
  head: () => ({
    meta: [{ title: "Wallet — Vantor" }],
  }),
  component: Wallet,
});

function Wallet() {
  const { data, activeAccount, isPending, error, refetch } = useAccount();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [amount, setAmount] = useState("1000");
  const moveFn = useServerFn(moveFunds);
  const listDepositsFn = useServerFn(listRealDeposits);
  const createDepositFn = useServerFn(createRealDeposit);
  const isReal = activeAccount?.kind === "real";

  const move = useMutation({
    mutationFn: (kind: "deposit" | "withdraw") => {
      if (!activeAccount) throw new Error("Open a trading account first");
      return moveFn({ data: { accountId: activeAccount.id, kind, amount: Number(amount) } });
    },
    onSuccess: (_result, kind) => {
      toast.success(kind === "deposit" ? "Funds added" : "Withdrawal complete");
      qc.invalidateQueries({ queryKey: ["account"] });
      qc.invalidateQueries({ queryKey: ["my-accounts"] });
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  const depositsQuery = useQuery({
    queryKey: ["real-deposits"],
    queryFn: () => listDepositsFn(),
    enabled: !!isReal,
    refetchInterval: isReal ? 5_000 : false,
  });

  const makeDeposit = useMutation({
    mutationFn: () => {
      if (!activeAccount) throw new Error("Choose a real account");
      return createDepositFn({ data: { accountId: activeAccount.id, amount: Number(amount) } });
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["real-deposits"] });
      window.location.assign(result.checkoutUrl);
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  if (isPending) {
    return (
      <main className="px-4 py-6 sm:px-6" role="status">
        Loading
      </main>
    );
  }
  if (error) {
    return (
      <main className="space-y-4 px-4 py-6 sm:px-6">
        <p role="alert">{error.message}</p>
        <Button onClick={() => refetch()}>Retry</Button>
      </main>
    );
  }
  if (!activeAccount) {
    return (
      <main className="space-y-4 px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-bold">Wallet</h1>
        <Button onClick={() => navigate({ to: "/accounts" })}>Open an account</Button>
      </main>
    );
  }

  const currency = activeAccount.currency;
  const readOnly = activeAccount.access_role === "investor";
  let realDepositValid = false;
  if (isReal) {
    try {
      validateDepositAmount(Number(amount), currency);
      realDepositValid = true;
    } catch {
      realDepositValid = false;
    }
  }
  const pendingDeposits = (depositsQuery.data ?? []).filter(
    (deposit) => deposit.accountId === activeAccount.id && deposit.status === "pending",
  );

  return (
    <main className="mx-auto grid max-w-5xl gap-4 px-4 py-6 sm:gap-6 sm:px-6 lg:grid-cols-[320px_1fr]">
      <section className="space-y-4 rounded-xl bg-muted p-4 sm:p-6">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {activeAccount.nickname} · #{activeAccount.login} · {currency}
            </span>
            <span className="rounded bg-background px-1.5 py-0.5 font-semibold">
              {isReal ? "Real" : "Demo"}
            </span>
          </div>
          <div className="break-words text-2xl font-extrabold sm:text-3xl">
            {formatMoney(data?.balance ?? 0, currency)}
          </div>
        </div>
        <input
          aria-label={`Amount in ${currency}`}
          className="w-full rounded-md border border-input bg-background px-3 py-2"
          type="number"
          min="1"
          max="1000000"
          step="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        {isReal ? (
          <Button
            className="w-full"
            disabled={makeDeposit.isPending || readOnly || !realDepositValid}
            onClick={() => makeDeposit.mutate()}
          >
            {makeDeposit.isPending ? "Starting" : "Deposit"}
          </Button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button disabled={move.isPending || readOnly} onClick={() => move.mutate("deposit")}>
              Deposit
            </Button>
            <Button
              variant="outline"
              disabled={move.isPending || readOnly}
              onClick={() => move.mutate("withdraw")}
            >
              Withdraw
            </Button>
          </div>
        )}
        {pendingDeposits.length > 0 && (
          <div className="space-y-2">
            {pendingDeposits.map((deposit) => (
              <div
                key={deposit.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background px-3 py-2 text-sm"
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
      </section>

      <section className="rounded-xl border">
        <h2 className="border-b px-4 py-3 font-bold">Transactions</h2>
        <div className="divide-y divide-border sm:hidden">
          {(data?.transactions ?? []).length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Empty</p>
          ) : null}
          {(data?.transactions ?? []).map((transaction) => (
            <article
              key={transaction.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="text-sm capitalize text-foreground">
                  {transaction.kind === "bonus" || transaction.kind === "initial"
                    ? "Starting balance"
                    : transaction.kind}
                </div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {new Date(transaction.created_at).toLocaleString()}
                </div>
              </div>
              <div
                className={`shrink-0 font-mono text-sm font-semibold ${
                  transaction.kind === "withdraw" ? "text-negative" : "text-positive"
                }`}
              >
                {transaction.kind === "withdraw" ? "-" : "+"}
                {formatMoney(Number(transaction.amount), currency)}
              </div>
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[420px] text-sm">
            <tbody>
              {(data?.transactions ?? []).length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-muted-foreground">Empty</td>
                </tr>
              )}
              {(data?.transactions ?? []).map((transaction) => (
                <tr key={transaction.id} className="border-t first:border-0">
                  <td className="px-4 py-2">{new Date(transaction.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2 capitalize">
                    {transaction.kind === "bonus" || transaction.kind === "initial"
                      ? "Starting balance"
                      : transaction.kind}
                  </td>
                  <td
                    className={`px-4 py-2 text-right font-semibold ${
                      transaction.kind === "withdraw" ? "text-negative" : "text-positive"
                    }`}
                  >
                    {transaction.kind === "withdraw" ? "-" : "+"}
                    {formatMoney(Number(transaction.amount), currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
