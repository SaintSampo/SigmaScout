/**
 * Synthetic-fixture tests for the SC-5 / D-07 diagnostic. Task 1 covers the
 * pure checkpoint-assignment logic (`assignCheckpointBucket`,
 * `tagRecordsWithCompletedQuals`) — the load-bearing behavior behind the
 * accuracy-by-checkpoint half, exercised directly rather than through a
 * real corpus/run-dir read.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertWarmCutPartition,
  assignCheckpointBucket,
  buildCheckpointRows,
  buildReconciliationEntry,
  computeWarmCut,
  poolSlices,
  readSidecarRecordsForAlgorithm,
  tagRecordsWithCompletedQuals,
  type QualMatchLike,
  type TaggableRecord,
  type TaggedPrediction,
} from "./eventScopeDiagnostic.js";
import { computeDesignMatrix } from "./identifiability.js";
import type { HarnessPredictionInput, ScoreSlice } from "./score.js";

function rec(eventKey: string, compLevel: TaggableRecord["compLevel"]): TaggableRecord {
  return { eventKey, compLevel };
}

describe("assignCheckpointBucket", () => {
  it("buckets are half-open exactly at the fixed boundaries", () => {
    expect(assignCheckpointBucket(0)).toBe("0");
    expect(assignCheckpointBucket(1)).toBe("1-6");
    expect(assignCheckpointBucket(6)).toBe("1-6");
    expect(assignCheckpointBucket(7)).toBe("7-12");
    expect(assignCheckpointBucket(12)).toBe("7-12");
    expect(assignCheckpointBucket(13)).toBe("13-24");
    expect(assignCheckpointBucket(24)).toBe("13-24");
    expect(assignCheckpointBucket(25)).toBe("25-48");
    expect(assignCheckpointBucket(48)).toBe("25-48");
    expect(assignCheckpointBucket(49)).toBe("49+");
    expect(assignCheckpointBucket(1000)).toBe("49+");
  });
});

describe("tagRecordsWithCompletedQuals", () => {
  it("the first record at an event lands in bucket 0", () => {
    const tagged = tagRecordsWithCompletedQuals([rec("2024casj", "qm")]);
    expect(tagged[0]!.completedBefore).toBe(0);
    expect(tagged[0]!.bucket).toBe("0");
  });

  it("a playoff record does not increment the event's completed-quals counter while a qm record does", () => {
    const tagged = tagRecordsWithCompletedQuals([
      rec("2024casj", "qm"), // completedBefore 0 -> counter becomes 1
      rec("2024casj", "sf"), // completedBefore 1, playoff -> counter stays 1
      rec("2024casj", "qm"), // completedBefore 1 (the playoff record above did NOT advance it)
    ]);
    expect(tagged[0]!.completedBefore).toBe(0);
    expect(tagged[1]!.completedBefore).toBe(1);
    expect(tagged[1]!.bucket).toBe("1-6");
    expect(tagged[2]!.completedBefore).toBe(1);
  });

  it("two interleaved events' counters advance independently", () => {
    const tagged = tagRecordsWithCompletedQuals([
      rec("2024casj", "qm"), // casj: 0 -> 1
      rec("2024txho", "qm"), // txho: 0 -> 1
      rec("2024casj", "qm"), // casj: 1 -> 2
      rec("2024txho", "qm"), // txho: 1 -> 2
      rec("2024casj", "qm"), // casj: 2 -> 3
    ]);
    expect(tagged.map((t) => t.completedBefore)).toEqual([0, 0, 1, 1, 2]);
  });

  it("bucket boundaries are half-open exactly as specified: completedBefore === 6 lands in 1-6, === 7 lands in 7-12", () => {
    const records: TaggableRecord[] = [];
    for (let i = 0; i < 13; i++) records.push(rec("2024casj", "qm"));
    const tagged = tagRecordsWithCompletedQuals(records);
    // tagged[6] has completedBefore === 6 (six prior qm records already counted)
    expect(tagged[6]!.completedBefore).toBe(6);
    expect(tagged[6]!.bucket).toBe("1-6");
    // tagged[7] has completedBefore === 7
    expect(tagged[7]!.completedBefore).toBe(7);
    expect(tagged[7]!.bucket).toBe("7-12");
  });
});

function qualMatch(matchKey: string, redTeams: string[], blueTeams: string[]): QualMatchLike {
  return {
    matchKey,
    eventKey: "2024casj",
    compLevel: "qm",
    redTeams,
    blueTeams,
    redSurrogates: [],
    blueSurrogates: [],
  };
}

describe("buildCheckpointRows / computeDesignMatrix — D-07's mechanism half", () => {
  function synthetic10MatchEvent(): QualMatchLike[] {
    const matches: QualMatchLike[] = [];
    for (let i = 1; i <= 10; i++) {
      matches.push(qualMatch(`2024casj_qm${i}`, [`R${i}a`, `R${i}b`, `R${i}c`], [`B${i}a`, `B${i}b`, `B${i}c`]));
    }
    return matches;
  }

  it("a synthetic event with 10 qualification matches produces 20 alliance rows at the event-end checkpoint", () => {
    const rows = buildCheckpointRows(synthetic10MatchEvent(), "event-end");
    expect(rows).toHaveLength(20);
  });

  it("produces 12 rows at the checkpoint of 6 (first 6 matches, 2 rows each)", () => {
    const rows = buildCheckpointRows(synthetic10MatchEvent(), 6);
    expect(rows).toHaveLength(12);
  });

  it("the checkpoint of 0 produces an empty row set whose computeDesignMatrix result reports rank 0 and fullColumnRank false, without throwing", () => {
    const rows = buildCheckpointRows(synthetic10MatchEvent(), 0);
    expect(rows).toHaveLength(0);
    const design = computeDesignMatrix(rows);
    expect(design.rank).toBe(0);
    expect(design.fullColumnRank).toBe(false);
  });

  it("a synthetically under-determined event reports rank < teamColumnCount", () => {
    // Two disjoint alliance clusters that never share a team: the
    // participation graph is disconnected, so the design matrix cannot be
    // full column rank (mirrors identifiability.ts's own disconnected-graph
    // reasoning).
    const disconnected: QualMatchLike[] = [
      qualMatch("2024casj_qm1", ["A1", "A2", "A3"], ["A4", "A5", "A6"]),
      qualMatch("2024casj_qm2", ["B1", "B2", "B3"], ["B4", "B5", "B6"]),
    ];
    const rows = buildCheckpointRows(disconnected, "event-end");
    const design = computeDesignMatrix(rows);
    expect(design.rank).toBeLessThan(design.teamColumnCount);
    expect(design.fullColumnRank).toBe(false);
  });
});

function predictionInput(matchKey: string): HarnessPredictionInput {
  return {
    matchKey,
    season: 2022,
    // `matchKey` here is already an event-qualified key (e.g. "2022abc_qm1");
    // its event prefix is the block this record belongs to (D-T6).
    eventKey: matchKey.split("_")[0] ?? matchKey,
    compLevel: "qm",
    algorithmId: "opr",
    pRedWin: 0.6,
    predictedRedScore: 50,
    predictedBlueScore: 40,
    actualWinner: "red",
    isOffseason: false,
    isSurrogateAffected: false,
  };
}

describe("computeWarmCut / assertWarmCutPartition — D-09's warm-only cut", () => {
  it("a synthetic record set where exactly 3 of 10 records fall below the 12-qual threshold produces coldOnly.scoredCount === 3 and warmOnly.scoredCount === 7", () => {
    const completedBeforeValues = [0, 5, 11, 12, 13, 20, 30, 40, 50, 60]; // 3 below 12, 7 at-or-above
    const tagged: TaggedPrediction[] = completedBeforeValues.map((completedBefore, i) => ({
      input: predictionInput(`m${i}`),
      completedBefore,
    }));
    const result = computeWarmCut(tagged);
    expect(result.coldOnly.scoredCount).toBe(3);
    expect(result.warmOnly.scoredCount).toBe(7);
    expect(result.allMatches.scoredCount).toBe(10);
  });

  it("the sum check throws when the partition is deliberately corrupted", () => {
    const allMatches = { brierScore: 0.2, winnerAccuracy: 0.7, scoredCount: 10 };
    const warmOnly = { brierScore: 0.2, winnerAccuracy: 0.7, scoredCount: 7 };
    const coldOnlyCorrupted = { brierScore: 0.2, winnerAccuracy: 0.7, scoredCount: 2 }; // should be 3
    expect(() => assertWarmCutPartition(allMatches, warmOnly, coldOnlyCorrupted)).toThrow();
  });
});

const EMPTY_EXCLUSIONS = { offseason: 0, surrogateAffected: 0, missingResult: 0, quarantined: 0 };

/** Minimal synthetic `ScoreSlice` fixture — every field `poolSlices` reads is explicit, everything else is a plausible filler. */
function scoreSlice(overrides: Partial<ScoreSlice>): ScoreSlice {
  return {
    algorithmId: "test-algo",
    season: 2024,
    headlineEligible: false,
    compLevelView: "combined",
    brierScore: 0.2,
    winnerAccuracy: 0.7,
    scoredCount: 10,
    tieCount: 0,
    noCallCount: 0,
    exclusionCounts: { ...EMPTY_EXCLUSIONS },
    candidateCount: 10,
    calibrationBins: [],
    ...overrides,
  };
}

