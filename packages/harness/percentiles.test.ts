/**
 * D-04 (Phase 6, plan 06-04 Task 2) coverage for the mid-rank percentile
 * pass — `percentileRanks`'s formula in isolation, then `withPercentiles`'s
 * merge/immutability/pool-scoping contract.
 *
 * Plan 06.1-03 Tasks 1-2 (D-06.1-A, F-06-3) extend this suite with
 * `percentileAgainstSortedPool`, `sortedPoolsByMetric`,
 * `HISTORY_PERCENTILE_METRIC_KEYS`, and the `MetricValueSchema.percentile`
 * round-trip cases — kept in this one suite per the plan's own instruction
 * to keep the phase's percentile assertions together.
 */
import { describe, expect, it } from "vitest";
import { COMPONENT_GROUP_METRIC_KEYS } from "../core/algorithms/breakdown/index.js";
import { TOTAL_METRIC_KEY, type TeamMetrics } from "../core/algorithms/types.js";
import { MetricHistoryRowSchema, MetricValueSchema } from "./metricHistorySchema.js";
import {
  EmptyPoolError,
  HISTORY_PERCENTILE_METRIC_KEYS,
  percentileAgainstSortedPool,
  percentileRanks,
  sortedPoolsByMetric,
  withPercentiles,
} from "./percentiles.js";

describe("percentileRanks", () => {
  it("mid-rank convention on distinct values (D-04)", () => {
    expect(percentileRanks([1, 2, 3, 4])).toEqual([12.5, 37.5, 62.5, 87.5]);
  });

  it("a tie group of three identical values all receives the identical percentile (the mid-rank of the whole pool)", () => {
    const result = percentileRanks([5, 5, 5]);
    expect(result).toHaveLength(3);
    expect(new Set(result).size).toBe(1);
    expect(result[0]).toBe(50);
  });

  it("a single-team pool receives percentile 50 — the mid-rank of a pool of one", () => {
    expect(percentileRanks([7])).toEqual([50]);
  });

  it("returns an empty array for an empty pool", () => {
    expect(percentileRanks([])).toEqual([]);
  });

  it("preserves input order — index i of the result corresponds to values[i], not the sorted order", () => {
    const result = percentileRanks([30, 10, 20]);
    // sorted ascending: 10, 20, 30 -> percentiles 16.67, 50, 83.33
    expect(result[1]).toBeLessThan(result[2]!); // 10 (idx1) below 20 (idx2)
    expect(result[2]).toBeLessThan(result[0]!); // 20 (idx2) below 30 (idx0)
  });

  it("a mixed tie: two tied low values and one higher value — the tied pair shares a percentile below the singleton's", () => {
    const result = percentileRanks([1, 1, 9]);
    expect(result[0]).toBe(result[1]);
    expect(result[0]!).toBeLessThan(result[2]!);
  });

  it("a 100-value distinct pool's rank crosses the 50/75/95 tier cuts at the expected positions (colour-and-tiers.md's Common/Rare/Epic/Legendary boundaries)", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1); // already ascending, 1..100
    const result = percentileRanks(values);
    // For a distinct n=100 pool, index i (0-based) -> percentile i + 0.5.
    expect(result[49]).toBeLessThan(50); // 50th-smallest value: just under the Common/Rare cut
    expect(result[50]).toBeGreaterThanOrEqual(50); // 51st-smallest: at/above the cut
    expect(result[74]).toBeLessThan(75); // just under the Rare/Epic cut
    expect(result[75]).toBeGreaterThanOrEqual(75); // at/above the cut
    expect(result[94]).toBeLessThan(95); // just under the Epic/Legendary cut
    expect(result[95]).toBeGreaterThanOrEqual(95); // at/above the cut
  });
});

