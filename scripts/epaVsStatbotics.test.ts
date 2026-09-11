/**
 * Pure-piece coverage for `scripts/epaVsStatbotics.ts` (quick task
 * 260908-n5o, Task 1). Every test here is corpus-free and network-free —
 * `mapRecordsToHarnessPredictionInput`, `selectCombinedSlice` and
 * `currentEpaVersion` are the three exported pure pieces `main()`'s own
 * impure driver calls into, and this file is the unit coverage for those
 * pieces alone. `main()` itself (corpus read, live Statbotics fetch) is
 * exercised only by Task 5's orchestrator-run measurement, never here.
 */
import { describe, expect, it } from "vitest";
import { epa } from "../packages/core/algorithms/epa.js";
import type { MatchResult, Prediction } from "../packages/core/algorithms/types.js";
import type { MultiAlgorithmPredictionRecord } from "../packages/harness/replay.js";
import type { ScoreSlice } from "../packages/harness/score.js";
import { currentEpaVersion, mapRecordsToHarnessPredictionInput, officialOnlyTeamValues, parseSeasonRange, selectCombinedSlice } from "./epaVsStatbotics.js";

function buildMatch(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    matchKey: "2026casj_qm1",
    eventKey: "2026casj",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 1,
    redTeams: ["frc254", "frc1678", "frc971"],
    blueTeams: ["frc604", "frc1323", "frc2135"],
    redSurrogates: [],
    blueSurrogates: [],
    eventType: 0,
    week: null,
    winner: "red",
    redScore: 100,
    blueScore: 80,
    redRpEarned: 3,
    blueRpEarned: 1,
    redDqs: [],
    blueDqs: [],
    hasScoreBreakdown: true,
    scoreBreakdownRaw: null,
    ...overrides,
  };
}

function buildPrediction(overrides: Partial<Prediction> = {}): Prediction {
  return {
    winner: "red",
    pRedWin: 0.62,
    redScore: 95,
    blueScore: 78,
    ...overrides,
  };
}

function buildRecord(
  matchOverrides: Partial<MatchResult> = {},
  predictionOverrides: Partial<Prediction> = {}
): MultiAlgorithmPredictionRecord {
  return {
    match: buildMatch(matchOverrides),
    algorithmId: epa.id,
    prediction: buildPrediction(predictionOverrides),
  };
}

function buildSlice(overrides: Partial<ScoreSlice> = {}): ScoreSlice {
  return {
    algorithmId: epa.id,
    season: 2026,
    headlineEligible: false,
    compLevelView: "combined",
    brierScore: 0.19,
    winnerAccuracy: 0.72,
    scoredCount: 120,
    tieCount: 0,
    noCallCount: 0,
    exclusionCounts: { offseason: 0, surrogateAffected: 0, missingResult: 0, quarantined: 0, coldStart: 0 },
    candidateCount: 120,
    calibrationBins: [],
    ...overrides,
  };
}

describe("mapRecordsToHarnessPredictionInput", () => {
  it("maps a synthetic record to the expected HarnessPredictionInput fields, carrying eventKey as a real field", () => {
    const record = buildRecord({ eventKey: "2026micmp", matchKey: "2026micmp_qm5" });
    const [input] = mapRecordsToHarnessPredictionInput([record], 2026);

    expect(input).toEqual({
      matchKey: "2026micmp_qm5",
      season: 2026,
      eventKey: "2026micmp",
      compLevel: "qm",
      algorithmId: epa.id,
      pRedWin: 0.62,
      predictedRedScore: 95,
      predictedBlueScore: 78,
      actualWinner: "red",
      isOffseason: false,
      isSurrogateAffected: false,
      isColdStart: false,
    });
  });

  it("carries eventKey verbatim off the match, never derived by splitting matchKey", () => {
    // A matchKey whose event-looking prefix deliberately does NOT match the
    // match's own eventKey — if the mapping ever derived eventKey by
    // splitting matchKey on "_", this would silently produce the wrong
    // value instead of failing loudly.
    const record = buildRecord({ matchKey: "2026wrongevent_qm1", eventKey: "2026casj" });
    const [input] = mapRecordsToHarnessPredictionInput([record], 2026);
    expect(input!.eventKey).toBe("2026casj");
  });

  it("flags an offseason event (eventType 99) as isOffseason: true", () => {
    const record = buildRecord({ eventType: 99 });
    const [input] = mapRecordsToHarnessPredictionInput([record], 2026);
    expect(input!.isOffseason).toBe(true);
  });

  it("flags a surrogate-affected match when either alliance carries a surrogate", () => {
    const record = buildRecord({ redSurrogates: ["frc254"] });
    const [input] = mapRecordsToHarnessPredictionInput([record], 2026);
    expect(input!.isSurrogateAffected).toBe(true);
  });
});

