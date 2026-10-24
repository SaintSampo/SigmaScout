---
phase: quick-261024-lfa
plan: 01
subsystem: harness/publisher
tags: [2027, roster-only-season, publish, live-windows, d1-seed]
status: complete
requires: []
provides:
  - "packages/harness/rosterOnlySeason.ts: NEWEST_GAME_SEASON, isRosterOnlySeason, selectRosterOnlySeasons (Node-free, for plan 02's web import)"
  - "publish.ts roster-only branch, played-match preflight, forced skip-state, --roster-seasons-only CLI flag"
  - "buildLiveWindowsManifest drops roster-only seasons"
  - "publish:seasons and DEFAULT_LIVE_WINDOWS_SEASONS = 2016-2020,2022-2027"
affects: [plan 02 (web), plan 03 (release command)]
tech-stack:
  added: []
  patterns: ["roster-only season predicate derived from registry absence (newer than every registered component map)"]
key-files:
  created:
    - packages/harness/rosterOnlySeason.ts
    - packages/harness/publish.rosterOnly.test.ts
  modified:
    - packages/harness/publish.ts
    - packages/harness/manifests.ts
    - packages/harness/publish.test.ts
    - package.json
    - scripts/publishLiveWindows.ts
    - scripts/publishLiveWindows.test.ts
decisions:
  - "A roster-only season is any integer season newer than the newest registered component map; 2021 stays a permanent exclusion that still throws"
  - "2027 stays out of the live-windows manifest, enforced inside buildLiveWindowsManifest; no Worker guard (it would need a deploy)"
  - "A run made only of roster-only seasons forces skip-state: no manifest, no seed"
  - "Roster event pages sort by team number ascending, demo keys dropped, metrics {}; no tierCuts"
metrics:
  duration: "about 25 minutes"
  completed: 2026-10-24
actuals:
  tokens: 8800
  tasks: 3
  commits: 3
---

# Phase quick-261024-lfa Plan 01: Roster-only 2027 season in the publisher Summary

The publisher now treats 2027 as a roster-only season. It writes, per algorithm, a 2027 events list with roster team counts, an empty teams list and one roster event page per event. It never carries state into 2027, never seeds D1 from it, never lists a 2027 live window, and refuses to run if 2027 has a played match.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (RED) | f8ad14cf | test(quick-261024-lfa): add failing tests for the roster-only 2027 season |
| 1 (GREEN) | fc56b184 | feat(quick-261024-lfa): publish 2027 as a roster-only season |
| 2 | 3932a662 | feat(quick-261024-lfa): publish:seasons and the live-windows default carry 2027 |
| 3 | none | local corpus only (gitignored); no tracked change |

## What was built

- `packages/harness/rosterOnlySeason.ts`: `NEWEST_GAME_SEASON` (2026, the greatest `BREAKDOWN_REGISTERED_SEASONS` entry), `isRosterOnlySeason`, `selectRosterOnlySeasons`. It imports only the breakdown registry, so the browser can import it.
- `publish.ts`:
  - `publishRosterOnlySeason` (next to `buildProbeStubArtifact`). Per algorithm it writes the teams list (`[]`), the events list (teamCount from the registered roster minus demo keys, matchCount and playedMatchCount 0) and an event artifact for every event. Each event artifact carries identity, the roster sorted by team number with `metrics: {}`, and empty matches and upcoming. There is no `tierCuts`.
  - The season loop sends a roster-only season down this path before `buildSeasonStream`. The carry block and the cross-season seed variables are never reached.
  - A preflight runs after the cancelled-events loop and before any upload: a roster-only season with any played match throws, naming the season and the count.
  - Forced skip-state: when every season in the run is roster-only, no manifest and no seed are written, even without `--skip-state`.
  - CLI `--roster-seasons-only` keeps only the spec's roster-only seasons. It throws when none are left, throws when combined with `--write-budget`, and forces skip-state.
- `manifests.ts`: `buildLiveWindowsManifest` filters roster-only seasons out before the SQL `IN` list. `publish.ts` and `scripts/publishLiveWindows.ts` both call this one builder.
- `package.json` `publish:seasons` and `DEFAULT_LIVE_WINDOWS_SEASONS` now say `2016-2020,2022-2027`. `publish:districts` is unchanged. Both equality pins were edited on purpose. `publish.test.ts` also asserts that every parsed season is either registered or roster-only, and that `selectRosterOnlySeasons(parsed)` equals `[2027]`.
- No registry under `packages/core/` changed (`git diff 6f8bcf61..HEAD -- packages/core` is empty). No algorithm version changed.

