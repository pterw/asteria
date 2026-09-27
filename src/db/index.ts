import { sql } from "drizzle-orm";
import { describeError } from "@/lib/errors";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/**
 * One API, three Postgres drivers.
 *
 * Asteria is deployed on Vercel with a managed Postgres (`DATABASE_URL`), and it also
 * has to run — for development, for the whole test suite, for a laptop with no Docker
 * — with nothing installed at all. All three cases speak Postgres, so the application only
 * ever sees this module: a Drizzle instance plus a raw executor, whichever driver is
 * behind it.
 *
 * **Embedded (PGlite).** When `DATABASE_URL` is unset, or `ASTERIA_DB=pglite`, the
 * database is Postgres compiled to WebAssembly and stored in a directory on disk
 * (`ASTERIA_DB_DIR`, default `.asteria/data`). Since the schema uses nothing but
 * Postgres — generated columns, GIN indexes, advisory locks, `hashtext` — the same
 * migrations produce the same database either way.
 *
 * **Neon serverless (`@neondatabase/serverless`).** A `DATABASE_URL` pointing at a Neon host
 * uses Neon's own driver, which tunnels the Postgres wire protocol over a WebSocket instead of
 * opening a TCP socket. There is no socket to leave open, no handshake per invocation, and
 * nothing for a serverless function to leak when the platform freezes it between requests.
 * It is also node-postgres compatible — `Pool`, `Client`, `query()`, `connect()` — so the code
 * below is the same code as the `pg` path, which is the point: one implementation, two
 * transports.
 *
 * Neon's driver has a second transport, `neon()` over HTTP, which is faster for a single
 * query but cannot hold a session: no `BEGIN`/`COMMIT` across round trips, no advisory locks,
 * no prepared statements. Asteria places a star inside a transaction that takes
 * `pg_advisory_xact_lock(hashtext(journalId))` to allocate its position, and its migrations are
 * a single transaction. None of that is expressible over HTTP, so the WebSocket transport is
 * not a preference here — the HTTP one would be a different, weaker application.
 *
 * **Server (node-postgres).** Any other `DATABASE_URL` uses `pg` with a small pooled client
 * built for serverless: a low connection ceiling, short idle timeouts, and `allowExitOnIdle` so
 * an idle lambda is not held open by its own pool.
 *
 * The driver is chosen once per process and cached on `globalThis` so Next.js hot
 * reloads cannot open a second database.
 */

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
export type DriverName = "postgres" | "neon" | "pglite";

/** The handle a caller gets inside `transaction()`: one connection, one transaction. */
export interface Transaction {
  /** Multi-statement SQL with no parameters. */
  exec(statement: string): Promise<void>;
  /** Parameterised query, `$1`-style placeholders. */
  query<T = Record<string, unknown>>(statement: string, params?: unknown[]): Promise<T[]>;
}

export interface DbHandle extends Transaction {
  db: Database;
  driver: DriverName;
  /**
   * Run `fn` inside a single transaction on a single connection, and roll it back if `fn`
   * throws.
   *
   * This exists because of a real production hazard rather than tidiness. Asteria's
   * migrations take an advisory lock, and a *session*-level advisory lock is only meaningful
   * on a connection the caller keeps — which is exactly what a transaction-mode pooler
   * (Neon, Supabase, PgBouncer) does not give you. Two `exec` calls can land on two different
   * server connections, so the lock is not held for the work and the unlock may hit a
   * connection that never took it. A transaction-scoped lock inside one transaction is safe
   * on both a direct connection and a pooled one.
   */
  transaction<T>(fn: (tx: Transaction) => Promise<T>, options?: { rollback?: boolean }): Promise<T>;
  close(): Promise<void>;
  /** Connection string with any credentials removed, for logs and health output. */
  describe(): string;
}

