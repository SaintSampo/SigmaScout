/**
 * The pure half of `pointPool.ts`'s proof, which is the half CI actually runs
 * — `pointPool.reconciliation.test.ts` skips wherever `data/corpus.sqlite` is
 * absent, and a green skip proves nothing.
 *
 * What is pinned here and why:
 *
 *   1. THE THREE FIXED POOLS BY VALUE. 236, 213 and the three award values are
 *      the numbers the whole pooled lock rests on. A silent change to any of
 *      them shrinks the pool, and a shrinking pool publishes a `Locked`
 *      guarantee that is not true.
 *   2. THE SELECTION POOL AGAINST ITS OWN SUMMANDS. `SELECTION_POOL` is
 *      computed from `selectionPoints.ts` rather than typed, so the assertion
 *      that matters is that the sum really is the eight captains plus the eight
 *      first picks plus the eight second picks, and 100 + 100 + 36 is checked
 *      part by part.
 *   3. MONOTONICITY IN FIELD SIZE AND ROOKIE COUNT. A bigger field is worth
 *      more, never less; a rookie adds award points, never removes them. Both
 *      are properties a future edit could break without moving any of the
 *      pinned values.
 *   4. THE OPEN-CATEGORY SELECTION. A category that is final contributes
 *      nothing, and a fully finished event's pool is exactly zero — which is
 *      what makes a finished season's verdicts identical with and without the
 *      pooled argument.
 *   5. THE MOST THE PAY RULE CAN PAY ONE EVENT (quick task 261013-lve). Two
 *      things that share no code are held equal: the module's
 *      derivation (`mostPlayoffPointsPaid`, a sum over the eight places an
 *      alliance can leave the bracket at) and a SEARCH that knows nothing of
 *      it. The search types the bracket's feeds by hand, plays every one of the
 *      32,768 ways a bracket can end, tries every lineup of a roster of four
 *      for every alliance, and asks only `playoffPointsPaid`, the pay rule's
 *      own public function, what each finished bracket pays. It never reads
 *      above the derivation and it reaches it, for every registered season,
 *      and a seeded random search that draws every alliance's roster and
 *      lineup at once agrees. A season registered with no declared pay rule,
 *      or with a rule the derivation was not written for, fails here.
 */
import { describe, expect, it } from "vitest";
import {
  AWARD_POOL_BASE,
  AWARD_POOL_FIRST_ROOKIE,
  AWARD_POOL_SECOND_ROOKIE,
  InvalidPoolInputError,
  MOST_PLAYOFF_POINTS_PAID_BY_RULE,
  MOST_ROBOTS_PAID_PER_ALLIANCE,
  PLAYOFF_POOL,
  QUAL_POOL_PHANTOM_ATTENDEES,
  ROBOTS_CREDITED_PER_WIN,
  SELECTION_POOL,
  awardPool,
  eventHasOpenCategory,
  eventRemainingPool,
  mostPlayoffPointsPaid,
  mostSharedByWins,
  qualificationPool,
} from "./pointPool.js";
import { BRACKET_REGISTERED_SEASONS, PLAYOFF_PLACEMENT_POINTS } from "./bracket.js";
import { qualPoints } from "./qualPoints.js";
import { selectionPoints } from "./selectionPoints.js";
import { ALL_CATEGORIES_OPEN, type DistrictCategoryFinality } from "./reservedSlots.js";
import { PLAYOFF_PAY_RULE_BY_SEASON, playoffPayRule, playoffPointsPaid, type PlayoffPayRule, type PlayoffWinRow } from "./securedPlayoffPoints.js";

const ALL_FINAL: DistrictCategoryFinality = { qual: true, alliance: true, elim: true, award: true };

