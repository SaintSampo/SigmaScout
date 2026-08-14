/**
 * Synthetic-fixture tests for cross-season carry (D-16/D-18/D-19), following
 * `opr.test.ts`/`epa.test.ts`'s convention: hand-computed values against a
 * small deterministic fixture.
 */
import { describe, expect, it } from "vitest";
import {
  carryNormalizedRating,
  epaCarryover,
  normalizedToSeasonUnits,
  EPA_CARRY_LAST_YEAR_WEIGHT,
  EPA_CARRY_PRIOR_YEAR_WEIGHT,
  EPA_MEAN_REVERSION,
  EPA_NORM_MEAN,
  EPA_NORM_SD,
  EPA_ROOKIE_BASELINE,
} from "./carryover.js";
import { epa, type EpaState } from "./epa.js";
import { emptyExpandingStats } from "../scoring/expandingStats.js";
import { COLD_START_SEASON, isColdStartSeason } from "./breakdown/index.js";
import type { SeasonBoundary } from "./types.js";

describe("EPA_ROOKIE_BASELINE", () => {
  it("is the expression NORM_MEAN - INIT_PENALTY * NORM_SD, evaluating to 1450", () => {
    expect(EPA_ROOKIE_BASELINE).toBe(1450);
    expect(EPA_ROOKIE_BASELINE).toBe(EPA_NORM_MEAN - 0.2 * EPA_NORM_SD);
  });
});

describe("carryNormalizedRating — both prior seasons present", () => {
  it("blends 0.7*lastYear + 0.3*yearBefore, then reverts 40% toward the rookie baseline", () => {
    const lastYear = 1600;
    const yearBefore = 1400;
    const blended = EPA_CARRY_LAST_YEAR_WEIGHT * lastYear + EPA_CARRY_PRIOR_YEAR_WEIGHT * yearBefore;
    const expected = blended + EPA_MEAN_REVERSION * (EPA_ROOKIE_BASELINE - blended);

    const result = carryNormalizedRating(lastYear, yearBefore);
    expect(result).toBeCloseTo(expected, 10);
    // Sanity: hand-computed. blended = 0.7*1600 + 0.3*1400 = 1540.
    // reverted = 1540 + 0.4*(1450-1540) = 1540 - 36 = 1504.
    expect(result).toBeCloseTo(1504, 10);
  });
});

describe("carryNormalizedRating — only the immediately-prior season present", () => {
  it("starts from that rating alone (missing prior year contributes nothing, never read as 0), then reverts 40% toward baseline", () => {
    const lastYear = 1700;
    const expected = lastYear + EPA_MEAN_REVERSION * (EPA_ROOKIE_BASELINE - lastYear);
    const result = carryNormalizedRating(lastYear, null);
    expect(result).toBeCloseTo(expected, 10);

    // Proves the missing input is NOT treated as 0: if it were, the blend
    // would instead compute 0.7*1700 + 0.3*0 = 1190, a materially
    // different (and wrong) pre-reversion value.
    const wrongIfZeroed = EPA_CARRY_LAST_YEAR_WEIGHT * lastYear + EPA_CARRY_PRIOR_YEAR_WEIGHT * 0;
    expect(result).not.toBeCloseTo(wrongIfZeroed + EPA_MEAN_REVERSION * (EPA_ROOKIE_BASELINE - wrongIfZeroed), 5);
  });

  it("is symmetric for the two-seasons-back-only case (a team that skipped the immediately-prior season)", () => {
    const yearBefore = 1550;
    const expected = yearBefore + EPA_MEAN_REVERSION * (EPA_ROOKIE_BASELINE - yearBefore);
    expect(carryNormalizedRating(null, yearBefore)).toBeCloseTo(expected, 10);
  });
});

describe("carryNormalizedRating — no rating history at all", () => {
  it("returns EPA_ROOKIE_BASELINE unchanged (a rookie team, 1450 in normalized units)", () => {
    expect(carryNormalizedRating(null, null)).toBe(EPA_ROOKIE_BASELINE);
  });
});

