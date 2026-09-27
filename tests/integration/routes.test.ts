import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getStars, POST as postStar } from "@/app/api/stars/route";
import { DELETE as deleteStar, GET as getStar, PATCH as patchStar } from "@/app/api/stars/[id]/route";
import { GET as searchRoute } from "@/app/api/stars/search/route";
import { DELETE as eraseJournal, GET as getJournal, PATCH as patchJournal } from "@/app/api/journal/route";
import { GET as getStats } from "@/app/api/journal/stats/route";
import { GET as getExport } from "@/app/api/journal/export/route";
import { POST as postImport } from "@/app/api/journal/import/route";
import { DELETE as clearSamples, POST as postSamples } from "@/app/api/journal/samples/route";
import { GET as getHealth } from "@/app/api/health/route";
import { POST as postKey } from "@/app/api/journal/key/route";
import { POST as claimKey } from "@/app/api/journal/key/claim/route";
import { GET as getEvents } from "@/app/api/journal/events/route";
import { clearSamples as releaseExamples } from "@/lib/journal";
import { generateSessionToken, resolveJournal, SESSION_COOKIE } from "@/lib/session";
import { closeTestDatabase, freshDatabase, until, useTestDatabase } from "./helpers";

/**
 * The API surface, exercised through the real route handlers.
 *
 * This is where the browser suite's API assertions live now. Playwright is the right tool for
 * "can a person hang a star", but it is the wrong tool for "does a foreign id get 404 instead
 * of 400" — that check needs no browser, no rendered page and no network, and putting it here
 * means it runs on every commit rather than on a schedule.
 *
 * The handlers are called directly with `Request` objects, which is exactly what Next.js does:
 * nothing is stubbed, so the cookie parsing, the rate limiter, the Zod schemas, the DAL and
 * Postgres are all the real ones.
 */

const BASE = "http://localhost:3000";

