# Rank-distribution mock-before-build measurement (2026-08-31)

This is the committed record of `08-14-PLAN.md` Task 2's mock-before-build pass: `chart-craft.md`'s
obligation to mock a chart against the REAL distribution, discharged for real before
`RankDistributionTable.tsx` (Task 3) exists. Every number below comes from `pnpm mock:rank-distribution`
(`scripts/mockRankDistribution.ts`) run against real published `EventArtifact` bytes fetched from the
same public origin the browser reads (`https://data.sigmascout.org`), through the SHIPPED
`buildSimulationInputs` (08-11), `simulateRanks` (08-03), `continuousQuantile` (08-04), `buildRankDistributionRows`
(08-14 Task 1) and `rankBandExtent`/`medianTickLeft`/`histBarExtent` (08-04) — never a second,
hand-rolled implementation of any of those.

## Method

- **Command:** `pnpm mock:rank-distribution` (`tsx scripts/mockRankDistribution.ts`, no `--env-file` —
  the script holds no credential of any kind).
- **Algorithm / version:** `vpr@2.1.0+tuned-2026-08`, resolved live from the public
  `v1/manifest/algorithms.json` manifest, never hardcoded.
- **Seed:** `20260831` (`mulberry32`), fixed and committed for reproducibility.
- **Draws:** `1000` (`SIMULATION_DRAWS`, imported from `simulationInputs.ts`, never restated).
- **Sampled events**, each with its own reason (`MOCK_EVENT_KEYS`):
  - `2023nhgrs` — the event sketch 005 measured its recorded decisions against, so this run's output
    is comparable to a published reference rather than free-floating.
  - `2024auwarp` — 08-05 identified it as the one published object carrying played `qm` rows with
    actual RP and ZERO teams carrying `rp` (`EventTeamSchema.rp`) — D-12's summed-fallback state.
  - `2023cur` — the largest-roster pmf-bearing event 08-05's own `## Republish ledger`
    (`08-05-SUMMARY.md`) reports at execution time: 78 ranked teams, 130/130 played `qm` rows carrying
    both pmfs. No fallback substitution to `2025flta` was needed — the ledger named a real entry, the
    same event 08-13's own SC-2 measurement independently confirmed live.
- **The draw-loop simulation** (where it can run at all) uses the full-event rewind: the start match
  is the FIRST chronological `qm` row, so every team's baseline is zero and the entire qualification
  schedule is simulated from a blank slate — the maximum-spread case, and the one comparable to
  sketch 005's own from-scratch simulation.
- **The D-12 baseline-provenance finding** (separate from the draw loop, reported per event below)
  uses the LAST PLAYED `qm` row as its own, independent start match — deliberately not the array's
  literal last element (an unplayed row can sort after every played one) and deliberately not the
  first row: starting at the first row would leave every team's prefix empty, trivially reporting
  every team's baseline as "no-played-matches" regardless of whether TBA published a Ranking Score,
  which is the opposite of what this finding needs to show.

## Per-row measurement tables — every row, both draw-loop-capable sampled events

Row count for each table is asserted equal to the simulated team count before any row is printed
(`RowCountMismatchError` aborts the run otherwise) — this is what makes "every row" a property of the
script rather than of the operator's attention. Sketch 005's own session sampled the first 12 rows of
a 39-row table and was wrong about the field by a factor of three; both tables below are printed in
full.

### `2023nhgrs` — 39 teams, all 39 rows

