# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: the solo writer, at night.** They arrive with one sentence in their head and roughly 30–90 seconds of intent, and they have already abandoned at least one journaling app. The job is to get that one honest thing recorded and kept, and to feel finished when it is done. (Confirmed by the author, 2026-09-16.)

The abandoned app is the competitive frame: whatever drove them off it is a failure mode to avoid, not a feature to reproduce.

## Product Purpose

A private journaling instrument in which each entry becomes a star and the record accumulates into a sky the writer can return to — across time, and by feeling. Success is one small act per night, kept for years. It is not volume, streaks, or metrics.

## Positioning

Two independent axes over one private sky, in a single product:

- **Time** — drift back through the record along a horizontal time scrubber. The concept is confirmed as wanted; the only implementation seen so far is janky.
- **Feeling** — isolate one feeling so its entries resolve as a constellation while the rest dims but stays.

The author's confirmed position is that holding **both at once** is the point, and that neither exists as a coherent whole in any single source build so far.

## Operating Context

- **Synthesis, not authorship.** The product is assembled from several prior AI-generated builds (Fable 5.1 Max — the code in this repository; ASTRA V2 / ASTRA MAX; Qwen 3.8 Flash Next; Fable 5.1 High; an earlier Kimi-3 build). The author acts as surgeon: features are grafted deliberately and no build is adopted wholesale.
- **This repository is raw material, not the product.** `ASTERIA` (Fable 5.1 Max) is one source. Its shape, routing, and component structure must not be treated as the product's shape.
- **Reference environment:** Firefox, desktop, 100% zoom, at 1080p / 1440p / 4K. Zoom-based scaling is explicitly rejected as a solution to sizing.
- Author-stated working constraints are recorded under **Brand Commitments** and **Accessibility & Inclusion**.

## Capabilities and Constraints

**Confirmed**

- This source implements: Next.js App Router with Postgres/Drizzle, and an HttpOnly `asteria-journal` cookie as the only identity mechanism (`src/proxy.ts:8,11,13`; `src/lib/journal.ts:17,19`).
- The record is exportable (`src/app/api/journal/export/route.ts`).
- No real user data exists anywhere yet. All in-app content is sample data (`isSample`).

**Explicitly undecided — do not resolve these without the author**

- **Identity.** Deliberately deferred; see `DESIGN_AUDIT1.md` §D1. "No accounts, no cloud" describes the current cookie implementation only and is **not** a product commitment. Do not design or build an identity mechanism.
- **The merged product's stack.** The repository's Next.js/Postgres stack is this source's stack; it is not ratified as the product's stack.
- **"Nothing to keep up with."** The no-streak / no-score / no-debt retention claim originates in the superseded draft (`DESIGN_AUDIT1.md`, appendix §1) and was **not** confirmed in interview. Hypothesis, not rule.
- **Mobile breakpoint** — ~389.9px was proposed and is being reconsidered — and iOS / `pointer: coarse` behaviour.
- **The export file as a design surface** (rather than a data dump) is a draft claim, unconfirmed.

## Brand Commitments

- **Name:** Asteria.
- **Typography is licensed and binding.** The author owns an Adobe Fonts (Typekit) subscription guaranteed for a decade or more. Never specify or use a weight the kit does not ship. Never substitute a default web-font stack (Inter / Geist / JetBrains Mono and similar) as an identity choice. Current fonts are placeholders.
- **Wordmark and SVG assets are being redesigned** — the hero and the constellation marks are in scope for replacement.
- **Copy is not final and must be rewritten** by the author. No AI-tell register, no "new-age" phrasing.
- **No eyebrow / kicker above the hero or section headers.** The author specified this; the source builds violate it.
- **No SPA feel.** Page transitions are a slight fade into a darker tone matching the incoming page's background.
- **Modal behaviour:** widen the modal before sacrificing top or bottom padding, and avoid vertical scrolling where possible.
- **Units:** `rem` by default; `em` only for font-relative work (letter-spacing, masks); `px` only for 1px hairlines.
- **Gate before any system statement:** assets assembled (wordmark, icon pack, sky render, six constellation marks) **and** copy rewritten. Until both are done, no design-system statement is honest — see `DESIGN_AUDIT1.md`.
- **Design-detector hook: declined by the author** (`consent: "declined"` in `.impeccable/config.local.json`). Do not re-enable it or ask again; run detection manually, once, after finished UI work.

## Evidence on Hand

- **Prior builds exist as archives held by the author** (Fable 5.1 Max, ASTRA V2, Qwen 3.8 Flash Next, Fable 5.1 High, Kimi-3), plus one extracted working copy at `C:\Users\peter\Python Projects\ASTRA V2`. The archives are source-only and do **not** contain `public/images/`.
- **Two real image assets** in this repository: `public/images/observatory.jpg` (referenced) and `public/images/nebula.jpg` (currently unreferenced).
- **Author annotations** of the Astra landing page: `DESIGN_AUDIT1.md` §A (A1–A24), with §D1 for deferrals.
- **Absences future work must not fabricate:** no users, testimonials, benchmarks, press, pricing, or usage data exist. Sample content is labelled in-product and must never be presented as real.
- **Tests exist and pass:** 13/13 Playwright specs covering desktop and mobile.

## Product Principles

1. **One small act, finished.** The unit of use is one entry in 30–90 seconds at night. Anything adding steps, choices, or ceremony to that act is a regression.
2. **The sky is the instrument, not a panel.** The accumulated sky is the differentiator and must hold the dominant position on whichever surface presents it; the library and utilities serve it.
3. **Assets and copy precede system.** No design system, token set, or component library becomes canonical until the wordmark, icon pack, marks, and rewritten copy exist.
4. **Merge deliberately; one subject per page.** Features are grafted from several builds. A page presenting three primary subjects at once is a merge failure, not a feature.

## Accessibility & Inclusion

- **Reference browser:** Firefox. Desktop-first, 100% zoom, 1080p / 1440p / 4K.
- **In scope now:** touch-target sizes and `.btn` sizing / type size only.
- **Explicitly deferred by the author:** colour contrast and WCAG conformance. Do not raise contrast failures as blockers until the author reopens it.
- **Open:** the mobile breakpoint (~389.9px under reconsideration) and iOS / `pointer: coarse` handling.

