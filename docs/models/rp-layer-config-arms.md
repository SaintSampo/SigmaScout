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
"gaussian"`), and neither `publishSeasons` (`packages/harness/publish.ts`) nor any
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
(the retired per-robot consistency accumulator's or Sigma Score's, whichever `AllianceRpMoments.scoreVariance`/`scoreCrossCovariance` carries)
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

## Outcome — all three arms were measured and all three were REVERTED (2026-09-11, plan 09-06)

**This document is now a historical record of work that was tried and rejected, not a description of
a live configuration surface.** The surface it documents no longer exists: the config object, its
member unions, its production default, its label function, its support assertion and its family
resolver were all deleted, along with every branch they selected between. The arms below existed at
commit `2731bfab^`; that is where to look for the code.

| Arm | Improved | Regressed | Tied | Met the bar | Decision | Branch deleted |
|---|---|---|---|---|---|---|
| `win` — `winSource: "p-red-win"` (D-13) | 0 | 0 | 30 | no | **revert** | yes |
| `tie` — `tieModel: "discrete-margin"` (D-14) | 0 | 0 | 30 | no | **revert** | yes |
| `marginal` — `marginal: "negative-binomial"` (D-01) | 3 | 3 | 24 | no | **revert** | yes |

Each figure is over the 30 scored bonus cells of the 2023-2026 reporting slice. The bar required a
majority to improve on Brier and none to regress. `docs/models/rp-attribution.md` carries the
per-cell table, the decision rule's own trace, and the measured effects of each arm.

**The two zero-rows are the finding, not an absence of one.** The win source and the tie model are
structurally invisible to a per-bonus Brier: both change only the win/tie/loss half of the
ranking-point distribution. What they actually did was measured and is recorded — the win source
drove the gap between the pmf-implied and published win probability to exactly zero, and the tie
model replaced an identically-zero tie probability with 0.008239 against a measured base rate of
0.010928. Both were reverted anyway, because the bar this phase committed to in advance does not read
those quantities.

**The marginal swap's reach was far narrower than this document's "34 declarations" table implies.**
At the time of this measurement `clauseProbability` refitted a clause's combined moments as a hardcoded
Gaussian, so only `nestedSameVariable` bonuses ever honored a declared family at all — one season
has any, and its two bonuses across three algorithms are exactly the six cells that moved. The
resolved-family tally reported a 69.62% negative-binomial share for an arm whose published output was
Gaussian-derived in 24 of its 30 cells, because it counts fits PERFORMED rather than fits USED. That is
a real limitation of the observability mechanism this document describes.

It was recorded here rather than quietly fixed mid-measurement — and it was fixed AFTERWARDS,
loudly, in its own commit, on 2026-09-11 by quick task 260911-w7k, with this measurement left standing.
A clause now derives its family from its terms' declarations and refuses a combination with no exact
closed form. **The fix moved no number above.** Every declaration in the tree is Gaussian, which is
closed under scaled addition, pinned by `packages/core/rankingPoints/analyticPmfGolden.json` captured
before the change and green after it. The 69.62% share, the 24-of-30 figure and the refusal itself are
exactly what was measured and are unchanged; what changed is what a future measurement could reach.

## What this document does not say

This document carries no accuracy claim of its own and no figure that was not measured by 09-06's
committed run. Its original reservation — that the 2023-2026 slice was D-04's to spend and not
this document's — was RELEASED on 2026-09-11 when 09-06 spent it, once, against a bar frozen as
executable code before any of those figures existed. The verdict above is that bar's mechanical
answer, taken without override.

---

## Re-measured under a total-RP scorer (2026-09-13, quick task 260913-qyn)

The verdict above was blind: the pre-committed 09-06 bar scored the 30 bonus cells only, and
`win`/`tie` change nothing there (0 improved, 0 regressed, 30 tied) because both change only the
win/tie/loss half of the ranking-point distribution, never a bonus. This section is a SECOND,
independent measurement, on a scorer built to see exactly that half, following the same
pre-committed-bar discipline this document's own "Outcome" section above established.

**The scorer (`scripts/measureRpCalibration.ts`).** Two new blocks, per (season, algorithm),
omitted when their `count` is 0 (the same absence discipline `bonuses` already uses):

- **`totalRp`** — a ranked probability score (RPS) of `redRpPmf`/`blueRpPmf` against the actual
  alliance RP (`toIntegerRpOrNull(match.redRpEarned / blueRpEarned)`, the SAME conversion
  `publish.ts` uses for `actualRedRp`/`actualBlueRp`, imported rather than re-derived), pooled per
  alliance-side. `RPS = (1 / maxRp) * sum over k = 0..maxRp-1 of (P(RP <= k) - [actual <= k])^2`,
  bounded `[0, 1]`. Every selection-slice season has `maxRp = 4`, so the normalisation cannot bias
  the arm comparison.
- **`outcome`** — a three-outcome Brier (`(pRed-[red])^2 + (pTie-[tie])^2 + (pBlue-[blue])^2`, 0
  perfect, 2 worst — NOT comparable to the site's binary win Brier) of `matchOutcomePmf` against
  `match.winner`, pooled per match, plus mean predicted tie probability and the observed tie rate.

Population: played matches with `isBonusRpCompLevel(match.compLevel)` whose folded prediction
carries `redRpPmf`/`blueRpPmf` (outcome: `matchOutcomePmf`) — NOT gated on
`actualBonusFlagsForSeason`, so the bonus loop's own `continue` cannot silently skip the new
scorers. Out-of-support actuals (an integer RP below 0 or above `maxRp`) are excluded and counted
separately (`excludedOutOfSupport`) from a null actual (`excludedNullActual`); neither counts
toward `count`.

**The slice and the guards.** Selection slice: 2016-2020 and 2022, `--algorithm spr` only —
`assertOutcomeArmSliceAllowed` refuses any season at or above 2023 (no override, no trimming) and
an algorithm guard requires the resolved list to be exactly `spr`, both evaluated on the parsed
season list BEFORE the corpus opens.

**The bar, committed before any arm was measured.** `applyRpOutcomeArmBar` (`scripts/
measureRpCalibration.ts`, bar commit `757a4723`, dated 2026-09-13, preceding the scorer commit and
every arm figure in git history — verified by `git log`) accepts an arm iff BOTH its pooled
`totalRp` RPS AND its pooled `outcome` Brier are strictly lower than control's, no tolerance. The
accepted set with the lowest RPS ships; WIN+TIE ships only when itself accepted; none accepted
ships control.

**The measurement**, one replay per season through `SigmaScoutLayer`, folding every record
(qualification and elimination alike — an earlier run that folded qualification-only diverged from
control's own history and was caught by `assertBonusHalfIdentical` before any arm figure existed;
fixed in `af3e54e4`, re-run clean), pooled over 2016-2020, 2022 under SPR (137,482 total-RP /
68,741 outcome observations, `data/baselines/rp-outcome-arms-2026-09.json`):

| arm | totalRp RPS | RPS delta | outcome Brier | Brier delta | predicted tie | observed tie | accepted |
|---|---|---|---|---|---|---|---|
| control | 0.160303 | — | 0.382046 | — | 0 | 0.012918 | — |
| win | 0.159664 | -0.000639 | 0.379872 | -0.002174 | 0 | 0.012918 | yes |
| tie | 0.160185 | -0.000118 | 0.381584 | -0.000462 | 0.013626 | 0.012918 | yes |
| win+tie | 0.159627 | -0.000676 | 0.379769 | -0.002277 | 0.013626 | 0.012918 | **yes — shipped** |

All three arms cleared the bar on both figures, in every one of the six seasons (pooled direction
held per-season too, reported not gating). WIN+TIE has the lowest pooled RPS, so it ships per the
bar's own tie-break rule (lowest RPS first). Bonus-half bitwise identity was proven on every folded
record before any arm figure existed (`assertBonusHalfIdentical`), and confirmed again by a
21-cell byte-identical cross-check between `-09c` (bonus-only scorer) and `-09d` (post-ship) after
the collapse.

**The F6 gap under SPR** (descriptive — `median`/`p90`/`max` of `|matchOutcomePmf[0] - pRedWin|`,
reported by the scorer's console output, never a gate): median fell from **0.0274** under control
to **0.0041** under WIN+TIE; max fell from **0.1971** to **0.1585**. This is the SPR figure — the
0.0428 median/0.3415 max quoted earlier in this document's "Outcome" section is `bpr`'s, from a
different algorithm entirely, and the two are not comparable. The residual under WIN+TIE is
`pRedWin x pTie` from the proportional split; conditional on a decisive result the identity with
`pRedWin` is exact (unchanged from this document's own derivation above).

**What shipped.** WIN+TIE, at every Prediction-bearing RP call site: `SigmaScoutLayer#rpFieldsFor`,
`apps/worker/src/scheduled.ts`'s `rpFieldsFor`, `apps/worker/src/stateProbe.ts`'s `rpFieldsFor`
(mirrors the Worker), and `publish.ts`'s pre-schedule pricer (`makeRankingPointFiller`).
`fieldAveraged.ts` passes nothing (it prices a hypothetical match with no real `Prediction` to read
`pRedWin` from) and keeps the score-draw limit, with a comment recording why. The measurement seam
— the `SigmaScoutLayer` third constructor argument, `--outcome-arms`/`--emit-outcome-arms`, and the
four-layer fold — was deleted at ship time in every outcome of the bar; `applyRpOutcomeArmBar`,
`RpOutcomeArmRecordSchema`, the scorers, and the slice/algorithm guards remain as the reader half
for any future re-measurement. `SHIPPED_RP_LAYER_LABEL` was updated to the shipped combination, and
`rp-calibration-2026-09b.json`'s frozen pin was re-pinned to its own literal (it predates the
label). Nothing here revisits the `marginal` arm's already-decided, already-recorded disposition
(negative binomial: measured to help, declined on cost, 2026-09-12).

