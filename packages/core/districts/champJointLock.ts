/**
 * THE JOINT WORST CASE LOCK PROOF at the Championship tier (quick task
 * 261009-2tr), generalized to divisioned and multiple championships by quick
 * task 261009-kt3, its divisioned frames brought in line with the verified
 * backup robot rule by quick task 261009-tx9. Pure, no I/O, no zod, no React;
 * its only import is the `./bracket.js` sibling.
 *
 * ---------------------------------------------------------------------------
 * THE CLAIM
 * ---------------------------------------------------------------------------
 *
 * For a team T in the points pool at a District Championship whose alliances
 * are picked, `jointLockBound(input, T)` is an upper bound on the number of
 * rivals that can take a Championship slot from T in ANY future the bracket,
 * the backup robots and the award budget still allow. A rival takes a slot from
 * T by finishing at or above T's points (ties count against T) or by
 * qualifying regardless of points (a member of the winning alliance, or a
 * consuming award winner). When the bound is below `pointsSlots` (the open
 * slots once the posted award qualifiers are removed), at most
 * `pointsSlots - 1` rivals can take a slot from T, so T qualifies.
 * `jointLockedTeams` is exactly that test. It is OR-ed with the ceiling test in
 * `locks.ts` and supersedes nothing.
 *
 * ---------------------------------------------------------------------------
 * THE FACTS ABOUT EVERY FEASIBLE FUTURE IT RESTS ON
 * ---------------------------------------------------------------------------
 *
 *   - The real winning alliance is one of `candidateWinners` (`null` is the
 *     posted winner case: its members already left the pool and the slots).
 *   - The real placements of the alive alliances other than the winner are one
 *     enumerated assignment, or are dominated by one (the monotonicity argument
 *     below).
 *   - TBA never pays a team MORE than the placement maxima 30, 25, 13 and 7
 *     times the tier weight (the 2026 manual, section 11.1.3: base points plus
 *     5 per Finals match won, up to 10). `placementPoints` carries those maxima
 *     (`maxPlayoffPointsByPlacement`), and so does a decided placement whose
 *     settled value is not exact, through the caller's `extra`. Since 2023 no
 *     TBA row sits above them; proration only lowers a value. The second place
 *     maximum of 25 is the manual's wording and not a value TBA has paid: the
 *     wording would allow a losing finalist that won one Finals match 25, and
 *     TBA has paid every one of the 329 measured losing finalists with a
 *     Finals win the base value (261 district tier and 68 DCMP tier, 2023 to
 *     2026, measured 2026-10-09 in quick task 261009-tx8), none above it. The
 *     13 rows at base 25 are members of the winning alliance that played in
 *     one of its two Finals wins. The 25 (75 at a DCMP) maximum is kept as the
 *     safe side, since a ceiling that is too high only delays a lock.
 *   - A rival's real points are at most `floor + extra`, plus its alliance's
 *     assigned placement value (or the value of the one seat it takes as a
 *     backup), plus the points of the one award it can receive.
 *   - At most `consumingAwards` consuming awards and `judgedAwards` judged
 *     awards are given out, and each rival receives at most
 *     `MAX_POINT_PAYING_AWARDS_PER_TEAM` point paying award: one consuming
 *     award or one judged award, never both and never two.
 *   - A winning alliance has at most `maxAllianceSize` members, and every
 *     member beyond the picked ones is a backup robot from the unpicked teams.
 *   - Each rival takes at most one slot.
 *
 * ---------------------------------------------------------------------------
 * WHY THE COUNT IS AN UPPER BOUND
 * ---------------------------------------------------------------------------
 *
 * Fix the real future. Its winner is some candidate W and its placements are
 * dominated by some enumerated assignment, so the scenario (W, assignment) is
 * one the loop visits. Every rival that takes a slot from T in that future is
 *
 *   1. a member of W (counted by step 1 of the scenario), or
 *   2. a rival whose `floor + extra + assigned value` already reaches T's floor
 *      (step 3), or otherwise one of the rivals still uncovered, X, and then
 *   3. a consuming award winner (at most C of them), or
 *   4. a backup robot on W (at most f, and only a rival eligible in W's own
 *      seat group, which for a single championship is X's unpicked part), or
 *   5. a pool rival lifted to T's floor by a seat on a losing alliance and at
 *      most one judged award, and those are at most SJ, because the real
 *      allocation of seats and judged awards is one the dynamic program below
 *      considered.
 *
 * So the real takers are at most `|covered| + min(|X|, SJ + C + min(f, |X_U|))`,
 * and the bound is the maximum of that over the scenarios.
 *
 * WHY NOT THE LITERAL GREEDY ORDER OF CONTEXT D2. A fixed order undercounts in
 * three constructed cases, which would break the argument above: a consuming
 * award spent on an unpicked rival leaves the fill in nothing (R1); the largest
 * seat given to the largest need covers one rival where the swap covers two
 * (R2); a judged award spent on an unpicked rival leaves a picked one uncovered
 * when the fill in could have taken the unpicked one (R3). The count above is
 * at least the greedy count in every case, which `champJointLock.test.ts`
 * checks against a reference greedy on 500 seeded instances.
 *
 * ---------------------------------------------------------------------------
 * THE CALLER'S READINGS (261009-2tr planner readings, locked in CONTEXT D5)
 * ---------------------------------------------------------------------------
 *
 *   - Reading 3: a prequalified team not yet award qualified takes a slot only
 *     by winning or by a consuming award, so it is a `slotOnlyRivals` entry and
 *     never passes T on points.
 *   - Reading 5: `extra` is the shipped open ceiling minus exactly the two DCMP
 *     pieces this proof models itself (the Awards ceiling while Awards are open,
 *     the Playoffs ceiling while Playoffs are open for a team with no settled
 *     value).
 *   - Reading 6: an alliance is alive for the proof when the routing has not
 *     placed it OR any member has no settled value while Playoffs are open.
 *   - Reading 8: the no alive alliance case (`candidateWinners` of `[null]`)
 *     runs only once the winner award is posted.
 *   - Reading 12: a decided placement whose settled value is not exact enters
 *     `extra` at its MAXIMUM, so a placed team needs no top up here.
 *
 * ---------------------------------------------------------------------------
 * READING 9: WHY THE REDUCED PLACEMENT ASSIGNMENTS ARE ENOUGH
 * ---------------------------------------------------------------------------
 *
 * Assigning fewer or smaller placement values never covers more rivals: any
 * cover the seats, awards and fill ins achieve at lower points or smaller seat
 * values stays achievable at higher ones, so the maximum cover is monotone in
 * every rival's points and every seat's value. The decided placements are a
 * suffix of the table (fifth to eighth fall in Rounds 2 and 3, fourth in
 * Round 4, third in Round 5, first and second in the final), so the alive
 * alliances other than W share placements 2 and below. Every real assignment is
 * therefore dominated by an enumerated assignment of the top
 * `min(placementPoints.length, |others|)` maxima to distinct alliances, and the
 * bound for that enumerated assignment is at least its maximum cover, hence at
 * least the real takers. The exhaustive tests E1 and E2 in
 * `champJointLock.test.ts` guard this.
 *
 * ---------------------------------------------------------------------------
 * THE BACKUP ROBOT RULE (quick task 261009-tx9)
 * ---------------------------------------------------------------------------
 *
 * At a divisioned championship an alliance has at most ONE backup for the
 * whole championship, division playoffs and finals together. A backup is an
 * unselected team of the alliance's OWN division. A team already on an
 * alliance is never a backup. Three independent sources agree:
 *
 *   - The 2026 manual, District Tournaments: "If an ALLIANCE in a District
 *     Championship Playoff has not yet recruited a BACKUP TEAM per section
 *     10.6.3 BACKUP TEAMS, the ALLIANCE CAPTAIN may bring in only the highest
 *     ranked team from their division's BACKUP POOL to join its ALLIANCE."
 *   - FIRST's 2026 Alliance Selection Script: the backup pool is the next
 *     eight highest ranking UNSELECTED teams, each alliance has ONE
 *     opportunity to substitute in a robot from the backup pool, and backups
 *     come in by ranking order.
 *   - The corpus (`data/corpus.sqlite`), every divisioned championship of 2017
 *     to 2026: 24 championships and 64 finals alliances. No division or finals
 *     alliance lists more than four teams. Exactly two teams were added for a
 *     finals, frc5926 on 2023micmp alliance 1 and frc4327 on 2026micmp
 *     alliance 4, both unpicked teams of the alliance's own division. No
 *     finals roster carried a team from another alliance or another division.
 *
 * Quick task 261009-kt3 ran before the rule was verified and kept three
 * cautious terms: a second set of seats beside an alliance's division seats
 * (its reading R5), finals seats open to any rival with the fill ins counted
 * against every uncovered rival (its step 6 and guard G3), and a finals bonus
 * on every seat in the champion's division (its D9). The rule makes all three
 * unnecessary and they are gone. Guards G1 and G2 stay: seats count from
 * confirmed picks, and a placed alliance keeps its confirmed picks only.
 *
 * ---------------------------------------------------------------------------
 * FRAMES: ONE CODE PATH FOR ALL THREE CHAMPIONSHIP SHAPES (quick task 261009-kt3)
 * ---------------------------------------------------------------------------
 *
 * The loop runs over FRAMES (`JointLockFrame`): one candidate winner W, the
 * alliances whose placements are enumerated (every ordered assignment of the
 * placement maxima, as reading 9 above), the alliances whose value is fixed,
 * and W's fill ins. A single championship is the degenerate case:
 * `singleChampionshipFrames` builds, per candidate W, the alive alliances
 * other than W enumerated, nothing fixed, and W's spare seats as fill ins
 * against the uncovered unpicked rivals, which is exactly the shipped loop,
 * and the single sweep reproduces its numbers.
 *
 * A DIVISIONED championship (FIM: four divisions; NE, ON, TX: two) plays each
 * division as an eight alliance event and then the FINALS among the division
 * winners (`finalsBracket.ts`). `divisionedJointFrames` builds one frame per
 * candidate overall champion W, and the caller hands the bound one SEAT GROUP
 * per division (`JointLockInput.seatGroups`):
 *
 *   1. W's members are covered. W's ONE seat pool (the maximum alliance size
 *      minus its CONFIRMED picks) is its fill ins: a backup on W qualifies
 *      with the champion whatever its points, and it comes only from the
 *      eligible teams of W's own division. W offers no seat at a points value.
 *   2. In W's division the other alive alliances are enumerated at 75, 39 and
 *      21 (W wins its division), decided ones carry their settled values. A
 *      seat on an alive one pays that alliance's assigned division value and
 *      nothing more, because that alliance does not reach the finals.
 *   3. In every other division every alive alliance is FIXED at 90 plus F_nw,
 *      F_nw the most a finals non champion can be paid (30 at four divisions,
 *      the finalist; 0 at two). No role in that division pays more: its
 *      champion is paid 90 and, since the overall champion is W, at most the
 *      finalist's 30 in the finals. A decided winner of another division is
 *      fixed at F_nw while the finals have not placed it, at its finals
 *      placement maximum once placed, and at 0 once the finals' Playoffs are
 *      final (TBA's finals points are then in the floor). Each of these
 *      alliances offers its seats ONCE, at its fixed value: a backup that
 *      joins in the division playoffs is the alliance's backup in the finals.
 *   4. SEAT GROUPS. A backup seat or a fill in of an alliance is taken only
 *      by a team eligible in the alliance's own group. The caller builds one
 *      group per division: its eight alliances, and every team with a row at
 *      that division's key that no alliance there CONFIRMED, together with
 *      every pick an alliance there lists and has not confirmed. A confirmed
 *      pick of any alliance, eliminated or not, and a team with a row in
 *      another division are never counted through a seat or a fill in.
 *
 * READING P3, A LISTED PICK THAT IS NOT CONFIRMED IS A HINDSIGHT FACT. On an
 * alliance its division has not placed, the caller lists such a team among
 * the members (its reading R8), and a seat group names it too. The bound then
 * counts it on BOTH sides: as a member paid its alliance's scenario value (it
 * stays as that alliance's one backup), and as an eligible team of its
 * division at floor plus extra with no alliance value, free for another
 * alliance's seat or for W's fill in (it was never on that alliance). One
 * rival may then be counted twice, which only raises the bound. The same
 * holds for T itself: a frame whose winner only LISTS T is NOT skipped when a
 * seat group names T, because T may never have been on that alliance, so its
 * win does not qualify T. Quick task 261009-kt3 skipped that frame, which left
 * one future uncovered: an alliance that lists T wins without it.
 *
 * READING P4, A RIVAL THAT NO GROUP NAMES IS ELIGIBLE IN EVERY GROUP. A pool
 * or slot only rival on no alliance that no group names (no row is known for
 * it at any division) is offered every division's seats and every candidate
 * winner's fill in, and still counts through a consuming award and through
 * one judged award alone. The proof therefore never rests on a competing
 * team's row being posted. Such a rival may be counted once per group, which
 * only raises the bound. A team an alliance lists that no group names (a
 * confirmed pick) is eligible nowhere.
 *
 * THE JUDGED BUDGET STAYS ONE POOL shared by the groups (reading P8): each
 * group's seat and judged award cover is computed on its own seats and its
 * own eligible rivals, and the covers are combined by the best split of the
 * budget.
 *
 * The facts this rests on beyond the single case: no finals row pays above 60
 * at four divisions or 30 at two (manual 11.1.3, `maxFinalsPointsByPlacement`);
 * the finals awards are consuming awards (24 and 30 points 2023 to 2026); one
 * judged award per team per event; the judged awards of every division share
 * one budget, the sum over the divisions of what each can still give (the
 * caller builds it, quick task 261009-pgq: the whole ceiling K for a division
 * whose Awards are open, and K minus the teams already carrying award points
 * there, never below 0, for a division whose Awards read final, because that
 * flag turns true at the first judged award whose points are in the rankings
 * (quick task 261009-r9x), so later judged awards can still follow, and the
 * posted points are already in the floors; what is left goes only to rivals
 * that hold no posted award, the next section; a rival can win only its own
 * division's, so sharing is a relaxation).
 *
 * The real champion is some candidate W; in W's division the real placements
 * are dominated by an enumerated assignment; in every other division no
 * alliance is paid more than its fixed value; decided values are maxima; an
 * alliance takes at most one backup, from its own division's unselected teams
 * (the backup robot rule above); awards, seats, fill ins and the one slot per
 * rival as in the single case. So the real takers are at most the frame's
 * count.
 *
 * NOT A FACT THE PROOF RESTS ON: "no team has award points at both its
 * division and the finals". This header said so until quick task 261010-d7r.
 * It is true since 2023 (0 of the 478 division rows carrying award points)
 * and false before: six teams held a division judged award and then won a
 * consuming award at the finals of the same championship (2017 FIM frc2834,
 * frc245 and frc1718 with Impact, frc6344 and frc6637 with Rookie All Star;
 * 2018 FIM frc2834 with Impact). The bound never needed it: a consuming award
 * takes a slot whatever its winner's points, and every rival still short of
 * T, a division award in its floor or not, is counted through the consuming
 * awards. That is why an awarded rival keeps a consuming award's place and
 * the winner's fill in (the section on awarded rivals below).
 *
 * SEATS COUNT FROM CONFIRMED PICKS on every shape (CONTEXT D10): an alliance's
 * backup seats are the maximum alliance size minus its picks whose alliance
 * selection points are posted and above 0 (`JointLockAlliance.spareSeats`),
 * never minus its listed picks. A listed fourth pick at 0 points may be
 * dropped and a rival called in its place.
 *
 * MULTIPLE CHAMPIONSHIPS (2026 California, CONTEXT D5): slot takers partition
 * by championship, and one championship's alliances, seats and awards cannot
 * reach a rival of the other, so `jointLockBoundMultiple` sums one bound per
 * championship, an OBSERVER bound (T absent, every candidate winner counted)
 * for each championship T does not play. A rival with no championship row is
 * entered in EVERY championship's input (reading R9): it takes at most one
 * slot, so counting it in each is an over count, and counting it in one only
 * could miss the slot it takes in the other.
 *
 * ---------------------------------------------------------------------------
 * A RIVAL THAT HOLDS A POSTED AWARD TAKES NO FURTHER JUDGED AWARD (quick task
 * 261010-d7r, D1)
 * ---------------------------------------------------------------------------
 *
 * THE RULE. `JointLockInput.awardedRivals` names the teams that hold a posted
 * point paying award at a dcmp key whose Awards read final at the position
 * (the caller reads them off the rows: award points above 0 at a division
 * whose Awards are final). The award's points are in the team's floor. The
 * bound gives such a rival no judged award from any remaining budget, in the
 * two places a judged award is spent:
 *
 *   - a rival on an alliance, still short of T after its alliance's assigned
 *     value, is not lifted by a judged award;
 *   - a rival in a seat group is covered only where a seat's value alone
 *     reaches T: never by an award alone, never by a seat and an award.
 *
 * WHY IT IS SOUND. It is the one judged award per team per event fact above
 * (`MAX_POINT_PAYING_AWARDS_PER_TEAM`), applied to an award already posted: a
 * team with award points at a division has had that division's one judged
 * award, a rival can win only its own division's, and the finals give no
 * judged award.
 *
 * WHAT IT LEAVES ALONE, ON PURPOSE. An awarded rival still short of T is
 * still counted through a consuming award and is still in the winner's fill
 * in pool. Both take a slot whatever the rival's points, and a consuming
 * award has gone to a team holding a division award (the six teams above).
 * Denying it the consuming award was measured unsound by the planner of that
 * task: on 20,000 small instances with every legal future enumerated, the
 * bound then sat below a legal future at 406.
 *
 * WHY IT IS MONOTONE. While a division's Awards are open none of its award
 * points is in a floor, and every rival takes at most one award out of the
 * division's ceiling of 14. Once they read final the awarded rivals hold
 * their one, in their floors, and the others take at most one out of what is
 * left. So every reading after the flag is one of the readings before it, and
 * no bound rises over that tick.
 *
 * WHAT IT CLOSED. The remaining budget rule of quick task 261009-pgq (14
 * minus the teams awarded, kept because the flag does not say every judged
 * award is in) handed that remainder to ANY rival, one that already held a
 * posted award included. That rival then carried two judged awards, which no
 * earlier reading allowed, so a bound rose when a division's Awards turned
 * final. Measured at the code before this rule over the 16 divisioned
 * championships of 2023 to 2026, every division's Playoffs final and the
 * finals not started, the divisions' Awards open against final: 312 pool
 * teams' bounds rose, the largest by 7, and eleven teams Locked with the
 * Awards open were not Locked with them final. With the rule: none
 * (`scripts/champFieldStagedWalk.test.ts` group 9, and every flag edge of
 * `scripts/champJointMonotone.test.ts`).
 *
 * T ITSELF. The proof gives T no award in any reading. T's posted award is in
 * its floor like any team's, and `awardedRivals` may name T.
 *
 * ---------------------------------------------------------------------------
 * A LISTED PICK THAT IS NOT CONFIRMED IS PAID ITS DECIDED ALLIANCE'S VALUE OR
 * TAKES ANOTHER SEAT, NEVER BOTH (quick task 261010-d7r, finding F-D)
 * ---------------------------------------------------------------------------
 *
 * WHO. An alliance may list a team that holds 0 alliance selection points
 * there: a fourth the field has named and TBA has not paid a pick's points.
 * It is not a confirmed pick, so on an alliance the routing has PLACED it is
 * not among the members (guard G2 at a divisioned championship, confirmed
 * pick membership at the other shapes). The row model still settles its
 * Playoffs at that alliance's placement, and where the settled value is not
 * exact (a live reading: the placement's maximum, in the ceiling) the
 * caller's `extra` holds it. `JointLockRival.listedOnly` says so: `settled`
 * is that value, `onWinner` whether the alliance is the decided winner.
 *
 * THE TWO FUTURES. Such a team either WAS on that alliance or NEVER was:
 *
 *   - it was: it is paid up to the settled value, and it takes no other
 *     alliance's seat, since a team already on an alliance is never a backup
 *     (the backup robot rule above);
 *   - it never was: that alliance pays it nothing, and it is free like any
 *     rival on no alliance, for one seat or for the winner's fill in.
 *
 * THE RULE. The bound reads each future on its own and never adds the two.
 * Wherever the rival is read ALONE (the always covered test, its points in a
 * scenario, the cover's cost with no seat, its place in the fill in pool) it
 * is read at `extra`. Where it takes a SEAT it is read at `extra` minus
 * `settled`. Either reading may still add one judged award, and the
 * consuming awards and the fill ins count it as they count any rival.
 *
 * THE DECIDED WINNER'S LISTED PICK (`onWinner`). Being on the winner is not a
 * points value: it IS the winner's fill in, which takes a slot whatever the
 * team's points and is counted against the winner's spare seats. So the
 * alone reading is `extra` minus `settled` as well, and the team sits in the
 * fill in pool like any eligible rival still short of T. This reading is
 * applied only where every frame names one and the same winner. With a frame
 * whose winner is `null` (the posted winner case) no fill in is left to
 * count the team through, and with two candidate winners none is decided, so
 * there the rival is read as if it carried no `listedOnly` at all, which is
 * the reading of before this rule. The caller never builds such an input: a
 * settled value exists only while the Playoffs are open, the posted winner
 * frame only once they are final, and a routed winner is the one candidate.
 *
 * THE WINNER'S READING IS THE RIVAL AS IT READ BEFORE THE WINNER WAS DECIDED,
 * which is what makes that row's edge monotone: until the row the rival had
 * no settled value, so its `extra` held nothing of the Playoffs. It is NOT
 * always at or below the reading of before this rule. A rival that drops
 * from "its points reach T" to "short of T, on no alliance" joins the fill
 * in pool, and the bound counts a fill in beside a seat that may lift the
 * same rival, a relaxation it has always had and one that only raises it.
 * On 500 seeded instances 10 team bounds read higher with `onWinner` than
 * with no `listedOnly` (`champJointLock.test.ts` pins it). That says nothing
 * about soundness. A placed alliance's reading, by contrast, is never above
 * the reading of before this rule: the rival reads the same alone and no
 * nearer to T on a seat.
 *
 * WHY IT IS SOUND. Every real future is one of the two above, and each is
 * read at no less than it pays: the first by the alone reading (by the fill
 * in, on the winner), the second by the seat reading, by the fill in, and
 * with no seat by the alone reading at the larger `extra`.
 * `champJointLock.test.ts` enumerates every legal future of 20,000 small
 * instances holding such picks and awarded rivals together, and the bound is
 * never below one.
 *
 * WHAT IT CLOSED. Until that task the rival was read at `extra` on a seat
 * too, so its points became one alliance's value plus another's, which no
 * future pays. That only raised a bound, so it was never unsound. It was not
 * monotone: the played row that places the alliance adds the settled value
 * to a rival that could already take a seat, and a bound rose over that row.
 * Measured by that task's planner on the micro step walks with every other
 * rule on: 26 team margins dropped and no Locked team was lost (2023pnw 17
 * at the second Finals match, 2026fnc 3, 2024pch 2, 2026win 2, 2024fnc 1,
 * 2025fim 1), each at the played row that places an alliance listing four
 * teams. With the rule: none (`scripts/champJointMonotone.test.ts`, group
 * D). The same walks with this rule switched off read the 25 of the five
 * single championships again and still lose no Locked team; 2025 FIM is not
 * among the committed walks. So no measured Locked rests on this rule: it
 * keeps a bound from rising, which is the mechanism of a take back.
 *
 * LIVE ONLY. A rewound settled value is TBA's own number: exact, in the
 * floor, and the caller sets no `listedOnly`. So no line of a sweep moves.
 *
 * A DIVISION WINNER'S LISTED PICK carries no `listedOnly` (planner reading
 * R7 of that task): the only seat it can take is on that same alliance, for
 * the finals, so it keeps its settled value in every reading, which only
 * raises a bound.
 *
 * ---------------------------------------------------------------------------
 * THE COVER UPPER BOUND (reading R10)
 * ---------------------------------------------------------------------------
 *
 * The seat and judged award cover of the unpicked rivals is the exact dynamic
 * program `unpickedCover` wherever its table (seat states times budget plus 1
 * times reachable rivals) is at most `EXACT_COVER_STATE_CAP`; every single
 * event case of 2023 to 2026 is. Since quick task 261009-tx9 a table covers
 * ONE seat group's seats and eligible rivals, one division's at a divisioned
 * championship, where quick task 261009-kt3 put every division's seats in one
 * table. Above the cap the program is unusable and `coverUpperBound` is used;
 * it stays as the guard for any input that large. With the reachable
 * deficits sorted ascending, for each prefix of k: `Mfree(k)` is the greedy
 * matching of the prefix to seats worth at least the deficit, and `Mpv(k)` is
 * the prefix's deficits of at most one judged award's points plus the greedy
 * matching of the rest to seats worth at least the deficit minus that award.
 * `bound[j]` is the largest k with `k - Mfree(k) <= j` and `Mpv(k) = k`. Proof:
 * an optimal cover may be taken to be a prefix (every resource covering a
 * deficit covers a smaller one); every covered rival not matched free spends
 * exactly one award, and the free matches are at most `Mfree`; every covered
 * set is a matching in the paid or award alone structure, so it is at most
 * `Mpv`. Three conditions are binding:
 *
 *   (a) both greedy matchings take the deficits LARGEST FIRST and give each
 *       the SMALLEST seat value that suffices, which makes them maximum on
 *       these nested eligibility sets;
 *   (b) the bound hardcodes at most ONE judged award's points per rival, so
 *       `assertOneAwardPerRival(MAX_POINT_PAYING_AWARDS_PER_TEAM)` runs at
 *       module load and throws unless the constant is 1;
 *   (c) the bound models the judged awards and the seats only, exactly as
 *       `unpickedCover`; the consuming awards and the fill ins enter
 *       separately, as the shipped `others3`.
 *
 * READING R11: the reachable by seat filter uses the largest seat value over
 * the placement values and EVERY usable frame's fixed values, never the
 * placement values alone.
 */
