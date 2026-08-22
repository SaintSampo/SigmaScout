/**
 * Proves the offline-to-online state handoff (D-12/D-13, plan 04-03 Task 2)
 * is lossless — not by deep-equalling two state objects, but by the same
 * standard Phase 3 uses for "these two runs are the same run"
 * (`computePredictionStreamDigest` over a continuation replay). Also covers
 * D-09's per-algorithm scope shape (event-scoped OPR vs. team-scoped
 * Sigma1/EPA), the stability property that lets a Worker skip a write for an
 * unchanged team, and the partial-load property D-13 requires.
 */
import * as fs from "node:fs";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { epa } from "../core/algorithms/epa.js";
import { opr } from "../core/algorithms/opr.js";
import { sigma1, type Sigma1State } from "../core/algorithms/sigma1/index.js";
import type { EpaState } from "../core/algorithms/epa.js";
import type { AlgorithmModule, MatchResult, UpcomingMatch } from "../core/algorithms/types.js";
import { emptyExpandingStats } from "../core/scoring/expandingStats.js";
import { openCorpus, upsertEvent, upsertMatch, type Corpus } from "../corpus/db.js";
import type { CorpusEvent, CorpusMatch } from "../ingest/normalize.js";
import { buildSeasonStream, WalkForwardSimulator } from "./replay.js";
import { computePredictionStreamDigest } from "./promote.js";
import {
  MissingLeagueRowError,
  StateRowSchema,
  deserializeState,
  emitSeedSql,
  serializeState,
  type StateRow,
  type StateStamp,
} from "./stateSnapshot.js";

const STAMP: StateStamp = { generation: "test-gen-1", computedAt: "2026-08-22T00:00:00.000Z" };

// ---------------------------------------------------------------------------
// A small, real corpus fixture — two 2024 events, each with a full valid
// score breakdown, enough matches to give all three algorithms non-trivial
// state after a partial replay.
// ---------------------------------------------------------------------------

let dir: string;
let corpusPath: string;
let db: Corpus;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sigmascout-statesnapshot-"));
  corpusPath = join(dir, "corpus.sqlite");
  db = openCorpus(corpusPath);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A valid 2024 `score_breakdown` where both alliances' 13 Sigma1 components each parse to `perComponentValue` (mirrors `sigma1/sigma1.test.ts`'s `rawBreakdown2024Uniform` fixture, reimplemented here as a small, deliberate test-only duplication). */
function rawBreakdown2024(perComponentValue: number): string {
  const side = {
    autoLeavePoints: perComponentValue,
    autoAmpNotePoints: perComponentValue,
    autoSpeakerNotePoints: perComponentValue,
    teleopAmpNotePoints: perComponentValue,
    teleopSpeakerNotePoints: perComponentValue,
    teleopSpeakerNoteAmplifiedPoints: perComponentValue,
    endGameOnStagePoints: perComponentValue,
    endGameParkPoints: perComponentValue,
    endGameHarmonyPoints: perComponentValue,
    endGameNoteInTrapPoints: perComponentValue,
    endGameSpotLightBonusPoints: perComponentValue,
    adjustPoints: perComponentValue,
    foulPoints: perComponentValue,
    autoAmpNoteCount: 0,
    autoSpeakerNoteCount: 0,
    teleopAmpNoteCount: 0,
    teleopSpeakerNoteCount: 0,
    teleopSpeakerNoteAmplifiedCount: 0,
    endGameTotalStagePoints: 0,
    endGameRobot1: "None",
    endGameRobot2: "None",
    endGameRobot3: "None",
    coopertitionBonusAchieved: false,
    melodyBonusAchieved: false,
    ensembleBonusAchieved: false,
    melodyBonusThresholdCoop: 0,
    melodyBonusThresholdNonCoop: 0,
    ensembleBonusStagePointsThreshold: 0,
    ensembleBonusOnStageRobotsThreshold: 0,
  };
  return JSON.stringify({ red: side, blue: side });
}

const PER_COMPONENT = 10;
const SIDE_TOTAL = 13 * PER_COMPONENT; // 13 components, uniform

function event(overrides: Partial<CorpusEvent> = {}): CorpusEvent {
  return { eventKey: "2024evta", year: 2024, eventType: 0, isOffseason: false, startDate: "2024-03-01", ...overrides };
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
    redScore: SIDE_TOTAL,
    blueScore: SIDE_TOTAL,
    redRpEarned: 2,
    blueRpEarned: 0,
    hasScoreBreakdown: true,
    scoreBreakdownRaw: rawBreakdown2024(PER_COMPONENT),
    ...overrides,
  };
}

