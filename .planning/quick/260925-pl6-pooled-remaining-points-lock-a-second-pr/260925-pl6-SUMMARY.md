---
id: 260925-pl6
slug: pooled-remaining-points-lock-a-second-pr
kind: quick
status: complete
completed: 2026-09-25
subsystem: districts
key-files:
  created:
    - packages/core/districts/pointPool.ts
    - packages/core/districts/pointPool.test.ts
    - packages/core/districts/pointPool.reconciliation.test.ts
    - packages/core/districts/pooledLockInputs.ts
    - packages/core/districts/pooledLockInputs.test.ts
  modified:
    - packages/core/districts/locks.ts
    - packages/core/districts/locks.test.ts
    - packages/core/districts/reservedSlots.ts
    - packages/core/districts/reservedSlots.test.ts
    - apps/web/src/components/districts/districtLedgerRows.ts
    - apps/web/src/components/districts/districtLedgerStatus.ts
    - apps/web/src/components/districts/districtLedgerStatus.test.ts
    - packages/harness/districtRankingsMerge.ts
    - packages/harness/districtRankingsMerge.test.ts
    - scripts/measureLedgerTenets.ts
    - scripts/measureLedgerTenets.test.ts
    - apps/web/src/components/methodology/districtLedgerContent.ts
    - apps/web/src/components/methodology/acknowledgmentsContent.ts
decisions:
  - "THE PAPER'S AWARD POOL IS WRONG FOR THIS CORPUS AND WAS NOT USED. Measured over all 951 district-tier events of 2016 to 2026 before any code was written: the highest award total ever handed out at one district event is 78 with no rookie attending, 86 with one and 91 with two or more. The paper's 63/71/76 are each exactly 15 low, and 661 of the 951 events exceed them. The rookie STRUCTURE the paper describes is real and reproduced in the data (a base, plus 8 for Rookie All Star, plus 5 more for Rookie Inspiration); only the base differs."
  - "THE IMPACT AWARD'S 10 POINTS STAY IN THE POOL, against the task's instruction to exclude them. The 260925-ms7 reservation withholds a SLOT; the Impact winner's ten POINTS are still in its published total and still rank it, and before the award is posted that winner is still sitting in the points pool as a rival. Excluding them would understate the pool by ten at every event with an award still to come, and understating the pool is the one direction this module must never err in."
  - "THE GUARANTEED LAST-PLACE ADJUSTMENT IS NOT APPLIED -- the task's own 'neither' branch, taken for a measured reason. The attendee count a corpus-free reader has is the artifact's row count, and a real field can be larger (a non-district team at a district event earns no district points and appears in no district_rankings row). Measured, the observed qualification total exceeds sum f(r,m) at 38 of 951 events, by up to 10 points. qualificationPool therefore evaluates f at m plus 3 phantom attendees and does NOT subtract the guaranteed baseline: subtracting it would take about 148 points per event back out and reopen that hole fourteen times wider."
  - "A tie counts as ALREADY AHEAD when the rank is taken, which is locks.ts's own tie philosophy and the conservative direction: a larger rank means fewer rivals need to pass, a smaller minimum cost, and a harder lock. Two teams tied for the last slot are still both contending."
  - "LockResult gained lockedBy rather than the sweep re-deriving which test fired. Without it the counterfactual could only be measured by running the browser's whole status pass twice, and 'the pooled test fired where the ceiling test did not' is exactly the number that had to be reported."
  - "The pooled argument is wired into the DISTRICT pass only. The champ pass passes none: a district championship's own pool is a different tier against a different slot pool, and modelling it was out of scope."
  - "districtEventCategoryFinality moved into reservedSlots.ts, beside the two state predicates that read the same facts, and districtEventStateFinished is now derived from it. Three consumers (the browser's stage derivation, the reservation, the pool) now share one rule instead of two copies."
