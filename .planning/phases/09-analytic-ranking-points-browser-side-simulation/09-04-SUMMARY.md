---
phase: 09-analytic-ranking-points-browser-side-simulation
plan: 04
subsystem: api
tags: [ranking-points, closed-form, vitest, typescript, browser-safe, cholesky-removal]

# Dependency graph
requires:
  - phase: 09-analytic-ranking-points-browser-side-simulation
    provides: "09-01's frozen data/baselines/level1-digest-2026-09.json + level1Digest.test.ts (D-12 corpus-free gate); 09-02's BonusPredicate contract (constants.ts); 09-03's marginals.ts numeric core (fitAllianceMarginals, probAtLeast, probAtMost, poissonBinomialAtLeast, fitMarginal)"
provides:
  - "packages/core/rankingPoints/analyticPmf.ts — the closed-form RP pmf engine: RpLayerConfig/RP_LAYER_CONFIG_DEFAULT/assertSupportedRpLayerConfig/resolveMarginalFamily/describeRpLayerConfig (D-05/D-06), convolvePmf, matchOutcomeDistribution/RpOutcomeDistribution/RpOutcomeInput, allianceBonusRpPmf/AllianceBonusRp, analyticRpPmf/AnalyticRpPmfInput/AnalyticRpPmfResult, pmfMean/pmfStandardDeviation (moved from distribution.ts)"
  - "Both harness RP write paths (sigmaScoutLayer.ts#rpFieldsFor, publish.ts makeRankingPointFiller) call analyticRpPmf; RpLayerConfig threaded through both of publish.ts's orchestrations (publishSeasons, buildSingleEventPublish/--event)"
  - "distribution.ts and its sigma1 test file deleted; every describe block classified carried-forward or retired-with-its-subject"
affects: [09-05, 09-06, 09-07, 09-08, 09-09, 09-10]

# Actuals (#2632)
actuals:
  tokens: 54500
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Independent test-file re-implementation of grouping/footprint logic (analyticPmf.seasons.test.ts) rather than importing the module's own internal grouping function — testing a module against its own internals only proves it agrees with itself"
    - "A shared, non-*.test.ts fixture-builder module (analyticPmfFixtures.ts) for cross-test-file reuse — importing one .test.ts file from another re-executes its top-level describe() registrations under vitest's file-glob collection, silently duplicating every test in it (discovered and fixed within this plan, not shipped)"

key-files:
  created:
    - packages/core/rankingPoints/analyticPmf.ts
    - packages/core/rankingPoints/analyticPmf.test.ts
    - packages/core/rankingPoints/analyticPmf.seasons.test.ts
    - packages/core/rankingPoints/analyticPmfFixtures.ts
  modified:
    - packages/harness/sigmaScoutLayer.ts
    - packages/harness/publish.ts
    - packages/harness/browserSafeSchemas.test.ts
    - packages/core/algorithms/sigma1/index.ts
    - packages/core/algorithms/types.ts
    - packages/core/rankingPoints/moments.ts
    - packages/core/rankingPoints/constants.ts
    - packages/core/rankingPoints/empiricalMoments.test.ts
    - packages/core/algorithms/simulation/rankSimulation.test.ts
    - packages/harness/promotedOverrides.test.ts
    - apps/worker/src/bundleSmoke.ts
    - packages/harness/pageArtifacts.ts
    - packages/harness/rpConservativeBranch.ts
    - packages/core/rankingPoints/2017.ts
    - packages/core/rankingPoints/2018.ts
    - packages/core/rankingPoints/2019.ts
    - packages/core/rankingPoints/marginals.ts
    - packages/core/rankingPoints/marginals.test.ts
    - apps/web/src/lib/bonusRp.ts
    - packages/core/algorithms/sigma1/sigma1.test.ts
    - packages/core/algorithms/sigma1/innovationVariance.test.ts
    - packages/harness/publish.test.ts
  deleted:
    - packages/core/rankingPoints/distribution.ts
    - packages/core/algorithms/sigma1/rp/distribution.test.ts
  renamed:
    - from: packages/core/rankingPoints/distribution.universal.test.ts
      to: packages/core/rankingPoints/analyticPmf.universal.test.ts

key-decisions:
  - "VPR's own RP block was REMOVED, not repointed at analyticRpPmf — predictAllianceRpMoments supplies a learned, non-zero scoreCrossCovariance (D-11) that analyticRpPmf's independence precondition would silently discard. VPR is retired/unpublished; SigmaScoutLayer.foldPlayed already fills RP for every algorithm, making VPR uniform instead of the one exception."
  - "Fixed two test regressions this task's intentional behavior change surfaced, outside the plan's declared file list, under Rule 1 (auto-fix bugs): sigma1.test.ts's/innovationVariance.test.ts's assertions that predict() still carries redRpPmf directly, and publish.test.ts's Test 8 fixture, which relied on VPR's old RP path bypassing the Swing-band-variance cold-start gate."
  - "buildRuleModuleMoments extracted into a NEW, non-*.test.ts module (analyticPmfFixtures.ts) rather than the plan's literal 'put the helper in the seasons file' instruction, after discovering importing one .test.ts file from another duplicates its describe() registrations under vitest's collection glob — verified via test-count arithmetic (24 vs the correct 19) before shipping the fix."

patterns-established:
  - "A closed-form pmf module with zero runtime imports (D-08) computing bonus-RP by connected-components grouping over threshold-variable footprints, an interval enumeration for nested-same-variable groups, and convolution — no seed, no match key, no draw count anywhere."

requirements-completed: [D-05, D-06, D-07, D-08, D-10, D-12, F4]

