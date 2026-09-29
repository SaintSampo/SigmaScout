---
phase: 07-event-pages
plan: 11
subsystem: ui
tags: [react, tanstack-table, tanstack-router, event-pages, insights, tiers]

requires:
  - phase: 07-event-pages (07-01)
    provides: "The /event/$eventKey route, the { artifact, algorithmId, season } tab prop contract, REGISTERED_EVENT_TABS narrowing, the three-independent-scroll-regions pattern"
  - phase: 07-event-pages (07-07)
    provides: "EventTeamSchema.rank/record/rp and ROUNDING_RULE.rankingPoints"
  - phase: 07-event-pages (07-08)
    provides: "buildEventArtifact filling rank/record/rp for every real event"
  - phase: 07-event-pages (07-09)
    provides: "As-of-event metric values paired with season-final percentiles (D-10)"
  - phase: 07-event-pages (07-10)
    provides: "17 real published event artifacts, including 2025cmptx — the real no-ranking event this plan verifies D-08 against"
provides:
  - "apps/web/src/components/event/InsightsTab.tsx — the EVNT-02 Insights table: buildInsightsRows (official/fallback ordering + the orderSource discriminant), formatEventRecord, insightsFallbackNotice, InsightsTab, InsightsTabSkeleton"
  - "apps/web/src/routes/event.$eventKey.tsx — the Insights trigger/panel registered first in the strip, and a shared renderTabState helper both Insights and Breakdown now call"
affects: [07-12-quals-tab, 07-13-elims-tab, 07-14-alliances-tab, 07-15-event-header, 07-18-default-tab-flip]

actuals:
  tokens: 19125
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "One function returns both an ordered-rows array and the discriminant that drives its own accompanying banner/label (buildInsightsRows' { rows, orderSource }), rather than two independently-consulted facts that could drift apart (06.1-08's lesson)"
    - "A route's four-branch page-state decision (invalid-key/404/error/pending/populated) extracted into one shared renderTabState helper the first time a second tab panel needs it, rather than copied per panel"
    - "Radix Tabs' TabsTrigger activates on onMouseDown, not onClick — a test driving tab-switch navigation must fire fireEvent.mouseDown(trigger, { button: 0 }), not .click()/fireEvent.click()"

key-files:
  created:
    - apps/web/src/components/event/InsightsTab.tsx
    - apps/web/src/components/event/InsightsTab.test.tsx
  modified:
    - apps/web/src/routes/event.$eventKey.tsx
    - apps/web/src/routes/event.$eventKey.test.tsx

key-decisions:
  - "RP renders as a plain numeric-cell span, never through MetricValue, structurally (a separate accessor never wired to tierForPercentile) rather than by omitting a prop — matches the plan's Decision 1 verbatim"
  - "In fallback mode the Rank column header names the selected algorithm (via algorithmDisplayLabel); the bare 'Rank' header is used only when the ordinals are TBA's own — matches the plan's Decision 2"
  - "The fallback predicate is 'no team in artifact.teams carries a rank', not 'every team has one' — a withdrawn team inside an otherwise-ranked event does not relabel the whole table (Decision 3)"
  - "The route's four-branch page-state tree is extracted into one renderTabState helper both Insights and Breakdown call, rather than copied a second time (Decision 4)"
  - "The D-08 banner is static page content — no role=alert/status, no dismiss control (Decision 5)"
  - "Test-authoring finding (not a plan deviation): Radix's TabsTrigger activates on onMouseDown, not onClick — the click-navigation test uses fireEvent.mouseDown(trigger, { button: 0 })"

patterns-established:
  - "buildInsightsRows' single-discriminant-and-rows return shape is the template for any future tab whose row order and a companion banner/label must never independently drift"

requirements-completed: [EVNT-02]

