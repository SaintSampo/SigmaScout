import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildBaselineFingerprint,
  BaselineFingerprintSchema,
  readSeasonRecordsBySidecar,
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

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sigmascout-baselinefingerprint-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * IN-03 (03.2-REVIEW.md): a truncated final line — the process-killed-
 * mid-write failure mode this file's own doc comment already reasons
 * about for the missing/empty-file case — must re-throw with the sidecar
 * path and line number named, not surface a bare `SyntaxError`.
 */
describe("readSeasonRecordsBySidecar", () => {
  it("re-throws with the sidecar path and line number when the final line is truncated JSON", async () => {
    const runDir = makeTempDir();
    const goodLine = JSON.stringify({
      matchKey: "2022test_qm1",
      algorithmId: "opr",
      pRedWin: 0.6,
      predictedRedScore: 50,
      predictedBlueScore: 40,
    });
    const truncatedLine = '{"matchKey":"2022test_qm2","algorithmId":"opr","pRedWin":0.4,"pred';
    writeFileSync(join(runDir, "predictions-2022.jsonl"), `${goodLine}\n${truncatedLine}`, "utf8");

    await expect(readSeasonRecordsBySidecar(runDir, 2022, ["opr"])).rejects.toThrow(
      /predictions-2022\.jsonl:2/
    );
    await expect(readSeasonRecordsBySidecar(runDir, 2022, ["opr"])).rejects.toThrow(
      /2022test_qm2/
    );
  });

  it("still returns zero records for a missing sidecar file (pre-existing behavior, unchanged by IN-03)", async () => {
    const runDir = makeTempDir();
    const result = await readSeasonRecordsBySidecar(runDir, 2022, ["opr"]);
    expect(result.get("opr")).toEqual([]);
  });
});

const BASELINES_DIR = join("data", "baselines");
const ALGORITHM_VERSIONS_DIR = join("data", "algorithm-versions");

/**
 * Task 3 (03.2-RESEARCH.md Pitfall 1): proves the two committed OPR
 * fingerprints' placement does not break `digest.test.ts`'s
 * `listVersionFiles()` glob-scan of `data/algorithm-versions/`, which
 * parses every file there against the Sigma1-shaped `PromotedVersionSchema`
 * — a bare OPR fingerprint placed there would fail that scan with an opaque
 * Zod error about a missing `params` field instead of living in a directory
 * built for its own shape.
 */
const EVENT_SCOPED_FINGERPRINT_FILE = "opr-event-scoped-2026-08.json";

/**
 * `.planning/todos/pending/remeasure-accuracy-record-offseason-inclusion.md`
 * (2026-08-30): the SC-3 re-measurement under the offseason-inclusive
 * publish methodology (07-17 PD-02), folded together with the demo-team
 * exclusion and whole-alliance-DQ-zero-score fixes that landed the same
 * day — a fourth committed fingerprint, distinct from both the two
 * retired-implementation runs and the event-scoped re-run above. Excluded
 * by name from the "retired-implementation" loop below (its `opr` entry is
 * `3.1.0+baseline`, not the retired `2.0.0+baseline`) and from
 * `EVENT_SCOPED_FINGERPRINT_FILE`'s own five-algorithm-entry assertion
 * (this run only scores `opr,epa,vpr` — the three SC-3 needs).
 */
const OFFSEASON_INCLUSIVE_FINGERPRINT_FILE = "sc3-offseason-inclusive-2026-08.json";

