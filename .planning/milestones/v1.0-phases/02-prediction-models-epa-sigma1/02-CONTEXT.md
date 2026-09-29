# Phase 2: Prediction Models — EPA & Sigma1 - Context

**Gathered:** 2026-08-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Two new `AlgorithmModule` implementations in `packages/core/algorithms/` — a reimplemented EPA and the Sigma1 Kalman filter — plus the harness extensions needed to (a) score OPR, EPA, and Sigma1 head-to-head in one run producing one comparable table, (b) give every match a predicted winner, win probability, and predicted alliance scores (Sigma1 additionally carrying variance), and (c) expose per-team metrics so Sigma1 can report `X ± Y`.

Explicitly NOT in this phase: hyperparameter tuning / the offline optimizer (Phase 3), ranking-point prediction (Phase 3), first-class algorithm versioning machinery (Phase 3), published artifacts and the live update pipeline (Phase 4), and any UI (Phases 5–8). Phase 2 defines hyperparameters and ships documented, defensible defaults; Phase 3 searches them.

</domain>

<decisions>
## Implementation Decisions

### Sigma1 state design

- **D-01:** Sigma1 mirrors Statbotics' decomposition philosophy — track nearly every data source TBA/FIRST exposes, broken down by **game period × task type**, "within reason." When in doubt about what to track or how to define it, match what Statbotics does. **The difference from Statbotics is that every source carries its own variance, not just an expected value.** — **Reversibility:** costly — the component set defines the state vector, the per-season parsers, the prediction record shape, and every downstream team-page metric; narrowing it later means re-running all backtests and re-deriving published numbers.
- **D-02:** Per-season component maps are required for 2022–2026 (one per season, since each game's task types differ). Written as data-driven maps, not hardcoded branches — see D-12.
- **D-03:** A predicted alliance score is the **sum of component predictions**, and its variance is the sum of component variances **plus their estimated covariance**. Components genuinely correlate; ignoring that would understate every match's ± and show up as overconfidence in the calibration curve.
- **D-04:** **Fouls are modeled as a per-team "fouls committed" component**, so predicted totals include the opponent's expected foul contribution. Note this is a deliberate divergence from Statbotics, which instead multiplies a no-foul predicted score by a season-level foul rate (`red_score * (1 + foul_rate)`). Foul counts are sparse and noisy per team, so this component's identifiability is the weakest in the set and must be covered explicitly by the identifiability check (D-14).
- **D-05:** Matches with **no `score_breakdown`** (`has_score_breakdown = 0`) still predict normally and still update state, via a **total-only fallback update** that distributes the residual across components in proportion to their current expected shares. Nothing is dropped from the learning stream.
- **D-06:** **No defense latent.** Sigma1 models offense only; defensive suppression appears as unexplained residual, which correctly widens ± rather than being falsely attributed. This is the direct application of the failure log's unidentifiable-4D-model lesson.
- **D-07:** Process noise uses **event-boundary bumps** — small drift between matches within an event, a larger injection at event boundaries (robots get rebuilt between events, not mid-event). Both magnitudes become Phase 3 hyperparameters.
- **D-08:** **Elimination matches are learned from normally** — predict, then update, treated as ordinary observations. (Statbotics instead applies `ELIM_WEIGHT = 1/3` and does not increment its match counter for elims; this is a deliberate divergence.)

### What `±` means

- **D-09:** On a team page, the `± Y` is **the team's match-to-match performance spread (consistency)**, not our uncertainty about the estimate. A streaky team keeps a wide ±; a metronomic one narrows. — **Reversibility:** costly — this is the meaning published on every metric on the site; changing it later invalidates every screenshot, explanation, and user's mental model.
- **D-10:** A **match prediction's** variance uses the **full predictive variance** — estimate uncertainty *plus* performance spread. The team-page ± and the match-prediction ± are deliberately different quantities answering different questions; both must be labeled accordingly. The calibration curve is the check that the predictive variance is right.
- **D-11:** For teams with thin match histories, the consistency estimate is **shrunk toward the league average** for that component, weighted by match count (empirical-Bayes style). Blend rate becomes a Phase 3 hyperparameter. No team gets an implausibly tiny ± off two matches.
- **D-12:** Win probability is produced by a **pluggable link function with three selectable modes**, all reportable side by side by the harness:
  1. logistic on `margin / season_score_sd` — Statbotics parity
  2. logistic on `margin / (c · √predictive_variance)` — **the nested default**
  3. normal CDF on the predictive variance
  Mode 2 collapses to mode 1 when the variance term is replaced by the season constant, so "does per-match variance improve accuracy?" becomes a measured number rather than an argument. The user explicitly wants mode 3 revisited later and wants the tune-season numbers to make the call, not intuition — so mode 3 must be a flag flip, not a rewrite.

### EPA reimplementation

- **D-13:** **Faithful core, our plumbing.** Match the algorithm that matters — EWMA update, decaying learning rate, elim weighting, init/carryover scheme, margin-over-season-SD win probability — using our own component extraction, and skip Statbotics' per-season post-processing quirks (2018 switch/scale sigmoid, per-year clamps). **Every deliberate divergence must be documented with its reasoning.**
- **D-14:** **SC-2's Statbotics tolerance check is expected to be BLOCKED at verification, and that is the accepted outcome.** Verified live on 2026-08-13: `api.statbotics.io/v3/year/{year}`, `/v3/team_year/{team}/{year}`, and `/v3/team/{team}` all return HTTP 500; v2 returns 404; the website returns 200 but is a client-rendered shell fed by the same dead API. Success Criterion 2 stays worded as-is in ROADMAP.md; Phase 2 verification should mark it blocked-on-external-dependency with the 500s as evidence rather than redefining success to fit what's achievable. Options considered and rejected: running Statbotics' Python model against our corpus to generate references, and pulling values from Wayback snapshots.
- **D-15:** The HTML report's Statbotics accuracy reference row **stays, with its unverified status made visually loud**. The underlying values are still Phase 1's dated manual constants (`fetched: false`, "see Known Stubs"). Our OPR baseline already reports 0.75–0.78 against that row's 0.70–0.71, so the comparison must not be renderable as a clean win without its caveat attached.

### Season carryover & cold start

- **D-16:** Team ratings **carry across season boundaries** for both EPA and Sigma1, **with the carry behavior expressed as global hyperparameters tuned to maximize accuracy** in Phase 3. Phase 2 ships documented defaults. Statbotics' scheme is the reference shape: `0.7 × last year's normalized rating + 0.3 × the year before`, then reverted 40% toward a rookie baseline of `NORM_MEAN − 0.2 × NORM_SD`, converted into the new season's point units, floored so a starting rating is never negative.
- **D-17:** Sigma1's **consistency estimate also carries across seasons**, with its own decay parameter tuned alongside the mean's. The tuner can shrink it to zero if the signal isn't real.
- **D-18:** **No burn-in season.** 2022 is the cold-start season and its resulting asymmetry is documented rather than engineered around. 2022 is a tune season, so the holdout claim is untouched.
- **D-19:** **PROJECT INTENT (affects design now):** once the models are proven, the corpus will be recomputed **starting from 2016**, and 2016 becomes the cold-start season instead of 2022. Therefore: **the cold-start season must be a parameter, never a hardcoded 2022**, and per-season component maps must be structured so adding 2016–2021 later is data entry rather than refactoring. (2016 is also where Statbotics' own code begins branching `year >= 2016` for components and RP fields — TBA's score breakdowns became rich enough that year.)

### Harness: head-to-head run and artifact

- **D-20:** **One artifact holding many algorithms — `ARTIFACT_SCHEMA_VERSION` goes to 2.** Run-level `provenance` (corpus identity, seasons covered, run timestamp) stated once at the top; an `algorithms[]` array carrying each algorithm's id and version; `slices[]` tagged with `algorithmId`. — **Reversibility:** costly — this is the Phase 8 Compare-page contract that D-02 (Phase 1) already flagged. Breaking it now is nearly free because the only consumer today is our own HTML report; after Phase 4 publishes and Phase 5 ships, the same change costs a migration. *(Decision made on Claude's recommendation at the user's request.)*
- **D-21:** The artifact stores **raw numbers only** — each algorithm's Brier score, winner accuracy, and calibration per season. No precomputed deltas, no significance tests. Any "Sigma1 beats EPA by X" framing is computed by whatever renders it, so there is exactly one place a comparison can be wrong.
- **D-22:** One run replays a **single shared match stream with parallel algorithm states** — build the chronological stream once, step it match by match, calling every algorithm's `predict`/`update` at each step. Guarantees all three algorithms see byte-identical inputs in identical order, so any score difference is the algorithm and not the data. Also one corpus pass instead of N. The existing leak-proof `toLeakProofUpcoming` wrapper already sits at the right place for this.

### Harness: per-match prediction output

- **D-23:** Per-match predictions are written as a **side artifact per run, not into the corpus.** Predictions are derived data, not ingested fact, and this preserves Phase 1's read-only-corpus guarantee (`openCorpusReadOnly`, T-01-13) unchanged.
- **D-24:** Each prediction record carries **totals + full component vectors** for both alliances (plus winner, win probability, and variance where the algorithm has one). Roughly 10× the size of totals-only, but it is what Phase 7's Breakdown tab eventually renders, and it makes a quietly-wrong component visible instead of hidden behind a plausible total.
- **D-25:** Layout: **one JSONL file per season, all algorithms interleaved per match** (e.g. `predictions-{season}.jsonl`), written alongside `artifact.json`. Rationale: component vectors make records fat so a single whole-run file is out; splitting per algorithm would fragment exactly the per-match head-to-head comparison worth scanning; per-season keeps files bounded and streamable and matches how Phase 4's precompute will read them. JSONL so a run can append as it goes and an interrupted run leaves partial-but-readable output. *(Layout chosen at the user's explicit delegation.)*
- **D-26:** `reports/` and `data/` are already gitignored, so these outputs stay out of git by default — consistent with the failure log's repo-hygiene item.

### Contract: team metric exposure

- **D-27:** Add **`teamMetrics(state)` to the `AlgorithmModule` contract** — a pure, read-only accessor returning plain data: a per-team set of named components, each with a value and an optional spread. OPR returns one unnamed value; EPA returns its components; Sigma1 returns components with ±. Keeps `S` opaque, keeps `predict`/`update` pure, and gives Phases 5–7 one shape to render regardless of the selected algorithm. **The return type must be plain data — `packages/core` stays importable unchanged by the Phase 4 Cloudflare Worker (no Node-only APIs).** Adapters were rejected because they push algorithm internals into rendering code, which is how the "docs describe a deleted model" drift starts. *(Decision made on Claude's recommendation at the user's request.)*
- **D-28:** Phase 2 runs **capture per-team metric history**: after each match, snapshot `teamMetrics` for **only the 6 teams involved** into the per-season sidecar (~500k rows per algorithm). Nearly free inside a loop already running; it is precisely what TEAM-06's metric-history plot and TEAM-04's event-end snapshots need later, and it makes component behavior inspectable while the identifiability argument is under scrutiny. **Producing this data is Phase 2; rendering it is Phase 6.** A metrics *event-stream* contract was considered and rejected — the simulator already steps match by match, so snapshots are just calls at the right moments.

### Claude's Discretion

- The exact per-season component list for each of 2022–2026 (research should propose it against TBA's actual `score_breakdown` fields, cross-referenced with Statbotics' `all_keys[year]`).
- The covariance estimator for D-03 (how component covariance is estimated and kept numerically stable).
- The shrinkage math and default blend rate for D-11, and default values for every hyperparameter Phase 3 will later tune.
- How the total-only fallback update (D-05) distributes residual across components.
- Module layout, file naming, JSONL record schema details, and CLI flag design.
- How the identifiability check (SC-3) is structured and written up — it must explicitly cover the fouls component (D-04), which is the weakest member of the set.
- Whether the harness reports accuracy sliced by early-season vs late-season (the cold-start regime check `.planning/research/PITFALLS.md` calls for) — recommended, not locked.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product spec & mandate
- `REBUILD_SPEC.md` — Product spec, clean-slate mandate (do NOT consult or port pre-v3 code/models/values — git tag `v2-poc` is off-limits), and the failure log. Two entries bear directly on this phase: **"Unidentifiable model"** (the 4D offense/defense/time-allocation collapse — D-01/D-06 are the response) and **"Documentation drift and zero tests."**

### Prior phase context
- `.planning/phases/01-data-foundation-evaluation-harness/01-CONTEXT.md` — Phase 1's locked decisions that still bind: D-05 (raw `score_breakdown` stored verbatim, per-season extraction deferred until a model needs it — Phase 2 is that moment), D-06 (offseason flagged/excluded), D-07 (surrogates excluded from rating updates), D-08 (replays keep final result only), D-09 (2022–2024 tune / 2025–2026 holdout), D-10 (winner accuracy headline, Brier alongside), D-11 (quals and elims both scored), D-02 (JSON artifact is canonical, HTML renders from it)
- `.planning/phases/01-data-foundation-evaluation-harness/01-VERIFICATION.md` and `01-05-SUMMARY.md` "Known Stubs" — the Statbotics reference-value stub that D-15 keeps

### Research (Phase-2-relevant)
- `.planning/research/PITFALLS.md` — Pitfall on unidentifiable latent models ("check identifiability against what TBA actually exposes as observables *before* implementation"); the cold-start / rookie / season-carryover pitfall and its recommended three-regime backtest slicing; the overconfidence-and-calibration traps
- `.planning/research/ARCHITECTURE.md` — Pattern 1 (the shared pure `predict`/`update` contract, imported unchanged by both harness and Worker); the offline-vs-online compute split; the explicit "check identifiability before adding latent structure to Sigma1" guidance
- `.planning/research/STACK.md` — Node/TypeScript pipeline tooling, Vitest, and the 10 ms Workers CPU ceiling that constrains how expensive a single Sigma1 per-match update may become
- `.planning/research/SUMMARY.md` — Build order and the harness-before-model sequencing

### Existing implementation (read before changing)
- `packages/core/algorithms/types.ts` — The `AlgorithmModule<S>` contract being extended by D-27; note the already-present but unused `Prediction.variance?` channel and the "must stay Worker-importable" constraint in the file header
- `packages/core/algorithms/opr.ts` — The reference implementation of the contract, plus the surrogate policy (`ratingEligibleTeams` / `allianceObservation`) and disqualification policy Sigma1 and EPA must be consistent with
- `packages/harness/replay.ts` — `toLeakProofUpcoming` (the Proxy that makes outcome leakage a runtime failure), `buildSeasonStream`, and `WalkForwardSimulator.run` — the last of which D-22 changes from one algorithm to many
- `packages/harness/artifact.ts` — `HarnessArtifactSchema` and `ARTIFACT_SCHEMA_VERSION`, going to 2 per D-20
- `packages/harness/cli.ts` — The `ALGORITHMS` registry (currently `{ opr }`) and the `--algorithm` flag that must accept multiple algorithms
- `packages/harness/score.ts`, `packages/harness/statbotics.ts` — Scoring/aggregation and the reference row D-15 governs
- `packages/corpus/schema.sql` — `score_breakdown_raw` holds the verbatim TBA JSON the per-season component maps will parse
- `docs/data/tba-field-recon.md` — Phase 1's TBA/Statbotics field reconnaissance

### External reference (verified live 2026-08-13)
- `https://github.com/avgupta456/statbotics` — Statbotics is open source; their model is the reference for D-13/D-16. Key files read during this discussion: `backend/src/models/epa/main.py` (the `predict_match` / `attribute_match` / `update_team` loop, `k_func`, `percent_func`, `ELIM_WEIGHT`), `backend/src/models/epa/math.py` (`EPARating` — an EWMA carrying **only** a mean; its docstring states it "does not handle covariance between variables"), `backend/src/models/epa/init.py` and `constants.py` (`NORM_MEAN = 1500`, `NORM_SD = 250`, `INIT_PENALTY = 0.2`, `YEAR_ONE_WEIGHT = 0.7`, `MEAN_REVERSION = 0.4`, `ELIM_WEIGHT = 1/3`). Also relevant and not yet read: `backend/src/models/epa/breakdown.py` (`get_score_from_breakdown`, `post_process_breakdown`, `post_process_attrib`) and `backend/src/tba/breakdown.py` (`all_keys[year]` — their per-season component list).
- **Statbotics' own blog returns HTTP 403 and its API returns HTTP 500** — the source repo is the only working reference. Do not plan around fetching either.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`AlgorithmModule<S>` contract** (`packages/core/algorithms/types.ts`) — EPA and Sigma1 plug straight in; `Prediction.variance?` already exists unused, explicitly reserved for "later algorithms."
- **`WalkForwardSimulator` + `toLeakProofUpcoming`** (`packages/harness/replay.ts`) — predict-before-update is already structurally enforced by a Proxy that throws on any outcome-bearing property read. New algorithms inherit that guarantee for free; D-22's multi-algorithm loop must keep every call site behind the same wrapper.
- **`buildSeasonStream` / `selectMatchesChronological`** — one definition of chronological order (including cross-event interleaving) already exists and is tested. D-22 builds on it rather than re-sorting.
- **Scoring, calibration, artifact, and HTML report** (`packages/harness/{score,artifact,report}.ts`) — all exist and work; Phase 2 extends rather than replaces them.
- **`openCorpusReadOnly`** — a harness run cannot mutate the corpus it scores (enforced at the SQLite layer). D-23 keeps this intact.

### Established Patterns
- Pure `predict`/`update` with immutable state; `update` returns a new state rather than mutating.
- **Incremental over recompute**: OPR maintains a Sherman-Morrison/RLS incremental inverse rather than re-solving, after measurement showed a from-scratch season solve would cost ~16 CPU-days. Sigma1's Kalman update is naturally incremental — keep it that way, and keep an eye on the 10 ms Worker budget Phase 4 will impose.
- Zod schemas as executable specs, validated on write; the artifact validates against its own schema before it can be persisted.
- Dense, reasoning-carrying doc comments explaining *why* a policy was chosen (see `opr.ts`'s surrogate and disqualification comments) — match this density.
- Decisions that resolve an open question are named in comments by their decision ID (`D-07`, `T-01-13`).

### Integration Points
- `ALGORITHMS` registry in `packages/harness/cli.ts` is currently `{ opr }`; `--algorithm` parses a single value and must accept several.
- `HarnessPredictionInput` (`score.ts`) currently keeps only `pRedWin` — predicted scores are computed and discarded today; D-24 changes what survives a run.
- Season loop in `runSeasonsMode` calls `initState` fresh per season — **D-16's carryover requires threading state across the season boundary**, which is a structural change to that loop, not a parameter.
- `packages/core` must stay free of Node-only APIs and `better-sqlite3` so the Phase 4 Worker can import it unchanged.

### Measured Baseline (OPR, from `reports/full/artifact.json`)
| Season | Split | Brier | Winner accuracy | Scored |
|---|---|---|---|---|
| 2022 | tune | 0.1523 | 0.7743 | 14,603 |
| 2023 | tune | 0.1706 | 0.7502 | 16,290 |
| 2024 | tune | 0.1687 | 0.7501 | 16,958 |
| 2025 | holdout | 0.1675 | 0.7618 | 17,815 |
| 2026 | holdout | 0.1773 | 0.7825 | 18,337 |

This is the bar EPA and Sigma1 must clear. Note OPR is already well above the (unverified) 0.70–0.71 Statbotics reference row — see D-15.

</code_context>

<specifics>
## Specific Ideas

- **The stated goal throughout this discussion was "maximize match prediction accuracy."** When a design choice is genuinely open, the tiebreaker is measured accuracy on tune seasons, not elegance.
- **The Sigma1 thesis, stated plainly:** Statbotics computes per-alliance standard deviation and then *doesn't use it* — the `pred_sd` line sits commented out directly above their win-probability calculation, and their `EPARating` carries only a mean. So two wildcard rookie alliances and two metronomic veteran alliances with the same predicted margin receive identical confidence from Statbotics. That is the gap Sigma1 exists to exploit, and D-12's nested link function is the instrument for measuring whether exploiting it actually pays.
- The user was explicit about not having the statistics background to adjudicate the win-probability form by argument, and wants the harness to decide it empirically. Design for that: the three link modes must be switchable and comparable in one run, and the report should make the comparison legible.
- "When in doubt, do what Statbotics does" is the standing tiebreaker for modeling questions where no accuracy evidence exists yet — with the deliberate, documented exceptions recorded above (D-04 fouls, D-08 elims, and variance everywhere).

</specifics>

<deferred>
## Deferred Ideas

- **Normal-CDF win probability (D-12 mode 3)** — the user wants to come back and try it once tune-season numbers exist. Kept cheap by shipping the link function as a 3-mode strategy in Phase 2; the revisit is a flag flip plus a harness row, not a rewrite.
- **Recompute the corpus from 2016** — once the models are proven, extend back to 2016 and make it the cold-start season (D-19). Larger than Phase 2, and it maps to existing requirement **ENH-04** ("seasons before 2022", v2). Phase 2's obligation is only to not hardcode 2022 and to keep the per-season component maps additive.
- **Statbotics per-team numeric tolerance check (SC-2)** — blocked on Statbotics' API returning. Revisit if it comes back; D-14 records the evidence of its current state.
- **A sourced, verified Statbotics accuracy reference row** — the current 0.70/0.71 values remain a dated, unverified stub inherited from Phase 1. Replacing them with individually-sourced figures is still outstanding.
- **Defense as a diagnostic** (per-team residual asymmetry: do opponents underperform when this team plays?) — rejected for Phase 2 along with the defensive latent, but noted as an interesting team-page statistic that costs nothing in identifiability because it would never feed a prediction.

</deferred>

---

*Phase: 2-Prediction Models — EPA & Sigma1*
*Context gathered: 2026-08-13*
