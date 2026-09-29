---
phase: 08-simulation-compare
plan: 01
subsystem: ui
tags: [react, tanstack-query, tanstack-router, zod, vitest, testing-library]

requires:
  - phase: 07-event-pages
    provides: event.$eventKey.tsx's renderTabState branch-order convention, artifactUrl()/errors.ts fetch discipline
provides:
  - "/compare route reading all five live v1/compare/{year}.json artifacts"
  - AccuracyTable component (D-08 contract) and buildAccuracyRows pure row model
  - StateViews.tsx ErrorState with optional year, for pages not scoped to one year
  - Five committed real compare-artifact fixtures as this app's first JSON-fixture parity test
affects: [08-06 (compLevel switcher), 08-10 (calibration year select), 08-12 (data-coverage section), 08-15 (390px overflow backstop)]

actuals:
  tokens: 30700
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Committed real downloaded artifact bytes as a JSON test fixture (apps/web/src/routes/__fixtures__/), the first such fixture in apps/web — every prior component test used an inline object literal"
    - "useQueries fan-out over a module-constant season list (never ?year=), with one page-level branch derived from all N results, mirroring event.$eventKey.tsx's renderTabState order"
    - "ErrorState's year prop widened to optional (additive), for pages whose data isn't scoped to a single year"

key-files:
  created:
    - apps/web/src/lib/api/compare.ts
    - apps/web/src/lib/api/compare.test.ts
    - apps/web/src/routes/__fixtures__/compare-2022.json
    - apps/web/src/routes/__fixtures__/compare-2023.json
    - apps/web/src/routes/__fixtures__/compare-2024.json
    - apps/web/src/routes/__fixtures__/compare-2025.json
    - apps/web/src/routes/__fixtures__/compare-2026.json
    - apps/web/src/routes/compare.test.tsx
    - apps/web/src/components/compare/AccuracyTable.tsx
    - apps/web/src/components/compare/AccuracyTable.test.tsx
  modified:
    - apps/web/src/routes/compare.tsx
    - apps/web/src/components/StateViews.tsx
    - apps/web/src/components/StateViews.test.tsx

key-decisions:
  - "All five years (2022-2026) committed as real downloaded fixtures, not just 2026 (plan Decision 1) — a one-year fixture would prove SC-4 for only one fifth of the rendered numbers"
  - "ErrorState's year prop is optional rather than inventing a second error component (plan Decision 2) — all four pre-existing call sites verified byte-identical"
  - "compare.tsx declares no validateSearch of its own (plan Decision 3) — the page ignores the ribbon's global year/algorithm dropdowns entirely, per UI-SPEC's documented exception"
  - "Two-row grouped header (Year rowspan=2, three algorithm-group colspan=2 headers) reconciling UI-SPEC's shape line, its Copywriting Contract strings, and sketch 007's structure (plan Decision 4)"
  - "markArtifactParsed() called on each of the five parses, unchanged from every other fetcher — performance.measure resolves to the LAST parse, the correct reading for a page needing all five (plan Decision 5)"

patterns-established:
  - "Compare-style page: N independent artifact queries collapsed into one page-level 404/error/pending/populated branch, with a retry that refetches only the failed queries"
  - "Fixture-derived parity test: every expected value is an expression over an imported real fixture object, never a hand-typed second copy, so the test cannot silently drift from the data it claims to prove"

requirements-completed: [COMP-01, EVAL-05]

