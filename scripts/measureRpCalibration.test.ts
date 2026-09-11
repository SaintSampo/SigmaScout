/**
 * Unit tests for `measureRpCalibration.ts`'s pure helpers — the isEntryPoint
 * guard (same idiom as `measureEpaDeviations.ts`) lets this file import
 * `buildRpCalibrationRecord`/`RP_RELIABILITY_BUCKET_EDGES` without the script
 * trying to open a corpus.
 *
 * What is tested here is everything that could be silently wrong in a way no
 * console output would reveal:
 *
 *   - a bonus with zero observations must be OMITTED from `bonuses`, never
 *     emitted with a `NaN` figure (T-09-04) — a `NaN` would format as a dash
 *     downstream and read identically to "no data";
 *   - `bonuses` must stay in the CALLER's bonusNames order, never re-sorted —
 *     a silent alphabetisation would desynchronize this record from the
 *     season module's own order the rest of the site uses;
 *   - the same-scorer fix (D-11) must be structurally true: exactly one
 *     `SigmaScoutLayer` construction in the file, with the algorithm id as
 *     its second argument, and no direct call to `rpPmfForMatch`/
 *     `RpMomentsAccumulator` outside a comment.
 *
 * Task 2 Step 5 (2026-09-11): `buildRpCalibrationRecord`'s wire record no
 * longer carries `reliabilityBins` — dropped after real measured bytes
 * showed attaching it pushed `compare-2016.json` over the committed compare
 * budget with nothing on the Compare page ever reading it.
 * `RP_RELIABILITY_BUCKET_EDGES` stays exported and tested below because
 * `reliabilityTable` (the CONSOLE report) still uses it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AlgorithmModule, MatchResult } from "../packages/core/algorithms/types.js";
import { WalkForwardSimulator } from "../packages/harness/replay.js";
import { RP_RULE_MODULES } from "../packages/core/rankingPoints/rules.js";
import { buildRpCalibrationRecord, RP_RELIABILITY_BUCKET_EDGES, type Observation } from "./measureRpCalibration.js";

const SOURCE = readFileSync(new URL("./measureRpCalibration.ts", import.meta.url), "utf8");

/** Minimal chronologically-ordered synthetic match, same shape convention as `replay.test.ts`'s own `makeMatch`. */
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
    winner: "red",
    redScore: 100,
    blueScore: 80,
    redRpEarned: 2,
    blueRpEarned: 0,
    redDqs: [],
    blueDqs: [],
    hasScoreBreakdown: true,
    scoreBreakdownRaw: '{"red":{}}',
    eventType: 0,
    week: null,
    ...overrides,
  };
}

/** A trivial algorithm module — deterministic, no real prediction logic — just enough to satisfy `AlgorithmModule<S>`. */
function makeAlgorithm(id: string): AlgorithmModule<number> {
  return {
    id,
    version: "1.0.0+test",
    initState: () => 0,
    predict: (state) => ({ winner: "red", pRedWin: 0.5, redScore: 50 + state, blueScore: 50 }),
    update: (state) => state + 1,
    teamMetrics: () => ({}),
  };
}

describe("RP_RELIABILITY_BUCKET_EDGES", () => {
  it("is the seven-bucket edge set the console reliability table and the wire emitter both share", () => {
    expect(RP_RELIABILITY_BUCKET_EDGES).toEqual([0, 0.05, 0.2, 0.4, 0.6, 0.8, 0.95, 1.0000001]);
  });
});

