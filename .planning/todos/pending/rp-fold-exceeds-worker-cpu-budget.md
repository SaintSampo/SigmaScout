---
id: rp-fold-exceeds-worker-cpu-budget
created: 2026-09-12
source: first real run of the pre-event probe (quick task 260912-3e6), measured against live D1 on 2026-09-12
resolves_phase: 9
priority: high
---

# A realistic mid-event tick costs ~13 ms p50 / ~28 ms p90 in Phase A alone, against a 10 ms budget

This is the measurement half of [[worker-state-shape-unexercised-since-seed]], now taken. That item's
shape question came back clean; this one did not, and it is filed separately because it is a
different problem with a different fix.

## What was measured

`apps/worker/src/stateProbe.ts`, deployed as `sigmascout-state-probe` version `318caa2f` from commit
`e4ba00c1` — the same commit the live Worker (`267a226b`) was deployed from — run against live D1 at
generation `b23d214d`. 60 invocations, 15 per load level, `cpuTime` read off `wrangler tail`:

| Load | p50 | p90 | max |
|---|---|---|---|
| 0 folded / 0 upcoming (three deserializations + 2 discovery queries) | 4 ms | 7 ms | 7 ms |
| 2 folded / 0 upcoming | 6 ms | 14 ms | 17 ms |
| 2 folded / 15 upcoming | 8 ms | 13 ms | 14 ms |
| **2 folded / 60 upcoming** | **13 ms** | **28 ms** | **29 ms** |

The last row is the realistic shape of a tick during quals: a couple of newly-played matches to fold,
and the rest of the schedule still upcoming and being repriced.

## Why this is the real number, not a scary artifact

- **It is Phase A only.** No Phase B (artifact merge, R2 read/write), no TBA poll, no KV manifest
  read, no global rebuild. Everything the probe leaves out makes a real tick *more* expensive.
- **It is one event.** A regional weekend runs several concurrently. The subrequest budget defers
  events it cannot afford; the CPU budget has no such valve.
- **It under-prices the RP path it does run.** `rpPmfsProduced` came back 43 of a possible 62 on
  every single invocation — 19 matches had RP suppressed by the gates, reproducibly. A run where
  every match produced a pmf would cost more, not less. (Why 19 are suppressed is worth knowing on
  its own and is not yet established.)
- **The upcoming loop is the dominant term**, which matches the code: `processEvent` re-prices
  `predict` + two `bandFor` + a full `analyticRpPmf` over *every* still-upcoming match at the event
  (`apps/worker/src/scheduled.ts:1253`), every tick. Holding folds at 2 and going 0 → 60 upcoming
  adds ~7 ms p50 / ~14 ms p90.

Two corrections that make the figure smaller and neither of which closes the gap: the probe
deserializes all three algorithms where a live tick folds only `bpr` (~2–3 ms of the 4 ms baseline),
and it spends 2 discovery queries a tick does not. Tick-shaped: still ~10–11 ms p50, ~25 ms p90.

## Why this is urgent rather than interesting

