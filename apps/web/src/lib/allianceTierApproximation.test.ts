import { describe, expect, it } from "vitest";
import { TOTAL_KEY } from "./metricKeys";
import { buildTeamValuePercentilePoints, estimateCombinedTier, type TierApproximationPoint } from "./allianceTierApproximation";

/** Six teams evenly spaced 10..60 in value, percentile equal to value for easy hand-checking. */
const POINTS: TierApproximationPoint[] = [
  { value: 10, percentile: 10 },
  { value: 20, percentile: 20 },
  { value: 30, percentile: 55 },
  { value: 40, percentile: 80 },
  { value: 50, percentile: 96 },
  { value: 60, percentile: 100 },
];

describe("estimateCombinedTier — the 3x heuristic (07-UAT.md G-8)", () => {
  it("returns undefined when there are no points to interpolate against", () => {
    expect(estimateCombinedTier(90, [])).toBeUndefined();
  });

  it("a combined value whose /3 equals a published point's value returns that point's exact percentile and tier", () => {
    // 90 / 3 = 30 -> percentile 55 -> Rare band.
    const result = estimateCombinedTier(90, POINTS);
    expect(result?.percentile).toBe(55);
    expect(result?.tier).toBe("rare");
  });

  it("interpolates linearly between two bracketing points", () => {
    // 105 / 3 = 35, halfway between (30, 55) and (40, 80) -> percentile 67.5, still under the
    // Epic cut of 75 -> Rare.
    const result = estimateCombinedTier(105, POINTS);
    expect(result?.percentile).toBeCloseTo(67.5, 5);
    expect(result?.tier).toBe("rare");
  });

  it("clamps to the first point's percentile when the per-team-equivalent is below the observed range, never extrapolating", () => {
    // 3 / 3 = 1, below the lowest published value of 10.
    const result = estimateCombinedTier(3, POINTS);
    expect(result?.percentile).toBe(10);
    expect(result?.tier).toBe("common");
  });

  it("clamps to the last point's percentile when the per-team-equivalent is above the observed range, never extrapolating", () => {
    // 300 / 3 = 100, above the highest published value of 60.
    const result = estimateCombinedTier(300, POINTS);
    expect(result?.percentile).toBe(100);
    expect(result?.tier).toBe("legendary");
  });

  it("a single-point pool clamps every input to that one point's percentile", () => {
    const single: TierApproximationPoint[] = [{ value: 25, percentile: 62 }];
    expect(estimateCombinedTier(30, single)?.percentile).toBe(62);
    expect(estimateCombinedTier(300, single)?.percentile).toBe(62);
  });

  it("dividing by 3 means three teams each individually AT the same value as a published point produce that point's tier", () => {
    // Three teams each at value 40 (percentile 80, Epic) combine to 120 -> /3 = 40 -> exact match.
    const result = estimateCombinedTier(120, POINTS);
    expect(result?.percentile).toBe(80);
    expect(result?.tier).toBe("epic");
  });
});

function team(overrides: { teamKey?: string; total?: { value: number; spread?: number; percentile?: number } } = {}) {
  return {
    teamKey: overrides.teamKey ?? "frc1",
    teamNumber: 1,
    metrics: overrides.total === undefined ? {} : { [TOTAL_KEY]: overrides.total },
  };
}

describe("buildTeamValuePercentilePoints — event roster to interpolation points (07-UAT.md G-8)", () => {
  it("skips a team with no published total metric at all", () => {
    const teams = [team({ teamKey: "frc1", total: { value: 10, percentile: 20 } }), team({ teamKey: "frc2" })];
    expect(buildTeamValuePercentilePoints(teams as never)).toEqual([{ value: 10, percentile: 20 }]);
  });

  it("skips a team whose total metric has no published percentile — never treats it as value 0", () => {
    const teams = [
      team({ teamKey: "frc1", total: { value: 10, percentile: 20 } }),
      team({ teamKey: "frc2", total: { value: 5, spread: 1 } }),
    ];
    const points = buildTeamValuePercentilePoints(teams as never);
    expect(points).toEqual([{ value: 10, percentile: 20 }]);
    expect(points.some((p) => p.value === 0)).toBe(false);
  });

  it("returns points sorted ascending by value regardless of input order", () => {
    const teams = [
      team({ teamKey: "frc3", total: { value: 30, percentile: 70 } }),
      team({ teamKey: "frc1", total: { value: 10, percentile: 20 } }),
      team({ teamKey: "frc2", total: { value: 20, percentile: 45 } }),
    ];
    expect(buildTeamValuePercentilePoints(teams as never).map((p) => p.value)).toEqual([10, 20, 30]);
  });

  it("an empty teams array produces an empty points array", () => {
    expect(buildTeamValuePercentilePoints([] as never)).toEqual([]);
  });
});
