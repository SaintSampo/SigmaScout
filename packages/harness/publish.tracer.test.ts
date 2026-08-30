/**
 * `buildEventArtifact` / `artifactKey` tracer coverage (plan 04-01 Task 3).
 * No network, no corpus — `buildEventArtifact` is a pure function and
 * `artifactKey` is a pure string builder, so this suite proves the assembly
 * and key-scheme logic without touching R2 or `data/corpus.sqlite`. The
 * real end-to-end round trip (a genuine `pnpm publish:artifacts` run against
 * production R2, fetched back over HTTPS) is recorded in the SUMMARY, not
 * re-run here on every `pnpm test`.
 */
import { describe, expect, it } from "vitest";
import type { MatchResult, Prediction } from "../core/algorithms/types.js";
import type { PredictionRecord } from "./replay.js";
import { buildEventArtifact } from "./publish.js";
import { artifactKey, EventArtifactSchema, MissingVersionSeparatorError, PAGE_ARTIFACT_SCHEMA_VERSION } from "./pageArtifacts.js";

function fixtureMatch(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    matchKey: "2026casj_qm1",
    eventKey: "2026casj",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 1,
    redTeams: ["frc254", "frc1678", "frc971"],
    blueTeams: ["frc604", "frc2054", "frc1323"],
    redSurrogates: [],
    blueSurrogates: [],
    eventType: 0,
    winner: "red",
    redScore: 120,
    blueScore: 95,
    redRpEarned: 2,
    blueRpEarned: 0,
    redDqs: [],
    blueDqs: [],
    hasScoreBreakdown: true,
    scoreBreakdownRaw: "{}",
    ...overrides,
  };
}

function fixturePrediction(overrides: Partial<Prediction> = {}): Prediction {
  return {
    winner: "red",
    pRedWin: 0.62,
    redScore: 110,
    blueScore: 100,
    ...overrides,
  };
}

describe("buildEventArtifact", () => {
  it("assembles a hand-built two-match fixture into an object that parses against EventArtifactSchema", () => {
    const predictions: PredictionRecord[] = [
      {
        match: fixtureMatch({ matchKey: "2026casj_qm1", matchNumber: 1 }),
        prediction: fixturePrediction({ pRedWin: 0.62 }),
      },
      {
        match: fixtureMatch({
          matchKey: "2026casj_qm2",
          matchNumber: 2,
          winner: "blue",
          redScore: 80,
          blueScore: 130,
          redTeams: ["frc254", "frc118", "frc1114"],
          blueTeams: ["frc971", "frc2910", "frc330"],
        }),
        prediction: fixturePrediction({ winner: "blue", pRedWin: 0.35, redScore: 90, blueScore: 115 }),
      },
    ];

    const artifact = buildEventArtifact({
      eventKey: "2026casj",
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "3.0.0+baseline",
      predictions,
      generation: "test-generation-1",
      computedAt: "2026-08-22T00:00:00.000Z",
    });

    const parsed = EventArtifactSchema.parse(artifact);
    expect(parsed.schemaVersion).toBe(PAGE_ARTIFACT_SCHEMA_VERSION);
    expect(parsed.eventKey).toBe("2026casj");
    expect(parsed.season).toBe(2026);
    expect(parsed.matches).toHaveLength(2);
    expect(parsed.upcoming).toEqual([]);
    expect(parsed.matches[0]?.matchKey).toBe("2026casj_qm1");
    expect(parsed.matches[1]?.actualWinner).toBe("blue");
  });
});

describe("artifactKey", () => {
  it("produces each of the five documented v1/ key shapes", () => {
    expect(artifactKey({ page: "teams", year: 2026, algorithmId: "opr", version: "3.0.0+baseline" })).toBe(
      "v1/teams/2026/opr@3.0.0+baseline.json"
    );
    expect(artifactKey({ page: "team", teamKey: "frc254", year: 2026, algorithmId: "opr", version: "3.0.0+baseline" })).toBe(
      "v1/team/frc254/2026/opr@3.0.0+baseline.json"
    );
    expect(artifactKey({ page: "events", year: 2026, algorithmId: "opr", version: "3.0.0+baseline" })).toBe(
      "v1/events/2026/opr@3.0.0+baseline.json"
    );
    expect(artifactKey({ page: "event", eventKey: "2026casj", algorithmId: "opr", version: "3.0.0+baseline" })).toBe(
      "v1/event/2026casj/opr@3.0.0+baseline.json"
    );
    expect(artifactKey({ page: "compare", year: 2026 })).toBe("v1/compare/2026.json");
  });

  it("throws a named error when the version string carries no '+' separator", () => {
    expect(() => artifactKey({ page: "event", eventKey: "2026casj", algorithmId: "opr", version: "3.0.0" })).toThrow(
      MissingVersionSeparatorError
    );
  });
});

describe("EventArtifactSchema validation gate (T-04-04)", () => {
  it("throws from the schema parse on a deliberately malformed artifact (missing generation) — proof a validation failure happens before any upload can occur", () => {
    const malformed = {
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      // generation deliberately omitted
      computedAt: "2026-08-22T00:00:00.000Z",
      algorithmId: "opr",
      algorithmVersion: "3.0.0+baseline",
      eventKey: "2026casj",
      season: 2026,
      matches: [],
      upcoming: [],
    };
    expect(() => EventArtifactSchema.parse(malformed)).toThrow();
  });
});
