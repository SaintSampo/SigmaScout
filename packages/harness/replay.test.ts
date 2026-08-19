/**
 * Outcome-leakage and replay-ordering regression tests (EVAL-01, ROADMAP.md
 * Phase 1 success criterion 4). Uses a hand-built fixture list — no TBA
 * access, no corpus file — so this runs in milliseconds and can never be
 * broken by network conditions.
 */
import { describe, expect, it } from "vitest";
import type { AlgorithmModule, MatchResult } from "../core/algorithms/types.js";
import { toLeakProofUpcoming, WalkForwardSimulator } from "./replay.js";

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
    hasScoreBreakdown: true,
    scoreBreakdownRaw: '{"red":{}}',
    eventType: 0,
    ...overrides,
  };
}

/**
 * The exact set of outcome-bearing keys `toLeakProofUpcoming` must guard on
 * ALL THREE surfaces (`get`, `getOwnPropertyDescriptor`, `ownKeys`) — mirrors
 * `OUTCOME_KEYS` in replay.ts (not exported, so this is a deliberate
 * parallel list rather than a shared import; a drift here is itself a
 * regression the tests below would catch).
 */
const ALL_OUTCOME_KEYS = [
  "winner",
  "redScore",
  "blueScore",
  "redRpEarned",
  "blueRpEarned",
  "hasScoreBreakdown",
  "scoreBreakdownRaw",
] as const;

/** The exact set of non-outcome keys `UpcomingMatch` carries. */
const ALL_NON_OUTCOME_KEYS = [
  "matchKey",
  "eventKey",
  "compLevel",
  "setNumber",
  "matchNumber",
  "redTeams",
  "blueTeams",
  "redSurrogates",
  "blueSurrogates",
  "eventType",
] as const;

describe("toLeakProofUpcoming", () => {
  const match = makeMatch();
  const wrapped = toLeakProofUpcoming(match) as unknown as Record<string, unknown>;
  const raw = match as unknown as Record<string, unknown>;

  it.each(ALL_OUTCOME_KEYS)("throws when reading outcome field %s, naming the match key", (field) => {
    expect(() => wrapped[field]).toThrow(/Outcome leakage/);
    expect(() => wrapped[field]).toThrow(new RegExp(match.matchKey));
  });

  it.each(["matchKey", "compLevel", "redTeams", "blueTeams", "eventType"] as const)(
    "returns the real value for non-outcome field %s",
    (field) => {
      expect(wrapped[field]).toEqual(raw[field]);
    }
  );
});

describe("toLeakProofUpcoming — getOwnPropertyDescriptor bypass (EVAL-01/SC-4, T-Q2x6-01)", () => {
  const match = makeMatch();
  const wrapped = toLeakProofUpcoming(match) as unknown as object;

  it.each(ALL_OUTCOME_KEYS)("Object.getOwnPropertyDescriptor throws for outcome field %s, naming the match key", (field) => {
    expect(() => Object.getOwnPropertyDescriptor(wrapped, field)).toThrow(/Outcome leakage/);
    expect(() => Object.getOwnPropertyDescriptor(wrapped, field)).toThrow(new RegExp(match.matchKey));
  });

  it.each(ALL_OUTCOME_KEYS)("Reflect.getOwnPropertyDescriptor throws for outcome field %s, naming the match key", (field) => {
    expect(() => Reflect.getOwnPropertyDescriptor(wrapped, field)).toThrow(/Outcome leakage/);
    expect(() => Reflect.getOwnPropertyDescriptor(wrapped, field)).toThrow(new RegExp(match.matchKey));
  });
});

describe("toLeakProofUpcoming — ownKeys enumeration bypass (EVAL-01/SC-4, T-Q2x6-02)", () => {
  const match = makeMatch();
  const wrapped = toLeakProofUpcoming(match) as unknown as object;

  it("Reflect.ownKeys omits every outcome key and includes every non-outcome key", () => {
    const keys = Reflect.ownKeys(wrapped);
    for (const outcomeKey of ALL_OUTCOME_KEYS) {
      expect(keys).not.toContain(outcomeKey);
    }
    for (const nonOutcomeKey of ALL_NON_OUTCOME_KEYS) {
      expect(keys).toContain(nonOutcomeKey);
    }
  });

  it("Object.keys omits every outcome key and includes every non-outcome key", () => {
    const keys = Object.keys(wrapped);
    for (const outcomeKey of ALL_OUTCOME_KEYS) {
      expect(keys).not.toContain(outcomeKey);
    }
    for (const nonOutcomeKey of ALL_NON_OUTCOME_KEYS) {
      expect(keys).toContain(nonOutcomeKey);
    }
  });

  it("Object.getOwnPropertyNames omits every outcome key and includes every non-outcome key", () => {
    const keys = Object.getOwnPropertyNames(wrapped);
    for (const outcomeKey of ALL_OUTCOME_KEYS) {
      expect(keys).not.toContain(outcomeKey);
    }
    for (const nonOutcomeKey of ALL_NON_OUTCOME_KEYS) {
      expect(keys).toContain(nonOutcomeKey);
    }
  });
});

