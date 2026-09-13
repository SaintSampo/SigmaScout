import { describe, expect, it } from "vitest";
import { predictionPercent } from "./predictionPercent.js";

describe("predictionPercent", () => {
  it("rounds an ordinary probability to the nearest whole percent", () => {
    expect(predictionPercent(0.62)).toBe(62);
    expect(predictionPercent(0.505)).toBe(51);
  });

  it("never displays 100%, even for a probability of exactly 1", () => {
    expect(predictionPercent(0.996)).toBe(99);
    expect(predictionPercent(1)).toBe(99);
  });

  it("never displays 0%, even for a probability of exactly 0", () => {
    expect(predictionPercent(0.004)).toBe(1);
    expect(predictionPercent(0)).toBe(1);
  });
});
