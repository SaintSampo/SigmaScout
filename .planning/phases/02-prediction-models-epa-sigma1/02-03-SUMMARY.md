---
phase: 02-prediction-models-epa-sigma1
plan: 03
subsystem: algorithms
tags: [epa, carryover, walk-forward, harness, html-report, vitest]

# Dependency graph
requires:
  - phase: 02-prediction-models-epa-sigma1
    provides: "AlgorithmModule contract with SeasonBoundary/carrySeason (D-27), EPA walk-forward core, artifact schema v2, per-season component maps (02-01, 02-02)"
provides:
  - "carryover.ts: epaCarryover/carryNormalizedRating/normalizedToSeasonUnits — D-16's parameterized cross-season carry, plus EPA_NORM_MEAN/EPA_NORM_SD/EPA_INIT_PENALTY/EPA_MEAN_REVERSION/EPA_CARRY_LAST_YEAR_WEIGHT/EPA_CARRY_PRIOR_YEAR_WEIGHT/EPA_ROOKIE_BASELINE"
  - "epa.carrySeason implemented on the AlgorithmModule, threading EpaState.priorSeasonRatings and seeding the new season's expanding-window SD from the prior season's final value"
  - "breakdown/index.ts's isColdStartSeason(season) — the one D-19 cold-start comparison point"
  - "cli.ts runSeasons threads live algorithm state across every season boundary via carrySeason, with a --cold-start-season override flag"
  - "WalkForwardSimulator.runAll accepts initialStates and returns each algorithm's finalStates"
  - "report.ts renderHeadToHeadTable (SC-1's one comparable table) and renderStatboticsCaveat (D-15's loud unverified marker)"
  - "breakdown/constants.ts — dependency-free leaf module fixing a pre-existing (02-02) circular import between breakdown/index.ts and every season file"
affects: [02-04, 02-05, 02-06, phase-03-hyperparameter-tuning, phase-04-publishing]

actuals:
  tokens: 21430
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Season-boundary math split from state-shape adaptation: carryover.ts's epaCarryover is pure and EpaState-agnostic; epa.carrySeason is the thin adapter reshaping it into EpaState's fields"
    - "Array-with-attached-property return shape (Object.assign(records, { finalStates })) to add data to a function's return value without breaking every existing caller's array-typed usage"
    - "Entry-point guard (import.meta.url === pathToFileURL(process.argv[1]).href) so a CLI script's internals can be unit-tested by import without triggering its own main()"

key-files:
  created:
    - packages/core/algorithms/carryover.ts
    - packages/core/algorithms/carryover.test.ts
    - packages/core/algorithms/breakdown/constants.ts
    - packages/harness/cli.season-carry.test.ts
  modified:
    - packages/core/algorithms/epa.ts
    - packages/core/algorithms/epa.test.ts
    - packages/core/algorithms/breakdown/index.ts
    - packages/core/algorithms/breakdown/2022.ts
    - packages/core/algorithms/breakdown/2023.ts
    - packages/core/algorithms/breakdown/2024.ts
    - packages/core/algorithms/breakdown/2025.ts
    - packages/core/algorithms/breakdown/2026.ts
    - packages/core/algorithms/breakdown/fallback.ts
    - packages/harness/cli.ts
    - packages/harness/replay.ts
    - packages/harness/report.ts
    - packages/harness/report.test.ts

