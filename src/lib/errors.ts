/**
 * Errors that are meant to be read by a person.
 *
 * Every message that reaches a writer is written for a writer: it says what happened,
 * never what the code expected, and it never contains a stack, a column name or a
 * Postgres error code. Operator-facing detail travels in `log` fields instead, which
 * `src/lib/logger.ts` redacts and writes server-side.
 *
 * The second half of this file is the mirror image: turning a thrown *thing* into something an
 * operator can read. JavaScript lets anything be thrown, and the runtimes this code runs in
 * throw objects that are not `Error`s at all — most importantly the browser-style `ErrorEvent`
 * that `@neondatabase/serverless` raises when it cannot establish a WebSocket. It carries a
 * perfectly good message (`"Received network error or non-101 status code."`) and is not an
 * `instanceof Error`, so the reflexive `error instanceof Error ? error.message : String(error)`
 * prints `[object ErrorEvent]` and discards the diagnosis — exactly when somebody is deploying
 * with a connection string they are not yet sure about.
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

/**
 * Postgres error codes worth translating, because each has a different fix.
 *
 * The codes are only half of it. A driver failure often arrives with no code at all: the Neon
 * driver raises an `ErrorEvent` whose only properties are a message and a type. Reading `.code`
 * alone would classify that as an ordinary query error and answer the writer with a 500 — "we
 * broke" — when the truth is 503, "the database is unreachable, try again in a moment". So a
 * transport-shaped failure counts too.
 */
const UNAVAILABLE_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ECONNRESET",
  "53300", // too_many_connections
  "57P03", // cannot_connect_now
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08006", // connection_failure
]);

export function isDatabaseUnavailable(error: unknown): boolean {
  const code = codeOf(error);
  if (code && UNAVAILABLE_CODES.has(code)) return true;

  const name = nameOf(error);
  if (name === "ErrorEvent" || name === "TimeoutError") return true;

  const message = messageOf(error)?.toLowerCase() ?? "";
  return (
    message.includes("network error") ||
    message.includes("failed to fetch") ||
    message.includes("socket hang up") ||
    message.includes("connection terminated") ||
    message.includes("connection refused") ||
    message.includes("getaddrinfo") ||
    message.includes("timed out")
  );
}

// ── Reading a failure ───────────────────────────────────────────────────────────────────────

interface ErrorLike {
  message?: unknown;
  code?: unknown;
  detail?: unknown;
  name?: unknown;
  error?: unknown;
  cause?: unknown;
  type?: unknown;
}

/**
 * Wrapper messages that say nothing a reader can act on.
 *
 * ORMs and HTTP clients wrap the real failure in a template: Drizzle answers `Failed query:
 * select 1`, which is true of every query that has ever failed and therefore describes none of
 * them. When the outer message matches one of these and a cause exists, the cause is the one
 * worth reading.
 */
const GENERIC_WRAPPER = /^(failed query|query failed|error|request failed|fetch failed|unable to (?:execute|run|perform) [\w ]+)\b/i;

function messageOf(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || value === null || value === undefined) return undefined;
  if (typeof value === "string") return value.trim() || undefined;

  if (value instanceof Error) {
    const own = value.message?.trim() || undefined;
    const cause = messageOf((value as { cause?: unknown }).cause, depth + 1);
    if (own && cause && GENERIC_WRAPPER.test(own)) return cause;
    return own ?? cause;
  }

  if (typeof value === "object") {
    const candidate = value as ErrorLike;
    const found =
      messageOf(candidate.message, depth + 1) ??
      messageOf(candidate.error, depth + 1) ??
      messageOf(candidate.cause, depth + 1);
    if (found) return found;
    // Nothing readable anywhere: a `type` still beats `[object Object]`.
    if (typeof candidate.type === "string") return `transport error (${candidate.type})`;
  }

  return undefined;
}

/** The error code, from whichever of the several places a runtime decided to put it. */
export function codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = (error as ErrorLike).code ?? (error as { errno?: unknown }).errno;
  if (typeof candidate === "string") return candidate;
  if (typeof candidate === "number") return String(candidate);
  const nested = (error as { cause?: unknown }).cause;
  return nested && typeof nested === "object" ? codeOf(nested) : undefined;
}

/** The name of the failure, for logging: `Error`, `ErrorEvent`, `TimeoutError`, … */
export function nameOf(error: unknown): string {
  if (typeof error !== "object" || error === null) return typeof error;
  const candidate = (error as ErrorLike).name ?? (error as ErrorLike).type;
  return typeof candidate === "string" && candidate ? candidate : "Error";
}

/**
 * Last resort for an object with no message anywhere: its own JSON, if that says anything.
 *
 * Only objects, and only when JSON has something to show. `JSON.stringify(null)` is the string
 * `"null"`, and answering an operator's "what happened?" with `null` is worse than admitting we
 * do not know — which is what the caller falls back to.
 */
function safeStringify(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    const seen = JSON.stringify(value);
    if (seen && seen !== "{}") return seen;
  } catch {
    // Circular, or a getter that threw.
  }
  return undefined;
}

/**
 * A one-line description of a failure: the message, the code when there is one worth printing,
 * and Postgres's own `detail` when the server sent it. Never returns an empty string.
 */
export function describeError(error: unknown): string {
  const message = messageOf(error) ?? safeStringify(error) ?? "unknown error";
  const code = codeOf(error);
  const rawDetail = (error as ErrorLike | null)?.detail;
  const detail = typeof rawDetail === "string" ? rawDetail : undefined;

  // The code is printed unless the message already carries it: `connect ECONNREFUSED 1.2.3.4:5432`
  // needs no parenthetical, while `password authentication failed` is much clearer with `(28P01)`
  // attached — that is the token people search for.
  const parts = [message];
  if (code && !message.includes(code)) parts.push(`(${code})`);
  if (detail && !message.includes(detail)) parts.push(`— ${detail}`);
  return parts.join(" ");
}