function request(path: string, { method = "GET", token, body, headers = {} }: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new Request(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/** A browser: a token, and the journal it opens. */
async function browser() {
  const token = generateSessionToken();
  const journal = await resolveJournal({ token, userAgent: "vitest" });
  return { token, journalId: journal.journalId };
}

const json = async <T>(response: Response): Promise<T> => (await response.json()) as T;

beforeAll(async () => {
  useTestDatabase();
  await freshDatabase();
}, 180_000);

afterAll(async () => {
  await closeTestDatabase();
});

describe("health", () => {
  it("reports the schema as ready", async () => {
    const response = await getHealth(request("/api/health"));
    expect(response.status).toBe(200);
  });
});

describe("the sky", () => {
  it("seeds a new journal with the example sky and reports counts", async () => {
    const { token } = await browser();
    const body = await json<{ stars: unknown[]; counts: { all: number; examples: number; moments: number } }>(await getStars(request("/api/stars", { token })));
    expect(body.stars).toHaveLength(24);
    expect(body.counts).toMatchObject({ all: 24, examples: 24, moments: 0 });
  });

  it("keeps a moment, allocates it a place, and never reuses that place", async () => {
    const { token } = await browser();
    const created = await postStar(request("/api/stars", { method: "POST", token, body: { title: "The light we kept", content: "The room was quiet. For that moment, enough.", mood: "tender", intensity: 4 } }));
    expect(created.status).toBe(201);
    const { star } = await json<{ star: { id: string; x: number; y: number; isSample: boolean; mood: string } }>(created);
    expect(star.isSample).toBe(false);
    expect(Number.isFinite(star.x) && Number.isFinite(star.y)).toBe(true);

    // Released, then another moment of the same feeling: the new star must take the *next*
    // place, not the one the released star still occupies in the constellation.
    expect((await deleteStar(request(`/api/stars/${star.id}`, { method: "DELETE", token }), { params: Promise.resolve({ id: star.id }) })).status).toBe(200);
    const second = await json<{ star: { id: string; x: number } }>(await postStar(request("/api/stars", { method: "POST", token, body: { content: "Another tender moment, later on.", mood: "tender", intensity: 3 } })));
    expect(second.star.x).not.toBeCloseTo(star.x, 4);
  });

  it("answers a foreign id the same way as an id that does not exist", async () => {
    const me = await browser();
    const them = await browser();
    const theirs = await json<{ stars: { id: string }[] }>(await getStars(request("/api/stars", { token: them.token })));
    const theirStar = theirs.stars[0].id;

    // 404 rather than 403: a journal must not be able to learn that another journal's
    // moment exists.
    for (const response of [
      await getStar(request(`/api/stars/${theirStar}`, { token: me.token }), { params: Promise.resolve({ id: theirStar }) }),
      await patchStar(request(`/api/stars/${theirStar}`, { method: "PATCH", token: me.token, body: { title: "mine now" } }), { params: Promise.resolve({ id: theirStar }) }),
      await deleteStar(request(`/api/stars/${theirStar}`, { method: "DELETE", token: me.token }), { params: Promise.resolve({ id: theirStar }) }),
      await getStar(request("/api/stars/00000000-0000-4000-8000-000000000000", { token: me.token }), { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }) }),
    ]) {
      expect(response.status).toBe(404);
    }
  });

  it("refuses a request with no journal at all", async () => {
    // The proxy mints the cookie on the way in, so a cookie-less API call is anonymous rather
    // than a new journal: an endpoint that provisions on `GET` is a way to fill a database.
    expect((await getStars(request("/api/stars"))).status).toBe(401);
    expect((await getJournal(request("/api/journal"))).status).toBe(401);
  });

  it("answers a conditional read with 304 and no body", async () => {
    const { token } = await browser();
    const first = await getStars(request("/api/stars", { token }));
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    const second = await getStars(request("/api/stars", { token, headers: { "if-none-match": etag! } }));
    expect(second.status).toBe(304);
  });

  it("validates what it is given, in the product's voice", async () => {
    const { token } = await browser();
    const cases: [unknown, number][] = [
      [{ content: "", mood: "tender", intensity: 3 }, 422],
      [{ content: "ok", mood: "unknown", intensity: 3 }, 422],
      [{ content: "ok", mood: "tender", intensity: "3" }, 422],
      [{ content: "ok", mood: "tender", intensity: 3, createdAt: "2026-02-30T12:00:00Z" }, 422],
      // Creation is about the moment; starring is a separate act, so a `favorite` flag on
      // create is refused rather than quietly ignored. Pinned here because it is the kind of
      // strictness that gets "fixed" into a silent bug later.
      [{ content: "ok", mood: "tender", intensity: 3, favorite: true }, 422],
    ];
    for (const [body, status] of cases) {
      const response = await postStar(request("/api/stars", { method: "POST", token, body }));
      expect(response.status, JSON.stringify(body)).toBe(status);
    }

    // A name that is too long is trimmed to the limit rather than refused: the writer keeps
    // their moment, with the name shortened, instead of losing it to a form argument.
    const long = await postStar(request("/api/stars", { method: "POST", token, body: { content: "ok", mood: "tender", intensity: 3, title: "x".repeat(200) } }));
    expect(long.status).toBe(201);
    const written = await json<{ star: { title: string } }>(long);
    expect(written.star.title.length).toBeLessThanOrEqual(80);
  });

  it("stars and unstars without moving the star", async () => {
    const { token } = await browser();
    const { star } = await json<{ star: { id: string; x: number; y: number } }>(await postStar(request("/api/stars", { method: "POST", token, body: { content: "A moment worth keeping twice.", mood: "serene", intensity: 2 } })));

    const starred = await json<{ star: { favorite: boolean; x: number; isSample: boolean } }>(await patchStar(request(`/api/stars/${star.id}`, { method: "PATCH", token, body: { favorite: true } }), { params: Promise.resolve({ id: star.id }) }));
    expect(starred.star.favorite).toBe(true);
    expect(starred.star.isSample).toBe(false);
    expect(starred.star.x).toBeCloseTo(star.x, 4);

    const unstarred = await json<{ star: { favorite: boolean } }>(await patchStar(request(`/api/stars/${star.id}`, { method: "PATCH", token, body: { favorite: false } }), { params: Promise.resolve({ id: star.id }) }));
    expect(unstarred.star.favorite).toBe(false);

    // The activity log is telemetry: it is written without blocking the request, so a test
    // that reads it immediately is racing the insert. Polling is the honest way to assert on
    // something the product deliberately does not couple to the write path.
    const events = await until(
      async () => json<{ events: { kind: string }[] }>(await getEvents(request("/api/journal/events", { token }))),
      value => value.events.some(event => event.kind === "star.unstarred"),
    );
    const kinds = events.events.map(event => event.kind);
    expect(kinds, JSON.stringify(kinds)).toEqual(expect.arrayContaining(["star.created", "star.starred", "star.unstarred"]));
    // The log is metadata: no titles, no bodies, ever.
    expect(JSON.stringify(events)).not.toContain("A moment worth keeping twice");
  });

  it("releases, restores, and keeps the place either way", async () => {
    const { token } = await browser();
    const { star } = await json<{ star: { id: string; x: number; y: number } }>(await postStar(request("/api/stars", { method: "POST", token, body: { content: "A moment to let go of, then keep.", mood: "vesper", intensity: 3 } })));

    expect((await deleteStar(request(`/api/stars/${star.id}`, { method: "DELETE", token }), { params: Promise.resolve({ id: star.id }) })).status).toBe(200);
    const sky = await json<{ stars: { id: string }[] }>(await getStars(request("/api/stars", { token })));
    expect(sky.stars.map(entry => entry.id)).not.toContain(star.id);
    // The sky no longer shows it, the journal remembers it: a released moment is something
    // the writer chose to let go of, not something that never happened.
    const counts = await json<{ counts: { released: number; all: number } }>(await getJournal(request("/api/journal", { token })));
    expect(counts.counts.released).toBe(1);

    const restored = await json<{ star: { id: string; x: number; y: number } }>(await patchStar(request(`/api/stars/${star.id}`, { method: "PATCH", token, body: { restore: true } }), { params: Promise.resolve({ id: star.id }) }));
    expect(restored.star.id).toBe(star.id);
    expect(restored.star.x).toBeCloseTo(star.x, 4);
    expect(restored.star.y).toBeCloseTo(star.y, 4);
  });
});

