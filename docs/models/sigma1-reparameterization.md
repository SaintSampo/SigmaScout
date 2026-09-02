# Sigma1 scale-relative reparameterization — the measurement record

Quick task `260901-trz`, D-T1/D-T2. This document exists so the claim "the
parameter reshape was a reparameterization, not an accidental retune" is
something a reader can CHECK rather than something they have to take on
trust. It carries the reference scale the reshape is defined against, the
tolerances that decide the question, and the readings on both sides of the
change.

The instrument is `scripts/reparamEquivalence.ts`
(`pnpm reparam:equivalence`). It opens the corpus read-only, makes no network
call, and its `package.json` entry deliberately carries no `--env-file`.

## Corpus identity

Every figure below was measured against:

| | |
|---|---|
| path | `data/corpus.sqlite` |
| size | 363,192,320 bytes (346.4 MiB) |
| modified | `2026-08-28T17:49:24.774Z` |

A later reader whose corpus reports a different mtime or size is comparing
against different data, and the BEFORE/AFTER delta below is not theirs to
reuse.

## Why exact per-match equivalence is impossible, by construction

`state.allianceScoreStats` is an EXPANDING statistic that deliberately carries
across season boundaries (D-T1's own season-boundary note, and
`carrySeason`'s "carry forward unchanged" choice). The realized `sigma^2` at
match *m* is therefore a weighted blend of every alliance score folded since
2022 — neither the season's final variance nor constant within a season.

The retired parameterization applied ONE number at every match. The new one
applies `rel * sigma^2_m`, which moves match to match. **The two can agree on
AVERAGE over a pool; they cannot agree at a single match.** Anyone claiming
exact equivalence has not understood the change. What follows is therefore a
set of bounded deltas over a pool, with the bounds fixed BEFORE the reading
was taken.

## The reference scale, measured

`SIGMA1_REFERENCE_SCORE_VARIANCE` is defined as the **match-count-weighted
mean of the realized expanding alliance-score variance over every tune-season
match** (2022–2024), folded exactly the way `sigma1/index.ts`'s `update()`
folds it: both alliances per match, a whole-alliance-DQ zero excluded via the
shared `isFullyDqZeroScoreAlliance` predicate, a fully-demo match skipped
whole, and the statistic **never reset at a season boundary**.

That is, by definition, the scale the currently promoted ABSOLUTE parameters
actually operated at — so `rel = absolute / V_ref` preserves the average
absolute value over the pool those parameters were tuned on.

```
pnpm reparam:equivalence --mode reference
```

**Measured 2026-09-01:**

```
SIGMA1_REFERENCE_SCORE_VARIANCE = 1028.2155111415093
```

| season | matches | mean realized variance | first | final |
|---|---|---|---|---|
| 2022 | 14,661 | 561.522 | 625.000 | 891.575 |
| 2023 | 16,349 | 1049.038 | 891.852 | 1495.787 |
| 2024 | 17,027 | 1410.066 | 1496.304 | 1307.783 |
| **pooled** | **48,037** | **1028.216** | 625.000 | 1307.783 |

Three checks that the reading is the intended quantity and not an artefact:

- **The weighted mean lies strictly between the smallest and largest
  per-season mean** (561.5 < 1028.2 < 1410.1). The script asserts this on
  every run; a violation would mean the weighting is wrong.
- **The first value is exactly 625** — `SIGMA1_FALLBACK_SCORE_SD ** 2`, i.e.
  `standardDeviation`'s documented `count < 2` fallback. This is the
  cold-start transient, and it is real: the very first matches of 2022 run at
  roughly 0.61x the reference.
- **The season-final values are consistent with CONTEXT's season-final table
  (2022 ~900, 2023 ~1406, 2024 ~718) once the expanding fold is accounted
  for.** 2022's final, 891.6, is the closest thing here to a single-season
  figure and lands on CONTEXT's 900. 2023's and 2024's finals are HIGHER than
  their own seasons' variances (1495.8 vs 1406; 1307.8 vs 718) because the
  statistic pools 2022+2023(+2024), and pooling populations with DIFFERENT
  MEANS adds a between-season term on top of the within-season variances.
  A 2024 final near 718 would have meant the fold reset at a season boundary,
  which is exactly the mistake this check is looking for.

**This constant is a fixed historical measurement, not a knob.** Re-measuring
it later and editing it in place would silently rescale the meaning of every
committed `data/algorithm-versions/*.json` file, because both
`DEFAULT_SIGMA1_PARAMS`'s relative defaults and
`migrateAbsoluteToScaleRelative`'s divisor read it.

### What it maps the promoted set to

| field | absolute (3.0.0 `tuned-2026-08`) | relative (4.0.0) |
|---|---|---|
| `processNoiseWithinEvent(Rel)` | 0.14522393520915602 | 0.00014123880999220739 |
| `processNoiseEventBoundary(Rel)` | 1 | 0.0009725587575408342 |
| `minConsistencyVariance(Rel)` | 1 | 0.0009725587575408342 |
| `coldStartConsistencyVariance(Rel)` | 16.75421168559074 | 0.016294455300514255 |
| `coldStartTeamTotal(Rel)` (LINEAR, ÷√V_ref) | 20 | 0.6237174865404478 |

`fallbackScoreSd` stays ABSOLUTE at 25 — it is the bootstrap for sigma itself
and cannot be a fraction of the quantity it stands in for.

## The four gates, and why each bound is what it is

These are fixed here, before the AFTER reading exists. **If a gate fails, it
does not get loosened.** The likely cause would be a mis-measured `V_ref`
(wrong DQ handling, or a fold reset at a season boundary); if it still fails
after re-deriving, the shape change is doing something other than rescaling,
and that is a finding to report rather than a tolerance to widen.

| gate | bound | why this number |
|---|---|---|
| **A. Brier** | `abs(dBrier) <= 0.0024`, per tune season and pooled | Two times the measured event-blocked standard error (0.001219, D-T6). A shift inside two event-blocked SEs is not distinguishable from resampling noise AT THE RESOLUTION D-T7's own acceptance rule uses. Anything larger is a behaviour change wearing a rename's clothes. |
| **B. score MAE** | `abs(dMAE) <= 2%` relative, per tune season | The regression this whole task exists to undo is +7.0% (2025) and +15.8% (2026). A reparameterization must land at least 3x inside the smaller of those. |
| **C. bias** | `abs(dbias) <= 1.0` point, per tune season | Bias moved most under the R change (4.05 -> 9.10 in magnitude). One point is ~5% of a tune-season MAE and one fifth of the shift that flagged the original defect. |
| **D. scale-equivariance** | EXACT (bitwise) | The one deviation that IS under our control. Multiply every alliance score by 4 and every absolute parameter accordingly; 4 is a power of two, so IEEE-754 makes this an equality assertion rather than a tolerance. |

Gate A's 0.001219 is CONTEXT's own event-blocked figure. This document's
instrument reproduces it independently: the tune pool measured here is 47,851
matches across 561 events — D-T6's exact population — and a 2000-resample
event-blocked bootstrap of the pooled mean Brier gives **0.0012576**, within
3.2% of 0.001219, i.e. inside the ~1.6% Monte Carlo error each of the two
bootstraps carries. The gate keeps CONTEXT's 0.001219 (and therefore the
slightly tighter 0.0024 bound) rather than substituting the reproduction.

