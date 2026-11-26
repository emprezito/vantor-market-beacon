import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { getKycReview, listKycQueue, reviewKyc } from "@/lib/kyc.functions";
import { kycStatusLabel, type KycStatus } from "@/lib/kyc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/admin/kyc")({
  component: KycReviewPage,
  head: () => ({
    meta: [{ title: "Verification review — Vantor" }],
  }),
});

function statusClass(status: KycStatus) {
  if (status === "approved") return "bg-positive/10 text-positive";
  if (status === "rejected") return "bg-destructive/10 text-destructive";
  if (status === "pending") return "bg-primary/10 text-primary";
  return "bg-muted text-muted-foreground";
}

function KycReviewPage() {
  const qc = useQueryClient();
  const queueFn = useServerFn(listKycQueue);
  const reviewFn = useServerFn(getKycReview);
  const decideFn = useServerFn(reviewKyc);
  const queueQuery = useQuery({ queryKey: ["kyc-queue"], queryFn: () => queueFn() });
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!selected && queueQuery.data?.length) setSelected(queueQuery.data[0]!.userId);
  }, [queueQuery.data, selected]);

  const reviewQuery = useQuery({
    queryKey: ["kyc-review", selected],
    queryFn: () => reviewFn({ data: { userId: selected! } }),
    enabled: !!selected,
  });

  const decideMut = useMutation({
    mutationFn: (action: "approve" | "reject") =>
      decideFn({ data: { userId: selected!, action, reason: action === "reject" ? reason : "" } }),
    onSuccess: (_result, action) => {
      toast.success(action === "approve" ? "Verification approved" : "Verification rejected");
      setReason("");
      qc.invalidateQueries({ queryKey: ["kyc-queue"] });
      qc.invalidateQueries({ queryKey: ["kyc-review", selected] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rows = queueQuery.data ?? [];
  const pending = rows.filter((row) => row.status === "pending").length;
  const review = reviewQuery.data ?? null;
  const profile = review?.profile ?? null;

  return (
    <main className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold tracking-tight sm:text-3xl">Verification</h1>
        <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-semibold">
          {pending} pending
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <section className="rounded-lg border bg-card">
          <div className="border-b px-3 py-2 text-sm font-bold">Queue</div>
          <div className="max-h-[70vh] divide-y overflow-y-auto">
            {queueQuery.isPending && (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground" role="status">
                Loading
              </p>
            )}
            {!queueQuery.isPending && rows.length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">Empty</p>
            )}
            {rows.map((row) => {
              const active = row.userId === selected;
              return (
                <button
                  key={row.userId}
                  type="button"
                  onClick={() => {
                    setSelected(row.userId);
                    setReason("");
                  }}
                  aria-pressed={active}
                  className={`w-full px-3 py-3 text-left transition ${
                    active ? "bg-primary/5" : "hover:bg-muted/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold">{row.name}</span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusClass(
                        row.status,
                      )}`}
                    >
                      {kycStatusLabel(row.status)}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {row.email ?? row.userId}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-4">
          {!selected && (
            <p className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground">
              Select a verification
            </p>
          )}
          {selected && reviewQuery.isPending && (
            <p
              className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground"
              role="status"
            >
              Loading
            </p>
          )}
          {review && (
            <>
              <div className="rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold">{review.email ?? selected}</h2>
                    <p className="text-xs text-muted-foreground">{selected}</p>
                  </div>
                  {profile && (
                    <span
                      className={`rounded px-2 py-1 text-xs font-semibold ${statusClass(profile.status)}`}
                    >
                      {kycStatusLabel(profile.status)}
                    </span>
                  )}
                </div>
                {profile && (
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <Field label="Name" value={`${profile.firstName} ${profile.lastName}`.trim()} />
                    <Field label="Date of birth" value={profile.dateOfBirth} />
                    <Field label="Phone" value={profile.phone} />
                    <Field label="Country" value={profile.country} />
                    <Field label="City" value={profile.city} />
                    <Field
                      label="Address"
                      value={[profile.addressLine1, profile.addressLine2, profile.postalCode]
                        .filter(Boolean)
                        .join(", ")}
                    />
                    <Field
                      label="Submitted"
                      value={
                        profile.submittedAt ? new Date(profile.submittedAt).toLocaleString() : "—"
                      }
                    />
                    <Field
                      label="Reviewed"
                      value={
                        profile.reviewedAt ? new Date(profile.reviewedAt).toLocaleString() : "—"
                      }
                    />
                  </dl>
                )}
                {profile?.rejectionReason && (
                  <p className="mt-3 rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {profile.rejectionReason}
                  </p>
                )}
              </div>

              <div className="rounded-lg border bg-card p-4">
                <h3 className="mb-3 font-bold">Documents</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {review.documents.map((document) => (
                    <div key={document.kind} className="rounded-md border p-3">
                      <div className="flex items-center gap-2 text-sm font-semibold capitalize">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        {document.kind}
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {document.fileName}
                      </p>
                      {document.url ? (
                        <Button asChild size="sm" variant="outline" className="mt-2">
                          <a href={document.url} target="_blank" rel="noreferrer">
                            View
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  ))}
                  {review.documents.length === 0 && (
                    <p className="text-sm text-muted-foreground">No documents</p>
                  )}
                </div>
              </div>

              {profile?.status === "pending" && (
                <div className="rounded-lg border bg-card p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="flex-1">
                      <Input
                        aria-label="Rejection reason"
                        placeholder="Rejection reason"
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        maxLength={500}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => decideMut.mutate("reject")}
                        disabled={decideMut.isPending || reason.trim().length < 3}
                      >
                        Reject
                      </Button>
                      <Button
                        type="button"
                        onClick={() => decideMut.mutate("approve")}
                        disabled={decideMut.isPending}
                      >
                        Approve
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words font-medium">{value || "—"}</dd>
    </div>
  );
}
