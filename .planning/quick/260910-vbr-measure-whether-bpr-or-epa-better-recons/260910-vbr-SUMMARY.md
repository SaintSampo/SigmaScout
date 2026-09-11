---
task: "Measure whether BPR or EPA better reconstructs observed alliance output at Championship-level play, walk-forward"
quick_id: 260910-vbr
date: 2026-09-10
status: complete
subsystem: measurement/diagnostics
tags: [bpr, epa, opr, alliance-reconstruction, championship, walk-forward, negative-result]
requires:
  - packages/harness/replay.ts (WalkForwardSimulator.runAll)
  - packages/core/algorithms/bpr.ts (correctionsOf)
  - packages/harness/eventBootstrap.ts (eventBlockedBootstrap)
  - packages/harness/seasonBoundary.ts (seasonBoundaryFor)
  - scripts/measureSwingSkill.ts (equalCountBuckets, parseSeasons)
provides:
  - scripts/measureAllianceReconstruction.ts
  - pnpm measure:alliance-reconstruction
affects: []
tech-stack:
  added: []
  patterns: [one-runAll-shared-stream, event-blocked-bootstrap, pre-registered-verdict]
key-files:
  created:
    - scripts/measureAllianceReconstruction.ts
    - scripts/measureAllianceReconstruction.test.ts
  modified:
    - package.json
decisions:
  - "The hypothesis (BPR's rank weighting reconstructs stacked alliances better) is REFUTED at Championship divisions and at district championships; BPR over-predicts, monotonically with tier."
  - "BPR is nonetheless the BEST reconstructor at the base tier — it wins where spread is ordinary and overshoots where the field is stacked."
  - "OPR's Einstein and Festival-of-Champions rows are structurally meaningless (event-scoped model, separate TBA event key) and must never be quoted as a model comparison."
  - "Raw-vs-corrected target choice moves every signed error by roughly the mean foul load (~6 points) but flips no verdict."
metrics:
  duration: ~55min
  completed: 2026-09-10
actuals:
  tokens: 13964
  tasks: 3
  commits: 3
---

# Quick Task 260910-vbr: Alliance Reconstruction at Championship-Level Play

A new read-only walk-forward diagnostic adjudicates the published 1.128-vs-0.968
disagreement between BPR and EPA with an outcome instead of a ratio — and the
answer refutes the hypothesis that motivated it: BPR does **not** reconstruct
stacked alliances better, it **over-predicts** them, monotonically with event tier.

## What was built

`scripts/measureAllianceReconstruction.ts` (+ 37 unit tests, + a
`measure:alliance-reconstruction` package script). It drives `opr`, `epa` and
`bpr` through **one** `WalkForwardSimulator.runAll` over **one** shared
chronological stream per season, threads state across season boundaries exactly
as `cli.ts`'s `runSeasons` does, and scores each model's **own** alliance
reconstruction (`prediction.redScore` / `blueScore`, read verbatim — never a
hand-rolled re-sum of `teamMetrics`, which would have forced OPR's linear-sum
assumption onto BPR and tested the opposite of the hypothesis).

**Run performed:** full default range `2016-2019, 2022-2026` (nine seasons),
`opr@4.0.0+baseline, epa@7.0.0+baseline, bpr@3.0.0+baseline`, 444,282
match-algorithm records replayed, 476 seconds, exit 0.

## THE VERDICT (verbatim from the run)

