# Phase 2: Prediction Models — EPA & Sigma1 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-13
**Phase:** 2-Prediction Models — EPA & Sigma1
**Areas discussed:** Sigma1 state design, What ± actually means, EPA fidelity target, Season carryover & cold start, Head-to-head artifact shape, Per-match prediction storage, Team metric exposure

---

## Area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Sigma1 state design | What the Kalman filter estimates per team; identifiability | ✓ |
| What ± actually means | Estimate uncertainty vs performance spread | ✓ |
| EPA fidelity target | Faithful clone vs independent reimplementation | ✓ |
| Season carryover & cold start | Fresh vs carried ratings across seasons | ✓ |
| Head-to-head artifact shape | One artifact vs per-algorithm files | ✓ |
| Per-match prediction storage | Corpus table vs side artifact vs defer | ✓ |
| Team metric exposure | How per-team metrics leave opaque algorithm state | ✓ |

**User's choice:** All seven.

---

## Sigma1 state design

### Q1 — What should Sigma1's per-team state contain?

| Option | Description | Selected |
|--------|-------------|----------|
| 1D scalar contribution | One latent per team, unambiguously identifiable | |
| Contribution + consistency | Skill mean plus per-team observation noise | |
| Per-phase components | Auto/teleop/endgame from score_breakdown | |
| Start 1D, earn more | Ship 1D, add dimensions only if backtest justifies | |
| *(free text)* | Statbotics-style decomposition with variance per source | ✓ |

**User's choice:** Free text — "Statbotics tracks data for almost every data source FIRST offers, often broken down by game period and task type. Sigma1 should do something similar, within reason, when in doubt use the same results that statboics does. The difference is that Sigma1 tracks not just expected points but varience for each source."
**Notes:** Establishes the standing tiebreaker for the whole phase: when in doubt, match Statbotics; the differentiator is variance, not a different decomposition.

### Q2 — How far down should the decomposition go?

| Option | Description | Selected |
|--------|-------------|----------|
| Period + task type | Mirrors Statbotics; ~6–12 observables/season; 5 season maps | ✓ |
| Game period only | Auto/teleop/endgame; one parser for all seasons | |
| Every scoring field | Max fidelity, largest parser surface | |
| Period+task, phased in | Machinery now, one season's map, backfill later | |

**User's choice:** Period + task type.

### Q3 — How is a predicted alliance score assembled from components?

| Option | Description | Selected |
|--------|-------------|----------|
| Sum with covariance | Variance includes estimated component covariance | ✓ |
| Sum, assume independent | Simpler; understates uncertainty | |
| Components + own total | Separate total state; risks display inconsistency | |

**User's choice:** Sum with covariance.

### Q4 — How should fouls be treated?

| Option | Description | Selected |
|--------|-------------|----------|
| Model no-foul, add expected | Statbotics' approach: league foul rate multiplier | |
| No-foul throughout | Not comparable to actual totals | |
| Fouls as a component | Per-team "fouls committed" latent | ✓ |

**User's choice:** Fouls as a component.
**Notes:** Deliberate divergence from Statbotics, which uses `score * (1 + foul_rate)` with a season-level rate. Flagged in CONTEXT as the weakest component for identifiability; the SC-3 check must cover it.

### Q5 — What about matches with no score_breakdown?

| Option | Description | Selected |
|--------|-------------|----------|
| Total-only fallback update | Distribute residual by current expected shares | ✓ |
| Skip the update, keep predicting | Learns nothing from those matches | |
| Exclude entirely | Would score OPR and Sigma1 on different populations | |

**User's choice:** Total-only fallback update.

### Q6 — Does defense get any representation?

| Option | Description | Selected |
|--------|-------------|----------|
| No defense latent | Offense only; defense widens residual | ✓ |
| Defense as diagnostic only | Residual asymmetry as a stat, not a prediction input | |
| Opponent-side modifier | A defensive latent scaling opponent components | |

**User's choice:** No defense latent.
**Notes:** Direct application of the failure log's 4D-collapse lesson.

### Q7 — Process-noise model?

| Option | Description | Selected |
|--------|-------------|----------|
| Event-boundary bumps | Small within-event drift, larger between events | ✓ |
| Uniform per-match noise | One parameter, applied every match | |
| Time-based drift | Proportional to elapsed time from sort_time | |

**User's choice:** Event-boundary bumps.

### Q8 — How should elimination matches be handled?

| Option | Description | Selected |
|--------|-------------|----------|
| Predict but don't learn | Keeps rating stream qual-only | |
| Learn from them normally | Ordinary observations | ✓ |
| Learn with extra noise | Update with inflated observation noise | |

**User's choice:** Learn from them normally.
**Notes:** Diverges from Statbotics, which applies `ELIM_WEIGHT = 1/3` and does not increment its match counter on elims.

---

## What ± actually means

### Q1 — What is the ± on a team page?

| Option | Description | Selected |
|--------|-------------|----------|
| Our uncertainty | Kalman state variance; shrinks with matches | |
| Their consistency | Match-to-match performance spread | ✓ |
| Both, labeled | Display both quantities separately | |

