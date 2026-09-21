---
id: live-promoted-event-renders-degraded
created: 2026-09-21
source: recorded as follow-up 5 in quick task 260920-lny's SUMMARY and never filed; filed during the 2026-09-21 stock-take
priority: medium
---

# An event promoted live that was never published offline renders degraded

Since quick task 260920-lny the Worker probes a calendar window and promotes an event to live folding
once TBA shows matches. All 40 fall 2026 offseason events held zero matches at the last publish, so
every one of them will be promoted WITHOUT ever having been published offline.

Folding itself works: `mergeEventArtifact` bootstraps a schema-valid artifact and D1 resumes from the
league row. What such an event lacks until the next `pnpm rebaseline`:

- no `state` block, because `maintainedStateBlock` never bootstraps one, so upcoming matches stay
  unpriced in the browser;
- no `tierCuts` block on the bootstrapped artifact (quick task 260920-qzf notes both bootstrap paths
  carry none), so live rows there render untiered;
- no name, week, TBA rank or record;
- no row in the events list.

## Cheapest remedy, already available

`pnpm rebaseline` during the event publishes it properly, and 260920-q75 made a mid-event re-baseline
safe. So today this is an operator step, not a defect with no way out.

## What a fix would be

Have the first promoting tick bootstrap a state block and copy `tierCuts` from the season's published
teams artifact, or have the offline publisher emit a schedule-less stub for every probe-window event.
Either adds work to a tick that is still over its CPU budget
(`rp-fold-exceeds-worker-cpu-budget`), so price it as a within-run arm difference first.

Not yet seen in production: as of 2026-09-21 no event has been promoted.
