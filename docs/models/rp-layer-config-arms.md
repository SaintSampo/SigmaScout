# RP layer config arms — the three switches 09-05 made selectable (2026-09-11)

This document is 09-05's deliverable to 09-06: what each of the three new `RpLayerConfig` branches
is, exactly how it is formulated, what evidence supports the 34 flipped `marginalFamily`
declarations, how to read the resolved-family observability this plan added, and the recorded (not
acted-on) answer to 09-RESEARCH.md's Open Question 3. **09-06 reads this document before planning
its own measurement.**

## What this document is

Plan 09-05 made three previously-declared-but-unreachable `RpLayerConfig` branches real:
`winSource: "p-red-win"` (D-13), `tieModel: "discrete-margin"` (D-14), and `marginal:
"negative-binomial"` (D-01). **None of the three is on in production.** The exported
`RP_LAYER_CONFIG_DEFAULT` in `packages/core/rankingPoints/analyticPmf.ts` still resolves every
field to its legacy member (`winSource: "score-draw"`, `tieModel: "continuous-equality"`, `marginal:
"gaussian"`), and neither `publishSeasons` nor `runEventMode` (`packages/harness/publish.ts`) nor any
production `SigmaScoutLayer` construction site passes an override.

This is D-05: the four changes ship together as one named, versioned config, and the offline harness
can instantiate any of the eight `{winSource, tieModel, marginal}` combinations, but production ships
exactly one — the legacy one — until 09-06 measures the others against 09-01's frozen baseline
(`data/baselines/rp-calibration-2026-09.json`) through the one published scorer
(`scripts/measureRpCalibration.ts`, D-11). The acceptance bar is per-bonus, not pooled: a majority of
individual bonuses must improve on Brier and no single bonus may get worse at all (D-09). A failed
marginal swap reverts to Gaussian alone while `winSource`/`tieModel` still land — D-10's explicit
per-field independence, which is only true because each is its own config field. Once 09-06's
measurement publishes, it collapses this whole config surface to one hardcoded path and deletes the
losing branches (D-06).

## The three arms

### `winSource` — where the win probability comes from

- **Legacy (`"score-draw"`):** `pRedWinEffective = 1 - standardNormalCdf(-meanD / marginSd)`, where
  `meanD = red.scoreMean - blue.scoreMean` and `marginSd = sqrt(red.scoreVariance +
  blue.scoreVariance)` — the exact analytic limit of the deleted 4,000-draw Monte Carlo's own
  `redScore > blueScore` comparison. Unchanged and un-refactored from 09-04's own expression.
- **`"p-red-win"` (D-13):** `pRedWinEffective = input.pRedWin` — the SAME float the artifact publishes
  as `Prediction.pRedWin`, used directly, with no rescaling, no recalibration, and no clamp unless it
  is outside `[0, 1]` or non-finite (`splitOutcomeProbabilities`'s own guard, see "What is counted"
  below).

Closes F6's measured coherence gap: the pmf-implied win probability differed from the displayed
`pRedWin` by a median absolute difference of 0.0428, p90 0.1203, max 0.3415, over 110,362
qualification matches — never flipping the favourite, never systematically biased (mean signed
difference 0.0000), but still a coherence bug: the site could show a 65% favourite while the
simulation ranked the field using an effective 53% or 77% for that same match. Under `"p-red-win"`
with the legacy tie model the identity is EXACT under `===`: the red outcome half's `winRp` mass is
bitwise the same float `pRedWin` publishes, proven at six pinned values including both endpoints
(`0`, `0.05`, `0.5`, `0.73`, `0.99`, `1`).

### `tieModel` — how tie mass is carved out

- **Legacy (`"continuous-equality"`):** `pTie = 0` whenever `varianceD > 0` — the deleted Monte
  Carlo's `tied = !redWon && !blueWon` over two continuous draws needs exact floating-point equality,
  and reproduces that dead branch faithfully rather than repairing it.
