/**
 * The pure half of `securedPlayoffPoints.ts` (quick task 261012-mw2): the pay
 * rule on hand built brackets, the secured minimum against an INDEPENDENT
 * enumeration of every way the bracket can still go, and every refusal. No
 * local data: this file runs everywhere, CI included.
 * `scripts/securedPlayoffCorpus.test.ts` is the other half, which holds the
 * rule against every value TBA has paid.
 *
 * WHAT IS INDEPENDENT HERE. `leastOverCompletions` below shares nothing with
 * the module's own walk of an alliance's futures: it completes the WHOLE
 * bracket in every possible way (every remaining semifinal set to either
 * side, every Finals series), keeps the robot off the field for every further
 * win, and asks only `playoffPointsPaid` what each finished bracket pays. The
 * secured minimum must equal the least of those payments.
 */
import { describe, expect, it } from "vitest";
import { BRACKET_REGISTERED_SEASONS, BRACKET_SETS } from "./bracket.js";
import {
  FINALS_SEMIFINAL_WIN_POINTS,
  FINALS_WIN_POINTS,
  PLAYOFF_PAY_RULE_BY_SEASON,
  SEMIFINAL_WIN_POINTS,
  playoffPayRule,
  playoffPointsPaid,
  proratedPlayoffPoints,
  securedPlayoffPoints,
  type PlayoffWinRow,
} from "./securedPlayoffPoints.js";

/** The three robots alliance `n` fields unless a test says otherwise. */
const robots = (n: number): string[] => [`a${String(n)}x`, `a${String(n)}y`, `a${String(n)}z`];
const sf = (setNumber: number, winner: number, teams: readonly string[] = robots(winner), matchNumber = 1): PlayoffWinRow => ({
  compLevel: "sf",
  setNumber,
  matchNumber,
  winningAllianceNumber: winner,
  winningTeams: teams,
});
const final = (matchNumber: number, winner: number, teams: readonly string[] = robots(winner)): PlayoffWinRow => ({
  compLevel: "f",
  setNumber: 1,
  matchNumber,
  winningAllianceNumber: winner,
  winningTeams: teams,
});

/** The chalk bracket through Round 5: 1 beats 8, 4 beats 5, 2 beats 7, 3 beats 6, and so on, alliance 1 and alliance 2 to the final. */
const CHALK: readonly PlayoffWinRow[] = [
  sf(1, 1),
  sf(2, 4),
  sf(3, 2),
  sf(4, 3),
  sf(5, 5), // 8 against 5
  sf(6, 6), // 7 against 6
  sf(7, 1), // 1 against 4
  sf(8, 2), // 2 against 3
  sf(9, 4), // 4 against 6
  sf(10, 3), // 3 against 5
  sf(11, 1), // 1 against 2
  sf(12, 3), // 4 against 3
  sf(13, 2), // 2 against 3
];

describe("the pay rule's arithmetic", () => {
  it("rounds up in integers exactly as TBA's floating point does, for every points value to 40 and every win count to 8", () => {
    let compared = 0;
    for (let points = 0; points <= 40; points++) {
      for (let allianceWins = 1; allianceWins <= 8; allianceWins++) {
        for (let teamWins = 0; teamWins <= allianceWins; teamWins++) {
          // TBA: math.ceil(points * (team_wins / alliance_wins)), in that order.
          expect(proratedPlayoffPoints(points, teamWins, allianceWins), `${String(points)} x ${String(teamWins)}/${String(allianceWins)}`).toBe(Math.ceil(points * (teamWins / allianceWins)));
          compared += 1;
        }
      }
    }
    expect(compared).toBe(1804);
    expect(proratedPlayoffPoints(20, 3, 0)).toBe(0);
    expect(proratedPlayoffPoints(20, 2, 3)).toBe(14);
    expect(proratedPlayoffPoints(7, 1, 2)).toBe(4);
  });

  it("declares a pay rule for exactly the seasons the bracket is registered for", () => {
    expect(
      Object.keys(PLAYOFF_PAY_RULE_BY_SEASON)
        .map(Number)
        .sort((a, b) => a - b),
      "a bracket season is registered with no declared playoff pay rule, or a rule is declared for a season with no bracket: read that season's district playoff point rule in the game manual and TBA's district_helper.py first, then add its line to PLAYOFF_PAY_RULE_BY_SEASON"
    ).toEqual([...BRACKET_REGISTERED_SEASONS]);
    expect(playoffPayRule(2023)).toBe("allWins");
    expect(playoffPayRule(2026)).toBe("semifinalWins");
    expect(playoffPayRule(2022)).toBeUndefined();
    expect(playoffPayRule(2027)).toBeUndefined();
  });

  it("carries a table value for every semifinal set, summing to the placement table along every path", () => {
    expect(Object.keys(SEMIFINAL_WIN_POINTS).sort()).toEqual(BRACKET_SETS.filter((set) => set.id !== "f").map((set) => set.id).sort());
    const sum = (...ids: string[]): number => ids.reduce((total, id) => total + SEMIFINAL_WIN_POINTS[id]!, 0);
    expect(sum("sf1", "sf7", "sf11")).toBe(20); // the upper bracket to the final
    expect(sum("sf1", "sf7", "sf13")).toBe(20); // through the lower final
    expect(sum("sf1", "sf7")).toBe(13); // third
    expect(sum("sf1", "sf9", "sf12", "sf13")).toBe(20);
    expect(sum("sf5", "sf10", "sf12")).toBe(13);
    expect(sum("sf5", "sf10")).toBe(7); // fourth
    expect(sum("sf5")).toBe(0);
    expect(FINALS_SEMIFINAL_WIN_POINTS).toEqual({ sf1: 0, sf2: 0, sf3: 10, sf4: 0, sf5: 10 });
    expect(FINALS_WIN_POINTS).toBe(5);
  });
});

