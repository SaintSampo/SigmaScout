---
id: 260910-u7g
slug: build-sigma-score-a-bayesian-talent-info
description: "Build Sigma Score (Bayesian, talent-informed robot consistency) and run it head-to-head against the shipped Swing Score"
created: 2026-09-10
completed: 2026-09-10
status: complete
---

# Quick task 260910-u7g — Sigma Score vs Swing Score

Experiment. **Nothing wired into publish** — `grep` for `sigmaScore` outside the module, its test and
the comparison script returns nothing, and that is checked in Verification below.

## What shipped

| File | Change |
|---|---|
| `packages/harness/sigmaScore.ts` | new — the estimator |
| `packages/harness/sigmaScore.test.ts` | new — 25 tests, five of which encode the developer's requirements as assertions |
| `scripts/compareSigmaScore.ts` | new — the head-to-head harness, 10 candidates |
| `package.json` | `"compare:sigma-score"` |

## The estimator

Conjugate inverse-gamma prior on each team's per-match variance, updated by that team's own
recency-weighted squared residuals, reported as the **posterior predictive** spread:

```
prior      sigma^2 ~ InvGamma(a0, b0),  a0 = priorObs/2,  b0 = (a0 - 1) * priorSigma^2
posterior  a = a0 + W/2,   b = b0 + S/2
report     SIGMA = scale * sqrt( b / (a - 1) )
```

`priorSigma` scales with the team's **talent** (its rating as of before the match), because swing is
measured in points and a robot that scores more has more points to swing by.

**Two independent half-lives**, which is the design's core idea: `meanHalfLife` (how fast the bias
term chases a team's level) separate from `varHalfLife` (how fast volatility evidence decays). Swing
Factor is the special case where both are 6.

## Results

Tuned on 2024–2025 (BPR, 209,349 rows), confirmed on 2026 (all three algorithms, 110,232 rows each).
Best candidate: **`sigma-weak-var2`** — meanHalfLife 18, varHalfLife 2, priorObs 2.5, talent prior,
scale 1.0.

### 2026 confirmation, `sigma-weak-var2` vs `swing`

| measure | opr | epa | bpr | verdict |
|---|---|---|---|---|
| mean NLL (proper rule) | **7.30** vs 200.81 | **5.47** vs 51,860 | **5.05** vs 33.24 | Sigma wins everywhere, hugely |
| trim99 NLL (robust) | **5.119** vs 5.185 | 4.731 vs **4.654** | **4.625** vs 4.700 | Sigma 2 of 3 |
| median NLL (improper) | 4.806 vs **4.733** | 4.436 vs **4.349** | 4.395 vs **4.334** | Swing 3 of 3 |
| coverage (target 68.3%) | 72.6% vs 70.8% | **66.6%** vs 63.7% | **67.0%** vs 64.1% | Sigma 3 of 3 |
| Spearman | **0.180** vs 0.162 | 0.173 vs **0.186** | **0.252** vs 0.238 | Sigma 2 of 3 |
| responsiveness | 1.005 vs 1.008 | 1.022 vs 1.025 | **1.053** vs 1.044 | tie |
| separation | **0.243** vs 0.298 | **0.389** vs 0.448 | **0.323** vs 0.384 | Sigma 3 of 3 |

**Median NLL is the one measure Swing consistently wins, and it is improper for this question** — a
too-tight sigma wins on the many small-residual rows and only pays on the few large ones. Coverage
independently confirms Swing IS too tight (63.7–70.8% where a 1σ label implies 68.3%), so the median
result is the expected price of honest calibration rather than evidence Sigma is worse. That is why
the script's "best" flag points at trim99, not the median.

### What the controls proved

- **The talent prior earns its place on the scout-facing properties, not on likelihood.**
  `sigma-slow-flat` (identical but talent-independent) wins trim99 NLL on all three algorithms, and
  is the WORST candidate on both requirements (responsiveness 0.989–1.017, separation 0.432–0.584).
  Talent scaling buys the separation between steady and erratic robots, and costs a little likelihood.
- **Mismatched-pairing control ≤ 0.046 everywhere**, far below every Spearman. The pairing is sound.

### A prediction of mine the data refuted

I expected `meanHalfLife` to be the crux — a fast mean absorbs a level shift and hides it. **It is
very nearly irrelevant**: responsiveness reads 1.110 / 1.111 / 1.112 for meanHalfLife 6 / 18 / 40 on
2024–2025. `varHalfLife` is what actually drives it (1.111 → 1.146 → 1.161 for 6 → 3 → 2). The
separate-half-lives design is still right, but for the opposite knob to the one I argued for.

## Two defects found in my own estimator, both caught by verification rather than by reading

1. **`priorObs` was moving the metric's LEVEL, not just its shrinkage strength.** With the natural
   `b0 = a0 * priorSigma^2`, the prior predictive variance came out as `priorSigma^2 * a0/(a0-1)`, so
   a never-seen team read 1.73x its intended spread at priorObs 3 and 1.05x at priorObs 20 — making
   any sweep over that knob uninterpretable. Reparameterised to `b0 = (a0 - 1) * priorSigma^2`.
   **Found by a failing unit test**, whose expectation I had written before the implementation.
2. **The talent prior blew up early-season.** `priorK = sqrt(sum resid^2 / sum talent^2)` spikes to
   **34.06** (settled: 0.33–0.75) while ratings are still near zero, and multiplied by an early
   under-determined OPR rating (max observed talent **9,310**) the prior claimed a **2,780-point**
   swing for one robot. Fixed with two guards: talent scaling is withheld until 200 population
   observations exist, and the scaled prior is clamped to [0.25, 4]× the population's own spread.
   **Found by the 2026 confirmation run**, where the talent-prior variants showed trim99 NLL of 16–23
   against the flat-prior control's 4.99 — the control being clean is what localised it to one line.

The second one is the holdout doing its job: 2024–2025 tuning looked entirely healthy.

## Verification

- `npx vitest run packages/harness/sigmaScore.test.ts` — **25/25**.
- Full root suite — **240 files, 4455 passed, 4 skipped, 0 failed**.
- Root `tsc --noEmit` clean.
- `grep -rn sigmaScore` outside the module/test/script — **no matches**, so nothing production imports it.

## Known limitation, stated not buried

The regime-shift threshold is an ABSOLUTE 15 points, and seasons differ in scoring scale — it selects
~47,000 events in 2026 against ~3,900 in 2024–2025, so many 2026 "shifts" are noise and every
candidate's responsiveness compresses toward 1. **Cross-season responsiveness magnitudes are therefore
not comparable.** The within-run candidate ranking is unaffected (identical events, identical rows for
every candidate). Documented at the constant.

## Recommendation

Sigma Score is better than Swing Score on calibration, separation, and catastrophic-failure avoidance,
tied on responsiveness, and better on volatility ranking for 2 of 3 algorithms. The honest caveat is
EPA, where it is a wash-to-slight-loss on sharpness and ranking while still fixing the tail.

**This is a decision for the developer, not an automatic ship.** A shipping pass would need: the
scale/label question settled (Sigma reports an honest 1σ, roughly half Swing's printed magnitude),
the live Worker's four-float state extended to Sigma's five, and a republish.
