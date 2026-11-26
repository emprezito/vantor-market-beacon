import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  KYC_BUCKET,
  kycSteps,
  type KycDocument,
  type KycDocumentKind,
  type KycProfile,
  type KycSnapshot,
  type KycStatus,
} from "./kyc";

type Admin = SupabaseClient<Database>;
type KycProfileRow = Database["public"]["Tables"]["kyc_profiles"]["Row"];
type KycDocumentRow = Database["public"]["Tables"]["kyc_documents"]["Row"];

const SIGNED_URL_TTL_SECONDS = 10 * 60;

function profileFromRow(row: KycProfileRow | null): KycProfile | null {
  if (!row) return null;
  return {
    status: row.status as KycStatus,
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    dateOfBirth: row.date_of_birth ?? "",
    phone: row.phone ?? "",
    country: row.country ?? "",
    city: row.city ?? "",
    addressLine1: row.address_line1 ?? "",
    addressLine2: row.address_line2 ?? "",
    postalCode: row.postal_code ?? "",
    rejectionReason: row.rejection_reason,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
  };
}

function documentKind(value: string): KycDocumentKind {
  return value === "address" ? "address" : "identity";
}

async function signedUrls(admin: Admin, rows: KycDocumentRow[]) {
  if (rows.length === 0) return new Map<string, string>();
  const { data, error } = await admin.storage.from(KYC_BUCKET).createSignedUrls(
    rows.map((row) => row.file_path),
    SIGNED_URL_TTL_SECONDS,
  );
  if (error) return new Map<string, string>();
  return new Map(
    (data ?? []).flatMap((item) =>
      item.signedUrl && item.path ? [[item.path, item.signedUrl] as const] : [],
    ),
  );
}

export async function loadKycProfileRow(
  admin: Admin,
  userId: string,
): Promise<KycProfileRow | null> {
  const { data, error } = await admin
    .from("kyc_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Could not load verification. Please try again.");
  return data;
}

export async function loadKycDocuments(admin: Admin, userId: string): Promise<KycDocumentRow[]> {
  const { data, error } = await admin
    .from("kyc_documents")
    .select("*")
    .eq("user_id", userId)
    .order("created_at");
  if (error) throw new Error("Could not load verification documents. Please try again.");
  return data ?? [];
}

export async function loadKycSnapshot(admin: Admin, userId: string): Promise<KycSnapshot> {
  const [profileRow, documents] = await Promise.all([
    loadKycProfileRow(admin, userId),
    loadKycDocuments(admin, userId),
  ]);
  const urls = await signedUrls(admin, documents);
  const profile = profileFromRow(profileRow);
  const docs: KycDocument[] = documents.map((row) => ({
    kind: documentKind(row.kind),
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at,
    url: urls.get(row.file_path) ?? null,
  }));
  const steps = kycSteps(profile, docs);
  return {
    profile,
    documents: docs,
    steps,
    complete: steps.every((step) => step.complete),
    approved: profile?.status === "approved",
  };
}

export async function isKycApproved(admin: Admin, userId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("kyc_profiles")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Could not load verification. Please try again.");
  return data?.status === "approved";
}

export async function requireKycApproved(admin: Admin, userId: string): Promise<void> {
  if (!(await isKycApproved(admin, userId))) {
    throw new Error("Complete identity verification first");
  }
}
