/**
 * Quick task 260909-tgf, Task 1: coverage for the DECLARED per-metric
 * direction table — the strict/lenient accessor split, the equality-pinned
 * lower-is-better key set, and derived coverage over every registered
 * season's component map. See `metricDirection.ts`'s file header for why the
 * split is load-bearing and must never be collapsed into one throwing
 * function.
 */
import { describe, expect, it } from "vitest";
import { BREAKDOWN_REGISTERED_SEASONS, componentMapForSeason, COMPONENT_GROUP_METRIC_KEYS } from "../core/algorithms/breakdown/index.js";
import { TOTAL_METRIC_KEY } from "../core/algorithms/types.js";
import {
  goodnessPercentile,
  lowerIsBetterMetricKeys,
  metricDirection,
  metricDirectionOrDefault,
  UndeclaredMetricDirectionError,
} from "./metricDirection.js";
import { SWING_METRIC_KEY } from "./swingFactor.js";

describe("metricDirection (strict accessor)", () => {
  it("TOTAL_METRIC_KEY is higher-is-better", () => {
    expect(metricDirection(TOTAL_METRIC_KEY)).toBe("higher-is-better");
  });

  it("SWING_METRIC_KEY is lower-is-better", () => {
    expect(metricDirection(SWING_METRIC_KEY)).toBe("lower-is-better");
  });

  it("throws UndeclaredMetricDirectionError for a name nobody declared", () => {
    expect(() => metricDirection("notAMetricAnyoneDeclared")).toThrow(UndeclaredMetricDirectionError);
    expect(() => metricDirection("notAMetricAnyoneDeclared")).toThrow();
  });

  it("every component name across every registered season resolves without throwing (derived coverage, not a hardcoded list)", () => {
    for (const season of BREAKDOWN_REGISTERED_SEASONS) {
      for (const name of componentMapForSeason(season).components) {
        expect(() => metricDirection(name)).not.toThrow();
      }
    }
  });

  it("each of COMPONENT_GROUP_METRIC_KEYS' three values resolves without throwing", () => {
    for (const key of Object.values(COMPONENT_GROUP_METRIC_KEYS)) {
      expect(() => metricDirection(key)).not.toThrow();
    }
  });
});

describe("metricDirectionOrDefault (lenient accessor)", () => {
  it("returns higher-is-better for an undeclared name, and does not throw", () => {
    expect(() => metricDirectionOrDefault("notAMetricAnyoneDeclared")).not.toThrow();
    expect(metricDirectionOrDefault("notAMetricAnyoneDeclared")).toBe("higher-is-better");
  });

  it("agrees with the strict accessor on every declared name", () => {
    const declaredNames = new Set<string>([TOTAL_METRIC_KEY, SWING_METRIC_KEY, ...Object.values(COMPONENT_GROUP_METRIC_KEYS)]);
    for (const season of BREAKDOWN_REGISTERED_SEASONS) {
      for (const name of componentMapForSeason(season).components) declaredNames.add(name);
    }
    for (const name of declaredNames) {
      expect(metricDirectionOrDefault(name)).toBe(metricDirection(name));
    }
  });
});

describe("lowerIsBetterMetricKeys (equality pin -- iteration-list-trap antidote)", () => {
  it("is exactly {swing} -- a future addition must fail this test loudly rather than sliding in", () => {
    expect(lowerIsBetterMetricKeys()).toEqual(new Set([SWING_METRIC_KEY]));
  });
});

describe("goodnessPercentile", () => {
  it("returns the raw percentile unchanged for higher-is-better", () => {
    expect(goodnessPercentile(80, "higher-is-better")).toBe(80);
  });

  it("returns 100 minus the raw percentile for lower-is-better", () => {
    expect(goodnessPercentile(80, "lower-is-better")).toBe(20);
  });

  it("is its own inverse for a given direction", () => {
    for (const direction of ["higher-is-better", "lower-is-better"] as const) {
      for (const p of [0, 12.5, 50, 87.5, 100]) {
        expect(goodnessPercentile(goodnessPercentile(p, direction), direction)).toBe(p);
      }
    }
  });
});
