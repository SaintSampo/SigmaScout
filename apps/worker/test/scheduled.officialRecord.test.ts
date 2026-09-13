/**
 * Quick task 260908-615: the live Worker's per-team merge writes an
 * OFFICIAL-ONLY `seasonStats.record`, matching what `publish.ts` writes
 * offline (`teamStatsOfficial`).
 *
 * Why this test exists rather than trusting the offline change alone: the
 * offline publisher and the live Worker write the SAME artifact. Scoping only
 * the publisher would leave the Worker re-adding offseason wins one tick at a
 * time, so a team's record would drift away from the published value between
 * republishes — a live/offline divergence with no loud failure, which is the
 * exact defect class this repo has already logged once (see
 * `project_worker_typecheck_preexisting_red` — a "cosmetic" DQ drift that
 * turned out to be a real live/offline split).
 *
 * The asymmetry pinned below is the whole point: an offseason match's match
 * row and metric-history row are still appended; only the summary record
 * skips it.
 */
import { describe, expect, it } from "vitest";
import { mergeTeamSeasonArtifact } from "../src/scheduled.js";
import {
  OFFSEASON_EVENT_TYPE,
  PRESEASON_EVENT_TYPE,
} from "../../../packages/core/algorithms/eventTypes.js";
import type { MatchResult, Prediction, TeamMetric } from "../../../packages/core/algorithms/types.js";
import { TeamSeasonArtifactSchema, type TeamSeasonArtifact } from "../../../packages/harness/pageArtifacts.js";

const TEAM = "frc1";
const SEASON = 2026;

function makeMatch(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    matchKey: "2026casj_qm1",
    eventKey: "2026casj",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 1,
    redTeams: [TEAM, "frc2", "frc3"],
    blueTeams: ["frc4", "frc5", "frc6"],
    redSurrogates: [],
    blueSurrogates: [],
    redDqs: [],
    blueDqs: [],
    winner: "red",
    redScore: 100,
    blueScore: 80,
    redRpEarned: 2,
    blueRpEarned: 0,
    hasScoreBreakdown: false,
    scoreBreakdownRaw: null,
    eventType: 0,
    week: null,
    ...overrides,
  };
}

function makePrediction(): Prediction {
  return { winner: "red", pRedWin: 0.6, redScore: 95, blueScore: 85 };
}

const METRICS: Readonly<Record<string, TeamMetric>> = { total: { value: 42 } };

/** Merges exactly one match into an empty artifact and returns the result. */
function mergeOne(match: MatchResult): TeamSeasonArtifact {
  return mergeTeamSeasonArtifact({
    existing: undefined,
    teamKey: TEAM,
    season: SEASON,
    algorithmId: "vpr",
    algorithmVersion: "11.0.0+rolling-2026-09e",
    eventKey: match.eventKey,
    matches: [match],
    predictions: new Map([[match.matchKey, makePrediction()]]),
    metrics: METRICS,
    matchIndexByKey: new Map([[match.matchKey, 0]]),
    bands: new Map(),
    sigmaAfterTick: undefined,
    stamp: { generation: "test-generation", computedAt: "2026-09-08T00:00:00.000Z" },
  }) as TeamSeasonArtifact;
}

