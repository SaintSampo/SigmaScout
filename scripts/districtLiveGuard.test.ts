/**
 * The live districts guard of the offline district publisher (quick task
 * 261010-jyn): which district events are live at a clock, the clock check's
 * mode table, what a season uploads once the skipped districts are known, and
 * the index that keeps a skipped district's published row.
 *
 * No real corpus and no network. The live rule runs on a temp corpus built
 * the way `packages/harness/manifests.test.ts` builds its own, with an
 * injected clock, so the window bounds every test reads are the live windows
 * builder's own.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openCorpus, upsertDistrict, upsertEvent, upsertMatch, type Corpus } from "../packages/corpus/db.js";
import type { CorpusEvent, CorpusMatch } from "../packages/ingest/normalize.js";
import { DISTRICT_AWARDS_WATCH_MS, LIVE_WINDOW_PAD_MS, probeWindowFor } from "../packages/harness/manifests.js";
import { DistrictArtifactSchema, DistrictsIndexArtifactSchema, type DistrictArtifact, type DistrictsIndexArtifact } from "../packages/harness/pageArtifacts.js";
import { compareDistrictArtifacts, DistrictPublishRefusedError, type PublishedReader } from "./districtPublishGuard.js";
import {
  calendarWatchEventsAt,
  carryPublishedIndex,
  checkLiveDistricts,
  checkLiveEvidence,
  compareForLiveEvidence,
  EVIDENCE_POINT_CATEGORIES,
  LIVE_DISTRICT_MARKER,
  liveDistrictEventsAt,
  seasonUploadPlan,
  type LiveEvidence,
  type RunDistrict,
} from "./districtLiveGuard.js";

const PAD = LIVE_WINDOW_PAD_MS;
const WATCH = DISTRICT_AWARDS_WATCH_MS;

/** Two match times in March 2026, T1 before T2. */
const T1 = Date.parse("2026-03-06T15:00:00.000Z");
const T2 = Date.parse("2026-03-07T22:00:00.000Z");
/** The window the builder gives an event with matches at T1 and T2. */
const START = T1 - PAD;
const END = T2 + PAD;
const WATCHED_UNTIL = END + WATCH;

