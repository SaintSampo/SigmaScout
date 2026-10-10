/**
 * WHETHER A DISTRICT CHAMPIONSHIP'S FIELD IS PROVEN COMPLETE at the live
 * position (quick task 261010-66y). Pure, no I/O, no zod, no React. The Champ
 * Locks tab (`apps/web/src/components/districts/champLedgerRows.ts`), the
 * District Locks tab's Live overlay (`districtFieldOverlay.ts`) and the
 * published verdict pass (`packages/harness/districtRankingsMerge.ts`) call
 * the SAME rule, so the tabs and the published verdicts cannot drift.
 *
 * ---------------------------------------------------------------------------
 * JACOB'S RULE
 * ---------------------------------------------------------------------------
 *
 * "It is mission critical that no team is told they are locked at any stop,
 * and then later they are not locked. But also once a team is locked, we
 * should know it as soon as we can."
 *
 * ---------------------------------------------------------------------------
 * THE GAP THIS CLOSES
 * ---------------------------------------------------------------------------
 *
 * A district artifact carries no event list. It learns a championship key
 * ONLY from team rows: an `eventPoints` row once TBA has posted points there,
 * or a `remainingEvents` row the offline publisher wrote from a registration.
 * So a division, or a second championship, that TBA has not posted yet is
 * invisible. The championship the artifact does know has started, and every
 * team of the one it does not know read OUT of the field: its whole
 * championship ceiling (249 points in 2026) was gone, a team of the posted
 * event read Locked, and the other rows arriving took the Locked back.
 *
 * Walked on the real 2026 FIM artifact through the two merge entry points,
 * one division posted at a time: 41 Locked taken back on the Champ Locks
 * tab, and 119 teams shown Locked, then Declined, then Locked on the
 * District Locks tab. With this rule: none.
 *
 * History is not affected. A rewound stop reads the timeline with the
 * season's final rows. This is a gap at the LIVE position only.
 *
 * ---------------------------------------------------------------------------
 * THE RULE, LINE BY LINE
 * ---------------------------------------------------------------------------
 *
 * The FIELD FIXING keys are every dcmp key except a divisioned
 * championship's finals key (`fieldFixingDcmpKeys`). The field is PROVEN
 * when all three hold:
 *
 *   (a) STARTED.  Every field fixing key has started, by the state's own
 *                 word.
 *   (b) POSTED.   Every field fixing key carries a posted row: some team has
 *                 an `eventPoints` row at it. A `remainingEvents` row is a
 *                 registration, not a posting.
 *   (c) COMPLETE, by the first of these that holds:
 *       capacity    `dcmpSlots` is published and the teams with a posted row
 *                   at a field fixing key number at least `dcmpSlots` minus
 *                   half, rounded down, of the LARGEST posted field fixing
 *                   key's team count.
 *       finals      a divisioned championship's finals key carries a posted
 *                   row. The finals are played only after every division is
 *                   done.
 *       seasonOver  the season is over (`season < nowYear`) and every field
 *                   fixing key reads Awards final.
 *
 * THE CAPACITY TOLERANCE. A missing division or a missing second
 * championship hides a whole event's worth of teams, far more than half of
 * one. An under filled field still passes: 2022 NE 78 of 80 (divisions of 39
 * and 39, at least 61 asked), 2026 ONT 99 of 100 (50 and 49, at least 75),
 * 2026 ISR 38 of 42 (at least 23), 2022 ONT 67 of 80 (at least 47). The
 * largest overage is 2023 ISR, 45 of 40.
 *
 * WHY THE LARGEST KEY AND NOT THE SMALLEST. With the smallest, a later key
 * that carries only a few rows shrank the tolerance, raised the count asked
 * for, and turned a proven field unproven, which takes a lock back. With the
 * largest the count asked for never rises while rows are only added: the
 * posted teams never fall and the largest key never shrinks.
 *
 * WHY "SEASON OVER" AND NOT "AWARDS FINAL" ALONE. On a finished artifact the
 * kept keys of any subset read Awards final, so read in any season the line
 * called all 146 proper subsets of field fixing keys over the 25 local
 * artifacts with two or more PROVEN. Live it is the same hole when an
 * event's points arrive only as it ends: one division, or one of two
 * championships, wholly final while the others are on no row. Measured on
 * those states with the tab's own code, teams shown Locked that the final
 * standings do not hold: 17 (2026 FIM, one division), 6 (two), 0 (three), 5
 * (NE), 2 (ONT), 5 (TX), 14 (CA). So the line counts only once the season is
 * over, the clause `dcmpNeverHappening` already uses. The only artifacts
 * that need it are the ten 2020 seasons, whose championships gave awards
 * without playing (1 to 5 posted rows against 32 to 200 slots).
 *
 * ---------------------------------------------------------------------------
 * WHAT THE READERS DO WHILE THE FIELD IS NOT PROVEN
 * ---------------------------------------------------------------------------
 *
 * `unprovenAfterStart` is true when some field fixing key has started and
 * the field is not proven. Before any field fixing key has started it is
 * false, and every reader reads exactly as it did before this rule existed.
 * While it is true:
 *
 *   - a team with no championship row reads `open`, never `out`: it keeps
 *     its bubble chance and one whole hypothetical championship ceiling, and
 *     it is not hidden from the table;
 *   - that hypothetical championship also carries a finals
 *     (`hypotheticalFinalsCeiling`): the whole dcmp Playoffs ceiling again,
 *     which is what the team will carry the moment its division's rows land;
 *   - the joint worst case proof refuses (`fieldNotProven`);
 *   - more whole championships are held back
 *     (`unseenChampionshipsHeld`);
 *   - a division team's finals Playoffs ceiling is the whole dcmp Playoffs
 *     ceiling, since the number of divisions is not known;
 *   - the District Locks overlay does not apply, and the championship's
 *     awards do not read final for the range state or the award draws.
 *
 * A team with its own row, and every rewound position, are unchanged.
 *
 * ---------------------------------------------------------------------------
 * THE STATED ASSUMPTION AND THE LIMITS
 * ---------------------------------------------------------------------------
 *
 * ASSUMED, NOT VERIFIED: TBA posts one event's points rows for all of its
 * ranked teams together. No live district championship has been observed.
 *
 * 1. A current season whose championship never fills two thirds of its
 *    published capacity, or publishes no capacity, reads not proven until
 *    the year ends: a team with no row keeps its hypothetical championship
 *    and the extra championships stay held back. That delays a Locked and
 *    never revokes one. Not observed: the lowest fill is 2022 ONT, 67 of 80.
 * 2. A TEAM THAT ATTENDS BELOW THE DISTRICT LINE. A team the district tier
 *    reads eliminated carries no hypothetical championship, as before this
 *    rule, and a few such teams attend all the same (2026: NE 8, ONT 9, TX
 *    4, CA 4, PNW 1, FIM 0). Its ceiling rises when its row lands. In the
 *    published verdicts that holds for a team REGISTERED at the championship
 *    too: a registration is not a points row.
 *
 *    WHY THAT IS SAFE WHERE A DECLINED PLACE IS THE CAUSE. Such a team
 *    attends in a place a team that earned one did not take up. So for each
 *    of them there is a team that earned a place and is not attending, and
 *    that team carries the hypothetical championship at a district total at
 *    least as high. Among the teams on no row, the ones carrying a
 *    hypothetical championship therefore DOMINATE the ones that will turn
 *    out to attend: for every total, at least as many of the first are at or
 *    above it as of the second. The count of teams that can still pass any
 *    floor is then not understated, which is all a Locked needs.
 *
 *    MEASURED (`scripts/champFieldStagedWalk.test.ts`, its last group). Over
 *    the real 2026 walks, 24 walks and 75 ticks where the field is unproven,
 *    on the Champ Locks tab and in the published verdicts, the dominance
 *    holds at every tick but one: 2026 PNW, from the start with every
 *    attending team registered, in the published verdicts, at the one tick
 *    the championship has started and no row is posted, where one team is
 *    not covered.
 *
 *    THE LIMIT: A FIELD ABOVE ITS PUBLISHED CAPACITY. That one team is the
 *    case the argument does not cover. 2026 PNW fielded 51 teams against a
 *    capacity of 50, so its attendee below the line took nobody's place, and
 *    nobody stands in for it. A field has ended above its published capacity
 *    in 35 of the 109 local seasons, by 5 teams at most (2023 ISR, 45 of 40).
 *    No lock was taken back by such a team on any walk.
 *
 *    NOT DONE, AND WHY. Giving every team on no row a hypothetical
 *    championship while the field is unproven would cover it, and would flip
 *    hundreds of Locked out teams to open and back in the first minutes of
 *    every championship played in divisions.
 * 3. An unseen event smaller than half the largest posted one is not
 *    detected by the capacity line: two championships of 70 and 30 teams
 *    against 100 slots would read proven on the 70 alone. No district has
 *    run such a pair (2026 California: 61 and 60).
 * 4. A key that appears AFTER the field read proven and has not started
 *    reads the field unproven again by line (a) until its state lands. It
 *    would need a field already at capacity to gain another event.
 * 5. The season over line reads the calendar year the caller hands in. A
 *    browser tab left open across 1 January reads the old year until it is
 *    reloaded, which is the safe side: the line stays off.
 */