describe("mergeTeamSeasonArtifact — official-only seasonStats.record (quick task 260908-615)", () => {
  it("folds an OFFICIAL match into the record, exactly as before", () => {
    const artifact = mergeOne(makeMatch({ eventType: 0 }));
    expect(artifact.seasonStats.record).toEqual({ wins: 1, losses: 0, ties: 0 });
  });

  it("folds an offseason match's rows but leaves the record untouched", () => {
    const artifact = mergeOne(
      makeMatch({ matchKey: "2026ex_qm1", eventKey: "2026ex", eventType: OFFSEASON_EVENT_TYPE })
    );

    expect(artifact.seasonStats.record, "an offseason win must not reach the summary record").toEqual({
      wins: 0,
      losses: 0,
      ties: 0,
    });
    // ...but the match itself is NOT hidden. This half is what makes the
    // change a re-scoping rather than a data drop.
    expect(artifact.events.find((e) => e.eventKey === "2026ex")?.matches).toHaveLength(1);
    expect(artifact.metricHistory).toHaveLength(1);
    expect(artifact.metricHistory[0]?.matchKey).toBe("2026ex_qm1");
  });

  it("leaves the record untouched for a preseason Week-0 match, which the corpus does not flag as offseason", () => {
    const artifact = mergeOne(
      makeMatch({ matchKey: "2026wk0_qm1", eventKey: "2026wk0", eventType: PRESEASON_EVENT_TYPE })
    );
    expect(artifact.seasonStats.record).toEqual({ wins: 0, losses: 0, ties: 0 });
    expect(artifact.events.find((e) => e.eventKey === "2026wk0")?.matches).toHaveLength(1);
  });

  it("counts a match whose event type is the -1 detail-fetch-failed sentinel, degrading toward keeping the record updated", () => {
    const artifact = mergeOne(makeMatch({ eventType: -1 }));
    expect(artifact.seasonStats.record).toEqual({ wins: 1, losses: 0, ties: 0 });
  });

  it("counts a loss and a tie at an official event, so the gate is not silently swallowing non-wins", () => {
    const lost = mergeOne(makeMatch({ winner: "blue" }));
    expect(lost.seasonStats.record).toEqual({ wins: 0, losses: 1, ties: 0 });

    const tied = mergeOne(makeMatch({ winner: "tie" }));
    expect(tied.seasonStats.record).toEqual({ wins: 0, losses: 0, ties: 1 });
  });

  it("preserves an existing record and adds only the official match on top of it", () => {
    const existing = mergeOne(makeMatch());
    const merged = mergeTeamSeasonArtifact({
      existing,
      teamKey: TEAM,
      season: SEASON,
      algorithmId: "vpr",
      algorithmVersion: "11.0.0+rolling-2026-09e",
      eventKey: "2026ex",
      matches: [makeMatch({ matchKey: "2026ex_qm1", eventKey: "2026ex", eventType: OFFSEASON_EVENT_TYPE })],
      predictions: new Map([["2026ex_qm1", makePrediction()]]),
      metrics: METRICS,
      matchIndexByKey: new Map([["2026ex_qm1", 1]]),
      bands: new Map(),
      sigmaAfterTick: undefined,
      stamp: { generation: "test-generation", computedAt: "2026-09-08T00:00:00.000Z" },
    }) as TeamSeasonArtifact;

    expect(merged.seasonStats.record, "the prior official win survives; the offseason one is not added").toEqual({
      wins: 1,
      losses: 0,
      ties: 0,
    });
    expect(merged.metricHistory).toHaveLength(2);
  });
});

/**
 * Quick task 260908-5wd: the live merge must PRESERVE every field the offline
 * publisher wrote and this tick does not own.
 *
 * Before this, `mergeTeamSeasonArtifact` constructed a fresh object naming
 * twelve fields, so the first live tick touching a team silently deleted its
 * rank cards, its robot photo, its active-years list and its per-team consistency figure —
 * for the rest of the event, until the next offline publish restored them.
 * There was no error and no log line; the team page simply got worse mid-event.
 */
