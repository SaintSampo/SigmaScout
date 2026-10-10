/**
 * The five statuses at the FIRST Championship tier, at one position.
 *
 * ONE PURE MODULE, no React, mirroring `districtLedgerStatus.ts`'s shape and
 * defining NO lock rule of its own: every verdict comes from
 * `packages/core/districts/locks.ts`, the award vocabulary from
 * `qualification.ts` and the ceilings from `pointModel.ts`.
 *
 * THE DECISIONS THIS MODULE TAKES, all stated here because a reader will
 * otherwise wonder why it differs from the district tier's module:
 *
 * 1. IN RANGE / OUT OF RANGE IS DECIDED BY RANK, not by `>=` a cut line. The
 *    district tab reports the friendlier side for a team exactly at the line,
 *    on `locks.ts`'s tie philosophy. At the champ tier that would put BOTH
 *    teams tied at the 2026 PNW cut line In range and 22 teams into 21 slots.
 *    So a pool team is In range when its 1-based position in the champ
 *    ledger's own sorted order, restricted to the pool, is at most
 *    `pointsSlots`. The district tab's rule is untouched, and `floorCutLine`
 *    keeps `cutLinePointsWithQualifiers`' own semantics. Neither rule decides
 *    the PREDICTED CUTOFF the tab prints: that is derived from this ordering
 *    by `predictedCutoff.ts` and moves no chip.
 *
 * 2. THE CHAMP TIER RESERVES ITS OWN SLOTS AND PASSES NO POOLED ARGUMENT.
 *    Until quick task 261006-3gg this tier reserved nothing, on the reading
 *    that the DCMP's consuming qualifications were "a different tier with a
 *    different slot pool". They are — and that pool is exactly the one this
 *    module's `"locked"` test is about. A DCMP winning alliance member or a
 *    judged consuming award winner takes a Championship slot whatever its
 *    points, so a rival whose ceiling sits below a team's floor, never a
 *    threat to the ceiling test, can still take a slot out from under it.
 *    FNC 2026 at the "playoffs done, awards open" stop showed frc7890 Locked
 *    with 10 threats against 11 slots; four of the five judged consuming
 *    awards then went to teams below 7890's floor. The sweep in
 *    `scripts/measureChampTenets.ts` found nine such displays across the
 *    published seasons. `packages/core/districts/champReservedSlots.ts` owns
 *    the rule (the winning alliance while the playoffs are open, every judged
 *    consuming award at its historical ceiling while the awards are open,
 *    nothing once the awards are final); this module owns only the DCMP's
 *    stage at the position, read off the rows, and the subtraction. The
 *    reservation feeds `lockSlots` alone, exactly as the district tier's does:
 *    `"eliminated"`, `floorCutLine` and the In range rank rule stay on the
 *    unreserved count. `pooledLockInputs` still models district event point
 *    pools only, so no pooled argument is passed. At an all-final position the
 *    reservation is zero and `data/fixtures/phase10/district-2026pnw.json`
 *    reproduces exactly as before — `{locked: 12, lockedAward: 8, contending:
 *    2, eliminated: 104}`, cut line 182.
 *
 * 3. IN RANGE / OUT OF RANGE, AS SHOWN, CUT AT THE SIMULATED LINE (quick task
 *    260927-6bf, decision L2). Decision 1's rank rule above is the VERDICT the
 *    rest of the tab and the champ run read. What the chips SHOW comes from
 *    `applyChampRangeState`, below, over the one `champRangeState` the cutoff
 *    view also reads: until the DCMP awards post, a contending team is In
 *    range iff its median is at or above the simulated line, and while that
 *    line is still being computed (Jacob's 2026-09-27 chip timing decision) or
 *    cannot be drawn at all, the two chips read a neutral placeholder or No
 *    call, never the rank rule. Once the awards post, nothing is drawn any
 *    more and the rank rule stands.
 *
 * 4. A TEAM KNOCKED OUT OF THE PLAYOFFS HAS ITS PLAYOFF POINTS SETTLED AT ONCE
 *    (quick task 261008-26o). FNC 2026 at the DCMP Round 5 stop had six teams
 *    at 99% and none Locked, because every team, an alliance already out
 *    included, kept the whole 3x Playoffs ceiling (90 in 2026) until the
 *    Finals posted. A source whose alliance's bracket placement is decided
 *    now carries `settledElim` from the row builder's one derivation
 *    (`settledPlayoffPoints`), and it replaces the whole Playoffs ceiling:
 *    TBA's exact number joins the floor, a placement table value joins only
 *    the ceiling, because TBA prorates a team that sat out part of the
 *    playoffs (frc3663 at 2026pncmp, fourth place alliance worth 21, was paid
 *    12). A team left off every alliance is not settled: a backup robot is
 *    called from that pool and paid for its share. The award ceiling and
 *    decision 2's reservation are unchanged. A placement table value enters
 *    the ceiling at the placement's MAXIMUM, `SettledPlayoffs.ceiling` (quick
 *    task 261009-2tr, CONTEXT D7): the manual's wording (section 11.1.3, 5
 *    points for each Finals match won) would allow a losing finalist that won
 *    one Finals match 75 at a 2026 DCMP, where its cell prints 60. TBA has
 *    paid every one of the 329 measured losing finalists with a Finals win
 *    the base value (261 district tier and 68 DCMP tier, 2023 to 2026,
 *    measured 2026-10-09 in quick task 261009-tx8) and none above it; the 13
 *    rows at base 25 are members of the winning alliance that played in one
 *    of its two Finals wins. The 25 (75) maximum is kept as the safe side: a
 *    ceiling that is too high only delays a lock.
 *
 *    EVERY DCMP SOURCE IS FOLDED (quick task 261009-kt3, CONTEXT D3). A team
 *    at a divisioned championship carries its division row and, once TBA pays
 *    it there, a finals row (2026 frc27: micmp1 66, 48, 90, 0 and micmp 0, 0,
 *    60, 30). Each source's open categories leave the floor at its own stage.
 *    A finals source's Qualification and Alliance selection ceilings are 0. Its
 *    Playoffs ceiling is the finals champion maximum (60 at four divisions, 30
 *    at two), for a team with a division source at that championship only,
 *    and is never settled from a bracket. Its Awards ceiling is 0 (the next
 *    paragraph). A division team with no finals row carries the finals
 *    champion maximum while the finals' Playoffs are open
 *    (`champFinalsCeilingWithoutRow`), since TBA writes a finals row only once
 *    it pays one. Each DCMP award is gated on its OWN event's stage: the winner
 *    and consuming awards of a divisioned championship are given at its finals.
 *
 *    THE FINALS READ THE SAME WAY WITH AND WITHOUT A ROW (quick task
 *    261010-66y, P12, reading (A)). Until that task a team WITH a finals row
 *    carried the championship's whole Awards ceiling at the finals (45 in
 *    2026), and a team without one carried nothing for the finals' Awards.
 *    The defect had two faces:
 *
 *    - LIVE, a Locked taken back by the ceiling test alone at the tick the
 *      finals rows post, when a team gains a finals row and the 45 with it.
 *      Walked on the real 2026 artifacts with no bracket facts in hand: 3
 *      at FIM and 4 at ONT, from both starts. With the facts in hand: 2 at
 *      FIM and 1 at TX, at the tick the finals' award points land.
 *    - REWOUND, hindsight. A team that ENDS with a finals row has not earned
 *      it at a stop before the finals, yet its ceiling there was 45 higher
 *      than the same team's with the row removed. Over the 16 divisioned
 *      championships of 2023 to 2026 and nine stops before the finals have a
 *      played row, a ceiling differed with the finals rows present against
 *      removed at all 144 stops: 1,593 team stops, 1,476 of them teams of
 *      the field.
 *
 *    THE READING. The finals' Awards category adds no points ceiling for
 *    anyone. A finals source's award points still leave the floor while the
 *    finals' Awards are open at the position. It rests on a fact the joint
 *    proof already rests on, in `champJointLock.ts`'s own words: "the finals
 *    awards are consuming awards (24 and 30 points 2023 to 2026)". (That
 *    header went on to say no team has award points at both its division and
 *    the finals, which is false before 2023 and which neither the proof nor
 *    this reading needs; quick task 261010-d7r corrected it there.) A
 *    consuming award takes a Championship slot whatever its winner's points,
 *    and decision 2's reservation holds a slot for each until the finals'
 *    Awards are final, so the points such an award pays can never be what
 *    lifts a rival past a Locked team. `scripts/champFieldStagedWalk.test.ts` holds
 *    the fact over every local season (265 rows at a finals key, 153 with
 *    award points, every one beside a consuming award recorded there) and
 *    says what breaks if a season shows otherwise.
 *
 *    A TEAM WHOSE ONLY CHAMPIONSHIP ROW IS THE FINALS ROW (an award given at
 *    the finals to a team that played in no division: 20 such teams over the
 *    local seasons, each with award points alone) reads the field as a team
 *    with no championship row at all, which is what it was before the award
 *    was posted. Its finals row adds no Playoffs ceiling: it cannot be on a
 *    division winning alliance. It carries the one hypothetical championship
 *    while the field is still open at the position
 *    (`ChampLedgerTeam.fieldRowOpen`), on the two existing gates, and
 *    nothing once every division has started. With that, the 144 stops read
 *    the same with the finals rows present and removed: every floor, every
 *    ceiling, the teams shown Locked and `lockedBy`.
 *
 *    THE CONSEQUENCE, ACCEPTED. A team whose only way in is a consuming award
 *    at the finals reads Locked out at a rewound stop from the moment every
 *    division has started until that award is posted, exactly as it does
 *    live, since no finals row exists yet at that moment. Over the 109 local
 *    seasons that is 417 team positions against 149 before, every one a team
 *    that qualifies by an award and none on points.
 *
 * 5. THE JOINT WORST CASE PROOF (quick task 261009-2tr). A second proof of
 *    `"locked"`, OR-ed with the ceiling test and superseding nothing, exactly
 *    as `locks.ts` ORs its pooled test. Decision 2's reservation and the
 *    ceiling test give every rival the whole award ceiling independently and
 *    hold back a flat number of slots; the joint proof instead counts, for each
 *    team, the most rivals that can take a slot from it in any way the bracket,
 *    the backup robots and the award budget can still fall, counting each
 *    rival once, and locks the team when that count is below the points slots.
 *    At a SINGLE championship (one dcmp tier key) it runs once the DCMP's
 *    Qualification and Alliance selection are final and while its Awards are
 *    open, with the complete eight alliance
 *    list and every played playoff row resolved (`DcmpBracketFacts`, carried on
 *    `distributions`). With the Playoffs final it runs only once the winner
 *    award is posted, or the routed final names the winner. Anywhere else
 *    `jointProof` names why it did not run and the statuses are exactly the
 *    shipped ones. In the proof a placement pays its MAXIMUM
 *    (`maxPlayoffPointsByPlacement`, 75, 39 and 21 at 2026), never
 *    `playoffPoints`, and a decided placement that is not exact already sits in
 *    the ceiling at its maximum through decision 4. `champJointLock.ts` owns the
 *    argument, the one point paying award per rival cap included; this module
 *    owns only reading the facts off the rows.
 *
 *    THE TWO OTHER SHAPES (quick task 261009-kt3, `championshipShape`). A
 *    DIVISIONED championship (FIM, NE, ON, TX) runs once every division's
 *    Qualification and Alliance selection are final and while ANY of its
 *    keys' Awards are open (the finals' alone until quick task 261010-d7r;
 *    "when each shape's proof stops" below), with every division's eight
 *    alliance facts; each
 *    division is routed on its own rows, the finals facts are read only once
 *    every division has a decided winner, each finals alliance mapped by roster
 *    to one division winner, and members are the LISTED picks except on a
 *    placed alliance, which keeps its confirmed picks. TWO CHAMPIONSHIPS (2026
 *    California) run one eight alliance input per championship, a team with no
 *    championship row in every input, and lock on the summed bound. The single
 *    and the two championship inputs keep CONFIRMED pick membership (listed
 *    pick membership was measured less conservative there). Every shape counts
 *    seats and fill ins as the maximum alliance size minus the confirmed picks.
 *    Any other grouping of the dcmp keys refuses `unsupportedShape`; a division
 *    without facts `noBracketFacts`; a finals alliance matching no division
 *    winner, or finals rows before every division is decided,
 *    `bracketUnroutable`.
 *
 *    A RIVAL THAT HOLDS A POSTED AWARD TAKES NO FURTHER JUDGED AWARD (quick
 *    task 261010-d7r, D1; `champJointLock.ts` owns the rule and its
 *    argument). A team whose row at a division key carries award points
 *    above 0, where that division's Awards read final at the position, is
 *    AWARDED: it holds its one judged award, in its floor. This module names
 *    those teams to the proof (`awardedTeamsAt`, handed on as
 *    `JointLockInput.awardedRivals`). The budget of a final division stays
 *    14 minus its awarded teams, never below 0, for awards that may yet be
 *    listed, and it now goes only to rivals with no posted award. An awarded
 *    rival still counts through a consuming award and as the winner's
 *    backup. Award points on a row whose key's Awards are open leave the
 *    floor as before and make nobody awarded.
 *
 *    WHAT IT CLOSED (measured 2026-10-10). Until that task the rest of a
 *    final division's budget could go to a rival that already held a posted
 *    award. That rival's maximum was then one judged award higher than a
 *    tick before, so a team's bound could RISE when a division's Awards
 *    turned final, and a Locked the proof gave could be taken back. Reading
 *    A is every division's Playoffs final and its Awards open, the finals
 *    not started; reading B is the sweep's "Divisions final, finals not
 *    started". Over the 16 divisioned championships of 2023 to 2026, before
 *    the rule: 406 shown Locked at A and 436 at B, eleven teams Locked at A
 *    and not at B, and 312 pool teams' bounds higher at B, the largest by 7.
 *    Two terms of the proof spent the award: a picked rival still short of T
 *    after its alliance's value, and a rival on no alliance, alone or on a
 *    seat. Closing the first alone lost none of the eleven and left 62
 *    rises; closing the second alone lost all eleven. With the rule: 406 at
 *    A, 451 at B and none lost (`scripts/champFieldStagedWalk.test.ts`
 *    group 9), and no Locked lost and no margin dropped over any flag edge
 *    of `scripts/champJointMonotone.test.ts`. On the joint sweep ten
 *    divisioned stop rows moved, all upward (16 more teams shown Locked),
 *    and no single or two championship row moved. No stop of the sweep sits
 *    between A and B, which is why no measured history had shown it.
 *
 *    THE PROOF RUNS DURING THE DIVISION PLAYOFFS AT A LIVE DIVISIONED
 *    CHAMPIONSHIP (quick task 261010-d7r, D2). TBA writes the first finals
 *    row only when the finals are played or their awards are given, so the
 *    finals key is on no row while the divisions play, and division keys
 *    without their parent were `unsupportedShape`. With the
 *    `finalsMayBeAbsent` option the shape is divisioned all the same
 *    (`championshipShape`), the finals read as not started and wholly open:
 *    no stage, no facts, no Winner posted there, one whole championship held
 *    back. Nothing in the proof itself changed. The tab passes it only at
 *    the live position and only while the field is proven BY CAPACITY, so
 *    the division keys on the rows are every division
 *    (`packages/core/districts/finalsBracket.ts` says why nothing weaker
 *    will do). Quick task 261010-66y built this reading and refused it
 *    because of the defect above: with the proof running through the
 *    division playoffs the real 2026 walks took 1 Locked back at FIM, 2 at
 *    NE and 2 at TX on the tick the divisions' Awards turned final. With
 *    that closed it holds, by two separate proofs
 *    (`scripts/champFieldStagedWalk.test.ts`, measured 2026-10-10). THE
 *    READING IS THE SAME ONE: over the 16 divisioned championships of 2023
 *    to 2026 and the 112 stops before the finals have a played row, with the
 *    finals key's rows removed against present, the reason differs at 0
 *    stops, the proof's input at 0, a pool team's bound at 0 (28,140
 *    compared), the joint locked set at 0, the reservation at 0, a floor at
 *    0, a ceiling at 0, the teams shown Locked at 0 and `lockedBy` at 0. AND
 *    IT IS HELD LIVE: on the walks of 2026 FIM, NE, ONT and TX the proof is
 *    applied from the tick the alliance points land and no Locked is taken
 *    back at any tick. Teams shown Locked, tick by tick from "alliances
 *    picked" to "finals award points land" (alliances picked, alliance
 *    points, Rounds 1 to 5, playoffs done, playoff points, division award
 *    points, every division finished, finals rows posted, finals state,
 *    finals award points): FIM 0, 1, 1, 5, 25, 35, 41, 46, 60, 60, 66, 66,
 *    71, 71; NE 0, 0, 0, 1, 8, 9, 9, 12, 20, 20, 20, 20, 21, 21; ONT 0, 0, 0,
 *    0, 0, 6, 7, 8, 10, 10, 11, 11, 12, 12; TX 0, 0, 0, 2, 7, 7, 7, 8, 15,
 *    15, 17, 17, 17, 17. Without the option the first eight ticks of each
 *    read 0, the next three only what the ceiling test held (FIM 13, 13,
 *    29), and the proof first ran when the finals rows posted.
 *
 *    WHEN EACH SHAPE'S PROOF STOPS (quick task 261010-d7r, findings F-B and
 *    F-C; the one rule is `jointProofStillRuns` in `champJointLock.ts`). A
 *    SINGLE championship's proof stops when its Awards read final, as it
 *    always has. A DIVISIONED championship's stops only once EVERY key's
 *    Awards are final, each division's and the finals'. Until that task it
 *    stopped at the finals' Awards alone. Awards flags turn true one event
 *    at a time and in no fixed order, and where the finals' flag turned true
 *    before a division's the ceiling test could not hold what the proof had
 *    held (F-B): with the rule switched off the awards order lattice of
 *    `scripts/champJointMonotone.test.ts` loses 306 Locked over the 16
 *    divisioned championships of 2023 to 2026, every one at the edge into
 *    the finals' Awards reading final. Past the finals' Awards the proof is
 *    handed NO consuming award, since they are given at the finals event.
 *    That rests on the same awards flag limit as decision 2's reservation,
 *    which holds nothing once `awardFinal`: a consuming award listed after
 *    the list has settled (`packages/core/districts/eventAwards.ts`, "the
 *    rule's limits"). The limit is stated, not closed. TWO CHAMPIONSHIPS:
 *    the proof stops only once every championship's Awards are final. While
 *    one is finished and the other is not (F-C: rewound on 2026 California
 *    the proof refused there at all 14 edges and 91 Locked were lost), the
 *    finished championship needs no bracket facts and must have its Winner
 *    counted, and its input holds no alliance, no consuming award, its
 *    awarded teams and what is left of its judged budget
 *    (`mixedMultipleJointProof`).
 *
 *    A LISTED PICK THAT IS NOT CONFIRMED, ON A PLACED ALLIANCE (quick task
 *    261010-d7r, finding F-D; `champJointLock.ts` owns the rule and its
 *    argument). An alliance may list a team that holds 0 alliance selection
 *    points at that key. On a placed alliance it is not among the members
 *    this module hands the proof, and decision 4 still settles its Playoffs
 *    at the alliance's placement: live, a value that is not exact, in the
 *    ceiling at the placement's maximum, and so in the rival's `extra`. The
 *    proof went on offering that rival another alliance's seat or the
 *    winner's fill in, so it read one alliance's value plus another's, which
 *    no future pays: the team was on the alliance that lists it, or it never
 *    was. This module now names those teams to the proof (`listedOnlyPicks`,
 *    handed on as `JointLockRival.listedOnly` with that maximum and whether
 *    the alliance placed first), and the proof reads each at its settled
 *    value OR on another alliance's seat, never both, and the decided
 *    winner's such pick as the winner's fill in or nothing. The single and
 *    the two championship inputs name the picks of every placed alliance,
 *    the first placed included. The divisioned input names those of the
 *    alliances placed BELOW first in their division: a division winner's
 *    listed pick keeps its settled value in every reading, since the only
 *    seat it can take is on that same alliance, for the finals. Three kinds
 *    of team carry no `listedOnly`: a confirmed pick; a team whose settled
 *    value is exact, which is every rewound reading (TBA's own number, in
 *    the floor), so no sweep line moved; and a backup seen on the field
 *    that no pick list names, which has no settled value (decision 4 reads
 *    the published pick lists). WHAT IT CLOSED, measured by that task's
 *    planner on live walks one fact at a time with every other rule on: 26
 *    team margins dropped at the played row that places an alliance listing
 *    four teams (2023pnw 17, 2026fnc 3, 2024pch 2, 2026win 2, 2024fnc 1,
 *    2025fim 1) and no Locked team was lost. With the rule: none
 *    (`scripts/champJointMonotone.test.ts`, group D, which reads the 25 of
 *    the five single championships again with the rule switched off; 2025
 *    FIM is not among its walks).
 *
 *    THE BRACKETS STAY IN HAND UNTIL EVERY EVENT OF THE CHAMPIONSHIP HAS
 *    FINISHED (quick task 261010-66y, reading R15, widened by quick task
 *    261010-d7r; `champLiveFetchKeys`). The proof holds locks in the window
 *    between the divisions and the finals, where no event of the
 *    championship reads in progress, and the tab used to drop the brackets
 *    there and with them every lock the proof alone held. It now also runs
 *    past the finals' Awards while a division's flag is still to come, and
 *    reads every division's bracket there, so the brackets are kept until
 *    the last event of the championship has finished.
 *
 *    A BACKUP ROBOT SEEN ON THE FIELD (quick task 261010-66y, CONTEXT D4).
 *    A team on a side of a played playoff row that no pick list names is, in
 *    the facts this proof is handed, a listed pick of that side's alliance
 *    (`dcmpBracketFactsFor`), so with no settled Playoffs value it keeps its
 *    alliance alive here exactly as a listed, unconfirmed fourth does.
 *
 * 6. THE WINNER HOLD (quick task 261009-vp9). Decision 2's reservation
 *    releases the winning alliance's four places once a championship's
 *    Playoffs are final. That alone is not enough at a LIVE championship: TBA
 *    can post the playoff points before it lists the Winner, and for those
 *    ticks the four places would be neither reserved for (the Playoffs read
 *    final) nor counted (no winner is known), which hands the points race
 *    four slots the winners then take. So the places are released only once
 *    the Playoffs are final AND a Winner is counted at that championship at
 *    this position (`winnerPostedAt`, by championship stem), exactly as the
 *    published verdict pass does (`reservedChampSlotsAtNow` in
 *    `packages/harness/districtRankingsMerge.ts`). A Winner at another
 *    championship of the same district releases nothing here.
 *
 *    THE HOLD APPLIES ONLY WHILE THE CHAMPIONSHIP'S OWN FLAG IS NOT TRUE AT
 *    NOW. Where the artifact's state already says its awards are posted (a
 *    finished championship, which is every one in a published season), a
 *    rewound stop reads as it always has: Playoffs final at the stop
 *    releases the places. Applied at every stop the hold moved history: over
 *    the ten 2020 seasons, whose championships posted awards with no Winner
 *    at all, `scripts/measureChampTenets.ts` read Locked on points shown
 *    6836 as 6792. Applied only while the flag is not yet true at Now it
 *    moves nothing there. The flag is read per championship
 *    (`perChampionship`): the finals event's own at a divisioned
 *    championship, never a division's.
 *
 * 7. THE PROVEN FIELD (quick task 261010-66y). The artifact learns a
 *    championship key only from team rows, so at a LIVE championship a
 *    division or a second championship TBA has not posted yet is invisible
 *    (`packages/core/districts/dcmpFieldProof.ts`). The row model resolves
 *    one flag, `rows.fieldProven`, and this module takes it as the
 *    `fieldProven` option. While it is false:
 *
 *    - a team with no championship row arrives here as `open`, not `out`,
 *      and so reaches the one hypothetical championship branch on its two
 *      existing gates (not already at a championship, not locked out by the
 *      district tier);
 *    - that hypothetical championship carries a finals as well, the whole
 *      dcmp Playoffs ceiling (`hypotheticalFinalsCeiling`). It is what the
 *      team will carry the moment its division's rows land, by the last
 *      bullet below, so its ceiling cannot rise when they do. Without it, on
 *      2026 FIM with each division's points arriving only as it ends, 3
 *      Locked were taken back from a start with no division final, 3 from
 *      one and 2 from two;
 *    - the joint proof refuses `fieldNotProven`, checked second, after
 *      `noDistributions`: a single shape proof would otherwise run on one of
 *      two championships, with the other's winners and awards unmodelled;
 *    - decision 2's reservation holds more WHOLE championships beside the
 *      known ones (`unseenChampionshipsHeld`): the events that may be unseen,
 *      never fewer than one while the posted teams fall short of the capacity
 *      line. The artifact cannot tell unseen divisions of a known
 *      championship from an unseen second championship, so this over holds
 *      for the former (2026 FIM with one division posted holds three more)
 *      and it lasts only while the field is unproven. The total held never
 *      rises while rows are only added;
 *    - a division team with no finals row carries the whole dcmp Playoffs
 *      ceiling for the finals, whatever number of division keys the artifact
 *      knows, a lone division included (`champFinalsCeilingWithoutRow`).
 *
 *    ABSENT READS TRUE, which is every rewound position and every sweep over
 *    finished seasons. So a LIVE caller must pass the rows' own flag: the
 *    tab does, and so do the staged walks.
 *
 * AWARD-QUALIFIED AT THIS TIER means the DCMP winning alliance once the
 * playoffs are done, and Impact, Engineering Inspiration or Rookie All Star at
 * the DCMP once awards are posted — at any of the district's championships
 * (two for 2026 California, quick task 261006-lwo). A district-event Impact
 * win qualifies a team for the DCMP, not the Championship, so it locks nobody
 * here — which is exactly what restricting the scan to dcmp-tier keys enforces.
 */