key-decisions:
  - "carryover.ts owns EPA_NORM_MEAN/EPA_NORM_SD/EPA_INIT_PENALTY/EPA_MEAN_REVERSION (moved from epa.ts, re-exported there) — the only acyclic direction, since epa.carrySeason needs carryover.ts's epaCarryover and the reverse would be a circular import that breaks at module-init time"
  - "epaCarryover sources the normalized<->points conversion scale from the OUTGOING season's own per-team point-total mean/sd (population stats), since the incoming season has no observations yet at a boundary — a documented approximation in the same spirit as 02-01's EPA_INIT_COMPONENT_TOTAL placeholder"
  - "allianceScoreStats carries forward UNCHANGED (not reset) inside epa.carrySeason itself, satisfying RESEARCH.md's 'seed the expanding-window SD from the prior season's final value' at the one place the season boundary is already handled — the harness season loop needed no second boundary hook for it"
  - "OPR is deliberately left out of runSeasons' initialStates map every season (no carrySeason) — WalkForwardSimulator.runAll falls back to initState for any missing algorithm id, reproducing Phase 1's per-season-fresh-start behavior for OPR by design, not by omission"
  - "The head-to-head table replaces (not supplements) the old per-algorithm score table — folding avoids the same Brier/accuracy figure ever appearing twice at two different groupings that could silently drift apart"
  - "SC-2 (Statbotics per-team numeric tolerance) is recorded blocked-on-external-dependency per D-14, not attempted — Statbotics' API still reproducibly returns HTTP 500 (re-confirmed live this session, 2026-08-14)"

patterns-established:
  - "Pure season-boundary math (epaCarryover) kept separate from and testable independently of the AlgorithmModule state shape it eventually feeds — Sigma1's own carrySeason (a later plan) can follow the same split"
  - "T-02-08-style leakage regression: run the same range two ways (combined vs. solo) and assert the overlapping season's output is byte-identical — the same shape as 02-01's shared-stream regression, now applied to season boundaries"

requirements-completed: [ALGO-02]

coverage:
  - id: D1
    description: "carryNormalizedRating/normalizedToSeasonUnits implement D-16's reference shape exactly: 0.7*lastYear + 0.3*yearBefore, 40% reversion toward EPA_ROOKIE_BASELINE (1450), floored at 0 in season point units; a team with no history starts at the rookie baseline"
    requirement: ALGO-02
    verification:
      - kind: unit
        ref: "packages/core/algorithms/carryover.test.ts (all describe blocks)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The cold-start season is a parameter (COLD_START_SEASON / --cold-start-season), never hardcoded 2022 outside breakdown/constants.ts, and carrySeason no-ops on boundary.isColdStart"
    requirement: ALGO-02
    verification:
      - kind: unit
        ref: "packages/core/algorithms/carryover.test.ts#isColdStart short-circuit, #isColdStartSeason"
        status: pass
      - kind: other
        ref: "grep -rn '=== 2022\\|== 2022' packages/core packages/harness --include=*.ts | grep -v '\\.test\\.ts' => no matches"
        status: pass
    human_judgment: false
  - id: D3
    description: "One `pnpm harness --seasons 2022-2023 --algorithm opr,epa --out reports/carry` invocation threads EPA's state across the 2022/2023 boundary (OPR stays per-season by design); console output states 2022 is cold-start and EPA carried state into 2023"
    requirement: ALGO-02
    verification:
      - kind: integration
        ref: "pnpm harness --seasons 2022-2023 --algorithm opr,epa --out reports/carry (real run, exit 0) — printed 'Season 2023 [epa]: ... (carried state in)' and 'Season 2022: cold-start season'"
        status: pass
    human_judgment: false
  - id: D4
    description: "No future season leaks backward across a carrySeason boundary (T-02-08): a 2022-only run's predictions are byte-identical to the 2022 portion of a 2022-2023 run's, for both EPA (carries) and OPR (doesn't)"
    verification:
      - kind: unit
        ref: "packages/harness/cli.season-carry.test.ts#runSeasons — T-02-08"
        status: pass
    human_judgment: false
  - id: D5
    description: "The carry measurably changes EPA's 2023 predictions rather than silently no-opping: 2023 combined Brier with carry (0.199696) differs from a from-scratch 2023-only control run (0.201807)"
    verification:
      - kind: integration
        ref: "reports/carry/artifact.json vs reports/no-carry/artifact.json, epa/2023/combined slice — see Measured Results"
        status: pass
    human_judgment: false
  - id: D6
    description: "The HTML report renders one head-to-head table, one row per (algorithm, season, view), grouped season-first, computing no delta/comparison figure; verified for one-, two-, and three-algorithm artifacts"
    requirement: ALGO-02
    verification:
      - kind: unit
        ref: "packages/harness/report.test.ts#renderHeadToHeadTable — SC-1's one comparable table (D-20/D-21)"
        status: pass
      - kind: integration
        ref: "reports/carry/report.html — 12 rows (2 algorithms x 2 seasons x 3 views), grouped by season"
        status: pass
    human_judgment: false
  - id: D7
    description: "The Statbotics reference row's unverified status is visually loud: an UNVERIFIED-prefixed heading, a warning-styled caveat naming the HTTP 500 evidence, and the fetched field surfaced as a visible column"
    requirement: ALGO-02
    verification:
      - kind: unit
        ref: "packages/harness/report.test.ts#renderStatboticsCaveat — D-15 loud unverified marker"
        status: pass
      - kind: integration
        ref: "reports/carry/report.html contains 'UNVERIFIED — Statbotics reference' and the statbotics-caveat div"
        status: pass
    human_judgment: false
  - id: D8
    description: "SC-2's Statbotics per-team numeric tolerance check is blocked on an external dependency (D-14), not silently skipped — the decision and its evidence are recorded, and EPA's correctness instead rests on synthetic-fixture tests and walk-forward structural proofs"
    verification: []
    human_judgment: true
    rationale: "Whether the synthetic-fixture + structural-proof evidence is an acceptable substitute for a numeric Statbotics comparison is a judgment call about risk tolerance, not something a test can adjudicate — flagged for human review same as 02-01's coverage D7."

