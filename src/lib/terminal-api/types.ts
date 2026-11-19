export type TerminalRole = "trader" | "investor";

export type TerminalTokenClaims = {
  typ: "terminal";
  accountId: string;
  serverId: string;
  role: TerminalRole;
  epoch: number;
  iat: number;
  exp: number;
};

export type TerminalStreamClaims = {
  typ: "terminal-stream";
  accountId: string;
  serverId: string;
  role: TerminalRole;
  epoch: number;
  iat: number;
  exp: number;
};

export type TerminalEnv = {
  TERMINAL_TOKEN_SECRET?: string;
  ALLOWED_ORIGINS?: string;
  ALLOW_DEV_ORIGINS?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

export type CorsContext = {
  origin: string | null;
  headers: Record<string, string>;
};
