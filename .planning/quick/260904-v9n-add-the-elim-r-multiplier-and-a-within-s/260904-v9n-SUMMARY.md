---
phase: quick-260904-v9n
plan: "01"
subsystem: sigma1-prediction-model
tags: [vpr, sigma1, elimination-matches, kalman-filter, ewma, search-space, state-persistence]

requires:
  - phase: quick-260904-oiu
    provides: accuracy-primary tuning objective (winner accuracy primary, Brier secondary/guardrail) that elimObservationNoiseMultiplier will be scored under in the next re-tune
provides:
  - "packages/core/algorithms/sigma1/elim.ts: isElimination (the one shared elim predicate), elimNoiseFactor (ELIM-R), and emptyElimScoreOffset/foldElimScoreOffset/elimScoreOffsetFor (ELIM-OFF)"
  - "Sigma1Params gains three new schema-defaulted fields: elimObservationNoiseMultiplier (searchable), elimScoreOffsetEnabled, elimScoreOffsetEwmaAlpha (both search-excluded)"
  - "Sigma1State.elimScoreOffset — a league-level EWMA accumulator, persisted through stateSnapshot.ts (shape 7 -> 8)"
  - "crossAttributedAllianceScores — the one shared cross-attributed score expression now used by both predict()'s published score and update()'s ELIM-OFF residual fold"
