---
id: champ-joint-lock-follow-ups
created: 2026-10-09
source: quick 261009-2tr
priority: medium
---

# Follow ups from the Champ Locks joint worst case lock proof

## Why this matters

Quick task 261009-2tr added a second, OR-ed proof of `Locked` at the champ tier (`packages/core/districts/champJointLock.ts`, wired through `apps/web/src/components/districts/champLedgerStatus.ts` decision 5). It runs only at a single event District Championship once its alliances are picked and while its awards are open. The corpus sweep (`pnpm measure:champ-joint-locks`) found zero violations over the 31 single event championships of 2023 to 2026. These are the places it deliberately does not reach, and the open questions it left.

## What to do

1. **Divisions keep the flat reservation.** FIM, NE, ON and TX play divisions into a finals event (more than one dcmp tier key). The proof refuses with `notSingleChampionship` and the shipped ceiling test with `reservedChampSlots` stands. A divisioned version needs one bracket per division plus the finals bracket, and the consuming awards come from the finals event only (RESEARCH section 3).
2. **2026 California's two championships keep it too** (planner reading 7): two winning alliances and two award budgets against one slot pool. Same refusal, same fallback.
3. **The publisher's and Worker's `champLock` verdicts do not use the joint proof.** They are not displayed on the site, so this is a data honesty item only (`packages/harness/districtRankingsMerge.ts`, `apps/worker/src/districtRefresh.ts`, `scripts/publishDistricts.ts`).
4. **The settled Playoffs cell still PRINTS 60 for a losing finalist** while its event's Playoffs are open at Now, though TBA pays 75 to one that won a Finals match (manual 11.1.3). The lock math on both tabs already reads 75 through `SettledPlayoffs.ceiling` (CONTEXT D7), so this is the display question only: todo 5a of `locks-settled-playoffs-follow-ups.md` (261008-26o).
5. **The simulation's 20 for second place under predicts that same 25** (RESEARCH section 5): `ledgerSimulation.ts` pays a losing finalist `playoffPoints`, never the 5 point Finals match bonus.
6. **Live mid DCMP membership reads no members while TBA has not posted DCMP alliance points.** Membership is the picks with DCMP alliance selection points above 0 (CONTEXT D2). With none posted every team is unpicked, so every alliance has four open seats and a winner has four fill ins. That is sound and looser; measure when TBA posts DCMP alliance points live before tightening it.
7. **A tied sf row's replay is not routed.** `playedBracketMatchesFor` skips a row with no winner, so the set stays open and both alliances stay alive. Sound, and later than it could be.
8. **A backup robot TBA never lists.** The proof reads a backup's playoff points through its listed pick's milestone (a decided alliance's settled value), and gives seats only on alive alliances. A backup that played for an alliance now decided but that TBA never added to that alliance's `picks` would be read as unpicked with no playoff points from it. The corpus shows every fourth pick listed (35 of 35 at non division DCMPs, RESEARCH section 4), and the sweep found no violation, but the live event artifact's alliance list was not checked for this. If it can happen, give a decided alliance's spare seats to the unpicked pool at its placement maximum.
