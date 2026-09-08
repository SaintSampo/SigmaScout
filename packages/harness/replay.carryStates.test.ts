/**
 * Quick task 260908-615: `WalkForwardSimulator.runAll`'s `carryStates` — the
 * season-boundary carry instant, selected per algorithm by the new optional
 * `AlgorithmModule.carryFrom` field.
 *
 * These tests assert the MECHANISM with tiny fake algorithm modules (states
 * are fresh objects per update, so reference identity is meaningful), not
 * EPA's arithmetic. The final two tests read the REAL `epa` and `opr`
 * exports and pin which of them declares the last-official carry instant —
 * that pair is what stops a future refactor from silently opting OPR (or,
 * by the same pattern, VPR) into the rewound instant.
 */
import { describe, expect, it } from "vitest";
import type { AlgorithmModule, MatchResult } from "../core/algorithms/types.js";
import { epa } from "../core/algorithms/epa.js";
import { opr } from "../core/algorithms/opr.js";
import {
  OFFSEASON_EVENT_TYPE,
  PRESEASON_EVENT_TYPE,
} from "../core/algorithms/eventTypes.js";
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

interface SeenState {
  /** Match keys folded so far — a fresh object per update, so `toBe` distinguishes snapshots. */
  readonly seen: readonly string[];
}

/**
 * A fake module whose state records every match key it has folded. Each
 * `update` returns a NEW object, so two different as-of instants are two
 * different references — exactly what `carryStates` vs `finalStates`
 * assertions need.
 */
function makeTrackingAlgorithm(
  id: string,
  carryFrom?: "season-final" | "last-official-match"
): AlgorithmModule<SeenState> {
  return {
    id,
    version: "0.0.0",
    ...(carryFrom === undefined ? {} : { carryFrom }),
    initState: () => ({ seen: [] }),
    predict: () => ({ winner: "red", pRedWin: 0.5, redScore: 0, blueScore: 0 }),
    update: (state, result) => ({ seen: [...state.seen, result.matchKey] }),
    teamMetrics: () => ({}),
  };
}

