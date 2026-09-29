---
phase: 08-simulation-compare
plan: 12
subsystem: ui
tags: [react, vitest, testing-library, tailwind-v4, zod]

requires:
  - phase: 08-simulation-compare
    provides: "08-01's five-artifact fetch/D-10 parity fixtures; 08-06's compLevelView state and AccuracyTable's grouped-header idiom; 08-10's calibrationSeries.ts pure-model split and CalibrationSection mount position"
provides:
  - "coverageRows.ts: the pure coverage-row model — collapseSharedCount (agreed/disagreed/absent three-way union), buildCoverageRows (season/algorithm/compLevel selection, per-algorithm no-call passthrough, published-zero vs absent-slice discriminator), COVERAGE_EXCLUSION_COLUMNS — no UI-framework import"
  - "DataCoverageTable.tsx: the Data coverage per year section — DataCoverageSection/DataCoverageTable/DataCoverageSectionSkeleton, the three-group grouped header (Excluded from scoring x4, Ties, No-calls by algorithm x3), D-09's verbatim contract explainer plus an authored structural sentence"
  - "compare.tsx: DataCoverageSection mounted last (populated branch, UI-SPEC layout item six); ComparePendingSections composes AccuracyTableSkeleton, module-local methodology/calibration placeholders, and DataCoverageSectionSkeleton so the pending branch's footprint matches all four populated sections"
  - "compare.test.tsx: 15 new fixture-derived coverage parity cases (3 views x 5 seasons), a 15/15 shared-collapse assertion, a fixture-derived reachable-zero case, four-section pending/error assertions, and a layout-order case — D-10's parity proof now covers every rendered number on the page"
