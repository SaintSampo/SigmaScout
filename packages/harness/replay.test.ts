/**
 * Outcome-leakage and replay-ordering regression tests (EVAL-01, ROADMAP.md
 * Phase 1 success criterion 4). Uses a hand-built fixture list — no TBA
 * access, no corpus file — so this runs in milliseconds and can never be
 * broken by network conditions.
 */
import { describe, expect, it } from "vitest";
import type { AlgorithmModule, MatchResult } from "../core/algorithms/types.js";
import { toLeakProofUpcoming, WalkForwardSimulator } from "./replay.js";
import { NO_COLD_START_INDEX } from "../core/scoring/coldStart.js";

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
  "redDqs",
  "blueDqs",
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

describe("toLeakProofUpcoming — derived enumeration paths and D-B invariant boundary (T-Q2x6-02/03)", () => {
  const match = makeMatch();
  const wrapped = toLeakProofUpcoming(match) as unknown as Record<string, unknown>;
  const raw = match as unknown as Record<string, unknown>;

  it("Object.getOwnPropertyDescriptors does not throw and its key set is exactly the 10 non-outcome keys", () => {
    let descriptors: PropertyDescriptorMap | undefined;
    expect(() => {
      descriptors = Object.getOwnPropertyDescriptors(wrapped);
    }).not.toThrow();
    expect(Object.keys(descriptors!).sort()).toEqual([...ALL_NON_OUTCOME_KEYS].sort());
    for (const outcomeKey of ALL_OUTCOME_KEYS) {
      expect(descriptors).not.toHaveProperty(outcomeKey);
    }
  });

  it("Object.values, Object.entries, spread, and JSON.stringify each complete WITHOUT throwing (D-D) and carry only the 10 non-outcome fields with their real values", () => {
    let spread: Record<string, unknown> | undefined;
    expect(() => {
      spread = { ...wrapped };
    }).not.toThrow();
    expect(Object.keys(spread!).sort()).toEqual([...ALL_NON_OUTCOME_KEYS].sort());
    for (const key of ALL_NON_OUTCOME_KEYS) {
      expect(spread![key]).toEqual(raw[key]);
    }

    let entries: [string, unknown][] | undefined;
    expect(() => {
      entries = Object.entries(wrapped);
    }).not.toThrow();
    expect(
      entries!.map(([k]) => k).sort()
    ).toEqual([...ALL_NON_OUTCOME_KEYS].sort());
    for (const [key, value] of entries!) {
      expect(value).toEqual(raw[key]);
    }

    let values: unknown[] | undefined;
    expect(() => {
      values = Object.values(wrapped);
    }).not.toThrow();
    expect(values!.length).toBe(ALL_NON_OUTCOME_KEYS.length);

    let json: string | undefined;
    expect(() => {
      json = JSON.stringify(wrapped);
    }).not.toThrow();
    const parsed = JSON.parse(json!) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([...ALL_NON_OUTCOME_KEYS].sort());
  });

  it("for...in visits exactly the 10 non-outcome keys", () => {
    const seen: string[] = [];
    for (const key in wrapped) {
      seen.push(key);
    }
    expect(seen.sort()).toEqual([...ALL_NON_OUTCOME_KEYS].sort());
  });

  it("D-B precondition: the raw fixture is extensible and every outcome key is configurable — the two facts that make omitting keys from ownKeys legal", () => {
    expect(Object.isExtensible(match)).toBe(true);
    for (const outcomeKey of ALL_OUTCOME_KEYS) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, outcomeKey);
      expect(descriptor?.configurable).toBe(true);
    }
  });

  it("D-B hazard: wrapping an Object.freeze-d MatchResult and calling Object.keys throws an engine-level TypeError, not our Outcome-leakage Error — MatchResult objects must stay extensible plain literals (see this plan's D-B)", () => {
    const frozenMatch = Object.freeze(makeMatch());
    const frozenWrapped = toLeakProofUpcoming(frozenMatch) as unknown as object;

    let thrown: unknown;
    try {
      Object.keys(frozenWrapped);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as Error).message).not.toMatch(/Outcome leakage/);
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

/**
 * D-01 (quick task 260909-t5q): `WalkForwardSimulator`'s own cold-start
 * seam. Uses a stub algorithm that returns a fixed, deliberately
 * NOT-0.5 probability so a forced tie is unambiguous in these assertions.
 */
describe("WalkForwardSimulator — cold-start index (D-01/D-02)", () => {
  const matches: MatchResult[] = [
    makeMatch({ matchKey: "2024test_qm1", matchNumber: 1, winner: "red", redScore: 100, blueScore: 80 }),
    makeMatch({ matchKey: "2024test_qm2", matchNumber: 2, winner: "blue", redScore: 60, blueScore: 90 }),
  ];

  function stubAlgorithm(fixedPRedWin: number): AlgorithmModule<null> {
    return {
      id: "stub-fake",
      version: "0.0.0",
      initState: () => null,
      predict: () => ({ winner: "red", pRedWin: fixedPRedWin, redScore: 55, blueScore: 45 }),
      update: (state) => state,
      teamMetrics: () => ({}),
    };
  }

  it("given an index containing a match's key, that match's recorded prediction carries pRedWin exactly 0.5 and the record carries the stamp, for an algorithm that would otherwise have returned something else", () => {
    const index = new Set(["2024test_qm1"]);
    const simulator = new WalkForwardSimulator(matches, index);
    const records = simulator.run(stubAlgorithm(0.9), []);

    const coldStartRecord = records.find((r) => r.match.matchKey === "2024test_qm1")!;
    expect(coldStartRecord.prediction.pRedWin).toBe(0.5);
    expect(coldStartRecord.coldStart).toBe(true);

    const ordinaryRecord = records.find((r) => r.match.matchKey === "2024test_qm2")!;
    expect(ordinaryRecord.prediction.pRedWin).toBe(0.9);
    expect(ordinaryRecord.coldStart).toBeUndefined();
  });

  it("given the unavailable-index constant (the default), the recorded predictions are unchanged from today and no record carries the stamp", () => {
    const simulator = new WalkForwardSimulator(matches, NO_COLD_START_INDEX);
    const records = simulator.run(stubAlgorithm(0.9), []);

    for (const record of records) {
      expect(record.prediction.pRedWin).toBe(0.9);
      expect(record.coldStart).toBeUndefined();
    }
  });

  it("omitting the constructor argument entirely behaves identically to passing NO_COLD_START_INDEX explicitly", () => {
    const simulator = new WalkForwardSimulator(matches);
    const records = simulator.run(stubAlgorithm(0.9), []);

    for (const record of records) {
      expect(record.prediction.pRedWin).toBe(0.9);
      expect(record.coldStart).toBeUndefined();
    }
  });

  it("runAll with three stub algorithms returning three different probabilities: on a cold-start match all three records come out at exactly 0.5 (D-01's unification, pinned)", () => {
    const index = new Set(["2024test_qm1"]);
    const simulator = new WalkForwardSimulator(matches, index);
    const algorithms = [stubAlgorithm(0.1), stubAlgorithm(0.5001), stubAlgorithm(0.999)];
    // Distinguish the three algorithms by id so records are attributable.
    const namedAlgorithms = algorithms.map((a, i) => ({ ...a, id: `stub-${i}` }));

    const records = simulator.runAll(namedAlgorithms, []);
    const coldStartRecords = records.filter((r) => r.match.matchKey === "2024test_qm1");
    expect(coldStartRecords).toHaveLength(3);
    for (const record of coldStartRecords) {
      expect(record.prediction.pRedWin).toBe(0.5);
      expect(record.coldStart).toBe(true);
    }

    const ordinaryRecords = records.filter((r) => r.match.matchKey === "2024test_qm2");
    expect(ordinaryRecords).toHaveLength(3);
    const ordinaryProbabilities = ordinaryRecords.map((r) => r.prediction.pRedWin).sort();
    expect(ordinaryProbabilities).toEqual([0.1, 0.5001, 0.999].sort());
    for (const record of ordinaryRecords) {
      expect(record.coldStart).toBeUndefined();
    }
  });

  it("the `update` call still runs for a cold-start match — a cold-start match still teaches the algorithm, it just is not scored", () => {
    const index = new Set(["2024test_qm1"]);
    const updateLog: string[] = [];
    const algorithm: AlgorithmModule<null> = {
      id: "update-tracking-fake",
      version: "0.0.0",
      initState: () => null,
      predict: () => ({ winner: "red", pRedWin: 0.9, redScore: 55, blueScore: 45 }),
      update: (state, result) => {
        updateLog.push(result.matchKey);
        return state;
      },
      teamMetrics: () => ({}),
    };

    const simulator = new WalkForwardSimulator(matches, index);
    simulator.run(algorithm, []);

    expect(updateLog).toEqual(["2024test_qm1", "2024test_qm2"]);
  });
});