import type { DistrictTier } from "./pointModel.js";

/**
 * The dcmp keys whose start FIXES THE FIELD (quick task 261009-pgq, D1): every
 * key except a divisioned championship's finals key.
 *
 * A key K is a finals key when another dcmp key is K plus one digit
 * (`2026micmp` beside `2026micmp1` to `2026micmp4`, `2026necmp` beside
 * `2026necmp1` and `2026necmp2`). The finals are played among the division
 * winners and admit nobody new, so they say nothing about who is in the field.
 * A single championship keeps its one key and 2026 California keeps both
 * (`2026cancmp`, `2026cascmp`: neither is the other plus a digit). Division
 * keys published without their parent are kept as they are.
 *
 * A rule on the keys alone, not a call to `championshipShape`, so a shape the
 * joint proof refuses still gets the same field rule.
 */
export function fieldFixingDcmpKeys(dcmpEventKeys: readonly string[]): string[] {
  return dcmpEventKeys.filter((key) => !dcmpEventKeys.some((other) => other.length === key.length + 1 && other.startsWith(key) && /\d$/.test(other)));
}

/** One row of a team, as far as the proof reads it. */
export interface DcmpFieldProofRow {
  readonly eventKey: string;
  readonly tier: DistrictTier;
}

/** One team, as far as the proof reads it: structural, so an artifact's teams and a merge's working teams both fit. */
export interface DcmpFieldProofTeam {
  readonly eventPoints: readonly DcmpFieldProofRow[];
  readonly remainingEvents: readonly DcmpFieldProofRow[];
}

