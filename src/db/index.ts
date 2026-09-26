import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/**
 * One API, two Postgres drivers.
 *
 * Asteria is deployed on Vercel with a managed Postgres (`DATABASE_URL`), and it also
 * has to run — for development, for the whole test suite, for a laptop with no Docker
 * — with nothing installed at all. Both cases speak Postgres, so the application only
 * ever sees this module: a Drizzle instance plus a raw executor, whichever driver is
 * behind it.
 *
 * **Embedded (PGlite).** When `DATABASE_URL` is unset, or `ASTERIA_DB=pglite`, the
 * database is Postgres 18 compiled to WebAssembly and stored in a directory on disk
 * (`ASTERIA_DB_DIR`, default `.asteria/data`). Since the schema uses nothing but
 * Postgres — generated columns, GIN indexes, advisory locks, `hashtext` — the same
 * migrations produce the same database either way.
 *
 * **Server (node-postgres).** When `DATABASE_URL` is set, a small pooled client is
 * used with serverless in mind: a low connection ceiling, short idle timeouts, and
 * `allowExitOnIdle` so an idle lambda is not held open by its own pool.
 *
 * The driver is chosen once per process and cached on `globalThis` so Next.js hot
 * reloads cannot open a second database.
 */

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
export type DriverName = "postgres" | "pglite";

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

/** Which driver this process is using: the server when `DATABASE_URL` is set, else embedded. */
export function driverName(): DriverName {
  return requestedDriver();
}

function requestedDriver(): DriverName {
  const explicit = process.env.ASTERIA_DB?.trim().toLowerCase();
  if (explicit === "pglite" || explicit === "embedded") return "pglite";
  if (explicit === "postgres" || explicit === "pg") return "postgres";
  if (process.env.DATABASE_URL) return "postgres";

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

async function createPostgresHandle(): Promise<DbHandle> {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const connectionString = process.env.DATABASE_URL as string;
  const production = process.env.NODE_ENV === "production";

  const pool = new Pool({
    connectionString,
    // A serverless function must not hold the database open, and managed Postgres is
    // normally reached through a transaction-mode pooler (Neon, Supabase, PgBouncer) which
    // multiplexes a handful of real server connections across many instances. A bigger local
    // pool therefore buys nothing but connection slots: two per instance, released quickly.
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
    ssl: sslConfig(connectionString),
  });

  // A pool error is not a failed query: without this listener an idle client that
  // drops (network blip, database failover) would emit an unhandled 'error' event
  // and take the process with it.
  pool.on("error", error => {
    console.error(JSON.stringify({ level: "error", msg: "postgres pool error", error: String(error) }));
  });

  const db = drizzle(pool, { schema, logger: process.env.ASTERIA_SQL_LOG === "1" });
  return {
    db: db as unknown as Database,
    driver: "postgres",
    async exec(statement) {
      await pool.query(statement);
    },
    async query<T>(statement: string, params?: unknown[]) {
      const result = await pool.query(statement, params as never[]);
      return result.rows as T[];
    },
    async transaction<T>(fn: (tx: Transaction) => Promise<T>, options: { rollback?: boolean } = {}) {
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
        await client.query(options.rollback ? "rollback" : "commit");
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
    describe: () => redact(connectionString),
  };
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
    globalForDb.__asteriaDbHandle = (driver === "postgres" ? createPostgresHandle() : createPgliteHandle()).catch(error => {
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

/** Reset the cached handle. Used by tests and by `/api/ready` after a failure. */
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
  error?: string;
}

/** Cheap liveness probe, used by `/api/health` and the deployment smoke test. */
export async function pingDb(): Promise<DbPing> {
  const started = performance.now();
  const driver = requestedDriver();
  try {
    const handle = await getDbHandle();
    await handle.db.execute(sql`select 1`);
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
      target: driver === "postgres" ? redact(process.env.DATABASE_URL ?? "") : dataDir(),
      latencyMs: Number((performance.now() - started).toFixed(2)),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export { schema };
