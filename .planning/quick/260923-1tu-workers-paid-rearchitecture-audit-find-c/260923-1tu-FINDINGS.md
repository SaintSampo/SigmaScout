# Workers Paid re-architecture audit

**Quick task 260923-1tu, 2026-09-23.** Adversarial read of the whole system against the Workers
Paid plan bought 2026-09-22. Goals, in Jacob's words: never exceed the new limits, re-architect to
grow inside them, move browser compute back to Cloudflare where that is the right call, delete code,
and stop managing state across several databases.

Every number below was either fetched from developers.cloudflare.com on 2026-09-23 or counted with
`wc -l` at HEAD `fd5596b7`. Nothing was edited.

---

## 1. What actually changed, and what did not

**Hard limits (an invocation is killed):**

| Limit | Free | Paid now |
|---|---:|---:|
| CPU per cron tick (schedule faster than hourly) | 10 ms | **30 s** (the 15 min figure applies only to hourly-or-slower crons) |
| Subrequests per invocation | 50 | 10,000 |
| D1 queries per invocation | 50 | 1,000 |
| KV operations per invocation | 1,000 | 1,000 |
| Memory | 128 MB | 128 MB |

**Included monthly quotas (overage is billed, never terminated):**

| Resource | Included on Paid | SigmaScout today |
|---|---:|---|
| Worker requests | 10M | ~43k (one cron tick a minute) |
| Worker CPU | 30M CPU-ms | idle ticks ~1 ms; a live tick 13 to 30 ms |
| D1 rows written | 50M | one seed pass ~75k; live folding trivial |
| D1 rows read | 25B | trivial |
| KV writes | 1M | **0, ever** |
| **R2 Class A (writes)** | **1M, unchanged by the plan** | **~109k per rebaseline** |
| **R2 storage** | **10 GB, unchanged** | **4.3 GB** |
| R2 Class B (reads) | 10M, unchanged | every page view is an R2 read (no edge cache) |

The single most important finding: **the plan changed nothing about R2, and R2 is where the real
ceilings are.** Every "we can now do X every tick" idea below is priced against R2 Class A writes,
not CPU. The 30M CPU-ms pool works out to about 700 ms per tick averaged across the month, and
idle ticks spend almost none of it, so a live tick has more than a second of comfortable budget.

---

## 2. Critical changes, ranked

### C1. Reverse browser pricing: the Worker prices upcoming matches again, the state block goes

The event artifact currently carries a `state` block: a verbatim copy of the D1 rows for every
roster team plus the league row, about 36 KB per live event, so the browser can run SPR's
predictor itself. The source comment is explicit that this exists for one reason:
`packages/harness/pageArtifacts.ts:1376` says the tick's CPU cost "is the whole reason browser
pricing exists." That reason is gone.

This is also the clearest case of state living in two places: D1 rows copied into R2 on every
publish and every tick, with a consistency contract (publish and seed from the same run, splice
rules, `absentKeys`, two tick warnings, `snapshotShapeVersion` agreement) that only exists to keep
the copy honest.

After the reversal the tick prices upcoming rows in Phase B from the state it already holds in
memory after Phase A, exactly as it did before 260915-isq. The numbers do not change: the browser
path and the offline path are already proven byte-equal by `eventStatePricing.parity.test.ts` and
the level-1 digest gate, and the Worker would call the same function.

Deletable: `apps/web/src/lib/eventPricing.ts` (177), `eventPricing.lazy.ts` (62), the read half of
`packages/harness/eventStatePricing.ts` (471), `EventStateBlockSchema` and the strict
`EventScheduledMatchSchema`, the block splice and completion paths in `scheduled.ts` and
`artifactMerge.ts`, `scripts/localPricingFixture.ts`, and six test files (~1,700 lines). About
**2,900 lines**, plus 36 KB off every live event page, plus the 11.7 kB lazy chunk and the
19.2 kB zod chunk it forced out of the initial bundle. Page load is the top UX priority; this is
the largest wire-size win on the list.

### C2. Delete the state-probe Worker

`apps/worker/src/stateProbe.ts` (3,562 lines), `test/stateProbe.test.ts` (3,443), and
`wrangler.probe.toml` are a CPU-attribution instrument: ablation arms (`rp`, `rpSkip`, `phaseB`,
`phaseBSkip`, `chunk`) that measure milliseconds against a 10 ms budget. That is **34% of the
Worker's source plus tests** for a limit that no longer exists, and the standing rule since the
plan change is that no CPU-ms bar is ever proposed again.

