import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  KYC_DOCUMENT_KINDS,
  KYC_MAX_FILE_BYTES,
  KYC_MIME_TYPES,
  isKycLocked,
  validateKycDetails,
  type KycDetails,
  type KycDocumentKind,
  type KycStatus,
} from "./kyc";

function validateDetailsInput(input: KycDetails): KycDetails {
  return validateKycDetails(input);
}

function documentKind(value: unknown): KycDocumentKind {
  if (!KYC_DOCUMENT_KINDS.includes(value as KycDocumentKind)) {
    throw new Error("Invalid document type");
  }
  return value as KycDocumentKind;
}

function uuid(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error("Invalid user");
  }
  return value;
}

export const getKycStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadKycSnapshot } = await import("@/lib/kyc.server");
    return loadKycSnapshot(supabaseAdmin, context.userId);
  });

export const saveKycDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validateDetailsInput)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadKycProfileRow, loadKycSnapshot } = await import("@/lib/kyc.server");
    const current = await loadKycProfileRow(supabaseAdmin, context.userId);
    if (current && isKycLocked(current.status as KycStatus)) {
      throw new Error("Verification is locked while it is reviewed or approved");
    }
    const fields = {
      status: "draft" as const,
      first_name: data.firstName,
      last_name: data.lastName,
      date_of_birth: data.dateOfBirth,
      phone: data.phone,
      country: data.country,
      city: data.city,
      address_line1: data.addressLine1,
      address_line2: data.addressLine2 || null,
      postal_code: data.postalCode || null,
      updated_at: new Date().toISOString(),
    };
    const { data: updated, error } = await supabaseAdmin
      .from("kyc_profiles")
      .update(fields)
      .eq("user_id", context.userId)
      .in("status", ["draft", "rejected"])
      .select("user_id")
      .maybeSingle();
    if (error) throw new Error("Could not save your details. Please try again.");
    if (!updated) {
      const latest = await loadKycProfileRow(supabaseAdmin, context.userId);
      if (latest && isKycLocked(latest.status as KycStatus)) {
        throw new Error("Verification is locked while it is reviewed or approved");
      }
      const { error: insertError } = await supabaseAdmin
        .from("kyc_profiles")
        .insert({ user_id: context.userId, ...fields });
      if (insertError) throw new Error("Could not save your details. Please try again.");
    }
    return loadKycSnapshot(supabaseAdmin, context.userId);
  });

