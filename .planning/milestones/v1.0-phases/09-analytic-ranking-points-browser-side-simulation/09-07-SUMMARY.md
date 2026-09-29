---
phase: 09-analytic-ranking-points-browser-side-simulation
plan: 07
subsystem: api
tags: [ranking-points, rank-simulation, monte-carlo, coupled-draw, vitest, typescript, browser-safe]

# Dependency graph
requires:
  - phase: 09-analytic-ranking-points-browser-side-simulation
    provides: "09-04's analyticRpPmf/AnalyticRpPmfResult exposing outcome (RpOutcomeDistribution: pRedWin/pTie/pBlueWin/winRp/tieRp) and redBonusPmf/blueBonusPmf (bonus-only marginals); 09-05's RpLayerConfig.tieModel: \"discrete-margin\" making the tie outcome reachable for the first time"
provides:
  - "packages/core/algorithms/simulation/rankSimulation.ts — SimMatchOutcomeInput, optional SimMatchInput.outcome, a fixed three-rng-value coupled draw (outcome, then red bonus, then blue bonus) alongside the unchanged two-rng-value legacy path; the module stays a zero-import browser-safe leaf and assigns no meaning to any index"
  - "packages/core/algorithms/types.ts — five optional Prediction fields (matchOutcomePmf, redOutcomeRp, blueOutcomeRp, redBonusRpPmf, blueBonusRpPmf)"
  - "packages/harness/sigmaScoutLayer.ts — #rpFieldsFor composes the five fields from 09-04's exported halves plus the season's own winRp/tieRp"
  - "packages/harness/preSchedule.ts — toSimMatchInput's fifth outcome parameter, the pricing loop's decomposition build, the first-match-probe discipline extended to it"
  - "packages/harness/pageArtifacts.ts — matchOutcomePmf/redBonusRpPmf/blueBonusRpPmf as .optional() on EventMatchSchema and EventUpcomingMatchSchema; rpOutcomeRp as .optional() on EventArtifactSchema"
  - "packages/harness/publish.ts — both event row builders emit the three fields through roundPmf; findRpOutcomeRp derives the top-level pair from the first record carrying the outcome-RP vectors"
  - "apps/web/src/lib/simulationInputs.ts — buildSimulationInputs attaches outcome when the complete four-piece set is present, with the total-pmf inclusion rule UNCHANGED"
  - "scripts/mockRankDistribution.ts — assembleDrawLoopInputs already carries the decomposition through (delegates to simulationInputs.ts's buildSimulationInputs directly); documented rather than reimplemented"
affects: [09-08, 09-09, 09-10]

# Actuals (#2632)
actuals:
  tokens: 17300
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A single optional OBJECT (SimMatchOutcomeInput) rather than five optional scalars on SimMatchInput — makes all-present-or-all-absent a compile-time property instead of a runtime check"
    - "The coupled draw is a branch inside the existing per-match draw loop, not a second function — 'absent' and 'present' share the same accumulator/reset/sort/histogram code, differing only in how redRp/blueRp are computed for that one match"
    - "A second assembler (mockRankDistribution.ts) proven not to duplicate a producer's logic by delegating to the producer's own function rather than reimplementing it — the drift-risk mitigation is architectural, not a comment"

key-files:
  created: []
  modified:
    - packages/core/algorithms/simulation/rankSimulation.ts
    - packages/core/algorithms/simulation/rankSimulation.test.ts
    - packages/core/algorithms/types.ts
    - packages/harness/sigmaScoutLayer.ts
    - packages/harness/preSchedule.ts
    - packages/harness/preSchedule.test.ts
    - packages/harness/pageArtifacts.ts
    - packages/harness/pageArtifacts.test.ts
    - packages/harness/publish.ts
    - packages/harness/publish.test.ts
    - apps/web/src/lib/simulationInputs.ts
    - apps/web/src/lib/simulationInputs.test.ts
    - apps/web/src/workers/simulationProtocol.test.ts
    - scripts/mockRankDistribution.ts

