#!/usr/bin/env node
/**
 * Everything CI checks, in the order a failure is cheapest to fix.
 *
 * The browser suite is deliberately not here: it needs a downloaded Chromium, and a local
 * `npm run verify` that fails because a laptop has no browsers in its cache is a command
 * people stop running. `npm run test:e2e` is one line away, and CI runs it on its own
 * schedule (see `.github/workflows/e2e.yml`).
 */
import { spawn } from "node:child_process";

const steps = [
  ["Types", "npm", ["run", "typecheck"]],
  ["Lint", "npm", ["run", "lint"]],
  ["Contract fixtures are current", "npx", ["tsx", "scripts/emit-contract.ts", "--check"]],
  ["Unit and integration tests", "npx", ["vitest", "run"]],
  ["Insights service tests", "npm", ["run", "test:python"]],
  ["Production build", "npm", ["run", "build"]],
];

const env = { ...process.env, ASTERIA_SECRET: process.env.ASTERIA_SECRET || "verify-secret-verify-secret" };

function run(command, args) {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: "inherit", env, shell: process.platform === "win32" });
    child.on("close", code => resolve(code ?? 1));
  });
}

let failed = null;
for (const [label, command, args] of steps) {
  process.stdout.write(`\n\u2726 ${label}\n`);
  const code = await run(command, args);
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