describe("the pay rule since 2024, on hand built brackets", () => {
  it("pays a finalist that was on the field for every win the whole placement value, and secures it before the final", () => {
    const secured = securedPlayoffPoints(2026, "dcmp", 8, CHALK);
    for (const robot of [...robots(1), ...robots(2)]) expect(secured.get(robot)).toBe(60);
    // Third and fourth are decided, and their secured minimum is what the rule pays.
    for (const robot of robots(3)) expect(secured.get(robot)).toBe(39);
    for (const robot of robots(4)) expect(secured.get(robot)).toBe(21);
    // Alliances 5 and 6 won a set that pays nothing; 7 and 8 never won and are absent.
    for (const robot of [...robots(5), ...robots(6)]) expect(secured.get(robot)).toBe(0);
    expect(secured.has("a7x")).toBe(false);
    expect(securedPlayoffPoints(2026, "district", 8, CHALK).get("a1x")).toBe(20);

    const finished = [...CHALK, final(1, 1), final(2, 1)];
    const paid = playoffPointsPaid(2026, "dcmp", 8, finished)!;
    for (const robot of robots(1)) expect(paid.get(robot)).toBe(90);
    for (const robot of robots(2)) expect(paid.get(robot)).toBe(60);
    expect(securedPlayoffPoints(2026, "dcmp", 8, finished)).toEqual(paid);
  });

  it("pays a robot that sat out a win its share, rounded up before the weight: the 2026 FNC championship", () => {
    // Alliance 2 won sf3 and sf8 with its first three and sf11 with its backup in for the third pick.
    const rows = CHALK.filter((row) => row.setNumber !== 11 && row.setNumber !== 13);
    const withBackup = [...rows, sf(11, 2, ["a2x", "a2y", "backup"]), sf(13, 1)];
    const secured = securedPlayoffPoints(2026, "dcmp", 8, withBackup);
    expect(secured.get("a2x")).toBe(60);
    expect(secured.get("a2z")).toBe(42); // two of three semifinal wins: 14, times 3
    expect(secured.get("backup")).toBe(21); // one of three: 7, times 3
    const paid = playoffPointsPaid(2026, "dcmp", 8, [...withBackup, final(1, 2, ["a2x", "a2y", "a2z"]), final(2, 2, ["a2x", "a2y", "a2z"])])!;
    expect(paid.get("a2x")).toBe(90);
    expect(paid.get("a2z")).toBe(72); // 14 and both Finals wins, times 3
    expect(paid.get("backup")).toBe(21);
  });

  it("pays 5 for each Finals win a champion's robot was on the field for, and a losing finalist nothing for the one it won", () => {
    const rows = [...CHALK, final(1, 1), final(2, 2), final(3, 1, ["a1x", "a1y", "late"])];
    const paid = playoffPointsPaid(2026, "district", 8, rows)!;
    expect(paid.get("a1x")).toBe(30);
    expect(paid.get("a1z")).toBe(25); // one of the two Finals wins
    expect(paid.get("late")).toBe(5); // no semifinal win, one Finals win
    for (const robot of robots(2)) expect(paid.get(robot)).toBe(20);
  });

  it("secures a lower bracket survivor what it holds: 7 after Round 3, 13 after Round 4", () => {
    const untilRoundThree = CHALK.filter((row) => row.setNumber <= 10);
    const afterThree = securedPlayoffPoints(2025, "district", 8, untilRoundThree);
    expect(afterThree.get("a3x")).toBe(7);
    expect(afterThree.get("a1x")).toBe(13);
    const afterFour = securedPlayoffPoints(2025, "district", 8, CHALK.filter((row) => row.setNumber <= 12));
    expect(afterFour.get("a3x")).toBe(13);
    expect(afterFour.get("a1x")).toBe(20);
    expect(afterFour.get("a2x")).toBe(13); // lost the upper final, still to play the lower final
  });

  it("counts a replayed tie once: the replay's row is the set's one decisive row", () => {
    // sf12 was tied (no row) and replayed under match number 2.
    const rows = CHALK.map((row) => (row.setNumber === 12 ? sf(12, 3, robots(3), 2) : row));
    expect(securedPlayoffPoints(2024, "district", 8, rows)).toEqual(securedPlayoffPoints(2024, "district", 8, CHALK));
  });

  it("counts a Finals series by its wins, whatever order its match numbers run in: overtime after a tie", () => {
    // f1m1 tied (no row); the replay is numbered 4 and was played before matches 2 and 3 (2024necmp).
    const rows = [...CHALK, final(2, 2), final(3, 2), final(4, 1)];
    const paid = playoffPointsPaid(2024, "district", 8, rows)!;
    for (const robot of robots(2)) expect(paid.get(robot)).toBe(30);
    for (const robot of robots(1)) expect(paid.get(robot)).toBe(20);
  });
});