import { bracketDecisionsFromPlayedMatches, InvalidBracketDecisionError, routePlayedBracket, type PlayedBracketMatch } from "./bracket.js";

/**
 * At most ONE point paying award per rival in any future: a consuming award or
 * one judged award, never both and never two (Jacob, 2026-10-09). FIRST's
 * judging rule is one judged award per team per event, and TBA's district
 * point rows agree: since 2023 none of about 8,800 team event rows carries two
 * awards' points (69 did in 2016 to 2020, 1 in 2022). A rule change is what the
 * corpus sweep (`scripts/measureChampJointLocks.ts`) would catch.
 */
export const MAX_POINT_PAYING_AWARDS_PER_TEAM = 1;

/**
 * Reading R10 (b): the cover upper bound hardcodes one judged award's points
 * per rival, so it is sound only while `MAX_POINT_PAYING_AWARDS_PER_TEAM` is 1.
 * Throws an Error naming the constant otherwise. Called at module load.
 */
export function assertOneAwardPerRival(value: number): void {
  if (value !== 1) {
    throw new Error(
      `champJointLock: MAX_POINT_PAYING_AWARDS_PER_TEAM is ${String(value)}, but the cover upper bound counts at most one judged award per rival; rework coverUpperBound before changing it`
    );
  }
}
assertOneAwardPerRival(MAX_POINT_PAYING_AWARDS_PER_TEAM);