**User's choice:** Their consistency.

### Q2 — Should match-prediction variance include estimate uncertainty?

| Option | Description | Selected |
|--------|-------------|----------|
| Both — full predictive variance | Estimate uncertainty + performance spread | ✓ |
| Consistency only | Same number everywhere; overconfident early season | |

**User's choice:** Both — full predictive variance.
**Notes:** Team-page ± and match-prediction ± are deliberately different quantities and must be labeled as such.

### Q3 — How to report ± for thin match histories?

| Option | Description | Selected |
|--------|-------------|----------|
| Shrink to league average | Empirical-Bayes blend weighted by match count | ✓ |
| Report it raw | Implausibly tiny ± off two matches | |
| Withhold below a threshold | Ragged early-season site | |

**User's choice:** Shrink to league average.

### Q4 — How should win probability come out of two score distributions?

**Research performed before this question at the user's request** ("lets do more reasearch on that question. how does statbotics do it? rememeber the whole goal is to maximize match prediction accuracy"). Statbotics' source was pulled directly from GitHub since their blog returns 403. Finding: `norm_diff = (red_score − blue_score) / year.score_sd; win_prob = 1 / (1 + 10 ** (k * norm_diff))` with `k = −5/8`. Their per-alliance `pred_sd` line is commented out immediately above, and `EPARating` carries only a mean.

| Option | Description | Selected |
|--------|-------------|----------|
| Nested form, harness decides | σ(margin / (c·√variance)); collapses to Statbotics' form | ✓ |
| Normal CDF, analytic | Derived, no fitted constant | |
| Match Statbotics exactly | Discards per-match variance entirely | |

**User's choice:** "lets do nested form but I would like to come back and try normal CDF at some point. I do not know enough about statistics to make a call."
**Notes:** Resolved by shipping the link function as a 3-mode pluggable strategy (Statbotics parity / nested / normal CDF) so the revisit is a flag flip and a harness row. The tune-season Brier scores decide, not intuition.

---

## EPA fidelity target

### Q1 — How faithful should our EPA be?

| Option | Description | Selected |
|--------|-------------|----------|
| Faithful clone | Port their constants and per-season quirks | |
| Faithful core, our plumbing | Match the algorithm, use our own extraction | ✓ |
| EPA-family, independent | Don't chase their numbers | |

**User's choice:** Faithful core, our plumbing.
**Notes:** Every deliberate divergence must be documented with its reasoning.

### Q2 — Where do SC-2's reference numbers come from?

**Verified live during the discussion:** all `api.statbotics.io/v3` endpoints return HTTP 500; v2 returns 404; the website returns 200 but is a client-rendered shell fed by the dead API.

| Option | Description | Selected |
|--------|-------------|----------|
| Run their model ourselves | Execute their pinned Python model on our corpus | |
| Archived snapshots | Wayback values for spot-check teams | |
| Defer the check | Mark blocked, revisit if the API returns | ✓ |

**User's choice:** Defer the check.

### Q3 — How should Success Criterion 2 be handled?

| Option | Description | Selected |
|--------|-------------|----------|
| Rewrite to fidelity-of-algorithm | Restate as documented-divergences criterion | |
| Keep it, expect blocked | Leave SC-2 as written; verification marks it blocked | ✓ |
| Rewrite to self-consistency | Restate around our own corpus only | |

**User's choice:** Keep it, expect blocked.
**Notes:** Preserves original intent and leaves a visible, honest gap rather than redefining success to fit what's achievable.

### Q4 — What should the report's Statbotics accuracy row show?

| Option | Description | Selected |
|--------|-------------|----------|
| Keep, mark unverified | Make unverified status visually loud | ✓ |
| Show unavailable | Render no number at all | |
| Leave it alone this phase | Treat as Phase 1 residue | |

**User's choice:** Keep, mark unverified.

---

## Season carryover & cold start

### Q1 — Should ratings carry across season boundaries?

| Option | Description | Selected |
|--------|-------------|----------|
| Carry, Statbotics-style | Init from prior seasons with mean reversion | |
| Carry, with widened ± | Same, plus offseason variance inflation | |
| Fresh every season | Independent seasons, unchanged harness | |
| *(free text)* | Carry, with carry behavior as tunable globals | ✓ |

**User's choice:** "carry, but tune the cary with global hyper parameters to maximize accuracy"
**Notes:** Phase 2 ships documented defaults; Phase 3 searches them.

### Q2 — Burn-in season for 2022's cold start?

| Option | Description | Selected |
|--------|-------------|----------|
| Ingest 2019 as burn-in | Warm ratings, never scored or shown | |
| No burn-in, document it | Accept the asymmetry; 2022 is a tune season | ✓ |
| Burn-in on 2022 itself | Exclude early 2022 weeks from scoring | |

**User's choice:** "No burn in, remember once we prove this is working well we are going to recompute starting in 2016. in the future 2016 will be the cold start. for now 2022 will be the cold start"
**Notes:** Major forward-looking constraint — the cold-start season must be a parameter, and per-season component maps must be additive. Noted that 2016 aligns with where Statbotics' own code begins branching `year >= 2016`.