```
══ VERDICT — pre-registered, bpr vs epa on the corrected target ══
   Hypothesis: BPR's rank weighting reconstructs a STACKED alliance better than a linear sum can.
   base                   SUPPORTED — bpr reconstructs this tier CLOSER than epa, and the interval excludes zero
      MAE bpr 26.780 vs epa 30.495;  SIGNED bpr -1.684 vs epa +1.336  (positive = OVER-prediction, which is what the spread-amplifier reading predicts)
   districtChampionship   REFUTED — bpr reconstructs this tier WORSE than epa, and the interval excludes zero
      MAE bpr 32.028 vs epa 30.041;  SIGNED bpr +8.889 vs epa +1.690  (positive = OVER-prediction, which is what the spread-amplifier reading predicts)
   champsDivision         REFUTED — bpr reconstructs this tier WORSE than epa, and the interval excludes zero
      MAE bpr 43.048 vs epa 33.539;  SIGNED bpr +27.652 vs epa +4.925  (positive = OVER-prediction, which is what the spread-amplifier reading predicts)
   einstein               INDISTINGUISHABLE at this sample size — the paired interval spans zero
      MAE bpr 62.511 vs epa 46.901;  SIGNED bpr +55.503 vs epa +18.533  (positive = OVER-prediction, which is what the spread-amplifier reading predicts)
   festivalOfChampions    UNMEASURABLE — no usable interval for this tier
      MAE bpr 69.357 vs epa 82.779;  SIGNED bpr +29.987 vs epa -33.500  (positive = OVER-prediction, which is what the spread-amplifier reading predicts)
```

**Explicit verdict line: the hypothesis is REFUTED.** Confidence: **high** at
`champsDivision` (82 event blocks, interval `[+6.019, +13.576]` excludes zero,
effect size ~28% of EPA's MAE) and **high** at `districtChampionship` (163 event
blocks). **Low-to-moderate** at `einstein` considered alone — BPR is worse there
by every point estimate, but with only 12 event blocks the paired interval spans
zero and the honest reading is "same direction, not separately significant".

The **direction** is the pre-registered spread-amplifier prediction landing
exactly: BPR's signed error marches `-1.684 → +8.889 → +27.652 → +55.503` as the
field gets more stacked. `viewOfMap`'s corrected doc comment predicted positive
signed error at stacked fields, and that is what the corpus shows.

## Pooled results — corrected target (BPR's native target), 9 seasons

| model | tier | n | MAE | RMSE | SIGNED | mean pred | mean actual | pred/actual |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| opr | base | 240,915 | 43.723 | 178.293 | −9.623 | 103.519 | 113.141 | 0.915 |
| opr | districtChampionship | 30,130 | 56.308 | 241.679 | −14.691 | 158.793 | 173.484 | 0.915 |
| opr | champsDivision | 22,145 | 66.527 | 132.270 | −16.056 | 184.155 | 200.211 | 0.920 |
| opr | einstein † | 404 | 273.381 | 321.780 | −273.381 | 0.000 | 273.381 | 0.000 |
| opr | festivalOfChampions † | 10 | 470.600 | 478.181 | −470.600 | 0.000 | 470.600 | 0.000 |
| epa | base | 240,915 | 30.495 | 47.518 | **+1.336** | 114.477 | 113.141 | 1.012 |
| epa | districtChampionship | 30,130 | 30.041 | 48.171 | **+1.690** | 175.174 | 173.484 | 1.010 |
| epa | champsDivision | 22,145 | 33.539 | 53.816 | **+4.925** | 205.136 | 200.211 | 1.025 |
| epa | einstein | 404 | 46.901 | 71.846 | **+18.533** | 291.914 | 273.381 | 1.068 |
| epa | festivalOfChampions | 10 | 82.779 | 91.325 | −33.500 | 437.100 | 470.600 | 0.929 |
| bpr | base | 240,915 | **26.780** | 42.490 | **−1.684** | 111.458 | 113.141 | 0.985 |
| bpr | districtChampionship | 30,130 | 32.028 | 51.070 | **+8.889** | 182.373 | 173.484 | 1.051 |
| bpr | champsDivision | 22,145 | 43.048 | 69.869 | **+27.652** | 227.863 | 200.211 | **1.138** |
| bpr | einstein | 404 | 62.511 | 101.106 | **+55.503** | 328.884 | 273.381 | **1.203** |
| bpr | festivalOfChampions | 10 | 69.357 | 93.823 | +29.987 | 500.587 | 470.600 | 1.064 |