describe("withPercentiles", () => {
  function fixtureMetrics(): TeamMetrics {
    return {
      frc1: { total: { value: 10 }, auto: { value: 5 } },
      frc2: { total: { value: 20 } },
      frc3: { total: { value: 30 }, auto: { value: 15 } },
    };
  }

  it("merges a percentile onto each metric a team has a value for", () => {
    const result = withPercentiles(fixtureMetrics(), ["frc1", "frc2", "frc3"]);
    expect(result.frc1?.total?.percentile).toBeDefined();
    expect(result.frc2?.total?.percentile).toBeDefined();
    expect(result.frc3?.total?.percentile).toBeDefined();
    expect(result.frc1?.auto?.percentile).toBeDefined();
    expect(result.frc3?.auto?.percentile).toBeDefined();
  });

  it("a team absent from a metric has no percentile key on that metric — an `in` check, not a truthiness check", () => {
    const result = withPercentiles(fixtureMetrics(), ["frc1", "frc2", "frc3"]);
    // frc2 never had an `auto` value at all — the metric key itself is absent.
    expect(result.frc2?.auto).toBeUndefined();
    // frc1 DOES have an `auto` value — its percentile key must be present.
    expect("percentile" in (result.frc1?.auto ?? {})).toBe(true);
  });

  it("leaves its input object deep-equal to a pre-call snapshot — never mutates metricsByTeam", () => {
    const metrics = fixtureMetrics();
    const snapshot = structuredClone(metrics);
    withPercentiles(metrics, ["frc1", "frc2", "frc3"]);
    expect(metrics).toEqual(snapshot);
  });

  it("does not mutate the original nested TeamMetric objects either (a shallow-clone bug would still fail this)", () => {
    const metrics = fixtureMetrics();
    const originalTotal = metrics.frc1!.total;
    withPercentiles(metrics, ["frc1", "frc2", "frc3"]);
    expect("percentile" in originalTotal!).toBe(false);
  });

  it("scopes the percentile pool to the full teamKeys list, not Object.keys(metricsByTeam) alone, and tolerates a teamKey absent from metricsByTeam", () => {
    const metrics = fixtureMetrics();
    const result = withPercentiles(metrics, ["frc1", "frc2", "frc3", "frc4"]);
    expect(result.frc4).toBeUndefined();
    expect(Object.keys(result).sort()).toEqual(["frc1", "frc2", "frc3"]);
  });

  it("rounds percentile to ROUNDING_RULE.percentile (1 decimal place)", () => {
    const metrics: TeamMetrics = {};
    for (let i = 0; i < 7; i++) metrics[`frc${i}`] = { total: { value: i } };
    const result = withPercentiles(metrics, Object.keys(metrics));
    const pct = result.frc0?.total?.percentile;
    expect(pct).toBeDefined();
    expect(Number.isInteger(pct! * 10)).toBe(true);
  });
});

describe("percentileAgainstSortedPool (D-06.1-A, plan 06.1-03 Task 1)", () => {
  const POOL_SHAPES: Record<string, number[]> = {
    "all-distinct": [1, 2, 3, 4, 5, 6, 7],
    "one tie group": [1, 2, 2, 2, 5, 8],
    "two tie groups": [1, 1, 4, 9, 9, 9, 10],
    "all-identical": [3, 3, 3, 3],
  };

  for (const [label, pool] of Object.entries(POOL_SHAPES)) {
    it(`exactly agrees with percentileRanks at every index for a ${label} pool (strict equality, not toBeCloseTo)`, () => {
      const sorted = [...pool].sort((a, b) => a - b);
      const expected = percentileRanks(pool);
      pool.forEach((value, i) => {
        expect(percentileAgainstSortedPool(sorted, value)).toBe(expected[i]);
      });
    });
  }

  it("a query value strictly below every pool member returns a non-negative percentile strictly less than the smallest member's percentile — never negative", () => {
    // Reuses percentileRanks's exact formula (countStrictlyBelow=0, countEqual=0 for a
    // value matching no pool member), which yields exactly 0 here — well-defined, never
    // negative, and strictly below the smallest member's own mid-rank percentile.
    const sorted = [10, 20, 30, 40];
    const smallestPct = percentileRanks(sorted)[0]!;
    const result = percentileAgainstSortedPool(sorted, 0);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(smallestPct);
  });

  it("a query value strictly above every pool member returns exactly 100", () => {
    const sorted = [10, 20, 30, 40];
    expect(percentileAgainstSortedPool(sorted, 1000)).toBe(100);
  });

  it("throws a named error for an empty sorted pool rather than returning 0", () => {
    expect(() => percentileAgainstSortedPool([], 5)).toThrow(EmptyPoolError);
    expect(() => percentileAgainstSortedPool([], 5)).toThrow();
  });

  it("a single-member pool returns 50 for the member's own value, matching percentileRanks([7])", () => {
    expect(percentileAgainstSortedPool([7], 7)).toBe(50);
    expect(percentileAgainstSortedPool([7], 7)).toBe(percentileRanks([7])[0]);
  });

  it("rounds to ROUNDING_RULE.percentile decimals — a repeating decimal surfaces as one decimal number", () => {
    // 1 of 3 sorted-below out of pool size 3 -> 1/3 * 100 = 33.333...
    const sorted = [10, 20, 30];
    const result = percentileAgainstSortedPool(sorted, 15);
    expect(Number.isInteger(result * 10)).toBe(true);
  });
});