let dir: string;
let db: Corpus;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sigmascout-district-live-guard-"));
  db = openCorpus(join(dir, "corpus.sqlite"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function event(overrides: Partial<CorpusEvent> = {}): CorpusEvent {
  return {
    eventKey: "2026wabon",
    year: 2026,
    eventType: 1,
    isOffseason: false,
    startDate: "2026-03-05",
    name: "2026wabon",
    week: null,
    country: null,
    stateProv: null,
    districtKey: "pnw",
    ...overrides,
  };
}

function match(overrides: Partial<CorpusMatch> = {}): CorpusMatch {
  return {
    matchKey: "2026wabon_qm1",
    eventKey: "2026wabon",
    compLevel: "qm",
    matchNumber: 1,
    setNumber: 1,
    sortTime: T1,
    redTeams: ["frc1", "frc2", "frc3"],
    blueTeams: ["frc4", "frc5", "frc6"],
    redSurrogates: [],
    blueSurrogates: [],
    redDqs: [],
    blueDqs: [],
    winner: "red",
    winnerImputed: false,
    redScore: 100,
    blueScore: 50,
    redRpEarned: 2,
    blueRpEarned: 0,
    hasScoreBreakdown: true,
    scoreBreakdownRaw: '{"red":{}}',
    videoKey: null,
    ...overrides,
  };
}

/** One `districts` row: abbreviation `abbreviation`, year 2026 unless said otherwise. */
function districtRow(abbreviation: string, year = 2026): void {
  upsertDistrict(db, {
    districtKey: `${year}${abbreviation}`,
    year,
    abbreviation,
    displayName: `District ${abbreviation}`,
    dcmpSlots: 60,
    cmpSlots: 20,
    fetchedAt: "2026-03-01T00:00:00.000Z",
  });
}

/** An event with two matches, at `first` and `last` (T1 and T2 unless said otherwise). */
function measured(eventKey: string, overrides: Partial<CorpusEvent> = {}, first = T1, last = T2): void {
  upsertEvent(db, event({ eventKey, name: eventKey, ...overrides }));
  upsertMatch(db, match({ matchKey: `${eventKey}_qm1`, eventKey, matchNumber: 1, sortTime: first }));
  upsertMatch(db, match({ matchKey: `${eventKey}_qm2`, eventKey, matchNumber: 2, sortTime: last }));
}

/** An event with no match at all: the builder gives it a calendar window from its start date. */
function unplayed(eventKey: string, startDate: string, overrides: Partial<CorpusEvent> = {}): void {
  upsertEvent(db, event({ eventKey, name: eventKey, startDate, ...overrides }));
}

/** One district of a run, with its events spelled out. */
function runDistrict(districtKey: string, events: ReadonlyArray<readonly [string, string | null]>, season = 2026): RunDistrict {
  return { districtKey, season, events: events.map(([eventKey, startDate]) => ({ eventKey, startDate })) };
}

const PNW_ONE_EVENT = runDistrict("2026pnw", [["2026wabon", "2026-03-05"]]);
const iso = (ms: number): string => new Date(ms).toISOString();
const liveKeys = (districts: readonly RunDistrict[], nowMs: number): string[] => liveDistrictEventsAt(db, { districts, nowMs }).map((entry) => entry.eventKey);

describe("liveDistrictEventsAt: a district event is live inside its window and for 24 hours after it (261010-jyn D1)", () => {
  it("a district event with matches is live at its first match, with the builder's own bounds", () => {
    districtRow("pnw");
    measured("2026wabon");

    expect(liveDistrictEventsAt(db, { districts: [PNW_ONE_EVENT], nowMs: T1 })).toEqual([
      { districtKey: "2026pnw", eventKey: "2026wabon", basis: "matches", startMs: START, endMs: END, watchedUntilMs: WATCHED_UNTIL },
    ]);
  });

  it("the edges: not live one millisecond before the window opens, live from then until one millisecond before the watch ends", () => {
    districtRow("pnw");
    measured("2026wabon");

    expect(liveKeys([PNW_ONE_EVENT], START - 1)).toEqual([]);
    expect(liveKeys([PNW_ONE_EVENT], START)).toEqual(["2026wabon"]);
    expect(liveKeys([PNW_ONE_EVENT], END)).toEqual(["2026wabon"]);
    expect(liveKeys([PNW_ONE_EVENT], WATCHED_UNTIL - 1)).toEqual(["2026wabon"]);
    expect(liveKeys([PNW_ONE_EVENT], WATCHED_UNTIL)).toEqual([]);
    expect(liveKeys([PNW_ONE_EVENT], WATCHED_UNTIL + WATCH)).toEqual([]);
  });

  it("an event that starts tomorrow, on a window from its match times, is not live today", () => {
    districtRow("pnw");
    measured("2026wabon");

    expect(liveKeys([PNW_ONE_EVENT], START - 24 * 60 * 60 * 1000)).toEqual([]);
  });

  it("an event with no match has a calendar window, so one whose start date is tomorrow reads live from 12:00 UTC today", () => {
    districtRow("pnw");
    unplayed("2026wabon", "2026-03-05");
    const probe = probeWindowFor("2026-03-05", 0)!;
    expect(iso(probe.startMs)).toBe("2026-03-04T12:00:00.000Z");

    expect(liveKeys([PNW_ONE_EVENT], probe.startMs - 1)).toEqual([]);
    expect(liveDistrictEventsAt(db, { districts: [PNW_ONE_EVENT], nowMs: probe.startMs })).toEqual([
      { districtKey: "2026pnw", eventKey: "2026wabon", basis: "calendar", startMs: probe.startMs, endMs: probe.endMs, watchedUntilMs: probe.endMs + WATCH },
    ]);
    expect(liveKeys([PNW_ONE_EVENT], probe.endMs + WATCH - 1)).toEqual(["2026wabon"]);
    expect(liveKeys([PNW_ONE_EVENT], probe.endMs + WATCH)).toEqual([]);
  });

  it("a District Championship (event type 2) and a District Championship division (event type 5) each make their district live", () => {
    districtRow("pnw");
    measured("2026pncmp", { eventType: 2 });
    const dcmp = runDistrict("2026pnw", [["2026pncmp", "2026-03-05"]]);
    expect(liveDistrictEventsAt(db, { districts: [dcmp], nowMs: T1 }).map((entry) => [entry.districtKey, entry.eventKey])).toEqual([["2026pnw", "2026pncmp"]]);

    measured("2026pncmpa", { eventType: 5 });
    const both = runDistrict("2026pnw", [["2026pncmp", "2026-03-05"], ["2026pncmpa", "2026-03-05"]]);
    expect(liveDistrictEventsAt(db, { districts: [both], nowMs: T1 }).map((entry) => [entry.districtKey, entry.eventKey])).toEqual([
      ["2026pnw", "2026pncmp"],
      ["2026pnw", "2026pncmpa"],
    ]);
  });

  it("an offseason event carries no district key, so inside its own window it makes no district live", () => {
    districtRow("pnw");
    measured("2026waoff", { eventType: 99, isOffseason: true, districtKey: null });

    expect(liveDistrictEventsAt(db, { districts: [runDistrict("2026pnw", [])], nowMs: T1 })).toEqual([]);
  });

  it("a regional carries no district key and makes no district live", () => {
    districtRow("pnw");
    measured("2026azfg", { eventType: 0, districtKey: null });

    expect(liveDistrictEventsAt(db, { districts: [runDistrict("2026pnw", [])], nowMs: T1 })).toEqual([]);
  });

  it("an event whose abbreviation has no districts row for its year is not a district event, even when the run names 2026pnw", () => {
    // No `districts` row: the builder's join gives the window a null district key.
    measured("2026wabon");

    expect(liveDistrictEventsAt(db, { districts: [PNW_ONE_EVENT], nowMs: T1 })).toEqual([]);
  });

  it("only the districts handed in are reported, and an empty list reports nothing", () => {
    districtRow("pnw");
    districtRow("fim");
    measured("2026wabon");
    measured("2026miket", { districtKey: "fim" });

    expect(liveDistrictEventsAt(db, { districts: [PNW_ONE_EVENT], nowMs: T1 }).map((entry) => entry.eventKey)).toEqual(["2026wabon"]);
    expect(liveDistrictEventsAt(db, { districts: [], nowMs: T1 })).toEqual([]);
  });

  it("the result is sorted by district key, then by event key", () => {
    districtRow("pnw");
    districtRow("fim");
    measured("2026wasno");
    measured("2026wabon");
    measured("2026miket", { districtKey: "fim" });
    const districts = [
      runDistrict("2026pnw", [["2026wasno", "2026-03-05"], ["2026wabon", "2026-03-05"]]),
      runDistrict("2026fim", [["2026miket", "2026-03-05"]]),
    ];

    expect(liveDistrictEventsAt(db, { districts, nowMs: T1 }).map((entry) => [entry.districtKey, entry.eventKey])).toEqual([
      ["2026fim", "2026miket"],
      ["2026pnw", "2026wabon"],
      ["2026pnw", "2026wasno"],
    ]);
  });

  it("agrees with the Worker's own watch comparison at the six edge instants, for a window from matches and for a calendar window", () => {
    // apps/worker/src/districtRefresh.ts watches a district member while
    // `window.startMs <= nowMs && nowMs < window.endMs + DISTRICT_AWARDS_WATCH_MS`.
    districtRow("pnw");
    measured("2026wabon");
    unplayed("2026wasno", "2026-03-19");
    const probe = probeWindowFor("2026-03-19", 0)!;
    const districts = [runDistrict("2026pnw", [["2026wabon", "2026-03-05"], ["2026wasno", "2026-03-19"]])];
    const windows = [
      { eventKey: "2026wabon", startMs: START, endMs: END },
      { eventKey: "2026wasno", startMs: probe.startMs, endMs: probe.endMs },
    ];

    for (const window of windows) {
      for (const nowMs of [window.startMs - 1, window.startMs, window.endMs - 1, window.endMs, window.endMs + WATCH - 1, window.endMs + WATCH]) {
        const workerWatches = window.startMs <= nowMs && nowMs < window.endMs + WATCH;
        expect(liveKeys(districts, nowMs).includes(window.eventKey), `${window.eventKey} at ${iso(nowMs)}`).toBe(workerWatches);
      }
    }
  });

  it("a clock that is not finite throws, and says so", () => {
    districtRow("pnw");
    measured("2026wabon");

    expect(() => liveDistrictEventsAt(db, { districts: [PNW_ONE_EVENT], nowMs: Number.NaN })).toThrow(/clock/);
    expect(() => liveDistrictEventsAt(db, { districts: [PNW_ONE_EVENT], nowMs: Number.POSITIVE_INFINITY })).toThrow(/not a finite/);
  });
});

/** Runs the clock check with a captured logger. */
function check(args: {
  readonly districts: readonly RunDistrict[];
  readonly nowMs?: number;
  readonly stage?: string;
  readonly alreadyListed?: ReadonlySet<string>;
  readonly mode?: "enforce" | "notice";
  readonly allowLive?: boolean;
  readonly corpus?: Corpus;
}) {
  const lines: string[] = [];
  const outcome = checkLiveDistricts({
    stage: args.stage ?? "before the bake",
    db: args.corpus ?? db,
    districts: args.districts,
    nowMs: args.nowMs ?? T1,
    log: (line) => lines.push(line),
    ...(args.alreadyListed === undefined ? {} : { alreadyListed: args.alreadyListed }),
    mode: args.mode ?? "enforce",
    allowLive: args.allowLive ?? false,
  });
  return { lines, outcome };
}

/** Three live events: two in `2026pnw`, one in `2026fim`. */
function threeLiveEvents(): RunDistrict[] {
  districtRow("pnw");
  districtRow("fim");
  measured("2026wabon");
  measured("2026wasno");
  measured("2026miket", { districtKey: "fim" });
  return [
    runDistrict("2026pnw", [["2026wabon", "2026-03-05"], ["2026wasno", "2026-03-05"]]),
    runDistrict("2026fim", [["2026miket", "2026-03-05"]]),
  ];
}

describe("checkLiveDistricts: a run that uploads skips a live district (261010-jyn D2 as revised)", () => {
  it("one live event: one event line and one skip line, no throw, and the district key comes back", () => {
    districtRow("pnw");
    measured("2026wabon");

    const { lines, outcome } = check({ districts: [PNW_ONE_EVENT], stage: "before the bake" });

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.startsWith("publishDistricts:")).toBe(true);
      expect(line).toContain(LIVE_DISTRICT_MARKER);
      expect(line).toContain("2026pnw");
    }
    expect(lines[0]).toContain("2026wabon");
    expect(lines[0]).toContain(iso(START));
    expect(lines[0]).toContain(iso(END));
    expect(lines[0]).toContain(iso(WATCHED_UNTIL));
    expect(lines[1]).toContain("before the bake");
    expect(lines[1]).toContain("skipped");
    expect(outcome.live.map((entry) => entry.eventKey)).toEqual(["2026wabon"]);
    expect(outcome.liveDistrictKeys).toEqual(["2026pnw"]);
    expect(outcome.overridden).toBe(false);
    expect(outcome.unchecked).toBe(false);
  });

  it("two live events in one district and one in another: three event lines, two skip lines, the keys sorted", () => {
    const districts = threeLiveEvents();

    const { lines, outcome } = check({ districts });

    expect(lines).toHaveLength(5);
    expect(lines.filter((line) => line.includes("skipped"))).toHaveLength(2);
    expect(lines.filter((line) => line.includes("event 2026"))).toHaveLength(3);
    expect(outcome.liveDistrictKeys).toEqual(["2026fim", "2026pnw"]);
    expect(outcome.live).toHaveLength(3);
  });

  it("a district an earlier pass listed is neither printed nor returned again", () => {
    const districts = threeLiveEvents();

    const one = check({ districts, alreadyListed: new Set(["2026pnw"]) });
    expect(one.outcome.liveDistrictKeys).toEqual(["2026fim"]);
    expect(one.outcome.live.map((entry) => entry.eventKey)).toEqual(["2026miket"]);
    expect(one.lines).toHaveLength(2);
    expect(one.lines.some((line) => line.includes("2026pnw"))).toBe(false);

    const none = check({ districts, alreadyListed: new Set(["2026pnw", "2026fim"]) });
    expect(none.lines).toEqual([]);
    expect(none.outcome.live).toEqual([]);
    expect(none.outcome.liveDistrictKeys).toEqual([]);
  });

  it("nothing live: nothing is printed and the lists are empty", () => {
    districtRow("pnw");
    measured("2026wabon");

    const { lines, outcome } = check({ districts: [PNW_ONE_EVENT], nowMs: WATCHED_UNTIL });

    expect(lines).toEqual([]);
    expect(outcome).toEqual({ live: [], liveDistrictKeys: [], overridden: false, unchecked: false });
  });
});

