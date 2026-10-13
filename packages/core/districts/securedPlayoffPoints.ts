/**
 * WHAT TBA PAYS A ROBOT FOR ITS ALLIANCE'S PLAYOFFS, AND THE LEAST IT CAN
 * STILL BE PAID AT A POSITION (quick task 261012-mw2). Pure, no I/O, no zod,
 * no React. Its imports are the `./bracket.js`, `./finalsBracket.js`,
 * `./pointModel.js` and `./qualPoints.js` siblings, read and not changed. The
 * Worker does not import this module, and the published verdicts do not read
 * it.
 *
 * ---------------------------------------------------------------------------
 * THE PAY RULE, MEASURED
 * ---------------------------------------------------------------------------
 *
 * TBA does not pay a robot its alliance's placement value. It pays by WINS.
 * Read from TBA's public source (`district_helper.py`, the two functions
 * `_calc_elim_match_points_2023` and `_calc_elim_match_points`, and
 * `district_point_values.py`) and then fitted against every paid value in
 * `data/corpus.sqlite`: all 507 district points events of 2023 to 2026 with an
 * alliance list, 11,991 team values, 5,946 of them above 0. The rule below
 * equals TBA's number at 11,991 of 11,991, with nothing above and nothing
 * below (`scripts/securedPlayoffCorpus.test.ts` holds the table).
 *
 *   1. Only a DECISIVE row counts: a played semifinal or Finals row with a
 *      winner. A tie has no winner and counts for nobody. A lost row counts
 *      for nobody. A row that was not played does not exist.
 *   2. Each decisive row is credited to the alliance that won it and to the
 *      three robots that were on the field for the winner in that row.
 *   3. Winning a semifinal set adds that set's table points to the alliance:
 *      in the eight alliance bracket 13 for sf7 and sf8, 7 for sf9, sf10, sf11
 *      and sf13, 6 for sf12 and 0 for sf1 to sf6. The sums along any path are
 *      the placement table: 7 for fourth, 13 for third and 20 for a finalist.
 *      In the four alliance finals of a divisioned championship 10 for sf3
 *      and for sf5 and 0 for the others.
 *   4. SINCE 2024 a robot is paid its alliance's table points times the
 *      semifinal wins it was on the field for over the semifinal wins of its
 *      alliance, ROUNDED UP. On top of that it is paid 5 for each Finals win
 *      it was on the field for, and only where its alliance won the Finals.
 *      The sum is then multiplied by the tier weight (3 at a District
 *      Championship, a division and a finals event). The rounding comes
 *      BEFORE the weight.
 *   5. IN 2023 the title added 10 to the alliance's points, and a robot was
 *      paid the whole of that times ALL the wins it was on the field for,
 *      Finals wins included, over all the wins of its alliance, rounded up,
 *      then times the weight.
 *
 * So a robot that sat out is paid less: frc7763 at the 2026 FNC championship
 * was on the field for two of its alliance's three semifinal wins and both
 * Finals wins, and was paid 3 times (14 plus 10), which is 72 of the 90 its
 * partners got. A robot that was on the field only for losses is paid nothing,
 * and so is a listed pick that never played.
 *
 * WHAT IT IS NOT. "The placement value times the matches the robot played
 * over the matches its alliance played" fits the two cases this task started
 * from (72 of 90, and frc3663's 12 of 21 at 2026pncmp) and is wrong: of the
 * 694 robots that sat out a row it is exact at 359, ABOVE what TBA paid at
 * 156 and below at 179. A credit built on it would have been unsound.
 *
 * THE ARITHMETIC IS IN INTEGERS. TBA computes the share in floating point,
 * the points times the quotient of the two win counts, and rounds up. For
 * every points value from 0 to 40 and every win count up to 8 that equals the
 * integer rounding used here (`proratedPlayoffPoints`); the unit test holds
 * that equality, so a rounding edge cannot open between the two.
 *
 * ---------------------------------------------------------------------------
 * THE SECURED MINIMUM
 * ---------------------------------------------------------------------------
 *
 * `securedPlayoffPoints` answers, for every robot with a win at the position:
 * what is the LEAST it can end the event with, over every way the rest of the
 * bracket can go? The robot is taken to be on the field for no further win
 * (a further win can only raise what it is paid). Its alliance is walked down
 * every path it can still take from the set it plays next: each semifinal set
 * lost or won, then, where the path reaches the final, the series lost with
 * 0 or 1 wins or won. The minimum of the pay rule over those futures is the
 * answer. An alliance with no match left has one future, and the answer is
 * then exactly what the rule pays.
 *
 * WHY IT IS A LOWER BOUND. Every real future is one of the futures walked, or
 * differs from one only by the robot being on the field for more wins, which
 * pays at least as much. No future outside the bracket exists: a semifinal
 * set is one match (a tie is replayed and decides nothing), and a Finals
 * series ends at the second win, however many overtime matches it takes.
 *
 * WHY IT NEVER FALLS as rows are played: every future open after a row was
 * open before it, so the minimum is taken over fewer futures, and a win the
 * robot was on the field for only raises each of them.
 *
 * MEASURED (the same corpus test): at every position of every one of
 * the 507 events, in schedule order and in clock order, no robot's secured
 * minimum is above what TBA finally paid it, and no robot's secured minimum is
 * lower than at the position before.
 *
 * SINCE 2024 the Finals never dilute a robot's share (they are paid apart),
 * and along every path of the eight alliance bracket the points per win only
 * rise, so the minimum is the alliance winning nothing more: the table points
 * it holds times the robot's share of its semifinal wins, rounded up. A
 * finalist that was on the field for every semifinal win has secured 20, 60
 * at a District Championship. In 2023 a later win without the robot could
 * lower its share, so the minimum sits below that (a robot with both wins of
 * an alliance that had just won sf7 had secured 10, not 13).
 *
 * ---------------------------------------------------------------------------
 * WHEN NOTHING IS CREDITED (every refusal returns no credit, never a guess)
 * ---------------------------------------------------------------------------
 *
 *   - A season with no declared pay rule. The rule is declared per season
 *     (`PLAYOFF_PAY_RULE_BY_SEASON`) and the unit test holds the declared
 *     seasons equal to `BRACKET_REGISTERED_SEASONS`: registering a season
 *     without deciding its pay rule fails a test instead of crediting on a
 *     rule nobody measured.
 *   - An alliance count other than 8, 4 or 2.
 *   - A row at a level or set the bracket does not carry.
 *   - A row whose set has a participant the earlier rows do not decide (a row
 *     is missing upstream: the win counts could be short, and a short count
 *     of the alliance's wins would OVERSTATE a robot's share).
 *   - A row whose winner is not one of its set's two alliances.
 *   - More wins than a set can hold: a single match set with two decisive
 *     rows, a third Finals win, or both alliances at two Finals wins. None is
 *     in the corpus (0 of 7,554 playoff rows). The decisive rows of a set are
 *     counted in whatever order their match numbers run, as TBA counts them:
 *     at 2024necmp the replay of a tied Finals match is numbered after the
 *     two matches that followed it.
 *   - A robot whose winning rows name two alliances. Not in the corpus.
 *
 * WHAT IT RESTS ON AND DOES NOT PROVE. The rows are read as played. If TBA
 * later CHANGES a decisive row (a match replayed by the head referee after
 * its result was posted) the alliance's points and wins change with it, and a
 * secured minimum read off the first result can fall. The corpus cannot
 * measure how often that happens: it keeps the final result only. The lock
 * math already rested on the same reading before this task (a knocked out
 * alliance's ceiling, the joint proof's alive alliances). And the rule is
 * TBA's code as it stood when measured: it is declared per season so a change
 * is a decision, not a drift.
 *
 * THE RESIDUAL RISK, IN PLAIN WORDS. A team shown Locked on the strength of
 * this credit could have that Locked withdrawn if a playoff result is
 * corrected after it was posted. Nothing in this code can rule that out. And
 * the pay rule is not ours: it was read from TBA's public source and fitted
 * to four seasons of paid values (2023 to 2026). It is not something this
 * code controls. If TBA or FIRST changes how playoff points are paid, every
 * credit here is a guess until the rule is read and measured again.
 *
 * A NEW SEASON'S DECLARED RULE IS A CLAIM UNTIL THE CORPUS GATE HAS READ IT.
 * `scripts/securedPlayoffCorpus.test.ts` takes its seasons from
 * `BRACKET_REGISTERED_SEASONS`, with no last year written into it, and fails
 * if a registered season has finished brackets with paid values in the corpus
 * and none of them was compared. A registered season the corpus holds no
 * finished bracket of is printed there by name: for that season the rule
 * below is declared and NOT measured. A new season's declared rule must pass
 * that gate on the season's first finished events before the credit can be
 * trusted for it. Whoever registers a season reads that season's district
 * playoff point rule in the game manual FIRST (`PLAYOFF_PAY_RULE_BY_SEASON`
 * below says where), declares its line, and reruns the gate as soon as the
 * season's first events are in the corpus.
 */
