import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ARTIFACT_SCHEMA_VERSION, buildArtifact, HarnessArtifactSchema, type HarnessArtifact } from "./artifact.js";
import { aggregateScores, type HarnessPredictionInput } from "./score.js";
import { statboticsReference, STATBOTICS_REFERENCE_FALLBACK } from "./statbotics.js";

const FIXTURE_PREDICTIONS: HarnessPredictionInput[] = [
  {
    matchKey: "2024test_qm1",
    season: 2024,
    eventKey: "2024test",
    compLevel: "qm",
    algorithmId: "opr",
    // An irrational-looking probability so an unrounded-storage assertion is meaningful.
    pRedWin: 1 / 3,
    predictedRedScore: 40,
    predictedBlueScore: 60,
    actualWinner: "red",
    isOffseason: false,
    isSurrogateAffected: false,
  },
  {
    matchKey: "2024test_qm2",
    season: 2024,
    eventKey: "2024test",
    compLevel: "qm",
    algorithmId: "opr",
    pRedWin: 0.6,
    predictedRedScore: 55,
    predictedBlueScore: 45,
    actualWinner: "blue",
    isOffseason: false,
    isSurrogateAffected: false,
  },
  {
    matchKey: "2025test_qm1",
    season: 2025,
    eventKey: "2025test",
    compLevel: "qm",
    algorithmId: "opr",
    pRedWin: 0.8,
    predictedRedScore: 65,
    predictedBlueScore: 35,
    actualWinner: "red",
    isOffseason: false,
    isSurrogateAffected: false,
  },
];

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sigmascout-artifact-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function buildFixtureArtifact(): Promise<HarnessArtifact> {
  const slices = aggregateScores(FIXTURE_PREDICTIONS, { corpusSeasons: [2024, 2025], selectedOnSeasons: { opr: [] } });
  const statboticsReferences = await Promise.all(
    [2024, 2025].map((season) => statboticsReference(season, { fetchImpl: () => Promise.reject(new Error("no network in tests")) }))
  );
  return buildArtifact({
    // D-13 (plan 03-03): buildArtifact requires the "{codeVersion}+{paramSetName}" shape.
    algorithms: [{ id: "opr", version: "1.0.0+baseline" }],
    corpusIdentity: "test-corpus",
    runTimestamp: "2026-08-13T00:00:00.000Z",
    slices,
    statboticsReferences,
  });
}

