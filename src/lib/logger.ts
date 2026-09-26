import { randomUUID } from "node:crypto";

/**
 * Structured logs, one JSON object per line.
 *
 * Vercel (and every other host) collects stdout, so the only thing that makes a live
 * deployment debuggable is whether the lines are machine-readable. Two rules follow:
 *
 * - **A request id travels with the work.** `withRoute` mints one, `logger.child()` carries
 *   it into every line, and the same id is returned in the `x-request-id` response header,
 *   so a user-reported failure can be found without a timestamp round trip.
 * - **Nothing personal is logged.** Titles and bodies are the writer's private words;
 *   the logger records counts, lengths, ids and durations instead. `redact` is the last
 *   line of defence for values that slip through.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function configuredLevel(): LogLevel {
  const value = (process.env.ASTERIA_LOG_LEVEL ?? "").trim().toLowerCase();
  if (value === "debug" || value === "info" || value === "warn" || value === "error") return value;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

const REDACTED_KEYS = new Set([
  "content",
  "title",
  "body",
  "text",
  "password",
  "token",
  "tokenHash",
  "recoveryKey",
  "recoveryKeyHash",
  "cookie",
  "authorization",
  "databaseUrl",
  "DATABASE_URL",
  "secret",
]);

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth > 4) return "[deep]";
  if (Array.isArray(value)) return value.slice(0, 25).map(item => redact(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEYS.has(key) ? "[redacted]" : redact(item, depth + 1);
  }
  return out;
}

export interface LogFields {
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, fields: LogFields) {
  if (LEVELS[level] < LEVELS[configuredLevel()]) return;
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    msg: message,
    ...(redact(fields) as LogFields),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A logger that adds `fields` to every line it writes. */
  child(fields: LogFields): Logger;
  /** Same logger, with the error's message and stack folded into one line. */
  withError(message: string, error: unknown, fields?: LogFields): void;
}

function makeLogger(base: LogFields): Logger {
  return {
    debug: (message, fields) => emit("debug", message, { ...base, ...fields }),
    info: (message, fields) => emit("info", message, { ...base, ...fields }),
    warn: (message, fields) => emit("warn", message, { ...base, ...fields }),
    error: (message, fields) => emit("error", message, { ...base, ...fields }),
    child: fields => makeLogger({ ...base, ...fields }),
    withError: (message, error, fields) =>
      emit("error", message, {
        ...base,
        ...fields,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack?.split("\n").slice(0, 4).join(" | ") : undefined,
      }),
  };
}

export const logger = makeLogger({ app: "asteria" });

/** A fresh correlation id. Short enough to read aloud from a screen. */
export function newRequestId(): string {
  return randomUUID().slice(0, 8);
}
