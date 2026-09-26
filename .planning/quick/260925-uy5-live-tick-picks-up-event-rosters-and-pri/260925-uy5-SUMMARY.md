---
quick_id: 260925-uy5
date: 2026-09-25
description: >-
  Live tick picks up event rosters and prices a posted schedule before the first
  score: a schedule-only Phase B, a conditional /teams/simple poll per open
  window, and a roster_etag column to make it cheap
status: complete
---

# The tick before the first score

A promoted event whose schedule is posted but unscored no longer writes nothing.
An empty fold with a non-empty schedule now runs the fold path's own state read,
accumulator resume, pricing model and Phase B merges (priced upcoming rows, the
event artifact, and a team artifact per real scheduled team) with no
`algorithm_state` write and no claim. And every open live window now costs one
extra conditional `GET /event/{key}/teams/simple` per tick, whose ETag lives in a
new `event_cursor.roster_etag`, appending the teams TBA says are registered with
their real numbers and names.

Both changes apply to probe (`inferred: true`) and measured (`inferred: false`)
windows alike. Roster pass first, then the match preflight, so a schedule-only
write sees the roster rows already merged. A combined-ordering test asserts on
the LAST put for the key.

Why: seven offseason events on 2026-09-25/27 (2026miwyo, 2026nhgc, 2026flroc,
2026njrr, 2026vaale1, 2026wass, 2026isist) were all serving the 2026-09-23 stub
with zero teams and zero upcoming rows although TBA already listed rosters for
four of them and a 42-match schedule for 2026isist. The tick's early return on an
empty fold, and the absence of any roster fetch, were the cause.

## Task 1: the roster poll and the column that makes it cheap

Commit `9de166c1`.

- `packages/ingest/schemas.ts`: `tbaEventTeamsSimpleResponseSchema`, a nullable
  array of the existing `tbaTeamSchema` (Zod strips the keys `/simple` omits).
- `packages/ingest/tbaClient.ts`: `fetchEventTeamsSimple`, in
  `fetchEventMatches`'s shape, non-validating.
- `apps/worker/src/tbaPoll.ts`: `pollEventTeams` returning the existing
  `TbaConditionalBody` union, plus `TbaEventTeamsPollError` (event key only).
- `apps/worker/migrations/0002_event_cursor_roster_etag.sql`:
  `ALTER TABLE event_cursor ADD COLUMN roster_etag TEXT;`. SQLite has no
  `ADD COLUMN IF NOT EXISTS`, so the file is once-only under Wrangler's own
  migration tracking. A seed that deletes and reinserts cursor rows loses the
  etag benignly.
- `apps/worker/src/stateStore.ts`: `EventCursor.rosterEtag` REQUIRED so the
  compiler named every construction site; both SELECT lists and the UPSERT carry
  it; new `writeEventRosterEtag`, a narrow `UPDATE ... SET roster_etag,
  last_polled_at` plus an insert-if-absent fallback. It exists because
  `writeEventCursor` would roll `last_folded_match_key` back on a roster write
  racing a concurrent fold. `claimEventAdvance` never names the column.
- `scheduled.ts` and `districtRefresh.ts`: default-cursor literals gain
  `rosterEtag: null`.

Tests: `pollEventTeams` 304 / 200 / 500 / no-key-leak; `roster_etag` round-trips
null and set; `readEventCursors` carries it multi-key; `writeEventRosterEtag`
leaves `last_folded_match_key`, `tba_etag` and `last_advanced_at` untouched.

## Task 2: schedule-only pricing

Commit `261276ad`.

Extracted first, verbatim, out of `processEvent`: `fetchEventTypeAndWeek`,
`resumeAlgorithmState` (the per-algorithm Phase A prefix in the same order with
the same calls) and `upcomingModelOf`. The fold path calls all three and is
otherwise untouched. `resumeAlgorithmState` also returns `rpBeliefs` so the fold
path avoids a second `readRpBeliefs` pass.

Then `runScheduleOnlyPricing`, reached when `newlyFolded` is empty and
`stillUpcoming` is not: no `claimEventAdvance`, no `writeScopedState`, no
`teams/{year}` feed, `mergeEventArtifact` with empty folded rows,
`mergeTeamSeasonArtifact` with `matches: []` per real scheduled team, the fold
path's `upcoming-pricing-failed` warn-then-rethrow verbatim. The poll-etag write
moved AFTER the successful writes so a throw leaves TBA answering 200 next tick
instead of 304 for a schedule that was never priced. `EventOutcome` gains
`"priced"`, handled before `eventsConsidered++`; `TickResult` gains
`eventsPriced`.

