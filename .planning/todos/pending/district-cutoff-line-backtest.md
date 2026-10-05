---
id: district-cutoff-line-backtest
created: 2026-10-04
source: quick 261004-uw4
priority: medium
---

# Backtest the District Locks predicted cutoff and its likely range

## Why this matters

On 2026-10-04 (quick task 261004-uw4) the District Locks headline "Predicted cutoff" became the median of the per run simulated line, with its likely range taken from the same call. That closed a display defect (the headline sat below its own printed range at 8 of 22 rewound positions measured live), but it did not measure anything: how close the new line lands to the cutoff a district season actually ends on, and how often its 10th to 90th percentile range holds that cutoff, have never been measured. The Methodology page says so in one sentence ("How close this line lands to the published cutoff has not been measured."), and every measured figure on that page (16.4 points, 41.0, 49 of 69) belongs to the Champ Locks tab by name.

## What to do

1. Write a walk forward backtest modelled on `scripts/measureChampCutoff.ts`, calling the browser's own code in the component's own order: the district row build, `computeDistrictLedgerStatuses`, `buildAdvancementChanceRun`, `advancementChances`, `districtRangeState` and `simulatedLine`.
2. At each week end position of each district season, compute the district line's median and its 10th to 90th percentile range from data known at that position only. Predict before update, with leak checks like the champ script's.
3. Score against the tab's own settled cutoff at season end (the midpoint rule once every pool team is settled). Report the published DCMP cut line beside it, since the two rank different totals and are not the same quantity.
4. Report, at the same positions:
   - mean absolute error of the simulated line, against the midpoint rule's;
   - the share of positions whose likely range holds the settled value, against a nominal 80%.
5. Pre register both bars before running, the way 260927-6bf did for the champ line.

## Known limits to carry into the design

- Each team's season total is drawn on its own, so the runs miss the fact that teams at one event compete for the same points. That is the likely reason a range runs narrow, and the champ range measured 71% against a nominal 80%.
- A position where the chance run left a team out prints no simulated line (the tab falls back to the midpoint rule there, with no likely range), and a position where a run failed or could not be built prints no cutoff at all. Neither is scored; count them and report the count.
- Unplayed events are priced from baked marginals, so a walk forward position has to use the marginals a publish at that position would have produced, not the season end ones.

## What follows a result

Replace the "has not been measured" sentence in `apps/web/src/components/methodology/districtLedgerContent.ts` with the measured figures, add the script as a numbered source in that file's header, and pin the figures in `districtLedgerContent.test.ts`'s `REQUIRED_FIGURES`. If the range misses its bar, decide then whether to show it with the coverage quoted (the champ ruling of 2026-09-27) or withhold it.