† **OPR's `einstein` and `festivalOfChampions` rows are NOT a model comparison
and must never be quoted as one.** OPR is event-scoped, and Einstein
(`event_type 4`) is a *separate TBA event key* from the divisions
(`event_type 3`). Every team therefore enters Einstein with zero within-event
history and OPR predicts exactly `0.000`. Its MAE there equals its signed-error
magnitude to the digit, which is the signature of that artifact, not of a model.

**The motivating disagreement is reproduced and adjudicated.** The published
`sum(BPR)/sum(OPR) = 1.128` vs `sum(EPA)/sum(OPR) = 0.968` for Championship
teams appears here as predicted/actual at `champsDivision`: **BPR 1.138, EPA
1.025, OPR 0.920**. BPR's 12.8% surplus is not the model correctly recognising
stacked alliances — it is a 27.7-point over-prediction of what those alliances
actually scored. EPA's is the better-calibrated number of the two.

## Pooled results — raw target (OPR's and EPA's native target), 9 seasons

| model | tier | n | MAE | RMSE | SIGNED | mean pred | mean actual |
|---|---|---:|---:|---:|---:|---:|---:|
| opr | base | 240,915 | 45.366 | 179.254 | −15.505 | 103.519 | 119.024 |
| opr | districtChampionship | 30,130 | 57.223 | 242.174 | −19.704 | 158.793 | 178.496 |
| opr | champsDivision | 22,145 | 68.001 | 134.160 | −22.813 | 184.155 | 206.968 |
| opr | einstein † | 404 | 279.418 | 328.105 | −279.418 | 0.000 | 279.418 |
| opr | festivalOfChampions † | 10 | 470.600 | 478.181 | −470.600 | 0.000 | 470.600 |
| epa | base | 240,915 | 31.860 | 49.617 | −4.546 | 114.477 | 119.024 |
| epa | districtChampionship | 30,130 | 30.519 | 48.239 | −3.323 | 175.174 | 178.496 |
| epa | champsDivision | 22,145 | 34.262 | 54.560 | −1.832 | 205.136 | 206.968 |
| epa | einstein | 404 | 45.505 | 69.349 | +12.496 | 291.914 | 279.418 |
| epa | festivalOfChampions | 10 | 82.779 | 91.325 | −33.500 | 437.100 | 470.600 |
| bpr | base | 240,915 | 28.644 | 45.527 | −7.566 | 111.458 | 119.024 |
| bpr | districtChampionship | 30,130 | 32.205 | 51.201 | +3.877 | 182.373 | 178.496 |
| bpr | champsDivision | 22,145 | 42.406 | 69.022 | +20.895 | 227.863 | 206.968 |
| bpr | einstein | 404 | 59.454 | 97.334 | +49.466 | 328.884 | 279.418 |
| bpr | festivalOfChampions | 10 | 69.357 | 93.823 | +29.987 | 500.587 | 470.600 |

## THE RAW-vs-CORRECTED COMPARABILITY FINDING (stated plainly)

**The three models do not all target the same quantity, and this had to be
surfaced before any of them could be compared at all.**

- `opr` trains against **RAW** total points (fouls included).
- `epa` trains against **RAW** total points — it *deliberately* adds the
  opponent's predicted `foulsCommitted` to its offensive total.
- `bpr` trains against **CORRECTED** points, `raw − foulPoints − adjustPoints`,
  computed here by importing `correctionsOf` from `bpr.ts` itself so the
  measurement target cannot drift from the training target.

**Consequence, quantified.** The mean foul+adjust load in this population is
about **5.9 points per alliance at base** (mean actual 113.141 corrected vs
119.024 raw) and **6.8 points at champsDivision** (200.211 vs 206.968). Against
the *corrected* target OPR's and EPA's signed errors therefore carry that load as
a **negative floor** — they are predicting a quantity that includes fouls and
being graded on one that does not. Against the *raw* target BPR carries it as a
negative floor instead. Concretely at `champsDivision`: EPA's signed error is
`+4.925` corrected but `−1.832` raw; BPR's is `+27.652` corrected but `+20.895`
raw. Roughly 6.8 points of each model's apparent bias is arithmetic, not model.

