import { describe, expect, it } from "vitest";
import { PICK_POSITION_COUNTS } from "./pickPositionTables.js";
import { pickPositionPmfForSeason, pickPositionTableSeason } from "./pickDraft.js";
import { BRACKET_REGISTERED_SEASONS } from "./bracket.js";
import {
  simulateDistrictEvent,
  type DistrictAwardProfile,
  type DistrictLedgerEventInput,
  type SuppliedAlliance,
} from "./ledgerSimulation.js";
import { buildDistrictAwardSlate } from "./awardSlate.js";
import type { AllianceMemberRating } from "../algorithms/simulation/allianceWinProbability.js";
import type { SimTeamBaseline } from "../algorithms/simulation/rankSimulation.js";

const TABLE_SEASONS = Object.keys(PICK_POSITION_COUNTS)
  .map(Number)
  .sort((a, b) => a - b);
const OLDEST = TABLE_SEASONS[0]!;
const NEWEST = TABLE_SEASONS[TABLE_SEASONS.length - 1]!;

const sumLeftToRight = (values: readonly number[]): number => values.reduce((x, y) => x + y, 0);

describe("pickPositionPmfForSeason, the shipped weighted pick draft's one source (quick task 261014-ol6)", () => {
  it("is each table's counts over its total, exactly, for every season with a table", () => {
    for (const season of TABLE_SEASONS) {
      const counts = PICK_POSITION_COUNTS[season]!;
      const pmf = pickPositionPmfForSeason(season)!;
      for (const round of ["firstPick", "secondPick"] as const) {
        const total = sumLeftToRight(counts[round]);
        expect(pmf[round]).toHaveLength(counts[round].length);
        expect(pmf[round]).toEqual(counts[round].map((count) => count / total));
        expect(Math.abs(sumLeftToRight(pmf[round]) - 1)).toBeLessThan(1e-12);
      }
    }
  });

  it("is walk forward over every season from 2016 to 2040: never a table that holds the season's own or later drafts", () => {
    const from = Math.min(2016, OLDEST - 1);
    const to = Math.max(2040, NEWEST + 8);
    for (let season = from; season <= to; season++) {
      const key = pickPositionTableSeason(season);
      const pmf = pickPositionPmfForSeason(season);
      if (season < OLDEST) {
        expect(key, `season ${String(season)}`).toBeUndefined();
        expect(pmf, `season ${String(season)}`).toBeUndefined();
        continue;
      }
      expect(key, `season ${String(season)}`).toBeDefined();
      expect(PICK_POSITION_COUNTS[key!]!.seasonsTo).toBeLessThan(season);
      if (season <= NEWEST) expect(key).toBe(season);
      expect(pmf).toBe(pickPositionPmfForSeason(key!));
    }
  });

  it("falls back to the NEWEST table for a season newer than every table", () => {
    const newest = pickPositionPmfForSeason(NEWEST);
    expect(pickPositionPmfForSeason(NEWEST + 1)).toEqual(newest);
    expect(pickPositionPmfForSeason(NEWEST + 8)).toEqual(newest);
  });

  it("covers every season the simulation accepts, so no simulable season can fall back to the fixed draft", () => {
    for (const season of BRACKET_REGISTERED_SEASONS) {
      expect(pickPositionPmfForSeason(season), `season ${String(season)}`).toBeDefined();
    }
  });

  it("returns the same frozen object on every call", () => {
    for (const season of TABLE_SEASONS) {
      const pmf = pickPositionPmfForSeason(season)!;
      expect(pickPositionPmfForSeason(season)).toBe(pmf);
      expect(Object.isFrozen(pmf)).toBe(true);
      expect(Object.isFrozen(pmf.firstPick)).toBe(true);
      expect(Object.isFrozen(pmf.secondPick)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The core flag that says the picks were drawn.
// ---------------------------------------------------------------------------

const TEAM_COUNT = 30;
const teamKey = (n: number): string => `frc${String(100 + n)}`;

/** Thirty teams at a fixed ranking (no remaining matches), SPR a permutation of rank. */
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
    eventKey: "2026zzpick",
    season: 2026,
    tier: "district",
    fieldSize: TEAM_COUNT,
    allianceCount: 8,
    remainingMatches: [],
    baselines,
    ratings,
    awardProfiles,
    // Every district tier event whose awards are open carries an award slate
    // since quick task 261014-qje (Q-01).
    awardSlate: buildDistrictAwardSlate({ season: 2026, awardField: baselines.map((baseline) => ({ teamKey: baseline.teamKey })), eligibility: [] }),
    ...overrides,
  };
}

/** Eight announced alliances of three from the thirty teams. */
function announcedAlliances(): SuppliedAlliance[] {
  return Array.from({ length: 8 }, (_unused, n) => ({
    allianceNumber: n + 1,
    picks: [teamKey(n + 1), teamKey(n + 9), teamKey(24 - n)],
  }));
}

describe("DistrictLedgerResult.randomDraft, the flag that the picks were drawn (quick task 261014-ol6)", () => {
  const PMF_2026 = pickPositionPmfForSeason(2026)!;

  it("is true for a run at a fixed ranking with the 2026 pmf and no announced alliances", () => {
    const result = simulateDistrictEvent(fixedRankingInput({ pickPositionPmf: PMF_2026 }), 40, 7);
    expect(result.rankingFixed).toBe(true);
    expect(result.randomDraft).toBe(true);
  });

  it("is absent with no pmf", () => {
    const result = simulateDistrictEvent(fixedRankingInput(), 40, 7);
    expect("randomDraft" in result).toBe(false);
  });

  it("is absent with the degenerate pmf [1], which draws position 1 every turn", () => {
    const result = simulateDistrictEvent(fixedRankingInput({ pickPositionPmf: { firstPick: [1], secondPick: [1] } }), 40, 7);
    expect("randomDraft" in result).toBe(false);
  });

  it("is absent when the alliances are announced, because the draft does not run", () => {
    const result = simulateDistrictEvent(
      fixedRankingInput({ pickPositionPmf: PMF_2026, knownAlliances: announcedAlliances() }),
      40,
      7
    );
    expect("randomDraft" in result).toBe(false);
  });
});
