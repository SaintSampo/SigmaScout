/**
 * D-04 (Phase 6, plan 06-04 Task 2) coverage for the mid-rank percentile
 * pass — `percentileRanks`'s formula in isolation, then `withPercentiles`'s
 * merge/immutability/pool-scoping contract.
 */
import { describe, expect, it } from "vitest";
import type { TeamMetrics } from "../core/algorithms/types.js";
import { percentileRanks, withPercentiles } from "./percentiles.js";

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
