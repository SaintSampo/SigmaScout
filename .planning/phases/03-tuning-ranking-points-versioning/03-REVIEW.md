---
phase: 03-tuning-ranking-points-versioning
reviewed: 2026-08-18T00:00:00Z
depth: standard
files_reviewed: 58
files_reviewed_list:
  - .github/workflows/test.yml
  - .gitignore
  - data/algorithm-versions/sigma1@2.0.0+tracer-check.json
  - data/algorithm-versions/sigma1@2.0.0+tuned-2026-08.json
  - docs/models/sigma1-rp-verification.md
  - docs/models/sigma1-sensitivity-screen.md
  - docs/models/sigma1-tuning-results.md
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
  - packages/harness/fixtures/digest-slice.json
  - packages/harness/fixtures/extract-digest-slice.ts
  - packages/harness/metricHistory.test.ts
  - packages/harness/predictions.test.ts
  - packages/harness/predictions.ts
  - packages/harness/promote.ts
  - packages/harness/replay.multiAlgorithm.test.ts
  - packages/harness/replay.test.ts
  - packages/harness/report.test.ts
  - packages/harness/rpConservativeBranch.ts
  - packages/harness/searchSpace.test.ts
  - packages/harness/searchSpace.ts
  - packages/harness/tune.test.ts
  - packages/harness/tune.ts
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-08-18T00:00:00Z
**Depth:** standard
**Files Reviewed:** 58
**Status:** issues_found

## Summary

Phase 03 delivers Sigma1 hyperparameter versioning/tuning (`params.ts`, `searchSpace.ts`,
`tune.ts`, `promote.ts`), five per-season RP rule modules (`rp/2022.ts`–`rp/2026.ts`), the RP
Kalman/cross-covariance state and Monte Carlo pmf draw (`rp/state.ts`, `rp/distribution.ts`), an
adaptation mechanism (`adaptation.ts`), and a bitwise reproducibility gate now enforced in CI
(`digest.test.ts`, `.github/workflows/test.yml`).

This is an unusually well-instrumented codebase: nearly every non-obvious decision, discretionary
call, and prior review finding (CR-01, WR-02, WR-03, IN-02, T-03-xx) is cited at its use site with
its own justification, and the test suite is dense with "proves the mechanism is wired, not
decorative" assertions rather than shape-only checks. I traced the score-side and RP-side Kalman
folds, the carry-season boundary logic, the joint Monte Carlo draw's covariance construction
(including its two numerical-stability patches — the escalating Cholesky ridge and the
Cauchy-Schwarz cross-covariance clamp), the two-stage hyperparameter search, and the
promote/reproduce pipeline end to end. I did not find a correctness bug that reaches a currently
shipped number: `data/algorithm-versions/sigma1@2.0.0+tuned-2026-08.json`'s digest, the RP
reconciliation tolerances, and the conservative-branch/CR-01 fixes named in the task brief as
already resolved are, as stated, resolved in the tree as it stands.

What I did find is a real, if currently latent, gap in this phase's own stated discipline:
`isValidParamSet` — the hard cross-parameter validity gate (`processNoiseEventBoundary >
processNoiseWithinEvent`, `adaptationMinFactor < adaptationMaxFactor`, the three carry
weights/fractions in `[0, 1]`) — is enforced inconsistently across the candidate-generation and
promotion pipeline. It is currently unreachable only because of a coincidental relationship
between the search space's declared bounds and `DEFAULT_SIGMA1_PARAMS`'s own values, not because
of an explicit guard at every site that needs one. Given this project's own stated failure log
("no evaluation harness," "silent drift"), this is worth closing rather than leaving to keep being
coincidentally safe. Two smaller robustness/maintainability findings accompany it below.

## Warnings

### WR-01: `isValidParamSet` is not enforced at every candidate-generation/promotion boundary

**File:** `packages/harness/tune.ts:704-713` (`planJointCandidates`, `mode: "singleton"` branch),
`packages/harness/promote.ts:217-225` (`main`), `packages/harness/cli.ts:154-163`
(`loadSearchWinnerSigma1`)

**Issue:** `isValidParamSet` (`searchSpace.ts`) is the one place this codebase's cross-parameter
modeling invariants are actually enforced — e.g. a process-noise event-boundary bump that does not
exceed the within-event bump is meaningless (D-07), and an inverted adaptation clamp
(`adaptationMinFactor >= adaptationMaxFactor`) is degenerate (T-03-06). Two of `tune.ts`'s three
candidate-generation paths call it explicitly: `runScreenStage`'s per-value loop
(`tune.ts:464-467`) and the random phase's `buildRandomCandidate` (`tune.ts:566-582`, reject-and-
resample until valid). The **singleton** path (`planJointCandidates`, exactly one survivor) does
not:

```ts
if (survivors.length === 1) {
  const key = survivors[0]!;
  const gridPoints = Math.max(3, Math.min(evalsCount, 9));
  const values = screenGridFor(key, gridPoints);
  const candidates = values.map((value, i) => ({
    id: `cand-${i}`,
    params: { ...DEFAULT_SIGMA1_PARAMS, [key]: value, adaptationEnabled, rpMonteCarloDraws: 0 } as Sigma1Params,
  }));
  return { mode: "singleton", skipped: null, candidates, rejectedCandidates: 0 };
}
```

Every candidate here varies exactly one parameter across its own declared bound while every other
field sits at `DEFAULT_SIGMA1_PARAMS` — currently safe only because each bound happens to sit on
the correct side of the *other* field's default (e.g. `processNoiseEventBoundary`'s bound floor is
`1`, which exceeds `processNoiseWithinEvent`'s default of `0.5`). Nothing enforces that
relationship; a future edit to `SIGMA1_SEARCH_SPACE`'s bounds (explicitly invited by this phase's
own `docs/models/sigma1-tuning-results.md` "Open Items," which recommends widening
`processNoiseEventBoundary`'s floor downward) could silently produce an invalid singleton
candidate with no error anywhere in the pipeline.

That gap is compounded downstream: `promote.ts`'s `main()` re-validates the winning candidate only
against `Sigma1ParamsSchema` (per-field `finite()` checks) —

```ts
const searchedParams: Sigma1Params = Sigma1ParamsSchema.parse(winnerCandidate.params);
```

— never against `isValidParamSet`. `Sigma1ParamsSchema` cannot catch a cross-parameter violation
by construction (each field is checked independently). `promote.ts`'s own doc comment describes
itself as the point a search evaluation "becomes" a committed, shipped version through validation
— but the validation performed does not include the one check this codebase actually uses to
define "valid." `cli.ts`'s `loadSearchWinnerSigma1` (used to resolve the adaptation-on module for
`--algorithm sigma1-adapt`) has the identical gap, plus it skips schema validation of the
containing object entirely (see IN-01 below).

The net effect: today, no reachable input produces an invalid promoted version (the search paths
that lack the guard happen to stay valid by construction), but nothing in the code *proves* that,
and `tune.test.ts`'s own "every generated candidate satisfies isValidParamSet" test
(`tune.test.ts:163-168`) only exercises the 2+-survivor ("random") mode via `SOME_SURVIVORS =
SEARCHABLE_PARAM_KEYS.slice(0, 4)` — the singleton path has no equivalent regression test, so a
bound change that breaks this invariant would not be caught by CI.

**Fix:**
```ts
// tune.ts, planJointCandidates singleton branch:
const candidates = values
  .map((value, i) => ({
    id: `cand-${i}`,
    params: { ...DEFAULT_SIGMA1_PARAMS, [key]: value, adaptationEnabled, rpMonteCarloDraws: 0 } as Sigma1Params,
  }))
  .filter((c) => isValidParamSet(c.params)); // + track rejectedCandidates, matching the screen/random paths

// promote.ts, main(), immediately after Sigma1ParamsSchema.parse:
if (!isValidParamSet(searchedParams)) {
  throw new Error(`promote: winning candidate from ${fromPath} fails isValidParamSet's cross-parameter constraints`);
}

// cli.ts, loadSearchWinnerSigma1, after Sigma1ParamsSchema.parse:
if (!isValidParamSet(searchedParams)) return undefined; // or throw, matching promote.ts's choice
```
Also add a `tune.test.ts` case asserting every `planJointCandidates([oneSurvivor], ...)` candidate
satisfies `isValidParamSet`, for every key in `SEARCHABLE_PARAM_KEYS` individually — this is
exactly the kind of "prove the mechanism, don't assert the shape" test the rest of this file
already does well.

### WR-02: `runScreenStage` can crash with an unhelpful `TypeError` if a parameter's entire grid is rejected

**File:** `packages/harness/tune.ts:493-496`

**Issue:** After candidate generation filters out any grid point that fails `isValidParamSet`
(`tune.ts:464-467`), the per-parameter aggregation does:

```ts
const paramCandidates = candidates.filter((c) => c.param === key);
const rows = paramCandidates.map((c) => { ... });

