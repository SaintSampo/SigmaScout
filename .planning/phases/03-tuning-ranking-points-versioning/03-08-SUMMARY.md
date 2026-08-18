---
phase: 03-tuning-ranking-points-versioning
plan: 08
subsystem: algorithms
tags: [ranking-points, reconciliation, verification, sigma1, frc-game-manual, tolerances]

# Dependency graph
requires:
  - phase: 03-tuning-ranking-points-versioning
    provides: "03-07's isRpEligibleEventType (event-type eligibility filter reused by the measurement script)"
provides:
  - "packages/harness/rpConservativeBranch.ts — committed, reproducible measurement of the conservative-branch RP understatement (pnpm rp:conservative-branch)"
  - "docs/models/sigma1-rp-verification.md — SC-4's verification status in one place: threshold provenance, conservative-branch measurement, tolerance history, open items"
  - "2025 Coral Bonus coopertition fix — the gate now requires BOTH alliances' coopertitionCriteriaMet, not just the observing alliance's own flag"
  - "Manual confirmation of the two previously-unpinned RP thresholds (2025 Coral championship tier, 2026 Energized/Supercharged tiers)"
affects: [ranking-point-prediction, rp-reconciliation, sc-4-verification, future-rp-redesign]

# Actuals (#2632)
actuals:
  tokens: 13277
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Alliance-pair coopertition gate: `own.flag && opponent.flag`, never `own.flag` alone (2023.ts's established pattern, now also applied in 2025.ts)"
    - "Derived tiered-threshold constants (`const X = Y`) instead of independently-declared duplicate literals, to make a future one-sided threshold edit structurally impossible"

key-files:
  created:
    - packages/harness/rpConservativeBranch.ts
    - docs/models/sigma1-rp-verification.md
  modified:
    - package.json
    - packages/core/algorithms/sigma1/rp/2025.ts
    - packages/core/algorithms/sigma1/rp/2026.ts
    - packages/core/algorithms/sigma1/rp/constants.ts
    - packages/core/algorithms/sigma1/rp/reconciliation.test.ts
    - docs/models/sigma1-tuning-results.md

key-decisions:
  - "Decision A (human checkpoint): A1-confirmed — a human read 2025 FRC Game Manual Section 6.5.4 Table 6-2 and 2026 FRC Game Manual Section 6.5.3 Tables 6-4/6-5 and reported both sets of corpus-converged threshold values as correct as shipped. No constant changed under this decision."
  - "Decision B (human checkpoint): B2-plan-fix — the conservative-branch understatement was measured (no bonus overstated) but the human declined to accept it as a permanent limitation. Escalated to a named future-phase redesign direction (predict undecidable RPs from teams' own historical achievement rates) rather than implemented here, per D-09's identifiability caution against a new latent Kalman gating dimension."
  - "Authorized deviation (human-approved, in-scope): fixed the 2025 Coral Bonus coopertition gate to require BOTH alliances' coopertitionCriteriaMet (was: the observing alliance's flag alone), matching 2023.ts's already-correct pattern. Reduced the residual reconciliation mismatch roughly 10x at every tier."

patterns-established:
  - "SC-4-style verification documents (`docs/models/sigma1-rp-verification.md`) follow `sigma1-identifiability.md`'s shape: state the verdict, cite the reproducing command, report negatives plainly."

requirements-completed: [ALGO-08]

coverage:
  - id: D1
    description: "The conservative-branch RP understatement is quantified in ranking-point units by a committed, reproducible script, and the 'never overstates' claim was tested rather than repeated."
    requirement: ALGO-08
    verification:
      - kind: other
        ref: "pnpm rp:conservative-branch (packages/harness/rpConservativeBranch.ts) — reports 0 overstatedRate across every season and bonus"
        status: pass
    human_judgment: false
  - id: D2
    description: "The 2025 Coral Bonus coopertition gate now requires BOTH alliances' criteria met, fixing a false-positive-only reconciliation gap."
    requirement: ALGO-08
    verification:
      - kind: unit
        ref: "packages/core/algorithms/sigma1/rp/reconciliation.test.ts#2025 Coral Bonus: coopertition requires BOTH alliances' criteria met (regression pin)"
        status: pass
      - kind: integration
        ref: "packages/core/algorithms/sigma1/rp/reconciliation.test.ts#bonus flag reconciliation (season 2025)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every corpus-converged RP threshold carries a recorded, human-confirmed provenance disposition; no source comment describes a manual check as pending."
    requirement: ALGO-08
    verification:
      - kind: other
        ref: "grep -rn \"should still be confirmed|confirm against the manual|plan's human-check step\" packages/core/algorithms/sigma1/rp/ (no matches)"
        status: pass
    human_judgment: true
    rationale: "The provenance claims rest on a human's reported reading of the official FRC Game Manual, which no automated check can independently verify — recording it correctly is itself a judgment call about honest attribution."

duration: ~55min (this continuation session; Task 1 was completed in a prior session)
completed: 2026-08-18
status: complete
---

# Phase 3 Plan 08: Sigma1 RP Verification Summary

**Closed both SC-4 verification gaps (manual-confirmed the two corpus-converged RP thresholds; measured and escalated the conservative-branch understatement) and fixed a real coopertition-gate defect the human asked the orchestrator to investigate along the way, cutting the 2025 Coral Bonus reconciliation residual roughly 10x.**

## Performance

- **Duration:** ~55 min (this continuation session, Tasks 2 checkpoint resolution through Task 3)
- **Completed:** 2026-08-18
- **Tasks:** 3 (Task 1 measurement script — prior session; Task 2 human checkpoint — resolved this session; Task 3 recording + authorized deviation fix — this session)
- **Files modified:** 6 (2 created, 4 modified in this session; plus Task 1's 2 files from the prior session)

## Accomplishments

- Fixed a genuine defect: 2025 Coral Bonus's coopertition relaxation was gated on the OBSERVING alliance's `coopertitionCriteriaMet` flag alone, but the manual's rule is an alliance-**pair** condition requiring both sides. Fixed to match 2023.ts's already-correct `own && opponent` pattern. Measured effect on the full corpus: championship tier 72/2004 -> 5/2004 mismatches (all false positives, 0 false negatives at every tier, before and after).
- Re-ran `pnpm rp:conservative-branch` post-fix and used the refreshed figures everywhere they're quoted; confirmed via `reconciliation.test.ts` that no other bonus was affected by the fix.
- Manual-confirmed the two previously-unpinned RP thresholds SC-4 needed: 2025 Coral Bonus's championship-tier per-level count (7) and 2026 Energized/Supercharged's District-Championship/Championship tiers — a human read the cited manual sections and reported both sets of corpus-converged values as correct as shipped.
- Measured the conservative-branch understatement exactly, per season and bonus, via a new committed script (`pnpm rp:conservative-branch`): no bonus in any season showed a non-zero `overstatedRate` — the "conservative, never overstates" claim was tested, not assumed, and held. 2025 `autoBonus` is the largest effect (0.625464 RP/alliance-match understated), as expected — it has no threshold-variable-only fallback at all.
- The human declined to accept the conservative-branch understatement as a shipped limitation and specified a future-phase redesign direction (predict undecidable RPs from teams' own historical RP achievement rates, not a new latent Kalman gating dimension) — recorded verbatim, not implemented in this plan.
- Created `docs/models/sigma1-rp-verification.md`: SC-4's verification status answerable from one document — threshold provenance for every `rp/2022.ts`-`2026.ts` tiered threshold, the measured conservative-branch table, reconciliation-tolerance before/after, and honestly-recorded open items.
- Tightened two reconciliation tolerances (never widened): 2025 `coralBonus` 0.05 -> 0.005 (the coopertition fix's direct consequence) and 2024 `ensembleBonus` 0.1 -> 0.085 (IN-02, 03-REVIEW.md — the prior margin was unexplained and ~40% wider than the measured rate).
- Derived `CORAL_LEVEL_THRESHOLD_COOP` from `CORAL_LEVEL_THRESHOLD_STRICT` (WR-02, 03-REVIEW.md) instead of an independent duplicate literal, so a future threshold correction cannot silently diverge the two paths.

## Task Commits

Each task was committed atomically:

1. **Task 1: Measure the conservative-branch understatement in ranking-point units** - `013761c0` (feat) — completed in a prior session, independently re-verified this session (exit 0, byte-identical stdout across two runs).
2. **Task 2: Human decision checkpoint** - no files modified, per plan. Resolved this session with Decision A = `A1-confirmed` and Decision B = `B2-plan-fix`.
3. **Authorized deviation: 2025 Coral Bonus coopertition fix** - `f1f9f763` (fix) — investigated and fixed by explicit human authorization alongside Task 3, per the orchestrator's residual-mismatch investigation.
4. **Task 3: Record both dispositions durably** - `addf547a` (docs) — new verification document, resolved source caveats, quantified `predictThresholds`'s doc comment, resolved `docs/models/sigma1-tuning-results.md` Open Items.

**Plan metadata:** (this commit, following SUMMARY.md creation)

## Files Created/Modified

- `packages/harness/rpConservativeBranch.ts` - Committed, reproducible measurement script (`pnpm rp:conservative-branch`); Task 1, prior session.
- `package.json` - `rp:conservative-branch` script entry; Task 1, prior session.
- `packages/core/algorithms/sigma1/rp/2025.ts` - Fixed the coopertition gate to require BOTH alliances (`bothCoopMet`); resolved the file-header and `CORAL_LEVEL_THRESHOLD_STRICT`/`_COOP` caveats to cite the human's manual confirmation; derived `CORAL_LEVEL_THRESHOLD_COOP` from `_STRICT` (WR-02).
- `packages/core/algorithms/sigma1/rp/2026.ts` - Resolved the file-header and `ENERGIZED_THRESHOLD`/`SUPERCHARGED_THRESHOLD` caveats to cite the human's manual confirmation.
- `packages/core/algorithms/sigma1/rp/constants.ts` - `predictThresholds`'s doc comment now carries the measured mean RP understatement per affected bonus, and records Decision B's escalated (not accepted) disposition.
- `packages/core/algorithms/sigma1/rp/reconciliation.test.ts` - Tightened `coralBonus` (0.05 -> 0.005) and `ensembleBonus` (0.1 -> 0.085) tolerances with recorded rationale; added a synthetic-fixture regression test pinning the both-alliances coopertition semantics (no corpus required, so it holds even without `data/corpus.sqlite`).
- `docs/models/sigma1-rp-verification.md` - New: SC-4's verification status in one document (`## Verification Method`, `## Threshold Provenance`, `## Conservative-Branch Understatement`, `## Known Reconciliation Tolerances`, `## Open Items`).
- `docs/models/sigma1-tuning-results.md` - Updated the RP measured-gap table (Coral Bonus row), the "two thresholds corpus-converged" and "separately-documented modeling gap" paragraphs, and rewrote the two Open Items bullets this plan resolves.

## Decisions Made

- **Decision A = `A1-confirmed`.** The human read 2025 FRC Game Manual Section 6.5.4, Table 6-2 (Coral Bonus championship-tier count = 7) and 2026 FRC Game Manual Section 6.5.3, Tables 6-4/6-5 (Energized/Supercharged tier values), and reported both as correct as shipped. No threshold value changed. Source caveats in `rp/2025.ts` and `rp/2026.ts` now cite this confirmation and the date (2026-08-18), keeping the corpus-convergence evidence as corroborating rather than deleting it.
- **Decision B = `B2-plan-fix`.** The human reviewed Task 1's measured conservative-branch table and declined to accept the understatement as a permanent, shipped limitation. Their design direction — predict undecidable RPs (like 2025 `autoBonus`) from teams' own historical RP achievement rates rather than a near-zero conservative prediction, explicitly sidestepping D-09's identifiability caution because a per-team empirical rate is a directly observed quantity, not a new latent Kalman dimension — is recorded verbatim in `docs/models/sigma1-rp-verification.md`. Not implemented in this plan (new-phase scope, per the plan's own gap-closure contract).
- **Authorized deviation.** The orchestrator investigated the 72 residual 2025 Coral Bonus mismatches the human asked about (separate from the Task 2 checkpoint) and found the coopertition gate incorrectly checked only the observing alliance's flag for what the manual states is an alliance-pair condition. The human explicitly authorized fixing this inside the plan. Fixed to match `2023.ts`'s already-correct `own && opponent` pattern.

## Deviations from Plan

### Auto-fixed Issues

**1. [Authorized deviation, human-approved — treated as Rule 1 bug fix] 2025 Coral Bonus coopertition gate checked only the observing alliance's flag**
- **Found during:** Investigation the human explicitly requested alongside the Task 2 checkpoint (separate from the plan's own Task 1/Task 2/Task 3 flow)
- **Issue:** `own.coopertitionCriteriaMet ? coopCount >= 3 : strictCount === 4` used `own`'s flag alone; the real rule requires BOTH alliances' coopertition criteria met (an alliance-pair condition, `2023.ts`'s sustainabilityBonus already applies this correctly)
- **Fix:** Added `opponent` binding and `bothCoopMet = own.coopertitionCriteriaMet && opponent.coopertitionCriteriaMet`, gating the relaxation on the AND, matching `2023.ts`'s pattern exactly
- **Files modified:** `packages/core/algorithms/sigma1/rp/2025.ts`, `packages/core/algorithms/sigma1/rp/reconciliation.test.ts` (tolerance tightened + 2 new regression tests)
- **Verification:** `reconciliation.test.ts` passes (39/39 tests, up from 37 — 2 new synthetic-fixture regression tests pin the semantics without requiring the corpus); `digest.test.ts` confirms both committed 2022 digests unmoved (the fix only touches 2025); `pnpm rp:conservative-branch` re-run confirms no bonus other than `coralBonus` was affected
- **Committed in:** `f1f9f763`

**2. [Rule 2 — riding along, IN-02 from 03-REVIEW.md] 2024 `ensembleBonus` tolerance was unexplainedly wide**
- **Found during:** Task 3 Step 4 (explicitly scoped ride-along in the plan)
- **Issue:** Tolerance was `0.1` (10%) against a measured ~7% rate with no stated reason for the ~40% margin
- **Fix:** Tightened to `0.085` (8.5%), just above the exact measured maximum (7.825% at event_type 1), with the rationale recorded in the tolerance's own comment
- **Files modified:** `packages/core/algorithms/sigma1/rp/reconciliation.test.ts`
- **Verification:** `reconciliation.test.ts` passes with the tightened tolerance
- **Committed in:** `f1f9f763`

---

**Total deviations:** 2 (1 authorized-deviation defect fix, human-approved and explicitly scoped into this plan run; 1 in-plan ride-along tightening)
**Impact on plan:** Both are within the plan's own explicit authorization (the coopertition fix) or explicit scope (IN-02 ride-along, Task 3 Step 4). No unscoped work performed.

## Issues Encountered

None. Both committed digest slices (2022 events) confirmed bitwise unmoved by `digest.test.ts`, as expected — the coopertition fix only touches 2025's `parse()` path, which is never consulted by the Monte Carlo prediction pipeline (`predictThresholds()` only) or the Kalman state fold (`thresholdVariables` only, never `bonusFlags`) — so the worked example in `docs/models/sigma1-tuning-results.md` (`2025isde1_qm25`'s predicted pmf/mean/SD) did not need regeneration.

## Reconciliation Tolerances: Before / After (must never widen)

| Season | Bonus | Before | After | Changed? |
|---|---|---|---|---|
| 2022 | cargoBonus | 0.005 | 0.005 | No |
| 2024 | ensembleBonus | 0.1 | 0.085 | **Tightened** |
| 2025 | autoBonus | 0.03 | 0.03 | No |
| 2025 | coralBonus | 0.05 | 0.005 | **Tightened** |
| 2025 | bargeBonus | 0.05 | 0.05 | No |

No tolerance was widened. Every changed value moved toward the measured rate, never away from it.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- SC-4's verification status is now fully answerable from `docs/models/sigma1-rp-verification.md` — no source comment in `packages/core/algorithms/sigma1/rp/` still describes a manual check as pending.
- The conservative-branch redesign (historical RP success rates) is a well-specified, human-directed future-phase candidate — the design direction, its rationale for sidestepping D-09's identifiability caution, and the measured baseline it would improve on are all recorded in `docs/models/sigma1-rp-verification.md`.
- `ALGO-08` marked complete in `REQUIREMENTS.md` — this plan closes the last gap `03-VERIFICATION.md` raised against it.
- No blockers for subsequent phases. `pnpm typecheck`, `pnpm test` (468/468), and `npx vitest run packages/harness/digest.test.ts` (3/3, both digests unchanged) all pass.

## Self-Check: PASSED

- FOUND: `packages/harness/rpConservativeBranch.ts`
- FOUND: `docs/models/sigma1-rp-verification.md`
- FOUND: `.planning/phases/03-tuning-ranking-points-versioning/03-08-SUMMARY.md`
- FOUND: `013761c0` (Task 1 commit)
- FOUND: `f1f9f763` (authorized-deviation fix commit)
- FOUND: `addf547a` (Task 3 docs commit)

---
*Phase: 03-tuning-ranking-points-versioning*
*Completed: 2026-08-18*
