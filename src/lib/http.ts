import { createHash } from "node:crypto";
import { ApiError, isDatabaseUnavailable, tooManyRequests, unavailable } from "./errors";
import { logger, newRequestId, type Logger } from "./logger";
import { checkRateLimit } from "./ratelimit";

/**
 * The one place an API response is shaped.
 *
 * Every route in this application is wrapped in `withRoute`, which owns four things so
 * that no route has to remember them:
 *
 * 1. **Identity per request.** A short request id is minted, attached to a child logger,
 *    and echoed in `x-request-id`.
 * 2. **Errors become sentences.** An `ApiError` keeps its own message; a Postgres outage
 *    becomes "your journal is temporarily unavailable" with a 503; anything else becomes
 *    a generic 500 with the detail logged and never returned. A route that forgets to
 *    catch cannot leak a stack trace.
 * 3. **Caching policy.** Reads are `private` (the response belongs to one journal and
 *    must never land in a shared cache) and writes are `no-store`.
 * 4. **Rate limiting**, when the route asks for it, before the handler runs.
 */

export interface RouteContext {
  requestId: string;
  log: Logger;
  /** Server time, captured once so a handler cannot straddle a minute boundary. */
  now: Date;
  url: URL;
}

export interface RouteOptions {
  /** Bucket key prefix, e.g. `star.create`. Omit to disable limiting for the route. */
  rateLimit?: { name: string; limit: number; windowMs: number };
}

/**
 * A route handler, plus whatever Next.js passes after the request — for a dynamic route
 * that is `{ params }`. Passing it through unchanged keeps the wrapper transparent: the
 * handler signature at the call site is the signature Next.js expects.
 */
type Handler<Extra> = (context: RouteContext, request: Request, extra: Extra) => Promise<Response> | Response;

/** Weak ETag over a stable serialisation of the payload. */
export function etagOf(value: unknown): string {
  const body = typeof value === "string" ? value : JSON.stringify(value);
  return `W/"${createHash("sha1").update(body).digest("base64url").slice(0, 20)}"`;
}

function baseHeaders(requestId: string): Headers {
  return new Headers({
    "x-request-id": requestId,
    "x-content-type-options": "nosniff",
  });
}

export function jsonResponse(
  data: unknown,
  { status = 200, requestId = "", headers = {} }: { status?: number; requestId?: string; headers?: Record<string, string> } = {},
): Response {
  const merged = baseHeaders(requestId);
  for (const [key, value] of Object.entries(headers)) merged.set(key, value);
  if (!merged.has("cache-control")) merged.set("cache-control", "private, no-store");
  merged.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { status, headers: merged });
}

/**
 * A read that may be cached by the browser for `maxAge` seconds but never by a shared
 * cache, with an ETag and a 304 short-circuit when the caller already has this version.
 */
export function cachedJson(
  data: unknown,
  { request, requestId, maxAge = 0 }: { request: Request; requestId: string; maxAge?: number },
): Response {
  const etag = etagOf(data);
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { etag, "x-request-id": requestId } });
  }
  return jsonResponse(data, {
    requestId,
    headers: {
      etag,
      "cache-control": maxAge > 0 ? `private, max-age=${maxAge}, must-revalidate` : "private, no-store",
    },
  });
}

/** Parse and size-check a JSON body. Anything but a small JSON object is rejected. */
export async function readJsonBody(request: Request, { maxBytes = 8_192 }: { maxBytes?: number } = {}): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    throw new ApiError(415, "Send a JSON request.", "unsupported_media");
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared && declared > maxBytes) throw new ApiError(413, "This moment is too large.", "too_large");
  const text = await request.text();
  if (text.length > maxBytes) throw new ApiError(413, "This moment is too large.", "too_large");
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ApiError(400, "Expected an object.", "bad_request");
    }
    return value;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "The request could not be read.", "bad_request");
  }
}

/** The client's address, as far as the platform lets us see it. */
export function clientKey(request: Request, scope: string): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "local";
  return `${scope}:${address}`;
}

export function withRoute<Extra = unknown>(handler: Handler<Extra>, options: RouteOptions = {}) {
  return async function route(request: Request, extra: Extra): Promise<Response> {
    const requestId = newRequestId();
    const url = new URL(request.url);
    const log = logger.child({ requestId, route: url.pathname, method: request.method });
    const started = performance.now();

    try {
      if (options.rateLimit) {
        const { name, limit, windowMs } = options.rateLimit;
        const result = await checkRateLimit({ key: clientKey(request, name), limit, windowMs });
        if (!result.allowed) {
          log.warn("rate limited", { bucket: name, limit, retryAfterSeconds: result.retryAfterSeconds });
          const response = jsonResponse(
            { error: "That was a lot at once. Give it a moment and try again.", code: "rate_limited" },
            {
              status: 429,
              requestId,
              headers: { "retry-after": String(result.retryAfterSeconds), "cache-control": "no-store" },
            },
          );
          return response;
        }
      }

      const response = await handler({ requestId, log, now: new Date(), url }, request, extra);
      log.info("request", {
        status: response.status,
        durationMs: Number((performance.now() - started).toFixed(1)),
      });
      return response;
    } catch (error) {
      const mapped = toResponse(error, { requestId, log, url });
      log.info("request", {
        status: mapped.status,
        durationMs: Number((performance.now() - started).toFixed(1)),
          error: error instanceof ApiError ? error.code : "internal",
      });
      return mapped;
    }
  };
}

function toResponse(
  error: unknown,
  { requestId, log, url }: { requestId: string; log: Logger; url: URL },
): Response {
  if (error instanceof ApiError) {
    if (error.status >= 500) log.withError("request failed", error, { code: error.code, ...error.log });
    else log.debug("request rejected", { code: error.code, status: error.status, ...error.log });
    const headers: Record<string, string> = { "cache-control": "no-store" };
    if (error.status === 429 && typeof error.log?.retryAfterSeconds === "number") {
      headers["retry-after"] = String(error.log.retryAfterSeconds);
    }
    return jsonResponse({ error: error.message, code: error.code }, { status: error.status, requestId, headers });
  }

  if (isDatabaseUnavailable(error)) {
    log.withError("database unavailable", error, { route: url.pathname });
    return jsonResponse(
      { error: "Your journal is briefly out of reach. Nothing was lost — please try again.", code: "unavailable" },
      { status: 503, requestId, headers: { "cache-control": "no-store" } },
    );
  }

  log.withError("unhandled route error", error, { route: url.pathname });
  return jsonResponse(
    { error: "Something went wrong on our side. Nothing was lost — please try again.", code: "internal" },
    { status: 500, requestId, headers: { "cache-control": "no-store" } },
  );
}

/** Shared guard for routes that must not run without a database. */
export function requireClient(request: Request): void {
  if (request.headers.get("sec-fetch-site") === "cross-site" && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    throw new ApiError(403, "Please make changes from your own journal.", "forbidden");
  }
}

export { tooManyRequests, unavailable };
