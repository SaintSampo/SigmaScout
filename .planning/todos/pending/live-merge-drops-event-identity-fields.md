---
id: live-merge-drops-event-identity-fields
created: 2026-09-15
source: quick task 260915-isq (browser pricing step 2), found by the executor and confirmed by the orchestrator against scheduled.ts
priority: high
---

# A live tick rebuilds the event artifact without its identity fields

`mergeEventArtifact` (`apps/worker/src/scheduled.ts`, the return object after the `teams` rebuild)
builds its output from scratch instead of spreading `existing`. As a result, the first live tick at an
event drops these fields from the event artifact:

- `name`, `startDate`, `location`, `week`
- `alliances`

For every touched team, the standings row is rebuilt with only `teamKey`, `teamNumber`, `nickname` and
`metrics`. Any published `rank`, `record` or `rp` on that row is lost.

This predates the browser-pricing work. `eventType` and `state` are now carried forward deliberately
(260915-isq). The other fields are not.

**Impact:** none today, because the pre-season gate keeps every live window closed. Once a window opens,
the event page loses its title, dates, location, alliance selections and standings columns on the
first tick.

**Fix direction:**
- Start the merge from `existing` and overwrite only what the tick owns: `matches`, `upcoming`, the
  touched `teams` rows' metrics, `rpOutcomeRp`, `state` and the stamps.
- For touched teams, spread the prior row, then replace its metrics.
- Pin it with a test: an artifact carrying every optional field keeps each one through a tick.
  Precedent: the live/offline row-shape parity gap in the v1.0 audit's integration section.

Belongs with the DATA-04 row-parity items that must land before the pre-season gate lifts. Related:
[[rp-fold-exceeds-worker-cpu-budget]], [[live-merges-drop-percentiles]].
