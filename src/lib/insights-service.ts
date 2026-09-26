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
 * Requests are signed (HMAC-SHA256 over `timestamp.body`) because the endpoint is public
 * on Vercel: without a shared secret, anyone could burn the function's CPU. The signature
 * is also what lets the service reject a replay older than a minute.
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

function signature(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

interface CallOptions {
  path: string;
  payload: unknown;
  timeoutMs?: number;
}

async function call<T>({ path, payload, timeoutMs }: CallOptions): Promise<T | null> {
  const { url, secret } = configuration();
  if (!url || !secret) return null;

  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const deadline = timeoutMs ?? Number(process.env.ASTERIA_INSIGHTS_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${url}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-asteria-timestamp": timestamp,
        "x-asteria-signature": signature(secret, timestamp, body),
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
    return (await response.json()) as T;
  } catch (error) {
    // A missing second service is an expected condition, not an incident: log at debug.
    logger.debug("insights service unreachable — using the local implementation", {
      path,
      error: error instanceof Error ? error.name : String(error),
    });
    return null;
  }
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
  const remote = await call<{ html: string }>({ path: "/atlas", payload, timeoutMs });
  if (remote?.html && typeof remote.html === "string" && remote.html.length > 200) {
    return { html: remote.html, source: "service" };
  }
  return null;
}
