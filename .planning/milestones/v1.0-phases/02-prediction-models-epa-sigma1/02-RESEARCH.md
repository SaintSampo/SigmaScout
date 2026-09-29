# Phase 2: Prediction Models — EPA & Sigma1 - Research

**Researched:** 2026-08-13
**Domain:** FRC rating/prediction algorithms (EPA reimplementation, Kalman-filter-family Sigma1) and the multi-algorithm evaluation harness that scores them head-to-head
**Confidence:** MEDIUM-HIGH — the EPA math is verified directly against Statbotics' live source repo and cross-checked against this project's own ingested corpus; Sigma1's design is original synthesis grounded in the project's failure log and standard Bayesian-filtering theory (no existing reference implementation to verify against, since Sigma1 is a new algorithm), so it is flagged accordingly throughout.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Sigma1 state design**
- **D-01:** Sigma1 mirrors Statbotics' decomposition philosophy — track nearly every data source TBA/FIRST exposes, broken down by game period × task type, "within reason." When in doubt about what to track or how to define it, match what Statbotics does. The difference from Statbotics is that every source carries its own variance, not just an expected value.
- **D-02:** Per-season component maps are required for 2022–2026 (one per season). Written as data-driven maps, not hardcoded branches.
- **D-03:** A predicted alliance score is the sum of component predictions, and its variance is the sum of component variances plus their estimated covariance.
- **D-04:** Fouls are modeled as a per-team "fouls committed" component, so predicted totals include the opponent's expected foul contribution — deliberate divergence from Statbotics' `red_score * (1 + foul_rate)`. This component's identifiability is the weakest in the set and must be covered explicitly by the identifiability check (D-14... referenced as D-04 in the check).
- **D-05:** Matches with no `score_breakdown` still predict normally and still update state via a total-only fallback update that distributes the residual across components in proportion to their current expected shares. Nothing is dropped from the learning stream.
- **D-06:** No defense latent. Sigma1 models offense only; defensive suppression appears as unexplained residual, which correctly widens ± rather than being falsely attributed.
- **D-07:** Process noise uses event-boundary bumps — small drift between matches within an event, larger injection at event boundaries. Both magnitudes are Phase 3 hyperparameters.
- **D-08:** Elimination matches are learned from normally — predict, then update, treated as ordinary observations (Statbotics instead applies `ELIM_WEIGHT = 1/3` and excludes elims from its match counter — deliberate divergence).

**What ± means**
- **D-09:** On a team page, `± Y` is the team's match-to-match performance spread (consistency), not our uncertainty about the estimate.
- **D-10:** A match prediction's variance uses the full predictive variance — estimate uncertainty plus performance spread. Team-page ± and match-prediction ± are deliberately different quantities.
- **D-11:** For teams with thin match histories, the consistency estimate is shrunk toward the league average for that component, weighted by match count (empirical-Bayes style). Blend rate is a Phase 3 hyperparameter.
- **D-12:** Win probability is a pluggable link function with three selectable modes, all reportable side by side by the harness: (1) logistic on `margin / season_score_sd` — Statbotics parity; (2) logistic on `margin / (c · √predictive_variance)` — the nested default; (3) normal CDF on the predictive variance. Mode 2 collapses to mode 1 when the variance term is replaced by the season constant. Mode 3 must be a flag flip, not a rewrite.

**EPA reimplementation**
- **D-13:** Faithful core, our plumbing. Match the algorithm that matters — EWMA update, decaying learning rate, elim weighting, init/carryover scheme, margin-over-season-SD win probability — using our own component extraction, skip Statbotics' per-season post-processing quirks (2018 switch/scale sigmoid, per-year clamps). Every deliberate divergence must be documented with its reasoning.
- **D-14:** SC-2's Statbotics tolerance check is expected to be BLOCKED at verification, and that is the accepted outcome (Statbotics API reproducibly 500s, confirmed live 2026-08-13). Options rejected: running Statbotics' Python model against our corpus, pulling values from Wayback snapshots.
- **D-15:** The HTML report's Statbotics accuracy reference row stays, with its unverified status made visually loud. OPR already reports 0.75–0.78 against that row's dated 0.70–0.71 constant — the comparison must not render as a clean win without its caveat attached.

**Season carryover & cold start**
- **D-16:** Team ratings carry across season boundaries for both EPA and Sigma1, with carry behavior expressed as global hyperparameters tuned in Phase 3. Reference shape (Statbotics): `0.7 × last year's normalized rating + 0.3 × the year before`, then reverted 40% toward a rookie baseline of `NORM_MEAN − 0.2 × NORM_SD`, converted into the new season's point units, floored at non-negative.
- **D-17:** Sigma1's consistency estimate also carries across seasons, with its own decay parameter tuned alongside the mean's.
- **D-18:** No burn-in season. 2022 is the cold-start season; its asymmetry is documented, not engineered around.
- **D-19:** PROJECT INTENT: once models are proven, the corpus will be recomputed starting from 2016, and 2016 becomes the cold-start season instead of 2022. The cold-start season must be a parameter, never hardcoded 2022; per-season component maps must be structured so adding 2016–2021 later is data entry, not refactoring.

**Harness: head-to-head run and artifact**
- **D-20:** One artifact holding many algorithms — `ARTIFACT_SCHEMA_VERSION` goes to 2. Run-level `provenance` stated once at the top; an `algorithms[]` array carrying each algorithm's id and version; `slices[]` tagged with `algorithmId`.
- **D-21:** The artifact stores raw numbers only — Brier score, winner accuracy, calibration per season per algorithm. No precomputed deltas, no significance tests.
- **D-22:** One run replays a single shared match stream with parallel algorithm states — build the chronological stream once, step it match by match, calling every algorithm's `predict`/`update` at each step. The existing `toLeakProofUpcoming` wrapper sits at the right place for this.

**Harness: per-match prediction output**
- **D-23:** Per-match predictions are written as a side artifact per run, not into the corpus.
- **D-24:** Each prediction record carries totals + full component vectors for both alliances (plus winner, win probability, variance where available). ~10× the size of totals-only.
- **D-25:** Layout: one JSONL file per season, all algorithms interleaved per match (`predictions-{season}.jsonl`), written alongside `artifact.json`.
- **D-26:** `reports/` and `data/` are already gitignored.

**Contract: team metric exposure**
- **D-27:** Add `teamMetrics(state)` to the `AlgorithmModule` contract — a pure, read-only accessor returning plain data. OPR returns one unnamed value; EPA returns its components; Sigma1 returns components with ±. Return type must be plain data — `packages/core` stays importable unchanged by the Phase 4 Cloudflare Worker.
- **D-28:** Phase 2 runs capture per-team metric history: after each match, snapshot `teamMetrics` for only the 6 teams involved into the per-season sidecar (~500k rows per algorithm). Producing this data is Phase 2; rendering it is Phase 6.

### Claude's Discretion
- The exact per-season component list for each of 2022–2026 (research should propose it against TBA's actual `score_breakdown` fields, cross-referenced with Statbotics' `all_keys[year]`).
- The covariance estimator for D-03 (how component covariance is estimated and kept numerically stable).
- The shrinkage math and default blend rate for D-11, and default values for every hyperparameter Phase 3 will later tune.
- How the total-only fallback update (D-05) distributes residual across components.
- Module layout, file naming, JSONL record schema details, and CLI flag design.
- How the identifiability check (SC-3) is structured and written up — must explicitly cover the fouls component (D-04).
- Whether the harness reports accuracy sliced by early-season vs late-season (recommended, not locked).

