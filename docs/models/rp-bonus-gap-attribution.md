# F4 — which cause explains the multi-variable bonus gap (260913-tw1, 2026-09-13)

This record answers the ranking-points audit's F4 decision: "measure which cause dominates before
fixing anything". Every figure below comes from one file, `experiments/260913-tw1/results/aggregate.json`,
written by the probe named in "Reproducing this record". The probe and its output are gitignored.
This document is the committed copy of the result.

## Headline — read this first

**The dominant cause is the shape of the marginals, not dependence between variables.** On the six
multi-variable bonus cells, replacing each threshold variable's smooth Gaussian with a bounded
integer lattice (the "shape" arm) closes **70.9%** of the pooled calibration gap and improves the
pooled Brier by **0.0928** (0.2185 to 0.1258). Removing the independence assumption closes
**-1.0%**. It moves the pooled mean the wrong way and makes Brier slightly worse (+0.0006). The
walk-forward mean-deficit shift closes 16.1% (Brier -0.0198). The gate/selector oracle closes -2.1%
(Brier -0.0082).

**The same cause shows up on single-variable bonuses.** On the four single-variable controls, the
shape arm closes **35.2%** (Brier -0.0097) and the mean deficit closes 26.9% (Brier -0.0072).
Independence and the gate cannot move a single-variable cell, and they do not. So this is not a
multi-variable defect. Multi-variable bonuses are hit harder because a per-variable error
compounds across indicators and clauses. 2016 `breach` needs four of five such tails at once.

**What is left over.** All four suspects applied together (the combined arm, which is **not** part of
the one-at-a-time attribution) close 91.6% on multi-variable cells, leaving **8.4%** unexplained. On
controls they close 65.0%, leaving **35.0%**.

**Flags.** 2017 `rotor` overshoots under the shape arm: the gap closes 234.0%, so the prediction
moves from under (0.0416) to over (0.1500) the observed 0.0879. Brier still improves (-0.0062).
The shape-CC-only diagnostic (188.3%) and the combined arm (232.0%) overshoot rotor too, and the
combined arm overshoots 2018 `autoQuest` (103.9%). No arm closes calibration while making Brier
worse on any cell or pool. The independence arm makes Brier worse on `breach` (+0.0050), `rotor`
(+0.0080) and `cargoBonus` (+0.0004), and each of those also moves the mean away from observed.

This contradicts the audit's framing of F4. The within-bonus residual correlations are real, but
they are mixed in sign, not positive: -0.52 between 2017's auto and teleop rotor points, about -0.1
among 2016's defense positions 2 to 5, +0.51 between 2022's match and auto cargo. Once they are
put back in, they cancel or push the wrong way.

## What was measured

- **Model.** SPR through `SigmaScoutLayer`, constructed with two arguments `(ruleModule, "spr")` as
  the publisher does. The scored population matches the one `scripts/measureRpCalibration.ts` used
  for `-09c`: `includeOffseason: true`, one `runAll([spr])` per season, and an observation wherever
  `actualBonusFlagsForSeason` is non-null and the layer's `redBonusRp`/`blueBonusRp` is defined
  with a matching length.
- **Seasons.** 2016, 2017, 2018, 2019, 2020 and 2022 only. The probe refuses any other season before
  it opens the corpus. Nothing from 2023 or later was read.
- **Walk-forward, predict before update.** Each side's moments are read from the layer's accumulator
  before `foldPlayed` folds the match in. Every arm's running statistic is built only from earlier
  matches. It is updated only after both sides of a match have been predicted.
