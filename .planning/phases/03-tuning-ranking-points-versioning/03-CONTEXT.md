# Phase 3: Tuning, Ranking Points & Versioning - Context

**Gathered:** 2026-08-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Four deliverables on top of Phase 2's three working algorithms:

1. **ALGO-04** — An offline optimizer that searches Sigma1's hyperparameters against tune-season backtest score and writes the winning configuration as a named, reproducible algorithm version.
2. **ALGO-05** — Within-season online adaptation for Sigma1, with the harness reporting adaptation-on vs adaptation-off holdout scores side by side.
3. **ALGO-06** — Algorithm versioning as a first-class concept in the data model, such that any past version replays identically.
4. **ALGO-08** — Predicted ranking points with variance for both alliances of every match, under each season's own RP rules for 2022–2026.

Plus the adjudication of **SC-3**: does tuned Sigma1's holdout Brier *and* winner accuracy beat both OPR and EPA — or is the shortfall recorded with an explicit decision?

Explicitly NOT in this phase: published artifacts, R2/KV storage, the cron updater, and Worker CPU budgeting (Phase 4); any UI, including the algorithm-version dropdown that will consume ALGO-06 (Phases 5–8); extending the corpus back to 2016 (v2, ENH-04). Phase 3 produces versioned numbers and the machinery that makes them reproducible; Phase 4 publishes them.

</domain>

<decisions>
## Implementation Decisions

### The tuning objective and the bar

- **D-01:** The optimizer **minimizes tune-season Brier score**. Winner accuracy is computed and reported at every evaluation but never steers the search. Rationale: Brier is a proper scoring rule with a smooth, gradient-rich signal that rewards exactly the calibration Sigma1 exists to exploit; winner accuracy is a step function where most parameter nudges flip zero matches, producing a plateau-heavy and rerun-unstable search. The known risk is accepted and must be watched: a Brier-steered search can buy calibration without closing the winner-accuracy gap to OPR.
- **D-02:** **SC-3 keeps its literal reading** — tuned Sigma1 must beat both OPR and EPA on holdout Brier *and* holdout winner accuracy, on both holdout seasons. If tuning closes Brier but not accuracy, that is written up as an **explicit recorded shortfall with a named decision about what to change** — never a redefinition of the criterion to fit the result. This follows the precedent already set by D-14 (SC-2 recorded blocked rather than reworded) and by the 02-06 identifiability correction (the write-up was corrected to match the committed script, not the reverse). — **Reversibility:** costly — this is the claim the whole project's core value rests on; softening it later after numbers are known would be indistinguishable from moving the goalposts.
  - Starting position, from `reports/full-v2` (Phase 2): Sigma1 already **wins** holdout Brier on both seasons (2025: 0.1662 vs OPR 0.1675; 2026: 0.1554 vs OPR 0.1773) and **loses** holdout winner accuracy on both (2025: 0.7539 vs OPR 0.7618; 2026: 0.7819 vs OPR 0.7825). Winner accuracy is the live gap.
- **D-03:** Search proceeds in two stages: **(a) a one-at-a-time sensitivity screen** over every constant tagged "Phase 3 hyperparameter, default unverified", published as its own artifact answering "which knobs are actually live"; then **(b) a joint search over only the survivors**. Rationale: this is the direct application of the failure log's unidentifiable-model lesson — do not optimize dimensions the data cannot distinguish — and the screen is a genuinely useful standalone result. Accepted tradeoff: a one-at-a-time screen can miss a parameter that only matters in interaction; the joint stage over survivors recovers interactions among the ones that individually mattered, not among the ones that didn't.
- **D-04:** **Only Sigma1 is tuned. EPA and OPR stay frozen at their Phase 2 defaults** as fixed baselines. Rationale: EPA's constants are Statbotics' *own published, already-tuned* values (`NORM_MEAN` 1500, `MEAN_REVERSION` 0.4, `YEAR_ONE_WEIGHT` 0.7), so "beats EPA" means "beats what Statbotics actually ships" — tuning EPA would produce our own EPA variant and dissolve the Statbotics-comparison story that the project's core value depends on. — **Reversibility:** costly — every SC-3 number is measured against these baselines; changing them invalidates the comparison and every published figure derived from it.
  - **Structural consequence:** `packages/core/algorithms/carryover.ts` currently owns `EPA_NORM_MEAN` / `EPA_NORM_SD` / `EPA_INIT_PENALTY` / `EPA_MEAN_REVERSION` / `YEAR_ONE_WEIGHT`, and Sigma1's `carrySeason` reuses `epaCarryover` **unchanged**. Tuning any carry parameter today would move EPA's predictions as a side effect. The module must be split so Sigma1 carries its own tunable copy while EPA's stay pinned.

