/**
 * Season-spanning replay tests (EVAL-01, ROADMAP.md Phase 1 success
 * criterion 3): cross-event chronological interleaving, order stability,
 * the whole-season predict-before-update sequence, state carryover across
 * events, offseason exclusion/inclusion, replay determinism, the
 * empty-season case, and the read-only corpus handle guarantee (T-01-13).
 * Uses a temporary SQLite corpus seeded with hand-built fixtures — no TBA
 * access — so this runs in milliseconds and can never be broken by network
 * conditions.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { opr } from "../core/algorithms/opr.js";
import type { AlgorithmModule, MatchResult } from "../core/algorithms/types.js";
import {
  openCorpus,
  openCorpusReadOnly,
  upsertEvent,
  upsertMatch,
  type Corpus,
} from "../corpus/db.js";
import type { CorpusEvent, CorpusMatch } from "../ingest/normalize.js";
import { buildSeasonStream, WalkForwardSimulator } from "./replay.js";

let dir: string;
let corpusPath: string;
let writeDb: Corpus;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sigmascout-season-replay-"));
  corpusPath = join(dir, "corpus.sqlite");
  writeDb = openCorpus(corpusPath);
});

afterEach(() => {
  writeDb.close();
  rmSync(dir, { recursive: true, force: true });
});

function event(overrides: Partial<CorpusEvent> = {}): CorpusEvent {
  return {
    eventKey: "2024evta",
    year: 2024,
    eventType: 0,
    isOffseason: false,
    startDate: "2024-03-01",
    name: "2024evta",
    week: null,
    country: null,
    stateProv: null,
    districtKey: null,
    ...overrides,
  };
}

function match(overrides: Partial<CorpusMatch> = {}): CorpusMatch {
  return {
    matchKey: "2024evta_qm1",
    eventKey: "2024evta",
    compLevel: "qm",
    matchNumber: 1,
    setNumber: 1,
    sortTime: 100,
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
    ...overrides,
  };
}

/**
 * Two events in the same season whose matches interleave chronologically:
 * A(100), B(200), A(300), B(400). `frc1` plays at event A first
 * (evta_qm1) and again later at event B (evtb_qm2), the fixture Test 4
 * uses to prove cross-event state carryover.
 */
function seedTwoEventSeason(db: Corpus): void {
  upsertEvent(db, event({ eventKey: "2024evta" }));
  upsertEvent(db, event({ eventKey: "2024evtb", startDate: "2024-03-05" }));

  upsertMatch(
    db,
    match({
      matchKey: "2024evta_qm1",
      eventKey: "2024evta",
      sortTime: 100,
      redTeams: ["frc1", "frc2", "frc3"],
      blueTeams: ["frc4", "frc5", "frc6"],
    })
  );
  upsertMatch(
    db,
    match({
      matchKey: "2024evtb_qm1",
      eventKey: "2024evtb",
      sortTime: 200,
      redTeams: ["frc7", "frc8", "frc9"],
      blueTeams: ["frc10", "frc11", "frc12"],
    })
  );
  upsertMatch(
    db,
    match({
      matchKey: "2024evta_qm2",
      eventKey: "2024evta",
      matchNumber: 2,
      sortTime: 300,
      redTeams: ["frc1", "frc2", "frc3"],
      blueTeams: ["frc4", "frc5", "frc6"],
    })
  );
  upsertMatch(
    db,
    match({
      matchKey: "2024evtb_qm2",
      eventKey: "2024evtb",
      matchNumber: 2,
      sortTime: 400,
      redTeams: ["frc1", "frc7", "frc8"],
      blueTeams: ["frc9", "frc10", "frc11"],
    })
  );
}

describe("buildSeasonStream — cross-event chronological interleaving", () => {
  it("alternates between two concurrently-running events by time, rather than grouping by event", () => {
    seedTwoEventSeason(writeDb);

    const stream = buildSeasonStream(writeDb, 2024);
    expect(stream.map((m) => m.matchKey)).toEqual([
      "2024evta_qm1",
      "2024evtb_qm1",
      "2024evta_qm2",
      "2024evtb_qm2",
    ]);
    expect(stream.map((m) => m.eventKey)).toEqual(["2024evta", "2024evtb", "2024evta", "2024evtb"]);
  });

  it("is a total order: two successive builds over the same corpus return identically ordered match keys", () => {
    seedTwoEventSeason(writeDb);

    const first = buildSeasonStream(writeDb, 2024).map((m) => m.matchKey);
    const second = buildSeasonStream(writeDb, 2024).map((m) => m.matchKey);

    expect(first).toEqual(second);
  });
});

function makeInstrumentedAlgorithm(): { algorithm: AlgorithmModule<{ log: string[] }>; log: string[] } {
  const log: string[] = [];
  const algorithm: AlgorithmModule<{ log: string[] }> = {
    id: "instrumented-fake",
    version: "0.0.0",
    initState: () => ({ log }),
    predict: (state, match_) => {
      state.log.push(`predict:${match_.matchKey}`);
      return { winner: "red", pRedWin: 0.5, redScore: 0, blueScore: 0 };
    },
    update: (state, result) => {
      state.log.push(`update:${result.matchKey}`);
      return state;
    },
    teamMetrics: () => ({}),
  };
  return { algorithm, log };
}