/** True when a connection string points at Neon, whose host is always under `neon.tech`. */
export function isNeonUrl(connectionString: string | undefined): boolean {
  if (!connectionString) return false;
  try {
    return new URL(connectionString).hostname.endsWith(".neon.tech");
  } catch {
    return /@[^/]*\.neon\.tech[:/]/i.test(connectionString);
  }
}

/** True when a Neon connection string goes through their PgBouncer pooler. */
export function isPooledHost(connectionString: string | undefined): boolean {
  if (!connectionString) return false;
  try {
    return new URL(connectionString).hostname.includes("-pooler");
  } catch {
    return /-pooler[.:]/i.test(connectionString);
  }
}

/**
 * Which connection string the *migration* runner should use.
 *
 * Neon publishes two strings for the same database: a pooled one (`-pooler` in the hostname,
 * PgBouncer in transaction mode) for application traffic, and a direct one for anything that
 * needs session state. Their documentation is explicit that schema changes belong on the
 * direct one, and Vercel's Neon integration sets `DATABASE_URL_UNPOOLED` for exactly that.
 *
 * Asteria's migrations are already safe through the pooler — one transaction, a
 * transaction-scoped advisory lock, so no session state is required — but the direct string is
 * still the better choice where it exists: it cannot queue behind application traffic, and the
 * DDL does not have to be reasoned about through a pooler at all. So: prefer the unpooled
 * string when it is set, and carry on with `DATABASE_URL` when it is not.
 */
export function migrationConnectionString(): { url: string | undefined; pooled: boolean; source: string } {
  const pooledUrl = process.env.DATABASE_URL?.trim() || undefined;
  const unpooled = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.POSTGRES_URL_NON_POOLING?.trim() || undefined;

  if (unpooled) return { url: unpooled, pooled: false, source: "DATABASE_URL_UNPOOLED" };
  if (pooledUrl) return { url: pooledUrl, pooled: isPooledHost(pooledUrl), source: "DATABASE_URL" };
  return { url: undefined, pooled: false, source: "none" };
}

/** Which driver this process is using: Neon, the server, or the embedded database. */
export function driverName(): DriverName {
  return requestedDriver();
}

/**
 * Resolve the driver from the environment, deliberately without connecting to anything.
 *
 * The order matters. An explicit `ASTERIA_DB` always wins, because a developer forcing the
 * embedded driver must not be overruled by a `DATABASE_URL` left in their shell. Then Neon is
 * detected from the hostname rather than from configuration, because the connection string is
 * the only thing a Vercel integration reliably sets — asking a deployment to also declare
 * "this is Neon" is a step that can be forgotten on a preview branch.
 */
function requestedDriver(): DriverName {
  const explicit = process.env.ASTERIA_DB?.trim().toLowerCase();
  if (explicit === "pglite" || explicit === "embedded") return "pglite";
  if (explicit === "neon") return "neon";
  if (explicit === "postgres" || explicit === "pg") return "postgres";

  const url = process.env.DATABASE_URL?.trim();
  if (url && isNeonUrl(url)) return "neon";
  if (url) return "postgres";

  // The embedded driver writes to a directory. On a serverless platform that directory is
  // per-instance and ephemeral, so a deployment without `DATABASE_URL` would look healthy
  // while every instance quietly kept its own sky — the worst failure mode this product has,
  // because the writer only discovers it later. Refuse to start instead. `ASTERIA_DB=pglite`
  // is the explicit opt-in for a deliberate demo deployment.
  if (process.env.VERCEL && explicit !== "pglite") {
    throw new Error(
      "Asteria is running on Vercel without DATABASE_URL. Add a managed Postgres connection " +
        "string in Project → Settings → Environment Variables (the embedded database is " +
        "for local development only, and cannot persist on a serverless filesystem).",
    );
  }

  return "pglite";
}