### Q3 — Does consistency carry across seasons too?

| Option | Description | Selected |
|--------|-------------|----------|
| Carry, also tunable | Own decay parameter alongside the mean's | ✓ |
| Reset consistency each season | Learn spread fresh each year | |

**User's choice:** Carry, also tunable.

---

## Head-to-head artifact shape

### Q1 — How should a multi-algorithm run be shaped?

| Option | Description | Selected |
|--------|-------------|----------|
| One artifact, many algorithms | Schema v2; run-level provenance, tagged slices | ✓ (on recommendation) |
| Per-algorithm + comparison file | Nothing breaks; Phase 8 joins N files | |
| One artifact, algorithm-keyed | Map of algorithmId to existing body | |

**User's choice:** "what do you reccomend for this?" → Claude recommended one artifact, many algorithms; user did not object.
**Notes:** Rationale recorded in CONTEXT D-20 — SC-1 asks for one table from one run, Phase 8 renders algorithm × year in one grid, run-level facts can't drift, and breaking now is free while the only consumer is our own report.

### Q2 — Should the artifact carry precomputed comparisons?

| Option | Description | Selected |
|--------|-------------|----------|
| Raw numbers only | Comparisons computed by the renderer | ✓ |
| Include deltas vs baseline | Deltas precomputed into the artifact | |
| Deltas plus significance | Adds a significance method | |

**User's choice:** Raw numbers only.

### Q3 — Shared stream or sequential passes?

| Option | Description | Selected |
|--------|-------------|----------|
| Shared stream, parallel states | One pass; byte-identical inputs for all algorithms | ✓ |
| Sequential per-algorithm passes | Minimal code change; N passes | |

**User's choice:** Shared stream, parallel states.

---

## Per-match prediction storage

### Q1 — Where do per-match predictions live?

| Option | Description | Selected |
|--------|-------------|----------|
| Corpus table, keyed by algorithm | Queryable; needs a write path | |
| Side artifact per run | Keeps corpus ingested-facts-only and read-only | ✓ |
| Defer to Phase 4 | SC-4 hard to demonstrate | |

**User's choice:** Side artifact per run.

### Q2 — What does each prediction record contain?

| Option | Description | Selected |
|--------|-------------|----------|
| Totals + variance | Exactly ALGO-07, most compact | |
| Totals + component vectors | ~10× size; feeds Phase 7 and makes components debuggable | ✓ |
| Totals, components on flag | Two output shapes to keep in sync | |

**User's choice:** Totals + component vectors.

### Q3 — How should prediction files be organized?

| Option | Description | Selected |
|--------|-------------|----------|
| One file per season | Bounded, streamable, matches Phase 4's read pattern | ✓ (delegated) |
| Per season per algorithm | Smallest units; fragments head-to-head comparison | |
| One file per run | One large file to scan | |

**User's choice:** "use your best judgement" → Claude chose one JSONL file per season, all algorithms interleaved.

---

## Team metric exposure

### Q1 — How do per-team metrics leave algorithm state?

| Option | Description | Selected |
|--------|-------------|----------|
| teamMetrics(state) on the contract | Typed accessor returning plain data | ✓ (delegated) |
| Snapshot at write time only | Per-algorithm adapters, no contract change | |
| Metrics as a stream of events | Time-series for free; heavier contract | |

**User's choice:** "use your best judgement" → Claude chose `teamMetrics(state)` on the contract.
**Notes:** Required by SC-3 regardless; keeps S opaque and predict/update pure; return type must stay plain data so `packages/core` remains Worker-importable. Makes the event-stream option unnecessary since the simulator already steps match by match.

### Q2 — Capture per-team metric history in Phase 2?

| Option | Description | Selected |
|--------|-------------|----------|
| Capture history now | Snapshot the 6 involved teams after each match | ✓ |
| End state only | Tightest scope; Phase 4 regenerates | |
| History behind a flag | Extra code path to test | |

**User's choice:** Capture history now.
**Notes:** Producing the data is Phase 2; rendering it (TEAM-04, TEAM-06) remains Phase 6.

---

## Claude's Discretion

- Prediction file layout and naming (explicitly delegated).
- The team-metrics exposure mechanism (explicitly delegated).
- The multi-algorithm artifact shape (user asked for a recommendation).
- Exact per-season component lists for 2022–2026; the covariance estimator; shrinkage math and hyperparameter defaults; residual distribution in the total-only fallback; module layout, JSONL record schema, and CLI flag design; how the identifiability check is structured; whether the harness slices accuracy by early- vs late-season.

## Deferred Ideas

- Normal-CDF win probability — revisit once tune-season numbers exist (kept to a flag flip by the 3-mode link function).
- Recompute the corpus from 2016, making it the new cold-start season (maps to ENH-04).
- Statbotics per-team numeric tolerance check (SC-2) — blocked on their API returning.
- A sourced, verified Statbotics accuracy reference row to replace Phase 1's unverified stub.
- Defense as a diagnostic statistic (per-team residual asymmetry) — rejected as a latent, noted as a possible team-page stat.