describe("buildSeasonStream + WalkForwardSimulator — whole-season predict-before-update", () => {
  it("every predict call precedes the update for that same match, across the whole multi-event season", () => {
    seedTwoEventSeason(writeDb);
    const stream = buildSeasonStream(writeDb, 2024);
    const { algorithm, log } = makeInstrumentedAlgorithm();

    const simulator = new WalkForwardSimulator(stream);
    simulator.run(algorithm, []);

    expect(log).toEqual([
      "predict:2024evta_qm1",
      "update:2024evta_qm1",
      "predict:2024evtb_qm1",
      "update:2024evtb_qm1",
      "predict:2024evta_qm2",
      "update:2024evta_qm2",
      "predict:2024evtb_qm2",
      "update:2024evtb_qm2",
    ]);
  });
});

describe("buildSeasonStream + WalkForwardSimulator — cross-event state carryover", () => {
  it("a team's state at its second event reflects its first event, because the whole season shares one algorithm state", () => {
    seedTwoEventSeason(writeDb);
    const stream = buildSeasonStream(writeDb, 2024);

    const snapshotsByMatch = new Map<string, number>();
    const algorithm: AlgorithmModule<Map<string, number>> = {
      id: "counting-fake",
      version: "0.0.0",
      initState: () => new Map(),
      predict: (state, match_) => {
        // Snapshot frc1's accumulated appearance count as of THIS predict
        // call, before this match's own update() can affect it.
        snapshotsByMatch.set(match_.matchKey, state.get("frc1") ?? 0);
        return { winner: "red", pRedWin: 0.5, redScore: 0, blueScore: 0 };
      },
      update: (state, result) => {
        const next = new Map(state);
        for (const team of [...result.redTeams, ...result.blueTeams]) {
          next.set(team, (next.get(team) ?? 0) + 1);
        }
        return next;
      },
      teamMetrics: () => ({}),
    };

    const simulator = new WalkForwardSimulator(stream);
    simulator.run(algorithm, []);

    // frc1 plays at event A twice (evta_qm1, evta_qm2) before its one
    // appearance at event B (evtb_qm2). By the time evtb_qm2 is predicted,
    // frc1's carried-over state must reflect both event-A matches.
    expect(snapshotsByMatch.get("2024evta_qm1")).toBe(0);
    expect(snapshotsByMatch.get("2024evta_qm2")).toBe(1);
    expect(snapshotsByMatch.get("2024evtb_qm2")).toBe(2);
  });
});

describe("buildSeasonStream — offseason exclusion and inclusion", () => {
  it("excludes offseason matches by default and includes them only with the explicit option", () => {
    seedTwoEventSeason(writeDb);
    upsertEvent(writeDb, event({ eventKey: "2024evtc", eventType: 99, isOffseason: true, startDate: "2024-09-01" }));
    upsertMatch(
      writeDb,
      match({
        matchKey: "2024evtc_qm1",
        eventKey: "2024evtc",
        sortTime: 500,
        redTeams: ["frc20", "frc21", "frc22"],
        blueTeams: ["frc23", "frc24", "frc25"],
      })
    );

    const withoutOffseason = buildSeasonStream(writeDb, 2024).map((m) => m.matchKey);
    expect(withoutOffseason).not.toContain("2024evtc_qm1");

    const withOffseason = buildSeasonStream(writeDb, 2024, { includeOffseason: true }).map((m) => m.matchKey);
    expect(withOffseason).toContain("2024evtc_qm1");
  });
});

describe("buildSeasonStream + WalkForwardSimulator — replay determinism", () => {
  it("two replays of the same season return identical prediction values in identical order", () => {
    seedTwoEventSeason(writeDb);
    const stream = buildSeasonStream(writeDb, 2024);
    const teams = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));

    const runA = new WalkForwardSimulator(stream).run(opr, teams);
    const runB = new WalkForwardSimulator(stream).run(opr, teams);

    expect(runA.map((r) => r.match.matchKey)).toEqual(runB.map((r) => r.match.matchKey));
    expect(runA.map((r) => r.prediction)).toEqual(runB.map((r) => r.prediction));
  });
});

describe("buildSeasonStream — empty season", () => {
  it("returns an empty prediction list without throwing when the season has no matches", () => {
    seedTwoEventSeason(writeDb);

    const stream = buildSeasonStream(writeDb, 2099);
    expect(stream).toEqual([]);

    const { algorithm } = makeInstrumentedAlgorithm();
    const predictions = new WalkForwardSimulator(stream).run(algorithm, []);
    expect(predictions).toEqual([]);
  });
});

describe("buildSeasonStream — the replay's corpus handle is read-only", () => {
  it("reads succeed and a write attempted through the same handle fails", () => {
    seedTwoEventSeason(writeDb);

    const readOnlyDb = openCorpusReadOnly(corpusPath);
    try {
      const stream = buildSeasonStream(readOnlyDb, 2024);
      expect(stream.length).toBeGreaterThan(0);

      expect(() =>
        readOnlyDb
          .prepare("INSERT INTO teams (team_key, team_number, nickname) VALUES ('frcRO', 9999, 'Read-only probe')")
          .run()
      ).toThrow(/readonly/i);
    } finally {
      readOnlyDb.close();
    }
  });
});