describe("the 2023 pay rule, on hand built brackets", () => {
  it("shares one pot over every win, so a finalist that sits out a later win has secured less than its placement", () => {
    // Alliance 1 after Round 2: sf1 and sf7 won with the same three robots.
    const afterTwo = CHALK.filter((row) => row.setNumber <= 8);
    // Worst case: two more wins without the robot (the upper final and one Finals match), then the series lost: 20 x 2 / 4.
    expect(securedPlayoffPoints(2023, "district", 8, afterTwo).get("a1x")).toBe(10);
    expect(securedPlayoffPoints(2024, "district", 8, afterTwo).get("a1x")).toBe(13);
    // A finalist with all three semifinal wins: the least of 20, 20 x 3 / 4 and 30 x 3 / 5.
    expect(securedPlayoffPoints(2023, "district", 8, CHALK).get("a1x")).toBe(15);
    expect(securedPlayoffPoints(2023, "dcmp", 8, CHALK).get("a1x")).toBe(45);
  });

  it("pays the champion 30 over all its wins, and a robot that sat out one of its five 24", () => {
    const rows = [...CHALK.filter((row) => row.setNumber !== 13), sf(13, 2, ["a2x", "a2y", "sub"]), final(1, 2), final(2, 2)];
    const paid = playoffPointsPaid(2023, "district", 8, rows)!;
    // Alliance 2: sf3, sf8, sf13 and two Finals wins, five wins, 30 points.
    expect(paid.get("a2x")).toBe(30);
    expect(paid.get("a2z")).toBe(24); // four of five
    expect(paid.get("sub")).toBe(6); // one of five
    for (const robot of robots(1)) expect(paid.get(robot)).toBe(20);
  });
});

describe("the finals of a divisioned championship", () => {
  it("pays the four alliance finals 10 for the upper final or the lower final and 5 a Finals win", () => {
    const rows: PlayoffWinRow[] = [sf(1, 1), sf(2, 2), sf(3, 1), sf(4, 3), sf(5, 2)];
    const secured = securedPlayoffPoints(2026, "dcmp", 4, rows);
    for (const robot of [...robots(1), ...robots(2)]) expect(secured.get(robot)).toBe(30);
    for (const robot of robots(3)) expect(secured.get(robot)).toBe(0);
    const paid = playoffPointsPaid(2026, "dcmp", 4, [...rows, final(1, 2), final(2, 2)])!;
    for (const robot of robots(2)) expect(paid.get(robot)).toBe(60);
    for (const robot of robots(1)) expect(paid.get(robot)).toBe(30);
  });

  it("secures nothing in the two alliance finals until the title is won", () => {
    expect(securedPlayoffPoints(2026, "dcmp", 2, [final(1, 1)]).get("a1x")).toBe(0);
    const paid = playoffPointsPaid(2026, "dcmp", 2, [final(1, 1), final(2, 2), final(3, 1, ["a1x", "a1y", "late"])])!;
    expect(paid.get("a1x")).toBe(30);
    expect(paid.get("a1z")).toBe(15);
    expect(paid.get("late")).toBe(15);
    expect(paid.get("a2x")).toBe(0);
  });
});

