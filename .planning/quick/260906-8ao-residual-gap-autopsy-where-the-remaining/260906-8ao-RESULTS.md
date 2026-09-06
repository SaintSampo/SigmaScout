# Quick task 260906-8ao: Residual gap autopsy — RESULTS

Pure analysis of prediction streams already on disk. **No new replays, no model changes, nothing
patched.** Successor to `260906-7fj`, which closed 38% of VPR's deficit with a gain cap and left
the rest unexplained.

Series: `rpnoise-baseline-260905` (promoted vpr), `gaincap-g20-260906` (7fj's Rule-A-passing arm),
`autopsy-260905` (epa rows). n = 83,655 matches, ties excluded, intersection population.

## Finding 1 — the gain cap helped almost everywhere, and the remainder is concentrated

VPR's share of disagreements WON (>50% = VPR ahead):

| slice | n (g20) | baseline | g20 | change |
|---|---|---|---|---|
| ALL | 5071 | 48.4% | 48.9% | +0.5pt |
| **blowout >20** | 2541 | 45.0% | **45.7%** | +0.7pt |
| **phase: early** | 1884 | 45.6% | **46.5%** | +0.9pt |
| quals | 4072 | 47.2% | 47.7% | +0.5pt |
| mid margin 8-20 | 1576 | 51.5% | 52.2% | +0.7pt |
| close <8 | 954 | 52.3% | 52.3% | +0.0pt |
| elims | 999 | 53.5% | 54.0% | +0.4pt |
| phase: late | 1529 | 51.6% | 51.7% | +0.0pt |
| **vpr~coinflip, epa decisive** | 187 | 32.9% | **33.2%** | +0.3pt |
| epa~coinflip, vpr decisive | 771 | 55.0% | 55.6% | +0.6pt |

The residual deficit is **blowouts and the early season**. VPR already wins elims, close matches,
mid-margin matches and the late season.

The starkest cell is unchanged by the cap: when VPR sits near a coin flip and EPA commits, EPA is
right **two times in three**. The mirror case is nearly even. VPR is failing to commit where EPA
correctly does.

## Finding 2 — it is NOT saturation. Both models UNDER-predict, and identically

The plan's creative hypothesis was that FRC scoring is supply-limited (finitely many game
pieces), so a strictly linear per-team sum must OVER-predict elite alliances. **The data says the
opposite.** Mean actual minus mean predicted alliance total, by predicted-total bucket:

| predicted total | n | vpr bias | epa bias |
|---|---|---|---|
| <20 | 2594 | **+13.5** | **+16.8** |
| 20-40 | 18233 | +2.5 | +0.6 |
| 40-60 | 33366 | +2.3 | +1.0 |
| 60-80 | 32616 | +2.2 | +3.1 |
| 80-100 | 24552 | +3.2 | +4.4 |
| 100-120 | 16295 | +3.6 | +6.8 |
| 120-150 | 14734 | +5.4 | +9.1 |
| 150-200 | 11626 | +11.9 | +15.7 |
| 200+ | 13294 | +19.4 | +19.0 |

Both models under-predict at every level and the under-prediction GROWS with the total. This is
stronger than it appears: conditioning on a high predicted value should pull the conditional
actual DOWN via regression to the mean, and the bias overcomes that.

Two consequences:

- **Saturation is falsified as a mechanism.** No concave link is warranted; if anything the
  relationship is super-linear.
- **This cannot explain the accuracy gap anyway.** A bias that is monotone in predicted total
  preserves the ordering of two alliances, so correcting it cannot flip a winner call. It is a
  Brier/calibration issue, not an accuracy one. VPR is in fact BETTER calibrated than EPA above
  100 points (+3.6 vs +6.8, +5.4 vs +9.1, +11.9 vs +15.7).

## Finding 3 — VPR beats EPA where it is confident and loses where it is unsure

Both models' accuracy on the SAME matches, bucketed by **VPR's own published predictive
variance** (a quantity EPA does not produce at all):

| VPR variance quintile | n | mean sd (pts) | g20 acc | epa acc | epa − g20 |
|---|---|---|---|---|---|
| Q1 (most certain) | 16731 | 19.4 | 75.80% | 75.60% | **−0.20pt (VPR wins)** |
| Q2 | 16731 | 24.0 | 76.36% | 76.22% | **−0.14pt (VPR wins)** |
| Q3 | 16731 | 28.6 | 74.87% | 75.13% | +0.26pt |
| Q4 | 16731 | 38.2 | 76.04% | 76.61% | **+0.57pt** |
| Q5 (most uncertain) | 16731 | 92.6 | 79.72% | 79.87% | +0.15pt |

