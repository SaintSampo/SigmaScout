/**
 * Coverage for the rating-local expected-consistency curve and the published
 * consistency metric it feeds (today SPR's `sigma` entry). Ported by quick task
 * 260913-it4 with identical fixtures and expected numbers from the tests of the
 * module this construction was relocated from (quick task 260909-tgf, Task 1).
 *
 * D1 locked the RESIDUAL framing; the running-median-over-rating-neighbours
 * functional form was that task's discretion -- see `consistencyMetric.ts`'s
 * file header for the rationale and the two rejected alternatives (coefficient
 * of variation, rating-decile strata).
 */
import { describe, expect, it } from "vitest";
import { TOTAL_METRIC_KEY, type TeamMetrics } from "../core/algorithms/types.js";
import { consistencyMetricByTeam, expectedConsistencyByTeam } from "./consistencyMetric.js";
import { SIGMA_METRIC_KEY } from "./sigmaScore.js";

/** Builds a smooth linear figure-vs-rating pool with tiny deterministic jitter so the fit is not trivially exact. */
function buildLinearPool(n: number, slope: number, intercept: number, jitterAmplitude = 0.2) {
  const valueByTeam = new Map<string, number>();
  const ratingByTeam = new Map<string, number>();
  const teamKeys: string[] = [];
  for (let i = 0; i < n; i++) {
    const teamKey = `frc${i}`;
    teamKeys.push(teamKey);
    const rating = i;
    const jitter = jitterAmplitude * Math.sin(i * 0.7);
    ratingByTeam.set(teamKey, rating);
    valueByTeam.set(teamKey, intercept + slope * rating + jitter);
  }
  return { valueByTeam, ratingByTeam, teamKeys };
}

function toMetricsByTeam(ratingByTeam: ReadonlyMap<string, number>): TeamMetrics {
  const metrics: TeamMetrics = {};
  for (const [teamKey, rating] of ratingByTeam) {
    metrics[teamKey] = { [TOTAL_METRIC_KEY]: { value: rating } };
  }
  return metrics;
}

describe("expectedConsistencyByTeam", () => {
  it("returns, for each team in a linear figure-vs-rating pool, an expected value close to that team's own figure", () => {
    const { valueByTeam, ratingByTeam, teamKeys } = buildLinearPool(200, 0.1, 2);
    const expected = expectedConsistencyByTeam(valueByTeam, ratingByTeam, teamKeys);

    let maxAbsResidual = 0;
    let valueMin = Infinity;
    let valueMax = -Infinity;
    for (const teamKey of teamKeys) {
      const actual = valueByTeam.get(teamKey)!;
      const exp = expected.get(teamKey)!;
      maxAbsResidual = Math.max(maxAbsResidual, Math.abs(actual - exp));
      valueMin = Math.min(valueMin, actual);
      valueMax = Math.max(valueMax, actual);
    }
    const valueRange = valueMax - valueMin;
    // The property that kills "strong robots are automatically inconsistent":
    // residuals stay small relative to the whole range of figures across the pool.
    expect(maxAbsResidual).toBeLessThan(valueRange * 0.1);
  });

  it("a single extreme outlier team (figure 10x its neighbours) does not drag the curve -- neighbours' expected values shift by less than a stated tolerance", () => {
    const { valueByTeam, ratingByTeam, teamKeys } = buildLinearPool(200, 0.05, 1);
    const trendAt = (rating: number) => 1 + 0.05 * rating;

    const outlierKey = "frc100";
    const outlierValue = trendAt(ratingByTeam.get(outlierKey)!) * 10;
    const perturbedValueByTeam = new Map(valueByTeam);
    perturbedValueByTeam.set(outlierKey, outlierValue);

    const expected = expectedConsistencyByTeam(perturbedValueByTeam, ratingByTeam, teamKeys);

    const neighbourKey = "frc99";
    const neighbourExpected = expected.get(neighbourKey)!;
    const neighbourTrend = trendAt(ratingByTeam.get(neighbourKey)!);
    expect(Math.abs(neighbourExpected - neighbourTrend)).toBeLessThan(1.0);
  });
});

