---
phase: quick-261014-hx6
plan: 01
subsystem: locks-backtest
tags: [district-locks, backtest, as-of, methodology, in-range]
status: complete
requirements: [261014-hx6]
key-files:
  created:
    - scripts/measureLocksInRange.ts
    - scripts/measureLocksInRange.test.ts
  modified:
    - scripts/measureDistrictCutoff.ts
    - scripts/measureDistrictCutoff.test.ts
    - apps/web/src/components/methodology/districtLedgerContent.ts
    - apps/web/src/components/methodology/districtLedgerContent.test.ts
    - apps/web/src/components/districts/predictedCutoff.ts
commits: [8c115cf2, 990b267d, bad55efa]
actuals:
  tasks: 3
  commits: 3
---

# Quick 261014-hx6: Rebuild the Locks backtest on the as-of path Summary

The District Locks cutoff backtest now prices every position through the live tab's own as-of chain (loadAsOfRewind, assembleAsOfDistrictEvents, runAsOfEvent). The methodology page quotes the re-measured figures: 1.2 points against 2.4 for the midpoint rule over 205 positions of 48 district seasons, with the range holding the settled cutoff at 183 of 205 (89%).

## Why

The old backtest priced open events from the stored per row predictions (made after every earlier result) and priced alliance and playoff cells from `teams[].metrics` (ratings at publish time). At season start that priced a week 5 event with odds that already knew weeks 1 to 4. The published sentence said "predicted only from the matches already played", which was not true of that measurement. On the as-of path it is.

## What changed

**Task 1 (commits 8c115cf2 tracer, 990b267d expansion).**
- `scripts/measureDistrictCutoff.ts` has one pricing path, the as-of one. The stored odds pricing, `startMatchKeyAtPosition` and `teams[].metrics` are gone from executable code.
- An origin cache under `data/local-publish/origin-cache` (gitignored) mirrors the R2 keys. An offline miss throws a named error, a 404 is stored as a marker, and a version guard refuses an artifact at another version.
- Shards (`--shard k/n`), one atomic result file per district season, `--dry-run`, `--fetch`, `--force`, and `--report`, which refuses an incomplete set.
- Seven leak checks per scored position: the three row checks plus four as-of checks (REAL rows strictly after the cut, baselines at or before the cut, played playoffs at or before the cut, GENERATED requests carrying no rows or ratings).
- New `scripts/measureLocksInRange.ts`: season start In range to locked at end, both Locks tabs, same path; the champ side runs the simulated DCMP bake. Report only, never published.
- Gate bars unchanged, re-registered unchanged 2026-10-14 before the run.

**Task 2 (orchestrator, main context).** Fetch: 1,107 objects (70 MB), 0 not published, 0 failed. Both scripts ran in one process each (no shards needed: 1,198 projected bakes at about 160 ms) to 48 result files at spr@11.0.0+baseline. Reports are in `data/local-publish/locks-backtest/spr@11.0.0+baseline/` (txt and json).

**Task 3 (commit bad55efa).** The published District Locks cutoff sentence, source note 9, the rewound view note, the test pins and both script headers carry the measured figures. `predictedCutoff.ts` changed in comments only.

## The run (spr@11.0.0+baseline, 1,000 draws, seed 20260830)

| | Old stored odds path (2026-10-07) | As-of path (2026-10-14) |
|---|---|---|
| Positions / seasons | 203 / 47 | 205 / 48 |
| Simulated MAE vs settled cutoff | 1.15 | 1.25 |
| Midpoint rule MAE | 1.77 | 2.43 |
| Range held the settled cutoff | 181 of 203 (89.2%) | 183 of 205 (89.3%) |

- Gate 1 PASS (1.25 < 2.43). Gate 2 FAIL, above the 72% to 88% band, as the old run also was. Overall NO-GO; the range stays shown with its coverage quoted (the champ ruling).
- Leak checks: all 7 at 205 of 205.
- Pricing at scored positions: 0 REAL, 1,194 GENERATED, none unavailable. Every open event at a week end stop is unstarted, so the backtest exercises the bake, not the REAL as-of pricer.
- Not scored: 48 settled positions, 1 excluded team fallback (2024chs, from 2024mdsev's frc0 roster entry), 0 no call, 0 seasons skipped.
- By position, simulated against midpoint MAE: season start 1.8 vs 3.5, after week 1 1.6 vs 2.5, week 2 1.0 vs 2.4, week 3 0.9 vs 2.0, week 4 0.7 vs 1.5. The simulated line beats the midpoint rule at every stop with more than two positions.
- The leak barely moved the cutoff line (0.1 point). It moved the midpoint rule more (1.77 to 2.43), because the midpoint reads the same median projections the pricing builds.

In range at season start, ended locked (report only, never published), pooled from summed counts:

| Tab | Old path | As-of path |
|---|---|---|
| District | 82.6% (2,650 of 3,207), points only 72.1% | 73.9% (2,338 of 3,165), points only 63.2%, 37 ties at the line |
| Champ | 85.0% (612 of 720), points only 66.8%, estimate path | 65.6% (582 of 887), points only 50.6%, 2 ties, simulated DCMP bake |

The per team calls lost far more than the line did: hindsight sharpened each team's projection, while the line is an aggregate that errors average out of. Champ In range never exceeded the championship slots (887 In range against 1,184 slots summed).

## Deviations from Plan

**Task 1 executor run**
- Three `useDistrictLedgerData.ts` helpers (attachRequestFacts, divisionedDcmpBracketFacts, securedElimForRequest) are restated in the script rather than imported: the module pulls an `@/` alias through AlgorithmSelect and cannot load in Node. A sha256 digest test fails if the hook's copies change. No web edits.
- The REAL event test uses a mid event stop at `2026wabon_qm40`; the fixture has no REAL event at a week end.
- The in-range fixture leaves the 2026pncmp rows unstamped (no 2026pncmp event artifact in the fixture).
- The tracer gate was self checked rather than stopped for a human check.

**Task 3 executor run**
- `predictedCutoff.ts` was edited (comment only) because its comment named the retired run as the tab's own backtest.
- Source note 9 says "above the band" rather than a count of positions above the ceiling.

**Orchestrator**
- No shards: the probe measured 157 ms a bake, so the whole run took about 4 minutes in one process.

## Verification
- `npx vitest run` on districtLedgerContent.test.ts, predictedCutoff.test.ts, measureDistrictCutoff.test.ts and measureLocksInRange.test.ts: 4 files, 75 tests passed.
- `npx tsc --noEmit -p .` and `npx tsc --noEmit -p apps/web`: 0 errors each.
- Published sentence carries no dash characters; no e2e spec pins the old figures.

## Open
- Not pushed. Local main also holds other sessions' unpushed commits (261014-i1c, 261014-i8i), and a push deploys them too.
- 2026isr reads TBA week 17 and 18 for its events, which shows up as an "After week 17" position. Not investigated.

## Self-Check: PASSED
Commits 8c115cf2, 990b267d and bad55efa exist. The report JSON figures match the published copy.
