/**
 * The joint district ledger simulation's pure unit tests — synthetic fixtures
 * only, no corpus, so CI executes every one of them. The corpus-guarded
 * reconciliation of the draft rule lives in
 * `selectionModel.reconciliation.test.ts` and SKIPS wherever the corpus is
 * absent, which makes this file load-bearing rather than a formality.
 *
 * Fixtures are small enough that every expectation below is hand-derivable:
 * baseline average ranking points strictly decreasing by team number, so the
 * finishing order is known with zero remaining matches, and published SPR
 * means that are a deliberate PERMUTATION of that order, so a draft that
 * accidentally picked by rank would fail on a named slot.
 */
import { describe, expect, it } from "vitest";
import {
  mulberry32,
  simulateRanks,
  type SimMatchInput,
  type SimTeamBaseline,
} from "../algorithms/simulation/rankSimulation.js";
import { AWARD_POINT_SUPPORT, awardBaseRate } from "./awardBaseRates.js";
import { BRACKET_SETS, UnsupportedAllianceCountError } from "./bracket.js";
import {
  AlliancePricingError,
  decideBracketMatch,
  InsufficientRosterError,
  InvalidFieldSizeError,
  MissingAwardProfileError,
  simulateDistrictEvent,
  UnratedTeamError,
  type DistrictAwardProfile,
  type DistrictDrawObservation,
  type DistrictLedgerEventInput,
} from "./ledgerSimulation.js";
import { maxEventPoints } from "./pointModel.js";
import { UnknownDistrictSeasonError } from "./pointModel.js";
import { districtQualPoints } from "./qualPoints.js";
import { districtSelectionPoints } from "./selectionPoints.js";
import type { AllianceMemberRating } from "../algorithms/simulation/allianceWinProbability.js";

const SEASON = 2026;
const TIER = "district" as const;

function teamKey(n: number): string {
  return `frc${100 + n}`;
}

/** Baselines with strictly decreasing average ranking points, so team 1 ranks first with zero remaining matches. */
function baselinesFor(teamCount: number): SimTeamBaseline[] {
  const out: SimTeamBaseline[] = [];
  for (let i = 1; i <= teamCount; i++) {
    out.push({ teamKey: teamKey(i), earnedRpSum: (teamCount + 1 - i) * 10, matchesPlayed: 10 });
  }
  return out;
}

/**
 * Published SPR means that are a PERMUTATION of the ranking order (`i * 7 mod
 * teamCount`, a bijection whenever 7 is coprime with the count), so the
 * greedy-by-SPR draft cannot coincide with a rank-ordered one.
 */
function permutedRatings(teamCount: number): Map<string, AllianceMemberRating> {
  const out = new Map<string, AllianceMemberRating>();
  for (let i = 1; i <= teamCount; i++) {
    out.set(teamKey(i), { teamKey: teamKey(i), total: ((i * 7) % teamCount) + 1, sigma: 3 });
  }
  return out;
}

/** Ratings that fall monotonically with rank, with a tiny spread, so every bracket match is effectively decided. */
function rankAlignedRatings(teamCount: number): Map<string, AllianceMemberRating> {
  const out = new Map<string, AllianceMemberRating>();
  for (let i = 1; i <= teamCount; i++) {
    out.set(teamKey(i), { teamKey: teamKey(i), total: (teamCount + 1 - i) * 100, sigma: 0.01 });
  }
  return out;
}

function profilesFor(teamCount: number): Map<string, DistrictAwardProfile> {
  const out = new Map<string, DistrictAwardProfile>();
  for (let i = 1; i <= teamCount; i++) {
    out.set(teamKey(i), { bucket: "none", rookieState: "veteran" });
  }
  return out;
}

/** A handful of remaining matches over the first twelve teams, each a three-entry RP pmf. */
function remainingMatches(): SimMatchInput[] {
  const pmf = [0.25, 0.35, 0.4];
  const out: SimMatchInput[] = [];
  for (let m = 0; m < 6; m++) {
    const base = m * 2;
    out.push({
      redTeamKeys: [teamKey(base + 1), teamKey(base + 2), teamKey(base + 3)],
      blueTeamKeys: [teamKey(base + 4), teamKey(base + 5), teamKey(base + 6)],
      redRpPmf: pmf,
      blueRpPmf: pmf,
    });
  }
  return out;
}

