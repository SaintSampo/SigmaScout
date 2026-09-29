---
phase: 10-district-points-ledger
plan: 02
subsystem: testing
tags: [district-points, frc, walk-forward, brier, monte-carlo, corpus, typescript, vitest, spr]

requires:
  - phase: 09
    provides: "packages/core/districts/pointModel.ts's season-registry + typed-unknown-season pattern, and reconciliation.test.ts's corpus-guard shape"
  - phase: 08
    provides: "packages/harness/browserSafeSchemas.test.ts's static import-graph scan and its entry-point registration convention"
  - phase: 07
    provides: "packages/harness/replay.ts's WalkForwardSimulator, sigmaScoutLayer.ts's foldPlayed predict-before-update contract, and scripts/measureMatchBandCoverage.ts as the measurement-script precedent"
provides:
  - "packages/core/algorithms/simulation/allianceWinProbability.ts — the browser's alliance pricer, a registered browser-safe leaf with one runtime import"
  - "scripts/publishedSprSnapshots.ts — the one walk-forward seam yielding per-match before-match AND after-match published total/sigma"
  - "scripts/measureAllianceWinProbability.ts — the four-arm gap harness, its recorded constants and its variance-multiplier diagnostic"
  - "packages/core/districts/awardBaseRates.ts — seven registered seasons of award-point pmfs by decoration bucket x rookie status, with a three-rung fallback hierarchy"
  - "scripts/measureDistrictAwardBaseRates.ts — the walk-forward table generator, both leak halves pinned"
  - "scripts/measureSelectionAgreement.ts — the progressive captain rule and greedy-by-SPR pick order, teacher-forced, with the naive top-eight rule as a labelled baseline"
  - "three new uncredentialed measure:* entries in the root package.json"
affects: [10-04, 10-06, 10-07, 10-08]

actuals:
  tokens: 57631
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "One measurement seam, two consumers: publishedSprSnapshots.ts owns the only walk-forward replay in this plan, so 'the number the browser sees' has one definition rather than two that happen to agree"
    - "Read-then-advance in a single exported function, so the leak test drives the production sequencing rather than a restatement of it"
    - "Recorded constants beside the script that printed them, with the exact command and date, re-asserted by a corpus-guarded test"
    - "Two halves, two windows, two denominators — a cheap SQL-only half over the full range beside a replay-backed half over a narrow one, never pooled"
    - "A wrong baseline is SCORED beside the right rule, never used as a filter: a gate that encodes an assumption can empty the population it measures"

key-files:
  created:
    - packages/core/algorithms/simulation/allianceWinProbability.ts
    - packages/core/algorithms/simulation/allianceWinProbability.test.ts
    - scripts/publishedSprSnapshots.ts
    - scripts/measureAllianceWinProbability.ts
    - scripts/measureAllianceWinProbability.test.ts
    - packages/core/districts/awardBaseRates.ts
    - packages/core/districts/awardBaseRates.test.ts
    - scripts/measureDistrictAwardBaseRates.ts
    - scripts/measureDistrictAwardBaseRates.test.ts
    - scripts/measureSelectionAgreement.ts
    - scripts/measureSelectionAgreement.test.ts
  modified:
    - packages/harness/browserSafeSchemas.test.ts
    - package.json

key-decisions:
  - "The pinned window for BOTH replay-backed measurements is 2026 replayed from the start of its own season, with no earlier warmup. The wider 2025-warmup window was measured first and its corpus-guarded describe ran at 25,248 ms, over the plan's 25 s bar; per the plan the window was narrowed and the constants and the test were restated in the same commit. The narrowed describe runs in 6,412 ms."
  - "The two published metric key literals are declared LOCALLY in allianceWinProbability.ts rather than imported, so the leaf keeps exactly one runtime import; drift is prevented by a test pinning both against TOTAL_METRIC_KEY and SIGMA_METRIC_KEY by strict equality."
  - "A district event is an event with a non-null district_key, not event_type == 1. That predicate is what reproduces 10-04's population of exactly 491 eight-alliance events across 2023-2026; event_type == 1 alone gives 418."
  - "MIN_CELL_OBSERVATIONS is 100, stated from the support's six bins rather than chosen to make cells pass. 35 of 63 registered cells fall below it and print CANNOT BE SCORED."
  - "publishedSprSnapshots.ts emits an `after` snapshot alongside `before` (deviation Rule 3) — the qualification/playoff boundary value is the one from a team's most recently played match AT or before the boundary, which the `before` map structurally cannot supply."

patterns-established:
  - "Prove the guard fails before trusting it: the browser-safe import-graph entry was observed FAILING under a temporary node:fs import, naming the module, before the passing run was accepted"
  - "Population FLOORS beside every measured rate, so a future ingest regression turns a pin red instead of quietly proving less"
  - "A scored no-information floor beside every agreement rate — an agreement rate with no floor has no scale"
  - "Two independent implementations of one rule are required to agree exactly (this plan's captain SQL vs 10-04's planning SQL), and a disagreement is a finding rather than a number to overwrite"

requirements-completed: [SC-2, SC-6]

coverage:
  - id: D1
    description: "The browser can price one alliance against another from published SPR numbers, using the uncorrected sum of squared Sigma Scores and spr.ts's own clamp, returning undefined on every absence path"
    requirement: "SC-2"
    verification:
      - kind: unit
        ref: "packages/core/algorithms/simulation/allianceWinProbability.test.ts (27 tests, including the uncorrected-variance pin and all twelve absence cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "That function's browser-safety is machine-checked, registered in browserSafeSchemas.test.ts's static import-graph scan and proven to fail under a temporary Node import"
    requirement: "SC-2"
    verification:
      - kind: unit
        ref: "packages/harness/browserSafeSchemas.test.ts — 13 tests; the new entry observed failing then passing (transcript in this SUMMARY)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The gap between the browser formula and the site's own pRedWin is measured over 19,792 real played matches by a committed credential-free offline script, four arms scored through scoreSet, with a full census, a variance-multiplier diagnostic and a PRACTICAL ANSWER"
    requirement: "SC-2"
    verification:
      - kind: integration
        ref: "npx tsx scripts/measureAllianceWinProbability.ts --seasons 2026 --warmup-from 2026 (full output in this SUMMARY)"
        status: pass
      - kind: unit
        ref: "scripts/measureAllianceWinProbability.test.ts (25 tests; corpus-guarded describe reproduces every recorded constant within 1e-4 in 6,412 ms)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Walk-forward district award base-rate tables by decoration bucket crossed with rookie status, seven registered seasons, with unknown as its own rookie state, a typed unknown-season error and a three-rung fallback hierarchy that names the rung it used"
    requirement: "SC-6"
    verification:
      - kind: unit
        ref: "packages/core/districts/awardBaseRates.test.ts (20 tests)"
        status: pass
      - kind: integration
        ref: "scripts/measureDistrictAwardBaseRates.test.ts — corpus reconciliation over every registered season, every pmf within 1e-6 and every n exact"
        status: pass
    human_judgment: false
  - id: D5
    description: "Both halves of the award table's walk-forward boundary pinned by leak tests on fixtures where a leak changes the answer"
    requirement: "SC-6"
    verification:
      - kind: unit
        ref: "scripts/measureDistrictAwardBaseRates.test.ts — LEAK HALF ONE (the feature) and LEAK HALF TWO (the rates), 14 tests total"
        status: pass
    human_judgment: false
  - id: D6
    description: "The progressive captain rule scored teacher-forced over 485 usable events and 3,880 slots with every miss named, the naive top-eight rule reported beside it as a labelled baseline with its own denominator, and nothing gated on how a captain ranks"
    requirement: "SC-6"
    verification:
      - kind: integration
        ref: "scripts/measureSelectionAgreement.test.ts — corpus describe reproduces 3,879/3,880, 484/485 perfect, the 2026milac miss and all six exclusions by INTEGER equality"
        status: pass
      - kind: unit
        ref: "scripts/measureSelectionAgreement.test.ts — 32 pure tests including the seeded-captain assertion and the commitment-schedule pin"
        status: pass
    human_judgment: false
  - id: D7
    description: "Greedy-by-SPR pick-order agreement measured teacher-forced under the serpentine order, broken out by first and second pick, each against its own no-information floor"
    requirement: "SC-6"
    verification:
      - kind: integration
        ref: "npx tsx scripts/measureSelectionAgreement.ts (full output in this SUMMARY); corpus describe pins 2,256 turns within 1e-4"
        status: pass
    human_judgment: false

