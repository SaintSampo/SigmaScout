---
id: live-merges-drop-percentiles
created: 2026-09-12
source: quick task 260912-tnk (rarity-tier consistency audit) — audited, recorded, deliberately not fixed
priority: medium
---

# Live Worker merges write team and event metrics with no percentiles

Quick task 260912-tnk made a rarity tier a function of (metric value, the one season ranking pool)
on every surface the offline pipeline publishes. The live Worker (`apps/worker/src/scheduled.ts`)
still writes three surfaces with no percentile at all during an event. None of them paints a FALSE
tier — an absent percentile renders no tier box — but a team that was Legendary an hour ago renders
untiered until the next offline publish.

## What is dropped, per tick

- **`mergeTeamSeasonArtifact`** (the `team/{teamKey}/{year}` write, every tick, every touched team):
  - writes `seasonStats: { record, metrics: roundTeamMetricRecord(metrics) }` — no percentiles, and
    it also drops `metricsBasis`. The team page's header tiles (when no official snapshot is
    derivable), and the World rank card (tiered from `seasonStats.metrics.total.percentile` since
    260912-tnk) render untiered for a touched team.
  - appends `newMetricHistoryRows` with no percentiles, so new event cards and the match-page robot
    grid render untiered for the new rows. The header's own last-official-snapshot tiles read these
    rows too.
  - writes `seasonStats.metrics` from offseason and preseason ticks UNSCOPED. The offline pipeline
    scopes `seasonStats` to the last official match (260908-wpo); a live offseason tick overwrites it
    with an offseason-trained value.
- **`mergeEventArtifact`** writes touched standings with `roundTeamMetricRecord(touchedMetrics[...])`
  — no percentiles — so Insights, Breakdown and Alliances pick cells render untiered for touched teams.

## Why it was not fixed in 260912-tnk

Every one of these needs THE POOL: every team's last-official-match metrics for the season. The only
place the Worker has that is the `teams/{year}` artifact. Reading it on every tick costs one more R2
subrequest per algorithm plus a full decode of the ~3,800-row artifact, on a Worker already
over its sustained CPU budget (`docs/worker-operations.md`, "PRE-SEASON GATE"). 260912-tnk's CONTEXT
allowed a fix here only without reading the Teams artifact every tick.

The same CPU wall stopped the Teams list itself from re-ranking: 260912-tnk measured full tier
re-derivation over the decoded Teams rows at 67-97% of the global rebuild's existing CPU cost against
a 25% gate, so the global rebuild now CARRIES each touched row's last published tier forward
(`touchedTeamsRowMetrics`). That is honest but stale: a touched team whose value crossed a cut keeps
its old tier, and no other row is re-ranked against its new value.

## A candidate direction, not a decision

Publish a compact pool — per metric key, the sorted rounded values — somewhere cheap to read (a small
R2 object per (algorithm, season), or a D1 row alongside the state the tick already batch-reads). With
it, each merge could call `goodnessPercentileAgainstPools` directly for only the touched teams'
metrics, without decoding the Teams artifact. The pool is stale by the same amount a carried tier is,
so measure whether that is actually better than carry-forward before building it.

Not exercised in production until the pre-season CPU gate in `docs/worker-operations.md` closes: no
live window may open before then.
