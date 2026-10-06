---
quick_id: 261006-3gg
description: Champ Locks reserve slots for pending DCMP consuming awards
date: 2026-10-06
status: complete
commits:
  - 7ecd4d2e feat: reservation rule, award count ceilings, champ tenet sweep (baseline)
  - 02e2eb9e feat: both callers hold back the DCMP's own qualifications
---

# Summary: Champ Locks reserve slots for pending DCMP consuming awards

## What changed

**Rule.** `packages/core/districts/champReservedSlots.ts` (new, pure). While a District
Championship's playoffs are open the champ `"locked"` test holds back the winning alliance's
slots (TBA's maximum of four picks); while its awards are open it holds back one slot per judged
consuming award (Impact, Engineering Inspiration, Rookie All Star) at that award's historical
CEILING; once the awards are final it holds back nothing. A past season whose championship never
started and never published a schedule reserves nothing (2020isr); the current season never
reads as "never happening", which covers the window between a district's last event and the
DCMP registration list.

**Ceilings, not anchors.** `dcmpAwardCountCeilings` in `hypotheticalDcmp.ts`: per type, the
most the district's own earlier seasons OR its five nearest districts by `cmpSlots` ever gave
out. The cutoff model keeps reading the previous-season anchor because it predicts; the
guarantee reads a ceiling because FNC's Rookie All Star grew from 1 to 2 for 2023 and an anchor
would have under-reserved by exactly the slot the guarantee is about.

**Callers.** The browser (`champLedgerStatus.ts`, decision 2 rewritten) reads the DCMP's stage
at the position off the rows; the publisher and Worker (`districtRankingsMerge.ts`,
`reservedChampSlotsAtNow`) read the dcmp rows' state at now, one reservation per DCMP event,
summed. Both subtract from `lockSlots` alone: `"eliminated"`, the published cut line and the
In range rank rule stay on the unreserved count, as the district tier does. The champ chance
run passes 0 because it draws the consuming awards itself per run; subtracting both would count
every pending qualification twice (`champLedgerChances.ts`). Both callers take an optional
`nowYear` so tests are calendar-stable.

**Measurement.** `scripts/measureChampTenets.ts` (`pnpm measure:champ-tenets`), the champ-tier
twin of the district sweep: every published season, every stop on the Champ Locks rail, the
tab's own statuses against the artifact's published `champLock.status`.

## Numbers (109 seasons, 4,714 positions, 1,073,186 team positions)

| | before | after |
|---|---|---|
| Locked on points shown | 7,802 | 7,056 |
| of which kept (qualified on points at now) | 7,459 | 6,878 |
| tenet A violations (Locked, then did not qualify) | 9 | 6 |
| tenet B violations (Locked out, then qualified) | 0 | 0 |
| slots held back, summed over positions | 0 | 44,101 over 4,251 positions |

The three violations closed: 2025fnc frc6502 and frc1533 at the DCMP playoffs stop, 2026fsc
frc343 at the DCMP playoffs stop. frc7890's FNC 2026 case was a near miss, not a violation
(7890 qualified by winning a judged award itself), and now reads unlocked at that stop.

The six that remain are all 2026 California at the `2026cascmp` awards stop and at Now, and
they have a different root cause: that district ran two championships and the browser's champ
rows read only `2026cascmp`, so the North championship's winners never leave the pool. The
publisher's verdicts are right; the tab's are not, today, on the live site (frc841, frc3501,
frc114 read Locked, published eliminated). Filed as
`.planning/todos/pending/champ-locks-multi-dcmp-districts.md`, priority high. The sweep exits 1
until it is fixed.

## What did not change

- No published number moves: every published season's DCMP has posted its awards, so both
  reservations are zero at now. The 2026pnw fixture census and cut line reproduce exactly.
- The explainer line "A Locked verdict is a guarantee" and the chip definitions are unchanged;
  no Methodology copy describes the champ Locked rule.
- No Worker deploy yet. The live tick runs `recomputeDistrictVerdicts`, so the Worker should be
  deployed before the 2027 season's first District Championship; nothing is live now.

## Deviations

- Executed inline in the main context rather than through a spawned executor: the investigation
  context was already here, and the measurement had to run before and after the wiring in one
  sitting.
- The winning-alliance reservation was not in the request; the investigation found it is the
  same leapfrog one stop earlier (a fourth pick with a ceiling below a Locked team's floor can
  still win), so it is part of the same guarantee.
