---
id: sigma-score-live-worker-divergence
created: 2026-09-10
source: quick task 260910-u7g shipping Sigma Score for BPR; found while wiring the publish path
resolves_phase:
priority: high
---

# BLOCKER BEFORE THE NEXT LIVE EVENT — the Worker still computes Swing bands for BPR

Sigma Score now drives BPR's match bands **in the offline publisher**. The live Worker does not know
about it, and **BPR is the live tier** (`DEFAULT_LIVE_ALGORITHM_IDS = ["bpr"]`,
`apps/worker/src/scheduled.ts:210`).

So during a live event the Worker will fold BPR matches and write `*SwingBandVariance` computed from
the **Swing Factor** accumulator it carries in D1 (shape 10), while every offline-published row for the
same algorithm carries a **Sigma Score** band. The two are not the same quantity and are not the same
size — Swing prints 1.92σ where Sigma prints an honest 1σ, so live-touched matches will show bands
roughly **twice as wide** as the ones around them.

This is exactly the live/offline divergence class this project has been bitten by repeatedly, and it
is silent: nothing throws, both paths look healthy, and the only symptom is that a match updated
during an event disagrees with its neighbours.

## Why it was not fixed in the same task

Closing it requires the Worker to carry Sigma's per-team belief (five numbers plus a talent reading)
instead of, or alongside, Swing's four. That is a `STATE_SNAPSHOT_SHAPE_VERSION` bump (10 → 11), and a
bump **invalidates every live D1 row** by design — `deserializeState` throws
`LeagueRowShapeVersionError` and the only remedy is a full re-seed from a fresh publish.

The developer deferred the republish (2026-09-10), so there is no fresh publish to seed from yet. The
shape bump must ride that republish rather than land ahead of it.

## What has to happen, in order

1. **Republish** with Sigma (the deferred step). Nothing below is possible before it.
2. Add the Sigma belief to the serialized per-team state for BPR; bump the shape version 10 → 11;
   update `stateSnapshot.test.ts`'s "version is N, and 3..N-1 all throw" pin.
3. Teach the Worker's fold to read the band from Sigma for algorithms in
   `SIGMA_SCORE_ALGORITHM_IDS`, exactly as `SigmaScoutLayer` does offline. **Reuse
   `SigmaScoreAccumulator`** — do not re-derive the arithmetic, or the two paths will agree to twelve
   digits and disagree on the thirteenth.
4. **Talent.** The Worker has the algorithm state, so `teamMetrics(state, roster)` gives it the same
   talent the publisher uses. Read it on the same side of the fold the offline path does
   (`SigmaScoutLayer.foldPlayed` applies talent AFTER folding).
5. **Extend `scheduled.replay.test.ts`'s digest to include the band.** It currently digests only
   `pRedWin`/`predictedRedScore`/`predictedBlueScore`, so it would not catch this divergence at all —
   which is why the divergence is possible in the first place. This step is what makes the parity
   claim real rather than asserted.
6. Seed D1 first, deploy second. A deploy carrying shape 11 against un-re-seeded rows takes live
   folding down until the seed runs.

## Interim safety

Until step 2 lands, **do not run a live event on BPR expecting consistent bands**. The per-team Sigma
figure on the teams page is unaffected either way — the Worker's merge spreads `existing` and so
preserves published metric entries (that was fixed in `94b4ccd3`); only the match bands diverge.
