/**
 * normalizeEventRankings / tbaEventRankingsResponseSchema tests (TEAM-04,
 * F-06-3, threat T-06.1-01/T-06.1-02, plan 06.1-01 Task 2; widened for
 * D-18.6's sort-order guard and record/ranking-score fields, plan 07-04
 * Task 1), from real-shaped TBA rankings fixtures per
 * 06.1-RESEARCH.md/07-RESEARCH.md's live-confirmed Code Examples. Mirrors
 * `media.test.ts`'s fixture-factory structure — one factory per shape, each
 * case states only what it varies.
 */
import { describe, expect, it } from "vitest";
import {
  RANKING_SCORE_SORT_ORDER_INDEX,
  RANKING_SCORE_SORT_ORDER_NAME,
  RankingScoreSortOrderError,
  normalizeEventRankings,
} from "./rankings.js";
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

  it("throws on a drifted payload — rank is non-integral (WR-01, never silently coerced into a SQLite INTEGER column)", () => {
    const drifted = { ...rankingsResponse(), rankings: [{ ...rankingEntry(), rank: 3.5 }] };
    expect(() => tbaEventRankingsResponseSchema.parse(drifted)).toThrow();
  });
});

describe("normalizeEventRankings", () => {
  it("a populated response of N=30 entries normalizes to 30 records, each carrying totalTeams: 30", () => {
    const entries = Array.from({ length: 30 }, (_, i) => rankingEntry({ rank: i + 1, team_key: `frc${i + 1}` }));
    const response = rankingsResponse({ rankings: entries });
    const result = normalizeEventRankings(response, "2026test");
    expect(result).toHaveLength(30);
    expect(result.every((r) => r.totalTeams === 30)).toBe(true);
  });

  it("preserves team_key and rank verbatim from a populated response", () => {
    const response = rankingsResponse({
      rankings: [rankingEntry({ rank: 7, team_key: "frc118" }), rankingEntry({ rank: 3, team_key: "frc971" })],
    });
    const result = normalizeEventRankings(response, "2026test");
    expect(result).toEqual([
      { teamKey: "frc118", rank: 7, totalTeams: 2, recordWins: 8, recordLosses: 2, recordTies: 0, rankingScore: 2.5 },
      { teamKey: "frc971", rank: 3, totalTeams: 2, recordWins: 8, recordLosses: 2, recordTies: 0, rankingScore: 2.5 },
    ]);
  });

  it("normalizes a null response to an empty array, does not throw, even though its (absent) sort-order vocabulary could not possibly match", () => {
    expect(() => normalizeEventRankings(null, "2026test")).not.toThrow();
    expect(normalizeEventRankings(null, "2026test")).toEqual([]);
  });

  it("normalizes a response with an empty rankings array to an empty array — a SEPARATE case from the null-response case, never a synthetic record and never totalTeams: 0", () => {
    const response = rankingsResponse({ rankings: [] });
    expect(normalizeEventRankings(response, "2026test")).toEqual([]);
  });

  it("a response with an empty rankings array AND a drifted sort_order_info still returns [] and does not throw — the guard is unreachable when there is nothing to store", () => {
    const response = rankingsResponse({
      rankings: [],
      sort_order_info: [{ name: "Some Other Stat", precision: 2 }],
    });
    expect(() => normalizeEventRankings(response, "2026test")).not.toThrow();
    expect(normalizeEventRankings(response, "2026test")).toEqual([]);
  });

  it("a single-entry response yields exactly one record with rank: 1 and totalTeams: 1 — the smallest non-empty pool", () => {
    const response = rankingsResponse({ rankings: [rankingEntry({ rank: 1, team_key: "frc9999" })] });
    const result = normalizeEventRankings(response, "2026test");
    expect(result).toEqual([
      { teamKey: "frc9999", rank: 1, totalTeams: 1, recordWins: 8, recordLosses: 2, recordTies: 0, rankingScore: 2.5 },
    ]);
  });

  describe("D-18.6 sort-order guard", () => {
    it("a populated response whose position-0 sort-order name matches the exported constant normalizes without throwing and returns one record per ranking entry", () => {
      const response = rankingsResponse({
        rankings: [rankingEntry({ team_key: "frc1" }), rankingEntry({ team_key: "frc2" })],
      });
      expect(() => normalizeEventRankings(response, "2026test")).not.toThrow();
      expect(normalizeEventRankings(response, "2026test")).toHaveLength(2);
    });

    it("a populated response whose position-0 sort-order name is a different string throws RankingScoreSortOrderError naming the event key and the observed name", () => {
      const drifted = rankingsResponse({
        sort_order_info: [
          { name: "Not Ranking Score", precision: 2 },
          { name: "Avg Match", precision: 1 },
        ],
      });
      expect(() => normalizeEventRankings(drifted, "2026xyz")).toThrow(RankingScoreSortOrderError);
      try {
        normalizeEventRankings(drifted, "2026xyz");
        expect.unreachable("expected normalizeEventRankings to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(RankingScoreSortOrderError);
        const message = (err as Error).message;
        expect(message).toContain("2026xyz");
        expect(message).toContain("Not Ranking Score");
      }
    });

    it("a populated response whose sort_order_info is an empty array throws RankingScoreSortOrderError, reporting the observed name as explicitly absent rather than as an empty string", () => {
      const drifted = rankingsResponse({ sort_order_info: [] });
      expect(() => normalizeEventRankings(drifted, "2026xyz")).toThrow(RankingScoreSortOrderError);
      try {
        normalizeEventRankings(drifted, "2026xyz");
        expect.unreachable("expected normalizeEventRankings to throw");
      } catch (err) {
        const message = (err as Error).message;
        expect(message).not.toMatch(/name === ""/);
        expect(message).toMatch(/absent/i);
      }
    });

    it("RANKING_SCORE_SORT_ORDER_INDEX is 0 and RANKING_SCORE_SORT_ORDER_NAME equals a locally-written string literal, not an import of itself", () => {
      expect(RANKING_SCORE_SORT_ORDER_INDEX).toBe(0);
      expect(RANKING_SCORE_SORT_ORDER_NAME).toBe("Ranking Score");
    });
  });

  describe("D-18.6 record and ranking-score fields", () => {
    it("each returned record's recordWins/recordLosses/recordTies equal the corresponding record.wins/record.losses/record.ties verbatim, including a 0", () => {
      const response = rankingsResponse({
        rankings: [rankingEntry({ record: { wins: 0, losses: 5, ties: 1 } })],
      });
      const result = normalizeEventRankings(response, "2026test");
      expect(result[0]?.recordWins).toBe(0);
      expect(result[0]?.recordLosses).toBe(5);
      expect(result[0]?.recordTies).toBe(1);
    });

    it("a ranking entry with sort_orders: null returns rankingScore: null, asserted with toBeNull()", () => {
      const response = rankingsResponse({ rankings: [rankingEntry({ sort_orders: null })] });
      const result = normalizeEventRankings(response, "2026test");
      expect(result[0]?.rankingScore).toBeNull();
    });

    it("a ranking entry with sort_orders: [] (non-null but no element at the asserted index) returns rankingScore: null, not undefined and not 0", () => {
      const response = rankingsResponse({ rankings: [rankingEntry({ sort_orders: [] })] });
      const result = normalizeEventRankings(response, "2026test");
      expect(result[0]?.rankingScore).toBeNull();
      expect(result[0]?.rankingScore).not.toBeUndefined();
      expect(result[0]?.rankingScore).not.toBe(0);
    });

    it("a ranking entry whose value at the asserted index is exactly 0 returns rankingScore: 0, distinguishable from null", () => {
      const response = rankingsResponse({ rankings: [rankingEntry({ sort_orders: [0, 1.8, 0.6, 0.4] })] });
      const result = normalizeEventRankings(response, "2026test");
      expect(result[0]?.rankingScore).toBe(0);
      expect(result[0]?.rankingScore).not.toBeNull();
    });

    it("a fractional value at the asserted index round-trips unrounded — precision from sort_order_info is never applied", () => {
      const response = rankingsResponse({ rankings: [rankingEntry({ sort_orders: [2.567891, 1.8, 0.6, 0.4] })] });
      const result = normalizeEventRankings(response, "2026test");
      expect(result[0]?.rankingScore).toBe(2.567891);
      expect(result[0]?.rankingScore).not.toBe(Math.round(2.567891));
    });

    it("two entries carrying identical values at the asserted index normalize to two separate records preserving their two distinct rank values, in TBA's array order, with no merge and no re-sort", () => {
      const response = rankingsResponse({
        rankings: [
          rankingEntry({ rank: 5, team_key: "frc100", sort_orders: [3.0, 1, 1, 1] }),
          rankingEntry({ rank: 2, team_key: "frc200", sort_orders: [3.0, 1, 1, 1] }),
        ],
      });
      const result = normalizeEventRankings(response, "2026test");
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ teamKey: "frc100", rank: 5, rankingScore: 3.0 });
      expect(result[1]).toMatchObject({ teamKey: "frc200", rank: 2, rankingScore: 3.0 });
    });

    it("a response whose entries are in a deliberately non-rank order returns records in that same array order, and every record's totalTeams equals rankings.length", () => {
      const response = rankingsResponse({
        rankings: [
          rankingEntry({ rank: 8, team_key: "frcA" }),
          rankingEntry({ rank: 1, team_key: "frcB" }),
          rankingEntry({ rank: 4, team_key: "frcC" }),
        ],
      });
      const result = normalizeEventRankings(response, "2026test");
      expect(result.map((r) => r.teamKey)).toEqual(["frcA", "frcB", "frcC"]);
      expect(result.every((r) => r.totalTeams === 3)).toBe(true);
    });
  });
});
