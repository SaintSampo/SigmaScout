---
id: 260913-qyn
slug: score-total-ranking-points-on-the-rp-sco
description: Score total ranking points on the RP scorecard, then measure and re-ship the reverted win-source and tie-model fixes for SPR (F6/F7 of ranking-points-audit)
created: 2026-09-13
status: incomplete
reason: Paused at Jacob's request ("get to a stopping point soon") before any code was written. The executor spent its run reading the plan and every file Task 1 touches.
commits: []
bar_verdict: not measured (no arm code exists; the bar must land as its own commit before any arm figure is produced)
shipped: nothing
republish_owed_by_this_task: false
---

# Quick Task 260913-qyn: Total-RP scorecard and the F6/F7 arms, Summary (PAUSED)

**Nothing changed.** No edits, no commits, no measurement. The plan
(`260913-qyn-PLAN.md`) is complete and unchanged. Resume with:

```
/gsd-quick resume score-total-ranking-points-on-the-rp-sco
```

## Resume from: Task 1, Step 1 (the bar, as its own first commit)

1. Re-check the files other sessions had dirty. The list has already changed once:
   `git diff --ignore-cr-at-eol --stat -- packages/harness/publish.ts packages/harness/publish.test.ts packages/core/algorithms/spr.ts data/baselines/level1-digest-2026-09.json docs/publish-budget.md`.
   `analyticPmf.ts`'s foreign diff landed as `ff69badf`. `publish.ts` carried 260913-nvn's
   refactor at read time: `BASE_PUBLISH_ALGORITHMS` now reads `PUBLISHED_ALGORITHM_MODULES` from
   `manifests.ts`, and the `--rp-calibration`/`--no-rp-calibration` flags and `coldStartSeason` were
   removed. `toIntegerRpOrNull`, `attachRpCalibration`, `loadRpCalibrationMeasurement` and
   `RP_CALIBRATION_MEASUREMENT_PATH` were still present.
2. In `scripts/measureRpCalibration.ts`, add the exported `ArmName` type, the `ArmPooledFigures`
   interface and the pure `applyRpOutcomeArmBar`, doc-commented as the pre-committed bar for
   260913-qyn, dated 2026-09-13:
   - an arm is accepted only when BOTH pooled total-RP RPS and pooled outcome Brier are strictly
     lower than control's
   - ship the accepted arm with the lowest RPS; break ties on lower Brier, then in the fixed order
     win, tie, win+tie
   - WIN+TIE ships only when it is itself accepted; with none accepted, ship `control`
   - a count mismatch against control throws, and so does a non-finite figure
3. Test it in `scripts/measureRpCalibration.test.ts`: accept and reject cases, ship selection,
   both throws, and the tie-break order. Commit ONLY those two files as
   `test(260913-qyn): commit the outcome-arm acceptance bar before any arm is measured`.
4. Then Task 1 Steps 2 to 4 as the plan specifies.

## Notes the executor verified for resuming

- **Scores.** `RPS = (1/maxRp) · Σ_{k=0}^{maxRp-1} (cdf(k) − [actual ≤ k])²` with
  `maxRp = pmf.length − 1`. Outcome Brier is the three-term squared error against a one-hot
  `[red, tie, blue]` vector. Both were hand-checked against the plan's examples (0.0625, 1, 0.26,
  1.26).
- **Types.** `Prediction.matchOutcomePmf` is `[pRedWin, pTie, pBlueWin]`
  (`packages/core/algorithms/types.ts`). `MatchResult.winner` is `red`, `blue` or `tie`.
  `redRpEarned`/`blueRpEarned` are `number | null`, converted by `publish.ts`'s private
  `toIntegerRpOrNull`, which needs exporting.
- **If WIN ships, four call sites need the `pRedWin` passthrough:**
  - `packages/harness/sigmaScoutLayer.ts` `#rpFieldsFor`
  - `apps/worker/src/scheduled.ts`, the `rpFieldsFor` closure (~line 1136)
  - `apps/worker/src/stateProbe.ts`, the `rpFieldsFor` closure (~line 587)
  - `packages/harness/publish.ts` `makeRankingPointFiller`, the pre-schedule pricer (~line 820)

  `fieldAveraged.ts`'s `fieldAveragedMatchPmf` passes neither input and must stay that way (plan
  design point 6).
- **TIE.** It belongs in `matchOutcomeDistribution` (`analyticPmf.ts`, `RpOutcomeInput`), behind
  optional `discreteMarginTie` and `pRedWin` inputs, inside the `varianceD > 0` branch only.

## Not affected by the pause

`2be153a1` (the SPR RP scorecard baseline `-09c`) is committed and independent of this task. The
next republish carries it, and that republish was already owed from 260913-it4.
