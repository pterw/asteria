#!/usr/bin/env node
/**
 * Everything CI checks, in the order a failure is cheapest to fix.
 *
 * The browser suite is deliberately not here: it needs a downloaded Chromium, and a local
 * `npm run verify` that fails because a laptop has no browsers in its cache is a command
 * people stop running. `npm run test:e2e` is one line away, and CI runs it on its own
 * schedule (see `.github/workflows/e2e.yml`).
 *
 * The last step is the one that matters most and is easiest to skip: start the *built* server
 * on a throwaway database and walk the real journeys against it (`smoke:live`). A build that
 * compiles is not a server that works — the difference is usually a schema that never
 * migrated, a cookie the framework will not send, or a header a proxy eats.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = Number(process.env.ASTERIA_VERIFY_PORT ?? 3210);
const ORIGIN = `http://127.0.0.1:${PORT}`;

const steps = [
  ["Types", "npm", ["run", "typecheck"]],
  ["Lint", "npm", ["run", "lint"]],
  ["Contract fixtures are current", "npx", ["tsx", "scripts/emit-contract.ts", "--check"]],
  ["Unit and integration tests", "npx", ["vitest", "run"]],
  ["Insights service tests", "npm", ["run", "test:python"]],
  ["Production build", "npm", ["run", "build"]],
  ["Smoke: the built server, the real journeys", null, null],
];

const env = { ...process.env, ASTERIA_SECRET: process.env.ASTERIA_SECRET || "verify-secret-verify-secret" };

function run(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env,
      shell: process.platform === "win32",
      ...options,
    });
    child.on("close", code => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

/** Poll the health endpoint until the server answers, or give up. */
async function waitForServer(deadlineMs = 30_000) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const response = await fetch(`${ORIGIN}/api/health`);
      if (response.ok || response.status === 503) return true;
    } catch {
      // Not listening yet.
    }
    await sleep(250);
  }
  return false;
}

/**
 * The built server against a database that has never existed.
 *
 * A temporary directory, not `.asteria/data`: the smoke test must prove that migrations create
 * a working schema from nothing, and it must not leave a mark on the sky the developer is
 * writing into.
 */
async function smoke() {
  const directory = mkdtempSync(path.join(tmpdir(), "asteria-verify-"));
  const serverEnv = { ...env, ASTERIA_DB: "pglite", ASTERIA_DB_DIR: directory, ASTERIA_SMOKE_ALLOW_EMBEDDED: "1" };

  // The Python service is optional, and this step must not depend on one being reachable — a
  // gate that fails because of a variable in the developer's shell is a gate people learn to
  // ignore. Unless asked for, boot the smoke server with no service configured, so it exercises
  // the local implementation deliberately. `ASTERIA_VERIFY_INSIGHTS=1 npm run verify` keeps the
  // service in play for someone who is working on it.
  if (process.env.ASTERIA_VERIFY_INSIGHTS !== "1") {
    delete serverEnv.ASTERIA_INSIGHTS_URL;
    delete serverEnv.ASTERIA_INSIGHTS_SECRET;
  }

  const migrate = await new Promise(resolve => {
    const child = spawn("npx", ["tsx", "scripts/migrate.ts"], { stdio: "inherit", env: serverEnv });
    child.on("close", code => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
  if (migrate !== 0) {
    rmSync(directory, { recursive: true, force: true });
    return 1;
  }

  const server = spawn("npx", ["next", "start", "--hostname", "127.0.0.1", "--port", String(PORT)], {
    stdio: ["ignore", "pipe", "inherit"],
    env: serverEnv,
  });
  server.stdout.on("data", () => {}); // Swallow the banner; the checks below are the output.

  try {
    if (!(await waitForServer())) {
      console.error(`\n\u2716 the built server never answered on ${ORIGIN}\n`);
      return 1;
    }
    return await new Promise(resolve => {
      const child = spawn("node", ["scripts/smoke-live.mjs", ORIGIN], { stdio: "inherit", env: serverEnv });
      child.on("close", code => resolve(code ?? 1));
      child.on("error", () => resolve(1));
    });
  } finally {
    server.kill("SIGTERM");
    // `next start` spawns a child; give it a moment to go, then make sure.
    await sleep(500);
    if (server.exitCode === null) server.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
}

let failed = null;
for (const [label, command, args] of steps) {
  process.stdout.write(`\n\u2726 ${label}\n`);
  const code = command ? await run(command, args) : await smoke();
  if (code !== 0) {
    failed = label;
    break;
  }
}

if (failed) {
  console.error(`\n\u2716 ${failed} failed.\n`);
  process.exitCode = 1;
} else {
  console.log("\n\u2713 Everything CI checks passes here too.\n");
}
