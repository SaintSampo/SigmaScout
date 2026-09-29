---
phase: 07-event-pages
plan: 12
subsystem: ui
tags: [react, tanstack-router, event-pages, quals, match-plot, uncertainty]

requires:
  - phase: 07-event-pages (07-01)
    provides: "The /event/$eventKey route, the { artifact, algorithmId, season } tab prop contract, REGISTERED_EVENT_TABS narrowing, the three-independent-scroll-regions pattern"
  - phase: 07-event-pages (07-07)
    provides: "EventMatchSchema/EventUpcomingMatchSchema's sortTime (07-07's amendment credited to this plan's own flagged finding) and redScoreVarianceOwn/blueScoreVarianceOwn"
  - phase: 07-event-pages (07-08)
    provides: "buildEventArtifact populating sortTime from the same sortTimeByMatchKey map the team artifact uses, and both variance fields"
  - phase: 07-event-pages (07-10)
    provides: "Real published event artifacts (2023nhgrs, 2025flta, 2025srsd, 2024cmptx et al.) this plan's live-data proofs and measured-ground-truth table are built against"
  - phase: 07-event-pages (07-11)
    provides: "The Insights tab's renderTabState registration pattern this plan's renderQualsContent mirrors"
  - phase: 07-event-pages (07-13, planned-after)
    provides: "The corpus-wide ordering measurement (312/1,342 events, 2,274/19,651 rows) that routed the leading sortTime comparison back to this plan's compareEventMatchRows"
provides:
  - "apps/web/src/components/event/eventMatchAxis.ts — the event-scoped match machinery 07-13 (Elims) and 07-14 (Alliances) both consume: EventMatchRow, EVENT_COMP_LEVEL_RANK, isQualCompLevel/isElimCompLevel, compareEventMatchRows (total order, sortTime-presence-leads then bracket-chain tie-break), mergeEventMatches (D-13's client-side interleave), computeEventAxisDomain (D-12's per-tab domain)"
  - "apps/web/src/components/event/EventMatchTable.tsx — the generalized event-scoped match-plot table (team-page MatchTable anatomy, this-team highlight dropped by being structurally unrepresentable), consumed unchanged by 07-13"
  - "apps/web/src/components/event/QualsTab.tsx — the EVNT-04 tab: qm filter, D-13 merge, D-12 domain, sibling scroll region, empty state, skeleton"
  - "apps/web/src/components/team/matchAxis.ts — PLOT_W promoted to an export, padAxisDomain extracted and shared by both axis-domain functions"
  - "apps/web/src/components/team/MatchTable.tsx — formatScheduledTime promoted to an export, reused verbatim by the event table"
  - "apps/web/src/routes/event.$eventKey.tsx — 'quals' registered in REGISTERED_EVENT_TABS, trigger + TabsContent + QualsTabSkeleton pending branch"
affects: [07-13-elims-tab, 07-14-alliances-tab, 07-15-event-header, 07-18-default-tab-flip, 07-20-real-device-overflow-pass]

actuals:
  tokens: 22508
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "An event-scoped sibling module (eventMatchAxis.ts) reuses a team-scoped pure module's (matchAxis.ts) geometry/domain-padding primitives via export promotion + extraction, rather than a second copy of either — the padding/floor policy and the plot width now have exactly one home each, consumed by both"
    - "A total-order comparator layered as timestamp-PRESENCE first, then timestamp-VALUE, then a bracket-chain tie-break — comparing values only when both rows happen to carry one (without the leading presence split) is non-transitive across a mixed timed/untimed set, and V8 silently returns an arrangement-dependent order rather than throwing"
    - "A component drops a privileging rule (the this-team bold-highlight) by making it structurally unrepresentable — no team-key prop exists on EventMatchTableProps at all — rather than by omitting to apply an available prop, enforced by a compile-time Exclude<keyof Props, ...> === never assertion proven to actually bite"
    - "Every bonus-RP dot on a page forced into one state (unknown) by never passing states/probabilities and documenting why in one sentence at the call site, rather than a conditional that could accidentally derive a state from a field the schema doesn't publish"

key-files:
  created:
    - apps/web/src/components/event/eventMatchAxis.ts
    - apps/web/src/components/event/eventMatchAxis.test.ts
    - apps/web/src/components/event/EventMatchTable.tsx
    - apps/web/src/components/event/EventMatchTable.test.tsx
    - apps/web/src/components/event/QualsTab.tsx
    - apps/web/src/components/event/QualsTab.test.tsx
  modified:
    - apps/web/src/components/team/matchAxis.ts
    - apps/web/src/components/team/MatchTable.tsx
    - apps/web/src/routes/event.$eventKey.tsx
    - apps/web/src/routes/event.$eventKey.test.tsx

