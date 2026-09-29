---
phase: 07-event-pages
plan: 13
subsystem: ui
tags: [react, tanstack-router, event-pages, elims, match-plot, uncertainty]

requires:
  - phase: 07-event-pages (07-01)
    provides: "The /event/$eventKey route, the { artifact, algorithmId, season } tab prop contract, REGISTERED_EVENT_TABS narrowing, the three-independent-scroll-regions pattern"
  - phase: 07-event-pages (07-11)
    provides: "renderTabState — the route's one shared page-state branch order, reused unchanged as this tab's fourth caller"
  - phase: 07-event-pages (07-12)
    provides: "eventMatchAxis.ts (EventMatchRow, isElimCompLevel, compareEventMatchRows, mergeEventMatches, computeEventAxisDomain), EventMatchTable.tsx, and QualsTab.tsx's exported QUALS_EMPTY_STATE_BODY — this plan's entire toolkit, consumed unchanged"
provides:
  - "apps/web/src/components/event/ElimsTab.tsx — the EVNT-06 tab: isElimCompLevel filter, D-13 merge, D-12 per-tab domain, empty state importing QUALS_EMPTY_STATE_BODY, sibling scroll region, skeleton"
  - "apps/web/src/routes/event.$eventKey.tsx — 'elims' registered last in REGISTERED_EVENT_TABS, trigger + TabsContent behind renderTabState"
affects: [07-14-alliances-tab, 07-15-event-header, 07-18-default-tab-flip, 07-20-real-device-overflow-pass]

actuals:
  tokens: 12100
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "A fourth tab (ElimsTab) reuses a shared event-match-plot toolkit (eventMatchAxis.ts/EventMatchTable.tsx/QualsTab.tsx's exported constant) with exactly one predicate swapped and zero new machinery — proven by a git diff --numstat showing seven dependency files byte-identical and their own pre-existing test suites staying green throughout"
    - "A shared-sentence import (QUALS_EMPTY_STATE_BODY) carries an awkward cross-tab name on purpose — the alternative (retyping or relocating it) risks a silent paraphrase drift or an unnecessary edit to a dependency's shipped export/test file for a purely cosmetic gain"
    - "A structural anti-drift assertion between two sibling components (byte-identical scroll-region class strings) is verified to actually bite by temporarily adding one utility, confirming red, then removing it and confirming green — an assertion that never fails under any mutation is not a real assertion"

key-files:
  created:
    - apps/web/src/components/event/ElimsTab.tsx
    - apps/web/src/components/event/ElimsTab.test.tsx
  modified:
    - apps/web/src/routes/event.$eventKey.tsx
    - apps/web/src/routes/event.$eventKey.test.tsx

key-decisions:
  - "The order is compareEventMatchRows, not a sortTime-primary sort — no comparator, ordering key or sort call declared in this file (plan Decision 1); the deviation from D-14's word 'chronological' (series-major for a 2022-style bracket, not literally wall-clock) is surfaced as flagged planner assumption 1 with a named recommended owner (an amendment to 07-12), not fixed locally"
  - "The empty-state body is IMPORTED from QualsTab.tsx's exported QUALS_EMPTY_STATE_BODY, not retyped, despite the QUALS_ prefix reading oddly on this tab (plan Decision 2)"
  - "The heading template ('No matches found for {name}') is written out in this file rather than extracted from a dependency, with a grep gate asserting it appears exactly once in both ElimsTab.tsx and QualsTab.tsx (plan Decision 3)"
  - "ElimsTab is a sibling component to QualsTab, not a shared MatchTab with a predicate prop; the one place that could silently drift (the scroll-region class set) is closed with a direct class-string-equality test rather than with discipline (plan Decision 4), confirmed to actually fail when the two diverge"
  - "ElimsTabProps declares the full frozen { artifact, algorithmId, season } contract even though only two fields are read (plan Decision 5)"
  - "The Elims trigger is registered LAST in the strip; a route comment records that 07-14 inserts Alliances between Quals and Elims rather than appending (plan Decision 6)"
  - "One doc-comment phrase ('results haven't published yet' framing) was reworded to 'not-yet-published framing' to avoid a literal substring collision with the plan's own no-retyped-sentence grep gate — same meaning, gate stays green (execution-time finding, mirrors 07-07's PD-09 precedent)"
  - "Two pre-existing route tests (the 'unregistered tab' probe, previously pinned to 'elims'; and the tab-count/order assertion) were foreseeably invalidated by registering 'elims' here — fixed by moving the probe to 'alliances' (07-14's still-unregistered tab) and updating the count from three tabs to four, mirroring the exact fix 07-12 made when it registered 'quals'"

