---
phase: quick-260929-mcf
plan: 01
subsystem: publisher / web events fetcher / operator tooling
tags: [cancelled-events, publish, r2-cleanup, events-list]
status: complete
requirements: [QUICK-260929-mcf]
key-files:
  created:
    - packages/core/algorithms/cancelledEvent.ts
    - packages/core/algorithms/cancelledEvent.test.ts
    - scripts/pruneCancelledEvents.ts
    - scripts/pruneCancelledEvents.test.ts
  modified:
    - packages/harness/publish.ts
    - packages/harness/publish.test.ts
    - packages/harness/presimRookieRule.test.ts
    - packages/harness/manifests.test.ts
    - packages/corpus/db.ts
    - packages/corpus/db.test.ts
    - apps/web/src/lib/api/events.ts
    - apps/web/src/lib/api/events.test.ts
    - package.json
key-decisions:
  - "One shared import-free predicate isCancelledEvent: zero played matches AND now >= start_date + 4d span + 3d grace (7d total); independent of event type"
  - "Reference instant is always the caller's (publish computedAt, or the artifact's own computedAt); the browser never uses its own clock"
  - "Worker untouched: a manifests invariant test proves a cancelled event can never hold a probe window"
  - "Operator script rewrites events lists by projection (generation preserved), then deletes orphan event artifacts and presim sidecars; dry run by default"
  - "District Locks / Champ Locks left out of scope: 2020 cancelled district events carry real posted Chairman's awards that reservedSlots.ts counts"
actuals:
  tasks: 3
  commits: 3
---

# Quick 260929-mcf: hide cancelled events and skip their compute

One shared `isCancelledEvent` predicate (zero played matches, and start_date + 7 days is before the reference instant) now does three things. It stops the publisher from listing, pricing or writing cancelled events. It filters already-published lists in the browser, using the artifact's own computedAt. It also backs a dry-run-by-default R2 cleanup, `pnpm prune:cancelled-events`.

## Commits
- 2ac9a953: predicate + publisher season-loop filter (tracer)
- 1a68f71e: activeYears / team-page exclusion, Worker invariant test
- d11e8be4: browser filter + operator script + package.json script

## What was built
- **Predicate** (`packages/core/algorithms/cancelledEvent.ts`): `isCancelledEvent`, `EVENT_SPAN_ALLOWANCE_MS` (4 days), `CANCELLED_EVENT_GRACE_MS` (3 days). A non-finite start date or reference instant returns false, so the event stays shown.
- **Publisher** (`publish.ts`): `cancelledEventKeysForSeason` runs once per season. The season loop filters event metadata and scheduled matches together, so a cancelled event gets no list row, event artifact, presim sidecar or upcoming pricing. The probe-window stub rule is unchanged.
- **Corpus** (`db.ts`): `selectTeamKeysForYear` gains optional `excludeEventKeys`. A team seen only in a cancelled event's never-scored schedule gets no activeYears entry, no team page and no Teams-list row.
- **Browser** (`events.ts`): `fetchEventsArtifact` drops cancelled rows at the list's computedAt. This feeds the Events page, search and the year switch.
- **Operator script** (`scripts/pruneCancelledEvents.ts`): rewrites the lists first, then deletes. It refuses when the manifest is not 200, when a list is from a foreign generation, or when an event artifact has played matches or will not parse.

## Deviations
- Seven existing tests used zero-match fixture events at the real clock, so those events now count as cancelled. The fix pins `computedAt` inside each event's span, and the predicate was not loosened. Five of the tests are in publish.test.ts and two in presimRookieRule.test.ts; the latter file was not in the plan.
- `pruneCancelledEvents.ts` reuses `DEFAULT_LIVE_WINDOWS_SEASONS` from `publishLiveWindows.ts`. That import pulls in the corpus module, but no database is opened.

## Verification
- `npx vitest run` from the repo root: 307 files passed, 7150 tests passed, 1 skipped, 0 failed.
- Root `npx tsc --noEmit` is clean. Web `npx tsc --noEmit -p apps/web/tsconfig.json` is clean.
- Non-vacuity check: removing `excludeEventKeys` from the pre-pass makes the frc77 activeYears test fail.
- Nothing changed under apps/worker, scripts/publishDistricts.ts or packages/core/districts.

## Operator follow-up
1. Push, then confirm CI and the Pages deploy. This makes the browser filter live at zero R2 writes.
2. Run `pnpm prune:cancelled-events` (dry run), then add `--execute`. Expect about 430 dropped rows, at most 30 list rewrites and about 440 artifact deletes.
3. Nothing else is owed. The source filter takes effect at the next `pnpm rebaseline`. Until then, 9 never-scored schedules still show as upcoming on some team pages, and 19 teams keep rows.
4. Open question for Jacob: should District Locks hide 2020's cancelled district events? Changing that moves verdicts.

## Self-Check: PASSED
