# Context — model correctness fixes (adversarial review, 2026-09-01)

Four changes, each already validated by replaying the real corpus against patched
**copies** of the modules in a scratchpad before this task existed. The measurements
below are results, not predictions: the implementation must reproduce them.

Full findings report: https://claude.ai/code/artifact/1ecf49e0-47a7-4f0a-956a-6659a0cd5d78

## D-Q1 — EPA attribution is wrong (LOCKED)

`packages/core/algorithms/epa.ts` `applyComponentUpdate` credits each teammate
`observedShare = allianceValue / teams.length` — the alliance TOTAL split evenly.
Statbotics' `attribute_match` (verified against avgupta456/statbotics master,
`backend/src/models/epa/main.py` + `breakdown.py post_process_attrib`) credits the
alliance **error**: `err = (observed − predicted)`, `attrib = epa + err/n`.

The even split pulls every team toward its alliance's mean every match. A 40-point
robot with two 10-point partners, alliance scoring exactly its predicted 60, is fed
"20" and drops; Statbotics' error is 0 and nobody moves.

**Required change:** per component, compute the alliance's predicted total from the
PRE-update snapshot (sum of teammates' current means, using the same `coldStart`
fallback the function already applies), then feed each teammate
`currentMean + (allianceValue − predictedAllianceTotal) / teams.length`.
One predicted-total pass per alliance, before the per-team loop — Statbotics
computes one `pred_bd` per alliance then loops teams, and every teammate must be
attributed against the SAME prediction.

Do NOT change: the D-04 foul cross-attribution, the D-05 fallback path, the D-08
elim-weight/counter divergences, `twoStageEwma`, or `epaPercentFunc`.

**Measured (5-season faithful replay, carrySeason, offseason built-not-scored):**

| Metric | Before | After |
|---|---|---|
| OLS slope vs Statbotics `epa.total_points` (2025, 3,690 teams) | 0.489 | 0.841 |
| Pearson / Spearman | 0.729 / 0.734 | 0.900 / 0.886 |
| rating SD (Statbotics 18.7) | 12.5 | 17.4 |
| mean abs difference | 11.2 pts | 5.9 pts |
| 2025 quals Brier / acc | 0.1950 / 72.5% | 0.1589 / 77.5% |
| 2026 quals Brier / acc | 0.1771 / 73.9% | 0.1427 / 79.7% |
| 2025 elims Brier / acc | 0.1897 / 73.8% | 0.1616 / 76.9% |
| 2026 elims Brier / acc | 0.1595 / 77.2% | 0.1442 / 78.8% |
| 2026 elim score bias | +45.6 pts | +13.5 pts |

Slope lands at 0.84 not 1.00 because of the divergences the module documents on
purpose (full-weight elims vs `ELIM_WEIGHT=1/3`, counter increments on elims, no
per-season post-processing, different component decomposition). Those stay.

## D-Q2 — the published ± is estimated from the wrong quantity (LOCKED)

`sigma1/index.ts` publishes `spread = √(P + R)`. R comes from EWMA-ing
**gain-weighted corrections** `K·innovation` (`residualsByTeam`), where
`K = P/(ΣP+R)`. As the filter converges K shrinks, so R decays toward its floor no
matter how much the team actually varies. The published ± therefore measures how
much the filter is still adjusting, not the team's match-to-match spread.

**Required change:** estimate R from innovations, which are observable. The identity
is `E[innovation²] = ΣP_teammates + R_alliance`, so an unbiased per-team sample for
one component is `max(0, innovation² − ΣP) / n`.

- per-component consistency (the R fed back into the Kalman gain) folds that
  variance sample
