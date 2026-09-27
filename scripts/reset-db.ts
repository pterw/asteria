/**
 * Start the local database over.
 *
 *   npm run db:reset            # remove the embedded database directory
 *   npm run db:reset -- --force # also drop and recreate the schema on a server
 *
 * Two guards, both deliberately placed in the way:
 *
 *   `DATABASE_URL` means the database is somewhere else, and this script deletes data. It
 *   refuses to touch a server without `--force`, so a stale connection string in a shell
 *   cannot quietly erase the journal you were about to hand to somebody.
 *
 *   `VERCEL` means this is a build. A deploy step that can drop the schema is a deploy step
 *   someone will eventually run at the wrong moment.
 */
import "dotenv/config";
import { rm } from "node:fs/promises";
import path from "node:path";
import { closeDb, getDbHandle, driverName } from "../src/db/index";

const ROOT = path.resolve(import.meta.dirname, "..");

async function main(): Promise<void> {
  const force = process.argv.includes("--force");

  if (process.env.VERCEL) {
    console.error("✖ refusing to reset a database during a deploy.");
    process.exitCode = 1;
    return;
  }

  if (driverName() === "pglite") {
    const directory = path.resolve(ROOT, process.env.ASTERIA_DB_DIR || ".asteria/data");
    await closeDb().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
    console.log(`✦ removed ${path.relative(ROOT, directory)}`);
    console.log("  run `npm run db:migrate` to build it again");
    return;
  }

  if (!force) {
    console.error("✖ DATABASE_URL points at a server. Re-run with --force if you mean it:");
    console.error("    npm run db:reset -- --force");
    process.exitCode = 1;
    return;
  }

  const handle = await getDbHandle();
  await handle.exec("drop schema public cascade; create schema public;");
  await closeDb();
  console.log("✦ schema dropped and recreated");
  console.log("  run `npm run db:migrate` to build it again");
}

main().catch(error => {
  console.error("✖ reset failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
