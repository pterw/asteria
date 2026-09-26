import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { logger } from "./logger";

/**
 * Rate limiting that survives a second server instance.
 *
 * The previous implementation kept counters in a module-scope `Map`. On a single
 * long-running server that is correct; on Vercel, where a burst of traffic fans out
 * across lambdas that share nothing, it means the real allowance is `limit × instances`.
 * The fix is not a bigger library — it is putting the counter where every instance can
 * see it, which is the database we already have.
 *
 * The algorithm is a fixed window: one row per `(bucket, window)`, incremented with a
 * single upsert. That is one round trip, atomic under concurrency, and cheap to prune.
 * A sliding window would be more even at the boundary and cost either a second query or
 * a fatter row; for "stop one client flooding the write endpoints", the fixed window's
 * one-burst-per-window behaviour is the right trade.
 *
 * Failure policy: **fail open**. If the database cannot answer, the request proceeds and
 * the failure is logged. A rate limiter is protection, not correctness, and a limiter
 * that can take the product down when the database hiccups is a bigger risk than the
 * abuse it prevents.
 */

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
  retryAfterSeconds: number;
}

/** Per-process shortcut: the same caller hammering one warm instance costs no query. */
const recent = new Map<string, number>();
const RECENT_TTL_MS = 250;

function windowStart(now: number, windowMs: number): Date {
  return new Date(Math.floor(now / windowMs) * windowMs);
}

export async function checkRateLimit({
  key,
  limit,
  windowMs,
}: {
  key: string;
  limit: number;
  windowMs: number;
}): Promise<RateLimitResult> {
  const now = Date.now();
  const resetMs = windowMs - (now % windowMs);

  const lastSeen = recent.get(key);
  if (lastSeen !== undefined && now - lastSeen < RECENT_TTL_MS) {
    // Already counted within this window a moment ago by this instance: cheap allow.
    return { allowed: true, limit, remaining: limit - 1, resetMs, retryAfterSeconds: 0 };
  }

  const start = windowStart(now, windowMs);
  try {
    const db = await getDb();
    const rows = (await db.execute(sql`
      insert into rate_limits (bucket, window_start, count, expires_at)
      values (${key}, ${start.toISOString()}, 1, ${new Date(start.getTime() + windowMs * 2).toISOString()})
      on conflict (bucket, window_start)
      do update set count = rate_limits.count + 1
      returning count
    `)) as { rows?: Array<{ count: number }> };
    const count = Number(rows.rows?.[0]?.count ?? 1);
    recent.set(key, now);
    if (recent.size > 5_000) recent.clear();

    // Opportunistic pruning, on a small fraction of calls: expired buckets are dead
    // weight, and there is no cron in this deployment to sweep them.
    if (Math.random() < 0.01) {
      await db.execute(sql`delete from rate_limits where expires_at < now()`).catch(() => undefined);
    }

    const allowed = count <= limit;
    return {
      allowed,
      limit,
      remaining: Math.max(0, limit - count),
      resetMs,
      retryAfterSeconds: allowed ? 0 : Math.ceil(resetMs / 1000),
    };
  } catch (error) {
    logger.withError("rate limiter unavailable — allowing request", error, { bucket: key.split(":")[0] });
    return { allowed: true, limit, remaining: limit, resetMs, retryAfterSeconds: 0 };
  }
}

export const RATE_LIMITS = {
  /** A writer saving moments: generous, because this is the act the product exists for. */
  starWrite: { name: "star.write", limit: 60, windowMs: 60_000 },
  /** Reading the whole sky — cheap, but a scraper should not stream it. */
  starRead: { name: "star.read", limit: 240, windowMs: 60_000 },
  /** Search is the most expensive read; it gets its own bucket. */
  search: { name: "star.search", limit: 90, windowMs: 60_000 },
  /** Import writes up to 500 rows at once. */
  import: { name: "journal.import", limit: 6, windowMs: 3_600_000 },
  /** Exports are deliberate, not incidental. */
  export: { name: "journal.export", limit: 30, windowMs: 3_600_000 },
  /** Claiming a recovery key: slow, because guessing a key should be pointless. */
  recovery: { name: "journal.recovery", limit: 8, windowMs: 900_000 },
  /** Deleting a journal is irreversible and requires a typed confirmation. */
  erase: { name: "journal.erase", limit: 3, windowMs: 3_600_000 },
} as const;