**It changes no verdict.** The paired bpr-vs-epa interval at `champsDivision` is
`[+6.019, +13.576]` on the corrected target and `[+4.998, +11.711]` on the raw
one — both exclude zero, same sign, same conclusion. A ~6-point target offset
cannot explain a ~9.5-point paired MAE gap. **Nothing was normalized away**: no
foul subtraction was applied to OPR's or EPA's *prediction* to reconcile them,
because that would be inventing a model neither one is.

## Paired contrasts — event-blocked bootstrap, with event counts

`mean(|err_bpr| − |err_other|)`; **negative = BPR closer**. 2000 resamples,
seed 42, blocks are events (first-appearance order). `eventCount` is the honest
effective sample size; `n` is shown only to make the gap between them visible.

### Corrected target

| tier | pair | point est. | SE | 95% percentile | eventCount | n |
|---|---|---:|---:|---|---:|---:|
| base | bpr vs epa | −3.715 | 0.261 | [−4.218, −3.209] | 1385 | 240,915 |
| districtChampionship | bpr vs epa | +1.987 | 0.376 | [+1.289, +2.742] | 163 | 30,130 |
| champsDivision | bpr vs epa | **+9.509** | 1.899 | **[+6.019, +13.576]** | **82** | 22,145 |
| einstein | bpr vs epa | +15.610 | 12.014 | **[−3.011, +43.494]** | **12** | 404 |
| festivalOfChampions | bpr vs epa | — | — | too few event blocks to bootstrap | 1 | 10 |
| base | bpr vs opr | −16.943 | 0.631 | [−18.219, −15.828] | 1385 | 240,915 |
| districtChampionship | bpr vs opr | −24.280 | 2.338 | [−29.323, −20.303] | 163 | 30,130 |
| champsDivision | bpr vs opr | −23.479 | 2.343 | [−28.180, −19.133] | 82 | 22,145 |
| einstein † | bpr vs opr | −210.870 | 34.412 | [−281.010, −147.406] | 12 | 404 |

### Raw target

| tier | pair | point est. | SE | 95% percentile | eventCount | n |
|---|---|---:|---:|---|---:|---:|
| base | bpr vs epa | −3.215 | 0.250 | [−3.705, −2.727] | 1385 | 240,915 |
| districtChampionship | bpr vs epa | +1.686 | 0.316 | [+1.104, +2.313] | 163 | 30,130 |
| champsDivision | bpr vs epa | +8.144 | 1.688 | [+4.998, +11.711] | 82 | 22,145 |
| einstein | bpr vs epa | +13.949 | 11.973 | [−4.734, +41.546] | 12 | 404 |
| base | bpr vs opr | −16.721 | 0.618 | [−17.977, −15.615] | 1385 | 240,915 |
| districtChampionship | bpr vs opr | −25.018 | 2.321 | [−30.057, −21.091] | 163 | 30,130 |
| champsDivision | bpr vs opr | −25.596 | 2.303 | [−30.188, −21.261] | 82 | 22,145 |
| einstein † | bpr vs opr | −219.964 | 35.195 | [−291.343, −154.750] | 12 | 404 |

Einstein's interval is wide because there are **12 events**, not because there
are 404 rows. That is the whole reason the bootstrap is event-blocked.

## The strength-quintile control — tests the stacking hypothesis WITHOUT Championship

Base tier (regional + district) **only**, quintiles of OPR's own predicted
alliance output for the same match-side, deduplicated to match-sides before
bucketing so all three models share identical bucket edges. n = 48,183 per
model per quintile.

### Corrected target