Tests (`scheduled.phaseBWrites.test.ts`): `eventsPriced` 1 with
`eventsAdvanced` and `eventsConsidered` 0; non-empty priced `upcoming` with real
win odds; one team artifact per real scheduled team with an empty played list;
zero D1 batch writes; no claim statement; no `teams/{year}` put; the `tba_etag`
IS written on that tick; a throwing `predict` writes no artifact and no etag.

`scheduled.rowParity.test.ts`, `scheduled.mergePreservation.test.ts`,
`scheduled.replay.test.ts`, `scheduled.rp.test.ts` and
`scheduled.officialRecord.test.ts` all passed UNMODIFIED at this commit: the
extraction's parity proof.

## Task 3: the roster pass

Commit `7a036706`.

- `artifactMerge.ts`: `RosterTeamRow`, optional
  `MergeEventArtifactParams.rosterRows`, appended after the touched-team append,
  filtered to teams in neither `existingTeams` nor `touchedTeams`, sorted by
  `teamKey` in the merge. Standings counting unchanged.
- `scheduled.ts`: a memoized `algorithmContext()` inside `runTick` (manifest
  read, `buildModules`, `readTickState`, mismatch detection, in today's order
  with today's spends). `runRosterPass` runs over ALL live windows after
  `runProbes` and before the probe-only early return: ONE `readEventCursors`
  for the tick, then one conditional poll per window inside its own try/catch
  (`roster-failed`, event key and message only). 304 does nothing; an empty or
  null 200 writes the etag only; a 200 with teams loads the algorithm context,
  and on a generation mismatch writes nothing at all (not even the etag), warns
  `roster-suspended` once and ends the pass. Per algorithm: read the event
  artifact, and only for missing teams `resumeAlgorithmState` + `teamMetrics` +
  `mergeEventArtifact` with `touchedTeams: []` and
  `upcoming: existing?.upcoming ?? []` (load-bearing: `upcoming` is an override
  key). No team artifact, no `teams/{year}` feed. Roster etag written LAST.
  `TickResult` gains `rostersPolled` and `rosterTeamsAppended`.
- Fakes: a `/event/{key}/teams/simple` branch answering 304 by default at all 11
  stub sites across six test files.

Recomputed absolute counter pins, each term named in a comment:
`liveAlgorithmTier.test.ts` `subrequestsUsed` 6 to 8; `scheduled.test.ts`
UNBOUNDED `1 + 2n` to `2 + 3n`; promotion test `tbaRequests` 1 to 2;
`scheduled.stateBaseline.test.ts` probe-only `selectCallCount` 1 to 2;
`scheduled.rp.test.ts` `SUBREQUESTS_PER_LIVE_TICK` 64 to 67 (two windows: 1
cursor read + 2 polls). The probe `r2.getCallCount === 1` assertions stayed 1,
proof the lazy context load does not fire on a 304 roster.

## Verification (repo root, output read)

- `npx vitest run apps/worker`: 21 files, 367 tests passed (re-run by the
  orchestrator after hand-back: 21 files, 367 passed)
- `npx vitest run`: 293 files, 6675 passed, 1 skipped
- `npx tsc --noEmit -p apps/worker/tsconfig.json`: clean
- `pnpm --filter web typecheck`: clean
- `npx tsc --noEmit` (root): clean

## Deviations from plan

Two plan-written test premises were wrong about pre-existing behaviour. The test
was corrected, never the code, and each correction is documented in the test.

1. "existing rows survive byte-identically": that fixture's artifact HAS played
   matches, so `withCountedStandings` (260923-3w7) recounts `rank`, `record` and
   `rp` on every roster row. The assertion now compares `teamKey`, `teamNumber`,
   `nickname`, `metrics` and order.
2. "nothing played means no standings marker": also false for that fixture, and
   a registered-but-unplayed team is legitimately given a counted 0-0-0 record and
   last rank. The case now asserts the difference between two merges, with and
   without `rosterRows`.

Deliberately excluded, not oversights: upgrading an existing `teams` row whose
`nickname` is empty (a republish heals it; appends only), and the schedule-only
team write dropping `percentile` through `touchedEventTeamMetrics` (the tracked
`live-merges-drop-percentiles` limitation, now biting when the schedule posts).

## Steady-state cost

One extra TBA conditional request per open window per tick, plus one subrequest
per tick for the roster pass's single `readEventCursors`.

## Operator steps (main context, after the code commits)

1. `cd apps/worker && npx wrangler d1 migrations apply sigmascout-state --remote`
   BEFORE deploy: until the column exists, every cursor SELECT in the new Worker
   errors.
2. `cd apps/worker && npx wrangler deploy` from a clean tree.
3. One-time, so the seven stalled events re-poll instead of 304ing:
   `UPDATE event_cursor SET tba_etag = NULL WHERE last_folded_match_key IS NULL`
4. Confirm from a live tick that `rostersPolled` and `eventsPriced` are non-zero
   and that 2026isist serves a 42-row `upcoming` with a real roster.