coverage:
  - id: D1
    description: "analyticRpPmf computes the RP pmf from a closed form (marginal CDFs, group enumeration, convolution) with no randomness anywhere in packages/core/rankingPoints/"
    verification:
      - kind: unit
        ref: "analyticPmf.test.ts (19 tests, Task 1 tracer + Task 2 mechanisms) — grep for Math.random/mulberry/boxMuller/fnv1a/Cholesky/Matrix( returns 0 matches outside comments"
        status: pass
    human_judgment: false
  - id: D2
    description: "analyticPmf.ts is browser-safe, machine-checked via browserSafeSchemas.test.ts's ninth entry point, hand-verified to fail (temporary node:fs import) and pass"
    verification:
      - kind: unit
        ref: "browserSafeSchemas.test.ts (10 tests) — hand-verification transcript quoted below in this SUMMARY"
        status: pass
    human_judgment: false
  - id: D3
    description: "2026's nested-threshold pair is computed as an interval probability, never the independent product; the test proves it would have caught the wrong answer"
    verification:
      - kind: unit
        ref: "analyticPmf.test.ts > Test 1 — quoted assertions below in this SUMMARY"
        status: pass
    human_judgment: false
  - id: D4
    description: "All seven mechanism classes carry hand-computed expected values pinned at planning time, never round-tripped against the implementation"
    verification:
      - kind: unit
        ref: "analyticPmf.test.ts's 7 mechanism tests (nested-threshold + 6 more), all pinned to this plan's own reference table"
        status: pass
    human_judgment: false
  - id: D5
    description: "The all-season structural sweep proves the grouping claim, footprint disjointness, no-mass-folding, normalization, and the all-variance-zero degeneration to predictThresholds' own flags — with non-vacuity demonstrated by a deliberate perturbation"
    verification:
      - kind: unit
        ref: "analyticPmf.seasons.test.ts (5 tests) — perturbation failure/revert quoted below in this SUMMARY"
        status: pass
    human_judgment: false
  - id: D6
    description: "distribution.ts is deleted along with the ridge ladder, cross-covariance clamp, joint-model builder, sampler primitives, and level-2 Monte Carlo config; ml-matrix leaves packages/core/rankingPoints/ but stays in opr.ts and package.json"
    verification:
      - kind: other
        ref: "grep source assertions (import specifier, ml-matrix scope, sampler primitives) — all return 0 matches, quoted below in this SUMMARY"
        status: pass
    human_judgment: false
  - id: D7
    description: "D-12: pRedWin/redScore/blueScore byte-identical against 09-01's frozen digest after the whole engine swap, proven twice (end of Task 1, end of Task 3)"
    verification:
      - kind: unit
        ref: "level1Digest.test.ts's digest byte-identity assertion — both passing runs quoted below in this SUMMARY"
        status: pass
    human_judgment: false

duration: 5h
completed: 2026-09-11
status: complete
---

# Phase 9 Plan 4: The Analytic RP Closed Form Summary

**Replaced `distribution.ts`'s 4,000-draw joint Monte Carlo with an exact closed-form pmf (`analyticPmf.ts`) — marginal CDFs, computed connected-components grouping, a proven-non-vacuous interval enumeration for 2026's nested `energized`/`supercharged` pair, and convolution — wired into both harness RP write paths, with D-12's byte-identity gate proven twice and the old engine deleted from the tree.**

## Performance

- **Duration:** ~5h
- **Tasks:** 3
- **Commits:** 3 (`9c372cd6` Task 1, `3ad3e004` Task 2, `5de615fc` Task 3)
- **Files touched:** 4 created (Task 1/2), 21 modified, 2 deleted, 1 renamed

## Accomplishments

