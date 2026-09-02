---
quick_id: 260901-trz
slug: scale-relative-reparameterization-and-ro
date: 2026-09-01
status: complete
tasks_completed: 7
requirements: [D-T1, D-T2, D-T3, D-T4, D-T5, D-T6, D-T7]
---

# Summary — retune infrastructure

Prerequisite work for the Sigma1 re-tune: parameters become dimensionless, the search
space is pruned and enforced, and hyperparameter selection moves to rolling-origin with
an event-blocked acceptance rule. The re-tune itself is a separate compute job, filed as
`.planning/todos/pending/retune-sigma1-rolling-origin.md`.

Pre-registration: https://claude.ai/code/artifact/426c656b-b2eb-4731-83f2-35f1830d6577
Diagnostics that motivated it: https://claude.ai/code/artifact/40a80d44-66b8-4c0f-bea6-88069b8a956b

## Commits

| SHA | Task | What |
|---|---|---|
| `952659e6` | 1 | Event-blocked bootstrap + pre-committed acceptance rule (D-T6/D-T7) |
| `5ff48919` | 2 | Equivalence harness, measured reference variance, BEFORE baseline |
| `8bc90fd4` | 3 | Scale-relative shape change, carry-share merge, `SIGMA1_CODE_VERSION` 4.0.0, both re-promotions |
| `86b758c9` | 4 | Search-space pruning enforced by a partition test; `covShrinkage` fixed |
| `df845e6a` | 5 | Rolling-origin selection, four blindness gates, LOSO deleted |
| `6eafe436` | 6 | Out-of-sample evaluation and acceptance decision wired in |
| `f22ce9e0` | 7 | AFTER measurement, retired-behaviour sweep, four follow-ups |
| `2288934e` | — | Planning artifacts tracked, STATE recorded |

## The change

Five unit-carrying parameters became fractions of the season's alliance-score variance,
read from the leak-free expanding statistic the module already maintains:
`processNoiseWithinEventRel`, `processNoiseEventBoundaryRel`,
`coldStartConsistencyVarianceRel`, `minConsistencyVarianceRel`, `coldStartTeamTotalRel`
(the last scaling linearly in sigma, not sigma²). `fallbackScoreSd` stays absolute — it is
the bootstrap for the scale itself and cannot be a fraction of what it stands in for.

`carryLastYearWeight` + `carryPriorYearWeight` merged into a single `carryPriorYearShare`,
weights now constrained to sum to 1, leaving `carryMeanReversion` as the sole shrinkage
control. EPA's `epaCarryover` is untouched — it stays frozen at Statbotics parity.

`SIGMA1_REFERENCE_SCORE_VARIANCE` = **1028.2155111415093**, measured (not chosen) as the
match-count-weighted mean realized expanding variance over 48,037 tune-season matches.

## Equivalence — all four gates pass

The point of the exercise was that behaviour is preserved while the parameters become
dimensionless. Rename-only delta, tune seasons, no bound widened:

| Gate | Bound | Tune-pool measured |
|---|---|---|
| A. Brier | ≤ 0.0024 | **+0.000227** |
| B. score MAE | ≤ 2% relative | **+0.32%** (14.039 → 14.084) |
| C. bias | ≤ 1.0 pt | **−0.141** (−2.001 → −2.142) |
| D. scale-equivariance | exact bitwise at factor 4 | **bitwise identical** `pRedWin`, scores exactly 4× |

2022 is the loosest season on every gate, as expected: it alone pays the cold-start
transient in full (`fallbackScoreSd` = 25 → scale 625, ~0.61× the reference variance).
Bias convention throughout is `mean(predicted − actual)`.

## The regression this partly repairs

`vpr@3.0.0` fixed the published ± but degraded predicted scores, because larger R lowers
the Kalman gain and the filter lags an improving league harder. Reported, never gated:

| | before (3.0.0) | after (4.0.0) | retired-estimator target |
|---|---|---|---|
| 2026 score MAE | 58.531 | **53.136** | ~50.56 |
| 2025 score MAE | 21.144 | **20.585** | ~19.75 |
| 2026 bias | −25.887 | **−13.891** | ~−4.92 |

68% of the 2026 gap closes on the reparameterization alone, with Brier improving by
0.0062. The residual is expected and named: this change makes parameters *track* each
season's scale, it does not re-choose them — the shipped relative values are simply the
old absolutes divided by the reference variance. Closing the rest is the re-tune's job.

## `covShrinkage` — the trade was never real