describe("sortedPoolsByMetric (D-06.1-A, plan 06.1-03 Task 1)", () => {
  function fixtureMetrics(): TeamMetrics {
    return {
      frc1: { total: { value: 10 }, auto: { value: 5 } },
      frc2: { total: { value: 20 } },
      frc3: { total: { value: 30 }, auto: { value: 15 } },
    };
  }

  it("returns one ascending array per metric name at least one team in teamKeys has a value for", () => {
    const pools = sortedPoolsByMetric(fixtureMetrics(), ["frc1", "frc2", "frc3"]);
    expect(pools.get("total")).toEqual([10, 20, 30]);
    expect(pools.get("auto")).toEqual([5, 15]);
  });

  it("omits a metric name entirely when no team in teamKeys has a value for it (PD-07) — has() returns false, not an equality against []", () => {
    const metrics: TeamMetrics = { frc1: { total: { value: 1 } } };
    const pools = sortedPoolsByMetric(metrics, ["frc1"]);
    expect(pools.has("auto")).toBe(false);
  });

  it("scopes strictly to teamKeys, never Object.keys(metricsByTeam) — a team outside teamKeys must not widen the pool", () => {
    const metrics = fixtureMetrics();
    const pools = sortedPoolsByMetric(metrics, ["frc1", "frc2"]); // frc3 excluded
    expect(pools.get("total")).toEqual([10, 20]);
    expect(pools.get("auto")).toEqual([5]);
  });

  it("tolerates a teamKeys entry absent from metricsByTeam", () => {
    const metrics = fixtureMetrics();
    const pools = sortedPoolsByMetric(metrics, ["frc1", "frc2", "frc3", "frc4"]);
    expect(pools.get("total")).toEqual([10, 20, 30]);
  });

  it("does not mutate metricsByTeam or any nested metric object", () => {
    const metrics = fixtureMetrics();
    const snapshot = structuredClone(metrics);
    sortedPoolsByMetric(metrics, ["frc1", "frc2", "frc3"]);
    expect(metrics).toEqual(snapshot);
  });
});

describe("HISTORY_PERCENTILE_METRIC_KEYS (PD-06, plan 06.1-03 Task 1)", () => {
  it("contains exactly the three COMPONENT_GROUP_METRIC_KEYS values plus TOTAL_METRIC_KEY", () => {
    const expected = new Set([...Object.values(COMPONENT_GROUP_METRIC_KEYS), TOTAL_METRIC_KEY]);
    expect(new Set(HISTORY_PERCENTILE_METRIC_KEYS)).toEqual(expected);
    expect(HISTORY_PERCENTILE_METRIC_KEYS).toHaveLength(4);
  });
});

describe("MetricValueSchema.percentile (F-06-3, plan 06.1-03 Task 2)", () => {
  it("accepts a metric with no percentile key at all — a pre-phase artifact still parses unchanged", () => {
    const parsed = MetricValueSchema.parse({ value: 1 });
    expect("percentile" in parsed).toBe(false);
  });

  it("accepts a percentile of exactly 0 and of exactly 100", () => {
    expect(MetricValueSchema.parse({ value: 1, percentile: 0 }).percentile).toBe(0);
    expect(MetricValueSchema.parse({ value: 1, percentile: 100 }).percentile).toBe(100);
  });

  it("rejects a percentile below 0 and one above 100", () => {
    expect(() => MetricValueSchema.parse({ value: 1, percentile: -0.1 })).toThrow();
    expect(() => MetricValueSchema.parse({ value: 1, percentile: 100.1 })).toThrow();
  });

  it("MetricHistoryRowSchema round-trips a row whose metrics carry percentiles", () => {
    const row = {
      matchKey: "2024test_qm1",
      season: 2024,
      eventKey: "2024test",
      algorithmId: "vpr",
      teamKey: "frc1",
      matchIndex: 0,
      metrics: { total: { value: 42, percentile: 87.5 } },
    };
    const parsed = MetricHistoryRowSchema.parse(row);
    expect(parsed.metrics["total"]?.percentile).toBe(87.5);
  });
});
