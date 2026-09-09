---
id: single-event-publish-path-drops-the-sigmascout-layer
created: 2026-09-09
source: found while wiring ranking points into publish — the `--event` path mirrors publishSeasons' orchestration locally and did not get the new fields
priority: high
---

# `publish.ts --event` strips the swing band (and now RP) from the event it republishes

`publish.ts` has **two** orchestrations. `publishSeasons` (line ~2035) is the full multi-season
path; `--event` (line ~3060) is "the single-event republish path (how a live-event artifact is
refreshed)", and its own header says it **mirrors that orchestration locally**.

The mirror is now incomplete. The SigmaScout-layer accumulators live only in `publishSeasons`:

| field | `publishSeasons` | `--event` |
|---|---|---|
| `redSwingBandVariance` / `blueSwingBandVariance` | yes | **no** |
| `redRpPmf` / `blueRpPmf`, `redBonusRp` / `blueBonusRp` | yes (2026-09-09) | **no** |
| `swingFactor` (per team) | yes | **no** |

So **running `--event` on an event silently deletes that event's bands** — and, once RP lands, its
ranking-point distributions — until the next full `publish:seasons`. Measured 2026-09-09: a
`--event 2026casnv --algorithm bpr --dry-run` produced a byte-identical artifact with and without
the RP wiring, which is what exposed this.

This is the same defect shape as the Worker's lossy merge (`live-match-updates-swing-and-lossy-merge.md`
defect 1, fixed in `94b4ccd3`): a second write path that reconstructs rows field-by-field and
therefore drops whatever the primary path learned to emit. **It is my own regression** — the band
was added to `publishSeasons` alone on 2026-09-08.

## Why it is not just "add the accumulator there too"

The accumulators are WALK-FORWARD over a season's whole chronological match stream. `--event`
replays one event, so it has no history for a team's earlier events and would produce a *different*
band than the full publish does for the same match — a live/offline-style divergence between two
offline paths.

Two honest options, and the choice is a real one:

1. **Replay the season up to that event** inside `--event` before emitting, so the numbers match
   `publishSeasons` exactly. Correct, and slower — `--event` exists precisely to be the fast path.
2. **Have `--event` preserve what it cannot recompute**: read the existing artifact and carry
   forward each match row's already-published band/RP fields rather than emitting nothing. Cheap,
   and it makes `--event` non-destructive without claiming to recompute. It does mean a genuinely
   new match in that event gets no band until the next full publish.

Option 2 mirrors what the Worker's merge fix does and is probably right for a path whose whole
purpose is speed. Option 1 is right if `--event` is ever used to *correct* published numbers.

## Until it is fixed

**Do not run `publish.ts --event` on an event you care about.** It will strip that event's bands.
`pnpm publish:seasons` is unaffected and remains the correct full path.