describe("buildArtifact / HarnessArtifactSchema", () => {
  it("passes schema validation and round-trips through JSON", async () => {
    const artifact = await buildFixtureArtifact();
    expect(() => HarnessArtifactSchema.parse(artifact)).not.toThrow();
    const roundTripped = JSON.parse(JSON.stringify(artifact)) as HarnessArtifact;
    expect(roundTripped).toEqual(artifact);
    expect(() => HarnessArtifactSchema.parse(roundTripped)).not.toThrow();
  });

  it("fails validation for an artifact missing a required field, and writeArtifact does not write it", async () => {
    const artifact = await buildFixtureArtifact();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const broken = { ...artifact } as any;
    delete broken.provenance;
    expect(() => HarnessArtifactSchema.parse(broken)).toThrow();

    const { writeArtifact } = await import("./artifact.js");
    const outDir = makeTempDir();
    expect(() => writeArtifact(outDir, broken)).toThrow();
    expect(existsSync(join(outDir, "artifact.json"))).toBe(false);
  });

  it("exports ARTIFACT_SCHEMA_VERSION and the builder references it rather than a literal", async () => {
    expect(ARTIFACT_SCHEMA_VERSION).toBe(3);
    const artifact = await buildFixtureArtifact();
    expect(artifact.schemaVersion).toBe(ARTIFACT_SCHEMA_VERSION);
  });

  it("carries algorithms[] (D-20) and tags every slice with a non-empty algorithmId", async () => {
    const artifact = await buildFixtureArtifact();
    expect(artifact.algorithms).toEqual([
      { id: "opr", version: "1.0.0+baseline", codeVersion: "1.0.0", paramSetName: "baseline" },
    ]);
    for (const slice of artifact.slices) {
      expect(typeof slice.algorithmId).toBe("string");
      expect(slice.algorithmId.length).toBeGreaterThan(0);
    }
  });

  it("D-13/plan 03-03: derives codeVersion/paramSetName by splitting version on the first '+'", async () => {
    const slices = aggregateScores(FIXTURE_PREDICTIONS, { corpusSeasons: [2024, 2025], selectedOnSeasons: { opr: [] } });
    const artifact = await buildArtifact({
      algorithms: [{ id: "vpr", version: "2.0.0+tuned-2026-08" }],
      corpusIdentity: "test-corpus",
      slices,
      statboticsReferences: [],
    });
    expect(artifact.algorithms).toEqual([
      { id: "vpr", version: "2.0.0+tuned-2026-08", codeVersion: "2.0.0", paramSetName: "tuned-2026-08" },
    ]);
  });

  it("D-13/plan 03-03: throws when an algorithm's version carries no '+' (a module that has not adopted the identity scheme)", async () => {
    const slices = aggregateScores(FIXTURE_PREDICTIONS, { corpusSeasons: [2024, 2025], selectedOnSeasons: { opr: [] } });
    expect(() =>
      buildArtifact({
        algorithms: [{ id: "legacy", version: "1.0.0" }],
        corpusIdentity: "test-corpus",
        slices,
        statboticsReferences: [],
      })
    ).toThrow(/does not carry D-13/);
  });

  it("v3 schema rejects an algorithm descriptor missing codeVersion/paramSetName", async () => {
    const artifact = await buildFixtureArtifact();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const broken = { ...artifact, algorithms: [{ id: "opr", version: "1.0.0+baseline" }] } as any;
    expect(() => HarnessArtifactSchema.parse(broken)).toThrow();
  });

  it("carries season, competition-level view, headline eligibility, both metrics, scored count, exclusion counts, and calibration bins on every slice", async () => {
    const artifact = await buildFixtureArtifact();
    expect(artifact.slices.length).toBeGreaterThan(0);
    for (const slice of artifact.slices) {
      expect(typeof slice.season).toBe("number");
      expect(["qualification", "elimination", "combined"]).toContain(slice.compLevelView);
      expect(typeof slice.headlineEligible).toBe("boolean");
      expect(slice.brierScore === null || typeof slice.brierScore === "number").toBe(true);
      expect(slice.winnerAccuracy === null || typeof slice.winnerAccuracy === "number").toBe(true);
      expect(typeof slice.scoredCount).toBe("number");
      expect(slice.exclusionCounts).toEqual(
        expect.objectContaining({
          offseason: expect.any(Number),
          surrogateAffected: expect.any(Number),
          missingResult: expect.any(Number),
        })
      );
      expect(Array.isArray(slice.calibrationBins)).toBe(true);
    }
  });

  it("stores brierScore and winnerAccuracy unrounded, matching the full-precision computed value", async () => {
    const slices = aggregateScores(FIXTURE_PREDICTIONS, { corpusSeasons: [2024, 2025], selectedOnSeasons: { opr: [] } });
    const qualSlice2024 = slices.find((s) => s.season === 2024 && s.compLevelView === "qualification")!;
    // Hand-computed at full precision from the 1/3 and 0.6 predictions above:
    //   (1/3 - 1)^2 = (−2/3)^2 = 4/9
    //   (0.6 - 0)^2 = 0.36
    //   Brier = (4/9 + 0.36) / 2
    const expectedBrier = ((1 / 3 - 1) ** 2 + (0.6 - 0) ** 2) / 2;
    expect(qualSlice2024.brierScore).toBe(expectedBrier);
    // Confirms no rounding: the raw float has far more than 4 decimal digits.
    expect(String(qualSlice2024.brierScore).replace("0.", "").length).toBeGreaterThan(4);

    const artifact = await buildArtifact({
      // D-13 (plan 03-03): buildArtifact requires the "{codeVersion}+{paramSetName}" shape.
    algorithms: [{ id: "opr", version: "1.0.0+baseline" }],
      corpusIdentity: "test-corpus",
      slices,
      statboticsReferences: [],
    });
    const artifactSlice = artifact.slices.find((s) => s.season === 2024 && s.compLevelView === "qualification")!;
    expect(artifactSlice.brierScore).toBe(expectedBrier);
  });

  it("carries seasonsCovered derived from the slices, a corpus/run provenance block, and the algorithms[] array (D-20)", async () => {
    const artifact = await buildFixtureArtifact();
    expect(artifact.provenance.seasonsCovered).toEqual([2024, 2025]);
    expect(artifact.algorithms).toEqual([
      { id: "opr", version: "1.0.0+baseline", codeVersion: "1.0.0", paramSetName: "baseline" },
    ]);
    expect(artifact.provenance.corpusIdentity).toBe("test-corpus");
    expect(artifact.provenance.runTimestamp).toBe("2026-08-13T00:00:00.000Z");
  });
});

