import { shiftDay, zonedDayKey } from "./time";
/** Shared journal primitives, without third-party dependencies. */
export const MOOD_KEYS = ["luminous", "tender", "serene", "electric", "verdant", "vesper"] as const;
export type MoodKey = (typeof MOOD_KEYS)[number];
export interface Mood { key: MoodKey; label: string; hex: string; blurb: string; constellation: string; }
export const MOODS: Record<MoodKey, Mood> = {
  luminous: { key: "luminous", label: "Grateful", hex: "#e6c88d", blurb: "gratitude · small joys", constellation: "Grateful" },
  tender: { key: "tender", label: "Whimsical", hex: "#dca8b7", blurb: "affection · domestic humor", constellation: "Whimsical" },
  serene: { key: "serene", label: "Serene", hex: "#9dbdd6", blurb: "calm · clarity", constellation: "Serene" },
  electric: { key: "electric", label: "Energized", hex: "#b8a2da", blurb: "awe · voltage", constellation: "Energized" },
  verdant: { key: "verdant", label: "Depleted", hex: "#a2c6ab", blurb: "weariness · quiet endurance", constellation: "Depleted" },
  vesper: { key: "vesper", label: "Lyrical", hex: "#909dd0", blurb: "longing · the in-between", constellation: "Lyrical" },
};
export interface StarDto {
  id: string; title: string; content: string; mood: MoodKey; intensity: number;
  x: number; y: number; createdAt: string; updatedAt: string; favorite: boolean; isSample: boolean;
}
export type SortOrder = "newest" | "oldest" | "brightest";
export type View = "sky" | "memories" | "reflections" | "starred";
export type Period = "all" | "month" | "week";
export interface MomentFilters { query: string; mood: MoodKey | "all"; period: Period; day: string; starred: boolean; sort: SortOrder; }
export const EMPTY_FILTERS: MomentFilters = { query: "", mood: "all", period: "all", day: "", starred: false, sort: "newest" };
export const PROMPTS = [
  "What small thing made today lighter?",
  "What would you lose if you forgot it?",
  "When did you feel most like yourself?",
  "Who made the day warmer?",
  "What did you notice when you slowed down?",
  "What is quietly growing?",
  "What surprised you, kindly?",
];
export const INTENSITY_LABELS = ["", "a flicker", "a soft glow", "steady light", "bright", "blinding"];

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The journal unfolds in time: stars in the order they were born. */
export function birthOrdered(stars: StarDto[]) {
  return [...stars].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
/** A census is a count, not a verdict: how many lights, across how many nights, in how many constellations. */
export interface Census { stars: number; nights: number; constellations: number; }
export function census(stars: Pick<StarDto, "createdAt" | "mood">[], timeZone = "UTC"): Census {
  return {
    stars: stars.length,
    nights: new Set(stars.map(s => dayKey(new Date(s.createdAt), timeZone))).size,
    constellations: new Set(stars.map(s => s.mood)).size,
  };
}

/** Six anchor points, one per feeling. A journal grows outward from its own centre. */
export const MOOD_CENTERS: Record<MoodKey, { x: number; y: number }> = {
  luminous: { x: -205, y: -55 }, tender: { x: 175, y: -75 },
  serene: { x: 135, y: 110 }, electric: { x: -160, y: 110 },
  verdant: { x: -25, y: -145 }, vesper: { x: 5, y: 5 },
};
export function constellationPosition(mood: MoodKey, index: number) {
  const rand = mulberry32(index * 941 + MOOD_KEYS.indexOf(mood) * 1977);
  const a = index * 2.399963 + rand() * 0.45;
  const r = 17 + Math.sqrt(index + 1) * 21;
  return { x: MOOD_CENTERS[mood].x + Math.cos(a) * r, y: MOOD_CENTERS[mood].y + Math.sin(a) * r * 0.68 };
}

export function dayKey(d: Date, timeZone?: string): string {
  if (timeZone) return zonedDayKey(d, timeZone);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export interface SkyStats { stars: number; nights: number; streak: number; brightest: MoodKey | null; }
export function computeStats(stars: Pick<StarDto, "createdAt" | "mood" | "intensity">[], now = new Date(), timeZone = "UTC"): SkyStats {
  const nights = new Set(stars.map(s => dayKey(new Date(s.createdAt), timeZone)));
  let brightest: MoodKey | null = null, max = -1;
  for (const s of stars) if (s.intensity > max) { max = s.intensity; brightest = s.mood; }
  let streak = 0, cursor = dayKey(now, timeZone);
  if (!nights.has(cursor)) cursor = shiftDay(cursor, -1);
  while (nights.has(cursor)) { streak++; cursor = shiftDay(cursor, -1); }
  return { stars: stars.length, nights: nights.size, streak, brightest };
}
export function moodCounts(stars: StarDto[]): Record<MoodKey, number> {
  const counts = Object.fromEntries(MOOD_KEYS.map(m => [m, 0])) as Record<MoodKey, number>;
  for (const star of stars) counts[star.mood]++;
  return counts;
}
/** One filter model drives the sky, the library and the reflections. */
export function filterStars(stars: StarDto[], f: MomentFilters, now = new Date(), timeZone = "UTC"): StarDto[] {
  const today = dayKey(now, timeZone), start = f.period === "month" ? `${today.slice(0, 7)}-01` : shiftDay(today, -6);
  const query = f.query.trim().toLocaleLowerCase();
  return stars.filter(s => {
    if (f.mood !== "all" && s.mood !== f.mood) return false;
    if (f.starred && !s.favorite) return false;
    const date = dayKey(new Date(s.createdAt), timeZone);
    if (f.day && date !== f.day) return false;
    if (f.period !== "all" && date < start) return false;
    if (date > today) return false;
    return !query || `${s.title} ${s.content} ${MOODS[s.mood].label} ${MOODS[s.mood].constellation}`.toLocaleLowerCase().includes(query);
  }).sort((a, b) => f.sort === "brightest" ? b.intensity - a.intensity || b.createdAt.localeCompare(a.createdAt)
    : f.sort === "oldest" ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt));
}
export function filtersActive(f: MomentFilters) { return !!(f.query || f.day || f.starred || f.mood !== "all"); }
export function formatNight(iso: string, timeZone = "UTC") { return new Date(iso).toLocaleDateString("en-US", { timeZone, weekday: "long", month: "long", day: "numeric", year: "numeric" }); }
export function shortNight(iso: string, timeZone = "UTC") { return new Date(iso).toLocaleDateString("en-US", { timeZone, month: "short", day: "numeric" }); }
export function firstWords(text: string, n = 8) { const words = text.trim().split(/\s+/); return words.length <= n ? text.trim() : words.slice(0, n).join(" ") + "…"; }
export function starTitle(star: Pick<StarDto, "title" | "content">) { return star.title || firstWords(star.content, 5); }
export function isMoodKey(v: unknown): v is MoodKey { return typeof v === "string" && (MOOD_KEYS as readonly string[]).includes(v); }
export function isUuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