| quintile | mean OPR strength | opr MAE / SIGNED | epa MAE / SIGNED | bpr MAE / SIGNED |
|---:|---:|---|---|---|
| 1 | −2.577 | 67.883 / −66.195 | 32.028 / +10.656 | **21.444 / +4.112** |
| 2 | 45.346 | 15.915 / −7.242 | 17.387 / +6.138 | **12.468 / −0.665** |
| 3 | 70.216 | 19.244 / −3.914 | 17.076 / −0.544 | **15.661 / −2.264** |
| 4 | 116.592 | 34.283 / −5.853 | 27.847 / −6.698 | **27.302 / −3.444** |
| 5 | 288.016 | 81.291 / +35.090 | 58.138 / −2.873 | **57.027 / −6.158** |

### Raw target

| quintile | mean OPR strength | opr MAE / SIGNED | epa MAE / SIGNED | bpr MAE / SIGNED |
|---:|---:|---|---|---|
| 1 | −2.577 | 71.823 / −70.541 | 32.418 / +6.309 | 22.273 / −0.234 |
| 2 | 45.346 | 17.449 / −10.509 | 17.741 / +2.872 | 13.613 / −3.931 |
| 3 | 70.216 | 20.331 / −7.616 | 18.187 / −4.245 | 17.106 / −5.966 |
| 4 | 116.592 | 35.896 / −11.229 | 29.822 / −12.073 | 29.063 / −8.820 |
| 5 | 288.016 | 81.329 / +22.368 | 61.130 / −15.595 | 61.166 / −18.879 |

**This is the result that decides what the Championship finding is ABOUT, and it
cuts against the stacking story twice over.**

1. **Inside ordinary events, BPR does not over-predict strong alliances.** Its
   signed error goes *down* with strength (+4.112 at Q1 → **−6.158** at Q5). If
   the Championship over-prediction were the rank-weight amplifier firing on
   high-spread alliances, it would have to be visible on Q5 of ordinary
   regionals. It is not — BPR *under*-predicts there.
2. **BPR beats EPA on every base-tier quintile including Q5** (57.027 vs
   58.138). So the mechanism that makes BPR the best base-tier reconstructor is
   still working at high alliance strength.

Therefore the Championship over-prediction is a property of **Championship-tier
EVENTS**, not of stacked alliances. And per the plan's own pre-registered rule,
the lateness confound is **not** excluded: the effect also appears at the warm
control `districtChampionship` (+1.987, interval excludes zero, signed +8.889),
just about 4.5× smaller. The pattern tracks event tier — which bundles lateness,
cross-event team pooling and a different scoring regime together — rather than
alliance spread.

## Per-season breakout — every season the corpus covers

Corrected target. This is printed per season precisely so a single-season fluke
reads as one season. It is not one: BPR's champsDivision signed error is
**positive in all nine seasons**, and larger than EPA's in all nine.