duration: 55 min
completed: 2026-09-25
status: complete
---

# Phase 10 Plan 02: Measured before it ships Summary

**Three numbers this phase is not allowed to state without a committed harness — the browser's alliance win-probability gap against the site's own `pRedWin` (mean 0.0552 over 19,792 played matches), the walk-forward district award base-rate tables (seven registered seasons, both leak halves pinned), and the selection model's agreement with the real draft (the progressive captain rule at 3,879 of 3,880 slots, greedy-by-SPR at 32.62% exact against a 5.90% floor) — plus the one net-new pure function 10-04's bracket is priced by.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-09-25T09:52Z
- **Completed:** 2026-09-25T10:47Z
- **Tasks:** 3 of 3
- **Files modified:** 13 (11 created, 2 modified), 4,582 insertions, 1 deletion

## Baseline captured before Task 1

| Item | Captured value |
|---|---|
| `git rev-parse --git-dir` | `.git` — the MAIN working tree, not a worktree. `workflow.use_worktrees` is `false`. |
| `ls -la data/corpus.sqlite` | `-rw-r--r-- 1 Jacob 197121 592105472 Sep 23 17:49 data/corpus.sqlite` |
| `district_rankings` | 16,345 rows |
| `event_alliances` | 17,663 rows |
| `event_awards_all` | **41,869 rows** — non-empty, so Task 2 had a decoration bucket to build |
| `event_rankings` | 85,349 rows |
| `.env` | **Never read, never printed, never copied, never hashed, never interpolated.** No new `package.json` entry carries an environment-file flag. |
| `npx vitest run packages/core/algorithms/simulation packages/core/districts packages/harness/browserSafeSchemas.test.ts` | 11 files passed, 200 tests passed, 0 failed |
| `npx tsc --noEmit` | clean, no output |
| `npx tsc --noEmit -p apps/web/tsconfig.json` | clean, no output |

## The win-probability gap

**Command:** `npx tsx scripts/measureAllianceWinProbability.ts --seasons 2026 --warmup-from 2026`, run 2026-09-25. Full printed output:

```
ALLIANCE WIN PROBABILITY — the browser's formula against the site's own pRedWin.
seasons:    2026 counted; warmup from 2026 (replayed, not counted)
arms:       browser-formula, published, coin, sign-only — every one scored through packages/core/scoring/brier.ts's scoreSet
variance:   the UNCORRECTED sum of squared Sigma Scores, never sigmaMatchBandVariance's display band
credential: none. Read-only corpus, no network request, no environment variable.

── 2026 ──
   scored rows: 19792 of 20907 replayed
   |browser-formula − published|   mean 0.0552   median 0.0417   p90 0.1224
   winner disagreement (opposite sides of 0.5): 4.44%
   ARM                 Brier      accuracy    no-calls   ties     n
   browser-formula      0.1462     78.79%         26      46    19792
   published            0.1443     79.24%         26      46    19792
   coin                 0.2494      0.00%      19792      46    19792
   sign-only            0.2112     78.79%         26      46    19792
   CENSUS  total 20907   fullyDemoMatch 120   fullyDqZeroScoreSide 41   coldStart 0   unpriceable 954 (4.56% of total)

── VARIANCE MULTIPLIER DIAGNOSTIC ──
   multiplier   mean |gap|   Brier      accuracy
            1       0.0552     0.1462     78.79%
            2       0.0707     0.1512     78.79%
            3       0.0911     0.1569     78.79%
   Multiplier 3 is the roster size sigmaMatchBandVariance multiplies in for the DISPLAY band.
   THE SHIPPED FUNCTION USES MULTIPLIER 1. THIS PLAN PROMOTES NO MULTIPLIER.

── PRACTICAL ANSWER ──
   Over 19792 played matches, the number a visitor's browser can compute for itself from a
   published event artifact sits 0.055 away from the number the site itself shows, on average;
   half the time it is within 0.042, and one match in ten is off by more than 0.122.
   The two pick DIFFERENT winners on 4.44% of those matches. Scored against what actually
   happened, the browser formula's Brier is 0.1462 against the published
   0.1443 (a gap of 0.0020), and it calls the winner right 78.79% of the
   time against the published 79.24%. Both are far better than the coin floor
   (Brier 0.2494), and better than the sign of the mean difference alone
   (Brier 0.2112), so the variance term is doing real work.
   For a bracket priced with it: the ORDER of two alliances is right the large majority of the time,
   but the CONFIDENCE is not the site's confidence, so a bracket probability built this way should be
   read as an approximation of the site's own number rather than as the same number.
```

**Which multiplier scored best, and whether it agrees with `sigmaScore.ts`.** Multiplier 1 wins on both the gap (0.0552 vs 0.0707 vs 0.0911) and Brier (0.1462 vs 0.1512 vs 0.1569), monotonically. That **agrees** with `sigmaScore.ts`'s documented finding that win and tie odds keep the uncorrected variance because red's and blue's misses are correlated, so widening it worsens Brier. Multiplier 3 — the display band's roster-size factor — is the worst of the three. **No multiplier is promoted; the shipped function is fixed at 1.0.**

**Full-precision recorded constants** (the values the run above printed, committed in `scripts/measureAllianceWinProbability.ts`):

| Constant | Value |
|---|---|
| `MEASURED_SCORED_ROWS` | 19792 |
| `MEASURED_TOTAL_ROWS` | 20907 |
| `MEASURED_MEAN_ABSOLUTE_GAP` | 0.05521610065219025 |
| `MEASURED_MEDIAN_ABSOLUTE_GAP` | 0.04173061762050173 |
| `MEASURED_P90_ABSOLUTE_GAP` | 0.12238168934831306 |
| `MEASURED_WINNER_DISAGREEMENT_RATE` | 0.04441188358932902 |
| `MEASURED_BROWSER_FORMULA_BRIER` | 0.14622846507962675 |
| `MEASURED_PUBLISHED_BRIER` | 0.1442591501111827 |
| `MEASURED_BROWSER_FORMULA_ACCURACY` | 0.7879064114250988 |
| `MEASURED_PUBLISHED_ACCURACY` | 0.79236301022992 |
| `MEASURED_COIN_BRIER` | 0.24941895715440582 |
| `MEASURED_SIGN_ONLY_BRIER` | 0.2111960201100925 |
| `MEASURED_FULLY_DEMO_MATCH` | 120 |
| `MEASURED_FULLY_DQ_ZERO_SCORE_SIDE` | 41 |
| `MEASURED_COLD_START` | 0 |
| `MEASURED_UNPRICEABLE` | 954 |