affects: [08-13, 08-14, 08-15 (390px overflow backstop for this section's own eleven-column table)]

actuals:
  tokens: 19900
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Pure-model-beside-the-component split (coverageRows.ts has no React import), mirroring calibrationSeries.ts's precedent in this same directory"
    - "A three-way SharedCount union (agreed/disagreed/absent) as the mechanism that keeps a published zero and a genuinely absent slice structurally distinct all the way from the pure model to the rendered cell"
    - "A named module constant sizing every repeated Skeleton placeholder (METHODOLOGY_NOTE_SKELETON_LINE_COUNT, CALIBRATION_SECTION_SKELETON_TEXT_LINE_COUNT), never a bare number at the call site"

key-files:
  created:
    - apps/web/src/components/compare/coverageRows.ts
    - apps/web/src/components/compare/coverageRows.test.ts
    - apps/web/src/components/compare/DataCoverageTable.tsx
    - apps/web/src/components/compare/DataCoverageTable.test.tsx
  modified:
    - apps/web/src/routes/compare.tsx
    - apps/web/src/routes/compare.test.tsx

key-decisions:
  - "DataCoverageSectionSkeleton reuses DATA_COVERAGE_SECTION_TESTID/DATA_COVERAGE_SCROLL_TESTID with the populated DataCoverageSection, mirroring AccuracyTableSkeleton's own shipped precedent (same test id in both states) rather than minting a separate skeleton-only id — the plan's own exports list names exactly one section test id, which only makes sense under this reading"
  - "The Task 3 pending-state assertion ('none of the four populated sections' test ids appear') is read as 'no genuinely populated-only content renders' rather than literal id-absence for all four: METHODOLOGY_NOTE_TESTID and CALIBRATION_SECTION_TESTID are asserted absent (neither has a skeleton sibling reusing its id, Decision 7), and the coverage table's populated-ness is asserted by the absence of any real `data-coverage-cell-*` node rather than by DATA_COVERAGE_SECTION_TESTID's absence, since that id is legitimately shared with the skeleton by the decision above (same reasoning already applied to AccuracyTable's own shared COMPARE_ACCURACY_SCROLL_TESTID, which the pre-existing 08-01 pending test also does not assert absent)"
  - "Reused 08-10's own precedent for two acceptance-criteria greps that read literally against this repo's own pre-existing, unmodified code: `grep -c 'useState' compare.tsx` was already 2 (import line + the one hook call) before this plan touched the file — verified against git history at HEAD~3 — and `validateSearch` already appears in compare.tsx's untouched 08-01 doc comment. Both are read structurally (one useState(...) call site, no validateSearch: config on the Route), exactly as 08-10-SUMMARY.md's Issues Encountered section already resolved the identical pair of criteria on this same file"
  - "compare.test.tsx's pre-existing helpers (readCellText/readCellIsBold) and several page-state assertions were rescoped from bare `screen.getByRole('table')`/`screen.getByRole('columnheader', {name: 'Year'})` to the accuracy table's own COMPARE_ACCURACY_SCROLL_TESTID region — DataCoverageTable mounts a SECOND real <table> (and, during the pending branch, a second skeleton table) on this same page, so the unscoped queries became ambiguous the moment this plan's component mounted; this is a mechanical widening of 08-01/08-06/08-10's own pre-existing tests, not a behavior change to what they assert"

patterns-established:
  - "A discriminated three-way union (agreed/disagreed/absent) is the shape a rendering layer needs whenever a table cell is 'the same fact viewed through several independent computations that happen to agree today' rather than a single published field"

requirements-completed: [COMP-01, EVAL-05]

coverage:
  - id: D1
    description: "coverageRows.ts: collapseSharedCount (three-way agreed/disagreed/absent union, PUBLISHED_ALGORITHM_IDS emission order) and buildCoverageRows (season x algorithm x compLevelView selection, per-algorithm noCallCount never collapsed, published-zero vs absent-slice strictly separated, no arithmetic performed), guarded against all five committed fixtures for the candidateCount = scoredCount + sum(exclusionCounts) identity (45/45)"
    requirement: COMP-01
    verification:
      - kind: unit
        ref: "apps/web/src/components/compare/coverageRows.test.ts — 16 cases"
        status: pass
    human_judgment: false
  - id: D2
    description: "DataCoverageTable.tsx: the three-group grouped header (Candidate/Scored standalone, Excluded from scoring x4, Ties standalone, No-calls by algorithm x3 — 11 leaf columns), agreed-zero rendered as a bare digit vs absent rendered as an em-dash in two structurally distinct branches, a disagreed cell rendering all three algorithm-labelled values, no derived column, no emphasis treatment, D-09's verbatim contract explainer plus the authored structural sentence, and a shape-preserving DataCoverageSectionSkeleton"
    requirement: COMP-01
    verification:
      - kind: unit
        ref: "apps/web/src/components/compare/DataCoverageTable.test.tsx — 18 cases"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/compare/comparePalette.test.ts — 4 cases (this directory's no-hex/no-tier-token guard, now covering both new files)"
        status: pass
    human_judgment: false
  - id: D3
    description: "DataCoverageSection mounted last on /compare (UI-SPEC layout item six), fed the same compLevelView state as AccuracyTable and CalibrationSection (one state, three consumers, no new state declared); the pending branch renders a shape-preserving skeleton for all four sections; the error branch remains provably the page's only one across all four sections; every coverage number on the page is inside D-10's parity proof via 15 new fixture-derived cases plus a 15/15 shared-collapse assertion and a fixture-derived reachable-zero case"
    requirement: EVAL-05
    verification:
      - kind: integration
        ref: "apps/web/src/routes/compare.test.tsx — 80 total (60 pre-existing + 20 new: 15 parity cases, 1 shared-collapse assertion, 1 reachable-zero case, 1 pending-state case, 1 error-state case, 1 layout-order case)"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-08-31
status: complete
---

# Phase 8 Plan 12: Compare Page Data Coverage Section Summary

**The Compare page's last section — a Data coverage per year table with an 11-leaf-column grouped header (Excluded from scoring x4, Ties, No-calls by algorithm x3), a strict agreed-zero-vs-absent-slice rendering split, and D-09's careful offseason wording — plus the page's completed four-section pending/error branches.**

## Performance

- **Duration:** ~20 min (implementation; git commits span 19:08–19:22)
- **Completed:** 2026-08-31T23:22:30Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- `coverageRows.ts`: the pure coverage-row model — `collapseSharedCount`'s three-way agreed/disagreed/absent union (empty -> absent, all-equal -> agreed, otherwise disagreed emitted in `PUBLISHED_ALGORITHM_IDS` order regardless of input order), `buildCoverageRows`'s season x algorithm x compLevelView selection with `noCallCount` carried per algorithm and NEVER collapsed, and the candidate/scored/exclusion identity guarded against all five committed fixtures (45/45)
- `DataCoverageTable.tsx`: `DataCoverageSection`/`DataCoverageTable`/`DataCoverageSectionSkeleton` — the three-group grouped header, an agreed-zero cell rendering as a bare digit and an absent cell rendering as an em-dash in two structurally distinct branches (proven paired in the same row), a disagreed cell naming all three algorithms, zero derived columns, zero emphasis treatment, D-09's verbatim Copywriting Contract sentence plus an authored structural sentence covering the partition and the ties/no-calls placement
- `compare.tsx`: `DataCoverageSection` mounted last (UI-SPEC layout item six), fed the same `compLevelView` state as the accuracy table and calibration section (one state, three consumers, zero new state); `ComparePendingSections` composes the accuracy skeleton, two text-free module-local placeholders for the methodology note and calibration section (Decision 7 — neither of those files gained a skeleton sibling), and the real `DataCoverageSectionSkeleton`
- `compare.test.tsx` grows by 20 cases: 15 fixture-derived coverage parity cases (one per view x season, all eleven leaf cells each), a 15/15 shared-collapse assertion proving every rendered shared cell today is a single number, a fixture-derived reachable-zero case (coordinates derived from the fixture, not hardcoded), a four-section pending-state case, a four-section error-state case, and a layout-order case
- `apps/web/src` suite: 1041/1041 green (up from 987 at 08-11's close, +54 new tests: 16 + 18 + 20)

## Task Commits

1. **Task 1: coverageRows.ts — pure model, TDD** — `25504e64` (test, RED) → `9db42c8d` (feat, GREEN)
2. **Task 2: DataCoverageTable.tsx — grouped-header table and D-09's explainer, TDD** — `cf5163dc` (test, RED) → `bc883e25` (feat, GREEN)
3. **Task 3: Mount it, finish the four-section pending/error branches, extend the parity proof** — `45259c13` (feat)

## Files Created/Modified

- `apps/web/src/components/compare/coverageRows.ts` — the pure coverage-row model
- `apps/web/src/components/compare/coverageRows.test.ts` — 16 cases, including the fixture-based candidate/scored/exclusion identity guard
- `apps/web/src/components/compare/DataCoverageTable.tsx` — the section, table, and skeleton
- `apps/web/src/components/compare/DataCoverageTable.test.tsx` — 18 cases
- `apps/web/src/routes/compare.tsx` — mounts `DataCoverageSection`; completes the four-section pending branch
- `apps/web/src/routes/compare.test.tsx` — 20 new cases; rescoped several pre-existing table/columnheader queries to `COMPARE_ACCURACY_SCROLL_TESTID` now that a second `<table>` exists on the page

## Decisions Made

See `key-decisions` in frontmatter for the four implementation-level judgment calls (skeleton test-id reuse, the pending-state assertion's practical reading, the two grep-literalism resolutions reusing 08-10's own precedent, and the test-helper rescoping). Decisions 1–7 already recorded in `08-12-PLAN.md` were executed as specified — no departure from any of them.

## Deviations from Plan

None — plan executed exactly as written. The four items above are documented judgment calls (interpreting ambiguous acceptance-criteria wording and pre-existing shipped precedent), not fixes to broken or missing functionality, so none rises to a numbered deviation rule.

## Issues Encountered

- `DataCoverageTable` mounting a second `<table>` on `/compare` broke every pre-existing `screen.getByRole("table")` and one `screen.getByRole("columnheader", { name: "Year" })` call in `compare.test.tsx` (08-01/08-06/08-10's own tests) with a "multiple elements" error the moment Task 3's mount landed. Fixed by scoping each to `within(screen.getByTestId(COMPARE_ACCURACY_SCROLL_TESTID))` — a mechanical widening that changes no assertion's meaning, confirmed by re-running the full pre-existing suite (60/60 unchanged) before adding any new case.
- Confirmed live, before writing any test, that all 45 published slices' `candidateCount` equals `scoredCount` plus the four exclusion counts (the identity guard), and separately that the three algorithms agree on all seven collapsible coverage fields in all 15 (season, view) groups (the shared-collapse assertion) — both measured directly against the five committed fixtures rather than assumed from 08-CONTEXT.md's own prose.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `apps/web/src/components/compare/coverageRows.ts`'s exports (`SharedCount`, `collapseSharedCount`, `CoverageRow`, `buildCoverageRows`, `COVERAGE_EXCLUSION_COLUMNS`) are the single home for any future coverage-figure rendering on this site.
- `/compare` now renders all four D-09 sections in UI-SPEC's layout order, with a shape-preserving pending state and a provably single error branch — the page's own scope per 08-CONTEXT.md is complete.
- 08-15's C4 overflow-backstop row (390px legibility of the eleven-leaf-column table) is unaddressed by this plan per the outline's own probe-coverage ledger — it remains 08-15's job, and Flagged Planner Assumption 2 in `08-12-PLAN.md` records that the row's stated premise (an ~8-column table) moved to 11 columns.
- No published artifact contract was touched, no schema field was added, no npm dependency was added, and no `.env` was read — this plan's threat register (T-08-12-01 through -07-SC) is entirely `mitigate`/`accept`, with no open item.

## Self-Check: PASSED

All 4 created files and 2 modified files confirmed present on disk; all 5 task commits (`25504e64`, `9db42c8d`, `cf5163dc`, `bc883e25`, `45259c13`) confirmed in `git log`. Full verification: `pnpm --filter web typecheck` clean; `npx vitest run apps/web/src` is 1041/1041 green (up from 987/987 at 08-11's close, +54 new tests); `pnpm --filter web build` succeeds; the three acceptance-criteria greps (`seasonLabel|headlineEligible`, `toLocaleString|Intl\.NumberFormat`, `font-semibold|font-\[600\]|opacity-|text-muted-foreground`) each return nothing against `DataCoverageTable.tsx`; the two no-hand-typed-figure greps (`toBe\("[0-9]`, `^\s*(const|let)\s+\w+\s*[:=]\s*[0-9]+\.[0-9]`) each return nothing against `compare.test.tsx`.

---
*Phase: 08-simulation-compare*
*Completed: 2026-08-31*
