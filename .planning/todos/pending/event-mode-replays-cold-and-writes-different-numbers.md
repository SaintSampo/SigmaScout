---
id: event-mode-replays-cold-and-writes-different-numbers
created: 2026-09-09
source: measured while fixing the SigmaScout-layer strip in `--event` (41dbbe2d) — the strip fix landed, and exposed this larger one underneath
priority: high
---

# `publish.ts --event` writes different numbers than the full publish, for every field

Fixing the band/RP strip made this measurable, and it is the bigger problem.

`--event` replays its season **cold**. `pnpm publish:seasons` runs
`--seasons 2016-2020,2022-2026` and threads carry state across every season boundary
(`seasonBoundaryFor`, `records.carryStates`). So the full publish arrives at 2026 carrying ten
seasons of learned per-team state; `--event 2026casnv` arrives knowing nothing.

**Measured 2026-09-09** against the live `bpr@1.0.0+baseline` artifact for `2026casnv`:

| field | result |
|---|---|
| `pRedWin` | **86 of 89 rows differ** |
| `pRedWin` on `qm1` | `--event` says `0.5`, the live publish says `0.055` |
| `redSwingBandVariance` | differs on essentially every banded row |
| `redRpPmf` / `blueRpPmf` | differs wherever a band differs |

`0.5` is the cold-start coin flip. This is not a rounding difference.

## Why this matters more than the strip did

The strip removed fields, which is at least visible as absence. This **replaces good numbers
with worse ones** and the artifact looks completely normal afterward. `--event` is described in
its own header as "the single-event republish path (how a live-event artifact is refreshed)" —
so the one job it exists for is the job it does damage in.

Note the divergence is **upstream of the SigmaScout layer entirely**. The band and RP are
computed identically by both paths now (that is what 41dbbe2d fixed and what
`publish.test.ts`'s parity suites pin). They differ here only because they are downstream of
predictions that differ. Nothing about this is fixable inside `sigmaScoutLayer.ts`.

## Not new, and previously disclosed

`runEventMode`'s own header has said so since plan 07-09:

> this mode still carries no CROSS-SEASON state (no season-boundary threading), so a value it
> writes is close to but not identical to what a full seasons run produces

"Close to but not identical" understates it. `0.5` vs `0.055` on a match's win probability is
not close, and the header's reassurance that "that full run overwrites every key it touches"
only holds until the next full run actually happens.

## Options

1. **Thread the seasons.** Replay from the cold-start season through the target season, exactly
   as `publishSeasons` does. Correct and exact. Costs roughly ten season replays instead of one
   — call it minutes, not the current ~20 seconds. `--event`'s speed premise dies.
2. **Reuse the full publish's carry state.** Persist per-season end state as an artifact during
   `publish:seasons`, and have `--event` load the prior season's state instead of replaying to
   reach it. Keeps `--event` fast and makes it exact, at the cost of a new persisted artifact
   and the staleness question that comes with it. This is the interesting option.
3. **Delete `--event`.** It has one caller (an operator at a terminal) and a full publish is the
   supported path. Deleting a write path that cannot match the primary one is not obviously
   worse than maintaining two.

## Until it is fixed

**Do not run `publish.ts --event` on an event you care about.** It will overwrite that event
with cold-start numbers. `pnpm publish:seasons` is unaffected and remains the correct full path.
