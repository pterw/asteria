import { MOOD_KEYS, isMoodKey, type MoodKey } from "./moods";
import { dayKey, shiftDay, zonedHour } from "./time";

/**
 * What a journal's shape can be said about it, from metadata alone.
 *
 * **This module never sees the writing.** It takes ids, feelings, brightnesses and
 * timestamps — never a title, never a body. That is not an implementation accident: it is
 * what makes it acceptable for the analytics to run in a second process (the Python
 * service in `services/insights`) and for the numbers to be shareable at all. A writer's
 * words are not analytics input.
 *
 * ## The integer rule
 *
 * Every derived ratio is returned as a **scaled integer** (`shareBps` = basis points,
 * `avgIntensityX100`, `medianGapDaysX10`) rather than a float. The same computation exists
 * twice, in TypeScript here and in Python there, and two languages do not agree on how to
 * round `0.5`, nor always on how to represent `0.1`. Integers make the two
 * implementations comparable by equality, which is what lets `contract/analytics.json`
 * assert that they produce identical output for the same journal.
 *
 * ## The reading
 *
 * `cadence` is a rhythm, never a score. There is no percentage-complete, no target, and
 * `currentRun` deliberately counts a run that ended *yesterday* as still running: the
 * product's position is that absence costs nothing.
 */

export interface MomentForAnalytics {
  id: string;
  mood: string;
  intensity: number;
  createdAt: string;
  favorite?: boolean;
  isSample?: boolean;
}

export interface MoodSummary {
  key: MoodKey;
  count: number;
  /** Share of included moments, in basis points (1234 = 12.34%). */
  shareBps: number;
  /** Mean brightness × 100 (320 = 3.20). */
  avgIntensityX100: number;
}

export interface Analytics {
  generatedAt: string;
  timeZone: string;
  range: { firstDay: string | null; lastDay: string | null; spanDays: number };
  totals: {
    moments: number;
    nights: number;
    constellations: number;
    starred: number;
    examples: number;
    /** Days since the first moment, 0 for a single night. */
  };
  cadence: {
    /** Consecutive nights ending today or yesterday. */
    currentRun: number;
    longestRun: number;
    medianGapDaysX10: number;
    longestGapDays: number;
    nightsThisMonth: number;
    momentsThisWeek: number;
    /** Nights written / nights elapsed since the first, in basis points. */
    densityBps: number;
  };
  /** Monday-first, matching ISO-8601 and the calendar the interface draws. */
  weekdays: number[];
  /** Local hour 0–23 of each moment. */
  hours: number[];
  moods: MoodSummary[];
  intensity: { averageX100: number; histogram: number[] };
  /** First-order transitions between feelings, in birth order. */
  flow: { from: MoodKey; to: MoodKey; count: number }[];
  notable: {
    brightest: { id: string; mood: MoodKey; intensity: number; day: string } | null;
    busiestNight: { day: string; count: number } | null;
    longestGap: { from: string; to: string; days: number } | null;
    firstMoment: { id: string; day: string } | null;
  };
}

/** Half-up rounding, the rule both implementations follow. */
function scaled(value: number, factor: number): number {
  return Math.floor(value * factor + 0.5);
}

function weekdayIndex(day: string): number {
  // 1970-01-01 was a Thursday; 4 = Thursday in a Sunday-first week, so shift to Monday-first.
  const sundayFirst = new Date(`${day}T12:00:00Z`).getUTCDay();
  return (sundayFirst + 6) % 7;
}

export interface AnalyticsOptions {
  timeZone?: string;
  now?: Date;
  /** Example moments are excluded from every figure unless this is set. */
  includeExamples?: boolean;
}

