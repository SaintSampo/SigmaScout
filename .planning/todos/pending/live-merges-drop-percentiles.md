---
id: live-merges-drop-percentiles
created: 2026-09-12
source: quick task 260912-tnk (rarity-tier consistency audit) — audited, recorded, deliberately not fixed
priority: low
---

# Live Worker merges still publish no percentile NUMBER for a touched team (the TIER gap is closed)

> **STATUS 2026-09-23 (quick task 260923-3x0). The tier half of this todo is CLOSED on EVERY surface,
> event and robot page alike. The percentile-NUMBER half is still real and is now the only reason this
> file stays open — but it is no longer BLOCKED: the CPU gate it waited behind is gone, so what is
> left is a cost decision, not an impossibility. Read the two 2026-09-23 sections at the bottom before
> the older ones: 260923-3w7 reopened the tier half for the robot page and 260923-3x0 closed it again,
> which is why the 260920-qzf account below is true but no longer complete.**

## What closed

Every event artifact now carries an optional `tierCuts` block (`EventArtifactSchema.tierCuts`,
`packages/harness/pageArtifacts.ts`): three rarity-tier cut points per metric name, built once per
`(algorithm, season)` from the exact same `rankingPools` every published percentile ranks against
(`buildTierCutsFromPools`, `packages/harness/percentiles.ts`). The client's tier resolver
(`resolveMetricTier`, `apps/web/src/lib/tiers.ts`) prefers a published `percentile` when present and
falls back to `tierFromCuts` (`packages/harness/tierCuts.ts`) against that block whenever a metric
entry has a VALUE but no percentile — exactly the shape `mergeEventArtifact`'s
`touchedEventTeamMetrics` and the `live` block's rows have always had.

Concretely, closed:

- **Event standings** (Insights, Breakdown, the Alliances pick pills): a touched team's row renders
  its tier again immediately after a live tick, not just its value.
- **`live`-block-derived rows** (the match-page robot grid, the team-page event tiles): these rows
  NEVER carried a percentile by construction (`EventLiveRowSchema` is value-only) and rendered no
  tier at all before this task — they render one now, for the first time.
- The exactness of `tierFromCuts` against the reference (`publishedTierForPercentile(
  goodnessPercentileAgainstPools(...))`) is proven, not assumed: `packages/harness/tierCuts.test.ts`
  sweeps every distinct pool value and one grid step either side, both metric directions, for pools
  with ties, duplicates, negatives, a boundary tie, a singleton pool, an all-identical pool, and a
  several-hundred-team synthetic pool.
- `mergeEventArtifact` carries `tierCuts` forward through a live tick unchanged, through the
  Worker's own write-side parse (`apps/worker/test/scheduled.mergePreservation.test.ts`) — the same
  carry-forward policy as the Sigma entry and the teams-row tier/record.

**Two bootstrap paths still carry no `tierCuts`, by design, unchanged by this task:**

1. **Bootstrap write** (`mergeEventArtifact` with `existing === undefined`): an event with no
   published artifact at all. The Worker invents no cuts — it has no season pool — so those rows
   render untiered exactly as they did before, until the first offline publish of that event.
2. **`writeArtifactWithBootstrapRetry`** degrading a corrupt artifact to a bootstrap merge: same
   outcome, same reason.

Both are strictly no worse than the pre-260920-qzf behaviour, never worse.

## What did NOT close, and is not approximated

The displayed **percentile NUMBER** — the team page's World rank card, the Alliances tab's
approximate combined percentile, and any other surface that prints a percentile rather than just a
tier box — still renders absent for a live-folded row on every surface that prints one. `tierCuts`
answers "which of four bands", not "what number"; synthesizing a percentile NUMBER from three cut
points would be a much larger guess than reproducing a four-way classification, and quick task
260920-qzf deliberately drew that line. `allianceTierApproximation.ts` keeps requiring a published
percentile for its interpolation points, so the Alliances tab's Combined Total tier still thins
during live folding, unchanged.

This is now the ENTIRE remaining scope of this todo. The original three-surface tier gap
(`mergeTeamSeasonArtifact`'s dropped percentiles, `mergeEventArtifact`'s dropped percentiles, and
the un-tiered `live` block) is gone as a rendering problem; what remains is purely "no live-folded
row prints an exact percentile number", which is:

- Lower priority than the closed tier gap: a reader loses a number, not a colour, and the FRC
  audience's dominant use of a percentile is exactly the tier it implies.
