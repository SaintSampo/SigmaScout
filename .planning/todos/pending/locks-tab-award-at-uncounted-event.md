---
id: locks-tab-award-at-uncounted-event
created: 2026-10-07
source: quick 261007-il9
priority: medium
---

# The District Locks tab skips a consuming award won at an event the team has no district tier row for

## What is wrong

The tab counts an award only at an event on the team's own district tier rows (apps/web/src/components/districts/districtLedgerStatus.ts, the districtTierEventKeys.has(award.eventKey) guard). The publisher resolves the award's tier from any row or from the corpus (recomputeDistrictVerdicts with tierByEvent in packages/harness/districtRankingsMerge.ts), so it counts the award and consumes the slot.

## Evidence (quick task 261007-il9, 2026-10-07)

After the publisher's district pass moved onto the district tier total, the 109 local district seasons rebuilt offline (publishDistricts.ts --dry-run --no-bake --local-out) scored 4 tenet A rows and 0 tenet B rows against publishedFinalVerdicts, down from 562 and 454.

The four residual rows are 2019fma frc5113 and frc6943, at 2019paben:awards and at now. frc1391 won Chairman's at 2019paben, its uncounted third event, and attended 2019mrcmp from below the line. The publisher consumes that slot and the tab does not, which shifts the 55 point tie.

Across the 109 seasons, 37 teams differ between the publisher and the tab's district tier final verdict: lockedAward against final locked 30, lockedAward against final eliminated 3, eliminated against final contending 2 (2018ont), and contending against final locked 2 (2019fma).

## What a fix needs

A fix moves a guarantee display, so it needs the tenet sweep (scripts/measureLedgerTenets.ts) rerun against both yardsticks before it ships. Which side is right is a rule question for Jacob: whether an award won at an event outside the team's own district tier rows takes a district slot.