- **Built `analyticPmf.ts`** (D-08): a zero-runtime-import leaf implementing the closed form's seven steps exactly as specified — per-variable marginal fitting (09-03's `fitAllianceMarginals`), computed connected-components grouping over each `BonusPredicate`'s variable footprint, the nested-threshold interval enumeration, per-bonus-kind probability dispatch through a shared `clauseProbability`, group convolution into a bonus-only pmf, the win/tie outcome half, and the final convolution. `RpLayerConfig` (D-05) lands at inert defaults reproducing today's model exactly; every non-default branch throws by name, pointing at 09-05; the removal notice (D-06) is recorded both in the file header and beside the type declaration.
- **Paid D-07's mitigation in full**: 19 hand-computed tests across `analyticPmf.test.ts` (the 2026 nested-threshold non-vacuity case plus five more mechanism classes — `singleThreshold`, `linearCombination`, `conjunctionDistinct`, `countOfIndicators`, `dataDependentMixture`, `constant`), all pinned to values computed at PLANNING time from the closed form, none round-tripped against the implementation.
- **Structural sweep across all ten seasons** (`analyticPmf.seasons.test.ts`, 5 tests, registry-driven via `RP_REGISTERED_SEASONS`, never a hand-typed list): computed grouping (exactly one multi-bonus group in the whole registry — 2026's `{energized, supercharged}`), footprint disjointness where the exactness argument requires it, no mass ever folds, every pmf normalized, and the all-variance-zero limit degenerates to exactly `predictThresholds`' own boolean flags — the last assertion observed FAILING on a deliberately inverted comparison direction, then reverted clean.
- **Wired both harness RP write paths** to `analyticRpPmf`: `sigmaScoutLayer.ts#rpFieldsFor` and `publish.ts`'s `makeRankingPointFiller`, with `RpLayerConfig` threaded to both of `publish.ts`'s orchestrations (`publishSeasons` and `buildSingleEventPublish`/`--event`) via one named local each — closing the exact defect class `sigmaScoutLayer.ts`'s own header describes (a level-2 field reaching only one write path).
- **Deleted `distribution.ts`** and everything it carried: `CHOLESKY_RIDGES`, `clampCrossCovariance`, `CROSS_COVARIANCE_SAFETY_FACTOR`, `buildJointModel`, `mulberry32`/`boxMullerPair`/`fnv1a32`, `rpPmfForMatch`, and the `ml-matrix` import. `pmfMean`/`pmfStandardDeviation` MOVED (not deleted) to `analyticPmf.ts`. `ml-matrix` left `packages/core/rankingPoints/` entirely while remaining a repo dependency for `opr.ts`'s SVD (`package.json` untouched — no install, no uninstall).
- **VPR's own RP block removed, not repointed** (`sigma1/index.ts`): `predictAllianceRpMoments` supplies a learned, non-zero `scoreCrossCovariance` that `analyticRpPmf`'s independence precondition would silently discard — removing the block rather than pointing VPR at the closed form is what keeps that silent discard from happening. `predictAllianceRpMoments` keeps its export and its own tests in `rp/state.test.ts`.
- **Migrated the four `rpPmfForMatch` call sites** the phase outline named only one of: `sigmaScoutLayer.ts#rpFieldsFor`, `publish.ts`'s `makeRankingPointFiller`, `apps/worker/src/bundleSmoke.ts` (repointed, header rewritten to record it no longer exercises `ml-matrix` — `opr.ts`'s SVD is now the sole witness — but stands as proof the RP path bundles for 09-08), and `sigma1/index.ts` (removed, not repointed).
- **D-12 proven twice**: once at the end of Task 1 (engine swapped, old module still present) and once at the end of Task 3 (old module deleted from the tree). Both runs green against the unchanged `data/baselines/level1-digest-2026-09.json`.
- **Comment sweep** (Group C): repointed every "Monte Carlo"/"Cholesky"/"joint draw" reference describing a published field or a structural contract in terms of the deleted sampler, across 14 files. This project's own failure log names documentation describing a deleted model as a recorded failure mode, so this was treated as a real fix, not tidying.

## Task Commits

1. **Task 1: TRACER — analytic RP pmf closed form, wired to both harness write paths** — `9c372cd6` (feat)
2. **Task 2: D-07's remaining six mechanism classes, plus the all-season structural sweep** — `3ad3e004` (test)
3. **Task 3: Delete the Monte Carlo — distribution.ts, its call sites, its tests** — `5de615fc` (feat)

## `<baseline>` record (captured before Task 1, per this plan's own required block)

