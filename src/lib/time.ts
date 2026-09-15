/** Calendar dates are not instants. These helpers keep the two separate. */
const keyFormatters = new Map<string, Intl.DateTimeFormat>();
export function zonedDayKey(date: Date, timeZone: string): string {
  let formatter = keyFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, calendar: "gregory", year: "numeric", month: "2-digit", day: "2-digit" });
    keyFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
/** UTC noon is a stable representation for doing arithmetic on a YYYY-MM-DD calendar date. */
export function calendarDate(key: string): Date { return new Date(`${key}T12:00:00Z`); }
export function shiftDay(key: string, offset: number): string {
  const date = calendarDate(key); date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