- ~~**Still blocked behind `rp-fold-exceeds-worker-cpu-budget`**~~ — NO LONGER TRUE, see the 260923-3w6
  section below. That todo is completed and the account is on Workers Paid; an exact percentile needs
  the season pool inside the tick, and reading a compact one is now an R2 read to price, not a CPU
  ceiling to clear. This bullet is kept struck through rather than deleted so the argument's history
  is legible.
- **No longer worth unblocking for tiers alone** — the reason a fix here was ever discussed. If
  `rp-fold-exceeds-worker-cpu-budget` closes for an unrelated reason, revisit whether a live-priced
  percentile number is worth the cost then; do not reopen this specific fix on tier grounds.

## History (superseded by the above; kept for context)

> STATUS 2026-09-18, re-read against HEAD `aa191801`. Half of this is gone, the other half is still
> real and still blocked.
>
> - Gone. `mergeTeamSeasonArtifact` left the live tick in 260917-jr4 (Worker `c9b4642e`,
>   260918-16t). The tick writes NO team artifact, so the unscoped offseason `seasonStats` write and
>   every other `mergeTeamSeasonArtifact` bullet below no longer describes production. The function
>   survives only as the state probe's `allPhaseB` baseline arm.
> - Moved. The robot and match pages derive a live view from the event artifact's `live` block —
>   rounded values, no percentile. Same symptom, new location. (Now closed for TIER by 260920-qzf;
>   see "What closed" above. The percentile NUMBER is still absent.)
> - Unchanged then, now closed for TIER. `mergeEventArtifact` writes touched standings with no
>   percentiles; the tier is recoverable from `tierCuts`, the number is not.

Original 2026-09-12 diagnosis, `mergeTeamSeasonArtifact` write list (historical, the function no
longer runs live): wrote `seasonStats` with no percentiles and dropped `metricsBasis` (the basis
drop was fixed separately by 260915-p0a); appended `newMetricHistoryRows` with no percentiles;
wrote `seasonStats.metrics` from offseason/preseason ticks unscoped. None of this executes in
production any more.

**A candidate direction for the percentile-NUMBER gap, not a decision:** publish a compact pool —
per metric key, the sorted rounded values — somewhere cheap to read (a small R2 object per
(algorithm, season), or a D1 row alongside the state the tick already batch-reads). With it, each
merge could call `goodnessPercentileAgainstPools` directly for only the touched teams' metrics,
without decoding the Teams artifact. The pool is stale by the same amount a carried tier is, so
measure whether that is actually better than carry-forward before building it. Not exercised in
production until the pre-season CPU gate in `docs/worker-operations.md` closes: no live window may
open before then.

## 2026-09-23, quick task 260923-3w6: the CPU gate is gone, and the write is back

Two things changed at once, and both matter here.

**`mergeTeamSeasonArtifact` runs in production again.** 260923-3w6 reinstated the tick's per-team
artifact read and write (findings item C5), reversing 260917-jr4. So the "Gone" bullet in the
History section above is itself superseded: the original 2026-09-12 diagnosis describes production
once more, minus the parts fixed separately — `metricsBasis` is still set (260915-p0a) and the
metric-history rows still carry no percentile. The offseason `seasonStats` scoping question is live
again too.

**The CPU argument for not fixing it is retired.** Every "blocked behind
`rp-fold-exceeds-worker-cpu-budget`" clause above was written against the free plan's 10 ms per
tick. The account is on Workers Paid since 2026-09-22: 30 s of CPU per cron tick. Reading a compact
per-(algorithm, season) percentile pool and calling `goodnessPercentileAgainstPools` for the touched
teams is no longer a CPU question at all — it is an R2 read per algorithm-season per touched tick,
priced against the 1M Class A / 10M Class B allowances the plan change did NOT raise.

So the candidate direction at the end of this file is now the whole of what is left to decide: is a
live percentile number worth one more R2 object per algorithm-season, against a carried-forward tier
that is already correct and a percentile that is simply absent? Nothing in 260923-3w6 answers that,
and nothing in it depends on the answer — the live-merged row carries no percentile number, exactly
as before, and that remains an accepted limitation rather than a defect.

## 2026-09-23, quick task 260923-3w7: the TIER gap on the robot page opened, briefly