| season | tier | opr MAE / SIGNED | epa MAE / SIGNED | bpr MAE / SIGNED |
|---|---|---|---|---|
| 2016 | base (n 21,544) | 24.420 / −11.679 | 15.215 / −5.512 | 15.265 / −6.173 |
| 2016 | dcmp (n 2,110) | 27.378 / −12.703 | 14.621 / −0.909 | 15.924 / +1.493 |
| 2016 | champsDivision (n 2,247) | 34.336 / −13.946 | 16.492 / +2.386 | 19.425 / +7.745 |
| 2016 | einstein (n 36) | 205.833 / −205.833 † | 29.828 / −24.509 | 22.787 / +12.557 |
| 2017 | base (n 24,635) | 75.704 / −27.383 | 44.518 / −18.053 | 42.577 / −6.974 |
| 2017 | dcmp (n 2,895) | 86.089 / −34.174 | 43.734 / −3.026 | 46.486 / +3.276 |
| 2017 | champsDivision (n 3,074) | 91.551 / −37.679 | 45.366 / −1.754 | 49.608 / +17.335 |
| 2017 | einstein (n 68) | 453.765 / −453.765 † | 64.494 / −35.313 | 53.550 / +32.180 |
| 2018 | base (n 27,531) | 120.015 / −4.972 | 70.876 / +11.525 | 69.156 / −2.679 |
| 2018 | dcmp (n 3,034) | 118.252 / −8.228 | 68.525 / +38.623 | 63.279 / +18.645 |
| 2018 | champsDivision (n 3,065) | 126.908 / −4.287 | 70.181 / +36.929 | 65.036 / +22.994 |
| 2018 | einstein (n 68) | 338.074 / −338.074 † | 92.039 / +89.471 | 78.488 / +69.126 |
| 2019 | base (n 29,411) | 15.946 / −5.563 | 33.238 / +25.395 ‡ | 9.363 / −0.531 |
| 2019 | dcmp (n 3,300) | 19.530 / −6.464 | 10.032 / −0.531 | 10.474 / +3.919 |
| 2019 | champsDivision (n 3,064) | 20.789 / −5.534 | 10.931 / −0.497 | 11.670 / +6.054 |
| 2019 | einstein (n 72) | 98.389 / −98.389 † | 9.939 / −0.350 | 13.249 / +8.944 |
| 2022 | base (n 24,041) | 16.324 / −4.032 | 12.573 / +2.962 | 11.351 / −0.020 |
| 2022 | dcmp (n 3,300) | 25.178 / −5.409 | 13.039 / −0.328 | 14.172 / +3.221 |
| 2022 | champsDivision (n 1,694) | 29.353 / −7.199 | 14.801 / +1.978 | 22.516 / +18.859 |
| 2022 | einstein (n 36) | 128.056 / −128.056 † | 24.076 / +23.335 | 39.098 / +39.098 |
| 2023 | base (n 26,617) | 24.214 / −6.722 | 14.408 / −1.781 | 14.532 / −1.059 |
| 2023 | dcmp (n 3,517) | 32.440 / −11.647 | 13.878 / −0.601 | 16.703 / +7.968 |
| 2023 | champsDivision (n 2,300) | 35.265 / −14.115 | 15.164 / +0.611 | 23.126 / +18.365 |
| 2023 | einstein (n 30) | 187.200 / −187.200 † | 14.119 / +2.371 | 41.491 / +41.491 |
| 2024 | base (n 27,889) | 17.128 / −3.009 | 13.427 / +6.287 | 10.518 / −0.232 |
| 2024 | dcmp (n 3,652) | 21.379 / −5.749 | 12.081 / +0.361 | 13.312 / +2.896 |
| 2024 | champsDivision (n 2,228) | 29.484 / −10.648 | 13.763 / +1.712 | 18.554 / +13.978 |
| 2024 | einstein (n 30) | 125.300 / −125.300 † | 23.280 / +11.100 | 34.614 / +34.061 |
| 2025 | base (n 29,490) | 29.938 / −9.346 | 18.685 / −3.988 | 18.458 / −0.830 |
| 2025 | dcmp (n 3,784) | 41.101 / −16.050 | 21.022 / −7.559 | 22.385 / +5.823 |
| 2025 | champsDivision (n 2,248) | 48.884 / −21.195 | 20.697 / −3.195 | 39.107 / +36.547 |
| 2025 | einstein (n 32) | 258.375 / −258.375 † | 21.742 / +14.424 | 72.627 / +72.627 |
| 2026 | base (n 29,757) | 66.266 / −15.331 | 46.448 / −8.752 | 46.960 / +1.618 |
| 2026 | dcmp (n 4,538) | 118.015 / −28.665 | 64.161 / −5.148 | 73.041 / +25.215 |
| 2026 | champsDivision (n 2,225) | 159.809 / −27.987 | 81.110 / −1.781 | 135.494 / +119.162 |
| 2026 | einstein (n 32) | 620.438 / −620.438 † | 119.687 / +93.946 | 265.217 / +263.754 |

† OPR's event-scoping artifact (see above), not a model result.
‡ Incidental: EPA's 2019 base row is an outlier against its own record (MAE
33.238, signed **+25.395**, vs BPR's 9.363 / −0.531). 2018's mean alliance
output was 262.9 and 2019's was 48.6, so this looks like EPA's `carrySeason`
carrying a 2018-scaled prior into a five-times-smaller 2019 scoring regime.
**Out of scope for this task, not investigated, not fixed** — logged here so it
is not lost.

