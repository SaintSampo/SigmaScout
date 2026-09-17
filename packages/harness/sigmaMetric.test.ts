/**
 * Coverage for the within-window detrended rank and the published
 * consistency metric it feeds (today SPR's `sigma` entry). See
 * `sigmaMetric.ts`'s file header for the scheme, the axis pairing and the
 * edge rule.
 */
import { describe, expect, it } from "vitest";
import { TOTAL_METRIC_KEY, type TeamMetrics } from "../core/algorithms/types.js";
import { sigmaMetricByTeam, sigmaWindowIndices, SIGMA_WINDOW_MIN_HALF_WIDTH } from "./sigmaMetric.js";
import { publishedTierForPercentile } from "./pageArtifacts.js";
import { percentileRanks } from "./percentiles.js";
import { SIGMA_METRIC_KEY } from "./sigmaScore.js";

/**
 * A small named LCG, deterministic across runs (never `Math.random`), used
 * only to build synthetic test pools below.
 */
function seededLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function toMetrics(ratingByTeam: ReadonlyMap<string, number>): TeamMetrics {
  const metrics: TeamMetrics = {};
  for (const [teamKey, rating] of ratingByTeam) metrics[teamKey] = { [TOTAL_METRIC_KEY]: { value: rating } };
  return metrics;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * THE SUPERSEDED SCHEME, kept ONLY as a labelled contrast for the two tests
 * below -- never live code, never imported by `sigmaMetric.ts`. Reproduces
 * the pre-260917-jzh behaviour exactly: each team's residual is its figure
 * minus the MEDIAN figure of a clamped rating-rank window centred on it (the
 * same clamp `expectedSigmaByTeam` used before this task removed it), and
 * every residual is then ranked with ONE GLOBAL `percentileRanks` call. That
 * global rank over a LOCALLY centred residual is exactly the defect: the
 * residual's LEVEL is normalized per window, but its SPREAD is not, so a
 * region of the rating axis with a wider residual spread supplies a
 * disproportionate share of the global tails.
 */
function oldSchemeGoodnessPercentiles(sortedByRatingSigma: readonly number[], windowSize: number): number[] {
  const n = sortedByRatingSigma.length;
  const halfWindow = Math.floor(windowSize / 2);
  const residuals = sortedByRatingSigma.map((sigma, i) => {
    let start = i - halfWindow;
    let end = start + windowSize;
    if (start < 0) {
      end -= start;
      start = 0;
    }
    if (end > n) {
      start -= end - n;
      end = n;
    }
    start = Math.max(0, start);
    return sigma - median(sortedByRatingSigma.slice(start, end));
  });
  const raw = percentileRanks(residuals);
  return raw.map((p) => 100 - p); // sigma is declared lower-is-better
}

function tierShare(tiers: readonly ("rare" | "epic" | "legendary" | "common")[]) {
  const counts = { common: 0, rare: 0, epic: 0, legendary: 0 };
  for (const tier of tiers) counts[tier]++;
  const n = tiers.length;
  return { common: (counts.common / n) * 100, rare: (counts.rare / n) * 100, epic: (counts.epic / n) * 100, legendary: (counts.legendary / n) * 100 };
}

function tierOf(percentile: number | undefined): "rare" | "epic" | "legendary" | "common" {
  return publishedTierForPercentile(percentile) ?? "common";
}

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

describe("sigmaMetricByTeam -- per-decile uniformity on a heteroscedastic pool", () => {
  it("holds Common and Legendary shares inside their bands at every decile, unlike the old scheme", () => {
    const n = 2000;
    const rand = seededLcg(42);
    const ratingMax = n - 1;
    const valueByTeam = new Map<string, number>();
    const ratingByTeam = new Map<string, number>();
    const teamKeys: string[] = [];
    for (let i = 0; i < n; i++) {
      const teamKey = `frc${i}`;
      teamKeys.push(teamKey);
      const rating = i;
      // Noise SPREAD grows with rating (0.4x at rating 0 up to 1.0x at
      // ratingMax) -- the real data's shape, and the exact property the old
      // difference-residual scheme fails on.
      const noise = (rand() * 2 - 1) * (0.4 + 0.6 * (rating / ratingMax));
      ratingByTeam.set(teamKey, rating);
      valueByTeam.set(teamKey, 5 + 0.01 * rating + noise);
    }

    const officialMetricsByTeam = toMetrics(ratingByTeam);
    const result = sigmaMetricByTeam({ valueByTeam, officialMetricsByTeam, seasonFinalMetricsByTeam: {}, teamKeys, metricKey: SIGMA_METRIC_KEY });
    const newTiers = teamKeys.map((teamKey) => tierOf(result[teamKey]?.percentile));

    const windowSize = Math.min(n, Math.max(25, Math.round(n / 20)));
    const sortedSigma = teamKeys.map((teamKey) => valueByTeam.get(teamKey)!);
    const oldPercentiles = oldSchemeGoodnessPercentiles(sortedSigma, windowSize);
    const oldTiers = oldPercentiles.map((p) => tierOf(p));

    const bucketSize = n / 10;
    const newShares: ReturnType<typeof tierShare>[] = [];
    const oldShares: ReturnType<typeof tierShare>[] = [];
    for (let b = 0; b < 10; b++) {
      const lo = b * bucketSize;
      const hi = (b + 1) * bucketSize;
      newShares.push(tierShare(newTiers.slice(lo, hi)));
      oldShares.push(tierShare(oldTiers.slice(lo, hi)));
    }

    // Measured on this exact seeded pool: new-scheme Common ran 47.0 to 51.5
    // percent and Legendary ran 3.5 to 6.0 percent across all ten deciles --
    // comfortably inside band, so the band below is not cutting it close.
    for (const share of newShares) {
      expect(share.common).toBeGreaterThanOrEqual(44);
      expect(share.common).toBeLessThanOrEqual(56);
      expect(share.legendary).toBeGreaterThanOrEqual(2);
      expect(share.legendary).toBeLessThanOrEqual(9);
    }

    // The defect, stated as a number: old-scheme Legendary share measured
    // 3.0 percent in the bottom decile against 16.5 percent in the top --
    // 5.5x, comfortably past the 3x floor asserted below.
    const oldBottomLegendary = oldShares[0]!.legendary;
    const oldTopLegendary = oldShares[9]!.legendary;
    expect(oldTopLegendary).toBeGreaterThanOrEqual(3 * oldBottomLegendary);
  });
});

describe("sigmaMetricByTeam -- steep monotone trend at the top", () => {
  it("no longer forces most of the top block to Common, unlike the old clamped window", () => {
    const n = 2000;
    const rand = seededLcg(7);
    const valueByTeam = new Map<string, number>();
    const ratingByTeam = new Map<string, number>();
    const teamKeys: string[] = [];
    for (let i = 0; i < n; i++) {
      const teamKey = `frc${i}`;
      teamKeys.push(teamKey);
      const rating = i;
      // Small deterministic noise, tiny next to the trend: ranks are not
      // degenerately tied, but the whole range still rises monotonically.
      const noise = (rand() * 2 - 1) * 0.01;
      ratingByTeam.set(teamKey, rating);
      valueByTeam.set(teamKey, 1 + 0.5 * rating + noise);
    }

    const windowSize = Math.min(n, Math.max(25, Math.round(n / 20)));
    const halfWindow = Math.floor(windowSize / 2);
    const topBlockStart = n - halfWindow;

    const officialMetricsByTeam = toMetrics(ratingByTeam);
    const result = sigmaMetricByTeam({ valueByTeam, officialMetricsByTeam, seasonFinalMetricsByTeam: {}, teamKeys, metricKey: SIGMA_METRIC_KEY });

    const sortedSigma = teamKeys.map((teamKey) => valueByTeam.get(teamKey)!);
    const oldPercentiles = oldSchemeGoodnessPercentiles(sortedSigma, windowSize);

    let oldCommonCount = 0;
    let newCommonCount = 0;
    let newLegendaryCount = 0;
    for (let i = topBlockStart; i < n; i++) {
      if (tierOf(oldPercentiles[i]) === "common") oldCommonCount++;
      const newTier = tierOf(result[teamKeys[i]!]?.percentile);
      if (newTier === "common") newCommonCount++;
      if (newTier === "legendary") newLegendaryCount++;
    }
    const blockSize = n - topBlockStart;

    // Measured on this exact seeded pool (block size 50): old scheme reads
    // 100.0 percent Common (the clamped-window bug); new scheme reads 46.0
    // percent Common with 3 teams reaching Legendary.
    expect((100 * oldCommonCount) / blockSize).toBeGreaterThanOrEqual(90);
    expect((100 * newCommonCount) / blockSize).toBeLessThanOrEqual(60);
    expect(newLegendaryCount).toBeGreaterThanOrEqual(1);
  });
});

describe("sigmaWindowIndices", () => {
  it("SIGMA_WINDOW_MIN_HALF_WIDTH is exactly 5", () => {
    expect(SIGMA_WINDOW_MIN_HALF_WIDTH).toBe(5);
  });

  it("an interior index returns a window symmetric about i", () => {
    const { start, end } = sigmaWindowIndices(2000, 500, 50);
    expect(start).toBe(450);
    expect(end).toBe(551);
  });

  it("i = n - 1 returns a window of exactly min(n, 11) ending at n", () => {
    const { start, end } = sigmaWindowIndices(2000, 1999, 50);
    expect(start).toBe(1989);
    expect(end).toBe(2000);
  });

  it("i = 0 returns a window of exactly min(n, 11) starting at 0", () => {
    const { start, end } = sigmaWindowIndices(2000, 0, 50);
    expect(start).toBe(0);
    expect(end).toBe(11);
  });
});
