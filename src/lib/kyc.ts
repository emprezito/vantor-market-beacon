export const KYC_STATUSES = ["draft", "pending", "approved", "rejected"] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export const KYC_DOCUMENT_KINDS = ["identity", "address"] as const;
export type KycDocumentKind = (typeof KYC_DOCUMENT_KINDS)[number];

export const KYC_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const KYC_BUCKET = "kyc-documents";
export const KYC_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

export function kycFileExtension(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "application/pdf") return "pdf";
  return "jpg";
}

export function kycStoragePath(userId: string, kind: KycDocumentKind, mimeType: string): string {
  return `${userId}/${kind}/${crypto.randomUUID()}.${kycFileExtension(mimeType)}`;
}

export const KYC_STEPS: { key: "details" | KycDocumentKind; label: string }[] = [
  { key: "details", label: "Personal details" },
  { key: "identity", label: "Identity" },
  { key: "address", label: "Address" },
];

export type KycDetails = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string;
  country: string;
  city: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
};

export type KycProfile = KycDetails & {
  status: KycStatus;
  rejectionReason: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
};

export type KycDocument = {
  kind: KycDocumentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  url: string | null;
};

export type KycStep = {
  key: (typeof KYC_STEPS)[number]["key"];
  label: string;
  complete: boolean;
};

export type KycSnapshot = {
  profile: KycProfile | null;
  documents: KycDocument[];
  steps: KycStep[];
  complete: boolean;
  approved: boolean;
};

const NAME_RE = /^[\p{L}\p{M} .'-]+$/u;
const PHONE_RE = /^[+()\d .-]+$/;

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function text(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== "string") throw new Error(`${label} is required`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new Error(`${label} must be ${min}–${max} characters`);
  }
  if (hasControlCharacters(trimmed)) {
    throw new Error(`${label} contains unsupported characters`);
  }
  return trimmed;
}

function optionalText(value: unknown, label: string, max: number) {
  if (value == null || value === "") return "";
  return text(value, label, 0, max);
}

function isoDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Date of birth is required");
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Date of birth is invalid");
  }
  const now = new Date();
  let age = now.getUTCFullYear() - date.getUTCFullYear();
  const month = now.getUTCMonth() - date.getUTCMonth();
  if (month < 0 || (month === 0 && now.getUTCDate() < date.getUTCDate())) age -= 1;
  if (age < 18) throw new Error("You must be at least 18");
  if (age > 120) throw new Error("Date of birth is invalid");
  return value;
}

export function validateKycDetails(input: KycDetails): KycDetails {
  const firstName = text(input.firstName, "First name", 1, 60);
  if (!NAME_RE.test(firstName)) throw new Error("First name is invalid");
  const lastName = text(input.lastName, "Last name", 1, 60);
  if (!NAME_RE.test(lastName)) throw new Error("Last name is invalid");
  const dateOfBirth = isoDate(input.dateOfBirth);
  const phone = text(input.phone, "Phone number", 7, 25);
  if (!PHONE_RE.test(phone)) throw new Error("Phone number is invalid");
  const country = text(input.country, "Country", 2, 56);
  const city = text(input.city, "City", 1, 64);
  const addressLine1 = text(input.addressLine1, "Address", 3, 120);
  const addressLine2 = optionalText(input.addressLine2, "Address line 2", 120);
  const postalCode = optionalText(input.postalCode, "Postal code", 16);
  return {
    firstName,
    lastName,
    dateOfBirth,
    phone,
    country,
    city,
    addressLine1,
    addressLine2,
    postalCode,
  };
}

export function kycDetailsComplete(details: Partial<KycDetails> | null | undefined): boolean {
  if (!details) return false;
  try {
    validateKycDetails(details as KycDetails);
    return true;
  } catch {
    return false;
  }
}

export function kycSteps(
  profile:
    | Pick<
        KycDetails,
        "firstName" | "lastName" | "dateOfBirth" | "phone" | "country" | "city" | "addressLine1"
      >
    | null
    | undefined,
  documents: { kind: KycDocumentKind }[],
): KycSnapshot["steps"] {
  const detailsComplete = kycDetailsComplete(profile ? ({ ...profile } as KycDetails) : null);
  return KYC_STEPS.map((step) => ({
    ...step,
    complete:
      step.key === "details"
        ? detailsComplete
        : documents.some((document) => document.kind === step.key),
  }));
}

export function isKycLocked(status: KycStatus | null | undefined): boolean {
  return status === "pending" || status === "approved";
}

export function kycStatusLabel(status: KycStatus | null | undefined): string {
  if (status === "pending") return "In review";
  if (status === "approved") return "Verified";
  if (status === "rejected") return "Action required";
  return "Not submitted";
}

export function validateKycFile(file: { type: string; size: number }): string {
  if (!(KYC_MIME_TYPES as readonly string[]).includes(file.type)) {
    throw new Error("Upload a JPG, PNG, WebP or PDF file");
  }
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > KYC_MAX_FILE_BYTES) {
    throw new Error("File must be 10 MB or smaller");
  }
  return file.type;
}
