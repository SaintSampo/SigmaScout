---
quick_id: 261006-lwo
description: Champ Locks multi-DCMP districts
date: 2026-10-06
mode: quick
---

# Quick task 261006-lwo: Champ Locks multi-DCMP districts

Closes `.planning/todos/pending/champ-locks-multi-dcmp-districts.md`. 2026 California ran two
District Championships (`2026cancmp`, `2026cascmp`, both week 5, two Impact awards each). The
browser's champ tab reads one key, so the North championship's 7 award-qualified teams never
leave the pool and three published-eliminated teams read Locked at Now on the live site.
`pnpm measure:champ-tenets` reports six tenet-A violations, all 2026ca.

The dcmp pass already builds each team's row from its OWN championship; only three things read
the single key: the award scan and reservation in `champLedgerStatus.ts`, the "DCMP started"
flag (rows, tab, scripts), and the award draws' "awards final" short circuit.

## Tasks

1. `champLedgerRows.ts`: `dcmpEventKeysFor` (all keys, sorted); `dcmpEventKeyFor` keeps its
   first-key contract for the chance signature. `startedDcmpEventKeys` option: per team, its
   own championship started, or every championship started for a team with no row. Result
   carries `dcmpEventKeys`. `buildDcmpRow` drops the key guard (the row is the team's own).
2. `champLedgerStatus.ts`: award gate accepts any dcmp-tier key, stage gate stays the team's own
   DCMP stage; reservation summed per championship over the first row sourcing each key.
   `champLedgerChances.ts`: no draws only once EVERY championship's awards are final.
   `ChampLocksLedger.tsx`, `measureChampCutoff.ts`, `measureChampTenets.ts`: started set per
   key, awards final = every key. Tests: a two-championship fixture derived from 2026pnw (half
   the DCMP rows and awards relabelled) must reproduce the single-key census and sum two
   reservations. Sweep must exit 0.
3. Docs: SUMMARY, STATE row, close the todo.