| # | Team | Median (cont.) | Median (disp.) | p10 | p90 | Band width (ranks) | Band px [l,r] | Tick px | Occupied ranks | Visible bars | maxBinCount |
|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| 1 | 3467 | 1.3319 | 1 | 0.6664 | 2.9731 | 2.3067 | [0.00,24.40] | 3.11 | 7 | 7 | 601 |
| 2 | 95 | 2.0833 | 2 | 0.8534 | 4.0909 | 3.2376 | [0.00,38.23] | 12.40 | 11 | 11 | 372 |
| 3 | 4564 | 3.8989 | 4 | 1.8706 | 8.1364 | 6.2657 | [10.77,88.27] | 34.86 | 18 | 18 | 235 |
| 4 | 467 | 3.9850 | 4 | 1.8214 | 7.9103 | 6.0888 | [10.16,85.47] | 35.92 | 19 | 19 | 208 |
| 5 | 238 | 5.4321 | 5 | 2.8468 | 9.8030 | 6.9563 | [22.84,108.88] | 53.82 | 21 | 21 | 168 |
| 6 | 131 | 7.1429 | 7 | 3.7895 | 14.2391 | 10.4497 | [34.50,163.75] | 74.98 | 27 | 27 | 131 |
| 7 | 6763 | 9.1386 | 9 | 4.6928 | 17.9348 | 13.2420 | [45.67,209.46] | 99.66 | 31 | 31 | 105 |
| 8 | 8023 | 9.5882 | 10 | 4.8291 | 18.3182 | 13.4891 | [47.36,214.20] | 105.22 | 30 | 30 | 102 |
| 9 | 5687 | 11.1324 | 11 | 5.8194 | 20.3889 | 14.5694 | [59.61,239.81] | 124.32 | 33 | 33 | 85 |
| 10 | 1922 | 11.7727 | 12 | 5.6132 | 22.0909 | 16.4777 | [57.06,260.86] | 132.24 | 30 | 30 | 78 |
| 11 | 1073 | 12.3108 | 12 | 6.4048 | 21.6111 | 15.2063 | [66.85,254.93] | 138.90 | 32 | 32 | 78 |
| 12 | 1512 | 13.3889 | 13 | 6.4792 | 25.0625 | 18.5833 | [67.77,297.62] | 152.23 | 36 | 36 | 71 |
| 13 | 2876 | 13.7931 | 14 | 6.7381 | 25.1818 | 18.4437 | [70.97,299.09] | 157.23 | 34 | 34 | 77 |
| 14 | 1277 | 16.1515 | 16 | 9.6628 | 24.1538 | 14.4911 | [107.15,286.38] | 186.40 | 31 | 31 | 69 |
| 15 | 5491 | 16.2627 | 16 | 8.4714 | 27.1296 | 18.6582 | [92.41,323.18] | 187.78 | 35 | 35 | 68 |
| 16 | 501 | 17.4333 | 17 | 9.0556 | 27.6111 | 18.5556 | [99.63,329.14] | 202.25 | 35 | 35 | 60 |
| 17 | 4925 | 17.8878 | 18 | 9.3235 | 28.3571 | 19.0336 | [102.95,338.36] | 207.87 | 36 | 36 | 61 |
| 18 | 138 | 18.1346 | 18 | 9.7500 | 26.3065 | 16.5565 | [108.22,313.00] | 210.93 | 33 | 33 | 70 |
| 19 | 3597 | 18.6296 | 19 | 9.5755 | 28.5526 | 18.9772 | [106.07,340.78] | 217.05 | 36 | 36 | 59 |
| 20 | 7913 | 20.3958 | 20 | 11.2586 | 29.8333 | 18.5747 | [126.88,356.62] | 238.90 | 35 | 35 | 61 |
| 21 | 1058 | 21.0938 | 21 | 10.2857 | 31.0556 | 20.7698 | [114.85,371.74] | 247.53 | 35 | 35 | 55 |
| 22 | 8708 | 21.9833 | 22 | 13.4677 | 30.5488 | 17.0810 | [154.21,365.47] | 258.53 | 33 | 33 | 69 |
| 23 | 3451 | 22.4524 | 22 | 11.8448 | 31.6875 | 19.8427 | [134.13,379.56] | 264.33 | 35 | 35 | 60 |
| 24 | 4041 | 22.5357 | 23 | 13.6034 | 29.9103 | 16.3068 | [155.88,357.57] | 265.36 | 33 | 33 | 63 |
| 25 | 6933 | 23.3000 | 23 | 12.8478 | 32.3000 | 19.4522 | [146.54,387.13] | 274.82 | 35 | 35 | 55 |
| 26 | 6161 | 25.1333 | 25 | 14.4524 | 33.4048 | 18.9524 | [166.38,400.80] | 297.49 | 34 | 34 | 60 |
| 27 | 7314 | 25.8846 | 26 | 17.2931 | 33.0250 | 15.7319 | [201.52,396.10] | 306.78 | 33 | 33 | 68 |
| 28 | 1831 | 25.8934 | 26 | 15.5455 | 33.6081 | 18.0627 | [179.90,403.31] | 306.89 | 34 | 34 | 68 |
| 29 | 151 | 27.0672 | 27 | 18.3571 | 33.5294 | 15.1723 | [214.68,402.34] | 321.41 | 32 | 32 | 71 |
| 30 | 4761 | 28.3868 | 28 | 17.0000 | 35.5682 | 18.5682 | [197.89,427.55] | 337.73 | 33 | 33 | 61 |
| 31 | 6690 | 29.1000 | 29 | 19.2600 | 35.5976 | 16.3376 | [225.85,427.92] | 346.55 | 32 | 32 | 68 |
| 32 | 1307 | 31.2458 | 31 | 20.5000 | 36.6667 | 16.1667 | [241.18,441.14] | 373.09 | 33 | 33 | 92 |
| 33 | 1247 | 32.8714 | 33 | 24.7500 | 37.8000 | 13.0500 | [293.75,455.16] | 393.20 | 29 | 29 | 96 |
| 34 | 8724 | 34.0422 | 34 | 26.4677 | 38.1471 | 11.6793 | [315.00,459.45] | 407.68 | 26 | 26 | 107 |
| 35 | 3566 | 34.0954 | 34 | 27.6429 | 37.4756 | 9.8328 | [329.53,451.15] | 408.34 | 24 | 24 | 131 |
| 36 | 811 | 34.9872 | 35 | 27.0652 | 38.3276 | 11.2624 | [322.39,461.68] | 419.37 | 28 | 28 | 145 |
| 37 | 5902 | 35.0755 | 35 | 28.0172 | 38.2589 | 10.2416 | [334.16,460.83] | 420.46 | 25 | 25 | 141 |
| 38 | 6762 | 36.0000 | 36 | 30.1571 | 38.9083 | 8.7511 | [360.63,468.87] | 431.89 | 22 | 22 | 169 |
| 39 | 663 | 38.5079 | 39 | 35.2727 | 39.3016 | 4.0289 | [423.90,470.00] | 462.91 | 14 | 14 | 504 |

