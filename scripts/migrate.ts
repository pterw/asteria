/**
 * Database migrations.
 *
 * `drizzle/0000_init.sql` is the canonical schema, generated from `src/db/schema.ts`.
 * This runner applies it — on node-postgres or on embedded PGlite, the same SQL —
 * once per database, under an advisory lock so two deploy lambdas cannot race.
 *
 * It also handles the awkward case: a database that already exists in the v1 shape,
 * created by `drizzle-kit push` before migrations existed. That database has data in
 * it (anyone who has used the deployed build), and `create table` would simply fail.
 * `drizzle/legacy/0001_adopt_v1.sql` brings it to the v2 shape additively and
 * idempotently; `npm test` asserts that the adopted schema and a fresh one agree.
 *
 *   npm run db:migrate            # apply everything pending
 *   npm run db:migrate -- --dry   # list what would run
 *
 * `runMigrations()` is exported so the test suite can drive the *real* runner against an
 * embedded database rather than re-implementing it in a test: a migration path that is
 * only exercised when a human types a command is a migration path that is not tested.
 *
 * Neon publishes two strings for one database: a pooled one for application traffic and a
 * direct one for anything that wants session state. Migrations prefer the direct one when it is
 * present — see `migrationConnectionString()` — so a deploy does not have to hold a pooler slot
 * while it creates a table.
 */
import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { closeDb, getDbHandle, migrationConnectionString } from "../src/db/index";

const ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "drizzle");
const LEGACY_FILE = path.join(MIGRATIONS_DIR, "legacy", "0001_adopt_v1.sql");

/** A fixed key: the lock only has to be unique within this application. */
const LOCK_KEY = 8_577_412_003;

export interface MigrationResult {
  driver: string;
  applied: string[];
  adopted: boolean;
  current: boolean;
  warnings: string[];
}

export interface MigrationOptions {
  dryRun?: boolean;
  /** Collects the lines the CLI would print, so tests can assert on them. */
  log?: (line: string) => void;
}

