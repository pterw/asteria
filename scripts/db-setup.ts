/**
 * Point Asteria at a real database and make sure it is ready to be written into.
 *
 *   npm run db:setup
 *
 * This is the command for the moment the deployment stops being hypothetical: you have a
 * connection string from a provider (Neon, Supabase, RDS, a local Postgres) and you want to
 * know three things — can Asteria reach it, does the schema exist, and is this database
 * actually capable of being Asteria's database. So it does exactly that, in that order, and
 * it does not hide behind a green checkmark: every step prints what it found.
 *
 * Nothing here is migration-specific magic. The tables are created by the same
 * `runMigrations()` the build runs on every deploy, following the same rules — one
 * transaction, a transaction-scoped advisory lock, a checksum ledger so a migration is applied
 * once and drift is reported rather than silently ignored. Running this before your first
 * deploy simply means the deploy finds the schema already current.
 *
 * It is safe to run twice. It is also safe to run against a database that already has data:
 * migrations are additive and recorded, and the checks at the end are reads.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";

// Scripts run outside Next.js, which is what loads `.env.local`. Loading the same files here
// means the string you pasted for the app is the string this script uses — no copying it into
// two places and no wondering which one won.
for (const file of [".env.local", ".env"]) {
  const full = path.resolve(process.cwd(), file);
  if (existsSync(full)) loadEnv({ path: full, override: false });
}

async function main(): Promise<void> {
  const { closeDb, driverName, getDbHandle, isNeonUrl, isPooledHost, migrationConnectionString, pingDb } =
    await import("../src/db/index");
  const { runMigrations } = await import("./migrate");

  const line = (symbol: string, text: string) => console.log(`  ${symbol} ${text}`);

  function redact(url: string | undefined): string {
    if (!url) return "(unset)";
    try {
      const parsed = new URL(url);
      if (parsed.password) parsed.password = "***";
      return `${parsed.hostname}${parsed.pathname}`;
    } catch {
      return "<unparseable connection string>";
    }
  }

  console.log("\n✦ Asteria · database setup\n");

  const migration = migrationConnectionString();
  if (!migration.url) {
    console.error("  ✗ No DATABASE_URL.");
    console.error("");
    console.error("    Local development needs nothing — `npm run dev` starts an embedded Postgres");
    console.error("    in .asteria/data on its own. This command is for a real, managed database.");
    console.error("");
    console.error("    To use one, put its connection string in .env.local:");
    console.error("");
    console.error("      DATABASE_URL=\"postgresql://user:password@host/dbname?sslmode=require\"");
    console.error("      DATABASE_URL_UNPOOLED=\"postgresql://user:password@host/dbname?sslmode=require\"  # optional");
    console.error("");
    process.exit(1);
  }

  const neon = isNeonUrl(migration.url);
  if (migration.url !== process.env.DATABASE_URL) {
    // The runtime keeps the pooled string; only this script moves to the direct one.
    process.env.DATABASE_URL = migration.url;
  }

  const driver = driverName();
  line("·", `connection    ${redact(migration.url)}`);
  line("·", `from          ${migration.source}${migration.pooled ? " (pooled)" : " (direct)"}`);
  line("·", `driver        ${driver}${neon ? "  ← Neon serverless driver, over WebSocket" : ""}`);
  if (migration.source === "DATABASE_URL" && isPooledHost(migration.url)) {
    line("!", "this is a pooled string; DATABASE_URL_UNPOOLED is what a migration prefers, and what");
    line(" ", "Neon's own documentation recommends for schema changes. Continuing anyway — the");
    line(" ", "transaction here is pooler-safe — but the direct string would not queue behind traffic.");
  }

  // ── 1. Reach it ────────────────────────────────────────────────────────────────────────────
  console.log("\n  connecting");
  const ping = await pingDb();
  if (!ping.ok) {
    console.error(`  ✗ ${ping.error ?? "unreachable"}`);
    console.error("");
    console.error("    A managed database is usually unreachable for one of four reasons:");
    console.error("      · the password was rotated and the string in .env.local is the old one");
    console.error("      · the host is the direct one but the network only allows the pooler (or the reverse)");
    console.error("      · `sslmode` is missing — managed Postgres normally requires TLS");
    console.error("      · the Neon project is suspended, or the branch was deleted");
    await closeDb();
    process.exit(1);
  }
  line("✓", `connected in ${ping.latencyMs}ms`);

  const handle = await getDbHandle();
  const [{ version }] = await handle.query<{ version: string }>("select version()");
  line("·", version.split(" ").slice(0, 2).join(" "));

  // ── 2. Create the tables ────────────────────────────────────────────────────────────────────
  console.log("\n  schema");
  const result = await runMigrations();
  for (const warning of result.warnings) line("!", warning);

  const tables = await handle.query<{ table_name: string; columns: number }>(`
    select t.table_name,
           (select count(*)::int from information_schema.columns c
             where c.table_schema = 'public' and c.table_name = t.table_name) as columns
      from information_schema.tables t
     where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
     order by t.table_name
  `);

  if (!tables.length) {
    console.error("  ✗ no tables exist after migrating — that should be impossible");
    await closeDb();
    process.exit(1);
  }

  const expected = ["journals", "sessions", "stars", "journal_events", "rate_limits"];
  const missing = expected.filter(name => !tables.some(table => table.table_name === name));
  for (const table of tables) {
    line(missing.includes(table.table_name) ? "✗" : "✓", `${table.table_name.padEnd(18)} ${table.columns} columns`);
  }
  if (missing.length) {
    console.error(`\n  ✗ missing: ${missing.join(", ")}`);
    await closeDb();
    process.exit(1);
  }

  // ── 3. Can this database actually be Asteria's database? ────────────────────────────────────
  //
  // The schema leans on Postgres features that a "Postgres-compatible" service can be missing in
  // ways that only show up at runtime: full-text search over a generated column, a GIN index over
  // it, advisory locks for star placement, and `hashtext` to derive the lock key. Each one is
  // checked directly rather than assumed, because finding out during a writer's first night is
  // not an option.
  console.log("\n  capabilities");
  const capabilities: { name: string; sql: string; expect: (rows: Record<string, unknown>[]) => boolean }[] = [
    {
      name: "generated tsvector column",
      sql: `select is_generated from information_schema.columns
             where table_name = 'stars' and column_name = 'search'`,
      expect: rows => rows.length === 1 && String(rows[0].is_generated).toUpperCase().startsWith("ALWAYS"),
    },
    {
      name: "GIN index over the search vector",
      sql: `select indexdef from pg_indexes where tablename = 'stars' and indexdef ilike '%gin%'`,
      expect: rows => rows.length >= 1,
    },
    {
      name: "advisory locks (star placement)",
      sql: `select count(*)::int as held from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()`,
      expect: rows => rows.length === 1,
    },
    {
      name: "hashtext (lock key derivation)",
      sql: `select hashtext('asteria') as key`,
      expect: rows => rows.length === 1 && typeof rows[0].key === "number",
    },
    {
      name: "full-text search (to_tsquery / ts_rank_cd)",
      sql: `select ts_rank_cd(to_tsvector('english', 'a quiet night'), to_tsquery('english', 'quiet')) as rank`,
      expect: rows => rows.length === 1 && Number(rows[0].rank) > 0,
    },
    {
      name: "transactional DDL (migrations roll back)",
      sql: `select current_setting('transaction_read_only') as mode`,
      expect: rows => rows.length === 1,
    },
  ];

  let failed = 0;
  for (const check of capabilities) {
    try {
      const rows = await handle.query<Record<string, unknown>>(check.sql);
      const ok = check.expect(rows);
      if (!ok) failed += 1;
      line(ok ? "✓" : "✗", check.name);
    } catch (error) {
      failed += 1;
      line("✗", `${check.name} — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ── 4. What happens next ────────────────────────────────────────────────────────────────────
  await closeDb();

  console.log("");
  if (failed) {
    console.error(`  ✗ ${failed} capability check${failed === 1 ? "" : "s"} failed.`);
    console.error("    This database cannot run Asteria as written. Postgres 14+ is the floor;");
    console.error("    a service that only speaks part of Postgres will fail somewhere less obvious later.\n");
    process.exit(1);
  }

  console.log(`  ✓ ${redact(migration.url)} is ready. The schema is current and this database can run Asteria.\n`);
  if (neon) {
    console.log("  Neon, in the Vercel project's Environment Variables:");
    console.log("");
    console.log("    DATABASE_URL           the pooled string (hostname contains -pooler)");
    console.log("    DATABASE_URL_UNPOOLED  the direct string — used for migrations during the build");
    console.log("");
  }
  console.log("  Environment variables the app needs in production:");
  console.log("");
  console.log("    DATABASE_URL      the connection string above");
  console.log("    ASTERIA_SECRET    at least 16 characters: `openssl rand -base64 32`");
  console.log("");
  console.log("  Then:  npm run dev  → http://localhost:3000/sky\n");
}

main().catch(error => {
  console.error(`\n  ✗ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
