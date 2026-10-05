/**
 * The as-of capture (quick task 261005-5g0), proven end to end on a fixture
 * corpus (`packages/harness/fixtures/asOfFixtureCorpus.ts`), with the capture
 * run through the REAL publisher (`publishSeasons`, uploads intercepted):
 *
 *   - ORACLE: at three cuts (season start, mid qualification of one event,
 *     between two weeks) the state `resolveAsOf` rebuilds from the published
 *     objects prices every remaining qualification match and rates every
 *     roster team exactly as `buildDistrictPricingState` does at that instant,
 *     compared with `Object.is`.
 *   - TRUNCATION: remove every match after the cut from the corpus, publish
 *     again, and every tuple and the league read back at the cut are deep
 *     strict equal: nothing after a stop can move a number at the stop.
 *   - BYTE IDENTITY: every object the publisher already wrote is byte for
 *     byte the same with the capture on and off.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openCorpus, upsertEvent, upsertMatch, type Corpus } from "../packages/corpus/db.js";
import type { CorpusMatch } from "../packages/ingest/normalize.js";
import { spr } from "../packages/core/algorithms/spr.js";
import { DEMO_PSEUDO_TEAM_KEY, isDemoTeamKey } from "../packages/core/algorithms/demoTeams.js";
import type { Prediction, UpcomingMatch } from "../packages/core/algorithms/types.js";
import { publishSeasons } from "../packages/harness/publish.js";
import {
  AS_OF_SEASON_START_CUT,
  asOfAtOrBefore,
  AsOfIndexSchema,
  AsOfLogSchema,
  AsOfSeasonSchema,
  isAsOfSeasonStart,
  UNSEEN_AS_OF_TUPLE,
  type AsOfCut,
  type AsOfIndex,
  type AsOfLog,
  type AsOfSeason,
  type AsOfTeamTuple,
} from "../packages/harness/asOfState.js";
import { asOfCutAtMatch, resolveAsOf, type AsOfResolveTeam } from "../packages/harness/asOfLookup.js";
import { buildAsOfPricer, priceRowsForSimulation } from "../packages/harness/asOfPricing.js";
import { asOfIndexKey, asOfLogKey, asOfSeasonKey } from "../packages/harness/pageArtifacts.js";
import { asOfFixture } from "../packages/harness/fixtures/asOfFixtureCorpus.js";
import { buildDistrictPricingState } from "./districtPricingState.js";

vi.mock("../packages/harness/r2Client.js", () => ({
  putObject: vi.fn(async () => undefined),
  getObject: vi.fn(async () => ""),
}));
import { putObject } from "../packages/harness/r2Client.js";

const COMPUTED_AT = "2024-03-14T00:00:00.000Z";
const GENERATION = "asof-oracle-test";
const SEASON = 2024;
const WARMUP = [2023];

/** Every object one publish uploaded, key to body. */
type Uploads = Map<string, string>;

async function publish(db: Corpus, options: { asOfCapture?: boolean; presim?: boolean } = {}): Promise<Uploads> {
  vi.mocked(putObject).mockClear();
  await publishSeasons(db, {
    seasons: [2023, 2024],
    algorithms: [spr],
    bucket: "test-bucket",
    dryRun: false,
    skipState: true,
    includeOffseason: true,
    generation: GENERATION,
    computedAt: COMPUTED_AT,
    ...(options.presim === true ? { preScheduleFromSeason: 2024 } : {}),
    ...(options.asOfCapture === false ? { asOfCapture: false } : {}),
  });
  const uploads: Uploads = new Map();
  for (const [, key, body] of vi.mocked(putObject).mock.calls) {
    expect(uploads.has(key as string), `uploaded twice: ${key as string}`).toBe(false);
    uploads.set(key as string, body as string);
  }
  return uploads;
}

/** The published as-of objects of one season, read back through their schemas exactly as a browser would. */
interface Published {
  readonly season: AsOfSeason;
  readonly indexes: Map<string, AsOfIndex>;
  readonly logs: Map<string, AsOfLog>;
}