describe("search", () => {
  it("finds a writer's words and nobody else's", async () => {
    const { token, journalId } = await browser();
    // The example sky is cleared first so a match can only be the writer's own moment: one of
    // the samples mentions a kitchen, which is exactly the kind of coincidence that makes a
    // test pass or fail depending on the row order.
    await releaseExamples(journalId);
    const kept = await postStar(request("/api/stars", { method: "POST", token, body: { title: "Kitchen light", content: "I stood in the rectangle of sun for longer than I needed to.", mood: "luminous", intensity: 3 } }));
    expect(kept.status).toBe(201);

    const mine = await json<{ total: number; stars: { id: string; title: string }[]; facets: { nights: number } }>(await searchRoute(request("/api/stars/search?q=kitchen", { token })));
    expect(mine.total).toBe(1);
    expect(mine.stars[0].title).toBe("Kitchen light");
    expect(mine.facets.nights).toBe(1);

    // Another journal may have its own kitchen (its example sky does); what it must never
    // have is *this* one.
    const other = await browser();
    const theirs = await json<{ stars: { id: string }[] }>(await searchRoute(request("/api/stars/search?q=kitchen", { token: other.token })));
    expect(theirs.stars.map(star => star.id)).not.toContain(mine.stars[0].id);
  });

  it("survives the queries people actually type", async () => {
    const { token } = await browser();
    for (const query of ["don't", "walk & rain", "%%%", "", "  ", "a", "kitchen"]) {
      const response = await searchRoute(request(`/api/stars/search?q=${encodeURIComponent(query)}`, { token }));
      expect(response.status, query).toBe(200);
    }
  });
});

