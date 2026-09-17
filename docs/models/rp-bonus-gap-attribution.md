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
slice. 2023-2026 was released for use on 2026-09-14 (quick task 260914-ndu).

Decision (Jacob, 2026-09-13): build candidates 1 and 3 as two separate knobs. Each starts inert and
must earn promotion on its own. Ranges are declared from the game rules, not from season data.
**Shipped 2026-09-14 (quick task 260914-01x):** both knobs were accepted by a bar committed before
any figure existed, and lattice+meanShift shipped in code. It is published in the next generation.
See the outcome section at the end of this document.

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

---

## Outcome: lattice marginals and the mean shift measured and shipped (2026-09-14, quick task 260914-01x)

Everything above is the tw1 probe. This section is the real build: both knobs were built in
`packages/core`, measured through `scripts/measureRpCalibration.ts`'s publisher-identical scorer
against a bar committed first, and the arm that bar chose shipped. **It is shipped in code and
published in the next generation.** Until that publish lands, the live site still shows the
pre-lattice odds.

### The bar, then the record

The bar is `applyRpBonusArmBar` in `scripts/measureRpCalibration.ts`, committed in `012bea91`
before any code that could produce an arm figure. An arm is accepted only when BOTH its pooled
bonus Brier AND its pooled total-RP RPS are strictly lower than control's, with no tolerance. The
accepted arm with the lowest pooled RPS ships. Ties break on bonus Brier, then on the order
lattice, meanShift, lattice+meanShift. If no arm is accepted, nothing ships.

The record is `data/baselines/rp-bonus-arms-2026-09.json` (`4921dabf`). It comes from one run of
`--seasons 2016-2020,2022 --algorithm spr --bonus-arms` at `8b1fed09`, with a clean packages and
scripts tree at start and end. There was no re-run. A test (`fa766899`) re-applies the bar to the
record's own pooled figures and requires the recorded verdict. At the time, the measurement code
refused any season from 2023 on and any algorithm other than `spr` before the corpus opened; the
season refusal was removed when 2023-2026 was released for use on 2026-09-14 (quick task 260914-ndu). **The 2023-2026 slice was never used to
accept anything.**

### Pooled, 2016-2020 and 2022 (267,324 bonus and 137,482 total-RP observations)

| arm | bonus Brier | delta | total-RP RPS | delta | mean predicted bonus | mean predicted RP | verdict |
|---|---:|---:|---:|---:|---:|---:|---|
| control | 0.179914 | — | 0.159627 | — | 0.1104 | 1.2146 | — |
| lattice | 0.126571 | -0.053343 | 0.143114 | -0.016513 | 0.2068 | 1.4021 | accepted |
| meanShift | 0.166592 | -0.013322 | 0.155001 | -0.004626 | 0.1386 | 1.2694 | accepted |
| lattice+meanShift | **0.124278** | **-0.055636** | **0.141956** | **-0.017670** | 0.2513 | 1.4887 | **accepted, shipped** |

Observed bonus rate 0.2668, actual mean RP 1.5231. All three arms were accepted, and
lattice+meanShift has the lowest RPS, so it shipped with no override.

By cell class (share of the gap to observed closed, and Brier):

| arm | multi-variable closed | multi-variable Brier | single-variable closed | single-variable Brier |
|---|---:|---:|---:|---:|
| control | — | 0.2185 | — | 0.1606 |
| lattice | 75.3% | 0.1270 | 26.7% | 0.1522 |
| meanShift | 16.1% | 0.1988 | 26.9% | 0.1534 |
| lattice+meanShift | **104.8%** | 0.1258 | 55.9% | 0.1474 |

**The multi-variable pool overshoots at 104.8%.** Its mean prediction now sits slightly above
observed rather than far below it, and its Brier still improves.

**Why lattice closes 75.3% here where the probe closed 70.9%.** The ranges come from the game rules,
not from season data. The probe used robust ranges taken from each season's data, with a width
rule; this build declares each range from the manual. The two are different models, so they should
not agree exactly.

### Per season (reported, not a gate)

Bonus Brier and total-RP RPS per arm, then the mean predicted bonus rate and mean predicted RP under
control and the shipped arm against what happened.

