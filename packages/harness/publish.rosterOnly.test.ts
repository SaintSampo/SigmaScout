/**
 * The roster-only season path (quick task 261024-lfa): a season the site lists for its events and
 * rosters before its game rules exist (2027 until January 2027). End to end on a temp corpus with one
 * played 2026 regional and two 2027 events, one with a registered roster and one without.
 *
 *   - No algorithm carries state into the roster-only season (EPA's carry would throw at
 *     `componentMapForSeason(2027)`).
 *   - It publishes, per algorithm, one events list, one empty teams list and one event artifact per event.
 *   - It publishes no team page, compare file, presim sidecar or as-of object.
 *   - The D1 seed stays the last game season's state, and no live window names a roster-only season.
 *   - A run made only of roster-only seasons writes no manifest and no seed.
 *   - A roster-only season with a played match refuses the publish before anything uploads.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openCorpus, upsertEvent, upsertEventTeam, upsertMatch, upsertTeam, type Corpus } from "../corpus/db.js";
import type { CorpusEvent, CorpusMatch } from "../ingest/normalize.js";
import type { AlgorithmModule } from "../core/algorithms/types.js";
import { opr } from "../core/algorithms/opr.js";
import { epa } from "../core/algorithms/epa.js";
import { spr } from "../core/algorithms/spr.js";
import { BREAKDOWN_REGISTERED_SEASONS, componentMapForSeason } from "../core/algorithms/breakdown/index.js";
import { parseSeasonsRange, publishSeasons, type PublishSeasonsOptions } from "./publish.js";
import { buildLiveWindowsManifest } from "./manifests.js";
import { isRosterOnlySeason, NEWEST_GAME_SEASON, selectRosterOnlySeasons } from "./rosterOnlySeason.js";
import type { StateRow } from "./stateSnapshot.js";

vi.mock("./r2Client.js", () => ({
  putObject: vi.fn(async () => undefined),
  getObject: vi.fn(async () => ""),
}));
import { putObject } from "./r2Client.js";
const capturedSeedRows = vi.hoisted(() => new Map<string, readonly unknown[]>());
const capturedCursorSeedCalls = vi.hoisted(() => [] as unknown[]);
vi.mock("./seedSql.js", () => ({
  emitSeedSql: vi.fn((rows: readonly unknown[], options: { algorithmId: string }) => {
    capturedSeedRows.set(options.algorithmId, rows);
  }),
  emitCursorSeedSql: vi.fn((options: unknown) => {
    capturedCursorSeedCalls.push(options);
  }),
  writeSeedCommandsFile: vi.fn(() => undefined),
}));
import { emitCursorSeedSql, emitSeedSql } from "./seedSql.js";

const COMPUTED_AT = "2026-10-24T00:00:00.000Z";
const TEAMS_2026 = ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6", "frc7", "frc8", "frc9"];
/** Inserted out of number order, and chosen so a string sort (118, 1678, 254, 33) differs from a numeric one. */
const ROSTER_2027 = ["frc254", "frc1678", "frc33", "frc118"];
const ROSTER_2027_BY_NUMBER = ["frc33", "frc118", "frc254", "frc1678"];

function event(eventKey: string, year: number, startDate: string, overrides: Partial<CorpusEvent> = {}): CorpusEvent {
  return {
    eventKey,
    year,
    eventType: 0,
    isOffseason: false,
    startDate,
    name: `${eventKey} name`,
    week: 1,
    country: null,
    stateProv: null,
    districtKey: null,
    ...overrides,
  };
}

function match(eventKey: string, i: number, sortTime: number, red: string[], blue: string[], redScore: number, blueScore: number): CorpusMatch {
  return {
    matchKey: `${eventKey}_qm${i + 1}`,
    eventKey,
    compLevel: "qm",
    matchNumber: i + 1,
    setNumber: 1,
    sortTime,
    redTeams: red,
    blueTeams: blue,
    redSurrogates: [],
    blueSurrogates: [],
    redDqs: [],
    blueDqs: [],
    winner: redScore > blueScore ? "red" : redScore < blueScore ? "blue" : "tie",
    winnerImputed: false,
    redScore,
    blueScore,
    redRpEarned: null,
    blueRpEarned: null,
    hasScoreBreakdown: false,
    scoreBreakdownRaw: null,
    videoKey: null,
  };
}

/** One 2026 regional: a deterministic round-robin of 12 played qualification matches over nine teams. */
function seed2026(db: Corpus): void {
  upsertEvent(db, event("2026test", 2026, "2026-03-01"));
  const start = Date.parse("2026-03-01T15:00:00Z");
  for (let i = 0; i < 12; i++) {
    const pick = (k: number): string => TEAMS_2026[(i * 4 + k * 2 + (i % 3)) % TEAMS_2026.length]!;
    const red = [pick(0), pick(1), pick(2)];
    const blue = TEAMS_2026.filter((t) => !red.includes(t)).slice(i % 4, (i % 4) + 3);
    const strength = (team: string): number => Number(team.slice(3)) * 9 + ((i * 13 + 2026) % 17);
    upsertMatch(
      db,
      match("2026test", i, start + i * 1_000, red, blue, red.reduce((s, t) => s + strength(t), 0), blue.reduce((s, t) => s + strength(t), 0))
    );
  }
}