/** `sslmode` in the URL is authoritative; `POSTGRES_SSL` can force it either way. */
function sslConfig(connectionString: string): false | { rejectUnauthorized: boolean } {
  const forced = process.env.POSTGRES_SSL?.trim().toLowerCase();
  const mode = forced && forced !== "" ? forced : urlSslMode(connectionString);
  switch (mode) {
    case undefined:
    case "disable":
    case "false":
      return false;
    // Managed poolers (Neon, Supabase, RDS Proxy) terminate TLS with a certificate
    // that is not in Node's default store; the connection is still encrypted.
    case "require":
    case "prefer":
    case "no-verify":
    case "true":
      return { rejectUnauthorized: false };
    default:
      return { rejectUnauthorized: true };
  }
}

function urlSslMode(connectionString: string): string | undefined {
  try {
    return new URL(connectionString).searchParams.get("sslmode") ?? undefined;
  } catch {
    return /sslmode=([a-z-]+)/i.exec(connectionString)?.[1];
  }
}

function redact(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "<unparseable connection string>";
  }
}

function dataDir(): string {
  return process.env.ASTERIA_DB_DIR?.trim() || ".asteria/data";
}

/**
 * The pool configuration both TCP-ish drivers share.
 *
 * A serverless function must not hold the database open, and managed Postgres is normally
 * reached through a transaction-mode pooler which multiplexes a handful of real server
 * connections across many instances. A bigger local pool therefore buys nothing but connection
 * slots: two per instance, released quickly. Neon's documentation says the same thing in the
 * same numbers — "set your local pool's maximum to 1 or 2 per container and let PgBouncer
 * handle the multiplexing" — which is why one builder serves both drivers.
 */
function poolConfig(connectionString: string, production: boolean) {
  return {
    connectionString,
    max: Number(process.env.POSTGRES_POOL_MAX ?? (production ? 2 : 10)),
    idleTimeoutMillis: Number(process.env.POSTGRES_IDLE_TIMEOUT_MS ?? 10_000),
    connectionTimeoutMillis: Number(process.env.POSTGRES_CONNECT_TIMEOUT_MS ?? 8_000),
    // Client-side deadline on a single query. `statement_timeout` would be a session-level
    // SET, which is not ours to make on a pooled connection; giving up on the client is both
    // safe under pooling and enough to stop one pathological query from occupying a function
    // until the platform's own limit kills the request.
    query_timeout: Number(process.env.POSTGRES_QUERY_TIMEOUT_MS ?? 15_000),
    // Shows up in `pg_stat_activity`, so an operator can tell Asteria's queries from anyone
    // else's on a shared database.
    application_name: "asteria",
    allowExitOnIdle: production,
  };
}

/** Just enough of a `pg`-style pool for the handle below, shared by both pool drivers. */
interface PoolLike {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  connect(): Promise<{
    query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
    release(): void;
  }>;
  end(): Promise<void>;
  on?(event: "error", listener: (error: unknown) => void): void;
}

/**
 * Build a handle around a node-postgres-compatible pool.
 *
 * `require` is used rather than `import` for one specific reason: it makes the module load
 * *inside* this function, so a build that never takes this path does not have to resolve the
 * package. That keeps the Neon driver out of a deployment that does not use it, and — more
 * importantly — keeps `pg` out of a PGlite-only build.
 */