**The window was narrowed, and both the constants and the test were restated in the same commit.** The wider window (`--seasons 2026 --warmup-from 2025`) was measured first and its corpus-guarded describe ran at **25,248 ms**, over the plan's 25 s bar against the node project's 30 s timeout. Narrowed to 2026 alone, the describe runs in **6,412 ms**. The wider run's figures, recorded here and pinned nowhere: 20,475 scored rows, mean gap 0.0613, median 0.0451, p90 0.1359, winner disagreement 5.19%, browser Brier 0.1430 against the published 0.1396, accuracy 79.44% against 79.81%, `unpriceable` 271. The narrowing costs 683 rows to a larger `unpriceable` count (a team's first 2026 match has no carried-in rating) and moves every figure by less than a point.

**The uncorrected-variance pin, quoted from `allianceWinProbability.test.ts`:**

```ts
const actual = allianceWinProbability(RED_OFFSET, BLUE)!;
expect(actual).toBeCloseTo(standardNormalCdf(1 / Math.sqrt(275)), 12);
expect(actual).not.toBeCloseTo(standardNormalCdf(1 / Math.sqrt(825)), 6);
```

The balanced pin returns **exactly `0.5`** by strict equality; the offset pin returns Φ(1/√275) = 0.5240426220843686 to 12 places; Φ(1/√825) = 0.5138866398624325 is what the display band would give and is explicitly asserted NOT to be the answer.

**The walk-forward leak test is observed passing.** On a three-match synthetic stream where a team's `total` changes at every match, the match-3 snapshot carried the **match-2** value (`{ total: 11, sigma: 1.5 }`) and **not** the match-3 value (12), asserted both by deep equality on the match-2 value and by an explicit `.not.toBe(12)`. The match-1 snapshot for a first-appearance team is `{ total: undefined, sigma: undefined }`, and `classifyRow` on a row with an empty snapshot returns `skipped` with reason `unpriceable` — counted, never defaulted.

## Alliance win-probability API surface

**10-04 and 10-07 read this section and need not re-read the module.**

```ts
// packages/core/algorithms/simulation/allianceWinProbability.ts

export const PRICING_TOTAL_KEY = "total";          // === TOTAL_METRIC_KEY (pinned by test)
export const PRICING_SIGMA_KEY = "sigma";          // === SIGMA_METRIC_KEY (pinned by test)
export const ALLIANCE_WIN_PROBABILITY_EPSILON = 1e-6;

export interface AllianceMemberRating {
  readonly teamKey: string;
  readonly total: number | undefined;   // metrics["total"].value, in POINTS
  readonly sigma: number | undefined;   // metrics["sigma"].value, the Sigma Score
}

export interface PublishedMetricValue {
  readonly value: number;
  readonly spread?: number;
}

export function allianceWinProbability(
  red: readonly AllianceMemberRating[],
  blue: readonly AllianceMemberRating[]
): number | undefined;

export function allianceRatingsFromMetrics(
  roster: readonly string[],
  metricsByTeam: {
    readonly [teamKey: string]: { readonly [component: string]: PublishedMetricValue | undefined } | undefined;
  }
): AllianceMemberRating[];
```

**The formula:** `z = (Σ red total − Σ blue total) / sqrt(Σ red sigma² + Σ blue sigma²)`, then `clamp(Φ(z), 1e-6, 1 − 1e-6)`. The variance is the **uncorrected** sum — never `sigmaMatchBandVariance`'s roster-size-multiplied display band.

**`allianceWinProbability` returns `undefined` when, and only when:**

1. `red.length === 0`
2. `blue.length === 0`
3. any member's `total` is `undefined`
4. any member's `sigma` is `undefined`
5. any member's `total` is not a `number` (typeof check)
6. any member's `sigma` is not a `number`
7. any member's `total` is `NaN` or `±Infinity`
8. any member's `sigma` is `NaN` or `±Infinity`
9. the combined variance is not strictly positive (two all-zero-Sigma rosters)
10. `z` is non-finite for any other reason

The six absence paths the plan names are each asserted on both the red and the blue side (twelve cases): **an absent `total`, an absent `sigma`, a NaN `total`, a NaN `sigma`, an Infinity `total`, and a non-number `sigma`.** All twelve return `undefined`.

**Clamp:** the returned value is always strictly inside `[1e-6, 1 − 1e-6]`. An extreme mean gap returns exactly `1 - 1e-6` or exactly `1e-6`, the identical bounds `spr.ts:605` uses, so a comparison against `pRedWin` can never be an artifact of two different clamps. Rosters of 2, 3 and 4 all price.

**The browser-safe guard, hand-verified.** A temporary `import { readFileSync } from "node:fs";` was added to `allianceWinProbability.ts` and the scan run:

```
 ❯ |node| packages/harness/browserSafeSchemas.test.ts (13 tests | 1 failed) 490ms
     × never reaches a Node built-in import from packages/core/algorithms/simulation/allianceWinProbability.ts ...

 FAIL  packages/harness/browserSafeSchemas.test.ts > browser-safe schema import graph > never reaches a Node built-in import from packages/core/algorithms/simulation/allianceWinProbability.ts
AssertionError: Node built-in import(s) reachable from packages/core/algorithms/simulation/allianceWinProbability.ts: C:\Users\Jacob\Documents\GitHub\SigmaScout\packages\core\algorithms\simulation\allianceWinProbability.ts imports "node:fs"

 Test Files  1 failed (1)
      Tests  1 failed | 12 passed (13)
```

After reverting the import:

```
 Test Files  1 passed (1)
      Tests  13 passed (13)
   Duration  651ms
```

The entry was appended at the END of the entry-point list and after the last existing `it(...)`; no existing line was changed, so 10-03's append to the same list needs no merge.

## Award base-rate tables

**Command:** `npx tsx scripts/measureDistrictAwardBaseRates.ts`, run 2026-09-25.

**REGISTERED SEASONS: 2019, 2020, 2022, 2023, 2024, 2025, 2026** — seven of the ten `DISTRICT_REGISTERED_SEASONS`.

| Not registered | Reason, as printed |
|---|---|
| 2016 | only 0 prior district season(s) of data, below the 3 required |
| 2017 | only 1 prior district season(s) of data, below the 3 required |
| 2018 | only 2 prior district season(s) of data, below the 3 required |

**Per-cell `n`, every registered season** (`P(any)` is the chance of any award points; a cell below `MIN_CELL_OBSERVATIONS = 100` prints CANNOT BE SCORED and is ABSENT from the module):

