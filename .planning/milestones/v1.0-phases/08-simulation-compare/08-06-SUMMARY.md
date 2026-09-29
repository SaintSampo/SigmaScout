---
phase: 08-simulation-compare
plan: 06
subsystem: ui
tags: [react, vitest, testing-library, tanstack-router, tanstack-query, zod]

requires:
  - phase: 08-simulation-compare
    provides: "08-01's AccuracyTable (D-08 contract) and /compare route (five-artifact fetch, D-10 parity fixtures)"
provides:
  - "compareTie.ts: D-11's near-tie rule as a pure, framework-free module (formatters, standard-error math, two leader resolvers)"
  - "CompLevelSwitcher: fully-controlled three-segment Combined/Qualification/Elimination control"
  - "AccuracyTable's buildRowEmphasis and weight-only D-11 rendering"
  - "MethodologyNote: D-11's near-tie caption + D-08's derived methodology sentence"
  - "compare.tsx's single compLevelView state driving both the table and (later) 08-10's calibration section"
  - "compare.test.tsx's 45-case fixture-derived parity proof across all three views, plus the naive-divergence lock"
affects: [08-10 (calibration section reads the same compLevelView state), 08-12 (data-coverage section, same state), 08-15 (390px overflow backstop)]

actuals:
  tokens: 19600
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "One shared leader-pair skeleton (resolveLeaderPair) inside compareTie.ts that both resolveBrierLeaders/resolveWinnerAccuracyLeaders build on, so the two metrics' tie rules cannot silently drift apart"
    - "Weight-only emphasis (font-semibold) computed from a pure buildRowEmphasis function and applied at render time — never a colour, never a treatment on the non-leader cell"
    - "A fully-controlled segmented-button-group control (three plain shadcn Buttons in a labelled role=group) instead of Radix Tabs, proven stateless by a behavioural test rather than a source grep"
    - "Derived-not-transcribed prose: MethodologyNote's every figure comes from the same fetched artifacts the table renders, guarded by a test asserting the one authored evidential clause still holds against the five real committed fixtures"

key-files:
  created:
    - apps/web/src/lib/compareTie.ts
    - apps/web/src/lib/compareTie.test.ts
    - apps/web/src/components/compare/CompLevelSwitcher.tsx
    - apps/web/src/components/compare/CompLevelSwitcher.test.tsx
    - apps/web/src/components/compare/MethodologyNote.tsx
    - apps/web/src/components/compare/MethodologyNote.test.tsx
  modified:
    - apps/web/src/components/compare/AccuracyTable.tsx
    - apps/web/src/components/compare/AccuracyTable.test.tsx
    - apps/web/src/routes/compare.tsx
    - apps/web/src/routes/compare.test.tsx

key-decisions:
  - "resolveBrierLeaders/resolveWinnerAccuracyLeaders share one private resolveLeaderPair skeleton (filter finite -> sort with PUBLISHED_ALGORITHM_IDS tiebreak -> exact-tie short-circuit -> caller's own tie test) — the plan's own instruction that the two metrics differ only in their tie test and the accuracy resolver's one extra guard"
  - "The accuracy resolver's zero-scoredCount guard runs on the resolved leader/runner-up pair, before the SE/isNearTie call — a count of zero gets its own named branch rather than relying on the non-finite guard to catch it incidentally"
  - "CompLevelSwitcher renders unconditionally above every page-state branch (404/error/pending/populated), matching the page title's own 'gate content, never the element's own existence' rule — required updating one pre-existing 08-01 assertion (see Deviations)"
  - "MethodologyNote's figures stay pinned to the combined view (Decision 5) even though the table follows the switcher — re-slicing to elimination would falsify the note's own best-season clause against the committed data (VPR's 2022 elimination Brier beats its 2026 one)"
  - "The naive-divergence lock's strawman is implemented inline in compare.test.tsx, never imported from a shared module — it is the thing the lock proves is not what ships"

patterns-established:
  - "Display-precision formatters live beside the tie-test logic that consumes them (compareTie.ts), not beside the component that renders them, so the decision and the printed digits can never disagree"
  - "A near-tie/joint-tie rule's own unit tests are anchored on real measured corpus values (not just synthetic literals) so a regression in the underlying arithmetic is caught against the actual data the rule exists to protect"

