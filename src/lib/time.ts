/**
 * Calendar dates are not instants, and this module is where that distinction lives.
 *
 * A journal entry has a *date the writer was living in* and a *timestamp when it was
 * written*. Those are different things: at 23:40 in Auckland it is already tomorrow in
 * UTC, so anything that buckets entries by day must be told which zone the day is in.
 * All day arithmetic here therefore happens on `YYYY-MM-DD` keys, never on `Date`
 * objects, and only converts at the edges.
 */

const keyFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

/** `2026-09-26` for the given instant, as read in `timeZone`. */
export function zonedDayKey(date: Date, timeZone: string): string {
  let formatter = keyFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      calendar: "gregory",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    keyFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * The day key for an instant, defaulting to the server's own zone. Passing an explicit
 * zone is what server-rendered pages should do — see `JournalTimeProvider`, which keeps
 * the first render in UTC and adopts the browser's zone after hydration so the markup
 * cannot mismatch.
 */
export function dayKey(date: Date, timeZone?: string): string {
  if (timeZone) {
    try {
      return zonedDayKey(date, timeZone);
    } catch {
      /* An invalid zone must not take a page down: fall through to the local reading. */
    }
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** UTC noon is a stable representation to do arithmetic on a `YYYY-MM-DD` key. */
export function calendarDate(key: string): Date {
  return new Date(`${key}T12:00:00Z`);
}

/** Move a day key by whole days, without ever crossing a DST-unstable local midnight. */
export function shiftDay(key: string, offset: number): string {
  const date = calendarDate(key);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, both as keys. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((calendarDate(to).getTime() - calendarDate(from).getTime()) / 86_400_000);
}

/** The hour (0–23) an instant falls in, read in `timeZone`. */
export function zonedHour(date: Date, timeZone: string): number {
  try {
    return Number(
      new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).format(date),
    ) % 24;
  } catch {
    return date.getUTCHours();
  }
}

/** True if `timeZone` is a zone this runtime can actually format in. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

/** `Friday, 26 September 2026` — the day as a writer reads it. */
export function formatDay(iso: string, timeZone = "UTC"): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** `26 Sep` — for dense lists and axis labels. */
export function shortDay(iso: string, timeZone = "UTC"): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone, month: "short", day: "numeric" });
}

/** `23:41` in the writer's zone. */
export function clockTime(date: Date, timeZone = "UTC"): string {
  let formatter = timeFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false });
    timeFormatters.set(timeZone, formatter);
  }
  return formatter.format(date);
}

/** How long ago, in the register this product uses: nothing is ever "overdue". */
export function relativeDay(from: Date, now: Date, timeZone = "UTC"): string {
  const delta = daysBetween(dayKey(from, timeZone), dayKey(now, timeZone));
  if (delta === 0) return "tonight";
  if (delta === 1) return "last night";
  if (delta < 7) return `${delta} nights ago`;
  if (delta < 30) {
    const weeks = Math.round(delta / 7);
    return weeks === 1 ? "a week ago" : `${weeks} weeks ago`;
  }
  const months = Math.round(delta / 30);
  return months === 1 ? "a month ago" : `${months} months ago`;
}

/** The wall-clock offset of `timeZone` at `date`, in milliseconds. */
export function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find(part => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - date.getTime();
}

/**
 * The half-open UTC instant range covering one calendar day *in a given zone*.
 *
 * This is what makes a day filter sargable: `created_at >= start and created_at < end` uses
 * the `(journal_id, created_at)` index, where `date(created_at at time zone $1) = $2` cannot.
 * The offset is resolved at the day's own instant rather than at `now`, so a filter for a
 * day on the far side of a daylight-saving change is still exactly 24 hours wide in the
 * writer's calendar.
 */
export function zonedDayRange(day: string, timeZone: string): { start: Date; end: Date } {
  const guess = new Date(`${day}T00:00:00Z`);
  const start = new Date(guess.getTime() - zoneOffsetMs(guess, timeZone));
  const nextDay = new Date(`${shiftDay(day, 1)}T00:00:00Z`);
  const end = new Date(nextDay.getTime() - zoneOffsetMs(nextDay, timeZone));
  return { start, end };
}

/** The UTC range covering the last `days` calendar days *in a given zone*, ending today. */
export function zonedTrailingRange(day: string, days: number, timeZone: string): { start: Date; end: Date } {
  const start = zonedDayRange(shiftDay(day, -(days - 1)), timeZone).start;
  const end = zonedDayRange(day, timeZone).end;
  return { start, end };
}