| Cell | 2019 | 2020 | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|
| `none\|rookie` | 847 | 1,153 | 1,227 | 1,335 | 1,538 | 1,798 | 2,042 |
| `none\|veteran` | 4,307 | 5,235 | 5,487 | 6,073 | 6,540 | 6,947 | 7,335 |
| `none\|unknown` | **0** | **0** | **0** | **0** | **0** | **0** | **0** |
| `one-or-two\|rookie` | **0** | **0** | **0** | **0** | **0** | **0** | **0** |
| `one-or-two\|veteran` | 1,847 | 2,882 | 3,191 | 3,907 | 4,725 | 5,524 | 6,349 |
| `one-or-two\|unknown` | **0** | **0** | **0** | **0** | **0** | **0** | **0** |
| `three-or-more\|rookie` | **0** | **0** | **0** | **0** | **0** | **0** | **0** |
| `three-or-more\|veteran` | 1,213 | 2,463 | 3,096 | 4,540 | 6,198 | 8,053 | 10,060 |
| `three-or-more\|unknown` | **0** | **0** | **0** | **0** | **0** | **0** | **0** |
| **POOLED season** | 8,214 | 11,733 | 13,001 | 15,855 | 19,001 | 22,322 | 25,786 |

**Cells reported CANNOT BE SCORED: 35 of 63** — five per season, the **same five every season**, every one at `n = 0`:

- **All three `unknown` rookie rows.** TBA reports a `rookie_year` for every team appearing in a district ranking in this corpus, so the `unknown` state is structurally empty here. It is still carried as its own state in the module and is NEVER folded into `veteran`: the absence is real in TBA's data model even if this corpus does not currently exhibit it, and a lookup for `unknown` falls back up the hierarchy with `source` saying so.
- **`one-or-two|rookie` and `three-or-more|rookie`.** A rookie has no prior season, so it can have no prior judged award and is always in the `none` bucket by construction.

**This is a finding for 10-08, not a reason to lower the bar.** The usable crossing is three cells per season (`none|rookie`, `none|veteran`, `*|veteran`), and every other cell resolves through the `bucket-pooled` rung. The rookie crossing carries real signal only in the `none` bucket, where it is large.

**2026 table, fit on 2016-2025** (the one 10-04 and 10-06 will read most):

| Cell | n | P(any) | 0 | 5 | 8 | 10 | 13 | 15+ |
|---|---|---|---|---|---|---|---|---|
| `none\|rookie` | 2,042 | 52.35% | 0.4765 | 0.2713 | 0.2502 | 0.0010 | 0.0010 | 0.0000 |
| `none\|veteran` | 7,335 | 19.90% | 0.8010 | 0.1722 | 0.0110 | 0.0139 | 0.0012 | 0.0007 |
| `one-or-two\|veteran` | 6,349 | 26.07% | 0.7393 | 0.2342 | 0.0129 | 0.0121 | 0.0009 | 0.0005 |
| `three-or-more\|veteran` | 10,060 | 61.55% | 0.3845 | 0.4839 | 0.0533 | 0.0741 | 0.0023 | 0.0020 |
| POOLED `none` | 9,377 | 26.97% | 0.7303 | 0.1938 | 0.0631 | 0.0111 | 0.0012 | 0.0005 |
| POOLED `one-or-two` | 6,349 | 26.07% | 0.7393 | 0.2342 | 0.0129 | 0.0121 | 0.0009 | 0.0005 |
| POOLED `three-or-more` | 10,060 | 61.55% | 0.3845 | 0.4839 | 0.0533 | 0.0741 | 0.0023 | 0.0020 |
| POOLED season | 25,786 | 40.24% | 0.5976 | 0.3169 | 0.0469 | 0.0359 | 0.0016 | 0.0011 |

**UNMODELLED VALUES census: `none`, in every one of the ten seasons scanned.** Every observed district-tier `award_points` value in the corpus is representable in the support `[0, 5, 8, 10, 13, 15]`. Nothing collapsed silently, and the census exists so a future season that introduces a new value shows up rather than being rounded into a neighbour.

**`PRACTICAL ANSWER`, verbatim:**

```
   At a regular district event, a team that has never won a judged award takes home award points
   about 27.0% of the time. A team with one or two prior judged awards: 26.1%. A team with three
   or more: 61.6%. So prior decoration moves the chance by roughly 34.6 percentage points from the
   bottom bucket to the top — a real effect, and one that ORDERS teams far better than it calibrates
   any single team's chance. Rookie status inside the undecorated bucket moves it from 19.9%
   (veteran) to 52.4% (rookie). A team whose rookie year TBA does not report is its own
   "unknown" row and is never folded into "veteran". Figures above are season 2026's table,
   fit on seasons 2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, and every one of them is reported in whichever
   direction it came out.
```

**The exported lookup, for 10-04 and 10-06:**

```ts
export type DecorationBucket = "none" | "one-or-two" | "three-or-more";
export type RookieState = "rookie" | "veteran" | "unknown";
export type AwardBaseRateSource = "cell" | "bucket-pooled" | "season-pooled";

export const AWARD_POINT_SUPPORT: readonly number[] = [0, 5, 8, 10, 13, 15]; // index 5 means "15 or more"
export const NON_JUDGED_AWARD_TYPES: ReadonlySet<number> = new Set([1, 2, 14]);
export const MIN_CELL_OBSERVATIONS = 100;
export const DISTRICT_AWARD_BASE_RATE_SEASONS: readonly number[]; // [2019, 2020, 2022, 2023, 2024, 2025, 2026]

export function awardBaseRate(
  season: number,
  bucket: DecorationBucket,
  rookieState: RookieState
): { n: number; pmf: readonly number[]; source: AwardBaseRateSource };  // throws UnknownAwardBaseRateSeasonError

export function decorationBucket(priorJudgedAwardCount: number): DecorationBucket;
export function rookieStateFor(rookieYear: number | null | undefined, season: number): RookieState;
export function awardPointsBucketIndex(points: number): number | undefined;  // undefined = unmodelled
export function anyAwardProbability(pmf: readonly number[]): number;          // 1 - pmf[0]
export function conditionalMedianPoints(pmf: readonly number[]): number | undefined;
export function cellKey(bucket: DecorationBucket, rookieState: RookieState): string;
```

The three `source` values are each observed in the test output: `"cell"` for `none|veteran`, `"bucket-pooled"` for `three-or-more|rookie` (asserted equal to the `three-or-more` pooled row), and `"season-pooled"` as the last rung. No lookup returns a value without one — asserted across every registered season and every one of the nine cells.

**Both leak halves observed passing.**

- **Half one, the FEATURE.** A team wins two judged awards in 2000 and two more in 2002. `priorJudgedAwardCount(instances, "frc1", 2002)` returns **2**; the leaked boundary `... , 2003)` returns **4**. The fixture is chosen so that is not merely a different count but a different BUCKET: `decorationBucket(2) === "one-or-two"` and `decorationBucket(4) === "three-or-more"`.
- **Half two, the RATES.** Prior seasons 2000/2001/2002 earn 0 award points at every one of 600 team-events; the scored season's own 200 rows all earn 15. `toSeasonTable(honest)` equals the table built from the prior seasons alone **by deep equality**, and is asserted NOT equal to `toSeasonTable(leaked)`. Honest `seasonPooled.n` is 600 with `pmf[0] === 1`; leaked is 800 with `pmf[5] === 0.25`.

**Multi-recipient rows count once.** An award with three positional `recipientIndex` rows at one event counts as **1** prior judged award, not 3 — `event_awards_all`'s primary key is positional, so a naive row count triples a shared award.

**Tier selection reads the entry's own boolean.** A synthetic `event_points_raw` array carrying one `district_cmp: false` entry at 5 award points and one `district_cmp: true` entry at 45 contributes **only the 5**, and the test asserts the 45 is absent. This defends `pointModel.ts`'s stated measurement trap: inferring the tier by joining to `events` and testing `event_type == 2` yields the dcmp figure wearing the district tier's name.

