---
phase: 03-tuning-ranking-points-versioning
plan: 07
subsystem: algorithms
tags: [sigma1, ranking-points, kalman, zod, vitest, harness]

requires:
  - phase: 03-tuning-ranking-points-versioning (03-02, 03-03)
    provides: Per-season RP rule modules (rp/2022.ts-2026.ts), eventTierFor()'s deliberate throw, rpPmfForMatch(), and Sigma1's update()/predict() RP wiring this plan guards
provides:
  - "isRpEligibleEventType() in rp/constants.ts — the caller-side eligibility predicate the RP subsystem's live callers were missing"
  - "Sigma1's update()/predict() no longer crash on an unmapped TBA event_type (offseason 99); the RP fold/pmf step degrades to a counted skip instead"
  - "4 regression tests, including a non-negotiable positive control proving every EVENT_TYPE_TIERS-mapped event type still takes the full RP path"
  - "Proof that the guard is a bitwise no-op for both committed algorithm versions' digest slices (both event_type: 0)"
  - "A new, separate, out-of-scope defect discovered and logged (WINDOWS.md #4/#5): self-reported offseason score_breakdown JSON can fail Sigma1's SCORE-side Zod schema (breakdown/2024.ts), unguarded, previously masked by the CR-01 crash happening earlier in the replay stream"
affects: [sigma1, ranking-points, harness-cli, breakdown-schema]

actuals:
  tokens: 8000
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Caller-side eligibility predicate reading the SAME table a deliberately-throwing function reads, so the two can never disagree (isRpEligibleEventType / eventTierFor)"
    - "Skip via empty-array short-circuit (not a degenerate P(RP=0)=1 pmf) so an optional field is omitted entirely rather than asserting a false certainty"

key-files:
  created: []
  modified:
    - packages/core/algorithms/sigma1/rp/constants.ts
    - packages/core/algorithms/sigma1/index.ts
    - packages/core/algorithms/sigma1/rp/distribution.ts
    - packages/core/algorithms/sigma1/sigma1.test.ts
    - .planning/WINDOWS.md

key-decisions:
  - "rpSkippedMatchCount increments for BOTH the no-score-breakdown case (usedFallback) AND the unmapped-eventType case (CR-01) — one shared counter, since the field's meaning is 'RP fold skipped, for any reason', not 'missing breakdown' specifically, and splitting it would be an unconsumed versioned-shape change"
  - "predict()'s RP guard returns { redPmf: [], bluePmf: [] } (not degenerateZeroPmf()) for an ineligible eventType, so redRpPmf/blueRpPmf are omitted entirely per types.ts's documented convention — never a false claim of certain zero RP"
  - "Did NOT fix the newly-discovered score-breakdown-schema crash (WINDOWS.md #4/#5) — out of scope per Task 2's explicit 'No production code changes in this task' and the deviation rules' scope boundary (pre-existing, unrelated file, not caused by this plan's changes)"
  - "ALGO-08 intentionally NOT marked complete in REQUIREMENTS.md — 03-08 also lists it and closes the remaining ALGO-08 gap (manual game-manual threshold confirmation, conservative-branch understatement quantification); this plan closes only the CR-01 crash, matching the project's established ALGO-04/05/06/08 multi-plan precedent"

requirements-completed: []