import {
  computeLocksWithQualifiers,
  cutLinePointsWithQualifiers,
  pointsRaceSlots,
  type LockResult,
  type LockStatus,
  type LockTeamInput,
  type QualifierSets,
} from "../../../../../packages/core/districts/locks.js";
import { AWARD_TYPE_WINNER, consumingAwardTypesForTier } from "../../../../../packages/core/districts/qualification.js";
import { maxEventPoints } from "../../../../../packages/core/districts/pointModel.js";
import { dcmpAwardCountCeilings, dcmpJudgedAwardCeiling, dcmpJudgedAwardPoints } from "../../../../../packages/core/districts/hypotheticalDcmp.js";
import {
  championshipStemOf,
  dcmpNeverHappening,
  MAX_WINNING_ALLIANCE_SIZE,
  pendingAwardSlots,
  perChampionship,
  reservedChampSlots,
} from "../../../../../packages/core/districts/champReservedSlots.js";
import { InvalidBracketDecisionError, maxFinalsPointsByPlacement, maxPlayoffPointsByPlacement } from "../../../../../packages/core/districts/bracket.js";
import { divisionCountOf, finalsChampionMaximum } from "../../../../../packages/core/districts/categoryCorroboration.js";
import { fieldFixingDcmpKeys, hypotheticalFinalsCeiling, unseenChampionshipsHeld } from "../../../../../packages/core/districts/dcmpFieldProof.js";
import {
  dcmpBracketState,
  divisionAllianceId,
  divisionedJointFrames,
  jointLockBound,
  jointLockBoundMultiple,
  jointLockedTeams,
  jointLockedTeamsMultiple,
  jointProofStillRuns,
  type DcmpBracketState,
  type DivisionJointState,
  type JointLockAlliance,
  type JointLockInput,
  type JointLockRival,
  type JointLockSeatGroup,
} from "../../../../../packages/core/districts/champJointLock.js";
import { championshipShape, finalsDecisionsFromPlayedMatches, routeFinals } from "../../../../../packages/core/districts/finalsBracket.js";
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import {
  DISTRICT_CATEGORIES,
  settledElimBounds,
  tierEvents,
  type DcmpBracketFacts,
  type DistrictCategory,
  type DistrictEventDistributions,
  type DistrictStageFinality,
  type SettledPlayoffs,
} from "./districtLedgerRows.js";
import { DISTRICT_LEDGER_STATUS_KEYS, type DistrictLedgerStatusKey, type DistrictLedgerStatusState } from "./districtLedgerStatus.js";
import { dcmpEventKeysFor, type ChampLedgerTeam } from "./champLedgerRows.js";
import type { ChampNoCallReason, ChampRangeState } from "./champLedgerChances.js";
import { applyLedgerRangeState, type LedgerRangeCall } from "./ledgerRangeState.js";

