import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getKycStatus } from "@/lib/kyc.functions";
import { kycStatusLabel } from "@/lib/kyc";
import { useAccount } from "@/hooks/use-account";
import { formatMoney } from "@/lib/account-options";
import { KycChecklist } from "@/components/kyc-checklist";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [{ title: "Profile — Vantor" }],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const navigate = useNavigate();
  const { accounts, activeAccount, setActiveAccount, data, isPending, error, refetch } =
    useAccount();
  const kycStatusFn = useServerFn(getKycStatus);
  const kycQuery = useQuery({
    queryKey: ["kyc"],
    queryFn: () => kycStatusFn(),
    refetchOnWindowFocus: true,
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
        <h1 className="text-2xl font-bold">Profile</h1>
        <Button onClick={() => navigate({ to: "/accounts" })}>Open an account</Button>
      </main>
    );
  }

  const currency = activeAccount.currency;
  const balance = Number(data?.balance ?? activeAccount.balance);
  const initials = activeAccount.nickname.slice(0, 2).toUpperCase();
  const kyc = kycQuery.data;

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-3 pb-6 pt-3 sm:space-y-6 sm:px-6 sm:py-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold sm:text-2xl">Profile</h1>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/wallet">Wallet</Link>
          </Button>
          <Button asChild>
            <Link to="/kyc">Verification</Link>
          </Button>
        </div>
      </div>

      <section className="rounded-xl border p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
            {initials}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-bold">{activeAccount.nickname}</h2>
              <span className="rounded bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                {activeAccount.kind === "real" ? "Real" : "Demo"}
              </span>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              #{activeAccount.login} · {activeAccount.server}
            </p>
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
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs">
                {label}
              </div>
              <div className="mt-0.5 break-words text-sm font-semibold">{value}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold">Verification</h2>
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
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Your accounts</h2>
          <Link to="/accounts" className="text-xs text-primary underline-offset-2 hover:underline">
            Manage accounts
          </Link>
        </div>
        {accounts.map((account) => {
          const active = account.id === activeAccount.id;
          return (
            <button
              key={account.id}
              type="button"
              onClick={() => {
                setActiveAccount(account.id);
                toast.success(`Now trading ${account.nickname}`);
              }}
              aria-pressed={active}
              className={`w-full rounded-lg border p-3 text-left transition ${
                active ? "border-primary bg-primary/5" : "hover:bg-muted"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{account.nickname}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      {account.kind === "real" ? "Real" : "Demo"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    #{account.login} · {account.currency} · 1:{account.leverage}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-sm font-semibold">
                    {formatMoney(Number(account.balance), account.currency)}
                  </div>
                  {active && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                      Active
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </section>
    </main>
  );
}
