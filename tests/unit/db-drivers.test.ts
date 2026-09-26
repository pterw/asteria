import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * How the database driver is chosen, and what that choice means for a deployment.
 *
 * This is worth testing rather than eyeballing because every branch here is a production
 * failure mode with no local symptom. Pick the embedded driver on a serverless host and each
 * instance silently keeps its own database. Pick Neon's HTTP transport and transactions stop
 * working, which means star placement and migrations stop working. Run a migration through the
 * pooler when a direct string was available and it queues behind application traffic.
 *
 * The Neon handle is *constructed* here too — not because a test should hold a real connection,
 * but because construction is where a driver choice stops being a string and starts being a
 * class: `drizzle-orm/neon-serverless` must load, the pool must accept the options object the
 * `pg` path uses, and `describe()` must redact the password. No query is issued, so this runs
 * offline.
 */

const NEON_POOLED = "postgresql://user:secret@ep-cool-rain-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const NEON_DIRECT = "postgresql://user:secret@ep-cool-rain-123456.us-east-2.aws.neon.tech/neondb?sslmode=require";
const PLAIN = "postgresql://postgres:postgres@localhost:5432/asteria";

const ENV_KEYS = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
  "ASTERIA_DB",
  "ASTERIA_DB_DIR",
  "VERCEL",
  "NODE_ENV",
] as const;

const saved = new Map<string, string | undefined>(ENV_KEYS.map(key => [key, process.env[key]]));

function resetEnv(overrides: Record<string, string | undefined> = {}) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) process.env[key] = value;
  }
}

/** The module caches its handle on `globalThis`, so a fresh import is required per scenario. */
async function freshDbModule() {
  vi.resetModules();
  return import("@/db/index");
}

afterEach(async () => {
  const db = await freshDbModule();
  await db.closeDb().catch(() => undefined);
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("driver resolution", () => {
  it("uses Neon's driver for a Neon hostname", async () => {
    resetEnv({ DATABASE_URL: NEON_POOLED });
    const { driverName } = await freshDbModule();
    expect(driverName()).toBe("neon");
  });

  it("uses Neon's driver for a Neon direct hostname too", async () => {
    resetEnv({ DATABASE_URL: NEON_DIRECT });
    const { driverName } = await freshDbModule();
    expect(driverName()).toBe("neon");
  });

  it("uses node-postgres for anything else", async () => {
    resetEnv({ DATABASE_URL: PLAIN });
    const { driverName } = await freshDbModule();
    expect(driverName()).toBe("postgres");
  });

  it("uses the embedded database when there is no connection string", async () => {
    resetEnv({ ASTERIA_DB_DIR: ".asteria/unit-test" });
    const { driverName } = await freshDbModule();
    expect(driverName()).toBe("pglite");
  });

  it("lets an explicit setting win over a connection string", async () => {
    resetEnv({ DATABASE_URL: NEON_POOLED, ASTERIA_DB: "pglite", ASTERIA_DB_DIR: ".asteria/unit-test" });
    const { driverName } = await freshDbModule();
    expect(driverName()).toBe("pglite");
  });

  it("refuses to run the embedded driver on Vercel without a database", async () => {
    resetEnv({ VERCEL: "1" });
    const { driverName } = await freshDbModule();
    expect(() => driverName()).toThrow(/Vercel without DATABASE_URL/);
  });

  it("honours a deliberate embedded demo deployment on Vercel", async () => {
    resetEnv({ VERCEL: "1", ASTERIA_DB: "pglite", ASTERIA_DB_DIR: ".asteria/unit-test" });
    const { driverName } = await freshDbModule();
    expect(driverName()).toBe("pglite");
  });
});

describe("connection string classification", () => {
  it("recognises Neon and its pooler", async () => {
    resetEnv({});
    const { isNeonUrl, isPooledHost } = await freshDbModule();
    expect(isNeonUrl(NEON_POOLED)).toBe(true);
    expect(isNeonUrl(NEON_DIRECT)).toBe(true);
    expect(isNeonUrl(PLAIN)).toBe(false);
    expect(isPooledHost(NEON_POOLED)).toBe(true);
    expect(isPooledHost(NEON_DIRECT)).toBe(false);
  });

  it("survives a connection string that is not a URL", async () => {
    resetEnv({});
    const { isNeonUrl, isPooledHost } = await freshDbModule();
    expect(isNeonUrl("not a url at all")).toBe(false);
    expect(isPooledHost("not a url at all")).toBe(false);
  });

  it("prefers the direct string for migrations, and says which one it used", async () => {
    resetEnv({ DATABASE_URL: NEON_POOLED, DATABASE_URL_UNPOOLED: NEON_DIRECT });
    const { migrationConnectionString } = await freshDbModule();
    expect(migrationConnectionString()).toEqual({ url: NEON_DIRECT, pooled: false, source: "DATABASE_URL_UNPOOLED" });
  });

  it("accepts the integration's spelling of the direct string", async () => {
    resetEnv({ DATABASE_URL: NEON_POOLED, POSTGRES_URL_NON_POOLING: NEON_DIRECT });
    const { migrationConnectionString } = await freshDbModule();
    expect(migrationConnectionString().url).toBe(NEON_DIRECT);
  });

  it("falls back to the pooled string, and reports that it is pooled", async () => {
    resetEnv({ DATABASE_URL: NEON_POOLED });
    const { migrationConnectionString } = await freshDbModule();
    expect(migrationConnectionString()).toMatchObject({ url: NEON_POOLED, pooled: true, source: "DATABASE_URL" });
  });

  it("has nothing to say when nothing is configured", async () => {
    resetEnv({});
    const { migrationConnectionString } = await freshDbModule();
    expect(migrationConnectionString()).toEqual({ url: undefined, pooled: false, source: "none" });
  });
});

describe("the Neon handle", () => {
  it("constructs without connecting, and keeps the password out of its description", async () => {
    resetEnv({ DATABASE_URL: NEON_POOLED, NODE_ENV: "production", POSTGRES_POOL_MAX: "2" });
    const { getDbHandle } = await freshDbModule();

    // No network access happens here: the pool is lazy, and Drizzle only wraps it. If this ever
    // starts needing a live database, the driver choice has become a startup dependency and
    // every cold request pays for it.
    const handle = await getDbHandle();
    expect(handle.driver).toBe("neon");
    expect(handle.describe()).toContain("neon.tech");
    expect(handle.describe()).toContain("-pooler");
    expect(handle.describe()).not.toContain("secret");
    expect(handle.describe()).toContain("***");
  });
});
