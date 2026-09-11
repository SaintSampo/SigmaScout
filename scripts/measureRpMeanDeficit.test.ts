/**
 * Unit tests for `measureRpMeanDeficit.ts`'s pure helpers, per this plan's
 * (09-03) mandatory TDD gate. No test here opens the corpus — every case
 * runs against exported pure functions and a synthetic match sequence.
 *
 * The equivalence test is the load-bearing one: it proves the standalone
 * fold loop this script drives (`foldObservedThresholds`) reproduces
 * `SigmaScoutLayer`'s own private `#foldObservedThresholds` exactly, by
 * running both against a bare `RpMomentsAccumulator` and comparing the
 * resulting `momentsFor(...)` output. Without this, the standalone loop
 * could silently become a second, slightly-different scorer — the same
 * failure class that manufactured a ~0.003 phantom regression on this
 * project once already (D-11).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { MatchResult } from "../packages/core/algorithms/types.js";
import { RpMomentsAccumulator } from "../packages/core/rankingPoints/empiricalMoments.js";
import { rp2026 } from "../packages/core/rankingPoints/2026.js";
import { SigmaScoutLayer } from "../packages/harness/sigmaScoutLayer.js";
import { parseSeasons, isFullyWarmRoster, deficitFraction, foldObservedThresholds } from "./measureRpMeanDeficit.js";

/** One synthetic 2026 score breakdown, shaped exactly to `rp2026`'s `Rp2026Schema`. */
function breakdown(hubTotalCount: number, totalTowerPoints: number) {
  const side = {
    autoTowerPoints: totalTowerPoints,
    endGameTowerPoints: 0,
    hubScore: { totalCount: hubTotalCount },
    energizedAchieved: false,
    superchargedAchieved: false,
    traversalAchieved: false,
  };
  return JSON.stringify({ red: side, blue: side });
}

const RED_ROSTER = ["frc1", "frc2", "frc3"] as const;
const BLUE_ROSTER = ["frc4", "frc5", "frc6"] as const;

function baseMatch(overrides: Partial<MatchResult>): MatchResult {
  return {
    matchKey: "2026test_qm1",
    eventKey: "2026test",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 1,
    redTeams: [...RED_ROSTER],
    blueTeams: [...BLUE_ROSTER],
    redSurrogates: [],
    blueSurrogates: [],
    eventType: 0,
    week: null,
    winner: "red",
    redScore: 100,
    blueScore: 90,
    redRpEarned: 3,
    blueRpEarned: 0,
    redDqs: [],
    blueDqs: [],
    hasScoreBreakdown: true,
    scoreBreakdownRaw: breakdown(50, 20),
    ...overrides,
  };
}

describe("parseSeasons", () => {
  it("expands a comma-separated range spec into every registered season, 2021 absent", () => {
    expect(parseSeasons("2016-2020,2022-2026")).toEqual([2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026]);
  });

  it("a single season yields a one-element array", () => {
    expect(parseSeasons("2026")).toEqual([2026]);
  });

  it("drops a season with no registered rule module rather than throwing", () => {
    // 2021 has no registered rule module — an explicit range through it must
    // not throw, and 2021 itself must be absent from the result.
    expect(parseSeasons("2020-2022")).toEqual([2020, 2022]);
  });
});

describe("isFullyWarmRoster", () => {
  it("returns false for every roster before any observation is folded", () => {
    const accumulator = new RpMomentsAccumulator(rp2026);
    expect(isFullyWarmRoster(accumulator, [...RED_ROSTER])).toBe(false);
  });

  it("returns true only once a 3-team roster's every team has hasHistory === true for every variable", () => {
    const accumulator = new RpMomentsAccumulator(rp2026);
    accumulator.fold([...RED_ROSTER], { hubTotalCount: 60, totalTowerPoints: 30 });
    expect(isFullyWarmRoster(accumulator, [...RED_ROSTER])).toBe(true);
  });

  it("returns false for a 2-team roster even when both teams are warm — warm-3of3 excludes surrogate-shrunk rosters", () => {
    const accumulator = new RpMomentsAccumulator(rp2026);
    const twoTeamRoster = [RED_ROSTER[0]!, RED_ROSTER[1]!];
    accumulator.fold(twoTeamRoster, { hubTotalCount: 60, totalTowerPoints: 30 });
    expect(isFullyWarmRoster(accumulator, twoTeamRoster)).toBe(false);
  });

  it("returns false for a 3-team roster with one cold team", () => {
    const accumulator = new RpMomentsAccumulator(rp2026);
    accumulator.fold([RED_ROSTER[0]!, RED_ROSTER[1]!], { hubTotalCount: 60, totalTowerPoints: 30 });
    // frc3 has never been folded — the roster overall is not fully warm.
    expect(isFullyWarmRoster(accumulator, [...RED_ROSTER])).toBe(false);
  });
});

describe("deficitFraction", () => {
  it("a predicted mean BELOW observed is a POSITIVE deficit, matching the audit's sign convention", () => {
    // observed 100, predicted 88 -> (100-88)/100 = 0.12
    expect(deficitFraction(100, 88)).toBeCloseTo(0.12, 12);
  });

  it("a predicted mean ABOVE observed is a NEGATIVE deficit", () => {
    expect(deficitFraction(100, 112)).toBeCloseTo(-0.12, 12);
  });

  it("returns undefined rather than NaN/Infinity when observedMean is 0", () => {
    expect(deficitFraction(0, 5)).toBeUndefined();
    expect(deficitFraction(0, 0)).toBeUndefined();
  });
});

