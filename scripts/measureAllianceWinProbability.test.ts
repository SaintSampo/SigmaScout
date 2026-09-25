/**
 * Two describes. The first is pure and synthetic and runs everywhere,
 * including CI. The second is corpus-guarded with `existsSync` plus an
 * explicit `it.skip`, exactly as `packages/core/districts/reconciliation.test.ts`
 * does, and re-measures the recorded window so a model change turns this red
 * rather than leaving a stale published number looking true.
 *
 * THE LOAD-BEARING TEST IN THE PURE HALF IS THE LEAK TEST. `beforeMatchSnapshot`
 * is the one place the walk-forward ordering lives; if it ever advanced before
 * it read, every figure this script prints would be better than the browser can
 * actually do and none of it would reproduce live.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import { scoreSet, type ScoredPrediction } from "../packages/core/scoring/brier.js";
import { standardNormalCdf } from "../packages/core/rankingPoints/marginals.js";
import { allianceWinProbability } from "../packages/core/algorithms/simulation/allianceWinProbability.js";
import type { MatchResult, Prediction } from "../packages/core/algorithms/types.js";
import {
  beforeMatchSnapshot,
  emptySnapshotState,
  type PublishedSprSnapshotRow,
  type PublishedTeamSnapshot,
} from "./publishedSprSnapshots.js";
import { parseSeasons } from "./scriptHelpers.js";
import {
  absoluteGapStats,
  ARM_NAMES,
  browserFormulaWithMultiplier,
  classifyRow,
  coinProbability,
  disagreeOnWinner,
  emptyCensus,
  MEASURED_BROWSER_FORMULA_ACCURACY,
  MEASURED_BROWSER_FORMULA_BRIER,
  MEASURED_COLD_START,
  MEASURED_COMMAND,
  MEASURED_FULLY_DEMO_MATCH,
  MEASURED_FULLY_DQ_ZERO_SCORE_SIDE,
  MEASURED_MEAN_ABSOLUTE_GAP,
  MEASURED_MEDIAN_ABSOLUTE_GAP,
  MEASURED_P90_ABSOLUTE_GAP,
  MEASURED_PUBLISHED_ACCURACY,
  MEASURED_PUBLISHED_BRIER,
  MEASURED_SCORED_ROWS,
  MEASURED_TOTAL_ROWS,
  MEASURED_UNPRICEABLE,
  MEASURED_WARMUP_FROM,
  MEASURED_WINDOW,
  MEASURED_WINNER_DISAGREEMENT_RATE,
  measureAllianceWinProbability,
  multiplierDiagnostic,
  scoreArms,
  signOnlyProbability,
  winnerDisagreementRate,
  type ScoredRow,
} from "./measureAllianceWinProbability.js";

const CORPUS_PATH = "data/corpus.sqlite";
const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);

// ───────────────────────────── fixtures ─────────────────────────────

function fakeMatch(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    matchKey: "2026test_qm1",
    eventKey: "2026test",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 1,
    redTeams: ["frc1", "frc2", "frc3"],
    blueTeams: ["frc4", "frc5", "frc6"],
    redSurrogates: [],
    blueSurrogates: [],
    eventType: 0,
    week: 1,
    winner: "red",
    redScore: 100,
    blueScore: 80,
    redRpEarned: 3,
    blueRpEarned: 0,
    redDqs: [],
    blueDqs: [],
    hasScoreBreakdown: true,
    scoreBreakdownRaw: null,
    ...overrides,
  };
}

function fakePrediction(pRedWin: number): Prediction {
  return { winner: pRedWin >= 0.5 ? "red" : "blue", pRedWin, redScore: 100, blueScore: 80 } as Prediction;
}

function snapshotFor(teams: readonly string[], total: number, sigma: number): Map<string, PublishedTeamSnapshot> {
  const map = new Map<string, PublishedTeamSnapshot>();
  for (const teamKey of teams) map.set(teamKey, { total, sigma });
  return map;
}

function fakeSnapshotRow(overrides: Partial<PublishedSprSnapshotRow> = {}): PublishedSprSnapshotRow {
  const match = overrides.match ?? fakeMatch();
  return {
    season: 2026,
    algorithmId: "spr",
    match,
    prediction: fakePrediction(0.7),
    before: snapshotFor([...match.redTeams, ...match.blueTeams], 30, 6),
    after: snapshotFor([...match.redTeams, ...match.blueTeams], 31, 6),
    ...overrides,
  };
}

// ───────────────────────────── the pure describe ─────────────────────────────

describe("beforeMatchSnapshot — the walk-forward leak test", () => {
  it("hands match k only values produced by matches STRICTLY BEFORE k", () => {
    const state = emptySnapshotState();
    const teams = ["frcA", "frcB"];

    // Match 1: first appearance for both teams.
    const before1 = beforeMatchSnapshot(
      state,
      teams,
      new Map([
        ["frcA", 10],
        ["frcB", 20],
      ]),
      new Map([
        ["frcA", 1],
        ["frcB", 2],
      ])
    );
    expect(before1.get("frcA")).toEqual({ total: undefined, sigma: undefined });
    expect(before1.get("frcB")).toEqual({ total: undefined, sigma: undefined });

    // Match 2: sees match 1's values.
    const before2 = beforeMatchSnapshot(
      state,
      teams,
      new Map([
        ["frcA", 11],
        ["frcB", 21],
      ]),
      new Map([
        ["frcA", 1.5],
        ["frcB", 2.5],
      ])
    );
    expect(before2.get("frcA")).toEqual({ total: 10, sigma: 1 });

    // Match 3: must see match 2's values, NOT its own.
    const before3 = beforeMatchSnapshot(
      state,
      teams,
      new Map([
        ["frcA", 12],
        ["frcB", 22],
      ]),
      new Map([
        ["frcA", 1.75],
        ["frcB", 2.75],
      ])
    );
    expect(before3.get("frcA")).toEqual({ total: 11, sigma: 1.5 });
    expect(before3.get("frcA")!.total).not.toBe(12);
    expect(before3.get("frcB")).toEqual({ total: 21, sigma: 2.5 });
    expect(before3.get("frcB")!.total).not.toBe(22);
  });

  it("counts a first-appearance team unpriceable rather than scoring it against a fabricated default", () => {
    const row = fakeSnapshotRow({ before: new Map() });
    const verdict = classifyRow(row);
    expect(verdict.kind).toBe("skipped");
    expect(verdict.kind === "skipped" && verdict.reason).toBe("unpriceable");
  });

  it("leaves a non-finite after-value out of the maps rather than poisoning a later snapshot", () => {
    const state = emptySnapshotState();
    beforeMatchSnapshot(state, ["frcA"], new Map([["frcA", Number.NaN]]), new Map([["frcA", Number.NaN]]));
    const next = beforeMatchSnapshot(state, ["frcA"], undefined, undefined);
    expect(next.get("frcA")).toEqual({ total: undefined, sigma: undefined });
  });
});

describe("arm construction", () => {
  it("signOnlyProbability is the clamp bound by sign, and exactly 0.5 for an exact tie in means", () => {
    expect(signOnlyProbability(12)).toBe(1 - 1e-6);
    expect(signOnlyProbability(-12)).toBe(1e-6);
    expect(signOnlyProbability(0)).toBe(0.5);
  });

  it("coinProbability is exactly 0.5, always", () => {
    expect(coinProbability()).toBe(0.5);
  });

  it("browserFormulaWithMultiplier at multiplier 1 is arithmetically identical to the shipped function", () => {
    // The `<baseline>` fixture: mean gap 1, combined variance 275.
    const red = [
      { teamKey: "frc1", total: 31, sigma: 6 },
      { teamKey: "frc2", total: 20, sigma: 8 },
      { teamKey: "frc3", total: 10, sigma: 10 },
    ];
    const blue = [
      { teamKey: "frc4", total: 25, sigma: 5 },
      { teamKey: "frc5", total: 20, sigma: 5 },
      { teamKey: "frc6", total: 15, sigma: 5 },
    ];
    expect(browserFormulaWithMultiplier(1, 275, 1)).toBe(allianceWinProbability(red, blue));
    // And multiplier 3 is the display band, which is a DIFFERENT number.
    expect(browserFormulaWithMultiplier(1, 275, 3)).toBeCloseTo(standardNormalCdf(1 / Math.sqrt(825)), 12);
  });

  it("disagreeOnWinner is about opposite sides of 0.5, and an exact 0.5 is an abstention rather than a disagreement", () => {
    expect(disagreeOnWinner(0.7, 0.3)).toBe(true);
    expect(disagreeOnWinner(0.3, 0.7)).toBe(true);
    expect(disagreeOnWinner(0.7, 0.6)).toBe(false);
    expect(disagreeOnWinner(0.7, 0.5)).toBe(false);
  });
});

describe("absoluteGapStats", () => {
  it("returns the hand-computed mean, median and p90 over an odd-length vector", () => {
    // sorted: 0.1 0.2 0.3 0.4 0.5 — mean 0.3, median 0.3, p90 index ceil(4.5)-1 = 4 → 0.5
    const stats = absoluteGapStats([0.3, 0.1, 0.5, 0.2, 0.4])!;
    expect(stats.mean).toBeCloseTo(0.3, 12);
    expect(stats.median).toBeCloseTo(0.3, 12);
    expect(stats.p90).toBeCloseTo(0.5, 12);
  });

  it("averages the two middle values for an even-length vector", () => {
    // sorted: 0.1 0.2 0.3 0.4 — median (0.2 + 0.3) / 2
    expect(absoluteGapStats([0.4, 0.1, 0.3, 0.2])!.median).toBeCloseTo(0.25, 12);
  });

  it("returns undefined — never NaN — for an empty vector", () => {
    expect(absoluteGapStats([])).toBeUndefined();
  });
});

describe("row gating — four distinct counters, each asserted separately", () => {
  it("a fully-demo match is excluded under fullyDemoMatch", () => {
    const match = fakeMatch({ redTeams: ["frc9970", "frc9971", "frc9972"] });
    const verdict = classifyRow(fakeSnapshotRow({ match }));
    expect(verdict.kind === "skipped" && verdict.reason).toBe("fullyDemoMatch");
  });

  it("a fully-DQ'd zero-score side is excluded under fullyDqZeroScoreSide", () => {
    const match = fakeMatch({ blueScore: 0, blueDqs: ["frc4", "frc5", "frc6"] });
    const verdict = classifyRow(fakeSnapshotRow({ match }));
    expect(verdict.kind === "skipped" && verdict.reason).toBe("fullyDqZeroScoreSide");
  });

  it("a coldStart record is excluded under coldStart — pRedWin was forced to exactly 0.5 there", () => {
    const verdict = classifyRow(fakeSnapshotRow({ coldStart: true, prediction: fakePrediction(0.5) }));
    expect(verdict.kind === "skipped" && verdict.reason).toBe("coldStart");
  });

  it("a row with any of the six teams unpriceable is excluded under unpriceable", () => {
    const before = snapshotFor(["frc1", "frc2", "frc3", "frc4", "frc5"], 30, 6);
    const verdict = classifyRow(fakeSnapshotRow({ before }));
    expect(verdict.kind === "skipped" && verdict.reason).toBe("unpriceable");
  });

  it("a clean row is scored and carries its mean difference and combined variance", () => {
    const before = new Map<string, PublishedTeamSnapshot>([
      ["frc1", { total: 31, sigma: 6 }],
      ["frc2", { total: 20, sigma: 8 }],
      ["frc3", { total: 10, sigma: 10 }],
      ["frc4", { total: 25, sigma: 5 }],
      ["frc5", { total: 20, sigma: 5 }],
      ["frc6", { total: 15, sigma: 5 }],
    ]);
    const verdict = classifyRow(fakeSnapshotRow({ before }));
    expect(verdict.kind).toBe("scored");
    if (verdict.kind !== "scored") return;
    expect(verdict.row.meanDifference).toBe(1);
    expect(verdict.row.combinedVariance).toBe(275);
    expect(verdict.row.browserFormula).toBeCloseTo(standardNormalCdf(1 / Math.sqrt(275)), 12);
    expect(verdict.row.actualWinner).toBe("red");
  });

  it("the census carries one counter per reason, never a lumped skipped count", () => {
    expect(Object.keys(emptyCensus()).sort()).toEqual(
      ["coldStart", "fullyDemoMatch", "fullyDqZeroScoreSide", "scored", "totalRows", "unpriceable"].sort()
    );
  });
});

describe("every arm is scored by scoreSet and nothing else", () => {
  const rows: ScoredRow[] = [
    { season: 2026, matchKey: "m1", meanDifference: 12, combinedVariance: 275, browserFormula: 0.8, published: 0.75, actualWinner: "red" },
    { season: 2026, matchKey: "m2", meanDifference: -12, combinedVariance: 275, browserFormula: 0.2, published: 0.3, actualWinner: "blue" },
    // A TIE row: excluded from accuracy, scored in Brier against 0.5.
    { season: 2026, matchKey: "m3", meanDifference: 4, combinedVariance: 275, browserFormula: 0.6, published: 0.55, actualWinner: "tie" },
    // An exact-0.5 row: a NO-CALL against a decided match, counted incorrect.
    { season: 2026, matchKey: "m4", meanDifference: 0, combinedVariance: 275, browserFormula: 0.5, published: 0.5, actualWinner: "red" },
  ];

  it("reproduces a direct scoreSet call on the same rows, for every arm, including the tie and the no-call", () => {
    const arms = scoreArms(rows);
    const expectedBrowser: ScoredPrediction[] = rows.map((r) => ({ pRedWin: r.browserFormula, actualWinner: r.actualWinner }));
    const expectedPublished: ScoredPrediction[] = rows.map((r) => ({ pRedWin: r.published, actualWinner: r.actualWinner }));
    const expectedCoin: ScoredPrediction[] = rows.map((r) => ({ pRedWin: 0.5, actualWinner: r.actualWinner }));
    const expectedSign: ScoredPrediction[] = rows.map((r) => ({
      pRedWin: signOnlyProbability(r.meanDifference),
      actualWinner: r.actualWinner,
    }));
    expect(arms["browser-formula"]).toEqual(scoreSet(expectedBrowser));
    expect(arms.published).toEqual(scoreSet(expectedPublished));
    expect(arms.coin).toEqual(scoreSet(expectedCoin));
    expect(arms["sign-only"]).toEqual(scoreSet(expectedSign));
  });

  it("carries the tie and the no-call through as brier.ts defines them", () => {
    const arms = scoreArms(rows);
    expect(arms["browser-formula"].tieCount).toBe(1);
    expect(arms["browser-formula"].noCallCount).toBe(1);
    expect(arms["browser-formula"].count).toBe(4);
    // The no-call row is in the accuracy denominator and counted incorrect;
    // the tie row is excluded from it entirely. 3 decided rows, 2 correct.
    expect(arms["browser-formula"].winnerAccuracy).toBeCloseTo(2 / 3, 12);
  });

  it("names exactly four arms", () => {
    expect([...ARM_NAMES]).toEqual(["browser-formula", "published", "coin", "sign-only"]);
  });

  it("winnerDisagreementRate counts only opposite-side rows and returns undefined for an empty set", () => {
    expect(winnerDisagreementRate([])).toBeUndefined();
    expect(winnerDisagreementRate(rows)).toBe(0);
  });

  it("the multiplier diagnostic reports all three multipliers", () => {
    expect(multiplierDiagnostic(rows).map((r) => r.multiplier)).toEqual([1, 2, 3]);
  });
});

describe("the recorded constants are internally consistent", () => {
  it("every recorded rate is finite and inside [0, 1]", () => {
    const rates = [
      MEASURED_MEAN_ABSOLUTE_GAP,
      MEASURED_MEDIAN_ABSOLUTE_GAP,
      MEASURED_P90_ABSOLUTE_GAP,
      MEASURED_WINNER_DISAGREEMENT_RATE,
      MEASURED_BROWSER_FORMULA_BRIER,
      MEASURED_PUBLISHED_BRIER,
      MEASURED_BROWSER_FORMULA_ACCURACY,
      MEASURED_PUBLISHED_ACCURACY,
    ];
    for (const rate of rates) {
      expect(Number.isFinite(rate)).toBe(true);
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1);
    }
  });

  it("MEASURED_WINDOW is a season spec parseSeasons accepts, and the command names the same window", () => {
    expect(parseSeasons(MEASURED_WINDOW).length).toBeGreaterThan(0);
    expect(MEASURED_COMMAND).toContain(`--seasons ${MEASURED_WINDOW}`);
    expect(MEASURED_COMMAND).toContain(`--warmup-from ${MEASURED_WARMUP_FROM}`);
    expect(MEASURED_COMMAND).toContain("scripts/measureAllianceWinProbability.ts");
  });

  it("the census constants add up to the recorded total", () => {
    expect(
      MEASURED_SCORED_ROWS + MEASURED_FULLY_DEMO_MATCH + MEASURED_FULLY_DQ_ZERO_SCORE_SIDE + MEASURED_COLD_START + MEASURED_UNPRICEABLE
    ).toBe(MEASURED_TOTAL_ROWS);
  });
});

// ───────────────────────── the corpus-guarded describe ─────────────────────────

describe("fresh measurement against the recorded constants", () => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} not found -- run the ingest pipeline (pnpm ingest) first`, () => {});
    return;
  }

  it(`re-measures ${MEASURED_WINDOW} and reproduces every recorded constant within 1e-4`, () => {
    const db = openCorpusReadOnly(CORPUS_PATH);
    let result: ReturnType<typeof measureAllianceWinProbability>;
    try {
      result = measureAllianceWinProbability(db, { seasons: parseSeasons(MEASURED_WINDOW), warmupFrom: MEASURED_WARMUP_FROM });
    } finally {
      db.close();
    }

    const rows = result.pooledRows;
    const census = result.pooledCensus;
    const stats = absoluteGapStats(rows.map((r) => Math.abs(r.browserFormula - r.published)))!;
    const arms = scoreArms(rows);

    // The replay is deterministic — no RNG anywhere on this path — so 1e-4
    // covers platform float drift in exp/log and nothing else.
    expect(stats.mean).toBeCloseTo(MEASURED_MEAN_ABSOLUTE_GAP, 4);
    expect(stats.median).toBeCloseTo(MEASURED_MEDIAN_ABSOLUTE_GAP, 4);
    expect(stats.p90).toBeCloseTo(MEASURED_P90_ABSOLUTE_GAP, 4);
    expect(winnerDisagreementRate(rows)!).toBeCloseTo(MEASURED_WINNER_DISAGREEMENT_RATE, 4);
    expect(arms["browser-formula"].brierScore!).toBeCloseTo(MEASURED_BROWSER_FORMULA_BRIER, 4);
    expect(arms.published.brierScore!).toBeCloseTo(MEASURED_PUBLISHED_BRIER, 4);
    expect(arms["browser-formula"].winnerAccuracy!).toBeCloseTo(MEASURED_BROWSER_FORMULA_ACCURACY, 4);
    expect(arms.published.winnerAccuracy!).toBeCloseTo(MEASURED_PUBLISHED_ACCURACY, 4);

    // The census is pinned exactly: these are integer counts.
    expect(census.scored).toBe(MEASURED_SCORED_ROWS);
    expect(census.totalRows).toBe(MEASURED_TOTAL_ROWS);
    expect(census.fullyDemoMatch).toBe(MEASURED_FULLY_DEMO_MATCH);
    expect(census.fullyDqZeroScoreSide).toBe(MEASURED_FULLY_DQ_ZERO_SCORE_SIDE);
    expect(census.coldStart).toBe(MEASURED_COLD_START);
    expect(census.unpriceable).toBe(MEASURED_UNPRICEABLE);

    // Non-vacuity: a pin that passes on nine rows pins nothing, and the
    // unpriceable share must stay a stated minority of the whole.
    expect(census.scored).toBeGreaterThan(5000);
    expect(census.unpriceable / census.totalRows).toBeLessThan(0.1);
  });
});
