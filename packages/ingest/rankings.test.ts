/**
 * normalizeEventRankings / tbaEventRankingsResponseSchema tests (TEAM-04,
 * F-06-3, threat T-06.1-01/T-06.1-02, plan 06.1-01 Task 2), from
 * real-shaped TBA rankings fixtures per 06.1-RESEARCH.md's live-confirmed
 * Code Examples. Mirrors `media.test.ts`'s fixture-factory structure — one
 * factory per shape, each case states only what it varies.
 */
import { describe, expect, it } from "vitest";
import { normalizeEventRankings } from "./rankings.js";
import { tbaEventRankingsResponseSchema, type TbaEventRanking, type TbaEventRankingsResponse } from "./schemas.js";

function rankingEntry(overrides: Partial<TbaEventRanking> = {}): TbaEventRanking {
  return {
    rank: 1,
    team_key: "frc254",
    matches_played: 10,
    dq: 0,
    qual_average: null,
    sort_orders: [2.5, 1.8, 0.6, 0.4],
    extra_stats: [120],
    record: { wins: 8, losses: 2, ties: 0 },
    ...overrides,
  };
}

function rankingsResponse(
  overrides: Partial<NonNullable<TbaEventRankingsResponse>> = {}
): NonNullable<TbaEventRankingsResponse> {
  return {
    rankings: [rankingEntry()],
    sort_order_info: [
      { name: "Ranking Score", precision: 2 },
      { name: "Avg Match", precision: 1 },
      { name: "Avg Hangar", precision: 1 },
      { name: "Avg Taxi + Auto Cargo", precision: 1 },
    ],
    extra_stats_info: [{ name: "Total Points", precision: 0 }],
    ...overrides,
  };
}

describe("tbaEventRankingsResponseSchema", () => {
  it("parses a null body without throwing and yields null (T-06.1-02, Pitfall 2)", () => {
    expect(() => tbaEventRankingsResponseSchema.parse(null)).not.toThrow();
    expect(tbaEventRankingsResponseSchema.parse(null)).toBeNull();
  });

  it("parses a populated response with 2024-shaped sort_order_info (5 names)", () => {
    const response = rankingsResponse({
      sort_order_info: [
        { name: "Ranking Score", precision: 2 },
        { name: "Avg Coop", precision: 1 },
        { name: "Avg Match", precision: 1 },
        { name: "Avg Hangar", precision: 1 },
        { name: "Avg Taxi + Auto Cargo", precision: 1 },
      ],
    });
    expect(() => tbaEventRankingsResponseSchema.parse(response)).not.toThrow();
  });

  it("parses a populated response with 2026-shaped sort_order_info (3 differently-named entries) — Pitfall 3, no code path depends on these names", () => {
    const response = rankingsResponse({
      sort_order_info: [
        { name: "Ranking Score", precision: 2 },
        { name: "Avg Auto Fuel", precision: 1 },
        { name: "Avg Tower", precision: 1 },
      ],
    });
    expect(() => tbaEventRankingsResponseSchema.parse(response)).not.toThrow();
  });

  it("parses qual_average/sort_orders/extra_stats when all null (observed live in every 2022-2026 sample)", () => {
    const response = rankingsResponse({
      rankings: [rankingEntry({ qual_average: null, sort_orders: null, extra_stats: null })],
    });
    expect(() => tbaEventRankingsResponseSchema.parse(response)).not.toThrow();
  });

  it("throws on a drifted payload — team_key renamed to teamKey (T-06.1-01, schema drift is loud, never coerced)", () => {
    const drifted = {
      ...rankingsResponse(),
      rankings: [{ ...rankingEntry(), team_key: undefined, teamKey: "frc254" }],
    };
    expect(() => tbaEventRankingsResponseSchema.parse(drifted)).toThrow();
  });

  it("throws on a drifted payload — rank retyped as a string", () => {
    const drifted = { ...rankingsResponse(), rankings: [{ ...rankingEntry(), rank: "1" }] };
    expect(() => tbaEventRankingsResponseSchema.parse(drifted)).toThrow();
  });
});

describe("normalizeEventRankings", () => {
  it("a populated response of N=30 entries normalizes to 30 records, each carrying totalTeams: 30", () => {
    const entries = Array.from({ length: 30 }, (_, i) => rankingEntry({ rank: i + 1, team_key: `frc${i + 1}` }));
    const response = rankingsResponse({ rankings: entries });
    const result = normalizeEventRankings(response);
    expect(result).toHaveLength(30);
    expect(result.every((r) => r.totalTeams === 30)).toBe(true);
  });

  it("preserves team_key and rank verbatim from a populated response", () => {
    const response = rankingsResponse({
      rankings: [rankingEntry({ rank: 7, team_key: "frc118" }), rankingEntry({ rank: 3, team_key: "frc971" })],
    });
    const result = normalizeEventRankings(response);
    expect(result).toEqual([
      { teamKey: "frc118", rank: 7, totalTeams: 2 },
      { teamKey: "frc971", rank: 3, totalTeams: 2 },
    ]);
  });

  it("normalizes a null response to an empty array, does not throw", () => {
    expect(() => normalizeEventRankings(null)).not.toThrow();
    expect(normalizeEventRankings(null)).toEqual([]);
  });

  it("normalizes a response with an empty rankings array to an empty array — a SEPARATE case from the null-response case, never a synthetic record and never totalTeams: 0", () => {
    const response = rankingsResponse({ rankings: [] });
    expect(normalizeEventRankings(response)).toEqual([]);
  });

  it("a single-entry response yields exactly one record with rank: 1 and totalTeams: 1 — the smallest non-empty pool", () => {
    const response = rankingsResponse({ rankings: [rankingEntry({ rank: 1, team_key: "frc9999" })] });
    const result = normalizeEventRankings(response);
    expect(result).toEqual([{ teamKey: "frc9999", rank: 1, totalTeams: 1 }]);
  });
});