function published(uploads: Uploads, season: number): Published {
  const keyParams = { algorithmId: spr.id, version: spr.version };
  const seasonBody = uploads.get(asOfSeasonKey({ season, ...keyParams }));
  expect(seasonBody, `no as-of season object for ${season}`).toBeDefined();
  const indexes = new Map<string, AsOfIndex>();
  const logs = new Map<string, AsOfLog>();
  for (const [key, body] of uploads) {
    const index = /^v1\/asof\/([^/]+)\//.exec(key);
    if (index !== null) {
      const parsed = AsOfIndexSchema.parse(JSON.parse(body));
      if (parsed.season === season) indexes.set(index[1]!, parsed);
    }
    const log = /^v1\/asof-log\/([^/]+)\//.exec(key);
    if (log !== null) {
      const parsed = AsOfLogSchema.parse(JSON.parse(body));
      if (parsed.season === season) logs.set(log[1]!, parsed);
    }
  }
  return { season: AsOfSeasonSchema.parse(JSON.parse(seasonBody!)), indexes, logs };
}

/** The browser's loop: call `resolveAsOf`, "fetch" what it reports missing (absent means not published), repeat. */
function resolveLikeTheBrowser(objects: Published, cut: AsOfCut, teams: readonly AsOfResolveTeam[]) {
  const indexes = new Map<string, AsOfIndex | null>();
  const logs = new Map<string, AsOfLog | null>();
  for (let round = 0; round < 50; round++) {
    const result = resolveAsOf({ cut, teams, season: objects.season, indexes, logs });
    if (result.missingIndexes.length === 0 && result.missingLogs.length === 0) return result;
    for (const key of result.missingIndexes) indexes.set(key, objects.indexes.get(key) ?? null);
    for (const key of result.missingLogs) logs.set(key, objects.logs.get(key) ?? null);
  }
  throw new Error("resolveAsOf did not settle in 50 rounds");
}

function seed(dir: string, keep: (match: CorpusMatch) => boolean = () => true): Corpus {
  const db = openCorpus(join(dir, "corpus.sqlite"));
  const fixture = asOfFixture();
  for (const event of fixture.events) upsertEvent(db, event);
  for (const match of fixture.matches) if (keep(match)) upsertMatch(db, match);
  return db;
}

/** One event's 2024 rows (played and scheduled) as the pricer's input, and its roster. */
interface PricedEvent {
  readonly eventKey: string;
  readonly roster: string[];
  readonly rows: { match: UpcomingMatch; played: boolean }[];
}

function eventsOf2024(): PricedEvent[] {
  const fixture = asOfFixture();
  const byKey = new Map<string, PricedEvent>();
  for (const event of fixture.events.filter((e) => e.year === SEASON)) byKey.set(event.eventKey, { eventKey: event.eventKey, roster: [], rows: [] });
  for (const m of fixture.matches) {
    const priced = byKey.get(m.eventKey);
    if (priced === undefined) continue;
    const event = fixture.events.find((e) => e.eventKey === m.eventKey)!;
    priced.rows.push({
      played: m.winner !== null,
      match: {
        matchKey: m.matchKey,
        eventKey: m.eventKey,
        compLevel: m.compLevel,
        setNumber: m.setNumber,
        matchNumber: m.matchNumber,
        redTeams: m.redTeams,
        blueTeams: m.blueTeams,
        redSurrogates: [],
        blueSurrogates: [],
        eventType: event.eventType,
        week: event.week,
      },
    });
    for (const teamKey of [...m.redTeams, ...m.blueTeams]) if (!priced.roster.includes(teamKey)) priced.roster.push(teamKey);
  }
  for (const priced of byKey.values()) priced.roster.sort();
  return [...byKey.values()];
}

/** Whether a 2024 row is after the cut: a played row by its INDEX position, an unplayed one always. */
function rowAfterCut(objects: Published, row: { match: UpcomingMatch; played: boolean }, cut: AsOfCut): boolean {
  if (!row.played) return true;
  const index = objects.indexes.get(row.match.eventKey)!;
  const position = asOfCutAtMatch(index, row.match.matchKey)!;
  return !asOfAtOrBefore(row.match.eventKey, [position.t, position.i], cut);
}

interface CutSpec {
  readonly label: string;
  readonly cut: AsOfCut;
  /** The oracle's instant: strictly after the cut row, and before the next row. */
  readonly asOf: string;
}