describe("SELECTION_POOL", () => {
  it("is 236, the eight captains plus the eight first picks plus the eight second picks", () => {
    const captains = [1, 2, 3, 4, 5, 6, 7, 8].reduce((sum, alliance) => sum + selectionPoints(0, alliance), 0);
    const firstPicks = [1, 2, 3, 4, 5, 6, 7, 8].reduce((sum, alliance) => sum + selectionPoints(1, alliance), 0);
    const secondPicks = [1, 2, 3, 4, 5, 6, 7, 8].reduce((sum, alliance) => sum + selectionPoints(2, alliance), 0);
    expect(captains).toBe(100);
    expect(firstPicks).toBe(100);
    expect(secondPicks).toBe(36);
    expect(SELECTION_POOL).toBe(236);
    expect(SELECTION_POOL).toBe(captains + firstPicks + secondPicks);
  });

  it("counts the backup robot's slot as worth nothing, so it adds no pool", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].reduce((sum, alliance) => sum + selectionPoints(3, alliance), 0)).toBe(0);
  });
});

describe("PLAYOFF_POOL", () => {
  it("is 213: every placement's value paid to three robots, plus three for a backup robot's prorated share", () => {
    const perAlliance = PLAYOFF_PLACEMENT_POINTS.reduce((sum, points) => sum + points, 0);
    expect(perAlliance).toBe(70);
    expect(PLAYOFF_POOL).toBe(perAlliance * 3 + 3);
    expect(PLAYOFF_POOL).toBe(213);
  });
});

// ---------------------------------------------------------------------------
// Quick task 261013-lve: the most the pay rule can pay one event.
// ---------------------------------------------------------------------------

