---
phase: quick-261014-qje
plan: 01
status: complete
completed: 2026-10-15
commits:
  - 905cf67a
  - 24f2b21b
  - 735fcfdd
  - 2038230e
  - d86ffd57
  - 32a9cb4e
  - d9af2dc1
key_decisions:
  - "One award model prices district events and District Championships (Jacob 2026-10-14: no separate models per tier). Only who can win each award differs by tier."
  - "Pass bar approved by Jacob before any scoring (905cf67a). Gates 2 and 3 failed; Jacob saw the numbers and accepted both, since gates 1 and 4 to 7 pass."
  - "Jacob approved re-pinning exactly two outside test values."
  - "District artifacts carry awardModelVersion 2.0.0; the per team award blocks are no longer published."
---

# Quick task 261014-qje: one award model for district events and District Championships

District events and District Championships are now priced by one award model (`packages/core/districts/awardSlate.ts`). Each event gives an expected number of each award, and those awards are shared among the teams that can win them by measured class weights. The Champ Locks cutoff draws pick award winners the same way. The per team base rate and ordering model is gone.

## What changed

- **Five award slots:** Impact (10 points, any team), Engineering Inspiration (8, veterans), Rookie All Star (8, rookies), Rookie Inspiration (5, rookies; last given 2024), and every other point paying team award (5, any team). A team keeps its single highest award.
- **Counts follow FIRST's list:** an event's count of each award comes from the most recent earlier season, summed only over the awards on that season's declared list. A season with no declared list is refused.
- **No repeats:** a team that won Impact, Engineering Inspiration or Rookie All Star at an earlier district event cannot win the same award again that season. Today's model let about 200 team events per award do so.
- **DCMP:** those three awards go only to district winners of the same award.
- **Decoration count:** wins of the 18 point paying team award types at any event, over every earlier season, published as `priorJudgedAwards`. Individual awards no longer count.
- **Champ Locks draws:** same class weights; the weighting knob is gone; the tuning grid is 10 settings, regenerated walk forward.
- **Version stamp:** district artifacts carry `awardModelVersion: "2.0.0"`; a digest test pins the slot map, season lists, point values and tables to it.
- **Methodology pages** describe the one model with figures from the AFTER runs only.

## Pass bar (approved before scoring; BEFORE is the shipped model)

| Gate | BEFORE | AFTER | Verdict |
|---|---|---|---|
| 1 District any award Brier | 0.203886 | 0.198555 | PASS |
| 2 Class calibration gap (frozen review classes) | 3+: 0.77; 1 or 2: 8.51; none: 7.94; none rookie: 4.75 | 3+: 2.99; 1 or 2: 2.66; none: 0.14; none rookie: 6.42 | FAIL (3+ and none rookie) |
| 3 Rookies 2025, gap and Brier | 6.93, 0.2414 | 3.16, 0.2128 | better |
| 3 Rookies 2026, gap and Brier | 1.62, 0.2358 | 2.71, 0.2119 | FAIL (gap) |
| 4 Impact row equals the Impact draw | 525.38 vs 389.83 | 395.48 = 395.48 (408 real) | PASS |
| 5 District Impact Brier | 0.025464 | 0.025016 | PASS |
| 6 DCMP any award Brier | 0.190909 | 0.187719 | PASS |
| 7 Zero where an award cannot go | not enforced | 0 everywhere | PASS |

Same team events throughout (district 14,016, DCMP 3,438). District digest 494ac134... becomes e03600d6f219bb08a90028004640352d1bf2af1d9aaa434cf0d4ad31ac4b2c9e. Brier improved in every season 2023 to 2026 at both tiers. Nothing was retried or tuned against 2023 to 2026.

## Champ Locks cutoff (walk forward, 69 district seasons)

- BEFORE: simulated line off by 17.62 points on average (bias 6.72); range covered 48 of 69.
- AFTER: 17.58 (bias 6.71); range covered 48 of 69. 17 districts moved by at most 2 points; no hit or miss flipped. Leak checks 69 of 69. Coverage gate NO-GO both before and after (the range is shown per Jacob's earlier override).

## Re-pinned (Jacob approved exactly these)

- `scripts/measureDistrictCutoff.test.ts`: SEEDED_SIMULATED [62, 62, 62, 60] to [64, 63, 63, 61]; SEEDED_MIDPOINT [59, 57, 56, 56] to [61, 59, 58, 57].
- `apps/web/src/components/districts/LedgerParts.test.tsx`: medianBelow 110 to 100.

## Deleted

`scripts/measureDistrictAwardBaseRates.ts`, `scripts/measureAwardOrderingTables.ts`, `scripts/measureDcmpAwardSlate.ts` and their tests, replaced by `scripts/measureAwardSlate.ts` (`pnpm measure:award-slate`). The per team tables were removed from `awardBaseRates.ts` and `awardOrderingTables.ts`.

## Verification

Full suite 377 of 377 files, 9,547 tests passed (1 skipped). Root, worker, e2e and web typechecks clean (web after `vite build` regenerated the route tree). Standing check: `pnpm score:award-model -- --expect-district-digest e03600d6f219bb08a90028004640352d1bf2af1d9aaa434cf0d4ad31ac4b2c9e`.

## Ship (Jacob approved; in this order)

1. Worker deploy from `apps/worker` (`npx wrangler deploy`) on a clean tree.
2. `pnpm publish:districts`.
3. Push main; check CI and Pages with an Origin header.
4. Verify the 2026 district file carries `awardModelVersion` 2.0.0 and no award blocks; run the live Locks e2e specs; run `measureChampCutoff --check-history` on a fresh dry run compose.

## Follow ups

- Declare the 2027 award list from FIRST's published list before the first 2027 event, re-measure the slate, bump `DISTRICT_AWARD_MODEL_VERSION`, re-pin the digest, and rerun the champ tuning.
- The District Locks cutoff figures on the district points page were measured under the old award model; rerun `measureDistrictCutoff` and `measureLocksInRange`.
- Gates 2 and 3: most decorated teams about 3 points under, rookies with no awards about 6 under; revisit on 2027 data only.
- The Awards cell still labels its 5 point row "One judged award"; the pages say "other team award".
