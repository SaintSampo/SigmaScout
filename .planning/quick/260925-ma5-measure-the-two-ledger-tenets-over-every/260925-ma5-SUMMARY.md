---
id: 260925-ma5
slug: measure-the-two-ledger-tenets-over-every
kind: quick
status: complete
completed: 2026-09-25
subsystem: scripts
key-files:
  created:
    - scripts/measureLedgerTenets.ts
    - scripts/measureLedgerTenets.test.ts
  modified:
    - package.json
decisions:
  - "Qualified on points is the artifact's own districtLock.status === 'locked' at now, and nothing else. Reading the site's own published verdict rather than recomputing a finish line means a violation is a promise the site broke to itself, not a disagreement between two derivations."
  - "A lockedAward finish under a Locked display is INDETERMINATE, not a failure. computeLocksWithQualifiers short-circuits every award qualifier before the points math runs, so the artifact cannot say whether points alone would also have sufficed. Scoring it as a failure reported 7,094 violations against the corpus and buried the 13 real ones under seven thousand teams that went to the district championship on an Impact award."
  - "A contending finish never counts as qualified, at either end. threatCount counts a tie as a possible loss (>= not >), so two teams tied for the last slot are both contending at the finish and neither is reported as qualified. Under a Locked display that is a tenet A violation; under a Locked out display it is counted as an unresolved tie rather than as a tenet B failure, because Jacob's tenet B names qualifying, and a team that finished tied did not qualify."
  - "The sweep uses an EMPTY event-artifact map, which yields exactly the stage positions (season start, then per event qualsDone/alliance/playoffs/awards, then now). A within-quals position only loosens both the floor and the ceiling at an identical award set, so it can only produce FEWER Locked and Locked out displays than the qualsDone step that follows it."
findings:
  - "TENET B HOLDS EVERYWHERE. 190,854 Locked out displays across 109 seasons, zero of which ever qualified on points."
  - "TENET A IS VIOLATED 13 TIMES out of 138,702 Locked displays (0.0094%). All 13 sit on a playoffs step; 12 are in the COVID-cancelled 2020 season and 1 is in a normally completed one (2025fnc, team 3229)."
  - "The mechanism is the award-consumed slot. At a playoffs step an event's Impact award has not been posted, so qualifierPool hands that slot back to the points pool and the lock math is briefly one slot too generous. The very next step consumes it and the verdict reverses. In 2025fnc frc3229: threatCount 34 < pointsSlots 35 -> locked; one step later pointsSlots 34 and the same threatCount 34 -> eliminated."
  - "This is NOT rewind-specific. The live now position runs the same code path, so a team locked today can be un-locked tomorrow when an Impact award is posted at a later event."
owed:
  - "Jacob to decide whether the lock math should reserve the not-yet-posted consuming award slots (which would remove all 13 and make Locked strictly conservative) or whether the current optimism is the intended reading. locks.ts and the status rule were NOT touched."
---

# Quick task 260925-ma5: the two ledger tenets, measured

**Tenet B holds at every one of 190,854 Locked out displays. Tenet A is broken 13 times out
of 138,702 Locked displays, all 13 on a playoffs step, and the cause is one mechanism.**

## What was measured

Jacob, 2026-09-25:

> "check to make sure a few tenets are always true: No team that ever is displayed as 'locked'
> should ever fail to qualify on points; no team that is ever displayed as 'locked out' should
> ever end up qualifying on points."

`scripts/measureLedgerTenets.ts` (`pnpm measure:ledger-tenets`) sweeps every district artifact
in `data/local-publish/districts/` at every stage position the Road to District Champs rewind
rail can land on, takes the status the tab would display for every team, and scores it against
that season's own final verdict. It defines no status rule of its own: it calls the same five
things `DistrictLedger.tsx` calls, in the same order and with the same arguments —
`districtTierEvents` + `deriveStageFromState` for the event list and the `now` stage,
`buildDistrictTimeline` with an empty artifact map, `districtStageAtPosition`,
`buildDistrictLedgerRows` with the component's own `atNow ? undefined : stageByEvent`
fallback, and `computeDistrictLedgerStatuses`. Read-only, no network, no credential.

