---
phase: 02-prediction-models-epa-sigma1
plan: 02
subsystem: algorithms
tags: [epa, score-breakdown, zod, vitest, sqlite, walk-forward]

# Dependency graph
requires:
  - phase: 02-prediction-models-epa-sigma1
    provides: "AlgorithmModule contract, breakdown2024/index.ts dispatch table, EPA tracer wiring score_breakdown_raw through to update() (02-01)"
provides:
  - "Component maps for all five seasons 2022-2026 (breakdown2022/2023/2024/2025/2026), each reconciled against the alliance's own totalPoints across >2000 real matches per season"
  - "FOULS_COMMITTED_COMPONENT/ADJUST_COMPONENT canonical-name constants and an optional diagnosticKeys field on SeasonComponentMap, so no season spells a canonical name as a bare literal and raw count fields are recorded for plan 02-06's identifiability report"
  - "D-05 total-only fallback (distributeResidual, FALLBACK_NOISE_MULTIPLIER) distributing a breakdown-less match's observed alliance total across components in proportion to their current predicted shares"
  - "epa.update() wired to the fallback: every played match updates state now, including the 1,517 TBA shipped without a score_breakdown; fallbackSkipped is a permanently-zero, test-asserted invariant"
affects: [02-03, 02-04, 02-05, 02-06, phase-03-hyperparameter-tuning]

actuals:
  tokens: 12100
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Per-season component map: Zod schema for the exact key subset read, Object.create(null) allowlist construction, fouls derived from the OPPOSING alliance's own foulPoints (never the own-side field)"
    - "diagnosticKeys metadata field on SeasonComponentMap: raw non-point fields recorded for later identifiability analysis without ever being read into a rating component"
    - "Proportional-residual fallback with an explicit all-zero-prediction branch (uniform split), avoiding both a NaN division and a silent drop"

key-files:
  created:
    - packages/core/algorithms/breakdown/2022.ts
    - packages/core/algorithms/breakdown/2023.ts
    - packages/core/algorithms/breakdown/2025.ts
    - packages/core/algorithms/breakdown/2026.ts
    - packages/core/algorithms/breakdown/fallback.ts
    - packages/core/algorithms/breakdown/reconciliation.test.ts
    - packages/core/algorithms/breakdown/breakdown.test.ts
  modified:
    - packages/core/algorithms/breakdown/index.ts
    - packages/core/algorithms/epa.ts

key-decisions:
  - "Offseason events (is_offseason=1) excluded from the reconciliation corpus sample — their score_breakdown is self-reported by organizers, not FMS-generated, and a live corpus check found offseason matches missing fields as basic as adjustPoints entirely; excluding them matches selectMatchesChronological's existing excludeOffseason discipline (D-06) rather than weakening the reconciliation invariant"
  - "distributeResidual's fallback observation includes ALL of a season's components, including foulsCommitted — no special-casing to exclude it, since D-05 says nothing is dropped from the learning stream and there is no principled reason to treat the fouls component differently from any other under total-only information"
  - "ALGO-03 (Sigma1 mean+variance) is NOT marked complete despite appearing in this plan's frontmatter requirements list — no Sigma1 code exists yet; only ALGO-02 (EPA walk-forward, now complete across all five seasons with no dropped matches) is marked in REQUIREMENTS.md this plan"

patterns-established:
  - "Reconciliation-as-test: a per-season map's correctness is proven by summing its own output back to the corpus's ground-truth totalPoints across thousands of real matches, not just synthetic fixtures"
  - "diagnosticKeys as documented dead-end metadata: a field explicitly present so a later plan (02-06's identifiability report) has a home for 'we saw this field but chose not to use it,' rather than that decision living only in a comment"

requirements-completed: [ALGO-02]