**Two deltas are reported separately and never summed.** The RENAME-ONLY
delta (promoted params mapped through `V_ref`, `covShrinkage` left at its
tuned 0.12817359956447036) is the reparameterization, and gates A–C apply to
it. A SECOND delta adds D-T3's `covShrinkage` fix (0.3, the documented
constant) — a deliberate deviation, estimated by CONTEXT at ~0.0005 Brier. It
is reported on its own and must be of the magnitude CONTEXT predicts; if it
is not, that is a finding.

**Holdout seasons are reported, never gated.** 2025/2026 figures are
re-measured and printed because CONTEXT already publishes those exact
numbers — this is a reproduction, not a new peek, and no parameter is
selected from them.

## Sign convention for bias, stated because it differs from CONTEXT's

This document and `scripts/reparamEquivalence.ts` define

```
bias = mean(predicted - actual), over BOTH alliances
```

so a NEGATIVE bias means the model UNDER-predicts alliance scores. CONTEXT's
own table quotes the same quantities with the opposite sign (2025 "+9.10",
2026 "+25.89"); the magnitudes agree to the digit, as the BEFORE table below
shows. The convention is stated rather than silently reconciled, because a
reader comparing a "+9.10" against a "-9.10" would otherwise reasonably
conclude one of the two measurements is wrong.

## BEFORE — `vpr@3.0.0+tuned-2026-08`, measured 2026-09-01

```
pnpm reparam:equivalence --mode measure \
  --params data/algorithm-versions/vpr@3.0.0+tuned-2026-08.json \
  --seasons 2022,2023,2024,2025,2026 \
  --out reports/reparam-before.json
```

