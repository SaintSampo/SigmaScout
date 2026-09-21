---
id: tick-normalizes-every-match-every-tick
created: 2026-09-21
source: tick inventory during quick task 260921-q2s (Jacob's staleness and Worker CPU push)
priority: medium
---

# The tick normalizes and re-stringifies every match at the event, not just the new ones

On every tick where TBA returns a 200, `processEvent` (`apps/worker/src/scheduled.ts`, around the
`tbaMatchListSchema.parse` call) parses the whole 150 to 400 KB match list, then maps
`normalizeMatch` over ALL of it. `packages/ingest/normalize.ts` runs
`JSON.stringify(match.score_breakdown)` per match, so roughly 80 to 120 breakdowns are
re-stringified each tick, including every match already folded. `foldObservedRp` then
`JSON.parse`s the raw breakdown again for the newly played ones.

**None of this has ever been measured.** The state probe covers Phase A and Phase B only; the CPU
todo says so ("no TBA parse"). At the roughly 15 microseconds per KB cold that the event half
measured, this could be several milliseconds, comparable to terms that got whole quick tasks.

## Direction

Output-identical: split on the cursor using cheap raw fields first, and run the full normalize
(and the breakdown stringify) only on matches past the cursor. Upcoming rows need schedule fields
only. The sort contract (`compareCorpusMatchOrder`) must still see every match key and time.

## How to prove it

Add a probe arm that feeds a realistic raw TBA body through the current and the trimmed path, and
pre-register the bar as a within-run difference between the two arms (absolute `cpuTime` is not
reproducible on this instrument). This is not a browser move; it is on the list because it may be
one of the larger unpriced terms in `rp-fold-exceeds-worker-cpu-budget`.
