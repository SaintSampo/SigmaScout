---
phase: quick-261007-4qr
plan: 01
subsystem: districts / Locks ledger
status: complete
tags: [locks, district-ledger, champ-locks, simulation, short-roster, pending-cell]
requires: [261006-2t0]
provides:
  - draftedAllianceCount and the whole-filler-alliance short-roster rule in simulateDistrictEvent
  - distributionsPending option on buildDistrictLedgerRows and buildChampLedgerRows
  - pending flag on the unavailable cell variant, printed as "pending" with data-cell pending
affects:
  - District Locks and Champ Locks tabs (range call for districts holding an event under 24 real teams)
  - every open cell on both Locks tabs during loading
tech-stack:
  added: []
  patterns:
    - "filler alliances forfeit in the bracket decider with no randomness consumed"
    - "one hoisted pending condition per tab feeds both the cells and the range state"
key-files:
  created:
    - apps/web/src/components/districts/districtLedgerShortRoster.test.ts
    - apps/web/src/components/districts/LedgerParts.test.tsx
    - .planning/todos/pending/district-ledger-short-roster-methodology.md
  modified:
    - packages/core/districts/ledgerSimulation.ts
    - packages/core/districts/ledgerSimulation.test.ts
    - apps/web/src/components/districts/districtLedgerRows.ts
    - apps/web/src/components/districts/districtLedgerRows.test.ts
    - apps/web/src/components/districts/districtLedgerCopy.ts
    - apps/web/src/components/districts/LedgerParts.tsx
    - apps/web/src/components/districts/champLedgerRows.ts
    - apps/web/src/components/districts/champLedgerRows.test.ts
    - apps/web/src/components/districts/DistrictLedger.tsx
    - apps/web/src/components/districts/DistrictLedger.test.tsx
    - apps/web/src/components/districts/ChampLocksLedger.tsx
    - .planning/todos/completed/locks-loading-cells-read-not-available.md (moved from pending)
    - .planning/todos/pending/presim-roster-demo-robots.md
decisions:
  - "Short rosters follow the measured convention: floor((N-1)/3) whole real alliances under 24 teams, the remaining seeds are filler that forfeit; 24 or more is unchanged"
  - "A pending cell is the unavailable variant with pending: true, not a new kind, so every kind-keyed computation keeps its meaning"
metrics:
  duration: "about 35 min"
  completed: 2026-10-07
actuals:
  tokens: 15000
  tasks: 3
  commits: 4
---

# Quick Task 261007-4qr: Locks ledger prices district events under 24 teams; loading cells read pending

The core simulation now seats whole real alliances (floor((N-1)/3) of them) at a district event under 24 real teams and lets the bottom seeds forfeit as filler, so small districts get their range call back on both Locks tabs. Open cells that are still loading now print "pending" (same word and same condition as the Status column) instead of "not available".

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 (tracer) | 22412703 | fix(261007-4qr): price district events under 24 real teams with whole filler alliances |
| 2 | d0f98653 | fix(261007-4qr): open Locks cells still loading carry a pending flag and print pending |
| 3 | 2607ee7c | fix(261007-4qr): both Locks tabs read pending, not not available, while cells load |
| 3 (bookkeeping) | 92589763 | docs(261007-4qr): close locks-loading-cells todo; record short-roster follow-ups |

## Corpus re-check (read-only, `sqlite3 -readonly data/corpus.sqlite`, 2026-10-07)

Matches the plan's table exactly. Real teams on qual rows (no demo key appears on any qm row at these five events), and alliances:

| Event | N | Real alliances | Demo alliances |
|---|---|---|---|
| 2026txmca | 18 | 1 to 5 | 6, 7, 8 |
| 2026mefal | 20 | 1 to 6 | 7, 8 |
| 2023gaalb | 21 | 1 to 6 | 7, 8 |
| 2025ncash | 22 | 1 to 7 | 8 |
| 2024vapor | 23 | 1 to 7 | 8 |

At 24: 2026isde2 eight real alliances, 2026txfor seven plus one demo. Real against fully demo playoff matches at 2023-plus event_type 1: 19, demo won 0, demo against demo 1, partial demo alliances 0.

## Scratch runs (orchestrator's inRangeAtStart.ts)

Before the fix, `DEBUG=1 ONLY=2026ne` showed `simulate threw 2026mefal: ... a 20-team roster cannot fill 8 3-team alliances` and `range state noCall (noFieldChance)`. After, at final HEAD:

```
2026ne  slots=32  line=192 [174,210]  inRange=17  inLocked=16  pct=94.1%  outRange=183  outLocked=16  prequal=0  lockedAtStart=0  finalLocked=32  missingEv=0    0s
2026fit  slots=28  line=197 [177,217]  inRange=15  inLocked=15  pct=100.0%  outRange=166  outLocked=13  prequal=0  lockedAtStart=0  finalLocked=28  missingEv=0    0s
2025fnc  slots=14  line=207 [174,242]  inRange=6  inLocked=5  pct=83.3%  outRange=79  outLocked=9  prequal=2  lockedAtStart=0  finalLocked=14  missingEv=0    0s
```

## measureDistrictCutoff before and after

