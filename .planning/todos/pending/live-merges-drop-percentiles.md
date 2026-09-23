---
id: live-merges-drop-percentiles
created: 2026-09-12
source: quick task 260912-tnk (rarity-tier consistency audit) — audited, recorded, deliberately not fixed
priority: low
---

# Live Worker merges still publish no percentile NUMBER for a touched team (the TIER gap is closed)

> **STATUS 2026-09-20 (quick task 260920-qzf). The tier half of this todo is CLOSED. The percentile-
> NUMBER half is still real, still blocked, and now the only reason this file stays open.**

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
- **Still blocked behind `rp-fold-exceeds-worker-cpu-budget`** for the same reason as before: an
  exact percentile needs the season pool inside the tick, and the tick is still over its sustained
  CPU budget. Nothing in 260920-qzf changes that gate.
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

## 2026-09-23, quick task 260923-3w7: the TIER gap on the robot page is OPEN again

The "What closed" section above says the tier half of this todo is closed. **That is now only true of
the event page.** 260920-qzf closed it in two places, and one of them depended on a fetch that no
longer happens:

- **Event page** (Insights, Breakdown, Alliances, the match-page robot grid) — still closed. Those
  surfaces read `tierCuts` off the event artifact they already hold, and `mergeEventArtifact` still
  carries the block forward through every tick.
- **Robot page event-section tiles** — OPEN again. Their `tierCuts` came from the live EVENT artifact,
  fetched by the team-season overlay 260923-3w7 deleted: the tick writes the team artifact itself again,
  so the robot page reads one file and fetches no event artifact at all. `EventSection`'s `tierCuts`
  prop and its two 260920-qzf cases went with the source that fed them. A live-folded row's snapshot
  tiles therefore render UNTIERED until that event's next republish — exactly the pre-260920-qzf
  behaviour, and no worse.

Published rows are unaffected either way: `withHistoryPercentiles` puts a `percentile` on every
metric-history row the publisher writes, and a published percentile always wins over cut points.

**The fix, and it is cheap:** publish `tierCuts` on the TEAM-SEASON artifact. The block is already
per-(algorithm, season) rather than per-event (it is built once from `rankingPools` and merely rides
each event artifact), so the publisher can attach the same object to a team's file with no new
computation, and `mergeTeamSeasonArtifact` can carry it forward exactly as `mergeEventArtifact` does.
That restores `EventSectionList` -> `EventSection`'s resolver with no fetch. It was deliberately NOT
done in 260923-3w7: it needs a `TeamSeasonArtifactSchema` key and a `scheduled.ts` change, both outside
that task's scope.

Note this is the TIER half only. The percentile NUMBER gap above is unchanged, and so is the standing
question at the end of this file: whether a live percentile number is worth one more R2 read per
algorithm-season per touched tick.