key-decisions:
  - "The merge produces a normalized EventMatchRow, not a union of EventMatch/EventUpcomingMatch — played is set from WHICH ARRAY the row came from, never inferred from actual-score presence (plan Decision 1)"
  - "isQualCompLevel/isElimCompLevel are a predicate-parameter pair with the elim set stated explicitly (ef/qf/sf/f), not as the negation of isQualCompLevel, so a future comp-level addition to the enum does not silently become an elimination match (Decision 2)"
  - "PLOT_W promoted into matchAxis.ts rather than duplicated or imported from a component, keeping matchAxis.ts as the one home for plot geometry (Decision 3)"
  - "padAxisDomain extracted as a shared helper rather than reimplemented for the event domain — what differs between the two axis functions is only how extents are gathered, never the pad/floor policy (Decision 4)"
  - "An unplayed row's Actual column renders the real scheduled time via the promoted formatScheduledTime — the UI-SPEC deviation this plan originally surfaced (sortTime absent from event schemas) is now closed by 07-07/07-08's parallel amendment (Decision 5)"
  - "QualsTabProps declares the full frozen { artifact, algorithmId, season } contract even though only two fields are read, keeping all four expansion tabs' TabsContent call sites structurally identical (Decision 6)"
  - "The comparator's leading sortTime comparison (routed back from 07-13's corpus measurement) branches on timestamp PRESENCE, not value-when-both-present, because the values-only form is non-transitive across a mixed timed/untimed set; the bracket chain is retained beneath it rather than replaced, because 114 corpus groups share an identical sort_time"
  - "computeEventAxisDomain's min/max accumulator uses undefined-tracking rather than Number.POSITIVE_INFINITY/NEGATIVE_INFINITY sentinels — avoids a literal collision with this file's own no-fabricated-timestamp grep gate, which exists to catch an infinity sentinel used as a sortTime substitute, not a legitimate score-extent accumulator"

requirements-completed: [EVNT-04]