describe("normalizedToSeasonUnits — floor at zero", () => {
  it("never returns a negative season-unit rating", () => {
    // mean 0, sd 1: a normalized rating far below EPA_NORM_MEAN produces a
    // deeply negative raw z-score-scaled point value before flooring.
    const raw = normalizedToSeasonUnits(100, 0, 1);
    const unflooredZScore = (100 - EPA_NORM_MEAN) / EPA_NORM_SD;
    expect(unflooredZScore).toBeLessThan(0); // sanity: this fixture really does go negative pre-floor
    expect(raw).toBe(0);
  });

  it("returns a positive point value unchanged when the z-score-scaled result is already non-negative", () => {
    // normalized === EPA_NORM_MEAN maps to exactly seasonScoreMean (z === 0).
    expect(normalizedToSeasonUnits(EPA_NORM_MEAN, 50, 10)).toBeCloseTo(50, 10);
    // normalized above the mean maps above seasonScoreMean.
    expect(normalizedToSeasonUnits(EPA_NORM_MEAN + EPA_NORM_SD, 50, 10)).toBeCloseTo(60, 10);
  });

  it("falls back to seasonScoreMean (never NaN) when seasonScoreSd is 0", () => {
    const result = normalizedToSeasonUnits(1700, 40, 0);
    expect(result).toBe(40);
    expect(Number.isNaN(result)).toBe(false);
  });
});

function boundary(overrides: Partial<SeasonBoundary> = {}): SeasonBoundary {
  return { fromSeason: 2022, toSeason: 2023, isColdStart: false, ...overrides };
}

describe("epa.carrySeason — isColdStart short-circuit", () => {
  it("returns the initial state unchanged when boundary.isColdStart is true", () => {
    const state: EpaState = {
      season: 2022,
      teamComponents: new Map([["frc1", { autoLeave: 10 }]]),
      teamMatchCounts: new Map([["frc1", 5]]),
      allianceScoreStats: emptyExpandingStats(),
      fallbackSkipped: 0,
      priorSeasonRatings: { lastSeason: new Map(), yearBefore: new Map() },
    };

    const result = epa.carrySeason!(state, boundary({ fromSeason: 2021, toSeason: 2022, isColdStart: true }));
    expect(result).toBe(state);
  });
});

describe("isColdStartSeason — derived from COLD_START_SEASON, not a hardcoded 2022", () => {
  it("is true for COLD_START_SEASON and false for the season after it", () => {
    expect(isColdStartSeason(COLD_START_SEASON)).toBe(true);
    expect(isColdStartSeason(COLD_START_SEASON + 1)).toBe(false);
  });
});

