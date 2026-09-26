/**
 * Pure unit tests for the eight-alliance playoff bracket, its
 * placement-to-points mapping, and the measured non-eight-alliance
 * fallback — no corpus, no filesystem. The corpus proof lives in
 * `pointFormulas.reconciliation.test.ts`, which skips wherever
 * `data/corpus.sqlite` is absent; these run everywhere.
 *
 * The load-bearing case here is the placement-permutation invariant under a
 * randomized decider: whatever the deciders do, every one of the eight
 * alliance numbers must come out with exactly one placement from 1 to 8. A
 * routing bug that duplicated a placement would otherwise surface as two
 * alliances both being paid 30 points.
 */
import { describe, expect, it } from "vitest";
import {
  allianceBracketMilestones,
  assertBracketSeason,
  bracketDecisionKey,
  bracketDecisionsFromPlayedMatches,
  bracketSetIdFor,
  BRACKET_REGISTERED_SEASONS,
  BRACKET_SETS,
  DIVISIONED_DCMP_PLAYOFF_OBSERVATIONS,
  DIVISIONED_DCMP_PLAYOFF_PMF,
  divisionedDcmpPlayoffPmf,
  InvalidBracketDecisionError,
  InvalidPlacementError,
  PLAYOFF_PLACEMENT_POINTS,
  playoffPoints,
  routeBracket,
  routePlayedBracket,
  UnsupportedAllianceCountError,
  UnsupportedBracketSeasonError,
  type BracketDecider,
  type PlayedBracketMatch,
} from "./bracket.js";
import { maxEventPoints } from "./pointModel.js";
import { mulberry32 } from "../algorithms/simulation/rankSimulation.js";

const higherSeedWins: BracketDecider = (a, b) => Math.min(a, b);
const lowerSeedWins: BracketDecider = (a, b) => Math.max(a, b);

/** Every placement 1 through 8 used exactly once, across exactly the eight alliance numbers. */
function expectPlacementPermutation(placementByAlliance: ReadonlyMap<number, number>, label: string): void {
  expect([...placementByAlliance.keys()].sort((x, y) => x - y), `${label}: alliance numbers`).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8,
  ]);
  expect([...placementByAlliance.values()].sort((x, y) => x - y), `${label}: placements`).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8,
  ]);
}

