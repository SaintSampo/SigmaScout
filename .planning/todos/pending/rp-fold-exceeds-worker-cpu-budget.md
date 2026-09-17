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

**The probe is LEFT DEPLOYED** as `sigmascout-state-probe`, version `c0405758`, so the next fix
direction can be priced against the same instrument rather than a rebuilt one. It is read-only by
construction: its only binding is D1, with **no R2 and no KV at all** (verified in the deploy
output), and `apps/worker/test/stateProbe.test.ts` holds that it never reaches `scheduled.ts` or any
write helper. It has no cron trigger, so it costs nothing until something requests it. Delete it
with `wrangler delete --config apps/worker/wrangler.probe.toml` once this todo closes.

**Reproduce with:**
`https://sigmascout-state-probe.jrw4561.workers.dev/?season=2026&teamCount=21&folded=2&upcoming=60&rp={1|0}`
— `params.rp` states the arm, the ablated arm self-labels in `warnings`, and an unrecognised `rp`
value runs **enabled** and says so, so a typo cannot silently measure the wrong arm.

## COMPONENT PROFILE — where the RP overhead goes (2026-09-14, quick task 260914-nhc)

**Headline: request pacing decides `cpuTime` far more than any RP component does. At a cron-like
pace the dominant component is `analyticRpPmf` itself, and its cost is first-execution work, not
the arithmetic.**

### Provenance

- Probe versions `36d5fb70` (warm pass) and `28051f5c` (cold pass, which adds only a per-isolate
  request counter in the logs), built from `67f0b739` plus the `algorithms=` and counter commits.
- The probe was re-mirrored to the post-teardown tick first, adding display band, prediction Maps and
  touched metrics/Sigma. Live D1 generation `3ba2b580`, spr shape 16, `spr@4.0.0+baseline`.
- All runs use `folded=2&upcoming=60&teamCount=21&algorithms=spr`. **`algorithms=spr` is new and
  load-bearing**: live D1's opr/epa league rows are still shape 15, so reading all three made every
  response a 500. A live tick loads only spr anyway.
- Nine arms were interleaved round-robin with warm-up excluded; percentiles are nearest-rank.
- Fold counters were constant within every arm, `bandsProduced` was 124 in every arm, and
  `rpGatesOpened` was additive. There were zero non-ok outcomes.
- `rpPmfsProduced` is **34 of 62**, so these figures still under-price a roster where every team is
  warm.

### Pacing is the first-order effect

| Pass | Spacing | n per arm | all p50 / p90 | none p50 / p90 | all % over 10 ms |
|---|---|---|---|---|---|
| warm | 200 ms | 60 | 5 / 7 | 3 / 4 | 0% |
| cron-like | 30 s (2 arms) | 18–19 | 23 / 51 | 9 / 34 | 100% |
| cron-like | 30 s (9 arms) | 12 | 15 / 33 | 6 / 16 | 92% |

A live tick does this work only when a match folds, about every 7 minutes, so it is at least as cold
as the 30 s passes. **The 2026-09-12 figures (13 ms on, 6 ms off) sit between the warm and cold
passes, and are not directly comparable to either.**

### Fresh vs reused isolates (the cold 9-arm pass, per-isolate counter from `wrangler tail` logs)

- 22 of 117 requests landed on a brand-new isolate, with a median of 28 ms; reused isolates had a
  median of 10 ms. A reused isolate still runs cold at this spacing.
- On fresh isolates the `none` arm is already about 18 ms. Every fresh-isolate tick is over budget
  whether RP runs or not, and nothing inside the tick can fix that.
- **Reused isolates are the cleaner comparison and the one RP decides.** There `none` has a mean of
  6.7 ms (p50 6), under budget, and `all` has a mean of 16.2 ms (p50 14), over budget.

Reused-isolate component differences (mean ± SE, measured rounds only):

| Component | Difference | Resolved? |
|---|---|---|
| **total RP** (`all − none`) | **9.5 ± 2.1 ms** | resolved |
| **upcoming-loop RP** (`all − skipUpcomingPmf`) | **7.2 ± 2.1 ms** | resolved |
| both loops (`all − skipBothPmf`) | 6.9 ± 2.2 ms | resolved |
| **`analyticRpPmf` formula** (`all − skipFormula`) | **6.0 ± 2.5 ms** | resolved |
| wrapper: gates, `momentsFor`, warm check, mean-shift apply | 1.0 ± 1.6 ms | below resolution at n≈9 |
| folded-loop RP (2 matches) | 2.6 ± 2.3 ms | below resolution |
| resume (`fromBeliefs`, mean-shift resume) | 0.4 ± 0.5 ms | below resolution |
| beliefs write-back passengers | 0.1 ± 2.6 ms | below resolution |
| observe | 2.6 ± 2.5 ms | **confounded**: skipping it cuts gates 34 → 9, so it also removes about 25 formula calls |

Warm pass for contrast: total 1.8 ± 0.3, upcoming 1.3 ± 0.2, formula 0.7 ± 0.3 ms.

### Why the formula is expensive cold: Node benchmark of the CURRENT engine

Same machine as the 2026-09-13 benchmark, 2026 rule module with lattice marginals, 34 calls with
realistic hub/tower moments:

| Node flags | first 34 calls | steady state |
|---|---|---|
| default | 2.73 ms (80 µs/call) | **7.5 µs/call** (was 4.6 µs before lattice marginals shipped) |
| `--no-opt --no-maglev` | 2.49 ms | 26.4 µs/call |
| `--no-opt --no-maglev --no-sparkplug` | 2.92 ms | 35.5 µs/call |
| `--jitless` | 3.21 ms | 35.7 µs/call |

The first 34 calls cost about 2.5–3 ms **under every flag set**, and interpretation alone would cost
only about 1.2 ms. So most of the cold cost is first-call work: lazy compilation, inline-cache
warm-up and first-touch allocation. Workers on a reused-but-cold isolate measured about 6.0 ms / 34 ≈
**175 µs per call**. That is consistent with this first-call cost on slower hardware, paid again
every tick because the compiled code does not survive the ~minutes between ticks.

### What it does NOT say

- Nothing below resolution is "free". It is below resolution at n≈9–12.
- Fresh-isolate arms have n of 0–5 each and cannot be compared per component.
- 30 s spacing is not the real cadence; the real one is colder.
- Still Phase A only: no Phase B, TBA parse, or second concurrent event.

### Implications for an output-identical cheaper tick (not implemented)

- **The formula's cold path is the target, not its arithmetic.** Micro-optimizing the warm math
  (7.5 µs) cannot move a 175 µs cold call. The lever is less code and fewer allocations executed
  for the first time per tick: fewer distinct functions and closures on the lattice path, no
  per-call array-of-arrays variance blocks, and shared precomputed lattice tables per rule module.
  This is uncertain, so measure it with this same cold pass.
- **The wrapper, resume and beliefs are not worth optimizing** at current resolution.
- **Fresh isolates cost about 18 ms before any RP work.** That share (about 15–19% of ticks here)
  either fits under the platform's flexibility for inconsistent overage, or needs the non-RP cold
  path (deserialize, predict, band) looked at separately. Budget termination follows from hitting
  the limit *consistently*, and on reused isolates `none` is under budget.
- **Pricing upcoming RP outside the Worker** (for example in the browser, from published state)
  removes the single resolved dominant term, about 7 ms of 9.5, entirely.

### Reproduce

```
node .planning/quick/260914-nhc-profile-the-worker-tick-rp-overhead-per-/measure/measure-arms.mjs --rounds 12 --warmup 1 --delay-ms 30000 --out <dir>
```

Run `wrangler tail sigmascout-state-probe --format json` alongside it, then `analyze-arms.mjs`. For
the fresh/reused split, parse `isolateRequest=N` from each tail event's logs. Arms come from
`rpSkip=` (see `docs/worker-operations.md`, "Pre-event probe"). **The probe is LEFT DEPLOYED** at
`28051f5c`.

## TICK SPLITTING — what the platform actually allows (researched 2026-09-17, official docs)

Jacob chose to investigate tick splitting (2026-09-17) after per-event team artifacts priced out:
that shape needs ~370k Class-A PUTs per republish (2.7 republishes/month against the 1M free tier,
from 9.2) **and** a tick of 158 subrequests against ~46 usable, so it cannot run at all.

**Ruled out — service bindings share the caller's CPU budget.** Cloudflare's pricing page, on a
Worker A → Worker B service-binding call: billed as "one request … [and] the total amount of CPU
time used across both Worker A and Worker B", and both "run on the same thread of the same
Cloudflare server" (`/workers/platform/pricing/`, `/workers/runtime-apis/bindings/service-bindings/`).
The call also counts against the caller's subrequest limit. Do not build fan-out on service bindings.

**Viable on the free plan:**

| Mechanism | Free-plan budget | Limits that bind |
|---|---|---|
| **Queues** consumer | separate invocation; free-plan CPU value not published, structurally the 10 ms limit | 10,000 operations/day, an operation counted **per 64 KB written, read or deleted** — so messages must be small pointers, never payloads; 24 h non-configurable retention (`/queues/platform/{limits,pricing}/`) |
| **Workflows** | **10 ms of compute per step, published for Workers Free** — the only mechanism with a documented per-unit free figure | 1,024 steps, 100 concurrent instances, 100,000 executions/day (`/workflows/reference/limits/`) |
| More **Cron Triggers** | each trigger is its own invocation with its own 10 ms | 5 per account; 1-minute granularity with no sub-minute offset syntax |
| Durable Object alarms | separate invocation; free-plan CPU value not published | free tier since 2025-04-07, SQLite-backed only; 100k requests/day, 100k rows written/day, and each `setAlarm()` bills as a row written |

**Two findings that change how the existing numbers should be read:**

1. **The budget's flexibility is credit-based, and a sustained mean earns no credit.** The metrics page
   is the only official description of the mechanism: higher quantiles can exceed the limit without
   errors "because of a mechanism in the Workers runtime that allows **rollover CPU time for requests
   below the CPU limit**" (`/workers/observability/metrics-and-analytics/`). Credit is *earned* by
   invocations under 10 ms. Idle ticks (~1 ms × 1,440/day) bank it; an event weekend at a 17.5 ms mean
   spends it and earns none. This is consistent with the 2026-08-29 production observation (`ok` at
   `cpuTime:38`, then killed pinned at `10` sixty seconds later) and argues the current design is
   genuinely over budget rather than borderline.
2. **Split across invocations of the SAME Worker, never across more Workers.** Isolate reuse is
   undocumented by design, but more Workers means more isolate populations each invoked less often,
   so each is more likely to be cold — and a fresh isolate measured 40.8 ms against 17.5 ms reused.

