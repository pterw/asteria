# Implementation Guidelines: XSS Protection, Frontend Overhaul & Backend Expansion

A unified security, frontend performance/feature, and backend architecture expansion for Asteria.

---

## Executive Summary & Security Assessment

### 1. Current State of XSS Protection in Asteria
A comprehensive security audit of Asteria's codebase reveals the following baseline:

- **What is Currently Protected**:
  - **React JSX Text Node Escaping**: Zero instances of `dangerouslySetInnerHTML`, `innerHTML`, `document.write`, or `eval()` exist anywhere in the application. User titles, thoughts, and dates in `MomentCard.tsx`, `StarCard.tsx`, `Composer.tsx`, etc., are bound as pure text nodes (`document.createTextNode`), preventing traditional browser DOM XSS.
  - **Canvas Glyph Rendering**: `SkyCanvas.tsx` draws active star titles using Canvas 2D `ctx.fillText()`, which plots glyph bitmaps onto the pixel buffer without HTML parsing.
  - **Screen Reader Announcements**: `SkyCanvas.tsx` updates live regions using `announcement.current.replaceChildren(string)`, treating the argument strictly as a text node.
  - **SQL Parameterization**: Drizzle ORM executes parameterized queries (`$1`, `$2`), preventing SQL injection.
  - **Session Token Isolation**: The `asteria-journal` cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` on HTTPS, preventing JavaScript token exfiltration.
  - **Cross-Origin Fetch Guard**: `proxy.ts` rejects non-GET cross-site mutation requests.

- **Vulnerabilities & Security Gaps Identified**:
  - **No Content Security Policy (CSP)**: Neither `next.config.ts` nor `src/proxy.ts` defines a `Content-Security-Policy`. If an inline script injection vector were ever introduced (e.g. via third-party packages or browser extensions), the browser would execute it without restriction.
  - **Missing Standard HTTP Security Headers**: Missing `X-Content-Type-Options: nosniff` (MIME sniffing), `X-Frame-Options: DENY` (clickjacking), `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy`. Next.js also exposes `x-powered-by: Next.js`.
  - **Unsanitized API Inputs**: `src/lib/api.ts` accepts raw strings containing `<script>` or HTML tags and saves them as-is into PostgreSQL. If this data is ever consumed outside React (e.g., RSS feeds, webhooks, or markdown exports), it poses an injection risk.
  - **Markdown Export HTML Injection**: In `src/app/api/journal/export/route.ts`, `title` is escaped, but `content` is interpolated directly as `> ${line}` into the exported markdown. Many Markdown viewers (Obsidian, GitHub, Notion) parse and execute embedded HTML tags within blockquotes.

---

## Technical Directives & Architecture

### Adobe Typekit CSP Integration
Asteria relies on Adobe Typekit (`use.typekit.net`, `p.typekit.net`, `fonts.adobe.com`) for the approved System B typography (Ella Roman, Orpheus Pro, Gotham, Azo Mono). The Content Security Policy must explicitly allow these origins in `font-src`, `style-src`, and `connect-src` to prevent font blocking.

### Desktop Layout Shift Resolution
Baseline Core Web Vitals diagnostics revealed that `/sky` records a CLS of **0.1536** (failing Google CWV $< 0.1$). We eliminate 100% of this shift by making the desktop sidebar open by default in pure CSS (`@media(min-width: 761px)`), removing the post-hydration JS layout jump.

---

## Architectural Changes

### Phase 1: Security Hardening & XSS Protection

#### `src/lib/sanitize.ts`
- Create a lightweight, high-performance HTML/script sanitization and normalization module:
  - `sanitizeText(input: string)`: Strips raw HTML tags (`<script>`, `<iframe>`, `<img ...>`, etc.), escapes dangerous control characters, removes `javascript:`/`data:` pseudo-protocol patterns, and trims leading/trailing whitespace.
  - `escapeMarkdown(text: string)`: Safely escapes markdown and HTML characters (`<`, `>`, `\`, `` ` ``, `*`, `_`, `[`, `]`) for safe export.

#### `src/lib/api.ts`
- Integrate `sanitizeText` into `validateMoment()` so both `title` and `content` are sanitized before database persistence on `POST /api/stars` and `PATCH /api/stars/[id]`.

#### `src/app/api/journal/export/route.ts`
- Sanitize and escape both `title` and `content` in markdown output, preventing downstream markdown viewers from executing embedded HTML.

