---
phase: quick-260903-4fs
plan: "01"
subsystem: algorithms/breakdown, algorithms/sigma1/rp
tags: [frc-2019, frc-2020, score-breakdown, ranking-points, corpus-backfill]
dependency-graph:
  requires:
    - "data/corpus.sqlite (2019/2020 ingested immediately before this task)"
  provides:
    - "componentMapForSeason(2019), componentMapForSeason(2020)"
    - "rpRuleModuleForSeason(2019), rpRuleModuleForSeason(2020)"
  affects:
    - ".planning/todos/pending/extend-corpus-2019-2020.md (its module dependency is cleared)"
    - "apps/web/src/lib/bonusRp.ts (client-side bonus-name mirror)"
tech-stack:
  added: []
  patterns:
    - "Zod strip-mode schema + Object.create(null) allowlist loop (T-02-04), matching every existing season map"
    - "RpTieredThreshold uniform triple carrying an explicit measured-vs-assumed tier caveat"
    - "Conservative-branch predictThresholds (always false) for a bonus with no threshold-variable-only fallback"
key-files:
  created:
    - packages/core/algorithms/breakdown/2019.ts
    - packages/core/algorithms/breakdown/2020.ts
    - packages/core/algorithms/sigma1/rp/2019.ts
    - packages/core/algorithms/sigma1/rp/2020.ts
  modified:
    - packages/core/algorithms/breakdown/index.ts
    - packages/core/algorithms/breakdown/groups.ts
    - packages/core/algorithms/breakdown/groups.test.ts
    - packages/core/algorithms/breakdown/reconciliation.test.ts
    - packages/core/algorithms/sigma1/rp/rules.ts
    - packages/core/algorithms/sigma1/rp/rules.test.ts
    - packages/core/algorithms/sigma1/rp/reconciliation.test.ts
    - apps/web/src/lib/bonusRp.ts
decisions:
  - "Every threshold was DERIVED FROM DATA before this task and encoded here as data, never re-derived: habClimbPoints >= 15 (2019 habDocking), endgamePoints >= 65 (2020 shieldOperational), completedRocketNear || completedRocketFar (2019 completeRocket)"
  - "2019 completeRocket tolerance 0.04, read out of the suite's own printed report and cross-checked against an independent SQL measurement (3.829% ceiling at event_type 3) — derived, not guessed to make a test pass"
  - "2019 habClimb grouped as endgame rather than teleop, despite TBA's own teleopPoints roll-up bundling it there — the same treatment 2022's bare endgame component gets"
  - "2020 shieldEnergized deliberately unmodelled (0/7,640 occurrences); kept out of bonusNames and recordedBonusFlags, present only in diagnosticKeys"
metrics:
  duration: ~13min
  completed: 2026-09-03
status: complete
actuals:
  tasks: 4
  commits: 4
---

# Quick Task 260903-4fs: 2019 and 2020 breakdown + RP rule modules — Summary

Registered 2019 (Destination: Deep Space) and 2020 (Infinite Recharge) score-component maps and
RP rule modules, clearing the module dependency that blocked the corpus backfill. Every threshold
was measured beforehand and encoded here as data.

## What was built

- **`breakdown/2019.ts`** — four offensive components (`sandstormBonus`, `hatchPanel`, `cargo`,
  `habClimb`) plus `adjust` and `foulsCommitted`. The header records both roll-up hazards and the
  two clamp-at-zero outlier matches found during planning.
- **`breakdown/2020.ts`** — five offensive components (`autoInitLine`, `autoCell`, `teleopCell`,
  `controlPanel`, `endgame`) plus `adjust` and `foulsCommitted`.
- **`sigma1/rp/2019.ts`** — `habDocking` and `completeRocket`.
- **`sigma1/rp/2020.ts`** — `shieldOperational` only; `shieldEnergized` deliberately absent.
- Registry entries in both dispatch tables, grouping entries in `groups.ts`, and edits to the
  three hardcoded test literals that actually put both seasons under the existing proofs.

## The trap the planner caught

CONTEXT.md asserted that both reconciliation suites iterate the registry. **That was wrong.**
`breakdown/reconciliation.test.ts` and `groups.test.ts` carry HARDCODED season lists. Registering
the two component maps without editing them would have shipped two entirely unproven maps with a
fully green suite — a false green of exactly the kind this project's failure log is about. Only
`rules.test.ts` fails loudly on registration.

A second gate exists because reconciliation structurally cannot catch one error: 2019's
`autoPoints` roll-up is numerically identical to `sandStormBonusPoints` in every row, so a module
that mistakenly read the roll-up would still reconcile perfectly. Both breakdown tasks therefore
carry a comment-stripped source gate, since the forbidden names must appear in the doc comments
that explain why they are forbidden.

## Verification — re-run by the orchestrator, not taken on report

- **Full suite from the REPO ROOT:** 168 files, 2,945 passed, 1 skipped, **1 failure** — see below.
- **`completeRocket` independently re-derived from the corpus** by the orchestrator rather than
  read from the executor's summary: 29,858 sides, 6.541% flag rate, **98.191% agreement, 540 false
  negatives, 0 FALSE POSITIVES**. Matches the pre-measurement exactly. The zero-false-positive
  property is the one the conservative-branch argument rests on, so it was worth re-proving.
- `habDocking` 0/29,858 mismatches at every event type; `shieldOperational` 0/7,640.
- Exact-boundary checks pass, and 2020's district-championship/championship tiers correctly log
  "boundary case not observed" — 2020 never played those tiers.
- `maxRp` derives structurally to 4 (2019) and 3 (2020); never hand-written.

## Deviations from plan

**Auto-fixed:** `apps/web/src/lib/bonusRp.ts` — a deliberate client-side copy of each season's
`bonusNames`, pinned by a test asserting it matches the registry. Registration broke that pin.
Added the 2019 and 2020 entries. It is a UI-display mirror, not a published-artifact season list,
so this is not a publish-scope change.

## Outstanding — caused by the ingest, not by this task

`packages/ingest/corpusCensus.test.ts` fails: "events with no `event_rankings` row is less than
400" now sees **758**. The 2019/2020 ingest added 499 events with no rankings rows (259 → 758).
The executor correctly declined to fix it, being outside a modules-only scope.

**It is the orchestrator's to fix, since the orchestrator ran the ingest**, and the fix is to
backfill the missing rankings rather than move the bound. Tracked and resolved separately.

## What this does NOT do

No tuning search, publish, promote, or full harness replay. The corpus backup at
`data/corpus.sqlite.bak-pre-2019-2020` is untouched.