coverage:
  - id: D1
    description: "Every season 2022-2026 has a component map, and each reconciles: sum(offensive components of alliance X) + foulsCommitted(opposing alliance) === X's totalPoints, verified against >2000 real matches per season"
    requirement: ALGO-02
    verification:
      - kind: unit
        ref: "packages/core/algorithms/breakdown/reconciliation.test.ts#season %i component map reconciliation (D-01, D-02)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The 2026 map reads majorFoulCount/minorFoulCount and the nested hubScore object; it never reads foulCount or techFoulCount"
    requirement: ALGO-02
    verification:
      - kind: unit
        ref: "packages/core/algorithms/breakdown/reconciliation.test.ts#red alliance: ... totalPoints (2026 hubScore nesting)"
      - kind: other
        ref: "grep -v '^\\s*[*/]' packages/core/algorithms/breakdown/2026.ts | grep -c 'techFoulCount' => 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "Fouls are a per-team foulsCommitted component derived from the opposing alliance's foulPoints, for all five seasons"
    requirement: ALGO-02
    verification:
      - kind: unit
        ref: "packages/core/algorithms/breakdown/reconciliation.test.ts (foulsCommitted(opponent) term in every reconciliation assertion)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A match with hasScoreBreakdown=false still produces a prediction and still updates state through the proportional-residual fallback; fallbackSkipped stays 0"
    requirement: ALGO-02
    verification:
      - kind: unit
        ref: "packages/core/algorithms/breakdown/breakdown.test.ts#epa.update — D-05 fallback fixture replay"
        status: pass
    human_judgment: false
  - id: D5
    description: "Adding a season is one new entry in breakdown/index.ts's SEASON_COMPONENT_MAPS record plus one new file — no dispatch logic changed across Tasks 1-2"
    verification:
      - kind: other
        ref: "packages/core/algorithms/breakdown/index.ts diff — componentMapForSeason/parseBreakdown untouched across both season-registration commits"
        status: pass
    human_judgment: false
  - id: D6
    description: "A malformed, absent, or non-finite score_breakdown field causes a loud throw at the parse boundary, never a silent substitution of 0"
    requirement: ALGO-02
    verification:
      - kind: unit
        ref: "packages/core/algorithms/breakdown/reconciliation.test.ts#malformed breakdown handling (T-02-01)"
        status: pass
    human_judgment: false
  - id: D7
    description: "distributeResidual sums to the observed total within 1e-9, distributes uniformly with no NaN on a genuine cold start, and does not resurrect a zero-share component"
    verification:
      - kind: unit
        ref: "packages/core/algorithms/breakdown/breakdown.test.ts#distributeResidual (D-05)"
        status: pass
    human_judgment: false
  - id: D8
    description: "No component map reads a per-robot RobotN field across any of the five seasons (RESEARCH.md Assumption A1 stays unconsumed)"
    verification:
      - kind: unit
        ref: "packages/core/algorithms/breakdown/reconciliation.test.ts#no parsed %i component record has a key ending in Robot1/Robot2/Robot3"
        status: pass
    human_judgment: false

duration: ~25min
completed: 2026-08-14
status: complete
---

# Phase 02 Plan 02: Per-Season Component Maps & D-05 Fallback Summary

**All five seasons 2022-2026 now have component maps that provably reconcile against the corpus's real `totalPoints`, and every played match — including the 1,517 TBA shipped without a `score_breakdown` — now updates EPA's state via a documented proportional-residual fallback instead of being silently skipped.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3
- **Files modified:** 9 across 3 commits

## Accomplishments

- **2022/2023/2025/2026 component maps land**, each following `2024.ts`'s Zod-schema-plus-allowlist structure exactly, verified live against `data/corpus.sqlite` before writing a single line (field inventories, `hubScore` nesting, and the 2026 foul-field rename were all queried from the real corpus this session, not assumed from the plan's tables).
- **Corpus-backed reconciliation, not synthetic-only**: `reconciliation.test.ts` samples 2,000+ real matches per season and proves `sum(offensive components) + foulsCommitted(opponent) === totalPoints` for both alliances of every season, including a 2026-titled case exercising the nested `hubScore` shape and a worked example (`2026alhu_f1m1`) checked by hand against the live JSON before being written into the file's own doc comment.
- **2026's structural break handled explicitly**: `majorFoulCount`/`minorFoulCount` replace `foulCount`/`techFoulCount` (which do not exist in 2026's schema at all — grep-enforced), and a cross-season negative test proves a real 2026 breakdown throws rather than silently parsing as all-zero when read through `componentMapForSeason(2025)`.
- **D-05's fallback is real, not a stub**: `distributeResidual` splits an alliance's observed total across components proportional to their current predicted shares, with an explicit uniform-split branch for the genuine-cold-start case (never a 0/0 division). `epa.update()` now calls it whenever `parseBreakdown` returns `null`, replacing the tracer's `fallbackSkipped += 1` skip entirely — a fixture test proves every component for the involved teams actually moves after a breakdown-less match, and `fallbackSkipped` is now a permanently-zero, test-asserted invariant.
- **Offseason data-quality gap found and handled, not papered over**: some offseason events' self-reported breakdowns are missing fields the official schema always carries (e.g. `adjustPoints` entirely absent from `2024auwarp_f1m1`). Excluded from the reconciliation sample using the corpus's existing `is_offseason` flag — the same discipline `selectMatchesChronological`'s `excludeOffseason` option already applies for "anything feeding ratings or scoring."
- Test suite 143 → 179, `pnpm typecheck` clean, `pnpm test` and the isomorphic Worker-importability check both pass.

## Task Commits

1. **Task 1: 2022 and 2023 component maps** — `97651b38` (feat)
2. **Task 2: 2025 and 2026 component maps** — `ac3d8b5e` (feat)
3. **Task 3: D-05 total-only fallback** — `40b9834c` (feat)

## Files Created/Modified

