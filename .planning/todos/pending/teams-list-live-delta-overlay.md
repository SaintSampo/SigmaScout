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

## Direction

The Worker stops rewriting the list. After Phase B it already holds the event's merged `teams`
rows, so it writes one small per-event delta (touched teams' current metrics) with one put and no
read. The browser Teams page overlays the deltas of live events on the published list. The page
goes from 10 min stale to per-tick fresh and the periodic spike disappears.

## Open points for the plan

- How the Teams page learns which events are live without a heavy fetch (the live roster objects
  and the live window manifest are the candidates).
- The new put must sit behind `budget.remaining > what this event still owes` AND `tryConsume`
  (see the 260921-5qw lesson: an unguarded opportunistic subrequest took the artifact write's slot).
- The delta is ephemeral in the same structural way the `live` block is; decide how it is dropped
  at republish and swept from R2.
- Measure as a within-run arm difference, never an absolute `cpuTime`.
