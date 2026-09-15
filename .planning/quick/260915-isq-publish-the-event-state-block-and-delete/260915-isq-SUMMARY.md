---
quick_id: 260915-isq
status: complete
date: 2026-09-15
commits: [f3f2703f, 1d002fac, 676340c8, d7aa654c, a3186e6f]
requirements: [DATA-04, DATA-05]
republish: deferred to step 3 (Jacob, 2026-09-15)
worker_deploy: deferred to step 3 (Jacob, 2026-09-15)
---

# 260915-isq: Publish the event state block and delete the Worker's upcoming pricing (step 2 of 4)

## Outcome

The SPR event artifact now carries the SPR `state` block, and every event artifact carries
`eventType`. The Worker no longer predicts, bands or prices RP for still-upcoming matches. It writes
those rows schedule-only (keeping `sortTime`) and keeps the block current by splicing in the D1 rows
it just wrote.

An end-to-end test proves exact parity: the browser pricer, run on the block the Worker wrote,
reproduces the offline publisher's upcoming rows with no tolerance.

**Nothing was republished or deployed.** Jacob deferred both to step 3, so the republish, the Worker
deploy and the web switch are verified together.

## What changed

- **Schema (`pageArtifacts.ts`).**
  - `EventArtifactSchema` gains `eventType` (optional) and `state`. A malformed `state` parses as
    absent rather than failing the page.
  - The Worker reads and writes the new `LiveEventArtifactSchema`, whose upcoming rows may be
    schedule-only (strict `EventScheduledMatchSchema`).
  - The web and the publisher stay on `EventArtifactSchema` until step 3 (DD-1).
  - No schema is `.strict()`, so the deployed web ignores the new keys.
- **Splice (`eventStatePricing.ts`).** `spliceEventStateBlock` copies rows verbatim (league first,
  teams sorted) and throws on algorithm, version or shape mismatch.
- **Worker (`scheduled.ts`).**
  - Deleted: the Phase A upcoming loop, `buildEventUpcomingRow`, `toUpcomingMatch` and the upcoming
    prediction and band maps.
  - Unchanged: predict-before-update, played-row band and RP, and the fold. `stateProbe.ts` is
    untouched.
  - Block maintenance: no block for non-SPR or finished events; splice when a block exists; on no
    block, or an invalid one, write without a block and log `event-state-block-missing` or
    `event-state-block-invalid`. The Worker never reads D1 to build a block.
  - Team artifacts: a newly played match now replaces its unplayed row in place instead of appending
    a duplicate.
  - The subrequest estimate is unchanged; `SUBREQUESTS_PER_LIVE_TICK` is still 64.
- **Publisher (`publish.ts`).**
  - `seedStateRows` is one memoized passenger chain that feeds both `emitSeedSql` and every event
    block, so the block rows are the seed rows.
  - `eventType` goes on every algorithm's event artifacts.
  - Blocks attach only for the bundled `spr` module.
  - New log lines report state block counts and bytes.
- **Stale-schedule gate (orchestrator, after the dry run).** `eventScheduleIsCurrent` attaches a block
  only when the event's latest scheduled match is no more than 7 days before the publish, falling back
  to `startDate`. The dry run had put all 146 blocks (5.2 MB) on long-finished events with
  never-played leftover matches, for example 2016flrc with 24 of 28. Against today's corpus the gate
  leaves 0 of 146. Two tests were added and a mutation check was observed failing.
- **Docs and comments.**
  - `docs/worker-operations.md`: the publish-and-seed-as-a-pair contract (including the 7-day rule),
    both warnings, and the pre-season gate paragraph rewritten.
  - The `wrangler.toml`, `wrangler.probe.toml` and migration comments now name `seedSql.ts`.
  - `SimulationTab.tsx`: comment only.

## Existing tests changed

- `scheduled.rp.test.ts`: the upcoming partial-roster RP test was deleted and replaced. That behavior
  is gone, and the old stub never served an upcoming match. The live/offline RP parity test was
  narrowed to played rows; upcoming parity moved to the new end-to-end test.
- `rpSeed.test.ts` and `sigmaSeed.test.ts`: the structural scans were retargeted at `seedStateRows`,
  with the same intent.
- `publish.test.ts`: the state-block describe now pins `computedAt` to its fixture's epoch-ms schedule
  (orchestrator, needed by the stale gate).

## Parity

- **Worker end to end.** 12 teams, an 8-match live event, published at k=4, then three ticks:
  - tick 1 folds one match: 3 rows, one of them mixing touched and untouched teams;
  - tick 2 folds two matches: 1 row carrying rows from both ticks and the publish;
  - tick 3 folds the last match: the block is removed.

  Exact on every priced field.
- **Publisher end to end.** The block deep-equals `buildEventStateBlock` over the captured seed rows.
  The pricer, run on the round-tripped block, reproduces the artifact's own upcoming rows. The seed
  rows equal an independently built chain.
- **Mutations.** Each was observed failing, then reverted:
  - wrong team row spliced;
  - league row skipped;
  - `sortTime` dropped;
  - team row appended instead of replaced;
  - mean-shift passenger skipped;
  - block not gated to SPR;
  - stale gate disabled (orchestrator).

## Dry run (O1, orchestrator)

```
npx tsx --env-file=.env packages/harness/publish.ts --seasons 2016-2020,2022-2026 --include-offseason --presim-from-season 2026 --dry-run
```

This ran before the stale gate existed:

- **Objects:** 108,976, the same as the live generation `3ba2b580`.
- **Bytes:** 3,914,127,424, +5,339,487 over the live generation. That is the blocks (5,230,992 B) plus
  `eventType` on 7,509 event artifacts.
- **Largest event file:** 228,971 B (`2016micmp`), under the 350 KB ceiling.
- **Presim:** 214 sidecars, unchanged.
- **Seed SQL:** opr, epa and spr are byte-identical to the last real run once generation and
  timestamp stamps are normalized, so no published number changes and no version bump is needed.

## Verification

- `npx vitest run` from the repo root: 239 files, 5,334 passed, 1 skipped, 0 failed. The baseline was
  238 files, and its 1 failure (a `MetricHistoryTab` timeout under load) is unrelated and passes.
- Root, web and worker `tsc --noEmit`: all clean.

## Known gaps

- **Pre-existing, now a todo (`live-merge-drops-event-identity-fields`).** `mergeEventArtifact` does
  not spread `existing`, so a live tick drops `name`, `startDate`, `location`, `week` and `alliances`,
  and touched standings lose `rank`, `record` and `rp`. It must land before the gate lifts.
- **DD-1.** Until step 3, a Worker-written artifact with upcoming rows does not parse on the web.
  This is invisible while the gate keeps windows closed.
- **Demo-team beliefs (step 1 gap).** Step 3 must fall back to published fields for demo rosters.
- **Stale probe.** The deployed probe still mirrors the pre-isq tick. Step 4 re-mirrors and
  re-measures it.
