/**
 * The per run event total record (quick task 261014-qv2): `recordEventTotalByRun`
 * on a district event input, and the `eventTotalByRun` it puts on the result.
 *
 * In its own file because `ledgerSimulation.test.ts` is held by another
 * session. The fixtures are rebuilt here in that file's style: strictly
 * decreasing baselines, a permuted SPR order, six remaining matches.
 */
import { describe, expect, it } from "vitest";
import type { SimMatchInput, SimTeamBaseline } from "../algorithms/simulation/rankSimulation.js";
import type { AllianceMemberRating } from "../algorithms/simulation/allianceWinProbability.js";
import {
  allocateEventTotalByRun,
  simulateDistrictEvent,
  type DistrictAwardProfile,
  type DistrictLedgerEventInput,
} from "./ledgerSimulation.js";
import { buildDistrictAwardSlate } from "./awardSlate.js";
import { maxEventPoints } from "./pointModel.js";
import { pickPositionPmfForSeason } from "./pickDraft.js";

const SEASON = 2026;

function teamKey(n: number): string {
  return `frc${100 + n}`;
}

function baselinesFor(teamCount: number): SimTeamBaseline[] {
  const out: SimTeamBaseline[] = [];
  for (let i = 1; i <= teamCount; i++) {
    out.push({ teamKey: teamKey(i), earnedRpSum: (teamCount + 1 - i) * 10, matchesPlayed: 10 });
  }
  return out;
}

function permutedRatings(teamCount: number): Map<string, AllianceMemberRating> {
  const out = new Map<string, AllianceMemberRating>();
  for (let i = 1; i <= teamCount; i++) {
    out.set(teamKey(i), { teamKey: teamKey(i), total: ((i * 7) % teamCount) + 1, sigma: 3 });
  }
  return out;
}

function profilesFor(teamCount: number): Map<string, DistrictAwardProfile> {
  const out = new Map<string, DistrictAwardProfile>();
  for (let i = 1; i <= teamCount; i++) out.set(teamKey(i), { bucket: "none", rookieState: "veteran" });
  return out;
}

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

function inputFor(teamCount: number, overrides: Partial<DistrictLedgerEventInput> = {}): DistrictLedgerEventInput {
  const input: DistrictLedgerEventInput = {
    eventKey: "2026zztest",
    season: SEASON,
    tier: "district",
    fieldSize: teamCount,
    allianceCount: 8,
    remainingMatches: remainingMatches(),
    baselines: baselinesFor(teamCount),
    ratings: permutedRatings(teamCount),
    awardProfiles: profilesFor(teamCount),
    ...overrides,
  };
  // Every district tier event whose awards are open carries an award slate
  // since quick task 261014-qje (Q-01): the season's counts over the award
  // field, every team allowed every award.
  if ("awardSlate" in overrides) return input;
  const field = [...input.baselines.map((baseline) => baseline.teamKey), ...(input.awardOnlyTeams ?? [])].map((teamKey) => ({ teamKey }));
  return { ...input, awardSlate: buildDistrictAwardSlate({ season: input.season, awardField: field, eligibility: [] }) };
}

/** The column of one team, as a histogram over point values of the given length. */
function columnHistogram(record: { teamKeys: readonly string[]; runs: number; totals: ArrayLike<number> }, j: number, length: number): Int32Array {
  const out = new Int32Array(length);
  const n = record.teamKeys.length;
  for (let run = 0; run < record.runs; run++) out[record.totals[run * n + j]!]! += 1;
  return out;
}

const AWARD_ONLY = "frc9001";

describe("simulateDistrictEvent: the per run event total record (quick task 261014-qv2)", () => {
  it("absent, the result carries no eventTotalByRun key", () => {
    const result = simulateDistrictEvent(inputFor(30), 200, 17);
    expect("eventTotalByRun" in result).toBe(false);
  });

  it("present, every other field deep equals the flagless result at the same seed, and each column is its eventTotal histogram exactly", () => {
    const pmf = pickPositionPmfForSeason(SEASON);
    expect(pmf).toBeDefined();
    const awardProfiles = profilesFor(30);
    awardProfiles.set(AWARD_ONLY, { bucket: "none", rookieState: "veteran" });
    for (const overrides of [
      {},
      { pickPositionPmf: pmf! },
      { awardProfiles, awardOnlyTeams: [AWARD_ONLY] },
    ] as Partial<DistrictLedgerEventInput>[]) {
      const draws = 400;
      const plain = simulateDistrictEvent(inputFor(30, overrides), draws, 23);
      const recorded = simulateDistrictEvent(inputFor(30, { ...overrides, recordEventTotalByRun: true }), draws, 23);
      const { eventTotalByRun, ...rest } = recorded;
      expect(rest).toEqual(plain);
      expect(eventTotalByRun).toBeDefined();
      const record = eventTotalByRun!;
      const expectedKeys = [...inputFor(30).baselines.map((b) => b.teamKey), ...(overrides.awardOnlyTeams ?? [])];
      expect(record.teamKeys).toEqual(expectedKeys);
      expect(record.runs).toBe(draws);
      expect(record.totals.length).toBe(draws * expectedKeys.length);
      expect(record.totals).toBeInstanceOf(Uint8Array);
      record.teamKeys.forEach((key, j) => {
        const histogram = recorded.eventTotal.get(key)!;
        expect(columnHistogram(record, j, histogram.length)).toEqual(histogram);
      });
    }
  });

  it("an award only team's column is its award draw, and it follows the roster", () => {
    const awardProfiles = profilesFor(30);
    awardProfiles.set(AWARD_ONLY, { bucket: "none", rookieState: "veteran" });
    const result = simulateDistrictEvent(
      inputFor(30, { awardProfiles, awardOnlyTeams: [AWARD_ONLY], recordEventTotalByRun: true }),
      300,
      29
    );
    const record = result.eventTotalByRun!;
    expect(record.teamKeys[30]).toBe(AWARD_ONLY);
    expect(columnHistogram(record, 30, result.awardPoints.get(AWARD_ONLY)!.length)).toEqual(result.awardPoints.get(AWARD_ONLY));
  });

  it("the district tier ceiling fits in one byte; the allocation rule switches to two bytes above 255", () => {
    const ceilings = maxEventPoints(SEASON, "district");
    expect(ceilings.qual + ceilings.alliance + ceilings.elim + ceilings.award).toBeLessThanOrEqual(255);
    expect(allocateEventTotalByRun(3, 4, 255)).toBeInstanceOf(Uint8Array);
    expect(allocateEventTotalByRun(3, 4, 255).length).toBe(12);
    expect(allocateEventTotalByRun(3, 4, 256)).toBeInstanceOf(Uint16Array);
  });
});