coverage:
  - id: D1
    description: "isRpEligibleEventType() added to rp/constants.ts, reading EVENT_TYPE_TIERS (the same table eventTierFor() throws on)"
    verification:
      - kind: unit
        ref: "packages/core/algorithms/sigma1/sigma1.test.ts — 'sigma1 — CR-01' describe block (all 4 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "update()'s RP fold and predict()'s RP pmf step both guarded by isRpEligibleEventType(), sharing the same predicate"
    verification:
      - kind: unit
        ref: "sigma1.test.ts — 'update() ... does not throw' and 'predict() ... does not throw' tests"
        status: pass
    human_judgment: false
  - id: D3
    description: "Positive control: every EVENT_TYPE_TIERS-mapped event type (0,1,2,3,4,5,100) still takes the full RP path"
    verification:
      - kind: unit
        ref: "sigma1.test.ts — 'positive control (non-negotiable)' test"
        status: pass
    human_judgment: false
  - id: D4
    description: "Both committed algorithm versions (sigma1@2.0.0+tuned-2026-08, sigma1@2.0.0+tracer-check) reproduce their digest bitwise unchanged with the guard in place"
    verification:
      - kind: integration
        ref: "npx vitest run packages/harness/digest.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "The two documented CLI invocations that previously crashed on CR-01 now run to completion against the real corpus"
    verification:
      - kind: other
        ref: "pnpm harness --season 2024 --algorithm sigma1 --include-offseason ; pnpm harness --event 2024wvrox --algorithm sigma1"
        status: fail
    human_judgment: false
    rationale: "CR-01 itself is proven fixed (see below), but both commands now fail on a SEPARATE, pre-existing, out-of-scope defect (score-breakdown Zod schema, unguarded), previously masked by the CR-01 crash occurring earlier in the stream. Logged as WINDOWS.md #4/#5, not fixed per this task's explicit 'no production code changes' scope."

duration: 55min
completed: 2026-08-17
status: complete
---

# Phase 3 Plan 07: CR-01 RP-eligibility guard Summary

**Sigma1's `update()`/`predict()` no longer throw on an unmapped `event_type` — a shared `isRpEligibleEventType()` predicate skips the RP fold/pmf step, proven a no-op for both committed digest slices, but a new, separate, pre-existing score-breakdown-schema defect (not CR-01) still blocks the two documented CLI invocations from completing.**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-08-17T16:00:00Z (approx)
- **Completed:** 2026-08-17T16:15:00Z (approx)
- **Tasks:** 2
- **Files modified:** 5 (4 code/test + WINDOWS.md)

## Accomplishments

- Reproduced CR-01's crash on the current tree BEFORE fixing anything: `pnpm harness --season 2024 --algorithm sigma1 --include-offseason` threw `eventTierFor: unmapped TBA event_type 99 (registered: 0, 1, 2, 3, 4, 5, 100) — offseason (99) is deliberately excluded from every RP population` (see verbatim quote below, including the offending match key `2024mnst_qm1`).
- Added `isRpEligibleEventType(eventType: number): boolean` to `rp/constants.ts`, reading the same `EVENT_TYPE_TIERS` table `eventTierFor()` throws on — the two can never disagree, and `eventTierFor` itself is unweakened (still throws; `grep -c "throw new Error"` unchanged at 2).
- Guarded `update()`'s RP fold: `if (usedFallback || !isRpEligibleEventType(result.eventType))` — `rpSkippedMatchCount` increments for both skip reasons, sharing one counter per the plan's documented rationale.
- Guarded `predict()`'s RP pmf step: `isRpEligibleEventType(match.eventType) ? rpPmfForMatch(...) : { redPmf: [], bluePmf: [] }` — an ineligible match's `Prediction` omits `redRpPmf`/`blueRpPmf` entirely (never a false "certain zero RP" claim).
- Added a caller-precondition sentence to `rpPmfForMatch`'s doc comment in `distribution.ts`, naming `isRpEligibleEventType` as the caller's responsibility — no second guard added inside `rpPmfForMatch`.
- Added 4 regression tests in `sigma1.test.ts` (new `describe("sigma1 — CR-01...")` block): `update()` doesn't throw + `rpSkippedMatchCount` increments by 1; the score fold still runs (team beliefs populate) proving only the RP fold was skipped; `predict()` doesn't throw and omits both pmf properties; and the non-negotiable positive control over `[0,1,2,3,4,5,100]` proving the guard doesn't over-skip.
- Confirmed both committed algorithm versions' digests are byte-identical before and after the fix (`digest.test.ts`: 3 passed, 0 skipped), both slices being entirely `event_type: 0` as the plan predicted.
- Confirmed via a standalone scratch replay (deleted after use, working tree clean) that the CR-01 fix is genuinely effective: the season replay now processes 17,358 matches successfully (329 of them offseason) — including `2024mnst_qm1` itself, the ORIGINAL crash point at stream position 17029/22099 — before hitting an entirely different, unrelated crash.
- Discovered, investigated, and honestly logged (did NOT fix) a new, separate, pre-existing defect: `parseBreakdown()` (score-side, `breakdown/index.ts` → `breakdown/2024.ts`) is called unconditionally at the top of `update()`, with no `eventType`/`compLevel` guard and no try/catch. Self-reported offseason `score_breakdown` JSON can be missing required fields (`adjustPoints` at `2024cafb_qm1`; ~13 fields at `2024wvrox_sf1m1`, the very first match of the single-event invocation), so Zod throws uncaught. This is genuinely out of scope for this plan (Task 2 explicitly forbids production code changes; the file isn't in this plan's `files_modified`) and was previously MASKED by CR-01's earlier crash.