/**
 * The exact cover program's largest table, in cells (seat states times budget
 * plus 1 times reachable unpicked rivals). Every single event case of 2023 to
 * 2026 is at most about 11,400; above the cap the cover upper bound is used.
 */
export const EXACT_COVER_STATE_CAP = 250_000;

/**
 * What a rival holds only as a LISTED pick that is not confirmed, on an
 * alliance the routing has placed (quick task 261010-d7r, finding F-D; this
 * module's header).
 */
export interface JointLockListedOnly {
  /** The settled Playoffs value inside `extra` that the alliance listing the team would pay it: the placement's maximum, a settled value that is not exact. */
  readonly settled: number;
  /** That alliance is the decided winner, the one candidate of every frame. Being on it is the winner's fill in, not a points value. */
  readonly onWinner: boolean;
}

/** One points pool team: its floor at the position and the open ceiling the proof does not model itself. */
export interface JointLockRival {
  readonly teamKey: string;
  readonly floor: number;
  readonly extra: number;
  /**
   * Set where `extra` holds the settled Playoffs value of a placed alliance
   * that only LISTS the team (it holds 0 alliance selection points there and
   * is not among that alliance's `members`). The team was on that alliance
   * or never was, so the bound reads it at `extra` with no seat and at
   * `extra` minus `settled` on another alliance's seat, never at both
   * together; with `onWinner` it is read at `extra` minus `settled` and
   * counted through the winner's fill in. Absent: `extra` in every reading,
   * which is every rewound reading (an exact settled value is in the floor).
   */
  readonly listedOnly?: JointLockListedOnly;
}

