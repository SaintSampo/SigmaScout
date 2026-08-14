/**
 * Task 1 regression coverage (D-23/D-24/D-25): the JSONL prediction sidecar
 * writer. Every behavior bullet in 02-05-PLAN.md's Task 1 gets its own
 * assertion here, including a round-trip that reads the file back and
 * re-validates each line independently of the writer that produced it.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  closePredictionsWriter,
  openPredictionsWriter,
  PREDICTIONS_SCHEMA_VERSION,
  PredictionRecordSchema,
  writePredictionLine,
  type PersistedPredictionRecord,
} from "./predictions.js";

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sigmascout-predictions-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeRecord(overrides: Partial<PersistedPredictionRecord> = {}): PersistedPredictionRecord {
  return {
    matchKey: "2024test_qm1",
    season: 2024,
    eventKey: "2024test",
    compLevel: "qm",
    algorithmId: "opr",
    algorithmVersion: "2.0.0",
    predictedWinner: "red",
    pRedWin: 0.62,
    predictedRedScore: 55,
    predictedBlueScore: 45,
    redComponents: {},
    blueComponents: {},
    actualWinner: "red",
    actualRedScore: 60,
    actualBlueScore: 40,
    ...overrides,
  };
}

describe("PREDICTIONS_SCHEMA_VERSION", () => {
  it("is 1", () => {
    expect(PREDICTIONS_SCHEMA_VERSION).toBe(1);
  });
});

describe("openPredictionsWriter / writePredictionLine / closePredictionsWriter", () => {
  it("writes the file to {outDir}/predictions-{season}.jsonl", () => {
    const outDir = makeTempDir();
    const handle = openPredictionsWriter(outDir, 2024);
    writePredictionLine(handle, makeRecord());
    closePredictionsWriter(handle);
    expect(existsSync(join(outDir, "predictions-2024.jsonl"))).toBe(true);
  });

  it("writes 10 records for 2 algorithms over 5 matches: 10 lines, each parsing/validating, contiguous per match", () => {
    const outDir = makeTempDir();
    const handle = openPredictionsWriter(outDir, 2024);
    const matchKeys = ["m1", "m2", "m3", "m4", "m5"].map((n) => `2024test_qm_${n}`);
    for (const matchKey of matchKeys) {
      for (const algorithmId of ["opr", "epa"]) {
        writePredictionLine(handle, makeRecord({ matchKey, algorithmId }));
      }
    }
    closePredictionsWriter(handle);

    const lines = readFileSync(join(outDir, "predictions-2024.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(10);

    const parsed = lines.map((line) => PredictionRecordSchema.parse(JSON.parse(line)));
    for (let i = 0; i < matchKeys.length; i++) {
      const pair = parsed.slice(i * 2, i * 2 + 2);
      expect(pair.map((r) => r.matchKey)).toEqual([matchKeys[i], matchKeys[i]]);
      expect(pair.map((r) => r.algorithmId)).toEqual(["opr", "epa"]);
    }
  });

  it("serializes a record for an algorithm without variance with no `variance` key present (raw line text)", () => {
    const outDir = makeTempDir();
    const handle = openPredictionsWriter(outDir, 2024);
    writePredictionLine(handle, makeRecord({ algorithmId: "opr" }));
    closePredictionsWriter(handle);

    const line = readFileSync(join(outDir, "predictions-2024.jsonl"), "utf8").trim();
    expect(line.includes('"variance"')).toBe(false);
  });

  it("serializes a Sigma1 record's alliance-total and per-component variance when present", () => {
    const outDir = makeTempDir();
    const handle = openPredictionsWriter(outDir, 2024);
    writePredictionLine(
      handle,
      makeRecord({
        algorithmId: "sigma1",
        variance: 42.5,
        redComponents: { autoAmpNote: { mean: 3, variance: 1.2 } },
        blueComponents: { autoAmpNote: { mean: 2, variance: 0.8 } },
      })
    );
    closePredictionsWriter(handle);

    const line = readFileSync(join(outDir, "predictions-2024.jsonl"), "utf8").trim();
    const parsed = PredictionRecordSchema.parse(JSON.parse(line));
    expect(parsed.variance).toBe(42.5);
    expect(parsed.redComponents["autoAmpNote"]?.variance).toBe(1.2);
    expect(parsed.blueComponents["autoAmpNote"]?.variance).toBe(0.8);
  });

  it("leaves a file whose every line parses when the writer is closed after a partial sequence (D-25 interrupted-run property)", () => {
    const outDir = makeTempDir();
    const handle = openPredictionsWriter(outDir, 2024);
    for (let i = 0; i < 5; i++) {
      writePredictionLine(handle, makeRecord({ matchKey: `2024test_qm_${i}` }));
    }
    // Simulate an interruption: never write the remaining 5 of an intended 10.
    closePredictionsWriter(handle);

    const lines = readFileSync(join(outDir, "predictions-2024.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      expect(() => PredictionRecordSchema.parse(JSON.parse(line))).not.toThrow();
    }
  });

  it("throws when a record contains the supplied secret, and the file does not contain the secret afterward", () => {
    const outDir = makeTempDir();
    const secret = "sk-test-fake-tba-api-key-should-never-appear";
    const handle = openPredictionsWriter(outDir, 2024, secret);
    writePredictionLine(handle, makeRecord({ matchKey: "clean-record" }));
    expect(() => writePredictionLine(handle, makeRecord({ matchKey: secret }))).toThrow(/secret/);
    closePredictionsWriter(handle);

    const written = readFileSync(join(outDir, "predictions-2024.jsonl"), "utf8");
    expect(written.includes(secret)).toBe(false);
    expect(written.includes("clean-record")).toBe(true);
  });

  it("round-trips: reading the file back, splitting on newlines, and re-validating each line independently", () => {
    const outDir = makeTempDir();
    const handle = openPredictionsWriter(outDir, 2024);
    const records = [
      makeRecord({ matchKey: "2024test_qm1", algorithmId: "opr" }),
      makeRecord({ matchKey: "2024test_qm1", algorithmId: "sigma1", variance: 12 }),
    ];
    for (const record of records) writePredictionLine(handle, record);
    closePredictionsWriter(handle);

    const lines = readFileSync(join(outDir, "predictions-2024.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(records.length);
    const roundTripped = lines.map((line) => PredictionRecordSchema.parse(JSON.parse(line)));
    expect(roundTripped).toEqual(records);
  });

  it("fails schema validation for a malformed record and writes nothing for it", () => {
    const outDir = makeTempDir();
    const handle = openPredictionsWriter(outDir, 2024);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const broken = { ...makeRecord() } as any;
    delete broken.matchKey;
    expect(() => writePredictionLine(handle, broken)).toThrow();
    closePredictionsWriter(handle);
    expect(existsSync(join(outDir, "predictions-2024.jsonl"))).toBe(true);
    expect(readFileSync(join(outDir, "predictions-2024.jsonl"), "utf8")).toBe("");
  });
});
