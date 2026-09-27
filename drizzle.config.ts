import { defineConfig } from "drizzle-kit";
import "dotenv/config";

/**
 * drizzle-kit reads the same DATABASE_URL the app does (src/db/index.ts), so a
 * migration can never be applied to a different database than the one the
 * application connects to.
 *
 * `generate` is offline by design — it diffs `src/db/schema.ts` against the
 * snapshots in `drizzle/` and writes SQL — so it must not require a connection
 * string. Only `push`, `migrate` and `studio` do, and drizzle-kit itself reports
 * the missing credentials for those.
 */
const url = process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: url ? { url } : undefined,
  strict: true,
  verbose: true,
});
