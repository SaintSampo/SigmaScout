---
id: champ-cutoff-backtest-season-skips
created: 2026-10-07
source: quick 261007-il9
priority: medium
---

# The Champ cutoff backtest skips seven seasons and no longer reproduces the published figures

## What is wrong

npx tsx scripts/measureChampCutoff.ts (main mode) no longer reproduces the Champ cutoff sentence on the District Points methodology page. The page states 18.2 against 40.4 over 68 district seasons, and a likely range that held the published line in 48 of 69 seasons, 70%.

## Evidence (planner run, 2026-10-07, HEAD bcc0e303)

Main mode now reads n = 62, simulated 18.5 against naive 39.0, and range coverage 42 of 69 (60.9%). Gates 1 to 4 still PASS and gate 5 still FAILs, so the verdict did not change.

Seven seasons are SKIPPED, each with "district event X is not final at the end of district season position": 2019chs, 2022chs, 2022isr, 2022pch, 2023ne, 2024chs and 2024pch.

Six of the seven skipped events carry a recorded state with qualMatchesPlayed below qualMatchesTotal. 2022isde4 does not, so the cause is not established.

The script counts a skipped season as not covered, so the skip may be a measurement limit rather than a model change.

## Decision owed

The Champ cutoff sentence and its test pins are unchanged pending Jacob's call. The walk forward tuning regenerated in quick task 261007-il9 kept every selected setting (2017 uniform/fixed/1.00, every later season uniform/fixed/1.75), so the published range does not depend on this.

## Closed

Closed 2026-10-07 by quick task 261007-jvz, commit ea6fa51a (the finality cascade), with the methodology comments updated in the commit that moved this file.

Cause: c4bc0b62 (261005-5g0) made a category open at now never final at an earlier rewound stop. Under the old per fact rule six curtailed events (2019vahay, 2022va319, 2022gadal, 2023nhgrs, 2024mdsev and 2024gagwi) never read qualification final at now, so their seasons were refused.
The cascade (a later stage's fact closes every earlier category) restores n = 68, 18.2 against 40.4, and 48 of 69 (69.6%): the published figures exactly. The tuning file is again the 2026-10-05 one apart from its Generated date, with every selected setting unchanged.
2022isr is the one remaining skip, with a different cause: a same week rail tie between 2022isde4 and 2022iscmp (todo champ-cutoff-2022isr-week-tie).

Release: live 2026-10-07, generation bcbab12f (spr 11.0.0, epa 15.0.0, opr 6.0.0), Worker version 9f6466ca, D1 seeded; web changes ride the same day push