**An ambiguity worth money, still untested.** The limits page carries two subrequest rows — 50 per
invocation, and 1,000 "to internal services" — and never defines "internal services", with no
footnote. If R2/D1/KV count against 1,000, the tick's whole subrequest-deferral machinery (and the
D1-batching rationale) is unnecessary. Testable in minutes: issue more than 50 R2 reads in one probe
invocation and see whether it throws.

**Not confirmable from official docs** (treat as unknown, not as fact): the free-plan CPU number for a
Queue consumer or a DO request; whether `ctx.waitUntil` CPU counts toward the invocation limit
(framing implies yes); whether a queue `send()` counts as a subrequest (definition implies yes);
whether module-init CPU counts toward the 10 ms handler budget; whether cron and queue-consumer
invocations count toward the free 100,000 requests/day.

**Next, per Jacob (2026-09-17): measure a chunk before building anything.** The team-artifact half is
7.6 ms of work, but a split invocation pays its own start-up, and the arm that proves it is a
teams-only chunk that reads played rows from the event artifact instead of re-folding. If a chunk
measures ~8 ms it fits; if it measures 15 ms, splitting buys nothing.

## RE-MEASURED AFTER F2 — Phase B is 5.4x cheaper, and team artifacts are what is left (2026-09-17, quick task 260915-t7o)

**Headline: dropping the duplicate read-side validation took Phase B from +64.0 ms to +11.8 ms and
stopped the platform terminating the isolate. A realistic tick is now ~17.5 ms mean on reused
isolates, still consistently over the 10 ms budget, and 64% of what remains is the twelve
team-season artifacts.**

Probe `7ed31f95` from `35983549`, live Worker `89fbe44f`. Same pinned roster and event as the
2026-09-15 runs, so the measured work is comparable; `teamValidate`/`eventValidate` changed meaning
across F2 (they now gate the structural guard), which is the point of that pair.

### Cold pass (30 s spacing, 4 arms, 20 measured rounds each, reused-isolate stratum)

| Arm | mean | p50 | % over 10 ms |
|---|---|---|---|
| `all` — Phase A only | **5.7 ms** | 5 | **0%** |
| `allPhaseB` — the realistic full tick | **17.5 ms** | 16 | **100%** |
| `pbTeams0` — same tick, no team artifacts | **9.9 ms** | 9 | 31% |
| `pbSkipTeamValidate` | 16.5 ms | 15 | 100% |

| Difference | Now | 2026-09-15 |
|---|---|---|
| **phaseB** | **11.8 ± 1.8 ms** | 64.0 ± 9.3 ms |
| **teamHalf** | **7.6 ± 1.8 ms (64% of Phase B)** | ~80% of Phase B |
| teamValidate | 1.0 ± 2.1 ms, unresolved | the largest component of all |

Fresh isolates still cost what they always did: `allPhaseB` averages 40.8 ms there (n=10). Nothing
inside the tick addresses that.

### Warm pass (200 ms spacing, 13 arms, 40 rounds) — the component detail

| Component | Now | Before F2 |
|---|---|---|
| whole Phase B | **6.8 ± 0.4 ms** | ~23 ms |
| team half (×12) | **4.4 ± 0.4 ms** | ~18.5 ms |
| — team read guard ×12 | 0.4 ± 0.4, unresolved | ~14.6 ms (was a full zod parse) |
| — team merge + stringify ×12 | 2.6 ± 0.5 | |
| — team stringify alone ×12 | 2.0 ± 0.4 | |
| event half | **1.9 ± 0.4 ms** | ~7.2 ms |
| — event read guard | 0.7 ± 0.4, unresolved | ~5.1 ms (was a full zod parse) |
| — event merge + stringify | 1.3 ± 0.4 | |

**`exceededCpu` responses went from 28 of 40 per Phase B arm to ZERO.** The platform was terminating
the isolate on the warm pass before F2; it no longer does at that pacing.

### What this settles

1. **F2 did what the measurement said it would.** Validation is no longer a resolvable component on
   either side.
2. **The tick still does not fit.** 17.5 ms mean, p50 16, on 100% of reused-isolate requests, against
   a 10 ms budget whose enforcement turns on *consistency*. Better than ~74 ms, not yet safe.
3. **Team-season artifacts are the whole remaining lever inside Phase B**: 7.6 of 11.8 ms, and with
   them off the tick measures 9.9 ms mean / p50 9 — roughly fitting. It is now merge + stringify of
   whole-season artifacts, not validation, so option (a) (per-event or append-shaped team artifacts)
   is the only structural reduction left. The earlier caveat is resolved: the team half still
   dominates after F2.
4. **Fresh isolates (~41 ms) remain untouched and untouchable from inside the tick.**

## RE-MEASURED AFTER BROWSER PRICING — Phase A is fixed, Phase B is the new blocker (2026-09-15, quick task 260915-qgf)

**Headline: browser pricing did what it was chosen to do — Phase A's RP cost is no longer
resolvable — and the first-ever Phase B measurement shows the artifact merge costs ~64 ms, so the
tick is further over budget than when this todo opened.**

### Provenance

- Probe `51127dd1` re-mirrored to the tick at `7385bad6`; live Worker `43ed9472` from `61f79e0a`.
  The probe's Phase B calls the tick's own `artifactMerge.ts`, not a copy.
