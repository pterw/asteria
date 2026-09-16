# Asteria · Design Audit 1

**Not a design system.** An audit of one page. Renamed from `DESIGN.md` on 2026-09-15, because the old name claimed more than the work.

## Why there can be no design system yet

Three gates, in order, each blocking the next:

1. **Assets are not assembled.** Until the wordmark, icon pack, sky render and six constellation marks exist as decided artifacts, a "system" only describes a build we have not made.
2. **Copy is not rewritten.** It is emitted by templates (§B4). A system that codifies placeholder language codifies the placeholder.
3. **No Q&A and no external audit completed.** A Q&A via `impeccable` (`/impeccable:init`) or an audit via Claude Design is required before any system statement is honest.

**For all UI work in this repo:** `/impeccable:init` and `/anti-ui-slop`.

## Tooling state (measured, not assumed)

`impeccable` v4.2.0 lives at `C:\Users\peter\.agents\skills\impeccable\` — user-level, not in this repo. `impeccable context` against this repo reported:

- `NO_PRODUCT_MD` — no `PRODUCT.md`. **Not initialized.**
- `designPath: DESIGN.md` — renamed since, so the tooling now correctly reads this project as having **no design document**. Honest state, not a regression.
- `hasVisualImplementation: true` — for narrow refinement the incumbent code and assets are the authority, and a missing `DESIGN.md` is a documentation gap, not a blocker. A redesign/rebrand, by contrast, needs `init` first, and init must capture `PRODUCT.md` **with the human**.
- `MANUAL_DETECTOR_REQUIRED` — no hook active. After any finished UI change, once only: `impeccable.cmd detect --json <changed targets>`
- `IMAGE_TOOLS` — no converter on this machine. Ship PNG.

## Scope

**One page only:** the Astra build's `/` (renders `SkyApp`), annotated by the author at 1920x1080, full screen, 100% zoom, Firefox. Other pages not yet audited.

> **Open question — unresolved.** The author says the screenshot carries white text specifying dimensions, and that a misattribution follows from not reading it. That text has **not** been read and nothing below has been adjusted for it. Treat §A as provisional.

---

## Deferred · explicitly not now

Real questions, real answers pending, **none of them a task today**. Recorded so that nothing here gets built by accident, and so scope decisions are visible rather than remembered.

### D1 · "Return to your sky" — how does someone return?

Author's note, 2026-09-16, logged as **A24**, verbatim: *"RE: Return to your sky. How is someone returning? Later problem. IP? Username/Registration? + Not for now."*

The words mean two different things, and only one of them is the problem. No single build contains both, which is why the merge has to decide deliberately:

| Sense | Where it appears | Verdict |
|---|---|---|
| **Navigation** — *go back to the sky view* | `ASTRA V2 · SkyApp.tsx:222` (shortcut `G`) | Correct as written. Implies no identity. Leave alone. |
| **Promise** — *you are a known returner* | `Landing.tsx:42` (this repo) | Presupposes persistence the product does not have. **This is the note.** |

`Landing.tsx:39,42` — `own = stars.filter(s => !s.isSample).length` → `cta = own > 0 ? "Return to your sky" : "Enter your sky"`. The returning branch fires when **the browser already holds stars**, not when a person returns. It is a Fable-5.1-Max addition: Astra's landing page has no such branch (`ASTRA V2 · Landing.tsx:115,362` — "Enter your sky" both times).

**The actual return path today, measured — one HttpOnly cookie:**

- `src/proxy.ts:8,11,13` — `asteria-journal` read, forwarded, re-issued.
- `src/lib/journal.ts:17,19` — *"Every read and write resolves the HttpOnly cookie on the server; never trust a client-supplied owner."*

So "returning" presently means **the same browser, cookie intact**. Clear it, change machine, reinstall, or use a private window, and the sky is gone — at which point the CTA promises a return the product cannot deliver.

**Options raised, none chosen, decision postponed:** IP address (fragile — NAT, mobile handoff — and hostile to the privacy claim); username + registration (an account system, which appendix §1 rules out: *"no accounts, no cloud"*); an export/import key (the export side already exists — `src/app/api/journal/export/route.ts`).

**Do not design or build any identity mechanism now.**

Cross-reference: appendix §1 already names *"The returning writer"* as the moment the product is won or lost. That framing stands. D1 only adds that nothing sits behind it yet.

---

## A · The author's notes, transcribed

Verbatim in intent; mapped to the Astra build (`ASTRA V2`), not the Fable repo. The exception is **A24** (2026-09-16), which maps to this repo's landing page and is marked as such in the Source column.

| # | Note — element | Source |
|---|---|---|
| A1 | "Lovely wordmark logo" — `✦ asteria` + `A JOURNAL OF LITTLE THINGS` | `Sidebar.tsx:40-41` |
| A2 | "This is a nice side tab. Perhaps it should be collapsible." — the sidebar | `Sidebar.tsx:39` |
| A3 | "Boilerplate copy. AND underneath is **the only link to `\` which should be the landing page**" — the quote block | `Sidebar.tsx:50` |
| A4 | "kicker above header. NO" — `WEDNESDAY, SEPTEMBER 16` | `SkyApp.tsx:184` |
| A5 | "Italicized Serif with accent color, that has meaningless buzzword sentence. This looks like instrument serif too." — `<em>worth keeping.</em>` | `SkyApp.tsx:185` |
| A6 | "IF THE SEARCH BAR IS SO MUTED THAT I CANNOT SEE IT. THAT IS BAD" — search input | `SkyApp.tsx` rail |
| A7 | "useless even in dev" — `EXAMPLE SKY` badge | `SkyMap.tsx:18` |
| A8 | "THIS SHOULD BE SIGNIFICANTLY LARGER!!!!" — `Your sky, so far` | `SkyMap.tsx:18` |
| A9 | "THE OBSERVABLE YOU CALL MY SKY DOES NOT WANT TO BE READ" / "I literally cannot read this" — panel sub-line | `SkyMap.tsx:19` |
| A10 | "Good UX nav instructions. Horrid contrast." — footer hint | `SkyMap.tsx` footer |
| A11 | "Useless buttons eating card padding that can be used even the text out on the right and left sides" — panel icon buttons | `SkyMap.tsx` |
| A12 | "I think this should move in favor of the horizontal scrubber" — footer controls | `SkyMap.tsx` → Fable's `TimeBar` |
| A13 | "THE SKY FEELS LIKE AN ACCESSORY" — the sky panel | `SkyMap.tsx` |
| A14 | "THE \*CARDS\* AT THE BOTTOM ARE HUGE COMPARED TO THIS" | `MomentLibrary.tsx` |
| A15 | "3 cards, side-by-side, stacked over even more cards. AI tell, and there are better ways to present this" | `MomentLibrary.tsx` |
| A16 | "Nested card or pill i dont care its ugly. the text is illegible" — `Sep 16` / `Example` badge | `MomentCard.tsx` |
| A17 | "This should be SIGNIFICANTLY LARGER!!!!" — `TONIGHT'S INVITATION` | `SkyApp.tsx:199` |
| A18 | "EXCELLENT FEAT! I LOVE THIS, IT GIVES USERS A REASON TO COME BACK" — `A rhythm of returning` | `RhythmCalendar.tsx:22, 42` |
| A19 | "Rhythm. The card has far too much dead space. Font sucks." — same card, compact | `RhythmCalendar.tsx:22` |
| A20 | "THESE BUTTONS EXPLAIN THEMSELVES. GOOD." — panel icon buttons | `SkyMap.tsx` |
| A21 | "A few example moments to light the way…" — the sample notice | `SkyApp.tsx:207` |
| A22 | "Your quiet corner / Your browser's sky" — the identity row | `Sidebar.tsx:52` |
| A23 | "I cannot display this at full resolution because this is inside AI arena." / "a screenshot, imperfect, done on my 1080p monitor." | — |
| A24 | "RE: Return to your sky. How is someone returning? Later problem. IP? Username/Registration? + Not for now." — the landing CTA | `ASTERIA · Landing.tsx:42` → **D1** |