Its second job, proving the deployed bundle can deserialize live D1 rows, is already covered on
the live path by `STATE_SNAPSHOT_SHAPE_VERSION` and the generation-mismatch suspension, and by
the seed-first-deploy-second runbook order.

Deleting it also unblocks two couplings it created: `mergeTeamSeasonArtifact` is kept alive only
as the probe's baseline arm, and `artifactMerge.ts` was split out of `scheduled.ts` only to keep
write helpers out of the probe's import graph. About **7,000 lines**.

### C3. Delete the subrequest deferral machinery, the probe cap, and the rebuild interval

Keep the rotation (`rotate`, `sortEventKeys`, the offset): no-starvation is a property of the
rotation, and a 30 s CPU cap is still a per-tick cap. Delete everything that exists to stay under
50 subrequests:

- `SUBREQUEST_RESERVE`, `usableCap`, the `consume` versus `tryConsume` split, `WriteArtifactResult.deferred`, `ArtifactReadBudgetExhaustedError`
- `estimateEventSubrequestCost`, the all-or-nothing `status: "deferred"` gate, `eventsDeferred`, the three fixed-cost constants, the `RunTickDeps.subrequestCap/subrequestReserve` overrides
- the three opportunistic `budget.remaining > stillOwed` guards (etag-only cursor write, state-block read, live-roster write)
- `MAX_PROBES_PER_TICK` and `PROBE_ROTATION_PERIOD_MS`: probe every open window every tick (40 windows is 80 subrequests)
- `GLOBAL_REBUILD_INTERVAL_MS`: rebuild `teams/{year}` on every tick that touched a team. The Teams page goes from up to 10 minutes stale to one minute. Cost is one R2 write per algorithm-season per touched tick, and the pending todo already withdrew the delta-overlay design for this reason.

The corresponding describe blocks in `liveAlgorithmTier.test.ts` (lines 427 to 514) and
`scheduled.test.ts` (597 to 638) go with them. About **500 lines**, and the tick becomes
straight-line code: read manifest, probe, fold, write.

### C4. Delete KV

`env.MANIFEST` has one call site and nothing in the repository has ever written a value to it.
Every tick pays a KV miss and then the R2 read. Remove the binding, the `Env` field, and the
KV branch of `readManifestText`. The Worker then touches exactly two stores: D1 for algorithm
state and cursors (Worker-internal), R2 for published artifacts (browser-facing). Durable
Objects were considered as a way to fold D1 away and rejected: the state is league-wide per team,
not per event, so it does not partition into objects, and a migration rewrites the seed pipeline
for zero deleted lines.

### C5. Reinstate per-team tick writes; delete the live block and the browser overlays

The tick stopped writing `v1/team/...` artifacts in 260917-jr4 to save 7.6 ms. In its place the
event artifact grew an ephemeral `live` block and the browser grew three derivations: the
team-season overlay (`liveTeamSeason.ts` 253, `useLiveTeamSeason.ts` 170,
`teamUpcomingOverlay.ts` 187), live standings (`liveStandings.ts` 280), and `liveEventRows.ts`
(233) with its size-trim constants. With tests that is about **2,200 lines**, all of which
disappear if the tick writes the team artifact and the event's `teams[].rank/record/rp` itself
(it already holds every played qualification row it needs; no extra TBA call).

This is the one change that spends the binding resource. R2 Class A estimate for a peak season
month, driven by matches folded rather than ticks (a tick with nothing new writes nothing):

| Writer | Basis | Peak month |
|---|---|---:|
| Team artifacts | ~18k matches/season x 6 teams x 3 algorithms over ~2.5 months | ~130k |
| Event artifacts | one per algorithm per folded match | ~25k |
| Teams-list rebuilds | 3 per touched tick, ~4.3k touched ticks | ~13k |
| Two rebaselines | 109k each | ~218k |
| **Total** | | **~390k of 1M** |

Viable, with margin, and it lets team pages go back to one fetch (the 2026-09-17 load test found
the index-plus-event-file hybrid 2.1x slower). It also reopens the last pending todo the right
way: with CPU available, the tick can read a small per-(algorithm, season) percentile pool and
publish exact live percentiles instead of carrying a stale tier forward.

### C6. Widen the live tier to opr, epa, spr

