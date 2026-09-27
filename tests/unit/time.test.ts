import { describe, expect, it } from "vitest";
import {
  clockTime,
  dayKey,
  daysBetween,
  isValidTimeZone,
  shiftDay,
  zonedDayKey,
  zonedDayRange,
  zonedHour,
  zonedTrailingRange,
  zoneOffsetMs,
} from "@/lib/time";
import { isDayKey, isOpaqueToken, isUuid } from "@/lib/validation";
import { constellationPosition, mulberry32 } from "@/lib/stars";

/**
 * Time, where the bugs live.
 *
 * A journal is a calendar, so almost every interesting failure in this product is a date
 * that lands on the wrong night: a day that is 23 hours long, a timestamp compared as a
 * string, a "yesterday" that is two days ago in another zone. These tests pin the parts
 * that are easy to get subtly wrong and impossible to notice.
 */

describe("day keys", () => {
  it("uses the writer's local day, not the server's", () => {
    // 23:30 in Toronto on the 6th is the 7th in UTC. The moment belongs to the 6th.
    const instant = new Date("2026-03-07T04:30:00.000Z");
    expect(dayKey(instant, "America/Toronto")).toBe("2026-03-06");
    expect(dayKey(instant, "UTC")).toBe("2026-03-07");
    expect(zonedDayKey(instant, "Asia/Kolkata")).toBe("2026-03-07");
  });

  it("refuses a calendar day that does not exist", () => {
    // JavaScript parses "2026-02-30" and hands back March 2 rather than an error, which is
    // exactly the kind of silent rollover a typed-in URL must not be allowed to cause.
    expect(isDayKey("2026-02-30")).toBe(false);
    expect(isDayKey("2026-13-01")).toBe(false);
    expect(isDayKey("2026-2-1")).toBe(false);
    expect(isDayKey("2026-02-28")).toBe(true);
    expect(isDayKey("2028-02-29")).toBe(true); // a leap year
  });

  it("shifts and counts across a month and a year boundary", () => {
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-03-09", "2026-03-07")).toBe(-2);
  });
});

describe("daylight saving", () => {
  it("gives a 23-hour day when the clocks go forward", () => {
    const { start, end } = zonedDayRange("2026-03-08", "America/Toronto");
    expect(start.toISOString()).toBe("2026-03-08T05:00:00.000Z"); // 00:00 EST
    expect(end.toISOString()).toBe("2026-03-09T04:00:00.000Z"); // 00:00 EDT, one hour early
    expect(end.getTime() - start.getTime()).toBe(23 * 3_600_000);
  });

  it("gives a 25-hour day when the clocks go back", () => {
    const { start, end } = zonedDayRange("2026-11-01", "America/Toronto");
    expect(end.getTime() - start.getTime()).toBe(25 * 3_600_000);
  });

  it("resolves the offset at the target day, not at today", () => {
    // The mistake this guards against: computing one offset from `Date.now()` and reusing
    // it for a range months away, which is wrong for half the year in any DST zone.
    const winter = zoneOffsetMs(new Date("2026-01-15T12:00:00Z"), "America/Toronto");
    const summer = zoneOffsetMs(new Date("2026-07-15T12:00:00Z"), "America/Toronto");
    expect(winter).toBe(-5 * 3_600_000);
    expect(summer).toBe(-4 * 3_600_000);
  });

  it("builds a trailing week that ends at the end of the chosen day", () => {
    const { start, end } = zonedTrailingRange("2026-03-10", 7, "America/Toronto");
    expect(dayKey(start, "America/Toronto")).toBe("2026-03-04");
    expect(dayKey(end, "America/Toronto")).toBe("2026-03-11");
    // Seven local days that contain a spring-forward: 167 hours, not 168.
    expect(end.getTime() - start.getTime()).toBe(167 * 3_600_000);
  });

  it("keeps local hours local", () => {
    expect(zonedHour(new Date("2026-03-07T04:30:00Z"), "America/Toronto")).toBe(23);
    expect(zonedHour(new Date("2026-03-07T04:30:00Z"), "UTC")).toBe(4);
    // India is a half-hour offset, which is where naive arithmetic on whole hours breaks.
    expect(zonedHour(new Date("2026-03-06T18:30:00Z"), "Asia/Kolkata")).toBe(0);
  });

  it("formats a clock time in the zone it is asked for, never the server's", () => {
    const instant = new Date("2026-03-07T04:30:00Z");
    expect(clockTime(instant, "America/Toronto")).toBe("23:30");
    expect(clockTime(instant, "UTC")).toBe("04:30");
    expect(clockTime(instant, "Asia/Kolkata")).toBe("10:00");
  });
});

describe("time zone validation", () => {
  it("accepts real zones and refuses invented ones", () => {
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("America/Toronto")).toBe(true);
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("America/Toronto ")).toBe(false); // trimmed upstream, not here
  });
});

describe("shared predicates", () => {
  it("recognises UUIDs by version and variant, not just by shape", () => {
    expect(isUuid("0195f0a2-7c3e-4c11-9c3f-2b8a1e6d4f00")).toBe(true);
    expect(isUuid("0195f0a2-7c3e-0c11-9c3f-2b8a1e6d4f00")).toBe(false); // version 0
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });

  it("recognises an opaque token of the right size", () => {
    expect(isOpaqueToken("A".repeat(43))).toBe(true);
    expect(isOpaqueToken("A".repeat(42))).toBe(false);
    expect(isOpaqueToken(`${"A".repeat(43)}+`)).toBe(false); // base64url only
  });
});

describe("star placement", () => {
  it("is deterministic, so a journal restored from a backup lands in the same sky", () => {
    const first = constellationPosition("serene", 7);
    const second = constellationPosition("serene", 7);
    expect(first).toEqual(second);
    expect(constellationPosition("serene", 7)).not.toEqual(constellationPosition("tender", 7));
  });

  it("never stacks two stars of one feeling on the same pixel", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 200; index++) {
      const { x, y } = constellationPosition("luminous", index);
      seen.add(`${x.toFixed(2)}:${y.toFixed(2)}`);
    }
    expect(seen.size).toBe(200);
  });

  it("uses a seeded generator that repeats exactly", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(mulberry32(43)()).not.toBe(mulberry32(42)());
  });
});