describe("seasonUploadPlan: what one season uploads once the skipped districts are known (261010-jyn R13)", () => {
  it("nothing skipped: every district is published and the index is this run's", () => {
    expect(seasonUploadPlan({ districtKeys: ["2026a", "2026b", "2026c"], skipped: new Set() })).toEqual({ publish: ["2026a", "2026b", "2026c"], skip: [], index: "composed" });
  });

  it("a season with no district uploads this run's index", () => {
    expect(seasonUploadPlan({ districtKeys: [], skipped: new Set(["2026a"]) })).toEqual({ publish: [], skip: [], index: "composed" });
  });

  it("one of three skipped: the other two are published in the given order and the index is carried", () => {
    expect(seasonUploadPlan({ districtKeys: ["2026c", "2026a", "2026b"], skipped: new Set(["2026a"]) })).toEqual({ publish: ["2026c", "2026b"], skip: ["2026a"], index: "carried" });
  });

  it("a skipped key that is not one of the season's districts changes nothing", () => {
    expect(seasonUploadPlan({ districtKeys: ["2026a", "2026b"], skipped: new Set(["2016a"]) })).toEqual({ publish: ["2026a", "2026b"], skip: [], index: "composed" });
  });

  it("every district skipped: nothing is published and no index is uploaded", () => {
    expect(seasonUploadPlan({ districtKeys: ["2026a", "2026b"], skipped: new Set(["2026b", "2026a"]) })).toEqual({ publish: [], skip: ["2026a", "2026b"], index: "none" });
  });
});

const INDEX_KEY = "v1/districts/2026.json";
const INDEX_BUCKET = "jyn-test-bucket-not-real";

type IndexRow = DistrictsIndexArtifact["districts"][number];

function indexRow(letter: string, overrides: Partial<IndexRow> = {}): IndexRow {
  return { districtKey: `2026${letter}`, abbreviation: letter, displayName: `District ${letter}`, dcmpSlots: 60, cmpSlots: 20, teamCount: 100, eventCount: 6, ...overrides };
}

function indexArtifact(rows: readonly IndexRow[], stamps: { generation: string; computedAt: string }): DistrictsIndexArtifact {
  return DistrictsIndexArtifactSchema.parse({ schemaVersion: 1, generation: stamps.generation, computedAt: stamps.computedAt, year: 2026, districts: rows });
}

const THIS_RUN_STAMPS = { generation: "gen-this-run", computedAt: "2026-03-14T12:00:00.000Z" };
const PUBLISHED_STAMPS = { generation: "gen-published", computedAt: "2026-03-13T08:00:00.000Z" };

/** This run's index: rows a, b and c. */
const COMPOSED_INDEX = indexArtifact([indexRow("a"), indexRow("b"), indexRow("c")], THIS_RUN_STAMPS);
/** The published one: the same keys, a different team count on every row and a different `cmpSlots` on b. */
const PUBLISHED_INDEX = indexArtifact([indexRow("a", { teamCount: 101 }), indexRow("b", { teamCount: 107, cmpSlots: 23 }), indexRow("c", { teamCount: 103 })], PUBLISHED_STAMPS);

/** Runs the carry with a fake reader that records its calls. */
async function carry(answer: () => string | null | Error, skipped: readonly string[], composed: DistrictsIndexArtifact = COMPOSED_INDEX) {
  const lines: string[] = [];
  const calls: Array<readonly [string, string]> = [];
  const read: PublishedReader = async (bucket, key) => {
    calls.push([bucket, key]);
    const answered = answer();
    if (answered instanceof Error) throw answered;
    return answered;
  };
  let result: DistrictsIndexArtifact | undefined;
  let error: unknown;
  try {
    result = await carryPublishedIndex({ bucket: INDEX_BUCKET, indexKey: INDEX_KEY, season: 2026, composed, skipped: new Set(skipped), read, log: (line) => lines.push(line) });
  } catch (caught) {
    error = caught;
  }
  return { lines, calls, result, error };
}