requirements-completed: [EVNT-06]

coverage:
  - id: D1
    description: "ElimsTab.tsx renders every elimination match (ef/qf/sf/f, isElimCompLevel-selected) as one flat list, no bracket, round-labelled by matchLabel(), ordered by compareEventMatchRows only — filtering/ordering/four-level-label cases plus the measured 2022ilpe 18-row interleave (upcoming rows at zero-based indices 4, 10, 15) and a shuffled-input invariance proof"
    requirement: EVNT-06
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/ElimsTab.test.tsx#Filtering to the closed elimination set / Ordering"
        status: pass
    human_judgment: false
  - id: D2
    description: "The D-13 client-side merge (mergeEventMatches over artifact.matches/upcoming, isElimCompLevel) proven non-mutating and proven to collapse a shared match key to the played row; the D-12 per-tab axis domain proven to span the full merged extent and proven to differ from QualsTab's domain on a disjoint-score-range artifact"
    requirement: EVNT-06
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/ElimsTab.test.tsx#The D-13 merge and its non-mutation contract / Per-tab domain (D-12)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every bonus-RP dot on every elimination row renders data-state=unknown AND carries the accessible label ending 'not awarded outside qualification matches' (distinguishing this tab's route to unknown from Quals' different route to the same visual state), across all four elimination levels and both 2024 (two-dot) and 2025 (three-dot) season shapes"
    requirement: EVNT-06
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/ElimsTab.test.tsx#Bonus-RP dots — the tab's defining negative"
        status: pass
    human_judgment: false
  - id: D4
    description: "Empty state (239/1,581 corpus events, 15%) renders the canonical EmptyState with the imported Quals sentence and no table/button; an event with zero played but scheduled elimination matches renders the full table instead; adjacency (same-triple-different-key separation, touching/coincident bands, zero-variance real band) and the 60-row 2022mirr boundary case all pass"
    requirement: EVNT-06
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/ElimsTab.test.tsx#Empty state / Adjacency / Boundary and single-row"
        status: pass
    human_judgment: false
  - id: D5
    description: "ElimsTab's scroll region is proven a byte-identical class string to QualsTab's (confirmed to actually fail under a deliberate mutation) and a DOM sibling of the tab strip's own scroll region in both directions; the Elims trigger/panel is registered last behind renderTabState with 404/500/pending expectations shared against ?tab=quals"
    requirement: EVNT-06
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/ElimsTab.test.tsx#Anti-drift against the sibling tab + apps/web/src/routes/event.$eventKey.test.tsx#the Elims tab registered"
        status: pass
    human_judgment: false
  - id: D6
    description: "The ~390px real-device touch-scroll/overflow test against the widest reachable elimination slate is a stated backstop, owned by 07-20 — this plan corrects UI-SPEC's row-count estimate (measured 19/17 reachable, 60 for offseason-only 2022mirr) but does not itself run a real-device test"
    verification: []
    human_judgment: true
    rationale: "Real touch-interaction behavior at phone width cannot be proven by a jsdom unit test; 07-20 owns the phase's real-device backstop pass, matching every sibling tab plan in this phase (07-01, 07-11, 07-12, 07-14)."

duration: ~40min
completed: 2026-08-28
status: complete
---

# Phase 7 Plan 13: Elims Tab Summary