| season | control Brier / RPS | lattice | meanShift | lattice+meanShift | bonus rate: control, shipped, observed | RP: control, shipped, actual |
|---|---|---|---|---|---|---|
| 2016 | 0.3864 / 0.2276 | 0.1577 / 0.1596 | 0.3695 / 0.2208 | 0.1411 / 0.1544 | 0.0240, 0.3439, 0.4148 | 1.048, 1.688, 1.830 |
| 2017 | 0.0487 / 0.1232 | 0.0489 / 0.1217 | 0.0464 / 0.1224 | **0.0526** / 0.1224 | 0.0215, 0.1085, 0.0592 | 1.043, 1.217, 1.118 |
| 2018 | 0.1919 / 0.1587 | 0.1346 / 0.1386 | 0.1593 / 0.1478 | 0.1433 / 0.1405 | 0.1016, 0.3220, 0.2883 | 1.203, 1.644, 1.577 |
| 2019 | 0.1322 / 0.1464 | 0.1206 / 0.1422 | 0.1249 / 0.1438 | 0.1173 / 0.1408 | 0.1247, 0.1889, 0.2303 | 1.249, 1.378, 1.479 |
| 2020 | 0.1294 / 0.1704 | 0.1240 / 0.1692 | 0.1256 / 0.1695 | 0.1210 / 0.1685 | 0.0430, 0.0871, 0.1465 | 1.043, 1.087, 1.146 |
| 2022 | 0.1813 / 0.1496 | 0.1781 / 0.1486 | 0.1733 / 0.1467 | 0.1710 / 0.1459 | 0.2864, 0.3370, 0.3884 | 1.573, 1.674, 1.779 |

**2017's bonus Brier is 0.0039 worse under the shipped arm** (0.0487 to 0.0526), driven by `rotor`
below. Its RPS still improves. Every other season improves on both figures.

### Per cell (reported, not a gate)

Each arm cell gives mean predicted, the Brier change against control, and the share of the gap
closed.

| season | bonus | class | n | observed | control mean / Brier | lattice | meanShift | lattice+meanShift |
|---|---|---|---:|---:|---|---|---|---|
| 2016 | breach | multi | 22158 | 0.6998 | 0.0247 / 0.6607 | 0.5003, -0.4432, 70.4% | 0.0420, -0.0270, 2.6% | 0.6102, -0.4689, 86.7% |
| 2016 | capture | multi | 22158 | 0.1298 | 0.0232 / 0.1121 | 0.0527, -0.0143, 27.7% | 0.0358, -0.0069, 11.7% | 0.0775, -0.0218, 50.9% |
| 2017 | kPa | multi | 25386 | 0.0305 | 0.0015 / 0.0292 | 0.0017, -0.0001, 0.5% | 0.0016, -0.0001, 0.3% | 0.0018, -0.0002, 0.9% |
| 2017 | rotor | multi | 25386 | 0.0879 | 0.0416 / 0.0682 | 0.1827, +0.0006, 304.6% | 0.0571, -0.0045, 33.5% | 0.2152, **+0.0080**, **374.7%** |
| 2018 | autoQuest | multi | 28312 | 0.4889 | 0.1802 / 0.3056 | 0.4626, -0.1145, 91.5% | 0.2826, -0.0630, 33.2% | 0.6127, -0.0935, **140.1%** |
| 2018 | faceTheBoss | single | 28312 | 0.0877 | 0.0229 / 0.0783 | 0.0217, -0.0003, -2.0% | 0.0311, -0.0023, 12.5% | 0.0314, -0.0038, 13.1% |
| 2019 | habDocking | single | 29858 | 0.4132 | 0.2494 / 0.2171 | 0.3275, -0.0233, 47.7% | 0.2941, -0.0145, 27.3% | 0.3778, -0.0297, 78.4% |
| 2019 | completeRocket | constant | 29858 | 0.0473 | 0.0000 / 0.0473 | 0.0000, 0.0000, 0.0% | 0.0000, 0.0000, 0.0% | 0.0000, 0.0000, 0.0% |
| 2020 | shieldOperational | single | 7640 | 0.1465 | 0.0430 / 0.1294 | 0.0706, -0.0054, 26.7% | 0.0572, -0.0038, 13.7% | 0.0871, -0.0084, 42.6% |
| 2022 | cargoBonus | multi | 24128 | 0.3399 | 0.2206 / 0.1655 | 0.2391, -0.0059, 15.6% | 0.2623, -0.0111, 35.0% | 0.2832, -0.0151, 52.5% |
| 2022 | hangarBonus | single | 24128 | 0.4368 | 0.3523 / 0.1970 | 0.3543, -0.0003, 2.3% | 0.3895, -0.0048, 44.1% | 0.3907, -0.0053, 45.5% |