One continuous replay with `carrySeason` threaded across every boundary — not
five independent runs, which would measure a different model. Brier is the
combined comp-level view (D-01's objective). Every standard error is
event-blocked over 2000 resamples (D-T6). MAE and bias are computed over the
IDENTICAL population Brier is scored on; the script throws rather than reports
if its own filtered population disagrees with `aggregateScores`' scored count
or combined-view Brier.

| season | split | matches | events | Brier ± event-blocked SE | winner acc. | score MAE ± SE | bias |
|---|---|---|---|---|---|---|---|
| 2022 | tune | 14,603 | 184 | 0.155635 ± 0.002166 | 0.7587 | 12.868 ± 0.143 | −3.351 |
| 2023 | tune | 16,290 | 185 | 0.164150 ± 0.002218 | 0.7559 | 15.712 ± 0.112 | −3.306 |
| 2024 | tune | 16,958 | 192 | 0.170536 ± 0.001863 | 0.7447 | 13.441 ± 0.137 | +0.416 |
| 2025 | holdout | 17,815 | 204 | 0.159971 ± 0.002014 | 0.7606 | 21.144 ± 0.200 | −9.097 |
| 2026 | holdout | 18,337 | 214 | 0.152721 ± 0.002000 | 0.7789 | 58.531 ± 1.564 | −25.887 |
| **pooled** | — | **84,003** | **979** | **0.160578 ± 0.000936** | 0.7602 | 25.258 ± 0.701 | −8.720 |
| *tune pool only* | tune | *47,851* | *561* | *0.163815 ± 0.001258* | *0.7528* | *14.039 ± 0.092* | *−2.001* |

**This table independently reproduces CONTEXT's published figures.** 2025 MAE
21.144 against CONTEXT's 21.14; 2026 MAE 58.531 against 58.53; 2025 bias
magnitude 9.097 against 9.10; 2026 bias magnitude 25.887 against 25.89. The
tune pool's own size (47,851 matches, 561 events) is D-T6's population to the
match. The instrument is measuring what CONTEXT measured.

### Determinism

`--mode measure` was run twice over 2022–2024 on identical inputs
(`reports/reparam-before-tune-a.json`, `reports/reparam-before-tune-b.json`).
The two JSON reports are byte-identical, including every Brier to its last
digit. A replay that was not deterministic would invalidate every comparison
in this document.

## AFTER — `vpr@4.0.0+tuned-2026-08`, measured 2026-09-01

Two readings, kept apart on purpose. **(a) rename-only** is the parameter set
exactly as the shape-change commit (`8bc90fd4`) promoted it, with
`covShrinkage` still at its searched `0.12817359956447036` — this is the
reparameterization, and gates A–C judge it. **(b) shipped** is the current
committed file, with D-T3's `covShrinkage` fix applied (0.3, the documented
constant). The difference between them is a deliberate deviation and is
reported on its own below; **it is never summed into the rename-only delta.**

All three readings (BEFORE, (a), (b)) were taken against the identical corpus —
363,192,320 bytes, mtime `2026-08-28T17:49:24.774Z` — so the deltas are
attributable to the code, not to the data moving underneath them.

```
# (a) rename-only — the shape-change commit's own promoted file
git show 8bc90fd4:data/algorithm-versions/vpr@4.0.0+tuned-2026-08.json > reports/_rename-only-params.json
pnpm reparam:equivalence --mode measure --params reports/_rename-only-params.json \
  --seasons 2022,2023,2024,2025,2026 --out reports/reparam-after-rename-only.json

# (b) shipped — covShrinkage fixed at 0.3
pnpm reparam:equivalence --mode measure \
  --params data/algorithm-versions/vpr@4.0.0+tuned-2026-08.json \
  --seasons 2022,2023,2024,2025,2026 --out reports/reparam-after-shipped.json
```

### (a) rename-only

| season | split | matches | events | Brier ± event-blocked SE | winner acc. | score MAE ± SE | bias |
|---|---|---|---|---|---|---|---|
| 2022 | tune | 14,603 | 184 | 0.156738 ± 0.002132 | 0.7550 | 13.054 ± 0.147 | −3.889 |
| 2023 | tune | 16,290 | 185 | 0.164063 ± 0.002224 | 0.7556 | 15.708 ± 0.112 | −3.354 |
| 2024 | tune | 16,958 | 192 | 0.170309 ± 0.001830 | 0.7443 | 13.411 ± 0.136 | +0.527 |
| 2025 | holdout | 17,815 | 204 | 0.158786 ± 0.002031 | 0.7625 | 20.585 ± 0.179 | −7.759 |
| 2026 | holdout | 18,337 | 214 | 0.146569 ± 0.002009 | 0.7880 | 53.136 ± 1.149 | −13.891 |
| **pooled** | — | **84,003** | **979** | **0.159113 ± 0.000948** | 0.7618 | 23.987 ± 0.589 | −5.898 |
| *tune pool only* | tune | *47,851* | *561* | *0.164041* | — | *14.084* | *−2.142* |

