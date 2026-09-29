---
phase: 02-prediction-models-epa-sigma1
plan: 01
subsystem: algorithms
tags: [epa, opr, walk-forward, welford, zod, vitest, sqlite]

# Dependency graph
requires:
  - phase: 01-corpus-and-harness
    provides: WalkForwardSimulator, leak-proof MatchResult Proxy, artifact/report writers, corpus SQLite with score_breakdown_raw
provides:
  - "AlgorithmModule contract carrying teamMetrics, ComponentPrediction, TeamMetrics, SeasonBoundary/carrySeason (D-27)"
  - "Walk-forward EPA implementation with two-stage EWMA and decaying clamped learning rate"
  - "2024 season component map, Zod-validated, parsed out of score_breakdown_raw"
  - "Shared-stream multi-algorithm replay (runAll) giving every algorithm a byte-identical match sequence (D-22)"
  - "Artifact schema v2: top-level algorithms[], per-slice algorithmId (D-20, D-21)"
  - "Numerically-stable expanding stats (Welford) for leak-free running variance"
affects: [02-02, 02-03, 02-04, 02-05, 02-06, phase-04-publishing, phase-08-compare-page]

actuals:
  tokens: 106000
  tasks: 4
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Per-season component maps behind a registry keyed by season year"
    - "Welford single-pass variance instead of sum-of-squares"
    - "One leak-proof wrapper per match shared across all algorithms in a run"

key-files:
  created:
    - packages/core/algorithms/epa.ts
    - packages/core/algorithms/breakdown/2024.ts
    - packages/core/algorithms/breakdown/index.ts
    - packages/core/scoring/expandingStats.ts
    - packages/core/algorithms/epa.test.ts
    - packages/core/scoring/expandingStats.test.ts
    - packages/harness/replay.multiAlgorithm.test.ts
  modified:
    - packages/core/algorithms/types.ts
    - packages/core/algorithms/opr.ts
    - packages/corpus/db.ts
    - packages/harness/replay.ts
    - packages/harness/score.ts
    - packages/harness/artifact.ts
    - packages/harness/report.ts
    - packages/harness/cli.ts

key-decisions:
  - "Artifact schema v2 puts algorithms[] at top level and algorithmId on every slice; algorithmId/algorithmVersion removed from provenance (D-20/D-21)"
  - "runAll builds exactly one toLeakProofUpcoming(result) per match and shares that reference across the per-algorithm loop, making D-22's identical-inputs guarantee observable rather than assumed"
  - "scoreBreakdownRaw added to OUTCOME_KEYS so it throws if read inside predict()"
  - "EPA cold-start seed EPA_INIT_COMPONENT_TOTAL is a fixed documented placeholder, not a conversion of normalized-rating constants into season point units"
  - "Component alliance totals are split evenly across rating-eligible teammates; TBA breakdowns are alliance-level only this phase (Assumption A1)"
  - "Per-robot breakdown fields are forbidden this phase and guarded by a /Robot[123]$/ assertion, since positional correspondence to red_teams/blue_teams order is unverified"

patterns-established:
  - "Tracer-first execution: one thin vertical slice proven end-to-end and human-reviewed before breadth is built on its contracts"
  - "Divergences from Statbotics are named in test titles (D-08), not only in code comments, so they surface in test output"
  - "Leakage regression shape: capture a statistic after k observations, fold more, assert the captured value still equals a fresh fold of only the first k"

requirements-completed: [ALGO-02, ALGO-07]