### Deferred Ideas (OUT OF SCOPE)
- Normal-CDF win probability (D-12 mode 3) — revisit once tune-season numbers exist; ship as a flag flip.
- Recompute the corpus from 2016 (ENH-04) — Phase 2's obligation is only to not hardcode 2022 and keep per-season component maps additive.
- Statbotics per-team numeric tolerance check (SC-2) — blocked on Statbotics' API returning.
- A sourced, verified Statbotics accuracy reference row — remains a dated, unverified stub.
- Defense as a diagnostic (per-team residual asymmetry) — rejected for Phase 2, noted as a future team-page statistic that costs nothing in identifiability because it would never feed a prediction.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ALGO-02 | EPA is reimplemented from TBA data and runs walk-forward at any point in a season | EPA math verified verbatim against Statbotics' live source (`k_func`, `percent_func`, `EPARating`, `get_init_epa`, `NORM_MEAN`/`NORM_SD`/etc.) — see Code Examples. Walk-forward-safety of the win-probability scale denominator flagged as a concrete leakage risk with a fix (expanding-window SD, not season-final SD) — see Common Pitfalls, Pitfall EPA-1. |
| ALGO-03 | Sigma1 (Kalman-filter family) produces mean and variance per team metric, X ± Y | Full Kalman update mechanics for alliance-sum (3v3) observations derived from first principles (see Code Examples "Sigma1 Kalman update"); D-09/D-10/D-11's three distinct variance quantities (spread, estimate uncertainty, predictive variance) mapped onto standard filtering terms; identifiability check design (Validation Architecture, Common Pitfalls) directly answers D-04's weakest-component requirement, grounded in this session's corpus measurement of foul-field sparsity and naming drift. |
| ALGO-07 | Every match gets predicted winner, win probability, predicted alliance scores; Sigma predictions carry variance | Concrete, verified structural gap found: `MatchResult`/`selectMatchesChronological` do not currently surface `score_breakdown_raw` to algorithms at all — this is a required, previously-undocumented plumbing change (see Common Pitfalls, Harness-1). `Prediction` interface extension proposed for component vectors (D-24) without breaking OPR. |

</phase_requirements>

## Summary

Phase 2 has two genuinely new algorithms (EPA, Sigma1) sharing one already-proven contract (`AlgorithmModule<S>`) and one already-proven harness (`WalkForwardSimulator` + `toLeakProofUpcoming`). The EPA side is the lower-risk half: this research fetched Statbotics' actual source (`backend/src/models/epa/{main,math,init,constants,breakdown}.py` and `backend/src/breakdown.py`) directly from GitHub this session and confirms every constant CONTEXT.md recorded (`NORM_MEAN=1500`, `NORM_SD=250`, `INIT_PENALTY=0.2`, `YEAR_ONE_WEIGHT=0.7`, `MEAN_REVERSION=0.4`, `ELIM_WEIGHT=1/3`), plus the parts CONTEXT.md flagged as unread: `get_score_from_breakdown`, `post_process_breakdown`, `post_process_attrib`, and the full `all_keys[year]` component-name table for 2022–2026. Cross-checking that table against this project's own ingested corpus (`data/corpus.sqlite`, queried live this session) shows Statbotics' RP-component naming lines up cleanly with TBA's actual `score_breakdown` boolean flags for every season 2022–2026 (e.g. 2022's `rp_1`/`rp_2` ↔ `cargoBonusRankingPoint`/`hangarBonusRankingPoint`; 2026's `rp_1`/`rp_2`/`rp_3` ↔ `energizedAchieved`/`superchargedAchieved`/`traversalAchieved`), which gives a verified starting point for the per-season component maps D-02 requires.

The Sigma1 side has no reference implementation to check against — Statbotics' own `EPARating` docstring says outright "does not handle covariance between variables," which is precisely the gap D-01/D-03 exist to close. This research works the Kalman math from first principles for the specific 3-vs-3 alliance-sum observation model FRC actually provides, and the central finding is good news for the Phase 4 Worker CPU budget: if each team's belief is modeled as *independent* of its teammates' (the standard simplification used by every Elo/Glicko/TrueSkill-family incremental rating system, and consistent with D-06's no-defense/no-cross-team-latent design), the per-match update for one alliance is O(components × 3) — no matrix inversion at all, dramatically cheaper than OPR's own O(n²) Sherman-Morrison update, which must touch every team seen so far this season. D-09/D-10/D-11's three named "variance" quantities (spread, estimate uncertainty, full predictive variance) map directly onto standard Kalman terms (measurement noise R, posterior covariance P, and P+Q+R respectively) once stated that way, which resolves what would otherwise be an ambiguous design question.

Two concrete, previously-undocumented gaps were found by reading (not assuming) the actual Phase 1 code this session, both load-bearing for this phase: (1) `MatchResult` and `selectMatchesChronological` do not currently carry `score_breakdown_raw` to the harness at all — this is a required plumbing change, not an implementation detail, and it must also be added to `toLeakProofUpcoming`'s `OUTCOME_KEYS` set since it is match-outcome data; (2) using Statbotics' season-final `score_sd` as-is for win-probability scaling would violate walk-forward correctness for any match before the season ends — the fix is a trivial expanding-window (Welford) variance computed match-by-match, not a season-batch constant.

**Primary recommendation:** Build EPA first (lower risk, verifiable math, existing `opr.ts`-style synthetic-fixture tests), verify the plumbing gaps (score_breakdown threading, leak-proof key set) as part of that work, then build Sigma1 on top of the same corrected plumbing — its Kalman update is a small, well-defined extension of the alliance-sum regression OPR and EPA both already do, not a new architecture.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-season score_breakdown component extraction | Offline pipeline (`packages/core`, imported by harness) | — | Pure data transform, must stay Worker-importable per D-27's constraint; no I/O |
| EPA rating computation (predict/update) | Offline pipeline / shared `packages/core` | Cloudflare Worker (Phase 4, same code) | Pure function per `AlgorithmModule<S>`; identical code runs in harness and (later) the live incremental Worker |
| Sigma1 Kalman filter (predict/update) | Offline pipeline / shared `packages/core` | Cloudflare Worker (Phase 4, same code) | Same as EPA — this is exactly why `packages/core` must stay free of Node-only APIs |
| Identifiability check / empirical validation | Offline pipeline (harness-adjacent script or test) | — | One-time analysis over the full corpus, not runtime logic; belongs beside `opr.test.ts`'s synthetic-fixture pattern |
| Multi-algorithm walk-forward replay | Offline harness (`packages/harness/replay.ts`) | — | `WalkForwardSimulator.run` already the sole owner of match visibility; extending it to drive many algorithms over one stream keeps that guarantee |
| Prediction JSONL writer (D-23/D-24/D-25) | Offline harness (`packages/harness`) | — | Side artifact, read-only w.r.t. corpus, never touches storage tiers Phase 4 will use |
| Team metric-history sidecar (D-28) | Offline harness | — | Snapshot capture during the same replay loop, no new compute pass |

## Standard Stack

