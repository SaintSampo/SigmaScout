import { describe, expect, it } from "vitest";
import { pooledAccuracyPodium, type SeasonedCompareArtifact } from "./homePodium.js";
import type { CompareArtifact } from "../../../../packages/harness/pageArtifacts.js";

/** A minimal artifact carrying one combined slice per algorithm — only the fields the podium reads. */
function artifact(season: number, perAlgo: Record<string, { acc: number | null; n: number }>): CompareArtifact {
  return {
    slices: Object.entries(perAlgo).map(([algorithmId, { acc, n }]) => ({
      algorithmId,
      season,
      compLevelView: "combined",
      winnerAccuracy: acc,
      scoredCount: n,
    })),
  } as unknown as CompareArtifact;
}

/** Pairs an artifact with the season the caller claims it was fetched for — WR-03's assert reads THIS pairing, not any field on the artifact itself. */
function seasoned(season: number, art: CompareArtifact): SeasonedCompareArtifact {
  return { season, artifact: art };
}

describe("pooledAccuracyPodium", () => {
  it("pools as a scoredCount-weighted mean, never a mean of means", () => {
    const a = artifact(2024, { vpr: { acc: 0.8, n: 100 }, epa: { acc: 0.7, n: 100 }, opr: { acc: 0.7, n: 100 } });
    const b = artifact(2025, { vpr: { acc: 0.6, n: 900 }, epa: { acc: 0.7, n: 900 }, opr: { acc: 0.75, n: 900 } });
    const podium = pooledAccuracyPodium([seasoned(2024, a), seasoned(2025, b)]);
    const vpr = podium.find((p) => p.algorithmId === "vpr")!;
    // Weighted: (0.8*100 + 0.6*900) / 1000 = 0.62 — a mean-of-means would say 0.7.
    expect(vpr.accuracy).toBeCloseTo(0.62, 10);
    expect(vpr.scoredCount).toBe(1000);
  });

  it("sorts best-first — the podium order", () => {
    const a = artifact(2024, { vpr: { acc: 0.76, n: 10 }, epa: { acc: 0.72, n: 10 }, opr: { acc: 0.73, n: 10 } });
    expect(pooledAccuracyPodium([seasoned(2024, a)]).map((p) => p.algorithmId)).toEqual(["vpr", "opr", "epa"]);
  });

  it("a null-accuracy slice contributes nothing rather than poisoning the pool", () => {
    const a = artifact(2024, { vpr: { acc: null, n: 50 }, epa: { acc: 0.7, n: 50 }, opr: { acc: 0.7, n: 50 } });
    const b = artifact(2025, { vpr: { acc: 0.8, n: 100 }, epa: { acc: 0.7, n: 100 }, opr: { acc: 0.7, n: 100 } });
    const vpr = pooledAccuracyPodium([seasoned(2024, a), seasoned(2025, b)]).find((p) => p.algorithmId === "vpr")!;
    expect(vpr.accuracy).toBeCloseTo(0.8, 10);
    expect(vpr.scoredCount).toBe(100);
  });

  it("throws loudly, naming the season, on a missing combined slice instead of rendering a wrong podium", () => {
    const bad = { slices: [] } as unknown as CompareArtifact;
    expect(() => pooledAccuracyPodium([seasoned(2024, bad)])).toThrow(/no combined 2024 slice/);
  });

  /**
   * WR-03 (260902-post-phase08-ungoverned-ui/REVIEW.md): this is the whole
   * point of the finding. An artifact that carries slices for OTHER seasons
   * only — never the season the caller claims it was fetched for — must
   * throw rather than silently pool a different season's numbers under the
   * caller's claimed year (which, before this fix, is exactly what a
   * mis-keyed or multi-season artifact would have done: the old lookup
   * matched on algorithmId + compLevelView alone).
   */
  it("throws, naming the season, when an artifact carries only OTHER seasons' slices", () => {
    const wrongSeason = artifact(2023, { vpr: { acc: 0.8, n: 100 }, epa: { acc: 0.7, n: 100 }, opr: { acc: 0.7, n: 100 } });
    expect(() => pooledAccuracyPodium([seasoned(2024, wrongSeason)])).toThrow(/no combined 2024 slice/);
  });
});
