# Stage 1 carry-variance experiment — results (260905-jyf)

## Motivation

`reports/autopsy-260905/FINDINGS.md` diagnosed VPR's accuracy deficit vs EPA as an
early-information deficit: VPR resets belief VARIANCE to the cold-start prior at every
season boundary while carrying an EPA-equivalent MEAN across it, so it "pays" for a
cold-start posterior in the first chunk of every season even though its mean already
carries real information. This experiment tests that diagnosis directly, on
measurement, with two parameter-free candidate seed rules patched into `carrySeason`,
before any parameter, version, or promotion work is proposed.

## Patches (working-tree only, applied sequentially, reverted after each replay — never committed)

Both patches touch only `carrySeason`'s per-team component loop in
`packages/core/algorithms/sigma1/index.ts`. Neither touches `ADJUST_COMPONENT`'s pinned
`{mean:0, variance:0}` branch, and neither touches line 1849's `consistency[name]`
accumulator formula — only the belief-variance seed at the line above it.

### R1 — the carried-consistency seed

```diff
@@ carrySeason component loop (packages/core/algorithms/sigma1/index.ts) @@
       const coldStartVariance = seedConsistencyFor(state.league, name, resolved);
-      beliefs[name] = { mean: share, variance: coldStartVariance };
+      // Quick task 260905-jyf, R1 (carry-variance experiment, TEMPORARY —
+      // reverted after replay, never committed): a team with carried
+      // consistency evidence seeds belief variance from that carried,
+      // gap-decayed value (floored at minConsistencyVariance) instead of
+      // always resetting to the cold-start prior. A team with no carried
+      // state keeps today's behavior bit for bit.
+      const carriedConsistencyForSeed = oldTeamState?.consistency[name];
+      beliefs[name] = {
+        mean: share,
+        variance:
+          carriedConsistencyForSeed === undefined
+            ? coldStartVariance
+            : Math.max(resolved.minConsistencyVariance, carriedConsistencyForSeed * consistencyDecayOverGap),
+      };
       const carriedObserved = oldTeamState?.consistency[name] ?? coldStartVariance;
       consistency[name] = carriedObserved * consistencyDecayOverGap;
```

A team with no carried state (`oldTeamState?.consistency[name] === undefined`) keeps
today's `coldStartVariance` seed unchanged — R1 only changes behavior for teams that
already have carried evidence. No import change required.

### R2 — the reversion-scaled seed

```diff
@@ import (packages/core/algorithms/sigma1/index.ts, line 103) @@
-import { sigma1Carryover } from "./carryover.js";
+import { reversionOverGap, sigma1Carryover } from "./carryover.js";

@@ carrySeason component loop @@
       const coldStartVariance = seedConsistencyFor(state.league, name, resolved);
-      beliefs[name] = { mean: share, variance: coldStartVariance };
+      // Quick task 260905-jyf, R2 (carry-variance experiment, TEMPORARY —
+      // reverted after replay, never committed): a team with carried state
+      // seeds belief variance from the cold-start prior scaled by the same
+      // gap-generalized reversion fraction the mean carry already uses
+      // (floored at minConsistencyVariance), instead of always resetting to
+      // the full cold-start prior. A team with no carried state keeps
+      // today's behavior bit for bit.
+      beliefs[name] = {
+        mean: share,
+        variance:
+          oldTeamState === undefined
+            ? coldStartVariance
+            : Math.max(
+                resolved.minConsistencyVariance,
+                coldStartVariance * reversionOverGap(resolved.carryMeanReversion, gap)
+              ),
+      };
       const carriedObserved = oldTeamState?.consistency[name] ?? coldStartVariance;
       consistency[name] = carriedObserved * consistencyDecayOverGap;
```

R2 scales the cold-start prior itself by the same gap-generalized reversion fraction
(`reversionOverGap(resolved.carryMeanReversion, gap)`) that the carried MEAN already
uses, rather than seeding from a carried consistency value the way R1 does.

## Exact commands run

Instrument validation (Task 1, before any patch):

```
node .planning/quick/260905-jyf-stage-1-carry-variance-experiment-two-pa/score-carryvar.cjs --candidates none
```

Per rule, strictly sequential (R1 fully replayed and reverted before R2 started):

```
npx tsc --noEmit
pnpm harness --seasons 2022-2026 --algorithm vpr --out reports/carryvar-r1-260905
git checkout -- packages/core/algorithms/sigma1/index.ts

npx tsc --noEmit
pnpm harness --seasons 2022-2026 --algorithm vpr --out reports/carryvar-r2-260905
git checkout -- packages/core/algorithms/sigma1/index.ts
```

Final four-series scoring:

```
node .planning/quick/260905-jyf-stage-1-carry-variance-experiment-two-pa/score-carryvar.cjs --candidates r1,r2
```