### `2023cur` — 78 teams, all 78 rows

| # | Team | Median (cont.) | Median (disp.) | p10 | p90 | Band width (ranks) | Band px [l,r] | Tick px | Occupied ranks | Visible bars | maxBinCount |
|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| 1 | 3310 | 1.0285 | 1 | 0.6057 | 1.4514 | 0.8457 | [0.00,2.76] | 0.00 | 4 | 4 | 946 |
| 2 | 4253 | 2.4154 | 2 | 1.6280 | 4.3718 | 2.7438 | [3.83,20.58] | 7.64 | 12 | 12 | 508 |
| 3 | 5940 | 4.0934 | 4 | 2.2519 | 8.9839 | 6.7319 | [7.64,48.73] | 17.88 | 23 | 23 | 260 |
| 4 | 148 | 4.4245 | 4 | 2.0087 | 9.7174 | 7.7087 | [6.16,53.21] | 19.90 | 24 | 24 | 173 |
| 5 | 6329 | 5.7632 | 6 | 2.6538 | 12.8000 | 10.1462 | [10.09,72.03] | 28.07 | 28 | 28 | 157 |
| 6 | 6995 | 6.9485 | 7 | 4.0376 | 12.7000 | 8.6624 | [18.54,71.42] | 35.31 | 25 | 25 | 156 |
| 7 | 1756 | 8.7143 | 9 | 4.2015 | 14.7500 | 10.5485 | [19.54,83.93] | 46.09 | 28 | 28 | 110 |
| 8 | 2370 | 8.8200 | 9 | 3.7985 | 16.6250 | 12.8265 | [17.08,95.37] | 46.73 | 28 | 28 | 93 |
| 9 | 1403 | 9.2353 | 9 | 5.5755 | 14.6176 | 9.0422 | [27.93,83.12] | 49.27 | 23 | 23 | 136 |
| 10 | 302 | 11.3088 | 11 | 6.2347 | 19.7273 | 13.4926 | [31.95,114.31] | 61.92 | 33 | 33 | 96 |
| 11 | 5687 | 11.4643 | 11 | 5.3511 | 20.0333 | 14.6823 | [26.56,116.18] | 62.87 | 31 | 31 | 84 |
| 12 | 4270 | 11.9762 | 12 | 5.5204 | 22.2500 | 16.7296 | [27.59,129.71] | 66.00 | 39 | 39 | 76 |
| 13 | 3847 | 15.7857 | 16 | 9.5769 | 26.5667 | 16.9897 | [52.35,156.06] | 89.25 | 42 | 42 | 76 |
| 14 | 7890 | 15.8846 | 16 | 8.4091 | 28.1111 | 19.7020 | [45.22,165.48] | 89.85 | 43 | 43 | 75 |
| 15 | 8393 | 18.1889 | 18 | 10.1053 | 29.7500 | 19.6447 | [55.58,175.49] | 103.92 | 41 | 41 | 62 |
| 16 | 4738 | 18.3298 | 18 | 8.8548 | 29.7222 | 20.8674 | [47.95,175.32] | 104.78 | 42 | 42 | 56 |
| 17 | 818 | 19.1800 | 19 | 10.6154 | 27.6818 | 17.0664 | [58.69,162.86] | 109.97 | 36 | 36 | 67 |
| 18 | 115 | 20.0111 | 20 | 9.8235 | 31.6500 | 21.8265 | [53.86,187.08] | 115.04 | 42 | 42 | 49 |
| 19 | 8046 | 20.0600 | 20 | 12.1389 | 27.5000 | 15.3611 | [67.99,161.75] | 115.34 | 36 | 36 | 80 |
| 20 | 325 | 20.2077 | 20 | 13.0135 | 28.2419 | 15.2284 | [73.33,166.28] | 116.24 | 35 | 35 | 66 |
| 21 | 8177 | 20.4231 | 20 | 11.6765 | 31.0000 | 19.3235 | [65.17,183.12] | 117.56 | 41 | 41 | 54 |
| 22 | 449 | 21.0536 | 21 | 10.2917 | 34.2059 | 23.9142 | [56.72,202.69] | 121.40 | 47 | 47 | 56 |
| 23 | 2451 | 22.5000 | 23 | 12.7258 | 34.3636 | 21.6378 | [71.57,203.65] | 130.23 | 45 | 45 | 52 |
| 24 | 5727 | 23.8784 | 24 | 10.7632 | 38.7000 | 27.9368 | [59.59,230.12] | 138.65 | 56 | 56 | 42 |
| 25 | 343 | 24.5351 | 25 | 16.8500 | 34.2222 | 17.3722 | [96.75,202.78] | 142.66 | 40 | 40 | 60 |
| 26 | 3990 | 25.0250 | 25 | 14.5435 | 36.9762 | 22.4327 | [82.67,219.59] | 145.65 | 42 | 42 | 52 |
| 27 | 2199 | 27.8030 | 28 | 15.5000 | 40.6176 | 25.1176 | [88.51,241.82] | 162.60 | 51 | 51 | 51 |
| 28 | 649 | 28.1949 | 28 | 19.2857 | 38.4091 | 19.1234 | [111.61,228.34] | 164.99 | 40 | 40 | 73 |
| 29 | 4131 | 28.5377 | 29 | 16.9615 | 41.9000 | 24.9385 | [97.43,249.65] | 167.09 | 50 | 50 | 53 |
| 30 | 2791 | 28.8000 | 29 | 17.9737 | 41.9000 | 23.9263 | [103.61,249.65] | 168.69 | 51 | 51 | 52 |
| 31 | 7021 | 29.4574 | 29 | 18.3261 | 41.9737 | 23.6476 | [105.76,250.10] | 172.70 | 49 | 49 | 50 |
| 32 | 5414 | 33.8143 | 34 | 21.3571 | 45.0385 | 23.6813 | [124.26,268.81] | 199.29 | 47 | 47 | 53 |
| 33 | 7042 | 34.7857 | 35 | 22.8000 | 46.6200 | 23.8200 | [133.06,278.46] | 205.22 | 52 | 52 | 50 |
| 34 | 180 | 34.8088 | 35 | 26.2895 | 42.0882 | 15.7988 | [154.36,250.80] | 205.37 | 40 | 40 | 72 |
| 35 | 8426 | 35.5962 | 36 | 27.2308 | 43.7821 | 16.5513 | [160.11,261.14] | 210.17 | 37 | 37 | 63 |
| 36 | 4010 | 36.1154 | 36 | 24.3750 | 46.7381 | 22.3631 | [142.68,279.18] | 213.34 | 46 | 46 | 56 |
| 37 | 6348 | 36.7281 | 37 | 27.3611 | 46.2813 | 18.9201 | [160.91,276.39] | 217.08 | 37 | 37 | 60 |
| 38 | 3284 | 37.4444 | 37 | 24.3333 | 47.4583 | 23.1250 | [142.42,283.58] | 221.45 | 51 | 51 | 54 |
| 39 | 1868 | 38.5755 | 39 | 30.3261 | 47.0926 | 16.7665 | [179.00,281.34] | 228.36 | 38 | 38 | 69 |
| 40 | 3526 | 38.6017 | 39 | 28.0714 | 47.4268 | 19.3554 | [165.24,283.38] | 228.52 | 43 | 43 | 59 |
| 41 | 4766 | 39.4318 | 39 | 28.1154 | 48.3824 | 20.2670 | [165.51,289.22] | 233.58 | 48 | 48 | 58 |
| 42 | 1771 | 40.6897 | 41 | 30.4000 | 48.8529 | 18.4529 | [179.45,292.09] | 241.26 | 49 | 49 | 59 |
| 43 | 333 | 41.4744 | 41 | 28.3571 | 50.3684 | 22.0113 | [166.99,301.34] | 246.05 | 48 | 48 | 56 |
| 44 | 1100 | 42.3000 | 42 | 31.5000 | 52.3750 | 20.8750 | [186.17,313.59] | 251.09 | 44 | 44 | 59 |
| 45 | 3132 | 43.7885 | 44 | 34.2500 | 54.2500 | 20.0000 | [202.95,325.03] | 260.18 | 48 | 48 | 56 |
| 46 | 7220 | 43.8962 | 44 | 30.6875 | 54.3148 | 23.6273 | [181.21,325.43] | 260.83 | 51 | 51 | 53 |
| 47 | 4003 | 45.5847 | 46 | 33.7000 | 55.3750 | 21.6750 | [199.60,331.90] | 271.14 | 50 | 50 | 63 |
| 48 | 6647 | 47.9386 | 48 | 38.4130 | 57.7963 | 19.3833 | [228.37,346.68] | 285.51 | 42 | 42 | 64 |
| 49 | 6413 | 51.8519 | 52 | 42.6600 | 59.8793 | 17.2193 | [254.29,359.39] | 309.39 | 41 | 41 | 65 |
| 50 | 5907 | 51.9375 | 52 | 43.2308 | 60.2273 | 16.9965 | [257.77,361.52] | 309.92 | 39 | 39 | 72 |
| 51 | 9015 | 52.3000 | 52 | 42.0000 | 61.5385 | 19.5385 | [250.26,369.52] | 312.13 | 45 | 45 | 63 |
| 52 | 6998 | 52.5364 | 53 | 41.1842 | 62.5526 | 21.3684 | [245.28,375.71] | 313.57 | 47 | 47 | 55 |
| 53 | 3616 | 53.4000 | 53 | 43.6200 | 61.7069 | 18.0869 | [260.15,370.55] | 318.84 | 42 | 42 | 61 |
| 54 | 6358 | 53.6348 | 54 | 48.7750 | 59.9516 | 11.1766 | [291.61,359.83] | 320.28 | 28 | 28 | 119 |
| 55 | 2945 | 55.1571 | 55 | 47.0556 | 61.7093 | 14.6537 | [281.12,370.56] | 329.57 | 36 | 36 | 77 |
| 56 | 5901 | 56.4273 | 56 | 47.4545 | 62.2255 | 14.7709 | [283.55,373.71] | 337.32 | 36 | 36 | 83 |
| 57 | 840 | 57.9225 | 58 | 49.8571 | 63.9286 | 14.0714 | [298.22,384.11] | 346.45 | 35 | 35 | 91 |
| 58 | 8739 | 57.9375 | 58 | 47.3333 | 66.7333 | 19.4000 | [282.81,401.23] | 346.54 | 47 | 47 | 53 |
| 59 | 2637 | 58.2551 | 58 | 48.7069 | 65.7353 | 17.0284 | [291.20,395.14] | 348.48 | 43 | 43 | 69 |
| 60 | 3749 | 58.9468 | 59 | 49.0862 | 66.3182 | 17.2320 | [293.51,398.70] | 352.70 | 41 | 41 | 66 |
| 61 | 3008 | 59.2846 | 59 | 49.5000 | 65.6892 | 16.1892 | [296.04,394.86] | 354.76 | 40 | 40 | 80 |
| 62 | 6868 | 59.5282 | 60 | 49.1250 | 67.3462 | 18.2212 | [293.75,404.97] | 356.25 | 44 | 44 | 71 |
| 63 | 4788 | 59.6800 | 60 | 50.3261 | 66.6429 | 16.3168 | [301.08,400.68] | 357.18 | 37 | 37 | 78 |
| 64 | 7565 | 60.4672 | 60 | 51.8462 | 67.0625 | 15.2163 | [310.36,403.24] | 361.98 | 36 | 36 | 76 |
| 65 | 8711 | 66.0612 | 66 | 59.5513 | 72.5667 | 13.0154 | [357.39,436.84] | 396.13 | 33 | 33 | 98 |
| 66 | 6586 | 67.5928 | 68 | 61.3846 | 73.4608 | 12.0762 | [368.58,442.29] | 405.48 | 29 | 29 | 97 |
| 67 | 9219 | 68.2907 | 68 | 62.2143 | 74.3636 | 12.1494 | [373.65,447.80] | 409.74 | 29 | 29 | 92 |
| 68 | 7534 | 68.3947 | 68 | 62.2368 | 74.5600 | 12.3232 | [373.78,449.00] | 410.37 | 27 | 27 | 83 |
| 69 | 3341 | 68.5175 | 69 | 63.7264 | 73.5755 | 9.8491 | [382.88,442.99] | 411.12 | 24 | 24 | 115 |
| 70 | 3489 | 71.3283 | 71 | 65.9048 | 75.3081 | 9.4033 | [396.17,453.57] | 428.28 | 22 | 22 | 125 |
| 71 | 4392 | 71.5000 | 72 | 64.9186 | 75.9045 | 10.9859 | [390.15,457.21] | 429.32 | 26 | 26 | 108 |
| 72 | 399 | 71.5423 | 72 | 64.3065 | 76.2788 | 11.9724 | [386.42,459.49] | 429.58 | 26 | 26 | 104 |
| 73 | 9085 | 71.7750 | 72 | 66.7000 | 75.1364 | 8.4364 | [401.03,452.52] | 431.00 | 19 | 19 | 143 |
| 74 | 9016 | 71.9808 | 72 | 67.8158 | 75.2912 | 7.4754 | [407.84,453.47] | 432.26 | 18 | 18 | 156 |
| 75 | 9153 | 73.0474 | 73 | 65.9667 | 76.3844 | 10.4177 | [396.55,460.14] | 438.77 | 26 | 26 | 147 |
| 76 | 6652 | 73.1800 | 73 | 65.4429 | 76.7525 | 11.3097 | [393.35,462.39] | 439.58 | 24 | 24 | 147 |
| 77 | 9168 | 76.8592 | 77 | 74.0676 | 78.0595 | 3.9919 | [446.00,470.00] | 462.04 | 15 | 15 | 426 |
| 78 | 9019 | 77.7938 | 78 | 76.5495 | 78.3588 | 1.8093 | [461.15,470.00] | 467.74 | 9 | 9 | 708 |