function checksum(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

async function migrationFiles(): Promise<{ id: string; file: string }[]> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith(".sql"))
    .map(entry => ({ id: entry.name, file: path.join(MIGRATIONS_DIR, entry.name) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function runMigrations(options: MigrationOptions = {}): Promise<MigrationResult> {
  const dryRun = options.dryRun ?? false;
  const say = options.log ?? ((line: string) => console.log(line));
  const result: MigrationResult = { driver: "", applied: [], adopted: false, current: false, warnings: [] };

  // Prefer the direct connection where the platform provides one. This has to happen before
  // the handle is created, because the handle caches its driver on first use — and it is
  // deliberately skipped when the embedded driver has been forced, because then the connection
  // strings in the environment are somebody else's business entirely (a test harness, or a
  // shell that happens to export a production URL).
  const embedded = /^(pglite|embedded)$/i.test(process.env.ASTERIA_DB?.trim() ?? "");
  const migration = embedded ? { url: undefined, pooled: false, source: "none" as const } : migrationConnectionString();
  if (migration.url && migration.url !== process.env.DATABASE_URL) {
    process.env.DATABASE_URL = migration.url;
    // Deliberately not setting `ASTERIA_DB`: the driver is still resolved from the URL, so a
    // Neon database migrates over Neon's own driver and a plain one over `pg`.
    if (!options.log) say(`  · using ${migration.source} for the migration (the direct connection)`);
  } else if (migration.url && migration.pooled) {
    result.warnings.push("migrating through a pooled connection; DATABASE_URL_UNPOOLED would avoid the pooler");
  }

  const handle = await getDbHandle();
  result.driver = handle.driver;
  say(`\n✦ Asteria migrations · driver=${handle.driver} · ${handle.describe()}\n`);

  // Everything happens in one transaction, for two reasons that are both about production:
  //
  //   1. The lock is `pg_advisory_xact_lock`, not `pg_advisory_lock`. A session-level lock is
  //      meaningless through a transaction-mode pooler (Neon, Supabase, PgBouncer), because
  //      two statements may run on two different server connections — the lock would be held
  //      on a connection nobody is using and the unlock could land somewhere else entirely.
  //      A transaction-scoped lock is guaranteed to live on the one connection the
  //      transaction holds, pooled or not.
  //   2. A migration that fails halfway leaves the database untouched rather than in a shape
  //      no migration file describes. Postgres supports transactional DDL, so this is free.
  //
  // A dry run does the work and rolls it back, so "what would run" is answered by actually
  // running it.
  return handle.transaction(
    async tx => {
    await tx.exec(`select pg_advisory_xact_lock(${LOCK_KEY});`);
    await tx.exec(`
      create table if not exists asteria_migrations (
        id text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      );
    `);
    const applied = await tx.query<{ id: string; checksum: string }>(
      `select id, checksum from asteria_migrations order by id`,
    );
    const appliedIds = new Set(applied.map(row => row.id));

    // Was this database built by `drizzle-kit push` before migrations existed?
    const [{ legacy }] = await tx.query<{ legacy: boolean }>(`
      select (exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'journals')
           and not exists (select 1 from asteria_migrations)) as legacy
    `);

    if (legacy && !appliedIds.has("0000_init.sql")) {
      const sqlText = await readFile(LEGACY_FILE, "utf8");
      say("  ⚠ existing v1 schema detected — adopting it in place (additive, no data loss)");
      result.adopted = true;
      if (dryRun) {
        say(`  would run ${path.relative(ROOT, LEGACY_FILE)}`);
      } else {
        await tx.exec(sqlText);
        await tx.query(`insert into asteria_migrations (id, checksum) values ($1, $2) on conflict do nothing`, [
          "0000_init.sql",
          checksum(sqlText),
        ]);
        appliedIds.add("0000_init.sql");
        result.applied.push("0000_init.sql (adopted from v1)");
        say("  ✓ adopted · v1 data preserved, v2 columns/indexes/constraints in place");
      }
    }

    const pending = (await migrationFiles()).filter(file => !appliedIds.has(file.id));
    if (!pending.length) {
      say("  ✓ nothing to do — schema is current\n");
      result.current = true;
      return result;
    }

    for (const migration of pending) {
      const sqlText = await readFile(migration.file, "utf8");
      if (dryRun) {
        say(`  would apply ${migration.id} (${sqlText.length} bytes)`);
        continue;
      }
      const started = Date.now();
      await tx.exec(sqlText);
      await tx.query(
        `insert into asteria_migrations (id, checksum) values ($1, $2) on conflict (id) do update set checksum = excluded.checksum`,
        [migration.id, checksum(sqlText)],
      );
      result.applied.push(migration.id);
      say(`  ✓ applied ${migration.id} in ${Date.now() - started}ms`);
    }

    // Drift check: a migration file edited after it was applied means the database and
    // the repository disagree. Warn loudly rather than silently diverging.
    for (const row of applied) {
      const file = (await migrationFiles()).find(candidate => candidate.id === row.id);
      if (!file) continue;
      const text = await readFile(file.file, "utf8");
      if (checksum(text) !== row.checksum) {
        result.warnings.push(`${row.id} has changed since it was applied (checksum mismatch)`);
        say(`  ⚠ ${row.id} has changed since it was applied (checksum mismatch)`);
      }
    }

    say("\n  ✦ schema is current\n");
    result.current = true;
    return result;
    },
    { rollback: dryRun },
  );
}

/**
 * On Vercel the build is the only moment we control before traffic arrives, so it is the
 * right place to migrate — but only against a *real* database. If `DATABASE_URL` is missing
 * there, the embedded driver would happily migrate a throwaway file inside the build
 * container, the deploy would go green, and every request would then 500 on a schema that
 * does not exist in the database the functions actually reach. That is the worst possible
 * outcome: a build that lies. Refuse instead, with a message that says what to set.
 */
function deploymentCheck(): string | null {
  if (!process.env.VERCEL) return null;
  if (process.env.DATABASE_URL) return null;
  return [
    "",
    "  ✖ This build is running on Vercel with no DATABASE_URL.",
    "",
    "    Asteria needs a Postgres connection string in production. Add one in",
    "    Vercel → Project → Settings → Environment Variables (any managed Postgres;",
    "    keep the pooler host), then redeploy:",
    "",
    "      DATABASE_URL=postgresql://user:pass@host/asteria?sslmode=require",
    "",
    "    Migrations run as part of `npm run vercel-build`, so the schema follows the deploy.",
    "",
  ].join("\n");
}

/** Only the CLI closes the handle: a test process decides for itself when it is done. */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const refusal = deploymentCheck();
  if (refusal) {
    console.error(refusal);
    process.exitCode = 1;
  } else {
    runMigrations({ dryRun: process.argv.includes("--dry") })
      .then(result => {
        if (result.driver === "pglite") return closeDb();
        return undefined;
      })
      .catch(error => {
        console.error("\n✖ migration failed:", error instanceof Error ? error.message : error);
        process.exitCode = 1;
      });
  }
}