**2018 `autoQuest` overshoots** at 140.1% of the gap closed under the shipped arm, but its Brier
still improves by 0.0935.

### The 2017 rotor check

| arm | mean predicted | observed | Brier | overshoot |
|---|---:|---:|---:|---|
| control | 0.0416 | 0.0879 | 0.0682 | no |
| lattice | 0.1827 | 0.0879 | 0.0688 | **yes** |
| meanShift | 0.0571 | 0.0879 | 0.0637 | no |
| lattice+meanShift | 0.2152 | 0.0879 | 0.0762 | **yes** |

**Rotor overshoots, and this is a real cost of the ship.** Under the shipped arm its gap closes
374.7% and its Brier gets 0.0080 worse. Under lattice alone the Brier is only 0.0006 worse. The
probe saw the same overshoot (234.0% under its shape arm).

The likely cause is not fixed. The lattice evaluates `rotor` by summing auto and teleop rotor points
as independent terms. The real game caps an alliance at four rotors in total, across both periods.
Summing the two independently puts probability on combinations the field cannot produce, so the
four-rotor tail gets too much mass. The bar is pooled and does not gate on one cell, so rotor did not
block the ship. It is recorded here as a known defect.

### Lattice declarations (rules only)

Every threshold variable in all ten registered seasons declares a lattice support in its season
module. Each value is taken from the game rules and the manuals and carries a one-line rule citation
beside it. `packages/core/rankingPoints/rules.test.ts` pins the 34 pairs by set equality. No script
or test reads 2023-2026 corpus data to derive or check them.

| Season | Variable | step | min | max | Rule basis |
|---|---|---:|---:|---:|---|
| 2016 | position1crossings .. position5crossings | 1 | 0 | 2 | a DEFENSE is damaged at 2 crossings and further crossings do not count |
| 2016 | attackedTowerEndStrength | 1 | (none) | (none) | strength counts down with no floor and its start is tier-dependent |
| 2016 | teleopChallengePoints | 5 | 0 | 15 | CHALLENGE 5 per robot, 3 robots |
| 2016 | teleopScalePoints | 15 | 0 | 45 | SCALE 15 per robot, 3 robots |
| 2017 | autoFuelPoints | 1 | 0 | (none) | no fuel cap |
| 2017 | teleopFuelPoints | 1 | 0 | (none) | no fuel cap |
| 2017 | autoRotorPoints | 60 | 0 | 120 | 60 per rotor turning at end of AUTO; AUTO gears can finish rotors 1 and 2 only |
| 2017 | teleopRotorPoints | 40 | 0 | 160 | 40 per rotor, 4 rotors, counted apart from AUTO rotors |
| 2018 | autoRunPoints | 5 | 0 | 15 | AUTO-RUN 5 per robot, 3 robots |
| 2018 | autoSwitchOwnershipSec | 1 | 0 | 15 | AUTO lasts 15 s, recorded in whole seconds |
| 2018 | endgamePoints | 5 | 0 | 90 | PARK 5, CLIMB 30 per robot (LEVITATE credits one climb), 3 robots |
| 2019 | habClimbPoints | 3 | 0 | 36 | HAB climb 3/6/12 per robot, 3 robots |
| 2020 | endgamePoints | 5 | 0 | 90 | PARK 5, HANG 25 per robot, LEVEL 15 once |
| 2022 | matchCargoTotal | 1 | 0 | (none) | no cargo cap |
| 2022 | autoCargoTotal | 1 | 0 | (none) | no AUTO cargo cap (human players may score too) |
| 2022 | endgamePoints | 1 | 0 | 45 | LOW 4 / MID 6 / HIGH 10 / TRAVERSAL 15 per robot, gcd 1 |
| 2023 | totalChargeStationPoints | 2 | 0 | 42 | AUTO DOCKED 8 / ENGAGED 12 (1 robot); endgame PARK 2 / DOCKED 6 / ENGAGED 10 per robot |
| 2023 | linkPoints | 5 | 0 | 45 | LINK 5; 3 rows of 9 nodes, so 9 links |
| 2024 | noteCount | 1 | 0 | (none) | no NOTE cap |
| 2024 | endGameTotalStagePoints | 1 | 0 | 31 | ONSTAGE 3 (4 SPOTLIT), HARMONY 2 per additional robot, TRAP 5 (3 traps) |
| 2024 | onStageRobotCount | 1 | 0 | 3 | 3 robots |
| 2025 | trough | 1 | 0 | (none) | manual sets no L1 limit |
| 2025 | botRow, midRow, topRow | 1 | 0 | 12 | 12 BRANCHES per level |
| 2025 | endGameBargePoints | 2 | 0 | 36 | PARK 2 / SHALLOW 6 / DEEP 12 per robot |
| 2025 | autoLineCount | 1 | 0 | 3 | 3 robots |
| 2025 | autoCoralCount | 1 | 0 | (none) | no AUTO coral limit |
| 2026 | hubTotalCount | 1 | 0 | (none) | manual sets no FUEL cap |
| 2026 | totalTowerPoints | 5 | 0 | 120 | AUTO LEVEL 1 15 (2 robots max); TELEOP LEVEL 1/2/3 10/20/30 per robot |