**Trend worth naming:** BPR's champsDivision over-prediction is not stable
across eras. It is modest in 2016-2019 (+6 to +23) and grows sharply in
2022-2026 (+14 → +18 → +19 → +37 → **+119**). 2026 is the worst season on
record and is exactly the season the motivating 1.128 ratio came from.

## Exclusion census (from the run)

```
   EXCLUSION CENSUS (match-algorithm records replayed: 444282)
      notScoredTier              813
      surrogateAffected         1788
      coldStart                  801
      fullyDemoAlliance          108
      dqZeroedSide               732
      nonFiniteValue               0
```

Counts are **match-algorithm records** (3 per match), so e.g. 1,788 =
596 surrogate-affected matches. Every one of these left the **scoreboard** only;
nothing left the **state stream**, so every replayed match still taught every
algorithm and a narrowed population never becomes a warmer model.

## Method notes that are load-bearing

- **One shared stream, one `runAll`** (D-22) for all three algorithms, so any
  difference is the model and not the data. This is also what makes the strength
  control possible at zero extra cost: `strengthRef` is OPR's prediction for the
  *same* match-side from the *same* run.
- **Season-boundary threading mirrors `cli.ts`'s `runSeasons` exactly**
  (`seasonBoundaryFor` → `carrySeason` → `initialStates`, `carryStates` out). A
  fresh-per-season run would have been wrong *in the direction of the
  hypothesis*: the control bucket is mostly weeks 1-6, so starting every season
  cold would handicap the control and manufacture a Championship advantage that
  is really just a warmer model. Threading also makes BPR's champs result
  **worse**, not better — the un-threaded 2026-only tracer gave BPR
  champsDivision MAE 125.004 / signed +99.835, versus 135.494 / +119.162 when
  2016-2025 state is carried in.
- **`tierOf` keeps event types 3 and 4 separate** and refuses to default an
  unregistered type. `EVENT_TYPE_TIERS` was deliberately *not* reused: it
  collapses them into one `championship` tier, which would have buried all 404
  Einstein observations inside 22,145 division ones.
- **`correctionsOf` is imported from `bpr.ts`**, never re-transcribed, so the
  measurement target and BPR's training target are the same function.
- **Paired differences drop an unmatched counterpart, never zero-fill.** A
  zero-fill asserts "the two models tied here" and dilutes every contrast toward
  zero — the one silent failure that could have produced a false
  "indistinguishable" and no finding at all. There is a unit test pinning this.

## Verification

| check | result |
|---|---|
| `npx vitest run scripts/measureAllianceReconstruction.test.ts` | **37 passed / 37**, 1 file — read from output |
| `npx tsc --noEmit -p tsconfig.json` | clean, no diagnostics |
| `pnpm measure:alliance-reconstruction` resolves | yes — `tsx scripts/measureAllianceReconstruction.ts` |
| full default-range run completed | yes, 476s, `FULL RUN EXIT=0`, nine seasons |
| `git status --porcelain -- packages` | **empty** |
| files touched across all three commits | exactly `scripts/measureAllianceReconstruction.ts`, `scripts/measureAllianceReconstruction.test.ts`, `package.json` |

**Holdout integrity.** Nothing was tuned, fitted, swept or selected against any
season. No model code and no parameter was touched. BPR's sealed 2023-2026
holdout is unspent by this task — this is a diagnostic *description* of an
already-shipped model's behaviour, not a selection against outcomes.

## Commits

| task | commit | contents |
|---|---|---|
| 1 (tracer) | `d2f0c8ca` | `feat(260910-vbr)`: the measurement, one season, one table |
| 2 | `242ea68e` | `feat(260910-vbr)`: dual target, season breakout, controls, paired contrast |
| 3 | `91178d17` | `test(260910-vbr)`: 37 unit tests + `package.json` wiring |

