# Field-averaged pre-schedule prediction — rung 1 measured against the 20-schedule baked path

**FAIL.** Across 6 real finished events (244 teams, every team of every event scored, roster sizes 14-76), the field-averaged predictor's rank bands agree with the 20-schedule baked path's on 32.8% of teams within half a rank of median (clause 1 needs 95.0%), on 55.7%/52.0% of teams within one rank at the p10/p90 band edges (clause 2 needs 90.0%), with a mean signed median shift of -0.046 ranks (clause 3 allows ±0.25).

**This document is WRITTEN BY `scripts/measureFieldAveragedRanks.ts --write-doc`, not transcribed from its terminal output.** That is deliberate: on this project `publish:seasons` prints a payload-budget summary it does not write, and the budget tests stay red until a human copies the numbers across. This record does not reproduce that trap.

```json field-averaged-presim
{
  "verdict": "FAIL",
  "algorithm": "bpr@3.0.0+baseline",
  "eventCount": 6,
  "teamCount": 244,
  "minRosterSize": 14,
  "maxRosterSize": 76,
  "clause1": {
    "pass": false,
    "tightRate": 0.3279,
    "requiredTightRate": 0.95,
    "everyTeamWithinHard": false,
    "worstAbsMedianDiff": 7.594,
    "worstTeamKey": "frc11269",
    "worstEventKey": "2026joh"
  },
  "clause2": {
    "pass": false,
    "p10Rate": 0.5574,
    "p90Rate": 0.5205,
    "requiredRate": 0.9
  },
  "clause3": {
    "pass": true,
    "meanSignedMedianDiff": -0.0465,
    "tolerance": 0.25
  },
  "bytes": [
    {
      "eventKey": "2022on034",
      "baked": 52351,
      "fieldAveraged": 1014,
      "ratio": 51.6,
      "bakedSchedulesFraction": 0.9796
    },
    {
      "eventKey": "2023gaalb",
      "baked": 104902,
      "fieldAveraged": 1368,
      "ratio": 76.7,
      "bakedSchedulesFraction": 0.9822
    },
    {
      "eventKey": "2024caav",
      "baked": 186301,
      "fieldAveraged": 2344,
      "ratio": 79.5,
      "bakedSchedulesFraction": 0.9727
    },
    {
      "eventKey": "2025cur",
      "baked": 410707,
      "fieldAveraged": 5393,
      "ratio": 76.2,
      "bakedSchedulesFraction": 0.9608
    },
    {
      "eventKey": "2026joh",
      "baked": 374772,
      "fieldAveraged": 4877,
      "ratio": 76.8,
      "bakedSchedulesFraction": 0.9582
    },
    {
      "eventKey": "2026txmca",
      "baked": 103776,
      "fieldAveraged": 1392,
      "ratio": 74.6,
      "bakedSchedulesFraction": 0.9857
    }
  ],
  "additivityResidualAFA1": [
    {
      "eventKey": "2022on034",
      "mean": 3.093209,
      "sd": 1.826504,
      "maxAbs": 6.535895,
      "asFractionOfScoreUncertainty": 0.205585
    },
    {
      "eventKey": "2023gaalb",
      "mean": 0,
      "sd": 0,
      "maxAbs": 0,
      "asFractionOfScoreUncertainty": 0
    },
    {
      "eventKey": "2024caav",
      "mean": 3.449986,
      "sd": 1.708776,
      "maxAbs": 8.306683,
      "asFractionOfScoreUncertainty": 0.176282
    },
    {
      "eventKey": "2025cur",
      "mean": 10.697597,
      "sd": 5.562401,
      "maxAbs": 28.012568,
      "asFractionOfScoreUncertainty": 0.26099
    },
    {
      "eventKey": "2026joh",
      "mean": 40.14385,
      "sd": 24.739604,
      "maxAbs": 148.208173,
      "asFractionOfScoreUncertainty": 0.314181
    },
    {
      "eventKey": "2026txmca",
      "mean": 1.107578,
      "sd": 2.150854,
      "maxAbs": 6.645469,
      "asFractionOfScoreUncertainty": 0.055709
    }
  ],
  "seedNoiseFloor": [
    {
      "eventKey": "2022on034",
      "withinTightRate": 1,
      "meanAbsMedianDiff": 0.106
    },
    {
      "eventKey": "2023gaalb",
      "withinTightRate": 0.8571,
      "meanAbsMedianDiff": 0.285
    },
    {
      "eventKey": "2024caav",
      "withinTightRate": 0.675,
      "meanAbsMedianDiff": 0.457
    },
    {
      "eventKey": "2025cur",
      "withinTightRate": 0.5526,
      "meanAbsMedianDiff": 0.634
    },
    {
      "eventKey": "2026joh",
      "withinTightRate": 0.64,
      "meanAbsMedianDiff": 0.528
    },
    {
      "eventKey": "2026txmca",
      "withinTightRate": 1,
      "meanAbsMedianDiff": 0.174
    }
  ]
}
```