`LIVE_ALGORITHM_IDS = "spr"` was forced by the 50-subrequest cap, then by CPU. Neither binds.
The fold path already has working opr and epa branches and `selectionsFor` already loads OPR's
event row in the same statement. What remains is a published-numbers decision: opr and epa would
update live instead of at the manual rebaseline, so both need a version bump and a republish.
CPU is roughly 3x Phase A plus 3x Phase B, about 200 ms per event tick. One correction is
mandatory if this ships: `liveAlgorithmTier.test.ts:516` hardcodes `"spr"` and would silently
stop testing the deployed value.

### C7. Put a Cache Rule in front of `data.sigmascout.org`

Zero lines. Cloudflare does not edge-cache JSON by default, so every page view today is an R2
Class B read and a trip to the bucket. A Cache Rule with a 60 s edge TTL on the R2 custom domain
is free, cuts reads by whatever the hit ratio is, and shortens every artifact fetch. Live event
artifacts are rewritten in place once a minute, so 60 s is the right ceiling; version-addressed
keys could go longer later. This is a dashboard action for Jacob, not code.

---

## 3. Things the audit says NOT to do

**Do not move the rank simulation server-side.** The pre-schedule stop is already fully baked
offline and the sidecar is 6.9 KB median (the 388 KB figures in `docs/simulation-architecture.md`
are two generations stale). The per-match run is parameterized by a visitor's click on a start
match and a Run press, costs 21 ms of draws, and cannot be precomputed without enumerating every
start match of every event. Serving it from an HTTP Worker would add a request-path Worker where
none exists today, bill a request per Run, and replace 290 lines of web-worker plumbing with a
fetch hook. Keep it. Fix the doc.

**Do not migrate D1 to Durable Objects.** See C4.

**Do not merge the Pages site into a Workers Static Assets deployment yet.** It is Cloudflare's
stated direction and would allow one deployment for site, cron, and an HTTP handler, but it
changes the deploy pipeline for a small config win. Revisit if C7 ever needs a Worker in the
read path.

**Do not delete the rotation, the advance claim (CAS), `selectChangedRows`, the generation
mismatch suspension, the seed's `WHERE EXISTS` marker guard, or the 90 KB seed batching.** Each
looks budget-shaped and is actually correctness, idempotency, or a D1 platform limit.

**Do not schedule `pnpm rebaseline`.** 109k R2 writes a run is still the reason. `publish:stubs`
stays for the same reason.

---

## 4. Growth headroom after the changes

| Resource | Projected peak month | Included | Where growth is cheap |
|---|---:|---:|---|
| CPU | ~9M CPU-ms (12 event-days x 720 ticks x ~1 s) | 30M | live tiers, live percentiles, per-tick rebuilds |
| Subrequests per tick | ~500 worst case | 10,000 | probing every window, more algorithms |
| D1 writes | ~2M | 50M | any per-tick state |
| R2 Class A | ~390k | 1M | **constrained: ~35% of it is two rebaselines** |
| R2 storage | 4.3 GB (7.2 GB transiently during a version-bump republish) | 10 GB | **constrained: each published algorithm is ~1.4 GB and ~36k objects** |

The growth axis that is genuinely capped is the number of published algorithms and the
rebaseline frequency, both by R2. The lever there, if it is ever needed, is one team file
carrying all algorithms (101k team objects become 34k, and switching algorithm on a team page
stops being a second fetch). That is a publish-shape change and is not proposed now.

---

## 5. Sequencing, to spend one rebaseline

1. **Deletions with no published-shape change:** C4 (KV), C3 (budget machinery, probe cap, rebuild interval), C2 (probe Worker). Each is its own commit; Worker deploy after. No republish.
2. **C1 + C5 together:** Worker reprices upcoming rows and writes team artifacts; publisher stops emitting the state block; web deletes pricing, overlay, standings. Artifact shape changes but numbers do not.
3. **C6 folded into the same republish:** bump opr and epa, widen the tier, one `pnpm rebaseline`. Storage peaks around 7.2 GB until the prune.
4. **C7** in the dashboard any time.
5. Docs: correct `docs/simulation-architecture.md` sizes, the stale subrequest arithmetic at `scheduled.ts:247-255` and `:290`, the D1 free-allowance comment in `stateStore.ts`, and `docs/worker-operations.md`'s live-tier section.

Approximate total deleted: **12,000 to 13,000 lines** across `apps/worker`, `apps/web`,
`packages/harness`, and `scripts`, against ~180k lines of TypeScript in the repository.