describe("poolSlices — WR-01/WR-02: the pooling/reconstruction arithmetic behind the reconciliation gate", () => {
  it("a single slice is returned UNCHANGED (no multiply-then-divide round-trip) — covers the exact floating-point fragility WR-01 identified", () => {
    // 0.1 * 3 / 3 !== 0.1 in IEEE 754 double precision (a standard example of
    // the (x*n)/n round-trip not being bit-identical to x). If poolSlices
    // ever regresses to always doing the multiply-then-divide reconstruction
    // — even for a single slice — this assertion catches it, because the
    // round-tripped value would fail a strict `toBe` here.
    expect((0.1 * 3) / 3).not.toBe(0.1); // sanity-check the fragility actually exists in this JS runtime
    const slice = scoreSlice({ brierScore: 0.1, winnerAccuracy: 0.1, scoredCount: 3, candidateCount: 3 });
    const pooled = poolSlices([slice]);
    expect(pooled.brierScore).toBe(0.1);
    expect(pooled.winnerAccuracy).toBe(0.1);
    expect(pooled.scoredCount).toBe(3);
  });

  it("pooling 2+ slices reconstructs the weighted-mean identity", () => {
    const sliceA = scoreSlice({ brierScore: 0.2, winnerAccuracy: 0.75, scoredCount: 4, candidateCount: 4 });
    const sliceB = scoreSlice({ brierScore: 0.3, winnerAccuracy: 0.5, scoredCount: 6, candidateCount: 6 });
    const pooled = poolSlices([sliceA, sliceB]);
    // squaredErrorSum = 0.2*4 + 0.3*6 = 0.8 + 1.8 = 2.6; /10 = 0.26
    expect(pooled.brierScore).toBeCloseTo(0.26, 10);
    // accuracyCorrect = 0.75*4 + 0.5*6 = 3 + 3 = 6; /10 = 0.6
    expect(pooled.winnerAccuracy).toBeCloseTo(0.6, 10);
    expect(pooled.scoredCount).toBe(10);
  });

  it("a slice with brierScore: null contributes nothing to the pooled Brier score", () => {
    const scored = scoreSlice({ brierScore: 0.2, winnerAccuracy: 0.75, scoredCount: 4, candidateCount: 4 });
    const nullBrier = scoreSlice({
      brierScore: null,
      winnerAccuracy: 0.8,
      scoredCount: 5,
      candidateCount: 5,
    });
    const pooled = poolSlices([scored, nullBrier]);
    // squaredErrorSum only from `scored`: 0.2*4 = 0.8; scoredCount is still
    // the SUM of both slices' counts (9), so the null-brier slice's
    // population is counted but contributes zero to the numerator.
    expect(pooled.scoredCount).toBe(9);
    expect(pooled.brierScore).toBeCloseTo(0.8 / 9, 10);
  });

  it("a slice with winnerAccuracy: null is excluded from the accuracy denominator entirely", () => {
    const scored = scoreSlice({ brierScore: 0.2, winnerAccuracy: 0.75, scoredCount: 4, candidateCount: 4 });
    const nullAccuracy = scoreSlice({
      brierScore: 0.3,
      winnerAccuracy: null,
      scoredCount: 5,
      candidateCount: 5,
    });
    const pooled = poolSlices([scored, nullAccuracy]);
    // accuracyDenominator only includes `scored`'s denom (4), NOT nullAccuracy's
    // 5 — a null winnerAccuracy slice must not silently widen the denominator.
    expect(pooled.winnerAccuracy).toBeCloseTo(0.75, 10);
  });
});

