---
phase: quick-261007-il9
plan: 01
subsystem: districts, presim, methodology
tags: [district-ledger, presim, short-roster, version-bump, locks]
status: complete
requires: [261007-4qr, 261006-2t0, 261007-3g2]
provides:
  - insufficientRosterReason (the one roster refusal predicate)
  - qualificationRosterKeys (the presim sidecar roster rule)
  - districtTierPointTotal (district pass ranks the district tier total)
  - SPR 11.0.0+baseline, EPA 15.0.0+baseline
affects: [publish:seasons sidecars, publish:districts verdicts, Worker district refresh, District Points methodology page]
key-files:
  created:
    - .planning/todos/pending/locks-tab-award-at-uncounted-event.md
    - .planning/todos/pending/champ-cutoff-backtest-season-skips.md
  modified:
    - apps/web/src/components/methodology/districtLedgerContent.ts
    - packages/core/districts/ledgerSimulation.ts
    - packages/harness/districtBake.ts
    - apps/web/src/components/districts/asOfRewind.ts
    - packages/harness/publish.ts
    - packages/core/algorithms/spr.ts
    - packages/core/algorithms/epa.ts
    - data/baselines/level1-digest-2026-09.json
    - packages/harness/districtRankingsMerge.ts
decisions:
  - The district verdict pass ranks the district tier total (pointTotal minus non district tier rows); the champ pass keeps the all tier total.
  - The presim sidecar roster is the teams on a played or scheduled qualification row, else the published roster.
  - The bake refuses only what simulateDistrictEvent refuses (insufficientRosterReason).
metrics:
  completed: 2026-10-07
actuals:
  tasks: 5
  commits: 5
---

# Quick 261007-il9: short roster follow-ups Summary

Five commits close every 261007-4qr follow-up. The methodology page reads 193 / 171 / 89% with a count free limits table. The bake and the as-of GENERATED roster follow the short roster rule. Presim sidecars rank only the qualification field, under SPR 11.0.0+baseline and EPA 15.0.0+baseline. The district tier verdicts rank the district tier total in the one pass the publisher and the Worker share.

## Commits

| Task | Commit | Files |
|------|--------|-------|
| A | 117960cd | districtLedgerContent.ts, districtLedgerContent.test.ts, scripts/measureDistrictCutoff.ts, champCutoffTuning.generated.ts, predictedCutoff.ts |
| B | 69b4951f | asOfRewind.ts, asOfRewind.test.ts, ledgerSimulation.ts, districtBake.ts, districtBake.test.ts, districtAsOfJob.test.ts |
| C | ac24f171 | publish.ts, publish.test.ts, docs/simulation-architecture.md, spr.ts, epa.ts, data/baselines/level1-digest-2026-09.json, softCredit.test.ts, epa.test.ts, preSchedule.test.ts |
| D | 75db163a | districtRankingsMerge.ts, districtRankingsMerge.test.ts, districtLedgerStatus.ts, predictedCutoff.test.ts, scripts/measureLedgerTenets.ts, scripts/measureLedgerTenets.test.ts |
| E | 1978f6af | five todo renames into completed/ with closing notes, two new pending todos |

No foreign commit was interleaved, and no foreign file showed up modified at any commit.

## Verification (read from output)