import { BRACKET_REGISTERED_SEASONS, BRACKET_SETS, type BracketFeed } from "./bracket.js";
import { FINALS_SETS } from "./finalsBracket.js";
import type { DistrictTier } from "./pointModel.js";
import { districtTierWeight } from "./qualPoints.js";

/** How a season's playoff points are shared among an alliance's robots (this module's header, points 4 and 5). */
export type PlayoffPayRule = "allWins" | "semifinalWins";

/**
 * The pay rule of every season this module credits, each measured against
 * that season's own paid values. A season absent here is credited nothing.
 *
 * REGISTERING A NEW SEASON? A unit test fails until the season added to
 * `BRACKET_REGISTERED_SEASONS` is added here too. Before adding it, read that
 * season's district playoff point rule in the game manual (the section on
 * district points for playoff performance) and TBA's `district_helper.py`,
 * and do not copy last season's line on trust: the rule changed between 2023
 * and 2024, and this code does not control it. Once the season has paid
 * values in the corpus, `scripts/securedPlayoffCorpus.test.ts` holds the fit:
 * it reads its seasons from `BRACKET_REGISTERED_SEASONS`, so the new season is
 * compared without an edit there, and its pinned counts then fail until they
 * are read again. Until that gate has passed on the season's first finished
 * events, the line added here is declared and not measured, and a Locked that
 * rests on it is not to be trusted.
 */