export interface DcmpFieldProofInput {
  readonly teams: readonly DcmpFieldProofTeam[];
  /** The district's published District Championship capacity, or `null` where it publishes none. */
  readonly dcmpSlots: number | null;
  /** The artifact's season. */
  readonly season: number;
  /** The calendar year at the time of the call, for the season over line. Never the rewound position's. */
  readonly nowYear: number;
  /** The dcmp keys that have STARTED, by the state's own word (the field reading). */
  readonly startedKeys: ReadonlySet<string>;
  /** The dcmp keys whose Awards read final (the number reading of `categoryCorroboration.ts`). */
  readonly awardsFinalKeys: ReadonlySet<string>;
}

export interface DcmpFieldProof {
  /** Lines (a), (b) and (c) all hold. */
  readonly proven: boolean;
  /** Line (a): at least one field fixing key, and every one has started. */
  readonly started: boolean;
  /** Line (b): at least one field fixing key, and every one carries a posted row. */
  readonly posted: boolean;
  /** Which line of (c) proved the field, in the order they are checked, or `null`. */
  readonly completeBy: "capacity" | "finals" | "seasonOver" | null;
  /** Some field fixing key has started and the field is not proven: the one state the readers act on. */
  readonly unprovenAfterStart: boolean;
  /** Every dcmp key on the teams' rows, sorted. */
  readonly dcmpEventKeys: readonly string[];
  readonly fieldFixingKeys: readonly string[];
  /** Teams with a posted row at a field fixing key, each counted once. */
  readonly postedTeams: number;
  /** The team count of the largest posted field fixing key, 0 where none is posted. */
  readonly largestPostedKeyTeams: number;
  /** Half, rounded down, of `largestPostedKeyTeams`: what the capacity line forgives. */
  readonly tolerance: number;
}

/** What the rows alone say: the keys, and who is posted where. */
interface FieldRowCensus {
  readonly dcmpEventKeys: string[];
  readonly fieldFixingKeys: string[];
  readonly postedByKey: ReadonlyMap<string, number>;
  readonly postedTeams: number;
  readonly largestPostedKeyTeams: number;
}