/** Two 2027 events with no matches: a regional with a registered roster (plus a demo key) and a DCMP with none. */
function seed2027(db: Corpus): void {
  upsertEvent(db, event("2027abca", 2027, "2027-03-05", { name: "Alberta Regional", week: 0 }));
  upsertEvent(db, event("2027micmp", 2027, "2027-04-01", { name: "Michigan Championship", eventType: 2, week: 5, districtKey: "fim" }));
  const nicknames: Record<string, string> = { frc254: "The Cheesy Poofs", frc1678: "Citrus Circuits", frc33: "Killer Bees", frc118: "Robonauts" };
  for (const teamKey of ROSTER_2027) {
    upsertTeam(db, { teamKey, teamNumber: Number(teamKey.slice(3)), nickname: nicknames[teamKey]!, rookieYear: null });
    upsertEventTeam(db, { eventKey: "2027abca", teamKey, fetchedAt: COMPUTED_AT });
  }
  upsertEventTeam(db, { eventKey: "2027abca", teamKey: "frc9999", fetchedAt: COMPUTED_AT });
}

const ALGORITHMS: readonly AlgorithmModule<any>[] = [opr, epa, spr];

function baseOptions(overrides: Partial<PublishSeasonsOptions> = {}): PublishSeasonsOptions {
  return {
    seasons: [2026, 2027],
    algorithms: ALGORITHMS,
    bucket: "roster-only-test-never-uploaded",
    generation: "roster-only-test",
    computedAt: COMPUTED_AT,
    // Keeps 2026 fast and makes 2027 presim-eligible, so "no 2027 sidecar" is a real assertion.
    preScheduleFromSeason: 2027,
    ...overrides,
  };
}

function putKeys(): string[] {
  return vi.mocked(putObject).mock.calls.map((call) => call[1] as string);
}