## The definition of "qualified on points", and why

**The final points-qualified set is `{ team : team.districtLock.status === "locked" }` at the
`now` position.** That is the artifact's own published verdict, so a violation is a promise the
site broke to itself rather than a disagreement between two of my derivations.

The other three reachable verdicts are NOT simply "not qualified", and collapsing them would
have produced a wrong answer:

- **`lockedAward`** — the team qualified, by an award rather than by points. Whether points
  alone would *also* have sufficed is **unknowable from the artifact**, because
  `computeLocksWithQualifiers` short-circuits every award qualifier before the points math runs
  and its own doc comment says so: *"a team that is both award-qualified and points-safe still
  reports lockedAward — the award is what guarantees it."* So a `Locked` chip shown to a team
  that went to the district championship on an Impact award did not mislead anybody. These are
  counted as **award-qualified at now**, an indeterminate outcome, never as a failure. This
  matters enormously: scoring them as failures reported **7,094** tenet A violations instead of
  13, burying the real defect under seven thousand teams that did qualify.
- **`eliminated`** — not qualified. Under a `Locked` display this is a tenet A violation; under
  a `Locked out` display it is the promise kept.
- **`contending`** — a tie **at** the cut line that `locks.ts` deliberately refuses to break.
  `threatCount(T)` counts every other team `R` with `ceiling(R) >= floor(T)` — `>=` and not
  `>`, because *"a tie is settled by a tiebreaker this model does not carry and must count as a
  possible loss"* — and `locked` requires `threatCount < slots`. Two teams tied for the last
  slot therefore both finish `contending` and **neither is reported as having qualified**.
  Fifteen of the 109 seasons end that way. Under a `Locked` display that is a tenet A violation
  (the team was never guaranteed the slot). Under a `Locked out` display it is counted as an
  **unresolved tie at now** rather than a tenet B failure, because Jacob's tenet B names
  *qualifying*, and a team that finished tied at the line did not qualify — it is a weaker
  broken promise, counted under its own name rather than folded into either bucket. Zero of
  these occurred.

**Award-consumed slots** are handled entirely by `locks.ts`'s own `qualifierPool`, which the
status module calls and neither this script nor the tab reimplements: each award-qualified team
is removed from the points-competing pool **and** reduces `pointsSlots` by one, floored at
zero. The status module feeds that set from each team's own `qualifyingAwards`, restricted to
district-tier events **whose award category is final at the position** — so a rewound award has
not been handed out yet and cannot consume a slot. That last clause is exactly what the 13
violations are made of.

Nothing was skipped for an unpublished capacity: **all 109 seasons carry a non-null
`dcmpSlots`**, so the "skip and count it" rule fired zero times. The ten
`v1__districts__{year}.json` per-year index files in the same directory are identified and not
parsed as districts.

## The census

```
seasons swept                       109      (2016-2026; 0 skipped for a null dcmpSlots)
index files not parsed as districts  10
stage positions swept              4,022
team-positions evaluated         921,658

TENET A — "Locked" shown on points  138,702
  kept (locked at now)              131,608
  award-qualified at now              7,081   qualified, by award — indeterminate on points
  VIOLATIONS                             13

TENET B — "Locked out" shown        190,854
  kept (eliminated at now)          190,828
  award-qualified at now                 26   qualified by award — says nothing about points
  unresolved tie at now                   0
  VIOLATIONS                              0

"Locked · award" chip shown          24,192   a different promise; not tenet A's subject
In range shown                      199,465   projection-based; not a tenet (see below)
Out of range shown                  368,445   projection-based; not a tenet (see below)
Prequalified shown                        0   no prequalification exists at this tier
Capacity-unknown shown                    0

violations landed on step kinds:    playoffs   (the only kind, across all 13)
seasons with a tie at the final line (contending at now): 15
  2018mar, 2018ne, 2019ont, 2020fma, 2020pch, 2020pnw, 2020tx, 2023pnw,
  2024fit, 2024ne, 2024ont, 2025ont, 2026fit, 2026fsc, 2026isr
seasons with an unfinished district-tier event at now:    19
  2016chs, 2017pch, 2019chs, 2020chs, 2020fim, 2020fma, 2020fnc, 2020in,
  2020isr, 2020ne, 2020ont, 2020pch, 2020pnw, 2020tx, 2022chs, 2022pch,
  2023ne, 2024chs, 2024pch
```

