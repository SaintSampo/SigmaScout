/**
 * A live-folded played row must equal the offline publisher's row for the
 * same match: same keys, same values. The v1.0 milestone audit recorded this
 * as an open gap (live rows carried no `actualRedRp`/`actualBlueRp`, no actual
 * bonus flags, no `sortTime`, no `ScoreVarianceOwn` pair and no `video`), and
 * the simulation sums `actualRedRp`, so a live row that under-counts RP moves
 * a rank band.
 *
 * `coldStart` is the ONE tested exception: offline it comes from
 * `corpusColdStartIndex`, a corpus-global first-appearance index the Worker
 * has no access to. A D1 team-row presence check is an unproven proxy, and
 * publishing it under a name that asserts corpus-global provenance would be a
 * false attribution — so live rows carry no `coldStart` key at all, which this
 * file pins rather than tolerates.
 *
 * WHY THE PUBLISHER IS LOADED BY RUNTIME `import()` ONLY: a static or
 * type-only import of `packages/harness/publish.ts` adds it to the Worker's
 * tsc program, where `packages/harness/r2Client.ts` fails under
 * workers-types. A non-literal `import()` specifier keeps it out.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mergeEventArtifact, mergeTeamSeasonArtifact, playedRowFactsFor } from "../src/scheduled.js";
import { spr } from "../../../packages/core/algorithms/spr.js";
import { tbaMatchListSchema } from "../../../packages/ingest/schemas.js";
import { normalizeMatch, type CorpusMatch } from "../../../packages/ingest/normalize.js";
import type { MatchResult, Prediction } from "../../../packages/core/algorithms/types.js";
import {
  EventArtifactSchema,
  TeamSeasonArtifactSchema,
  type EventArtifact,
  type TeamSeasonArtifact,
} from "../../../packages/harness/pageArtifacts.js";

interface OfflinePublisher {
  buildEventArtifact(params: unknown): EventArtifact;
  buildTeamSeasonArtifact(params: unknown): TeamSeasonArtifact;
  actualBonusFlagsForSeason(stream: readonly MatchResult[], season: number): Map<string, unknown>;
}

// `.href`, not the `URL` object: this file typechecks under workers-types.
const publisher = (await import(fileURLToPath(new URL("../../../packages/harness/publish.ts", import.meta.url).href))) as OfflinePublisher;

/**
 * The published fields the Worker cannot derive, and why. `coldStart` is
 * corpus-global (`corpusColdStartIndex`); the tick has no corpus and must not
 * assert that provenance from a D1 row's presence.
 */
const LIVE_PLAYED_ROW_EXCEPTIONS = ["coldStart"] as const;

const SEASON = 2026;
const EVENT_KEY = "2026casj";
const EVENT_TYPE = 0;
const RED = ["frc1", "frc2", "frc3"];
const BLUE = ["frc4", "frc5", "frc6"];
const EVENT_START_ISO = "2026-03-05T00:00:00.000Z";
const STAMP = { generation: "gen-parity", computedAt: "2026-03-07T18:00:00.000Z" };
const QM_TIME_SEC = 1_772_900_000;
const VIDEO_KEY = "dQw4w9WgXcQ?t=42";

function json<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function breakdownSide(hub: number, tower: number, rp: number) {
  return {
    rp,
    autoTowerPoints: Math.round(tower / 2),
    endGameTowerPoints: tower - Math.round(tower / 2),
    hubScore: { totalCount: hub },
    energizedAchieved: hub >= 100,
    superchargedAchieved: hub >= 360,
    traversalAchieved: tower >= 40,
  };
}

const BREAKDOWN = { red: breakdownSide(155, 45, 4), blue: breakdownSide(128, 38, 1) };

interface TbaFixture {
  readonly key: string;
  readonly compLevel: "qm" | "sf";
  readonly setNumber?: number;
  readonly matchNumber: number;
  readonly actualTimeSec?: number | null;
  readonly videos?: readonly { type: string; key: string }[];
  readonly breakdown?: unknown;
}

function tbaMatch(f: TbaFixture): unknown {
  return {
    key: f.key,
    event_key: EVENT_KEY,
    comp_level: f.compLevel,
    set_number: f.setNumber ?? 1,
    match_number: f.matchNumber,
    time: null,
    predicted_time: null,
    actual_time: f.actualTimeSec === undefined ? QM_TIME_SEC : f.actualTimeSec,
    winning_alliance: "red",
    alliances: {
      red: { team_keys: RED, surrogate_team_keys: [], dq_team_keys: [], score: 133 },
      blue: { team_keys: BLUE, surrogate_team_keys: [], dq_team_keys: [], score: 121 },
    },
    ...(f.videos !== undefined ? { videos: f.videos } : {}),
    score_breakdown: f.breakdown === undefined ? BREAKDOWN : f.breakdown,
  };
}