coverage:
  - id: D1
    description: "eventMatchAxis.ts: the D-13 merge, the D-12 per-tab domain, and the sortTime-leads/bracket-chain-tie-break total-order comparator (closes 07-13's routed series-major finding)"
    requirement: "EVNT-04"
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/eventMatchAxis.test.ts (31 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "EventMatchTable.tsx: the full six-column match-plot anatomy (bands/ticks/dots, confidence chip, predicted score with plus-minus, greyed losing number, call glyph, unknown-only bonus-RP dots), with the this-team highlight rule made structurally unrepresentable"
    requirement: "EVNT-04"
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/EventMatchTable.test.tsx (25 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "QualsTab.tsx wired into /event/$eventKey?tab=quals: qm filter, empty state for a genuinely quals-less event (Einstein), full table for a played-empty/upcoming-populated event (2025srsd's shape), sibling scroll region, skeleton"
    requirement: "EVNT-04"
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/QualsTab.test.tsx (11 tests)"
        status: pass
      - kind: integration
        ref: "apps/web/src/routes/event.$eventKey.test.tsx (22 tests, includes the new Quals-registered describe block)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The Quals tab's visual rendering against a real high-density qualification slate (72-84 rows) at ~390px, with touch-scroll behaviour and mark-grouping legibility at that density — both flagged as backstop truths this plan cannot verify from a fixture"
    verification: []
    human_judgment: true
    rationale: "07-UI-SPEC.md E5 names the ~390px overflow case as the tab's highest-risk item, and the plan's own flagged assumption 3 notes the shipped band-spacing trade was argued for a ~40-row team season, not a 72-84-row event slate — both are explicitly routed to 07-20's real-device pass, not resolvable from a jsdom fixture"

duration: ~55min
completed: 2026-08-28
status: complete
---

# Phase 7 Plan 12: Quals Tab Summary

**The Quals tab renders `/event/{eventKey}?tab=quals` as one client-merged, chronologically-ordered list of qualification matches on a fresh per-tab axis, plus the shared `eventMatchAxis.ts`/`EventMatchTable.tsx` machinery 07-13 (Elims) and 07-14 (Alliances) build on.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3 of 3 completed
- **Files modified:** 10 (6 created, 4 modified)

## Accomplishments

- `eventMatchAxis.ts`: pure, no-React module exporting `EventMatchRow`, `EVENT_COMP_LEVEL_RANK`, `isQualCompLevel`/`isElimCompLevel`, `compareEventMatchRows` (a total order: published `sortTime` presence leads, then value, then the bracket chain — closing the series-major finding 07-13 measured against a 2022-style best-of-three bracket), `mergeEventMatches` (D-13's browser-side interleave of `matches[]`/`upcoming[]`, wire arrays left untouched), and `computeEventAxisDomain` (D-12's per-tab domain, played AND scheduled rows).
- `EventMatchTable.tsx`: the generalized six-column match-plot table (Match / plot / Conf. / Pred. Score / Actual / Call) — every band/tick/dot position imported from `matchAxis.ts`, never restated; the this-team bold-highlight rule dropped by making a team-key prop structurally impossible to pass (compile-time `Exclude<keyof Props, ...> === never` assertion, proven to actually fail typecheck when a leaked key is added); every bonus-RP dot forced `unknown` because neither event match schema publishes a per-bonus array.
- `QualsTab.tsx`: filters to `compLevel === "qm"`, merges played+upcoming, computes the per-tab domain, renders the sibling `overflow-x-auto` scroll region, the canonical `EmptyState` for a genuinely quals-less event (verified live against Championship Finals artifacts), and the skeleton.
- `matchAxis.ts`/`MatchTable.tsx`: `PLOT_W` promoted to an export, the padding/floor policy extracted into `padAxisDomain` and shared by both axis functions, `formatScheduledTime` promoted to an export — all three changes proven behaviour-preserving (both files' own pre-existing test suites stayed byte-identical and green throughout).
- `event.$eventKey.tsx`: `"quals"` registered in `REGISTERED_EVENT_TABS`, trigger placed after Breakdown, `TabsContent` wired to `QualsTab`/`QualsTabSkeleton`.

## Task Commits

Each task was committed atomically:

1. **Task 1: TRACER — event-scoped match machinery + Quals tab wired end-to-end** - `cfdb83bf` (feat)
2. **Task 2: The event match table complete to its contract** - `bba88008` (feat)
3. **Task 3: The Quals tab wired into the page** - `b35296dd` (feat)

**Plan metadata:** committed alongside this SUMMARY (see final commit below).

_Note: each task's own test file was written and observed RED before the corresponding implementation, then brought to GREEN within the same task commit — this matches the pattern already established by sibling 07-xx plans in this phase (e.g. 07-11), which commit RED+GREEN together per task rather than as separate commits, since the plan's own frontmatter is `type: execute` (not a plan-level `type: tdd` gate)._

## Files Created/Modified

- `apps/web/src/components/event/eventMatchAxis.ts` - the shared event-scoped match machinery (row type, predicates, comparator, merge, domain)
- `apps/web/src/components/event/eventMatchAxis.test.ts` - 07-VALIDATION.md's Wave 0 EVNT-04 test file (31 tests: geometry single-sourcing, comp-level predicates, ordering, adjacency, empty/single, domain content)
- `apps/web/src/components/event/EventMatchTable.tsx` - the generalized event-scoped match-plot table
- `apps/web/src/components/event/EventMatchTable.test.tsx` - 25 tests covering structure, played/unplayed rows, absent variance, bonus-RP dots, skeleton, row-count conservation
- `apps/web/src/components/event/QualsTab.tsx` - the EVNT-04 tab component
- `apps/web/src/components/event/QualsTab.test.tsx` - 11 tests covering filtering/merging, per-tab domain, empty state, scroll-region siblinghood
- `apps/web/src/components/team/matchAxis.ts` - `PLOT_W` export + `padAxisDomain` extraction (behaviour-preserving)
- `apps/web/src/components/team/MatchTable.tsx` - takes `PLOT_W` from the import, `formatScheduledTime` promoted to export (behaviour-preserving)
- `apps/web/src/routes/event.$eventKey.tsx` - Quals tab registered
- `apps/web/src/routes/event.$eventKey.test.tsx` - Quals-registered describe block added; two pre-existing 07-01/07-11 assertions corrected (see Deviations)

## Decisions Made

See `key-decisions` in the frontmatter above for the full list (mirrors the plan's own Decisions 1-6 verbatim, plus two execution-time findings: the comparator's presence-first branching rationale, and the `computeEventAxisDomain` infinity-sentinel-avoidance fix).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `computeEventAxisDomain`'s min/max accumulator triggered its own module's no-fabricated-timestamp grep gate**
- **Found during:** Task 1, running the acceptance-criteria grep gates after the first GREEN pass
- **Issue:** The score-domain accumulator initialized `min`/`max` with `Number.POSITIVE_INFINITY`/`NEGATIVE_INFINITY` (mirroring `matchAxis.ts`'s `computeAxisDomain` exactly). The plan's own acceptance criterion greps the whole file for `POSITIVE_INFINITY` to catch an infinity-sentinel substitute for a missing `sortTime` — a legitimate, unrelated use of the same literal in a different function tripped the same pattern.
- **Fix:** Reworked the accumulator to track `min`/`max` as `number | undefined` instead, treating "no observation yet" as absence rather than an infinity sentinel — semantically identical, passes the grep gate, and the behavior (verified by the pre-existing empty/zero-rows test cases) is unchanged.
- **Files modified:** `apps/web/src/components/event/eventMatchAxis.ts`
- **Verification:** `eventMatchAxis.test.ts` stayed 31/31 green through the change; the specific grep gate (`grep -v ... | grep -cE 'sortTime[^)]*\?\?|POSITIVE_INFINITY|Date\.now'`) now reads 0.
- **Committed in:** `cfdb83bf` (Task 1 commit)

**2. [Rule 1 - Bug] Two pre-existing route tests invalidated by registering the third tab**
- **Found during:** Task 1's route registration, discovered when running the full `event.$eventKey.test.tsx` suite
- **Issue:** 07-01's "`?tab=quals` (unregistered) resolves to Breakdown" test and 07-11's "exactly two tabs exist" test both asserted behavior that is definitionally false once this plan registers `"quals"` — this is the same foreseeable consequence every prior wave in this file would have hit when the next tab landed.
- **Fix:** Moved the "unregistered tab" probe to `"elims"` (still unregistered as of this plan) preserving the original test's intent; updated the tab-count assertion from two to three tabs in the correct order (Insights, Breakdown, Quals).
- **Files modified:** `apps/web/src/routes/event.$eventKey.test.tsx`
- **Verification:** Full route test file green (22/22) after the correction; `pnpm --filter web test` green across the whole web suite (43/43 files, 508/508 tests).
- **Committed in:** `b35296dd` (Task 3 commit, alongside the new Quals-registered test cases)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bug fixes — a grep-gate collision and two test corrections foreseeably invalidated by the plan's own intended tab registration)
**Impact on plan:** Both fixes were required for correctness of the plan's own stated verification gates; neither changed shipped behavior beyond what the plan specified. No scope creep.

## Issues Encountered

None beyond the two deviations documented above.

## Baseline / Verification

- **Pre-plan baseline** (recorded before Task 1, per the plan's `<baseline>` block): `pnpm test` showed exactly 1 failing assertion (`packages/harness/payloadBudget.test.ts`'s `teams/{year}` internal-consistency check, the accepted signed override tracked at `.planning/WINDOWS.md` ledger #11). `matchAxis.test.ts` (12 tests) and `MatchTable.test.tsx` (22 tests) were both green.
- **Post-plan verification:** `pnpm --filter web typecheck` clean; `pnpm --filter web test` green (43/43 files, 508/508 tests); `pnpm test` from the repo root shows exactly the same one accepted `payloadBudget.test.ts` baseline failure and no other; `matchAxis.test.ts`/`MatchTable.test.tsx` stayed byte-identical (`git diff --numstat` empty against the pre-plan commit) and green throughout all three tasks; `pnpm --filter web build` succeeds and `routeTree.gen.ts` still registers `/event/$eventKey`; both plan-specified live-artifact `curl` proofs (2023nhgrs 52 played/26 upcoming qm rows with no `matchNumber` overlap; 2024cmptx zero `qm` rows) printed `ok`.
- **RED evidence quoted per task:** Task 1's stub-module RED run failed 22/31 cases behaviorally (e.g. "orders qm before ef before qf before sf before f" returned `['f','sf','qf','ef','qm']`; the shared-matchKey adjacency case returned an empty array against a `toHaveLength(1)` expectation) — never a module-not-found error. Task 2's RED run against the tracer-scope table failed 10/25 cases (empty Conf./Pred. Score cells, missing skeleton export). Task 3's RED run against the tracer-scope tab failed 2/11 cases (the two empty-state assertions, since Task 1's `QualsTab` had no empty branch).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `eventMatchAxis.ts`'s exported surface (`EventMatchRow`, `EVENT_COMP_LEVEL_RANK`, `isQualCompLevel`/`isElimCompLevel`, `compareEventMatchRows`, `mergeEventMatches`, `computeEventAxisDomain`) and `EventMatchTable`'s `{ rows, domain, season }` contract are ready for 07-13 (Elims tab) to consume unchanged, passing `isElimCompLevel` where this plan passes `isQualCompLevel`.
- 07-14 (Alliances tab) can read this plan's band quantity (`redScoreVarianceOwn`/`blueScoreVarianceOwn`) to prove its combined uncertainty is the same number under D-01's additivity identity.
- **Backstop items explicitly deferred, not silently dropped:** the ~390px real-device touch-scroll/overflow test against a real 72-84-row qualification slate (E5's stated highest-risk item) and the mark-grouping legibility question at that row density are both routed to 07-20, per the plan's own flagged assumptions.
- REQUIREMENTS.md's `EVNT-04` marked complete by this plan (the rendered Quals tab), matching the established EVNT-02/07-11 precedent.

---
*Phase: 07-event-pages*
*Completed: 2026-08-28*

## Self-Check: PASSED

All 10 created/modified files verified present on disk; all 3 task commit hashes (`cfdb83bf`, `bba88008`, `b35296dd`) verified present in git log.
