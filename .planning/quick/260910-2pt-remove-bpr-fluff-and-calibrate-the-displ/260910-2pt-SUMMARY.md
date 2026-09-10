---
task: remove-bpr-fluff-and-calibrate-the-displayed-variance
quick_id: 260910-2pt
status: complete
date: 2026-09-10
type: implementation
follows: 260910-25c
design_era_only: true
holdout_spent: none
retune: none
prediction_neutral: true
prediction_fingerprint: 8f6cdb71fe7a40297c0dd4bb823d52477053982abedb5b691c248cec62f6c289
version_bump: bpr 1.0.0+baseline -> 2.0.0+baseline
provides:
  - display-time variance calibration, sd(z) 0.7052 -> 0.9987 on the design era
  - removal of seasonShrink (pinned at its identity value) and a write-only field
  - two corrected docstrings that had asserted the opposite of what the code does
affects:
  - packages/core/algorithms/bpr.ts
  - packages/core/algorithms/bpr.test.ts
  - packages/bpr/model.ts
requires_republish: true
metrics:
  duration: ~40 min
  completed: 2026-09-10
---

# Quick Task 260910-2pt: Remove BPR fluff, calibrate the displayed variance

**The interval is now honest and the prediction is provably untouched.**

## The load-bearing proof

The whole justification for fixing this at display time is that the sealed
78.05% must still describe the shipped module. So that was proven, not asserted:
the port was replayed over all 83,095 design-era matches before and after the
change, hashing every `pRedWin` at full double precision.

```
  BEFORE   8f6cdb71fe7a40297c0dd4bb823d52477053982abedb5b691c248cec62f6c289
  AFTER    8f6cdb71fe7a40297c0dd4bb823d52477053982abedb5b691c248cec62f6c289
```

**Bit-identical.** Every win probability, every winner call, unchanged. That
also independently confirms the `seasonShrink` removal was the identity it
looked like.

## The calibration

Fitted by weighted least squares over design-era deciles (166,188
alliance-observations, 2016-2022 only):

```
  sd(z) = 0.7058 + 0.0844 * (mu - 3)      clamped to [0.4, 1.3]
```

Applied as `c(mu)^2` to `variance`, `redScoreVarianceOwn` and
`blueScoreVarianceOwn`, and to nothing else. Measured through the **shipped
port**, reading the emitted fields exactly as `publish.ts` does:

| | before | after |
|---|---|---|
| overall `sd(z)` on the emitted variance | **0.7052** | **0.9987** |
| by season-relative strength (Q1..Q5) | 0.664 0.696 0.707 0.699 0.723 | 1.057 1.030 0.995 0.940 0.916 |

The published `X ± Y` was ~1.42x too wide and is now right on average.

**Stated honestly: the residual is not flat.** The quintiles now run 1.057 down
to 0.916 instead of sitting at 1.0. A straight line in `mu` cannot absorb the
whole trend — the top decile jumps (sd(z) 0.878 against 0.740 in D9) and the
linear fit under-corrects there while over-correcting at the bottom. This is a
large improvement over a 0.66-0.72 band that was uniformly ~40% too wide, not a
complete fix, and the clamps are pure safety rails that bind nowhere in
2016-2022 (observed `c` spans 0.477-1.136).

## Fluff removed

- **`seasonShrink`** — frozen at 1.0, so `p.seasonShrink * muL + (1 - p.seasonShrink) * 1.0`
  was the identity, while reading as though a yearly shrink toward league average
  happened. Gone from `BprParams`, `BPR_PARAMS` and `carrySeason`.
- **`this.year`** in `packages/bpr/model.ts` — assigned once, never read.
- **Two false docstrings**, replaced with what the code and the frozen fit
  actually do:
  - "Anti-additivity ... three elite scorers do not add linearly" → the
    renormalized weights are **super-additive for every alliance** (up to 1.234x),
    a spread amplifier, with the worked table and both known artifacts (the
    step-function ordering, and the driver-station tiebreak) documented.
  - "Slow *true talent*" / "current form" → an **annual re-baseline plus a
    6.6-match memory**, with the steady-state numbers that show 92.5% of each
    update landing in the component zeroed every season boundary.

`tau0` was left in place: at 1.0 it is an initial condition, not a no-op branch.
`TeamMetrics.spread` was left alone — it is the algorithm's own confidence and
never reaches the screen (2026-09-09 decision), so it is not a displayed interval.

## Version

`BPR_VERSION` **1.0.0+baseline → 2.0.0+baseline**. MAJOR under D-13 because
`predict()`'s observable output changed — every interval BPR has published moves.
The `baseline` paramSetName is kept deliberately: this is a display transform
fitted on design-era innovations, not a tuned parameter file, and
`applyPromotedOverrides` still never touches BPR.

## Verification

- `npx tsc --noEmit` — clean. `npx tsc --noEmit -p apps/web/tsconfig.json` — clean.
  (Both run, because root `tsc` does not cover `apps/web`.)
- `npx vitest run` from the repo root — **234 files, 4,294 passed**, 3 new tests
  added to `bpr.test.ts` pinning the calibration boundary.
- **No parameter changed.** `git diff` touches no value in `BPR_PARAMS` and
  `frozen-params.json` is untouched (still exactly 1 commit).
- Design era only; `innovations.ts`'s holdout guard was never bypassed.

### Pre-existing red, confirmed not mine

Two files fail, and both were verified by stashing these edits and re-running:

| file | failures | cause |
|---|---|---|
| `packages/gbr/seal.test.ts` | 1 | `expected 20408 to be 20297` — the 2026 corpus grew by 111 rows from a backfill. An equality pin failing loudly, as designed. GBR is shelved. |
| `packages/harness/digest.test.ts` | 5 | stale VPR digest fixtures whose `scoreBreakdownRaw` JSON key order differs from the corpus. VPR is retired. |

Neither is touched by this change and neither was fixed here — both belong to
the corpus-backfill and VPR-retirement threads.

## NOT DONE — the republish

**This has not reached the site.** R2 still serves `bpr@1.0.0+baseline` artifacts
carrying the old, too-wide intervals. A republish is required for the fix to be
visible, and it is an outward-facing operation that was deliberately left for an
explicit go-ahead rather than run off the back of a code change.

## Deviations from Plan

None. One judgement call recorded: the plan allowed removing `tau0` as fluff and
I did not, because an initial condition pinned at 1.0 is not the same thing as a
code path that reduces to the identity.
