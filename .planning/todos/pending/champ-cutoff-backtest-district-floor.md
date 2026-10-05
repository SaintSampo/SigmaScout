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
