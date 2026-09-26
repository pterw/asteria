import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Unit and integration tests.
 *
 * `tests/*.spec.ts` belongs to Playwright and is deliberately excluded: two runners
 * matching the same files is the classic way to get "my tests pass" and "my tests fail"
 * in the same afternoon. Vitest owns everything under `tests/unit` and `tests/integration`;
 * Playwright owns `tests/*.spec.ts` and drives a real server.
 *
 * Integration tests touch an embedded database (PGlite) on a temporary directory, so they
 * run in forked processes: one file's migrations cannot leak into another's.
 *
 * Pointed at a real server instead (`ASTERIA_TEST_DATABASE_URL`, as CI does), all of those
 * files share one database, and a file that drops the schema mid-run would pull the rug out
 * from under its neighbours — so they take turns instead of running in parallel.
 */
const sharedServer = Boolean(process.env.ASTERIA_TEST_DATABASE_URL);

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    // Serialised when the files share one server. Vitest 4 removed `poolOptions`, and the old
    // `poolOptions.forks.singleFork` spelling was silently ignored after that — this is the
    // top-level equivalent, and it is why these options are not nested any more.
    ...(sharedServer ? { fileParallelism: false, maxWorkers: 1, minWorkers: 1 } : {}),
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // `dot` keeps CI output readable; `github-actions` turns each failure into an annotation
    // on the commit, where a reader can see what broke without opening the raw log.
    reporters: process.env.CI ? ["dot", "github-actions"] : ["default"],
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
});
