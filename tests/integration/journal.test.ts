import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/index";
import {
  clearSamples,
  createStar,
  eraseJournal,
  insertSampleStars,
  journalCounts,
  listStars,
  recentEvents,
  releaseStar,
  updateStar,
} from "@/lib/journal";
import { resolveJournal } from "@/lib/session";
import { generateSessionToken } from "@/lib/session";
import { closeTestDatabase, freshDatabase, useTestDatabase } from "./helpers";
import { constellationPosition } from "@/lib/stars";

/**
 * Writing to the sky, against Postgres.
 *
 * A star's coordinates are a fact about when it was born, not a rendering detail, so the
 * allocation rule is the interesting one: two writers pressing save at the same moment
 * must not be given the same patch of sky, released stars must never have their place
 * reused, and a restored star must come back exactly where it was. Those are the tests
 * that would fail if the advisory lock were removed.
 */

beforeAll(async () => {
  useTestDatabase();
  await freshDatabase();
}, 120_000);

afterAll(async () => {
  await closeTestDatabase();
});

/**
 * A journal with an empty sky.
 *
 * The examples are *deleted* rather than released, because a released row still counts
 * towards a constellation's index — that is the rule that keeps coordinates from being
 * reused. These tests want a journal whose history begins with the stars they write, so
 * they clear the table the way a fresh install would.
 */
async function newJournal(): Promise<string> {
  const context = await resolveJournal({ token: generateSessionToken(), userAgent: "test" });
  const db = await getDb();
  await db.delete(schema.stars).where(eq(schema.stars.journalId, context.journalId));
  expect(await listStars(context.journalId)).toHaveLength(0);
  return context.journalId;
}

/** A journal as a writer first sees it: seeded with the example sky. */
async function newSeededJournal(): Promise<string> {
  const context = await resolveJournal({ token: generateSessionToken(), userAgent: "test" });
  expect((await listStars(context.journalId)).length).toBeGreaterThan(0);
  return context.journalId;
}

const moment = (overrides: Partial<Parameters<typeof createStar>[1]> = {}) => ({
  title: "",
  content: "A moment written during the test run.",
  mood: "serene" as const,
  intensity: 3,
  createdAt: new Date("2026-03-06T22:30:00.000Z"),
  ...overrides,
});

describe("creating a star", () => {
  it("gives it a place in its constellation and returns it immediately", async () => {
    const journalId = await newJournal();
    const star = await createStar(journalId, moment({ mood: "luminous" }));
    expect(star.mood).toBe("luminous");
    expect(star.isSample).toBe(false);
    expect(Number.isFinite(star.x)).toBe(true);
    expect(Number.isFinite(star.y)).toBe(true);
    expect(star.createdAt).toBe("2026-03-06T22:30:00.000Z");
  });

  it("keeps 24 simultaneous writers from landing on the same pixel", async () => {
    const journalId = await newJournal();
    const stars = await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        createStar(journalId, moment({ mood: "electric", content: `Moment number ${index} of the burst.` })),
      ),
    );
    const positions = new Set(stars.map(star => `${star.x}:${star.y}`));
    expect(positions.size).toBe(24);
  });

  it("gives the same moment the same place in a rebuilt sky", async () => {
    // Placement is a function of (mood, index) — never of random state — so a journal
    // rebuilt from an export lands in the same sky as the one it was exported from.
    const original = await newJournal();
    const first = await createStar(original, moment({ mood: "verdant" }));
    const second = await createStar(original, moment({ mood: "verdant" }));

    const rebuilt = await newJournal();
    await createStar(rebuilt, moment({ mood: "verdant" }));
    await createStar(rebuilt, moment({ mood: "verdant" }));

    // Compared as sets of positions: the list comes back newest-first, so the *order* of
    // two stars born in the same millisecond is a tie broken by id, and that is not what
    // this test is about. The places are.
    const places = (list: { x: number; y: number }[]) =>
      list.map(star => [star.x.toFixed(4), star.y.toFixed(4)]).sort();
    expect(places(await listStars(rebuilt))).toEqual(places([first, second]));
    // And they are the documented golden-angle placements, not merely self-consistent.
    const secondPlace = constellationPosition("verdant", 1);
    const placesFromTheRule = places([
      { x: constellationPosition("verdant", 0).x, y: constellationPosition("verdant", 0).y },
      { x: secondPlace.x, y: secondPlace.y },
    ]);
    expect(places([first, second])).toEqual(placesFromTheRule);
  });
});

