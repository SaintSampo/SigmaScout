---
phase: 01-data-foundation-evaluation-harness
plan: 04
subsystem: algorithms
tags: [opr, ridge-regression, ml-matrix, vitest, isomorphic]

# Dependency graph
requires:
  - phase: 01-data-foundation-evaluation-harness (Plan 02)
    provides: The tracer's AlgorithmModule<S> contract and a first working (but naive, per-event) OPR baseline
provides:
  - "Season-scope pooled, ridge-regularized OPR (packages/core/algorithms/opr.ts) — solveRidgeOpr, ratingEligibleTeams, allianceObservation, OPR_RIDGE_LAMBDA, OPR_LOGISTIC_SCALE"
  - "D-07's surrogate-slot modeling question resolved and tested: surrogate offset subtracted from teammates' target, surrogate's own column excluded"
  - "A stated, tested, reversible disqualification policy (Open Question 3): keep the column, update the rating — opposite of surrogates"
  - "packages/core/isomorphic.test.ts — architectural fitness test proving packages/core stays Worker-portable"
affects: ["01-05", "01-06"]

# Actuals (#2632)
actuals:
  tokens: 7600
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "OPR's design-matrix column inclusion is driven by ratingEligibleTeams (surrogate exclusion only) — disqualification deliberately has no corresponding exclusion because MatchResult carries no dq field at all, making 'keep the column' the structural default rather than a branch"
    - "Surrogate contribution is modeled as a subtracted offset (current rating, or league-mean per-team share if the surrogate has no rating yet) rather than dropping the whole observation row or leaving the surrogate's column in the solve"

key-files:
  created:
    - packages/core/isomorphic.test.ts
  modified:
    - packages/core/algorithms/opr.ts
    - packages/core/algorithms/opr.test.ts
    - packages/core/algorithms/types.ts

key-decisions:
  - "UpcomingMatch/MatchResult's team-array fields (redTeams, blueTeams, redSurrogates, blueSurrogates) tightened to readonly string[] — a low-risk type-level reinforcement of the module's stated purity contract, applied while touching types.ts for this plan rather than as a separate change"
  - "solveRidgeOpr's synthetic-recovery test fixture uses 8 teams and the full 56-combination 3-team round-robin (not a hand-picked 12-alliance subset) — empirically measured to keep ridge bias (lambda=3) under ~3 points per team, versus ~9 points with a smaller/sparser fixture; documented tolerance set to 4"
  - "Season-scope pooling required no structural change to update()'s accumulation — the tracer already never scoped state.observations to a single event; this plan makes that pooling explicit, comments the reasoning, and proves it with a cross-event test rather than treating it as a rewrite"
  - "ratingEligibleTeams and allianceObservation (Task 2's stated deliverables) were implemented together with Task 1's ridge-solve rewrite in one pass, since both tasks touch the same update()/predict() call sites; Task 2's commit is test-only (surrogate/dq/isomorphic tests plus a strengthened disqualification comment) because there was no missing implementation for a RED phase to reveal — same task-shape precedent documented in 01-02-SUMMARY.md's TDD Gate Compliance section"

requirements-completed: [ALGO-01, DATA-02]

