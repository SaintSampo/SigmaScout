---
id: rp-scorecard-measures-bonuses-only
created: 2026-09-12
source: read off the live 2025 compare slice while answering "what was 2025 RP accuracy, broken down"
priority: medium
---

# The published RP scorecard measures bonus RP only — win and tie RP have no accuracy anywhere

`ranking-points-audit`'s **F1** ("RP accuracy never reported") is marked **CLOSED** on the strength
of the calibration scorecard. That closure is **partial and currently reads as total.**

## What the scorecard actually contains

Read live from `v1/compare/2025.json`, `slices[0].rpCalibration`, generation `622eeb28`:

```
scoredCount 88,926   (29,642 alliance-sides per bonus)
```

| Bonus | meanPredicted | observedFrequency | Brier |
|---|---|---|---|
| `autoBonus` | 0.178993 | **0.625464** | 0.395855 |
| `coralBonus` | 0.007206 | **0.176877** | 0.168798 |
| `bargeBonus` | 0.227891 | **0.440085** | 0.239283 |

Three bonus entries. **That is the whole block.** There is no win-RP entry and no tie-RP entry.

## Why that is a gap and not a nitpick

A season's RP total is `winRp` (3 in 2026) + `tieRp` (1) + one point per bonus. **Win RP is the
single largest component of the total**, and the published scorecard says nothing about how well it
is predicted. Win accuracy exists as a separate site-wide number (~78% for 2025), but that is
scored on *match winner*, not on *ranking points awarded* — they diverge on ties, which is exactly
the case tie RP exists for and exactly what nothing measures.

So a reader of the Compare page sees "RP calibration" and gets a bonus-only view, with the biggest
term absent and unlabelled as absent.

## What the numbers above also confirm

**All three 2025 bonuses under-predict, badly** — `coralBonus` by ~25×, `autoBonus` by ~3.5×,
`bargeBonus` by ~1.9×. That is `rp-bonus-probabilities-are-severely-under-predicted` visible in
production, and these are the post-`622eeb28` figures on `bpr@3.0.0`. Recorded here because the
question "what was 2025's RP accuracy" now has a citable answer.

## The work

Either extend the scorecard to cover win and tie RP, or **label the block honestly as bonus-only**
on the page and in `ranking-points-audit`'s F1 row. The second is minutes and removes the
overstatement; the first is the real fix.

Do not simply reopen F1 — the scorecard is real and shipped. Narrow its claim.

Related: [[ranking-points-audit]], [[rp-bonus-probabilities-are-severely-under-predicted]].