describe("nothing is credited on rows the module cannot read whole", () => {
  const refused = (season: number, allianceCount: number, rows: readonly PlayoffWinRow[]): void => {
    expect(securedPlayoffPoints(season, "district", allianceCount, rows).size).toBe(0);
    expect(playoffPointsPaid(season, "district", allianceCount, rows)).toBeUndefined();
  };
  it("a season with no declared pay rule", () => {
    refused(2022, 8, CHALK);
    refused(2027, 8, CHALK);
  });
  it("an alliance count other than 8, 4 or 2", () => {
    refused(2026, 6, [sf(1, 1)]);
  });
  it("a row at a level or set the bracket does not carry", () => {
    refused(2026, 8, [{ compLevel: "qf", setNumber: 1, matchNumber: 1, winningAllianceNumber: 1, winningTeams: robots(1) }]);
    refused(2026, 8, [sf(14, 1)]);
    refused(2026, 2, [sf(1, 1)]);
  });
  it("a row whose set has a participant the earlier rows do not decide", () => {
    refused(2026, 8, [sf(1, 1), sf(7, 1)]); // sf2 is missing
  });
  it("a row whose winner is not one of its set's two alliances", () => {
    refused(2026, 8, [sf(1, 2)]);
  });
  it("more wins than a set can hold", () => {
    refused(2026, 8, [sf(1, 1), sf(1, 1, robots(1), 2)]);
    refused(2026, 8, [sf(1, 1), sf(1, 8, robots(8), 2)]);
    refused(2026, 8, [...CHALK, final(1, 1), final(2, 1), final(3, 1)]);
    refused(2026, 8, [...CHALK, final(1, 1), final(2, 1), final(3, 2), final(4, 2)]);
  });
  it("a robot whose winning rows name two alliances", () => {
    refused(2026, 8, [sf(1, 1), sf(2, 4, ["a1x", "a4y", "a4z"])]);
  });
});

// ---------------------------------------------------------------------------
// The secured minimum against every completion of the bracket
// ---------------------------------------------------------------------------

/** A small seeded generator (mulberry32), so every run reads the same brackets. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Routed {
  /** The two alliances of every set whose feeds are decided. */
  readonly participants: Map<string, readonly [number, number]>;
  readonly winners: Map<string, number>;
  readonly finalsWins: Map<number, number>;
}

/** Routes rows through `BRACKET_SETS` on its own, sharing no code with the module. */
function route(rows: readonly PlayoffWinRow[]): Routed {
  const winners = new Map<string, number>();
  const losers = new Map<string, number>();
  const participants = new Map<string, readonly [number, number]>();
  const finalsWins = new Map<number, number>();
  const feed = (f: (typeof BRACKET_SETS)[number]["feedA"]): number | undefined => (f.kind === "seed" ? f.seed : (f.kind === "winner" ? winners : losers).get(f.setId));
  for (const set of BRACKET_SETS) {
    const a = feed(set.feedA);
    const b = feed(set.feedB);
    if (a === undefined || b === undefined) continue;
    participants.set(set.id, [a, b]);
    const mine = rows.filter((row) => (set.id === "f" ? row.compLevel === "f" : row.compLevel === "sf" && `sf${String(row.setNumber)}` === set.id));
    if (set.id === "f") {
      for (const row of mine) finalsWins.set(row.winningAllianceNumber, (finalsWins.get(row.winningAllianceNumber) ?? 0) + 1);
      const champion = [a, b].find((n) => (finalsWins.get(n) ?? 0) >= 2);
      if (champion !== undefined) winners.set("f", champion);
      continue;
    }
    if (mine.length === 0) continue;
    const winner = mine[0]!.winningAllianceNumber;
    winners.set(set.id, winner);
    losers.set(set.id, winner === a ? b : a);
  }
  return { participants, winners, finalsWins };
}

/**
 * THE INDEPENDENT ENUMERATION: every way to finish the bracket from `rows`,
 * the robot on the field for no further win, each finished bracket priced by
 * `playoffPointsPaid` alone. Returns the least each robot is paid. The future
 * winning sides are fresh robots, so no robot of `rows` is on the field for a
 * further win.
 */