describe("epaCarryover — pure season-boundary math", () => {
  it("a team with only one season of history (no yearBefore) carries a rating derived from that season alone", () => {
    const result = epaCarryover({
      teamTotals: new Map([
        ["frc1", 60],
        ["frc2", 40],
        ["frc3", 20],
      ]),
      priorSeasonRatings: { lastSeason: new Map(), yearBefore: new Map() },
    });

    expect(result.teamPointTotals.has("frc1")).toBe(true);
    expect(result.teamPointTotals.has("frc2")).toBe(true);
    expect(result.teamPointTotals.has("frc3")).toBe(true);
    // frc1's total (60) is above the population mean (40), so its carried
    // normalized rating starts above EPA_ROOKIE_BASELINE pre-reversion —
    // the post-reversion point value should still exceed frc3's (20, below
    // the mean).
    expect(result.teamPointTotals.get("frc1")!).toBeGreaterThan(result.teamPointTotals.get("frc3")!);
    // Every carried value is non-negative (the floor holds through the
    // whole pipeline, not just in isolation).
    for (const value of result.teamPointTotals.values()) {
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it("shifts priorSeasonRatings forward: the returned lastSeason is derived from teamTotals, and yearBefore is the input's old lastSeason", () => {
    const oldLastSeason = new Map([["frc1", 1600]]);
    const result = epaCarryover({
      teamTotals: new Map([["frc1", 50]]),
      priorSeasonRatings: { lastSeason: oldLastSeason, yearBefore: new Map([["frc1", 1300]]) },
    });

    expect(result.priorSeasonRatings.yearBefore).toBe(oldLastSeason);
    expect(result.priorSeasonRatings.lastSeason.get("frc1")).toBeDefined();
    // The new lastSeason is NOT the same map reference as the old one — it
    // was freshly derived from this boundary's teamTotals.
    expect(result.priorSeasonRatings.lastSeason).not.toBe(oldLastSeason);
  });

  it("a team present only in priorSeasonRatings.lastSeason (no current teamTotals entry) still gets a carried rating", () => {
    const result = epaCarryover({
      teamTotals: new Map(),
      priorSeasonRatings: { lastSeason: new Map([["frc9", 1500]]), yearBefore: new Map() },
    });
    expect(result.teamPointTotals.has("frc9")).toBe(true);
  });
});

describe("epa.carrySeason — end-to-end state carry", () => {
  it("a real season boundary produces non-cold-start component values for a team with prior history, seeded across the new season's registered components", () => {
    const state: EpaState = {
      season: 2022,
      teamComponents: new Map([
        ["frc1", { autoLeave: 40, teleop: 60 }], // total 100
        ["frc2", { autoLeave: 10, teleop: 20 }], // total 30
      ]),
      teamMatchCounts: new Map([
        ["frc1", 12],
        ["frc2", 8],
      ]),
      allianceScoreStats: emptyExpandingStats(),
      fallbackSkipped: 0,
      priorSeasonRatings: { lastSeason: new Map(), yearBefore: new Map() },
    };

    const next = epa.carrySeason!(state, boundary({ fromSeason: 2022, toSeason: 2023, isColdStart: false }));

    expect(next.season).toBe(2023);
    // Every team carried from 2022 has a seeded 2023 component record —
    // match counts reset to 0 for the new season.
    expect(next.teamMatchCounts.get("frc1")).toBe(0);
    expect(next.teamMatchCounts.get("frc2")).toBe(0);

    const frc1Components = next.teamComponents.get("frc1")!;
    const frc1Total = Object.values(frc1Components).reduce((sum, v) => sum + v, 0);
    // frc1 (the higher-scoring team last season) carries a higher starting
    // total into 2023 than frc2.
    const frc2Components = next.teamComponents.get("frc2")!;
    const frc2Total = Object.values(frc2Components).reduce((sum, v) => sum + v, 0);
    expect(frc1Total).toBeGreaterThan(frc2Total);

    // Every value is finite and non-negative — the floor holds through the
    // full carrySeason pipeline, not just epaCarryover in isolation.
    for (const value of Object.values(frc1Components)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it("seeds every component the new season's map registers, not just the components the old season happened to use", () => {
    // 2022's registered components differ from 2023's (see breakdown/2022.ts,
    // breakdown/2023.ts) — this proves carrySeason seeds against the
    // TO-season's map, not the from-season's component set.
    const state: EpaState = {
      season: 2022,
      teamComponents: new Map([["frc1", { autoTaxi: 5 }]]),
      teamMatchCounts: new Map([["frc1", 3]]),
      allianceScoreStats: emptyExpandingStats(),
      fallbackSkipped: 0,
      priorSeasonRatings: { lastSeason: new Map(), yearBefore: new Map() },
    };

    const next = epa.carrySeason!(state, boundary({ fromSeason: 2022, toSeason: 2023, isColdStart: false }));
    const frc1Components = next.teamComponents.get("frc1")!;
    // 2023's component map includes "link" (Charged Up), which 2022 never had.
    expect(Object.prototype.hasOwnProperty.call(frc1Components, "link")).toBe(true);
  });

  it("allianceScoreStats is carried forward unchanged, seeding the new season's expanding-window SD from the prior season's final value", () => {
    const state: EpaState = {
      season: 2022,
      teamComponents: new Map([["frc1", { autoLeave: 10 }]]),
      teamMatchCounts: new Map([["frc1", 3]]),
      allianceScoreStats: { count: 10, mean: 90, m2: 400 },
      fallbackSkipped: 0,
      priorSeasonRatings: { lastSeason: new Map(), yearBefore: new Map() },
    };

    const next = epa.carrySeason!(state, boundary({ fromSeason: 2022, toSeason: 2023, isColdStart: false }));
    expect(next.allianceScoreStats).toEqual({ count: 10, mean: 90, m2: 400 });
  });
});