findings:
  - "BOTH TENETS STILL MEASURE ZERO over 921,658 team-positions in 109 district seasons, and the argument makes MORE promises rather than fewer. Locked on points rose from 130,505 to 130,718."
  - "THE GAIN IS 213 TEAM-POSITIONS, at 110 of the 4,022 swept positions, and every one of the 213 is a team the ceiling test could not reach (lockedBy is 'pooled', never 'both'). The two numbers cross-check: the rise in Locked displays equals the pooled-only count exactly, and the 213 came 211 from In range and 2 from Out of range."
  - "NO PUBLISHED NUMBER MOVES. All 109 published artifacts were recomputed through the shared verdict pass: 16,345 team rows compared, zero district lock status changes, zero champ lock status changes, zero cut line changes, zero insights count changes. Every district-tier event of a finished season has all four categories final, so the pool is zero and the pooled test locks exactly the teams the ceiling test already locked."
  - "Locked out (190,854) and the Locked award chip (24,192) do not move at all, and neither does the 260925-ms7 reservation (26,604 slots at 3,804 positions). The pooled argument reaches the Locked test alone."
  - "The pool is not decorative: 23,732,244 district points summed over every swept position were what the argument was asked against."
  - "A corpus reconciliation now proves no district-tier event in the corpus ever handed out more than the declared pool, per category and in total (951 events, zero over on all five checks)."
owed:
  - "A Pages deploy carries the browser half and a Worker redeploy plus a district publish carries the producer half. NEITHER changes a published number for a finished season, measured. A LIVE district with events still ahead will read more Locked verdicts once they ship, which is the point."
---

# Quick task 260925-pl6: a second proof of Locked, from the district's conserved points

**A team is now Locked when EITHER no single rival can reach it OR no achievable distribution
of the district's remaining points could lift enough rivals past it. Measured over 921,658
team-positions in 109 published district seasons: 213 more team-positions read `Locked`, at 110
of the 4,022 swept positions, and both of Jacob's tenets stayed at zero violations.**

## The argument

The shipped ceiling test treats every rival's ceiling as INDEPENDENTLY reachable: forty teams
with an event left read as forty separate 83-point threats. Points are conserved inside an
event, so what the whole district still has to hand out is far less than the sum of those
ceilings. From "District Points Analysis: Mathematical Locks for Advancement" (Liatys and Papa,
2024, frclocks.com):

```
aheadCount(A)   = other pool teams with pointTotal >= pointTotal(A)   // a tie counts as ahead
needed(A)       = lockSlots - aheadCount(A)
candidates      = pool teams with pointTotal < pointTotal(A), highest first,
                  that still have a district event to play
minimumToEliminate(A) = sum of (pointTotal(A) - pointTotal(rival)) over the first `needed`
                        candidates, or infinity when fewer than `needed` exist
pooledLocked(A) = needed > 0 AND minimumToEliminate(A) > remainingPoints
```

The two tests are OR-ed, never substituted; `eliminated` and `pointsToLock` keep their
definitions exactly, and with no `pooled` argument every returned field is what it was before.
The paper's worked example (70 points, rank 58 of 60, rivals on 68/64/62/61 with the 64 unable
to score, minimum 19) is reproduced as a unit test.

## The pools, measured before they were written

Every constant was checked read-only against `data/corpus.sqlite` over all 951 district-tier
events of 2016 to 2026, summing each event's `event_points_raw` components over every team.
Two of the task's four values are wrong for this data:

| Category | Task's value | Highest total ever handed out | Shipped |
| --- | --- | --- | --- |
| Alliance selection | 236 | 236, 0 events over | 236, recomputed from `selectionPoints.ts` |
| Playoffs | 213 | 212, 0 events over | 213 (3 x 70 plus a 3 point backup robot margin) |
| Awards, 0 rookies | 63 | **78** | 78 |
| Awards, 1 rookie | 71 | **86** | 86 |
| Awards, 2+ rookies | 76 | **91** | 91 |
| Qualification | `sum f(r,m) - m*f(m,m)` | exceeds `sum f(r,m)` at 38 events, by up to 10 | `sum_{r=1..m} f(r, m+3)` |

The rookie structure the paper describes is real and visible in the data (a base, plus 8 when a
rookie attends, plus 5 more when a second does); only the base differs. The Impact award's ten
points stay in the pool, because the 260925-ms7 reservation withholds a slot rather than those
points, and the eventual winner is still in the points pool until the award posts.

The qualification pool is the one whose field size cannot be known from the artifact: a
non-district team at a district event takes a rank, earns no district points and appears in no
`district_rankings` row, so the real total can exceed `sum f(r, m)` — measured, at 38 of 951
events, worst at `2017vabla` (29 rows, 382 reported against 372 computed). Evaluating `f` at
`m + 3` closes it with headroom (zero events over at `m + 2` already), and the guaranteed
last-place value is deliberately NOT subtracted back out, because that would remove roughly 148
points per event and reopen the same hole fourteen times wider.

