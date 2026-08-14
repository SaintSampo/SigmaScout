---
phase: 02-prediction-models-epa-sigma1
reviewed: 2026-08-14T00:00:00Z
depth: standard
files_reviewed: 34
files_reviewed_list:
  - docs/models/epa-divergences.md
  - docs/models/sigma1-identifiability.md
  - package.json
  - packages/core/algorithms/breakdown/2022.ts
  - packages/core/algorithms/breakdown/2023.ts
  - packages/core/algorithms/breakdown/2024.ts
  - packages/core/algorithms/breakdown/2025.ts
  - packages/core/algorithms/breakdown/2026.ts
  - packages/core/algorithms/breakdown/breakdown.test.ts
  - packages/core/algorithms/breakdown/constants.ts
  - packages/core/algorithms/breakdown/fallback.ts
  - packages/core/algorithms/breakdown/index.ts
  - packages/core/algorithms/breakdown/reconciliation.test.ts
  - packages/core/algorithms/carryover.test.ts
  - packages/core/algorithms/carryover.ts
  - packages/core/algorithms/epa.test.ts
  - packages/core/algorithms/epa.ts
  - packages/core/algorithms/opr.ts
  - packages/core/algorithms/sigma1/consistency.test.ts
  - packages/core/algorithms/sigma1/consistency.ts
  - packages/core/algorithms/sigma1/covariance.test.ts
  - packages/core/algorithms/sigma1/covariance.ts
  - packages/core/algorithms/sigma1/index.ts
  - packages/core/algorithms/sigma1/kalman.test.ts
  - packages/core/algorithms/sigma1/kalman.ts
  - packages/core/algorithms/sigma1/linkFunctions.test.ts
  - packages/core/algorithms/sigma1/linkFunctions.ts
  - packages/core/algorithms/sigma1/sigma1.test.ts
  - packages/core/algorithms/types.ts
  - packages/core/scoring/expandingStats.test.ts
  - packages/core/scoring/expandingStats.ts
  - packages/corpus/db.ts
  - packages/harness/artifact.ts
  - packages/harness/cli.season-carry.test.ts
  - packages/harness/cli.ts
  - packages/harness/identifiability.ts
  - packages/harness/metricHistory.test.ts
  - packages/harness/metricHistory.ts
  - packages/harness/predictions.test.ts
  - packages/harness/predictions.ts
  - packages/harness/replay.multiAlgorithm.test.ts
  - packages/harness/replay.ts
  - packages/harness/report.test.ts
  - packages/harness/report.ts
  - packages/harness/score.ts
findings:
  critical: 1
  warning: 3
  info: 1
  total: 5
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-08-14
**Depth:** standard
**Files Reviewed:** 45 (listed above; some are documentation)
**Status:** issues_found

## Summary

Walk-forward leakage protection (`toLeakProofUpcoming`'s Proxy, `expandingStats.ts`'s Welford SD, the season-carry byte-identical-prefix regression in `cli.season-carry.test.ts`) is sound and well tested — no leakage path was found. The `foulsCommitted` cross-alliance attribution at `parse()` time (`breakdown/2022.ts` through `2026.ts`) is correct and consistent across every season, and is proven against the real corpus by `reconciliation.test.ts`. `sigma1`'s Kalman core, covariance, consistency, and link-function modules are internally consistent, degenerate-branch-safe, and well covered by synthetic-fixture tests.

