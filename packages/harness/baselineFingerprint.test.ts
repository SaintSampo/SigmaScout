import { describe, expect, it } from "vitest";
import {
  buildBaselineFingerprint,
  BaselineFingerprintSchema,
  type BaselineFingerprintArtifactInput,
  type BuildBaselineFingerprintOptions,
} from "./baselineFingerprint.js";

describe("buildBaselineFingerprint", () => {
  const baseArtifact: BaselineFingerprintArtifactInput = {
    schemaVersion: 3,
    provenance: { runTimestamp: "2020-01-01T00:00:00.000Z", corpusIdentity: "data/corpus.sqlite" },
    slices: [
      {
        algorithmId: "opr",
        season: 2022,
        compLevelView: "combined",
        brierScore: 0.2,
        winnerAccuracy: 0.7,
        scoredCount: 2,
      },
    ],
  };

  const perSeasonRecords = new Map([
    [
      2022,
      [
        { matchKey: "2022test_qm1", pRedWin: 0.6, redScore: 50, blueScore: 40 },
        { matchKey: "2022test_qm2", pRedWin: 0.4, redScore: 30, blueScore: 45 },
      ],
    ],
  ]);

  const baseOptions: BuildBaselineFingerprintOptions = {
    label: "test-label",
    sourceNote: "unit test fixture",
    runDir: "reports/fixture",
    seasons: [2022],
    artifact: baseArtifact,
    algorithms: [{ id: "opr", version: "2.0.0+baseline", perSeasonRecords }],
  };

  it("builds a fingerprint that parses against BaselineFingerprintSchema", () => {
    const result = buildBaselineFingerprint(baseOptions);
    expect(() => BaselineFingerprintSchema.parse(result)).not.toThrow();
    expect(result.algorithms[0]?.id).toBe("opr");
    expect(result.algorithms[0]?.perSeason).toHaveLength(1);
    expect(result.algorithms[0]?.predictionStreamSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces the same predictionStreamSha256 across two identical calls", () => {
    const first = buildBaselineFingerprint(baseOptions);
    const second = buildBaselineFingerprint(baseOptions);
    expect(first.algorithms[0]?.predictionStreamSha256).toBe(second.algorithms[0]?.predictionStreamSha256);
    expect(first.algorithms[0]?.perSeason[0]?.predictionStreamSha256).toBe(
      second.algorithms[0]?.perSeason[0]?.predictionStreamSha256
    );
  });

  it("throws with a message naming the algorithm and season when the combined slice is missing or ambiguous", () => {
    const missingSliceOptions: BuildBaselineFingerprintOptions = {
      ...baseOptions,
      artifact: { ...baseArtifact, slices: [] },
    };
    expect(() => buildBaselineFingerprint(missingSliceOptions)).toThrow(/opr/);
    expect(() => buildBaselineFingerprint(missingSliceOptions)).toThrow(/2022/);

    const ambiguousSliceOptions: BuildBaselineFingerprintOptions = {
      ...baseOptions,
      artifact: { ...baseArtifact, slices: [...baseArtifact.slices, ...baseArtifact.slices] },
    };
    expect(() => buildBaselineFingerprint(ambiguousSliceOptions)).toThrow(/opr/);
    expect(() => buildBaselineFingerprint(ambiguousSliceOptions)).toThrow(/2022/);
  });
});
