---
status: complete
quick_id: 260921-5qw
serves_todo: live-promoted-event-renders-degraded
decision: Jacob, 2026-09-21. "I dont want to have to manually do anything during a live event", then "Build all three".
commits:
  - 37f3ecc4
  - 5efe93ea
  - c98e9407
  - 3d1036e6
  - 1c78c206
live: Worker c73b1674, 120 stub artifacts under generation 8caca9d2, web at 1c78c206
---

# 260921-5qw: a promoted live event is complete with no rebaseline — Summary

## What was manual, and why scheduling it was the wrong fix

Since 260920-lny the Worker promotes a zero-match event to live folding once TBA shows matches. All 40
fall 2026 events had no matches and no team list on TBA, so none had an event artifact (404) and none
appeared in any team's season file. A promoted event therefore had no name, no tier cuts, no state
block (so no upcoming pricing) and no robot-page entry until someone ran `pnpm rebaseline`.

Automating that command was rejected on cost, not effort. It needs the 565 MB corpus that lives on one
PC, and it rewrites all ten seasons: about 109,000 R2 writes a run against a 1,000,000 a month free
tier that September's roughly 17 republishes have probably already passed. **Jacob should check R2
usage in the Cloudflare dashboard; this session could not see it.**

## What was built instead: promotion is self-sufficient

**A. Stub event artifacts (`37f3ecc4`, `1c78c206`), offline, zero tick cost.** Every event that gets a
probe window also gets an event artifact: identity and the season's `tierCuts`, with empty `matches`,
`upcoming` and `teams`. `probeWindowFor` is the one rule both the manifest builder and the publisher
ask, on the same clock, so a window and a stub cannot disagree. `scripts/publishProbeStubs.ts`
publishes ONLY the stubs (120 objects) through `buildProbeStubArtifact`, pinned byte-equal to what the
season loop emits; it reads versions and generation from the LIVE manifest and never overwrites an
event that already has an artifact.

**B. The tick completes the state block (`5efe93ea`).** In Phase B the tick asks
`missingStateBlockKeys` what the block lacks for every team still on the schedule, reads exactly those
rows from D1 in one statement, and `completeEventStateBlock` builds or extends the block. A key D1 has
no row for is recorded in the block's new optional `absentKeys`, so a rookie costs one look, not one a
tick. **Oracle:** on the rp harness, an artifact published with NO block ends five ticks holding rows
byte-identical, league row included, to the same event published WITH a block and maintained by the
splice, for exactly one extra D1 read. That test previously pinned the opposite rule and says so.

**C. The live roster (`c98e9407`, `3d1036e6`).** The Worker writes `v1/live-roster/{eventKey}.json`
(real teams in the standings plus everyone still on the schedule) once per event, only when the roster
grew against the artifact just read. A current-season robot page reads the live-windows manifest, and
for each window open NOW and not already among the team's events reads that roster; a roster naming
the team adds the event, and the existing overlay fills its matches from the event artifact. Both
fetchers fail soft. The route's empty-state guard now reads the live event list.

## Found by the tests, not by reasoning

- **The opportunistic read stole the artifact's subrequest.** A first version took the last slot of a
  tick admitted at exactly its estimate, and the event artifact was not written at all. Both new
  subrequests now run only when one is left over after this event's remaining reads and writes, so the
  pinned estimates (6, 14, 28) do not move.
- **The route short-circuited before the hook.** Discovery worked end to end and the page still said
  "No event data", because the guard read the published event list.
- The 260921 todo I filed said a promoted event had no events-list row. That was wrong: the list has
  carried all 40 since 260920-lny. The real gap was the missing event artifact.

## Verification

- Full suite from the repo root: 261 files, 5852 passed, 1 skipped, 0 failed. Root, worker and web
  `tsc --noEmit` clean. `vite build` clean.
- Red first for B and C. Five tests pinned exactly one R2 write per folding event; they now pin exactly
  two on a first fold, by key equality, and one that the roster is written once across three ticks.
- Pinned: no window open means no roster fetch; a past season's page does not read the manifest; no
  budget means no block and no roster and the artifact still lands.

## Shipped, 2026-09-21, in this order

1. Worker `c73b1674` from a clean tree at `1c78c206`. Ticks `ok`, `cpuTime` 3 ms, probing one window.
2. `scripts/publishProbeStubs.ts`: dry run 40 events and 120 stubs, real run wrote 120, a second dry run
   would write 0. Served: `2026miwyo` answers with its name, type 99, four `tierCuts` metrics, no state.
3. Pushed. Test and deploy workflows green, asset check included. Live e2e 170/170.
4. Live in a browser: `/event/2026txrm` shows "The Remix, Sep 19, 2026 · TX, USA" where it 404ed, and a
   2026 robot page makes two discovery fetches, the manifest (200) and the one open window's roster (404).

## What is still unobserved, and what is still manual

- **No event has been promoted yet**, so the block completion, the roster write and the robot-page
  discovery have run only in tests. `2026txrm` stays open through 2026-09-23; six windows open
  2026-09-24 and 25. Workers Logs is on at 100 percent sampling, so the first fold's `outcome` and
  `cpuTime` are retained without anyone tailing. Look for `event-state-block-completed`.
- **Results become permanent only on an ordinary republish.** The live rows stay in the event artifact
  until then, so nothing is lost and nothing is time-critical.
- TBA rank and record for a live event are still not refreshed by the Worker (deferred items, waived
  2026-09-06).