**The EVNT-06 Elims tab renders every playoff match of an event as one flat, D-14-flat, D-12-domained list by reusing 07-12's shared match-plot toolkit unchanged — zero new comparator, filter, geometry or bonus-state logic, proven by seven negative grep gates and a byte-identical-diff on all seven dependency files.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 2 of 2 completed
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `ElimsTab.tsx` exists: filters to the closed `ef`/`qf`/`sf`/`f` set via 07-12's `isElimCompLevel` (never the negation of the qualification predicate), merges played+upcoming via `mergeEventMatches` (D-13, proven non-mutating), computes its own axis domain via `computeEventAxisDomain` (D-12, proven to differ from Quals' domain on disjoint score ranges), and renders `EventMatchTable` completely unchanged.
- The measured `2022ilpe` shape (15 played + 3 upcoming elimination rows) renders as the full 18-row merged sequence with the three upcoming rows interleaved at zero-based indices 4, 10 and 15 — not appended — and the same output survives both input arrays reversed, proving the order does not depend on sort stability or source array.
- Every bonus-RP dot on every elimination row renders `unknown` and carries the accessible label ending "not awarded outside qualification matches" — distinguishing this tab's route to `unknown` (the mechanic does not exist in playoffs) from the Quals tab's different route to the identical visual state (no per-bonus data published). Verified across all four elimination levels and both the 2024 two-dot and 2025 three-dot season shapes.
- The empty state (239 of 1,581 corpus events, 15%, carry zero elimination matches) renders the canonical `EmptyState` with the body **imported** from `QualsTab.tsx`'s exported `QUALS_EMPTY_STATE_BODY` — never retyped — and no table, button or scroll region; an event with zero played but some scheduled elimination matches renders the full table instead of the empty state.
- Adjacency and boundary evidence: two rows sharing an identical `(compLevel, setNumber, matchNumber)` triple separate by match key rather than merging or dropping; touching and exactly-coincident alliance bands both render with their own colour and tick; a zero-variance row still renders a real (zero-width) band; a 60-row `2022mirr`-shaped fixture (`ef` sets 1-20, 3 matches each, all unplayed) renders all 60 rows with `Eighths {set}-{match}` labels and zero dots.
- The anti-drift proof: `ElimsTab`'s and `QualsTab`'s scroll-region class strings are asserted string-equal, and that assertion was confirmed to actually fail when a utility class was temporarily added to one side, then confirmed to pass again after removal.
- `event.$eventKey.tsx`: `"elims"` registered last in `REGISTERED_EVENT_TABS`, trigger placed last in the strip with a comment noting 07-14 inserts Alliances between Quals and Elims, `TabsContent` wired to `ElimsTab`/`ElimsTabSkeleton` behind 07-11's `renderTabState`.

## Task Commits