Only four seasons carry any violation at all: `2020fnc` (1), `2020pch` (3), `2020pnw` (8) and
`2025fnc` (1). The whole sweep runs in 3.2 seconds.

**Two caveats stated rather than absorbed.** First, the sweep runs with no event artifacts, so
every open cell renders `unavailable` and a team's `projection` falls back to its earned
district-tier total — which changes `In range` / `Out of range`, both decided by a projection
cut line. Those two counts are reported for completeness and are **not** the subject of either
tenet; `Locked` and `Locked out` come from the floor, the ceiling, the slot count and the award
set, none of which reads a distribution. Second, the empty artifact map is why the position set
is the stage positions alone. That is the right sweep set, not a shortcut: a within-quals
position has the same award set as the `qualsDone` step that follows it but a lower floor and a
higher ceiling, and a looser floor/ceiling pair at the same pool and slot count can only
produce *fewer* `Locked` and `Locked out` displays.

## The 13 violations

Every one is a tenet A violation, every one sits on a **`playoffs` step**, and every one has
`floor == ceiling == final total` at the offending position — the team had nothing left to
earn, so the reversal cannot be its own points changing.

| district | year | team | position | floor | ceiling | final total | final status |
|---|---|---|---|---|---|---|---|
| 2020fnc | 2020 | frc4795 | `2020ncash:playoffs` | 28 | 28 | 28 | eliminated |
| 2020pch | 2020 | frc5219 | `2020gaalb:playoffs` | 21 | 21 | 21 | contending |
| 2020pch | 2020 | frc5632 | `2020gaalb:playoffs` | 21 | 21 | 21 | contending |
| 2020pch | 2020 | frc7514 | `2020gaalb:playoffs` | 21 | 21 | 21 | contending |
| 2020pnw | 2020 | frc1432 | `2020wabel:playoffs` | 19 | 19 | 19 | contending |
| 2020pnw | 2020 | frc1510 | `2020wabel:playoffs` | 19 | 19 | 19 | contending |
| 2020pnw | 2020 | frc1432 | `2020wayak:playoffs` | 19 | 19 | 19 | contending |
| 2020pnw | 2020 | frc1510 | `2020wayak:playoffs` | 19 | 19 | 19 | contending |
| 2020pnw | 2020 | frc1432 | `2020orsal:playoffs` | 19 | 19 | 19 | contending |
| 2020pnw | 2020 | frc1510 | `2020orsal:playoffs` | 19 | 19 | 19 | contending |
| 2020pnw | 2020 | frc1432 | `2020waahs:playoffs` | 19 | 19 | 19 | contending |
| 2020pnw | 2020 | frc1510 | `2020waahs:playoffs` | 19 | 19 | 19 | contending |
| **2025fnc** | **2025** | **frc3229** | `2025ncpem:playoffs` | 80 | 80 | 80 | **eliminated** |

Twelve of the thirteen are in **2020**, the COVID-cancelled season, whose events were called
off mid-season and whose `now` verdicts are therefore a season that never finished. **Exactly
one is in a normally completed season**: `2025fnc`, team 3229.

### The mechanism, traced on 2025fnc frc3229

