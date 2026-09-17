/**
 * Coverage for the within-window detrended rank and the published
 * consistency metric it feeds (today SPR's `sigma` entry). See
 * `sigmaMetric.ts`'s file header for the scheme, the axis pairing and the
 * edge rule.
 */
import { describe, expect, it } from "vitest";
import { TOTAL_METRIC_KEY, type TeamMetrics } from "../core/algorithms/types.js";
import { sigmaMetricByTeam } from "./sigmaMetric.js";
import { publishedTierForPercentile } from "./pageArtifacts.js";
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

describe("sigmaMetricByTeam -- THE HEADLINE TEST", () => {
  it("a high-rated team with a high raw figure that is below its expected figure out-tiers a low-rated team with a low raw figure that is above its expected figure", () => {
    const n = 60;
    const slope = 0.15;
    const intercept = 2;
    const { valueByTeam, ratingByTeam, teamKeys } = buildLinearPool(n, slope, intercept);
    const trendAt = (rating: number) => intercept + slope * rating;

    const highRatedKey = "frc50";
    const lowRatedKey = "frc5";
    const margin = 2;

    const adjustedValueByTeam = new Map(valueByTeam);
    // High-rated team: raw figure is high but below its own expected figure
    // (more consistent than robots of its caliber); low-rated team is the
    // mirror (low raw figure, above its own expected figure).
    adjustedValueByTeam.set(highRatedKey, trendAt(ratingByTeam.get(highRatedKey)!) - margin);
    adjustedValueByTeam.set(lowRatedKey, trendAt(ratingByTeam.get(lowRatedKey)!) + margin);

    expect(adjustedValueByTeam.get(highRatedKey)!).toBeGreaterThan(adjustedValueByTeam.get(lowRatedKey)!);

    const officialMetricsByTeam = toMetricsByTeam(ratingByTeam);
    const result = sigmaMetricByTeam({
      valueByTeam: adjustedValueByTeam,
      officialMetricsByTeam,
      seasonFinalMetricsByTeam: {},
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

    const officialMetricsByTeam = toMetricsByTeam(ratingByTeam);
    const result = sigmaMetricByTeam({
      valueByTeam: prunedValueByTeam,
      officialMetricsByTeam,
      seasonFinalMetricsByTeam: {},
      teamKeys,
      metricKey: SIGMA_METRIC_KEY,
    });

    expect(noValueKey in result).toBe(false);
  });

  it("a team with a figure but no total metric value in either axis cannot be placed on the curve and gets no entry", () => {
    const { valueByTeam, ratingByTeam, teamKeys } = buildLinearPool(30, 0.1, 2);
    const noTotalKey = "frc12";
    const officialMetricsByTeam = toMetricsByTeam(ratingByTeam);
    delete officialMetricsByTeam[noTotalKey];

    const result = sigmaMetricByTeam({
      valueByTeam,
      officialMetricsByTeam,
      seasonFinalMetricsByTeam: {},
      teamKeys,
      metricKey: SIGMA_METRIC_KEY,
    });

    expect(noTotalKey in result).toBe(false);
  });

  it("a team absent from the official record but present in the season-final record still receives an entry, ranked on its season-final Total", () => {
    const { valueByTeam, ratingByTeam, teamKeys } = buildLinearPool(30, 0.1, 2);
    const fallbackKey = "frc12";
    const officialMetricsByTeam = toMetricsByTeam(ratingByTeam);
    delete officialMetricsByTeam[fallbackKey];
    const seasonFinalMetricsByTeam = toMetricsByTeam(ratingByTeam);

    const result = sigmaMetricByTeam({
      valueByTeam,
      officialMetricsByTeam,
      seasonFinalMetricsByTeam,
      teamKeys,
      metricKey: SIGMA_METRIC_KEY,
    });

    expect(result[fallbackKey]).toBeDefined();
    expect(result[fallbackKey]!.value).toBe(valueByTeam.get(fallbackKey));
  });

  it("a team absent from both the official and season-final record gets no entry", () => {
    const { valueByTeam, ratingByTeam, teamKeys } = buildLinearPool(30, 0.1, 2);
    const missingKey = "frc12";
    const officialMetricsByTeam = toMetricsByTeam(ratingByTeam);
    delete officialMetricsByTeam[missingKey];

    const result = sigmaMetricByTeam({
      valueByTeam,
      officialMetricsByTeam,
      seasonFinalMetricsByTeam: {},
      teamKeys,
      metricKey: SIGMA_METRIC_KEY,
    });

    expect(missingKey in result).toBe(false);
  });

  it("the pool is exactly the teamKeys argument -- a team with both values but excluded from teamKeys is absent from the result", () => {
    const { valueByTeam, ratingByTeam, teamKeys } = buildLinearPool(30, 0.1, 2);
    const excludedKey = "frc7";
    const scopedTeamKeys = teamKeys.filter((k) => k !== excludedKey);
    const officialMetricsByTeam = toMetricsByTeam(ratingByTeam);

    const result = sigmaMetricByTeam({
      valueByTeam,
      officialMetricsByTeam,
      seasonFinalMetricsByTeam: {},
      teamKeys: scopedTeamKeys,
      metricKey: SIGMA_METRIC_KEY,
    });

    expect(excludedKey in result).toBe(false);
  });

  it("returned entries carry exactly {value, percentile} and no other keys", () => {
    const { valueByTeam, ratingByTeam, teamKeys } = buildLinearPool(30, 0.1, 2);
    const officialMetricsByTeam = toMetricsByTeam(ratingByTeam);
    const result = sigmaMetricByTeam({
      valueByTeam,
      officialMetricsByTeam,
      seasonFinalMetricsByTeam: {},
      teamKeys,
      metricKey: SIGMA_METRIC_KEY,
    });

    const entry = result["frc15"]!;
    expect(entry).toBeDefined();
    expect(Object.keys(entry).sort()).toEqual(["percentile", "value"]);
    expect(entry.value).toBe(valueByTeam.get("frc15"));
  });

  it("a single extreme outlier team (figure 10x its neighbours' trend) does not drag a neighbour's percentile or flip its tier", () => {
    const { valueByTeam, ratingByTeam, teamKeys } = buildLinearPool(200, 0.05, 1);
    const trendAt = (rating: number) => 1 + 0.05 * rating;

    const officialMetricsByTeam = toMetricsByTeam(ratingByTeam);
    const baseline = sigmaMetricByTeam({
      valueByTeam,
      officialMetricsByTeam,
      seasonFinalMetricsByTeam: {},
      teamKeys,
      metricKey: SIGMA_METRIC_KEY,
    });

    const outlierKey = "frc100";
    const outlierValue = trendAt(ratingByTeam.get(outlierKey)!) * 10;
    const perturbedValueByTeam = new Map(valueByTeam);
    perturbedValueByTeam.set(outlierKey, outlierValue);

    const perturbed = sigmaMetricByTeam({
      valueByTeam: perturbedValueByTeam,
      officialMetricsByTeam,
      seasonFinalMetricsByTeam: {},
      teamKeys,
      metricKey: SIGMA_METRIC_KEY,
    });

    const neighbourKey = "frc99";
    const shift = Math.abs(perturbed[neighbourKey]!.percentile - baseline[neighbourKey]!.percentile);
    // Measured on this exact deterministic pool: exactly 0 percentile points
    // (frc99 sits immediately beside the outlier and its residual keeps its
    // relative rank order inside the window). Pinned with headroom at 2.
    expect(shift).toBeLessThan(2);
    expect(publishedTierForPercentile(perturbed[neighbourKey]!.percentile)).toBe(
      publishedTierForPercentile(baseline[neighbourKey]!.percentile)
    );
  });
});
