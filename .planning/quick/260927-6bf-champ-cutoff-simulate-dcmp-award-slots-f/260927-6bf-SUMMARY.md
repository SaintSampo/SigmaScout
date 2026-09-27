---
quick_id: 260927-6bf
status: complete
date: 2026-09-27
---

# Quick Task 260927-6bf: the Champ Locks cutoff simulates DCMP award slots

## Why

On 2026 FNC the Champ Locks tab predicted about 170 for most of the season, but the real cut was 231 (224 on the final tab). The points projection was right: the 15th best final points total was 172. The whole miss was DCMP award winners. Across 69 district seasons they take about 7.6 Championship slots, and about 3.0 of those go to teams outside the points top. The existing line ignored that, which put it about 20 points low (oracle naive MAE 20.3, bias -20.2).

## Task 1: the simulated line end to end, walk-forward backtest (commit d6fd9370): NO-GO on range coverage

**One-liner:** The champ run now draws the DCMP winning alliance, coupled to each team's own DCMP draw, and the Impact, Engineering Inspiration and Rookie All Star winners in every run. It removes those teams and their slots, then reads the line off the teams left. The walk-forward backtest over 69 district seasons cut the end of district MAE from 41.0 (the naive line at the same position) to 16.5. The printed 10 to 90 range covered the published line in 49 of 69 seasons (71.0%), one short of the pre-registered band of 50 to 60, so the gate printed NO-GO.

**Built:**
- `advancementChances` champ mode. Legacy mode is unchanged byte for byte.
- `hypotheticalDcmp.ts`: field rank buckets, win share, award counts anchored on the previous season, a drawn count mode, the K3 spread, and the 20 setting grid.
- `dcmpHistory.generated.ts` and `champCutoffTuning.generated.ts`, guarded by `--check-history`.
- Pure web modules: `champFieldChances`, `hypotheticalDcmpEstimates`, `buildChampAwardDraws`, `champRangeState` and `simulatedChampLine`.
- Protocol bounds, plus `scripts/measureChampCutoff.ts` (`pnpm measure:champ-cutoff`) with its tests.

**Measured** at the end of each district season, 68 lines out of 69 seasons:

| Line | MAE | Bias |
|---|---|---|
| Simulated line (walk-forward tuned) | 16.5 | +4.3 |
| Naive line at the same position | 41.0 | -40.6 |
| cmpSlots - 3 at the same position | 23.8 | -21.2 |
| Oracle naive | 20.26 | -20.17 |
| Oracle cmpSlots - 3 | 9.00 | -2.57 |

- The simulated line splits into small districts (18.4) and large districts (11.4).
- Both oracle lines reproduce the earlier measurement.
- Coverage was 49 of 69. 2022isr counts as not covered, because it has no end of district position on the rail.
- Mean drawn award slots: 7.80. Mean slots held by teams outside the points top: 3.16.
- 2026 FNC: 217 (193 to 243) against 231. 2026 PNW: 186 (163 to 205) against 182.
- The misses cluster where the line runs high: fma misses in 4 of 5 seasons, plus ne and ont.
- All four leak checks pass in 68 of 68.

**Deviations:**
1. A DCMP counts as played only when it has a winning alliance. This keeps the 2020 Impact only rows out of the history.
2. In champ mode, a run with no line records NaN and the line is read over the runs that have one. This was changed after the first run. Under the literal rule the verdict was also NO-GO.
3. `buildDcmpRow` case 2 applies only when a `dcmpEstimateByTeam` map is supplied.
4. `hypotheticalDcmpPart` clamps to the season ceiling.
5. There is an extra `noCall` reason, `noFieldChance`.
6. The earlier positions for 2026 PNW read `noCall`, because frc3669 at 2026orore has no award profile.
7. The commit trailer says Opus 5.5, the executor's model.

