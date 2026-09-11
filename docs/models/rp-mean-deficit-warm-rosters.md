# F3 mean-deficit re-measurement, restricted to fully-warm 3/3 rosters (09-03, 2026-09-11)

This is the ROADMAP's second hard sequencing constraint for Phase 9: "Re-measure F3's mean deficit
restricted to fully-warm 3/3 rosters before committing to the marginal swap — the probe that found
predicted means low in 33 of 34 season-variables included partially-cold rosters, which the
RP-producing population largely excludes." This document is that re-measurement.

Every figure below traces to one committed source: the machine-readable ```json rp-mean-deficit```
block at the bottom of this document, produced by `scripts/measureRpMeanDeficit.ts --json` and
reproducible with the exact command named below.

## Headline verdict — read this first

**The deficit survives the restriction to fully-warm rosters.** Predicted alliance means are still
below observed in 33 of 34 season-variables under the `warm-3of3` arm — identical to the original
`all-rosters` probe's 33 of 34 — though the SIZE of the shortfall shrinks: across the selection
slice (2016-2020, 2022) the mean deficit drops from 10.4% (`all-rosters`) to 8.0% (`warm-3of3`).
One variable, 2016's `attackedTowerEndStrength`, runs the other way in BOTH arms (the predicted
mean is ABOVE observed), and that gap gets LARGER, not smaller, once cold rosters are excluded
(-10.4% to -18.8%) — reported exactly as measured, per this plan's instruction that either
direction is a legitimate finding. **09-05 and 09-06 should read this as: the marginal-family swap
is still worth attempting on the population the RP layer actually predicts for, but the effect size
to expect is somewhat smaller than the original 33-of-34 probe implied.**

## What was measured

Two arms, produced from ONE walk-forward pass per season over ONE `RpMomentsAccumulator` instance,
differing only by a roster filter applied to the same (predicted mean, observed value) pair:

- **`all-rosters`** — every alliance-side observation. The original F3 probe's population, carried
  here unchanged so the two arms are directly comparable.
- **`warm-3of3`** — only alliance-sides whose roster has exactly 3 teams, every one of which
  satisfies `RpMomentsAccumulator.hasHistory` (`packages/core/rankingPoints/empiricalMoments.ts`'s
  own "this prediction rests on real history" predicate, used verbatim — not re-derived).

The predicted mean vector is **algorithm-independent**: `RpMomentsAccumulator` is fed only by
`ruleModule.parse`'s observed threshold variables, and `momentsFor`'s `scoreMean`/`scoreVariance`
arguments pass straight through to `AllianceRpMoments` without touching `meanVector`. No algorithm
was resolved and no `WalkForwardSimulator` ran — this measurement is exactly what its result
depends on, and nothing else.

**D-04's selection/reporting split.** Output is reported under two separate headings below.
**SELECTION SLICE (2016-2020, 2022)** is the population any decision from this record must cite.
**REPORTING SLICE (2023-2026)** is out-of-sample with respect to any family choice and is reported
for completeness only — it is not acted on here, and the 2026 holdout is not being spent a second
time by this document.

## Census

| | |
|---|---:|
| Total matches seen | 185,313 |
| Skipped — ineligible event type | 32,561 |
| Skipped — missing score breakdown | 21 |
| Skipped — parse failure (per side) | 0 |
| Alliance-sides in `all-rosters` | 305,462 |
| Alliance-sides in `warm-3of3` | 290,588 |
| `warm-3of3` share of `all-rosters` | 95.13% |

95.13% of alliance-sides in the RP-eligible population are already fully-warm 3/3 rosters — the two
populations largely overlap, which is consistent with the deficit surviving the restriction rather
than being an artifact of cold-start pooling.

## SELECTION SLICE (2016-2020, 2022)

Mean deficit across this slice's 20 season-variables: **10.4% (`all-rosters`)** vs **8.0%
(`warm-3of3`)**.