/**
 * One DCMP alliance at the position. `members` are its LISTED picks (quick
 * task 261009-kt3, reading R8; the caller applies the rule). `spareSeats` is
 * how many backup seats it still has: the maximum alliance size minus its
 * CONFIRMED picks (alliance selection points posted and above 0, CONTEXT D10);
 * absent, the maximum alliance size minus `members`.
 */
export interface JointLockAlliance {
  readonly allianceNumber: number;
  readonly members: readonly string[];
  readonly spareSeats?: number;
}

/**
 * One scenario family of the proof: a candidate winner and what every other
 * alliance can be paid (this module's header, "Frames"). It holds these four
 * fields and nothing else: an alliance has ONE seat pool for the whole
 * championship (the backup robot rule), so a frame carries no second set of
 * seats, no seat bonus and no seat open to any rival.
 */
export interface JointLockFrame {
  /** The candidate winner, or `null` once the winner is posted. */
  readonly winner: number | null;
  /** The alliances that receive every ordered assignment of `placementPoints`. Each offers its spare seats once, at its assigned value. */
  readonly enumerated: readonly number[];
  /** Alliance -> the fixed value its members and its spare seats are paid. */
  readonly fixed: ReadonlyMap<number, number>;
  /** Backup robots on the winner (each takes a slot whatever its points), drawn from the rivals eligible in the winner's own seat group. */
  readonly fillIns: number;
}

/**
 * One SEAT GROUP (quick task 261009-tx9, the backup robot rule): the alliances
 * whose backup seats and fill ins one set of teams can take. At a divisioned
 * championship the caller builds one per division: its eight alliances, and
 * every team with a row at that division's key that no alliance there
 * confirmed, a listed pick that is not confirmed included (reading P3).
 */
export interface JointLockSeatGroup {
  /** The alliances of the group. Every alliance belongs to at most one group; an alliance in no group offers no seat. */
  readonly alliances: readonly number[];
  /** The teams that may take a backup seat or a fill in of an alliance of this group. */
  readonly eligible: readonly string[];
}

export interface JointLockInput {
  /** Every points pool team, T included. */
  readonly pool: readonly JointLockRival[];
  /** Prequalified teams not yet award qualified: they take a slot only by winning or by a consuming award (reading 3). */
  readonly slotOnlyRivals: readonly string[];
  /** S': `cmpSlots` minus the posted award qualifiers (`pointsRaceSlots(...).pointsSlots`). */
  readonly pointsSlots: number;
  /** Every alliance (eight at a single championship; every division's, with `divisionAllianceId` ids, at a divisioned one). */
  readonly alliances: readonly JointLockAlliance[];
  /** The alliances alive for the proof (reading 6). */
  readonly aliveAlliances: readonly number[];
  /** Every alliance that can still win, or `[null]` once the winner award is posted (reading 8). */
  readonly candidateWinners: readonly (number | null)[];
  /** The placement MAXIMA for second, third and fourth: `maxPlayoffPointsByPlacement(year, "dcmp", 2..4)`, never `playoffPoints`. */
  readonly placementPoints: readonly number[];
  /** C: the consuming awards still to be given out. */
  readonly consumingAwards: number;
  /** K: the judged awards still to be given out. `dcmpJudgedAwardCeiling()` at a single championship; at a divisioned one the caller sums it over the divisions, the whole ceiling for a division whose Awards are open and the ceiling minus the teams already carrying award points there (never below 0) for one whose Awards read final, and what is left there goes only to rivals `awardedRivals` does not name. */
  readonly judgedAwards: number;
  /** What one judged award pays at the DCMP (15 at 2026). */
  readonly judgedAwardPoints: number;
  /** TBA's largest alliance: a captain and three picks. */
  readonly maxAllianceSize: number;
  /** The scenario frames. Omitted for a single championship, where `singleChampionshipFrames` builds them. */
  readonly frames?: readonly JointLockFrame[];
  /**
   * The seat groups (the backup robot rule, this module's header). A backup
   * seat or a fill in of an alliance is taken only by a team eligible in the
   * alliance's own group. A team is eligible in every group that names it. A
   * pool or slot only rival on no alliance that NO group names is eligible in
   * EVERY group (reading P4), so the proof never rests on a competing team's
   * row being posted; a team an alliance lists that no group names is eligible
   * in none. A team that an alliance lists and a group names is a listed pick
   * that is not confirmed (reading P3): it counts as a member and as an
   * eligible team, and a frame whose winner lists T is not skipped when a
   * group names T. Absent or empty (a single championship, each championship
   * of a two championship district): ONE group of every alliance and every
   * rival on no alliance, which is the shipped loop.
   */
  readonly seatGroups?: readonly JointLockSeatGroup[];
  /**
   * The teams that hold a posted point paying award at a dcmp key whose Awards
   * read final at the position (quick task 261010-d7r, D1; this module's
   * header). Each has used its one judged award and its points are in its
   * floor, so the bound gives it no judged award from the remaining budget.
   * It still counts through a consuming award and as the winner's backup. T
   * may be named: the proof gives T no award either way. Absent: none, which
   * is every single championship input.
   */
  readonly awardedRivals?: readonly string[];
}

/** What the played playoff rows alone say about the DCMP bracket. */
export interface DcmpBracketState {
  /** Alliance numbers the routing has not placed. */
  readonly alive: readonly number[];
  /** The placement 1 alliance, once the final is decided. */
  readonly decidedWinner: number | undefined;
  readonly placementByAlliance: ReadonlyMap<number, number>;
}

/**
 * Routes the played rows. `undefined` when a row names an alliance that is not
 * one of its set's two participants (a mis-mapped row); the proof then does not
 * run. Any other error is rethrown.
 */
export function dcmpBracketState(playedMatches: readonly PlayedBracketMatch[], allianceNumbers: readonly number[]): DcmpBracketState | undefined {
  let placementByAlliance: ReadonlyMap<number, number>;
  try {
    placementByAlliance = routePlayedBracket(bracketDecisionsFromPlayedMatches(playedMatches)).placementByAlliance;
  } catch (error) {
    if (error instanceof InvalidBracketDecisionError) return undefined;
    throw error;
  }
  let decidedWinner: number | undefined;
  for (const [allianceNumber, placement] of placementByAlliance) if (placement === 1) decidedWinner = allianceNumber;
  return {
    alive: allianceNumbers.filter((allianceNumber) => !placementByAlliance.has(allianceNumber)),
    decidedWinner,
    placementByAlliance,
  };
}