- **`"discrete-margin"` (D-14):** real FRC scores are integers, so the observed margin is the
  rounding of a continuous latent margin, and a tie is exactly the event that it rounds to zero:

  ```
  pTie = Phi((0.5 - marginMean) / marginSd) - Phi((-0.5 - marginMean) / marginSd)
  ```

  `TIE_MARGIN_HALF_WIDTH = 0.5` is structural (it follows from "integers round to the nearest
  integer"), not tunable. The degenerate guard is ordered BEFORE the division: if `marginVariance` is
  not finite or is at or below zero, `pTie = |marginMean| < 0.5 ? 1 : 0`.

Closes F7: 1,206 of 110,362 qualification matches (1.093%) actually tied, while the legacy branch can
never fire on a continuous draw. At `marginMean = 0` and `marginSd = 36.5` (an ordinary FRC margin
sd) this formulation returns `0.0109297`, against the measured base rate `1206 / 110362 =
0.0109277` — the scale was arrived at by INVERTING the model, not by tuning it.

**Formulation choice, and what was rejected.** The three-way split, for both tie models:

```
pRedStrict  = pRedWinEffective * (1 - pTie)
pBlueStrict = (1 - pRedWinEffective) * (1 - pTie)
```

Proportional splitting was chosen over subtracting half the tie mass (`pRedWin - pTie/2`) because the
subtraction alternative needs a clamp whenever `pTie/2 > pRedWin`, and a clamp is a silent third model
that would confound 09-06's attribution between the marginal swap, the tie model, and a hidden
re-specification of its own control. Proportional splitting never goes negative and buys an exact
algebraic identity worth having: CONDITIONAL ON A DECISIVE RESULT, `pRedStrict / (pRedStrict +
pBlueStrict) === pRedWin` (the `(1 - pTie)` factor cancels), proven within 1e-12 across a pinned grid.
The two formulations are close — they agree to roughly `pTie * (pRedWin - 0.5)`, which at the 1.09%
base rate and a 0.3 probability offset is about 0.003, a third-order term — but they are not the same
model, and the plan's own instruction was to record which one shipped and why.

### `marginal` — which family a variable is fitted with

```
resolveDeclaredFamily(variable, config) =
  config.marginal === "negative-binomial" ? variable.marginalFamily : "gaussian"
```

One expression, the SOLE producer of `fitMarginal`'s (`marginals.ts`, 09-03) `declared` argument for
every real season-declared threshold variable — confirmed by source grep (exactly one call site).
Under the legacy member every variable is forced to `"gaussian"` regardless of its own declaration,
which is what makes flipping all 34 declarations (see below) a no-op for production until this field
itself flips (D-10's stated revert target).

Addresses F2's 2.06x under-prediction of bonus probabilities: a symmetric Gaussian under-predicts
`P(X >= t)` exactly where bonus thresholds sit on a right-skewed count. D-01 chose the negative
binomial for its count-native, right-skewed shape, exact discrete CDF at integer thresholds, and
support `[0, infinity)`.

## The 34 declarations

Every threshold variable across the ten registered seasons now declares `marginalFamily:
"negative-binomial"` — verified: `34` total, `0` remaining `"gaussian"` (grep filtered to exclude
comment lines). Justified by 09-03's warm-roster re-measurement of F3's mean deficit
(`docs/models/rp-mean-deficit-warm-rosters.md`): the deficit survives restriction to fully-warm 3/3
rosters (33 of 34 season-variables, selection-slice mean deficit shrinking from 10.4% to 8.0%), NOT
by the original probe that pooled partially-cold rosters the RP-producing population largely
excludes — the ROADMAP's own second hard sequencing constraint for this phase.

Evidence class per variable:

| Season | Variable | Unit | Evidence class | Measured figure |
|---|---|---|---|---|
| 2016 | position1crossings | count | structural-only | not individually measured |
| 2016 | position2crossings | count | structural-only | not individually measured |
| 2016 | position3crossings | count | structural-only | not individually measured |
| 2016 | position4crossings | count | structural-only | not individually measured |
| 2016 | position5crossings | count | structural-only | not individually measured |
| 2016 | attackedTowerEndStrength | count | structural-only | not individually measured |
| 2016 | teleopChallengePoints | points | derived-integer | feeds `towerRobotCount`, 100% integer, n=22,158, 0 exceptions |
| 2016 | teleopScalePoints | points | derived-integer | feeds `towerRobotCount`, 100% integer, n=22,158, 0 exceptions |
| 2017 | autoFuelPoints | points | structural-only | not individually measured |
| 2017 | teleopFuelPoints | points | structural-only | not individually measured |
| 2017 | autoRotorPoints | points | derived-integer | feeds `rotorCount`, 100% integer, n=25,386, 0 exceptions |
| 2017 | teleopRotorPoints | points | derived-integer | feeds `rotorCount`, 100% integer, n=25,386, 0 exceptions |
| 2018 | autoRunPoints | points | measured | 09-RESEARCH.md broader probe (var/mean 1.27-102.3 aggregate) |
| 2018 | autoSwitchOwnershipSec | count | measured | 09-RESEARCH.md broader probe |
| 2018 | endgamePoints | points | measured | 09-RESEARCH.md broader probe |
| 2019 | habClimbPoints | points | measured | 09-RESEARCH.md broader probe |
| 2020 | endgamePoints | points | measured | 09-RESEARCH.md broader probe |
| 2022 | matchCargoTotal | count | measured | 09-RESEARCH.md broader probe |
| 2022 | autoCargoTotal | count | measured | 09-RESEARCH.md broader probe |
| 2022 | endgamePoints | points | measured | 09-RESEARCH.md broader probe |
| 2023 | totalChargeStationPoints | points | measured | 09-RESEARCH.md broader probe |
| 2023 | linkPoints | points | derived-integer | feeds `links`, 100% integer, n=27,116, 0 exceptions |
| 2024 | noteCount | count | measured | 09-RESEARCH.md broader probe |
| 2024 | endGameTotalStagePoints | points | measured | 09-RESEARCH.md broader probe |
| 2024 | onStageRobotCount | count | measured | 09-RESEARCH.md broader probe |
| 2025 | trough | count | measured | 09-RESEARCH.md broader probe |
| 2025 | botRow | count | measured | 09-RESEARCH.md broader probe |
| 2025 | midRow | count | measured | 09-RESEARCH.md broader probe |
| 2025 | topRow | count | measured | 09-RESEARCH.md broader probe |
| 2025 | endGameBargePoints | points | measured | 09-RESEARCH.md broader probe |
| 2025 | autoLineCount | count | measured | 09-RESEARCH.md broader probe |
| 2025 | autoCoralCount | count | measured | 09-RESEARCH.md broader probe |
| 2026 | hubTotalCount | count | measured | 09-RESEARCH.md broader probe |
| 2026 | totalTowerPoints | points | measured | 09-RESEARCH.md broader probe |

**Evidence-class counts:** measured 21, derived-integer 5, structural-only 8 (total 34). **No written
exception exists** — all 34 flip.

**Honest caveat on the "measured" class.** 09-RESEARCH.md's corpus probe reports an AGGREGATE finding
— "15 threshold variables across seven-to-eight seasons, 100% integer-valued, variance/mean 1.27 to
102.3, including every points-unit variable" — rather than a per-variable ratio recorded for each of
the 21 variables this task classifies "measured." This document cites the aggregate honestly rather
than inventing per-variable precision the source probe did not record. A2 (09-RESEARCH.md) is the
reason `points`-unit variables were included in this broader class rather than quietly left Gaussian:
the measurement supports extending negative binomial beyond count-valued variables, and D-01's text
locking only the "count-valued" case should not be read as excluding `points`-unit variables the
evidence otherwise supports.

## What is counted, and why

`FittedMarginal` (09-03, `marginals.ts`) carries three separate facts: `declared` (what the season
module asked for), `resolved` (what actually got fit — `"negative-binomial"` | `"gaussian"` |
`"degenerate"`), and `fallbackReason` (populated only when `resolved !== declared`).
`MarginalResolutionTally` (09-05, `analyticPmf.ts`) counts `resolved`, deliberately NEVER `declared`:
an arm labelled `"negative-binomial"` cannot silently be mostly Gaussian. `fallbacks` is counted
SEPARATELY from `gaussian` — a declared Gaussian default (`resolved === declared === "gaussian"`,
i.e. the legacy config, or a variable that happens to declare Gaussian) is not a fallback, and
conflating the two would corrupt 09-06's count.

09-03 proved this matters on ordinary data, not a contrived case: a 3-team roster where every team
folds `4` then `5` produces alliance mean `13.586547164699777` against variance `4.5` —
`variance <= mean`, so `fitMarginal`'s ordered fallback ladder resolves this to Gaussian with reason
`"variance-le-mean"` even though the variable is declared `"negative-binomial"`. This is exercised
directly in `analyticPmf.test.ts` and `sigmaScoutLayer.rpArms.test.ts`.

**How to read it after a run.** `SigmaScoutLayer.rpMarginalResolutionTally` is a public read-only
accessor (`{ negativeBinomial, gaussian, degenerate, fallbacks }`) accumulating across every
`#rpFieldsFor` call the layer instance has made. It starts all-zero, reading it never mutates it (a
fresh copy is returned each read), and it is IN-MEMORY ONLY — nothing it counts appears on
`Prediction` or in any published artifact. `analyticRpPmf`'s own result additionally carries
`marginalResolution`, that ONE call's own count, independent of whether an external `tally` was also
supplied. 09-06 reads `rpMarginalResolutionTally` after its own measurement run to report what share
of the `"negative-binomial"` arm actually resolved to negative binomial, per bonus, before publishing
an accept or a revert.

## Open Question 3 — the band variance went partly vestigial. Recorded, not acted on.

**Finding:** under `winSource: "p-red-win"` with the LEGACY tie model, the alliance band variance
(Swing or Sigma Score, whichever `AllianceRpMoments.scoreVariance`/`scoreCrossCovariance` carries)
feeds NOTHING in the RP layer. The bonus half reads only the threshold-variable moments
(`meanVector`/`varianceBlock`'s diagonal), and `scoreCrossCovariance` is exactly zero by construction
(`empiricalMoments.ts` line 184 builds `varianceBlock` diagonal; line 192 sets
`scoreCrossCovariance: names.map(() => 0)` — verified by reading the source, not assumed). The outcome
half reads `input.pRedWin` directly under this combination, never `red.scoreVariance` /
`blue.scoreVariance`. `analyticPmf.test.ts`'s own test sweeps `red.scoreVariance`/`blue.scoreVariance`
across `[1, 100, 10000]` under this exact combination and asserts BITWISE IDENTICAL pmfs — a
machine-checked fact, not an inference.

Under `tieModel: "discrete-margin"` the band survives, but only as the tie window's width: the same
scoreVariance sweep changes the TOTAL pmf (because `marginSd` feeds `tieProbability`), but the
BONUS-ONLY half (`redBonusPmf`/`blueBonusPmf`) is bitwise identical across the sweep — located
precisely by a dedicated test, not asserted vaguely.

**`#rpFieldsFor`'s `redBandVariance`/`blueBandVariance` undefined-gate is therefore PARTLY VESTIGIAL
and is DELIBERATELY UNTOUCHED.** F8 measured this gate dropping 10.0% to 24.3% of played qualification
matches at regular events and 0.0% at a champs division. The audit's own R5 warns that relaxing the
gate exposes F9's uncorrected partial-roster mean, and the two must be fixed together — not
separately, and not as a side effect of this plan's own findings. F8/F9 are out of scope for the whole
phase.

**This document makes no recommendation about the gate.** Recording that it is partly vestigial is
this plan's deliverable; deciding what to do about it is not this plan's and not 09-06's.

## Reproducing the inertness golden

```
pnpm rp:inertness-golden
```

(equivalently: `tsx scripts/rpLayerInertnessGolden.ts`). Writes
`packages/core/rankingPoints/rpLayerInertness.json`, capturing `analyticRpPmf`'s output under the
CURRENTLY exported `RP_LAYER_CONFIG_DEFAULT` over 91 hand-built cases (10 registered seasons x 3
event tiers x 3 nominal `pRedWin` values, plus one non-bonus `compLevel` case). `capturedFrom` is the
`git rev-parse HEAD` of the commit the golden was captured from — for this plan, the pre-Task-1
commit, an ancestor of every later commit in this plan.

**Standing rule:** this golden is the SOLE committed evidence that plan 09-05 shipped nothing (D-05).
Running with `--regenerate` OVERWRITES it and prints a loud warning naming this plan and the reason.
**No plan before 09-06's collapse of `RpLayerConfig` (D-06) has a legitimate reason to pass that
flag.** A golden regenerated to make a failing `rpLayerInertness.test.ts` green is the exact failure
this instrument exists to catch. It was NOT regenerated at any point during plan 09-05 — the file has
exactly one commit in its git history (`git log --oneline -- packages/core/rankingPoints/rpLayerInertness.json`).

## What this document does not say

This document carries no accuracy claim, no Brier number, no recommendation for or against any arm,
and no figure from the 2023-2026 reporting slice. D-04 reserves that slice for 09-06's own
measurement and forbids spending it here; D-09/D-11 name the exact bar and the exact scorer 09-06 must
use. Nothing in this document should be read as a preview of that verdict.

---

*Phase: 09-analytic-ranking-points-browser-side-simulation*
*Plan: 09-05*
*Written: 2026-09-11*
