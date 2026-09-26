import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeAnalytics, type Analytics } from "@/lib/analytics";

/**
 * The cross-language contract.
 *
 * `contract/analytics.json` is the shared answer sheet: this file computes every case with the
 * TypeScript implementation, and `services/insights/tests/test_contract.py` computes the same
 * cases with the Python one. Two implementations exist for good reasons — the atlas is better
 * rendered in Python, and the app must not stop working when that service is down — and the
 * cost of having two is drift. This is how drift becomes a red test instead of a wrong number
 * in somebody's journal.
 *
 * Neither language is the reference; the file is. It is regenerated from the TypeScript with
 * `npm run contract`, and reviewed like any other change, because a fixture that quietly
 * follows whichever implementation is wrong is a fixture that proves nothing.
 */

interface FixtureMoment {
  id: string;
  mood: string;
  intensity: number;
  createdAt: string;
  favorite?: boolean;
  isSample?: boolean;
}

interface FixtureCase {
  id: string;
  timeZone: string;
  now: string;
  includeExamples: boolean;
}

interface FixtureFile {
  $comment?: string;
  moments: FixtureMoment[];
  cases: FixtureCase[];
}

interface ExpectedFile {
  version: number;
  generatedBy: string;
  cases: { id: string; expected: Analytics }[];
}

const load = <T>(name: string): T =>
  JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../contract", name), "utf8")) as T;

const fixtures = load<FixtureFile>("fixtures.json");
const expected = load<ExpectedFile>("analytics.json");

/** The cases that carry moments. `nothing-yet` is deliberately empty, as its name says. */
const momentsFor = (caseId: string) => (caseId.startsWith("nothing") ? [] : fixtures.moments);

const ANALYTICS_FIELDS = [
  "generatedAt",
  "timeZone",
  "range",
  "totals",
  "cadence",
  "weekdays",
  "hours",
  "moods",
  "intensity",
  "flow",
  "notable",
] as const;

describe("the fixture file", () => {
  it("covers the cases the two implementations have to agree on", () => {
    const ids = expected.cases.map(entry => entry.id);
    expect(ids).toEqual(["toronto", "toronto-with-examples", "kolkata", "utc-midnight", "nothing-yet"]);
    expect(fixtures.cases.map(entry => entry.id)).toEqual(ids);
    expect(fixtures.moments.some(moment => moment.isSample)).toBe(true);
    // Two rows are unreadable on purpose: an unknown feeling and an impossible date.
    expect(fixtures.moments.length).toBeGreaterThan(12);
  });

  it("is not vacuous — the cases disagree with each other", () => {
    const toronto = expected.cases.find(entry => entry.id === "toronto")!.expected;
    const withExamples = expected.cases.find(entry => entry.id === "toronto-with-examples")!.expected;
    const kolkata = expected.cases.find(entry => entry.id === "kolkata")!.expected;
    const nothing = expected.cases.find(entry => entry.id === "nothing-yet")!.expected;

    expect(toronto.totals.examples).toBe(2);
    expect(withExamples.totals.moments).toBeGreaterThan(toronto.totals.moments);
    expect(kolkata.hours).not.toEqual(toronto.hours); // the zone really does move the buckets
    expect(nothing.totals.nights).toBe(0);
  });
});

describe("TypeScript agrees with the contract", () => {
  for (const entry of expected.cases) {
    it(entry.id, () => {
      const fixtureCase = fixtures.cases.find(candidate => candidate.id === entry.id);
      expect(fixtureCase, `no fixture case for ${entry.id}`).toBeDefined();

      const actual = computeAnalytics(momentsFor(entry.id), {
        timeZone: fixtureCase!.timeZone,
        now: new Date(fixtureCase!.now),
        includeExamples: fixtureCase!.includeExamples,
      });

      expect(Object.keys(actual).sort()).toEqual([...ANALYTICS_FIELDS].sort());
      // Field by field, so a failure names the field that drifted rather than dumping two
      // objects for the reader to compare by eye.
      for (const field of ANALYTICS_FIELDS) {
        expect(actual[field], `${entry.id}.${field}`).toEqual(entry.expected[field]);
      }
    });
  }
});
