---
phase: 03-tuning-ranking-points-versioning
plan: 03
subsystem: algorithms
tags: [sigma1, kalman, monte-carlo, cholesky, ml-matrix, zod, ranking-points, versioning]

# Dependency graph
requires:
  - phase: 03-tuning-ranking-points-versioning
    provides: "03-01's Sigma1Params surface (rpMonteCarloSeed/rpMonteCarloDraws) and makeSigma1's params threading; 03-02's rp/ leaf (RpRuleModule, RP_RULE_MODULES, per-season parse()) and reconciliation.test.ts's invariant"
provides:
  - "eventType: number on UpcomingMatch, sourced from the corpus's events.event_type column, so predict() can see a match's event tier without a second lookup"
  - "rp/state.ts: D-09's parallel per-team threshold-variable Kalman state (Sigma1TeamState.rpBeliefs/rpCovariance/rpCrossCovariance, Sigma1League.rpVariableMean), kept structurally separate from the score-component vector"
  - "rp/distribution.ts: D-10/D-11/D-16's seeded correlated joint Monte Carlo pmf (rpPmfForMatch) via ml-matrix's CholeskyDecomposition, plus mulberry32/boxMullerPair/fnv1a32/pmfMean/pmfStandardDeviation"
  - "sigma1/index.ts's predict()/update()/carrySeason() wired: every qualification match's Prediction carries redRpPmf/blueRpPmf; the score-side computation is provably unchanged"
  - "RpRuleModule.predictThresholds (rp/constants.ts + all 5 season modules) -- evaluates bonus achievement from Monte-Carlo-drawn threshold-variable values alone, a capability parse() cannot provide"
  - "predictions.ts schema v2 (redRpPmf/blueRpPmf, refined to sum to 1) and artifact.ts schema v3 (AlgorithmDescriptorSchema.codeVersion/paramSetName, D-13) -- both proven end to end against a real corpus run"
affects: [03-04-adaptation, 03-05-sensitivity-screen-joint-search, 03-06-final-integration, phase-4-worker-publishing]

actuals:
  tokens: 34512
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Parallel state vector kept structurally separate via TypeScript interface extension (Sigma1TeamState extends RpTeamState) rather than nesting, so the separation is a compile-time-checkable fact, not a naming convention"
    - "Cross-covariance between two DIFFERENT residual vectors (score components vs threshold variables) needs its own asymmetric EWMA fold -- covariance.ts's ewmaCovariance assumes one residual vector for both matrix dimensions and cannot be reused as-is"
    - "Reusing a season rule module's parse() logic for a Monte-Carlo-drawn scenario requires a SECOND entry point (predictThresholds) that takes already-decomposed values rather than raw JSON -- parse()'s Zod schema requires fields a draw never produces"
    - "A conservative-gate convention (evaluate an untracked alliance-level condition at its less-likely-to-achieve branch) as the honest alternative to guessing when a rule genuinely cannot be evaluated from tracked state alone"

key-files:
  created:
    - packages/core/algorithms/sigma1/rp/state.ts
    - packages/core/algorithms/sigma1/rp/state.test.ts
    - packages/core/algorithms/sigma1/rp/distribution.ts
    - packages/core/algorithms/sigma1/rp/distribution.test.ts
  modified:
    - packages/core/algorithms/types.ts
    - packages/corpus/db.ts
    - packages/corpus/db.test.ts
    - packages/core/algorithms/sigma1/index.ts
    - packages/core/algorithms/sigma1/rp/constants.ts
    - packages/core/algorithms/sigma1/rp/2022.ts
    - packages/core/algorithms/sigma1/rp/2023.ts
    - packages/core/algorithms/sigma1/rp/2024.ts
    - packages/core/algorithms/sigma1/rp/2025.ts
    - packages/core/algorithms/sigma1/rp/2026.ts
    - packages/core/algorithms/opr.ts
    - packages/core/algorithms/epa.ts
    - packages/harness/predictions.ts
    - packages/harness/artifact.ts
    - packages/harness/cli.ts
    - packages/harness/replay.test.ts

