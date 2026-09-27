#!/usr/bin/env node
/**
 * Run the integration suite through the **production driver**, without a database server.
 *
 * CI does this against a real `postgres:17` service, and that run is the only place the `pg`
 * driver is exercised — which is exactly how a `count(*)` returning `string` instead of `number`
 * reached a deploy while every local test passed. Until now, reproducing that job locally meant
 * installing Postgres or Docker, so in practice nobody did it; the gap between "the tests pass"
 * and "this will survive being deployed" stayed open.
 *
 * PGlite is Postgres compiled to WebAssembly, and it can serve the ordinary Postgres wire
 * protocol on a socket. So: start PGlite as a server, point `ASTERIA_TEST_DATABASE_URL` at it,
 * and the suite runs through `pg`, a real pool, real sockets, real protocol — on a laptop with
 * nothing installed.
 *
 *   npm run test:integration:pg
 *
 * Caveats worth knowing, because this is a reviewer's tool and not a substitute for CI:
 *   · It is still PGlite's Postgres, not the version your provider runs.
 *   · One connection at a time by default, so it exercises the driver, not concurrency.
 *   · CI remains the authority: `postgres:17` with a real pool.
 */
import { spawn } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const PORT = Number(process.env.ASTERIA_PG_TEST_PORT ?? 5433);
const URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`;

console.log(`\n✦ Integration suite through the pg driver (PGlite serving on :${PORT})\n`);

// In-memory: no directory to clean up, and a fresh database every run by construction.
const db = new PGlite();
await db.waitReady;

const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1", maxConnections: 20 });
await server.start();

const code = await new Promise(resolve => {
  const child = spawn("npx", ["vitest", "run", "tests/integration", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: {
      ...process.env,
      // Deliberately not `DATABASE_URL`: the suite drops the schema, and no stray variable
      // should be able to delete somebody's sky. Same rule the suite itself follows.
      ASTERIA_TEST_DATABASE_URL: URL,
      // Not a Neon host, so the driver under test is `pg` — the point of the exercise.
      ASTERIA_DB: "postgres",
      ASTERIA_SECRET: process.env.ASTERIA_SECRET || "pg-driver-suite-secret-long-enough",
    },
    shell: process.platform === "win32",
  });
  child.on("close", value => resolve(value ?? 1));
  child.on("error", () => resolve(1));
});

await server.stop();
await db.close();

console.log(code === 0 ? "\n  ✓ the suite passes through the production driver too\n" : "\n  ✖ failed through the pg driver — this is the class of bug CI exists to catch\n");
process.exit(code);
