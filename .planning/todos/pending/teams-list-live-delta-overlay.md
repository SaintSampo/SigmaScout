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
