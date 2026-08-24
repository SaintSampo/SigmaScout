import { describe, expect, it } from "vitest";
import { resolveSortKey } from "./resolveSortKey.js";
import { metricKeysFor, TOTAL_KEY } from "./metricKeys.js";

describe("resolveSortKey", () => {
  it("returns the current sort key unchanged when it is present in the new set", () => {
    expect(resolveSortKey("hubShift1", metricKeysFor("epa", 2026))).toBe("hubShift1");
  });

  it("falls back to the total key on a YEAR CHANGE that drops a component key the old season had (2026 -> 2022), even though the algorithm stays EPA — the trigger D-13's own text never names", () => {
    expect(resolveSortKey("hubShift1", metricKeysFor("epa", 2022))).toBe(TOTAL_KEY);
  });

  it("falls back to the total key on an ALGORITHM CHANGE to an algorithm that does not publish the current sort key (EPA -> OPR)", () => {
    expect(resolveSortKey("autoCargo", metricKeysFor("opr", 2022))).toBe(TOTAL_KEY);
  });

  it("treats an absent sort param the same as an invalid one: undefined resolves to the total key", () => {
    expect(resolveSortKey(undefined, metricKeysFor("sigma1", 2024))).toBe(TOTAL_KEY);
  });

  it("returns the input unchanged whenever it is present in the set, including when it already is the total key", () => {
    const validKeys = metricKeysFor("sigma1", 2024);
    expect(resolveSortKey(TOTAL_KEY, validKeys)).toBe(TOTAL_KEY);
    expect(resolveSortKey(validKeys[0], validKeys)).toBe(validKeys[0]);
  });

  it("never returns a key absent from the set it was given, for any input", () => {
    const cases: Array<readonly [string, number]> = [
      ["opr", 2022],
      ["opr", 2026],
      ["epa", 2022],
      ["epa", 2026],
      ["sigma1", 2022],
      ["sigma1", 2026],
    ];
    const probes = [undefined, "", "hubShift1", "autoCargo", "not-a-real-key", TOTAL_KEY];
    for (const [algorithmId, season] of cases) {
      const validKeys = metricKeysFor(algorithmId, season);
      for (const probe of probes) {
        const resolved = resolveSortKey(probe, validKeys);
        expect(validKeys).toContain(resolved);
      }
    }
  });
});
