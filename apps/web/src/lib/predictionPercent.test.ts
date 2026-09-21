import { describe, expect, it } from "vitest";
import { matchConfidencePercent, predictionPercent } from "./predictionPercent.js";

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

describe("matchConfidencePercent", () => {
  it("never displays 50%: a close match rounds up to 51%", () => {
    expect(matchConfidencePercent(0.5)).toBe(51);
    expect(matchConfidencePercent(0.504)).toBe(51);
    expect(matchConfidencePercent(0.499)).toBe(51);
  });

  it("leaves every other confidence as predictionPercent shows it", () => {
    expect(matchConfidencePercent(0.505)).toBe(51);
    expect(matchConfidencePercent(0.62)).toBe(62);
    expect(matchConfidencePercent(1)).toBe(99);
  });
});