coverage:
  - id: D1
    description: "buildInsightsRows returns a deterministic total order and an honest orderSource discriminant for every real corpus shape — fully ranked, unranked, partially ranked, tied, empty, one-team — proven by 19 unit tests"
    requirement: EVNT-02
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/InsightsTab.test.tsx#buildInsightsRows — official vs fallback ordering / record/rp pass-through / formatEventRecord / insightsFallbackNotice"
        status: pass
    human_judgment: false
  - id: D2
    description: "The Insights table renders eight fixed columns (Rank, Team #, Nickname, Record, RP, Auto, Teleop, Endgame) with the three leading columns pinned through PINNED_COLUMN_IDS imported verbatim, tier-boxed Auto/Teleop/Endgame cells via the identical tierForPercentile derivation BreakdownTab.tsx uses, and a plain RP cell that never wears a tier under any input"
    requirement: EVNT-02
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/InsightsTab.test.tsx (30 rendering cases: column set, pinning, Record/RP cells, tier boundaries, partial data, empty/zero-one-many, long-text, tier key row, accessibility, skeleton)"
        status: pass
    human_judgment: false
  - id: D3
    description: "On an event with no official ranking, the table orders by the selected algorithm's Total and a single-line Info-icon banner renders above it stating so, driven by the same orderSource value that decided the ordering — verified against both a hand-written fixture and a REAL published no-ranking event (2025cmptx, 0 of 26 teams ranked), with a ranked control (2024new, 75 of 75 ranked) to prove the fallback is not the default"
    requirement: EVNT-02
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/InsightsTab.test.tsx#InsightsTab — D-08 fallback header and banner"
        status: pass
      - kind: integration
        ref: "live curl against v1/event/2025cmptx/sigma1@2.0.0+tuned-2026-08.json (rankedCount 0/26) and v1/event/2024new/sigma1@2.0.0+tuned-2026-08.json (rankedCount 75/75)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The Insights trigger and panel are registered on the existing route (first in the strip, matching EVENT_TABS order), sharing one page-state branch order with Breakdown; DEFAULT_EVENT_TAB stays breakdown and searchParams.ts is untouched"
    requirement: EVNT-02
    verification:
      - kind: unit
        ref: "apps/web/src/routes/event.$eventKey.test.tsx#/event/$eventKey route — the Insights tab registered (07-11-PLAN.md Task 3) — 8 new cases plus every 07-01 assertion re-verified unmodified"
        status: pass
    human_judgment: false
  - id: D5
    description: "The Insights table's scroll region is a DOM sibling of the tab strip's own scroll region, never ancestor or descendant, in both the isolated component test and the mounted route"
    requirement: EVNT-02
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/InsightsTab.test.tsx#InsightsTab — tier key row, accessibility and scroll region + apps/web/src/routes/event.$eventKey.test.tsx#the tab-strip scroll region and the Insights table's own scroll region are DOM siblings"
        status: pass
    human_judgment: false
  - id: D6
    description: "The 390px real-device touch-interaction test for the Insights table's horizontal scroll under touch is a stated backstop, owned by 07-20 — this plan ships and DOM-asserts only the sibling structure"
    verification: []
    human_judgment: true
    rationale: "Real touch-interaction behavior at phone width cannot be proven by a jsdom unit test; 07-20 owns the phase's single human-verify checkpoint for this backstop, matching every sibling tab plan in this phase (07-01, 07-12, 07-13, 07-14)."

duration: 17min
completed: 2026-08-28
status: complete
---

# Phase 7 Plan 11: Insights Tab Summary

**The EVNT-02 Insights table — TBA official-rank-ordered by default, VPR-fallback-ordered with a stated banner on 259 real no-ranking corpus events, pinned columns via the exact `teams-table` constant, tier-boxed phase metrics, and a bare never-tiered RP cell — verified live against a real published no-ranking artifact (2025cmptx, Einstein Field).**

## Performance