describe("carryPublishedIndex: a skipped district keeps the row that is published now (261010-jyn R13, R14)", () => {
  it("takes the published row of the skipped district whole, and keeps this run's other rows, row order, stamps and year", async () => {
    const { lines, calls, result, error } = await carry(() => JSON.stringify(PUBLISHED_INDEX), ["2026b"]);

    expect(error).toBeUndefined();
    expect(result!.districts).toEqual([COMPOSED_INDEX.districts[0], PUBLISHED_INDEX.districts[1], COMPOSED_INDEX.districts[2]]);
    expect(result!.districts[1]).toEqual(indexRow("b", { teamCount: 107, cmpSlots: 23 }));
    expect(result!.generation).toBe(THIS_RUN_STAMPS.generation);
    expect(result!.computedAt).toBe(THIS_RUN_STAMPS.computedAt);
    expect(result!.year).toBe(2026);
    expect(calls).toEqual([[INDEX_BUCKET, INDEX_KEY]]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.startsWith("publishDistricts:")).toBe(true);
    expect(lines[0]).toContain(LIVE_DISTRICT_MARKER);
    expect(lines[0]).toContain(INDEX_KEY);
    expect(lines[0]).toContain("2026b");
  });

  it("keeps this run's row order when the published index lists the districts in another order", async () => {
    const reordered = indexArtifact([PUBLISHED_INDEX.districts[2]!, PUBLISHED_INDEX.districts[1]!, PUBLISHED_INDEX.districts[0]!], PUBLISHED_STAMPS);

    const { result } = await carry(() => JSON.stringify(reordered), ["2026a", "2026c"]);

    expect(result!.districts).toEqual([PUBLISHED_INDEX.districts[0], COMPOSED_INDEX.districts[1], PUBLISHED_INDEX.districts[2]]);
  });

  it("a skipped district with no published row is left out, with one line that names it", async () => {
    const withoutB = indexArtifact([PUBLISHED_INDEX.districts[0]!, PUBLISHED_INDEX.districts[2]!], PUBLISHED_STAMPS);

    const { lines, result, error } = await carry(() => JSON.stringify(withoutB), ["2026b"]);

    expect(error).toBeUndefined();
    expect(result!.districts.map((row) => row.districtKey)).toEqual(["2026a", "2026c"]);
    expect(result!.districts).toEqual([COMPOSED_INDEX.districts[0], COMPOSED_INDEX.districts[2]]);
    const naming = lines.filter((line) => line.includes("2026b"));
    expect(naming).toHaveLength(1);
    expect(naming[0]).toContain(LIVE_DISTRICT_MARKER);
    expect(naming[0]).toContain(INDEX_KEY);
    for (const line of lines) expect(line.startsWith("publishDistricts:")).toBe(true);
  });

  const failures: ReadonlyArray<readonly [string, () => string | null | Error, string | undefined]> = [
    ["the reader answers null (no object)", () => null, undefined],
    ["the reader throws", () => new Error("fixture index read failure 4c1d"), "fixture index read failure 4c1d"],
    ["the reader answers a body that is not JSON", () => "not json", undefined],
    ["the reader answers a body that is not a districts index", () => "{}", undefined],
    ["the reader answers the districts index of another year", () => JSON.stringify({ ...PUBLISHED_INDEX, year: 2025 }), "year 2025"],
  ];
  for (const [name, answer, expectedMessage] of failures) {
    it(`fails closed when ${name}`, async () => {
      const { lines, calls, result, error } = await carry(answer, ["2026b"]);

      expect(result).toBeUndefined();
      expect(error).toBeInstanceOf(DistrictPublishRefusedError);
      const message = (error as Error).message;
      expect(message.startsWith("publishDistricts:")).toBe(true);
      expect(message).toContain("Nothing was uploaded");
      expect(message).toContain(INDEX_KEY);
      expect(message).toContain(LIVE_DISTRICT_MARKER);
      expect(message).toContain("--allow-live");
      if (expectedMessage !== undefined) expect(message).toContain(expectedMessage);
      expect(calls).toHaveLength(1);
      expect(lines).toEqual([]);
    });
  }
});

describe("liveDistrictEventsAt: an event the builder can give no window (261010-jyn D1, R4)", () => {
  const NO_WINDOW_EVENT = runDistrict("2026pnw", [["2026wabon", "not-a-date"]]);

  it("no match and a start date that does not parse: live in the clock's UTC year only, with basis no-window and no instants", () => {
    districtRow("pnw");
    unplayed("2026wabon", "not-a-date");

    expect(liveDistrictEventsAt(db, { districts: [NO_WINDOW_EVENT], nowMs: T1 })).toEqual([
      { districtKey: "2026pnw", eventKey: "2026wabon", basis: "no-window", startMs: null, endMs: null, watchedUntilMs: null },
    ]);
    expect(liveKeys([NO_WINDOW_EVENT], Date.parse("2026-01-01T00:00:00.000Z"))).toEqual(["2026wabon"]);
    expect(liveKeys([NO_WINDOW_EVENT], Date.parse("2026-12-31T23:59:59.999Z"))).toEqual(["2026wabon"]);
    expect(liveKeys([NO_WINDOW_EVENT], Date.parse("2027-01-01T00:00:00.000Z"))).toEqual([]);
    expect(liveKeys([NO_WINDOW_EVENT], Date.parse("2025-12-31T23:59:59.999Z"))).toEqual([]);
  });

  it("pruned is not the same as no window: an event past its watch is not reported, whatever its start date", () => {
    districtRow("pnw");
    // One match in March 2026, so the builder gives it a window from that match.
    upsertEvent(db, event({ eventKey: "2026wabon", startDate: "not-a-date" }));
    upsertMatch(db, match({ matchKey: "2026wabon_qm1", eventKey: "2026wabon", sortTime: T1 }));

    expect(liveKeys([NO_WINDOW_EVENT], Date.parse("2026-10-10T12:00:00.000Z"))).toEqual([]);
    // Inside the window it is live by its match, not by the in doubt rule.
    expect(liveDistrictEventsAt(db, { districts: [NO_WINDOW_EVENT], nowMs: T1 }).map((entry) => entry.basis)).toEqual(["matches"]);
  });

  it("a district of another season than the clock's UTC year never yields a no-window entry", () => {
    districtRow("pnw", 2025);
    upsertEvent(db, event({ eventKey: "2025wabon", year: 2025, startDate: "not-a-date" }));
    const lastYear = runDistrict("2025pnw", [["2025wabon", "not-a-date"]], 2025);

    expect(liveDistrictEventsAt(db, { districts: [lastYear], nowMs: T1 })).toEqual([]);
    // In its own year it is.
    expect(liveKeys([lastYear], Date.parse("2025-06-01T00:00:00.000Z"))).toEqual(["2025wabon"]);
  });

  it("an event with a window, open or not, never reads as no-window", () => {
    districtRow("pnw");
    measured("2026wabon");
    unplayed("2026wasno", "2026-09-01");
    const districts = [runDistrict("2026pnw", [["2026wabon", "2026-03-05"], ["2026wasno", "2026-09-01"]])];

    // In June the first is past its watch and the second has not opened.
    expect(liveDistrictEventsAt(db, { districts, nowMs: Date.parse("2026-06-01T00:00:00.000Z") })).toEqual([]);
  });

  it("an event with no window sorts with the others, by district key and then event key", () => {
    districtRow("pnw");
    measured("2026wasno");
    unplayed("2026wabon", "not-a-date");
    const districts = [runDistrict("2026pnw", [["2026wasno", "2026-03-05"], ["2026wabon", "not-a-date"]])];

    expect(liveDistrictEventsAt(db, { districts, nowMs: T1 }).map((entry) => [entry.eventKey, entry.basis])).toEqual([
      ["2026wabon", "no-window"],
      ["2026wasno", "matches"],
    ]);
  });
});