describe("the most the pay rule can pay all robots of one event (quick task 261013-lve)", () => {
  it("is 214 under the 2023 rule and 216 since 2024", () => {
    expect(MOST_PLAYOFF_POINTS_PAID_BY_RULE).toEqual({ allWins: 214, semifinalWins: 216 });
    for (const rule of Object.keys(MOST_PLAYOFF_POINTS_PAID_BY_RULE) as PlayoffPayRule[]) {
      expect(MOST_PLAYOFF_POINTS_PAID_BY_RULE[rule], rule).toBe(mostPlayoffPointsPaid(rule));
    }
  });

  it("is the placement table times three where no alliance fields a fourth robot: every point above 210 is a rounded share", () => {
    const perAlliance = PLAYOFF_PLACEMENT_POINTS.reduce((sum, points) => sum + points, 0);
    expect(perAlliance).toBe(70);
    // With three robots every robot is on the field for every win and no share has a part to round. A path dropped
    // from the derivation's walk of the bracket would read below 210 here.
    expect(mostPlayoffPointsPaid("semifinalWins", 3)).toBe(perAlliance * 3);
    expect(mostPlayoffPointsPaid("allWins", 3)).toBe(perAlliance * 3);
    expect(MOST_PLAYOFF_POINTS_PAID_BY_RULE.semifinalWins - perAlliance * 3).toBe(6);
    expect(MOST_PLAYOFF_POINTS_PAID_BY_RULE.allWins - perAlliance * 3).toBe(4);
  });

  it("shares an alliance's points by wins with each share rounded up: the parts of the derivation, by hand", () => {
    // A finalist or champion, 20 over three semifinal wins: one robot on the field for all three, three for two each.
    expect(mostSharedByWins(20, 3)).toBe(20 + 14 + 14 + 14);
    // Over four wins every share is a multiple of 5.
    expect(mostSharedByWins(20, 4)).toBe(60);
    // Third place, 13 over two wins or over three; fourth place, 7 over two.
    expect(mostSharedByWins(13, 2)).toBe(13 + 13 + 7 + 7);
    expect(mostSharedByWins(13, 3)).toBe(13 + 13 + 9 + 5);
    expect(mostSharedByWins(7, 2)).toBe(7 + 7 + 4 + 4);
    // 2023: the champion's 30 over five or six wins never leaves a part share, and a finalist's 20 over five neither.
    expect(mostSharedByWins(30, 5)).toBe(90);
    expect(mostSharedByWins(30, 6)).toBe(90);
    expect(mostSharedByWins(20, 5)).toBe(60);
    // Three robots: no rounding at all.
    expect(mostSharedByWins(20, 3, 3)).toBe(60);
    expect(mostSharedByWins(13, 2, 3)).toBe(39);
    expect(mostSharedByWins(7, 2, 3)).toBe(21);
    // Nothing to share, or no win to share it by.
    expect(mostSharedByWins(0, 3)).toBe(0);
    expect(mostSharedByWins(20, 0)).toBe(0);
    // The two sums of the header: the champion's two Finals wins pay 5 a robot a win since 2024.
    expect(62 + 30 + 62 + 40 + 22).toBe(MOST_PLAYOFF_POINTS_PAID_BY_RULE.semifinalWins);
    expect(90 + 62 + 40 + 22).toBe(MOST_PLAYOFF_POINTS_PAID_BY_RULE.allWins);
  });

  it("is proven for four robots an alliance and for no more: the same rule pays more to a fifth robot", () => {
    expect(MOST_ROBOTS_PAID_PER_ALLIANCE).toBe(4);
    expect(ROBOTS_CREDITED_PER_WIN).toBe(3);
    // What the bound would have to be if an alliance could field more robots. It cannot (premise 4 of the module
    // header, held by the corpus gate), and these lines are here so that nobody reads 216 as free of that premise.
    expect(mostPlayoffPointsPaid("semifinalWins", 5)).toBe(220);
    expect(mostPlayoffPointsPaid("allWins", 5)).toBe(217);
    expect(mostPlayoffPointsPaid("semifinalWins", 9)).toBe(225);
    expect(mostPlayoffPointsPaid("allWins", 9)).toBe(222);
    // Nine robots already hold one win each of three wins: more robots add nothing.
    expect(mostPlayoffPointsPaid("semifinalWins", 99)).toBe(225);
    expect(mostPlayoffPointsPaid("allWins", 99)).toBe(222);
  });

  it("is derived for the pay rule of EVERY registered bracket season", () => {
    const bySeason: Record<string, number> = {};
    for (const season of BRACKET_REGISTERED_SEASONS) {
      const rule = playoffPayRule(season);
      // A season registered with no declared pay rule: read that season's district playoff point rule, declare it in
      // `PLAYOFF_PAY_RULE_BY_SEASON`, and derive its bound in `pointPool.ts` before anything rests on the pool.
      expect(rule, `season ${String(season)} is registered with no declared pay rule, so no bound was derived for it`).toBeDefined();
      const bound = MOST_PLAYOFF_POINTS_PAID_BY_RULE[rule!];
      expect(Number.isInteger(bound) && bound > 0, `season ${String(season)}: no bound for the rule ${String(rule)}`).toBe(true);
      bySeason[String(season)] = bound;
    }
    // An equality pin, so a season registered later fails here until its bound has been read.
    expect(bySeason).toEqual({ "2023": 214, "2024": 216, "2025": 216, "2026": 216 });
    // Every declared rule has a bound, and no bound is carried for a rule no season declares.
    expect(Object.keys(MOST_PLAYOFF_POINTS_PAID_BY_RULE).sort()).toEqual([...new Set(Object.values(PLAYOFF_PAY_RULE_BY_SEASON))].sort());
  });
});

// ---------------------------------------------------------------------------
// THE SEARCH. Nothing below reads `mostPlayoffPointsPaid`, `mostSharedByWins`,
// `BRACKET_SETS` or a pay table: the bracket is typed here by hand and every
// total comes out of `playoffPointsPaid`. A feed typed wrong makes that
// function refuse a row, and every refusal is counted and must be zero.
// ---------------------------------------------------------------------------

