/**
 * Task 2 regression coverage (D-28): the per-match, per-algorithm team
 * metric-history sidecar writer, plus an integration test proving the
 * snapshot happens INSIDE `WalkForwardSimulator.runAll`'s existing loop via
 * the `onMatchComplete` hook — no second replay pass.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AlgorithmModule, MatchResult, TeamMetrics } from "../core/algorithms/types.js";
import { WalkForwardSimulator } from "./replay.js";
import {
  closeMetricHistoryWriter,
  MetricHistoryRowSchema,
  openMetricHistoryWriter,
  writeMetricHistoryRows,
  type MetricHistoryRow,
} from "./metricHistory.js";

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sigmascout-metrichistory-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeRow(overrides: Partial<MetricHistoryRow> = {}): MetricHistoryRow {
  return {
    matchKey: "2024test_qm1",
    season: 2024,
    eventKey: "2024test",
    algorithmId: "opr",
    teamKey: "frc1",
    matchIndex: 0,
    metrics: { total: { value: 42 } },
    ...overrides,
  };
}

describe("openMetricHistoryWriter / writeMetricHistoryRows / closeMetricHistoryWriter", () => {
  it("writes the file to {outDir}/metrics-{season}.jsonl", () => {
    const outDir = makeTempDir();
    const handle = openMetricHistoryWriter(outDir, 2024);
    writeMetricHistoryRows(handle, [makeRow()]);
    closeMetricHistoryWriter(handle);
    expect(existsSync(join(outDir, "metrics-2024.jsonl"))).toBe(true);
  });

  it("serializes a row without spread with no `spread` key present, and a row with spread carries it", () => {
    const outDir = makeTempDir();
    const handle = openMetricHistoryWriter(outDir, 2024);
    writeMetricHistoryRows(handle, [
      makeRow({ teamKey: "frc1", metrics: { total: { value: 10 } } }),
      makeRow({ teamKey: "frc2", metrics: { total: { value: 10, spread: 3.2 } } }),
    ]);
    closeMetricHistoryWriter(handle);

    const lines = readFileSync(join(outDir, "metrics-2024.jsonl"), "utf8").trim().split("\n");
    expect(lines[0]!.includes('"spread"')).toBe(false);
    expect(lines[1]!.includes('"spread"')).toBe(true);
    const parsed = lines.map((l) => MetricHistoryRowSchema.parse(JSON.parse(l)));
    expect(parsed[1]!.metrics["total"]?.spread).toBe(3.2);
  });

  it("leaves a file whose every line parses when closed after a partial sequence", () => {
    const outDir = makeTempDir();
    const handle = openMetricHistoryWriter(outDir, 2024);
    writeMetricHistoryRows(handle, [makeRow({ teamKey: "frc1" }), makeRow({ teamKey: "frc2" })]);
    closeMetricHistoryWriter(handle);
    const lines = readFileSync(join(outDir, "metrics-2024.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(() => MetricHistoryRowSchema.parse(JSON.parse(line))).not.toThrow();
  });

  it("throws when a row contains the supplied secret, and the file does not contain it afterward", () => {
    const outDir = makeTempDir();
    const secret = "sk-test-fake-tba-api-key-should-never-appear";
    const handle = openMetricHistoryWriter(outDir, 2024, secret);
    expect(() => writeMetricHistoryRows(handle, [makeRow({ teamKey: secret })])).toThrow(/secret/);
    closeMetricHistoryWriter(handle);
    const written = readFileSync(join(outDir, "metrics-2024.jsonl"), "utf8");
    expect(written.includes(secret)).toBe(false);
  });

  it("round-trips: reading the file back, splitting on newlines, and re-validating each line independently", () => {
    const outDir = makeTempDir();
    const handle = openMetricHistoryWriter(outDir, 2024);
    const rows = [makeRow({ teamKey: "frc1" }), makeRow({ teamKey: "frc2", metrics: { total: { value: 5, spread: 1 } } })];
    writeMetricHistoryRows(handle, rows);
    closeMetricHistoryWriter(handle);

    const lines = readFileSync(join(outDir, "metrics-2024.jsonl"), "utf8").trim().split("\n");
    const roundTripped = lines.map((l) => MetricHistoryRowSchema.parse(JSON.parse(l)));
    expect(roundTripped).toEqual(rows);
  });
});

// --- Integration: the snapshot happens inside runAll's existing loop, via onMatchComplete ---

function makeMatch(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    matchKey: "2024test_qm1",
    eventKey: "2024test",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 1,
    redTeams: ["frc1", "frc2", "frc3"],
    blueTeams: ["frc4", "frc5", "frc6"],
    redSurrogates: [],
    blueSurrogates: [],
    redDqs: [],
    blueDqs: [],
    winner: "red",
    redScore: 100,
    blueScore: 80,
    redRpEarned: 2,
    blueRpEarned: 0,
    hasScoreBreakdown: true,
    scoreBreakdownRaw: '{"red":{}}',
    eventType: 0,
    ...overrides,
  };
}

/** A fake algorithm whose `teamMetrics` reports a deterministic value (and, for "sigma-like" ids, a spread) per team — enough to prove the snapshot pipeline without a real algorithm's math. */
function makeFakeAlgorithm(id: string, carriesVariance: boolean): AlgorithmModule<{ matchCount: number }> {
  return {
    id,
    version: "0.0.0",
    initState: () => ({ matchCount: 0 }),
    predict: () => ({ winner: "red", pRedWin: 0.5, redScore: 0, blueScore: 0 }),
    update: (state) => ({ matchCount: state.matchCount + 1 }),
    teamMetrics: (state, teams): TeamMetrics => {
      const requested = teams ?? [];
      const result: TeamMetrics = {};
      for (const team of requested) {
        result[team] = carriesVariance
          ? { total: { value: state.matchCount, spread: 1.5 } }
          : { total: { value: state.matchCount } };
      }
      return result;
    },
  };
}