key-decisions:
  - "eventType widened onto UpcomingMatch (not gated behind MatchResult) and deliberately NOT added to replay.ts's OUTCOME_KEYS -- it is knowable before a match is played, the same category as compLevel/matchNumber"
  - "rpSkippedMatchCount added as a new Sigma1State top-level field (not per-team) -- the missing-breakdown skip is a whole-match event, mirroring how usedFallback gates both alliances together on the score side"
  - "predictAllianceRpMoments's score mean/variance are PASSED IN (the per-alliance posterior+covariance sums predict() already computes as intermediates before combining them into the single win-probability variance), never recomputed -- the combined Prediction.variance field is the WRONG value for this (it sums both alliances)"
  - "A degenerate alliance (no rating-eligible teams) is NOT special-cased in distribution.ts -- predictAllianceRpMoments naturally returns all-zero moments for it, and the Cholesky ridge-retry mechanism already produces a valid, near-deterministic (never NaN) pmf from that input, proven by a dedicated test rather than assumed"
  - "opr.ts and epa.ts's version strings changed to '2.0.0+baseline'/'1.0.0+baseline' (Rule 1 fix) -- buildArtifact's new strict D-13 shape check would otherwise throw on every real non-Sigma1 harness run"
  - "ALGO-08 marked complete in REQUIREMENTS.md by this plan (not deferred to 03-06, whose actual scope is CI reproducibility/holdout head-to-head/SC-3, unrelated to RP) -- this plan is the literal predict()-wiring 03-01's and 03-02's SUMMARYs both named as '03-03's job'"

patterns-established:
  - "RpFoldableTeamState / RpLeague as minimal structural interfaces in rp/state.ts, satisfied by Sigma1TeamState/Sigma1League via TypeScript structural typing without rp/state.ts importing sigma1/index.ts -- the acyclic-import discipline plan 03-01 already established for params.ts, applied to a second leaf module"
  - "A private, duplicated Kalman-gain helper (rpTeammateGains) rather than exporting sigma1/index.ts's private componentGains -- documented at the duplication site as a deliberate acyclic-import choice, not an oversight"

requirements-completed: [ALGO-08]

coverage:
  - id: D1
    description: "Every match handed to predict() carries its event's TBA event_type, sourced from the corpus, without weakening the outcome-leakage guarantee (OUTCOME_KEYS unchanged)"
    requirement: ALGO-08
    verification:
      - kind: unit
        ref: "packages/corpus/db.test.ts#selectMatchesChronological — eventType round trip (plan 03-03 Task 1)"
        status: pass
      - kind: unit
        ref: "packages/harness/replay.test.ts#eventType — non-outcome-bearing (plan 03-03 Task 1)"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-09's parallel threshold-variable Kalman state (rp/state.ts) folds observations, cold-starts from league priors, and provably never affects the score-side teamTotalVariance"
    requirement: ALGO-08
    verification:
      - kind: unit
        ref: "packages/core/algorithms/sigma1/rp/state.test.ts (10 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "D-10/D-11/D-16's seeded correlated joint Monte Carlo pmf: non-qm matches return [1], a qm match's pmf sums to 1 within 1e-9, is deterministic per match key regardless of surrounding stream order, the correlated draw measurably raises P(maxRp) for a dominant alliance vs an independence-forced control, and 0 draws leaves pRedWin/redScore/blueScore identical to 2000 draws"
    requirement: ALGO-08
    verification:
      - kind: unit
        ref: "packages/core/algorithms/sigma1/rp/distribution.test.ts (20 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "RP pmfs persist through predictions.ts schema v2 (redRpPmf/blueRpPmf, validated non-empty and summing to 1) and artifact.ts schema v3 (codeVersion/paramSetName), proven against a real corpus run"
    requirement: ALGO-08
    verification:
      - kind: unit
        ref: "packages/harness/predictions.test.ts, packages/harness/artifact.test.ts"
        status: pass
      - kind: integration
        ref: "pnpm harness --season 2024 --algorithm sigma1 --out reports/rp-smoke (real run: first predictions-2024.jsonl line's redRpPmf/blueRpPmf both sum to 1; artifact.json's algorithms[] carries codeVersion/paramSetName)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Plan 03-01's promoted tracer version continues to reproduce bitwise (digest.test.ts) -- the RP wiring cannot have silently changed the prediction stream the digest hashes"
    requirement: ALGO-08
    verification:
      - kind: unit
        ref: "packages/harness/digest.test.ts#promoted algorithm version reproducibility (D-15/SC-5)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Every season's real bonus-achievement condition that depends on an untracked alliance-level gate (2023 sustainabilityBonus, 2024 melodyBonus, 2025 coralBonus/autoBonus) is evaluated at its conservative branch -- a modeling simplification, honestly measured and documented, not a silently wrong number"
    verification: []
    human_judgment: true
    rationale: "This is a genuine, human-reviewable modeling gap in D-09's per-season RpThresholdVariable design (discovered this session, not anticipated by plan 03-02): those bonuses' predicted probability is systematically UNDERSTATED. Automated tests prove the conservative branch is applied consistently and never throws/NaNs, but whether this simplification is acceptable for SC-4's 'verified against the manual' claim, or warrants a follow-up plan extending RpThresholdVariable to track gating flags, is a product/roadmap judgment call."

