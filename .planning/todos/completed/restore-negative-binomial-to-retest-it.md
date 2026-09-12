---
id: restore-negative-binomial-to-retest-it
created: 2026-09-12
source: quick task 260911-w7k fixed clauseProbability's Gaussian hardcode, but the family it would honour was already deleted
resolves_phase: 9
priority: medium
completed: 2026-09-12
outcome: not pursued — the family DOES help, measurably; Jacob declined the cost, not the result
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

## STATUS 2026-09-12 — MEASURED. STAYS PENDING: this is the "real gain, stop and come back" case.

Quick task `260912-2uz` restored the family, built the measurement seam, and ran the comparison on
the selection slice. **The result is a real gain, so by the decision above this todo does NOT
close** — it is Jacob's to decide what happens next, with the magnitude now in hand.

**What ran.** 2016-2020 plus 2022, across all three published algorithms (opr, epa, bpr). One
`WalkForwardSimulator` replay per season folded through a control layer and a negative-binomial
layer, both constructed with two arguments, both scored by the one set of `brier`/`rate`/
`meanPredicted` helpers. Per-bonus observation counts asserted equal across arms in flight. **No
2023-2026 figure was produced**, and the guard that makes it impossible is in the script:
`assertMarginalArmSliceAllowed` throws on any parsed season at or above 2023, before the corpus is
opened, with no override flag.

**Reach: 24 of 33 cells, against the 09-06 run's 0.** That is the headline structural change and the
whole reason this re-test was worth running.

| Category | Cells | Result |
|---|---|---|
| REACHABLE | 24 | 21 improved / 3 regressed / 0 tied |
| STRUCTURALLY UNREACHABLE | 9 | all exactly identical to control, as predicted |
| FALLBACK TIES | 0 | every reachable cell moved |

**Magnitude, observation-weighted over reachable cells only:**

| Algorithm | n | control Brier | NB Brier | delta |
|---|---|---|---|---|
| opr | 162,072 | 0.245071 | 0.242080 | **-0.002991** |
| epa | 162,072 | 0.245071 | 0.242080 | **-0.002991** |
| bpr | 186,694 | 0.236809 | 0.234074 | **-0.002735** |
| all three | 510,838 | 0.242052 | 0.239154 | **-0.002898** (-1.20% relative) |

Per-bonus (bpr): 2018 `autoQuest` -0.009615, 2016 `capture` -0.006863, 2019 `habDocking` -0.002489,
2020 `shieldOperational` -0.001945, 2018 `faceTheBoss` -0.001372, 2016 `breach` -0.000898,
2022 `cargoBonus` -0.000312, and **2022 `hangarBonus` +0.002864 — the one regression, and it
regresses consistently on all three algorithms.**

**35.78%** of the NB arm's 1,295,666 fits genuinely resolved to negative binomial; the rest fell
back to Gaussian on non-positive mean or under-dispersion. So this gain is produced by roughly a
third of the fits, which is a fact about the fit's applicability that belongs beside the Brier
numbers, not behind them.

**Nothing was promoted.** All 34 season-module declarations still say `"gaussian"`, both goldens are
green with zero edits, `data/baselines/rp-attribution-2026-09.json` is untouched, and
`docs/models/rp-attribution.md` still carries its 09-06 verdict unedited. The restored family and
the `--marginal-arm` seam are both in the tree, so this is re-runnable as-is:

```
npx tsx scripts/measureRpCalibration.ts --marginal-arm --seasons 2016,2017,2018,2019,2020,2022
```

**The open decision for Jacob.** A selection-slice result cannot promote anything on its own. The
09-06 bar admitted no regression at any magnitude, and `hangarBonus` regresses — so this would still
fail that bar as written. The live questions are whether the bar should be reconsidered given the
reach was never what it claimed to be, and whether the 2023-2026 reporting slice is worth
re-spending to confirm a -0.0029 pooled gain. **Neither is an agent's call.**

---

## CLOSED 2026-09-12 by Jacob — NOT PURSUED. Read the next paragraph before citing this.

**Do not record this as "negative binomial does not help." It does help.** That was the false
conclusion this whole todo existed to correct, and closing the question is not the same as
reaching that conclusion a second time.

The measured result stands: on the selection slice, across 24 reachable cells, negative binomial
improved pooled bonus-RP Brier by **-0.002898 over 510,838 observations (-1.20% relative)** — 21
cells improved, 3 regressed, none tied. Full figures in the STATUS section above.

**What Jacob declined was the cost, not the result:**

- The gain is ~1.2% on **bonus-RP probabilities only**. It does not touch winner prediction or
  match Brier at all.
- Only **35.78%** of the NB arm's fits genuinely resolved to negative binomial; the rest fell back
  to Gaussian. The gain rides on about a third of the fits.
- Confirming it would mean spending the 2023-2026 reporting slice — already spent once on this
  question — and promoting it would then mean flipping declarations and a full republish.
- The dominant error in this same area is still open and worth far more: the diagonal covariance
  block (cause 1 of `rp-bonus-probabilities-are-severely-under-predicted`), where the model implies
  a joint of 0.0222 against an observed 0.1179. That is where the effort belongs.

**The 2023-2026 reporting slice was NOT spent.** It remains at one prior use, and
`assertMarginalArmSliceAllowed` in `scripts/measureRpCalibration.ts` now refuses any season >= 2023
before the corpus opens, with no override flag.

**Nothing was promoted and nothing shipped.** All 34 season-module declarations still say
`"gaussian"`; both goldens are green with zero edits; `docs/models/rp-attribution.md` and
`data/baselines/rp-attribution-2026-09.json` are untouched. Production behaviour is identical
before and after.

**What stays in the tree, and why.** The restored family, its tests, and the `--marginal-arm` seam
are all committed and inert. Reopening this costs one command, not a re-restore:

```
npx tsx scripts/measureRpCalibration.ts --marginal-arm --seasons 2016,2017,2018,2019,2020,2022
```

**If you reopen it, the two live questions are unchanged:** whether 09-06's
no-regression-at-any-magnitude bar should stand given its reach on this slice was 0, and whether
2023-2026 is worth re-spending. 2022 `hangarBonus` regresses +0.002864 consistently on all three
algorithms — a real property of that variable, not noise — so the result fails that bar as written.

Closed by quick task `260912-2uz`. See its SUMMARY for the per-cell tables and the verification.