export const recordKycDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      kind: KycDocumentKind;
      path: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
    }) => {
      const kind = documentKind(input.kind);
      const path = typeof input.path === "string" ? input.path.trim() : "";
      if (
        !/^[0-9a-f-]{36}\/(identity|address)\/[A-Za-z0-9._-]{1,160}$/i.test(path) ||
        path.includes("..") ||
        path.length > 300
      ) {
        throw new Error("Invalid document path");
      }
      const fileName = typeof input.fileName === "string" ? input.fileName.trim() : "";
      if (fileName.length < 1 || fileName.length > 180) throw new Error("Invalid file name");
      const mimeType = typeof input.mimeType === "string" ? input.mimeType : "";
      if (!(KYC_MIME_TYPES as readonly string[]).includes(mimeType)) {
        throw new Error("Upload a JPG, PNG, WebP or PDF file");
      }
      const sizeBytes = Number(input.sizeBytes);
      if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > KYC_MAX_FILE_BYTES) {
        throw new Error("File must be 10 MB or smaller");
      }
      return { kind, path, fileName, mimeType, sizeBytes };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadKycDocuments, loadKycProfileRow, loadKycSnapshot } =
      await import("@/lib/kyc.server");
    const { KYC_BUCKET } = await import("@/lib/kyc");
    const current = await loadKycProfileRow(supabaseAdmin, context.userId);
    if (current && isKycLocked(current.status as KycStatus)) {
      throw new Error("Verification is locked while it is reviewed or approved");
    }

    const expectedPrefix = `${context.userId}/${data.kind}/`;
    if (!data.path.startsWith(expectedPrefix)) throw new Error("Invalid document path");
    const objectName = data.path.slice(expectedPrefix.length);
    if (!objectName || objectName.includes("/")) throw new Error("Invalid document path");

    const { data: objects, error: listError } = await supabaseAdmin.storage
      .from(KYC_BUCKET)
      .list(`${context.userId}/${data.kind}`, { limit: 100 });
    if (listError) throw new Error("Could not verify the uploaded file");
    const object = objects?.find((item) => item.name === objectName);
    if (!object) throw new Error("Uploaded file was not found");

    const metadata = object.metadata as {
      mimetype?: string;
      size?: number;
      contentLength?: number;
    } | null;
    const actualMime = metadata?.mimetype ?? data.mimeType;
    if (!(KYC_MIME_TYPES as readonly string[]).includes(actualMime)) {
      await supabaseAdmin.storage.from(KYC_BUCKET).remove([data.path]);
      throw new Error("Upload a JPG, PNG, WebP or PDF file");
    }
    const actualSize = Number(metadata?.size ?? metadata?.contentLength ?? data.sizeBytes);
    if (!Number.isFinite(actualSize) || actualSize <= 0 || actualSize > KYC_MAX_FILE_BYTES) {
      await supabaseAdmin.storage.from(KYC_BUCKET).remove([data.path]);
      throw new Error("File must be 10 MB or smaller");
    }

    const existing = await loadKycDocuments(supabaseAdmin, context.userId);
    const previous = existing.find((document) => document.kind === data.kind);

    const { error } = await supabaseAdmin.from("kyc_documents").upsert(
      {
        user_id: context.userId,
        kind: data.kind,
        file_path: data.path,
        file_name: data.fileName,
        mime_type: actualMime,
        size_bytes: actualSize,
      },
      { onConflict: "user_id,kind" },
    );
    if (error) {
      await supabaseAdmin.storage.from(KYC_BUCKET).remove([data.path]);
      throw new Error("Could not save the document. Please try again.");
    }
    if (previous && previous.file_path !== data.path) {
      await supabaseAdmin.storage.from(KYC_BUCKET).remove([previous.file_path]);
    }
    return loadKycSnapshot(supabaseAdmin, context.userId);
  });

export const removeKycDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { kind: KycDocumentKind }) => ({ kind: documentKind(input.kind) }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadKycDocuments, loadKycProfileRow, loadKycSnapshot } =
      await import("@/lib/kyc.server");
    const { KYC_BUCKET } = await import("@/lib/kyc");
    const current = await loadKycProfileRow(supabaseAdmin, context.userId);
    if (current && isKycLocked(current.status as KycStatus)) {
      throw new Error("Verification is locked while it is reviewed or approved");
    }
    const documents = await loadKycDocuments(supabaseAdmin, context.userId);
    const document = documents.find((item) => item.kind === data.kind);
    if (!document) return loadKycSnapshot(supabaseAdmin, context.userId);
    const { error } = await supabaseAdmin
      .from("kyc_documents")
      .delete()
      .eq("user_id", context.userId)
      .eq("kind", data.kind);
    if (error) throw new Error("Could not remove the document. Please try again.");
    await supabaseAdmin.storage.from(KYC_BUCKET).remove([document.file_path]);
    return loadKycSnapshot(supabaseAdmin, context.userId);
  });

export const submitKyc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadKycDocuments, loadKycProfileRow, loadKycSnapshot } =
      await import("@/lib/kyc.server");
    const { kycDetailsComplete } = await import("@/lib/kyc");
    const profile = await loadKycProfileRow(supabaseAdmin, context.userId);
    if (!profile) throw new Error("Complete your personal details first");
    const status = profile.status as KycStatus;
    if (status === "approved") return loadKycSnapshot(supabaseAdmin, context.userId);
    if (status === "pending") throw new Error("Verification is already in review");
    const details = {
      firstName: profile.first_name ?? "",
      lastName: profile.last_name ?? "",
      dateOfBirth: profile.date_of_birth ?? "",
      phone: profile.phone ?? "",
      country: profile.country ?? "",
      city: profile.city ?? "",
      addressLine1: profile.address_line1 ?? "",
      addressLine2: profile.address_line2 ?? "",
      postalCode: profile.postal_code ?? "",
    };
    if (!kycDetailsComplete(details)) throw new Error("Complete your personal details first");
    const documents = await loadKycDocuments(supabaseAdmin, context.userId);
    if (!documents.some((document) => document.kind === "identity")) {
      throw new Error("Upload your identity document");
    }
    if (!documents.some((document) => document.kind === "address")) {
      throw new Error("Upload your proof of address");
    }
    const { error } = await supabaseAdmin
      .from("kyc_profiles")
      .update({
        status: "pending",
        submitted_at: new Date().toISOString(),
        reviewed_at: null,
        reviewed_by: null,
        rejection_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", context.userId);
    if (error) throw new Error("Could not submit verification. Please try again.");
    return loadKycSnapshot(supabaseAdmin, context.userId);
  });