## Test results

Task 1 verify (`npx vitest run` from the repo root):
- packages/harness/publish.rosterOnly.test.ts: 7/7 (RED first: 6 behaviour tests failed, 5 of them on `componentMapForSeason(2027)`; the predicate test passed)
- packages/harness/manifests.test.ts: 51/51
- packages/harness/sigmaCarry.publish.test.ts: 2/2
- packages/harness/publish.tracer.test.ts: 4/4
- packages/harness/browserSafeSchemas.test.ts: 18/18

Task 2 verify:
- packages/harness/publish.test.ts: 244/244
- scripts/publishLiveWindows.test.ts: 13/13
- scripts/pruneCancelledEvents.test.ts: 7/7
- packages/harness/publish.rosterOnly.test.ts: 7/7

Root `npx tsc --noEmit` was clean after Task 1 and after Task 2.

## Task 3: ingest and dry run

The orchestrator ran the ingest, not this executor. The log (UTF-16LE) shows `INGEST-DONE`. The event-teams pass reported: "Season 2027: 214 official events (190 populated, 0 null-body, 24 empty-roster, 0 cache hits this run, 0 not-found), 5565 registration rows stored".

Local corpus, read only:
- 216 events in 2027: 61 regional, 129 district, 14 DCMP, 10 DCMP division, 1 offseason, 1 preseason. Start dates run 2027-02-20 to 2027-04-16.
- 190 events have a registered roster (5,565 rows). 0 played matches (the preflight passed).

Dry run: `npx tsx --env-file=.env packages/harness/publish.ts --seasons 2016-2020,2022-2027 --roster-seasons-only --include-offseason --dry-run`, exit 0:

```
publish: season 2027 is roster-only (no registered game rules): 216 event(s), 190 with a registered roster, 3 algorithm(s); no replay, carry, sidecars, as-of, compare, team pages or seed.
publish: summary (generation=e346023e-01e6-425c-9d84-3ee0f4003878)
  objects=654 totalBytes=1742905 (dry-run — nothing uploaded)
  teams: count=3 median=209B p95=209B max=209B key=v1/teams/2027/spr@11.0.0+baseline.json
  events: count=3 median=51614B p95=51614B max=51614B key=v1/events/2027/spr@11.0.0+baseline.json
  event: count=648 median=2676B p95=3566B max=4427B key=v1/event/2027tuis2/spr@11.0.0+baseline.json
  timing: season 2027 roster 0.0s
  timing: total 0.7s
```

The dry run printed no presim, team, manifests or seed-files line. The event count is 3 x 216 = 648.

## Deviations from Plan

1. **Event count is 216, not 218.** The plan's done criterion expected 218 (216 official plus one offseason and one preseason). TBA's 216 already includes the offseason and preseason events (RESEARCH.md "Live TBA facts" agrees), so 648 = 3 x 216 is the correct figure. The earliest 2027 start date is 2027-02-20, not 2027-02-28. That date is still after the January rules work, and no 2027 window is published anyway.
2. **Tracer gate.** Config has auto mode off, which would normally mean a human-verify checkpoint after the tracer task. The orchestrator asked for all three tasks in one run, so the gate was met by re-running the tracer's automated verify (82/82, typecheck clean) before Task 2.
3. **TDD RED commit.** The RED commit holds only the test file, which fails at import because `rosterOnlySeason.ts` did not exist yet. Before committing, the predicate module was created locally to confirm the behaviour tests failed for the right reason. It was committed with the GREEN commit.
4. **Leftover process (not a code change).** A read-only count query I started (`npx tsx -e ...`, PID 13460, background task b9uto1tks) hung and is still running. The permission classifier denied stopping it. It opened the corpus read-only and writes nothing, but it may need to be killed by hand. The counts above came from a second, plain `better-sqlite3` read-only query.

Otherwise the plan was executed as written.

## Known Stubs

None. The `metrics: {}` on roster rows and the empty teams lists are the designed roster-only shape: there is no rating before 2027's rules exist.

## Self-Check: PASSED

- FOUND: packages/harness/rosterOnlySeason.ts
- FOUND: packages/harness/publish.rosterOnly.test.ts
- FOUND: f8ad14cf, fc56b184, 3932a662 (git log)
- No change under packages/core/.
