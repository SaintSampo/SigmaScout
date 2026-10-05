---
phase: quick-261004-uyc
plan: 02
subsystem: worker live ingestion, official standings, event page notice
tags: [tba-rankings, tba-alliances, event-phase, counted-standings, insights-notice]
status: complete
requirements: [QUICK-261004-uyc]
---

# 261004-uyc plan 02: TBA rankings and alliances as the published standings

## What was built

- **Polling.** `pollEventRankings` and `pollEventAlliances` in `apps/worker/src/tbaPoll.ts`,
  conditional (ETag), gated by event phase.
- **Merges.** `apps/worker/src/officialStandings.ts`: `applyOfficialRankings`,
  `applyOfficialAlliances`, `hasOfficialStandings`. Pure, with a parity test against the offline
  builder.
- **The pass.** `runLiveEventPass` gathers both endpoints by phase, applies them with one artifact
  read and at most one write per algorithm, stores ETags in the reserved `__live_ingest__:<key>`
  cursor row, and logs `rankings` / `alliances` endpoint rows to the ingest log. It runs at a second
  call site before the probe-only early return, so alliance selection is picked up while `/matches`
  answers 304.
- **Official beats counted.** `mergeEventArtifact` skips counting when the artifact already holds
  TBA ranks. An artifact with TBA ranks carries no `standings` marker.
- **Counting fix.** `liveStandings.ts` credited outcome points on top of `actualRedRp`, which is
  already TBA's match total (a 4 became a 7). Each appearance now credits the reported total once.
  `rpOutcomeRp` is no longer an input; `ranked` means every played qual row has a number on both
  sides.
- `parseAllianceRecord` moved to `packages/ingest/alliances.ts` so the Worker can import it.
- **Web.** Insights notice has five states. The "no official TBA ranking" sentence is reachable only
  with a played qual, no ranks and no marker. A pending banner covers the minutes before TBA's
  first rankings. Elims rows render without alliances (pinned by a new test).
- `docs/worker-operations.md`: new section "Official rankings and alliances".

## Commits

- `43c724ea` feat(261004-uyc): TBA rankings polled by event phase and merged into every live algorithm's event artifact
- `6c44bbcf` feat(261004-uyc): TBA alliances polled and merged, counted standings credit TBA's match total once, bracket placeholder pinned
- `c65d5cf8` feat(261004-uyc): the Insights notice says what is true; playoff rows pinned to render without alliances

## Verification (executor reported)

- Root `npx vitest run`: 318 files, 7398 passed, 1 skipped, 0 failed.
- `tsc` clean for apps/worker, apps/web, e2e. Root shows only the 3 known foreign errors.
- Mutation check: disabling the `hasOfficialStandings` guard fails the "rankings survive the next
  fold" test.

## Pins moved on purpose

- `SUBREQUESTS_PER_LIVE_TICK` 68 to 72 (two open events, each polling rankings and alliances).
- `scheduled.test.ts` probe promotion `tbaRequests` 2 to 3; second tick `subrequestsUsed` 8 to 9.
- Counted-standings fixtures rewritten to reported totals.

## Findings

- The bracket placeholder test passed against unchanged code, so an empty alliance side was NOT why
  2026vari's playoff rows were missing during the event. The remaining candidates are the probe
  window not promoting on a 304 and the formerly silent Phase B catch. The ingest log will name the
  cause at the next event.
- While `epa@14.0.0+baseline` is unpublished, the pass skips that algorithm and does not store the
  ETag, so rankings and alliances are fetched in full every tick for open events in a polling
  phase. Publishing epa 14 removes it.
- Counted standings now rank under OPR and EPA too whenever every played qual reports RP.
- `apps/web/e2e/event-live-artifact.spec.ts` asserts the fallback banner on `2025isios`; expected to
  hold, confirm with a live e2e run after deploy.

## Deviations

1. The plan's human checkpoint after Task 1 was replaced by re-running the Task 1 verify end to end.
2. `liveEventPass` takes a required `stamp`.
3. The state blob is persisted whenever its serialised form changes, not only on a phase change.

## Held for the orchestrator and Jacob

- Migration 0003, then the Worker deploy. Live e2e after the Pages deploy.