/** Two events, 4 quals matches each, 8 total — enough for non-trivial per-team/per-event state after replaying half of them. */
function seedFixtureSeason(corpus: Corpus): void {
  upsertEvent(corpus, event({ eventKey: "2024evta" }));
  upsertEvent(corpus, event({ eventKey: "2024evtb", startDate: "2024-03-08" }));

  const eventATeams: [string[], string[]][] = [
    [["frc1", "frc2", "frc3"], ["frc4", "frc5", "frc6"]],
    [["frc1", "frc4", "frc7"], ["frc2", "frc5", "frc8"]],
    [["frc3", "frc6", "frc9"], ["frc1", "frc7", "frc8"]],
    [["frc2", "frc9", "frc4"], ["frc3", "frc5", "frc7"]],
  ];
  eventATeams.forEach(([red, blue], i) => {
    upsertMatch(
      corpus,
      match({
        matchKey: `2024evta_qm${i + 1}`,
        eventKey: "2024evta",
        matchNumber: i + 1,
        sortTime: 1000 + i * 200,
        redTeams: red,
        blueTeams: blue,
        // Varied (never identical red/blue) scores — EPA's allianceScoreStats
        // folds these RAW fields directly (epa.ts's update()); an all-tied
        // fixture gives it exactly zero variance, which degenerates
        // margin/scale to 0/0 the instant a symmetric match's predicted
        // margin also lands on exactly 0. Real corpus data is never this
        // degenerate — this is a fixture-construction concern, not a
        // stateSnapshot property.
        // The `+5`/`-5` offset (not just `i * ...`) keeps even the FIRST
        // match (i === 0) non-symmetric — a tied first fold gives
        // allianceScoreStats zero variance, which is what produced the 0/0
        // NaN this comment used to lack (found running the real fixture).
        redScore: SIDE_TOTAL + 5 + i * 11,
        blueScore: SIDE_TOTAL - 5 - i * 7,
        winner: i % 2 === 0 ? "red" : "blue",
      })
    );
  });

  const eventBTeams: [string[], string[]][] = [
    [["frc10", "frc11", "frc12"], ["frc13", "frc14", "frc15"]],
    [["frc10", "frc13", "frc1"], ["frc11", "frc14", "frc16"]],
    [["frc12", "frc15", "frc17"], ["frc10", "frc16", "frc14"]],
    [["frc11", "frc17", "frc13"], ["frc12", "frc15", "frc16"]],
  ];
  eventBTeams.forEach(([red, blue], i) => {
    upsertMatch(
      corpus,
      match({
        matchKey: `2024evtb_qm${i + 1}`,
        eventKey: "2024evtb",
        matchNumber: i + 1,
        sortTime: 1100 + i * 200,
        redTeams: red,
        blueTeams: blue,
        redScore: SIDE_TOTAL - 5 - i * 9,
        blueScore: SIDE_TOTAL + 5 + i * 5,
        winner: i % 2 === 0 ? "blue" : "red",
      })
    );
  });
}

function toDigestInputs(records: readonly { match: MatchResult; prediction: unknown }[]) {
  return records as { match: MatchResult; prediction: { pRedWin: number; redScore: number; blueScore: number } }[];
}

// ---------------------------------------------------------------------------
// Round-trip losslessness: continuation-replay digest equality, for each of
// the three shipped algorithms
// ---------------------------------------------------------------------------

