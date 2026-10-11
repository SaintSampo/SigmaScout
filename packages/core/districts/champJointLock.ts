/**
 * THE JOINT WORST CASE LOCK PROOF at the Championship tier (quick task
 * 261009-2tr), generalized to divisioned and multiple championships by quick
 * task 261009-kt3, its divisioned frames brought in line with the verified
 * backup robot rule by quick task 261009-tx9, made monotone over the order a
 * championship's facts arrive in by quick task 261010-d7r, and made to count
 * every rival ONCE, by one exact matching, by quick task 261010-l0s. Pure, no
 * I/O, no zod, no React; its only import is the `./bracket.js` sibling.
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
 *     awards are given out, and the bound adds the POINTS of at most
 *     `MAX_POINT_PAYING_AWARDS_PER_TEAM` award to a rival: one judged award,
 *     the one its own event can give it (FIRST's judging rule is one judged
 *     award per team per event, and the finals of a divisioned championship
 *     give none). A consuming award is counted as a SLOT, whatever its
 *     winner's points. So nothing here rests on a team never holding both.
 *     At one event no team does. Across a division and its finals a team
 *     has held both six times, in 2017 and 2018 ("NOT A FACT THE PROOF RESTS
 *     ON" below), and such a team takes one slot, through the consuming
 *     awards.
 *   - A rival that already holds a posted award, in its floor, at a key
 *     whose Awards read final, has had that event's one judged award and
 *     takes no other (`awardedRivals`; quick task 261010-d7r, the section "A
 *     RIVAL THAT HOLDS A POSTED AWARD TAKES NO FURTHER JUDGED AWARD" below).
 *   - A listed pick that is not confirmed, on an alliance the routing has
 *     placed, either was on that alliance or never was: it is paid that
 *     alliance's settled value, or it takes another alliance's seat, never
 *     both (`listedOnly`; the same task, the section "A LISTED PICK THAT IS
 *     NOT CONFIRMED" below).
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
 *   5. a pool rival lifted to T's floor by one judged award on top of what it
 *      has, by a seat on a losing alliance, or by a seat and one judged award.
 *
 * The rivals of 4 and 5 are ONE ALLOCATION of the scenario's resources: W's f
 * fill ins, each losing alliance's spare seats at its value, and the K judged
 * awards, each rival taking at most one fill in or one seat and at most one
 * award. The matching (the section "THE MATCHING" below) returns M, the most
 * rivals ANY such allocation covers, so the real one covers no more. The real
 * takers are therefore at most `|covered| + min(|X|, M + C)`, and the bound
 * is the maximum of that over the scenarios.
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
 * against the uncovered unpicked rivals, which are the shipped loop's
 * scenarios, and the single sweep reproduces its numbers.
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
 * READING P3, A LISTED PICK THAT IS NOT CONFIRMED IS A HINDSIGHT FACT. (This
 * reading is about an alliance its division has NOT placed. Once the alliance
 * is placed the same team is read by the rule of the section "A LISTED PICK
 * THAT IS NOT CONFIRMED IS PAID ITS DECIDED ALLIANCE'S VALUE OR TAKES ANOTHER
 * SEAT, NEVER BOTH" below.) On an
 * alliance its division has not placed, the caller lists such a team among
 * the members (its reading R8), and a seat group names it too. The bound
 * reads BOTH futures and counts the team ONCE (quick task 261010-l0s): as a
 * member paid its alliance's scenario value (it stays as that alliance's one
 * backup), OR as an eligible team of its division at floor plus extra with no
 * alliance value, on another alliance's seat or as W's fill in (it was never
 * on that alliance). Until that task it was entered on both sides, as a
 * member and in its division's cover, and one rival could be counted twice.
 * A listed pick of W itself is counted with W's members and takes no other
 * part. The same two futures hold for T itself: a frame whose winner only
 * LISTS T is NOT skipped when a seat group names T, because T may never have
 * been on that alliance, so its win does not qualify T. Quick task 261009-kt3
 * skipped that frame, which left one future uncovered: an alliance that lists
 * T wins without it.
 *
 * READING P4, A RIVAL THAT NO GROUP NAMES IS ELIGIBLE IN EVERY GROUP. A pool
 * or slot only rival on no alliance that no group names (no row is known for
 * it at any division) is offered every division's seats and every candidate
 * winner's fill in, and still counts through a consuming award and through
 * one judged award alone. The proof therefore never rests on a competing
 * team's row being posted. It is still ONE rival and takes at most one seat,
 * whichever division's (quick task 261010-l0s; until then it was entered in
 * every group's cover and could be counted once per group). A team an
 * alliance lists that no group names (a confirmed pick) is eligible nowhere.
 *
 * THE JUDGED BUDGET STAYS ONE POOL shared by the groups (reading P8): one
 * matching holds every group's seats and every eligible rival, each seat open
 * only to the rivals eligible in its own group, and spends the one budget
 * wherever it covers the most.
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
 * that hold no posted award (rule D1 of quick task 261010-d7r, the section "A
 * RIVAL THAT HOLDS A POSTED AWARD TAKES NO FURTHER JUDGED AWARD" below); a
 * rival can win only its own division's, so sharing is a relaxation).
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
 * and false before: six times a team held a division judged award and then won
 * a consuming award at the finals of the same championship (2017 FIM frc2834,
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
 * SOUND AND MONOTONE: THE FOUR RULES OF QUICK TASK 261010-d7r, AND THEIR LIMITS
 * ---------------------------------------------------------------------------
 *
 * THE CLAIM above is SOUNDNESS: at one reading the bound is never below a
 * legal future. The site reads again a minute later with one more fact in,
 * and a team shown Locked must stay Locked. That is MONOTONICITY: over one
 * more fact no team's margin (the points slots minus its bound) drops.
 * Soundness does not give it. A bound may be loose at one reading and looser
 * at the next, and a team locked between the two loses its lock though
 * nothing was ever unsound. Four rules of that task close the four places it
 * was measured to fail, each held by a test that fails with the rule
 * switched off (`scripts/champJointMonotone.test.ts`):
 *
 *   1. A rival that holds a posted award takes no further judged award (D1,
 *      the next section). Switched off, Locked teams are lost when a
 *      division's awards flag turns true: 952 over the awards order lattice
 *      of the 16 divisioned championships of 2023 to 2026 (957 until quick
 *      task 261010-l0s made every rival count once).
 *   2. A divisioned championship's proof stops only once EVERY key's Awards
 *      are final (finding F-B, `jointProofStillRuns` below). Switched off,
 *      306 are lost where the finals' flag turns true before a division's.
 *   3. Two championships' proof stops only once BOTH are final, and the
 *      finished one's input needs no bracket (finding F-C, the same
 *      function; the input is the caller's, decision 5 of
 *      `apps/web/src/components/districts/champLedgerStatus.ts`). Switched
 *      off, 91 are lost on 2026 California.
 *   4. A listed pick that is not confirmed is paid its decided alliance's
 *      value or takes another seat, never both (finding F-D, the section
 *      after next). Switched off, no Locked team is lost on any walk and 25
 *      team margins drop.
 *
 * A fifth change of that task is an EARLINESS rule and is not in this
 * module: the divisioned proof runs before the finals key is on the artifact
 * (`finalsBracket.ts`, "THE FINALS EVENT NOT YET ON THE WIRE"). It has no
 * switch in that test file; an equivalence gate and the live walks hold it.
 *
 * THEIR LIMITS, STATED:
 *
 *   - Rule 2's caller hands the proof NO consuming award once the finals'
 *     Awards read final. That rests on the awards flag meaning every
 *     consuming award is listed, the limit decision 2's reservation already
 *     has (`eventAwards.ts`, "the rule's limits": a consuming award listed
 *     after the list has settled). Stated, not closed.
 *   - Monotone over the facts WALKED: every played playoff row, every
 *     category's points, every awards flag in every order, the finals facts
 *     before, between and after the flags, a Winner listed before the
 *     playoff points, a division's award points before its playoff points,
 *     the last key's rows arriving mid playoffs. NOT walked: the published
 *     capacities changing during a championship, an alliance list changing
 *     after a pick, a row or a point withdrawn, a key's playoff points
 *     landing in part, a further recipient of an award type already listed,
 *     and the FIM seasons before 2026 one fact at a time (their rewound
 *     lattices are read).
 *   - Two edges are FORCED in that file and pinned as not required, because
 *     a rule elsewhere excludes each: a division's awards flag true before
 *     its playoff points (the merge's flag rule waits for a playoff point at
 *     its live vantage, the Worker's; the offline publisher's hindsight
 *     vantage does not wait, so a district publish run from a corpus taken
 *     DURING a live championship could raise the flag that way: since
 *     quick task 261010-jyn that publisher skips a district while one of
 *     its events is live), and a proven field read
 *     unproven again (the field proof's count never rises while rows are
 *     only added). Each loses Locked teams when forced.
 *   - The sweeps over finished seasons check none of rules 2 to 4. They
 *     moved at ten rows for rule 1 and at no row after it, which shows only
 *     that no rewound stop changed. The lattices and the live walks of that
 *     file are what hold rules 2 to 4.
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
 * judged award. It is a fact about ONE event. It says nothing about a
 * consuming award at the finals, which the next paragraph leaves alone.
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
 * no bound rises over that tick. Since quick task 261010-l0s that holds for
 * the team whose own award posts as well as for every other team (the section
 * "EVERY RIVAL IS COUNTED ONCE" below, and its test). Until then a team's own
 * posting could raise its own bound by one: its floor passed a rival that
 * was then counted on a seat and again as the winner's backup.
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
 * no settled value, so its `extra` held nothing of the Playoffs. Like a
 * placed alliance's reading (the rival reads the same alone and no nearer to
 * T on a seat), it is never above the reading of before this rule: every
 * role the rival can take without its settled value it could take with it.
 * `champJointLock.test.ts` holds both at none on 500 seeded instances. Until
 * quick task 261010-l0s the winner's reading could read higher, at 10 team
 * bounds of those instances: a rival that dropped from "its points reach T"
 * to "short of T, on no alliance" joined the winner's fill in pool and was
 * counted there beside a seat that lifted the same rival.
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
 * EVERY RIVAL IS COUNTED ONCE (quick task 261010-l0s)
 * ---------------------------------------------------------------------------
 *
 * WHAT WAS WRONG. Until that task a scenario's count was a sum of terms
 * worked out apart from each other, and three of them could hold the SAME
 * rival:
 *
 *   - the winner's fill in was added beside the seat and judged award cover,
 *     so a rival a seat could lift and the winner could also call up counted
 *     twice;
 *   - a rival no seat group names (reading P4) was entered in EVERY group's
 *     cover and could be lifted once per group;
 *   - a listed pick that is not confirmed, on an alliance still in its
 *     bracket (reading P3), counted as a member at its alliance's value and
 *     again on a seat of its division.
 *
 * Each only raised the bound, so none was ever unsound. But a rival AHEAD of
 * T by its floor counts exactly once whatever else is true of it. So when T's
 * own points rose past such a rival, the rival went from one count to two or
 * more, and T's bound ROSE on T's own good news. The verifier of quick task
 * 261010-d7r found it (its warning W1: a team's own award posting raised its
 * own bound by 1). The planner of this task read it on seeded instances of
 * every shape, a team's own floor raised and nothing else changed: 283 of
 * 65,292 comparisons on single championships, 1,787 of 114,382 on divisioned
 * ones, 413 of 135,816 on two championships, the largest rise 5.
 *
 * A CAP WAS TRIED AND IS NOT ENOUGH. Holding a scenario's count to the number
 * of DISTINCT rivals it can reach leaves rises in every shape. The smallest:
 * T, one free rival a seat can lift, two picked rivals each one judged award
 * short, one award to give, a winner with one spare seat. As T gains one
 * point and passes the free rival, the capped count still goes 3 then 4 (the
 * free rival on the seat AND as the winner's backup, beside one picked rival
 * with the award: three distinct rivals, so the cap does not bind), where no
 * future holds more than 3.
 *
 * THE RULE. Every rival is ONE entity of ONE matching (the section "THE
 * MATCHING" below) and takes at most one resource. A scenario's count is the
 * exact maximum over every allocation the facts above allow, and no more.
 * `champJointLock.test.ts` holds the bound EQUAL to that maximum, enumerated
 * by code that shares nothing with this module, on small seeded instances of
 * the single and the divisioned shape.
 *
 * WHAT FOLLOWS FROM IT, each an exact zero over at least 300,000 seeded
 * comparisons in `champJointLock.test.ts` ("over seeded transitions of every
 * shape: ..."):
 *
 *   - A TEAM'S OWN POINTS NEVER RAISE ITS OWN BOUND, by any amount. An
 *     allocation that covers a set of rivals against the higher floor covers
 *     at least that set against the lower one, so the maximum cannot rise.
 *     The same holds where the points are the team's own judged award: the
 *     budget drops by one and the team is named in `awardedRivals`, neither
 *     of which raises a count.
 *   - ANOTHER TEAM'S JUDGED AWARD POSTING NEVER RAISES A BOUND. The posted
 *     points (at most one judged award's) enter that team's floor, it is
 *     named in `awardedRivals` and the budget drops by one. Hand the award
 *     back to it out of a budget one larger and every allocation of after the
 *     posting is an allocation of before it covering the same rivals. (Until
 *     this task it could raise one: 10 of 391,941 seeded comparisons, each a
 *     listed pick that is not confirmed posting, then counted as a member
 *     and again on a seat.)
 *
 * WHAT "MONOTONE" STILL RESTS ON WALKS FOR. Everything else one more fact can
 * bring: a played row (an alliance placed, a settled value, a candidate
 * winner gone), a stage turning final, an awards flag and what the caller
 * hands the proof past it, the finals facts, the field proof. Those change
 * the SHAPE of the input, not one team's floor or one posted award, and no
 * argument in this module covers them. They are held edge by edge by
 * `scripts/champJointMonotone.test.ts`, with the limits stated above.
 *
 * THE ONE RISE THAT WAS LEFT WAS IN WHAT THE CALLER HANDED THIS MODULE, and
 * the same task closed it there (the section "A PICK TBA HAS PAID FOR AN
 * ALLIANCE'S PLAYOFFS IS ON THAT ALLIANCE" at the end of this header). That
 * file reads a bound only up to 12 above the points slots. Read exactly, a
 * bound still rose by one at the tick a key's playoff points land after its
 * playoffs are done, where the decided winner lists a team that holds no
 * alliance selection points and TBA then pays that team for the winner's
 * playoffs. Measured by the planner of that task before the rule: 20 team
 * bounds over 5 edges of the 32 one event walks, each 14 or more above its
 * points slots (2024fnc, 2025fin, 2026fnc, 2026ca), no team shown Locked on
 * any walk, and a six team input built that way did take a Locked back.
 *
 * WHAT IT MOVED. No stop of any sweep: over the 364 inputs the joint sweep
 * hands the proof (48 championships of 2023 to 2026), read up to 12 above
 * the points slots, 28 team bounds at 16 divisioned stops are lower by one
 * (each stop carries a listed pick that is not confirmed, now counted once)
 * and none is higher; the locked set is the same at all 364. Read exactly,
 * deep in the pack, a bound drops by more: by 15 for one team of 2026 FIM
 * after Round 4, where rivals no group names had been counted in each of
 * the four divisions.
 *
 * ---------------------------------------------------------------------------
 * THE MATCHING (quick task 261010-l0s; it replaces the per group cover
 * programs and the cover upper bound of reading R10)
 * ---------------------------------------------------------------------------
 *
 * WHAT IT ANSWERS. In one scenario (a frame and one placement assignment),
 * the most rivals still short of T that the seats, the judged awards and the
 * winner's fill ins can cover together, for every judged budget from 0 to K
 * (`coverMatching`).
 *
 * THE ENTITIES. Every rival short of T at floor plus extra that is eligible
 * in at least one seat group, and every slot only rival eligible in one, is
 * ONE entity, in however many groups it is eligible. A confirmed pick (on an
 * alliance, named by no group) is not an entity: it has one way up, its
 * alliance's value and one judged award, and the scenario loop counts it
 * beside the matching, out of the same budget.
 *
 * THE RESOURCES, and what each costs an entity in judged awards:
 *
 *   - a SEAT TYPE, one per seat group and seat value, as many as the spare
 *     seats of that group's alliances paid that value. Open only to an
 *     entity eligible in that group. It costs 0 where the value alone covers
 *     the entity's deficit ON A SEAT, 1 where one judged award more does and
 *     the entity is not awarded, and is closed otherwise;
 *   - ONE JUDGED AWARD ALONE, on top of what the entity already has: its
 *     floor plus extra, and for a listed pick that is not confirmed (reading
 *     P3) the scenario value of the alliance that lists it. It costs 1, and
 *     is closed to an awarded entity and to a slot only one;
 *   - THE WINNER'S FILL INS, as many as the frame gives. Each costs 0 and is
 *     open to every entity eligible in the winner's own group.
 *
 * Every entity takes at most ONE resource. A listed pick of the winner is
 * left out (it is counted with the winner's members), and so is a listed
 * pick whose alliance's value already reaches T (it is counted as covered).
 *
 * HOW. A minimum cost flow by successive shortest paths, the entities with
 * the same costs merged into one type. The k th unit of flow is the k th
 * rival covered and its cost is the judged awards it adds to the cheapest
 * way of covering k rivals, so the answer for a budget j is the most rivals
 * whose cost is at most j. It is exact at every size. The program of before
 * this task was a table over one seat group that grew with the pool, and
 * above a size cap an upper bound stood in for it; both are gone.
 *
 * ONE BINDING CONDITION is kept from reading R10: a resource costs 0 or 1,
 * which is at most ONE judged award's points per rival, so
 * `assertOneAwardPerRival(MAX_POINT_PAYING_AWARDS_PER_TEAM)` runs at module
 * load and throws unless the constant is 1.
 *
 * THE CONSUMING AWARDS STAY OUTSIDE IT. A consuming award covers ANY rival
 * still short of T, so C more are covered while any are left.
 *
 * READING R11 NO LONGER DECIDES A COUNT. A seat is a resource at its own
 * value in its own frame, a fixed value above every placement value
 * included, so no filter on "reachable" rivals stands in front of the
 * matching. The largest value over the placement values and EVERY usable
 * frame's fixed values is still read, for the cheap ceiling alone: it says
 * which scenarios are worth working out and never what one counts.
 *
 * HELD BY TEST (`champJointLock.test.ts`): the matching against every
 * assignment enumerated on small cost tables; against the exact dynamic
 * program of before this task on one seat group (kept in the test file as
 * the reference), plain, with awarded flags and with seat deficits; and the
 * whole bound against the exhaustive maximum of the model. Those three read
 * a future the way this module does, as an allocation. ONE TEST DOES NOT:
 * "brute force soundness over rule legal futures with TWO seat groups"
 * enumerates FUTURES themselves (who sits where, per frame and per order of
 * the enumerated alliances) on 39,751 small seeded instances with two seat
 * groups, one or two frames, awarded rivals, listed picks, listed only
 * picks, rivals no group names and slot only rivals, and calls nothing of
 * this module but `jointLockBound`. No rule legal future of 5,656,885 puts
 * more rivals ahead of T than the bound, and on this module's own reading
 * of a listed pick's seat the bound is reached at every instance.
 *
 * ---------------------------------------------------------------------------
 * A PICK TBA HAS PAID FOR AN ALLIANCE'S PLAYOFFS IS ON THAT ALLIANCE (quick
 * task 261010-l0s, finding F2; `confirmedPicks`)
 * ---------------------------------------------------------------------------
 *
 * WHAT WAS WRONG. An alliance's seats are counted from its CONFIRMED picks
 * (CONTEXT D10 of quick task 261009-kt3): the maximum alliance size minus
 * them. Until that task a pick was confirmed by its alliance selection
 * points alone, and a backup holds none. While its key's Playoffs are open
 * the proof still reads such a pick once: it is a listed pick that is not
 * confirmed, counted through the alliance that lists it or on one other
 * seat, never both (finding F-D and readings P3 and R7 above). At the tick
 * the key's playoff points land that reading ends. TBA's payment is in the
 * team's floor, the team is a plain rival, and the seat it holds on its own
 * alliance still counted as OPEN. Where that alliance is the decided winner
 * the winner's fill in then covered one MORE rival beside it, which no
 * future can do: the winner already has its four teams. The bound rose by
 * one under every team the paid pick had just passed.
 *
 * THE RULE. Of the teams an alliance lists, the confirmed ones are those
 * that hold alliance selection points at that key AND those TBA has paid
 * playoff points for that alliance's playoffs (`confirmedPicks`). The caller
 * reads the payment off the rows at the position, and only where that key's
 * Playoffs are final there:
 *
 *   - at a single championship, and at each of two championships, at the
 *     alliance's own key;
 *   - at a division, at the division's own key; and for the division's
 *     decided winner at the finals key too, once the finals' Playoffs are
 *     final. The winner's backup may have joined only for the finals, on no
 *     list of the division: a team with a row at that division's key that
 *     no alliance there lists and that the finals have paid is counted as
 *     the winner's pick.
 *
 * THE GATE (CONTEXT D5 of that task). The caller reads a payment once the
 * key's Playoffs read final at the position AND the team's own row at the
 * key carries playoff points above 0. At the live position that stage is
 * the FIELD saying the key's playoffs are done with the winner's playoff
 * value on a row there, or the key's awards posted
 * (`corroboratedCategoryFinality`, quick task 261009-vp9); at a rewound stop
 * it is the stop's own stage. MEMBERSHIP IS SOUND EITHER WAY: only a team
 * that played for an alliance is paid, whenever its row is read. What the
 * gate adds is that every team's payment is on its row, and so in its
 * floor, from the tick the stage turns final. That rests on TBA posting an
 * event's playoff points together, the assumption quick task 261009-vp9
 * states plainly (`categoryCorroboration.ts`, "THE ASSUMPTION THAT
 * REMAINS"). It is checked on the walks and not proven. Were a payment to
 * land later than that, its pick would be confirmed later: a seat closed
 * later, which is sound.
 *
 * TWO GUARDS, each on the side with the larger bound (CONTEXT D5 of that
 * task; both are the caller's, `champLedgerStatus.ts`):
 *
 *   - A payment confirms a listed pick only where the lists of its key
 *     name that team EXACTLY ONCE. A team two lists name played for one of
 *     them at most and the rows do not say which, so it is confirmed on
 *     neither, both seats stay open, and it is a plain rival with its
 *     payment in its floor.
 *   - The finals name a division winner's backup only where EXACTLY ONE
 *     unlisted team of that division was paid at the finals. The winner has
 *     one seat left at most, so with two or more nobody is named, the seat
 *     stays open and each stays an eligible team of its division.
 *
 * Confirming a pick only ever closes a seat, so holding one back can only
 * raise a bound. Neither case is in the data: over the 89 championship tier
 * keys of 2023 to 2026 no team of the 1,937 on a key's lists is named twice
 * there, and no division of 40 has an unlisted team paid at the finals.
 * Each guard is held by tests of the status code
 * (`champLedgerStatus.test.ts`: "guard one", "guard one at a division" and
 * "guard two"), and each of those fails with its guard taken out.
 *
 * WHY IT IS SOUND, in every shape. Playoff points at a key are paid only to
 * a team that played for an alliance there, and a team is on one alliance at
 * most. So a team an alliance lists that is paid at that alliance's key
 * played for THAT alliance: it is a member and holds one of its seats. (The
 * caller's facts are refused, and the proof does not run, wherever the field
 * shows a team on another alliance than the one that lists it:
 * `dcmpBracketFactsFor`.) An
 * alliance has at most `maxAllianceSize` teams over the whole championship,
 * its one backup included (the backup robot rule above), so a seat with a
 * named holder is open to nobody else. At the finals only the division
 * winners play and a backup comes from its alliance's own division's
 * unselected teams, so a team of a division that the finals have paid and
 * that no alliance of the division lists is that division's winner's
 * backup. NOTHING IS CLOSED WITHOUT A HOLDER. A listed pick TBA has paid
 * nothing stays a listed pick that is not confirmed and its seat stays open
 * (frc4405 at 2024 FIM was paid nothing at its division and nothing at the
 * finals, and holds the Winner award all the same). A division winner with
 * no backup keeps its spare seat until the finals have paid one, since it
 * may still take its one backup there.
 *
 * A WIDER RULE WAS WEIGHED AND NOT TAKEN: every seat of a key closed once
 * its Playoffs are final. It is false at a division, whose winner may still
 * take a backup for the finals. At a single championship it would close the
 * winner's seat without naming who holds it, and a member of the winning
 * alliance that TBA paid nothing would then be counted nowhere.
 *
 * WHY THE TICK IS MONOTONE NOW. After the tick the paid pick is a member. On
 * the winner it is counted with the winner's members, once, and the fill in
 * it holds is gone. On another alliance it is read at its own floor, with
 * that alliance's value still to come where there is one (a division winner
 * in the finals). Before the tick the proof already read the same team
 * there: through the winner's fill in, on that alliance's own seat, or at
 * the placed alliance's settled maximum, which is never below what TBA then
 * pays. So every allocation of after the tick is an allocation of before it
 * that covers the same rivals.
 *
 * WHAT IT RESTS ON BEYOND THE RULES, AND ITS ONE STATED LIMIT: TBA's own
 * alliance lists, with the field's backups appended (a backup seen on a
 * played row joins its alliance's list, `dcmpBracketFactsFor`). A team TBA
 * paid at a single championship that NO alliance lists and no played row
 * shows is confirmed nowhere and its alliance's seat stays open, which is
 * sound and would still let a bound rise by one at that tick. The same is
 * true wherever one of the two guards above holds a team back: the reading
 * there is the one of before this rule.
 *
 * MEASURED by the planner of that task over the 89 championship tier keys
 * of 2023 to 2026: of 894 teams paid playoff points at a championship or
 * division key, none is on no alliance's list;
 * the rule confirms 18 picks, 9 of them on the alliance placed first, every
 * one seen on the field beside a team of the alliance that lists it; and of
 * 60 teams paid at a finals key every one is on its division winner's list,
 * so the finals reading named no team in those four seasons.
 *
 * WHAT IT CLOSED AND WHAT IT MOVED. The planner of that task read every
 * rules on edge of groups A to D of `scripts/champJointMonotone.test.ts`
 * once with every bound exact and the rule on, the FIM seasons included:
 * 8,785 edges with the proof running on both sides, 2,712,435 team bounds,
 * none higher. With the rule switched off the 20 rises of the one event
 * walks are back, over the same 5 edges (group E of that file reads those
 * 32 walks exactly both ways every time it runs). No line of any sweep
 * moved and no Locked team of any walk was lost. SIX TEAMS ARE SHOWN LOCKED
 * EARLIER, and nothing else moved over the 5,256 readings of the 58 live
 * walks, read team by team: each is the paid backup of a decided winner,
 * Locked where it had waited for its Winner award to be listed, and each
 * holds that award at the season's end. Five at single championships, from
 * the tick the playoff points land (2023pnw frc1983, 2024fnc and 2026fnc
 * frc6639, 2025fin frc1747, 2026ca frc3512), and frc8724 at 2026 NE, from
 * the tick the finals' state is written
 * (`scripts/champFieldStagedWalk.test.ts` names that one). Held by
 * `champJointLock.test.ts` (the six team input), by
 * `champLedgerStatus.test.ts` (the tick through the status code, at a
 * single championship and at a divisioned one's finals) and by that file.
 */
