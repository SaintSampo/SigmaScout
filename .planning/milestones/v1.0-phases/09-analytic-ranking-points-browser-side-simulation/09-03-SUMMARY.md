---
phase: 09-analytic-ranking-points-browser-side-simulation
plan: 03
subsystem: api
tags: [ranking-points, negative-binomial, poisson-binomial, vitest, typescript, browser-safe]

# Dependency graph
requires:
  - phase: 09-analytic-ranking-points-browser-side-simulation
    provides: "09-02's MarginalFamily union and RpThresholdVariable.marginalFamily field (packages/core/rankingPoints/constants.ts), every declaration still naming 'gaussian'"
provides:
  - "docs/models/rp-mean-deficit-warm-rosters.md — F3's mean deficit re-measured on fully-warm 3/3 rosters (95.13% of the RP-eligible population), split under D-04's selection/reporting slices, the number 09-05 and 09-06 must act on instead of the original cold-roster-pooled probe"
  - "packages/core/rankingPoints/marginals.ts — the browser-safe (D-08) zero-runtime-import leaf: negative-binomial method-of-moments fit, exact log-space discrete CDF, Gaussian inert default with no continuity correction, a documented four-branch fallback ladder for variance<=mean, Poisson-binomial convolution for count-of-indicators bonuses"
  - "packages/harness/browserSafeSchemas.test.ts's eighth entry point (marginals.ts), hand-verified to fail and then pass"
affects: [09-04, 09-05, 09-06, 09-07, 09-08]

