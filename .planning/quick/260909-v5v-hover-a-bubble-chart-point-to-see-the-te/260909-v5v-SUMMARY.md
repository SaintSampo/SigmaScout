---
phase: quick-260909-v5v
plan: 01
subsystem: ui
tags: [react, svg, tanstack-router, teams-table, bubble-chart, hit-testing]

# Dependency graph
requires:
  - phase: quick-260909-tom
    provides: "The four-DOM-node bubble chart (tonePathData, BUBBLE_CHART geometry) this plan adds hover/click to."
provides:
  - "buildHitIndex/hitTestNearest: a uniform-grid spatial index resolving a pointer position to the nearest plotted team, tie-broken on lowest team number"
  - "tooltipAnchorFor: pure, edge-aware tooltip card placement"
  - "TeamsBubbleChart hover tooltip and click-to-navigate, still capped at at most four <path> plus two extra nodes"
  - "SWING_AXIS_LABEL: the single shared source for the Y axis / tooltip Swing Score label"
affects: [teams-table, bubble-chart]

# Actuals (#2632)
actuals:
  tokens: 13790
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure hit-testing in the model module (no DOM access) so a jsdom-no-layout test environment can exhaustively unit-test pointer resolution"
    - "Uniform-grid spatial index with cell size == hit radius, flat integer-indexed buckets, zero per-move allocation"
    - "Cached svg bounding rect in a ref, invalidated (not re-measured) on resize/scroll"
    - "Presentational component takes an onSelectTeam callback; the route owns navigate — keeps the component importable/testable with no RouterProvider"

key-files:
  created: []
  modified:
    - apps/web/src/components/teams-table/teamsBubbleModel.ts
    - apps/web/src/components/teams-table/teamsBubbleModel.test.ts
    - apps/web/src/components/teams-table/TeamsBubbleChart.tsx
    - apps/web/src/components/teams-table/TeamsBubbleChart.test.tsx
    - apps/web/src/routes/teams.tsx
    - apps/web/src/routes/teams.test.tsx

key-decisions:
  - "D-01/D-02/D-03/D-04 (the developer's locked decisions) executed exactly as specified in 260909-v5v-PLAN.md — no re-litigation needed."
  - "Tooltip target coordinates in tests are always parsed from the ACTUAL rendered `d` attribute, never recomputed, so a component/hit-index disagreement about a dot's position would fail the test rather than pass it vacuously."

patterns-established:
  - "Coordinate rounding lives in one shared roundCoord() helper, called by both tonePathData and buildHitIndex, so the highlight ring can never drift off the drawn dot."

requirements-completed: [QT-260909-v5v]

coverage:
  - id: D1
    description: "Hovering a bubble-chart point shows a tooltip leading with the team number, then nickname, then Total and Swing Score under the axes' own labels, at the table's two-decimal precision; the algorithm's own confidence field is unreachable (D-01)."
    requirement: "QT-260909-v5v"
    verification:
      - kind: unit
        ref: "apps/web/src/components/teams-table/TeamsBubbleChart.test.tsx#TeamsBubbleChart hover and click"
        status: pass
    human_judgment: false
  - id: D2
    description: "Clicking a point navigates to /team/{n} with the table's exact year/algorithm/tab search shape; clicking empty plot area does nothing (D-02)."
    requirement: "QT-260909-v5v"
    verification:
      - kind: integration
        ref: "apps/web/src/routes/teams.test.tsx#/teams route bubble-chart toggle > clicking a plotted dot navigates..."
        status: pass
      - kind: integration
        ref: "apps/web/src/routes/teams.test.tsx#/teams route bubble-chart toggle > clicking empty plot area..."
        status: pass
    human_judgment: false
  - id: D3
    description: "Overlapping points resolve to one deterministic team, tie-broken on lowest team number, matching a naive full scan across a few hundred pseudo-random points/positions (D-03)."
    requirement: "QT-260909-v5v"
    verification:
      - kind: unit
        ref: "apps/web/src/components/teams-table/teamsBubbleModel.test.ts#buildHitIndex / hitTestNearest"
        status: pass
    human_judgment: false
  - id: D4
    description: "The point cloud is still at most four <path> nodes with hover active; hover/click add at most one highlight circle and one tooltip; the tone-path memo dependency list is still exactly [model, plot]. The svg keeps role=img and its accessible name; a visible hint line names the pointer-only affordance honestly (D-04)."
    requirement: "QT-260909-v5v"
    verification:
      - kind: unit
        ref: "apps/web/src/components/teams-table/TeamsBubbleChart.test.tsx#TeamsBubbleChart hover and click > rendering 400 rows with a hover active..."
        status: pass
    human_judgment: false
  - id: D5
    description: "Local dev-server visual verification of the full ~3,700-team unfiltered cloud (smooth pointer tracking, ring lands exactly on a dot, edge-flip behavior, no confidence value/± ever shown, click navigates)."
    verification: []
    human_judgment: true
    rationale: "Requires a real browser render at production scale (~3,700 points) to judge perceived smoothness and visual placement — not reproducible in jsdom's no-layout test environment. Per plan's <verification>, this is a developer visual check, not an automated gate."

