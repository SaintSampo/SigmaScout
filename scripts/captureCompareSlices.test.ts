/**
 * The arithmetic a before/after verdict rests on: the pooled row is weighted by
 * each arm's OWN scored count (the two arms score different sets when a change
 * moves the exclusion rule), and a slice in one arm only is an error.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { diffSlices, slicesOf, type CapturedSlice } from "./captureCompareSlices.js";

function slice(algorithmId: string, season: number, scoredCount: number, winnerAccuracy: number, brierScore: number, compLevelView = "qualification"): CapturedSlice {
  return { algorithmId, season, compLevelView, headlineEligible: true, brierScore, winnerAccuracy, scoredCount, candidateCount: scoredCount, exclusionCounts: {} };
}

describe("diffSlices", () => {
  it("pools by each arm's own scored count, so a smaller scored set is weighted as the smaller set it is", () => {
    const before = [slice("spr", 2025, 100, 0.7, 0.2), slice("spr", 2026, 300, 0.8, 0.1)];
    const after = [slice("spr", 2025, 50, 0.6, 0.3), slice("spr", 2026, 300, 0.8, 0.1)];
    const pooled = diffSlices(before, after, "qualification").find((d) => d.season === "pooled")!;
    expect(pooled.scoredBefore).toBe(400);
    expect(pooled.scoredAfter).toBe(350);
    expect(pooled.accuracyBefore).toBeCloseTo((0.7 * 100 + 0.8 * 300) / 400, 12);
    expect(pooled.accuracyAfter).toBeCloseTo((0.6 * 50 + 0.8 * 300) / 350, 12);
    expect(pooled.brierAfter).toBeCloseTo((0.3 * 50 + 0.1 * 300) / 350, 12);
  });

  it("reads one comp-level view only, and refuses a slice present in one arm only", () => {
    const before = [slice("spr", 2026, 10, 0.5, 0.25), slice("spr", 2026, 99, 0.9, 0.05, "playoff")];
    const after = [slice("spr", 2026, 10, 0.5, 0.25), slice("spr", 2026, 99, 0.1, 0.9, "playoff")];
    const deltas = diffSlices(before, after, "qualification");
    expect(deltas.map((d) => d.season)).toEqual([2026, "pooled"]);
    expect(deltas[0]!.accuracyAfter).toBe(0.5);
    expect(() => diffSlices(before, [slice("epa", 2026, 10, 0.5, 0.25)], "qualification")).toThrow(/one arm only/);
  });
});

describe("slicesOf", () => {
  it("keeps the published scorer's own fields from a Compare body", () => {
    const body = JSON.stringify({ slices: [{ ...slice("opr", 2024, 7, 0.6, 0.24), calibrationBins: [1, 2, 3], tieCount: 1 }] });
    expect(slicesOf(body)).toEqual([slice("opr", 2024, 7, 0.6, 0.24)]);
  });
});

describe("safety", () => {
  it("imports no network or signing module and reads no environment variable", () => {
    const source = readFileSync(new URL("./captureCompareSlices.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/r2Client|@aws-sdk|aws4fetch|process\.env|\bfetch\(/);
    expect(source).toMatch(/dryRun: true/);
    expect(source).toMatch(/skipState: true/);
  });
});
