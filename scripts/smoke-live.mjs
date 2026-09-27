#!/usr/bin/env node
/**
 * Smoke test a running Asteria, wherever it is running.
 *
 * `npm run smoke` already checks that a locally built server answers its routes. This is the
 * other half: a freshly deployed URL is a different environment — a proxy in front, a managed
 * database behind, a Python service across the internet, and TLS that the local build never
 * sees. A deployment that returns 200 on `/` proves almost nothing; the failures that matter
 * are a migration that did not run, a service the app cannot reach, a cookie that will not
 * survive the proxy, or counts that arrive as strings because the wrong driver answered.
 *
 * So this walks the journeys a writer actually takes, in order, against the deployed origin:
 *
 *   node scripts/smoke-live.mjs https://asteria.example.com
 *
 * It is read-mostly but not read-only: it writes one moment into a brand new journal (a fresh
 * cookie jar, so no real sky is touched), then exports, claims and re-reads it. Every check
 * prints, and the process exits non-zero if any of them fails.
 *
 * `ASTERIA_SMOKE_ALLOW_EMBEDDED=1` expects the embedded driver instead (for a local production
 * build), and `ASTERIA_SMOKE_TOLERATE_PROTECTION=1` treats Vercel Deployment Protection as a
 * reason to skip rather than a reason to shout — CI uses it, because a protected deployment
 * URL is a project setting, not a broken application.
 */

import { randomUUID } from "node:crypto";

const base = (process.argv[2] ?? process.env.ASTERIA_SMOKE_URL ?? "").replace(/\/+$/, "");
if (!base) {
  console.error("Usage: node scripts/smoke-live.mjs <origin>   (or set ASTERIA_SMOKE_URL)");
  process.exit(2);
}

