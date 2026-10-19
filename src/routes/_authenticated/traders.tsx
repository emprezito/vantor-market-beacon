import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createTraderAccount, deleteTraderAccount, listTraderAccounts } from "@/lib/traders.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/traders")({
  component: TradersPage,
  head: () => ({
    meta: [
      { title: "Trader Accounts — Vantor" },
      { name: "description", content: "Create and manage demo trading accounts for your traders." },
    ],
  }),
});

function TradersPage() {
  const qc = useQueryClient();
  const list = useServerFn(listTraderAccounts);
  const create = useServerFn(createTraderAccount);
  const remove = useServerFn(deleteTraderAccount);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["trader-accounts"],
    queryFn: () => list(),
    refetchInterval: 10000,
  });
  const [label, setLabel] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  const createMut = useMutation({
    mutationFn: () => create({ data: { label, email, password } }),
    onSuccess: (r) => {
      setCreated({ email: r.email, password });
      setLabel(""); setEmail(""); setPassword("");
      qc.invalidateQueries({ queryKey: ["trader-accounts"] });
      toast.success("Trader account created");
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trader-accounts"] });
      toast.success("Account removed");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-extrabold tracking-tight">Trader accounts</h1>
      <p className="mt-1 text-sm opacity-75">
        Create demo accounts for your traders. Share the email and password with them — they sign in at the usual sign-in page and trade with virtual money.
      </p>

      <section className="mt-6 rounded-lg border bg-card p-5">
        <h2 className="font-bold">New trader account</h2>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-3"
          onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }}
        >
          <div>
            <Label htmlFor="label">Account name</Label>
            <Input id="label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Trader — Anna" />
          </div>
          <div>
            <Label htmlFor="email">Trader email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="trader@example.com" />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 8 characters" />
          </div>
          <div className="sm:col-span-3">
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? "Creating…" : "Create account"}
            </Button>
          </div>
        </form>
        {created && (
          <div className="mt-4 rounded-md border border-primary/40 bg-primary/10 p-4 text-sm">
            <p className="font-semibold">Share these credentials with your trader (shown once):</p>
            <p className="mt-1">Email: <code className="font-mono">{created.email}</code></p>
            <p>Password: <code className="font-mono">{created.password}</code></p>
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-bold">Your traders</h2>
        {isLoading && <p className="mt-4 text-sm opacity-75">Loading…</p>}
        {isError && (
          <div className="mt-4 text-sm">
            <p className="text-destructive">Could not load accounts.</p>
            <Button variant="outline" className="mt-2" onClick={() => refetch()}>Retry</Button>
          </div>
        )}
        {data && data.length === 0 && <p className="mt-4 text-sm opacity-75">No trader accounts yet.</p>}
        {data && data.length > 0 && (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b text-left opacity-75">
                <th className="py-2 pr-4">Account</th>
                <th className="py-2 pr-4">Balance</th>
                <th className="py-2 pr-4">Open positions</th>
                <th className="py-2 pr-4">Created</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id} className="border-b">
                  <td className="py-2 pr-4 font-medium">{t.label}</td>
                  <td className="py-2 pr-4">{t.balance == null ? "—" : `$${t.balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}</td>
                  <td className="py-2 pr-4">{t.openPositions}</td>
                  <td className="py-2 pr-4 opacity-75">{new Date(t.createdAt).toLocaleDateString()}</td>
                  <td className="py-2 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={deleteMut.isPending}
                      onClick={() => { if (confirm(`Remove "${t.label}"? Their sign-in and data will be deleted.`)) deleteMut.mutate(t.id); }}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
