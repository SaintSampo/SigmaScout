---
quick_id: 261006-lwo
description: Champ Locks multi-DCMP districts
date: 2026-10-06
status: complete
commits:
  - 46c44a8a fix: every championship a district publishes counts, divisions fold into their finals event
---

# Summary: Champ Locks multi-DCMP districts

## What was wrong

2026 California ran two District Championships (`2026cancmp`, `2026cascmp`, the same week, two
Impact awards each, fifteen award-qualified teams between them). The champ tab read one key, so
the North championship's seven award-qualified teams never left the points pool and three
published-eliminated teams (frc841, frc3501, frc114) read Locked at Now on the live site. The
champ tenet sweep reported them as its six remaining tenet-A violations.

## What changed

The dcmp pass already built each team's row from its own championship; three things read the
single key and all three now walk `dcmpEventKeysFor`:

- **The award scan** (`champLedgerStatus.ts`) accepts a consuming award at any dcmp-tier key.
  The stage gate stays the team's own championship's, which is where its award was won.
- **The started flag** is per team (`dcmpStartedForTeam`): a team's own championship, or every
  championship for a team with no row yet. The tab, the cutoff backtest and the tenet sweep pass
  a `startedDcmpEventKeys` set at the position; the boolean `dcmpStarted` stays for one-key
  callers and tests.
- **The reservation** is summed per championship. The award draws stop only once every
  championship's awards are final (one draw set per district stays; a second is a cutoff-model
  question, not a guarantee one).

**Divisions.** The first per-key sum doubled the reservation everywhere: FIM, Texas, New England
and Ontario publish their championship as divisions plus a finals event (`2026micmp1..4` and
`2026micmp`), all dcmp-tier, and each division counted as a championship. `perChampionship` in
`champReservedSlots.ts` folds keys by stem (the key minus trailing digits) and reads each
championship at its finals event's stage, the lone member's for a single-event championship,
and every category open for divisions whose finals event is not on the artifact yet. The
publisher pass (`districtRankingsMerge.ts`) uses the same fold, so a live FIM championship
reserves once, not five times. The corpus knows TBA's event type 5 for divisions; a schema stamp
would make this a fact rather than a key pattern, and is not needed while every published key
fits it.

## Numbers (`pnpm measure:champ-tenets`, 109 seasons, 1,073,186 team positions)

| | after 261006-3gg | now |
|---|---|---|
| tenet A violations | 6 (all 2026ca) | 0 |
| tenet B violations | 0 | 0 |
| Locked on points shown | 7,056 | 6,953 |
| slots held back over positions | 44,101 | 44,444 |
| exit code | 1 | 0 |

2026ca: 117 Locked displays to 84, 812 held-back slot-positions to 1,672 (two championships).
The division districts moved a few displays each because the field becomes a fact when a team's
own division starts rather than when the finals event does.

## Verified

Root and web typechecks clean; 337 test files, 7,767 tests pass from the repo root, including a
two-championship fixture derived from 2026pnw (half the DCMP rows and awards relabelled) that
reproduces the single-key census exactly and sums two reservations, and a division variant that
sums one.

## Owed

- Push (Pages deploy) fixes the three false Locked on the live California tab.
- Worker deploy before the first 2027 District Championship, as 261006-3gg already owed.