- `npx vitest run` from the repo root: `Test Files  344 passed (344)`, `Tests  7922 passed | 1 skipped (7923)`. The 4qr baseline was 7905, so this task added 17 tests.
- `npx tsc --noEmit -p tsconfig.json`, `-p apps/web/tsconfig.json`, `-p apps/web/tsconfig.e2e.json` and `-p apps/worker/tsconfig.json` each printed no output (0 lines).
- `npx tsx scripts/measureChampCutoff.ts --check-history`: `no drift: packages/core/districts/dcmpHistory.generated.ts`, `no drift: packages/core/districts/champCutoffTuning.generated.ts`.
- `npx tsx scripts/measureDistrictCutoff.ts`: 193 scored positions. `1. PASS ... 1.17 < 1.80 (n = 193)` and `2. FAIL ... 171 of 193 (88.6%)`. It reads the same before and after Task B.
- `npx tsx scripts/measureLedgerTenets.ts` (unchanged local set): tenet A 0, tenet B 0, "Both tenets hold at every swept position of every swept season."
- Bake identity probe. Before: 18 and 23 skipped (roster-too-small-for-alliances); 24 7e39a8b0ca4c2a4a, 30 4e1380343ecd9f46, 40 b8110615470afc4d. After: 18 baked 7b75e5d93b1fb347, 23 baked 9620aeaca76f06c3, and 24, 30 and 40 identical to the before.
- Task B suite (ledgerSimulation, districtBake, asOfRewind, districtAsOfJob, browserSafeSchemas): 5 files, 211 passed. Every pre-existing ledgerSimulation case passed unedited.
- Task C suite (publish, preSchedule, level1Digest, softCredit, epa): 5 files, 391 passed. All 5 level1Digest cases ran, including "reproduces the committed digest bitwise, for every published algorithm".
- Task D suite (districtRankingsMerge, publishDistricts, measureLedgerTenets, predictedCutoff, districtLedgerStatus, worker scheduled.district): 6 files, 240 passed.
- Champ tuning setting diff, HEAD against regenerated (11 seasons each): empty. Only fitCount, fitCoverage, fitMae and the Generated date moved. 2017 is uniform/fixed/1.00 and every later season is uniform/fixed/1.75.
- Offline district rebuild compare (`districtVerdictCompare.ts`, before and after dirs in the scratchpad):
  - Before: tenet A 562, tenet B 454, unresolved tie 2. After: 4, 0, 0. The default yardstick reads 0 and 0 on both.
  - Champ side movement 0. pointTotal movement 0.
  - 98 artifacts moved: 97 dcmpCutLinePoints, 48 districtLockedCount, 48 districtEliminatedCount, 468 team districtLock.status values.
  - Residual by kind: contending vs final locked 2, eliminated vs final contending 2, lockedAward vs final eliminated 3, lockedAward vs final locked 30.
  - The four tenet rows: 2019fma frc5113 and frc6943, at 2019paben:awards and at now.
  - Every figure matches the planner's simulation exactly.

## Version strings

- `SPR_VERSION = "11.0.0+baseline"` and `epa.version = "15.0.0+baseline"`.
- level1 digest: the bpr entry's `algorithmVersion` is now 11.0.0+baseline and the epa entry's is 15.0.0+baseline. No hash was touched.
- Remaining `"10.0.0+baseline"` / `"14.0.0+baseline"` hits, all intentional records or fixtures:
  - epaComparisonContent.test.ts:217, 223
  - methodology.epa-vs-statbotics.test.tsx:30
  - apps/worker/test/artifactWriter.test.ts:296, 298
  - scripts/measureRpCalibration.test.ts:970, 999
  - scripts/pruneR2Generations.test.ts:175

## Deviations from Plan

- The plan's "slot th highest total" wording in measureDistrictCutoff.ts THE TARGET reads as "the total at the last qualifying slot (the slots-th highest)". It is a comment, not rendered copy.
- The planner listed the Worker typecheck as `apps/worker/tsconfig.json`. It ran and was clean.

Otherwise none. The plan executed as written.

## Known Stubs

None.

## Findings for Jacob (new pending todos)

- `locks-tab-award-at-uncounted-event`: the tab skips a consuming award won at an event the team has no district tier row for, and the publisher counts it. This causes the 4 residual rows (2019fma) and the 37 team differences.
- `champ-cutoff-backtest-season-skips`: measureChampCutoff main mode reads n = 62, 18.5 against 39.0 and 42 of 69, against the published 18.2, 40.4, 68 and 48 of 69. Seven seasons are skipped. The Champ cutoff sentence is unchanged pending his call.

## Left for the orchestrator

`pnpm rebaseline` (Worker deploy, publish under spr 11.0.0 / epa 15.0.0, district republish, seed, verify, prune). Nothing was published, deployed or pushed. This SUMMARY, STATE.md and ROADMAP.md are not committed.

## Self-Check: PASSED

All five commit hashes exist in `git log`. Both new todo files exist, and each of the five completed todos carries the release line once at HEAD.