### How the build differs from the probe

- **Rule ranges, not robust ranges.** The probe took each range from the season's data. The build
  declares it from the rules. This is why lattice closes 75.3% of the multi-variable gap here and
  70.9% in the probe.
- **The bounded family whenever a max exists.** When a variable declares both min and max, it gets a
  beta-binomial matched to mean and variance, with a binomial fallback when the variance is at or
  below binomial and the overdispersion clamped at rho 0.999. The probe also required a narrow range
  before using the bounded family. Without a max, the variable gets a discretized Gaussian on its
  step.
- **Mass below min is lumped onto min.** The discretized Gaussian puts all probability below a
  declared min onto min. Single-variable tails use the closed form, and a pmf is built only for
  convolution, over plus or minus 8 sd with both tails lumped onto the end points.
- **`attackedTowerEndStrength` is unbounded.** 2016 tower strength counts down with no floor and
  starts at a tier-dependent value, so it declares `step: 1` with no min or max. It is the only
  variable allowed to omit min.
- **Multi-term clauses use exact lattice convolution.** Linear combinations and divisors (2016
  `capture`, 2017 `rotor`, 2023 `sustainabilityBonus`) are summed exactly, with steps aligned, so the
  family works where negative binomial throws. An out-of-range observed or fitted mean never throws;
  it is clamped into support.

### The mean shift

For each threshold variable, the model keeps a running mean of (observed minus predicted alliance
mean). It is per season, walk-forward and league-wide. Its population is exactly the probe's: bonus
comp levels, RP-eligible event types, a breakdown present, and both sides parsing inside one try.
Any parse failure skips the whole match. A side counts only when every roster team has history
before this match's fold. The residual is taken against the unshifted mean read before the fold. The
shift applies only to fully-warm rosters, and only after 200 prior observations of that variable.

What it did on the selection slice, from the record:

| season | sides scored | sides shifted | active after | final mean residuals |
|---|---:|---:|---|---|
| 2016 | 22158 | 20545 | 2016mndu2_qm12 | crossings +0.04 to +0.08, tower strength -0.53, challenge +0.74, scale +0.41 |
| 2017 | 25386 | 23693 | 2017miket_qm21 | auto fuel +0.25, teleop fuel +0.29, auto rotor +3.76, teleop rotor +3.90 |
| 2018 | 28312 | 26453 | 2018mawor_qm30 | auto run +0.75, switch seconds +0.54, endgame +3.13 |
| 2019 | 29858 | 27956 | 2019nhgrs_qm20 | hab climb +0.76 |
| 2020 | 7640 | 6696 | 2020isde2_qm44 | endgame +3.38 |
| 2022 | 24128 | 22523 | 2022miket_qm15 | match cargo +1.68, auto cargo +0.28, endgame +1.19 |

**Pre-schedule pricing.** Synthetic three-team rosters of real teams (`makeRankingPointFiller`) use
the same per-alliance fully-warm check. The field-averaged presim has no real roster, so it applies
the shift only when every team in the event roster has complete history. That is all-or-nothing and
decided once per event, following `buildFieldContributions`' existing convention. When no shift is
passed, the output is byte-identical to before.

