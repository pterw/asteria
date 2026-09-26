import { describe, expect, it } from "vitest";
import {
  importSchema,
  momentDate,
  parseOrThrow,
  searchQuerySchema,
  starCreateSchema,
  starPatchSchema,
} from "@/lib/schemas";
import { MAX_CONTENT, MAX_IMPORT_MOMENTS } from "@/lib/limits";
import { ApiError } from "@/lib/errors";

/**
 * The wire contract.
 *
 * Two kinds of test here. The first kind states what the product promises a writer — the
 * message they read when something is refused, the fact that a title is optional and a
 * moment is not. The second kind is a regression suite for bugs this schema has actually
 * had: Zod's `.default()` materialising absent keys into a patch, and JavaScript quietly
 * turning "2026-02-30" into March 2.
 */

describe("creating a moment", () => {
  const valid = { content: "A quiet evening, nothing more.", mood: "serene", intensity: 3 };

  it("accepts the smallest honest moment", () => {
    const parsed = starCreateSchema.parse(valid);
    expect(parsed.title).toBe(""); // the name is optional; the writing is not
    expect(parsed.content).toBe("A quiet evening, nothing more.");
    expect(parsed.createdAt).toBeInstanceOf(Date);
  });

  it("refuses a moment that is not a moment, in the writer's language", () => {
    expect(() => starCreateSchema.parse({ ...valid, content: "x" })).toThrowError(
      "A moment needs at least 2 characters.",
    );
    expect(() => starCreateSchema.parse({ ...valid, content: " ".repeat(4) })).toThrow();
    expect(() => starCreateSchema.parse({ ...valid, mood: "wistful" })).toThrowError(
      "Choose one of the six feelings.",
    );
    expect(() => starCreateSchema.parse({ ...valid, intensity: 0 })).toThrowError(
      "Brightness runs from 1 to 5.",
    );
    expect(() => starCreateSchema.parse({ ...valid, intensity: 3.5 })).toThrowError(
      "Brightness must be a whole number from 1 to 5.",
    );
  });

  it("measures the length after cleaning, not before", () => {
    // A body of markup is not writing: it is removed first, then measured.
    expect(() => starCreateSchema.parse({ ...valid, content: "<b></b>" })).toThrowError(
      "A moment needs at least 2 characters.",
    );
    const long = "x".repeat(MAX_CONTENT + 50);
    expect(() => starCreateSchema.parse({ ...valid, content: long })).toThrowError(
      `A moment can hold up to ${MAX_CONTENT} characters.`,
    );
  });

  it("refuses a field it did not ask for", () => {
    expect(() => parseOrThrow(starCreateSchema, { ...valid, isSample: true })).toThrow(ApiError);
    try {
      parseOrThrow(starCreateSchema, { ...valid, journalId: "someone else's" });
    } catch (error) {
      expect((error as ApiError).message).toBe("That request included something Asteria does not accept.");
      expect((error as ApiError).status).toBe(422);
    }
  });
});

describe("patching a moment", () => {
  it("does not invent fields the caller left out", () => {
    // The bug this pins: `title: titleField` defaults to "", so `{restore: true}` arrived
    // at the "restore must be alone" rule carrying `title: ""` and was refused — the undo
    // button was broken by a schema default.
    const parsed = starPatchSchema.parse({ restore: true });
    expect(Object.keys(parsed)).toEqual(["restore"]);
    expect("title" in parsed).toBe(false);
  });

  it("refuses restore combined with anything else", () => {
    expect(() => starPatchSchema.parse({ restore: true, favorite: true })).toThrowError(
      "Restore a star in a separate request.",
    );
    expect(() => starPatchSchema.parse({ restore: true, content: "and also this" })).toThrow();
    expect(() => starPatchSchema.parse({ restore: false })).toThrowError(
      "Restore a star in a separate request.",
    );
  });

  it("refuses an empty patch, which is almost always a client bug", () => {
    expect(() => starPatchSchema.parse({})).toThrowError("Choose something to update.");
  });

  it("clears a title when asked explicitly, and keeps it otherwise", () => {
    expect(starPatchSchema.parse({ title: "" }).title).toBe("");
    const renamed = starPatchSchema.parse({ title: "  Renamed  " });
    expect(renamed.title).toBe("Renamed");
    expect("content" in starPatchSchema.parse({ favorite: true })).toBe(false);
  });
});