/** Which kind of award locked a team — the chip reads `Locked · winner` or `Locked · award`. */
export type ChampAwardKind = "winner" | "award";

export interface ChampLedgerStatusResult {
  readonly teamKey: string;
  readonly status: DistrictLedgerStatusState;
  /** True when an AWARD is the reason a team is Locked — a note on one status rather than a second status. */
  readonly byAward: boolean;
  /** `"winner"` for the DCMP winning alliance, `"award"` for a judged award, `null` for every team the points math decided. */
  readonly awardKind: ChampAwardKind | null;
  readonly verdict: LockStatus;
  readonly lockedBy: LockResult["lockedBy"];
  /** 1-based rank inside the POINTS POOL in the champ ledger's own sorted order, or `null` for a team outside the pool. */
  readonly poolRank: number | null;
}

export interface ChampLedgerStatusModel {
  readonly byTeam: ReadonlyMap<string, ChampLedgerStatusResult>;
  /**
   * The CHIP counts, over the WHOLE district and never over the filtered view.
   * `locked` is `locked` PLUS `lockedAward`, because the chip says "Locked" for
   * both — a test comparing this against `insights.champLockedCount` is testing
   * the wrong number, since that field counts the `locked` verdict alone.
   */
  readonly counts: Readonly<Record<DistrictLedgerStatusKey, number>>;
  /** The raw six-status `locks.ts` census, which IS what `insights.champLockedCount`/`champEliminatedCount` count. */
  readonly verdictCensus: Readonly<Record<LockStatus, number>>;
  /**
   * `cutLinePointsWithQualifiers` ON THE FLOORS: the artifact's own
   * `insights.cmpCutLinePoints` at an all final position, `null` for an
   * unpublished capacity.
   *
   * NOT RENDERED ANYWHERE. The tab prints the PREDICTED CUTOFF instead (quick
   * task 260926-37q), which is the midpoint of the boundary pair over the
   * MEDIAN PROJECTIONS the table is sorted by. This field is kept for exactly
   * one reason: it is the only thing in the repo proving this module's
   * recompute reproduces `insights.cmpCutLinePoints`, which
   * `champLedgerStatus.test.ts` pins.
   */
  readonly floorCutLine: number | null;
  readonly awardQualified: readonly string[];
  readonly prequalified: readonly string[];
  /**
   * How many Championship slots were HELD BACK at this position for the DCMP's
   * own consuming qualifications still to come — decision 2 in this module's
   * header, `champReservedSlots.ts` for the rule. Zero once the DCMP's awards
   * are final, which is every finished season.
   */
  readonly reservedSlots: number;
  /** `locks.ts`'s own narrowing: `cmpSlots` minus the ranked award qualifiers. The In range rank boundary. */
  readonly pointsSlots: number;
  /**
   * Whether the joint worst case proof ran at this position (decision 5), with
   * its input and the teams it locked, or why it did not. Always set by
   * `computeChampLedgerStatuses`; optional only so a hand built model needs no
   * edit.
   */
  readonly jointProof?: ChampJointProof;
  /**
   * Every team's FLOOR at the position (the lock input's `pointTotal`): the
   * corpus sweep's D3 assertion reads it (quick task 261009-kt3). Always set by
   * `computeChampLedgerStatuses`; optional only so a hand built model needs no
   * edit.
   */
  readonly floorByTeam?: ReadonlyMap<string, number>;
  /** Every team's CEILING at the position (floor plus the open ceiling). Set alongside `floorByTeam`. */
  readonly ceilingByTeam?: ReadonlyMap<string, number>;
}

/** Why the joint proof did not run at a position, in the order the preconditions are checked. */
export type JointProofSkipReason =
  | "noDistributions"
  | "fieldNotProven"
  | "unsupportedShape"
  | "noBracketFacts"
  | "stageNotEligible"
  | "noCapacity"
  | "neverHappening"
  | "winnerNotPosted"
  | "bracketUnroutable"
  | "noCandidateWinner";

/** The joint proof at one position: its input and the teams it locked, or the first precondition it failed. */
export type ChampJointProof =
  | { readonly applied: true; readonly shape: "single" | "divisioned"; readonly input: JointLockInput; readonly locked: ReadonlySet<string> }
  | { readonly applied: true; readonly shape: "multiple"; readonly championships: readonly JointLockInput[]; readonly locked: ReadonlySet<string> }
  | { readonly applied: false; readonly reason: JointProofSkipReason };

/**
 * What a decided placement that is NOT exact adds to a team's `extra` in the
 * joint proof, beyond the `settled.ceiling` `settledElimBounds` already put
 * there (261009-2tr planner reading 12, reduced by CONTEXT D7). Zero for no
 * settled value, an exact one, or a team the proof's own routing places (the
 * placement's maximum already sits in the ceiling). A team with a settled value
 * that is not exact and NO routed placement gets the rest of the whole DCMP
 * Playoffs ceiling, so its total is that ceiling.
 */
export function jointDecidedPlacementTopUp(settled: SettledPlayoffs | undefined, placement: number | undefined, season: number): number {
  if (settled === undefined || settled.exact) return 0;
  if (placement !== undefined) return 0;
  return Math.max(0, maxEventPoints(season, "dcmp").elim - settled.ceiling);
}

export interface ComputeChampLedgerStatusesOptions {
  readonly artifact: DistrictArtifact;
  /** The rows `champLedgerRows.ts` produced AT THIS POSITION, in its own sorted order — this module computes no second ordering. */
  readonly teams: readonly ChampLedgerTeam[];
  /**
   * The teams the DISTRICT-tier verdict has eliminated at this position.
   *
   * Read for exactly one thing: the hypothetical DCMP ceiling a team gets
   * while the championship is not on the artifact yet. A team the district
   * tier has locked OUT cannot reach the field, so it gets none — which is
   * `districtRankingsMerge.ts`'s own `maxRemainingChamp` gate
   * (`stillAhead && !hasPlayedDcmp && districtLock.status !== "eliminated"`),
   * read off the verdicts the tab already computed rather than recomputed
   * here.
   *
   * ABSENT MEANS "no team is ruled out", which grants every team the ceiling.
   * That OVERSTATES rivals' ceilings, which is the only safe direction: an
   * overstated rival delays a `"locked"` verdict, an understated one would
   * publish a guarantee that is not true.
   */
  readonly districtLockedOut?: ReadonlySet<string>;
  /**
   * The calendar year at the time of the call, for `dcmpNeverHappening`'s
   * past-season clause. Defaults to the clock; a test passes it so a fixture
   * without `state` blocks reads the same in every year.
   */
  readonly nowYear?: number;
  /**
   * The tab's distributions, read for exactly one thing: the District
   * Championship's `dcmpBracket` facts, which the joint proof (decision 5)
   * needs. Absent means the proof never runs, which is the shipped behaviour
   * byte for byte.
   */
  readonly distributions?: ReadonlyMap<string, DistrictEventDistributions>;
  /**
   * WHETHER THE FIELD IS PROVEN (decision 7, quick task 261010-66y): the row
   * model's own `fieldProven`. False only at the live position while some
   * field fixing key has started and the field is not proven. ABSENT READS
   * TRUE, so a live caller must pass `rows.fieldProven`.
   */
  readonly fieldProven?: boolean;
  /**
   * WHETHER A DIVISIONED CHAMPIONSHIP'S FINALS KEY MAY BE ON NO ROW YET
   * (decision 5, quick task 261010-d7r, D2). Read by the joint proof alone,
   * for the shape: with it, 2 or 4 division keys with no parent are a
   * divisioned championship whose finals have not started. A caller passes
   * true only at the live position and only while the field is proven by
   * capacity (`dcmpFieldProof`'s `completeBy === "capacity"`). Absent reads
   * false, which is every rewound position and every sweep.
   */
  readonly finalsMayBeAbsent?: boolean;
}

const EMPTY_CENSUS: Record<LockStatus, number> = {
  locked: 0,
  lockedAward: 0,
  prequalified: 0,
  eliminated: 0,
  contending: 0,
  unknown: 0,
};

const ALL_OPEN_STAGE: DistrictStageFinality = { qual: false, alliance: false, elim: false, award: false };

// `divisionCountOf` and `finalsChampionMaximum` live in
// `packages/core/districts/categoryCorroboration.ts` since quick task
// 261009-vp9: the corroborated finality rule needs the same finals champion
// value to know when a finals event's playoff points are in, and one copy
// serves both.

/**
 * The open category ceilings of a FINALS source of a divisioned championship
 * (quick task 261009-kt3, planner reading R1), or `undefined` for any other
 * dcmp key. A finals row carries no Qualification or Alliance selection points,
 * and its Playoffs pay at most the finals champion maximum
 * (`maxFinalsPointsByPlacement`, 60 at four divisions, 30 at two). A division
 * count other than 2 or 4 keeps the whole 3x Playoffs ceiling.
 *
 * ITS AWARDS CEILING IS 0 (quick task 261010-66y, reading R22; decision 4 in
 * this module's header). A points paying award at a finals event is a
 * consuming award, which takes its slot whatever its winner's points and
 * which the reservation holds a place for. A finals source's award points
 * still leave the floor while the finals' Awards are open at the position;
 * the caller does that, not this.
 *
 * The Playoffs value here is for a team with a DIVISION source at the same
 * championship. A finals source with none beside it adds no Playoffs ceiling
 * (reading R23), which the caller applies.
 */
