---
phase: quick-260928-spa
plan: 01
status: complete
tags: [ingest, worker, ranking-points, live-offline-parity]
requires: [quick-260928-p8i]
completed: 2026-09-28
---

# Quick 260928-spa: ingest tolerates a per-event TBA 404; the live Worker prices a debut team's first played row

A small follow-up to the SPR 9.0.0 rollout. The fixes were specified and made inline, with no separate planner or executor pass.

## Ingest (e9713910)

- **Problem:** TBA lists 2026cascc in `/events/2026` but answers HTTP 404 for its `/event/2026cascc/matches`. That one event aborted the season ingest, and every `pnpm rebaseline` with it.
- **Fix:**
  - `packages/ingest/perEvent.ts` (`ingestEventsSkippingNotFound`, `isTbaNotFound`): the season loop skips and names a 404ing event.
  - Any other failure still throws.
  - A single `--event` ingest stays strict.
  - The rankings, alliances and awards passes already skipped a per-event 404.
- **Verified live:** `npx tsx --env-file=.env packages/ingest/cli.ts --year 2026` exited 0, with 364 requests (338 cached, 26 fresh). It printed `Season 2026: skipped 1 event(s) TBA answered 404 for: 2026cascc`.
- **Tests:** `packages/ingest/perEvent.test.ts`; the ingest suite passes 238/238.

## Live Worker, debut team (9352a017)

- **Problem:** the played-row partial-roster gate refused any roster team with no RP belief. That conflated a team the tick never loaded with a loaded team that has no history yet. So a team's first played match of a season got no RP odds live, while the offline publisher priced it. Under spr 9.0.0, a cold team contributes the season's league population, not zero.
- **Fix:** the gate now checks that every roster team's state was LOADED this tick (`rpLoadedTeams`: touched plus scheduled teams). The now-unused `rpBeliefs` field on `ResumedAlgorithmState` was removed.
- **Test:** `apps/worker/test/scheduled.rp.test.ts` gains `PP_DEBUT_SET`, which drives a debut team (frc9) through the real Worker. It requires the live played and upcoming rows to equal an offline prior-on `SigmaScoutLayer` replay, and the debut row to carry a pmf the prior moves.
  - It failed against the old gate ("the live Worker withheld the debut team's first played pmf").
  - With the fix, the Worker suite passes 370/370 and the Worker typecheck is clean.
- **Deployed:** Worker version f840bc1d-1b79-4b5c-812b-fc5e53f96b15. No SPR version bump: this brings live output into line with the published spr 9.0.0 model.

## Band calibration (answered, no change)

Pooled over the nine counted seasons, the one-sigma calibration error improves (0.057 to 0.049). Five seasons get worse, mainly 2019 (0.200 to 0.273) and 2022 (0.060 to 0.146), where the band becomes too wide. 2025 and 2026 improve. Jacob is inclined to ignore it.
