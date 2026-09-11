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

### F1 — There is no skill measurement for the estimator that actually ships. *(the headline)*

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

### R1. Build the skill harness before changing anything. *(prerequisite)*

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