**The published measurement.** `RP_CALIBRATION_MEASUREMENT_PATH` now points at
`data/baselines/rp-calibration-2026-09d.json`, re-measured `--seasons 2016-2020,2022-2026
--algorithm spr` from the post-ship tree — ten SPR records, every one carrying non-empty `totalRp`
and `outcome` blocks. `-09b` and `-09c` are byte-untouched. The Compare page's RP card
(`RpCalibrationSection.tsx`) now leads each SPR card with a plain-language total-RP sentence and a
tie sentence, followed by the labelled ranked-probability-score and three-outcome-Brier figures,
with the existing per-bonus rows demoted under a "Bonus ranking points" sub-label — unchanged in
content and test ids.

**Owed, not done by this task.** Republish (so the live `v1/compare/{year}.json` objects carry the
new blocks), Worker deploy (so the live tick prices matches with the shipped WIN+TIE model), and a
presim sidecar refresh. No network, R2, D1 or deploy access was available to the executing task.

Full arm record: `data/baselines/rp-outcome-arms-2026-09.json`. Published measurement:
`data/baselines/rp-calibration-2026-09d.json`. Bar commit: `757a4723`. Collapse commit:
`956c9cef`. Re-emit commit: `1a7cad9b`. Audit disposition: `.planning/todos/pending/
ranking-points-audit.md`'s "F6 / F7 decision" subsection.