### `2024auwarp` — draw loop CANNOT run (see Findings)

No per-row table: this event carries zero `qm` rows (played or scheduled) with both `redRpPmf` and
`blueRpPmf`, so `simulateRanks` is never invoked. See the D-12 reachability finding below for what WAS
measured against this event's real bytes.

## Aggregate measurements

| Event | Band width min (ranks) | Band width median (all rows) | Band width max | Band width median (top 12 only) |
|---|---:|---:|---:|---:|
| `2023nhgrs` | 2.3067 | 15.7319 | 20.7698 | 11.8458 |
| `2023cur` | 0.8457 | 16.9931 | 27.9368 | 9.5942 |

The top-12-only median differs materially from the all-row median at both events (11.85 vs 15.73 at
`2023nhgrs`; 9.59 vs 16.99 at `2023cur`) — the same sampling failure sketch 005's own session made,
now visible in the output rather than merely warned about: the top of the table is measurably tighter
than the field as a whole.

**Locked-row alignment:** zero locked rows (a row whose 1000 draws all land on one rank) were found at
either draw-loop-capable sampled event, reported explicitly per row 08-14's own `must_haves` require
("If an event contains none, say so explicitly rather than reporting a vacuous pass") rather than as a
vacuous pass. See "Locked-row alignment — the honest zero" below for the full account and why the
geometric identity is still proven.