describe("checkLiveDistricts: the override, the notice and the check that cannot run (261010-jyn D2 as revised, R7 to R9)", () => {
  /** A corpus handle whose every query throws. */
  const BROKEN_CORPUS = {
    prepare: () => {
      throw new Error("fixture corpus failure 9e2b");
    },
  } as unknown as Corpus;

  function oneLiveEvent(): RunDistrict[] {
    districtRow("pnw");
    measured("2026wabon");
    return [PNW_ONE_EVENT];
  }

  it("an event with no window prints its own event line, and its district is skipped like any other", () => {
    districtRow("pnw");
    unplayed("2026wabon", "not-a-date");

    const { lines, outcome } = check({ districts: [runDistrict("2026pnw", [["2026wabon", "not-a-date"]])] });

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(LIVE_DISTRICT_MARKER);
    expect(lines[0]).toContain("2026pnw");
    expect(lines[0]).toContain("2026wabon");
    expect(lines[0]).toContain("no window can be built");
    expect(lines[1]).toContain("2026pnw");
    expect(lines[1]).toContain("skipped");
    expect(outcome.liveDistrictKeys).toEqual(["2026pnw"]);
    expect(outcome.live.map((entry) => entry.basis)).toEqual(["no-window"]);
  });

  it("enforce with the override: the event line and one override line, no skip line, no throw, overridden true", () => {
    const { lines, outcome } = check({ districts: oneLiveEvent(), mode: "enforce", allowLive: true });

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("2026wabon");
    expect(lines[1]).toContain("--allow-live");
    expect(lines.some((line) => line.includes("skipped"))).toBe(false);
    expect(outcome.liveDistrictKeys).toEqual(["2026pnw"]);
    expect(outcome.overridden).toBe(true);
    expect(outcome.unchecked).toBe(false);
  });

  for (const allowLive of [false, true]) {
    it(`notice (allowLive ${String(allowLive)}): the event line and one notice line, no skip line, no throw, overridden false`, () => {
      const { lines, outcome } = check({ districts: oneLiveEvent(), mode: "notice", allowLive });

      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain("2026wabon");
      expect(lines[1]).toContain("--dry-run");
      expect(lines[1]).toContain("--allow-live");
      expect(lines.some((line) => line.includes("skipped"))).toBe(false);
      expect(outcome.liveDistrictKeys).toEqual(["2026pnw"]);
      expect(outcome.overridden).toBe(false);
      expect(outcome.unchecked).toBe(false);
    });
  }

  it("a check that cannot run is one line in a notice, with unchecked true and empty lists", () => {
    const { lines, outcome } = check({ districts: [PNW_ONE_EVENT], mode: "notice", corpus: BROKEN_CORPUS, stage: "before the bake" });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("fixture corpus failure 9e2b");
    expect(lines[0]).toContain("before the bake");
    expect(outcome).toEqual({ live: [], liveDistrictKeys: [], overridden: false, unchecked: true });
  });

  for (const allowLive of [false, true]) {
    it(`a check that cannot run refuses a run that uploads (allowLive ${String(allowLive)})`, () => {
      let error: unknown;
      const lines: string[] = [];
      try {
        checkLiveDistricts({ stage: "before the first upload", db: BROKEN_CORPUS, districts: [PNW_ONE_EVENT], nowMs: T1, log: (line) => lines.push(line), mode: "enforce", allowLive });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(DistrictPublishRefusedError);
      const message = (error as Error).message;
      expect(message.startsWith("publishDistricts:")).toBe(true);
      expect(message).toContain(LIVE_DISTRICT_MARKER);
      expect(message).toContain("fixture corpus failure 9e2b");
      expect(message).toContain("before the first upload");
      expect(message).toContain("Nothing was uploaded");
      expect(message).toContain("--allow-live");
      expect(lines).toEqual([]);
    });
  }

  it("a clock that is not finite is a check that cannot run: a refusal on a run that uploads, one line in a notice", () => {
    const districts = oneLiveEvent();

    expect(() => check({ districts, nowMs: Number.NaN, mode: "enforce" })).toThrow(DistrictPublishRefusedError);
    const notice = check({ districts, nowMs: Number.NaN, mode: "notice" });
    expect(notice.lines).toHaveLength(1);
    expect(notice.outcome.unchecked).toBe(true);
  });

  it("in every mode every line starts with the publisher's prefix and holds the marker, and nothing is printed when nothing is live", () => {
    const districts = oneLiveEvent();
    const modes: ReadonlyArray<readonly ["enforce" | "notice", boolean]> = [
      ["enforce", false],
      ["enforce", true],
      ["notice", false],
      ["notice", true],
    ];

    for (const [mode, allowLive] of modes) {
      const live = check({ districts, mode, allowLive });
      expect(live.lines.length).toBeGreaterThan(0);
      for (const line of live.lines) {
        expect(line.startsWith("publishDistricts:"), line).toBe(true);
        expect(line, line).toContain(LIVE_DISTRICT_MARKER);
      }

      const quiet = check({ districts, mode, allowLive, nowMs: WATCHED_UNTIL });
      expect(quiet.lines).toEqual([]);
      expect(quiet.outcome).toEqual({ live: [], liveDistrictKeys: [], overridden: false, unchecked: false });
    }
    const unchecked = check({ districts, mode: "notice", corpus: BROKEN_CORPUS });
    for (const line of unchecked.lines) {
      expect(line.startsWith("publishDistricts:")).toBe(true);
      expect(line).toContain(LIVE_DISTRICT_MARKER);
    }
  });
});

// ---------------------------------------------------------------------------
// The evidence rule
// ---------------------------------------------------------------------------

describe("calendarWatchEventsAt: the events whose calendar window plus 24 hours is open at the clock (261010-jyn R18, R19)", () => {
  const PROBE = probeWindowFor("2026-03-05", 0)!;
  const CALENDAR_UNTIL = PROBE.endMs + WATCH;
  const watchKeys = (districts: readonly RunDistrict[], nowMs: number, exclude?: ReadonlySet<string>): Array<[string, string[]]> =>
    [...calendarWatchEventsAt({ districts, nowMs, ...(exclude === undefined ? {} : { exclude }) })].map(([districtKey, events]): [string, string[]] => [districtKey, events.map((entry) => entry.eventKey)]);

  it("an event is returned from the opening of its calendar window until 24 hours after it closes, with probeWindowFor's own bounds", () => {
    expect(calendarWatchEventsAt({ districts: [PNW_ONE_EVENT], nowMs: PROBE.startMs })).toEqual(
      new Map([["2026pnw", [{ eventKey: "2026wabon", startMs: PROBE.startMs, endMs: PROBE.endMs, watchedUntilMs: CALENDAR_UNTIL }]]])
    );
    expect(watchKeys([PNW_ONE_EVENT], PROBE.startMs - 1)).toEqual([]);
    expect(watchKeys([PNW_ONE_EVENT], PROBE.endMs)).toEqual([["2026pnw", ["2026wabon"]]]);
    expect(watchKeys([PNW_ONE_EVENT], CALENDAR_UNTIL - 1)).toEqual([["2026pnw", ["2026wabon"]]]);
    expect(watchKeys([PNW_ONE_EVENT], CALENDAR_UNTIL)).toEqual([]);
  });

  it("an event with no start date, or one that does not parse, has no calendar window and is never returned", () => {
    const districts = [runDistrict("2026pnw", [["2026wabon", null], ["2026wasno", "not-a-date"]])];

    for (const nowMs of [PROBE.startMs, PROBE.endMs, 0, Date.parse("2026-12-31T00:00:00.000Z")]) expect(watchKeys(districts, nowMs)).toEqual([]);
  });

  it("an excluded district is not in the map, and neither is a district with no event in a window", () => {
    const districts = [
      runDistrict("2026pnw", [["2026wabon", "2026-03-05"]]),
      runDistrict("2026fim", [["2026miket", "2026-03-05"]]),
      runDistrict("2026ne", [["2026nhgrs", "2026-04-20"]]),
    ];

    expect(watchKeys(districts, PROBE.startMs)).toEqual([
      ["2026pnw", ["2026wabon"]],
      ["2026fim", ["2026miket"]],
    ]);
    expect(watchKeys(districts, PROBE.startMs, new Set(["2026pnw"]))).toEqual([["2026fim", ["2026miket"]]]);
  });

  it("two events of one district come back sorted by key", () => {
    const districts = [runDistrict("2026pnw", [["2026wasno", "2026-03-05"], ["2026wabon", "2026-03-06"], ["2026waahs", "2026-05-01"]])];

    expect(watchKeys(districts, Date.parse("2026-03-07T00:00:00.000Z"))).toEqual([["2026pnw", ["2026wabon", "2026wasno"]]]);
  });

  it("agrees with the builder at the six edge instants, for a district event with no match", () => {
    districtRow("pnw");
    unplayed("2026wabon", "2026-03-05");

    for (const nowMs of [PROBE.startMs - 1, PROBE.startMs, PROBE.endMs - 1, PROBE.endMs, CALENDAR_UNTIL - 1, CALENDAR_UNTIL]) {
      const builderSays = liveKeys([PNW_ONE_EVENT], nowMs).includes("2026wabon");
      const calendarSays = calendarWatchEventsAt({ districts: [PNW_ONE_EVENT], nowMs }).has("2026pnw");
      expect(calendarSays, iso(nowMs)).toBe(builderSays);
    }
  });
});

type Team = DistrictArtifact["teams"][number];
type EventState = NonNullable<Team["eventPoints"][number]["state"]>;
type Points = Readonly<Record<(typeof EVIDENCE_POINT_CATEGORIES)[number], number>>;

const EVENT = "2026wabon";
const OTHER_EVENT = "2026wasno";
const DISTRICT_KEY = "2026pnw";
const DETAIL_KEY = "v1/district/2026pnw.json";

/** Awards posted, the full schedule played. */
const POSTED: EventState = { qualMatchesPlayed: 60, qualMatchesTotal: 60, alliancesPicked: true, playoffsDone: true, awardsPosted: true };
/** Everything but the awards. */
const NOT_POSTED: EventState = { ...POSTED, awardsPosted: false };
const BASE_POINTS: Points = { qual: 20, alliance: 10, elim: 10, award: 5, total: 45 };

function lockVerdict() {
  return { status: "contending" as const, pointsToLock: null, threatCount: 0, cutLinePoints: null, allocationNote: null };
}

interface TeamSpec {
  readonly teamKey: string;
  /** `[eventKey, state or undefined, the five numbers]`: one `eventPoints` row each. */
  readonly points?: ReadonlyArray<readonly [string, EventState | undefined, Points?]>;
  /** `[eventKey, state or undefined]`: one `remainingEvents` row each. */
  readonly remaining?: ReadonlyArray<readonly [string, EventState | undefined]>;
}

/** A schema valid district artifact, so a broken fixture fails here and never passes as "not a district artifact". */
function artifact(teams: readonly TeamSpec[]): DistrictArtifact {
  return DistrictArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-live-guard-test",
    computedAt: "2026-03-08T12:00:00.000Z",
    districtKey: DISTRICT_KEY,
    year: 2026,
    abbreviation: "pnw",
    displayName: "Pacific Northwest",
    dcmpSlots: 2,
    cmpSlots: 1,
    teams: teams.map((spec, index) => ({
      teamKey: spec.teamKey,
      rank: index + 1,
      pointTotal: 0,
      rookieBonus: 0,
      adjustments: 0,
      eventPoints: (spec.points ?? []).map(([eventKey, state, points]) => ({
        eventKey,
        eventName: eventKey,
        week: 1,
        tier: "district",
        ...(points ?? BASE_POINTS),
        ...(state === undefined ? {} : { state: { ...state } }),
      })),
      remainingEvents: (spec.remaining ?? []).map(([eventKey, state]) => ({
        eventKey,
        eventName: eventKey,
        week: 2,
        tier: "district",
        maxPoints: 83,
        ...(state === undefined ? {} : { state: { ...state } }),
      })),
      maxRemainingDistrict: 0,
      maxRemainingChamp: 0,
      qualifyingAwards: [],
      districtLock: lockVerdict(),
      champLock: lockVerdict(),
    })),
    insights: {
      teamCount: teams.length,
      eventCount: 2,
      dcmpCutLinePoints: null,
      cmpCutLinePoints: null,
      districtLockedCount: 0,
      districtEliminatedCount: 0,
      champLockedCount: 0,
      champEliminatedCount: 0,
    },
  });
}