describe("mergeTeamSeasonArtifact — preserves offline-published fields (quick task 260908-5wd)", () => {
  function existingArtifact(): TeamSeasonArtifact {
    return {
      schemaVersion: 1,
      generation: "offline-generation",
      computedAt: "2026-09-01T00:00:00.000Z",
      algorithmId: "vpr",
      algorithmVersion: "11.0.0+rolling-2026-09e",
      teamKey: TEAM,
      teamNumber: 1,
      nickname: "Offline Nickname",
      season: SEASON,
      seasonStats: { record: { wins: 5, losses: 1, ties: 0 }, metrics: { total: { value: 40 } } },
      events: [],
      metricHistory: [],
      // The publisher-owned fields a tick must not touch:
      legacyPerTeamField: 33.25,
      robotImageUrl: "https://example.test/robot.jpg",
      activeYears: [2024, 2025, 2026],
      ranks: { world: { rank: 7, total: 3706 } },
    } as unknown as TeamSeasonArtifact;
  }

  function mergeOnto(existing: TeamSeasonArtifact): TeamSeasonArtifact {
    const match = makeMatch();
    return mergeTeamSeasonArtifact({
      existing,
      teamKey: TEAM,
      season: SEASON,
      algorithmId: "vpr",
      algorithmVersion: "11.0.0+rolling-2026-09e",
      eventKey: match.eventKey,
      matches: [match],
      predictions: new Map([[match.matchKey, makePrediction()]]),
      metrics: METRICS,
      matchIndexByKey: new Map([[match.matchKey, 0]]),
      bands: new Map(),
      sigmaAfterTick: undefined,
      stamp: { generation: "live-generation", computedAt: "2026-09-08T00:00:00.000Z" },
    }) as TeamSeasonArtifact;
  }

  it("does not carry a stale artifact's retired or unknown per-team field forward (quick task 260913-g66)", () => {
    // `runTick` parses `existing` through `TeamSeasonArtifactSchema` before
    // merging, which strips the retired key; merging the parsed object is the
    // production path. `ranks` is dropped here only because this fixture's
    // loose shape is not what that test is about.
    const { ranks: _ranks, ...stale } = existingArtifact() as unknown as Record<string, unknown>;
    const parsed = TeamSeasonArtifactSchema.parse(stale);
    expect(parsed).not.toHaveProperty("legacyPerTeamField");
    expect(mergeOnto(parsed)).not.toHaveProperty("legacyPerTeamField");
    // The merge itself never writes one either.
    expect(mergeOne(makeMatch())).not.toHaveProperty("legacyPerTeamField");
  });

  it("keeps the robot photo, the active-years list and the rank scopes", () => {
    const merged = mergeOnto(existingArtifact()) as TeamSeasonArtifact & { activeYears?: readonly number[] };
    expect(merged.robotImageUrl).toBe("https://example.test/robot.jpg");
    expect(merged.activeYears).toEqual([2024, 2025, 2026]);
    expect(merged.ranks).toEqual({ world: { rank: 7, total: 3706 } });
  });

  it("still OVERRIDES every field the tick genuinely owns, so the spread cannot mask stale data", () => {
    const merged = mergeOnto(existingArtifact());
    // Stamp and record advance; the offline values must not survive.
    expect(merged.generation).toBe("live-generation");
    expect(merged.computedAt).toBe("2026-09-08T00:00:00.000Z");
    expect(merged.seasonStats.record).toEqual({ wins: 6, losses: 1, ties: 0 });
    expect(merged.seasonStats.metrics.total?.value).toBe(42);
    expect(merged.events).toHaveLength(1);
    expect(merged.metricHistory).toHaveLength(1);
  });

  it("is unchanged for a first-ever artifact, where there is nothing to preserve", () => {
    const artifact = mergeOne(makeMatch());
    expect(artifact).not.toHaveProperty("legacyPerTeamField");
    expect(artifact.teamNumber).toBe(1);
  });
});

/**
 * Quick task 260913-m45 Task 2: `sigmaAfterTick` — this team's Sigma Score at
 * the SAME instant as `metrics` (end of tick) — lands ONLY on this tick's
 * NEW metric-history rows, never on `seasonStats`, which keeps the
 * publisher's season-final, tiered entry (`touchedEventTeamMetrics` carries
 * it forward). A required parameter (may be `undefined`), so no caller can
 * opt out by omission.
 */
