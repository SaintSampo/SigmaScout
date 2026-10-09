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

1. **CLOSED by quick 261009-kt3.** ~~Divisions keep the flat reservation.~~ FIM, NE, ON and TX play divisions into a finals event (more than one dcmp tier key). The proof refuses with `notSingleChampionship` and the shipped ceiling test with `reservedChampSlots` stands. A divisioned version needs one bracket per division plus the finals bracket, and the consuming awards come from the finals event only (RESEARCH section 3).
2. **CLOSED by quick 261009-kt3.** ~~2026 California's two championships keep it too~~ (planner reading 7): two winning alliances and two award budgets against one slot pool. Same refusal, same fallback.
3. **The publisher's and Worker's `champLock` verdicts do not use the joint proof.** They are not displayed on the site, so this is a data honesty item only (`packages/harness/districtRankingsMerge.ts`, `apps/worker/src/districtRefresh.ts`, `scripts/publishDistricts.ts`).
4. **The settled Playoffs cell still PRINTS 60 for a losing finalist** while its event's Playoffs are open at Now, though TBA pays 75 to one that won a Finals match (manual 11.1.3). The lock math on both tabs already reads 75 through `SettledPlayoffs.ceiling` (CONTEXT D7), so this is the display question only: todo 5a of `locks-settled-playoffs-follow-ups.md` (261008-26o).
5. **The simulation's 20 for second place under predicts that same 25** (RESEARCH section 5): `ledgerSimulation.ts` pays a losing finalist `playoffPoints`, never the 5 point Finals match bonus.
6. **Live mid DCMP membership reads no members while TBA has not posted DCMP alliance points.** Membership is the picks with DCMP alliance selection points above 0 (CONTEXT D2). With none posted every team is unpicked, so every alliance has four open seats and a winner has four fill ins. That is sound and looser; measure when TBA posts DCMP alliance points live before tightening it.
7. **A tied sf row's replay is not routed.** `playedBracketMatchesFor` skips a row with no winner, so the set stays open and both alliances stay alive. Sound, and later than it could be.
8. **A backup robot TBA never lists.** The proof reads a backup's playoff points through its listed pick's milestone (a decided alliance's settled value), and gives seats only on alive alliances. A backup that played for an alliance now decided but that TBA never added to that alliance's `picks` would be read as unpicked with no playoff points from it. The corpus shows every fourth pick listed (35 of 35 at non division DCMPs, RESEARCH section 4), and the sweep found no violation, but the live event artifact's alliance list was not checked for this. If it can happen, give a decided alliance's spare seats to the unpicked pool at its placement maximum.

## Added by quick 261009-kt3 (divisioned and two championship joint proof)

9. **K counting only divisions with open Awards (reading R4).** The divisioned proof uses K = 14 times the division count at every stop. Counting only the divisions whose Awards are still open is sound (posted judged points are in the floor) and the planner prototype measured 2,511 lock stops against 2,176. Jacob's call.
10. **The proof waits at Live until a finals row exists (R13).** A stem whose divisions are on the artifact and whose parent key is not reads `unsupportedShape` until TBA writes a finals row.
11. **Finals facts at Live depend on the finals run request while its Playoffs are open (R12).** With no request the finals read as not started, which only widens the candidates and credits every winner F_nw.
12. **The DCMP row's cells and small line read only the first dcmp row** for a team with a division row and a finals row. `tierEvents` sorts by week then event NAME, so at FIM the FINALS row comes first (frc27's DCMP row prints the finals' 0, 0, 60, 30, not its division's 66, 48, 90, 0), contrary to RESEARCH section 5. The floor and ceiling fold both (D3); the display does not. The same ordering means the pre existing gap D3 closed was mostly the DIVISION row's open points staying in the floor (the sweep's strengthened D3 assertion reports 1,308 gaps under the shipped single source fold).
13. **A division backup distinct from its finals backup (R5) has never been observed** in the corpus. Revisit if its cost matters.
14. **R9 counts a no row rival whose floor already reaches T once per championship** (an over count). Deduplicate it in the sum if 2026 California earliness ever matters.
15. **A team with no championship row keeps the hypothetical DCMP ceiling (249 in 2026) until EVERY dcmp key has started** (`dcmpStartedForTeam`), so at a divisioned "Divisions final, finals not started" stop eight NE teams and four FIM teams with no row still carry a whole hypothetical DCMP. It cost the NE pin 5 locks and the FIM pin 4 at that stop. A divisioned championship's field is fixed once its divisions start; treating a team with no row as out from then on would be sound and earlier.
16. **Finals seats open to any rival (261009-kt3 executor addendum) cost FIM 6 locks at Divisions final.** They rest on the same unverified "two rosters" reading as CONTEXT D9 (a pick of an eliminated division alliance called as a finals backup). If FIRST's backup rules exclude it, both D9's seat bonus and these seats can go.
17. **Listed pick membership (R8) was measured less conservative on the single path** (5 gained locks over the single sweep) and was rejected there; the single and California paths keep confirmed pick membership. The divisioned path uses R8 with guards G1 to G3.