duration: ~80min (including two full-corpus harness runs, ~55min wall-clock)
completed: 2026-08-14
status: complete
---

# Phase 02 Plan 03: Season Carryover & Head-to-Head Report Summary

> **Superseded by Phase 3.2 (2026-08-21):** OPR became event-scoped and qualification-matches-only;
> every OPR figure below describes the retired season-pooled baseline. The original numbers are left
> intact as the execution record of what this plan actually measured — see
> `docs/models/opr-baseline-change.md` for the current baseline and both SC-3 verdicts.

**EPA ratings now survive a season boundary through a fully parameterized, tested carry (`carryover.ts`), the harness threads that state across every season in a range via `algorithm.carrySeason`, and the HTML report renders one head-to-head table with a loudly-caveated Statbotics row instead of per-algorithm-only score tables.**

## Performance

- **Duration:** ~80 min total, of which ~55 min was two full-corpus `pnpm harness` runs (2022-2023 combined, and a 2023-only control) executing for real against `data/corpus.sqlite`
- **Tasks:** 3
- **Files modified:** 17 across 3 commits (2 new modules, 2 new test files, 13 modified files)

## Accomplishments

- **Cross-season carry is real, not a stub.** `carryover.ts` implements D-16's reference shape verbatim (verified against Statbotics' `init.py`/`constants.py` in RESEARCH.md): `0.7 × last year + 0.3 × the year before`, 40% reversion toward the rookie baseline (1450 normalized), converted to the new season's point units, floored at 0. Every hyperparameter is a named, doc-commented, Phase-3-tunable constant.
- **The cold-start season is a flag, not a sentinel.** `isColdStartSeason`/`COLD_START_SEASON` (D-19) are the one comparison point; `--cold-start-season` overrides it at the CLI. A grep across `packages/core`/`packages/harness` confirms no other module hardcodes `2022`.
- **One real multi-season run threads state end to end.** `pnpm harness --seasons 2022-2023 --algorithm opr,epa --out reports/carry` completed against the full corpus (14,677 + 16,353 matches): 2022 is logged as the cold-start season, EPA is logged carrying state into 2023, OPR is logged starting cold in every season (season-pooled by design, not a bug). EPA's 2023 combined Brier moved from 0.201807 (a from-scratch 2023-only control run) to 0.199696 with carry enabled — the carry is measurably doing something.
- **T-02-08 (no backward leakage) is a passing regression, not an assertion in a comment.** `cli.season-carry.test.ts` proves a 2022-only run's predictions are byte-identical to the 2022 portion of a 2022-2023 run's, for both EPA (which carries) and OPR (which doesn't) — using a synthetic two-season corpus fixture so the check runs in milliseconds rather than requiring a 30-minute real-corpus rerun on every future change.
- **SC-1's "one comparable table" now exists.** `renderHeadToHeadTable` renders every algorithm's raw numbers in one table, grouped by season so a reader sees every algorithm's figure for that season adjacent, computing no delta or significance figure (D-21). The old per-algorithm score table was removed rather than duplicated alongside it, so a Brier figure has exactly one place it can appear and drift from.
- **D-15's Statbotics caveat is loud, not a footnote.** The section heading reads "UNVERIFIED — Statbotics reference", a warning-styled callout states the dated-constant provenance and the live HTTP 500 evidence (re-confirmed 2026-08-14), and the `fetched` field is a visible table column, not just provenance text.
- **A pre-existing (plan 02-02) circular import was found and fixed.** Every per-season breakdown map imported `ADJUST_COMPONENT`/`FOULS_COMMITTED_COMPONENT` from `breakdown/index.ts`, which itself imports every season file — vitest's transform silently tolerated it, but `tsx`'s real Node ESM loader threw `ReferenceError: Cannot access 'ADJUST_COMPONENT' before initialization` the instant any real `pnpm harness` invocation ran (i.e., every season, always — this had never actually been exercised outside vitest before this task). Fixed by extracting the shared types/constants into a new dependency-free leaf module, `breakdown/constants.ts`.
- Test suite 204 → 210 (net, across this plan's three tasks; some renamed/consolidated), `pnpm typecheck` and `pnpm test` both exit 0.

## Task Commits

1. **Task 1: Parameterized cross-season carry** — `29776b7d` (feat)
2. **Task 2: Thread algorithm state across season boundaries** — `776c0266` (feat)
3. **Task 3: Head-to-head table + Statbotics caveat** — `8a7c0967` (feat)

## Measured Results — 2022-2023, carry vs. no-carry control

| Run | Algorithm | Season | View | Brier | Winner acc. | Scored |
|---|---|---|---|---|---|---|
| `reports/carry` (2022-2023, carry enabled) | epa | 2022 | combined | 0.193571 | 0.734682 | — |
| `reports/carry` (2022-2023, carry enabled) | epa | **2023** | **combined** | **0.199696** | 0.721224 | 16290 |
| `reports/carry` (2022-2023, carry enabled) | opr | 2023 | combined | 0.170611 | 0.750158 | 16290 |
| `reports/no-carry` (2023-only control, no carry) | epa | **2023** | **combined** | **0.201807** | 0.716052 | 16290 |

**EPA's 2023 combined Brier improves from 0.201807 (no carry) to 0.199696 (carry enabled)** — a real, if modest, effect from carrying 2022's ratings forward, on an untuned carry (Phase 3's job). The console log for the combined run confirms the mechanism: `Season 2023 [epa]: 16353 matches replayed, 16290 scorable, 63 excluded (carried state in)` vs `Season 2023 [opr]: ... (started cold)`.

## Files Created/Modified

- `packages/core/algorithms/carryover.ts` — D-16's carry math: `carryNormalizedRating`, `normalizedToSeasonUnits`, `epaCarryover`, and the Statbotics-parity constants (moved here from `epa.ts` to keep the module graph acyclic)
- `packages/core/algorithms/carryover.test.ts` — synthetic-fixture tests for every documented carry behavior
- `packages/core/algorithms/epa.ts` — `EpaState.priorSeasonRatings`, `epa.carrySeason` implemented
- `packages/core/algorithms/epa.test.ts` — updated fixtures for the new `priorSeasonRatings` field
- `packages/core/algorithms/breakdown/constants.ts` — new leaf module (Rule 1 fix): `ParsedComponents`, `SeasonComponentMap`, `FOULS_COMMITTED_COMPONENT`, `ADJUST_COMPONENT`, `COLD_START_SEASON`, `isColdStartSeason`
- `packages/core/algorithms/breakdown/index.ts` — re-exports from `constants.ts`; dispatch table unchanged
- `packages/core/algorithms/breakdown/{2022,2023,2024,2025,2026}.ts`, `fallback.ts` — import from `constants.ts` instead of `index.ts`
- `packages/harness/cli.ts` — `runSeasons` threads carried state across boundaries; `--cold-start-season` flag; `runSeasons` exported behind an entry-point guard for testability
- `packages/harness/replay.ts` — `WalkForwardSimulator.runAll` accepts `initialStates`, returns `finalStates`
- `packages/harness/cli.season-carry.test.ts` — new T-02-08 regression
- `packages/harness/report.ts` — `renderHeadToHeadTable`, `renderStatboticsCaveat`; per-algorithm score table removed
- `packages/harness/report.test.ts` — coverage for the new renderers, updated the one test whose assumption (score data lives per-algorithm) the fold-in changed

## Decisions Made

- `carryover.ts`, not `epa.ts`, owns the four Statbotics-parity constants — the only direction that avoids a circular-import crash at module-init time, since `epa.carrySeason` needs `carryover.ts`'s `epaCarryover`.
- The normalized↔points conversion scale at a season boundary is sourced from the OUTGOING season's own per-team point-total distribution — the same class of documented placeholder as 02-01's `EPA_INIT_COMPONENT_TOTAL`, since the incoming season has no observations yet.
- `allianceScoreStats` is carried forward unchanged inside `epa.carrySeason` itself (not a separate hook in `cli.ts`), satisfying RESEARCH.md's expanding-window-SD seeding requirement at the one place the boundary is already handled.
- The head-to-head table REPLACES the per-algorithm score table rather than duplicating it — one home per figure.
- SC-2 (Statbotics per-team numeric tolerance) is recorded **blocked on an external dependency** per D-14: `api.statbotics.io/v3/year/{year}` still reproducibly returns HTTP 500 (re-confirmed live 2026-08-14, same day this task ran), and the website is a client-rendered shell fed by the same dead API. EPA's correctness instead rests on `epa.test.ts`/`carryover.test.ts`'s hand-computed synthetic fixtures and the walk-forward structural proofs (leak-proof Proxy, T-02-08's byte-identical-prefix regression). This is an accepted decision (D-14), not an oversight — SC-2 stays worded as-is in ROADMAP.md, marked blocked.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Circular import between `breakdown/index.ts` and every season file broke every real `pnpm harness` invocation**

- **Found during:** Task 2, first real `pnpm harness --season 2022 --algorithm opr,epa` smoke test (required to exercise Task 2's `<verify>` block)
- **Issue:** `breakdown/2022.ts`/`2023.ts`/`2025.ts`/`2026.ts` imported `ADJUST_COMPONENT`/`FOULS_COMMITTED_COMPONENT` from `breakdown/index.ts`, while `index.ts` imports every season file to build its dispatch table — a circular dependency. `vitest`'s esbuild-based transform tolerated it silently; `tsx`'s real Node ESM loader does not, throwing `ReferenceError: Cannot access 'ADJUST_COMPONENT' before initialization` the moment any season's breakdown map loaded — i.e., every real harness invocation, for every season, unconditionally. This bug predates this plan (introduced in 02-02) but had never been exercised outside `vitest` before this task's `<verify>` block required a real `pnpm harness` run.
- **Fix:** Extracted the shared types/constants (`ParsedComponents`, `SeasonComponentMap`, `FOULS_COMMITTED_COMPONENT`, `ADJUST_COMPONENT`, `COLD_START_SEASON`, `isColdStartSeason`) into a new dependency-free leaf module, `breakdown/constants.ts`. `index.ts` and every season file now both import from `constants.ts`, never from each other — acyclic by construction.
- **Verification:** `pnpm harness --season 2022 --algorithm opr,epa --out reports/pretest3` and the full `--seasons 2022-2023` run both completed with exit 0 after the fix; full test suite (210 tests) still green.
- **Committed in:** `776c0266` (Task 2 commit)

**2. [Rule 2 — Missing critical functionality, threat-model mandated] T-02-08's regression test did not exist**

- **Found during:** Task 2, reviewing the plan's own `<threat_model>` before implementing `cli.ts`'s season loop
- **Issue:** The threat register assigns T-02-08 (Tampering, `cli.ts` season loop, high severity, disposition `mitigate`) explicitly requiring "a test asserts a 2022-2023 run's 2022 predictions are byte-identical to a 2022-only run's, proving no future season leaked backward" — this test did not exist anywhere in the codebase.
- **Fix:** Added `packages/harness/cli.season-carry.test.ts` with a synthetic two-season corpus fixture, proving the byte-identical-prefix property for both EPA (which carries state) and OPR (which doesn't), plus a third test proving EPA's carry has a measurable effect. Required exporting `runSeasons` from `cli.ts` and adding an entry-point guard (`import.meta.url === pathToFileURL(process.argv[1]).href`) so importing the module for testing never triggers a real `main()` run.
- **Files modified:** `packages/harness/cli.ts` (export + guard), `packages/harness/cli.season-carry.test.ts` (new)
- **Verification:** 3 new tests pass; the guard was verified not to break `pnpm harness`'s normal invocation (`pnpm harness` with no args still correctly errors "`--algorithm is required`" rather than silently doing nothing).
- **Committed in:** `776c0266` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking bug pre-dating this plan, 1 threat-model-mandated missing test)
**Impact on plan:** No scope creep — both fixes were required for Task 2's own `<verify>` block (a real `pnpm harness` invocation) to run at all, and the second is an explicit, named requirement of the plan's own threat model.

## Issues Encountered

- **The two required full-corpus harness runs (`--seasons 2022-2023` and the `--season 2023` no-carry control) took ~16-23 minutes each under `tsx`** — OPR's incremental O(n²)-per-match solve at real corpus scale (14,677-16,353 matches, thousands of teams) is expensive under an interpreted/transpiled runtime with no ahead-of-time compilation. This matches `opr.ts`'s own documented cost model (~15-30ms per update at n≈3,700 teams), not a regression introduced by this plan — verified by first isolating a single-season smoke test before committing to the full two-season run. Worth flagging for Phase 3/4 planning: a full `2022-2026` backtest run under `tsx` could take on the order of an hour or more.
- **A Windows-Bash `kill -0 <pid>` false-negative** briefly made a still-running background harness process look exited; recovered by switching to `Get-Process`-based polling for subsequent waits. No impact on the actual run or its output — an operational note only, not a code defect.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Ready.** Every contract 02-04 onward needs is live: `EpaState.priorSeasonRatings`, `epa.carrySeason`, `carryover.ts`'s reusable `epaCarryover`/`carryNormalizedRating`/`normalizedToSeasonUnits` pattern (Sigma1's own `carrySeason`, a later plan, can follow the same pure-math/thin-adapter split), and the harness season loop's `initialStates`/`finalStates` threading (already generic across any `AlgorithmModule`, not EPA-specific).

**Carry forward:**
- Sigma1 (Kalman-filter family, a later plan) needs its own `carrySeason` — D-17 requires its consistency estimate carry with its own decay parameter, following the same shape this plan established for EPA.
- Plan 02-06's full `2022-2026` run should budget real wall-clock time generously given this plan's measured ~16-23 min/season under `tsx` — consider whether a compiled build (rather than `tsx`'s on-the-fly transpile) is worth investigating before that run, though that's explicitly out of this plan's scope.
- **Open judgment call carried forward (coverage D8, same shape as 02-01's D7):** SC-2's Statbotics per-team tolerance check remains blocked on Statbotics' API outage, re-confirmed live this session. EPA's correctness rests on synthetic-fixture tests and walk-forward structural proofs instead — flagged for human review, not silently treated as adjudicated.
- `ALGO-02` stays marked complete in `REQUIREMENTS.md` (continues, does not newly complete, prior plans' work).

---
*Phase: 02-prediction-models-epa-sigma1*
*Completed: 2026-08-14*

## Self-Check: PASSED

All 9 spot-checked created/modified files verified present on disk; all 3 task commit hashes (`29776b7d`, `776c0266`, `8a7c0967`) verified present in `git log --oneline --all`.