- 9 arms, 30 s spacing, 13 measured rounds each (126 requests), interleaved round-robin, zero non-ok
  outcomes, all invariants PASS.
- **The roster is pinned, not discovered** (`measure/arms.mjs` `WARM_ROSTER`): discovery picks up
  keys with no RP or Sigma beliefs and the demo pseudo-team, which suppressed every pmf
  (`rpPmfsProduced: 0`) and 404'd the Phase B team fetch. With the pinned roster: resumed 21,
  bandsProduced 4, rpPmfsProduced 2.

### Phase A: before and after, reused-isolate stratum

| Arm | 2026-09-14 mean | 2026-09-15 mean |
|---|---|---|
| all RP on | 16.2 ms (p50 14) | **9.6 ms (p50 8), 17% over 10 ms** |
| RP off (`none`) | 6.7 ms (p50 6) | 6.8 ms (p50 6) |
| RP total (`all − none`) | **9.5 ± 2.1 ms, resolved** | **2.8 ± 1.8 ms, UNRESOLVED** |
| upcoming-loop RP | 7.2 ± 2.1 ms, resolved | **retired — the loop no longer exists** |
| formula | 6.0 ± 2.5 ms, resolved | 2.1 ± 1.8 ms, unresolved |

Every RP component is now below resolution at n≈12. Counters confirm the shape change:
`rpPmfsProduced` 34 → 2 and `bandsProduced` 124 → 4, both folded-only. Absolute counters are NOT
comparable across the two dates; the arm differences and the method are.

### Phase B: measured for the first time, and it dominates

| Difference | Reused mean | Resolved? |
|---|---|---|
| **phaseB** (`allPhaseB − all`) | **+64.0 ± 9.3 ms** | resolved |
| **phaseBNoRp** (`nonePhaseB − none`) | **+52.3 ± 7.5 ms** | resolved |

Absolute: `allPhaseB` reused mean **73.6 ms**, p50 63, **100% of requests over 10 ms**. With RP fully
off it is still 59.0 ms.

What that arm actually did, per request: fetched a real 106,024 B event artifact and a 32,386 B team
artifact; `JSON.parse` + `LiveEventArtifactSchema.parse`; synthesized and spliced a 22-row state
block; merged 97 played rows, 60 upcoming rows and 2 newly folded matches; stringified 145,958 B;
then parsed, merged and stringified 12 team artifacts (403,240 B total).

**The cost is parse/validate/stringify of whole artifacts, not the fold.** R2's round trips are I/O
and never entered `cpuTime`; only the JSON and zod work did. A real tick does the same work on 12
*different* team artifacts, so this is a floor, not a worst case.

### What this settles

1. **Browser pricing was the right fix for the term it targeted.** Phase A's dominant cost is gone,
   and RP is no longer separable from noise.
2. **Phase A alone would now fit**, on the reused stratum: 9.6 ms mean, p50 8, 17% over — a spiky
   tick, not a consistently-over-budget one, which is the distinction the budget's enforcement rule
   turns on.
3. **The whole tick does not fit, by a wide margin.** ~70 ms on every request is the 2026-08-28
   condition, worse than the 13 ms that opened this todo. It was never visible before because every
   measurement to date was Phase A only.
4. **Fresh isolates remain their own term** (n too low here for a number; 2026-09-14 measured ~18 ms
   with RP off). Nothing inside the tick fixes that.

### Directions worth pricing for Phase B (none chosen)

- **Stop re-validating what we wrote.** `LiveEventArtifactSchema.parse` on a 106 KB artifact runs
  every tick against an object this Worker itself wrote a minute earlier. A cheap shape check on the
  read path, with full validation kept at publish time, is the obvious first probe.
- **Stop rewriting whole team-season artifacts.** 12 teams × (parse 32 KB + stringify 33 KB) every
  tick, to append one match row each. A per-event or append-shaped artifact would cut it.
- **Split Phase B across invocations**, as the tick-splitting direction below describes — but note
  it is now Phase B, not Phase A, that needs the valve.
- Re-measure with `phaseB=1` after any change; the arm exists.

### The pre-season gate stays closed

Not a decision this measurement can make on its own, and not the orchestrator's to make: presented
to Jacob 2026-09-15 with these numbers.

## PHASE B SPLIT — where the 64 ms goes (2026-09-15, quick task 260915-t7o)

The +64.0 ± 9.3 ms lump the qgf re-measure left is now split into components. Two fixes were named
above without numbers behind them; both were gated on thresholds registered **before** the
measurement, and one of them came back below its bar and was **not built**. That is a result, not a
gap.

### Provenance

`apps/worker/src/stateProbe.ts` as of commit `0890ac61`, which added a `phaseBSkip` arm gating seven
Phase B components independently (`eventParse`, `eventValidate`, `eventMerge`, `eventStringify`,
`teamValidate`, `teamMerge`, `teamStringify`) plus a `phaseBUpcoming=scheduled` arm that reshapes the
fetched artifact's `upcoming` rows to the schedule-only shape the Worker itself writes. Rig:
`.planning/quick/260915-t7o-cut-the-worker-artifact-merge-cpu-cost/measure/`, 13 arms with the pinned
`WARM_ROSTER` (discovery picks belief-less teams and the demo pseudo-team, which suppresses every pmf
and 404s the Phase B team fetch — the roster is pinned for that reason).