function leastOverCompletions(season: number, rows: readonly PlayoffWinRow[]): Map<string, number> {
  const least = new Map<string, number>();
  let completions = 0;
  const others = (n: number): string[] => [`f${String(n)}p`, `f${String(n)}q`, `f${String(n)}r`];
  const walk = (current: readonly PlayoffWinRow[]): void => {
    const routed = route(current);
    for (const set of BRACKET_SETS) {
      if (set.id === "f") continue;
      const pair = routed.participants.get(set.id);
      if (pair === undefined || routed.winners.has(set.id)) continue;
      for (const winner of pair) walk([...current, sf(Number(set.id.slice(2)), winner, others(winner))]);
      return;
    }
    const finalists = routed.participants.get("f");
    if (finalists === undefined) throw new Error("the bracket did not reach its final");
    if (!routed.winners.has("f")) {
      const next = current.filter((row) => row.compLevel === "f").length + 1;
      for (const winner of finalists) walk([...current, final(next, winner, others(winner))]);
      return;
    }
    const paid = playoffPointsPaid(season, "district", 8, current);
    if (paid === undefined) throw new Error("a finished bracket was refused");
    completions += 1;
    for (const [robot, value] of paid) least.set(robot, Math.min(least.get(robot) ?? Infinity, value));
  };
  walk(rows);
  if (completions === 0) throw new Error("no completion was enumerated");
  return least;
}

/** A random bracket played to a random depth, with a substitute on some winning sides. */
function randomPrefix(random: () => number): PlayoffWinRow[] {
  const rows: PlayoffWinRow[] = [];
  const depth = Math.floor(random() * 16);
  for (let step = 0; step < depth; step++) {
    const routed = route(rows);
    let placed = false;
    for (const set of BRACKET_SETS) {
      const pair = routed.participants.get(set.id);
      if (pair === undefined || routed.winners.has(set.id)) continue;
      const winner = pair[random() < 0.5 ? 0 : 1];
      // One time in three a fourth robot is in for one of the three.
      const side = robots(winner);
      if (random() < 1 / 3) side[Math.floor(random() * 3)] = `a${String(winner)}b`;
      rows.push(set.id === "f" ? final(rows.filter((row) => row.compLevel === "f").length + 1, winner, side) : sf(Number(set.id.slice(2)), winner, side));
      placed = true;
      break;
    }
    if (!placed) break;
  }
  return rows;
}

describe("the secured minimum is the least over every way the bracket can still go", () => {
  for (const season of [2023, 2026] as const) {
    it(`season ${String(season)}: equal to the independent enumeration, never above the final payment and never lower after another row`, () => {
      const random = seeded(season * 7919);
      let instances = 0;
      let robotsCompared = 0;
      let credited = 0;
      let belowTheHeldPoints = 0;
      for (let trial = 0; trial < 200; trial++) {
        const rows = randomPrefix(random);
        // Deep prefixes only for the enumeration: a bracket with more than nine sets open has too many completions.
        const openSets = 13 - rows.filter((row) => row.compLevel === "sf").length;
        let before = new Map<string, number>();
        for (let k = 0; k <= rows.length; k++) {
          const prefix = rows.slice(0, k);
          const secured = securedPlayoffPoints(season, "district", 8, prefix);
          for (const [robot, was] of before) expect(secured.get(robot) ?? 0, `trial ${String(trial)} prefix ${String(k)} ${robot}`).toBeGreaterThanOrEqual(was);
          before = new Map(secured);
        }
        if (openSets > 9) continue;
        instances += 1;
        const secured = securedPlayoffPoints(season, "district", 8, rows);
        const held = playoffPointsPaid(season, "district", 8, rows)!;
        const least = leastOverCompletions(season, rows);
        for (const [robot, value] of secured) {
          expect(value, `trial ${String(trial)} ${robot}`).toBe(least.get(robot));
          robotsCompared += 1;
          if (value > 0) credited += 1;
          if (value < held.get(robot)!) belowTheHeldPoints += 1;
        }
      }
      console.log(
        `[secured minimum, season ${String(season)}] instances ${String(instances)}, robots compared ${String(robotsCompared)}, credited above 0 ${String(credited)}, below what the rows held ${String(belowTheHeldPoints)}`
      );
      // Since 2024 the least is the alliance winning nothing more, which is what the rows already hold. In 2023 a
      // later win without the robot lowers its share, so the least sits below what the rows hold.
      // Pinned as the run showed (seeded, so every run reads the same brackets).
      expect({ instances, robotsCompared, credited, belowTheHeldPoints }).toEqual(
        season === 2023
          ? { instances: 150, robotsCompared: 2829, credited: 1341, belowTheHeldPoints: 631 }
          : { instances: 146, robotsCompared: 2713, credited: 1335, belowTheHeldPoints: 0 }
      );
    });
  }
});
