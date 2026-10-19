import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { moveFunds } from "@/lib/trading.functions";
import { useAccount } from "@/hooks/use-account";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/wallet")({
  head: () => ({ meta: [{ title: "Wallet — Vantor" }, { name: "description", content: "Manage virtual Vantor funds and review demo transactions." }, { property: "og:title", content: "Wallet — Vantor" }, { property: "og:description", content: "Manage your virtual trading balance." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Wallet,
});

function Wallet() {
  const { data, isPending, error, refetch } = useAccount();
  const qc = useQueryClient();
  const [amount, setAmount] = useState("1000");
  const fn = useServerFn(moveFunds);
  const m = useMutation({
    mutationFn: (kind: "deposit" | "withdraw") => fn({ data: { kind, amount: Number(amount) } }),
    onSuccess: (_r, kind) => { toast.success(kind === "deposit" ? "Funds added" : "Withdrawal complete"); qc.invalidateQueries({ queryKey: ["account"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (isPending) return <main className="p-6" role="status">Loading your wallet…</main>;
  if (error) return <main className="space-y-4 p-6"><p role="alert">{error.message}</p><Button onClick={() => refetch()}>Retry</Button></main>;
  return (
    <main className="mx-auto grid max-w-5xl gap-6 px-6 py-6 md:grid-cols-[320px_1fr]">
      <section className="space-y-4 rounded-xl bg-muted p-6">
        <div>
          <div className="text-xs text-muted-foreground">Balance</div>
          <div className="text-3xl font-extrabold">${(data?.balance ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
        </div>
        <input aria-label="Amount in USD" className="w-full rounded-md border border-input bg-background px-3 py-2" type="number" min="1" max="1000000" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={m.isPending} onClick={() => m.mutate("deposit")}>Deposit</Button>
          <Button variant="outline" disabled={m.isPending} onClick={() => m.mutate("withdraw")}>Withdraw</Button>
        </div>
        <p className="text-xs text-muted-foreground">Demo money only — no real payments.</p>
      </section>
      <section className="rounded-xl border">
        <h2 className="border-b px-4 py-3 font-bold">Transactions</h2>
        <table className="w-full text-sm">
          <tbody>
            {(data?.transactions ?? []).map((t) => (
              <tr key={t.id} className="border-t first:border-0">
                <td className="px-4 py-2">{new Date(t.created_at).toLocaleString()}</td>
                <td className="px-4 py-2 capitalize">{t.kind === "bonus" ? "Starting balance" : t.kind}</td>
                <td className={`px-4 py-2 text-right font-semibold ${t.kind === "withdraw" ? "text-destructive" : "text-accent"}`}>
                  {t.kind === "withdraw" ? "-" : "+"}${Number(t.amount).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
