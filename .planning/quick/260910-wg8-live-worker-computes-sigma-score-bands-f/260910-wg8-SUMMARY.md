---
id: 260910-wg8
slug: live-worker-computes-sigma-score-bands-f
description: "Live Worker computes Sigma Score bands for BPR, closing the live/offline divergence"
created: 2026-09-10
completed: 2026-09-10
status: complete
---

# Quick task 260910-wg8 — the live Worker learns Sigma Score

Closes `sigma-score-live-worker-divergence`, except the seed-and-deploy step, which is operational
and rides the republish.

## What shipped

| File | Change |
|---|---|
| `packages/harness/sigmaScore.ts` | `fromBeliefs` / `beliefsByTeam` / `population`, and the exported `SigmaBelief` / `SigmaPopulation` types |
| `packages/harness/stateSnapshot.ts` | `readSigmaBeliefs` / `withSigmaBeliefs` (team rows), `readSigmaPopulation` / `withSigmaPopulation` (league row); shape 10 → **11** |
| `packages/harness/stateSnapshot.test.ts` | shape pin updated; 7 new round-trip tests |
| `apps/worker/src/scheduled.ts` | resumes and persists Sigma beliefs, reads talent, emits Sigma bands |
| `apps/worker/test/scheduled.replay.test.ts` | offline side now drives the REAL `SigmaScoutLayer` |

## The split that is a rule, not a preference

Per-team beliefs go in the **team** rows; the talent prior's population statistics go in the
**league** row. The population is three numbers and does not scale with team count, so duplicating it
across thousands of team rows would be waste — while putting per-team beliefs in the league row would
breach `MAX_LEAGUE_ROW_BYTES`.

Persisting the population is **load-bearing, not an optimisation**: the talent prior is deliberately
withheld until the population is known (`MIN_POPULATION_FOR_TALENT_PRIOR`), so a Worker that resumed
beliefs without it would compute every band from the *flat* prior instead of the talent-scaled one
and disagree with the publisher while looking healthy.

## Ordering, which was the correctness crux

Offline does read-band → fold → apply talent as of after this match. The Worker now does exactly
that: band, `algorithm.update`, fold, then `teamMetrics` on the post-update state. Talent from after
a match is admissible evidence for the team's *next* match and never for its own.

## The test that mattered, and the thing the todo got wrong

The todo claimed the replay digest covered only `pRedWin` and the two scores, so it "would not catch
this divergence at all". **That was wrong.** A band-stream digest already existed, and it caught the
divergence on the very first run.

What it could not catch was a **stale reference**: its offline side hand-rolled a
`SwingFactorAccumulator` rather than driving the `SigmaScoutLayer` the publisher actually uses. So
when the publisher moved BPR onto Sigma, the test kept comparing the Worker against a stand-in for a
publisher that no longer existed. A second implementation of the thing under test can always drift
from it. The offline side now drives the real layer, with the real talent ordering.

**Verified non-vacuous:** with the Worker's Sigma path reverted the test FAILS with
`online (deployed-tick) and offline Match Band streams diverged`. The parity claim is tested, not
asserted.

## Verification

- Full root suite: **242 files, 4512 passed, 4 skipped, 0 failed**.
- Root `tsc --noEmit` clean.
- `stateSnapshot.test.ts` 42/42 including the new round-trip tests and the updated shape pin.
- The replay parity test passes, and fails when the change is reverted.

## CPU

One extra `teamMetrics` call per newly folded match, for Sigma algorithms only. BPR's `teamMetrics`
is a per-team map read plus `state.scale / 3`, not a solve, and idle ticks are untouched. The budget
is genuinely thin, so **measure a real fold tick after deploy** rather than assuming.

## What is left, and it is operational

**Seed first, deploy second.** A deploy carrying shape 11 against un-re-seeded D1 rows takes live
folding down until the seed runs. Both follow the republish:

```
pnpm publish:seasons     # then verify:subset, then seed D1 from the fresh publish, then deploy
```