describe("D-28 integration: onMatchComplete snapshot inside the existing replay loop", () => {
  const matches: MatchResult[] = [
    makeMatch({ matchKey: "2024test_qm1", matchNumber: 1 }),
    makeMatch({
      matchKey: "2024test_qm2",
      matchNumber: 2,
      // A surrogate is still snapshotted — it appeared in the match.
      redTeams: ["frc1", "frc2", "frc7"],
      redSurrogates: ["frc7"],
    }),
  ];

  it("a 3-algorithm, 2-match fixture produces 36 metric rows (6 teams x 2 matches x 3 algorithms)", () => {
    const outDir = makeTempDir();
    const handle = openMetricHistoryWriter(outDir, 2024);
    const matchIndexByKey = new Map(matches.map((m, i) => [m.matchKey, i]));

    const algorithms = [makeFakeAlgorithm("opr", false), makeFakeAlgorithm("epa", false), makeFakeAlgorithm("vpr", true)];
    const algorithmById = new Map(algorithms.map((a) => [a.id, a]));

    const simulator = new WalkForwardSimulator(matches);
    simulator.runAll(algorithms, [], undefined, (match, algorithmId, state) => {
      const algorithm = algorithmById.get(algorithmId)!;
      const involvedTeams = [...match.redTeams, ...match.blueTeams];
      const metrics = algorithm.teamMetrics(state as { matchCount: number }, involvedTeams);
      const rows: MetricHistoryRow[] = involvedTeams.map((teamKey) => ({
        matchKey: match.matchKey,
        season: 2024,
        eventKey: match.eventKey,
        algorithmId,
        teamKey,
        matchIndex: matchIndexByKey.get(match.matchKey)!,
        metrics: metrics[teamKey] ?? {},
      }));
      writeMetricHistoryRows(handle, rows);
    });
    closeMetricHistoryWriter(handle);

    const lines = readFileSync(join(outDir, "metrics-2024.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(36);
  });

  it("the snapshotted team set for a match equals exactly that match's red plus blue teams, including a surrogate", () => {
    const outDir = makeTempDir();
    const handle = openMetricHistoryWriter(outDir, 2024);
    const matchIndexByKey = new Map(matches.map((m, i) => [m.matchKey, i]));
    const algorithm = makeFakeAlgorithm("opr", false);

    const simulator = new WalkForwardSimulator(matches);
    simulator.runAll([algorithm], [], undefined, (match, algorithmId, state) => {
      const involvedTeams = [...match.redTeams, ...match.blueTeams];
      const metrics = algorithm.teamMetrics(state as { matchCount: number }, involvedTeams);
      const rows: MetricHistoryRow[] = involvedTeams.map((teamKey) => ({
        matchKey: match.matchKey,
        season: 2024,
        eventKey: match.eventKey,
        algorithmId,
        teamKey,
        matchIndex: matchIndexByKey.get(match.matchKey)!,
        metrics: metrics[teamKey] ?? {},
      }));
      writeMetricHistoryRows(handle, rows);
    });
    closeMetricHistoryWriter(handle);

    const rows = readFileSync(join(outDir, "metrics-2024.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => MetricHistoryRowSchema.parse(JSON.parse(l)));

    const match2Teams = rows.filter((r) => r.matchKey === "2024test_qm2").map((r) => r.teamKey);
    expect(match2Teams.sort()).toEqual(["frc1", "frc2", "frc4", "frc5", "frc6", "frc7"].sort());
  });

  it("a Sigma1 row's metrics each carry a spread and an OPR row's do not", () => {
    const outDir = makeTempDir();
    const handle = openMetricHistoryWriter(outDir, 2024);
    const matchIndexByKey = new Map(matches.map((m, i) => [m.matchKey, i]));
    const algorithms = [makeFakeAlgorithm("opr", false), makeFakeAlgorithm("vpr", true)];
    const algorithmById = new Map(algorithms.map((a) => [a.id, a]));

    const simulator = new WalkForwardSimulator(matches);
    simulator.runAll(algorithms, [], undefined, (match, algorithmId, state) => {
      const algorithm = algorithmById.get(algorithmId)!;
      const involvedTeams = [...match.redTeams, ...match.blueTeams];
      const metrics = algorithm.teamMetrics(state as { matchCount: number }, involvedTeams);
      const rows: MetricHistoryRow[] = involvedTeams.map((teamKey) => ({
        matchKey: match.matchKey,
        season: 2024,
        eventKey: match.eventKey,
        algorithmId,
        teamKey,
        matchIndex: matchIndexByKey.get(match.matchKey)!,
        metrics: metrics[teamKey] ?? {},
      }));
      writeMetricHistoryRows(handle, rows);
    });
    closeMetricHistoryWriter(handle);

    const rows = readFileSync(join(outDir, "metrics-2024.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => MetricHistoryRowSchema.parse(JSON.parse(l)));

    const oprRows = rows.filter((r) => r.algorithmId === "opr");
    const vprRows = rows.filter((r) => r.algorithmId === "vpr");
    expect(oprRows.length).toBeGreaterThan(0);
    expect(vprRows.length).toBeGreaterThan(0);
    for (const row of oprRows) expect(row.metrics["total"]?.spread).toBeUndefined();
    for (const row of vprRows) expect(row.metrics["total"]?.spread).toBe(1.5);
  });
});
