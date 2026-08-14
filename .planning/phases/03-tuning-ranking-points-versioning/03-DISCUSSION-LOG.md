# Phase 3: Tuning, Ranking Points & Versioning - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-14
**Phase:** 3-Tuning, Ranking Points & Versioning
**Areas discussed:** Tuning target & the bar, Online adaptation, RP prediction shape, Versioning & reproducibility

**Area selection:** All four offered gray areas were selected for discussion.

---

## Tuning target & the bar

### Q1 — What does the offline optimizer actually maximize on the tune seasons?

| Option | Description | Selected |
|--------|-------------|----------|
| Brier, accuracy reported | Search minimizes tune-season Brier; winner accuracy reported every evaluation but never steers. Proper scoring rule, smooth signal, rewards calibration. Risk: can buy Brier while leaving the accuracy gap untouched | ✓ |
| Winner accuracy directly | Maximizes D-10's headline metric and SC-3's actual weak spot. Risk: step-function objective, plateaus, rerun-unstable | |
| Brier, accuracy as a floor | Minimize Brier subject to accuracy not falling below the untuned default — lexicographic | |

**User's choice:** Brier steers, accuracy reported.
**Notes:** Recommended option. The named risk is carried forward explicitly in CONTEXT.md D-01 as something to watch, since Q2 then made accuracy part of the verdict.

### Q2 — What is SC-3's bar, given Sigma1 wins holdout Brier but loses holdout accuracy?

| Option | Description | Selected |
|--------|-------------|----------|
| Both, shortfall recorded | Literal SC-3 — both metrics on both holdout seasons; a shortfall is written up with a named decision, never a redefinition | ✓ |
| Brier is the bar | Beat both on Brier; publish accuracy honestly even where OPR leads. Argues 0.7819 vs 0.7825 is noise | |
| Accuracy is the bar | D-10 named accuracy the headline; Brier supports it. In tension with the Brier-steered search | |

**User's choice:** Literal SC-3, shortfall recorded.
**Notes:** Consistent with three existing project precedents (SC-2 recorded blocked rather than reworded; identifiability prose corrected to match the committed script; CR-01 fix re-run in full rather than asserted from cache).

### Q3 — How wide is the search space?

| Option | Description | Selected |
|--------|-------------|----------|
| Screen, then joint | One-at-a-time sensitivity sweep over every tagged constant, published as its own artifact; then joint search over survivors only | ✓ |
| Joint search over everything | Random/Bayesian across all ~12 dimensions at once. Honest about interactions; risks fitting three seasons' noise with no visibility into which dimension earned the gain | |
| Staged by group | Coordinate descent by conceptual group, re-looping until stable | |

**User's choice:** Screen, then joint.
**Notes:** Recommended option. Direct application of the failure log's unidentifiable-model lesson; the screen is a publishable standalone result.

### Q4 — Do the baselines get tuned too?

| Option | Description | Selected |
|--------|-------------|----------|
| Freeze EPA and OPR | Only Sigma1 tuned. EPA stays at Statbotics' own published constants, so "beats EPA" means beats what Statbotics ships. Requires splitting carryover.ts | ✓ |
| Tune EPA too, separately | Tuned-vs-tuned headline. Costs a second search; the result is no longer the Statbotics reimplementation | |
| Tune shared carry jointly | Simplest code, but EPA's numbers move as a side effect and the baseline drifts | |

**User's choice:** Freeze EPA and OPR.
**Notes:** Raised during discussion — `carryover.ts` currently shares `EPA_NORM_MEAN`/`EPA_NORM_SD`/`EPA_INIT_PENALTY`/`EPA_MEAN_REVERSION`/`YEAR_ONE_WEIGHT` between EPA and Sigma1 (`carrySeason` reuses `epaCarryover` unchanged), so this choice forces a structural split before tuning can begin.

**Parked as discretion:** overfitting guard (leave-one-season-out vs internal split); structural enforcement of holdout blindness.

---

## Online adaptation

### Q1 — What does "adapts online within a season" mean concretely?

| Option | Description | Selected |
|--------|-------------|----------|
| Innovation-driven noise | Process (and optionally measurement) noise scales from a team's own recent innovation statistics; "off" pins both at tuned constants | ✓ |
| Mid-season re-tuning | Periodically re-run a small search on the season so far and swap parameters in. Cannot run in a Worker; new leakage surface per re-tune | |
| League-scale adaptation | Formalize/extend the league aggregates. Largely already shipped in Sigma1League/ExpandingStats | |