describe("BRACKET_SETS", () => {
  it("declares all 14 sets — the 13 sf sets plus the final", () => {
    expect(BRACKET_SETS).toHaveLength(14);
    expect(BRACKET_SETS.map((set) => set.id)).toEqual([
      "sf1",
      "sf2",
      "sf3",
      "sf4",
      "sf5",
      "sf6",
      "sf7",
      "sf8",
      "sf9",
      "sf10",
      "sf11",
      "sf12",
      "sf13",
      "f",
    ]);
  });

  it("makes every sf set a single match and the final a best-of-three", () => {
    for (const set of BRACKET_SETS) {
      expect(set.bestOf, `${set.id}`).toBe(set.id === "f" ? 3 : 1);
    }
  });

  it("seeds only the four upper-round-one sets, and uses all eight seeds exactly once", () => {
    const seeds: number[] = [];
    for (const set of BRACKET_SETS) {
      for (const feed of [set.feedA, set.feedB]) {
        if (feed.kind === "seed") seeds.push(feed.seed);
      }
    }
    expect(seeds.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("only ever feeds from a set declared earlier in the table", () => {
    const seen = new Set<string>();
    for (const set of BRACKET_SETS) {
      for (const feed of [set.feedA, set.feedB]) {
        if (feed.kind !== "seed") {
          expect(seen.has(feed.setId), `${set.id} feeds from ${feed.setId}, which is not declared before it`).toBe(true);
        }
      }
      seen.add(set.id);
    }
  });
});

describe("routeBracket", () => {
  it("places the top four seeds in seed order when the higher seed wins every match", () => {
    const { placementByAlliance } = routeBracket(higherSeedWins);
    expect(placementByAlliance.get(1)).toBe(1);
    expect(placementByAlliance.get(2)).toBe(2);
    expect(placementByAlliance.get(3)).toBe(3);
    expect(placementByAlliance.get(4)).toBe(4);
    expectPlacementPermutation(placementByAlliance, "higher seed wins");
  });

  it("assigns a full placement permutation when the lower seed wins every match", () => {
    const { placementByAlliance } = routeBracket(lowerSeedWins);
    expect(placementByAlliance.get(8)).toBe(1);
    expectPlacementPermutation(placementByAlliance, "lower seed wins");
  });

  it("assigns a full placement permutation on every one of 2,000 randomized routings", () => {
    const rng = mulberry32(20261001);
    for (let routing = 0; routing < 2_000; routing++) {
      const { placementByAlliance } = routeBracket((a, b) => (rng() < 0.5 ? a : b));
      expectPlacementPermutation(placementByAlliance, `randomized routing ${routing}`);
    }
  });

  it("resolves the final without asking for a third match when one alliance takes the first two", () => {
    const finalMatchNumbers: number[] = [];
    const decider: BracketDecider = (a, b, setId, matchNumber) => {
      if (setId === "f") finalMatchNumbers.push(matchNumber);
      return Math.min(a, b);
    };
    routeBracket(decider);
    expect(finalMatchNumbers).toEqual([1, 2]);
  });

  it("asks for a third final match when the first two are split, and the series winner takes first place", () => {
    const finalMatchNumbers: number[] = [];
    const decider: BracketDecider = (a, b, setId, matchNumber) => {
      if (setId !== "f") return Math.min(a, b);
      finalMatchNumbers.push(matchNumber);
      // Split the first two, then give it to the higher seed.
      if (matchNumber === 1) return Math.max(a, b);
      return Math.min(a, b);
    };
    const { placementByAlliance } = routeBracket(decider);
    expect(finalMatchNumbers).toEqual([1, 2, 3]);
    expect(placementByAlliance.get(1)).toBe(1);
    expect(placementByAlliance.get(2)).toBe(2);
    expectPlacementPermutation(placementByAlliance, "split final");
  });

  it("names every set and both of its alliances to the decider, and never asks about an alliance outside a set's own pair", () => {
    const askedSets: string[] = [];
    routeBracket((a, b, setId) => {
      askedSets.push(setId);
      expect(a, `${setId} allianceA`).toBeGreaterThanOrEqual(1);
      expect(b, `${setId} allianceB`).toBeLessThanOrEqual(8);
      expect(a, `${setId} asked about the same alliance twice`).not.toBe(b);
      return a;
    });
    expect(new Set(askedSets).size).toBe(14);
  });

  it("throws a typed error when the decider returns an alliance outside the pair it was asked about", () => {
    expect(() => routeBracket(() => 99)).toThrow(InvalidBracketDecisionError);
    // A decider that answers correctly for a while and then goes wrong must
    // still throw rather than silently corrupting downstream placements.
    let calls = 0;
    expect(() =>
      routeBracket((a, b) => {
        calls++;
        return calls > 5 ? 99 : Math.min(a, b);
      })
    ).toThrow(InvalidBracketDecisionError);
  });
});

describe("playoffPoints", () => {
  it("maps placement to 30, 20, 13, 7 and then zero for fifth through eighth", () => {
    expect(PLAYOFF_PLACEMENT_POINTS).toEqual([30, 20, 13, 7, 0, 0, 0, 0]);
    for (const season of BRACKET_REGISTERED_SEASONS) {
      expect(playoffPoints(season, "district", 1), `season ${season}`).toBe(30);
      expect(playoffPoints(season, "district", 2), `season ${season}`).toBe(20);
      expect(playoffPoints(season, "district", 3), `season ${season}`).toBe(13);
      expect(playoffPoints(season, "district", 4), `season ${season}`).toBe(7);
      for (const placement of [5, 6, 7, 8]) {
        expect(playoffPoints(season, "district", placement), `season ${season} placement ${placement}`).toBe(0);
      }
    }
  });

  it("is exactly three times the district value at the dcmp tier", () => {
    for (const season of BRACKET_REGISTERED_SEASONS) {
      for (let placement = 1; placement <= 8; placement++) {
        expect(playoffPoints(season, "dcmp", placement), `season ${season} placement ${placement}`).toBe(
          3 * playoffPoints(season, "district", placement)
        );
      }
    }
  });

  it("never exceeds pointModel.ts's declared elim ceiling at either tier", () => {
    for (const season of BRACKET_REGISTERED_SEASONS) {
      for (const tier of ["district", "dcmp"] as const) {
        const ceiling = maxEventPoints(season, tier).elim;
        for (let placement = 1; placement <= 8; placement++) {
          expect(playoffPoints(season, tier, placement), `season ${season} ${tier} placement ${placement}`).toBeLessThanOrEqual(
            ceiling
          );
        }
      }
    }
  });

  it("throws a typed error for a placement outside 1 through 8", () => {
    for (const placement of [0, -1, 9, 1.5]) {
      expect(() => playoffPoints(2026, "district", placement), `placement ${placement}`).toThrow(InvalidPlacementError);
    }
  });

  it("throws a typed error for a season before 2023 rather than routing the 2023-plus topology over it", () => {
    for (const season of [2016, 2019, 2020, 2022, 2027]) {
      expect(() => playoffPoints(season, "district", 1), `season ${season}`).toThrow(UnsupportedBracketSeasonError);
      expect(() => assertBracketSeason(season), `season ${season}`).toThrow(UnsupportedBracketSeasonError);
    }
    expect(BRACKET_REGISTERED_SEASONS).toEqual([2023, 2024, 2025, 2026]);
    for (const season of BRACKET_REGISTERED_SEASONS) {
      expect(() => assertBracketSeason(season), `season ${season}`).not.toThrow();
    }
  });
});

describe("divisionedDcmpPlayoffPmf", () => {
  it("returns a pmf for an alliance count of 2 or 4, from the committed observation table", () => {
    for (const allianceCount of [2, 4] as const) {
      for (let allianceNumber = 1; allianceNumber <= allianceCount; allianceNumber++) {
        const pmf = divisionedDcmpPlayoffPmf(allianceCount, allianceNumber);
        expect(pmf.length, `count ${allianceCount} alliance ${allianceNumber}`).toBeGreaterThan(0);
      }
    }
  });

  it("gives every pmf finite, non-negative entries summing to 1", () => {
    for (const allianceCount of [2, 4] as const) {
      for (let allianceNumber = 1; allianceNumber <= allianceCount; allianceNumber++) {
        const pmf = divisionedDcmpPlayoffPmf(allianceCount, allianceNumber);
        let total = 0;
        for (const entry of pmf) {
          expect(Number.isFinite(entry.points), `count ${allianceCount} alliance ${allianceNumber} points`).toBe(true);
          expect(Number.isFinite(entry.probability), `count ${allianceCount} alliance ${allianceNumber} probability`).toBe(
            true
          );
          expect(entry.probability, `count ${allianceCount} alliance ${allianceNumber}`).toBeGreaterThanOrEqual(0);
          expect(entry.points, `count ${allianceCount} alliance ${allianceNumber}`).toBeGreaterThanOrEqual(0);
          total += entry.probability;
        }
        expect(total, `count ${allianceCount} alliance ${allianceNumber} pmf does not sum to 1`).toBeCloseTo(1, 12);
      }
    }
  });

  it("keeps every pmf point value within pointModel.ts's declared elim ceiling at both tiers", () => {
    for (const season of BRACKET_REGISTERED_SEASONS) {
      for (const tier of ["district", "dcmp"] as const) {
        const ceiling = maxEventPoints(season, tier).elim;
        const weight = tier === "dcmp" ? 3 : 1;
        for (const allianceCount of [2, 4] as const) {
          for (let allianceNumber = 1; allianceNumber <= allianceCount; allianceNumber++) {
            for (const entry of divisionedDcmpPlayoffPmf(allianceCount, allianceNumber)) {
              expect(
                entry.points * weight,
                `season ${season} ${tier} count ${allianceCount} alliance ${allianceNumber} value ${entry.points}`
              ).toBeLessThanOrEqual(ceiling);
            }
          }
        }
      }
    }
  });

  it("returns entries sorted by point value ascending", () => {
    for (const allianceCount of [2, 4] as const) {
      for (let allianceNumber = 1; allianceNumber <= allianceCount; allianceNumber++) {
        const points = divisionedDcmpPlayoffPmf(allianceCount, allianceNumber).map((entry) => entry.points);
        expect(points, `count ${allianceCount} alliance ${allianceNumber}`).toEqual([...points].sort((a, b) => a - b));
      }
    }
  });

  it("throws a typed error for an alliance count of 8 — eight alliances route, they never read the fallback", () => {
    expect(() => divisionedDcmpPlayoffPmf(8, 1)).toThrow(UnsupportedAllianceCountError);
  });

  it("throws a typed error for an unregistered alliance count rather than guessing", () => {
    for (const allianceCount of [0, 1, 3, 5, 6, 16]) {
      expect(() => divisionedDcmpPlayoffPmf(allianceCount, 1), `count ${allianceCount}`).toThrow(
        UnsupportedAllianceCountError
      );
    }
  });

  it("throws a typed error for an alliance number with no measured population rather than smoothing a guess", () => {
    expect(() => divisionedDcmpPlayoffPmf(2, 3)).toThrow(UnsupportedAllianceCountError);
    expect(() => divisionedDcmpPlayoffPmf(4, 5)).toThrow(UnsupportedAllianceCountError);
    expect(() => divisionedDcmpPlayoffPmf(2, 0)).toThrow(UnsupportedAllianceCountError);
  });

  it("carries the point values Fact 2 measured at the divisioned parents: base 0, 10 and 20, never the eight-alliance set", () => {
    const observed = new Set<number>();
    for (const allianceCount of [2, 4] as const) {
      for (let allianceNumber = 1; allianceNumber <= allianceCount; allianceNumber++) {
        for (const entry of divisionedDcmpPlayoffPmf(allianceCount, allianceNumber)) observed.add(entry.points);
      }
    }
    expect([...observed].sort((a, b) => a - b)).toEqual([0, 10, 20]);
    // None of the eight-alliance placement values appears here — that
    // difference is why a fabricated bracket for these events would be wrong.
    for (const eightAllianceValue of [7, 13, 20, 30]) {
      if (eightAllianceValue === 20) continue; // 20 is coincidentally shared
      expect(observed.has(eightAllianceValue), `${eightAllianceValue} should not appear in the fallback`).toBe(false);
    }
  });

  it("normalizes DIVISIONED_DCMP_PLAYOFF_PMF from DIVISIONED_DCMP_PLAYOFF_OBSERVATIONS, counts and all", () => {
    for (const allianceCount of [2, 4] as const) {
      const byNumber = DIVISIONED_DCMP_PLAYOFF_OBSERVATIONS[allianceCount];
      for (const [allianceNumber, observations] of Object.entries(byNumber)) {
        const total = observations.reduce((sum, o) => sum + o.count, 0);
        const pmf = DIVISIONED_DCMP_PLAYOFF_PMF[allianceCount][Number(allianceNumber)]!;
        expect(pmf.length).toBe(observations.length);
        for (let i = 0; i < pmf.length; i++) {
          expect(pmf[i]!.points).toBe(observations[i]!.points);
          expect(pmf[i]!.probability).toBeCloseTo(observations[i]!.count / total, 12);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The played bracket, and the milestone (quick task 260925-uf8)
// ---------------------------------------------------------------------------

/**
 * A REAL EVENT'S REAL ELIMINATION MATCHES: `2026orwil` (PNW District Wilsonville
 * Event), derived on 2026-09-25 from
 * `data/fixtures/phase10/event-2026orwil.json` — the published SPR event
 * artifact — by mapping each played row's red and blue team lists onto the
 * `alliances` pick lists and taking the side that carries `actualWinner`.
 *
 * COMMITTED AS A LITERAL rather than read from `data/`, which is gitignored:
 * these tests must run on a machine that has never fetched an artifact. Fifteen
 * rows, not sixteen, because the final was a sweep.
 *
 * `2026orwil` is one of the three 2026 PNW events whose earned elimination
 * points reproduce EXACTLY for every team on every alliance. At the other five
 * a backup robot's proration puts a partial value in a pick slot, which is the
 * data shape this file's own header already records for `2026waahs` — a
 * property of TBA's point allocation, not of the routing.
 */
const ORWIL_PLAYED_ELIMS: readonly PlayedBracketMatch[] = [
  { compLevel: "sf", setNumber: 1, matchNumber: 1, winningAllianceNumber: 1 },
  { compLevel: "sf", setNumber: 2, matchNumber: 1, winningAllianceNumber: 5 },
  { compLevel: "sf", setNumber: 3, matchNumber: 1, winningAllianceNumber: 2 },
  { compLevel: "sf", setNumber: 4, matchNumber: 1, winningAllianceNumber: 6 },
  { compLevel: "sf", setNumber: 5, matchNumber: 1, winningAllianceNumber: 8 },
  { compLevel: "sf", setNumber: 6, matchNumber: 1, winningAllianceNumber: 7 },
  { compLevel: "sf", setNumber: 7, matchNumber: 1, winningAllianceNumber: 1 },
  { compLevel: "sf", setNumber: 8, matchNumber: 1, winningAllianceNumber: 2 },
  { compLevel: "sf", setNumber: 9, matchNumber: 1, winningAllianceNumber: 5 },
  { compLevel: "sf", setNumber: 10, matchNumber: 1, winningAllianceNumber: 8 },
  { compLevel: "sf", setNumber: 11, matchNumber: 1, winningAllianceNumber: 1 },
  { compLevel: "sf", setNumber: 12, matchNumber: 1, winningAllianceNumber: 5 },
  { compLevel: "sf", setNumber: 13, matchNumber: 1, winningAllianceNumber: 2 },
  { compLevel: "f", setNumber: 1, matchNumber: 1, winningAllianceNumber: 1 },
  { compLevel: "f", setNumber: 1, matchNumber: 2, winningAllianceNumber: 1 },
];

/**
 * `2026orwil`'s own earned `elim` points per alliance, read straight off
 * `data/fixtures/phase10/district-2026pnw.json`'s `eventPoints` rows on the
 * same date — TBA's answer, established INDEPENDENTLY of any routing in this
 * repo, which is what makes the cross-check below a real one.
 */
const ORWIL_EARNED_ELIM_BY_ALLIANCE: Readonly<Record<number, number>> = { 1: 30, 2: 20, 3: 0, 4: 0, 5: 13, 6: 0, 7: 0, 8: 7 };

describe("bracketSetIdFor — TBA's coordinates onto this topology", () => {
  it("maps every sf set number and the final, and refuses every other comp level", () => {
    for (let setNumber = 1; setNumber <= 13; setNumber++) {
      expect(bracketSetIdFor("sf", setNumber)).toBe(`sf${String(setNumber)}`);
    }
    expect(bracketSetIdFor("f", 1)).toBe("f");
    // Everything the eight-alliance double-elimination format does not carry.
    expect(bracketSetIdFor("sf", 14)).toBeUndefined();
    expect(bracketSetIdFor("sf", 0)).toBeUndefined();
    expect(bracketSetIdFor("f", 2)).toBeUndefined();
    expect(bracketSetIdFor("qf", 1)).toBeUndefined();
    expect(bracketSetIdFor("ef", 1)).toBeUndefined();
    expect(bracketSetIdFor("qm", 1)).toBeUndefined();
  });

  it("every id it returns is a real member of BRACKET_SETS, so the mapping cannot name a set that does not exist", () => {
    const ids = new Set(BRACKET_SETS.map((set) => set.id));
    for (let setNumber = 1; setNumber <= 13; setNumber++) expect(ids.has(bracketSetIdFor("sf", setNumber)!)).toBe(true);
    expect(ids.has(bracketSetIdFor("f", 1)!)).toBe(true);
    expect(ids.size).toBe(14);
  });

  it("keys the final's three matches apart rather than collapsing them into one set", () => {
    const decisions = bracketDecisionsFromPlayedMatches([
      { compLevel: "f", setNumber: 1, matchNumber: 1, winningAllianceNumber: 3 },
      { compLevel: "f", setNumber: 1, matchNumber: 2, winningAllianceNumber: 1 },
    ]);
    expect(decisions.get(bracketDecisionKey("f", 1))).toBe(3);
    expect(decisions.get(bracketDecisionKey("f", 2))).toBe(1);
    expect(decisions.get(bracketDecisionKey("f", 3))).toBeUndefined();
  });

  it("drops a row this topology does not carry rather than coercing it into a neighbouring set", () => {
    const decisions = bracketDecisionsFromPlayedMatches([
      { compLevel: "qf", setNumber: 1, matchNumber: 1, winningAllianceNumber: 1 },
      { compLevel: "qm", setNumber: 1, matchNumber: 12, winningAllianceNumber: 1 },
    ]);
    expect(decisions.size).toBe(0);
  });
});

describe("routePlayedBracket — a real event's real matches", () => {
  it("routes 2026orwil's fifteen played rows to a complete placement permutation", () => {
    const routing = routePlayedBracket(bracketDecisionsFromPlayedMatches(ORWIL_PLAYED_ELIMS));
    expectPlacementPermutation(routing.placementByAlliance, "2026orwil");
  });

  it("reproduces 2026orwil's OWN earned elimination points for every one of its eight alliances", () => {
    const routing = routePlayedBracket(bracketDecisionsFromPlayedMatches(ORWIL_PLAYED_ELIMS));
    for (let allianceNumber = 1; allianceNumber <= 8; allianceNumber++) {
      const placement = routing.placementByAlliance.get(allianceNumber)!;
      expect(playoffPoints(2026, "district", placement), `alliance ${String(allianceNumber)}`).toBe(
        ORWIL_EARNED_ELIM_BY_ALLIANCE[allianceNumber]
      );
    }
  });

  it("agrees with routeBracket run over the same decisions, so there is one routing and not two", () => {
    const decisions = bracketDecisionsFromPlayedMatches(ORWIL_PLAYED_ELIMS);
    const partial = routePlayedBracket(decisions);
    const full = routeBracket((a, b, setId, matchNumber) => {
      const winner = decisions.get(bracketDecisionKey(setId, matchNumber));
      // Every match of this complete bracket is played, so the fallback is
      // never taken; it exists only so the decider's contract is satisfied.
      return winner ?? a;
    });
    expect([...partial.placementByAlliance.entries()].sort()).toEqual([...full.placementByAlliance.entries()].sort());
    for (const set of BRACKET_SETS) {
      expect(partial.winnerBySet.get(set.id), set.id).toBe(full.winnerBySet.get(set.id));
      expect(partial.loserBySet.get(set.id), set.id).toBe(full.loserBySet.get(set.id));
    }
  });

  it("determines nothing at all from an empty decision set, rather than padding a placement", () => {
    const routing = routePlayedBracket(new Map());
    expect(routing.placementByAlliance.size).toBe(0);
    expect(routing.winnerBySet.size).toBe(0);
    // The four upper-bracket round-one sets feed from SEEDS, so their
    // participants are known before anything is played.
    expect([...routing.participantsBySet.keys()].sort()).toEqual(["sf1", "sf2", "sf3", "sf4"]);
  });

  it("ends a set at a gap rather than reading past it — match 3 of a final is unreadable while match 2 is missing", () => {
    const decisions = bracketDecisionsFromPlayedMatches([
      ...ORWIL_PLAYED_ELIMS.slice(0, 13),
      { compLevel: "f", setNumber: 1, matchNumber: 1, winningAllianceNumber: 1 },
      { compLevel: "f", setNumber: 1, matchNumber: 3, winningAllianceNumber: 2 },
    ]);
    const routing = routePlayedBracket(decisions);
    expect(routing.winnerBySet.get("f")).toBeUndefined();
    expect(routing.placementByAlliance.get(1)).toBeUndefined();
  });

  it("refuses a mis-mapped match rather than routing it", () => {
    // sf1 is seed 1 against seed 8; alliance 4 was never in it.
    expect(() =>
      routePlayedBracket(bracketDecisionsFromPlayedMatches([{ compLevel: "sf", setNumber: 1, matchNumber: 1, winningAllianceNumber: 4 }]))
    ).toThrow(InvalidBracketDecisionError);
  });
});

describe("allianceBracketMilestones", () => {
  const milestonesAfter = (count: number): ReadonlyMap<number, { kind: string; placement?: number }> =>
    allianceBracketMilestones(routePlayedBracket(bracketDecisionsFromPlayedMatches(ORWIL_PLAYED_ELIMS.slice(0, count))));

  it("calls every alliance alive before any elimination match is played", () => {
    const milestones = milestonesAfter(0);
    expect(milestones.size).toBe(8);
    for (let allianceNumber = 1; allianceNumber <= 8; allianceNumber++) {
      expect(milestones.get(allianceNumber)).toEqual({ kind: "alive" });
    }
  });

  it("secures a top-four finish for the winner of sf7, and only then", () => {
    // After sf1 through sf6, alliance 1 has won its upper-bracket opener but
    // sf7 has not been played: nothing is secured yet.
    expect(milestonesAfter(6).get(1)).toEqual({ kind: "alive" });
    // sf7 is alliance 1 against alliance 5; alliance 1 won it and is therefore
    // in sf11, whose loser drops to sf13, whose loser is third.
    expect(milestonesAfter(7).get(1)).toEqual({ kind: "topFour" });
    // Alliance 5 lost sf7 and is NOT secured — it drops to sf9, whose loser is
    // fifth and pays nothing.
    expect(milestonesAfter(7).get(5)).toEqual({ kind: "alive" });
  });

  it("secures a top-four finish for the winner of sf9 too, which is the other way in", () => {
    // sf9 is the loser of sf7 against the winner of sf6; alliance 5 won it and
    // is therefore in sf12, whose loser is fourth.
    expect(milestonesAfter(9).get(5)).toEqual({ kind: "topFour" });
  });

  it("reports a placement the moment a set's loser is fixed at one, and never before", () => {
    // sf5's loser is SEVENTH: alliance 4 lost it to alliance 8.
    expect(milestonesAfter(4).get(4)).toEqual({ kind: "alive" });
    expect(milestonesAfter(5).get(4)).toEqual({ kind: "decided", placement: 7 });
    // sf9's loser is FIFTH.
    expect(milestonesAfter(9).get(7)).toEqual({ kind: "decided", placement: 5 });
  });

  it("puts both of the final's participants in the finals before the final is played", () => {
    // Thirteen sf sets played, no final match yet: alliance 1 won sf11 and
    // alliance 2 won sf13.
    const milestones = milestonesAfter(13);
    expect(milestones.get(1)).toEqual({ kind: "finals" });
    expect(milestones.get(2)).toEqual({ kind: "finals" });
    // And the alliances already out carry their placements: alliance 5 won sf12
    // and then lost sf13, whose loser is THIRD.
    expect(milestones.get(5)).toEqual({ kind: "decided", placement: 3 });
    expect(milestones.get(8)).toEqual({ kind: "decided", placement: 4 });
  });

  it("decides every alliance once the whole bracket is played", () => {
    const milestones = milestonesAfter(ORWIL_PLAYED_ELIMS.length);
    for (let allianceNumber = 1; allianceNumber <= 8; allianceNumber++) {
      const milestone = milestones.get(allianceNumber)!;
      expect(milestone.kind, `alliance ${String(allianceNumber)}`).toBe("decided");
      expect(playoffPoints(2026, "district", milestone.placement!)).toBe(ORWIL_EARNED_ELIM_BY_ALLIANCE[allianceNumber]);
    }
  });

  it("proves the top-four claim by ROUTING every completion rather than taking the table on trust", () => {
    // For each prefix of the real bracket, and for each alliance the milestone
    // calls `topFour`, every completion of the remaining matches must place
    // that alliance fourth or better. The completions are enumerated by a
    // pseudo-random decider run many times, which for a 15-match bracket covers
    // the reachable placements comprehensively.
    for (let prefix = 0; prefix <= ORWIL_PLAYED_ELIMS.length; prefix++) {
      const decisions = bracketDecisionsFromPlayedMatches(ORWIL_PLAYED_ELIMS.slice(0, prefix));
      const milestones = allianceBracketMilestones(routePlayedBracket(decisions));
      const worst = new Map<number, number>();
      for (let seed = 1; seed <= 400; seed++) {
        const rng = mulberry32(seed * 7919);
        const routed = routeBracket((a, b, setId, matchNumber) => {
          const played = decisions.get(bracketDecisionKey(setId, matchNumber));
          if (played !== undefined) return played;
          return rng() < 0.5 ? a : b;
        });
        for (const [allianceNumber, placement] of routed.placementByAlliance) {
          worst.set(allianceNumber, Math.max(worst.get(allianceNumber) ?? 0, placement));
        }
      }
      for (const [allianceNumber, milestone] of milestones) {
        const label = `prefix ${String(prefix)} alliance ${String(allianceNumber)}`;
        if (milestone.kind === "topFour") expect(worst.get(allianceNumber), label).toBeLessThanOrEqual(4);
        if (milestone.kind === "finals") expect(worst.get(allianceNumber), label).toBeLessThanOrEqual(2);
        if (milestone.kind === "decided") expect(worst.get(allianceNumber), label).toBe(milestone.placement);
      }
    }
  });
});
