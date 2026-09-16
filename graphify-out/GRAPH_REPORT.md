# Graph Report - ASTERIA  (2026-09-16)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 173 nodes · 414 edges · 18 communities (14 shown, 4 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `004190a9`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10

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

## Communities (18 total, 4 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.14
Nodes (29): dynamic, DELETE(), dynamic, Context, DELETE(), dynamic, owned(), PATCH() (+21 more)

### Community 1 - "Community 1"
Cohesion: 0.10
Nodes (21): dynamic, Page(), dynamic, metadata, SkyPage(), EASE, FRAGMENTS, Landing() (+13 more)

### Community 2 - "Community 2"
Cohesion: 0.12
Nodes (19): Draft, favorite(), release(), PHASES, Toast, Props, SkyCanvasHandle, SkyNotes() (+11 more)

### Community 3 - "Community 3"
Cohesion: 0.21
Nodes (15): dynamic, GET(), Ledger(), MoodDot(), EMPTY_FILTERS, filtersActive(), firstWords(), formatNight() (+7 more)

### Community 4 - "Community 4"
Cohesion: 0.15
Nodes (15): AmbientStars(), LayerStar, Meteor, buildScene(), Camera, COLORS, Edge, Group (+7 more)

### Community 5 - "Community 5"
Cohesion: 0.31
Nodes (9): Almanac(), Composer(), submit(), initialDraft(), dayKey(), calendarDate(), keyFormatters, shiftDay() (+1 more)

### Community 6 - "Community 6"
Cohesion: 0.29
Nodes (5): fraunces, grotesk, metadata, plex, viewport

## Knowledge Gaps
- **38 isolated node(s):** `Context`, `Toast`, `Mood`, `LayerStar`, `Meteor` (+33 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Observatory()` connect `Community 1` to `Community 2`, `Community 3`, `Community 4`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `StarDto` connect `Community 2` to `Community 0`, `Community 1`, `Community 3`, `Community 4`, `Community 5`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `dayKey()` connect `Community 5` to `Community 1`, `Community 2`, `Community 3`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **What connects `Context`, `Toast`, `Mood` to the rest of the system?**
  _38 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.13765182186234817 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.09885057471264368 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.12169312169312169 - nodes in this community are weakly interconnected._