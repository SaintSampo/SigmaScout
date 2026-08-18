---
phase: quick-260818-inm
plan: 01
subsystem: algorithms
tags: [zod, sigma1, epa, harness, security, breakdown-parse]

# Dependency graph
requires:
  - phase: 03-tuning-ranking-points-versioning
    provides: sigma1's D-05 fallback path, EPA's fallback path, the harness CLI's per-algorithm reporting shape, the phase-03 security audit that identified T-03-18b
provides:
  - "tryParseBreakdownPair + isRecoverableBreakdownParseError (packages/core/algorithms/breakdown/index.ts) — the shared, narrow guard replacing an unconditional parseBreakdown call at both algorithms' update() boundaries"
  - "BreakdownParseTelemetry + breakdownParseFailureCountOf (packages/core/algorithms/types.ts) — the shared telemetry seam"
  - "breakdownParseFailureCount on Sigma1State and EpaState, cumulative, never reset by carrySeason"
  - "reportBreakdownParseFailures in packages/harness/cli.ts, wired into both runSeason and runEventMode"
  - "WINDOWS.md ids 4 and 5 closed with a recorded reason"
affects: [gsd-secure-phase-3, phase-04-publish-pipeline]

# Actuals (#2632)
actuals:
  tokens: 13873
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Narrow, positive-membership error classification (isRecoverableBreakdownParseError) instead of a bare catch, mirroring identifiability.ts's precedent but strictly narrower — this is the second instance of the T-03-21 pattern established by CR-01's isRpEligibleEventType"
    - "Deliberately overlapping, never-merged counters (breakdownParseFailureCount vs. rpSkippedMatchCount / fallbackSkipped) recording cause vs. effect on the same event"

key-files:
  created: []
  modified:
    - packages/core/algorithms/breakdown/index.ts
    - packages/core/algorithms/types.ts
    - packages/core/algorithms/sigma1/index.ts
    - packages/core/algorithms/epa.ts
    - packages/harness/cli.ts
    - packages/core/algorithms/breakdown/breakdown.test.ts
    - packages/core/algorithms/sigma1/sigma1.test.ts
    - packages/core/algorithms/sigma1/params.test.ts
    - packages/core/algorithms/epa.test.ts
    - packages/core/algorithms/carryover.test.ts
    - .planning/WINDOWS.md

key-decisions:
  - "D-Q1 (plan): ONE shared tryParseBreakdownPair helper, both call sites (sigma1/index.ts, epa.ts), parsing both alliances as a pair from a single JSON.parse — parseBreakdown() itself is untouched, still used by identifiability.ts and reconciliation.test.ts which deliberately want the loud version"
  - "D-Q2 (plan), shipped as specified: breakdownParseFailureCount is a SEPARATE counter from rpSkippedMatchCount (Sigma1) and fallbackSkipped (EPA) — a malformed match increments breakdownParseFailureCount (the cause) AND rpSkippedMatchCount (the effect); fallbackSkipped stays untouched (its permanently-zero invariant describes a different, never-run code path)"
  - "D-Q3 (plan), shipped as specified: isRecoverableBreakdownParseError is true only for ZodError or SyntaxError; componentMapForSeason(season) is resolved BEFORE the try in tryParseBreakdownPair, and sigma1/index.ts's/epa.ts's own componentMapForSeason(season) call at the top of update() (unchanged, pre-existing) means an unmapped season throws before breakdown parsing is ever reached"
  - "Rule 3 (blocking-issue auto-fix, out of plan scope but required to run the ledger tool): WINDOWS.md entry #3 carried a stale status value \"resolved\" that gsd-tools' ledger schema does not accept (only open/waived/fixed) — normalized to \"fixed\" and corrected the frontmatter open/fixed counts to match, since every `windows` subcommand validates the whole ledger before running"

requirements-completed: [T-03-18b, WINDOWS-4, WINDOWS-5]

