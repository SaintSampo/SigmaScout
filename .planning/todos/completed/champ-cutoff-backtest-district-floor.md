---
id: champ-cutoff-backtest-district-floor
created: 2026-10-05
source: quick 261005-04t
priority: high
---

# Re-run the champ cutoff backtest on the district tier floor

## Why

`scripts/measureChampCutoff.ts` reads `computeDistrictLedgerStatuses` at the end of each district
season to set who is in the championship field. Until quick 261005-04t that function's floor held
the all tier `pointTotal`, so those verdicts already knew who had played the championship.

The Methodology page's figures from that script were measured that way:

- 16.4 points against 41.0 (the simulated line against the old one)
- the likely range holding 49 of 69 seasons

They are UNVERIFIED under the district tier floor. They are published numbers, so this is high
priority.

## What to do

After `locks-fixes` is merged, run `pnpm measure:champ-cutoff`. If either figure moves, update
`apps/web/src/components/methodology/districtLedgerContent.ts` and the script's recorded constants
together. It was deliberately not re-measured inside 261005-04t.

## Two facts to keep with it

1. The Champ Locks tab's rewound field chance and its hypothetical championship ceiling read the
   same district verdicts, so they changed with this fix. Jacob accepted that on 2026-10-05.
2. The Champ Locks tab's field is any team with a championship row. The District Locks tab's Live
   overlay counts a team as playing only when its championship row has qualification, alliance or
   playoff points. So a team whose only championship points are award points reads Declined on the
   District tab and in the field on the Champ tab. In 2026 that is one team: 2026isr frc10935.

## Resolution (2026-10-05)

Re-run on merged main (58f1f80f), same local district artifacts as the 2026-09-27 run.

| Figure | 2026-09-27 | 2026-10-05 |
|---|---|---|
| Simulated line, mean miss | 16.4 | 18.2 |
| Midpoint rule at the same position | 41.0 | 40.4 |
| Likely range holds the published line | 49 of 69 | 48 of 69 |

The gate reads the same as before: four line conditions pass, the coverage band fails, NO-GO, and
the range stays shown under Jacob's 2026-09-27 ruling.

Not anticipated by this todo: `--check-history` reported drift in
`packages/core/districts/champCutoffTuning.generated.ts`. The walk-forward selection now picks
uniform / fixed / 1.75 for every season from 2018 on. The committed table had decoration / fixed /
1.5 for 2024 and 2025, decoration / drawn / 1.3 for 2026 and decoration / fixed / 1.3 for 2027. The
table was regenerated with `--write-tuning`, so the Champ Locks line and range the browser draws for
2024 onward change with this commit. The figures above describe the regenerated table.

Methodology sentence, its test pins and the comment in `predictedCutoff.ts` updated together.