/** Every ordered choice of `k` distinct items from `items`. */
function orderedSelections<T>(items: readonly T[], k: number): T[][] {
  const out: T[][] = [];
  const current: T[] = [];
  const used = new Array<boolean>(items.length).fill(false);
  const visit = (): void => {
    if (current.length === k) {
      out.push([...current]);
      return;
    }
    for (let index = 0; index < items.length; index++) {
      if (used[index]) continue;
      used[index] = true;
      current.push(items[index]!);
      visit();
      current.pop();
      used[index] = false;
    }
  };
  visit();
  return out;
}

/**
 * The judged awards a rival `deficit` points short of T's floor needs to reach
 * it, or `Infinity` when one award per rival cannot do it.
 */
function judgedCost(deficit: number, judgedAwardPoints: number): number {
  if (deficit <= 0) return 0;
  if (judgedAwardPoints <= 0) return Infinity;
  const cost = Math.ceil(deficit / judgedAwardPoints);
  return cost <= MAX_POINT_PAYING_AWARDS_PER_TEAM ? cost : Infinity;
}

/** What the cover programs know about each rival beyond its deficit, aligned with `deficits`. */
export interface CoverOptions {
  /**
   * True for a rival that already holds a posted award (quick task 261010-d7r,
   * D1): it takes no judged award, so it is covered only where it needs
   * nothing or where a seat's value alone reaches T. Absent: no rival is.
   */
  readonly awarded?: readonly boolean[];
  /**
   * Each rival's deficit where it takes a SEAT, never below its deficit alone
   * (quick task 261010-d7r, finding F-D): a listed pick that is not confirmed
   * gives up its placed alliance's settled value to sit on another alliance.
   * Absent: every rival's deficit is the same on a seat as alone. Read by the
   * exact program only; the upper bound reads the smaller deficit alone for
   * both, which only raises it.
   */
  readonly seatDeficits?: readonly number[];
}

/**
 * For the unpicked uncovered pool rivals (their deficits are fixed for one T),
 * the most of them the seats can cover together with at most `j` judged awards,
 * for every `j` from 0 to `budget`. An exact dynamic program over (seats used
 * per seat value, judged awards spent). A rival flagged in `options.awarded`
 * spends no judged award, and a rival with an entry in `options.seatDeficits`
 * is that far short of T on a seat. Exported for the cover upper bound's
 * dominance test.
 */
export function unpickedCover(
  deficits: readonly number[],
  seatValues: readonly number[],
  seatCounts: readonly number[],
  budget: number,
  judgedAwardPoints: number,
  options?: CoverOptions
): number[] {
  const radix: number[] = [];
  let stateCount = 1;
  for (const count of seatCounts) {
    radix.push(stateCount);
    stateCount *= count + 1;
  }
  const width = budget + 1;
  let dp = new Int16Array(stateCount * width).fill(-1);
  dp[0] = 0;
  const usage = (state: number, type: number): number => Math.floor(state / radix[type]!) % (seatCounts[type]! + 1);

  for (let index = 0; index < deficits.length; index++) {
    const deficit = deficits[index]!;
    const next = dp.slice();
    // D1: an awarded rival has used its one judged award, so what is left of its deficit must be 0 or below.
    const awarded = options?.awarded?.[index] === true;
    const costOf = (need: number): number => (awarded ? (need <= 0 ? 0 : Infinity) : judgedCost(need, judgedAwardPoints));
    const alone = costOf(deficit);
    // F-D: on a seat a listed only pick is read without its placed alliance's settled value.
    const onSeat = options?.seatDeficits?.[index] ?? deficit;
    const withSeat = seatValues.map((value) => costOf(onSeat - value));
    for (let state = 0; state < stateCount; state++) {
      for (let j = 0; j <= budget; j++) {
        const value = dp[state * width + j]!;
        if (value < 0) continue;
        if (alone !== Infinity && j + alone <= budget) {
          const at = state * width + j + alone;
          if (next[at]! < value + 1) next[at] = value + 1;
        }
        for (let type = 0; type < seatValues.length; type++) {
          const cost = withSeat[type]!;
          if (cost === Infinity || j + cost > budget) continue;
          if (usage(state, type) >= seatCounts[type]!) continue;
          const at = (state + radix[type]!) * width + j + cost;
          if (next[at]! < value + 1) next[at] = value + 1;
        }
      }
    }
    dp = next;
  }

  const best = new Array<number>(width).fill(0);
  for (let state = 0; state < stateCount; state++) {
    for (let j = 0; j <= budget; j++) {
      const value = dp[state * width + j]!;
      if (value > best[j]!) best[j] = value;
    }
  }
  for (let j = 1; j <= budget; j++) if (best[j - 1]! > best[j]!) best[j] = best[j - 1]!;
  return best;
}

/**
 * Reading R10 condition (a): the most deficits of `deficits` (any order) that
 * can each take a distinct seat worth at least `threshold(deficit)`. Deficits
 * are taken LARGEST threshold first and each is given the SMALLEST seat value
 * that suffices, which is a maximum matching on nested eligibility sets.
 * `seatValues` is sorted descending, `seatCounts` aligned with it.
 */
function greedySeatMatching(deficits: readonly number[], threshold: (deficit: number) => number, seatValues: readonly number[], seatCounts: readonly number[]): number {
  const remaining = [...seatCounts];
  const thresholds = deficits.map(threshold).sort((a, b) => b - a);
  let matched = 0;
  for (const need of thresholds) {
    for (let type = seatValues.length - 1; type >= 0; type--) {
      if (seatValues[type]! >= need && remaining[type]! > 0) {
        remaining[type]! -= 1;
        matched += 1;
        break;
      }
    }
  }
  return matched;
}

/**
 * The cover UPPER BOUND of reading R10, for every `j` from 0 to `budget`: never
 * below `unpickedCover`'s exact value (this module's header for the proof and
 * its three binding conditions).
 *
 * WITH AWARDED RIVALS (quick task 261010-d7r, D1, planner reading R4) it is
 * the sum of two upper bounds: this bound over the rivals that are not
 * awarded, with every seat, plus the most awarded rivals a seat alone can
 * cover, with every seat again (the same greedy matching, a maximum on these
 * nested eligibility sets). In any real cover the rivals that are not awarded
 * form a cover of their own and the awarded ones a seat matching of their
 * own, so the sum is never below the exact program.
 *
 * `options.seatDeficits` IS NOT READ (quick task 261010-d7r, finding F-D):
 * every rival is matched to a seat at its deficit alone, which is never above
 * its deficit on a seat, so the bound is never below the exact program that
 * reads both.
 */
export function coverUpperBound(
  deficits: readonly number[],
  seatValues: readonly number[],
  seatCounts: readonly number[],
  budget: number,
  judgedAwardPoints: number,
  options?: CoverOptions
): number[] {
  const flags = options?.awarded;
  if (flags !== undefined && flags.some((flag) => flag)) {
    const free = deficits.filter((_, index) => flags[index] !== true);
    const awarded = deficits.filter((_, index) => flags[index] === true);
    const seatOnly =
      awarded.filter((deficit) => deficit <= 0).length +
      greedySeatMatching(
        awarded.filter((deficit) => deficit > 0),
        (deficit) => deficit,
        seatValues,
        seatCounts
      );
    return coverUpperBound(free, seatValues, seatCounts, budget, judgedAwardPoints).map((value) => value + seatOnly);
  }
  const sorted = [...deficits].sort((a, b) => a - b);
  const award = judgedAwardPoints > 0 ? judgedAwardPoints * MAX_POINT_PAYING_AWARDS_PER_TEAM : 0;
  const width = budget + 1;
  const best = new Array<number>(width).fill(0);
  for (let k = 1; k <= sorted.length; k++) {
    const prefix = sorted.slice(0, k);
    const free = greedySeatMatching(prefix, (deficit) => deficit, seatValues, seatCounts);
    const alone = award > 0 ? prefix.filter((deficit) => deficit <= award).length : 0;
    const rest = award > 0 ? prefix.filter((deficit) => deficit > award) : prefix;
    const paidOrAlone = alone + greedySeatMatching(rest, (deficit) => deficit - award, seatValues, seatCounts);
    if (paidOrAlone !== k) continue;
    const awardsNeeded = k - free;
    for (let j = awardsNeeded; j <= budget; j++) if (k > best[j]!) best[j] = k;
  }
  for (let j = 1; j <= budget; j++) if (best[j - 1]! > best[j]!) best[j] = best[j - 1]!;
  return best;
}