describe("consistencyMetricByTeam -- THE HEADLINE TEST", () => {
  it("a high-rated team with a high raw figure that is below its expected figure out-tiers a low-rated team with a low raw figure that is above its expected figure", () => {
    const n = 60;
    const slope = 0.15;
    const intercept = 2;
    const { valueByTeam, ratingByTeam, teamKeys } = buildLinearPool(n, slope, intercept);
    const trendAt = (rating: number) => intercept + slope * rating;

    const highRatedKey = "frc50"; // high rating
    const lowRatedKey = "frc5"; // low rating
    const margin = 2;

    const adjustedValueByTeam = new Map(valueByTeam);
    // High-rated team: raw figure is HIGH in absolute terms (trend at its
    // rating is already high), but BELOW its own expected figure -- more
    // consistent than robots of its caliber.
    adjustedValueByTeam.set(highRatedKey, trendAt(ratingByTeam.get(highRatedKey)!) - margin);
    // Low-rated team: raw figure is LOW in absolute terms, but ABOVE its own
    // expected figure -- less consistent than robots of its (weak) caliber.
    adjustedValueByTeam.set(lowRatedKey, trendAt(ratingByTeam.get(lowRatedKey)!) + margin);

    // Confirm the "high raw figure / low raw figure" framing actually holds
    // before asserting anything about tiers.
    expect(adjustedValueByTeam.get(highRatedKey)!).toBeGreaterThan(adjustedValueByTeam.get(lowRatedKey)!);

    const metricsByTeam = toMetricsByTeam(ratingByTeam);
    const result = consistencyMetricByTeam({
      valueByTeam: adjustedValueByTeam,
      metricsByTeam,
      teamKeys,
      metricKey: SIGMA_METRIC_KEY,
    });

    expect(result[highRatedKey]).toBeDefined();
    expect(result[lowRatedKey]).toBeDefined();
    expect(result[highRatedKey]!.percentile).toBeGreaterThan(result[lowRatedKey]!.percentile);
  });

  it("a team with no figure gets no entry at all -- never a coerced zero", () => {
    const { valueByTeam, ratingByTeam, teamKeys } = buildLinearPool(30, 0.1, 2);
    const noValueKey = "frc10";
    const prunedValueByTeam = new Map(valueByTeam);
    prunedValueByTeam.delete(noValueKey);

    const metricsByTeam = toMetricsByTeam(ratingByTeam);
    const result = consistencyMetricByTeam({
      valueByTeam: prunedValueByTeam,
      metricsByTeam,
      teamKeys,
      metricKey: SIGMA_METRIC_KEY,
    });

    expect(noValueKey in result).toBe(false);
  });

  it("a team with a figure but no total metric value cannot be placed on the curve and gets no entry", () => {
    const { valueByTeam, ratingByTeam, teamKeys } = buildLinearPool(30, 0.1, 2);
    const noTotalKey = "frc12";
    const metricsByTeam = toMetricsByTeam(ratingByTeam);
    delete metricsByTeam[noTotalKey];

    const result = consistencyMetricByTeam({ valueByTeam, metricsByTeam, teamKeys, metricKey: SIGMA_METRIC_KEY });

    expect(noTotalKey in result).toBe(false);
  });

  it("the pool is exactly the teamKeys argument -- a team with both values but excluded from teamKeys is absent from the result", () => {
    const { valueByTeam, ratingByTeam, teamKeys } = buildLinearPool(30, 0.1, 2);
    const excludedKey = "frc7";
    const scopedTeamKeys = teamKeys.filter((k) => k !== excludedKey);
    const metricsByTeam = toMetricsByTeam(ratingByTeam);

    const result = consistencyMetricByTeam({
      valueByTeam,
      metricsByTeam,
      teamKeys: scopedTeamKeys,
      metricKey: SIGMA_METRIC_KEY,
    });

    expect(excludedKey in result).toBe(false);
  });

  it("returned entries carry exactly {value, percentile} and no other keys", () => {
    const { valueByTeam, ratingByTeam, teamKeys } = buildLinearPool(30, 0.1, 2);
    const metricsByTeam = toMetricsByTeam(ratingByTeam);
    const result = consistencyMetricByTeam({ valueByTeam, metricsByTeam, teamKeys, metricKey: SIGMA_METRIC_KEY });

    const entry = result["frc15"]!;
    expect(entry).toBeDefined();
    expect(Object.keys(entry).sort()).toEqual(["percentile", "value"]);
    expect(entry.value).toBe(valueByTeam.get("frc15"));
  });
});