coverage:
  - id: D1
    description: "A malformed self-reported score_breakdown degrades to the existing D-05 fallback path instead of aborting the harness — proven end-to-end on Sigma1 first (tracer), then EPA"
    requirement: "T-03-18b"
    verification:
      - kind: unit
        ref: "packages/core/algorithms/sigma1/sigma1.test.ts#sigma1 — T-03-18b: a malformed self-reported breakdown degrades to the D-05 fallback, never a throw"
        status: pass
      - kind: unit
        ref: "packages/core/algorithms/epa.test.ts#epa.update — T-03-18b: a malformed self-reported breakdown degrades to the D-05 fallback, never a throw"
        status: pass
      - kind: integration
        ref: "pnpm harness --season 2024 --algorithm sigma1 --include-offseason (exit 0, breakdownParseFailureCount 1004)"
        status: pass
      - kind: integration
        ref: "pnpm harness --event 2024wvrox --algorithm sigma1 (exit 0, breakdownParseFailureCount 19)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Narrowness proof: a non-parse error (unmapped season, non-finite assertion, any future non-Zod defect) still propagates and aborts loudly"
    requirement: "T-03-21"
    verification:
      - kind: unit
        ref: "packages/core/algorithms/breakdown/breakdown.test.ts#isRecoverableBreakdownParseError (T-03-21 narrowness proof)"
        status: pass
      - kind: unit
        ref: "packages/core/algorithms/sigma1/sigma1.test.ts#update() on a match whose event key names an unregistered season still throws"
        status: pass
    human_judgment: false
  - id: D3
    description: "Positive controls: a well-formed payload still takes the full parse path on both algorithms — proves the guard cannot silently disable real component parsing"
    requirement: "T-03-28"
    verification:
      - kind: unit
        ref: "packages/core/algorithms/sigma1/sigma1.test.ts#positive control (non-negotiable)"
        status: pass
      - kind: unit
        ref: "packages/core/algorithms/epa.test.ts#positive control: a well-formed payload leaves breakdownParseFailureCount at 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "Both committed predictionStreamSha256 digests reproduce bitwise — the guard is a provable no-op on the 2022 official-event digest slices"
    requirement: "T-03-19"
    verification:
      - kind: integration
        ref: "pnpm test packages/harness/digest.test.ts (3 passed, no skips)"
        status: pass
    human_judgment: false
  - id: D5
    description: "WINDOWS.md ids 4 and 5 closed via gsd-tools, with a reason recorded on both the table and JSON block"
    requirement: "WINDOWS-4, WINDOWS-5"
    verification:
      - kind: other
        ref: "node gsd-tools.cjs windows status (open_count dropped from 4 genuinely-open entries to 2, ids 4/5 status fixed)"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-08-18
status: complete
---

# Quick Task 260818-inm: Guard parseBreakdown Against Self-Reported Data Summary

**Sigma1 and EPA now degrade a self-reported offseason `score_breakdown` that fails its season Zod schema to the existing D-05 fallback path (via a new shared `tryParseBreakdownPair` guard) instead of aborting the harness batch — closing T-03-18b and both previously-blocking WINDOWS.md entries.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-08-18 (session start)
- **Completed:** 2026-08-18T18:08:03Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments

- `tryParseBreakdownPair`/`isRecoverableBreakdownParseError` in `breakdown/index.ts`: a narrow guard (true only for `ZodError`/`SyntaxError`) replacing the unconditional `parseBreakdown` calls at both `sigma1/index.ts:735-736` and `epa.ts:432-433`, mirroring `identifiability.ts:239-249`'s bare-catch precedent but strictly narrower.
- `BreakdownParseTelemetry`/`breakdownParseFailureCountOf` in `types.ts`: the shared counter seam both algorithms' states implement and one CLI reader (`reportBreakdownParseFailures`) prints for both, from `runSeason` and `runEventMode`.
- `Sigma1State`/`EpaState` each carry `breakdownParseFailureCount`, cumulative, never reset by `carrySeason` — deliberately separate from `rpSkippedMatchCount`/`fallbackSkipped` (cause vs. effect, D-Q2).
- Regression suite with non-negotiable positive controls proving a well-formed payload still takes the full real parse path on both algorithms (`sigma1.test.ts`, `epa.test.ts`), plus direct unit tests for the narrowness predicate and the malformed-payload classification (`breakdown.test.ts`).
- Both previously-blocked harness commands now exit 0 with the malformed-match count printed. WINDOWS.md ids 4 and 5 closed via `gsd-tools windows fixed`.

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end guarded parse on the Sigma1 path** - `7983c458` (feat)
2. **Task 2: Expand the guard to EPA + regression tests with positive controls** - `11a382d4` (test)
3. **Task 3: Prove both blocked commands, prove digest inertness, resolve WINDOWS #4/#5** - `dd39ba28` (fix)