- the per-team covariance matrix (which drives the TOTAL and phase-group spreads,
  and `predict()`'s predictive variance) folds
  `outer(d, d) − diag(ΣP/n)` where `d_c = innovation_c / √n`, diagonal floored at 0
  before the EWMA, off-diagonals left signed and then shrunk toward the diagonal
  exactly as `covariance.ts` already does. The off-diagonals are required — group
  spreads need `Cov(auto_i, auto_j)` and no client can reconstruct them.

Keep `residualsByTeam` as-is for the RP cross-covariance fold (`rp/state.ts`) so
that subsystem is unchanged.

`consistency.ts`'s `foldConsistency` takes a RESIDUAL and squares it internally;
the honest estimator produces a VARIANCE directly. Add a sibling entry point rather
than passing `Math.sqrt(sample)` through the old one — the module's header block
explicitly names conflating these three variances as the top failure mode, so the
boundary must stay legible.

**Measured.** Synthetic league, truth known by construction (60 teams, true per-team
per-match σ = 12, model assumptions exactly satisfied, promoted params):

| | published ± | vs truth |
|---|---|---|
| current estimator | 2.29 (range 1.66–4.19) | 5.3× understated |
| innovation-based | 12.35 (range 7.0–25.5) | 0.97× — correct |

Point estimates also improve (mean abs error of means 3.45 → 2.57) because a
correctly-sized R stops the filter over-trusting each observation.

Real corpus, SD of `z = (actual − predicted margin)/√variance` (honest ⇒ ≈ 1.0):

| season | quals before → after | elims before → after |
|---|---|---|
| 2022 | 3.01 → 1.21 | 3.48 → 1.13 |
| 2023 | 2.29 → 1.13 | 2.85 → 1.19 |
| 2024 | 1.62 → 0.94 | 2.14 → 1.02 |
| 2025 | 2.71 → 1.06 | 3.11 → 0.89 |
| 2026 | 4.12 → 1.25 | 4.99 → 0.96 |

Holdout playoff calibration: mean absolute gap 0.072 → 0.041; the 0.9–1.0 bucket
stops holding 2,670 of 6,268 matches at 91.5% and holds 1,146 at 97.2%.

### linkC must be re-selected with it

Honest variance is larger, so the link constant is stale. Selecting on TUNE seasons
only (2022–2024), exactly how the promoted set was chosen:

| config | tune-selected linkC | holdout quals Brier | holdout elims Brier |
|---|---|---|---|
| current estimator | 1.24 (reproduces the promoted value) | 0.1551 | 0.1596 |
| innovation-based R | **0.5** | 0.1551 | **0.1580** |

Equal on quals, better on playoffs, and the ± becomes truthful. Coarse grid
(0.2/0.3/0.4/0.5/0.7/1.0/1.24/1.5/2/3); a finer search may shift it slightly.

**Scope note:** the R-estimator change also makes the OTHER tuned params stale
(they traded off against the old R). A full re-tune is a FOLLOW-UP, not part of
this task — promote with linkC re-selected and say so explicitly in the
provenance. Do not quietly present the result as a fresh tune.

## D-Q3 — a no-call must count as a miss (LOCKED, user decision)

`packages/core/scoring/brier.ts` `scoreSet` currently excludes `pRedWin === 0.5`
from the winner-accuracy denominator. The user's decision: a model that declines to
call a match has failed to predict it, and must be scored as wrong.

**Required change:** no-calls enter the accuracy denominator and are always counted
incorrect. TIES stay excluded (there is no winner to have predicted) — that contract
is unchanged. `noCallCount` stays reported. Brier scoring is unchanged (a no-call
already scores 0.25 against a decided match).

The file's header block documents the current contract in prose and must be
rewritten, not just the code. `brier.test.ts` asserts the old contract explicitly.

**Blast radius (expected, not a regression):** OPR declines ~7% of every season
(1,012–1,305 matches — its event-scoped quals-only design matrix has no rank at each
event's start). Its published accuracy will drop materially: 2025 quals ≈ 72.3% → ≈ 66.1%.
VPR and EPA are ≈ 0 no-calls after 2022 and barely move. This is the intended
effect — the old denominator was measuring OPR on an easier population than the
others, which made every OPR-vs-VPR accuracy comparison invalid.

## D-Q4 — OPR's logistic scale, per season (LOCKED, investigated)

`OPR_LOGISTIC_SCALE = 10` has been fixed since 2022. Per-season optima are 19, 28,
21, 31, **75**. The naive fix — a constant fitted per season — is LEAKAGE (it uses
the outcomes it predicts). Investigated four options; the leak-free
expanding-window form captures essentially all of the headroom:

| season | split | fixed 10 | own-best (LEAKY ceiling) | prior-season constant | expanding SD ÷ k |
|---|---|---|---|---|---|
| 2022 | tune | 0.1890 | 0.1810 @19 | — | **0.1812** |
| 2023 | tune | 0.2171 | 0.1963 @28 | 0.1996 | **0.1962** |
| 2024 | tune | 0.2126 | 0.2012 @21 | 0.2025 | **0.2011** |
| 2025 | holdout | 0.2119 | 0.1891 @31 | 0.1924 | **0.1892** |
| 2026 | holdout | 0.2211 | 0.1796 @75 | 0.1921 | **0.1795** |

**Required change:** `scale_t = expandingAllianceScoreSD_t / k`, with **k = 1.1**
fitted on tune seasons only. It matches or beats the leaky per-season ceiling in
every season (it adapts WITHIN a season too) and beats the prior-season constant
everywhere. Brier improves 4.1%–18.8%; elimination-only 2.6%–19.0% except 2022
elims (−3.2%).

Mechanics: `opr.ts` must carry an `ExpandingStats` of alliance scores on `OprState`,
folded in `update()` (both alliances, subject to the same `isFullyDqZeroScoreAlliance`
exclusion `epa.ts`/`sigma1` already apply), and read in `predict()` via
`standardDeviation(stats, fallback)`. Reuse `packages/core/scoring/expandingStats.ts`
— do not write a second implementation. This is the same leak-free construction
`epa.ts` uses (Pitfall EPA-1): it must only ever reflect matches already replayed.
Keep a documented fallback for `count < 2` (25, matching `EPA_FALLBACK_SCORE_SD`).

Note the expanding stat is SEASON-wide even though OPR's ratings are event-scoped —
it is a link-function scale, not a rating, and that is what was validated above.

This does not reduce OPR's no-calls: those come from a zero predicted margin, and
`0/scale = 0` for any scale. Under D-Q3 they now count as misses. Expected.

## Cross-cutting requirements

- **Version bumps (D-13).** All four change observable output, so no version string
  may stand for two different computations. `epa` 1.1.0 → 2.0.0;
  `SIGMA1_CODE_VERSION` 2.1.0 → 3.0.0; `opr` 3.1.0 → 4.0.0. Each bump needs the
  same style of comment the existing bumps carry, naming this task.
- **Promoted parameter sets.** `digest.test.ts` re-runs every committed
  `data/algorithm-versions/*.json` and requires an exact digest match, and forbids
  hand-editing a digest to make a failing test pass. Follow the precedent
  `params.ts` already documents for the 2.0.0 → 2.1.0 bump: retire the two
  `vpr@2.1.0+*.json` files and re-promote as `vpr@3.0.0+*.json` **in the same
  commit**, via `promote.ts`, so the digests are generated by the new code rather
  than edited. `tuned-2026-08`'s replacement carries linkC 0.5.
- **Do not touch** `apps/web` — another agent is actively working there.
- **Out of scope (surface as follow-ups):** a full hyperparameter re-tune under the
  new R estimator; regenerating published R2 artifacts and the compare page's
  accuracy figures (every accuracy number on the site moves under D-Q3); the
  cold-start `0 ± 0` issue for never-seen teams.

## Verification bar

A change is done when the measurement above reproduces. The scratchpad harness that
produced these numbers is session-local and will be gone — the durable equivalents
are: `sigma1.test.ts`'s existing additivity identity must still hold; a new test
asserting the innovation-based estimator recovers a known σ on synthetic data;
`brier.test.ts` asserting a no-call is a miss; an `epa.test.ts` case pinning
error-split attribution (a teammate whose alliance hits its prediction exactly must
not move); and `opr.test.ts` covering the expanding scale and its `count < 2`
fallback.