/** The cover for one seat configuration: the exact program within `EXACT_COVER_STATE_CAP`, the upper bound above it. */
function seatAndJudgedCover(
  deficits: readonly number[],
  seatValues: readonly number[],
  seatCounts: readonly number[],
  budget: number,
  judgedAwardPoints: number,
  options?: CoverOptions
): number[] {
  let cells = (budget + 1) * Math.max(1, deficits.length);
  for (const count of seatCounts) cells *= count + 1;
  if (cells <= EXACT_COVER_STATE_CAP) return unpickedCover(deficits, seatValues, seatCounts, budget, judgedAwardPoints, options);
  return coverUpperBound(deficits, seatValues, seatCounts, budget, judgedAwardPoints, options);
}

/** The backup seats an alliance still has (CONTEXT D10): `spareSeats`, else the maximum size minus its members. */
function spareSeatsOf(alliance: JointLockAlliance | undefined, maxAllianceSize: number): number {
  if (alliance === undefined) return maxAllianceSize;
  return Math.max(0, alliance.spareSeats ?? maxAllianceSize - alliance.members.length);
}

/**
 * The single championship's frames: per candidate winner W, the alive
 * alliances other than W enumerated, nothing fixed, and W's spare seats as
 * fill ins against the uncovered unpicked rivals (with no seat group, the
 * rivals on no alliance). Exactly the shipped 261009-2tr loop.
 */
export function singleChampionshipFrames(input: JointLockInput): JointLockFrame[] {
  const byNumber = new Map(input.alliances.map((alliance) => [alliance.allianceNumber, alliance] as const));
  return input.candidateWinners.map((winner) => ({
    winner,
    enumerated: input.aliveAlliances.filter((allianceNumber) => allianceNumber !== winner),
    fixed: new Map(),
    fillIns: winner === null ? 0 : spareSeatsOf(byNumber.get(winner), input.maxAllianceSize),
  }));
}

/**
 * The joint bound for team T at floor `floor`: the most rivals that can take a
 * slot from it, maximized over every frame and every placement assignment. T
 * may be absent from the pool (the OBSERVER variant of a championship T does
 * not play, CONTEXT D5). `Infinity` with no frame; 0 when no frame is usable
 * for T, which is when every frame's winner lists T and no seat group names T
 * (reading P3). `stopAt` returns the first scenario value at or above it;
 * below it the exact maximum is returned.
 */