| Season | Variable | Arm | n | Predicted mean | Observed mean | Deficit |
|---|---|---|---:|---:|---:|---:|
| 2016 | attackedTowerEndStrength | all-rosters | 26,604 | 3.9698 | 3.5969 | -10.4% |
| 2016 | attackedTowerEndStrength | warm-3of3 | 25,191 | 4.1200 | 3.4691 | -18.8% |
| 2016 | position1crossings | all-rosters | 26,604 | 1.8035 | 1.9066 | 5.4% |
| 2016 | position1crossings | warm-3of3 | 25,191 | 1.8770 | 1.9162 | 2.0% |
| 2016 | position2crossings | all-rosters | 26,604 | 1.3081 | 1.4042 | 6.8% |
| 2016 | position2crossings | warm-3of3 | 25,191 | 1.3619 | 1.4203 | 4.1% |
| 2016 | position3crossings | all-rosters | 26,604 | 1.3975 | 1.5132 | 7.6% |
| 2016 | position3crossings | warm-3of3 | 25,191 | 1.4550 | 1.5301 | 4.9% |
| 2016 | position4crossings | all-rosters | 26,604 | 1.3534 | 1.4710 | 8.0% |
| 2016 | position4crossings | warm-3of3 | 25,191 | 1.4091 | 1.4895 | 5.4% |
| 2016 | position5crossings | all-rosters | 26,604 | 1.3797 | 1.4868 | 7.2% |
| 2016 | position5crossings | warm-3of3 | 25,191 | 1.4364 | 1.5000 | 4.2% |
| 2016 | teleopChallengePoints | all-rosters | 26,604 | 8.6095 | 9.4865 | 9.2% |
| 2016 | teleopChallengePoints | warm-3of3 | 25,191 | 8.9666 | 9.6648 | 7.2% |
| 2016 | teleopScalePoints | all-rosters | 26,604 | 2.2889 | 2.8930 | 20.9% |
| 2016 | teleopScalePoints | warm-3of3 | 25,191 | 2.3880 | 2.9874 | 20.1% |
| 2017 | autoFuelPoints | all-rosters | 30,870 | 1.6556 | 2.1071 | 21.4% |
| 2017 | autoFuelPoints | warm-3of3 | 29,377 | 1.7232 | 2.1802 | 21.0% |
| 2017 | autoRotorPoints | all-rosters | 30,870 | 26.5111 | 31.6832 | 16.3% |
| 2017 | autoRotorPoints | warm-3of3 | 29,377 | 27.5601 | 32.5500 | 15.3% |
| 2017 | teleopFuelPoints | all-rosters | 30,870 | 1.6916 | 2.0013 | 15.5% |
| 2017 | teleopFuelPoints | warm-3of3 | 29,377 | 1.7611 | 2.0550 | 14.3% |
| 2017 | teleopRotorPoints | all-rosters | 30,870 | 79.4406 | 85.4979 | 7.1% |
| 2017 | teleopRotorPoints | warm-3of3 | 29,377 | 82.4745 | 86.0510 | 4.2% |
| 2018 | autoRunPoints | all-rosters | 33,924 | 12.2430 | 13.2670 | 7.7% |
| 2018 | autoRunPoints | warm-3of3 | 32,266 | 12.6974 | 13.4380 | 5.5% |
| 2018 | autoSwitchOwnershipSec | all-rosters | 33,924 | 4.6298 | 5.2654 | 12.1% |
| 2018 | autoSwitchOwnershipSec | warm-3of3 | 32,266 | 4.8075 | 5.3781 | 10.6% |
| 2018 | endgamePoints | all-rosters | 33,924 | 43.5680 | 47.8570 | 9.0% |
| 2018 | endgamePoints | warm-3of3 | 32,266 | 45.2119 | 48.5356 | 6.8% |
| 2019 | habClimbPoints | all-rosters | 36,102 | 11.3800 | 12.5777 | 9.5% |
| 2019 | habClimbPoints | warm-3of3 | 34,399 | 11.8050 | 12.7788 | 7.6% |
| 2020 | endgamePoints | all-rosters | 9,326 | 29.2264 | 35.3056 | 17.2% |
| 2020 | endgamePoints | warm-3of3 | 8,582 | 31.5224 | 36.1839 | 12.9% |
| 2022 | autoCargoTotal | all-rosters | 29,354 | 2.5180 | 2.9106 | 13.5% |
| 2022 | autoCargoTotal | warm-3of3 | 27,944 | 2.6130 | 2.9721 | 12.1% |
| 2022 | endgamePoints | all-rosters | 29,354 | 13.5907 | 15.4019 | 11.8% |
| 2022 | endgamePoints | warm-3of3 | 27,944 | 14.1017 | 15.6708 | 10.0% |
| 2022 | matchCargoTotal | all-rosters | 29,354 | 14.1845 | 16.1330 | 12.1% |
| 2022 | matchCargoTotal | warm-3of3 | 27,944 | 14.7249 | 16.4295 | 10.4% |