/** Exactly `scheduled.ts`'s own `toMatchResult`, which is not exported. */
function toMatchResult(match: CorpusMatch): MatchResult {
  return {
    matchKey: match.matchKey,
    eventKey: match.eventKey,
    compLevel: match.compLevel,
    setNumber: match.setNumber,
    matchNumber: match.matchNumber,
    redTeams: match.redTeams,
    blueTeams: match.blueTeams,
    redSurrogates: match.redSurrogates,
    blueSurrogates: match.blueSurrogates,
    redDqs: match.redDqs,
    blueDqs: match.blueDqs,
    eventType: EVENT_TYPE,
    week: null,
    winner: match.winner as "red" | "blue" | "tie",
    redScore: match.redScore!,
    blueScore: match.blueScore!,
    redRpEarned: match.redRpEarned,
    blueRpEarned: match.blueRpEarned,
    hasScoreBreakdown: match.hasScoreBreakdown,
    scoreBreakdownRaw: match.scoreBreakdownRaw,
  };
}

const PREDICTION: Prediction = {
  winner: "red",
  pRedWin: 0.6234,
  redScore: 128.456,
  blueScore: 119.321,
  variance: 412.5,
  redScoreVarianceOwn: 210.25,
  blueScoreVarianceOwn: 198.75,
  redRpPmf: [0.1, 0.2, 0.3, 0.4],
  blueRpPmf: [0.4, 0.3, 0.2, 0.1],
  matchOutcomePmf: [0.6, 0.05, 0.35],
  redBonusRpPmf: [0.2, 0.5, 0.3],
  blueBonusRpPmf: [0.3, 0.5, 0.2],
  redBonusRp: [0.612345, 0.234567, 0.101112],
  blueBonusRp: [0.512345, 0.334567, 0.201112],
  redOutcomeRp: [3, 1, 0],
  blueOutcomeRp: [0, 1, 3],
};
const MATCH_BAND = { red: 331.125, blue: 288.5 };

/** One fold's worth of shared inputs: the raw TBA list, the corpus rows and the MatchResults, from the SAME objects both arms read. */
function foldOf(fixtures: readonly TbaFixture[]) {
  const rawMatches = tbaMatchListSchema.parse(fixtures.map(tbaMatch));
  const folded = rawMatches.map((m) => normalizeMatch(m, EVENT_START_ISO));
  const results = folded.map(toMatchResult);
  const predictions = new Map(results.map((r) => [r.matchKey, PREDICTION]));
  const bands = new Map(results.map((r) => [r.matchKey, MATCH_BAND]));
  return { rawMatches, folded, results, predictions, bands };
}

function offlineLookups(fold: ReturnType<typeof foldOf>) {
  return {
    sortTimeByMatchKey: new Map(fold.folded.map((m) => [m.matchKey, m.sortTime])),
    videoByMatchKey: new Map(fold.folded.flatMap((m) => (m.videoKey !== null ? [[m.matchKey, m.videoKey] as const] : []))),
    actualBonusFlagsByMatchKey: publisher.actualBonusFlagsForSeason(fold.results, SEASON),
  };
}

function offlineRecords(fold: ReturnType<typeof foldOf>) {
  return fold.results.map((match) => ({
    match,
    prediction: PREDICTION,
    matchBand: MATCH_BAND,
    // Offline knows this from the corpus-global cold-start index; the Worker cannot.
    ...(match.compLevel === "qm" ? { coldStart: true as const } : {}),
  }));
}

function offlineEvent(fold: ReturnType<typeof foldOf>, lookups: ReturnType<typeof offlineLookups>): EventArtifact {
  return json(
    publisher.buildEventArtifact({
      eventKey: EVENT_KEY,
      season: SEASON,
      algorithmId: spr.id,
      algorithmVersion: spr.version,
      generation: STAMP.generation,
      computedAt: STAMP.computedAt,
      eventType: EVENT_TYPE,
      predictions: offlineRecords(fold),
      upcoming: [],
      teams: [],
      ...lookups,
    })
  );
}

interface LiveEventOptions {
  readonly existing?: EventArtifact;
  readonly sortTimeOverride?: ReadonlyMap<string, number>;
}

function liveEvent(fold: ReturnType<typeof foldOf>, options: LiveEventOptions = {}): EventArtifact {
  const merged = mergeEventArtifact({
    existing: options.existing,
    eventKey: EVENT_KEY,
    season: SEASON,
    algorithmId: spr.id,
    algorithmVersion: spr.version,
    eventType: EVENT_TYPE,
    newlyFolded: fold.results,
    newPredictions: fold.predictions,
    upcoming: [],
    touchedTeams: [...RED, ...BLUE],
    touchedMetrics: {},
    newBands: fold.bands,
    playedRowFacts: playedRowFactsFor(SEASON, fold.rawMatches, fold.folded, fold.results),
    stamp: STAMP,
  });
  return json(EventArtifactSchema.parse(merged));
}