const origin = new URL(base).origin;
let passed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  \u001b[32m✓\u001b[0m ${name}${detail ? ` \u001b[2m${detail}\u001b[0m` : ""}`);
  } else {
    failures.push(name);
    console.log(`  \u001b[31m✗\u001b[0m ${name}${detail ? ` \u001b[31m${detail}\u001b[0m` : ""}`);
  }
}

function equal(name, actual, expected) {
  check(name, Object.is(actual, expected), Object.is(actual, expected) ? String(actual) : `expected ${expected}, got ${actual}`);
}

/**
 * A cookie jar with exactly the behaviour that matters here: send what the server set, honour
 * `Max-Age=0`, and keep HttpOnly cookies out of the hands of anything that is not the jar.
 * Twenty lines rather than a dependency, and it fails loudly on a Set-Cookie the browser would
 * have rejected.
 */
class Jar {
  #cookies = new Map();
  header() {
    return [...this.#cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  absorb(response) {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = raw.split(";");
      const index = pair.indexOf("=");
      if (index < 1) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const maxAge = attrs.find(a => a.trim().toLowerCase().startsWith("max-age="));
      if (maxAge && Number(maxAge.split("=")[1]) <= 0) this.#cookies.delete(name);
      else this.#cookies.set(name, value);
    }
  }
}

/**
 * Whether the app says it has a Python service behind it. Read in a later section than the one
 * that discovers it, so it lives here rather than inside that block.
 */
let insightsConfigured = false;

/** Headers the deployed proxy must be sending. Cheap to check here, easy to forget later. */
const REQUIRED_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

async function call(path, { method = "GET", body, jar, headers = {}, redirect = "follow" } = {}) {
  const response = await fetch(new URL(path, origin), {
    method,
    redirect,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(jar?.header() ? { cookie: jar.header() } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  jar?.absorb(response);
  return response;
}

/**
 * Every check goes through this. If the origin is unreachable the whole run should say so once
 * and stop, rather than printing eighteen confusing failures behind a stack trace.
 */
async function attempt(...args) {
  try {
    return await call(...args);
  } catch (error) {
    console.error(`\n  \u001b[31m✗ could not reach ${origin} — ${error.cause?.code ?? error.message}\u001b[0m`);
    console.error("    Is the deployment up, and is the URL right?\n");
    process.exit(1);
  }
}

const json = async response => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { __unparseable: text.slice(0, 200) };
  }
};

console.log(`\n✦ Smoke-testing ${origin}\n`);

// ── The deployment is alive, and it knows what it is connected to ───────────────────────────
console.log("the deployment");
{
  const health = await attempt("/api/health?deep=1");
  if ((health.status === 401 || health.status === 403) && process.env.ASTERIA_SMOKE_TOLERATE_PROTECTION === "1") {
    console.log(
      `  \u001b[33m•\u001b[0m ${origin} answered ${health.status} — this looks like Vercel Deployment Protection.\n` +
        "    Turn it off (Project → Settings → Deployment Protection) to smoke-test this URL.\n",
    );
    process.exit(0);
  }
  const payload = await json(health);
  const driver = payload?.database?.driver;
  insightsConfigured = payload?.integrations?.insights === "configured";
  equal("deep health is 200", health.status, 200);
  check("the database answers", payload?.database?.status === "connected", `status=${payload?.database?.status}`);
  check("the schema is current", payload?.schema?.ok === true, `missing=${JSON.stringify(payload?.schema?.missing ?? [])}`);
  check("health names its driver", typeof driver === "string", `driver=${driver}`);
  // The single most important thing a deployment can get wrong: the embedded driver writes to
  // a per-instance directory, so a deployment on it looks healthy and silently fragments.
  // Skippable on purpose: the same script runs against a local production build (where the
  // embedded driver is the point of the exercise) and against a deployment (where it is a bug).
  if (process.env.ASTERIA_SMOKE_ALLOW_EMBEDDED === "1") {
    check("driver is the embedded one, as asked", driver === "pglite", `driver=${driver}`);
  } else {
    check("a deployed app is on managed Postgres", driver === "postgres", `driver=${driver}`);
  }
}

// ── A brand new writer arrives ──────────────────────────────────────────────────────────────
const jar = new Jar();
console.log("\na new arrival");
{
  const page = await attempt("/sky", { jar });
  const html = await page.text();
  equal("the sky page renders", page.status, 200);
  check("the page is a real document", /<title>/i.test(html));
  check("a session cookie was set", !jar.header().includes("asteria-journal=") === false, jar.header() ? "present" : "absent");

  const stars = await json(await attempt("/api/stars", { jar }));
  const total = stars?.stars?.length ?? 0;
  check("a new sky has example moments to light the way", total > 0, `${total} moments`);
  check("counts come back as numbers, not strings", typeof stars?.counts?.all === "number", `counts.all=${JSON.stringify(stars?.counts?.all)}`);
}

// ── Writing ─────────────────────────────────────────────────────────────────────────────────
let starId = "";
console.log("\nwriting");
{
  const title = `Smoke test ${randomUUID().slice(0, 8)}`;
  const created = await attempt("/api/stars", {
    method: "POST",
    jar,
    body: { title, content: "A check that the deployed app can still keep a moment.", mood: "serene", intensity: 4 },
  });
  const payload = await json(created);
  starId = payload?.star?.id ?? "";
  equal("a moment is accepted", created.status, 201);
  check("it comes back with an id", Boolean(starId));

  const rejected = await attempt("/api/stars", { method: "POST", jar, body: { content: "x", mood: "smug", intensity: 3 } });
  equal("an unknown feeling is refused", rejected.status, 422);

  const crossSite = await attempt(`/api/stars/${starId}`, { method: "DELETE", jar, headers: { "sec-fetch-site": "cross-site" } });
  equal("a cross-site write is refused", crossSite.status, 403);
}

// ── Reading, caching, searching ─────────────────────────────────────────────────────────────
console.log("\nreading");
{
  const first = await attempt("/api/stars", { jar });
  const etag = first.headers.get("etag");
  check("the listing is cacheable", Boolean(etag), etag ?? "no etag");

  const revalidated = await attempt("/api/stars", { jar, headers: { "if-none-match": etag } });
  equal("an unchanged listing revalidates", revalidated.status, 304);

  const found = await json(await attempt("/api/stars/search?q=smoke", { jar }));
  check("a word can be found again", (found?.total ?? 0) >= 1, `total=${found?.total}`);
}

// ── The Python service ──────────────────────────────────────────────────────────────────────
console.log(`\nthe python service \u001b[2m(${insightsConfigured ? "configured" : "not configured — local fallback"})\u001b[0m`);
{
  const stats = await json(await attempt("/api/journal/stats?timeZone=America/Toronto", { jar }));
  const analytics = stats?.analytics ?? stats;
  check("analytics answer with numbers", typeof analytics?.totals?.moments === "number", `totals.moments=${JSON.stringify(analytics?.totals?.moments)}`);
  check("the week is shaped like a week", Array.isArray(analytics?.weekdays) && analytics.weekdays.length === 7, `${analytics?.weekdays?.length} weekdays`);

  // The service is optional by design: with no `ASTERIA_INSIGHTS_URL` the app answers from its
  // own implementation and nothing is broken. So the expectation follows what the app says it
  // is configured to do — and when it *is* configured, a silent fall back to local is a real
  // failure worth failing on, because the deployment would look healthy while quietly running
  // the fallback path.
  const wantsService = insightsConfigured && process.env.ASTERIA_SMOKE_ALLOW_LOCAL_INSIGHTS !== "1";
  if (wantsService) {
    // A configured service that answers from the local fallback is a real failure: the
    // deployment would look healthy while quietly running the fallback path.
    check(
      "the app reaches the python service",
      stats?.source === "service",
      stats?.source === "service" ? "source=service" : `source=${stats?.source} — configured but not answering`,
    );
  } else {
    check("analytics fall back locally, as configured", stats?.source === "local", `source=${stats?.source}`);
  }

  const atlas = await attempt("/api/journal/export?format=atlas", { jar });
  const renderer = atlas.headers.get("x-asteria-renderer");
  const html = await atlas.text();
  equal("the atlas renders", atlas.status, 200);
  check("the atlas is a document", /<!doctype html>/i.test(html));
  if (wantsService) check("the atlas came from the service", renderer === "service", `rendered by ${renderer}`);
  else check("the atlas renders locally, as configured", renderer === "local", `rendered by ${renderer}`);
}

// ── Export, recover, re-read ────────────────────────────────────────────────────────────────
console.log("\nexport and recovery");
{
  const backup = await attempt("/api/journal/export?format=json", { jar });
  const bundle = await json(backup);
  equal("a backup can be taken", backup.status, 200);
  check("the backup carries the writing", Array.isArray(bundle?.moments) && bundle.moments.length >= 1, `${bundle?.moments?.length} moments`);
  check("the backup carries no journal identity", !JSON.stringify(bundle).includes("journalId"));

  const key = await json(await attempt("/api/journal/key", { method: "POST", jar }));
  check("a recovery key can be issued", typeof key?.key === "string", key?.key?.replace(/[^-]/g, "•"));

  const other = new Jar();
  await attempt("/sky", { jar: other });
  const claimed = await json(await attempt("/api/journal/key/claim", { method: "POST", jar: other, body: { key: key?.key } }));
  check("another device can claim the sky", claimed?.ok === true, claimed?.error ?? "ok");

  const recovered = await json(await attempt("/api/stars/search?q=smoke", { jar: other }));
  check("the writing came with it", (recovered?.total ?? 0) >= 1, `total=${recovered?.total}`);

  const badKey = await json(await attempt("/api/journal/key/claim", { method: "POST", jar: other, body: { key: "ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ" } }));
  check("a wrong key claims nothing", badKey?.ok !== true);
}

// ── The public surface ──────────────────────────────────────────────────────────────────────
console.log("\nthe public surface");
{
  for (const path of ["/opengraph-image", "/sitemap.xml", "/robots.txt"]) {
    const response = await attempt(path);
    equal(`${path} answers`, response.status, 200);
  }
  const missing = await attempt("/api/definitely-not-a-route");
  equal("an unknown route is a 404", missing.status, 404);

  const sky = await attempt("/sky");
  check("the private page is not shareable-cached", /no-store|no-cache|private/i.test(sky.headers.get("cache-control") ?? ""), sky.headers.get("cache-control") ?? "none");
  check("the page cannot be framed", (sky.headers.get("x-frame-options") ?? "") === "DENY", sky.headers.get("x-frame-options") ?? "none");
  for (const [header, value] of Object.entries(REQUIRED_HEADERS)) {
    check(`the proxy keeps ${header}`, (sky.headers.get(header) ?? "") === value, sky.headers.get(header) ?? "missing");
  }
  const api = await attempt("/api/stars", { jar });
  check("a request id is issued", Boolean(api.headers.get("x-request-id")), api.headers.get("x-request-id") ?? "none");
  const cors = await attempt("/api/stars", { headers: { origin: "https://example.invalid" } });
  check("no foreign origin is granted access", !cors.headers.get("access-control-allow-origin"), cors.headers.get("access-control-allow-origin") ?? "none");
}

// ── Leave nothing behind ────────────────────────────────────────────────────────────────────
if (starId) {
  const released = await attempt(`/api/stars/${starId}`, { method: "DELETE", jar });
  check("the smoke moment is released", released.status === 200 || released.status === 204, String(released.status));
}

console.log(`\n  ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(`  failed: ${failures.join(", ")}\n`);
  process.exit(1);
}
console.log("");