function finalsSourceCeiling(eventKey: string, dcmpEventKeys: readonly string[], season: number): Readonly<Record<DistrictCategory, number>> | undefined {
  if (championshipStemOf(eventKey) !== eventKey) return undefined;
  const divisions = divisionCountOf(eventKey, dcmpEventKeys);
  if (divisions < 2) return undefined;
  return { qual: 0, alliance: 0, elim: finalsChampionMaximum(season, divisions), award: 0 };
}

/**
 * THE FINALS PLAYOFFS CEILING OF A DIVISION TEAM WITH NO FINALS ROW (quick task
 * 261009-kt3, planner reading R2). A finals row exists only for a team TBA paid
 * there, so a live artifact may carry none before the finals pay, while a four
 * division finalist is paid 30. A team with a source at a division of a stem
 * that holds 2 or more division keys, and no source at that stem's parent,
 * therefore carries the finals champion maximum (90 when the division count is
 * not 2 or 4) while the parent's Playoffs are not final (all open where no row
 * carries the parent). Zero in every other case, so it can never fire on a
 * single championship (one key) or on two championships (each one key).
 *
 * THE SAME VALUE A FINALS ROW GIVES (quick task 261010-66y, P12): a division
 * team carries the finals champion maximum for the finals' Playoffs and
 * nothing for the finals' Awards, with a finals row (`finalsSourceCeiling`)
 * or without one (this function). A team with NO division source at the stem
 * gets nothing here, as it gets no Playoffs ceiling from a finals row.
 *
 * WHILE THE FIELD IS NOT PROVEN (`fieldProven` false, decision 7, quick task
 * 261010-66y) the number of divisions is not known: the artifact may hold one
 * division of four, or two of four, which would read as no finals at all or
 * as a two division finals worth 30. So a team with a division source and no
 * source at that stem carries the WHOLE dcmp Playoffs ceiling for the finals
 * (90 in 2026), whatever number of division keys the artifact knows. The
 * joint proof is refused in that state, so what it models needs no thought.
 */
export function champFinalsCeilingWithoutRow(
  sourceKeys: readonly string[],
  dcmpEventKeys: readonly string[],
  season: number,
  stageByEvent: ReadonlyMap<string, DistrictStageFinality>,
  fieldProven = true
): number {
  let total = 0;
  const seen = new Set<string>();
  for (const key of sourceKeys) {
    const stem = championshipStemOf(key);
    if (stem === key || seen.has(stem)) continue;
    seen.add(stem);
    const divisions = divisionCountOf(stem, dcmpEventKeys);
    if (divisions < 2 && fieldProven) continue;
    if (sourceKeys.includes(stem)) continue;
    if ((stageByEvent.get(stem) ?? ALL_OPEN_STAGE).elim) continue;
    total += fieldProven ? finalsChampionMaximum(season, divisions) : maxEventPoints(season, "dcmp").elim;
  }
  return total;
}

/**
 * Computes every team's champ-tier status at the position the rows were built
 * at.
 *
 * THE FLOOR IS DERIVED BY SUBTRACTION from `source.pointTotal`, across BOTH
 * tiers, never by a re-sum — `districtLedgerStatus.ts`'s own reason applies
 * unchanged: `pointTotal` carries the rookie bonus, the adjustments and TBA's
 * own arithmetic, and a re-sum would silently drop all three. At a position
 * where nothing is reopened the floor is EXACTLY `pointTotal`, which is what
 * reproduces the artifact.
 *
 * THE CEILING is the floor plus each open category's own TIER ceiling:
 * `maxEventPoints(year, "district")` per open district-tier category counted
 * once per district-tier event, and `maxEventPoints(year, "dcmp")` for the DCMP
 * row's. A team whose membership is `"out"` contributes NO dcmp ceiling — it is
 * not in the field and cannot earn there.
 *
 * A TEAM THE ARTIFACT LISTS NO DCMP ROW FOR gets ONE WHOLE HYPOTHETICAL DCMP
 * added to its ceiling, on the artifact's own `maxRemainingChamp` gates: not
 * already played a championship, and not eliminated by the district-tier
 * verdict. This is the pre-registration window — `remainingEvents` comes from
 * TBA registrations and a team registers only after it qualifies, so for most
 * of the district season NO team has a dcmp row. Reading that as "no ceiling"
 * would Lock out most of a district in week one, which is the one direction the
 * lock math must never err in.
 *
 * A SETTLED PLAYOFFS CATEGORY (quick task 261008-26o, decision 4) is the one
 * exception to "open means earned out, ceiling in", on the District points
 * row and the DCMP row alike: a source carrying `settledElim` has its earned
 * `elim` (0 where TBA has no row) leave the floor, and `settledElimBounds`
 * replaces the whole Playoffs ceiling. Rewound over a finished event the
 * settled value IS TBA's `elim`, so it rejoins the floor and the two cancel.
 * Live mid playoffs it is the placement table's value, an upper bound TBA can
 * prorate down, so it joins the ceiling only.
 */