type SearchFeed = { readonly seed: number } | { readonly winnerOf: number } | { readonly loserOf: number };
/** sf1 to sf13 of the eight alliance double elimination bracket, typed by hand: who meets in each set. */
const SEARCH_FEEDS: readonly (readonly [SearchFeed, SearchFeed])[] = [
  [{ seed: 1 }, { seed: 8 }],
  [{ seed: 4 }, { seed: 5 }],
  [{ seed: 2 }, { seed: 7 }],
  [{ seed: 3 }, { seed: 6 }],
  [{ loserOf: 1 }, { loserOf: 2 }],
  [{ loserOf: 3 }, { loserOf: 4 }],
  [{ winnerOf: 1 }, { winnerOf: 2 }],
  [{ winnerOf: 3 }, { winnerOf: 4 }],
  [{ loserOf: 7 }, { winnerOf: 6 }],
  [{ loserOf: 8 }, { winnerOf: 5 }],
  [{ winnerOf: 7 }, { winnerOf: 8 }],
  [{ winnerOf: 9 }, { winnerOf: 10 }],
  [{ loserOf: 11 }, { winnerOf: 12 }],
];

/** One decisive row of a generated bracket, before its lineup is chosen. */
interface SearchWin {
  readonly compLevel: "sf" | "f";
  readonly setNumber: number;
  readonly matchNumber: number;
  readonly alliance: number;
}

/**
 * The decisive rows of one complete bracket. `semifinals` picks each of the 13 semifinal winners (bit i: the second
 * feed of set i + 1 wins), `finalsWinners` is the order the Finals wins fall in (0 the upper final's winner, 1 the
 * lower final's), ending at the second win of one of them.
 */
function searchBracket(semifinals: number, finalsWinners: readonly (0 | 1)[]): SearchWin[] {
  const winner: number[] = [];
  const loser: number[] = [];
  const resolve = (feed: SearchFeed): number => ("seed" in feed ? feed.seed : "winnerOf" in feed ? winner[feed.winnerOf]! : loser[feed.loserOf]!);
  const wins: SearchWin[] = [];
  SEARCH_FEEDS.forEach(([feedA, feedB], index) => {
    const a = resolve(feedA);
    const b = resolve(feedB);
    const secondWins = ((semifinals >> index) & 1) === 1;
    winner[index + 1] = secondWins ? b : a;
    loser[index + 1] = secondWins ? a : b;
    wins.push({ compLevel: "sf", setNumber: index + 1, matchNumber: 1, alliance: winner[index + 1]! });
  });
  const finalists = [winner[11]!, winner[13]!];
  finalsWinners.forEach((side, index) => wins.push({ compLevel: "f", setNumber: 1, matchNumber: index + 1, alliance: finalists[side]! }));
  return wins;
}

/** The four ways a Finals series can go that differ in who is paid: either side the champion, the other with no win or one. */
const FINALS_SERIES: readonly (readonly (0 | 1)[])[] = [
  [0, 0],
  [1, 1],
  [0, 1, 0],
  [1, 0, 1],
];

const searchRobot = (alliance: number, index: number): string => `frc${String(alliance * 10 + index)}`;
/** The robots on the field when robot `sits` of the alliance's four sits out. Robot 3 sitting is the lineup of a roster of three. */
const searchLineup = (alliance: number, sits: number): string[] => [0, 1, 2, 3].filter((index) => index !== sits).map((index) => searchRobot(alliance, index));
const searchAllianceOf = (teamKey: string): number => Math.floor(Number(teamKey.slice(3)) / 10);
const searchRows = (wins: readonly SearchWin[], sitsAt: (winIndex: number) => number): PlayoffWinRow[] =>
  wins.map((win, index) => ({
    compLevel: win.compLevel,
    setNumber: win.setNumber,
    matchNumber: win.matchNumber,
    winningAllianceNumber: win.alliance,
    winningTeams: searchLineup(win.alliance, sitsAt(index)),
  }));
const sumOf = (paid: ReadonlyMap<string, number>): number => [...paid.values()].reduce((sum, value) => sum + value, 0);

/**
 * Every way to choose who sits out each of `wins` wins of a roster of four, up to renaming the robots (the pay rule
 * cannot tell one robot from another). The sequence of all 3s is the roster of three.
 */
