---
id: early-season-rp-bonus-cold-start
created: 2026-09-28
source: debug presim-bake-rp-filler-refuses (Decision 1, NO-GO on G4b)
priority: medium
---

# The pre-event ranking point bonus model is worse than season-to-date climatology early in a season

## Why this matters

Almost no upcoming district event gets a presim sidecar before late March (0 baked at 2026-03-01, 1 at 03-14, 14 at 04-04). At the "now" position, that sidecar is the only source of an unstarted event's Locks tab predictions.

The Sigma carry candidate (`sigmaCarry`, packages/harness/sigmaCarry.ts, OFF by default) closes that gap completely: 135 events baked at 03-01. But it failed its pre-registered gate G4b. On the matches it newly prices, the RP bonus Brier was 0.174, against 0.140 for walk-forward season-to-date climatology. It failed in 8 of 9 seasons.

Bonus Brier is identical to 17 digits with the carry on and off, so the bonus probabilities do not read Sigma. The weak spot is the bonus model's per-season cold start (the RP accumulator restart), not the carry. This is the debugger's inference, not yet tested directly.

## What to do

1. Confirm what the pre-event bonus probability reads, and why it is worse than climatology on early-season matches.
2. Improve the bonus model itself. No blends, and any new knob must be inert at its default and earn promotion.
3. Retry the carry against the SAME pre-registered bar (sha256 9b83748be0f9c1c59edff6109df74f2c965887e6fefb8d76ab169c6e794ab8f4, recorded in .planning/debug/resolved/presim-bake-rp-filler-refuses.md). The instruments are `scripts/measureSigmaCarry.ts` and `captureCompareSlices --sigma-carry`.
4. If it is GO: SPR version bump, republish, D1 reseed, and an explicit rollout decision from Jacob.

## Also open from the same debug

- G2 passed pooled, but the band was worse in 2019 (0.200 to 0.273) and 2022 (0.060 to 0.146).
- Jacob has not yet signed off on reading Rule A as exact equality of the published winner figures (G1).

## Status (2026-09-28, quick 260928-n6i)

Steps 1 to 3 are DONE, and both bars are GO. The cause was confirmed: a team with no RP history this season added a zero mean and no variance. The fix is the `rpColdPrior` candidate, OFF by default: a cold team takes the season-to-date league summary. It passed its own pre-registered bar. The Sigma carry, retried against the same bar with the prior in both arms, now passes G4b (bonus Brier 0.132851 against climatology 0.140040) and every other gate. Details: `.planning/quick/260928-n6i-fix-the-early-season-rp-bonus-cold-start/`.

Open: step 4, Jacob's rollout decision. It needs both knobs on by default, an SPR version bump, the RP population summary added to the D1 seed and the Worker resume path, a republish, a reseed, and a Worker deploy. The G2 per-season split (2019, 2022 worse) is still unaddressed.