**Containment + finiteness:** `2023nhgrs` — 1,218 positions checked, all inside `[0, 470]` and finite.
`2023cur` — 3,018 positions checked, all inside `[0, 470]` and finite. Zero violations at either event.

**Histogram-encoding falsification criterion:**

| Event | Most-locked row's visible bars | Most-spread row's visible bars | Falsification criterion |
|---|---:|---:|---|
| `2023nhgrs` | 7 | 36 | **PASSED** (difference 29, far above the ">1" threshold) |
| `2023cur` | 4 | 56 | **PASSED** (difference 52) |

The per-row normalization DOES carry the locked-versus-spread distinction the histogram exists to
show — this could have failed (a difference of 1 or less would have been a stop-and-report finding)
and did not.

**Median-display divergence** (rows where the printed integer differs from the drawn tick's position
by more than 0.25 rank):

| Event | Divergent rows | Total rows | Percentage |
|---|---:|---:|---:|
| `2023nhgrs` | 14 | 39 | 35.9% |
| `2023cur` | 38 | 78 | 48.7% |

This is the measured cost of the median decision (08-14-PLAN.md Decision 1): roughly a third to a half
of rows have their drawn tick visibly apart from their printed integer, at the scale a real event's
full-rewind spread produces. Accepted per that decision's own reasoning — the alternative (an integer
median) would assert a preference a bimodal distribution does not support.