/** Three teams with a row at EVENT, each row carrying `state` and its own five numbers (BASE_POINTS unless given). */
function threeTeams(state: EventState | undefined, points: Partial<Record<"frc1" | "frc2" | "frc3", Points>> = {}): DistrictArtifact {
  return artifact((["frc1", "frc2", "frc3"] as const).map((teamKey) => ({ teamKey, points: [[EVENT, state, points[teamKey] ?? BASE_POINTS]] })));
}

const ONLY_EVENT = new Set([EVENT]);
const kindsOf = (evidence: readonly LiveEvidence[]): string[] => evidence.map((entry) => entry.kind);

describe("compareForLiveEvidence, rule (i): this run would raise an awards flag the published file does not hold true (261010-jyn R20)", () => {
  it("published false on every row and this run true is one awardsPostedRaised", () => {
    expect(compareForLiveEvidence(threeTeams(NOT_POSTED), threeTeams(POSTED), ONLY_EVENT)).toEqual([
      { districtKey: DISTRICT_KEY, eventKey: EVENT, kind: "awardsPostedRaised", published: "false", next: "true" },
    ]);
  });

  it("a published artifact with no state on any row of the event is not confirmed either", () => {
    const evidence = compareForLiveEvidence(threeTeams(undefined), threeTeams(POSTED), ONLY_EVENT);

    expect(kindsOf(evidence)).toEqual(["awardsPostedRaised"]);
    expect(evidence[0]!.published).toBe("no state");
  });

  it("a published artifact with no row for the event at all is not confirmed either", () => {
    const published = artifact([{ teamKey: "frc1", points: [[OTHER_EVENT, POSTED]] }]);

    const evidence = compareForLiveEvidence(published, threeTeams(POSTED), ONLY_EVENT);

    expect(kindsOf(evidence)).toEqual(["awardsPostedRaised"]);
    expect(evidence[0]!.published).toBe("no row");
  });

  it("the flag on a remainingEvents row counts on both sides", () => {
    const remainingOnly = (state: EventState): DistrictArtifact => artifact([{ teamKey: "frc1", remaining: [[EVENT, state]] }]);

    expect(kindsOf(compareForLiveEvidence(remainingOnly(NOT_POSTED), remainingOnly(POSTED), ONLY_EVENT))).toEqual(["awardsPostedRaised"]);
    expect(compareForLiveEvidence(remainingOnly(POSTED), remainingOnly(POSTED), ONLY_EVENT)).toEqual([]);
  });

  it("published true gives none", () => {
    expect(compareForLiveEvidence(threeTeams(POSTED), threeTeams(POSTED), ONLY_EVENT)).toEqual([]);
  });

  it("this run false, and this run with no state, give none", () => {
    expect(compareForLiveEvidence(threeTeams(NOT_POSTED), threeTeams(NOT_POSTED), ONLY_EVENT)).toEqual([]);
    expect(compareForLiveEvidence(threeTeams(NOT_POSTED), threeTeams(undefined), ONLY_EVENT)).toEqual([]);
    expect(compareForLiveEvidence(threeTeams(POSTED), threeTeams(NOT_POSTED), ONLY_EVENT)).toEqual([]);
  });

  it("one published row true among several false gives none: the fold is true when any row has it true", () => {
    const published = artifact([
      { teamKey: "frc1", points: [[EVENT, NOT_POSTED]] },
      { teamKey: "frc2", points: [[EVENT, POSTED]] },
      { teamKey: "frc3", points: [[EVENT, NOT_POSTED]] },
    ]);

    expect(compareForLiveEvidence(published, threeTeams(POSTED), ONLY_EVENT)).toEqual([]);
  });

  it("is the 261009-ul3 module's own fold, read from the other side: what that module calls a lost flag, this one calls a raised one", () => {
    // A: one row of several carries the flag true. B: no row does.
    const a = artifact([
      { teamKey: "frc1", points: [[EVENT, NOT_POSTED]] },
      { teamKey: "frc2", points: [[EVENT, POSTED]] },
      { teamKey: "frc3", points: [[EVENT, NOT_POSTED]] },
    ]);
    const b = threeTeams(NOT_POSTED);

    expect(compareDistrictArtifacts(a, b).map((regression) => regression.kind)).toEqual(["awardsPosted"]);
    expect(kindsOf(compareForLiveEvidence(b, a, ONLY_EVENT))).toEqual(["awardsPostedRaised"]);
    // And neither sees anything the other way round.
    expect(compareDistrictArtifacts(b, a)).toEqual([]);
    expect(compareForLiveEvidence(a, b, ONLY_EVENT)).toEqual([]);
  });
});

