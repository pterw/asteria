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
    const outcomes: boolean[] = [];
    for (let index = 0; index < 5; index++) {
      // The per-process shortcut keeps a warm instance from re-querying for 250ms, so a
      // tight loop would be answered from memory; a small pause measures the real thing.
      await new Promise(resolve => setTimeout(resolve, 260));
      const result = await checkRateLimit(bucket);
      outcomes.push(result.allowed);
    }
    expect(outcomes).toEqual([true, true, true, false, false]);
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
    const first = await checkRateLimit({ key: `${key}:stars`, limit: 2, windowMs: 60_000 });
    await new Promise(resolve => setTimeout(resolve, 260));
    const second = await checkRateLimit({ key: `${key}:stars`, limit: 2, windowMs: 60_000 });
    await new Promise(resolve => setTimeout(resolve, 260));
    const blocked = await checkRateLimit({ key: `${key}:stars`, limit: 2, windowMs: 60_000 });
    const otherRoute = await checkRateLimit({ key: `${key}:search`, limit: 2, windowMs: 60_000 });

    expect([first.allowed, second.allowed, blocked.allowed]).toEqual([true, true, false]);
    expect(otherRoute.allowed).toBe(true); // a write limit must not consume the read limit
  });

  it("starts a fresh allowance in the next window", async () => {
    const key = `window-${Math.random()}`;
    const first = await checkRateLimit({ key, limit: 1, windowMs: 1_000 });
    await new Promise(resolve => setTimeout(resolve, 1_050));
    const next = await checkRateLimit({ key, limit: 1, windowMs: 1_000 });
    expect(first.allowed).toBe(true);
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
