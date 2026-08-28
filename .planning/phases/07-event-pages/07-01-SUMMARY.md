---
phase: 07-event-pages
plan: 01
subsystem: ui
tags: [react, tanstack-router, tanstack-table, tanstack-query, zod, event-pages]

requires:
  - phase: 06-team-pages
    provides: "The team.$teamNumber.tsx route shape, lib/api/team.ts's fetch+Zod+query-options pattern, teams-table/columns.tsx's pinned-column TanStack Table v9 construction, MetricValue/TierKeyRow/tiers.ts/metricKeys.ts, StateViews.tsx/Skeletons.tsx"
provides:
  - "apps/web/src/lib/eventKey.ts — the event-key convention (isValidEventKey, seasonFromEventKey), the event analog of teamKey.ts"
  - "apps/web/src/lib/api/event.ts — fetchEventArtifact + eventQueryOptions, deriving season from the event key rather than ?year="
  - "apps/web/src/lib/searchParams.ts — EVENT_TABS (five fixed ids), DEFAULT_EVENT_TAB, EventSearchSchema's ?tab= contract"
  - "apps/web/src/routes/event.$eventKey.tsx — the /event/$eventKey route: one artifact fetch, a scrollable tab strip that is a DOM sibling of the Breakdown table's own scroll region, and the page's four non-populated states"
  - "apps/web/src/components/event/BreakdownTab.tsx — the Breakdown tab complete to its EVNT-03/D-11 contract: pinned columns, metricKeysFor-driven column set, tier-boxed cells, no rank column"
  - "apps/web/src/components/ribbon/AlgorithmSelect.tsx — new algorithmDisplayLabel(algorithmId) export, purely additive"
affects: [07-11-insights-tab, 07-12-quals-tab, 07-13-elims-tab, 07-14-alliances-tab, 07-15-event-header, 07-16-tab-rename, 07-18-default-tab-flip]

actuals:
  tokens: 16400
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Event-page fetch/schema/route shape mirrors the team-page trio (teamKey.ts/api/team.ts/team.$teamNumber.tsx) exactly, one level shallower (no year param) — eventKey.ts/api/event.ts/event.$eventKey.tsx"
    - "A tab strip is its own overflow-x-auto scroll region as a DOM SIBLING of a tab's own content scroll region, never ancestor/descendant of it — the three-independent-scroll-regions pattern for a page with a scrollable tab strip AND a wide table"
    - "A route-local REGISTERED_* array narrows a URL search schema's full enum to the subset actually wired with a trigger+panel this wave, since z.enum's .catch() can't help when every id is a valid enum member"

key-files:
  created:
    - apps/web/src/lib/eventKey.ts
    - apps/web/src/lib/eventKey.test.ts
    - apps/web/src/lib/api/event.ts
    - apps/web/src/lib/api/event.test.ts
    - apps/web/src/components/event/BreakdownTab.tsx
    - apps/web/src/components/event/BreakdownTab.test.tsx
    - apps/web/src/routes/event.$eventKey.tsx
    - apps/web/src/routes/event.$eventKey.test.tsx
    - apps/web/e2e/event-page.spec.ts
  modified:
    - apps/web/src/lib/searchParams.ts
    - apps/web/src/lib/searchParams.test.ts
    - apps/web/src/components/ribbon/AlgorithmSelect.tsx
    - apps/web/playwright.config.ts

key-decisions:
  - "The event page's season comes from the event key + the artifact's own required season field, never ?year= — matches the plan's Decision 1 verbatim"
  - "EventSearchSchema's tab enum stays over all five EVENT_TABS ids for URL-contract stability; the route's own REGISTERED_EVENT_TABS array is the narrower per-wave subset (matches the plan's Decision 2)"
  - "Breakdown reuses columnPinningFeature+columnSizingFeature locally (not imported across the teams-table module boundary) since the column helper must be typed against BreakdownRow"
  - "BREAKDOWN_MODEL_ESTIMATES_CAPTION is a function, not a static string constant, because its text depends on the runtime algorithmId — the plan's artifact name is kept verbatim despite the SCREAMING_SNAKE_CASE convention normally reserved for constants"
  - "Tier-boundary tests for out-of-range percentiles (101, -1) bypass EventArtifactSchema.parse via a hand-written makeUnvalidatedArtifact helper, since TeamMetricSchema.percentile's own z.number().min(0).max(100) constraint correctly rejects those values at the publish boundary — tierForPercentile's own out-of-range guard is defense-in-depth for a hypothetical pipeline defect and needed a way to be exercised"

patterns-established:
  - "Pattern: event-page fetch/schema trio mirrors the team-page trio one level shallower (no year param) — future event-scoped fetchers (alliances, rankings once published) should follow the same fetchXArtifact + xQueryOptions shape"
  - "Pattern: three-independent-scroll-regions for a tab-strip page — apply again in 07-12/07-13 when Quals/Elims add their own wide match tables alongside this same tab strip"

