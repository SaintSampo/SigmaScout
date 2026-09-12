# Field-averaged pre-schedule prediction — rung 1 measured against the 4,000-schedule baked path

**Measured at 4,000 schedules × 50 draws = 200,000 total draws per arm.** Every figure in this document is a figure AT THAT COUNT and at no other. A rank tolerance is only meaningful relative to the measurement's own resolution, so the binding noise floor at the same count is quoted beside every candidate rate below rather than left to be looked up.

**FAIL.** Across 6 real finished events (244 teams, every team of every event scored, roster sizes 14-76), the field-averaged predictor's rank bands agree with the 4,000-schedule baked path's on 41.4% of teams within half a rank of median — **against a binding floor of 98.4% at the same count** — where clause 1 needs 95.0%; on 62.3%/63.5% of teams within one rank at the p10/p90 band edges — **against binding floors of 100.0%/100.0%** — where clause 2 needs 90.0%; with a mean signed median shift of -0.034 ranks (clause 3 allows ±0.25). Worst single team: candidate 3.33 ranks against a floor whose own worst team moves 0.71 ranks between two runs of the IDENTICAL construction.

**The binding floor is the baked construction built TWICE**, with fully independent shuffle-and-draw streams at 4,000 schedules, obtained by salting `algorithmVersion` — which `buildPreScheduleArtifact` uses for seed hashing and nothing else. Pricing is the same bound `predict` closure on both sides. It is the ceiling **any** method faces at this count, including the one that ships. A candidate scored against a clause the measurement itself cannot resolve is scoring noise, which is why this document quotes the two together. Like every floor on this project it is a **diagnostic**: it may explain a verdict, never overrule one. The criterion's thresholds are unchanged and were fixed before any measurement existed.

**This document is WRITTEN BY `scripts/measureFieldAveragedRanks.ts --write-doc`, not transcribed from its terminal output.** That is deliberate: on this project `publish:seasons` prints a payload-budget summary it does not write, and the budget tests stay red until a human copies the numbers across. This record does not reproduce that trap.

