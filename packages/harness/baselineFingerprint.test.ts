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

/**
 * `.planning/todos/completed/remeasure-baseline-fingerprint-post-trz.md`
 * (closed 2026-09-04 by quick task 260904-4ik): the SC-3 re-measurement under
 * the CURRENT promoted versions — `opr@4.0.0+baseline`,
 * `epa@2.0.0+baseline`, `vpr@7.0.0+rolling-2026-09` — read post-hoc from the
 * completed `reports/rolling-2026-09` run. It scores the identical match
 * population as `OFFSEASON_INCLUSIVE_FINGERPRINT_FILE` (per-season
 * `scoredCount`s match on all five seasons), which is what makes the two
 * directly comparable.
 *
 * It SUPERSEDES NOTHING. It is added ALONGSIDE the offseason-inclusive
 * fingerprint, which stays exactly as committed — that file's digests were
 * produced by code that no longer exists, so rewriting it to today's versions
 * would falsify a measurement record rather than update one. Both are
 * permanent.
 *
 * Excluded by name from the "retired-implementation" loop below (its `opr`
 * entry is `4.0.0+baseline`, not the retired `2.0.0+baseline`).
 */
const ROLLING_ORIGIN_FINGERPRINT_FILE = "sc3-rolling-origin-2026-09.json";

/**
 * The 2026-09-04 re-tune/republish session's re-measurement under the FINAL
 * shipped code of that day: `opr@4.0.0+baseline`, `epa@5.0.0+baseline`
 * (no-foul total, 1/3 elim discount, adjust pinned) and
 * `vpr@8.0.0+rolling-2026-09b` (origin 2022's off-arm winner; every other
 * season carried from `rolling-2026-09`). Scores the identical match
 * population as both SC-3 fingerprints above (per-season `scoredCount`s
 * match on all five seasons), keeping all three directly comparable.
 *
 * Same do-not-rewrite rule: added ALONGSIDE its predecessors, which stay
 * exactly as committed. Excluded by name from the "retired-implementation"
 * loop below (its `opr` entry is `4.0.0+baseline`, not `2.0.0+baseline`).
 */
const ROLLING_ORIGIN_2026_09B_FINGERPRINT_FILE = "sc3-rolling-origin-2026-09b.json";

/**
 * Quick task 260904-4aa (SC-2): NOT a `BaselineFingerprintSchema` fingerprint
 * at all — a different baseline family entirely, sharing this directory
 * because `data/baselines/` is this repo's general home for "a committed,
 * re-runnable measurement's tolerance record," not because every file here
 * is an algorithm-version Brier/accuracy fingerprint. This file records
 * per-team tolerance bands (`ordinaryLeastSquaresSlope`/`pearson`/etc. per
 * season) for `scripts/epaVsStatbotics.ts --check`, a per-team Statbotics
 * comparison with no `algorithms`/`seasons`/`provenance` shape to parse
 * against `BaselineFingerprintSchema`. Excluded by name from every test
 * below that assumes the directory's contents are uniformly fingerprints.
 */
const EPA_VS_STATBOTICS_BASELINE_FILE = "epa-vs-statbotics-2026-09.json";