**Node-count budget** (the computed half of UI-SPEC's S3 `overflow` backstop; 08-15 owns the rendered
half):

| Event | Bar elements | Bands | Ticks | Axis ticks | Total absolutely-positioned nodes |
|---|---:|---:|---:|---:|---:|
| `2023nhgrs` (39 teams) | 1,140 | 39 | 39 | 9 | 1,227 |
| `2023cur` (78 teams, the corpus's largest measured roster) | 2,862 | 78 | 78 | 16 | 3,034 |

**Axis tick non-collision** (computed inline, mirroring the algorithm Task 3's `rankAxisTicks` will
implement — see that function's own doc comment once it lands):

| Event | Ticks | Min gap (px) | `RANK_TICK_MIN_GAP_PX` (28px) | Passed |
|---|---|---:|---:|---|
| `2023nhgrs` | 1, 6, 11, 16, 21, 26, 31, 36, 39 | 37.11 | 28 | yes |
| `2023cur` | 1, 6, 11, 16, 21, 26, 31, 36, 41, 46, 51, 56, 61, 66, 71, 78 | 30.52 | 28 | yes |

## Findings — for other plans and the phase SUMMARY

### D-12 reachability and the summed-fallback baseline

**`2024auwarp`: the draw loop CANNOT run.** Zero of its 47 played `qm` rows (and its 0 scheduled qm
rows) carry both `redRpPmf` and `blueRpPmf` — measured directly against the live artifact, matching
08-05's own ledger exactly (`playedQmBothPmfCount: 0`). The usual reason (08-05's ledger, confirmed
here structurally rather than assumed) is that TBA event type 99 (Offseason) is excluded from
`isRpEligibleEventType`, so `sigma1/index.ts` never produces a pmf for this event's matches. This
answers RESEARCH's flagged assumption directly: with zero pmf-bearing rows, `2024auwarp`'s Simulation
tab would render 08-09's unavailable state in production, never this table — the fallback baseline
computation below is therefore reachable in production ONLY through the per-team case, not the
whole-event case, at this specific event.

**The D-12 summed-fallback baseline IS exercised and IS reachable, against real bytes, at the
per-team-provenance level.** With the baseline assembly's own start match set to the LAST PLAYED `qm`
row (maximizing the played prefix — see Method above for why this differs from the draw loop's own
first-row start), all 25 of `2024auwarp`'s teams resolve their baseline through
`"summed-actual-rp"` (D-12 rule 2), with `incompleteBaselineTeamKeyCount: 0` — every one of the 46
played rows in that prefix carried a non-null `actualRedRp`/`actualBlueRp`, matching 08-05's ledger
(`playedActualRpNullCount: 0`). This is the real published object on which D-12's summed-fallback
precedence path is falsifiable against production bytes, and it is: with zero teams carrying
`EventTeamSchema.rp` at this event, rule 1 (`ranking-score-with-record`/`ranking-score-with-appearances`)
is structurally unreachable here, and rule 2 fires for every team with a non-empty prefix.

**A second, unplanned finding: rule 1 (`ranking-score-with-record`) never fired at ANY of the three
sampled events under this baseline-only methodology — even at the two events where every team DOES
carry `rp`.** At `2023nhgrs` and `2023cur`, the baseline-provenance measurement (last-played-row start)
reports `{"summed-actual-rp": 39}` and `{"summed-actual-rp": 78}` respectively — 100% rule 2, 0% rule 1
— even though `teamsWithRpCount` is 39/39 and 78/78. This is `buildSimulationInputs`'s own documented
behaviour working exactly as specified, not a defect: D-12 rule 1 requires BOTH `!rewind` AND
`team.rp !== undefined`, and `isRewindStart` returns `true` whenever any row at or after the chosen
start is played — which is unavoidably true for a start match chosen to maximize the played prefix
(the start row itself is played). Rule 1 is therefore reachable in production ONLY for a start match
with nothing played at or after it — i.e. a genuine no-rewind, forward-looking start — never for a
rewind-into-history baseline measurement of the kind this finding needed to run. Routed to 08-11's
owner as a confirmed-by-measurement behaviour, not a bug: the summed fallback is the ONLY baseline
source a rewind start point can ever produce once ANY team lacks `rp`, or once the rewind predicate
itself is true, matching D-12's own documented "used both for a genuine rewind start and for an event
where TBA published no Ranking Score at all."

**Per-team fallback case** (a team with played `qm` matches and no `rp` while other teams at the same
event DO have one — the shape in which D-12's fallback stays reachable in production on an otherwise
ranked event): searched on every pmf-bearing sampled event. **Count: 0 at both `2023nhgrs` and
`2023cur`.** Both events are fully and officially ranked (`teamsWithRpCount` equals `rosterSize` at
both), so no team is missing a Ranking Score while its neighbours have one. This is a real, honest
zero — not a defect in the search — and is worth a future re-measurement against a partially-ranked
event if one is found in the corpus (`06.1-04`'s ingest record: 259 of 1,581 corpus events have no
ranking rows at all, which is a different — whole-event — shape than the per-team gap this search
specifically looks for).

### Roster completeness (RESEARCH assumption A2)

Every `qm`-appearing team key was present in `teams[]` at all three sampled events:

| Event | qm-appearing team keys | Absent from `teams[]` |
|---|---:|---:|
| `2023nhgrs` | 39 | 0 |
| `2024auwarp` | 25 | 0 |
| `2023cur` | 78 | 0 |

Assumption A2 held at every sampled event. `buildRankDistributionRows`'s own fallback path (recovering
a team number through `teamNumberFromKey` and rendering an em-dash nickname) remains proven at the
unit level (`rankRows.test.ts`) for the day this assumption is eventually falsified at a real event,
but was not exercised live by this run.