describe("a journal", () => {
  it("counts what is in it, honestly", async () => {
    const { token } = await browser();
    const body = await json<{ counts: { all: number; moments: number; examples: number; released: number; constellations: number } }>(await getJournal(request("/api/journal", { token })));
    // `moments` is what the writer made; `examples` is what the tour planted; `constellations`
    // counts feelings they have actually written in, which is none of them yet.
    expect(body.counts).toMatchObject({ all: 24, moments: 0, examples: 24, released: 0, constellations: 0 });
  });

  it("clears the example sky on request", async () => {
    const { token } = await browser();
    expect((await clearSamples(request("/api/journal/samples", { method: "DELETE", token }))).status).toBe(200);
    const body = await json<{ counts: { all: number; examples: number; moments: number; released: number } }>(await getJournal(request("/api/journal", { token })));
    // Cleared examples vanish from every count — they were never the writer's — but the rows
    // stay, soft-deleted, because the place a star occupied is never handed to another memory.
    expect(body.counts).toMatchObject({ all: 0, moments: 0, examples: 0, released: 0 });
    expect((await json<{ stars: unknown[] }>(await getStars(request("/api/stars", { token })))).stars).toEqual([]);

    // And they can be asked for again.
    const replanted = await json<{ planted: number }>(await postSamples(request("/api/journal/samples", { method: "POST", token })));
    expect(replanted.planted).toBe(24);
    expect((await json<{ counts: { examples: number } }>(await getJournal(request("/api/journal", { token })))).counts.examples).toBe(24);
  });

  it("remembers a display name and rejects nonsense", async () => {
    const { token } = await browser();
    const named = await json<{ journal: { displayName: string } }>(await patchJournal(request("/api/journal", { method: "PATCH", token, body: { displayName: "Peter" } })));
    expect(named.journal.displayName).toBe("Peter");

    // A display name is cosmetic, so an over-long one is trimmed to the limit rather than
    // rejected — the writer gets the name they wanted, shortened, instead of an error about
    // something they did not care about.
    const long = await json<{ journal: { displayName: string } }>(await patchJournal(request("/api/journal", { method: "PATCH", token, body: { displayName: "x".repeat(100) } })));
    expect(long.journal.displayName).toHaveLength(60);

    // A mood is not cosmetic: an unknown one is refused, with copy.
    const bad = await patchJournal(request("/api/journal", { method: "PATCH", token, body: { displayName: "ok", unknownField: 1 } }));
    expect(bad.status).toBe(422);
  });

  it("will not erase without the words", async () => {
    const { token } = await browser();
    expect((await eraseJournal(request("/api/journal", { method: "DELETE", token, body: { confirm: "yes" } }))).status).toBe(422);
    expect((await eraseJournal(request("/api/journal", { method: "DELETE", token, body: { confirm: "release my sky" } }))).status).toBe(200);
    // The session is gone with the journal: the same cookie now opens a brand-new sky.
    const after = await json<{ counts: { all: number; examples: number } }>(await getJournal(request("/api/journal", { token })));
    expect(after.counts.examples).toBeGreaterThan(0);
  });
});

describe("analytics", () => {
  it("prefers the service and says so, and falls back without a word to the writer", async () => {
    const { token } = await browser();
    const body = await json<{ analytics: { totals: { moments: number } }; source: string }>(await getStats(request("/api/journal/stats?timeZone=America/Toronto", { token })));
    expect(["service", "local"]).toContain(body.source);
    expect(body.analytics.totals.moments).toBe(0);
  });

  it("falls back to UTC for a timezone it does not recognise", async () => {
    const { token } = await browser();
    const body = await json<{ analytics: { timeZone: string } }>(await getStats(request("/api/journal/stats?timeZone=Mars/Olympus", { token })));
    expect(body.analytics.timeZone).toBe("UTC");
  });
});