export function computeChampLedgerStatuses(options: ComputeChampLedgerStatusesOptions): ChampLedgerStatusModel {
  const { artifact, teams, districtLockedOut } = options;
  const districtCeilings = maxEventPoints(artifact.year, "district");
  const dcmpCeilings = maxEventPoints(artifact.year, "dcmp");
  const ceilingFor = (tier: "district" | "dcmp"): Readonly<Record<DistrictCategory, number>> => {
    const source = tier === "district" ? districtCeilings : dcmpCeilings;
    return { qual: source.qual, alliance: source.alliance, elim: source.elim, award: source.award };
  };
  const districtCeiling = ceilingFor("district");
  const dcmpCeiling = ceilingFor("dcmp");
  /** One whole District Championship's maximum — the hypothetical ceiling for a team the artifact does not name a championship for yet. */
  const dcmpMaxTotal = dcmpCeiling.qual + dcmpCeiling.alliance + dcmpCeiling.elim + dcmpCeiling.award;

  const sourceByKey = new Map(artifact.teams.map((team) => [team.teamKey, team] as const));
  const dcmpEventKeyList = dcmpEventKeysFor(artifact);
  const dcmpEventKeys = new Set(dcmpEventKeyList);
  /** Every dcmp key except a divisioned championship's finals key: the keys a team's own championship is at. */
  const fieldFixingDcmpKeySet: ReadonlySet<string> = new Set(fieldFixingDcmpKeys(dcmpEventKeyList));
  const consuming = consumingAwardTypesForTier("dcmp");

  // EVERY dcmp tier event's stage at this position, read off the rows (the one
  // place the rewind rail writes it), over EVERY source of every team, first
  // seen per key (quick task 261009-kt3, reading R3). A key no row carries
  // reads all open. The reservation, the award gate and the joint proof read it.
  const dcmpStageByEvent = new Map<string, DistrictStageFinality>();
  for (const team of teams) {
    for (const source of team.dcmpRow.sources) {
      if (!dcmpStageByEvent.has(source.eventKey)) dcmpStageByEvent.set(source.eventKey, source.stage.final);
    }
  }

  const lockInputs: LockTeamInput[] = [];
  const orderedKeys: string[] = [];
  const awardQualified = new Set<string>();
  const prequalified = new Set<string>();
  const awardKindByTeam = new Map<string, ChampAwardKind>();
  // THE JOINT PROOF'S READINGS (decision 5): per team, the open ceiling minus
  // the two DCMP pieces the proof models itself, and the DCMP source's settled
  // Playoffs value for a team in the field.
  const jointExtraByTeam = new Map<string, number>();
  const dcmpSettledByEvent = new Map<string, Map<string, SettledPlayoffs | undefined>>();
  const winnerPostedAt = new Set<string>();

  for (const team of teams) {
    const source = sourceByKey.get(team.teamKey);
    if (source === undefined) continue;
    orderedKeys.push(team.teamKey);

    let floor = source.pointTotal;
    let openCeiling = 0;

    // The District points row: one event's worth of ceiling per open category
    // per district-tier event, and that event's earned points out of the floor.
    const earnedByEvent = new Map(source.eventPoints.map((row) => [row.eventKey, row] as const));
    for (const entry of team.districtRow.sources) {
      const earned = earnedByEvent.get(entry.eventKey);
      for (const category of DISTRICT_CATEGORIES) {
        if (entry.stage.final[category]) continue;
        if (earned !== undefined) floor -= earned[category];
        if (category === "elim" && entry.settledElim !== undefined) {
          // Knocked out of this event's playoffs: settled, by the one rule.
          const settled = settledElimBounds(entry.settledElim);
          floor += settled.floor;
          openCeiling += settled.ceiling;
          continue;
        }
        openCeiling += districtCeiling[category];
      }
    }

    // The DCMP row, at the 3x ceilings, and only for a team that is in the
    // field or may still be. EVERY source is folded (quick task 261009-kt3,
    // CONTEXT D3): a team at a divisioned championship carries its division
    // row and, once paid there, its finals row, and the finals' open points
    // must leave the floor at a rewound stop exactly as the division's do.
    const dcmpSources = team.dcmpRow.sources;
    let jointModeled = 0;
    if (team.membership !== "out" && dcmpSources.length > 0) {
      for (const dcmpEntry of dcmpSources) {
        const dcmpStage = dcmpEntry.stage.final;
        const finalsCeiling = finalsSourceCeiling(dcmpEntry.eventKey, dcmpEventKeyList, artifact.year);
        // The finals Playoffs are never settled from a bracket (reading R1):
        // open until the finals' Playoffs stage is final.
        const settledElim = finalsCeiling === undefined ? dcmpEntry.settledElim : undefined;
        let settledAtKey = dcmpSettledByEvent.get(dcmpEntry.eventKey);
        if (settledAtKey === undefined) {
          settledAtKey = new Map();
          dcmpSettledByEvent.set(dcmpEntry.eventKey, settledAtKey);
        }
        settledAtKey.set(team.teamKey, settledElim);
        // A FINALS SOURCE OF A TEAM WITH NO DIVISION SOURCE AT THAT STEM adds
        // no Playoffs ceiling (quick task 261010-66y, reading R23): the finals
        // are played among the division winners, and this team is on no
        // division's alliance. Its points there still leave the floor below.
        const hasDivisionSourceHere =
          finalsCeiling !== undefined && dcmpSources.some((other) => other.eventKey !== dcmpEntry.eventKey && championshipStemOf(other.eventKey) === dcmpEntry.eventKey);
        const ceiling = finalsCeiling === undefined ? dcmpCeiling : hasDivisionSourceHere ? finalsCeiling : { ...finalsCeiling, elim: 0 };
        const earned = earnedByEvent.get(dcmpEntry.eventKey);
        for (const category of DISTRICT_CATEGORIES) {
          if (dcmpStage[category]) continue;
          if (earned !== undefined) floor -= earned[category];
          if (category === "elim" && settledElim !== undefined) {
            // Knocked out of the DCMP playoffs: settled in place of the whole 3x
            // ceiling (decision 4 in this module's header).
            const settled = settledElimBounds(settledElim);
            floor += settled.floor;
            openCeiling += settled.ceiling;
            continue;
          }
          openCeiling += ceiling[category];
          // The joint proof models the open DCMP Awards and an unsettled open
          // DCMP Playoffs category itself (261009-2tr planner reading 5), the
          // finals' two included (261009-kt3 reading R1).
          if (category === "award" || category === "elim") jointModeled += ceiling[category];
        }
      }
      // A division team with no finals row may still be paid in the finals
      // (reading R2); zero at a single championship and at two championships.
      const finalsWithoutRow = champFinalsCeilingWithoutRow(
        dcmpSources.map((entry) => entry.eventKey),
        dcmpEventKeyList,
        artifact.year,
        dcmpStageByEvent,
        options.fieldProven !== false
      );
      openCeiling += finalsWithoutRow;
      jointModeled += finalsWithoutRow;
    }
    // A TEAM WITH NO SOURCE AT A FIELD FIXING KEY reads the field as a team
    // with no championship row at all (quick task 261010-66y, reading R23).
    // That is every team with no championship source, and also a team whose
    // only source is at a divisioned championship's finals key: its finals
    // row was posted with an award, and before that it had no row. Whether
    // the field is still open for such a team is the row model's
    // `fieldRowOpen`; a hand built team without it reads the condition of
    // before that field existed.
    const hasFieldSource = dcmpSources.some((entry) => fieldFixingDcmpKeySet.has(entry.eventKey));
    const fieldRowOpen = team.fieldRowOpen ?? (team.membership !== "out" && dcmpSources.length === 0);
    if (!hasFieldSource && fieldRowOpen) {
      // THE PRE-REGISTRATION WINDOW. The artifact names no championship for
      // this team, so there is no row to read a stage off — but the season
      // plainly still allows one, and a status that pretended otherwise would
      // Lock out a team that can still play three more days of competition.
      //
      // The ceiling is one whole hypothetical DCMP, granted on the artifact's
      // own two gates: the team has not already played one, and the district
      // tier has not eliminated it. This is `maxRemainingChamp`'s rule, and it
      // is what keeps the verdicts computable all season rather than only
      // after registrations open. "Already played one" counts points rows at
      // FIELD FIXING keys only: an award at the finals is not a championship
      // the team played in.
      const hasPlayedDcmp = source.eventPoints.some((row) => row.tier === "dcmp" && fieldFixingDcmpKeySet.has(row.eventKey));
      // While the field is not proven the hypothetical championship carries
      // a finals too (decision 7): what the team will carry once its
      // division's rows land.
      if (!hasPlayedDcmp && districtLockedOut?.has(team.teamKey) !== true) {
        openCeiling += dcmpMaxTotal + hypotheticalFinalsCeiling(options.fieldProven !== false, dcmpCeiling.elim);
      }
    }

    lockInputs.push({ teamKey: team.teamKey, pointTotal: floor, maxRemaining: openCeiling });
    jointExtraByTeam.set(team.teamKey, openCeiling - jointModeled);

    // PREQUALIFIED is the artifact's own curated Championship pre-qualification
    // (Hall of Fame, prior-year Championship results) — a fact about the team
    // that no position can reopen.
    if (source.champLock.status === "prequalified") prequalified.add(team.teamKey);

    for (const award of source.qualifyingAwards) {
      // A DISTRICT-event Impact win qualifies a team for the DCMP, not the
      // Championship, so only awards at a DCMP are read here — at ANY of the
      // district's championships (quick task 261006-lwo; 2026 California ran
      // two). The stage gate below is the award's OWN event's (quick task
      // 261009-kt3, reading R3): a divisioned championship's winner and
      // consuming awards are given at its finals event, whose stage is not the
      // team's division's.
      if (!dcmpEventKeys.has(award.eventKey)) continue;
      if (!consuming.has(award.awardType)) continue;
      // AN AWARD THE SLIDER HAS REOPENED HAS NOT BEEN GIVEN OUT at this
      // position. The winning alliance is decided by the PLAYOFFS and the
      // judged awards by the AWARDS stage, so each is gated on its own
      // category.
      const awardStage = dcmpStageByEvent.get(award.eventKey) ?? ALL_OPEN_STAGE;
      const gate = award.awardType === AWARD_TYPE_WINNER ? awardStage.elim : awardStage.award;
      if (!gate) continue;
      if (award.awardType === AWARD_TYPE_WINNER) winnerPostedAt.add(award.eventKey);
      awardQualified.add(team.teamKey);
      // `winner` wins the label where a team holds both: it is the rarer and
      // more specific claim, and it is the one the DCMP tier adds over the
      // district's vocabulary.
      if (award.awardType === AWARD_TYPE_WINNER) awardKindByTeam.set(team.teamKey, "winner");
      else if (!awardKindByTeam.has(team.teamKey)) awardKindByTeam.set(team.teamKey, "award");
    }
  }

  const qualifiers: QualifierSets = { awardQualified, prequalified };

  // THE CHAMP-TIER RESERVATION — decision 2 in this module's header. Each
  // dcmp-tier event's stage at this position (`dcmpStageByEvent`, over every
  // source) is folded to one stage per CHAMPIONSHIP: FIM's four divisions and
  // their finals are one championship at the finals' stage, California's two
  // keys are two (`perChampionship`). One reservation per championship,
  // summed. With no dcmp row anywhere one whole championship is open, which is
  // the conservative answer. No pooled argument is passed.
  //
  // THE WINNER HOLD, decision 6 (quick task 261009-vp9). What is handed on
  // as "Playoffs final" for the RESERVATION is the stage's Playoffs AND
  // (the championship's own flag is true at Now OR a Winner is counted
  // there at this position). The flag clause is what keeps history still:
  // applied at every stop, the hold moved `measureChampTenets` on the ten
  // 2020 seasons (Locked on points shown 6836 to 6792). `awardFinal` is
  // untouched, and it zeroes the reservation whatever this says.
  const awardCeilings = dcmpAwardCountCeilings(artifact.year, artifact.districtKey, artifact.cmpSlots ?? 0).counts;
  const neverHappening = dcmpNeverHappening({
    dcmpStates: artifact.teams.flatMap((team) => tierEvents(team, "dcmp").map((entry) => entry.state)),
    artifactYear: artifact.year,
    nowYear: options.nowYear ?? new Date().getUTCFullYear(),
  });
  // Each championship's own flag at NOW, from the artifact's state blocks:
  // one value per dcmp key (a row that carries a state wins over one that
  // carries none), then one per championship, false where nothing says true.
  const postedAtNowByEvent = new Map<string, boolean | undefined>();
  for (const team of artifact.teams) {
    for (const entry of tierEvents(team, "dcmp")) {
      if (!postedAtNowByEvent.has(entry.eventKey) || (postedAtNowByEvent.get(entry.eventKey) === undefined && entry.state !== undefined)) {
        postedAtNowByEvent.set(entry.eventKey, entry.state?.awardsPosted);
      }
    }
  }
  const postedAtNowByChampionship = perChampionship(new Map([...postedAtNowByEvent].map(([eventKey, posted]) => [eventKey, posted === true] as const)), false);
  // The championships a Winner is counted at, at this position, by stem.
  const winnerCountedAt = new Set([...winnerPostedAt].map((eventKey) => championshipStemOf(eventKey)));
  const releasedStageByEvent = new Map<string, DistrictStageFinality>();
  for (const [eventKey, stage] of dcmpStageByEvent) {
    const stem = championshipStemOf(eventKey);
    const winnerPlacesReleased = stage.elim && (postedAtNowByChampionship.get(stem) === true || winnerCountedAt.has(stem));
    releasedStageByEvent.set(eventKey, { ...stage, elim: winnerPlacesReleased });
  }
  let reservedSlots = 0;
  const stageByChampionship = perChampionship(releasedStageByEvent, ALL_OPEN_STAGE);
  for (const stage of stageByChampionship.size === 0 ? [ALL_OPEN_STAGE] : stageByChampionship.values()) {
    reservedSlots += reservedChampSlots({ elimFinal: stage.elim, awardFinal: stage.award, awardCeilings, neverHappening });
  }
  // WHILE THE FIELD IS NOT PROVEN (decision 7, quick task 261010-66y) the
  // championships the artifact may not have seen yet are held back whole,
  // beside the known ones: each can still hand out its own winning alliance
  // and its own judged awards.
  if (options.fieldProven === false) {
    reservedSlots +=
      unseenChampionshipsHeld(artifact.teams, artifact.dcmpSlots) * reservedChampSlots({ elimFinal: false, awardFinal: false, awardCeilings, neverHappening });
  }
  // THE POOL ORDER IS THE CHAMP LEDGER'S OWN SORTED ORDER, filtered to the
  // pool by `locks.ts`'s own exported narrowing — never a hand-rolled
  // subtraction, which is the class of bug `qualifierPool`'s doc comment
  // already names. It reads nothing from the verdicts, so the joint proof can
  // read it before they are computed.
  const narrowing = pointsRaceSlots(orderedKeys, artifact.cmpSlots ?? 0, qualifiers, reservedSlots);
  const pointsSlots = artifact.cmpSlots === null ? 0 : narrowing.pointsSlots;

  // THE JOINT WORST CASE PROOF — decision 5 in this module's header.
  const floorByTeam = new Map(lockInputs.map((input) => [input.teamKey, input.pointTotal] as const));
  const jointProof = jointProofAt({
    artifact,
    fieldProven: options.fieldProven !== false,
    finalsMayBeAbsent: options.finalsMayBeAbsent === true,
    distributions: options.distributions,
    dcmpStageByEvent,
    neverHappening,
    winnerPostedAt,
    narrowing,
    floorByTeam,
    jointExtraByTeam,
    dcmpSettledByEvent,
    firstDcmpKeyByTeam: new Map(
      teams.flatMap((team) => (team.dcmpRow.sources[0] === undefined ? [] : [[team.teamKey, team.dcmpRow.sources[0].eventKey] as const]))
    ),
    qualifiers,
    awardCeilings,
  });
  const jointLocked = jointProof.applied ? jointProof.locked : undefined;

  const verdicts = computeLocksWithQualifiers(lockInputs, artifact.cmpSlots, qualifiers, reservedSlots, undefined, jointLocked);
  const floorCutLine = cutLinePointsWithQualifiers(lockInputs, artifact.cmpSlots, qualifiers);
  const poolRankByTeam = new Map(narrowing.poolKeys.map((teamKey, index) => [teamKey, index + 1] as const));

  const byTeam = new Map<string, ChampLedgerStatusResult>();
  const counts: Record<DistrictLedgerStatusKey, number> = { prequalified: 0, locked: 0, inRange: 0, outOfRange: 0, lockedOut: 0 };
  const verdictCensus: Record<LockStatus, number> = { ...EMPTY_CENSUS };

  for (const verdict of verdicts) {
    verdictCensus[verdict.status] += 1;
    const poolRank = poolRankByTeam.get(verdict.teamKey) ?? null;
    let status: DistrictLedgerStatusState;
    let byAward = false;
    if (verdict.status === "prequalified") {
      status = "prequalified";
    } else if (verdict.status === "locked") {
      status = "locked";
    } else if (verdict.status === "lockedAward") {
      status = "locked";
      byAward = true;
    } else if (verdict.status === "eliminated") {
      status = "lockedOut";
    } else if (verdict.status === "unknown" || poolRank === null) {
      status = "capacityUnknown";
    } else {
      status = poolRank <= pointsSlots ? "inRange" : "outOfRange";
    }
    if (status !== "capacityUnknown") counts[status] += 1;
    byTeam.set(verdict.teamKey, {
      teamKey: verdict.teamKey,
      status,
      byAward,
      awardKind: byAward ? (awardKindByTeam.get(verdict.teamKey) ?? "award") : null,
      verdict: verdict.status,
      lockedBy: verdict.lockedBy,
      poolRank,
    });
  }

  return {
    byTeam,
    counts,
    verdictCensus,
    floorCutLine,
    awardQualified: [...awardQualified].sort(),
    prequalified: [...prequalified].sort(),
    reservedSlots,
    pointsSlots,
    jointProof,
    floorByTeam,
    ceilingByTeam: new Map(lockInputs.map((input) => [input.teamKey, input.pointTotal + input.maxRemaining] as const)),
  };
}

interface JointProofAtInput {
  readonly artifact: DistrictArtifact;
  /** Decision 7: false only at the live position while the field is not proven. */
  readonly fieldProven: boolean;
  /** Decision 5: true only at the live position while the field is proven by capacity, for the shape alone. */
  readonly finalsMayBeAbsent: boolean;
  readonly distributions: ReadonlyMap<string, DistrictEventDistributions> | undefined;
  readonly dcmpStageByEvent: ReadonlyMap<string, DistrictStageFinality>;
  readonly neverHappening: boolean;
  /** The dcmp tier keys whose winner award is posted at the position. */
  readonly winnerPostedAt: ReadonlySet<string>;
  readonly narrowing: ReturnType<typeof pointsRaceSlots>;
  readonly floorByTeam: ReadonlyMap<string, number>;
  readonly jointExtraByTeam: ReadonlyMap<string, number>;
  /** Per dcmp tier key, each team with a source there and its settled Playoffs value (undefined when unsettled). */
  readonly dcmpSettledByEvent: ReadonlyMap<string, ReadonlyMap<string, SettledPlayoffs | undefined>>;
  /** Each team's FIRST dcmp source key, for the two championship partition (reading R9). */
  readonly firstDcmpKeyByTeam: ReadonlyMap<string, string>;
  readonly qualifiers: QualifierSets;
  readonly awardCeilings: Parameters<typeof pendingAwardSlots>[0];
}

/** The eight alliance numbers of the DCMP bracket. */
const DCMP_ALLIANCE_NUMBERS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8];

type JointRefusal = { readonly applied: false; readonly reason: JointProofSkipReason };
const refuse = (reason: JointProofSkipReason): JointRefusal => ({ applied: false, reason });

/**
 * A pick is CONFIRMED at a dcmp key when its alliance selection points there
 * are posted and above 0 (CONTEXT D10); a point not posted reads as 0, which
 * only widens the seats.
 */
function allianceSelectionPointsAt(artifact: DistrictArtifact, eventKey: string): Map<string, number> {
  const points = new Map<string, number>();
  for (const team of artifact.teams) {
    const row = team.eventPoints.find((entry) => entry.eventKey === eventKey);
    if (row !== undefined) points.set(team.teamKey, row.alliance);
  }
  return points;
}

