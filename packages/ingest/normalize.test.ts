/**
 * One test per TBA data quirk DATA-02 names (Plan 03 Task 3): surrogates,
 * disqualifications, replays (via the sticky `detectReplay` diff), missing
 * score breakdowns, offseason events, unplayed matches, ties, and RP
 * normalization. Each fixture is a small hand-written TBA-shaped object so
 * quirks can be exercised without depending on a real event that happens
 * to contain one.
 */
import { describe, expect, it } from "vitest";
import { detectReplay, normalizeEvent, normalizeMatch, type ExistingMatchScoreFields } from "./normalize.js";
import type { TbaEvent, TbaMatch } from "./schemas.js";

const EVENT_START = "2024-03-01";

function tbaMatch(overrides: Partial<TbaMatch> = {}): TbaMatch {
  return {
    key: "2024casj_qm1",
    event_key: "2024casj",
    comp_level: "qm",
    set_number: 1,
    match_number: 1,
    time: 1_000,
    predicted_time: 1_000,
    actual_time: 1_000,
    winning_alliance: "red",
    alliances: {
      red: { team_keys: ["frc1", "frc2", "frc3"], surrogate_team_keys: [], dq_team_keys: [], score: 100 },
      blue: { team_keys: ["frc4", "frc5", "frc6"], surrogate_team_keys: [], dq_team_keys: [], score: 50 },
    },
    score_breakdown: { red: { rp: 2 }, blue: { rp: 0 } },
    ...overrides,
  };
}

function tbaEvent(overrides: Partial<TbaEvent> = {}): TbaEvent {
  return { key: "2024casj", year: 2024, event_type: 0, start_date: EVENT_START, ...overrides };
}

describe("normalizeMatch — surrogates", () => {
  it("stores a surrogate in the alliance's surrogate list AND its team list", () => {
    const match = tbaMatch({
      alliances: {
        red: {
          team_keys: ["frc1", "frc2", "frc3"],
          surrogate_team_keys: ["frc2"],
          dq_team_keys: [],
          score: 100,
        },
        blue: { team_keys: ["frc4", "frc5", "frc6"], surrogate_team_keys: [], dq_team_keys: [], score: 50 },
      },
    });

    const result = normalizeMatch(match, EVENT_START);

    expect(result.redTeams).toContain("frc2");
    expect(result.redSurrogates).toEqual(["frc2"]);
  });
});

describe("normalizeMatch — disqualifications", () => {
  it("stores a disqualified team in the alliance's dq list", () => {
    const match = tbaMatch({
      alliances: {
        red: { team_keys: ["frc1", "frc2", "frc3"], surrogate_team_keys: [], dq_team_keys: ["frc3"], score: 100 },
        blue: { team_keys: ["frc4", "frc5", "frc6"], surrogate_team_keys: [], dq_team_keys: [], score: 50 },
      },
    });

    const result = normalizeMatch(match, EVENT_START);

    expect(result.redDqs).toEqual(["frc3"]);
  });
});