# Actuals (#2632)
actuals:
  tokens: 23300
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Two-named-arms measurement script (measureRewindGap.ts's convention, applied one level down): one walk-forward pass, one accumulator, two population filters over the SAME (predicted, observed) pair — never a second computation"
    - "FittedMarginal.{declared, resolved, fallbackReason} as three separate observable facts, so a family swap's silent fallback rate is a countable fact rather than an invisible one"
    - "Ordered fallback ladder with a raw-continuous-mean degenerate branch, documented and tested branch-by-branch in precedence order"

key-files:
  created:
    - scripts/measureRpMeanDeficit.ts
    - scripts/measureRpMeanDeficit.test.ts
    - docs/models/rp-mean-deficit-warm-rosters.md
    - packages/core/rankingPoints/marginals.ts
    - packages/core/rankingPoints/marginals.test.ts
  modified:
    - package.json
    - packages/harness/browserSafeSchemas.test.ts

key-decisions:
  - "foldObservedThresholds's per-side try/catch folds only the side that parsed successfully, matching SigmaScoutLayer's own #foldObservedThresholds exactly (proven by a dedicated equivalence test) — a parse failure on one side never blocks the other side's fold"
  - "Poisson-binomial: direct DP convolution, no log-space variant, justified in the module header per 09-CONTEXT.md's Claude's-Discretion assignment — the factor counts here (5 for 2016 breach, 4 for 2025 coralBonus) never approach the range where direct convolution's underflow risk is real"
  - "poissonBinomialPmf skips (drops) a non-finite probability entry rather than coercing it to 0 or 1, documented as a deliberate choice since either coercion would assert an unwarranted fact"

patterns-established:
  - "marginals.ts joins rankSimulation.ts as this project's second zero-runtime-import leaf under packages/core/, both registered in browserSafeSchemas.test.ts's static import-graph scan with a non-vacuity visited-set assertion"

requirements-completed: [F2, F3, D-01, D-08]

coverage:
  - id: D1
    description: "F3's mean deficit is re-measured on fully-warm 3/3 rosters (not just all-rosters) via one walk-forward pass per season, committed as a readable measurement record with census, D-04 slice separation, and generating command"
    verification:
      - kind: unit
        ref: "scripts/measureRpMeanDeficit.test.ts (14 tests, including the SigmaScoutLayer equivalence proof)"
        status: pass
      - kind: other
        ref: "npx tsx scripts/measureRpMeanDeficit.ts --seasons 2016-2020,2022-2026 (full corpus run, output quoted below)"
        status: pass
    human_judgment: false
  - id: D2
    description: "marginals.ts exists with the D-01 negative-binomial method-of-moments fit pinned in the file, an exact log-space discrete CDF, the Gaussian family retained unchanged as the inert default with no continuity correction, and a documented four-branch fallback ladder that makes variance<=mean produce a well-formed marginal instead of NaN"
    verification:
      - kind: unit
        ref: "packages/core/rankingPoints/marginals.test.ts (41 tests: hand-computed NB/Gaussian/fallback-ladder cases, Poisson-binomial, invariants, cold-team proof against the real accumulator)"
        status: pass
    human_judgment: false
  - id: D3
    description: "marginals.ts's browser-safety (D-08) is machine-checked, not asserted in a comment: registered as browserSafeSchemas.test.ts's eighth entry point, with the guard hand-proven to fail (naming marginals.ts) before being trusted to pass"
    verification:
      - kind: unit
        ref: "packages/harness/browserSafeSchemas.test.ts — new it(...) block, plus the hand-verification transcript quoted below in this SUMMARY"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-09-11
status: complete
---

# Phase 9 Plan 3: F3 Warm-Roster Re-measurement and the marginals.ts Numeric Core Summary

**Re-measured F3's mean deficit restricted to fully-warm 3/3 rosters (deficit survives, 33 of 34 season-variables, shrinking from a 10.4% to 8.0% selection-slice mean) and shipped `marginals.ts` — a browser-safe negative-binomial/Gaussian/Poisson-binomial numeric leaf with a hand-computed test suite and a machine-checked import-graph guard — with no call site and nothing published changed.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3
- **Files modified:** 7 (5 created, 2 modified, across 3 task commits)

## Accomplishments

- **Re-measured F3 on the population the RP layer actually predicts for.** `scripts/measureRpMeanDeficit.ts` folds all ten registered seasons through one `RpMomentsAccumulator` per season and reports two named arms — `all-rosters` (the original probe's population) and `warm-3of3` (roster exactly 3 teams, every one `hasHistory`-warm) — from ONE walk-forward pass, differing only by a roster filter applied to the same (predicted, observed) pair. `foldObservedThresholds` was proven equivalent to `SigmaScoutLayer`'s own private `#foldObservedThresholds` by a dedicated test comparing `momentsFor(...)` output between the standalone loop and the real shipped layer.
- **The deficit survives the restriction.** Measured across the full corpus (185,313 matches; 305,462 `all-rosters` alliance-sides; 290,588 `warm-3of3`, 95.13% overlap): both arms report 33 of 34 season-variables with a predicted mean below observed — `all-rosters` matches the original audit's figure exactly. The magnitude shrinks (selection-slice mean deficit 10.4% -> 8.0%) but does not disappear. One variable (2016 `attackedTowerEndStrength`) runs the other way in both arms and gets MORE negative under the warm restriction (-10.4% -> -18.8%), reported exactly as measured. Committed as `docs/models/rp-mean-deficit-warm-rosters.md`, split under D-04's selection/reporting headings.
- **Built `marginals.ts`** — a zero-runtime-import browser-safe leaf (D-08): the pinned D-01 negative-binomial method-of-moments fit (`r = mean²/(variance−mean)`, `p = mean/(mean+r)`), an exact log-space discrete CDF that switches between lower-sum and upper-tail accumulation to avoid catastrophic cancellation, the Gaussian family retained unchanged as the inert default with the exact-at-zero special case and no continuity correction, a Poisson-binomial convolution for count-of-indicators bonuses (2016 `breach`, 2025 `coralBonus`'s strict branch), and a documented four-branch ordered fallback ladder for Pitfall 3 (`non-finite` -> `zero-variance` -> gaussian-declared -> NB `non-positive-mean`/`variance-le-mean`).
- **Every test expectation is hand-computed** (D-07's mandatory mitigation for the declined Monte Carlo check): 41 assertions in `marginals.test.ts`, including four exact dyadic-rational NB CDF values, the Gaussian x=0 special case, six fallback-ladder branches (one against the REAL 2-observation alliance mean/variance from the plan's baseline table), ten Poisson-binomial values, monotonicity/boundedness/identity invariants over `t = -1..50` across three fits, and two cold-team cases proven against the real `RpMomentsAccumulator`.
- **`marginals.ts` registered as `browserSafeSchemas.test.ts`'s eighth entry point** and the guard was hand-proven real: a temporary `node:fs` import made the new assertion FAIL naming `marginals.ts`; reverted, the assertion PASSES again.

## Task Commits

Each task was committed atomically:

1. **Task 1: F3's mean deficit re-measured on fully-warm 3/3 rosters** — `5d8e6e10` (feat)
2. **Task 2: `marginals.ts`'s numeric core — NB fit, log-space CDF, Gaussian default, fallback ladder** — `7e489fdf` (feat)
3. **Task 3: Poisson-binomial convolution, invariants, cold-team proof, browser-safe registration** — `08c2424b` (feat)

**Plan metadata:** (this SUMMARY's own commit)

## Files Created/Modified

- `scripts/measureRpMeanDeficit.ts` — the F3 re-measurement: `parseSeasons`, `isFullyWarmRoster`, `deficitFraction`, `foldObservedThresholds`, `runMeasurement`, `--seasons`/`--json`/`--write-doc` CLI, no `--env-file`
- `scripts/measureRpMeanDeficit.test.ts` — 14 unit tests including the `SigmaScoutLayer` equivalence proof
- `docs/models/rp-mean-deficit-warm-rosters.md` — the committed measurement record with both slice tables, census, command, and machine-readable `rp-mean-deficit` block
- `package.json` — one new script entry, `measure:rp-mean-deficit`, no dependency change
- `packages/core/rankingPoints/marginals.ts` — the numeric leaf: `erf`, `standardNormalCdf`, `NB_MAX_TAIL_TERMS`, `ResolvedMarginalFamily`, `MarginalFallbackReason`, `FittedMarginal`, `fitMarginal`, `fitAllianceMarginals`, `probAtLeast`, `probAtMost`, `poissonBinomialPmf`, `poissonBinomialAtLeast`
- `packages/core/rankingPoints/marginals.test.ts` — 41 hand-computed tests
- `packages/harness/browserSafeSchemas.test.ts` — `MARGINALS_ENTRY_POINT` and its `it(...)`, eighth entry point

## F3 warm-roster measurement

| Arm | Season-variables with predicted mean below observed |
|---|---|
| `all-rosters` | 33 of 34 (matches the original audit's figure exactly) |
| `warm-3of3` | 33 of 34 |

`warm-3of3` share of `all-rosters` alliance-sides: **95.13%** (290,588 of 305,462) — the two populations overlap heavily, consistent with the deficit surviving rather than being a cold-start artifact.

**Plain-language verdict (from the committed document):** the deficit survives the restriction to fully-warm rosters — predicted alliance means are still below observed in 33 of 34 season-variables — though the size of the shortfall shrinks (selection-slice mean deficit 10.4% -> 8.0%). One variable (2016 `attackedTowerEndStrength`) runs the other way in both arms and the gap gets larger, not smaller, once cold rosters are excluded (-10.4% to -18.8%), reported exactly as measured. **09-05 and 09-06 should read this as: the marginal-family swap is still worth attempting on the population the RP layer actually predicts for, but the effect size to expect is somewhat smaller than the original 33-of-34 probe implied.**

Any decision derived from this record cites the **SELECTION SLICE (2016-2020, 2022)**, never the reporting slice (2023-2026) — see `docs/models/rp-mean-deficit-warm-rosters.md` for both full tables and the machine-readable block.

## Marginal API surface

**09-04 reads this section and should not need to re-read the module.**

```ts
export type ResolvedMarginalFamily = "negative-binomial" | "gaussian" | "degenerate";
export type MarginalFallbackReason = "non-finite" | "zero-variance" | "non-positive-mean" | "variance-le-mean";

export interface FittedMarginal {
  readonly declared: MarginalFamily;           // what the season module asked for
  readonly resolved: ResolvedMarginalFamily;    // what actually got fit
  readonly mean: number;
  readonly variance: number;
  readonly r?: number;                          // present only when resolved === "negative-binomial"
  readonly p?: number;                          // present only when resolved === "negative-binomial"
  readonly sd?: number;                         // present only when resolved === "gaussian"
  readonly fallbackReason?: MarginalFallbackReason; // undefined when resolved === declared (incl. the Gaussian inert default)
}

export function fitMarginal(mean: number, variance: number, declared: MarginalFamily): FittedMarginal;
export function fitAllianceMarginals(moments: AllianceRpMoments, variables: readonly RpThresholdVariable[]): Map<string, FittedMarginal>;
export function probAtLeast(marginal: FittedMarginal, threshold: number): number; // monotone non-increasing, always [0,1]
export function probAtMost(marginal: FittedMarginal, threshold: number): number;  // discrete families: 1 - probAtLeast(floor(t)+1)
export function poissonBinomialPmf(probabilities: readonly number[]): number[];
export function poissonBinomialAtLeast(probabilities: readonly number[], k: number): number;
export function erf(x: number): number;
export function standardNormalCdf(z: number): number;
export const NB_MAX_TAIL_TERMS = 100_000;
```

`fitAllianceMarginals` reads ONLY `moments.varianceBlock[i][i]` (the diagonal) and the matching `RpThresholdVariable.marginalFamily`, defaulting to `"gaussian"` for a variable absent from the declared list. `probAtLeast` is the single summation routine `probAtMost` is defined in terms of for discrete families — proven consistent by construction, not by two implementations that happen to agree.

## Fallback observability

`FittedMarginal.declared` always records what the season module asked for; `.resolved` records what actually got fit; `.fallbackReason` is populated ONLY when `resolved !== declared` — the Gaussian inert default (declared and resolved both `"gaussian"`) is asserted to carry NO `fallbackReason`, so it can never be miscounted as a fallback. 09-06 can therefore compute, per bonus, how often an arm labelled `"negative-binomial"` actually resolved to negative-binomial vs. silently fell back to Gaussian, and which of the four `MarginalFallbackReason` values fired — a countable fact rather than an invisible one.

## Baseline vs post-plan failing test sets

| Suite | Baseline (before this plan) | After this plan |
|---|---|---|
| `packages/core/rankingPoints` | 5 files, 337 passed, 0 failing | 6 files, 360 passed, 0 failing |
| `packages/harness/browserSafeSchemas.test.ts` | 1 file, 8 passed, 0 failing | 1 file, 9 passed, 0 failing |
| `npx tsc --noEmit` | clean (0 errors) | clean (0 errors) |
| Full suite, repo root (`npx vitest run`) | not captured pre-plan (09-02-SUMMARY's own baseline: 249 files, 4814 passed, 4 skipped) | **251 files, 4870 passed, 4 skipped (same pre-existing skips), 0 failing** |

Zero new failures anywhere. The +2 file count (249 -> 251) is exactly `scripts/measureRpMeanDeficit.test.ts` and `packages/core/rankingPoints/marginals.test.ts`.

## Browser-safe guard hand-verification transcript

With a temporary `import { readFileSync } from "node:fs";` inserted at the top of `marginals.ts`:

```
 FAIL  |node| packages/harness/browserSafeSchemas.test.ts > browser-safe schema import graph > never reaches a Node built-in import from packages/core/rankingPoints/marginals.ts (checked for Node built-ins only — this entry point legitimately lives under packages/core/rankingPoints/, outside packages/core/algorithms/ entirely, plan 09-03 Task 3, D-08)
AssertionError: Node built-in import(s) reachable from packages/core/rankingPoints/marginals.ts: C:\Users\Jacob\Documents\GitHub\SigmaScout\packages\core\rankingPoints\marginals.ts imports "node:fs"

 Test Files  1 failed (1)
      Tests  1 failed | 8 passed (9)
```

After reverting the temporary import (`git status --porcelain packages/core/rankingPoints/marginals.ts` confirmed clean of it at commit time):

```
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

## Decisions Made

- **`foldObservedThresholds`'s per-side independence** (see `key-decisions` in frontmatter) — matches `SigmaScoutLayer`'s own shipped guard structure exactly, proven by the equivalence test rather than assumed from reading the source.
- **Poisson-binomial: direct DP convolution, no log-space** — the numerical-stability judgement 09-CONTEXT.md's "Claude's Discretion" assigned to this plan. Recorded reasoning: the factor counts here (5, 4) never approach the range where direct convolution's underflow risk becomes real.
- **A non-finite Poisson-binomial indicator is dropped, not coerced** — documented in the function header as a deliberate choice against silently asserting 0 or 1 for a probability the caller could not supply.

## Deviations from Plan

None — plan executed exactly as written. The Task 2/Task 3 split in the numeric module (core NB/Gaussian/fallback in Task 2's commit; Poisson-binomial, invariants, cold-team proof, and browser-safe registration in Task 3's commit) required temporarily writing and then trimming the Poisson-binomial section out of `marginals.ts` mid-Task-2 to keep the two commits' scope matching the plan's stated `git diff --stat` acceptance criteria exactly — not a deviation from the plan's content, only from a first-draft ordering of writing it.

## Issues Encountered

None. The background full-corpus measurement run (Task 1, ~185k matches across ten seasons) completed cleanly in the background while Task 2's numeric work proceeded in parallel.

## User Setup Required

None — no external service configuration required. `git diff package.json` shows exactly one added script line; no `dependencies`/`devDependencies` change, so the Package Legitimacy Gate does not apply.

## Next Phase Readiness

- **09-04** can now import `fitAllianceMarginals`, `probAtLeast`/`probAtMost`, `poissonBinomialPmf`/`poissonBinomialAtLeast` by name (see "Marginal API surface" above) to build `analyticPmf.ts`'s joint enumeration. `probAtLeast`'s monotonicity is an asserted invariant, not an assumption 09-04 needs to re-prove before differencing it for the 2026 nested-threshold interval.
- **09-05** has the warm-roster deficit record to justify attempting the marginal-family flip, and the exact `fitMarginal(mean, variance, declared)` dispatch point to flip `declared` at, per variable, via `RpLayerConfig` — no second entry point exists.
- **09-06** has `FittedMarginal.{declared, resolved, fallbackReason}` ready to count how often an NB-declared arm actually resolved to NB, per bonus, for its accept/revert attribution table.
- Nothing published changed, `marginals.ts` has no caller anywhere in the repo (`git log` shows no commit in this plan touching `#rpFieldsFor`, `publish.ts`, or any season module), and the full suite from the repo root shows zero new failures.
- No secret was read, printed, copied or interpolated at any point in this plan, and no network request was made — `scripts/measureRpMeanDeficit.ts` takes no credential of any kind and its `package.json` entry omits `--env-file`.

---
*Phase: 09-analytic-ranking-points-browser-side-simulation*
*Completed: 2026-09-11*

## Self-Check: PASSED

- `scripts/measureRpMeanDeficit.ts` — FOUND
- `scripts/measureRpMeanDeficit.test.ts` — FOUND
- `docs/models/rp-mean-deficit-warm-rosters.md` — FOUND
- `packages/core/rankingPoints/marginals.ts` — FOUND
- `packages/core/rankingPoints/marginals.test.ts` — FOUND
- Commit `5d8e6e10` — FOUND in `git log --oneline --all`
- Commit `7e489fdf` — FOUND in `git log --oneline --all`
- Commit `08c2424b` — FOUND in `git log --oneline --all`