function offlineTeamSeason(fold: ReturnType<typeof foldOf>, lookups: ReturnType<typeof offlineLookups>): TeamSeasonArtifact {
  return json(
    publisher.buildTeamSeasonArtifact({
      teamKey: "frc1",
      teamNumber: 1,
      nickname: "Team 1",
      season: SEASON,
      algorithmId: spr.id,
      algorithmVersion: spr.version,
      generation: STAMP.generation,
      computedAt: STAMP.computedAt,
      seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics: { total: { value: 40 } }, metricsBasis: "last-official-match" },
      events: [{ eventKey: EVENT_KEY, eventName: "Silicon Valley Regional", startDate: "2026-03-05", matches: offlineRecords(fold) }],
      metricHistory: [],
      ...lookups,
    })
  );
}

function liveTeamSeason(fold: ReturnType<typeof foldOf>, existing?: TeamSeasonArtifact): TeamSeasonArtifact {
  const merged = mergeTeamSeasonArtifact({
    existing,
    teamKey: "frc1",
    season: SEASON,
    algorithmId: spr.id,
    algorithmVersion: spr.version,
    eventKey: EVENT_KEY,
    matches: fold.results,
    predictions: fold.predictions,
    metrics: { total: { value: 40 } },
    upcomingRows: [],
    bands: fold.bands,
    playedRowFacts: playedRowFactsFor(SEASON, fold.rawMatches, fold.folded, fold.results),
    stamp: STAMP,
    sigmaAfterTick: undefined,
  });
  return json(TeamSeasonArtifactSchema.parse(merged));
}

const QM = { key: `${EVENT_KEY}_qm1`, compLevel: "qm" as const, matchNumber: 1, videos: [{ type: "youtube", key: VIDEO_KEY }] };
const SF = { key: `${EVENT_KEY}_sf1m1`, compLevel: "sf" as const, matchNumber: 1, actualTimeSec: QM_TIME_SEC + 3600 };

function withoutExceptions(row: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...row };
  for (const key of LIVE_PLAYED_ROW_EXCEPTIONS) delete copy[key];
  return copy;
}

describe("live played rows equal the offline publisher's rows", () => {
  const fold = foldOf([QM, SF]);
  const lookups = offlineLookups(fold);

  it("non-vacuity: the offline rows really carry the fields this parity is about", () => {
    const offline = offlineEvent(fold, lookups);
    const qm = offline.matches.find((m) => m.matchKey === QM.key)! as unknown as Record<string, unknown>;
    for (const key of ["video", "sortTime", "actualRedRp", "actualRedBonusRp", "redScoreVarianceOwn", "redMatchBandVariance", "redBonusRp", "matchOutcomePmf", "coldStart"]) {
      expect(qm, key).toHaveProperty(key);
    }
    expect(qm.actualRedRp).toBe(4);
    expect(Array.isArray(qm.actualRedBonusRp)).toBe(true);
    expect(qm.video).toBe(VIDEO_KEY);

    const sf = offline.matches.find((m) => m.matchKey === SF.key)! as unknown as Record<string, unknown>;
    expect(sf, "a playoff row can have no bonus RP at all").not.toHaveProperty("actualRedBonusRp");

    const teamRow = offlineTeamSeason(fold, lookups).events[0]!.matches.find((m) => m.matchKey === QM.key)! as unknown as Record<string, unknown>;
    for (const key of ["setNumber", "matchNumber", "variance", "redBonusRp"]) expect(teamRow, key).toHaveProperty(key);
  });

  it("event: every played row has the offline key list minus coldStart, and the same values", () => {
    const offline = offlineEvent(fold, lookups);
    const live = liveEvent(fold);
    expect(live.matches.map((m) => m.matchKey)).toEqual(offline.matches.map((m) => m.matchKey));
    for (const [i, liveRow] of live.matches.entries()) {
      const offlineRow = offline.matches[i]! as unknown as Record<string, unknown>;
      const liveRecord = liveRow as unknown as Record<string, unknown>;
      expect(Object.keys(liveRecord), liveRow.matchKey).toEqual(Object.keys(offlineRow).filter((k) => !(LIVE_PLAYED_ROW_EXCEPTIONS as readonly string[]).includes(k)));
      expect(liveRecord, liveRow.matchKey).toEqual(withoutExceptions(offlineRow));
    }
  });

  /**
   * THIS HALF NOW DESCRIBES WHAT THE *PUBLISHER* WRITES, not what a live tick
   * writes (260917-jr4, D-07), and quick task 260923-3w6 reinstated them, so
   * this is once again a claim about what the live tick actually writes: the
   * played row a live team-season write produces equals the publisher's own,
   * field for field, minus an exception list expressed as data.
   *
   * The BROWSER half of this claim is gone with the derivation it measured
   * (`apps/web/src/lib/liveTeamSeason.test.ts`, deleted by quick task
   * 260923-3w7): the page reads the published row rather than rebuilding it, so
   * there is no second implementation left to hold to this definition.
   */
  it("team-season (the PUBLISHER's row, the definition the browser derivation is measured against): every played row has the offline key list minus coldStart, and the same values", () => {
    const offline = offlineTeamSeason(fold, lookups).events[0]!.matches;
    const live = liveTeamSeason(fold).events[0]!.matches;
    expect(live.map((m) => m.matchKey)).toEqual(offline.map((m) => m.matchKey));
    for (const [i, liveRow] of live.entries()) {
      const offlineRow = offline[i]! as unknown as Record<string, unknown>;
      const liveRecord = liveRow as unknown as Record<string, unknown>;
      expect(Object.keys(liveRecord), liveRow.matchKey).toEqual(Object.keys(offlineRow).filter((k) => !(LIVE_PLAYED_ROW_EXCEPTIONS as readonly string[]).includes(k)));
      expect(liveRecord, liveRow.matchKey).toEqual(withoutExceptions(offlineRow));
    }
  });

  it("the exception is pinned: no live row carries a coldStart key", () => {
    for (const row of liveEvent(fold).matches) expect(row).not.toHaveProperty("coldStart");
    for (const row of liveTeamSeason(fold).events[0]!.matches) expect(row).not.toHaveProperty("coldStart");
  });
});

