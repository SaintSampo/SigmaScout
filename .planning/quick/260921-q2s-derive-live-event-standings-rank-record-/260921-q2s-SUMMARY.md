---
phase: quick
plan: 01
subsystem: ui
tags: [react, tanstack-query, zod, event-page, live-standings, insights, rank-simulation]
status: complete
completed: 2026-09-21
commits: [bf359717, cdbb61df, ec01bb6d]
key-files:
  created:
    - apps/web/src/lib/liveStandings.ts
    - apps/web/src/lib/liveStandings.test.ts
  modified:
    - apps/web/src/lib/eventPricing.ts
    - apps/web/src/components/event/InsightsTab.tsx
    - apps/web/src/components/event/InsightsTab.test.tsx
---

# Quick Task 260921-q2s: Derive live event standings in the browser

Origin: Jacob asked what more could move to the browser to cut staleness and Cloudflare CPU. An
inventory of the live tick found that `rank`, `record` and `rp` on an event's team rows are carried
forward as last published for the whole live event (`apps/worker/src/artifactMerge.ts`, the comment
above the `teams` merge), and are absent entirely on a Worker-promoted stub event. The browser
already polls the artifact every 60 s and already holds every played qualification row, so it now
counts the standings itself. Zero Worker CPU, no schema change, no version bump, no republish.

## What shipped

- `liveStandings.ts`: one pure module deriving win/loss/tie record, ranking point average and
  1-based rank from played qualification rows. Rank is by average ranking points per match,
  descending (TBA's ranking score); the final tiebreak is ascending team number.
- Trigger is `artifact.live !== undefined` and nothing else. The `live` key exists only on
  Worker-written artifacts and the offline publisher strips it, so a finished, republished event
  keeps TBA's official values untouched. A count-based trigger was rejected as unsound (surrogate
  appearances make counted totals exceed TBA's record on ordinary finished events); the module
  header says so.
- Ranking points are all-or-nothing per event: if `rpOutcomeRp` is absent or any played
  qualification row lacks a numeric bonus RP for either alliance, the result is records-only. A
  records-only result is never applied over a published rank.
- Applied once inside `resolveEventArtifact`, wrapped in try/catch, so the event page, match page
  and team pages share one derivation per fetch and an error never blanks a page. The rank
  simulation picks the current values up with no edit to `simulationInputs.ts` (pinned by a test).
- Insights gains a `"live"` order source with one dash-free disclosure sentence saying the order
  can differ from TBA's official one.

## Known divergences from TBA, stated not hidden

Played rows carry no surrogate field and no DQ field, so a surrogate appearance is counted and a
DQ is not zeroed. Tiebreaks past the ranking point average are not TBA's season-specific ones.

## Verification (by printed output)

- `apps/web`: 118 files, 1957 tests passed. One `MetricHistoryTab.test.tsx` timeout under full
  suite load passed in isolation and on a full rerun with no code change (load flake).
- Repo root: 263 files, 5870 passed, 1 pre-existing skip.
- `npx tsc --noEmit -p apps/web/tsconfig.json`: clean.
- `git diff --stat e1530ba4 HEAD` touches only the five files above.

## Deviations

None.

## Needs a human look

Not yet exercised against a real Worker-written artifact: no event has been promoted live since
this landed. At the next live event, check Insights shows the live notice with counted standings
and that the rank simulation's baseline moves with them. Not pushed, not deployed.

## Follow-ups filed from the same inventory

- `.planning/todos/pending/teams-list-live-delta-overlay.md`
- `.planning/todos/pending/tick-normalizes-every-match-every-tick.md`
- `.planning/todos/pending/played-match-band-and-rp-in-browser.md`