function sitOutSequences(wins: number): number[][] {
  const out: number[][] = [];
  const grow = (sequence: number[], used: number): void => {
    if (sequence.length === wins) {
      out.push(sequence.map((block) => 3 - block));
      return;
    }
    for (let block = 0; block <= Math.min(used, 3); block++) grow([...sequence, block], Math.max(used, block + 1));
  };
  grow([], 0);
  return out;
}

interface SearchResult {
  readonly outcomes: number;
  readonly most: number;
  readonly outcomesAtMost: number;
  readonly least: number;
  readonly refused: number;
  readonly jointDiffers: number;
  readonly calls: number;
}

/**
 * EXHAUSTIVE over brackets and over each alliance's lineups. For every one of the 8,192 semifinal outcomes times the
 * four Finals series, each alliance's lineups are tried in turn (the others on their first three), which is the
 * most that alliance's robots can be paid there. One more call then fields EVERY alliance at its best lineup at
 * once: the joint total must be the sum of the parts, so nothing rests on an alliance's pay being independent of
 * the others' lineups. An alliance's best is remembered by its own winning rows; the joint call checks that too.
 */
function searchSeason(season: number): SearchResult {
  let most = -1;
  let outcomesAtMost = 0;
  let least = Infinity;
  let refused = 0;
  let jointDiffers = 0;
  let calls = 0;
  let outcomes = 0;
  const remembered = new Map<string, { readonly most: number; readonly sits: readonly number[] }>();
  for (let semifinals = 0; semifinals < 1 << SEARCH_FEEDS.length; semifinals++) {
    for (const series of FINALS_SERIES) {
      outcomes += 1;
      const wins = searchBracket(semifinals, series);
      const champion = wins[wins.length - 1]!.alliance;
      const winIndexes = new Map<number, number[]>();
      wins.forEach((win, index) => winIndexes.set(win.alliance, [...(winIndexes.get(win.alliance) ?? []), index]));
      let total = 0;
      const bestSits = new Map<number, number>();
      for (const [alliance, indexes] of winIndexes) {
        const key = `${indexes.map((index) => `${wins[index]!.compLevel}${String(wins[index]!.setNumber)}`).join(",")}|${alliance === champion ? "champion" : ""}`;
        let best = remembered.get(key);
        if (best === undefined) {
          let allianceMost = -1;
          let allianceSits: readonly number[] = [];
          for (const sequence of sitOutSequences(indexes.length)) {
            const sitsByWin = new Map(indexes.map((winIndex, position) => [winIndex, sequence[position]!] as const));
            const paid = playoffPointsPaid(season, "district", 8, searchRows(wins, (index) => sitsByWin.get(index) ?? 3));
            calls += 1;
            if (paid === undefined) {
              refused += 1;
              continue;
            }
            let allianceTotal = 0;
            for (const [teamKey, value] of paid) if (searchAllianceOf(teamKey) === alliance) allianceTotal += value;
            if (allianceTotal > allianceMost) {
              allianceMost = allianceTotal;
              allianceSits = sequence;
            }
          }
          best = { most: allianceMost, sits: allianceSits };
          remembered.set(key, best);
        }
        total += best.most;
        indexes.forEach((winIndex, position) => bestSits.set(winIndex, best.sits[position]!));
      }
      const joint = playoffPointsPaid(season, "district", 8, searchRows(wins, (index) => bestSits.get(index) ?? 3));
      calls += 1;
      if (joint === undefined) refused += 1;
      else if (sumOf(joint) !== total) jointDiffers += 1;
      if (total > most) {
        most = total;
        outcomesAtMost = 0;
      }
      if (total === most) outcomesAtMost += 1;
      if (total < least) least = total;
    }
  }
  return { outcomes, most, outcomesAtMost, least, refused, jointDiffers, calls };
}

/** A small seeded generator (mulberry32), so the random search reads the same on every machine. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * RANDOM AND JOINT: every alliance's roster (three or four robots) and every row's lineup drawn at once, one call a
 * sample, and one field in fifty short a robot. It leans on nothing the exhaustive search leans on.
 */
