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
import {
  awardResidualRate,
  foldStackedAwardPmf,
  hasAwardOrderingTables,
  IMPACT_AWARD_POINTS,
  impactOrderingProbability,
  MAX_IMPACT_POSITION,
  ROOKIE_ALL_STAR_AWARD_POINTS,
  rookieAllStarOrderingProbability,
  SINGLE_AWARD_POINT_CEILING,
} from "./awardOrderingTables.js";
import {
  BRACKET_SETS,
  divisionedDcmpPlayoffPmf,
  InvalidBracketDecisionError,
  UnsupportedAllianceCountError,
  UnsupportedBracketSeasonError,
  type PlayedBracketMatch,
} from "./bracket.js";
import {
  AlliancePricingError,
  convolveDistrictGrandTotal,
  decideBracketMatch,
  EmptyHistogramError,
  encodeDistrictPointPmf,
  InsufficientRosterError,
  InvalidAllianceSetError,
  InvalidFieldSizeError,
  InvalidKnownPointsError,
  MissingAwardProfileError,
  NegativeDistrictShiftError,
  awardOrderingAssignments,
  singleAwardPoints,
  simulateDistrictEvent,
  UnratedTeamError,
  type DistrictAwardProfile,
  type DistrictDrawObservation,
  type DistrictEventTotalInput,
  type DistrictLedgerEventInput,
  type SuppliedAlliance,
} from "./ledgerSimulation.js";
import { chanceOfAnyPoints, EmptyDistributionError, pointCellSummary } from "./pointSummary.js";
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
  it("the tallied award histogram matches the 10-02 lookup's own FOLDED pmf within Monte Carlo tolerance at 20,000 draws", () => {
    const input = inputFor(24, { remainingMatches: [] });
    const draws = 20_000;
    const result = simulateDistrictEvent(input, draws, 2024);
    // The FOLDED pmf, because that is the distribution the draw reads: the
    // measured table's 13 and 15 bins are stacks of two awards and the site never
    // predicts one. Comparing against the raw pmf would pass anyway — those bins
    // hold about a thousandth of the mass, well inside a two-decimal tolerance —
    // which is exactly why the two assertions below are exact rather than close.
    const folded = foldStackedAwardPmf(awardBaseRate(SEASON, "none", "veteran").pmf);
    const histogram = result.awardPoints.get(teamKey(1))!;
    AWARD_POINT_SUPPORT.forEach((points, index) => {
      expect(histogram[points]! / draws).toBeCloseTo(folded[index]!, 2);
    });
  });

  it("puts NO mass on a stacked award: the two stacked bins are empty and their mass moved onto 10 and 8", () => {
    const input = inputFor(24, { remainingMatches: [] });
    const draws = 20_000;
    const result = simulateDistrictEvent(input, draws, 2024);
    for (const baseline of input.baselines) {
      const histogram = result.awardPoints.get(baseline.teamKey)!;
      // Exactly zero, not "close to zero" — the fold moves the mass, so any
      // count at all here is the fold having been skipped.
      expect(histogram[13], `${baseline.teamKey} at 13 points`).toBe(0);
      expect(histogram[15], `${baseline.teamKey} at 15 points`).toBe(0);
    }
    // A bucket with measured 15-plus mass moves it onto 10. The raw table's
    // top bin is non-empty, and the folded 10 bin is exactly the sum of the
    // raw 10, 15 bins.
    const raw = awardBaseRate(SEASON, "none", "veteran").pmf;
    expect(raw[5]!).toBeGreaterThan(0);
    const folded = foldStackedAwardPmf(raw);
    expect(folded[3]!).toBeCloseTo(raw[3]! + raw[5]!, 12);
    expect(folded[2]!).toBeCloseTo(raw[2]! + raw[4]!, 12);
    expect(folded[4]!).toBe(0);
    expect(folded[5]!).toBe(0);
    // The mass is MOVED, never dropped.
    expect(folded.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
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

// ---------------------------------------------------------------------------
// STAGE AWARENESS (Task 2): every stage the page can be in is an INPUT, and
// the slider's rewind is the caller's row selection rather than a rule here.
// ---------------------------------------------------------------------------

/** The eight hand-computed alliances of the fixture's draft, as a SUPPLIED set. */
function suppliedAlliances(): SuppliedAlliance[] {
  const hand: readonly (readonly number[])[] = [
    [1, 17, 24],
    [2, 10, 14],
    [3, 20, 21],
    [4, 13, 11],
    [5, 6, 18],
    [7, 23, 15],
    [8, 16, 22],
    [9, 19, 12],
  ];
  return hand.map((alliance, index) => ({
    allianceNumber: index + 1,
    picks: alliance.map((n) => teamKey(n)),
  }));
}

function isPointMass(histogram: Int32Array, draws: number): boolean {
  let nonZeroBins = 0;
  for (const count of histogram) {
    if (count === 0) continue;
    nonZeroBins++;
    if (count !== draws) return false;
  }
  return nonZeroBins === 1;
}

function supportWidth(histogram: Int32Array): number {
  let width = 0;
  for (const count of histogram) if (count > 0) width++;
  return width;
}

describe("simulateDistrictEvent — quals done needs no special case", () => {
  it("zero remaining matches gives point-mass qualification and selection histograms for every team, and the same alliance assignment in draw 1 and draw 1,000", () => {
    const input = inputFor(30, { remainingMatches: [] });
    const draws = 1_000;
    const snapshots: string[] = [];
    const result = simulateDistrictEvent(input, draws, 12, (observation) => {
      if (observation.draw === 0 || observation.draw === draws - 1) {
        snapshots.push(JSON.stringify(snapshot(observation).alliances));
      }
    });
    for (const baseline of input.baselines) {
      expect(isPointMass(result.qualPoints.get(baseline.teamKey)!, draws)).toBe(true);
      expect(isPointMass(result.selectionPoints.get(baseline.teamKey)!, draws)).toBe(true);
    }
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toBe(snapshots[1]);
  });
});

describe("simulateDistrictEvent — the rewind reopens later stages", () => {
  it("the same event with five of its played rows handed back as remaining gives a strictly wider qualification support and a selection histogram that is no longer a point mass", () => {
    // Baselines spaced tightly enough that a reopened row's ranking-point draw
    // can actually move a team past its neighbour — the point of a rewind. The
    // wide fixture used elsewhere separates teams by more than any single
    // match can close, which would make this test pass vacuously.
    const teamCount = 30;
    const tightBaselines: SimTeamBaseline[] = [];
    for (let i = 1; i <= teamCount; i++) {
      tightBaselines.push({ teamKey: teamKey(i), earnedRpSum: (teamCount + 1 - i) * 2, matchesPlayed: 10 });
    }
    const widePmf = [0.2, 0.2, 0.2, 0.2, 0.2];
    const reopened: SimMatchInput[] = remainingMatches()
      .slice(1)
      .map((match) => ({ ...match, redRpPmf: widePmf, blueRpPmf: widePmf }));

    const closed = inputFor(teamCount, { remainingMatches: [], baselines: tightBaselines });
    const rewound = inputFor(teamCount, { remainingMatches: reopened, baselines: tightBaselines });
    const draws = 400;
    const closedResult = simulateDistrictEvent(closed, draws, 55);
    const rewoundResult = simulateDistrictEvent(rewound, draws, 55);

    const widened = closed.baselines.some(
      (baseline) =>
        supportWidth(rewoundResult.qualPoints.get(baseline.teamKey)!) >
        supportWidth(closedResult.qualPoints.get(baseline.teamKey)!)
    );
    expect(widened).toBe(true);
    const selectionOpened = closed.baselines.some(
      (baseline) => !isPointMass(rewoundResult.selectionPoints.get(baseline.teamKey)!, draws)
    );
    expect(selectionOpened).toBe(true);
    // The two different answers came from the two different INPUTS alone: the
    // module owns no rewind rule, and took the reopened rows as given.
    expect(closed.remainingMatches).toHaveLength(0);
    expect(rewound.remainingMatches).toHaveLength(5);
  });
});

describe("simulateDistrictEvent — alliances announced", () => {
  it("fixes every team's selection points at its real slot, leaves a fourth robot and an unallied team at zero, and seeds the bracket from the supplied rosters", () => {
    const withBackup = suppliedAlliances().map((alliance, index) =>
      index === 0 ? { ...alliance, picks: [...alliance.picks, teamKey(25)] } : alliance
    );
    const input = inputFor(30, { knownAlliances: withBackup });
    const draws = 100;
    let drawsWithBracket = 0;
    const result = simulateDistrictEvent(input, draws, 7, (observation) => {
      if (observation.bracketSetIds.length > 0) drawsWithBracket++;
      // The decider-visible rosters ARE the supplied ones, not a simulated draft.
      expect(observation.alliances[0]).toEqual(withBackup[0]!.picks);
      expect(observation.alliances[7]).toEqual(withBackup[7]!.picks);
    });
    expect(drawsWithBracket).toBe(draws);

    for (const alliance of withBackup) {
      alliance.picks.forEach((key, slot) => {
        const histogram = result.selectionPoints.get(key)!;
        expect(histogram[districtSelectionPoints(SEASON, TIER, slot, alliance.allianceNumber)]).toBe(draws);
      });
    }
    // The backup robot on alliance 1 earns nothing, and so does a team on no alliance.
    expect(result.selectionPoints.get(teamKey(25))![0]).toBe(draws);
    for (const n of [26, 27, 28, 29, 30]) {
      expect(result.selectionPoints.get(teamKey(n))![0]).toBe(draws);
    }
  });

  it.each([
    [
      "a team on two alliances",
      (a: SuppliedAlliance[]): SuppliedAlliance[] =>
        a.map((alliance, i) => (i === 1 ? { ...alliance, picks: [teamKey(1), ...alliance.picks.slice(1)] } : alliance)),
      [teamKey(1)],
    ],
    [
      "an alliance number outside the range",
      (a: SuppliedAlliance[]): SuppliedAlliance[] =>
        a.map((alliance, i) => (i === 7 ? { ...alliance, allianceNumber: 9 } : alliance)),
      ["9"],
    ],
    [
      "a duplicate alliance number",
      (a: SuppliedAlliance[]): SuppliedAlliance[] =>
        a.map((alliance, i) => (i === 7 ? { ...alliance, allianceNumber: 1 } : alliance)),
      ["1"],
    ],
    ["a missing alliance number", (a: SuppliedAlliance[]): SuppliedAlliance[] => a.slice(0, 7), ["8"]],
    [
      "an empty pick list",
      (a: SuppliedAlliance[]): SuppliedAlliance[] => a.map((alliance, i) => (i === 2 ? { ...alliance, picks: [] } : alliance)),
      ["3"],
    ],
    [
      "a pick list longer than four",
      (a: SuppliedAlliance[]): SuppliedAlliance[] =>
        a.map((alliance, i) => (i === 4 ? { ...alliance, picks: [...alliance.picks, teamKey(26), teamKey(27)] } : alliance)),
      ["5"],
    ],
    [
      "a pick naming a team absent from the roster",
      (a: SuppliedAlliance[]): SuppliedAlliance[] =>
        a.map((alliance, i) =>
          i === 3 ? { ...alliance, picks: [alliance.picks[0]!, "frc9999", alliance.picks[2]!] } : alliance
        ),
      ["frc9999", "4"],
    ],
  ])("rejects %s with a typed error naming the offending alliance and team", (_label, mutate, expectedFragments) => {
    const input = inputFor(30, { knownAlliances: mutate(suppliedAlliances()) });
    try {
      simulateDistrictEvent(input, 10, 1);
      expect.fail("expected InvalidAllianceSetError");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidAllianceSetError);
      for (const fragment of expectedFragments) expect((error as Error).message).toContain(fragment);
    }
  });
});

describe("simulateDistrictEvent — playoffs done", () => {
  it("fixes every team's elim points and never routes the bracket, because routing and discarding would consume the ledger stream and silently change every later draw", () => {
    const supplied = suppliedAlliances();
    const knownElimPoints = new Map<string, number>();
    supplied.forEach((alliance, index) => {
      const points = [30, 20, 13, 7, 0, 0, 0, 0][index]!;
      for (const key of alliance.picks) knownElimPoints.set(key, points);
    });
    const input = inputFor(30, { knownAlliances: supplied, knownElimPoints });
    const draws = 100;
    let deciderCalls = 0;
    const result = simulateDistrictEvent(input, draws, 3, (observation) => {
      deciderCalls += observation.bracketSetIds.length;
    });
    expect(deciderCalls).toBe(0);
    for (const [key, points] of knownElimPoints) {
      expect(result.elimPoints.get(key)![points]).toBe(draws);
    }
    expect(result.elimPoints.get(teamKey(30))![0]).toBe(draws);
  });
});

describe("simulateDistrictEvent — awards posted", () => {
  it("fixes every team's award points, consumes no randomness for awards, and does NOT require an award profile", () => {
    const knownAwardPoints = new Map<string, number>([
      [teamKey(1), 10],
      [teamKey(2), 5],
    ]);
    const input = inputFor(30, {
      knownAwardPoints,
      awardProfiles: new Map<string, DistrictAwardProfile>(),
      remainingMatches: [],
      knownAlliances: suppliedAlliances(),
      knownElimPoints: new Map<string, number>(),
    });
    const draws = 50;
    let ledgerDraws = 0;
    const result = simulateDistrictEvent(input, draws, 9, (observation) => {
      ledgerDraws += observation.ledgerDraws;
    });
    expect(ledgerDraws).toBe(0);
    expect(result.awardPoints.get(teamKey(1))![10]).toBe(draws);
    expect(result.awardPoints.get(teamKey(2))![5]).toBe(draws);
    expect(result.awardPoints.get(teamKey(3))![0]).toBe(draws);
    expect(result.awardSources.size).toBe(0);
  });

  it("the same input WITHOUT known award points DOES throw for the missing profile, so the two stages are genuinely distinguished", () => {
    const input = inputFor(30, { awardProfiles: new Map<string, DistrictAwardProfile>(), remainingMatches: [] });
    expect(() => simulateDistrictEvent(input, 10, 9)).toThrow(MissingAwardProfileError);
  });
});

describe("simulateDistrictEvent — the stages compose", () => {
  it("all four known at once gives five point masses, a ledger-stream consumption count of exactly zero, and an event total that is the exact sum of the four supplied numbers", () => {
    const supplied = suppliedAlliances();
    const knownElimPoints = new Map<string, number>();
    supplied.forEach((alliance, index) => {
      const points = [30, 20, 13, 7, 0, 0, 0, 0][index]!;
      for (const key of alliance.picks) knownElimPoints.set(key, points);
    });
    const knownAwardPoints = new Map<string, number>([[teamKey(1), 5]]);
    const input = inputFor(30, {
      remainingMatches: [],
      knownAlliances: supplied,
      knownElimPoints,
      knownAwardPoints,
    });
    const draws = 100;
    let ledgerDraws = 0;
    const result = simulateDistrictEvent(input, draws, 17, (observation) => {
      ledgerDraws += observation.ledgerDraws;
    });
    expect(ledgerDraws).toBe(0);
    for (const baseline of input.baselines) {
      expect(isPointMass(result.qualPoints.get(baseline.teamKey)!, draws)).toBe(true);
      expect(isPointMass(result.selectionPoints.get(baseline.teamKey)!, draws)).toBe(true);
      expect(isPointMass(result.elimPoints.get(baseline.teamKey)!, draws)).toBe(true);
      expect(isPointMass(result.awardPoints.get(baseline.teamKey)!, draws)).toBe(true);
      expect(isPointMass(result.eventTotal.get(baseline.teamKey)!, draws)).toBe(true);
    }
    // Team 1 is alliance 1's captain at rank 1, elim 30, award 5 — the fully
    // grey case the page shows for a finished event.
    const expectedTotal =
      districtQualPoints(SEASON, TIER, 1, 30) + districtSelectionPoints(SEASON, TIER, 0, 1) + 30 + 5;
    expect(result.eventTotal.get(teamKey(1))![expectedTotal]).toBe(draws);
  });

  it.each([
    ["all open", {}],
    ["alliances known", { knownAlliances: suppliedAlliances() }],
    [
      "alliances and playoffs known",
      { knownAlliances: suppliedAlliances(), knownElimPoints: new Map<string, number>() },
    ],
    [
      "everything known",
      {
        knownAlliances: suppliedAlliances(),
        knownElimPoints: new Map<string, number>(),
        knownAwardPoints: new Map<string, number>(),
      },
    ],
  ])("%s: two runs at one seed are byte-identical and consume a stable ledger-stream count", (_label, overrides) => {
    const input = inputFor(30, overrides as Partial<DistrictLedgerEventInput>);
    const run = (): { signature: string; ledgerDraws: number } => {
      let ledgerDraws = 0;
      const result = simulateDistrictEvent(input, 120, 606, (observation) => {
        ledgerDraws += observation.ledgerDraws;
      });
      const signature = input.baselines
        .map((baseline) => Array.from(result.eventTotal.get(baseline.teamKey)!).join(","))
        .join("|");
      return { signature, ledgerDraws };
    };
    const first = run();
    const second = run();
    expect(first.signature).toBe(second.signature);
    expect(first.ledgerDraws).toBe(second.ledgerDraws);
  });
});

describe("simulateDistrictEvent — the non-eight-alliance fallback never routes a bracket", () => {
  it.each([2, 4])(
    "an alliance count of %i draws every allianced team's elim points from the measured divisioned-dcmp table and calls routeBracket exactly zero times",
    (allianceCount) => {
      const input = inputFor(24, { allianceCount, tier: "dcmp", remainingMatches: [] });
      const draws = 4_000;
      let deciderCalls = 0;
      const captainOf: string[] = [];
      const result = simulateDistrictEvent(input, draws, 1234, (observation) => {
        deciderCalls += observation.bracketSetIds.length;
        if (observation.draw === 0) for (const roster of observation.alliances) captainOf.push(roster[0]!);
      });
      expect(deciderCalls).toBe(0);
      expect(captainOf).toHaveLength(allianceCount);

      const weight = 3;
      for (let allianceNumber = 1; allianceNumber <= allianceCount; allianceNumber++) {
        const pmf = divisionedDcmpPlayoffPmf(allianceCount, allianceNumber);
        const histogram = result.elimPoints.get(captainOf[allianceNumber - 1]!)!;
        let massOnMeasuredSupport = 0;
        for (const entry of pmf) {
          const observed = histogram[entry.points * weight]! / draws;
          expect(observed).toBeCloseTo(entry.probability, 1);
          massOnMeasuredSupport += histogram[entry.points * weight]!;
        }
        // No draw lands outside the measured support for this alliance number.
        expect(massOnMeasuredSupport).toBe(draws);
      }

      // An unallied team stays at 0.
      let unalliedAtZero = 0;
      for (const baseline of input.baselines) {
        if (result.elimPoints.get(baseline.teamKey)![0] === draws) unalliedAtZero++;
      }
      expect(unalliedAtZero).toBeGreaterThanOrEqual(24 - allianceCount * 3);
    }
  );

  it("an alliance count of 4 still runs the draft: four three-team alliances, round one 1 through 4 and round two 4 down to 1", () => {
    const input = inputFor(24, { allianceCount: 4, tier: "dcmp", remainingMatches: [] });
    let seen: string[][] | undefined;
    simulateDistrictEvent(input, 1, 5, (observation) => {
      seen = snapshot(observation).alliances;
    });
    expect(seen).toBeDefined();
    // Hand-derived from the same ranking and permuted ratings: captains 1, 2,
    // 3, 4 and first picks 17, 10, 20, 13 in round one; then round two runs
    // alliance 4 first, so alliance 4's second pick is the stronger one.
    expect(seen).toEqual([
      [teamKey(1), teamKey(17), teamKey(9)],
      [teamKey(2), teamKey(10), teamKey(16)],
      [teamKey(3), teamKey(20), teamKey(23)],
      [teamKey(4), teamKey(13), teamKey(6)],
    ]);
  });
});

describe("simulateDistrictEvent — the season guard and the tie caveat", () => {
  it("a pre-2023 season throws through 10-01's own bracket-season guard rather than routing the 2023-plus topology over a season that did not use it", () => {
    expect(() => simulateDistrictEvent(inputFor(24, { season: 2022 }), 10, 1)).toThrow(UnsupportedBracketSeasonError);
  });

  it("two teams tied on average ranking points order deterministically by team key — NOT TBA's official tiebreak, which is why a finished event shows the earned grey number and never this derived one", () => {
    const teamCount = 24;
    const baselines = baselinesFor(teamCount);
    baselines[3] = { teamKey: teamKey(4), earnedRpSum: baselines[2]!.earnedRpSum, matchesPlayed: 10 };
    const input = inputFor(teamCount, { remainingMatches: [], baselines });
    let order: number[] | undefined;
    simulateDistrictEvent(input, 1, 1, (observation) => {
      order = [...observation.order];
    });
    expect(order).toBeDefined();
    expect(input.baselines[order![2]!]!.teamKey).toBe(teamKey(3));
    expect(input.baselines[order![3]!]!.teamKey).toBe(teamKey(4));
    // Deterministic, and therefore a point mass — but the ORDER between the
    // two is this pipeline's reproducibility tiebreak, not FRC's, so the two
    // derived qualification values can disagree with what the teams earned.
    const result = simulateDistrictEvent(input, 20, 1);
    expect(isPointMass(result.qualPoints.get(teamKey(3))!, 20)).toBe(true);
    expect(isPointMass(result.qualPoints.get(teamKey(4))!, 20)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// THE GRAND TOTAL (Task 3): the exact convolution, and the publish-boundary
// encoder for EVENT-LEVEL histograms only.
// ---------------------------------------------------------------------------

/** Event A: half its mass at 0 points and half at 1. */
const EVENT_A: DistrictEventTotalInput = { counts: [1, 1], denominator: 2 };
/** Event B: a quarter of its mass at 0 points and three quarters at 2. */
const EVENT_B: DistrictEventTotalInput = { counts: [1, 0, 3], denominator: 4 };

describe("convolveDistrictGrandTotal — the hand-computed case", () => {
  it("two two-point event totals convolve to 0.125, 0.125, 0.375, 0.375, every entry to within 1e-12", () => {
    const grand = convolveDistrictGrandTotal([EVENT_A, EVENT_B], 0, 0);
    // By the product rule: 0.5 x 0.25, 0.5 x 0.25, 0.5 x 0.75, 0.5 x 0.75.
    const expected = [0.125, 0.125, 0.375, 0.375];
    expect(grand).toHaveLength(expected.length);
    expected.forEach((value, index) => {
      expect(Math.abs(grand[index]! - value)).toBeLessThan(1e-12);
    });
  });

  it("a rookie bonus of 5 shifts the whole support up by exactly 5, with the same four values and zeros below", () => {
    const grand = convolveDistrictGrandTotal([EVENT_A, EVENT_B], 5, 0);
    expect(grand).toHaveLength(9);
    for (let i = 0; i < 5; i++) expect(grand[i]).toBe(0);
    const expected = [0.125, 0.125, 0.375, 0.375];
    expected.forEach((value, index) => {
      expect(Math.abs(grand[5 + index]! - value)).toBeLessThan(1e-12);
    });
  });

  it("is order independent: three event totals convolve to the same result in any input order", () => {
    const eventC: DistrictEventTotalInput = { counts: [2, 3, 5], denominator: 10 };
    const first = convolveDistrictGrandTotal([EVENT_A, EVENT_B, eventC], 0, 0);
    const second = convolveDistrictGrandTotal([eventC, EVENT_A, EVENT_B], 0, 0);
    const third = convolveDistrictGrandTotal([EVENT_B, eventC, EVENT_A], 0, 0);
    expect(first).toHaveLength(second.length);
    for (let i = 0; i < first.length; i++) {
      expect(Math.abs(first[i]! - second[i]!)).toBeLessThan(1e-12);
      expect(Math.abs(first[i]! - third[i]!)).toBeLessThan(1e-12);
    }
  });

  it("is always a distribution: finite, non-negative and summing to 1 within the same 1e-9 the publish-boundary schema applies", () => {
    const cases: DistrictEventTotalInput[][] = [
      [],
      [EVENT_A],
      [EVENT_A, EVENT_B],
      [EVENT_A, EVENT_B, { counts: [2, 3, 5], denominator: 10 }],
    ];
    for (const eventTotals of cases) {
      const grand = convolveDistrictGrandTotal(eventTotals, 5, 0);
      let sum = 0;
      for (const value of grand) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        sum += value;
      }
      expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    }
  });

  it("support length is exactly a + b - 1, plus the shift", () => {
    const a = { counts: new Array<number>(84).fill(1), denominator: 84 };
    const b = { counts: new Array<number>(84).fill(1), denominator: 84 };
    expect(convolveDistrictGrandTotal([a, b], 0, 0)).toHaveLength(84 + 84 - 1);
    expect(convolveDistrictGrandTotal([a, b], 10, 0)).toHaveLength(84 + 84 - 1 + 10);
  });

  it.each([0, 1, 2, 3, 4])(
    "%i event totals is a real state, matching the 708 / 1,334 / 7,858 / 6,200 / 245 corpus rows",
    (eventCount) => {
      const eventTotals = new Array<DistrictEventTotalInput>(eventCount).fill(EVENT_A);
      const grand = convolveDistrictGrandTotal(eventTotals, 5, 0);
      let sum = 0;
      for (const value of grand) sum += value;
      expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
      if (eventCount === 0) {
        // Zero events is a point mass at the shift, not an error.
        expect(grand).toHaveLength(6);
        expect(grand[5]).toBe(1);
      }
    }
  );

  it("validates both scalar addends and throws rather than clamping a negative shift", () => {
    expect(() => convolveDistrictGrandTotal([EVENT_A], 5.5, 0)).toThrow(NegativeDistrictShiftError);
    expect(() => convolveDistrictGrandTotal([EVENT_A], 5, 0.5)).toThrow(NegativeDistrictShiftError);
    // `adjustments` is 0 in all 16,345 corpus district_rankings rows, so a
    // negative shift has NEVER been observed; clamping one to zero would be a
    // fabricated value rather than a fallback.
    try {
      convolveDistrictGrandTotal([EVENT_A], 0, -3);
      expect.fail("expected NegativeDistrictShiftError");
    } catch (error) {
      expect(error).toBeInstanceOf(NegativeDistrictShiftError);
      expect((error as Error).message).toContain("-3");
    }
  });

  it("a counts histogram and its pre-normalised pmf give the same grand total to within 1e-12", () => {
    const counts = Int32Array.from([120, 0, 380, 500]);
    const draws = 1_000;
    const normalised = Array.from(counts, (value) => value / draws);
    const fromCounts = convolveDistrictGrandTotal([{ counts, denominator: draws }, EVENT_B], 0, 0);
    const fromPmf = convolveDistrictGrandTotal([{ counts: normalised, denominator: 1 }, EVENT_B], 0, 0);
    expect(fromCounts).toHaveLength(fromPmf.length);
    for (let i = 0; i < fromCounts.length; i++) {
      expect(Math.abs(fromCounts[i]! - fromPmf[i]!)).toBeLessThan(1e-12);
    }
  });
});

describe("encodeDistrictPointPmf — 10-03's offset encoding, event level only", () => {
  it("trims leading zeros into the offset and trailing zeros off the array, and entry i is the probability of exactly offset + i points", () => {
    const histogram = Int32Array.from([0, 0, 250, 0, 750, 0, 0]);
    const { offset, p } = encodeDistrictPointPmf(histogram, 1_000);
    expect(offset).toBe(2);
    expect(p).toEqual([0.25, 0, 0.75]);
    expect(p[0]).not.toBe(0);
    expect(p[p.length - 1]).not.toBe(0);
    let sum = 0;
    for (const value of p) sum += value;
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    // The encoding's own claim, checked against the source histogram.
    p.forEach((probability, i) => {
      expect(probability).toBeCloseTo(histogram[offset + i]! / 1_000, 12);
    });
  });

  it("a point-mass histogram encodes to a single-entry array at the right offset", () => {
    const histogram = Int32Array.from([0, 0, 0, 500, 0]);
    expect(encodeDistrictPointPmf(histogram, 500)).toEqual({ offset: 3, p: [1] });
  });

  it("an all-zero histogram and a zero draw count both throw", () => {
    expect(() => encodeDistrictPointPmf(new Int32Array(10), 1_000)).toThrow(EmptyHistogramError);
    expect(() => encodeDistrictPointPmf(Int32Array.from([1, 2, 3]), 0)).toThrow(EmptyHistogramError);
  });

  it("the module exports NO grand-total encoder", async () => {
    const module = await import("./ledgerSimulation.js");
    const grandTotalEncoders = Object.keys(module).filter(
      (name) => /grand/i.test(name) && /encode|pmf/i.test(name)
    );
    // `district_rankings.point_total` reaches 445 in the corpus while
    // DistrictPointPmfSchema caps a pmf at 256 entries. The grand total is a
    // browser-side quantity and is never a published field, so the ABSENCE is
    // the mitigation.
    expect(grandTotalEncoders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The measured cost. RECORDED, never asserted against a millisecond bar.
// ---------------------------------------------------------------------------

describe("simulateDistrictEvent — the 1,000-draw cost on a realistic fixture", () => {
  it("completes 1,000 draws over roughly 40 teams and roughly 60 remaining matches with well-formed marginals, and PRINTS its elapsed time", () => {
    const teamCount = 40;
    const matches: SimMatchInput[] = [];
    const pmf = [0.1, 0.15, 0.2, 0.25, 0.2, 0.1];
    for (let m = 0; m < 60; m++) {
      const red: string[] = [];
      const blue: string[] = [];
      for (let slot = 0; slot < 3; slot++) {
        red.push(teamKey(((m * 6 + slot) % teamCount) + 1));
        blue.push(teamKey(((m * 6 + slot + 3) % teamCount) + 1));
      }
      matches.push({ redTeamKeys: red, blueTeamKeys: blue, redRpPmf: pmf, blueRpPmf: pmf });
    }
    const input = inputFor(teamCount, { remainingMatches: matches });
    const draws = 1_000;

    const startedAt = performance.now();
    const result = simulateDistrictEvent(input, draws, 2026);
    const elapsedMs = performance.now() - startedAt;

    // NO MILLISECOND BAR IS ASSERTED. Project memory
    // `project_worker_cputime_not_reproducible` records roughly 5 ms of
    // run-to-run spread on unchanged code, so an absolute bound would
    // manufacture a flake while proving nothing. The figure is RECORDED in
    // 10-04-SUMMARY.md, because 10-07 needs it to decide whether a district's
    // two events fit inside a frame budget.
    // eslint-disable-next-line no-console
    console.log(
      `[10-04 cost] ${draws} draws, ${teamCount} teams, ${matches.length} remaining matches, 8 alliances, all stages open: ${elapsedMs.toFixed(1)} ms`
    );

    for (const baseline of input.baselines) {
      expect(result.eventTotal.get(baseline.teamKey)!.reduce((sum, v) => sum + v, 0)).toBe(draws);
      expect(result.qualPoints.get(baseline.teamKey)!.reduce((sum, v) => sum + v, 0)).toBe(draws);
    }
    expect(Number.isFinite(elapsedMs)).toBe(true);
  });
});

describe("simulateDistrictEvent — a known-stage value is a histogram index, so it is validated", () => {
  // The reviewer's reproduction, verbatim: a 24-team district-tier event whose
  // known AWARD value for one team is 20 against a district award ceiling of
  // 15. Before `InvalidKnownPointsError` the accumulator wrote
  // `awardByIndex[i][20] += 1` on every draw into an `Int32Array(16)` — a
  // SILENT no-op — so the award histogram lost all 100 draws while the event
  // total kept them, and `chanceOfAnyPoints` then read `1 - 0/100` and reported
  // a confident 100% chance of earning award points.
  const ceilings = maxEventPoints(SEASON, TIER);

  function knownStageInput(overrides: Partial<DistrictLedgerEventInput>): DistrictLedgerEventInput {
    return inputFor(24, {
      remainingMatches: [],
      knownAlliances: suppliedAlliances(),
      awardProfiles: new Map<string, DistrictAwardProfile>(),
      ...overrides,
    });
  }

  it("the district award ceiling this case is measured against is 15", () => {
    expect(ceilings.award).toBe(15);
  });

  it("throws InvalidKnownPointsError for a known award value of 20 against a ceiling of 15, naming the team and the value", () => {
    const input = knownStageInput({
      knownElimPoints: new Map<string, number>(),
      knownAwardPoints: new Map<string, number>([[teamKey(3), 20]]),
    });

    try {
      simulateDistrictEvent(input, 100, 7);
      expect.fail("expected InvalidKnownPointsError");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidKnownPointsError);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain(teamKey(3));
      expect(message).toContain("20");
      expect(message).toContain("15");
      expect(message).toContain("award");
    }
  });

  it("names EVERY offender rather than the first, and passes a value exactly at the ceiling", () => {
    const input = knownStageInput({
      knownElimPoints: new Map<string, number>(),
      knownAwardPoints: new Map<string, number>([
        [teamKey(1), 15],
        [teamKey(2), 16],
        [teamKey(3), -1],
        [teamKey(4), 7.5],
      ]),
    });

    try {
      simulateDistrictEvent(input, 10, 7);
      expect.fail("expected InvalidKnownPointsError");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain(`${teamKey(2)}=16`);
      expect(message).toContain(`${teamKey(3)}=-1`);
      expect(message).toContain(`${teamKey(4)}=7.5`);
      expect(message).not.toContain(`${teamKey(1)}=15`);
      expect(message).toContain("3 known award value(s)");
    }
  });

  it("applies the same refusal to known ELIM points against the elim ceiling", () => {
    const input = knownStageInput({
      knownElimPoints: new Map<string, number>([[teamKey(2), ceilings.elim + 1]]),
    });

    expect(() => simulateDistrictEvent(input, 10, 7)).toThrow(InvalidKnownPointsError);
  });

  it("the publish boundary and the live path now agree: the same input throws on both", () => {
    // `encodeDistrictPointPmf` already threw `EmptyHistogramError` on the
    // histogram this input used to produce. Both halves refuse it now.
    const input = knownStageInput({
      knownElimPoints: new Map<string, number>(),
      knownAwardPoints: new Map<string, number>([[teamKey(3), 20]]),
    });
    expect(() => simulateDistrictEvent(input, 100, 7)).toThrow(InvalidKnownPointsError);
    expect(() => encodeDistrictPointPmf(new Int32Array(16), 100)).toThrow(EmptyHistogramError);
  });

  it("an IN-range known award value still keeps every draw, so the refusal is not merely blanket", () => {
    const draws = 100;
    const input = knownStageInput({
      knownElimPoints: new Map<string, number>(),
      knownAwardPoints: new Map<string, number>([[teamKey(3), 15]]),
    });

    const result = simulateDistrictEvent(input, draws, 7);
    const award = result.awardPoints.get(teamKey(3))!;
    expect(award.reduce((sum, v) => sum + v, 0)).toBe(draws);
    expect(award[15]).toBe(draws);
    // And the number the broken path used to print is now honest: every draw
    // earned points, so the chance really is 1.
    expect(chanceOfAnyPoints(award, draws)).toBe(1);
  });

  it("chanceOfAnyPoints can no longer report 1.0 from an empty histogram", () => {
    // The exact shape the dropped-mass bug produced: an `Int32Array(16)` with
    // 100 draws' worth of denominator and nothing in it.
    expect(() => chanceOfAnyPoints(new Int32Array(16), 100)).toThrow(EmptyDistributionError);
    expect(() => pointCellSummary(new Int32Array(16), 100)).toThrow(EmptyDistributionError);
  });
});

// ---------------------------------------------------------------------------
// The award ORDERING layer (quick task 260925-qhh)
// ---------------------------------------------------------------------------

/**
 * Profiles that CARRY the ordering key, with team 1 the most decorated and the
 * decoration falling by team number. Team `n` holds `teamCount - n` prior judged
 * awards, so the field's most-decorated ordering is exactly team 1 through team
 * `teamCount` and every position is hand-derivable.
 */
function profilesWithCounts(teamCount: number, rookieState: "rookie" | "veteran" = "veteran"): Map<string, DistrictAwardProfile> {
  const out = new Map<string, DistrictAwardProfile>();
  for (let i = 1; i <= teamCount; i++) {
    const priorJudgedAwards = rookieState === "rookie" ? 0 : teamCount - i;
    out.set(teamKey(i), {
      bucket: priorJudgedAwards === 0 ? "none" : priorJudgedAwards <= 2 ? "one-or-two" : "three-or-more",
      rookieState,
      priorJudgedAwards,
    });
  }
  return out;
}

describe("the award ordering layer — the assignment", () => {
  it("prices the MOST DECORATED team in the field at the table's position-1 value, exactly", () => {
    const assignments = awardOrderingAssignments(SEASON, baselinesFor(30), profilesWithCounts(30))!;
    expect(assignments).toBeDefined();
    // Team 1 holds the most prior judged awards, so it is position 1.
    expect(assignments[0]!.teamKey).toBe(teamKey(1));
    expect(assignments[0]!.impactPosition).toBe(1);
    expect(assignments[0]!.impactProbability).toBe(impactOrderingProbability(SEASON, 1).p);
    // And the second most decorated is position 2 — a bucket-averaged price
    // cannot tell these two apart and this layer exists because it should.
    expect(assignments[1]!.impactProbability).toBe(impactOrderingProbability(SEASON, 2).p);
    expect(assignments[0]!.impactProbability).toBeGreaterThan(assignments[1]!.impactProbability);
  });

  it("takes a team past the last named position to the TAIL, and every such team to the same tail", () => {
    const assignments = awardOrderingAssignments(SEASON, baselinesFor(30), profilesWithCounts(30))!;
    const tail = impactOrderingProbability(SEASON, MAX_IMPACT_POSITION + 1);
    expect(tail.source).toBe("tail");
    for (let i = MAX_IMPACT_POSITION; i < 30; i++) {
      expect(assignments[i]!.impactPosition).toBe(i + 1);
      expect(assignments[i]!.impactProbability).toBe(tail.p);
    }
  });

  it("prices a ROOKIE from the rookie table, by its position among the rookies and never among the whole field", () => {
    const profiles = profilesWithCounts(30);
    // Teams 20 and 25 are the field's only rookies. Both hold zero prior judged
    // awards, so the rookie ordering is ascending team number: 20 then 25.
    profiles.set(teamKey(20), { bucket: "none", rookieState: "rookie", priorJudgedAwards: 0 });
    profiles.set(teamKey(25), { bucket: "none", rookieState: "rookie", priorJudgedAwards: 0 });
    const assignments = awardOrderingAssignments(SEASON, baselinesFor(30), profiles)!;
    const first = assignments.find((a) => a.teamKey === teamKey(20))!;
    const second = assignments.find((a) => a.teamKey === teamKey(25))!;
    expect(first.rookieAllStarPosition).toBe(1);
    expect(second.rookieAllStarPosition).toBe(2);
    expect(first.rookieAllStarProbability).toBe(rookieAllStarOrderingProbability(SEASON, 1).p);
    expect(second.rookieAllStarProbability).toBe(rookieAllStarOrderingProbability(SEASON, 2).p);
    // Their positions in the ROOKIE block are 1 and 2 even though they sit deep
    // in the whole field's ordering — the two orderings are separate.
    expect(first.impactPosition).toBeGreaterThan(2);
  });

  it("gives a NON-rookie a Rookie All Star chance of exactly zero, and no position at all", () => {
    const assignments = awardOrderingAssignments(SEASON, baselinesFor(30), profilesWithCounts(30))!;
    for (const assignment of assignments) {
      expect(assignment.rookieAllStarPosition).toBe(0);
      expect(assignment.rookieAllStarProbability).toBe(0);
    }
  });

  it("draws the remaining judged awards from the RESIDUAL table, never from the unreduced base rate", () => {
    const assignments = awardOrderingAssignments(SEASON, baselinesFor(30), profilesWithCounts(30))!;
    const decorated = assignments[0]!;
    const profile = profilesWithCounts(30).get(teamKey(1))!;
    expect(decorated.residualPmf).toEqual(awardResidualRate(SEASON, profile.bucket, profile.rookieState).pmf);
    // Drawing from the base rate here and ALSO drawing Impact is the double
    // count the residual exists to prevent, so the two must differ.
    expect(decorated.residualPmf).not.toEqual(awardBaseRate(SEASON, profile.bucket, profile.rookieState).pmf);
  });

  it("refuses the whole field when ANY team lacks the count, and when the season has no table", () => {
    const partial = profilesWithCounts(30);
    partial.set(teamKey(7), { bucket: "none", rookieState: "veteran" });
    expect(awardOrderingAssignments(SEASON, baselinesFor(30), partial)).toBeUndefined();
    // A team treated as undecorated because its count was missing would sort to
    // the BOTTOM of the field and be priced at the tail — a confident wrong
    // number, which is why one absence takes the whole event back.
    expect(hasAwardOrderingTables(2018)).toBe(false);
    expect(awardOrderingAssignments(2018, baselinesFor(30), profilesWithCounts(30))).toBeUndefined();
  });

  it("takes the HIGHEST SINGLE AWARD of a draw and never the sum of two", () => {
    expect(singleAwardPoints(false, false, 0)).toBe(0);
    expect(singleAwardPoints(false, false, 5)).toBe(5);
    expect(singleAwardPoints(true, false, 0)).toBe(IMPACT_AWARD_POINTS);
    expect(singleAwardPoints(false, true, 0)).toBe(ROOKIE_ALL_STAR_AWARD_POINTS);
    // The pair, which the corpus allows and the site never predicts: Impact wins.
    expect(singleAwardPoints(true, true, 5)).toBe(IMPACT_AWARD_POINTS);
    // Impact plus a judged award is still Impact, not 15.
    expect(singleAwardPoints(true, false, 5)).toBe(IMPACT_AWARD_POINTS);
    // Rookie All Star plus a judged award is still Rookie All Star, not 13.
    expect(singleAwardPoints(false, true, 5)).toBe(ROOKIE_ALL_STAR_AWARD_POINTS);
    // A residual that is ITSELF a stack folds too.
    expect(singleAwardPoints(false, false, 13)).toBe(ROOKIE_ALL_STAR_AWARD_POINTS);
    expect(singleAwardPoints(false, false, 15)).toBe(IMPACT_AWARD_POINTS);
    // Nothing it returns is ever above the highest single award.
    for (const residual of AWARD_POINT_SUPPORT) {
      for (const impact of [false, true]) {
        for (const rookie of [false, true]) {
          expect(singleAwardPoints(impact, rookie, residual)).toBeLessThanOrEqual(SINGLE_AWARD_POINT_CEILING);
        }
      }
    }
  });
});

describe("the award ordering layer — the draw", () => {
  const draws = 2000;

  it("reports which pricing it used rather than leaving a caller to infer it from the numbers", () => {
    const ordered = simulateDistrictEvent(inputFor(30, { awardProfiles: profilesWithCounts(30) }), 20, 5);
    expect(ordered.awardOrdering).toBe("applied");

    const withoutCounts = simulateDistrictEvent(inputFor(30), 20, 5);
    expect(withoutCounts.awardOrdering).toBe("incomplete-profiles");

    const posted = simulateDistrictEvent(
      inputFor(30, { knownAwardPoints: new Map([[teamKey(1), 5]]), awardProfiles: new Map<string, DistrictAwardProfile>() }),
      20,
      5
    );
    expect(posted.awardOrdering).toBe("posted");
  });

  it("falls back to the base-rate path BIT-IDENTICALLY when one team's count is missing", () => {
    // The SAME buckets in both runs, so the only difference is the presence of
    // the ordering key. Comparing against a differently-bucketed fixture would
    // compare two base rates and prove nothing about the fallback.
    const stripped = new Map(
      [...profilesWithCounts(30)].map(([key, profile]) => [key, { bucket: profile.bucket, rookieState: profile.rookieState }] as const)
    );
    // Every count absent (every artifact published before the field existed)...
    const allMissing = simulateDistrictEvent(inputFor(30, { awardProfiles: stripped }), draws, 11);
    // ...and exactly one absent among twenty-nine present.
    const oneMissing = profilesWithCounts(30);
    oneMissing.set(teamKey(13), { bucket: stripped.get(teamKey(13))!.bucket, rookieState: "veteran" });
    const partial = simulateDistrictEvent(inputFor(30, { awardProfiles: oneMissing }), draws, 11);

    // Not "close": the same histogram, integer for integer, for every team. A
    // single missing count must leave the event priced exactly as it was before
    // the ordering existed.
    for (const baseline of baselinesFor(30)) {
      expect([...partial.awardPoints.get(baseline.teamKey)!], baseline.teamKey).toEqual([
        ...allMissing.awardPoints.get(baseline.teamKey)!,
      ]);
    }
    expect(partial.awardOrdering).toBe("incomplete-profiles");
  });

  it("changes the award marginal when it applies — a layer that changed nothing would pass every other test here", () => {
    const base = simulateDistrictEvent(inputFor(30), draws, 11);
    const ordered = simulateDistrictEvent(inputFor(30, { awardProfiles: profilesWithCounts(30) }), draws, 11);
    expect([...ordered.awardPoints.get(teamKey(1))!]).not.toEqual([...base.awardPoints.get(teamKey(1))!]);
    // The most decorated team gets MORE award mass than the bucket average gave
    // it, which is the whole point of the layer.
    const anyPoints = (histogram: Int32Array): number => 1 - histogram[0]! / draws;
    expect(anyPoints(ordered.awardPoints.get(teamKey(1))!)).toBeGreaterThan(anyPoints(base.awardPoints.get(teamKey(1))!));
  });

  it("keeps every team's award histogram a complete distribution, and puts NO mass above the highest single award", () => {
    // A rookie field is the case that used to overflow: Impact at 10, Rookie All
    // Star at 8 and a residual of 5 or 10 SUMMED to 23 or 28 against a district
    // ceiling of 15, and the clamp existed to keep the out-of-range write from
    // silently no-opping. Since 260925-uf8 the draw takes the HIGHEST SINGLE
    // AWARD instead, so the clamp is unreachable and the real property is the
    // stronger one: no mass at all above Impact's own 10. A team whose mass went
    // missing is still exactly what a broken write looks like, so the
    // complete-distribution assertion stays.
    const rookies = profilesWithCounts(30, "rookie");
    const result = simulateDistrictEvent(inputFor(30, { awardProfiles: rookies }), draws, 7);
    expect(result.awardOrdering).toBe("applied");
    const ceiling = maxEventPoints(SEASON, TIER).award;
    for (const baseline of baselinesFor(30)) {
      const histogram = result.awardPoints.get(baseline.teamKey)!;
      let total = 0;
      for (const count of histogram) total += count;
      expect(total, baseline.teamKey).toBe(draws);
      expect(histogram.length).toBe(ceiling + 1);
      for (let points = SINGLE_AWARD_POINT_CEILING + 1; points <= ceiling; points++) {
        expect(histogram[points], `${baseline.teamKey} at ${String(points)} points`).toBe(0);
      }
    }
    // And Impact's own bin carries mass, so the fold has something to fold ONTO
    // and the assertion above is not vacuous.
    const impactBin = [...baselinesFor(30)].reduce((sum, b) => sum + result.awardPoints.get(b.teamKey)![SINGLE_AWARD_POINT_CEILING]!, 0);
    expect(impactBin).toBeGreaterThan(0);
  });

  it("produces an award pmf that sums to one and that encodeDistrictPointPmf accepts", () => {
    const result = simulateDistrictEvent(inputFor(30, { awardProfiles: profilesWithCounts(30) }), draws, 3);
    for (const baseline of baselinesFor(30)) {
      const encoded = encodeDistrictPointPmf(result.awardPoints.get(baseline.teamKey)!, draws);
      const sum = encoded.p.reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1), baseline.teamKey).toBeLessThan(1e-9);
      expect(encoded.offset).toBeGreaterThanOrEqual(0);
    }
  });

  it("reports the RESIDUAL table's fallback rung, because that is the table the points came from", () => {
    const result = simulateDistrictEvent(inputFor(30, { awardProfiles: profilesWithCounts(30) }), 20, 3);
    const profile = profilesWithCounts(30).get(teamKey(1))!;
    expect(result.awardSources.get(teamKey(1))).toBe(awardResidualRate(SEASON, profile.bucket, profile.rookieState).source);
  });

  it("is deterministic at one seed, and consumes exactly one more ledger value per team than the base-rate path", () => {
    const input = inputFor(30, { awardProfiles: profilesWithCounts(30) });
    const consumed = (i: DistrictLedgerEventInput, runs: number): number => {
      let total = 0;
      simulateDistrictEvent(i, runs, 42, (observation) => {
        total += observation.ledgerDraws;
      });
      return total;
    };
    expect(consumed(input, 5)).toBe(consumed(input, 5));

    // Scored on ONE draw, deliberately. The bracket runs BEFORE the awards and
    // its finals are best-of-three, so from draw two onward the extra award
    // consumption shifts the stream and the bracket's own consumption stops
    // being comparable. On draw one both runs enter the award step at the same
    // stream position, so the difference is exactly the award step's.
    //
    // TWO consumptions per team on the ordering path (Impact, then the
    // residual) against the base-rate path's ONE, so exactly one more per team.
    // Not two more: a veteran cannot win Rookie All Star, so no randomness is
    // consumed for it at all.
    expect(consumed(input, 1) - consumed(inputFor(30), 1)).toBe(1 * 30);
  });
});

// ---------------------------------------------------------------------------
// The partially-played bracket (quick task 260925-uf8)
// ---------------------------------------------------------------------------

describe("simulateDistrictEvent — the playoffs already under way", () => {
  /** `suppliedAlliances()`' own alliance `n`, as a set of team keys. */
  const rosterOf = (allianceNumber: number): Set<string> => new Set(suppliedAlliances()[allianceNumber - 1]!.picks);

  /** The played rows that put alliance 1 through sf1 and sf7, so it has reached sf11 and secured a top-four finish. */
  const throughUpperRoundTwo: readonly PlayedBracketMatch[] = [
    { compLevel: "sf", setNumber: 1, matchNumber: 1, winningAllianceNumber: 1 },
    { compLevel: "sf", setNumber: 2, matchNumber: 1, winningAllianceNumber: 4 },
    { compLevel: "sf", setNumber: 7, matchNumber: 1, winningAllianceNumber: 1 },
  ];

  it("returns the played winner for a decided set and consumes NO randomness for it", () => {
    const base = inputFor(30, { knownAlliances: suppliedAlliances(), remainingMatches: [] });
    const conditioned = { ...base, playedElimMatches: throughUpperRoundTwo };
    const consumed = (input: DistrictLedgerEventInput): number => {
      let total = 0;
      simulateDistrictEvent(input, 1, 7, (observation) => {
        total += observation.ledgerDraws;
      });
      return total;
    };
    // Three fewer bracket draws on the first draw, one per played match.
    expect(consumed(base) - consumed(conditioned)).toBe(3);
  });

  it("gives alliance 1 a top-four finish in EVERY draw once it has won sf7, whatever the pricer says", () => {
    // The ratings are a permutation of the ranking, so alliance 1 is not
    // favoured by construction — the guarantee comes from the played rows.
    const input = inputFor(30, {
      knownAlliances: suppliedAlliances(),
      remainingMatches: [],
      playedElimMatches: throughUpperRoundTwo,
    });
    const result = simulateDistrictEvent(input, 500, 31337);
    const fourthPlacePoints = 7;
    for (const teamKeyOnAlliance of rosterOf(1)) {
      const histogram = result.elimPoints.get(teamKeyOnAlliance)!;
      // No mass below fourth place's own point value.
      for (let points = 0; points < fourthPlacePoints; points++) {
        expect(histogram[points], `${teamKeyOnAlliance} at ${String(points)} points`).toBe(0);
      }
    }
  });

  it("reports the milestone per TEAM, from the alliance it actually sits on", () => {
    const input = inputFor(30, {
      knownAlliances: suppliedAlliances(),
      remainingMatches: [],
      playedElimMatches: throughUpperRoundTwo,
    });
    const result = simulateDistrictEvent(input, 10, 1);
    for (const key of rosterOf(1)) expect(result.playoffMilestones.get(key)).toEqual({ kind: "topFour" });
    // Alliance 2's sf3 has not been played, so it is still alive and nothing is
    // secured; alliance 5 lost sf2 and is not secured either.
    for (const key of rosterOf(2)) expect(result.playoffMilestones.get(key)).toEqual({ kind: "alive" });
    for (const key of rosterOf(5)) expect(result.playoffMilestones.get(key)).toEqual({ kind: "alive" });
  });

  it("reports NO milestone when the draft is simulated, because a team's alliance changes every draw", () => {
    const input = inputFor(30, { remainingMatches: [], playedElimMatches: throughUpperRoundTwo });
    const result = simulateDistrictEvent(input, 10, 1);
    expect(result.playoffMilestones.size).toBe(0);
  });

  it("reports NO milestone and consults nothing when the playoffs are already done", () => {
    const knownElimPoints = new Map<string, number>([[teamKey(1), 30]]);
    const input = inputFor(30, {
      knownAlliances: suppliedAlliances(),
      remainingMatches: [],
      knownElimPoints,
      playedElimMatches: throughUpperRoundTwo,
    });
    const result = simulateDistrictEvent(input, 10, 1);
    expect(result.playoffMilestones.size).toBe(0);
    expect(result.elimPoints.get(teamKey(1))![30]).toBe(10);
  });

  it("refuses a mis-mapped played match BEFORE any draw rather than routing it", () => {
    const input = inputFor(30, {
      knownAlliances: suppliedAlliances(),
      remainingMatches: [],
      // sf1 is seed 1 against seed 8; alliance 3 was never in it.
      playedElimMatches: [{ compLevel: "sf", setNumber: 1, matchNumber: 1, winningAllianceNumber: 3 }],
    });
    expect(() => simulateDistrictEvent(input, 10, 1)).toThrow(InvalidBracketDecisionError);
  });

  it("leaves an empty played set exactly where it was: every alliance alive, and the same seeded output", () => {
    const base = inputFor(30, { knownAlliances: suppliedAlliances(), remainingMatches: [] });
    const withEmpty = simulateDistrictEvent({ ...base, playedElimMatches: [] }, 50, 99);
    const without = simulateDistrictEvent(base, 50, 99);
    for (const baseline of base.baselines) {
      expect([...withEmpty.elimPoints.get(baseline.teamKey)!]).toEqual([...without.elimPoints.get(baseline.teamKey)!]);
    }
    for (const key of rosterOf(1)) expect(withEmpty.playoffMilestones.get(key)).toEqual({ kind: "alive" });
  });

  it("ignores a played set for a divisioned parent, which draws from the measured fallback and has no bracket", () => {
    const input = inputFor(30, {
      allianceCount: 4,
      tier: "dcmp",
      remainingMatches: [],
      playedElimMatches: throughUpperRoundTwo,
    });
    const result = simulateDistrictEvent(input, 10, 1);
    expect(result.playoffMilestones.size).toBe(0);
  });
});