/**
 * The teams that carry award points above 0 on their row at a dcmp key, in
 * artifact order. Their count is a lower bound on the point paying awards
 * that event has posted, since each such team holds at least one (quick task
 * 261009-pgq, D3 as revised). A team with no row there, or a row whose award
 * points are not posted, is not named, which only keeps the remaining judged
 * budget larger. Where that key's Awards read final at the position these
 * are the AWARDED teams of quick task 261010-d7r (planner reading R1): each
 * has used its one judged award, and the proof gives it no other.
 */
function awardedTeamsAt(artifact: DistrictArtifact, eventKey: string): string[] {
  const teamKeys: string[] = [];
  for (const team of artifact.teams) {
    if (team.eventPoints.some((entry) => entry.eventKey === eventKey && entry.award > 0)) teamKeys.push(team.teamKey);
  }
  return teamKeys;
}

/**
 * How many teams carry EXACTLY one judged award's points on their row at a
 * dcmp key (15 in 2026): a lower bound on the JUDGED awards that event has
 * posted. For a WHOLE championship's remaining judged budget (a finished
 * championship of two, `mixedMultipleJointProof`), where the rows also carry
 * the consuming awards' points (24 and 30 in 2026) and the judged ceiling
 * counts judged awards alone. A row at any other value is not counted, which
 * only keeps the remaining budget larger. A division gives judged awards
 * only, so its budget reads `awardedTeamsAt` as it always has.
 */
function judgedAwardedTeamCountAt(artifact: DistrictArtifact, eventKey: string): number {
  const oneJudgedAward = dcmpJudgedAwardPoints(artifact.year);
  let count = 0;
  for (const team of artifact.teams) {
    if (team.eventPoints.some((entry) => entry.eventKey === eventKey && entry.award === oneJudgedAward)) count += 1;
  }
  return count;
}

/** One eight alliance championship's routing at the position: its candidates and alive alliances, or the refusal. */
interface ChampionshipRouting {
  readonly routing: DcmpBracketState | undefined;
  readonly aliveAlliances: number[];
  readonly candidateWinners: (number | null)[];
}

/**
 * Decision 5's routing of one eight alliance championship (single, or one of
 * several), exactly the shipped 261009-2tr reading: Playoffs final runs only on
 * a posted or routed winner (reading 8); otherwise the alive alliances are the
 * unplaced ones plus any with a listed pick in the field holding no settled
 * Playoffs value (reading 6).
 */
function championshipRouting(
  facts: DcmpBracketFacts,
  stage: DistrictStageFinality,
  winnerPosted: boolean,
  settledByTeam: ReadonlyMap<string, SettledPlayoffs | undefined>
): ChampionshipRouting | JointRefusal {
  const routing = dcmpBracketState(facts.playedMatches, DCMP_ALLIANCE_NUMBERS);
  if (stage.elim) {
    if (winnerPosted) return { routing, aliveAlliances: [], candidateWinners: [null] };
    if (routing?.decidedWinner !== undefined) return { routing, aliveAlliances: [], candidateWinners: [routing.decidedWinner] };
    return refuse("winnerNotPosted");
  }
  if (routing === undefined) return refuse("bracketUnroutable");
  const alive = new Set(routing.alive);
  for (const alliance of facts.alliances) {
    const unsettled = alliance.picks.some((pick) => settledByTeam.has(pick) && settledByTeam.get(pick) === undefined);
    if (unsettled) alive.add(alliance.allianceNumber);
  }
  const aliveAlliances = [...alive].sort((a, b) => a - b);
  const candidateWinners = routing.decidedWinner !== undefined ? [routing.decidedWinner] : aliveAlliances;
  if (candidateWinners.length === 0) return refuse("noCandidateWinner");
  return { routing, aliveAlliances, candidateWinners };
}

/**
 * Decision 5's preconditions, in order, and the proof's input read off the
 * rows, per championship shape (`championshipShape`). The first failed
 * precondition is the reason; otherwise the proof runs.
 *
 * THE TWO READINGS HERE (quick task 261009-vp9). The bracket facts the proof
 * is handed come from the FIELD: the alliances and played rows the run was
 * conditioned on, which are in hand as soon as the match feed shows them. Its
 * eligibility gate, its floors and its extras read the rows' stage, which is
 * the NUMBER. So at a live championship the proof refuses as
 * `stageNotEligible` until the alliance points are in the rows, and the flat
 * reservation of decision 2 stands meanwhile.
 */
function jointProofAt(input: JointProofAtInput): ChampJointProof {
  const { artifact, distributions } = input;
  if (distributions === undefined) return refuse("noDistributions");
  // Decision 7: the keys on the artifact may not be the whole championship
  // (or every championship) yet, so no shape read off them can be trusted.
  if (!input.fieldProven) return refuse("fieldNotProven");
  // Decision 5: at a live divisioned championship the finals key is on no
  // row until the finals pay, and the division keys on the rows are every
  // division once the field is proven by capacity. Nothing below reads the
  // option: a finals key on no row has no stage (all open), no facts and no
  // Winner posted, which is the finals not started.
  const shape = championshipShape(dcmpEventKeysFor(artifact), input.finalsMayBeAbsent);
  switch (shape.kind) {
    case "single":
      return singleJointProof(input, distributions, shape.key);
    case "multiple":
      return multipleJointProof(input, distributions, shape.keys);
    case "divisioned":
      return divisionedJointProof(input, distributions, shape.finalsKey, shape.divisionKeys);
    default:
      return refuse("unsupportedShape");
  }
}

const NO_LISTED_ONLY_PICKS: ReadonlyMap<string, boolean> = new Map();

/**
 * The pool rival list for one championship input: floor, and extra plus the
 * decided placement top up at `eventKey`.
 *
 * `listedOnly` (quick task 261010-d7r, finding F-D; `listedOnlyPicks`) names
 * the listed picks that are not confirmed on a placed alliance, each with
 * whether that alliance placed first. Such a rival carries
 * `JointLockRival.listedOnly` where its settled Playoffs value is NOT exact
 * and above 0: `settled` is the ceiling `settledElimBounds` gives, the very
 * figure decision 4 put in its ceiling and so in `extra`. `extra` itself is
 * what it always was. An exact settled value (every rewound reading) is in
 * the floor and sets nothing, so a rewound input is the input of before that
 * task.
 */
function poolRivals(
  input: JointProofAtInput,
  teamKeys: readonly string[],
  settledByTeam: (teamKey: string) => SettledPlayoffs | undefined,
  placementOfTeam: ReadonlyMap<string, number>,
  listedOnly: ReadonlyMap<string, boolean> = NO_LISTED_ONLY_PICKS
): JointLockRival[] {
  return teamKeys.map((teamKey) => {
    const settled = settledByTeam(teamKey);
    const rival: JointLockRival = {
      teamKey,
      floor: input.floorByTeam.get(teamKey)!,
      extra: (input.jointExtraByTeam.get(teamKey) ?? 0) + jointDecidedPlacementTopUp(settled, placementOfTeam.get(teamKey), input.artifact.year),
    };
    const onWinner = listedOnly.get(teamKey);
    if (onWinner === undefined || settled === undefined || settled.exact) return rival;
    const settledCeiling = settledElimBounds(settled).ceiling;
    if (settledCeiling <= 0) return rival;
    return { ...rival, listedOnly: { settled: settledCeiling, onWinner } };
  });
}

/**
 * THE LISTED ONLY PICKS of one eight alliance key (quick task 261010-d7r,
 * finding F-D; `champJointLock.ts` owns the rule): each team an alliance
 * LISTS that holds 0 alliance selection points there (a point not posted
 * reads as 0, as for `allianceSelectionPointsAt`), on an alliance the routing
 * has PLACED, mapped to whether that alliance placed first. The first
 * alliance listing a team wins, as in `placementByPick`.
 *
 * `firstPlacedCounts` false leaves the alliance placed first out: a DIVISION
 * winner, whose listed pick keeps its settled value in every reading because
 * its only seat is on that same alliance, for the finals (planner reading R7
 * of that task). No routing names nobody.
 */
function listedOnlyPicks(
  facts: DcmpBracketFacts,
  routing: DcmpBracketState | undefined,
  points: ReadonlyMap<string, number>,
  firstPlacedCounts: boolean
): Map<string, boolean> {
  const out = new Map<string, boolean>();
  if (routing === undefined) return out;
  for (const alliance of facts.alliances) {
    const placement = routing.placementByAlliance.get(alliance.allianceNumber);
    if (placement === undefined) continue;
    if (placement === 1 && !firstPlacedCounts) continue;
    for (const pick of alliance.picks) if ((points.get(pick) ?? 0) <= 0 && !out.has(pick)) out.set(pick, placement === 1);
  }
  return out;
}

/** Each listed pick's routed placement, first alliance listing it wins. */
function placementByPick(facts: DcmpBracketFacts, routing: DcmpBracketState | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const alliance of facts.alliances) {
    const placement = routing?.placementByAlliance.get(alliance.allianceNumber);
    if (placement === undefined) continue;
    for (const pick of alliance.picks) if (!out.has(pick)) out.set(pick, placement);
  }
  return out;
}

/**
 * One eight alliance championship's input: members are the CONFIRMED picks
 * (alliance selection points posted and above 0 at that key, the shipped
 * 261009-2tr rule), seats and fill ins the maximum alliance size minus those
 * confirmed picks (CONTEXT D10). Shared by the single and the two championship
 * shapes. Listed pick membership (reading R8) was measured LESS conservative
 * here (it gained 5 locks over the single sweep, a listed backup no longer free
 * to take another alliance's seat or the winner's fill in), so it applies only
 * on the divisioned path, under guards G1 and G2 (quick task 261009-kt3,
 * orchestrator decision). Guard G3 was removed by quick task 261009-tx9: under
 * the backup robot rule a fill in comes only from the winner's own division's
 * unselected teams, which the divisioned path's seat groups state.
 */
function eightAllianceInput(
  input: JointProofAtInput,
  eventKey: string,
  facts: DcmpBracketFacts,
  routed: ChampionshipRouting,
  poolKeys: readonly string[],
  slotOnlyRivals: readonly string[]
): JointLockInput {
  const { artifact } = input;
  const settled = input.dcmpSettledByEvent.get(eventKey) ?? new Map<string, SettledPlayoffs | undefined>();
  const points = allianceSelectionPointsAt(artifact, eventKey);
  const alliances: JointLockAlliance[] = facts.alliances.map((alliance) => {
    const confirmed = alliance.picks.filter((pick) => (points.get(pick) ?? 0) > 0);
    return { allianceNumber: alliance.allianceNumber, members: confirmed, spareSeats: Math.max(0, MAX_WINNING_ALLIANCE_SIZE - confirmed.length) };
  });
  return {
    // F-D (quick task 261010-d7r): every placed alliance's listed picks that are not confirmed, the winner's included.
    pool: poolRivals(input, poolKeys, (teamKey) => settled.get(teamKey), placementByPick(facts, routed.routing), listedOnlyPicks(facts, routed.routing, points, true)),
    slotOnlyRivals,
    pointsSlots: input.narrowing.pointsSlots,
    alliances,
    aliveAlliances: routed.aliveAlliances,
    candidateWinners: routed.candidateWinners,
    placementPoints: [2, 3, 4].map((placement) => maxPlayoffPointsByPlacement(artifact.year, "dcmp", placement)),
    consumingAwards: pendingAwardSlots(input.awardCeilings),
    judgedAwards: dcmpJudgedAwardCeiling(),
    judgedAwardPoints: dcmpJudgedAwardPoints(artifact.year),
    maxAllianceSize: MAX_WINNING_ALLIANCE_SIZE,
  };
}

/** Prequalified teams not yet award qualified (reading 3). */
function slotOnlyRivalsOf(qualifiers: QualifierSets): string[] {
  return [...qualifiers.prequalified].filter((teamKey) => !qualifiers.awardQualified.has(teamKey)).sort();
}

function singleJointProof(input: JointProofAtInput, distributions: ReadonlyMap<string, DistrictEventDistributions>, dcmpKey: string): ChampJointProof {
  const facts = distributions.get(dcmpKey)?.dcmpBracket;
  if (facts === undefined) return refuse("noBracketFacts");
  const stage = input.dcmpStageByEvent.get(dcmpKey);
  if (stage === undefined || !stage.qual || !stage.alliance || stage.award) return refuse("stageNotEligible");
  if (input.artifact.cmpSlots === null) return refuse("noCapacity");
  if (input.neverHappening) return refuse("neverHappening");
  const routed = championshipRouting(facts, stage, input.winnerPostedAt.has(dcmpKey), input.dcmpSettledByEvent.get(dcmpKey) ?? new Map());
  if ("applied" in routed) return routed;
  const proofInput = eightAllianceInput(input, dcmpKey, facts, routed, input.narrowing.poolKeys, slotOnlyRivalsOf(input.qualifiers));
  return { applied: true, shape: "single", input: proofInput, locked: jointLockedTeams(proofInput) };
}