1. **Worktrees off**, confirmed (`.git` is a directory; `.planning/config.json`'s `workflow.use_worktrees: false`).
2. **09-02 landed** — confirmed by reading `constants.ts`'s export list directly (`BonusPredicate`, `RpLinearTerm`, `RpThresholdClause`, `RpPredicateThreshold`, `RpUntrackedGate`, `MarginalFamily`, `resolveRpThreshold`, `evaluateBonusPredicates`, the required `bonusPredicates`/`marginalFamily` fields, the `nestedSameVariable` discriminant).
3. **09-03 landed** — confirmed by reading `marginals.ts`'s export list; `npx vitest run packages/core/rankingPoints/marginals` green.
4. **The degenerate marginal behaves as assumed** — scratch-verified: `fitMarginal(100, 0, "gaussian")` resolves `degenerate`, `probAtLeast(m, 100)=1`, `probAtLeast(m, 101)=0`, `probAtLeast(m, 99)=1`, `probAtMost(m, 100)=1`, `probAtMost(m, 99)=0`. All matched.
5. **09-01's D-12 gate green before any edit**: `npx vitest run packages/harness/level1Digest` — 1 file, 3 tests, all passed.
6. **The `maxRp` identity holds at HEAD** — the ten-season table, quoted from a scratch `tsx` script reading `RP_RULE_MODULES` directly:

   | Season | maxRp | winRp | bonusCount | tieRp | Identity holds |
   |---|---|---|---|---|---|
   | 2016 | 4 | 2 | 2 | 1 | OK |
   | 2017 | 4 | 2 | 2 | 1 | OK |
   | 2018 | 4 | 2 | 2 | 1 | OK |
   | 2019 | 4 | 2 | 2 | 1 | OK |
   | 2020 | 3 | 2 | 1 | 1 | OK |
   | 2022 | 4 | 2 | 2 | 1 | OK |
   | 2023 | 4 | 2 | 2 | 1 | OK |
   | 2024 | 4 | 2 | 2 | 1 | OK |
   | 2025 | 6 | 3 | 3 | 1 | OK |
   | 2026 | 6 | 3 | 3 | 1 | OK |

7. **The full suite was green at HEAD** — `npx vitest run` from the repository root: **251 files, 4870 passed, 4 skipped** (pre-existing skips, matching 09-03-SUMMARY's own after-count exactly, confirming no drift between plans).

## Task 1 — required evidence

### Test command

`npx vitest run packages/core/rankingPoints/analyticPmf` — 8 tests, all named for the eight tracer behaviors, all passing.

### The D-07 nested-threshold case, non-vacuous (quoted from `analyticPmf.test.ts`)

```ts
const independentProduct = energized * supercharged;
expect(independentProduct).toBeCloseTo(0.133483801, 6);
expect(Math.abs(pBoth - independentProduct)).toBeGreaterThan(1e-3);
```

`pBoth` (= `supercharged`, the group's own probability that both fire) computed to `0.158655254` (6dp), `energized` to `0.841344746` — the assertion is that `pBoth` is NOT within `1e-3` of the WRONG independent-product answer `0.133483801`, proven alongside the correct value rather than instead of it.

### The full 2026 pmf, hand-computed end to end

`[0.039663813, 0.210336187, 0.210336187, 0.079327627, 0.210336187, 0.210336187, 0.039663813]` — matched by the implementation to 6 decimal places (raw computed values e.g. `0.039663816` vs pinned `0.039663813`, a ~3e-9 difference entirely inside `erf`'s documented `1.5e-7` approximation error), sums to 1 within `1e-9`.

### The independence precondition bites — verbatim thrown message

```
analyticRpPmf: season 2026 supplied a non-zero scoreCrossCovariance[0] (variable "hubTotalCount") = 5 — this module is exact only when the joint is diagonal; a caller with a learned score/threshold correlation must not call it
```

The off-diagonal `varianceBlock` case throws the mirror message naming `varianceBlock[0][1]`.

### The config refuses what it has not implemented

All three of `winSource: "p-red-win"`, `tieModel: "discrete-margin"`, `marginal: "negative-binomial"` throw with a message naming `09-05`; `RP_LAYER_CONFIG_DEFAULT` does not throw.

### Source assertion — zero-import leaf

```
$ grep -n "^import" packages/core/rankingPoints/analyticPmf.ts
import type { CompLevel } from "../algorithms/types.js";
import type {
  ... (BonusPredicate, EventTier, MarginalFamily, RpRuleModule, RpThresholdClause, RpThresholdVariable)
import { eventTierFor, isBonusRpCompLevel, resolveRpThreshold } from "./constants.js";
import type { AllianceRpMoments } from "./moments.js";
import type { FittedMarginal } from "./marginals.js";
import {
  ... (fitAllianceMarginals, fitMarginal, poissonBinomialAtLeast, probAtLeast, probAtMost, standardNormalCdf)
```

Every import is from `./constants.js`, `./moments.js`, `./marginals.js`, or `../algorithms/types.js` — no other module.

### Source assertion — no randomness

```
$ grep -vE '^\s*(//|\*|/\*)' packages/core/rankingPoints/analyticPmf.ts | grep -cE 'Math\.random|mulberry|boxMuller|fnv1a|Cholesky|Matrix\('
0
```

### Browser-safe entry point, hand-verified to fail then pass

With a temporary `import { readFileSync } from "node:fs";` inserted at the top of `analyticPmf.ts`:

```
FAIL  |node| packages/harness/browserSafeSchemas.test.ts > ... never reaches a Node built-in import from packages/core/rankingPoints/analyticPmf.ts ...
AssertionError: Node built-in import(s) reachable from packages/core/rankingPoints/analyticPmf.ts: ...analyticPmf.ts imports "node:fs"
Test Files  1 failed (1)
     Tests  1 failed | 9 passed (10)
```

Reverted: `Test Files 1 passed (1)`, `Tests 10 passed (10)`.

### D-05 threading — the four `publish.ts` line numbers (final positions after all three commits)

| Call site | Line |
|---|---|
| `new SigmaScoutLayer(rpRuleModule, algorithm.id, rpLayerConfig)` (`publishSeasons`) | 2596 |
| `makeRankingPointFiller(..., rpLayerConfig)` (`publishSeasons`'s sidecar) | 3072 |
| `new SigmaScoutLayer(RP_RULE_MODULES[season], algorithm.id, rpLayerConfig)` (`buildSingleEventPublish`/`--event`) | 3539 |
| `makeRankingPointFiller(..., rpLayerConfig)` (`buildSingleEventPublish`'s sidecar) | 3649 |

Both orchestrations resolve `rpLayerConfig` once, as a named local (`const rpLayerConfig: RpLayerConfig = RP_LAYER_CONFIG_DEFAULT;`), immediately before the first of their own two call sites.

### `RP_MONTE_CARLO` removed from both files

```
$ grep -c "RP_MONTE_CARLO" packages/harness/publish.ts packages/harness/sigmaScoutLayer.ts
packages/harness/publish.ts:0
packages/harness/sigmaScoutLayer.ts:0
```

### The D-12 gate, first proof (end of Task 1, engine swapped, old module still present)

`npx vitest run packages/core/rankingPoints packages/harness/level1Digest packages/harness/browserSafeSchemas` — **9 files, 399 tests, all passed.** `pRedWin`/`redScore`/`blueScore` byte-identical for every published algorithm (opr/epa/bpr) on the bounded 2022 slice.

## Task 2 — required evidence

### The six mechanism values, quoted with their pinned literals

| Mechanism | Season / bonus | Computed | Pinned |
|---|---|---|---|
| `singleThreshold` | 2022 `hangarBonus` | `0.15865526...` | `0.158655254` |
| `linearCombination` | 2017 `rotor` | `0.23974999...` | `0.239750061` |
| `conjunctionDistinct` | 2016 `capture` | `0.03803759...` | `0.038037607` |
| `countOfIndicators` | 2016 `breach` | `0.27283618...` | `0.272836186` |
| `dataDependentMixture` | 2022 `cargoBonus` | `0.32932763...` | `0.329327627` |
| `constant` | 2019 `completeRocket` | `0` (exact) | `0` (exact) |

Verified independently via a scratch `tsx` script against `allianceBonusRpPmf` before writing the pinned tests, then matched exactly by the shipped assertions (6dp).

### Non-vacuity, proven (the all-variance-zero equivalence, deliberately perturbed)

With `clauseProbability`'s direction dispatch temporarily inverted (`gte -> probAtMost`, `lte -> probAtLeast`):

```
FAIL packages/core/rankingPoints/analyticPmf.seasons.test.ts > ... the all-variance-zero equivalence ...
AssertionError: season 2016 eventType 0 pattern 0: red pmf[2] (expected point mass at 3): expected 1 to be +0
FAIL packages/core/rankingPoints/analyticPmf.test.ts > ... singleThreshold — 2022 hangarBonus ...
AssertionError: expected 0.8413447361676363 to be close to 0.158655254
(4 more failures of the same shape, naming linearCombination/conjunctionDistinct/countOfIndicators/dataDependentMixture)
Test Files  2 failed (2)
     Tests  6 failed | 13 passed (19)
```

Reverted, confirmed clean via `git diff --stat` (empty) and a green re-run (`19/19` passed).

### Coverage derives itself, not a hand-typed list

`grep -cE '"20(1[6-9]|2[0-6])"' packages/core/rankingPoints/analyticPmf.seasons.test.ts` returns `0` — no quoted season string anywhere in the file. The sweep iterates `RP_REGISTERED_SEASONS` (lines 118, 134, 164, 183, 215 — every `for (const season of RP_REGISTERED_SEASONS)` in the file).

### Source assertion — no round-tripping

Affirmatively: none of the eight-plus-six-plus-five pinned/derived values in `analyticPmf.test.ts`/`analyticPmf.seasons.test.ts` were produced by running `analyticPmf.ts`. The 8+6 hand-computed values trace to this plan's own "## Hand-computed reference values" table (verified independently via a throwaway `tsx` script before the pinned assertions were written, then the script was deleted); the structural sweep's assertions (grouping, disjointness, no-mass-folds, normalization, all-variance-zero degeneracy) are derived from `RP_RULE_MODULES`'s own declarations and `predictThresholds`'s own boolean output, never from `analyticRpPmf`'s own answer.

### The duplicate-test bug found and fixed within this task

Importing `buildRuleModuleMoments` from `analyticPmf.seasons.test.ts` into `analyticPmf.test.ts` caused vitest to re-execute the seasons file's top-level `describe()` registrations as a side effect of module evaluation (its test-file glob is `packages/**/*.test.ts`) — the five sweep tests appeared TWICE, once under each file's name (`19` real tests inflated to `24`). Fixed by extracting the shared fixture builder into a new, non-`*.test.ts` module (`analyticPmfFixtures.ts`), which carries no `describe()` calls of its own. Verified: `19` tests after the fix, matching `8 (Task 1) + 6 (Task 2 mechanisms) + 5 (sweep)` exactly.

## Task 3 — required evidence

### Source assertions

```
$ test ! -f packages/core/rankingPoints/distribution.ts && echo OK
OK
$ test ! -f packages/core/algorithms/sigma1/rp/distribution.test.ts && echo OK
OK
$ grep -rnE --include=*.ts 'from "[^"]*rankingPoints/distribution' . | grep -v node_modules
(no output — pass)
$ grep -rn --include=*.ts "ml-matrix" packages/core/rankingPoints/ | grep -vE "(//|\*)"
(no output — pass)
$ grep -c "ml-matrix" packages/core/algorithms/opr.ts
1
$ grep -c '"ml-matrix"' package.json
1
$ grep -rE '^[^/*]*(Math\.random|mulberry|boxMuller|fnv1a|Cholesky)' packages/core/rankingPoints/
(no output — pass)
```

**No package was installed, removed, or upgraded.** `ml-matrix` loses one import site (`distribution.ts`, deleted) and keeps another (`opr.ts`); `package.json`'s `"ml-matrix"` count is unchanged at `1`. The Package Legitimacy Gate does not apply, recorded rather than left unstated.

### The classification table — every `describe` block in the deleted `sigma1/rp/distribution.test.ts`

| # | `describe` title | Disposition | Where it lives now |
|---|---|---|---|
| 1 | `rpPmfForMatch — non-qualification short-circuit` | CARRIED FORWARD | `analyticPmf.test.ts` Task 1 Test 5 |
| 2 | `rpPmfForMatch — a qm match's pmf shape` | CARRIED FORWARD | `analyticPmf.seasons.test.ts`'s normalization / no-mass-folds tests |
| 3 | `rpPmfForMatch — zero-draws short-circuit (D-01's search fast path)` | RETIRED WITH ITS SUBJECT | The zero-draws fast path is gone — a closed form has no draw count to set to zero |
| 4 | `rpPmfForMatch — determinism (D-16)` | RETIRED WITH ITS SUBJECT | Replaced by `analyticPmf.universal.test.ts`'s "is PURE" test — no seed, no match key, no stream position left to be about |
| 5 | `rpPmfForMatch — fixed-seed golden pmf (plan 06.1-02 Task 1)` | RETIRED WITH ITS SUBJECT | Replaced by `analyticPmf.test.ts`'s hand-computed pinned values (D-07's mitigation, stronger evidence than a fixed-seed golden file) |
| 6 | `rpPmfForMatch — per-bonus probabilities (plan 06.1-02 Task 1, F-06-1)` | CARRIED FORWARD | `analyticPmf.test.ts` / `.seasons.test.ts`'s `bonusProbabilities` assertions |
| 7 | `rpPmfForMatch — per-bonus array length matches bonusNames for every registered season (plan 06.1-02 Task 3)` | CARRIED FORWARD | `analyticPmf.seasons.test.ts`'s no-mass-folds / pmf-length sweep |
| 8 | `rpPmfForMatch — degenerate alliance (no rated teams, ALGO-08 empty edge)` | CARRIED FORWARD | `analyticPmf.universal.test.ts`'s new "a degenerate alliance ... ALGO-08 empty edge" test |
| 9 | `rpPmfForMatch — D-11's correlation claim, measured` | RETIRED WITH ITS SUBJECT | The correlation-consuming joint draw is gone; INVERTED into `analyticPmf.test.ts` Test 6 (the independence precondition now THROWS on a non-zero correlation instead of consuming it) |
| 10 | `rpPmfForMatch — 0 draws vs 2000 draws leaves score-side predictions unchanged (plan 03-03 must-have)` | RETIRED WITH ITS SUBJECT | Superseded by D-12's `level1Digest` gate — a strictly stronger claim (byte-identity across the WHOLE engine swap, not just a draw-count toggle) |
| 11 | `Prediction.redBonusRp / blueBonusRp (plan 06.1-02 Task 2, F-06-1)` | RETIRED WITH ITS SUBJECT | Its premise (VPR prices its own RP) no longer holds; replaced by `sigma1.test.ts`'s rewritten "positive control" test proving the field moved to level 2 (see below) |
| 12 | `pmfMean / pmfStandardDeviation` | CARRIED FORWARD | `analyticPmf.universal.test.ts`'s own `pmfMean / pmfStandardDeviation` describe block (fresh hand-computed cases, not round-tripped) |
| 13 | `mulberry32 / boxMullerPair / fnv1a32 — hand-rolled primitives` | RETIRED WITH ITS SUBJECT | The three primitives are deleted |
| 14 | `rpPmfForMatch — escalating Cholesky ridge (Rule 1 fix, plan 03-05)` | RETIRED WITH ITS SUBJECT | `CHOLESKY_RIDGES`/the ridge ladder is deleted |
| 15 | `rpPmfForMatch — cross-covariance Cauchy-Schwarz clamp (Rule 1 fix, plan 03-06)` | RETIRED WITH ITS SUBJECT | `clampCrossCovariance`/`CROSS_COVARIANCE_SAFETY_FACTOR` is deleted |

### VPR no longer prices its own RP — behavior assertion

`sigma1.test.ts`'s rewritten "positive control" test, for every `EVENT_TYPE_TIERS`-mapped eventType (`[0, 1, 2, 3, 4, 5, 100]`): `"redRpPmf" in prediction` is `false` and `"blueRpPmf" in prediction` is `false` for `vpr.predict()`'s own output, while `analyticRpPmf` (built from the SAME `redScore`/`blueScore`/`redScoreVarianceOwn`/`blueScoreVarianceOwn` that `predict()` returns) produces a non-empty pmf for both alliances, for every one of those seven event types — proving the field moved to level 2 rather than simply vanishing.

### The parameter-restore test still bites — demonstrated

With the raw-vs-restored comparison in `promotedOverrides.test.ts`'s rewritten test temporarily inverted (`toBe` instead of `not.toBe`):

```
AssertionError: expected 2000 to be +0
- 0
+ 2000
```

Reverted, confirmed green (`22/22` passed).

### Comment sweep — files changed and hits deliberately kept

**Files changed** (14): `packages/core/algorithms/types.ts`, `packages/core/rankingPoints/constants.ts`, `packages/core/rankingPoints/moments.ts`, `packages/core/rankingPoints/marginals.ts`, `packages/core/rankingPoints/marginals.test.ts`, `packages/core/rankingPoints/2017.ts`, `packages/core/rankingPoints/2018.ts`, `packages/core/rankingPoints/2019.ts`, `packages/harness/pageArtifacts.ts` (two sites), `packages/harness/publish.ts` (header), `packages/harness/rpConservativeBranch.ts`, `apps/web/src/lib/bonusRp.ts` (two sites), `apps/worker/src/bundleSmoke.ts`, `packages/core/rankingPoints/analyticPmf.ts` (own header, citing the deletion in past tense — not stale, intentional).

**Hits deliberately kept, with reason:**

| File | Kept text | Reason |
|---|---|---|
| `packages/core/algorithms/opr.ts` | `ml-matrix`'s `SingularValueDecomposition` | The surviving matrix-dependency use — unaffected by this plan |
| `packages/core/algorithms/simulation/rankSimulation.ts` | "Phase 8's rank-distribution Monte Carlo core", Cholesky decomposition | D-15's own rank-step Monte Carlo, deliberately KEPT — a DIFFERENT Monte Carlo (client-side rank simulation) this plan does not touch |
| `apps/web/src/lib/preScheduleResult.ts`, `simulationInputs.ts` | "no Monte Carlo — the draws were performed once...by `simulateRanks`" / "The number of Monte Carlo draws every simulation run performs" | Both about `simulateRanks`'s OWN kept rank-step Monte Carlo, not the deleted RP engine |
| `packages/harness/preSchedule.ts` | "A SECOND, distinct hash stream (\"baked\" salt) for the Monte Carlo draws" | Also `simulateRanks`'s own draw stream — correct as-is; file left untouched (was concurrently modified by another session at the time of the sweep, and the hit is a correct keep regardless) |
| `packages/harness/eventBootstrap.ts`/`.test.ts` | "Monte Carlo error" | STATISTICAL BOOTSTRAP Monte Carlo (resampling for a standard-error estimate) — unrelated to RP entirely, a false positive on the grep pattern |
| `packages/core/algorithms/sigma1/params.ts`/`.test.ts`, `scale.test.ts`, `packages/harness/legacyParams.ts`/`.test.ts`, `promote.ts`, `promoteOverride.test.ts`, `searchSpace.ts`/`.test.ts`, `searchWinner.ts`, `tune.ts`/`.test.ts`, `cli.ts` | `rpMonteCarloSeed`/`rpMonteCarloDraws` | The VERSIONED `Sigma1Params` fields — explicitly out of scope per this plan's own text; a versioned promoted parameter set with legacy migrations and committed artifacts behind it |
| `scripts/mockRankDistribution.ts`, `scripts/measureRpMeanDeficit.ts` | "Monte Carlo seed"/"4,000-draw Monte Carlo cost this phase deletes" | The former is `simulateRanks`'s own mock seed (unrelated); the latter is a historical/design note about THIS plan's own deletion, already phrased correctly |

### D-12 gate, second proof (end of Task 3, old engine gone from the tree entirely)

`npx vitest run packages/harness/level1Digest` — the digest byte-identity assertion (`re-runs on the recorded 2022 slice and reproduces the committed digest bitwise, for every published algorithm`) **passed**, meaning `pRedWin`, `redScore`, and `blueScore` are byte-identical across the bounded 2022 slice for every published algorithm (opr, epa, bpr), with `distribution.ts` absent from the tree entirely. This was reconfirmed multiple times throughout Task 3 (14:29, 14:32) before a later, unrelated interruption (documented below).

## Concurrent-session interference, observed and worked around

A second Claude session (quick task `260911-j2w`, "the event's competition week end to end") was actively editing the SAME checkout throughout this plan's execution, at times touching files this plan also needed (`types.ts`, `publish.ts`, `sigma1/index.ts`'s sibling test files, `apps/worker/src/bundleSmoke.ts`, `promotedOverrides.test.ts`). Handled per this project's established discipline (stage by explicit path, never `git add -A`):

- **Deferred, then completed once uncontended**: edits to `types.ts` (the `redRpPmf`/`redBonusRp` doc-comment repoint) and `publish.ts` (the header's stale Monte Carlo note) were held back while those files carried the other session's live, uncommitted `week`-field work, then completed after that session committed (`bfe42c31`).
- **Widened, not silenced**: `publish.test.ts`'s Test 8 needed a fixture change (two warm-up matches) because VPR's own RP path used to bypass the Swing-band-variance cold-start gate — a real, intentional consequence of this plan's own design (VPR becomes uniform with every other algorithm), not something the other session caused.
- **Not fixed, documented instead**: at the very end of this plan's work, a SEPARATE, still-uncommitted change in that other session (`packages/core/algorithms/epa.ts`, bumping EPA's version `8.0.0+baseline` -> `9.0.0+baseline` as part of its own "week-1 constant adoption" work) makes `level1Digest.test.ts`'s digest-reproduction assertion fail with:

  ```
  algorithm "epa" is now at version "9.0.0+baseline" but the committed baseline recorded "8.0.0+baseline" — the baseline predates this promotion.
  ```

  This is the gate's OWN designed version-mismatch guard firing correctly — not a cross-level RP leak. It is unrelated to this plan (EPA carries no RP model at all) and was confirmed unrelated by isolating the failure to exactly that one algorithm's version string. Every RP-relevant assertion this plan is responsible for (the digest computation itself, `analyticRpPmf`'s own tests, the structural sweep) was independently green multiple times earlier in this session, quoted above. This transient condition will resolve once the other session commits its own version bump and (separately, on its own timeline) that session's own gate obligations are met — it is not a defect in this plan's deliverable, and `data/baselines/level1-digest-2026-09.json` was not touched.

## Full suite and typecheck, final state

- `npx vitest run` from the repository root: **253 files, 4880 passed, 1 failed, 4 skipped** (the single failure is the transient EPA-version issue documented above; reconciles as `251` (this plan's own pre-edit baseline) `- 1` (deleted `sigma1/rp/distribution.test.ts`) `+ 2` (this plan's new `analyticPmf.test.ts`/`analyticPmf.seasons.test.ts`) `= 252` attributable to this plan, `+ 1` from the concurrent session's own untracked `epaWeekOne.test.ts` = the observed `253`).
- `pnpm typecheck`: **clean** (confirmed repeatedly throughout, including the final state).
- `npx tsc --noEmit -p apps/web/tsconfig.json`: **clean**.
- `npx tsc --noEmit -p apps/worker/tsconfig.json`: one pre-existing, already-COMMITTED error in `packages/corpus/db.ts` (a `URL` type incompatibility, part of the other session's committed `bfe42c31`), entirely unrelated to RP or `bundleSmoke.ts`; `bundleSmoke.ts` itself (this plan's own touched file) is confirmed clean in isolation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Duplicate test registration from cross-`.test.ts`-file import**
- **Found during:** Task 2, first full run after writing the six mechanism tests
- **Issue:** Importing `buildRuleModuleMoments` from `analyticPmf.seasons.test.ts` into `analyticPmf.test.ts` re-executed the seasons file's top-level `describe()` calls, doubling its 5 sweep tests to 10 and inflating the total count from 19 to 24.
- **Fix:** Extracted the shared fixture builder into a new, non-`*.test.ts` module (`analyticPmfFixtures.ts`), imported by both test files.
- **Files modified:** `analyticPmfFixtures.ts` (new), `analyticPmf.test.ts`, `analyticPmf.seasons.test.ts`
- **Verification:** `19/19` tests after the fix (previously `24`).
- **Committed in:** `3ad3e004` (Task 2 commit)

**2. [Rule 1 - Bug/test regression] `rankSimulation.test.ts`'s `moments()` fixture named 2022's threshold variables while pairing them with `RULE_2024`**
- **Found during:** Task 3, first run of `rankSimulation.test.ts` after swapping its pricing call
- **Issue:** The deleted engine's `evaluateBonusPredicates`/`evaluateClause` default a missing threshold variable to `0` via `?? 0`, silently tolerating the mismatch. `analyticRpPmf` requires a fitted marginal for every variable a bonus references and throws otherwise (`melodyBonus references threshold variable "noteCount" with no fitted marginal`) — a real, intentional strengthening (missing validation the old engine lacked), not a bug in the new engine.
- **Fix:** Renamed the fixture's three variable names to 2024's actual `THRESHOLD_VARIABLES` (`noteCount`, `endGameTotalStagePoints`, `onStageRobotCount`).
- **Files modified:** `packages/core/algorithms/simulation/rankSimulation.test.ts`
- **Verification:** `14/14` tests passed after the fix.
- **Committed in:** `5de615fc` (Task 3 commit)

**3. [Rule 1 - Bug/test regression] `sigma1.test.ts`/`innovationVariance.test.ts` asserted VPR's `predict()` still carries `redRpPmf`/`blueRpPmf` directly**
- **Found during:** Task 3, first full `packages/core/algorithms/sigma1` run after removing VPR's RP block
- **Issue:** Two tests — outside this plan's declared file list — asserted the now-intentionally-false claim that `predict()` emits RP fields directly.
- **Fix:** Rewrote both to assert the new, correct shape: `predict()` carries neither field (for `innovationVariance.test.ts`, plus confirmed `redScoreVarianceOwn`/`blueScoreVarianceOwn` are still returned); for `sigma1.test.ts`'s "positive control", additionally proved `analyticRpPmf` DOES attach a pmf for the same match, for every `EVENT_TYPE_TIERS`-mapped event type.
- **Files modified:** `packages/core/algorithms/sigma1/sigma1.test.ts`, `packages/core/algorithms/sigma1/innovationVariance.test.ts`
- **Verification:** `58/58` tests passed after the fix (both files together).
- **Committed in:** `5de615fc` (Task 3 commit)

**4. [Rule 1 - Bug/test regression] `publish.test.ts`'s Test 8 fixture relied on VPR's old RP path bypassing the Swing-band-variance cold-start gate**
- **Found during:** Task 3, full `packages/harness` run after removing VPR's RP block
- **Issue:** With only one played qualification match for the whole fixture, no team had the 2 played matches Swing Factor requires before a band exists — VPR used to sidestep this entirely by having its own independent RP computation. Now uniform with every other algorithm (this plan's own stated goal), the qualification row's `redBonusRp`/`blueBonusRp`/etc. were genuinely absent, failing the test's own non-vacuity assertion.
- **Fix:** Widened the fixture with two warm-up matches (earlier event, same roster, real scores) so the checked match's teams carry the required Swing history before it folds. The `F8`/`F9` cold-start gate itself is untouched, per this plan's explicit out-of-scope list.
- **Files modified:** `packages/harness/publish.test.ts`
- **Verification:** `5/5` tests passed after the fix.
- **Committed in:** `5de615fc` (Task 3 commit)

---

**Total deviations:** 4 auto-fixed (1 blocking, 3 bug/test-regression). **Impact on plan:** all four were necessary consequences of this plan's own intentional design (VPR becomes uniform with every other algorithm; missing threshold-variable validation is now a loud throw instead of a silent `?? 0`) surfacing in tests the plan's own file list did not anticipate. No scope creep — each fix is scoped exactly to the regression it addresses.

## Manual Verification Still Owed

None specific to this plan. The one open item from this session is external: re-running `npx vitest run packages/harness/level1Digest` once the concurrent session's own EPA version bump is committed (expected to pass cleanly at that point, since the digest computation itself was never in question).

## Next Phase Readiness

- **09-05** can add the three real `RpLayerConfig` branches (`winSource: "p-red-win"`, `tieModel: "discrete-margin"`, `marginal: "negative-binomial"`) at the exact points `assertSupportedRpLayerConfig` currently throws.
- **09-06** can measure those branches against 09-01's frozen `data/baselines/rp-calibration-2026-09.json`, then collapse `RpLayerConfig` to one hardcoded path per D-06's removal notice (recorded in `analyticPmf.ts`'s own header and beside the type declaration).
- **09-07** can consume `redBonusPmf`/`blueBonusPmf`/`outcome` (the exported halves) directly for its rank-simulation coupling fix, by the exact names this plan shipped them under.
- **09-08** has `bundleSmoke.ts`'s repointed RP half as the standing proof the closed-form path bundles and executes inside the Workers runtime.
- **09-09** can use the exported `convolvePmf` for its N-fold season-total convolution.
- **09-10** can re-prove D-12 at phase close against the same frozen baseline — expected to be unconditionally clean once the concurrent session's own version-bump work is committed.
- Nothing published was changed by this plan (no publish command, no R2 write, no D1 access — confirmed, this plan is entirely offline pipeline/library code).

---
*Phase: 09-analytic-ranking-points-browser-side-simulation*
*Completed: 2026-09-11*

## Self-Check: PASSED

- `packages/core/rankingPoints/analyticPmf.ts` — FOUND
- `packages/core/rankingPoints/analyticPmf.test.ts` — FOUND
- `packages/core/rankingPoints/analyticPmf.seasons.test.ts` — FOUND
- `packages/core/rankingPoints/analyticPmfFixtures.ts` — FOUND
- `packages/core/rankingPoints/analyticPmf.universal.test.ts` — FOUND
- `packages/core/rankingPoints/distribution.ts` — CONFIRMED DELETED
- `packages/core/algorithms/sigma1/rp/distribution.test.ts` — CONFIRMED DELETED
- Commit `9c372cd6` — FOUND in `git log --oneline --all`
- Commit `3ad3e004` — FOUND in `git log --oneline --all`
- Commit `5de615fc` — FOUND in `git log --oneline --all`
