export const REAL_DEPOSIT_CURRENCIES = ["USD", "NGN"] as const;

export const DEPOSIT_MAX = 1_000_000;

export type DepositStatus = "pending" | "succeeded" | "failed" | "expired";

export type DepositIntentView = {
  id: string;
  accountId: string;
  amount: number;
  currency: string;
  status: DepositStatus;
  checkoutUrl: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
};

export function supportsRealDeposits(currency: string): boolean {
  return (REAL_DEPOSIT_CURRENCIES as readonly string[]).includes(currency);
}

export function depositMinimum(currency: string): number {
  return currency === "NGN" ? 100 : 1;
}

export function validateDepositAmount(amount: number, currency: string): number {
  if (!supportsRealDeposits(currency)) throw new Error("Deposits are available in USD and NGN");
  const min = depositMinimum(currency);
  if (
    !Number.isFinite(amount) ||
    amount < min ||
    amount > DEPOSIT_MAX ||
    Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-8
  ) {
    throw new Error(
      `Amount must be between ${min.toLocaleString("en-US")} and ${DEPOSIT_MAX.toLocaleString("en-US")} ${currency}`,
    );
  }
  return amount;
}

export function depositStatusLabel(status: DepositStatus): string {
  if (status === "succeeded") return "Paid";
  if (status === "failed") return "Failed";
  if (status === "expired") return "Expired";
  return "Pending";
}