The 10 ms budget is not a flat per-invocation ceiling — isolates carry flexibility and termination
follows from hitting the limit **consistently** (`docs/worker-operations.md`, "How the CPU budget is
actually enforced"). That cuts both ways here. A single 28 ms tick is survivable; a *sustained* p50
above the budget for the whole duration of an event weekend is exactly the condition that kills the
isolate, and it is what this measurement describes. This is the same shape as the 2026-08-28 outage,
where every tick died `exceededCpu` for days.

Nothing is live right now, so nothing is currently failing. The first real event is when this bites.

## THE ABLATION IS TAKEN — Phase 9's share is a number now, not an inference (2026-09-12)

Measured with the probe's new `rp` flag (quick task `260912-iur`), probe version `c0405758`,
against live D1. 53 invocations per arm at `folded=2&upcoming=60&teamCount=21`, **interleaved**
so both arms share any platform drift, after warm-up. Zero non-`ok` outcomes.

| Arm | n | p50 | p75 | p90 | max | mean | % of ticks over 10 ms |
|---|---|---|---|---|---|---|---|
| `rp=1` — as deployed | 53 | **13 ms** | 17 | **28 ms** | 53 | 14.8 | **62%** |
| `rp=0` — Phase 9's RP work ablated | 53 | **6 ms** | 8 | 19 ms | 32 | 8.6 | **13%** |
| delta | | **7 ms** | 9 | 9 ms | | 6.2 | |

**The `rp=1` arm independently reproduces the figure that opened this todo** — 13 ms p50 / 28 ms p90,
measured on a different probe version on a different day. The instrument agrees with itself.

### What this settles

**Phase 9's RP fold is the dominant controllable term: ~54% of p50, ~42% of mean.** The question
this ablation existed to answer is answered, and it answers the other way from a reasonable prior —
the pre-existing upcoming-repricing loop is real but is *not* what puts the tick over budget.

**It converts an occasionally-spiky tick into a consistently-over-budget one, which is the
distinction that matters.** Termination follows from hitting the limit *consistently*, not from one
expensive tick. Ablated, **13%** of ticks exceed 10 ms — spikes the isolate's flexibility absorbs.
As deployed, **62%** do. That is the 2026-08-28 condition.

### What it does NOT say

- **Not "revert Phase 9".** The ablated arm still shows p90 19 ms and 13% over budget, so the
  pre-existing loop is not free either. Removing RP buys headroom, not safety.
- **Not a clean subtraction.** `dc30636e` *also* made Phase A cheaper — it hoisted the band calls,
  halving band evaluations from four per match to two, in both loops. So `on − off` is a **net**
  figure and any sum-of-added-operations arithmetic would have been wrong in an unknown direction.
  This is the strongest argument for having measured rather than reasoned.
- **`bandFor` is not Phase 9's** and runs in both arms — it landed `63596da3` (2026-09-09), two days
  before Phase 9 began. It sits beside `rpFieldsFor` and feeds its band-presence gate, which is
  exactly why it reads as RP work and is not. Ablating it would have billed Phase 9 for pre-existing
  cost. Confirmed by `bandsProduced == 124` in **both** arms; if that ever differs between runs, the
  runs are not comparable and the numbers must be discarded.

### Consequence for the directions below

The dominant term is the RP work on the **upcoming** path, so the two directions that target it
specifically — cheapening `analyticRpPmf` on the upcoming path, and moving upcoming-match RP pricing
offline — are now the ones worth pricing first. Rotation and tick-splitting bound a cost that is
mostly not where the cost is.

**Reproduce with:**
`https://sigmascout-state-probe.jrw4561.workers.dev/?season=2026&teamCount=21&folded=2&upcoming=60&rp={1|0}`
— `params.rp` states the arm, the ablated arm self-labels in `warnings`, and an unrecognised `rp`
value runs **enabled** and says so, so a typo cannot silently measure the wrong arm.

## Directions worth pricing (none chosen)

- **Stop repricing every upcoming match every tick.** The predictions for match 57 do not change
  meaningfully because match 12 just finished. Reprice on a rotation, or only matches within some
  horizon, or only when the touched teams intersect the upcoming match's roster.
- **Split the tick.** The subrequest budget already defers whole events; CPU has no equivalent.
  A per-tick CPU-shaped work cap with the same rotation-offset fairness would bound it.
- **Cheapen `analyticRpPmf` on the upcoming path** specifically — the folded path needs full
  fidelity, the upcoming path may not.
- **Move upcoming-match RP pricing offline** into the presim sidecar machinery that already exists
  for the pre-schedule case. If this one is priced, note that the sidecar's shape changed on
  2026-09-12 (`260912-2ur`): the published object no longer carries the priced `schedules` block at
  all, only the pooled `baked` histograms and a `scheduleCount` scalar. Per-match pmfs survive in
  the **in-memory** builder shape but are no longer on the wire, so this direction would mean
  publishing something the sidecar deliberately stopped publishing — not reusing what is already
  there. That is a cost, not a blocker, but it is not the freebie the phrase "already exists"
  suggests.

Measure before choosing: the probe takes `folded` and `upcoming` counts, so any of these can be
priced against the same instrument before a line of tick code changes.

Related: [[worker-state-shape-unexercised-since-seed]], [[live-match-updates-swing-and-lossy-merge]].
