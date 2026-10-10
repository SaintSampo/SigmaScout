---
phase: quick-261009-txb
plan: 01
subsystem: district-locks
tags: [district-locks, settled-playoffs, measurement, no-take-back]
status: complete
requirements_completed: [261009-txb]
dependency_graph:
  requires:
    - "261008-26o (settled playoff points in floors)"
    - "261009-uhb (pooled pool nets out settled playoff points; the fix this sweep gates)"
  provides:
    - "scripts/measureLedgerSettledTenets.ts: corpus gated District Locks settled playoffs sweep, tenets A to D"
    - "pnpm measure:ledger-settled-tenets"
    - "a gated main exits 0 test over the real 2023 to 2026 data"
  affects:
    - ".planning/todos/pending/locks-settled-playoffs-follow-ups.md item 2 (CLOSED, uncommitted on purpose)"
key_files:
  created:
    - scripts/measureLedgerSettledTenets.ts
    - scripts/measureLedgerSettledTenets.test.ts
  modified:
    - package.json
    - .planning/todos/pending/locks-settled-playoffs-follow-ups.md (uncommitted, on purpose)
metrics:
  tasks: 2
  commits: 2
actuals:
  tokens: 0
  tasks: 2
  commits: 2
---

# Quick Task 261009-txb: District Locks settled playoffs sweep Summary

A corpus gated sweep runs the District Locks tab's own status code at every playoff round stop of every 2023 to 2026 district event, blunt and settled, and it now reads `VIOLATIONS: none` with exit 0.

- Task 1: `62c21b5d` feat(261009-txb): a corpus gated sweep runs the District Locks status code at every playoff round stop, blunt and settled, with a no take back tenet
- Task 2: `036f2216` feat(261009-txb): the settled playoffs sweep is pinned at zero violations on the real data
- Nothing pushed. No `.planning/` file committed. No lock math touched by this task.

## What the sweep does

For every district tier event of every 2023 to 2026 district season, at seven stops (Alliances final, Round 1 to Round 5, Playoffs final with awards open), it calls `buildDistrictLedgerRows` and `computeDistrictLedgerStatuses` twice: once with no distributions (the blunt rule) and once with distributions carrying only that event's `playoffMilestoneByTeam`, built from the corpus alliances and the played rows up to that round (the settled rule). No Monte Carlo, no network, no credential; it prints a skipped line and exits 0 when `data/corpus.sqlite` is absent.

Tenets, scored against the district tier final standing (`districtTierFinalVerdicts`); the published `districtLock.status` is a census only because the local artifacts predate quick task 261007-il9:

- A: nobody shown Locked on points, in either run, fails to qualify.
- B: nobody shown Locked out, in either run, qualifies on points.
- C: nobody Locked under the blunt rule is not Locked under the settled rule at the same stop.
- D (no take back): under the settled rule, a team Locked at a stop of an event is Locked at every later stop of it.

Exit code 1 on any A, B, C or D row.

## The table before the fix (Task 1, at the code of ee445919 and earlier, exit 1, `VIOLATIONS (82)`)

```
  season districts events stops Lk blunt Lk settled gained lost Out blunt Out settled takeback blunt   A   B   C   D
  2023          11     94   658     8120       8214    100    6     16727       16972              0   0   0   6   6
  2024          11     98   686     8724       8786     71    9     19105       19352              0   0   0   9   9
  2025          12    103   721     8981       9126    149    4     20747       21086              0   0   0   4   4
  2026          14    123   861    11157      11282    147   22     25513       25825              0   0   0  22  22
  all           48    418  2926    36982      37408    467   41     82092       83235              0   0   0  41  41
```

41 tenet C and 41 tenet D rows on the same 41 team stops over 21 events, every one a team Locked by the pooled argument alone, all of which did qualify. Cause: the pooled pool still counted the whole playoff pool while the settled rule had already moved the decided alliances' exact playoff points into their floors, so those points sat on both sides of the pooled test. Fixed by quick task 261009-uhb (`fde7a676`, `27344328`).

