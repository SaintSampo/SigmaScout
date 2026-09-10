/**
 * Quick task 260909-tgf, Task 1: coverage for the expected-swing curve
 * (D1's residual framing) and the published `swing` metric it feeds.
 *
 * D1 locked the RESIDUAL framing; the running-median-over-rating-neighbours
 * functional form is this task's discretion -- see `swingMetric.ts`'s file
 * header for the rationale and the two rejected alternatives (coefficient of
 * variation, rating-decile strata).
 */
import { describe, expect, it } from "vitest";
import { TOTAL_METRIC_KEY, type TeamMetrics } from "../core/algorithms/types.js";
import { expectedSwingByTeam, swingMetricByTeam } from "./swingMetric.js";

/** Builds a smooth linear swing-vs-rating pool with tiny deterministic jitter so the fit is not trivially exact. */
function buildLinearPool(n: number, slope: number, intercept: number, jitterAmplitude = 0.2) {
  const swingByTeam = new Map<string, number>();
  const ratingByTeam = new Map<string, number>();
  const teamKeys: string[] = [];
  for (let i = 0; i < n; i++) {
    const teamKey = `frc${i}`;
    teamKeys.push(teamKey);
    const rating = i;
    const jitter = jitterAmplitude * Math.sin(i * 0.7);
    ratingByTeam.set(teamKey, rating);
    swingByTeam.set(teamKey, intercept + slope * rating + jitter);
  }
  return { swingByTeam, ratingByTeam, teamKeys };
}

function toMetricsByTeam(ratingByTeam: ReadonlyMap<string, number>): TeamMetrics {
  const metrics: TeamMetrics = {};
  for (const [teamKey, rating] of ratingByTeam) {
    metrics[teamKey] = { [TOTAL_METRIC_KEY]: { value: rating } };
  }
  return metrics;
}

describe("expectedSwingByTeam", () => {
  it("returns, for each team in a linear swing-vs-rating pool, an expected value close to that team's own swing", () => {
    const { swingByTeam, ratingByTeam, teamKeys } = buildLinearPool(200, 0.1, 2);
    const expected = expectedSwingByTeam(swingByTeam, ratingByTeam, teamKeys);

    let maxAbsResidual = 0;
    let swingMin = Infinity;
    let swingMax = -Infinity;
    for (const teamKey of teamKeys) {
      const actual = swingByTeam.get(teamKey)!;
      const exp = expected.get(teamKey)!;
      maxAbsResidual = Math.max(maxAbsResidual, Math.abs(actual - exp));
      swingMin = Math.min(swingMin, actual);
      swingMax = Math.max(swingMax, actual);
    }
    const swingSpread = swingMax - swingMin;
    // The property that kills "strong robots are automatically high-swing":
    // residuals stay small relative to the whole swing spread across the pool.
    expect(maxAbsResidual).toBeLessThan(swingSpread * 0.1);
  });

  it("a single extreme outlier team (swing 10x its neighbours) does not drag the curve -- neighbours' expected values shift by less than a stated tolerance", () => {
    const { swingByTeam, ratingByTeam, teamKeys } = buildLinearPool(200, 0.05, 1);
    const trendAt = (rating: number) => 1 + 0.05 * rating;

    const outlierKey = "frc100";
    const outlierSwing = trendAt(ratingByTeam.get(outlierKey)!) * 10;
    const perturbedSwingByTeam = new Map(swingByTeam);
    perturbedSwingByTeam.set(outlierKey, outlierSwing);

    const expected = expectedSwingByTeam(perturbedSwingByTeam, ratingByTeam, teamKeys);

    const neighbourKey = "frc99";
    const neighbourExpected = expected.get(neighbourKey)!;
    const neighbourTrend = trendAt(ratingByTeam.get(neighbourKey)!);
    expect(Math.abs(neighbourExpected - neighbourTrend)).toBeLessThan(1.0);
  });
});

