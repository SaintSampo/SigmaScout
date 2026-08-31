/**
 * Corpus-free unit suite for `scripts/measureRewindGap.ts`'s pure helpers
 * (Task 1) plus the doc-to-constant sync guard (Task 3). No `data/corpus.sqlite`
 * access, no network, no filesystem read except the parser cases, which are
 * driven against inline fixture strings — mirrors
 * `packages/harness/payloadBudget.test.ts`'s own parser-robustness shape.
 */
import { describe, expect, it } from "vitest";
import type { MatchResult, Prediction } from "../packages/core/algorithms/types.js";
import type { PredictionRecord } from "../packages/harness/replay.js";
import type { SimResult } from "../packages/core/algorithms/simulation/rankSimulation.js";
import {
  selectStartIndices,
  buildBaselines,
  toSimMatchInputs,
  collectFrozenPredictions,
  meanBandWidth,
  narrowingPercent,
  classifyVerdict,
  parseRewindGap,
  writeRewindGapBlock,
  RewindGapParseError,
  MeanBandWidthError,
  NarrowingPercentError,
  REWIND_GAP_DOC_PATH,
  type RewindGapMeasurement,
} from "./measureRewindGap.js";
import { existsSync, readFileSync } from "node:fs";
import {
  REWIND_GAP_PERCENT,
  REWIND_GAP_VERDICT,
  REWIND_GAP_MEASURED_AT,
  REWIND_GAP_EVENT_COUNT,
  REWIND_GAP_MEASUREMENT_COUNT,
} from "../apps/web/src/lib/rewindGap.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let matchCounter = 0;
function matchFixture(overrides: Partial<MatchResult> & { redTeams: string[]; blueTeams: string[] }): MatchResult {
  matchCounter += 1;
  return {
    matchKey: overrides.matchKey ?? `2024test_qm${matchCounter}`,
    eventKey: overrides.eventKey ?? "2024test",
    compLevel: overrides.compLevel ?? "qm",
    setNumber: overrides.setNumber ?? 1,
    matchNumber: overrides.matchNumber ?? matchCounter,
    redTeams: overrides.redTeams,
    blueTeams: overrides.blueTeams,
    redSurrogates: overrides.redSurrogates ?? [],
    blueSurrogates: overrides.blueSurrogates ?? [],
    eventType: overrides.eventType ?? 0,
    winner: overrides.winner ?? "red",
    redScore: overrides.redScore ?? 100,
    blueScore: overrides.blueScore ?? 90,
    redRpEarned: overrides.redRpEarned === undefined ? 2 : overrides.redRpEarned,
    blueRpEarned: overrides.blueRpEarned === undefined ? 1 : overrides.blueRpEarned,
    redDqs: overrides.redDqs ?? [],
    blueDqs: overrides.blueDqs ?? [],
    hasScoreBreakdown: overrides.hasScoreBreakdown ?? false,
    scoreBreakdownRaw: overrides.scoreBreakdownRaw ?? null,
  };
}

function predictionFixture(overrides: Partial<Prediction> = {}): Prediction {
  return {
    winner: overrides.winner ?? "red",
    pRedWin: overrides.pRedWin ?? 0.55,
    redScore: overrides.redScore ?? 100,
    blueScore: overrides.blueScore ?? 90,
    ...overrides,
  };
}

/** A `SimResult` whose single team's 1000 draws all land on `rankIndex` (0-based) out of `teamCount` possible ranks — 08-04's proven 0.8-rank-unit structural floor, since both the 10th and 90th percentile land inside the same single non-empty bin. */
function singleSpikeHistogram(teamCount: number, rankIndex: number, draws = 1000): Int32Array {
  const hist = new Int32Array(teamCount);
  hist[rankIndex] = draws;
  return hist;
}

// ---------------------------------------------------------------------------
// selectStartIndices
// ---------------------------------------------------------------------------

