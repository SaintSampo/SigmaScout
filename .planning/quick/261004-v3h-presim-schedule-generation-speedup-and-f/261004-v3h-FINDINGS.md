# 261004-v3h findings: presim schedule generation speedup, and can the bake use fewer schedules

All numbers are in `261004-v3h-results.json` (`partA`, `partB`). One machine: AMD Ryzen 5 7600X, 12 logical CPUs, Node v24.15.0, Windows 11. Several runs shared the machine at once, so absolute seconds are indicative and every comparison below is read within a run or against a control.

## 1. Answer

Part A: structure generation is 4.8 times faster over every structure the all-seasons census reaches (1,117 s to 231 s for 171,000 structures; 404 s to 87 s for the 65 cells of 2026) and not one byte of any sidecar moved. The golden digests, 176,250 structures compared one by one, the six-event sample, and all 418 sidecars of the full 2026 run are identical to the old generator. Part B: at the shipped 1,000 schedules the pooled floor misses one gate (G2: the largest median move is 2.11 ranks against a bar of 2.0, from the 75-team event), so the frame says keep 1,000. The smallest count on the grid that passes every gate is 2,000, reported as information only. The schedule count did not change and changing it is Jacob's decision.

## 2. Part A, what changed and what did not

- `generateSchedule` in `packages/harness/generatedSchedules.ts`: the two `Map` pair counters became flat `Int32Array` tables, each team's repeat penalty against the match so far is a running sum updated as a team joins, the match membership check is a flag array, the ten split masks are precomputed, and the candidate's objective is accumulated from the running counts instead of re-measured. The `rng` call sequence, the cost expression's operand order, both strict less-than comparisons, every error message and every export are unchanged.
- No on-disk structure cache and no worker threads were built. Rule A3: the sweep's new-generator seconds over the 2026 cell set (86.9 s) divided by the new full run's EPA plus SPR sidecar seconds (853.6 + 635.4 = 1,489.0 s) is 5.8%, under the 10% threshold, so a cache is not worth its stale-state risk. (Planner's expectation was about 5%.) Under rule A3 this task builds no cache whatever the number says.
- The cap: rule A4 applied. The all-seasons census reached 171 distinct cells, more than 128, and under 400, so `SCHEDULE_STRUCTURE_CACHE_CELLS` went from 128 to 512 and its test pin moved with it. See section 5.
- Untouched: `PRESIM_SCHEDULE_COUNT` (1000), `PRESIM_DRAWS_PER_SCHEDULE` (50), `publish.ts`, `docs/`, STATE.md, ROADMAP.md.

## 3. Part A, identity

- Golden pins: 17 cells (6 to 300 teams, with and without surrogates), schedules 0, 1, 2, 17, 499, 999 (0 and 1 for the two wide cells), read through `ScheduleStructureCache.get`. The test was committed (7ac8dc25) while `generatedSchedules.ts` was untouched, and is green on the final tree with no digest edited.
- Sweep: for every one of the 171 census cells, k 0 to 999, old generator against `ScheduleStructureCache.get` on the final tree: 171,000 structures, 0 mismatches. Dense grid, 6 to 130 teams by 1 to 14 matches per team, k 0 to 2: 5,250 structures, 0 mismatches.
- Literal sample: six events (2026arli, 2026txwac, 2026casnd, 2026mibel, 2026mrcmp, 2026arc), EPA and SPR, 12 sidecars, pinned generation and computedAt. Bodies from the untouched tree and from the changed tree: `diff -rq` prints nothing. The same 12 are also identical to the debug session's `after-bodies-sample-nooff`.
- Injection validation: the sample run with the old generator injected through `SHARED_STRUCTURE_CACHE.get` is byte-identical to the untouched tree's 12 bodies, which licenses it as the old arm for the full set.
- Full 2026 set (seasons 2025 and 2026, presim from 2026, opr, epa, spr, offseason included): old-generator arm 418 bodies, new-generator arm 418 bodies, `diff -rq` prints nothing. Also identical to the debug session's `after-bodies-full` (418 bodies). The two arms' tree records are identical.
- Final tree: after the cap change the six-event sample was rebuilt (12 bodies) and is identical to the untouched tree's.

## 4. Part A, seconds

- Sweep, old against new, interleaved per structure in one process: 171 census cells 1,117.3 s to 231.5 s (4.83x); 2026 cells 403.8 s to 86.9 s (4.65x); dense grid 65.9 s to 11.6 s (5.70x). The planning-time prototype measured about 5.5x on 14 cells; the figure over the whole census is 4.8x.
- Full runs, launched together. EPA's pass pays every generation (cold memo); SPR's pays none (warm memo) and is the control.

| Arm | EPA sidecars | SPR sidecars (control) | Total run |
|---|---|---|---|
| Old generator | 1,189.5 s | 591.5 s | 1,968.6 s |
| New generator | 853.6 s | 635.4 s | 1,676.5 s |

  EPA fell 335.9 s; the sweep predicts 316.9 s saved on those cells (403.8 minus 86.9). The control moved the other way by 43.9 s (7.4%), which is this machine's run to run noise under load: the new arm shared the machine with the sweep, the Part B smoke run and the census, so its absolute figures are pessimistic.
- Generation's share of EPA plus SPR sidecar seconds: before 403.8 / 1,781.0 = 22.7%; after 86.9 / 1,489.0 = 5.8%.
- Six-event timed sample (EPA, summed over the six events; per-event figures are in `partA.sample`): structure 54.7 s to 10.0 s, predict 9.4 s to 7.3 s, everything else 18.2 s to 15.1 s, wall 82.3 s to 32.4 s. The sidecar timers read EPA 82.7 s to 32.6 s and SPR 20.4 s to 20.0 s (control). What remains is mostly outside generation and outside `predict`: SPR's 20 s over the same six events is 1.4 s predict and 18.5 s everything else. The debug session's profile put `roundPmf`'s decimal shifting at 12.7% of sidecar time, the largest piece outside generation.
- Follow-up candidates, not evaluated here: `roundPmf`'s decimal shifting, the per-schedule rank draws in `simulateRanks`, the `PreScheduleArtifactSchema.parse` of the assembled body.

## 5. All seasons

- Census (2016 to 2020 and 2022 to 2026, EPA and SPR, offseason included, no sidecar built): 3,336 first-structure reads, 171 distinct cells. Per season: 2016 48, 2017 64, 2018 60, 2019 60, 2020 29, 2022 70, 2023 62, 2024 60, 2025 60, 2026 65. Largest roster 102.
- Repeat misses at 128 cells (a cell seen before, evicted, and generated again): 16 of 187 misses. At 512 cells: 0.
- Memory (encoded structures, 1000 per cell): total 74.43 MB for all 171 cells, largest cell 1.22 MB, median 0.44 MB, mean 0.44 MB.
- Cap decision: raised to 512 per rule A4. The reachable memory is the census's 74 MB, not 512 times the largest cell.
- Cold generation seconds for every census cell, old against new: `sweep.json` (`experiments/261004-v3h/`, not committed) holds all 171; the totals are 1,117.3 s to 231.5 s as in section 4. The largest per-cell seconds were at the widest rosters (the old generator took 35 s for the 102-team, 12-match cell against 5.5 s new).

## 6. Part B, the frame

Copied from the plan, fixed before any Part B number existed.

Method: the binding resampling floor. The same construction is built twice (sides A and B) with independent shuffle and draw streams, by suffixing `algorithmVersion`, which feeds the `shuffle` and `baked` seed strings and nothing else. Pricing is one bound `predict` on both sides. Pairing structures are the shared deterministic ones on both sides, as in production.

- Sample: 2026txmca, 2026casnd, 2026joh (27, 40 and 75 teams at 260929-mkn's extraction; 142 teams pooled). Algorithm: spr at its current version, pre-event walk-forward state rebuilt by `buildDistrictPricingState` cut at each event's first played match over 2016-2020 and 2022-2025, Sigma carry and RP cold prior on.
- Replicates: R = 10 independent pairs per cell, suffixes `#v3h-r0A` ... `#v3h-r9B`, the same suffixes at every count, so a smaller count's schedules are a prefix of a larger count's.
- Statistics come from the shipped code: `PublishedPreScheduleArtifactSchema.parse`, `decodePreScheduleResult`, `buildRankDistributionRows`, `rankBandLabel`. Never a second quantile estimator.
- Main arm: n in 100, 150, 200, 300, 500, 750, 1000, 2000 at 50 draws per schedule.
- Secondary arm, total draws fixed at 50,000: 250 x 200 and 500 x 100, with 250 x 50 as its own control and the main arm's 500 x 50 and 1000 x 50 as comparators.

What the page can show: the median column prints an integer (the continuous median rounded half up, clamped to 1..teamCount), so a continuous difference of 1.0 or less moves the printed integer by at most one step and 2.0 or less by at most two, and no noise level guarantees an unchanged integer. The band label prints the 10th and 90th percentiles to one decimal, so only differences under 0.05 rank are invisible there. Rows sort by the continuous median. The scope line prints the schedule count and total draws from the sidecar itself.

Gates, on the main arm; a count n is ACCEPTABLE when all three hold:
- G1: pooled share of teams with |delta median| at most 1.0, mean over the 10 pairs, is at least 95%.
- G2: the largest |delta median| over every event, team and pair is at most 2.0.
- G3: pooled share of 10th-percentile edges within 1.0 rank is at least 90%, and the same for 90th-percentile edges.

A gate statistic within 1 percentage point (G1, G3) or 0.1 rank (G2) of its bar is reported as "at the bar" and counts as not passed. Reading: the recommendation names the smallest ACCEPTABLE n on the grid; n = 1000 is the reference row; if 1000 itself misses a gate, FINDINGS says so and reports the smallest passing count as information only. "More draws buy back fewer schedules" is claimed only if 250 x 200 or 500 x 100 is ACCEPTABLE where the same n at 50 draws is not. The decision to change the count is Jacob's; it would ship as a new spr version and a new epa version.

Implementation of the at the bar rule, fixed in the driver before any run: pass needs the statistic at least 1 point past the bar for G1 and G3 (95.0 and 90.0 bars, so 96.0 and 91.0), and at least 0.1 rank inside the bar for G2 (1.9). Within 1 point or 0.1 rank either side of the bar is "at the bar".

## 7. Part B, what was measured on

| Event | Teams | Qual matches | Matches per team | As-of (first played match) |
|---|---|---|---|---|
| 2026txmca | 27 | 36 | 8 | 2026-03-13T18:07:11Z |
| 2026casnd | 40 | 80 | 12 | 2026-03-21T17:29:02Z |
| 2026joh | 75 | 125 | 10 | 2026-04-30T13:05:39Z |

These equal 260929-mkn's extraction exactly. Algorithm: spr version `9.0.0+baseline` (as recorded in `partB.sprVersion`), state from `buildDistrictPricingState` at each event's as-of over 2016 to 2020 and 2022 to 2025, Sigma carry on, RP cold prior on, `predictFor(roster)` defined for all three. Ten independent pairs per cell. Rows and statistics come from `PublishedPreScheduleArtifactSchema.parse`, `decodePreScheduleResult`, `buildRankDistributionRows` (empty team list) and `rankBandLabel`. Band width for the ratio statistic is the mean of the two sides' 10th to 90th widths.

## 8. Part B, main table

Pooled over the three events (142 teams), mean over 10 pairs; G2 is the maximum over events, teams and pairs. Gate marks: G1 / G2 / G3 (G3 needs both edges).

| n x draws | G1 share within 1.0 | G2 max abs move | G3 p10 / p90 within 1.0 | Marks (G1, G2, G3) | ACCEPTABLE | Within 0.5 | Mean abs move | Worst team (mean over pairs) | 95th pct abs move |
|---|---|---|---|---|---|---|---|---|---|
| 100 x 50 | 67.4% | 6.95 | 74.9% / 78.2% | fail, fail, fail | no | 43.5% | 0.897 | 4.84 | 2.75 |
| 150 x 50 | 73.6% | 4.51 | 80.3% / 80.6% | fail, fail, fail | no | 48.9% | 0.736 | 3.64 | 2.18 |
| 200 x 50 | 78.0% | 4.72 | 82.7% / 84.9% | fail, fail, fail | no | 53.8% | 0.649 | 3.23 | 1.95 |
| 300 x 50 | 84.7% | 3.25 | 87.0% / 87.1% | fail, fail, fail | no | 62.4% | 0.527 | 2.69 | 1.60 |
| 500 x 50 | 90.4% | 2.42 | 92.4% / 92.2% | fail, fail, pass | no | 71.1% | 0.413 | 2.08 | 1.27 |
| 750 x 50 | 95.1% | 2.31 | 95.4% / 95.0% | at the bar, fail, pass | no | 77.9% | 0.329 | 1.90 | 0.98 |
| **1000 x 50** | 96.6% | **2.11** | 97.4% / 96.8% | pass, **fail**, pass | **no** | 82.0% | 0.290 | 1.54 | 0.88 |
| 2000 x 50 | 99.6% | 1.66 | 99.2% / 99.4% | pass, pass, pass | **yes** | 91.5% | 0.198 | 1.04 | 0.62 |

Per event (share within 1.0 / largest move; the same measurements, not separately gated):

| n | txmca (27) | casnd (40) | joh (75) |
|---|---|---|---|
| 100 | 97.8% / 1.61 | 83.0% / 2.49 | 48.1% / 6.95 |
| 300 | 100.0% / 0.87 | 98.5% / 1.23 | 71.9% / 3.25 |
| 500 | 100.0% / 0.60 | 100.0% / 0.99 | 81.9% / 2.42 |
| 750 | 100.0% / 0.50 | 100.0% / 0.85 | 90.8% / 2.31 |
| 1000 | 100.0% / 0.44 | 100.0% / 0.67 | 93.6% / 2.11 |
| 2000 | 100.0% / 0.28 | 100.0% / 0.48 | 99.2% / 1.66 |

The pooled verdict is driven by the 75-team event. The 27 and 40-team events reach every bar at 300 to 500 schedules; the 75-team event is still at 93.6% within 1.0 at 1,000, and the single 2.11 at 1,000 is its. That is information, not a gate: the frame pools, and the verdict below is the pooled one.

Beside the retired document's pooled figures (`docs/models/rung2-generated-schedules.md`: bpr 3.0.0, licensed grid, six events, one pair, so not like for like). Share within 0.5, mean abs move, 95th pct, worst team, share within 1.0 for p10 / p90:

| n | This run (spr, three events, 10 pairs) | Retired document |
|---|---|---|
| 150 | 48.9%, 0.736, 2.18, 3.64, 80.3% / 80.6% | 50.0%, 0.770, 2.346, 4.44, 79.1% / 74.2% |
| 300 | 62.4%, 0.527, 1.60, 2.69, 87.0% / 87.1% | 62.7%, 0.538, 1.833, 3.13, 86.1% / 84.8% |
| 1000 | 82.0%, 0.290, 0.88, 1.54, 97.4% / 96.8% | 81.1%, 0.275, 0.878, 1.17, 96.7% / 99.2% |
| 2000 | 91.5%, 0.198, 0.62, 1.04, 99.2% / 99.4% | 91.8%, 0.192, 0.598, 1.13, 99.2% / 100.0% |

The two agree closely on the central statistics.

## 9. Part B, what the page would show

Pooled, the shipped row builder's own outputs, mean over pairs (largest displacement is a maximum):

| n | Printed medians unchanged | Printed medians 2 or more apart | Identical band labels | Unchanged row positions | Largest row displacement | abs move / band width (median, 95th) |
|---|---|---|---|---|---|---|
| 100 | 41.5% | 20.92% | 0.6% | 32.3% | 13 | 2.1%, 6.3% |
| 300 | 54.6% | 6.69% | 2.5% | 43.4% | 7 | 1.2%, 3.8% |
| 500 | 60.8% | 3.45% | 5.1% | 48.3% | 6 | 0.9%, 3.0% |
| 1000 | 72.6% | 0.77% | 7.6% | 58.4% | 6 | 0.7%, 2.1% |
| 2000 | 79.9% | 0.21% | 12.3% | 68.5% | 4 | 0.5%, 1.4% |

What is and is not invisible at the page's rounding: the printed median integer is the continuous median rounded half up, so a team near an x.5 median flips under any noise, and even at 2,000 schedules about one printed median in five differs between two independent builds (by one step, since only 0.21% differ by two or more). The band label prints one decimal, so it differs between two builds almost always (under 13% identical even at 2,000); only differences under 0.05 rank are invisible there, and this noise level does not reach that. Row order is the continuous median, so near-tied neighbours swap: under half the rows hold position at 500 schedules and about 58% at 1,000. Against the team's own band, though, the move is small: the median move is under 1% of the 10th to 90th width at 1,000 and the 95th percentile move is about 2%. The noise is real at the page's resolution and small against what the page is claiming.

## 10. Part B, the fixed-total-draws arm

Total draws 50,000, pooled, same statistics and gates:

| Cell | G1 | G2 | G3 p10 / p90 | ACCEPTABLE |
|---|---|---|---|---|
| 250 x 200 | 83.4% | 4.15 | 86.7% / 87.4% | no (fail, fail, fail) |
| 250 x 50 (its own control) | 81.5% | 3.76 | 85.3% / 86.9% | no (fail, fail, fail) |
| 500 x 100 | 91.0% | 2.53 | 93.2% / 93.0% | no (fail, fail, pass) |
| 500 x 50 (comparator, main arm) | 90.4% | 2.42 | 92.4% / 92.2% | no (fail, fail, pass) |
| 1000 x 50 (comparator, main arm) | 96.6% | 2.11 | 97.4% / 96.8% | no (pass, fail, pass) |

Read exactly as the frame says: neither 250 x 200 nor 500 x 100 is ACCEPTABLE, so "more draws buy back fewer schedules" is not claimed. Descriptively, quadrupling the draws at 250 schedules moved G1 from 81.5% to 83.4%, and doubling them at 500 moved it from 90.4% to 91.0%, while doubling the schedules from 500 to 1,000 moved it from 90.4% to 96.6%. The resampling floor is set by how many shuffles are drawn, not by how many draws each gets.

## 11. Part B, seconds against noise

Per event, with the new generator: first-touch generation seconds (cumulative) and price plus draw seconds per build (mean over the 20 builds of a cell). The three events ran in parallel on one machine, so these are indicative.

| n | txmca gen / build | casnd gen / build | joh gen / build | Saved vs 1000 per event (txmca, casnd, joh) |
|---|---|---|---|---|
| 100 | 0.07 / 0.15 s | 0.19 / 0.29 s | 0.38 / 0.50 s | 1.75, 3.84, 7.20 s |
| 300 | 0.19 / 0.41 s | 0.49 / 0.88 s | 1.05 / 1.39 s | 1.37, 2.95, 5.64 s |
| 500 | 0.30 / 0.70 s | 0.75 / 1.44 s | 1.72 / 2.27 s | 0.97, 2.14, 4.09 s |
| 750 | 0.43 / 1.06 s | 1.11 / 2.20 s | 2.64 / 3.37 s | 0.48, 1.01, 2.07 s |
| 1000 | 0.56 / 1.41 s | 1.46 / 2.86 s | 3.47 / 4.61 s | 0 |
| 2000 | 1.10 / 2.80 s | 2.90 / 5.80 s | 6.85 / 9.25 s | minus 1.93, minus 4.37, minus 8.02 s |

Season figure, EXTRAPOLATED: the 2026 SPR sidecar seconds of the new-generator full run (635.4 s at 1,000 schedules, warm structure memo, contended machine; the old-generator arm's was 591.5 s) scaled linearly in n. At 500 schedules that is 318 s, saving 318 s; at 750, 477 s, saving 159 s; at 2,000, 1,271 s, costing 635 s more. A cold SPR only run would add generation on top, about 87 s at 1,000 scaled the same way. These are one machine's seconds against a quantity the display notices: halving the count saves about five minutes of a season publish, and costs the gates in section 8.

## 12. Recommendation

The frame's verdict for each count: 100, 150, 200, 300 and 500 fail G1 and G2; 750 is at the bar on G1 and fails G2; 1,000 passes G1 and G3 and misses G2 by 0.11 rank (2.11 against 2.0, from one team of the 75-team event); 2,000 passes all three. n = 1,000 is the reference row and it misses a gate, said in plain words: at the shipped count two independent builds can move a team's continuous median by a little more than two ranks; 2.11 is the largest of the 1,420 team-pairs measured here (142 teams by 10 pairs). Under the frame the answer is keep 1,000. The smallest count that passes every gate is 2,000, given as information only; it would roughly double the bake's seconds.

State of the decision: the schedule count did not change in this task and changing it is Jacob's decision. A change would ship as a new spr version and a new epa version, because both algorithms' sidecar bytes change. EPA's floor was not measured. The scope line prints the schedule count and total draws from the sidecar itself, so the page stays honest under any count. The comment above the count in `publish.ts` quotes the retired measurement and was not edited. The cheaper lever found here is not the count: structure generation is now about 6% of a 2026 run's sidecar seconds, and the larger remaining costs are the draws and pmf rounding.

## 13. Not measured

- EPA's floor (only SPR was run).
- A different set of generated structures on each side: both sides share the deterministic structures, as in production, so structure variation is not in the floor.
- Events above 76 teams (the largest event measured is 75; the census reaches 102 teams).
- Realised rankings: the floor measures run to run agreement of the model with itself, not accuracy.
- The district bake (its structures are covered by the identity proof, its blocks were not rebuilt).
- An all-seasons timed run of the sidecar build: the census ran no sidecars, only the structure reads.
- Generation seconds on a quiet machine: the sweep is interleaved in one process, but the full runs and Part B shared the machine.
