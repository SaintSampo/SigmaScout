/**
 * THE WEB LAYER TRUNCATION TEST (quick task 261005-5g0): nothing after a
 * rewound Locks stop can move a request the stop hands the Web Worker.
 *
 * The fixture corpus (`packages/harness/fixtures/asOfFixtureCorpus.ts`) is
 * published through the REAL publisher (uploads intercepted), which writes the
 * event artifacts and the as-of objects; a district artifact is built over its
 * 2024 district events. At three stops (Season start, mid qualification of one
 * event, the end of the first week) every event's request is computed exactly
 * as the tab computes it: `buildDistrictTimeline`, `districtStageAtPosition`,
 * `loadAsOfRewind`, `assembleAsOfDistrictEvents`, and for a REAL event the
 * Worker's own `prepareAsOfRealInput` (priced rows and ratings).
 *
 * Then every match after the stop is UNPLAYED in the corpus (its result
 * removed, the scheduled row kept, which is what the live world looked like at
 * that moment), everything is published and built again, and the requests
 * (modes, priced rows, ratings, baselines, tuples, bake parameters) are deep
 * equal.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openCorpus, upsertEvent, upsertMatch, type Corpus } from "../packages/corpus/db.js";
import type { CorpusMatch } from "../packages/ingest/normalize.js";
import { spr } from "../packages/core/algorithms/spr.js";
import { publishSeasons } from "../packages/harness/publish.js";
import { asOfAtOrBefore, AsOfIndexSchema, AsOfLogSchema, AsOfSeasonSchema, AsOfStartSchema, type AsOfCut, type AsOfIndex } from "../packages/harness/asOfState.js";
import {
  artifactKey,
  asOfIndexKey,
  asOfLogKey,
  asOfSeasonKey,
  asOfStartKey,
  DistrictArtifactSchema,
  EventArtifactSchema,
  type DistrictArtifact,
  type EventArtifact,
} from "../packages/harness/pageArtifacts.js";
import { asOfFixture } from "../packages/harness/fixtures/asOfFixtureCorpus.js";
import { asOfScheduleStopEventKey, loadAsOfRewind, resolveStopCut, type AsOfFetchers } from "../apps/web/src/components/districts/asOfRewind.js";
import { assembleAsOfDistrictEvents } from "../apps/web/src/components/districts/districtRunAssembly.js";
import { buildDistrictTimeline, districtStageAtPosition, timelineEventsOf } from "../apps/web/src/components/districts/districtTimeline.js";
import { deriveStageFromState, tierEvents, type DistrictStageFinality } from "../apps/web/src/components/districts/districtLedgerRows.js";
import { prepareAsOfRealInput } from "../apps/web/src/workers/districtAsOfJob.js";
import type { DistrictAsOfEventRequest } from "../apps/web/src/workers/districtSimulationProtocol.js";

vi.mock("../packages/harness/r2Client.js", () => ({
  putObject: vi.fn(async () => undefined),
  getObject: vi.fn(async () => ""),
}));
import { putObject } from "../packages/harness/r2Client.js";

const SEASON = 2024;
const COMPUTED_AT = "2024-03-14T00:00:00.000Z";
const GENERATION = "asof-web-truncation";
/** The fixture's 2024 district events (TBA event type 1), the ones a district artifact lists. */
/** The fixture's first 2024 match, 2024-03-02 15:00 UTC (`asOfFixtureCorpus.ts` `wk1`). */
const FIRST_MATCH_MS = Date.parse("2024-03-02T15:00:00.000Z");
const DISTRICT_EVENTS = ["2024aaa", "2024bbb", "2024ccc", "2024ddd", "2024eee"];

type Uploads = Map<string, string>;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "asof-web-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The corpus with every match `keep` refuses UNPLAYED: its result removed, its scheduled row kept. */
function seed(path: string, keep: (match: CorpusMatch) => boolean): Corpus {
  const db = openCorpus(path);
  const fixture = asOfFixture();
  for (const event of fixture.events) upsertEvent(db, event);
  for (const match of fixture.matches) {
    upsertMatch(
      db,
      keep(match)
        ? match
        : { ...match, winner: null, redScore: null, blueScore: null, redRpEarned: null, blueRpEarned: null, hasScoreBreakdown: false, scoreBreakdownRaw: null }
    );
  }
  return db;
}