describe("editing, releasing and restoring", () => {
  it("claims an example the moment it is edited", async () => {
    const journalId = await newSeededJournal();
    const samples = await listStars(journalId);
    const example = samples[0];
    expect(example.isSample).toBe(true);

    const edited = await updateStar(journalId, example.id, { content: "I changed this one." });
    expect(edited.isSample).toBe(false);

    // "Clear the examples" must never take away something the writer has touched.
    const removed = await clearSamples(journalId);
    expect(removed).not.toContain(example.id);
    const remaining = await listStars(journalId);
    expect(remaining.map(star => star.id)).toContain(example.id);
  });

  it("releases softly, so an undo is exact", async () => {
    const journalId = await newJournal();
    const star = await createStar(journalId, moment({ mood: "tender" }));
    await releaseStar(journalId, star.id);

    expect((await listStars(journalId)).map(entry => entry.id)).not.toContain(star.id);
    // The row is still there — which is what makes the undo a real undo rather than a new
    // star that happens to look like the old one.
    const released = await listStars(journalId, { includeReleased: true });
    expect(released.map(entry => entry.id)).toContain(star.id);

    const restored = await updateStar(journalId, star.id, { restore: true });
    expect(restored.id).toBe(star.id);
    expect(restored.x).toBe(star.x);
    expect(restored.y).toBe(star.y);
    expect(restored.content).toBe(star.content);
  });

  it("never reuses the place of a released star", async () => {
    // Coordinates are allocated from the full history, released rows included. If they were
    // not, releasing the newest star and writing a new one would stack two moments on one
    // point — and a writer would lose a light they had already found.
    const journalId = await newJournal();
    const first = await createStar(journalId, moment({ mood: "vesper" }));
    await releaseStar(journalId, first.id);
    const second = await createStar(journalId, moment({ mood: "vesper" }));
    expect([second.x, second.y]).not.toEqual([first.x, first.y]);
  });

  it("refuses to touch a star in someone else's sky", async () => {
    const mine = await newJournal();
    const theirs = await newJournal();
    const star = await createStar(theirs, moment());

    await expect(updateStar(mine, star.id, { favorite: true })).rejects.toMatchObject({ status: 404 });
    await expect(releaseStar(mine, star.id)).rejects.toMatchObject({ status: 404 });
    // And the star really is untouched.
    const [row] = await (await getDb()).select().from(schema.stars).where(eq(schema.stars.id, star.id));
    expect(row.favorite).toBe(false);
    expect(row.deletedAt).toBeNull();
  });

  it("counts a released star as released, not as gone", async () => {
    const journalId = await newJournal();
    const before = await journalCounts(journalId);
    const star = await createStar(journalId, moment());
    await releaseStar(journalId, star.id);
    const after = await journalCounts(journalId);
    expect(after.moments).toBe(before.moments);
    expect(after.released).toBe(1);
  });
});

describe("example skies", () => {
  it("seeds once, however many times the journal is opened", async () => {
    const token = generateSessionToken();
    const context = await resolveJournal({ token, userAgent: "test" });
    const first = await listStars(context.journalId);
    expect(first.length).toBeGreaterThan(0);

    // Opening it again — and again — must not add a second example sky.
    const again = await resolveJournal({ token, userAgent: "test" });
    expect(again.journalId).toBe(context.journalId);
    expect(again.seeded).toBe(false);
    await resolveJournal({ token, userAgent: "test" });
    expect((await listStars(context.journalId)).length).toBe(first.length);

    // `insertSampleStars` is the raw insert the seed path calls; it is deliberately not
    // idempotent, because idempotence belongs to `ensureSeeded`, which decides *whether* to
    // seed. What matters is that opening a journal cannot reach it twice.
    expect(await insertSampleStars(context.journalId)).toBe(first.length);
    expect((await listStars(context.journalId)).length).toBe(first.length * 2);
  });

  it("clears only what the writer never made their own", async () => {
    const journalId = await newSeededJournal();
    const samples = await listStars(journalId);
    const claimed = samples[0];
    // Starring is a claim, not just a flag: an example the writer kept must survive the
    // example sky being cleared.
    await updateStar(journalId, claimed.id, { favorite: true });

    const removed = await clearSamples(journalId);
    expect(removed).not.toContain(claimed.id);
    const left = await listStars(journalId);
    expect(left.map(star => star.id)).toEqual([claimed.id]);
  });
});

describe("the event log", () => {
  it("records what happened, without recording what was written", async () => {
    const journalId = await newJournal();
    const star = await createStar(journalId, moment({ content: "Private words, 420 characters of them." }));
    await updateStar(journalId, star.id, { favorite: true });
    await releaseStar(journalId, star.id);
    await updateStar(journalId, star.id, { restore: true });

    const events = await recentEvents(journalId);
    const kinds = events.map(event => event.kind);
    expect(kinds).toContain("star.starred");
    expect(kinds).toContain("star.released");
    expect(kinds).toContain("star.restored");

    // The log is metadata: ids and kinds, never the writing itself.
    for (const event of events) {
      expect(JSON.stringify(event)).not.toContain("Private words");
      expect(JSON.stringify(event.meta ?? {})).not.toContain("Private words");
    }
  });
});

describe("erasing a journal", () => {
  it("takes everything with it, through the cascades", async () => {
    const journalId = await newJournal();
    await createStar(journalId, moment());
    await eraseJournal(journalId);

    const db = await getDb();
    expect(await db.select().from(schema.stars).where(eq(schema.stars.journalId, journalId))).toHaveLength(0);
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.journalId, journalId))).toHaveLength(0);
    expect(await db.select().from(schema.journals).where(eq(schema.journals.id, journalId))).toHaveLength(0);
  });
});
