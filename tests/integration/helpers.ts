import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDb, getDbHandle } from "@/db/index";

/**
 * A real database per test file, with no server to install.
 *
 * Asteria's schema uses Postgres properly — generated columns, GIN indexes over tsvector,
 * advisory locks, `hashtext`, filtered aggregates — so testing it against a mock would
 * test nothing worth testing. PGlite is Postgres compiled to WebAssembly: the same SQL,
 * the same planner, in-process, on a temporary directory that is deleted afterwards.
 *
 * That still leaves one gap: PGlite is not the driver production uses. Point
 * `ASTERIA_TEST_DATABASE_URL` at a throwaway server — `ci.yml` runs exactly this against
 * a real `postgres:17` — and the same suite exercises `pg` instead, connection pool, TLS
 * options and all. The variable is deliberately *not* `DATABASE_URL`: these tests drop the
 * schema, and no stray environment variable should be able to delete somebody's sky.
 */

export const TEST_SECRET = "integration-test-secret-long-enough";

/** True when the suite is pointed at a real server rather than the embedded one. */
export const usingServerDatabase = () => Boolean(process.env.ASTERIA_TEST_DATABASE_URL);

/** Point this process at a throwaway database and make sure nothing leaks out. */
export function useTestDatabase(): string {
  process.env.ASTERIA_SECRET = TEST_SECRET;

  const url = process.env.ASTERIA_TEST_DATABASE_URL;
  if (url) {
    process.env.DATABASE_URL = url;
    process.env.ASTERIA_DB = "postgres";
    return url;
  }

  const directory = mkdtempSync(path.join(tmpdir(), "asteria-test-"));
  process.env.ASTERIA_DB = "pglite";
  process.env.ASTERIA_DB_DIR = directory;
  delete process.env.DATABASE_URL;
  return directory;
}

/** Apply the shipped migrations to whatever database this process is pointed at. */
export async function migrate(): Promise<void> {
  const { runMigrations } = await import("../../scripts/migrate");
  await runMigrations({ log: () => {} });
}

/** An empty schema: used when a test needs to start from nothing (or from v1). */
export async function resetSchema(): Promise<void> {
  const handle = await getDbHandle();
  await handle.exec(`
    drop schema public cascade;
    create schema public;
  `);
}

/** Fresh database with the current schema applied. */
export async function freshDatabase(): Promise<void> {
  await migrate();
  await resetSchema();
  await migrate();
}

export async function closeTestDatabase(): Promise<void> {
  await closeDb();
}

/**
 * Poll until `read` satisfies `done`, or give up and return the last value so the caller's
 * assertion can say what it actually saw.
 *
 * Some writes are deliberately fire-and-forget: the activity log is telemetry, and a writer's
 * save must not wait on it. That is the right product decision and a trap for tests, because a
 * test that reads the log back immediately is racing the insert — reliably won on an in-process
 * database, lost often enough over a socket to take a CI run down. Polling is the honest way to
 * assert on something the product does not couple to the write path.
 *
 * 20 attempts at 25ms is half a second: long enough for a round trip under load, short enough
 * that a genuine failure is still reported as a failure rather than a timeout.
 */
export async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, attempts = 20): Promise<T> {
  let value = await read();
  for (let index = 0; index < attempts && !done(value); index++) {
    await new Promise(resolve => setTimeout(resolve, 25));
    value = await read();
  }
  return value;
}

/** A `Request` with the given cookie, the way a browser would send it. */
export function requestWithCookie(url: string, token?: string): Request {
  return new Request(url, token ? { headers: { cookie: `asteria-journal=${token}` } } : undefined);
}