describe("buildReconciliationEntry — T-03.2-18's own gate", () => {
  function artifactWithSlice(fields: {
    algorithmId: string;
    season: number;
    brierScore: number | null;
    winnerAccuracy: number | null;
    scoredCount: number;
  }) {
    return {
      provenance: { runTimestamp: "2026-01-01T00:00:00.000Z" },
      slices: [{ ...fields, compLevelView: "combined" }],
    };
  }

  it("matches: true for a synthetic identical-population case", () => {
    const unbucketed = { brierScore: 0.21, winnerAccuracy: 0.7, scoredCount: 100 };
    const artifact = artifactWithSlice({
      algorithmId: "opr",
      season: 2024,
      brierScore: 0.21,
      winnerAccuracy: 0.7,
      scoredCount: 100,
    });
    const entry = buildReconciliationEntry(2024, unbucketed, artifact as never, "opr");
    expect(entry.matches).toBe(true);
    expect(entry.season).toBe(2024);
  });

  it("matches: false for a synthetic population mismatch", () => {
    const unbucketed = { brierScore: 0.21, winnerAccuracy: 0.7, scoredCount: 100 };
    const artifact = artifactWithSlice({
      algorithmId: "opr",
      season: 2024,
      brierScore: 0.21,
      winnerAccuracy: 0.7,
      scoredCount: 99, // mismatched scoredCount
    });
    const entry = buildReconciliationEntry(2024, unbucketed, artifact as never, "opr");
    expect(entry.matches).toBe(false);
  });
});