coverage:
  - id: D1
    description: "score_breakdown_raw reaches an algorithm's update() as MatchResult.scoreBreakdownRaw, and reading it inside predict() throws through the leak-proof Proxy"
    requirement: ALGO-02
    verification:
      - kind: unit
        ref: "packages/harness/replay.test.ts#outcome-key leak guard (it.each table incl. scoreBreakdownRaw)"
        status: pass
    human_judgment: false
  - id: D2
    description: "One run drives OPR and EPA over a shared chronological match stream; both observe an identical, reference-identical match sequence"
    requirement: ALGO-07
    verification:
      - kind: unit
        ref: "packages/harness/replay.multiAlgorithm.test.ts#interleaved shared-stream call log"
        status: pass
    human_judgment: false
  - id: D3
    description: "Artifact schema v2 — schemaVersion 2, top-level algorithms[] with {id,version}, non-empty algorithmId on every slice"
    requirement: ALGO-07
    verification:
      - kind: unit
        ref: "packages/harness/artifact.test.ts#buildArtifact with two algorithms"
        status: pass
      - kind: integration
        ref: "node -e assertions over reports/tracer/artifact.json (Task 4 verify block) — printed 'ok [epa, opr]'"
        status: pass
    human_judgment: false
  - id: D4
    description: "Walk-forward EPA: two-stage EWMA, decaying clamped learning rate, D-08 elim divergence, win-probability scale from standardDeviation/(-EPA_K*ln10)"
    requirement: ALGO-02
    verification:
      - kind: unit
        ref: "packages/core/algorithms/epa.test.ts (incl. explicit D-08-titled test)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Welford expanding stats are leak-free — a prefix's standardDeviation is unchanged by folding later observations"
    requirement: ALGO-02
    verification:
      - kind: unit
        ref: "packages/core/scoring/expandingStats.test.ts#leakage regression"
        status: pass
    human_judgment: false
  - id: D6
    description: "Real 2024 replay produces one artifact holding both algorithms' scores, with OPR unchanged from the Phase 1 baseline and EPA's values real rather than cold-start constants"
    requirement: ALGO-07
    verification:
      - kind: integration
        ref: "pnpm harness --season 2024 --algorithm opr,epa --out reports/tracer"
        status: pass
    human_judgment: false
  - id: D7
    description: "EPA's cold-start seeding and even per-team attribution are sound enough to build 02-02 through 02-06 on"
    verification: []
    human_judgment: true
    rationale: "EPA_INIT_COMPONENT_TOTAL is a documented placeholder and per-team attribution is an even split; both are modelling judgments that tests cannot adjudicate, and both feed every downstream comparison number."

duration: 62min
completed: 2026-08-13
status: complete
---

# Phase 02 Plan 01: End-to-End Tracer Summary

> **Superseded by Phase 3.2 (2026-08-21):** OPR became event-scoped and qualification-matches-only;
> every OPR figure below describes the retired season-pooled baseline. The original numbers are left
> intact as the execution record of what this plan actually measured — see
> `docs/models/opr-baseline-change.md` for the current baseline and both SC-3 verdicts.

**A 2024 match's `score_breakdown` now flows through a real walk-forward EPA, OPR and EPA replay one shared match stream, and a schema-v2 artifact carries both algorithms' 2024 numbers side by side — OPR reproducing its Phase 1 baseline to five decimal places.**

## Performance

- **Duration:** ~62 min (across one checkpoint and one session-limit interruption)
- **Tasks:** 4
- **Files modified:** 21 across 2 commits

## Accomplishments

- **The pipe is real, not stubbed.** `score_breakdown_raw` travels corpus row → `MatchResult.scoreBreakdownRaw` → 2024 component map → EPA's `update()`, and throws if read inside `predict()`.
- **Two algorithms, one stream.** `runAll` builds exactly one leak-proof wrapper per match and shares that reference across the per-algorithm loop — D-22's identical-inputs guarantee is now observable in a test, not assumed.
- **Artifact v2 shipped** with top-level `algorithms[]` and per-slice `algorithmId` — the contract Phase 4 publishes and Phase 8's Compare page reads.
- **OPR regression-clean.** The multi-algorithm refactor left OPR's 2024 combined Brier at 0.16872 against a Phase 1 baseline of 0.1687 (Δ 0.00002) and winner accuracy at 0.75014 against 0.7501 (Δ 0.00004).
- **Test suite 116 → 143** across 15 files, with typecheck clean.

## Task Commits

1. **Task 1: End-to-end tracer** — `3d5f7c0c` (feat)
2. **Task 2: Tracer review gate** — checkpoint only, human-approved, no commit
3. **Task 3: Regression tests** — `7cf4d104` (test)
4. **Task 4: Real 2024 head-to-head run** — no source commit; outputs are gitignored per D-26

## Measured Results — 2024, both algorithms

Recorded here so plan 02-06's full-range run has a single-season reference point.

| Algorithm | View | Brier | Winner acc. | scoredCount | noCall |
|---|---|---|---|---|---|
| opr | combined | 0.168720 | 0.750137 | 16958 | 301 |
| opr | qualification | 0.165361 | 0.756246 | 14091 | 301 |
| opr | elimination | 0.185229 | 0.721077 | 2867 | 0 |
| epa | combined | 0.204051 | 0.707299 | 16958 | 330 |
| epa | qualification | 0.204223 | 0.709404 | 14091 | 330 |
| epa | elimination | 0.203203 | 0.697309 | 2867 | 0 |