describe("compareForLiveEvidence, rule (ii): this run would write a lower point value than the published file holds (261010-jyn R21)", () => {
  for (const category of EVIDENCE_POINT_CATEGORIES) {
    it(`${category} lower by itself is one pointsLowered naming the team, the category and both values`, () => {
      const published = threeTeams(POSTED, { frc2: { ...BASE_POINTS, [category]: BASE_POINTS[category] + 3 } });

      expect(compareForLiveEvidence(published, threeTeams(POSTED), ONLY_EVENT)).toEqual([
        { districtKey: DISTRICT_KEY, eventKey: EVENT, kind: "pointsLowered", teamKey: "frc2", category, published: String(BASE_POINTS[category] + 3), next: String(BASE_POINTS[category]) },
      ]);
    });
  }

  it("two categories lower on one row are two, in the order of EVIDENCE_POINT_CATEGORIES", () => {
    const published = threeTeams(POSTED, { frc1: { ...BASE_POINTS, total: 50, qual: 25 } });

    const evidence = compareForLiveEvidence(published, threeTeams(POSTED), ONLY_EVENT);

    expect(evidence.map((entry) => [entry.teamKey, entry.category])).toEqual([
      ["frc1", "qual"],
      ["frc1", "total"],
    ]);
    expect(EVIDENCE_POINT_CATEGORIES).toEqual(["qual", "alliance", "elim", "award", "total"]);
  });

  it("equal numbers and higher numbers give none", () => {
    const higher = threeTeams(POSTED, { frc1: { qual: 30, alliance: 16, elim: 20, award: 10, total: 76 } });

    expect(compareForLiveEvidence(threeTeams(POSTED), threeTeams(POSTED), ONLY_EVENT)).toEqual([]);
    expect(compareForLiveEvidence(threeTeams(POSTED), higher, ONLY_EVENT)).toEqual([]);
  });

  it("a row only this run holds, and a row only the published artifact holds, give none", () => {
    const two = artifact([
      { teamKey: "frc1", points: [[EVENT, POSTED]] },
      { teamKey: "frc2", points: [[EVENT, POSTED]] },
    ]);

    expect(compareForLiveEvidence(two, threeTeams(POSTED), ONLY_EVENT)).toEqual([]);
    expect(compareForLiveEvidence(threeTeams(POSTED), two, ONLY_EVENT)).toEqual([]);
  });

  it("a team's first row at the event is its row", () => {
    const twice = (first: Points, second: Points): DistrictArtifact => artifact([{ teamKey: "frc1", points: [[EVENT, POSTED, first], [EVENT, POSTED, second]] }]);
    const low: Points = { ...BASE_POINTS, qual: 1 };

    // Only the second row is lower: not evidence.
    expect(compareForLiveEvidence(twice(BASE_POINTS, BASE_POINTS), twice(BASE_POINTS, low), ONLY_EVENT)).toEqual([]);
    // The first row is lower: evidence.
    expect(kindsOf(compareForLiveEvidence(twice(BASE_POINTS, BASE_POINTS), twice(low, BASE_POINTS), ONLY_EVENT))).toEqual(["pointsLowered"]);
  });
});

describe("compareForLiveEvidence: only the events handed in, in a fixed order (261010-jyn)", () => {
  /** Both differences at both events: this run raises the flag and lowers frc2's qual and frc1's award. */
  function bothEvents(): { published: DistrictArtifact; next: DistrictArtifact } {
    const rows = (state: EventState, frc1: Points, frc2: Points): TeamSpec[] => [
      { teamKey: "frc2", points: [[OTHER_EVENT, state, frc2], [EVENT, state, frc2]] },
      { teamKey: "frc1", points: [[EVENT, state, frc1], [OTHER_EVENT, state, frc1]] },
    ];
    return {
      published: artifact(rows(NOT_POSTED, { ...BASE_POINTS, award: 9 }, { ...BASE_POINTS, qual: 22 })),
      next: artifact(rows(POSTED, BASE_POINTS, BASE_POINTS)),
    };
  }

  it("both differences on an event that is not in the set handed in give nothing", () => {
    const { published, next } = bothEvents();

    expect(compareForLiveEvidence(published, next, new Set())).toEqual([]);
    expect(compareForLiveEvidence(published, next, new Set(["2026other"]))).toEqual([]);
    expect(new Set(compareForLiveEvidence(published, next, ONLY_EVENT).map((entry) => entry.eventKey))).toEqual(ONLY_EVENT);
  });

  it("events in ascending key order, the flag before the points, the points in this run's team order", () => {
    const { published, next } = bothEvents();

    expect(compareForLiveEvidence(published, next, new Set([OTHER_EVENT, EVENT])).map((entry) => [entry.eventKey, entry.kind, entry.teamKey, entry.category])).toEqual([
      [EVENT, "awardsPostedRaised", undefined, undefined],
      [EVENT, "pointsLowered", "frc2", "qual"],
      [EVENT, "pointsLowered", "frc1", "award"],
      [OTHER_EVENT, "awardsPostedRaised", undefined, undefined],
      [OTHER_EVENT, "pointsLowered", "frc2", "qual"],
      [OTHER_EVENT, "pointsLowered", "frc1", "award"],
    ]);
  });
});