duration: 115min
completed: 2026-08-15
status: complete
---

# Phase 3 Plan 3: RP Prediction Wiring — Threshold State, Correlated Joint Pmf, Persistence Summary

**Every FRC qualification match now carries a full discrete ranking-point pmf for both alliances, drawn from one seeded, correlated Cholesky-decomposed Gaussian over score and threshold-variable state (D-09/D-10/D-11/D-16), persisted through predictions/artifact schema v2/v3 and proven against a real corpus run — with the score-side prediction path provably unchanged**

## Performance

- **Duration:** ~115 min
- **Started:** 2026-08-15T04:37:43Z
- **Completed:** 2026-08-15T06:57:00Z
- **Tasks:** 3
- **Files modified:** 32 (across all 3 task commits)

## Accomplishments

- `UpcomingMatch.eventType` (required, non-optional) is now sourced from the corpus's `events.event_type` column through `selectMatchesChronological`, letting `predict()` see a match's tier without a second lookup — deliberately NOT added to `replay.ts`'s outcome-leakage guard, proven readable via a dedicated leak-proof-but-readable test.
- `rp/state.ts` implements D-09's parallel per-team threshold-variable Kalman state — `Sigma1TeamState` now carries `rpBeliefs`/`rpCovariance`/`rpCrossCovariance` alongside (never inside) its score-component fields, and `rpCrossCovariance` is the mechanism that makes D-11's win/bonus correlation fall out of real fold data rather than being asserted. A dedicated test proves `teamTotalVariance` is byte-identical with and without folded RP data — D-09's separation is provable, not just claimed.
- `rp/distribution.ts` implements D-10/D-11/D-16's joint Monte Carlo draw: one seeded (`mulberry32` + `fnv1a32(matchKey)`) Cholesky-decomposed (`ml-matrix`'s `CholeskyDecomposition`, with a documented ridge retry) draw over `[redScore, blueScore, redThresholdVars, blueThresholdVars]` produces both alliances' full discrete RP pmf. A dedicated measured test shows the correlated draw gives a strictly higher `P(RP=maxRp)` for a dominant alliance than an independence-forced control with the cross-covariance zeroed.
- `sigma1/index.ts`'s `predict()`/`update()`/`carrySeason()` wire everything together: every qualification match's `Prediction` carries `redRpPmf`/`blueRpPmf`; the score-side computation (`redScore`/`blueScore`/`variance`/`pRedWin`) is provably unchanged, verified by a dedicated 0-draws-vs-2000-draws equality test (also what lets plan 03-05's hyperparameter search disable RP draws for speed without biasing the search objective).
- `predictions.ts` (schema v2) and `artifact.ts` (schema v3) persist RP pmfs and D-13's version identity respectively — proven not just by unit tests but by a real `pnpm harness --season 2024 --algorithm sigma1` run whose first prediction line's pmfs both sum to 1 and whose artifact carries `codeVersion`/`paramSetName`.
- Plan 03-01's promoted tracer version (`digest.test.ts`) continues to reproduce bitwise — the RP wiring is provably invisible to the digest, which hashes only `matchKey`/`pRedWin`/`redScore`/`blueScore`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Widen UpcomingMatch with eventType so the prediction path can see the event tier** - `58f064fb` (feat)
2. **Task 2: Threshold-variable state and the correlated joint RP pmf** - `1f987c19` (feat)
3. **Task 3: Persist RP predictions and carry D-13's version identity into the artifact schema** - `15116234` (feat)

**Plan metadata:** commit pending (this SUMMARY + STATE.md/ROADMAP.md/REQUIREMENTS.md update)

## Files Created/Modified

- `packages/core/algorithms/types.ts` - `UpcomingMatch.eventType` (required); `Prediction.redRpPmf`/`.blueRpPmf` (optional, D-10)
- `packages/corpus/db.ts` - `selectMatchesChronological` SELECTs and maps `e.event_type` -> `eventType`
- `packages/core/algorithms/sigma1/rp/state.ts` - `RpTeamState`/`RpFoldableTeamState`/`RpLeague`/`AllianceRpMoments`, `emptyRpTeamState`, `foldRpObservation`, `predictAllianceRpMoments`
- `packages/core/algorithms/sigma1/rp/distribution.ts` - `rpPmfForMatch`, `pmfMean`, `pmfStandardDeviation`, `mulberry32`, `boxMullerPair`, `fnv1a32`
- `packages/core/algorithms/sigma1/rp/constants.ts` - new `RpRuleModule.predictThresholds` method + `RpThresholdPrediction` type
- `packages/core/algorithms/sigma1/rp/2022.ts`..`2026.ts` - each implements `predictThresholds`, evaluating bonuses from tracked threshold-variable values alone
- `packages/core/algorithms/sigma1/index.ts` - `Sigma1TeamState extends RpTeamState`, `Sigma1League extends RpLeague`, `Sigma1State.rpSkippedMatchCount`; `applyAllianceUpdate` now returns `residualsByTeam` and threads an `rpVariableCount` parameter; `predict()`/`update()`/`carrySeason()` wire the RP fold and pmf
- `packages/core/algorithms/opr.ts` / `epa.ts` - `version` strings adopt D-13's `{codeVersion}+{paramSetName}` shape (Rule 1 fix, see Deviations)
- `packages/harness/predictions.ts` - `PREDICTIONS_SCHEMA_VERSION` 2; `PredictionRecordSchema` gains `redRpPmf`/`blueRpPmf` with a sum-to-1 refinement
- `packages/harness/artifact.ts` - `ARTIFACT_SCHEMA_VERSION` 3; `AlgorithmDescriptorSchema.codeVersion`/`.paramSetName`; `buildArtifact` splits a module's `version` on the first `+`, throwing if absent
- `packages/harness/cli.ts` - threads `prediction.redRpPmf`/`blueRpPmf` into `writePredictionLine`'s record
- Every test file listed in the plan's `files_modified` (`epa.test.ts`, `opr.test.ts`, `sigma1.test.ts`, `params.test.ts`, `carryover.test.ts`, `breakdown.test.ts`, `db.test.ts`, `metricHistory.test.ts`, `replay*.test.ts`, `predictions.test.ts`, `artifact.test.ts`, `report.test.ts`) - mechanical `eventType`/RP-schema-field additions to fixtures, no assertion changes

## Decisions Made

See `key-decisions` in frontmatter. The most consequential: `predictAllianceRpMoments`'s score mean/variance parameters are the PER-ALLIANCE posterior+covariance sums `predict()` already computes as intermediates, never the combined `Prediction.variance` field (which sums both alliances for the win-probability denominator) — using the wrong one would have silently corrupted the joint model's score dimension.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] `RpRuleModule` had no way to evaluate bonus achievement from Monte-Carlo-drawn values**
- **Found during:** Task 2, while designing `rpPmfForMatch`'s tally step
- **Issue:** The plan's action text says the pmf tally must "apply the season rule module's threshold predicates at the match's tier to the drawn threshold variables." But `RpRuleModule.parse()` (03-02's only entry point) requires a full raw `score_breakdown` JSON object satisfying that season's Zod schema — including fields (TBA's own recorded bonus-achievement booleans, per-season diagnostic thresholds) that a Monte Carlo draw of tracked threshold variables never produces. There was no way to evaluate "does this drawn count clear the threshold" without either synthesizing a fake raw-JSON object (fragile, season-coupled, defeats the season-agnostic dispatch discipline) or adding a real second entry point.
- **Fix:** Extended `RpRuleModule` (`rp/constants.ts`) with a new required method, `predictThresholds(values, eventType)`, implemented in all five season modules, reusing each season's own already-defined `RpTieredThreshold` constants.
- **Files modified:** `packages/core/algorithms/sigma1/rp/constants.ts`, `2022.ts`, `2023.ts`, `2024.ts`, `2025.ts`, `2026.ts`
- **Verification:** `packages/core/algorithms/sigma1/rp/rules.test.ts` gained 7 new tests exercising `predictThresholds` per season; full existing `rules.test.ts`/`reconciliation.test.ts` suites (03-02's, untouched logic) still pass unmodified.
- **Committed in:** `1f987c19` (Task 2 commit)

**2. [Rule 2 - Missing critical functionality, honestly measured] Several real bonus conditions depend on alliance-level gates D-09's tracked variables never captured**
- **Found during:** Task 2, implementing `predictThresholds` per season
- **Issue:** 2023's `sustainabilityBonus`, 2024's `melodyBonus`, and 2025's `coralBonus`/`autoBonus` all gate on alliance-level booleans (`coopertitionCriteriaMet`/`coopertitionBonusAchieved`, per-robot auto-leave flags) that are NOT among the `RpThresholdVariable`s 03-02 chose to track for those seasons — there is no Kalman-estimated signal for them to read.
- **Fix:** `predictThresholds` evaluates each such bonus at its conservative (LESS likely to achieve) branch — the stricter non-coop threshold table, or (for 2025's `autoBonus`, which has NO threshold-variable-only fallback at all) always `false`. This is a genuine, documented modeling simplification: those bonuses' predicted probability is systematically UNDERSTATED, never overstated. Not chased by inventing new tracked state in this plan — that is exactly the scope a follow-up plan extending `RpThresholdVariable` should own.
- **Files modified:** `packages/core/algorithms/sigma1/rp/constants.ts` (documented once, cited by every affected module), `2023.ts`, `2024.ts`, `2025.ts`
- **Verification:** `rules.test.ts`'s new tests assert the conservative branch is applied consistently (e.g. 2023's `sustainabilityBonus` test hand-picks a value that clears the coop threshold but not the non-coop one, asserting `false`).
- **Committed in:** `1f987c19` (Task 2 commit)
- **Not auto-resolved further:** flagged here and in `coverage.D6` for human review, matching plan 03-02's established honesty precedent (its own `KNOWN_TOLERANCES` gaps) rather than hidden or silently accepted as fully solved.

**3. [Rule 1 - Blocking bug] `buildArtifact`'s new strict D-13 shape check would throw on every real OPR/EPA harness run**
- **Found during:** Task 3, while running the full test suite after adding `AlgorithmDescriptorSchema.codeVersion`/`.paramSetName`
- **Issue:** `opr.ts`'s and `epa.ts`'s `version` fields (`"2.0.0"`, `"1.0.0"`) never adopted D-13's `{codeVersion}+{paramSetName}` shape — only Sigma1 (plan 03-01) had. `buildArtifact`'s new `splitAlgorithmVersion` throws for any version string with no `+`, which would have broken `pnpm harness --algorithm opr` (or `epa`) for every real invocation, not just a hypothetical one.
- **Fix:** Changed both to `"2.0.0+baseline"`/`"1.0.0+baseline"` — the honest single named parameter set for an algorithm D-04 explicitly freezes (never separately tuned).
- **Files modified:** `packages/core/algorithms/opr.ts`, `packages/core/algorithms/epa.ts`, plus mechanical fixture updates in `packages/harness/report.test.ts` and `packages/harness/artifact.test.ts`
- **Verification:** Full suite green; a dedicated `artifact.test.ts` test proves `buildArtifact` still throws for a genuinely non-adopting module (`{ id: "legacy", version: "1.0.0" }`).
- **Committed in:** `15116234` (Task 3 commit)

**4. [Rule 3 - Blocking] Existing sigma1 test fixtures' raw-breakdown JSON lacked the fields rp/2024.ts's and rp/2025.ts's own Zod schemas require**
- **Found during:** Task 2, running the full test suite after wiring `update()`'s RP parse
- **Issue:** `sigma1.test.ts`/`params.test.ts`/`carryover.test.ts`'s `rawBreakdown2024Uniform`/`rawBreakdown2025Uniform` helpers were built for `breakdown/2024.ts`'s/`2025.ts`'s SCORE-side schema, which silently strips unknown fields. `rp/2024.ts`'s and `rp/2025.ts`'s OWN schemas (a different required-field set) now ALSO parse this same raw JSON inside `update()` and threw `ZodError`s for every affected test.
- **Fix:** Added the RP-required placeholder fields (bonus-achievement booleans, per-robot fields, diagnostic thresholds) to each helper, documented inline as RP-schema accommodations with no bearing on the score-side assertions those tests make.
- **Files modified:** `packages/core/algorithms/sigma1/sigma1.test.ts`, `params.test.ts`, `carryover.test.ts`
- **Verification:** Full suite green afterward; no assertion changed.
- **Committed in:** `1f987c19` (Task 2 commit)

---

**Total deviations:** 4 auto-fixed (2 Rule 2, 1 Rule 1, 1 Rule 3)
**Impact on plan:** All four necessary for correctness or to avoid breaking existing, working functionality. Deviation #2 (conservative-gate bonuses) is a genuine, honestly-measured modeling limitation flagged for human review — not silently accepted as fully solved, matching this project's established precedent (03-02's `KNOWN_TOLERANCES`). No unrelated scope creep.

## Issues Encountered

- The D-11 correlation test (`distribution.test.ts`) initially failed with the WRONG SIGN (correlated case showing LOWER `P(maxRp)` than the independence control) because the first fixture design made red's win probability already near-certain (`scoreMean` gap of 50), leaving no room for conditioning-on-winning to visibly shift the threshold-variable distribution. Diagnosed by probing the actual pmf values at increasing `crossCov` and increasing draw counts outside the test file, which confirmed the mechanism works correctly once the win probability is genuinely uncertain (~0.76) rather than near 1 — fixed by narrowing the scoreMean gap, not by loosening the assertion.
- Attempted to append this plan's Task 2 deviation to `.planning/WINDOWS.md` via `gsd-tools windows append`; the ledger command failed with the same pre-existing `Error: Ledger entry 2 has invalid status: "resolved"` that plan 03-02's SUMMARY already reported and left unfixed (unrelated to this plan's own changes). Per the windows-ledger step's "optional, best-effort, never blocks execution" guidance, this was not retried or fixed; the deviation is fully documented in this SUMMARY's Deviations section and `coverage.D6` instead.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `rp/state.ts`/`rp/distribution.ts` are complete, tested (30 new tests combined), and Worker-importable-safe (no Node-only APIs beyond the test files, which never ship) — plan 03-04's adaptation work and 03-05's sensitivity screen/joint search can build on `Sigma1Params.rpMonteCarloSeed`/`.rpMonteCarloDraws` without further changes to this plan's files.
- `predictAllianceRpMoments`'s per-alliance score mean/variance threading pattern (never the combined `Prediction.variance`) is the seam any future per-alliance RP refinement should reuse.
- **Recommend a human/product review of `coverage.D6`'s conservative-gate limitation** (2023 sustainabilityBonus, 2024 melodyBonus, 2025 coralBonus/autoBonus systematically understated) before treating ALGO-08/SC-4 as fully verified against the official manuals — a follow-up plan extending `RpThresholdVariable` to track alliance-level gating signals (coopertition flags, per-robot leave state) as their own Kalman-estimated propensity would close this gap without changing `predictThresholds`'s shape.
- Plan 03-05's hyperparameter search can safely set `rpMonteCarloDraws: 0` for speed — proven, not assumed, that doing so leaves the Brier/accuracy search objective completely unaffected.
- No blockers for 03-04 or 03-05.

---
*Phase: 03-tuning-ranking-points-versioning*
*Completed: 2026-08-15*

## Self-Check: PASSED

All 4 created files verified present on disk (`rp/state.ts`, `rp/state.test.ts`, `rp/distribution.ts`, `rp/distribution.test.ts`); all 3 task commit hashes (`58f064fb`, `1f987c19`, `15116234`) verified present in git log.