function randomSearch(season: number, samples: number): { readonly most: number; readonly atMost: number; readonly refused: number } {
  const random = seeded(20261013 + season);
  const pick = (count: number): number => Math.floor(random() * count);
  let most = -1;
  let atMost = 0;
  let refused = 0;
  for (let sample = 0; sample < samples; sample++) {
    const rosterSize = Array.from({ length: 9 }, () => 3 + pick(2));
    const field = (alliance: number): string[] => {
      const roster = Array.from({ length: rosterSize[alliance]! }, (_, index) => searchRobot(alliance, index));
      for (let index = roster.length - 1; index > 0; index--) {
        const other = pick(index + 1);
        [roster[index], roster[other]] = [roster[other]!, roster[index]!];
      }
      return roster.slice(0, pick(50) === 0 ? 2 : 3);
    };
    const series = FINALS_SERIES[pick(FINALS_SERIES.length)]!;
    const rows: PlayoffWinRow[] = searchBracket(pick(1 << SEARCH_FEEDS.length), series).map((win) => ({
      compLevel: win.compLevel,
      setNumber: win.setNumber,
      matchNumber: win.matchNumber,
      winningAllianceNumber: win.alliance,
      winningTeams: field(win.alliance),
    }));
    const paid = playoffPointsPaid(season, "district", 8, rows);
    if (paid === undefined) {
      refused += 1;
      continue;
    }
    const total = sumOf(paid);
    if (total > most) {
      most = total;
      atMost = 0;
    }
    if (total === most) atMost += 1;
  }
  return { most, atMost, refused };
}