/**
 * IN-03 (03.2-REVIEW.md): a truncated final line — the process-killed-
 * mid-write failure mode this file's own doc comment already reasons about
 * — must re-throw with the sidecar path and line number named, not surface
 * a bare `SyntaxError`. This diagnostic's reconciliation gate exists to
 * fail loudly on population mismatches; a silently-skipped partial record
 * would defeat that gate's purpose.
 */
describe("readSidecarRecordsForAlgorithm", () => {
  const tempDirs: string[] = [];
  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "sigmascout-eventscopediagnostic-test-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("re-throws with the sidecar path and line number when the final line is truncated JSON", async () => {
    const runDir = makeTempDir();
    const goodLine = JSON.stringify({
      matchKey: "2022test_qm1",
      algorithmId: "opr",
      eventKey: "2022test",
      compLevel: "qm",
      pRedWin: 0.6,
      predictedRedScore: 50,
      predictedBlueScore: 40,
      actualWinner: "red",
    });
    const truncatedLine = '{"matchKey":"2022test_qm2","algorithmId":"opr","pRedWin":0.4,"pred';
    const sidecarPath = join(runDir, "predictions-2022.jsonl");
    writeFileSync(sidecarPath, `${goodLine}\n${truncatedLine}`, "utf8");

    await expect(readSidecarRecordsForAlgorithm(sidecarPath, "opr")).rejects.toThrow(
      /predictions-2022\.jsonl:2/
    );
    await expect(readSidecarRecordsForAlgorithm(sidecarPath, "opr")).rejects.toThrow(
      /2022test_qm2/
    );
  });
});