### (b) shipped, with `covShrinkage = 0.3`

| season | split | matches | events | Brier ± event-blocked SE | winner acc. | score MAE ± SE | bias |
|---|---|---|---|---|---|---|---|
| 2022 | tune | 14,603 | 184 | 0.156598 ± 0.002146 | 0.7550 | 13.054 ± 0.147 | −3.889 |
| 2023 | tune | 16,290 | 185 | 0.164320 ± 0.002242 | 0.7556 | 15.708 ± 0.112 | −3.354 |
| 2024 | tune | 16,958 | 192 | 0.170239 ± 0.001833 | 0.7443 | 13.411 ± 0.136 | +0.527 |
| 2025 | holdout | 17,815 | 204 | 0.158636 ± 0.002025 | 0.7625 | 20.585 ± 0.179 | −7.759 |
| 2026 | holdout | 18,337 | 214 | 0.146373 ± 0.002017 | 0.7880 | 53.136 ± 1.149 | −13.891 |
| **pooled** | — | **84,003** | **979** | **0.159049 ± 0.000952** | 0.7618 | 23.987 ± 0.589 | −5.898 |
| *tune pool only* | tune | *47,851* | *561* | *0.164061* | — | *14.084* | *−2.142* |

## THE VERDICT — gates A–C, on (a), on the tune seasons only

Bound and measurement side by side. **Every gate PASSES.**

| gate | scope | bound | measured | |
|---|---|---|---|---|
| **A. Brier** | 2022 | `abs(dBrier) <= 0.0024` | **+0.001103** | ✅ PASS |
| | 2023 | | **−0.000087** | ✅ PASS |
| | 2024 | | **−0.000227** | ✅ PASS |
| | tune pool | | **+0.000227** | ✅ PASS |
| **B. score MAE** | 2022 | `abs(dMAE) <= 2%` relative | **+1.44%** (12.868 → 13.054) | ✅ PASS |
| | 2023 | | **−0.02%** (15.712 → 15.708) | ✅ PASS |
| | 2024 | | **−0.23%** (13.441 → 13.411) | ✅ PASS |
| | tune pool | | **+0.32%** (14.039 → 14.084) | ✅ PASS |
| **C. bias** | 2022 | `abs(dbias) <= 1.0` point | **−0.538** (−3.351 → −3.889) | ✅ PASS |
| | 2023 | | **−0.048** (−3.306 → −3.354) | ✅ PASS |
| | 2024 | | **+0.111** (+0.416 → +0.527) | ✅ PASS |
| | tune pool | | **−0.141** (−2.001 → −2.142) | ✅ PASS |
| **D. scale-equivariance** | synthetic | EXACT (bitwise) at factor 4 | **bitwise identical `pRedWin`, exactly 4x predicted scores** | ✅ PASS |

Gate D is proven by `packages/core/algorithms/sigma1/scale.test.ts`, not by this
document's instrument: a synthetic stream replayed at scores `s` with
`fallbackScoreSd = f` and at `4s` with `4f` produces bitwise-identical win
probabilities and exactly-4x predicted scores. 4 is a power of two, so IEEE-754
makes that an equality assertion rather than a tolerance.

**2022 is the loosest of the twelve, and that is expected rather than
surprising.** It is the only season that pays the cold-start transient in full:
`fallbackScoreSd = 25` resolves a fresh state to a scale of 625, roughly 0.61x
`V_ref`, so the first few dozen matches of 2022 run tight before the expanding
statistic converges. Every later season inherits a warmed-up statistic. Even so
2022 lands at less than half of gate A's bound and less than three quarters of
gate B's.

## The `covShrinkage` fix, ISOLATED — (b) minus (a)

| season | dBrier | dMAE | dbias | d winner acc. |
|---|---|---|---|---|
| 2022 | −0.000140 | 0.000000 | 0.000000 | 0.00000 |
| 2023 | +0.000256 | 0.000000 | 0.000000 | 0.00000 |
| 2024 | −0.000071 | 0.000000 | 0.000000 | 0.00000 |
| 2025 | −0.000150 | 0.000000 | 0.000000 | 0.00000 |
| 2026 | −0.000196 | 0.000000 | 0.000000 | 0.00000 |
| tune pool | **+0.000020** | 0.000000 | 0.000000 | 0.00000 |
| all-five pooled | **−0.000063** | 0.000000 | 0.000000 | 0.00000 |