async function createPoolHandle(options: {
  pool: PoolLike;
  driver: DriverName;
  createDrizzle: (pool: unknown) => Database;
  describe: () => string;
}): Promise<DbHandle> {
  const { pool, driver, createDrizzle, describe } = options;

  // A pool error is not a failed query: without this listener an idle client that
  // drops (network blip, database failover) would emit an unhandled 'error' event
  // and take the process with it.
  pool.on?.("error", error => {
    console.error(JSON.stringify({ level: "error", msg: "postgres pool error", driver, error: String(error) }));
  });

  // On Vercel a function instance can be suspended between invocations. An idle client left
  // in the pool is still counted against the database's connection ceiling while the instance
  // sleeps. This tells the runtime to keep the instance alive long enough for its own
  // connections to drain. It is a no-op anywhere else, and a deployment works without it —
  // it just holds connections it does not need. Neon's driver accepts the same call.
  if (process.env.VERCEL) {
    try {
      const { attachDatabasePool } = await import("@vercel/functions");
      attachDatabasePool(pool as never);
    } catch (error) {
      console.warn(
        JSON.stringify({ level: "warn", msg: "could not attach the pool to the Vercel runtime", error: String(error) }),
      );
    }
  }

  return {
    db: createDrizzle(pool),
    driver,
    // No parameter values means the simple query protocol, on both drivers, so a whole
    // migration file — many statements separated by semicolons — runs in one call. This is the
    // same rule node-postgres applies (`Query.requiresPreparation()`), and Neon's driver is a
    // port of it.
    async exec(statement) {
      await pool.query(statement);
    },
    async query<T>(statement: string, params?: unknown[]) {
      const result = await pool.query(statement, params as never[]);
      return result.rows as T[];
    },
    async transaction<T>(fn: (tx: Transaction) => Promise<T>, settings: { rollback?: boolean } = {}) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const value = await fn({
          exec: async statement => {
            await client.query(statement);
          },
          query: async <Row>(statement: string, params?: unknown[]) =>
            (await client.query(statement, params as never[])).rows as Row[],
        });
        // `rollback: true` is a dry run that really did the work and then discarded it — the
        // only way to know a migration applies cleanly without keeping the result.
        await client.query(settings.rollback ? "rollback" : "commit");
        return value;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
    describe,
  };
}

async function createPostgresHandle(): Promise<DbHandle> {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const connectionString = process.env.DATABASE_URL as string;
  const production = process.env.NODE_ENV === "production";

  const pool = new Pool({ ...poolConfig(connectionString, production), ssl: sslConfig(connectionString) });
  return createPoolHandle({
    pool: pool as unknown as PoolLike,
    driver: "postgres",
    createDrizzle: client =>
      drizzle(client as never, { schema, logger: process.env.ASTERIA_SQL_LOG === "1" }) as unknown as Database,
    describe: () => redact(connectionString),
  });
}

async function createNeonHandle(): Promise<DbHandle> {
  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  const { drizzle } = await import("drizzle-orm/neon-serverless");
  const connectionString = process.env.DATABASE_URL as string;
  const production = process.env.NODE_ENV === "production";

  // Neon's driver needs a WebSocket implementation. Every runtime Asteria runs on has one
  // (`WebSocket` is global in Node 22, on Vercel, and in browsers), so `ws` is only a fallback
  // for an older Node — and it is a *static* import path only when it is actually reached,
  // since this module is loaded through `require` inside the function.
  if (typeof WebSocket === "undefined") {
    const { default: ws } = await import("ws");
    neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
  }

  const pool = new Pool(poolConfig(connectionString, production));
  return createPoolHandle({
    pool: pool as unknown as PoolLike,
    driver: "neon",
    createDrizzle: client =>
      drizzle(client as never, { schema, logger: process.env.ASTERIA_SQL_LOG === "1" }) as unknown as Database,
    // Deliberately keeps the `-pooler` suffix visible: it is the difference between
    // "connected through the pooler" and "holding a direct connection", which is exactly what
    // somebody reading a health check needs to know.
    describe: () => redact(connectionString),
  });
}