## Deviations from Plan

**1. [Rule 1 — Bug] A commit absorbed another session's staged deletions, and was rewritten**

- **Found during:** Task 2 commit.
- **Issue:** A concurrent Claude session working in this same checkout had five
  `apps/web/src/components/methodology/*` deletions **staged in the shared
  index** at the moment I ran `git add <my file> && git commit`. Because `git
  commit` without a pathspec commits the whole index, commit `95d25d90` captured
  those five foreign deletions alongside my file.
- **Fix:** `git reset --soft HEAD~1` (which restored the other session's index
  entries exactly as they were), then re-committed with an explicit pathspec:
  `git commit -m "..." -- scripts/measureAllianceReconstruction.ts`. The
  pathspec form commits working-tree content for the named paths only and leaves
  every other index entry staged and untouched. Verified afterwards that the new
  commit `242ea68e` contains one file and that the five deletions were still
  staged for the other session.
- **Standing change:** every subsequent commit in this task used the
  `git commit -- <paths>` form. Task 1's commit (`d2f0c8ca`) was checked and was
  already clean.
- **Files modified:** none beyond the task's own; no foreign work was lost.
- **Commit:** `242ea68e` (the corrected replacement for `95d25d90`).

**2. [Rule 3 — Blocking] The discipline gate's literal form could not be used as written**

- **Issue:** The plan's gate is `git status --porcelain -- packages apps` must be
  empty. At task start the working tree already carried **19 foreign modified
  files** under `packages/` and `apps/` from the concurrent session, and by task
  end it carried a different set under `apps/` — none of them mine. Reverting
  them to satisfy the gate literally would have destroyed another session's work,
  which is the opposite of what the gate exists to protect.
- **Fix:** the gate was enforced on its **intent** instead, three ways: a
  baseline snapshot of foreign modifications taken before any work;
  `git status --porcelain -- packages` (empty, verified); and an exhaustive
  `git show --name-only` over all three of my commits confirming they touch
  exactly the three permitted files and nothing else. All three passed.

**3. [Reporting] Two extra columns added to every tier table**

- `mean pred` and `mean actual` were added beside MAE/RMSE/SIGNED. A signed
  error of +27.652 is unreadable without knowing whether the scoreboard it sits
  on is 50 points or 500. These two columns are what make the predicted/actual
  ratio (1.138 vs 1.025 vs 0.920) computable directly from the table and let the
  result be stated in the same units as the motivating 1.128-vs-0.968 claim.

## TDD Gate Compliance

Task 3 carried `tdd="true"`, and the strict RED-before-GREEN commit order was
**not** followed: the implementation landed in tasks 1 and 2 (`feat`, `feat`) and
the tests in task 3 (`test`). That is the plan's own task ordering — task 3 is
defined as "unit tests, wiring, the full run" over an implementation tasks 1-2
were required to have already proven end-to-end — so the gate sequence
`test → feat` is structurally unreachable for this plan. Recorded here rather
than papered over. Tests were run and read (37/37), not merely written.

## Known Stubs

None. No placeholder values, no `TODO`/`FIXME`, no skipped tests, no unrun
`<verify>` block. Every verification in the plan was executed and its output
read.

## Threat Flags

None. This task creates no network endpoint, no auth path, no new file-access
pattern and no schema change. It opens `data/corpus.sqlite` read-only via the
existing `openCorpusReadOnly` helper, takes no secrets, and is explicitly wired
**without** `--env-file`.

## Self-Check: PASSED

- `scripts/measureAllianceReconstruction.ts` — FOUND
- `scripts/measureAllianceReconstruction.test.ts` — FOUND
- `package.json` `measure:alliance-reconstruction` — FOUND
- commit `d2f0c8ca` — FOUND
- commit `242ea68e` — FOUND
- commit `91178d17` — FOUND
- full-range run output with the quoted numbers — FOUND (`FULL RUN EXIT=0`)
