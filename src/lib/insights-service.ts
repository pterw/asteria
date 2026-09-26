import { createHmac } from "node:crypto";
import { computeAnalytics, type Analytics, type MomentForAnalytics } from "./analytics";
import { logger } from "./logger";

/**
 * The Python service, called the way a service should be called from a product: as an
 * optimisation, never as a dependency.
 *
 * `services/insights` renders the atlas and computes the rhythm analytics. Both have an
 * in-process equivalent here, so the questions this module answers are only ever "is the
 * service reachable" and "is it faster or better than doing it locally" — not "is the
 * product working". Every call has a deadline, every failure is a logged fallback, and no
 * caller has to know which path produced the answer.
 *
 * Requests are signed (HMAC-SHA256 over `timestamp.path.body`) because the endpoint is
 * public on Vercel: without a shared secret, anyone could burn the function's CPU. The
 * timestamp is what lets the service refuse a replay, and the path is what stops a
 * captured request from being aimed at a different endpoint.
 */

const DEFAULT_TIMEOUT_MS = 2_500;

function configuration(): { url: string | null; secret: string | null } {
  const url = process.env.ASTERIA_INSIGHTS_URL?.trim().replace(/\/+$/, "") ?? null;
  const secret = process.env.ASTERIA_INSIGHTS_SECRET?.trim() ?? null;
  if (!url || !secret) return { url: null, secret: null };
  return { url, secret };
}

/** True when a service is configured. The UI may use this to avoid promising what it won't show. */
export function insightsServiceConfigured(): boolean {
  return configuration().url !== null;
}

/**
 * `timestamp.path.body`.
 *
 * The path is part of what is signed, not decoration: a signature over the body alone can
 * be replayed against a *different* endpoint whose body happens to be compatible. Binding
 * the destination, the freshness and the content into one digest means a captured request
 * is only ever good for the one place it was meant for, once.
 */
function signature(secret: string, timestamp: string, path: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${path}.${body}`).digest("hex");
}

interface CallOptions {
  path: string;
  payload: unknown;
  timeoutMs?: number;
}

/**
 * The signed request itself, so the two callers below cannot drift apart on how a request is
 * authenticated. Returns `null` for every failure — unreachable, refused, timed out — because
 * the caller's next move is always the same: answer from the local implementation.
 */
async function callRaw({ path, payload, timeoutMs }: CallOptions): Promise<Response | null> {
  const { url, secret } = configuration();
  if (!url || !secret) return null;

  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  // Derived from the URL actually being called, so the string signed here and the string
  // verified there cannot disagree.
  const signedPath = new URL(`${url}${path}`).pathname;
  const deadline = timeoutMs ?? Number(process.env.ASTERIA_INSIGHTS_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${url}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-asteria-timestamp": timestamp,
        "x-asteria-signature": signature(secret, timestamp, signedPath, body),
      },
      body,
      signal: AbortSignal.timeout(deadline),
      cache: "no-store",
    });
    if (!response.ok) {
      logger.warn("insights service returned an error — using the local implementation", {
        path,
        status: response.status,
      });
      return null;
    }
    return response;
  } catch (error) {
    // A missing second service is an expected condition, not an incident: log at debug.
    logger.debug("insights service unreachable — using the local implementation", {
      path,
      error: error instanceof Error ? error.name : String(error),
    });
    return null;
  }
}

/** A JSON endpoint. A body that is not JSON is a failure, not a value. */
async function call<T>(options: CallOptions): Promise<T | null> {
  const response = await callRaw(options);
  if (!response) return null;
  try {
    return (await response.json()) as T;
  } catch (error) {
    // The service answered 200 with something unparseable — a proxy error page, a truncated
    // response. Worth a warning: the fallback is correct, but something is misconfigured.
    logger.warn("insights service answered with a body that is not JSON", {
      path: options.path,
      error: error instanceof Error ? error.name : String(error),
    });
    return null;
  }
}

/**
 * A document endpoint.
 *
 * `/atlas` answers with `text/html`, not a JSON envelope, and deliberately so: the document
 * is the payload, and wrapping a megabyte of HTML in a JSON string costs escaping on the way
 * out and parsing on the way in for no benefit. The content type is checked before the body
 * is believed, so an HTML error page from a proxy is treated as a failure.
 */
async function callDocument(options: CallOptions): Promise<string | null> {
  const response = await callRaw(options);
  if (!response) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    logger.warn("insights service answered the atlas with the wrong content type", {
      path: options.path,
      contentType: contentType || "(none)",
    });
    return null;
  }
  return await response.text();
}

export interface AnalyticsResult {
  analytics: Analytics;
  /** Where the numbers came from. Surfaced honestly in the interface, not hidden. */
  source: "service" | "local";
}

export async function requestAnalytics(
  moments: MomentForAnalytics[],
  { timeZone, now = new Date(), includeExamples = false }: { timeZone: string; now?: Date; includeExamples?: boolean },
): Promise<AnalyticsResult> {
  const payload = {
    timeZone,
    now: now.toISOString(),
    includeExamples,
    moments: moments.map(moment => ({
      id: moment.id,
      mood: moment.mood,
      intensity: moment.intensity,
      createdAt: moment.createdAt,
      favorite: Boolean(moment.favorite),
      isSample: Boolean(moment.isSample),
    })),
  };

  const remote = await call<{ analytics: Analytics }>({ path: "/insights", payload });
  if (remote?.analytics && typeof remote.analytics === "object" && "cadence" in remote.analytics) {
    return { analytics: remote.analytics, source: "service" };
  }
  return { analytics: computeAnalytics(moments, { timeZone, now, includeExamples }), source: "local" };
}

export interface AtlasResult {
  html: string;
  source: "service" | "local";
}

/**
 * Render the atlas. Returns the service's document when it answers, and `null` when the
 * caller should fall back — the route decides what a degraded atlas looks like, because
 * only it knows the writer is waiting on a download.
 */
export async function requestAtlas(
  payload: { moments: unknown[]; timeZone: string; title: string; now: string },
  timeoutMs = 6_000,
): Promise<AtlasResult | null> {
  const document = await callDocument({ path: "/atlas", payload, timeoutMs });
  // A short document is not a render of a journal, whatever it says: treat anything smaller
  // than a plausible page as a failure and let the route render its own.
  if (document && document.length > 200) return { html: document, source: "service" };
  return null;
}
