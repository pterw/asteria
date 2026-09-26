# Asteria

> *Your memories become a night sky that changes as you live.*

**Live application**: [asteria-two.vercel.app](https://asteria-two.vercel.app)

![Asteria night sky](public/images/asteria-sky.png)

Asteria is an intentional journal with one unusual idea: it does not ask you to write every day,
it asks you to notice something. Each moment you keep is hung as a star among the moments of the
same feeling, threaded to its nearest neighbour, so six feelings become six constellations that
grow as you live. Wind time back and the sky un-forms exactly as it formed; press play and watch
your days re-illuminate.

![Asteria landing](public/images/asteria-landing.png)

---

## Table of contents

1. [The short version](#the-short-version)
2. [Architecture](#architecture)
3. [Design decisions worth defending](#design-decisions-worth-defending)
4. [Data model](#data-model)
5. [API](#api)
6. [Search](#search)
7. [The Python insights service](#the-python-insights-service)
8. [Testing](#testing)
9. [Running it locally](#running-it-locally)
10. [Connecting a managed Postgres](#connecting-a-managed-postgres)
11. [Deploying it](#deploying-it)
11. [Environment variables](#environment-variables)
12. [Repository layout](#repository-layout)
13. [Documentation](#documentation)

---

## The short version

| | |
| --- | --- |
| **Product** | A private journal that renders itself as a night sky. No feed, no scores, no streak guilt. |
| **Frontend** | Next.js 16 App Router, React 19, Tailwind 4, one hand-written canvas engine for the sky. |
| **Data** | Postgres (Drizzle ORM). Embedded PGlite in development and tests, a managed server in production. |
| **Backend** | Route handlers for everything the writer does; a small **Python/FastAPI service** for rhythm analytics and the printable atlas, with a TypeScript equivalent so it can never be a single point of failure. |
| **Identity** | No accounts. An opaque token in an HttpOnly cookie, stored only as a hash, plus a printable recovery key for moving a journal between devices. |
| **Tests** | 143 TypeScript tests (unit + integration against a real Postgres), 19 Python tests, a cross-language contract, and a browser suite that runs in CI. |

---

## Architecture

```mermaid
flowchart TB
    subgraph Browser
        UI["React 19 · sky canvas · modals"]
        API["fetch (src/lib/client-api.ts)"]
    end

    subgraph Next["Next.js on Vercel"]
        Proxy["proxy.ts — session mint/forward, CSP, cross-site write guard"]
        Pages["/ · /about · /sky (server-rendered)"]
        Routes["/api/* — stars, journal, search, export, import, health"]
        Lib["src/lib — journal, search, session, analytics, export, ratelimit"]
    end

    subgraph Python["services/insights (own Vercel project)"]
        Insights["FastAPI — /insights · /atlas · /health"]
    end

    DB[("Postgres<br/>Neon · Supabase · RDS<br/>(PGlite when developing)")]

    UI --> API --> Routes
    Pages --> Lib
    Routes --> Lib
    Lib -->|"signed, metadata only; falls back locally"| Insights
    Lib --> DB
    Proxy --> Pages
    Proxy --> Routes
```

Nothing in the diagram is decorative: the sky is rendered on a canvas rather than as DOM, the
proxy is where identity is minted, and the Python service sits beside the app rather than in
front of it.

---

## Design decisions worth defending

**The URL is the state.** View, feeling, period, day and sort all live in the query string
(`readWorkspaceLocation` / `workspaceHref`). A filtered sky survives a reload, is shareable with
a future self, and the back button works. It also means the server can render the first paint of
a filtered sky instead of flashing the unfiltered one.

**Identity without accounts.** A journal is identified by a 32-byte random token in an
`HttpOnly` cookie, stored in the database only as a SHA-256 hash. The journal's primary key is
derived with HMAC, so two concurrent first requests from the same browser converge on one
journal instead of racing to create two. A recovery key (Crockford base32, 125 bits, stored as an
HMAC) moves a sky to another device. There is no email, no password, and no way for us to look up
somebody's journal — which is the point, and also the reason the recovery key is shown exactly
once and can never be re-issued.

**Placement is permanent.** A star's position is allocated inside the transaction that creates it,
under a `pg_advisory_xact_lock` on the journal, and the mood's index counts *every* row of that
feeling including released ones. A released star is soft-deleted, so its place is never handed to
a different memory. The sky you saw yesterday is the same sky today.

**Nothing is fabricated.** The previous build served made-up sample stars whenever the database
was unreachable, which is the worst possible failure: a journal that quietly invents memories.
Now `loadSky()` returns `{ ok: false, reason }` and the page renders an honest, in-voice
unavailable state (and `/api/health?deep=1` tells an operator what is actually wrong).

**Analytics never see your words.** The Python service receives `id`, `mood`, `intensity`,
`createdAt` — never titles, never bodies. The atlas does carry the writing, because the atlas *is*
the writing, and that request is signed and answered `no-store`.

**Two implementations, one answer sheet.** The rhythm arithmetic exists in TypeScript (so the app
works when the service is cold) and in Python (so the atlas and the heavier analysis are not
limited by the Next.js runtime). Both are asserted against `contract/analytics.json`, which is
generated from the TypeScript and reviewed like any other file. Ratios are integer-scaled and
rounded half-up specifically so two languages with different float formatting cannot disagree.

**Migrations run in the build, and refuse to lie.** `npm run vercel-build` migrates the database
and then builds, so a deployment never serves a schema it does not have. The run is one
transaction taking a `pg_advisory_xact_lock`: concurrent builds cannot double-apply a file, and
a failure halfway leaves the database untouched rather than half-migrated. The lock is
transaction-scoped on purpose — a session-level lock is meaningless through a transaction-mode
pooler such as Neon or PgBouncer, where two statements from "one client" can run on two
different server connections. Both the migration CLI and the app refuse to run on Vercel
without `DATABASE_URL`, because the embedded database writes to a directory and a serverless
filesystem gives every instance its own: a deployment missing its connection string would look
healthy while each instance quietly kept a separate sky. `ASTERIA_DB=pglite` is the explicit
opt-in for a deliberate demo deployment.

**The production driver is the one CI tests.** The integration suite runs twice: once against
the embedded driver for speed, and once against a real `postgres:17` service on the `pg` pool.
That second run is what caught the class of bug the first one cannot see — for instance that
`count(*)` is `bigint`, which the embedded driver returns as a number and node-postgres returns
as a string, so an uncast aggregate would have shipped `{"moments":"1"}` to a browser.

**A Neon hostname swaps the transport, not the application.** Neon's serverless driver tunnels
the Postgres wire protocol over a WebSocket, so a function has no TCP socket to leave open and
nothing to leak when the platform suspends it between requests. It is detected from the
connection string rather than configured, because a Vercel preview branch is exactly the place
where a second required variable gets forgotten. Everything above the driver is unchanged:
Drizzle, the pool options, the transactions.

What is *not* unchanged is which of Neon's two transports we use. Neon also offers `neon()` over
HTTP, which is faster for a single query and cannot hold a session: no `BEGIN`/`COMMIT` across
round trips, no advisory locks. Asteria places every star inside a transaction that takes
`pg_advisory_xact_lock(hashtext(journalId))` to allocate its position among stars that felt the
same, and its migrations are one transaction each. On the HTTP transport, star placement would
have to become a different — and weaker — algorithm. So the WebSocket transport is not a
preference here; it is the one that can express what this application does.

Migrations also prefer Neon's *direct* connection string when one is configured
(`DATABASE_URL_UNPOOLED`, or `POSTGRES_URL_NON_POOLING` as Vercel's integration names it). The
migration is already pooler-safe, but schema changes should not have to queue behind
application traffic, and Neon's own documentation recommends the direct connection for exactly
this. The application itself keeps using the pooled one.

---

## Data model

Five tables, all in `drizzle/0000_init.sql` (generated from `src/db/schema.ts`):

| Table | What it holds | Notes |
| --- | --- | --- |
| `journals` | one row per sky | created/last-seen timestamps, display name, seed flag |
| `sessions` | device tokens | `sha256(token)`, never the token itself; expiry, user agent, revocation |
| `stars` | the memories | generated `search` tsvector (title A, body B) with a GIN index; soft delete; sample flag |
| `journal_events` | metadata-only activity log | kinds like `star.created`, `star.released`, `recovery.issued` — no writing, ever |
| `rate_limits` | fixed-window counters | one row per `(bucket, window)` so every serverless instance shares an allowance |

`drizzle/legacy/0001_adopt_v1.sql` brings a database created by the v1 build (UUID-cookie era) to
this shape additively, so an existing sky survives the rewrite.

---

## API

All routes are dynamic, rate-limited where they write, and answer with the request id in
`x-request-id`.

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/stars` | `GET`, `POST` | the sky (with counts and an ETag) · keep a moment |
| `/api/stars/[id]` | `GET`, `PATCH`, `DELETE` | one moment · edit/star it · release it |
| `/api/stars/search` | `GET` | full-text search with facets |
| `/api/journal` | `GET`, `PATCH`, `DELETE` | counts + settings · erase everything (`"release my sky"`) |
| `/api/journal/key` | `GET`, `POST`, `DELETE` | recovery key: status · issue · revoke |
| `/api/journal/key/claim` | `POST` | claim a sky with a recovery key |
| `/api/journal/sessions` | `GET`, `DELETE` | devices · sign the others out |
| `/api/journal/samples` | `DELETE` | clear the example moments |
| `/api/journal/stats` | `GET` | rhythm analytics (`source: "service" \| "local"`) |
| `/api/journal/export` | `GET` | `format=json\|markdown\|atlas` |
| `/api/journal/import` | `POST` | re-import a bundle (`merge` or `replace`) |
| `/api/journal/events` | `GET` | the activity log |
| `/api/health` | `GET`, `POST` | liveness · `?deep=1` checks the schema, `POST` retries the connection |

---

## Search

Search is Postgres, not a `LIKE` sweep: `stars.search` is a generated `tsvector` (title weighted
`A`, body `B`) with a GIN index. A query of three characters or more becomes a prefix query
(`term:*`) ranked with `ts_rank_cd`; one or two characters fall back to an escaped substring
match, because a search box that looks broken on the second keystroke is worse than one that does
not use the index for a moment. The facets — per-feeling counts, starred, examples, distinct
nights — are computed over the whole match set in the same round trip as the page of results, and
every sort ends with `id` so paging can never repeat one row and hide another.

---

## The Python insights service

`services/insights` is a FastAPI app with three endpoints. It is deployed as its own Vercel
project (Root Directory `services/insights`); the Next.js app calls it over HTTPS with an
HMAC-SHA256 signature over `timestamp.path.body`, a ±300 s freshness window and a replay cache.
When it is unreachable, or unconfigured, or answers with something unexpected, the app logs at
debug level and answers from the TypeScript implementation — a journal must not depend on a
second process being warm to show somebody their own data.

See [`services/insights/README.md`](services/insights/README.md) for the endpoints, the exact
signing contract and the deploy steps.

---

## Testing

```bash
npm run verify        # everything CI checks, in the order a failure is cheapest to fix
npm test              # unit + integration + insights service + browser
npm run smoke:live URL  # is the deployment actually working?
```

`smoke:live` is the one you run after deploying. A deployment that answers 200 on `/` proves
almost nothing — the failures that matter are a migration that did not run, a Python service the
app cannot reach, a cookie the proxy drops, or counts that arrive as strings because the wrong
driver answered. So it walks the real journeys against the origin you give it: deep health and
which driver is behind it, a new arrival's first page and cookie, writing a moment and having an
unknown feeling refused, an ETag revalidation, a search, analytics and the atlas from the Python
service, an export, a recovery key claimed from a second device, the security headers the proxy
must preserve, and 404s on the routes that should not exist. It writes into a brand new journal
and releases the moment it created, so no real sky is touched. `npm run verify` runs it against
the local production build with `ASTERIA_SMOKE_ALLOW_EMBEDDED=1`; CI runs it against the URL it
just deployed.

| Suite | What it covers | Where |
| --- | --- | --- |
| Unit (7 files) | time/DST arithmetic, sanitising, schemas, filters/URL state, export, identity, the insights client | `tests/unit` |
| Integration (4 files) | identity & provisioning, the star lifecycle (placement, claiming, release, restore, erase), search, the rate limiter — against **real Postgres** | `tests/integration` |
| Contract | 5 fixture cases, computed by both languages and compared field by field | `tests/unit/analytics.contract.test.ts`, `services/insights/tests/test_contract.py` |
| Service | signature verification, replay refusal, 422s that never echo input, atlas escaping | `services/insights/tests` |
| Browser | the writer's journey, the reveal mask, security headers, timezones | `tests/*.spec.ts` |

Integration tests use **PGlite** — Postgres compiled to WebAssembly — so `npm test` needs no
Docker, no server and no cleanup. CI runs the same suite a second time against a real
`postgres:17` service, because the embedded driver is not the driver production uses.

The suites have already earned their keep: they caught a sanitizer that glued words together when
it removed a tag, a `data:text/html` guard that could never match, a `released` count that was
always zero, a `favorite: true` edit that did not claim the example it was keeping, a star event
that never fired, nights that were counted once per feeling instead of once per night, and a
search order that was not total.

---

## Running it locally

```bash
git clone https://github.com/pterw/asteria && cd asteria
npm install                 # also configures the pre-commit hook

cp .env.example .env        # optional: everything below has a working default
npm run db:migrate          # creates the embedded database and applies the schema
npm run dev                 # http://localhost:3000
```

With no `DATABASE_URL`, Asteria starts an **embedded Postgres** (PGlite) in `.asteria/data`. That
is the whole setup: no Docker, no service to install, and the same SQL that production runs.
Point `DATABASE_URL` at any Postgres to use a server instead — and then run `npm run db:setup`
once, which creates the tables and checks that the database really can be Asteria's. The steps
for Neon, string by string, are in [Connecting a managed Postgres](#connecting-a-managed-postgres).

The Python half is optional locally. To run it:

```bash
npm run insights:install    # .venv + requirements
npm run insights:dev        # http://127.0.0.1:8000
# then, in the app's environment:
#   ASTERIA_INSIGHTS_URL=http://127.0.0.1:8000
#   ASTERIA_INSIGHTS_SECRET=<the same secret in both processes>
```

The interface does not change when the service is running — only `/api/journal/stats` starts
reporting `source: "service"`. That is the intended way for a second service to be introduced:
observable, never load-bearing.

---

## Connecting a managed Postgres

Locally you need none of this — `npm run dev` starts an embedded Postgres and works offline.
This section is for pointing Asteria at a real database, and it is written out step by step
because "which connection string" is the one decision here that is easy to get wrong and
expensive to get wrong quietly.

### Neon, in the console

1. Sign in at [console.neon.tech](https://console.neon.tech) and create a project. Choose the
   region closest to where the app will run — every query crosses that distance — and take the
   default Postgres version.
2. In the project, click **Connect**. A dialog appears with *Branch*, *Compute*, *Database* and
   *Role*. Leave them on `main` / the default compute / `neondb` / your role.
3. **Turn "Connection pooling" on, and copy the string.** It looks like
   `postgresql://user:pass@ep-cool-rain-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require`.
   The `-pooler` in the hostname is the whole difference: it routes through PgBouncer in
   transaction mode, which is what lets a few hundred short-lived function instances share a
   handful of real connections. This one becomes `DATABASE_URL`.
4. **Turn it off, and copy the string again.** No `-pooler`, everything else identical. This is
   the direct connection: session state works on it, and migrations prefer it. This one becomes
   `DATABASE_URL_UNPOOLED`.
5. Put both in `.env.local`:

   ```bash
   DATABASE_URL="postgresql://…-pooler….neon.tech/neondb?sslmode=require"
   DATABASE_URL_UNPOOLED="postgresql://….neon.tech/neondb?sslmode=require"
   ```

6. Run the setup:

   ```bash
   npm run db:setup
   ```

That command connects with the direct string, applies the migrations (creating
`journals`, `sessions`, `stars`, `journal_events`, `rate_limits` and the migration ledger),
prints every table it found, and then checks that the database can actually be Asteria's — that
it has generated columns, a GIN index over a `tsvector`, `hashtext`, `ts_rank_cd`, and
transactional DDL. Those six checks exist because a service that is *almost* Postgres fails
somewhere much less obvious than the first `select`, and the failure would arrive during
somebody's first night of writing. Then `npm run dev` and the app is writing to Neon.

You do not have to run it: the first deploy runs the same migrations in the build. Running it
locally just means the first deploy finds the schema already current, and any problem surfaces
where you can see it.

### In production

Add the same two variables, plus `ASTERIA_SECRET`, in the Vercel project's **Settings →
Environment Variables** (for Production, Preview and Development), then redeploy. If you use the
Vercel–Neon integration instead, it sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED` for you on
every branch — which is a nice property: a preview deployment gets a database branch of its own
and cannot write into production data.

`ASTERIA_SECRET` is the pepper for session tokens and recovery keys; rotating it signs every
device out. Generate one with `openssl rand -base64 32`.

### When it does not connect

| Message | What it means |
| --- | --- |
| `password authentication failed` | The password was rotated, or the project was re-created and the string in `.env.local` is the old one. Copy it again from **Connect**. |
| `getaddrinfo ENOTFOUND`, `fetch failed`, `ECONNREFUSED` | The hostname is wrong, or outbound TLS is blocked from where you are running this. Check that the endpoint id and region match the console exactly. |
| `remaining connection slots are reserved` | Something is holding direct connections open. Use the pooled string for the app, keep `POSTGRES_POOL_MAX` at 2, and leave the direct string to migrations. |
| `the database system is starting up` | Neon suspends an idle compute. The first request after a nap takes a few hundred milliseconds while it wakes; it is not an error. Raise the minimum compute size if that first request matters. |
| `relation "journals" does not exist` | Migrations have not run against *this* database. `npm run db:setup` (or a deploy) fixes it; a `DATABASE_URL` pointing at a different branch than the migration did is the usual cause. |

## Deploying it

Two Vercel projects, one repository.

**1. The app (this repository, root directory).**

| Setting | Value |
| --- | --- |
| Framework | Next.js (detected) |
| Build command | `npm run vercel-build` — migrations, then `next build` |
| Required env | `DATABASE_URL`, `ASTERIA_SECRET` |
| Optional env | `ASTERIA_INSIGHTS_URL`, `ASTERIA_INSIGHTS_SECRET`, `NEXT_PUBLIC_SITE_URL` |

`DATABASE_URL` should be a **pooler** host (Neon, Supabase, RDS Proxy), and a Neon host
additionally switches to Neon's own WebSocket driver — see
[Connecting a managed Postgres](#connecting-a-managed-postgres). Serverless functions open
short-lived connections, and the pool is sized for that — two connections per instance
(`POSTGRES_POOL_MAX`), released after ten idle seconds, with `allowExitOnIdle` so an idle
instance is not held open by its own pool, a client-side `POSTGRES_QUERY_TIMEOUT_MS` deadline
instead of a session-level `statement_timeout` (which is not ours to set on a pooled
connection), `application_name=asteria` so the queries are identifiable in `pg_stat_activity`,
and `attachDatabasePool` from `@vercel/functions` so a suspended instance drains its clients
instead of counting them against the database's ceiling. Both projects deploy with
`"fluid": true`: they are I/O-bound, hold no CPU, and a request waiting on Postgres should not
cost a whole instance. TLS is inferred from `sslmode` in the URL.

**2. The insights service (`services/insights`).** Import the same repository again, set **Root
Directory** to `services/insights`, and set `ASTERIA_INSIGHTS_SECRET` to the same value the app
has. Vercel detects FastAPI from `requirements.txt`, finds the ASGI app in `api/index.py`, and
pins Python with `.python-version`. Then give the app the service's URL as
`ASTERIA_INSIGHTS_URL`.

The deploy job in `.github/workflows/ci.yml` does both steps with the Vercel CLI when
`VERCEL_TOKEN` is present, and says so plainly when it is not.

---

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | — | managed Postgres (pooled host); when unset, the embedded database is used |
| `DATABASE_URL_UNPOOLED` | — | Neon's direct string; migrations prefer it. `POSTGRES_URL_NON_POOLING` is read too |
| `ASTERIA_DB` | inferred | force `neon`, `postgres` or `pglite` |
| `ASTERIA_DB_DIR` | `.asteria/data` | where the embedded database keeps its files |
| `ASTERIA_SECRET` | — | HMAC pepper for session tokens and recovery keys (≥16 chars). Rotating it signs everyone out. |
| `ASTERIA_INSIGHTS_URL` | — | the Python service; unset means "use the local implementation" |
| `ASTERIA_INSIGHTS_SECRET` | — | shared secret for signatures |
| `ASTERIA_INSIGHTS_TIMEOUT_MS` | `2500` | analytics deadline (the atlas gets 6 s) |
| `POSTGRES_SSL` | from `sslmode` | `disable` · `require` · `verify-full` |
| `POSTGRES_POOL_MAX` | `2` | connections per instance |
| `POSTGRES_QUERY_TIMEOUT_MS` | `15000` | client-side deadline for one query |
| `POSTGRES_IDLE_TIMEOUT_MS` | `10000` | how long an idle connection is kept |
| `NEXT_PUBLIC_SITE_URL` | — | canonical origin for metadata and OG images |
| `ASTERIA_TEST_DATABASE_URL` | — | run the integration suite against a real server (CI does) |

---

## Repository layout

```
src/app          routes and pages (server components; the sky renders on the client)
src/components   landing, sky (canvas, composer, reader, time bar), ui primitives
src/lib          the domain: journal, search, session, analytics, export, filters, time,
                 schemas, sanitise, rate limiting, logging, the insights client
src/db           driver facade (Postgres or embedded) and the Drizzle schema
drizzle          the migrations, and the additive legacy adoption
scripts          migrate · emit-contract · python · reset-db · verify
services/insights  the FastAPI service, its tests, and its own deploy config
tests            unit · integration · browser, plus the shared contract fixtures
contract         fixtures.json + analytics.json — the answer sheet both languages answer to
```

---

## Documentation

| Document | What it is for |
| --- | --- |
| [`PRODUCT.md`](PRODUCT.md) | who this is for and what it refuses to become |
| [`IMPLEMENTATION_GUIDELINES.md`](IMPLEMENTATION_GUIDELINES.md) | the rules the code follows |
| [`DESIGN_AUDIT1.md`](DESIGN_AUDIT1.md) | the interface audit that drove the visual work |
| [`WALKTHROUGH.md`](WALKTHROUGH.md) | the writer's journey, screen by screen |
| [`PLAN.md`](PLAN.md) | the build plan and what each phase changed |

---

## License

MIT.