---

## Appendix · The earlier draft, carried forward unedited

The superseded `DESIGN.md`, byte-for-byte, because its measurements are real and its two competing sources of truth remain unresolved.

**Known-wrong:** §0 asserts *"This brief assumes canvas-first stays."* That is now contradicted — Astra is library-shaped and that shape is the one to keep. The appendix is evidence, not direction.


# Asteria · Design System & Brief

Draft v1 · 2026-09-15 · This document is the contract. Code follows it, not the reverse.

Companions: `src/app/globals.css` (tokens), `src/app/observatory.css` (the shipped `/sky` sheet), `scripts/review.mjs` (the legibility gate that fails the build if you cheat).

---

## 0 · Which file is canonical

Two stylesheets exist. They describe two different products, and that is the first thing to settle.

| File | Lines | Role | Wired into the app? |
|---|---|---|---|
| `src/app/observatory.css` | 335 | The shipped `/sky` instrument panel. Imported by `globals.css`. | **Yes.** This is the product. |
| `observatory.css` (project root) | 2805 | Design exploration: sidebar shell, moments card grid, prompt panel, calendar, heatmap, export strip. Self-contained (`--obs-*` palette). | No. Nothing imports it. |
| `~/Downloads/observatory.css` | 2805 | Byte-identical copy of the above (the file under edit in the current VS Code window). | No. |