describe("WalkForwardSimulator.runAll — carryStates (quick task 260908-615)", () => {
  it("declaring algorithm carries the post-last-official state; non-declaring algorithm carries its final state, reference-identical", () => {
    const matches = [
      makeMatch({ matchKey: "2024off_qm1", eventKey: "2024off", eventType: 0 }),
      makeMatch({ matchKey: "2024off_qm2", eventKey: "2024off", eventType: 0 }),
      makeMatch({
        matchKey: "2024ex_qm1",
        eventKey: "2024ex",
        eventType: OFFSEASON_EVENT_TYPE,
      }),
    ];
    const declaring = makeTrackingAlgorithm("declaring", "last-official-match");
    const plain = makeTrackingAlgorithm("plain");
    const simulator = new WalkForwardSimulator(matches);

    const records = simulator.runAll([declaring, plain], []);

    // Declaring: carry instant is the state after the LAST official match
    // (2024off_qm2), not the final state that also folded the offseason match.
    expect(records.carryStates.get("declaring")).toEqual({
      seen: ["2024off_qm1", "2024off_qm2"],
    });
    expect(records.finalStates.get("declaring")).toEqual({
      seen: ["2024off_qm1", "2024off_qm2", "2024ex_qm1"],
    });

    // Non-declaring: carry entry is reference-identical to the final entry.
    expect(records.carryStates.get("plain")).toBe(records.finalStates.get("plain"));
    expect(records.finalStates.get("plain")).toEqual({
      seen: ["2024off_qm1", "2024off_qm2", "2024ex_qm1"],
    });
  });

  it("all-official stream: carryStates and finalStates are reference-identical per algorithm, including the declaring one", () => {
    const matches = [
      makeMatch({ matchKey: "2024test_qm1", eventType: 0 }),
      makeMatch({ matchKey: "2024test_qm2", eventType: 3 }),
    ];
    const declaring = makeTrackingAlgorithm("declaring", "last-official-match");
    const plain = makeTrackingAlgorithm("plain");
    const simulator = new WalkForwardSimulator(matches);

    const records = simulator.runAll([declaring, plain], []);

    for (const id of ["declaring", "plain"]) {
      expect(records.carryStates.get(id)).toBe(records.finalStates.get(id));
    }
  });

  it("official, then unofficial, then official: the LAST official match wins, regardless of what sits between", () => {
    const matches = [
      makeMatch({ matchKey: "2024a_qm1", eventKey: "2024a", eventType: 0 }),
      makeMatch({
        matchKey: "2024ex_qm1",
        eventKey: "2024ex",
        eventType: OFFSEASON_EVENT_TYPE,
      }),
      makeMatch({ matchKey: "2024b_qm1", eventKey: "2024b", eventType: 1 }),
    ];
    const declaring = makeTrackingAlgorithm("declaring", "last-official-match");
    const simulator = new WalkForwardSimulator(matches);

    const records = simulator.runAll([declaring], []);

    // The snapshot is the state AFTER the third match — which, because the
    // running state already folded the mid-stream offseason match, includes
    // all three keys. Last official wins; nothing rewinds past it.
    expect(records.carryStates.get("declaring")).toEqual({
      seen: ["2024a_qm1", "2024ex_qm1", "2024b_qm1"],
    });
    expect(records.carryStates.get("declaring")).toBe(records.finalStates.get("declaring"));
  });

  it("zero official matches: the declaring algorithm falls back to its final state — never undefined", () => {
    const matches = [
      makeMatch({
        matchKey: "2024ex_qm1",
        eventKey: "2024ex",
        eventType: OFFSEASON_EVENT_TYPE,
      }),
      makeMatch({
        matchKey: "2024wk0_qm1",
        eventKey: "2024wk0",
        eventType: PRESEASON_EVENT_TYPE,
      }),
    ];
    const declaring = makeTrackingAlgorithm("declaring", "last-official-match");
    const simulator = new WalkForwardSimulator(matches);

    const records = simulator.runAll([declaring], []);

    expect(records.carryStates.get("declaring")).toBeDefined();
    expect(records.carryStates.get("declaring")).toBe(records.finalStates.get("declaring"));
    expect(records.carryStates.get("declaring")).toEqual({
      seen: ["2024ex_qm1", "2024wk0_qm1"],
    });
  });

  it("a preseason Week-0 (type 100) match — NOT flagged offseason by the corpus — does not become the carry instant", () => {
    const matches = [
      makeMatch({ matchKey: "2024a_qm1", eventKey: "2024a", eventType: 0 }),
      makeMatch({
        matchKey: "2024wk0_qm1",
        eventKey: "2024wk0",
        eventType: PRESEASON_EVENT_TYPE,
      }),
    ];
    const declaring = makeTrackingAlgorithm("declaring", "last-official-match");
    const simulator = new WalkForwardSimulator(matches);

    const records = simulator.runAll([declaring], []);

    expect(records.carryStates.get("declaring")).toEqual({ seen: ["2024a_qm1"] });
  });

  it("the -1 detail-fetch-failed sentinel counts as official, matching the shared predicate's degradation direction", () => {
    const matches = [
      makeMatch({ matchKey: "2024a_qm1", eventKey: "2024a", eventType: 0 }),
      makeMatch({ matchKey: "2024x_qm1", eventKey: "2024x", eventType: -1 }),
    ];
    const declaring = makeTrackingAlgorithm("declaring", "last-official-match");
    const simulator = new WalkForwardSimulator(matches);

    const records = simulator.runAll([declaring], []);

    expect(records.carryStates.get("declaring")).toEqual({
      seen: ["2024a_qm1", "2024x_qm1"],
    });
  });

  it("the real epa module declares the last-official carry instant", () => {
    expect(epa.carryFrom).toBe("last-official-match");
  });

  it("the real opr module declares no carry instant — season-final, as before", () => {
    expect(opr.carryFrom).toBeUndefined();
  });
});