**Verification:**
- 39 test files and 1035 tests pass, run from the repo root.
- The root, web, e2e and worker typechecks are clean.
- `--check-history` reports no drift.
- The guarantee files have no diff, and the tenets output is identical to the baseline.

## Jacob's rulings after the NO-GO (2026-09-27)

- **Ship the line, not the range.** The simulated cutoff passed all four of its own conditions, so it ships. The likely range stays hidden until a separate, pre-registered calibration round gets its coverage into the band.
- **Treat a team with no award profile as having no decorations.** It gets a zero profile, so its event still simulates. The team is simply never drawn for a judged award.

## Task 2: the tab reads the simulated line (commit 52883284)

**One-liner:** Until the DCMP awards post, the Champ Locks cutoff is the simulated line, and In range and Out of range cut at it. One `champRangeState` feeds both the chips and the stat line. The likely range for that line is computed but not shown. Rewinds before the DCMP price every team from the walk-forward estimate, so the "district only" label and the suppressed champ run are gone. Row headers print what was earned at the position, on both tabs.

**Built:**
- `applyChampRangeState` and `champCutoffView`, with four arms: settled, pending, simulated and noCall.
- The cutoff gains `pending` and `unavailable(reason)` arms, and a `source` of either `boundary` or `simulated`.
- `SHOW_SIMULATED_CHAMP_LIKELY_RANGE` is off. The flag cites 49 of 69 (71.0%) against the 72 to 88% bar.
- Neutral Pending and No call chips at 88 px, the same width as Out of range. Filter counts show an em dash while the run is pending.
- `earnedAtPosition` on both tabs. On the district tab it is display only, so the tenets stay identical.
- A2: a team with no award profile reads a zero profile, a veteran with no decorations. This is fixed in the shared `buildDistrictEventSimulationInput`, so it covers both tabs. 2026 PNW earlier positions now produce lines (165, 172, 178, 185 and 186 against 182).
- The first paint flicker is fixed: an idle per event run no longer reads as a terminal No call.
- Methodology: the simulated line, the drawn winning alliance and awards, 16.4 against 41.0 over 68 district seasons, and the range withheld.

**Final backtest (committed tree):**
- Simulated line: MAE 16.35, bias +4.56.
- Same position naive line: 41.0 / -40.6.
- Range coverage: 49 of 69 (gate 5 still fails, so the range stays hidden).
- Leak checks: 68 of 68.
- 2026 FNC: 217 against 231. 2026 PNW: 186 against 182.
- The tuning file was regenerated through the script after the tie break moved to the earned total at the position.

## Task 3: verification, bundle and screenshots (commit 5b8a25d2)

- Full suite from the repo root: 298 files, 6948 tests passed, 1 skipped.
- Root, web, e2e and worker typechecks are clean. `--check-history` reports no drift.
- The tenets output is identical to the baseline. The guarantee files have no diff. `todays.?line` has 0 hits.
- Bundle: the main chunk grows by 11.4 KB gzip (+4.1%) and all assets by 13.3 KB (+2.1%). The largest piece is the DCMP history table at 4.8 KB gzip.
- Five offline screenshots at 1440 are in `screenshots/`: FNC ~217, PNW ~186, PNW season start ~165, FNC now "Cutoff 224", and the held Pending state.

## Open follow ups

- **The No call chip and a DCMP priced with its field open are unverified in a real browser.** Offline shots cannot render either (see `screenshots/README.md`).
- **The champ tab's In range definition** ("if every team earned its median predicted points") no longer describes the simulated line exactly.
- **The publisher's bake still skips events with a team that has no award profile** (`districtBake.ts`, `missing-award-profiles`). Fixing that needs a publisher change and a republish.
- **The district tab's fallback projection** still reads the published total, which includes points earned later, at rewound positions.
- **A zero profile team can still be drawn** at the no decorations rate. It is not literally never drawn.
- **The likely range needs a pre-registered calibration round** before it can show.