describe("committed baseline fingerprints", () => {
  it("every .json file under data/baselines/ parses against BaselineFingerprintSchema", () => {
    const files = readdirSync(BASELINES_DIR).filter((name) => name.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const file of files) {
      const raw: unknown = JSON.parse(readFileSync(join(BASELINES_DIR, file), "utf8"));
      expect(() => BaselineFingerprintSchema.parse(raw)).not.toThrow();
    }
  });

  it("data/algorithm-versions/ still contains exactly the 2 pre-existing Sigma1 promoted versions (RESEARCH.md Pitfall 1)", () => {
    const files = readdirSync(ALGORITHM_VERSIONS_DIR).filter((name) => name.endsWith(".json"));
    expect(
      files,
      `data/algorithm-versions/ is glob-scanned and Sigma1-schema-parsed by digest.test.ts — baseline fingerprints ` +
        `belong in ${BASELINES_DIR}, never in ${ALGORITHM_VERSIONS_DIR}. Found: ${JSON.stringify(files)}`
    ).toHaveLength(2);
  });

  it("both retired-implementation fingerprints record OPR's own pre-rewrite id/version, not anything later", () => {
    const files = readdirSync(BASELINES_DIR).filter(
      (name) =>
        name.endsWith(".json") &&
        name !== EVENT_SCOPED_FINGERPRINT_FILE &&
        name !== OFFSEASON_INCLUSIVE_FINGERPRINT_FILE
    );
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const file of files) {
      const raw: unknown = JSON.parse(readFileSync(join(BASELINES_DIR, file), "utf8"));
      const parsed = BaselineFingerprintSchema.parse(raw);
      expect(parsed.algorithms[0]?.id).toBe("opr");
      expect(parsed.algorithms[0]?.version).toBe("2.0.0+baseline");
    }
  });

  it("the event-scoped fingerprint (plan 03.2-03) parses against BaselineFingerprintSchema and carries exactly five algorithm entries", () => {
    const raw: unknown = JSON.parse(
      readFileSync(join(BASELINES_DIR, EVENT_SCOPED_FINGERPRINT_FILE), "utf8")
    );
    const parsed = BaselineFingerprintSchema.parse(raw);
    const ids = parsed.algorithms.map((a) => a.id).sort();
    expect(ids).toEqual(["epa", "opr", "sigma1", "sigma1-adapt", "sigma1-defaults"]);
  });

  it("the event-scoped fingerprint's opr entry reads 3.0.0+baseline — the committed record cannot silently hold two different algorithms under one version string (D-11)", () => {
    const raw: unknown = JSON.parse(
      readFileSync(join(BASELINES_DIR, EVENT_SCOPED_FINGERPRINT_FILE), "utf8")
    );
    const parsed = BaselineFingerprintSchema.parse(raw);
    const opr = parsed.algorithms.find((a) => a.id === "opr");
    expect(opr?.version).toBe("3.0.0+baseline");
  });

  /**
   * A-01 / T-03.2-13 (03.2-SECURITY.md): `packages/harness/cli.ts`'s
   * `applyPromotedOverrides` resolves `loadSearchWinnerVpr("vpr-adapt",
   * ON_SEARCH_ARTIFACT_PATH, "tune-joint-on-winner") ?? algorithm` (renamed
   * from `loadSearchWinnerSigma1("sigma1-adapt", ...)` by plan 07-16,
   * D-04/D-05 — the mechanism this test pins is unchanged by the rename).
   * When the gitignored `reports/tune-joint-on.json` is absent — the default
   * state of any fresh worktree — that `??` silently falls back and the
   * adaptation variant resolves to `2.0.0+defaults-adapt` instead of the
   * published `2.0.0+tune-joint-on-winner`. The run still succeeds and the
   * numbers still look plausible; they are a different algorithm's numbers.
   * This is not a typo guard — `2.0.0+defaults-adapt` is exactly what the
   * silent fallback produces, and this assertion exists so a future re-run
   * cannot regress to it undetected.
   *
   * The fixture read below (`data/baselines/opr-event-scoped-2026-08.json`)
   * is a FROZEN historical measurement (tier F, this plan's first
   * prohibition) — it still names the entry `sigma1-adapt` because that is
   * genuinely the id the run that produced it used, before this plan's
   * rename. This assertion is deliberately NOT updated to `vpr-adapt`.
   */
  it("the event-scoped fingerprint's sigma1-adapt entry reads 2.0.0+tune-joint-on-winner, not the silent-fallback 2.0.0+defaults-adapt (A-01, T-03.2-13)", () => {
    const raw: unknown = JSON.parse(
      readFileSync(join(BASELINES_DIR, EVENT_SCOPED_FINGERPRINT_FILE), "utf8")
    );
    const parsed = BaselineFingerprintSchema.parse(raw);
    const sigma1Adapt = parsed.algorithms.find((a) => a.id === "sigma1-adapt");
    expect(sigma1Adapt?.version).toBe("2.0.0+tune-joint-on-winner");
  });

  it("data/baselines/ contains exactly 4 committed fingerprints: two retired-implementation runs, the event-scoped re-run, and the offseason-inclusive SC-3 re-measurement", () => {
    const files = readdirSync(BASELINES_DIR).filter((name) => name.endsWith(".json"));
    expect(files).toHaveLength(4);
    expect(files).toContain(EVENT_SCOPED_FINGERPRINT_FILE);
    expect(files).toContain(OFFSEASON_INCLUSIVE_FINGERPRINT_FILE);
  });

  /**
   * `.planning/todos/completed/remeasure-accuracy-record-offseason-inclusion.md`:
   * the fingerprint must carry exactly the three algorithms SC-3 compares
   * (not the five-algorithm shape `EVENT_SCOPED_FINGERPRINT_FILE` carries),
   * under the ids and versions the measurement was actually RUN under — never
   * silently reusing the retired `opr@2.0.0+baseline`/`sigma1` identities.
   *
   * The three versions below are a HISTORICAL RECORD, not a claim about what
   * the code currently ships. They are the versions this fingerprint was
   * MEASURED under on 2026-08-30 (pre-260901-is2), and they are what produced
   * its committed `predictionStreamSha256` digests. Quick task 260901-is2
   * (2026-09-01) bumped all three past these values — opr 3.1.0 -> 4.0.0
   * (D-Q4), epa 1.1.0 -> 2.0.0 (D-Q1), vpr 2.1.0 -> 3.0.0 (D-Q2) — and also
   * changed the winner-accuracy denominator for every algorithm (D-Q3).
   *
   * DO NOT "update" these three assertions to the new version strings. Doing so
   * would attach a real digest to code that never produced it, i.e. falsify a
   * measurement record. The correct response to the bumps is a NEW fingerprint
   * file measured under the new code, added alongside this one:
   * `.planning/todos/pending/remeasure-baseline-fingerprint-post-is2.md`.
   */
  it("the offseason-inclusive fingerprint carries exactly opr/epa/vpr, at the versions it was measured under (pre-260901-is2)", () => {
    const raw: unknown = JSON.parse(
      readFileSync(join(BASELINES_DIR, OFFSEASON_INCLUSIVE_FINGERPRINT_FILE), "utf8")
    );
    const parsed = BaselineFingerprintSchema.parse(raw);
    const byId = new Map(parsed.algorithms.map((a) => [a.id, a.version]));
    expect(Array.from(byId.keys()).sort()).toEqual(["epa", "opr", "vpr"]);
    expect(byId.get("opr")).toBe("3.1.0+baseline");
    expect(byId.get("epa")).toBe("1.1.0+baseline");
    expect(byId.get("vpr")).toBe("2.1.0+tuned-2026-08");
  });
});
