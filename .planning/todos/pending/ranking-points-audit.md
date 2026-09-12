---
id: ranking-points-audit
created: 2026-09-10
source: full audit of ranking-point prediction and the prediction-update paths requested by the developer (/gsd-fast, 2026-09-10) — read-only, no production code changed
resolves_phase:
priority: high
---

# Ranking points — full audit: how they are predicted, and how predictions are updated

Read-only audit against HEAD (`b006cb50`). **No production code was changed.** Every claim is
either quoted from code (cited by file and line) or measured by this audit against the live
corpus and the live R2 artifacts. Measurements run for this audit are marked **[measured today]**;
the throwaway probe scripts are in the gitignored `experiments/`.

Two questions were asked and they have different answers, so they are answered separately: **§1**
is how a ranking point is predicted, **§2** is how predictions are updated. The findings in **§4**
span both.

---

## 1. How ranking points are predicted

RP prediction is **not part of any algorithm**. It is a "level 2" SigmaScout feature computed
from predicted-vs-actual scores plus observed score breakdowns, and every algorithm gets it
identically — including OPR, which models no uncertainty at all.

`packages/core/algorithms/bpr.ts:47` says this for the premier algorithm in its own words: it
"emits no `redRpPmf`/`blueRpPmf`". Verified — `redRpPmf` appears as an output in none of
`opr.ts`, `epa.ts`, `bpr.ts`.

The pipeline has four stages.

### Stage 1 — the season's rules (`packages/core/rankingPoints/`)

Ten per-season modules (`2016.ts` … `2026.ts`) dispatched by `rules.ts` through a table with **no
branches** — registering a season is an import plus a record entry. Each module declares:

- `thresholdVariables` — the alliance-level quantities a bonus depends on (2026:
  `hubTotalCount`, `totalTowerPoints`)
- `bonusNames`, `winRp`, `tieRp`, `maxRp`
- `parse(rawBreakdown, side, eventType)` — what **actually** happened
- `predictThresholds(values, eventType)` — bonus flags from **drawn** threshold values

`predictThresholds` is deliberately weaker than `parse`: it sees only numeric threshold
variables, never alliance-level gating signals (coopertition flags, per-robot auto-leave state).
Where a criterion cannot be expressed it takes a documented **conservative branch** and returns
`false`. `packages/harness/rpConservativeBranch.ts` measures that this understates and never
overstates.

### Stage 2 — per-team beliefs about threshold variables (`empiricalMoments.ts`)

`RpMomentsAccumulator` learns, per team, a running belief about each threshold variable from
**observed results alone** — no model state, no rating. This adapter is what let RP survive VPR's
retirement (`moments.ts` is the contract; Sigma1's Kalman version was one implementation, now
dead).

- A team's share of an alliance observation is the **even split** `value / rosterSize`
  (Assumption A1: FRC records no per-robot breakdown).
- Beliefs are EWMA with a **6-match half-life**, folded by West's weighted incremental update.
- An alliance's mean is the **sum** of its three teams' means; its variance the sum of theirs,
  rescaled to undo the even-split shrinkage.
- The covariance block is **diagonal** and `scoreCrossCovariance` is **zero** — both deliberate,
  both documented in the file header as decisions rather than defaults.

### Stage 3 — the joint Monte Carlo draw (`distribution.ts`)

`rpPmfForMatch` builds one joint Gaussian over
`[redScore, blueScore, redThresholds…, blueThresholds…]`, Cholesky-factorises it, and takes
**4000 draws** (`RP_MONTE_CARLO`, `sigmaScoutLayer.ts`). Per draw it compares the two drawn scores
for win/tie RP and calls `predictThresholds` for bonus RP. Output is a **pmf over total RP** plus
**per-bonus marginals**.

Two things are easy to miss and worth naming:

- The **score variance fed to this draw is the Swing Band**, not the algorithm's own predictive
  variance (`sigmaScoutLayer.ts` `#rpFieldsFor` passes `redBandVariance`/`blueBandVariance`).
- Cross-alliance covariance is exactly zero (red and blue share no team), which is sound.

Seeding is per-match (`rpMonteCarloSeed ^ fnv1a32(matchKey)`), never from stream position — so a
match's pmf is reproducible regardless of how many matches preceded it.