export const PLAYOFF_PAY_RULE_BY_SEASON: Readonly<Record<number, PlayoffPayRule>> = {
  2023: "allWins",
  2024: "semifinalWins",
  2025: "semifinalWins",
  2026: "semifinalWins",
};

/** The declared pay rule of a season, or `undefined` for a season this module credits nothing in. */
export function playoffPayRule(season: number): PlayoffPayRule | undefined {
  if (!BRACKET_REGISTERED_SEASONS.includes(season)) return undefined;
  return PLAYOFF_PAY_RULE_BY_SEASON[season];
}

/** What winning each semifinal set of the EIGHT alliance bracket adds to the winner's playoff points (base, unweighted). */
export const SEMIFINAL_WIN_POINTS: Readonly<Record<string, number>> = {
  sf1: 0,
  sf2: 0,
  sf3: 0,
  sf4: 0,
  sf5: 0,
  sf6: 0,
  sf7: 13,
  sf8: 13,
  sf9: 7,
  sf10: 7,
  sf11: 7,
  sf12: 6,
  sf13: 7,
};

/** The same for the FOUR alliance finals of a divisioned District Championship. */
export const FINALS_SEMIFINAL_WIN_POINTS: Readonly<Record<string, number>> = { sf1: 0, sf2: 0, sf3: 10, sf4: 0, sf5: 10 };

/** What one Finals win pays a robot of the winning alliance that was on the field for it (base, unweighted). */
export const FINALS_WIN_POINTS = 5;

/** The alliance counts this module carries a bracket for. */
export type PlayoffPayAllianceCount = 8 | 4 | 2;

