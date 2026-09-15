import { EMPTY_FILTERS, isMoodKey, type MomentFilters } from "./astral";

/** The sky is a single surface; only the filter model needs to live in the URL. */
export function readFilters(params: URLSearchParams): MomentFilters {
  const m = params.get("mood"), sort = params.get("sort"), day = params.get("day") || "";
  return {
    ...EMPTY_FILTERS,
    query: (params.get("q") || "").slice(0, 200),
    mood: isMoodKey(m) ? m : "all",
    starred: params.get("starred") === "1",
    sort: sort === "oldest" || sort === "brightest" ? sort : "newest",
    day: /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(new Date(`${day}T12:00:00Z`).getTime()) ? day : "",
  };
}
export function filtersHref(filters: MomentFilters) {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  if (filters.mood !== "all") params.set("mood", filters.mood);
  if (filters.starred) params.set("starred", "1");
  if (filters.sort !== "newest") params.set("sort", filters.sort);
  if (filters.day) params.set("day", filters.day);
  return params.size ? `/sky?${params}` : "/sky";
}
