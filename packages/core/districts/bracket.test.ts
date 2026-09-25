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
  assertBracketSeason,
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
  UnsupportedAllianceCountError,
  UnsupportedBracketSeasonError,
  type BracketDecider,
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
