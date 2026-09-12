---
phase: quick-260912-2uz
plan: 01
subsystem: ranking-points
tags: [negative-binomial, marginal-family, rp-calibration, measurement, selection-slice]
requires:
  - packages/core/rankingPoints/analyticPmf.ts (clauseProbability family derivation, quick task 260911-w7k)
  - data/corpus.sqlite (read-only)
provides:
  - MarginalFamily two-member union with negative-binomial restored under test
  - scripts/measureRpCalibration.ts --marginal-arm measurement seam
  - selection-slice re-test result for the 09-06 marginal-family verdict
affects:
  - docs/models/rp-attribution.md (its 09-06 verdict is re-opened but NOT edited)
tech-stack:
  added: []
  patterns:
    - variant rule module as a measurement seam, in place of a production config object
    - structural CLI guard that refuses rather than trims a forbidden season range
    - in-flight per-bonus observation-count equality assertion across arms
key-files:
  created: []
  modified:
    - packages/core/rankingPoints/constants.ts
    - packages/core/rankingPoints/marginals.ts
    - packages/core/rankingPoints/marginals.test.ts
    - packages/core/rankingPoints/analyticPmf.ts
    - packages/core/rankingPoints/analyticPmf.test.ts
    - scripts/measureRpCalibration.ts
    - scripts/measureRpCalibration.test.ts
    - .planning/todos/pending/restore-negative-binomial-to-retest-it.md
decisions:
  - "PATH B taken: a real gain on the reachable cells, so the task stops and hands back rather than closing the question."
  - "Nothing promoted. All 34 season-module declarations stay gaussian; rp-attribution.md keeps its 09-06 verdict unedited; the todo stays pending."
  - "familyForClauseSum gets an explicit throwing negative-binomial case naming closure under scaled addition — the guard is stronger after this task, never weaker."
  - "A bonus with one reachable clause and one blocked clause is PARTIALLY REACHABLE, not unreachable — corrected after the measurement's own consistency check caught the original classification."
metrics:
  duration: ~35 min
  completed: 2026-09-12
status: complete
actuals:
  tokens: 61000
  tasks: 3
  commits: 4
---

# Quick Task 260912-2uz: restore negative binomial to retest it — Summary

Restored the deleted `"negative-binomial"` marginal family under test, built a measurement-only
arm seam, and re-ran plan 09-06's marginal-family attribution on the selection slice — reaching
24 of 33 cells where the original run reached 0. The result is a real gain (pooled Brier
-0.002898 over 510,838 reachable observations), so the task stopped and handed back rather than
closing the question, per the recorded decision.

## What Was Built

### Task 1 — the family restored, provably inert in production (`5aee48ad`)

`MarginalFamily` is a two-member union again. Everything came back **verbatim from `2731bfab`**,
not rewritten from memory: `NB_MAX_TAIL_TERMS`, `nbTailSum`, `nbMode`, `negativeBinomialAtLeast`
(the log-space recurrence, the lower-sum-then-switch ordering that avoids catastrophic
cancellation, the bounded tail loop), `fitMarginal`'s fourth rung and its `non-positive-mean` /
`variance-le-mean` fallback reasons, `FittedMarginal`'s `r`/`p`, `probAtLeast`/`probAtMost`'s NB
arms, and `MarginalResolutionTally`'s `negativeBinomial` counter.

**`familyForClauseSum`'s guard came out stronger.** Growing the union broke its `never`
exhaustiveness arm at compile time — exactly as designed — and the answer was an explicit
`case "negative-binomial":` that THROWS, naming closure under scaled addition as the violated
precondition. No Gaussian fallback for NB clause sums was added; that fallback is the precise
hardcode (260911-w7k) whose removal made this re-test possible. The `never` default survives, so
a future THIRD family still fails to compile until someone answers the same question.

`packages/harness/sigmaScoutLayer.ts` needed **no edit**: it already threads its tally into the
pmf call and returns a spread copy, so the restored `accumulateMarginalResolution` arm is on the
path and `rpMarginalResolutionTally` carries the new field automatically. Confirmed rather than
changed.

Also converted `analyticPmf.test.ts`'s `"negative-binomial" as unknown as MarginalFamily` cast to
a real union member — the cast's own comment said to do exactly this once a second family landed.

### Task 2 — the measurement-only arm seam (`38af1bbc`)

`--marginal-arm` scores a second arm off ONE replay through ONE scorer.

- **The slice guard is structural.** `assertMarginalArmSliceAllowed` reads the PARSED season list —
  before the rule-module filter, before `openCorpusReadOnly`, before any replay — and throws on any
  season at or above 2023. A spec that merely *spans* the reporting slice is REFUSED, not silently
  trimmed. No override flag, and a test asserts none exists.