describe("committed baseline fingerprints", () => {
  it("every .json file under data/baselines/ parses against BaselineFingerprintSchema", () => {
    const files = readdirSync(BASELINES_DIR).filter(
      (name) => name.endsWith(".json") && name !== EPA_VS_STATBOTICS_BASELINE_FILE
    );
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const file of files) {
      const raw: unknown = JSON.parse(readFileSync(join(BASELINES_DIR, file), "utf8"));
      expect(() => BaselineFingerprintSchema.parse(raw)).not.toThrow();
    }
  });

  it("data/algorithm-versions/ contains exactly the 4 committed Sigma1 promoted versions (RESEARCH.md Pitfall 1) — never a stray baseline fingerprint", () => {
    // The 2026-09-04 re-tune (under code version 8.0.0, --incumbent-gated
    // against the live rolling-2026-09 set) added the fourth:
    // `vpr@8.0.0+rolling-2026-09b.json` — origin 2022's off-arm winner
    // replacing 2022's set, every other season carried forward.
    //
    // Quick task 260904-100 (Task 6) added the third: `vpr@7.0.0+rolling-2026-09.json`,
    // the rolling-origin per-season promotion — a real, deliberate committed
    // version, not a stray file. This test's job is to catch the OTHER kind
    // of drift (a baseline fingerprint dropped in the wrong directory), so it
    // asserts the exact expected SET, not merely a count that would pass just
    // as well for three wrong files as for three right ones.
    //
    // Quick task 260904-6a1 (Task 3): all three `vpr@7.0.0+*` files were
    // retired and re-promoted as `vpr@8.0.0+*` under `SIGMA1_CODE_VERSION`'s
    // 7.0.0 -> 8.0.0 bump — unlike `data/baselines/`'s frozen historical
    // fingerprints (below), `data/algorithm-versions/` holds the LIVE
    // committed set `digest.test.ts` re-promotes and gates, so this
    // assertion tracks the current names rather than a historical record.
    const files = readdirSync(ALGORITHM_VERSIONS_DIR).filter((name) => name.endsWith(".json"));
    expect(
      [...files].sort(),
      `data/algorithm-versions/ is glob-scanned and Sigma1-schema-parsed by digest.test.ts — baseline fingerprints ` +
        `belong in ${BASELINES_DIR}, never in ${ALGORITHM_VERSIONS_DIR}. Found: ${JSON.stringify(files)}`
    ).toEqual([
      "vpr@8.0.0+rolling-2026-09.json",
      "vpr@8.0.0+rolling-2026-09b.json",
      "vpr@8.0.0+tracer-check.json",
      "vpr@8.0.0+tuned-2026-08.json",
    ]);
  });

  it("both retired-implementation fingerprints record OPR's own pre-rewrite id/version, not anything later", () => {
    const files = readdirSync(BASELINES_DIR).filter(
      (name) =>
        name.endsWith(".json") &&
        name !== EVENT_SCOPED_FINGERPRINT_FILE &&
        name !== OFFSEASON_INCLUSIVE_FINGERPRINT_FILE &&
        name !== ROLLING_ORIGIN_FINGERPRINT_FILE &&
        name !== ROLLING_ORIGIN_2026_09B_FINGERPRINT_FILE &&
        name !== EPA_VS_STATBOTICS_BASELINE_FILE
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

  it("data/baselines/ contains exactly 7 committed baseline files: two retired-implementation fingerprints, the event-scoped re-run, the offseason-inclusive SC-3 re-measurement, both rolling-origin SC-3 re-measurements, and the SC-2 EPA-vs-Statbotics tolerance baseline", () => {
    // The fingerprint count only ever goes UP. Each fingerprint records what
    // one completed run measured under the versions of its day, so a later
    // re-measurement is added alongside its predecessor, never in place of
    // it. `EPA_VS_STATBOTICS_BASELINE_FILE` is not a fingerprint (see its own
    // doc comment) but lives in this same directory and is counted here too,
    // since this is the one test asserting the directory's exact contents.
    const files = readdirSync(BASELINES_DIR).filter((name) => name.endsWith(".json"));
    expect(files).toHaveLength(7);
    expect(files).toContain(EVENT_SCOPED_FINGERPRINT_FILE);
    expect(files).toContain(OFFSEASON_INCLUSIVE_FINGERPRINT_FILE);
    expect(files).toContain(ROLLING_ORIGIN_FINGERPRINT_FILE);
    expect(files).toContain(ROLLING_ORIGIN_2026_09B_FINGERPRINT_FILE);
    expect(files).toContain(EPA_VS_STATBOTICS_BASELINE_FILE);
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
   * its committed `predictionStreamSha256` digests.
   *
   * HOW FAR BEHIND, kept current so a reader can tell at a glance:
   *   - quick task 260901-is2 (2026-09-01) bumped all three — opr 3.1.0 ->
   *     4.0.0 (D-Q4), epa 1.1.0 -> 2.0.0 (D-Q1), vpr 2.1.0 -> 3.0.0 (D-Q2) —
   *     and changed the winner-accuracy denominator for every algorithm
   *     (D-Q3);
   *   - quick task 260901-trz (2026-09-01) bumped vpr again, 3.0.0 -> 4.0.0
   *     (D-T1/D-T2, the scale-relative parameter reshape).
   * So vpr is now TWO model versions ahead of what this file records, and
   * opr/epa are one each.
   *
   * DO NOT "update" these three assertions to the new version strings. Doing so
   * would attach a real digest to code that never produced it, i.e. falsify a
   * measurement record. The correct response to the bumps is a NEW fingerprint
   * file measured under the new code, added alongside this one:
   * `.planning/todos/pending/remeasure-baseline-fingerprint-post-trz.md`
   * (which supersedes the post-is2 todo, since a single re-measurement now
   * covers both bumps).
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

  /**
   * `.planning/todos/completed/remeasure-baseline-fingerprint-post-trz.md`,
   * closed by quick task 260904-4ik: the re-measurement the block above asks
   * for, added ALONGSIDE it rather than over it.
   *
   * The three versions below are the versions this fingerprint was MEASURED
   * under — a historical record, not a claim about what the code ships today.
   * They are what produced its committed `predictionStreamSha256` digests,
   * read post-hoc from `reports/rolling-2026-09` (runTimestamp
   * 2026-09-04T06:20:54.823Z, verified to predate quick task 260904-cs1 —
   * see the file's own `sourceNote` for the three instruments).
   *
   * THE SAME DO-NOT-REWRITE RULE APPLIES TO THIS BLOCK the moment the code
   * moves past these versions, for exactly the reason spelled out above: a
   * version string edited to match today's code attaches a real digest to code
   * that never produced it. When these go stale, add a SIXTH fingerprint and a
   * sixth block; do not touch these three lines.
   *
   * Note also that the todo predicted `vpr@4.0.0+*`. The version actually
   * promoted by the rolling-origin re-tune is `7.0.0+rolling-2026-09`,
   * because further bumps landed between the todo being written (2026-09-01)
   * and this measurement (2026-09-04). The discrepancy is recorded here rather
   * than quietly resolved.
   */
  /**
   * The 2026-09-04 session's re-measurement (see the constant's own doc
   * comment). Unlike its two predecessors this one was generated the SAME
   * session its versions were promoted and republished — the source note is
   * a command transcript, not a reconstruction, and there is no
   * code-currency gap to instrument. The same do-not-rewrite rule applies
   * the moment the code moves past these versions: add an eighth
   * fingerprint and an eighth block; do not touch these three lines.
   */
  it("the 2026-09-04b rolling-origin fingerprint carries exactly opr/epa/vpr, at the versions the re-tune/republish session shipped", () => {
    const raw: unknown = JSON.parse(
      readFileSync(join(BASELINES_DIR, ROLLING_ORIGIN_2026_09B_FINGERPRINT_FILE), "utf8")
    );
    const parsed = BaselineFingerprintSchema.parse(raw);
    const byId = new Map(parsed.algorithms.map((a) => [a.id, a.version]));
    expect(Array.from(byId.keys()).sort()).toEqual(["epa", "opr", "vpr"]);
    expect(byId.get("opr")).toBe("4.0.0+baseline");
    expect(byId.get("epa")).toBe("5.0.0+baseline");
    expect(byId.get("vpr")).toBe("8.0.0+rolling-2026-09b");
  });

  it("the rolling-origin fingerprint carries exactly opr/epa/vpr, at the current promoted versions it was measured under", () => {
    const raw: unknown = JSON.parse(
      readFileSync(join(BASELINES_DIR, ROLLING_ORIGIN_FINGERPRINT_FILE), "utf8")
    );
    const parsed = BaselineFingerprintSchema.parse(raw);
    const byId = new Map(parsed.algorithms.map((a) => [a.id, a.version]));
    expect(Array.from(byId.keys()).sort()).toEqual(["epa", "opr", "vpr"]);
    expect(byId.get("opr")).toBe("4.0.0+baseline");
    expect(byId.get("epa")).toBe("2.0.0+baseline");
    expect(byId.get("vpr")).toBe("7.0.0+rolling-2026-09");
  });
});