describe("publishSeasons roster-only season", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    vi.mocked(putObject).mockClear();
    vi.mocked(emitSeedSql).mockClear();
    vi.mocked(emitCursorSeedSql).mockClear();
    capturedSeedRows.clear();
    capturedCursorSeedCalls.length = 0;
    dir = mkdtempSync(join(tmpdir(), "sigmascout-roster-only-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
    seed2026(db);
    seed2027(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("carries no algorithm state into the roster-only season", async () => {
    const carrySpy = vi.fn(epa.carrySeason!);
    const epaSpy: AlgorithmModule<any> = { ...epa, carrySeason: carrySpy };
    await publishSeasons(db, baseOptions({ algorithms: [opr, epaSpy, spr], dryRun: true, skipState: true }));
    expect(carrySpy).not.toHaveBeenCalled();
  });

  it("publishes per algorithm a 2027 events list, an empty teams list and a roster event page per event", async () => {
    const bodies = new Map<string, string>();
    await publishSeasons(
      db,
      baseOptions({
        dryRun: true,
        skipState: true,
        artifactSink: (_kind, key, body) => {
          bodies.set(key, body);
        },
      })
    );
    for (const algorithm of ALGORITHMS) {
      const stamp = `${algorithm.id}@${algorithm.version}`;
      const eventsBody = bodies.get(`v1/events/2027/${stamp}.json`);
      expect(eventsBody, `events list for ${stamp}`).toBeDefined();
      const events = JSON.parse(eventsBody!).events as Record<string, unknown>[];
      expect(events.map((e) => e.eventKey)).toEqual(["2027abca", "2027micmp"]);
      const abca = events[0]!;
      const micmp = events[1]!;
      expect(abca).toMatchObject({ name: "Alberta Regional", week: 0, startDate: "2027-03-05", districtKey: null, teamCount: 4, matchCount: 0, playedMatchCount: 0 });
      expect(micmp).toMatchObject({ name: "Michigan Championship", week: 5, startDate: "2027-04-01", districtKey: "fim", teamCount: 0, matchCount: 0, playedMatchCount: 0 });

      const abcaBody = bodies.get(`v1/event/2027abca/${stamp}.json`);
      expect(abcaBody, `2027abca event page for ${stamp}`).toBeDefined();
      const abcaPage = JSON.parse(abcaBody!) as { teams: { teamKey: string; teamNumber: number; nickname: string; metrics: object }[]; matches: unknown[]; upcoming: unknown[]; name: string };
      expect(abcaPage.teams.map((t) => t.teamKey)).toEqual(ROSTER_2027_BY_NUMBER);
      expect(abcaPage.teams.map((t) => t.teamNumber)).toEqual([33, 118, 254, 1678]);
      expect(abcaPage.teams.find((t) => t.teamKey === "frc254")!.nickname).toBe("The Cheesy Poofs");
      for (const t of abcaPage.teams) expect(t.metrics).toEqual({});
      expect(abcaPage.matches).toEqual([]);
      expect(abcaPage.upcoming).toEqual([]);
      expect(abcaPage.name).toBe("Alberta Regional");

      const micmpBody = bodies.get(`v1/event/2027micmp/${stamp}.json`);
      expect(micmpBody, `2027micmp event page for ${stamp}`).toBeDefined();
      expect(JSON.parse(micmpBody!).teams).toEqual([]);

      const teamsBody = bodies.get(`v1/teams/2027/${stamp}.json`);
      expect(teamsBody, `teams list for ${stamp}`).toBeDefined();
      expect(JSON.parse(teamsBody!).teams).toEqual([]);
    }
  });

  it("publishes no team page, compare file, presim sidecar or as-of object for the roster-only season", async () => {
    await publishSeasons(db, baseOptions({ dryRun: false, skipState: true }));
    const keys = putKeys();
    // Non-vacuity: the run uploaded 2026 objects and 2027 event pages through this mock.
    expect(keys.some((k) => /^v1\/team\/frc1\/2026\//.test(k))).toBe(true);
    expect(keys.some((k) => k.startsWith("v1/event/2027abca/"))).toBe(true);
    expect(keys.filter((k) => /\/team\/[^/]+\/2027\//.test(k))).toEqual([]);
    expect(keys).not.toContain("v1/compare/2027.json");
    expect(keys.filter((k) => /^v1\/presim\/2027/.test(k))).toEqual([]);
    expect(keys.filter((k) => /^v1\/asof-(season|start)\/2027\//.test(k))).toEqual([]);
    expect(keys.filter((k) => /^v1\/asof(-log)?\/2027/.test(k))).toEqual([]);
  });

  it("seeds D1 from 2026 and lists no 2027 live window when the run ends at 2027", async () => {
    const summary = await publishSeasons(db, baseOptions({ dryRun: false, skipState: false }));

    const seedRows = capturedSeedRows.get(spr.id) as readonly StateRow[] | undefined;
    expect(seedRows).toBeDefined();
    expect(seedRows!.filter((r) => r.scopeKind === "team").map((r) => r.scopeKey).sort()).toEqual([...TEAMS_2026].sort());
    expect(vi.mocked(emitCursorSeedSql)).toHaveBeenCalledTimes(1);
    expect(summary.seedFiles.length).toBeGreaterThan(0);

    const liveWindowsCall = vi.mocked(putObject).mock.calls.find((call) => call[1] === "v1/manifest/live-windows.json");
    expect(liveWindowsCall).toBeDefined();
    const manifest = JSON.parse(liveWindowsCall![2] as string) as { windows: { season: number }[] };
    expect(manifest.windows.filter((w) => w.season === 2027)).toEqual([]);

    const direct = buildLiveWindowsManifest(db, { seasons: [2026, 2027], generation: "g", computedAt: COMPUTED_AT });
    expect(direct.windows.filter((w) => w.season === 2027)).toEqual([]);
  });

  it("writes no manifest and no seed when every season in the run is roster-only, even without skipState", async () => {
    const summary = await publishSeasons(db, baseOptions({ seasons: [2027], dryRun: false }));
    expect(putKeys().filter((k) => k.startsWith("v1/manifest/"))).toEqual([]);
    expect(vi.mocked(emitSeedSql)).not.toHaveBeenCalled();
    expect(vi.mocked(emitCursorSeedSql)).not.toHaveBeenCalled();
    expect(summary.manifestKeys).toEqual([]);
    expect(summary.seedFiles).toEqual([]);
    // Non-vacuity: the 2027 objects themselves were still written.
    expect(putKeys()).toContain(`v1/events/2027/${spr.id}@${spr.version}.json`);
  });

  it("refuses the publish before anything uploads when a roster-only season has a played match", async () => {
    upsertMatch(db, match("2027abca", 0, Date.parse("2027-03-05T15:00:00Z"), ["frc254", "frc1678", "frc33"], ["frc118", "frc1", "frc2"], 50, 40));
    const sink = vi.fn();
    await expect(publishSeasons(db, baseOptions({ dryRun: false, skipState: false, artifactSink: sink }))).rejects.toThrow(/2027.*played|played.*2027/);
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
    expect(sink).not.toHaveBeenCalled();
  });
});

describe("isRosterOnlySeason", () => {
  it("is false for every registered game season and for 2021, true for the season after the newest", () => {
    for (const season of BREAKDOWN_REGISTERED_SEASONS) expect(isRosterOnlySeason(season), `season ${season}`).toBe(false);
    expect(isRosterOnlySeason(2021)).toBe(false);
    expect(NEWEST_GAME_SEASON).toBe(Math.max(...BREAKDOWN_REGISTERED_SEASONS));
    expect(isRosterOnlySeason(NEWEST_GAME_SEASON + 1)).toBe(true);
    expect(selectRosterOnlySeasons(parseSeasonsRange("2016-2020,2022-2027"))).toEqual([2027]);
    // The registry stays strict: no 2027 entry was added to make the path work.
    expect(() => componentMapForSeason(2027)).toThrow();
  });
});
