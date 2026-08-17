---
phase: 03-tuning-ranking-points-versioning
reviewed: 2026-08-17T00:00:00Z
depth: standard
files_reviewed: 44
files_reviewed_list:
  - .github/workflows/test.yml
  - .gitignore
  - package.json
  - packages/core/algorithms/breakdown/breakdown.test.ts
  - packages/core/algorithms/carryover.ts
  - packages/core/algorithms/epa.test.ts
  - packages/core/algorithms/epa.ts
  - packages/core/algorithms/opr.test.ts
  - packages/core/algorithms/opr.ts
  - packages/core/algorithms/sigma1/adaptation.test.ts
  - packages/core/algorithms/sigma1/adaptation.ts
  - packages/core/algorithms/sigma1/carryover.test.ts
  - packages/core/algorithms/sigma1/carryover.ts
  - packages/core/algorithms/sigma1/consistency.ts
  - packages/core/algorithms/sigma1/covariance.ts
  - packages/core/algorithms/sigma1/index.ts
  - packages/core/algorithms/sigma1/params.test.ts
  - packages/core/algorithms/sigma1/params.ts
  - packages/core/algorithms/sigma1/rp/2022.ts
  - packages/core/algorithms/sigma1/rp/2023.ts
  - packages/core/algorithms/sigma1/rp/2024.ts
  - packages/core/algorithms/sigma1/rp/2025.ts
  - packages/core/algorithms/sigma1/rp/2026.ts
  - packages/core/algorithms/sigma1/rp/constants.ts
  - packages/core/algorithms/sigma1/rp/distribution.test.ts
  - packages/core/algorithms/sigma1/rp/distribution.ts
  - packages/core/algorithms/sigma1/rp/reconciliation.test.ts
  - packages/core/algorithms/sigma1/rp/rules.test.ts
  - packages/core/algorithms/sigma1/rp/rules.ts
  - packages/core/algorithms/sigma1/rp/state.test.ts
  - packages/core/algorithms/sigma1/rp/state.ts
  - packages/core/algorithms/sigma1/sigma1.test.ts
  - packages/core/algorithms/types.ts
  - packages/corpus/db.test.ts
  - packages/corpus/db.ts
  - packages/harness/artifact.test.ts
  - packages/harness/artifact.ts
  - packages/harness/cli.ts
  - packages/harness/digest.test.ts
  - packages/harness/fixtures/extract-digest-slice.ts
  - packages/harness/metricHistory.test.ts
  - packages/harness/predictions.test.ts
  - packages/harness/predictions.ts
  - packages/harness/promote.ts
  - packages/harness/replay.multiAlgorithm.test.ts
  - packages/harness/replay.test.ts
  - packages/harness/report.test.ts
  - packages/harness/searchSpace.test.ts
  - packages/harness/searchSpace.ts
  - packages/harness/tune.test.ts
  - packages/harness/tune.ts
findings:
  critical: 1
  warning: 2
  info: 2
  total: 5
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-08-17
**Depth:** standard
**Files Reviewed:** 44 (per `git diff --stat` against `fb10c90158c832e66c13095558bdfb091709aa5a^`)
**Status:** issues_found

## Summary

Phase 3 adds Sigma1 hyperparameterization (`params.ts`), per-season ranking-point rule modules (`rp/2022.ts`–`rp/2026.ts`), the RP joint Monte Carlo distribution (`rp/distribution.ts`), online Kalman noise adaptation (`adaptation.ts`), a two-stage hyperparameter search (`tune.ts`/`searchSpace.ts`), version promotion (`promote.ts`), and a CI reproducibility gate (`digest.test.ts`). The holdout-blindness machinery in `tune.ts` (three independent gates: pre-read season check, `seasonSplit` re-check, and a post-scoring `assertNoHoldoutLeak` over every produced slice) is sound and exercised by real tests — I traced every path a tune-stage candidate's data can take and found no way for 2025/2026 to reach a training decision; `boundedSeasonStream` also hardcodes `includeOffseason: false`, so the bug below cannot reach the tuner. Determinism is likewise solid: the RP Monte Carlo draw is seeded per-match (FNV-1a hash of `matchKey` XORed with `params.rpMonteCarloSeed`), the promotion digest excludes timestamps, and every EWMA/covariance fold iterates a fixed, pre-declared `componentOrder`/`variableNames` array rather than `Object.keys` on a freshly built object.

