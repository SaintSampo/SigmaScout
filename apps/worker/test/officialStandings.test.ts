/**
 * `applyOfficialRankings` and `hasOfficialStandings` (quick task 261004-uyc), and
 * the parity test that holds this module's small mirror of the offline
 * publisher's rank, record and rp rule to the publisher itself.
 *
 * The publisher is loaded by RUNTIME `import()` only, for the reason
 * `artifactShapeCheck.test.ts` records: a static import of
 * `packages/harness/publish.ts` adds `r2Client.ts` to the Worker's tsc program,
 * which fails the Worker typecheck under workers-types.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyOfficialRankings, hasOfficialStandings } from "../src/officialStandings.js";
import { normalizeEventRankings, type NormalizedEventRanking } from "../../../packages/ingest/rankings.js";
import { spr } from "../../../packages/core/algorithms/spr.js";
import { EventArtifactSchema, PAGE_ARTIFACT_SCHEMA_VERSION, type EventArtifact } from "../../../packages/harness/pageArtifacts.js";

interface OfflinePublisher {
  buildEventArtifact(params: unknown): EventArtifact;
}

const publisher = (await import(fileURLToPath(new URL("../../../packages/harness/publish.ts", import.meta.url).href))) as OfflinePublisher;

const EVENT_KEY = "2026vari";
const TEAM_KEYS = ["frc10", "frc20", "frc30", "frc40", "frc50"];

function artifact(overrides: Record<string, unknown> = {}): EventArtifact {
  return EventArtifactSchema.parse({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "g",
    computedAt: "2026-10-03T22:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "9.0.0",
    eventKey: EVENT_KEY,
    season: 2026,
    matches: [],
    upcoming: [],
    teams: TEAM_KEYS.map((teamKey, i) => ({ teamKey, teamNumber: (i + 1) * 10, nickname: `Team ${(i + 1) * 10}`, metrics: { total: { value: 40 + i } } })),
    ...overrides,
  });
}

function ranking(teamKey: string, rank: number, overrides: Partial<NormalizedEventRanking> = {}): NormalizedEventRanking {
  return { teamKey, rank, totalTeams: 4, recordWins: 5 - rank, recordLosses: rank - 1, recordTies: 0, rankingScore: 3.4567 - rank * 0.2, ...overrides };
}

describe("applyOfficialRankings", () => {
  it("sets rank, record and rp on each ranked row, rp rounded at the ranking points rule", () => {
    const next = applyOfficialRankings(artifact(), [ranking("frc20", 1, { rankingScore: 3.4567 }), ranking("frc10", 2, { rankingScore: 2.005 })]);

    const byKey = new Map(next.teams.map((row) => [row.teamKey, row]));
    expect(byKey.get("frc20")).toMatchObject({ rank: 1, record: { wins: 4, losses: 0, ties: 0 }, rp: 3.46 });
    expect(byKey.get("frc10")).toMatchObject({ rank: 2, record: { wins: 3, losses: 1, ties: 0 } });
    expect(byKey.get("frc10")!.rp).toBeCloseTo(2.01, 2);
  });

  it("omits rp when the ranking score is null, keeps a real zero", () => {
    const next = applyOfficialRankings(artifact(), [ranking("frc10", 1, { rankingScore: null }), ranking("frc20", 2, { rankingScore: 0 })]);

    expect(next.teams.find((row) => row.teamKey === "frc10")).not.toHaveProperty("rp");
    expect(next.teams.find((row) => row.teamKey === "frc20")!.rp).toBe(0);
  });

  it("a team row TBA does not rank loses rank, record and rp, including ones a count wrote earlier", () => {
    const counted = artifact({
      standings: { source: "tick-counted", ranked: true },
      teams: [
        { teamKey: "frc10", teamNumber: 10, nickname: "Ten", metrics: {}, rank: 1, record: { wins: 1, losses: 0, ties: 0 }, rp: 2 },
        { teamKey: "frc20", teamNumber: 20, nickname: "Twenty", metrics: {}, rank: 2, record: { wins: 0, losses: 1, ties: 0 }, rp: 0 },
      ],
    });

    const next = applyOfficialRankings(counted, [ranking("frc10", 1)]);

    const unranked = next.teams.find((row) => row.teamKey === "frc20")!;
    expect(unranked).not.toHaveProperty("rank");
    expect(unranked).not.toHaveProperty("record");
    expect(unranked).not.toHaveProperty("rp");
  });

  it("drops the standings marker, keeps row order, every other key and every metrics entry", () => {
    const base = artifact({ standings: { source: "tick-counted", ranked: false }, name: "Southern Virginia Showdown", rpOutcomeRp: { win: 3, tie: 1 } });

    const next = applyOfficialRankings(base, [ranking("frc50", 1), ranking("frc10", 2)]);

    expect(next).not.toHaveProperty("standings");
    expect(next.teams.map((row) => row.teamKey)).toEqual(TEAM_KEYS);
    expect(next.teams.map((row) => row.metrics)).toEqual(base.teams.map((row) => row.metrics));
    const { standings: _marker, teams: _teams, ...otherKeys } = next as EventArtifact & { standings?: unknown };
    const { standings: _baseMarker, teams: _baseTeams, ...baseOtherKeys } = base;
    expect(otherKeys).toEqual(baseOtherKeys);
  });

  it("does not append a ranked team that has no teams row", () => {
    const next = applyOfficialRankings(artifact(), [ranking("frc999", 1)]);

    expect(next.teams.map((row) => row.teamKey)).toEqual(TEAM_KEYS);
  });

  it("matches what the offline publisher writes from the same rankings: rank, record and rp of every row", () => {
    // Built through the REAL normalize rule and the REAL publisher, so a change to
    // either side's rounding or all-or-nothing handling fails here.
    const response = {
      rankings: TEAM_KEYS.slice(0, 4).map((teamKey, i) => ({
        team_key: teamKey,
        rank: i + 1,
        matches_played: 5,
        dq: 0,
        qual_average: null,
        // Includes a value that rounds, a null-free zero and a long fraction.
        sort_orders: [[3.4349, 2.005, 0, 1.0000001][i]!, 1],
        extra_stats: [],
        record: { wins: 4 - i, losses: i, ties: i === 3 ? 1 : 0 },
      })),
      sort_order_info: [{ name: "Ranking Score", precision: 2 }],
      extra_stats_info: [],
    };
    const normalized = normalizeEventRankings(response, EVENT_KEY);
    const base = artifact();

    const live = applyOfficialRankings(base, normalized);
    const offline = publisher.buildEventArtifact({
      eventKey: EVENT_KEY,
      season: 2026,
      algorithmId: spr.id,
      algorithmVersion: spr.version,
      predictions: [],
      generation: "g",
      computedAt: "2026-10-03T22:00:00.000Z",
      teams: base.teams.map((row) => ({ teamKey: row.teamKey, teamNumber: row.teamNumber, nickname: row.nickname, metrics: {} })),
      rankings: new Map(normalized.map((r) => [r.teamKey, { rank: r.rank, recordWins: r.recordWins, recordLosses: r.recordLosses, recordTies: r.recordTies, rankingScore: r.rankingScore }])),
    });

    const project = (rows: EventArtifact["teams"]) => rows.map((row) => [row.teamKey, row.rank, row.record, row.rp]);
    expect(project(live.teams)).toEqual(project(offline.teams));
    // Non-vacuity: four teams ranked, the fifth not, and rp really rounded.
    expect(live.teams.filter((row) => row.rank !== undefined)).toHaveLength(4);
    expect(live.teams[0]!.rp).toBe(3.43);
  });
});

describe("hasOfficialStandings", () => {
  const rankedRows = [{ teamKey: "frc10", teamNumber: 10, nickname: "Ten", metrics: {}, rank: 1 }];

  it("is true for ranks with no marker", () => {
    expect(hasOfficialStandings(artifact({ teams: rankedRows }))).toBe(true);
  });

  it("is false for ranks beside a tick counted marker", () => {
    expect(hasOfficialStandings(artifact({ teams: rankedRows, standings: { source: "tick-counted", ranked: true } }))).toBe(false);
  });

  it("is false for no ranks, and for undefined", () => {
    expect(hasOfficialStandings(artifact())).toBe(false);
    expect(hasOfficialStandings(undefined)).toBe(false);
  });
});
