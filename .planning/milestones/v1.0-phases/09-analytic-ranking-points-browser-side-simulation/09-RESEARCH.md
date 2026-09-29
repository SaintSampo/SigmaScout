# Phase 9: Analytic Ranking Points & Browser-Side Simulation - Research

**Researched:** 2026-09-11
**Domain:** Closed-form probability (Poisson-binomial / negative-binomial composition of independent
discrete RP-threshold variables), browser-safe numerical code, Cloudflare Worker D1 state shapes.
**Confidence:** HIGH for code-surface claims (all verified by reading source this session, several
cross-checked against a fresh probe of the live corpus); MEDIUM for the external probability-theory
recommendations (cross-checked against multiple independent sources); explicit LOW/ASSUMED items are
called out below and repeated in the Assumptions Log.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (marginal family):** Count-valued threshold variables use a **negative binomial** marginal,
  fitted from the existing alliance mean/variance by method of moments. Count-native, right-skewed,
  exact discrete CDF at integer thresholds, support `[0, ∞)`. — Reversibility: costly (full republish).
- **D-02:** A variable's marginal family is **declared per variable in the season module**, alongside
  the existing `unit` field. No implicit derivation from `unit`.
- **D-03 (RESEARCH ITEM — resolved this session, see `<code_context>`):** Three seasons compute a
  bonus from a derived quantity (2017 `rotorCount`, 2016 `towerRobotCount`, 2023 `links`). Research
  must decide between (1) clearing denominators to keep the clause integer, or (2) tracking the
  derived count as a threshold variable directly, and empirically check whether these are ever
  non-integral in the corpus.
- **D-04 (selection/reporting split):** Marginal family chosen on **2016–2020 + 2022 only**;
  calibration published from **2023–2026**, which had no say in the choice. Not BPR tuning, does not
  touch BPR's sealed holdout.
- **D-05 (named config):** The four accuracy changes ship together behind a **named, versioned RP
  layer config** — `{winSource, tieModel, marginal}` — read by the RP layer and recorded in the
  published artifact.
- **D-06:** Toggles live **only until the attribution measurement is published**, then collapse to one
  path. No permanent combinatorial config surface.
- **D-07: No Monte Carlo equivalence check.** MC path deleted; unit tests carry the correctness
  burden — **required mitigation**: hand-computed expected values for each of the seven mechanisms,
  plus a dedicated case for the 2026 nested-threshold trap (`energized`/`supercharged`).
- **D-08:** The RP module becomes **browser-safe** in this phase — precondition for deliverable 8.
  Drop `ml-matrix` (needed only for the Cholesky being deleted), add a small `erf`, so it becomes a
  zero-import leaf like `rankSimulation.ts`.
- **D-09 (acceptance bar):** **Per-bonus, not pooled** — a majority of individual bonuses must improve
  on Brier, and no single bonus may get worse at all. Measured on the 2023–2026 reporting slice.
- **D-10:** **The closed form ships unconditionally**, regardless of whether the modelling changes
  (marginal, tie, win source) clear the acceptance bar. A failed marginal swap reverts to Gaussian
  while everything else lands.
- **D-11:** **Any improvement in the right direction counts** — no minimum effect size, no paired
  bootstrap. **Required mitigation**: both arms measured through the same published scorer
  (`scripts/measureRpCalibration.ts`) — a scorer mismatch has previously manufactured a ~0.003 phantom
  regression in this project.
- **D-12:** Assert **level-1 output byte-identical** across a corpus slice, before and after the whole
  phase: `pRedWin`, `redScore`, `blueScore` unchanged.
- **D-13 (win RP):** Win RP comes from the **published `pRedWin`**, closing F6's coherence gap.
  — Reversibility: costly (changes every published pmf).
- **D-14 (tie RP):** Tie RP uses a **discrete score-margin model**, replacing a branch that can never
  fire under continuous draws.
- **D-15 (rank simulation):** **Monte Carlo stays for the rank step.** Deliverable 7 is only the
  red/blue independence fix: draw each match outcome **once**, then bonuses per alliance, instead of
  drawing red and blue independently (where both alliances can currently "win" the same draw).
- **D-16 (pre-schedule redesign):** The 20 synthetic schedules are themselves a Monte Carlo
  approximation of an expectation over schedule randomness. Target: a **field-averaged analytic
  predictor** — a team's own belief plus field-level summary statistics (mean/variance of per-team
  contributions across the roster). Season total = exact convolution of N copies of the team's
  field-averaged per-match pmf. Target artifact ~2–3 KB vs. ~265 KB today, schedule generation deleted
  entirely. — Reversibility: one-way (schema change + republish to restore).
- **D-17 (ladder):** Measure at each rung, stop at the first that holds: (1) field-averaged analytic,
  no schedules; (2) self-generated random schedules (~20 KB), testing whether they reproduce
  cheesy-arena balanced-grid results; (3) licensed templates as today.
- **D-18:** Kept in Phase 9 — not split into Phase 10.
- **D-19:** Template-licence question is **conditional, not blocking** — only needs answering if rung
  1 fails and rung 2 is chosen.
- **D-20 (housekeeping):** Presim sidecars must be re-keyed/regenerated (every one in R2 belongs to
  retired `vpr`) and presim generation re-enabled (`--presim-from-season 9999` currently), or the
  pre-schedule stop stays dark regardless of which rung ships.
- **D-21 (live Worker RP):** Add `redRpPmf`/`blueRpPmf` to `buildEventMatchRow` (currently omits them
  entirely on played rows); give the Worker an RP accumulator resumed from D1 behind a **new state
  shape** (`rpBeliefs` belongs to retired VPR, must not be reused); add a live/offline row-shape
  parity test. — Reversibility: one-way (state-shape bump requires seed-first-deploy-second).

### Claude's Discretion

- The exact form of the discrete score-margin tie model (D-14) — approach chosen, not formulation.
- Numerically stable Poisson-binomial convolution for 2016 `breach`, and the `erf` implementation for
  D-08.
- What the RP scorecard displays beyond the already-decided form (see canonical refs).
- The `--presim-from-season` value on re-enable.

### Deferred Ideas (OUT OF SCOPE)

- Dependence between threshold variables (audit F4) — the diagonal block discards +0.0391 of measured
  real dependence; bivariate has a closed form but 2025 `coralBonus`'s four levels would need Genz
  quadrature. Deliberately deferred, and the analytic form makes this *harder* to add later (accepted
  cost).
- 2019 `completeRocket`'s always-false branch (F12); 2022 `cargoBonus`'s auto-vs-match-cargo
  independence flaw.
- Bonus dot 0.5 threshold (F10) — deliverable 4 fixes the upstream probability; the dot display
  threshold itself is a separate UI decision, not taken up.
- OPR/EPA's cold-start gate (fixed for BPR only, by Sigma Score).
- Splitting the pre-schedule redesign into Phase 10 (declined; natural fault line if Phase 9 proves
  too large in planning).
- Schedule-template redistribution licensing — conditional on rung 2 being reached; evaporates if
  rung 1 holds.

</user_constraints>

<phase_requirements>
## Phase Requirements