- **Duration:** 17 min
- **Started:** 2026-08-28T06:08:15Z
- **Completed:** 2026-08-28T06:24:59Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- `InsightsTab.tsx` exists: `buildInsightsRows` returns rows and an honest `orderSource` discriminant from ONE call, so the D-08 fallback banner and the row order beneath it can never disagree — official mode orders ascending TBA rank, fallback mode orders descending selected-algorithm Total, both total orders with ascending-team-number tie-breaks and missing-value-sorts-last
- The rendered table has exactly eight fixed columns (Rank, Team #, Nickname, Record, RP, Auto, Teleop, Endgame) with the three leading columns pinned through `PINNED_COLUMN_IDS` imported verbatim from `teams-table/columns.tsx` — `columns.tsx` itself is untouched (`git diff --numstat` empty)
- Auto/Teleop/Endgame are tier-boxed `MetricValue` cells via the identical `tierForPercentile(metric?.percentile)` call `BreakdownTab.tsx` uses, so an Insights tier and a Breakdown tier for the same team/metric/season can never disagree; every repeated adjacent tier box renders independently (D-09, no de-duplication)
- RP is a plain `numeric-cell` span that structurally can never wear a tier class, even when every phase metric on the same row is at percentile 99; Record renders TBA's authoritative `W-L-T` string verbatim, never counted client-side
- On a no-ranking event, the leading header names the selected algorithm ("Sigma1 Rank") and a single-line `Info`-icon banner renders above the table stating the same fact — verified against a real published no-ranking artifact (`2025cmptx`, 0 of 26 teams carrying `rank`) with a ranked control (`2024new`, 75 of 75 ranked)
- The Insights trigger and panel are registered on the existing route, first in the strip per `EVENT_TABS`' declared order; a new `renderTabState` helper extracts the route's four-branch page-state decision so Insights and Breakdown share exactly one branch order rather than each restating it — every pre-existing 07-01 route assertion still passes unmodified
- `DEFAULT_EVENT_TAB` still reads `"breakdown"` and `apps/web/src/lib/searchParams.ts` is untouched (`git diff --numstat` empty) — the default-tab flip is deliberately 07-18's

## Task Commits

Each task was committed atomically (TDD: RED then GREEN, per the plan's `tdd="true"` frontmatter):

1. **Task 1: The Insights row model — official order, D-08 fallback, one discriminant** - `6916ce8a` (test, RED) then `23187c57` (feat, GREEN)
2. **Task 2: The Insights table — pinned columns, tier boxes, plain RP cell, D-08 banner** - `415ee797` (test, RED) then `622b8501` (feat, GREEN)
3. **Task 3: Register the Insights tab behind the route's shared page-state tree** - `3bb849aa` (test, RED) then `a875b28a` (feat, GREEN)

**Plan metadata:** (this commit — docs: complete 07-11 plan)

## Files Created/Modified

- `apps/web/src/components/event/InsightsTab.tsx` - `buildInsightsRows`, `InsightsRow`/`InsightsRowModel`/`InsightsOrderSource`, `formatEventRecord`, `insightsFallbackNotice`, `INSIGHTS_RP_DECIMALS`, `buildInsightsColumns`, `InsightsTab`, `InsightsTabSkeleton`, `INSIGHTS_SKELETON_ROW_COUNT`
- `apps/web/src/components/event/InsightsTab.test.tsx` - 07-VALIDATION.md's Wave 0 EVNT-02 test file, authored before the component (49 cases across row-model and rendering)
- `apps/web/src/routes/event.$eventKey.tsx` - `renderTabState` (extracted shared page-state branch order), `"insights"` appended to `REGISTERED_EVENT_TABS`, the Insights `TabsTrigger`/`TabsContent`
- `apps/web/src/routes/event.$eventKey.test.tsx` - 8 new Insights-registration cases plus a `DEFAULT_EVENT_TAB` assertion, extending 07-01's file

## Decisions Made

- RP renders as a plain `numeric-cell` span, never through `MetricValue`, structurally rather than by omitting a prop (plan Decision 1)
- The fallback-mode Rank header names the selected algorithm via `algorithmDisplayLabel`; the bare "Rank" header is used only for TBA's own ordinals (plan Decision 2)
- The fallback predicate is "no team in `artifact.teams` carries a `rank`", not "every team has one" (plan Decision 3)
- The route's page-state decision tree is extracted into one shared `renderTabState` helper rather than copied into the Insights panel (plan Decision 4)
- The D-08 banner is static page content — no live-region role, no dismiss control (plan Decision 5)
- Test-authoring finding: Radix's `TabsTrigger` activates on `onMouseDown` (checked via `event.button === 0`), not `onClick` — the click-navigation route test drives `fireEvent.mouseDown(trigger, { button: 0 })` rather than `.click()`/`fireEvent.click()`, which had no effect on Radix's internal `onValueChange`

## Deviations from Plan

None — plan executed exactly as written. No Rule 1-4 auto-fixes were needed; every acceptance criterion across the three tasks passed on the implementation as designed. The one test-authoring correction (Radix's `onMouseDown` activation, above) is a test-mechanics detail discovered while writing a genuinely new assertion this phase had not exercised before, not a deviation from the plan's design.

## Issues Encountered

- The empty-teams-array test initially matched multiple elements on a `/2024casf/` regex (`EmptyState`'s heading and body both mention the event key) — fixed by asserting the exact heading string instead of a regex, a test-authoring detail with no production-code impact.
- The click-navigation route test's first attempt (`insightsTrigger.click()`, then `fireEvent.click(...)`) silently had no effect: Radix's `TabsTrigger` wires activation to `onMouseDown`, not `onClick`. Confirmed by reading `@radix-ui/react-tabs`'s own source (`node_modules/.pnpm/@radix-ui+react-tabs@1.1.21.../dist/index.mjs`) rather than guessing; fixed by firing `mouseDown` with `button: 0` to match the exact branch the trigger's own handler checks.

## User Setup Required

None - no external service configuration required.

## Verification Confirmations

- `pnpm vitest run apps/web/src/components/event/InsightsTab.test.tsx` — 49 tests pass.
- `pnpm vitest run "apps/web/src/routes/event.\$eventKey.test.tsx"` — 18 tests pass, including every 07-01 assertion unmodified.
- `pnpm --filter web test` — 437 tests pass across the whole web suite, zero new failures.
- `pnpm --filter web typecheck` — clean.
- `pnpm test` (whole-repo) — 1706 passed, 1 skipped, 1 pre-existing accepted failure (`payloadBudget.test.ts`'s `teams/{year}` ceiling, WINDOWS.md ledger #11) — unrelated to this plan, zero new failures introduced.
- `git diff --numstat apps/web/src/lib/searchParams.ts` and `git diff --numstat apps/web/src/components/teams-table/columns.tsx` — both empty.
- Live check (Task 3's final acceptance criterion): `v1/event/2025cmptx/sigma1@2.0.0+tuned-2026-08.json` returns 200 with 0 of 26 teams carrying `rank` (Championship Finals — Einstein is playoff-only, so no qualification ranking exists, matching D-08's measured count and this plan's own named expected candidate from `07-10-SUMMARY.md`); `v1/event/2024new/sigma1@2.0.0+tuned-2026-08.json` returns 200 with 75 of 75 teams carrying `rank` as the ranked control.

## Next Phase Readiness

- The Insights tab is complete to its full EVNT-02/D-07…D-10 contract. `renderTabState` is now available for 07-12 (Quals), 07-13 (Elims) and 07-14 (Alliances) to call rather than each restating the route's page-state branch order a third, fourth and fifth time.
- `DEFAULT_EVENT_TAB` stays `"breakdown"`; 07-18 owns the one-constant flip to `"insights"` once all five tabs exist.
- No blockers. The 390px real-device touch-interaction backstop for the Insights table (UI-SPEC E3 `overflow`) is 07-20's, matching every sibling tab plan in this phase.

---
*Phase: 07-event-pages*
*Completed: 2026-08-28*

## Self-Check: PASSED

- FOUND: `apps/web/src/components/event/InsightsTab.tsx`
- FOUND: `apps/web/src/components/event/InsightsTab.test.tsx`
- FOUND: `apps/web/src/routes/event.$eventKey.tsx` (modified)
- FOUND: `apps/web/src/routes/event.$eventKey.test.tsx` (modified)
- FOUND: commit `6916ce8a` (Task 1 RED)
- FOUND: commit `23187c57` (Task 1 GREEN)
- FOUND: commit `415ee797` (Task 2 RED)
- FOUND: commit `622b8501` (Task 2 GREEN)
- FOUND: commit `3bb849aa` (Task 3 RED)
- FOUND: commit `a875b28a` (Task 3 GREEN)
