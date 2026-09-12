---
id: restore-negative-binomial-to-retest-it
created: 2026-09-12
source: quick task 260911-w7k fixed clauseProbability's Gaussian hardcode, but the family it would honour was already deleted
resolves_phase: 9
priority: medium
---

# The marginal-family refit bug is fixed, but `MarginalFamily` is a one-member union — nothing can exercise it

`clauseProbability` (`packages/core/rankingPoints/analyticPmf.ts`) used to refit combined moments as
a hardcoded Gaussian, discarding the declared family. Quick task 260911-w7k fixed it: a
single-term / divisor-1 clause now reuses the variable's own `FittedMarginal` verbatim, and every
other clause derives its family from the contributing terms via `familyForClauseSum`, throwing on
mixed or non-closed declarations.

**But `MarginalFamily` is now `"gaussian"` alone** (`constants.ts:84`). `"negative-binomial"` was
deleted in `2731bfab` by plan 09-06's D-06 collapse. So the fix restores **reach** and cannot move
any number — which was proven rather than asserted: a 240-row golden (10 seasons x 3 tiers x 8
moment patterns, exact equality, no tolerance) landed in its own prior commit and was green
afterward with zero edits.

## Why this matters

Plan 09-06 measured negative-binomial marginals against a per-bonus Brier bar, got **3 improved /
3 regressed / 24 tied**, and reverted on that evidence. **The 24 ties are explained by the refit
bug** — those cells were structurally incapable of responding to a family change, because only
`nestedSameVariable` bonuses honoured the declaration and only 2026 has any.

The recorded verdict "negative-binomial does not help" therefore rests on a measurement in which
**80% of cells could not have moved.** It is unsupported, not disproven.

## The work

Restore `"negative-binomial"` to the `MarginalFamily` union and to `marginals.ts`'s fit path (both
were deleted, not merely disabled), then re-run 09-06's attribution through the one published
scorer.

**Constraints that still bind:** D-11's same-scorer rule; D-04's slice split (family chosen on
2016-2020 + 2022, bar evaluated on 2023-2026); and **D-04 is one-way — the 2023-2026 reporting slice
was already spent once on 2026-09-11.** Re-spending it is the developer's decision, not an agent's.
Consider whether the choice can be made on the selection slice alone this time.

Both guards the fix added are unreachable from real data under a one-member union, and are currently
reached in test only through an explicit cast carrying a comment saying so. Restoring the family
makes them live.

## DECIDED 2026-09-12 by Jacob — selection slice only, do NOT spend the reporting slice

**Run the comparison on the selection slice (2016-2020 + 2022) alone.** The 2023-2026 reporting
slice stays unspent; it was already used once for this question on 2026-09-11 and a second use
would further weaken it as an honest check on anything later.

**How to read the result under that constraint.** A selection-slice result cannot promote anything
on its own — that is what the slice split is for. It can do two things, and only these:

- **If the alternative shows no real gain there, drop the question.** That is a legitimate close: a
  family that cannot beat the incumbent on the data it was chosen against is not going to be
  rescued by the reporting slice.
- **If it does show a real gain, stop and come back.** Do not reach for 2023-2026 to confirm it.
  Re-spending the reporting slice becomes a fresh decision for Jacob, made with the selection-slice
  magnitude in hand rather than in the abstract.

An agent may not spend the reporting slice under this decision for any reason, including a
promising selection-slice result. That is the whole point of recording it here.

Everything else above still binds — D-11's same-scorer rule especially, since the last time this
question was touched a scorer mismatch manufactured a phantom ~0.003 regression.