### Histogram-encoding measurement

**Falsification criterion PASSED at both draw-loop-capable events** — see the Aggregate measurements
table above. The per-row normalization (dividing each rank's draw count by that row's own modal count,
`histBarHeight`) demonstrably carries the locked-versus-spread distinction: the most-locked row's
visible-bar count (7 at `2023nhgrs`, 4 at `2023cur`) is far below the most-spread row's (36 and 56
respectively). This validates 08-14 Decision 2's per-row normalizer against real data rather than
merely asserting it.

### Median-display divergence count

35.9% of rows at `2023nhgrs` (14/39) and 48.7% of rows at `2023cur` (38/78) have their drawn median
tick sitting more than 0.25 rank from their printed display integer. This is the measured cost of
08-14 Decision 1 (the continuous-median tick vs. the display-rounded column) — a real, non-trivial
fraction, driven by this run's own maximum-spread full-rewind methodology (a from-scratch simulation
produces exactly the kind of broad, often-bimodal-shaped distributions where the continuous median
sits away from any single integer). A later, narrower start match (fewer remaining matches, tighter
distributions) would be expected to lower this fraction.

### Node-count budget

3,034 total absolutely-positioned nodes at `2023cur` (78 teams, the corpus's measured maximum roster)
— the computed half of UI-SPEC's S3 `overflow` backstop. 08-15 owns the rendered/touch-interaction half
of that same backstop.

### Locked-row alignment — the honest zero

**No row was fully locked (`maxBinCount === 1000`) at either draw-loop-capable sampled event**, under
this plan's own fixed methodology (the full-event rewind from the first chronological `qm` row — the
maximum-spread case). This is reported explicitly, per this plan's own `must_haves` requirement, rather
than as a vacuous pass. The closest approaches: `frc3310` at `2023cur` (946/1000 draws on rank 1,
`occupiedRanks: 4`) and `frc9019` at the same event (708/1000 on rank 78, `occupiedRanks: 9`) — both
show the same tight, near-degenerate concentration a fully-locked row would extend to the limit, just
short of it.