## The criterion, fixed before the measurement

Quoted verbatim from `09-PLAN-OUTLINE.md`'s "Answer to the open question — rung 1's pass/fail bar" and encoded as named constants in the measurement script. No threshold was changed after the run.

1. **Median rank:** `|median_rung1 − median_baked| ≤ 0.5` ranks for **≥ 95.0%** of teams, and `≤ 1` ranks for **every** team.
2. **Band edges:** `|p10 diff| ≤ 1` **and** `|p90 diff| ≤ 1` ranks for **≥ 90.0%** of teams.
3. **No systematic shift:** the **mean signed** median-rank difference is within `±0.25` ranks.

Clause 1 is evaluated **pooled across the whole sample**, not per event — a recorded reading fixed before the run, because a per-event 95% on a 22-team roster rounds to a materially stricter bar than the sentence says. The per-event breakdown is printed below so a single bad event cannot hide inside the pool.

Both arms were produced by the **same imported `simulateRanks`** and the **same imported `continuousQuantile`**, from one replay and one model state per event. The arms differ only in the pmf inputs, never in the scorer.

## Verdict

| Clause | Outcome | Achieved | Required |
|---|---|---|---|
| 1 — median rank | FAIL | 32.8% within 0.5; every team within 1: false | ≥ 95.0% and every team |
| 2 — band edges | FAIL | p10 55.7%, p90 52.0% | ≥ 90.0% on both |
| 3 — systematic shift | PASS | -0.046 ranks | within ±0.25 |

Worst single team: **frc11269** at **2026joh**, median difference 7.59 ranks.

## Per event

| Event | Season | Teams | Quals | Matches/team | Replay | Clause-1 rate | p10 rate | p90 rate | Mean signed median shift |
|---|---|---|---|---|---|---|---|---|---|
| `2022on034` | 2022 | 14 | 21 | 9 | cold (target season 2022 only, assumption A-FA3) | 50.0% | 85.7% | 78.6% | -0.075 |
| `2023gaalb` | 2023 | 21 | 42 | 12 | cold (target season 2023 only, assumption A-FA3) | 66.7% | 100.0% | 100.0% | -0.058 |
| `2024caav` | 2024 | 40 | 74 | 11 | cold (target season 2024 only, assumption A-FA3) | 42.5% | 67.5% | 57.5% | 0.007 |
| `2025cur` | 2025 | 76 | 127 | 10 | cold (target season 2025 only, assumption A-FA3) | 19.7% | 39.5% | 35.5% | -0.020 |
| `2026joh` | 2026 | 75 | 125 | 10 | cold (target season 2026 only, assumption A-FA3) | 17.3% | 37.3% | 37.3% | -0.103 |
| `2026txmca` | 2026 | 18 | 36 | 12 | cold (target season 2026 only, assumption A-FA3) | 77.8% | 100.0% | 94.4% | -0.004 |

## Artifact size

| Event | Baked bytes | Field-averaged bytes | Ratio | Field bytes/team | Baked `schedules` block |
|---|---|---|---|---|---|
| `2022on034` | 52,351 | 1,014 | 51.6× | 72.4 | 98.0% |
| `2023gaalb` | 104,902 | 1,368 | 76.7× | 65.1 | 98.2% |
| `2024caav` | 186,301 | 2,344 | 79.5× | 58.6 | 97.3% |
| `2025cur` | 410,707 | 5,393 | 76.2× | 71.0 | 96.1% |
| `2026joh` | 374,772 | 4,877 | 76.8× | 65.0 | 95.8% |
| `2026txmca` | 103,776 | 1,392 | 74.6× | 77.3 | 98.6% |