describe("detectReplay", () => {
  const now = "2026-08-13T00:00:00.000Z";

  it("sets replayed = 1 when a changed score follows an already-complete match", () => {
    const existing: ExistingMatchScoreFields = {
      winner: "red",
      redScore: 100,
      blueScore: 50,
      scoreBreakdownRaw: '{"red":{}}',
      replayed: false,
      replayDetectedAt: null,
    };

    const result = detectReplay(
      existing,
      { winner: "blue", redScore: 90, blueScore: 95, scoreBreakdownRaw: '{"red":{}}' },
      now
    );

    expect(result.replayed).toBe(true);
    expect(result.replayDetectedAt).toBe(now);
  });

  it("leaves replayed unchanged for an unchanged re-upsert of a complete match", () => {
    const existing: ExistingMatchScoreFields = {
      winner: "red",
      redScore: 100,
      blueScore: 50,
      scoreBreakdownRaw: '{"red":{}}',
      replayed: false,
      replayDetectedAt: null,
    };

    const result = detectReplay(
      existing,
      { winner: "red", redScore: 100, blueScore: 50, scoreBreakdownRaw: '{"red":{}}' },
      now
    );

    expect(result.replayed).toBe(false);
    expect(result.replayDetectedAt).toBeNull();
  });

  it("does not set replayed for a first-time scoring of a previously-incomplete match", () => {
    const existing: ExistingMatchScoreFields = {
      winner: null,
      redScore: null,
      blueScore: null,
      scoreBreakdownRaw: null,
      replayed: false,
      replayDetectedAt: null,
    };

    const result = detectReplay(
      existing,
      { winner: "red", redScore: 100, blueScore: 50, scoreBreakdownRaw: '{"red":{}}' },
      now
    );

    expect(result.replayed).toBe(false);
    expect(result.replayDetectedAt).toBeNull();
  });

  it("keeps replayed = 1 sticky across a later unrelated (non-diffing) upsert", () => {
    const existing: ExistingMatchScoreFields = {
      winner: "blue",
      redScore: 90,
      blueScore: 95,
      scoreBreakdownRaw: '{"red":{}}',
      replayed: true,
      replayDetectedAt: "2026-08-12T00:00:00.000Z",
    };

    const result = detectReplay(
      existing,
      { winner: "blue", redScore: 90, blueScore: 95, scoreBreakdownRaw: '{"red":{}}' },
      now
    );

    expect(result.replayed).toBe(true);
    expect(result.replayDetectedAt).toBe("2026-08-12T00:00:00.000Z");
  });
});

describe("normalizeEvent — offseason flag", () => {
  it("flags event_type 99 as offseason, and 98/100 as not offseason", () => {
    expect(normalizeEvent(tbaEvent({ event_type: 99 })).isOffseason).toBe(true);
    expect(normalizeEvent(tbaEvent({ event_type: 98 })).isOffseason).toBe(false);
    expect(normalizeEvent(tbaEvent({ event_type: 100 })).isOffseason).toBe(false);
  });
});

describe("normalizeMatch — missing score breakdown", () => {
  it("stores has_score_breakdown = 0, a null raw column, and no zero-defaulted RP field", () => {
    const match = tbaMatch({ score_breakdown: null });

    const result = normalizeMatch(match, EVENT_START);

    expect(result.hasScoreBreakdown).toBe(false);
    expect(result.scoreBreakdownRaw).toBeNull();
    expect(result.redRpEarned).toBeNull();
    expect(result.blueRpEarned).toBeNull();
  });
});

describe("normalizeMatch — unplayed match", () => {
  it("stores NULL scores and a NULL winner rather than 0", () => {
    const match = tbaMatch({
      winning_alliance: "",
      alliances: {
        red: { team_keys: ["frc1"], surrogate_team_keys: [], dq_team_keys: [], score: null },
        blue: { team_keys: ["frc4"], surrogate_team_keys: [], dq_team_keys: [], score: null },
      },
    });

    const result = normalizeMatch(match, EVENT_START);

    expect(result.redScore).toBeNull();
    expect(result.blueScore).toBeNull();
    expect(result.winner).toBeNull();
  });
});

describe("normalizeMatch — tie", () => {
  it("stores winner = 'tie' when both alliances score equally and TBA reports no winning alliance", () => {
    const match = tbaMatch({
      winning_alliance: "",
      alliances: {
        red: { team_keys: ["frc1"], surrogate_team_keys: [], dq_team_keys: [], score: 75 },
        blue: { team_keys: ["frc4"], surrogate_team_keys: [], dq_team_keys: [], score: 75 },
      },
    });

    const result = normalizeMatch(match, EVENT_START);

    expect(result.winner).toBe("tie");
  });
});