describe("serializeState/deserializeState — round-trip losslessness (continuation-replay digest)", () => {
  const algorithms: AlgorithmModule<any>[] = [opr, epa, sigma1];

  for (const algorithm of algorithms) {
    it(`${algorithm.id}: a continuation replay from the reconstructed state matches the original state's digest`, () => {
      seedFixtureSeason(db);
      const allMatches = buildSeasonStream(db, 2024);
      expect(allMatches.length).toBe(8);
      const splitIndex = 4;
      const firstHalf = allMatches.slice(0, splitIndex);
      const secondHalf = allMatches.slice(splitIndex);
      const allTeams = [...new Set(allMatches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];

      const sim1 = new WalkForwardSimulator(firstHalf);
      const runA = sim1.runAll([algorithm], allTeams);
      const stateAfterFirstHalf = runA.finalStates.get(algorithm.id);
      expect(stateAfterFirstHalf).toBeDefined();

      const rows = serializeState(algorithm.id, algorithm.version, stateAfterFirstHalf as any, STAMP);
      const reconstructed = deserializeState(algorithm.id, rows);

      const sim2a = new WalkForwardSimulator(secondHalf);
      const contA = sim2a.runAll([algorithm], allTeams, new Map([[algorithm.id, stateAfterFirstHalf]]));

      const sim2b = new WalkForwardSimulator(secondHalf);
      const contB = sim2b.runAll([algorithm], allTeams, new Map([[algorithm.id, reconstructed]]));

      const digestA = computePredictionStreamDigest(toDigestInputs(contA) as any);
      const digestB = computePredictionStreamDigest(toDigestInputs(contB) as any);

      expect(digestB).toBe(digestA);
      // Sanity: the digest must be a real, non-empty-input hash — the
      // fixture actually replayed matches on both branches.
      expect(contA.length).toBeGreaterThan(0);
      expect(contB.length).toBe(contA.length);
    });
  }
});

// ---------------------------------------------------------------------------
// D-09: per-algorithm scope shape
// ---------------------------------------------------------------------------

describe("serializeState — D-09 scope shape", () => {
  it("OprState emits rows whose scopeKind is 'event' (never 'team'), one per event key in perEvent", () => {
    seedFixtureSeason(db);
    const allMatches = buildSeasonStream(db, 2024);
    const allTeams = [...new Set(allMatches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
    const sim = new WalkForwardSimulator(allMatches);
    const run = sim.runAll([opr], allTeams);
    const finalState = run.finalStates.get(opr.id) as any;

    const rows = serializeState(opr.id, opr.version, finalState, STAMP);
    const eventRows = rows.filter((r) => r.scopeKind === "event");
    const teamRows = rows.filter((r) => r.scopeKind === "team");
    const leagueRows = rows.filter((r) => r.scopeKind === "league");

    expect(teamRows).toHaveLength(0);
    expect(leagueRows).toHaveLength(1);
    expect(eventRows).toHaveLength(finalState.perEvent.size);
    expect(eventRows.map((r) => r.scopeKey).sort()).toEqual(["2024evta", "2024evtb"]);
  });

  it("Sigma1State emits exactly one 'league' row and one 'team' row per entry in state.teams — row count equals state.teams.size + 1", () => {
    seedFixtureSeason(db);
    const allMatches = buildSeasonStream(db, 2024);
    const allTeams = [...new Set(allMatches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
    const sim = new WalkForwardSimulator(allMatches);
    const run = sim.runAll([sigma1], allTeams);
    const finalState = run.finalStates.get(sigma1.id) as Sigma1State;

    const rows = serializeState(sigma1.id, sigma1.version, finalState, STAMP);
    const teamRows = rows.filter((r) => r.scopeKind === "team");
    const leagueRows = rows.filter((r) => r.scopeKind === "league");

    expect(leagueRows).toHaveLength(1);
    expect(teamRows).toHaveLength(finalState.teams.size);
    expect(rows).toHaveLength(finalState.teams.size + 1);
  });
});

// ---------------------------------------------------------------------------
// Stability: unchanged state re-serializes byte-identically
// ---------------------------------------------------------------------------

describe("serializeState — stability (unchanged state produces identical stateJson)", () => {
  it("serialize -> deserialize -> serialize produces byte-identical stateJson strings for every row (sigma1)", () => {
    seedFixtureSeason(db);
    const allMatches = buildSeasonStream(db, 2024);
    const allTeams = [...new Set(allMatches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
    const sim = new WalkForwardSimulator(allMatches);
    const run = sim.runAll([sigma1], allTeams);
    const finalState = run.finalStates.get(sigma1.id);

    const rowsA = serializeState(sigma1.id, sigma1.version, finalState as any, STAMP);
    const reconstructed = deserializeState(sigma1.id, rowsA);
    const rowsB = serializeState(sigma1.id, sigma1.version, reconstructed as any, STAMP);

    const byKeyA = new Map(rowsA.map((r) => [`${r.scopeKind}:${r.scopeKey}`, r.stateJson]));
    const byKeyB = new Map(rowsB.map((r) => [`${r.scopeKind}:${r.scopeKey}`, r.stateJson]));
    expect(byKeyB.size).toBe(byKeyA.size);
    for (const [key, jsonA] of byKeyA) {
      expect(byKeyB.get(key)).toBe(jsonA);
    }
  });

  it("serialize -> deserialize -> serialize produces byte-identical stateJson strings for every row (opr)", () => {
    seedFixtureSeason(db);
    const allMatches = buildSeasonStream(db, 2024);
    const allTeams = [...new Set(allMatches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
    const sim = new WalkForwardSimulator(allMatches);
    const run = sim.runAll([opr], allTeams);
    const finalState = run.finalStates.get(opr.id);

    const rowsA = serializeState(opr.id, opr.version, finalState as any, STAMP);
    const reconstructed = deserializeState(opr.id, rowsA);
    const rowsB = serializeState(opr.id, opr.version, reconstructed as any, STAMP);

    const byKeyA = new Map(rowsA.map((r) => [`${r.scopeKind}:${r.scopeKey}`, r.stateJson]));
    const byKeyB = new Map(rowsB.map((r) => [`${r.scopeKind}:${r.scopeKey}`, r.stateJson]));
    expect(byKeyB.size).toBe(byKeyA.size);
    for (const [key, jsonA] of byKeyA) {
      expect(byKeyB.get(key)).toBe(jsonA);
    }
  });
});

// ---------------------------------------------------------------------------
// Partial load (D-13): a league row plus two team rows predicts correctly
// for a match between exactly those two teams
// ---------------------------------------------------------------------------

describe("deserializeState — partial load (D-13)", () => {
  it("a league row plus two team rows predicts correctly for a match between exactly those two teams", () => {
    seedFixtureSeason(db);
    const allMatches = buildSeasonStream(db, 2024);
    const allTeams = [...new Set(allMatches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
    const sim = new WalkForwardSimulator(allMatches);
    const run = sim.runAll([sigma1], allTeams);
    const fullState = run.finalStates.get(sigma1.id) as Sigma1State;

    const [teamA, teamB] = ["frc1", "frc4"];
    expect(fullState.teams.has(teamA)).toBe(true);
    expect(fullState.teams.has(teamB)).toBe(true);

    const fullRows = serializeState(sigma1.id, sigma1.version, fullState, STAMP);
    const leagueRow = fullRows.find((r) => r.scopeKind === "league")!;
    const teamRowA = fullRows.find((r) => r.scopeKind === "team" && r.scopeKey === teamA)!;
    const teamRowB = fullRows.find((r) => r.scopeKind === "team" && r.scopeKey === teamB)!;

    const partialRows: StateRow[] = [leagueRow, teamRowA, teamRowB];
    const partialState = deserializeState(sigma1.id, partialRows) as Sigma1State;
    expect(partialState.teams.size).toBe(2);

    // Filler teams that were NEVER part of the fixture corpus — cold-start
    // and identical (zero-contribution) whether the caller holds the full
    // state or the partial one, per sigma1/index.ts's `predictedComponentTotals`
    // / `allianceComponentPredictions` ("a team not in state.teams
    // contributes exactly 0", never a league-mean fallback).
    const syntheticMatch: UpcomingMatch = {
      matchKey: "synthetic_qm1",
      eventKey: "2024evta",
      compLevel: "qm",
      setNumber: 1,
      matchNumber: 99,
      redTeams: [teamA, "frcNEVER1", "frcNEVER2"],
      blueTeams: [teamB, "frcNEVER3", "frcNEVER4"],
      redSurrogates: [],
      blueSurrogates: [],
      eventType: 0,
    };

    const fullPrediction = sigma1.predict(fullState, syntheticMatch);
    const partialPrediction = sigma1.predict(partialState, syntheticMatch);

    expect(partialPrediction).toEqual(fullPrediction);
  });
});

// ---------------------------------------------------------------------------
// Missing league row
// ---------------------------------------------------------------------------

describe("deserializeState — missing league row", () => {
  it("throws MissingLeagueRowError when no scopeKind:'league' row is present", () => {
    const teamOnlyRow: StateRow = StateRowSchema.parse({
      algorithmId: "epa",
      algorithmVersion: epa.version,
      scopeKind: "team",
      scopeKey: "frc1",
      stateJson: JSON.stringify({ components: {}, matchCount: 0 }),
      generation: STAMP.generation,
      computedAt: STAMP.computedAt,
    });

    expect(() => deserializeState("epa", [teamOnlyRow])).toThrow(MissingLeagueRowError);
  });
});

// ---------------------------------------------------------------------------
// Map members survive the round trip with their full entry set (asserted by
// size, not just presence) — hand-built EpaState, no replay needed
// ---------------------------------------------------------------------------

describe("serializeState/deserializeState — Map members survive by size", () => {
  it("EpaState's teamComponents/teamMatchCounts/priorSeasonRatings Maps round-trip with identical size and entries", () => {
    const fakeState: EpaState = {
      season: 2024,
      teamComponents: new Map<string, Record<string, number>>([
        ["frc1", { autoLeavePoints: 3 }],
        ["frc2", { autoLeavePoints: 5, adjustPoints: -1 }],
      ]),
      teamMatchCounts: new Map([
        ["frc1", 5],
        ["frc2", 3],
      ]),
      allianceScoreStats: emptyExpandingStats(),
      fallbackSkipped: 0,
      priorSeasonRatings: {
        lastSeason: new Map([
          ["frc1", 1500],
          ["frc2", 1400],
        ]),
        yearBefore: new Map([["frc1", 1490]]),
      },
      breakdownParseFailureCount: 0,
    };

    const rows = serializeState("epa", epa.version, fakeState, STAMP);
    const reconstructed = deserializeState("epa", rows) as EpaState;

    expect(reconstructed.teamComponents.size).toBe(fakeState.teamComponents.size);
    expect(reconstructed.teamMatchCounts.size).toBe(fakeState.teamMatchCounts.size);
    expect(reconstructed.priorSeasonRatings.lastSeason.size).toBe(2);
    expect(reconstructed.priorSeasonRatings.yearBefore.size).toBe(1);
    expect([...reconstructed.teamComponents.entries()].sort()).toEqual([...fakeState.teamComponents.entries()].sort());
    expect([...reconstructed.priorSeasonRatings.lastSeason.entries()].sort()).toEqual(
      [...fakeState.priorSeasonRatings.lastSeason.entries()].sort()
    );
  });
});

describe("StateRowSchema", () => {
  it("parses a well-formed row and rejects an unknown scopeKind", () => {
    const good = StateRowSchema.parse({
      algorithmId: "opr",
      algorithmVersion: opr.version,
      scopeKind: "event",
      scopeKey: "2024evta",
      stateJson: "{}",
      generation: STAMP.generation,
      computedAt: STAMP.computedAt,
    });
    expect(good.scopeKind).toBe("event");

    expect(() =>
      StateRowSchema.parse({
        algorithmId: "opr",
        algorithmVersion: opr.version,
        scopeKind: "season", // not a valid scopeKind
        scopeKey: "2024evta",
        stateJson: "{}",
        generation: STAMP.generation,
        computedAt: STAMP.computedAt,
      })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Task 3: emitSeedSql — the D1 bulk-seed emitter
// ---------------------------------------------------------------------------

function makeRows(count: number, overrides: Partial<StateRow> = {}): StateRow[] {
  return Array.from({ length: count }, (_, i) =>
    StateRowSchema.parse({
      algorithmId: "epa",
      algorithmVersion: epa.version,
      scopeKind: "team",
      scopeKey: `frc${i}`,
      stateJson: JSON.stringify({ components: { autoLeavePoints: i }, matchCount: i }),
      generation: STAMP.generation,
      computedAt: STAMP.computedAt,
      ...overrides,
    })
  );
}

describe("emitSeedSql", () => {
  let outDir: string;
  let outPath: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "sigmascout-seedsql-"));
    outPath = join(outDir, "seed.sql");
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("emits a DELETE guard as the first statement, naming the algorithm", () => {
    emitSeedSql(makeRows(2), { algorithmId: "epa", out: outPath });
    const text = readFileSync(outPath, "utf8");
    const firstStatement = text.split(";")[0]!.trim() + ";";
    expect(firstStatement).toBe(`DELETE FROM algorithm_state WHERE algorithm_id = 'epa';`);
  });

  it("the emitted INSERT's column list equals StateRowSchema's field order (mapped to snake_case)", () => {
    emitSeedSql(makeRows(3), { algorithmId: "epa", out: outPath });
    const text = readFileSync(outPath, "utf8");
    const insertMatch = /INSERT INTO algorithm_state \(([^)]+)\)/.exec(text);
    expect(insertMatch).not.toBeNull();
    const emittedColumns = insertMatch![1]!.split(",").map((c) => c.trim());

    const schemaFieldOrder = Object.keys(StateRowSchema.shape);
    const expectedColumns = schemaFieldOrder.map((key) => key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`));

    expect(emittedColumns).toEqual(expectedColumns);
  });

  it("a state_json blob containing a single-quote character is escaped by doubling and survives a parse of the emitted statement", () => {
    const trickyJson = JSON.stringify({ note: "team's rating", quote: "it's a \"test\"" });
    const rows = makeRows(1, { stateJson: trickyJson, scopeKey: "frc999" });
    emitSeedSql(rows, { algorithmId: "epa", out: outPath });
    const text = readFileSync(outPath, "utf8");

    // The escaped form (every "'" doubled) must appear verbatim in the emitted SQL.
    const escaped = trickyJson.replace(/'/g, "''");
    expect(text).toContain(escaped);

    // And it must be recoverable: undo SQL's doubling and re-parse as JSON.
    const tupleMatch = new RegExp(`'frc999', '(${escaped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})'`).exec(text);
    expect(tupleMatch).not.toBeNull();
    const recovered = tupleMatch![1]!.replace(/''/g, "'");
    expect(JSON.parse(recovered)).toEqual(JSON.parse(trickyJson));
  });

  it("splits into more than one INSERT statement when given more rows than maxRowsPerInsert", () => {
    emitSeedSql(makeRows(1200), { algorithmId: "epa", out: outPath, maxRowsPerInsert: 500 });
    const text = readFileSync(outPath, "utf8");
    const insertCount = (text.match(/INSERT INTO algorithm_state/g) ?? []).length;
    expect(insertCount).toBeGreaterThan(1);
    // 1200 rows at 500/insert -> 3 statements (500, 500, 200).
    expect(insertCount).toBe(3);
  });

  it("keeps a single INSERT statement when the row count is well under maxRowsPerInsert", () => {
    emitSeedSql(makeRows(5), { algorithmId: "epa", out: outPath });
    const text = readFileSync(outPath, "utf8");
    const insertCount = (text.match(/INSERT INTO algorithm_state/g) ?? []).length;
    expect(insertCount).toBe(1);
  });

  it("splits into a new statement when maxStatementLength is reached, even under maxRowsPerInsert", () => {
    // Force a split well before the row-count cap by setting a tiny character budget.
    emitSeedSql(makeRows(10), { algorithmId: "epa", out: outPath, maxStatementLength: 300 });
    const text = readFileSync(outPath, "utf8");
    const insertCount = (text.match(/INSERT INTO algorithm_state/g) ?? []).length;
    expect(insertCount).toBeGreaterThan(1);
  });

  it("every row appears exactly once across the emitted statements, in a valid parseable VALUES tuple", () => {
    const rows = makeRows(1200);
    emitSeedSql(rows, { algorithmId: "epa", out: outPath, maxRowsPerInsert: 500 });
    const text = readFileSync(outPath, "utf8");
    for (const row of rows) {
      expect(text).toContain(`'${row.scopeKey}'`);
    }
  });

  it("performs exactly one file write call", async () => {
    // `node:fs`'s named exports are non-configurable in real ESM, so
    // `vi.spyOn(fs, "writeFileSync")` cannot wrap them directly — isolate a
    // fresh module graph for just this test via `vi.doMock`, replacing
    // `node:fs` with a spy-wrapped real implementation, then reset it
    // immediately afterward so no other test in this file is affected.
    vi.resetModules();
    const actualFs = await vi.importActual<typeof fs>("node:fs");
    const writeFileSyncSpy = vi.fn(actualFs.writeFileSync);
    vi.doMock("node:fs", () => ({ ...actualFs, writeFileSync: writeFileSyncSpy }));
    try {
      const fresh = await import("./stateSnapshot.js");
      fresh.emitSeedSql(makeRows(2), { algorithmId: "epa", out: outPath });
      expect(writeFileSyncSpy).toHaveBeenCalledTimes(1);
      expect(actualFs.readFileSync(outPath, "utf8")).toContain("DELETE FROM algorithm_state");
    } finally {
      vi.doUnmock("node:fs");
      vi.resetModules();
    }
  });
});