describe("swingMetricByTeam -- THE HEADLINE TEST", () => {
  it("a high-rated team with high raw swing that is below its expected swing out-tiers a low-rated team with low raw swing that is above its expected swing", () => {
    const n = 60;
    const slope = 0.15;
    const intercept = 2;
    const { swingByTeam, ratingByTeam, teamKeys } = buildLinearPool(n, slope, intercept);
    const trendAt = (rating: number) => intercept + slope * rating;

    const highRatedKey = "frc50"; // high rating
    const lowRatedKey = "frc5"; // low rating
    const margin = 2;

    const adjustedSwingByTeam = new Map(swingByTeam);
    // High-rated team: raw swing is HIGH in absolute terms (trend at its
    // rating is already high), but BELOW its own expected swing -- more
    // consistent than robots of its caliber.
    adjustedSwingByTeam.set(highRatedKey, trendAt(ratingByTeam.get(highRatedKey)!) - margin);
    // Low-rated team: raw swing is LOW in absolute terms, but ABOVE its own
    // expected swing -- swingier than robots of its (weak) caliber.
    adjustedSwingByTeam.set(lowRatedKey, trendAt(ratingByTeam.get(lowRatedKey)!) + margin);

    // Confirm the "high raw swing / low raw swing" framing actually holds
    // before asserting anything about tiers.
    expect(adjustedSwingByTeam.get(highRatedKey)!).toBeGreaterThan(adjustedSwingByTeam.get(lowRatedKey)!);

    const metricsByTeam = toMetricsByTeam(ratingByTeam);
    const result = swingMetricByTeam({ swingByTeam: adjustedSwingByTeam, metricsByTeam, teamKeys });

    expect(result[highRatedKey]).toBeDefined();
    expect(result[lowRatedKey]).toBeDefined();
    expect(result[highRatedKey]!.percentile).toBeGreaterThan(result[lowRatedKey]!.percentile);
  });

  it("a team with no Swing Factor (fewer than two played matches) gets no entry at all -- never a coerced zero", () => {
    const { swingByTeam, ratingByTeam, teamKeys } = buildLinearPool(30, 0.1, 2);
    const noSwingKey = "frc10";
    const prunedSwingByTeam = new Map(swingByTeam);
    prunedSwingByTeam.delete(noSwingKey);

    const metricsByTeam = toMetricsByTeam(ratingByTeam);
    const result = swingMetricByTeam({ swingByTeam: prunedSwingByTeam, metricsByTeam, teamKeys });

    expect(noSwingKey in result).toBe(false);
  });

  it("a team with a Swing Factor but no total metric value cannot be placed on the curve and gets no entry", () => {
    const { swingByTeam, ratingByTeam, teamKeys } = buildLinearPool(30, 0.1, 2);
    const noTotalKey = "frc12";
    const metricsByTeam = toMetricsByTeam(ratingByTeam);
    delete metricsByTeam[noTotalKey];

    const result = swingMetricByTeam({ swingByTeam, metricsByTeam, teamKeys });

    expect(noTotalKey in result).toBe(false);
  });

  it("the pool is exactly the teamKeys argument -- a team with both values but excluded from teamKeys is absent from the result", () => {
    const { swingByTeam, ratingByTeam, teamKeys } = buildLinearPool(30, 0.1, 2);
    const excludedKey = "frc7";
    const scopedTeamKeys = teamKeys.filter((k) => k !== excludedKey);
    const metricsByTeam = toMetricsByTeam(ratingByTeam);

    const result = swingMetricByTeam({ swingByTeam, metricsByTeam, teamKeys: scopedTeamKeys });

    expect(excludedKey in result).toBe(false);
  });

  it("returned entries carry exactly {value, percentile} and no other keys", () => {
    const { swingByTeam, ratingByTeam, teamKeys } = buildLinearPool(30, 0.1, 2);
    const metricsByTeam = toMetricsByTeam(ratingByTeam);
    const result = swingMetricByTeam({ swingByTeam, metricsByTeam, teamKeys });

    const entry = result["frc15"]!;
    expect(entry).toBeDefined();
    expect(Object.keys(entry).sort()).toEqual(["percentile", "value"]);
    expect(entry.value).toBe(swingByTeam.get("frc15"));
  });
});