export function computeAnalytics(
  moments: MomentForAnalytics[],
  { timeZone = "UTC", now = new Date(), includeExamples = false }: AnalyticsOptions = {},
): Analytics {
  const examples = moments.filter(moment => moment.isSample).length;
  const considered = includeExamples ? moments : moments.filter(moment => !moment.isSample);

  const dated = considered
    .filter(moment => isMoodKey(moment.mood) && Number.isFinite(new Date(moment.createdAt).getTime()))
    .map(moment => ({
      ...moment,
      mood: moment.mood as MoodKey,
      day: dayKey(new Date(moment.createdAt), timeZone),
      hour: zonedHour(new Date(moment.createdAt), timeZone),
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  const today = dayKey(now, timeZone);
  const nights = [...new Set(dated.map(moment => moment.day))].sort();

  // ── cadence ────────────────────────────────────────────────────────────────────────
  let currentRun = 0;
  let cursor = today;
  if (!nights.includes(cursor)) cursor = shiftDay(cursor, -1);
  while (nights.includes(cursor)) {
    currentRun++;
    cursor = shiftDay(cursor, -1);
  }

  let longestRun = 0;
  let running = 0;
  let previous: string | null = null;
  const gaps: number[] = [];
  for (const day of nights) {
    if (previous === null) {
      running = 1;
    } else {
      const difference = Math.round(
        (new Date(`${day}T12:00:00Z`).getTime() - new Date(`${previous}T12:00:00Z`).getTime()) / 86_400_000,
      );
      if (difference === 1) running++;
      else {
        gaps.push(difference);
        running = 1;
      }
    }
    longestRun = Math.max(longestRun, running);
    previous = day;
  }

  let medianGapDaysX10 = 0;
  if (gaps.length) {
    const sorted = [...gaps].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    medianGapDaysX10 = scaled(median, 10);
  }
  const longestGapDays = gaps.length ? Math.max(...gaps) : 0;

  const month = today.slice(0, 7);
  const weekStart = shiftDay(today, -6);
  const nightsThisMonth = nights.filter(day => day.startsWith(month)).length;
  const momentsThisWeek = dated.filter(moment => moment.day >= weekStart && moment.day <= today).length;

  const firstDay = nights[0] ?? null;
  const spanDays = firstDay
    ? Math.round((new Date(`${today}T12:00:00Z`).getTime() - new Date(`${firstDay}T12:00:00Z`).getTime()) / 86_400_000)
    : 0;
  const densityBps = spanDays > 0 ? scaled((nights.length / (spanDays + 1)) * 10_000, 1) : nights.length ? 10_000 : 0;

  // ── shape ──────────────────────────────────────────────────────────────────────────
  const weekdays = new Array(7).fill(0) as number[];
  const hours = new Array(24).fill(0) as number[];
  const histogram = new Array(6).fill(0) as number[];
  const moodCounts: Record<MoodKey, { count: number; intensitySum: number }> = Object.fromEntries(
    MOOD_KEYS.map(key => [key, { count: 0, intensitySum: 0 }]),
  ) as Record<MoodKey, { count: number; intensitySum: number }>;

  let intensitySum = 0;
  let brightest: Analytics["notable"]["brightest"] = null;
  const perNight = new Map<string, number>();

  for (const moment of dated) {
    weekdays[weekdayIndex(moment.day)]++;
    hours[moment.hour]++;
    if (moment.intensity >= 1 && moment.intensity <= 5) {
      histogram[moment.intensity]++;
      intensitySum += moment.intensity;
    }
    moodCounts[moment.mood].count++;
    moodCounts[moment.mood].intensitySum += moment.intensity;
    perNight.set(moment.day, (perNight.get(moment.day) ?? 0) + 1);
    if (!brightest || moment.intensity > brightest.intensity) {
      brightest = { id: moment.id, mood: moment.mood, intensity: moment.intensity, day: moment.day };
    }
  }

  const flowMap = new Map<string, number>();
  for (let index = 1; index < dated.length; index++) {
    const from = dated[index - 1].mood;
    const to = dated[index].mood;
    const key = `${from}>${to}`;
    flowMap.set(key, (flowMap.get(key) ?? 0) + 1);
  }
  const flow = [...flowMap.entries()]
    .map(([key, count]) => {
      const [from, to] = key.split(">") as [MoodKey, MoodKey];
      return { from, to, count };
    })
    .sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  let busiestNight: Analytics["notable"]["busiestNight"] = null;
  for (const [day, count] of [...perNight.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!busiestNight || count > busiestNight.count) busiestNight = { day, count };
  }

  let longestGap: Analytics["notable"]["longestGap"] = null;
  for (let index = 1; index < nights.length; index++) {
    const days = Math.round(
      (new Date(`${nights[index]}T12:00:00Z`).getTime() - new Date(`${nights[index - 1]}T12:00:00Z`).getTime()) /
        86_400_000,
    );
    if (!longestGap || days > longestGap.days) longestGap = { from: nights[index - 1], to: nights[index], days };
  }

  const total = dated.length;
  const moods: MoodSummary[] = MOOD_KEYS.map(key => ({
    key,
    count: moodCounts[key].count,
    shareBps: total ? scaled((moodCounts[key].count / total) * 10_000, 1) : 0,
    avgIntensityX100: moodCounts[key].count ? scaled(moodCounts[key].intensitySum / moodCounts[key].count, 100) : 0,
  }));

  return {
    generatedAt: now.toISOString(),
    timeZone,
    range: { firstDay, lastDay: nights[nights.length - 1] ?? null, spanDays },
    totals: {
      moments: total,
      nights: nights.length,
      constellations: moods.filter(mood => mood.count > 0).length,
      starred: dated.filter(moment => moment.favorite).length,
      examples,
    },
    cadence: {
      currentRun,
      longestRun,
      medianGapDaysX10,
      longestGapDays,
      nightsThisMonth,
      momentsThisWeek,
      densityBps,
    },
    weekdays,
    hours,
    moods,
    intensity: {
      averageX100: total ? scaled(intensitySum / total, 100) : 0,
      histogram,
    },
    flow: flow.slice(0, 18),
    notable: {
      brightest,
      busiestNight,
      longestGap,
      firstMoment: dated.length ? { id: dated[0].id, day: dated[0].day } : null,
    },
  };
}

/** `12.34%` from basis points, for display. */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

/** `3.2` from `avgIntensityX100`. */
export function formatScaled(value: number, factor: number, digits = 1): string {
  return (value / factor).toFixed(digits);
}