describe("mergeTeamSeasonArtifact — Sigma on appended history rows (quick task 260913-m45)", () => {
  it("appends sigma.value as the LAST key on every NEW history row when sigmaAfterTick is defined", () => {
    const match = makeMatch();
    const merged = mergeTeamSeasonArtifact({
      existing: undefined,
      teamKey: TEAM,
      season: SEASON,
      algorithmId: "spr",
      algorithmVersion: "3.0.0+baseline",
      eventKey: match.eventKey,
      matches: [match],
      predictions: new Map([[match.matchKey, makePrediction()]]),
      metrics: { total: { value: 42 } },
      matchIndexByKey: new Map([[match.matchKey, 0]]),
      bands: new Map(),
      stamp: { generation: "test-generation", computedAt: "2026-09-08T00:00:00.000Z" },
      sigmaAfterTick: 27.834,
    }) as TeamSeasonArtifact;

    expect(merged.metricHistory).toHaveLength(1);
    expect(merged.metricHistory[0]?.metrics).toEqual({ total: { value: 42 }, sigma: { value: 27.83 } });
    expect(Object.keys(merged.metricHistory[0]!.metrics).at(-1)).toBe("sigma");
  });

  it("appends no sigma key on new rows when sigmaAfterTick is undefined", () => {
    const match = makeMatch();
    const merged = mergeTeamSeasonArtifact({
      existing: undefined,
      teamKey: TEAM,
      season: SEASON,
      algorithmId: "opr",
      algorithmVersion: "1.0.0+baseline",
      eventKey: match.eventKey,
      matches: [match],
      predictions: new Map([[match.matchKey, makePrediction()]]),
      metrics: { total: { value: 42 } },
      matchIndexByKey: new Map([[match.matchKey, 0]]),
      bands: new Map(),
      stamp: { generation: "test-generation", computedAt: "2026-09-08T00:00:00.000Z" },
      sigmaAfterTick: undefined,
    }) as TeamSeasonArtifact;

    expect(merged.metricHistory).toHaveLength(1);
    expect(merged.metricHistory[0]?.metrics).toEqual({ total: { value: 42 } });
    expect(merged.metricHistory[0]?.metrics).not.toHaveProperty("sigma");
  });

  it("carries seasonStats.metrics.sigma forward UNCHANGED while the new row carries the live sigmaAfterTick value", () => {
    const existing = {
      schemaVersion: 1,
      generation: "offline-generation",
      computedAt: "2026-09-01T00:00:00.000Z",
      algorithmId: "spr",
      algorithmVersion: "3.0.0+baseline",
      teamKey: TEAM,
      teamNumber: 1,
      nickname: "",
      season: SEASON,
      seasonStats: { record: { wins: 5, losses: 1, ties: 0 }, metrics: { total: { value: 40 }, sigma: { value: 72.97, percentile: 1 } } },
      events: [],
      metricHistory: [
        { matchKey: "2026casj_qm0", season: SEASON, eventKey: "2026casj", algorithmId: "spr", teamKey: TEAM, matchIndex: 0, metrics: { total: { value: 39 } } },
        { matchKey: "2026casj_qm0b", season: SEASON, eventKey: "2026casj", algorithmId: "spr", teamKey: TEAM, matchIndex: 0, metrics: { total: { value: 39 }, sigma: { value: 70 } } },
      ],
    } as unknown as TeamSeasonArtifact;

    const match = makeMatch();
    const merged = mergeTeamSeasonArtifact({
      existing,
      teamKey: TEAM,
      season: SEASON,
      algorithmId: "spr",
      algorithmVersion: "3.0.0+baseline",
      eventKey: match.eventKey,
      matches: [match],
      predictions: new Map([[match.matchKey, makePrediction()]]),
      metrics: { total: { value: 42 } },
      matchIndexByKey: new Map([[match.matchKey, 1]]),
      bands: new Map(),
      stamp: { generation: "live-generation", computedAt: "2026-09-08T00:00:00.000Z" },
      sigmaAfterTick: 27.83,
    }) as TeamSeasonArtifact;

    expect(merged.seasonStats.metrics.sigma).toEqual({ value: 72.97, percentile: 1 });
    expect(merged.metricHistory).toHaveLength(3);
    // The two prior rows come back deep-equal to the input rows, sigma or no sigma.
    expect(merged.metricHistory[0]).toEqual(existing.metricHistory[0]);
    expect(merged.metricHistory[1]).toEqual(existing.metricHistory[1]);
    // The new row carries the live value.
    expect(merged.metricHistory[2]?.metrics).toEqual({ total: { value: 42 }, sigma: { value: 27.83 } });
  });
});