describe("eventType — non-outcome-bearing (plan 03-03 Task 1)", () => {
  it("a predict() call can read match.eventType through toLeakProofUpcoming without throwing", () => {
    const match = makeMatch({ eventType: 3 });
    let observedEventType: number | undefined;
    const algorithm: AlgorithmModule<null> = {
      id: "eventtype-reader-fake",
      version: "0.0.0",
      initState: () => null,
      predict: (_state, upcoming) => {
        observedEventType = upcoming.eventType;
        return { winner: "red", pRedWin: 0.5, redScore: 0, blueScore: 0 };
      },
      update: (state) => state,
      teamMetrics: () => ({}),
    };

    const simulator = new WalkForwardSimulator([match]);
    expect(() => simulator.run(algorithm, [])).not.toThrow();
    expect(observedEventType).toBe(3);
  });
});

describe("WalkForwardSimulator", () => {
  const matches: MatchResult[] = [
    makeMatch({ matchKey: "2024test_qm1", matchNumber: 1, winner: "red", redScore: 100, blueScore: 80 }),
    makeMatch({ matchKey: "2024test_qm2", matchNumber: 2, winner: "blue", redScore: 60, blueScore: 90 }),
    makeMatch({ matchKey: "2024test_qm3", matchNumber: 3, winner: "red", redScore: 110, blueScore: 70 }),
  ];

  function makeInstrumentedAlgorithm(): { algorithm: AlgorithmModule<{ log: string[] }>; log: string[] } {
    const log: string[] = [];
    const algorithm: AlgorithmModule<{ log: string[] }> = {
      id: "instrumented-fake",
      version: "0.0.0",
      initState: () => ({ log }),
      predict: (state, match) => {
        state.log.push(`predict:${match.matchKey}`);
        return { winner: "red", pRedWin: 0.5, redScore: 0, blueScore: 0 };
      },
      update: (state, result) => {
        state.log.push(`update:${result.matchKey}`);
        return state;
      },
      teamMetrics: () => ({}),
    };
    return { algorithm, log };
  }

  it("calls predict then update for every match, alternating with no update preceding its own match's predict", () => {
    const { algorithm, log } = makeInstrumentedAlgorithm();
    const simulator = new WalkForwardSimulator(matches);
    simulator.run(algorithm, []);

    expect(log).toEqual([
      "predict:2024test_qm1",
      "update:2024test_qm1",
      "predict:2024test_qm2",
      "update:2024test_qm2",
      "predict:2024test_qm3",
      "update:2024test_qm3",
    ]);
  });

  it("throws when an algorithm's predict reads an outcome field, rather than silently producing an informed prediction", () => {
    const leakyAlgorithm: AlgorithmModule<null> = {
      id: "leaky-fake",
      version: "0.0.0",
      initState: () => null,
      predict: (_state, match) => {
        // Reach for an outcome field via a cast — the Proxy still guards the
        // underlying object regardless of the static type at the call site.
        // This line always throws before returning; the cast to "red"|"blue"
        // only satisfies Prediction's return type for the unreachable path.
        const winner = (match as unknown as MatchResult).winner as "red" | "blue";
        return { winner, pRedWin: 1, redScore: 0, blueScore: 0 };
      },
      update: (state) => state,
      teamMetrics: () => ({}),
    };

    const simulator = new WalkForwardSimulator(matches);
    expect(() => simulator.run(leakyAlgorithm, [])).toThrow(/Outcome leakage/);
  });

  it("returns predictions in exactly the supplied order, deterministically across repeated runs", () => {
    const { algorithm: algorithmA } = makeInstrumentedAlgorithm();
    const { algorithm: algorithmB } = makeInstrumentedAlgorithm();
    const simulator = new WalkForwardSimulator(matches);

    const runA = simulator.run(algorithmA, []).map((r) => r.match.matchKey);
    const runB = simulator.run(algorithmB, []).map((r) => r.match.matchKey);

    expect(runA).toEqual(["2024test_qm1", "2024test_qm2", "2024test_qm3"]);
    expect(runB).toEqual(runA);
  });
});