function fieldRowCensus(teams: readonly DcmpFieldProofTeam[]): FieldRowCensus {
  const keys = new Set<string>();
  const postedByKey = new Map<string, number>();
  for (const team of teams) {
    const seen = new Set<string>();
    for (const row of team.eventPoints) {
      if (row.tier !== "dcmp") continue;
      keys.add(row.eventKey);
      if (seen.has(row.eventKey)) continue;
      seen.add(row.eventKey);
      postedByKey.set(row.eventKey, (postedByKey.get(row.eventKey) ?? 0) + 1);
    }
    for (const row of team.remainingEvents) if (row.tier === "dcmp") keys.add(row.eventKey);
  }
  const dcmpEventKeys = [...keys].sort();
  const fieldFixingKeys = fieldFixingDcmpKeys(dcmpEventKeys);
  const fieldFixing = new Set(fieldFixingKeys);
  let postedTeams = 0;
  for (const team of teams) if (team.eventPoints.some((row) => row.tier === "dcmp" && fieldFixing.has(row.eventKey))) postedTeams += 1;
  let largestPostedKeyTeams = 0;
  for (const key of fieldFixingKeys) largestPostedKeyTeams = Math.max(largestPostedKeyTeams, postedByKey.get(key) ?? 0);
  return { dcmpEventKeys, fieldFixingKeys, postedByKey, postedTeams, largestPostedKeyTeams };
}

/**
 * The proof, from the rows, the state's started keys and the awards final
 * keys. See this module's header for the rule and its limits.
 *
 * A finals key for the `finals` line is a dcmp key that is NOT field fixing,
 * which needs a digit suffixed sibling on the rows. A lone parent key with no
 * such sibling is its own field fixing key, so a row at it proves nothing by
 * that line.
 */
export function dcmpFieldProof(input: DcmpFieldProofInput): DcmpFieldProof {
  const census = fieldRowCensus(input.teams);
  const { dcmpEventKeys, fieldFixingKeys, postedByKey, postedTeams, largestPostedKeyTeams } = census;
  const fieldFixing = new Set(fieldFixingKeys);
  const started = fieldFixingKeys.length > 0 && fieldFixingKeys.every((key) => input.startedKeys.has(key));
  const posted = fieldFixingKeys.length > 0 && fieldFixingKeys.every((key) => (postedByKey.get(key) ?? 0) > 0);
  const tolerance = Math.floor(largestPostedKeyTeams / 2);

  let completeBy: DcmpFieldProof["completeBy"] = null;
  if (started && posted) {
    if (input.dcmpSlots !== null && postedTeams >= input.dcmpSlots - tolerance) completeBy = "capacity";
    else if (dcmpEventKeys.some((key) => !fieldFixing.has(key) && (postedByKey.get(key) ?? 0) > 0)) completeBy = "finals";
    else if (input.season < input.nowYear && fieldFixingKeys.every((key) => input.awardsFinalKeys.has(key))) completeBy = "seasonOver";
  }
  const proven = completeBy !== null;
  const unprovenAfterStart = !proven && fieldFixingKeys.some((key) => input.startedKeys.has(key));
  return { proven, started, posted, completeBy, unprovenAfterStart, dcmpEventKeys, fieldFixingKeys, postedTeams, largestPostedKeyTeams, tolerance };
}

/**
 * WHETHER A ROW WHOSE EVENT CARRIES NO STATE BLOCK READS WHOLLY OPEN in the
 * published verdict pass, on its two live paths: true exactly for a dcmp tier
 * row while the championship is still ahead.
 *
 * The live Worker writes a championship's FIRST rows with no state block: the
 * artifact it read carried no row for that event, so it drops the event's
 * state on that tick. The verdict pass reads a stateless row as a hindsight
 * row, its points earned and nothing more expected of it. So for one tick
 * every team at that event lost its whole championship ceiling, and a team
 * read Locked that the next tick took back: walked on 2026 PNW with no
 * championship row first, 10 published `champLock` taken back, and the
 * ceilings of 50 to 161 teams per district dropping and then rising. A
 * stateless championship row while the championship is still ahead is not
 * hindsight: it is a row written before there was anywhere to put the state.
 *
 * A one line rule in the core module so a test can switch it off through a
 * module mock. A district tier row, and any row once the championship is no
 * longer ahead, reads as it always has.
 */
export function statelessChampionshipRowReadsOpen(tier: DistrictTier, championshipStillAhead: boolean): boolean {
  return tier === "dcmp" && championshipStillAhead;
}