**Two passes were run, and only one of them resolved anything.**

| Pass | Spacing | Rounds | Verdict |
|---|---|---|---|
| Cold | 30 s | 12 | **Too noisy to resolve anything.** Several *skip* arms came out MORE expensive than the full arm, and both threshold quantities carried ±14 ms. Nothing was read off it. |
| Warm | 200 ms | 40 | The pass that resolved F1 and F2. Understates ABSOLUTE cost (see the floors below), but the component ORDERING is consistent with the cold pass — the team half dominates in both. |

Every number below is from the warm pass, `ok` samples only.

### The measured split

Whole Phase B ≈ **23 ms** on this pass, against the 64.0 ms the 30 s-spaced qgf run measured. The two
are not the same quantity: see the floors.

| Component | Mean | Share of Phase B |
|---|---|---|
| **Team half** (12 artifacts) | **~18.5 ms** | **~80%** |
| — team validation (`TeamSeasonArtifactSchema.parse` ×12) | **~14.6 ms** | **~63%** — the single largest component of the whole of Phase B |
| — team merge (`mergeTeamSeasonArtifact` ×12) | ~6.6 ms | |
| — team stringify (×12) | ~5.2 ms | |
| **Event half** (1 × ~106 KB artifact) | **~7.2 ms** | ~31% |
| — event validation (`LiveEventArtifactSchema.parse`) | ~5.1 ms | |
| — event merge (incl. the `state`-block splice) | ~3.5 ms | |
| — event stringify | ~3.7 ms | |

**The two threshold quantities, with SEs:**

| Quantity | Measured | Resolved? | Pre-registered bar | Verdict |
|---|---|---|---|---|
| `eventValidateScheduledShape + teamValidate` (F2) | **19.5 ± 2.6 ms** | **yes** (mean > 2×SE) | ≥ 8 ms **and** resolved | **BUILD** |
| `unionOrderPenalty` (F1) | **−0.3 ± 2.6 ms** | **no** | ≥ 3 ms **and** resolved | **DO NOT BUILD** |

Those two are the only quantities an SE was computed for. **The per-component means in the table above
carry no SE** and must not be quoted as if they did.

### The components do not sum to their halves — read the residuals as a warning, not as numbers

The event components sum to ~12.3 ms against a ~7.2 ms measured event half; the team components sum to
~26.4 ms against a ~18.5 ms measured team half. Both over-account. The rig's derived residuals
(`eventJsonParse`, `teamJsonParse`) are defined as *half minus the named components*, so both come out
**negative**, which is not a cost and cannot be reported as one.

That is the honest reading: **the ablation arms are not cleanly additive on this pass**, so the derived
residuals are discarded rather than published. The measured pairwise differences stand; the arithmetic
built on top of them does not. The most likely causes are the two floors below — the `exceededCpu`
truncation in particular removes exactly the expensive tail of the *full* arm while removing less of
each cheaper skip arm, which biases every `full − skip` difference upward and the halves downward.

### `unionOrderPenalty` and what it says about the live vs published row shape

The hypothesis was specific and checkable: `LiveEventArtifactSchema.upcoming` is
`z.union([EventUpcomingMatchSchema, EventScheduledMatchSchema])`, the two options are mutually
exclusive, and the Worker reads back its OWN schedule-only writes on every tick after the first — so
every live upcoming row was failing an 8-refine, ~24-field schema before the strict one accepted it.
`phaseBUpcoming=scheduled` exists to price exactly that, and it priced it at **−0.3 ± 2.6 ms**.

Read plainly: **the union's order costs nothing measurable.** Whatever a failed first option costs
inside zod, it is below what this instrument can see, which is precisely why the ≥ 3 ms bar was set
where it was — below it the fix could never be *shown* to have worked. F1 is recorded here as a
measured negative and is not to be re-proposed without a better instrument.

### What was built, and what was not

- **F1 — reorder the `upcoming` union: NOT BUILT.** Below its pre-registered bar and unresolved.
  No line of `pageArtifacts.ts` changed.
- **F2 — narrow the read path: BUILT** (commit `eb0f6b0d`). `readExistingEvent`/`readExistingTeam` now
  call `apps/worker/src/artifactShapeCheck.ts`'s O(1) structural guards instead of
  `LiveEventArtifactSchema.parse`/`TeamSeasonArtifactSchema.parse`.
- **F3 — reshape the team artifacts: NOT BUILT by this plan, by design**, whatever the number: it
  changes the published shape and the web's read path, and (b)/(d) below would change the per-tick
  subrequest count the suite pins at 64. The written assessment is in this section instead.

**What F2 gives up, and where it is recovered.** The guard asserts only what the merges dereference:
object-ness, the `PagePreambleSchema` `schemaVersion` rule, and the arrays and nested objects the
merges index into without an optional chain. It does **not** walk `matches`/`upcoming`/`teams` rows —
that O(1) property is the whole point. So a bad ROW inside an otherwise well-shaped artifact now
survives the read where a zod parse would have rejected it.

That is recovered in three places, none of them optional:

1. **`writeArtifactObject`'s `schema.parse` is untouched** and still runs before every put and before
   `budget.tryConsume`. Every object in R2 was schema-validated by whichever writer wrote it — which is
   also why the read-side parse was a *second* validation of already-validated bytes, costing the tick
   ~19.5 ms for it. Nothing malformed can reach a browser, and a validation failure still costs zero
   subrequests.
