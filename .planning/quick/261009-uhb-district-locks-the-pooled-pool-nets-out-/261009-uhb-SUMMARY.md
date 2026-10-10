---
phase: quick-261009-uhb
plan: 01
subsystem: district-locks
tags: [district-locks, pooled-lock, settled-playoffs, no-take-back]
status: complete
requirements_completed: [261009-uhb]
dependency_graph:
  requires:
    - "261008-26o (settled playoff points in floors)"
    - "261009-txb (scripts/measureLedgerSettledTenets.ts, the gate)"
    - "261009-tx8 (tie routing; base commit ee445919)"
  provides:
    - "pooledLockInputs(teams, playoffPointsInFloorsByEvent?)"
    - "computeDistrictLedgerStatuses nets exact settled playoff points out of the pooled pool"
    - "scripts/districtLocksNoTakeBack.test.ts (2026cthar frc2067 pin)"
  affects:
    - "261009-txb Task 2 zero branch (main exits 0 test, closing todo item 2) is now open to the orchestrator"
tech_stack:
  added: []
  patterns:
    - "optional second argument, inert when absent, so the publisher and the Worker are unchanged"
key_files:
  created:
    - scripts/districtLocksNoTakeBack.test.ts
  modified:
    - packages/core/districts/pooledLockInputs.ts
    - packages/core/districts/pooledLockInputs.test.ts
    - apps/web/src/components/districts/districtLedgerStatus.ts
    - apps/web/src/components/districts/districtLedgerStatus.test.ts
    - .planning/todos/pending/locks-settled-playoffs-follow-ups.md (uncommitted, on purpose)
decisions:
  - "R1: the subtraction lives in pooledLockInputs.ts; pointPool.ts is not edited"
  - "R2: at most PLAYOFF_POOL is netted, and only while the event's Playoffs category is open"
  - "R3: an absent, non finite or non positive amount subtracts nothing and nothing throws"
  - "R4: the synthetic district has twelve teams, the smallest that shows the defect with one decided alliance"
  - "R5: the 2026cthar pin lives in its own file and calls the sweep's exports"
metrics:
  started: "2026-10-10T02:42:51Z"
  completed: "2026-10-10T02:57:04Z"
  duration: "about 15 minutes"
  tasks: 2
  files: 5
actuals:
  tokens: 7100
  tasks: 2
  commits: 2
---

# Quick Task 261009-uhb: The pooled pool nets out the settled playoff points Summary

The pooled remaining points lock now takes the exact playoff points already settled into team floors off that event's playoff pool, so the District Locks tab no longer withdraws a lock at Round 4 or Round 5: the settled sweep reads `VIOLATIONS: none` where it read 82.

- Base commit: `ee445919`
- Task 1: `fde7a676` fix(261009-uhb): the pooled remaining points lock nets out the playoff points already settled into floors
- Task 2: `27344328` fix(261009-uhb): pin 2026cthar frc2067 Locked at every stop from Alliances final to Playoffs final
- Nothing pushed. No `.planning/` file committed.

## The sweep, before and after

`npx tsx scripts/measureLedgerSettledTenets.ts`, 2023 to 2026.

BEFORE, at `ee445919` (exit 1, `VIOLATIONS (82)`: 41 tenet C and 41 tenet D, the same 41 team stops over 21 events):

```
  season districts events stops Lk blunt Lk settled gained lost Out blunt Out settled takeback blunt   A   B   C   D
  2023          11     94   658     8120       8214    100    6     16727       16972              0   0   0   6   6
  2024          11     98   686     8724       8786     71    9     19105       19352              0   0   0   9   9
  2025          12    103   721     8981       9126    149    4     20747       21086              0   0   0   4   4
  2026          14    123   861    11157      11282    147   22     25513       25825              0   0   0  22  22
  all           48    418  2926    36982      37408    467   41     82092       83235              0   0   0  41  41
```

AFTER, at `27344328` (exit 0):