export function jointLockBoundAt(input: JointLockInput, teamKey: string, floor: number, stopAt = Infinity): number {
  const frames = input.frames ?? singleChampionshipFrames(input);
  if (frames.length === 0) return Infinity;
  const m = floor;

  const allianceByNumber = new Map<number, JointLockAlliance>();
  const allianceOfTeam = new Map<string, number>();
  for (const alliance of input.alliances) {
    allianceByNumber.set(alliance.allianceNumber, alliance);
    for (const member of alliance.members) if (!allianceOfTeam.has(member)) allianceOfTeam.set(member, alliance.allianceNumber);
  }
  const membersOf = (allianceNumber: number): readonly string[] => allianceByNumber.get(allianceNumber)?.members ?? [];
  const spareOf = (allianceNumber: number): number => spareSeatsOf(allianceByNumber.get(allianceNumber), input.maxAllianceSize);

  const rivals = input.pool.filter((rival) => rival.teamKey !== teamKey);
  const rivalKeys = new Set(rivals.map((rival) => rival.teamKey));
  const slotOnly = [...new Set(input.slotOnlyRivals)].filter((key) => key !== teamKey && !rivalKeys.has(key));
  const slotOnlySet = new Set(slotOnly);
  // D1 (quick task 261010-d7r, this module's header): the rivals that already
  // hold a posted point paying award. Each takes no judged award below, in the
  // two places one is spent: a picked rival's lift, and the seat and judged
  // award cover. The consuming awards and the fill ins still count it.
  const awardedSet = new Set(input.awardedRivals ?? []);
  // F-D (quick task 261010-d7r, this module's header): a listed pick that is
  // not confirmed, on a placed alliance, was on that alliance or never was.
  // ALONE it is read at `extra`; on another alliance's SEAT at `extra` minus
  // the settled value. The decided winner's such pick is read without the
  // settled value in both, and counted through the winner's fill in, but only
  // where every frame names that one winner; otherwise it is read as a rival
  // with no `listedOnly`, the reading of before this rule.
  const oneNamedWinner = frames.every((frame) => frame.winner !== null && frame.winner === frames[0]!.winner);
  const withoutSettled = (rival: JointLockRival): number => rival.floor + Math.max(0, rival.extra - rival.listedOnly!.settled);
  const alonePoints = rivals.map((rival) => (rival.listedOnly?.onWinner === true && oneNamedWinner ? withoutSettled(rival) : rival.floor + rival.extra));
  const seatPoints = rivals.map((rival) => (rival.listedOnly === undefined || (rival.listedOnly.onWinner && !oneNamedWinner) ? rival.floor + rival.extra : withoutSettled(rival)));

  // SEAT GROUPS (the backup robot rule, this module's header). A backup seat or a
  // fill in of an alliance is taken only by a team eligible in the alliance's own
  // group. A team is eligible in every group that names it. A rival on no alliance
  // that NO group names is eligible in EVERY group (reading P4); a team an alliance
  // lists that no group names is eligible in none. Absent or empty: one group of
  // every alliance and every rival on no alliance, which is the shipped single loop.
  const seatGroups = input.seatGroups !== undefined && input.seatGroups.length > 0 ? input.seatGroups : undefined;
  const groupCount = seatGroups === undefined ? 1 : seatGroups.length;
  const everyGroup: readonly number[] = Array.from({ length: groupCount }, (_, index) => index);
  const noGroup: readonly number[] = [];
  const groupByAlliance = new Map<number, number>();
  const namedGroups = new Map<string, number[]>();
  if (seatGroups !== undefined) {
    seatGroups.forEach((group, index) => {
      for (const allianceNumber of group.alliances) if (!groupByAlliance.has(allianceNumber)) groupByAlliance.set(allianceNumber, index);
      for (const key of group.eligible) {
        const named = namedGroups.get(key);
        if (named === undefined) namedGroups.set(key, [index]);
        else if (!named.includes(index)) named.push(index);
      }
    });
  }
  const groupOfAlliance = (allianceNumber: number): number | undefined => (seatGroups === undefined ? 0 : groupByAlliance.get(allianceNumber));
  const groupsOf = (key: string): readonly number[] => namedGroups.get(key) ?? (allianceOfTeam.has(key) ? noGroup : everyGroup);

  // A frame whose winner lists T qualifies T and is skipped, unless a seat group
  // names T: T is then only a LISTED pick there, may never have been on that
  // alliance, and the alliance may win without it (reading P3).
  const usable = frames.filter((frame) => frame.winner === null || !membersOf(frame.winner).includes(teamKey) || namedGroups.has(teamKey));
  if (usable.length === 0) return 0;

  // Every scenario covers a rival whose floor plus extra already reaches T.
  let alwaysCovered = 0;
  for (const points of alonePoints) if (points >= m) alwaysCovered += 1;
  if (alwaysCovered >= stopAt) return alwaysCovered;

  // Per group, the eligible pool rivals still short of T at floor plus extra,
  // whether or not an alliance also lists them (reading P3), and the eligible
  // slot only rivals. Fixed for this T: a seat pays its own value and never the
  // value of the alliance that lists the rival. A rival eligible in several
  // groups is entered in each, which only raises the bound. `seatDeficit` is
  // the rival's deficit ON A SEAT, which differs only for a listed only pick
  // (F-D) and is then the larger of the two.
  const seatRivals: { teamKey: string; deficit: number; seatDeficit: number; awarded: boolean }[][] = Array.from({ length: groupCount }, () => []);
  const slotOnlyByGroup: string[][] = Array.from({ length: groupCount }, () => []);
  rivals.forEach((rival, index) => {
    const deficit = m - alonePoints[index]!;
    if (deficit <= 0) return;
    const seatDeficit = m - seatPoints[index]!;
    const awarded = awardedSet.has(rival.teamKey);
    for (const group of groupsOf(rival.teamKey)) seatRivals[group]!.push({ teamKey: rival.teamKey, deficit, seatDeficit, awarded });
  });
  for (const key of slotOnly) for (const group of groupsOf(key)) slotOnlyByGroup[group]!.push(key);

  // Reading R11: the largest seat value over the placement values and every usable frame's fixed values.
  let maxSeatValue = Math.max(0, ...input.placementPoints);
  for (const frame of usable) for (const value of frame.fixed.values()) maxSeatValue = Math.max(maxSeatValue, value);
  // Reachable: one award alone covers the deficit, or the largest seat and one award cover the deficit on a seat.
  const reachable = (deficit: number, seatDeficit: number): boolean =>
    judgedCost(deficit, input.judgedAwardPoints) !== Infinity || judgedCost(seatDeficit - maxSeatValue, input.judgedAwardPoints) !== Infinity;
  // D1: an awarded rival is reachable only where a seat's value alone covers its deficit on a seat.
  const seatReachableEntries = seatRivals.map((list) => list.filter((entry) => (entry.awarded ? entry.seatDeficit <= maxSeatValue : reachable(entry.deficit, entry.seatDeficit))));
  const seatReachable = seatReachableEntries.map((list) => list.map((entry) => entry.deficit));
  // What the cover is told beyond the deficits, per group: nothing at all where no entry is awarded and none is a
  // listed only pick, so an input with neither takes the path of before quick task 261010-d7r untouched.
  const seatCoverOptions = seatReachableEntries.map((list): CoverOptions | undefined => {
    const anyAwarded = list.some((entry) => entry.awarded);
    const anyListedOnly = list.some((entry) => entry.seatDeficit !== entry.deficit);
    if (!anyAwarded && !anyListedOnly) return undefined;
    return {
      ...(anyAwarded ? { awarded: list.map((entry) => entry.awarded) } : {}),
      ...(anyListedOnly ? { seatDeficits: list.map((entry) => entry.seatDeficit) } : {}),
    };
  });
  const reachableCount = seatReachable.reduce((sum, list) => sum + list.length, 0);

  const placementValues = [...input.placementPoints].sort((a, b) => b - a);
  const budget = Math.max(0, input.judgedAwards);
  const coverCache = new Map<string, number[]>();
  const combinedCache = new Map<string, number[]>();
  // The judged budget is one pool shared by the groups (reading P8): the best split of `j` awards between two covers.
  const bestSplit = (a: readonly number[], b: readonly number[]): number[] => {
    const out = new Array<number>(budget + 1).fill(0);
    for (let j = 0; j <= budget; j++) {
      let top = 0;
      for (let i = 0; i <= j; i++) {
        const value = a[i]! + b[j - i]!;
        if (value > top) top = value;
      }
      out[j] = top;
    }
    return out;
  };

  let best = -Infinity;
  for (const frame of usable) {
    const { winner } = frame;
    const others = frame.enumerated.filter((allianceNumber) => allianceNumber !== winner && !frame.fixed.has(allianceNumber));
    const k = Math.min(placementValues.length, others.length);
    const winnerMembers = winner === null ? [] : membersOf(winner);
    const winnerSet = new Set(winnerMembers);
    let stepOne = 0;
    for (const member of winnerMembers) if (member !== teamKey && (rivalKeys.has(member) || slotOnlySet.has(member))) stepOne += 1;
    const fillIns = winner === null ? 0 : Math.max(0, frame.fillIns);
    // The fill in pool: the eligible rivals of the winner's own group that are not
    // its members. A backup on the winner takes a slot whatever its points.
    const winnerGroup = winner === null ? undefined : groupOfAlliance(winner);
    let fillInPool = 0;
    if (winnerGroup !== undefined) {
      for (const entry of seatRivals[winnerGroup]!) if (!winnerSet.has(entry.teamKey)) fillInPool += 1;
      for (const key of slotOnlyByGroup[winnerGroup]!) if (!winnerSet.has(key)) fillInPool += 1;
    }
    const others3 = input.consumingAwards + Math.min(fillIns, fillInPool);

    for (const selection of orderedSelections(others, k)) {
      const assigned = new Map<number, number>(frame.fixed);
      selection.forEach((allianceNumber, index) => assigned.set(allianceNumber, placementValues[index]!));

      let covered = stepOne;
      let uncovered = 0;
      const pickedCosts: number[] = [];
      for (let index = 0; index < rivals.length; index++) {
        const rival = rivals[index]!;
        if (winnerSet.has(rival.teamKey)) continue;
        const allianceNumber = allianceOfTeam.get(rival.teamKey);
        const points = alonePoints[index]! + (allianceNumber === undefined ? 0 : (assigned.get(allianceNumber) ?? 0));
        if (points >= m) {
          covered += 1;
          continue;
        }
        uncovered += 1;
        if (allianceNumber === undefined) continue; // on no alliance: the cached covers below
        // D1: an awarded rival has used its one judged award, and its alliance's value alone did not reach T.
        if (awardedSet.has(rival.teamKey)) continue;
        const cost = judgedCost(m - points, input.judgedAwardPoints);
        if (cost !== Infinity) pickedCosts.push(cost);
      }
      for (const key of slotOnly) if (!winnerSet.has(key)) uncovered += 1;

      // The seats a backup robot can still take, per group: every alliance with a
      // value above 0, at that value, its spare seats once. The winner carries no
      // value and so offers none; an alliance in no group offers none.
      const seatByGroup: Map<number, number>[] = Array.from({ length: groupCount }, () => new Map<number, number>());
      let totalSeats = 0;
      for (const [allianceNumber, value] of assigned) {
        const group = groupOfAlliance(allianceNumber);
        const count = spareOf(allianceNumber);
        if (group === undefined || value <= 0 || count <= 0) continue;
        const seats = seatByGroup[group]!;
        seats.set(value, (seats.get(value) ?? 0) + count);
        totalSeats += count;
      }

      // A cheap ceiling on this scenario: skip it when it cannot beat the best.
      const liftCeiling = Math.min(pickedCosts.length + reachableCount, budget + totalSeats);
      const ceiling = covered + Math.min(uncovered, liftCeiling + others3);
      if (ceiling <= best) continue;

      // Each group's cover on its own seats and its own eligible rivals, then the
      // best split of the judged budget between the groups.
      const groupKeys: string[] = [];
      const groupSeatValues: number[][] = [];
      const groupSeatCounts: number[][] = [];
      for (let group = 0; group < groupCount; group++) {
        const seats = seatByGroup[group]!;
        const seatValues = [...seats.keys()].sort((a, b) => b - a);
        const seatCounts = seatValues.map((value) => seats.get(value)!);
        groupSeatValues.push(seatValues);
        groupSeatCounts.push(seatCounts);
        groupKeys.push(`${group}:${seatValues.map((value, index) => `${value}x${seatCounts[index]}`).join(",")}`);
      }
      const combinedKey = groupKeys.join("|");
      let seatBest = combinedCache.get(combinedKey);
      if (seatBest === undefined) {
        let combined: number[] | undefined;
        for (let group = 0; group < groupCount; group++) {
          let cover = coverCache.get(groupKeys[group]!);
          if (cover === undefined) {
            cover = seatAndJudgedCover(seatReachable[group]!, groupSeatValues[group]!, groupSeatCounts[group]!, budget, input.judgedAwardPoints, seatCoverOptions[group]);
            coverCache.set(groupKeys[group]!, cover);
          }
          combined = combined === undefined ? cover : bestSplit(combined, cover);
        }
        seatBest = combined ?? new Array<number>(budget + 1).fill(0);
        combinedCache.set(combinedKey, seatBest);
      }
      pickedCosts.sort((a, b) => a - b);
      const pickedPrefix = [0];
      for (const cost of pickedCosts) pickedPrefix.push(pickedPrefix[pickedPrefix.length - 1]! + cost);
      const pickedBest = (remaining: number): number => {
        let count = 0;
        while (count < pickedCosts.length && pickedPrefix[count + 1]! <= remaining) count += 1;
        return count;
      };
      let lifted = 0;
      for (let j = 0; j <= budget; j++) lifted = Math.max(lifted, seatBest[j]! + pickedBest(budget - j));

      const total = covered + Math.min(uncovered, lifted + others3);
      if (total >= stopAt) return total;
      if (total > best) best = total;
    }
  }
  return best;
}

/**
 * The joint bound for one pool team: `jointLockBoundAt` at its own floor.
 * `Infinity` for a team outside the pool or with no candidate winner.
 */
export function jointLockBound(input: JointLockInput, teamKey: string, stopAt = Infinity): number {
  const self = input.pool.find((rival) => rival.teamKey === teamKey);
  if (self === undefined || input.candidateWinners.length === 0) return Infinity;
  return jointLockBoundAt(input, teamKey, self.floor, stopAt);
}

/** Every pool team the joint proof locks: its bound is below `pointsSlots`. Empty when no alliance can win. */
export function jointLockedTeams(input: JointLockInput): ReadonlySet<string> {
  const locked = new Set<string>();
  if (input.candidateWinners.length === 0) return locked;
  for (const rival of input.pool) {
    if (jointLockBound(input, rival.teamKey, input.pointsSlots) < input.pointsSlots) locked.add(rival.teamKey);
  }
  return locked;
}

// ---------------------------------------------------------------------------
// When the proof stops (quick task 261010-d7r, findings F-B and F-C)
// ---------------------------------------------------------------------------

