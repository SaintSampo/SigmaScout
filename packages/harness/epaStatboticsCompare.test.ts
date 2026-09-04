import { describe, it, expect } from "vitest";
import {
  ordinaryLeastSquaresSlope,
  pearson,
  meanAbsoluteDifference,
  sampleStandardDeviation,
  joinTeams,
  compareSeason,
  checkAgainstTolerance,
  EmptyJoinError,
  type OurTeamValue,
  type TheirTeamRow,
} from "./epaStatboticsCompare.js";

describe("ordinaryLeastSquaresSlope", () => {
  it("returns the known slope of an exactly-linear fixture, regressing ours on theirs", () => {
    // theirs = 2 * ours + 3  =>  ours = 0.5 * theirs - 1.5  =>  slope (coefficient of theirs) is 0.5
    const ours = [1, 2, 3, 4, 5];
    const theirs = ours.map((o) => 2 * o + 3);
    expect(ordinaryLeastSquaresSlope(ours, theirs)).toBeCloseTo(0.5, 10);
  });

  it("throws on mismatched or empty series", () => {
    expect(() => ordinaryLeastSquaresSlope([1, 2], [1])).toThrow();
    expect(() => ordinaryLeastSquaresSlope([], [])).toThrow();
  });
});

describe("pearson", () => {
  it("returns 1 for a perfectly ascending pair", () => {
    expect(pearson([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 10);
  });

  it("returns -1 for a perfectly descending pair", () => {
    expect(pearson([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 10);
  });

  it("matches a hand-computed value for a third fixture", () => {
    // x = [1,2,3,4,5], y = [2,1,4,3,5]
    // meanX=3, meanY=3
    // dx=[-2,-1,0,1,2], dy=[-1,-2,1,0,2]
    // numerator = 2+2+0+0+4 = 8
    // denomX = 4+1+0+1+4 = 10, denomY = 1+4+1+0+4 = 10
    // pearson = 8 / sqrt(10*10) = 0.8
    expect(pearson([1, 2, 3, 4, 5], [2, 1, 4, 3, 5])).toBeCloseTo(0.8, 10);
  });
});

describe("meanAbsoluteDifference", () => {
  it("returns the hand-computed mean of absolute residuals", () => {
    // |1-2| + |2-5| + |3-3| = 1 + 3 + 0 = 4, mean = 4/3
    expect(meanAbsoluteDifference([1, 2, 3], [2, 5, 3])).toBeCloseTo(4 / 3, 10);
  });
});

describe("sampleStandardDeviation", () => {
  it("matches a hand-computed value", () => {
    // values = [2,4,4,4,5,5,7,9], mean=5, sample variance = 32/7
    const values = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(sampleStandardDeviation(values)).toBeCloseTo(Math.sqrt(32 / 7), 10);
  });

  it("is undefined for fewer than two observations", () => {
    expect(sampleStandardDeviation([])).toBeUndefined();
    expect(sampleStandardDeviation([5])).toBeUndefined();
  });
});

describe("joinTeams", () => {
  const ours: OurTeamValue[] = [
    { teamKey: "frc1", value: 10 },
    { teamKey: "frc2", value: 20 },
    { teamKey: "frc9970", value: 999 }, // demo key, must be dropped
    { teamKey: "demo-pseudo-unregistered", value: 999 }, // pseudo key, must be dropped
    { teamKey: "frc3", value: 30 }, // no Statbotics counterpart
  ];
  const theirs: TheirTeamRow[] = [
    { teamKey: "frc1", value: 11, matchCount: 20 },
    { teamKey: "frc2", value: 19, matchCount: 5 },
    { teamKey: "frc4", value: 40, matchCount: 15 }, // no our-side counterpart
    { teamKey: "frc9970", value: 500, matchCount: 30 }, // demo key, must be dropped
  ];

  it("drops demo keys from both sides and drops teams present on only one side", () => {
    const result = joinTeams(ours, theirs);
    expect(result.ourCount).toBe(3); // frc1, frc2, frc3 (demo + pseudo dropped)
    expect(result.theirCount).toBe(3); // frc1, frc2, frc4 (demo dropped)
    expect(result.joinedCount).toBe(2); // frc1, frc2
    expect(result.pairs.map((p) => p.teamKey).sort()).toEqual(["frc1", "frc2"]);
  });

  it("applies a minimum-match filter when given one", () => {
    const result = joinTeams(ours, theirs, 10);
    // frc2's matchCount (5) is below threshold -> dropped before the join;
    // frc4 (15) survives the filter but has no our-side counterpart, so it
    // counts toward theirCount but not joinedCount.
    expect(result.theirCount).toBe(2); // frc1, frc4
    expect(result.joinedCount).toBe(1);
    expect(result.pairs[0]!.teamKey).toBe("frc1");
  });
});

describe("compareSeason", () => {
  it("composes join + statistics into one result object", () => {
    const ours: OurTeamValue[] = [
      { teamKey: "frc1", value: 10 },
      { teamKey: "frc2", value: 20 },
      { teamKey: "frc3", value: 30 },
    ];
    const theirs: TheirTeamRow[] = [
      { teamKey: "frc1", value: 12, matchCount: 15 },
      { teamKey: "frc2", value: 22, matchCount: 15 },
      { teamKey: "frc3", value: 32, matchCount: 15 },
    ];
    const result = compareSeason(2025, ours, theirs);
    expect(result.joinedCount).toBe(3);
    expect(result.pearson).toBeCloseTo(1, 5);
    expect(result.meanAbsoluteDifference).toBeCloseTo(2, 10);
  });

  it("throws rather than returning vacuous perfect agreement on an empty join", () => {
    const ours: OurTeamValue[] = [{ teamKey: "frc1", value: 10 }];
    const theirs: TheirTeamRow[] = [{ teamKey: "frc2", value: 10, matchCount: 15 }];
    expect(() => compareSeason(2025, ours, theirs)).toThrow(EmptyJoinError);
  });
});

describe("checkAgainstTolerance", () => {
  it("returns the list of statistics outside a supplied band", () => {
    const measured = { slope: 0.9, pearson: 0.5, mad: 4 };
    const bands = {
      slope: { min: 0.8, max: 1.0 },
      pearson: { min: 0.8, max: 1.0 }, // 0.5 is out of band
      mad: { min: 0, max: 10 },
    };
    const violations = checkAgainstTolerance(measured, bands);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.statistic).toBe("pearson");
  });

  it("returns an empty list when every statistic is inside its band", () => {
    const measured = { slope: 0.9, pearson: 0.95 };
    const bands = {
      slope: { min: 0.8, max: 1.0 },
      pearson: { min: 0.8, max: 1.0 },
    };
    expect(checkAgainstTolerance(measured, bands)).toEqual([]);
  });
});