The "What closed" section above says the tier half of this todo is closed. Between 260923-3w7 and
260923-3x0, both on 2026-09-23, that was true only of the event page. 260920-qzf closed it in two places, and one of them depended on a
fetch that stopped happening:

- **Event page** (Insights, Breakdown, Alliances, the match-page robot grid) — never affected. Those
  surfaces read `tierCuts` off the event artifact they already hold, and `mergeEventArtifact` still
  carries the block forward through every tick.
- **Robot page event-section tiles** — briefly OPEN. Their `tierCuts` came from the live EVENT artifact,
  fetched by the team-season overlay 260923-3w7 deleted: the tick writes the team artifact itself again,
  so the robot page reads one file and fetches no event artifact at all. `EventSection`'s `tierCuts`
  prop and its three 260920-qzf cases went with the source that fed them, and a live-folded row's
  snapshot tiles rendered UNTIERED — the pre-260920-qzf behaviour, no worse.

Published rows were unaffected throughout: `withHistoryPercentiles` puts a `percentile` on every
metric-history row the publisher writes, and a published percentile always wins over cut points.

## 2026-09-23, quick task 260923-3x0: the TIER half is CLOSED again, everywhere

The fix named at the end of the 3w7 section was the one taken, and it cost nothing but a key. `tierCuts`
was never per-event — it is built ONCE per (algorithm, season) from `rankingPools`
(`buildTierCutsFromPools`) and merely rode each event artifact — so the publisher now attaches THE SAME
OBJECT to every team-season artifact as well. No new computation, no second fetch, no approximation.

What landed:

- `TeamSeasonArtifactSchema.tierCuts`, declared with the IDENTICAL schema object the event artifact
  uses (renamed `EventTierCut*` → `SeasonTierCut*`, the scope it always had; the wire key is `tierCuts`
  on both and never changed). Declaring it is what matters: `writeArtifactObject`'s write-side
  `schema.parse` strips every undeclared key, so an undeclared one would be undone on every tick.
- `publish.ts` passes its one `seasonTierCuts` object to both builders, pinned end-to-end by a
  `publishSeasons` test asserting every team artifact's block is BYTE-equal to both events' blocks for
  the same (algorithm, season).
- `mergeTeamSeasonArtifact` needed no code change — its leading `...existing` spread already carries
  the key — and five cases in `scheduled.mergePreservation.test.ts` establish that rather than assume
  it, including the bootstrap path which carries none (the Worker holds no season pool).
- `EventSectionList` passes `artifact.tierCuts` to `EventSection`; the three deleted cases are restored
  plus four more, two of them route-level (tiered with ZERO `/v1/event/` fetches; a pre-republish file
  that still loads untiered).

Byte cost, measured from a real dry-run publish of 2026 rather than estimated: a fixed cost per
(algorithm, season), so every team artifact for one algorithm pays the same — opr +50 B, spr +51 B,
epa +610 B (15 metric names against their 1). Largest 2026 team artifact 174,580 B, +0.351%, against a
500,000 B `PAGE_BUDGET_MAX_BYTES.team` ceiling.

**A republish is owed to populate the key.** The publisher writes it, the tick only carries it, so a
team file published before 260923-3x0 carries no block — it parses (the read schema is not `.strict()`)
and renders a live-folded row untiered until that (algorithm, season) is republished. That is the
pre-260920-qzf behaviour, never worse.

## What is left in this file

**ONLY the percentile NUMBER**, and it is a cost question now rather than a blocked one. The candidate
direction in the middle of this file — publish a compact per-(algorithm, season) pool (per metric key,
the sorted rounded values) somewhere the tick can read cheaply, then call `goodnessPercentileAgainstPools`
for the touched teams' metrics — is FEASIBLE ON THE TICK today. `rp-fold-exceeds-worker-cpu-budget` is
completed and the account has been on Workers Paid since 2026-09-22, so the 10 ms argument every
"blocked" clause above rests on is retired. What it costs instead is one R2 read per algorithm-season
per touched tick, priced against the 1M Class A / 10M Class B allowances the plan change did not raise.

The open decision, unchanged in substance: is a live percentile NUMBER worth that read, against a
carried-forward TIER that is already correct on every surface and a percentile that is simply absent?
A reader loses a number, not a colour, and the FRC audience's dominant use of a percentile is exactly
the tier it implies. `allianceTierApproximation.ts` still requires a published percentile for its
interpolation points, so the Alliances tab's Combined Total tier still thins during live folding.
