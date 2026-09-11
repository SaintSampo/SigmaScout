---
id: swing-score-audit
created: 2026-09-10
source: full audit of Swing Score requested by the developer (/gsd-fast, 2026-09-10) — read-only, no code changed
resolves_phase:
priority: medium
---

# Swing Score — full audit: what it is for, what is solid, what is not

Read-only audit against HEAD. **Nothing was changed.** Every claim below is either quoted from
code/measurement already in the repo (cited by file) or marked as this audit's own assertion.

Feeds `project_sim_swing_rethink` — the 2026-09-09 decision to stop point-fixing Swing and the
simulation and rethink both from first principles.

---

## 1. Purpose — what the number is actually for

Three user stories, from the developer, recorded in `packages/core/algorithms/sigma1/swing.ts`'s
header and still the design:

1. **Alliance selection, top seed.** Two robots, same rating. Alliance 1 takes the LOWER swing — it
   wants a partner that turns up the same every match.
2. **Alliance selection, low seed.** Two robots, same rating. Alliance 8 takes the HIGHER swing — it
   needs variance to have any shot at Alliance 1.
3. **Mid-quals.** Judge whether the partner you drew can be relied on to score a bonus objective.

Three properties follow, and all three are honoured today:

- It is about **the robot's own match-to-match swing**, not the model's confidence in its rating.
  The Kalman posterior `P` is deliberately nowhere in it.
- **A blank is useless** — story 2 needs a high swing to be VISIBLE.
- It must be **comparable between two robots and readable in points**.

Second role, added later: Swing is the sole source of the **match band**. Every match row's
coloured bar is `√(Σ the roster's Swing²)` (`publish.ts:772-778`, read by `MatchTable.tsx:396`).
`*ScoreVarianceOwn` is explicitly NOT read any more (`ElimsTab.test.tsx:358` pins that), which is
what made the band available to OPR and EPA at all. **Swing is therefore load-bearing for two
surfaces, not one** — any change to the estimator moves every band on the site.

---

## 2. What is solid — do not break these in a rethink

These were each learned by getting them wrong first, and the reasons are recorded:

| Property | Why it must survive |
|---|---|
| **Centring** on the team's own running mean | Uncentred, one OPR team read ±298.92 against a rating of 322.42 — almost all Einstein bias reported as robot inconsistency |
| **One arithmetic path** (West's incremental form, `foldSwingDeviation`) | Offline publish and live Worker run the identical code, which is what lets the replay digest assert bit-equality rather than intend it |
| **Four floats per team**, not a deviation list | The only shape that fits the Worker's 10 ms budget and its team row |
| **Predict-before-update** | A band answers "how unsure were we *then*"; a later match is not an admissible answer |
| **All-or-nothing alliance band** | Sketch 003 put actuals 7–10σ outside a band built from partial variance. Better no band than a tight one |
| **`undefined` below two observations** | One point cannot separate model bias from robot swing; `0.00` there asserts perfect consistency for a robot seen once |
| **Demo / full-DQ-zero exemptions** | Applied at match level in ONE place so live and offline cannot diverge |
| **Level-2 separation** | No `AlgorithmModule` computes or names it; a fifth algorithm gets Swing for free |

The `swingMetric.ts` tier construction is also genuinely good: a team's tier comes from its swing
**residual against a running median of the 25+ teams nearest it in rating**, so a strong robot is
not automatically high-swing, and there are no bucket edges. That is a better design than the
coefficient-of-variation and rating-decile alternatives it rejected.

---

## 3. Findings

### F1 — ~~There is no skill measurement for the estimator that actually ships.~~ **CLOSED 2026-09-10 — and the answer is worse than expected.**

> **RESOLVED by quick task 260910-sz9.** `scripts/measureSwingSkill.ts` (`pnpm measure:swing-skill`)
> is the harness this finding said did not exist. Measured 2024-2026, official play only, all three
> published algorithms, 297,854 team-match observations from 53,309 matches. Full results in
> §3.1 below. The gap is closed; what it revealed is now the open problem.

The only number anyone quotes is **a ceiling, not an achievement**: `r ≈ 0.59`, the best
correlation *any* estimator of this shape could reach against a team's next-match deviation, swept
over 275,172 team-matches. That sweep ran against the **pre-centring, about-zero** estimator
(`sigma1/swing.ts`, quick task 260903-750).

Everything that defines today's estimator landed *after* it: centring, the two-observation rule,
the demo and full-DQ exemptions, and the collapse onto West's incremental form.

**Nobody has measured how close the shipped estimator gets to 0.59, and `scripts/` contains no
harness that could.** There is `measureRpCalibration.ts`, `epaVsStatbotics.ts`,
`verifyAllianceUncertaintyIdentity.ts`, `measureRewindGap.ts` — and nothing for Swing.

This is exactly the failure the project's own log names as its original sin: a published number,
on two surfaces, with no evaluation harness. Every other finding below is hard to act on *because*
of this one — there is no baseline to beat.

## 3.1 MEASURED RESULTS (2026-09-10, `pnpm measure:swing-skill --seasons 2024-2026`)

297,854 team-match observations, 53,309 matches, official play only, walk-forward through the same
`SwingFactorAccumulator` the publisher and the live Worker run.

**Read n with care:** even-split hands all three teammates the identical deviation (F2), so one match
contributes up to 6 rows sharing 2 values. Intervals from a naive n are roughly √3 too tight.

### Skill — well below the ceiling

Correlation between a team's Swing as of matches 1..N−1 and its actual |centred deviation| at match N.
Pooled figures are standardized within season; raw pooling inflates them badly (see the caveat below).

| algorithm | 2024 | 2025 | 2026 | pooled |
|---|---|---|---|---|
| **opr** | 0.583 / **0.135** | 0.228 / **0.134** | 0.220 / **0.236** | 0.339 / **0.193** |
| **epa** | 0.102 / **0.066** | 0.114 / **0.066** | 0.231 / **0.204** | 0.151 / **0.115** |
| **bpr** | 0.079 / **0.067** | 0.073 / **0.056** | 0.264 / **0.230** | 0.141 / **0.118** |

*Pearson / **Spearman**. Trust the Spearman figure.* OPR 2024 shows Pearson 0.583 against Spearman
0.135 — a 4x divergence that is pure outlier leverage from OPR's unstable early-season solves. Where
the two disagree that much, the rank statistic is the honest one.

**Against the `r ≈ 0.59` ceiling, the shipped estimator achieves roughly 0.06–0.24.** It is capturing
a real but small fraction of the available per-team signal. 2026 is consistently the strongest season
for all three algorithms — about 3x the 2024/2025 figures for EPA and BPR — and nobody knows why yet.

**Pairing control:** a deterministic mismatched-pairing control (each swing re-paired with a different
row's outcome at a fixed stride) reads **|r| ≤ 0.027** in every block, well below every headline. The
pairing is sound.

### Calibration — the no-shrinkage signature is textbook

BPR pooled, by swing decile:

| decile | n | mean swing | RMS centred dev | ratio | coverage | BIAS |
|---|---|---|---|---|---|---|
| 1 | 29,785 | 5.93 | 7.43 | **0.798** | 70.3% | +2.48 |
| 5 | 29,786 | 14.51 | 9.21 | 1.575 | 90.6% | +2.10 |
| 10 | 29,786 | 64.46 | 33.21 | **1.941** | 94.1% | −4.12 |

The ratio column climbs monotonically from 0.80 to 1.94 — **low-swing teams are systematically
under-estimated and high-swing teams over-estimated**, which is exactly the regression-to-the-mean
signature of an estimator with no shrinkage. R2 is aimed precisely at this.

The **BIAS** column (mean signed raw deviation per decile) is a finding about the *algorithms*, not
about Swing: BPR runs +2.48 at the low end and −4.12 at the high end, EPA climbs monotonically
+1.19 → +4.97. The model's systematic miss is a function of swing level, differently per algorithm.
This is why the obvious "swing should not correlate with signed deviation" control is invalid here,
and it relates to the band-calibration todo's Finding C.

### Coverage — the per-team band is roughly 1.8x too wide

| algorithm | P(\|centred dev\| ≤ swing) | scale that would deliver 68.3% |
|---|---|---|
| opr | 89.91% | **0.889** |
| epa | 90.96% | **1.026** |
| bpr | 88.54% | **1.101** |

Against the shipped `SWING_FACTOR_SCALE = 1.92`. A "one standard deviation" label implies 68.3% and
delivers 88–91%. **This is a different quantity from the alliance match-band coverage** the constant's
own header quotes (1.68 / 1.71 / 1.13) — that is alliance-level against actual alliance score, this is
per-team against centred deviation. Do not conflate them. F6 stands, with numbers.

### The bar it has to clear — and mostly does not

Gaussian NLL of the centred deviation, median (the mean is unusable — see the tail below):

| algorithm | population-constant baseline | SHIPPED | median skill vs baseline |
|---|---|---|---|
| opr | 4.6712 | 4.0263 | **+0.6449 — BEATS a constant** |
| epa | 3.5836 | 3.5984 | **−0.0148 — does not beat** |
| bpr | 3.5973 | 3.6030 | **−0.0057 — does not beat** |

**For the two algorithms that matter most, a per-team Swing Factor barely matches one number
computed for the whole population.** OPR is the exception, and only because OPR's own ratings are
noisy enough that per-team spread genuinely varies more.

A per-team hindsight reference (each team's full-season RMS, using the future) was included as a
third point and **loses to the walk-forward baseline for EPA and BPR** — it is a reference, not an
upper bound, because the baseline's sigma adapts across the season while the reference is one constant
per team. That inversion is itself informative: **more of the remaining signal lives in season-phase
variation than in per-team variation.**

### The tail is catastrophic, and it is the clearest fixable defect

| algorithm | rows with swing < 1 point | share of total mean NLL |
|---|---|---|
| opr | 287 (0.096%) | **92.2%** |
| epa | 202 (0.068%) | **100.0%** |
| bpr | 599 (0.201%) | **99.2%** |

Two near-identical deviations produce a near-zero Swing Factor, the site publishes it as a confident
`±0.4`, and the next match misses by 40 points. Under a log score those few hundred rows swamp
300,000 others. These are real published values on real team pages, not a scoring artifact —
`swingFactorFromDeviations` returns exactly 0 by design for identical deviations, and the design note
calls that "correct rather than a degenerate case" because the constant is the model's problem. That
reasoning holds for the *centring* but not for what gets *published as a band*.

**Shrinkage toward the rating-local prior (R2) removes this entire failure mode**, because a
two-observation team would be pulled toward its neighbours' typical swing instead of asserting near
perfect consistency.

---

### F2 — Even-split gives all three teammates literally identical evidence.

`(actual − predicted) / rosterSize` is the same number for every robot on the alliance. Within one
match, Swing **cannot** distinguish a no-show from its two competent partners; all three receive
the same deviation.

Separation comes only from roster churn across matches. With an effective sample of ~9.2
observations (`Σ decay^age → 1/(1−w)`, computed in the band-calibration todo) and heavy partner
overlap inside a single event, a meaningful share of any team's Swing is its partners'.

The band already asserts that **variance is additive across a roster** — `allianceSwingBandVariance`
sums squares. The estimator never solves that model; it splits and squares. Those are not the same
thing, and the second one throws away the separating information the first one assumes exists.

### F3 — ~9 effective observations, no shrinkage, published to two decimals with a rarity tier.

A team at exactly two observations is ranked against teams at twelve, with no acknowledgement of
the difference. Its sampling error is on the order of the estimate itself.

The prior needed to fix this **already exists and is already computed**: `expectedSwingByTeam`
builds a rating-local median swing for every team. It is used only for the percentile. That is an
empirical-Bayes prior sitting unused two lines from where it is needed.

### F4 — The Swing column's sort order and its colour come from different scales.

`columns.tsx:437` sorts on raw `swingScore` (points). `rowModel.ts:180` colours on `swingTier`,
which is the **rating-local residual** percentile. So sorting Swing ascending puts low-rating
robots on top, coloured Common, while a Legendary-tier strong robot sits mid-table. Both are
defensible; showing them in one cell without saying which is which is not.

### F5 — Swing is not comparable across algorithms, and the algorithm picker is a dropdown.

The same robot carries three different Swing Scores. At the shared scale of 1.92 the resulting band
covers about **87% under OPR and about 76% under EPA**, where 1σ means 68.3%. The methodology page
states this plainly, which is to its credit — but the number still changes under a control a reader
reasonably reads as a view toggle, not as a change of measurement.

### F6 — "one standard deviation" is claimed and is not delivered.

`SWING_FACTOR_SCALE`'s own comment calls 1.92 **known conservative**, and the coverage-calibrated
values (1.68 / 1.71 / 1.13) were deliberately not adopted to avoid three per-algorithm constants
going stale. The reasoning is sound. But `swingContent.ts`'s `match-band` caption still reads "one
standard deviation either side", and measured coverage is 75–87%. The caption asserts a convention
the number does not meet.

### F7 — The team tile is season-final; the match bands are as-of-match. Both read "Swing".

`publish.ts:2586` is explicit that `layerForAlgo.swingByTeam()` is season-final. The bands on the
same page are walk-forward as-of-match. Early in a season these will not reconcile, and nothing on
screen says why.

### F8 — Two stale pointers in the existing todos.

- `remove-swing-from-sigma1-core.md` instructs that `sigma1/swing.ts`'s measurement evidence be
  moved into `apps/web/src/lib/swingFactor.ts` on deletion. **That file no longer exists** — the
  browser module was reverted when Swing became a published metric (260909-tgf). The evidence has
  no surviving destination named anywhere, which is how measured constants lose their provenance.
- `match-band-calibration-and-the-broken-additivity-identity.md`'s "one gap left" (OPR/EPA showing
  a browser band on event pages and none on team pages) is **closed** — bands are published for
  every algorithm now and `apps/web/src/lib/allianceBand.ts` is gone. That todo needs a status line.

---

## 4. Can it be made better — ranked

### R1. ~~Build the skill harness before changing anything.~~ **DONE 2026-09-10 (quick task 260910-sz9).**

`scripts/measureSwingSkill.ts`, `pnpm measure:swing-skill`. Results in §3.1. What it changes about the
rest of this list:

- **R2 is now the clear priority, with three independent measurements pointing at it** — the monotone
  0.80→1.94 ratio climb, the 0.06–0.35% near-zero tail carrying 83–100% of the NLL, and the estimator
  failing to beat a population constant for EPA and BPR.
- **R5 moved up.** The measured scale for 68.3% per-team coverage is 0.889 / 1.026 / 1.101 against a
  shipped 1.92 — the band is ~1.8x too wide, and the harness that makes per-algorithm constants
  maintainable now exists.
- **A new question the audit did not anticipate:** 2026 scores ~3x the skill of 2024/2025 for EPA and
  BPR, and the per-team hindsight reference loses to a time-varying population baseline. Both say
  season-phase effects are larger than assumed. Worth understanding before R3's expensive solve.

### R1b. Original R1 text, for the record

`scripts/measureSwingSkill.ts`, walk-forward over the corpus, reporting per algorithm and season:

- correlation between a team's Swing as-of-match N and its **actual |deviation| in match N+1**,
  against the 0.59 ceiling — the number that does not currently exist;
- calibration by Swing decile: predicted spread vs realized RMS deviation, which says directly
  whether 1.92 is right and whether it is right *per algorithm*;
- the same two for a trivial baseline (population-constant swing), so "better than nothing" is
  demonstrated rather than assumed.

The replay rig and corpus already exist, so this is small. Without it, R2–R5 are taste.

### R2. Shrink toward the rating-local prior. *(best effort-to-value ratio)*

`swing_shrunk = λ·swing_raw + (1−λ)·expectedSwing`, with `λ = W_eff / (W_eff + k)`. The prior is
already computed; only `k` is new, and R1's harness fits it.

This kills the two-observation noise, makes the displayed value move in the same direction as its
tier (fixing F4 at the source rather than in the UI), and narrows the cross-algorithm gap in F5,
since each algorithm's prior is fitted on its own population.

**One real cost, state it up front:** the live Worker would need the prior to stay bit-equal. A
rating→expected-swing curve is small enough for the league row (well under `MAX_LEAGUE_ROW_BYTES`),
but this is a shape bump, so it rides a re-seed. Shrinking offline only and not live would break
the parity contract and must not be done.

### R3. Solve for per-team variance instead of splitting it. *(the real upgrade — spike first)*

Non-negative least squares on **squared alliance residuals** against the roster design matrix — an
OPR, but on variance. This is the exact model the band already assumes, so fitting it directly is
consistent rather than novel, and it is the only proposal here that addresses F2: different roster
combinations across matches *can* separate teammates that even-split provably cannot.

**Costs, honestly:** a season-level solve, not O(1) per match. It cannot be the live Worker's
arithmetic, so it either becomes publish-time-only with the incremental form as a live fallback
(**which breaks bit-equality — a decision, not a detail**), or it is rejected on those grounds.
Spike it against R1's harness before committing: if it does not beat even-split by a clear margin
on next-match skill, the parity cost settles it and the answer is no.

### R4. Cheap honesty fixes, independent of everything above.

- Re-caption the band to what is measured, or say "about 75% of results land inside" instead of
  invoking a σ convention it misses.
- Give the team tile and the match band distinguishable labels (F7), or footnote the season-final
  vs as-of-match difference.
- Offer sorting the Swing column by tier as well as by points (F4's UI half).
- Repoint `remove-swing-from-sigma1-core.md`'s evidence-preservation clause at a file that exists,
  and add the closure status line to `match-band-calibration-...md` (F8).

### R5. Revisit per-algorithm scale — the reason it was rejected expires with R1.

Three per-algorithm constants were rejected because they would need re-measuring on every model
change and would go stale. That reasoning is correct *today*. If R1's harness runs as part of the
publish flow, the constants are re-measured automatically and the staleness argument no longer
holds. Worth reopening **only** after R1 ships, not before.

---

## 5. What this audit did not do

- Did not run any measurement. Every figure quoted is from existing repo artifacts.
- Did not measure the current estimator's achieved skill — that is R1, and it is the point.
- Did not evaluate the simulation half of the rethink.