**The thin-cell boundary is asserted, not assumed.** A cell at `MIN_CELL_OBSERVATIONS - 1` (99) is in `thinCells` and emits no key; a cell at exactly 100 is not thin and emits exactly its key.

## Selection agreement

**Command:** `npx tsx scripts/measureSelectionAgreement.ts --captain-seasons 2023-2026 --seasons 2026 --warmup-from 2026`, run 2026-09-25.

### CAPTAIN block — window 2023-2026

| Season | Arm | Correct / slots | | Mean \|rank error\| | Floor |
|---|---|---|---|---|---|
| 2023 | progressive | 880 / 880 | 100.00% | 0.00 | 3.76% |
| 2023 | naive | 243 / 880 | 27.61% | 1.94 | 3.76% |
| 2024 | progressive | 912 / 912 | 100.00% | 0.00 | 3.71% |
| 2024 | naive | 244 / 912 | 26.75% | 1.88 | 3.71% |
| 2025 | progressive | 960 / 960 | 100.00% | 0.00 | 3.74% |
| 2025 | naive | 241 / 960 | 25.10% | 1.90 | 3.74% |
| 2026 | progressive | 1127 / 1128 | 99.91% | 0.00 | 3.78% |
| 2026 | naive | 248 / 1128 | 21.99% | 2.13 | 3.78% |
| **POOLED** | **progressive** | **3879 / 3880** | **99.97%** | **0.00** | **3.75%** |
| **POOLED** | **naive** | **976 / 3880** | **25.15%** | **1.97** | **3.75%** |

- **Progressive PERFECT EVENTS: 484 of 485 usable events.**
- **Progressive MISSES (1): `2026milac` alliance 8.**
- **Usable events: 485.** Excluded: **6**, all under `eventsWithUnrankedRosterTeam` — `2023gaalb`, `2024vapor`, `2025ncash`, `2026mefal`, `2026txfor`, `2026txmca`.
- **Naive top-eight arm, TWO stated denominators:**
  - **SET EQUALITY: 3 of 491** eight-alliance district events in the window (the full population, including the six the per-slot figure excludes).
  - **PER-SLOT: 976 of 3,880** (25.15%) over the same 485-event population the progressive arm scores.
- **Captain no-information floor: 3.75%** (the mean of `1 / unalliedCount` at each captain turn).

**Agreement with 10-04's Fact 1: EXACT on every figure, from independent SQL.**

| Figure | This plan measured | 10-04 Fact 1 states | Agree? |
|---|---|---|---|
| Progressive correct slots | 3,879 of 3,880 (99.97%) | 3,879 of 3,880 (99.97%) | ✓ |
| Perfect events | 484 of 485 | 484 of 485 | ✓ |
| Usable events | 485 | 485 | ✓ |
| The single miss | `2026milac` alliance 8 | `2026milac` alliance 8 | ✓ |
| Excluded events | 6: `2023gaalb`, `2024vapor`, `2025ncash`, `2026mefal`, `2026txfor`, `2026txmca` | the same six keys | ✓ |
| Naive set equality | 3 of 491 | 3 of 491 | ✓ |

**No disagreement to record.** The figure this plan prints is the figure 10-04's `selectionModel.reconciliation.test.ts` will pin and 10-08 will quote — one number, one population, one rule.

### PICK-ORDER block — window 2026, warmup from 2026

| Bucket | Turns | Exact | Top-3 | Mean rank | Median | p90 | Coin floor |
|---|---|---|---|---|---|---|---|
| first pick | 1,128 | 42.91% | 73.49% | 3.09 | 2.0 | 7.0 | 3.95% |
| second pick | 1,128 | 22.34% | 47.52% | 5.10 | 4.0 | 11.0 | 7.85% |
| **POOLED** | **2,256** | **32.62%** | **60.51%** | **4.10** | **3.0** | **10.0** | **5.90%** |

Events scored: **141**. Both floors are cleared: ≥ 700 pooled turns (2,256) with ≥ 300 in each round (1,128 each).

**The honest comparison against the coin floor, unsoftened.** Greedy-by-SPR is well above the no-information floor in both rounds — 42.91% against 3.95% on first picks, and **22.34% against 7.85% on second picks**. Second-pick agreement is therefore **about 2.8x the floor, against roughly 11x for first picks**: the second pick is genuinely far less strength-driven than the first, and the exact-agreement rate is roughly **half** the first-pick rate while the real pick sits twice as deep in the model's list (median position 4 against 2, p90 11 against 7). 10-04 should not lean on the second-pick arm as hard as on the first; 10-08 should say the second pick is the weaker half out loud.

### Census — every named counter

| Counter | Count |
|---|---|
| `eventsConsideredCaptainWindow` | 507 |
| `eventsConsideredPickOrderWindow` | 148 |
| `eventsNotEightAlliance` | 16 |
| `eventsWithUnrankedRosterTeam` | 6 |
| `alliancesWithUnrankedCaptain` | 0 |
| `alliancesMissingFirstPick` | 0 |
| `secondPickTurnsAbsent` | 0 |
| `eventsWithoutBoundarySpr` | 3 |
| `turnsUnmodelled` | 0 |
| `captainEventsScored` | 485 |
| `pickOrderEventsScored` | 141 |

**No counter above removes an event on the basis of how its captains rank.** That counter is deliberately absent, and its absence is what a test asserts directly (`expect(keys.some((k) => /promoted|topEight|captainRank/i.test(k))).toBe(false)`).

### Both recorded windows

- **Captain half:** `2023-2026`, no SPR and no replay, so the full range is affordable (85 ms in the corpus-guarded test).
- **Pick-order half:** `2026`, warmup from `2026` (i.e. replayed from the start of its own season, no earlier warmup), through `scripts/publishedSprSnapshots.ts` (6,475 ms in the corpus-guarded test).

### Teacher forcing, observed

- **A team the real draft took at an earlier turn is absent from the pool at a later one, even though the model preferred it.** On the fixture, `frcB1` carries the highest total after the captains but was taken at alliance 1's first-pick turn; at alliance 2's turn the available pool does not contain it and `modelOrderingAtTurn(available, totals)[0]` is not `frcB1`.
- **A FUTURE captain is still available at an earlier alliance's first-pick turn.** At alliance 1's round-one turn the committed set is exactly `{frcA1}` — alliances 2 and 3's captains are not yet determined, because in the real draft they are not determined until alliance 1 has picked. Committing all eight captains up front would hand the model a pool the real draft never had.
- **The serpentine order:** `draftTurns(8)` is asserted as an exact sixteen-entry ordered list — round one over alliances 1 through 8 ascending, then **round two over alliances 8 down to 1**.
- **The commitment schedule is pinned, not incidental:** marking every captain allied up front changes alliance 2's predicted captain from rank 3 to rank 2 on the same fixture.
- **What each turn scores:** a round-one turn scores `picks[1]`, a round-two turn scores `picks[2]`, and the captain (`picks[0]`) is seeded and never scored as a model pick — asserted by index.

### `PRACTICAL ANSWER`, verbatim