/**
 * WHETHER THE PROOF STILL RUNS for a championship whose own Awards may read
 * final: true unless the championship's own Awards are final AND no other
 * dcmp key's Awards are still open. So the proof stops only once EVERY key's
 * Awards are final. The caller asks it per championship: for a divisioned
 * championship the "own" Awards are its finals event's and the other keys are
 * its divisions; for two championships each is asked against the other.
 *
 * WHY. Until quick task 261010-d7r the proof stopped at the FIRST key whose
 * Awards read final: a divisioned championship's at its finals' Awards, two
 * championships' at either one's. But awards flags turn true one event at a
 * time and in no fixed order, and while another key's Awards are open the
 * ceiling test alone still gives every rival of that key its whole award
 * ceiling. It cannot hold what the proof held, so a Locked the proof gave a
 * tick before was taken back. Two findings of that task's planner, both in
 * the code of before it:
 *
 *   - F-B, a divisioned championship: the finals' awards flag turns true
 *     while a division's is not yet true. With this rule switched off, the
 *     awards order lattice of `scripts/champJointMonotone.test.ts` loses 306
 *     Locked over the 16 divisioned championships of 2023 to 2026, every one
 *     at that edge (63 over the 12 two division championships; the four FIM
 *     seasons 24, 80, 49 and 90). The planner's micro step walks read the
 *     same 306.
 *   - F-C, two championships (2026 California): one championship is wholly
 *     final while the other stands at a sweep stop. With this rule switched
 *     off the proof goes from applied to `noBracketFacts` at all 14 such
 *     edges and 91 Locked are lost.
 *
 * WHAT THE CALLER HANDS THE PROOF PAST A FINAL FLAG is its own business
 * (`champLedgerStatus.ts`, decision 5): no consuming award for a championship
 * whose own Awards are final, and for a finished championship of two an input
 * with no alliance and its Winner counted.
 */
export function jointProofStillRuns(championshipAwardsFinal: boolean, anotherKeysAwardsOpen: boolean): boolean {
  return !championshipAwardsFinal || anotherKeysAwardsOpen;
}

// ---------------------------------------------------------------------------
// Divisioned championships (261009-kt3 CONTEXT D4 and readings R6 to R8, under
// the backup robot rule of quick task 261009-tx9)
// ---------------------------------------------------------------------------

/** A division alliance's id, unique across divisions: `d * 10 + n`, d the 1 based division index in sorted key order. */
export function divisionAllianceId(divisionIndex: number, allianceNumber: number): number {
  return divisionIndex * 10 + allianceNumber;
}

/** One division at the position, in `divisionAllianceId` ids. */
export interface DivisionJointState {
  /** Every alliance of the division. */
  readonly alliances: readonly number[];
  /** The alliances alive for the proof (reading 6); empty once the division's Playoffs are final. */
  readonly alive: readonly number[];
  /** The division's routed winner, once its final is decided. */
  readonly decidedWinner: number | undefined;
}

/** What `divisionedJointFrames` reads: the divisions, the finals routing, and each alliance's one seat pool. */
export interface DivisionedJointStructure {
  readonly divisions: readonly DivisionJointState[];
  /** Division winner id -> its finals placement, for the winners the finals routing places. */
  readonly finalsPlacementByAlliance: ReadonlyMap<number, number>;
  /** The finals' Playoffs are final at the position. */
  readonly finalsElimFinal: boolean;
  /** The winner award (at the finals key) is posted at the position. */
  readonly winnerPosted: boolean;
  /** What a division champion is paid at most: `maxPlayoffPointsByPlacement(year, "dcmp", 1)`. */
  readonly divisionChampionMax: number;
  /** The finals maxima by placement: `maxFinalsPointsByPlacement(year, D, 1..D)`. */
  readonly finalsMaxByPlacement: readonly number[];
  readonly membersByAlliance: ReadonlyMap<number, readonly string[]>;
  /**
   * The alliance's ONE seat pool for the whole championship, division playoffs
   * and finals together (the backup robot rule): the maximum alliance size
   * minus the alliance's CONFIRMED picks (reading R8 guard G1 and CONTEXT D10).
   */
  readonly spareByAlliance: ReadonlyMap<number, number>;
  readonly maxAllianceSize: number;
}

export type DivisionedJointFrames =
  | { readonly frames: JointLockFrame[]; readonly candidateWinners: (number | null)[]; readonly aliveAlliances: number[] }
  | { readonly refused: "winnerNotPosted" | "noCandidateWinner" };

/**
 * The divisioned championship's frames (this module's header, "Frames", steps
 * 1 to 3; the caller adds the seat groups of step 4). Candidates: `[null]`
 * once the winner award is posted; the routed finals champion alone once the
 * finals name one; with the finals' Playoffs final and neither,
 * `winnerNotPosted`; otherwise each division's decided winner not yet placed
 * below first in the finals, or every alive alliance of a division with no
 * decided winner.
 *
 * Per candidate W the frame holds W, the other alive alliances of W's division
 * enumerated, every alive alliance of another division fixed at the division
 * champion maximum plus the finals non champion maximum, a decided winner of
 * another division fixed at its finals value, and W's spare seats as its fill
 * ins. Nothing else: an alliance has one backup for the whole championship.
 */
export function divisionedJointFrames(structure: DivisionedJointStructure): DivisionedJointFrames {
  const { divisions, finalsPlacementByAlliance, finalsElimFinal } = structure;
  const spare = (id: number): number =>
    Math.max(0, structure.spareByAlliance.get(id) ?? structure.maxAllianceSize - (structure.membersByAlliance.get(id)?.length ?? 0));
  const aliveAlliances = divisions.flatMap((division) => [...division.alive]).sort((a, b) => a - b);
  let champion: number | undefined;
  for (const [id, placement] of finalsPlacementByAlliance) if (placement === 1) champion = id;

  let candidateWinners: (number | null)[];
  if (structure.winnerPosted) candidateWinners = [null];
  else if (champion !== undefined) candidateWinners = [champion];
  else if (finalsElimFinal) return { refused: "winnerNotPosted" };
  else {
    candidateWinners = [];
    for (const division of divisions) {
      if (division.decidedWinner !== undefined) {
        if (!finalsPlacementByAlliance.has(division.decidedWinner)) candidateWinners.push(division.decidedWinner);
      } else candidateWinners.push(...division.alive);
    }
  }
  if (candidateWinners.length === 0) return { refused: "noCandidateWinner" };

  // F_nw: the most a finals non champion is paid, while the finals' Playoffs are open.
  const finalsNonChampionMax = finalsElimFinal ? 0 : Math.max(0, ...structure.finalsMaxByPlacement.slice(1));
  const frames: JointLockFrame[] = candidateWinners.map((winner) => {
    const winnerDivision = winner === null ? -1 : divisions.findIndex((division) => division.alliances.includes(winner));
    const fixed = new Map<number, number>();
    let enumerated: number[] = [];
    divisions.forEach((division, index) => {
      if (index === winnerDivision) {
        // W's division: the other alive alliances are enumerated, and a seat on one pays its assigned value only.
        enumerated = division.alive.filter((id) => id !== winner);
        return;
      }
      // Another division: an alive alliance may win it and be the finalist. Its seats are offered once, at this value.
      for (const id of division.alive) fixed.set(id, structure.divisionChampionMax + finalsNonChampionMax);
      const decided = division.decidedWinner;
      if (decided !== undefined && !division.alive.includes(decided)) {
        const placement = finalsPlacementByAlliance.get(decided);
        const value = finalsElimFinal ? 0 : placement === undefined ? finalsNonChampionMax : (structure.finalsMaxByPlacement[placement - 1] ?? 0);
        if (value > 0) fixed.set(decided, value);
      }
    });
    // W's one seat pool is its fill ins: a backup on W qualifies with the champion.
    return { winner, enumerated, fixed, fillIns: winner === null ? 0 : spare(winner) };
  });
  return { frames, candidateWinners, aliveAlliances };
}

// ---------------------------------------------------------------------------
// Multiple championships (CONTEXT D5, reading R9)
// ---------------------------------------------------------------------------

/**
 * The bound for T across independent championships: the sum of one bound per
 * championship, T's floor read from the first pool holding it (a rival with no
 * championship row is in every pool at the same floor), the observer bound for
 * every championship T does not play. `Infinity` when no pool holds T.
 */
export function jointLockBoundMultiple(championships: readonly JointLockInput[], teamKey: string, stopAt = Infinity): number {
  const holder = championships.find((input) => input.pool.some((rival) => rival.teamKey === teamKey));
  if (holder === undefined) return Infinity;
  const floor = holder.pool.find((rival) => rival.teamKey === teamKey)!.floor;
  let sum = 0;
  for (const input of championships) {
    if (input.candidateWinners.length === 0) return Infinity;
    sum += jointLockBoundAt(input, teamKey, floor, stopAt - sum);
    if (sum >= stopAt) return sum;
  }
  return sum;
}

/** Every team in any championship's pool whose summed bound is below `pointsSlots`. */
export function jointLockedTeamsMultiple(championships: readonly JointLockInput[], pointsSlots: number): ReadonlySet<string> {
  const locked = new Set<string>();
  const keys = new Set(championships.flatMap((input) => input.pool.map((rival) => rival.teamKey)));
  for (const teamKey of keys) if (jointLockBoundMultiple(championships, teamKey, pointsSlots) < pointsSlots) locked.add(teamKey);
  return locked;
}
