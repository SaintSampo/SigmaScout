# Context — non-negative least squares in the variance solve

## The live defect

Measured against the published artifact
`https://data.sigmascout.org/v1/teams/2026/vpr@5.0.0+tuned-2026-08.json`, fetched
2026-09-03:

- **34.9%** of metric cells (19,436 of 55,770) carry **no `±` at all**
- **97.7%** of teams (3,632 of 3,718) are missing at least one
- **zero** of those teams have zero matches — this is not thin history

Cause: `solveEventVariance` (`packages/core/algorithms/sigma1/varianceOpr.ts:442`)
solves the ridge-regularised normal equations with Cholesky and then applies
`Math.max(0, x)` per entry. `teamMetrics`'s `spreadOf` omits the spread when the
variance is `<= 0`. So a team whose least-squares estimate lands slightly negative —
which is what NOISE around a genuinely SMALL variance looks like — publishes nothing.

The inversion is the point: a robot that is *unusually consistent* is the one most
likely to solve negative, so the site currently hides the interval for exactly the
teams whose consistency is most worth showing.

## D-N1 — replace the post-hoc clamp with a constrained solve (LOCKED)

Variances are non-negative **by definition**, so constraining `beta >= 0` DURING the
solve is the more correct estimator, not a workaround. Clamping afterward solves the
wrong problem and then edits the answer.

Use **Lawson-Hanson active-set NNLS**. It terminates finitely and, with a fixed pivot
rule, is deterministic — which is mandatory here (see D-N3).

**Do not** use projected gradient, coordinate descent, or any tolerance-terminated
iterative method. This repo pins prediction-stream digests bitwise; a solver whose
answer depends on an iteration count or a convergence epsilon is not acceptable.

Implementation notes:
- The current Cholesky solves ALL metric-key columns in one call (`b` is `n x keys`).
  NNLS is per-right-hand-side: loop the columns, solve each independently.
- The ridge stays exactly as it is: `A = gram + lambda*I`, `b = target + lambda*vBar`
  per column. NNLS is applied to that already-regularised system.
- `n` is teams-at-one-event (~40-60) and results are memoized per accumulator, so the
  extra cost is acceptable. Measure it anyway and record the number.
- Keep `VarianceSolveNotPositiveDefiniteError` behaviour for a genuinely degenerate
  system; NNLS should not mask a broken Gram matrix.

## D-N2 — MEASURE the blank rate, do not assume it (LOCKED)

**NNLS does not automatically clear the blanks, and the plan must not claim it does.**
NNLS still returns exactly `0` for a team the data cannot support. What changes is
WHICH teams land there: pinning one team at zero frees residual budget that can push a
co-appearing teammate positive, so the zero set is generally smaller than the naive
clamp's negative set — but the size of that reduction is an empirical question.

Required deliverable: the blank rate **before and after**, measured the same way on the
same real data, reported as a number. If NNLS leaves a materially large blank rate, say
so plainly. **Do not** invent a display rule to hide a residual — the choice between
publishing `0 ±` (a false claim of perfect consistency), falling back to `vBar` (the
rule zero-row teams already get), and leaving the cell blank is a product decision that
goes back to the user WITH the measured number attached.

## D-N3 — display-only; predict() must be bitwise unchanged (LOCKED)

`predict()`/`update()` do not read the decomposition. The gate is that both re-promoted
version files' `predictionStreamSha256` are **character-identical** to their current
5.0.0 values. A moved digest is stop-and-report, not a tolerance to widen.

`SIGMA1_CODE_VERSION` bumps `5.0.0 -> 6.0.0`: the parameter SHAPE is unchanged (no new
field), but observable output changes, and D-13 forbids one version string standing for
two computations. Both `data/algorithm-versions/vpr@5.0.0+*.json` files are retired and
re-promoted as `6.0.0` in the same commit via `promote.ts --from-version`. No shape
migration is needed — this is not a `4->5`-style change.

## D-N4 — lambda is NOT re-picked here (LOCKED)

`varianceOprRidge = 2` was selected against synthetic data with a true-sigma
distribution that was invented rather than measured, and is known to be the weakest
link in this chain. Re-picking it on real data (held-out residual prediction) is a
SEPARATE task that must run AFTER this one, because NNLS changes the blank rate that
lambda is partly chosen on. Do not touch the value here.

## Verification bar

- A unit test proving the NNLS result is **exactly** the Cholesky result whenever the
  unconstrained solution is already non-negative (the constraint is inactive) — this is
  what shows the change is surgical.
- A unit test on a hand-built system whose unconstrained solve has a negative component,
  asserting NNLS re-optimises the remaining components rather than merely zeroing one
  (i.e. the result differs from `max(0, cholesky)`), with the expected values worked out
  in the test's own comment.
- Determinism: the same accumulator solved twice returns bitwise-identical numbers.
- Both digests character-identical (D-N3).
- The before/after blank rate on real data (D-N2).
- Full suite green apart from anything already failing on `main` before this task.

## Scope

**In:** `packages/core/algorithms/sigma1/varianceOpr.ts` and its tests, the
`SIGMA1_CODE_VERSION` bump, both re-promotions, and any doc comment that describes the
retired clamp (`varianceOpr.ts`'s own header, `teamMetrics`'s `spreadOf` comment, and
the ridge constant's block, which currently names the clamp as the terminal behaviour).

**Out:** `apps/web`, `apps/worker`, EPA, OPR, lambda's value, and republishing — the
republish is a separate step once the residual blank-rate decision is made.