Measured as a separate delta, never folded into equivalence. Restoring the PSD guarantee
(0.128 → 0.3, now fixed rather than tuned) costs **+0.000020** Brier on the tune pool —
about 1.6% of one event-blocked SE — and *improves* four of five seasons individually.
The pre-registration predicted ~0.0005; that figure came from a 0→0.9 sweep at the
defaults under the retired parameterization and was ~8× too pessimistic. Predicted scores
are bitwise unchanged, which is the structurally correct outcome: `covShrinkage` touches
off-diagonal covariance and therefore predictive variance, never the predicted mean.

## Search space — 16 searchable, 9 excluded, partition enforced

Searchable: `adaptationEwmaAlpha`, `adaptationExponent`, `adaptationMaxFactor`,
`adaptationMinFactor`, `adaptationMinObservations`, `carryMeanReversion`,
`carryPriorYearShare`, `coldStartConsistencyVarianceRel`, `consistencyCarryDecay`,
`consistencyEwmaAlpha`, `covEwmaAlpha`, `linkC`, `minConsistencyVarianceRel`,
`processNoiseEventBoundaryRel`, `processNoiseWithinEventRel`, `shrinkagePriorMatches`.

Excluded, each carrying its reason as data: `covShrinkage`, `coldStartTeamTotalRel`,
`fallbackScoreSd`, `rpMonteCarloSeed`, `rpMonteCarloDraws`, `rpProcessNoiseWithinEvent`,
`rpProcessNoiseEventBoundary`, `rpColdStartVariance`, `adaptationEnabled`.
16 + 9 = 25 = `SIGMA1_PARAM_KEYS.length`, asserted by a partition test. Both
`screenGridFor` and `loadSurvivors` refuse an excluded key and quote its own reason.

## Rolling-origin — four blindness gates

1. `deriveSelectionSeasons` keeps only seasons strictly before the origin; throws on an
   empty window. Runs before any match is replayed.
2. `assertSelectionPrecedesOrigin` recomputes the bound by an independent route; a test
   proves each gate fires where the other cannot.
3. `assertNoFutureSeasonLeak` replaces `assertNoHoldoutLeak` — the old name is **deleted,
   not aliased**, with a test asserting its absence, because the retired predicate passes
   happily on an origin-2024 run that scores 2024.
4. The winner is written to disk **before** any origin-season evaluation.

`--origin` and `--seasons` are mutually exclusive; `--seasons` mode is documented as
carrying no forward-blindness guarantee. The tuner no longer imports `TUNE_SEASONS`,
`HOLDOUT_SEASONS` or `seasonSplit`. LOSO is deleted as superseded.

Bootstrap fixture: analytic 0.090248, event-blocked 0.088954 (−1.43%), match-level
0.020228 — ratio 4.398 against sqrt(20) = 4.472.

## Three RP fields, not two

`rp/state.ts` read the score-side process-noise and cold-start parameters at five sites.
RP threshold variables are **counts**; scaling their noise by an alliance-score variance
reaching ~20,000 in 2026 is a dimensional error. Split into `rpProcessNoiseWithinEvent`,
`rpProcessNoiseEventBoundary` and `rpColdStartVariance`, migrated from the legacy
absolutes. RP behaviour verified **bitwise unchanged** by replaying the same 265-match
slice under a detached pre-change worktree and hashing the state:
`rpBeliefs+rpCovariance = 3a387e12…` under both. (`rpCrossCovariance` correctly differs —
it folds the score-side residual vector, which genuinely moved.)

## Verification

```
npx vitest run    → 159 of 160 files pass; 2801 passed, 1 skipped, 2 failed
npx tsc --noEmit  → clean at every commit boundary
```

The 2 failures are the pre-existing `payloadBudget.test.ts` overages, verified identical
to before this work and already filed. No ceiling was raised. `data/algorithm-versions/`
holds exactly `vpr@4.0.0+tuned-2026-08.json` and `vpr@4.0.0+tracer-check.json`; the
carried `linkC: 0.5` correction survived both migrations. No search was run.
`git diff --name-only 8bc90fd4..HEAD -- apps/web` is empty.

## Known residual

`provenance.paramShapeMigration` is absent and `derivedFromVersion` is self-referential on
the shipped files, because a `--from-version` promotion from a current-version file has no
lineage to record. The 3.0.0→4.0.0 lineage is stated in the provenance note instead. A
future task wanting machine-readable lineage across same-version re-promotions should
carry the field forward in `loadFromVersionFile`.

## Filed follow-ups

`retune-sigma1-rolling-origin.md` (the compute job, with cost table and exact commands),
`regenerate-published-artifacts-post-trz.md`, `rp-process-noise-own-scale.md`,
`remeasure-baseline-fingerprint-post-trz.md`.