async function publish(db: Corpus, computedAt: string): Promise<Uploads> {
  vi.mocked(putObject).mockClear();
  await publishSeasons(db, {
    seasons: [2023, 2024],
    algorithms: [spr],
    bucket: "test-bucket",
    dryRun: false,
    skipState: true,
    includeOffseason: true,
    generation: GENERATION,
    computedAt,
  });
  const uploads: Uploads = new Map();
  for (const [, key, body] of vi.mocked(putObject).mock.calls) uploads.set(key as string, body as string);
  return uploads;
}

/** One published world, read back as the browser would. */
interface World {
  readonly uploads: Uploads;
  readonly eventArtifacts: Map<string, EventArtifact>;
  readonly district: DistrictArtifact;
}

function eventArtifactsOf(uploads: Uploads): Map<string, EventArtifact> {
  const out = new Map<string, EventArtifact>();
  for (const eventKey of DISTRICT_EVENTS) {
    const body = uploads.get(artifactKey({ page: "event", eventKey, algorithmId: spr.id, version: spr.version }));
    if (body !== undefined) out.set(eventKey, EventArtifactSchema.parse(JSON.parse(body)));
  }
  return out;
}

/**
 * A district artifact over the fixture's district events, built the same way
 * in both worlds from each world's own event artifacts: a team is listed at
 * every event it is scheduled at, with that event's state as observed; a
 * finished event carries fixed earned points (identical in both worlds, since
 * an event finished by the cut is finished in both).
 */
function districtOf(eventArtifacts: ReadonlyMap<string, EventArtifact>): DistrictArtifact {
  const fixture = asOfFixture();
  const weekOf = new Map(fixture.events.map((event) => [event.eventKey, event.week] as const));
  const scheduled = new Map<string, Set<string>>();
  for (const match of fixture.matches) {
    if (!DISTRICT_EVENTS.includes(match.eventKey)) continue;
    const teams = scheduled.get(match.eventKey) ?? new Set<string>();
    for (const teamKey of [...match.redTeams, ...match.blueTeams]) teams.add(teamKey);
    scheduled.set(match.eventKey, teams);
  }
  const allTeams = [...new Set([...scheduled.values()].flatMap((teams) => [...teams]))].sort();
  const stateOf = (eventKey: string) => {
    const artifact = eventArtifacts.get(eventKey);
    const quals = fixture.matches.filter((match) => match.eventKey === eventKey && match.compLevel === "qm").length;
    const played = artifact?.matches.filter((match) => match.compLevel === "qm").length ?? 0;
    const done = artifact !== undefined && artifact.upcoming.length === 0 && artifact.matches.length > 0;
    return { qualMatchesPlayed: played, qualMatchesTotal: quals, alliancesPicked: done, playoffsDone: done, awardsPosted: done };
  };
  return DistrictArtifactSchema.parse({
    schemaVersion: 1,
    generation: GENERATION,
    computedAt: COMPUTED_AT,
    districtKey: "2024fim",
    year: SEASON,
    abbreviation: "fim",
    displayName: "Fixture",
    dcmpSlots: 8,
    cmpSlots: 2,
    teams: allTeams.map((teamKey, rank) => {
      const events = DISTRICT_EVENTS.filter((eventKey) => scheduled.get(eventKey)?.has(teamKey) === true);
      const finished = events.filter((eventKey) => stateOf(eventKey).awardsPosted);
      return {
        teamKey,
        teamNumber: Number(teamKey.slice(3)),
        nickname: teamKey,
        rank: rank + 1,
        pointTotal: 20 * finished.length,
        rookieBonus: 0,
        adjustments: 0,
        eventPoints: finished.map((eventKey) => ({ eventKey, eventName: eventKey, week: weekOf.get(eventKey) ?? null, tier: "district", qual: 10, alliance: 5, elim: 5, award: 0, total: 20, state: stateOf(eventKey) })),
        remainingEvents: events
          .filter((eventKey) => !finished.includes(eventKey))
          .map((eventKey) => ({ eventKey, eventName: eventKey, week: weekOf.get(eventKey) ?? null, tier: "district", maxPoints: 83, state: stateOf(eventKey) })),
        maxRemainingDistrict: 83,
        maxRemainingChamp: 83,
        qualifyingAwards: [],
        awardProfile: { bucket: "none", rookie: false },
        districtLock: { status: "contending", pointsToLock: 5, threatCount: 1, cutLinePoints: 20, allocationNote: null },
        champLock: { status: "contending", pointsToLock: 5, threatCount: 1, cutLinePoints: 40, allocationNote: null },
      };
    }),
    insights: { teamCount: allTeams.length, eventCount: DISTRICT_EVENTS.length, dcmpCutLinePoints: 20, cmpCutLinePoints: 40, districtLockedCount: 0, districtEliminatedCount: 0, champLockedCount: 0, champEliminatedCount: 0 },
  });
}