- Before (9d1e5fe2): 187 scored positions; All positions sim MAE 1.2 vs midpoint 1.8, range holds 165 (88.2%); gate 1 PASS 1.17 < 1.81 (n = 187); gate 2 FAIL 165 of 187 (88.2%); excluded team fallback 6.
- After (22412703): 193 scored positions; All positions sim MAE 1.2 vs midpoint 1.8, range holds 171 (88.6%); gate 1 PASS 1.17 < 1.80 (n = 193); gate 2 FAIL 171 of 193 (88.6%); excluded team fallback 0.
- Verdict NO-GO both times (unchanged). Recorded verbatim in `.planning/todos/pending/district-ledger-short-roster-methodology.md`; the published methodology sentence (187 / 165 / 88%) needs to become 193 / 171 / 89%.

## measureChampCutoff --check-history

`no drift: packages/core/districts/dcmpHistory.generated.ts` and `DRIFT: packages/core/districts/champCutoffTuning.generated.ts differs from a fresh regeneration`. **The drift was already there before this task**: the same DRIFT prints with HEAD's `ledgerSimulation.ts` swapped back in, and a fresh regeneration from HEAD is byte identical to a fresh regeneration after this change. So 261007-4qr does not move the tuning. The selected setting is unchanged (uniform, fixed, 1.75 for every season). Only fitCount, fitCoverage and fitMae differ from the committed 2026-10-05 file. Per the plan it was not regenerated. The finding is recorded in the methodology follow-up todo.

## Full verification (read from the output)

- `npx vitest run` (repo root): `Test Files  344 passed (344)`, `Tests  7905 passed | 1 skipped (7906)`. The single skip already existed and is not in a file this task touched.
- `npx tsc --noEmit -p tsconfig.json`: no output (clean).
- `npx tsc --noEmit -p apps/web/tsconfig.json`: no output (clean).
- `npx tsc --noEmit -p apps/web/tsconfig.e2e.json`: no output (clean).
- Task 1 verify: `ledgerSimulation.test.ts` + `districtLedgerShortRoster.test.ts` + `browserSafeSchemas.test.ts`: 3 files, 147 tests passed.
- Task 2 verify: `districtLedgerRows.test.ts` + `LedgerParts.test.tsx` + `DistrictLedger.test.tsx` + `districtLedgerCopy.test.ts`: 4 files, 242 tests passed.
- RED observed before GREEN for every new test group: core and web short-roster tests failed with InsufficientRosterError / missing export / InvalidAllianceSetError; Task 2 failed on the missing flag; the champ propagation test failed against HEAD's `champLedgerRows.ts`, swapped in temporarily and then restored byte for byte.
- Tracer gate: the tracer's verify ran again end to end after commit A and passed. Expansion continued after that.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test premise] Pre-existing alliance-validation case used a demo key as its "absent team"**
- **Found during:** Task 1 GREEN
- **Issue:** `ledgerSimulation.test.ts` "rejects a pick naming a team absent from the roster" used `frc9999`. That is a demo key, and under the rule in this plan it is filler by design, so the case no longer threw. The plan expected every other pre-existing test to pass unedited. This one is a validation case, not a seeded pin, so the byte-identity proof does not depend on it.
- **Fix:** Changed the absent key to the non-demo `frc5999` and added a comment citing 261007-4qr. The demo-key behaviour is pinned in the new short-roster block. All seeded pins pass unedited.
- **Commit:** 22412703

**2. [Rule 1 - Test premise] DistrictLedger Worker-failure case read the loading moment**
- **Found during:** Task 3
- **Issue:** "keeps the grey cells and shows the unavailable copy ... cannot construct a Worker" took the qual cell as soon as it existed. That cell is now correctly "pending" while the artifact loads. A failed run is not pending (`runPending` excludes `status === "error"`), so the cell does settle on "not available".
- **Fix:** The waitFor now waits for the settled `data-cell="unavailable"`, with a comment citing the todo. The case was not deleted.
- **Commit:** 2607ee7c

**3. [Rule 1 - Test premise] Two of my own new test fixtures**
- The plan named the degraded-team trigger as an all-zero histogram, but that does not throw. It now uses WR-09's own trigger, a negative adjustment. With the flag set, a team can only reach the catch path once every event total is known, so a pending event and the catch path cannot occur together.
- The champ "open fold unchanged" fixture left the event total missing, so that total is correctly pending. The fixture now supplies the event total too.

### Notes

- Commit C also holds `champLedgerRows.test.ts` and `DistrictLedger.test.tsx` beside the four code files the plan named, because those are this task's tests.
- `possiblePointsBySlot` uses the drafted count only when the draft is simulated, as specified.
- No published artifact, schema, version string, publisher (`districtBake.ts`) or methodology copy was touched. `districtLedgerContent.ts` was not touched.
- No foreign file appeared modified in the checkout at any commit. `git status --short` before every commit showed only this task's files plus the untracked quick directory.

## Known Stubs

None.

## Threat Flags

None. No new network, auth or file-access surface. The T-4qr-01 mitigation is pinned: a non-demo absent key still raises InvalidAllianceSetError and names the key. T-4qr-02 is pinned by the per-draw four-paying-placements assertions.

## Self-Check: PASSED

- FOUND: apps/web/src/components/districts/districtLedgerShortRoster.test.ts
- FOUND: apps/web/src/components/districts/LedgerParts.test.tsx
- FOUND: .planning/todos/completed/locks-loading-cells-read-not-available.md (pending path gone)
- FOUND: .planning/todos/pending/district-ledger-short-roster-methodology.md
- FOUND commits: 22412703, d0f98653, 2607ee7c, 92589763