**Plan metadata:** committed separately by the orchestrator (Step 8) — not included above per this session's constraints.

## Files Created/Modified

- `packages/core/algorithms/breakdown/index.ts` - Added `tryParseBreakdownPair`/`isRecoverableBreakdownParseError`; `parseBreakdown` untouched
- `packages/core/algorithms/types.ts` - Added `BreakdownParseTelemetry`/`breakdownParseFailureCountOf`
- `packages/core/algorithms/sigma1/index.ts` - `Sigma1State` carries `breakdownParseFailureCount`; `update()` routed through the guard
- `packages/core/algorithms/epa.ts` - `EpaState` carries `breakdownParseFailureCount`; `update()` routed through the guard; `fallbackSkipped` untouched
- `packages/harness/cli.ts` - `reportBreakdownParseFailures`, called from `runSeason` and `runEventMode`
- `packages/core/algorithms/breakdown/breakdown.test.ts` - Unit tests for the guard + narrowness proof
- `packages/core/algorithms/sigma1/sigma1.test.ts` - Regression fixtures (`2024cafb_qm1`, `2024wvrox_sf1m1` shapes) + positive control; 3 pre-existing `Sigma1State` literals updated
- `packages/core/algorithms/sigma1/params.test.ts` - 1 pre-existing `Sigma1State` literal updated
- `packages/core/algorithms/epa.test.ts` - Regression fixtures + positive control; 7 pre-existing `EpaState` literals updated
- `packages/core/algorithms/carryover.test.ts` - 4 pre-existing `EpaState` literals updated
- `.planning/WINDOWS.md` - ids 4/5 closed with reason; id 3's stale status enum normalized (deviation, see below)

## Decisions Made