export const listKycQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requirePlatformAdmin } = await import("@/lib/app-roles.server");
    await requirePlatformAdmin(supabaseAdmin, context.userId);
    const [{ data: profiles, error }, users] = await Promise.all([
      supabaseAdmin
        .from("kyc_profiles")
        .select(
          "user_id, status, first_name, last_name, country, submitted_at, reviewed_at, rejection_reason",
        )
        .order("submitted_at", { ascending: false, nullsFirst: false })
        .limit(100),
      supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);
    if (error) throw new Error("Could not load verification queue");
    const emails = new Map(
      (users.data?.users ?? []).map((user) => [user.id, user.email ?? null] as const),
    );
    const { data: documents, error: documentError } = await supabaseAdmin
      .from("kyc_documents")
      .select("user_id, kind");
    if (documentError) throw new Error("Could not load verification queue");
    const documentKinds = new Map<string, string[]>();
    for (const document of documents ?? []) {
      const list = documentKinds.get(document.user_id) ?? [];
      list.push(document.kind);
      documentKinds.set(document.user_id, list);
    }
    const rows = (profiles ?? []).map((profile) => ({
      userId: profile.user_id,
      email: emails.get(profile.user_id) ?? null,
      name:
        [profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
        emails.get(profile.user_id) ||
        "Unnamed",
      country: profile.country,
      status: profile.status as KycStatus,
      submittedAt: profile.submitted_at,
      reviewedAt: profile.reviewed_at,
      rejectionReason: profile.rejection_reason,
      documentKinds: documentKinds.get(profile.user_id) ?? [],
    }));
    return rows.sort((left, right) => {
      if (left.status === "pending" && right.status !== "pending") return -1;
      if (right.status === "pending" && left.status !== "pending") return 1;
      return (right.submittedAt ?? "").localeCompare(left.submittedAt ?? "");
    });
  });

export const getKycReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => ({ userId: uuid(input.userId) }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requirePlatformAdmin } = await import("@/lib/app-roles.server");
    const { loadKycSnapshot } = await import("@/lib/kyc.server");
    await requirePlatformAdmin(supabaseAdmin, context.userId);
    const [{ data: user }, snapshot] = await Promise.all([
      supabaseAdmin.auth.admin.getUserById(data.userId),
      loadKycSnapshot(supabaseAdmin, data.userId),
    ]);
    return { ...snapshot, email: user.user?.email ?? null };
  });

export const reviewKyc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; action: "approve" | "reject"; reason?: string }) => {
    if (input.action !== "approve" && input.action !== "reject") {
      throw new Error("Invalid review action");
    }
    const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 500) : undefined;
    if (input.action === "reject" && (!reason || reason.length < 3)) {
      throw new Error("Add a rejection reason");
    }
    return { userId: uuid(input.userId), action: input.action, reason };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requirePlatformAdmin } = await import("@/lib/app-roles.server");
    await requirePlatformAdmin(supabaseAdmin, context.userId);
    const { data: profile, error } = await supabaseAdmin
      .from("kyc_profiles")
      .select("status")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (error) throw new Error("Could not update verification. Please try again.");
    if (!profile) throw new Error("Verification not found");
    if (profile.status !== "pending") throw new Error("Verification is not awaiting review");
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("kyc_profiles")
      .update({
        status: data.action === "approve" ? "approved" : "rejected",
        rejection_reason: data.action === "reject" ? (data.reason ?? null) : null,
        reviewed_at: new Date().toISOString(),
        reviewed_by: context.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", data.userId)
      .eq("status", "pending")
      .select("user_id")
      .maybeSingle();
    if (updateError) throw new Error("Could not update verification. Please try again.");
    if (!updated) throw new Error("Verification is not awaiting review");
    return { ok: true };
  });