coverage:
  - id: D1
    description: "OPR is a season-pooled, ridge-regularized baseline that recovers known synthetic team strengths within a documented tolerance and never produces NaN/Infinity even in a deliberately under-determined two-match cold-start"
    requirement: ALGO-01
    verification:
      - kind: unit
        ref: "packages/core/algorithms/opr.test.ts — solveRidgeOpr synthetic-strength recovery (8 teams, 56 alliances, max error < 4) and cold-start finiteness/mean-shrinkage tests"
        status: pass
    human_judgment: false
  - id: D2
    description: "OPR_RIDGE_LAMBDA and OPR_LOGISTIC_SCALE are exported constants with reasoning comments, and the solve runs via ml-matrix's SingularValueDecomposition rather than a hand-rolled elimination"
    requirement: ALGO-01
    verification:
      - kind: unit
        ref: "packages/core/algorithms/opr.test.ts — 'OPR_RIDGE_LAMBDA / OPR_LOGISTIC_SCALE are exported positive constants'; pnpm typecheck confirms solveRidgeOpr's ml-matrix usage compiles"
        status: pass
    human_judgment: false
  - id: D3
    description: "A team's rating pools observations across every event it has attended so far this season, not just the current event"
    requirement: ALGO-01
    verification:
      - kind: unit
        ref: "packages/core/algorithms/opr.test.ts — 'gives a team that has played at two different events both events' observations in its rating as of a match at the second event'"
        status: pass
    human_judgment: false
  - id: D4
    description: "predict and update are pure: both return new values and leave their state/input arguments unmutated, proven by reference and structural snapshot comparison, not asserted by convention"
    requirement: ALGO-01
    verification:
      - kind: unit
        ref: "packages/core/algorithms/opr.test.ts — 'returns a new state and leaves the input state structurally unchanged'; 'returns equal predictions for the same state and match, and does not alter the state'"
        status: pass
    human_judgment: false
  - id: D5
    description: "D-07's surrogate modeling question is resolved: a surrogate's own rating is unaffected by its surrogate appearance, while its teammates still receive a correctly offset observation (using the surrogate's current rating, or the league-mean per-team share if it has none yet)"
    requirement: DATA-02
    verification:
      - kind: unit
        ref: "packages/core/algorithms/opr.test.ts — ratingEligibleTeams/allianceObservation direct tests plus 'a team appearing as a surrogate in a later match has its rating unchanged' and 'accumulates exactly one observation, from the normal appearance'"
        status: pass
    human_judgment: false
  - id: D6
    description: "The disqualification policy (opposite of surrogates: keep the column, update the rating) is implemented, tested, and its reasoning is recorded as a comment adjacent to ratingEligibleTeams"
    requirement: DATA-02
    verification:
      - kind: unit
        ref: "packages/core/algorithms/opr.test.ts — 'a disqualified team's rating is updated from the match it was disqualified in'; comment verified present in packages/core/algorithms/opr.ts adjacent to ratingEligibleTeams"
        status: pass
    human_judgment: false
  - id: D7
    description: "packages/core cannot drift into Node-only or better-sqlite3-dependent code without a test failing; the fitness test cannot pass vacuously"
    requirement: ALGO-01
    verification:
      - kind: unit
        ref: "packages/core/isomorphic.test.ts (2 tests) — non-empty file-list assertion, then a scan for node:*/fs/path/crypto/os/child_process/better-sqlite3 import specifiers"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-08-13
status: complete
---

# Phase 1 Plan 4: Season-Pooled, Ridge-Regularized OPR with Surrogate/DQ Policy Summary

**OPR rewritten around explicit season-scope pooling and a ridge-regularized `ml-matrix` SVD solve (`solveRidgeOpr`), recovering known synthetic team strengths within 4 points on an 8-team/56-alliance fixture and staying finite and mean-shrunk in a deliberately under-determined two-match cold start; D-07's surrogate-slot question is resolved via a subtracted-offset observation (`allianceObservation`) that updates only non-surrogate teammates, disqualified teams keep their column and rating by a documented opposite policy, and a new `isomorphic.test.ts` proves `packages/core` stays free of Node built-ins and `better-sqlite3`.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-08-13T04:50:00Z
- **Completed:** 2026-08-13T05:02:35Z
- **Tasks:** 2
- **Files modified:** 4 (1 new + 3 modified)