/**
 * One DECISIVE playoff row: TBA's own match coordinates, the alliance that won
 * it and the robots that were on the field for the winner. A tie, a lost side
 * and an unplayed row are never handed over.
 */
export interface PlayoffWinRow {
  readonly compLevel: string;
  readonly setNumber: number;
  readonly matchNumber: number;
  readonly winningAllianceNumber: number;
  readonly winningTeams: readonly string[];
}

/**
 * `points` times `teamWins` over `allianceWins`, rounded UP, in integers. 0
 * where the alliance has no win. Equal to TBA's own floating point
 * `ceil(points * (teamWins / allianceWins))` over every reachable input (this
 * module's header).
 */
export function proratedPlayoffPoints(points: number, teamWins: number, allianceWins: number): number {
  if (allianceWins <= 0 || teamWins <= 0 || points <= 0) return 0;
  return Math.floor((points * teamWins + allianceWins - 1) / allianceWins);
}

interface PaySet {
  readonly id: string;
  readonly feedA: BracketFeed;
  readonly feedB: BracketFeed;
  readonly winsNeeded: number;
  /** What one win of this set adds to the winner's table points. 0 for the final, which is paid apart. */
  readonly winPoints: number;
}

const FINAL_SET_ID = "f";

function paySetsFor(allianceCount: number): readonly PaySet[] | undefined {
  if (allianceCount === 8) {
    return BRACKET_SETS.map((set) => ({
      id: set.id,
      feedA: set.feedA,
      feedB: set.feedB,
      winsNeeded: Math.floor(set.bestOf / 2) + 1,
      winPoints: SEMIFINAL_WIN_POINTS[set.id] ?? 0,
    }));
  }
  if (allianceCount === 4 || allianceCount === 2) {
    return FINALS_SETS[allianceCount].map((set) => ({
      id: set.id,
      feedA: set.feedA,
      feedB: set.feedB,
      winsNeeded: set.winsNeeded,
      winPoints: FINALS_SEMIFINAL_WIN_POINTS[set.id] ?? 0,
    }));
  }
  return undefined;
}

function setIdOfRow(row: PlayoffWinRow, known: ReadonlySet<string>): string | undefined {
  if (row.compLevel === "f") return row.setNumber === 1 && known.has(FINAL_SET_ID) ? FINAL_SET_ID : undefined;
  if (row.compLevel !== "sf") return undefined;
  const id = `sf${String(row.setNumber)}`;
  return known.has(id) ? id : undefined;
}

interface AllianceTally {
  points: number;
  semifinalWins: number;
  finalsWins: number;
}

interface TeamTally {
  allianceNumber: number;
  semifinalWins: number;
  finalsWins: number;
}

/** One way an alliance's playoffs can end: its table points and its wins. */
interface AllianceFuture {
  readonly points: number;
  readonly semifinalWins: number;
  readonly finalsWins: number;
}

interface PayState {
  readonly rule: PlayoffPayRule;
  readonly weight: number;
  readonly finalWinsNeeded: number;
  readonly alliances: ReadonlyMap<number, AllianceTally>;
  readonly teams: ReadonlyMap<string, TeamTally>;
  /** Every alliance with a tally: each way its playoffs can still end, its present standing included where it has no match left. */
  readonly futuresOf: (allianceNumber: number) => readonly AllianceFuture[];
}

/**
 * Reads the decisive rows into the tallies the pay rule needs and each
 * alliance's place in the bracket, or `undefined` for any of this module's
 * refusals.
 */
