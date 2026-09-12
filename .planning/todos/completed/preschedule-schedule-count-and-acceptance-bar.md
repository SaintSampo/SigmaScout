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
3. **CLOSED 2026-09-12 — the draw/schedule split.** ~~Rebalance schedules against draws~~ rather
   than leaving `drawsPerSchedule` at 50 by inertia.

   Measured: schedule count held fixed at 200 while `drawsPerSchedule` was varied over 1, 5, 25,
   50, 100 and 200, and a cost model `cost(d) = pricing + d * simPerDraw` was fitted to the
   result.

   | event | size | pricing | drawing at d=50 | drawing share |
   |---|---|---|---|---|
   | `2026joh` | 75 teams, 125 quals | 3.0775 ms/schedule | 0.9466 ms | 23.5% |
   | `2026txmca` | 18 teams | 0.9164 ms/schedule | 0.2425 ms | 20.9% |

   Pricing dominates drawing roughly 4:1. Cutting `d` from 50 to 10 frees only about 20% of
   per-schedule cost, which funds 1.23x the schedules — worth `sqrt(1.23)` ~ 1.11x on the binding
   floor. And it is not free: total draws would fall from 50,000 to about 12,000, where the
   draw-only floor slips from 100% to about 96%. **CONCLUSION: leave `drawsPerSchedule` at 50.**

   This does **not** contradict the earlier 5.7x finding directly above ("one session measured
   20x1000 as 5.7x worse than 1000x20"). That finding was about statistical value per draw; this
   one is about wall-clock cost per schedule. They answer different questions and both stand — a
   reader who sees "schedules dominate draws" next to "leave draws at 50" without this sentence
   will think one of them is wrong.

**Caveat to carry:** the binding floor scales as the inverse square root of n with **no plateau**
across every count measured. There is no converged N, only precision bought. Whatever count is
chosen is a cost decision, not a correctness one.

## Cost basis corrected (2026-09-12)

Earlier publish-cost estimates in this todo's lineage were derived by **differencing whole Phase
A runs**, which include `measureResamplingFloor`'s quantile work that a real publish never pays —
making them about **1.8x too high**.

Corrected method: time `buildPreScheduleArtifact` directly. That gives **3.8 ms/schedule** on
`2026joh` at d=50, i.e. **0.0306 ms per schedule per match**. Against the 641 sidecars the
2026-09-12 publish actually wrote, added publish time is about **14 min at 600 schedules, about
23 min at 1,000, and about 91 min at 4,000**.

Operational fact that makes those numbers wall-clock rather than CPU-seconds: the build runs
**synchronously** inside `publish.ts`'s per-event loop at line 3166, so none of it parallelizes —
`DEFAULT_CONCURRENCY` governs uploads only.

## Rung-1 branch CLOSED (2026-09-12)

Quick task `260912-0v3` confirmed the NO-SHIP on evidence at n=4,000: candidate **41.4%** against
a binding floor of **98.4%**, worst team **3.33 ranks** against a floor of **0.71 ranks** —
failing structurally and scaling with roster size. See
`.planning/quick/260912-0v3-re-run-rung-1-at-n-4000-schedules-agains/260912-0v3-SUMMARY.md` for
the full measurement; the four figures above are the whole quotation budget here.

Consequence for this document: the count question above is **LIVE** rather than possibly moot,
and the rung-2 generator is the path.

## DECIDED 2026-09-12 by Jacob — ship at 1,000, measure at 4,000

**Ship count: `PRESIM_SCHEDULE_COUNT` = 1,000.** At that count a team's displayed rank moves about
**1.2 ranks** between two runs of the identical construction (worst team; pooled mean 0.275), which
is below what a reader can perceive given ranks are integers. Cost is about **23 minutes** added to
a publish, taking it from roughly 41 to 64 minutes. 4,000 was considered and declined: it buys
1.2 ranks down to 0.71 — invisible on an integer scale — for another hour on every future
republish.

**Measurement count: 4,000.** The acceptance bar is stated against measurements taken at 4,000,
where the binding floor is 98.4% and clause 1 is demonstrably satisfiable. This runs offline on the
six-event panel in about six minutes and never touches a publish.

**The bar restated, together with the count, as decision item 2 required.** Clause 1 is unchanged —
at least 95% of teams within 0.5 median ranks, every team within 1.0. What is now pinned is *what
it is measured against and at what resolution*: the **binding (resampling) floor** — the same
construction built twice with independent shuffle-and-draw streams — at **n=4,000**. The draw-only
seed-noise floor is a labelled diagnostic and may never be quoted as the ceiling.

**Why ship and measure counts may legitimately differ.** The count is not part of what is being
compared; it is the shared precision knob both arms are measured at. Two constructions are compared
at 4,000 because that is where the measurement can resolve half a rank. The winner then ships at
whatever count is affordable, because the count changes precision, not which construction is
better.

**Decision item 3 (rebalance schedules against draws) is closed above: `drawsPerSchedule` stays
at 50.** So the shipped configuration is 1,000 x 50 = 50,000 baked draws.

This unblocks `drop-licensed-schedule-templates`, which was gated on this decision, and answers
option 1 of `live-preschedule-band-is-mostly-sampling-noise`.

## Step 1 has LANDED — raising the count is now safe (2026-09-12)

`stop-baking-preschedule-schedules` is **closed** (quick task `260912-2ur`, commits `5cd916e8`,
`43e79b30`, `efb0c24f`). The prerequisite this document depended on is done: the published sidecar
no longer carries the priced `schedules` block and carries a `scheduleCount` scalar instead.

**What that means for the count.** The blocker was size, and it is gone. With the block baked, a
sidecar at 1,000 schedules would have been about 18 MB — roughly 11.5 GB of presim across the 641
sidecars a publish writes, against a 10 GB R2 free tier. Aggregate-only it is about 24 KB. So
setting `PRESIM_SCHEDULE_COUNT` to 1,000 is now a one-constant change plus the tests that pin 20,
and the artifact still ships **smaller than it does today**.

**One thing to know when doing it.** `schedules` survives in the in-memory shape on purpose — both
measurement scripts read it and are the rung-1/rung-2 acceptance harness. `pageArtifacts.ts` now
carries two schemas: `PreScheduleArtifactSchema` (strict, required `schedules`, all five
refinements) for the builder and the scripts, and `PublishedPreScheduleArtifactSchema` for the wire.
Raising the count touches neither; it only changes what the builder is asked for.

**The published bytes do not change until a republish.** Every presim object on R2 still carries the
old shape, which the published schema deliberately still parses, so there is no deploy/republish
ordering constraint either way.

---

## CLOSED 2026-09-12 — decided, applied, and test-pinned

Closed as part of the 2026-09-12 backlog triage (`.planning/triage-2026-09-12.md` §3).

All three decision items this file existed to force are answered above, by Jacob, and the answers
are now in code rather than only in prose:

| Item | Answer | Where it lives at HEAD |
|---|---|---|
| 1 — set the count | 1,000 schedules | `ea84a0da` "feat(260912-5hs): PRESIM_SCHEDULE_COUNT 20 -> 1,000", applied in `packages/harness/publish.ts` |
| 2 — restate the bar with the count | clause 1 unchanged, measured against the **binding (resampling)** floor at n=4,000 | the "DECIDED 2026-09-12 by Jacob" section above |
| 3 — rebalance schedules against draws | no: `drawsPerSchedule` stays at 50 | the "CLOSED 2026-09-12 — the draw/schedule split" section above |

Shipped configuration: **1,000 x 50 = 50,000 baked draws**, test-pinned at those two values.

**The one thing this closure does NOT assert: that the published bytes have changed.** Every presim
object on R2 still carries the pre-`ea84a0da` shape — 20 schedules, `baked.draws: 1000`, no
`scheduleCount`. The constant is applied at HEAD; the artifacts catch up on the next
`pnpm publish:seasons`. That republish is the open item, tracked as the next action in
`.planning/triage-2026-09-12.md` §2, not as a decision owed here.

`live-preschedule-band-is-mostly-sampling-noise` is closed alongside this one for the same reason:
its option 1 is what was chosen, and what remains is an operational publish rather than a decision.
