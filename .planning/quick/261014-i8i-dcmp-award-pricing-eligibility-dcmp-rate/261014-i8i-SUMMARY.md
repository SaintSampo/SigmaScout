---
phase: quick-261014-i8i
plan: 01
status: complete
completed: 2026-10-14
commits:
  - d2cc82cb
  - c1cb241e
  - c3b30cbe
  - 27b453de
  - 3481c064
key_decisions:
  - "DCMP awards are priced from a per event slate measured walk forward from real DCMP results, never from the district tier tables at 3x."
  - "DCMP Impact, Engineering Inspiration and Rookie All Star go only to teams eligible at the position under one shared helper (packages/core/districts/dcmpAwardEligibility.ts) that the champ draws and the per event run both read."
  - "Engineering Inspiration has its own drawer row at both tiers."
  - "No version bump, republish, R2 or D1 write, or Worker deploy is owed: no published artifact carries the DCMP slate and no Worker graph file changed."
---

# Quick task 261014-i8i: DCMP award pricing

## What changed

1. **Engineering Inspiration row (d2cc82cb).** The Awards drawer names Engineering Inspiration at both tiers (8 points, 24 at a DCMP). A veteran's rows now account for the whole distribution, and the pays line includes 8 or 24. The unaccounted mass test covers a veteran.
2. **One eligibility helper (c1cb241e).** `dcmpAwardEligibility.ts` holds the rule: a team can win DCMP Impact, EI or RAS only if it won that award at a district event whose awards are final at the position, or by the exact chance it becomes that entrant at a district event still open. `buildChampAwardDraws` reads it with identical output.
3. **Committed scorer (c3b30cbe).** `scripts/scoreAwardModel.ts` (`pnpm score:award-model`) scores the shipped award odds walk forward for 2023 to 2026 per tier, with a district tier digest and three gates.
4. **DCMP slate (27b453de).** `scripts/measureDcmpAwardSlate.ts` measures, walk forward, the judged award count per DCMP role (single, division, finals) and the lifts for who wins. The census found divisions give no Impact, EI or RAS, finals give no judged awards, and no rookie won EI in 2016 to 2026.
5. **Every DCMP caller wired (3481c064).** Live DCMP runs, rewound stops, the simulated DCMP bake, the run signature and the publisher bake all price DCMP awards from the slate. A DCMP run with unposted awards and no slate is refused rather than priced from district tables.

## Before and after (scorer, walk forward, 2023 to 2026)

| Row | Before | After |
|---|---|---|
| DCMP any award, said / happened | 51.9% / 30.9% | 30.3% / 30.9% |
| DCMP any award, Brier / flat guess | 0.2504 / 0.2136 | **0.1909** / 0.2136 |
| Three or more prior awards (n=2666) | 57.9 vs 34.1 | 32.2 vs 34.1 |
| One or two (n=429) | 27.7 vs 11.0 | 15.1 vs 11.0 |
| None (n=149) | 19.8 vs 13.4 | 16.2 vs 13.4 |
| None, rookie (n=194) | 47.9 vs 45.4 | 47.5 vs 45.4 |
| Single DCMP (n=1578), Brier / flat | 0.2478 / 0.2229 | 0.1960 / 0.2229 |
| Division (n=1748), Brier / flat | 0.2529 / 0.1987 | 0.1921 / 0.1987 |
| Finals (n=112), Brier / flat | 0.2468 / 0.2500 | 0.1003 / 0.2500 |
| Mean DCMP award points, model vs real | 8.85 vs 5.29 | 5.12 vs 5.29 |
| Impact expected / on ineligible teams | 78.7 / 45.4 | 73.6 / 0.0 |
| EI expected / on ineligible teams | 161.3 / 140.5 | 56.6 / 0.0 |
| RAS expected / on ineligible teams | 51.4 / 9.7 | 44.0 / 0.0 |
| Real winners (ineligible): Impact, EI, RAS | 82 (1), 62 (1), 49 (1) | same |
| District any award, Brier / flat | 0.2039 / 0.2444 | unchanged |
| District tier digest | 494ac134...5d48e45d65 | equal |

The review quoted the DCMP flat guess as 0.2135; the exact in sample value is 0.2136.

Gates (AFTER run): all three PASS. DCMP Brier below the flat guess; exactly zero Impact, EI and RAS mass on ineligible DCMP team events; district digest equal.

## Verification

- Plan verify set: 74 files, 2445 tests passed, corpus guarded describes ran.
- Full repo root run: 364 of 366 files passed; the two failures were 30 s timeouts under load from other sessions (`measureAllianceWinProbability.test.ts`, `measureDistrictAwardBaseRates.test.ts`, untouched) and passed alone (39 tests). An earlier full run was fully green (366 files).
- Root, apps/web and e2e typechecks clean.
- No Worker import graph file changed.

## Checked and closed

Seasons before 2023 were checked for a regression from the missing slate. There is none: `simulateDistrictEvent` refuses every season outside the declared playoff brackets (2023 to 2026) before award pricing, so pre-2023 Locks runs never priced. Slate tables for 2019, 2020 and 2022 were measured and reverted; the patch is kept outside the repo.

## Follow ups

- `apps/web/src/components/methodology/districtLedgerContent.ts` Awards rows still describe a base rate draw at the DCMP. Another session owned that file during this task.
- `scripts/measureLocksInRange.ts` should pass the stop's `stageByEvent` to `assembleSimulatedDcmpBake`; without it eligibility reads at Now. The champ tier numbers of `measureDistrictCutoff` will move because DCMP pricing changed.
- A division's pays line still reads 15 to 30 though only 15 can happen there, and the Champ DCMP row leaves the finals' Impact, EI and RAS unpriced until posted.
- The finals scorer line rests on the teams that earned points there (n=112), so its "happened" is inflated.
- The slate is registered for 2023 to 2026; re measure before the first 2027 DCMP (the district award tables need the same).
- Out of scope, still open from the review: the 2019 and 2020 stacked awards sold as Impact, the early years decoration drift, and individual awards counting as judged awards.