let bestRow = rows[0]!;
for (const row of rows) {
  if (row.brierScore < bestRow.brierScore) bestRow = row;
}
```

If every grid point for `key` were rejected, `rows` is `[]`, `rows[0]!` is `undefined` at runtime
(the `!` only silences the type checker), and the next line (`bestRow.brierScore`) throws a bare
`TypeError: Cannot read properties of undefined (reading 'brierScore')` — no parameter name, no
indication that the real cause was every candidate for that parameter being invalid. Given the
current `SIGMA1_SEARCH_SPACE` bounds this is unreachable (verified: every searchable parameter's
own bound sits on the valid side of every cross-parameter constraint relative to the defaults —
the same relationship WR-01 flags as undefended), but it is exactly the "quiet, hard-to-diagnose
failure" shape this project's own failure log exists to prevent, and it would surface at exactly
the moment someone is least equipped to debug it (mid hyperparameter-search run).

**Fix:**
```ts
if (rows.length === 0) {
  throw new Error(
    `tune: every candidate value for "${key}" was rejected by isValidParamSet — cannot screen this parameter. Check SIGMA1_SEARCH_SPACE's bound for "${key}" against the other fields' defaults.`
  );
}
let bestRow = rows[0]!;
```

### WR-03: `cli.ts`'s promoted-version path is a hardcoded filename with no staleness signal

**File:** `packages/harness/cli.ts:123,134`

**Issue:**
```ts
const PROMOTED_SIGMA1_VERSION_PATH = join("data", "algorithm-versions", "sigma1@2.0.0+tuned-2026-08.json");
const ON_SEARCH_ARTIFACT_PATH = join("reports", "tune-joint-on.json");
```
`applyPromotedOverrides` resolves `--algorithm sigma1` to whatever version file this literal names.
The doc comment on `PROMOTED_SIGMA1_VERSION_PATH` correctly explains *why* this must be read
lazily rather than at import time, but nothing explains what happens the next time `pnpm promote`
runs and produces `sigma1@2.0.0+tuned-2026-09.json` (or any other `paramSetName`): the constant
must be hand-edited in source for `--algorithm sigma1` to pick it up, and until that edit lands,
every harness run silently keeps scoring the *previous* promoted version — `loadPromotedSigma1`
returns a perfectly valid module (the old file still parses), so there is no error, warning, or
log line anywhere indicating a newer file exists under `data/algorithm-versions/` that isn't being
used. This is the same silent-staleness shape `promote.ts` itself is careful to avoid elsewhere
(e.g. printing the `extract-digest-slice.ts` re-run command after every promotion specifically so
the digest fixture can't go stale silently, per T-03-17) — this one instance of the same class of
risk has no equivalent guard.

**Fix:** Either resolve the current promoted version dynamically (e.g. glob
`data/algorithm-versions/sigma1@*.json`, pick the one with the latest `provenance.promotedAt`)
instead of a literal filename, or — the smaller change — have `applyPromotedOverrides` log a
warning when `readdirSync(ALGORITHM_VERSIONS_DIR)` contains a `sigma1@*.json` file newer
(`provenance.promotedAt`) than the one `PROMOTED_SIGMA1_VERSION_PATH` points at, so a stale
constant is loud rather than silent.

## Info

### IN-01: `loadSearchWinnerSigma1` casts a search artifact without schema validation

**File:** `packages/harness/cli.ts:154-163`

**Issue:** `promote.ts`'s equivalent reader (`TuneSearchOutput`, `promote.ts:158-169`) is also an
unchecked cast rather than a Zod schema, but `cli.ts`'s `loadSearchWinnerSigma1` compounds it by
also not checking `output.candidates` is even an array before calling `.find` on it:
```ts
const output = raw as TuneSearchOutputForOverride;
const winner = output.candidates.find((c) => c.index === output.winnerIndex);
```
Both files trust `reports/tune-joint-*.json` as a locally-produced, non-adversarial input (low
security risk), but this is the one place in the harness/promotion pipeline that departs from this
codebase's otherwise-consistent "validate at the read boundary" discipline (T-03-08's stated
mitigation, applied everywhere else: `Sigma1ParamsSchema`, `PromotedVersionSchema`,
`HarnessArtifactSchema`, `PredictionRecordSchema`, `MetricHistoryRowSchema`). A hand-edited or
truncated search artifact produces a raw, unlabelled `TypeError` here instead of a named parse
error.

**Fix:** Add a minimal Zod schema for the search-artifact shape (`winnerIndex: z.number().int()`,
`candidates: z.array(z.object({ index: z.number().int(), params: z.unknown() }))`) shared between
`cli.ts` and `promote.ts`, mirroring the pattern `PromotedVersionSchema` already establishes.

### IN-02: Redundant duplicate computation in `tune.ts`'s coordinate-descent refinement loop

**File:** `packages/harness/tune.ts:789-793`

**Issue:** `neighborValues(bound, currentValue)` is computed twice per survivor per refinement
step — once to build `neighborCandidates`, once again (with an identical `.filter((v) => v !==
currentValue)`) purely to size `rejectedCandidates`:
```ts
const neighborCandidates = neighborValues(bound, currentValue)
  .filter((v) => v !== currentValue)
  .map(...)
  .filter((c) => isValidParamSet(c.params));
rejectedCandidates += neighborValues(bound, currentValue).filter((v) => v !== currentValue).length - neighborCandidates.length;
```
`neighborValues` is pure and cheap (returns at most 2 values), so this has no measurable
performance impact, but it is duplicated logic that could silently diverge if either call site is
edited without the other.

**Fix:** Compute once and reuse:
```ts
const neighbors = neighborValues(bound, currentValue).filter((v) => v !== currentValue);
const neighborCandidates = neighbors
  .map((value) => ({ id: `refine-${nextIndex++}`, params: { ...anchor.params, [key]: value } as Sigma1Params }))
  .filter((c) => isValidParamSet(c.params));
rejectedCandidates += neighbors.length - neighborCandidates.length;
```

---

_Reviewed: 2026-08-18T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
