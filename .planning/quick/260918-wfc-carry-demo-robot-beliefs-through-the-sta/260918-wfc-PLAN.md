---
quick_id: 260918-wfc
phase: quick
plan: 01
type: execute
autonomous: true
serves_todo: seed-state-rows-drops-demo-beliefs
files_modified:
  - packages/harness/stateSnapshot.ts
  - packages/harness/stateSnapshot.test.ts
  - packages/harness/eventStatePricing.parity.test.ts
  - packages/harness/publish.ts
  - apps/worker/src/scheduled.ts
  - apps/worker/test/scheduled.test.ts
  - apps/web/src/lib/eventPricing.lazy.ts
  - scripts/measureReplayParity.ts
---

# 260918-wfc: carry demo robot beliefs through the state rows

## The defect

`withSigmaBeliefs` and `withRpBeliefs` inject a level-2 belief into an EXISTING level-1 team row and
drop it when there is none. SPR keys every demo robot (`frc9970` to `frc9999`) as
`DEMO_PSEUDO_TEAM_KEY` at level 1, while the Sigma and RP accumulators keep a belief under each raw
demo key. So those beliefs never reach the D1 seed or any event `state` block. Measured on
`2026auwarp` by 260917-mwu: 13 Sigma and 6 RP beliefs dropped. `seedStateRows` claims live and offline
are equal by construction, and for an offseason event with a demo robot they are not. The gap is
pinned as KNOWN GAP in `eventStatePricing.parity.test.ts`.

Found while planning, same cause: the live tick builds its D1 selection from `realTouchedTeams`, which
strips demo keys and never adds the pseudo-team key. So for a demo match the tick resumes neither the
demo beliefs nor SPR's own pseudo-team row, and prices that alliance from a fresh pseudo team.

## The decision, and why this side of it

The todo left two directions: drop demo beliefs deliberately on both sides, or carry them. Dropping
them offline changes published match bands and RP odds for every offseason match with a demo robot,
which is a model change needing a version bump. Carrying them changes no published number: the offline
publisher already prices from them. This task carries them.

## Tasks

1. **Harness, test first.** `withSigmaBeliefs` and `withRpBeliefs` append a passenger-only team row,
   stamped from the league row, for every belief whose key has no team row. Appended rows are in
   ascending key order. Every algorithm deserializer skips a team row that carries no level-1 fields,
   so a passenger-only row never becomes a team. Round trip pinned in `stateSnapshot.test.ts`. The
   KNOWN GAP case in `eventStatePricing.parity.test.ts` flips to full parity on the demo match.
   `seedStateRows`'s doc comment states the rule.
2. **Worker, test first.** The state selection for a fold is `stateBlockScopeKeys(touchedTeams)`: the
   raw keys plus the pseudo-team key when any is a demo key. Cold-start `initState` still receives
   real keys only. Team artifacts and standings keep `realTouchedTeams`. A driven-tick test on a demo
   match pins that the pseudo-team row is read and that a demo robot's belief survives the write-back.
3. **Callers that worked around the gap.** `eventPricing.lazy.ts` and `measureReplayParity.ts` each
   say why they step around demo rows. Correct what is no longer true.
4. **Orchestrator, network.** Republish, commit the budget doc, seed SPR, deploy the Worker, then
   check a live offseason demo event's `state` block carries passenger-only rows for its demo keys.

## Guards

- No published played-row number may change. `level1Digest.test.ts` and the publish parity tests are
  the proof. No algorithm version bump.
- `STATE_SNAPSHOT_SHAPE_VERSION` is not bumped: the rows are additive, and a reader that predates
  this change reads a passenger-only row's beliefs correctly by key.
- Full suite from the repo root, all three typechecks, judged by output.
