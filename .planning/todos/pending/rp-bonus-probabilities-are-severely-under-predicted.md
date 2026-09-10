---
id: rp-bonus-probabilities-are-severely-under-predicted
created: 2026-09-09
source: roadmap item 3's "measure the RP bias against real outcomes" — measured, and the result is much worse than the documented bias it set out to confirm
priority: high
---

# Published bonus-RP probabilities under-predict by ~2.75x, and three separate causes explain it

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

### 2. The even-split variance shrinkage — real, arithmetic, and fixable

A team's belief is folded from `allianceValue / rosterSize`, so its variance estimates
`Var(A)/9`, not its own contribution's variance. Summing three teams gives `Var(A)/3` where the
alliance variance should be `Var(A)` — **understated by exactly `rosterSize`**.

Tested by scaling the variance block by `roster.length` and re-measuring: Brier improved on 4 of
the 5 non-hardcoded bonuses in 2025/2026 (2026 `supercharged` 0.0720 -> 0.0637, 2025 `bargeBonus`
0.2742 -> 0.2382), and the model's implied joint moved 0.0151 -> 0.0303 against an observed
0.0886. **Real, and not sufficient on its own** — cause 1 dominates.

Note this is a genuine error rather than a documented simplification: the module's header
justifies the DIAGONAL block and the ZERO cross-covariance deliberately, but this shrinkage is
not mentioned anywhere and appears to be unintended.

### 3. Bonuses hardcoded to `false` because the threshold variables cannot express them

Two seasons predict a bonus as always-false, each honestly documented in place:

- **2025 `autoBonus`** (`2025.ts:206`) — gated on per-robot leave flags and `autoCoralCount`,
  which this season tracks no threshold variable for. It happens **65.94%** of the time. This
  single hardcoded `false` produces a Brier of 0.6594 over 25,978 observations.
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

1. **Fix cause 2** — it is arithmetic, roughly a one-line change, and measurably helps. Cheapest
   real improvement available.
2. **Fix cause 3 for 2025** — `autoBonus` needs `autoLineRobot1/2/3` and `autoCoralCount` carried
   as threshold variables. A 66%-base-rate bonus predicted as never happening is the single most
   visible wrongness on the list.
3. **Then cause 1**, which is the hard one and the only one that is a genuine modelling decision.
   Estimating a stable per-team cross-term needs more observations than a team plays in a season,
   which is why it was made diagonal in the first place. A cheaper route worth trying first: a
   single GLOBAL correlation applied to all threshold pairs, measured once per season across all
   teams, rather than a per-team block. That has the sample size the per-team version lacks.

Re-run `npx tsx scripts/measureRpCalibration.ts --seasons 2016-2020,2022-2026` after each and
compare against `reports/rp/calibration-bpr-all-seasons.txt`.