## Accomplishments
- `packages/core/algorithms/opr.ts` rewritten: `solveRidgeOpr(observations, teamIndex, lambda)` matches RESEARCH.md Pattern 4's signature and is exported; `OPR_RIDGE_LAMBDA`/`OPR_LOGISTIC_SCALE` are exported constants, each with a reasoning comment
- Season-scope pooling made explicit and tested: a team's rating at its second event provably includes its first event's observation (verified by counting matching `OprObservation` entries, not just numeric coincidence)
- `ratingEligibleTeams`/`allianceObservation` resolve D-07's open surrogate-slot question: a surrogate's column never enters the design matrix (no rating update), while its current rating (or the season's league-mean per-team share, if it has none yet) is subtracted from its alliance's target score so teammates aren't inflated by absorbing its share
- Disqualification policy stated and tested as the deliberate opposite of surrogates — keep the column, update the rating — with the reasoning recorded as a comment directly adjacent to `ratingEligibleTeams`
- `packages/core/isomorphic.test.ts` enumerates every non-test source file under `packages/core` and fails if any imports a Node built-in or `better-sqlite3`, and fails vacuously if the enumeration is empty
- Re-ran `pnpm harness --event 2024casj --algorithm opr` end-to-end after the rewrite: identical Brier score (0.2246) and winner accuracy (64.5%) as the tracer, confirming no regression on real data for a single-event run

## Task Commits

Each task was committed atomically (TDD RED/GREEN):

1. **Task 1 RED: failing tests for season-pooled ridge OPR** - `717030f4` (test)
2. **Task 1 GREEN: implement season-pooled, ridge-regularized OPR** - `6925ac23` (feat)
3. **Task 2: surrogate/dq/isomorphic tests** - `3cf4cce5` (test — no separate feat commit, see TDD Gate Compliance below)

**Plan metadata:** pending (this commit)

## Files Created/Modified
- `packages/core/algorithms/opr.ts` - `solveRidgeOpr`, `ratingEligibleTeams`, `allianceObservation`, `OprState`, `OprObservation`, `OPR_RIDGE_LAMBDA`, `OPR_LOGISTIC_SCALE`; `opr` module rewritten around them
- `packages/core/algorithms/opr.test.ts` - Synthetic recovery, cold-start finiteness/shrinkage, cross-event pooling, update/predict purity, margin=0.5, surrogate eligibility, disqualification tests
- `packages/core/algorithms/types.ts` - `UpcomingMatch`'s team-array fields tightened to `readonly string[]`
- `packages/core/isomorphic.test.ts` - New architectural fitness test for the Worker-portability boundary

## Decisions Made
- `types.ts`'s team-array fields tightened to `readonly` as a low-risk, in-scope reinforcement of the module's already-stated purity contract (touched this file for the plan anyway)
- The synthetic-recovery fixture uses 8 teams and all 56 three-team combinations rather than a smaller hand-picked set — empirically necessary to keep ridge bias (at the fixed production `lambda=3`) under a defensible tolerance; documented in the test's own comment
- Task 1 and Task 2's stated deliverables (`ratingEligibleTeams`/`allianceObservation`) were implemented together in Task 1's GREEN commit, since both live in the same `update()`/`predict()` rewrite; Task 2's commit is test-only, matching the precedent already documented in `01-02-SUMMARY.md`'s TDD Gate Compliance section for this exact task shape (implementation already correct, no RED phase possible)

## Deviations from Plan

None - plan executed exactly as written. The apparent "early" implementation of Task 2's `ratingEligibleTeams`/`allianceObservation` inside Task 1's commit is not a deviation from scope (both functions are explicitly named as Task 1's `<files_modified>` output for `opr.ts`, and the plan's own `Artifacts this phase produces` section lists them without a task-1/task-2 split) — it is a consequence of both tasks sharing the same `update()`/`predict()` call sites, documented above as a Decision rather than an unplanned fix.

## Issues Encountered
- Initial synthetic-recovery test fixture (6 teams, 12 hand-picked alliances) produced a ridge-bias error up to ~9.2 points per team against the fixed production `lambda=3` — too loose to be a meaningful "known-answer" test. Resolved by switching to 8 teams with the full 56-combination round-robin, empirically measured to bring the worst-case error under 3 points, and setting the documented tolerance to 4. This was fixture-tuning, not a defect in `solveRidgeOpr` itself (confirmed by testing the same solver against the smaller fixture and observing the expected, larger ridge bias).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- OPR is now a defensible, tested baseline (season-pooled, ridge-regularized, surrogate/dq policy resolved) — Plan 05/06's EPA baseline and harness/report expansion can be scored against it with confidence the numbers mean something
- `packages/core/isomorphic.test.ts` is now the standing guard against Phase 4's Worker-portability requirement drifting silently; any future `packages/core` addition that imports a Node built-in will fail this test immediately
- No blockers identified for Plan 05

---
*Phase: 01-data-foundation-evaluation-harness*
*Completed: 2026-08-13*

## Self-Check: PASSED

All 4 files confirmed present on disk (`opr.ts`, `opr.test.ts`, `types.ts`, `isomorphic.test.ts`). All three task commit hashes (`717030f4`, `6925ac23`, `3cf4cce5`) confirmed present in `git log`. Full test suite (`pnpm vitest run`) passes 57/57 across 6 files; `pnpm typecheck` passes with zero errors. Real-data sanity check (`pnpm harness --event 2024casj --algorithm opr`) reproduces the tracer's Brier score (0.2246) and winner accuracy (64.5%) with no regression.