requirements-completed: [COMP-01, EVAL-05]

coverage:
  - id: D1
    description: "D-11's near-tie rule ships as compareTie.ts: formatBrierDisplay/formatWinnerAccuracyDisplay (the single home for display precision), naiveStandardError/combineStandardErrors/isNearTie (strict threshold, non-finite guard), and resolveBrierLeaders/resolveWinnerAccuracyLeaders (display-string-equality tie test for Brier, naive-SE gap test for Winner Accuracy), proven against three real measured 2022/2023/2024 elimination cases"
    requirement: COMP-01
    verification:
      - kind: unit
        ref: "apps/web/src/lib/compareTie.test.ts — 23 cases"
        status: pass
    human_judgment: false
  - id: D2
    description: "The Compare page carries a fully-controlled three-segment compLevel switcher (Combined default / Qualification / Elimination) driven by one page-level state, re-slicing AccuracyTable to the selected view"
    requirement: COMP-01
    verification:
      - kind: unit
        ref: "apps/web/src/components/compare/CompLevelSwitcher.test.tsx — 10 cases, including the controlled-component proof"
        status: pass
      - kind: integration
        ref: "apps/web/src/routes/compare.test.tsx — 45 fixture-derived parity cases across all three views"
        status: pass
    human_judgment: false
  - id: D3
    description: "AccuracyTable renders weight-600 (font-semibold) only where buildRowEmphasis's computed rule names a real leader; no cell is ever greyed/muted/coloured to imply a loser the data cannot establish"
    requirement: COMP-01
    verification:
      - kind: unit
        ref: "apps/web/src/components/compare/AccuracyTable.test.tsx — buildRowEmphasis's 5 hand-built row shapes plus a whole-artifact rendered assertion computed against buildRowEmphasis"
        status: pass
      - kind: integration
        ref: "apps/web/src/routes/compare.test.tsx — naive-divergence lock (exactly 4/30 decisions diverge from a naive max/min strawman, all elimination) and two named real-data regression cases"
        status: pass
    human_judgment: false
  - id: D4
    description: "MethodologyNote renders D-11's verbatim near-tie caption and D-08's derived methodology sentence as always-visible muted paragraphs beneath the table, a DOM sibling of the table's scroll region, every figure derived from the fetched artifacts"
    requirement: EVAL-05
    verification:
      - kind: unit
        ref: "apps/web/src/components/compare/MethodologyNote.test.tsx — 16 cases including the evidential-clause guard against the five real fixtures"
        status: pass
      - kind: integration
        ref: "apps/web/src/routes/compare.test.tsx — note-sibling and note-pinned-to-combined-view assertions"
        status: pass
    human_judgment: false
  - id: D5
    description: "All forty-five artifact-derived numbers across the three views stay inside D-10's parity proof — every expected value an expression over the imported real fixture at run time, never a hand-typed literal"
    requirement: EVAL-05
    verification:
      - kind: integration
        ref: "apps/web/src/routes/compare.test.tsx — 45 parameterized cases; grep gates confirm no hand-typed numeric literal in the test file"
        status: pass
    human_judgment: false

duration: 17min
completed: 2026-08-31
status: complete
---

# Phase 8 Plan 6: D-11 Near-Tie Emphasis + compLevel Switcher + Methodology Note Summary

**The Compare accuracy table now bolds a real leader only when D-11's computed rule says the published data supports one — never a naive max/min — behind a new Combined/Qualification/Elimination switcher, with a derived (never transcribed) methodology note and a 45-case fixture-derived parity proof locking all three views.**

## Performance

- **Duration:** ~17 min
- **Started:** 2026-08-31T15:59:43-04:00
- **Completed:** 2026-08-31T16:16:37-04:00
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments

