import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { closeTrade, cancelPendingOrder } from "@/lib/trading.functions";
import { useNow } from "@/hooks/use-session";
import { useAccount } from "@/hooks/use-account";
import { Button } from "@/components/ui/button";
import { OpenPositionsSection, PendingOrdersSection } from "@/components/trading-tables";

export const Route = createFileRoute("/_authenticated/orders")({
  head: () => ({
    meta: [
      { title: "Orders — Vantor" },
      { name: "description", content: "Your open positions and pending limit orders." },
    ],
  }),
  component: OrdersPage,
});

function OrdersPage() {
  const now = useNow(1000);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: acc, activeAccount, isPending, error, refetch } = useAccount();
  const close = useServerFn(closeTrade);
  const cancel = useServerFn(cancelPendingOrder);

  const closeMut = useMutation({
    mutationFn: (id: string) => {
      if (!activeAccount) throw new Error("Open a trading account first");
      return close({ data: { accountId: activeAccount.id, id } });
    },
    onSuccess: () => {
      toast.success("Position closed");
      qc.invalidateQueries({ queryKey: ["account"] });
      qc.invalidateQueries({ queryKey: ["my-accounts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancelMut = useMutation({
    mutationFn: (id: string) => {
      if (!activeAccount) throw new Error("Open a trading account first");
      return cancel({ data: { accountId: activeAccount.id, id } });
    },
    onSuccess: () => {
      toast.success("Pending order cancelled");
      qc.invalidateQueries({ queryKey: ["account"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isPending) return <main className="px-4 py-6 sm:px-6" role="status">Loading orders…</main>;
  if (error) return <main className="space-y-4 px-4 py-6 sm:px-6"><p role="alert">{error.message}</p><Button onClick={() => refetch()}>Retry</Button></main>;
  if (!activeAccount) {
    return (
      <main className="space-y-4 px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-bold">Orders</h1>
        <p>Open a trading account to see your orders.</p>
        <Button onClick={() => navigate({ to: "/accounts" })}>Open an account</Button>
      </main>
    );
  }

  const positions = acc?.open ?? [];
  const pending = acc?.pending ?? [];
  const readOnly = activeAccount.access_role === "investor";

  return (
    <main className="mx-auto max-w-7xl space-y-3 px-3 pb-6 pt-3 sm:space-y-6 sm:px-6 sm:py-6">
      <div>
        <h1 className="text-lg font-bold sm:text-2xl">Orders</h1>
        <p className="text-xs text-muted-foreground sm:text-sm">{activeAccount.nickname} · #{activeAccount.login}</p>
      </div>
      {readOnly && <p className="rounded-md bg-muted px-4 py-2 text-sm text-muted-foreground">Investor access — this account is read-only.</p>}
      <OpenPositionsSection
        positions={positions}
        currency={activeAccount.currency}
        now={now}
        readOnly={readOnly}
        busy={closeMut.isPending}
        onClose={(id) => closeMut.mutate(id)}
      />
      <PendingOrdersSection
        orders={pending}
        readOnly={readOnly}
        busy={cancelMut.isPending}
        onCancel={(id) => cancelMut.mutate(id)}
      />
    </main>
  );
}