2. **`writeArtifactWithBootstrapRetry`** (`scheduled.ts`) restores the degrade-to-bootstrap behaviour
   the read parse used to provide. This is the one protection that genuinely needed recovering:
   `TeamSeasonArtifactSchema` has no `.catch` anywhere in it, so a corrupt published team artifact
   would otherwise fail the write, be swallowed by `runPhaseBAndReport`'s blanket catch, and stop that
   team publishing **permanently** — the same object read back and failing identically every tick. The
   retry re-runs the merge with `existing: undefined` and publishes that. It is deliberately NOT taken
   when the budget was already consumed (the put itself failed — retrying would spend a second
   subrequest on one artifact and break the 64) or on `ArtifactSecretLeakError`.
3. **A malformed `state` block drops the BLOCK, not the artifact**, mirroring
   `EventArtifactSchema.state`'s own `.catch(undefined)`. Rejecting instead would have quietly upgraded
   a one-key problem into a full history loss on every tick — a behaviour the read-side parse never
   had.

Published bytes are unchanged for every valid input. The guard lets unknown top-level keys through
where zod stripped them, so the two merge outputs can differ by exactly such a key; what
`writeArtifactObject` serializes cannot, because it stringifies the output of the same
`schema.parse`. `apps/worker/test/artifactShapeCheck.test.ts` pins
`JSON.stringify(Schema.parse(merged))` equal across both read paths, key order included.

### The probe follows the tick, so two arms changed meaning

`eventValidate` and `teamValidate` still gate the read-path validation step, but since F2 that step is
the structural guard, not the schema parse — the probe calls the tick's own code, never a superseded
copy of it. **A before/after of those two arms across `eb0f6b0d` is therefore a measurement of F2
itself, not two measurements of the same work.** `measure/arms.mjs` and the `docs/worker-operations.md`
runbook both say so at each affected difference. Within a single deployed probe version both arms
remain apples-to-apples, as always. `eventValidateScheduledShape` is now expected to collapse toward
zero and to stop differing from `eventValidate`: the guard does not look at upcoming rows at all.

### TEAM-ARTIFACT ASSESSMENT — the four options on the table

**The argument that motivated this assessment has been partly spent by F2, and that has to be said
first.** The case for reshaping the team artifacts was the measured share: the team half is ~18.5 ms of
a ~23 ms Phase B, about 80%. But **~14.6 ms of that 18.5 ms was the team zod validation, and F2 just
removed it.** The remaining team work is the merge (~6.6 ms) and the stringify (~5.2 ms) — still the
largest remaining block, but no longer an 80% share of anything, and the non-additivity above means the
post-F2 team half cannot be computed by subtraction. **It has to be re-measured (M3).**

| Option | What it removes | What it costs | Verdict |
|---|---|---|---|
| **(a) Append-shaped or per-event team artifacts** | The whole-season parse *and* stringify — the only option that removes both | Changes the **published shape** and the web's read path for team pages and the team-page metric-history plot; needs a republish of every team artifact and a version bump | **Recommended — but not started until M3** |
| **(b) Defer team-artifact rewrites to a slower cadence** | Some fraction of the team half, proportionally | A tick only runs when a match folds — roughly every 7 minutes — so deferring by **less than that defers nothing**, and deferring by more means a team page shows a played match its own event page already shows. Changes the per-tick subrequest count `scheduled.rp.test.ts` pins at 64 | Rejected: buys freshness-for-CPU at a bad rate |
| **(c) Narrow what the tick rewrites** | — | A touched team **by definition just played**, so there is no unchanged team to skip. F2 was the only narrowing available without a shape change | **Exhausted.** Nothing left here |
| **(d) Split Phase B across invocations** | Nothing — it redistributes cost, it does not reduce it | The valve this todo already names, and orthogonal to the merge cost. Changes the per-tick subrequest count pinned at 64 | Keep as the fallback valve, not as the fix |

**Recommendation: (a), conditional on M3, and scoped as its own quick-task sequence — do not start it
here.** The reasoning has two halves and both matter:

- (c) is exhausted and (b)/(d) are not drop-ins — both change the per-tick subrequest count, which is
  why neither can be slipped in behind a pinned 64. So if the team half still dominates after F2, (a)
  is the only option that actually removes work.
- But the number that justified (a) was ~80%, and ~63 of those ~80 points were the parse F2 deleted. It
  would be dishonest to start a published-shape change on a share that no longer exists. **M3 decides
  whether (a) is still worth its cost.**

**What (a) costs the visitor:** not freshness. Per-event or append-shaped team artifacts are still
written on the same tick, so a team page is exactly as current as it is today. The cost is **request
count and payload shape** — a season view of a team that competed at four events fetches four smaller
files instead of one large one, and the metric-history plot needs either its own file or a season-level
rollup, since it is a whole-season series by construction. That is a real web change, not a Worker-only
one, and it is the reason (a) is its own quick-task sequence rather than a follow-up commit here.

By contrast **(b) is the option that costs freshness directly**, and (d) costs freshness on whichever
half of Phase B loses the coin flip in a given invocation.

### What this does NOT say

Every floor the qgf measurement documented still applies, unchanged, plus two of this pass's own:

1. **The `state` block is synthesized.** Out of season no published event carries one (blocks attach
   only to events with a schedule current within 7 days), so the probe builds one from the rows it
   read. It is sized by `teamCount`, so it under-prices a 42-team regional.
2. **The N team merges parse ONE team's fetched bytes N times.** That is N parses of a realistic
   artifact, not N different teams'.
3. **One event.** A regional weekend runs several concurrently, and the CPU budget has no deferral
   valve the way the subrequest budget does.
4. **Phase A + Phase B only** — no TBA poll, no KV manifest read, no global rebuild.
5. **200 ms spacing is far warmer than a real tick's cadence.** A real tick runs at most once a minute.
   The absolute numbers here are a floor; the 30 s-spaced qgf run's 64.0 ms is closer to the real
   shape, and this pass's ~23 ms whole-Phase-B is not a refutation of it.
6. **28 of 40 requests per Phase B arm returned `exceededCpu`.** The platform terminated the isolate
   for sustained over-budget work, observed directly. The analyzer excludes non-`ok` samples, so every
   mean above is **biased toward the cheaper tail** — and unevenly across arms, which is the most
   likely source of the non-additivity documented above.

### The probe is LEFT DEPLOYED

Deliberately. It is what prices F3 next, and it is what M3 re-measures with. **It must be redeployed at
commit `eb0f6b0d` (or later) before M3**, because F2 changed the code the `eventValidate`/`teamValidate`
arms gate — measuring the new tick with the old probe would price a read path production no longer
runs. Record the redeployed version here when M3 runs. Delete the probe with
`wrangler delete --config apps/worker/wrangler.probe.toml` when this todo closes, not before.

## DIRECTION CHOSEN — browser pricing of upcoming matches (Jacob, 2026-09-15)

Upcoming SPR matches are priced in the browser from published state. Neither the Worker nor the
offline publisher prices them. Every upcoming row stays current, and the tick loses its dominant
resolved cost (upcoming-loop RP, 7.2 ± 2.1 ms on reused isolates; see COMPONENT PROFILE).

**Decisions (Jacob, 2026-09-15):**
- **Unseen teams follow the offline rule.** If any roster team has no Sigma belief, the match shows
  no band and no RP odds. The Worker's price-from-prior behavior goes away with its upcoming loop.
- **Team pages price upcoming matches too.** When a team has upcoming matches at an event, the team
  page fetches that event's file and prices from its `state` block. This also fixes stale and
  duplicated unplayed rows on team artifacts: `mergeTeamSeasonArtifact` only appends.
- **Polling is in scope.** Event pages with upcoming matches refetch about every 60 s; finished
  events never poll. This closes DATA-04 gap F.3.
- **Container: a series of quick tasks**, not a phase.

**Design:**
- **State location.** Embed a `state` block in the event artifact whenever it has upcoming matches:
  the spr league row plus each roster team's row, carrying `sigmascoutSigma`, `sigmascoutRp`, the
  Sigma population and the RP mean shift. Phase data is not needed. Drop the block when the last
  match folds. A separate file was rejected: a live event file changes every tick anyway, and the
  Worker already reads and writes it, so embedding adds zero subrequests while a separate file
  adds 2 per event per tick.
- **Measured size.** +9–12 KB on the wire for a 42-team regional, +16–21 KB for a 75-team division
  (about +65%). Finished events carry nothing.
- **Worker.** Keeps predict-before-update, played-row RP and the fold, then replaces touched teams'
  entries in the block from the rows it just wrote. The upcoming loop is deleted, and with it the
  partial-roster mispricing (`scheduled.ts:1106` → `spr.ts:468`).
- **Browser.** A pricing module runs the shared code: `spr.predict`, the Sigma band
  (`sigmaMatchBandVariance`), `RpMomentsAccumulator.momentsFor` → `RpMeanShiftAccumulator.apply`
  (`rosterIsFullyWarm`) → `analyticRpPmf`, then `rounding.ts`. It loads as a lazy chunk, only on
  pages with upcoming matches.
- **Spec reading (REBUILD_SPEC.md:20-22).** Ratings stay precomputed; the browser only evaluates the
  forecast for the remaining schedule. This is not the season recomputation the spec forbids.

**Quick-task sequence (each step leaves the live site working):**
1. **Pricer and parity test, no behavior change.**
   - Split `stateSnapshot.ts`'s `node:fs` seed-SQL emitter out of the browser path.
   - Load RP rule modules per season, not all ten.
   - Build the pricing module from a `state` block.
   - Add a parity test: the pricer on published state equals `SigmaScoutLayer.enrichUpcoming` on
     every upcoming field (`pRedWin`, scores, own variance, band, RP pmfs, bonus pmfs and marginals,
     `matchOutcomePmf`), including the unseen-team rule.
   - Precedent: today's only upcoming parity test covers RP pmfs alone
     (`scheduled.rp.test.ts:965`).
2. **Publish the `state` block.**
   - Make it optional in `EventArtifactSchema`.
   - The publisher writes it; the Worker maintains it and deletes its upcoming loop.
   - The Worker's upcoming rows become schedule-only, keeping `sortTime` (fixes the live row-shape
     gap). Offline rows keep their priced fields for now.
   - One republish and one Worker deploy. No D1 re-seed, since the row shape is unchanged.
   - Nothing is live behind the pre-season gate, so no visitor sees the Worker's unpriced rows.