- `apps/web/src/lib/compareTie.ts`: D-11's near-tie rule as a pure, framework-free module — one shared leader-pair skeleton behind `resolveBrierLeaders` (display-string equality) and `resolveWinnerAccuracyLeaders` (naive-combined-SE gap test, zero-scoredCount guard, out-of-unit-interval guard via non-finite propagation), plus the single-home display formatters both the tie test and the rendered digits go through
- `apps/web/src/components/compare/CompLevelSwitcher.tsx`: three fully-controlled `Button`s in a labelled `role="group"`, accent variant on the pressed segment only, `.tap-target` on each, proven stateless by a behavioural (not source-grep) test
- `apps/web/src/components/compare/AccuracyTable.tsx`: gains `scoredCount` on `AccuracyCell` and the exported `buildRowEmphasis` — weight-only D-11 rendering, no colour, no treatment on a non-leader cell; this supersedes 08-01's deliberate uniform-plain-weight truth
- `apps/web/src/components/compare/MethodologyNote.tsx`: D-11's verbatim near-tie caption plus D-08's derived methodology sentence (tune/holdout season lists, per-season Brier figures, best-season clause) — every figure computed from the fetched artifacts, with the one authored evidential clause guarded against the five real fixtures
- `apps/web/src/routes/compare.tsx`: one `compLevelView` state drives the switcher and the table; `MethodologyNote` mounts as a DOM sibling beneath the table, pinned to the combined view
- `apps/web/src/routes/compare.test.tsx`: parity suite grown from 15 to 45 fixture-derived cases (3 views x 5 seasons x 3 algorithms); a naive-divergence lock proving the computed rule and an inline max/min strawman disagree on exactly 4 of 30 decisions, all in the elimination view, matching D-11's own measured table exactly

## Task Commits

1. **Task 1: compareTie.ts — D-11's near-tie rule, computed and tested at its boundaries** — `4872dfcf` (test, RED) → `74581f5c` (feat, GREEN)
2. **Task 2: The switcher, one shared state, and D-11 emphasis on the table** — `314c1373` (test, RED) → `d23ec821` (feat, GREEN)
3. **Task 3: MethodologyNote, the D-11 caption, and the parity proof across all three views** — `c6c95305` (feat — see TDD Gate Compliance below)

## TDD Gate Compliance

Task 1 and Task 2 both carry a clean RED-then-GREEN commit pair (test-only commit confirmed failing on missing import, followed by a GREEN commit with the full implementation and all tests passing). **Task 3 does not**: the test file and the implementation (`MethodologyNote.tsx`, plus the `compare.tsx`/`compare.test.tsx` extensions) were verified failing locally (module-not-found errors, confirmed via `npx vitest run`) before implementation began, but landed in a single combined commit (`c6c95305`) rather than a separate RED commit followed by a GREEN one. The RED→GREEN discipline was followed in practice — tests were written and confirmed failing first — but the git history for Task 3 does not carry the same two-commit proof Tasks 1 and 2 do. Flagged here per the executor's TDD gate-sequence validation rule rather than left implicit.

## Files Created/Modified

- `apps/web/src/lib/compareTie.ts` — D-11's near-tie rule, pure and framework-free
- `apps/web/src/lib/compareTie.test.ts` — 23 cases, three anchored on real measured elimination data
- `apps/web/src/components/compare/CompLevelSwitcher.tsx` — the three-segment switcher
- `apps/web/src/components/compare/CompLevelSwitcher.test.tsx` — 10 cases
- `apps/web/src/components/compare/AccuracyTable.tsx` — `buildRowEmphasis`, `scoredCount`, weight-only rendering
- `apps/web/src/components/compare/AccuracyTable.test.tsx` — updated rendered-HTML assertion (computed, not hand-typed) + 5 `buildRowEmphasis` cases + 2 new rendered cases
- `apps/web/src/components/compare/MethodologyNote.tsx` — the caption + derived methodology sentence
- `apps/web/src/components/compare/MethodologyNote.test.tsx` — 16 cases including the evidential-clause guard
- `apps/web/src/routes/compare.tsx` — one `compLevelView` state, switcher + note mounted
- `apps/web/src/routes/compare.test.tsx` — 45-case parity suite, divergence lock, named regressions, note assertions

## Decisions Made

