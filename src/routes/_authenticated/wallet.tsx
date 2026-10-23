import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { moveFunds } from "@/lib/trading.functions";
import { useAccount } from "@/hooks/use-account";
import { formatMoney } from "@/lib/account-options";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/wallet")({
  head: () => ({ meta: [{ title: "Wallet — Vantor" }, { name: "description", content: "Manage your Vantor funds and review transactions." }, { property: "og:title", content: "Wallet — Vantor" }, { property: "og:description", content: "Manage your trading balance." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Wallet,
});

function Wallet() {
  const { data, activeAccount, isPending, error, refetch } = useAccount();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [amount, setAmount] = useState("1000");
  const fn = useServerFn(moveFunds);
  const m = useMutation({
    mutationFn: (kind: "deposit" | "withdraw") => {
      if (!activeAccount) throw new Error("Open a trading account first");
      return fn({ data: { accountId: activeAccount.id, kind, amount: Number(amount) } });
    },
    onSuccess: (_r, kind) => {
      toast.success(kind === "deposit" ? "Funds added" : "Withdrawal complete");
      qc.invalidateQueries({ queryKey: ["account"] });
      qc.invalidateQueries({ queryKey: ["my-accounts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (isPending) return <main className="px-4 py-6 sm:px-6" role="status">Loading your wallet…</main>;
  if (error) return <main className="space-y-4 px-4 py-6 sm:px-6"><p role="alert">{error.message}</p><Button onClick={() => refetch()}>Retry</Button></main>;
  if (!activeAccount) {
    return (
      <main className="space-y-4 px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-bold">Wallet</h1>
        <p>Open a trading account to manage its funds.</p>
        <Button onClick={() => navigate({ to: "/accounts" })}>Open an account</Button>
      </main>
    );
  }
  const currency = activeAccount.currency;
  const readOnly = activeAccount.access_role === "investor";
  return (
    <main className="mx-auto grid max-w-5xl gap-4 px-4 py-6 sm:gap-6 sm:px-6 lg:grid-cols-[320px_1fr]">
      <section className="space-y-4 rounded-xl bg-muted p-4 sm:p-6">
        <div>
          <div className="text-xs text-muted-foreground">Balance · {activeAccount.nickname} · #{activeAccount.login} · {currency}</div>
          <div className="break-words text-2xl font-extrabold sm:text-3xl">{formatMoney(data?.balance ?? 0, currency)}</div>
        </div>
        <input aria-label={`Amount in ${currency}`} className="w-full rounded-md border border-input bg-background px-3 py-2" type="number" min="1" max="1000000" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={m.isPending || readOnly} onClick={() => m.mutate("deposit")}>Deposit</Button>
          <Button variant="outline" disabled={m.isPending || readOnly} onClick={() => m.mutate("withdraw")}>Withdraw</Button>
        </div>
      </section>
      <section className="rounded-xl border">
        <h2 className="border-b px-4 py-3 font-bold">Transactions</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <tbody>
              {(data?.transactions ?? []).length === 0 && <tr><td className="px-4 py-6 text-center text-muted-foreground">No transactions yet</td></tr>}
              {(data?.transactions ?? []).map((t) => (
                <tr key={t.id} className="border-t first:border-0">
                  <td className="px-4 py-2">{new Date(t.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2 capitalize">{t.kind === "bonus" || t.kind === "initial" ? "Starting balance" : t.kind}</td>
                  <td className={`px-4 py-2 text-right font-semibold ${t.kind === "withdraw" ? "text-destructive" : "text-accent"}`}>
                    {t.kind === "withdraw" ? "-" : "+"}{formatMoney(Number(t.amount), currency)}
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