/**
 * TWO CHAMPIONSHIPS (2026 California, CONTEXT D5 and reading R9): every
 * championship must be eligible; each gets its own eight alliance input over
 * the pool teams and slot only rivals whose first dcmp source is that key,
 * plus every one with NO dcmp source, which is entered in EVERY input.
 *
 * ONE CHAMPIONSHIP FINISHED, THE OTHER NOT (quick task 261010-d7r, finding
 * F-C) is `mixedMultipleJointProof`. It is taken exactly where the one rule
 * `jointProofStillRuns` says every championship's proof still runs AND some
 * championship's Awards are final. With every championship's Awards open, and
 * with every one's final, the code below runs as it always has.
 */
function multipleJointProof(input: JointProofAtInput, distributions: ReadonlyMap<string, DistrictEventDistributions>, keys: readonly string[]): ChampJointProof {
  const awardsFinalAt = (key: string): boolean => input.dcmpStageByEvent.get(key)?.award === true;
  const stillRuns = (key: string): boolean =>
    jointProofStillRuns(
      awardsFinalAt(key),
      keys.some((other) => other !== key && !awardsFinalAt(other))
    );
  if (keys.some(awardsFinalAt) && keys.every(stillRuns)) return mixedMultipleJointProof(input, distributions, keys);
  const factsByKey = new Map<string, DcmpBracketFacts>();
  for (const key of keys) {
    const facts = distributions.get(key)?.dcmpBracket;
    if (facts === undefined) return refuse("noBracketFacts");
    factsByKey.set(key, facts);
  }
  const stageByKey = new Map<string, DistrictStageFinality>();
  for (const key of keys) {
    const stage = input.dcmpStageByEvent.get(key);
    if (stage === undefined || !stage.qual || !stage.alliance || stage.award) return refuse("stageNotEligible");
    stageByKey.set(key, stage);
  }
  if (input.artifact.cmpSlots === null) return refuse("noCapacity");
  if (input.neverHappening) return refuse("neverHappening");
  const slotOnly = slotOnlyRivalsOf(input.qualifiers);
  const belongs = (teamKey: string, key: string): boolean => {
    const own = input.firstDcmpKeyByTeam.get(teamKey);
    return own === undefined || own === key;
  };
  const championships: JointLockInput[] = [];
  for (const key of keys) {
    const routed = championshipRouting(factsByKey.get(key)!, stageByKey.get(key)!, input.winnerPostedAt.has(key), input.dcmpSettledByEvent.get(key) ?? new Map());
    if ("applied" in routed) return routed;
    championships.push(
      eightAllianceInput(
        input,
        key,
        factsByKey.get(key)!,
        routed,
        input.narrowing.poolKeys.filter((teamKey) => belongs(teamKey, key)),
        slotOnly.filter((teamKey) => belongs(teamKey, key))
      )
    );
  }
  return { applied: true, shape: "multiple", championships, locked: jointLockedTeamsMultiple(championships, input.narrowing.pointsSlots) };
}

/**
 * TWO CHAMPIONSHIPS, SOME FINISHED AND SOME NOT (quick task 261010-d7r,
 * finding F-C, planner reading R6). Until that task the two championship
 * proof needed every championship's Awards open, so the moment one
 * championship's Awards read final the proof refused (`noBracketFacts`: the
 * facts of a championship whose Awards are final are not built) and every
 * Locked it alone held was taken back while the other championship was still
 * playing. Rewound on 2026 California with one championship wholly final and
 * the other at each of the sweep's seven stops: applied then `noBracketFacts`
 * at all 14 edges, 91 Locked lost. Both of its championships are in week 5.
 *
 * AN OPEN CHAMPIONSHIP (its Awards open) is read exactly as before: it needs
 * its facts with Qualification and Alliance selection final, and gets
 * `championshipRouting` and `eightAllianceInput`.
 *
 * A FINISHED CHAMPIONSHIP (its Awards final) needs no bracket facts: nothing
 * of its bracket is still to be played. It needs its WINNER COUNTED at the
 * position (`winnerPostedAt`), else the proof refuses `winnerNotPosted`: with
 * no Winner counted the winning alliance's places are neither taken nor
 * modelled. Its input holds no alliance, one null candidate winner (the
 * posted winner case), NO consuming award (decision 2's own reading,
 * `reservedChampSlots` holding nothing once `awardFinal`, and resting on the
 * same awards flag limit: a consuming award listed after the list has
 * settled), and what is still open of its judged awards:
 *
 *   - `awardedRivals` are the teams carrying award points at its key (rule D1
 *     of that task, `awardedTeamsAt`): each holds its one point paying award
 *     of that event, in its floor, and takes no judged award.
 *   - the judged budget is the ceiling of 14 minus the teams whose award
 *     points there are EXACTLY one judged award's (`judgedAwardedTeamCountAt`),
 *     never below 0. NOT minus every team carrying award points, as a
 *     division's budget is: a whole championship also gives the consuming
 *     awards, whose points are on the same rows (2026 California: 12 teams at
 *     15, two at 24 and two at 30 at each championship), and the ceiling of
 *     14 counts judged awards alone. Counting the consuming winners out of it
 *     would read 0 awards left where 2 may still be listed.
 *
 * The refusals keep the order of `multipleJointProof`: facts and stages of
 * the open championships, capacity, a championship that is never happening,
 * then each championship in key order.
 */
function mixedMultipleJointProof(input: JointProofAtInput, distributions: ReadonlyMap<string, DistrictEventDistributions>, keys: readonly string[]): ChampJointProof {
  const { artifact } = input;
  const openKeys = keys.filter((key) => input.dcmpStageByEvent.get(key)?.award !== true);
  const factsByKey = new Map<string, DcmpBracketFacts>();
  for (const key of openKeys) {
    const facts = distributions.get(key)?.dcmpBracket;
    if (facts === undefined) return refuse("noBracketFacts");
    factsByKey.set(key, facts);
  }
  const stageByKey = new Map<string, DistrictStageFinality>();
  for (const key of openKeys) {
    const stage = input.dcmpStageByEvent.get(key);
    if (stage === undefined || !stage.qual || !stage.alliance) return refuse("stageNotEligible");
    stageByKey.set(key, stage);
  }
  if (artifact.cmpSlots === null) return refuse("noCapacity");
  if (input.neverHappening) return refuse("neverHappening");
  const slotOnly = slotOnlyRivalsOf(input.qualifiers);
  const belongs = (teamKey: string, key: string): boolean => {
    const own = input.firstDcmpKeyByTeam.get(teamKey);
    return own === undefined || own === key;
  };
  const championships: JointLockInput[] = [];
  for (const key of keys) {
    const poolKeys = input.narrowing.poolKeys.filter((teamKey) => belongs(teamKey, key));
    const slotOnlyHere = slotOnly.filter((teamKey) => belongs(teamKey, key));
    const facts = factsByKey.get(key);
    const stage = stageByKey.get(key);
    if (facts !== undefined && stage !== undefined) {
      const routed = championshipRouting(facts, stage, input.winnerPostedAt.has(key), input.dcmpSettledByEvent.get(key) ?? new Map());
      if ("applied" in routed) return routed;
      championships.push(eightAllianceInput(input, key, facts, routed, poolKeys, slotOnlyHere));
      continue;
    }
    // A FINISHED championship: its Winner must be counted, and nothing of it is
    // open but the judged awards its flag may not have listed yet.
    if (!input.winnerPostedAt.has(key)) return refuse("winnerNotPosted");
    const awarded = awardedTeamsAt(artifact, key).sort();
    championships.push({
      pool: poolRivals(input, poolKeys, () => undefined, new Map()),
      slotOnlyRivals: slotOnlyHere,
      pointsSlots: input.narrowing.pointsSlots,
      alliances: [],
      aliveAlliances: [],
      candidateWinners: [null],
      placementPoints: [2, 3, 4].map((placement) => maxPlayoffPointsByPlacement(artifact.year, "dcmp", placement)),
      consumingAwards: 0,
      judgedAwards: Math.max(0, dcmpJudgedAwardCeiling() - judgedAwardedTeamCountAt(artifact, key)),
      judgedAwardPoints: dcmpJudgedAwardPoints(artifact.year),
      maxAllianceSize: MAX_WINNING_ALLIANCE_SIZE,
      ...(awarded.length === 0 ? {} : { awardedRivals: awarded }),
    });
  }
  return { applied: true, shape: "multiple", championships, locked: jointLockedTeamsMultiple(championships, input.narrowing.pointsSlots) };
}

/**
 * A DIVISIONED championship (CONTEXT D4, readings R6 to R8 and R13): every
 * division needs its eight alliance facts with Qualification and Alliance
 * selection final, and SOME key's Awards must be open, the finals' or a
 * division's (`jointProofStillRuns`, quick task 261010-d7r; until then the
 * finals' Awards had to be open); each division is routed on its own rows,
 * and the finals facts are read only once every division has a decided winner
 * (R6), each finals alliance mapped to the one division winner whose listed
 * picks meet its own.
 *
 * THE BACKUP ROBOT RULE (quick task 261009-tx9, which removed reading R5 and
 * guard G3; guards G1 and G2 stay): an alliance has one backup for the whole
 * championship, an unselected team of its own division, and a team already on
 * an alliance is never a backup. So each alliance carries ONE seat pool, the
 * maximum alliance size minus its confirmed picks, and the input carries one
 * seat group per division in key order.
 */