```
  season districts events stops Lk blunt Lk settled gained lost Out blunt Out settled takeback blunt   A   B   C   D
  2023          11     94   658     8120       8227    107    0     16727       16972              0   0   0   0   0
  2024          11     98   686     8724       8805     81    0     19105       19352              0   0   0   0   0
  2025          12    103   721     8981       9142    161    0     20747       21086              0   0   0   0   0
  2026          14    123   861    11157      11310    153    0     25513       25825              0   0   0   0   0
  all           48    418  2926    36982      37484    502    0     82092       83235              0   0   0   0   0

VIOLATIONS: none
```

Census after: settled Locked on points kept 36,770, award qualified 714, violations 0; settled rows 21,438 (exact 21,438, not exact 0), 33,291 points; Locked out lost to the settled rule 0.

Gains: Locked on points under the settled rule 37,408 to 37,484 (plus 76: the 41 restored and 35 new at Round 4 and Round 5). Gained over the blunt rule 467 to 502. Lost 41 to 0. Locked out unchanged at 82,092 blunt and 83,235 settled. Blunt columns unchanged.

Against planner finding 1: every number matches the pre registered after column, including the per season figures (8,227, 8,805, 9,142, 11,310; gained 107, 81, 161, 153) and the re measured census (836 stops netted, 33,291 points, 21,438 settled rows). No difference to name.

## The 2026cthar frc2067 sequence (after)

Through the sweep's own exports, 2026ne:

| stop | Locked on points blunt / settled | pool blunt / settled | settled points | gained | lost | frc2067 (settled run) |
|---|---|---|---|---|---|---|
| Alliances final | 6 / 6 | 4,323 / 4,323 | 0 | none | none | Locked, lockedBy pooled |
| Round 1 | 6 / 6 | 4,323 / 4,323 | 0 | none | none | Locked, lockedBy pooled |
| Round 2 | 6 / 6 | 4,323 / 4,323 | 0 | none | none | Locked, lockedBy pooled |
| Round 3 | 6 / 6 | 4,323 / 4,323 | 0 | none | none | Locked, lockedBy pooled |
| Round 4 | 6 / 6 | 4,323 / 4,302 | 21 | none | none | Locked, lockedBy pooled |
| Round 5 | 6 / 7 | 4,323 / 4,263 | 60 | frc1699 | none | Locked, lockedBy pooled |
| Playoffs final, awards open | 9 / 9 | 4,110 / 4,110 | 0 | none | none | Locked, lockedBy both |

Violations 0, blunt take backs 0, `byAward` false at all seven. Before the fix frc2067 read In range at Round 4 and Round 5 with the pool 4,323 in both runs (four violations). Matches planner finding 5 exactly.

## Gates, as printed

| gate | printed line |
|---|---|
| RED, tests first (before the source edit) | `Tests  5 failed | 58 passed (63)`: the four core cases that pass an amount, and the second status case (`expected 'inRange' to be 'locked'`) |
| Task 1 five test files | `Test Files  5 passed (5)`, `Tests  203 passed (203)` |
| Task 1 chain | `UHB_TASK1_OK` |
| Pin and sweep test files | `Test Files  2 passed (2)`, `Tests  25 passed (25)`; verbose run shows all five pin cases ran, none skipped |
| Sweep (D3) | `VIOLATIONS: none`, exit 0 |
| Planner gate `uhbGate.mts` | `UHB GATE: tenet A 0, tenet B 0, tenet C 0, tenet D 0, season take backs 0` then `UHB GATE CLEAN` |
| Unchanged outputs | `ledger: identical (163 lines)`, `champ: identical (129 lines)`, `joint: identical (1178 lines)`, `after capture: every command exited 0`, `before at ee445919, after at fde7a676`, `UHB UNCHANGED CLEAN` |
| Publisher whole artifact comparison | `artifacts 109 | differing 0 | carried events 1124 | awardsPosted true before 1124 after 1124 | flips 0 | qualifyingAwards entries before 3251 after 3251` then `R9X COMPARE CLEAN` |
| `measureLedgerTenets.ts` | `tenet A (Locked shown, then NOT qualified on points): 0`, `tenet B (Locked out shown, then qualified on points): 0` |
| `measureChampTenets.ts`, `measureChampJointLocks.ts` | `VIOLATIONS: none` each, reports identical to the BEFORE capture |
| `measureChampCutoff.ts --check-history` | `no drift: packages/core/districts/dcmpHistory.generated.ts`, `no drift: packages/core/districts/champCutoffTuning.generated.ts` |
| Three typechecks | `UHB_TYPECHECKS_OK` (and again at HEAD after the last commit) |
| Full root `npx vitest run` | `Test Files  350 passed (350)`, `Tests  8261 passed | 1 skipped (8262)`. The one skip is `packages/ingest/rankingsLive.test.ts` (needs `TBA_API_KEY`, pre existing, network only) |