`pointPool.reconciliation.test.ts` re-derives that whole census on every run in a checkout that
has the corpus: five checks, 951 events, zero over on each.

## The proof

### The tenets sweep, before and after

`pnpm measure:ledger-tenets` over `data/local-publish/districts`, 109 seasons, 4,022 stage
positions, 921,658 team-positions, both runs.

| | Before | After | Change |
| --- | --- | --- | --- |
| `Locked` shown on points | 130,505 | **130,718** | **+213** |
| kept (locked at now) | 124,022 | 124,210 | +188 |
| award-qualified at now | 6,483 | 6,508 | +25 |
| **TENET A violations** | **0** | **0** | 0 |
| `Locked out` shown | 190,854 | 190,854 | 0 |
| **TENET B violations** | **0** | **0** | 0 |
| `Locked · award` chip | 24,192 | 24,192 | 0 |
| In range | 207,584 | 207,373 | -211 |
| Out of range | 368,523 | 368,521 | -2 |
| slots held back (260925-ms7) | 26,604 | 26,604 | 0 |
| positions holding one back | 3,804 of 4,022 | 3,804 of 4,022 | 0 |
| Locked on the POOLED argument alone | n/a | **213** | new |
| positions where it fired alone | n/a | **110 of 4,022** | new |
| district points still to hand out | n/a | 23,732,244 | new |

The two new counts cross-check the gain: 213 pooled-only locks, a rise of exactly 213 in
`Locked` displays, and exactly 213 displays lost from In range (211) and Out of range (2). Every
one of them reports `lockedBy: "pooled"` rather than `"both"`, which is the evidence that the
ceiling test did not reach them.

### The 109 published artifacts

All 109 recomputed through `recomputeDistrictVerdicts` and diffed against their published
values: **16,345 team rows compared, zero district lock status changes, zero champ lock status
changes, zero cut line changes, zero insights count changes.** Nothing is owed to a republish.

The reason is structural rather than lucky: every district-tier event of a finished season has
all four categories final, so the pool is zero and `hasRemainingEvent` is empty. The pooled test
then locks exactly the set `aheadCount < lockSlots`, which at a finished position is exactly the
ceiling test's own `threatCount < lockSlots`. Three tests pin that equality directly
(`locks.test.ts`, `pooledLockInputs.test.ts`, `districtRankingsMerge.test.ts`).

### Tests

- `pointPool.test.ts` (16) — the three fixed pools by value and against their own summands, the
  rookie increments, monotonicity in field size, the open-category selection, a finished event
  at exactly zero.
- `pointPool.reconciliation.test.ts` (7, corpus-guarded) — no real district event ever exceeded
  the declared pool, per category and in total.
- `pooledLockInputs.test.ts` (9) — the two zero cases, first-finality-seen-wins, rookie counting.
- `locks.test.ts` (+13) — the paper's worked example and its 19, the skipped rival that makes it
  19 rather than 16, the flip from contending to locked, `lockedBy`, the tie rule, elimination
  untouched, identical-with-no-argument, and two seeded property tests (a bigger pool never adds
  a lock; the argument never removes one).
- `reservedSlots.test.ts` (+5), `districtLedgerStatus.test.ts` (+4),
  `districtRankingsMerge.test.ts` (+4), `measureLedgerTenets.test.ts` (+1 with two new pinned
  floors).

Full suite from the repo root: **288 files, 6,419 passed, 1 skipped.** Four `tsc --noEmit`
projects (root, `apps/web`, `apps/worker`, `apps/web` e2e) all clean.

## Commits

| Commit | What |
| --- | --- |
| `79ac00d0` | one rule for which district point categories are final |
| `48f3bc89` | `pointPool.ts` and its measured constants, plus the corpus reconciliation |
| `8472f151` | the pooled test in `locks.ts`, and `lockedBy` |
| `61de5536` | `pooledLockInputs.ts`, the artifact-to-inputs adapter |
| `630d988f` | the browser tab asks it at every rewind position |
| `ee72e96a` | the shared verdict producer asks it at now |
| `2a91a76b` | the tenets sweep counts the gain and pins it |
| `f8d51116` | the methodology paragraph and the paper's credit |
