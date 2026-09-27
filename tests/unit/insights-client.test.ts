import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { insightsServiceConfigured, requestAnalytics, requestAtlas } from "@/lib/insights-service";

/**
 * The client half of the Python service contract.
 *
 * These tests exist because of a real bug: the service answers `/atlas` with `text/html` — the
 * document *is* the payload — while this client was parsing every response as JSON, so the
 * atlas fell back to the local renderer on every request and nothing anywhere said so. A
 * stubbed `fetch` is the right tool for it: the question is not whether Python can render an
 * atlas (its own suite asks that) but what this process does with each answer it might get.
 */

const URL_BASE = "https://insights.example.com";
const SECRET = "a-shared-secret-long-enough";

const moments = [
  { id: "one", mood: "serene" as const, intensity: 3, createdAt: "2026-03-24T23:30:00.000Z" },
];

const analyticsPayload = {
  generatedAt: "2026-03-25T18:00:00.000Z",
  timeZone: "America/Toronto",
  range: { firstDay: "2026-03-24", lastDay: "2026-03-24", spanDays: 0 },
  totals: { moments: 1, nights: 1, constellations: 1, starred: 0, examples: 0 },
  cadence: { currentRun: 1, longestRun: 1, medianGapDaysX10: 0, longestGapDays: 0, nightsThisMonth: 1, momentsThisWeek: 1, densityBps: 0 },
  weekdays: [0, 0, 0, 0, 0, 0, 0],
  hours: Array.from({ length: 24 }, () => 0),
  moods: [],
  intensity: { averageX100: 300, histogram: [0, 1, 0, 0, 0, 0] },
  flow: { weekdayShareBps: null, weekendShareBps: null },
  notable: { brightestNight: null, firstMoment: null, lastMoment: null },
};

/** Every request the client made, for assertions about what it signed. */
let seen: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];

function stubFetch(responder: (request: { url: string; headers: Record<string, string>; body: string }) => Response | Promise<Response>) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const body = String(init?.body ?? "");
    const url = String(input);
    seen.push({ url, method: init?.method ?? "GET", headers, body });
    return responder({ url, headers, body });
  });
}

beforeEach(() => {
  seen = [];
  process.env.ASTERIA_INSIGHTS_URL = URL_BASE;
  process.env.ASTERIA_INSIGHTS_SECRET = SECRET;
  delete process.env.ASTERIA_INSIGHTS_TIMEOUT_MS;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ASTERIA_INSIGHTS_URL;
  delete process.env.ASTERIA_INSIGHTS_SECRET;
});

describe("configuration", () => {
  it("reports whether a service is configured, without leaking the secret", async () => {
    expect(insightsServiceConfigured()).toBe(true);
    delete process.env.ASTERIA_INSIGHTS_URL;
    expect(insightsServiceConfigured()).toBe(false);
  });

  it("falls back locally when nothing is configured, without making a request", async () => {
    stubFetch(() => new Response("should not be called", { status: 500 }));
    delete process.env.ASTERIA_INSIGHTS_URL;
    const result = await requestAnalytics(moments, { timeZone: "America/Toronto" });
    expect(result.source).toBe("local");
    expect(seen).toHaveLength(0);
  });
});

describe("what a request looks like on the wire", () => {
  it("signs the timestamp, the path and the raw body", async () => {
    stubFetch(() => Response.json({ analytics: analyticsPayload, source: "service" }));
    await requestAnalytics(moments, { timeZone: "America/Toronto", now: new Date("2026-03-25T18:00:00.000Z") });

    const request = seen[0];
    const timestamp = request.headers["x-asteria-timestamp"];
    expect(timestamp).toMatch(/^\d+$/);
    // Recomputed here from the same three parts, the way the Python service does it.
    const expected = createHmac("sha256", SECRET).update(`${timestamp}./insights.${request.body}`).digest("hex");
    expect(request.headers["x-asteria-signature"]).toBe(expected);
    expect(request.url).toBe(`${URL_BASE}/insights`);
  });

  it("sends metadata only — never the writing", async () => {
    stubFetch(() => Response.json({ analytics: analyticsPayload, source: "service" }));
    await requestAnalytics(
      [{ id: "one", mood: "tender", intensity: 4, createdAt: new Date().toISOString(), favorite: true, isSample: false }],
      { timeZone: "UTC" },
    );
    const sent = JSON.parse(seen[0].body);
    expect(sent.moments[0]).toEqual({
      id: "one",
      mood: "tender",
      intensity: 4,
      createdAt: expect.any(String),
      favorite: true,
      isSample: false,
    });
  });
});

describe("deciding whether to believe the answer", () => {
  it("takes analytics from the service when it answers with analytics", async () => {
    stubFetch(() => Response.json({ analytics: analyticsPayload, source: "service" }));
    const result = await requestAnalytics(moments, { timeZone: "UTC" });
    expect(result.source).toBe("service");
    expect(result.analytics.totals.nights).toBe(1);
  });

  it("falls back when the body is not the shape it claims", async () => {
    stubFetch(() => Response.json({ hello: "world" }));
    const result = await requestAnalytics(moments, { timeZone: "UTC" });
    expect(result.source).toBe("local");
    expect(result.analytics.totals.moments).toBe(1); // the local implementation still answered
  });

  it("falls back on an error status, and on an unparseable 200", async () => {
    stubFetch(() => new Response("nope", { status: 401 }));
    expect((await requestAnalytics(moments, { timeZone: "UTC" })).source).toBe("local");

    stubFetch(() => new Response("<html>a proxy said hi</html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect((await requestAnalytics(moments, { timeZone: "UTC" })).source).toBe("local");
  });

  it("falls back when the service never answers", async () => {
    stubFetch(() => {
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    });
    const result = await requestAnalytics(moments, { timeZone: "UTC" });
    expect(result.source).toBe("local");
  });
});

describe("the atlas is a document, not an envelope", () => {
  const document = `<!doctype html><html><body>${"<p>a night</p>".repeat(40)}</body></html>`;

  it("accepts text/html from the service", async () => {
    stubFetch(() => new Response(document, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));
    const result = await requestAtlas({ moments: [], timeZone: "UTC", title: "My sky", now: new Date().toISOString() });
    expect(result?.source).toBe("service");
    expect(result?.html.startsWith("<!doctype html>")).toBe(true);
  });

  it("treats a JSON envelope as a failure — the regression this file was written for", async () => {
    stubFetch(() => Response.json({ html: document }));
    const result = await requestAtlas({ moments: [], timeZone: "UTC", title: "My sky", now: new Date().toISOString() });
    expect(result).toBeNull();
  });

  it("refuses to call a fragment an atlas", async () => {
    stubFetch(() => new Response("<p>too small</p>", { status: 200, headers: { "content-type": "text/html" } }));
    expect(await requestAtlas({ moments: [], timeZone: "UTC", title: "My sky", now: new Date().toISOString() })).toBeNull();
  });

  it("refuses an HTML error page served with the wrong content type", async () => {
    stubFetch(() => new Response(document, { status: 200, headers: { "content-type": "text/plain" } }));
    expect(await requestAtlas({ moments: [], timeZone: "UTC", title: "My sky", now: new Date().toISOString() })).toBeNull();
  });
});