# Metrics
duration: ~15min
completed: 2026-09-09
status: complete
---

# Quick Task 260909-v5v: Hover/Click on the Teams Bubble Chart Summary

**Pointer hit-testing (uniform-grid spatial index) adds hover tooltip + click-to-navigate to the Teams bubble chart without regressing its four-DOM-node point cloud.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-09-09T22:52:18-04:00 (final task commit)
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- `teamsBubbleModel.ts` gained a pure, allocation-free uniform-grid hit test (`buildHitIndex`/`hitTestNearest`) and an edge-aware tooltip placement function (`tooltipAnchorFor`), both exhaustively unit-tested including a naive-full-scan equivalence check over pseudo-random data.
- `TeamsBubbleChart.tsx` now renders a hover tooltip (team number, nickname, Total, Swing Score — reusing `MetricValue` for formatting) and a highlight ring, while keeping the point cloud at exactly the same at-most-four `<path>` nodes; the tone-path memo's `[model, plot]` dependency list is unchanged.
- `TeamsBubbleChart` gained an `onSelectTeam` callback (no router import); `teams.tsx` wires it to `navigate({ to: "/team/$teamNumber", ... })` using `columns.tsx`'s exact link shape, so a team reached from the chart lands in the same URL state as one reached from the table.
- The component's header comment, which previously asserted "No tooltip and no per-point hover," was rewritten to describe the pointer-hit-testing design, its invariants, and its honest navigation limit.

## Task Commits

Each task was committed atomically:

1. **Task 1: teamsBubbleModel.ts — shared coordinate rounding, hit index, hit test, tooltip anchor** - `17c2884e` (feat)
2. **Task 2: TeamsBubbleChart.tsx — hover, highlight ring, tooltip, click callback, corrected header comment** - `09a40242` (feat)
3. **Task 3: teams.tsx — wire onSelectTeam to the router, prove the destination end-to-end** - `192be647` (feat)

**Plan metadata:** committed separately by the orchestrator (not part of this executor's task commits).

## Files Created/Modified
- `apps/web/src/components/teams-table/teamsBubbleModel.ts` - Extracted `roundCoord`; added `hitRadius`/`highlightRadius`/tooltip geometry to `BUBBLE_CHART`; added `SWING_AXIS_LABEL`, `BubbleHitIndex`, `buildHitIndex`, `hitTestNearest`, `tooltipAnchorFor`
- `apps/web/src/components/teams-table/teamsBubbleModel.test.ts` - 13 new tests covering the hit index, hit test (including a seeded-PRNG naive-scan equivalence test), and tooltip anchor flip/clamp behavior
- `apps/web/src/components/teams-table/TeamsBubbleChart.tsx` - Rewrote header comment; added `onSelectTeam` prop, pointer handlers (`onPointerMove`/`onPointerLeave`/`onClick`), cached-rect ref, highlight ring, tooltip card, and pointer-affordance hint line
- `apps/web/src/components/teams-table/TeamsBubbleChart.test.tsx` - 11 new tests covering tooltip content/precision/never-leak, highlight rendering, click-to-select, miss cases, and the 400-row node-count invariant
- `apps/web/src/routes/teams.tsx` - Added `handleSelectTeam`, wired to `<TeamsBubbleChart onSelectTeam={handleSelectTeam} />`
- `apps/web/src/routes/teams.test.tsx` - Registered a stub `/team/$teamNumber` child route (validated by the real `TeamSearchSchema`), added `stubRect`/`dotCoords` test helpers, added click-to-navigate and click-miss tests

## Decisions Made
- Followed the plan's locked D-01 through D-04 decisions exactly as specified; no re-litigation.
- One deviation from the plan's literal example code: the plan's `<navigation_decision>` sample used `useCallback`, but `teams.tsx`'s existing handlers (`handleViewToggle`, `handleChartToggle`, `handleFiltersChange`, `handleClearFilters`, `handleSortChange`) are all plain function declarations with no `useCallback`. Per the plan's own instruction ("match the file, do not introduce a second style"), `handleSelectTeam` was written as a plain function declaration to match the surrounding code.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test helper queried the wrong `<svg>` element**
- **Found during:** Task 3 (writing the click-to-navigate route test)
- **Issue:** `container.querySelector("svg")` in the route-level test picked up the FIRST `<svg>` in the rendered page — a decorative chevron icon inside the country/state filter `<Select>` triggers, not the bubble chart's own `<svg>`. Firing a click on that element opened the Country dropdown instead of hitting the chart, and the navigation assertion failed (`pathname` stayed `/teams`).
- **Fix:** Scoped the query to `screen.getByTestId("teams-bubble-chart").querySelector("svg")` in both new route-level tests.
- **Files modified:** apps/web/src/routes/teams.test.tsx
- **Verification:** Both new tests pass; `npx vitest run apps/web/src/routes/teams.test.tsx` shows 8/8 passing.
- **Committed in:** `192be647` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 test-scoping bug)
**Impact on plan:** No scope creep — a test-only fix necessary for the click-to-navigate test to exercise the correct element. No production code was affected.