No new external packages are required for this phase. Everything Sigma1/EPA need is either already a dependency or is simple enough to hand-write (Kalman recursion is a handful of scalar/small-matrix operations; normal CDF via a standard erf approximation; expanding-window variance via Welford's algorithm — none of these justify a new dependency).

### Core (already in `package.json`, reused)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ml-matrix` | 6.15.0 `[VERIFIED: package.json:22]` | Matrix ops if a per-team component covariance matrix needs eigen/Cholesky operations for numerical stability | Already proven in `opr.ts`'s `solveRidgeOpr`; reuse rather than add a stats-specific package |
| `zod` | 4.4.3 `[VERIFIED: package.json:17]` | Schema validation for per-season `score_breakdown` component maps and the v2 artifact schema | Same pattern as `artifact.ts`'s `HarnessArtifactSchema` — a schema that fails a test the moment TBA's shape drifts, per the project's own "docs describe a deleted model" failure log entry |
| `better-sqlite3` | 13.0.3 `[VERIFIED: package.json:16]` | Reads `score_breakdown_raw` from the corpus (once `selectMatchesChronological` is extended to select it — see Common Pitfalls) | Already the corpus access layer |
| `vitest` | 4.1.10 `[VERIFIED: package.json:25]` | Unit tests for EPA/Sigma1 math, synthetic-fixture recovery tests matching `opr.test.ts`'s pattern | Established in Phase 1 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-written Kalman recursion (scalar/small-vector per team-component) | A general-purpose Bayesian filtering library (e.g. a Node port of `pykalman`/`filterpy`) | No mature, actively-maintained TypeScript Kalman library exists at the small scale this problem needs (per-team scalar/low-dimensional state, not full joint tracking) — the math is ~20 lines per update and directly testable, exactly the same call Phase 1 made for `solveRidgeOpr` over `ml-matrix`'s generic overhead |
| Hand-written normal CDF (erf approximation) for D-12 mode 3 | `simple-statistics` or similar stats package | Mode 3 is explicitly deferred (flag flip only); a ~10-line erf approximation (e.g. Abramowitz-Stegun) is standard, dependency-free, and sufficient for a probability display, not a scientific-computing requirement |

**Installation:** none — no new packages.

## Package Legitimacy Audit

**Not applicable this phase.** No new external packages are introduced; Sigma1 and EPA are built entirely on `ml-matrix`, `zod`, and `better-sqlite3`, all already present in `package.json` and audited in Phase 1.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────────┐
                    │  packages/corpus (read-only, Phase 1)         │
                    │  matches.score_breakdown_raw (verbatim JSON)  │
                    └───────────────────┬───────────────────────────┘
                                        │ selectMatchesChronological
                                        │ (MUST be extended to select
                                        │  score_breakdown_raw — gap found)
                                        ▼
                    ┌─────────────────────────────────────────────┐
                    │  packages/harness/replay.ts                   │
                    │  buildSeasonStream → MatchResult[]            │
                    │  toLeakProofUpcoming (MUST add                │
                    │  scoreBreakdownRaw to OUTCOME_KEYS)            │
                    └───────────────────┬───────────────────────────┘
                                        │ one shared chronological stream (D-22)
                                        ▼
        ┌───────────────────────────────────────────────────────────┐
        │  WalkForwardSimulator.run — for EACH match, in order:       │
        │    for each algorithm in {opr, epa, sigma1}:                │
        │      predict(state, leakProofUpcoming) → Prediction         │
        │      record {match, algorithmId, prediction}                │
        │      state = update(state, matchResult)                     │
        │      snapshot teamMetrics(state) for the 6 involved teams    │
        │      (D-28, per algorithm)                                   │
        └───────┬──────────────────────────┬──────────────────────────┘
                │                          │
                ▼                          ▼
   ┌─────────────────────────┐  ┌──────────────────────────────┐
   │ score.ts / artifact.ts   │  │ predictions.ts (NEW, D-23-25) │
   │ aggregateScores per      │  │ predictions-{season}.jsonl     │
   │ algorithmId → slices[]   │  │ full component vectors,        │
   │ → artifact.json (v2)     │  │ variance where available       │
   └─────────────────────────┘  └──────────────────────────────┘
                │
                ▼
   ┌─────────────────────────┐
   │ report.ts — HTML render   │
   │ per-algorithm score table │
   │ + Statbotics reference row│
   └─────────────────────────┘
```

Per-component extraction (the per-season maps D-02 requires) sits as a pure transform between the corpus's raw JSON and the algorithms' `update()` calls:

```
score_breakdown_raw (JSON string, verbatim TBA)
        │  JSON.parse + per-season component map (data-driven, D-02/D-19)
        ▼
ParsedComponents { [componentName]: number }   ← one map per season, keyed 2022..2026
        │
        ├─→ EPA.update(state, result)     — EWMA per component (D-13's faithful core)
        └─→ Sigma1.update(state, result)  — Kalman update per component (D-01/D-03/D-06)
```

### Recommended Project Structure

```
packages/core/algorithms/
├── types.ts                  # existing — extend Prediction with optional component fields
├── opr.ts                    # existing — unchanged
├── epa.ts                    # NEW — EPARating-equivalent EWMA state + predict/update
├── epa-breakdown.ts          # NEW — get_score_from_breakdown / post_process equivalents (D-13's divergence list lives here as comments)
├── sigma1/
│   ├── kalman.ts             # NEW — scalar/per-component Kalman recursion (predict step, alliance-sum update step)
│   ├── consistency.ts        # NEW — D-09/D-11's spread estimator + empirical-Bayes shrinkage
│   ├── linkFunctions.ts      # NEW — D-12's 3 win-probability modes, pluggable
│   └── index.ts              # NEW — Sigma1 AlgorithmModule assembling the above
├── breakdown/
│   ├── 2022.ts … 2026.ts     # NEW — per-season component maps (D-02, D-19: data, not branches)
│   └── index.ts              # season → component map dispatch, cold-start season as a parameter (D-19)
packages/harness/
├── replay.ts                 # extend WalkForwardSimulator to accept AlgorithmModule[] (D-22)
├── cli.ts                    # ALGORITHMS registry gains epa, sigma1; --algorithm accepts a comma list
├── artifact.ts                # ARTIFACT_SCHEMA_VERSION → 2; algorithms[] array (D-20)
├── score.ts                   # HarnessPredictionInput gains algorithmId; aggregateScores keyed by (algorithmId, season, view)
├── predictions.ts             # NEW — D-23/D-24/D-25: PredictionRecord[] → predictions-{season}.jsonl
├── metricHistory.ts           # NEW — D-28: teamMetrics snapshot sidecar per algorithm
└── identifiability.ts         # NEW — SC-3's empirical check (see Common Pitfalls / Validation Architecture)
```

### Pattern 1: EPA as a faithful EWMA port (D-13)

**What:** `EPARating` in Statbotics is a plain mean vector updated by a two-stage exponentially-weighted average — an inner "percent" blend toward the new observation, then an outer "weight" blend that discounts elimination matches without excluding them from state.
**When to use:** The core of `packages/core/algorithms/epa.ts`.
**Verified source** (fetched directly from `github.com/avgupta456/statbotics` this session):

```python
# Source: backend/src/models/epa/math.py (fetched 2026-08-13)
# [CITED: github.com/avgupta456/statbotics/blob/master/backend/src/models/epa/math.py]
class EPARating:
    # all inputs are 1d np arrays, does not handle covariance between variables
    def __init__(self, mean: Any):
        self.mean = mean

    @staticmethod
    def update_mean(mean, x, alpha):
        new_mean = x
        return (1 - alpha) * mean + alpha * new_mean

    def add_obs(self, x, percent, weight):
        mean = self.mean
        new_mean = self.update_mean(mean, x, percent)
        self.mean = weight * new_mean + (1 - weight) * mean
```

```python
# Source: backend/src/models/epa/main.py (fetched 2026-08-13)
# [CITED: github.com/avgupta456/statbotics/blob/master/backend/src/models/epa/main.py]
@staticmethod
def k_func(year: int) -> float:
    return -5 / 8 if year >= 2008 else -5 / 12

@staticmethod
def percent_func(year: int, x: int) -> float:
    prev = min(0.5, max(0.3, 0.5 - 0.2 / 6 * (x - 6)))
    if year <= 2015:
        return 1 / 2 * prev
    return 2 / 3 * prev

def update_team(self, team, attrib, match):
    weight = ELIM_WEIGHT if match.elim else 1     # ELIM_WEIGHT = 1/3
    percent = EPA.percent_func(self.year_num, self.counts[team])
    self.epas[team].add_obs(attrib.epa, percent, weight)
    if not match.elim:
        self.counts[team] += 1
```

For 2022–2026 (`year >= 2008` and `year > 2015` branches), this resolves to: `k = -5/8`; `percent(x) = (2/3) · clamp(0.5 − (0.2/6)·(x−6), 0.3, 0.5)` where `x` is the team's **non-elim** match count so far this season (elims never increment the counter, matching Statbotics' `ELIM_WEIGHT` treatment — this project's D-08 deliberately diverges here, see below). `percent` decays from `1/3` (x=0) down to `0.2` (x≥12) — a decaying learning rate, exactly as D-13 names it.

**Deliberate divergence to document (D-08):** Statbotics halves an elim update's weight (`ELIM_WEIGHT=1/3`) and does not increment the match counter for elims. D-08 locks elims as ordinary observations for this project — full weight, counted normally. Implement `epa.ts`'s `update()` without the `weight` discount and with the counter incrementing on every match. This changes convergence speed relative to Statbotics but is an explicit, already-decided divergence, not a bug — document it inline exactly as D-13 requires ("every deliberate divergence must be documented with its reasoning").

**Win probability (Statbotics-parity, base-10 logistic):**
```python
# Source: backend/src/models/epa/main.py, predict_match (fetched 2026-08-13)
norm_diff = (red_score - blue_score) / self.year_obj.score_sd
win_prob = 1 / (1 + 10 ** (self.k * norm_diff))
```
This is algebraically a natural-exp logistic with a derived scale: `10**(k·x) == exp(k·ln(10)·x)`, so `win_prob = 1 / (1 + exp(-x/scale))` where `x = red_score - blue_score` and `scale = score_sd / (-k · ln(10)) ≈ score_sd / 1.4391` for `k = -5/8`. Implement using the natural-exp form (matches `opr.ts`'s existing `logisticWinProbability` helper shape) with this derived scale — mathematically identical output, one fewer special-cased base.

**⚠️ Walk-forward leakage risk in `score_sd` (see Common Pitfalls, Pitfall EPA-1):** `year_obj.score_sd` in Statbotics is a season-level constant. Used naively (computed once from the full season, applied to every match including week 1) this leaks future variance information into early predictions — a direct violation of this project's own outcome-leakage discipline. Compute it as an **expanding-window statistic** (Welford's algorithm, O(1) per match) over alliance scores seen so far this season, seeded from the prior season's final value at season start (ties into D-16's carryover). See Code Examples for the exact recurrence.

### Pattern 2: Sigma1 as an independent-team Kalman filter over alliance-sum observations

**What:** Each team, per component, carries a Gaussian belief `N(μ, P)` — `μ` the current mean estimate, `P` the posterior uncertainty about `μ`. Teams are treated as *a priori independent* of one another (no cross-team covariance tracked) — the standard simplification used by every incremental pairwise/group rating system (Elo, Glicko, TrueSkill family; PITFALLS.md cites Glicko directly as prior art for variance-carrying ratings). An alliance-level observation is a linear combination (sum) of 3 teams' latent means, exactly the same "one row of a 0/1 design matrix" structure `solveRidgeOpr` already uses — Sigma1 differs from OPR only in solving it incrementally per-alliance with priors instead of batch-regressing the whole season.

**Why independence is the right simplification here (grounded reasoning, not decided by CONTEXT.md):** D-06 already forbids cross-team latent structure (no defense dimension); modeling teams' priors as independent is the direct extension of that same discipline to the *covariance* structure, not just the mean structure. It is also what makes the per-match cost trivial (see below) — a joint covariance across every team seen this season would reintroduce OPR's O(n²) cost, defeating the purpose of choosing an "inherently incremental" filter in the first place (ARCHITECTURE.md's own framing of why Kalman was chosen for Sigma1).

**When to use:** `packages/core/algorithms/sigma1/kalman.ts`, the `update()` half of the `AlgorithmModule<Sigma1State>` contract.

**Cost, concretely — the CONTEXT.md-requested number:** For one alliance-sum observation over 3 rating-eligible teams and 1 component, the update is 3 scalar reads, one 3-term sum, one scalar division, 3 scalar writes — O(1) in team-count, independent of how many teams the season has accumulated (unlike OPR's `IncrementalInverse`, which grows with total teams seen). Scaled to a full match (2 alliances × ~15-25 components, from the per-season component counts measured this session — see Standard Stack/component tables below) that's on the order of 100-150 scalar Kalman updates per match, each a handful of floating-point ops — several orders of magnitude under any plausible interpretation of the Phase 4 Worker's 10ms budget, and cheaper per-match than OPR's own already-proven-fast incremental update. This should still be **measured**, not just estimated, once implemented (mirrors OPR's own `opr.ts` comment culture of measuring before asserting a budget is safe) — flag as a Phase 2 acceptance step.

### Pattern 3: Three named variances map onto three standard Kalman quantities (D-09/D-10/D-11)

| CONTEXT.md name | Standard filtering term | Behavior | Where it's used |
|---|---|---|---|
| "Consistency" / spread (D-09, team-page ±) | Measurement noise `R` — the per-team, per-component variance of a single match's realized contribution around the team's current mean | Roughly stationary per team; estimated online from squared residuals (own EWMA, separate from the Kalman gain machinery); shrunk via D-11's empirical-Bayes blend for thin histories | Team page metric display |
| "Estimate uncertainty" | Posterior covariance `P` — how uncertain the filter is about `μ` itself | Shrinks monotonically as more matches for that team accumulate (classic Kalman convergence); re-inflated by process noise `Q` at every step (D-07's event-boundary bumps) | Not displayed directly; an internal filter quantity |
| "Full predictive variance" (D-10, match-prediction ±) | `P + Q + R`, summed across both teams' component vectors per alliance, then combined per D-03 for the alliance total | The correct quantity for a *forecast* of an unobserved match — captures both "we're unsure about this team's true ability" and "even a known-ability team has an off match" | Match-prediction variance channel, and D-12 mode 2's win-probability denominator |

This mapping is the concrete answer to CONTEXT.md's "what a documented identifiability check... variance propagation... numerical stability" ask — it turns three previously-informal English phrases into three well-understood, separately-testable quantities with known convergence properties, each independently checkable against a synthetic fixture the way `opr.test.ts` checks OPR's ridge solve.

### Anti-Patterns to Avoid

- **Recomputing a per-team joint covariance across all teammates ever played with:** reintroduces OPR's O(n²) cost for no accuracy benefit CONTEXT.md asked for — D-03's "covariance" is about a single team's *own components* correlating with each other (e.g. a team that scores well in auto tends to score well in teleop too), not about cross-team correlation. Track a per-team, per-component-pair covariance (small, fixed-size matrix — at most ~25×25 for the largest 2024 component set), never a cross-team one.
- **Using Statbotics' season-final `score_sd` unmodified:** direct outcome leakage (Pitfall EPA-1 below). Always compute expanding-window.
- **Treating a missing `score_breakdown` (D-05) as zero-valued components:** PITFALLS.md Pitfall 5 already names this failure mode generally; D-05's fallback (proportional residual distribution) is the antidote — never silently coerce `null`/absent to `0`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Matrix inversion for any per-team covariance matrix that does need it (component-covariance, if tracked as a full matrix rather than diagonal) | A hand-written Gaussian elimination / Cholesky | `ml-matrix`'s `SingularValueDecomposition` (already used in `opr.ts`) | Same reasoning `opr.ts`'s own comment gives: "early-season systems are ill-conditioned by construction, and a bespoke elimination is exactly the kind of code that looks finished until one team's row makes it diverge" |
| Normal CDF for D-12 mode 3 | A from-scratch numerical integration of the Gaussian PDF | A standard closed-form erf approximation (Abramowitz-Stegun 7.1.26, ~10 lines, <1.5×10⁻⁷ max error) | Well-established, deterministic, no dependency, sufficient precision for a probability display — this is genuinely simple enough to hand-write correctly, unlike matrix inversion |
| Chronological match ordering | Any new sort in `epa.ts`/`sigma1/*.ts` | `selectMatchesChronological` / `buildSeasonStream` (existing, tested) | Already Phase 1's proven single source of truth — D-22 explicitly says not to re-sort |

**Key insight:** Nothing in this phase's math is exotic enough to justify a new dependency — the discipline that matters is *not reinventing what Phase 1 already solved* (ordering, leak-proofing, ridge-regularized alliance-sum regression) rather than avoiding hand-written math altogether.

## Common Pitfalls

### Pitfall Harness-1: `score_breakdown_raw` is not currently threaded to algorithms at all (structural gap, found this session)

**What goes wrong:** EPA and Sigma1 both need per-component data from `score_breakdown`, but `MatchResult` (`packages/core/algorithms/types.ts:29-36`) has no field for it, and `selectMatchesChronological`'s `SELECT` (`packages/corpus/db.ts:293-296`) does not fetch `score_breakdown_raw` from the `matches` table at all — only `winner`/`red_score`/`blue_score`/RP/`has_score_breakdown`. Building `epa.ts`/`sigma1/*` against the current `MatchResult` type would silently have no component data to read.

**Why it happens:** Phase 1's D-05 deliberately deferred per-season extraction ("until a model needs it") and only normalized totals/winner/RP — this phase is that moment, but the plumbing to get the raw JSON from corpus row to algorithm `update()` call was never built, only the *storage* of the raw JSON (`score_breakdown_raw TEXT` — confirmed in `packages/corpus/schema.sql:38`).

**How to avoid:** Extend `MatchResult` with `scoreBreakdownRaw: string | null` (verbatim JSON, parsed by the per-season component map at the algorithm layer, not the corpus layer — keeps `packages/corpus` season-agnostic per its existing design). Extend `selectMatchesChronological`'s SELECT and row-mapping to include `m.score_breakdown_raw`. Extend `toLeakProofUpcoming`'s `OUTCOME_KEYS` set (`packages/harness/replay.ts:17-24`, currently `winner, redScore, blueScore, redRpEarned, blueRpEarned, hasScoreBreakdown`) to also include `scoreBreakdownRaw` — it is match-outcome data and must be leak-proofed identically to every other outcome field, or the Proxy's guarantee has a hole.

**Warning signs:** `epa.ts`/`sigma1/*.ts` unit tests pass against synthetic fixtures but a full-corpus replay run shows every component staying at its cold-start value — a sign the wiring silently isn't reaching real data.

**Phase to address:** This phase, as an early task (before EPA/Sigma1 logic is written) — it blocks both algorithms equally.

### Pitfall EPA-1: Season-final `score_sd` used as a win-probability scale is outcome leakage

**What goes wrong:** Statbotics computes `year.score_sd` as (effectively) a season-level constant. If EPA reimplementation reads a precomputed, full-season SD when scaling the win-probability logistic for a *week 1* match, the prediction is informed by variance data that includes matches not yet played — a textbook instance of PITFALLS.md's Pitfall 3 (outcome leakage / non-walk-forward evaluation), and it would specifically undermine Success Criterion 2's "EPA runs walk-forward at any point in a season" claim, since a season-batch SD is not actually available "at any point."

**Why it happens:** It is the simplest thing to compute once per season and treat as a constant — exactly the trap PITFALLS.md's Pitfall 3 describes ("vectorized/batch computation... is the most common way this creeps in, because it's much faster to implement than a strict sequential replay").

**How to avoid:** Maintain an expanding-window mean/variance of alliance scores observed so far this season, updated match-by-match via Welford's algorithm (O(1) per match, no leakage by construction since it only ever incorporates matches already replayed). Seed it at season start from the prior season's final value (ties into D-16's carryover machinery, which already needs a season-boundary hook). See Code Examples for the exact recurrence.

**Warning signs:** Backtest accuracy for early-season matches (weeks 1-2) that looks suspiciously *good* relative to late-season — the reverse of the usual cold-start pattern (PITFALLS.md Pitfall 11) is itself a leakage smell, because it means predictions are quietly better-informed than they should be.

**Phase to address:** This phase — `epa.ts`'s win-probability scale and D-12 mode 1's `season_score_sd` both need this fix; Sigma1 should reuse the same expanding-window utility rather than duplicating it.

### Pitfall Sigma1-1: Fouls are the weakest identifiability point, and 2026 changes the field names entirely

**What goes wrong:** D-04 already names fouls as the weakest component; this session's direct corpus query confirms why and adds a concrete, previously-undocumented wrinkle: TBA's `score_breakdown` foul fields are **alliance-level only** (`foulCount`, `techFoulCount` — never per-robot) for 2022-2025, and are **renamed entirely** for 2026 (`majorFoulCount`, `minorFoulCount`, `penalties` — `foulCount`/`techFoulCount` are absent from every 2026 sample checked). A generic parser assuming `foulCount`/`techFoulCount` exist for every season would silently read `undefined` for all of 2026 — exactly PITFALLS.md's Pitfall 6 ("score-breakdown-derived predictions silently break every new game year").

**Verified sparsity** (`data/corpus.sqlite`, queried directly this session — `[VERIFIED: data/corpus.sqlite score_breakdown_raw, queried via node script this session]`):

| Season | Matches with breakdown | Matches with any foul recorded | Foul field name(s) |
|---|---|---|---|
| 2022 | 17,450 | 11,030 (63.2%) | `foulCount`, `techFoulCount` |
| 2023 | 19,838 | 12,911 (65.1%) | `foulCount`, `techFoulCount` |
| 2024 | 21,765 | 7,954 (36.5%) | `foulCount`, `techFoulCount` |
| 2025 | 23,527 | 7,131 (30.3%) | `foulCount`, `techFoulCount` |
| 2026 | 20,110 | 7,425 (36.9%) | `majorFoulCount`, `minorFoulCount` (NOT `foulCount`/`techFoulCount`) |

**Why it happens:** Same root cause as every other per-season schema-drift pitfall in this project — FRC changes its game (and TBA's field naming) every year, and 2026's foul-tracking overhaul (major/minor split replacing count/tech-count) is exactly the kind of change that looks like a data-shape difference but isn't caught unless checked per-season.

**How to avoid:** The per-season component map (D-02) must explicitly alias each season's foul field(s) to a single canonical `foulsCommitted` component name — do not write a "the foul field is always called X" shortcut anywhere. Because the observation is alliance-level (never per-robot), Sigma1's per-team foul-rate estimate is recovered the same way OPR recovers per-team scores from alliance sums — via regression across many alliances, not a direct per-robot read. The identifiability check (see Validation Architecture) must explicitly run its rank/conditioning test against the foul component separately per season and report the result honestly, including for 2026's structurally different fields.

**Phase to address:** This phase — both the per-season component map and the identifiability check.

### Pitfall Sigma1-2: Per-robot fields exist but are keyed by slot position, not by team — the mapping to `red_teams`/`blue_teams` array order is unverified

**What goes wrong:** TBA's `score_breakdown` does expose genuine per-robot data for several seasons (`endgameRobot1/2/3`, `taxiRobot1/2/3`, `autoChargeStationRobot1/2/3`, `autoLineRobot1/2/3`, `autoTowerRobot1/2/3`, etc. — confirmed present in every sampled season 2022-2026 this session). This is exactly the kind of "per-robot game-piece counts if TBA's score breakdown provides them" richer observable PITFALLS.md's Pitfall 2 flags as potentially making a richer model identifiable. But nothing in this research session (a web search and a direct TBA docs fetch, both attempted) could confirm that `Robot1`/`Robot2`/`Robot3` positionally correspond to `red_teams[0]`/`red_teams[1]`/`red_teams[2]` in the same order the corpus stores — TBA's swagger spec was unreachable (404) and its human docs page returned 403 to automated fetch.

**How to avoid:** Treat the positional-correspondence assumption as `[ASSUMED]`, not `[VERIFIED]` (see Assumptions Log, A1). Before relying on it for any per-robot Sigma1 component (e.g. a future "auto mobility" per-robot binary), verify empirically against the corpus: find a match with a known DQ'd or clearly underperforming team and confirm its `RobotN` slot lines up with its known roster position, or cross-reference a small sample against TBA's own website match page (which renders per-robot breakdowns against named teams).

**Phase to address:** This phase, before any per-robot (rather than alliance-level) component is added to a per-season map — flagged in Open Questions below since it is Claude's Discretion territory (exact component list) but should not be silently assumed.

### Pitfall Sigma1-3: The alliance-total-variance formula (D-03) requires a full covariance matrix, not independent per-component variances

**What goes wrong:** A naive reading of D-03 ("variance is the sum of component variances plus their estimated covariance") could be implemented as just summing marginal variances — that's the "plus their estimated covariance" clause silently dropped, understating every match's ± exactly as D-03's own reasoning warns ("ignoring that would understate every match's ± and show up as overconfidence in the calibration curve" — a direct instance of PITFALLS.md Pitfall 10).

**How to avoid:** For a team's component vector `x` with covariance matrix `Σ` (a small, fixed C×C matrix per team, C ≈ 15-25 depending on season — see per-season component counts above), the variance of the team's *total* score contribution is the full quadratic form `1ᵀΣ1` (sum of every entry, not just the diagonal), and the alliance's total variance sums this across its 3 teams (independent-teams assumption, Pattern 2). Track `Σ` via an online covariance estimator over the team's own residual history (its own per-match `observed − predicted` component vectors) — a running/EWMA covariance update (Welford-style, generalized to the matrix case) is the standard, numerically stable approach and keeps the per-team state small and self-contained.

**Phase to address:** This phase — the covariance estimator is explicitly Claude's Discretion in CONTEXT.md, but the *shape* of the formula (full quadratic form, not diagonal sum) is not discretionary; D-03 already specifies it.

## Code Examples

### Expanding-window (Welford) mean/variance — fixes Pitfall EPA-1 and feeds D-12 mode 1

```typescript
// packages/core/scoring/expandingStats.ts (proposed)
// Leak-proof by construction: only ever folds in observations already
// passed to update(); never reads ahead. Seed `mean`/`m2`/`count` from the
// prior season's final values at season start for D-16 carryover.
export interface ExpandingStats {
  readonly count: number;
  readonly mean: number;
  readonly m2: number; // sum of squared deviations from the running mean
}

export function emptyExpandingStats(): ExpandingStats {
  return { count: 0, mean: 0, m2: 0 };
}

export function foldObservation(stats: ExpandingStats, x: number): ExpandingStats {
  const count = stats.count + 1;
  const delta = x - stats.mean;
  const mean = stats.mean + delta / count;
  const delta2 = x - mean;
  const m2 = stats.m2 + delta * delta2;
  return { count, mean, m2 };
}

export function standardDeviation(stats: ExpandingStats, fallback: number): number {
  if (stats.count < 2) return fallback; // undefined for n<2 — use a documented prior/fallback
  return Math.sqrt(stats.m2 / stats.count);
}
```

### Sigma1 Kalman update — alliance-sum observation over 3 independent-prior teams

```typescript
// packages/core/algorithms/sigma1/kalman.ts (proposed)
// One component, one alliance, one match. Generalizes trivially: call once
// per component in the per-season map, for both alliances.
export interface TeamComponentBelief {
  readonly mean: number;
  /** Posterior uncertainty about `mean` (P) — shrinks with more observations. */
  readonly variance: number;
}

/** D-07's event-boundary process noise bump, applied before the update below. */
export function applyProcessNoise(belief: TeamComponentBelief, q: number): TeamComponentBelief {
  return { mean: belief.mean, variance: belief.variance + q };
}

/**
 * Joint Kalman update for 3 teammates observed only through their SUM
 * (the alliance's component total). Kalman gain per team is proportional
 * to that team's own uncertainty relative to the pooled uncertainty —
 * a team we're more unsure about absorbs more of the innovation, exactly
 * mirroring OPR's own regression intuition but computed per-alliance
 * instead of via a global solve.
 */
export function updateAllianceSum(
  teammates: readonly TeamComponentBelief[], // exactly the rating-eligible teams (D-07's surrogate policy still applies)
  observedSum: number,
  measurementNoise: number // R — this alliance-component's estimated observation noise
): TeamComponentBelief[] {
  const predictedSum = teammates.reduce((s, t) => s + t.mean, 0);
  const pooledVariance = teammates.reduce((s, t) => s + t.variance, 0) + measurementNoise;
  const innovation = observedSum - predictedSum;

  return teammates.map((t) => {
    const gain = t.variance / pooledVariance; // K_j = P_j / (ΣP_i + R)
    return {
      mean: t.mean + gain * innovation,
      variance: t.variance * (1 - gain), // P_j -= K_j * P_j
    };
  });
}
```

### Alliance total predictive variance (D-03's full quadratic form, D-10's "full predictive variance")

```typescript
// One team's full CxC covariance matrix (tracked via an online covariance
// estimator over that team's own residual history — Claude's Discretion
// for the estimator itself; the formula below is not discretionary, D-03
// already specifies it).
function teamTotalVariance(covariance: number[][]): number {
  let total = 0;
  for (const row of covariance) for (const v of row) total += v; // 1^T Σ 1
  return total;
}

function allianceTotalPredictiveVariance(teamCovariances: readonly number[][][]): number {
  // Independent-teams assumption (Pattern 2) — sum across the 3 teammates.
  return teamCovariances.reduce((sum, cov) => sum + teamTotalVariance(cov), 0);
}
```

### D-12's three win-probability link modes

```typescript
// packages/core/algorithms/sigma1/linkFunctions.ts (proposed)
export type WinProbMode = "season-sd" | "predictive-variance" | "normal-cdf";

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// Abramowitz-Stegun 7.1.26 erf approximation — deferred mode 3, shipped as
// a flag flip per D-12's requirement, not a rewrite.
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(x: number, sd: number): number {
  if (sd <= 0) return x > 0 ? 1 : x < 0 ? 0 : 0.5;
  return 0.5 * (1 + erf(x / (sd * Math.SQRT2)));
}

export function winProbability(
  mode: WinProbMode,
  margin: number, // redScore - blueScore
  seasonScoreSd: number, // expanding-window SD, NOT season-final (Pitfall EPA-1)
  predictiveVariance: number, // D-10's full predictive variance, red+blue combined
  c: number // Phase 3 tunable scale constant, mode 2 only
): number {
  switch (mode) {
    case "season-sd":
      // Statbotics-parity — collapses mode 2 to this when predictiveVariance
      // is replaced by a season constant, per D-12.
      return logistic(margin / seasonScoreSd);
    case "predictive-variance":
      return logistic(margin / (c * Math.sqrt(predictiveVariance)));
    case "normal-cdf":
      return normalCdf(margin, Math.sqrt(predictiveVariance));
  }
}
```

### `Prediction` and `MatchResult` extensions (proposed, non-breaking for OPR)

```typescript
// packages/core/algorithms/types.ts — additive, OPR untouched
export interface MatchResult extends UpcomingMatch {
  // ...existing fields unchanged...
  /** Verbatim TBA score_breakdown JSON, or null if TBA omitted it (has_score_breakdown=0). */
  scoreBreakdownRaw: string | null;
}

export interface ComponentPrediction {
  mean: number;
  /** Present only for algorithms carrying variance (Sigma1). */
  variance?: number;
}

export interface Prediction {
  // ...existing fields unchanged (winner, pRedWin, redScore, blueScore, variance?)...
  /** D-24: full component vectors, present only for algorithms that decompose scores (EPA, Sigma1). */
  redComponents?: Record<string, ComponentPrediction>;
  blueComponents?: Record<string, ComponentPrediction>;
}
```

## State of the Art

| Old Approach (this project's prior implementation of this idea, pre-v3, NOT to be consulted per clean-slate mandate) | Current Approach (Phase 2) | Impact |
|---|---|---|
| n/a — clean-slate rebuild, no prior v3 approach exists to compare against | EPA faithful-core reimplementation verified against live Statbotics source; Sigma1 is a genuinely new design (variance-carrying, per-component) with no direct predecessor in either this project or Statbotics | This phase's "state of the art" comparison is *external* (vs. Statbotics' shipped EPA), not internal — see D-15's honest-but-loud unverified-reference-row framing |

**Deprecated/outdated:** Not applicable — this is greenfield algorithm work within an already-current stack.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | TBA's per-robot `score_breakdown` fields (`endgameRobot1/2/3`, `autoLineRobot1/2/3`, etc.) correspond positionally to `red_teams`/`blue_teams` array order (`red_teams[0]` = Robot1, etc.) | Common Pitfalls, Pitfall Sigma1-2 | If wrong, any per-robot component built on this assumption silently attributes one team's per-robot performance to a different team — a correctness bug that would not throw, only quietly degrade accuracy and calibration for that component. Verify empirically before using any per-robot field beyond the alliance-level totals already handled safely by D-04/D-01's alliance-sum regression approach. |
| A2 | Sigma1's teams-are-a-priori-independent simplification (no cross-team covariance tracked) is an acceptable design choice rather than a modeling error | Architecture Patterns, Pattern 2 | If this loses meaningful accuracy vs. a jointly-correlated model, Phase 3's tune-season backtest will show it as a measurable gap vs. OPR/EPA on the same corpus — the harness (D-21's "raw numbers only, tiebreaker is measured accuracy") is exactly the mechanism to catch this, so the risk is bounded and self-correcting, not silent |
| A3 | An online/EWMA covariance estimator (rather than a batch/windowed one) is adequate for D-03's per-team component covariance | Common Pitfalls, Pitfall Sigma1-3 | If a team's component correlations genuinely shift within a season (e.g. a robot redesign mid-season changes which components covary), an EWMA estimator adapts but a naive one might not fully separate "consistency drift" from "correlation drift" — flagged as a design detail Claude's Discretion already covers; not expected to be a major risk given D-07's process-noise bumps already handle mean-level regime shifts |
| A4 | The confidence tier this research assigns to Statbotics' GitHub source excerpts (`[CITED: github.com/avgupta456/statbotics/...]`) — this project's `classify-confidence` seam returns `LOW` for the generic `webfetch` provider even when cross-checked (`verified: true`), but these are direct, verbatim reads of the actual reference implementation's source code (the authoritative statement of "what Statbotics does," which D-13 explicitly designates as the standard to match), not third-party commentary about it | Architecture Patterns (Pattern 1), Code Examples | If the live repo has since diverged from what was fetched 2026-08-13 (unlikely to have changed materially before this phase is planned/executed, but repos do move), the EPA constants/formulas here could be stale — mitigated by this being a well-established, stable part of Statbotics' codebase (constants unchanged across the versions this project has cross-referenced) and by the fact that D-13 only requires matching the *shape* of the algorithm, with every divergence already documented |

**If this table is empty:** N/A — see entries above.

## Open Questions

1. **Exact per-season component list for 2022-2026 (Claude's Discretion, CONTEXT.md)**
   - What we know: Statbotics' `all_keys[year]` (verified, quoted verbatim above) gives a semantic component list per season; this project's own corpus (`data/corpus.sqlite`, queried this session) gives the actual TBA field names per season, and the two cross-reference cleanly for every RP field checked (2022 `cargoBonusRankingPoint`/`hangarBonusRankingPoint` ↔ `cargo_rp`/`hangar_rp`; 2026 `energizedAchieved`/`superchargedAchieved`/`traversalAchieved` ↔ `energized_rp`/`supercharged_rp`/`traversal_rp`).
   - What's unclear: The exact final component *granularity* this project wants per non-RP component (e.g. whether 2024's `autoAmpNoteCount`/`autoAmpNotePoints`/`autoSpeakerNoteCount`/`autoSpeakerNotePoints` collapse into one `autoNotePoints` component like Statbotics does, or stay split, per D-01's "within reason" latitude) is not locked by any decision — it's explicitly the planner's/implementer's call.
   - Recommendation: Build the per-season maps directly from this session's verified TBA field lists (reproduced in full in Pitfall Sigma1-1's table and the raw key dumps below), using Statbotics' grouping as the default granularity per D-01's "when in doubt, match Statbotics" tiebreaker, diverging only where D-04 (fouls, per-team not alliance-rate) already requires it.

2. **Per-robot field positional mapping (A1 above)**
   - What we know: The fields exist for every sampled season; TBA's public docs could not be fetched to confirm the ordering convention this session.
   - What's unclear: Whether `Robot1`/`Robot2`/`Robot3` reliably equals array index 0/1/2 across all events (TBA occasionally has data-entry quirks per PITFALLS.md's general TBA-quirks pitfall).
   - Recommendation: Treat as out of scope for Phase 2's initial component maps (rely on alliance-level totals only, which are unambiguous); revisit only if a future Sigma-version wants genuine per-robot decomposition.

3. **Exact numeric hyperparameter defaults (hyperparameters explicitly deferred to Phase 3, but Phase 2 must ship *some* working default)**
   - What we know: D-07 (process noise), D-11 (shrinkage blend rate), D-16/D-17 (carryover decay), D-12's `c` constant are all named as "Phase 3 tunes, Phase 2 ships defensible defaults."
   - What's unclear: The actual starting numbers — this research does not propose specific values (that would be presenting an assumption as a locked default); the planner should treat these as literal placeholder constants analogous to `OPR_RIDGE_LAMBDA = 3`'s documented-but-provisional style in `opr.ts`, with a comment naming them as Phase 3's tuning target.
   - Recommendation: Pick conservative, clearly-labeled starting values (e.g. small process noise, moderate shrinkage) and document each as `// Phase 3 hyperparameter, default unverified` — consistent with `opr.ts`'s own comment culture (`OPR_RIDGE_LAMBDA`'s doc comment explains its magnitude reasoning even though it's a fixed constant, not tuned).

## Environment Availability

No new external dependencies are introduced this phase (see Package Legitimacy Audit). All required tooling was already verified working in Phase 1.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Pipeline runtime | ✓ (Phase 1 executed successfully) | 24.x LTS per STACK.md | — |
| pnpm workspaces | Package management | ✓ (Phase 1 executed successfully) | 11.21.x per `packageManager` field | — |
| `ml-matrix`, `zod`, `better-sqlite3`, `vitest` | Math, schema validation, corpus reads, tests | ✓ `[VERIFIED: package.json]` | 6.15.0 / 4.4.3 / 13.0.3 / 4.1.10 | — |
| `data/corpus.sqlite` | Source data for EPA/Sigma1 replay | ✓ (queried directly this session, 2022-2026 present) | — | — |

**Missing dependencies with no fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.10 `[VERIFIED: package.json:25]` |
| Config file | none — `vitest run` via the `test` npm script (`package.json:9`), matching Phase 1's convention (no dedicated `vitest.config.ts` found in the repo) |
| Quick run command | `pnpm test -- packages/core/algorithms/epa.test.ts` (or the relevant new test file) |
| Full suite command | `pnpm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ALGO-02 (SC-1) | Harness scores OPR/EPA/Sigma1 head-to-head in one run, one comparable table | integration | `pnpm test -- packages/harness/replay.multiAlgorithm.test.ts` | ❌ Wave 0 |
| ALGO-02 (SC-2) | EPA runs walk-forward at any point in a season; spot-check tolerance vs Statbotics | unit (synthetic fixture, since live comparison is D-14-blocked) | `pnpm test -- packages/core/algorithms/epa.test.ts` | ❌ Wave 0 |
| ALGO-02 | EPA win-probability scale is walk-forward-safe (Pitfall EPA-1 regression test) | unit | `pnpm test -- packages/core/scoring/expandingStats.test.ts` | ❌ Wave 0 |
| ALGO-03 (SC-3) | Sigma1 reports mean+variance per team metric; identifiability check documented and empirical | unit + script | `pnpm test -- packages/core/algorithms/sigma1/kalman.test.ts` + `tsx packages/harness/identifiability.ts` | ❌ Wave 0 |
| ALGO-03 | D-03's full predictive-variance quadratic form (not diagonal sum) | unit | `pnpm test -- packages/core/algorithms/sigma1/covariance.test.ts` | ❌ Wave 0 |
| ALGO-07 (SC-4) | Every match has predicted winner/win-prob/scores per algorithm; Sigma1 carries variance | integration | `pnpm test -- packages/harness/predictions.test.ts` | ❌ Wave 0 |
| ALGO-07 | `MatchResult`/leak-proof plumbing carries `scoreBreakdownRaw` without leaking it pre-`update()` | unit (leakage regression, matches `replay.test.ts`'s existing pattern) | `pnpm test -- packages/harness/replay.test.ts` | ✅ existing file, extend |
| D-20/D-21 | Artifact schema v2 validates `algorithms[]` array, `slices[]` tagged by `algorithmId` | unit | `pnpm test -- packages/harness/artifact.test.ts` | ✅ existing file, extend |

### Sampling Rate
- **Per task commit:** targeted `pnpm test -- <changed file>.test.ts`
- **Per wave merge:** `pnpm test` (full suite)
- **Phase gate:** Full suite green, plus a real `pnpm harness --seasons 2022-2026 --algorithm opr,epa,sigma1` run completing without throwing, before `/gsd-verify-work`

### Sampling/coverage argument for walk-forward evaluation across 2022-2026

The tune/holdout split (D-09, already locked in Phase 1: 2022-2024 tune, 2025-2026 holdout) is the sampling design this phase inherits, not something Phase 2 redefines. Phase 2's job is to make sure EPA and Sigma1 are exercised across **every** season in both splits during development (not just one representative season) — because per-season `score_breakdown` schema drift (documented extensively above) means a component map that works for 2024 can silently fail for 2026 without a full 2022-2026 run ever having been done. The `pnpm harness --seasons 2022-2026` full-range command already exists and is the correct coverage mechanism; Phase 2 tasks should run it (not just single-season smoke tests) before considering the phase done, consistent with PITFALLS.md's "Looks Done But Isn't" checklist item for evaluation harnesses ("verify it runs all algorithms... over all seasons 2022-2026").

### Wave 0 Gaps
- [ ] `packages/core/algorithms/epa.test.ts` — synthetic-fixture tests for EWMA update, `percent_func`/`k_func` math, cross-checked against hand-computed values from the verified Statbotics constants
- [ ] `packages/core/algorithms/sigma1/kalman.test.ts` — synthetic-fixture recovery test analogous to `opr.test.ts`'s "recovers known synthetic team strengths within a documented tolerance," extended to check variance shrinks monotonically with observation count
- [ ] `packages/core/algorithms/sigma1/covariance.test.ts` — verifies the `1ᵀΣ1` quadratic form against a hand-computed 2x2/3x3 example
- [ ] `packages/core/scoring/expandingStats.test.ts` — Welford recurrence correctness + a leakage regression (assert a later observation cannot change an earlier `standardDeviation()` result)
- [ ] `packages/harness/replay.multiAlgorithm.test.ts` — `WalkForwardSimulator` driving `{opr, epa, sigma1}` over one shared stream, asserting byte-identical match order seen by all three (D-22's guarantee)
- [ ] `packages/harness/predictions.test.ts` — JSONL writer round-trip, one record per (match, algorithm), component vectors present per D-24
- [ ] `packages/harness/identifiability.ts` — not a Vitest file but a runnable script producing the SC-3 write-up; treat its successful run (no crash, condition numbers reported per season per component) as the acceptance check
- [ ] Extend existing `packages/harness/replay.test.ts` — add a case proving `scoreBreakdownRaw` throws via the leak-proof Proxy exactly like the other outcome fields already do

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No user-facing auth surface in this phase — pure offline compute |
| V3 Session Management | No | N/A |
| V4 Access Control | No | N/A |
| V5 Input Validation | Yes | `score_breakdown_raw` is third-party JSON (TBA) already stored verbatim; the per-season component parsers (new this phase) are the first code to actually *read* structured fields out of it — parse defensively with Zod per-season schemas (matching `HarnessArtifactSchema`'s existing pattern) rather than assuming field presence/type, and explicitly reject/flag `NaN`/`Infinity` before they enter Kalman state (a malformed or unexpectedly-typed field could otherwise silently poison every downstream rating — a correctness/availability concern as much as a security one, but the standard control is the same: validate at the parse boundary) |
| V6 Cryptography | No | No secrets/crypto introduced this phase (existing TBA-key handling from Phase 1 is unchanged) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed/adversarial `score_breakdown` JSON (TBA is a third party; a corrupted or unexpectedly-shaped payload is plausible even if not malicious) silently propagating `NaN`/`undefined` into rating state | Tampering (of the data pipeline's integrity, not a live attacker) | Zod-validate every per-season component parser's output; assert finite numbers before folding into Kalman/EWMA state; fail loudly (throw) rather than silently coercing, matching this project's existing "never coerce null to zero" discipline (D-05) |
| A secret (TBA API key) accidentally serialized into a new artifact type this phase introduces (`predictions-{season}.jsonl`, the identifiability report) | Information Disclosure | Reuse the existing `writeArtifact`/`secretToScrub` pattern (`packages/harness/artifact.ts:119-128`) for any new file-writing path this phase adds — this phase's new writers (`predictions.ts`, `identifiability.ts`) never touch TBA credentials directly (they read only from the already-ingested read-only corpus), but the scrub-before-write discipline should still apply defensively to any new `writeFileSync` call |

## Sources

### Primary (verified this session against live/authoritative sources)
- `data/corpus.sqlite` — this project's own ingested TBA corpus, queried directly via `better-sqlite3` this session for: per-season `score_breakdown` key lists (2022-2026), per-robot field presence, foul-field naming and sparsity, per-season alliance score mean/SD — `[VERIFIED: data/corpus.sqlite, queried via node script this session]`
- `packages/core/algorithms/types.ts`, `opr.ts` — read in full this session — `[VERIFIED: packages/core/algorithms/types.ts, opr.ts]`
- `packages/harness/replay.ts`, `cli.ts`, `artifact.ts`, `score.ts`, `statbotics.ts`, `report.ts` — read in full or in relevant part this session — `[VERIFIED: packages/harness/*]`
- `packages/corpus/schema.sql`, `db.ts` — read in full this session — `[VERIFIED: packages/corpus/schema.sql, db.ts]`
- `package.json` — read this session for exact dependency versions — `[VERIFIED: package.json]`

### Secondary (CITED — direct verbatim reads of Statbotics' live source repo this session; project's own `classify-confidence` seam rates the generic `webfetch` provider LOW even when cross-checked — see Assumption A4 for why this research treats these as more authoritative than that generic default)
- `github.com/avgupta456/statbotics/blob/master/backend/src/models/epa/math.py` — `EPARating`, `update_mean`, `add_obs`, `zero_sigmoid`, `unit_sigmoid` — fetched verbatim
- `github.com/avgupta456/statbotics/blob/master/backend/src/models/epa/main.py` — `predict_match`, `attribute_match`, `update_team`, `k_func`, `percent_func`, `margin_func` — fetched verbatim
- `github.com/avgupta456/statbotics/blob/master/backend/src/models/epa/init.py` — `get_init_epa`, cold-start/carryover math — fetched verbatim
- `github.com/avgupta456/statbotics/blob/master/backend/src/models/epa/constants.py` — `NORM_MEAN`, `NORM_SD`, `INIT_PENALTY`, `YEAR_ONE_WEIGHT`, `MEAN_REVERSION`, `ELIM_WEIGHT` — fetched verbatim, matches CONTEXT.md's prior recording exactly
- `github.com/avgupta456/statbotics/blob/master/backend/src/models/epa/breakdown.py` — `post_process_breakdown`, `get_score_from_breakdown`, `post_process_attrib` — fetched verbatim (CONTEXT.md flagged this file as not yet read; now verified)
- `github.com/avgupta456/statbotics/blob/master/backend/src/breakdown.py` — `key_to_name`, `derived_breakdown`, `all_keys` generation for 2016-2026 — fetched verbatim (CONTEXT.md incorrectly located this at `backend/src/tba/breakdown.py`; corrected location confirmed this session at `backend/src/breakdown.py`)

### Tertiary (LOW confidence, not resolved this session)
- TBA APIv3 per-robot field ordering convention (Robot1/2/3 ↔ alliance array position) — WebSearch and WebFetch both attempted, neither confirmed; treated as `[ASSUMED]` (A1)
- Inherited from `.planning/research/PITFALLS.md`, `ARCHITECTURE.md`, `STACK.md` (2026-08-12, MEDIUM confidence per their own headers) — Kalman/Glicko-family prior-art framing, Cloudflare Worker CPU-budget constraint

## Metadata

**Confidence breakdown:**
- EPA math/constants: HIGH — verified verbatim against live source, cross-checked against CONTEXT.md's prior recording (exact match), and cross-checked against this project's own corpus for RP field naming
- Per-season component maps (exact list): MEDIUM — the field inventory is verified (corpus query), but the exact grouping/granularity choice is explicitly Claude's Discretion, not yet made
- Sigma1 Kalman design: MEDIUM — mathematically sound first-principles derivation grounded in standard filtering theory and this project's own failure log, but genuinely novel (no reference implementation exists to check against, unlike EPA)
- Identifiability check design: MEDIUM — methodologically grounded (reuses OPR's already-proven rank/conditioning approach per-component) and backed by real sparsity measurements for the weakest component (fouls), but the specific pass/fail thresholds are not yet defined (left to the planner/implementer)
- Harness structural gaps (score_breakdown plumbing): HIGH — found by direct code reading this session, not inference

**Research date:** 2026-08-13
**Valid until:** ~30 days for the harness/plumbing findings (stable, low-churn code); Statbotics source citations should be re-verified if this phase's planning is delayed more than a few weeks, since it is an external repo outside this project's control