async function world(keep: (match: CorpusMatch) => boolean, name: string, computedAt: string = COMPUTED_AT): Promise<World> {
  const db = seed(join(dir, `${name}.sqlite`), keep);
  const uploads = await publish(db, computedAt);
  db.close();
  const eventArtifacts = eventArtifactsOf(uploads);
  return { uploads, eventArtifacts, district: districtOf(eventArtifacts) };
}

function fetchersOf(uploads: Uploads): AsOfFetchers {
  const keyParams = { algorithmId: spr.id, version: spr.version };
  const read = <T>(key: string, parse: (body: unknown) => T): Promise<T | null> => {
    const body = uploads.get(key);
    return Promise.resolve(body === undefined ? null : parse(JSON.parse(body)));
  };
  return {
    index: (eventKey) => read(asOfIndexKey({ eventKey, ...keyParams }), (body) => AsOfIndexSchema.parse(body)),
    log: (eventKey) => read(asOfLogKey({ eventKey, ...keyParams }), (body) => AsOfLogSchema.parse(body)),
    season: () => read(asOfSeasonKey({ season: SEASON, ...keyParams }), (body) => AsOfSeasonSchema.parse(body)),
    start: () => read(asOfStartKey({ season: SEASON, ...keyParams }), (body) => AsOfStartSchema.parse(body)),
  };
}

/**
 * Everything the tab hands the Worker at one stop, keyed by event: the request
 * itself and, for a REAL event, the Worker's own finished input.
 */
async function requestsAt(w: World, positionId: string) {
  const district = w.district;
  const events = DISTRICT_EVENTS.map((eventKey) => {
    const entry = district.teams.flatMap((team) => tierEvents(team, "district")).find((candidate) => candidate.eventKey === eventKey)!;
    return { eventKey, eventName: entry.eventName, week: entry.week, state: entry.state };
  });
  // The tab's own rewound fetch set: every event started at the world's now.
  const fetchSet = new Map(
    [...w.eventArtifacts].filter(([eventKey]) => {
      const state = events.find((event) => event.eventKey === eventKey)?.state;
      return deriveStageFromState(state).started;
    })
  );
  const nowStages = new Map<string, DistrictStageFinality>(events.map((event) => [event.eventKey, deriveStageFromState(event.state).final] as const));
  const timeline = buildDistrictTimeline({ events: timelineEventsOf(events, events), eventArtifacts: fetchSet });
  const positionIndex = timeline.positions.findIndex((position) => position.id === positionId);
  expect(positionIndex, `${positionId} is a position`).toBeGreaterThan(-1);
  const stageByEvent = districtStageAtPosition(timeline, positionIndex, nowStages);
  const result = await loadAsOfRewind(
    { districtArtifact: district, timeline, positionIndex, eventArtifacts: fetchSet, stageByEvent, candidates: events.map((event) => ({ eventKey: event.eventKey, tier: "district" as const, week: event.week })), scheduleStopEventKey: asOfScheduleStopEventKey(positionId) },
    fetchersOf(w.uploads)
  );
  const assembled = assembleAsOfDistrictEvents({ artifact: district, result, algorithmVersion: spr.version, eventArtifacts: fetchSet, stageByEvent, candidateKeys: DISTRICT_EVENTS });
  const byEvent = new Map<string, unknown>();
  for (const event of assembled.events) {
    const asOf = event.asOf!;
    byEvent.set(event.eventKey, {
      mode: asOf.mode,
      cutId: asOf.cutId,
      league: asOf.league,
      teams: asOf.teams,
      rows: asOf.rows,
      bake: asOf.bake,
      stage: stageByEvent.get(event.eventKey),
      input: asOf.mode === "real" ? prepareAsOfRealInput(event as DistrictAsOfEventRequest).input : event.input,
    });
  }
  return { byEvent, unavailable: assembled.asOfUnavailable, cut: result.status === "ready" ? result.cutId : result.reason, timeline, positionIndex };
}