**VPR wins its two most-confident quintiles outright and loses essentially the whole deficit in
Q3-Q4.** The weakness is self-identifiable at prediction time from a number VPR already computes.
That is an asymmetry EPA structurally cannot match, and it is the most exploitable fact in this
document.

## Finding 4 — the deficit is VARIANCE, not bias. Decisively.

Margin error (`actual − predicted`) by the same quintiles:

| quintile | g20 bias | epa bias | g20 RMSE | epa RMSE | EPA edge |
|---|---|---|---|---|---|
| Q1 | +0.21 | +0.25 | 22.20 | 22.31 | **VPR +0.11** |
| Q2 | +0.50 | +0.53 | 25.59 | 25.63 | **VPR +0.04** |
| Q3 | +0.01 | +0.04 | 28.81 | 28.71 | −0.10 |
| Q4 | +0.37 | +0.38 | 36.67 | 36.24 | **−0.43** |
| Q5 | +2.77 | +2.23 | 98.93 | 98.23 | −0.70 |

The biases are statistically indistinguishable in every quintile. The RMSEs are not, and they
cross exactly where the accuracy crosses. **VPR's margin estimator is higher-variance than EPA's
in thin-information matches and lower-variance in rich-information ones.**

This rules out an entire class of fix: any bias correction, any recentring, any intercept term.
The remaining gap is a variance-reduction problem.

## Finding 5 — the excess variance does NOT come from per-component compounding

Hypothesis tested and REJECTED: VPR sums ~6-13 independently-filtered components, each updated
from a noisy three-way alliance split, so ~N quasi-independent errors compound in the total —
whereas EPA's `percent_func` applies ONE shared per-team rate across all components, coupling its
errors. If true, VPR's disadvantage should scale with the season's component count.

| season | components | g20 RMSE | epa RMSE | EPA edge |
|---|---|---|---|---|
| 2022 | 6 | 22.45 | 22.60 | −0.15 (VPR better) |
| 2023 | 9 | 28.92 | 28.58 | +0.34 |
| 2024 | 13 | 23.27 | 23.41 | −0.15 (VPR better) |
| 2025 | 7 | 32.89 | 32.32 | +0.57 |
| 2026 | 11 | 96.28 | 95.69 | +0.59 |

`corr(component count, EPA RMSE edge) = -0.082` — essentially zero, and the two seasons where VPR
is BETTER have the fewest (6) and the most (13) components. n=5 is weak evidence in general, but
this is a null so flat that the compounding story earns no further work.

## Where this leaves the search

Established: the residual deficit is **excess variance in VPR's per-team estimate, confined to
thin-information matches, not attributable to bias, not to saturation, and not to the number of
components.**

The surviving candidate is the one thing 7fj's gain cap already showed responds: **how the
alliance-sum innovation is ATTRIBUTED across teammates.** `updateAllianceSum` splits it strictly
by variance share, `K_j = P_j / (Sum P_i + R)`, so a green team among two veterans absorbs roughly
half of a shared observation on the strength of an assumption about who was responsible — an
assumption `covariance.ts`'s own header already flags as unrecoverable from a summed observation.
That is precisely a variance-injection mechanism, it is confined to thin-information matches, and
capping it crudely was worth +0.08pt.

The principled successor to a cap is **shrinking the attribution vector toward uniform**:

```
K_j = (1 - lambda) * (P_j / (Sum P_i + R))  +  lambda * (Sum P_i / (Sum P_i + R)) / n
```

`Sum_j K_j` is IDENTICAL under both terms, so the alliance's TOTAL learning per observation is
unchanged — this is not a slower filter. It only redistributes that learning toward an equal
split, trading a little attribution bias for a variance reduction in exactly the regime Finding 4
isolates. Inert at `lambda = 0` by construction, and it composes with (rather than replaces) the
gain cap.

Recorded as the next experiment, not run here.

## Provenance

- Instruments: `residual-autopsy.cjs`, `discrimination.cjs` (committed in this task directory).
- Inputs: `reports/rpnoise-baseline-260905/`, `reports/gaincap-g20-260906/`,
  `reports/autopsy-260905/` — all pre-existing, none regenerated.
- Nothing patched, nothing replayed, no model code touched by this task.