**Decision required (yours):** the 2805-line sheet is a *library-shaped* Asteria (browse, filter, cards, calendar) while `/sky` is a *canvas-first* Asteria (one sky, one dock). The README states the second is the product. If the redesign adopts the first, it replaces the product shape, not just the styling. This brief assumes **canvas-first stays**, and treats the 2805-line sheet as a source of surface treatments (panel, card, reader, calendar) to be re-expressed in the token system below.

The `--obs-*` palette in the exploration sheet and the `@theme` palette in `globals.css` are two competing sources of truth. Rule: **`@theme` wins.** Nothing in a stylesheet may invent a colour.

---

## 1 · The brief at a glance

| Field | Value |
|---|---|
| Site | Asteria |
| Type | Private journaling instrument, single-user-per-browser. Not SaaS, no accounts, no cloud. |
| Primary goal | One act per night, kept for years. The artifact (a growing sky) is the reward. |
| Audience | The writer, alone, at night, 30–90 seconds of intent. Has abandoned at least one journaling app. |
| Anti-audience | Quantified-self optimisers, streak collectors, people who screenshot dashboards. Do not design for them. |
| Tone | Quiet instrument, plain speech, present tense, exact numbers. |
| Brand keywords | Night sky, gold on near-black, measured silence, one honest number, no debt, no ceremony |
| Key surfaces | `/` cinematic door · `/sky` the instrument · the export file |
| Type | Three roles: display serif (voice), text sans (work), mono (instrument labels). Adobe Fonts kit replaces the three placeholders. |

### Who is actually reading this

- **The writer.** Their attention is the scarce thing. They are not shopping, not comparing, not evaluating. They arrive with one sentence in their head and they want it out of the way.
- **The returning writer.** Returning after a gap is the moment the product is won or lost. Absence must cost nothing and read as welcome.
- **The recipient of an export.** The exported Markdown/JSON is the only Asteria artifact that outlives the browser. It is a design surface, not a data dump.

### What earns the second visit

1. **Cold open to saved star in ≤3 interactions.** Measure it in `review.mjs` (`/sky` → type → save). If it takes four, fix the flow before touching type.
2. **The sky is different tomorrow because of tonight.** The reward for returning is your own accumulated sky, rendered first, not a hero you must scroll past.
3. **No debt.** No streak, no missed-days counter, no badge to clear, no red dot on return. Nothing accrues that must be paid down. This is the entire retention argument, and it must survive every future feature request.
4. **One number, honest, pluralised correctly.** Counts of what exists (`6 stars · 6 nights · 6 constellations`). Never a score, never a percentage.
5. **A ritual with an ending.** After a save, return the reader to the sky. A toast is the whole confirmation.
6. **Compounding visible without ceremony.** Constellations tightening over months is the payoff. Show it by *behaviour* (threads to the nearest memory of its kind), never by congratulation.

## 3 · Surfaces: how many near-blacks do you actually need

Measured from the three real stylesheets (`src/app/globals.css`, `src/app/observatory.css`, root `observatory.css`), 2026-09-15, using WCAG relative luminance, CIE L\* and OKLab ΔE (×100; ~1 unit ≈ 1 JND).

**23 distinct surface values, 29 declarations, 4 perceptual families.**

| Family | Members | Shared by | Within-family spread |
|---|---|---|---|
| 1 · base | `#030409` `#04060c` `#05060c` `#07080f` `#060a17` `#080a14` `#0b0d13` `#0b0d1a` `#0e1017` `#0d101a` `#0d101d` `#0b1022` `#0e1118` | 13 values, all within ΔE 2 | **3.92 L\*** |
| 2 · panel | `#131620` `#14171f` `#141720` `#141722` `#17181e` `#161922` | 6 values | 1.45 L\* |
| 3 · raised | `#1b1e28` | 1 value | — |
| 4 · float | `#20232d` `#24232a` `#202430` | 3 values | 0.48 L\* |

**The steps between families are real; the duplicates inside them are not.**

| Step | Contrast | ΔL\* | ΔE (OKLab) |
|---|---|---|---|
| base → panel | 1.060 | 2.98 | 3.05 |
| panel → raised | 1.078 | 3.61 | 3.15 |
| raised → float | 1.061 | 2.44 | 2.10 |

Notes that decide the argument:

1. **Below ~2 L\* you cannot see the difference on a flat field**, at any screen brightness. Family 4's three members differ by 0.48 L\* — they are one colour with three names. Family 1's 13 members are one colour with thirteen names, at most two.
2. **The family-1 spread (3.92 L\*) is wider than the deliberate raised→float step (2.44 L\*).** So the "same" background is internally further apart than two of the surfaces you meant to distinguish. That is the signature of hand-nudging each panel against the last one instead of snapping to a token.
3. **Non-surface darks are legitimate and stay separate:** `#000000` (7 declarations — these are `#0002` / `#0009` / `#0006` box-shadow alphas, not surfaces), `#04050c` (scrollbar track), `#131a33` + `#232c4d` (scrollbar thumb gradient), `#1d1c18` + `#272318` (ink on the gold button). Do not collapse these into the surface scale — they answer different questions.

