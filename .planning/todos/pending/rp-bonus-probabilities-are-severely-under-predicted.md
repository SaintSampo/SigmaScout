---
id: rp-bonus-probabilities-are-severely-under-predicted
created: 2026-09-09
source: roadmap item 3's "measure the RP bias against real outcomes" — measured, and the result is much worse than the documented bias it set out to confirm
priority: high
---

# Published bonus-RP probabilities under-predict, and three separate causes explain it

> **TWO OF THREE FIXED — 2026-09-09 (`72566078`).** Causes 2 and 3 are done. Re-measured over the
> same 488,026 observations: **Brier 0.2164 -> 0.1860**, mean predicted 0.1131 -> 0.1507 against an
> observed 0.3109, extreme predictions 70.5% -> 52.2%, and the sub-0.05 bucket now happens 11.26%
> of the time instead of 18.41%. 18 of 21 season-bonuses improved; 2 unchanged (still hardcoded
> false); one moved -0.0002, which is noise.
>
> **Cause 1 — the diagonal covariance block — is untouched and is now the dominant remaining term.**
> The discarded dependence is unchanged at +0.0391 and the model's implied joint is 0.0222 against
> an observed 0.1179. That one is a genuine modelling decision, not a bug, and the global
> per-season correlation sketched at the bottom of this file is the next thing to try.
>
> Before/after outputs: `reports/rp/calibration-bpr-all-seasons.txt` and
> `reports/rp/calibration-bpr-after-fixes.txt` (both gitignored).

Measured walk-forward over **488,026 (alliance, bonus) observations across all ten seasons**,
driven through the same `SigmaScoutLayer` the publisher runs, so these ARE the published numbers.
Script: `scripts/measureRpCalibration.ts`. Full output: `reports/rp/calibration-bpr-all-seasons.txt`.

| | |
|---|---|
| mean predicted probability | **0.1131** |
| observed frequency | **0.3109** |
| Brier | 0.2164 |
| predictions below 0.05 | **70.5% of all**, and they happen **18.41%** of the time |
| predictions above 0.95 | 0.7% of all, and they happen 95.81% of the time |

**Every bonus in every season under-predicts. Not one over-predicts.** The worst cases are not
subtle:

| season | bonus | predicted | observed | Brier |
|---|---|---|---|---|
| 2016 | `breach` | 0.0044 | **0.7337** | 0.7260 |
| 2025 | `autoBonus` | 0.0000 | **0.6594** | 0.6594 |
| 2018 | `autoQuest` | 0.1261 | 0.5248 | 0.3775 |
| 2023 | `sustainabilityBonus` | 0.0205 | 0.2643 | 0.2341 |
| 2025 | `coralBonus` | 0.0031 | 0.1910 | 0.1869 |

A Brier of 0.7260 is worse than predicting 0.5 for everything (0.25), and far worse than
predicting the base rate. These are not calibration wobbles; they are predictions pointing the
wrong way.

## Three distinct causes, separated by measurement

### 1. Conjunctions across independently-drawn thresholds — the diagonal block, and the big one

`empiricalMoments.ts` emits a DIAGONAL covariance block, so a bonus gated on several thresholds
at once has its probability computed as a product of independent draws. Where the real thresholds
are highly correlated — an alliance good at one reef level is good at all of them — independence
makes the conjunction dramatically too unlikely.

2025's `coralBonus` is the clean demonstration: it requires **all four** reef levels (`trough`,
`botRow`, `midRow`, `topRow`) to clear 5 independently. Predicted 0.0031 against an observed
0.1910 — **62x under**. Single-threshold bonuses in the same season are far less wrong.

The correlation the block discards is measured directly and positive in every season:
observed `P(both) = 0.1179` against `P(A)*P(B) = 0.0787`. The header predicted this sign; it is
confirmed, with a magnitude.

### 2. ~~The even-split variance shrinkage~~ — FIXED (`72566078`)

A team's belief is folded from `allianceValue / rosterSize`, so its variance estimates
`Var(A)/9`, not its own contribution's variance. Summing three teams gives `Var(A)/3` where the
alliance variance should be `Var(A)` — **understated by exactly `rosterSize`**.