Planner gate table (after):

```
season | districts | events | stops | Locked on points blunt | settled | gained | lost | Locked out blunt | settled | stops netted | points netted | A | B | C | D | season stops | season take backs
2023 | 11 | 94 | 658 | 8120 | 8227 | 107 | 0 | 16727 | 16972 | 188 | 7490 | 0 | 0 | 0 | 0 | 868 | 0
2024 | 11 | 98 | 686 | 8724 | 8805 | 81 | 0 | 19105 | 19352 | 196 | 7785 | 0 | 0 | 0 | 0 | 904 | 0
2025 | 12 | 103 | 721 | 8981 | 9142 | 161 | 0 | 20747 | 21086 | 206 | 8188 | 0 | 0 | 0 | 0 | 951 | 0
2026 | 14 | 123 | 861 | 11157 | 11310 | 153 | 0 | 25513 | 25825 | 246 | 9828 | 0 | 0 | 0 | 0 | 1135 | 0
all | 48 | 418 | 2926 | 36982 | 37484 | 502 | 0 | 82092 | 83235 | 836 | 33291 | 0 | 0 | 0 | 0 | 3858 | 0
```

## What changed

- `packages/core/districts/pooledLockInputs.ts`: an optional second parameter `playoffPointsInFloorsByEvent` (`ReadonlyMap<string, number>`). Per event, the amount netted is 0 unless the event's Playoffs category is open, the field is above 0 and the map carries a finite number above 0; then it is the smaller of that number and `PLAYOFF_POOL`. The header states the input, the defect, the soundness argument, why no lock is taken back, the three bounds, and that only the browser has bracket facts. `PooledEventContribution` keeps its four fields.
- `apps/web/src/components/districts/districtLedgerStatus.ts`: `computeDistrictLedgerStatuses` sums, per event, `settledElimBounds(row.settledElim).floor` over rows whose Playoffs category is open (the very call `districtLockBounds` adds to the floor) and passes the map as the second argument. The stale header sentence (the pooled inputs keep counting a settled share, "the conservative side") is rewritten. No field added to the model; `districtLockBounds` untouched.
- Tests: seven netting cases in the core test, three status cases on a twelve team synthetic district, five corpus gated pin cases.
- Not edited: `pointPool.ts`, `locks.ts`, `districtRankingsMerge.ts`, `districtLedgerRows.ts`, `champLedgerStatus.ts`, `scripts/measureLedgerSettledTenets.ts`, any schema, any version constant, anything under `apps/worker`, the methodology copy.

## Readings (each leaves the pool larger)

- R1. The subtraction lives in `pooledLockInputs.ts`, as D1's own sentence says. `eventRemainingPool` still returns the whole open pool.
- R2. "Never below 0" is applied to the playoff pool, not the whole event pool: at most `PLAYOFF_POOL` is netted and only while Playoffs is open. An amount above 213 (never measured; the most at one stop is 61) leaves the award pool whole.
- R3. An amount that is absent, not finite or not above 0 subtracts nothing and nothing throws: this module must never be the reason a verdict pass throws.
- R4. D2 asked for a three or four team synthetic district. That cannot show the defect (one event still holds at least 291 points with Playoffs and awards open, and a counted rival sits at most 45 behind), so the synthetic has twelve teams.
- R5. The 2026cthar pin is its own file, `scripts/districtLocksNoTakeBack.test.ts`; `measureLedgerSettledTenets.test.ts` belongs to 261009-txb.