affects: [the next rolling-origin VPR re-tune (elimObservationNoiseMultiplier is now searchable), any future decision to enable elimScoreOffsetEnabled in a promoted set, the live Worker's D1 state (needs a re-seed once STATE_SNAPSHOT_SHAPE_VERSION 8 ships)]

actuals:
  tokens: 18325
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "One shared eligibility predicate (isElimination) that two independent mechanisms both key off, so they can never disagree about what an elimination match is — the same discipline isRpEligibleEventType already established for RP"
    - "Provably-inert-when-off mechanism: an exact IEEE-754 1 (multiplier) or exact 0 (offset) on the disabled/default branch, verified by byte-identical prediction-stream tests rather than asserted"
    - "One shared derivation, two call sites: crossAttributedAllianceScores extracted so predict()'s published score and update()'s learned-offset residual can never silently diverge into two expressions of the same quantity"

key-files:
  created:
    - packages/core/algorithms/sigma1/elim.ts
    - packages/core/algorithms/sigma1/elim.test.ts
  modified:
    - packages/core/algorithms/sigma1/params.ts
    - packages/core/algorithms/sigma1/params.test.ts
    - packages/core/algorithms/sigma1/index.ts
    - packages/core/algorithms/sigma1/sigma1.test.ts
    - packages/harness/searchSpace.ts
    - packages/harness/searchSpace.test.ts
    - packages/harness/stateSnapshot.ts
    - packages/harness/stateSnapshot.test.ts
    - packages/harness/promoteOverride.test.ts

key-decisions:
  - "elimObservationNoiseMultiplier composes with FALLBACK_NOISE_MULTIPLIER by multiplication (D-4), never replacing it, and never rescales the innovation-based variance/covariance estimators (D-5) to avoid geometric compounding across an elim bracket"
  - "The elim score offset is a LEAGUE-LEVEL, symmetric additive correction — deliberately margin-neutral by construction (D-13), so it can only ever affect displayed elim scores, never pRedWin/winner accuracy/Brier"
  - "SIGMA1_CODE_VERSION is NOT bumped (D-3): all three new fields carry Zod .default(...) so every committed vpr@8.0.0+*.json file still parses, and both mechanisms are provably inert at their defaults, so neither of the two triggers every prior bump fired on (shape change / observable output change) applies"
  - "STATE_SNAPSHOT_SHAPE_VERSION IS bumped (7 -> 8) despite the mechanism being inert — precautionary, since a stale shape-7 row would deserialize the accumulator as undefined the moment the flag is ever flipped, and readScopedState filters by algorithm_id only, never by version"

patterns-established:
  - "A single-file leaf (elim.ts) hosting two independent, individually-inert elimination-match mechanisms behind one shared predicate, following adaptation.ts's established 'provably inert when off' template"

requirements-completed: [ELIM-R, ELIM-OFF, ELIM-WIRE]

duration: ~2h
completed: 2026-09-04
status: complete
---

# Quick Task 260904-v9n: Elim observation-noise multiplier and within-season elim score offset Summary

Registered two independent, individually-inert elimination-match knobs in VPR — a searchable
Kalman measurement-noise multiplier for elim observations (ELIM-R) and a league-level, margin-
neutral learned score offset for displayed elim predictions (ELIM-OFF) — both provably inert at
their defaults and both wired end to end, with no tuning, backtest, promotion, or publish
performed.

## Performance

- **Duration:** ~2h
- **Completed:** 2026-09-04
- **Tasks:** 3/3 completed
- **Files modified:** 11 (2 created, 9 modified)

## Accomplishments

- **ELIM-R: the elim observation-noise multiplier, one path, proven wired.**
  `packages/core/algorithms/sigma1/elim.ts` exports `isElimination(compLevel)` — the ONE shared
  predicate both mechanisms key off — and `elimNoiseFactor(compLevel, params)`, which returns
  EXACTLY `1` for `compLevel === "qm"` and `params.elimObservationNoiseMultiplier` verbatim for
  every elimination level. `Sigma1Params` gains `elimObservationNoiseMultiplier` (default `1`,
  schema `.finite().positive().default(1)`). `update()` composes the factor into the existing
  `measurementNoiseMultiplier` by multiplication alongside `FALLBACK_NOISE_MULTIPLIER` (D-4) —
  the innovation-based estimators (`varianceSample`, `covarianceSample`) deliberately do NOT see
  it (D-5), and the normalized-innovation denominator (`pooledVariance`) DOES (D-6). Registered
  searchable in `searchSpace.ts` at `[0.25, 16]` (log scale), straddling 1 in both directions
  since the motivating measurement (VPR's elim winner accuracy trailing quals while OPR gains at
  elims every season) is consistent with either "the model over-trusts elim observations" or
  "the model under-uses late-event information." `elim.test.ts`/`params.test.ts` prove: exact-1
  on `qm` for every parameter value, verbatim multiplier on elim levels, byte-identical streams
  at default, a differing stream at `multiplier: 8`, a byte-identical QUALS-ONLY control at the
  same multiplier (proving the gate is on comp level, not applied everywhere), and a quantitative
  composition proof (posterior variance after one fallback-elim update matches
  `FALLBACK_NOISE_MULTIPLIER x elimObservationNoiseMultiplier`, not either alone).
- **ELIM-OFF: the within-season learned elim score offset, league-level and margin-neutral.**
  `elim.ts` gains `ElimScoreOffset` (`{ value, count }`), `emptyElimScoreOffset()`,
  `foldElimScoreOffset` (an EWMA of the RAW residual, D-7 — folding the offset-corrected residual
  instead would make the accumulator converge to zero and the correction evaporate), and
  `elimScoreOffsetFor` (returns exactly `0` unless both `elimScoreOffsetEnabled` is true AND the
  match is an elimination, D-10). `Sigma1Params` gains `elimScoreOffsetEnabled` (default `false`)
  and `elimScoreOffsetEwmaAlpha` (default `0.05`, roughly a 13-observation half-life). A new
  top-level `Sigma1State.elimScoreOffset` lives beside `allianceScoreStats`, seeded in
  `initState`, and RESET at every `carrySeason` boundary (D-11 — the opposite choice from
  `allianceScoreStats`, since this is a points-scale bias under one season's rules, not a slowly
  moving scale). `crossAttributedAllianceScores` (D-8) was extracted as the ONE cross-attributed
  score expression, now shared by exactly two call sites: `predict()`'s published score and
  `update()`'s offset residual fold, built from the PRE-fold state (leak-free) and guarded by the
  same non-empty-update-team predicate `applyAllianceUpdate`'s own early return already uses
  (D-9). `params.test.ts` proves: cold start, the EWMA fold, non-finite refusal, inertness of BOTH
  the output AND the state at default (even with `elimScoreOffsetEwmaAlpha` perturbed to an
  extreme), wiring when enabled (offset value/count move, later elim predictions rise), leak-
  freeness (the first elim match of a cold-started replay predicts at offset exactly 0), margin
  neutrality (D-13 — asserted with a floating-point tolerance, never exact equality, since the
  cancellation is analytic, not bitwise), a season-boundary reset even after learning a nonzero
  value, and a byte-identical quals-only control.
- **ELIM-WIRE: persistence, pinned counts, and the recorded non-bump.** `elimScoreOffset` is
  carried through `stateSnapshot.ts`'s `SerializedSigma1League`/`serializeSigma1State`/
  `deserializeSigma1State`, with `STATE_SNAPSHOT_SHAPE_VERSION` bumped 7 -> 8 (precautionary — the
  field is default-inert today, but a stale shape-7 row would deserialize the accumulator as
  `undefined` the instant the flag is ever flipped). `searchSpace.test.ts`'s three pinned literals
  moved to 16 searchable / 13 exclusions / 29 param keys — the first widening of the searchable
  set since `SIGMA1_CODE_VERSION` 5.0.0. `params.ts`'s version-history block gains a full D-3
  NON-BUMP entry: both mechanisms are schema-defaulted (no committed file becomes unparseable)
  and provably inert at their defaults (no observable output moves), so neither of the two
  triggers every prior bump fired on applies — `digest.test.ts`'s bitwise reproduction of all four
  committed `vpr@8.0.0+*.json` files, run on the CORPUS-BACKED path (not the skip path), is the
  evidence. `npx tsc --noEmit` is clean and the full repo-root `npx vitest run` (176 files) is
  green: 3211 passed, 4 pre-existing skips, 0 failed.

## Scope discipline

No tuning run, backtest, promotion, publish, or network call was performed — verified via
`git diff --stat`, which touches only 11 files across the three commits (the 8 named in
`files_modified` plus 3 Rule-3 deviations below). None of `data/algorithm-versions/`,
`packages/core/algorithms/sigma1/fixtures/`, `reports/`, or `docs/` were touched, and no committed
digest or version file was edited.

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run` (full repo root, 176 test files) — 3211 passed, 4 skipped (pre-existing,
  `displayOnly.test.ts`'s superseded assertions), 0 failed.
- `npx vitest run packages/harness/digest.test.ts` — 8/8 passed, corpus-backed (real per-test
  durations of ~220-280ms, not the skip path); all four committed `vpr@8.0.0+*.json` files
  reproduce their prediction-stream digests and headline metrics bitwise.
- `npx vitest run packages/harness/stateSnapshot.test.ts packages/harness/searchSpace.test.ts packages/core/algorithms/sigma1/displayOnly.test.ts` — all passed; `displayOnly.test.ts` passed unedited.
- `git diff --stat` across all three commits — 11 files, none in the prohibited paths.

## Task Commits

1. **Task 1: End-to-end elim observation-noise multiplier — one path, proven inert and proven wired** - `f58bc540` (feat)
2. **Task 2: Within-season learned elim score offset — league-level, leak-free, margin-neutral** - `d2d68706` (feat)
3. **Task 3: Persistence, pinned counts, the recorded non-bump, and the repo-wide gates** - `0a73bbad` (feat)

## Files Created/Modified

- `packages/core/algorithms/sigma1/elim.ts` - New leaf: isElimination, elimNoiseFactor, ElimScoreOffset + its cold-start/fold/read
- `packages/core/algorithms/sigma1/elim.test.ts` - Unit coverage for both mechanisms' leaves
- `packages/core/algorithms/sigma1/params.ts` - Three new fields, defaults, schema entries, and the D-3 non-bump record
- `packages/core/algorithms/sigma1/params.test.ts` - Schema/identity/wired/composition/margin-neutrality/leak-freeness/reset tests
- `packages/core/algorithms/sigma1/index.ts` - Sigma1State.elimScoreOffset, crossAttributedAllianceScores, update()/predict()/carrySeason wiring
- `packages/core/algorithms/sigma1/sigma1.test.ts` - Two hand-built Sigma1State fixtures updated with the new required field (Rule 3)
- `packages/harness/searchSpace.ts` - One new bound, two new exclusions with reasons
- `packages/harness/searchSpace.test.ts` - Pinned counts updated to 16/13/29 (Rule 3, this task's own field additions)
- `packages/harness/stateSnapshot.ts` - elimScoreOffset carried through serialize/deserialize, shape version 7 -> 8
- `packages/harness/stateSnapshot.test.ts` - Pinned shape-version literal and stale-shape list updated to 8 and 3-7 (Rule 3)
- `packages/harness/promoteOverride.test.ts` - Pinned boolean-key list updated to include elimScoreOffsetEnabled, plus a dedicated override test (Rule 3)

## Decisions Made

See `key-decisions` in frontmatter above (D-3, D-4, D-5, D-6, D-13 as applied to this task's two
mechanisms).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] sigma1.test.ts's hand-built Sigma1State fixtures missing elimScoreOffset**
- **Found during:** Task 2 (adding Sigma1State.elimScoreOffset made the field required)
- **Issue:** Two hand-built `Sigma1State` object literals in `sigma1.test.ts` (used to test
  never-blank swing behavior) predate the new required field, breaking `tsc --noEmit`.
- **Fix:** Added `elimScoreOffset: emptyElimScoreOffset()` to both, plus the import.
- **Files modified:** packages/core/algorithms/sigma1/sigma1.test.ts
- **Verification:** `npx tsc --noEmit` clean; sigma1.test.ts's own suite passes unchanged otherwise.
- **Committed in:** d2d68706 (Task 2 commit)

**2. [Rule 3 - Blocking] stateSnapshot.test.ts's pinned shape-version literal**
- **Found during:** Task 3 (STATE_SNAPSHOT_SHAPE_VERSION bump 7 -> 8)
- **Issue:** A test pinned `STATE_SNAPSHOT_SHAPE_VERSION` to the literal `7` and asserted only
  shapes 3-6 throw as stale — both now stale by this task's own bump.
- **Fix:** Updated the literal to `8` and the stale-shape list to `[3, 4, 5, 6, 7]`, extending the
  test's own explanatory comment with shape 7's specific failure mode (undefined accumulator).
- **Files modified:** packages/harness/stateSnapshot.test.ts
- **Verification:** `npx vitest run packages/harness/stateSnapshot.test.ts` passes.
- **Committed in:** 0a73bbad (Task 3 commit)

**3. [Rule 3 - Blocking] promoteOverride.test.ts's pinned boolean-parameter key list**
- **Found during:** Task 3 (full repo-root `npx vitest run`)
- **Issue:** A test asserted `SIGMA1_PARAM_KEYS.filter(boolean) === ["adaptationEnabled"]`, with
  its own comment naming this exact future case ("if a second one is added, this assertion
  fails"). `elimScoreOffsetEnabled` is that second boolean parameter.
- **Fix:** Updated the pinned list to `["adaptationEnabled", "elimScoreOffsetEnabled"]` and added
  a dedicated override test for the new field. Verified `applyParamOverrides`/`parseParamOverrides`
  in `promote.ts` needed no code change — they already read boolean-ness generically off
  `DEFAULT_SIGMA1_PARAMS`'s runtime types (`typeof currentValue === "boolean"`), exactly as that
  function's own doc comment claims.
- **Files modified:** packages/harness/promoteOverride.test.ts
- **Verification:** `npx vitest run packages/harness/promoteOverride.test.ts` passes (55/55).
- **Committed in:** 0a73bbad (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 3 — blocking fixes caused directly by this task's own
required-field/count additions elsewhere in the codebase)
**Impact on plan:** All three fixes were necessary to keep `tsc --noEmit` and the full test suite
green; none touched production behavior beyond updating stale pinned assertions and fixture
literals. No scope creep — every fix is a direct, mechanical consequence of the fields this plan
itself added.

## Issues Encountered

None beyond the three deviations above.

## User Setup Required

None - no external service configuration required. Note for the developer (per this plan's
`<output>` spec): `STATE_SNAPSHOT_SHAPE_VERSION` moved to 8, so the live Worker needs a re-seed
from a fresh publish run before it will load state again — an operational step, not part of this
task, and one that must be run from the main context (executor subagents have no network).

## Next Phase Readiness

Two follow-ups this task deliberately does NOT do, both named here for the developer:

1. **Tune `elimObservationNoiseMultiplier`** in the next rolling-origin re-tune — it is now
   searchable at `[0.25, 16]` (log scale) and will be scored under the accuracy-primary objective
   (quick task 260904-oiu).
2. **Decide whether to enable `elimScoreOffsetEnabled`** for honest published elim scores. Note
   that enabling EITHER mechanism's non-default value in a promoted parameter set is a real model
   change and earns its own `SIGMA1_CODE_VERSION` bump under `params.ts`'s normal rules (D-3) —
   the non-bump recorded by this task applies only while both remain at their inert defaults.

No blockers for other in-flight work.

---
*Phase: quick-260904-v9n*
*Completed: 2026-09-04*