requirements-completed: [EVNT-03]

coverage:
  - id: D1
    description: "/event/{eventKey} fetches a real published event artifact, parses it through EventArtifactSchema, and renders real data from it"
    requirement: EVNT-03
    verification:
      - kind: integration
        ref: "live curl assertion against v1/event/2024casf/sigma1@2.0.0+tuned-2026-08.json (43 teams, season 2024) — printed 'ok'"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/event-page.spec.ts — Event page tracer"
        status: unknown
    human_judgment: true
    rationale: "The e2e spec targets the deployed origin (R2 CORS does not allow-list localhost); it cannot pass until this branch is merged and deployed. Needs a post-merge re-run, same documented situation as 06-01-SUMMARY.md."
  - id: D2
    description: "?tab= is a typed, back/forward-navigable URL param over the five fixed event-tab ids, defaulting to breakdown, with an unregistered id resolving to the default rather than an empty panel"
    requirement: EVNT-03
    verification:
      - kind: unit
        ref: "apps/web/src/lib/searchParams.test.ts#EventSearchSchema"
        status: pass
      - kind: integration
        ref: "apps/web/src/routes/event.$eventKey.test.tsx#?tab=quals (unregistered) resolves to the Breakdown panel, same as ?tab=breakdown"
        status: pass
    human_judgment: false
  - id: D3
    description: "The Breakdown tab satisfies its full EVNT-03/D-11 contract: pinned teamNumber/nickname columns, one column per metricKeysFor(algorithmId, season) key including Total, tier-boxed MetricValue cells, TierKeyRow + model-estimates caption, no rank column"
    requirement: EVNT-03
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/BreakdownTab.test.tsx (25 cases: column set/order, row order/tie-break, partial data, all nine tier boundary cuts, tier key row + caption, empty/zero-one-many, long-text, pinning)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The tab strip and the Breakdown table are two independent, sibling overflow-x-auto regions that never nest"
    requirement: EVNT-03
    verification:
      - kind: integration
        ref: "apps/web/src/routes/event.$eventKey.test.tsx#the tab-strip scroll region and the Breakdown table's own scroll region are DOM siblings, never nested in either direction"
        status: pass
    human_judgment: true
    rationale: "07-UI-SPEC.md's E2 overflow row is a backstop needing a real touch-interaction test at phone width — the DOM-structure test here proves the sibling relationship but not the touch-scroll behavior itself, which 07-20 owns per the plan's own probe-coverage ledger."
  - id: D5
    description: "All four non-populated page states (loading skeleton, non-404 error with Retry, 404 empty state without Retry, empty roster) render with their specified copy"
    requirement: EVNT-03
    verification:
      - kind: unit
        ref: "apps/web/src/routes/event.$eventKey.test.tsx (404/500/pending cases) + BreakdownTab.test.tsx (empty roster case)"
        status: pass
    human_judgment: false

duration: 22min
completed: 2026-08-28
status: complete
---

# Phase 7 Plan 1: Event Page Tracer + Breakdown Tab Summary

**End-to-end `/event/{eventKey}` tracer proving a real published R2 artifact flows through `EventArtifactSchema.parse` into a rendered page, plus the Breakdown tab (EVNT-03) built complete to its full UI-SPEC contract — pinned columns, tier-boxed metrics, no rank column, a sibling scroll-region tab strip.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-08-28T01:01:47Z
- **Completed:** 2026-08-28T01:23:29Z
- **Tasks:** 3
- **Files modified:** 13

## Accomplishments
- `/event/{eventKey}` route exists, validates the event-key route param before firing any fetch, and renders a real event's data fetched from `https://data.sigmascout.org` and parsed through `EventArtifactSchema`
- The Breakdown tab (EVNT-03) is complete to its full 07-UI-SPEC.md contract: pinned `Team #`/`Nickname` columns, one column per `metricKeysFor(algorithmId, season)` key in that function's own order (including `Total`), tier-boxed `MetricValue` cells via `tierForPercentile`, a `TierKeyRow`, and the D-11 model-estimates caption — with no rank column anywhere
- A five-id `?tab=` URL contract (`EVENT_TABS`) is in place with a route-local `REGISTERED_EVENT_TABS` narrowing mechanism so an unbuilt tab id resolves safely to the default rather than an empty panel
- The tab strip is its own `overflow-x-auto` scroll region, verified a DOM sibling (never ancestor/descendant) of the Breakdown table's own scroll region
- All four non-populated page states render with their specified copy: loading skeleton (shaped like the real table), a non-404 error with Retry, a 404 empty state with no Retry, and an empty-roster empty state

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end "/event/2024casf shows a real event"** - `702d085c` (feat)
2. **Task 2: The Breakdown tab, complete to its UI-SPEC contract** - `1ef726c0` (test, RED) then `2bfb4213` (feat, GREEN)
3. **Task 3: The tab strip as its own scroll region, and the page's four states** - `d2c9b76a` (feat)