### Online adaptation (ALGO-05)

- **D-05:** "Adapts online within a season" means **innovation-driven noise adaptation**: process noise (and optionally measurement noise) scales from each team's own recent innovation/residual statistics, so a team whose results keep surprising the filter gets a more responsive filter and a metronomic team gets a stiffer one. Adaptation-**off** simply pins both at their tuned constants. Rationale: this is the classical adaptive-Kalman meaning and is genuinely new capability. The two alternatives were rejected explicitly — mid-season re-tuning cannot run inside a Worker invocation and opens a new leakage surface per re-tune; league-scale adaptation is largely already shipped in `Sigma1League`'s `ExpandingStats`, which would make the on/off comparison a measurement of Phase 2's code.
- **D-06:** The on/off comparison is **two independent optimizer runs compared best-vs-best** — one search with adaptation on (searching its own extra knobs too), one with it off — each configuration's own best measured against the other's on holdout. Rationale: any single-search variant biases the answer, because the config was chosen to suit whichever mode was active during the search. A second search costs minutes (Sigma1's measured update cost is ~0.9–1.3 ms/match, so a full 2022–2024 tune replay is on the order of a minute), so fairness is nearly free here.
- **D-07:** Adaptation operates at **one scalar factor per team**, shared across that team's components, estimated from the team's aggregate innovation history. Per-team-per-component was considered and rejected: it multiplies free parameters by ~13 over data that is already sparse per team, which is structurally the same trap as the failure log's collapsed 4D model. League-level-only was rejected as too weak to express that a specific team is in a changing regime, which is where the value is.
- **D-08:** **If best-vs-best shows adaptation does not improve holdout score, it ships disabled and the negative result is written up as a finding.** The code stays in the tree behind its flag; the default promoted version has adaptation off. ALGO-05 asks the harness to *validate whether* adaptation improves predictions — an honest measured "no" satisfies it. Explicitly rejected: iterating on adaptation designs until one beats the static baseline, which is tuning until the answer is the desired one.

### Ranking-point prediction (ALGO-08)

- **D-09:** Bonus RP prediction runs off a **parallel count-unit Kalman state, kept separate from the score-component vector**. Each season's map is extended to extract only the count fields its RP rules actually threshold on; those are tracked in their own per-team state; the manual's real threshold is then applied to the predicted count distribution. Rationale: FRC bonus RPs are threshold rules stated in **counts**, while Sigma1's entire existing state is in **point** units (`2026.ts` explicitly documents that `hubScore.*Count` fields "are counts, not points, and are never read"). Keeping the count state separate means the score-component reconciliation invariant (`reconciliation.test.ts`) and the SC-3 identifiability write-up (`docs/models/sigma1-identifiability.md`) are untouched by this phase. — **Reversibility:** costly — this defines a second state vector that must be initialized, carried across seasons, versioned, tuned, and rendered; folding it into the score vector later would re-open the identifiability argument.
  - Rejected: point-unit proxies for count thresholds (every season's rule becomes an approximation with a fudge factor, indefensible against SC-4's "verified against the manual"); learning bonus achievement directly as a per-team binary propensity (a new sparse latent per bonus per season with no explanation of why — the shape the failure log warns about).
- **D-10:** Each alliance's RP prediction carries the **full discrete pmf, `P(RP = 0..N)`**; mean and standard deviation are **derived** from it for the site's `± ` display. Rationale: RP is a small integer, so the pmf is a handful of numbers; Phase 8's 1000-run simulation can then draw from the exact distribution instead of rounding Gaussian samples (which can produce impossible RP values and skew the rank distribution). Storing both the pmf and a precomputed summary was rejected as two representations of one fact that can drift — the same reasoning as D-21's raw-numbers-only artifact rule.
- **D-11:** **Winning and clearing bonus thresholds are modeled as correlated, via a joint model.** One set of draws from the joint predictive distribution produces the alliance's score, the opponent's score, and its counts together, so the correlation falls out rather than being asserted. Rationale: a dominant alliance both wins and clears its bonuses; independence would systematically understate `P(maximum RP)` for strong alliances and overstate it for weak ones, and that bias propagates directly into Phase 8's rank simulation. This is D-03's component-covariance reasoning applied to RP. **Flagged for Phase 4:** a per-match Monte Carlo is trivial offline but must be checked against the 10 ms Worker CPU budget on the incremental path.
- **D-12:** SC-4's "verified against the official 2022–2026 game manuals" is discharged **two ways: the manual is the authoring source (cited by section in each rule module), and a corpus-wide reconciliation is the test.** Every bonus flag is recomputed from the raw breakdown fields and asserted to reproduce TBA's own recorded flag — `cargoBonusRankingPoint` / `hangarBonusRankingPoint` (2022), `melodyBonusAchieved` (2024), `energizedAchieved` / `superchargedAchieved` / `traversalAchieved` (2026), and each season's equivalents — for 100% of played matches, with summed RP reproducing `red_rp_earned` / `blue_rp_earned`. Rationale: these flags are already present in `score_breakdown_raw` (currently stripped by the Zod schemas' default strip mode), so ground truth is free. This makes a manual misreading fail a test rather than sit in prose — the same shape as the existing `reconciliation.test.ts` invariant, and the direct answer to the failure log's documentation-drift entry.