async function createPgliteHandle(): Promise<DbHandle> {
  const [{ PGlite }, { drizzle }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
  ]);
  const directory = dataDir();
  const { mkdir } = await import("node:fs/promises");
  await mkdir(directory, { recursive: true }).catch(() => undefined);

  const client = new PGlite(directory);
  await client.waitReady;
  const db = drizzle(client, { schema, logger: process.env.ASTERIA_SQL_LOG === "1" });
  return {
    db: db as unknown as Database,
    driver: "pglite",
    async exec(statement) {
      await client.exec(statement);
    },
    async query<T>(statement: string, params?: unknown[]) {
      const result = await client.query<T>(statement, params as never[]);
      return result.rows;
    },
    // One connection by construction, so `begin`/`commit` around the callback is the whole
    // story: there is no second connection for the statements to escape to.
    async transaction<T>(fn: (tx: Transaction) => Promise<T>, options: { rollback?: boolean } = {}) {
      await client.exec("begin");
      try {
        const value = await fn({
          exec: async statement => {
            await client.exec(statement);
          },
          query: async <Row>(statement: string, params?: unknown[]) => {
            const result = await client.query<Row>(statement, params as never[]);
            return result.rows;
          },
        });
        await client.exec(options.rollback ? "rollback" : "commit");
        return value;
      } catch (error) {
        await client.exec("rollback").catch(() => undefined);
        throw error;
      }
    },
    async close() {
      await client.close();
    },
    describe: () => `pglite:${directory}`,
  };
}

const globalForDb = globalThis as typeof globalThis & {
  __asteriaDbHandle?: Promise<DbHandle>;
};

/** The process-wide handle. Safe to call from anywhere; connects at most once. */
export function getDbHandle(): Promise<DbHandle> {
  if (!globalForDb.__asteriaDbHandle) {
    const driver = requestedDriver();
    globalForDb.__asteriaDbHandle = (
      driver === "pglite"
        ? createPgliteHandle()
        : driver === "neon"
          ? createNeonHandle()
          : createPostgresHandle()
    ).catch(error => {
      // Do not cache a failure: the next request should retry a cold database.
      globalForDb.__asteriaDbHandle = undefined;
      throw error;
    });
  }
  return globalForDb.__asteriaDbHandle;
}

export async function getDb(): Promise<Database> {
  return (await getDbHandle()).db;
}

/** Reset the cached handle. Used by tests and by `/api/health` after a failure. */
export async function closeDb(): Promise<void> {
  const pending = globalForDb.__asteriaDbHandle;
  globalForDb.__asteriaDbHandle = undefined;
  if (pending) await (await pending).close().catch(() => undefined);
}

export interface DbPing {
  ok: boolean;
  driver: DriverName;
  target: string;
  latencyMs: number;
  /** A one-line, human-readable description. Never a stack trace, never a credential. */
  error?: string;
  /**
   * The raw failure, for callers that need to classify it rather than print it — telling
   * "nothing answered on that host" (503, try again) from "that query was wrong" (500).
   * Deliberately not part of any response body.
   */
  cause?: unknown;
}

/** Cheap liveness probe, used by `/api/health` and the deployment smoke test. */
export async function pingDb(): Promise<DbPing> {
  const started = performance.now();
  const driver = requestedDriver();
  try {
    const handle = await getDbHandle();
    // Deliberately not `handle.db.execute(...)`: a liveness probe wants the driver's own
    // failure, and the ORM wraps it in a generic `Failed query: select 1`. That is exactly the
    // sentence that would reach a health check and a deploy log instead of "connection refused".
    await handle.query("select 1");
    return {
      ok: true,
      driver: handle.driver,
      target: handle.describe(),
      latencyMs: Number((performance.now() - started).toFixed(2)),
    };
  } catch (error) {
    return {
      ok: false,
      driver,
      target: driver === "pglite" ? dataDir() : redact(process.env.DATABASE_URL ?? ""),
      latencyMs: Number((performance.now() - started).toFixed(2)),
      // `describeError` rather than `error.message`: the Neon driver raises a browser-style
      // `ErrorEvent` when the socket cannot be established, and that is not an `Error`, so the
      // reflexive `instanceof` check would answer with the string "[object ErrorEvent]" —
      // precisely when somebody is pasting a new connection string and needs the real sentence.
      error: describeError(error),
      cause: error,
    };
  }
}

export { schema };
