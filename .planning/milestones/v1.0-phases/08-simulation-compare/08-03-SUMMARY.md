---
phase: 08-simulation-compare
plan: 03
subsystem: pipeline
tags: [simulation, monte-carlo, browser-safe, rp-distribution]

requires:
  - phase: 08-simulation-compare
    plan: 02
    provides: EventMatchSchema.redRpPmf/blueRpPmf and actualRedRp/actualBlueRp contracts (not consumed directly by this plan — it takes pmf arrays as function arguments, not artifact fields)
provides:
  - "packages/core/algorithms/simulation/rankSimulation.ts — simulateRanks, drawCategorical, mulberry32, SimMatchInput/SimTeamBaseline/SimResult, InvalidPmfError/UnknownTeamKeyError"
  - "RANK_SIMULATION_ENTRY_POINT — the sixth browserSafeSchemas.test.ts entry point, proving the module is browser-bundleable"
affects: [08-04 (continuousQuantile consumes SimResult.rankHistograms), 08-07 (browser Worker imports simulateRanks), 08-08 (Node control-run script imports simulateRanks), 08-11 (simulationInputs.ts builds the SimMatchInput/SimTeamBaseline caller owns D-13 row selection and D-12 earnedRpSum precedence), 08-13 (owns SC-2's representative measured runtime), 08-14 (renders rankHistograms as median/band/histogram)]

actuals:
  tokens: 8821
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Browser-safe leaf module under packages/core/algorithms/, registered as a sixth entry point in browserSafeSchemas.test.ts (Node-builtin-only check, following the RP_CONSTANTS_ENTRY_POINT precedent)"
    - "mulberry32 copied verbatim a third time (packages/harness/identifiability.ts and sigma1/rp/distribution.ts are the first two), never imported, to keep ml-matrix out of the browser bundle"
    - "Up-front O(matches) validation pass before the draw loop (pmf shape + team-key resolution), rather than per-draw checks, so the hot path costs O(draws x matches) with zero allocation"

key-files:
  created:
    - packages/core/algorithms/simulation/rankSimulation.ts
    - packages/core/algorithms/simulation/rankSimulation.test.ts
  modified:
    - packages/harness/browserSafeSchemas.test.ts

key-decisions:
  - "Baseline correction: the plan's <baseline> block expected browserSafeSchemas.test.ts to report 5 tests pre-plan; the real pre-plan count was 6 (08-02, which landed before this plan started despite both being wave 1, already added its own case). Recorded honestly rather than forcing the plan's stated number — post-plan count is 7, one more than the REAL baseline of 6."
  - "Test 9's three malformed-pmf sub-cases (residue, NaN, negative) were written as three assertions inside ONE it() block, not three separate it() blocks, so the plan's own stated printed-count progression (4 -> 8 -> 14) holds exactly."
  - "Test 3's original blueHistogram[5] assertion targeted the wrong team key (frcBlue1, which ties for the BEST rank among the tied losing alliance under ascending team-key tie-break) -- corrected to frcBlue3, the team that actually lands at the worst rank among the tied group. Caught live by the RED/GREEN cycle, not assumed."
  - "Test 6 and Test 12's pmf fixtures use an elevated scoreVariance (200, vs the moments() default of 0.000001) so the RP outcome genuinely varies draw to draw -- the default fixture variance is near-zero, which makes the win/RP outcome deterministic regardless of seed and would make a seed-varies-the-output test pass vacuously."

patterns-established:
  - "A pure Monte Carlo core with a single up-front validation pass, tested directly with plain Vitest (no jsdom, no Worker) -- the shape 08-07's browser Worker and 08-08's Node control-run script will both import unchanged"

requirements-completed: []

coverage:
  - id: EVNT-07-core-math
    description: "simulateRanks draws one total-RP value per alliance per remaining match directly from that match's pmf, accumulates per team, ranks by average RP per match played (FRC's Ranking Score), and returns a complete per-team rank histogram (every histogram sums to exactly draws)"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "packages/core/algorithms/simulation/rankSimulation.test.ts — 14 cases across Tests 1-14"
        status: pass
    human_judgment: false
  - id: D-13
    description: "simulateRanks simulates every row it is handed with no row-classification concept of its own; row selection is 08-11's"
    verification:
      - kind: unit
        ref: "rankSimulation.test.ts Test 14 (zero remaining matches valid) + doc-comment/grep gates"
        status: pass
    human_judgment: false
  - id: D-14
    description: "Simulated ties are recorded as ties, separated only by a team-key comparison for reproducibility; no claim of official tie-break parity"
    verification:
      - kind: unit
        ref: "rankSimulation.test.ts Test 7 (frc1114/frc254/frc48, lexicographic order pinned against numeric order)"
        status: pass
    human_judgment: false
  - id: browser-safety
    description: "Two independent guards (browserSafeSchemas.test.ts's sixth entry point, packages/core/isomorphic.test.ts) prove the module is bundleable by a browser; module carries zero import statements"
    verification:
      - kind: unit
        ref: "browserSafeSchemas.test.ts (7 tests) + isomorphic.test.ts (2 tests), non-vacuity hand-verified with a temporary node:crypto import"
        status: pass
    human_judgment: false
duration: ~35min
completed: 2026-08-31
status: complete
---

# Phase 8 Plan 3: Shared rank-simulation core (rankSimulation.ts) Summary

**A new browser-safe leaf module, `packages/core/algorithms/simulation/rankSimulation.ts`, computes a complete 1000-draw rank-distribution histogram per team from real pipeline-produced RP pmfs — one implementation, zero runtime imports, two independent browser-safety guards, and a hardened input boundary that throws named errors on malformed pmfs or unknown team keys rather than silently producing a plausible-but-wrong result.**

## Baseline (recorded before Task 1)

The plan's own `<baseline>` block expected `browserSafeSchemas.test.ts` to report **5 tests, 0 skipped**. The measured reality, run before any Task 1 edit:

```
npx vitest run packages/harness/browserSafeSchemas.test.ts
Test Files  1 passed (1)
     Tests  6 passed (6)
```

```
npx vitest run packages/core/isomorphic.test.ts
Test Files  1 passed (1)
     Tests  2 passed (2)
```

**This is a deviation from the plan's stated baseline, not a regression**: 08-02 (this phase's parallel wave-1 plan) had already landed its own `browserSafeSchemas.test.ts` case before this plan's execution began, even though both plans are wave 1 — 08-02's own SUMMARY independently records the same fact ("browserSafeSchemas.test.ts: 6 passed, 0 failed (unchanged)"). The real baseline is 6, not 5.

Post-plan counts: `browserSafeSchemas.test.ts` **7 passed** (one more than the real baseline of 6), `isomorphic.test.ts` **2 passed** (unchanged).

## Observed RED (Task 1, Test 1 — quoted, not claimed)

Before `rankSimulation.ts` existed:

```
FAIL  |node| packages/core/algorithms/simulation/rankSimulation.test.ts [ packages/core/algorithms/simulation/rankSimulation.test.ts ]
Error: Cannot find module './rankSimulation.js' imported from
C:/Users/Jacob/Documents/GitHub/SigmaScout/packages/core/algorithms/simulation/rankSimulation.test.ts
```

## Non-vacuity hand-verification (Task 1's sixth browserSafeSchemas.test.ts case)

**With a temporary `import { randomBytes } from "node:crypto";` added to `rankSimulation.ts`:**

```
FAIL  |node| packages/harness/browserSafeSchemas.test.ts > browser-safe schema import graph >
never reaches a Node built-in import from packages/core/algorithms/simulation/rankSimulation.ts
(checked for Node built-ins only — this entry point legitimately lives under
packages/core/algorithms/, plan 08-03 Task 1)
AssertionError: Node built-in import(s) reachable from packages/core/algorithms/simulation/rankSimulation.ts:
C:\Users\Jacob\Documents\GitHub\SigmaScout\packages\core\algorithms\simulation\rankSimulation.ts imports "node:crypto"

Test Files  1 failed (1)
     Tests  1 failed | 6 passed (7)
```

**After reverting the temporary import:**

```
Test Files  3 passed (3)
     Tests  13 passed (13)
```
(rankSimulation.test.ts's 4 Task-1 cases + browserSafeSchemas.test.ts's 7 cases + isomorphic.test.ts's 2 cases.)

## Printed test counts per task

| After task | `rankSimulation.test.ts` | Skipped |
|---|---|---|
| Task 1 | 4 passed | 0 |
| Task 2 | 8 passed | 0 |
| Task 3 | 14 passed | 0 |

All three counts read from printed Vitest output, never from an exit code, and never wrapped in `timeout` (per `.claude/CLAUDE.md`'s logged `timeout`-false-green lesson).

**Note on Task 3's Test 9:** the plan's `<behavior>` describes Test 9 as "three sub-cases fed directly to `drawCategorical`." These were written as three assertions inside **one** `it()` block, not three separate `it()` blocks — this is what makes the printed-count progression land on the plan's own stated 4 → 8 → 14 rather than 4 → 8 → 16.

## Test 7's team keys

`frc254`, `frc1114`, `frc48` — chosen so lexicographic order (`"frc1114" < "frc254" < "frc48"`, since `'1' < '2' < '4'` in the second character) differs from numeric order (`48 < 254 < 1114`). The test pins the comparator's actual ascending-string-comparison behavior rather than an accidental numeric agreement.

## Test 12's measured worst-case duration

**17.59 ms** for 78 teams, 135 remaining matches, 1000 draws — measured via a standalone `tsx` script reproducing Test 12's exact fixture (deterministic pmf source, `mulberry32(2024)` seed), run outside Vitest to get a clean wall-clock reading (Vitest's own `console.log` output was not visible in this run's captured stdout — the standalone script is the reported number).

**Machine:** Windows 11 Pro, 12 logical processors (single physical processor package, per `systeminfo`).

No timing threshold is asserted in the test itself — this is supporting evidence for SC-2, which 08-13 owns the representative measured figure for.

## Exported surface (final)

```typescript
// packages/core/algorithms/simulation/rankSimulation.ts — zero import statements
export function mulberry32(seed: number): () => number;
export function drawCategorical(pmf: readonly number[], rng: () => number): number;

export interface SimMatchInput {
  readonly redTeamKeys: readonly string[];
  readonly blueTeamKeys: readonly string[];
  readonly redRpPmf: readonly number[];
  readonly blueRpPmf: readonly number[];
}

export interface SimTeamBaseline {
  readonly teamKey: string;
  readonly earnedRpSum: number;   // a TOTAL, not a per-match average — see below
  readonly matchesPlayed: number;
}

export interface SimResult {
  readonly rankHistograms: ReadonlyMap<string, Int32Array>; // teamKey -> per-rank DRAW COUNT, indexed rank-1
  readonly draws: number;
}

export class InvalidPmfError extends Error {}   // empty or non-finite pmf entry
export class UnknownTeamKeyError extends Error {} // match names a team absent from baselines

export function simulateRanks(
  remainingMatches: readonly SimMatchInput[],
  baselines: readonly SimTeamBaseline[],
  draws: number,
  rng: () => number
): SimResult;
```

`SimResult.rankHistograms` values are `Int32Array`s of length `baselines.length`, one entry per possible rank, containing the DRAW COUNT that landed the team at that rank (index `rank - 1`) — never a probability. This is exactly the `dist` shape 08-04's `continuousQuantile(dist, p, draws)` expects unconverted, and both `Map` and `Int32Array` are structured-cloneable, so 08-07's Worker can `postMessage` a `SimResult` with no conversion.

## `SimTeamBaseline.earnedRpSum` is a TOTAL (PD-02) — restated here for 08-11

**`earnedRpSum` is a running SUM of RP across a team's played matches, not a per-match average.** 08-11's `simulationInputs.ts` must, when sourcing from TBA's Ranking Score (`EventTeamSchema.rp`, itself a per-match AVERAGE per `pageArtifacts.ts`'s own doc comment), multiply by `matchesPlayed` before constructing a `SimTeamBaseline` — passing the average unconverted mis-ranks the entire simulated field by a factor of `matchesPlayed`. This is stated at the type (`rankSimulation.ts`'s own doc comment on `earnedRpSum`) and restated here per the plan's explicit `<output>` requirement, since no test on either side of this boundary can catch the mistake alone.

## Task Commits

1. **Task 1 (TRACER): shared rank-simulation core with real pipeline pmfs** — `76c4c93c`
2. **Task 2: pin D-13/D-14 as tests and contract doc comments** — `2791d791`
3. **Task 3: harden input boundary, prove worst-case runs** — `9fbdd302`

Task 1's tracer feedback gate: re-ran its full `<verify>` command (`rankSimulation.test.ts`, `browserSafeSchemas.test.ts`, `isomorphic.test.ts`) immediately after committing — all green (13 passed) — before starting Task 2's expansion work. No `checkpoint:human-verify` was surfaced for the tracer: this task's verification is 100% automated test output (no URL, no UI, nothing visual for a human to evaluate), and the session's Auto Mode directive was read as license to continue rather than pause on a checkpoint with nothing new for a human to look at beyond the already-quoted test output above.

## Files Created/Modified

- `packages/core/algorithms/simulation/rankSimulation.ts` — new browser-safe leaf module (286 lines): `mulberry32`, `drawCategorical`, `SimMatchInput`/`SimTeamBaseline`/`SimResult`, `InvalidPmfError`/`UnknownTeamKeyError`, `simulateRanks`
- `packages/core/algorithms/simulation/rankSimulation.test.ts` — new pure-unit test suite (390 lines, 14 cases), all pmf fixtures produced via `rpPmfForMatch` (real pipeline output)
- `packages/harness/browserSafeSchemas.test.ts` — sixth entry point (`RANK_SIMULATION_ENTRY_POINT`) plus its mirrored `it(...)` block and an extended file-header paragraph

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test 3's initial team-key assertion targeted the wrong tied team**
- **Found during:** Task 1, first verification run
- **Issue:** The original test asserted `frcBlue1`'s histogram concentrated at the worst rank (index 5), but under the ascending team-key tie-break, `frcBlue1` (the lexicographically smallest key among the tied losing alliance) actually lands at the BEST rank within that tied group, not the worst.
- **Fix:** Reassigned the "lands last" assertion to `frcBlue3` (the lexicographically largest key among the tied group), with a comment explaining the tie-break direction.
- **Files modified:** `packages/core/algorithms/simulation/rankSimulation.test.ts`
- **Commit:** `76c4c93c`

**2. [Rule 1 - Bug] Tests 6 and 12's initial pmf fixtures used near-zero score variance, making the RP outcome deterministic regardless of seed**
- **Found during:** Task 2, first verification run (Test 6 failed: `expected false to be true`)
- **Issue:** `moments()`'s default `scoreVariance` (0.000001) is near-zero, so the underlying score draw barely deviates from its mean — the RP outcome came out identical across two different seeds, making the "different seed produces a different distribution" assertion fail (the two histograms were byte-identical).
- **Fix:** Added a `realPmfPairWithSpread()` fixture builder using `scoreVariance: 200`, so the RP outcome has genuine draw-to-draw variance, and used it for Test 6 (and Test 12, for a representative worst-case fixture).
- **Files modified:** `packages/core/algorithms/simulation/rankSimulation.test.ts`
- **Commit:** `2791d791`

### Baseline correction (not a bug — documented above)

The plan's `<baseline>` block stated `browserSafeSchemas.test.ts` should report 5 tests pre-plan. The real pre-plan count was 6 (08-02 had already landed its own case). Recorded honestly under "Baseline" above rather than silently reconciled.

## Issues Encountered

- Vitest's `console.log` output from Test 12 was not visible in this environment's captured Bash-tool stdout (the `RUN`/summary lines appeared, but the interleaved `console.log` line did not, even with `-t` test-name filtering). Worked around by running a standalone `tsx` script (not committed — created and deleted in a scratch location) reproducing Test 12's exact fixture to obtain a clean wall-clock reading. The committed test itself still logs the duration via `console.log` for anyone running it directly with a terminal that shows Vitest's console interception.

## Nothing published, no R2 write, no dependency, no credential

- **No R2 object was written or deleted.** No publish command of any kind was run.
- **No npm dependency was added.** `git diff --stat package.json pnpm-lock.yaml` is empty for every task commit in this plan.
- **`.env` was never read, `cat`'d, `echo`'d or interpolated.** No task in this plan had any reason to reach for a credential — the module reads no artifact and calls no network.
- **`git diff --stat` for the whole plan touches only the three files declared in `files_modified`** (`rankSimulation.ts`, `rankSimulation.test.ts`, `browserSafeSchemas.test.ts`) — confirmed via `git diff --stat 76c4c93c~1 9fbdd302`.

## Full-repo verification

`npx vitest run` from the repo root: **2180 passed, 2 failed, 1 skipped** across 129 test files. Both failures are `packages/harness/payloadBudget.test.ts`'s pre-existing accepted signed overrides (WINDOWS.md ledger #11 `teams/{year}` and ledger #15 team page) — zero new failures introduced by this plan. (The plan's own `<baseline>` text names only ledger #11; the real baseline, confirmed against 08-02's own SUMMARY, already carries both #11 and #15 — same non-regression, more completely described.)

## Next Phase Readiness

- 08-04 can import `simulateRanks`'s `SimResult.rankHistograms` output directly into `continuousQuantile(dist, p, draws)` — the shape contract is stated at the type and pinned by the test suite.
- 08-07's browser Worker and 08-08's Node control-run script can both import `simulateRanks` unchanged — the module has zero runtime imports, proven by two independent guards.
- 08-11's `simulationInputs.ts` is the sole owner of D-13 row selection and D-12 `earnedRpSum` unit conversion; this module enforces neither and documents both boundaries at the code.
- 08-13 owns SC-2's representative measured runtime; this plan's 17.59ms figure (78 teams/135 matches/1000 draws, this machine) is the earliest available supporting evidence, not the SC-2 record itself.

## Self-Check: PASSED

All 3 modified/created files confirmed present on disk with the expected changes (`packages/core/algorithms/simulation/rankSimulation.ts`, `packages/core/algorithms/simulation/rankSimulation.test.ts`, `packages/harness/browserSafeSchemas.test.ts`); all 3 task commits (`76c4c93c`, `2791d791`, `9fbdd302`) confirmed in `git log --oneline`.