## The table after the fix (Task 2, at 27344328, exit 0)

```
  season districts events stops Lk blunt Lk settled gained lost Out blunt Out settled takeback blunt   A   B   C   D
  2023          11     94   658     8120       8227    107    0     16727       16972              0   0   0   0   0
  2024          11     98   686     8724       8805     81    0     19105       19352              0   0   0   0   0
  2025          12    103   721     8981       9142    161    0     20747       21086              0   0   0   0   0
  2026          14    123   861    11157      11310    153    0     25513       25825              0   0   0   0   0
  all           48    418  2926    36982      37484    502    0     82092       83235              0   0   0   0   0

VIOLATIONS: none
```

Census after: blunt Locked on points kept 36,284, award qualified 698; blunt Locked out kept 82,086, award qualified 6, unresolved tie 0; settled Locked on points kept 36,770, award qualified 714, violations 0; settled Locked out kept 83,222, award qualified 13, unresolved tie 0; settled rows 21,438 (exact 21,438, not exact 0), 33,291 points; no event with an unresolved playoff row; no bracket that fails to decide all eight placements; Locked out gained by the settled rule 1,143, lost 0; the published field differs from the yardstick on 254 teams in 39 of 48 seasons (it would score A 226 and B 263 blunt, A 241 and B 269 settled; never moves the exit code); 0 events skipped; 5.7 s.

Against the Task 2 expectations: events 418 and stops 2,926 unchanged; blunt columns (36,982, 82,092, take back 0) unchanged; lost 0; settled Locked on points 37,484, above the 37,449 floor (the baseline 37,408 plus the 41 restored, plus 35 new at Round 4 and Round 5). Every figure matches quick task 261009-uhb's own after table. No difference to report.

## Coverage limit

Every settled row is the `exact` kind (21,438 of 21,438), because every swept event is finished and the value is TBA's own `elim`. The not exact branch of `settledPlayoffPoints` (live, mid playoffs, where the placement maximum joins only the ceiling) is not reachable from finished seasons and is NOT covered by this sweep.

## Task 2 changes

- `scripts/measureLedgerSettledTenets.test.ts`: the four season acceptance group, gated with an explicit `it.skip` message on the corpus and `data/local-publish/districts`. It calls `main([])` with the console spied and expects `process.exitCode` unset, using the save, clear and restore pattern of `scripts/pruneCancelledEvents.test.ts`, 60 second timeout. The header note that this test was missing was updated.
- `scripts/measureLedgerSettledTenets.ts`: one dated header sentence with the acceptance run's totals. Comment lines only (5 lines added, none changed).
- `.planning/todos/pending/locks-settled-playoffs-follow-ups.md`: item 2 now reads CLOSED by quick 261009-txb with the all seasons line, the pooled pool finding, and the coverage limit; every existing line kept; not committed.

## Gates, as printed

- `npx vitest run scripts/measureLedgerSettledTenets.test.ts`: `Test Files  1 passed (1)`, `Tests  21 passed (21)`; verbose run shows the gated pin, the corrupted yardstick test and the new `main` test all ran (5.7 s), none skipped.
- Three typechecks (root, apps/web, apps/web e2e): `TXB_TYPECHECKS_OK`.
- Full root `npx vitest run`: `Test Files  350 passed (350)`, `Tests  8262 passed | 1 skipped (8263)`. The one skip is the pre-existing network gated `packages/ingest/rankingsLive.test.ts`.

## Deviations from Plan

None. The plan executed as written; Task 2 ran only after 261009-uhb landed (precondition checked: `fde7a676` and `27344328` on `main`, `62c21b5d` present, corpus and local districts present). The commit holds exactly the script (comment lines only) and its test; `git status --short` after it shows only the two `.planning/todos/pending/*.md` edits and untracked `.planning/quick/*` directories of other sessions.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: scripts/measureLedgerSettledTenets.ts, scripts/measureLedgerSettledTenets.test.ts
- FOUND: 62c21b5d and 036f2216 on `main`
