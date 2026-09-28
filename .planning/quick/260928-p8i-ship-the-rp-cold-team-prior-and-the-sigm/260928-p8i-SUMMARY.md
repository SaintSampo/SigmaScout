---
phase: quick-260928-p8i
plan: 01
subsystem: spr-level2-rp-sigma
status: complete
tags: [spr, ranking-points, sigma, worker, d1-seed, presim, district-bake, rollout]
requires: [quick-260928-n6i]
provides:
  - "SPR 9.0.0: the RP cold-team prior and the Sigma carry are the production model"
  - "STATE_SNAPSHOT_SHAPE_VERSION 17: sigmascoutRpPopulation on the spr league row"
  - "presim sidecars apply the carry's rookie rule"
  - "published RP scorecard re-measured as data/baselines/rp-calibration-2026-09g.json"
decisions:
  - "Jacob: the rookie rule applies to presim sidecars too; upcoming rows (publisher and Worker) keep per-alliance Sigma gating"
  - "Jacob: push everything on main after the rollout verifies"
  - "The layer is the policy point for rpColdPrior (default on, false opts out); the carry defaults on in the two season loops that own a carry"
  - "Opt-outs are --no-sigma-carry / --no-rp-cold-prior (dry run only on publishDistricts)"
completed: 2026-09-28
---

# Quick 260928-p8i: ship the RP cold-team prior and the Sigma carry as SPR 9.0.0

## Commits

| Commit | What |
|---|---|
| a1b9ed7a | RP population rides the D1 seed and the live Worker (shape 17) |
| 54b6cf30 | Both knobs are the production default; presim rookie rule; every instrument arm is explicit; two pins re-pinned |
| 9189a319 | SPR 8.0.0 to 9.0.0; comments and docs describe the shipped model; methodology limitations row |
| 7865e8d1 | The published RP scorecard is re-measured under spr 9.0.0 as -09g |

## What was built

**Shape 17.**
- `RpMomentsAccumulator.populationState()` and `fromBeliefs(rule, beliefs, { population })`, a season-tagged, all-or-nothing restore.
- The `withRpPopulation` / `readRpPopulation` league passenger.
- `seedStateRows` carries the passenger. The Worker resumes the prior ON with the population, grows it as it folds, and writes it back.
- The worst-case spr league row is 1662 bytes, against a 16384 byte limit.

**Production defaults.**
- The layer's `rpColdPrior` defaults on. publishSeasons and the district bake default both knobs on.
- Presim sidecars rate a no-Sigma roster team by the rookie rule, read at the sidecar's own instant. The pre-event arm freezes the ratings in its snapshot.
- Upcoming rows are unchanged.

**SPR 9.0.0.**
- Follows 30128c60: the constant, a changelog paragraph, the softCredit pin, and the level1 digest version string only. Every `predictionStreamSha256` is unchanged.

**Pins.** Two re-pinned, each justified in 54b6cf30: `PINNED_RP_DIGESTS.spr` and `PINNED_BONUS_HALF_DIGEST`. On the 2022 slice, 43 of 265 played rows move. Both old values reproduce with the prior off.

**RP scorecard.**
- -09f (measured at spr 6.0.0, no prior) is replaced by -09g. It uses the same command and records the shipped RP layer, and its label adds `coldTeam=league-season-to-date`.
- A rerun gave identical records.
- Like -09f, the replay starts each season cold, so it does not include the carry. The carry's RP effect is about 2e-5 in RPS (n6i G3).
- Per season, bonus Brier mostly improves. 2017's second bonus (0.0762 to 0.0778) and 2018's first (0.2118 to 0.2124) worsen.

## Verification at the rollout HEAD (9189a319 code; 7865e8d1 changes only the scorecard file)

- **Rule A:** `captureCompareSlices --no-sigma-carry --no-rp-cold-prior` against the default gives byte-identical output (sha256 1022dd2b..., 90 slices). This is the same digest as n6i's captures.
- **G5**, knob on against `--no-sigma-carry`, with the prior on in both:
  - Carry on: 125 / 125 / 98 / 72 / 14. Off: 0 / 0 / 1 / 1 / 9. At 03-01 / 03-05 / 03-14 / 03-21 / 04-04. PASS.
  - The absolute counts are lower than n6i's (135 / 135 / 108 / 82 / 20 against 0 / 0 / 1 / 1 / 14) because this HEAD includes n2h's district bake fixes (1fff4919, e015e48d).
- **Tests:** the full suite from the worktree root shows 7096 passed and 5 failed.
  - 3 files fail only on CRLF (rpSeed, sigmaSeed, rp-attribution fence). They pass on LF copies.
  - The known measureAllianceWinProbability 2026 re-measure fails from corpus drift.
  - The measureRpCalibration and publish test files pass after the -09g change.
- **Typechecks:** root and Worker are clean. Web shows only the routeTree.gen.ts errors.

## Residuals

- **Debut team, live vs. offline.** The Worker's `rpKnownTeams` gate still withholds a debut team's first played RP pmf live. Offline, the prior prices it. The gap lasts until the next republish. This is by plan.
- **Field-averaged path.** Under the prior, `measureFieldAveragedRanks` scales cold and thin teams per alliance, not per team. It is measurement-only; recorded in preSchedule.ts and field-averaged-presim.md.
- **Band split.** The G2 per-season band split (2019, 2022 worse) is still open.

## Rollout

See 260928-p8i-ROLLOUT.md.
