---
phase: quick-261017-doy
plan: 01
subsystem: worker live tick / event page polling / simulation tab
tags: [worker, live, ranking-points, simulation, polling]
status: complete
requires: []
provides: [lateBreakdownBackfill, eventArtifactLooksFinished]
key-files:
  added:
    - apps/worker/src/lateBreakdownBackfill.ts
    - apps/worker/test/lateBreakdownBackfill.test.ts
  modified:
    - apps/worker/src/scheduled.ts
    - apps/web/src/lib/liveEvent.ts
    - apps/web/src/lib/liveEvent.test.ts
    - apps/web/src/components/event/SimulationTab.tsx
    - apps/web/src/components/event/SimulationTab.test.tsx
decisions:
  - "A match folded before its score breakdown landed is backfilled, never re-folded. The published row gains the ranking points and bonus flags TBA now reports; the algorithm state that folded it without a breakdown is left as it is. A fill writes into a null or absent field only and never overwrites a published number."
  - "The backfill runs on every full match list (a 200), before the fold and the schedule-only pricing, so both paths read the filled rows back and preserve them. It costs one event artifact read per live algorithm per 200 and writes only when a row changed; a filled row's team artifacts are patched the same way."
  - "The event page polls until the event is over, not until the schedule is empty. An empty upcoming list no longer stops the 60 s poll; two wins for one colour inside one finals set does (the Worker's own complete rule), and the 7-day currency rule still bounds an event that never posts a playoff."
  - "The Simulation tab's unchosen default start match follows the live artifact. It was computed once at page load so it would not move mid-event, which meant every later Run re-simulated from a match that had since been played, as a rewind over stored predictions. A reader's own choice is still never moved."
metrics:
  completed: 2026-10-17
actuals:
  tasks: 1
  commits: 1
---

# Quick 261017-doy: late score breakdown backfill, and the event page keeps up with a live event

Found at Doyenne Inspiration East (2026ncfay) on 2026-10-17 with Jacob on site: the
Quals and Simulation tabs looked stale. The live artifacts were current with TBA on
scores, but 16 of 24 played qualification rows carried `null` ranking points and bonus
flags while TBA's own match pages showed every breakdown. TBA posts a match's score
before its breakdown; the tick folds a match the first time it sees it played and never
normalizes it again once it sits at or before the fold cursor, so a match folded in that
gap stayed without ranking points for the rest of the event. The Quals tab showed no RP
for those matches, and a rewind simulation's summed baseline excluded them.

Three changes:

1. **Late breakdown backfill (Worker).** `lateBreakdownBackfill.ts` holds the pure parts
   (`rowHasBreakdownGap`, `lateBreakdownFactsFor`, `patchRowsWithLateBreakdowns`);
   `runLateBreakdownBackfill` in `scheduled.ts` is the I/O, called from `processEvent`
   right after the split on every 200, wrapped so a failure costs the backfill alone.
2. **Polling gate (web).** `shouldPollEventArtifact` keeps polling with an empty
   `upcoming` until `eventArtifactLooksFinished` says the finals are decided. Before
   this the page stopped polling the moment the last qualification match was scored
   and never saw alliance selection or the playoff schedule without a reload.
3. **Simulation default (web).** `defaultMatchKey` is a `useMemo` over the current
   qualification rows rather than a one-time `useState` initializer.

Not changed: the algorithm fold. Matches folded without a breakdown contributed no
threshold observations to the ranking-point model, and the backfill does not replay
them. The live rankings were never affected (they come from TBA's rankings endpoint).

Deploy: the web change ships on push to `main`. The Worker change needs the manual
`pnpm worker:deploy` (docs/worker-operations.md, "Deploying"); the first tick after the
deploy that sees a 200 on 2026ncfay fills the 16 rows.
