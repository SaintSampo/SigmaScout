---
id: 2017-2019-deficit-diagnosis
created: 2026-09-08
source: diagnostic run off the 2016-2026 walk-forward replay (quick task 260907-203); handoff for whoever is working VPR
resolves_phase:
priority: medium
---

# 2017 and 2019 are VPR's two worst seasons — and they fail for OPPOSITE reasons

Measured 2026-09-08 against `reports/full-2016-2026/artifact.json`
(`vpr@10.0.0+rolling-2026-09e`, combined view, 10 seasons). This is diagnosis only — no model
change is proposed here, and nothing in it was implemented.

VPR's deficit to Statbotics, worst first: **2019 -4.61pp, 2017 -4.19pp**, then 2022 -3.17,
2020 -3.13, 2016 -2.96, 2024 -2.92, 2018 -2.59, 2023 -2.24, 2025 -1.77, 2026 -0.88.

## The lead that did NOT pan out, recorded so it is not re-chased

Tie rate correlates with the deficit at **corr = -0.81** across ten seasons — 2017 (1.699%) and
2019 (1.714%) have by far the highest tie rates, and 2018 (0.166%) and 2026 (0.245%) the lowest
and best deficits. The obvious hypothesis was a scoring-comparability artifact: that we penalise
ties and Statbotics does not.

**It is not that.** `packages/core/scoring/brier.ts` already EXCLUDES ties from winner accuracy
entirely (`accuracyCall` returns `null` for a tie; they leave the denominator). The tie rate is
a PROXY for match closeness, not a scoring bug — seasons with many exact ties have many
near-coin-flips.

## The actual diagnosis: two different failures

| season | mass in 0.4-0.6 | weighted calib. error | fitted temperature T | reading |
|---|---|---|---|---|
| 2018 | 21.4% | 0.0197 | 1.14 | fine |
| 2026 | 20.8% | 0.0346 | 0.80 | fine |
| **2017** | **27.0%** | **0.0752** | **1.805** | badly OVER-confident |
| **2019** | **34.5%** | **0.0258** | **0.925** | well calibrated, uninformative |

**2017 is a CALIBRATION failure.** Its curve is compressed toward 0.5 symmetrically at both
ends: at a predicted 93.6% the true rate is 82.6%; at a predicted 6.2% the true rate is 22.6%.
Fitting a single temperature drops weighted calibration MSE from **0.00742 to 0.00017 — 44x** —
at T = 1.805. That is the largest calibration defect in the corpus by a wide margin. The model
believes 2017 teams are far more separable than they are.

**2019 is a DISCRIMINATION failure.** Its calibration is already good (T = 0.925; fitting a
temperature barely helps, 0.00100 -> 0.00087). The problem is that **34.5% of all 2019 matches
land in the 0.4-0.6 coin-flip band** — by far the highest in the corpus, against ~21% in 2018
and 2026. The predictions are honest and uninformative. No recalibration can help; this needs
more signal.

## The load-bearing caveat before anyone acts

**Temperature scaling cannot improve winner accuracy — only Brier.** `sigmoid(logit(p)/T)` is
strictly monotonic and sign-preserving about 0.5, so it never changes which side is favoured.
Verified numerically: 4,995 (p, T) pairs across T in {0.5, 0.66, 1.14, 1.805, 3}, **zero winner-call
flips**. It also cannot move an exactly-0.5 no-call.

So recalibrating 2017 would fix its Brier (0.2296, the worst in the corpus) and leave its
-4.19pp accuracy deficit **completely untouched**. Both seasons' ACCURACY deficits are
discrimination problems. Do not let the 44x calibration win be mistaken for an accuracy fix.

Second caveat: those temperatures are fitted IN-SAMPLE on the same bins they are scored against.
A real fix must be selected walk-forward, never fitted on the season it scores.

## Why this is not simply "2017 and 2019 are hard years"

Statbotics scores 73.22 in 2019 — mid-pack for them (their range is 66.94 to 79.78). So 2019 is
not intrinsically unpredictable; a competitor extracts signal there that we do not. 2017 IS
intrinsically hard for everyone (Statbotics' own 66.94 is their worst season), but our -4.19pp
sits on top of that already-low base.

## Suggested order of attack

1. **Cheapest real win: the temperature is not stable across seasons at all** — fitted values
   range 0.50 (2022, strongly UNDER-confident) to 1.805 (2017, strongly over-confident), with
   2024/2025/2026 all in the 0.66-0.80 under-confident band. A single global link scale is
   demonstrably wrong, and the current per-season expanding-window SD is not capturing it. That
   is a Brier-only win, but it is a large one and it spans most of the corpus, not just 2017.
2. **2019 discrimination** is the bigger accuracy prize (-4.61pp) and the harder problem. Worth
   checking first whether 2019's component map is losing signal the game actually provides —
   `2019.ts`'s header is already known to claim a roll-up source gate in
   `reconciliation.test.ts` that does not exist (finding from quick task 260907-057, never
   fixed), so that file has had at least one documented inaccuracy.
3. Do NOT start with 2018. See `2018-anti-additivity-treatment` — despite being the only
   anti-additive season it has the 4th-SMALLEST deficit of ten.
