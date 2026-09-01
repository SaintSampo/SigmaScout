---
quick_id: 260901-is2
slug: model-correctness-fixes-from-adversarial
date: 2026-09-01
status: complete
tasks_completed: 6
requirements: [D-Q1, D-Q2, D-Q3, D-Q4]
---

# Summary — model correctness fixes from the adversarial review

Four defects found by the 2026-09-01 adversarial review, each validated against the real
corpus in a scratchpad before this task existed, now shipped with D-13 version bumps and
re-promoted parameter sets. Findings report:
https://claude.ai/code/artifact/1ecf49e0-47a7-4f0a-956a-6659a0cd5d78

## Commits

| SHA | Task | What changed |
|---|---|---|
| `cd1e1edb` | 1 (D-Q3) | A no-call counts as a MISS in winner accuracy |
| `8886e72c` | 2 (D-Q1) | EPA attributes the alliance ERROR, not the alliance total |
| `9e23d18a` | 3 (D-Q4) | OPR's logistic scale becomes an expanding-window SD |
| `41d87ad0` | 4 | `promote.ts` gains an auditable `--set-param` override |
| `3b3c0dbf` | 5 (D-Q2) | VPR estimates R from innovations, not gain-weighted corrections |
| `76495a4b` | 6 | Five deferred todos, stale-prose fixes, worker-test regression fix |
| `d9750435`, `cae4fb9f` | — | Planning artifacts (PLAN/CONTEXT, deferred-items) |

Live versions: **epa `2.0.0+baseline`**, **opr `4.0.0+baseline`**,
**`SIGMA1_CODE_VERSION` `3.0.0`**, `STATE_SNAPSHOT_SHAPE_VERSION` **3**.

## What each fix does

**D-Q1 — EPA attribution.** `applyComponentUpdate` now computes the alliance's predicted
total once per component from the pre-update snapshot and credits each teammate
`currentMean + (observed − predicted)/n`, matching Statbotics' `attribute_match`. The
retired even split pulled every team toward its alliance's mean every match. Measured
before shipping: OLS slope vs Statbotics 0.489 → 0.841, rating SD 12.5 → 17.4 (theirs
18.7), 2025 quals Brier 0.1950 → 0.1589.

**D-Q2 — the published ±.** R is now estimated from innovations
(`max(0, innovation² − ΣP)/n`) rather than from an EWMA of gain-weighted corrections
`(K·innovation)²`, which decayed as the filter converged regardless of how much a team
actually varied. Applied in three places that must agree: the per-component consistency,
the per-team covariance matrix, and `Sigma1League.componentConsistency` (the shrinkage
prior — leaving it behind would have silently voided the fix for every thin-history team).
`residualsByTeam` is unchanged and still feeds the RP cross-covariance.

**D-Q3 — no-call is a miss.** `scoreSet` enters `pRedWin === 0.5` into the winner-accuracy
denominator and counts it incorrect. Ties stay excluded; Brier is unchanged. This closes a
real comparison defect: OPR declines ~7% of every season, so the old denominator scored it
on a strictly easier population than VPR and EPA.

**D-Q4 — OPR's scale.** `standardDeviation(state.allianceScoreStats, 25) / 1.1`, folded
leak-free from matches already replayed, replacing the fixed `OPR_LOGISTIC_SCALE = 10`.
A per-season *fitted* constant would have been leakage; the expanding form is leak-free,
adapts within a season, and matched or beat the leaky per-season ceiling in all five
seasons (Brier 4.1%–18.8% better).

## Re-promoted parameter sets

Both digests were produced by `pnpm promote` running the final code. **Nothing was
hand-edited.**

Task 1 (metric change only, algorithm untouched) — both `predictionStreamSha256` values
held byte-for-byte, which was the required stop-condition check:

| file | accuracy before → after | Brier |
|---|---|---|
| `vpr@2.1.0+tuned-2026-08` | 0.7327935 (181/247) → 0.6934866 (181/261) | 0.1740754 unchanged |
| `vpr@2.1.0+tracer-check` | 0.7206478 (178/247) → 0.6819923 (178/261) | 0.1781606 unchanged |

The denominator is **261**, not the plan's predicted 262 — `aggregateScores` excludes 3
ties *and* 1 surrogate-affected prediction from the 265-match slice. The executor caught
this by checking `digest-slice.json` directly rather than trusting the plan's arithmetic.

Final 3.0.0 files (2.1.0 retired in the same commit):

| file | accuracy | Brier | linkC |
|---|---|---|---|
| `vpr@3.0.0+tuned-2026-08` | 0.7203065 (188/261) | 0.1688620 | **0.5** |
| `vpr@3.0.0+tracer-check` | 0.7049808 (184/261) | 0.1820503 | 1 |

The tuned set's provenance carries `paramOverrides: {"linkC": 0.5}`, a note explaining the
post-search re-selection, and **`objectiveAppliesToPromotedParams: false`** — so the file
cannot be misread as a fresh tune. Every other parameter in it was searched against the
retired estimator and is stale; the re-tune is filed as a todo.