The `schedules` fraction is **computed from the artifacts measured here**, not quoted from `docs/simulation-architecture.md`'s recorded 95.4%.

## Assumption A-FA1 — the additivity residual, measured

The score half of the field-averaged construction rests on `allianceScore = Σ member totals + C`, under which the per-season additive constant cancels out of the mean score difference. Measured rather than asserted: for every played qualification match of every sampled event, the residual `predict(match).redScore − Σ member totals` (and the blue counterpart).

| Event | Alliances | Mean | SD | Max abs | SD as a fraction of the model's own score uncertainty |
|---|---|---|---|---|---|
| `2022on034` | 42 | 3.0932 | 1.8265 | 6.5359 | 0.2056 |
| `2023gaalb` | 84 | -0.0000 | 0.0000 | 0.0000 | 0.0000 |
| `2024caav` | 148 | 3.4500 | 1.7088 | 8.3067 | 0.1763 |
| `2025cur` | 254 | 10.6976 | 5.5624 | 28.0126 | 0.2610 |
| `2026joh` | 250 | 40.1438 | 24.7396 | 148.2082 | 0.3142 |
| `2026txmca` | 72 | 1.1076 | 2.1509 | 6.6455 | 0.0557 |

## Diagnostics (not part of the criterion, and never used to overrule it)

| Event | Mean season RP/team (baked) | (field-avg) | Mean band width (baked) | (field-avg) | Seed-noise floor: teams within 0.5 | mean \|Δmedian\| |
|---|---|---|---|---|---|---|
| `2022on034` | 16.95 | 17.03 | 7.62 | 8.34 | 100.0% | 0.11 |
| `2023gaalb` | 18.59 | 18.55 | 15.73 | 15.55 | 85.7% | 0.29 |
| `2024caav` | 16.07 | 16.01 | 20.28 | 21.53 | 67.5% | 0.46 |
| `2025cur` | 26.15 | 26.09 | 40.59 | 41.89 | 55.3% | 0.63 |
| `2026joh` | 22.21 | 22.14 | 40.27 | 40.70 | 64.0% | 0.53 |
| `2026txmca` | 28.78 | 28.70 | 12.81 | 13.09 | 100.0% | 0.17 |

A systematic season-RP difference points at the moments construction; a systematic band-width difference points at the composition-spread terms. The **seed-noise floor** is a same-arm control: the baked arm's own priced schedules re-simulated at two seeds, neither of them the published one, compared to each other. It is what a clause-1 rate would look like if the two arms were IDENTICAL and only the draw stream differed.

## Caveats

- **A team's matches are assumed near-independent.** Partners differ each match, which is what makes the assumption reasonable, but the matches of one event are not literally independent draws.
- **Coupling from teams that share specific matches is washed out** — two teams scheduled against each other have correlated outcomes and nothing in the field-averaged form represents that. **And the 20-schedule arm washes that same coupling out by design**, averaging over 20 independent shuffles precisely so no particular pairing survives into the published band. It is a shared property of both forms, not a defect unique to the new one.
- **The composition-induced spread is treated as Gaussian** — the same approximation class used elsewhere in this pipeline, and the one D-16 names and accepts. The exact mixture over all partner pairs crossed with all opposing triples is computable and is deliberately not computed: roughly 5.7 million `analyticRpPmf` calls per team on a 40-team roster.
- **Assumption A-FA1 (additivity)** is measured above rather than asserted. A large residual standard deviation is the first thing to examine if clause 2 or clause 3 fails.
- **Assumption A-FA3 (replay mode).** Each event's season was replayed in the mode printed in the per-event table above. Both arms read the SAME state, so the comparison stays internally valid either way; the mode is recorded because a cold replay makes the baked arm non-identical to the production sidecar.
- **Neither arm is validated against realised rankings here.** This measures agreement between two forecasts, not the accuracy of either. The rewind-honesty question is `docs/models/rewind-overconfidence-gap.md`'s.

