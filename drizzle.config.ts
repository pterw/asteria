import { defineConfig } from "drizzle-kit";
import "dotenv/config";

/**
 * drizzle-kit reads the same DATABASE_URL the app does (src/db/index.ts), so `push` can
 * never point at a different database than the app connects to.
 *
 * This replaces drizzle.config.json, which hardcoded postgres@127.0.0.1:5432 and therefore
 * silently ignored DATABASE_URL — it kept working only while the port happened to match.
 */
const url = process.env.DATABASE_URL;

if (!url) throw new Error("DATABASE_URL is required — copy .env.example to .env");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: { url },
});
