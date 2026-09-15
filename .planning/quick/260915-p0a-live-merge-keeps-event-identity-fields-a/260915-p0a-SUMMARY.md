---
quick_id: 260915-p0a
status: complete
date: 2026-09-15
commits: [aeb2bd31, b9f8d4c3, ec084691, 61f79e0a]
requirements: [DATA-04, EVNT-03, EVNT-04, EVNT-07, TEAM-05, ALGO-08]
worker_version: 43ed9472
---

# 260915-p0a: Live merges keep every key the tick does not own, and played rows match the offline builder

## Outcome

Two live/offline defects are closed.

1. **The merge no longer wipes what it does not own.** `mergeEventArtifact` and
   `mergeTeamSeasonArtifact` now start from the published artifact and override only the keys the
   tick owns. Before this, the first tick at an event dropped the event's name, dates, location,
   week and alliances, and rebuilt every touched team's standings row without its rank, record or RP.
2. **Live-folded played rows are built by the offline publisher's own builders.** The Worker's
   hand-written row builders are deleted, so the two agree by construction rather than by comment.
   This closes the v1.0 audit's row-parity gap.

Offline published output is byte-identical (digest check below), so no republish is needed and none
was run.

## Owned vs preserved

- **Event artifact, owned:** stamps, `matches`, `upcoming`, `teams`, `state`, plus `eventType` and
  `rpOutcomeRp` when the tick derives them. `state` is destructured out before the spread, so a
  stale block can never survive.
- **Event artifact, preserved:** `name`, `startDate`, `location`, `week`, `alliances`, and anything
  the publisher adds later — automatically, with no edit to the merge.
- **Standings rows:** only `metrics` is owned. `rank`, `record` and `rp` are TBA's official
  standings, which the Worker does not recompute, so they are carried forward as last published
  (stale until the next republish, the same treatment the Sigma entry already gets). Rows are
  replaced in place, so ordering never shifts.
- **Team-season artifacts:** `robotImageUrl`, `activeYears`, `ranks`, other `seasonStats` keys, other
  events, and each event's name/date/rank fields are preserved. `metricsBasis` is now derived
  (`last-official-match` for an official tick, else `season-final`).

## Played-row parity

| Field | Live now? | Source |
|---|---|---|
| `actualRedRp` / `actualBlueRp` | yes | the match result already in the tick |
| `actualRedBonusRp` / `actualBlueBonusRp` | yes | Phase A's existing breakdown parse (see below) |
| `redScoreVarianceOwn` / `blueScoreVarianceOwn` | yes | the prediction |
| `video` | yes | the same TBA poll (usually absent live; TBA posts videos later) |
| `sortTime` | yes when TBA reports a time, else the previously published value, else no key | never the window-start guess |
| team-season `setNumber`, `matchNumber`, bonus RP | yes | fixed by using the shared builder |
| `coldStart` | **no — tested exception** | needs a corpus-wide first-appearance index the Worker lacks; a D1 presence check would mislabel it |

**Breakdown parse (orchestrator adjustment, adopted).** The tick is over its CPU budget, so rather
than parsing the score breakdown a second time in Phase B, Phase A's existing RP-fold parse now
carries its bonus flags forward. Flags are captured before the fold, so a throwing fold cannot lose
them. Phase B falls back to parsing only if no live-tier algorithm parsed at all; with the deployed
tier (`spr`) production pays zero extra parses. Proven, not assumed: a mutation that disables the
Phase B parse entirely leaves the end-to-end flag test green.

## Verification

- **Offline output unchanged:** a digest over the committed fixture and a synthetic event plus
  team-season artifact is identical before Task 2, after Task 2 and after Task 3.
- **RED observed first:** the new preservation tests failed 4/8 on unmodified code, with the exact
  missing keys named.
- **Mutations:** 9 by hand, each observed failing and reverted. One found a real hole: spreading
  `existing` without removing `state` passed at first because the schema silently drops a bad block,
  so the test now asserts on the raw merge output. The orchestrator ran a tenth (dropping the
  preservation spread), which failed as required.
- **Fixtures come from the real offline builders** and loop over the builder's own keys, so a key
  added later is covered without editing the test.
- **Suite and typechecks (re-run by the orchestrator):** 247 files, 5,431 passed, 1 skipped, 0
  failed. Root, web and worker `tsc` all clean. The baseline's single failure was a load-flaky
  `MetricHistoryTab` test, which passes now.

## Deploy

- Worker version `43ed9472` deployed from a clean tree at `61f79e0a`. Bindings MANIFEST, DB,
  ARTIFACTS, `LIVE_ALGORITHM_IDS=spr`, schedule `* * * * *`.
- Four tailed idle ticks: all `ok`, cpuTime 2/0/0/0, eventsConsidered 0.
- No republish, no D1 change, no algorithm version bump.

## Still open

- `live-merges-drop-percentiles` stays pending. Only its `metricsBasis` line was updated.
- Live behaviour can only be observed once a window opens. On the first tick, check that the event
  page keeps its title, dates, location, week, alliances and standings columns, that a touched
  team's row keeps its rank/record/rp and position, and that played rows carry `sortTime`,
  `actualRedRp` and bonus dots.
