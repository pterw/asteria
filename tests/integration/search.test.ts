import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/index";
import { createStar, releaseStar, updateStar } from "@/lib/journal";
import { searchStars, toPrefixQuery } from "@/lib/search";
import { generateSessionToken, resolveJournal } from "@/lib/session";
import { closeTestDatabase, freshDatabase, useTestDatabase } from "./helpers";

/**
 * The search box, against Postgres.
 *
 * Search is where a journal stops being a list and becomes something a writer can ask
 * questions of, so the tests cover the two ways it usually disappoints: it does not find
 * what is there (a prefix, an apostrophe, a two-letter word), or it finds what is not
 * (another journal's writing, a released star, an example the writer cleared).
 */

const NOW = new Date("2026-03-25T18:00:00.000Z");

beforeAll(async () => {
  useTestDatabase();
  await freshDatabase();
}, 120_000);

afterAll(async () => {
  await closeTestDatabase();
});

async function journalWith(contents: { title?: string; content: string; mood?: "serene" | "tender" | "luminous"; intensity?: number; favorite?: boolean; createdAt?: string }[]) {
  const context = await resolveJournal({ token: generateSessionToken(), userAgent: "test" });
  const db = await getDb();
  await db.delete(schema.stars).where(eq(schema.stars.journalId, context.journalId));
  const stars = [];
  for (const entry of contents) {
    const created = await createStar(context.journalId, {
      title: entry.title ?? "",
      content: entry.content,
      mood: entry.mood ?? "serene",
      intensity: entry.intensity ?? 3,
      createdAt: entry.createdAt ? new Date(entry.createdAt) : new Date("2026-03-20T22:00:00.000Z"),
    });
    stars.push(entry.favorite ? await updateStar(context.journalId, created.id, { favorite: true }) : created);
  }
  return { journalId: context.journalId, stars };
}

describe("finding words", () => {
  it("finds a word in the body and one in the title", async () => {
    const { journalId } = await journalWith([
      { title: "The long way home", content: "The street smelled of wet stone after the rain." },
      { title: "Kitchen light", content: "I stood in the rectangle of sun for longer than I needed to." },
    ]);

    const rain = await searchStars(journalId, { q: "rain", limit: 60, offset: 0 }, NOW);
    expect(rain.total).toBe(1);
    expect(rain.stars[0].title).toBe("The long way home");

    const kitchen = await searchStars(journalId, { q: "kitchen", limit: 60, offset: 0 }, NOW);
    expect(kitchen.total).toBe(1);
    expect(kitchen.stars[0].title).toBe("Kitchen light");
  });

  it("answers on the first keystrokes, from the prefix index", async () => {
    const { journalId } = await journalWith([
      { content: "The street smelled of wet stone after the rain." },
      { content: "Someone was playing the piano badly, beautifully." },
    ]);

    const partial = await searchStars(journalId, { q: "smel", limit: 60, offset: 0 }, NOW);
    expect(partial.total).toBe(1);
    expect(partial.prefixFallback).toBe(false); // the index did the work

    // Two characters cannot be stemmed, so they fall back to a substring match: a search
    // box that looks broken for the first two keystrokes is worse than an index scan.
    const twoLetters = await searchStars(journalId, { q: "pi", limit: 60, offset: 0 }, NOW);
    expect(twoLetters.prefixFallback).toBe(true);
    expect(twoLetters.total).toBe(1);
  });

  it("finds words across a line break, and survives punctuation", async () => {
    const { journalId } = await journalWith([
      { content: "A walk after rain.\nThe dog disagreed with the plan." },
      { content: "Nothing to do with the others." },
    ]);

    expect((await searchStars(journalId, { q: "walk", limit: 60, offset: 0 }, NOW)).total).toBe(1);
    // Apostrophes, quotes and operators are stripped rather than handed to `to_tsquery`,
    // which would raise a syntax error on `don't`, `&` or `!`.
    for (const query of ["don't", "plan & dog", "walk | rain", "!!!", "  "]) {
      await expect(searchStars(journalId, { q: query, limit: 60, offset: 0 }, NOW)).resolves.toBeTruthy();
    }
    expect(toPrefixQuery("  !!!  ")).toBeNull();
    expect(toPrefixQuery("the rain")).toBe("the:* & rain:*");
  });

  it("never crosses journals", async () => {
    const mine = await journalWith([{ content: "This is my own private sentence." }]);
    const theirs = await journalWith([{ content: "A different journal entirely." }]);
    const found = await searchStars(mine.journalId, { q: "private", limit: 60, offset: 0 }, NOW);
    expect(found.total).toBe(1);
    const leaked = await searchStars(theirs.journalId, { q: "private", limit: 60, offset: 0 }, NOW);
    expect(leaked.total).toBe(0);
  });

  it("leaves out what the writer removed", async () => {
    const { journalId, stars } = await journalWith([
      { content: "Keep this one about the harbour." },
      { content: "Release this one about the harbour too." },
    ]);
    const released = stars.find(star => star.content.startsWith("Release"));
    await releaseStar(journalId, released!.id);

    const found = await searchStars(journalId, { q: "harbour", limit: 60, offset: 0 }, NOW);
    expect(found.total).toBe(1);
    expect(found.stars[0].content).toContain("Keep");
  });

  it("includes the example sky by default, and can be told not to", async () => {
    // Matching the interface, which filters a list that still contains the examples: a
    // writer who has not cleared them yet sees them in results.
    const context = await resolveJournal({ token: generateSessionToken(), userAgent: "test" });
    const withExamples = await searchStars(context.journalId, { q: "", limit: 60, offset: 0 }, NOW);
    expect(withExamples.facets.examples).toBeGreaterThan(0);

    const ownWordsOnly = await searchStars(context.journalId, { q: "", includeSamples: "false", limit: 60, offset: 0 }, NOW);
    expect(ownWordsOnly.facets.examples).toBe(0);
    expect(ownWordsOnly.total).toBe(0);
  });
});

