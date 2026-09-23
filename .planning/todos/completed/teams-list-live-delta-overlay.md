---
id: teams-list-live-delta-overlay
created: 2026-09-21
source: tick inventory during quick task 260921-q2s (Jacob's staleness and Worker CPU push)
priority: medium
---

# The Teams page is up to 10 minutes stale and costs the tick its biggest periodic spike

`runGlobalRebuild` (`apps/worker/src/scheduled.ts`, gated by `GLOBAL_REBUILD_INTERVAL_MS`, 10 min)
reads the whole `teams/{year}` list from R2, runs `TeamsArtifactSchema.parse` over it, re-encodes it
and writes it back through a second wire-schema parse and a full stringify. That is a whole-list
parse and stringify on one tick in ten, and the Teams page still lags a live event by up to 10
minutes.

> **2026-09-22: the per-event delta-overlay redesign below is WITHDRAWN.** It was a workaround for
> the tick's CPU cost, and the Worker is no longer CPU-constrained (Workers Paid since 2026-09-22:
> 30 s CPU and 10,000 subrequests per invocation, up from 10 ms and 50).
>
> The single remaining action is to lower `GLOBAL_REBUILD_INTERVAL_MS` in
> `apps/worker/src/scheduled.ts` toward one minute. That is safe on R2 — one Class-A write per
> minute, and R2's free tier is unchanged — so this is the one claim in this file still argued on R2
> write cost rather than on CPU. The interval is NOT changed by this note; it stays exactly as it is
> in `scheduled.ts`, left for a future task.

## CLOSED 2026-09-23 by quick task 260923-3w4

The one remaining action is done, and done one step further than "toward one minute":
`GLOBAL_REBUILD_INTERVAL_MS` is **deleted**, not lowered. `runGlobalRebuild` now runs on every tick,
and `runGlobalRebuild`'s own `touchedTeamsByAlgorithm.size === 0` early return means a tick that
folded nothing still writes nothing — so the R2 cost is one Class-A write per algorithm-season per
*touched* tick, not per minute. `260923-1tu-FINDINGS.md` item C3 priced that at about 13k writes in
a peak month against R2's 1M Class-A allowance (the allowance the Workers Paid change did NOT
raise).

The `lastGlobalRebuildAtMs` field is gone from the tick meta with it, and so is the event-completion
trigger as a *separate* condition — an event completing its last scheduled match touched teams, so
it is subsumed rather than dropped.

**The staleness this file was opened about is fixed:** the Teams page is now at most one cron minute
behind the event page showing the same match, instead of up to ten.