function inputFor(
  teamCount: number,
  overrides: Partial<DistrictLedgerEventInput> = {}
): DistrictLedgerEventInput {
  return {
    eventKey: "2026zztest",
    season: SEASON,
    tier: TIER,
    fieldSize: teamCount,
    allianceCount: 8,
    remainingMatches: remainingMatches(),
    baselines: baselinesFor(teamCount),
    ratings: permutedRatings(teamCount),
    awardProfiles: profilesFor(teamCount),
    ...overrides,
  };
}

/** Copies one observation deeply, since every array on it is a reused internal buffer. */
function snapshot(observation: DistrictDrawObservation): {
  order: number[];
  alliances: string[][];
  qual: number[];
  selection: number[];
  elim: number[];
  award: number[];
  total: number[];
  bracketSetIds: string[];
  ledgerDraws: number;
} {
  return {
    order: [...observation.order],
    alliances: observation.alliances.map((roster) => [...roster]),
    qual: [...observation.qual],
    selection: [...observation.selection],
    elim: [...observation.elim],
    award: [...observation.award],
    total: [...observation.total],
    bracketSetIds: [...observation.bracketSetIds],
    ledgerDraws: observation.ledgerDraws,
  };
}

// ---------------------------------------------------------------------------
// THE CORRELATION PROOF — the load-bearing test
// ---------------------------------------------------------------------------

