# Asteria v2 — Engineering Plan

> Working plan for the long-horizon refactor currently in flight on
> `arena/01a0deef-asteria`. Delete-by-folding: each workstream moves into
> `docs/` or the README as it completes, and this file is retired at the end.

## Where the project started (baseline, measured 2026-09-26)

| Signal | Baseline |
|---|---|
| `tsc --noEmit` | pass |
| `eslint .` | 7 warnings, 0 errors |
| `next build` | **fail** — `next/font/google` cannot reach `fonts.googleapis.com` from a restricted network |
| `npm test` (Playwright, 13 specs) | needs a live Postgres; no Docker/Postgres in this sandbox |
| Unit tests | none |
| Migrations | none — schema applied with `drizzle-kit push` |
| Rate limiting | in-process `Map`, defeated by any second serverless instance |
| Identity | one HttpOnly cookie holding the raw journal UUID; clearing cookies destroys the sky |
| Samples | 24 example stars seeded during `requireJournal()`, i.e. in a transaction on **every** request, and counted in stats/streaks |
| Search | `ILIKE '%q%'` over title+content, no index, no ranking |
| Backend | Next.js route handlers only |

## Where it stands now

| Signal | Now |
|---|---|
| `npm run verify` | typecheck · lint (0 warnings) · contract · 143 unit/integration tests · 19 Python tests · build |
| Integration tests | against embedded Postgres locally, and against a real `postgres:17` service in CI |
| Identity | opaque session token (hash at rest) + 125-bit recovery key; legacy UUID cookies adopted on first sight |
| Samples | seeded once, flagged, excluded from analytics, removable in one action |
| Search | generated `tsvector` + GIN, ranked prefix queries, faceted counts |
| Backend | route handlers over a real data layer, plus a FastAPI service for analytics and the atlas, contract-tested against the TypeScript |
| Deploy | `npm run vercel-build` migrates then builds; the CLI refuses to build on Vercel without `DATABASE_URL` |
| Browser suite | written, not yet green: it runs on a schedule in CI, and moves into the main gate when the interface work (W6) lands |

Workstreams W0-W5 are done; W6 is the open one. W7-W10 are done except for the parts W6 blocks:
the visuals in `artifacts/` and the final screenshots come from the interface pass, and
`DEPLOYMENT.md` folded into the README's *Deploying it* section rather than becoming another file
to keep in sync.

## Target

A deployed, shareable instrument: correct under concurrency, durable and
portable across devices, observable, tested at three levels, and able to run
with **zero external services** locally (embedded Postgres via PGlite) or on
**Vercel + managed Postgres** in production — one code path, two drivers.

## Workstreams

### W0 · Unblock the build
- Self-host the fallback faces (`next/font/local`) from the Fontsource variable
  packages already in the registry; drop the build-time dependency on Google.
  The licensed Adobe kit stays the identity source and is still linked first.
- Add `vitest`, `zod`, `@electric-sql/pglite`. Split npm scripts by task.

### W1 · Data layer
- `src/db/index.ts`: one Drizzle instance over either `node-postgres` (when
  `DATABASE_URL` is set) or PGlite (`ASTERIA_DB=pglite`, a real directory on
  disk). Serverless-safe pool settings.
- Schema v2: sessions, recovery keys, audit events, rate-limit buckets,
  `tsvector` generated column + GIN index, check constraints, hot-path indexes.
- Versioned SQL migrations + a runner (`scripts/migrate.ts`) that works on both
  drivers and is idempotent, so deploys can migrate themselves.

### W2 · Domain core
- Break the `astral.ts` god module into moods / stars / filters / census / time.
- Zod schemas as the single source of truth for every request payload.
- Structured logger with request ids; a route wrapper that owns errors,
  envelopes, caching and no-store policy.
- Postgres-backed sliding-window limiter with an in-process fast path.
- Analytics engine (rhythm, gaps, time-of-day, mood flow) shared by the
  TypeScript fallback and mirrored in Python.

### W3 · Persistence & identity
- Sessions table: opaque token in the cookie, hash in the database, revocable
  and rotatable; the journal UUID never leaves the server again.
- **Recovery key**: a high-entropy phrase that reopens a sky on any device —
  portability and durability without accounts, email or a third party. This is
  the concrete answer to the deferred question in `DESIGN_AUDIT1.md` §D1.
- Legacy cookie upgrade path so no existing sky is lost on deploy.
- Sample seeding becomes a single explicit first-run step, excluded from real
  numbers, and removable in one action.

### W4 · API v2
- Every read/write reworked: ETag + conditional GET, pagination, facets,
  full-text search with ranking, idempotent import (v2 and v3 payloads),
  export in JSON/Markdown, atlas render, insights, session, key rotation,
  erasure, health and readiness.

### W5 · Python service
- `services/insights/`: FastAPI app that renders the **Atlas** (a single
  self-contained HTML/SVG artefact — the only Asteria document that outlives
  the browser) and computes rhythm analytics. HMAC-signed requests, hardened
  HTTP surface, pytest suite, its own Dockerfile and Vercel config.
- Next.js calls it server-side with a timeout and falls back to the in-process
  TypeScript implementation, so the product never depends on a second service
  being up.

### W6 · Interface
- Fix the mass inversion the design audit named: the sky is the instrument and
  takes the dominant position; the library becomes the rail, not the page.
- Search legible at rest (A6), headings at the size the audit demands
  (A8/A17), no three-identical-card shelf (A15), no eyebrow (A4).
- New surfaces: Insights, Atlas, Settings v2 (recovery key, danger zone),
  a real About page.
- Accessibility: canvas text alternative + keyboard star list, focus-visible,
  contrast floor, reduced motion, labelled regions.

### W7 · Verification
- Vitest unit suite over the pure core; Playwright end-to-end over a PGlite
  journal (no Docker required); pytest over the Python service; a single
  `npm run verify` that runs all of it and reports.

### W8 · Deployment
- `vercel.json`, `DEPLOYMENT.md`, `.env.example`, one-click deploy, migrations
  on deploy, CI matrix over Node and Python, optional CLI deploy job.

### W9 · Documentation
- README (architecture, decisions, benchmarks, screenshots), `ARCHITECTURE.md`,
  `DECISIONS.md` (ADRs), `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`.

### W10 · Live proof
- Run the stack on the preview host, exercise the real journeys with
  Playwright, capture screenshots, publish the URL.