describe("checkLiveEvidence: a district is also skipped on evidence while an event's calendar window is open (261010-jyn R18 to R27)", () => {
  /** EVENT's start date puts every clock from PROBE.startMs to CALENDAR_UNTIL minus 1 inside its calendar window plus 24 hours. */
  const PROBE = probeWindowFor("2026-03-05", 0)!;
  const CALENDAR_UNTIL = PROBE.endMs + WATCH;
  const INSIDE = PROBE.endMs + 60_000;
  const DISTRICTS = [runDistrict(DISTRICT_KEY, [[EVENT, "2026-03-05"]])];

  function evidenceCheck(args: {
    readonly published: DistrictArtifact | string | null | undefined;
    readonly next?: DistrictArtifact;
    readonly nowMs?: number;
    readonly mode?: "enforce" | "notice";
    readonly allowLive?: boolean;
    readonly alreadyListed?: ReadonlySet<string>;
    readonly stage?: string;
  }) {
    const lines: string[] = [];
    const publishedBodies = new Map<string, string | null>();
    if (args.published !== undefined) publishedBodies.set(DETAIL_KEY, args.published === null || typeof args.published === "string" ? args.published : JSON.stringify(args.published));
    const outcome = checkLiveEvidence({
      stage: args.stage ?? "before the first upload",
      districts: DISTRICTS,
      nowMs: args.nowMs ?? INSIDE,
      alreadyListed: args.alreadyListed ?? new Set(),
      details: [{ key: DETAIL_KEY, districtKey: DISTRICT_KEY, artifact: args.next ?? threeTeams(POSTED) }],
      publishedBodies,
      mode: args.mode ?? "enforce",
      allowLive: args.allowLive ?? false,
      log: (line) => lines.push(line),
    });
    return { lines, outcome };
  }

  /** Three lowered values at EVENT: frc2's qual and total, frc3's award. */
  const THREE_LOWERED = threeTeams(POSTED, { frc2: { ...BASE_POINTS, qual: 24, total: 49 }, frc3: { ...BASE_POINTS, award: 15 } });

  it("enforce, the flag: one evidence line and one skip line with its reason, and the district key comes back", () => {
    const { lines, outcome } = evidenceCheck({ published: threeTeams(NOT_POSTED) });

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(LIVE_DISTRICT_MARKER);
    expect(lines[0]).toContain(DISTRICT_KEY);
    expect(lines[0]).toContain(EVENT);
    expect(lines[0]).toContain("awards posted");
    expect(lines[0]).toContain(iso(CALENDAR_UNTIL));
    expect(lines[1]).toContain(LIVE_DISTRICT_MARKER);
    expect(lines[1]).toContain(DISTRICT_KEY);
    expect(lines[1]).toContain("skipped");
    expect(lines[1]).toContain("on evidence");
    expect(lines[1]).toContain("before the first upload");
    expect(kindsOf(outcome.evidence)).toEqual(["awardsPostedRaised"]);
    expect(outcome.evidenceDistrictKeys).toEqual([DISTRICT_KEY]);
    expect(outcome.overridden).toBe(false);
  });

  it("enforce, three lowered values at one event: one evidence line with the count and the first of them, and one skip line", () => {
    const { lines, outcome } = evidenceCheck({ published: THREE_LOWERED });

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("3 point value(s)");
    expect(lines[0]).toContain("team frc2");
    expect(lines[0]).toContain("qual");
    expect(lines[0]).toContain("published 24");
    expect(lines[0]).toContain("this run 20");
    expect(lines[0]).toContain(iso(CALENDAR_UNTIL));
    expect(lines[1]).toContain("on evidence");
    expect(outcome.evidence).toHaveLength(3);
    expect(outcome.evidenceDistrictKeys).toEqual([DISTRICT_KEY]);
  });

  it("both kinds at one event: the flag line, then the points line, then one skip line", () => {
    const published = threeTeams(NOT_POSTED, { frc1: { ...BASE_POINTS, elim: 30 } });

    const { lines } = evidenceCheck({ published });

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("awards posted");
    expect(lines[1]).toContain("1 point value(s)");
    expect(lines[1]).toContain("elim");
    expect(lines[2]).toContain("on evidence");
  });

  it("enforce with the override: the evidence lines and one override line, no skip line, overridden true", () => {
    const { lines, outcome } = evidenceCheck({ published: threeTeams(NOT_POSTED), allowLive: true });

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("awards posted");
    expect(lines[1]).toContain("--allow-live");
    expect(lines.some((line) => line.includes("skipped"))).toBe(false);
    expect(outcome.evidenceDistrictKeys).toEqual([DISTRICT_KEY]);
    expect(outcome.overridden).toBe(true);
  });

  for (const allowLive of [false, true]) {
    it(`notice (allowLive ${String(allowLive)}): the evidence lines and one notice line that says on evidence, no skip line`, () => {
      const { lines, outcome } = evidenceCheck({ published: threeTeams(NOT_POSTED), mode: "notice", allowLive });

      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain("awards posted");
      expect(lines[1]).toContain("--dry-run");
      expect(lines[1]).toContain("on evidence");
      expect(lines.some((line) => line.includes("skipped"))).toBe(false);
      expect(outcome.evidenceDistrictKeys).toEqual([DISTRICT_KEY]);
      expect(outcome.overridden).toBe(false);
    });
  }

  it("both differences at the instant the calendar watch ends: nothing. One millisecond earlier they are reported", () => {
    const published = threeTeams(NOT_POSTED, { frc1: { ...BASE_POINTS, elim: 30 } });

    const at = evidenceCheck({ published, nowMs: CALENDAR_UNTIL });
    expect(at.lines).toEqual([]);
    expect(at.outcome).toEqual({ evidence: [], evidenceDistrictKeys: [], overridden: false });

    const before = evidenceCheck({ published, nowMs: CALENDAR_UNTIL - 1 });
    expect(kindsOf(before.outcome.evidence)).toEqual(["awardsPostedRaised", "pointsLowered"]);
    expect(before.outcome.evidenceDistrictKeys).toEqual([DISTRICT_KEY]);

    // And before the calendar window opens, nothing either.
    expect(evidenceCheck({ published, nowMs: PROBE.startMs - 1 }).lines).toEqual([]);
  });

  const notCompared: ReadonlyArray<readonly [string, Parameters<typeof evidenceCheck>[0]]> = [
    ["the district is one the clock rule listed", { published: threeTeams(NOT_POSTED), alreadyListed: new Set([DISTRICT_KEY]) }],
    ["its published body is null (a first publish)", { published: null }],
    ["its key is missing from the map (it could not be read)", { published: undefined }],
    ["its published body is not JSON", { published: "not json" }],
    ["its published body is not a district artifact", { published: "{}" }],
    ["no difference", { published: threeTeams(POSTED) }],
  ];
  for (const [name, args] of notCompared) {
    it(`prints nothing and returns empty lists when ${name}`, () => {
      for (const mode of ["enforce", "notice"] as const) {
        const { lines, outcome } = evidenceCheck({ ...args, mode });
        expect(lines).toEqual([]);
        expect(outcome).toEqual({ evidence: [], evidenceDistrictKeys: [], overridden: false });
      }
    });
  }

  it("a detail of a district with no event in a calendar window is not compared, whatever its published body says", () => {
    const lines: string[] = [];
    const outcome = checkLiveEvidence({
      stage: "before the first upload",
      districts: [runDistrict(DISTRICT_KEY, [[EVENT, "2026-05-01"]])],
      nowMs: INSIDE,
      alreadyListed: new Set(),
      details: [{ key: DETAIL_KEY, districtKey: DISTRICT_KEY, artifact: threeTeams(POSTED) }],
      publishedBodies: new Map([[DETAIL_KEY, JSON.stringify(threeTeams(NOT_POSTED))]]),
      mode: "enforce",
      allowLive: false,
      log: (line) => lines.push(line),
    });

    expect(lines).toEqual([]);
    expect(outcome.evidenceDistrictKeys).toEqual([]);
  });

  it("never throws, a clock that is not finite included, and every line starts with the publisher's prefix and holds the marker", () => {
    const published = threeTeams(NOT_POSTED, { frc1: { ...BASE_POINTS, elim: 30 } });

    expect(() => evidenceCheck({ published, nowMs: Number.NaN })).not.toThrow();
    expect(evidenceCheck({ published, nowMs: Number.NaN }).lines).toEqual([]);
    const modes: ReadonlyArray<readonly ["enforce" | "notice", boolean]> = [
      ["enforce", false],
      ["enforce", true],
      ["notice", false],
    ];
    for (const [mode, allowLive] of modes) {
      const { lines } = evidenceCheck({ published, mode, allowLive });
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.startsWith("publishDistricts:"), line).toBe(true);
        expect(line, line).toContain(LIVE_DISTRICT_MARKER);
      }
    }
  });
});
