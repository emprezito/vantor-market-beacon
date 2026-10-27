export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers: Record<string, string>;

  constructor(status: number, code: string, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export function mapError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const message = error instanceof Error ? error.message : "Something went wrong";
  if (message.startsWith("Could not") || message.includes("fetch failed")) {
    return new ApiError(503, "service_unavailable", message);
  }
  if (message === "Trading account not found") {
    return new ApiError(404, "account_not_found", message);
  }
  return new ApiError(400, "invalid_request", message);
}