describe("a match TBA reports no time for", () => {
  const fold = foldOf([{ ...QM, actualTimeSec: null }]);
  const PUBLISHED_SORT_TIME = 1_772_900_777_000;

  it("takes the existing artifact's published sortTime for the match, never the tick's approximation", () => {
    // Non-vacuity: `normalizeMatch` DID synthesize a composite time the Worker must not publish.
    expect(fold.folded[0]!.sortTime).not.toBe(PUBLISHED_SORT_TIME);

    const seeded = EventArtifactSchema.parse({
      schemaVersion: 1,
      generation: "gen-0",
      computedAt: "2026-03-05T00:00:00.000Z",
      algorithmId: spr.id,
      algorithmVersion: spr.version,
      eventKey: EVENT_KEY,
      season: SEASON,
      matches: [],
      // A fully PRICED prior row, because that is the only upcoming shape the
      // schema admits since quick task 260923-3w7 — the schedule-only shape this
      // fixture used to carry is unrepresentable. Only its `sortTime` matters here.
      upcoming: [
        {
          matchKey: QM.key,
          compLevel: "qm",
          setNumber: 1,
          matchNumber: 1,
          sortTime: PUBLISHED_SORT_TIME,
          redTeams: RED,
          blueTeams: BLUE,
          predictedWinner: "red",
          pRedWin: 0.5,
          predictedRedScore: 100,
          predictedBlueScore: 100,
        },
      ],
      teams: [],
    });
    const row = liveEvent(fold, { existing: seeded }).matches[0]!;
    expect(row.sortTime).toBe(PUBLISHED_SORT_TIME);
  });

  it("writes no sortTime key at all when there is no prior row to read one from", () => {
    expect(liveEvent(fold).matches[0]!).not.toHaveProperty("sortTime");
  });

  it("team-season: takes the existing unplayed row's sortTime", () => {
    const existing = TeamSeasonArtifactSchema.parse({
      schemaVersion: 1,
      generation: "gen-0",
      computedAt: "2026-03-05T00:00:00.000Z",
      algorithmId: spr.id,
      algorithmVersion: spr.version,
      teamKey: "frc1",
      teamNumber: 1,
      nickname: "Team 1",
      season: SEASON,
      seasonStats: { record: { wins: 0, losses: 0, ties: 0 }, metrics: {}, metricsBasis: "last-official-match" },
      events: [
        {
          eventKey: EVENT_KEY,
          eventName: "Silicon Valley Regional",
          startDate: "2026-03-05",
          matches: [
            {
              matchKey: QM.key,
              season: SEASON,
              eventKey: EVENT_KEY,
              compLevel: "qm",
              algorithmId: spr.id,
              algorithmVersion: spr.version,
              predictedWinner: "red",
              pRedWin: 0.5,
              predictedRedScore: 100,
              predictedBlueScore: 100,
              setNumber: 1,
              matchNumber: 1,
              sortTime: PUBLISHED_SORT_TIME,
              redTeams: RED,
              blueTeams: BLUE,
            },
          ],
        },
      ],
      metricHistory: [],
    });
    const row = liveTeamSeason(fold, existing).events[0]!.matches[0]!;
    expect(row.sortTime).toBe(PUBLISHED_SORT_TIME);
  });
});
