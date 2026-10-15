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
import { IMPACT_AWARD_POINTS, ROOKIE_ALL_STAR_AWARD_POINTS, SINGLE_AWARD_POINT_CEILING } from "./awardOrderingTables.js";
import {
  BRACKET_SETS,
  divisionedDcmpPlayoffPmf,
  InvalidBracketDecisionError,
  PLAYOFF_PLACEMENT_POINTS,
  playoffPoints,
  UnsupportedAllianceCountError,
  UnsupportedBracketSeasonError,
  type PlayedBracketMatch,
} from "./bracket.js";
import {
  AlliancePricingError,
  convolveDistrictGrandTotal,
  decideBracketMatch,
  draftedAllianceCount,
  EmptyHistogramError,
  encodeDistrictPointPmf,
  InsufficientRosterError,
  InvalidAllianceSetError,
  InvalidAwardOnlyTeamsError,
  InvalidFieldSizeError,
  InvalidKnownPointsError,
  MissingAwardProfileError,
  NegativeDistrictShiftError,
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
import { districtQualPoints, districtTierWeight } from "./qualPoints.js";
import { districtSelectionPoints } from "./selectionPoints.js";
import type { AllianceMemberRating } from "../algorithms/simulation/allianceWinProbability.js";
import { eventAwardOutcomeOdds } from "./ledgerSimulation.js";
import { DcmpAwardSlateOnDistrictTierError, MissingAwardSlateError } from "./ledgerSimulation.js";
import { DistrictAwardSlateOnDcmpTierError } from "./ledgerSimulation.js";
import type { DcmpAwardSlateInput } from "./dcmpAwardSlate.js";
import { buildDistrictAwardSlate, hasAwardSlateTables, slateAssignments, slateAwardOutcomeOdds, slateLift, awardSlateTables, type AwardSlateInput } from "./awardSlate.js";
import { InvalidPickPositionPmfError, LEDGER_STREAM_SALT, PICK_STREAM_SALT, type PickPositionPmf } from "./ledgerSimulation.js";

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

/**
 * The district slate a district tier fixture carries by default (quick task
 * 261014-qje, Q-01): the season's measured counts over the award field (the
 * baselines, then any award only teams), every team allowed every award. A
 * district tier event whose awards are open refuses to run without a slate
 * (`MissingAwardSlateError`), so every district tier fixture carries one.
 */
function defaultDistrictSlate(season: number, keys: readonly string[]): AwardSlateInput {
  return buildDistrictAwardSlate({ season, awardField: keys.map((key) => ({ teamKey: key })), eligibility: [] });
}

function inputFor(
  teamCount: number,
  overrides: Partial<DistrictLedgerEventInput> = {}
): DistrictLedgerEventInput {
  const input: DistrictLedgerEventInput = {
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
  // Q-01: the default district slate, only where the caller set none and the
  // season has tables. An explicit `awardSlate: undefined` keeps it off.
  if (input.tier !== "district" || "awardSlate" in overrides || !hasAwardSlateTables(input.season, "district")) return input;
  return { ...input, awardSlate: defaultDistrictSlate(input.season, [...input.baselines.map((baseline) => baseline.teamKey), ...(input.awardOnlyTeams ?? [])]) };
}

/**
 * A DCMP award slate with no eligible team and the 2026 single judged anchor,
 * for the dcmp tier tests that are about the bracket, the draft or the
 * ceilings rather than awards: a dcmp tier run with open awards refuses to
 * run without a slate since quick task 261014-i8i (`MissingAwardSlateError` since 261014-qje).
 */
const NO_ELIGIBLE_DCMP_SLATE: DcmpAwardSlateInput = {
  role: "single",
  // Q-08 (quick task 261014-qje): five slot counts; no rookie only 5 point award here.
  expected: { impact: 0, engineeringInspiration: 0, rookieAllStar: 0, judgedRookie: 0, judged: 12 },
  sources: { counts: "previousSeason", judged: "role" },
  eligibility: [],
};

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
    // A dcmp tier run needs a DCMP award slate since 261014-i8i; the district run is unchanged.
    const input = inputFor(teamCount, { tier, ...(tier === "dcmp" ? { awardSlate: NO_ELIGIBLE_DCMP_SLATE } : {}) });
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

describe("simulateDistrictEvent — the award draw (the one award slate, quick task 261014-qje)", () => {
  it("the tallied award histogram matches the slate's exact odds within 4 standard errors at 20,000 draws", () => {
    const input = inputFor(24, { remainingMatches: [] });
    const draws = 20_000;
    const result = simulateDistrictEvent(input, draws, 2024);
    expect(result.awardOrdering).toBe("district-slate");
    const odds = eventAwardOutcomeOdds({ eventKey: input.eventKey, season: SEASON, tier: TIER, awardField: input.baselines, awardProfiles: input.awardProfiles, awardSlate: input.awardSlate! });
    const weight = districtTierWeight(SEASON, TIER);
    for (const baseline of input.baselines) {
      const histogram = result.awardPoints.get(baseline.teamKey)!;
      const team = odds.get(baseline.teamKey)!;
      for (const [points, p] of [
        [10, team.p10],
        [8, team.p8],
        [5, team.p5],
        [0, team.p0],
      ] as const) {
        const se = Math.sqrt(Math.max(p * (1 - p), 1e-12) / draws);
        expect(Math.abs((histogram[points * weight] ?? 0) / draws - p), `${baseline.teamKey} at ${String(points)}`).toBeLessThanOrEqual(4 * se + 1e-12);
      }
    }
  });

  it("puts NO mass on a stack: only 0, 5, 8 and 10 points ever carry mass", () => {
    const input = inputFor(24, { remainingMatches: [] });
    const draws = 5_000;
    const result = simulateDistrictEvent(input, draws, 2024);
    const weight = districtTierWeight(SEASON, TIER);
    const allowed = new Set([0, 5, 8, 10].map((points) => points * weight));
    for (const baseline of input.baselines) {
      const histogram = result.awardPoints.get(baseline.teamKey)!;
      histogram.forEach((count, points) => {
        if (!allowed.has(points)) expect(count, `${baseline.teamKey} at ${String(points)} points`).toBe(0);
      });
    }
  });

  it("carries each team's judged slot lift rung: lift 1 for a field whose profiles lack the counts", () => {
    const input = inputFor(24, { remainingMatches: [] });
    const result = simulateDistrictEvent(input, 10, 1);
    for (const baseline of input.baselines) expect(result.awardSources.get(baseline.teamKey)).toBe("season-pooled");
  });

  it("a field with every count reports the rung its class landed on, the slate's own lookup", () => {
    const profiles = profilesWithCounts(24);
    const input = inputFor(24, { remainingMatches: [], awardProfiles: profiles });
    const result = simulateDistrictEvent(input, 10, 1);
    const tables = awardSlateTables(SEASON, "district");
    for (const baseline of input.baselines) {
      const profile = profiles.get(baseline.teamKey)!;
      const expected = slateLift(tables, "judged", { priorJudgedAwards: profile.priorJudgedAwards!, priorImpactWins: profile.priorImpactWins!, rookieState: profile.rookieState }).source;
      expect(result.awardSources.get(baseline.teamKey)).toBe(expected);
    }
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

  // Rewritten by quick task 261007-4qr: a 23-team roster now prices under the
  // short-roster rule (whole filler alliances at the bottom seeds), so the two
  // refusals that remain are fewer teams than alliances, and a short roster at
  // an alliance count the eight-alliance bracket does not route.
  it("InsufficientRosterError when the roster holds fewer teams than alliances", () => {
    const input = inputFor(7, { remainingMatches: [] });
    expect(() => simulateDistrictEvent(input, 10, 1)).toThrow(InsufficientRosterError);
  });

  it("InsufficientRosterError when a non-eight alliance count cannot be filled with three-team alliances", () => {
    const input = inputFor(11, { allianceCount: 4, remainingMatches: [] });
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
      // A NON-DEMO absent key (quick task 261007-4qr): this case used frc9999,
      // which is a demo key and is now filler by design, not an error. The
      // demo-key case is pinned in the short-roster block below.
      "a pick naming a team absent from the roster",
      (a: SuppliedAlliance[]): SuppliedAlliance[] =>
        a.map((alliance, i) =>
          i === 3 ? { ...alliance, picks: [alliance.picks[0]!, "frc5999", alliance.picks[2]!] } : alliance
        ),
      ["frc5999", "4"],
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
      // A dcmp tier run needs a DCMP award slate since 261014-i8i; this test is about the bracket.
      const input = inputFor(24, { allianceCount, tier: "dcmp", remainingMatches: [], awardSlate: NO_ELIGIBLE_DCMP_SLATE });
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
    // A dcmp tier run needs a DCMP award slate since 261014-i8i; this test is about the draft.
    const input = inputFor(24, { allianceCount: 4, tier: "dcmp", remainingMatches: [], awardSlate: NO_ELIGIBLE_DCMP_SLATE });
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
 * Profiles that CARRY both ordering keys, with team 1 the most decorated and
 * the decoration falling by team number. Team `n` holds `teamCount - n` prior
 * judged awards and NO prior Impact win, so the Impact ordering falls through
 * to decoration and is exactly team 1 through team `teamCount`, and every
 * position is hand-derivable.
 */
function profilesWithCounts(teamCount: number, rookieState: "rookie" | "veteran" = "veteran"): Map<string, DistrictAwardProfile> {
  const out = new Map<string, DistrictAwardProfile>();
  for (let i = 1; i <= teamCount; i++) {
    const priorJudgedAwards = rookieState === "rookie" ? 0 : teamCount - i;
    out.set(teamKey(i), {
      bucket: priorJudgedAwards === 0 ? "none" : priorJudgedAwards <= 2 ? "one-or-two" : "three-or-more",
      rookieState,
      priorJudgedAwards,
      priorImpactWins: 0,
    });
  }
  return out;
}

describe("the award slate draw — dispositions, completeness and the stream (quick task 261014-qje)", () => {
  const draws = 2000;

  it("reports which pricing it used rather than leaving a caller to infer it from the numbers", () => {
    expect(simulateDistrictEvent(inputFor(30, { awardProfiles: profilesWithCounts(30) }), 20, 5).awardOrdering).toBe("district-slate");
    expect(simulateDistrictEvent(inputFor(30), 20, 5).awardOrdering).toBe("district-slate");
    const posted = simulateDistrictEvent(
      inputFor(30, { knownAwardPoints: new Map([[teamKey(1), 5]]), awardProfiles: new Map<string, DistrictAwardProfile>() }),
      20,
      5
    );
    expect(posted.awardOrdering).toBe("posted");
  });

  it("refuses a district tier event with open awards and no slate before any draw, in the draw and in the odds", () => {
    const missing = inputFor(30, { awardSlate: undefined });
    let observed = 0;
    expect(() => simulateDistrictEvent(missing, 10, 1, () => observed++)).toThrow(MissingAwardSlateError);
    expect(observed).toBe(0);
    expect(() => eventAwardOutcomeOdds({ eventKey: missing.eventKey, season: SEASON, tier: TIER, awardField: missing.baselines, awardProfiles: missing.awardProfiles })).toThrow(
      MissingAwardSlateError
    );
  });

  it("keeps every team's award histogram a complete distribution, and puts NO mass above the highest single award", () => {
    const rookies = profilesWithCounts(30, "rookie");
    const result = simulateDistrictEvent(inputFor(30, { awardProfiles: rookies }), draws, 7);
    expect(result.awardOrdering).toBe("district-slate");
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

  it("is deterministic at one seed, and consumes no randomness for a chance that is exactly zero", () => {
    const input = inputFor(30, { awardProfiles: profilesWithCounts(30) });
    const consumed = (i: DistrictLedgerEventInput, runs: number): number => {
      let total = 0;
      simulateDistrictEvent(i, runs, 42, (observation) => {
        total += observation.ledgerDraws;
      });
      return total;
    };
    expect(consumed(input, 5)).toBe(consumed(input, 5));
    // Scored on ONE draw: the bracket runs before the awards, so from draw two
    // on a different award consumption shifts the bracket's own. A veteran
    // field: Impact, the 8 point award and the judged award each carry a
    // positive chance for every team, three consumptions per team; taking the
    // judged slot away (count 0) takes exactly one consumption per team away.
    const noJudged: AwardSlateInput = { ...input.awardSlate!, expected: { ...input.awardSlate!.expected, judged: 0, judgedRookie: 0 } };
    expect(consumed(input, 1) - consumed({ ...input, awardSlate: noJudged }, 1)).toBe(30);
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

  it("reads a final whose first match was tied through the replay rows, so both finalists are a point mass (quick task 261009-tx8, B4)", () => {
    // The whole bracket by the higher seed, so the final is alliance 1 against
    // alliance 2: sf11 to alliance 1, and alliance 2 back through sf13.
    const sfWinners: readonly number[] = [1, 4, 2, 3, 5, 6, 1, 2, 4, 3, 1, 3, 2];
    const playedElimMatches: PlayedBracketMatch[] = sfWinners.map((winningAllianceNumber, i) => ({
      compLevel: "sf",
      setNumber: i + 1,
      matchNumber: 1,
      winningAllianceNumber,
    }));
    // Final match 1 was a tie and carries no row; the two replays went to
    // alliance 2. Keyed by the original numbers these rows left a gap at 1.
    playedElimMatches.push({ compLevel: "f", setNumber: 1, matchNumber: 2, winningAllianceNumber: 2 });
    playedElimMatches.push({ compLevel: "f", setNumber: 1, matchNumber: 3, winningAllianceNumber: 2 });
    const input = inputFor(30, { knownAlliances: suppliedAlliances(), remainingMatches: [], playedElimMatches });
    const draws = 200;
    const result = simulateDistrictEvent(input, draws, 4242);
    for (const key of rosterOf(2)) {
      expect(result.elimPoints.get(key)![playoffPoints(SEASON, TIER, 1)], `${key} wins in every draw`).toBe(draws);
      expect(result.playoffMilestones.get(key)).toEqual({ kind: "decided", placement: 1 });
    }
    for (const key of rosterOf(1)) {
      expect(result.elimPoints.get(key)![playoffPoints(SEASON, TIER, 2)], `${key} is second in every draw`).toBe(draws);
      expect(result.playoffMilestones.get(key)).toEqual({ kind: "decided", placement: 2 });
    }
  });

  it("ignores a played set for a divisioned parent, which draws from the measured fallback and has no bracket", () => {
    const input = inputFor(30, {
      allianceCount: 4,
      tier: "dcmp",
      remainingMatches: [],
      playedElimMatches: throughUpperRoundTwo,
      // A dcmp tier run needs a DCMP award slate since 261014-i8i; this test is about the bracket.
      awardSlate: NO_ELIGIBLE_DCMP_SLATE,
    });
    const result = simulateDistrictEvent(input, 10, 1);
    expect(result.playoffMilestones.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The selection ROUTES (quick task 260925-w4y)
// ---------------------------------------------------------------------------

describe("simulateDistrictEvent — which route each team took", () => {
  const CAPTAIN = 0;
  const FIRST_PICK = 1;
  const SECOND_PICK = 2;
  const BACKUP = 3;

  /**
   * A fixture whose FINISHING ORDER GENUINELY MOVES between draws, which the
   * module-level one deliberately does not.
   *
   * `baselinesFor` separates every team by a whole ranking point over ten played
   * matches, so the order barely budges and every team takes ONE route in every
   * draw — measured, not assumed: the module-level fixture produces zero teams
   * with two routes. That stability is what makes the hand-derivable
   * expectations above possible, and it is useless for the two cases below,
   * which are about a route and an alliance number the runs DISAGREE on. So this
   * fixture puts every team within one ranking point of the next over two played
   * matches and hands back forty remaining rows.
   */
  const shuffledInput = (teamCount: number): DistrictLedgerEventInput => {
    const tight: SimTeamBaseline[] = [];
    for (let i = 1; i <= teamCount; i++) tight.push({ teamKey: teamKey(i), earnedRpSum: teamCount + 1 - i, matchesPlayed: 2 });
    const pmf = [0.34, 0.33, 0.33];
    const rows: SimMatchInput[] = [];
    for (let m = 0; m < 40; m++) {
      const base = (m * 6) % (teamCount - 6);
      rows.push({
        redTeamKeys: [teamKey(base + 1), teamKey(base + 2), teamKey(base + 3)],
        blueTeamKeys: [teamKey(base + 4), teamKey(base + 5), teamKey(base + 6)],
        redRpPmf: pmf,
        blueRpPmf: pmf,
      });
    }
    return inputFor(teamCount, { baselines: tight, remainingMatches: rows });
  };

  it("accounts for EVERY draw: the four slots plus not selected sum to the draw count, for every team", () => {
    const teamCount = 30;
    const draws = 400;
    const result = simulateDistrictEvent(inputFor(teamCount), draws, 20260925);
    expect(result.selectionRoutes.size).toBe(teamCount);
    for (let i = 1; i <= teamCount; i++) {
      const routes = result.selectionRoutes.get(teamKey(i))!;
      const total = routes.bySlot.reduce((sum, slot) => sum + slot.draws, routes.notSelectedDraws);
      expect(total, `${teamKey(i)} does not account for every draw`).toBe(draws);
    }
  });

  it("agrees EXACTLY with the selection histogram's own chance of any points, for every team", () => {
    // The load-bearing agreement: the drawer's list and the cell's headline are
    // built from these two quantities, so a gap between them is a list that
    // cannot add up.
    const teamCount = 30;
    const draws = 400;
    const result = simulateDistrictEvent(inputFor(teamCount), draws, 4242);
    for (let i = 1; i <= teamCount; i++) {
      const routes = result.selectionRoutes.get(teamKey(i))!;
      const selected = routes.bySlot[CAPTAIN]!.draws + routes.bySlot[FIRST_PICK]!.draws + routes.bySlot[SECOND_PICK]!.draws;
      const fromHistogram = chanceOfAnyPoints(result.selectionPoints.get(teamKey(i))!, draws);
      expect(selected / draws, `${teamKey(i)}`).toBeCloseTo(fromHistogram, 12);
    }
  });

  it("separates a captain from a first pick, which the points histogram CANNOT do", () => {
    // Both earn `17 - allianceNumber`, so the histogram's bin at 16 holds
    // alliance 1's captain and alliance 1's first pick together. The routes tell
    // them apart, which is the whole reason this field exists.
    const result = simulateDistrictEvent(shuffledInput(30), 300, 77);
    const captainPoints = districtSelectionPoints(SEASON, TIER, 0, 1);
    const firstPickPoints = districtSelectionPoints(SEASON, TIER, 1, 1);
    expect(captainPoints).toBe(firstPickPoints);

    let teamsWithBothRoutes = 0;
    for (let i = 1; i <= 30; i++) {
      const routes = result.selectionRoutes.get(teamKey(i))!;
      if (routes.bySlot[CAPTAIN]!.draws > 0 && routes.bySlot[FIRST_PICK]!.draws > 0) teamsWithBothRoutes++;
    }
    expect(teamsWithBothRoutes, "no team took both routes, so this fixture proves nothing").toBeGreaterThan(0);
  });

  it("reports the point range each slot CAN pay from the measured model, at this event's alliance count", () => {
    const routes = simulateDistrictEvent(inputFor(30), 20, 5).selectionRoutes.get(teamKey(1))!;
    // Derived from the measured module rather than retyped, AND pinned as the
    // literal pair the drawer prints.
    const captainValues = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => districtSelectionPoints(SEASON, TIER, 0, n));
    expect(routes.bySlot[CAPTAIN]!.possibleMinPoints).toBe(Math.min(...captainValues));
    expect(routes.bySlot[CAPTAIN]!.possibleMaxPoints).toBe(Math.max(...captainValues));
    expect([routes.bySlot[CAPTAIN]!.possibleMinPoints, routes.bySlot[CAPTAIN]!.possibleMaxPoints]).toEqual([9, 16]);
    expect([routes.bySlot[FIRST_PICK]!.possibleMinPoints, routes.bySlot[FIRST_PICK]!.possibleMaxPoints]).toEqual([9, 16]);
    expect([routes.bySlot[SECOND_PICK]!.possibleMinPoints, routes.bySlot[SECOND_PICK]!.possibleMaxPoints]).toEqual([1, 8]);
    // A backup robot earns nothing at any alliance number.
    expect([routes.bySlot[BACKUP]!.possibleMinPoints, routes.bySlot[BACKUP]!.possibleMaxPoints]).toEqual([0, 0]);
  });

  it("carries the district championship weight into the possible range, from the single weight source", () => {
    // A dcmp tier run needs a DCMP award slate since 261014-i8i; this test is about selection points.
    const routes = simulateDistrictEvent(inputFor(30, { tier: "dcmp", awardSlate: NO_ELIGIBLE_DCMP_SLATE }), 20, 5).selectionRoutes.get(teamKey(1))!;
    expect(routes.bySlot[CAPTAIN]!.possibleMaxPoints).toBe(districtSelectionPoints(SEASON, "dcmp", 0, 1));
    expect(routes.bySlot[CAPTAIN]!.possibleMaxPoints).toBe(16 * 3);
  });

  it("reports `undefined` points and `undefined` alliance for a route no draw took, never a zero", () => {
    // A backup robot is never drafted by the simulated draft, so slot 3 is the
    // route no run can take.
    const routes = simulateDistrictEvent(inputFor(30), 50, 11).selectionRoutes.get(teamKey(1))!;
    expect(routes.bySlot[BACKUP]!.draws).toBe(0);
    expect(routes.bySlot[BACKUP]!.minPoints).toBeUndefined();
    expect(routes.bySlot[BACKUP]!.maxPoints).toBeUndefined();
    expect(routes.bySlot[BACKUP]!.allianceNumber).toBeUndefined();
  });

  it("pins the alliance number where every draw agreed, and leaves it undefined where they disagreed", () => {
    const withMatches = simulateDistrictEvent(shuffledInput(30), 300, 8675309);
    let pinned = 0;
    let mixed = 0;
    for (let i = 1; i <= 30; i++) {
      for (const slot of withMatches.selectionRoutes.get(teamKey(i))!.bySlot) {
        if (slot.draws === 0) continue;
        if (slot.allianceNumber === undefined) mixed++;
        else pinned++;
      }
    }
    expect(pinned).toBeGreaterThan(0);
    expect(mixed, "no route landed on two alliance numbers, so the mixed case is untested here").toBeGreaterThan(0);

    // On the STABLE fixture the top seed is alliance 1's captain in every draw
    // (the correlation proof above asserts that invariant), so its alliance
    // number is pinned to exactly 1 and no draw disagreed.
    const stable = simulateDistrictEvent(inputFor(30), 300, 8675309);
    const topSeed = stable.selectionRoutes.get(teamKey(1))!;
    expect(topSeed.bySlot[CAPTAIN]!.draws).toBe(300);
    expect(topSeed.bySlot[CAPTAIN]!.allianceNumber).toBe(1);
  });

  it("reports a FIXED ranking as fixed, and an open one as not", () => {
    expect(simulateDistrictEvent(inputFor(30, { remainingMatches: [] }), 10, 1).rankingFixed).toBe(true);
    expect(simulateDistrictEvent(inputFor(30), 10, 1).rankingFixed).toBe(false);
  });

  it("collapses every team onto ONE route at ONE alliance number once the ranking is fixed", () => {
    // This is what lets 10-07 print exact captain points with "captain,
    // alliance N" beside them: with no matches left the draft is a fact.
    const draws = 25;
    const result = simulateDistrictEvent(inputFor(30, { remainingMatches: [] }), draws, 999);
    expect(result.rankingFixed).toBe(true);
    let captains = 0;
    for (let i = 1; i <= 30; i++) {
      const routes = result.selectionRoutes.get(teamKey(i))!;
      const taken = routes.bySlot.filter((slot) => slot.draws > 0);
      if (routes.notSelectedDraws === draws) {
        expect(taken).toEqual([]);
        continue;
      }
      expect(taken.length, `${teamKey(i)} took two routes with a fixed ranking`).toBe(1);
      expect(taken[0]!.draws).toBe(draws);
      expect(taken[0]!.minPoints).toBe(taken[0]!.maxPoints);
      expect(taken[0]!.allianceNumber).not.toBeUndefined();
      if (routes.bySlot[CAPTAIN]!.draws === draws) {
        captains++;
        // The captain's exact points follow from its alliance number through the
        // measured module, never from a literal here.
        expect(taken[0]!.minPoints).toBe(districtSelectionPoints(SEASON, TIER, 0, routes.bySlot[CAPTAIN]!.allianceNumber!));
      }
    }
    // Eight alliances, eight captains.
    expect(captains).toBe(8);
  });

  it("reads the routes off the REAL slots when the alliances are known, including a backup robot", () => {
    // A four-pick alliance: TBA's slot 3 is the backup robot, which earns
    // nothing and is NOT the same thing as not being selected.
    const hand = suppliedAlliances();
    const withBackup: SuppliedAlliance[] = hand.map((alliance, index) =>
      index === 0 ? { allianceNumber: 1, picks: [...alliance.picks, teamKey(30)] } : alliance
    );
    const draws = 12;
    const result = simulateDistrictEvent(inputFor(30, { knownAlliances: withBackup, remainingMatches: [] }), draws, 3);
    const captain = result.selectionRoutes.get(hand[0]!.picks[0]!)!;
    expect(captain.bySlot[CAPTAIN]!.draws).toBe(draws);
    expect(captain.bySlot[CAPTAIN]!.allianceNumber).toBe(1);
    expect(captain.bySlot[CAPTAIN]!.minPoints).toBe(districtSelectionPoints(SEASON, TIER, 0, 1));

    const secondPick = result.selectionRoutes.get(hand[3]!.picks[2]!)!;
    expect(secondPick.bySlot[SECOND_PICK]!.draws).toBe(draws);
    expect(secondPick.bySlot[SECOND_PICK]!.allianceNumber).toBe(4);
    expect(secondPick.bySlot[SECOND_PICK]!.minPoints).toBe(districtSelectionPoints(SEASON, TIER, 2, 4));

    const backup = result.selectionRoutes.get(teamKey(30))!;
    expect(backup.bySlot[BACKUP]!.draws).toBe(draws);
    expect(backup.notSelectedDraws).toBe(0);
    expect(backup.bySlot[BACKUP]!.minPoints).toBe(0);
    expect(backup.bySlot[BACKUP]!.allianceNumber).toBe(1);
  });

  it("keeps every point value the selection histogram holds inside a recorded route's own range", () => {
    // Recording the route is pure observation of a DETERMINISTIC draft, so the
    // two views of one draw cannot disagree: every non zero bin of the histogram
    // lies inside the range of a route the same team actually took.
    const result = simulateDistrictEvent(inputFor(30), 100, 61);
    for (let i = 1; i <= 30; i++) {
      const routes = result.selectionRoutes.get(teamKey(i))!;
      const histogram = result.selectionPoints.get(teamKey(i))!;
      let massAboveZero = 0;
      for (let points = 1; points < histogram.length; points++) {
        if (histogram[points] === 0) continue;
        const covered = routes.bySlot.some(
          (slot) =>
            slot.minPoints !== undefined && slot.maxPoints !== undefined && points >= slot.minPoints && points <= slot.maxPoints
        );
        expect(covered, `${teamKey(i)} earned ${String(points)} points on no recorded route`).toBe(true);
        massAboveZero += histogram[points]!;
      }
      expect(histogram[0]! + massAboveZero).toBe(100);
    }
  });
});

// ---------------------------------------------------------------------------
// Award only teams: a registered team missing from the posted schedule
// (quick task 260927-vmb)
// ---------------------------------------------------------------------------

describe("simulateDistrictEvent — award only teams", () => {
  const AWARD_ONLY = "frc9001";

  it("an absent and an empty award only list produce deep equal results, with no awardOnlyTeams member", () => {
    for (const awardProfiles of [profilesFor(30), profilesWithCounts(30)]) {
      const absent = simulateDistrictEvent(inputFor(30, { awardProfiles }), 300, 17);
      const empty = simulateDistrictEvent(inputFor(30, { awardProfiles, awardOnlyTeams: [] }), 300, 17);
      expect(empty).toEqual(absent);
      expect("awardOnlyTeams" in absent).toBe(false);
      expect("awardOnlyTeams" in empty).toBe(false);
    }
  });

  it("draws an award only team's award and nothing else, with its event total equal to its award bin for bin", () => {
    const awardProfiles = profilesWithCounts(30);
    awardProfiles.set(AWARD_ONLY, { bucket: "none", rookieState: "veteran", priorJudgedAwards: 0, priorImpactWins: 0 });
    const draws = 500;
    const result = simulateDistrictEvent(inputFor(30, { awardProfiles, awardOnlyTeams: [AWARD_ONLY] }), draws, 23);

    expect(result.awardOnlyTeams).toEqual([AWARD_ONLY]);
    expect(result.qualPoints.has(AWARD_ONLY)).toBe(false);
    expect(result.selectionPoints.has(AWARD_ONLY)).toBe(false);
    expect(result.elimPoints.has(AWARD_ONLY)).toBe(false);
    expect(result.selectionRoutes.has(AWARD_ONLY)).toBe(false);
    expect(result.awardSources.has(AWARD_ONLY)).toBe(true);

    const award = result.awardPoints.get(AWARD_ONLY)!;
    const total = result.eventTotal.get(AWARD_ONLY)!;
    expect(award.reduce((sum, count) => sum + count, 0)).toBe(draws);
    expect(total.length).toBe(result.eventTotal.get(teamKey(1))!.length);
    for (let points = 0; points < total.length; points++) {
      expect(total[points], `bin ${String(points)}`).toBe(points < award.length ? award[points] : 0);
    }
  });

  it("reads a posted award as a point mass for an award only team, 0 when the map omits it", () => {
    const knownAwardPoints = new Map<string, number>([[AWARD_ONLY, 8]]);
    const input = inputFor(30, {
      knownAwardPoints,
      awardProfiles: new Map<string, DistrictAwardProfile>(),
      awardOnlyTeams: [AWARD_ONLY, "frc9002"],
    });
    const draws = 40;
    const result = simulateDistrictEvent(input, draws, 3);
    expect(result.awardPoints.get(AWARD_ONLY)![8]).toBe(draws);
    expect(result.awardPoints.get("frc9002")![0]).toBe(draws);
    expect(result.eventTotal.get(AWARD_ONLY)![8]).toBe(draws);
  });

  it("prices the most decorated award only team's Impact from the slate, in the same field as the roster (quick task 261014-qje)", () => {
    const awardProfiles = profilesWithCounts(30);
    awardProfiles.set(AWARD_ONLY, { bucket: "three-or-more", rookieState: "veteran", priorJudgedAwards: 1000, priorImpactWins: 3 });
    const draws = 4000;
    const input = inputFor(30, { awardProfiles, awardOnlyTeams: [AWARD_ONLY] });
    const result = simulateDistrictEvent(input, draws, 29);
    expect(result.awardOrdering).toBe("district-slate");
    const impactPoints = IMPACT_AWARD_POINTS * districtTierWeight(SEASON, TIER);
    const share = result.awardPoints.get(AWARD_ONLY)![impactPoints]! / draws;
    const awardField = [...input.baselines, { teamKey: AWARD_ONLY }];
    const p = eventAwardOutcomeOdds({ eventKey: input.eventKey, season: SEASON, tier: TIER, awardField, awardProfiles, awardSlate: input.awardSlate! }).get(AWARD_ONLY)!.p10;
    // The class with prior Impact wins out prices every roster team at Impact.
    const roster = eventAwardOutcomeOdds({ eventKey: input.eventKey, season: SEASON, tier: TIER, awardField, awardProfiles, awardSlate: input.awardSlate! });
    for (const baseline of input.baselines) expect(p).toBeGreaterThan(roster.get(baseline.teamKey)!.p10);
    expect(Math.abs(share - p)).toBeLessThanOrEqual(4 * Math.sqrt((p * (1 - p)) / draws) + 1e-12);
  });

  it("refuses an empty, duplicated or roster overlapping key before any draw, naming every offender", () => {
    let observed = 0;
    const run = (): unknown =>
      simulateDistrictEvent(
        inputFor(30, { awardOnlyTeams: ["", AWARD_ONLY, AWARD_ONLY, teamKey(4)] }),
        10,
        1,
        () => {
          observed++;
        }
      );
    expect(run).toThrow(InvalidAwardOnlyTeamsError);
    try {
      run();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('""');
      expect(message).toContain(AWARD_ONLY);
      expect(message).toContain(teamKey(4));
    }
    expect(observed).toBe(0);
  });

  it("names an award only team with no profile in MissingAwardProfileError like any roster team", () => {
    const awardProfiles = profilesFor(30);
    awardProfiles.delete(teamKey(2));
    expect(() => simulateDistrictEvent(inputFor(30, { awardProfiles, awardOnlyTeams: [AWARD_ONLY] }), 10, 1)).toThrow(
      new RegExp(`${teamKey(2)}.*${AWARD_ONLY}`)
    );
  });
});

// ---------------------------------------------------------------------------
// SHORT ROSTERS (quick task 261007-4qr): an eight-alliance event under 24 real
// teams seats WHOLE real alliances at the top seeds and leaves the bottom seeds
// as filler alliances that forfeit, the convention every such 2023-plus
// district event in the corpus follows.
// ---------------------------------------------------------------------------

describe("simulateDistrictEvent — short rosters (quick task 261007-4qr)", () => {
  const OUTPUT_MAPS = ["qualPoints", "selectionPoints", "elimPoints", "awardPoints", "eventTotal", "selectionRoutes"] as const;
  /** The four paying placements, each to a three-team alliance, read from the exported table. */
  const fourPayingPlacementsElimSum =
    3 * PLAYOFF_PLACEMENT_POINTS.slice(0, 4).reduce((sum, value) => sum + value, 0) * districtTierWeight(SEASON, TIER);
  const isFillerKey = (key: string): boolean => /^frc99[7-9]\d$/.test(key);

  it("draftedAllianceCount follows floor((N - 1) / 3) under 24 teams and keeps all eight at 24 or more", () => {
    expect(draftedAllianceCount(24, 8)).toBe(8);
    expect(draftedAllianceCount(30, 8)).toBe(8);
    expect(draftedAllianceCount(23, 8)).toBe(7);
    expect(draftedAllianceCount(22, 8)).toBe(7);
    expect(draftedAllianceCount(21, 8)).toBe(6);
    expect(draftedAllianceCount(20, 8)).toBe(6);
    expect(draftedAllianceCount(18, 8)).toBe(5);
    expect(draftedAllianceCount(8, 8)).toBe(2);
  });

  for (const teamCount of [18, 23]) {
    const drafted = teamCount === 18 ? 5 : 7;

    it(`${String(teamCount)} teams: alliances 1 to ${String(drafted)} draft three real teams each, the rest are empty filler, and filler never earns`, () => {
      const input = inputFor(teamCount);
      const draws = 400;
      let expectedSelectionSum = 0;
      for (let allianceNumber = 1; allianceNumber <= drafted; allianceNumber++) {
        for (let slot = 0; slot < 3; slot++) expectedSelectionSum += districtSelectionPoints(SEASON, TIER, slot, allianceNumber);
      }
      let violations = 0;
      let observed = 0;
      const result = simulateDistrictEvent(input, draws, 20261007, (observation) => {
        observed++;
        observation.alliances.forEach((roster, index) => {
          const expectedSize = index < drafted ? 3 : 0;
          if (roster.length !== expectedSize) violations++;
        });
        const zeroSelection = observation.selection.filter((value) => value === 0).length;
        if (zeroSelection !== teamCount - 3 * drafted) violations++;
        const selectionSum = observation.selection.reduce((sum, value) => sum + value, 0);
        if (selectionSum !== expectedSelectionSum) violations++;
        const elimSum = observation.elim.reduce((sum, value) => sum + value, 0);
        if (elimSum !== fourPayingPlacementsElimSum) violations++;
      });
      expect(observed).toBe(draws);
      expect(violations).toBe(0);

      const rosterKeys = input.baselines.map((baseline) => baseline.teamKey).sort();
      for (const name of OUTPUT_MAPS) {
        expect([...result[name].keys()].sort(), name).toEqual(rosterKeys);
      }
      expect(input.fieldSize).toBe(teamCount);
    });

    it(`${String(teamCount)} teams: the qualification marginal still equals a bare simulateRanks run`, () => {
      const input = inputFor(teamCount);
      const draws = 300;
      const seed = 4321;
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
  }

  it("rank-aligned ratings at 18 teams still pay all four placements to real alliances", () => {
    const input = inputFor(18, { ratings: rankAlignedRatings(18) });
    let violations = 0;
    simulateDistrictEvent(input, 200, 9, (observation) => {
      if (observation.elim.reduce((sum, value) => sum + value, 0) !== fourPayingPlacementsElimSum) violations++;
    });
    expect(violations).toBe(0);
  });

  it("the captain slot's possible range follows the drafted count when the draft is simulated", () => {
    const result = simulateDistrictEvent(inputFor(18), 50, 3);
    const captain = result.selectionRoutes.get(teamKey(1))!.bySlot[0]!;
    expect(captain.possibleMinPoints).toBe(districtSelectionPoints(SEASON, TIER, 0, 5));
    expect(captain.possibleMaxPoints).toBe(districtSelectionPoints(SEASON, TIER, 0, 1));
    expect(captain.possibleMinPoints).not.toBe(districtSelectionPoints(SEASON, TIER, 0, 8));
  });

  /** Twenty real teams: alliances 1 to 6 hold teams 1 to 18, alliances 7 and 8 hold six demo keys. */
  function shortSupplied(): SuppliedAlliance[] {
    const out: SuppliedAlliance[] = [];
    for (let n = 1; n <= 6; n++) {
      out.push({ allianceNumber: n, picks: [teamKey(n * 3 - 2), teamKey(n * 3 - 1), teamKey(n * 3)] });
    }
    out.push({ allianceNumber: 7, picks: ["frc9990", "frc9991", "frc9992"] });
    out.push({ allianceNumber: 8, picks: ["frc9993", "frc9994", "frc9995"] });
    return out;
  }

  it("supplied alliances at 20 teams: whole demo alliances are filler, no demo key reaches an output, and real members keep their TBA slots", () => {
    const input = inputFor(20, { knownAlliances: shortSupplied(), remainingMatches: [] });
    const draws = 300;
    let violations = 0;
    const result = simulateDistrictEvent(input, draws, 77, (observation) => {
      if (observation.alliances[6]!.length !== 0 || observation.alliances[7]!.length !== 0) violations++;
      if (observation.elim.reduce((sum, value) => sum + value, 0) !== fourPayingPlacementsElimSum) violations++;
    });
    expect(violations).toBe(0);
    for (const name of OUTPUT_MAPS) {
      expect([...result[name].keys()].some(isFillerKey), name).toBe(false);
      expect(result[name].size, name).toBe(20);
    }
    for (const alliance of shortSupplied().slice(0, 6)) {
      alliance.picks.forEach((key, slot) => {
        const expected = districtSelectionPoints(SEASON, TIER, slot, alliance.allianceNumber);
        expect(isPointMass(result.selectionPoints.get(key)!, draws), key).toBe(true);
        expect(result.selectionPoints.get(key)![expected], key).toBe(draws);
        expect(result.selectionRoutes.get(key)!.bySlot[slot]!.draws, key).toBe(draws);
      });
    }
    // The two real teams no alliance took earn no selection points.
    expect(result.selectionRoutes.get(teamKey(19))!.notSelectedDraws).toBe(draws);
    expect(result.selectionRoutes.get(teamKey(20))!.notSelectedDraws).toBe(draws);
  });

  it("a demo key between two real members leaves the second real member on its own TBA slot", () => {
    const alliances = shortSupplied();
    alliances[0] = { allianceNumber: 1, picks: [teamKey(1), "frc9996", teamKey(2)] };
    // Team 3 is now unpicked; the roster still holds twenty real teams.
    const input = inputFor(20, { knownAlliances: alliances, remainingMatches: [] });
    const draws = 100;
    const result = simulateDistrictEvent(input, draws, 5);
    const secondPick = districtSelectionPoints(SEASON, TIER, 2, 1);
    expect(result.selectionPoints.get(teamKey(2))![secondPick]).toBe(draws);
    expect(result.selectionRoutes.get(teamKey(2))!.bySlot[2]!.draws).toBe(draws);
    expect(result.selectionRoutes.get(teamKey(2))!.bySlot[1]!.draws).toBe(0);
    expect([...result.eventTotal.keys()].some(isFillerKey)).toBe(false);
  });

  it("a supplied pick absent from the roster that is NOT a demo key still raises InvalidAllianceSetError, naming it", () => {
    const alliances = shortSupplied();
    alliances[6] = { allianceNumber: 7, picks: ["frc9990", "frc5000", "frc9992"] };
    const input = inputFor(20, { knownAlliances: alliances, remainingMatches: [] });
    expect(() => simulateDistrictEvent(input, 10, 1)).toThrow(InvalidAllianceSetError);
    expect(() => simulateDistrictEvent(input, 10, 1)).toThrow(/frc5000/);
  });
});

// ---------------------------------------------------------------------------
// eventAwardOutcomeOdds: the exact odds twin of the award draw (261014-i8i)
// ---------------------------------------------------------------------------

describe("eventAwardOutcomeOdds — the exact law of the shipped award draw (quick tasks 261014-i8i and 261014-qje)", () => {
  /** Thirty teams with both counts; teams 25 to 30 are rookies. */
  function mixedProfiles(): Map<string, DistrictAwardProfile> {
    const out = profilesWithCounts(30);
    for (let i = 25; i <= 30; i++) out.set(teamKey(i), { bucket: "none", rookieState: "rookie", priorJudgedAwards: 0, priorImpactWins: 0 });
    return out;
  }
  const field = baselinesFor(30);
  const slate = defaultDistrictSlate(SEASON, field.map((baseline) => baseline.teamKey));

  it("equals slateAwardOutcomeOdds of the slate's own assignments, in award field order, and sums to 1", () => {
    const profiles = mixedProfiles();
    const odds = eventAwardOutcomeOdds({ eventKey: "2026zztest", season: SEASON, tier: TIER, awardField: field, awardProfiles: profiles, awardSlate: slate });
    const assignments = slateAssignments(SEASON, field, profiles, slate);
    expect([...odds.keys()]).toEqual(field.map((baseline) => baseline.teamKey));
    assignments.forEach((assignment) => {
      const team = odds.get(assignment.teamKey)!;
      expect(team).toEqual(slateAwardOutcomeOdds(assignment));
      expect(team.p10 + team.p8 + team.p5 + team.p0).toBeCloseTo(1, 12);
      expect(team.impact).toBe(team.p10);
    });
  });

  it("matches the draw's own award frequencies within 4 standard errors at 20,000 draws, with and without the counts", () => {
    const draws = 20_000;
    for (const profiles of [mixedProfiles(), profilesFor(30)]) {
      const input = inputFor(30, { awardProfiles: profiles });
      const odds = eventAwardOutcomeOdds({ eventKey: input.eventKey, season: SEASON, tier: TIER, awardField: input.baselines, awardProfiles: profiles, awardSlate: input.awardSlate! });
      const result = simulateDistrictEvent(input, draws, 7);
      for (const baseline of input.baselines) {
        const histogram = result.awardPoints.get(baseline.teamKey)!;
        const team = odds.get(baseline.teamKey)!;
        for (const [points, p] of [
          [10, team.p10],
          [8, team.p8],
          [5, team.p5],
          [0, team.p0],
        ] as const) {
          const frequency = (histogram[points] ?? 0) / draws;
          const se = Math.sqrt(Math.max(p * (1 - p), 1e-12) / draws);
          expect(Math.abs(frequency - p), `${baseline.teamKey} at ${String(points)}`).toBeLessThanOrEqual(4 * se + 1e-12);
        }
      }
    }
  });

  it("refuses a field with a missing profile exactly as the draw does", () => {
    const profiles = profilesFor(30);
    profiles.delete(teamKey(3));
    expect(() => eventAwardOutcomeOdds({ eventKey: "2026zztest", season: SEASON, tier: TIER, awardField: field, awardProfiles: profiles, awardSlate: slate })).toThrow(
      MissingAwardProfileError
    );
  });
});

// ---------------------------------------------------------------------------
// The DCMP award slate draw path (261014-i8i)
// ---------------------------------------------------------------------------

describe("simulateDistrictEvent — the DCMP award slate (quick task 261014-i8i)", () => {
  /** Thirty teams with both counts; teams 25 to 30 are rookies. */
  function slateProfiles(): Map<string, DistrictAwardProfile> {
    const out = profilesWithCounts(30);
    for (let i = 25; i <= 30; i++) out.set(teamKey(i), { bucket: "none", rookieState: "rookie", priorJudgedAwards: 0, priorImpactWins: 0 });
    return out;
  }
  /** Teams 1 to 4 eligible for Impact, 2 to 6 for EI, 25 and 26 for RAS; team 3 only half eligible for Impact. Everyone else ineligible. */
  const SLATE: DcmpAwardSlateInput = {
    role: "single",
    // Q-08 (quick task 261014-qje): five slot counts; no rookie only 5 point award here.
    expected: { impact: 1.8, engineeringInspiration: 1.6, rookieAllStar: 1, judgedRookie: 0, judged: 12 },
    sources: { counts: "previousSeason", judged: "role" },
    eligibility: [
      { teamKey: teamKey(1), impact: 1, engineeringInspiration: 0, rookieAllStar: 0 },
      { teamKey: teamKey(2), impact: 1, engineeringInspiration: 1, rookieAllStar: 0 },
      { teamKey: teamKey(3), impact: 0.5, engineeringInspiration: 1, rookieAllStar: 0 },
      { teamKey: teamKey(4), impact: 1, engineeringInspiration: 1, rookieAllStar: 0 },
      { teamKey: teamKey(5), impact: 0, engineeringInspiration: 1, rookieAllStar: 0 },
      { teamKey: teamKey(6), impact: 0, engineeringInspiration: 0.4, rookieAllStar: 0 },
      { teamKey: teamKey(25), impact: 0, engineeringInspiration: 0, rookieAllStar: 1 },
      { teamKey: teamKey(26), impact: 0, engineeringInspiration: 0, rookieAllStar: 1 },
    ].sort((a, b) => (a.teamKey < b.teamKey ? -1 : 1)),
  };
  const ELIGIBLE = new Set(SLATE.eligibility.map((entry) => entry.teamKey));

  function dcmpInput(overrides: Partial<DistrictLedgerEventInput> = {}): DistrictLedgerEventInput {
    return inputFor(30, { tier: "dcmp", awardProfiles: slateProfiles(), awardSlate: SLATE, ...overrides });
  }

  it("draws from the slate: per team frequencies match eventAwardOutcomeOdds within 4 standard errors at 20,000 draws", () => {
    const draws = 20_000;
    const input = dcmpInput();
    const result = simulateDistrictEvent(input, draws, 11);
    expect(result.awardOrdering).toBe("dcmp-slate");
    const odds = eventAwardOutcomeOdds({
      eventKey: input.eventKey,
      season: SEASON,
      tier: "dcmp",
      awardField: input.baselines,
      awardProfiles: input.awardProfiles,
      awardSlate: SLATE,
    });
    const weight = districtTierWeight(SEASON, "dcmp");
    for (const baseline of input.baselines) {
      const histogram = result.awardPoints.get(baseline.teamKey)!;
      const team = odds.get(baseline.teamKey)!;
      expect(team.p10 + team.p8 + team.p5 + team.p0).toBeCloseTo(1, 12);
      for (const [points, p] of [
        [10, team.p10],
        [8, team.p8],
        [5, team.p5],
        [0, team.p0],
      ] as const) {
        const frequency = (histogram[points * weight] ?? 0) / draws;
        const se = Math.sqrt(Math.max(p * (1 - p), 1e-12) / draws);
        expect(Math.abs(frequency - p), `${baseline.teamKey} at ${String(points * weight)}`).toBeLessThanOrEqual(4 * se + 1e-12);
      }
    }
  });

  it("gives a team ineligible at the position zero mass at 30 and at 24", () => {
    const result = simulateDistrictEvent(dcmpInput(), 5_000, 3);
    let checked = 0;
    for (const baseline of baselinesFor(30)) {
      if (ELIGIBLE.has(baseline.teamKey)) continue;
      const histogram = result.awardPoints.get(baseline.teamKey)!;
      expect(histogram[30] ?? 0, baseline.teamKey).toBe(0);
      expect(histogram[24] ?? 0, baseline.teamKey).toBe(0);
      checked++;
    }
    expect(checked).toBe(22);
    // The eligible heads of the field do win at 30.
    expect(result.awardPoints.get(teamKey(1))![30]!).toBeGreaterThan(0);
  });

  it("reports each team's judged rung in awardSources", () => {
    const result = simulateDistrictEvent(dcmpInput(), 50, 3);
    expect([...result.awardSources.keys()]).toEqual(baselinesFor(30).map((baseline) => baseline.teamKey));
    expect([...result.awardSources.values()].every((source) => source === "cell")).toBe(true);
  });

  it("is deterministic under a seed", () => {
    const a = simulateDistrictEvent(dcmpInput(), 200, 9);
    const b = simulateDistrictEvent(dcmpInput(), 200, 9);
    expect([...a.awardPoints.entries()]).toEqual([...b.awardPoints.entries()]);
  });

  it("needs no slate pricing where the awards are posted", () => {
    const known = new Map([[teamKey(1), 30]]);
    const result = simulateDistrictEvent(dcmpInput({ knownAwardPoints: known }), 50, 3);
    expect(result.awardOrdering).toBe("posted");
    expect(result.awardPoints.get(teamKey(1))![30]).toBe(50);
  });

  it("refuses a DCMP role slate on a district tier event before any draw, in the draw and in the odds", () => {
    const district = inputFor(30, { awardProfiles: slateProfiles(), awardSlate: SLATE });
    expect(() => simulateDistrictEvent(district, 10, 1)).toThrow(DcmpAwardSlateOnDistrictTierError);
    expect(() => simulateDistrictEvent({ ...district, knownAwardPoints: new Map() }, 10, 1)).toThrow(DcmpAwardSlateOnDistrictTierError);
    expect(() =>
      eventAwardOutcomeOdds({ eventKey: district.eventKey, season: SEASON, tier: "district", awardField: district.baselines, awardProfiles: district.awardProfiles, awardSlate: SLATE })
    ).toThrow(DcmpAwardSlateOnDistrictTierError);
  });

  it("refuses a dcmp tier run with open awards and no slate before any draw, in the draw and in the odds", () => {
    const missing = inputFor(30, { tier: "dcmp", awardProfiles: slateProfiles() });
    let observed = 0;
    expect(() => simulateDistrictEvent(missing, 10, 1, () => observed++)).toThrow(MissingAwardSlateError);
    expect(observed).toBe(0);
    expect(() =>
      eventAwardOutcomeOdds({ eventKey: missing.eventKey, season: SEASON, tier: "dcmp", awardField: missing.baselines, awardProfiles: missing.awardProfiles })
    ).toThrow(MissingAwardSlateError);
    // Posted awards need no slate.
    const posted = simulateDistrictEvent({ ...missing, knownAwardPoints: new Map([[teamKey(1), 15]]) }, 10, 1);
    expect(posted.awardOrdering).toBe("posted");
  });

  it("refuses a field member with no profile on the slate path", () => {
    const profiles = slateProfiles();
    profiles.delete(teamKey(9));
    expect(() => simulateDistrictEvent(dcmpInput({ awardProfiles: profiles }), 10, 1)).toThrow(MissingAwardProfileError);
  });
});

// ---------------------------------------------------------------------------
// THE CANDIDATE RANDOM PICK DRAFT (quick task 261014-mji): an optional input,
// inert at default. Every existing test above runs unedited without it; that
// is the inert proof. This block pins what the option does when present.
// ---------------------------------------------------------------------------

describe("simulateDistrictEvent — the candidate random pick draft (pickPositionPmf)", () => {
  const DEGENERATE: PickPositionPmf = { firstPick: [1], secondPick: [1] };

  /** Every observation, deeply copied, plus its pickDraws (undefined when the key is absent). */
  function observeAll(
    input: DistrictLedgerEventInput,
    draws: number,
    seed: number
  ): {
    result: ReturnType<typeof simulateDistrictEvent>;
    snapshots: ReturnType<typeof snapshot>[];
    pickDraws: (number | undefined)[];
    hasKey: boolean[];
  } {
    const snapshots: ReturnType<typeof snapshot>[] = [];
    const pickDraws: (number | undefined)[] = [];
    const hasKey: boolean[] = [];
    const result = simulateDistrictEvent(input, draws, seed, (observation) => {
      snapshots.push(snapshot(observation));
      pickDraws.push(observation.pickDraws);
      hasKey.push("pickDraws" in observation);
    });
    return { result, snapshots, pickDraws, hasKey };
  }

  /** The pick order the module documents: descending published total, ties by ascending team key. */
  function byTotal(input: DistrictLedgerEventInput): string[] {
    return input.baselines
      .map((baseline) => baseline.teamKey)
      .sort((a, b) => {
        const totalA = input.ratings.get(a)!.total!;
        const totalB = input.ratings.get(b)!.total!;
        if (totalA !== totalB) return totalB - totalA;
        return a < b ? -1 : a > b ? 1 : 0;
      });
  }

  /**
   * An independent walk of the draft at a FIXED ranking (zero remaining
   * matches, baselines already in rank order): progressive captains, round one
   * 1..k then round two k..1, each pick taking the position `choose` names in
   * the still available list ordered by total.
   */
  function oracleDraft(input: DistrictLedgerEventInput, choose: (round: 1 | 2, available: number) => number): string[][] {
    const rankOrder = input.baselines.map((baseline) => baseline.teamKey);
    const pickOrder = byTotal(input);
    const allied = new Set<string>();
    const k = draftedAllianceCount(rankOrder.length, input.allianceCount);
    const alliances: string[][] = [];
    for (let n = 0; n < input.allianceCount; n++) alliances.push([]);
    const pick = (round: 1 | 2): string => {
      const available = pickOrder.filter((key) => !allied.has(key));
      const position = choose(round, available.length);
      const key = available[position - 1]!;
      allied.add(key);
      return key;
    };
    for (let a = 1; a <= k; a++) {
      const captain = rankOrder.find((key) => !allied.has(key))!;
      allied.add(captain);
      alliances[a - 1]!.push(captain);
      alliances[a - 1]!.push(pick(1));
    }
    for (let a = k; a >= 1; a--) alliances[a - 1]!.push(pick(2));
    return alliances;
  }

  it("a pmf of [1] for both rounds deep equals the run without the option, histograms, routes and ledger counts included", () => {
    for (const input of [inputFor(30), inputFor(24, { remainingMatches: [] })]) {
      const absent = observeAll(input, 200, 17);
      const degenerate = observeAll({ ...input, pickPositionPmf: DEGENERATE }, 200, 17);
      expect(degenerate.result).toEqual(absent.result);
      expect(degenerate.snapshots).toEqual(absent.snapshots);
      expect(degenerate.snapshots.map((s) => s.ledgerDraws)).toEqual(absent.snapshots.map((s) => s.ledgerDraws));
    }
  });

  it("leaves the rank stream untouched: qualification histograms are deep equal under a non degenerate pmf", () => {
    const input = inputFor(30);
    const absent = simulateDistrictEvent(input, 300, 23);
    const random = simulateDistrictEvent(
      { ...input, pickPositionPmf: { firstPick: [0.5, 0.3, 0.2], secondPick: [0.4, 0.4, 0.2] } },
      300,
      23
    );
    expect(random.qualPoints).toEqual(absent.qualPoints);
    expect(random.rankingFixed).toBe(absent.rankingFixed);
  });

  it("[0, 1] takes the SECOND best available team on every pick, except the best when only one is left", () => {
    const input = inputFor(24, { remainingMatches: [] });
    const expected = oracleDraft(input, (_round, available) => (available >= 2 ? 2 : 1));
    const { snapshots } = observeAll({ ...input, pickPositionPmf: { firstPick: [0, 1], secondPick: [0, 1] } }, 50, 5);
    expect(snapshots).toHaveLength(50);
    for (const s of snapshots) expect(s.alliances).toEqual(expected);
    // A different draft from the greedy one, so the test is not vacuous.
    expect(expected).not.toEqual(oracleDraft(input, () => 1));
  });

  it("draws positions at the pmf's frequency: [0.5, 0.5] puts the top available team on alliance 1 about half the time", () => {
    const input = inputFor(24, { remainingMatches: [] });
    const captain = input.baselines[0]!.teamKey;
    const available = byTotal(input).filter((key) => key !== captain);
    let top = 0;
    let second = 0;
    const draws = 4_000;
    simulateDistrictEvent({ ...input, pickPositionPmf: { firstPick: [0.5, 0.5], secondPick: [1] } }, draws, 31, (observation) => {
      const firstPick = observation.alliances[0]![1]!;
      if (firstPick === available[0]) top++;
      else if (firstPick === available[1]) second++;
    });
    expect(top + second).toBe(draws);
    expect(Math.abs(top / draws - 0.5)).toBeLessThan(0.03);
  });

  it("truncates a pmf to the available list: [0, 0, 1] takes position 3 with three or more left and the best with one or two", () => {
    const input = inputFor(24, { remainingMatches: [] });
    const expected = oracleDraft(input, (round, available) => (round === 1 ? 1 : available >= 3 ? 3 : 1));
    const { snapshots } = observeAll({ ...input, pickPositionPmf: { firstPick: [1], secondPick: [0, 0, 1] } }, 20, 9);
    for (const s of snapshots) expect(s.alliances).toEqual(expected);
  });

  it("renormalises the mass inside the list: [0.25, 0.25, 0.5] with two left draws positions 1 and 2 about evenly", () => {
    // With 24 teams, alliance 2's second pick is the turn with exactly two
    // teams left: its own pick and alliance 1's second pick.
    const input = inputFor(24, { remainingMatches: [] });
    const positionByTotal = new Map(byTotal(input).map((key, index) => [key, index]));
    const draws = 4_000;
    let firstPosition = 0;
    simulateDistrictEvent(
      { ...input, pickPositionPmf: { firstPick: [1], secondPick: [0.25, 0.25, 0.5] } },
      draws,
      41,
      (observation) => {
        const alliance2 = observation.alliances[1]![2]!;
        const alliance1 = observation.alliances[0]![2]!;
        if (positionByTotal.get(alliance2)! < positionByTotal.get(alliance1)!) firstPosition++;
      }
    );
    expect(Math.abs(firstPosition / draws - 0.5)).toBeLessThan(0.03);
  });

  it("refuses an invalid pmf before any draw and names every offender", () => {
    let observed = 0;
    const bad = inputFor(24, {
      remainingMatches: [],
      pickPositionPmf: { firstPick: [], secondPick: [0.5, -1, Number.NaN, Number.POSITIVE_INFINITY] },
    });
    let message = "";
    try {
      simulateDistrictEvent(bad, 10, 1, () => observed++);
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidPickPositionPmfError);
      message = (error as Error).message;
    }
    expect(observed).toBe(0);
    expect(message).toContain("firstPick (empty)");
    expect(message).toContain("secondPick position 2");
    expect(message).toContain("secondPick position 3");
    expect(message).toContain("secondPick position 4");

    const zero = inputFor(24, { remainingMatches: [], pickPositionPmf: { firstPick: [0, 0], secondPick: [1] } });
    expect(() => simulateDistrictEvent(zero, 10, 1, () => observed++)).toThrow(InvalidPickPositionPmfError);
    expect(() => simulateDistrictEvent(zero, 10, 1)).toThrow(/firstPick \(no positive weight\)/);
    expect(observed).toBe(0);
  });

  it("reads exactly one pick stream value per pick turn: pickDraws is 2 x draftedAllianceCount, and absent without the option", () => {
    for (const teamCount of [24, 30, 20]) {
      const input = inputFor(teamCount, { remainingMatches: [] });
      const present = observeAll({ ...input, pickPositionPmf: { firstPick: [0.6, 0.4], secondPick: [0.2, 0.3, 0.5] } }, 25, 3);
      const expected = 2 * draftedAllianceCount(teamCount, 8);
      expect(present.pickDraws).toHaveLength(25);
      expect(present.pickDraws.every((count) => count === expected)).toBe(true);
      const absent = observeAll(input, 25, 3);
      expect(absent.hasKey.every((has) => !has)).toBe(true);
    }
  });

  it("changes nothing when alliances are supplied, and reads no pick stream value", () => {
    const input = inputFor(30, { knownAlliances: suppliedAlliances() });
    const absent = observeAll(input, 100, 13);
    const present = observeAll({ ...input, pickPositionPmf: { firstPick: [0, 1], secondPick: [0, 0, 1] } }, 100, 13);
    expect(present.result).toEqual(absent.result);
    expect(present.snapshots).toEqual(absent.snapshots);
    expect(present.pickDraws.every((count) => count === 0)).toBe(true);
  });

  it("PICK_STREAM_SALT is a nonzero 32 bit constant different from LEDGER_STREAM_SALT", () => {
    expect(PICK_STREAM_SALT).not.toBe(0);
    expect(PICK_STREAM_SALT).not.toBe(LEDGER_STREAM_SALT);
    expect(PICK_STREAM_SALT >>> 0).toBe(PICK_STREAM_SALT);
  });
});

// ---------------------------------------------------------------------------
// The district award slate draw path (quick task 261014-qje)
// ---------------------------------------------------------------------------

describe("simulateDistrictEvent — the district award slate (quick task 261014-qje)", () => {
  /** Thirty teams with both counts; teams 25 to 30 are rookies. */
  function slateProfiles(): Map<string, DistrictAwardProfile> {
    const out = profilesWithCounts(30);
    for (let i = 25; i <= 30; i++) out.set(teamKey(i), { bucket: "none", rookieState: "rookie", priorJudgedAwards: 0, priorImpactWins: 0 });
    return out;
  }
  /**
   * Every field member listed (the district role refuses an absent one).
   * Team 1 already won Impact at an earlier district event (Impact 0), team 2
   * Engineering Inspiration (EI 0), team 25 Rookie All Star (RAS 0); team 3 is
   * half eligible for Impact (an open earlier event).
   */
  const SLATE: AwardSlateInput = {
    role: "district",
    expected: { impact: 0.97, engineeringInspiration: 0.98, rookieAllStar: 0.9, judgedRookie: 0, judged: 11.7 },
    sources: { counts: "role", judged: "role" },
    eligibility: Array.from({ length: 30 }, (_, i) => {
      const key = teamKey(i + 1);
      return {
        teamKey: key,
        impact: i === 0 ? 0 : i === 2 ? 0.5 : 1,
        engineeringInspiration: i === 1 ? 0 : 1,
        rookieAllStar: i === 24 ? 0 : 1,
      };
    }).sort((a, b) => (a.teamKey < b.teamKey ? -1 : 1)),
  };

  function districtInput(overrides: Partial<DistrictLedgerEventInput> = {}): DistrictLedgerEventInput {
    return inputFor(30, { awardProfiles: slateProfiles(), awardSlate: SLATE, ...overrides });
  }

  it("draws from the slate: per team frequencies match eventAwardOutcomeOdds within 4 standard errors at 20,000 draws", () => {
    const draws = 20_000;
    const input = districtInput();
    const result = simulateDistrictEvent(input, draws, 13);
    expect(result.awardOrdering).toBe("district-slate");
    const odds = eventAwardOutcomeOdds({ eventKey: input.eventKey, season: SEASON, tier: "district", awardField: input.baselines, awardProfiles: input.awardProfiles, awardSlate: SLATE });
    const weight = districtTierWeight(SEASON, "district");
    for (const baseline of input.baselines) {
      const histogram = result.awardPoints.get(baseline.teamKey)!;
      const team = odds.get(baseline.teamKey)!;
      expect(team.p10 + team.p8 + team.p5 + team.p0).toBeCloseTo(1, 12);
      for (const [points, p] of [
        [10, team.p10],
        [8, team.p8],
        [5, team.p5],
        [0, team.p0],
      ] as const) {
        const frequency = (histogram[points * weight] ?? 0) / draws;
        const se = Math.sqrt(Math.max(p * (1 - p), 1e-12) / draws);
        expect(Math.abs(frequency - p), `${baseline.teamKey} at ${String(points * weight)}`).toBeLessThanOrEqual(4 * se + 1e-12);
      }
    }
  });

  it("gives a team that already won an award at an earlier district event zero mass at that award's points", () => {
    const result = simulateDistrictEvent(districtInput(), 5_000, 3);
    const weight = districtTierWeight(SEASON, "district");
    // Team 1 cannot win Impact again; team 2 (a veteran) cannot win EI again; team 25 (a rookie) cannot win RAS again.
    expect(result.awardPoints.get(teamKey(1))![10 * weight] ?? 0).toBe(0);
    expect(result.awardPoints.get(teamKey(2))![8 * weight] ?? 0).toBe(0);
    expect(result.awardPoints.get(teamKey(25))![8 * weight] ?? 0).toBe(0);
    // The rest of the field's head does win Impact.
    expect(result.awardPoints.get(teamKey(4))![10 * weight]!).toBeGreaterThan(0);
  });

  it("reports the district slate disposition and each team's judged rung", () => {
    const result = simulateDistrictEvent(districtInput(), 50, 3);
    expect(result.awardOrdering).toBe("district-slate");
    expect([...result.awardSources.keys()]).toEqual(baselinesFor(30).map((baseline) => baseline.teamKey));
  });

  it("without a slate a district tier run is refused before any draw: the per team model is gone (Q-12)", () => {
    expect(() => simulateDistrictEvent(inputFor(30, { awardProfiles: slateProfiles(), awardSlate: undefined }), 50, 3)).toThrow(MissingAwardSlateError);
    expect(() => eventAwardOutcomeOdds({ eventKey: "2026zztest", season: SEASON, tier: "district", awardField: baselinesFor(30), awardProfiles: slateProfiles() })).toThrow(
      MissingAwardSlateError
    );
  });

  it("refuses a role that does not match the tier before any draw", () => {
    let observed = 0;
    const atDcmp = inputFor(30, { tier: "dcmp", awardProfiles: slateProfiles(), awardSlate: SLATE });
    expect(() => simulateDistrictEvent(atDcmp, 10, 1, () => observed++)).toThrow(DistrictAwardSlateOnDcmpTierError);
    expect(() => eventAwardOutcomeOdds({ eventKey: "x", season: SEASON, tier: "dcmp", awardField: baselinesFor(30), awardProfiles: slateProfiles(), awardSlate: SLATE })).toThrow(
      DistrictAwardSlateOnDcmpTierError
    );
    const dcmpRole: AwardSlateInput = { ...SLATE, role: "single" };
    expect(() => simulateDistrictEvent(districtInput({ awardSlate: dcmpRole }), 10, 1, () => observed++)).toThrow(DcmpAwardSlateOnDistrictTierError);
    // Refused even where the awards are posted.
    expect(() => simulateDistrictEvent({ ...atDcmp, knownAwardPoints: new Map() }, 10, 1)).toThrow(DistrictAwardSlateOnDcmpTierError);
    expect(observed).toBe(0);
  });

  it("needs no slate pricing where the awards are posted", () => {
    const result = simulateDistrictEvent(districtInput({ knownAwardPoints: new Map([[teamKey(1), 10]]) }), 50, 3);
    expect(result.awardOrdering).toBe("posted");
  });
});