```json field-averaged-presim
{
  "verdict": "FAIL",
  "algorithm": "bpr@3.0.0+baseline",
  "scheduleCount": 4000,
  "drawsPerSchedule": 50,
  "totalDraws": 200000,
  "eventCount": 6,
  "teamCount": 244,
  "minRosterSize": 14,
  "maxRosterSize": 76,
  "clause1": {
    "pass": false,
    "tightRate": 0.4139,
    "requiredTightRate": 0.95,
    "everyTeamWithinHard": false,
    "worstAbsMedianDiff": 3.33,
    "worstTeamKey": "frc9609",
    "worstEventKey": "2025cur"
  },
  "clause2": {
    "pass": false,
    "p10Rate": 0.623,
    "p90Rate": 0.6352,
    "requiredRate": 0.9
  },
  "clause3": {
    "pass": true,
    "meanSignedMedianDiff": -0.034,
    "tolerance": 0.25
  },
  "bytes": [
    {
      "eventKey": "2022on034",
      "baked": 10258798,
      "fieldAveraged": 1016,
      "ratio": 10097.2,
      "bakedSchedulesFraction": 0.9999
    },
    {
      "eventKey": "2023gaalb",
      "baked": 20609385,
      "fieldAveraged": 1370,
      "ratio": 15043.3,
      "bakedSchedulesFraction": 0.9999
    },
    {
      "eventKey": "2024caav",
      "baked": 36275314,
      "fieldAveraged": 2346,
      "ratio": 15462.6,
      "bakedSchedulesFraction": 0.9998
    },
    {
      "eventKey": "2025cur",
      "baked": 78942585,
      "fieldAveraged": 5395,
      "ratio": 14632.5,
      "bakedSchedulesFraction": 0.9996
    },
    {
      "eventKey": "2026joh",
      "baked": 71883380,
      "fieldAveraged": 4879,
      "ratio": 14733.2,
      "bakedSchedulesFraction": 0.9996
    },
    {
      "eventKey": "2026txmca",
      "baked": 20415674,
      "fieldAveraged": 1394,
      "ratio": 14645.4,
      "bakedSchedulesFraction": 0.9999
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
  "bindingResamplingFloor": {
    "pooledWithinTightRate": 0.9836,
    "pooledP10WithinRate": 1,
    "pooledP90WithinRate": 1,
    "pooledMeanAbsMedianDiff": 0.129,
    "pooled95thPctAbsMedianDiff": 0.412,
    "worstTeamAbsMedianDiff": 0.712,
    "perEvent": [
      {
        "eventKey": "2022on034",
        "withinTightRate": 1,
        "meanAbsMedianDiff": 0.025,
        "maxAbsMedianDiff": 0.065,
        "p10WithinRate": 1,
        "p90WithinRate": 1
      },
      {
        "eventKey": "2023gaalb",
        "withinTightRate": 1,
        "meanAbsMedianDiff": 0.027,
        "maxAbsMedianDiff": 0.081,
        "p10WithinRate": 1,
        "p90WithinRate": 1
      },
      {
        "eventKey": "2024caav",
        "withinTightRate": 1,
        "meanAbsMedianDiff": 0.076,
        "maxAbsMedianDiff": 0.31,
        "p10WithinRate": 1,
        "p90WithinRate": 1
      },
      {
        "eventKey": "2025cur",
        "withinTightRate": 0.9737,
        "meanAbsMedianDiff": 0.2,
        "maxAbsMedianDiff": 0.712,
        "p10WithinRate": 1,
        "p90WithinRate": 1
      },
      {
        "eventKey": "2026joh",
        "withinTightRate": 0.9733,
        "meanAbsMedianDiff": 0.159,
        "maxAbsMedianDiff": 0.65,
        "p10WithinRate": 1,
        "p90WithinRate": 1
      },
      {
        "eventKey": "2026txmca",
        "withinTightRate": 1,
        "meanAbsMedianDiff": 0.023,
        "maxAbsMedianDiff": 0.07,
        "p10WithinRate": 1,
        "p90WithinRate": 1
      }
    ]
  },
  "edgeNoiseFloor": {
    "pooledP10WithinRate": 1,
    "pooledP90WithinRate": 1,
    "perEvent": [
      {
        "eventKey": "2022on034",
        "p10WithinRate": 1,
        "p90WithinRate": 1,
        "meanAbsP10Diff": 0.009,
        "meanAbsP90Diff": 0.007
      },
      {
        "eventKey": "2023gaalb",
        "p10WithinRate": 1,
        "p90WithinRate": 1,
        "meanAbsP10Diff": 0.012,
        "meanAbsP90Diff": 0.02
      },
      {
        "eventKey": "2024caav",
        "p10WithinRate": 1,
        "p90WithinRate": 1,
        "meanAbsP10Diff": 0.035,
        "meanAbsP90Diff": 0.027
      },
      {
        "eventKey": "2025cur",
        "p10WithinRate": 1,
        "p90WithinRate": 1,
        "meanAbsP10Diff": 0.057,
        "meanAbsP90Diff": 0.055
      },
      {
        "eventKey": "2026joh",
        "p10WithinRate": 1,
        "p90WithinRate": 1,
        "meanAbsP10Diff": 0.043,
        "meanAbsP90Diff": 0.049
      },
      {
        "eventKey": "2026txmca",
        "p10WithinRate": 1,
        "p90WithinRate": 1,
        "meanAbsP10Diff": 0.01,
        "meanAbsP90Diff": 0.016
      }
    ]
  },
  "seedNoiseFloor": {
    "pooledWithinTightRate": 1,
    "binds": false,
    "perEvent": [
      {
        "eventKey": "2022on034",
        "withinTightRate": 1,
        "meanAbsMedianDiff": 0.012
      },
      {
        "eventKey": "2023gaalb",
        "withinTightRate": 1,
        "meanAbsMedianDiff": 0.023
      },
      {
        "eventKey": "2024caav",
        "withinTightRate": 1,
        "meanAbsMedianDiff": 0.027
      },
      {
        "eventKey": "2025cur",
        "withinTightRate": 1,
        "meanAbsMedianDiff": 0.048
      },
      {
        "eventKey": "2026joh",
        "withinTightRate": 1,
        "meanAbsMedianDiff": 0.048
      },
      {
        "eventKey": "2026txmca",
        "withinTightRate": 1,
        "meanAbsMedianDiff": 0.018
      }
    ]
  }
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

| Clause | Outcome | Achieved | **Binding floor at 4,000 schedules** | Required |
|---|---|---|---|---|
| 1 — median rank | FAIL | 41.4% within 0.5; every team within 1: false | **98.4%** | ≥ 95.0% and every team |
| 2 — band edges | FAIL | p10 62.3%, p90 63.5% | **100.0% / 100.0%** | ≥ 90.0% on both |
| 3 — systematic shift | PASS | -0.034 ranks | — (a signed mean has no same-construction ceiling of this form) | within ±0.25 |

Worst single team: **frc9609** at **2025cur**, median difference 3.33 ranks. The binding floor's own worst team moves **0.71** ranks between two runs of the identical construction, with a pooled mean `|Δmedian|` of 0.129 and a pooled 95th percentile of 0.412 ranks (clause 1 is satisfiable exactly when that 95th percentile falls to 0.5).

## Per event

Each rate is read **candidate / binding floor** at the same schedule count, so the gap between a verdict and the measurement's own resolution can be attributed by reading one row.

| Event | Season | Teams | Quals | Matches/team | Replay | Clause-1 rate | p10 rate | p90 rate | Mean signed median shift |
|---|---|---|---|---|---|---|---|---|---|
| `2022on034` | 2022 | 14 | 21 | 9 | cold (target season 2022 only, assumption A-FA3) | 92.9% / **100.0%** | 100.0% / **100.0%** | 78.6% / **100.0%** | -0.012 |
| `2023gaalb` | 2023 | 21 | 42 | 12 | cold (target season 2023 only, assumption A-FA3) | 100.0% / **100.0%** | 100.0% / **100.0%** | 100.0% / **100.0%** | -0.006 |
| `2024caav` | 2024 | 40 | 74 | 11 | cold (target season 2024 only, assumption A-FA3) | 60.0% / **100.0%** | 67.5% / **100.0%** | 75.0% / **100.0%** | -0.002 |
| `2025cur` | 2025 | 76 | 127 | 10 | cold (target season 2025 only, assumption A-FA3) | 13.2% / **97.4%** | 42.1% / **100.0%** | 43.4% / **100.0%** | -0.047 |
| `2026joh` | 2026 | 75 | 125 | 10 | cold (target season 2026 only, assumption A-FA3) | 21.3% / **97.3%** | 53.3% / **100.0%** | 57.3% / **100.0%** | -0.056 |
| `2026txmca` | 2026 | 18 | 36 | 12 | cold (target season 2026 only, assumption A-FA3) | 94.4% / **100.0%** | 100.0% / **100.0%** | 94.4% / **100.0%** | -0.008 |

## Artifact size

**Measured at 4,000 schedules, which is NOT the shipped count (20). The baked column below is therefore roughly 200× the size of the artifact that actually ships, because the priced `schedules` block scales with the count. Read the RATIO as an artefact of this measurement's count, not as a shipping figure.** The field-averaged column does not depend on the schedule count at all — it carries no schedules — so it is the same artifact at every count.

| Event | Baked bytes | Field-averaged bytes | Ratio | Field bytes/team | Baked `schedules` block |
|---|---|---|---|---|---|
| `2022on034` | 10,258,798 | 1,016 | 10097.2× | 72.6 | 100.0% |
| `2023gaalb` | 20,609,385 | 1,370 | 15043.3× | 65.2 | 100.0% |
| `2024caav` | 36,275,314 | 2,346 | 15462.6× | 58.6 | 100.0% |
| `2025cur` | 78,942,585 | 5,395 | 14632.5× | 71.0 | 100.0% |
| `2026joh` | 71,883,380 | 4,879 | 14733.2× | 65.1 | 100.0% |
| `2026txmca` | 20,415,674 | 1,394 | 14645.4× | 77.4 | 100.0% |

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

**Two floors, and only one of them binds.** The **binding** floor (the one every rate above is quoted against) builds the baked construction TWICE with independent shuffle-and-draw streams: a candidate arm draws its own K shuffles, so the disagreement it has to survive includes *which K shuffles each side happened to draw*. The **draw-only** floor holds the priced schedules fixed and varies only the draw stream. Holding the shuffles fixed understates the ceiling — visibly so in the columns below — which is why the draw-only column is retained as a diagnostic and is **not** what any verdict is read against. Neither may overrule the criterion.

| Event | Mean season RP/team (baked) | (field-avg) | Mean band width (baked) | (field-avg) | **Binding floor: teams within 0.5** | binding mean \|Δmedian\| | binding worst team | Draw-only floor (does not bind) |
|---|---|---|---|---|---|---|---|---|
| `2022on034` | 16.95 | 17.03 | 7.75 | 8.40 | **100.0%** | 0.025 | 0.07 | 100.0% (mean 0.01) |
| `2023gaalb` | 18.59 | 18.55 | 15.77 | 15.63 | **100.0%** | 0.027 | 0.08 | 100.0% (mean 0.02) |
| `2024caav` | 16.07 | 16.01 | 20.39 | 21.47 | **100.0%** | 0.076 | 0.31 | 100.0% (mean 0.03) |
| `2025cur` | 26.16 | 26.09 | 41.98 | 41.92 | **97.4%** | 0.200 | 0.71 | 100.0% (mean 0.05) |
| `2026joh` | 22.21 | 22.14 | 40.62 | 40.78 | **97.3%** | 0.159 | 0.65 | 100.0% (mean 0.05) |
| `2026txmca` | 28.78 | 28.70 | 12.82 | 13.03 | **100.0%** | 0.023 | 0.07 | 100.0% (mean 0.02) |
| **POOLED** (roster-weighted) | — | — | — | — | **98.4%** | 0.129 | 0.71 | 100.0% |

A systematic season-RP difference points at the moments construction; a systematic band-width difference points at the composition-spread terms. Clause 2 has its own **edge-noise** control, because the p10/p90 band edges are estimated from the tails of the same finite draw count and carry different noise than the median: pooled **100.0% / 100.0%** (draw-only), against the binding floor's **100.0% / 100.0%**.

## Caveats

- **A team's matches are assumed near-independent.** Partners differ each match, which is what makes the assumption reasonable, but the matches of one event are not literally independent draws.
- **Coupling from teams that share specific matches is washed out** — two teams scheduled against each other have correlated outcomes and nothing in the field-averaged form represents that. **And the baked arm washes that same coupling out by design**, averaging over 4,000 independent shuffles precisely so no particular pairing survives into the published band. It is a shared property of both forms, not a defect unique to the new one.
- **The composition-induced spread is treated as Gaussian** — the same approximation class used elsewhere in this pipeline, and the one D-16 names and accepts. The exact mixture over all partner pairs crossed with all opposing triples is computable and is deliberately not computed: roughly 5.7 million `analyticRpPmf` calls per team on a 40-team roster.
- **Assumption A-FA1 (additivity)** is measured above rather than asserted. A large residual standard deviation is the first thing to examine if clause 2 or clause 3 fails.
- **Assumption A-FA3 (replay mode).** Each event's season was replayed in the mode printed in the per-event table above. Both arms read the SAME state, so the comparison stays internally valid either way; the mode is recorded because a cold replay makes the baked arm non-identical to the production sidecar.
- **Neither arm is validated against realised rankings here.** This measures agreement between two forecasts, not the accuracy of either. The rewind-honesty question is `docs/models/rewind-overconfidence-gap.md`'s.

