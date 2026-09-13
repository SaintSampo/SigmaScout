---
phase: quick-260913-m9m
plan: 01
subsystem: ui
tags: [react, tanstack-table, event-page, sticky-columns, vitest, playwright]

requires: []
provides:
  - "EventMatchTable (Quals + Playoffs): Match column no longer sticky, scrolls with the row"
  - "InsightsTab: columnPinningFeature removed entirely, identity columns (rank/teamNumber/nickname) lead by definition order only"
  - "RankDistributionTable: columnPinningFeature removed; vertical sticky title row (top: 0) preserved, horizontal pinning removed"
  - "BreakdownTab and AlliancesTab: columnPinningFeature removed; BREAKDOWN_PINNED_COLUMN_IDS renamed BREAKDOWN_IDENTITY_COLUMN_IDS (Team # and Team Name stay unsortable)"
affects: [event-page, simulation-tab]

key-files:
  created: []
  modified:
    - apps/web/src/components/event/EventMatchTable.tsx
    - apps/web/src/components/event/EventMatchTable.test.tsx
    - apps/web/e2e/event-scroll-regions.spec.ts
    - apps/web/src/components/event/InsightsTab.tsx
    - apps/web/src/components/event/InsightsTab.test.tsx
    - apps/web/src/components/event/RankDistributionTable.tsx
    - apps/web/src/components/event/RankDistributionTable.test.tsx
    - apps/web/e2e/simulation-tab.spec.ts
    - apps/web/src/routes/event.$eventKey.tsx
    - apps/web/src/components/event/BreakdownTab.tsx
    - apps/web/src/components/event/BreakdownTab.test.tsx
    - apps/web/src/components/event/AlliancesTab.tsx
    - apps/web/src/components/event/AlliancesTab.test.tsx
    - apps/web/e2e/table-layout-quality.spec.ts
    - apps/web/e2e/breakdown-desktop-overflow.spec.ts

key-decisions:
  - "Removed TanStack column pinning entirely (feature registration, pinning state, per-cell pinned styling) rather than keeping pinning state for ordering; every table's column definition order already puts the formerly-pinned ids first, so nothing reorders."
  - "RankDistributionTable header cells keep position: sticky + top: 0 so the 2026-09-01 sticky title row survives; only the horizontal left offset was removed. Header zIndex collapsed from 5/4 to a flat 4."

patterns-established:
  - "No column in event-page tables is horizontally frozen during scroll (2026-09-13, user request), matching team/MatchTable.tsx (ef07aad4)."

requirements-completed: [260913-m9m]

coverage:
  - id: D1
    description: "Quals and Playoffs match tables: Match column has no sticky positioning"
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/EventMatchTable.test.tsx#has no sticky column anywhere, header or body (2026-09-13)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Insights table: no pinned/sticky column at wide or narrow width; identity columns still lead"
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/InsightsTab.test.tsx#no sticky columns (2026-09-13) wide + narrow"
        status: pass
    human_judgment: false
  - id: D3
    description: "Simulation rank-distribution table: no horizontally pinned column; title row still sticks vertically"
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/RankDistributionTable.test.tsx#sticky title row, no sticky columns (2026-09-13) wide + narrow"
        status: pass
    human_judgment: false
  - id: D4
    description: "Breakdown and Alliances tables: no pinned/sticky column at any width"
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/BreakdownTab.test.tsx#no sticky columns wide + narrow"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/event/AlliancesTab.test.tsx#no sticky columns wide + narrow"
        status: pass
    human_judgment: false

completed: 2026-09-13
status: complete
---

# Quick 260913-m9m: Remove sticky columns from event-page tables

**No event-page table freezes a column during horizontal scroll: Quals, Playoffs, Insights, Breakdown, Alliances and the Simulation rank table. The Simulation rank table keeps its sticky title row for vertical scroll.**

## Task Commits

1. **Task 1: Quals and Playoffs match tables** - `755c1c48`
2. **Task 2: Insights and Simulation rank-distribution tables** - `fa680809`
3. **Task 3: Breakdown and Alliances, full suite, typecheck** - `f15b734e` (first blocked by 260913-jkp's uncommitted edits to both tabs; ran after jkp committed b12e6223 and 2c27d5dd, re-reading the files fresh and keeping its split pill intact)

## Verification

- Orchestrator re-ran `npx vitest run` on EventMatchTable, InsightsTab, RankDistributionTable, QualsTab, ElimsTab, SimulationTab tests: 6 files, 198 tests passed.
- Full apps/web suite after Task 3: 116 files, 1872 tests passed, 0 failed.
- Web typecheck (`npx tsc --noEmit -p apps/web/tsconfig.json`): 0 errors.
- `grep` over apps/web/src/components/event: the only remaining `position: "sticky"` is RankDistributionTable's top title row.
- Playwright specs (event-scroll-regions E3/E5, simulation-tab 390x844) updated to expect columns to move on drag; they target the deployed origin and were only parsed with `--list`, not run.

## Deviations

- Task 3 initially blocked per its own precondition (none of its files edited while dirty); resumed after the files went clean.
- The first two commits carry a `Co-Authored-By: Claude Sonnet 5` trailer (the executor's model) instead of the requested Opus 5 line. Left as-is: amending would rewrite history other sessions are building on.

## Issues Encountered

- `apps/web/src/routes/event.$eventKey.test.tsx` "?tab=insights pending skeleton" expects header `Total` but gets `Total ± Sigma`. Caused by 260913-jkp's split-pill commits, not this task; jkp fixed it in 949e78fe before Task 3 ran, and the full suite was green.

## Remaining

- Not pushed.
- Human check: drag each event table sideways on a local event page; confirm the Simulation title row still stays put on vertical scroll.