## REPORTING SLICE (2023-2026 — reported, not acted on)

Mean deficit across this slice's 14 season-variables: **12.0% (`all-rosters`)** vs **10.3%
(`warm-3of3`)**. **Any decision derived from this record cites the SELECTION SLICE above, never
this one.**

| Season | Variable | Arm | n | Predicted mean | Observed mean | Deficit |
|---|---|---|---:|---:|---:|---:|
| 2023 | linkPoints | all-rosters | 32,706 | 11.1716 | 13.3749 | 16.5% |
| 2023 | linkPoints | warm-3of3 | 31,184 | 11.5953 | 13.6759 | 15.2% |
| 2023 | totalChargeStationPoints | all-rosters | 32,706 | 23.9134 | 25.9791 | 8.0% |
| 2023 | totalChargeStationPoints | warm-3of3 | 31,184 | 24.7566 | 26.2955 | 5.9% |
| 2024 | endGameTotalStagePoints | all-rosters | 34,016 | 4.5855 | 5.0823 | 9.8% |
| 2024 | endGameTotalStagePoints | warm-3of3 | 32,426 | 4.7552 | 5.1506 | 7.7% |
| 2024 | noteCount | all-rosters | 34,016 | 13.6010 | 15.1910 | 10.5% |
| 2024 | noteCount | warm-3of3 | 32,426 | 14.0958 | 15.4073 | 8.5% |
| 2024 | onStageRobotCount | all-rosters | 34,016 | 0.8577 | 0.9653 | 11.1% |
| 2024 | onStageRobotCount | warm-3of3 | 32,426 | 0.8898 | 0.9808 | 9.3% |
| 2025 | autoCoralCount | all-rosters | 35,754 | 1.6884 | 2.0477 | 17.5% |
| 2025 | autoCoralCount | warm-3of3 | 34,080 | 1.7529 | 2.0993 | 16.5% |
| 2025 | autoLineCount | all-rosters | 35,754 | 2.5959 | 2.7730 | 6.4% |
| 2025 | autoLineCount | warm-3of3 | 34,080 | 2.6889 | 2.7965 | 3.9% |
| 2025 | botRow | all-rosters | 35,754 | 2.2431 | 2.6940 | 16.7% |
| 2025 | botRow | warm-3of3 | 34,080 | 2.3309 | 2.7507 | 15.3% |
| 2025 | endGameBargePoints | all-rosters | 35,754 | 9.7024 | 11.1063 | 12.6% |
| 2025 | endGameBargePoints | warm-3of3 | 34,080 | 10.0637 | 11.2920 | 10.9% |
| 2025 | midRow | all-rosters | 35,754 | 3.4318 | 4.1891 | 18.1% |
| 2025 | midRow | warm-3of3 | 34,080 | 3.5610 | 4.2928 | 17.0% |
| 2025 | topRow | all-rosters | 35,754 | 7.4638 | 8.5921 | 13.1% |
| 2025 | topRow | warm-3of3 | 34,080 | 7.7380 | 8.7602 | 11.7% |
| 2025 | trough | all-rosters | 35,754 | 2.4510 | 2.7032 | 9.3% |
| 2025 | trough | warm-3of3 | 34,080 | 2.5434 | 2.7327 | 6.9% |
| 2026 | hubTotalCount | all-rosters | 36,806 | 162.0395 | 188.8012 | 14.2% |
| 2026 | hubTotalCount | warm-3of3 | 35,139 | 168.0094 | 192.5730 | 12.8% |
| 2026 | totalTowerPoints | all-rosters | 36,806 | 1.8780 | 1.9679 | 4.6% |
| 2026 | totalTowerPoints | warm-3of3 | 35,139 | 1.9407 | 1.9925 | 2.6% |