However, the D-05 "no `score_breakdown`" fallback path — the exact cross-alliance attribution surface the review brief flagged — has a real, provable bug in **both** `epa.ts` and `sigma1/index.ts`: `predictedComponentTotals` is documented as "exactly the vector `predict()` would have shown for this alliance," but it is not. This causes `distributeResidual` to feed a fraction of an alliance's own actual score into that alliance's own `foulsCommitted` component (a quantity that has nothing to do with the alliance's own scoring), and to attribute the *opponent's* foul contribution to the alliance's own offensive components. This affects roughly 1,500 of ~104,000 matches (the corpus's has_score_breakdown=0 population, per `fallback.ts`'s own header) but is systematic, not random, and untested by the existing fallback fixtures (which are constructed so the bug cannot manifest). A secondary, related gap: `epa.ts`'s `update()` has no equivalent to `sigma1/index.ts`'s `assertFiniteComponents` second gate, so a non-finite `distributeResidual` output would silently poison EPA's EWMA state rather than throwing, unlike Sigma1's explicitly-documented defense for the identical scenario.

## Resolution Summary (2026-08-14, post-review follow-up)

User reviewed this report and chose "Fix CR-01 + WR-01, regenerate numbers." All findings below now have a per-finding `#### Resolution` subsection appended (original finding text is unchanged):

| Finding | Status | Commit(s) |
|---|---|---|
| CR-01 (critical) | Resolved | `dc6b841b` |
| WR-01 (warning) | Resolved | `c5975de6` |
| WR-02 (warning) | Resolved | (pre-existing — `epa_main.py` deleted before this session, never committed) |
| WR-03 (warning) | Resolved | `dc6b841b` (byproduct of CR-01's fix) |
| IN-01 (info) | Open, by design | No functional change required per the finding's own "Fix" — not touched this session |

The full-range head-to-head (`reports/full-v2/`) was regenerated after these fixes landed; see `02-06-SUMMARY.md`'s "Post-CR-01/WR-01 Regeneration" section for the before/after comparison.

## Critical Issues

### CR-01: D-05 fallback path misattributes `foulsCommitted` and the opponent's foul contribution when splitting an alliance's own score

**File:** `packages/core/algorithms/epa.ts:237-253` (`predictedComponentTotals`), `packages/core/algorithms/epa.ts:360-369` (`update`'s fallback call site)
**File:** `packages/core/algorithms/sigma1/index.ts:255-270` (`predictedComponentTotals`), `packages/core/algorithms/sigma1/index.ts:494-500` (`update`'s fallback call site)

**Issue:** Both `epa.ts` and `sigma1/index.ts` document `predictedComponentTotals` as producing "exactly the vector `predict()` would have shown for this alliance" (epa.ts:237-241) / "this alliance's own predicted component vector" (sigma1/index.ts:255). This is false, and the falseness is exactly the class of cross-alliance attribution bug the D-04 fix (commit `a0ec5d54`) was supposed to have fully closed out.

`predict()` in both files computes an alliance's own predicted score by **excluding** that alliance's own `foulsCommitted` mean and **including** the opponent's `foulsCommitted` mean instead (D-04's correct cross-attribution: `foulsCommitted` represents points this alliance's fouls cost the *opponent*, not part of this alliance's own score). But `predictedComponentTotals` sums **every** registered component — including `foulsCommitted` — over the alliance's own teams only, with no cross-alliance adjustment. That vector is then passed straight into `distributeResidual(result.redScore, predictedComponentTotals(...), seasonMap.components)`, where `seasonMap.components` also includes `FOULS_COMMITTED_COMPONENT`.

Two compounding errors result whenever a match has no `score_breakdown` (the D-05 fallback path, `usedFallback`/`redParsed === null`):

1. **The alliance's own actual score is split across a component that isn't part of its own score.** `distributeResidual` proportionally allocates part of `result.redScore` (the *actual* points red scored) into red's own `foulsCommitted` slot, in proportion to red's *own* previously-learned `foulsCommitted` mean. That mean is supposed to represent "points red's fouls cost blue" — a quantity with no relationship to how many points red itself scored. Folding a slice of red's own score into that estimate via `twoStageEwma`/`updateAllianceSum` pollutes it with unrelated signal every time this path fires.
2. **The opponent's foul contribution is never subtracted before the split, and is never attributed anywhere.** `result.redScore` (as TBA reports it) already includes points red *received* from blue's fouls. `predict()`'s own math acknowledges this (`redScore = redOffensiveTotal + blueComponents[FOULS_COMMITTED_COMPONENT]`), but the fallback split neither subtracts blue's estimated foul contribution from `result.redScore` before distributing, nor updates blue's `foulsCommitted` component at all. The result: whatever amount blue's fouls contributed to red's score gets misattributed, proportionally, into red's own *offensive* components (auto/teleop/endgame), inflating them.

This is confirmed as untested, not merely theoretical: `sigma1.test.ts`'s fallback fixture (`rawBreakdown2024Uniform`) is deliberately constructed so every component — including `foulsCommitted` — carries an identical value, which coincidentally matches `distributeResidual`'s own cold-start uniform-split branch and cannot expose non-uniform misattribution. `breakdown.test.ts`'s `epa.update — D-05 fallback fixture replay` only asserts that components "move" after a fallback match, never that they move to the *correct* value. `reconciliation.test.ts` only exercises the `parse()`-time attribution (which is correct), never the `distributeResidual` fallback path.

**Fix:** Build the fallback split from the alliance's own **offensive** total (excluding `FOULS_COMMITTED_COMPONENT`), against `result.redScore` net of the opponent's currently-predicted `foulsCommitted` contribution — mirroring `predict()`'s own formula exactly — and stop feeding any of an alliance's own score into its own `foulsCommitted` slot:

```ts
// epa.ts's update(), red side (blue side mirrors):
const redComponentsOnly = seasonMap.components.filter((c) => c !== FOULS_COMMITTED_COMPONENT);
const blueFoulsMean = sumComponentsAcrossTeam(state.teamComponents, blueTeams)[FOULS_COMMITTED_COMPONENT]?.mean ?? 0;
const redOffensiveObserved = distributeResidual(
  result.redScore - blueFoulsMean,
  predictedComponentTotals(state.teamComponents, redTeams),
  redComponentsOnly
);
// redObserved still needs a value for FOULS_COMMITTED_COMPONENT — since it is
// genuinely unobservable without a real breakdown (it's derived from the
// OPPONENT's own foulPoints field, which is equally absent), leave it out of
// applyComponentUpdate's observed set entirely for this match rather than
// synthesizing one, or carry the team's own current mean forward unchanged.
```

The same restructuring applies to `sigma1/index.ts`'s `update()`. Whichever concrete resolution is chosen (excluding `foulsCommitted` from the fallback update entirely vs. carrying it forward unchanged), the load-bearing fix is: never let a fallback-imputed share of an alliance's own score land in `FOULS_COMMITTED_COMPONENT`, and never let the opponent's foul contribution to `result.redScore` get attributed to this alliance's own non-foul components. Add a regression fixture with a **non-uniform** predicted vector (unlike the existing `rawBreakdown2024Uniform` fixture) and a nonzero prior `foulsCommitted` mean, asserting the post-fallback `foulsCommitted` value is unchanged (or handled per the chosen policy) rather than inflated by a share of the alliance's own score.

#### Resolution (2026-08-14)

**Status: Resolved.** Fixed in `dc6b841b` (`fix(02): D-05 fallback mirrors predict()'s cross-alliance foul attribution (CR-01)`).

Policy chosen: **carry `foulsCommitted` forward unchanged**, not exclude-entirely. Both `epa.ts` and `sigma1/index.ts` now build the fallback split from the alliance's own OFFENSIVE total only (`FOULS_COMMITTED_COMPONENT` excluded from `distributeResidual`'s `componentNames`), against the alliance's actual score net of the opponent's currently-predicted `foulsCommitted` contribution (`fallbackObserved`/mirroring `predict()`'s own D-04 formula exactly). `foulsCommitted` itself is fed back in as its own currently-predicted value (`foulsCommittedCarryForward`), which — because it is constructed to exactly match what the per-team update would independently compute as "no new information" — produces a Kalman/EWMA innovation of exactly zero: the belief/component MEAN is left byte-identical, never a coerced zero, never a share of the alliance's own score. (Sigma1's posterior VARIANCE still shrinks somewhat even at zero innovation — standard Kalman gain behavior, not specific to this fix — documented as an accepted, bounded approximation in `foulsCommittedCarryForward`'s doc comment; EPA carries no variance channel at all, so this does not apply there.)

The exclude-entirely alternative was rejected because it would leave `foulsCommitted` `undefined` for a team whose very first-ever match is a fallback match, violating D-05's existing "no component left undefined" invariant (pinned by `breakdown.test.ts`'s cold-start fallback test).

Regression coverage: non-uniform, nonzero-prior-`foulsCommitted` fixtures added for both EPA and Sigma1 in `test(02)` commit `a6fedb9c`, verified to fail against the pre-fix source (temporarily reverted, confirmed red, restored) before landing. The one pre-existing test that encoded the old buggy "every component moves" behavior (`breakdown.test.ts`) was corrected in the same `dc6b841b` commit.

A bug in the initial fix attempt was caught during self-review before commit: `sigma1/index.ts`'s fallback code used `seasonMap.components` (the season's raw component list) instead of the request-scoped `componentOrder` (which can be a state-provided override, e.g. in hand-built test fixtures) when computing `nonFoulsComponents` — corrected before landing.

## Warnings

### WR-01: `epa.ts`'s `update()` has no finite-value gate for the D-05 fallback path, unlike `sigma1/index.ts`'s documented second gate

**File:** `packages/core/algorithms/epa.ts:360-378`

**Issue:** `sigma1/index.ts:502-511` explicitly documents and implements a second finite-value check (`assertFiniteComponents`) specifically because "a value that survives parsing can still be produced by `distributeResidual`'s degenerate branch (e.g. a non-finite `result.redScore`/`blueScore` from an upstream corpus anomaly) and bypass it entirely." The same reasoning applies identically to `epa.ts`: `redObserved`/`blueObserved` (from `parseBreakdown` or the `distributeResidual` fallback) are passed directly into `applyComponentUpdate` → `twoStageEwma` with no finite check at all. A single non-finite value entering `twoStageEwma`'s EWMA blend would silently propagate `NaN` forward through every subsequent match for that team, for the rest of the season — directly contradicting this project's own stated convention ("never a silent drop, never a coerced zero... throwing is preferred over emitting a plausible-looking wrong number") which `sigma1/index.ts` explicitly upholds but `epa.ts` does not.

**Fix:** Add the same `assertFiniteComponents`-style check to `epa.ts`'s `update()`, immediately after computing `redObserved`/`blueObserved` and before calling `applyComponentUpdate`:

```ts
assertFiniteComponents(redObserved, `red observation, match ${result.matchKey}`);
assertFiniteComponents(blueObserved, `blue observation, match ${result.matchKey}`);
```

(Either duplicate the small helper or hoist it into a shared location both `epa.ts` and `sigma1/index.ts` import from, to avoid the two copies drifting.)

#### Resolution (2026-08-14)

**Status: Resolved.** Fixed in `c5975de6` (`fix(02): finite-value gate on EPA observations (WR-01)`).

`assertFiniteComponents` was hoisted into `breakdown/constants.ts` (a dependency-free leaf both `epa.ts` and `sigma1/index.ts` already import from, transitively via `breakdown/index.ts`) rather than duplicated — the review's suggested resolution. `epa.ts`'s `update()` now calls it on `redObserved`/`blueObserved` immediately before `applyComponentUpdate`, mirroring `sigma1/index.ts`'s existing call site exactly. `sigma1/index.ts`'s own local copy of the function was removed in favor of importing the hoisted one, so there is now exactly one implementation instead of two that could drift.

### WR-02: A verbatim copy of Statbotics' own `EPA` model source sits untracked in the repository root, contradicting the documented, rejected option in `docs/models/sigma1-identifiability.md`

**File:** `epa_main.py` (repository root, untracked per `git status`)

**Issue:** This file is Statbotics' actual Python `EPA` class (`from src.models.epa.math import EPARating`, `from src.tba.breakdown import all_keys`, etc.) — not a SigmaScout artifact. `docs/models/sigma1-identifiability.md` Section 7 explicitly records that "Running Statbotics' own Python model against this project's corpus" was **considered and rejected**, citing the clean-slate mandate (REBUILD_SPEC.md: no consultation or porting of pre-v3 implementations — and while Statbotics is "a different project's codebase," the document itself treats running its actual model code as something this project decided not to do). Having this file present in the working tree — even untracked — is a real, provable process/hygiene risk: it is one `git add -A` away from being committed, and its mere presence in a working session raises the same provenance concern the rejected-option writeup was trying to close out.

**Fix:** Delete `epa_main.py` from the working tree (or move it well outside the repository if it is needed for manual, external reference), and consider adding a `.gitignore` entry or a pre-commit check if this kind of external reference file is likely to recur during research sessions.

#### Resolution (2026-08-14)

**Status: Resolved.** `epa_main.py` was deleted from the working tree at the user's explicit instruction before this session's work began. It was never committed (confirmed via `git log --all -- epa_main.py`, no results), so no history rewrite was needed. No `.gitignore` entry or pre-commit check was added this session — left to a future decision if this kind of external reference file recurs.

### WR-03: `predictedComponentTotals`'s doc comments assert a claim the implementation does not deliver

**File:** `packages/core/algorithms/epa.ts:237-241`
**File:** `packages/core/algorithms/sigma1/index.ts:255`

**Issue:** Both functions' doc comments state they return "exactly the vector `predict()` would have shown for this alliance." As CR-01 demonstrates, this is not true for either the total (`predict()`'s `redScore`/`blueScore` are cross-attributed; `predictedComponentTotals`'s implicit total is not) or in any single-line summary that would let a future maintainer trust the claim without re-deriving it themselves. Even independent of the CR-01 fix, this comment should be corrected to accurately describe what the function returns (the alliance's own per-team component sum, including its own `foulsCommitted` figure, which is *not* interchangeable with `predict()`'s notion of "this alliance's predicted score").

**Fix:** Once CR-01 is resolved, update both doc comments to describe the actual (corrected) contract precisely, rather than asserting equivalence with `predict()`'s output.

#### Resolution (2026-08-14)

**Status: Resolved**, closed as a byproduct of CR-01's fix in `dc6b841b`. Both `predictedComponentTotals` doc comments now explicitly state they are NOT interchangeable with `predict()`'s own cross-attributed score, describe the actual per-team-sum-including-`foulsCommitted` contract, and point callers needing `predict()`'s cross-attributed total at the new `fallbackObserved` helper.

## Info

### IN-01: `RunSeasonsSidecarConfig`'s `boundary.fromSeason` is unused by every current `carrySeason` implementation

**File:** `packages/harness/cli.ts:415-419`

**Issue:** `runSeasons` constructs `boundary.fromSeason = season - 1` for every season boundary, but neither `epa.ts`'s nor `sigma1/index.ts`'s `carrySeason` reads `boundary.fromSeason` (both only inspect `boundary.toSeason`/`boundary.isColdStart`). This means a gap year in `seasons` (e.g. `--seasons` effectively skipping a year, or a future caller passing a non-contiguous `seasons` array) would silently compute an incorrect `fromSeason` without affecting any current behavior — currently harmless, but a latent trap if `carrySeason` is ever extended to use `fromSeason` (e.g. to decide how many boundaries were skipped) without also auditing this call site's assumption that `seasons` is always contiguous.

**Fix:** No functional change required now. If `carrySeason` is ever extended to consume `fromSeason`, either derive it from the actual previous element of `seasons` (not `season - 1`) or add an explicit contiguity assertion in `runSeasons`.

---

_Reviewed: 2026-08-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