Shipped as the average of each contributing team's implied alliance variance
(`rosterSize^2 * Var(belief)`), which reduces to `rosterSize * sum` on a full roster and degrades
correctly on a partial one rather than shrinking twice. **Real, and not sufficient on its own** —
cause 1 dominates.

Three tests now pin the variance MAGNITUDE. Every test that existed pinned only its shape — zero
at one observation, positive once observations differ, diagonal — which is exactly how a
factor-of-3 error survived all of them.

Note this is a genuine error rather than a documented simplification: the module's header
justifies the DIAGONAL block and the ZERO cross-covariance deliberately, but this shrinkage is
not mentioned anywhere and appears to be unintended.

### 3. Bonuses hardcoded to `false` — 2025 FIXED (`72566078`), 2019 left alone

Two seasons predict a bonus as always-false, each honestly documented in place:

- **2025 `autoBonus`** — FIXED. It happens **65.94%** of the time and the hardcoded `false` scored
  a Brier of 0.6594 over 25,978 observations. It was a missing INPUT, not a modelling
  approximation: "all three recorded robots left" IS a count reaching 3. Tracking `autoLineCount`
  and `autoCoralCount` as threshold variables takes it to **0.4045**. Parse and predict now read
  the same two counts so their definitions cannot drift. It still understates, for a stated
  reason: a count drawn continuously and cut at its own ceiling understates a discrete "3 of 3".
- **2019 `completeRocket`** (`2019.ts:162`) — happens 5.15% of the time, so the cost is small.

The 2025 case is the second-worst number in the whole measurement and is not a modelling
approximation at all — it is a missing input.

## What this means for what is shipped

The rank simulation and the bonus-RP dots consume these probabilities. They are live now, at
generation `511137fd`. A pmf built from marginals that are 2.75x low is not a usable probability
even though it renders fine, and the Simulation tab's rank bands inherit it.

**This does not affect winner prediction or Brier score for match outcomes** — those come from the
algorithm (level 1), not from this layer. The scope is bonus RP and anything derived from it.

## Suggested order

1. ~~Fix cause 2~~ — done.
2. ~~Fix cause 3 for 2025~~ — done.
3. **Cause 1**, all that is left, and the hard one and the only one that is a genuine modelling decision.
   Estimating a stable per-team cross-term needs more observations than a team plays in a season,
   which is why it was made diagonal in the first place. A cheaper route worth trying first: a
   single GLOBAL correlation applied to all threshold pairs, measured once per season across all
   teams, rather than a per-team block. That has the sample size the per-team version lacks.

Re-run `npx tsx scripts/measureRpCalibration.ts --seasons 2016-2020,2022-2026` after each and
compare against `reports/rp/calibration-bpr-all-seasons.txt`.

---

## STATUS 2026-09-12 — measured in Phase 9, all three fixes REVERTED, and the verdict is now in doubt

Phase 9 built and measured all three candidate fixes as independently selectable config branches
(plan 09-05), then scored them through the one published scorer against a pre-committed per-bonus
Brier bar (plan 09-06). **All three reverted:** win source 0 improved / 0 regressed / 30 tied, tie
model 0/0/30, marginal family 3/3/24. The toggles were collapsed and the losing branches deleted.

**Two findings that change how this todo should be read:**

1. **Win source and tie model are structurally invisible to a per-bonus Brier.** They move only the
   outcome half. They were refused for moving nothing the bar reads, **not** for causing harm. Their
   real effects are real and measured: the win source drives the pmf-vs-published win-probability
   gap to exactly 0 (from 0.036968), and the tie model replaces an identically-zero tie probability
   with 0.008239 against an observed 0.010928.

2. **The marginal arm's 24 ties are a bug, not a result.** `clauseProbability` refit combined
   moments as a hardcoded Gaussian and discarded the declared family, so 24 of 30 cells were
   structurally incapable of responding. Fixed by quick task 260911-w7k — but the family itself was
   already deleted, so re-testing needs
   `restore-negative-binomial-to-retest-it`. **The verdict "negative-binomial does not help" is
   unsupported, not disproven.**

Also note the headline multiplier in this todo predates plan 09-01's same-scorer fix:
`measureRpCalibration.ts` was constructing `SigmaScoutLayer` with one argument while the publisher
used two, so every bpr bonus probability it reported came from a band the publisher does not use.
The frozen post-fix baseline is `data/baselines/rp-calibration-2026-09.json`.
