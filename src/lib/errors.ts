/**
 * Errors that are meant to be read by a person.
 *
 * Every message that reaches a writer is written for a writer: it says what happened,
 * never what the code expected, and it never contains a stack, a column name or a
 * Postgres error code. Operator-facing detail travels in `log` fields instead, which
 * `src/lib/logger.ts` redacts and writes server-side.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Anything that should be logged but never sent to the client. */
  readonly log?: Record<string, unknown>;

  constructor(status: number, message: string, code = "error", log?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.log = log;
  }
}

export const badRequest = (message: string, log?: Record<string, unknown>) =>
  new ApiError(400, message, "bad_request", log);
export const unauthorized = (message: string, log?: Record<string, unknown>) =>
  new ApiError(401, message, "unauthorized", log);
export const forbidden = (message: string, log?: Record<string, unknown>) =>
  new ApiError(403, message, "forbidden", log);
export const notFound = (message: string, log?: Record<string, unknown>) =>
  new ApiError(404, message, "not_found", log);
export const tooLarge = (message: string, log?: Record<string, unknown>) =>
  new ApiError(413, message, "too_large", log);
export const unsupportedMedia = (message: string, log?: Record<string, unknown>) =>
  new ApiError(415, message, "unsupported_media", log);
export const unprocessable = (message: string, log?: Record<string, unknown>) =>
  new ApiError(422, message, "unprocessable", log);
export const tooManyRequests = (message: string, retryAfterSeconds: number, log?: Record<string, unknown>) =>
  new ApiError(429, message, "rate_limited", { ...log, retryAfterSeconds });
export const unavailable = (message: string, log?: Record<string, unknown>) =>
  new ApiError(503, message, "unavailable", log);

/** Postgres error codes worth translating, because each has a different fix. */
export function isDatabaseUnavailable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    code === "57P03" || // cannot_connect_now
    code === "53300" || // too_many_connections
    code === "08006" || // connection_failure
    code === "08001" // sqlclient_unable_to_establish_sqlconnection
  );
}