## Issues Encountered

- **Test tuning for `hitTestNearest` tie-break test:** the plan's illustrative x-values (40 vs 60 on a 0–100 domain) projected to points ~160px apart at the fallback plot width, well outside `hitRadius` (12px) of their shared midpoint, so the "equal distance either side" test initially returned `null` instead of a tie. Adjusted the fixture's x-values (49 vs 51) so the midpoint sits within `hitRadius` of both points, which is what the behavior actually requires. No production code was affected — this was a test-fixture calibration issue, not a Rule 1 bug in `hitTestNearest` itself.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All three tasks complete; all new/pre-existing automated tests pass (`apps/web` typecheck clean, root typecheck clean, full root `vitest run` shows only pre-existing/concurrent failures in unrelated `packages/gbr`, `packages/corpus`, and `packages/harness` files — none touching `apps/web/src/components/teams-table` or `apps/web/src/routes/teams*`, none introduced by this plan).
- **Outstanding manual step:** the plan's `<verification>` section calls for a developer visual check on a real dev server against the full ~3,700-team unfiltered field (`/teams?year=2026&algorithm=bpr&chart=bubble`) to confirm smooth pointer tracking, exact ring-to-dot alignment, and edge-flip behavior at that scale. This executor ran the full automated suite but did not start a dev server or perform that visual check — flagged for the user/orchestrator per D5 above (`human_judgment: true`).
- No blockers for future work; `onSelectTeam`, `buildHitIndex`/`hitTestNearest`, and `tooltipAnchorFor` are all reusable if a future chart needs the same pointer-hit-testing pattern.

## Test and Typecheck Output (observed)

- `npx vitest run apps/web/src/components/teams-table/teamsBubbleModel.test.ts` → **22 passed (22)**
- `npx vitest run apps/web/src/components/teams-table/TeamsBubbleChart.test.tsx` → **22 passed (22)** (11 pre-existing + 11 new)
- `npx vitest run apps/web/src/routes/teams.test.tsx` → **8 passed (8)** (6 pre-existing + 2 new)
- `npx tsc --noEmit -p apps/web/tsconfig.json` → clean, no errors (identical to the pre-work baseline capture, which was also clean — the plan's documented pre-existing `methodology.compare.test.tsx` error was not present in either baseline or final run)
- `npx tsc --noEmit` (root) → clean, no errors
- `npx vitest run` (full suite, repo root) → **232 files passed / 2 files failed, 4285 tests passed / 6 failed / 4 skipped (4295 total)** on the run used for final verification (counts fluctuated slightly, 6–7 failed tests across 2–3 files, across repeated runs — consistent with concurrent corpus-data mutation by the other active session). All failures are in `packages/gbr/seal.test.ts`, `packages/corpus/integrity.test.ts`, and `packages/harness/digest.test.ts` — none in `apps/web`, none in any file this plan touched.

## Self-Check: PASSED

- FOUND: apps/web/src/components/teams-table/teamsBubbleModel.ts
- FOUND: apps/web/src/components/teams-table/teamsBubbleModel.test.ts
- FOUND: apps/web/src/components/teams-table/TeamsBubbleChart.tsx
- FOUND: apps/web/src/components/teams-table/TeamsBubbleChart.test.tsx
- FOUND: apps/web/src/routes/teams.tsx
- FOUND: apps/web/src/routes/teams.test.tsx
- FOUND commit 17c2884e (Task 1)
- FOUND commit 09a40242 (Task 2)
- FOUND commit 192be647 (Task 3)

---
*Phase: quick-260909-v5v*
*Completed: 2026-09-09*