```
   The progressive captain rule — at each alliance's turn, the captain is the highest-ranked team
   not yet allied — names the team that really was the captain 99.97% of the time
   (3879 of 3880 slots across 485 events), against 25.15% for the naive rule
   "the captains are the eight best-ranked teams" on the SAME slots. The naive rule reproduces the
   whole real captain SET at 3 of 491 events, which is why it is carried here as a labelled
   baseline and never as a filter.

   Greedy by published SPR picks the team a real alliance picked 32.62% of the time, pooled over
   2256 turns, against a no-information floor of 5.90%. The real pick typically sits at
   position 3.0 in the model's list (mean 4.10, ninth decile 10.0).
   FIRST and SECOND picks behave differently: 42.91% exact on first picks (1128 turns)
   against 22.34% on second picks (1128 turns), with floors of 3.95% and 7.85%.
   Reported in whichever direction they came out.
```

## New package.json entries

Printed by `node -e "const s=require('./package.json').scripts; ..."`:

```
measure:alliance-win-probability :: tsx scripts/measureAllianceWinProbability.ts
measure:district-award-base-rates :: tsx scripts/measureDistrictAwardBaseRates.ts
measure:selection-agreement :: tsx scripts/measureSelectionAgreement.ts
```

**None of the three carries an environment-file flag.** All three join `measure:field-averaged`, `measure:rp-mean-deficit`, `measure:match-band`, `measure:award-predictability` and `compare:epa-statbotics` rather than the `--env-file=.env`-carrying `ingest:*`/`publish:*` family. All three edits are append-only at the end of the `scripts` block, so 10-03's `publish:live-windows` line appends after them and rewrites nothing. `package.json`'s `dependencies` and `devDependencies` blocks are byte-identical and `pnpm-lock.yaml` is untouched (`git diff d7cffa32..HEAD -- pnpm-lock.yaml` is empty).

## Recorded constants and their commands

| Where | Constants | Generating command | Date | Guarded test wall time |
|---|---|---|---|---|
| `scripts/measureAllianceWinProbability.ts` | `MEASURED_WINDOW="2026"`, `MEASURED_WARMUP_FROM=2026`, `MEASURED_SCORED_ROWS=19792`, `MEASURED_TOTAL_ROWS=20907`, `MEASURED_MEAN_ABSOLUTE_GAP=0.05521610065219025`, `MEASURED_MEDIAN_ABSOLUTE_GAP=0.04173061762050173`, `MEASURED_P90_ABSOLUTE_GAP=0.12238168934831306`, `MEASURED_WINNER_DISAGREEMENT_RATE=0.04441188358932902`, `MEASURED_BROWSER_FORMULA_BRIER=0.14622846507962675`, `MEASURED_PUBLISHED_BRIER=0.1442591501111827`, `MEASURED_BROWSER_FORMULA_ACCURACY=0.7879064114250988`, `MEASURED_PUBLISHED_ACCURACY=0.79236301022992`, `MEASURED_COIN_BRIER=0.24941895715440582`, `MEASURED_SIGN_ONLY_BRIER=0.2111960201100925`, `MEASURED_FULLY_DEMO_MATCH=120`, `MEASURED_FULLY_DQ_ZERO_SCORE_SIDE=41`, `MEASURED_COLD_START=0`, `MEASURED_UNPRICEABLE=954` | `npx tsx scripts/measureAllianceWinProbability.ts --seasons 2026 --warmup-from 2026` | 2026-09-25 | **6,412 ms** (under the 25 s bar; the 2025-warmup window ran at 25,248 ms and was narrowed, with constants and test restated in the same commit) |
| `packages/core/districts/awardBaseRates.ts` | the per-season, per-cell, per-bucket and per-season-pooled pmf literals for 2019, 2020, 2022, 2023, 2024, 2025, 2026; `DISTRICT_AWARD_BASE_RATE_SEASONS` derived from their keys | `npx tsx scripts/measureDistrictAwardBaseRates.ts` | 2026-09-25 | **8,606 ms** for the whole file; the reconciliation asserts every pmf within 1e-6 and every `n` exactly, and the registered set by array equality |
| `scripts/measureSelectionAgreement.ts` | `MEASURED_CAPTAIN_WINDOW="2023-2026"`, `MEASURED_PICK_ORDER_WINDOW="2026"`, `MEASURED_PICK_ORDER_WARMUP_FROM=2026`, `MEASURED_EIGHT_ALLIANCE_EVENTS=491`, `MEASURED_USABLE_EVENTS=485`, `MEASURED_EVENTS_WITH_UNRANKED_ROSTER_TEAM=6`, `MEASURED_EXCLUDED_EVENT_KEYS=[2023gaalb, 2024vapor, 2025ncash, 2026mefal, 2026txfor, 2026txmca]`, `MEASURED_CAPTAIN_SLOTS=3880`, `MEASURED_PROGRESSIVE_CORRECT_SLOTS=3879`, `MEASURED_PROGRESSIVE_PERFECT_EVENTS=484`, `MEASURED_PROGRESSIVE_MISSES=["2026milac alliance 8"]`, `MEASURED_NAIVE_CORRECT_SLOTS=976`, `MEASURED_NAIVE_SET_EQUAL_EVENTS=3`, `MEASURED_NAIVE_SET_EQUALITY_DENOMINATOR=491`, `MEASURED_CAPTAIN_COIN_FLOOR=0.03751894072315206`, `MEASURED_PICK_TURNS=2256`, `MEASURED_FIRST_PICK_TURNS=1128`, `MEASURED_SECOND_PICK_TURNS=1128`, `MEASURED_PICK_ORDER_EVENTS_SCORED=141`, `MEASURED_EVENTS_WITHOUT_BOUNDARY_SPR=3`, `MEASURED_EXACT_AGREEMENT=0.3262411347517731`, `MEASURED_TOP3_AGREEMENT=0.6050531914893617`, `MEASURED_FIRST_PICK_EXACT_AGREEMENT=0.42907801418439717`, `MEASURED_SECOND_PICK_EXACT_AGREEMENT=0.22340425531914893`, `MEASURED_FIRST_PICK_TOP3_AGREEMENT=0.7349290780141844`, `MEASURED_SECOND_PICK_TOP3_AGREEMENT=0.475177304964539`, `MEASURED_MEAN_MODEL_RANK=4.097517730496454`, `MEASURED_MEDIAN_MODEL_RANK=3`, `MEASURED_P90_MODEL_RANK=10`, `MEASURED_POOLED_COIN_FLOOR=0.05901808119368394`, `MEASURED_FIRST_PICK_COIN_FLOOR=0.03949582708257352`, `MEASURED_SECOND_PICK_COIN_FLOOR=0.07854033530479476` | `npx tsx scripts/measureSelectionAgreement.ts --captain-seasons 2023-2026 --seasons 2026 --warmup-from 2026` | 2026-09-25 | captain describe **85 ms**, pick-order describe **6,475 ms**; both under the 25 s bar |

## Baseline vs post-plan failing test sets

| | Baseline (before Task 1) | Post-plan |
|---|---|---|
| `npx vitest run` from the REPO ROOT | *(not run at baseline; the three scoped runs below were)* | **259 files collected**, 5,792 passed, 1 skipped, **0 failed** |
| `npx vitest run packages/core/algorithms/simulation packages/core/districts packages/harness/browserSafeSchemas.test.ts` | 11 files, 200 passed, **failing set: {} (empty)** | 14 files, 251 passed, **failing set: {} (empty)** |
| `npx tsc --noEmit` | clean | clean |
| `npx tsc --noEmit -p apps/web/tsconfig.json` | clean | clean |