key-decisions:
  - "09-04's actual export shape differs from the plan's own assumed names in one respect, resolved per the plan's own contingency instruction (\"use 09-04's names everywhere, introduce no parallel name\"): the plan assumed a flat outcomePmf: number[] on analyticRpPmf's result; the shipped shape is outcome: RpOutcomeDistribution ({ pRedWin, pTie, pBlueWin, winRp, tieRp }), an object rather than an array. redBonusPmf/blueBonusPmf matched the plan's assumption exactly. #rpFieldsFor composes the flat [pRedWin, pTie, pBlueWin] array FROM the object's three scalar fields, reading 09-04's own field names directly — no parallel name introduced."
  - "The plan's anticipated cross-plan hazard (rankSimulation.test.ts still importing rpPmfForMatch from the deleted distribution.js) did NOT occur — 09-04's own Task 3 deviation record shows it already migrated this file's fixtures to analyticRpPmf. Confirmed at Task 1's baseline: the file already imports from analyticPmf.js and the pre-existing 14 tests pass unmodified. No fix was needed; recorded as a baseline finding rather than a deviation."
  - "PreSchedulePricingError's constructor gained an optional second parameter (missing, default \"redRpPmf/blueRpPmf\") rather than a new error class, so the existing single-argument call site is unchanged and the new decomposition-corruption case (\"a later synthetic match lacks the decomposition after the first established it\") reuses the same error identity and message shape."

patterns-established:
  - "A coupled Monte Carlo draw stays inside the SAME function and the SAME per-draw rng stream as the path it replaces for a subset of inputs — no new function, no new seed, no new draw-count parameter; only the number of drawCategorical calls per match changes (2 vs 3), and that count is itself asserted exactly (Test 18)."

requirements-completed: [D-15]

coverage:
  - id: D1
    description: "Red and blue can no longer both win the same draw — Test 15 pins rankHistograms.get(\"frcRef\") to exactly [0, 1000, 0], a state the pre-fix code cannot produce (roughly half of draws would place frcRef at rank 1 or rank 3 instead)"
    verification:
      - kind: unit
        ref: "packages/core/algorithms/simulation/rankSimulation.test.ts#simulateRanks — Test 15: both alliances cannot win the same draw"
        status: pass
    human_judgment: false
  - id: D2
    description: "The outcome is drawn once (approach b) and bonuses per alliance, with the choice and its A3 citation written into the module's own header"
    verification:
      - kind: unit
        ref: "packages/core/algorithms/simulation/rankSimulation.test.ts#simulateRanks — Test 16 (bonus adds on top, deterministically) and Test 18 (exact 3-value-per-match-per-draw rng consumption for the coupled path)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The bonus-only marginal is consumed from 09-04 (redBonusPmf/blueBonusPmf), never reconstructed; the tie outcome is a genuine third outcome Test 17 exercises"
    verification:
      - kind: unit
        ref: "packages/core/algorithms/simulation/rankSimulation.test.ts#simulateRanks — Test 17: the tie outcome is reachable and pays both alliances"
        status: pass
    human_judgment: false
  - id: D4
    description: "A published artifact predating the decomposition still simulates on the unchanged legacy path, with its matchKey absent from excludedMatchKeys — asserted in both directions"
    verification:
      - kind: unit
        ref: "apps/web/src/lib/simulationInputs.test.ts#D-15 — the exclusion rule does not tighten; packages/core/algorithms/simulation/rankSimulation.test.ts#Test 21: mixed input is valid"
        status: pass
    human_judgment: false
  - id: D5
    description: "Phase 8's contracts are intact: one zero-import implementation shared by browser and offline paths, the Worker protocol/bounds/chunking unedited and proven by a passing round trip, chunk-equals-whole via exact rng counts, near-ties/interpolated-band-edge rules untouched"
    verification:
      - kind: unit
        ref: "packages/harness/browserSafeSchemas.test.ts (10/10, unchanged); apps/web/src/workers/simulationProtocol.test.ts#Test 10 (coupled-shape round trip, entry-for-entry identical to a direct simulateRanks call); packages/core/algorithms/simulation/rankSimulation.test.ts#Test 19 (chunk-equals-whole with outcome present)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Full suite green against the recorded baseline; both typecheck invocations clean"
    verification:
      - kind: unit
        ref: "npx vitest run (repo root): 255 files, 4965 passed | 6 skipped, zero failures beyond the pre-Task-1 baseline (255 files, 4943 passed, 6 skipped)"
        status: pass
    human_judgment: false

