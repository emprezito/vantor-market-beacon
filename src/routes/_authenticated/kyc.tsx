import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { FileText, RefreshCw, Trash2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  getKycStatus,
  recordKycDocument,
  removeKycDocument,
  saveKycDetails,
  submitKyc,
} from "@/lib/kyc.functions";
import {
  KYC_BUCKET,
  KYC_MAX_FILE_BYTES,
  KYC_MIME_TYPES,
  isKycLocked,
  kycDetailsComplete,
  kycStatusLabel,
  kycStoragePath,
  validateKycFile,
  type KycDetails,
  type KycDocument,
  type KycDocumentKind,
} from "@/lib/kyc";
import { KycChecklist } from "@/components/kyc-checklist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/kyc")({
  component: KycPage,
  head: () => ({
    meta: [{ title: "Verification — Vantor" }],
  }),
});

const EMPTY_DETAILS: KycDetails = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  phone: "",
  country: "",
  city: "",
  addressLine1: "",
  addressLine2: "",
  postalCode: "",
};

function KycPage() {
  const qc = useQueryClient();
  const statusFn = useServerFn(getKycStatus);
  const saveFn = useServerFn(saveKycDetails);
  const recordFn = useServerFn(recordKycDocument);
  const removeFn = useServerFn(removeKycDocument);
  const submitFn = useServerFn(submitKyc);
  const statusQuery = useQuery({
    queryKey: ["kyc"],
    queryFn: () => statusFn(),
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.data?.profile?.status === "pending" ? 15_000 : false),
  });
  const snapshot = statusQuery.data;
  const profile = snapshot?.profile ?? null;
  const locked = isKycLocked(profile?.status);
  const status = profile?.status ?? null;
  const [draftDetails, setDraftDetails] = useState<KycDetails | null>(null);

  const savedDetails: KycDetails | null = profile
    ? {
        firstName: profile.firstName,
        lastName: profile.lastName,
        dateOfBirth: profile.dateOfBirth,
        phone: profile.phone,
        country: profile.country,
        city: profile.city,
        addressLine1: profile.addressLine1,
        addressLine2: profile.addressLine2,
        postalCode: profile.postalCode,
      }
    : null;

  const details = draftDetails ?? savedDetails ?? EMPTY_DETAILS;
  const setDetails = (updater: (current: KycDetails) => KycDetails) =>
    setDraftDetails((current) => updater(current ?? details));

  const saveMut = useMutation({
    mutationFn: () => saveFn({ data: details }),
    onSuccess: (next) => {
      qc.setQueryData(["kyc"], next);
      toast.success("Details saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const uploadMut = useMutation({
    mutationFn: async ({ kind, file }: { kind: KycDocumentKind; file: File }) => {
      validateKycFile(file);
      const { data } = await supabase.auth.getUser();
      if (!data.user) throw new Error("Sign in again");
      const path = kycStoragePath(data.user.id, kind, file.type);
      const { error } = await supabase.storage
        .from(KYC_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new Error("Could not upload the file");
      try {
        return await recordFn({
          data: {
            kind,
            path,
            fileName: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          },
        });
      } catch (error) {
        await supabase.storage.from(KYC_BUCKET).remove([path]);
        throw error;
      }
    },
    onSuccess: (next) => {
      qc.setQueryData(["kyc"], next);
      toast.success("Document saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeMut = useMutation({
    mutationFn: (kind: KycDocumentKind) => removeFn({ data: { kind } }),
    onSuccess: (next) => {
      qc.setQueryData(["kyc"], next);
      toast.success("Document removed");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const submitMut = useMutation({
    mutationFn: async () => {
      await saveFn({ data: details });
      return submitFn();
    },
    onSuccess: (next) => {
      qc.setQueryData(["kyc"], next);
      toast.success("Verification submitted");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const identity = snapshot?.documents.find((document) => document.kind === "identity") ?? null;
  const address = snapshot?.documents.find((document) => document.kind === "address") ?? null;
  const complete = kycDetailsComplete(details) && !!identity && !!address;
  const busy =
    saveMut.isPending || uploadMut.isPending || removeMut.isPending || submitMut.isPending;

  const chooseFile = (kind: KycDocumentKind) => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) uploadMut.mutate({ kind, file });
  };

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-3 py-4 sm:space-y-6 sm:px-6 sm:py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold tracking-tight sm:text-3xl">Verification</h1>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
              status === "approved"
                ? "bg-positive/10 text-positive"
                : status === "rejected"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {kycStatusLabel(status)}
          </span>
          {status === "pending" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => statusQuery.refetch()}
              disabled={statusQuery.isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${statusQuery.isFetching ? "animate-spin" : ""}`} />
            </Button>
          )}
        </div>
      </div>

      {status === "rejected" && profile?.rejectionReason && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
        >
          {profile.rejectionReason}
        </p>
      )}

      <KycChecklist steps={snapshot?.steps} />

      {statusQuery.isPending ? (
        <p className="py-8 text-sm text-muted-foreground" role="status">
          Loading
        </p>
      ) : (
        <>
          <section className="grid gap-3 lg:grid-cols-3">
            <article className="rounded-lg border bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-muted text-xs font-bold">
                  1
                </span>
                <h2 className="font-bold">Personal details</h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <div>
                  <Label htmlFor="kyc-first">First name</Label>
                  <Input
                    id="kyc-first"
                    value={details.firstName}
                    onChange={(event) =>
                      setDetails((current) => ({ ...current, firstName: event.target.value }))
                    }
                    disabled={locked}
                    autoComplete="given-name"
                    maxLength={60}
                  />
                </div>
                <div>
                  <Label htmlFor="kyc-last">Last name</Label>
                  <Input
                    id="kyc-last"
                    value={details.lastName}
                    onChange={(event) =>
                      setDetails((current) => ({ ...current, lastName: event.target.value }))
                    }
                    disabled={locked}
                    autoComplete="family-name"
                    maxLength={60}
                  />
                </div>
                <div>
                  <Label htmlFor="kyc-dob">Date of birth</Label>
                  <Input
                    id="kyc-dob"
                    type="date"
                    value={details.dateOfBirth}
                    onChange={(event) =>
                      setDetails((current) => ({ ...current, dateOfBirth: event.target.value }))
                    }
                    disabled={locked}
                    autoComplete="bday"
                  />
                </div>
                <div>
                  <Label htmlFor="kyc-phone">Phone</Label>
                  <Input
                    id="kyc-phone"
                    value={details.phone}
                    onChange={(event) =>
                      setDetails((current) => ({ ...current, phone: event.target.value }))
                    }
                    disabled={locked}
                    autoComplete="tel"
                    maxLength={25}
                  />
                </div>
                <div>
                  <Label htmlFor="kyc-country">Country</Label>
                  <Input
                    id="kyc-country"
                    value={details.country}
                    onChange={(event) =>
                      setDetails((current) => ({ ...current, country: event.target.value }))
                    }
                    disabled={locked}
                    autoComplete="country-name"
                    maxLength={56}
                  />
                </div>
                <div>
                  <Label htmlFor="kyc-city">City</Label>
                  <Input
                    id="kyc-city"
                    value={details.city}
                    onChange={(event) =>
                      setDetails((current) => ({ ...current, city: event.target.value }))
                    }
                    disabled={locked}
                    autoComplete="address-level2"
                    maxLength={64}
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-1">
                  <Label htmlFor="kyc-address1">Address</Label>
                  <Input
                    id="kyc-address1"
                    value={details.addressLine1}
                    onChange={(event) =>
                      setDetails((current) => ({ ...current, addressLine1: event.target.value }))
                    }
                    disabled={locked}
                    autoComplete="address-line1"
                    maxLength={120}
                  />
                </div>
                <div>
                  <Label htmlFor="kyc-address2">Address line 2</Label>
                  <Input
                    id="kyc-address2"
                    value={details.addressLine2}
                    onChange={(event) =>
                      setDetails((current) => ({ ...current, addressLine2: event.target.value }))
                    }
                    disabled={locked}
                    autoComplete="address-line2"
                    maxLength={120}
                  />
                </div>
                <div>
                  <Label htmlFor="kyc-postal">Postal code</Label>
                  <Input
                    id="kyc-postal"
                    value={details.postalCode}
                    onChange={(event) =>
                      setDetails((current) => ({ ...current, postalCode: event.target.value }))
                    }
                    disabled={locked}
                    autoComplete="postal-code"
                    maxLength={16}
                  />
                </div>
              </div>
              {!locked && (
                <Button
                  type="button"
                  className="mt-3 w-full"
                  variant="secondary"
                  onClick={() => saveMut.mutate()}
                  disabled={busy}
                >
                  {saveMut.isPending ? "Saving" : "Save details"}
                </Button>
              )}
            </article>

            <DocumentCard
              title="Identity"
              step={2}
              kind="identity"
              document={identity}
              locked={locked}
              busy={busy || uploadMut.isPending || removeMut.isPending}
              onChoose={chooseFile("identity")}
              onRemove={() => removeMut.mutate("identity")}
            />
            <DocumentCard
              title="Address"
              step={3}
              kind="address"
              document={address}
              locked={locked}
              busy={busy || uploadMut.isPending || removeMut.isPending}
              onChoose={chooseFile("address")}
              onRemove={() => removeMut.mutate("address")}
            />
          </section>

          {!locked && (
            <div className="flex justify-end">
              <Button type="button" onClick={() => submitMut.mutate()} disabled={!complete || busy}>
                {submitMut.isPending ? "Submitting" : "Submit for review"}
              </Button>
            </div>
          )}
        </>
      )}
    </main>
  );
}

function DocumentCard({
  title,
  step,
  kind,
  document,
  locked,
  busy,
  onChoose,
  onRemove,
}: {
  title: string;
  step: number;
  kind: KycDocumentKind;
  document: KycDocument | null;
  locked: boolean;
  busy: boolean;
  onChoose: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  return (
    <article className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-muted text-xs font-bold">
          {step}
        </span>
        <h2 className="font-bold">{title}</h2>
      </div>
      {document ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{document.fileName}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {document.url && (
              <Button asChild size="sm" variant="outline">
                <a href={document.url} target="_blank" rel="noreferrer">
                  View
                </a>
              </Button>
            )}
            {!locked && (
              <>
                <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent">
                  <Upload className="h-4 w-4" />
                  Replace
                  <input
                    type="file"
                    className="sr-only"
                    accept={KYC_MIME_TYPES.join(",")}
                    onChange={onChoose}
                    disabled={busy}
                  />
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onRemove}
                  disabled={busy}
                >
                  <Trash2 className="h-4 w-4" />
                  Remove
                </Button>
              </>
            )}
          </div>
        </div>
      ) : (
        <label
          className={`flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed px-3 py-6 text-center text-sm ${
            locked || busy ? "cursor-not-allowed opacity-50" : "hover:bg-muted/50"
          }`}
        >
          <Upload className="h-5 w-5 text-muted-foreground" />
          <span className="font-medium">Upload {kind} document</span>
          <span className="text-xs text-muted-foreground">
            JPG, PNG, WebP or PDF · up to {Math.round(KYC_MAX_FILE_BYTES / (1024 * 1024))} MB
          </span>
          <input
            type="file"
            className="sr-only"
            accept={KYC_MIME_TYPES.join(",")}
            onChange={onChoose}
            disabled={locked || busy}
          />
        </label>
      )}
    </article>
  );
}