describe("the most the pay rule can pay against a search that shares no code with its derivation (quick task 261013-lve)", () => {
  /** What the exhaustive search read when this was written, by the season's declared rule. */
  const SEARCH_PINS: Readonly<Record<PlayoffPayRule, { readonly most: number; readonly outcomesAtMost: number; readonly least: number }>> = {
    allWins: { most: 214, outcomesAtMost: 12_288, least: 212 },
    semifinalWins: { most: 216, outcomesAtMost: 16_384, least: 214 },
  };

  it("reads every registered season, with none passed over", () => {
    // The seasons below come from the registry and are never typed. This pin fails when a season is registered,
    // until the two tests below have been read for it.
    expect([...BRACKET_REGISTERED_SEASONS]).toEqual([2023, 2024, 2025, 2026]);
  });

  for (const season of BRACKET_REGISTERED_SEASONS) {
    it(`season ${String(season)}: over all 32,768 brackets and every lineup of a roster of four, the pay rule never pays more than the derived bound, and reaches it`, () => {
      const rule = playoffPayRule(season);
      expect(rule, `season ${String(season)} has no declared pay rule`).toBeDefined();
      const result = searchSeason(season);
      expect(result.outcomes).toBe(32_768);
      expect(result.refused).toBe(0);
      expect(result.jointDiffers).toBe(0);
      // THE TWO HALVES MEET: the search's most is the derivation's bound, exactly.
      expect(result.most).toBe(mostPlayoffPointsPaid(rule!));
      expect({ most: result.most, outcomesAtMost: result.outcomesAtMost, least: result.least }).toEqual(SEARCH_PINS[rule!]);
    });

    it(`season ${String(season)}: 20,000 random brackets with every roster and lineup drawn at once never pay more than the bound, and reach it`, () => {
      const rule = playoffPayRule(season);
      expect(rule, `season ${String(season)} has no declared pay rule`).toBeDefined();
      const result = randomSearch(season, 20_000);
      expect(result.refused).toBe(0);
      expect(result.most).toBe(mostPlayoffPointsPaid(rule!));
      expect(result.atMost).toBeGreaterThan(0);
    });
  }

  it("the lineup that reaches it, row by row: 216 since 2024 and 214 in 2023", () => {
    // Alliance 1 wins the upper bracket and the Finals in two; alliance 2 loses the upper final and comes back
    // through the lower final; alliance 4 is third and alliance 3 fourth. Each of the four fields a fourth robot.
    const row = (compLevel: "sf" | "f", setNumber: number, matchNumber: number, alliance: number, sits: number): PlayoffWinRow => ({
      compLevel,
      setNumber,
      matchNumber,
      winningAllianceNumber: alliance,
      winningTeams: searchLineup(alliance, sits),
    });
    const bracket = (championSits: readonly [number, number]): PlayoffWinRow[] => [
      row("sf", 1, 1, 1, 3),
      row("sf", 2, 1, 4, 3),
      row("sf", 3, 1, 2, 3),
      row("sf", 4, 1, 3, 3),
      row("sf", 5, 1, 8, 3),
      row("sf", 6, 1, 7, 3),
      row("sf", 7, 1, 1, championSits[0]),
      row("sf", 8, 1, 2, 2),
      row("sf", 9, 1, 4, 3),
      row("sf", 10, 1, 3, 2),
      row("sf", 11, 1, 1, championSits[1]),
      row("sf", 12, 1, 4, 2),
      row("sf", 13, 1, 2, 1),
      row("f", 1, 1, 1, 3),
      row("f", 1, 2, 1, 3),
    ];
    const byAlliance = (paid: ReadonlyMap<string, number>): Record<string, number[]> => {
      const out: Record<string, number[]> = {};
      for (const [teamKey, value] of paid) (out[String(searchAllianceOf(teamKey))] ??= []).push(value);
      for (const values of Object.values(out)) values.sort((a, b) => b - a);
      return out;
    };

    // Since 2024 the champion rotates its fourth robot through its semifinal wins too.
    const since2024 = playoffPointsPaid(2026, "district", 8, bracket([2, 1]))!;
    expect(byAlliance(since2024)).toEqual({ "1": [30, 24, 24, 14], "2": [20, 14, 14, 14], "3": [7, 7, 4, 4], "4": [13, 13, 9, 5], "7": [0, 0, 0], "8": [0, 0, 0] });
    expect(sumOf(since2024)).toBe(216);
    expect(sumOf(since2024)).toBe(MOST_PLAYOFF_POINTS_PAID_BY_RULE.semifinalWins);

    // In 2023 the champion's shares are whole whoever plays, so its first three play throughout.
    const in2023 = playoffPointsPaid(2023, "district", 8, bracket([3, 3]))!;
    expect(byAlliance(in2023)).toEqual({ "1": [30, 30, 30], "2": [20, 14, 14, 14], "3": [7, 7, 4, 4], "4": [13, 13, 9, 5], "7": [0, 0, 0], "8": [0, 0, 0] });
    expect(sumOf(in2023)).toBe(214);
    expect(sumOf(in2023)).toBe(MOST_PLAYOFF_POINTS_PAID_BY_RULE.allWins);

    // The same brackets with every alliance on its first three pay the placement table times three.
    const plain = bracket([3, 3]).map((played) => ({ ...played, winningTeams: searchLineup(played.winningAllianceNumber, 3) }));
    expect(sumOf(playoffPointsPaid(2026, "district", 8, plain)!)).toBe(210);
    expect(sumOf(playoffPointsPaid(2023, "district", 8, plain)!)).toBe(210);
  });
});

describe("awardPool", () => {
  it("is 78, 86 and 91 by attending rookie count, Impact included", () => {
    expect(awardPool(0)).toBe(78);
    expect(awardPool(1)).toBe(86);
    expect(awardPool(2)).toBe(91);
  });

  it("is flat above two rookies, because a third unlocks no further award", () => {
    expect(awardPool(3)).toBe(91);
    expect(awardPool(40)).toBe(91);
  });

  it("names its two rookie increments rather than hiding them inside three literals", () => {
    expect(AWARD_POOL_BASE).toBe(78);
    expect(AWARD_POOL_FIRST_ROOKIE).toBe(8);
    expect(AWARD_POOL_SECOND_ROOKIE).toBe(5);
    expect(awardPool(1) - awardPool(0)).toBe(AWARD_POOL_FIRST_ROOKIE);
    expect(awardPool(2) - awardPool(1)).toBe(AWARD_POOL_SECOND_ROOKIE);
  });

  it("refuses a negative or fractional rookie count rather than returning a smaller pool", () => {
    expect(() => awardPool(-1)).toThrow(InvalidPoolInputError);
    expect(() => awardPool(1.5)).toThrow(InvalidPoolInputError);
  });
});