describe("simulateDistrictEvent — the correlation proof, asserted PER DRAW", () => {
  it("in EVERY draw the team the ranking placed first is alliance 1's captain, and no unallied team outranks any captain", () => {
    const teamCount = 30;
    const input = inputFor(teamCount);
    const draws = 2_000;
    let checked = 0;
    let firstSeedViolations = 0;
    let progressiveViolations = 0;

    simulateDistrictEvent(input, draws, 20260925, (observation) => {
      checked++;
      const rankByTeamIndex = new Array<number>(teamCount);
      for (let rank = 0; rank < teamCount; rank++) rankByTeamIndex[observation.order[rank]!] = rank + 1;

      const topSeedKey = input.baselines[observation.order[0]!]!.teamKey;
      if (observation.alliances[0]![0] !== topSeedKey) firstSeedViolations++;

      const captainRanks: number[] = [];
      const alliedKeys = new Set<string>();
      for (const roster of observation.alliances) {
        for (const key of roster) alliedKeys.add(key);
        captainRanks.push(rankByTeamIndex[input.baselines.findIndex((b) => b.teamKey === roster[0])]!);
      }
      const worstCaptainRank = Math.max(...captainRanks);
      for (let i = 0; i < teamCount; i++) {
        if (alliedKeys.has(input.baselines[i]!.teamKey)) continue;
        if (rankByTeamIndex[i]! < worstCaptainRank) progressiveViolations++;
      }
    });

    expect(checked).toBe(draws);
    expect(firstSeedViolations).toBe(0);
    expect(progressiveViolations).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// THE NON-PERTURBATION PIN
// ---------------------------------------------------------------------------

describe("simulateDistrictEvent — the joint run perturbs the ranking not at all", () => {
  it("the qualification marginal is entry-for-entry identical to a bare four-argument simulateRanks run pushed through districtQualPoints, under the same seed", () => {
    const teamCount = 30;
    const input = inputFor(teamCount);
    const draws = 500;
    const seed = 777;

    const joint = simulateDistrictEvent(input, draws, seed);

    const bare = simulateRanks(input.remainingMatches, input.baselines, draws, mulberry32(seed));
    const qualLength = maxEventPoints(SEASON, TIER).qual + 1;
    for (const baseline of input.baselines) {
      const expected = new Int32Array(qualLength);
      const rankHistogram = bare.rankHistograms.get(baseline.teamKey)!;
      for (let rankIndex = 0; rankIndex < rankHistogram.length; rankIndex++) {
        const count = rankHistogram[rankIndex]!;
        if (count === 0) continue;
        expected[districtQualPoints(SEASON, TIER, rankIndex + 1, input.fieldSize)]! += count;
      }
      expect(Array.from(joint.qualPoints.get(baseline.teamKey)!)).toEqual(Array.from(expected));
    }
  });
});

// ---------------------------------------------------------------------------
// Determinism and structured-clone safety
// ---------------------------------------------------------------------------

describe("simulateDistrictEvent — determinism and the structured-clone contract", () => {
  const input = inputFor(30);

  it("two runs at the same seed produce byte-identical histograms for all five categories", () => {
    const a = simulateDistrictEvent(input, 300, 4242);
    const b = simulateDistrictEvent(input, 300, 4242);
    for (const baseline of input.baselines) {
      expect(Array.from(a.qualPoints.get(baseline.teamKey)!)).toEqual(Array.from(b.qualPoints.get(baseline.teamKey)!));
      expect(Array.from(a.selectionPoints.get(baseline.teamKey)!)).toEqual(Array.from(b.selectionPoints.get(baseline.teamKey)!));
      expect(Array.from(a.elimPoints.get(baseline.teamKey)!)).toEqual(Array.from(b.elimPoints.get(baseline.teamKey)!));
      expect(Array.from(a.awardPoints.get(baseline.teamKey)!)).toEqual(Array.from(b.awardPoints.get(baseline.teamKey)!));
      expect(Array.from(a.eventTotal.get(baseline.teamKey)!)).toEqual(Array.from(b.eventTotal.get(baseline.teamKey)!));
    }
  });

  it("two runs at different seeds differ in at least one category", () => {
    const a = simulateDistrictEvent(input, 300, 1);
    const b = simulateDistrictEvent(input, 300, 2);
    const differs = input.baselines.some(
      (baseline) =>
        Array.from(a.eventTotal.get(baseline.teamKey)!).join(",") !==
        Array.from(b.eventTotal.get(baseline.teamKey)!).join(",")
    );
    expect(differs).toBe(true);
  });

  it("structuredClone(result) succeeds, the cloned histograms hold the same values, and no value anywhere in the result is a function", () => {
    const result = simulateDistrictEvent(input, 200, 99);
    const cloned = structuredClone(result);
    expect(cloned.eventKey).toBe(result.eventKey);
    expect(cloned.draws).toBe(result.draws);
    for (const baseline of input.baselines) {
      expect(Array.from(cloned.eventTotal.get(baseline.teamKey)!)).toEqual(
        Array.from(result.eventTotal.get(baseline.teamKey)!)
      );
      expect(cloned.qualPoints.get(baseline.teamKey)).toBeInstanceOf(Int32Array);
    }

    const functionsFound: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (typeof value === "function") {
        functionsFound.push(path);
        return;
      }
      if (value instanceof Map) {
        for (const [key, entry] of value) walk(entry, `${path}.${String(key)}`);
        return;
      }
      if (ArrayBuffer.isView(value)) return;
      if (Array.isArray(value)) {
        value.forEach((entry, i) => walk(entry, `${path}[${i}]`));
        return;
      }
      if (value !== null && typeof value === "object") {
        for (const [key, entry] of Object.entries(value)) walk(entry, `${path}.${key}`);
      }
    };
    walk(result, "result");
    expect(functionsFound).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Every histogram is a true marginal of the SAME runs
// ---------------------------------------------------------------------------

describe("simulateDistrictEvent — every histogram is a marginal of the same runs", () => {
  it("each category's histogram sums to draws for every team, and the per-draw quadruple sums to that draw's event total, whose tally reproduces the returned event-total histogram exactly", () => {
    const teamCount = 30;
    const input = inputFor(teamCount);
    const draws = 400;
    const totalLength =
      maxEventPoints(SEASON, TIER).qual +
      maxEventPoints(SEASON, TIER).alliance +
      maxEventPoints(SEASON, TIER).elim +
      maxEventPoints(SEASON, TIER).award +
      1;
    const talliedTotals = input.baselines.map(() => new Int32Array(totalLength));
    let quadrupleMismatches = 0;

    const result = simulateDistrictEvent(input, draws, 31337, (observation) => {
      for (let i = 0; i < teamCount; i++) {
        const sum = observation.qual[i]! + observation.selection[i]! + observation.elim[i]! + observation.award[i]!;
        if (sum !== observation.total[i]!) quadrupleMismatches++;
        talliedTotals[i]![sum]! += 1;
      }
    });

    expect(quadrupleMismatches).toBe(0);
    for (let i = 0; i < teamCount; i++) {
      const key = input.baselines[i]!.teamKey;
      for (const histogram of [
        result.qualPoints.get(key)!,
        result.selectionPoints.get(key)!,
        result.elimPoints.get(key)!,
        result.awardPoints.get(key)!,
        result.eventTotal.get(key)!,
      ]) {
        expect(histogram.reduce((sum, v) => sum + v, 0)).toBe(draws);
      }
      expect(Array.from(result.eventTotal.get(key)!)).toEqual(Array.from(talliedTotals[i]!));
    }
  });
});

// ---------------------------------------------------------------------------
// Ceilings are read, not assumed
// ---------------------------------------------------------------------------

describe("simulateDistrictEvent — every histogram length traces to maxEventPoints", () => {
  it.each(["district", "dcmp"] as const)("%s tier: every length is that component's ceiling plus one", (tier) => {
    const teamCount = 24;
    const input = inputFor(teamCount, { tier });
    const result = simulateDistrictEvent(input, 50, 5);
    const ceilings = maxEventPoints(SEASON, tier);
    const key = teamKey(1);
    expect(result.qualPoints.get(key)!.length).toBe(ceilings.qual + 1);
    expect(result.selectionPoints.get(key)!.length).toBe(ceilings.alliance + 1);
    expect(result.elimPoints.get(key)!.length).toBe(ceilings.elim + 1);
    expect(result.awardPoints.get(key)!.length).toBe(ceilings.award + 1);
    expect(result.eventTotal.get(key)!.length).toBe(
      ceilings.qual + ceilings.alliance + ceilings.elim + ceilings.award + 1
    );
  });

  it("at the dcmp tier every length is three times the district-tier length minus two, because each is a ceiling plus one", () => {
    const district = maxEventPoints(SEASON, "district");
    const dcmp = maxEventPoints(SEASON, "dcmp");
    expect(dcmp.qual + 1).toBe(3 * (district.qual + 1) - 2);
    expect(dcmp.alliance + 1).toBe(3 * (district.alliance + 1) - 2);
    expect(dcmp.elim + 1).toBe(3 * (district.elim + 1) - 2);
    expect(dcmp.award + 1).toBe(3 * (district.award + 1) - 2);
  });
});

// ---------------------------------------------------------------------------
// The draft: progressive captains, serpentine round two
// ---------------------------------------------------------------------------

describe("simulateDistrictEvent — the hand-computed draft", () => {
  /**
   * With 24 teams, zero remaining matches and the permuted ratings above, the
   * finishing order is team 1 through 24 and the greedy-by-SPR pick order is
   * fixed. Walking the progressive captain rule and the serpentine draft by
   * hand gives exactly this assignment, alliance by alliance and slot by slot.
   * A reversed round two, or a precomputed top-eight captain list, fails on a
   * NAMED slot rather than on a distribution.
   */
  const EXPECTED_ALLIANCES: readonly (readonly number[])[] = [
    [1, 17, 24],
    [2, 10, 14],
    [3, 20, 21],
    [4, 13, 11],
    [5, 6, 18],
    [7, 23, 15],
    [8, 16, 22],
    [9, 19, 12],
  ];

  it("assigns all 24 teams to the hand-computed slots, in every draw", () => {
    const input = inputFor(24, { remainingMatches: [] });
    const observed: string[][][] = [];
    simulateDistrictEvent(input, 5, 11, (observation) => {
      observed.push(snapshot(observation).alliances);
    });
    const expected = EXPECTED_ALLIANCES.map((alliance) => alliance.map((n) => teamKey(n)));
    for (const drawAlliances of observed) {
      expect(drawAlliances).toEqual(expected);
    }
  });

  it("the selection histogram is the point mass districtSelectionPoints gives for each hand-computed slot", () => {
    const input = inputFor(24, { remainingMatches: [] });
    const result = simulateDistrictEvent(input, 40, 11);
    EXPECTED_ALLIANCES.forEach((alliance, index) => {
      const allianceNumber = index + 1;
      alliance.forEach((team, slot) => {
        const histogram = result.selectionPoints.get(teamKey(team))!;
        const expectedPoints = districtSelectionPoints(SEASON, TIER, slot, allianceNumber);
        expect(histogram[expectedPoints]).toBe(40);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// The bracket runs through the ONE topology
// ---------------------------------------------------------------------------

describe("simulateDistrictEvent — the bracket", () => {
  it("requests exactly BRACKET_SETS's own 13 semifinal identifiers in table order, then two or three final matches", () => {
    const input = inputFor(24);
    const semifinalIds = BRACKET_SETS.filter((set) => set.id !== "f").map((set) => set.id);
    expect(semifinalIds).toHaveLength(13);

    let checked = 0;
    simulateDistrictEvent(input, 200, 606, (observation) => {
      checked++;
      const ids = observation.bracketSetIds;
      expect(ids.slice(0, 13)).toEqual(semifinalIds);
      const finals = ids.slice(13);
      expect(finals.length).toBeGreaterThanOrEqual(2);
      expect(finals.length).toBeLessThanOrEqual(3);
      expect(new Set(finals)).toEqual(new Set(["f"]));
    });
    expect(checked).toBe(200);
  });

  it("a best-of-three final short-circuits: with effectively decided ratings the vast majority of draws request exactly two final matches, and no draw ever requests a fourth", () => {
    const input = inputFor(24, { ratings: rankAlignedRatings(24), remainingMatches: [] });
    let twoMatchFinals = 0;
    let maxFinals = 0;
    const draws = 200;
    simulateDistrictEvent(input, draws, 8080, (observation) => {
      const finals = observation.bracketSetIds.length - 13;
      if (finals === 2) twoMatchFinals++;
      if (finals > maxFinals) maxFinals = finals;
    });
    expect(twoMatchFinals / draws).toBeGreaterThan(0.95);
    expect(maxFinals).toBeLessThanOrEqual(3);
  });

  it("the nonzero elim point multiset is exactly one 30, one 20, one 13 and one 7 per draw, with every other alliance at 0", () => {
    const input = inputFor(24);
    let checked = 0;
    simulateDistrictEvent(input, 300, 4, (observation) => {
      checked++;
      const perAlliance = observation.alliances.map((roster) => {
        const index = input.baselines.findIndex((b) => b.teamKey === roster[0]);
        return observation.elim[index]!;
      });
      expect([...perAlliance].sort((a, b) => b - a)).toEqual([30, 20, 13, 7, 0, 0, 0, 0]);
      // Every member of an alliance carries that alliance's value.
      observation.alliances.forEach((roster, n) => {
        for (const key of roster) {
          const index = input.baselines.findIndex((b) => b.teamKey === key);
          expect(observation.elim[index]).toBe(perAlliance[n]);
        }
      });
    });
    expect(checked).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// Awards
// ---------------------------------------------------------------------------

describe("simulateDistrictEvent — the award draw", () => {
  it("the tallied award histogram matches the 10-02 lookup's own pmf within Monte Carlo tolerance at 20,000 draws", () => {
    const input = inputFor(24, { remainingMatches: [] });
    const draws = 20_000;
    const result = simulateDistrictEvent(input, draws, 2024);
    const rate = awardBaseRate(SEASON, "none", "veteran");
    const histogram = result.awardPoints.get(teamKey(1))!;
    AWARD_POINT_SUPPORT.forEach((points, index) => {
      expect(histogram[points]! / draws).toBeCloseTo(rate.pmf[index]!, 2);
    });
  });

  it("carries the lookup's fallback rung for every team", () => {
    const input = inputFor(24, { remainingMatches: [] });
    const result = simulateDistrictEvent(input, 10, 1);
    const expected = awardBaseRate(SEASON, "none", "veteran").source;
    for (const baseline of input.baselines) {
      expect(result.awardSources.get(baseline.teamKey)).toBe(expected);
    }
  });

  it("a bucket whose exact cell is absent falls back and reports the rung it landed on, rather than reporting a cell it did not use", () => {
    const profiles = new Map<string, DistrictAwardProfile>();
    for (let i = 1; i <= 24; i++) profiles.set(teamKey(i), { bucket: "three-or-more", rookieState: "rookie" });
    const input = inputFor(24, { remainingMatches: [], awardProfiles: profiles });
    const result = simulateDistrictEvent(input, 10, 1);
    expect(result.awardSources.get(teamKey(1))).toBe("bucket-pooled");
  });
});

// ---------------------------------------------------------------------------
// Validation before the loop
// ---------------------------------------------------------------------------

describe("simulateDistrictEvent — validation before any draw, naming EVERY offender", () => {
  it("UnratedTeamError names both teams when two roster members carry an absent or non-finite rating", () => {
    const ratings = permutedRatings(24);
    ratings.set(teamKey(3), { teamKey: teamKey(3), total: undefined, sigma: 3 });
    ratings.set(teamKey(9), { teamKey: teamKey(9), total: Number.NaN, sigma: 3 });
    const input = inputFor(24, { ratings });
    try {
      simulateDistrictEvent(input, 10, 1);
      expect.fail("expected UnratedTeamError");
    } catch (error) {
      expect(error).toBeInstanceOf(UnratedTeamError);
      expect((error as Error).message).toContain(teamKey(3));
      expect((error as Error).message).toContain(teamKey(9));
    }
  });

  it("a zero-spread team is unrated, not a certainty — an absence of information about spread, never a tight band", () => {
    const ratings = permutedRatings(24);
    ratings.set(teamKey(5), { teamKey: teamKey(5), total: 40, sigma: 0 });
    expect(() => simulateDistrictEvent(inputFor(24, { ratings }), 10, 1)).toThrow(UnratedTeamError);
  });

  it("MissingAwardProfileError names every roster member with no profile", () => {
    const profiles = profilesFor(24);
    profiles.delete(teamKey(2));
    profiles.delete(teamKey(20));
    try {
      simulateDistrictEvent(inputFor(24, { awardProfiles: profiles }), 10, 1);
      expect.fail("expected MissingAwardProfileError");
    } catch (error) {
      expect(error).toBeInstanceOf(MissingAwardProfileError);
      expect((error as Error).message).toContain(teamKey(2));
      expect((error as Error).message).toContain(teamKey(20));
    }
  });

  it("InvalidFieldSizeError for a field size below the roster size, and for a non-integer one", () => {
    expect(() => simulateDistrictEvent(inputFor(24, { fieldSize: 23 }), 10, 1)).toThrow(InvalidFieldSizeError);
    expect(() => simulateDistrictEvent(inputFor(24, { fieldSize: 24.5 }), 10, 1)).toThrow(InvalidFieldSizeError);
  });

  it("InsufficientRosterError when the roster cannot fill the alliances", () => {
    const input = inputFor(23, { remainingMatches: [] });
    expect(() => simulateDistrictEvent(input, 10, 1)).toThrow(InsufficientRosterError);
  });

  it("UnknownDistrictSeasonError propagates untouched for an unregistered season", () => {
    expect(() => simulateDistrictEvent(inputFor(24, { season: 2021 }), 10, 1)).toThrow(UnknownDistrictSeasonError);
  });

  it("UnsupportedAllianceCountError for an alliance count this module routes no bracket for", () => {
    expect(() => simulateDistrictEvent(inputFor(24, { allianceCount: 6 }), 10, 1)).toThrow(UnsupportedAllianceCountError);
  });
});

// ---------------------------------------------------------------------------
// The pricer's refusal branch
// ---------------------------------------------------------------------------

describe("decideBracketMatch — the pricer's refusal is unreachable through the public entry point, and still refuses", () => {
  const zeroVariance: AllianceMemberRating[] = [
    { teamKey: teamKey(1), total: 40, sigma: 0 },
    { teamKey: teamKey(2), total: 30, sigma: 0 },
    { teamKey: teamKey(3), total: 20, sigma: 0 },
  ];

  it("throws AlliancePricingError rather than coercing a zero-variance pair into a coin", () => {
    expect(() => decideBracketMatch(1, 8, zeroVariance, zeroVariance, "sf1", () => 0.5)).toThrow(AlliancePricingError);
  });

  it("the same input is rejected by the up-front validation, so the throw cannot fire through simulateDistrictEvent", () => {
    const ratings = new Map<string, AllianceMemberRating>();
    for (let i = 1; i <= 24; i++) ratings.set(teamKey(i), { teamKey: teamKey(i), total: i, sigma: 0 });
    expect(() => simulateDistrictEvent(inputFor(24, { ratings }), 10, 1)).toThrow(UnratedTeamError);
  });

  it("prices a real pair and returns one of the two alliances it was handed", () => {
    const strong: AllianceMemberRating[] = [
      { teamKey: teamKey(1), total: 60, sigma: 5 },
      { teamKey: teamKey(2), total: 55, sigma: 5 },
      { teamKey: teamKey(3), total: 50, sigma: 5 },
    ];
    const weak: AllianceMemberRating[] = [
      { teamKey: teamKey(4), total: 20, sigma: 5 },
      { teamKey: teamKey(5), total: 18, sigma: 5 },
      { teamKey: teamKey(6), total: 15, sigma: 5 },
    ];
    expect([1, 8]).toContain(decideBracketMatch(1, 8, strong, weak, "sf1", () => 0.5));
    expect(decideBracketMatch(1, 8, strong, weak, "sf1", () => 0.5)).toBe(1);
  });
});
