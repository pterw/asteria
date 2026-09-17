# Asteria

> *Your memories become a night sky that changes as you live.*

**Live Application**: [https://asteria-two.vercel.app](https://asteria-two.vercel.app)

![Asteria Night Sky](public/images/asteria-sky.png)

Asteria is an intentional journaling observatory. Write one small moment a night—it is hung as a star, placed among memories of the same feeling. Each new star threads to the nearest memory of its kind, so six expressive modes become six constellations that grow over time. Wind the timeline back and the sky un-forms exactly as it formed; press play and watch your days re-illuminate.

![Asteria Landing](public/images/asteria-landing.png)

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [How the Webapp Works](#how-the-webapp-works)
3. [Backend Architecture & Data Serving](#backend-architecture--data-serving)
4. [Docker & PostgreSQL Infrastructure](#docker--postgresql-infrastructure)
5. [Frontend & Backend Connection](#frontend--backend-connection)
6. [Pre-Commit Hooks & CI/CD Pipeline](#pre-commit-hooks--cicd-pipeline)
7. [Local Development Quickstart](#local-development-quickstart)
8. [Automated Verification & Test Suite](#automated-verification--test-suite)

---

## System Architecture

```mermaid
flowchart TB
    subgraph Client ["Client Browser (Chrome / Firefox / Safari)"]
        UI["React 19 UI Chrome\n(Sidebar, Reader, Modals, Composer)"]
        Canvas["Canvas 2D Celestial Engine\n(SkyCanvas · 60fps RAF · MST Threads)"]
        Draft["LocalStorage Offline Draft\n(asteria.moment-draft.v3)"]
        ApiClient["Frontend Data Client\n(src/lib/api.ts · Optimistic Updates)"]
    end

    subgraph Edge ["Next.js 16 App Router & Edge Middleware"]
        Proxy["Middleware Proxy (src/proxy.ts)\nHttpOnly UUID Cookie Isolation"]
        Security["Defense-in-Depth Security\n(CSP Headers · nosniff · frame-ancestors:none)"]
    end

    subgraph Backend ["Backend Services & API Route Handlers"]
        Sanitizer["XSS Sanitizer Engine\n(src/lib/sanitize.ts)"]
        RateLimiter["Sliding-Window Rate Limiter\n(src/lib/ratelimit.ts)"]
        Routes["App Router Endpoints\n(/api/stars, /api/stars/search, /api/journal/*)"]
        Lock["PostgreSQL Advisory Lock\n(Deterministic Coordinate Allocation)"]
    end

    subgraph Data ["Persistence Layer"]
        Drizzle["Drizzle ORM Engine\n(src/db/schema.ts)"]
        Pool["pg Connection Pool\n(src/db/index.ts)"]
        Postgres[("PostgreSQL 16 Alpine\n(Docker Container / Cloud DB)\nTables: journals, stars")]
    end

    Canvas <--> UI
    UI <--> ApiClient
    UI -.-> Draft
    ApiClient --> Proxy
    Proxy --> Security
    Security --> Routes
    Routes --> Sanitizer
    Routes --> RateLimiter
    Routes --> Lock
    Lock --> Drizzle
    Drizzle --> Pool
    Pool --> Postgres
```

---

## How the Webapp Works

Asteria operates as a dual-surface single-page application built on Next.js 16 (App Router) and React 19:

### 1. The Two Surfaces
- **`/` — The Cinematic Landing Page**:
  - Serves as the front door. Introduces the observatory concept in three progressive acts.
  - Features an interactive hero text reveal curtain (`HeroWord`) tuned for descender preservation.
  - Renders a live preview of the visitor's celestial census and a live `#yours` canvas. Returning visitors are greeted with **"Return to your sky"**.
- **`/sky` — The Observatory Workspace**:
  - **Sky Map**: Canvas 2D interactive sky. Pan, pinch-to-zoom, click stars or constellation labels to focus attention.
  - **Attention Engine**: Clicking an expressive mode chip or constellation label illuminates that feeling while dimming the rest to 42% opacity. The URL query parameter (`?mood=grateful`) synchronizes with the map and library.
  - **Time Axis**: Scrub through history in birth order. The readout displays the date and celestial census (`6 stars · 6 nights · 6 constellations`). Step with keyboard shortcuts `[` and `]`, or press play for adaptive temporal playback.
  - **Reader & Moments Library**: Comprehensive card and list views with deep search, filtering, favorite toggling, soft deletion, and Markdown export.

### 2. Timezone Normalization
To guarantee zero hydration mismatches across international time zones:
- The server initially renders all date strings in UTC.
- Upon client mount, `JournalTimeProvider` (`src/components/sky/JournalTime.tsx`) inspects `Intl.DateTimeFormat().resolvedOptions().timeZone` and propagates the browser's local timezone to all calendar widgets and date formatters.

### 3. High-Performance Canvas 2D Engine
- Located in `src/components/sky/SkyCanvas.tsx`.
- **Constellation Formation**: Groups stars by expressive mode and dynamically constructs Euclidean Minimum Spanning Trees (MST) so stars connect to the nearest memory of their kind.
- **Battery & CPU Conservation**: Automatically pauses the `requestAnimationFrame` loop via `IntersectionObserver` when scrolled offscreen and via `visibilitychange` when the browser tab is hidden.
- **Flicker-Free Resizing**: Uses hoisted helper functions and decoupled camera interpolation so expanding or collapsing the sidebar causes zero star cluster blinking or dropped frames.

---

## Backend Architecture & Data Serving

The backend is built into Next.js 16 Route Handlers and communicates directly with PostgreSQL via Drizzle ORM:

### 1. Privacy & Session Isolation
Asteria requires no usernames or passwords. Instead:
- `src/proxy.ts` inspects incoming HTTP requests. If no session cookie exists, it mints a cryptographically secure UUID v4 and attaches it as an `HttpOnly`, `SameSite=Lax`, `Secure` cookie named `asteria_journal_id`.
- All database queries in `src/lib/journal.ts` scope reads and writes strictly to `WHERE journal_id = :journalId`. Users cannot access, enumerate, or mutate another visitor's moments.

### 2. API Route Specifications
| Route | Method | Purpose | Key Details |
| :--- | :--- | :--- | :--- |
| `/api/stars` | `GET` | Fetch all stars for session | Returns active stars ordered by creation timestamp. |
| `/api/stars` | `POST` | Create a new moment | Sanitizes text, acquires advisory lock, calculates coordinate quadrant, writes star. |
| `/api/stars/[id]` | `PATCH` | Update a moment | Updates title, content, mood, or favorite status. |
| `/api/stars/[id]` | `DELETE`| Soft delete moment | Sets `deleted_at = NOW()` allowing instant undo restoration. |
| `/api/stars/search` | `GET` | Advanced filtering | Multi-parameter search supporting `q`, `mood`, `intensity`, date bounds, sorting. |
| `/api/journal/stats`| `GET` | Celestial telemetry | Aggregates star count, nights remembered, writing streaks, mood distributions. |
| `/api/journal/export`| `GET` | Export moments | Emits formatted JSON or sanitized Markdown with escaped HTML entities. |
| `/api/journal/import`| `POST` | Backup restoration | Validates schema, sanitizes inputs, assigns stable coordinates, restores stars. |
| `/api/health` | `GET` | Health & uptime | Reports database connectivity, ping latency (ms), process uptime, RSS memory. |

### 3. Deterministic Coordinate Allocation
When a moment is captured:
1. The backend acquires a PostgreSQL transactional advisory lock (`pg_advisory_xact_lock`) based on the journal UUID.
2. It fetches existing stars in that expressive mode quadrant.
3. It places the new star near existing cluster nodes using polar offset jitter, ensuring that editing text later never shifts the star's coordinates on the sky map.

### 4. Defense-in-Depth Security
- **Input Sanitization**: `src/lib/sanitize.ts` strips `<script>`, `<iframe>`, `style` tags, and dangerous protocols (`javascript:`) before database writes.
- **Rate Limiting**: `src/lib/ratelimit.ts` applies an in-memory sliding window limiter to prevent automated flooding of write endpoints.
- **Security Headers**: Configured in `next.config.ts` (`Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`).

---

## Docker & PostgreSQL Infrastructure

Asteria is backed by PostgreSQL 16. In local development, Docker Compose spins up an isolated, persistent PostgreSQL instance.

### 1. Docker Compose Configuration (`docker-compose.yml`)
```yaml
services:
  db:
    image: postgres:16-alpine
    container_name: asteria-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: app_db
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - asteria-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d app_db"]
      interval: 5s
      timeout: 3s
      retries: 12

volumes:
  asteria-db:
```

### 2. Database Schema (`src/db/schema.ts`)
```typescript
export const journals = pgTable("journals", {
  id: uuid("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const stars = pgTable("stars", {
  id: uuid("id").defaultRandom().primaryKey(),
  journalId: uuid("journal_id").references(() => journals.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 80 }).notNull().default(""),
  content: text("content").notNull(),
  mood: varchar("mood", { length: 24 }).notNull(),
  intensity: integer("intensity").notNull().default(3),
  x: real("x").notNull(),
  y: real("y").notNull(),
  favorite: boolean("favorite").notNull().default(false),
  isSample: boolean("is_sample").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, table => [index("stars_journal_date_idx").on(table.journalId, table.createdAt)]);
```

### 3. Connection Pooling (`src/db/index.ts`)
- Uses `node-postgres` (`pg.Pool`) configured with a 3000ms connection timeout.
- Caches the pool instance across Next.js hot module reloads in development (`globalThis.__arenaNextJsPostgresqlPool`) to prevent exhausting PostgreSQL connection limits.
- Supports external serverless PostgreSQL connection strings (e.g. Neon, Supabase, AWS Aurora, Aiven) with SSL (`?sslmode=require`).

---

## Frontend & Backend Connection

1. **Optimistic Mutations**: When a user creates, stars, edits, or releases a moment, `src/lib/api.ts` updates the UI instantly, then sends the fetch request in the background. If a network failure occurs, the UI rolls back gracefully and displays an observatory toast notification.
2. **Offline Draft Recovery**: Unsent entries in `Composer.tsx` auto-save to `localStorage` under `asteria.moment-draft.v3`. If a user accidentally closes their tab or loses internet connection, their writing is restored upon reopening.
3. **Atomic Seeding**: When a visitor enters `/sky` for the first time without any stars, the backend automatically seeds 24 example moments showcasing all six expressive modes. Editing an example star claims it as your own.

---

## Pre-Commit Hooks & CI/CD Pipeline

To ensure that only tested, clean code is pushed and deployed to production, Asteria enforces a two-tier quality gate:

### 1. Local Pre-Commit Hook (`.githooks/pre-commit`)
Git is configured to execute `.githooks/pre-commit` before any commit is finalized:
- Executes `npm run typecheck` (`tsc --noEmit`).
- Executes `npm run lint` (ESLint Next.js validation).
- Prevents syntax errors, broken TypeScript types, or rule regressions from entering version control.

### 2. GitHub Actions CI Gate (`.github/workflows/ci.yml`)
On every push and pull request to `main`:
1. **`ci-gate` Job**: Checks out the code, installs dependencies with `npm ci`, runs `npm run typecheck`, runs `npm run lint`, and compiles the full production bundle with `npm run build`.
2. **`vercel-gate` Job**: Runs after `ci-gate` passes. Certifies the commit as production-ready.
3. **Vercel Automatic Deployment**:
   - When connected via the native Vercel GitHub integration, Vercel monitors the GitHub check status. As soon as `ci-gate` passes, Vercel initiates the production deployment.
   - If deploying via the Vercel CLI in CI, setting the GitHub repository secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` triggers an automated CLI production deployment.

---

## Local Development Quickstart

### Prerequisites
- [Node.js](https://nodejs.org/) v20+
- [Docker & Docker Compose](https://www.docker.com/)

### 1. Start the PostgreSQL Container
```bash
docker compose up -d
```
Verify the container is healthy:
```bash
docker ps --filter "name=asteria-db"
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Default connection string:
```env
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
```

### 3. Push Database Schema
Apply the Drizzle ORM schema to create the `journals` and `stars` tables:
```bash
npx drizzle-kit push
```

### 4. Install Dependencies & Initialize Git Hooks
```bash
npm install
```
*(The `prepare` script automatically binds `.githooks` to your local git configuration).*

### 5. Launch the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the landing page, or [http://localhost:3000/sky](http://localhost:3000/sky) to access your observatory.

---

## Automated Verification & Test Suite

Asteria includes an end-to-end test suite written in Playwright, covering the full user journey, security headers, XSS sanitization, timezone compatibility, and responsive design:

```bash
# Run TypeScript compilation
npm run typecheck

# Run ESLint validation
npm run lint

# Build production bundle
npm run build

# Run the 20-spec Playwright suite
npm test
```

### Test Coverage Highlights
- **Security & XSS**: Verifies CSP headers, X-Frame-Options, script injection sanitization on database write, and HTML bracket escaping in markdown export.
- **Observatory Interactions**: Verifies star birth, star inspection, editing, starring, releasing with undo, and keyboard navigation (`[` / `]` / Enter).
- **Time & History**: Verifies winding the timeline scrubber, playback loops, and census calculation.
- **Responsiveness**: Verifies drawer behavior, touch targets, and absence of horizontal overflow across mobile, tablet, and 4K desktop viewports.
- **Timezones**: Verifies hydration accuracy between UTC servers and client time zones.

---

## License
MIT License. Crafted with care for the quiet hours.