describe("dates", () => {
  it("takes an instant, a bare day, and epoch milliseconds", () => {
    expect(momentDate.parse("2026-03-06T22:30:00.000Z")!.toISOString()).toBe("2026-03-06T22:30:00.000Z");
    // A bare day becomes noon UTC so no zone can slide it into the night before.
    expect(momentDate.parse("2026-03-06")!.toISOString()).toBe("2026-03-06T12:00:00.000Z");
    expect(momentDate.parse(Date.parse("2026-03-06T22:30:00.000Z"))!.toISOString()).toBe(
      "2026-03-06T22:30:00.000Z",
    );
  });

  it("refuses a day that does not exist instead of rolling it over", () => {
    // JavaScript: new Date("2026-02-30") is March 2. A journal may not do that silently.
    expect(() => momentDate.parse("2026-02-30")).toThrowError("Choose a real calendar day.");
    expect(() => momentDate.parse("2026-02-30T12:00:00Z")).toThrowError("Choose a real calendar day.");
    expect(() => momentDate.parse("2026-04-31T09:00:00Z")).toThrowError("Choose a real calendar day.");
    expect(momentDate.parse("2028-02-29")!.toISOString()).toBe("2028-02-29T12:00:00.000Z");
  });

  it("refuses nonsense and dates a sky cannot hold", () => {
    expect(() => momentDate.parse("not a date")).toThrowError("Choose a valid date.");
    expect(() => momentDate.parse("1899-12-31T23:00:00Z")).toThrowError(
      "Choose a date between 1900 and today.",
    );
    const farFuture = new Date(Date.now() + 10 * 86_400_000).toISOString();
    expect(() => momentDate.parse(farFuture)).toThrowError("Choose a date between 1900 and today.");
    // Tomorrow is allowed: a writer in Auckland may legitimately be a day ahead of the server.
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    expect(momentDate.parse(soon)).toBeInstanceOf(Date);
  });
});

describe("search query parameters", () => {
  it("applies paging defaults and coerces numbers from the query string", () => {
    const parsed = searchQuerySchema.parse({});
    expect(parsed.limit).toBe(60);
    expect(parsed.offset).toBe(0);
    const paged = searchQuerySchema.parse({ limit: "25", offset: "50", q: "rain" });
    expect(paged).toMatchObject({ limit: 25, offset: 50, q: "rain" });
  });

  it("caps a page and refuses a negative offset", () => {
    expect(() => searchQuerySchema.parse({ limit: "500" })).toThrow();
    expect(() => searchQuerySchema.parse({ offset: "-1" })).toThrow();
  });
});

describe("importing a backup", () => {
  const file = (moments: unknown[]) => ({ application: "Asteria", version: 3, moments });

  it("is forgiving about one damaged row and strict about the file", () => {
    const parsed = importSchema.parse(
      file([
        { content: "A real moment", mood: "tender", intensity: 4, createdAt: "2026-03-06T22:30:00.000Z" },
        { content: "Damaged", mood: "not-a-feeling", intensity: 99, createdAt: "whenever" },
      ]),
    );
    expect(parsed.mode).toBe("merge");
    expect(parsed.moments).toHaveLength(2);
    // The damaged row degrades to defaults rather than rejecting the writer's only backup.
    expect(parsed.moments[1].mood).toBe("serene");
    expect(parsed.moments[1].intensity).toBe(3);
    expect(parsed.moments[1].createdAt).toBeInstanceOf(Date);
  });

  it("ignores fields from a future version of the file", () => {
    const parsed = importSchema.parse(
      file([{ content: "Written by a later build", constellation: "the long walk", mood: "vesper" }]),
    );
    expect(parsed.moments).toHaveLength(1);
  });

  it("refuses an empty file and one that is too large", () => {
    expect(() => importSchema.parse(file([]))).toThrowError("That file has no moments in it.");
    const tooMany = Array.from({ length: MAX_IMPORT_MOMENTS + 1 }, () => ({ content: "hello there" }));
    expect(() => importSchema.parse(file(tooMany))).toThrowError(
      `Import up to ${MAX_IMPORT_MOMENTS} moments at a time.`,
    );
  });

  it("only accepts the two documented modes", () => {
    expect(importSchema.parse({ ...file([{ content: "hello" }]), mode: "replace" }).mode).toBe("replace");
    expect(() => importSchema.parse({ ...file([{ content: "hello" }]), mode: "overwrite" })).toThrow();
  });
});
