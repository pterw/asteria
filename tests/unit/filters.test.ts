import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTERS,
  filterStars,
  filtersActive,
  periodStart,
  readWorkspaceLocation,
  sortStars,
  workspaceHref,
  type MomentFilters,
} from "@/lib/filters";
import type { StarDto } from "@/lib/stars";

/**
 * The filter model is the URL, which makes it the one piece of client state a writer can
 * hand to someone else (or to their future self). So these tests are mostly about
 * round-tripping and about refusing input: a hostile or mistyped query string must land on
 * a sensible view rather than an empty one, and a URL produced here must read back
 * identically.
 */

const star = (overrides: Partial<StarDto>): StarDto => ({
  id: "id",
  title: "",
  content: "text",
  mood: "serene",
  intensity: 3,
  x: 0,
  y: 0,
  createdAt: "2026-03-06T22:30:00.000Z",
  updatedAt: "2026-03-06T22:30:00.000Z",
  favorite: false,
  isSample: false,
  ...overrides,
});

const now = new Date("2026-03-10T18:00:00.000Z");
const tz = "America/Toronto";
const journal: StarDto[] = [
  star({ id: "a", title: "Rain", content: "the street smelled of wet stone", mood: "serene", createdAt: "2026-03-09T23:30:00.000Z" }),
  star({ id: "b", title: "Late", content: "still awake", mood: "tender", intensity: 5, favorite: true, createdAt: "2026-03-08T02:00:00.000Z" }),
  star({ id: "c", title: "Bright morning", content: "sun on the floor", mood: "luminous", intensity: 2, createdAt: "2026-03-01T13:00:00.000Z" }),
  star({ id: "d", title: "Tomorrow", content: "written by mistake", mood: "serene", createdAt: "2026-03-12T13:00:00.000Z" }),
];

describe("reading the view out of a URL", () => {
  it("defaults to the sky with nothing filtered", () => {
    const { view, filters } = readWorkspaceLocation(new URLSearchParams());
    expect(view).toBe("sky");
    expect(filters).toEqual(EMPTY_FILTERS);
    expect(filtersActive(filters)).toBe(false);
  });

  it("ignores anything it does not recognise rather than failing", () => {
    const { view, filters } = readWorkspaceLocation(
      new URLSearchParams({ view: "elsewhere", mood: "wistful", period: "decade", sort: "chaotic", day: "yesterday" }),
    );
    expect(view).toBe("sky");
    expect(filters.mood).toBe("all");
    expect(filters.period).toBe("all");
    expect(filters.sort).toBe("newest");
    expect(filters.day).toBe("");
  });

  it("refuses a day that does not exist on the calendar", () => {
    // JavaScript would happily parse "2026-02-30" as March 2, quietly showing a night the
    // writer never wrote about.
    expect(readWorkspaceLocation(new URLSearchParams({ day: "2026-02-30" })).filters.day).toBe("");
    expect(readWorkspaceLocation(new URLSearchParams({ day: "2026-03-08" })).filters.day).toBe("2026-03-08");
  });

  it("caps a search query instead of trusting its length", () => {
    const { filters } = readWorkspaceLocation(new URLSearchParams({ q: "x".repeat(500) }));
    expect(filters.query).toHaveLength(200);
  });

  it("treats the starred view and the starred filter as one thing", () => {
    const { view, filters } = readWorkspaceLocation(new URLSearchParams({ view: "starred" }));
    expect(view).toBe("starred");
    expect(filters.starred).toBe(true);
  });
});

describe("writing the URL back", () => {
  it("omits defaults, so the address stays readable", () => {
    expect(workspaceHref("sky", EMPTY_FILTERS)).toBe("/sky");
  });

  it("round-trips every filter exactly", () => {
    const filters: MomentFilters = {
      query: "wet stone",
      mood: "verdant",
      period: "week",
      day: "2026-03-08",
      starred: true,
      sort: "brightest",
    };
    const href = workspaceHref("starred", filters);
    const read = readWorkspaceLocation(new URLSearchParams(href.split("?")[1]));
    expect(read.view).toBe("starred");
    expect(read.filters).toEqual(filters);
  });
});

describe("filtering the journal", () => {
  it("keeps moments that are real, and hides one dated in the future", () => {
    // "Tomorrow" is a clock skew, not a memory: a sky has no futures.
    expect(filterStars(journal, EMPTY_FILTERS, now, tz).map(s => s.id)).toEqual(["a", "b", "c"]);
  });

  it("filters by feeling and by starred", () => {
    expect(filterStars(journal, { ...EMPTY_FILTERS, mood: "serene" }, now, tz).map(s => s.id)).toEqual(["a"]);
    expect(filterStars(journal, { ...EMPTY_FILTERS, starred: true }, now, tz).map(s => s.id)).toEqual(["b"]);
  });

  it("searches the words and the name of a feeling", () => {
    expect(filterStars(journal, { ...EMPTY_FILTERS, query: "wet stone" }, now, tz).map(s => s.id)).toEqual(["a"]);
    // A writer searches for the word they see on the star, not the key underneath it:
    // "whimsical" is what the interface calls `tender`, so that is what must match.
    expect(filterStars(journal, { ...EMPTY_FILTERS, query: "whimsical" }, now, tz).map(s => s.id)).toEqual(["b"]);
    expect(filterStars(journal, { ...EMPTY_FILTERS, query: "WHIMSICAL" }, now, tz).map(s => s.id)).toEqual(["b"]);
    expect(filterStars(journal, { ...EMPTY_FILTERS, query: "grateful" }, now, tz).map(s => s.id)).toEqual(["c"]);
  });

  it("uses the writer's local day for periods and days", () => {
    // 23:30 UTC on the 9th is 18:30 in Toronto: still the 9th there, but the 10th in UTC.
    const lastNight = filterStars(journal, { ...EMPTY_FILTERS, day: "2026-03-09" }, now, tz);
    expect(lastNight.map(s => s.id)).toEqual(["a"]);
    const today = filterStars(journal, { ...EMPTY_FILTERS, period: "week" }, now, tz);
    expect(today.map(s => s.id)).toEqual(["a", "b"]);
  });

  it("counts the week from the day six before today", () => {
    expect(periodStart("week", "2026-03-10")).toBe("2026-03-04");
    expect(periodStart("month", "2026-03-10")).toBe("2026-03-01");
    expect(periodStart("all", "2026-03-10")).toBeNull();
  });

  it("sorts without losing anything", () => {
    const newest = sortStars(journal, "newest").map(s => s.id);
    expect(newest).toEqual(["d", "a", "b", "c"]);
    expect(sortStars(journal, "oldest").map(s => s.id)).toEqual([...newest].reverse());
    expect(sortStars(journal, "brightest")[0].id).toBe("b");
    expect(sortStars(journal, "dimmest")[0].id).toBe("c");
    // Ties fall back to newest-first, so a sort is always a total order.
    const tied = [star({ id: "x", intensity: 3 }), star({ id: "y", intensity: 3, createdAt: "2026-03-07T00:00:00Z" })];
    expect(sortStars(tied, "brightest").map(s => s.id)).toEqual(["y", "x"]);
  });
});