## Headline recomputation — the direct successor to the audit's "33 of 34"

| Arm | Season-variables with predicted mean below observed |
|---|---|
| `all-rosters` | 33 of 34 |
| `warm-3of3` | 33 of 34 |

`all-rosters`'s 33 of 34 matches the original audit's figure exactly, confirming this
re-measurement is a faithful successor to the original probe rather than a different computation.
`warm-3of3` reports the SAME count — the sole exception in both arms is 2016's
`attackedTowerEndStrength`, whose predicted mean sits ABOVE observed in both populations.

## Reproducing this record

```
npx tsx scripts/measureRpMeanDeficit.ts --seasons 2016-2020,2022-2026
```

Generated: 2026-09-11 (see `generatedAt` in the machine-readable block below for the precise
timestamp).

## Machine-readable record

```json rp-mean-deficit
{
  "generatedAt": "2026-09-11T17:34:08.128Z",
  "command": "npx tsx scripts/measureRpMeanDeficit.ts --seasons 2016-2020,2022-2026",
  "seasons": [2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026],
  "selectionSeasons": [2016, 2017, 2018, 2019, 2020, 2022],
  "reportingSeasons": [2023, 2024, 2025, 2026],
  "census": {
    "totalMatches": 185313,
    "skippedIneligibleEventType": 32561,
    "skippedMissingBreakdown": 21,
    "skippedParseFailureSides": 0,
    "allRostersSides": 305462,
    "warm3of3Sides": 290588,
    "warm3of3ShareOfAllRosters": 0.9513065454950207
  },
  "rows": {
    "allRosters": [
      { "season": 2016, "variable": "attackedTowerEndStrength", "n": 26604, "predictedMean": 3.9697654214571876, "observedMean": 3.5969403097278603, "deficitFraction": -0.10365062514966637 },
      { "season": 2016, "variable": "position1crossings", "n": 26604, "predictedMean": 1.8035149659227716, "observedMean": 1.9065929935348067, "deficitFraction": 0.054063991613086414 },
      { "season": 2016, "variable": "position2crossings", "n": 26604, "predictedMean": 1.3081418226913986, "observedMean": 1.4041873402495866, "deficitFraction": 0.06839936154182708 },
      { "season": 2016, "variable": "position3crossings", "n": 26604, "predictedMean": 1.3975026044755103, "observedMean": 1.5132310930687114, "deficitFraction": 0.07647773636379157 },
      { "season": 2016, "variable": "position4crossings", "n": 26604, "predictedMean": 1.3534053724106105, "observedMean": 1.4709818072470304, "deficitFraction": 0.0799305839522695 },
      { "season": 2016, "variable": "position5crossings", "n": 26604, "predictedMean": 1.37974377701038, "observedMean": 1.4867689069312886, "deficitFraction": 0.07198504718652608 },
      { "season": 2016, "variable": "teleopChallengePoints", "n": 26604, "predictedMean": 8.609459324302147, "observedMean": 9.4865433769358, "deficitFraction": 0.0924555992402951 },
      { "season": 2016, "variable": "teleopScalePoints", "n": 26604, "predictedMean": 2.2889198414087883, "observedMean": 2.8929860171402795, "deficitFraction": 0.20880369699422582 },
      { "season": 2017, "variable": "autoFuelPoints", "n": 30870, "predictedMean": 1.6555904256178098, "observedMean": 2.107061872367995, "deficitFraction": 0.21426587072301048 },
      { "season": 2017, "variable": "autoRotorPoints", "n": 30870, "predictedMean": 26.511074009783336, "observedMean": 31.68318756073858, "deficitFraction": 0.16324473479948923 },
      { "season": 2017, "variable": "teleopFuelPoints", "n": 30870, "predictedMean": 1.691588745148025, "observedMean": 2.0012633624878524, "deficitFraction": 0.15473956259053195 },
      { "season": 2017, "variable": "teleopRotorPoints", "n": 30870, "predictedMean": 79.44062167672506, "observedMean": 85.49789439585358, "deficitFraction": 0.07084703970700688 },
      { "season": 2018, "variable": "autoRunPoints", "n": 33924, "predictedMean": 12.242982850951373, "observedMean": 13.267008607475534, "deficitFraction": 0.07718588167246344 },
      { "season": 2018, "variable": "autoSwitchOwnershipSec", "n": 33924, "predictedMean": 4.629782543458577, "observedMean": 5.265446291710883, "deficitFraction": 0.120723622089356 },
      { "season": 2018, "variable": "endgamePoints", "n": 33924, "predictedMean": 43.568045555259786, "observedMean": 47.856974413394646, "deficitFraction": 0.08961972441229872 },
      { "season": 2019, "variable": "habClimbPoints", "n": 36102, "predictedMean": 11.379952177825334, "observedMean": 12.577696526508227, "deficitFraction": 0.09522763935022416 },
      { "season": 2020, "variable": "endgamePoints", "n": 9326, "predictedMean": 29.22642018731174, "observedMean": 35.30559725498606, "deficitFraction": 0.17218734535968758 },
      { "season": 2022, "variable": "autoCargoTotal", "n": 29354, "predictedMean": 2.5180298751478265, "observedMean": 2.910574368058868, "deficitFraction": 0.134868394781075 },
      { "season": 2022, "variable": "endgamePoints", "n": 29354, "predictedMean": 13.590655356944756, "observedMean": 15.401921373577707, "deficitFraction": 0.11760000409690524 },
      { "season": 2022, "variable": "matchCargoTotal", "n": 29354, "predictedMean": 14.184528040183212, "observedMean": 16.132963139606186, "deficitFraction": 0.12077354188206103 },
      { "season": 2023, "variable": "linkPoints", "n": 32706, "predictedMean": 11.171622641493538, "observedMean": 13.374915917568641, "deficitFraction": 0.16473324315863275 },
      { "season": 2023, "variable": "totalChargeStationPoints", "n": 32706, "predictedMean": 23.913445824970516, "observedMean": 25.979086406164008, "deficitFraction": 0.07951167138438638 },
      { "season": 2024, "variable": "endGameTotalStagePoints", "n": 34016, "predictedMean": 4.58550355027011, "observedMean": 5.082314205079962, "deficitFraction": 0.0977528414739238 },
      { "season": 2024, "variable": "noteCount", "n": 34016, "predictedMean": 13.601035874238605, "observedMean": 15.191027751646285, "deficitFraction": 0.10466651127244299 },
      { "season": 2024, "variable": "onStageRobotCount", "n": 34016, "predictedMean": 0.857746772716172, "observedMean": 0.965310442144873, "deficitFraction": 0.1114290954832104 },
      { "season": 2025, "variable": "autoCoralCount", "n": 35754, "predictedMean": 1.688361179958326, "observedMean": 2.0476590031884543, "deficitFraction": 0.17546760601772943 },
      { "season": 2025, "variable": "autoLineCount", "n": 35754, "predictedMean": 2.595904799343648, "observedMean": 2.7729764501873917, "deficitFraction": 0.0638561682814787 },
      { "season": 2025, "variable": "botRow", "n": 35754, "predictedMean": 2.2430509918985186, "observedMean": 2.6939922805839904, "deficitFraction": 0.16738774343767568 },
      { "season": 2025, "variable": "endGameBargePoints", "n": 35754, "predictedMean": 9.702370163031718, "observedMean": 11.10628181462214, "deficitFraction": 0.12640698975800171 },
      { "season": 2025, "variable": "midRow", "n": 35754, "predictedMean": 3.431796910354715, "observedMean": 4.189097723331655, "deficitFraction": 0.18077897986458216 },
      { "season": 2025, "variable": "topRow", "n": 35754, "predictedMean": 7.463840148788097, "observedMean": 8.592073614141075, "deficitFraction": 0.13131096357183206 },
      { "season": 2025, "variable": "trough", "n": 35754, "predictedMean": 2.4509587491282354, "observedMean": 2.703194048218381, "deficitFraction": 0.09331009708917817 },
      { "season": 2026, "variable": "hubTotalCount", "n": 36806, "predictedMean": 162.03952528423744, "observedMean": 188.80120089115906, "deficitFraction": 0.14174526157992662 },
      { "season": 2026, "variable": "totalTowerPoints", "n": 36806, "predictedMean": 1.8779743324034852, "observedMean": 1.9678856708145411, "deficitFraction": 0.04568930997593986 }
    ],
    "warm3of3": [
      { "season": 2016, "variable": "attackedTowerEndStrength", "n": 25191, "predictedMean": 4.119966270398727, "observedMean": 3.469096105752054, "deficitFraction": -0.18761952531885046 },
      { "season": 2016, "variable": "position1crossings", "n": 25191, "predictedMean": 1.8770367924051647, "observedMean": 1.9161605335238776, "deficitFraction": 0.02041777838246314 },
      { "season": 2016, "variable": "position2crossings", "n": 25191, "predictedMean": 1.3619106215033858, "observedMean": 1.4203485371759756, "deficitFraction": 0.04114336315562354 },
      { "season": 2016, "variable": "position3crossings", "n": 25191, "predictedMean": 1.455000541183074, "observedMean": 1.5300702631892342, "deficitFraction": 0.04906292463307344 },
      { "season": 2016, "variable": "position4crossings", "n": 25191, "predictedMean": 1.4090518683767468, "observedMean": 1.489500218331944, "deficitFraction": 0.054010297524688736 },
      { "season": 2016, "variable": "position5crossings", "n": 25191, "predictedMean": 1.4364382212943847, "observedMean": 1.5000198483585407, "deficitFraction": 0.04238719049866766 },
      { "season": 2016, "variable": "teleopChallengePoints", "n": 25191, "predictedMean": 8.966561051933592, "observedMean": 9.664761224246755, "deficitFraction": 0.0722418439641874 },
      { "season": 2016, "variable": "teleopScalePoints", "n": 25191, "predictedMean": 2.387981173607168, "observedMean": 2.987376443968084, "deficitFraction": 0.20064269823482597 },
      { "season": 2017, "variable": "autoFuelPoints", "n": 29377, "predictedMean": 1.7231979692461092, "observedMean": 2.180209007046329, "deficitFraction": 0.20961799365252706 },
      { "season": 2017, "variable": "autoRotorPoints", "n": 29377, "predictedMean": 27.56013259290044, "observedMean": 32.54995404568199, "deficitFraction": 0.15329734247177812 },
      { "season": 2017, "variable": "teleopFuelPoints", "n": 29377, "predictedMean": 1.7610949375059, "observedMean": 2.0550430608979813, "deficitFraction": 0.1430374521026515 },
      { "season": 2017, "variable": "teleopRotorPoints", "n": 29377, "predictedMean": 82.47446828357883, "observedMean": 86.05099227286652, "deficitFraction": 0.04156284424875177 },
      { "season": 2018, "variable": "autoRunPoints", "n": 32266, "predictedMean": 12.697420353189294, "observedMean": 13.437984255873054, "deficitFraction": 0.055109746267197626 },
      { "season": 2018, "variable": "autoSwitchOwnershipSec", "n": 32266, "predictedMean": 4.807500526809742, "observedMean": 5.378075993305647, "deficitFraction": 0.10609286057060703 },
      { "season": 2018, "variable": "endgamePoints", "n": 32266, "predictedMean": 45.21194490000747, "observedMean": 48.53561023988099, "deficitFraction": 0.06847890288072478 },
      { "season": 2019, "variable": "habClimbPoints", "n": 34399, "predictedMean": 11.805004215572767, "observedMean": 12.778801709352017, "deficitFraction": 0.07620413211878758 },
      { "season": 2020, "variable": "endgamePoints", "n": 8582, "predictedMean": 31.52240960804835, "observedMean": 36.18387322302494, "deficitFraction": 0.12882710444636297 },
      { "season": 2022, "variable": "autoCargoTotal", "n": 27944, "predictedMean": 2.6129765898823347, "observedMean": 2.9720512453478385, "deficitFraction": 0.1208171144516988 },
      { "season": 2022, "variable": "endgamePoints", "n": 27944, "predictedMean": 14.101659155212882, "observedMean": 15.670770111651875, "deficitFraction": 0.10012979229861158 },
      { "season": 2022, "variable": "matchCargoTotal", "n": 27944, "predictedMean": 14.724947503150052, "observedMean": 16.429466075007156, "deficitFraction": 0.10374765461490273 },
      { "season": 2023, "variable": "linkPoints", "n": 31184, "predictedMean": 11.595297539563875, "observedMean": 13.675923550538737, "deficitFraction": 0.1521378796310177 },
      { "season": 2023, "variable": "totalChargeStationPoints", "n": 31184, "predictedMean": 24.75657788590979, "observedMean": 26.2955361723961, "deficitFraction": 0.05852545756803559 },
      { "season": 2024, "variable": "endGameTotalStagePoints", "n": 32426, "predictedMean": 4.755242308695891, "observedMean": 5.150558194041818, "deficitFraction": 0.07675204714767225 },
      { "season": 2024, "variable": "noteCount", "n": 32426, "predictedMean": 14.095806473424638, "observedMean": 15.407296613828409, "deficitFraction": 0.08512136640678925 },
      { "season": 2024, "variable": "onStageRobotCount", "n": 32426, "predictedMean": 0.8898140971086026, "observedMean": 0.980787022759514, "deficitFraction": 0.0927550258515377 },
      { "season": 2025, "variable": "autoCoralCount", "n": 34080, "predictedMean": 1.7528759123885111, "observedMean": 2.0992664319248826, "deficitFraction": 0.16500550586080454 },
      { "season": 2025, "variable": "autoLineCount", "n": 34080, "predictedMean": 2.688856222447082, "observedMean": 2.796537558685446, "deficitFraction": 0.03850523512689076 },
      { "season": 2025, "variable": "botRow", "n": 34080, "predictedMean": 2.330886366153766, "observedMean": 2.750674882629108, "deficitFraction": 0.15261291660688966 },
      { "season": 2025, "variable": "endGameBargePoints", "n": 34080, "predictedMean": 10.063680256410931, "observedMean": 11.292018779342722, "deficitFraction": 0.10877935530703123 },
      { "season": 2025, "variable": "midRow", "n": 34080, "predictedMean": 3.560986295561643, "observedMean": 4.292781690140845, "deficitFraction": 0.17047114141860584 },
      { "season": 2025, "variable": "topRow", "n": 34080, "predictedMean": 7.738019797421322, "observedMean": 8.760181924882628, "deficitFraction": 0.11668275113761424 },
      { "season": 2025, "variable": "trough", "n": 34080, "predictedMean": 2.54339182032431, "observedMean": 2.7326584507042253, "deficitFraction": 0.06926099027529034 },
      { "season": 2026, "variable": "hubTotalCount", "n": 35139, "predictedMean": 168.00943822017288, "observedMean": 192.57301004581802, "deficitFraction": 0.12755459251429285 },
      { "season": 2026, "variable": "totalTowerPoints", "n": 35139, "predictedMean": 1.9406504955585089, "observedMean": 1.99251543868636, "deficitFraction": 0.026029882690417172 }
    ]
  },
  "headline": {
    "allRosters": { "below": 33, "total": 34 },
    "warm3of3": { "below": 33, "total": 34 }
  }
}
```