#### `src/proxy.ts` & `next.config.ts`
- Set `poweredByHeader: false` in `next.config.ts`.
- Add standard security headers and Content Security Policy in `proxy.ts` and `next.config.ts`:
  - `Content-Security-Policy`:
    - `default-src 'self'`
    - `script-src 'self' 'unsafe-inline' 'unsafe-eval'` (required for Next.js hydration & dev)
    - `style-src 'self' 'unsafe-inline' https://use.typekit.net https://p.typekit.net`
    - `font-src 'self' https://use.typekit.net https://fonts.adobe.com data:`
    - `img-src 'self' data: blob:`
    - `connect-src 'self' https://use.typekit.net https://performance.typekit.net`
    - `frame-ancestors 'none'`
    - `base-uri 'self'`
    - `form-action 'self'`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`

---

### Phase 2: Frontend Performance & Feature Expansions

#### `src/app/sky/astra.css`
- **Eliminate CLS (0.1536 -> 0.0000)**:
  - Set desktop (`@media(min-width: 761px)`) `.workspace` default to `margin-left: 240px` and `.sidebar` default to `transform: translateX(0); visibility: visible;`.
  - Shift to `margin-left: 0;` only when explicitly `.is-collapsed`.
  - Set mobile (`@media(max-width: 760px)`) `.workspace` default to `margin-left: 0;` with off-canvas sidebar drawer.
  - Remove initial mount transition jump.
- **Rendering Containment**: Add `content-visibility: auto; contain-intrinsic-size: 0 16rem;` to `.moment-card` for off-screen render optimization.
- **Image Reference**: Update background image to `/images/observatory.webp`.

#### `src/components/sky/SkyApp.tsx`
- Align sidebar open/collapsed state with the CSS default.
- Dynamically import modal components (`Composer`, `StarCard`, `JournalSettings`, `KeyboardShortcutsModal`) via `next/dynamic`.
- Register global keyboard shortcut `?` to toggle the Keyboard Shortcuts help overlay.

#### `src/components/landing/AmbientStars.tsx`
- Add `IntersectionObserver` to pause the 60fps RAF loop when the canvas is scrolled out of view.
- Add `visibilitychange` listener to halt the loop when the tab is hidden.
- Batch star drawing by tint: group 206 stars into 3 path operations per frame, cutting draw calls by 98%.

#### `public/images/observatory.webp`
- WebP asset generated at quality 78 (100.3 KB, 57% smaller than 237 KB JPEG).

#### `src/components/ui/KeyboardShortcutsModal.tsx`
- Accessible modal displaying all journal hotkeys (`N` for new star, `[` / `]` for timeline scrubbing, `Space` for now, `M` for memories library, `S` for sky view, `?` for shortcuts, `Esc` to close).

#### `src/components/sky/JournalSettings.tsx`
- Add "Restore Journal" UI: allows selecting or dropping an `asteria-*.json` backup file to restore moments back into the sky via the new backend import endpoint.

---

### Phase 3: Backend Architecture Expansions

#### `src/lib/ratelimit.ts`
- Sliding-window in-memory rate limiter for journal mutations (e.g. 60 moment creations / min per journal) to prevent abuse and denial of service.

#### `src/app/api/stars/search/route.ts`
- Dedicated server-side search and filtering API:
  - Query parameters: `q` (substring/word search), `mood` (feeling filter), `starred` (favorites only), `intensity_min`/`intensity_max`, `since`/`until` (date range), `limit`, `offset`, and `sort` (`newest`, `oldest`, `brightest`).
  - Returns paginated results with total match counts.

#### `src/app/api/journal/import/route.ts`
- Complete journal restore & import endpoint:
  - Validates imported JSON schema (`application: "Asteria"`, `moments: [...]`).
  - Sanitizes all imported moment titles and contents via `sanitizeText`.
  - Uses transactional advisory locks and batch insertion, ensuring constellation positions are consistently computed.
  - Returns summary: `{ imported: number, skipped: number }`.

#### `src/app/api/journal/stats/route.ts`
- Deep celestial analytics endpoint for the user's journal:
  - Total stars, total nights recorded, active writing streak (current & longest consecutive days).
  - Breakdown by mood/constellation (counts, percentages).
  - Brightness distribution (count per brightness 1-5, average intensity).
  - Time-of-day reflection distribution (morning, afternoon, evening, night).

#### `src/app/api/health/route.ts`
- Expand health endpoint with database ping latency, connection status, and service uptime.

---

## Verification Strategy

### Automated Tests
1. **Playwright E2E Suite**:
   - Run `npx playwright test` to ensure all 20 tests pass with 0 regressions.
2. **Security & API Tests (`tests/security_and_expansion.spec.ts`)**:
   - Verify CSP headers and security headers are returned on `/`, `/sky`, and `/api/stars`.
   - Verify `x-powered-by` header is removed.
   - Verify XSS payload in moment title/content (`<script>alert(1)</script>`) is sanitized.
   - Verify Markdown export escapes `<>` in both title and content.
   - Verify `POST /api/journal/import` correctly validates, sanitizes, and restores moments.
   - Verify `GET /api/journal/stats` and `GET /api/stars/search` return correct structure and data.
3. **Performance Diagnostics**:
   - Run `node scratch/diagnose_cls.js` to verify CLS = 0.0000 on `/sky`.
   - Run `node scratch/measure_perf.js` to verify image transfer size is reduced by 57% and frame rate remains smooth at 60fps.
4. **TypeScript & Build**:
   - Run `npm run typecheck` (zero TypeScript errors).