- **The four suspects, each removed on its own against the same baseline:**
  - **Independence.** A league-pooled Pearson correlation of standardized residuals
    `(observed - predicted mean) / predicted sd`, walk-forward, per variable pair. It stays zero until
    a pair has 500 prior joint observations, and |rho| is clamped to 0.999. Two-clause conjunctions
    and the 2022 mixture use the bivariate normal (Genz's BVNU). Linear sums add the covariance term.
    2016 `breach` uses a seeded 5-dimensional Monte Carlo with an identity control variate.
  - **Gate/selector oracle (coop analogue).** 2018 `autoQuest` becomes P(autoRunPoints >= 15)
    times the observed `autoSwitchAtZero`. 2022 `cargoBonus` uses the observed quintet selector
    (`autoCargoTotal >= 5`, the rule module's definition) and still predicts the cargo branch.
  - **Integer shape.** Each variable becomes a discrete pmf on its lattice. The lattice has width
    n = (robust max - robust min) / step. It is beta-binomial when n <= 30, otherwise a discretized
    Gaussian. A clause is the exact tail of the convolution of its terms.
  - **Mean deficit.** Each variable's predicted mean is shifted by the running mean of
    (observed - predicted) over earlier fully-warm observations. The shift starts after 200 of them
    and applies to fully-warm rosters only, per the audit's F9 decision. Variances are unchanged.
- **Diagnostic and combined arms.** Shape-CC-only uses the discretized Gaussian for every variable,
  which separates continuity correction from bounded support. The combined arm uses the shape arm's
  marginals built from mean-shifted moments, a Gaussian copula at the independence arm's
  correlation, and the gate oracle as conditioning.
- **Monte Carlo.** K = 4000 draws, `fnv1a32("matchKey:side:bonus:arm")` seeds into mulberry32 with
  Box-Muller normals, common random numbers against the identity correlation. The SE rule
  (pooled MC SE below a tenth of |arm mean - base mean|) held for every MC cell at K = 4000, so no
  season was rerun at 16000.
- **Reproduction proof.** Over all 267,324 scored (alliance, bonus) observations, the probe's
  baseline equals the layer's published bonus probability with **0 mismatches at 1e-9** (maximum
  absolute difference 0). The probe's own predicate evaluator with every suspect switched off equals
  that baseline with **0 mismatches at 1e-12** (maximum difference 0).
- **`-09c` match.** All 11 in-window cells match `data/baselines/rp-calibration-2026-09c.json`. n is
  exact, and the observed rate, mean predicted and Brier differ by exactly 0. `-09c` was measured with
  `spr 3.0.0+baseline`; this probe ran `spr 4.0.0+baseline` (commit `b8eb402e`). The bonus path does
  not read SPR's ratings, and the identical figures confirm that commit moved no bonus number.
- **Provenance.** The packages tree `HEAD:packages` was `7c922e94` for every season run and for the
  aggregate. The uncommitted packages diff was empty for every run, and `git status --short --
  packages scripts` was empty at every run's start and finish. HEAD moved between runs because
  another session committed outside `packages/`: 2018 ran at `9a805b21`, 2016 started at `1924c1ff`
  and finished at `d2560c97` with the packages tree unchanged, and 2017, 2019, 2020, 2022 and the
  aggregate ran at `d2560c97`.

## Coopertition cannot be measured in this window

Among the seasons this project registers, coopertition first appears in 2023. It does not exist in
2016-2022, so the coop branch itself was not measured, and nothing from 2023 or later was read to get
it.

What was run instead is the gate/selector oracle, the closest in-window analogue: 2022
`cargoBonus`'s quintet selector and 2018 `autoQuest`'s `autoSwitchAtZero` gate. They are not the
same kind of oracle. `autoQuest`'s gate is one of that bonus's own two clauses, so its oracle
conditions on half of the outcome. It is an upper bound on what a gate can explain, and it is not
comparable with `cargoBonus`'s selector, which only picks which cargo threshold applies.

Even as an upper bound it explains little. The gate arm closes -9.6% on `autoQuest` (the mean falls
from 0.1802 to 0.1504 against an observed 0.4889) and 7.2% on `cargoBonus`. Pooled over the two gated
cells it closes -5.5%. It does improve Brier on both cells (-0.0344 and -0.0097), because knowing the
gate sharpens individual predictions even where it does not lift the average.

## Every cell

Baseline per cell:

| Cell | Class | n | Observed | Base mean predicted | Base Brier |
|---|---|---:|---:|---:|---:|
| 2016 `breach` | multi-variable | 22,158 | 0.6998 | 0.0247 | 0.6607 |
| 2016 `capture` | multi-variable | 22,158 | 0.1298 | 0.0232 | 0.1121 |
| 2017 `kPa` | multi-variable | 25,386 | 0.0305 | 0.0015 | 0.0292 |
| 2017 `rotor` | multi-variable | 25,386 | 0.0879 | 0.0416 | 0.0682 |
| 2018 `autoQuest` | multi-variable | 28,312 | 0.4889 | 0.1802 | 0.3056 |
| 2022 `cargoBonus` | multi-variable | 24,128 | 0.3399 | 0.2206 | 0.1655 |
| 2018 `faceTheBoss` | control | 28,312 | 0.0877 | 0.0229 | 0.0783 |
| 2019 `habDocking` | control | 29,858 | 0.4132 | 0.2494 | 0.2171 |
| 2020 `shieldOperational` | control | 7,640 | 0.1465 | 0.0430 | 0.1294 |
| 2022 `hangarBonus` | control | 24,128 | 0.4368 | 0.3523 | 0.1970 |

Each arm, written as **mean predicted / share of gap closed / Brier delta** (negative Brier delta is
better). Shape-CC-only is a diagnostic. Combined is not part of the attribution.

| Cell | Independence | Gate oracle | Shape | Shape-CC-only | Mean deficit | Combined |
|---|---:|---:|---:|---:|---:|---:|
| 2016 `breach` | 0.0215 / -0.5% / +0.0050 | 0.0247 / 0.0% / +0.0000 | 0.5003 / 70.4% / -0.4432 | 0.2258 / 29.8% / -0.2589 | 0.0420 / 2.6% / -0.0270 | 0.6157 / 87.5% / -0.4691 |
| 2016 `capture` | 0.0287 / 5.2% / -0.0027 | 0.0232 / 0.0% / +0.0000 | 0.0572 / 31.8% / -0.0155 | 0.0484 / 23.6% / -0.0128 | 0.0358 / 11.7% / -0.0069 | 0.0974 / 69.5% / -0.0249 |
| 2017 `kPa` | 0.0023 / 2.7% / -0.0005 | 0.0015 / 0.0% / +0.0000 | 0.0023 / 2.7% / -0.0003 | 0.0016 / 0.4% / -0.0001 | 0.0016 / 0.3% / -0.0001 | 0.0039 / 8.3% / -0.0010 |
| 2017 `rotor` | 0.0161 / -54.9% / +0.0080 | 0.0416 / 0.0% / +0.0000 | 0.1500 / 234.0% / -0.0062 **overshoot** | 0.1288 / 188.3% / -0.0091 **overshoot** | 0.0571 / 33.5% / -0.0045 | 0.1491 / 232.0% / -0.0087 **overshoot** |
| 2018 `autoQuest` | 0.1898 / 3.1% / -0.0056 | 0.1504 / -9.6% / -0.0344 | 0.4391 / 83.8% / -0.1135 | 0.4373 / 83.3% / -0.1073 | 0.2826 / 33.2% / -0.0630 | 0.5011 / 103.9% / -0.2176 **overshoot** |
| 2022 `cargoBonus` | 0.2200 / -0.5% / +0.0004 | 0.2292 / 7.2% / -0.0097 | 0.2403 / 16.5% / -0.0062 | 0.2391 / 15.6% / -0.0059 | 0.2623 / 35.0% / -0.0111 | 0.2890 / 57.3% / -0.0340 |
| 2018 `faceTheBoss` | 0.0229 / 0.0% / +0.0000 | 0.0229 / 0.0% / +0.0000 | 0.0217 / -2.0% / -0.0003 | 0.0290 / 9.4% / -0.0018 | 0.0311 / 12.5% / -0.0023 | 0.0314 / 13.1% / -0.0038 |
| 2019 `habDocking` | 0.2494 / 0.0% / +0.0000 | 0.2494 / 0.0% / +0.0000 | 0.3407 / 55.8% / -0.0251 | 0.3295 / 48.9% / -0.0228 | 0.2941 / 27.3% / -0.0145 | 0.3919 / 87.0% / -0.0302 |
| 2020 `shieldOperational` | 0.0430 / 0.0% / +0.0000 | 0.0430 / 0.0% / +0.0000 | 0.0706 / 26.7% / -0.0054 | 0.0529 / 9.5% / -0.0027 | 0.0572 / 13.7% / -0.0038 | 0.0871 / 42.6% / -0.0084 |
| 2022 `hangarBonus` | 0.3523 / 0.0% / +0.0000 | 0.3523 / 0.0% / +0.0000 | 0.3715 / 22.7% / -0.0031 | 0.3715 / 22.7% / -0.0031 | 0.3895 / 44.1% / -0.0048 | 0.4094 / 67.5% / -0.0063 |

Reference row, **excluded from every pool** because its oracle is the outcome by construction:

| Cell | n | Observed | Base mean | Gate oracle | Combined |
|---|---:|---:|---:|---:|---:|
| 2019 `completeRocket` (declared `constant`) | 29,858 | 0.0473 | 0.0000 | 0.0473 / 100.0% / -0.0473 | 0.0473 / 100.0% / -0.0473 |

## Pooled

Observation-weighted over raw sums. The format is **mean predicted / share closed / Brier delta**.

| Pool | n | Observed | Base mean | Base Brier | Independence | Gate oracle | Shape | Shape-CC-only | Mean deficit | Combined |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Multi-variable (6 cells) | 147,528 | 0.2944 | 0.0853 | 0.2185 | 0.0831 / -1.0% / +0.0006 | 0.0810 / -2.1% / -0.0082 | 0.2335 / **70.9%** / -0.0928 | 0.1867 / 48.5% / -0.0640 | 0.1189 / 16.1% / -0.0198 | 0.2768 / 91.6% / -0.1232 |
| Controls (4 cells) | 89,938 | 0.2944 | 0.1882 | 0.1606 | 0.1882 / 0.0% / +0.0000 | 0.1882 / 0.0% / +0.0000 | 0.2256 / **35.2%** / -0.0097 | 0.2227 / 32.5% / -0.0092 | 0.2168 / 26.9% / -0.0072 | 0.2572 / 65.0% / -0.0136 |
| Gated cells (`autoQuest`, `cargoBonus`) | 52,440 | 0.4204 | 0.1988 | 0.2411 | 0.2037 / 2.2% / -0.0028 | 0.1866 / **-5.5%** / -0.0230 | 0.3476 / 67.2% / -0.0641 | 0.3461 / 66.5% / -0.0607 | 0.2733 / 33.6% / -0.0391 | 0.4035 / 92.4% / -0.1331 |
| Sensitivity: multi-variable without `breach` | 125,370 | 0.2228 | 0.0960 | 0.1404 | 0.0940 / -1.5% / -0.0001 | 0.0909 / -4.0% / -0.0096 | 0.1863 / 71.3% / -0.0309 | 0.1797 / 66.1% / -0.0295 | 0.1325 / 28.8% / -0.0185 | 0.2170 / 95.4% / -0.0620 |

The observed rates of the multi-variable and control pools are both 0.2944. That is a coincidence of
the two sets of cells, checked against the raw sums, not a copying error.

`breach` carries the largest absolute gap, so the sensitivity row drops it. Shape still dominates
without it (71.3%). Mean deficit roughly doubles (28.8%). Independence stays at about zero (-1.5%).
Without `breach`, shape-CC-only closes almost as much as shape (66.1% against 71.3%). So bounded
support matters mainly for `breach`, whose threshold of 2 crossings is the lattice ceiling; the rest
of the shape gain is continuity correction.

## Supporting measurements

**Final residual correlations** (walk-forward, end of season, pair count in brackets). No PSD repair
was needed in any season (0 repairs, minimum shrink factor 1).

| Season | Footprint | Pair | rho (n) |
|---|---|---|---|
| 2016 | `breach` | position1 with positions 2, 3, 4, 5 | +0.072, +0.063, +0.047, +0.061 (18,900 to 18,927) |
| 2016 | `breach` | position2-3, 2-4, 2-5 | -0.092, -0.102, -0.107 (20,555 to 20,594) |
| 2016 | `breach` | position3-4, 3-5, 4-5 | -0.103, -0.102, -0.089 (20,562 to 20,608) |
| 2016 | `capture` | attackedTowerEndStrength with teleopChallengePoints | -0.197 (20,689) |
| 2016 | `capture` | attackedTowerEndStrength with teleopScalePoints | -0.077 (17,161) |
| 2016 | `capture` | teleopChallengePoints with teleopScalePoints | -0.285 (17,154) |
| 2017 | `kPa` | autoFuelPoints with teleopFuelPoints | +0.297 (20,770) |
| 2017 | `rotor` | autoRotorPoints with teleopRotorPoints | -0.518 (23,275) |
| 2018 | `autoQuest` | autoRunPoints with autoSwitchOwnershipSec | +0.182 (26,487) |
| 2022 | `cargoBonus` | matchCargoTotal with autoCargoTotal | +0.510 (22,747) |

**Support table** (lattice step, robust range, treatment). Robust min is the smallest value holding at
least 1% of observations at or below it. Robust max is the mirror image. The step is the gcd of the
non-zero values holding at least 0.1%.

| Season | Variable | Step | Robust range | n | Treatment | Raw range |
|---|---|---:|---|---:|---|---|
| 2016 | position1..5crossings | 1 | [0, 2] | 2 | beta-binomial | [0, 2] |
| 2016 | attackedTowerEndStrength | 1 | [-5, 9] | 14 | beta-binomial | [-13, 12] |
| 2016 | teleopChallengePoints | 5 | [0, 15] | 3 | beta-binomial | [0, 15] |
| 2016 | teleopScalePoints | 15 | [0, 30] | 2 | beta-binomial | [0, 45] |
| 2017 | autoFuelPoints | 1 | [0, 28] | 28 | beta-binomial | [0, 54] |
| 2017 | teleopFuelPoints | 1 | [0, 31] | 31 | discretized-gaussian | [0, 64] |
| 2017 | autoRotorPoints | 60 | [0, 60] | 1 | beta-binomial (Bernoulli) | [0, 120] |
| 2017 | teleopRotorPoints | 40 | [40, 160] | 3 | beta-binomial | [0, 160] |
| 2018 | autoRunPoints | 5 | [5, 15] | 2 | beta-binomial | [0, 15] |
| 2018 | autoSwitchOwnershipSec | 1 | [0, 12] | 12 | beta-binomial | [0, 13] |
| 2018 | endgamePoints | 5 | [0, 90] | 18 | beta-binomial | [0, 90] |
| 2019 | habClimbPoints | 3 | [0, 24] | 8 | beta-binomial | [0, 36] |
| 2020 | endgamePoints | 5 | [0, 90] | 18 | beta-binomial | [0, 90] |
| 2022 | matchCargoTotal | 1 | [0, 43] | 43 | discretized-gaussian | [0, 71] |
| 2022 | autoCargoTotal | 1 | [0, 7] | 7 | beta-binomial | [0, 12] |
| 2022 | endgamePoints | 1 | [0, 36] | 36 | discretized-gaussian | [0, 45] |

The 2016 defense positions resolve to [0, 2], as expected. The rare 3 falls outside the robust range.
The share rule trims some real values: 2018 `autoRunPoints` loses 0 (0.64% of sides), 2017
`autoRotorPoints` loses 120 and `teleopRotorPoints` loses 0, and 2016 `teleopScalePoints` loses 45.
The 2017 `rotor` overshoot involves both trimmed rotor ranges. That link is not proven, but it is the
first thing to check before building a lattice fix.

**Beta-binomial fit counters** (per term evaluation, all arms that build a lattice). Overdispersion
beyond the beta-binomial limit, clamped at rho_bb = 0.999: 85,585 in 2016, 1,173 in 2017, 8,295 in
2018, 1 in 2019, 2 in 2020, 50 in 2022. Mean outside the robust range (point mass at the nearer end):
6,750 / 748 / 4,304 / 0 / 0 / 0. Zero-variance terms kept as a point mass at the real mean: 51,216 /
31,095 / 12,682 / 5,079 / 3,630 / 12,081.

**Final mean deficits** (observed minus predicted, fully-warm rosters, end of season):

| Season | Variable | Deficit | Observed mean |
|---|---|---:|---:|
| 2016 | position1..5crossings | +0.040, +0.072, +0.084, +0.084, +0.059 | 1.41 to 1.90 |
| 2016 | attackedTowerEndStrength | -0.526 | 3.878 |
| 2016 | teleopChallengePoints / teleopScalePoints | +0.740 / +0.406 | 9.472 / 2.537 |
| 2017 | autoFuelPoints / teleopFuelPoints | +0.249 / +0.286 | 1.726 / 1.875 |
| 2017 | autoRotorPoints / teleopRotorPoints | +3.755 / +3.903 | 29.567 / 85.307 |
| 2018 | autoRunPoints / autoSwitchOwnershipSec / endgamePoints | +0.750 / +0.537 / +3.132 | 13.246 / 5.111 / 46.870 |
| 2019 | habClimbPoints | +0.757 | 12.143 |
| 2020 | endgamePoints | +3.384 | 32.653 |
| 2022 | matchCargoTotal / autoCargoTotal / endgamePoints | +1.681 / +0.280 / +1.186 | 15.736 / 2.765 / 14.686 |

Share of observations shifted: 20,545 of 22,158 (2016), 23,693 of 25,386 (2017), 26,453 of 28,312
(2018), 27,956 of 29,858 (2019), 6,696 of 7,640 (2020), 22,523 of 24,128 (2022).

**Monte Carlo** (K = 4000 everywhere, SE rule met on every cell):

| Cell | Arm | Pooled MC SE of mean predicted | Brier noise floor |
|---|---|---:|---:|
| 2016 `breach` | independence | 1.01e-5 | 5.07e-6 |
| 2016 `breach` | combined | 2.21e-5 | 3.88e-5 |
| 2016 `capture` | combined | 1.27e-5 | 1.73e-5 |
| 2017 `kPa` | combined | 3.96e-6 | 8.99e-7 |
| 2017 `rotor` | combined | 2.86e-5 | 2.72e-5 |

The control-variate estimate fell outside [0, 1] and was clamped 125 times (2016 independence),
36 times (2016 combined) and 15 times (2017 combined). The combined arm fell back to the unconditioned branch where the conditioning probability was 0: 311
times in 2018 and 50 times in 2022. The 2022 quintet selector derived from
`autoCargoTotal >= 5` agrees with TBA's `quintetAchieved` on 24,108 of 24,128 sides.

## What this does not show

- **The coop branch itself.** See above. It does not exist in-window.
- **Transfer to later seasons.** The audit's worst later bonuses (`coralBonus`, `autoBonus`,
  `ensembleBonus`) have different predicate shapes and a relaxed coopertition branch. These in-window
  results may not carry over to them, and this probe did not read those seasons to find out.
