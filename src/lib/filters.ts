import { MOODS, isMoodKey, type MoodKey } from "./moods";
import { isDayKey } from "./validation";
import type { StarDto } from "./stars";
import { dayKey, shiftDay } from "./time";

/**
 * One filter model drives the sky, the library and the reflections, and it is also the
 * URL. That is deliberate: a filtered view is a thing a writer can send to themselves,
 * bookmark, or come back to with the back button, and it means the server and the client
 * agree about what "this month, feeling grateful" is because they run the same function.
 */

export type View = "sky" | "memories" | "reflections" | "starred";
export type SortOrder = "newest" | "oldest" | "brightest" | "dimmest";
export type Period = "all" | "month" | "week";

export interface MomentFilters {
  query: string;
  mood: MoodKey | "all";
  period: Period;
  /** A single `YYYY-MM-DD` calendar day, or "" for all days. */
  day: string;
  starred: boolean;
  sort: SortOrder;
}

export const EMPTY_FILTERS: MomentFilters = {
  query: "",
  mood: "all",
  period: "all",
  day: "",
  starred: false,
  sort: "newest",
};

export const VIEWS: readonly View[] = ["sky", "memories", "reflections", "starred"];
export const SORTS: readonly SortOrder[] = ["newest", "oldest", "brightest", "dimmest"];
export const PERIODS: readonly Period[] = ["all", "month", "week"];

export function sortStars(stars: StarDto[], sort: SortOrder): StarDto[] {
  const byNewest = (a: StarDto, b: StarDto) => b.createdAt.localeCompare(a.createdAt);
  switch (sort) {
    case "oldest":
      return [...stars].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    case "brightest":
      return [...stars].sort((a, b) => b.intensity - a.intensity || byNewest(a, b));
    case "dimmest":
      return [...stars].sort((a, b) => a.intensity - b.intensity || byNewest(a, b));
    default:
      return [...stars].sort(byNewest);
  }
}

/** The earliest day key a period filter admits, or null when the period is unbounded. */
export function periodStart(period: Period, today: string): string | null {
  if (period === "week") return shiftDay(today, -6);
  if (period === "month") return `${today.slice(0, 7)}-01`;
  return null;
}

/**
 * Apply the whole filter model client-side. The server has its own SQL implementation of
 * the same semantics (`src/lib/search.ts`) for the paged endpoints; this one exists so the
 * sky, the timeline and the reader can react to a keystroke without a round trip.
 */
export function filterStars(
  stars: StarDto[],
  filters: MomentFilters,
  now = new Date(),
  timeZone = "UTC",
): StarDto[] {
  const today = dayKey(now, timeZone);
  const start = periodStart(filters.period, today);
  const query = filters.query.trim().toLocaleLowerCase();

  const matched = stars.filter(star => {
    if (filters.mood !== "all" && star.mood !== filters.mood) return false;
    if (filters.starred && !star.favorite) return false;
    const date = dayKey(new Date(star.createdAt), timeZone);
    if (filters.day && date !== filters.day) return false;
    if (start && date < start) return false;
    // A moment dated in the future cannot be "from" a night that has not happened yet.
    if (date > today) return false;
    if (!query) return true;
    const mood = MOODS[star.mood];
    return `${star.title} ${star.content} ${mood?.label ?? ""} ${mood?.constellation ?? ""}`
      .toLocaleLowerCase()
      .includes(query);
  });

  return sortStars(matched, filters.sort);
}

export function filtersActive(filters: MomentFilters): boolean {
  return Boolean(filters.query || filters.day || filters.starred || filters.mood !== "all" || filters.period !== "all");
}

/** Read the filter model out of a URL. Unknown or hostile values fall back to defaults. */
export function readWorkspaceLocation(params: URLSearchParams): { view: View; filters: MomentFilters } {
  const view = params.get("view");
  const mood = params.get("mood");
  const period = params.get("period");
  const sort = params.get("sort");
  const day = params.get("day") ?? "";
  const resolvedView: View = VIEWS.includes(view as View) ? (view as View) : "sky";

  return {
    view: resolvedView,
    filters: {
      ...EMPTY_FILTERS,
      starred: resolvedView === "starred",
      query: (params.get("q") ?? "").slice(0, 200),
      mood: isMoodKey(mood) ? mood : "all",
      period: PERIODS.includes(period as Period) && period !== "all" ? (period as Period) : "all",
      sort: SORTS.includes(sort as SortOrder) ? (sort as SortOrder) : "newest",
      // `isDayKey` round-trips the date, which a regex cannot do: JavaScript parses
      // "2026-02-30" happily and hands back March 2, so a typed-in URL would quietly show
      // a night that does not exist. Bad input falls back to "all days" instead.
      day: isDayKey(day) ? day : "",
    },
  };
}

/** The inverse: the canonical URL for a view and its filters. Defaults stay out of it. */
export function workspaceHref(view: View, filters: MomentFilters): string {
  const params = new URLSearchParams();
  if (view !== "sky") params.set("view", view);
  if (filters.query) params.set("q", filters.query);
  if (filters.mood !== "all") params.set("mood", filters.mood);
  if (filters.period !== "all") params.set("period", filters.period);
  if (filters.day) params.set("day", filters.day);
  if (filters.sort !== "newest") params.set("sort", filters.sort);
  return params.size ? `/sky?${params}` : "/sky";
}
