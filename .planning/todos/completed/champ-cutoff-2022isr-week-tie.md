---
id: champ-cutoff-2022isr-week-tie
created: 2026-10-07
source: quick 261007-jvz
priority: low
---

# The Champ cutoff backtest skips 2022isr because the rail breaks a same week tie by event key

## What is wrong

npx tsx scripts/measureChampCutoff.ts (main mode) scores 68 of 69 district seasons. The one skip reads "2022isr: district event 2022isde4 is not final at the end of district season position". The cause is the rail order, not event finality.

## Evidence (2026-10-07, after quick task 261007-jvz)

2022isde4 (start 2022-03-22) and 2022iscmp (start 2022-03-27) both carry TBA week 3. With no event artifacts loaded, the rail (compareSteps in apps/web/src/components/districts/districtTimeline.ts) orders untimed steps by week and then by event key. "2022iscmp" sorts before "2022isde4", so the championship's four stage steps land ahead of 2022isde4's. The end of district season position is therefore 2022isde3:awards (index 12 of 21), where 2022isde4 has not happened, and the backtest refuses the season. The same order applies to the tab's rail whenever no event artifact is loaded.

## Why a start date tie break was not applied

Quick task 261007-jvz checked whether the rail could break the week tie by start date. It cannot from the district artifact: DistrictTeamEventPointsSchema and DistrictTeamRemainingEventSchema (packages/harness/pageArtifacts.ts) carry eventKey, eventName, week, tier, the points and the state block, and no start date. champTierEvents (apps/web/src/components/districts/champLedgerRows.ts) builds the rail events from those rows, so it has only eventKey, eventName, week and tier. The artifact's top level carries no event list with dates either. The per event artifact (EventArtifactSchema) does carry startDate, and data/local-publish/district-events holds one for 2022isde4 but none for 2022iscmp, and the backtest builds its rail with no event artifacts by design. A start date was not invented.

## What a fix needs

Either of two rules:
- A rail rule that, within one week, sorts a district tier event's steps ahead of a dcmp tier event's. It needs no new field (the rail events already carry tier). It moves the rail for every same week championship, so both tenet sweeps (measureLedgerTenets, measureChampTenets) and both backtests (measureChampCutoff, measureDistrictCutoff) must be rerun.
- A start date on the district artifact's event rows (or a per artifact event list with dates), published by scripts/publishDistricts.ts and the Worker alike, then a week tie broken by start date before event key. It changes the artifact shape, so it needs a republish.

Either would make the published 68 read 69, and the Champ cutoff sentence and its pins would need the re-measured figures.

## Closed (fast task, 2026-10-07)

Fixed by the first rule: within one week with no instant to compare, a district tier event sorts ahead of a dcmp tier event in `compareSteps` (apps/web/src/components/districts/districtTimeline.ts); steps carry the caller supplied tier and single tier callers are unaffected. measureChampCutoff now scores 69 of 69 seasons: 17.8 against 40.5, range holding 49 of 69 (71.0 percent). The walk-forward selection moved 2026 to uniform/drawn/1.30 and Jacob honored the pre-registered rule (2026-10-07); the tuning file, the methodology sentence and its pins follow. Both tenet sweeps read zero violations and the district cutoff backtest is unchanged (203 positions, 181 held).

Release: web only; rides the next push.
