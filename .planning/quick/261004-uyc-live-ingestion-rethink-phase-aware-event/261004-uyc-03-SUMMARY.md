---
phase: quick-261004-uyc
plan: 03
subsystem: offseason ranking points, live Sigma on the event row, spr 10.0.0
tags: [offseason-rp, event-type-99, live-sigma, spr-10, rp-calibration-10a]
status: complete
requirements: [QUICK-261004-uyc]
---

# 261004-uyc plan 03: offseason is a base tier RP event, live Sigma on the event row, spr 10.0.0

## What was built

- **One table entry.** `EVENT_TYPE_TIERS` maps 99 to `base` in
  `packages/core/rankingPoints/constants.ts`. Every gate reads `isRpEligibleEventType`, so the
  layer, publisher rows, upcoming pricer, EPA, and the tick's RP fold all flip together. Type 6
  (Festival of Champions) stays unmapped and still throws.
- **Live and offline agree.** The tick and the offline layer produce the same RP pmf streams for an
  offseason match under SPR and EPA; the parity test passed with no source fix.
- **No RP carry, pinned.** `packages/harness/offseasonRpCarry.test.ts` proves nothing RP crosses a
  season boundary, so what offseason play teaches is discarded before the next season. Offseason
  matches therefore FOLD into RP beliefs, mirroring ratings.
- **No pre schedule sidecar for offseason** (explicit gate in `buildPreScheduleSidecarForEvent`), so
  the sidecar set and publish time are unchanged.
- **Live Sigma.** `mergeEventArtifact` takes an optional `liveSigma`. A published entry with a
  percentile is never replaced; otherwise the tick's end of tick Sigma Score is written as a bare
  value, untiered. Wired through Phase B, schedule only pricing and the roster pass. The Sigma tier
  is a rating window rank the Worker cannot compute, so the live pill is untiered until a republish.
- **Version.** `SPR_VERSION` is `10.0.0+baseline`. Level 1 digest hash unchanged (only the version
  string moved). EPA stays 14.0.0 (never published), OPR stays 6.0.0, state shape stays 18.
- **Calibration re-issued** as `data/baselines/rp-calibration-2026-10a.json`.
- Stale statements corrected in `verifySubsetPublish.ts` (8 offseason spr entries now expect
  `partial` pmfs), `SimulationTab.tsx`, two test titles, `apps/web/e2e/simulation-tab.spec.ts` S1,
  and `docs/worker-operations.md`.

## Commits

- `558adb9f` feat(261004-uyc): offseason is a base tier RP event, priced and folded identically live and offline
- `585546ec` feat(261004-uyc): the tick writes a live Sigma on the event row when no published one exists
- `3515159f` feat(261004-uyc): spr 10.0.0 for offseason ranking points, RP calibration re-issued as 10a, stale statements corrected

## Verification (executor reported)

- Root `npx vitest run`: 319 files, 7447 passed, 1 skipped, 0 failed.
- `tsc` clean for apps/worker, apps/web, e2e; root shows only the 3 known foreign errors.
- Mutation check: forcing `liveSigma: undefined` in Phase B fails 3 of 4 new Sigma cases.

## Calibration: what folding offseason RP moves

Only 2026 moves (offseason event `2026isrtp`, 19 matches, precedes 77 official 2026 events). Every
other season is identical for both algorithms. 30,352 scored bonus observations each.

| alg | bonus        | meanPredicted before | after   | Brier before | after   |
|-----|--------------|----------------------|---------|--------------|---------|
| spr | energized    | 0.62942              | 0.62952 | 0.19341      | 0.19327 |
| spr | supercharged | 0.05065              | 0.05073 | 0.05655      | 0.05649 |
| spr | traversal    | 0.00183              | 0.00182 | 0.00120      | 0.00120 |
| epa | energized    | 0.54393              | 0.54441 | 0.17753      | 0.17726 |
| epa | supercharged | 0.06913              | 0.06983 | 0.05491      | 0.05467 |
| epa | traversal    | 0.01318              | 0.01317 | 0.00230      | 0.00230 |

Pooled bonus Brier: spr 0.08372 to 0.08366, epa 0.07825 to 0.07808. Win odds and outcome Brier do
not move.

## Deviations

1. The tracer checkpoint was replaced by re-running the tracer verify end to end.
2. `StartMatchPicker.test.tsx` test title edited beyond the plan's file list (it stated a now false fact).
3. `verifySubsetPublish.ts` and the e2e spec were changed without being run (both read production).

## Held for the orchestrator and Jacob, in order

1. If `epa@14.0.0+baseline` is live at republish time, bump EPA to 15.0.0 first. If 13.0.0 is still
   live, no bump.
2. Apply D1 migration 0003 from `apps/worker`.
3. `pnpm rebaseline` (Worker deploy BEFORE publish; the tier table is bundled into the Worker).
   Commit `docs/publish-budget.md` afterwards.
4. Push, `gh run list`, verify the deploy with an Origin header or a real browser.
5. Live e2e from the main context. `simulation-tab.spec.ts` S1 is red until the republish.
6. Open `/event/2026vari?algorithm=spr`: TBA order with no banner, Sigma on team rows, eight
   alliances, Elims rows, working Simulation tab. Then `pnpm verify:subset`.
7. After the next live event: `pnpm live:report <eventKey>`.