- **D-Q1 (plan):** one shared `tryParseBreakdownPair` helper for both algorithms, parsing both alliances as a pair from a single `JSON.parse` — structurally equivalent to two `parseBreakdown` calls on the success path, never a semantic change. `parseBreakdown` itself is byte-for-byte unchanged.
- **D-Q2 (plan), shipped exactly as specified:** `breakdownParseFailureCount` is a SEPARATE, never-merged counter from `rpSkippedMatchCount` (Sigma1) and `fallbackSkipped` (EPA). A malformed match increments `breakdownParseFailureCount` (the cause — this alliance's raw breakdown failed its schema) AND `rpSkippedMatchCount` (the effect — the RP fold has nothing to parse either); `fallbackSkipped`'s permanently-zero invariant (a different, never-run code path) is untouched. Both new fields are cumulative over the algorithm's whole lifetime, never reset by `carrySeason`.
- **D-Q3 (plan), shipped exactly as specified:** `isRecoverableBreakdownParseError` is true ONLY for `ZodError` or `SyntaxError`. `componentMapForSeason(season)` is resolved before `tryParseBreakdownPair`'s own `try`, AND both `sigma1/index.ts`'s and `epa.ts`'s `update()` already call `componentMapForSeason(season)` directly at the top (pre-existing, unchanged) before the guard is ever reached — an unmapped season throws immediately, proven by test.
- No season Zod schema field was weakened. `git diff` against the base commit for `packages/core/algorithms/breakdown/{2022,2023,2024,2025,2026}.ts` is empty — confirmed no changes to any season module.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Normalized a stale WINDOWS.md status enum value blocking every `gsd-tools windows` subcommand**
- **Found during:** Task 3 (resolving WINDOWS.md ids 4/5 via `gsd-tools windows fixed`)
- **Issue:** `gsd-tools windows fixed 4` failed with `Ledger entry 2 has invalid status: "resolved"` — entry #3 (a phase-02 EPA fix, unrelated to this task) carried the string `"resolved"` in both the markdown table and JSON block, but the tool's ledger schema only accepts `open`/`waived`/`fixed`. Every `windows` subcommand parses and validates the WHOLE ledger before running, so this pre-existing data-integrity bug blocked resolving ids 4 and 5 entirely.
- **Fix:** Changed entry #3's status from `"resolved"` to `"fixed"` (both the markdown cell and the JSON field), preserving its existing `reason`/`resolved_at`/`recorded_at` values unchanged. Also corrected the frontmatter `open_count`/`fixed_count` (5/0 → 4/1) to match the entries array, since a second validation pass compares frontmatter counts against actual entry statuses.
- **Files modified:** `.planning/WINDOWS.md`
- **Verification:** `node gsd-tools.cjs windows fixed 4` and `... fixed 5` then succeeded; `node gsd-tools.cjs windows status` confirms the ledger parses and both new entries carry `status: "fixed"`.
- **Committed in:** `dd39ba28` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to complete the plan's own required tool-based ledger resolution step; touched only an enum-value typo on an unrelated, already-terminal entry — no content, meaning, or history was altered.

## Issues Encountered

None beyond the deviation above.

## Verification Results (acceptance criteria, observed)

1. `pnpm harness --season 2024 --algorithm sigma1 --include-offseason` → **exit 0**. Printed: `Breakdown parse failures [sigma1]: 1004` — matches the phase-03 security audit's independently measured 1,004/4,757 population exactly. Closes WINDOWS.md #4.
2. `pnpm harness --event 2024wvrox --algorithm sigma1` → **exit 0**. Printed: `Breakdown parse failures [sigma1]: 19`. Closes WINDOWS.md #5.
3. `pnpm test packages/harness/digest.test.ts` → **3 passed, 0 skipped** (real corpus-backed run, `data/corpus.sqlite` present). Both committed `predictionStreamSha256` values reproduced bitwise:
   - `sigma1@2.0.0+tracer-check.json`: `b5f3d21c41d6af2b1fea7c562769c2ac9afde8a44dd654a73ff176e378cb7d8e`
   - `sigma1@2.0.0+tuned-2026-08.json`: `d1203147feb7b130a085c1a992f83d2577221d8efcfcad6ac22360e1ad4bf8a6`
4. `pnpm test` (full suite) → **36 test files, 484 tests, all passed, 0 failed.** No regressions.
5. `pnpm typecheck` → clean at every task boundary (Task 1, Task 2, and final).
6. `git diff` against the base commit for `03-SECURITY.md`, `data/algorithm-versions/`, `packages/harness/fixtures/`, and every `breakdown/{year}.ts` season module → **empty** (no changes).
7. `node gsd-tools.cjs windows status` → ledger parses; ids 4 and 5 are `status: "fixed"` with the recorded reason; `open_count` is 2 (down from 4 genuinely-open entries before this task — see the Rule 3 deviation above for why the pre-task frontmatter's own `open_count: 5` was itself stale).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- T-03-18b's asserted property now holds on the tree for both algorithms and both CLI paths: `update()` does not abort the harness on untrusted corpus data.
- `/gsd-secure-phase 3` can be re-run to move T-03-18b to `closed` and re-verify `threats_open` drops accordingly — not run as part of this quick task per its own scope boundary.
- No blockers for Phase 4 (Publish & Live Update Pipeline).

---
*Phase: quick-260818-inm*
*Completed: 2026-08-18*

## Self-Check: PASSED

All 12 referenced files confirmed present on disk (`packages/core/algorithms/breakdown/index.ts`, `types.ts`, `sigma1/index.ts`, `epa.ts`, `packages/harness/cli.ts`, `breakdown/breakdown.test.ts`, `sigma1/sigma1.test.ts`, `sigma1/params.test.ts`, `epa.test.ts`, `carryover.test.ts`, `.planning/WINDOWS.md`, this SUMMARY). All 3 task commit hashes (`7983c458`, `11a382d4`, `dd39ba28`) confirmed present in `git log --oneline --all`.
