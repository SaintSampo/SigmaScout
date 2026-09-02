# Context — retune infrastructure (scale-relative params + rolling-origin selection)

Prerequisite work for a full Sigma1 re-tune. Every decision below is backed by a
measurement already taken on the post-260901-is2 build. Nothing here is speculative.

- Pre-registration (protocol, adversarial parameter inventory): https://claude.ai/code/artifact/426c656b-b2eb-4731-83f2-35f1830d6577
- Diagnostics (the measurements): https://claude.ai/code/artifact/40a80d44-66b8-4c0f-bea6-88069b8a956b

**Guiding constraint from the user: keep the implementation LEAN.** Where a
parameter or mechanism is borderline, drop it.

## Why this is needed (the measured problem)

`vpr@3.0.0` fixed the published ± but, as a side effect, degraded predicted SCORES:
larger R lowers the Kalman gain, so the filter lags an improving league harder.
Measured against the retired estimator on identical matches:

| season | MAE now | MAE before | bias now | bias before |
|---|---|---|---|---|
| 2025 | 21.14 | 19.75 | +9.10 | +4.05 |
| 2026 | 58.53 | 50.56 | +25.89 | +4.92 |

Brier and SD(z) both scored that change as equal-or-better, so it shipped invisibly.
It is not user-visible yet — the R2 artifacts are stale (see
`.planning/todos/pending/regenerate-published-artifacts-post-is2.md`), so the live
site still serves the old model. **This must be fixed before that republish.**

Raising process noise recovers it completely: at 16x the shipped value, 2026 MAE
returns to 50.8 and bias to +4.9 — the retired estimator's numbers — while SD(z)
stays ~1.16 and Brier IMPROVES by 0.0078.

## D-T1 — process noise (and 4 others) become scale-relative (LOCKED)

The optimal process-noise multiplier tracks each season's alliance-score variance:

| season | score variance | ratio vs 2024 | best multiplier |
|---|---|---|---|
| 2024 | 718 | 1.00x | 1x |
| 2022 | 900 | 1.25x | 1x |
| 2023 | 1,406 | 1.96x | 1x |
| 2025 | 2,652 | 3.69x | 4x |
| 2026 | 20,164 | 28.07x | 16x |

log-log regression: **r = 0.970, slope = 0.90** (1.0 would be exact proportionality).

**Change:** express these five as fractions of the season's alliance-score VARIANCE,
using the leak-free expanding statistic the module already maintains
(`state.allianceScoreStats`, read via `standardDeviation(...)` exactly as the
win-probability link already does — Pitfall EPA-1 applies unchanged: it must only
ever reflect matches already replayed).

| current (absolute) | becomes | scaling |
|---|---|---|
| `processNoiseWithinEvent` (pts²) | `processNoiseWithinEventRel` | x sigma² |
| `processNoiseEventBoundary` (pts²) | `processNoiseEventBoundaryRel` | x sigma² |
| `coldStartConsistencyVariance` (pts²) | `coldStartConsistencyVarianceRel` | x sigma² |
| `minConsistencyVariance` (pts²) | `minConsistencyVarianceRel` | x sigma² |
| `coldStartTeamTotal` (pts) | `coldStartTeamTotalRel` | x sigma (LINEAR, not squared) |

**`fallbackScoreSd` STAYS ABSOLUTE.** It is the bootstrap value for sigma itself,
used when fewer than two alliance scores exist; it cannot be a fraction of the
quantity it stands in for. This was an error in the first draft of the
pre-registration and is corrected here.

Defaults must be chosen so the new relative values REPRODUCE roughly the currently
promoted absolute behaviour on the tune seasons (whose sigma² is ~700-1400), so the
change is a reparameterization rather than a silent retune. The actual values then
get selected by the re-tune.

Season-boundary note: `allianceScoreStats` deliberately carries across seasons
(it is not reset). So a new season starts scaled by the PREVIOUS season's sigma and
converges to its own within a few hundred matches. That lag is real, leak-free, and
accepted — document it rather than "fixing" it by resetting, which would leave the
first matches of every season with no scale at all.

## D-T2 — carry weights merge into one share (LOCKED)