describe("buildRpCalibrationRecord", () => {
  it("omits a bonus with zero observations rather than emitting NaN figures (T-09-04)", () => {
    const record = buildRpCalibrationRecord(
      ["energized", "supercharged", "traversal"],
      [
        [{ predicted: 0.5, actual: true }],
        [],
        [{ predicted: 0.1, actual: false }],
      ]
    );
    expect(record.bonuses.map((b) => b.name)).toEqual(["energized", "traversal"]);
    expect(record.bonuses.some((b) => Number.isNaN(b.meanPredicted))).toBe(false);
  });

  it("keeps bonuses in the CALLER's bonusNames order, never re-sorted or alphabetised", () => {
    const record = buildRpCalibrationRecord(
      ["zeta", "alpha", "mu"],
      [
        [{ predicted: 0.5, actual: true }],
        [{ predicted: 0.5, actual: true }],
        [{ predicted: 0.5, actual: true }],
      ]
    );
    expect(record.bonuses.map((b) => b.name)).toEqual(["zeta", "alpha", "mu"]);
  });

  it("scoredCount is the total pooled (alliance, bonus) observation count across every bonus, including the omitted one", () => {
    const record = buildRpCalibrationRecord(
      ["a", "b"],
      [
        [{ predicted: 0.5, actual: true }, { predicted: 0.5, actual: false }],
        [{ predicted: 0.2, actual: false }],
      ]
    );
    expect(record.scoredCount).toBe(3);
  });

  it("meanPredicted/observedFrequency/brierScore are computed with the SAME arithmetic the console report uses — hand-computed expected values", () => {
    const observations: readonly Observation[] = [
      { predicted: 0.0, actual: false },
      { predicted: 0.5, actual: true },
      { predicted: 1.0, actual: true },
      { predicted: 1.0, actual: false },
    ];
    const record = buildRpCalibrationRecord(["only"], [observations]);
    const bonus = record.bonuses[0]!;
    // meanPredicted = (0 + 0.5 + 1 + 1) / 4 = 0.625
    expect(bonus.meanPredicted).toBeCloseTo(0.625, 10);
    // observedFrequency = 2/4 true = 0.5
    expect(bonus.observedFrequency).toBeCloseTo(0.5, 10);
    // brier = mean((predicted - actual)^2) = ((0-0)^2 + (0.5-1)^2 + (1-1)^2 + (1-0)^2) / 4
    //       = (0 + 0.25 + 0 + 1) / 4 = 0.3125
    expect(bonus.brierScore).toBeCloseTo(0.3125, 10);
    expect(bonus.count).toBe(4);
  });

  it("carries no reliabilityBins key at all — dropped per Task 2 Step 5's measured byte-budget remedy", () => {
    const record = buildRpCalibrationRecord(["a"], [[{ predicted: 0.5, actual: true }]]);
    expect("reliabilityBins" in record).toBe(false);
  });

  it("a fully empty input produces zero bonuses and scoredCount 0 — never a thrown error", () => {
    const record = buildRpCalibrationRecord(["a", "b"], [[], []]);
    expect(record.scoredCount).toBe(0);
    expect(record.bonuses).toEqual([]);
  });
});

describe("2021 has no registered RP rule module (guards the premise the season filter relies on)", () => {
  it("RP_RULE_MODULES[2021] is undefined — the at-home season with no ranking-point rules to measure", () => {
    expect(RP_RULE_MODULES[2021]).toBeUndefined();
  });
});

describe("widened emitter (Task 2, D-09) — one runAll, disjoint per-algorithm record sets", () => {
  it("runAll over two algorithm modules and a chronological match list folds each returned record into ITS OWN algorithm, disjoint and in chronological order", () => {
    const matches: MatchResult[] = [
      makeMatch({ matchKey: "2024test_qm1", matchNumber: 1 }),
      makeMatch({ matchKey: "2024test_qm2", matchNumber: 2 }),
      makeMatch({ matchKey: "2024test_qm3", matchNumber: 3 }),
    ];
    const algoA = makeAlgorithm("algoA");
    const algoB = makeAlgorithm("algoB");
    const teams = ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"];

    // Exactly ONE runAll for both algorithms sharing one chronological
    // stream — the shape this task's widened emitter relies on to cost one
    // replay instead of one per algorithm.
    const records = new WalkForwardSimulator(matches).runAll([algoA, algoB], teams);

    const forA = records.filter((r) => r.algorithmId === "algoA");
    const forB = records.filter((r) => r.algorithmId === "algoB");

    // Disjoint: every record belongs to exactly one algorithm.
    expect(forA.length + forB.length).toBe(records.length);
    expect(forA.every((r) => r.algorithmId !== "algoB")).toBe(true);
    expect(forB.every((r) => r.algorithmId !== "algoA")).toBe(true);

    // Chronologically ordered per algorithm — each algorithm's own subsequence
    // preserves the match stream's original order.
    expect(forA.map((r) => r.match.matchKey)).toEqual(["2024test_qm1", "2024test_qm2", "2024test_qm3"]);
    expect(forB.map((r) => r.match.matchKey)).toEqual(["2024test_qm1", "2024test_qm2", "2024test_qm3"]);
  });
});

describe("same-scorer structural assertions (D-11)", () => {
  it("constructs SigmaScoutLayer exactly once, with a resolved algorithm id as the second argument", () => {
    const matches = [...SOURCE.matchAll(/new SigmaScoutLayer\(/g)];
    expect(matches).toHaveLength(1);
    expect(SOURCE).toMatch(/new SigmaScoutLayer\(ruleModule, \w+\.id\)/);
  });

  it("reaches RP only through SigmaScoutLayer.foldPlayed — no direct rpPmfForMatch/RpMomentsAccumulator call outside a comment", () => {
    const codeOnly = SOURCE.split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    expect((codeOnly.match(/rpPmfForMatch|RpMomentsAccumulator/g) ?? []).length).toBe(0);
  });
});