**Collected file count of the root-run full suite: 259.** That is the repo-root number, not the 77 `apps/web` would have reported (memory `project_test_scope_trap`); 10-01's close-out reported 254 files / 5,671 passed, and this plan added 5 test files and 121 tests.

**Failing test sets, side by side: both EMPTY.** No new failures, and the known `MetricHistoryTab.test.tsx` load flake did not appear in this run at all.

## Task Commits

1. **Task 1 (tracer): the browser's alliance win probability, measured against `pRedWin`** — `20b03a14` (feat)
2. **Task 2: walk-forward district award base-rate tables, both leak halves pinned** — `b1c8dc06` (feat)
3. **Task 3: selection agreement measured against the real draft, teacher-forced** — `20f5ed8d` (feat)

**The tracer feedback gate was run.** After committing Task 1, its `<verify>` was re-run end to end (`npx vitest run packages/core/algorithms/simulation/allianceWinProbability.test.ts scripts/measureAllianceWinProbability.test.ts packages/harness/browserSafeSchemas.test.ts` — 3 files, 65 tests, all passing) plus both tsconfigs clean, before any expansion task began. No checkpoint task exists in this plan by design (`REVERSIBILITY_GATES` off, every change a new file or a new `package.json` line with no consumer), so the gate was discharged by verification rather than by a human stop.

## Files Created/Modified

- `packages/core/algorithms/simulation/allianceWinProbability.ts` — 176 lines. One runtime import (`standardNormalCdf`). Header states the new-quantity/not-a-port provenance, the uncorrected-variance choice with `sigmaScore.ts`'s own quote, the not-SPR's-`predict()` distinction, and the generating command.
- `packages/core/algorithms/simulation/allianceWinProbability.test.ts` — 27 tests, every expected value hand-computed from the closed form.
- `scripts/publishedSprSnapshots.ts` — 311 lines. `snapshotForTeams`, `beforeMatchSnapshot` (the read-then-advance seam), `ratingsFromSnapshot`, `replaySeasons`, `replayPublishedSprSnapshots`. Opens no file, makes no network request, reads no environment variable.
- `scripts/measureAllianceWinProbability.ts` — 613 lines. Four arms, one scorer, named census, multiplier diagnostic, `PRACTICAL ANSWER`, `--seasons`/`--warmup-from`/`--json`.
- `scripts/measureAllianceWinProbability.test.ts` — 25 tests across a pure describe and a corpus-guarded one.
- `packages/core/districts/awardBaseRates.ts` — 361 lines, zero runtime imports.
- `packages/core/districts/awardBaseRates.test.ts` — 20 tests.
- `scripts/measureDistrictAwardBaseRates.ts` — 572 lines.
- `scripts/measureDistrictAwardBaseRates.test.ts` — 14 tests including both leak halves.
- `scripts/measureSelectionAgreement.ts` — 958 lines, two halves with two windows.
- `scripts/measureSelectionAgreement.test.ts` — 34 tests.
- `packages/harness/browserSafeSchemas.test.ts` — +15 lines, append-only (one entry-point constant and one `it(...)`). No existing line changed.
- `package.json` — +3 lines in the `scripts` block, append-only. Dependency blocks unchanged.

## Decisions Made

- **The two metric key literals live locally in the pricer.** `TOTAL_METRIC_KEY` is in `packages/core/algorithms/types.ts` and `SIGMA_METRIC_KEY` in `packages/harness/sigmaScore.ts` — a LEVEL-2 module a level-1 leaf must not import (`sigmaScoutLayer.ts`'s own header states the rule). Declaring both locally keeps the leaf at exactly one runtime import as the plan's action step required; drift is prevented by a strict-equality test against the real exports rather than by hope.
- **A district event is an event with a non-null `district_key`.** `event_type == 1` alone yields 418 eight-alliance events across 2023-2026; the non-null-`district_key` predicate yields exactly **491**, reproducing 10-04's population. District Championships and their divisions are district events and run the same eight-alliance draft.
- **`MIN_CELL_OBSERVATIONS = 100`, stated from the support rather than from what passes.** Six bins, so at 100 observations a bin holding 10% of the mass rests on ten events. 35 of 63 cells fall below it and are reported rather than filled.
- **The even-mass tie-break for `conditionalMedianPoints` returns the LOWER straddling value**, stated in the module's doc comment and asserted: a median shown beside a team's name has to be a value the team could actually earn, and of the two equally-defensible answers the lower one never overstates.
- **`beforeMatchSnapshot` does the whole read before the first write, in one function.** The leak test therefore drives the production sequencing rather than a restatement of it, and there is one ordering to get right instead of one per consumer.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] `publishedSprSnapshots.ts` had to emit an `after` snapshot for Task 3's pick-order half**

- **Found during:** Task 3
- **Issue:** Task 3's action step 3 requires each team's published `total` "as it stands at that event's qualification/playoff boundary — a team's value being the one from its most recently played match **at or before** the boundary". The `before` map cannot supply that: the value from a team's last qualification match is the value AFTER that match, and `before` carries the value from the match before it. Reading a one-match-stale value would have measured a different quantity than the one the browser reads off the event artifact.
- **Fix:** Added a `snapshotForTeams` pure read helper and an `after` field to `PublishedSprSnapshotRow`, populated from the same post-fold values `beforeMatchSnapshot`'s advance half already computes. Its doc comment states plainly why it is not a leak: it is the same walk-forward quantity read one match later, and a consumer that pairs it with THIS match's own outcome would be leaking, while a consumer that carries it forward to a LATER decision is not. The win-probability measurement does not read it.
- **Files modified:** `scripts/publishedSprSnapshots.ts`, `scripts/measureAllianceWinProbability.test.ts` (fixture widened by one field)
- **Verification:** `npx tsc --noEmit` clean; `scripts/measureAllianceWinProbability.test.ts` 25/25 still passing, including the leak test.
- **Committed in:** `20f5ed8d`

**Note on the file list:** `scripts/publishedSprSnapshots.ts` is in the PLAN's `files_modified`, but is not in Task 3's own `<files>` list — a plan-level oversight, since Task 3 is the only consumer of the boundary value. No file outside the plan's thirteen was touched.

**2. [Rule 3 - Blocker] The recorded window for the win-probability measurement was narrowed from 2025-warmup to 2026-alone**