- **Look-ahead in the support.** The lattice step and robust range come from the whole season's scored
  observations. They are rule facts (scoring increments and working ceilings), not fitted parameters,
  but they are disclosed here as look-ahead.
- **Partial rosters.** The mean-deficit arm deliberately leaves partial rosters unshifted, per F9.
- **Calibration versus accuracy.** A share is calibration-in-the-large only. A share gain with a worse
  Brier would not be a fix. None of the shape or mean-deficit results is of that kind, but the rotor
  overshoot shows a share above 1 can still hide a new miscalibration.
- **The combined arm is not an attribution.** Its gate oracle uses the outcome, so it is not a
  predictor anyone could ship, and its share is not the sum of the parts.
- **Negative binomial.** This probe did not test it. Its earlier retest found a real improvement and
  was closed on cost, not on result. Nothing here says negative binomial does not help.
- **Nothing published changed.** No artifact, baseline, R2 object or package source was touched.

## Fix candidates the evidence supports

1. **Discrete lattice marginals (shape).** Declare each threshold variable's lattice step and working
   range, and evaluate clauses as exact lattice tails and convolutions instead of Gaussian sums. This
   touches `packages/core/rankingPoints/marginals.ts` (a new family), `analyticPmf.ts`
   (`clauseProbability`) and the in-window rule modules' declarations. Measured: 70.9% multi-variable,
   Brier -0.0928; 35.2% controls, Brier -0.0097. Check the rotor overshoot first.
