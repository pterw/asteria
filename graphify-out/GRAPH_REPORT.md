# Graph Report - ASTERIA  (2026-09-16)

## Corpus Check
- 54 files · ~206,243 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 158 nodes · 309 edges · 21 communities (16 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5b559dfc`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- journal.ts
- Landing.tsx
- astral.ts
- Asteria
- SkyCanvas.tsx
- time.ts
- layout.tsx
- review.mjs
- proxy.ts
- next.config.ts
- postcss.config.mjs
- health/route.ts

## God Nodes (most connected - your core abstractions)
1. `errorResponse()` - 11 edges
2. `getJournalStars()` - 11 edges
3. `requireJournal()` - 10 edges
4. `MoodKey` - 9 edges
5. `StarDto` - 9 edges
6. `isMoodKey()` - 9 edges
7. `dayKey()` - 8 edges
8. `POST()` - 7 edges
9. `isUuid()` - 7 edges
10. `toStar()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `proxy()` --calls--> `isUuid()`  [EXTRACTED]
  src/proxy.ts → src/lib/astral.ts
- `MomentInput` --references--> `MoodKey`  [EXTRACTED]
  src/lib/api.ts → src/lib/astral.ts
- `Draft` --references--> `MoodKey`  [EXTRACTED]
  src/components/sky/Composer.tsx → src/lib/astral.ts
- `SkyCanvasHandle` --references--> `StarDto`  [EXTRACTED]
  src/components/sky/SkyCanvas.tsx → src/lib/astral.ts
- `GET()` --calls--> `getJournalStars()`  [EXTRACTED]
  src/app/api/stars/route.ts → src/lib/journal.ts

## Import Cycles
- None detected.

## Communities (21 total, 5 thin omitted)

### Community 0 - "journal.ts"
Cohesion: 0.16
Nodes (27): DELETE(), dynamic, Context, DELETE(), dynamic, owned(), PATCH(), dynamic (+19 more)

### Community 1 - "Landing.tsx"
Cohesion: 0.12
Nodes (17): dynamic, Page(), dynamic, metadata, SkyPage(), EASE, FRAGMENTS, Landing() (+9 more)

### Community 2 - "astral.ts"
Cohesion: 0.11
Nodes (23): Composer(), submit(), Draft, initialDraft(), Props, SkyCanvasHandle, Modal(), MoodDot() (+15 more)

### Community 3 - "Asteria"
Cohesion: 0.40
Nodes (4): Asteria, Engineering, The two surfaces, Verify

### Community 4 - "SkyCanvas.tsx"
Cohesion: 0.12
Nodes (20): dynamic, GET(), AmbientStars(), LayerStar, Meteor, buildScene(), Camera, COLORS (+12 more)

### Community 5 - "time.ts"
Cohesion: 0.50
Nodes (4): calendarDate(), keyFormatters, shiftDay(), zonedDayKey()

### Community 6 - "layout.tsx"
Cohesion: 0.29
Nodes (5): fraunces, grotesk, metadata, plex, viewport

## Knowledge Gaps
- **41 isolated node(s):** `The two surfaces`, `Engineering`, `Verify`, `Context`, `Mood` (+36 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `StarDto` connect `astral.ts` to `journal.ts`, `Landing.tsx`, `SkyCanvas.tsx`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `isMoodKey()` connect `journal.ts` to `Landing.tsx`, `astral.ts`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Why does `getJournalStars()` connect `Landing.tsx` to `journal.ts`, `SkyCanvas.tsx`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **What connects `The two surfaces`, `Engineering`, `Verify` to the rest of the system?**
  _41 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Landing.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._
- **Should `astral.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11290322580645161 - nodes in this community are weakly interconnected._
- **Should `SkyCanvas.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.11857707509881422 - nodes in this community are weakly interconnected._