describe("qualificationPool", () => {
  it("sums f(1) through f(fieldSize), each evaluated at fieldSize plus the phantom-attendee margin", () => {
    expect(QUAL_POOL_PHANTOM_ATTENDEES).toBe(3);
    let expected = 0;
    for (let rank = 1; rank <= 40; rank++) expected += qualPoints(rank, 43);
    expect(qualificationPool(40)).toBe(expected);
    expect(qualificationPool(40)).toBe(533);
  });

  it("is strictly larger than the unmargined sum, which is what covers a field bigger than the artifact shows", () => {
    let unmargined = 0;
    for (let rank = 1; rank <= 40; rank++) unmargined += qualPoints(rank, 40);
    expect(qualificationPool(40)).toBeGreaterThan(unmargined);
  });

  it("grows with the field size", () => {
    let previous = 0;
    for (const fieldSize of [1, 2, 12, 26, 40, 45]) {
      const pool = qualificationPool(fieldSize);
      expect(pool).toBeGreaterThan(previous);
      previous = pool;
    }
    expect(qualificationPool(1)).toBe(22);
    expect(qualificationPool(26)).toBe(357);
    expect(qualificationPool(45)).toBe(595);
  });

  it("refuses a field size that cannot describe a real event", () => {
    expect(() => qualificationPool(0)).toThrow(InvalidPoolInputError);
    expect(() => qualificationPool(-4)).toThrow(InvalidPoolInputError);
    expect(() => qualificationPool(12.5)).toThrow(InvalidPoolInputError);
  });
});

describe("eventRemainingPool", () => {
  it("prices a 40-team event with no rookie, one rookie and two rookies", () => {
    const pool = (rookieCount: number): number => eventRemainingPool({ fieldSize: 40, rookieCount, final: ALL_CATEGORIES_OPEN });
    expect(pool(0)).toBe(1060);
    expect(pool(1)).toBe(1068);
    expect(pool(2)).toBe(1073);
    // The whole of the difference between the three is the award pool.
    expect(pool(0)).toBe(533 + 236 + 213 + 78);
  });

  it("is exactly zero for a finished event, which is every event of a finished season", () => {
    expect(eventRemainingPool({ fieldSize: 40, rookieCount: 2, final: ALL_FINAL })).toBe(0);
  });

  it("adds only the categories that are still open", () => {
    const at = (final: DistrictCategoryFinality): number => eventRemainingPool({ fieldSize: 40, rookieCount: 0, final });
    expect(at({ ...ALL_FINAL, qual: false })).toBe(533);
    expect(at({ ...ALL_FINAL, alliance: false })).toBe(236);
    expect(at({ ...ALL_FINAL, elim: false })).toBe(213);
    expect(at({ ...ALL_FINAL, award: false })).toBe(78);
  });

  it("prices a part played event at its whole open pool, which over-counts on the safe side", () => {
    // Quals done, alliances picked, playoffs and awards still to come.
    expect(eventRemainingPool({ fieldSize: 40, rookieCount: 1, final: { qual: true, alliance: true, elim: false, award: false } })).toBe(213 + 86);
  });
});

describe("eventHasOpenCategory", () => {
  it("is true for any open category and false only when all four are final", () => {
    expect(eventHasOpenCategory(ALL_CATEGORIES_OPEN)).toBe(true);
    expect(eventHasOpenCategory(ALL_FINAL)).toBe(false);
    for (const key of ["qual", "alliance", "elim", "award"] as const) {
      expect(eventHasOpenCategory({ ...ALL_FINAL, [key]: false })).toBe(true);
    }
  });
});