See `key-decisions` in frontmatter. All decisions were already recorded by the plan itself (Decisions 1–7 in 08-06-PLAN.md) and executed as specified; the only implementation-level choice not pre-recorded in the plan was the internal `resolveLeaderPair` shared-skeleton shape inside `compareTie.ts`, which follows the plan's own explicit instruction ("implement both resolvers on one shared skeleton so they cannot drift").

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `compare.test.tsx`'s pre-existing 404 "no Retry control" assertion narrowed to check by accessible name**
- **Found during:** Task 2
- **Issue:** 08-01's test asserted `screen.queryByRole("button")` returns `null` in the 404 empty state. UI-SPEC requires the compLevel switcher to render "above every state branch, alongside the title and gated on nothing" — once mounted unconditionally, the switcher's own three segment `Button`s are legitimately present even in the 404 state, so the old blanket assertion started failing (found 3 buttons, not 0).
- **Fix:** Narrowed the assertion to `screen.queryByRole("button", { name: /retry/i })).toBeNull()` — preserving the original semantic intent ("no Retry control") while accommodating the switcher's now-always-present buttons.
- **Files modified:** `apps/web/src/routes/compare.test.tsx`
- **Verification:** `npx vitest run apps/web/src/routes/compare.test.tsx` — the 404 case passes; confirmed the switcher's own buttons are the only ones present in that state.
- **Committed in:** `d23ec821` (Task 2 commit)

**2. [Rule 1 - Bug] Two new `compare.test.tsx` MethodologyNote assertions raced the skeleton state**
- **Found during:** Task 3 (before either commit landed)
- **Issue:** `screen.getByRole("table")` is satisfied by `AccuracyTableSkeleton`'s own `<Table>` too — two newly-added tests checked for `MethodologyNote`'s testid immediately after that loose wait, racing ahead of the actual populated branch (where the note mounts) and failing with "unable to find element."
- **Fix:** Both tests now wait on a real rendered cell's text (matching every other test in the file's established double-wait discipline) before asserting on `MethodologyNote`.
- **Files modified:** `apps/web/src/routes/compare.test.tsx`
- **Verification:** Caught and fixed before either commit — `npx vitest run apps/web/src/routes/compare.test.tsx` is 55/55 green in the final Task 3 commit.
- **Committed in:** `c6c95305` (Task 3 commit — never shipped broken)

**Total deviations:** 2, both Rule 1 (test-only bug fixes, no production code touched by either). No architectural questions arose (Rule 4 never triggered), and no missing critical functionality was found (Rule 2 never triggered).

## Issues Encountered

- **Verified the naive-divergence lock's expected divergence set against the real committed fixtures before writing it as a hard assertion**, rather than trusting 08-CONTEXT.md D-11's table blind. Wrote a throwaway script (deleted before committing) that ran `resolveBrierLeaders`/`resolveWinnerAccuracyLeaders` from `compareTie.ts` against all five real fixtures across all three views: confirmed exactly 4 of 30 decisions diverge from an inline naive max/min strawman, all in the elimination view (2022 Brier; 2022, 2024, 2025 Winner Accuracy) — an exact match to D-11's stated table, so no discrepancy needed recording (08-06-PLAN.md Flagged Planner Assumption 1's "if the fixtures have moved" branch did not apply).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `compare.tsx`'s single `compLevelView` state is exported implicitly via the page's own `useState` — 08-10's calibration section reads this same state per Decision 5 (the note stays pinned to combined; the table and future calibration section both follow the switcher).
- `compareTie.ts`'s `formatBrierDisplay`/`formatWinnerAccuracyDisplay` are the site's single home for Compare-page numeric display precision — any future Compare surface printing a Brier or Winner Accuracy figure should import these rather than re-deriving formatting.
- `CompLevelSwitcher`'s `COMP_LEVEL_SWITCHER_TESTID`/`compLevelSegmentTestId` are stable, label-independent test hooks — 08-15's 390px overflow backstop can address segments without depending on rendered text.
- The S3/C1 real-390px overflow backstop (structural half covered by this plan's own compLevelView-switch test) remains owned by 08-15, per the plan's probe-coverage ledger.

## Self-Check: PASSED

All 10 created/modified files confirmed present on disk; all 5 task commits (`4872dfcf`, `74581f5c`, `314c1373`, `d23ec821`, `c6c95305`) confirmed in `git log`. Full verification: `npx vitest run apps/web/src` is 844/844 green; `pnpm --filter web typecheck` clean; `pnpm --filter web build` succeeds.

---
*Phase: 08-simulation-compare*
*Completed: 2026-08-31*