function payState(season: number, tier: DistrictTier, allianceCount: number, rows: readonly PlayoffWinRow[]): PayState | undefined {
  const rule = playoffPayRule(season);
  if (rule === undefined) return undefined;
  const sets = paySetsFor(allianceCount);
  if (sets === undefined) return undefined;
  const setById = new Map(sets.map((set) => [set.id, set] as const));
  const knownIds: ReadonlySet<string> = new Set(setById.keys());

  // The decisive rows of each set, in match number order.
  const rowsBySet = new Map<string, PlayoffWinRow[]>();
  for (const row of rows) {
    const setId = setIdOfRow(row, knownIds);
    if (setId === undefined) return undefined;
    const list = rowsBySet.get(setId) ?? [];
    list.push(row);
    rowsBySet.set(setId, list);
  }
  for (const list of rowsBySet.values()) list.sort((a, b) => a.matchNumber - b.matchNumber);

  const winnerBySet = new Map<string, number>();
  const loserBySet = new Map<string, number>();
  const slotsBySet = new Map<string, readonly [number | undefined, number | undefined]>();
  const resolveFeed = (feed: BracketFeed): number | undefined => {
    if (feed.kind === "seed") return feed.seed;
    return (feed.kind === "winner" ? winnerBySet : loserBySet).get(feed.setId);
  };

  const alliances = new Map<number, AllianceTally>();
  const teams = new Map<string, TeamTally>();
  const allianceTally = (allianceNumber: number): AllianceTally => {
    let tally = alliances.get(allianceNumber);
    if (tally === undefined) {
      tally = { points: 0, semifinalWins: 0, finalsWins: 0 };
      alliances.set(allianceNumber, tally);
    }
    return tally;
  };

  for (const set of sets) {
    const allianceA = resolveFeed(set.feedA);
    const allianceB = resolveFeed(set.feedB);
    slotsBySet.set(set.id, [allianceA, allianceB]);
    const played = rowsBySet.get(set.id) ?? [];
    if (played.length === 0) continue;
    // A row whose set has a participant the earlier rows do not decide: a row is missing upstream.
    if (allianceA === undefined || allianceB === undefined) return undefined;
    let winsA = 0;
    let winsB = 0;
    for (const row of played) {
      const winner = row.winningAllianceNumber;
      if (winner !== allianceA && winner !== allianceB) return undefined;
      if (winner === allianceA) winsA += 1;
      else winsB += 1;
      const tally = allianceTally(winner);
      const isFinal = set.id === FINAL_SET_ID;
      if (isFinal) tally.finalsWins += 1;
      else {
        tally.semifinalWins += 1;
        tally.points += set.winPoints;
      }
      for (const teamKey of row.winningTeams) {
        const team = teams.get(teamKey);
        if (team === undefined) {
          teams.set(teamKey, { allianceNumber: winner, semifinalWins: isFinal ? 0 : 1, finalsWins: isFinal ? 1 : 0 });
          continue;
        }
        // A robot whose winning rows name two alliances.
        if (team.allianceNumber !== winner) return undefined;
        if (isFinal) team.finalsWins += 1;
        else team.semifinalWins += 1;
      }
    }
    // EVERY DECISIVE ROW OF A SET COUNTS, in whatever order its match numbers
    // run: TBA numbers a replayed Finals tie after the matches that followed
    // it (2024necmp: f1m4 was played before f1m2), and pays by the count
    // alone. More wins than a set can hold is refused: a second decisive row
    // of a single match set, a third Finals win, or both alliances at the
    // title.
    if (winsA > set.winsNeeded || winsB > set.winsNeeded) return undefined;
    if (winsA >= set.winsNeeded && winsB >= set.winsNeeded) return undefined;
    if (winsA >= set.winsNeeded || winsB >= set.winsNeeded) {
      const setWinner = winsA >= set.winsNeeded ? allianceA : allianceB;
      winnerBySet.set(set.id, setWinner);
      loserBySet.set(set.id, setWinner === allianceA ? allianceB : allianceA);
    }
  }

  const finalWinsNeeded = setById.get(FINAL_SET_ID)?.winsNeeded ?? 2;
  const targetOf = (kind: "winner" | "loser", setId: string): string | undefined =>
    sets.find((set) => (set.feedA.kind === kind && set.feedA.setId === setId) || (set.feedB.kind === kind && set.feedB.setId === setId))?.id;

  const futuresOf = (allianceNumber: number): readonly AllianceFuture[] => {
    const tally = alliances.get(allianceNumber) ?? { points: 0, semifinalWins: 0, finalsWins: 0 };
    // The set this alliance plays next: the one undecided set it is a participant of.
    let pending: string | undefined;
    for (const set of sets) {
      if (winnerBySet.has(set.id)) continue;
      const slots = slotsBySet.get(set.id);
      if (slots !== undefined && (slots[0] === allianceNumber || slots[1] === allianceNumber)) {
        pending = set.id;
        break;
      }
    }
    const out: AllianceFuture[] = [];
    const walk = (setId: string | undefined, points: number, semifinalWins: number, finalsWins: number): void => {
      if (setId === undefined) {
        out.push({ points, semifinalWins, finalsWins });
        return;
      }
      if (setId === FINAL_SET_ID) {
        // The series lost with any number of wins short of the title, or won.
        for (let wins = finalsWins; wins < finalWinsNeeded; wins++) out.push({ points, semifinalWins, finalsWins: wins });
        out.push({ points, semifinalWins, finalsWins: finalWinsNeeded });
        return;
      }
      const set = setById.get(setId)!;
      walk(targetOf("loser", setId), points, semifinalWins, finalsWins);
      walk(targetOf("winner", setId), points + set.winPoints, semifinalWins + 1, finalsWins);
    };
    walk(pending, tally.points, tally.semifinalWins, tally.finalsWins);
    return out;
  };

  return { rule, weight: districtTierWeight(season, tier), finalWinsNeeded, alliances, teams, futuresOf };
}