Both candidate artifacts (`reports/carryvar-r1-260905/artifact.json`,
`reports/carryvar-r2-260905/artifact.json`) report `algorithmVersion` identical to the
baseline (`8.0.0+rolling-2026-09b`) — confirmed by the Task 2 verify step
(`VERSION_MATCHES_BASELINE` for both) — proving neither replay leaked a parameter or
version-bump change alongside the patch.

## Early-slice definition

Derived once from the baseline stream (`reports/autopsy-260905/predictions-{season}.jsonl`)
and reused identically for all four series: the distinct `eventKey` values are collected
in first-appearance order (chronological, since the stream is written by a walk-forward
replay), and the first `Math.ceil(eventCount * 0.33)` of them form the early-event set. A
scored match is "early" when its `eventKey` is in that set.

## Instrument validation (Task 1)

`--candidates none` reproduced `TOTAL_SCORED=83655` — an exact match to FINDINGS.md's
independently-produced 83,655 scored matches — with `dropped_other=0` for every season,
and matched FINDINGS.md's per-season direction: 2024 baseline-vpr (0.7451) beats baseline
epa (0.7325), and 2025 epa (0.7763) beats baseline-vpr (0.7629).

## Full four-series comparison

Scored-set denominator, ties, and other-drops were identical between the instrument
validation run and this run (dropped_other=0 every season, same scored_n per season) —
adding r1/r2 to the requested-series intersection did not shrink the scored set, so the
same 83,655-match denominator applies throughout.

### Season 2022 (cold-start — no carrySeason boundary applies)

scored_n=14501 dropped_other=0 ties=176

| series | accuracy | brier | early_accuracy | early_n | scored_n | se_units_delta |
|---|---|---|---|---|---|---|
| epa | 0.7670 | 0.1628 | 0.7348 | 4608 | 14501 |  |
| baseline-vpr | 0.7637 | 0.1571 | 0.7357 | 4608 | 14501 |  |
| r1 | 0.7637 | 0.1571 | 0.7357 | 4608 | 14501 | 0.00 |
| r2 | 0.7637 | 0.1571 | 0.7357 | 4608 | 14501 | 0.00 |

Both candidates are byte-identical to baseline-vpr on 2022 (SE-units 0.00), as expected:
2022 is the cold-start season in this run and `carrySeason` (hence both patches) never
executes.

### Season 2023

scored_n=16207 dropped_other=0 ties=146

| series | accuracy | brier | early_accuracy | early_n | scored_n | se_units_delta |
|---|---|---|---|---|---|---|
| epa | 0.7623 | 0.1646 | 0.7539 | 5188 | 16207 |  |
| baseline-vpr | 0.7563 | 0.1654 | 0.7402 | 5188 | 16207 |  |
| r1 | 0.7576 | 0.1649 | 0.7413 | 5188 | 16207 | 0.37 |
| r2 | 0.7462 | 0.1723 | 0.7292 | 5188 | 16207 | -3.00 |

### Season 2024

scored_n=16835 dropped_other=0 ties=194

| series | accuracy | brier | early_accuracy | early_n | scored_n | se_units_delta |
|---|---|---|---|---|---|---|
| epa | 0.7325 | 0.1884 | 0.7254 | 5288 | 16835 |  |
| baseline-vpr | 0.7451 | 0.1711 | 0.7345 | 5288 | 16835 |  |
| r1 | 0.7452 | 0.1702 | 0.7347 | 5288 | 16835 | 0.04 |
| r2 | 0.7243 | 0.1847 | 0.7012 | 5288 | 16835 | -6.19 |

### Season 2025

scored_n=17754 dropped_other=0 ties=123

| series | accuracy | brier | early_accuracy | early_n | scored_n | se_units_delta |
|---|---|---|---|---|---|---|
| epa | 0.7763 | 0.1596 | 0.7578 | 5781 | 17754 |  |
| baseline-vpr | 0.7629 | 0.1595 | 0.7405 | 5781 | 17754 |  |
| r1 | 0.7631 | 0.1593 | 0.7407 | 5781 | 17754 | 0.07 |
| r2 | 0.7224 | 0.1886 | 0.7099 | 5781 | 17754 | -12.69 |

### Season 2026

scored_n=18358 dropped_other=0 ties=45

| series | accuracy | brier | early_accuracy | early_n | scored_n | se_units_delta |
|---|---|---|---|---|---|---|
| epa | 0.7932 | 0.1435 | 0.7800 | 5878 | 18358 |  |
| baseline-vpr | 0.7901 | 0.1446 | 0.7722 | 5878 | 18358 |  |
| r1 | 0.7900 | 0.1446 | 0.7724 | 5878 | 18358 | -0.02 |
| r2 | 0.7872 | 0.1462 | 0.7634 | 5878 | 18358 | -0.94 |