2. **Continuity correction only.** Shift the Gaussian tails by half a lattice step, with the step
   declared per variable. This touches the Gaussian branch of `probAtLeast`/`probAtMost` in
   `marginals.ts` and the rule modules' declarations. Measured: 48.5% multi-variable, Brier -0.0640;
   32.5% controls, Brier -0.0092. It is the smaller change, and it keeps most of the shape gain outside
   `breach`.
3. **Walk-forward mean shift on fully-warm rosters.** Carry a league running residual per variable
   and add it to the predicted mean. This touches `empiricalMoments.ts` (`momentsFor`) and its D1 seed
   state. Measured: 16.1% multi-variable, Brier -0.0198; 26.9% controls, Brier -0.0072. It stacks with
   either fix above, but this probe did not measure that pair on its own.

Not supported: a correlated joint for the threshold variables. It closes -1.0% pooled and worsens
Brier.

Any fix is a new knob. It must be inert at its default and earn promotion on the 2016-2022 selection
slice, and the later reporting slice stays unspent.

Decision (Jacob, 2026-09-13): build candidates 1 and 3 as two separate knobs. Each starts inert and
must earn promotion on its own. Ranges are declared from the game rules, not from season data.

## Reproducing this record

`experiments/` is gitignored, so the probe exists at this path in the working tree, not in git
history. It ran against packages tree `7c922e94` (HEAD `d2560c97` for the aggregate).

```
npx tsx experiments/260913-tw1/bonusGapAttribution.ts --selftest
npx tsx experiments/260913-tw1/bonusGapAttribution.ts --only 2016
npx tsx experiments/260913-tw1/bonusGapAttribution.ts --only 2017
npx tsx experiments/260913-tw1/bonusGapAttribution.ts --only 2018
npx tsx experiments/260913-tw1/bonusGapAttribution.ts --only 2019
npx tsx experiments/260913-tw1/bonusGapAttribution.ts --only 2020
npx tsx experiments/260913-tw1/bonusGapAttribution.ts --only 2022
npx tsx experiments/260913-tw1/bonusGapAttribution.ts --aggregate
```

Each season takes seconds to under a minute. 2016 is the slowest, because of the 5-dimensional Monte
Carlo.
