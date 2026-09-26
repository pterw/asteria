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
 */
import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { closeDb, getDbHandle } from "../src/db/index";

const ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "drizzle");
const LEGACY_FILE = path.join(MIGRATIONS_DIR, "legacy", "0001_adopt_v1.sql");

/** A fixed key: the lock only has to be unique within this application. */
const LOCK_KEY = 8_577_412_003;

const dryRun = process.argv.includes("--dry");

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

async function main() {
  const handle = await getDbHandle();
  console.log(`\n✦ Asteria migrations · driver=${handle.driver} · ${handle.describe()}\n`);

  await handle.exec(`
    create table if not exists asteria_migrations (
      id text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    );
  `);

  await handle.exec(`select pg_advisory_lock(${LOCK_KEY});`);
  try {
    const applied = await handle.query<{ id: string; checksum: string }>(
      `select id, checksum from asteria_migrations order by id`,
    );
    const appliedIds = new Set(applied.map(row => row.id));

    // Was this database built by `drizzle-kit push` before migrations existed?
    const [{ legacy }] = await handle.query<{ legacy: boolean }>(`
      select (exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'journals')
           and not exists (select 1 from asteria_migrations)) as legacy
    `);

    if (legacy && !appliedIds.has("0000_init.sql")) {
      const sqlText = await readFile(LEGACY_FILE, "utf8");
      console.log("  ⚠ existing v1 schema detected — adopting it in place (additive, no data loss)");
      if (dryRun) {
        console.log(`  would run ${path.relative(ROOT, LEGACY_FILE)}`);
      } else {
        await handle.exec(sqlText);
        await handle.query(`insert into asteria_migrations (id, checksum) values ($1, $2) on conflict do nothing`, [
          "0000_init.sql",
          checksum(sqlText),
        ]);
        appliedIds.add("0000_init.sql");
        console.log("  ✓ adopted · v1 data preserved, v2 columns/indexes/constraints in place");
      }
    }

    const pending = (await migrationFiles()).filter(file => !appliedIds.has(file.id));
    if (!pending.length) {
      console.log("  ✓ nothing to do — schema is current\n");
      return;
    }

    for (const migration of pending) {
      const sqlText = await readFile(migration.file, "utf8");
      if (dryRun) {
        console.log(`  would apply ${migration.id} (${sqlText.length} bytes)`);
        continue;
      }
      const started = Date.now();
      await handle.exec(sqlText);
      await handle.query(
        `insert into asteria_migrations (id, checksum) values ($1, $2) on conflict (id) do update set checksum = excluded.checksum`,
        [migration.id, checksum(sqlText)],
      );
      console.log(`  ✓ applied ${migration.id} in ${Date.now() - started}ms`);
    }

    // Drift check: a migration file edited after it was applied means the database and
    // the repository disagree. Warn loudly rather than silently diverging.
    for (const row of applied) {
      const file = (await migrationFiles()).find(candidate => candidate.id === row.id);
      if (!file) continue;
      const text = await readFile(file.file, "utf8");
      if (checksum(text) !== row.checksum) {
        console.warn(`  ⚠ ${row.id} has changed since it was applied (checksum mismatch)`);
      }
    }

    console.log("\n  ✦ schema is current\n");
  } finally {
    await handle.exec(`select pg_advisory_unlock(${LOCK_KEY});`);
    if (handle.driver === "pglite") await closeDb();
  }
}

main().catch(error => {
  console.error("\n✖ migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