coverage:
  - id: D1
    description: "/compare fetches all five real published v1/compare/{year}.json artifacts, parses each through CompareArtifactSchema, and renders winner accuracy and Brier score for OPR/EPA/VPR for every season 2022-2026"
    requirement: COMP-01
    verification:
      - kind: unit
        ref: "apps/web/src/lib/api/compare.test.ts — fetch/parse/error-shape assertions"
        status: pass
      - kind: integration
        ref: "apps/web/src/routes/compare.test.tsx — 15 parameterized season x algorithm parity cases"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every rendered number is proven identical to a committed copy of the real published artifact via fixture-derived Vitest assertions, no hand-typed expected figure anywhere"
    requirement: EVAL-05
    verification:
      - kind: integration
        ref: "apps/web/src/routes/compare.test.tsx — expected values computed via slice.brierScore.toFixed(4) / (winnerAccuracy*100).toFixed(1) at run time"
        status: pass
    human_judgment: false
  - id: D3
    description: "AccuracyTable satisfies its D-08 contract: uniform table, ascending season rows, PUBLISHED_ALGORITHM_IDS column order, Copywriting Contract header strings, plain-weight numeric cells, no per-algorithm colour, no seasonLabel/headlineEligible tiering"
    verification:
      - kind: unit
        ref: "apps/web/src/components/compare/AccuracyTable.test.tsx — 19 cases covering ordering, precision, empty-value, view-selection, plain-weight and no-tiering assertions"
        status: pass
    human_judgment: false
  - id: D4
    description: "Page-level 404/error/pending/populated branch order, Copywriting Contract's exact Compare error copy, working Retry"
    verification:
      - kind: integration
        ref: "apps/web/src/routes/compare.test.tsx — 404/500/pending page-state cases"
        status: pass
    human_judgment: false
  - id: D5
    description: "390px horizontal-scroll behavior of the accuracy table (S3/C1 backstop rows) — visual/real-device confirmation, not unit-testable"
    verification: []
    human_judgment: true
    rationale: "UI-SPEC names this a backstop row owned by 08-15's C1 verification pass at a real viewport width; this plan ships the sibling scroll-region structure and class set that pattern needs, but the visual check itself is out of this plan's scope"

duration: 15min
completed: 2026-08-31
status: complete
---

# Phase 8 Plan 1: Compare tracer + AccuracyTable Summary

**`/compare` now fetches five real published `v1/compare/{year}.json` artifacts and renders a D-08-compliant accuracy table, with a 19-case component test and a 15-case fixture-derived parity proof against committed real bytes.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-08-31T17:35:53Z
- **Completed:** 2026-08-31T17:49:27Z
- **Tasks:** 3
- **Files modified:** 13

## Accomplishments

- `apps/web/src/lib/api/compare.ts`: `fetchCompareArtifact`/`compareQueryOptions`/`COMPARE_SEASONS`/`CompareCompLevelView` — the Compare page's fetch/Zod/query-options seam, deliberately carrying no `algorithmId`/`version` (the compare key has no version segment, so no `useAlgorithmVersion` gate is needed)
- Five real published `v1/compare/{year}.json` bodies downloaded once and committed byte-identical under `apps/web/src/routes/__fixtures__/` — this app's first committed-JSON-fixture test
- `apps/web/src/components/compare/AccuracyTable.tsx`: the COMP-01 accuracy table and its pure `buildAccuracyRows` row model — ascending season rows, `PUBLISHED_ALGORITHM_IDS`-ordered algorithm column-groups, sketch 007's two-row grouped header, plain-weight `numeric-cell` figures, em-dash for absent/null values, zero `seasonLabel`/`headlineEligible` reads
- `apps/web/src/routes/compare.tsx` replaced wholesale: five-query `useQueries` fan-out, one page-level 404/error/pending/populated branch mirroring `event.$eventKey.tsx`'s `renderTabState` order, `AccuracyTable`/`AccuracyTableSkeleton` mounted
- `apps/web/src/routes/compare.test.tsx`: D-10's parity proof — 15 parameterized (season, algorithm) cases plus 3 page-state cases, every expected value computed from the imported real fixture at run time
- `StateViews.tsx`'s `ErrorState.year` prop widened to optional, additively — the Compare page's year-less error line, with all four pre-existing call sites verified unchanged

## Task Commits

1. **Task 1: End-to-end "/compare shows real published accuracy numbers"** - `b20c695d` (feat, tracer)
2. **Task 2: AccuracyTable, complete to its D-08 contract** - `8defb462` (test, RED) → `4d25c90e` (feat, GREEN)
3. **Task 3: Mount the table and land D-10's parity proof** - `b25d552f` (feat)

_TDD gate compliance: Task 2's RED commit (`8defb462`, test-only, confirmed failing on import) precedes its GREEN commit (`4d25c90e`, implementation + all 19 cases passing) — both gates present._