describe("selectStartIndices(qualCount)", () => {
  it("Test 1: 57 quals returns exactly three ascending, distinct indices, the first of which is 0", () => {
    const indices = selectStartIndices(57);
    expect(indices.length).toBe(3);
    expect(indices[0]).toBe(0);
    expect(indices[1]!).toBeGreaterThan(indices[0]!);
    expect(indices[2]!).toBeGreaterThan(indices[1]!);
  });

  it("Test 2: indices are Math.floor(fraction * qualCount) for each of 0, 1/3, 2/3, pinned by hand for five real qual counts", () => {
    expect(selectStartIndices(57)).toEqual([0, 19, 38]); // floor(57/3)=19, floor(2*57/3)=floor(38)=38
    expect(selectStartIndices(76)).toEqual([0, 25, 50]); // floor(76/3)=25.33->25, floor(2*76/3)=50.67->50
    expect(selectStartIndices(80)).toEqual([0, 26, 53]); // floor(80/3)=26.67->26, floor(160/3)=53.33->53
    expect(selectStartIndices(127)).toEqual([0, 42, 84]); // floor(127/3)=42.33->42, floor(254/3)=84.67->84
    expect(selectStartIndices(62)).toEqual([0, 20, 41]); // floor(62/3)=20.67->20, floor(124/3)=41.33->41
  });

  it("Test 3a: a single-qual event returns exactly [0]", () => {
    expect(selectStartIndices(1)).toEqual([0]);
  });

  it("Test 3b: a two-qual event returns distinct indices only (duplicates collapse)", () => {
    const indices = selectStartIndices(2);
    expect(new Set(indices).size).toBe(indices.length);
    expect(indices).toEqual([0, 1]);
  });

  it("Test 4: a zero-qual event returns an empty array rather than throwing", () => {
    expect(selectStartIndices(0)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildBaselines
// ---------------------------------------------------------------------------

describe("buildBaselines(playedBefore, roster)", () => {
  it("Test 5: a team on the red alliance of two matches with redRpEarned 4 and 2 gets earnedRpSum: 6 (a TOTAL, not 3) and matchesPlayed: 2", () => {
    const matches = [
      matchFixture({ redTeams: ["frc1"], blueTeams: ["frc2"], redRpEarned: 4 }),
      matchFixture({ redTeams: ["frc1"], blueTeams: ["frc3"], redRpEarned: 2 }),
    ];
    const { baselines } = buildBaselines(matches, ["frc1", "frc2", "frc3"]);
    const frc1 = baselines.find((b) => b.teamKey === "frc1")!;
    expect(frc1.earnedRpSum).toBe(6);
    expect(frc1.earnedRpSum).not.toBe(3);
    expect(frc1.matchesPlayed).toBe(2);
  });

  it("Test 6: a roster team with no appearance in playedBefore gets earnedRpSum: 0, matchesPlayed: 0, and IS present in the returned array", () => {
    const { baselines } = buildBaselines([], ["frc1", "frc2"]);
    expect(baselines).toHaveLength(2);
    const frc2 = baselines.find((b) => b.teamKey === "frc2");
    expect(frc2).toBeDefined();
    expect(frc2!.earnedRpSum).toBe(0);
    expect(frc2!.matchesPlayed).toBe(0);
  });

  it("Test 7: a match whose redRpEarned is null contributes NOTHING to the sum, still increments matchesPlayed, and adds every red team to incompleteTeamKeys — a team with one null and one 4-RP match reports earnedRpSum: 4, never a phantom zero or null", () => {
    const matches = [
      matchFixture({ redTeams: ["frc1"], blueTeams: ["frc9"], redRpEarned: null }),
      matchFixture({ redTeams: ["frc1"], blueTeams: ["frc8"], redRpEarned: 4 }),
    ];
    const { baselines, incompleteTeamKeys } = buildBaselines(matches, ["frc1", "frc8", "frc9"]);
    const frc1 = baselines.find((b) => b.teamKey === "frc1")!;
    expect(frc1.earnedRpSum).toBe(4);
    expect(frc1.matchesPlayed).toBe(2);
    expect(incompleteTeamKeys).toContain("frc1");
  });

  it("Test 8: the returned array's order is the roster's order, and every roster entry appears exactly once even when a team plays six matches", () => {
    const roster = ["frcZ", "frcA", "frcM"];
    const matches = Array.from({ length: 6 }, () => matchFixture({ redTeams: ["frcA"], blueTeams: ["frcM"] }));
    const { baselines } = buildBaselines(matches, roster);
    expect(baselines.map((b) => b.teamKey)).toEqual(["frcZ", "frcA", "frcM"]);
    expect(baselines.find((b) => b.teamKey === "frcA")!.matchesPlayed).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// toSimMatchInputs
// ---------------------------------------------------------------------------

describe("toSimMatchInputs(records)", () => {
  it("Test 9: a record with both pmfs yields one SimMatchInput with team keys from the match and pmfs from the prediction, and an empty excludedMatchKeys", () => {
    const record: PredictionRecord = {
      match: matchFixture({ matchKey: "m1", redTeams: ["frc1", "frc2", "frc3"], blueTeams: ["frc4", "frc5", "frc6"] }),
      prediction: predictionFixture({ redRpPmf: [0.1, 0.9], blueRpPmf: [0.2, 0.8] }),
    };
    const { inputs, excludedMatchKeys } = toSimMatchInputs([record]);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.redTeamKeys).toEqual(["frc1", "frc2", "frc3"]);
    expect(inputs[0]!.blueTeamKeys).toEqual(["frc4", "frc5", "frc6"]);
    expect(inputs[0]!.redRpPmf).toEqual([0.1, 0.9]);
    expect(inputs[0]!.blueRpPmf).toEqual([0.2, 0.8]);
    expect(excludedMatchKeys).toEqual([]);
  });

  it("Test 10: a record missing redRpPmf, blueRpPmf, or both yields NO SimMatchInput and records its matchKey — surviving inputs keep original relative order", () => {
    const records: PredictionRecord[] = [
      { match: matchFixture({ matchKey: "m-ok1", redTeams: ["frc1"], blueTeams: ["frc2"] }), prediction: predictionFixture({ redRpPmf: [1], blueRpPmf: [1] }) },
      { match: matchFixture({ matchKey: "m-no-red", redTeams: ["frc1"], blueTeams: ["frc2"] }), prediction: predictionFixture({ blueRpPmf: [1] }) },
      { match: matchFixture({ matchKey: "m-no-blue", redTeams: ["frc1"], blueTeams: ["frc2"] }), prediction: predictionFixture({ redRpPmf: [1] }) },
      { match: matchFixture({ matchKey: "m-no-either", redTeams: ["frc1"], blueTeams: ["frc2"] }), prediction: predictionFixture({}) },
      { match: matchFixture({ matchKey: "m-ok2", redTeams: ["frc1"], blueTeams: ["frc2"] }), prediction: predictionFixture({ redRpPmf: [1], blueRpPmf: [1] }) },
    ];
    const { inputs, excludedMatchKeys } = toSimMatchInputs(records);
    expect(inputs).toHaveLength(2);
    expect(excludedMatchKeys).toEqual(["m-no-red", "m-no-blue", "m-no-either"]);
  });

  it("Test 11: deterministic on order — the same records in the same order produce the same matchKey sequence", () => {
    const records: PredictionRecord[] = [
      { match: matchFixture({ matchKey: "m1", redTeams: ["frc1"], blueTeams: ["frc2"] }), prediction: predictionFixture({ redRpPmf: [1], blueRpPmf: [1] }) },
      { match: matchFixture({ matchKey: "m2", redTeams: ["frc3"], blueTeams: ["frc4"] }), prediction: predictionFixture({ redRpPmf: [1], blueRpPmf: [1] }) },
    ];
    const run1 = toSimMatchInputs(records);
    const run2 = toSimMatchInputs(records);
    expect(run1.inputs.map((i) => i.redTeamKeys[0])).toEqual(run2.inputs.map((i) => i.redTeamKeys[0]));
  });
});

// ---------------------------------------------------------------------------
// collectFrozenPredictions
// ---------------------------------------------------------------------------

describe("collectFrozenPredictions(matches, predictOnly)", () => {
  it("Test 12: given three matches and a predictOnly spy, the spy is called exactly three times, once per match, in order, and records pair each match with its own returned prediction", () => {
    const matches = [
      matchFixture({ matchKey: "m1", redTeams: ["frc1"], blueTeams: ["frc2"] }),
      matchFixture({ matchKey: "m2", redTeams: ["frc3"], blueTeams: ["frc4"] }),
      matchFixture({ matchKey: "m3", redTeams: ["frc5"], blueTeams: ["frc6"] }),
    ];
    const calls: string[] = [];
    const predictOnly = (match: MatchResult): Prediction => {
      calls.push(match.matchKey);
      return predictionFixture({ pRedWin: match.matchKey === "m2" ? 0.9 : 0.5 });
    };
    const records = collectFrozenPredictions(matches, predictOnly);
    expect(calls).toEqual(["m1", "m2", "m3"]);
    expect(records).toHaveLength(3);
    expect(records[1]!.match.matchKey).toBe("m2");
    expect(records[1]!.prediction.pRedWin).toBe(0.9);
  });

  it("Test 13: predictOnly's own type is a bare single-argument arrow function — no algorithm module and no fold-in callback in scope to call", () => {
    const matches = [matchFixture({ matchKey: "m1", redTeams: ["frc1"], blueTeams: ["frc2"] })];
    const records = collectFrozenPredictions(matches, (m) => predictionFixture({ winner: m.redScore > m.blueScore ? "red" : "blue" }));
    expect(records).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// meanBandWidth
// ---------------------------------------------------------------------------

describe("meanBandWidth(result)", () => {
  it("Test 14: every team's histogram places all 1000 draws on one rank -> mean width is exactly 0.8 (08-04's proven structural minimum)", () => {
    const result: SimResult = {
      rankHistograms: new Map([
        ["frc1", singleSpikeHistogram(3, 0)],
        ["frc2", singleSpikeHistogram(3, 1)],
      ]),
      draws: 1000,
    };
    expect(meanBandWidth(result)).toBeCloseTo(0.8, 10);
  });

  it("Test 15: a two-team result where one team's width is 0.8 (single-spike) and the other's is 1.6 (evenly split across two ranks) yields the mean 1.2, over 2 teams", () => {
    const spikeHist = singleSpikeHistogram(4, 0); // width 0.8
    const splitHist = new Int32Array(4);
    splitHist[0] = 500;
    splitHist[1] = 500; // width 1.6, hand-verified: p10=0.7, p90=2.3
    const result: SimResult = {
      rankHistograms: new Map([
        ["frcSpike", spikeHist],
        ["frcSplit", splitHist],
      ]),
      draws: 1000,
    };
    expect(result.rankHistograms.size).toBe(2);
    expect(meanBandWidth(result)).toBeCloseTo(1.2, 10);
  });

  it("Test 16: an empty rankHistograms map throws a named error rather than returning NaN", () => {
    const result: SimResult = { rankHistograms: new Map(), draws: 1000 };
    expect(() => meanBandWidth(result)).toThrow(MeanBandWidthError);
  });
});

// ---------------------------------------------------------------------------
// narrowingPercent
// ---------------------------------------------------------------------------

describe("narrowingPercent(frozenWidth, storedWidth)", () => {
  it("Test 17: frozen 4.0, stored 3.0 returns exactly 25", () => {
    expect(narrowingPercent(4.0, 3.0)).toBe(25);
  });

  it("Test 18: frozen 3.0, stored 4.0 returns exactly -33.333333... (a negative result is a legitimate finding, never clamped or thrown)", () => {
    expect(narrowingPercent(3.0, 4.0)).toBeCloseTo(-33.333333, 6);
  });

  it("Test 19: equal widths return exactly 0", () => {
    expect(narrowingPercent(5.0, 5.0)).toBe(0);
  });

  it("Test 20: a frozenWidth of 0 or a non-finite frozenWidth throws a named error", () => {
    expect(() => narrowingPercent(0, 3.0)).toThrow(NarrowingPercentError);
    expect(() => narrowingPercent(Number.NaN, 3.0)).toThrow(NarrowingPercentError);
    expect(() => narrowingPercent(Number.POSITIVE_INFINITY, 3.0)).toThrow(NarrowingPercentError);
    expect(() => narrowingPercent(-1, 3.0)).toThrow(NarrowingPercentError);
  });
});

// ---------------------------------------------------------------------------
// classifyVerdict
// ---------------------------------------------------------------------------

describe("classifyVerdict(meanNarrowing, meanNoiseFloor)", () => {
  it("Test 21: 18.0 against a noise floor of 1.2 returns narrower", () => {
    expect(classifyVerdict(18.0, 1.2)).toBe("narrower");
  });

  it("Test 22: -9.0 against 1.2 returns wider", () => {
    expect(classifyVerdict(-9.0, 1.2)).toBe("wider");
  });

  it("Test 23: 0.9 and -0.9 against 1.2 both return indistinguishable (absolute-value comparison)", () => {
    expect(classifyVerdict(0.9, 1.2)).toBe("indistinguishable");
    expect(classifyVerdict(-0.9, 1.2)).toBe("indistinguishable");
  });

  it("Test 24: a value exactly equal to the noise floor returns indistinguishable (boundary is inclusive on the humble side)", () => {
    expect(classifyVerdict(1.2, 1.2)).toBe("indistinguishable");
    expect(classifyVerdict(-1.2, 1.2)).toBe("indistinguishable");
  });
});

// ---------------------------------------------------------------------------
// parseRewindGap / RewindGapParseError
// ---------------------------------------------------------------------------

const FIXTURE_MEASUREMENT: RewindGapMeasurement = {
  measuredAt: "2026-01-01T00:00:00.000Z",
  algorithmId: "vpr",
  algorithmVersion: "vpr@2.1.0+tuned-2026-08",
  corpusIdentity: "data/corpus.sqlite",
  corpusMatchCount: 1000,
  draws: 1000,
  seed: 20260830,
  events: [],
  headline: {
    meanNarrowingPercent: 10,
    minNarrowingPercent: 1,
    maxNarrowingPercent: 20,
    meanNoiseFloorPercent: 1,
    measurementCount: 15,
    eventCount: 5,
    excludedMatchCount: 0,
    incompleteBaselineTeamCount: 0,
    verdict: "narrower",
  },
};

describe("parseRewindGap(markdown) / RewindGapParseError", () => {
  it("Test 25: parses a well-formed fenced json rewind-gap block, tolerating \\r\\n line endings", () => {
    const fixture = '# Doc\n\n```json rewind-gap\r\n{"measuredAt":"x","algorithmId":"vpr","algorithmVersion":"v","corpusIdentity":"c","corpusMatchCount":1,"draws":1000,"seed":1,"events":[],"headline":{"meanNarrowingPercent":1,"minNarrowingPercent":1,"maxNarrowingPercent":1,"meanNoiseFloorPercent":1,"measurementCount":1,"eventCount":1,"excludedMatchCount":0,"incompleteBaselineTeamCount":0,"verdict":"narrower"}}\r\n```\r\n';
    const parsed = parseRewindGap(fixture);
    expect(parsed.algorithmId).toBe("vpr");
  });

  it("Test 26: a markdown string with no block throws RewindGapParseError naming the doc path", () => {
    expect(() => parseRewindGap("# Some doc\n\nno block here")).toThrow(RewindGapParseError);
    try {
      parseRewindGap("# Some doc\n\nno block here");
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain(REWIND_GAP_DOC_PATH);
    }
  });

  it("Test 27: a block present but containing invalid JSON throws RewindGapParseError naming the JSON error", () => {
    expect(() => parseRewindGap("```json rewind-gap\n{ not valid json\n```\n")).toThrow(RewindGapParseError);
  });
});

// ---------------------------------------------------------------------------
// writeRewindGapBlock
// ---------------------------------------------------------------------------

describe("writeRewindGapBlock(markdown, measurement)", () => {
  it("Test 28: replaces the existing block's contents in place, leaving every byte outside the fence untouched", () => {
    const before = "# Title\n\nSome prose before.\n\n```json rewind-gap\n{}\n```\n\nSome prose after.\n";
    const after = writeRewindGapBlock(before, FIXTURE_MEASUREMENT);
    expect(after.startsWith("# Title\n\nSome prose before.\n\n```json rewind-gap\n")).toBe(true);
    expect(after.endsWith("\n```\n\nSome prose after.\n")).toBe(true);
  });

  it("Test 29: throws RewindGapParseError when no block exists, rather than appending one", () => {
    expect(() => writeRewindGapBlock("# Title\n\nNo block here.\n", FIXTURE_MEASUREMENT)).toThrow(RewindGapParseError);
  });

  it("Test 30: round-trips — parseRewindGap(writeRewindGapBlock(doc, m)) deep-equals m", () => {
    const before = "# Title\n\n```json rewind-gap\n{}\n```\n";
    const after = writeRewindGapBlock(before, FIXTURE_MEASUREMENT);
    const roundTripped = parseRewindGap(after);
    expect(roundTripped).toEqual(FIXTURE_MEASUREMENT);
  });
});

// ---------------------------------------------------------------------------
// Doc-to-constant sync guard (Task 3): docs/models/rewind-overconfidence-gap.md's
// committed json rewind-gap block is the number's single source of truth;
// apps/web/src/lib/rewindGap.ts is a hand-written mirror. This test parses the
// REAL committed doc and asserts every shipped constant equals its
// corresponding field — mirrors payloadBudget.test.ts's own treatment of
// docs/publish-budget.md. A missing doc fails loudly (not a silent skip),
// matching that file's own non-vacuity discipline.
// ---------------------------------------------------------------------------

describe("docs/models/rewind-overconfidence-gap.md <-> apps/web/src/lib/rewindGap.ts sync guard", () => {
  it(`${REWIND_GAP_DOC_PATH} exists and its json rewind-gap block parses`, () => {
    expect(existsSync(REWIND_GAP_DOC_PATH)).toBe(true);
  });

  it("every shipped constant in apps/web/src/lib/rewindGap.ts equals the doc's committed block field", () => {
    const doc = readFileSync(REWIND_GAP_DOC_PATH, "utf8");
    const measurement = parseRewindGap(doc);
    expect(REWIND_GAP_PERCENT).toBe(measurement.headline.meanNarrowingPercent);
    expect(REWIND_GAP_VERDICT).toBe(measurement.headline.verdict);
    expect(REWIND_GAP_MEASURED_AT).toBe(measurement.measuredAt);
    expect(REWIND_GAP_EVENT_COUNT).toBe(measurement.headline.eventCount);
    expect(REWIND_GAP_MEASUREMENT_COUNT).toBe(measurement.headline.measurementCount);
  });
});