- **Found during:** Task 1
- **Issue:** The plan instructs "start with scored season 2026 and warmup from 2025, measure the test's wall time, and if it exceeds 25 s narrow to 2026 alone and restate the window in BOTH the recorded constants and the test in the same commit." The 2025-warmup describe measured **25,248 ms**, over the bar.
- **Fix:** Narrowed to `--seasons 2026 --warmup-from 2026`, re-ran, and restated every recorded constant and the test's window in the same commit. The narrowed describe runs at 6,412 ms. Both runs' figures are recorded above; only the narrowed one is pinned.
- **Files modified:** `scripts/measureAllianceWinProbability.ts`, `packages/core/algorithms/simulation/allianceWinProbability.ts` (the header's stated command)
- **Committed in:** `20b03a14`

**3. [Rule 1 - Bug] A pure-fixture round-breakout test was vacuous and was rewritten**

- **Found during:** Task 3
- **Issue:** The first fixture for "first-pick and second-pick turns are accumulated separately and never pooled silently" produced 0.5 for both the first-pick figure and the pooled figure, so the `not.toBe` assertion failed — and would have proven nothing had it passed.
- **Fix:** Changed one turn's model rank so the three figures are three distinct numbers (50% first, 0% second, 25% pooled), and asserted all three rather than only their inequality. The dependent hand-computed mean/median assertions were restated in the same edit.
- **Files modified:** `scripts/measureSelectionAgreement.test.ts`
- **Committed in:** `20f5ed8d`

### Documented, not fixed

**The pick-order half's `alliancesMissingFirstPick` counter is shared with the captain half.** A round-one turn with no real `picks[1]` is the same alliance-level condition the captain half counts, and the two halves run over different windows, so the printed figure is the union rather than a per-half count. Stated in a code comment at the increment site. Both counters read **0** in the measured windows, so nothing is currently ambiguous.

---

**Total deviations:** 3 auto-fixes (2 x Rule 3, 1 x Rule 1) plus 1 documented ambiguity.
**Impact on plan:** None on scope. Deviation 1 adds one field to a file the plan already owns; deviation 2 is the plan's own prescribed fallback, executed; deviation 3 strengthens a test that would otherwise have been vacuous.

## Issues Encountered

- **The plan's `<baseline>` z-table pin for Φ(1) is stated as exact to more digits than the shared erf carries, which is expected and was verified within the stated bound.** `standardNormalCdf(1)` returns `0.8413447361676363` against the tabulated `0.8413447460685429` — a difference of 9.9e-9, well inside the 2e-7 Abramowitz-Stegun 7.1.26 bound the plan names. `Φ(1.959963984540054)` returns `0.9750000690392423` (6.9e-8 off 0.975), and `Φ(0)` is **exactly** 0.5 by the module's own `z === 0` guard. The shared erf has not changed; nothing to report as a finding.
- **`coldStart` is 0 in the win-probability census even for a from-cold 2026 replay.** `corpusColdStartIndex` is corpus-GLOBAL (every one of a match's six robots making its first corpus appearance), and no 2026 match qualifies. The counter is still reported and asserted at 0 rather than dropped, so a future window that does contain cold-start matches shows them.
- **`git add` warns `LF will be replaced by CRLF` on every new file.** Expected on this machine; no structural test in this plan regexes for a line ending (memory `project_crlf_worktree_harness_tests` applies to worktrees, and this ran in the main checkout).

## User Setup Required

None. Nothing in this plan fetches, publishes, deploys or installs. `pnpm-lock.yaml` is untouched and `package.json`'s dependency blocks are unchanged.

## Security and secrets

**No secret was read, printed, copied, hashed or interpolated at any point in this plan.** `.env` was never passed to the `Read` tool, never `cat`/`head`/`echo`'d, never interpolated into a shell command, a log line, a test name or a commit message. None of the three new `package.json` entries carries an environment-file flag — the safe state here is structural, not procedural.

**No network request was made by any task.** All three scripts open `data/corpus.sqlite` read-only through `openCorpusReadOnly` and make no HTTP call, no R2 call and no D1 call. Nothing was published, deployed, pushed or fetched.

**Threat register dispositions discharged:** T-10-02-01 (variance term — pinned by the Φ(1/√275)-not-Φ(1/√825) assertion and re-tested by the multiplier-3 diagnostic row), T-10-02-02 (walk-forward boundary — single seam plus the observed leak test), T-10-02-03 (both award leak halves — two independent fixtures), T-10-02-04 (one scorer — every arm through `scoreSet`, asserted against a direct call including a tie row and a no-call row), T-10-02-05 (thin cells — bar asserted at the boundary, `source` on every result), T-10-02-06 (unregistered season — typed error naming the registered set), T-10-02-07 (import graph — guard observed failing then passing), T-10-02-08 (`.env` — structurally untouched), T-10-02-09 (constants beside their command), T-10-02-10 (window narrowed and wall times recorded), T-10-02-13 (population floors, no captain-rank gate), T-10-02-14 (one rule, one population, figures matched exactly).

## Self-Check: PASSED

- All 13 files in the plan's `files_modified` exist on disk.
- All three task commits exist in `git log`: `20b03a14`, `b1c8dc06`, `20f5ed8d`.
- Plan `<verification>` re-run at close-out:
  1. `npx vitest run packages/core/algorithms/simulation` — passing, `rankSimulation.test.ts` untouched.
  2. `npx vitest run packages/core/districts` — 10 files, 171 tests passing, `reconciliation.test.ts` / `locks.test.ts` / `pointModel.test.ts` / `qualification.test.ts` / `prequalified.test.ts` all unchanged.
  3. All three script test files run with their corpus-guarded describes RUNNING (not skipping): 6,412 ms, 8,606 ms (whole file), and 85 ms + 6,475 ms.
  4. `npx vitest run packages/harness/browserSafeSchemas.test.ts` — 13 passing, the new `it(...)` observed failing first.
  5. `npx vitest run` from the repo root — **259 files**, 5,792 passed, 1 skipped, 0 failed.
  6. `npx tsc --noEmit` clean AND `npx tsc --noEmit -p apps/web/tsconfig.json` clean.
  7. All three scripts ran to completion; every recorded constant equals what those runs printed.
  8. `git diff --stat d7cffa32..HEAD` touches exactly the thirteen files in `files_modified`; `pnpm-lock.yaml` and both dependency blocks unchanged.
  9. No secret read or printed; no network request made.

## Next Phase Readiness

Ready for 10-04, and for 10-06, 10-07 and 10-08 in wave order.

- **10-04** imports `allianceWinProbability` (see `## Alliance win-probability API surface` for the exact signatures and all ten `undefined` conditions) and `awardBaseRate` (see `## Award base-rate tables` for the signature and the three `source` values). Three things it must know: (a) **five of nine cells are empty in every registered season** and resolve through `bucket-pooled`, so a consumer that assumes a `"cell"` source will be wrong most of the time; (b) `awardBaseRate` **throws** `UnknownAwardBaseRateSeasonError` for 2016, 2017 and 2018; (c) its `selectionModel.reconciliation.test.ts` must pin **3,879 of 3,880**, **484 of 485 perfect**, the single miss at `2026milac` alliance 8, and exactly the six exclusions listed above — computed by the same commitment schedule and the same non-null-`district_key` event predicate, or the two numbers will not be one number.
- **10-06** reads the same `awardBaseRate` lookup 10-04 does and must not recompute a rate from the corpus at publish time.
- **10-07** reads `allianceRatingsFromMetrics` when assembling the Web Worker's request from event artifacts, so the `total`/`sigma` indexing exists in one place.
- **10-08** may quote only the numbers in `## The win-probability gap`, `## Award base-rate tables` and `## Selection agreement`. The sentence it must not soften: **greedy-by-SPR's second-pick exact agreement is 22.34% against a 7.85% floor — about 2.8x the floor, against roughly 11x for first picks, and roughly half the first-pick rate.**

Two caveats worth carrying forward. **Neither new module has a caller**, by design — wiring is 10-04's and 10-07's job. And **every corpus-guarded describe in this plan skips wherever `data/corpus.sqlite` is absent**, which is CI; the pure tests are what CI actually proves, so any future change to these rules must keep them in step.

---
*Phase: 10-district-points-ledger*
*Completed: 2026-09-25*