## D4, docs

Methodology (`apps/web/src/components/methodology/districtLedgerContent.ts`, read at HEAD, lines 160 and 162): the pooled sentence ("Locked when the points still available in the district cannot lift enough rivals past it") and the knocked out sentence both still read true. Not edited.

Todo note, added under item 2 of `.planning/todos/pending/locks-settled-playoffs-follow-ups.md`, uncommitted, item 2 not marked closed:

> **Note, quick 261009-uhb (2026-10-09).** Quick task 261009-txb built the sweep (`scripts/measureLedgerSettledTenets.ts`; the corpus brackets stand in for the as-of event artifacts). Its first run found 41 team stops over 21 district events of 2023 to 2026 where a pooled lock shown at Alliances final was withdrawn at Round 4 or Round 5 (tenets C and D, 41 each; every one of those teams did qualify, so no lock was false). Quick task 261009-uhb fixed the cause: the pooled pool now nets out the settled playoff points already in floors (the second argument of `pooledLockInputs`, supplied by `computeDistrictLedgerStatuses`; commit fde7a676). The sweep's four tenets read zero. Its all seasons line at fde7a676: 48 districts, 418 events, 2,926 stops, Locked on points 36,982 blunt and 37,484 settled, gained 502, lost 0, Locked out 82,092 blunt and 83,235 settled, tenets A 0, B 0, C 0, D 0, `VIOLATIONS: none`. This item is not closed by that task: closing it is 261009-txb's Task 2.

261009-txb's Task 2 zero branch (the `main` exits 0 test, closing todo item 2) is now open to the orchestrator.

## Deviations from Plan

No rule, value or gate deviated. Three process notes:

**1. Working copy line endings changed and were restored (no content effect).** My patch scripts wrote the four Task 1 files with CRLF, on a false reading that the working tree was CRLF (a Git Bash `grep -c` count that matched every line). The tree is LF. The commit was never affected: `core.autocrlf` normalised it and the committed blobs carry 0 CR. After the full suite I converted the five working copies back to LF and ran `git add` on the four already committed paths to refresh the index stat (nothing staged, `git diff --cached --stat` empty). The targeted tests, the sweep and the three typechecks were re run at HEAD on the LF copies and pass (`Tests  228 passed (228)`, `VIOLATIONS: none`, `UHB_TYPECHECKS_OK_AT_HEAD`).

**2. Heredocs are unusable on this machine**, as the project memory says: the first attempt to write the test text through a Bash heredoc failed to parse and wrote nothing. Test text, patch scripts and the pin file were written with the Write tool instead (scratch files under the session scratchpad `exec/`).

**3. The pin asserts the pool difference, not the absolute pool.** The plan's cases call for `blunt.pooledRemainingPoints - settled.pooledRemainingPoints === settledPoints` and the list 0, 0, 0, 0, 21, 60, 0; the absolute pools (4,323 and 4,110) are reported above and not pinned, so a later change to the award or qualification pool does not break this file.

STATE.md, ROADMAP.md and the Quick Tasks row were not touched: the orchestrator owns them for this quick task and `.planning/` is not committed here.

## Known Stubs

None.

## Other sessions

`git status --short` showed no modified tracked file other than the two `.planning/todos/pending/*.md` files left modified on purpose. An untracked `.planning/quick/261009-vp9-.../` directory appeared during the run (another planning session); left alone.

## Self-Check: PASSED

- FOUND: scripts/districtLocksNoTakeBack.test.ts
- FOUND: fde7a676, 27344328 on `main`
- `git diff --name-only ee445919 HEAD` names exactly the five source and test files of `files_modified`
