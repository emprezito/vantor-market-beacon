export const CURRENCIES = ["USD", "EUR", "GBP", "NGN"] as const;
export const ACCOUNT_TYPES = ["Standard", "Pro", "Raw Spread"] as const;
export const LEVERAGES = [1, 10, 50, 100, 200, 500, 1000, 2000] as const;

export const DEFAULT_ACCOUNT_TYPE = "Standard";
export const DEFAULT_CURRENCY = "USD";
export const DEFAULT_LEVERAGE = 100;
export const DEFAULT_BALANCE = 10000;
export const BALANCE_MIN = 100;
export const BALANCE_MAX = 1000000;

export type NewAccountInput = {
  accountType: string;
  currency: string;
  leverage: number;
  balance: number;
  password: string;
};

export function validateNewAccount(i: NewAccountInput) {
  if (!(ACCOUNT_TYPES as readonly string[]).includes(i.accountType)) throw new Error("Choose a valid account type");
  if (!(CURRENCIES as readonly string[]).includes(i.currency)) throw new Error("Choose a valid currency");
  const leverage = Number(i.leverage);
  if (!(LEVERAGES as readonly number[]).includes(leverage)) throw new Error("Choose a valid leverage");
  const balance = Number(i.balance);
  if (!Number.isFinite(balance) || balance < BALANCE_MIN || balance > BALANCE_MAX || Math.abs(balance * 100 - Math.round(balance * 100)) > 1e-8) {
    throw new Error(`Starting balance must be between ${BALANCE_MIN} and ${BALANCE_MAX.toLocaleString("en-US")} with at most two decimals`);
  }
  if (typeof i.password !== "string" || i.password.length < 8 || i.password.length > 64) throw new Error("Password must be 8–64 characters");
  return { accountType: i.accountType, currency: i.currency, leverage, balance, password: i.password };
}

export function formatMoney(value: number, currency: string = "USD") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}
