---
phase: quick-261024-lfa
plan: 02
subsystem: web
tags: [2027, roster-only-season, default-season, event-page, compare, reveal-rehearsal]
status: complete
requires:
  - "261024-lfa-01: packages/harness/rosterOnlySeason.ts (NEWEST_GAME_SEASON, isRosterOnlySeason)"
provides:
  - "apps/web/src/lib/seasons.ts DEFAULT_SEASON = 2026, kept apart from CURRENT_SEASON (still 2026)"
  - "apps/web/src/lib/seasonGame.ts: isRosterOnlySeason re-export and all roster-only copy"
  - "metricKeysFor answers [TOTAL_KEY] for a roster-only season"
  - "COMPARE_SEASONS drops roster-only seasons"
  - "GameNotOutState in StateViews.tsx"
  - "2027 event page: roster Teams tab, game not out Quals/Playoffs/Simulation, no presim request"
  - "seasonReveal.test.ts: the revealed state rehearsed under a mocked seasons module"
affects: [plan 03 (Teams page, Districts page, reveal handoff)]
tech-stack:
  added: []
  patterns: ["reveal rehearsal: vi.mock the seasons module to CURRENT_SEASON = NEWEST_GAME_SEASON + 1"]
key-files:
  created:
    - apps/web/src/lib/seasonGame.ts
    - apps/web/src/lib/seasonReveal.test.ts
  modified:
    - apps/web/src/lib/seasons.ts
    - apps/web/src/lib/searchParams.ts
    - apps/web/src/lib/metricKeys.ts
    - apps/web/src/lib/api/compare.ts
    - apps/web/src/lib/api/compare.test.ts
    - apps/web/src/lib/metricKeys.test.ts
    - apps/web/src/lib/searchParams.test.ts
    - apps/web/src/routes/__root.test.tsx
    - apps/web/src/components/StateViews.tsx
    - apps/web/src/routes/event.$eventKey.tsx
    - apps/web/src/components/event/TeamsTab.tsx
    - apps/web/src/routes/event.$eventKey.test.tsx
decisions:
  - "DEFAULT_SEASON (2026) is the URL fallback and the season pages open on; CURRENT_SEASON is only the newest listed season"
  - "Roster-only event pages link teams to DEFAULT_SEASON, since a 2027 team page has nothing yet"
  - "The Simulation trigger stays enabled on a roster-only event so a reader can open it and read why"
metrics:
  duration: "about 15 minutes"
  completed: 2026-10-24
actuals:
  tokens: 5800
  tasks: 3
  commits: 5
---

# Phase quick-261024-lfa Plan 02: Web app can list a roster-only 2027 season Summary

The web app now keeps the default season (2026) apart from the newest listed season. Metric keys and Compare no longer break on a season that has no game, and a 2027 event page shows its roster and plain "The 2027 game is not out yet" states without asking for a presim file. The committed `CURRENT_SEASON` is still 2026. Moving it to 2027 has been rehearsed twice against the whole web suite and the web typecheck, and both stayed green.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (RED) | ab0d641f | test(quick-261024-lfa): add failing reveal rehearsal for a roster-only season |
| 1 (GREEN) | e87c67cc | feat(quick-261024-lfa): default season is DEFAULT_SEASON and metric keys tolerate a roster-only season |
| 2 | dab8bc5b | feat(quick-261024-lfa): Compare never lists a roster-only season; default-year tests use DEFAULT_SEASON |
| 3 (RED) | 496e4acc | test(quick-261024-lfa): add failing tests for the 2027 roster-only event page |
| 3 (GREEN) | cce21d61 | feat(quick-261024-lfa): honest 2027 event page with a roster and plain game not out states |

## What was built

- `seasons.ts`: adds `DEFAULT_SEASON = 2026`. `CURRENT_SEASON = 2026` is unchanged; `grep -c "export const CURRENT_SEASON = 2026;"` printed 1 before every commit. The header and docs now say that every SEASONS entry either has a component map or is roster-only, that the default never is, and that `CURRENT_SEASON` is the one line the reveal moves. The file still has no packages/core import.
- `searchParams.ts`: `year` now uses `.catch(DEFAULT_SEASON)`. `KNOWN_SEASONS` still comes from `SEASONS`, so 2027 is accepted exactly when it is listed.
- `seasonGame.ts` (new): re-exports `isRosterOnlySeason` and holds every string the plan named, word for word: `gameNotOutHeading`, the simulation, matches and locks bodies, `gameNotOutTeamsBody`, `rosterOnlyTeamsBanner`, `NO_TEAMS_SIGNED_UP_HEADING` and `noTeamsSignedUpBody`.
- `metricKeys.ts`: a roster-only season returns `[TOTAL_KEY]` before `componentMapForSeason` is called. The registry is unchanged: it still throws for 2027 and for 2021.
- `compare.ts`: `COMPARE_SEASONS` filters out roster-only seasons, and the doc explains why.
- `StateViews.tsx`: `GameNotOutState({ season, body })` is `EmptyState` with the shared heading. It adds no styling.
- `event.$eventKey.tsx`: `rosterOnly` is worked out before the hooks and guarded by `isValidKey`. It is part of the presim gate, so the sidecar query is never turned on for a roster-only season. When the artifact loads, Quals, Playoffs and Simulation show `GameNotOutState`. The 404, error and pending branches are unchanged.
- `TeamsTab.tsx`: for a roster-only season the tab shows only the `teamNumber` and `nickname` columns, sorted by ascending team number. There is no tier key and none of the three notices. Instead there is one `teams-roster-only-banner`, using the same classes and InfoIcon as the existing pending banner. Team links carry `year=DEFAULT_SEASON` through a new `linkYear` argument to `buildTeamsColumns`. An empty roster shows the "No teams signed up yet" state. The non-roster empty copy is unchanged.