`dcmpSlots` is 40 throughout. Team 3229 had already finished all of its own events, so its
floor, ceiling and total are 80 at every one of these positions — nothing about the team
changes:

| position | awardQualified | pointsSlots | poolSize | threatCount | elimCount | verdict | cut line |
|---|---|---|---|---|---|---|---|
| `2025ncpem:qualsDone` | 5 | 35 | 82 | 51 | 30 | contending | 71 |
| `2025ncpem:alliance` | 5 | 35 | 82 | 47 | 32 | contending | 72 |
| **`2025ncpem:playoffs`** | 5 | **35** | 82 | **34** | 34 | **locked** | 80 |
| `2025ncpem:awards` | **6** | **34** | 81 | 34 | 34 | **eliminated** | 86 |
| `now` | 6 | 34 | 81 | 34 | 34 | eliminated | 86 |

At the `playoffs` step the last event's playoffs are decided (which is what drops threatCount
from 47 to 34) but its **Impact award has not been posted**. `qualifierPool` therefore still
counts that award's slot as available to the points pool, `pointsSlots` reads 35, and
`threatCount 34 < 35` reports **Locked**. One step later the award is posted, `pointsSlots`
drops to 34, `34 < 34` is false and `elimCount 34 >= 34` fires: **eliminated**. A knife edge of
exactly one slot, held open for exactly one position. The 2020 rows are the identical trace at
their own numbers.

**This is not rewind-specific.** The live `now` position runs the same code path, so during a
real season a team can read `Locked` today and lose it tomorrow when an Impact award is posted
at a later event. The rewind only makes it visible after the fact.

As instructed, **`packages/core/districts/locks.ts` and the status rule were not touched.** The
choice — reserve the not-yet-posted consuming award slots so `Locked` becomes strictly
conservative, or keep the current optimism — is Jacob's.

## Tests

`scripts/measureLedgerTenets.test.ts`, 15 tests, all green, 3.13s.

- **Pure half** (9 tests, runs in CI with no corpus): the two scoring truth tables; a tiny
  hand-built district (three teams, one finished event, one dcmp slot) whose six stage
  positions really do display `Locked` three times and `Locked out` six times; that fixture
  with honest final verdicts producing zero violations; **the same fixture with two final
  verdicts deliberately flipped, producing exactly 3 tenet A and 3 tenet B violations and
  leaving the untouched third team alone** — a tenet checker that cannot be made to fail is
  indistinguishable from one that always prints zero; the `lockedAward` and `contending`
  classification decisions pinned as their own cases; and the loader's `v1__district__` vs
  `v1__districts__` discrimination plus the null-capacity skip, exercised against a temp
  directory.
- **Corpus half** (6 tests, `existsSync` guard plus an explicit `it.skip`): the real sweep, with
  the counts pinned as floors, tenet B asserted at **zero**, and tenet A pinned at its measured
  **13** with all thirteen `district/team/position` triples listed. Deliberately not written as
  `toBeLessThanOrEqual(13)` — a range would let a fourteenth hide.

## Verification

| check | result |
|---|---|
| `npx vitest run scripts/measureLedgerTenets.test.ts` | 15/15 green, 3.13s |
| `npx tsc --noEmit` (root) | clean |
| `npx tsc --noEmit -p apps/web/tsconfig.json` | clean |
| `pnpm measure:ledger-tenets` | runs, prints the census, **exits 1** (13 violations exist) |

The non-zero exit is correct and intended: it is a measurement tool reporting a real defect,
not a CI gate. The indeterminate buckets never affect the exit code.

## Concurrency note

Another session was editing `apps/web/src/components/districts/*` during this task (quick task
260925-mju, plus an additive `rookieBonus` field on `DistrictLedgerTeam`). That change is purely
additive and touches no part of the floor, ceiling, stage or status path, so the measurement is
unaffected. Every commit here staged by explicit path only; nothing under `.planning/sketches/`
or `data/` was touched.