Post-v1.0. This phase has **no v1 requirement IDs** — all 38 map to Phases 1–8 (see
`.planning/REQUIREMENTS.md`'s Traceability table, every row `Complete`). Scope instead derives from
two read-only audits, both consulted in full this session:

| Source | What it contributes |
|--------|---------------------|
| `.planning/todos/pending/ranking-points-audit.md` | 13 findings F1–F13; Phase 9 closes F1, F2/F3, F5, F6, F7, and F10's upstream cause. F4, F12, and 2022's cargo flaw are explicitly deferred. |
| `docs/simulation-architecture.md` | The two simulation engines, the sidecar anatomy (95.4% of ~265 KB is priced schedules the client never reads), and the four blockers to browser-side pricing. |

| Deliverable | Audit finding(s) closed | Research support |
|---|---|---|
| 1 (declarative bonus contract) | groundwork for 2, 3, 4 | `<code_context>` bonus-mechanism taxonomy table below enumerates all 24 bonuses across 10 seasons against the 7 mechanism classes — this is the direct input to the contract's shape. |
| 2 (`analyticRpPmf`) | F4 (partially — diagonal block stays, only the MC sampling noise goes) | Verified the joint IS exactly diagonal/zero-cross-covariance in the current code (`empiricalMoments.ts`), so the closed form is provably exact, not approximate — see "Verified Claims" below. |
| 3 (win RP from `pRedWin`) | F6 | Confirmed `distribution.ts` currently derives win/tie from a SEPARATE Gaussian draw fed by Swing Band variance, not from `pRedWin` — exact code location cited below. |
| 3 (tie RP, discrete margin) | F7 | Confirmed `tied = !redWon && !blueWon` on two continuous draws — reproduced exactly, dead-code claim holds. |
| 4 (right-skewed marginals) | F2, F3 (leading candidate) | Measured this session: every one of 15 threshold variables across 7 seasons is 100% integer-valued in the corpus and overdispersed (variance/mean 1.27–102), which is the textbook negative-binomial regime. |
| 5 (RP scorecard) | F1 | Confirmed `scripts/measureRpCalibration.ts` already computes everything needed; confirmed `CompareArtifactSchema`'s `CompareSliceSchema` carries no `rp`/`bonus` key today. |
| 6 (live Worker RP) | F5 | Confirmed `buildEventMatchRow` (played rows, `scheduled.ts:530`) omits `redRpPmf`/`blueRpPmf` entirely, while `buildEventUpcomingRow` (line 550) includes them — F5's asymmetry claim holds exactly. |
| 7 (rank sim red/blue coupling) | (simulation-architecture.md's engine description) | Confirmed `simulateRanks` calls `drawCategorical(match.redRpPmf, rng)` and `drawCategorical(match.blueRpPmf, rng)` as two independent draws from the shared stream — D-15's fix target confirmed. |
| 8 (pre-schedule ladder) | simulation-architecture.md Option A/B/C, F11 | Confirmed presim sidecars are 100% `vpr`-keyed (orphaned) and generation is off via `DEFAULT_PRESCHEDULE_FROM_SEASON = 9999` in `publish.ts` (not literally `--presim-from-season 9999`, see note in Common Pitfalls). |

</phase_requirements>

## Summary

Phase 9 replaces a 4,000-draw Monte Carlo (`rpPmfForMatch`, `packages/core/rankingPoints/distribution.ts`)
with an exact closed-form pmf, because the joint distribution it samples is — verified this session by
reading `empiricalMoments.ts` and `moments.ts` — **already exactly diagonal with exactly zero
cross-alliance and cross-variable covariance**. There is no approximation being introduced; the
existing independence structure was already there, and the Monte Carlo was adding sampling noise to
a distribution that has closed-form marginals and a closed-form convolution.

The bonus-prediction surface is small and fully enumerated: 24 bonuses across 10 season modules,
2016–2026 (`packages/core/rankingPoints/2016.ts` … `2026.ts`), reducing to seven mechanism classes,
every one of which the user's CONTEXT.md has already confirmed has a closed form. The riskiest of
these is the 2026 nested-threshold case (`energized`/`supercharged` both threshold the same variable,
`hubTotalCount`) — get this wrong and `P(both)` is computed as a product instead of the tighter
interval probability it actually is, silently overstating correlation the model does not otherwise
have anywhere else in its joint.

This session ran a live corpus probe (read-only, `experiments/` scripts, gitignored, deleted after
use) that directly answers D-03's research item: all three seasons' derived linear-combination
bonuses (2017 `rotorCount`, 2016 `towerRobotCount`, 2023 `links`) are **100% integer-valued** across
25,386 / 22,158 / 27,116 alliance-sides respectively — zero exceptions. A second, broader probe found
every other threshold variable in the RP system (15 variables across 7 seasons, including every
`points`-unit one) is *also* 100% integer-valued and substantially overdispersed (variance/mean
ratios from 1.27 to 102.3) — directly supporting D-01's negative-binomial choice over both a
continuity-corrected normal (wrong shape) and a Poisson (wrong dispersion, since Poisson forces
variance = mean and every single measured variable badly violates that).

The live Worker's omission of RP (F5) is real and precisely located: `buildEventMatchRow` in
`apps/worker/src/scheduled.ts:530` builds a played-row match object with no `redRpPmf`/`blueRpPmf`
fields at all, while its sibling `buildEventUpcomingRow` (line 550) includes them — an asymmetry, not
a missing-and-present pair. The fix (D-21) is structurally identical to two already-shipped precedents
in the same file: `sigmascoutSwing` (shape 9→10) and `sigmascoutSigma`/`sigmascoutSigmaPopulation`
(shape 10→11), both "passenger" keys riding inside the same per-team D1 `state_json` blob rather than
a new table or a new subrequest. This means **D-21 costs zero additional D1 subrequests** — the
Worker already reads/writes one row per touched team; RP beliefs are a new JSON key inside that same
row. The current shape is 11 (bumped 2026-09-10 for Sigma Score) — CLAUDE.md's memory note about a
"shape 10→11 blocker" is describing a bump that has *already landed*; this phase's bump will be
11→12.

The pre-schedule ladder (deliverable 8, D-16/D-17) is the largest open design surface. Rung 1's
"field-averaged analytic" predictor has no existing implementation to read — it is new math — but
every building block it needs already exists in the codebase (`RpMomentsAccumulator`,
`analyticRpPmf`'s own convolution machinery, `simulateRanks`'s zero-baseline "before schedule" mode).
The measurement bar ("rank bands match the current baked output on real events") needs a concrete
comparison statistic, which this research recommends below since CONTEXT.md leaves the exact form
open.

**Primary recommendation:** Build the declarative bonus contract and `analyticRpPmf` first (deliverable
1–2, pure math, testable in isolation with hand-computed expectations per D-07), verify D-12's
byte-identical level-1 guarantee immediately after, then layer in win/tie/marginal changes behind
D-05's named config, publish the scorecard, and only then attempt the pre-schedule ladder — each rung
is a measurement gate, and rung 1 cannot be evaluated until `analyticRpPmf` exists and is trusted.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Bonus-threshold marginal distributions (NB fit, CDF) | Node pipeline (`packages/core/rankingPoints/`) | Browser (same pure module, D-08) | Pure math, zero I/O; must run identically offline and in-browser — this IS the point of D-08's browser-safety requirement. |
| Joint RP pmf construction (`analyticRpPmf`) | Node pipeline / Browser (shared leaf) | Cloudflare Worker (`scheduled.ts`, D-21) | Same pure function, three call sites: offline publish, browser pre-schedule predictor (rung 1), live Worker tick. |
| RP belief accumulation (`RpMomentsAccumulator`) | Node pipeline (offline replay) | Cloudflare Worker + D1 (live resume) | Offline: full walk-forward per season. Live: resumed from a D1 passenger key, folded incrementally per tick — same class as `sigmascoutSwing`/`sigmascoutSigma`. |
| RP calibration scorecard (deliverable 5) | Node pipeline (`scripts/measureRpCalibration.ts`) → R2 artifact | Browser (Compare page render) | Compute offline/CI, publish as static JSON, render client-side — matches the project's "precompute everything" mandate (NAV-06). |
| Rank simulation (Monte Carlo, D-15) | Browser (Web Worker, live case) | Node pipeline (`buildPreScheduleArtifact`, baked case) | Unchanged tier split from Phase 8 — `rankSimulation.ts` stays the one zero-import implementation both call. |
| Pre-schedule field-averaged predictor (rung 1) | Browser (client-side, per D-16's whole point) | Node pipeline (population statistics precompute) | The team-level pmf convolution is cheap enough to run on click; the field-level mean/variance summary statistics must be precomputed offline and shipped as the ~2–3 KB artifact. |
| Live Worker artifact write (`buildEventMatchRow`) | Cloudflare Worker | — | D-21's fix site; CPU-bound, not I/O-bound, since the analytic form removes the Cholesky/4000-draw cost. |
| D1 per-team state (RP beliefs) | Cloudflare Worker + D1 | — | Never reachable from the browser — matches the project's existing D1-is-Worker-internal-only convention (CLAUDE.md "What NOT to Use"). |

## Project Constraints (from CLAUDE.md)

Directives from `.claude/CLAUDE.md` that bear directly on this phase's design space:

- **Don't-hand-roll boundary, narrowly drawn.** CLAUDE.md's Don't-Hand-Roll guidance (inherited from
  the project's own RESEARCH.md convention, visible in every `erf`/`mulberry32`/`fnv1a32` doc comment
  this session read) is: matrix inversion should never be hand-rolled (use a library), but small,
  well-known numerical primitives with a citable closed-form source (PRNG, hash, `erf`) ARE the
  recommended hand-rolled path, "cite, don't rederive." D-08's plan (drop `ml-matrix`, add a small
  `erf`) is exactly this convention applied once more — there are already four independent `erf`
  implementations in this codebase (`packages/core/algorithms/sigma1/linkFunctions.ts:41`,
  `packages/core/algorithms/bpr.ts:303`, `packages/bpr/model.ts:215`, `packages/pcm/model.ts:135`),
  all citing Abramowitz-Stegun formula 7.1.26. A fifth, in `rankingPoints/`, is squarely in-convention.
- **Workers CPU/subrequest budget.** 10ms CPU per invocation (soft, sustained-cost budget, not a flat
  per-tick ceiling — see CLAUDE.md's own corrected framing), 50 subrequests per invocation
  (`SUBREQUEST_CAP`, `apps/worker/src/subrequestBudget.ts:33`, minus a 4-request reserve). Only `bpr`
  is in `LIVE_ALGORITHM_IDS` today (`apps/worker/wrangler.toml:61`) — confirmed this session. D-21's
  RP accumulator must fit inside this budget; see "Worker CPU and State Shape" below for why it does
  not add subrequests.
- **D1 is Worker-internal only, never client-facing.** CLAUDE.md's "What NOT to Use" table: D1 is
  narrowly permitted for live per-team algorithm state, never reachable from the browser. D-21's new
  RP belief field must follow this — it lives in D1, not in any client-fetched artifact.
- **Seed first, deploy second** for any state-shape bump — CLAUDE.md's Cloudflare topology section and
  `stateSnapshot.ts`'s own header both state this. D-21 is one-way per CONTEXT.md's own reversibility
  note.
- **No client-side per-request season recomputation** (CLAUDE.md "Out of Scope" / "What NOT to Use").
  D-16's field-averaged predictor must stay inside this boundary: it computes a *convolution of a
  precomputed, shipped pmf*, not a season recompute from raw match data — this is the same category
  as the existing live rank simulation (Phase 8), not a new exception.
- **Testing:** Vitest is the required framework (already in use throughout). D-07's mitigation
  (hand-computed expected values per mechanism) is a Vitest unit-test obligation, not optional.
- **GSD workflow enforcement.** Direct repo edits must go through `/gsd-plan-phase` → `/gsd-execute-phase`,
  not ad hoc — process note for the planner, not a modelling constraint.
- **Secrets handling.** Not directly implicated by this phase's deliverables (no `.env` reads
  expected), but any executor touching the D1 seed/import flow (D-21's seed-first step) should be
  aware of the project's `.env`-never-`Read` convention documented in CLAUDE.md and in
  `project_d1_seed_import_auth` memory (source `.env` for the D1 auth token, never echo it).

## Standard Stack

This phase **removes** a dependency (`ml-matrix`, from the RP path only — `opr.ts` still needs it for
`SingularValueDecomposition`, unaffected) and **adds no new external package**. No `npm install` is
required by any deliverable in this phase; every new capability (negative-binomial CDF, Poisson-
binomial convolution, `erf`) is a small hand-rolled numerical routine matching the project's existing
"cite, don't rederive" convention (see Project Constraints above and Code Examples below).

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Zod | 4.4.3 `[VERIFIED: package.json:58]` | Runtime schema validation — unchanged, `RpRuleModule`'s season schemas already use it | Already the project's fetch/artifact-boundary validator; no change needed for this phase's contract additions (marginal-family field is a plain string enum on an existing interface). |
| Vitest | project-standard `[CITED: CLAUDE.md Technology Stack]` | Unit tests for the seven mechanism classes (D-07's mitigation) | Existing convention, no change. |

### Removed This Phase

| Library | Current use | Why removed | What replaces it |
|---------|-------------|--------------|-------------------|
| `ml-matrix` 6.15.0 `[VERIFIED: package.json:63]` | `CholeskyDecomposition`/`Matrix` in `rankingPoints/distribution.ts` (RP joint draw only) | D-08: the RP module must become a zero-import browser-safe leaf; `ml-matrix` is the only non-trivial import standing in the way. `opr.ts` uses the SAME package for `SingularValueDecomposition` — unaffected, stays a repo dependency overall. | No matrix decomposition needed at all — the analytic form is a sequence of scalar CDF evaluations and 1-D array convolutions, never a matrix operation. |

### Alternatives Considered (marginal family)

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Negative binomial (D-01, locked) | Continuity-corrected normal | One-line change but fixes only the discreteness error, not the skew — rejected in discussion (`09-DISCUSSION-LOG.md`). |
| Negative binomial (D-01, locked) | Gamma | Continuous, right-skewed, closed-form CDF, but keeps a discreteness error at integer thresholds — rejected in discussion. |
| Negative binomial (D-01, locked) | Poisson | Closed under convolution and simpler, but forces variance = mean; **measured this session**, every one of 15 threshold variables has variance/mean between 1.27 and 102.3 — Poisson would be badly misspecified everywhere, not just at the tail. |

**Installation:** none required.

## Package Legitimacy Audit

**Not applicable this phase.** No new external packages are installed. `ml-matrix` is *removed* from
one call site (`rankingPoints/distribution.ts`) but remains a repo dependency via `opr.ts`. Every new
capability (NB CDF, Poisson-binomial convolution, `erf`) is hand-rolled, matching the project's
existing, already-audited convention for exactly this class of small numerical primitive.

**Packages removed due to any verdict:** none (removal is a design choice, not a legitimacy failure).
**Packages flagged as suspicious:** none.

## Architecture Patterns

### System Architecture Diagram — the analytic RP pipeline (deliverables 1–4, 6)

```
 Season rule module (2016.ts..2026.ts)
   declares: thresholdVariables[] { name, unit, marginalFamily }  <-- D-02 new field
             bonusNames[], winRp, tieRp, maxRp
             parse()            -- what actually happened (unchanged)
             predictThresholds() -- bonus flags from threshold values (unchanged signature)
             NEW: bonusPredicates[] -- declarative contract (D-1) describing HOW each
                  bonus reduces to thresholds: single/linear/conjunction/nested/count-k/
                  mixture/const. predictThresholds() becomes a thin evaluator over this.
                        |
                        v
 RpMomentsAccumulator (empiricalMoments.ts, UNCHANGED)
   per-team EWMA belief per threshold variable -> momentsFor(roster, scoreMean, scoreVariance)
   -> AllianceRpMoments { meanVector, varianceBlock (diagonal), scoreMean, scoreVariance,
                           scoreCrossCovariance (all zero) }
                        |
                        v
 analyticRpPmf (NEW, replaces rpPmfForMatch in distribution.ts)
   1. Win/tie RP:
        D-13: winRp probability FROM pRedWin (not re-derived from Swing Band draw)
        D-14: tieRp probability from a discrete score-margin model
   2. Bonus RP, per alliance:
        a. Evaluate each threshold variable's marginal CDF (family per D-02) at its
           tiered threshold(s) -> per-bonus/per-branch probability
        b. GROUP bonuses that share a threshold variable (2026 energized/supercharged
           both key hubTotalCount) -> compute INTERVAL probabilities, not independent
           products, for the nested case
        c. Convolve independent bonus-group outcomes (0/1 per bonus) into a pmf over
           bonus-RP-count using direct polynomial convolution (small N, <=3 bonuses/season)
        d. Convolve with the win/tie outcome RP to get the final total-RP pmf
                        |
        +---------------+---------------------------------+
        |                                                  |
        v                                                  v
 Offline publish (publishSeasons/--event,              Live Worker tick (scheduled.ts, D-21)
 packages/harness/sigmaScoutLayer.ts, UNCHANGED         buildEventMatchRow NOW calls
 call site, #rpFieldsFor)                               analyticRpPmf via a Worker-resident
        |                                                RpMomentsAccumulator seeded from
        v                                                D1's new sigmascoutRp passenger key
 EventArtifact / TeamSeasonArtifact (redRpPmf/                    |
 blueRpPmf on PLAYED and upcoming rows)                            v
        |                                                D1 state_json per-team row
        v                                                (existing write path, new JSON key
 Bonus dots (BonusRpDots.tsx) / Rank simulation          -- ZERO extra subrequests)
 (rankSimulation.ts, D-15's coupling fix)
```

### System Architecture Diagram — the pre-schedule ladder (deliverable 8)

```
 Rung 1: Field-averaged analytic (NEW, no schedule generation)
   Offline precompute per event:
     fieldStats = mean/variance of each team's per-match RP-relevant contribution,
                  computed ACROSS THE ROSTER (captures partner-quality spread)
     perTeamPmf(team) = analyticRpPmf-style convolution of:
                           team's own belief (RpMomentsAccumulator, already exists)
                           + field-level partner summary (fieldStats)
     seasonTotalPmf(team) = convolve perTeamPmf(team) with itself matchesPerTeam times
   -> artifact: { roster[], matchesPerTeam, perTeamPmf: pmf[] }  (~2-3 KB target)
   -> client: feeds DIRECTLY into simulateRanks's zero-baseline mode (unchanged),
              OR renders season-total pmf's rank-band directly (needs field-relative
              ranking logic -- see Open Questions)
   MEASURE: rank bands vs current baked (20-schedule) output on real events.
   If bands match -> SHIP, delete schedule generation, stop here.

 Rung 2 (only if rung 1 fails): Self-generated random schedules (~20 KB)
   Client (or offline) generates schedules via seeded Fisher-Yates, WITHOUT cheesy-arena's
   balanced-grid structure -- plain random pairing.
   MEASURE: do results match today's balanced-grid baked output?
   If yes -> SHIP (balanced structure was tradition, not signal).
   If no -> licence question becomes live (D-19), fall to rung 3.

 Rung 3: Licensed cheesy-arena templates, as today (scheduleTemplates.ts, UNCHANGED).
```

### Recommended Project Structure

No new top-level directories. Changes land inside existing modules:

```
packages/core/rankingPoints/
├── constants.ts        # RpRuleModule gains marginalFamily field on RpThresholdVariable;
│                        # new BonusPredicate declarative type (D-1)
├── {2016..2026}.ts      # each module's predictThresholds() becomes a thin evaluator over
│                        # a declared bonusPredicates[] array; parse() unchanged
├── empiricalMoments.ts  # UNCHANGED (already emits the exact diagonal/zero-cross shape
│                        # analyticRpPmf needs)
├── moments.ts           # UNCHANGED (contract)
├── marginals.ts         # NEW — negative-binomial fit (method of moments) + CDF,
│                        # Poisson-binomial convolution for count-of-k (2016 breach),
│                        # small erf() (D-08)
├── analyticPmf.ts       # NEW — replaces distribution.ts's rpPmfForMatch; zero imports
│                        # (drops ml-matrix); win/tie from pRedWin + discrete margin model
├── rules.ts              # UNCHANGED dispatch table
packages/harness/
├── sigmaScoutLayer.ts    # #rpFieldsFor call site swaps rpPmfForMatch -> analyticRpPmf;
│                        # RP_MONTE_CARLO config replaced by the D-05 named RpLayerConfig
├── rpConservativeBranch.ts  # UNCHANGED — measures parse() vs predictThresholds(), agnostic
│                        # to how predictThresholds() is implemented internally
├── preSchedule.ts        # rung-1 branch: new field-averaged path alongside (then replacing)
│                        # the schedule-based buildPreScheduleArtifact
apps/worker/src/
├── scheduled.ts          # buildEventMatchRow gains redRpPmf/blueRpPmf (D-21); new
│                        # Worker-resident RpMomentsAccumulator per algorithm/event
├── stateSnapshot.ts       # STATE_SNAPSHOT_SHAPE_VERSION 11 -> 12; new
│                        # withRpBeliefs/readRpBeliefs passenger pair, mirroring
│                        # withSwingBeliefs/withSigmaBeliefs exactly
scripts/
├── measureRpCalibration.ts  # UNCHANGED computation; wired to also emit a publishable
│                        # artifact shape (deliverable 5) instead of console-only output
```

### Pattern 1: The "passenger key in the same D1 row" pattern (for D-21)

**What:** A level-2 (non-algorithm) belief rides inside the SAME `scopeKind: "team"` D1 row an
algorithm's own state already occupies, under its own JSON key, read/written by standalone
`readX`/`withX` functions that the algorithm's own serializer never touches.

**When to use:** Any live-Worker state that (a) is per-team, (b) must survive a tick-to-tick resume,
and (c) is not itself part of any published algorithm's model.

**Example (existing precedent, quoted verbatim — this is the template D-21's RP belief passenger must
follow):**

```typescript
// Source: packages/harness/stateSnapshot.ts:852-912 (Swing Factor passenger, shape 9->10)
const SWING_BELIEF_KEY = "sigmascoutSwing";

export function readSwingBeliefs(rows: readonly StateRow[]): Map<string, SwingBelief> {
  const beliefs = new Map<string, SwingBelief>();
  for (const row of rows) {
    if (row.scopeKind !== "team") continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.stateJson) as Record<string, unknown>;
    } catch {
      continue;
    }
    const raw = parsed[SWING_BELIEF_KEY] as Partial<SwingBelief> | undefined;
    if (raw === undefined) continue;
    const { weight, weightSquares, mean, m2 } = raw;
    if (![weight, weightSquares, mean, m2].every((v) => typeof v === "number" && Number.isFinite(v))) continue;
    beliefs.set(row.scopeKey, { weight: weight!, weightSquares: weightSquares!, mean: mean!, m2: m2! });
  }
  return beliefs;
}

export function withSwingBeliefs(rows: readonly StateRow[], beliefs: ReadonlyMap<string, SwingBelief>): StateRow[] {
  return rows.map((row) => {
    if (row.scopeKind !== "team") return row;
    const belief = beliefs.get(row.scopeKey);
    if (belief === undefined) return row;
    const parsed = JSON.parse(row.stateJson) as Record<string, unknown>;
    return { ...row, stateJson: JSON.stringify({ ...parsed, [SWING_BELIEF_KEY]: belief }) };
  });
}
```

D-21's RP passenger is `RpMomentsAccumulator`'s per-team, per-variable `VariableBelief` (`weight`,
`weightSquares`, `mean`, `m2` — same shape as `SwingBelief`, one per tracked threshold variable name),
under a new key (e.g. `sigmascoutRp`, following the `sigmascout{Feature}` naming convention both
existing passengers use), read/written by a third `readRpBeliefs`/`withRpBeliefs` pair.

### Pattern 2: Named, versioned config sets for offline-sweepable model variants (for D-05)

**What:** A `WinProbMode`-shaped enum/config, resolved once per run, that the harness can instantiate
in every combination offline while production ships exactly one.

**Existing precedent already in this codebase:**

```typescript
// Source: packages/core/algorithms/sigma1/linkFunctions.ts:1-27 (comment, elided code)
export type WinProbMode = "season-sd" | "predictive-variance" | "normal-cdf";
// sigma1/index.ts's makeSigma1 assembles one AlgorithmModule per mode, all runnable side
// by side in one harness run so the choice is settled by measured Brier/accuracy.
```

D-05's `{winSource, tieModel, marginal}` config is the identical shape, one level up (a
config object with three enum fields instead of one enum), read once by
`SigmaScoutLayer`'s constructor and threaded through to `analyticRpPmf`. D-06 additionally requires
this to be *temporary*: once the attribution measurement (deliverable 4/5) is published, the losing
branches must be deleted and the config collapses to a single hardcoded path — unlike `WinProbMode`,
which stays permanently multi-valued. Note this difference explicitly when planning: D-05/D-06 is NOT
simply "add another `WinProbMode`" — it is scaffolding with a planned removal date.

### Anti-Patterns to Avoid

- **Treating `energized`/`supercharged` as independent Bernoulli events.** Both threshold the same
  variable (`hubTotalCount`), `2026.ts:96-97`. `P(supercharged) <= P(energized)` always (supercharged's
  threshold, 360/360/500, is >= energized's, 100/240/360, at every tier — verified by reading the two
  `RpTieredThreshold` constants side by side). The correct joint is `P(both) = P(supercharged)`, the
  correct marginal-only-supercharged is `P(supercharged AND NOT energized) = 0` structurally (since
  supercharged implies energized), and `P(only energized) = P(energized) - P(supercharged)`. Treating
  them as independent computes `P(both) = P(energized) * P(supercharged)`, which is smaller than the
  truth (understates the joint) and lets the other combination sum to more than 1 minus that. D-07
  explicitly names this as the single easiest mistake in the whole phase.
- **Fitting a separate negative binomial per RAW component and then convolving unequal-dispersion NBs
  for a derived linear combination.** NB is closed under summation only when every summand shares the
  same success-probability parameter `p` — not guaranteed here (`autoRotorPoints`/`teleopRotorPoints`
  in 2017 have different scales entirely). D-03's resolution (below) sidesteps this by fitting NB
  directly on the derived integer count, never on a sum of two differently-parameterized NBs.
- **Using `--presim-from-season` as if it's a runtime CLI-only override with a persistent config
  value of `9999`.** It is a *default constant* (`DEFAULT_PRESCHEDULE_FROM_SEASON = 2026` in
  `publish.ts:137`) that a *specific invocation* overrode with `--presim-from-season 9999` — the
  default itself is NOT 9999. See Common Pitfalls for the exact re-enable mechanics.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Matrix decomposition (Cholesky/SVD) | Custom linear algebra | `ml-matrix` — but D-08 correctly recognizes the analytic RP form needs NO matrix operation at all; this row is about NOT reintroducing one, not about a library choice. |
| `erf` / normal CDF | A from-scratch numerical integration of the Gaussian PDF | The Abramowitz-Stegun 7.1.26 closed-form approximation, already implemented 4 times in this codebase (see Code Examples) — copy the pattern, don't rederive it. |
| Deterministic PRNG for reproducible draws (still needed for D-15's rank MC, and for D-17 rung 2's random schedule generation) | `Math.random()` or a new hand-rolled generator | `mulberry32`, already implemented 3 times in this codebase citing the same source each time — reuse the existing pattern for any NEW seeded stream this phase needs (e.g., rung 2's schedule shuffle already has this in `preSchedule.ts`'s own `seededShuffle`). |
| Negative-binomial parameter estimation | A from-scratch MLE or numerical optimizer | Method-of-moments closed form: `r = mean^2 / (variance - mean)`, `p = mean / (mean + r)` (equivalently `r/(r+mean)` depending on parameterization — pin the exact convention in the plan; see Code Examples). This is algebra, not a library call, and is the standard textbook estimator — cite, implement directly. |

**Key insight:** every new numerical routine this phase needs is small, closed-form, and already has
either an in-repo precedent (erf, PRNG) or a textbook one-line formula (NB method of moments). Nothing
here crosses into "should be a library" territory — the phase's whole thesis is that a library
(`ml-matrix`'s Cholesky) is *no longer needed at all*, not that a different library is needed instead.

## Common Pitfalls

### Pitfall 1: The `--presim-from-season` flag name in the roadmap text is not literally what needs changing

**What goes wrong:** The roadmap deliverable 8 text says presim generation is "off via
`--presim-from-season 9999`," which reads as if some persisted config always passes that flag.

**What's actually true (verified `packages/harness/publish.ts:137,2137`):** The *default* is
`DEFAULT_PRESCHEDULE_FROM_SEASON = 2026`. A specific run was invoked with `--presim-from-season 9999`
(per the audit's commit reference `1a759198`), which is a CLI override, not a code change to the
default. There is no committed script or config file currently pinning `9999` — it is only true of
whichever `pnpm publish:seasons` invocation last ran with that flag. **Re-enabling presim generation
is therefore just: run the next publish WITHOUT `--presim-from-season 9999`** (it will fall back to
`DEFAULT_PRESCHEDULE_FROM_SEASON`, 2026), or explicitly pass a chosen value per Claude's Discretion.

**How to avoid:** Don't plan a code change to "turn presim back on" — plan the republish command
itself, and note this explicitly in the plan so the executor doesn't go looking for a `9999` literal
to delete.

### Pitfall 2: `maxRp = winRp + bonusNames.length` looks derived but is independently declared per module

**What goes wrong:** A refactor of the declarative bonus contract could accidentally desync `maxRp`
from the real bonus count if a module is edited to add/remove a bonus predicate without also updating
the literal `maxRp: N + BONUS_NAMES.length` expression.

**Why it happens:** Every one of the 10 season modules currently writes `maxRp: <winRp> +
BONUS_NAMES.length` as a literal expression, not a computed property read elsewhere — it is
self-consistent *by construction* in each file today (verified across all 10 files this session), but
nothing enforces it structurally; `rules.test.ts` asserts it per the constants.ts doc comment ("asserted
equal in `rules.test.ts` rather than trusted from a hand-maintained literal").

**How to avoid:** Keep `bonusNames.length` as the source of truth for the bonus-count half of the
expression (already true in every module) and don't introduce a second bonus-count literal anywhere
in the new declarative contract (D-1) — derive `bonusNames` FROM the declared predicates array, not
alongside it, so there is exactly one list of bonus names per season, not two that must be kept in
sync.

### Pitfall 3: Negative-binomial method-of-moments is undefined when variance ≤ mean

**What goes wrong:** The method-of-moments NB estimator is `r = mean^2 / (variance - mean)`. When
`variance <= mean` (under-dispersion or exact equidispersion, e.g. a genuinely Poisson-like or even
sub-Poisson variable), this divides by zero or goes negative — an invalid `r`.

**Why it happens:** Early-season teams with very few folded observations (`RpMomentsAccumulator`'s
`fold()`) can produce noisy variance estimates that dip below the mean by chance, even though the true
generative process is overdispersed. **Measured this session across the full corpus, every real
threshold variable IS overdispersed** (var/mean from 1.27 to 102.3) — but that is a population-level
fact, not a per-team, per-in-season-moment guarantee.

**How to avoid:** Document and test an explicit fallback for `variance <= mean` (e.g., clamp to a
minimum dispersion, or fall back to a Poisson/degenerate branch for that one prediction) rather than
letting `r` go negative/infinite and propagate NaN into the pmf. This is exactly the kind of numerical
edge case D-07's "no MC equivalence check" mitigation (hand-computed test cases per mechanism) should
include a case for.

**Warning signs:** NaN or Infinity appearing in a pmf; a test with a very-cold-start team (1-2
observations) producing an all-zero or malformed marginal.

### Pitfall 4: `predictThresholds`'s conservative-branch convention must survive the declarative rewrite unchanged

**What goes wrong:** Six bonuses across five seasons (2018 `autoQuest`, 2019 `completeRocket`, 2023
`sustainabilityBonus`, 2024 `melodyBonus`, 2025 `coralBonus`/`autoBonus`) have a real achievement
condition that depends on an UNTRACKED alliance-level gating signal (coopertition flags, per-robot
booleans) that `predictThresholds` cannot see. The existing convention evaluates these at their
LESS-likely-to-achieve branch (documented, measured, "never overstates" — verified by
`rpConservativeBranch.ts`, which this session read in full). A declarative-contract rewrite that
tries to express every bonus as a pure function of threshold-variable CDFs could silently "fix" this
asymmetry by guessing the gate is met, which would be a real regression even though it looks like an
improvement.

**How to avoid:** The declarative contract (deliverable 1) must have an explicit case for "conjunction
across distinct variables, ONE of which is not tracked" that evaluates the untracked half at its
conservative constant (false, or the stricter threshold table), preserving the exact existing
behavior byte-for-byte. `rpConservativeBranch.ts`'s existing measurements (per-bonus understatement
rates) are the regression oracle — they must not change after the rewrite.

**Warning signs:** `rpConservativeBranch.ts`'s `overstatedRate` becoming non-zero for any bonus after
the rewrite (today it is exactly zero everywhere, measured and asserted).

### Pitfall 5: The Worker's `buildEventUpcomingRow` already emits `redRpPmf`/`blueRpPmf` — D-21 only needs to fix the PLAYED path

**What goes wrong:** A plan could scope D-21 as "add RP to the Worker's match artifacts" broadly,
missing that half the work (upcoming rows) is already done.

**What's actually true (verified `apps/worker/src/scheduled.ts:550-567`):** `buildEventUpcomingRow`
already includes `redRpPmf: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined` and the
same for blue. Only `buildEventMatchRow` (played rows, lines 530-548) is missing them. The deeper gap
is not the row-builder at all — it's that `prediction.redRpPmf` is never SET on the Worker's
`Prediction` object in the first place, because the Worker never constructs an `RpMomentsAccumulator`
or calls any RP pricing function (confirmed: no `SigmaScoutLayer`/`RpMomentsAccumulator` reference
anywhere in `apps/worker/src/`, matching the audit's F5 finding exactly).

**How to avoid:** Scope D-21 precisely: (1) instantiate and maintain a Worker-resident RP accumulator
per algorithm/event, resumed from D1 via the new passenger key; (2) call `analyticRpPmf` to populate
`prediction.redRpPmf`/`blueRpPmf` before either row builder runs; (3) add the two missing fields to
`buildEventMatchRow` (the actual code change); (4) `buildEventUpcomingRow` needs no field-list change,
only the upstream prediction needs to start carrying real values instead of `undefined`.

## Code Examples

### The seven bonus mechanisms, enumerated against every registered season (input to deliverable 1)

Verified by reading all 10 season modules (`packages/core/rankingPoints/2016.ts` … `2026.ts`) in full
this session:

| Season | Bonus | Mechanism class | Threshold variable(s) | Notes |
|---|---|---|---|---|
| 2016 | `breach` | Count-of-indicators ≥ k (Poisson-binomial) | `position{1-5}crossings` (5 independent counts, each own indicator "≥2 crossings") | k=4 of 5, flat across tiers, 0 FP/FN measured. |
| 2016 | `capture` | Linear combination (robot half) + single-variable ≤ (tower half), conjunction | `attackedTowerEndStrength` (≤0, opponent-sourced), `teleopChallengePoints`/`teleopScalePoints` (derived `towerRobotCount` ≥3) | D-03 case: `towerRobotCount` verified 100% integer, 22,158 sides, 0 exceptions (measured this session). |
| 2017 | `kPa` | Linear combination ≥ T | `autoFuelPoints` + `teleopFuelPoints` ≥ 40 | Both already `points` unit, already integral (0/25,386 non-integral, measured). |
| 2017 | `rotor` | Linear combination ≥ T (derived count) | `autoRotorPoints`/`teleopRotorPoints` → `rotorCount` ≥4 | D-03 case: verified 100% integer, 25,386 sides, 0 exceptions (measured this session). |
| 2018 | `autoQuest` | Conjunction, one variable untracked (conservative branch, measured 0 FN / small over-fire — deliberate departure from the usual conservative direction) | `autoRunPoints` ≥15 AND `autoSwitchAtZero` (boolean, untracked) → fallback `autoSwitchOwnershipSec` ≥1 | The ONE bonus in this project whose fallback OVER-fires rather than under-fires — must be preserved exactly (see file header's own justification). |
| 2018 | `faceTheBoss` | Single variable ≥ T | `endgamePoints` ≥90 | Fully exact, no fallback needed. |
| 2019 | `habDocking` | Single variable ≥ T | `habClimbPoints` ≥15 | Exact, 0 mismatches. |
| 2019 | `completeRocket` | Always-false / conservative constant (no threshold-variable fallback at all) | none tracked | Deferred (F12) — stays hardcoded `false` in `predictThresholds`; `parse` still computes it exactly from two booleans. |
| 2020 | `shieldOperational` | Single variable ≥ T | `endgamePoints` ≥65 | Exact, 0 mismatches (base tier only — DC/champs tiers are an untested assumption, no 2020 data exists at those tiers). |
| 2022 | `cargoBonus` | Data-dependent threshold mixture | `matchCargoTotal` ≥ (18 if `autoCargoTotal`≥5 else 20) | The quintet gate IS itself a tracked threshold variable (`autoCargoTotal`), so this is a genuinely two-branch mixture over two independent variables, both trackable. |
| 2022 | `hangarBonus` | Single variable ≥ T | `endgamePoints` ≥16 | Exact. |
| 2023 | `activationBonus` | Single variable ≥ T | `totalChargeStationPoints` ≥26 | Exact. |
| 2023 | `sustainabilityBonus` | Linear combination (derived) ≥ T, conjunction w/ one untracked variable (conservative branch) | `linkPoints` → `links` (÷5) ≥ tiered T; coopertition (untracked, both-alliances AND) evaluated at NON-coop stricter table | D-03 case: `links` verified 100% integer, 27,116 sides, 0 exceptions (measured this session). |
| 2024 | `melodyBonus` | Linear combination (already-summed count) ≥ T, conjunction w/ one untracked variable (conservative branch) | `noteCount` (5-term sum, already tracked pre-summed) ≥ tiered T; coopertition untracked, evaluated at non-coop stricter table | `noteCount` is summed inside `parse`/tracked directly — no D-03 issue, already one variable. |
| 2024 | `ensembleBonus` | Conjunction across distinct variables (both tracked) | `endGameTotalStagePoints` ≥10 AND `onStageRobotCount` ≥2 | Fully exact and reachable — no fallback needed. Known ~7% reconciliation residual, not chased (per file header). |
| 2025 | `autoBonus` | Conjunction across distinct variables (both NOW tracked, since 2026-09-09 fix) | `autoLineCount` ≥3 AND `autoCoralCount` ≥1 | Was the worst conservative-branch offender (hardcoded false, Brier 0.6594) until fixed — now fully reachable. |
| 2025 | `coralBonus` | Data-dependent mixture (count-of-k across levels) + conjunction w/ untracked coopertition (conservative branch) | 4 level counts (`trough`/`botRow`/`midRow`/`topRow`), strict = all 4 ≥ T, coop = ≥3 of 4 ≥ T | Explicitly named in ROADMAP.md as the "four levels would need Genz quadrature" case if dependence were ever modelled — deferred (F4) not this phase's concern, but the count-of-k-of-4 structure under the STRICT branch is itself Poisson-binomial-shaped over 4 (not 5) independent indicators. |
| 2025 | `bargeBonus` | Single variable ≥ T | `endGameBargePoints` ≥14/14/16 | Exact for the ≥14 direction; a ~4% always-false-negative residual is an unmodeled alternate path, not chased. |
| 2026 | `energized` | Single variable ≥ T | `hubTotalCount` ≥100/240/360 | Exact, but SHARES its variable with `supercharged` below — see nested-threshold case. |
| 2026 | `supercharged` | Single variable ≥ T, **nested with `energized` on the same variable** | `hubTotalCount` ≥360/360/500 | `SUPERCHARGED_THRESHOLD[tier] >= ENERGIZED_THRESHOLD[tier]` at every tier (verified by reading both constants side by side) → `supercharged` implies `energized` structurally. **This is D-07's named highest-risk case.** |
| 2026 | `traversal` | Single variable ≥ T | `totalTowerPoints` (derived, already-summed `autoTowerPoints + endGameTowerPoints`) ≥50 | Already summed inside `parse`, tracked as one variable — no D-03 issue. |

**Every bonus in every registered season reduces to one of the seven named mechanism classes; none
requires a new class.** The declarative contract (deliverable 1) needs exactly these shapes:
`singleThreshold`, `linearCombination`, `conjunctionDistinct` (with an optional untracked-conservative
branch), `nestedSameVariable`, `countOfIndicators` (Poisson-binomial), `dataDependent Mixture`,
`constant`.

### The nested-threshold interval-probability computation (2026 `energized`/`supercharged`)

```typescript
// Illustrative — not existing code. Given the marginal CDF F(x) for hubTotalCount:
const pEnergized = 1 - F(ENERGIZED_THRESHOLD[tier] - 1);      // P(X >= T_e)
const pSupercharged = 1 - F(SUPERCHARGED_THRESHOLD[tier] - 1); // P(X >= T_s), T_s >= T_e always
// CORRECT joint outcomes for the pair (mutually exclusive, sum to 1):
const pNeither = F(ENERGIZED_THRESHOLD[tier] - 1);             // X < T_e
const pOnlyEnergized = pEnergized - pSupercharged;              // T_e <= X < T_s
const pBoth = pSupercharged;                                    // X >= T_s (supercharged implies energized)
// WRONG (the trap D-07 names): treating them as independent computes
//   pBothWrong = pEnergized * pSupercharged   // < pBoth, understates the true joint
```

### Existing `erf` implementation to copy for D-08 (Abramowitz-Stegun 7.1.26)

```typescript
// Source: packages/core/algorithms/sigma1/linkFunctions.ts:41-49 (existing, verified this session)
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-ax * ax);
  return sign * y;
}
```

### The current independence bug in `simulateRanks` (D-15's fix target)

```typescript
// Source: packages/core/algorithms/simulation/rankSimulation.ts:264-274 (existing, verified this session)
for (const match of resolvedMatches) {
  const redRp = drawCategorical(match.redRpPmf, rng);   // draw 1: independent
  const blueRp = drawCategorical(match.blueRpPmf, rng);  // draw 2: independent
  for (const i of match.redIndices) { rpSum[i]! += redRp; matchesPlayed[i]! += 1; }
  for (const i of match.blueIndices) { rpSum[i]! += blueRp; matchesPlayed[i]! += 1; }
}
```

D-15's fix draws ONE match outcome (which alliance wins/ties, from the coupled win/tie model now
based on `pRedWin`), then bonuses per alliance from each alliance's OWN bonus marginals (still
independent across alliances, since red/blue share no team) — not two fully independent RP-total
draws from each alliance's marginal pmf as today. The precise mechanics of "draw the outcome once" are
a planning-time design choice: either (a) draw from a joint red/blue RP-total pmf built to correlate
only through the shared match outcome, or (b) draw the winner from `pRedWin` first, then draw each
alliance's bonus RP independently and add the (deterministic-given-winner) win/tie RP. Approach (b) is
simpler and directly reuses `analyticRpPmf`'s own win/tie/bonus decomposition — recommended.

### `EventMatchSchema.redRpPmf`'s own schema comment (verbatim — F5's contract, quoted per provenance rule)

```
// Source: packages/harness/pageArtifacts.ts:427-431 (verified this session)
"...1000-draw rank simulation draws from for every match at or after a
chosen start match, which is why it must exist on a PLAYED row and not
only an upcoming one — a rewind start match is the common case (1,312
of 1,353 corpus events have no unplayed qualification match at all)."
redRpPmf: z.array(z.number()).optional(),
```

### `buildEventMatchRow`'s current shape — exactly what F5 says, verified line-for-line

```typescript
// Source: apps/worker/src/scheduled.ts:530-548 (existing, verified this session)
function buildEventMatchRow(match: MatchResult, prediction: Prediction, band: MatchBand | undefined) {
  return {
    matchKey: match.matchKey,
    compLevel: match.compLevel,
    setNumber: match.setNumber,
    matchNumber: match.matchNumber,
    redTeams: [...match.redTeams],
    blueTeams: [...match.blueTeams],
    predictedWinner: prediction.winner,
    pRedWin: roundProbability(prediction.pRedWin),
    predictedRedScore: roundMetric(prediction.redScore),
    predictedBlueScore: roundMetric(prediction.blueScore),
    ...liveBonusRpFields(match.compLevel, prediction),  // per-bonus MARGINALS only
    ...swingBandFields(band),
    actualWinner: match.winner,
    actualRedScore: match.redScore,
    actualBlueScore: match.blueScore,
    // NO redRpPmf / blueRpPmf here — confirmed absent.
  };
}
```

Contrast with `buildEventUpcomingRow` (line 550), which already includes
`redRpPmf: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined` — the asymmetry is real
and precisely this.

## State of the Art

| Old Approach | Current Approach (this phase) | When Changed | Impact |
|--------------|------------------------------|---------------|--------|
| 4,000-draw Monte Carlo joint Gaussian + `ml-matrix` Cholesky (`rpPmfForMatch`) | Exact closed-form `analyticRpPmf`: scalar CDF evaluations, direct convolution | Phase 9 | ±0.008 sampling noise eliminated; ~1000x cheaper per match `[ASSUMED — order-of-magnitude estimate, not independently benchmarked this session; see Assumptions Log]`; unblocks live Worker (D-21) and browser pricing (D-08). |
| Win/tie RP from a separately-drawn Gaussian score pair (Swing Band variance) | Win RP from published `pRedWin`; tie RP from a discrete score-margin model | Phase 9 (D-13/D-14) | Closes F6 (pmf-implied win prob differing from displayed `pRedWin` by up to 0.34) and F7 (tie branch unreachable — 1.09% of quals tie, model predicted 0%). |
| Symmetric Gaussian marginal for every threshold variable | Negative-binomial marginal for count-valued (or, per this session's measurement, effectively every) threshold variable | Phase 9 (D-01, pending D-09's acceptance bar) | Targets F2's 2.06× bonus-probability under-prediction; F3's systematic mean-deficit is a separate, partially-overlapping cause that must be re-measured on fully-warm rosters first per the roadmap's stated sequencing. |
| 20 concrete synthetic schedules, priced and baked offline, 95.4% of a ~265 KB sidecar | Field-averaged analytic per-team pmf, no schedule generation, target ~2-3 KB (rung 1, unproven) | Phase 9 (D-16/D-17), gated by measurement | Deletes schedule-template dependency for the common case; licence question (D-19) evaporates if rung 1 holds. |
| Live Worker never computes RP; played rows structurally cannot carry it | Worker-resident RP accumulator (D1-seeded), `redRpPmf`/`blueRpPmf` on played rows | Phase 9 (D-21) | Closes F5; enabled specifically by the analytic form's cheapness fitting inside the 10ms CPU budget. |

**Deprecated/outdated:**
- `RP_MONTE_CARLO` config (`sigmaScoutLayer.ts:64`, `{rpMonteCarloSeed, rpMonteCarloDraws}`) — replaced
  by D-05's named `RpLayerConfig`.
- `CHOLESKY_RIDGES`, `clampCrossCovariance`, `CROSS_COVARIANCE_SAFETY_FACTOR`, `buildJointModel`,
  module-local `mulberry32`/`boxMullerPair`/`fnv1a32` in `distribution.ts` — all deleted per the
  roadmap's deliverable 2 (the numerical-stability machinery they exist for — Cholesky on a possibly
  ill-conditioned matrix — has no analogue in the closed-form path, since there is no matrix at all).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The analytic form is "~1000x cheaper" per match than the 4,000-draw Monte Carlo | State of the Art | This specific multiplier is not independently benchmarked this session — it is a reasonable order-of-magnitude inference (O(1) CDF evaluations vs. O(4000) Cholesky-seeded draws with a `predictThresholds` call each), not a measured number. If the real speedup is smaller, the Worker CPU-budget argument for deliverable 6 still likely holds (any linear function of a handful of CDF evaluations is trivially inside 10ms) but the plan should not cite "1000x" as a verified figure without measuring it. |
| A2 | Applying negative-binomial marginals to ALL threshold variables (not just literally "count"-unit ones, but also "points"-unit ones like `endgamePoints`, `habClimbPoints`) is the right default, since every one measured this session is integer-valued and overdispersed | Standard Stack / Summary | D-01/D-02 leave the family declaration per-variable and don't literally say "points" variables get NB too — this session's measurement supports extending NB broadly, but the CONTEXT.md text technically only locks the "count-valued" case. If the planner/executor instead defaults "points" variables to a different family (e.g., continuity-corrected normal) without re-reading this evidence, some marginals will be needlessly worse-calibrated. |
| A3 | Approach (b) for D-15 (draw winner from `pRedWin`, then independent per-alliance bonus draws) is the right implementation of "draw the outcome once" | Code Examples | CONTEXT.md's D-15 specifies the WHAT (draw once) but not the HOW; approach (a) (a genuinely joint red/blue RP-total pmf) is also valid and was not ruled out. The plan should pick one explicitly rather than leave it ambiguous, since they produce different (though both defensible) correlation structures. |
| A4 | Rung 1's exact comparison statistic ("rank bands match the current baked output on real events") should be a per-team band-overlap or band-distance metric across a sample of finished events | Open Questions | CONTEXT.md deliberately leaves this open ("Research must decide... what counts as a match" is asked of research per the task's own emphasis list, not answered in CONTEXT.md). See Open Questions for the concrete recommendation and its own caveats. |
| A5 | Method-of-moments is the right (and sufficient) NB parameter estimator, vs. e.g. MLE | Don't Hand-Roll | D-01 says "fitted from the existing alliance mean and variance by method of moments" explicitly — this is actually a LOCKED decision (D-01), not an assumption, but recorded here because the exact estimator formula (`r`, `p` from mean/variance) is this researcher's algebra, cross-checked against one external source (real-statistics.com), not independently re-derived from first principles or checked against a second source. |

## Open Questions

1. **What exact statistic proves rung 1 "matches the current baked output"?**
   - What we know: CONTEXT.md's D-17 states the pass condition in prose ("rank bands match the
     current baked output on real events") but not a number. The existing baked output is a
     `histograms: number[][]` per team (`PreScheduleArtifactSchema`), already comparable via the same
     `continuousQuantile`/median/p10/p90 machinery the sketch findings settled on for the live
     rank-band display (`references/simulation-and-compare.md`, read this session).
   - What's unclear: whether "match" means (a) each team's median rank within some tolerance (e.g.,
     ±0.5 ranks), (b) each team's 10th–90th band overlapping substantially, or (c) a pooled
     distributional distance (e.g., Wasserstein/EMD) summed across the roster. These give different
     pass/fail verdicts on borderline events.
   - Recommendation: use the SAME `continuousQuantile` p10/median/p90 statistics already computed for
     the live rank-band display, compare per-team on a sample of real finished events (a handful across
     different roster sizes — 6-team to 100-team, since template coverage spans that range), and set a
     tolerance in rank units (not probability units) consistent with the sketch findings' existing
     "one decimal place, 10th–90th" display convention. This keeps the acceptance metric in the same
     units a human would actually see on the page, rather than an abstract distributional distance no
     one will eyeball.

2. **Does the field-averaged predictor need to model cross-team correlation for teams sharing a
   roster (not just sharing a match)?**
   - What we know: D-16 explicitly accepts washing out "coupling from teams sharing specific matches,"
     matching what the 20-schedule approach already does by design (per CONTEXT.md's own honest
     caveat).
   - What's unclear: whether the field-level "partner-quality spread" statistic (mean/variance of
     per-team contributions across the roster) needs to be recomputed per-event (a genuinely different
     roster each time) or can reuse a season-level statistic. A per-event roster is usually 20-100
     teams (per `scheduleTemplates.ts`'s own 6-100 coverage range), which the offline publish pipeline
     already iterates per event — recomputing per-event is cheap and avoids a stale season-wide
     average degrading accuracy for an unusually strong/weak field. Recommend per-event.

3. **Where does `analyticRpPmf`'s win/tie decomposition intersect with `sigmaScore.ts`'s Sigma Score
   band, given BPR's live-tier status?**
   - What we know: `#rpFieldsFor` in `sigmaScoutLayer.ts` currently feeds `redBandVariance`/
     `blueBandVariance` (Swing or Sigma Score, algorithm-dependent) into the RP draw as the score
     variance. D-13 replaces the WIN half with `pRedWin` directly, bypassing the band variance for that
     purpose entirely.
   - What's unclear: whether the band variance is still needed for anything in the new analytic form
     (e.g., as an input to the discrete tie-margin model, D-14), or becomes entirely vestigial to the
     RP layer. If vestigial, `#rpFieldsFor`'s signature and the whole
     `redBandVariance`/`blueBandVariance` undefined-gate (which currently causes F8's cold-start
     match-dropping) may simplify or shift shape — worth flagging to the planner since it interacts
     with F8/F9's deferred cold-start work even though that work itself stays out of scope.

## Environment Availability

No external tool/service dependency changes in this phase (no new package, no new Cloudflare product).
The one relevant environment fact is that `data/corpus.sqlite` (gitignored, `better-sqlite3`-backed)
is present and queryable locally — confirmed this session, used for the integrality/dispersion
measurements above. Every deliverable in this phase can be developed and tested against this local
corpus without any live network dependency (TBA API, R2, D1) until the D-21 Worker deployment and
D-20 republish steps, which require the project's existing Cloudflare credentials (already documented
in CLAUDE.md's secrets-handling convention).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (project-standard, `[CITED: CLAUDE.md Technology Stack]`) |
| Config file | existing root/package-level Vitest config (unchanged by this phase) |
| Quick run command | `npx vitest run packages/core/rankingPoints` (per-package scope; **note the project's own recorded pitfall** — root `vitest` from `apps/web` undercounts files, always run from repo root, see `project_test_scope_trap` memory) |
| Full suite command | `npx vitest run` from repo root |

### Phase Requirements → Test Map

| Deliverable | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| 1 (declarative contract) | Each of the 7 mechanism classes evaluates correctly, incl. the 2026 nested-threshold case | unit, hand-computed expected values (D-07 mandatory mitigation) | `npx vitest run packages/core/rankingPoints/marginals.test.ts` | ❌ Wave 0 — new file |
| 1 (declarative contract) | `predictThresholds`'s conservative-branch behavior is BYTE-IDENTICAL to today (Pitfall 4) | regression, reuses existing measurement | `npx tsx packages/harness/rpConservativeBranch.ts` (existing script — assert its output table is unchanged) | ✅ exists (`packages/harness/rpConservativeBranch.ts`) |
| 2 (`analyticRpPmf`) | Pmf sums to 1, matches `predictThresholds`'s deterministic-limit behavior (all-variance-zero case reproduces `parse`'s own boolean flags) | unit | `npx vitest run packages/core/rankingPoints/analyticPmf.test.ts` | ❌ Wave 0 — new file |
| 2 (`analyticRpPmf`) | Existing `RpRuleModule`/`rules.test.ts`/`reconciliation.test.ts` suites still pass unchanged (D-07's "unit tests carry the burden") | regression | `npx vitest run packages/core/rankingPoints` | ✅ exist, unaffected by internal-only rewrite |
| 3 (win RP from `pRedWin`) | The pmf-implied win probability now equals the published `pRedWin` exactly (closes F6's measured 0.12 p90 gap) | integration, reuses the audit's own measurement method | new script mirroring `ranking-points-audit.md`'s F6 probe, or extend `measureRpCalibration.ts` | ❌ Wave 0 — measurement script |
| 3 (tie RP) | Tie branch is reachable; predicted tie rate is non-zero and in the neighborhood of the measured 1.09% base rate | unit + corpus measurement | new test in `analyticPmf.test.ts` + a corpus-driven assertion | ❌ Wave 0 |
| 4 (marginal swap) | Per-bonus Brier improves for a majority of bonuses on 2023-2026, none regress (D-09's exact bar) | integration, same-scorer requirement (D-11) | `npx tsx scripts/measureRpCalibration.ts --seasons 2023-2026 --algorithm bpr`, compared before/after | ✅ script exists; needs a before/after harness wrapper — Wave 0 gap is the COMPARISON tooling, not the scorer itself |
| 5 (RP scorecard) | `v1/compare/{year}.json` (or a new sibling artifact) carries RP calibration data the Compare page renders | integration + component | new schema test + `apps/web` component test | ❌ Wave 0 — schema extension, new component |
| 6 (live Worker RP) | Live/offline row-shape parity: a played row from `buildEventMatchRow` and the equivalent offline row carry the same `redRpPmf`/`blueRpPmf` shape (D-21's explicit requirement) | integration | new test alongside existing `apps/worker/test/scheduled.replay.test.ts` | ❌ Wave 0 — the parity test D-21 explicitly calls for doesn't exist yet |
| 6 (live Worker RP) | State-shape 12 round-trips correctly (`serializeState`/`deserializeState`, new `withRpBeliefs`/`readRpBeliefs` pair) | unit | extend `packages/harness/stateSnapshot.test.ts` | ✅ file exists, needs new cases |
| 7 (rank sim coupling) | Red and blue alliances can no longer both "win" the same draw; existing `rankSimulation.test.ts` suite still passes | unit + regression | `npx vitest run packages/core/algorithms/simulation` | ✅ exists |
| 8 (rung 1) | Field-averaged pmf's rank bands match baked output within the tolerance from Open Question 1 | integration, measurement against real events | new script, mirrors `scripts/measureRewindGap.ts`'s pattern (offline consumer of `simulateRanks`) | ❌ Wave 0 — new measurement script |
| D-12 (level-1 byte-identical) | `pRedWin`/`redScore`/`blueScore` unchanged before/after the whole phase, corpus slice | regression, exact equality | new before/after digest test, following `digest.test.ts`'s existing bounded-slice pattern (plan 03-01) | ✅ pattern exists (`digest.test.ts`), needs a phase-9-specific before/after harness |

### Sampling Rate

- **Per task commit:** the relevant package's quick Vitest run (e.g.
  `npx vitest run packages/core/rankingPoints` while working inside that package).
- **Per wave merge:** full suite (`npx vitest run` from repo root — never from `apps/web`, per the
  project's own recorded test-scope pitfall).
- **Phase gate:** full suite green, PLUS the D-12 byte-identical corpus-slice check, PLUS
  `scripts/measureRpCalibration.ts`'s before/after comparison showing D-09's acceptance bar is either
  cleared (marginal/tie/win changes ship) or explicitly reverted per bonus (D-10's unconditional-ship
  rule) before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `packages/core/rankingPoints/marginals.test.ts` — NB fit/CDF, Poisson-binomial convolution,
      erf, covers the 7 mechanism classes with hand-computed expectations (D-07)
- [ ] `packages/core/rankingPoints/analyticPmf.test.ts` — replaces `distribution.test.ts`'s scope
- [ ] A before/after comparison harness for D-09's per-bonus acceptance bar (wraps
      `measureRpCalibration.ts`, doesn't replace it)
- [ ] A live/offline row-shape parity test for D-21 (explicitly named as a deliverable-6 requirement,
      does not exist today)
- [ ] A D-12 byte-identical level-1 regression test (before/after digest over a corpus slice)
- [ ] A rung-1 measurement script comparing field-averaged pmf rank bands to baked output on real
      events (Open Question 1's tolerance needs to be encoded here once chosen)
- [ ] Compare-page schema + component tests for the RP scorecard (deliverable 5)

## Sources

### Primary (HIGH confidence — read directly this session)

- `packages/core/rankingPoints/{constants,distribution,empiricalMoments,moments,rules,2016..2026}.ts`
  — full read, all 10 season modules, the joint-draw Monte Carlo, the moments contract.
- `packages/harness/{sigmaScoutLayer,rpConservativeBranch,stateSnapshot,preSchedule,scheduleTemplates}.ts`
  — full read.
- `packages/core/algorithms/simulation/rankSimulation.ts` — full read, confirmed the red/blue
  independent-draw bug D-15 targets.
- `apps/worker/src/scheduled.ts` (relevant sections) — confirmed `buildEventMatchRow`'s omission and
  `buildEventUpcomingRow`'s inclusion of `redRpPmf`/`blueRpPmf`.
- `packages/harness/pageArtifacts.ts` (relevant sections) — confirmed `CompareArtifactSchema` has no
  RP key, and quoted `EventMatchSchema.redRpPmf`'s own comment verbatim.
- `scripts/measureRpCalibration.ts` — full read.
- `packages/core/algorithms/sigma1/linkFunctions.ts` — full read, `erf`/`normalCdf` precedent.
- `.planning/todos/pending/ranking-points-audit.md`, `docs/simulation-architecture.md` — full read
  (both required canonical refs).
- `.planning/phases/09-analytic-ranking-points-browser-side-simulation/{09-CONTEXT,09-DISCUSSION-LOG}.md`
  — full read.
- `.claude/skills/sketch-findings-sigmascout/references/simulation-and-compare.md` — full read
  (required canonical ref for deliverable 5/8 display).
- `.planning/config.json` — confirmed `nyquist_validation: true`, `security_enforcement: false`.
- Live corpus measurements, this session, via throwaway gitignored `experiments/` probes against
  `data/corpus.sqlite` (deleted after use, matching the audit's own convention):
  - D-03 integrality: 2017 `rotorCount` (n=25,386, 0 non-integral), 2016 `towerRobotCount` (n=22,158,
    0 non-integral), 2023 `links` (n=27,116, 0 non-integral).
  - Broader integrality + dispersion: 15 threshold variables across 2018/2019/2020/2022/2023/2024/2025/2026,
    all 100% integer-valued, variance/mean ratios 1.27–102.3.

### Secondary (MEDIUM confidence — WebSearch, cross-checked against multiple independent sources)

- Negative-binomial method-of-moments parameterization: `[CITED: real-statistics.com/distribution-fitting/method-of-moments/method-of-moments-negative-binomial-distribution/]`,
  cross-checked against `[CITED: johndcook.com/negative_binomial.pdf]` and Stan's function reference
  `[CITED: mc-stan.org/docs/2_20/functions-reference/nbalt.html]` — all three agree on the mean/variance
  relationship `variance = mean/p`-shaped forms; this research's stated formula (`r = mean^2/(variance-mean)`,
  `p = mean/(mean+r)`) matches the real-statistics.com derivation directly.
- Poisson-binomial distribution-function computation: `[CITED: sciencedirect.com/science/article/abs/pii/S0167947318300082]`
  (DFT-CF algorithm, Hong 2013) and `[CITED: cran.r-project.org/web/packages/PoissonBinomial/vignettes/intro.html]`
  — both confirm direct convolution is exact and that DFT-CF is the recommended approach only at large
  n (thousands); this phase's largest count-of-k case (2016 `breach`, n=5) is far below that threshold,
  so this research recommends direct polynomial convolution (multiply out n two-point factors), not
  DFT-CF, as simpler and equally exact at this scale.

### Tertiary (LOW confidence / training-knowledge only)

- The "~1000x cheaper" performance claim (State of the Art table) — an order-of-magnitude inference
  from operation counts, not benchmarked this session. Tagged `[ASSUMED]`, listed in Assumptions Log
  as A1.

## Metadata

**Confidence breakdown:**
- Standard stack / package legitimacy: HIGH — no new packages, verified `ml-matrix`/`zod` versions
  directly from `package.json`.
- Bonus-mechanism taxonomy (Code Examples table): HIGH — every season module read in full this
  session, every mechanism classification traced to a specific quoted threshold comparison.
- Architecture (D1 passenger pattern, subrequest-cost claim): HIGH — read `stateSnapshot.ts`'s full
  Swing/Sigma passenger implementation and `subrequestBudget.ts`'s constants directly.
- Marginal-family recommendation (negative binomial): HIGH for the "every measured variable is
  integer and overdispersed" empirical claim (measured this session against the live corpus); MEDIUM
  for the specific method-of-moments formula (cross-checked against 3 independent web sources, not
  independently re-derived from the NB pmf).
- Poisson-binomial convolution approach: MEDIUM — WebSearch-cross-checked recommendation, not
  benchmarked against this project's actual `breach` data this session.
- Pre-schedule ladder rung-1 measurement statistic: LOW/proposed — CONTEXT.md leaves this open by
  design; this research's recommendation (Open Question 1) is a reasoned proposal, not a verified fact.
- Performance multiplier ("~1000x cheaper"): LOW/ASSUMED — explicitly flagged, not benchmarked.

**Research date:** 2026-09-11
**Valid until:** 30 days (stable domain — no fast-moving external dependency; the corpus-derived
measurements are valid as long as the corpus itself is unchanged, which it will not be after this
phase's own republish work).