/**
 * WHAT A TEAM WITH NO CHAMPIONSHIP ROW CARRIES FOR A FINALS, on top of its
 * one whole hypothetical championship, while the field is not proven: the
 * whole dcmp Playoffs ceiling (90 in 2026). Zero once the field is proven,
 * and at every rewound position, which is how it always read.
 *
 * WHY. The moment a division's rows land, each of its teams carries its
 * division's open categories AND a finals Playoffs ceiling, the whole dcmp
 * Playoffs ceiling while the number of divisions is not known
 * (`champFinalsCeilingWithoutRow` on the tab). A team still on no row may be
 * a team of a division TBA has not posted yet. If it carried one whole
 * championship and no finals, its ceiling ROSE when its rows landed, and a
 * team that had read Locked against the lower ceiling lost it. Walked on the
 * real 2026 FIM artifact with each division's points arriving only as it
 * ends (some divisions wholly final, the next one's rows then posting): 3
 * Locked taken back on the Champ Locks tab starting from no final division,
 * 3 starting from one and 2 starting from two. With this: none.
 * (`scripts/champFieldStagedWalk.test.ts` pins both.)
 *
 * It over states the ceiling of a team whose championship has no finals (an
 * unseen second championship of a district like 2026 California). That only
 * delays a Locked, and only while the field is unproven.
 *
 * A one line rule in the core module so both readers share it and a test
 * can switch it off through a module mock.
 */
export function hypotheticalFinalsCeiling(fieldProven: boolean, dcmpPlayoffsCeiling: number): number {
  return fieldProven ? 0 : dcmpPlayoffsCeiling;
}

/**
 * HOW MANY WHOLE CHAMPIONSHIPS ARE HELD BACK BESIDE THE KNOWN ONES while the
 * field is not proven after a start. Both reservations read it: the Champ
 * Locks tab's (`champLedgerStatus.ts`) and the published one
 * (`reservedChampSlotsAtNow` in `packages/harness/districtRankingsMerge.ts`).
 *
 * The artifact cannot tell unseen divisions of a known championship from an
 * unseen second or third championship, and each championship hands out its
 * own winning alliance and its own judged awards. So the count is the events
 * that may be unseen: the capacity divided by the largest posted field
 * fixing key's team count, rounded up, minus the field fixing keys already
 * known (posted or registered). Where no capacity is published or no key is
 * posted yet there is nothing to divide, and one is held.
 *
 * One was not enough for a district with three championships and one of them
 * posted: three of equal size with one posted holds two.
 *
 * NEVER FEWER THAN ONE WHILE THE CAPACITY LINE FAILS, AND NONE BEYOND THE
 * COUNT ONCE IT HOLDS. While the posted teams fall short of the capacity
 * line something is still missing, so at least one is held whatever the
 * division says. Once the posted teams meet the capacity line (the field is
 * unproven only because a key has not started yet, the one tick a
 * championship's first rows carry no state) every event the capacity
 * implies is known and holds its own reservation, and holding one more
 * would make the total RISE on that tick: a second championship's rows
 * landing took the total from two championships to three and back to two.
 * Walked on the real 2026 California artifact with the finals part of the
 * hypothetical championship switched off, that rise took 2 Locked back. So
 * the total held, known and unseen together, never rises while rows are
 * only added, for one championship in divisions and for two championships
 * with a published capacity.
 *
 * WHERE THE TOTAL CAN STILL RISE, stated: a district that publishes no
 * capacity and plays more than one championship (none does), and a key that
 * has started with no row posted anywhere yet, when its first rows land.
 * In both every team still carries a whole open championship, so nobody is
 * Locked on points to lose it.
 *
 * THIS OVER HOLDS for unseen divisions of ONE known championship (2026 FIM
 * with one division of 40 posted against 160 slots holds three, where the
 * truth is one finals event for all four). It lasts only while the field is
 * unproven, and holding too much only delays a Locked.
 */
export function unseenChampionshipsHeld(teams: readonly DcmpFieldProofTeam[], dcmpSlots: number | null): number {
  const census = fieldRowCensus(teams);
  if (dcmpSlots === null || census.largestPostedKeyTeams <= 0) return 1;
  const unseen = Math.ceil(dcmpSlots / census.largestPostedKeyTeams) - census.fieldFixingKeys.length;
  const capacityMet = census.postedTeams >= dcmpSlots - Math.floor(census.largestPostedKeyTeams / 2);
  return Math.max(capacityMet ? 0 : 1, unseen);
}