## Reveal rehearsal findings

The rehearsal ran twice: once in Task 2 as the plan asked, and again after Task 3. Each time `CURRENT_SEASON` was set to 2027 by `sed` on the working copy, then the full web suite and the web typecheck ran, then 2026 was restored. The rehearsal edit was never staged or committed.

- **Caught (1 test):** `apps/web/src/lib/api/compare.test.ts`, "no longer narrows SEASONS at all". It pinned `COMPARE_SEASONS` to equal `SEASONS` as sets, so it failed once 2027 was listed and Compare (correctly) left it out. The fix: it now compares against `SEASONS` with roster-only seasons removed, and its title and comment say the roster-only season is the one deliberate difference.
- Fixed ahead of the rehearsal (the plan named them): `searchParams.test.ts` (3 assertions) and `__root.test.tsx` (4 assertions) now expect `DEFAULT_SEASON` where they mean "the default year". The `metricKeys.test.ts` registry test now accepts a roster-only entry.
- Rehearsal result with 2027: 154 files, all tests passed (3406 in Task 2, 3412 after Task 3). The web typecheck was clean, and so was the e2e typecheck (checked in Task 2).
- `compare.test.ts:83` and `methodology.compare.test.tsx:164` held at both settings, as the plan predicted. No file outside `apps/web/src` imports `lib/seasons`.

## Test results (committed state, CURRENT_SEASON = 2026)

- apps/web/src/lib/seasonReveal.test.ts: 5/5 (RED first: Tests 2 to 4 failed; the URL fallback was CURRENT_SEASON and metricKeysFor threw)
- apps/web/src/lib/metricKeys.test.ts: 15/15
- apps/web/src/lib/searchParams.test.ts: 31/31
- apps/web/src/routes/__root.test.tsx: 8/8
- apps/web/src/lib/api/compare.test.ts: 8/8
- apps/web/src/routes/methodology.compare.test.tsx: 109/109
- apps/web/src/routes/event.$eventKey.test.tsx: 52/52 (6 new; RED first: the 5 roster-only tests failed and the 2024 presim non-vacuity test passed)
- apps/web/src/components/event/TeamsTab.test.tsx: 88/88
- apps/web/src/components/StateViews.test.tsx: 9/9
- Whole web suite (`npx vitest run apps/web` from the repo root): 154 files, 3412/3412
- `npx tsc --noEmit -p apps/web/tsconfig.json`, `-p apps/web/tsconfig.e2e.json` and root `npx tsc --noEmit`: all clean

## Deviations from Plan

1. **[Rule 1] compare.test.ts pin edited.** This file is not in the plan's file list. The plan's step 5 says to fix every test the rehearsal catches, and this was the only one. It is committed with Task 2 (dab8bc5b).
2. **[Rule 2] Roster-aware Teams skeleton.** While the artifact loads, `TeamsTabSkeleton` now shows only Team # and Team Name and no tier key for a roster-only season. Without this, rating headers would flash in and then vanish. It is in the same file and the same commit (cce21d61).
3. **RED commits carry scaffolding.** The Task 1 RED commit includes `seasonGame.ts` and the bare `DEFAULT_SEASON` constant. Without them the test fails at import, not for the reason under test. Neither changes behaviour by itself.
4. **Extra test assertions.** The Teams roster test also checks that there is no Rank header and no pending banner. The Simulation test also checks that the event artifact itself was fetched, so "no presim" is not just the result of fetching nothing. A 2024 non-vacuity test confirms the Simulation tab still requests its sidecar there.
5. **Tracer gate.** Auto mode is off, so the plan would normally stop for a check after the tracer task. The orchestrator asked for all three tasks in one run, so the gate was met by re-running the tracer's automated verify (56/56 and a clean typecheck) before Task 2.

## Known Stubs

None that block this plan's goal. `GAME_NOT_OUT_LOCKS_BODY` and `gameNotOutTeamsBody` are exported but nothing uses them yet. They are the copy for the Districts and Teams pages, which plan 03 builds.

## Self-Check: PASSED

- FOUND: apps/web/src/lib/seasonGame.ts
- FOUND: apps/web/src/lib/seasonReveal.test.ts
- FOUND: ab0d641f, e87c67cc, dab8bc5b, 496e4acc, cce21d61 (git log 3932a662..HEAD)
- `grep -c "export const CURRENT_SEASON = 2026;" apps/web/src/lib/seasons.ts` prints 1; the working tree is clean apart from the untracked planning directory
- No change under packages/core; no algorithm version changed
