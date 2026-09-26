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
 * Each test file gets its own directory, and each `freshDatabase()` call drops the schema
 * and replays the migrations, so files cannot see each other's data.
 */

export const TEST_SECRET = "integration-test-secret-long-enough";

/** Point this process at a throwaway embedded database and make sure nothing leaks out. */
export function useTestDatabase(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "asteria-test-"));
  process.env.ASTERIA_DB = "pglite";
  process.env.ASTERIA_DB_DIR = directory;
  process.env.ASTERIA_SECRET = TEST_SECRET;
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

/** A `Request` with the given cookie, the way a browser would send it. */
export function requestWithCookie(url: string, token?: string): Request {
  return new Request(url, token ? { headers: { cookie: `asteria-journal=${token}` } } : undefined);
}