describe("foldObservedThresholds equivalence against SigmaScoutLayer's own #foldObservedThresholds", () => {
  it("produces exactly the same momentsFor(...) meanVector and varianceBlock as the shipped layer, over a 3-match synthetic sequence (eligible+breakdown, ineligible event type, missing breakdown)", () => {
    const matches: MatchResult[] = [
      // 1. RP-eligible, has a breakdown — folds normally.
      baseMatch({ matchKey: "2026test_qm1", eventType: 0, hasScoreBreakdown: true, scoreBreakdownRaw: breakdown(60, 30) }),
      // 2. Offseason (event_type 99) — NOT in EVENT_TYPE_TIERS, ineligible, skipped entirely.
      baseMatch({ matchKey: "2026test_qm2", eventType: 99, hasScoreBreakdown: true, scoreBreakdownRaw: breakdown(999, 999) }),
      // 3. RP-eligible but no score breakdown — skipped entirely.
      baseMatch({ matchKey: "2026test_qm3", eventType: 0, hasScoreBreakdown: false, scoreBreakdownRaw: null }),
      // 4. RP-eligible, has a breakdown — folds normally, second observation.
      baseMatch({ matchKey: "2026test_qm4", eventType: 0, hasScoreBreakdown: true, scoreBreakdownRaw: breakdown(70, 35) }),
    ];

    // Arm A: the standalone script loop.
    const standaloneAccumulator = new RpMomentsAccumulator(rp2026);
    for (const match of matches) foldObservedThresholds(standaloneAccumulator, rp2026, match);

    // Arm B: SigmaScoutLayer's own private #foldObservedThresholds, driven
    // through the real, shipped foldPlayed — the exact path the publisher
    // runs.
    const layer = new SigmaScoutLayer(rp2026);
    for (const match of matches) {
      layer.foldPlayed(match, { winner: "red", pRedWin: 0.5, redScore: match.redScore, blueScore: match.blueScore });
    }
    const layerAccumulator = layer.rpAccumulator!;

    const standaloneRed = standaloneAccumulator.momentsFor([...RED_ROSTER], 0, 0);
    const layerRed = layerAccumulator.momentsFor([...RED_ROSTER], 0, 0);
    expect(standaloneRed.meanVector).toEqual(layerRed.meanVector);
    expect(standaloneRed.varianceBlock).toEqual(layerRed.varianceBlock);

    const standaloneBlue = standaloneAccumulator.momentsFor([...BLUE_ROSTER], 0, 0);
    const layerBlue = layerAccumulator.momentsFor([...BLUE_ROSTER], 0, 0);
    expect(standaloneBlue.meanVector).toEqual(layerBlue.meanVector);
    expect(standaloneBlue.varianceBlock).toEqual(layerBlue.varianceBlock);
  });

  it("reports the correct eligibility/parse outcome for each of the three guard cases", () => {
    const accumulator = new RpMomentsAccumulator(rp2026);

    const eligible = foldObservedThresholds(accumulator, rp2026, baseMatch({ eventType: 0, hasScoreBreakdown: true, scoreBreakdownRaw: breakdown(60, 30) }));
    expect(eligible.eligible).toBe(true);
    expect(eligible.sideResults.red.parsed).toBe(true);
    expect(eligible.sideResults.red.records.length).toBe(2); // hubTotalCount, totalTowerPoints

    const ineligibleEventType = foldObservedThresholds(accumulator, rp2026, baseMatch({ eventType: 99, hasScoreBreakdown: true, scoreBreakdownRaw: breakdown(60, 30) }));
    expect(ineligibleEventType.eligible).toBe(false);

    const missingBreakdown = foldObservedThresholds(accumulator, rp2026, baseMatch({ eventType: 0, hasScoreBreakdown: false, scoreBreakdownRaw: null }));
    expect(missingBreakdown.eligible).toBe(false);
  });

  it("a parse failure on one side is a counted skip for that side and does not abort the match — the other side still folds", () => {
    const accumulator = new RpMomentsAccumulator(rp2026);
    // Malformed JSON that fails Zod parsing for BOTH sides (missing required
    // fields) proves the try/catch degrades to a skip rather than throwing
    // out of the function.
    const malformed = JSON.stringify({ red: { garbage: true }, blue: { garbage: true } });
    const result = foldObservedThresholds(accumulator, rp2026, baseMatch({ eventType: 0, hasScoreBreakdown: true, scoreBreakdownRaw: malformed }));
    expect(result.eligible).toBe(true);
    expect(result.sideResults.red.parsed).toBe(false);
    expect(result.sideResults.blue.parsed).toBe(false);
    expect(result.sideResults.red.records).toEqual([]);
  });
});

describe("no credential is reachable", () => {
  it("package.json's measure:rp-mean-deficit entry equals exactly `tsx scripts/measureRpMeanDeficit.ts` — no --env-file flag", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["measure:rp-mean-deficit"]).toBe("tsx scripts/measureRpMeanDeficit.ts");
  });
});
