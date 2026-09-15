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
