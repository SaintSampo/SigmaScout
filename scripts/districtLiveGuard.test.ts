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
import { DistrictsIndexArtifactSchema, type DistrictsIndexArtifact } from "../packages/harness/pageArtifacts.js";
import { DistrictPublishRefusedError, type PublishedReader } from "./districtPublishGuard.js";
import {
  carryPublishedIndex,
  checkLiveDistricts,
  LIVE_DISTRICT_MARKER,
  liveDistrictEventsAt,
  seasonUploadPlan,
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