`sigma1Carryover` computes `carryLastYearWeight * lastYear + carryPriorYearWeight * yearBefore`
— UNNORMALIZED. So their SUM controls overall shrinkage (already
`carryMeanReversion`'s job) while only their RATIO asks a distinct question. Two
parameters carrying one new degree of freedom plus a duplicate.

**Change:** replace both with a single `carryPriorYearShare` in [0,1]:
`blended = (1 - share) * lastYear + share * yearBefore`. Weights now always sum to 1,
magnitude is preserved, and `carryMeanReversion` becomes the sole shrinkage control.
Default `share = 0.3` reproduces today's 0.7/0.3.

**EPA's own `epaCarryover` is FROZEN and must not change** — D-04 pins it to
Statbotics' published constants, and the user has explicitly confirmed EPA stays a
clean Statbotics reference. Only `sigma1/carryover.ts` changes.

## D-T3 — search-space pruning (LOCKED)

Remove from the searchable set (keep as documented constants, still versioned):
- `covShrinkage` — screen optimum was 0 at the bound, but it exists to keep the
  covariance matrix positive semi-definite for the group-spread quadratic form.
  Tuning a numerical safeguard against Brier trades a guarantee for ~0.0005. Fix it.
- `coldStartTeamTotalRel`, `fallbackScoreSd` — inert by construction (apply only
  before any league data exists at all).
- `rpMonteCarloSeed` — tuning a random seed optimizes the realization, not the model.
- `rpMonteCarloDraws` — a compute/precision tradeoff; set by a convergence check.

`searchSpace.ts` must express this explicitly (a named exclusion list with reasons),
not by omission — a future reader must not be able to re-add them by accident.

## D-T4 — adaptation stays, as a binary mode for the re-tune to settle (LOCKED)

Measured: adaptation beats off in every arm, and still adds **-0.0015** Brier on top
of 16x process noise (holdout 0.153558 -> 0.152054), so it is NOT merely a proxy for
process noise. But its winning sub-parameters were selected by looking at holdout,
which inflates that figure.

**Do not delete it and do not enable it in this task.** It enters the re-tune as two
independent optimizer runs (the D-06 precedent), with sub-parameters selected
rolling-origin. It ships only if it wins out-of-sample.

## D-T5 — rolling-origin selection replaces the fixed tune/holdout split (LOCKED)

Implements `.planning/todos/pending/rolling-origin-hyperparameter-tuning.md`, which
records the user's own request to remove the split at its source.

For each scored season S, select hyperparameters using ONLY seasons strictly before S:

| scored | selected on |
|---|---|
| 2024 | 2022-2023 |
| 2025 | 2022-2024 |
| 2026 | 2022-2025 |

This lifts the project's match-level predict-before-update discipline to the
hyperparameter level — the one place it currently does not reach. `TUNE_SEASONS` /
`HOLDOUT_SEASONS` in `score.ts` stay for now (other callers and committed artifacts
read them) but the tuner must stop depending on them.

## D-T6 — event-blocked uncertainty everywhere (LOCKED)

Matches within an event share teams, a field and a game state. Measured on the tune
pool (47,851 matches, 561 events): match-level bootstrap SE **0.000896**, event-level
SE **0.001219** — the naive figure understates by 40%.

Every interval, stopping rule and comparison uses the EVENT-blocked bootstrap.
Provide it as a tested, exported helper so no call site rolls its own.

## D-T7 — acceptance rule, pre-committed (LOCKED)

A candidate replaces the incumbent only if BOTH hold:
1. It beats the incumbent by more than `sqrt(2 * ln N) * SE_event` on data the
   selection never saw, where N is the number of evaluations. At N=60 that is
   **0.0035 Brier**. N must be recorded alongside the result — the bar moves with it.
2. **Score-MAE guardrail:** it does not materially worsen alliance-score MAE versus
   the incumbent. This is a VETO, not a second tuned objective. It exists because the
   ± fix shipped a 16% MAE regression that Brier and SD(z) both rated equal-or-better.

A search that finds nothing above the bar is a SUCCESSFUL search whose correct
outcome is to keep the incumbent and say so. The tuner must be able to report that
without it reading as a failure.

## Scope

**In:** `sigma1/params.ts`, `sigma1/index.ts`, `sigma1/carryover.ts`,
`sigma1/covariance.ts` + `consistency.ts` if a floor moves, `harness/searchSpace.ts`,
`harness/tune.ts`, `harness/promote.ts` (provenance for the new shape), a new
event-blocked bootstrap helper, and their tests. `SIGMA1_CODE_VERSION` 3.0.0 -> 4.0.0
(the parameter set's SHAPE changes, so no old file can be parsed as a new one), with
the two `vpr@3.0.0+*.json` files retired and re-promoted per the precedent
`params.ts` already documents.

**Out:** running the actual re-tune (a separate compute job); regenerating R2
artifacts; EPA's frozen constants; anything under `apps/web`.

## Verification bar

- A replay with the new relative defaults, on the TUNE seasons, reproduces the
  current promoted behaviour closely enough to confirm this is a reparameterization
  and not an accidental retune. Any deliberate deviation must be stated.
- A test proves the scale-relative process noise actually tracks sigma: two synthetic
  seasons differing only in score scale produce Kalman gains in the expected ratio.
- A test proves `carryPriorYearShare` at 0.3 reproduces the old 0.7/0.3 blend.
- A test proves the excluded parameters cannot be searched (the exclusion is
  enforced, not conventional).
- The event-blocked bootstrap helper is tested against a known-dependence fixture.
