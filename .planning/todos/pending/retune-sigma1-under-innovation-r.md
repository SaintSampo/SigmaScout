---
id: retune-sigma1-under-innovation-r
created: 2026-09-01
source: quick task 260901-is2 (D-Q2) — deferred at plan time, filed by Task 6
resolves_phase:
priority: high
---

# Re-tune Sigma1 under the innovation-based R estimator

## What changed

Quick task 260901-is2 (D-Q2, commit `3b3c0dbf`) replaced Sigma1's R estimator. R used to be
an EWMA of **squared gain-weighted corrections** `(K·innovation)²`, where `K = P/(ΣP+R)`. As
the filter converged K shrank, so R decayed toward its floor no matter how much a team
actually varied. R is now estimated from **innovations**, using the identity
`E[innovation²] = ΣP_teammates + R_alliance`, giving the unbiased per-team per-component
sample `max(0, innovation² − ΣP) / n`.

The retired estimator ran roughly **5× small in SD terms** — on a synthetic league whose true
per-team per-match σ is 12 by construction, it published 2.29; the innovation-based estimator
publishes 12.35. That is a ~25× understatement in *variance* terms, which is the unit every
Sigma1 hyperparameter is expressed in.

`SIGMA1_CODE_VERSION` is now `3.0.0`, and the promoted set is
`data/algorithm-versions/vpr@3.0.0+tuned-2026-08.json`.

## What is now stale

**Every tuned parameter in `vpr@3.0.0+tuned-2026-08` except `linkC`.** The promoted set came
out of a joint search (`reports/tune-joint-off.json`) run entirely against the retired
estimator. Each parameter was selected by how it traded off against an R that was ~25× too
small in variance; none of those trade-offs are re-derived by the estimator change.

`linkC` is the sole exception: 260901-is2 re-selected it on TUNE seasons 2022–2024 only
(coarse grid 0.2/0.3/0.4/0.5/0.7/1.0/1.24/1.5/2/3), landing on **0.5** where the retired
estimator selected 1.24. That override is recorded machine-readably in the committed file's
provenance (`paramOverrides: {"linkC": 0.5}`, a `note`, and
`objectiveAppliesToPromotedParams: false` — the recorded `objective` describes the search
winner, **not** the shipped set). That flag is the anchor: it stays `false` until this todo
closes with a real joint search.

**`coldStartConsistencyVariance` is the most obviously stale.** It is the seed value for a
team with no history, expressed directly in the units the estimator changed:

- `SIGMA1_COLD_START_CONSISTENCY_VARIANCE = 25` (`packages/core/algorithms/sigma1/params.ts:125`)
  — an SD of 5, which `tracer-check` carries verbatim. Against an R that now recovers ~12,
  that is plausibly an order of magnitude too small in variance terms. The constant's own doc
  comment (params.ts:113–124) already records this and names this todo as its follow-up; that
  sentence is the in-code anchor.
- `vpr@3.0.0+tuned-2026-08` carries the **searched** value `16.75421168559074`, chosen against
  the retired estimator — same problem, one search removed.

It matters more than the other stale params because `shrinkConsistency` blends a thin-history
team toward it, and most teams are thin-history early in a season.

## What "done" looks like

1. A full joint hyperparameter search under the innovation-based estimator, on **tune seasons
   2022–2024 only** — the same protocol that produced the current set, so the two are
   comparable. `pnpm tune`, then `pnpm promote --from <new artifact> --name <new set name>`.
2. The result is promoted **without** `--set-param`, so the committed provenance carries no
   `paramOverrides` and `objectiveAppliesToPromotedParams` is absent — i.e. the recorded
   `objective` genuinely describes the shipped set again. If the new search still needs an
   override, this todo is not closed.
3. `linkC`'s re-selected 0.5 is either confirmed by the joint search or superseded by it, with
   the difference stated. A finer grid may shift it; the coarse grid was deliberate.
4. `coldStartConsistencyVariance` is searched rather than inherited, and
   `SIGMA1_COLD_START_CONSISTENCY_VARIANCE`'s doc comment loses its "known-stale" paragraph
   (or gains a dated re-measurement in its place).
5. Holdout (2025/2026) Brier is reported against the current promoted set's holdout numbers,
   pass or fail. The 260901-is2 baseline to beat: holdout quals Brier 0.1551, holdout elims
   0.1580.
6. `SIGMA1_CODE_VERSION` bumps only if code changes; a params-only re-tune promotes a new
   `paramSetName` under the same code version, per D-13.
7. The synthetic-recovery test
   (`packages/core/algorithms/sigma1/innovationVariance.test.ts`) still recovers the known
   σ = 12 under the new parameters — a re-tune must not buy Brier by re-breaking the ±.
8. Downstream cascade filed as [[regenerate-published-artifacts-post-is2]] is re-triggered:
   new params change every published number.

## Related

- `.planning/quick/260901-is2-model-correctness-fixes-from-adversarial/CONTEXT.md` — D-Q2, the
  measurements and the `linkC` re-selection table
- `packages/core/algorithms/sigma1/params.ts` — `SIGMA1_CODE_VERSION` bump comment (2.1.0 → 3.0.0)
- `packages/core/algorithms/sigma1/consistency.ts` — the estimator's header block
- [[rolling-origin-hyperparameter-tuning]] — if that lands first, this re-tune should adopt
  its scheme rather than re-running the fixed tune/holdout split twice