**User's choice:** Innovation-driven noise adaptation.
**Notes:** The framing question was raised first — Sigma1 already adapts state via the Kalman filter and already grows league aggregates, so without a definition the on/off comparison would be vacuous.

### Q2 — How do the tuner and the on/off comparison interact?

| Option | Description | Selected |
|--------|-------------|----------|
| Two searches, best-vs-best | Optimizer run twice, each configuration's own best compared on holdout | ✓ |
| Tune on, reuse for off | One search; off-run replays the same parameters with adaptation disabled. Off-run runs handicapped | |
| Tune off, then enable | Mirror-image bias; leaves adaptation's own knobs untuned | |

**User's choice:** Two searches, best-vs-best.
**Notes:** Affordable — measured Sigma1 update cost puts a full tune-season replay near a minute, so a second search costs minutes.

### Q3 — At what granularity does adaptation operate?

| Option | Description | Selected |
|--------|-------------|----------|
| Per team, one factor | One scalar per team across all its components, from aggregate innovation history | ✓ |
| Per team, per component | Richest; multiplies free parameters by ~13 over sparse per-team data — the failure log's shape | |
| League-level only | Best-identified, nearly free, cannot express that a specific team is in a changing regime | |

**User's choice:** Per team, one scalar factor.

### Q4 — What ships if adaptation does not improve holdout score?

| Option | Description | Selected |
|--------|-------------|----------|
| Ships off, kept and recorded | Code stays behind its flag, default has it disabled, negative result written up as a finding | ✓ |
| Iterate until it wins | Try alternative formulations until one beats the static baseline | |
| Cut it entirely | Delete the code, mark ALGO-05 measured-and-rejected | |

**User's choice:** Ships off, kept, negative result published.
**Notes:** ALGO-05 asks the harness to validate *whether* adaptation improves predictions — a measured "no" satisfies it.

---

## RP prediction shape

Framing raised before questions: the RP bonus flags are already present in `score_breakdown_raw` but stripped by the component maps' Zod schemas, while FRC bonus RPs are threshold rules stated in **counts** and Sigma1's entire state is in **point** units (`2026.ts` documents that `hubScore.*Count` fields are never read).

### Q1 — What produces a predicted bonus RP?

| Option | Description | Selected |
|--------|-------------|----------|
| Parallel count state | Extract only the count fields the RP rules threshold on into a separate per-team Kalman state, leaving the score-component vector and identifiability write-up untouched; apply the manual's real threshold | ✓ |
| Rules over point components | Map each threshold into a point-unit proxy. Cheapest; every rule becomes an approximation with a fudge factor | |
| Learn achievement directly | Per-team propensity per bonus learned from the recorded 0/1 flags. Sparse binary latent, no explanation of why | |

**User's choice:** Parallel count state.

### Q2 — What does the prediction record carry?

| Option | Description | Selected |
|--------|-------------|----------|
| Full pmf, ± derived | Store P(RP = 0..N) per alliance; site derives mean/SD, Phase 8's simulation draws from the exact distribution | ✓ |
| Mean and variance only | Smallest record; forces Phase 8 to draw Gaussian and round, producing impossible RP values | |
| Both, pmf plus summary | Two representations of one fact that can drift — the failure mode D-21 avoided | |

**User's choice:** Full pmf, ± derived from it.

### Q3 — How is the win/bonus correlation handled?

| Option | Description | Selected |
|--------|-------------|----------|
| Joint model | One set of draws from the joint predictive distribution produces score, opponent score, and counts together, so correlation falls out | ✓ |
| Independence, closed form | Exact and Worker-fast, but wrong in a known direction that propagates into Phase 8's rank simulation | |
| Independence plus correction | Closed form with per-season fitted correlation constants — a third category of number to version and defend | |

**User's choice:** Joint model.
**Notes:** Flagged during discussion — a per-match Monte Carlo is trivial offline but must be checked against Phase 4's 10 ms Worker budget.

### Q4 — How is SC-4's manual verification discharged?

| Option | Description | Selected |
|--------|-------------|----------|
| Manual authors, corpus tests | Manual cited by section as the authoring source; the test recomputes every bonus flag from raw fields and asserts it reproduces TBA's own recorded flag for 100% of played matches | ✓ |
| Manual citation only | Reviewed by eye at verification — the documentation-drift posture the failure log warns about | |
| Corpus reconciliation only | Reverse-engineer rules until they match the data; can encode a coincidence, and 2027 has no data to fit against | |

