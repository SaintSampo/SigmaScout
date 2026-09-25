---
id: 260925-ms7
slug: reserve-one-points-slot-per-district-eve
kind: quick
status: complete
completed: 2026-09-25
subsystem: districts
key-files:
  created:
    - packages/core/districts/reservedSlots.ts
    - packages/core/districts/reservedSlots.test.ts
  modified:
    - packages/core/districts/locks.ts
    - packages/core/districts/locks.test.ts
    - apps/web/src/lib/liveEvent.ts
    - apps/web/src/components/districts/districtLedgerStatus.ts
    - apps/web/src/components/districts/districtLedgerStatus.test.ts
    - apps/web/src/components/methodology/districtLedgerContent.ts
    - packages/harness/districtRankingsMerge.ts
    - packages/harness/districtRankingsMerge.test.ts
    - apps/worker/test/scheduled.district.test.ts
    - scripts/measureLedgerTenets.ts
    - scripts/measureLedgerTenets.test.ts
decisions:
  - "The reservation reaches the Locked test ALONE. Reserving on the elimination side as well was built first and measured: it turned the sweep from 0 tenet-B violations into 551. It double counts, withholding the slot while the pending award's winner is still sitting in the pool as a rival. locks.ts now asks the two sides against different slot counts."
  - "The published cut line keeps the unreserved count and keeps its three arguments, for the same reason. In range and Out of range are therefore untouched by the reservation, and the plan's instruction to pass reservedSlots into cutLinePointsWithQualifiers was not followed."
  - "An event that has posted its awards without ever playing a match is never called cancelled. districtEventStateStarted counts awardsPosted as started, which is exactly what the 2020 cancellations need: they awarded Chairman's anyway, so they DID consume slots, and twelve of the thirteen violations are theirs."
  - "A missing state block counts as PENDING, not as posted. An unknown award is not a posted one, and on a guarantee the unknown side is the conservative side. Every artifact published since phase 10 carries a state block on every row, so this is a fallback rather than a live path."
  - "The counting rule lives in packages/core/districts/reservedSlots.ts, which also becomes the single home of districtEventStateStarted/Finished (liveEvent.ts now re-exports them). The browser and the harness could not otherwise share one rule without the browser importing zod through packages/harness."
findings:
  - "BOTH TENETS NOW MEASURE ZERO over 921,658 team-positions in 109 district seasons. Tenet A was 13; tenet B was and stays 0."
  - "The cost of conservatism is 8,197 displays: Locked on points falls from 138,702 to 130,505. Every one of them moves to In range (+8,119) or Out of range (+78). Locked out (190,854) and the Locked award chip (24,192) do not move at all."
  - "NO PUBLISHED NUMBER MOVES FOR ANY FINISHED SEASON. All 109 published artifacts were recomputed through the new shared verdict pass: zero district verdicts and zero cut lines differ. Every district-tier event in the corpus carries awardsPosted true at now, the 2020 cancellations included."
  - "The reservation is not decorative: it fires at 3,804 of the 4,022 swept positions and holds back 26,604 slots in total."
owed:
  - "A district republish and a Worker redeploy carry the new verdicts to production; the browser half ships with the next Pages deploy. Neither changes a published number for a finished season."
---

# Quick task 260925-ms7: a slot held back for every award still to come

**Both of Jacob's Road to District Champs tenets now hold at every swept position of every
published district season. Tenet A was broken 13 times; it is broken zero times. Tenet B was
zero and stays zero.**

## The defect, and the rule that closes it

Quick task 260925-ma5 measured the two tenets over 921,658 team-positions and found one
mechanism behind all thirteen tenet-A failures: until an event's Impact award is posted,
`qualifierPool` hands that slot back to the points race, `pointsSlots` reads one too many, and
a team on the knife edge prints `Locked` one step before the award consumes the slot and
eliminates it. On `2025fnc` `frc3229`: `threatCount 34 < pointsSlots 35` reported `locked`,
then the award posted, `pointsSlots` dropped to 34, and `34 < 34` is false.

**One points slot is now held back for every district-tier event whose Impact award is still
to come.** An event is either *awards posted*, in which case its winner already consumes a
slot exactly as before, or *pending*, in which case it reserves one. Never both: the
discriminator is whether the award category is final **at the position being evaluated**, so
the rewind slider moving an event's awards back to open turns that event from consuming into
reserving in the same step.