Each task was committed atomically (RED observed before implementation, brought to GREEN within the same task commit, matching the established 07-12 pattern since this plan's frontmatter is `type: execute`, not a plan-level `type: tdd` gate):

1. **Task 1: TRACER — one real elimination match reaches the screen at `?tab=elims`** - `a34416ce` (feat)
2. **Task 2: The EVNT-06 probe evidence — empty state, adjacency/boundary, anti-drift, route states** - `1e4e1a21` (feat)

**Plan metadata:** committed alongside this SUMMARY (see final commit below).

## Files Created/Modified

- `apps/web/src/components/event/ElimsTab.tsx` - `ElimsTab`, `ElimsTabProps`, `ElimsTabSkeleton`
- `apps/web/src/components/event/ElimsTab.test.tsx` - 07-VALIDATION.md's Wave 0 EVNT-06 test file (32 tests: filtering, ordering including the full 2022ilpe interleave, the D-13 merge, the D-12 domain, bonus-RP negatives, unplayed/absent-variance rows, structure, empty state, adjacency, boundary, anti-drift)
- `apps/web/src/routes/event.$eventKey.tsx` - `elims` registered in `REGISTERED_EVENT_TABS`, trigger + `TabsContent` behind `renderTabState`
- `apps/web/src/routes/event.$eventKey.test.tsx` - Elims-registration describe block (first-paint trigger, panel exclusivity, shared 404/500/pending expectations against `?tab=quals`, click-preserves-params, four-tab strip order, sibling-scroll assertion) plus two pre-existing tests corrected (see Deviations)

## Decisions Made

See `key-decisions` in the frontmatter above for the full list (mirrors the plan's own Decisions 1-6 verbatim, plus two execution-time findings: the doc-comment substring-collision reword, and the two pre-existing route test corrections).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Doc comment collided with the plan's own no-retyped-sentence grep gate**
- **Found during:** Task 2, running the acceptance-criteria grep gates after the empty-state branch landed
- **Issue:** `ElimsTab.tsx`'s doc comment explaining why the shared empty-state sentence fits this tab better quoted the phrase "results haven't published yet" verbatim — the exact substring the plan's own acceptance criterion (`grep -c "results haven't published yet" ElimsTab.tsx ElimsTab.test.tsx` must equal 0 for both files) exists to catch, since that gate is a plain grep with no comment-line exclusion (unlike the other structural grep gates in this plan).
- **Fix:** Reworded the comment to "not-yet-published framing" — identical meaning, no literal substring collision. Mirrors the established 07-07 precedent (STATE.md: "Reworded one new doc-comment phrase... to avoid a literal substring collision with 07-06's PD-09 sweep gate grep").
- **Files modified:** `apps/web/src/components/event/ElimsTab.tsx`
- **Verification:** `grep -c "results haven't published yet" apps/web/src/components/event/ElimsTab.tsx apps/web/src/components/event/ElimsTab.test.tsx` now reads 0 for both files; `ElimsTab.test.tsx` stayed green throughout.
- **Committed in:** `1e4e1a21` (Task 2 commit)

**2. [Rule 1 - Bug] Two pre-existing route tests invalidated by registering the fourth tab**
- **Found during:** Task 1's route registration, discovered running the full `event.$eventKey.test.tsx` suite
- **Issue:** A pre-existing test asserting `?tab=elims` (still unregistered) resolves to Breakdown, and a pre-existing test asserting exactly three tabs exist, both assert behavior that is definitionally false once this plan registers `"elims"` — the same foreseeable consequence 07-12 hit when it registered `"quals"` (07-12-SUMMARY.md's own documented Deviation 2).
- **Fix:** Moved the "unregistered tab" probe (both occurrences) from `"elims"` to `"alliances"` — 07-14's tab, still unregistered as of this plan — preserving the original tests' intent; updated the tab-count assertion from three to four tabs in the correct order (Insights, Breakdown, Quals, Elims).
- **Files modified:** `apps/web/src/routes/event.$eventKey.test.tsx`
- **Verification:** Full route test file green (30/30) after the correction; `pnpm --filter web test` green across the whole web suite (44/44 files, 548/548 tests).
- **Committed in:** `a34416ce` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bug fixes — a grep-gate substring collision and two test corrections foreseeably invalidated by the plan's own intended tab registration)
**Impact on plan:** Both fixes were required for correctness of the plan's own stated verification gates; neither changed shipped behavior beyond what the plan specified. No scope creep.

## Issues Encountered

- This workspace has no `@testing-library/jest-dom` matcher dependency (documented precedent in `StateViews.test.tsx`/`TeamsTable.test.tsx`) — an early draft of two test assertions used `.toHaveTextContent(...)`, which is not a real Chai matcher here. Fixed to plain `.textContent` string comparisons before the first RED run, matching this workspace's established convention. Not a plan deviation — a test-authoring detail caught before it could produce a false RED/GREEN reading.

## User Setup Required

None - no external service configuration required.

## Baseline / Verification

- **Pre-plan baseline** (recorded before Task 1, per the plan's `<baseline>` block): `pnpm test` showed exactly 1 failing assertion (`packages/harness/payloadBudget.test.ts`'s `teams/{year}` internal-consistency check, the accepted signed override tracked at `.planning/WINDOWS.md` ledger #11). `eventMatchAxis.test.ts`/`EventMatchTable.test.tsx`/`QualsTab.test.tsx` were all green (67 tests total).
- **RED evidence quoted per task:** Task 1's stub-component RED run (an intentionally unfiltered, unordered scaffold — never a module-not-found error) failed 8 of 20 cases behaviorally: the filtering case rendered 8 unfiltered rows instead of 4; the comp-level-order case returned `['f1m2','f1m1','sf2m2',...]` instead of the expected ef/qf/sf/f-ranked sequence; the 2022ilpe interleave case returned the raw concatenation order instead of the measured 18-row sequence; the shared-matchKey collapse case rendered 2 rows instead of 1; the domain-extent case returned a fixed `[0,1]` domain instead of one spanning the upcoming row's score. Task 2's RED run against the tracer-scope empty-state cases failed 3 of 32: the two empty-state-heading assertions and the byte-identical-body assertion, since Task 1's `ElimsTab` had no empty branch yet.
- **Post-plan verification:** `pnpm --filter web typecheck` clean; `pnpm --filter web test` green (44/44 files, 548/548 tests); `pnpm test` from the repo root shows exactly the same one accepted `payloadBudget.test.ts` baseline failure and no other (1817 passed, 1 skipped, 1 accepted failure); `eventMatchAxis.test.ts`/`EventMatchTable.test.tsx`/`QualsTab.test.tsx` stayed byte-identical (`git diff --numstat` empty against the pre-plan commit) and green throughout both tasks (67/67); `pnpm --filter web build` succeeds and `routeTree.gen.ts` still registers `/event/$eventKey`; both plan-specified live-artifact `curl` proofs (`2022ilpe`: 15 played/3 upcoming elimination rows, zero overlapping match keys; `2024cmptx`: zero `qm` rows, 15+ elimination rows) printed `ok`.
- **All nine of Task 1's negative/positive grep gates and Task 2's four additional grep gates pass**, including the class-string-equality assertion's confirmed bite (temporarily broken, confirmed red, restored, confirmed green — both observations recorded above under Accomplishments).
- **Measured correction recorded per the plan's instruction (not applied to UI-SPEC, which is not this plan's file):** 07-UI-SPEC.md's E6 overflow row estimates roughly 29 playoff matches for 2022 and roughly 22 for 2024/2026. The measured figures this session are 19 (2022) and 17 (2023-2026) for the widest reachable non-offseason slate, and 60 for `2022mirr` (offseason, currently unpublished, ef sets 1-20). Both of UI-SPEC's numbers are wrong, in opposite directions — routed to 07-20, which owns the touch test.

## Next Phase Readiness

- `ElimsTab`'s `{ artifact, algorithmId, season }` contract and its route registration are complete to EVNT-06/D-14/D-12/D-13. `eventMatchAxis.ts`, `EventMatchTable.tsx` and `QualsTab.tsx` remain untouched and their own test suites remain green — 07-14 (Alliances tab) can build against the identical unchanged toolkit.
- 07-14 inserts its Alliances trigger between Quals and Elims (a comment in `event.$eventKey.tsx` records this); the route test's "unregistered tab" probe has already been moved to `"alliances"` in anticipation.
- **Flagged planner assumptions carried forward, not resolved by this plan (expected — routed to a named owner):** (1) the shipped order is wall-clock for 2023-2026 but series-major for a 2022-style bracket, D-14's word "chronological" is not literally true for that one season family — recommended owner is an amendment to 07-12 adding the published timestamp to `EventMatchRow` and a leading comparison to `compareEventMatchRows`; (2) the em-dash Actual-column cell for an unplayed row could become a real scheduled time via the same 07-12 amendment; (3) UI-SPEC's E6 overflow row-count estimate is corrected above but not edited in the document itself, routed to 07-20; (4) `matchLabel`'s `Eighths` (`ef`) label is asserted only against a fixture — no live `ef` row exists today (all 12 corpus events carrying one are offseason) — first live coverage arrives at 07-17's full republish.
- **Backstop item explicitly deferred, not silently dropped:** the ~390px real-device touch-scroll/overflow test against the widest elimination slate is 07-20's, per the plan's own flagged assumptions — this plan's own measured correction (19/17 reachable, 60 for `2022mirr`) is the target 07-20 should use instead of UI-SPEC's stale estimate.
- REQUIREMENTS.md's `EVNT-06` marked complete by this plan (the rendered Elims tab), matching the established EVNT-02/EVNT-04 precedent (07-11/07-12).

---
*Phase: 07-event-pages*
*Completed: 2026-08-28*

## Self-Check: PASSED

All 4 created/modified files verified present on disk; both task commit hashes (`a34416ce`, `1e4e1a21`) verified present in git log.
