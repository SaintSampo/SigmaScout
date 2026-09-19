---
status: complete
quick_id: 260918-wfc
serves_todo: seed-state-rows-drops-demo-beliefs
commits:
  - 80b3be80
  - 7696001a
  - dd936308
  - 225a445a
live: generation e96213ff-cbf9-4515-83df-cd3f878233f0, SPR D1 seed, Worker d9cd475f (2026-09-19 UTC)
---

# 260918-wfc: carry demo robot beliefs through the state rows — Summary

Two defects with one cause, both for a match that has a demo robot (`frc9970` to `frc9999`), so
offseason events only. Neither changed a published number.

## Defect 1, the one the todo named

`withSigmaBeliefs` and `withRpBeliefs` injected a level-2 belief into an EXISTING level-1 team row
and dropped it when there was none. SPR keys every demo robot as `DEMO_PSEUDO_TEAM_KEY` at level 1
while the Sigma and RP accumulators key it raw, so those beliefs never reached the D1 seed or any
event `state` block (13 Sigma and 6 RP on `2026auwarp`, measured by 260917-mwu).

Fixed in `80b3be80`: both helpers go through one `injectTeamPassenger`, which appends a
passenger-only team row for a belief whose key has no row, ascending by key and stamped from the
first row. Every algorithm deserializer skips a team row whose keys all start with `sigmascout`, so
such a row never becomes a team. The parity test's pinned KNOWN GAP flipped to exact equality on the
demo row, band and ranking points included.

## Defect 2, found while planning

The live tick built its D1 selection from `realTouchedTeams`, which strips demo keys and never names
the pseudo-team key. So for a demo match it resumed neither the robot's beliefs nor the pseudo-team
row SPR predicts it from, priced that alliance from a fresh pseudo team, and wrote the restarted rows
back over the seed. Both failures were reproduced in a test before the fix:

| What the failing test saw | Value |
|---|---|
| seeded Sigma belief weight 50, after one tick | **1** (restarted) |
| pseudo-team rating after a tick, seeded at 0 and at 40 | **0.6296664285730381 both times** (never read) |

Fixed in `7696001a`: the read uses `stateBlockScopeKeys(touchedTeams)`, the rule the published state
block is already built by. Cold start still receives real keys only, so no demo key seeds a level-1
row. After the fix the belief reads 49.1 (it decays slightly and adds one match) and the two
pseudo-team ratings differ. The state probe mirrors the call and its pinned Phase A call set gained
it, which is what that pin is for: it failed until the probe was re-mirrored.

## The decision taken

The todo left two directions: drop demo beliefs deliberately on both sides, or carry them. Dropping
them offline would change published match bands and RP odds for every offseason match with a demo
robot, which is a model change needing a version bump. Carrying them changes nothing published,
because the offline publisher already priced from them. This task carried them. No version bump, and
`STATE_SNAPSHOT_SHAPE_VERSION` stays 16: the rows are additive and keyed the way readers already read.

## Callers that had worked around the gap (`dd936308`)

- `apps/web/src/lib/eventPricing.lazy.ts` kept a demo row's published prices and withheld that match's
  team row, because the pricer could not reproduce them. It now can, exactly, so the row is priced
  like any other and a demo robot's teammates get their upcoming row.
- `scripts/measureReplayParity.ts` keeps `droppedPassengers` as the instrument that would catch the
  drop returning, with its comments dated.

## Verification

- Full suite from the repo root after the change: 253 files, 5722 passed, 1 skipped, 0 failed.
- Root, worker and web `tsc --noEmit`: clean.
- Red first: three harness tests and both Worker tests failed before their fix, for the predicted
  reason. One Worker assertion was wrong, not the code: it assumed a resumed belief's weight can only
  grow, and Sigma beliefs decay. It now separates resumed (about 49) from restarted (exactly 1).
- Mutation: disabling the deserializer skip fails two tests. That matters because those two passed
  vacuously before any row was appended.

## Shipped

Republish `e96213ff` (108,976 objects, the same bytes as `2c518101`: state blocks attach only to events
with upcoming matches, none of which has a demo robot, so no published artifact changed). The SPR seed
gained 28 passenger-only demo rows, 6,284 to 6,312 rows in D1, read back by generation and spot-checked
(`frc9970` holds `sigmascoutSigma` only, the pseudo-team row holds level-1 state). The first `--file`
import failed with auth error 10000 and the identical re-run landed (25,220 rows written). Worker
`d9cd475f` deployed from a clean tree at `225a445a`; two scheduled ticks `ok`, no exceptions.

## Not observed

Both ticks were idle. No live window is open, so the widened state read has never run in production,
the same standing caveat as 260918-16t. The web change is committed and unpushed.