describe("normalizeMatch — winner imputation (D-01, 01-REVIEW WR-06)", () => {
  it("derives winner red and imputes when winning_alliance is empty and red outscored blue", () => {
    const match = tbaMatch({
      winning_alliance: "",
      alliances: {
        red: { team_keys: ["frc1"], surrogate_team_keys: [], dq_team_keys: [], score: 80 },
        blue: { team_keys: ["frc4"], surrogate_team_keys: [], dq_team_keys: [], score: 60 },
      },
    });

    const result = normalizeMatch(match, EVENT_START);

    expect(result.winner).toBe("red");
    expect(result.winnerImputed).toBe(true);
  });

  it("derives winner blue and imputes when winning_alliance is empty and blue outscored red", () => {
    const match = tbaMatch({
      winning_alliance: "",
      alliances: {
        red: { team_keys: ["frc1"], surrogate_team_keys: [], dq_team_keys: [], score: 60 },
        blue: { team_keys: ["frc4"], surrogate_team_keys: [], dq_team_keys: [], score: 80 },
      },
    });

    const result = normalizeMatch(match, EVENT_START);

    expect(result.winner).toBe("blue");
    expect(result.winnerImputed).toBe(true);
  });

  it("never re-derives or overwrites a TBA-reported winner", () => {
    const match = tbaMatch({
      winning_alliance: "red",
      alliances: {
        red: { team_keys: ["frc1"], surrogate_team_keys: [], dq_team_keys: [], score: 60 },
        blue: { team_keys: ["frc4"], surrogate_team_keys: [], dq_team_keys: [], score: 80 },
      },
    });

    const result = normalizeMatch(match, EVENT_START);

    expect(result.winner).toBe("red");
    expect(result.winnerImputed).toBe(false);
  });

  it("does not treat an empty-winning_alliance tie as an imputation", () => {
    const match = tbaMatch({
      winning_alliance: "",
      alliances: {
        red: { team_keys: ["frc1"], surrogate_team_keys: [], dq_team_keys: [], score: 75 },
        blue: { team_keys: ["frc4"], surrogate_team_keys: [], dq_team_keys: [], score: 75 },
      },
    });

    const result = normalizeMatch(match, EVENT_START);

    expect(result.winner).toBe("tie");
    expect(result.winnerImputed).toBe(false);
  });

  it("leaves winnerImputed false for an unplayed match", () => {
    const match = tbaMatch({
      winning_alliance: "",
      alliances: {
        red: { team_keys: ["frc1"], surrogate_team_keys: [], dq_team_keys: [], score: null },
        blue: { team_keys: ["frc4"], surrogate_team_keys: [], dq_team_keys: [], score: null },
      },
    });

    const result = normalizeMatch(match, EVENT_START);

    expect(result.winner).toBeNull();
    expect(result.winnerImputed).toBe(false);
  });

  it("derives the winner from score comparison when winning_alliance is a non-red/blue/empty value on a played, non-tied match", () => {
    // TBA's schema restricts winning_alliance to "red" | "blue" | "" (see
    // schemas.ts), but normalizeMatch's own derivation logic treats ANY
    // non-red/blue value the same as empty — this cast exercises that
    // generality directly, as the plan's <behavior> spec requires.
    const match = tbaMatch({
      winning_alliance: "purple" as unknown as "" | "red" | "blue",
      alliances: {
        red: { team_keys: ["frc1"], surrogate_team_keys: [], dq_team_keys: [], score: 80 },
        blue: { team_keys: ["frc4"], surrogate_team_keys: [], dq_team_keys: [], score: 60 },
      },
    });

    const result = normalizeMatch(match, EVENT_START);

    expect(result.winner).toBe("red");
    expect(result.winnerImputed).toBe(true);
  });
});

describe("normalizeMatch — ranking points", () => {
  it("reads the recon-observed 'rp' field directly", () => {
    const match = tbaMatch({ score_breakdown: { red: { rp: 2 }, blue: { rp: 1 } } });

    const result = normalizeMatch(match, EVENT_START);

    expect(result.redRpEarned).toBe(2);
    expect(result.blueRpEarned).toBe(1);
  });

  it("stays null when neither 'rp' nor the legacy 'tba_rpEarned' field is present", () => {
    const match = tbaMatch({ score_breakdown: { red: { someOtherField: 1 }, blue: {} } });

    const result = normalizeMatch(match, EVENT_START);

    expect(result.redRpEarned).toBeNull();
    expect(result.blueRpEarned).toBeNull();
  });
});