3. **Web switch.**
   - Event, match and simulation pages price from `state`, falling back to published fields.
   - Team pages fetch the event file for upcoming matches and de-duplicate played/unplayed rows.
   - Add polling (`refetchInterval` while `upcoming` is non-empty).
   **Status (2026-09-15): steps 1-3 are SHIPPED (260915-4p9, 260915-isq, 260915-m4j).** The web
   is deployed at `05408056`, generation `03a5cc42` is republished, SPR is seeded in D1, Worker
   `6ea54a8f` is deployed, and live e2e passed 170/170. Blocks attach only to events with a current
   schedule (`eventScheduleIsCurrent`, 7 days). Still required before the gate lifts:
   - step 4: re-mirror the probe and re-measure cold `cpuTime`;
   - `live-merge-drops-event-identity-fields`.
4. **Measure and clean up.**
   - Re-mirror the probe to the new tick and re-measure cold `cpuTime`.
   - Strip priced fields from offline upcoming rows at the next republish that happens anyway.
   - The pre-season gate also needs the remaining DATA-04 row-parity items before it can lift.

## Horizon repricing (proposed 2026-09-13) — REJECTED by Jacob 2026-09-14

> Jacob, 2026-09-14: "I don't like horizon repricing." He wants every upcoming row on the site kept
> correct and current. Alternatives under consideration are pricing upcoming matches in the browser
> from published state, cheapening the cold path with output kept identical (profile above), and
> splitting the tick across invocations. The section below is kept as the record of what was
> proposed.

### A correctness defect found while pricing the directions, and it changes the problem

**The upcoming loop prices every still-upcoming match from state that holds only this tick's touched
teams.** `processEvent` loads D1 rows via `selectionsFor(algorithmId, eventKey, realTouchedTeams)`
(`apps/worker/src/scheduled.ts:1106`) — the ~12 teams in 2 newly-folded matches, at a ~40-team event —
then runs `algorithm.predict(state, match)` over the WHOLE upcoming schedule (`:1296`). SPR's
`viewOfMap` substitutes `teams.get(k) ?? freshTeam(p)` (`packages/core/algorithms/spr.ts:468`), so any
unloaded team is priced as a brand-new team, silently. `mergeEventArtifact` then rebuilds every upcoming
row from those predictions (`scheduled.ts:672`), overwriting the published ones. Nearly every upcoming
row would carry a wrong `pRedWin` and predicted scores, a band built from prior sigmas, and no RP pmf
(the partial-roster gate strips it). `scheduled.rp.test.ts:677` pins the RP half of that gate; nothing
pins the prediction half. Never observed in production only because this todo's gate has kept every
live window closed.

**Consequence for the measurement:** the probe cycles rosters through `teamCount=21` loaded teams, so
every synthetic roster is fully resumed — it prices the tick a *correct* implementation would run. The
current code would look cheaper on a real event only because it is skipping work it must do. Any CPU fix
has to fix this too, and fixing it naively (load the whole event roster) makes the tick more expensive.

### Why cheapening `analyticRpPmf` was not chosen

Node micro-benchmark, 2026 rule module, 43 calls (the probe's `rpPmfsProduced`), desktop:
**4.6 µs/call warm**, **17 µs/call with every JIT tier disabled** (`--no-opt --no-sparkplug --no-maglev`),
**1.7 ms for the first 43 cold calls**. The probe's ablation implies ~160 µs per pmf on Workers. The math
is cheap; the Workers figure is cold-isolate/allocation/GC overhead, so optimizing the formula is an
uncertain lever. The ablation also shows `rp=0` at 60 upcoming (6 ms p50) equals 0 upcoming (6 ms p50):
predict + band over the upcoming loop is near-free, and the whole upcoming increment is RP.

### The chosen design, as decided (details for the phase to settle)

- **Load** touched teams ∪ the rosters of the next K upcoming matches, in the SAME single
  `readScopedState` query — zero added subrequests.
- **Reprice only** those K matches, each with a fully-loaded roster. **Preserve every other upcoming row
  verbatim** from the existing artifact rather than overwriting it — the prediction-side counterpart of
  the RP partial-roster gate's "absent rather than wrong".
- Cost becomes O(K), independent of schedule length. Rows beyond the horizon lag until they enter it;
  the live/offline parity test needs that as a STATED exception, not a loosened assertion.
- **Pick K by measurement, not reasoning.** The deployed probe (`c0405758`) predates the 2026-09-13
  Swing/VPR teardown (`260913-it4`, `260913-g66`), so re-mirror it to the post-teardown tick and to the
  horizon shape before pricing K.

### Constraints to verify during planning

- **D1 bound-parameter cap.** `readScopedState` binds `algorithmId`, each scope kind, and every scope key
  in one statement, with no cap handling (`apps/worker/src/stateStore.ts:99-127`). D1 limits bound
  parameters per query (believed 100 — confirm against Cloudflare's limits page). Touched + 6K distinct
  keys bounds K; a whole-roster load at a 75-team division would not fit.
- **Elimination matches** whose rosters TBA has not filled yet — decide whether they count toward K.
- **Ticks only run when matches fold** (`newlyFolded.length === 0` returns early), so "next K" advances
  one played match at a time; confirm that is enough freshness for the rank simulation's inputs.

## Directions worth pricing (horizon repricing chosen 2026-09-13 — see above)

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