**The cancelled carve out**, with all three clauses load bearing. An event is treated as never
happening when, at `now`, it has not started, it has no published qualification schedule, and
**every other** district-tier event of the district is finished. The last clause is what keeps
a live season safe: while any other event is still running, nothing is ever called cancelled.
And because `districtEventStateStarted` counts `awardsPosted` as started, a 2020 cancellation
— no matches ever played, Chairman's award posted anyway — is never called cancelled either.
That is not a detail: twelve of the thirteen violations are 2020 rows, and the fix depends on
those events still reserving at a rewound position.

## The deviation, which is the substance of this task

**The plan said to reserve on both sides of the verdict and to pass the reservation into
`cutLinePointsWithQualifiers`. That version was built first, and the sweep rejected it.**

| version | tenet A violations | tenet B violations |
| --- | --- | --- |
| before this task | 13 | 0 |
| reservation on both sides (built, then rejected) | 0 | **551** |
| **shipped: reservation on the `Locked` test alone** | **0** | **0** |

551 teams were told `Locked out` and went on to qualify on points. The cause is a double
count. The reservation withholds the slot, but the pending award's winner is **still in the
pool at that position, competing** — so the elimination test saw both a smaller slot count and
an extra rival, for one award. The two verdicts are opposite guarantees and their worst cases
point opposite ways:

- For `"locked"` the worst case is that the pending award goes to a team that would **not**
  have qualified on points, taking a slot out of the race. The lock test must see the smaller,
  reserved count.
- For `"eliminated"` the worst case is the mirror image, the award going to a team **ahead**
  in the race, which frees a slot below it. The elimination test must see the unreserved count.

So `locks.ts` now asks the two sides against different numbers:

```
pointsSlots = max(slots - awardQualifiedRankedCount, 0)   // eliminated, and the cut line
lockSlots   = max(pointsSlots - reservedSlots, 0)         // locked, and pointsToLock
```

`lockSlots <= pointsSlots` always holds, which is also what keeps the two branches mutually
exclusive (`eliminationCount <= threatCount` always).

**`cutLinePointsWithQualifiers` keeps its three arguments** and the unreserved count, for the
same reason, so `In range` / `Out of range` and the published `dcmpCutLinePoints` are untouched
by the reservation. The seeded property test now runs half its trials with a reservation, to
prove both cut-line invariants survive the two sides disagreeing.

## The census, before and after

`pnpm measure:ledger-tenets`, 109 seasons, 4,022 stage positions, 921,658 team-positions,
exit code **0** (it exited 1 before).

| display | before | after | change |
| --- | ---: | ---: | ---: |
| `Locked` shown on points | 138,702 | 130,505 | **−8,197** |
| — kept (locked at now) | 131,608 | 124,022 | −7,586 |
| — award-qualified at now (indeterminate) | 7,081 | 6,483 | −598 |
| — **VIOLATIONS** | **13** | **0** | **−13** |
| `Locked out` shown | 190,854 | 190,854 | 0 |
| — kept (eliminated at now) | 190,828 | 190,828 | 0 |
| — **VIOLATIONS** | **0** | **0** | 0 |
| `Locked · award` chip | 24,192 | 24,192 | 0 |
| `In range` | 199,465 | 207,584 | **+8,119** |
| `Out of range` | 368,445 | 368,523 | **+78** |

**The cost of conservatism is 8,197 `Locked` displays, and every one of them is accounted
for**: 8,119 became `In range` and 78 became `Out of range` (8,119 + 78 = 8,197). Nothing
became `Locked out`, which is the reservation staying on its own side of the verdict.

New in the census, so a reader can watch the rule fire rather than infer it from an absence of
failures:

```
slots held back for awards to come   26,604   (summed over every position)
positions holding back at least one   3,804   of 4,022
```

## What this changes in production, and what it does not

**No published number moves for any finished season.** Every district-tier event in all 109
published artifacts carries `awardsPosted: true` at `now` — the 2020 cancellations included,
because FIRST posted their Chairman's awards anyway. To prove it rather than argue it, all 109
artifacts were recomputed through the new shared verdict pass and diffed:

```
seasons recomputed: 109; seasons whose district verdicts or cut line move: 0
```

So the reservation bites in exactly two places, both of which are the point:

1. **The rewind rail**, where the slider reopens an award. That is where all thirteen
   violations lived.
2. **A live event**, between its playoffs finishing and its Impact award being posted. The
   `now` position runs the same code, so the defect was reachable live.

**For the republish and the redeploy:** the district artifacts must be republished and the
Worker redeployed for the new verdicts to reach production, and the browser half ships with
the next Pages deploy. **Neither will change a number for a finished season** — the only
observable difference is a live district mid event, plus the rewind rail once the new bundle
is served. `docs/publish-budget.md` is untouched, and `docs/worker-operations.md` needs no
change: no Worker log line or counter moved.