/** Every 2024 match at or before `cut`, by its row in the full world's INDEX. */
function keepThrough(full: World, cut: AsOfCut): (match: CorpusMatch) => boolean {
  const indexes = new Map<string, AsOfIndex>();
  for (const [key, body] of full.uploads) {
    const m = /^v1\/asof\/([^/]+)\//.exec(key);
    if (m !== null) indexes.set(m[1]!, AsOfIndexSchema.parse(JSON.parse(body)));
  }
  return (match) => {
    if (!match.eventKey.startsWith("2024")) return true;
    const index = indexes.get(match.eventKey);
    const i = index?.m.findIndex(([matchKey]) => matchKey === match.matchKey) ?? -1;
    if (index === undefined || i < 0) return false;
    return asOfAtOrBefore(match.eventKey, [index.m[i]![1], i], cut);
  };
}

describe("a rewound Locks stop's Worker requests survive deleting every result after the stop", () => {
  it("at Season start, mid qualification and the end of the first week", async () => {
    const full = await world(() => true, "full");
    const stops = ["season-start", "2024bbb:m:2024bbb_qm6", "2024aaa:awards"];
    const modes: string[] = [];
    for (const stop of stops) {
      const before = await requestsAt(full, stop);
      expect(before.byEvent.size, `${stop}: some event is simulated`).toBeGreaterThan(0);
      expect(before.unavailable, `${stop}: nothing unavailable`).toEqual([]);
      modes.push(`${stop}: ${[...before.byEvent].map(([eventKey, request]) => `${eventKey}=${(request as { mode: string }).mode}`).join(" ")}`);
      const indexes = new Map<string, AsOfIndex | null>();
      for (const [key, body] of full.uploads) {
        const m = /^v1\/asof\/([^/]+)\//.exec(key);
        if (m !== null) indexes.set(m[1]!, AsOfIndexSchema.parse(JSON.parse(body)));
      }
      const stopCut = resolveStopCut(before.timeline, before.positionIndex, indexes);
      if (stopCut.status !== "ok") throw new Error(`${stop}: no cut`);
      // The live world at the stop is published at the stop's own instant, so a
      // schedule that was current then is current in it.
      const instant = stopCut.cut.t === Number.NEGATIVE_INFINITY ? FIRST_MATCH_MS - 3_600_000 : stopCut.cut.t + 1;
      const truncated = await world(keepThrough(full, stopCut.cut), `truncated-${stops.indexOf(stop)}`, new Date(instant).toISOString());
      const after = await requestsAt(truncated, stop);
      expect(after.cut, stop).toBe(before.cut);
      expect([...after.byEvent.keys()].sort(), stop).toEqual([...before.byEvent.keys()].sort());
      for (const [eventKey, request] of before.byEvent) expect(after.byEvent.get(eventKey), `${stop} ${eventKey}`).toEqual(request);
    }
    // Not vacuous: REAL events (priced rows and ratings compared) and GENERATED ones are both covered.
    expect(modes).toEqual([
      "season-start: 2024aaa=generated 2024bbb=generated 2024ccc=generated 2024ddd=generated 2024eee=generated",
      "2024bbb:m:2024bbb_qm6: 2024aaa=real 2024bbb=real 2024ccc=generated 2024ddd=generated 2024eee=generated",
      "2024aaa:awards: 2024bbb=real 2024ccc=generated 2024ddd=generated 2024eee=generated",
    ]);
  }, 120_000);
});