function divisionedJointProof(
  input: JointProofAtInput,
  distributions: ReadonlyMap<string, DistrictEventDistributions>,
  finalsKey: string,
  divisionKeys: readonly string[]
): ChampJointProof {
  const { artifact } = input;
  const divisionCount = divisionKeys.length;
  const factsByKey = new Map<string, DcmpBracketFacts>();
  for (const key of divisionKeys) {
    const facts = distributions.get(key)?.dcmpBracket;
    if (facts === undefined) return refuse("noBracketFacts");
    factsByKey.set(key, facts);
  }
  const stageByKey = new Map<string, DistrictStageFinality>();
  for (const key of divisionKeys) {
    const stage = input.dcmpStageByEvent.get(key);
    if (stage === undefined || !stage.qual || !stage.alliance) return refuse("stageNotEligible");
    stageByKey.set(key, stage);
  }
  const finalsStage = input.dcmpStageByEvent.get(finalsKey) ?? ALL_OPEN_STAGE;
  // WHEN THIS PROOF STOPS (quick task 261010-d7r, finding F-B; decision 5 in
  // this module's header): only once EVERY key's Awards are final. Until that
  // task it stopped at the finals' Awards alone, and a division's awards flag
  // that turned true after the finals' took back every Locked the proof held.
  const someDivisionAwardsOpen = divisionKeys.some((key) => !stageByKey.get(key)!.award);
  if (!jointProofStillRuns(finalsStage.award, someDivisionAwardsOpen)) return refuse("stageNotEligible");
  // THE JUDGED BUDGET IS WHAT EACH DIVISION CAN STILL GIVE (quick task
  // 261009-pgq, D3 as revised). Until then K was 14 times the division count
  // at every stop. Per division:
  //
  //   Awards OPEN at the position: the whole ceiling, 14. None of its award
  //   points is in any floor.
  //   Awards FINAL at the position: 14 minus the TEAMS whose row at that key
  //   carries award points above 0, never below 0. Each such team holds at
  //   least one posted award whose points are already in its floor, so the
  //   count is a lower bound on the awards posted and the remainder an upper
  //   bound on the awards still to come. A count of teams, never points
  //   divided by one award's value.
  //
  // THE FLAG ALONE IS NOT TRUSTED, which is why a final division is not simply
  // 0. Since quick task 261009-r9x the Worker turns `awardsPosted` true at the
  // first judged award whose points are in the district rankings
  // (`packages/core/districts/eventAwards.ts`), and no longer on the first
  // award of any kind. Judged awards listed after that first batch can still
  // follow, so a true flag still does not say every judged award is in. That
  // is why the remaining budget rule stays: with the flag true and no award
  // points posted the division keeps its whole 14; with 12 posted it keeps 2.
  // Measured over the 40 division events of 2023 to 2026: every awarded row is
  // exactly one judged award (15 points) and a division gives 11 or 12.
  //
  // WHO MAY STILL TAKE ONE (quick task 261010-d7r, D1). The teams counted out
  // of a final division's budget are handed to the proof as `awardedRivals`:
  // each holds its one judged award, in its floor, and takes no other. What
  // is left of the budget goes only to rivals with no posted award. Until
  // that task the remainder could go to a rival that already held one, which
  // then carried two; that is what let a bound rise when a division's Awards
  // turned final (decision 5 in this module's header). Award points on a row
  // whose key's Awards are OPEN at the position leave the floor as before and
  // make nobody awarded. With no division's Awards final the input carries no
  // `awardedRivals` key at all, so it is the input of before that task.
  //
  // The finals event gives no judged award (261009-kt3 RESEARCH section 3).
  // The single and the two championship shapes keep 14 per championship: their
  // Awards are open whenever the proof runs.
  const judgedCeiling = dcmpJudgedAwardCeiling();
  let judgedBudget = 0;
  const awardedRivals = new Set<string>();
  for (const key of divisionKeys) {
    if (!stageByKey.get(key)!.award) {
      judgedBudget += judgedCeiling;
      continue;
    }
    const awardedHere = awardedTeamsAt(artifact, key);
    judgedBudget += Math.max(0, judgedCeiling - awardedHere.length);
    for (const teamKey of awardedHere) awardedRivals.add(teamKey);
  }
  if (artifact.cmpSlots === null) return refuse("noCapacity");
  if (input.neverHappening) return refuse("neverHappening");

  const membersByAlliance = new Map<number, readonly string[]>();
  const spareByAlliance = new Map<number, number>();
  const seatGroups: JointLockSeatGroup[] = [];
  const alliances: JointLockAlliance[] = [];
  const divisions: DivisionJointState[] = [];
  const placementOfTeam = new Map<string, number>();
  const divisionKeyOfTeam = new Map<string, string>();
  // F-D (quick task 261010-d7r): the listed picks that are not confirmed on an alliance placed BELOW first in its
  // division. A division winner's listed pick is left out (planner reading R7): it keeps its settled value.
  const listedOnly = new Map<string, boolean>();

  for (const [index, key] of divisionKeys.entries()) {
    const divisionIndex = index + 1;
    const facts = factsByKey.get(key)!;
    const stage = stageByKey.get(key)!;
    const settled = input.dcmpSettledByEvent.get(key) ?? new Map<string, SettledPlayoffs | undefined>();
    for (const teamKey of settled.keys()) divisionKeyOfTeam.set(teamKey, key);
    const routing = dcmpBracketState(facts.playedMatches, DCMP_ALLIANCE_NUMBERS);
    if (routing === undefined) return refuse("bracketUnroutable");
    let alive: number[] = [];
    if (stage.elim) {
      // A division whose Playoffs are final needs a routed winner (R13).
      if (routing.decidedWinner === undefined) return refuse("bracketUnroutable");
    } else {
      const aliveSet = new Set(routing.alive);
      for (const alliance of facts.alliances) {
        if (alliance.picks.some((pick) => settled.has(pick) && settled.get(pick) === undefined)) aliveSet.add(alliance.allianceNumber);
      }
      alive = [...aliveSet].sort((a, b) => a - b);
    }
    const points = allianceSelectionPointsAt(artifact, key);
    for (const [teamKey, onWinner] of listedOnlyPicks(facts, routing, points, false)) if (!listedOnly.has(teamKey)) listedOnly.set(teamKey, onWinner);
    const confirmedHere = new Set<string>();
    const listedHere = new Set<string>();
    for (const alliance of facts.alliances) {
      const id = divisionAllianceId(divisionIndex, alliance.allianceNumber);
      const confirmed = alliance.picks.filter((pick) => (points.get(pick) ?? 0) > 0);
      for (const pick of confirmed) confirmedHere.add(pick);
      for (const pick of alliance.picks) listedHere.add(pick);
      // R8 G2: a DECIDED alliance keeps its confirmed picks; every other listed pick is an unpicked rival.
      const placed = routing.placementByAlliance.has(alliance.allianceNumber);
      const members = placed ? confirmed : [...alliance.picks];
      const spare = Math.max(0, MAX_WINNING_ALLIANCE_SIZE - confirmed.length);
      membersByAlliance.set(id, members);
      spareByAlliance.set(id, spare);
      alliances.push({ allianceNumber: id, members, spareSeats: spare });
      const placement = routing.placementByAlliance.get(alliance.allianceNumber);
      if (placement !== undefined) for (const pick of alliance.picks) if (!placementOfTeam.has(pick)) placementOfTeam.set(pick, placement);
    }
    divisions.push({
      alliances: DCMP_ALLIANCE_NUMBERS.map((n) => divisionAllianceId(divisionIndex, n)),
      alive: alive.map((n) => divisionAllianceId(divisionIndex, n)),
      decidedWinner: routing.decidedWinner === undefined ? undefined : divisionAllianceId(divisionIndex, routing.decidedWinner),
    });
    // THE DIVISION'S SEAT GROUP (quick task 261009-tx9, the backup robot rule):
    // an alliance's one backup is an unselected team of its own division, and a
    // team already on an alliance is never a backup. So this division's seats
    // and fill ins are open to every team with a row at this division's key
    // that no alliance here CONFIRMED. A pick an alliance here lists and has not
    // confirmed is named too, row or no row: it may stay as that alliance's
    // backup or may never have been on it (reading P3 of the core module). A
    // team with no division row is put in no list; the proof then offers it
    // every division's seats (reading P4), so nothing rests on a row being posted.
    const eligible = new Set<string>();
    for (const teamKey of settled.keys()) if (!confirmedHere.has(teamKey)) eligible.add(teamKey);
    for (const teamKey of listedHere) if (!confirmedHere.has(teamKey)) eligible.add(teamKey);
    seatGroups.push({ alliances: DCMP_ALLIANCE_NUMBERS.map((n) => divisionAllianceId(divisionIndex, n)), eligible: [...eligible].sort() });
  }

  // THE FINALS (reading R6): read only once every division has a decided winner.
  const finalsPlacementByAlliance = new Map<number, number>();
  const finalsFacts = distributions.get(finalsKey)?.dcmpBracket;
  const everyDivisionDecided = divisions.every((division) => division.decidedWinner !== undefined);
  if (finalsFacts !== undefined && !everyDivisionDecided && finalsFacts.playedMatches.length > 0) return refuse("bracketUnroutable");
  if (finalsFacts !== undefined && everyDivisionDecided) {
    if (finalsFacts.alliances.length !== divisionCount) return refuse("unsupportedShape");
    const winnerByFinalsAlliance = new Map<number, number>();
    for (const finalsAlliance of finalsFacts.alliances) {
      const matched = divisions.filter((division) => {
        const listed = alliancesListedPicks(factsByKey, divisionKeys, division.decidedWinner!);
        return finalsAlliance.picks.some((pick) => listed.includes(pick));
      });
      if (matched.length !== 1) return refuse("bracketUnroutable");
      winnerByFinalsAlliance.set(finalsAlliance.allianceNumber, matched[0]!.decidedWinner!);
    }
    if (new Set(winnerByFinalsAlliance.values()).size !== divisionCount) return refuse("bracketUnroutable");
    let routing: ReturnType<typeof routeFinals>;
    try {
      routing = routeFinals(finalsDecisionsFromPlayedMatches(finalsFacts.playedMatches, divisionCount), divisionCount);
    } catch (error) {
      if (error instanceof InvalidBracketDecisionError) return refuse("bracketUnroutable");
      throw error;
    }
    for (const [finalsAlliance, placement] of routing.placementByAlliance) finalsPlacementByAlliance.set(winnerByFinalsAlliance.get(finalsAlliance)!, placement);
  }

  const frames = divisionedJointFrames({
    divisions,
    finalsPlacementByAlliance,
    finalsElimFinal: finalsStage.elim,
    winnerPosted: input.winnerPostedAt.has(finalsKey),
    divisionChampionMax: maxPlayoffPointsByPlacement(artifact.year, "dcmp", 1),
    finalsMaxByPlacement: Array.from({ length: divisionCount }, (_, index) => maxFinalsPointsByPlacement(artifact.year, divisionCount, index + 1)),
    membersByAlliance,
    spareByAlliance,
    maxAllianceSize: MAX_WINNING_ALLIANCE_SIZE,
  });
  if ("refused" in frames) return refuse(frames.refused);

  const settledOf = (teamKey: string): SettledPlayoffs | undefined => {
    const key = divisionKeyOfTeam.get(teamKey);
    return key === undefined ? undefined : input.dcmpSettledByEvent.get(key)?.get(teamKey);
  };
  const proofInput: JointLockInput = {
    pool: poolRivals(input, input.narrowing.poolKeys, settledOf, placementOfTeam, listedOnly),
    slotOnlyRivals: slotOnlyRivalsOf(input.qualifiers),
    pointsSlots: input.narrowing.pointsSlots,
    alliances,
    aliveAlliances: frames.aliveAlliances,
    candidateWinners: frames.candidateWinners,
    placementPoints: [2, 3, 4].map((placement) => maxPlayoffPointsByPlacement(artifact.year, "dcmp", placement)),
    // The consuming awards are given at the finals event. Once ITS Awards read
    // final none is left to give (planner reading R5 of quick task
    // 261010-d7r): decision 2's own reading, `reservedChampSlots` holding
    // nothing once `awardFinal`, and resting on the same awards flag limit (a
    // consuming award listed after the list has settled).
    consumingAwards: finalsStage.award ? 0 : pendingAwardSlots(input.awardCeilings),
    judgedAwards: judgedBudget,
    judgedAwardPoints: dcmpJudgedAwardPoints(artifact.year),
    maxAllianceSize: MAX_WINNING_ALLIANCE_SIZE,
    frames: frames.frames,
    seatGroups,
    ...(awardedRivals.size === 0 ? {} : { awardedRivals: [...awardedRivals].sort() }),
  };
  return { applied: true, shape: "divisioned", input: proofInput, locked: jointLockedTeams(proofInput) };
}

/** The LISTED picks of a division alliance id, from its division's facts. */
function alliancesListedPicks(factsByKey: ReadonlyMap<string, DcmpBracketFacts>, divisionKeys: readonly string[], id: number): readonly string[] {
  const divisionIndex = Math.floor(id / 10);
  const allianceNumber = id % 10;
  const facts = factsByKey.get(divisionKeys[divisionIndex - 1]!);
  return facts?.alliances.find((alliance) => alliance.allianceNumber === allianceNumber)?.picks ?? [];
}

/** The bound the applied joint proof gives a team (the sweep's violation report), or `null` when the proof did not run. */
export function jointProofBound(proof: ChampJointProof, teamKey: string): number | null {
  if (!proof.applied) return null;
  return proof.shape === "multiple" ? jointLockBoundMultiple(proof.championships, teamKey) : jointLockBound(proof.input, teamKey);
}

/** What a contending team's chip SHOWS while the simulated line is not in hand: a neutral placeholder, never the rank rule. An alias of the shared type. */
export type ChampRangeCall = LedgerRangeCall;

/** One team's DISPLAYED status. `rangeCall` is set only for a contending team whose In range or Out of range call is withheld. */
export interface ChampDisplayStatusResult extends ChampLedgerStatusResult {
  readonly rangeCall?: ChampRangeCall;
}

/** The statuses the chips render: the verdict model, with the contending teams' calls taken from the range state. */
export interface ChampDisplayStatusModel extends ChampLedgerStatusModel {
  readonly byTeam: ReadonlyMap<string, ChampDisplayStatusResult>;
  /** Set while the In range and Out of range calls are withheld: their filter chips print an em dash, never a count. */
  readonly withheld: ChampRangeCall | undefined;
  /** The named terminal reason, for the `noCall` arm alone. */
  readonly noCallReason: ChampNoCallReason | undefined;
}

/**
 * THE CHIPS, from the ONE range state the cutoff view also reads (decision L2
 * and Jacob's 2026-09-27 chip timing decision).
 *
 * Touches ONLY contending teams, the ones decision 1 called In range or Out of
 * range. Locked, Locked · award, Locked · winner, Locked out, prequalified and
 * the capacity refusal come straight from the verdicts in every arm, so they
 * render immediately. Verdicts, `verdictCensus`, `floorCutLine`,
 * `awardQualified`, `prequalified`, `reservedSlots` and `pointsSlots` pass
 * through untouched.
 *
 * - `settled`: the shipped rank rule, unchanged.
 * - `simulated`: In range iff the median projection is at or above the line.
 * - `pending` and `noCall`: the call is WITHHELD. The team is carried as
 *   `capacityUnknown`, the one state that already means no chip call, no
 *   chance line and visible under every filter, with `rangeCall` naming why,
 *   and the two counts read as withheld. The rank rule ordering never leaves
 *   this function in these two arms.
 *
 * A delegation to the shared `applyLedgerRangeState` since quick task
 * 261004-uw4, where the District Locks tab's chips read the same function.
 */
export function applyChampRangeState(
  statuses: ChampLedgerStatusModel,
  teams: readonly ChampLedgerTeam[],
  state: ChampRangeState
): ChampDisplayStatusModel {
  return applyLedgerRangeState(statuses, teams, state);
}

/** Re-exported so the champ tab reads ONE list of chip keys rather than declaring a second. */
export { DISTRICT_LEDGER_STATUS_KEYS };
