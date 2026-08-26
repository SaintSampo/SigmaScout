/**
 * TEAM-04/F-06-3 (plan 06.1-01): corpus-backed proof that a real TBA-sourced
 * event ranking travels end to end — `event_rankings` through
 * `selectEventRankingsForSeason` through `buildTeamSeasonArtifact` onto a
 * published `TeamSeasonEventSchema.rank`/`.totalTeams` pair. This is what
 * makes the tracer's end-to-end claim measurable rather than asserted.
 *
 * Corpus-gated (`data/corpus.sqlite`, gitignored, ~355MB): skips with an
 * explicit message naming the missing path when absent, mirroring
 * `digest.test.ts`'s guard shape — never a silent pass. The corpus IS
 * present on this machine (06.1-VALIDATION.md), so a skip here during this
 * phase's verification is a failure signal, not a pass.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openCorpusReadOnly, selectEventRankingsForSeason, type Corpus } from "../corpus/db.js";
import type { MatchResult, Prediction } from "../core/algorithms/types.js";
import { buildTeamSeasonArtifact } from "./publish.js";

const CORPUS_PATH = "data/corpus.sqlite";
const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);
const SEASON = 2024;
const MIN_EVENT_COUNT = 250;

/** A minimal, valid PredictionRecord match for the deterministically-chosen (event, team) pair — just enough to satisfy TeamSeasonMatchSchema. */
function minimalMatch(eventKey: string, teamKey: string): MatchResult {
  return {
    matchKey: `${eventKey}_qm1`,
    eventKey,
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 1,
    redTeams: [teamKey],
    blueTeams: ["frc0"],
    redSurrogates: [],
    blueSurrogates: [],
    eventType: 0,
    winner: "red",
    redScore: 1,
    blueScore: 0,
    redRpEarned: null,
    blueRpEarned: null,
    hasScoreBreakdown: false,
    scoreBreakdownRaw: null,
  };
}

function minimalPrediction(): Prediction {
  return { winner: "red", pRedWin: 0.5, redScore: 1, blueScore: 0 };
}

describe("event standing — corpus-backed end-to-end tracer (plan 06.1-01, Tasks 1 & 3)", () => {
  if (!CORPUS_AVAILABLE) {
    it.skip(
      `skipped: ${CORPUS_PATH} is absent — run pnpm ingest --year 2024 then pnpm ingest:rankings --year 2024 first`,
      () => {}
    );
    return;
  }

  let db: Corpus;
  try {
    db = openCorpusReadOnly(CORPUS_PATH);
  } catch (err) {
    it.skip(`skipped: could not open ${CORPUS_PATH} read-only — ${err instanceof Error ? err.message : String(err)}`, () => {});
    return;
  }

  const eventRankingsForSeason = selectEventRankingsForSeason(db, SEASON);
  db.close();

  it(`selectEventRankingsForSeason(db, ${SEASON}) returns at least ${MIN_EVENT_COUNT} distinct events`, () => {
    expect(eventRankingsForSeason.size).toBeGreaterThanOrEqual(MIN_EVENT_COUNT);
  });

  it("a deterministically chosen (event, team) pair round-trips its rank/totalTeams through buildTeamSeasonArtifact", () => {
    // Deterministic pair: sort the outer map's keys and take the first
    // event, then sort that event's inner map's keys and take the first
    // team key — stable across runs regardless of SQLite's own row order
    // (this plan's must_haves.truths: row order is never load-bearing).
    const eventKey = [...eventRankingsForSeason.keys()].sort()[0];
    expect(eventKey).toBeDefined();
    const teamRankings = eventRankingsForSeason.get(eventKey!)!;
    const teamKey = [...teamRankings.keys()].sort()[0];
    expect(teamKey).toBeDefined();
    const corpusRanking = teamRankings.get(teamKey!)!;

    const artifact = buildTeamSeasonArtifact({
      teamKey: teamKey!,
      teamNumber: 1,
      nickname: "Tracer Fixture",
      season: SEASON,
      algorithmId: "opr",
      algorithmVersion: "3.0.0+baseline",
      seasonStats: { record: { wins: 0, losses: 0, ties: 0 }, metrics: {} },
      events: [
        {
          eventKey: eventKey!,
          eventName: eventKey!,
          startDate: "",
          matches: [{ match: minimalMatch(eventKey!, teamKey!), prediction: minimalPrediction() }],
          rank: corpusRanking.rank,
          totalTeams: corpusRanking.totalTeams,
        },
      ],
      metricHistory: [],
      generation: "eventRank-tracer",
    });

    const publishedEvent = artifact.events[0];
    expect(publishedEvent).toBeDefined();
    expect(publishedEvent?.rank).toBe(corpusRanking.rank);
    expect(publishedEvent?.totalTeams).toBe(corpusRanking.totalTeams);
  });

  it("every stored event_rankings row for the season has rank >= 1 and totalTeams >= 1 (no fabricated standing)", () => {
    for (const teamRankings of eventRankingsForSeason.values()) {
      for (const ranking of teamRankings.values()) {
        expect(ranking.rank).toBeGreaterThanOrEqual(1);
        expect(ranking.totalTeams).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
