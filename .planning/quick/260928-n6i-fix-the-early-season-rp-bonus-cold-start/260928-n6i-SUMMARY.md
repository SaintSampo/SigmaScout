---
phase: quick-260928-n6i
plan: 01
subsystem: rankingPoints / harness / measurement scripts
tags: [rp, cold-start, candidate, prereg, bar-R, sigma-carry-retry]
status: complete
requires:
  - 260928-n6i-PREREG.md (locked spec, committed 73259f8d, sha256 5deea93e...)
provides:
  - RpMomentsAccumulatorOptions.rpColdPrior (inert by default)
  - SigmaScoutLayerOptions.rpColdPrior, PublishSeasonsOptions.rpColdPrior, BuildDistrictPricingStateOptions.rpColdPrior
  - measureSigmaCarry --rp-prior-arms (bar R) and --rp-cold-prior (retry)
  - captureCompareSlices --rp-cold-prior, publishDistricts --rp-cold-prior (dry run only)
key-files:
  created:
    - packages/harness/rpColdPrior.test.ts
  modified:
    - packages/core/rankingPoints/empiricalMoments.ts
    - packages/core/rankingPoints/empiricalMoments.test.ts
    - packages/harness/sigmaScoutLayer.ts
    - packages/harness/publish.ts
    - scripts/measureSigmaCarry.ts
    - scripts/measureSigmaCarry.test.ts
    - scripts/captureCompareSlices.ts
    - scripts/captureCompareSlices.test.ts
    - scripts/districtPricingState.ts
    - scripts/districtPricingState.test.ts
    - scripts/publishDistricts.ts
    - scripts/publishDistricts.test.ts
decisions:
  - "rpColdPrior is offline-only: fromBeliefs builds a knob-off accumulator and beliefsByTeam carries no population summary, so the Worker stays the incumbent until a rollout adds the summary to the D1 seed"
  - "Jacob accepted the Sigma-carry bar's Rule A reading (G1 exact equality) before the retry ran"
completed: 2026-09-28
---

# Quick 260928-n6i: RP cold-team prior, then the Sigma-carry retry

**Both pre-registered bars are GO. Nothing shipped.**

## Diagnosis

The pre-event bonus odds read only the RP threshold-variable moments. `RpMomentsAccumulator.momentsFor` skipped a team with no belief. So a roster team that had not played yet this season added a zero mean and no variance, and a fully cold alliance was priced from a degenerate belief (bonus odds near 0). Every match the Sigma carry newly covered had such a team, which is why its G4b bonus Brier (0.174) lost to climatology (0.140).

## The candidate (`rpColdPrior`, one configuration, no numeric parameter)

With the knob on, a cold team contributes the season-to-date league mean share and variance of each variable. A one-observation team takes the league variance in place of 0. Warm teams, the mean shift, win odds and Sigma are untouched. Off is byte-identical.

Commits on `quick/260928-n6i`: 73259f8d (pre-registration), 9d33de86 (candidate), b6498bb3 (bar R instruments), 7543ccc2 (district bake switch).

## Results (full tables in 260928-n6i-RUNLOG.md)

- **Inertness:** a knob-off 2025-2026 dry-run publish is sha256 identical to eb90c0d7 across 24,389 page bodies and 24,430 measured strings.
- **Bar R: GO.**
  - R0 winner figures: EQUAL.
  - R1 played rows: bonus Brier 0.136178 to 0.134220, RPS 0.136805 to 0.136004.
  - R2 pre-event: 0.188425 to 0.188311, RPS 0.159673 to 0.159645.
- **Sigma-carry retry, same bar (sha256 9b83748b...), both arms with the prior: GO.**
  - G4b now passes: bonus Brier 0.132851 against climatology 0.140040, RPS 0.146411 against 0.179949. It wins in both era halves.
  - G1 EQUAL. G2, G3, G4-cover and G4a pass.
  - G5 district bakes: 135/135/108/82/20 with the carry on, against 0/0/1/1/14 off.

## Tests

The full vitest suite from the worktree root: 7053 passed, 4 failed, 2 skipped.
- Three failures are CRLF-only structural tests (rpSeed, sigmaSeed, rp-attribution fence). They pass on LF copies.
- One also fails at 73259f8d: measureAllianceWinProbability's 2026 re-measure, corpus drift from today's ingest.

Root and Worker typechecks are clean. The web typecheck shows only the known missing-routeTree.gen.ts errors.

## Deviation

The bar R unit test appends a repeated event to the 2022 slice. Otherwise its matched set is empty (every later event has a debut team), and the count checks would test nothing. Production code is unaffected.

## What promotion would take (Jacob's decision)

1. Turn both knobs on by default.
2. Bump SPR's version, because RP pmfs, presim sidecars, Sigma and bands all move.
3. Add the RP population summary to the D1 seed and to the Worker's resume path.
4. Republish, reseed, and decide on a Worker deploy.
