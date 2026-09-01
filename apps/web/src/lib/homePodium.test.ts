import { describe, expect, it } from "vitest";
import { pooledAccuracyPodium } from "./homePodium.js";
import type { CompareArtifact } from "../../../../packages/harness/pageArtifacts.js";

/** A minimal artifact carrying one combined slice per algorithm — only the fields the podium reads. */
function artifact(perAlgo: Record<string, { acc: number | null; n: number }>): CompareArtifact {
  return {
    slices: Object.entries(perAlgo).map(([algorithmId, { acc, n }]) => ({
      algorithmId,
      compLevelView: "combined",
      winnerAccuracy: acc,
      scoredCount: n,
    })),
  } as unknown as CompareArtifact;
}

describe("pooledAccuracyPodium", () => {
  it("pools as a scoredCount-weighted mean, never a mean of means", () => {
    const a = artifact({ vpr: { acc: 0.8, n: 100 }, epa: { acc: 0.7, n: 100 }, opr: { acc: 0.7, n: 100 } });
    const b = artifact({ vpr: { acc: 0.6, n: 900 }, epa: { acc: 0.7, n: 900 }, opr: { acc: 0.75, n: 900 } });
    const podium = pooledAccuracyPodium([a, b]);
    const vpr = podium.find((p) => p.algorithmId === "vpr")!;
    // Weighted: (0.8*100 + 0.6*900) / 1000 = 0.62 — a mean-of-means would say 0.7.
    expect(vpr.accuracy).toBeCloseTo(0.62, 10);
    expect(vpr.scoredCount).toBe(1000);
  });

  it("sorts best-first — the podium order", () => {
    const a = artifact({ vpr: { acc: 0.76, n: 10 }, epa: { acc: 0.72, n: 10 }, opr: { acc: 0.73, n: 10 } });
    expect(pooledAccuracyPodium([a]).map((p) => p.algorithmId)).toEqual(["vpr", "opr", "epa"]);
  });

  it("a null-accuracy slice contributes nothing rather than poisoning the pool", () => {
    const a = artifact({ vpr: { acc: null, n: 50 }, epa: { acc: 0.7, n: 50 }, opr: { acc: 0.7, n: 50 } });
    const b = artifact({ vpr: { acc: 0.8, n: 100 }, epa: { acc: 0.7, n: 100 }, opr: { acc: 0.7, n: 100 } });
    const vpr = pooledAccuracyPodium([a, b]).find((p) => p.algorithmId === "vpr")!;
    expect(vpr.accuracy).toBeCloseTo(0.8, 10);
    expect(vpr.scoredCount).toBe(100);
  });

  it("throws loudly on a missing combined slice instead of rendering a wrong podium", () => {
    const bad = { slices: [] } as unknown as CompareArtifact;
    expect(() => pooledAccuracyPodium([bad])).toThrow(/no combined slice/);
  });
});
