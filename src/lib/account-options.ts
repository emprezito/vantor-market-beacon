export const CURRENCIES = ["USD", "EUR", "GBP", "NGN"] as const;
export const ACCOUNT_TYPES = ["Standard", "Pro", "Raw Spread"] as const;
export const LEVERAGES = [1, 10, 50, 100, 200, 500, 1000, 2000] as const;

export const DEFAULT_ACCOUNT_TYPE = "Standard";
export const DEFAULT_CURRENCY = "USD";
export const DEFAULT_LEVERAGE = 100;
export const DEFAULT_BALANCE = 10000;
export const BALANCE_MIN = 100;
export const BALANCE_MAX = 1000000;
export const NICKNAME_MAX = 24;
export const ACCOUNT_PASSWORD_MIN = 8;
export const ACCOUNT_PASSWORD_MAX = 64;

export type AccountPasswords = {
  traderPassword: string;
  investorPassword: string;
};

export type NewAccountInput = AccountPasswords & {
  nickname: string;
  accountType: string;
  currency: string;
  leverage: number;
  balance: number;
};

export type TradingServer = {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: string;
  status: string;
  visibility: string;
  account_types: string[];
  currencies: string[];
  leverages: number[];
  min_balance: number;
  max_balance: number;
  default_account_type: string;
  default_currency: string;
  default_leverage: number;
  sort_order: number;
};

export type ServerDefaults = {
  accountType: string;
  currency: string;
  leverage: number;
  balance: number;
};

export const TRADING_SERVER_SELECT =
  "id, slug, name, description, kind, status, visibility, account_types, currencies, leverages, min_balance, max_balance, default_account_type, default_currency, default_leverage, sort_order";

export function normalizeServer(server: TradingServer): TradingServer {
  return {
    ...server,
    account_types: (server.account_types ?? []).map(String),
    currencies: (server.currencies ?? []).map(String),
    leverages: (server.leverages ?? []).map(Number).sort((a, b) => a - b),
    min_balance: Number(server.min_balance),
    max_balance: Number(server.max_balance),
    default_leverage: Number(server.default_leverage),
  };
}

export function validateServerId(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error("Choose a trading server");
  }
  return value;
}

function serverOptions(server: TradingServer) {
  const accountTypes = (server.account_types ?? []).map(String);
  const currencies = (server.currencies ?? []).map(String);
  const leverages = (server.leverages ?? []).map(Number).sort((a, b) => a - b);
  return { accountTypes, currencies, leverages };
}

export function defaultsForServer(server: TradingServer): ServerDefaults {
  const { accountTypes, currencies, leverages } = serverOptions(server);
  const accountType = accountTypes.includes(server.default_account_type)
    ? server.default_account_type
    : (accountTypes[0] ?? DEFAULT_ACCOUNT_TYPE);
  const currency = currencies.includes(server.default_currency)
    ? server.default_currency
    : (currencies[0] ?? DEFAULT_CURRENCY);
  const leverage = leverages.includes(server.default_leverage)
    ? server.default_leverage
    : leverages.includes(DEFAULT_LEVERAGE)
      ? DEFAULT_LEVERAGE
      : (leverages[0] ?? DEFAULT_LEVERAGE);
  const min = Number.isFinite(Number(server.min_balance))
    ? Number(server.min_balance)
    : BALANCE_MIN;
  const max = Number.isFinite(Number(server.max_balance))
    ? Number(server.max_balance)
    : BALANCE_MAX;
  return {
    accountType,
    currency,
    leverage,
    balance: Math.round(Math.min(Math.max(DEFAULT_BALANCE, min), max) * 100) / 100,
  };
}

export function validateNewAccountForServer(i: NewAccountInput, server: TradingServer) {
  const account = validateNewAccount(i);
  const { accountTypes, currencies, leverages } = serverOptions(server);
  if (!accountTypes.includes(account.accountType)) {
    throw new Error(`${server.name} does not offer ${account.accountType} accounts`);
  }
  if (!currencies.includes(account.currency)) {
    throw new Error(`${server.name} does not support ${account.currency} accounts`);
  }
  if (!leverages.includes(account.leverage)) {
    throw new Error(`${server.name} does not support 1:${account.leverage} leverage`);
  }
  const min = Number(server.min_balance);
  const max = Number(server.max_balance);
  if (account.balance < min || account.balance > max) {
    throw new Error(
      `Starting balance on ${server.name} must be between ${min.toLocaleString("en-US")} and ${max.toLocaleString("en-US")}`,
    );
  }
  return account;
}

function validateAccountPassword(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} is required`);
  if (value.length < ACCOUNT_PASSWORD_MIN || value.length > ACCOUNT_PASSWORD_MAX) {
    throw new Error(`${label} must be ${ACCOUNT_PASSWORD_MIN}–${ACCOUNT_PASSWORD_MAX} characters`);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} contains unsupported characters`);
  }
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    throw new Error(`${label} must include at least one letter and one number`);
  }
  return value;
}

export function validateAccountPasswords(i: AccountPasswords) {
  const traderPassword = validateAccountPassword(i.traderPassword, "Trading password");
  const investorPassword = validateAccountPassword(i.investorPassword, "Investor password");
  if (traderPassword === investorPassword) {
    throw new Error("Investor password must be different from the trading password");
  }
  return { traderPassword, investorPassword };
}

export function validateNewAccount(i: NewAccountInput) {
  const nickname = typeof i.nickname === "string" ? i.nickname.trim() : "";
  if (nickname.length < 1 || nickname.length > NICKNAME_MAX)
    throw new Error(`Nickname must be 1–${NICKNAME_MAX} characters`);
  if (!(ACCOUNT_TYPES as readonly string[]).includes(i.accountType))
    throw new Error("Choose a valid account type");
  if (!(CURRENCIES as readonly string[]).includes(i.currency))
    throw new Error("Choose a valid currency");
  const leverage = Number(i.leverage);
  if (!(LEVERAGES as readonly number[]).includes(leverage))
    throw new Error("Choose a valid leverage");
  const balance = Number(i.balance);
  if (
    !Number.isFinite(balance) ||
    balance < BALANCE_MIN ||
    balance > BALANCE_MAX ||
    Math.abs(balance * 100 - Math.round(balance * 100)) > 1e-8
  ) {
    throw new Error(
      `Starting balance must be between ${BALANCE_MIN} and ${BALANCE_MAX.toLocaleString("en-US")} with at most two decimals`,
    );
  }
  const { traderPassword, investorPassword } = validateAccountPasswords(i);
  return {
    nickname,
    accountType: i.accountType,
    currency: i.currency,
    leverage,
    balance,
    traderPassword,
    investorPassword,
  };
}

export function formatMoney(value: number, currency: string = "USD") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}
