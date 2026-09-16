# Graph Report - ASTERIA  (2026-09-16)

## Corpus Check
- 54 files · ~206,306 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 159 nodes · 312 edges · 24 communities (20 shown, 4 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e8508be6`
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
- isUuid
- next.config.ts
- postcss.config.mjs
- index.ts
- stars/route.ts
- [id]/route.ts
- ApiError

## God Nodes (most connected - your core abstractions)
1. `getJournalStars()` - 12 edges
2. `errorResponse()` - 11 edges
3. `requireJournal()` - 10 edges
4. `MoodKey` - 9 edges
5. `StarDto` - 9 edges
6. `isMoodKey()` - 9 edges
7. `dayKey()` - 8 edges
8. `toStar()` - 7 edges
9. `POST()` - 7 edges
10. `isUuid()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `PATCH()` --calls--> `toStar()`  [EXTRACTED]
  src/app/api/stars/[id]/route.ts → src/lib/journal.ts
- `owned()` --calls--> `requireJournal()`  [EXTRACTED]
  src/app/api/stars/[id]/route.ts → src/lib/journal.ts
- `POST()` --calls--> `requireJournal()`  [EXTRACTED]
  src/app/api/stars/route.ts → src/lib/journal.ts
- `requireJournal()` --calls--> `isUuid()`  [EXTRACTED]
  src/lib/journal.ts → src/lib/astral.ts
- `GET()` --calls--> `getJournalStars()`  [EXTRACTED]
  src/app/api/journal/export/route.ts → src/lib/journal.ts

## Import Cycles
- None detected.

## Communities (24 total, 4 thin omitted)

### Community 0 - "journal.ts"
Cohesion: 0.35
Nodes (8): DELETE(), dynamic, journals, StarRow, stars, getSampleStarDtos(), requireJournal(), makeSamples()

### Community 1 - "Landing.tsx"
Cohesion: 0.12
Nodes (17): GET(), dynamic, Page(), dynamic, metadata, SkyPage(), EASE, FRAGMENTS (+9 more)

### Community 2 - "astral.ts"
Cohesion: 0.11
Nodes (24): Composer(), submit(), Draft, initialDraft(), Props, SkyCanvasHandle, Modal(), MoodDot() (+16 more)

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

### Community 8 - "isUuid"
Cohesion: 0.67
Nodes (3): isUuid(), config, proxy()

### Community 19 - "index.ts"
Cohesion: 0.33
Nodes (4): dynamic, db, globalForDb, pool

### Community 21 - "stars/route.ts"
Cohesion: 0.40
Nodes (8): dynamic, POST(), MomentInput, readBody(), validateMoment(), constellationPosition(), isMoodKey(), toStar()

### Community 22 - "[id]/route.ts"
Cohesion: 0.48
Nodes (6): Context, DELETE(), dynamic, owned(), PATCH(), errorResponse()

## Knowledge Gaps
- **41 isolated node(s):** `globalForDb`, `pool`, `Context`, `Mood`, `SortOrder` (+36 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `StarDto` connect `astral.ts` to `journal.ts`, `Landing.tsx`, `SkyCanvas.tsx`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `isMoodKey()` connect `stars/route.ts` to `journal.ts`, `Landing.tsx`, `astral.ts`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Why does `getJournalStars()` connect `Landing.tsx` to `journal.ts`, `SkyCanvas.tsx`, `stars/route.ts`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **What connects `globalForDb`, `pool`, `Context` to the rest of the system?**
  _41 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Landing.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._
- **Should `astral.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10984848484848485 - nodes in this community are weakly interconnected._
- **Should `SkyCanvas.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.11857707509881422 - nodes in this community are weakly interconnected._