## Durable evidence left behind

The scratchpad harness that produced the original measurements was session-local. The
committed replacements:

- `sigma1/innovationVariance.test.ts` — synthetic league, truth known by construction
  (60 teams, true σ = 12, seeded PRNG). Shipped estimator recovers **13.40** (1.12×,
  assertion window [10, 15]); the retired estimator on the same fixture returns **6.88**
  (0.57×), R term alone 4.72. The negative control is a full standalone replay of the
  retired recursion, so a revert cannot pass by widening a tolerance.
- `epa.test.ts` — a teammate on an alliance that hits its prediction exactly does not move,
  plus a negative control proving the test isn't vacuous.
- `brier.test.ts` — a no-call is a miss; the remaining `null` case is ties-only.
- `opr.test.ts` — the expanding scale, its `count < 2` fallback, leak-freeness (re-predicting
  an earlier match from the old state is byte-identical), and DQ exclusion.
- `promoteOverride.test.ts` — the override cannot construct a set that violates a
  cross-parameter invariant.

**All 246 pre-existing sigma1 tests passed unedited**, including the alliance-additivity
identity CONTEXT named as part of the verification bar. All pre-existing EPA tests passed
unedited (`+114/−0` on that file) — the plan predicted this, because every fixture is
either `n === 1` or starts from uniform cold-start means, where both formulas coincide.

## Two real bugs found while implementing

1. **Zero-variance deadlock (Task 5).** The innovation sample is floored at 0 and *genuinely
   equals 0* early in a season. Seeding a cold-start belief variance from that gives
   `P = 0` and `R = 0` → `pooledVariance = 0` → the zero-gain branch: a team that can never
   learn from its first observation while publishing `0 ±`. The retired squared-residual
   sample was never exactly 0, so this path did not previously exist. Fixed with
   `seedConsistencyFor`, reusing `shrinkConsistency`'s own `minConsistencyVariance` floor.
2. **Worker version pin (Task 6).** `liveAlgorithmTier.test.ts` hardcoded `"2.1.0+test"`,
   which only passed because `SIGMA1_CODE_VERSION` happened to equal it; the fixture was
   already internally inconsistent. Now derived from the constant so the next bump can't
   rot it.

## End-to-end validation on the real corpus

Ran `pnpm harness --algorithm vpr --seasons 2024-2024` against the shipped code and
measured `z = (actual − predicted margin) / √variance` on the scored population
(offseason and surrogate-affected excluded). An honest ± gives SD(z) = 1.00 and 68.3%
coverage inside ±1σ:

| slice | n | SD(z) | coverage @1σ | before this task |
|---|---|---|---|---|
| 2024 quals | 13,792 | **1.141** | 65.5% | 1.62 (50.0%) |
| 2024 elims | 2,867 | **1.065** | 66.5% | 2.14 (39.0%) |

The published ± is now within ~14% of truthful, from ~2× understated. It differs slightly
from the scratchpad's predicted 0.94/1.02 because the shipped version also moved
`Sigma1League.componentConsistency` to the new estimator (a coupling the scratchpad patch
missed) and added the `seedConsistencyFor` floor.

## Verification

```
npx vitest run    → Test Files  1 failed | 155 passed (156)
                    Tests       2 failed | 2699 passed | 1 skipped (2702)
npx tsc --noEmit  → clean
```

The 2 failures are **pre-existing and out of scope**: `payloadBudget.test.ts`'s teams
(3,704,776 > 3,500,000) and team (675,956 > 600,000) page budgets. Verified inherited —
`git diff c6085aa5 HEAD -- packages/harness/payloadBudget.test.ts docs/publish-budget.md`
is empty. The ceilings were **not** raised to make them pass; filed as todo 5 instead.
The 1 skipped test is the designed corpus-absent guard.

`git status --porcelain -- apps/web` is empty — the concurrent UI agent's work was never
touched, and no destructive git operation was run at any point.

## Deferred (filed as todos)

`.planning/todos/pending/`:

1. `retune-sigma1-under-innovation-r.md` — every tuned parameter except `linkC` was searched
   against the retired estimator; `coldStartConsistencyVariance` (25) is the most stale.
2. `regenerate-published-artifacts-post-is2.md` — all three algorithm versions changed and
   D-Q3 moves every accuracy figure on the site (OPR 2025 quals ≈72.3% → ≈66.1%). Also:
   `STATE_SNAPSHOT_SHAPE_VERSION` is now 3, so seeded D1 state must be re-seeded from a
   fresh publish run before the Worker can fold.
3. `remeasure-baseline-fingerprint-post-is2.md` — `data/baselines/` records the old versions
   as historical fact; it must be re-measured, never edited in place.
4. `sigma1-cold-start-zero-plus-minus.md` — a never-seen team still publishes `0 ± 0`.
5. `payload-budget-teams-and-team-page-overage.md` — the two pre-existing failures.