import { bracketDecisionsFromPlayedMatches, InvalidBracketDecisionError, routePlayedBracket, type PlayedBracketMatch } from "./bracket.js";

/**
 * The bound adds the points of at most ONE award to a rival in any future.
 *
 * PER EVENT a team receives a consuming award or one judged award, never both
 * and never two (Jacob, 2026-10-09). FIRST's judging rule is one judged award
 * per team per event, and TBA's district point rows agree: since 2023 none of
 * about 8,800 team event rows carries two awards' points (69 did in 2016 to
 * 2020, 1 in 2022). A rule change is what the corpus sweep
 * (`scripts/measureChampJointLocks.ts`) would catch.
 *
 * ACROSS A DIVISION AND ITS FINALS "never both" is false, and the constant
 * does not rest on it (premise P1 of quick task 261010-d7r): six times, at
 * 2017 and 2018 FIM, a team won a division judged award and then a consuming
 * award at the finals of the same championship. What the constant counts is award
 * POINTS added to a rival, and only a judged award's are ever added: a
 * consuming award takes a slot whatever its winner's points and is counted as
 * a slot. A rival can be given a judged award by one event alone, its own
 * (the finals give none), so one award's points is still the most.
 */
export const MAX_POINT_PAYING_AWARDS_PER_TEAM = 1;