**This does NOT leave 08-04's routed half-slot finding unresolved.** The identity this check exists to
prove — that a locked row's bar centre, band centre and median tick centre coincide — is separately
proven, against 08-04's own recomputed real numbers, at the unit level: `rankRows.test.ts`'s "a LOCKED
row (all 1000 draws on rank 7 of 39)" case asserts `p10 = 6.6`, `p90 = 7.4`, `medianRank = 7` exactly
through the shipped `continuousQuantile`/`buildRankDistributionRows` path, and `simAxis.test.ts`'s own
"a fully locked team at N=78" case proves `rankBandExtent`'s width and containment for that exact
shape. What this LIVE run adds beyond those unit proofs is the geometric TRIPLE-centre-agreement
identity (`histBarExtent`'s centre, `rankBandExtent`'s centre and `medianTickLeft`'s centre, all
independently computed and compared to 0.01px) — that identity is a pure function of `x()`, `rank`,
`teamCount`, `p10`, `p90` and `medianRank`, proven mathematically by `simAxis.ts`'s own construction
(all three derive from the identical `x()`), and is unconditionally true for a locked row REGARDLESS OF
WHICH EVENT produces one, since a locked row's `p10`/`p90`/`medianRank` are fixed functions of its rank
alone (`x(rank-0.4, N)`/`x(rank+0.4, N)`/`x(rank, N)` respectively, per the type-7 estimator's own
bounded-width property). The live run's own containment/finiteness sweep (1,218 + 3,018 = 4,236
positions checked, zero violations) covers every one of these three sampled events' actual marks,
including the near-locked rows above.

**Limitation, stated plainly:** this run's fixed full-rewind methodology (Method, above) never produces
a locked row at these three events' scale (25-78 teams, 47-130 matches). A narrower rewind — starting
closer to the end of a qualification schedule, where 08-11's baseline assembly (see the D-12 finding
above) shows every team already has a substantial played history — would be expected to produce
genuinely locked or near-locked rows for the field's clear leaders and clear stragglers. That
measurement is outside this plan's fixed sampling point and is flagged here as a limitation rather than
silently worked around by picking a different, more convenient start match than the one this plan's own
action text specifies.

## Limitations

- **A single seed is one sample of a stochastic process.** The reported spreads, band widths and
  divergence counts would move slightly under a different seed. `MOCK_SEED = 20260831` is fixed and
  committed for reproducibility, not chosen to produce a particular result.
- **This measures the full-event rewind, the maximum-spread case.** A later, narrower start match
  narrows every band — the spreads reported here (bandWidth medians of 15.7-17.0 ranks) are the WIDEST
  this app will ever render for these events, not a typical case. The `simulation-and-compare.md`
  skill reference's own recorded figures ("0-12 ranks at 2023nhgrs, median 7") describe a DIFFERENT
  measurement point than this plan's fixed first-row-start methodology and should not be read as
  contradicting this run — they are two different simulation inputs, not two measurements of the same
  quantity.
- **The locked-row alignment proof is exact arithmetic and unit-proven, not a live-data occurrence at
  these three events.** See "Locked-row alignment — the honest zero" above. 08-15's rendered evidence
  (a real screenshot, real touch interaction at the 78-team roster) remains outstanding and is that
  plan's own responsibility, not discharged here.
- **The per-team D-12 fallback search found zero cases** at the two pmf-bearing sampled events, both of
  which are fully officially ranked. A partially-ranked, pmf-bearing event (if one exists in the
  corpus) would be a stronger test of that specific code path and was not sampled by this plan's fixed
  three-event list.
- **The generated HTML mocks** (`reports/rank-distribution-mock-{eventKey}.html`, gitignored, not
  committed) are a static, hand-built anatomy — bars, band, tick, axis — using the exact positions this
  document reports, NOT a React render of the eventual `RankDistributionTable.tsx` (Task 3, which had
  not landed when this mock ran). They exist to be looked at, per `chart-craft.md`'s "render it and
  look at it" rule, and were opened and inspected as part of this task's own verification.