/** The pay rule for one robot at one way its alliance's playoffs end (base, unweighted). */
function payAt(rule: PlayoffPayRule, finalWinsNeeded: number, future: AllianceFuture, team: TeamTally): number {
  const champion = future.finalsWins >= finalWinsNeeded;
  if (rule === "allWins") {
    const points = future.points + (champion ? 2 * FINALS_WIN_POINTS : 0);
    return proratedPlayoffPoints(points, team.semifinalWins + team.finalsWins, future.semifinalWins + future.finalsWins);
  }
  return proratedPlayoffPoints(future.points, team.semifinalWins, future.semifinalWins) + (champion ? FINALS_WIN_POINTS * team.finalsWins : 0);
}

/**
 * WHAT THE PAY RULE PAYS FOR EXACTLY THESE ROWS: every robot with a win, at
 * its alliance's present table points and wins, times the tier weight. Over a
 * finished bracket this is TBA's own `elim` (this module's header: 11,991 of
 * 11,991). A robot with no win is absent, which is 0. `undefined` for any of
 * this module's refusals.
 */
export function playoffPointsPaid(season: number, tier: DistrictTier, allianceCount: number, rows: readonly PlayoffWinRow[]): ReadonlyMap<string, number> | undefined {
  const state = payState(season, tier, allianceCount, rows);
  if (state === undefined) return undefined;
  const out = new Map<string, number>();
  for (const [teamKey, team] of state.teams) {
    const tally = state.alliances.get(team.allianceNumber)!;
    out.set(teamKey, payAt(state.rule, state.finalWinsNeeded, tally, team) * state.weight);
  }
  return out;
}

/**
 * THE SECURED MINIMUM of every robot with a win at the position: the least
 * the pay rule can still pay it over every way the rest of the bracket can
 * go, times the tier weight (this module's header). A robot with no win is
 * absent, which is 0. EMPTY for any of this module's refusals: nothing is
 * credited on rows this module cannot read whole.
 */
export function securedPlayoffPoints(season: number, tier: DistrictTier, allianceCount: number, rows: readonly PlayoffWinRow[]): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  const state = payState(season, tier, allianceCount, rows);
  if (state === undefined) return out;
  const futuresByAlliance = new Map<number, readonly AllianceFuture[]>();
  for (const [teamKey, team] of state.teams) {
    let futures = futuresByAlliance.get(team.allianceNumber);
    if (futures === undefined) {
      futures = state.futuresOf(team.allianceNumber);
      futuresByAlliance.set(team.allianceNumber, futures);
    }
    let least = Infinity;
    for (const future of futures) least = Math.min(least, payAt(state.rule, state.finalWinsNeeded, future, team));
    out.set(teamKey, (least === Infinity ? 0 : least) * state.weight);
  }
  return out;
}
