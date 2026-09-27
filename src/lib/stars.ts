import { MOOD_CENTERS, MOOD_KEYS, type MoodKey } from "./moods";
import { dayKey, shiftDay } from "./time";

/**
 * A star is a moment, and its position is a *fact about when it was born* rather than a
 * rendering detail. Two consequences follow, and both are load-bearing:
 *
 * - The position is allocated on the server, inside a transaction, at creation, and is
 *   never recomputed. A reader who has learned where a light sits keeps it.
 * - Allocation is deterministic from `(mood, index)`. The same journal rebuilt from an
 *   export lands in the same sky, and no random state has to be persisted.
 */

export interface StarDto {
  id: string;
  title: string;
  content: string;
  mood: MoodKey;
  /** 1–5, the writer's brightness. */
  intensity: number;
  x: number;
  y: number;
  createdAt: string;
  updatedAt: string;
  favorite: boolean;
  isSample: boolean;
}

/** The fields a client may set. Ownership, id and coordinates are the server's business. */
export interface StarInput {
  title: string;
  content: string;
  mood: MoodKey;
  intensity: number;
  createdAt: Date;
}

/**
 * Small, fast, seedable PRNG (Mulberry32). Used for placement jitter and for the
 * canvas's starfield, where a *stable* pseudo-random field matters more than an
 * unpredictable one: the sky must not reshuffle when a component remounts.
 */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Where the `index`-th star of a constellation sits.
 *
 * A phyllotaxis (golden-angle) spiral: successive points turn ~137.5° and drift outward
 * as √index, which is the packing sunflowers use. It gives even spacing at every scale
 * — the first three stars are as legible as the three-hundredth — with no collision
 * check, no stored state, and no dependency on insertion order beyond the index itself.
 * The seeded jitter keeps the lattice from reading as machined.
 */
export function constellationPosition(mood: MoodKey, index: number, spread = 1): { x: number; y: number } {
  const rand = mulberry32(index * 941 + MOOD_KEYS.indexOf(mood) * 1977);
  const angle = index * 2.399963 + rand() * 0.45;
  const radius = (17 + Math.sqrt(index + 1) * 21) * spread;
  const center = MOOD_CENTERS[mood];
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius * 0.68,
  };
}

/** Oldest first, ties broken by id so the order is total and reproducible. */
export function birthOrdered<T extends Pick<StarDto, "createdAt" | "id">>(stars: T[]): T[] {
  return [...stars].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export interface Census {
  stars: number;
  nights: number;
  constellations: number;
}

/**
 * A census is a count, not a verdict: how many lights, across how many nights, in how
 * many constellations. It is the only number this product puts in front of a writer,
 * and it is deliberately three counts rather than one score.
 */
export function census(stars: Pick<StarDto, "createdAt" | "mood">[], timeZone = "UTC"): Census {
  return {
    stars: stars.length,
    nights: new Set(stars.map(s => dayKey(new Date(s.createdAt), timeZone))).size,
    constellations: new Set(stars.map(s => s.mood)).size,
  };
}

export interface SkyStats {
  stars: number;
  nights: number;
  /** Consecutive nights ending today or yesterday. A rhythm, never a debt. */
  streak: number;
  brightest: MoodKey | null;
}

export function computeStats(
  stars: Pick<StarDto, "createdAt" | "mood" | "intensity">[],
  now = new Date(),
  timeZone = "UTC",
): SkyStats {
  const nights = new Set(stars.map(s => dayKey(new Date(s.createdAt), timeZone)));
  let brightest: MoodKey | null = null;
  let max = -1;
  for (const star of stars) {
    if (star.intensity > max) {
      max = star.intensity;
      brightest = star.mood;
    }
  }
  let streak = 0;
  let cursor = dayKey(now, timeZone);
  if (!nights.has(cursor)) cursor = shiftDay(cursor, -1);
  while (nights.has(cursor)) {
    streak++;
    cursor = shiftDay(cursor, -1);
  }
  return { stars: stars.length, nights: nights.size, streak, brightest };
}

export function moodCounts<T extends Pick<StarDto, "mood">>(stars: T[]): Record<MoodKey, number> {
  const counts = Object.fromEntries(MOOD_KEYS.map(m => [m, 0])) as Record<MoodKey, number>;
  for (const star of stars) counts[star.mood] = (counts[star.mood] ?? 0) + 1;
  return counts;
}

/** The first `count` words, with an ellipsis when there were more. */
export function firstWords(text: string, count = 8): string {
  const words = text.trim().split(/\s+/);
  return words.length <= count ? text.trim() : `${words.slice(0, count).join(" ")}…`;
}

/** The name a moment is listed under: its title, or the opening of what was written. */
export function starTitle(star: Pick<StarDto, "title" | "content">): string {
  return star.title.trim() || firstWords(star.content, 5);
}