### Algorithm versioning and reproducibility (ALGO-06)

- **D-13:** **A version is a code version paired with a named, committed parameter set** (e.g. `sigma1@2.1` = code 2.x + params `tuned-2026-08`). The tuner writes parameter sets out as data; re-tuning produces a new version with zero code duplication, and the parameter file is a reviewable, git-diffable artifact. Rejected: a frozen module per version (every re-tune duplicates a module, and shared bug fixes must then be deliberately withheld from old versions to keep them reproducible); content hashing (opaque in the site's algorithm dropdown and in URLs, and cosmetic code changes churn identity). — **Reversibility:** one-way — this is the identity scheme the Phase 4 artifacts, the Phase 5 dropdown, and the Phase 8 Compare page all key on; changing it after publication requires migrating every published artifact.
- **D-14:** **A search evaluation is an experiment, not a version.** A parameter set becomes a version only by **explicit promotion** — committed under a name with its provenance (which search produced it, on which corpus, scoring what). Only promoted versions carry SC-5's reproducibility guarantee and appear in the site's dropdown. Search results are logged for the record but are not part of the versioned surface. Rationale: the screen plus joint search will evaluate hundreds of parameter sets; versioning all of them would make SC-5 an enormous and pointless promise.
- **D-15:** SC-5 is proven by a **committed digest plus a CI test**: each promoted version commits a small fingerprint — its headline metrics per season plus a hash over its full prediction stream — and a test re-runs that version on a bounded deterministic slice and asserts both match. Rationale: catches drift on the commit that introduces it, and commits a few hundred bytes rather than a generated artifact (`reports/` and `data/` are gitignored per the failure log's repo-hygiene rule). Accepted tradeoff: the bounded slice proves the code path, not literally every match. A full-corpus re-run per version was rejected as a CI gate (hours per version) but remains available as a manual verification-time check.
- **D-16:** **"Unchanged" means bitwise identical.** The PRNG seed is part of the parameter set and therefore versioned like any other parameter; `Math.random` is banned from the prediction path; iteration order must be stable. Rationale: this is what makes D-15's digest a real hash, and it makes accidental nondeterminism fail loudly instead of hiding inside sampling noise. Note the direct interaction with D-11 — the RP joint model puts an RNG in the prediction path, so seeding it is load-bearing, not hygiene. (Implementing D-11 by deterministic numerical integration instead of sampling would satisfy this trivially and would also remove the Monte Carlo cost from Phase 4's budget; that route is open to the planner but is not required.)

### Claude's Discretion

- **Overfitting guard for the tune seasons** — leave-one-season-out across 2022–2024 vs an internal validation split vs something else. Deliberately parked; pick what best protects against fitting three seasons' noise, given D-01's Brier objective.
- **Whether holdout blindness is enforced structurally** — the project's `toLeakProofUpcoming` precedent suggests making it *impossible* for the optimizer to read 2025/2026 rather than merely conventional. Recommended, not locked.
- **Search algorithm and compute budget** — grid vs random vs Bayesian/CMA-ES, evaluation count, parallelism, and where the search runs. Grounding: Sigma1's measured per-match update cost is ~0.9–1.3 ms (`02-06-SUMMARY.md`), so a full 2022–2024 tune replay is roughly a minute; the 3-hour Phase 2 run was OPR's O(n²) solve dominating, and OPR is not in the search.
- **Adaptation details** — innovation window length, stability bounds on the adaptation factor (an unbounded adaptive filter can destabilize), whether adaptation also touches the D-09 consistency estimate the site publishes as `±`, and how the on/off pair is registered in the `ALGORITHMS` registry.
- **RP details** — which count fields each of 2022–2026 needs, how the count state is initialized and carried across season boundaries, Monte Carlo draw count (or the deterministic alternative), **RP handling for elimination matches** (which have no RP in FRC) and for the ~1.5% of matches with `has_score_breakdown = 0` where D-05's fallback applies.
- **Artifact schema evolution** — whether RP predictions and richer version identity require `ARTIFACT_SCHEMA_VERSION` 3, and what the prediction-record JSONL shape becomes. D-20's reasoning applies: breaking this is nearly free now and expensive after Phase 4 publishes.
- **Naming** — what the untuned Phase 2 Sigma1 and the tuned Phase 3 Sigma1 are each called in the registry and eventually in the site's dropdown.
- **Whether the sensitivity screen's output gets its own committed document** (recommended — it is a real result, not scaffolding).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product spec & mandate
- `REBUILD_SPEC.md` — Product spec, clean-slate mandate (do NOT consult or port pre-v3 code, models, or **tuned values** — git tag `v2-poc` is off-limits; this phase produces tuned values and must derive them independently), and the failure log. Three entries bear directly on this phase: **"Unidentifiable model"** (D-03, D-07, D-09 are the response), **"Documentation drift and zero tests"** (D-12, D-15), and **"keep generated artifacts out of git"** (D-15).

### Prior phase context — locked decisions that still bind
- `.planning/phases/02-prediction-models-epa-sigma1/02-CONTEXT.md` — Every Phase 2 decision. Load-bearing here: **D-07** (event-boundary process-noise bumps, magnitudes explicitly deferred to this phase), **D-09/D-10** (what `±` means — team-page consistency vs match predictive variance; both must stay distinct through tuning), **D-11** (shrinkage blend rate, deferred here), **D-12** (three win-probability link modes, `SIGMA1_LINK_C` deferred here), **D-16/D-17** (carryover and consistency-carry decay, deferred here — see D-04 above for the `carryover.ts` split this forces), **D-19** (cold-start season stays a parameter, never hardcoded 2022), **D-20/D-21** (artifact schema v2, raw numbers only), **D-23/D-24/D-25** (prediction sidecars — where RP predictions will land), **D-27/D-28** (`teamMetrics` contract and per-team metric history).
- `.planning/phases/01-data-foundation-evaluation-harness/01-CONTEXT.md` — **D-09** (2022–2024 tune / 2025–2026 holdout — the split this phase's entire methodology rests on), **D-10** (winner accuracy headline, Brier alongside — the tension D-01/D-02 resolve), **D-11** (quals and elims both scored — relevant to RP, since elims have no RP), **D-02** (JSON artifact canonical, HTML renders from it).

### Phase 2 results — the starting position
- `.planning/phases/02-prediction-models-epa-sigma1/02-06-SUMMARY.md` — The full 5-algorithm × 5-season head-to-head table (the SC-3 starting position quoted in D-02), the measured per-match update cost table (the compute grounding for D-06 and the search budget), and the identifiability verdicts.
- `docs/models/sigma1-identifiability.md` — The SC-3 identifiability write-up whose conclusions D-09 is designed not to disturb. Includes the `foulsCommitted` weakness and the seasons that are not full column rank.
- `docs/models/epa-divergences.md` — Every deliberate EPA divergence from Statbotics. Relevant to D-04: EPA is frozen *as this document describes it*.
- `.planning/phases/02-prediction-models-epa-sigma1/02-REVIEW.md` — The CR-01 cross-alliance foul-attribution bug and its fix; context for how the D-05 fallback path behaves.

### Research
- `.planning/research/PITFALLS.md` — The unidentifiable-latent-model pitfall (D-03, D-07, D-09), the cold-start/rookie/season-carryover pitfall and its three-regime backtest slicing, and the overconfidence/calibration traps (D-01's objective).
- `.planning/research/ARCHITECTURE.md` — Pattern 1 (the shared pure `predict`/`update` contract imported unchanged by both harness and Worker — constrains where tunable parameters may live), and the offline-vs-online compute split.
- `.planning/research/STACK.md` — The 10 ms Workers CPU ceiling that D-11's Monte Carlo must be checked against in Phase 4.

### Existing implementation — read before changing
- `packages/core/algorithms/sigma1/index.ts` — `Sigma1State`, `Sigma1Options` (currently only `id` + `linkMode` — this is where a parameter set plugs in), `makeSigma1`, the three registered variants, `carrySeason`, and the constants `SIGMA1_COLD_START_TEAM_TOTAL` / `SIGMA1_COLD_START_CONSISTENCY_VARIANCE` / `SIGMA1_FALLBACK_SCORE_SD` / `SIGMA1_CONSISTENCY_CARRY_DECAY`.
- `packages/core/algorithms/sigma1/kalman.ts` — `SIGMA1_PROCESS_NOISE_WITHIN_EVENT` (0.5), `SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY` (8) — D-05's adaptation targets these.
- `packages/core/algorithms/sigma1/consistency.ts` — `SIGMA1_CONSISTENCY_EWMA_ALPHA` (0.2), `SIGMA1_SHRINKAGE_PRIOR_MATCHES` (8), `SIGMA1_MIN_CONSISTENCY_VARIANCE` (1).
- `packages/core/algorithms/sigma1/covariance.ts` — `SIGMA1_COV_EWMA_ALPHA` (0.1), `SIGMA1_COV_SHRINKAGE` (0.3); the covariance D-11's joint draws will sample from.
- `packages/core/algorithms/sigma1/linkFunctions.ts` — `SIGMA1_LINK_C` (1.0) and the three D-12 modes.
- `packages/core/algorithms/carryover.ts` — The shared EPA/Sigma1 carry constants D-04 requires splitting.
- `packages/core/algorithms/types.ts` — `AlgorithmModule<S>` with its hardcoded `version: string`; the `Prediction` shape RP fields must extend; the "must stay Worker-importable, no Node-only APIs" constraint in the file header.
- `packages/core/algorithms/breakdown/*.ts` — Per-season component maps. **Their Zod schemas currently strip the RP flags and count fields D-09/D-12 need** (see each file's header comment listing the ignored fields). `constants.ts` holds the cold-start-season parameter (D-19).
- `packages/core/algorithms/breakdown/reconciliation.test.ts` — The invariant D-09 is designed not to disturb, and the shape D-12's RP reconciliation should mirror.
- `packages/harness/cli.ts` — The `ALGORITHMS` registry (5 entries today) and flag design; `runSeasonsMode`'s season loop and `carrySeason` threading.
- `packages/harness/replay.ts` — `toLeakProofUpcoming`, `buildSeasonStream`, `WalkForwardSimulator.run`, and the `onMatchComplete` hook. Every optimizer evaluation must run through this same leak-proof path.
- `packages/harness/artifact.ts` — `ARTIFACT_SCHEMA_VERSION` (2), `ProvenanceSchema`, and the `algorithms[]` array carrying `{id, version}` — the existing hook D-13's version identity extends.
- `packages/harness/predictions.ts` / `metricHistory.ts` — The JSONL sidecars where RP predictions will land.
- `packages/harness/score.ts` — Brier/accuracy computation; D-01's objective function reads from here.
- `packages/corpus/schema.sql` — `score_breakdown_raw` (holds the RP flags), `red_rp_earned` / `blue_rp_earned` (D-12's reconciliation target).

### External reference
- **Official FRC game manuals, 2022–2026** — the authoring source for D-12's RP rules, cited by section in each rule module. Not yet fetched; sourcing them is a research task.
- `https://github.com/avgupta456/statbotics` — Statbotics' model, the reference for the EPA constants D-04 freezes. Their API is dead (HTTP 500, reconfirmed 2026-08-14, WINDOWS entries 1–2); the source repo is the only working reference.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`makeSigma1(options)` factory** — already the pattern for producing algorithm variants from a config object (`Sigma1Options`). A tunable parameter set is the natural extension of this shape; no new architecture needed for D-13.
- **`WalkForwardSimulator` + `toLeakProofUpcoming`** — predict-before-update is structurally enforced by a Proxy that throws on outcome reads. Every optimizer evaluation inherits that guarantee for free by running through the same path.
- **`ALGORITHMS` registry (`cli.ts`)** — already carries 5 entries and already proved that variants of one algorithm can be scored side by side in one run. D-06's on/off pair and D-14's promoted versions plug into this directly.
- **`reconciliation.test.ts`** — an existing corpus-wide invariant test whose shape D-12's RP flag reconciliation should mirror.
- **`identifiability.ts`** — a committed, deterministic, reproducible analysis script producing a published verdict. The precedent for how D-03's sensitivity screen should be built and published.
- **`ExpandingStats`** — running league aggregates already folded match by match; available to D-05's innovation statistics.

### Established Patterns
- Pure `predict`/`update` with immutable state; `update` returns new state. Parameters must be threaded, never mutated in place.
- **`packages/core` stays free of Node-only APIs and `better-sqlite3`** so the Phase 4 Worker imports it unchanged. A parameter set must therefore be plain data loadable in both environments — not a file read from inside `core`.
- Zod schemas as executable specs, validated on write; the artifact validates against its own schema before it can persist.
- Dense, reasoning-carrying doc comments explaining *why* a policy was chosen; decisions named in comments by their decision ID (`D-07`, `T-01-13`). Match this density.
- **Honesty discipline, repeatedly demonstrated:** when the committed identifiability script disagreed with the prose, the prose was corrected — not the script. D-02 and D-08 extend this to tuning results.

### Integration Points
- `Sigma1Options` is the seam where a parameter set enters. Today it carries only `id` and `linkMode`.
- `carryover.ts`'s shared constants are the one place D-04's freeze-the-baselines decision forces a structural split before any tuning can begin.
- The per-season breakdown Zod schemas are the seam for D-09's count fields and D-12's RP flags — both currently stripped by design.
- `AlgorithmModule.version` is a hardcoded literal today; D-13 makes it derived from code version + parameter-set name.
- `runSeasonsMode`'s season loop already threads `carrySeason` across boundaries — D-09's parallel count state needs the same treatment.

### Measured Baseline (Phase 2, `reports/full-v2`)
| Season | Split | OPR Brier / acc | EPA Brier / acc | sigma1 Brier / acc |
|---|---|---|---|---|
| 2022 | tune | 0.1523 / 0.7743 | 0.1926 / 0.7387 | 0.1691 / 0.7529 |
| 2023 | tune | 0.1706 / 0.7502 | 0.1985 / 0.7241 | 0.1788 / 0.7299 |
| 2024 | tune | 0.1687 / 0.7501 | 0.2160 / 0.6991 | 0.1821 / 0.7212 |
| 2025 | **holdout** | 0.1675 / 0.7618 | 0.1932 / 0.7290 | **0.1662** / 0.7539 |
| 2026 | **holdout** | 0.1773 / 0.7825 | 0.1742 / 0.7454 | **0.1554** / 0.7819 |

Untuned Sigma1 already wins holdout Brier on both seasons and loses holdout winner accuracy on both. Closing the accuracy gap without a search that steers on accuracy (D-01) is this phase's central difficulty.

Measured per-match update cost: sigma1 ~0.9–1.3 ms mean, ~2.3–2.6 ms p99. OPR ~116–131 ms mean — OPR dominated Phase 2's 3-hour run and is not in the search, so optimizer evaluations are ~1 minute per tune-season replay.

</code_context>

<specifics>
## Specific Ideas

- **The standing tiebreaker remains measured accuracy on tune seasons, not elegance** (carried from Phase 2). Where this phase adds a wrinkle: D-01 makes Brier the *search* signal while D-02 keeps accuracy in the *verdict*, so a design choice that helps Brier but not accuracy is not automatically a win.
- **Honesty over favourable framing, consistently.** Three precedents now exist in this project: SC-2 recorded blocked rather than reworded (D-14), the identifiability write-up corrected to match the committed script rather than the reverse, and CR-01's fix re-run in full rather than asserted from cached output. D-02 and D-08 are this phase's instances — a Sigma1 that does not clear the bar gets a recorded shortfall, and an adaptation that does not pay ships disabled with the negative result published.
- **"Beats Statbotics" means beating what Statbotics actually ships**, which is why D-04 freezes EPA at Statbotics' own published constants rather than tuning it into a stronger but non-Statbotics baseline.
- **The RP ground truth is already in the corpus and free.** TBA records every bonus-achievement flag in `score_breakdown_raw`; the component maps strip them only because Phase 2 had no use for them. That turns SC-4 from a documentation exercise into a 100%-of-matches test (D-12).

</specifics>

<deferred>
## Deferred Ideas

- **Deterministic numerical integration for the RP pmf** — would satisfy D-16's bitwise determinism trivially and remove D-11's Monte Carlo cost from Phase 4's 10 ms Worker budget. Left open to the planner as an implementation route rather than deferred to a later phase.
- **Full-corpus reproduction as a promotion gate** — D-15 chose the fast committed-digest CI test; requiring a full 2022–2026 reproduction before any version is promoted was considered and left available as a manual verification-time step rather than automation.
- **Tuning EPA as a second, separately-budgeted search** — rejected for this phase by D-04 because it dissolves the Statbotics-comparison story. Worth revisiting only if the question "how good could an EPA-shaped model get" becomes interesting in its own right.
- **Per-team-per-component adaptation** (D-07's rejected option) — richer model of how robots actually change mid-season. Blocked on having an identifiability argument that survives the failure log's lesson; not a scope question so much as an evidence question.
- **Defense as a diagnostic** (carried from Phase 2) — per-team residual asymmetry as a team-page statistic that never feeds a prediction. Still open, still costs nothing in identifiability, still not this phase.
- **Recompute the corpus from 2016** (ENH-04, v2) — D-19's constraint continues to bind: the cold-start season stays a parameter, and both the per-season component maps and the new RP rule modules must be structured so adding 2016–2021 is data entry rather than refactoring.
- **A sourced, verified Statbotics accuracy reference row** — WINDOWS entry 1 remains open; the reference row is still Phase 1's dated unverified stub.

</deferred>

---

*Phase: 3-Tuning, Ranking Points & Versioning*
*Context gathered: 2026-08-14*
