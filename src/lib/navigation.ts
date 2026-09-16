import { EMPTY_FILTERS, isMoodKey, type MomentFilters, type View } from "./astral";
export function readWorkspaceLocation(params: URLSearchParams): { view: View; filters: MomentFilters } {
  const v = params.get("view"), m = params.get("mood"), period = params.get("period"), sort = params.get("sort"), day = params.get("day") || "";
  const view: View = v === "memories" || v === "starred" || v === "reflections" ? v : "sky";
  return { view, filters: {
    ...EMPTY_FILTERS, starred: view === "starred", query: (params.get("q") || "").slice(0, 200),
    mood: isMoodKey(m) ? m : "all", period: period === "month" || period === "week" ? period : "all",
    sort: sort === "oldest" || sort === "brightest" ? sort : "newest",
    day: /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(new Date(day).getTime()) ? day : "",
  } };
}
export function workspaceHref(view: View, filters: MomentFilters) {
  const params = new URLSearchParams();
  if (view !== "sky") params.set("view", view);
  if (filters.query) params.set("q", filters.query);
  if (filters.mood !== "all") params.set("mood", filters.mood);
  if (filters.period !== "all") params.set("period", filters.period);
  if (filters.day) params.set("day", filters.day);
  if (filters.sort !== "newest") params.set("sort", filters.sort);
  return params.size ? `/sky?${params}` : "/sky";
}
