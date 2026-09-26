import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDbHandle } from "@/db/index";
import { RATE_LIMITS, checkRateLimit } from "@/lib/ratelimit";
import { closeTestDatabase, freshDatabase, resetSchema, useTestDatabase } from "./helpers";

/**
 * The limiter, against Postgres.
 *
 * The property that matters is not "a counter goes up" — it is that the counter is shared.
 * A limiter held in module scope gives every warm instance of a serverless function its own
 * allowance, which means the real limit is `limit × instances` and nobody notices until a
 * burst arrives. These tests read the row back out of the database to prove the count lives
 * somewhere every instance can see, and then prove the two failure modes are right: a
 * refused request says how long to wait, and a database that cannot answer does not take
 * the product down with it.
 */

/**
 * A stable point in time, 10 seconds into a window.
 *
 * Ten seconds in, the arithmetic below can run for several seconds of "clock" without
 * approaching a boundary, so the test measures the limiter rather than the calendar.
 */
function anchoredNow(windowMs: number): number {
  return Math.floor(Date.now() / windowMs) * windowMs + 10_000;
}

beforeAll(async () => {
  useTestDatabase();
  await freshDatabase();
}, 120_000);

afterAll(async () => {
  await closeTestDatabase();
});

describe("counting requests", () => {
  it("allows up to the limit and then refuses, with a retry hint", async () => {
    const bucket = { key: `client-${Math.random()}`, limit: 3, windowMs: 60_000 };
    // One second apart, which is longer than the per-process shortcut's 250ms, so every call
    // reaches the database. `now` is passed in rather than slept through: this test is about
    // the counter, and a fixed window's boundary is a function of the wall clock, so a test
    // that waits for real seconds to pass is really testing where the minute boundary happened
    // to fall. (It failed once, on exactly that, after a hundred-odd green runs.)
    const start = anchoredNow(60_000);
    const outcomes: boolean[] = [];
    for (let index = 0; index < 5; index++) {
      const result = await checkRateLimit({ ...bucket, now: start + index * 1_000 });
      outcomes.push(result.allowed);
    }
    expect(outcomes).toEqual([true, true, true, false, false]);

    const refused = await checkRateLimit({ ...bucket, now: start + 5_000 });
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("keeps the count in the database, where every instance can see it", async () => {
    const key = `shared-${Math.random()}`;
    await checkRateLimit({ key, limit: 10, windowMs: 60_000 });

    const handle = await getDbHandle();
    const rows = await handle.query<{ bucket: string; count: number }>(
      `select bucket, count from rate_limits where bucket like $1`,
      [`%${key}%`],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].count)).toBe(1);
  });

  it("gives each route its own allowance", async () => {
    const key = `route-${Math.random()}`;
    const start = anchoredNow(60_000);
    const call = (suffix: string, offset: number) =>
      checkRateLimit({ key: `${key}:${suffix}`, limit: 2, windowMs: 60_000, now: start + offset });

    const first = await call("stars", 0);
    const second = await call("stars", 1_000);
    const blocked = await call("stars", 2_000);
    const otherRoute = await call("search", 3_000);

    expect([first.allowed, second.allowed, blocked.allowed]).toEqual([true, true, false]);
    expect(otherRoute.allowed).toBe(true); // a write limit must not consume the read limit
  });

  it("starts a fresh allowance in the next window", async () => {
    const key = `window-${Math.random()}`;
    const windowMs = 1_000;
    const start = anchoredNow(windowMs);
    const first = await checkRateLimit({ key, limit: 1, windowMs, now: start });
    const sameWindow = await checkRateLimit({ key, limit: 1, windowMs, now: start + 500 });
    // One millisecond into the next window: the counter is keyed by the window it started in,
    // so this is a new row and a new allowance.
    const next = await checkRateLimit({ key, limit: 1, windowMs, now: start + windowMs + 1 });
    expect(first.allowed).toBe(true);
    expect(sameWindow.allowed).toBe(false);
    expect(next.allowed).toBe(true);
  });

  it("fails open when the database cannot answer", async () => {
    // A rate limiter is protection, not correctness. If the table is missing, requests
    // proceed and the failure is logged — the alternative is an outage of our own making.
    await resetSchema(); // drops everything, including rate_limits
    const result = await checkRateLimit({ key: `unlucky-${Math.random()}`, limit: 1, windowMs: 60_000 });
    expect(result.allowed).toBe(true);
    await freshDatabase(); // put the schema back for the rest of the suite
  });
});

describe("the configured limits", () => {
  it("are strict where an action is expensive and generous where it is the product", async () => {
    // Writing is the act the product exists for: a writer having a long evening must never
    // be refused. Deleting a journal, importing five hundred moments and exporting are all
    // deliberate acts with small allowances.
    expect(RATE_LIMITS.starWrite.limit).toBeGreaterThanOrEqual(30);
    expect(RATE_LIMITS.import.limit).toBeLessThanOrEqual(10);
    expect(RATE_LIMITS.erase.limit).toBeLessThanOrEqual(5);
    // Guessing a recovery key must be pointless: 125 bits, eight attempts per quarter hour.
    expect(RATE_LIMITS.recovery.limit).toBeLessThanOrEqual(10);
    expect(RATE_LIMITS.recovery.windowMs).toBeGreaterThanOrEqual(60_000);
  });
});