- `packages/core/algorithms/breakdown/2022.ts` — Rapid React component map (autoTaxi, autoCargo, teleopCargo, endgame, adjust, foulsCommitted)
- `packages/core/algorithms/breakdown/2023.ts` — Charged Up component map (autoMobility, autoGamePiece, autoChargeStation, teleopGamePiece, link, endGameChargeStation, endGamePark, adjust, foulsCommitted)
- `packages/core/algorithms/breakdown/2025.ts` — Reefscape component map (autoMobility, autoCoral, teleopCoral, algae, endGameBarge, adjust, foulsCommitted)
- `packages/core/algorithms/breakdown/2026.ts` — nested-`hubScore` component map (autoTower, endGameTower, hubAuto/Transition/Shift1-4/Endgame, adjust, foulsCommitted)
- `packages/core/algorithms/breakdown/index.ts` — `FOULS_COMMITTED_COMPONENT`/`ADJUST_COMPONENT` constants, optional `diagnosticKeys` field, all five seasons registered in `SEASON_COMPONENT_MAPS`
- `packages/core/algorithms/breakdown/fallback.ts` — `distributeResidual`, `FALLBACK_NOISE_MULTIPLIER`
- `packages/core/algorithms/breakdown/reconciliation.test.ts` — corpus-backed reconciliation across all five seasons, malformed-input throw tests, cross-season negative test
- `packages/core/algorithms/breakdown/breakdown.test.ts` — `distributeResidual` unit tests, `epa.update()` fallback fixture replay
- `packages/core/algorithms/epa.ts` — `update()` rewired to call `distributeResidual` instead of skipping; `predictedComponentTotals` helper added

## Decisions Made

- Offseason events excluded from the reconciliation sample (see Deviations) — a genuine corpus data-quality distinction, not a weakening of the invariant.
- `distributeResidual`'s fallback vector spans every season component including `foulsCommitted` — no special-casing, matching D-05's "nothing is dropped" literally.
- `ALGO-03` intentionally NOT marked complete in `REQUIREMENTS.md` despite appearing in this plan's frontmatter `requirements` list — no Sigma1 code exists yet; only `ALGO-02` reflects what this plan actually shipped.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Offseason events' non-standard score_breakdown broke the reconciliation sample**

- **Found during:** Task 1, first `reconciliation.test.ts` run
- **Issue:** The plan's query sketch pulled matches by `has_score_breakdown = 1` alone. Live data showed some offseason events (`is_offseason = 1`, e.g. `2024auwarp`) ship self-reported breakdowns missing standard fields entirely (`adjustPoints` absent, not zero) — every registered season's Zod schema correctly threw on these, since they are genuinely malformed relative to the official schema, but this made the reconciliation test fail for a reason unrelated to any component map's correctness.
- **Fix:** Added `AND e.is_offseason = 0` to `sampleBreakdowns`'s query, joining the existing `excludeOffseason` discipline `selectMatchesChronological` already applies for "anything feeding ratings or scoring" (D-06). Documented inline in `reconciliation.test.ts`.
- **Verification:** All five seasons' reconciliation cases pass against >14,000-18,000 official matches per season (well above the 2,000 minimum) after the fix.
- **Committed in:** `97651b38` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1, blocking bug in the test's own sampling query — not in any component map)
**Impact on plan:** No scope creep, no change to any season's field mapping. The fix scopes the *proof* to the population every map is actually built to parse (official, FMS-generated breakdowns).

## Issues Encountered

None beyond the offseason sampling issue documented above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Ready.** Every contract 02-03 onward needs is live: five reconciled component maps, the completed `breakdown/index.ts` dispatch table, and a real (not stubbed) D-05 fallback wired into EPA.

**Carry forward:**
- Sigma1 (plan 02-03/02-04) can consume `componentMapForSeason`, `FOULS_COMMITTED_COMPONENT`/`ADJUST_COMPONENT`, and `distributeResidual`/`FALLBACK_NOISE_MULTIPLIER` unchanged — the fallback module was written with Sigma1's future measurement-noise multiplier in mind even though EPA itself doesn't consume it.
- Plan 02-06's identifiability report has a ready-made `diagnosticKeys` field on every `SeasonComponentMap` (foul count fields for 2022-2025, `majorFoulCount`/`minorFoulCount` for 2026) rather than needing to re-derive which raw fields were seen but not used.
- **Open judgment call carried from 02-01, still unadjudicated:** EPA's cold-start seeding (`EPA_INIT_COMPONENT_TOTAL`) and even per-team component attribution remain documented placeholders; the D-05 fallback now touches every component on every breakdown-less match, so any bias in the cold-start seed propagates slightly faster than before (more matches now update every component, not just the ones with real observed values).
- `ALGO-02` marked complete in `REQUIREMENTS.md`; `ALGO-03` deliberately left pending for whichever plan actually ships Sigma1.

---
*Phase: 02-prediction-models-epa-sigma1*
*Completed: 2026-08-14*

## Self-Check: PASSED

All 8 created/modified files verified present on disk; all 4 commit hashes (`97651b38`, `ac3d8b5e`, `40b9834c`, `065ed11b`) verified present in `git log --oneline --all`.
