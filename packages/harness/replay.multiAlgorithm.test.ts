/**
 * D-22 regression: `WalkForwardSimulator.runAll` drives every supplied
 * algorithm over one shared chronological stream, visiting each match
 * exactly once and handing every algorithm the byte-identical
 * `toLeakProofUpcoming` object for that match. Uses `replay.test.ts`'s
 * `makeInstrumentedAlgorithm` pattern (a module pushing labelled strings
 * into one shared `log: string[]`) — but here ONE log is shared ACROSS
 * algorithms, which is the observable form of the shared-stream guarantee:
 * a per-algorithm log could not distinguish "one shared stream, driven in
 * an interleaved order" from "N independent replays that happen to visit
 * matches in the same order."
 */
import { describe, expect, it } from "vitest";
import type { AlgorithmModule, MatchResult, UpcomingMatch } from "../core/algorithms/types.js";
import { WalkForwardSimulator } from "./replay.js";

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

/** Pushes `predict:{algorithmId}:{matchKey}` / `update:{algorithmId}:{matchKey}` into ONE shared log across every algorithm built from this factory. */
function makeInstrumentedAlgorithm(id: string, sharedLog: string[]): AlgorithmModule<Record<string, never>> {
  return {
    id,
    version: "0.0.0",
    initState: () => ({}),
    predict: (_state, match) => {
      sharedLog.push(`predict:${id}:${match.matchKey}`);
      return { winner: "red", pRedWin: 0.5, redScore: 0, blueScore: 0 };
    },
    update: (state, result) => {
      sharedLog.push(`update:${id}:${result.matchKey}`);
      return state;
    },
    teamMetrics: () => ({}),
  };
}

describe("WalkForwardSimulator.runAll — D-22 shared-stream guarantee", () => {
  const matches: MatchResult[] = [
    makeMatch({ matchKey: "2024test_qm1", matchNumber: 1 }),
    makeMatch({ matchKey: "2024test_qm2", matchNumber: 2 }),
    makeMatch({ matchKey: "2024test_qm3", matchNumber: 3 }),
  ];

  it("produces one interleaved log across algorithms — match1/a, match1/b, match2/a, match2/b, ... — one visit per match", () => {
    const sharedLog: string[] = [];
    const algorithmA = makeInstrumentedAlgorithm("a", sharedLog);
    const algorithmB = makeInstrumentedAlgorithm("b", sharedLog);
    const simulator = new WalkForwardSimulator(matches);

    simulator.runAll([algorithmA, algorithmB], []);

    expect(sharedLog).toEqual([
      "predict:a:2024test_qm1",
      "update:a:2024test_qm1",
      "predict:b:2024test_qm1",
      "update:b:2024test_qm1",
      "predict:a:2024test_qm2",
      "update:a:2024test_qm2",
      "predict:b:2024test_qm2",
      "update:b:2024test_qm2",
      "predict:a:2024test_qm3",
      "update:a:2024test_qm3",
      "predict:b:2024test_qm3",
      "update:b:2024test_qm3",
    ]);
  });

  it("hands every algorithm the reference-identical leak-proof object for a given match", () => {
    const seenPerMatch = new Map<string, UpcomingMatch[]>();
    function recordingAlgorithm(id: string): AlgorithmModule<null> {
      return {
        id,
        version: "0.0.0",
        initState: () => null,
        predict: (_state, match) => {
          const existing = seenPerMatch.get(match.matchKey) ?? [];
          existing.push(match);
          seenPerMatch.set(match.matchKey, existing);
          return { winner: "red", pRedWin: 0.5, redScore: 0, blueScore: 0 };
        },
        update: (state) => state,
        teamMetrics: () => ({}),
      };
    }

    const simulator = new WalkForwardSimulator(matches);
    simulator.runAll([recordingAlgorithm("a"), recordingAlgorithm("b")], []);

    for (const match of matches) {
      const seen = seenPerMatch.get(match.matchKey);
      expect(seen).toBeDefined();
      expect(seen).toHaveLength(2);
      // Both algorithms received the exact same wrapped object instance for
      // this match — not two equal-but-distinct wrappers.
      expect(seen![0]).toBe(seen![1]);
    }
  });

  it("returns one MultiAlgorithmPredictionRecord per (match, algorithm), tagged with the correct algorithmId", () => {
    const sharedLog: string[] = [];
    const algorithmA = makeInstrumentedAlgorithm("a", sharedLog);
    const algorithmB = makeInstrumentedAlgorithm("b", sharedLog);
    const simulator = new WalkForwardSimulator(matches);

    const records = simulator.runAll([algorithmA, algorithmB], []);

    expect(records).toHaveLength(matches.length * 2);
    for (const match of matches) {
      const forMatch = records.filter((r) => r.match.matchKey === match.matchKey);
      expect(forMatch.map((r) => r.algorithmId).sort()).toEqual(["a", "b"]);
    }
  });

  it("throws when any algorithm's predict reads an outcome field, exactly as the single-algorithm run does", () => {
    const leakyAlgorithm: AlgorithmModule<null> = {
      id: "leaky-fake",
      version: "0.0.0",
      initState: () => null,
      predict: (_state, match) => {
        const winner = (match as unknown as MatchResult).winner as "red" | "blue";
        return { winner, pRedWin: 1, redScore: 0, blueScore: 0 };
      },
      update: (state) => state,
      teamMetrics: () => ({}),
    };

    const simulator = new WalkForwardSimulator(matches);
    expect(() => simulator.runAll([leakyAlgorithm], [])).toThrow(/Outcome leakage/);
  });

  it("D-28: onMatchComplete fires once per (match, algorithm), strictly after that algorithm's update for that match", () => {
    const sharedLog: string[] = [];
    const algorithmA = makeInstrumentedAlgorithm("a", sharedLog);
    const algorithmB = makeInstrumentedAlgorithm("b", sharedLog);
    const simulator = new WalkForwardSimulator(matches);
    const onMatchCompleteCalls: string[] = [];

    simulator.runAll([algorithmA, algorithmB], [], undefined, (match, algorithmId) => {
      onMatchCompleteCalls.push(`onMatchComplete:${algorithmId}:${match.matchKey}`);
      sharedLog.push(`onMatchComplete:${algorithmId}:${match.matchKey}`);
    });

    // Exactly one call per (match, algorithm) — matches.length * 2 algorithms.
    expect(onMatchCompleteCalls).toHaveLength(matches.length * 2);

    // In the shared log, every onMatchComplete entry for a given
    // (match, algorithm) pair appears immediately after that pair's own
    // "update" entry — never before, never interleaved with another
    // algorithm's update for the same match. This is what makes a snapshot
    // mean "state including this match" rather than "state before it."
    for (const match of matches) {
      for (const id of ["a", "b"]) {
        const updateIndex = sharedLog.indexOf(`update:${id}:${match.matchKey}`);
        const onCompleteIndex = sharedLog.indexOf(`onMatchComplete:${id}:${match.matchKey}`);
        expect(updateIndex).toBeGreaterThanOrEqual(0);
        expect(onCompleteIndex).toBe(updateIndex + 1);
      }
    }
  });
});