## Where the code lives

- **`packages/core/districts/reservedSlots.ts` (new).** The counting rule and the carve out, in
  one pure place with no zod and no React, so the browser and the harness call the same code.
  It also becomes the single home of `districtEventStateStarted` / `districtEventStateFinished`,
  which `apps/web/src/lib/liveEvent.ts` now re-exports under their own names — every existing
  importer and the poll gate are unchanged.
- **`packages/core/districts/locks.ts`.** `computeLocksWithQualifiers` takes
  `reservedSlots = 0` (default pinned by a test), `qualifierPool` returns both slot counts, and
  the new private `computeLocksSplit` asks the two sides against them. A negative reservation
  is clamped to zero rather than widening the pool.
- **`apps/web/src/components/districts/districtLedgerStatus.ts`.** `reservedSlotsAtPosition`
  reads the award's finality from the rows at the position and the event's own state at `now`,
  and `reservedSlots` joins the returned model. `DistrictLedger.tsx` needed no change.
- **`packages/harness/districtRankingsMerge.ts`.** `recomputeDistrictVerdicts` derives the same
  number from each district-tier row's state and passes it to the district pass alone. The
  offline publisher and the Worker both reach the verdict pass through this one function, so
  neither `scripts/publishDistricts.ts` nor `apps/worker/src/districtRefresh.ts` needed a line
  changed — the file's own "ONE verdict pass, two callers" rule.
- **`apps/web/src/components/methodology/districtLedgerContent.ts`.** One paragraph in the
  award base rates section, in the page's voice.

## Tests

| suite | result |
| --- | --- |
| `packages/core/districts/reservedSlots.test.ts` (new, 13 tests) | green |
| `packages/core/districts/locks.test.ts` (31 tests, 6 new) | green |
| `apps/web/src/components/districts/districtLedgerStatus.test.ts` (20 tests, 4 new) | green |
| `packages/harness/districtRankingsMerge.test.ts` (38 tests, 3 new) | green |
| `apps/worker/test/scheduled.district.test.ts` (31 tests, 1 new) | green |
| `scripts/measureLedgerTenets.test.ts` (17 tests) | green |
| `npx vitest run` (whole repo, from the root) | 6,347 passed, 1 skipped |
| `npx tsc --noEmit` root / `apps/web` / `apps/worker` | all clean |

The one full-suite failure was the known `MetricHistoryTab.test.tsx` timeout flake; it passes
on re-run and was not modified.

**Three fixtures had to change, and each change is the new rule showing up rather than a test
bent to fit.**

- `districtRankingsMerge.test.ts`'s tracer district had no `state` blocks at all and one DCMP
  slot. It now carries two: `2026ncwak` finished and awarded, `2026ncpem` played out with its
  Impact **not** posted. With a single slot the held-back one would leave nothing to lock into
  and the recomputed-verdict assertion would have passed for the wrong reason.
- `scheduled.district.test.ts`'s Worker fixture, for the same reason, plus a third team so
  elimination is still expressible at two slots. Its tracer now reads `locked` / `contending` /
  `eliminated`, and a new test runs the same tick twice against a published state differing
  only in `awardsPosted`: pending gives `["locked", "contending", "eliminated"]`, posted gives
  `["locked", "locked", "eliminated"]` — one more points slot, end to end through the Worker.
- `measureLedgerTenets.test.ts`'s synthetic district now shows `Locked` at 2 positions instead
  of 3. The lost one is its `playoffs` step, where the single slot is held back for the award
  that has not posted. The corrupted-fixture test (the one that proves the checker can fail)
  follows it down from 3 violations to 2, and `Locked out` stays at 6 across the same three
  positions.

The corpus half of the sweep test no longer pins thirteen triples as an expectation. They are
kept as `FIXED_TENET_A_VIOLATION_ROWS` and **read back as an assertion**: each of the exact
positions that used to fail is swept again and must come back clean. Zero violations is also
what a silently broken sweep prints, so the reserved-slot totals are pinned as floors beside
them — a reservation that stopped firing fails on those rather than passing quietly.

## Commits

| commit | what |
| --- | --- |
| `7744cf05` | `feat(260925-ms7)`: the reservation, the split lock/elimination slot counts, and the tests for both |
| `665f37fa` | `test(260925-ms7)`: the sweep reports zero and counts what it holds back; the methodology page states the rule |
