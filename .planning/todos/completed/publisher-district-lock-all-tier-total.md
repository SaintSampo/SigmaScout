---
id: publisher-district-lock-all-tier-total
created: 2026-10-05
source: quick 261005-04t
priority: medium
---

# The publisher's and the Worker's district lock verdicts rank the all tier total

## What is wrong

`DistrictTeam.pointTotal` is TBA's ALL TIER total: district event points plus District Championship
points plus the rookie bonus and adjustments. The publisher (`scripts/publishDistricts.ts`) and the
Worker rank that number when they compute, for the district tier:

- each team's `districtLock` verdict (`status`, `pointsToLock`, `threatCount`, `cutLinePoints`)
- `insights.dcmpCutLinePoints`
- `insights.districtLockedCount` and `insights.districtEliminatedCount`

So once a championship has been played, "who earned a place at the District Championship" is being
answered with points earned AT that championship.

Quick 261005-04t fixed the District Locks tab's own recompute (`districtLockBounds` in
`apps/web/src/components/districts/districtLedgerStatus.ts` drops every non district tier entry
from the floor) and left the published verdicts alone on purpose (decision D-05).

## Why it was safe to leave

Nothing on the site displays these published fields. The District Locks tab recomputes its
verdicts in the browser, and the Champ Locks tab reads that recompute.

## What fixing it costs

A change to the publisher's and the Worker's district tier lock input, then a republish and a
Worker deploy. Published numbers change, so it ships under whatever versioning the district
artifacts use at the time.

## The 2026 picture (measured by the planner, 2026-10-05, 14 districts, 2,130 teams)

Raw district tier verdict against the floor shipped before 261005-04t, both read at now. 91 teams
differ:

| Change | Teams | Note |
|---|---|---|
| Locked to Locked out | 29 | every one played its championship |
| Locked out to Locked | 28 | none has a championship row |
| ties on the line | 14 and 13 | two groups, as the planner recorded them; the direction of each was not written down |
| In range to Locked | 5 | |
| other | 2 | |

What the Live view shows instead since the Declined state (the field overlay,
`apps/web/src/components/districts/districtFieldOverlay.ts`): Locked 976, Declined 42, Locked out
1112.

## The tenets sweep already measures the disagreement

`scripts/measureLedgerTenets.ts` now scores against the district tier final standing and reads
zero on both tenets. Scored against the publisher's verdict instead (`sweepDistrict(artifact,
publishedFinalVerdicts(artifact))`) the same sweep reports 571 tenet A and 477 tenet B rows over
the 109 local seasons (reproduced by the executor, 2026-10-05). Those are the two yardsticks
disagreeing over declined places, teams that played from below the line, and ties. When the
publisher is on the district tier floor, that second reading should fall to zero too, which makes
it the acceptance check for this todo.

## Closed

Closed 2026-10-07 by quick task 261007-il9, commit 75db163a.
recomputeDistrictVerdicts, the one pass the publisher and the Worker share, now ranks the district tier total for districtLock, dcmpCutLinePoints and the two district counts; the champ pass and pointTotal are unchanged.
Rebuilt offline over the 109 local district seasons, the tenet sweep against publishedFinalVerdicts went from 562 tenet A and 454 tenet B rows to 4 and 0, with zero champ side and zero pointTotal movement.
The four residual rows (2019fma frc5113 and frc6943) are an award rule difference, recorded in todo locks-tab-award-at-uncounted-event.

Release: live 2026-10-07, generation bcbab12f (spr 11.0.0, epa 15.0.0, opr 6.0.0), Worker version 9f6466ca, D1 seeded; web changes ride the same day push