Run: 17,029 matches replayed, 16,958 scorable, 71 excluded (all `surrogateAffected`). Identical replay/scorable/excluded counts for both algorithms — the shared-stream guarantee holding at season scale.

**Read this correctly: EPA is currently worse than OPR (0.2041 vs 0.1687 Brier), and that is not a failure of this plan.** Per the plan's explicit instruction, no "EPA must beat OPR" gate was added — this phase exists to make the comparison possible, and tuning is Phase 3's work. EPA here is untuned, cold-started from a placeholder constant, and attributing components by even split. The number to carry forward is that EPA's values are *real and moving* (calibration bins span 0.065→… with observed frequencies tracking predictions), not pinned at a cold-start constant — which is RESEARCH.md Pitfall Harness-1's named warning sign for a silent wiring gap.

## Decisions Made

- Artifact v2 shape locked before Phase 4 publishes against it, since changing it later costs a migration rather than a re-run.
- Divergence from Statbotics is surfaced in test titles (D-08), not only comments, so it appears in test output.
- Per-robot breakdown fields are forbidden this phase and actively guarded, because their positional correspondence to `red_teams`/`blue_teams` order is unverified (Assumption A1).

## Deviations from Plan

### 1. [Rule 3 — Blocking build fix] Test files edited a task early

- **Found during:** Task 1
- **Issue:** Task 1's acceptance criteria require a repo-wide clean `pnpm typecheck`, but rewriting the affected test files is Task 3's assignment. New required fields (`algorithmId`, `predictedRedScore`, `predictedBlueScore`, `teamMetrics`, `scoreBreakdownRaw`) broke compilation in six test files.
- **Fix:** Minimal compile-preserving edits only — no new regression scenarios, which stayed in Task 3.
- **Note:** Two of the six (`opr.test.ts`, `replay.season.test.ts`) are not in the plan's `files_modified` list at all.
- **Committed in:** `3d5f7c0c`

### 2. [Discretion] EPA cold-start seed is a documented placeholder

- **Issue:** No season point scale exists at cold start, so normalized-rating constants cannot be converted into point units then. RESEARCH.md left the exact conversion undetermined.
- **Fix:** `EPA_INIT_COMPONENT_TOTAL` is a fixed constant, commented inline in `epa.ts` as a simplification rather than a derivation.
- **Carries risk:** this is the assumption most able to quietly distort 02-06's head-to-head numbers.

### 3. [Discretion] Even per-team component attribution

- **Issue:** TBA breakdowns are alliance-level only this phase, so a component's alliance total needs splitting across teams with no per-robot signal available.
- **Fix:** Even split across rating-eligible teammates, documented inline. No Statbotics analog applies, since this project's component extraction differs.

### 4. [Observation, not a change] Match count below plan estimate

- The plan estimated ~22,000 played 2024 matches; the corpus holds 17,029. Runtime was well under the projected multi-minute worst case. Worth noting for 02-06's full-range runtime budgeting.

---

**Total deviations:** 1 blocking auto-fix, 2 documented discretionary modelling choices, 1 observation
**Impact on plan:** No scope creep. The two discretionary choices are modelling judgments this phase was not equipped to settle and are flagged for human review (coverage D7).

## Issues Encountered

- **Session-limit interruption during Task 4.** A continuation agent was cut off mid-Task-4 by an API session limit. No work was stranded — Task 3 had already committed atomically and the working tree was clean. Task 4 was completed inline afterward.
- **Worktree isolation auto-degraded (#683).** Local HEAD had diverged from `origin/HEAD`, so GSD forced sequential execution on the main working tree instead of parallel worktrees.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Ready.** The contracts 02-02 through 02-06 build on are all live and tested: the `AlgorithmModule` shape, the season-map registry (`breakdown/index.ts`, awaiting 2022/2023/2025/2026 from 02-02), the shared-stream `runAll` loop, and artifact v2.

**Carry forward:**
- Plan 02-02 must reconcile its new season maps against alliance `totalPoints` and handle the 1,517 breakdown-less matches; the 2024 map is the reference implementation.
- Plans 02-03/02-04 inherit `SeasonBoundary`/`carrySeason` on the algorithm contract, currently unexercised.
- Plan 02-06 should sanity-check its full-range figures against the 2024 single-season table above.
- **Open judgment call:** EPA's cold-start seeding and even attribution (coverage D7) remain unadjudicated and affect every comparison number this phase produces.

---
*Phase: 02-prediction-models-epa-sigma1*
*Completed: 2026-08-13*
