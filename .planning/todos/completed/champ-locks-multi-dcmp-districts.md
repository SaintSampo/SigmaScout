---
id: champ-locks-multi-dcmp-districts
created: 2026-10-06
source: quick 261006-3gg
priority: high
---

# The Champ Locks tab only knows one of a two-championship district's DCMPs

## What is wrong

`dcmpEventKeyFor` (`apps/web/src/components/districts/champLedgerRows.ts`) returns the first
dcmp-tier event key in sort order. 2026 California ran two District Championships, `2026cancmp`
and `2026cascmp`, and the tab reads only `2026cascmp`:

- the award scan in `champLedgerStatus.ts` accepts consuming awards at that one key, so the
  North championship's winning alliance and judged award winners are never award-qualified in
  the browser; the pool keeps their slots and three teams the publisher marks `eliminated`
  (frc841, frc3501, frc114) read `Locked` on the live site today, at Now;
- the champ-tier reservation (`champReservedSlots.ts`) reads the one DCMP row's stage, so a
  position where the South awards are posted and the North's are not reserves nothing;
- the DCMP row prices only the one championship, and the timeline carries only its stops.

`pnpm measure:champ-tenets` reports these as its six remaining tenet-A violations, all 2026ca
(three at the `2026cascmp:awards` stop, three at Now). The publisher's own verdicts are right:
`reservedChampSlotsAtNow` in `districtRankingsMerge.ts` already sums one reservation per DCMP
event and `awardQualifiedSets` reads awards at every dcmp-tier event.

## What to do

Make the champ rows, the award scan, the reservation and the rail multi-DCMP aware: a set of
dcmp event keys per artifact, a DCMP row per team sourced from the championship that team
attends, the award gate on that event's own stage, and the reservation summed over every
championship still open. Re-run `pnpm measure:champ-tenets`; it must exit 0.

## Resolved 2026-10-06, quick task 261006-lwo (commit 46c44a8a)

Every gate walks `dcmpEventKeysFor` now. The award scan accepts any dcmp-tier key with the team's
own championship's stage as the gate; the started flag is per team; the reservation is summed per
CHAMPIONSHIP through `perChampionship`, which folds division keys (FIM's micmp1..4, TX, NE, ONT)
into their finals event so a divisioned championship reserves once. The publisher pass uses the
same fold. `pnpm measure:champ-tenets`: 6 tenet-A violations to 0, exit 0.