**Plan metadata:** (this commit — docs: complete 07-01 plan)

_TDD task (Task 2) has two commits: test → feat, per the plan's `tdd="true"` frontmatter._

## Files Created/Modified
- `apps/web/src/lib/eventKey.ts` - `EVENT_KEY_PATTERN`/`isValidEventKey`/`seasonFromEventKey`/`InvalidEventKeyError`, the event-key convention's single home
- `apps/web/src/lib/api/event.ts` - `fetchEventArtifact`/`eventQueryOptions`, mirroring `lib/api/team.ts`'s fetch+Zod+query-options shape
- `apps/web/src/lib/searchParams.ts` - `EVENT_TABS`, `DEFAULT_EVENT_TAB`, `EventSearchSchema`
- `apps/web/src/components/event/BreakdownTab.tsx` - `BreakdownTab`, `BreakdownTabSkeleton`, `buildBreakdownRows`, `BREAKDOWN_PINNED_COLUMN_IDS`, `BREAKDOWN_MODEL_ESTIMATES_CAPTION`
- `apps/web/src/components/ribbon/AlgorithmSelect.tsx` - added `algorithmDisplayLabel(algorithmId)`, purely additive
- `apps/web/src/routes/event.$eventKey.tsx` - the `/event/$eventKey` route: `validateSearch`, the artifact query, the tab strip, and the page-state decision tree
- `apps/web/e2e/event-page.spec.ts` + `apps/web/playwright.config.ts` - the deployed-origin tracer proof, widened `desktop` project `testMatch`
- Corresponding `*.test.ts`/`*.test.tsx` files for every module above

## Decisions Made
- Season is sourced from the event key + the artifact's own `season` field, never `?year=` (plan Decision 1)
- `EventSearchSchema`'s `tab` enum stays over all five `EVENT_TABS` ids for URL-contract stability across the whole phase; the route's own `REGISTERED_EVENT_TABS` array is the per-wave narrowing (plan Decision 2)
- Breakdown's `columnPinningFeature`/`columnSizingFeature` registration is local to `BreakdownTab.tsx`, not imported from `teams-table/columns.tsx` — the column helper must be typed against `BreakdownRow`
- `BREAKDOWN_MODEL_ESTIMATES_CAPTION` is exported as a function (its text depends on the runtime `algorithmId` via `algorithmDisplayLabel`), keeping the plan's literal export name despite the constant-style casing
- Out-of-range percentile (101, -1) tier-boundary tests bypass `EventArtifactSchema.parse` via a dedicated `makeUnvalidatedArtifact` test helper, since the real schema correctly rejects those values — `tierForPercentile`'s own guard is defense-in-depth that still needed a way to be exercised in a test

## Deviations from Plan

None — plan executed exactly as written. No Rule 1-4 auto-fixes were needed; every acceptance criterion in the plan's three tasks passed on the implementation as designed.

## Issues Encountered
- The first draft of `BreakdownTab.test.tsx` queried the DOM synchronously right after `render()`, which failed for every test past the first few because TanStack Router resolves its first route match asynchronously (the same reason `TeamsTable.test.tsx`/`team.$teamNumber.test.tsx` wrap their initial assertion in `await waitFor(...)`). Fixed by awaiting the first stable element before querying further, matching the established project convention — not a plan deviation, a test-authoring detail.
- The tier-boundary class assertion initially queried the outer `TableCell`'s `className`, which never carries the `.metric-tier--*` class — that class lands on `MetricValue`'s own inner `<span>`. Fixed by querying the `.numeric-cell` child inside the cell.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The event-page route, artifact fetcher, and `?tab=` contract are in place for 07-11 (Insights), 07-12 (Quals), 07-13 (Elims), and 07-14 (Alliances) to each append their own tab id to `REGISTERED_EVENT_TABS` and register a trigger/panel in the same edit, per this plan's own documented convention
- `BreakdownTab`'s `{ artifact, algorithmId, season }` prop contract is frozen (07-01-PLAN.md's own instruction) — the four sibling tab plans build against the identical shape
- The e2e spec (`event-page.spec.ts`) needs a re-run once this branch is merged and deployed — it cannot pass from an unmerged branch (R2 CORS does not allow-list `localhost`), same documented situation as 06-01-SUMMARY.md
- 07-01's own flagged assumptions carry forward unresolved by this plan (expected — they are explicitly out of scope here): the Breakdown tier boxes render unboxed until 07-10 publishes percentiles on the event artifact; the Phase 5 D-12 year-change extension point for an event detail page is unassigned (recommended owner: 07-15); the tab-strip/table mobile touch-interaction backstop tests are owned by 07-20

---
*Phase: 07-event-pages*
*Completed: 2026-08-28*

## Self-Check: PASSED

All created files confirmed present on disk; all task commits (`702d085c`, `1ef726c0`, `2bfb4213`, `d2c9b76a`) and the summary commit (`eb0ae896`) confirmed present in `git log`.