### The rule

Dark surfaces are separated by **ΔL\* 2.5–4.0** (ΔE 2.1–3.2). That is one visible step on a calibrated display and on a laptop panel in a lit room.

- Need a fourth tier? Use a **hairline border**, not a fifth near-black. The repo already has the convention: `.hairline { border: 1px solid rgba(238,242,255,.09) }` and `--obs-line: rgba(184,190,211,.105)`. A 1px `rgba(255,255,255,.09)` line reads as +3 L\* of separation for free, and it survives a panel with crushed blacks.
- A surface that holds text must clear **≥ 4.5:1 against its own text colour**, which the families do comfortably (see §4).

### The canonical set

Four surfaces, defined once in `@theme`, referenced everywhere:

```css
@theme {
  /* Surfaces. Steps of ~3 L*. Anything closer is invisible; anything more is a different material. */
  --color-void:   #030409;  /* page base, the sky itself */
  --color-abyss:  #060a17;  /* recessed / footer / behind the canvas */
  --color-haze:   #0b1022;  /* panels */
  --color-raise:  #14171f;  /* raised: cards, dock, modal body */
  --color-float:  #1b1e28;  /* floating: menus, popovers, active tab */
  --color-line:   rgba(184, 190, 211, .105); /* the fifth tier is always a border, never a fill */
}
```

`#0e1017`, `#0d101a`, `#07080f`, `#131620`, `#20232d`, `#24232a`, `#202430` and the rest of the 23 retire. If a surface in the exploration sheet looks wrong after the swap, the answer is a border or a shadow — not a new hex.

<!-- CHUNK-MARKER-2 -->

---

## B · Direct assessment

Written against the incumbent implementation after `impeccable context`. No system exists, so this is judgement, not compliance. Ordered by how much each one costs you.

**B1 · The page inverts its own hierarchy, and that is the whole audit.** The sky is the only thing here no other app has, and it is rendered at less area than three identical cards. "The sky feels like an accessory" is not a styling complaint — it is a mass complaint. The dominant mass on the page is the library, which is the commodity part. Swap the mass: the sky takes the width, the library takes the rail.

**B2 · Your best feature is your smallest element.** `RhythmCalendar` is the only thing on the page that answers *why come back tomorrow*, and it is tucked bottom-right beneath the invitation. Your own note calls it the thing that gives users a reason to return. It should be structurally promoted, not decorative — and it is the correct counterweight to "no debt," because it shows a rhythm without ever scoring you.

**B3 · The `/` vs `/about` inversion is the same disease as B1.** In Astra, `/` serves the instrument and the story is one link inside a quote block (`Sidebar.tsx:50`). A first-time visitor is handed the controls before being told what they are for, and the only path to the story is boilerplate. Fable has this right (`/` is the Landing, `/about` redirects). Port Fable's routing, not Astra's.

**B4 · The headline is a template, not a sentence.** `SkyApp.tsx:185` is a switch emitting one of five headline frames, each ending in an `<em>` accent, each sitting under a date eyebrow. That is a machine for generating headlines. Any template with a reserved slot for "the poetic clause" will read as generated no matter which words are poured in. The fix is the shape, not the strings.

**B5 · Nine sidebar rows sitting at exactly 4 each.** Six mood rows (`Sidebar.tsx:46`) plus four top-level items, every count identical, because it is sample data. So the design surface has never actually been seen: a real journal is lopsided — one constellation at 40, three at zero. The zero state is missing entirely, and it is the state a new user occupies for weeks.

**B6 · "Recently caught" is a template shape, not a content shape.** Three cards, identical height, each with a badge nested inside a card nested inside a grid, where the badge repeats the card's own date. One container level and the date becomes part of the card's metadata.

**B7 · What I would refuse to touch.** The mood palette, and the constellation idea itself — a feeling is a constellation you can focus, and the rest dims but stays. That is genuinely good and rare. Same for the TimeBar concept. Do not redesign those while fixing the page around them.

**B8 · The real risk in the synthesis.** Three builds are in play: Fable (canvas-first), Astra V2 (library-shaped), Qwen (constellation isolation). Merging "the best of each" feature-by-feature reliably produces a page with three primary subjects, which is precisely what the screenshot shows — sky, invitation, rhythm and cards all competing at once. The merge should hold **one subject per page**, with the others one click away. The sidebar is the only structure that can carry that, and today it carries nav, six moods, a quote and an identity row simultaneously.

---

## C · Closing note

No design system can be stated from this file. The three gates stand in order: **assets assembled → copy rewritten → Q&A (`/impeccable:init`) or audit completed.** Until all three are met, this document is an audit and a set of constraints, not a system.

