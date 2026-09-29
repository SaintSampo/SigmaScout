# Phase 3: Tuning, Ranking Points & Versioning - Research

**Researched:** 2026-08-14
**Domain:** Offline hyperparameter search, FRC ranking-point rules (2022-2026), algorithm versioning/reproducibility
**Confidence:** HIGH (RP rules, existing-code integration points) / MEDIUM (search algorithm choice, RP joint-distribution mechanics)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** The optimizer minimizes tune-season Brier score. Winner accuracy is computed and reported at every evaluation but never steers the search.
- **D-02:** SC-3 keeps its literal reading — tuned Sigma1 must beat both OPR and EPA on holdout Brier *and* holdout winner accuracy, on both holdout seasons. A shortfall is recorded explicitly, never redefined away. Starting position (`reports/full-v2`): Sigma1 already wins holdout Brier both seasons (2025: 0.1662 vs OPR 0.1675; 2026: 0.1554 vs OPR 0.1773) and loses holdout winner accuracy both seasons (2025: 0.7539 vs OPR 0.7618; 2026: 0.7819 vs OPR 0.7825).
- **D-03:** Two-stage search: (a) one-at-a-time sensitivity screen over every constant tagged "Phase 3 hyperparameter, default unverified", published as its own artifact; then (b) a joint search over only the survivors.
- **D-04:** Only Sigma1 is tuned. EPA and OPR stay frozen at Phase 2 defaults. `packages/core/algorithms/carryover.ts` must be split so Sigma1 carries its own tunable copy of the shared EPA/Sigma1 carry constants while EPA's stay pinned.
- **D-05:** Adaptation = innovation-driven noise adaptation (process/measurement noise scales from a team's own recent innovation/residual statistics). Off = both pinned at tuned constants.
- **D-06:** On/off comparison = two independent optimizer runs compared best-vs-best.
- **D-07:** Adaptation operates at one scalar factor per team, shared across components, from aggregate innovation history — not per-component, not league-only.
- **D-08:** If best-vs-best shows no improvement, adaptation ships disabled (flag stays in tree) and the negative result is written up.
- **D-09:** Bonus RP prediction runs off a parallel count-unit Kalman state, kept separate from the score-component vector. Each season's map is extended to extract only the count fields its RP rules threshold on.
- **D-10:** Each alliance's RP prediction carries the full discrete pmf `P(RP = 0..N)`; mean/SD are derived from it.
- **D-11:** Winning and clearing bonus thresholds are modeled as correlated via a joint model — one set of draws produces score, opponent score, and counts together. Flagged for Phase 4: Monte Carlo cost must be checked against the 10ms Worker CPU budget on the incremental path (NOT a Phase 3 constraint).
- **D-12:** SC-4 discharged two ways: manual is the authoring source (cited by section per rule module), and a corpus-wide reconciliation test (100% of played matches) recomputes every bonus flag from raw breakdown fields and asserts it reproduces TBA's own recorded flag, with summed RP reproducing `red_rp_earned`/`blue_rp_earned`.
- **D-13:** A version = a code version + a named, committed parameter set (e.g. `sigma1@2.1` = code 2.x + params `tuned-2026-08`). Rejected: frozen module per version, content hashing.
- **D-14:** A search evaluation is an experiment, not a version — only explicit promotion (with provenance) creates a version.
- **D-15:** SC-5 proven by a committed digest (headline metrics per season + a hash over the full prediction stream) plus a CI test that re-runs the version on a bounded deterministic slice and asserts both match. Full-corpus reproduction stays a manual verification-time check, not a CI gate.
- **D-16:** "Unchanged" = bitwise identical. PRNG seed is part of the versioned parameter set; `Math.random` banned from the prediction path; iteration order must be stable. Deterministic numerical integration instead of sampling (for D-11) would satisfy this trivially and remove Phase 4's Monte Carlo cost — open to the planner, not required.

### Claude's Discretion

- Overfitting guard for tune seasons — leave-one-season-out across 2022-2024 vs. an internal validation split vs. something else.
- Whether holdout blindness is enforced structurally (recommended, following `toLeakProofUpcoming`'s precedent) or merely conventional.
- Search algorithm and compute budget — grid vs. random vs. Bayesian/CMA-ES, evaluation count, parallelism, where the search runs. Grounding: ~0.9-1.3ms/match update cost measured in Phase 2, so a full 2022-2024 tune replay is ~1 minute.
- Adaptation details — innovation window length, stability bounds, whether adaptation touches the D-09 team-page consistency estimate, how the on/off pair registers in `ALGORITHMS`.
- RP details — which count fields each season needs, how count state initializes/carries across season boundaries, Monte Carlo draw count (or deterministic alternative), RP handling for elimination matches and the `has_score_breakdown = 0` fallback population.
- Artifact schema evolution — whether RP predictions and richer version identity require `ARTIFACT_SCHEMA_VERSION` 3.
- Naming for untuned Phase-2 Sigma1 vs. tuned Phase-3 Sigma1 in the registry/dropdown.
- Whether the sensitivity screen's output gets its own committed document (recommended).

### Deferred Ideas (OUT OF SCOPE)

- Deterministic numerical integration for the RP pmf — left open to the planner as an implementation route, not deferred to a later phase.
- Full-corpus reproduction as a promotion gate — available as a manual step, not automated in CI.
- Tuning EPA as a second, separately-budgeted search — rejected for this phase (dissolves the Statbotics-comparison story).
- Per-team-per-component adaptation — blocked on an identifiability argument that survives the failure log's lesson.
- Defense as a diagnostic — still open, still not this phase.
- Recompute the corpus from 2016 (ENH-04, v2) — cold-start season stays a parameter.
- A sourced, verified Statbotics accuracy reference row — still Phase 1's dated unverified stub.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ALGO-04 | Sigma1 hyperparameters set by an offline optimizer searching against tune-season backtest score | "Hyperparameter Search Strategy" (screen + joint search design, no viable off-the-shelf npm package), "Don't Hand-Roll" (reuse `mulberry32`/`ml-matrix`), Code Examples |
| ALGO-05 | Sigma1 adapts online within a season; harness validates adaptation improves holdout score (on vs. off) | "Online Adaptation" architecture pattern, integration points into `kalman.ts`/`ExpandingStats`, `ALGORITHMS` registry precedent |
| ALGO-06 | Algorithm versions first-class in the data model; any past version replays identically | "Versioning & Reproducibility" pattern, `AlgorithmModule.version`/`artifact.ts`'s `AlgorithmDescriptorSchema` integration points, digest/hash mechanics |
| ALGO-08 | Ranking points predicted per match with variance, using each season's RP rules (2022-2026) | "FRC Ranking-Point Rules 2022-2026" (fully verified per-season table), "RP Distribution Computation" (Monte Carlo vs. deterministic recommendation), "Runtime State Inventory"-style event-tier pitfall |
</phase_requirements>

## Summary

This phase has two genuinely separate bodies of work bolted onto one Sigma1 codebase: (1) a **tuning/versioning infrastructure** problem (search, promotion, reproducibility digest) that is mostly disciplined software engineering reusing patterns this project has already proven (`mulberry32` seeded PRNG from `identifiability.ts`, the `ALGORITHMS` registry, `AlgorithmModule.version`), and (2) a **domain-knowledge** problem — the exact FRC ranking-point rules for five different games — that this session resolved by directly querying the live 351MB local corpus (`data/corpus.sqlite`) rather than trusting web search or training memory. That direct-verification approach surfaced two facts a generic implementation would get wrong: **RP win-value changed from 2 to 3 starting in 2025**, and **RP bonus thresholds scale by event tier (Regional/District vs. District Championship vs. FIRST Championship) in four of five seasons, but *which* tiers get the bump is season-specific and not consistent** (2023 only bumps at Championship; 2024 bumps at both District Championship and Championship, at different amounts). A hard-coded single threshold per season, following 2022's simplicity, would silently mispredict every District-Championship-and-above match in 2023-2026.

The npm ecosystem has no viable hyperparameter-optimization package for this project's language/runtime (`cma-es`, `optuna`, `bayesian-optimization` do not exist or are unpublished on npm; `hpjs` is a name collision with an unrelated abandoned package) — this reinforces the project's existing anti-"add a dependency preemptively" posture: hand-roll a sensitivity screen (mirroring `identifiability.ts`'s committed-script shape) followed by a seeded random search, reusing `mulberry32` and (for the RP joint-draw covariance) `ml-matrix`'s already-installed `CholeskyDecomposition`.

**Primary recommendation:** Build the RP rule modules from the verified per-season table below (not from the manual's HTML alone — the corpus reconciliation catches tier exceptions the manual prose glosses over), thread a `Sigma1Params` object through every currently-hardcoded module constant so the tuner has something to search over, hand-roll a two-stage grid/random search rather than reaching for a nonexistent npm package, and implement D-11's joint RP distribution as seeded Monte Carlo (not hand-rolled multivariate-normal-CDF integration) since Phase 3 has no CPU-budget constraint and Monte Carlo composes trivially with more RP dimensions later.

## Architectural Responsibility Map

This phase is entirely offline/pipeline work — no browser, SSR, or edge tier is touched. Tiers below map to this project's own topology (CLAUDE.md's "Data Pipeline & Compute Runtime" section), not a generic web app's.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Hyperparameter search (screen + joint) | Offline Node Pipeline (`packages/harness`, new script) | — | Bulk compute outside any CPU-time budget; mirrors `identifiability.ts`'s standalone-script precedent |
| Parameter-set injection into Sigma1's `predict`/`update` | `packages/core/algorithms/sigma1/*` | — | Must stay Worker-importable (no Node-only APIs) — the tuner writes data, `core` only consumes it |
| RP rule modules (per-season thresholds) | `packages/core/algorithms/breakdown/*` (or a sibling `rp/*`) | — | Same "must stay Worker-importable" constraint as every other component map; Phase 4's Worker needs these at serve time too |
| RP joint-distribution sampling (Monte Carlo) | `packages/core/algorithms/sigma1/*` | — | Runs inside `predict()`, which both the harness and (Phase 4) the Worker call — must stay in `core` |
| Version promotion / digest generation | Offline Node Pipeline (`packages/harness`) | — | One-time, human-triggered action producing committed data, not a hot path |
| CI reproducibility test | Vitest (`packages/harness/*.test.ts`) | — | Runs the bounded deterministic slice against the committed digest |
| Artifact schema (possible v3) | `packages/harness/artifact.ts` | — | Already the sole schema-of-record; Phase 8's Compare page reads this shape later |

## Standard Stack

### Core (already installed — no version bump needed)

| Library | Installed Version | Purpose in Phase 3 | Why Standard |
|---------|---------|---------|--------------|
| `ml-matrix` | 6.15.0 [VERIFIED: `npm view ml-matrix version`, matches `package.json:23`] | `CholeskyDecomposition` for D-11's correlated Monte Carlo draws | Already a devDependency, already used for SVD in `identifiability.ts`; exports confirmed this session via `Object.keys(require('ml-matrix'))` -> includes `CholeskyDecomposition` [VERIFIED: direct Node inspection this session] |
| `zod` | 4.4.3 [VERIFIED: `package.json:18`] | Parameter-set schema (D-13's committed, reviewable data), RP rule-module raw-field schemas | Already the project's schema-validation standard for every other parse boundary |
| `better-sqlite3` | 13.0.3 [VERIFIED: `package.json:17`] | Reading `score_breakdown_raw`'s bonus-flag fields for the D-12 reconciliation test | Already the corpus access layer |
| `tsx` | 4.23.12 [VERIFIED: `package.json:24`] | Running the new search/promotion scripts, matching `identifiability.ts`'s `pnpm <script>` pattern | Established project convention |

### No new packages required

No new npm dependency is needed for this phase. Every capability (seeded PRNG, correlated Gaussian sampling, grid/random search, SHA-256 hashing for the D-15 digest) is either already installed or is a small, well-understood primitive this codebase already hand-rolls in the same style (`erf`/`normalCdf` in `linkFunctions.ts`, `mulberry32` in `identifiability.ts`).

### Rejected candidates (checked this session, not recommended)

| Package searched | Registry result | Verdict |
|---|---|---|
| `cma-es`, `cma-es-js`, `cmaes` | 404 — not on npm [VERIFIED: `npm view` this session] | Does not exist |
| `optuna`, `optunajs` | 404 — not on npm | Does not exist for JS/TS |
| `bayesian-optimization` | Unpublished 2023-04-08 [VERIFIED: `npm view bayesian-optimization` this session] | Dead |
| `hpjs` | Exists (0.4.1, last published 2022-06-18) but its own registry metadata describes it as "helpful javascript modules" [VERIFIED: `npm view hpjs --json` this session] | Name collision with an unrelated grab-bag package, not a hyperparameter-optimization library — do not use |
| `fmin` | Exists (0.0.4, last published 2024-10-29) | Extremely low version number/adoption for a load-bearing numerical dependency; hand-rolled Nelder-Mead (if wanted for local refinement) is ~40 lines and avoids trusting an obscure package for the tuning result the project's core value rests on |
| `nelder-mead`, `randomsearch` | 404 — not on npm | Does not exist |

**Installation:** none.

## Package Legitimacy Audit

No external packages are recommended for installation in this phase — see "Rejected candidates" above (all considered candidates were either nonexistent on the registry, unpublished, a name collision, or judged not worth the trust surface given the ~40-line hand-rolled alternative). The audit table format is omitted since there is nothing to approve.

**Packages removed due to [SLOP] verdict:** none — no candidate reached the point of being recommended.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────┐
                    │   Offline Node Pipeline (new, Phase 3)   │
                    │                                           │
  corpus.sqlite ───▶│  1. Sensitivity screen (one-at-a-time)   │
  (read-only,       │     over every tagged constant           │
   T-01-13)         │     -> reports/sensitivity-screen.json   │
                    │              │                            │
                    │              ▼                            │
                    │  2. Joint search (grid/random, seeded)    │
                    │     over screen survivors only            │
                    │     -> logs every evaluation (NOT         │
                    │        versioned, D-14)                   │
                    │              │                            │
                    │              ▼                            │
                    │  3. Explicit promotion                    │
                    │     -> data/algorithm-versions/           │
                    │        sigma1@X.Y.json  (D-13, committed) │
                    │              │                            │
                    │              ▼                            │
                    │  4. Digest generation (D-15)               │
                    │     -> headline metrics + prediction-      │
                    │        stream hash, committed alongside    │
                    └──────────────┬────────────────────────────┘
                                   │  params: Sigma1Params (plain data)
                                   ▼
        ┌──────────────────────────────────────────────────────┐
        │      packages/core/algorithms/sigma1/*  (unchanged     │
        │      Worker-importability constraint)                  │
        │                                                          │
        │  makeSigma1(params: Sigma1Params) -> AlgorithmModule    │
        │    predict(state, match):                                │
        │      - score/margin (existing path, now parameterized)  │
        │      - RP joint Monte Carlo draw (D-11, new):            │
        │          Cholesky(covariance) -> correlated normals      │
        │          -> per-alliance discrete pmf P(RP=0..N)         │
        │    update(state, result):                                │
        │      - existing Kalman fold (now parameterized)          │
        │      - NEW: parallel count-unit state fold (D-09)        │
        │      - NEW (ALGO-05): innovation-driven noise adapt      │
        └──────────────────────────────┬───────────────────────────┘
                                        │
                                        ▼
        ┌──────────────────────────────────────────────────────┐
        │  packages/harness/replay.ts  WalkForwardSimulator      │
        │  (UNCHANGED — every optimizer eval inherits             │
        │   toLeakProofUpcoming's leak-proof guarantee for free)  │
        └──────────────────────────────┬───────────────────────────┘
                                        │
                                        ▼
        ┌──────────────────────────────────────────────────────┐
        │  score.ts (Brier objective, D-01) / artifact.ts         │
        │  (algorithms[] descriptor: {id, version} — version now   │
        │   derived from code version + promoted param-set name)  │
        └──────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
packages/
├── core/algorithms/sigma1/
│   ├── params.ts            # NEW — Sigma1Params type + DEFAULT_SIGMA1_PARAMS (today's hardcoded values as the seed)
│   ├── index.ts              # makeSigma1(params) — every currently-imported constant becomes a params.* read
│   ├── kalman.ts              # applyProcessNoise(belief, q) — q now comes from params, not a module constant
│   ├── consistency.ts         # same threading
│   ├── covariance.ts          # same threading
│   ├── linkFunctions.ts       # same threading
│   └── rp/                    # NEW — D-09's parallel count-unit state
│       ├── rules.ts           # per-season RP rule registry (mirrors breakdown/index.ts's dispatch shape)
│       ├── 2022.ts .. 2026.ts # per-season rule modules, cited by manual section (D-12)
│       └── distribution.ts    # NEW — Cholesky + seeded-normal joint draw -> discrete pmf
├── core/algorithms/carryover.ts   # SPLIT (D-04): sigma1CarryConstants vs epaCarryConstants
└── harness/
    ├── tune.ts                # NEW — screen (Task a) + joint search (Task b), mirrors identifiability.ts's shape
    ├── promote.ts              # NEW — writes data/algorithm-versions/{id}.json + digest (D-13/D-15)
    └── digest.test.ts          # NEW — CI test: re-run promoted version on bounded slice, assert digest match
```

### Pattern 1: Parameter-set injection (the seam every hyperparameter enters through)

**What:** Every module-level `const SIGMA1_*` currently hardcoded in `kalman.ts`/`consistency.ts`/`covariance.ts`/`linkFunctions.ts`/`sigma1/index.ts` becomes a field on a plain `Sigma1Params` object threaded through `makeSigma1(params)` down to every function that reads it.
**When to use:** Any constant tagged `Phase 3 hyperparameter, default unverified` in the existing source (11 confirmed this session — see table below) plus, if D-04's carryover split introduces Sigma1's own copy, up to 3 more.
**Example — today's shape (verified this session):**
```typescript
// Source: packages/core/algorithms/sigma1/kalman.ts:61,70 [VERIFIED: read this session]
export const SIGMA1_PROCESS_NOISE_WITHIN_EVENT = 0.5;
export const SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY = 8;
```
**Recommended shape:**
```typescript
// params.ts (new)
export interface Sigma1Params {
  readonly processNoiseWithinEvent: number;   // was SIGMA1_PROCESS_NOISE_WITHIN_EVENT = 0.5
  readonly processNoiseEventBoundary: number; // was SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY = 8
  readonly consistencyEwmaAlpha: number;       // was SIGMA1_CONSISTENCY_EWMA_ALPHA = 0.2
  readonly shrinkagePriorMatches: number;      // was SIGMA1_SHRINKAGE_PRIOR_MATCHES = 8
  readonly minConsistencyVariance: number;     // was SIGMA1_MIN_CONSISTENCY_VARIANCE = 1
  readonly covEwmaAlpha: number;                // was SIGMA1_COV_EWMA_ALPHA = 0.1
  readonly covShrinkage: number;                // was SIGMA1_COV_SHRINKAGE = 0.3
  readonly linkC: number;                       // was SIGMA1_LINK_C = 1.0
  readonly coldStartTeamTotal: number;          // was SIGMA1_COLD_START_TEAM_TOTAL = 20
  readonly coldStartConsistencyVariance: number; // was SIGMA1_COLD_START_CONSISTENCY_VARIANCE = 25
  readonly fallbackScoreSd: number;              // was SIGMA1_FALLBACK_SCORE_SD = 25
  readonly consistencyCarryDecay: number;        // was SIGMA1_CONSISTENCY_CARRY_DECAY = 0.5
  readonly rpMonteCarloSeed: number;             // NEW (D-16) — part of the versioned parameter set
  readonly rpMonteCarloDraws: number;            // NEW (D-16) — same
}

export const DEFAULT_SIGMA1_PARAMS: Sigma1Params = {
  processNoiseWithinEvent: 0.5,
  processNoiseEventBoundary: 8,
  consistencyEwmaAlpha: 0.2,
  shrinkagePriorMatches: 8,
  minConsistencyVariance: 1,
  covEwmaAlpha: 0.1,
  covShrinkage: 0.3,
  linkC: 1.0,
  coldStartTeamTotal: 20,
  coldStartConsistencyVariance: 25,
  fallbackScoreSd: 25,
  consistencyCarryDecay: 0.5,
  rpMonteCarloSeed: 42,
  rpMonteCarloDraws: 2000,
};
```
This exactly mirrors the existing `makeSigma1({ id, linkMode })` factory shape (`sigma1/index.ts:741-751` [VERIFIED: read this session]) — no new architecture, an extra field on the same options object.

### Pattern 2: Reuse the committed-script shape for the sensitivity screen and search

**What:** `identifiability.ts` already establishes the exact shape a Phase-3 analysis script should follow: `parseArgs`, an entry-point guard (`isEntryPoint`), a seeded deterministic sample, JSON output to `reports/`, console progress lines.
**Example — the seeded PRNG this session verified is already in the codebase:**
```typescript
// Source: packages/harness/identifiability.ts:122-131 [VERIFIED: read this session]
/** Deterministic PRNG (Mulberry32) — same seed always produces the same event sample, so this script's output is reproducible across runs, not a fresh random draw each time. */
function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let t2 = Math.imul(t ^ (t >>> 15), t | 1);
    t2 ^= t2 + Math.imul(t2 ^ (t2 >>> 7), t2 | 61);
    return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
  };
}
```
D-16's "PRNG seed is part of the parameter set" requirement is satisfied by literally reusing this function with a seed sourced from `Sigma1Params.rpMonteCarloSeed` instead of the module-level `SAMPLE_SEED` constant `identifiability.ts` uses for its own, unrelated sampling purpose.

### Pattern 3: RP joint distribution via seeded Monte Carlo (recommendation for D-11/D-16)

**What:** Draw `N` correlated samples from the alliance's existing multivariate Gaussian belief (mean vector + covariance matrix, already computed by `covariance.ts`'s `ewmaCovariance`/`teamTotalVariance` machinery) extended to include the RP count-unit dimensions from D-09's parallel state; for each draw, compute win/tie and every bonus threshold jointly; tally into a discrete pmf.
**When to use:** Every `predict()` call once RP prediction ships (D-10/D-11).
**Why Monte Carlo over deterministic numerical integration (the recommendation D-16 leaves open):**
- The joint distribution has 3-4 dimensions per alliance (margin + 2-3 bonus count variables, per season) — a closed-form multivariate normal CDF at that dimensionality has no simple closed form (only the bivariate case does); a correct implementation would need Genz's algorithm or similar, which is exactly the kind of bespoke numerical routine RESEARCH.md's "Don't Hand-Roll" convention warns against building from scratch, whereas correlated-Gaussian *sampling* via Cholesky is a single well-tested `ml-matrix` call plus a standard Box-Muller transform.
- D-16's bitwise-reproducibility requirement is satisfied identically either way (a seeded PRNG is not less deterministic than a numerical integrator) — reproducibility is not a point in the deterministic-integration column.
- Phase 3 has **no CPU-budget constraint** (CONTEXT.md explicitly scopes the Worker's 10ms ceiling to Phase 4, "flagged for Phase 4" in D-11) — the tradeoff CONTEXT.md is actually asking about only matters one phase later. Building the simpler, well-understood mechanism now and revisiting it if Phase 4's profiling shows the Monte Carlo cost is a real problem is the same "don't solve a problem you don't have yet" discipline this project already applies elsewhere (e.g. the binary-serialization rejection in CLAUDE.md's stack doc).
- Monte Carlo composes trivially if a season needs a 4th or 5th RP dimension later (2025 alone needs 4: margin, and per-level coral counts collapse to at least a 2-variable joint check across levels) — a hand-rolled deterministic integrator would need re-deriving per dimensionality.

**Example — the primitives this needs, all already available:**
```typescript
// Cholesky decomposition — ml-matrix already exports this (verified this session):
import { Matrix, CholeskyDecomposition } from "ml-matrix";
const chol = new CholeskyDecomposition(Matrix.from2DArray(covarianceMatrix));
const L = chol.lowerTriangularMatrix; // correlatedDraw = mean + L * standardNormalVector

// Standard normal from the existing seeded uniform stream — Box-Muller, a standard
// transform (same "well-known, cite the formula" discipline linkFunctions.ts already
// uses for its Abramowitz-Stegun erf approximation):
function boxMullerPair(u1: number, u2: number): [number, number] {
  const r = Math.sqrt(-2 * Math.log(u1));
  const theta = 2 * Math.PI * u2;
  return [r * Math.cos(theta), r * Math.sin(theta)];
}
```

### Pattern 4: Versioning identity (D-13/D-14/D-15)

**What:** `AlgorithmModule.version` (`packages/core/algorithms/types.ts:103` [VERIFIED: read this session, currently `readonly version: string`]) is populated today by a hardcoded literal (`sigma1/index.ts:744`, `version: "1.0.0"`). D-13 makes this derived: `{codeVersion}+{paramSetName}`, e.g. `"2.0.0+tuned-2026-08"`. `artifact.ts`'s existing `AlgorithmDescriptorSchema` (`{id, version}` — `artifact.ts:81-84` [VERIFIED: read this session]) needs no shape change; only what populates `version` changes.
**Where promotion writes:** a new `data/algorithm-versions/{id}.json`, structurally similar to `predictions.ts`'s existing `PersistedPredictionRecord` write discipline (validate-then-write, Zod schema as executable spec) — but this one is a small, git-committed file (D-15: "commits a few hundred bytes rather than a generated artifact"), unlike `reports/`/`data/*.sqlite` which are gitignored per the failure log's repo-hygiene rule.

### Anti-Patterns to Avoid

- **Hardcoding a single RP threshold per season:** four of five seasons (2023-2026) tier thresholds by event type; a flat per-season constant will silently mispredict every District Championship/Championship match. Verified this session (see RP table below).
- **Using `coopertitionCriteriaMet` from only one alliance:** 2023's reduced Sustainability threshold requires **both** alliances' `coopertitionCriteriaMet === true`, not either — verified by direct reconciliation (an OR-based check produced 609/6000 mismatches; the correct AND-based, tier-aware check produced 0/27116).
- **Reading `hubScore.*Points` as already-scaled point totals when the RP threshold wants a raw count:** for 2026, `hubScore.totalCount` (not `totalPoints`) is the correct field for the Energized/Supercharged thresholds — they happen to be numerically identical in the sampled data (1 fuel = 1 point) but the *semantic* field is `totalCount`, matching D-09's "count fields, never points" discipline.
- **A single `coralCount` total for 2025's Coral Bonus:** the rule requires ≥5 CORAL on **each of 4 separate reef levels** (`trough`, `botRow`, `midRow`, `topRow`), not a single summed threshold — reverse-engineering this from a total-count hypothesis produces an unexplainable ~40% mismatch rate (confirmed this session) until the per-level nested structure (`autoReef.tba_{level}Count` + `teleopReef.tba_{level}Count`) is read directly.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Correlated Gaussian sampling (D-11) | A bespoke multivariate-normal CDF/Genz's algorithm | `ml-matrix`'s `CholeskyDecomposition` + Box-Muller on the existing seeded PRNG | Already installed, already trusted (used in `identifiability.ts`'s SVD path); a from-scratch multivariate CDF integrator is a much harder correctness surface for the same reproducibility guarantee |
| Grid/random hyperparameter search | A new npm dependency (none exist for this ecosystem — see Package Legitimacy Audit) | Hand-rolled screen + seeded random search, mirroring `identifiability.ts`'s committed-script shape | No viable candidate exists on the registry; the search itself is ~50-100 lines given the harness's existing `runSeasons`/`aggregateScores` primitives already do the expensive part |
| SHA-256 digest for D-15 | A hashing npm package | Node's built-in `node:crypto` `createHash("sha256")` | Zero new dependency; already how `randomUUID` (`node:crypto`) is used elsewhere in this codebase (`packages/ingest/cli.ts:16`) |
| Per-season RP rule parsing | A generic "detect the bonus fields" parser | Per-season modules mirroring `breakdown/2022.ts`...`breakdown/2026.ts`'s existing dispatch-table shape (`SeasonComponentMap`-style interface, `componentMapForSeason`-style registry) | This project already learned this lesson once (Pitfall Sigma1-1, cited in `breakdown/2026.ts`'s own header) — a generic parser cannot represent 2026's renamed foul fields or 2025's nested per-level reef structure, let alone season-to-season tier-threshold differences |

**Key insight:** every "don't hand-roll" item in this phase has an existing in-repo precedent to imitate rather than a new external dependency to add — this phase is Sigma1's existing architecture extended, not a new architecture.

## Common Pitfalls

### Pitfall 1: RP bonus thresholds scale by event tier, inconsistently across seasons
**What goes wrong:** A model trained/verified only on Regional and District events (the bulk of the corpus) silently mispredicts every District Championship and FIRST Championship match, where 4 of 5 seasons raise the bonus threshold.
**Why it happens:** FIRST raises RP bonus thresholds at higher-level events as the season progresses and team performance improves, to keep bonuses meaningfully achievable-but-not-trivial. This is a genuine game-design pattern, not a data artifact — but *which* TBA `event_type` values get the bump, and by how much, differs per season (see table below).
**How to avoid:** Every per-season RP rule module must accept the match's `event_type` (currently NOT part of `UpcomingMatch`/`MatchResult` — see Open Questions) and apply the season-specific tier table verified below, not a flat constant.
**Warning signs:** The D-12 reconciliation test failing exclusively at District-Championship-or-higher event types while passing everywhere else — this exact signature is what this session's own reconciliation script produced before the tier logic was corrected (2023: 735/27116 mismatches, 100% concentrated at `event_type` 2 and 5, before the corrected tier boundary — `event_type` 3/4 only — brought it to 0/27116).

### Pitfall 2: Win RP value is not constant across seasons
**What goes wrong:** Any code (or mental model) carrying over "win = 2 RP" from 2022-2024 breaks silently for 2025-2026.
**Why it happens:** FIRST changed the Win RP award from 2 to 3 starting with the 2025 season (Reefscape) — verified this session by subtracting each season's summed bonus flags from `red_rp_earned`/`blue_rp_earned` across ~5000 sampled matches per season: the "winner base RP" bucket is a clean single value per season (2 for 2022/2023/2024, 3 for 2025/2026), with zero exceptions.
**How to avoid:** Make Win/Tie RP a per-season constant read from the same rule-module registry as the bonus thresholds, never a project-wide constant.
**Warning signs:** A predicted-RP pmf whose maximum support value is off by exactly 1 for 2025/2026 matches.

### Pitfall 3: Elimination matches never award RP — verified as universal, not assumed
**What goes wrong:** Predicting a nonzero RP pmf for a playoff match.
**Why it happens:** FRC rules do not award ranking points in elimination play (Win/Tie RP is a qualification-tournament-only mechanic; the elimination bracket uses a different advancement rule).
**How to avoid:** RP prediction should short-circuit to a degenerate pmf (`P(RP=0)=1`) for any non-`qm` `compLevel`, matching the pattern `score.ts`'s `matchesView` already establishes for qual/elim splitting.
**Warning signs:** none expected — this was verified with zero exceptions across the **entire** corpus (every played elimination match, all 5 seasons: 2022 0/2613, 2023 0/2795, 2024 0/2867, 2025 0/3056, 2026 0/3212 — both `red_rp_earned` and `blue_rp_earned` are 0 for 100% of sampled elimination matches).

### Pitfall 4: `has_score_breakdown = 0` is far rarer than CONTEXT.md's stated estimate
**What goes wrong:** Over-engineering the D-05 RP fallback path for a ~1.5% population that CONTEXT.md's own framing (carried from earlier phase context) estimates.
**Why it happens:** That figure appears to be a general estimate, not season-specific.
**How to avoid:** Measured this session directly against the corpus: 2022 0.00% (0/14677), 2023 0.00% (0/16353), 2024 0.12% (21/17029), 2025 0.00% (0/17877), 2026 0.00% (0/18403). The fallback path is needed almost entirely for one season (2024) and is a small population — worth a documented, simple fallback (e.g. skip RP prediction and fall back to a wide/uninformative pmf) rather than a fully general solution.
**Warning signs:** n/a — this is a scoping correction, not a runtime failure mode.

### Pitfall 5: A small residual reconciliation gap exists in 2022 unrelated to tiering
**What goes wrong:** Assuming D-12's "100% of played matches" reconciliation target is achievable to the literal last decimal for every season.
**Why it happens:** 2022's Cargo Bonus reconciliation (`cargoBonusRankingPoint` recomputed from `matchCargoTotal`/`quintetAchieved`) showed a small, non-zero mismatch rate concentrated at Regional/District events only (event_type 0: 24/8408 = 0.29%; event_type 1: 32/11412 = 0.28%; **zero** mismatches at District Championship/Championship/District-Championship-Division tiers) — the mismatch direction went both ways (total above threshold but flag false, and vice versa), inconsistent with a threshold-value error and more consistent with a small number of anomalous events' data (repeated matches from `2022azfl` appeared disproportionately in a manual sample of the mismatches).
**How to avoid:** Set the D-12 reconciliation test's tolerance to allow a small measured exception rate (document the exact rate per season) rather than asserting a literal 100.000%, OR investigate whether specific early-Week-1 2022 events have a known TBA data-quality issue (a manual spot-check of `azfl` — Arizona, Week 1 — would confirm before deciding).
**Warning signs:** A reconciliation test written to assert zero exceptions will fail on 2022 even though the rule implementation is correct; do not "fix" the rule logic to chase this — it is a data artifact, not a rule-modeling error (verified: 2023's equivalent test, once tier logic was corrected, hit exactly 0/27116).

### Pitfall 6: No CI currently runs the test suite
**What goes wrong:** D-15's "a CI test... asserts both match" is written assuming a CI pipeline exists to run it.
**Why it happens:** The only workflow in `.github/workflows/` (`deploy.yml`) is a stale pre-monorepo scaffold — it runs `npm run build`/uploads to Pages, references `FIRST_API_KEY` (not this project's actual `TBA_API_KEY`), and does not invoke `pnpm test` at all [VERIFIED: read `.github/workflows/deploy.yml` this session, 53 lines, no test step].
**How to avoid:** This phase (or a small adjacent task) should add a `test.yml`-style workflow that runs `pnpm test` (and, ideally, `pnpm typecheck`) on push/PR — otherwise D-15's CI gate is a vitest test that exists but nothing ever runs automatically.
**Warning signs:** none until a reproducibility regression ships to `main` unnoticed because "the CI test" was assumed to be wired up.

## Code Examples

### FRC ranking-point rules, 2022-2026 (verified this session against the live corpus)

All thresholds below were verified by direct reconciliation against `data/corpus.sqlite` this session: recomputing each bonus achievement flag from raw count/point fields and comparing to TBA's own recorded boolean flag, for every sampled played qualification match. TBA `event_type` values [CITED: `github.com/the-blue-alliance/the-blue-alliance/blob/master/consts/event_type.py`, fetched this session]: `0`=Regional, `1`=District, `2`=District Championship, `3`=Championship Division, `4`=Championship Finals, `5`=District Championship Division, `99`=Offseason, `100`=Preseason.

**Win/Tie/Loss RP — verified with zero exceptions, ~5000 sampled matches per season:**

| Season | Win RP | Tie RP | Loss RP | Confidence |
|---|---|---|---|---|
| 2022 | 2 | 1 | 0 | [VERIFIED: corpus, 4930/4930 + 140/140 exact] |
| 2023 | 2 | 1 | 0 | [VERIFIED: corpus, 4953/4953 + 94/94 exact] |
| 2024 | 2 | 1 | 0 | [VERIFIED: corpus, 4939/4939 + 122/122 exact] |
| 2025 | **3** | 1 | 0 | [VERIFIED: corpus, 4967/4967 + 66/66 exact — changed from 2] |
| 2026 | **3** | 1 | 0 | [VERIFIED: corpus, 4986/4986 + 28/28 exact] |

Elimination matches: RP always 0, every season, zero exceptions across the entire corpus (not a sample) [VERIFIED: corpus, full population per season].

**2022 (Rapid React)** — manual §6.4.1 Table 6-1 [CITED: `firstfrc.blob.core.windows.net/frc2022/Manual/HTML/2022FRCGameManual.htm`, fetched this session]:

| Bonus | Threshold | TBA fields | Tiered by event? | Confidence |
|---|---|---|---|---|
| Cargo Bonus | `matchCargoTotal` (auto+teleop count) ≥ 20; **≥18** if `quintetAchieved` (≥5 cargo scored in auto) | `cargoBonusRankingPoint` (flag), `quintetAchieved` (flag), `matchCargoTotal`, `autoCargoTotal` | No — constant across all event types [VERIFIED: 0 mismatches at event_type 2/3/5/100; small ~0.3% unexplained mismatch rate at 0/1, see Pitfall 5] | HIGH |
| Hangar Bonus | `endgamePoints` ≥ 16 | `hangarBonusRankingPoint` (flag), `endgamePoints` | No | HIGH [VERIFIED: 0/1000 mismatches] |

**2023 (Charged Up)** — manual §6.4.3 Table 6-2 [CITED: `firstfrc.blob.core.windows.net/frc2023/Manual/HTML/2023FRCGameManual.htm`, fetched this session; tier-exception behavior below is independently corpus-verified since the manual's prose states only the base rule]:

| Bonus | Threshold | TBA fields | Tiered by event? | Confidence |
|---|---|---|---|---|
| Activation Bonus | `totalChargeStationPoints` (auto+endgame) ≥ 26 | `activationBonusAchieved`, `totalChargeStationPoints` | No | HIGH [VERIFIED: 0/1000 mismatches] |
| Sustainability Bonus | LINKS (`linkPoints / 5`) ≥ 4 if **both** alliances' `coopertitionCriteriaMet === true`, else ≥5, at event_type ∈ {0,1,2,5,100}; ≥5 (coop)/≥6 (non-coop) at event_type ∈ {3,4} (FIRST Championship only — District Championship does NOT get the bump) | `sustainabilityBonusAchieved`, `linkPoints`, `coopertitionCriteriaMet` (read from **both** `red` and `blue`) | **Yes — Championship only** | HIGH [VERIFIED: 0/27116 mismatches, full season, all event types, after correcting the tier boundary to {3,4} rather than {2,3,4,5}] |

**2024 (Crescendo)** — manual §6.5.6 Table 6-2 [CITED: `frcmanual.com/2024/game-details`, MEDIUM-confidence fan mirror of the official manual, cross-checked against corpus]:

| Bonus | Threshold | TBA fields | Tiered by event? | Confidence |
|---|---|---|---|---|
| Melody Bonus | NOTES (`autoAmpNoteCount+autoSpeakerNoteCount+teleopAmpNoteCount+teleopSpeakerNoteCount`, or read TBA's own `autoTotalNotePoints`/`teleopTotalNotePoints`-adjacent counts) ≥ threshold below, reduced by 3 if `coopertitionBonusAchieved` | `melodyBonusAchieved`, and **TBA ships the exact per-match threshold directly**: `melodyBonusThreshold`, `melodyBonusThresholdCoop`, `melodyBonusThresholdNonCoop` — no need to hardcode the tier table at all if these fields are read directly | **Yes — three tiers** | HIGH [VERIFIED: `melodyBonusThresholdNonCoop` observed per event_type: {0:18, 1:18, 100:18} Regional/District/Preseason; {2:21, 5:21} District Championship/District Champs Division; {3:25} Championship] |
| Ensemble Bonus | `endGameTotalStagePoints` ≥ 10 AND on-stage robot count ≥ 2 | `ensembleBonusAchieved`, and TBA ships `ensembleBonusStagePointsThreshold`/`ensembleBonusOnStageRobotsThreshold` directly (both constant: 10/2, no tiering observed) | No | HIGH [VERIFIED: single constant value observed across every event_type in corpus] |

**2024 also ships its own thresholds as data**, unlike every other season — `parseBreakdown`'s consumer could read `melodyBonusThreshold`/`ensembleBonus*Threshold` directly from a completed match's breakdown for the reconciliation test, but **not for prediction** (those fields are outcome-adjacent/derived-from-the-completed-match and are not something `predict()` can read pre-match; the tier table must still be hardcoded from `event_type`, which IS knowable pre-match, for the prediction path).

**2025 (Reefscape)** — manual §6.5.4 Table 6-2 [CITED: `frcmanual.com/2025/game-details`, cross-checked against corpus]:

| Bonus | Threshold | TBA fields | Tiered by event? | Confidence |
|---|---|---|---|---|
| Auto Bonus | All enabled robots leave AND ≥1 CORAL scored in auto | `autoBonusAchieved` | Not independently re-verified this session beyond field existence | MEDIUM |
| Coral Bonus | ≥5 CORAL on **each of 4 reef levels** (trough/L1, botRow/L2, midRow/L3, topRow/L4); reduced to ≥5 on **at least 3 of 4 levels** if coopertition met. Per-level count = `autoReef.tba_{level}Count + teleopReef.tba_{level}Count` (trough uses `autoReef.trough + teleopReef.trough`, not a `tba_*Count` field) | `coralBonusAchieved`; nested `autoReef`/`teleopReef` objects, each with `tba_botRowCount`/`tba_midRowCount`/`tba_topRowCount`/`trough` | Manual states threshold "may increase" at District Championship/Championship — **not independently pinned to an exact tiered value this session** | MEDIUM (base rule structurally VERIFIED via one worked example: levels 5/5/9/5 all ≥5 → `coralBonusAchieved=true`; tier exception CITED but not corpus-verified) |
| Barge Bonus | `endGameBargePoints` ≥ 14 at event_type ∈ {0,1,5,100}; ≥16 at event_type ∈ {2,3} | `bargeBonusAchieved`, `endGameBargePoints` | **Yes — District Championship + Championship** | HIGH [VERIFIED: clean threshold boundary at both tiers, small (<1%) noise near the boundary at Regional/District tier] |

**2026 (REBUILT)** — manual §6.5.3, Table 6-4/6-5 [CITED: `firstfrc.blob.core.windows.net/frc2026/Manual/HTML/2026GameManual.htm`, fetched this session]:

| Bonus | Threshold | TBA fields | Tiered by event? | Confidence |
|---|---|---|---|---|
| Energized | `hubScore.totalCount` (raw fuel count, not `.totalPoints` — verified 1:1 in sampled data but semantically a count) ≥ 100 at event_type ∈ {0,1,100} | `energizedAchieved`, `hubScore.totalCount` | **Yes** — raises to ~360 at event_type ∈ {2,3,5}; exact tiered value bucketed but not pinned to a single manual-cited number this session | HIGH at Regional/District tier [VERIFIED: 0/24478 mismatches at event_type 0+1]; MEDIUM at higher tiers (see Open Questions) |
| Supercharged | `hubScore.totalCount` ≥ 360 at event_type ∈ {0,1,100} | `superchargedAchieved` | **Yes** — raises further at event_type ∈ {2,3,5}; exact value not pinned this session | HIGH at Regional/District tier [VERIFIED: 0/24478 mismatches]; LOW at higher tiers — flag as Open Question |
| Traversal | `totalTowerPoints` (`autoTowerPoints + endGameTowerPoints`) ≥ 50 | `traversalAchieved`, `totalTowerPoints` | No — constant across all event types | HIGH [VERIFIED: 0/30382 mismatches, every event type, no exceptions] |

### Reconciliation test shape (mirrors the existing `reconciliation.test.ts` pattern)

```typescript
// Source: pattern established in packages/core/algorithms/breakdown/reconciliation.test.ts
// (read this session) — D-12's RP reconciliation should mirror this shape exactly,
// including the offseason-exclusion discipline and the read-only corpus handle.
describe.each(REGISTERED_SEASONS)("season %i RP reconciliation (D-12)", (year) => {
  // ... sample played, non-offseason qm matches with has_score_breakdown = 1 ...
  it("recomputed bonus flags match TBA's own recorded flags for every sampled match", () => {
    // For each bonus, recompute from raw count/point fields + event_type tier table,
    // assert === TBA's own {bonusName}Achieved flag.
  });
  it("summed recomputed RP matches red_rp_earned/blue_rp_earned", () => {
    // winRp(eventType, season) + sum(bonus flags) === row.red_rp_earned, etc.
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Assuming Win RP = 2 (true 2022-2024) | Win RP = 3 for 2025-2026 | FIRST rule change effective 2025 season | Any RP pmf's support/max value is season-dependent, not a project-wide constant |
| A single per-season RP bonus threshold | Per-season, per-event-tier threshold tables (verified season-specific, not a fixed FRC-wide pattern) | Ongoing FIRST practice, at least since 2023 | Rule modules need `event_type` as an input, not just `season` |

**Deprecated/outdated:** none specific to this domain — FRC games are single-season by design, so there is no "old API" to deprecate within this phase's scope, only per-season rule differences to model correctly.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | 2025 Auto Bonus RP rule (`autoBonusAchieved` = all robots leave AND ≥1 auto coral) is correctly stated | Code Examples, 2025 table | Low — this bonus is a simple AND of two conditions and was not independently reconciled against raw fields this session (only cross-checked via the manual fetch); a planner-side spot reconciliation before implementation is cheap insurance |
| A2 | 2025 Coral Bonus threshold increases at District Championship/Championship tier (exact tiered numeric value) | Code Examples, 2025 table | Medium — if wrong, only District-Championship-and-above 2025 matches mispredict this one bonus; base-tier rule (the vast majority of matches) is structurally verified |
| A3 | 2026 Energized/Supercharged exact tiered threshold values at District Championship/Championship (bucketed to ~360 for Energized, unconfirmed exact value for Supercharged) | Code Examples, 2026 table | Medium — same shape as A2: only higher-tier 2026 matches affected; Regional/District (majority of matches, all of tune/holdout seasons' bulk) is HIGH confidence |
| A4 | The 2022 ~0.3% Cargo Bonus reconciliation mismatch is a data-quality artifact (specific anomalous events), not a rule-modeling gap | Pitfall 5 | Low — if actually a rule gap, it affects <0.3% of one season's matches; does not change the recommended rule implementation, only the reconciliation test's tolerance |

**If this table is empty:** N/A — see rows above. Every other numeric claim in this document (Win/Tie RP values, elimination-always-zero, the 2022/2023/2024/2026-Regional-District thresholds, the ml-matrix/zod/npm-package findings) was directly verified against either the live corpus or a tool call this session.

## Open Questions

1. **Exact tiered RP thresholds for 2025 Coral Bonus and 2026 Energized/Supercharged at District Championship/Championship events**
   - What we know: the base (Regional/District) thresholds are fully verified (0 mismatches); a tier increase is confirmed to exist and was bucketed to approximate values (2026 Energized appears to become ~360 at higher tiers).
   - What's unclear: the exact manual-cited number for the higher tier(s), and (for 2026) whether District Championship (`event_type=2`), Championship (`event_type=3`), and District Championship Division (`event_type=5`) all share one raised threshold or differ from each other the way 2024's three-tier Melody Bonus does.
   - Recommendation: before implementing the higher-tier branch, fetch `firstfrc.blob.core.windows.net/frc2025/Manual/Sections/2025GameManual-06GameDetails.pdf` and `frc2026/.../06GameDetails.pdf`'s Table 6-5 directly (this session's HTML-manual fetches worked for the base tables; the section-specific PDFs are the more likely home for the tier table), or bucket a larger corpus sample per tier the way this session did for 2023's Sustainability Bonus (which converged to an exact answer, 0/27116 mismatches). Given these tiers cover a small minority of matches (District Championship + Championship events are a small fraction of any season's total), this is not blocking for the tune/holdout Brier-score work, only for full SC-4 manual-section-cited correctness.

2. **Does `UpcomingMatch`/`MatchResult` need an `eventType` field, or should the RP rule module look it up via `eventKey` at call time?**
   - What we know: `event_type` lives on the `events` table (`schema.sql:14` [VERIFIED: read this session]), not on `matches`; `UpcomingMatch`/`MatchResult` (`types.ts`) currently carry only `eventKey`.
   - What's unclear: whether the harness's existing match-loading path (`selectMatchesChronological`, `packages/corpus/db.ts`) should be extended to join and carry `eventType` through, or whether the RP module should take a separate `Map<eventKey, eventType>` lookup built once per season replay (cheaper — avoids widening the outcome-adjacent-looking `MatchResult` type, and `event_type` is not outcome-bearing so it's safe either way for `toLeakProofUpcoming`).
   - Recommendation: prefer widening `UpcomingMatch` with a non-outcome-bearing `eventType: number` field (it's known before a match is played, same category as `compLevel`/`matchNumber` which are already on `UpcomingMatch`) — simpler for `predict()` to consume directly without a second lookup structure threaded through every call site.

3. **Whether the D-04 carryover split adds 3 or more tunable scalars**
   - What we know: `carryover.ts`'s `EPA_MEAN_REVERSION`/`EPA_CARRY_LAST_YEAR_WEIGHT`/`EPA_CARRY_PRIOR_YEAR_WEIGHT` are explicitly tagged "Phase 3 hyperparameter, default unverified" (lines 71, 78, 84 [VERIFIED: read this session]); `EPA_NORM_MEAN`/`EPA_NORM_SD`/`EPA_INIT_PENALTY` are NOT tagged that way.
   - What's unclear: whether Sigma1's own copy of the untagged three should also become independently tunable once split, or whether they're intentionally structural (self-consistent round-trip scale, not a real degree of freedom — `normalizedToSeasonUnits`'s docstring frames them as an arbitrary-but-consistent intermediate scale).
   - Recommendation: treat only the three explicitly-tagged constants as sensitivity-screen candidates for Sigma1's copy; leave `NORM_MEAN`/`NORM_SD`/`INIT_PENALTY` structural (same values, just duplicated per D-04's "own tunable copy" requirement) unless the sensitivity screen's design specifically wants to test that hypothesis too.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `data/corpus.sqlite` (local, ingested) | RP reconciliation test, sensitivity screen, joint search | ✓ [VERIFIED: 351MB file present this session] | — | — |
| `ml-matrix` (Cholesky) | D-11's correlated Monte Carlo draws | ✓ | 6.15.0 | — |
| GitHub Actions CI running `pnpm test` | D-15's "CI test" gate | ✗ [VERIFIED: `.github/workflows/deploy.yml` has no test step] | — | Add a minimal `test.yml` workflow as part of this phase or an adjacent task; until then, the digest test exists and passes locally but nothing runs it automatically on push/PR |
| Official FRC game manual PDFs (per-section) | Exact tier-table citations for Open Question 1 | Partially — the top-level HTML manuals fetched cleanly this session; the section-specific "Table 6-5" PDFs for 2025/2026 tier thresholds were not individually fetched | — | The corpus-verified base-tier thresholds (the vast majority of matches) do not depend on this; only the small higher-tier exception needs the citation before it can be marked HIGH confidence |

**Missing dependencies with no fallback:** none blocking.

**Missing dependencies with fallback:** CI workflow (add one); exact manual PDF section citations for two open questions (corpus-bucket a larger sample as a fallback verification method, as already successfully done for 2023's Sustainability Bonus tier boundary).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.10 [VERIFIED: `package.json:26`] |
| Config file | `vitest.config.ts` [VERIFIED: read this session — `include: ["packages/**/*.test.ts", "scripts/**/*.test.ts"]`, `environment: "node"`] |
| Quick run command | `pnpm test -- packages/core/algorithms/sigma1` (scoped) or `pnpm test -- packages/harness/digest.test.ts` (once added) |
| Full suite command | `pnpm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ALGO-04 | Sensitivity screen + joint search produce a promoted, named parameter set | integration (script + fixture corpus, or a recorded-output snapshot) | `pnpm tsx packages/harness/tune.ts --seasons 2022-2024` (new) | ❌ Wave 0 |
| ALGO-05 | Adaptation on/off best-vs-best comparison shows a measured winner (D-08) | integration | new `packages/harness/adaptation.test.ts` or reuse `tune.ts`'s two-run output | ❌ Wave 0 |
| ALGO-06 | Re-running a promoted version reproduces its digest exactly (D-15/SC-5) | unit/integration | `pnpm test -- packages/harness/digest.test.ts` (new) | ❌ Wave 0 |
| ALGO-08 | Every RP rule module reconciles 100% (or documented-tolerance) against `score_breakdown_raw` (D-12) | integration, corpus-backed | `pnpm test -- packages/core/algorithms/rp` (new, mirrors `reconciliation.test.ts`) | ❌ Wave 0 |
| ALGO-08 | Elimination matches predict a degenerate `P(RP=0)=1` pmf | unit | new test in the RP module's own test file | ❌ Wave 0 |
| SC-3 | Tuned Sigma1 beats OPR/EPA on holdout Brier AND accuracy, or the shortfall is recorded (D-02) | integration, full-corpus | `pnpm harness --seasons 2025-2026 --algorithm opr,epa,sigma1` (existing CLI, already proven) | ✅ (harness exists; only the tuned parameter set is new) |

### Sampling Rate

- **Per task commit:** scoped `pnpm test -- <touched package>` (existing project convention, matches Phase 2's plan shape)
- **Per wave merge:** `pnpm test` (full suite)
- **Phase gate:** Full suite green, plus a real `pnpm harness --seasons 2022-2026 --algorithm opr,epa,sigma1` run producing the SC-3 verdict, before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/harness/tune.ts` — the screen + joint search script, no existing file
- [ ] `packages/harness/promote.ts` — version promotion + digest writer, no existing file
- [ ] `packages/harness/digest.test.ts` — the D-15 CI reproducibility test, no existing file
- [ ] `packages/core/algorithms/sigma1/rp/` — the entire RP rule-module tree and its reconciliation test, no existing files
- [ ] `packages/core/algorithms/sigma1/params.ts` — the `Sigma1Params` type, no existing file
- [ ] `.github/workflows/test.yml` — CI runner for `pnpm test` (currently absent; see Pitfall 6)

*(Everything else — the harness's `runSeasons`/`aggregateScores`/`WalkForwardSimulator`, the corpus schema, the `ALGORITHMS` registry — already exists and is reused unchanged.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | This phase has no auth surface |
| V3 Session Management | No | N/A |
| V4 Access Control | No | N/A |
| V5 Input Validation | Yes | Zod schemas for every new raw-field read (RP rule modules parsing `score_breakdown_raw`'s bonus/count fields) — same discipline every existing `breakdown/*.ts` module already applies; throw on missing/non-finite rather than coerce (matches `assertFiniteComponents`'s existing convention, `breakdown/constants.ts:103-109` [VERIFIED: read this session]) |
| V6 Cryptography | Yes (narrowly) | D-15's digest uses `node:crypto`'s `createHash("sha256")` — never a hand-rolled hash; this is exactly the "never hand-roll crypto" ASVS instinct, satisfied trivially since Node's built-in is already the right tool |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A malformed/adversarial `score_breakdown_raw` value crashing RP parsing mid-replay | Denial of Service (of the offline pipeline, not user-facing) | Same pattern the existing breakdown modules use: Zod `.parse()` throws loudly, caught and counted (not silently skipped) at the reconciliation-test/sampling level, matching `identifiability.ts`'s `try/catch` around `parseBreakdown` (`identifiability.ts:239-249` [VERIFIED: read this session]) |
| A non-finite value (NaN/Infinity) reaching the Monte Carlo draw or the Kalman fold from an upstream corpus anomaly | Tampering (data integrity, not adversarial) | Reuse `assertFiniteComponents`'s existing finite-value gate pattern for the new RP count-unit state, exactly as `sigma1/index.ts:610-611` already does for the score-component vector |
| Secret leakage into a committed parameter-set/digest file | Information Disclosure | D-15's promoted-version files are written by an offline script with no TBA API key in scope (same `secretToScrub: undefined` precedent `runSeasonsMode` already establishes for the read-only corpus path, `cli.ts:484` [VERIFIED: read this session]) — no new secret-handling surface is introduced |

## Sources

### Primary (HIGH confidence)

- `data/corpus.sqlite` (local, live) — every RP threshold/win-RP-value/elimination-RP/has_score_breakdown-rate claim in this document was directly queried and reconciled this session, not inferred
- `firstfrc.blob.core.windows.net/frc2022/Manual/HTML/2022FRCGameManual.htm` — fetched this session, §6.4.1
- `firstfrc.blob.core.windows.net/frc2023/Manual/HTML/2023FRCGameManual.htm` — fetched this session, §6.4.3
- `firstfrc.blob.core.windows.net/frc2026/Manual/HTML/2026GameManual.htm` — fetched this session, §6.5.3
- `github.com/the-blue-alliance/the-blue-alliance/blob/master/consts/event_type.py` — fetched this session, authoritative TBA `event_type` enum
- This session's direct reads of: `packages/core/algorithms/sigma1/{index,kalman,consistency,covariance,linkFunctions}.ts`, `packages/core/algorithms/{carryover,types}.ts`, `packages/core/algorithms/breakdown/{2022..2026,constants,index,reconciliation.test}.ts`, `packages/harness/{replay,cli,artifact,score,predictions,identifiability}.ts`, `packages/corpus/schema.sql`, `package.json`, `vitest.config.ts`, `.github/workflows/deploy.yml`
- `npm view` / direct Node `require()` inspection this session — `ml-matrix` 6.15.0's `CholeskyDecomposition` export, `zod` 4.4.3, package existence checks for `cma-es`/`optuna`/`bayesian-optimization`/`hpjs`/`fmin`

### Secondary (MEDIUM confidence)

- `frcmanual.com/2024/game-details` — fan-maintained mirror, cross-checked against corpus reconciliation (base-tier values matched exactly)
- `frcmanual.com/2025/game-details` — same, base-tier values (Coral/Barge/Auto structure) cross-checked; tiered values not independently re-verified
- WebSearch synthesis for 2022/2023/2024 general RP framing (`cargoBonusRankingPoint`/`sustainabilityBonusAchieved` naming, coopertition mechanics) — all superseded by/cross-checked against direct corpus verification where a specific number mattered

### Tertiary (LOW confidence)

- Exact tiered numeric thresholds for 2025 Coral Bonus (District Championship/Championship) and 2026 Energized/Supercharged (District Championship/Championship/District Championship Division) — bucketed empirically but not pinned to a single manual-cited number; see Open Questions 1

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, every existing tool/version directly verified this session
- Architecture (parameter threading, versioning, RP module shape): HIGH — extends existing, already-read code patterns with no new architectural concepts
- RP rules (base/Regional-District tier): HIGH — directly reconciled against the full local corpus, zero-exception verification for the large majority of cases
- RP rules (higher-tier thresholds for 2025/2026): MEDIUM/LOW — tier existence confirmed, exact values not fully pinned; flagged explicitly, does not block tune/holdout Brier-score work
- Search algorithm recommendation: MEDIUM — grounded in measured per-match cost and confirmed absence of viable npm packages, but the specific screen-then-random-search design is a recommendation, not a locked decision (per CONTEXT.md, this is Claude's Discretion)

**Research date:** 2026-08-14
**Valid until:** ~30 days for the software-engineering patterns (stable); the RP rule findings do not expire (they are fixed historical game rules for closed seasons 2022-2025, and 2026's rules are fixed for the 2026 season already underway) — no re-verification needed absent a discovered corpus data-quality issue