**User's choice:** Manual authors, corpus reconciliation tests.

**Parked as discretion:** which count fields each season needs; count-state initialization and season carry; Monte Carlo draw count; RP for elimination matches and for the ~1.5% of matches with no `score_breakdown`.

---

## Versioning & reproducibility

### Q1 — What IS an algorithm version?

| Option | Description | Selected |
|--------|-------------|----------|
| Code + named param set | A code version paired with a named, committed parameter set written by the tuner as data; re-tuning is a data change, and the parameter file is git-diffable | ✓ |
| Frozen module per version | A version is a file. Unambiguous, but every re-tune duplicates a module and bug fixes must be withheld from old versions | |
| Content hash | Nothing hand-maintained, but opaque in the site's dropdown and churned by cosmetic changes | |

**User's choice:** Code version + named committed parameter set.

### Q2 — Which parameter sets become versions?

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit promotion | A search evaluation is an experiment; promotion under a name with provenance makes it a version. Only promoted versions carry SC-5's guarantee | ✓ |
| Every search result versioned | Complete audit trail; turns hundreds of throwaway configs into versioned surface | |
| Only shipped versions | Smallest surface, but Phase 3's own output would have no durable identity until Phase 4 | |

**User's choice:** Explicit promotion.

### Q3 — How is SC-5 proven?

| Option | Description | Selected |
|--------|-------------|----------|
| Committed digest, CI test | Each promoted version commits headline metrics plus a hash over its prediction stream; a test re-runs it on a bounded deterministic slice and asserts both | ✓ |
| Full-corpus re-run at verification | Proves the literal claim across every match; hours per version, so drift can live unnoticed | |
| Both tiers | Fast test plus a full reproduction gate on promotion | |

**User's choice:** Committed digest plus CI test.
**Notes:** Constraint surfaced during discussion — `reports/` and `data/` are gitignored per the failure log, so committing a full reference artifact was never an option; the digest is a few hundred bytes.

### Q4 — What standard does "unchanged" hold to?

| Option | Description | Selected |
|--------|-------------|----------|
| Bitwise, seed in version | Byte-identical on re-run; PRNG seed is part of the parameter set, `Math.random` banned from the prediction path, stable iteration order | ✓ |
| Tolerance-based | Metrics to a stated precision; digest cannot be a hash, and small regressions hide under the tolerance | |
| No sampling in prediction path | Deterministic numerical integration instead of Monte Carlo. Cleanest, also removes the cost from Phase 4's budget; harder to write for a correlated distribution | |

**User's choice:** Bitwise, seed versioned as a parameter.
**Notes:** Directly interacts with the RP joint-model choice, which puts an RNG in the prediction path. Option 3 was carried into CONTEXT.md as an open implementation route rather than a rejected one.

---

## Claude's Discretion

- Overfitting guard for tune seasons (leave-one-season-out vs internal validation split).
- Whether holdout blindness is enforced structurally in code, following the `toLeakProofUpcoming` precedent (recommended, not locked).
- Search algorithm, evaluation count, parallelism, and where the search runs.
- Adaptation details: innovation window length, stability bounds on the adaptation factor, whether adaptation touches the D-09 consistency estimate, registry naming for the on/off pair.
- RP details: per-season count fields, count-state initialization and season carry, Monte Carlo draw count, elimination matches, no-breakdown matches.
- Whether `ARTIFACT_SCHEMA_VERSION` bumps to 3 for RP and version identity, and the prediction-record JSONL shape.
- Naming for the untuned vs tuned Sigma1 in the registry and eventual dropdown.
- Whether the sensitivity screen's output gets its own committed document (recommended).

## Deferred Ideas

- Deterministic numerical integration for the RP pmf (open implementation route, not a later phase).
- Full-corpus reproduction as an automated promotion gate (kept available as a manual step).
- Tuning EPA as a second, separately-budgeted search (rejected here; revisit only as its own question).
- Per-team-per-component adaptation (blocked on an identifiability argument, not on scope).
- Defense as a diagnostic (carried from Phase 2, still not this phase).
- Recompute the corpus from 2016 (ENH-04, v2) — D-19's parameterization constraint continues to bind, now extending to the new RP rule modules.
- A sourced, verified Statbotics accuracy reference row (WINDOWS entry 1, still open).

## Scope Creep

None — discussion stayed within the phase boundary throughout.