### Pooled (all seasons)

total_dropped_other=0 total_ties=684

| series | accuracy | brier | early_accuracy | early_n | scored_n | se_units_delta |
|---|---|---|---|---|---|---|
| epa | 0.7669 | 0.1634 | 0.7516 | 26743 | 83655 |  |
| baseline-vpr | 0.7641 | 0.1593 | 0.7454 | 26743 | 83655 |  |
| r1 | 0.7644 | 0.1590 | 0.7457 | 26743 | 83655 | 0.20 |
| r2 | 0.7488 | 0.1699 | 0.7281 | 26743 | 83655 | -10.46 |

TOTAL_SCORED=83655

## Verdict

Pre-committed criteria (from PLAN.md): a rule WINS if it improves early-slice accuracy
over baseline-vpr on BOTH 2023 and 2025, AND on no season loses overall accuracy by more
than 2 binomial SE (every season's SE-unit delta at or above -2.0).

### R1 — WIN

- 2023 early-slice accuracy: baseline-vpr 0.7402 -> r1 0.7413 (improved).
- 2025 early-slice accuracy: baseline-vpr 0.7405 -> r1 0.7407 (improved).
- SE-unit deltas across all five seasons: 0.00, 0.37, 0.04, 0.07, -0.02 — all at or above
  -2.0 (in fact all within ±0.4 SE, i.e. statistically indistinguishable from baseline on
  overall accuracy in every season).
- Pooled: accuracy 0.7644 vs baseline 0.7641 (+0.20 SE-units, essentially flat), Brier
  0.1590 vs baseline 0.1593 (marginally better), pooled early-slice accuracy 0.7457 vs
  0.7454 (marginally better).
- Reading: R1 meets both required early-slice improvements and never moves overall
  accuracy by a detectable amount in either direction. It is a real but very small
  effect — the gains are a few hundredths of a point, an order of magnitude smaller
  than the ~1.3pt EPA-vs-VPR early-slice gap FINDINGS.md measured. The mechanism is
  directionally validated: seeding belief variance from carried consistency (rather
  than a full cold-start reset) moves the needle the diagnosed direction, but this
  specific parameter-free formulation captures only a small fraction of the deficit.

### R2 — NO-WIN

- 2023 early-slice accuracy: baseline-vpr 0.7402 -> r2 0.7292 (WORSE — fails the
  required-improvement criterion on its own).
- 2025 early-slice accuracy: baseline-vpr 0.7405 -> r2 0.7099 (also WORSE).
- SE-unit deltas: 0.00, -3.00, -6.19, -12.69, -0.94 — three seasons (2023, 2024, 2025)
  breach the -2.0 SE floor, 2025 by a wide margin (-12.69 SE).
- Pooled: accuracy 0.7488 vs baseline 0.7641 (-10.46 SE-units, a large, clearly real
  degradation), Brier 0.1699 vs baseline 0.1593 (worse), pooled early-slice accuracy
  0.7281 vs 0.7454 (worse).
- Reading: scaling the FULL cold-start prior by `reversionOverGap(carryMeanReversion,
  gap)` overshoots badly — at the promoted parameter set's `carryMeanReversion`, this
  seeds belief variance far too low (too confident) for teams with carried state,
  making the model overconfident in exactly the region (early season) where FINDINGS.md
  already showed VPR is systematically more confident than warranted on disagreements.
  This closes off the "scale the cold-start prior directly by the mean-carry reversion
  fraction" formulation as a viable Stage-2 direction: R2 is not a smaller step in the
  right direction, it is a step in the wrong direction on the very metric it was meant
  to fix.

### Combined read

Only R1 wins. Between the two, R1's mechanism (seed from carried CONSISTENCY, decayed
by the existing `consistencyDecayOverGap`) is the one worth carrying forward if a
Stage-2 experiment is scoped; R2's mechanism (seed from the cold-start prior scaled by
mean-carry reversion) is now a measured negative result, not merely an unexplored one.
No promotion, tuning, or productionization follows from this task — per PLAN.md, that
decision is left to the user.

## Reproducibility note

`reports/` is gitignored. The four prediction stream directories used here
(`reports/autopsy-260905/` for the epa/baseline-vpr streams, `reports/carryvar-r1-260905/`
and `reports/carryvar-r2-260905/` for the two candidates) are NOT recoverable from git
history. They must be regenerated by re-running the exact commands recorded above,
against the same `data/corpus.sqlite` corpus and the same promoted parameter set
(`8.0.0+rolling-2026-09b`), with the two patches reapplied from the fenced diffs above in
the same strictly-sequential order (patch, typecheck, replay, revert — never both patches
held at once).