## Task Commits

1. **Task 1: Reproduce the crash, add the eligibility guard end to end, and prove both directions with tests** — `0a056f89` (fix)
2. **Task 2: Prove the fix is a no-op — committed digests bitwise unchanged, and both crashing CLI invocations now complete** — no production-code commit (proof-only task, per plan; findings folded into this SUMMARY and the plan-metadata commit below)

**Plan metadata:** (this commit) `docs: complete 03-07 plan`

## Files Created/Modified

- `packages/core/algorithms/sigma1/rp/constants.ts` - Adds `isRpEligibleEventType()`
- `packages/core/algorithms/sigma1/index.ts` - Guards `update()`'s RP fold and `predict()`'s RP pmf step with the shared predicate
- `packages/core/algorithms/sigma1/rp/distribution.ts` - Documents the caller precondition on `rpPmfForMatch`
- `packages/core/algorithms/sigma1/sigma1.test.ts` - 4 new CR-01 regression tests
- `.planning/WINDOWS.md` - 2 new open ledger entries (#4, #5) for the newly-discovered score-breakdown-schema defect

## Decisions Made

- `rpSkippedMatchCount` shares its counter between the `usedFallback` skip and the unmapped-`eventType` skip (documented in the source comment), since both produce the same diagnosable condition and the field's only reader (`carrySeason`) doesn't distinguish reasons.
- `predict()`'s guard returns empty pmf arrays (never `degenerateZeroPmf()`) for an ineligible event type, preserving `types.ts`'s "omitted entirely, never an empty array" optional-field convention and avoiding a false certainty claim.
- Did not fix the newly-discovered score-breakdown-schema crash — logged to `WINDOWS.md` (#4, #5) as `unrun-verify` entries instead, per the SCOPE BOUNDARY deviation rule (pre-existing, unrelated file, not caused by this plan's changes) and Task 2's explicit "No production code changes in this task" instruction.
- `ALGO-08` intentionally left unmarked in `REQUIREMENTS.md` — `03-08-PLAN.md` also carries `requirements: [ALGO-08]` and closes the remaining ALGO-08 gap (manual game-manual threshold confirmation + conservative-branch-understatement quantification); this plan closes only the CR-01 crash ground of the original `03-VERIFICATION.md` gap, matching the project's established ALGO-04/05/06/08 multi-plan precedent already recorded in STATE.md.

## Deviations from Plan

### Auto-fixed Issues

None — Task 1 was implemented exactly as the plan specified (predicate + two call-site guards + doc-comment precondition + 4 tests), with no bugs requiring auto-fix.

### Out-of-scope finding (NOT auto-fixed — logged instead)

**1. [SCOPE BOUNDARY — pre-existing, unrelated file] Score-breakdown Zod schema crashes on malformed self-reported offseason data**
- **Found during:** Task 2 Step 3 (re-running the two previously-crashing CLI invocations)
- **Issue:** `packages/core/algorithms/breakdown/index.ts`'s `parseBreakdown()`, called unconditionally at the top of `sigma1/index.ts`'s `update()` (line ~735-736, well before this plan's RP-fold guard), throws an uncaught Zod validation error when a match's self-reported `score_breakdown` JSON is missing required fields. Confirmed on two independent real matches: `2024cafb_qm1` (missing `adjustPoints`) and `2024wvrox_sf1m1` (missing ~13 fields, the first match of the single-event invocation). This is a genuinely different defect from CR-01 — CR-01's guard is proven working (the replay gets past the original crash match, `2024mnst_qm1`, and 17,358 further matches, before hitting this).
- **Why not fixed:** (a) Task 2's own action text states "No production code changes in this task." (b) `breakdown/2024.ts`/`breakdown/index.ts` are not in this plan's `files_modified`. (c) The deviation rules' SCOPE BOUNDARY excludes pre-existing bugs in unrelated files not caused by this plan's changes — this bug predates this plan; it was simply unreachable before because CR-01's crash happened earlier in the replay stream.
- **Logged:** `.planning/WINDOWS.md` entries #4 and #5 (`kind: unrun-verify`, `status: open`), naming the exact failing commands, matches, and root cause.
- **Recommendation:** A future gap-closure plan (tentatively "CR-02") should decide whether the score-side schema should tolerate missing fields for offseason/self-reported breakdowns (e.g., a `.default()`/`.optional()` relaxation scoped to the offseason population, mirroring `reconciliation.test.ts`'s existing offseason exclusion) or whether `update()` should catch the parse failure and fall back to the existing `usedFallback` path, the same way a `null` breakdown is already handled.

---

**Total deviations:** 0 auto-fixed; 1 out-of-scope finding logged (not fixed, by design)
**Impact on plan:** None on this plan's own deliverable — CR-01 (the RP-eligibility guard) is complete, tested, and proven a bitwise no-op on both committed digest slices. The out-of-scope finding means the plan's own `<verification>` bullet "`pnpm harness --season 2024 --algorithm sigma1 --include-offseason` completes, having previously crashed on this same tree" is **not fully met** — it now crashes on a different, later defect instead of CR-01's — but this reflects a real gap in the corpus/schema, not a flaw in this plan's fix.

## Issues Encountered

- The `gsd-tools windows append` CLI command errored (`Ledger entry 2 has invalid status: "resolved"`) due to a pre-existing, unrelated data issue in `.planning/WINDOWS.md` entry #3 (`status: "resolved"`, not a value the tool's schema accepts — predates this plan, from phase 02). Worked around by manually editing `WINDOWS.md` in the same format as existing entries (both the markdown table and the JSON block), since the ledger is explicitly documented as best-effort/optional and this was a pre-existing tool/data mismatch, not something this plan should fix.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CR-01 is closed: Sigma1's live RP path is defensively guarded and proven a no-op for the tested population. `03-VERIFICATION.md`'s Success Criterion 4 gap ground (1) (the crash) is resolved.
- `03-VERIFICATION.md`'s Success Criterion 4 gap ground (2) (manual game-manual threshold confirmation) remains open — `03-08-PLAN.md` (next in the wave sequence, `depends_on: ["03-07"]`) is scoped to close it.
- A new, separate defect (score-breakdown schema strictness on self-reported offseason data) is now visible and logged in `WINDOWS.md` (#4, #5) for a future gap-closure decision — it was previously invisible because CR-01's crash occurred earlier in every real replay that included offseason matches.

---

**Verbatim pre-fix crash output (Task 1 Step 1, captured before any code change):**

Command: `pnpm harness --season 2024 --algorithm sigma1 --include-offseason --out reports/cr01-repro`

```
harness failed: eventTierFor: unmapped TBA event_type 99 (registered: 0, 1, 2, 3, 4, 5, 100) — offseason (99) is deliberately excluded from every RP population
[ELIFECYCLE] Command failed with exit code 1.
```

Offending match key (captured via a standalone scratch script replaying the same `buildSeasonStream(db, 2024, { includeOffseason: true })` stream, deleted after use, working tree confirmed clean):

```
stream length: 22099
CRASHED on matchKey: 2024mnst_qm1
eventType: 99 compLevel: qm hasScoreBreakdown: true
error: eventTierFor: unmapped TBA event_type 99 (registered: 0, 1, 2, 3, 4, 5, 100) — offseason (99) is deliberately excluded from every RP population
```

**Total passing test count (`pnpm test`, full suite, after the fix):** 466 tests passed, 36 test files, 0 failed.

`pnpm typecheck` exits 0.

---
*Phase: 03-tuning-ranking-points-versioning*
*Completed: 2026-08-17*