The one significant defect found is a real, reachable crash: Sigma1's live `update()`/`predict()` path never guards the RP subsystem against an unmapped/offseason TBA `event_type`, even though the RP rule modules are explicitly designed to throw on exactly that input, and even though two officially-supported harness invocations (`--include-offseason`, and single-event mode on an offseason event) can reach it with a real corpus. See CR-01 below.

## Critical Issues

### CR-01: Sigma1's live update()/predict() RP path crashes on any offseason (or otherwise-unmapped) `event_type`, via unconditional `eventTierFor()` calls that the rest of the codebase treats as an exclusion the CALLER is responsible for applying

**File:** `packages/core/algorithms/sigma1/index.ts:800-807` (the RP fold branch of `update()`) and `packages/core/algorithms/sigma1/index.ts:671-685` (`predict()`'s unconditional `rpPmfForMatch` call)
**Also implicated:** `packages/core/algorithms/sigma1/rp/constants.ts:71-79` (`eventTierFor` throws on any unmapped value, including TBA's `99` = Offseason, by explicit design), every `rp/{2022..2026}.ts`'s `parse()`/`predictThresholds()` (each calls `eventTierFor(eventType)` as its first statement, unconditionally), `packages/harness/cli.ts:614-707` (`runEventMode`, the single-event `--event` path) and `packages/harness/cli.ts:742` (the `--include-offseason` flag wired straight into `runSeasonsMode`/`buildSeasonStream`).

**Issue:**

`rp/constants.ts`'s `eventTierFor` is documented as deliberately throwing rather than silently defaulting for any `event_type` outside `{0,1,2,3,5,100}` — offseason (`99`) is named explicitly as excluded "from every RP population." Every test suite that reads real corpus data honors this by filtering `e.is_offseason = 0`/`m.comp_level = 'qm'` before ever calling into an RP rule module: `rp/reconciliation.test.ts`'s `sampleQualMatches`, `promote.ts`'s `resolveSliceEventKeys`/`selectMatchesChronological(..., { excludeOffseason: true })`, and `tune.ts`'s `boundedSeasonStream` (which hardcodes `buildSeasonStream(db, season, { includeOffseason: false })`, independent of any CLI flag).

`sigma1/index.ts`'s live `update()` and `predict()` — the functions every other harness/worker code path actually calls in production — apply **no such guard**:

- In `update()`, the RP fold branch is:
  ```ts
  if (usedFallback) {
    rpSkippedMatchCount += 1;
  } else {
    const rawJson: unknown = JSON.parse(result.scoreBreakdownRaw!);
    const redRpParsed: RpParsedResult = ruleModule.parse(rawJson, "red", result.eventType);
    const blueRpParsed: RpParsedResult = ruleModule.parse(rawJson, "blue", result.eventType);
    ...
  ```
  This runs for **every** match that has a score breakdown, regardless of `compLevel` or `eventType`. Every season module's `parse()` (e.g. `rp2024.parse`, `rp/2024.ts:120`) calls `eventTierFor(eventType)` as its first statement. For a match whose event is offseason (`event_type = 99`), this throws — for a qualification match, an elimination match, any compLevel — as soon as it has a `score_breakdown_raw`.
- In `predict()`, `rpPmfForMatch` is called unconditionally for every match; it only short-circuits on `compLevel !== "qm"`, not on `eventType`. For a `qm` match with `params.rpMonteCarloDraws > 0` (the shipped default is 2000, and `promote.ts` always restores this before writing a version), the per-draw loop calls `ruleModule.predictThresholds(values, eventType)`, which again starts with `eventTierFor(eventType)` and throws.

Two **officially documented, supported** invocations reach this with real data and would crash the whole run partway through, aborting every season/algorithm in the batch, not just the offending match:

1. `pnpm harness --season 2024 --algorithm sigma1 --include-offseason` — `--include-offseason` is a real, advertised CLI flag (`cli.ts:730`, threaded into `buildSeasonStream`); the moment the season's offseason matches are folded into the shared stream, the first offseason match with a score breakdown throws inside `update()`.
2. `pnpm harness --event <offseasonEventKey> --algorithm sigma1` — `runEventMode` (`cli.ts:614-707`) calls `selectMatchesChronological(db, { eventKey })` with **no** `excludeOffseason` option at all, and applies no offseason filtering anywhere in the function. Running the single-event path against any offseason event key (a common, real category of FRC event — off-season regionals, week-0 scrimmages, remote events) crashes immediately.

The tuner (`tune.ts`) and the promotion/reproducibility paths (`promote.ts`, `digest.test.ts`) are unaffected — they independently hardcode offseason exclusion — so this is not a holdout-leak or determinism defect, but it is a real, reachable, unhandled-exception crash in a documented production code path, and no test in this phase (or the existing suite) exercises `update()`/`predict()` with a non-mapped `eventType`, which is why it went uncaught.

**Fix:** Give Sigma1's RP subsystem the same structural exclusion the rest of the codebase already gives it, rather than relying on every caller to remember to filter upstream. The minimal, least-arbitrary fix is to make `update()`'s RP fold and `predict()`'s RP pmf step both no-op (mirroring the existing `usedFallback`/`compLevel !== "qm"` skip pattern) for a match whose `eventType` is not a `eventTierFor`-mapped value, e.g.:

```ts
// rp/constants.ts
export function isRpEligibleEventType(eventType: number): boolean {
  return EVENT_TYPE_TIERS[eventType] !== undefined;
}
```

```ts
// sigma1/index.ts update(), replacing the unconditional `else` branch
if (usedFallback || !isRpEligibleEventType(result.eventType)) {
  rpSkippedMatchCount += 1;
} else {
  ...
}
```

```ts
// sigma1/index.ts predict(), before building redRpMoments/rpResult
const rpResult = isRpEligibleEventType(match.eventType)
  ? rpPmfForMatch({ ... })
  : { redPmf: [], bluePmf: [] };
```

Add a regression test that replays a match with `eventType: 99` and a real `scoreBreakdownRaw` through `sigma1.update()`/`sigma1.predict()` and asserts it does not throw, plus a `cli.ts`-level (or `runSeason`-level) test that `--include-offseason` with `sigma1` selected does not crash on an offseason fixture.

## Warnings

### WR-01: `digest.test.ts`'s headline-metric comparison never checks which season a committed metric belongs to, so a future multi-season `headlineMetrics` array would silently compare the wrong data

**File:** `packages/harness/digest.test.ts:170-173`
**Issue:** `promote.ts`'s `DigestSchema.headlineMetrics` is `z.array(HeadlineMetricSchema)`, where each entry carries its own `season`. `promote.ts` today only ever emits one entry (for `sliceSeason`), so the loop in `digest.test.ts` happens to be safe:
```ts
for (const committed of promoted.digest.headlineMetrics) {
  expect(combinedSlice?.brierScore ?? null).toBe(committed.brierScore);
  expect(combinedSlice?.winnerAccuracy ?? null).toBe(committed.winnerAccuracy);
}
```
`combinedSlice` is resolved once, outside the loop, as `slices.find(s => s.compLevelView === "combined" && s.season === promoted.digest.sliceSeason)` — the loop body never reads `committed.season` at all. If a future promotion (or a hand-edited/malformed version file that still passes `DigestSchema`) ever carried more than one `headlineMetrics` entry, this test would compare every entry against the same single `combinedSlice`, silently passing or failing for the wrong reason instead of catching a genuine per-season mismatch. Given this file's own stated purpose (SC-5's reproducibility gate — "a digest mismatch is a finding about the code, not a fixture to refresh"), the loop should validate against the schema's own per-entry `season`, not assume a length-1 array that nothing enforces structurally.
**Fix:** Match each `committed` entry to its own season's slice before comparing, and fail loudly if no matching slice exists:
```ts
for (const committed of promoted.digest.headlineMetrics) {
  const slice = slices.find((s) => s.compLevelView === "combined" && s.season === committed.season);
  expect(slice?.brierScore ?? null, `no combined slice for season ${committed.season}`).toBe(committed.brierScore);
  expect(slice?.winnerAccuracy ?? null).toBe(committed.winnerAccuracy);
}
```

### WR-02: `packages/core/algorithms/sigma1/rp/2025.ts` — `CORAL_LEVEL_THRESHOLD_COOP` and `CORAL_LEVEL_THRESHOLD_STRICT` are independently-declared but must always be identical, with nothing enforcing that

**File:** `packages/core/algorithms/sigma1/rp/2025.ts:87-90`
**Issue:**
```ts
const CORAL_LEVEL_THRESHOLD_STRICT: RpTieredThreshold = { base: 5, districtChampionship: 5, championship: 7 };
const CORAL_LEVEL_THRESHOLD_COOP: RpTieredThreshold = { base: 5, districtChampionship: 5, championship: 7 };
```
Per the file's own comments, the coopertition relaxation for Coral Bonus only changes *how many* of the four reef levels must clear the threshold (3-of-4 vs 4-of-4) — the per-level count threshold itself (5, or 7 at Championship) is identical in both cases. That's plausible per the manual, but the two constants are two independent literals with no shared source; a future threshold correction (e.g. if the Championship-tier value needs revisiting, which the file header already flags as "should still be confirmed against the official manual") that updates one table and not the other would silently diverge the coop and non-coop paths without any test catching it, since `reconciliation.test.ts`'s `KNOWN_TOLERANCES` already carries a documented ~5% slack for `coralBonus` that would absorb a small drift.
**Fix:** Derive one from the other (`const CORAL_LEVEL_THRESHOLD_COOP = CORAL_LEVEL_THRESHOLD_STRICT;`) with a comment stating the two are the same table by rule, not by coincidence — so an edit to one is guaranteed to move both, and a genuine future divergence (if the manual is ever found to differ) requires a deliberate un-aliasing rather than a silent one-sided edit.

## Info

### IN-01: `tune.ts`'s `neighborValues` is invoked twice per refinement step to compute the same rejected-candidate count

**File:** `packages/harness/tune.ts:789-793`
**Issue:** In the coordinate-descent refinement loop, `neighborValues(bound, currentValue)` is called once to build `neighborCandidates` and a second time, with identical arguments, purely to recompute the same array's length for `rejectedCandidates` bookkeeping:
```ts
const neighborCandidates = neighborValues(bound, currentValue)
  .filter((v) => v !== currentValue)
  .map(...)
  .filter((c) => isValidParamSet(c.params));
rejectedCandidates += neighborValues(bound, currentValue).filter((v) => v !== currentValue).length - neighborCandidates.length;
```
Not a correctness issue (the function is pure and cheap — this is explicitly out of the performance-review scope), but it's a small readability/maintenance smell: computing `neighborValues(bound, currentValue).filter((v) => v !== currentValue)` once into a local and reusing its `.length` for both purposes would remove the duplicate call and the risk of the two invocations silently drifting if `neighborValues` is ever changed to be non-pure or parameterized differently at the two call sites.
**Fix:** Hoist `const filteredNeighbors = neighborValues(bound, currentValue).filter((v) => v !== currentValue);` once and derive both the candidate list and the rejected count from it.

### IN-02: `KNOWN_TOLERANCES`' 2024 `ensembleBonus` margin is roughly 40% wider than the measured rate, without a stated reason for the specific margin size

**File:** `packages/core/algorithms/sigma1/rp/reconciliation.test.ts:147-152`
**Issue:** The comment states a measured ~7% residual for 2024's `ensembleBonus`, but the committed tolerance is `0.1` (10%) — a substantially wider margin than the other entries in the same table (e.g. 2022 `cargoBonus`'s tolerance of `0.005` against a measured ~0.29%, roughly a 1.7x margin). This is not "a tolerance so wide it admits anything" (it still fails a genuine regression above 10%), and the file is otherwise disciplined about reporting exact measured rates, but the specific choice of a ~1.4x margin here versus tighter margins elsewhere in the same table is not explained, which makes it harder for a future reviewer to tell "measured variance across runs" apart from "generous headroom to avoid flakiness."
**Fix:** Either tighten the tolerance closer to the measured rate (e.g. 0.08) or add a one-line note explaining why this bonus specifically warrants a wider margin than its siblings in the same table (e.g. higher run-to-run corpus variance, or known partial concentration in specific events).

---

_Reviewed: 2026-08-17_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