describe("filtering and facets", () => {
  it("reports counts over the whole match, not just the page", async () => {
    const { journalId } = await journalWith([
      { content: "Rain on the window, one.", mood: "serene" },
      { content: "Rain on the window, two.", mood: "tender", favorite: true },
      { content: "Rain on the window, three.", mood: "tender" },
      { content: "Something else entirely.", mood: "luminous" },
    ]);

    const page = await searchStars(journalId, { q: "rain", limit: 2, offset: 0 }, NOW);
    expect(page.stars).toHaveLength(2);
    expect(page.total).toBe(3);
    // The facets describe all three matches, so a writer can see there is more to narrow by.
    expect(page.facets.moods.tender).toBe(2);
    expect(page.facets.moods.serene).toBe(1);
    expect(page.facets.moods.luminous).toBe(0);
    expect(page.facets.starred).toBe(1);
    expect(page.facets.nights).toBe(1);
  });

  it("pages without repeating or losing a moment", async () => {
    const { journalId } = await journalWith(
      Array.from({ length: 7 }, (_, index) => ({
        content: `A numbered thought, number ${index}.`,
        createdAt: `2026-03-${String(index + 1).padStart(2, "0")}T21:00:00.000Z`,
      })),
    );

    const first = await searchStars(journalId, { q: "numbered", limit: 3, offset: 0 }, NOW);
    const second = await searchStars(journalId, { q: "numbered", limit: 3, offset: 3 }, NOW);
    const third = await searchStars(journalId, { q: "numbered", limit: 3, offset: 6 }, NOW);

    const ids = [...first.stars, ...second.stars, ...third.stars].map(star => star.id);
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
  });

  it("combines a query with the filters the interface offers", async () => {
    const { journalId } = await journalWith([
      { content: "Rain, and I felt calm.", mood: "serene", intensity: 1 },
      { content: "Rain, and I felt awake.", mood: "luminous", intensity: 5, favorite: true },
    ]);

    expect((await searchStars(journalId, { q: "rain", mood: "luminous", limit: 60, offset: 0 }, NOW)).total).toBe(1);
    expect((await searchStars(journalId, { q: "rain", starred: "true", limit: 60, offset: 0 }, NOW)).total).toBe(1);
    expect((await searchStars(journalId, { q: "rain", intensityMin: 4, limit: 60, offset: 0 }, NOW)).total).toBe(1);
    expect((await searchStars(journalId, { q: "rain", intensityMax: 2, limit: 60, offset: 0 }, NOW)).total).toBe(1);
    expect((await searchStars(journalId, { q: "rain", mood: "tender", limit: 60, offset: 0 }, NOW)).total).toBe(0);
  });

  it("sorts by date when there is no query, and by relevance when there is one", async () => {
    const { journalId, stars } = await journalWith([
      { content: "rain", createdAt: "2026-03-01T21:00:00.000Z" },
      { content: "rain rain rain and then some more rain", createdAt: "2026-03-02T21:00:00.000Z" },
    ]);

    const byDate = await searchStars(journalId, { limit: 60, offset: 0, sort: "newest" }, NOW);
    expect(byDate.stars[0].content.startsWith("rain rain rain")).toBe(true);

    const byRelevance = await searchStars(journalId, { q: "rain", limit: 60, offset: 0 }, NOW);
    expect(byRelevance.stars).toHaveLength(2);
    expect(byRelevance.stars[0].id).toBe(stars[1].id); // the one that says it four times
  });

  it("counts a night once, however many feelings were written on it", async () => {
    const { journalId } = await journalWith([
      { content: "Stone, on the first night.", mood: "serene", createdAt: "2026-03-01T21:00:00.000Z" },
      { content: "Stone, on the second night.", mood: "serene", createdAt: "2026-03-02T21:00:00.000Z" },
      { content: "Stone, again on the second night.", mood: "tender", createdAt: "2026-03-02T22:30:00.000Z" },
    ]);
    const found = await searchStars(journalId, { q: "stone", timeZone: "UTC", limit: 60, offset: 0 }, NOW);
    expect(found.total).toBe(3);
    // Two nights, not three: the second night was written in two feelings and is still one
    // night. Summing the per-feeling distinct counts is how this got to three.
    expect(found.facets.nights).toBe(2);
  });
});
