---
quick_id: 260903-5dp
slug: non-negative-least-squares-in-the-varian
date: 2026-09-03
status: complete
tasks_completed: 1
commit: 9b0ebb08
---

# Summary — non-negative least squares in the variance solve

Replaced the post-hoc `Math.max(0, x)` clamp in `solveEventVariance` with a
Lawson-Hanson active-set NNLS solve. `SIGMA1_CODE_VERSION` 5.0.0 -> 6.0.0; both
version files retired and re-promoted via `promote.ts --from-version`.

## The headline: coverage got WORSE, and that is the real finding

The task was written expecting NNLS to reduce the blank-`±` rate. It did the
opposite, and that is recorded rather than smoothed:

| terminal behaviour | cells with no `±` | teams missing >=1 |
|---|---|---|
| `Math.max(0, cholesky)` (5.0.0) | **34.9%** (19,436 / 55,770) | **97.7%** (3,632 / 3,718) |
| Lawson-Hanson NNLS (6.0.0) | **40.2%** (22,412 / 55,770) | **98.8%** (3,675 / 3,718) |

214 cells gained a `±`; 3,190 lost one. Teams with every cell blank: 2 -> 4.

Measured identically on both sides — one 2022-2026 replay with season carry,
promoted `tuned-2026-08` params, counting published cells for every 2026 team
against its own last event, SAME accumulators, only the terminal behaviour
differing. The BEFORE row reproduces the live artifact exactly (19,436 / 34.9% /
3,632 / 97.7%), which is what makes AFTER comparable rather than merely adjacent.

**It is not a bug.** On the same systems: the constrained objective is strictly
lower than the clamp's in 3,715 of 3,795 and higher in ZERO (both vectors are
feasible, so it is like-for-like); zero negative components; KKT residual 1.0e-15
on the passive set and exactly 0 on the active set.

**Mechanism.** The constraint propagates zeros outward. A negative `beta` is slack
that lets a teammate carry a larger positive and still sum to `e^2`. The clamp
discarded the negative and KEPT the inflated positive it was propping up. Forbid
the negative and the teammate shrinks — often to the boundary. Fewer intervals
survive, and the survivors are no longer partly an artifact of a neighbour's
impossible variance.

## What this means for the original diagnosis

The blank-cell problem was mis-attributed. It is not caused by the clamp and is
not fixed by constraining the solve. It is the DISPLAY RULE for a team whose data
supports no positive estimate — and that rule, plus `varianceOprRidge`, is what
governs coverage. NNLS made the numbers more correct; it was never the lever on
how many of them get published.

## Gates

| gate | result |
|---|---|
| `tuned-2026-08` digest `380c5980...` | IDENTICAL |
| `tracer-check` digest `38d091e0...` | IDENTICAL |
| headline Brier / accuracy / `params` | identical, byte-identical, both files |
| full suite | 168 files, 2,949 passed, 1 skipped |
| `tsc --noEmit` | clean |

Both digests produced by `promote --from-version` running the new code against a
real corpus replay; neither hand-edited. Digest invariance is the proof this is
display-only — `predict()`/`update()` never read the decomposition.

## Tests

1. **Surgical** — a system whose unconstrained solve is already non-negative
   returns bitwise-identical numbers to a Cholesky solve of the same ridged
   system (`toBe`, not `toBeCloseTo`; a tolerance would pass an implementation
   that shifts the `±` by a few ULPs for the ~65% of cells never clamped).
2. **Real difference** — `A+B=10, B+C=200, A+C=0`, unconstrained `A=-95`. The
   clamp gives `(0,105,95)`; NNLS re-solves with A pinned and gives
   `(0, 220/3, 190/3)`. Asserts the expected values AND separately that the
   result is not `105`/`95`, so a revert to the clamp cannot pass by loosening a
   tolerance.
3. **Determinism** — two structurally identical but distinct accumulators
   (distinct WeakMap keys, so both genuinely run the active-set loop) return
   bitwise-identical results, with a non-vacuity check that the constraint binds.

Lawson-Hanson was chosen for determinism, not speed: finite termination on a
fixed pivot rule, no convergence epsilon anywhere, which is what this repo's
bitwise-pinned digests require.

## Cost — worth knowing before the next publish

Widest real event (`2026arc`, 75 teams x 15 keys), cold: **0.44 ms -> 26.85 ms**
(61x). All 253 of 2026's accumulators: **34.9 ms -> ~1,068 ms** (31x). The memo is
unchanged, so the cost is one solve per FOLD, and `publish.ts` calls `teamMetrics`
per match — this lands on the per-match hook. Not optimised; any optimisation
needs its own bitwise-equivalence proof.

## Deviations

1. **`promote.ts` gained a `5.` branch** — required, not optional: `loadFromVersionFile`
   had only `4.`/`3.` branches and would have refused a 5.0.0 source, making the
   re-promotion impossible. Parses with the CURRENT schema (shape genuinely
   unchanged) and deliberately records NO `paramShapeMigration`, since a tag
   naming a no-op map would be false provenance.
2. **`promotedOverrides.test.ts` version literals derived** from
   `SIGMA1_CODE_VERSION` — they were hardcoded and the bump broke all three, the
   same rot `cli.ts` already retired. The `+{paramSetName}` half and the
   distinctness assertions stay literal.
3. **A `promote` log line made conditional** — it unconditionally claimed
   "DIFFERENTLY-SHAPED parameter set", false for a same-shape promotion.
4. **Doc comments corrected mid-task** — first drafted assuming NNLS would reduce
   blanks, rewritten when the measurement said otherwise.
5. **Removed a stale reference** to `scripts/measureVarianceOpr.ts`, which does not
   exist.

## Open, and blocking the republish

- **The display rule for a zero.** `0 ±` (a false claim of perfect consistency) vs
  fall back to `vBar` (the rule zero-row teams already get) vs keep omitting.
  Deliberately NOT decided here — D-N2 required the number be attached first, and
  it now is.
- **`varianceOprRidge` re-pick on real data** is now MORE consequential, since
  blanks still fall as lambda rises, and its current value was selected against an
  invented synthetic sigma distribution.
- Live artifacts still carry 5.0.0 numbers. Nothing was republished.

Pre-existing, left as found: `docs/models/sigma1-variance-decomposition.md` is
cited by `varianceOpr.ts`'s header but does not exist.
