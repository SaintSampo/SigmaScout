---
id: preschedule-schedule-count-and-acceptance-bar
created: 2026-09-12
source: rung-2 experiment Phase A — the acceptance bar is unreachable at the shipped count
resolves_phase: 9
priority: high
---

# The pre-schedule acceptance bar measures noise at the shipped count, and the draw budget sits on a saturated axis

## The bar measures noise, not accuracy

There are two noise floors and **plan 09-09 measured the one that does not bind.** Its
`measureSeedNoiseFloor` holds the priced schedules fixed and varies only the draw seed. A candidate
arm draws its **own** K shuffles, so the floor it must clear is the licensed construction built
**twice** with independent shuffle-and-draw streams.

| schedules | total draws | draw-only c1 | binding c1 | binding worst team |
|---|---|---|---|---|
| **20 (shipped)** | 1,000 | 68.4% | **27.0%** | **10.61 ranks** |
| 150 | 7,500 | 90.6% | 50.0% | 4.44 |
| 1,000 | 50,000 | 100.0% | 81.1% | 1.17 |
| 2,000 | 100,000 | 100.0% | 91.8% | 1.13 |
| 4,000 | 200,000 | 100.0% | **98.4%** | 0.71 |

At the shipped count the worst team moves **10.61 ranks between two runs of the identical
construction**. Clause 1 (95% within 0.5 ranks) is unreachable today by **any** method, including
the licensed path that is live. **Anything scored against clause 1 at n=20 is scoring randomness.**

95% is reachable, measured directly at n=4000. The extrapolation is stable at 2,720-4,033 from every
measured count, and the direct measurements bracket it.

## The draw budget is on a saturated axis

`PRESIM_DRAWS_PER_SCHEDULE = 50` (`publish.ts:155`) buys nothing past n~1000 — the draw-only floor
is already 100% there while the binding floor is still 81%. At a fixed total budget, schedules
dominate draws: one session measured 20x1000 as **5.7x worse** than 1000x20.

## The decision to make

1. **Set the count.** ~4,000 schedules is where the bar becomes usable. Cheap once
   `stop-baking-preschedule-schedules` lands — the aggregate grows logarithmically.
2. **Restate the bar together with the count**, as the developer decided on 2026-09-11. A tolerance
   in rank units is only meaningful against the measurement's own resolution. Record which floor it
   is stated against — the binding one, not the draw-only one.
3. **Rebalance schedules against draws** rather than leaving `drawsPerSchedule` at 50 by inertia.

**Caveat to carry:** the binding floor scales as the inverse square root of n with **no plateau**
across every count measured. There is no converged N, only precision bought. Whatever count is
chosen is a cost decision, not a correctness one.
