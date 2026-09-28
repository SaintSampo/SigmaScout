---
phase: quick-260927-vmb
plan: 01
subsystem: districts (core ledger simulation, District Locks, Champ Locks)
tags: [districts, awards, champ-locks, district-locks, simulation]
status: complete
requires: []
provides:
  - "DistrictLedgerEventInput.awardOnlyTeams / DistrictLedgerResult.awardOnlyTeams (optional, additive)"
  - "InvalidAwardOnlyTeamsError"
  - "DistrictEventDistributions.awardOnlyTeams"
affects: [District Locks rows and statuses, Champ Locks DCMP row, champ chance run dcmpPart, champ cutoff]
key-files:
  modified:
    - packages/core/districts/ledgerSimulation.ts
    - packages/core/districts/ledgerSimulation.test.ts
    - apps/web/src/components/districts/districtLedgerRows.ts
    - apps/web/src/components/districts/districtLedgerRows.test.ts
    - apps/web/src/components/districts/champLedgerRows.ts
    - apps/web/src/components/districts/champLedgerRows.test.ts
    - apps/web/src/components/districts/useDistrictLedgerData.ts
    - apps/web/src/components/districts/useDistrictLedgerData.test.ts
    - apps/web/src/components/districts/DistrictLedger.test.tsx
    - apps/web/src/workers/districtSimulationProtocol.ts
    - apps/web/src/workers/districtSimulationProtocol.test.ts
    - apps/web/src/components/methodology/districtLedgerContent.ts
decisions:
  - "A registered team missing from a posted schedule joins its event's award field (decoration ordering, path choice) and is drawn by the same per team award draw, after every roster team, so roster stream consumption is unchanged when the list is empty"
  - "The no show's row.stage stays the event level stage; its ceiling keeps counting the open on field categories (conservative), while statuses read the award only projection"
  - "districtRunSignature folds the award only list as a tenth segment only when present, so every existing signature string is unchanged"
metrics:
  completed: 2026-09-27
commits: [d685c02e, 658a9d8b, aac8c9ad, b7ffa584, 1e46941a, 75fafc8b]
---

# Quick Task 260927-vmb: Price a registered no show from awards alone

A registered team that appears on no posted qualification row is now priced by its own event's
simulation from awards alone. Qualification, Alliance selection and Playoffs read grey 0, Awards is
open, and the event total equals the award draw. On Champ Locks the DCMP row now reads case 2 (the
event's own prediction) instead of the walk forward estimate. On District Locks the no show's row no
longer reads unavailable all the way to its grand total. Web plus core only; no publish, no Worker
change, nothing pushed.

## What changed

- **Core, `packages/core/districts/ledgerSimulation.ts`.** New optional `awardOnlyTeams` on the event
  input, echoed on the result when non empty, and a new `InvalidAwardOnlyTeamsError` that names every
  empty, duplicate or roster overlapping key before any draw. One award field list (the roster, then
  the award only keys) feeds the missing profile check, the base rate lookup and the decoration
  ordering. The three award paths moved into one local `drawAwardPoints(i)`, not copied. Each draw
  runs the roster loop exactly as before, then draws the award only teams, which get award and event
  total histograms only. The publisher bake and `measureChampCutoff` never pass the field:
  `districtBake.test.ts` passes unedited and absent against empty is pinned deep equal.
- **Browser, `districtLedgerRows.ts`.** `buildDistrictEventSimulationInput` builds the list only when
  the event artifact has qual rows: registered teams at this tier on neither the roster nor any qual
  row, sorted, each with `awardProfileOrZero`. `distributionsFromResult` carries it;
  `distributionsFromPreSim` never does. In `buildTeam`, an award only team's qual, alliance and elim
  read final (TBA's earned value when posted, else 0) and never set `hasOpenCategory`; the award cell
  and event total logic are untouched, and `row.stage` is not overridden.
- **`champLedgerRows.ts`:** a doc sentence in `buildDcmpRow` case 2; no logic change needed.
- **`useDistrictLedgerData.ts`:** `districtRunSignature` adds an `awardOnly=` segment only when present.
- **`districtSimulationProtocol.ts`:** `isEventRequest` rejects a non array `awardOnlyTeams` and a
  request whose roster plus award only teams exceed `MAX_DISTRICT_SIMULATION_ROSTER`.
- **Methodology:** one paragraph in `districtLedgerContent.ts`: "A team registered for an event but
  absent from its published match schedule earns no qualification, alliance selection or playoff
  points there, and its event total is its award prediction alone."

## Modelling consequence

At an event with a no show, the no show joins the award ordering, so the roster teams' award prices
move to the full registered field's prices, which is the field the pre event bake already uses.
Events without a no show are unchanged. The fix takes effect once the event starts (the tab fetches
the event artifact only then); between schedule posting and the first match the baked sidecar still
prices every registered team as a full participant.

## Verification

- Task verifies: 176 tests (Task 1) and 121 tests (Task 2) passed; RED confirmed first (8 failures).
- Plan verify set: 44 files, 1,146 tests passed after the addendum.
- Orchestrator re-check, full repo-root `npx vitest run`: 298 files, 6,981 passed, 1 skipped (before
  the addendum's two tests). Root `tsc --noEmit` and `apps/web/tsconfig.json` both clean.
- Nothing under `apps/worker/` touched.
- `measureChampCutoff.ts` and `measureLedgerTenets.ts` compile and were not re-run; the published 16.4
  and 49 of 69 figures stand as measured.

## Deviations

1. Web typecheck rejected spreading an `ArrayLike<number>` in two new tests; changed to `Array.from`.
2. The tracer's automated verify was re-run green rather than pausing for a human checkpoint (plan is
   `autonomous: true`).
3. In Task 2 the `districtRunSignature` edit landed before its tests, so those two were not seen red.

## Regression triage

The two `DistrictLedger.test.tsx` tests after the "THE REPRODUCTION (quick task 260925-uf8)" comment
pinned the old unavailable reading for frc901, a registered team absent from a posted schedule. They
now assert frc901 is priced (posted to the chance ranking, no unavailable cell) and were renamed.

## Addendum: the 260925-uf8 guard has tests again (1e46941a)

Those two tests were the only coverage of "one team's grand total cannot be built, and the rest of the
district still gets a chance". Two replacements, each a real single team refusal that still exists:

1. **Event artifact not served:** frc901's only open event has started but its artifact 404s
   (`missingEventKeys` added to the test's `installFetch`), so its cells and grand total read
   unavailable.
2. **Grand total refuses:** frc901 with `adjustments: -5` makes `convolveDistrictGrandTotal` throw
   `NegativeDistrictShiftError`, and `degradedLedgerTeam` degrades that team alone.

Both pin that frc901 is excluded from the chance ranking (exactly the 24 roster teams posted), reads
not available with no chance line, and every other team's chance line prints. `degradedLedgerTeam` is
still reachable in production, so it is not dead code. `DistrictLedger.test.tsx` 78 of 78; web
typecheck clean. The orchestrator also corrected a now stale comment on the rewind test's frc900
(75fafc8b).

## Findings

- `earnedAtPosition` is unchanged for award only rows; it only feeds the fallback projection used
  when a grand total is unavailable.
