import { describe, expect, it } from "vitest";
import {
  KYC_MAX_FILE_BYTES,
  isKycLocked,
  kycDetailsComplete,
  kycFileExtension,
  kycStatusLabel,
  kycSteps,
  kycStoragePath,
  validateKycDetails,
  validateKycFile,
  type KycDetails,
} from "@/lib/kyc";

function birthDate(yearsAgo: number) {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - yearsAgo);
  return date.toISOString().slice(0, 10);
}

const details: KycDetails = {
  firstName: "Ada",
  lastName: "Lovelace",
  dateOfBirth: birthDate(30),
  phone: "+234 801 234 5678",
  country: "Nigeria",
  city: "Lagos",
  addressLine1: "12 Marina Road",
  addressLine2: "",
  postalCode: "101001",
};

describe("KYC details", () => {
  it("accepts and trims valid details", () => {
    expect(
      validateKycDetails({
        ...details,
        firstName: "  Ada  ",
        lastName: "  Lovelace ",
        addressLine2: "",
        postalCode: "",
      }),
    ).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      addressLine2: "",
      postalCode: "",
    });
  });

  it("requires an adult date of birth", () => {
    expect(validateKycDetails({ ...details, dateOfBirth: birthDate(18) })).toBeTruthy();
    expect(() => validateKycDetails({ ...details, dateOfBirth: birthDate(17) })).toThrow(
      /at least 18/,
    );
    expect(() => validateKycDetails({ ...details, dateOfBirth: "2020-02-31" })).toThrow(/invalid/);
    expect(() => validateKycDetails({ ...details, dateOfBirth: "" })).toThrow(/required/);
  });

  it("rejects missing, oversized or unsupported fields", () => {
    expect(() => validateKycDetails({ ...details, firstName: "" })).toThrow();
    expect(() => validateKycDetails({ ...details, lastName: "x".repeat(61) })).toThrow();
    expect(() => validateKycDetails({ ...details, phone: "123" })).toThrow();
    expect(() => validateKycDetails({ ...details, phone: "abc12345" })).toThrow(/invalid/);
    expect(() => validateKycDetails({ ...details, city: "" })).toThrow();
    expect(() => validateKycDetails({ ...details, addressLine1: "" })).toThrow();
    expect(() => validateKycDetails({ ...details, firstName: "Ada\u0000" })).toThrow(/unsupported/);
  });

  it("detects complete details", () => {
    expect(kycDetailsComplete(details)).toBe(true);
    expect(kycDetailsComplete(null)).toBe(false);
    expect(kycDetailsComplete({ ...details, city: "" })).toBe(false);
  });
});

describe("KYC steps and statuses", () => {
  it("tracks each checklist step independently", () => {
    expect(kycSteps(details, []).map((step) => step.complete)).toEqual([true, false, false]);
    expect(
      kycSteps(details, [{ kind: "identity" }, { kind: "address" }]).map((step) => step.complete),
    ).toEqual([true, true, true]);
    expect(kycSteps({ ...details, firstName: "" }, [])[0]?.complete).toBe(false);
  });

  it("locks submissions while pending or approved", () => {
    expect(isKycLocked("pending")).toBe(true);
    expect(isKycLocked("approved")).toBe(true);
    expect(isKycLocked("draft")).toBe(false);
    expect(isKycLocked("rejected")).toBe(false);
    expect(isKycLocked(null)).toBe(false);
  });

  it("labels statuses", () => {
    expect(kycStatusLabel("draft")).toBe("Not submitted");
    expect(kycStatusLabel(null)).toBe("Not submitted");
    expect(kycStatusLabel("pending")).toBe("In review");
    expect(kycStatusLabel("approved")).toBe("Verified");
    expect(kycStatusLabel("rejected")).toBe("Action required");
  });
});

describe("KYC documents", () => {
  it("accepts supported files up to 10 MB", () => {
    expect(validateKycFile({ type: "image/jpeg", size: 1 })).toBe("image/jpeg");
    expect(validateKycFile({ type: "application/pdf", size: KYC_MAX_FILE_BYTES })).toBe(
      "application/pdf",
    );
  });

  it("rejects unsupported or oversized files", () => {
    expect(() => validateKycFile({ type: "image/gif", size: 10 })).toThrow();
    expect(() => validateKycFile({ type: "application/pdf", size: 0 })).toThrow();
    expect(() =>
      validateKycFile({ type: "application/pdf", size: KYC_MAX_FILE_BYTES + 1 }),
    ).toThrow();
    expect(() => validateKycFile({ type: "image/png", size: NaN })).toThrow();
  });

  it("maps extensions and builds owner-scoped paths", () => {
    expect(kycFileExtension("image/png")).toBe("png");
    expect(kycFileExtension("image/webp")).toBe("webp");
    expect(kycFileExtension("application/pdf")).toBe("pdf");
    expect(kycFileExtension("image/jpeg")).toBe("jpg");
    const userId = "123e4567-e89b-12d3-a456-426614174000";
    expect(kycStoragePath(userId, "identity", "application/pdf")).toMatch(
      new RegExp(`^${userId}/identity/[0-9a-f-]{36}\\.pdf$`),
    );
    expect(kycStoragePath(userId, "address", "image/png")).toMatch(
      new RegExp(`^${userId}/address/[0-9a-f-]{36}\\.png$`),
    );
  });
});