describe("statboticsReference", () => {
  it("carries value, season, source label, match population, and capture date on a successful fetch", async () => {
    const mockFetch: typeof fetch = (async () =>
      new Response(JSON.stringify({ epa_acc: 0.734 }), { status: 200 })) as unknown as typeof fetch;
    const ref = await statboticsReference(2024, { fetchImpl: mockFetch });
    expect(ref.season).toBe(2024);
    expect(ref.value).toBe(0.734);
    expect(typeof ref.sourceLabel).toBe("string");
    expect(ref.sourceLabel.length).toBeGreaterThan(0);
    expect(typeof ref.matchPopulation).toBe("string");
    expect(ref.matchPopulation.length).toBeGreaterThan(0);
    expect(typeof ref.capturedAt).toBe("string");
    expect(ref.capturedAt.length).toBeGreaterThan(0);
    expect(ref.fetched).toBe(true);
  });

  it("falls back to the dated constant on a fetch failure, without throwing", async () => {
    const failingFetch: typeof fetch = (async () => {
      throw new Error("network unreachable");
    }) as unknown as typeof fetch;
    const ref = await statboticsReference(2024, { fetchImpl: failingFetch });
    expect(ref).toEqual(STATBOTICS_REFERENCE_FALLBACK[2024]);
    expect(ref.fetched).toBe(false);
  });

  it("falls back to the dated constant on a non-2xx response, without throwing", async () => {
    const errorFetch: typeof fetch = (async () =>
      new Response("<html>500</html>", { status: 500 })) as unknown as typeof fetch;
    const ref = await statboticsReference(2025, { fetchImpl: errorFetch });
    expect(ref).toEqual(STATBOTICS_REFERENCE_FALLBACK[2025]);
  });

  it("falls back to the dated constant when the response body fails schema validation", async () => {
    const malformedFetch: typeof fetch = (async () =>
      new Response(JSON.stringify({ unexpected: "shape" }), { status: 200 })) as unknown as typeof fetch;
    const ref = await statboticsReference(2026, { fetchImpl: malformedFetch });
    expect(ref).toEqual(STATBOTICS_REFERENCE_FALLBACK[2026]);
  });

  it("caches a successfully fetched value to disk when cachePath is provided", async () => {
    const dir = makeTempDir();
    const cachePath = join(dir, "statbotics-cache.json");
    let callCount = 0;
    const countingFetch: typeof fetch = (async () => {
      callCount += 1;
      return new Response(JSON.stringify({ epa_acc: 0.71 }), { status: 200 });
    }) as unknown as typeof fetch;

    const first = await statboticsReference(2024, { fetchImpl: countingFetch, cachePath });
    expect(first.fetched).toBe(true);
    expect(callCount).toBe(1);
    expect(existsSync(cachePath)).toBe(true);

    // Second call reads the cache and does not fetch again.
    const second = await statboticsReference(2024, { fetchImpl: countingFetch, cachePath });
    expect(second).toEqual(first);
    expect(callCount).toBe(1);
  });
});

describe("artifact secret scrubbing", () => {
  it("does not contain the value of process.env.TBA_API_KEY when serialized", async () => {
    const fakeApiKey = "sk-test-fake-tba-api-key-value-should-never-appear";
    const artifact = await buildFixtureArtifact();
    const serialized = JSON.stringify(artifact);
    expect(serialized.includes(fakeApiKey)).toBe(false);

    const { writeArtifact } = await import("./artifact.js");
    const outDir = makeTempDir();
    const path = writeArtifact(outDir, artifact, fakeApiKey);
    const written = readFileSync(path, "utf8");
    expect(written.includes(fakeApiKey)).toBe(false);
  });

  it("throws and does not write when the serialized artifact would contain the secret", async () => {
    const artifact = await buildFixtureArtifact();
    // Force the secret into the artifact to prove the scrub actually fires.
    const poisoned: HarnessArtifact = {
      ...artifact,
      provenance: { ...artifact.provenance, corpusIdentity: "leaked-secret-value" },
    };
    const { writeArtifact } = await import("./artifact.js");
    const outDir = makeTempDir();
    expect(() => writeArtifact(outDir, poisoned, "leaked-secret-value")).toThrow();
    expect(existsSync(join(outDir, "artifact.json"))).toBe(false);
  });
});