- **The partition is derived at runtime** from `ruleModule.bonusPredicates`, never pasted from the
  context table. `clausesOf` is exhaustive over the seven predicate kinds with a `never` default, so
  an eighth kind fails to compile rather than silently widening reach.
- **The arms multiply layers, never replays.** One `buildSeasonStream` and one
  `WalkForwardSimulator.runAll` per season; both layers constructed with TWO arguments; both scored
  by the same `brier`/`rate`/`meanPredicted` helpers. Structural tests pin all three (two layer
  constructions both carrying an algorithm id, one replay, one of each scoring helper).
- **Per-bonus observation counts asserted equal in flight**, throwing on inequality.

### Task 3 — the measurement (`47c92185`)

Ran 2016, 2017, 2018, 2019, 2020, 2022 across opr/epa/bpr.

## The Result — three categories, never pooled

| Category | Cells | Result |
|---|---|---|
| **REACHABLE** | **24 of 33** | 21 improved / 3 regressed / 0 tied |
| **STRUCTURALLY UNREACHABLE** | 9 of 33 | all exactly identical to control, as predicted |
| **FALLBACK TIES** | **0 of 24** | every reachable cell moved |

The 9 unreachable cells, with their reasons: 2017 `kPa` and `rotor` × 3 algorithms
(`linearCombination`, no clause honours a declared family — every clause is a scaled sum), and
2019 `completeRocket` × 3 (`constant false` predicate, structurally inert, reads no threshold
variable). These tie **by construction** and are never evidence about the family.

**Reach was 24 of 33 against the 09-06 run's 0.** That is the structural headline: the original
verdict was taken on a run in which no selection-slice cell could have moved.

### Magnitude, observation-weighted over reachable cells only

| Algorithm | n | control Brier | NB Brier | delta |
|---|---|---|---|---|
| opr | 162,072 | 0.245071 | 0.242080 | **-0.002991** |
| epa | 162,072 | 0.245071 | 0.242080 | **-0.002991** |
| bpr | 186,694 | 0.236809 | 0.234074 | **-0.002735** |
| **all three** | **510,838** | **0.242052** | **0.239154** | **-0.002898** (-1.20% relative) |

Per-bonus (bpr): 2018 `autoQuest` -0.009615, 2016 `capture` -0.006863, 2019 `habDocking`
-0.002489, 2020 `shieldOperational` -0.001945, 2018 `faceTheBoss` -0.001372, 2016 `breach`
-0.000898, 2022 `cargoBonus` -0.000312, and **2022 `hangarBonus` +0.002864 — the one regression,
consistent across all three algorithms.**

### NB resolution fraction

**35.78%** of the NB arm's 1,295,666 fits genuinely resolved to negative binomial. The rest fell
back to Gaussian on non-positive mean or under-dispersion. The gain is therefore produced by
roughly a third of the fits, and that belongs beside the Brier numbers rather than behind them.
Control arm for comparison: `negativeBinomial=0  gaussian=1,238,877  degenerate=56,789`.

## Exit Path Taken: PATH B

**A real gain on the reachable cells, so the task STOPS and hands back.** Per CONTEXT D-1, a
selection-slice result cannot promote anything on its own — that is the entire purpose of the
slice split.

Consequently:
- **No 2023-2026 figure was produced at any point.** The guard makes it impossible, and it was
  verified firing: `--seasons 2016-2026` is refused with a message citing the recorded decision,
  before the corpus opens.
- No season module declaration changed. All 34 still say `"gaussian"` (asserted in test).
- `docs/models/rp-attribution.md` keeps its 09-06 verdict **unedited**.
- `data/baselines/rp-attribution-2026-09.json` is **untouched**; its digest sync test is green.
- The todo stays **pending**, with a STATUS section recording the measurement and the open
  decisions.

Under both paths the Task 1 and Task 2 code changes stay in the tree, so this is re-runnable:

```
npx tsx scripts/measureRpCalibration.ts --marginal-arm --seasons 2016,2017,2018,2019,2020,2022
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] A partially-reachable bonus was classified unreachable (`7cab6632`)**

- **Found during:** Task 3's first measurement run — by the in-flight consistency check, not by
  reading the code.
- **Issue:** `deriveMarginalArmEligibility` required EVERY clause of a bonus to honour the declared
  family before marking it reachable. The first run therefore reported 2016 `capture` as a
  STRUCTURALLY UNREACHABLE cell whose Brier had nonetheless moved, on all three algorithms, and
  flagged it `UNEXPECTEDLY DIFFERS`.
- **Diagnosis:** it had moved, and legitimately. `capture` is a `conjunctionDistinct` whose FIRST
  clause is `attackedTowerEndStrength <= T` — a single unscaled term over an eligible variable,
  honoured through `clauseProbability`'s single-term reuse path — while its SECOND clause is the
  scaled sum over `teleopChallengePoints`/`teleopScalePoints` that correctly derives Gaussian. The
  correct condition is that AT LEAST ONE clause honours the declaration, not all of them.
- **Fix:** three-way classification — fully reachable, PARTIALLY reachable (with both the honouring
  and the blocked variables named), or unreachable. The variable-level eligibility rule is
  unchanged and still math-forced; only the bonus-level summary derived from it was wrong.
- **Impact:** reach is 24 of 33, not 21. The old classification understated reach and would have
  buried three genuinely-moving cells — including 2016 `capture`, the largest 2016 gain — inside
  the category that is supposed to tie by construction. That is the exact pooling error that made
  the 09-06 verdict worthless, so catching it mattered more than the three cells.
- **Note for the record:** this means **CONTEXT D-4's table is wrong about 2016 `capture`** ("stays
  gaussian"). The plan anticipated this — it said the table is what to EXPECT, not source to paste,
  and that the season modules are the truth. The derivation tracks the modules and disagreed.
- **Commit:** `7cab6632`

### Structural notes, not deviations

- `packages/harness/sigmaScoutLayer.ts` was listed in the plan's files but needed no edit — the NB
  resolution already reaches the counter through the existing tally threading and spread copy.
  Confirmed rather than changed.
- Task 3 produced two commits rather than one (`7cab6632` fix, `47c92185` record) because the
  derivation fix is a code change and did not belong in a `measure(...)` commit.

## Verification

Verified by the executor, and then **independently re-verified by the orchestrator** after hand-off:

- Both goldens green with **ZERO edits**: `git diff 83642576..47c92185 --
  packages/core/rankingPoints/analyticPmfGolden.json packages/core/rankingPoints/predictThresholdsGolden.json`
  prints nothing. Re-confirmed by the orchestrator.
- `docs/models/rp-attribution.md` and `data/baselines/rp-attribution-2026-09.json` both show **zero
  diff** across the whole task range. Re-confirmed by the orchestrator.
- All 34 season-module declarations are `marginalFamily: "gaussian"`; `grep` for a
  `marginalFamily: "negative-binomial"` declaration returns nothing. Re-confirmed by the
  orchestrator (the one `negative-binomial` string per season module is a historical comment).
- `npx vitest run packages/core/rankingPoints scripts/measureRpCalibration.test.ts
  packages/harness/baselineFingerprint.test.ts` — **12 files, 778 tests passed**, re-run by the
  orchestrator and read from the output rather than the exit code.
- The slice guard verified firing by the orchestrator on BOTH `--seasons 2016-2026` (a spanning
  range) and `--seasons 2025` (a bare reporting season) — refused in both cases, before the corpus
  opens, with no override flag.
- `familyForClauseSum` read directly by the orchestrator: the `negative-binomial` case throws, the
  `never` default survives for a future third member, and no Gaussian fallback was added.
- Measurement mechanism spot-checked independently by the orchestrator on 2020/bpr — reproduced
  `shieldOperational` at `delta=-0.001945`, exactly matching the executor's reported figure, with
  all three categories and the resolution fraction printed separately.
- Every commit staged only this task's paths; per-commit `--stat` confirms **zero file deletions**
  and no foreign file.

## Known Stubs

None.

## Deferred Issues

**`packages/harness/publish.test.ts` has two `PreScheduleArtifactSchema` typecheck errors.**
Pre-existing and NOT caused by this task — a concurrent session was mid-edit on `publish.ts` /
`publish.test.ts` throughout this work. Out of scope per the scope boundary rule; left alone, not
fixed, and not staged.

## Concurrency Note

Another session committed interleaved work on `apps/web/src/lib/preSchedule*`,
`packages/harness/publish.ts`, `packages/harness/pageArtifacts.ts` and
`docs/models/statbotics-breakdown-reference.md` throughout this task. Every commit here staged
explicit paths only; `git status --short` was checked before each one, and per-commit `--stat`
confirms no foreign edit was absorbed.

## The Open Decisions — Jacob's, not an agent's

1. **Should 09-06's bar stand?** It admitted no regression at any magnitude, and `hangarBonus`
   regresses (+0.002864, consistently on all three algorithms) — so this result would still FAIL
   that bar as written. But the bar was applied to a run whose reach was 0 on this slice, which is
   the whole reason the verdict was re-opened.
2. **Is the 2023-2026 reporting slice worth re-spending** to confirm a -0.0029 pooled gain? It has
   been spent once on this question already. Re-spending it further weakens it as an honest
   out-of-sample check on anything later.
3. **Does a gain produced by ~36% of fits change the read?** The other ~64% fell back to Gaussian,
   so this is as much a result about where the NB fit applies as about the family.
