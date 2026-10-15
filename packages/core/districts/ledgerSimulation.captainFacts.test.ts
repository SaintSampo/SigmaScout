import { describe, expect, it } from "vitest";
import { pickPositionPmfForSeason } from "./pickDraft.js";
import {
  simulateDistrictEvent,
  type DistrictAwardProfile,
  type DistrictLedgerEventInput,
  type SuppliedAlliance,
} from "./ledgerSimulation.js";
import { buildDistrictAwardSlate } from "./awardSlate.js";
import type { AllianceMemberRating } from "../algorithms/simulation/allianceWinProbability.js";
import type { SimTeamBaseline } from "../algorithms/simulation/rankSimulation.js";

// Quick task 261015-3oo: the structural captain facts of a fixed ranking.

const TEAM_COUNT = 30;
const teamKey = (n: number): string => `frc${String(100 + n)}`;
const PMF_2026 = pickPositionPmfForSeason(2026)!;

/** Thirty teams at a fixed ranking (no remaining matches): team i ranks i. SPR is a permutation of rank, so picks do not follow the ranking. */
function fixedRankingInput(overrides: Partial<DistrictLedgerEventInput> = {}): DistrictLedgerEventInput {
  const baselines: SimTeamBaseline[] = [];
  const ratings = new Map<string, AllianceMemberRating>();
  const awardProfiles = new Map<string, DistrictAwardProfile>();
  for (let i = 1; i <= TEAM_COUNT; i++) {
    baselines.push({ teamKey: teamKey(i), earnedRpSum: (TEAM_COUNT + 1 - i) * 10, matchesPlayed: 10 });
    ratings.set(teamKey(i), { teamKey: teamKey(i), total: ((i * 7) % TEAM_COUNT) + 1, sigma: 3 });
    awardProfiles.set(teamKey(i), { bucket: "none", rookieState: "veteran" });
  }
  return {
    eventKey: "2026zzcapt",
    season: 2026,
    tier: "district",
    fieldSize: TEAM_COUNT,
    allianceCount: 8,
    remainingMatches: [],
    baselines,
    ratings,
    awardProfiles,
    awardSlate: buildDistrictAwardSlate({ season: 2026, awardField: baselines.map((baseline) => ({ teamKey: baseline.teamKey })), eligibility: [] }),
    ...overrides,
  };
}

function announcedAlliances(): SuppliedAlliance[] {
  return Array.from({ length: 8 }, (_unused, n) => ({
    allianceNumber: n + 1,
    picks: [teamKey(n + 1), teamKey(n + 9), teamKey(24 - n)],
  }));
}

describe("DistrictLedgerResult.captainFacts (quick task 261015-3oo)", () => {
  it("names rank 1 as alliance 1's captain and every team ranked 2k or lower as never captaining, at a fixed ranking with a drawn draft", () => {
    const result = simulateDistrictEvent(fixedRankingInput({ pickPositionPmf: PMF_2026 }), 200, 11);
    expect(result.randomDraft).toBe(true);
    expect(result.captainFacts).toEqual({
      allianceOneCaptain: teamKey(1),
      // Eight drafted alliances: the eighth captain ranks at most 15, so ranks 16 to 30 never captain.
      neverCaptain: Array.from({ length: TEAM_COUNT - 15 }, (_unused, n) => teamKey(16 + n)),
    });
  });

  it("agrees with every draw: rank 1 captains alliance 1 in all of them, and no never captain team captains in any", () => {
    const draws = 400;
    const result = simulateDistrictEvent(fixedRankingInput({ pickPositionPmf: PMF_2026 }), draws, 23);
    const facts = result.captainFacts!;
    const first = result.selectionRoutes.get(facts.allianceOneCaptain)!.bySlot[0]!;
    expect(first.draws).toBe(draws);
    expect(first.allianceNumber).toBe(1);
    for (const key of facts.neverCaptain) {
      expect(result.selectionRoutes.get(key)!.bySlot[0]!.draws, key).toBe(0);
    }
  });

  it("does not use observed zero captain draws as evidence: ranks 9 to 15 are never in neverCaptain", () => {
    const result = simulateDistrictEvent(fixedRankingInput({ pickPositionPmf: PMF_2026 }), 50, 5);
    const never = new Set(result.captainFacts!.neverCaptain);
    for (let rank = 9; rank <= 15; rank++) expect(never.has(teamKey(rank)), teamKey(rank)).toBe(false);
  });

  it("follows the drafted alliance count on a short roster", () => {
    // 17 teams draft floor(16 / 3) = 5 real alliances, so ranks 10 and lower never captain.
    const input = fixedRankingInput({ pickPositionPmf: PMF_2026 });
    const short: DistrictLedgerEventInput = {
      ...input,
      fieldSize: 17,
      baselines: input.baselines.slice(0, 17),
      awardSlate: buildDistrictAwardSlate({ season: 2026, awardField: input.baselines.slice(0, 17).map((b) => ({ teamKey: b.teamKey })), eligibility: [] }),
    };
    const result = simulateDistrictEvent(short, 100, 3);
    expect(result.captainFacts?.allianceOneCaptain).toBe(teamKey(1));
    expect(result.captainFacts?.neverCaptain).toEqual(Array.from({ length: 8 }, (_unused, n) => teamKey(10 + n)));
  });

  it("is absent with no pmf, with the degenerate pmf, with announced alliances and with matches still to play", () => {
    expect("captainFacts" in simulateDistrictEvent(fixedRankingInput(), 40, 7)).toBe(false);
    expect("captainFacts" in simulateDistrictEvent(fixedRankingInput({ pickPositionPmf: { firstPick: [1], secondPick: [1] } }), 40, 7)).toBe(false);
    expect("captainFacts" in simulateDistrictEvent(fixedRankingInput({ pickPositionPmf: PMF_2026, knownAlliances: announcedAlliances() }), 40, 7)).toBe(false);
    const open = fixedRankingInput({
      pickPositionPmf: PMF_2026,
      remainingMatches: [
        { redTeamKeys: [teamKey(1), teamKey(2), teamKey(3)], blueTeamKeys: [teamKey(4), teamKey(5), teamKey(6)], redRpPmf: [0.5, 0, 0.5], blueRpPmf: [0.5, 0, 0.5] },
      ],
    });
    expect("captainFacts" in simulateDistrictEvent(open, 40, 7)).toBe(false);
  });
});