## Files Created/Modified

- `apps/web/src/lib/api/compare.ts` - fetch/parse/query-options seam
- `apps/web/src/lib/api/compare.test.ts` - fetcher tests, compile-time params-shape assertion
- `apps/web/src/routes/__fixtures__/compare-{2022..2026}.json` - real committed published artifact bytes
- `apps/web/src/routes/compare.tsx` - the real `/compare` page
- `apps/web/src/routes/compare.test.tsx` - D-10 parity test
- `apps/web/src/components/compare/AccuracyTable.tsx` - the accuracy table + `buildAccuracyRows`
- `apps/web/src/components/compare/AccuracyTable.test.tsx` - 19-case component test
- `apps/web/src/components/StateViews.tsx` - `ErrorState.year` made optional
- `apps/web/src/components/StateViews.test.tsx` - two new cases (year-less + year-bearing re-assertion)

## Decisions Made

See `key-decisions` in frontmatter — all five decisions were already recorded by the plan itself (Claude's Discretion section) and executed as specified; no new decisions were made beyond the plan's own text.

## Deviations from Plan

**1. [Minor, no rule triggered] Task 3's literal "add a module constant for the skeleton row count" instruction was already satisfied by Task 2's design.**
- **Found during:** Task 3
- **Issue:** Task 3's action text asks for a module constant in `compare.tsx` for the skeleton's row count, but Task 2's own frontmatter export list fixed `AccuracyTableSkeleton` as a **no-props** component (`AccuracyTableSkeleton` takes no arguments) — the row/column counts already live as `ACCURACY_TABLE_ROW_COUNT`/`ACCURACY_TABLE_COLUMN_COUNT` module constants inside `AccuracyTable.tsx`, the correct owner of its own skeleton's shape.
- **Resolution:** No redundant constant added to `compare.tsx`; the intent (a named constant, never a bare number at any call site) is satisfied at the component that actually owns the number.
- **Files affected:** none beyond what Task 2/3 already touched.
- **Verification:** `grep` confirms no bare numeric literal is passed to `<AccuracyTableSkeleton />` (it takes no props at all).

**Total deviations:** 1, no-op/documentation-only. No auto-fixes were needed (Rules 1-3 never triggered) and no architectural question arose (Rule 4 never triggered).

## Issues Encountered

- **Two self-authored test bugs found and fixed during Task 2's RED→GREEN cycle, before either commit landed:** (1) `AccuracyTable.test.tsx`'s own `makeSlice` fixture helper used `overrides.brierScore ?? 0.15`, which silently coerced an explicit `brierScore: null` override back to the default `0.15` (nullish coalescing treats `null` as absent) — fixed to check key presence via `"brierScore" in overrides`. (2) The scroll-region nesting test misread `within(region).queryAllByTestId(...)`'s descendant-only search semantics, expecting length 1 (including the container) when the correct expectation for "no nested duplicate" is length 0. Both were caught by running the real test suite before committing, not shipped.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `/compare` is live with a real, D-08-complete accuracy table proven against real published bytes — 08-06 can now wire its compLevel switcher into `AccuracyTable`'s already-frozen `compLevelView` prop with no other change to this component.
- `COMPARE_SEASONS`, `CompareCompLevelView`, `BRIER_HEADER_LABEL`/`WINNER_ACCURACY_HEADER_LABEL`, and the `compareQueryOptions` seam are all exported and ready for 08-10 (calibration) and 08-12 (data-coverage section) to import rather than re-derive.
- D-11's near-tie bolding rule (adjacency/boundary probes) is explicitly NOT implemented here — every cell renders at plain weight, as this plan's `must_haves` require; 08-06 lands that rule.
- The S3/C1 overflow backstop (real 390px render check) remains open, owned by 08-15, per the plan's own probe-coverage ledger.

## Self-Check: PASSED

All 13 created/modified files confirmed present on disk; all 4 task commits (`b20c695d`, `8defb462`, `4d25c90e`, `b25d552f`) confirmed in `git log`.

---
*Phase: 08-simulation-compare*
*Completed: 2026-08-31*