describe("selectCombinedSlice", () => {
  it("returns the combined-view slice when slices for all three views are given", () => {
    const slices: ScoreSlice[] = [
      buildSlice({ compLevelView: "qualification", winnerAccuracy: 0.7 }),
      buildSlice({ compLevelView: "elimination", winnerAccuracy: 0.65 }),
      buildSlice({ compLevelView: "combined", winnerAccuracy: 0.72 }),
    ];
    const selected = selectCombinedSlice(slices, epa.id, 2026);
    expect(selected.compLevelView).toBe("combined");
    expect(selected.winnerAccuracy).toBe(0.72);
  });

  it("throws loudly, rather than returning a silent null, when no combined slice exists for the pair", () => {
    const slices: ScoreSlice[] = [buildSlice({ compLevelView: "qualification" }), buildSlice({ compLevelView: "elimination" })];
    expect(() => selectCombinedSlice(slices, epa.id, 2026)).toThrow(/no "combined" compLevelView slice/);
  });

  it("throws when slices exist for the algorithm but not the requested season", () => {
    const slices: ScoreSlice[] = [buildSlice({ season: 2025 })];
    expect(() => selectCombinedSlice(slices, epa.id, 2026)).toThrow(/season 2026/);
  });
});

describe("currentEpaVersion", () => {
  it("equals the epa module's own version field, by equality, never by pattern match", () => {
    expect(currentEpaVersion()).toBe(epa.version);
  });
});

describe("officialOnlyTeamValues", () => {
  it("converts a last-official-match totals map into OurTeamValue pairs", () => {
    const totals = new Map([
      ["frc254", 100],
      ["frc971", 80],
    ]);
    expect(officialOnlyTeamValues(totals)).toEqual([
      { teamKey: "frc254", value: 100 },
      { teamKey: "frc971", value: 80 },
    ]);
  });

  it("returns an empty array for a team with no official match this season (absent from the map)", () => {
    expect(officialOnlyTeamValues(new Map())).toEqual([]);
  });
});

/**
 * Quick task 260911-r7e. The gapped form exists so a warm 2022 can be
 * measured at all (2021 has no component map), so the 2021-skipping case is
 * pinned by equality rather than by a loop over whatever the parser returns.
 */
describe("parseSeasonRange", () => {
  it("still parses a single contiguous range unchanged", () => {
    expect(parseSeasonRange("2022-2026")).toEqual([2022, 2023, 2024, 2025, 2026]);
  });

  it("parses the gapped list that skips 2021", () => {
    expect(parseSeasonRange("2016-2020,2022-2026")).toEqual([
      2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026,
    ]);
  });

  it("never emits 2021 from the gapped list, because no 2021 component map is registered", () => {
    expect(parseSeasonRange("2016-2020,2022-2026")).not.toContain(2021);
  });

  it("accepts bare years alongside ranges", () => {
    expect(parseSeasonRange("2016,2019-2020,2024")).toEqual([2016, 2019, 2020, 2024]);
  });

  it("sorts ascending and de-duplicates, because the replay carries state forward in list order", () => {
    expect(parseSeasonRange("2024,2016-2017,2024")).toEqual([2016, 2017, 2024]);
  });

  it("rejects a reversed range", () => {
    expect(() => parseSeasonRange("2026-2022")).toThrow(/must be <=/);
  });

  it("rejects a non-year token", () => {
    expect(() => parseSeasonRange("2016-2020,banana")).toThrow(/comma-separated years/);
  });

  it("rejects an empty selection", () => {
    expect(() => parseSeasonRange(" , ")).toThrow(/at least one season/);
  });
});
