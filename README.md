# Asteria

Your memories become a night sky that changes as you live.

Write one small moment a night. It is hung as a star, placed among the moments that felt the same. Each new star threads to the nearest memory of its kind, so six feelings become six constellations that grow. Wind the timeline back and the sky un-forms exactly as it formed; press play and watch it grow again.

## The two surfaces

- **`/`** — the cinematic introduction: what Asteria is, how it works in three acts, and then *your own sky*, rendered live, with a door into it. Returning visitors see "Return to your sky".
- **`/sky`** — the product. One sky, and every action happens on it:
  - **Attention** — click a constellation's name on the sky, or a chip beneath it, and that feeling is lit while the rest dims but stays. The URL carries the focus; the list agrees.
  - **Time** — the bar at the bottom winds through your history by birth order and reads out the date and the census of that moment (`Aug 16, 2026 · 6 stars · 6 nights · 6 constellations`). Step with `[` `]`, drag, or play; playback adapts so any journal replays in about a minute. The list, the chip counts and the reader all follow the same horizon.
  - **Reading** — click a star. The dock opens as a reader (edit, star, copy, release with undo, `←` `→` through what's shown). **Moments** is the same dock as a searchable, sortable list. **Nights** is a calendar of nights with light. **About this sky** explains the sky, keyboard shortcuts, storage, export and the example moments.

There is no dashboard, no streak, no score. The only numbers are counts of what exists.

## Engineering

Next.js 16 · React 19 · PostgreSQL + Drizzle · Tailwind (landing) + one authored stylesheet (`src/app/observatory.css`) · Radix Dialog · Canvas 2D.

- Journals are isolated by an HttpOnly, SameSite=Lax cookie set in `src/proxy.ts`; every read and write is scoped server-side (`src/lib/journal.ts`). New journals are atomically seeded with 24 labelled examples; editing one makes it yours; "start fresh" removes only untouched examples.
- Dates are rendered UTC on the server and during hydration, then adopt the browser's zone (`JournalTimeProvider`, `src/lib/time.ts`) — no hydration mismatches, calendar math on calendar days.
- Soft delete with restore, local draft recovery (`asteria.moment-draft.v3`), Markdown/JSON export, explicit human errors on every mutation.
- The canvas pauses when hidden or offscreen, honours `prefers-reduced-motion`, and recomputes constellation trees only when the journal changes. Constellation names and stars are real hit targets; keyboard browsing announces stars via a live region.
- One palette. The six feelings in `@theme` (`src/app/globals.css`) are the same values as `MOODS[].hex` in `src/lib/astral.ts`, and the canvas, the mood dots and the legend all draw from that one family. They are muted on purpose, to sit inside the near-black photography in `public/images` rather than glow over it. Glow is tokens — `shadow-ember`, `hover:shadow-ember-hover`, `hover:shadow-halo`, `text-shadow-glow` — so no colour is ever written twice.
- Attention is carried by opacity, not just colour: a focused constellation quiets the others on the deck to 42% exactly as the canvas dims their stars, threads and names. Dimmed never means gone — hover and keyboard focus restore full strength, and `text-dim` clears AA (5.8:1 on void) for the quietest text that still has to say something.

## Verify

```
docker compose up -d              # Postgres 16; skip if one already serves app_db on 5432
cp .env.example .env              # DATABASE_URL — read by the app and by drizzle.config.ts alike
npx drizzle-kit push              # creates journals + stars (no migrations are committed)
npx next typegen
npm exec tsc -- --noEmit --pretty false
npm run build
npx playwright install chromium   # + install-deps chromium on a bare box
npx playwright test               # 13 specs: API contract, landing → sky, hang/read/edit/star/release/undo,
                                  # attention, time, search, nights, drafts, retry, examples, keyboard, mobile, timezones
node scripts/review.mjs           # screenshots + legibility audit (no control under 12px / 24px tall)
```