**It is live state.** The shift serializes onto the spr league row as `sigmascoutRpMeanShift`, and
`STATE_SNAPSHOT_SHAPE_VERSION` is now 16 (`98c5bfa4`). The Worker and the state probe resume it,
apply it, observe before the fold, and write it back, as `SigmaScoutLayer` does. A parity test
builds a 120-match prior event, reaches at least 200 warm observations, and checks that live rows
equal the offline layer. With the Worker's write-back removed, that test goes red.

### Resolution tallies

| arm | lattice fits | gaussian fits | degenerate | fallbacks (including degenerate) |
|---|---:|---:|---:|---:|
| control | 0 | 434261 | 39365 | 39365 |
| lattice | 434261 | 0 | 39365 | 151155 |
| meanShift | 0 | 434261 | 39365 | 39365 |
| lattice+meanShift | 434261 | 0 | 39365 | 201940 |

**Adding the mean shift roughly doubles 2016's lattice fallbacks**, from 43,560 to 90,956 (not
counting degenerate fits). The cause is not diagnosed. The tally counts fallbacks but does not
record which reason fired (mean outside support, under-dispersed binomial or clamped
overdispersion), so this record cannot say.

### Worker CPU

A scratchpad benchmark (not committed) timed ranking-point pricing against Gaussian-declared
modules. The lattice pricing costs **+0.22 ms per 130-match tick**. The mean shift costs about
**+0.07 to 0.14 ms per tick**. Both are well inside the plan's 1.0 ms gate. The live tick is not
observed until the Worker is deployed.

### What was deleted at ship

In `f79a55aa`: the `--bonus-arms` and `--emit-bonus-arms` flags, the four-layer fold,
`ruleModuleWithLatticeArm`, `assertOutcomeHalfIdentical`, `bonusCellClass`, and
`SigmaScoutLayer`'s measurement-only third constructor argument. The layer now builds the mean shift
whenever it publishes RP, and all 34 variables declare `lattice`. The reader half stays, for any
future bonus-arm re-measurement: `applyRpBonusArmBar`, `RpBonusArmRecordSchema`, the slice and
algorithm guards, and the record test. The Gaussian and negative-binomial families stay in the
`MarginalFamily` union. `analyticPmfGolden` now runs against Gaussian-declared variants and keeps
characterizing that engine, with its JSON untouched. Winner predictions are byte-identical: the
level-1 digest is unedited and the outcome-half digest was pinned before the flip and is unchanged
after it.

### The published scorecard, re-emitted

`RP_CALIBRATION_MEASUREMENT_PATH` now points at `data/baselines/rp-calibration-2026-09e.json`,
measured with `--seasons 2016-2020,2022-2026 --algorithm spr` from the post-ship tree (`589ef10a`).
It covers the same ten seasons as `-09d`, because it is the published scorecard. **Its 2023-2026
figures are that scorecard's existing scope, not an acceptance use.** They were measured after the
ship decision, and nothing was changed in response to them. `-09d` stays frozen.

| scope | observations | mean predicted bonus | observed | bonus Brier | total-RP RPS |
|---|---:|---|---:|---|---|
| all ten seasons | 558,192 | 0.1384 to **0.2505** | 0.2941 | 0.1809 to **0.1365** | 0.1581 to **0.1424** |
| 2016-2020, 2022 | 267,324 | 0.1104 to 0.2513 | 0.2668 | 0.1799 to 0.1243 | 0.1596 to 0.1420 |
| 2023-2026 (reported) | 290,868 | 0.1641 to 0.2498 | 0.3193 | 0.1818 to 0.1477 | 0.1562 to 0.1429 |

Two cross-checks held. The `-09e` selection-slice pooled figures equal the shipped arm's figures in
the record to within 1.3e-15. The outcome blocks equal `-09d`'s in every one of the ten seasons. In
the reporting slice, 2026's bonus Brier is 0.00002 worse (0.085824 to 0.085844) and every other
figure improves.

### Owed, done by the next step (Task 9)

A full publish of all seasons, the D1 seed (shape 16) before the Worker deploy, the Worker deploy,
the push, and a check by content on the live site. Until then this model is shipped in code only.

The same quick task shipped F10: predicted bonus dots now fill to their odds (`a25ac39f`). See
`.planning/sketches/012-predicted-bonus-dots/README.md`.

As of 2026-09-17 the predicted dots render as three tiers — unlikely, toss-up, likely — cut at one
third and two thirds (quick task 260917-06d), superseding the display described above.
