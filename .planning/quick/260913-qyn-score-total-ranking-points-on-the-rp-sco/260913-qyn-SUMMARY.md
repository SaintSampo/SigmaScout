---
id: 260913-qyn
slug: score-total-ranking-points-on-the-rp-sco
description: Score total ranking points on the RP scorecard, then measure and re-ship the reverted win-source and tie-model fixes for SPR (F6/F7 of ranking-points-audit)
created: 2026-09-13
completed: 2026-09-13
status: complete
commits:
  - 757a4723 test: the outcome-arm acceptance bar, committed before any arm was measured
  - 981ed92b feat: inert win-source and discrete-tie inputs
  - 26850c0b feat: total-RP RPS and win/tie/loss Brier on the RP scorecard
  - af3e54e4 fix: fold every record through the arm layers (the identity guard caught a harness bug)
  - 1924c1ff data: arm measurement record, rp-outcome-arms-2026-09.json
  - d2560c97 test: pin the committed record's verdict to a re-applied bar
  - 956c9cef feat: ship WIN+TIE, collapse the measurement seam
  - 1a7cad9b data: rp-calibration-2026-09d.json, repointed
  - 57450e66 feat: Compare RP card figures, dated docs, todo notes
bar_verdict: win ACCEPTED, tie ACCEPTED, win+tie ACCEPTED; shipped win+tie (lowest pooled RPS)
shipped: win+tie
republish_owed: true
worker_deploy_owed: true
---

# Quick Task 260913-qyn: Total-RP scorecard and the F6/F7 fixes, Summary

F6 and F7 of `ranking-points-audit` are closed. The RP scorecard now scores whole ranking points
and the win/tie/loss outcome, not bonuses alone. Both reverted Phase 9 fixes were measured
against that scorer under a bar committed before any figure existed, and both shipped.

## Result

Seasons 2016-2020 and 2022, SPR, pooled. The 2023-2026 slice was refused in code. Lower is
better for both scores.

| Arm | Total-RP RPS | Win/tie/loss Brier | Predicted tie | Observed tie | Verdict |
|---|---|---|---|---|---|
| control | 0.160303 | 0.382046 | 0 | 0.012918 | baseline |
| win | 0.159664 | 0.379872 | 0 | 0.012918 | accepted |
| tie | 0.160185 | 0.381584 | 0.013626 | 0.012918 | accepted |
| **win+tie** | **0.159627** | **0.379769** | **0.013626** | **0.012918** | **accepted, shipped** |

- All six seasons moved in the pooled direction.
- The F6 gap median fell from 0.0274 to 0.0041 and the max from 0.1971 to 0.1585. The residual
  is `pRedWin × pTie` from the proportional split; conditional on a decisive result, the
  identity with the published `pRedWin` is exact.
- Ties are now priced from integer margins, where before they were impossible.

## What changed

- **`analyticPmf.ts` `matchOutcomeDistribution`** uses the caller's `pRedWin` and a discrete
  integer-margin tie probability. It is wired identically at all four call sites that hold a
  prediction: `SigmaScoutLayer#rpFieldsFor`, the Worker's `scheduled.ts`, `stateProbe.ts`, and
  the publisher's pre-schedule pricer. `fieldAveraged.ts` passes neither input, by design.
- **Invariants held:**
  - winner predictions byte-identical (`level1Digest.test.ts` untouched)
  - live equals offline (`scheduled.rp.test.ts` unedited, plus a new tie assertion)
  - bonus half byte-identical to `-09c` in 21 of 21 cells
- The SPR RP digest literal changed with a dated comment naming the arm and record, and a new
  rank-simulation test shows partial tie mass flowing through the draw.
- **`data/baselines/rp-calibration-2026-09d.json`** holds ten seasons with total-RP and outcome
  figures and is now `RP_CALIBRATION_MEASUREMENT_PATH`. `-09b` and `-09c` stay frozen.
- **Compare RP card** (SPR only) leads with plain-language sentences:
  - expected vs earned ranking points per alliance
  - predicted tie chance vs how often matches tied

  Two labelled scores follow, then the unchanged bonus block. A stale artifact without the new
  blocks still renders.
- **Docs and notes:**
  - dated outcome section in `docs/models/rp-layer-config-arms.md`
  - F6/F7 row and decision in the audit marked CLOSED
  - RESOLVED note on `rp-scorecard-measures-bonuses-only`
  - addendum on `compare-rp-scorecard-never-visually-verified`
- **Tests:** root suite 5,187 passed with 1 pre-existing skip. Typechecks `.`, `apps/web` and
  `apps/worker` are clean.

## Deviations

- **The identity guard stopped the first arm run** at `2016waamv_qm60`. The cause was a Task 1
  harness bug: the arm layers folded only qualification matches while control folded every
  record. Fixed in `af3e54e4` before any figure existed; the bar was unchanged.
- **Execution was split into one executor per task**, after the first executor paused on request
  before writing code.
- **One pre-existing assertion was updated.** It pinned the web fixture as bonus-only, and
  refreshing the fixture broke it directly.
- **`compare-rp-scorecard-never-visually-verified.md` is in `completed/`**, so the addendum went
  there.

## Owed, needs Jacob

- **Republish.** Every event's RP pmf, outcome decomposition and presim sidecars change, and the
  Compare card's new figures appear only after it.
- **Worker deploy**, so live ticks price the same way as the publisher.
- **A visual check** of the new Compare card rows once the republish is live. The sandbox could
  not reach the artifact origin.
