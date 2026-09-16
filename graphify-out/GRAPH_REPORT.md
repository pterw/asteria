# Graph Report - ASTERIA  (2026-09-16)

## Corpus Check
- 49 files · ~37,164 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 174 nodes · 411 edges · 19 communities (15 shown, 4 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `916da1b5`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- journal.ts
- Observatory
- Observatory.tsx
- astral.ts
- SkyCanvas.tsx
- dayKey
- layout.tsx
- review.mjs
- proxy.ts
- next.config.ts
- postcss.config.mjs

## God Nodes (most connected - your core abstractions)
1. `Observatory()` - 17 edges
2. `StarDto` - 13 edges
3. `dayKey()` - 12 edges
4. `errorResponse()` - 11 edges
5. `getJournalStars()` - 11 edges
6. `MoodKey` - 10 edges
7. `requireJournal()` - 10 edges
8. `starTitle()` - 10 edges
9. `isMoodKey()` - 9 edges
10. `MOODS` - 9 edges

## Surprising Connections (you probably didn't know these)
- `proxy()` --calls--> `isUuid()`  [EXTRACTED]
  src/proxy.ts → src/lib/astral.ts
- `Page()` --calls--> `getJournalStars()`  [EXTRACTED]
  src/app/page.tsx → src/lib/journal.ts
- `download()` --calls--> `dayKey()`  [EXTRACTED]
  src/components/sky/Observatory.tsx → src/lib/astral.ts
- `MomentInput` --references--> `MoodKey`  [EXTRACTED]
  src/lib/api.ts → src/lib/astral.ts
- `Draft` --references--> `MoodKey`  [EXTRACTED]
  src/components/sky/Composer.tsx → src/lib/astral.ts

## Import Cycles
- None detected.

## Communities (19 total, 4 thin omitted)

### Community 0 - "journal.ts"
Cohesion: 0.14
Nodes (29): dynamic, DELETE(), dynamic, Context, DELETE(), dynamic, owned(), PATCH() (+21 more)

### Community 1 - "Observatory"
Cohesion: 0.10
Nodes (21): dynamic, Page(), dynamic, metadata, SkyPage(), EASE, FRAGMENTS, Landing() (+13 more)

### Community 2 - "Observatory.tsx"
Cohesion: 0.12
Nodes (19): Draft, favorite(), release(), PHASES, Toast, Props, SkyCanvasHandle, SkyNotes() (+11 more)

### Community 3 - "astral.ts"
Cohesion: 0.21
Nodes (15): dynamic, GET(), Ledger(), MoodDot(), EMPTY_FILTERS, filtersActive(), firstWords(), formatNight() (+7 more)

### Community 4 - "SkyCanvas.tsx"
Cohesion: 0.15
Nodes (15): AmbientStars(), LayerStar, Meteor, buildScene(), Camera, COLORS, Edge, Group (+7 more)

### Community 5 - "dayKey"
Cohesion: 0.31
Nodes (9): Almanac(), Composer(), submit(), initialDraft(), dayKey(), calendarDate(), keyFormatters, shiftDay() (+1 more)

### Community 6 - "layout.tsx"
Cohesion: 0.29
Nodes (5): fraunces, grotesk, metadata, plex, viewport

## Knowledge Gaps
- **38 isolated node(s):** `EASE`, `FRAGMENTS`, `Context`, `Toast`, `Mood` (+33 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Observatory()` connect `Observatory` to `Observatory.tsx`, `astral.ts`, `SkyCanvas.tsx`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Why does `StarDto` connect `Observatory.tsx` to `journal.ts`, `Observatory`, `astral.ts`, `SkyCanvas.tsx`, `dayKey`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `dayKey()` connect `dayKey` to `Observatory`, `Observatory.tsx`, `astral.ts`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **What connects `EASE`, `FRAGMENTS`, `Context` to the rest of the system?**
  _38 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `journal.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13765182186234817 - nodes in this community are weakly interconnected._
- **Should `Observatory` be split into smaller, more focused modules?**
  _Cohesion score 0.09655172413793103 - nodes in this community are weakly interconnected._
- **Should `Observatory.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.12169312169312169 - nodes in this community are weakly interconnected._