describe("export and import", () => {
  it("exports a bundle with no identity in it, and imports it back", async () => {
    const source = await browser();
    const kept = await postStar(request("/api/stars", { method: "POST", token: source.token, body: { title: "A walk after rain", content: "The street smelled of wet stone.", mood: "luminous", intensity: 4 } }));
    expect(kept.status).toBe(201);

    const exported = await getExport(request("/api/journal/export?format=json", { token: source.token }));
    expect(exported.status).toBe(200);
    const bundle = await json<{ version: number; moments: { id: string }[]; checksum: string }>(exported);
    const serialised = JSON.stringify(bundle);
    expect(serialised).not.toContain(source.journalId);
    expect(serialised).not.toContain(source.token);
    // Examples are not the writer's writing, so the default export leaves them out — a backup
    // of a journal is a backup of *that person*, not of our demo.
    expect(bundle.moments).toHaveLength(1);
    expect(bundle.version).toBe(3);

    const withExamples = await json<{ moments: unknown[] }>(await getExport(request("/api/journal/export?format=json&includeExamples=true", { token: source.token })));
    expect(withExamples.moments).toHaveLength(25);

    const destination = await browser();
    // The export file *is* the import payload: the bundle can be posted back without being
    // unwrapped, which is the difference between "keep this file" and "keep this file, but
    // only the part you can find".
    const importResponse = await postImport(request("/api/journal/import", { method: "POST", token: destination.token, body: { ...withExamples, mode: "merge" } }));
    const imported = await json<{ imported?: number; duplicates?: number; error?: string }>(importResponse);
    expect(importResponse.status, JSON.stringify(imported)).toBe(201);
    expect(imported.imported).toBe(25);
    expect(imported.duplicates).toBe(0);

    // Importing the same bundle again is a no-op rather than a second copy of the journal.
    const again = await json<{ imported?: number; duplicates?: number }>(await postImport(request("/api/journal/import", { method: "POST", token: destination.token, body: { ...withExamples, mode: "merge" } })));
    expect(again.imported).toBe(0);
    expect(again.duplicates).toBe(25);
  });

  it("renders markdown and an atlas, and refuses an unknown format", async () => {
    const { token } = await browser();
    const markdown = await getExport(request("/api/journal/export?format=markdown", { token }));
    expect(markdown.status).toBe(200);
    expect(await markdown.text()).toContain("#");

    const atlas = await getExport(request("/api/journal/export?format=atlas", { token }));
    expect(atlas.status).toBe(200);
    expect(atlas.headers.get("x-asteria-renderer")).toMatch(/service|local/);
    expect(await atlas.text()).toContain("<!doctype html>");

    expect((await getExport(request("/api/journal/export?format=wallpaper", { token }))).status).toBe(400);
  });
});

describe("recovery keys", () => {
  it("issues one, and opens the same sky with it from another device", async () => {
    const original = await browser();
    await postStar(request("/api/stars", { method: "POST", token: original.token, body: { content: "The one thing I would not want to lose.", mood: "serene", intensity: 5 } }));

    const issued = await json<{ key: string }>(await postKey(request("/api/journal/key", { method: "POST", token: original.token })));
    expect(issued.key).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/);

    // A "new device": a token the proxy has minted for it, which the claim replaces.
    const fresh = generateSessionToken();
    await resolveJournal({ token: fresh, userAgent: "another device" });
    const claimed = await claimKey(request("/api/journal/key/claim", { method: "POST", token: fresh, body: { key: issued.key.toLowerCase().replace(/-/g, " ") } }));
    expect(claimed.status).toBe(200);

    // Claiming rotates the device onto a new session token, exactly as a sign-in would: the
    // old cookie belonged to the journal this device had a moment ago, not to the sky it just
    // opened. A client that ignores the new cookie would keep looking at the wrong journal.
    const rotated = claimed.headers.get("set-cookie")?.match(/asteria-journal=([^;]+)/)?.[1];
    expect(rotated).toBeTruthy();

    const recovered = await json<{ stars: { content: string }[] }>(await getStars(request("/api/stars", { token: rotated! })));
    expect(recovered.stars.some(star => star.content.includes("would not want to lose"))).toBe(true);

    // The key itself is never readable back: it can only be replaced, and replacing it is
    // what makes a lost device harmless.
    const reissued = await json<{ key: string }>(await postKey(request("/api/journal/key", { method: "POST", token: rotated! })));
    expect(reissued.key).not.toBe(issued.key);
  });

  it("answers a wrong key the same way it would answer a key that was never issued", async () => {
    const token = generateSessionToken();
    await resolveJournal({ token, userAgent: "another device" });
    const response = await claimKey(request("/api/journal/key/claim", { method: "POST", token, body: { key: "00000-00000-00000-00000-00000" } }));
    expect(response.status).toBe(404);
    expect((await response.json()).error).not.toMatch(/exist|issued|expired/i);
  });
});
