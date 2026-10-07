---
id: district-ledger-short-roster-methodology
created: 2026-10-07
source: quick 261007-4qr
priority: medium
---

# District Points methodology figures and limits table after the short-roster rule

## What changed

Quick task 261007-4qr made the Locks ledger simulation price district events with fewer than 24
real teams (whole real alliances at the top seeds, the remaining seeds forfeit). Six walk-forward
positions that used to fall back to the midpoint rule (2023pch, 2025fnc and 2026fit season start
and award stops, 2026ne season start) now score, so the District cutoff backtest moved.

`npx tsx scripts/measureDistrictCutoff.ts`, verbatim, before (HEAD 9d1e5fe2) and after (22412703):

```
before:  draws 1000, seed 20260830; 89 district seasons, 187 scored positions, 20 s
before:  All positions    n= 187  vs settled: sim MAE   1.2 bias    0.5  midpoint MAE   1.8 bias   -0.1  range holds  165 (88.2%)   vs published: sim MAE  17.2  midpoint MAE  17.8  holds    2 of  187 (1.1%)
before:  excluded team fallback (midpoint, no likely range)   6  (2023pch season-start x21, 2025fnc season-start x21, 2025fnc 2025nccat:awards x21, 2026fit season-start x18, 2026fit 2026txcle:awards x18, 2026ne season-start x20)
before:  1. PASS  simulated line MAE against the settled cutoff below the midpoint rule's MAE at the same positions: 1.17 < 1.81 (n = 187)
before:  2. FAIL  printed 10 to 90 range holds the settled cutoff in 72% to 88% of scored positions: 165 of 187 (88.2%)

after:   draws 1000, seed 20260830; 89 district seasons, 193 scored positions, 20 s
after:   All positions    n= 193  vs settled: sim MAE   1.2 bias    0.5  midpoint MAE   1.8 bias   -0.2  range holds  171 (88.6%)   vs published: sim MAE  17.3  midpoint MAE  17.9  holds    2 of  193 (1.0%)
after:   excluded team fallback (midpoint, no likely range)   0
after:   1. PASS  simulated line MAE against the settled cutoff below the midpoint rule's MAE at the same positions: 1.17 < 1.80 (n = 193)
after:   2. FAIL  printed 10 to 90 range holds the settled cutoff in 72% to 88% of scored positions: 171 of 193 (88.6%)
```

The verdict is unchanged (NO-GO, gate 1 pass, gate 2 a hair above the band's 88% ceiling both
times), and the "45 district seasons" figure is unchanged (the season start row now scores all 45).

## The published sentence must change

`apps/web/src/components/methodology/districtLedgerContent.ts` (about line 205) currently reads
"1.2 points on average over 187 positions, against 1.8 for the midpoint rule at the same positions.
Its likely range held the settled cutoff at 165 of those 187 positions, 88%". With the rule live it
should read 193 positions, and 171 of those 193 positions, 89% (88.6%). The 1.2 and 1.8 stay.

Places that carry the old figures:

- `apps/web/src/components/methodology/districtLedgerContent.ts`, the header comment (about lines
  87 to 90) and the published sentence (about line 205).
- `apps/web/src/components/methodology/districtLedgerContent.test.ts`, the pins (about lines 162
  to 168: "1.2 points on average over 187 positions", "165 of those 187 positions, 88%").
- `scripts/measureDistrictCutoff.ts`, the dated header (about lines 38 to 41: "Measured 2026-10-06:
  187 scored positions ... 165 of 187 (88.2%)").

## Proposed limits table entry

A new row for the methodology limits table, flat third person, no hyphen or dash characters:

> Under 24 teams, the simulation seats whole alliances from the top seed down and the rest forfeit,
> the pattern measured at 5 of 5 such district events.

## Notes

- Jacob may edit that copy himself; link him to `districtLedgerContent.ts`.
- `districtLedgerContent.ts` was held by another session on 2026-10-07, which is why 261007-4qr
  did not touch it. Check `git status` for that file before editing.
- `npx tsx scripts/measureChampCutoff.ts --check-history` reported DRIFT on
  `packages/core/districts/champCutoffTuning.generated.ts` both at HEAD 9d1e5fe2 and after
  22412703, with identical fresh regenerations, so the drift predates 261007-4qr. The selected
  setting is unchanged (uniform, fixed, 1.75 for every season); only the fit counts, coverages and
  MAEs moved. It was not regenerated. Regenerating it belongs with whichever change caused it.