**Finding 1 — it did NOT land at CONTEXT's predicted magnitude, and the miss is
in the harmless direction.** CONTEXT estimated the screen's `covShrinkage`
optimum was buying about **0.0005 Brier**. The measured cost of giving that back
is **+0.000020 on the tune pool** and **−0.000063 pooled across all five
seasons** — roughly an order of magnitude smaller, and *negative* (an
improvement) on four of the five seasons taken individually.

The discrepancy is explicable rather than alarming, and the explanation matters
because it is about what the screen actually measured: CONTEXT's ~0.0005 is the
range of a one-at-a-time sweep from **0 to 0.9** with every other parameter at
its **default**, under the **retired absolute parameterization** and, for part
of that history, the retired R estimator. What is measured here is a move from
**0.128 to 0.3** at the **promoted** operating point under the **new
scale-relative** parameterization. Different range, different operating point,
different code version.

The finding strengthens D-T3's argument rather than weakening it. The search's
case for a low `covShrinkage` was that it bought ~0.0005 Brier; at the point
where it actually ships, restoring the PSD safeguard costs **essentially
nothing measurable** — 0.00002 on the pool it was tuned on, against an
event-blocked SE of 0.001258 on that same pool, i.e. about **1.6% of one
standard error**. There was never a real trade here.

**Finding 2 — predicted SCORES are bitwise unchanged, and only Brier moves.**
MAE, bias and winner accuracy are identical to the last bit across the fix
(verified as exact equality, not rounding: 2026 MAE is `53.13557504246273` in
both). This is exactly the structural behaviour `covShrinkage` should have.
It shrinks the OFF-DIAGONAL entries of a team's component covariance, which
feeds the predictive VARIANCE — the published `±` and the win-probability
link's denominator — and never the predicted MEAN. Identical predicted scores
mean identical margins, hence identical favored winners, hence identical winner
accuracy; only the probability attached to each call moves. A `dMAE` of
anything other than exactly zero here would have meant `covShrinkage` was
reaching something it has no business reaching.

## Holdout seasons — REPORTED, never gated

No parameter was selected from these. They are re-measured because CONTEXT
publishes the same figures, so this is a reproduction rather than a new peek.

| | BEFORE (3.0.0) | AFTER (a) | retired estimator's target | recovered |
|---|---|---|---|---|
| 2025 score MAE | 21.144 | **20.585** | ~19.75 | **40%** of the gap |
| 2026 score MAE | 58.531 | **53.136** | ~50.56 | **68%** of the gap |
| 2025 bias | −9.097 | **−7.759** | ~−4.05 | **27%** of the gap |
| 2026 bias | −25.887 | **−13.891** | ~−4.92 | **57%** of the gap |
| 2025 Brier | 0.159971 | **0.158786** | — | improved |
| 2026 Brier | 0.152721 | **0.146569** | — | improved by 0.0062 |

**The answer, stated plainly: the regression is SUBSTANTIALLY recovered, and it
is NOT fully recovered.** D-T1 was aimed at a measured defect — a +7.0% (2025)
and +15.8% (2026) score-MAE regression that Brier and SD(z) both rated
equal-or-better — and making the five parameters scale-relative recovers 40% of
the 2025 gap and 68% of the 2026 gap on its own, while *also* improving Brier on
both holdout seasons. 2026's bias, the single worst symptom, falls from −25.89
to −13.89.

This is the expected shape of a partial fix, and the reason it is partial is
known rather than mysterious. The reparameterization only makes the parameters
*track* each season's scale; it does not re-choose them. The relative values
currently shipped are the old absolute values divided by `V_ref`, i.e. the
optimum for a scale-blind filter re-expressed, not the optimum for a
scale-relative one. CONTEXT measured that reaching 2026 MAE ≈ 50.8 needs process
noise at roughly **16x** the shipped value; the scale-relative mapping supplies
a season-tracking multiplier, not that specific magnitude.

**Closing the remaining gap is the rolling-origin re-tune's job**
(`.planning/todos/pending/retune-sigma1-rolling-origin.md`), which is exactly
what D-T5/D-T7's machinery was built for and what this task deliberately did not
run. A null result here would have been the most important finding this task
could produce; it is not a null result, and the residual gap is named rather
than buried.

## What this document does NOT claim

- It does not claim the shipped parameter set is good. Every parameter bar
  `covShrinkage` and `linkC` was selected under the retired parameterization on
  a fixed split and is stale pending the re-tune.
- It does not claim per-match equivalence. See the section above on why that is
  impossible by construction.
- It does not gate on 2025/2026. Those rows are a reproduction, and the
  rolling-origin machinery exists precisely so future selection never charges
  against them.