---

## Lattice marginals and the mean shift, measured and shipped on the bonus half (2026-09-14, quick task 260914-01x)

The two sections above changed the win/tie/loss half. This one changes the bonus half. It follows
the same discipline: a bar committed before any figure, arms measured on the selection slice only,
and the accepted arm shipped with no override. **It is shipped in code and published in the next
generation.**

**Why a fourth family.** The ranking-points audit's F4 attribution (`docs/models/
rp-bonus-gap-attribution.md`, quick task 260913-tw1) found the integer shape of the threshold
variables to be the main cause of the bonus under-prediction, and the mean deficit second. Jacob
chose to build both as separate knobs. `lattice` is a new member of the `marginal` family union. It
is not negative binomial, whose disposition (measured to help, declined on cost, 2026-09-12) is
unchanged.

**The two knobs.**

- **`lattice`.** Each threshold variable declares a lattice support (step, and min and max where the
  rules cap the value) in its season module, taken from the game rules. With both bounds, the
  variable gets a bounded beta-binomial or binomial. Otherwise it gets a discretized Gaussian on its
  step. Multi-term and divisor clauses are summed by exact lattice convolution.
- **`meanShift`.** A per-season, walk-forward, league-wide running mean of (observed minus
  predicted alliance mean) per threshold variable. It is built from fully-warm rosters, applied to
  fully-warm rosters, and active after 200 prior observations of that variable.

**The bar, committed before any arm was measured.** `applyRpBonusArmBar` (`scripts/
measureRpCalibration.ts`, bar commit `012bea91`, dated 2026-09-14, older in git than the
measurement code and every arm figure) accepts an arm only when BOTH its pooled bonus Brier AND its
pooled total-RP RPS are strictly lower than control's, with no tolerance. The accepted arm with the
lowest RPS ships. Ties break on bonus Brier, then the order lattice, meanShift, lattice+meanShift.
If none is accepted, nothing ships.

**The slice and the guards.** 2016-2020 and 2022, `--algorithm spr` only. `assertBonusArmSliceAllowed`
refuses any season from 2023 on, and the algorithm guard requires exactly `spr`. Both run on the
parsed list before the corpus opens. The 2023-2026 slice was never used to accept anything.

**The measurement.** One replay per season folds every record through four layers, scored by the
same helpers and gates the published scorecard uses. The outcome half was asserted identical across
all four arms on every folded record. Pooled over 267,324 bonus and 137,482 total-RP observations
(`data/baselines/rp-bonus-arms-2026-09.json`, run once at `8b1fed09` with a clean tree):

| arm | bonus Brier | Brier delta | total-RP RPS | RPS delta | accepted |
|---|---|---|---|---|---|
| control | 0.179914 | — | 0.159627 | — | — |
| lattice | 0.126571 | -0.053343 | 0.143114 | -0.016513 | yes |
| meanShift | 0.166592 | -0.013322 | 0.155001 | -0.004626 | yes |
| lattice+meanShift | 0.124278 | -0.055636 | 0.141956 | -0.017670 | **yes — shipped** |

All three arms cleared the bar, and lattice+meanShift has the lowest RPS, so it shipped.

**Costs, reported and not gating** (the per-season and per-cell tables are in the attribution
doc's outcome section):

- 2017 `rotor` overshoots. Its gap closes 374.7% and its Brier gets 0.0080 worse under the shipped
  arm, and 0.0006 worse under lattice alone. The likely cause, not fixed: summing auto and teleop
  rotors as independent terms ignores the joint cap of four rotors.
- The 2017 season's bonus Brier is 0.0039 worse.
- The multi-variable pool overshoots, at 104.8% of the gap closed.
- 2018 `autoQuest` reaches 140.1% of the gap closed, but its Brier still improves (-0.0935).
- Adding the mean shift roughly doubles 2016's lattice fallbacks, from 43,560 to 90,956. The cause
  is not diagnosed, and the tally does not record a reason.
- Worker CPU: the lattice pricing costs +0.22 ms per 130-match tick, and the mean shift about +0.07
  to 0.14 ms.

The lattice arm closes 75.3% of the multi-variable gap here, where the tw1 probe closed 70.9%. The
ranges come from the game rules, not from season data, so the two are different models.

**What shipped.** Both knobs, unconditionally, at every ranking-point call site. All 34 variables
declare `lattice` (`f79a55aa`). `SigmaScoutLayer` builds the mean shift whenever it publishes RP. The
live Worker (`apps/worker/src/scheduled.ts`) and the state probe resume, apply, observe and write
back the shift as the layer does. It rides the spr league row as `sigmascoutRpMeanShift`, and
`STATE_SNAPSHOT_SHAPE_VERSION` is 16 (`98c5bfa4`). The pre-schedule pricer applies it per synthetic
alliance, and the field-averaged presim applies it all-or-nothing per event. The measurement seam
was deleted: `--bonus-arms`, `--emit-bonus-arms`, the four-layer fold, `ruleModuleWithLatticeArm`,
`assertOutcomeHalfIdentical` and the layer's third constructor argument. `applyRpBonusArmBar`,
`RpBonusArmRecordSchema`, the slice and algorithm guards and the record test remain as the reader
half. `SHIPPED_RP_LAYER_LABEL` gained `marginal=lattice, meanShift=fully-warm-walk-forward`, and
`-09d`'s rpLayer test was re-pinned to its own frozen literal. Winner predictions are byte-identical.

**The published measurement.** `RP_CALIBRATION_MEASUREMENT_PATH` now points at
`data/baselines/rp-calibration-2026-09e.json`, measured `--seasons 2016-2020,2022-2026 --algorithm
spr` from the post-ship tree. It has the same ten seasons as `-09d`, because it is the published
scorecard. Its 2023-2026 figures are that scorecard's existing scope, not an acceptance use, and
nothing was changed in response to them. Over all ten seasons, the mean predicted bonus rate moved
from 0.1384 to 0.2505 against an observed 0.2941. Bonus Brier moved from 0.1809 to 0.1365, and
total-RP RPS from 0.1581 to 0.1424. The selection-slice figures equal the arm record's shipped
figures to within 1.3e-15, and the outcome blocks equal `-09d`'s in every season. `-09b`, `-09c`
and `-09d` are byte-untouched.

**Owed.** A full publish, the D1 seed (shape 16) before the Worker deploy, the Worker deploy, the
push, and a check on the live site. These are Task 9 of the same quick task.

Arm record: `data/baselines/rp-bonus-arms-2026-09.json`. Published measurement:
`data/baselines/rp-calibration-2026-09e.json`. Bar commit: `012bea91`. Record commit: `4921dabf`.
Ship commit: `f79a55aa`. Worker commit: `98c5bfa4`. Re-emit commit: `589ef10a`. Audit disposition:
`.planning/todos/pending/ranking-points-audit.md`'s "F4 decision" subsection.

---

*Phase: 09-analytic-ranking-points-browser-side-simulation*
*Plan: 09-05 (outcome section added by 09-06, 2026-09-11; total-RP re-measurement added by quick
task 260913-qyn, 2026-09-13; lattice and mean-shift section added by quick task 260914-01x,
2026-09-14)*
*Written: 2026-09-11*
