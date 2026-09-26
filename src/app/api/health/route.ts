import { closeDb, getDbHandle, pingDb } from "@/db";
import { jsonResponse } from "@/lib/http";
import { etagOf } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Liveness and dependency health.
 *
 * Deliberately cheap and deliberately public: it answers whether the process is up and
 * whether the database is reachable, in the shape a monitor expects, without exposing
 * anything about any journal. `?deep=1` adds schema verification for a deployment smoke test.
 *
 * A failing database returns 503, because that is what an uptime check should see. The
 * process itself is healthy in that state, and the body says so — the distinction matters
 * when deciding whether to restart something.
 */
export async function GET(request: Request) {
  const started = performance.now();
  const deep = new URL(request.url).searchParams.get("deep") === "1";
  const ping = await pingDb();

  let schema: { ok: boolean; missing: string[] } | null = null;
  if (deep && ping.ok) {
    try {
      const handle = await getDbHandle();
      const rows = await handle.query<{ table_name: string }>(`
        select table_name from information_schema.tables
        where table_schema = 'public'
          and table_name in ('journals','sessions','stars','journal_events','rate_limits','asteria_migrations')
      `);
      const found = new Set(rows.map(row => row.table_name));
      const missing = ["journals", "sessions", "stars", "journal_events", "rate_limits"].filter(
        table => !found.has(table),
      );
      schema = { ok: missing.length === 0, missing };
    } catch {
      schema = { ok: false, missing: ["unknown"] };
    }
  }

  const healthy = ping.ok && (schema?.ok ?? true);
  const memory = process.memoryUsage();

  return jsonResponse(
    {
      status: healthy ? "healthy" : "degraded",
      database: {
        status: ping.ok ? "connected" : "unreachable",
        driver: ping.driver,
        target: ping.target,
        latencyMs: ping.latencyMs,
        ...(ping.error ? { error: ping.error } : {}),
      },
      ...(schema ? { schema } : {}),
      runtime: {
        node: process.version,
        uptimeSeconds: Math.floor(process.uptime()),
        memoryRssMb: Number((memory.rss / 1024 / 1024).toFixed(1)),
        region: process.env.VERCEL_REGION ?? "local",
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
      },
      latencyMs: Number((performance.now() - started).toFixed(1)),
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503, headers: { "cache-control": "no-store", etag: etagOf(String(ping.latencyMs)) } },
  );
}

/** Allow a monitor (or a person) to force a reconnect after a database failover. */
export async function POST() {
  await closeDb();
  const ping = await pingDb();
  return jsonResponse({ ok: ping.ok, database: ping }, { status: ping.ok ? 200 : 503 });
}