function cutSpecs(objects: Published): CutSpec[] {
  const firstT = Math.min(...[...objects.indexes.values()].map((index) => index.m[0]![1]));
  const mid = asOfCutAtMatch(objects.indexes.get("2024aaa")!, "2024aaa_qm8")!;
  const weekEnd = asOfCutAtMatch(objects.indexes.get("2024bbb")!, "2024bbb_f1m1")!;
  return [
    { label: "season start", cut: AS_OF_SEASON_START_CUT, asOf: new Date(firstT).toISOString() },
    { label: "mid qualification (2024aaa_qm8)", cut: mid, asOf: new Date(mid.t + 1).toISOString() },
    { label: "between weeks (2024bbb_f1m1, the last week 1 row)", cut: weekEnd, asOf: new Date(weekEnd.t + 1).toISOString() },
  ];
}

/** Deep strict equality where every number compares with `Object.is`. */
function strictEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof b === "number") return Object.is(a, b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => strictEqual(v, b[i]));
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    return ka.length === kb.length && ka.every((k) => strictEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}

describe("as-of capture through the real publisher (fixture corpus)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-asof-oracle-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("ORACLE: at every cut, ratings and every remaining qualification match equal buildDistrictPricingState strictly", async () => {
    const db = seed(dir);
    try {
      const objects = published(await publish(db), SEASON);
      const events = eventsOf2024();
      const knownEvents = new Map<string, Set<string>>();
      for (const event of events) for (const teamKey of event.roster) knownEvents.set(teamKey, (knownEvents.get(teamKey) ?? new Set()).add(event.eventKey));

      let ratingComparisons = 0;
      let predictionComparisons = 0;
      let pmfRows = 0;
      let demoRosterPriced = false;
      for (const spec of cutSpecs(objects)) {
        const priced = events.filter((event) => event.rows.some((row) => row.match.compLevel === "qm" && rowAfterCut(objects, row, spec.cut)));
        expect(priced.length, spec.label).toBeGreaterThan(0);
        const teamKeys = [...new Set(priced.flatMap((event) => event.roster))];
        const resolved = resolveLikeTheBrowser(
          objects,
          spec.cut,
          teamKeys.map((teamKey) => ({ teamKey, knownEventKeys: [...knownEvents.get(teamKey)!] }))
        );
        expect(resolved.league, spec.label).toBeDefined();

        const oracle = buildDistrictPricingState(db, { season: SEASON, warmupSeasons: WARMUP, asOf: spec.asOf, algorithm: spr });
        expect(oracle, spec.label).not.toBeNull();

        for (const event of priced) {
          const tuples = new Map<string, AsOfTeamTuple>();
          for (const teamKey of event.roster) tuples.set(teamKey, resolved.states.get(teamKey)!);
          if (event.roster.some((teamKey) => isDemoTeamKey(teamKey))) {
            tuples.set(DEMO_PSEUDO_TEAM_KEY, resolved.states.get(DEMO_PSEUDO_TEAM_KEY)!);
            demoRosterPriced = true;
          }
          const pricer = buildAsOfPricer({ season: SEASON, vars: objects.season.vars, league: resolved.league!, teams: tuples });

          const mine = pricer.ratingsFor(event.roster);
          const theirs = oracle!.ratingsFor(event.roster);
          for (const teamKey of event.roster) {
            ratingComparisons += 1;
            expect(Object.is(mine.get(teamKey)?.total, theirs.get(teamKey)?.total), `${spec.label} ${event.eventKey} ${teamKey} total`).toBe(true);
            expect(Object.is(mine.get(teamKey)?.sigma, theirs.get(teamKey)?.sigma), `${spec.label} ${event.eventKey} ${teamKey} sigma`).toBe(true);
          }
          expect(pricer.teamsWithoutSigma(event.roster)).toEqual(oracle!.teamsWithoutSigmaFor(event.roster));

          const minePredict = pricer.predictFor(event.roster);
          const theirPredict = oracle!.predictFor(event.roster);
          expect(minePredict === undefined, `${spec.label} ${event.eventKey} roster gate`).toBe(theirPredict === undefined);
          if (minePredict === undefined || theirPredict === undefined) continue;
          for (const row of event.rows) {
            if (row.match.compLevel !== "qm" || !rowAfterCut(objects, row, spec.cut)) continue;
            const a: Prediction = minePredict(row.match);
            const b: Prediction = theirPredict(row.match);
            // Every key the oracle returns, strictly; the as-of side adds only the outcome decomposition.
            for (const key of Object.keys(b) as (keyof Prediction)[]) {
              predictionComparisons += 1;
              expect(strictEqual(a[key], b[key]), `${spec.label} ${row.match.matchKey} ${String(key)}: ${JSON.stringify(a[key])} vs ${JSON.stringify(b[key])}`).toBe(true);
            }
            if (b.redRpPmf !== undefined) pmfRows += 1;
            expect(a.matchOutcomePmf, `${row.match.matchKey} carries the outcome decomposition`).toBeDefined();
          }
        }
      }
      expect(ratingComparisons).toBeGreaterThan(100);
      expect(predictionComparisons).toBeGreaterThan(500);
      expect(pmfRows).toBeGreaterThan(50);
      expect(demoRosterPriced).toBe(true);
    } finally {
      db.close();
    }
  });

  it("the fixture really exercises overlap, ties and the demo pseudo team (non-vacuity)", async () => {
    const db = seed(dir);
    try {
      const objects = published(await publish(db), SEASON);
      const division = objects.indexes.get("2024cmpdiv")!;
      expect(Object.values(division.teams).some((segments) => segments.length === 2)).toBe(true);
      expect(objects.indexes.get("2024ddd")!.teams[DEMO_PSEUDO_TEAM_KEY]).toBeDefined();
      expect(objects.indexes.get("2024ddd")!.teams.frc9970![0]!.x[0]).toBeNull();
      const aaa5 = asOfCutAtMatch(objects.indexes.get("2024aaa")!, "2024aaa_qm5")!;
      const bbb5 = asOfCutAtMatch(objects.indexes.get("2024bbb")!, "2024bbb_qm5")!;
      expect(aaa5.t).toBe(bbb5.t);
      // No as-of objects for an event nothing has been played at.
      expect(objects.indexes.has("2024eee")).toBe(false);
      expect(objects.season.L0).not.toBeNull();
    } finally {
      db.close();
    }
  });

  it("TRUNCATION: with every match after the cut removed from the corpus, every tuple and the league at the cut are deep strict equal", async () => {
    const fullDb = seed(dir);
    let full: Published;
    try {
      full = published(await publish(fullDb), SEASON);
    } finally {
      fullDb.close();
    }
    let teamsCompared = 0;
    for (const spec of cutSpecs(full)) {
      const truncDir = mkdtempSync(join(tmpdir(), "sigmascout-asof-trunc-"));
      try {
        const keep = (match: CorpusMatch): boolean => {
          if (!match.eventKey.startsWith("2024")) return true;
          if (match.winner === null) return false;
          const index = full.indexes.get(match.eventKey)!;
          const position = asOfCutAtMatch(index, match.matchKey)!;
          return asOfAtOrBefore(match.eventKey, [position.t, position.i], spec.cut);
        };
        const truncDb = seed(truncDir, keep);
        let truncated: Published;
        try {
          truncated = published(await publish(truncDb), SEASON);
        } finally {
          truncDb.close();
        }
        // Every team the truncated season has seen, worldwide, walked back from each capture's own tails.
        const teams = Object.keys(truncated.season.tails).map((teamKey) => ({ teamKey, knownEventKeys: [] }));
        const fromFull = resolveLikeTheBrowser(full, spec.cut, teams);
        const fromTrunc = resolveLikeTheBrowser(truncated, spec.cut, teams);
        for (const { teamKey } of teams) {
          teamsCompared += 1;
          expect(strictEqual(fromFull.states.get(teamKey), fromTrunc.states.get(teamKey)), `${spec.label} ${teamKey}`).toBe(true);
        }
        expect(strictEqual(fromFull.league, fromTrunc.league), `${spec.label} league`).toBe(true);
        // A team with no row at or before the cut has nothing in the truncated capture: it reads as unseen there,
        // and from the full capture as its pre-season tuple (`s`), which the oracle test above prices.
        if (isAsOfSeasonStart(spec.cut)) expect(teams).toEqual([]);
        expect(fromTrunc.states.get("frc9999") ?? UNSEEN_AS_OF_TUPLE).toEqual(UNSEEN_AS_OF_TUPLE);
      } finally {
        rmSync(truncDir, { recursive: true, force: true });
      }
    }
    expect(teamsCompared).toBeGreaterThan(20);
  });

  it("BYTE IDENTITY: every object the publisher already writes is byte for byte identical with the capture on and off", async () => {
    const db = seed(dir);
    try {
      const on = await publish(db, { presim: true });
      const off = await publish(db, { presim: true, asOfCapture: false });
      const isAsOf = (key: string): boolean => /^v1\/asof(-log|-season)?\//.test(key);
      const onExisting = [...on.keys()].filter((key) => !isAsOf(key)).sort();
      expect(onExisting).toEqual([...off.keys()].sort());
      expect([...off.keys()].some(isAsOf)).toBe(false);
      for (const key of onExisting) expect(on.get(key) === off.get(key), key).toBe(true);
      // Non-vacuity: the comparison covers event, team, teams, events, compare and a presim sidecar.
      for (const prefix of ["v1/event/", "v1/team/", "v1/teams/", "v1/events/", "v1/compare/", "v1/presim/"]) {
        expect(onExisting.some((key) => key.startsWith(prefix)), prefix).toBe(true);
      }
      // What the capture adds per season: one INDEX and one LOG per event with a played match, and one season object.
      const asOfKeys = [...on.keys()].filter(isAsOf);
      const keyParams = { algorithmId: spr.id, version: spr.version };
      const expected = [
        asOfSeasonKey({ season: 2023, ...keyParams }),
        asOfSeasonKey({ season: 2024, ...keyParams }),
        ...["2023warm", "2024aaa", "2024bbb", "2024ccc", "2024ddd", "2024cmpdiv", "2024cmp"].flatMap((eventKey) => [
          asOfIndexKey({ eventKey, ...keyParams }),
          asOfLogKey({ eventKey, ...keyParams }),
        ]),
      ];
      expect(asOfKeys.sort()).toEqual(expected.sort());
    } finally {
      db.close();
    }
  });

  it("priceRowsForSimulation rounds like a published upcoming row and attaches the outcome decomposition", async () => {
    const db = seed(dir);
    try {
      const objects = published(await publish(db), SEASON);
      const ddd = eventsOf2024().find((event) => event.eventKey === "2024ddd")!;
      // The season's last played row: the instant the publisher prices its upcoming rows from.
      let last: AsOfCut = AS_OF_SEASON_START_CUT;
      for (const index of objects.indexes.values()) {
        const i = index.m.length - 1;
        if (isAsOfSeasonStart(last) || !asOfAtOrBefore(index.eventKey, [index.m[i]![1], i], last)) last = { eventKey: index.eventKey, t: index.m[i]![1], i };
      }
      expect(last.eventKey).toBe("2024cmpdiv");
      const resolved = resolveLikeTheBrowser(
        objects,
        last,
        ddd.roster.map((teamKey) => ({ teamKey, knownEventKeys: ["2024ddd"] }))
      );
      const pricer = buildAsOfPricer({ season: SEASON, vars: objects.season.vars, league: resolved.league!, teams: resolved.states });
      const upcoming = ddd.rows.filter((row) => !row.played).map((row) => row.match);
      expect(upcoming.length).toBeGreaterThan(0);
      const { matches, excludedMatchKeys } = priceRowsForSimulation(pricer, upcoming);
      expect(excludedMatchKeys).toEqual([]);
      expect(matches).toHaveLength(upcoming.length);
      // The unplayed rows of an in-progress event are also published as upcoming rows, priced from the
      // season-final state, which IS the state at the season's last row: the simulation rows equal them.
      const eventBody = JSON.parse(
        [...vi.mocked(putObject).mock.calls].find(([, key]) => (key as string).startsWith("v1/event/2024ddd/"))![2] as string
      ) as { upcoming: { matchKey: string; redRpPmf: number[]; blueRpPmf: number[]; matchOutcomePmf?: number[]; redBonusRpPmf?: number[]; blueBonusRpPmf?: number[] }[] };
      upcoming.forEach((match, n) => {
        const row = eventBody.upcoming.find((candidate) => candidate.matchKey === match.matchKey)!;
        expect(matches[n]!.redRpPmf).toEqual(row.redRpPmf);
        expect(matches[n]!.blueRpPmf).toEqual(row.blueRpPmf);
        expect(matches[n]!.outcome?.outcomePmf).toEqual(row.matchOutcomePmf);
        expect(matches[n]!.outcome?.redBonusRpPmf).toEqual(row.redBonusRpPmf);
        expect(matches[n]!.outcome?.blueBonusRpPmf).toEqual(row.blueBonusRpPmf);
      });
    } finally {
      db.close();
    }
  });
});