/**
 * The matching's one binding condition (this module's header, "THE
 * MATCHING"; reading R10 (b) until quick task 261010-l0s): a seat or an award
 * costs an entity 0 or 1 judged award, which is one judged award's points per
 * rival at most, so the bound is sound only while
 * `MAX_POINT_PAYING_AWARDS_PER_TEAM` is 1. Throws an Error naming the constant
 * otherwise. Called at module load.
 */
export function assertOneAwardPerRival(value: number): void {
  if (value !== 1) {
    throw new Error(
      `champJointLock: MAX_POINT_PAYING_AWARDS_PER_TEAM is ${String(value)}, but the matching prices a seat or an award at one judged award per rival at most; rework coverMatching's costs before changing it`
    );
  }
}
assertOneAwardPerRival(MAX_POINT_PAYING_AWARDS_PER_TEAM);

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
   * that is not confirmed (reading P3): it is read as a member OR as an
   * eligible team, never both, and a frame whose winner lists T is not
   * skipped when a group names T. Absent or empty (a single championship, each championship
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

/** The backup seats an alliance still has (CONTEXT D10): `spareSeats`, else the maximum size minus its members. */
function spareSeatsOf(alliance: JointLockAlliance | undefined, maxAllianceSize: number): number {
  if (alliance === undefined) return maxAllianceSize;
  return Math.max(0, alliance.spareSeats ?? maxAllianceSize - alliance.members.length);
}

/**
 * The single championship's frames: per candidate winner W, the alive
 * alliances other than W enumerated, nothing fixed, and W's spare seats as
 * fill ins against the uncovered unpicked rivals (with no seat group, the
 * rivals on no alliance). The scenarios of the shipped 261009-2tr loop.
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
 * One team the matching may still cover (this module's header, "THE
 * MATCHING"): a rival short of T at floor plus extra that is eligible in at
 * least one seat group, or a slot only rival eligible in one.
 */
interface CoverEntity {
  readonly teamKey: string;
  /** Points short of T at floor plus extra. Above 0 for a pool rival; unused for a slot only one. */
  readonly deficit: number;
  /** Points short of T on another alliance's SEAT (finding F-D), never below `deficit`. */
  readonly seatDeficit: number;
  /** It already holds a posted award (D1): no judged award. */
  readonly awarded: boolean;
  /** The seat groups it is eligible in. */
  readonly groups: readonly number[];
  /** A slot only rival: the winner's fill in or a consuming award, never points. */
  readonly slotOnly: boolean;
  /** The alliance that lists it, for a listed pick that is not confirmed (reading P3). */
  readonly listedOn: number | undefined;
}

/**
 * THE MATCHING (quick task 261010-l0s; this module's header). `rows[i][r]` is
 * what resource `r` costs entity `i` in judged awards: 0 where the resource
 * covers the entity as it stands, 1 where it covers it with one judged award,
 * `Infinity` where it cannot. `capacities[r]` is how many entities resource
 * `r` can take. Every entity takes at most ONE resource. Returns, for every
 * `j` from 0 to `budget`, the most entities covered with at most `j` judged
 * awards spent.
 *
 * A minimum cost flow by successive shortest paths, entities with the same
 * row merged into one type: the k th unit of flow is the k th entity covered,
 * each path is a cheapest way to cover one more, and path costs never fall
 * from one path to the next, so the first path that would overspend the
 * budget ends the search. Exported for its own tests.
 */
export function coverMatching(rows: readonly (readonly number[])[], capacities: readonly number[], budget: number): number[] {
  const resourceCount = capacities.length;
  // The types: the entities with the same row, found by walking a trie of the
  // row's entries (0, 1, or closed: `Infinity`, or a resource with no room).
  // `children` holds three slots a node; `typeOfNode` the type a full row ends on.
  const children: number[] = [-1, -1, -1];
  const typeOfNode = new Map<number, number>();
  const costs: number[][] = [];
  const left: number[] = [];
  // A caller may hand ONE array for every entity with the same row (the proof does, for the entities only a fill in
  // can cover): the same array again is the same type again, with no walk.
  let lastRow: readonly number[] | undefined;
  let lastType = -1;
  for (const row of rows) {
    if (row === lastRow) {
      if (lastType !== -1) left[lastType]! += 1;
      continue;
    }
    lastRow = row;
    lastType = -1;
    let node = 0;
    let usable = false;
    for (let r = 0; r < resourceCount; r++) {
      const cost = capacities[r]! > 0 ? row[r]! : Infinity;
      if (cost !== 0 && cost !== 1 && cost !== Infinity) throw new Error(`champJointLock: the matching was handed the cost ${String(cost)}, which is not 0, 1 or Infinity`);
      if (cost !== Infinity) usable = true;
      const slot = node * 3 + (cost === 0 ? 0 : cost === 1 ? 1 : 2);
      let next = children[slot]!;
      if (next === -1) {
        next = children.length / 3;
        children[slot] = next;
        children.push(-1, -1, -1);
      }
      node = next;
    }
    if (!usable) continue;
    let type = typeOfNode.get(node);
    if (type === undefined) {
      type = costs.length;
      typeOfNode.set(node, type);
      costs.push(row.map((cost, r) => (capacities[r]! > 0 ? cost : Infinity)));
      left.push(0);
    }
    left[type]! += 1;
    lastType = type;
  }
  const typeCount = costs.length;
  const room = [...capacities];
  const flow: number[][] = costs.map(() => new Array<number>(resourceCount).fill(0));
  const best = new Array<number>(budget + 1).fill(0);
  let matched = 0;
  let spent = 0;
  for (;;) {
    // Bellman-Ford over the residual graph: a type with entities left starts at 0, a type to a resource costs the
    // row's entry, a resource back to a type it already serves gives that entry back.
    const distType = new Array<number>(typeCount).fill(Infinity);
    const distResource = new Array<number>(resourceCount).fill(Infinity);
    const viaType = new Array<number>(resourceCount).fill(-1);
    const viaResource = new Array<number>(typeCount).fill(-1);
    for (let t = 0; t < typeCount; t++) if (left[t]! > 0) distType[t] = 0;
    let changed = true;
    for (let pass = 0; changed && pass <= typeCount + resourceCount; pass++) {
      changed = false;
      for (let t = 0; t < typeCount; t++) {
        const from = distType[t]!;
        if (from === Infinity) continue;
        const row = costs[t]!;
        for (let r = 0; r < resourceCount; r++) {
          const cost = row[r]!;
          if (cost !== Infinity && from + cost < distResource[r]!) {
            distResource[r] = from + cost;
            viaType[r] = t;
            changed = true;
          }
        }
      }
      for (let r = 0; r < resourceCount; r++) {
        const from = distResource[r]!;
        if (from === Infinity) continue;
        for (let t = 0; t < typeCount; t++) {
          if (flow[t]![r]! <= 0) continue;
          const back = from - costs[t]![r]!;
          if (back < distType[t]!) {
            distType[t] = back;
            viaResource[t] = r;
            changed = true;
          }
        }
      }
    }
    let end = -1;
    for (let r = 0; r < resourceCount; r++) if (room[r]! > 0 && distResource[r]! < (end === -1 ? Infinity : distResource[end]!)) end = r;
    if (end === -1) break;
    const step = distResource[end]!;
    if (spent + step > budget) break;
    // The most units this path takes: the resource's room, the entities left at its start, the flow it turns back.
    let units = room[end]!;
    for (let r = end; ; ) {
      const t = viaType[r]!;
      const back = viaResource[t]!;
      if (back === -1) {
        units = Math.min(units, left[t]!);
        break;
      }
      units = Math.min(units, flow[t]![back]!);
      r = back;
    }
    if (step > 0) units = Math.min(units, Math.floor((budget - spent) / step));
    if (units <= 0) throw new Error("champJointLock: the matching found a path that carries nothing");
    room[end]! -= units;
    for (let r = end; ; ) {
      const t = viaType[r]!;
      flow[t]![r]! += units;
      const back = viaResource[t]!;
      if (back === -1) {
        left[t]! -= units;
        break;
      }
      flow[t]![back]! -= units;
      r = back;
    }
    for (let unit = 0; unit < units; unit++) {
      matched += 1;
      spent += step;
      if (matched > best[spent]!) best[spent] = matched;
    }
  }
  for (let j = 1; j <= budget; j++) if (best[j - 1]! > best[j]!) best[j] = best[j - 1]!;
  return best;
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
  // two places one is spent: a confirmed pick's lift, and the matching's
  // costs. The consuming awards and the fill ins still count it.
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

  // THE ENTITIES OF THE MATCHING (quick task 261010-l0s, this module's header).
  // Every rival still short of T at floor plus extra that is eligible in at
  // least one seat group is ONE entity, in however many groups it is eligible,
  // and every slot only rival eligible in one is too. Fixed for this T. A
  // confirmed pick (on an alliance, named by no group) is not an entity: the
  // scenario loop reads it through its alliance's value and one judged award.
  // A listed pick that is not confirmed (on an alliance AND named by a group,
  // reading P3) IS one: a scenario reads it as a member of the alliance that
  // lists it or on another seat, never both. `seatDeficit` is the rival's
  // deficit ON A SEAT, which differs only for a listed only pick (F-D) and is
  // then the larger of the two.
  const entities: CoverEntity[] = [];
  rivals.forEach((rival, index) => {
    const deficit = m - alonePoints[index]!;
    if (deficit <= 0) return;
    const groups = groupsOf(rival.teamKey);
    if (groups.length === 0) return;
    entities.push({ teamKey: rival.teamKey, deficit, seatDeficit: m - seatPoints[index]!, awarded: awardedSet.has(rival.teamKey), groups, slotOnly: false, listedOn: allianceOfTeam.get(rival.teamKey) });
  });
  for (const key of slotOnly) {
    const groups = groupsOf(key);
    if (groups.length > 0) entities.push({ teamKey: key, deficit: Infinity, seatDeficit: Infinity, awarded: true, groups, slotOnly: true, listedOn: undefined });
  }
  const entityKeys = new Set(entities.map((entity) => entity.teamKey));
  const listedEntities = entities.filter((entity) => entity.listedOn !== undefined);

  const placementValues = [...input.placementPoints].sort((a, b) => b - a);
  const budget = Math.max(0, input.judgedAwards);
  // What covering `need` more points costs in judged awards. D1: an awarded rival has used its one judged award.
  const costOf = (need: number, awarded: boolean): number => (awarded ? (need <= 0 ? 0 : Infinity) : judgedCost(need, input.judgedAwardPoints));
  // The matching's answer for every budget, by what it depends on: the frame's fill ins, every group's seats, and the
  // scenario value of each alliance that lists an entity.
  const profileCache = new Map<string, number[]>();
  // FOR THE CHEAP CEILING ONLY (it decides which scenarios are worked out, never what one counts): the entities a seat
  // or an award can reach in SOME scenario. The largest value any seat or listing alliance can carry is the largest
  // placement value or fixed value of a usable frame (reading R11 of quick task 261009-kt3, which filtered the cover's
  // rivals by it until quick task 261010-l0s).
  let largestValue = Math.max(0, ...input.placementPoints);
  for (const frame of usable) for (const value of frame.fixed.values()) largestValue = Math.max(largestValue, value);
  let reachableCount = 0;
  for (const entity of entities) if (!entity.slotOnly && costOf(entity.deficit - largestValue, entity.awarded) !== Infinity) reachableCount += 1;

  let best = -Infinity;
  for (const frame of usable) {
    const { winner } = frame;
    const others = frame.enumerated.filter((allianceNumber) => allianceNumber !== winner && !frame.fixed.has(allianceNumber));
    const k = Math.min(placementValues.length, others.length);
    const winnerMembers = winner === null ? [] : membersOf(winner);
    const winnerSet = new Set(winnerMembers);
    let stepOne = 0;
    for (const member of winnerMembers) if (member !== teamKey && (rivalKeys.has(member) || slotOnlySet.has(member))) stepOne += 1;
    // The winner's fill ins: backups on the winner, each an eligible team of the
    // winner's own seat group that is not its member, each a slot whatever its
    // points. A winner in no group has none to give.
    const winnerGroup = winner === null ? undefined : groupOfAlliance(winner);
    const fillIns = winner === null || winnerGroup === undefined ? 0 : Math.max(0, frame.fillIns);
    const winnerListsAnEntity = entities.some((entity) => winnerSet.has(entity.teamKey));
    const frameKey = `${fillIns > 0 ? `F${String(winnerGroup)}x${String(fillIns)}` : ""}${winnerListsAnEntity ? `W${String(winner)}` : ""}`;

    for (const selection of orderedSelections(others, k)) {
      const assigned = new Map<number, number>(frame.fixed);
      selection.forEach((allianceNumber, index) => assigned.set(allianceNumber, placementValues[index]!));

      let covered = stepOne;
      let uncovered = 0;
      let pickedCount = 0;
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
        if (allianceNumber === undefined || entityKeys.has(rival.teamKey)) continue; // an entity of the matching below
        // A confirmed pick still short of T: one judged award on top of its alliance's value is its one way up.
        // D1: an awarded rival has used its one judged award, and its alliance's value alone did not reach T.
        if (awardedSet.has(rival.teamKey)) continue;
        if (judgedCost(m - points, input.judgedAwardPoints) !== Infinity) pickedCount += 1;
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
      const liftCeiling = Math.min(pickedCount + reachableCount + Math.min(fillIns, entities.length), budget + totalSeats + fillIns);
      const ceiling = covered + Math.min(uncovered, liftCeiling + input.consumingAwards);
      if (ceiling <= best) continue;

      // THE MATCHING'S RESOURCES: one seat type per group and value with its
      // count, then one judged award alone, then the winner's fill ins.
      const seatGroupOf: number[] = [];
      const seatValueOf: number[] = [];
      const capacities: number[] = [];
      let key = frameKey;
      for (let group = 0; group < groupCount; group++) {
        const seats = seatByGroup[group]!;
        const values = [...seats.keys()].sort((a, b) => b - a);
        for (const value of values) {
          seatGroupOf.push(group);
          seatValueOf.push(value);
          capacities.push(seats.get(value)!);
        }
        key += `|${String(group)}:${values.map((value) => `${String(value)}x${String(seats.get(value))}`).join(",")}`;
      }
      // A listed pick that is not confirmed is read as a member at its listing alliance's value in THIS scenario.
      for (const entity of listedEntities) key += `;${winnerSet.has(entity.teamKey) ? "w" : String(assigned.get(entity.listedOn!) ?? 0)}`;
      let profile = profileCache.get(key);
      if (profile === undefined) {
        const seatCount = capacities.length;
        const aloneAt = seatCount;
        const fillAt = seatCount + 1;
        const closedRow = (): number[] => new Array<number>(seatCount + 2).fill(Infinity);
        // The row of an entity only the winner's fill in can cover. One array for all of them: rows are only read.
        const fillOnlyRow = closedRow();
        fillOnlyRow[fillAt] = 0;
        const rows: number[][] = [];
        for (const entity of entities) {
          if (winnerSet.has(entity.teamKey)) continue; // a listed pick of the winner: counted with the winner
          const fillOpen = fillIns > 0 && entity.groups.includes(winnerGroup!);
          let row: number[] | undefined;
          if (!entity.slotOnly) {
            // Alone it has its floor plus extra, and as a listed pick the value of the alliance that lists it.
            const alone = entity.deficit - (entity.listedOn === undefined ? 0 : (assigned.get(entity.listedOn) ?? 0));
            if (alone <= 0) continue; // that alliance's value reaches T: counted as covered above
            const aloneCost = costOf(alone, entity.awarded);
            if (aloneCost !== Infinity) {
              row = closedRow();
              row[aloneAt] = aloneCost;
            }
            // On a seat it has the seat's value and nothing of the alliance that lists it (never both).
            for (let seat = 0; seat < seatCount; seat++) {
              if (!entity.groups.includes(seatGroupOf[seat]!)) continue;
              const seatCost = costOf(entity.seatDeficit - seatValueOf[seat]!, entity.awarded);
              if (seatCost === Infinity) continue;
              row ??= closedRow();
              row[seat] = seatCost;
            }
          }
          if (row === undefined) {
            if (fillOpen) rows.push(fillOnlyRow);
            continue; // no seat, no award and no fill in reaches it: a consuming award is its one way
          }
          if (fillOpen) row[fillAt] = 0;
          rows.push(row);
        }
        profile = coverMatching(rows, [...capacities, rows.length, fillIns], budget);
        profileCache.set(key, profile);
      }
      // The confirmed picks one judged award short share the budget with the matching.
      let lifted = 0;
      for (let j = 0; j <= budget; j++) lifted = Math.max(lifted, profile[j]! + Math.min(pickedCount, budget - j));

      // A consuming award covers any rival still short of T.
      const total = covered + Math.min(uncovered, lifted + input.consumingAwards);
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
// Which listed picks are on their alliance for certain (quick task 261010-l0s,
// finding F2)
// ---------------------------------------------------------------------------

/**
 * THE PICKS OF AN ALLIANCE THAT ARE ON IT FOR CERTAIN, and so are its members
 * and hold its seats (this module's header, "A PICK TBA HAS PAID FOR AN
 * ALLIANCE'S PLAYOFFS IS ON THAT ALLIANCE"). Of the teams the alliance lists:
 * those that hold alliance selection points there (CONTEXT D10 of quick task
 * 261009-kt3), and those TBA has paid playoff points for that alliance's
 * playoffs. The caller reads both facts off the rows at the position; this is
 * the one rule that joins them, in the list's own order.
 */
export function confirmedPicks(listed: readonly string[], holdsAllianceSelectionPoints: (teamKey: string) => boolean, paidForItsPlayoffs: (teamKey: string) => boolean): string[] {
  return listed.filter((teamKey) => holdsAllianceSelectionPoints(teamKey) || paidForItsPlayoffs(teamKey));
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