### Stage 4 — consumption

- **Rank simulation** (`packages/core/algorithms/simulation/rankSimulation.ts`) draws one RP value
  per alliance per remaining match and ranks by running average (FRC's Ranking Score).
- **Bonus dots** (`apps/web/src/components/team/BonusRpDots.tsx`) render a per-bonus marginal as
  solid/hollow at a **0.5 threshold** (`bonusRp.ts` `PREDICTED_BONUS_THRESHOLD`).

---

## 2. How predictions are updated

There are **two** write paths, and they do not agree (F5).

### 2a. Offline — `pnpm publish:seasons` (authoritative)

`WalkForwardSimulator` (`packages/harness/replay.ts:150-159`) is strictly predict-then-update:

```ts
const rawPrediction = algorithm.predict(state, toLeakProofUpcoming(result));
…
state = algorithm.update(state, result);
```

`SigmaScoutLayer.foldPlayed` mirrors that at level 2 — it reads this match's band and pmf from
history so far, **then** folds the match in. A match never informs its own prediction.

The algorithm's own update (BPR, `bpr.ts:691`) scores both alliances against the **pre-match**
state, advances an online score scale, and takes one gradient step on a learned link temperature.
It contains no RP term at all.

This path writes every artifact: event, team, the teams/events feeds, compare, and presim
sidecars.

### 2b. Live — the Worker cron tick (`apps/worker/src/scheduled.ts`)

Runs every minute during live windows. Strict two-phase ordering per event: **Phase A** folds
every published algorithm's state and writes it to D1; only when all three succeed does **Phase
B** write artifacts. A rejected Phase A aborts the whole event, so no partial per-algorithm
advance can desync the cursor. Subrequest cost is estimated up front and the whole event defers if
it will not fit.

The tick resumes the level-2 **Swing** accumulator from D1 (`SwingFactorAccumulator.fromBeliefs`,
shape 10). **It does not resume, or compute, any RP state** — see F5.

---

## 3. What is solid — do not break these in a rethink

1. **Predict-before-update holds on both paths**, at both levels. This is the failure-log
   discipline and it is genuinely enforced, not merely claimed.
2. **Per-match seeding** makes a pmf independent of replay position — load-bearing for the
   bounded-slice digest, and correct.
3. **The numerical hardening is real and was found by real runs**: escalating Cholesky ridges, and
   a Cauchy–Schwarz clamp on the score/threshold cross-covariance (found by `2026rikin_qm1`'s 30%
   bound violation). Neither is a hyperparameter; `tune.ts` never searches them.
4. **The season rules are data entry, not branches** — ten seasons registered, and the
   `parse`/`predictThresholds` split keeps "what happened" and "what we can predict" from
   drifting.
5. **The conservative branch never overstates**, and that is measured rather than asserted.
6. **`moments.ts` as a contract** is what let RP survive VPR's retirement. Extracting it was right
   and it is documented honestly, including which assumptions are decisions.
7. **RP is genuinely live again** for all three algorithms. [measured today] `2026casnv`'s
   published `bpr@3.0.0+baseline` artifact carries `redRpPmf` and `redBonusRp` on 59 of 74 played
   qualification matches.

---

## 4. Findings

### F1 — Ranking points are published with no accuracy measurement anywhere on the site. *(the headline)*

The project's stated core value is that "every algorithm's accuracy is measured and published."
For winner prediction that is true. For ranking points it is not.

[measured today] the live `v1/compare/2026.json` contains `brier` and `calib` keys and **no `rp`
or `bonus` key of any kind**. Nothing on the site reports how good the bonus probabilities or the
RP distribution are.

This matters more than it otherwise would because of F2: the numbers being published without a
scorecard are the ones that are 2x miscalibrated. `scripts/measureRpCalibration.ts` exists and is
good — it is simply not wired to anything a visitor can see, and its output is gitignored.

### F2 — Bonus probabilities under-predict by 2.06x, in every season, without exception.

[measured today] `npx tsx scripts/measureRpCalibration.ts --seasons 2016-2020,2022-2026
--algorithm bpr`, walk-forward through the same `SigmaScoutLayer` the publisher runs —
**488,002 (alliance, bonus) observations**:

| | |
|---|---|
| mean predicted | **0.1507** |
| observed | **0.3109** |
| pooled Brier | 0.1860 |
| predictions below 0.05 | 254,300 (52.2%), mean 0.0085, **actually happen 11.26%** |

Every bonus in every season under-predicts. Worst cases: 2016 `breach` predicted 0.0252 against an
observed **0.7338** (Brier 0.6927 — worse than predicting 0.5 for everything); 2025 `coralBonus`
predicted 0.0081 against 0.1910; 2025 `autoBonus` predicted 0.1954 against **0.6594**.

**This is an improvement and should be recorded as one.** The previous measurement (2026-09-09,
same script) was mean predicted 0.1131; the even-split *variance* fix has landed since and moved
it to 0.1507. The remaining gap is not that fix failing — it is the causes below.

**Scope, unchanged:** this is bonus RP and the rank simulation. Winner prediction and match Brier
come from level 1 and are unaffected.

#### Cause history, folded in from `rp-bonus-probabilities-are-severely-under-predicted` (2026-09-12)

That todo is closed and its content lives here. It separated the under-prediction into **three
causes by measurement**, and two of them are fixed — which is why F2's headline moved. Kept because
the before-and-after is the only record of what each fix was worth, and because two of the three
close permanently.

| Cause | State | Evidence |
|---|---|---|
| 1 — conjunctions across a **diagonal** covariance block | **OPEN**, and now dominant | F4 below |
| 2 — even-split **variance** shrinkage by exactly `rosterSize` | **FIXED** `72566078` | this section |
| 3 — bonuses hardcoded `false` | **2025 FIXED** `72566078`; 2019 open (F12) | this section |

**The before-and-after, over the same 488,026 observations:**

| | before (2026-09-09) | after (`72566078`) |
|---|---|---|
| pooled Brier | 0.2164 | **0.1860** |
| mean predicted (observed 0.3109) | 0.1131 | **0.1507** |
| share of predictions below 0.05 | 70.5% | **52.2%** |
| how often that sub-0.05 bucket happens | 18.41% | **11.26%** |

18 of 21 season-bonuses improved; 2 unchanged (still hardcoded `false`); one moved -0.0002, noise.

**Cause 2 was a genuine error, not a documented simplification.** A team's belief folds from
`allianceValue / rosterSize`, so its variance estimated `Var(A)/9`; summing three teams gave
`Var(A)/3` where the alliance variance should be `Var(A)`. `empiricalMoments.ts`'s header justifies
the diagonal block and the zero cross-covariance deliberately and says nothing about this shrinkage.
Shipped as the average of each contributing team's implied alliance variance
(`rosterSize² × Var(belief)`), which reduces to `rosterSize × sum` on a full roster and degrades
correctly on a partial one rather than shrinking twice. **Three tests now pin the variance
MAGNITUDE** — every test that existed pinned only its shape (zero at one observation, positive once
observations differ, diagonal), which is exactly how a factor-of-3 error survived all of them.

**Cause 3, 2025 `autoBonus`, was a missing INPUT rather than a modelling approximation.** It happens
**65.94%** of the time and the hardcoded `false` scored a Brier of 0.6594 over 25,978 observations —
the second-worst number in the whole measurement. "All three recorded robots left" IS a count
reaching 3; tracking `autoLineCount` and `autoCoralCount` as threshold variables took it to
**0.4045**. Parse and predict now read the same two counts so their definitions cannot drift. It
still understates, for a stated reason: a count drawn continuously and cut at its own ceiling
understates a discrete "3 of 3". 2019 `completeRocket` was left alone deliberately — see F12.

**The headline figure was corrected here, and the old one has propagated.** The closed todo's
headline was **2.75x** (0.1131 against 0.3109) and that number reached commit `4bdb7717`'s subject
line and this project's memory notes. It is the PRE-fix measurement. **This audit re-measured it as
2.06x** (0.1507 against 0.3109) and 2.06x is the current figure. Anything still quoting 2.75x is
quoting a state the code left on 2026-09-09.

**Two corrections the closed todo carried that must not be re-lost:**

- Its original measurement predated plan 09-01's same-scorer fix. `measureRpCalibration.ts` was
  constructing `SigmaScoutLayer` with one argument while the publisher used two, so every bpr bonus
  probability it reported came from a band the publisher does not use. The frozen post-fix baseline
  is `data/baselines/rp-calibration-2026-09.json`; compare against that, not against the old report.
- **Negative binomial is not the fix for this.** Its retest (`260912-2uz`) is a real, positive
  result — pooled bonus-RP Brier -0.002898, 21 cells improved of 24 reachable — and it was declined
  on cost. But a Brier improvement of 0.0029 is not a 2.06x calibration error being closed. The two
  are separate problems and the retest does not touch this one.

---

### F3 — The predicted alliance mean is systematically too low, in 33 of 34 season-variables.

This is the most likely dominant cause of F2, and it is measured directly rather than inferred.

[measured today] regressing each season's **observed** alliance threshold value on the
**predicted** mean vector that feeds the draw:

| season | variable | predicted mean | observed mean | deficit |
|---|---|---|---|---|
| 2026 | `hubTotalCount` | 156.74 | 178.53 | −12.2% |
| 2025 | `trough` | 2.47 | 2.84 | −13.0% |
| 2023 | `linkPoints` | 10.80 | 12.79 | −15.6% |
| 2022 | `matchCargoTotal` | 13.82 | 15.62 | −11.5% |
| 2017 | `autoFuelPoints` | 1.67 | 1.94 | −13.9% |

**33 of 34 season-variables have a predicted mean below the observed mean**, typically 8–15% low.
The single exception is 2016 `attackedTowerEndStrength`. A threshold is a tail event, so a mean
that is 10% low costs far more than 10% of the probability — which is exactly the shape F2 shows.

**An a-priori hypothesis this audit tested and rejected, recorded so it is not re-proposed:** the
even-split estimator looks like it should shrink an alliance's deviation from the league mean by
a factor of `rosterSize` (a team's belief converges to `(cᵢ + 2c̄)/3`, so three summed give
`A_true/3 + 2c̄`). **The measurement does not support a 3x shrinkage** — the pooled slope of
observed on predicted is **1.071** (n=841,011, r=0.486). Nor can that regression settle the
question either way: the predictor is itself noisy, so errors-in-variables attenuates the slope
by an unknown factor. The level bias above is the robust result; the shrinkage claim is not.

**One caveat that must be resolved before acting.** This probe's population is broader than the
RP-producing population: it includes alliances with partially cold rosters (F9), which drag the
predicted mean down and are largely absent from matches that actually get a pmf. Re-measuring the
deficit restricted to fully-warm 3/3 rosters is the first task of R2, because it separates "the
estimator is biased low" from "cold rosters are dragging the average".

### F4 — The diagonal covariance block discards real, positive, measured dependence.

[measured today] over 214,524 alliance-matches carrying two bonuses:

| | |
|---|---|
| observed P(both) | 0.1179 |
| P(A)·P(B) if truly independent | 0.0787 |
| **the model's own implied P(both)** | **0.0222** |

Two errors compound here and should not be conflated:

- **+0.0391** is the real dependence the diagonal block throws away (0.0787 → 0.1179). Positive in
  all ten seasons; the file header predicted its sign correctly.
- **0.0222 → 0.0787** is much larger and is *not* the diagonal block's fault — it is F2/F3's
  marginal error, squared. Conjunctions are where marginal error compounds.

So the diagonal block is a real but **secondary** cause. Fixing it alone moves P(both) from 0.0222
to roughly 0.0260. The marginals are the problem.

### F5 — The live Worker never computes ranking points, so every live tick strips them.

The most serious *correctness* finding. It is latent only because it is September and no event is
running.

`apps/worker/src/scheduled.ts` reads `prediction.redRpPmf` (lines 551, 627) and
`prediction.redBonusRp` (`liveBonusRpFields`, line 477) — but:

- no published algorithm emits either (`bpr.ts:47`), and
- the Worker **never constructs an `RpMomentsAccumulator` and never calls `rpPmfForMatch`**.
  Verified: `rpPmfForMatch` appears in `apps/worker/src/` exactly once, in `bundleSmoke.ts`, a
  smoke test proving Cholesky runs inside the Workers runtime. `SigmaScoutLayer` and
  `RpMomentsAccumulator` appear nowhere in the Worker at all.
- the D1 seed has no belief field for the live accumulator. `stateSnapshot.ts:357` carries
  `rpBeliefs`, but it is typed `Sigma1TeamState["rpBeliefs"]` — the **retired** VPR algorithm's
  Kalman state, not `empiricalMoments.ts`'s beliefs.

So during a live event every touched row loses its RP. For **played** rows the loss is structural
rather than merely empty: `buildEventMatchRow` (line 519) **does not list `redRpPmf` at all**,
while its offline counterpart (`publish.ts:794`) does. The schema is explicit that the field must
survive on played rows:

> "…which is why it must exist on a PLAYED row and not only an upcoming one — a rewind start match
> is the common case (1,312 of 1,353 corpus events have no unplayed qualification match at all)."
> — `pageArtifacts.ts`, `EventMatchSchema.redRpPmf`

Nothing catches this: the field is `.optional()`, and no Worker test references `redRpPmf`. This is
exactly the lossy-second-write-path defect `sigmaScoutLayer.ts`'s own header says it was extracted
to prevent — the extraction fixed `--event`, but the Worker was never brought onto the shared
module.

**Consequence at the next live event:** bonus dots go dark and the Simulation tab loses matches,
progressively, as the event plays out — then silently comes back at the next offline republish.

### F6 — The pmf's own win probability disagrees with the published `pRedWin`.

Win RP is the largest single term in total RP (2026: `winRp` 3 of `maxRp` 6). The pmf derives it
by drawing two scores using the **Swing Band** variance, while the site displays a `pRedWin` the
**algorithm** produced from its own posterior variance and learned link temperature. Different
variance scales, so they disagree.

[measured today] over 110,362 qualification matches, comparing the pmf's implied
`Φ((μ_red − μ_blue)/√(v_red + v_blue))` against the published `pRedWin`:

| | |
|---|---|
| mean signed difference | 0.0000 |
| median \|difference\| | 0.0428 |
| p90 \|difference\| | 0.1203 |
| p99 \|difference\| | 0.1827 |
| max \|difference\| | 0.3415 |
| **disagree on the favourite** | **0 (0.00%)** |

The last row is the good news: both are monotone in the score margin, so the *direction* never
conflicts, and there is no systematic bias. But the site can show a 65% favourite while the
simulation ranks the field using an effective 53% or 77% for that same match. Whichever is right,
publishing two is a coherence bug.

### F7 — Tie ranking points are unreachable: the tie branch is dead code.

`distribution.ts` computes `tied = !redWon && !blueWon` from two **continuous** Gaussian draws, so
a tie requires exact floating-point equality. It effectively never fires, and `ruleModule.tieRp` is
never awarded in any draw of any match.

[measured today] **1,206 of 110,362 qualification matches (1.093%) actually tied.** Real FRC scores
are integers; the draw is never rounded to integers before comparison.

Small in effect (a tied match draws ~1.5 expected RP instead of 1) but it is an unreachable code
path that reads as though it works.

### F8 — The cold-start gate drops 10–24% of played qualification matches at regular events.

[measured today] against the **live published** `bpr@3.0.0+baseline` artifacts:

| event | played quals | no pmf | |
|---|---|---|---|
| 2026azfg | 83 | 19 | 22.9% |
| 2026ausc | 70 | 17 | 24.3% |
| 2026casnv | 74 | 15 | 20.3% |
| 2026arli | 50 | 9 | 18.0% |
| 2026alhu | 80 | 8 | 10.0% |
| **2026arc** (champs division) | 125 | **0** | **0.0%** |

The chain is the one already diagnosed: `#rpFieldsFor` returns `{}` unless **both** bands are
defined; `allianceSwingBandVariance` is all-or-nothing across six robots; a Swing Factor needs two
prior played matches. Champs divisions score 0% because teams arrive carrying prior-event history
within the same season.

The all-or-nothing rule is right for **display** (a band from part of the variance put actuals
7–10σ outside it) but it was inherited by the **simulation input** path, where the cost of refusing
is losing the match entirely. See F13 for what that cost actually is — it is smaller than recorded.

### F9 — The partial-roster correction was applied to the variance but not the mean. *(latent)*

In `empiricalMoments.ts` `momentsFor`, the variance path divides by `contributing` to handle a
roster where some team has no belief yet; the mean path sums over contributing teams with no
scale-up:

```ts
mean += belief.mean;                    // no partial-roster correction
…
variances.push(contributing > 0 ? (varianceSum * roster.length ** 2) / contributing : 0);
```

An alliance with 1 of 3 teams cold therefore gets a mean about ⅔ of the truth. The file header
asserts the first moment needs no correction — true when reconstructing one observed value, false
when predicting from partial per-team histories.

**This is latent today, not a live cause.** [measured today] 487,972 of 488,002 observations
(99.99%) have a fully warm 3/3 roster, because F8's band gate already requires two matches per
robot before any RP is produced at all. The 30 partial-roster observations predict 0.0335 against
an observed 0.400.

It is listed because **relaxing F8 — which any simulation rethink will want to do — exposes it
immediately**, and because it is the same bug class as the even-split variance shrinkage that was
just fixed, sitting on the other moment.

### F10 — The 0.5 dot threshold turns a compressed distribution into dots that are simply wrong.

`PREDICTED_BONUS_THRESHOLD = 0.5` renders a predicted bonus dot solid only at p ≥ 0.5. Given F2's
compression, most dots can never be solid.

The sharpest case: [measured today] 2025 `autoBonus` is earned **65.94%** of the time, and its
highest-populated predicted bucket is `[0.40,0.60)` at n=686 of 25,978 — so **under 2.6% of
`autoBonus` dots could possibly render solid, for a bonus earned in two matches out of three.**

The threshold itself is defensible (a dot is binary; some threshold is unavoidable). The problem is
upstream. It is named here because it is how F2 reaches a visitor's eyes.

### F11 — A stale presim sidecar is being served, and the two RP-capable algorithms have none.

[measured today] for `2026casnv`:

| key | status |
|---|---|
| `v1/presim/2026casnv/opr@4.0.0+baseline.json` | **200** — generation `2f1a8885…`, computed **03:45** |
| `v1/presim/2026casnv/bpr@3.0.0+baseline.json` | 404 |
| `v1/presim/2026casnv/epa@7.0.0+baseline.json` | 404 |

The live generation is `97342984…`, computed **19:46** the same day. The OPR object is an orphan
from an earlier generation that the purge missed — stale data still reachable by the client. And
the only algorithm with a sidecar is the one that models no uncertainty, while the two that now
produce RP have none.

### F12 — One conservative-branch bonus is still hardcoded `false` at a material rate.

`packages/core/rankingPoints/2019.ts:162` — `const completeRocket = false;` inside
`predictThresholds`. [measured today] predicted **0.0000** across all 26,174 observations against
an observed **5.15%**.

This is the last one of consequence: 2025 `autoBonus` has since been given a real predictor, and
2026 `traversal` is genuinely predictable (a `totalTowerPoints` threshold, `2026.ts:98`) and merely
rare (0.12% observed). 2019 is an old season — low priority, listed for completeness and so the
convention is not mistaken for fully retired.

### F13 — A recorded claim about the simulation's handling of excluded matches is wrong.

It is written down in the project's notes that matches excluded from the simulation "award 0 RP to
everyone in all 1000 draws — systematically under-ranking any team that played in them."

**That is not what the code does.** `simulateRanks` increments `rpSum` and `matchesPlayed`
together, and only for matches it actually simulates:

```ts
for (const i of match.redIndices) { rpSum[i] += redRp; matchesPlayed[i] += 1; }
```

Excluded matches never enter `resolvedMatches`, so they touch **neither the numerator nor the
denominator**. Ranking Score is an average, so dropping a match does not depress it.

The real effect of F8 is therefore **a smaller effective sample** for affected teams — wider,
noisier rank distributions — plus whatever bias comes from *which* matches are missing (the early
ones), not a guaranteed-wrong zero. This lowers F8's priority and means `StartMatchPicker.tsx`'s
existing disclosure of the count is closer to adequate than it appeared.

---

## 5. Can it be made better — ranked

### R1. Publish an RP scorecard before changing any RP math. *(prerequisite; closes F1)*

`scripts/measureRpCalibration.ts` already computes everything needed. Wire its output into the
Compare page the way winner Brier and calibration already are. Without this, every change below is
unmeasurable and F2 stays invisible to the people relying on the dots. It is also the cheapest item
here.

### R2. Fix the mean estimator. *(the largest single win; F3 → F2)*

Sequence matters:

1. Re-measure F3's mean deficit **restricted to fully-warm 3/3 rosters**, to separate estimator
   bias from cold-roster drag. One probe, an hour's work, and it decides everything after it.
2. If the bias survives that restriction, the leading candidate is that a backward-looking 6-match
   EWMA trails a field that improves over a season — in which case the fix is a trend/level
   correction, not a new estimator.
3. Only then consider replacing the even split (solving for per-team contributions is the real
   upgrade, and it is a spike, not a patch).

### R3. Bring the Worker onto `SigmaScoutLayer`. *(closes F5 — correctness, not accuracy)*

Two changes, and the second is load-bearing:

1. Add `redRpPmf`/`blueRpPmf` to `buildEventMatchRow`, so a played row stops being structurally
   incapable of carrying them.
2. Give the Worker a real RP accumulator resumed from D1, which needs a new shape-11 belief field
   for `empiricalMoments.ts`'s beliefs — the existing `rpBeliefs` belongs to dead VPR and must not
   be reused for this.

Add a live/offline row-shape parity test so a third write path cannot reintroduce the defect. Do
this before the next competition season regardless of where R2 lands.

### R4. Decide the win-probability question deliberately. *(closes F6; F7 comes free)*

Either feed the algorithm's own predictive variance into the RP draw so the pmf reproduces
`pRedWin`, or draw the winner separately from `pRedWin` and use the band only for bonuses. The
second also fixes F7 (round drawn scores to integers, or award tie RP from an explicit tie
probability) and removes the oddity where red and blue are drawn independently, so both alliances
can "win" the same draw.

### R5. Relax the all-or-nothing band for the simulation input only. *(F8; makes F9 live)*

Keep the strict rule for display. For the simulation, an imprecise band beats dropping the match —
but note F13: the current cost is lost precision, not systematic bias, so this is less urgent than
it looked. **If this is done, F9 must be fixed in the same change**, because relaxing the gate is
precisely what exposes the uncorrected partial-roster mean.

### R6. Housekeeping. *(F11, F12)*

Purge the orphaned presim sidecar and work out why `bpr`/`epa` generate none; give 2019
`completeRocket` a real predictor or leave it and record the decision.

---

## 6. What this audit did not do

- Did not change any production code. The only files added are throwaway probes in the gitignored
  `experiments/`.
- Did not measure RP for `opr` or `epa` — every measurement used `bpr`, the premier algorithm. The
  layer is algorithm-agnostic so the *mechanisms* transfer, but the numbers may not exactly.
- Did not evaluate whether the 6-match half-life or the 4000-draw count are well chosen. Neither
  has ever been tuned and `tune.ts` does not search them.
- Did not audit district point models or alliance-selection RP — only match ranking points.
- Did not re-derive the Swing Band itself. See the separate Swing Score audit
  (`swing-score-audit.md`); F6 and F8 both depend on it.

---

## STATUS 2026-09-12 — Phase 9 executed against this audit; here is what each finding now is

Phase 9 (`.planning/phases/09-analytic-ranking-points-browser-side-simulation/`) took its whole
scope from this file. Ten plans shipped, published at generation `b23d214d`.

| Finding | State |
|---|---|
| **F1** RP accuracy never reported | **CLOSED** — calibration scorecard live on the Compare page, `rpCalibration` in every compare slice |
| **F2 / F3** bonus probabilities under-predict | **MEASURED, FIXES REVERTED, VERDICT IN DOUBT** — see `rp-bonus-probabilities-are-severely-under-predicted`. F3's deficit survives restriction to fully-warm 3/3 rosters (33 of 34 season-variables, magnitude 10.4% to 8.0%) |
| **F4** dependence between threshold variables | **STILL OPEN** — deliberately out of Phase 9's scope |
| **F5** live Worker strips RP | **CLOSED** — Worker computes RP, played rows carry the pmfs, state shape 11 to 15 seeded and deployed. **Not yet exercised in production** (no live events in September) |
| **F6** pmf-implied win probability diverges from published | **CLOSED in mechanism, REVERTED in ship** — the fix drives the gap to exactly 0 but was refused by a bar that cannot see it |
| **F7** tie branch can never fire | **same as F6** — discrete-margin model returns 0.008239 against an observed 0.010928, refused by the same blind bar |
| **F8 / F9** OPR and EPA cold-start gate | **STILL OPEN.** But see `cold-start-chain-gates-rp-pmfs-measured` — a live measurement contradicts the claim that this chain gates presim |
| **F10** bonus-dot display threshold | upstream cause closed; the **display** threshold is still open |
| **F11** presim sidecars keyed to retired vpr | **CLOSED** — re-keyed to published ids, 318 orphans deleted, post-census 0/60 |
| **F12** 2019 completeRocket always-false | **STILL OPEN** — declared as the `constant` mechanism class, deliberately not fixed |
| **F13** | **STILL OPEN** — out of scope |

The Monte Carlo is gone: `analyticRpPmf` computes the pmf in closed form and level-1 output is
byte-identical (D-12 green). **Four findings remain open (F4, F8/F9, F12, F13) plus F10's display
half**, and F2/F3's verdict is unsupported pending
`restore-negative-binomial-to-retest-it`. This todo should stay open until those are dispositioned.

### F2/F3 dispositioned 2026-09-12 — measured, then declined on cost

`restore-negative-binomial-to-retest-it` is **closed** (quick task `260912-2uz`). The retest ran on
the selection slice, which is what the sentence above was waiting for, so F2/F3's verdict is no
longer unsupported — but it did not resolve the way the old wording implies.

**Negative binomial helps.** Pooled bonus-RP Brier **-0.002898** over 510,838 observations across
24 reachable cells: **21 improved, 3 regressed, 0 tied.** The 24 ties that produced the original
"does not help" reading were the `clauseProbability` hardcode, exactly as suspected.

Two things the run established that the old text could not:

- **Reach is 24 of 33 cells, not 21.** `deriveMarginalArmEligibility` required *every* clause of a
  bonus to honour the declared family; the correct condition is that **at least one** does. Fixed in
  `7cab6632`. The old rule buried three genuinely-moving cells — including 2016 `capture`, the
  largest per-bonus improvement in that season — inside the category that ties by construction,
  which is the same pooling error that made the 09-06 verdict worthless.
- **It was declined on cost, not on result.** ~1.2% on bonus RP alone, only 35.78% of fits resolving
  to NB, and a confirmation would have spent the 2023-2026 reporting slice. Jacob's call. The slice
  stays unspent and the restored family plus the `--marginal-arm` seam stay in the tree, inert, so
  reopening costs one command.

So F2/F3 read: **the mechanism is real and measured; pursuing it was declined.** That is a closed
disposition, not an open question. The four findings above (F4, F8/F9, F12, F13) plus F10's display
half are what still hold this todo open.

---

## MERGE 2026-09-12 — `rp-bonus-probabilities-are-severely-under-predicted` folded in and closed

The 2026-09-12 backlog triage found that every work item in that todo already existed here under an
F-number, and that keeping both guaranteed F4 would be argued from two documents that rank it
oppositely: that file called the diagonal block "the big one" and "now the dominant remaining term",
while F4 here measures it as **secondary** — it moves P(both) from 0.0222 to about 0.0260 against an
observed 0.1179, because 0.0222 → 0.0787 is F2/F3's marginal error squared and is much larger. F4's
reading is the later one and the measured one; it stands.

What was folded in, all of it into F2: the cause-1/2/3 separation, the before-and-after table for
the two fixes that shipped in `72566078`, the two diagnostic notes (the same-scorer construction
bug and the frozen baseline at `data/baselines/rp-calibration-2026-09.json`), and the negative-
binomial disposition.

**The headline figure to quote from now on is 2.06x, not 2.75x.** 2.75x is the pre-`72566078`
measurement. It reached commit `4bdb7717`'s subject line and this project's memory notes, and it
will keep surfacing from there; F2 above is the current number.

Nothing else about this audit's status changed. It stays open on F4, F8/F9, F12, F13 and F10's
display half.