duration: ~18min
completed: 2026-09-11
status: complete
---

# Phase 9 Plan 7: Rank Simulation Coupled Draw Summary

**The rank simulation now draws a match's outcome ONCE (red win / tie / blue win) from a shared three-entry distribution, then each alliance's bonus RP independently — replacing the two fully-independent `drawCategorical` calls over `redRpPmf`/`blueRpPmf` that let both alliances "win" the same draw — carried end to end from 09-04's exported decomposition halves through both the offline baked path and the published event artifact, with the original two-draw path preserved byte-identically for every artifact published before 09-10's republish.**

## Performance

- **Duration:** ~18 min
- **Tasks:** 3
- **Files modified:** 14
- **Commits:** 3 (`247b1d8a` Task 1, `6d52d974` Task 2, `bbf81a41` Task 3)

## Accomplishments

- **`rankSimulation.ts`'s coupled draw** (D-15): `SimMatchOutcomeInput` (`outcomePmf`, `redOutcomeRp`, `blueOutcomeRp`, `redBonusRpPmf`, `blueBonusRpPmf`) and an optional `SimMatchInput.outcome`. Inside the existing draw loop, a match with `outcome` present draws the outcome index once (`drawCategorical(outcome.outcomePmf, rng)`), then each alliance's bonus RP independently (`drawCategorical(outcome.redBonusRpPmf, rng)` / `...blueBonusRpPmf...`), then adds `outcome.redOutcomeRp[index]` / `outcome.blueOutcomeRp[index]` — three `rng()` calls, fixed, in the pinned order outcome/red-bonus/blue-bonus. A match without `outcome` takes the unchanged original path (two `drawCategorical` calls over `redRpPmf`/`blueRpPmf`), reproducing every one of Tests 1-14's histograms byte-for-byte under the same seed. The module header was rewritten to retract its former "no separately-drawn winner" claim and name approach (b), citing 09-RESEARCH.md's assumption A3.
- **Extended, not duplicated, up-front validation**: `assertValidPmf` now takes a field-name string (was `"red"|"blue"`) so its error message can identify any of the five new arrays; two new helpers (`assertFiniteVector`, `assertOutcomeVectorLength`) reject a non-finite outcome-RP entry or a length mismatch against `outcomePmf` — all still in the O(matches)-once resolver pass, never the hot loop.
- **Tests 15-21** (21 total, up from 14): Test 15's structural `[0, 1000, 0]` proof that both-alliances-win is now impossible; Test 16 brackets red's total RP to exactly 3 from two directions; Test 17 exercises the tie outcome for the first time (unreachable before 09-05); Test 18 asserts exact rng consumption — legacy `2 × matches × draws`, coupled `3 × matches × draws`, mixed `(2×legacyCount + 3×coupledCount) × draws` — with concrete counts of **300 / 450 / 650** on this plan's own fixture (3 matches, 50 draws); Test 19 proves chunk-equals-whole still holds with `outcome` present; Test 20 asserts all five malformed-field rejections happen with **zero** rng calls; Test 21 proves a mixed remaining-matches list (one coupled row, one legacy row) returns a complete histogram set.
- **The offline baked path, end to end** (Task 1, tracer): `types.ts` gained five optional `Prediction` fields, each doc-commented against its two nearest neighbours by name (`redRpPmf` the TOTAL, `redBonusRp` the per-bonus marginal, the new fields a THIRD quantity again). `sigmaScoutLayer.ts#rpFieldsFor` composes them from `analyticRpPmf`'s result (`pmf.outcome`, `pmf.redBonusPmf`, `pmf.blueBonusPmf`) plus `this.#ruleModule.winRp`/`.tieRp`, gated on all three source pieces being present together. `preSchedule.ts`'s `toSimMatchInput` gained a fifth `outcome` parameter; the pricing loop builds it via `roundPmf` on the three pmf arrays (outcome-RP vectors pass through unrounded — exact small integers), and the existing first-match-probe discipline was extended: once the first priced prediction establishes the algorithm carries the decomposition, a later one that lacks it throws `PreSchedulePricingError` naming "the RP decomposition" (constructor gained an optional second parameter, no new error class).
- **The published transport** (Task 2): three new `.optional()` array fields on both `EventMatchSchema` and `EventUpcomingMatchSchema` (`matchOutcomePmf`, `redBonusRpPmf`, `blueBonusRpPmf`) with `isValidPmf` refines matching the existing `redRpPmf` convention exactly; one new `.optional()` `rpOutcomeRp: { win, tie }` on `EventArtifactSchema`, following `CompareExclusionCountsSchema.coldStart`'s precedent verbatim so every already-published `v1/events/**` object stays parseable. `publish.ts`'s both event row builders emit the three fields ungated on competition level (PD-02's stated reason); a new `findRpOutcomeRp` helper derives the top-level pair from the FIRST record (played, then upcoming) whose prediction carries both outcome-RP vectors, reading the season's constants off the prediction rather than importing the rule module into the publisher.
- **The consumer gate, proven not to tighten** (Task 2): `simulationInputs.ts#buildSimulationInputs` attaches `outcome` to a `SimMatchInput` only when all four pieces (three row fields + the artifact's top-level `rpOutcomeRp`) are present — the pre-existing total-pmf-pair inclusion check is completely unchanged, asserted in both directions by a dedicated test (a row with usable `redRpPmf`/`blueRpPmf` but no decomposition is included, `outcome` undefined, `matchKey` absent from `excludedMatchKeys`).
- **The second assembler, proven not to drift** (Task 3): `scripts/mockRankDistribution.ts`'s `assembleDrawLoopInputs` needed **no code change** — it already calls `simulationInputs.ts`'s `buildSimulationInputs` directly rather than reimplementing row assembly, so Task 2's `outcome`-attachment logic reaches the mock renderer automatically. A doc comment records this rather than leaving it an undiscovered coincidence.
- **The Worker protocol proven unchanged by running it**, not asserting it (Task 3): `simulationProtocol.test.ts`'s new Test 10 sends a `SimulationRequest` whose matches carry `outcome` through the real mock-Worker `structuredClone` round trip and compares the result entry-for-entry against a direct `simulateRanks` call on the same fixture and seed — identical. `isSimulationRequest` needed no change (it validates the `matches` array, never element fields), and none was made.

## Task Commits

1. **Task 1: TRACER — coupled rank-simulation draw over the offline baked path** — `247b1d8a` (feat)
2. **Task 2: The published transport** — `6d52d974` (feat)
3. **Task 3: Phase 8 contract sweep, the second assembler, and named handoffs** — `bbf81a41` (test)

## `<baseline>` record (captured before Task 1)

1. **09-04 export names, confirmed against the shipped file** (`packages/core/rankingPoints/analyticPmf.ts`): `AnalyticRpPmfResult` exposes `redBonusPmf?`/`blueBonusPmf?` (matching the plan's assumed names exactly) and `outcome?: RpOutcomeDistribution` — **not** a flat `outcomePmf: number[]` as the plan assumed. `RpOutcomeDistribution` is `{ pRedWin, pTie, pBlueWin, winRp, tieRp }`. Both bonus pmfs and `outcome` are unconditionally present together whenever `analyticRpPmf` runs the bonus path (only the non-qualification `compLevel` short-circuit — `{ redPmf: [1], bluePmf: [1] }` — omits all three). Resolved per the plan's own contingency: `#rpFieldsFor` composes the flat 3-entry array `[pRedWin, pTie, pBlueWin]` from the object's own field names, introducing no parallel name.
2. **09-05 landed; `tieModel` is representable**: `RpTieModel = "continuous-equality" | "discrete-margin"`, confirmed via grep. The three-entry outcome shape is invariant across the branch (per 09-05's own finding, the middle entry is ~0 under the inert default).
3. **`rankSimulation.test.ts`'s import already resolved** — contrary to the plan's anticipated hazard, the file already imports `analyticRpPmf` from `analyticPmf.js` (09-04's own Task 3 deviation record shows this migration happened there). `npx vitest run packages/core/algorithms/simulation` at baseline: **14 passed, 0 failed.**
4. **The bug's anchor**: `grep -n "drawCategorical" rankSimulation.ts` at baseline showed the primitive's definition (line 63) plus two call sites inside the draw loop at lines 265-266 (not 264-274 as RESEARCH.md's line numbers suggested — the two-independent-draws shape is the anchor, not the exact line number, per the plan's own instruction).
5. **Phase 8 contracts, before-picture**: `apps/web/src/workers/simulationProtocol.test.ts` — 9 passed. `packages/harness/browserSafeSchemas.test.ts` — 10 passed.
6. **Suite baseline** (all six commands, full printed output recorded, judged by output never exit code):
   - `npx vitest run packages/core/algorithms/simulation` — 1 file, 14 passed
   - `npx vitest run packages/harness/preSchedule.test.ts packages/harness/pageArtifacts.test.ts packages/harness/publish.test.ts` — 3 files, 349 passed
   - `npx vitest run apps/web/src/lib/simulationInputs.test.ts apps/web/src/workers/simulationProtocol.test.ts` — 2 files, 38 passed
   - `npx vitest run packages/harness/browserSafeSchemas.test.ts` — 1 file, 10 passed
   - `npx tsc --noEmit` — clean
   - `npx tsc --noEmit -p apps/web/tsconfig.json` — clean
   - `npx vitest run` (full suite, repo root) — **255 files, 4943 passed, 6 skipped, 0 failed**

## Registered handoffs (Task 3, action item 4)

- **09-08 (wave 6) owns the live Worker's two row builders.** `apps/worker/src/scheduled.ts`'s `buildEventMatchRow`/`buildEventUpcomingRow` do not emit the three new row fields, and this plan never touched that file (confirmed: absent from every commit's `git diff --name-only`). **Degradation while unwired:** a live-tick row carries the total pmfs but not the decomposition, so the browser simulates it on the legacy path — the fix is silently absent on live rows, nothing breaks and nothing goes dark.
- **09-10 (wave 7) owns the republish** that makes the browser take the coupled path in production. Until it runs, every already-published event degrades to the legacy path (proven in both directions by `simulationInputs.test.ts`'s dedicated tests). **Note for 09-10:** the three new row fields add roughly three short arrays per qualification row plus one two-number object per artifact — small and highly compressible, but real; the payload-budget re-measurement is the right place to look at it, not here.
- **09-09 (wave 6) owns `preSchedule.ts`'s rung-1 redesign.** Task 1's change is confined to `toSimMatchInput`'s signature and the pricing loop's local `outcome` build — the surrounding structure (the shuffle/seed machinery, `buildScheduleMatches`, the baked-histogram loop) is untouched, exactly where 09-09 expects to find it. If D-16's field-averaged predictor ships and schedule generation is deleted, the fifth parameter goes with it.
- **`scripts/measureRewindGap.ts` and `packages/harness/predictions.ts` are a deliberate, reasoned non-gap.** The rewind-gap measurement reads stored `PredictionRecord`s, which carry no decomposition, so both of its arms ("stored" and "frozen") take the legacy path identically — a same-scorer comparison between two prediction sets, both moving together, stays internally valid. The committed figure in `docs/models/rewind-overconfidence-gap.md` was measured under the independent-draw model and still describes what it says it describes. Upgrading it would need a `predictions.ts` schema version bump, an emitter change in `cli.ts`, and a full corpus re-run — a measurement decision no CONTEXT.md decision authorizes. Recorded as a candidate follow-on quick task, not silently skipped.
- **RESEARCH.md Open Question 3, observed and not acted on.** While working in `sigmaScoutLayer.ts#rpFieldsFor` for Task 1, the four early-return guards — including `redBandVariance === undefined || blueBandVariance === undefined` — were confirmed byte-identical to baseline (Task 1's own acceptance criterion). 09-05 already measured that under `winSource: "p-red-win"` with the legacy tie model, the band VALUE feeds nothing into the RP layer's output; this plan's own observation, working in the same function, is narrower and purely structural: the band-variance UNDEFINED-CHECK still gates whether RP is computed AT ALL (it runs before `analyticRpPmf` is ever called), regardless of whether the value that passes the check goes on to matter. The gate is therefore "vestigial to the pmf's shape" (09-05's finding) but not "vestigial to whether a pmf exists" — both readings are consistent, and this plan changes neither. **Not changed** — F8/F9's cold-start chain is out of scope for the whole phase.

## Files Created/Modified

- `packages/core/algorithms/simulation/rankSimulation.ts` — `SimMatchOutcomeInput`, optional `SimMatchInput.outcome`, the coupled draw branch, extended validation, rewritten header
- `packages/core/algorithms/simulation/rankSimulation.test.ts` — Tests 15-21 (21 total)
- `packages/core/algorithms/types.ts` — five optional `Prediction` fields
- `packages/harness/sigmaScoutLayer.ts` — `#rpFieldsFor` composes the five fields
- `packages/harness/preSchedule.ts` — `toSimMatchInput`'s fifth parameter, `buildOutcomeInput`, extended first-match-probe discipline
- `packages/harness/preSchedule.test.ts` — two new `toSimMatchInput` cases
- `packages/harness/pageArtifacts.ts` — three new row fields (both event schemas), one new top-level pair
- `packages/harness/pageArtifacts.test.ts` — four new cases
- `packages/harness/publish.ts` — both row builders emit the decomposition; `findRpOutcomeRp`
- `packages/harness/publish.test.ts` — three new cases
- `apps/web/src/lib/simulationInputs.ts` — `buildSimulationInputs` attaches `outcome` when complete
- `apps/web/src/lib/simulationInputs.test.ts` — four new cases
- `apps/web/src/workers/simulationProtocol.test.ts` — Test 10, the coupled-shape round trip
- `scripts/mockRankDistribution.ts` — doc comment recording the no-code-change finding

## Decisions Made

See `key-decisions` in the frontmatter: (1) reconciling 09-04's actual `outcome: RpOutcomeDistribution` object shape against the plan's assumed flat `outcomePmf` array, per the plan's own contingency instruction; (2) confirming the plan's anticipated `distribution.js` import hazard had already been resolved by 09-04, so no fix was needed; (3) extending `PreSchedulePricingError`'s constructor with an optional second parameter rather than adding a new error class.

## Deviations from Plan

None — plan executed exactly as written. The two items that might look like deviations are both explicitly plan-anticipated contingencies, not Rule 1-4 triggers: the 09-04 name reconciliation (plan text: "these names are an assumption, not a fact... use 09-04's names everywhere") and the already-resolved test-import hazard (plan text: "if it fails to resolve that import, that is a finding to report... if it does resolve, [continue]").

## Issues Encountered

None. No concurrent-session interference was observed during this plan's execution (unlike 09-04/09-05, which both recorded a second session actively committing to the same checkout).

## User Setup Required

None — no external service configuration required. No package was installed, removed, or upgraded (`git diff --stat` over all three commits touches no `package.json`/lockfile); the Package Legitimacy Gate does not apply.

## Next Phase Readiness

- **09-08** can wire `apps/worker/src/scheduled.ts`'s two row builders to emit the three new fields once its own D-21 state-shape bump lands — this plan's `Prediction` fields and `pageArtifacts.ts` schema are ready to receive them with no further change.
- **09-09** can proceed with `preSchedule.ts`'s rung-1 redesign; the fifth `outcome` parameter this plan added to `toSimMatchInput` is confined to that function's signature and the pricing loop's local build, and will move with schedule generation if it is deleted.
- **09-10** can republish once 09-08/09-09 land; every already-published artifact continues to simulate correctly on the legacy path in the meantime (proven in both directions). The payload-budget note above is 09-10's own to weigh.
- Nothing published was changed by this plan — no publish command was run, no R2 write, no D1 access; confirmed entirely offline pipeline/library code plus test files.

---
*Phase: 09-analytic-ranking-points-browser-side-simulation*
*Completed: 2026-09-11*
