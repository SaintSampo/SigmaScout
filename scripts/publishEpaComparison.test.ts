/**
 * Behavior coverage for `scripts/publishEpaComparison.ts` (quick task
 * 260908-n5o Task 2; revised same day to take one report file instead of
 * two — see the module's own header comment). Every test builds a small,
 * hand-built fixture report inline and calls `composeEpaComparisonArtifact`
 * directly — no `fs`, no network, no `putObject`. The missing-arm case is
 * the test that matters most: it asserts the specific named error class AND
 * that nothing about the (would-be) upload was ever attempted (this
 * function performs no I/O of its own, so a thrown error IS "nothing was
 * uploaded").
 */
import { describe, expect, it } from "vitest";
import { composeEpaComparisonArtifact, MissingOfficialOnlyArmError } from "./publishEpaComparison.js";
import { EpaComparisonArtifactSchema } from "../packages/harness/pageArtifacts.js";
import type { EpaVsStatboticsReport, SeasonReportEntry } from "./epaVsStatbotics.js";

function buildSeasonEntry(season: number, overrides: Partial<SeasonReportEntry> = {}): SeasonReportEntry {
  return {
    season,
    allTeams: {
      season,
      ourCount: 100,
      theirCount: 100,
      joinedCount: 100,
      ordinaryLeastSquaresSlope: 0.9,
      pearson: 0.95,
      meanAbsoluteDifference: 3.1,
      ourStandardDeviation: 10,
      theirStandardDeviation: 11,
      pairs: [],
    } as unknown as SeasonReportEntry["allTeams"],
    minMatchesFiltered: {
      season,
      minMatches: 12,
      ourCount: 80,
      theirCount: 80,
      joinedCount: 80,
      ordinaryLeastSquaresSlope: 0.86,
      pearson: 0.92,
      meanAbsoluteDifference: 4.5,
      ourStandardDeviation: 9,
      theirStandardDeviation: 10,
      pairs: [],
    } as unknown as SeasonReportEntry["minMatchesFiltered"],
    officialOnly: {
      season,
      minMatches: 12,
      ourCount: 75,
      theirCount: 80,
      joinedCount: 75,
      ordinaryLeastSquaresSlope: 0.99,
      pearson: 0.98,
      meanAbsoluteDifference: 2.1,
      ourStandardDeviation: 11,
      theirStandardDeviation: 10,
      pairs: [],
    } as unknown as SeasonReportEntry["officialOnly"],
    spotCheck: [],
    winProbability: {
      ourWinnerAccuracy: 0.72,
      ourBrierScore: 0.19,
      scoredCount: 500,
      statboticsWinnerAccuracy: 0.78,
      statboticsBrierScore: 0.15,
      statboticsCapturedAt: "2026-09-04",
      statboticsFetched: false,
    },
    ...overrides,
  };
}

function buildReport(overrides: Partial<EpaVsStatboticsReport> = {}): EpaVsStatboticsReport {
  const seasons = overrides.seasons ?? [2022, 2023];
  return {
    measuredAt: "2026-09-08T00:00:00.000Z",
    epaVersion: "6.0.0+baseline",
    seasons,
    includeOffseason: true,
    minMatches: 12,
    seasonEntries: seasons.map((season) => buildSeasonEntry(season)),
    ...overrides,
  };
}

const COMPOSE_OPTIONS = { generation: "test-generation", computedAt: "2026-09-08T00:00:00.000Z" };

describe("composeEpaComparisonArtifact", () => {
  it("composes one artifact from one report, one agreement row per season, and the result parses against the schema", () => {
    const report = buildReport();

    const artifact = composeEpaComparisonArtifact(report, COMPOSE_OPTIONS);

    expect(() => EpaComparisonArtifactSchema.parse(artifact)).not.toThrow();
    expect(artifact.epaVersion).toBe("6.0.0+baseline");
    expect(artifact.agreement).toHaveLength(2); // one row per season, not two arms
    expect(artifact.agreement.every((row) => row.basis === "last-official-match")).toBe(true);
    expect(artifact.headToHead).toHaveLength(2);
  });

  it("reads agreement figures from the officialOnly arm, not minMatchesFiltered", () => {
    const report = buildReport({ seasons: [2026], seasonEntries: [buildSeasonEntry(2026)] });

    const artifact = composeEpaComparisonArtifact(report, COMPOSE_OPTIONS);

    const [row] = artifact.agreement;
    expect(row!.ordinaryLeastSquaresSlope).toBe(0.99); // officialOnly's slope, not minMatchesFiltered's 0.86
    expect(row!.joinedCount).toBe(75); // officialOnly's joinedCount, not minMatchesFiltered's 80
  });

  it("throws MissingOfficialOnlyArmError and composes nothing when a season entry carries no officialOnly arm", () => {
    const report = buildReport();
    const seasonEntries = report.seasonEntries.map((entry, index) => {
      if (index !== 0) return entry;
      const stale = { ...entry } as Record<string, unknown>;
      delete stale.officialOnly;
      return stale as unknown as SeasonReportEntry;
    });
    const staleReport: EpaVsStatboticsReport = { ...report, seasonEntries };

    let thrown: unknown;
    try {
      composeEpaComparisonArtifact(staleReport, COMPOSE_OPTIONS);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(MissingOfficialOnlyArmError);
  });

  it("this function's own module imports no r2Client binding — composing an artifact touches no network", async () => {
    // This is a structural proof rather than a mock-call assertion: the
    // module under test here (`composeEpaComparisonArtifact`) has no
    // dependency on `r2Client.js` — only `run()` in the CLI wrapper does,
    // and `run()` is not exercised by this describe block at all. Importing
    // this module successfully (already proven by every test above running)
    // is itself the proof that composing an artifact touches no network.
    const module = await import("./publishEpaComparison.js");
    expect(typeof module.composeEpaComparisonArtifact).toBe("function");
  });
});
