import { describe, expect, it } from "vitest";
import { SIM_GEOMETRY } from "../../lib/simAxis.js";
import {
  buildRankDistributionRows,
  histBarHeight,
  MalformedRankHistogramError,
  medianDisplayRank,
  RANK_BAND_LABEL_PREFIX,
  rankBandLabel,
} from "./rankRows.js";
import type { SimResult } from "../../../../../packages/core/algorithms/simulation/rankSimulation.js";
import type { EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * 08-14-PLAN.md Task 1's TDD coverage: `medianDisplayRank`, `histBarHeight`
 * and `rankBandLabel` as isolated pure functions, then `buildRankDistributionRows`
 * regressed against sketch 005's three real histograms through the SHIPPED
 * path (`continuousQuantile` -> `simAxis.ts`'s `SIM_GEOMETRY` -> this row
 * builder), never a second hand-rolled estimator.
 */

type EventTeam = EventArtifact["teams"][number];

const TEAM_COUNT = 39;
const DRAWS = 1000;

/** Builds a full length-`TEAM_COUNT` histogram from a sparse `{rank: count}` map, asserting the total is exactly `DRAWS` BEFORE returning — a mis-transcribed fixture fails as a fixture error, never a math error. */
function histogramFromCounts(counts: Record<number, number>): Int32Array {
  const arr = new Int32Array(TEAM_COUNT);
  for (const [rank, count] of Object.entries(counts)) {
    arr[Number(rank) - 1] = count;
  }
  const sum = arr.reduce((a, b) => a + b, 0);
  if (sum !== DRAWS) {
    throw new Error(`histogramFromCounts: fixture sums to ${sum}, expected ${DRAWS} — mis-transcribed fixture`);
  }
  return arr;
}

/** A team locked entirely on one rank — the simplest valid, self-consistent filler histogram. */
function lockedHistogram(rank: number): Int32Array {
  return histogramFromCounts({ [rank]: DRAWS });
}

/**
 * Assembles a full `TEAM_COUNT`-team `SimResult`: the caller's named
 * `overrides` (team key -> histogram) plus enough locked filler teams to
 * reach `TEAM_COUNT` entries total, so every fixture is internally valid
 * (every histogram's length equals the result's own team count) without
 * every test having to hand-author 39 rows.
 */
function buildResult(overrides: Record<string, Int32Array>): SimResult {
  const rankHistograms = new Map<string, Int32Array>(Object.entries(overrides));
  let n = 0;
  while (rankHistograms.size < TEAM_COUNT) {
    const rank = (n % TEAM_COUNT) + 1;
    const key = `frcFiller${n}`;
    if (!rankHistograms.has(key)) rankHistograms.set(key, lockedHistogram(rank));
    n++;
  }
  return { rankHistograms, draws: DRAWS };
}

function team(overrides: Partial<EventTeam> = {}): EventTeam {
  return {
    teamKey: "frc254",
    teamNumber: 254,
    nickname: "The Cheesy Poofs",
    ...overrides,
  } as EventTeam;
}

// Sketch 005's three real histograms (08-04-SUMMARY.md's own recomputed
// figures), expanded to full length-39 arrays — the same fixtures
// `simAxis.test.ts` already uses for `rankBandExtent`.
const DIST_3467 = histogramFromCounts({ 1: 996, 2: 3, 3: 1 });
const DIST_95 = histogramFromCounts({ 1: 3, 2: 666, 3: 330, 5: 1 });
const DIST_4564 = histogramFromCounts({ 1: 1, 2: 330, 3: 574, 4: 87, 5: 8 });

describe("medianDisplayRank(medianRank, teamCount)", () => {
  it("rounds half-up: 3.5 at a 39-team roster yields 4, 3.4 yields 3, 3.49 yields 3", () => {
    expect(medianDisplayRank(3.5, 39)).toBe(4);
    expect(medianDisplayRank(3.4, 39)).toBe(3);
    expect(medianDisplayRank(3.49, 39)).toBe(3);
  });

  it("clamps into the roster: 0.6 yields 1 and 39.4 yields 39 at a 39-team roster", () => {
    expect(medianDisplayRank(0.6, 39)).toBe(1);
    expect(medianDisplayRank(39.4, 39)).toBe(39);
  });

  it("39.5 also yields 39 rather than the out-of-range 40 a bare rounding would produce", () => {
    expect(medianDisplayRank(39.5, 39)).toBe(39);
  });

  it("returns a finite integer for a degenerate roster of 1", () => {
    const value = medianDisplayRank(1, 1);
    expect(Number.isFinite(value)).toBe(true);
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBe(1);
  });
});

describe("histBarHeight(count, maxBinCount)", () => {
  it("a count equal to the row's modal count returns exactly SIM_GEOMETRY.HIST_BAR_MAX_H", () => {
    expect(histBarHeight(1000, 1000)).toBe(SIM_GEOMETRY.HIST_BAR_MAX_H);
  });

  it("a single draw against a modal count of 1000 returns exactly 1 (the floor, not 0.032) — a rank any draw reached still paints", () => {
    expect(histBarHeight(1, 1000)).toBe(1);
  });

  it("a count of 0 returns 0 — a rank no draw reached emits no bar at all", () => {
    expect(histBarHeight(0, 1000)).toBe(0);
  });

  it("never exceeds SIM_GEOMETRY.HIST_BAR_MAX_H and never returns a non-finite value, including when maxBinCount is 0", () => {
    expect(histBarHeight(5, 0)).toBeLessThanOrEqual(SIM_GEOMETRY.HIST_BAR_MAX_H);
    expect(Number.isFinite(histBarHeight(5, 0))).toBe(true);
    expect(histBarHeight(1000, 1000)).toBeLessThanOrEqual(SIM_GEOMETRY.HIST_BAR_MAX_H);
  });
});

describe("rankBandLabel(p10, p90)", () => {
  it("returns the exact strings for sketch 005's three worked examples, including the en-dash separators", () => {
    expect(rankBandLabel(0.600402, 1.403614)).toBe("10th–90th: 0.6–1.4");
    expect(rankBandLabel(1.645646, 3.2)).toBe("10th–90th: 1.6–3.2");
    expect(rankBandLabel(1.8, 3.491289)).toBe("10th–90th: 1.8–3.5");
  });

  it("never contains the plus-minus glyph (U+00B1), asserted on the string's own code points", () => {
    const label = rankBandLabel(1.6, 3.2);
    expect(Array.from(label).some((char) => char.codePointAt(0) === 0xb1)).toBe(false);
  });

  it("teams 95 and 4564 return DIFFERENT labels — integer snapping collapsed both into the identical '2-3'", () => {
    expect(rankBandLabel(1.645646, 3.2)).not.toBe(rankBandLabel(1.8, 3.491289));
  });

  it("starts with RANK_BAND_LABEL_PREFIX", () => {
    expect(rankBandLabel(1, 2).startsWith(RANK_BAND_LABEL_PREFIX)).toBe(true);
  });
});

describe("buildRankDistributionRows(result, teams)", () => {
  it("reaches sketch 005's three worked examples' p10/p90 to six decimal places THROUGH the shipped row builder", () => {
    const result = buildResult({ frc3467: DIST_3467, frc95: DIST_95, frc4564: DIST_4564 });
    const teams = [team({ teamKey: "frc3467", teamNumber: 3467, nickname: "Team A" }), team({ teamKey: "frc95", teamNumber: 95, nickname: "Team B" }), team({ teamKey: "frc4564", teamNumber: 4564, nickname: "Team C" })];
    const rows = buildRankDistributionRows(result, teams);
    const byKey = new Map(rows.map((row) => [row.teamKey, row]));

    expect(byKey.get("frc3467")!.p10).toBeCloseTo(0.600402, 6);
    expect(byKey.get("frc3467")!.p90).toBeCloseTo(1.403614, 6);
    expect(byKey.get("frc95")!.p10).toBeCloseTo(1.645646, 6);
    expect(byKey.get("frc95")!.p90).toBeCloseTo(3.2, 6);
    expect(byKey.get("frc4564")!.p10).toBeCloseTo(1.8, 6);
    expect(byKey.get("frc4564")!.p90).toBeCloseTo(3.491289, 6);
  });

  it("a LOCKED row (all 1000 draws on rank 7 of 39) yields p10 6.6, p90 7.4, continuous median exactly 7, display median 7, band width exactly 0.8 — integer snapping renders this row as a zero-width invisible band", () => {
    const result = buildResult({ frc1: lockedHistogram(7) });
    const rows = buildRankDistributionRows(result, [team({ teamKey: "frc1", teamNumber: 1 })]);
    const row = rows.find((r) => r.teamKey === "frc1")!;
    expect(row.p10).toBeCloseTo(6.6, 10);
    expect(row.p90).toBeCloseTo(7.4, 10);
    expect(row.medianRank).toBe(7);
    expect(row.medianDisplay).toBe(7);
    expect(row.p90 - row.p10).toBeCloseTo(0.8, 10);
  });

  it("a BIMODAL row (500 draws on rank 3, 500 on rank 4, of 39) yields a continuous median of exactly 3.5 and a display median of 4 — the tick and the printed integer sit apart here by design", () => {
    const result = buildResult({ frc1: histogramFromCounts({ 3: 500, 4: 500 }) });
    const rows = buildRankDistributionRows(result, [team({ teamKey: "frc1", teamNumber: 1 })]);
    const row = rows.find((r) => r.teamKey === "frc1")!;
    expect(row.medianRank).toBe(3.5);
    expect(row.medianDisplay).toBe(4);
  });

  it("maxBinCount equals the row's largest single-rank draw count", () => {
    const result = buildResult({ frc1: DIST_95 });
    const rows = buildRankDistributionRows(result, [team({ teamKey: "frc1" })]);
    expect(rows.find((r) => r.teamKey === "frc1")!.maxBinCount).toBe(666);
  });

  it("sort order: ascending by CONTINUOUS median; two rows with equal display medians (4) but different continuous medians (~3.667 vs exactly 4.0) come out in that order", () => {
    const result = buildResult({
      frcLow: histogramFromCounts({ 3: 400, 4: 600 }), // continuousQuantile median ~3.667
      frcHigh: lockedHistogram(4), // continuousQuantile median exactly 4.0
    });
    const rows = buildRankDistributionRows(result, [team({ teamKey: "frcLow" }), team({ teamKey: "frcHigh" })]);
    const low = rows.find((r) => r.teamKey === "frcLow")!;
    const high = rows.find((r) => r.teamKey === "frcHigh")!;
    expect(low.medianRank).toBeLessThan(high.medianRank);
    expect(low.medianDisplay).toBe(4);
    expect(high.medianDisplay).toBe(4);
    expect(rows.indexOf(low)).toBeLessThan(rows.indexOf(high));
  });

  it("exact continuous-median ties order by team key ascending, a total tie-break not a reliance on input order (reversing the input does not change the output)", () => {
    const result = buildResult({ frcB: lockedHistogram(5), frcA: lockedHistogram(5) });
    const rowsForward = buildRankDistributionRows(result, [team({ teamKey: "frcA" }), team({ teamKey: "frcB" })]);
    const rowsReversed = buildRankDistributionRows(result, [team({ teamKey: "frcB" }), team({ teamKey: "frcA" })]);
    const forwardOrder = rowsForward.filter((r) => r.teamKey === "frcA" || r.teamKey === "frcB").map((r) => r.teamKey);
    const reversedOrder = rowsReversed.filter((r) => r.teamKey === "frcA" || r.teamKey === "frcB").map((r) => r.teamKey);
    expect(forwardOrder).toEqual(["frcA", "frcB"]);
    expect(reversedOrder).toEqual(["frcA", "frcB"]);
  });

  it("roster join: a team present in teams[] carries its teamNumber and nickname", () => {
    const result = buildResult({ frc254: lockedHistogram(1) });
    const rows = buildRankDistributionRows(result, [team({ teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs" })]);
    const row = rows.find((r) => r.teamKey === "frc254")!;
    expect(row.teamNumber).toBe(254);
    expect(row.nickname).toBe("The Cheesy Poofs");
  });

  it("a team key present in the result but ABSENT from teams[] still produces a row, number recovered through teamNumberFromKey and an undefined nickname (RESEARCH assumption A2)", () => {
    const result = buildResult({ frc1114: lockedHistogram(1) });
    const rows = buildRankDistributionRows(result, []);
    const row = rows.find((r) => r.teamKey === "frc1114")!;
    expect(row).toBeDefined();
    expect(row.teamNumber).toBe(1114);
    expect(row.nickname).toBeUndefined();
  });

  it("a team present in teams[] with no nickname produces a row with an undefined nickname", () => {
    const result = buildResult({ frc118: lockedHistogram(1) });
    const rows = buildRankDistributionRows(result, [{ teamKey: "frc118", teamNumber: 118 } as EventTeam]);
    const row = rows.find((r) => r.teamKey === "frc118")!;
    expect(row.nickname).toBeUndefined();
  });

  it("row count equals the number of histograms in the result, and teamCount on every row equals that same number — never teams.length", () => {
    const result = buildResult({ frc1: lockedHistogram(1) });
    const rows = buildRankDistributionRows(result, [team({ teamKey: "frc1" }), team({ teamKey: "frcExtraNotInResult" })]);
    expect(rows).toHaveLength(TEAM_COUNT);
    for (const row of rows) expect(row.teamCount).toBe(TEAM_COUNT);
  });

  it("throws MalformedRankHistogramError, naming the offending team key, when a histogram's length disagrees with the result's team count", () => {
    const rankHistograms = new Map<string, Int32Array>([
      ["frcBad", new Int32Array(TEAM_COUNT - 1)],
      ...Array.from({ length: TEAM_COUNT - 1 }, (_, i) => [`frcFiller${i}`, lockedHistogram((i % TEAM_COUNT) + 1)] as const),
    ]);
    const result: SimResult = { rankHistograms, draws: DRAWS };
    expect(() => buildRankDistributionRows(result, [])).toThrow(MalformedRankHistogramError);
    try {
      buildRankDistributionRows(result, []);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedRankHistogramError);
      expect((err as Error).message).toContain("frcBad");
    }
  });

  it("throws MalformedRankHistogramError, naming the offending team key, when a histogram's entries do not sum to draws", () => {
    const badHistogram = new Int32Array(TEAM_COUNT);
    badHistogram[0] = 999; // sums to 999, not DRAWS (1000)
    const rankHistograms = new Map<string, Int32Array>([
      ["frcBad", badHistogram],
      ...Array.from({ length: TEAM_COUNT - 1 }, (_, i) => [`frcFiller${i}`, lockedHistogram((i % TEAM_COUNT) + 1)] as const),
    ]);
    const result: SimResult = { rankHistograms, draws: DRAWS };
    try {
      buildRankDistributionRows(result, []);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedRankHistogramError);
      expect((err as Error).message).toContain("frcBad");
    }
  });

  it("mutates neither result nor teams: the input histogram's contents are unchanged after a call", () => {
    const histogram = histogramFromCounts({ 1: 3, 2: 666, 3: 330, 5: 1 });
    const before = Array.from(histogram);
    const result = buildResult({ frc95: histogram });
    const teams = [team({ teamKey: "frc95" })];
    const teamsBefore = JSON.parse(JSON.stringify(teams));
    buildRankDistributionRows(result, teams);
    expect(Array.from(histogram)).toEqual(before);
    expect(teams).toEqual(teamsBefore);
  });
});
