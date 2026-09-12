/**
 * Proves the offline-to-online state handoff (D-12/D-13, plan 04-03 Task 2)
 * is lossless — not by deep-equalling two state objects, but by the same
 * standard Phase 3 uses for "these two runs are the same run"
 * (`computePredictionStreamDigest` over a continuation replay). Also covers
 * D-09's per-algorithm scope shape (event-scoped OPR vs. team-scoped
 * Sigma1/EPA), the stability property that lets a Worker skip a write for an
 * unchanged team, and the partial-load property D-13 requires.
 */
import type * as fs from "node:fs";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { epa } from "../core/algorithms/epa.js";
import { opr } from "../core/algorithms/opr.js";
import { spr } from "../core/algorithms/spr.js";
import { vpr, type Sigma1State } from "../core/algorithms/sigma1/index.js";
import type { EpaState } from "../core/algorithms/epa.js";
import type { AlgorithmModule, MatchResult, UpcomingMatch } from "../core/algorithms/types.js";
import { emptyExpandingStats } from "../core/scoring/expandingStats.js";
import { openCorpus, upsertEvent, upsertMatch, type Corpus } from "../corpus/db.js";
import type { CorpusEvent, CorpusMatch } from "../ingest/normalize.js";
import { buildSeasonStream, WalkForwardSimulator } from "./replay.js";
import { computePredictionStreamDigest } from "./promote.js";
import {
  LeagueRowShapeVersionError,
  MAX_LEAGUE_ROW_BYTES,
  MissingLeagueRowError,
  SeedRowTooLargeError,
  STATE_SNAPSHOT_SHAPE_VERSION,
  StateRowSchema,
  deserializeState,
  emitSeedSql,
  readSigmaBeliefs,
  readSigmaPopulation,
  readSwingBeliefs,
  serializeState,
  withSigmaBeliefs,
  withSigmaPopulation,
  withSwingBeliefs,
  type StateRow,
  type StateStamp,
  readRpBeliefs,
  withRpBeliefs,
} from "./stateSnapshot.js";
import { emptyEpaWeekOneState } from "../core/algorithms/epaWeekOne.js";

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
    redScore: SIDE_TOTAL,
    blueScore: SIDE_TOTAL,
    redRpEarned: 2,
    blueRpEarned: 0,
    hasScoreBreakdown: true,
    scoreBreakdownRaw: rawBreakdown2024(PER_COMPONENT),
    videoKey: null,
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
  const algorithms: AlgorithmModule<any>[] = [opr, epa, vpr];

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
  it("OprState's per-event accumulation emits 'event' rows (never a per-team accumulation row); its lastEventByTeam bookkeeping emits one 'team' row per tracked team (plan 04-08, D-13)", () => {
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

    // D-09 still holds: OPR's own per-event RATING computation (observations/
    // ratings) is event-scoped, never team-scoped. Plan 04-08 only moves the
    // AUXILIARY lastEventByTeam bookkeeping map into its own team rows — it
    // is not per-event accumulated state.
    expect(leagueRows).toHaveLength(1);
    expect(eventRows).toHaveLength(finalState.perEvent.size);
    expect(eventRows.map((r) => r.scopeKey).sort()).toEqual(["2024evta", "2024evtb"]);
    expect(teamRows).toHaveLength(finalState.lastEventByTeam.size);
    expect(teamRows.map((r) => r.scopeKey).sort()).toEqual([...finalState.lastEventByTeam.keys()].sort());
  });

  it("Sigma1State emits one 'league' row and one 'team' row per entry in state.teams, and NO 'event' row at all (D-Y3)", () => {
    // THE RULE REVERSED HERE at shape version 7. Between quick task
    // 260902-varopr and 260903-750 Sigma1 was event-scoped too, because the
    // published `±` was an event-wide solve whose normal equations had to be
    // stored per event. D-Y3 replaced that with ONE RUNNING NUMBER PER TEAM
    // PER METRIC KEY, which rides the team rows a Worker already loads — so
    // there is nothing left for an event row to carry.
    //
    // Asserted as an explicit ZERO rather than by omitting the check, because
    // an event row emitted here would be a silent cost: `scheduled.ts`'s
    // `EVENT_SCOPED_ALGORITHM_IDS` dropped "vpr" in the same task, so a
    // re-added row would be WRITTEN by the pipeline and never READ by a live
    // tick — a divergence that leaves both halves looking healthy.
    seedFixtureSeason(db);
    const allMatches = buildSeasonStream(db, 2024);
    const allTeams = [...new Set(allMatches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
    const sim = new WalkForwardSimulator(allMatches);
    const run = sim.runAll([vpr], allTeams);
    const finalState = run.finalStates.get(vpr.id) as Sigma1State;

    const rows = serializeState(vpr.id, vpr.version, finalState, STAMP);
    const teamRows = rows.filter((r) => r.scopeKind === "team");
    const leagueRows = rows.filter((r) => r.scopeKind === "league");
    const eventRows = rows.filter((r) => r.scopeKind === "event");

    expect(leagueRows).toHaveLength(1);
    expect(teamRows).toHaveLength(finalState.teams.size);
    expect(eventRows).toHaveLength(0);
    expect(rows).toHaveLength(finalState.teams.size + 1);
    // Non-vacuity: the fixture really did fold multiple events, so "no event
    // rows" is a statement about the SHAPE rather than about an empty run.
    expect(new Set([...finalState.teams.values()].map((t) => t.lastEventKey)).size).toBeGreaterThan(1);
    // And the swing that replaced them is genuinely present on the team rows —
    // the row set did not merely shrink, the state moved.
    expect(teamRows.filter((r) => r.stateJson.includes("swing")).length).toBe(teamRows.length);
  });
});

// ---------------------------------------------------------------------------
// Stability: unchanged state re-serializes byte-identically
// ---------------------------------------------------------------------------

describe("serializeState — stability (unchanged state produces identical stateJson)", () => {
  it("serialize -> deserialize -> serialize produces byte-identical stateJson strings for every row (vpr)", () => {
    seedFixtureSeason(db);
    const allMatches = buildSeasonStream(db, 2024);
    const allTeams = [...new Set(allMatches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
    const sim = new WalkForwardSimulator(allMatches);
    const run = sim.runAll([vpr], allTeams);
    const finalState = run.finalStates.get(vpr.id);

    const rowsA = serializeState(vpr.id, vpr.version, finalState as any, STAMP);
    const reconstructed = deserializeState(vpr.id, rowsA);
    const rowsB = serializeState(vpr.id, vpr.version, reconstructed as any, STAMP);

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
    const run = sim.runAll([vpr], allTeams);
    const fullState = run.finalStates.get(vpr.id) as Sigma1State;

    const [teamA, teamB] = ["frc1", "frc4"];
    expect(fullState.teams.has(teamA)).toBe(true);
    expect(fullState.teams.has(teamB)).toBe(true);

    const fullRows = serializeState(vpr.id, vpr.version, fullState, STAMP);
    const leagueRow = fullRows.find((r) => r.scopeKind === "league")!;
    const teamRowA = fullRows.find((r) => r.scopeKind === "team" && r.scopeKey === teamA)!;
    const teamRowB = fullRows.find((r) => r.scopeKind === "team" && r.scopeKey === teamB)!;

    const partialRows: StateRow[] = [leagueRow, teamRowA, teamRowB];
    const partialState = deserializeState(vpr.id, partialRows) as Sigma1State;
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
      week: null,
    };

    const fullPrediction = vpr.predict(fullState, syntheticMatch);
    const partialPrediction = vpr.predict(partialState, syntheticMatch);

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
// Plan 04-08 (D-13): a league row's payload must declare the current
// snapshot shape version — the retired shape (per-team maps living inside
// the league row) must be unreadable, loudly, never silently parsed with
// its per-team data discarded.
// ---------------------------------------------------------------------------

describe("deserializeState — league row shape version (D-13, plan 04-08)", () => {
  it("throws LeagueRowShapeVersionError when the league row has no snapshotShapeVersion at all (the retired pre-04-08 shape)", () => {
    const retiredShapeLeagueRow: StateRow = StateRowSchema.parse({
      algorithmId: "epa",
      algorithmVersion: epa.version,
      scopeKind: "league",
      scopeKey: "league",
      // The retired shape: priorSeasonRatings lived INSIDE the league row,
      // and no snapshotShapeVersion field existed at all.
      stateJson: JSON.stringify({
        season: 2024,
        allianceScoreStats: emptyExpandingStats(),
        fallbackSkipped: 0,
        priorSeasonRatings: { lastSeason: [], yearBefore: [] },
        breakdownParseFailureCount: 0,
      }),
      generation: STAMP.generation,
      computedAt: STAMP.computedAt,
    });

    expect(() => deserializeState("epa", [retiredShapeLeagueRow])).toThrow(LeagueRowShapeVersionError);
  });

  it("throws LeagueRowShapeVersionError when the league row declares a stale numeric snapshotShapeVersion", () => {
    const staleRow: StateRow = StateRowSchema.parse({
      algorithmId: "opr",
      algorithmVersion: opr.version,
      scopeKind: "league",
      scopeKey: "league",
      stateJson: JSON.stringify({ snapshotShapeVersion: STATE_SNAPSHOT_SHAPE_VERSION - 1 }),
      generation: STAMP.generation,
      computedAt: STAMP.computedAt,
    });

    expect(() => deserializeState("opr", [staleRow])).toThrow(LeagueRowShapeVersionError);
  });

  it("a current-shape league row (declaring the real snapshotShapeVersion) is accepted, not rejected", () => {
    const rows = serializeState("opr", opr.version, opr.initState([]) as any, STAMP);
    expect(() => deserializeState("opr", rows)).not.toThrow();
  });

  it("STATE_SNAPSHOT_SHAPE_VERSION is 15, and a league row declaring ANY earlier shape throws (shape 15 added the live Worker's ranking-point beliefs, plan 09-08, 2026-09-11)", () => {
    // Pinned by literal value, not relative to the constant. Every earlier
    // shape must fail LOUDLY at load rather than deserialize into a field set
    // that no longer matches `Sigma1State`: shape 3 predates
    // `contributionStats` entirely; shape 4 CARRIES `contributionStats` and
    // `lastContribution`, retired at 260902-varopr; shape 5 has no
    // `scopeKind: "event"` rows; shape 6 has them but its TEAM rows carry no
    // `swing`, so it would deserialize into teams whose accumulator is absent
    // and `teamMetrics` would publish no `±` at all — SILENTLY, since D-Y2
    // makes "never folded" a legal, publishable-as-nothing state; shape 7 has
    // `swing` but no `elimScoreOffset`, so it would deserialize the ELIM-OFF
    // accumulator as `undefined` and the first fold would throw rather than
    // publish a NaN — a real improvement, but only if this check itself is
    // current (`STATE_SNAPSHOT_SHAPE_VERSION`'s own 7 -> 8 history entry);
    // shape 9's team rows carry no `sigmascoutSwing`, which repeats shape 6's
    // failure in a worse place — "never folded" is a LEGAL Swing Factor state
    // meaning "too little play to say", so a stale row deserializes into a
    // team that looks brand new while the offline publisher has a band for
    // those very same matches. Live and offline would then disagree with both
    // sides looking healthy.
    //
    // Shape 10's team rows carry `sigmascoutSwing` but no `sigmascoutSigma`,
    // and its league row carries no `sigmascoutSigmaPopulation`. A stale shape
    // 10 row therefore deserializes into a team with NO Sigma history at all
    // while the offline publisher has a Sigma band for those same matches, and
    // additionally loses the population the talent prior needs — so every band
    // it did produce would come from the flat prior instead of the talent
    // scaled one. Two silent divergences from one stale row, which is why this
    // must throw rather than degrade.
    //
    // Shape 14's team rows carry no `sigmascoutRp` at all, so a stale shape
    // 14 row deserializes into a team with NO ranking-point history while the
    // offline publisher has a full season's of it for those same matches. The
    // live tick would then price every pmf from that event's matches alone.
    // Worse than its siblings in one specific way: the resulting pmf is still
    // a VALID probability distribution — it sums to 1, passes the schema's own
    // refinement and renders without complaint — so nothing downstream can
    // flag it. This check is the only thing that makes it loud.
    //
    // `apps/worker/src/stateStore.ts` filters rows by `algorithm_id` only and
    // never by `algorithm_version`, so bumping the algorithm version does not
    // by itself make a stale seeded row unreachable — this check is what does.
    // Shape 11's EPA league row carries no `carrySeedMean` and its team rows no
    // `carryPending`, so a stale shape-11 row makes the season-boundary rescale
    // ratio unreadable and DISABLES the rescale on live traffic while the
    // offline publisher applies it — the same silent live/offline split as
    // every case above, on every carried rating at every boundary.
    //
    // Shape 12's EPA league row carries no `weekOne`, so a stale shape-12 row
    // leaves `epa@9.0.0+baseline`'s FROZEN WEEK-1 aggregate permanently
    // unavailable: the Worker would run the live expanding estimate for the
    // whole season while the offline publisher ran the frozen week-1 constant,
    // and the two would disagree on every prediction from week 2 onward with
    // no error, no NaN and no malformed row to find. Same silent live/offline
    // split, on the win-probability denominator this time.
    //
    // Shape 13's EPA league row carries no foul accumulators, so a stale
    // shape-13 row leaves `epa@10.0.0+baseline`'s foul rate permanently at
    // `EPA_FALLBACK_FOUL_RATE`: the Worker would publish every predicted score
    // at its plain no-foul total while the offline publisher applied the frozen
    // week-1 rate. Worse than its predecessors in one respect — a zero rate is
    // a LEGAL rate, so nothing downstream could flag it as suspicious.
    expect(STATE_SNAPSHOT_SHAPE_VERSION).toBe(15);

    // NOT an iteration over a list that can silently skip: the range is derived
    // from the current version, so a future bump cannot leave the newest stale
    // shape untested by forgetting to append it here.
    const staleVersions = Array.from({ length: STATE_SNAPSHOT_SHAPE_VERSION - 3 }, (_, i) => i + 3);
    expect(staleVersions.at(-1)).toBe(STATE_SNAPSHOT_SHAPE_VERSION - 1);
    for (const staleVersion of staleVersions) {
      const staleRow: StateRow = StateRowSchema.parse({
        algorithmId: "vpr",
        algorithmVersion: vpr.version,
        scopeKind: "league",
        scopeKey: "league",
        stateJson: JSON.stringify({ snapshotShapeVersion: staleVersion }),
        generation: STAMP.generation,
        computedAt: STAMP.computedAt,
      });
      expect(() => deserializeState("vpr", [staleRow]), `shape ${staleVersion}`).toThrow(LeagueRowShapeVersionError);
    }
  });
});

// ---------------------------------------------------------------------------
// Plan 04-08 (D-13): a league row's byte size must be independent of the
// season's team count, and stay at or under MAX_LEAGUE_ROW_BYTES — the
// actual defect this plan fixes (sigma1 253.1 KB, epa 246.0 KB, opr 84.9 KB, [pre-rename]
// measured 2026-08-22, before this plan).
// ---------------------------------------------------------------------------

function leagueRowOf(rows: readonly StateRow[]): StateRow {
  const row = rows.find((r) => r.scopeKind === "league");
  if (!row) throw new Error("leagueRowOf: no scopeKind:'league' row present");
  return row;
}

/** Builds a `targetCount`-entry map by cycling through `source`'s own values (or, if `source` is empty, a fixed placeholder) under fresh keys — the league-row content this plan cares about must be independent of HOW MANY team entries exist, not of what specific teams they name. */
function expandMap<V>(source: ReadonlyMap<string, V>, targetCount: number, keyPrefix: string, placeholder?: V): Map<string, V> {
  const sourceEntries = source.size > 0 ? [...source.values()] : placeholder !== undefined ? [placeholder] : [];
  const result = new Map<string, V>();
  for (let i = 0; i < targetCount && sourceEntries.length > 0; i++) {
    result.set(`${keyPrefix}${i}`, sourceEntries[i % sourceEntries.length]!);
  }
  return result;
}

describe("serializeState — league row byte size is independent of team count (D-13, plan 04-08)", () => {
  it("vpr: league row byte length is identical at N teams and 10N teams, and at/under MAX_LEAGUE_ROW_BYTES", () => {
    seedFixtureSeason(db);
    const allMatches = buildSeasonStream(db, 2024);
    const allTeams = [...new Set(allMatches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
    const sim = new WalkForwardSimulator(allMatches);
    const baseState = sim.runAll([vpr], allTeams).finalStates.get(vpr.id) as Sigma1State;

    const smallTeams = expandMap(baseState.teams, 5, "frcSmall");
    const largeTeams = expandMap(baseState.teams, 50, "frcLarge");
    const priorSource = new Map([...baseState.teams.keys()].map((k) => [k, 1500] as const));
    const smallPrior = expandMap(priorSource, 5, "frcSmallPrior");
    const largePrior = expandMap(priorSource, 50, "frcLargePrior");

    const smallState: Sigma1State = { ...baseState, teams: smallTeams, priorSeasonRatings: { lastSeason: smallPrior, yearBefore: new Map() } };
    const largeState: Sigma1State = { ...baseState, teams: largeTeams, priorSeasonRatings: { lastSeason: largePrior, yearBefore: new Map() } };

    const smallLeague = leagueRowOf(serializeState(vpr.id, vpr.version, smallState, STAMP));
    const largeLeague = leagueRowOf(serializeState(vpr.id, vpr.version, largeState, STAMP));

    expect(Buffer.byteLength(largeLeague.stateJson)).toBe(Buffer.byteLength(smallLeague.stateJson));
    expect(Buffer.byteLength(smallLeague.stateJson)).toBeLessThanOrEqual(MAX_LEAGUE_ROW_BYTES);
  });

  it("epa: league row byte length is identical at N teams and 10N teams, and at/under MAX_LEAGUE_ROW_BYTES", () => {
    seedFixtureSeason(db);
    const allMatches = buildSeasonStream(db, 2024);
    const allTeams = [...new Set(allMatches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
    const sim = new WalkForwardSimulator(allMatches);
    const baseState = sim.runAll([epa], allTeams).finalStates.get(epa.id) as EpaState;

    const smallComponents = expandMap(baseState.teamComponents, 5, "frcSmall");
    const largeComponents = expandMap(baseState.teamComponents, 50, "frcLarge");
    const smallCounts = expandMap(baseState.teamMatchCounts, 5, "frcSmall", 0);
    const largeCounts = expandMap(baseState.teamMatchCounts, 50, "frcLarge", 0);

    const smallState: EpaState = { ...baseState, teamComponents: smallComponents, teamMatchCounts: smallCounts };
    const largeState: EpaState = { ...baseState, teamComponents: largeComponents, teamMatchCounts: largeCounts };

    const smallLeague = leagueRowOf(serializeState(epa.id, epa.version, smallState, STAMP));
    const largeLeague = leagueRowOf(serializeState(epa.id, epa.version, largeState, STAMP));

    expect(Buffer.byteLength(largeLeague.stateJson)).toBe(Buffer.byteLength(smallLeague.stateJson));
    expect(Buffer.byteLength(smallLeague.stateJson)).toBeLessThanOrEqual(MAX_LEAGUE_ROW_BYTES);
  });

  it("opr: league row byte length is identical at N teams and 10N teams, and at/under MAX_LEAGUE_ROW_BYTES", () => {
    seedFixtureSeason(db);
    const allMatches = buildSeasonStream(db, 2024);
    const allTeams = [...new Set(allMatches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
    const sim = new WalkForwardSimulator(allMatches);
    const baseState = sim.runAll([opr], allTeams).finalStates.get(opr.id) as any;

    const smallLastEvent = expandMap(baseState.lastEventByTeam, 5, "frcSmall");
    const largeLastEvent = expandMap(baseState.lastEventByTeam, 50, "frcLarge");

    const smallState = { ...baseState, lastEventByTeam: smallLastEvent };
    const largeState = { ...baseState, lastEventByTeam: largeLastEvent };

    const smallLeague = leagueRowOf(serializeState(opr.id, opr.version, smallState, STAMP));
    const largeLeague = leagueRowOf(serializeState(opr.id, opr.version, largeState, STAMP));

    expect(Buffer.byteLength(largeLeague.stateJson)).toBe(Buffer.byteLength(smallLeague.stateJson));
    expect(Buffer.byteLength(smallLeague.stateJson)).toBeLessThanOrEqual(MAX_LEAGUE_ROW_BYTES);
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
      allianceNoFoulStats: emptyExpandingStats(),
      allianceFoulStats: emptyExpandingStats(),
      weekOne: emptyEpaWeekOneState(),
      fallbackSkipped: 0,
      priorSeasonRatings: {
        lastSeason: new Map([
          ["frc1", 1500],
          ["frc2", 1400],
          // frc3 has a prior-season rating but NO current-season entry in
          // teamComponents/teamMatchCounts above — plan 04-08's required
          // "prior-rating-only team still gets a row of its own" property.
          ["frc3", 1350],
        ]),
        yearBefore: new Map([["frc1", 1490]]),
      },
      breakdownParseFailureCount: 0,
      carrySeedMean: Number.NaN,
      carryPending: new Set<string>(),
    };

    const rows = serializeState("epa", epa.version, fakeState, STAMP);
    const reconstructed = deserializeState("epa", rows) as EpaState;

    expect(reconstructed.teamComponents.size).toBe(fakeState.teamComponents.size);
    expect(reconstructed.teamMatchCounts.size).toBe(fakeState.teamMatchCounts.size);
    expect(reconstructed.priorSeasonRatings.lastSeason.size).toBe(3);
    expect(reconstructed.priorSeasonRatings.yearBefore.size).toBe(1);
    expect([...reconstructed.teamComponents.entries()].sort()).toEqual([...fakeState.teamComponents.entries()].sort());
    expect([...reconstructed.priorSeasonRatings.lastSeason.entries()].sort()).toEqual(
      [...fakeState.priorSeasonRatings.lastSeason.entries()].sort()
    );
    // frc3 gets its own row (never dropped) but contributes NO current-season
    // state — it must not appear in teamComponents/teamMatchCounts.
    expect(reconstructed.teamComponents.has("frc3")).toBe(false);
    expect(reconstructed.teamMatchCounts.has("frc3")).toBe(false);
    expect(reconstructed.priorSeasonRatings.lastSeason.get("frc3")).toBe(1350);

    const frc3Row = rows.find((r) => r.scopeKind === "team" && r.scopeKey === "frc3")!;
    expect(frc3Row).toBeDefined();
    expect(JSON.parse(frc3Row.stateJson)).not.toHaveProperty("current");
  });

  it("Sigma1State's priorSeasonRatings round-trips including a team present ONLY in priorSeasonRatings (no current-season state) — plan 04-08, D-13", () => {
    seedFixtureSeason(db);
    const allMatches = buildSeasonStream(db, 2024);
    const allTeams = [...new Set(allMatches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
    const sim = new WalkForwardSimulator(allMatches);
    const baseState = sim.runAll([vpr], allTeams).finalStates.get(vpr.id) as Sigma1State;
    expect(baseState.teams.has("frcGHOST")).toBe(false);

    const stateWithGhost: Sigma1State = {
      ...baseState,
      priorSeasonRatings: {
        lastSeason: new Map([...baseState.priorSeasonRatings.lastSeason, ["frcGHOST", 1234.5]]),
        yearBefore: new Map([...baseState.priorSeasonRatings.yearBefore, ["frcGHOST", 1200.5]]),
      },
    };

    const rows = serializeState(vpr.id, vpr.version, stateWithGhost, STAMP);
    const ghostRow = rows.find((r) => r.scopeKind === "team" && r.scopeKey === "frcGHOST");
    expect(ghostRow).toBeDefined();
    expect(JSON.parse(ghostRow!.stateJson)).not.toHaveProperty("current");

    const reconstructed = deserializeState(vpr.id, rows) as Sigma1State;
    expect(reconstructed.teams.has("frcGHOST")).toBe(false);
    expect(reconstructed.teams.size).toBe(baseState.teams.size);
    expect(reconstructed.priorSeasonRatings.lastSeason.size).toBe(stateWithGhost.priorSeasonRatings.lastSeason.size);
    expect(reconstructed.priorSeasonRatings.yearBefore.size).toBe(stateWithGhost.priorSeasonRatings.yearBefore.size);
    expect(reconstructed.priorSeasonRatings.lastSeason.get("frcGHOST")).toBe(1234.5);
    expect(reconstructed.priorSeasonRatings.yearBefore.get("frcGHOST")).toBe(1200.5);
  });

  it("OprState's lastEventByTeam round-trips with identical size and entries (plan 04-08, D-13)", () => {
    seedFixtureSeason(db);
    const allMatches = buildSeasonStream(db, 2024);
    const allTeams = [...new Set(allMatches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
    const sim = new WalkForwardSimulator(allMatches);
    const finalState = sim.runAll([opr], allTeams).finalStates.get(opr.id) as any;
    expect(finalState.lastEventByTeam.size).toBeGreaterThan(0);

    const rows = serializeState(opr.id, opr.version, finalState, STAMP);
    const reconstructed = deserializeState(opr.id, rows) as any;

    expect(reconstructed.lastEventByTeam.size).toBe(finalState.lastEventByTeam.size);
    expect([...reconstructed.lastEventByTeam.entries()].sort()).toEqual([...finalState.lastEventByTeam.entries()].sort());
  });

  it("OprState's allianceScoreStats round-trips with identical count/mean/m2 (D-Q4)", () => {
    // The league-scoped expanding accumulator behind OPR's logistic scale. If
    // it did not survive the D1 round-trip, a re-seeded Worker would silently
    // predict from the cold-start fallback scale for the rest of the season.
    seedFixtureSeason(db);
    const allMatches = buildSeasonStream(db, 2024);
    const allTeams = [...new Set(allMatches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
    const sim = new WalkForwardSimulator(allMatches);
    const finalState = sim.runAll([opr], allTeams).finalStates.get(opr.id) as any;
    // Non-vacuity: a zeroed accumulator would round-trip trivially.
    expect(finalState.allianceScoreStats.count).toBeGreaterThan(1);

    const rows = serializeState(opr.id, opr.version, finalState, STAMP);
    const reconstructed = deserializeState(opr.id, rows) as any;

    expect(reconstructed.allianceScoreStats.count).toBe(finalState.allianceScoreStats.count);
    expect(reconstructed.allianceScoreStats.mean).toBe(finalState.allianceScoreStats.mean);
    expect(reconstructed.allianceScoreStats.m2).toBe(finalState.allianceScoreStats.m2);
  });

  it("no retired contribution field survives anywhere in a serialized Sigma1 team row (D-V1, quick task 260902-varopr)", () => {
    // The 4 -> 5 bump exists because the team payload's field set SHRANK.
    // Asserting the absence is what stops a partial revert — a re-added field
    // on `Sigma1TeamState` that `sigma1TeamStateToJson` still copies — from
    // reintroducing the retired estimator's state one commit at a time while
    // every other test stays green.
    seedFixtureSeason(db);
    const allMatches = buildSeasonStream(db, 2024);
    const allTeams = [...new Set(allMatches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
    const sim = new WalkForwardSimulator(allMatches);
    const finalState = sim.runAll([vpr], allTeams).finalStates.get(vpr.id) as Sigma1State;

    // Non-vacuity: an empty team set would satisfy the loop below trivially.
    expect(finalState.teams.size).toBeGreaterThan(0);

    const rows = serializeState(vpr.id, vpr.version, finalState, STAMP);
    const teamRows = rows.filter((r) => r.scopeKind === "team");
    expect(teamRows.length).toBeGreaterThan(0);
    for (const row of teamRows) {
      expect(row.stateJson, `${row.scopeKey} carries no contributionStats`).not.toContain("contributionStats");
      expect(row.stateJson, `${row.scopeKey} carries no lastContribution`).not.toContain("lastContribution");
    }
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

  // Plan 04-08 (D-13): the actual defect this plan fixes — before the
  // reshape, sigma1/epa's priorSeasonRatings and opr's lastEventByTeam living
  // inside the league row made a real season-scale seed throw
  // SeedRowTooLargeError at emit time (measured 2026-08-22: sigma1 253.1 KB, [pre-rename]
  // epa 246.0 KB league rows). This asserts none of the three published
  // algorithms hits that at REALISTIC season scale — 04-CONTEXT.md's own
  // measured team-count ceiling (3,787 in 2025), not a token handful of rows.
  it("serializing a realistic season-scale sigma1/epa/opr state and passing rows to emitSeedSql raises no SeedRowTooLargeError (D-13)", () => {
    seedFixtureSeason(db);
    const allMatches = buildSeasonStream(db, 2024);
    const allTeams = [...new Set(allMatches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
    const REALISTIC_TEAM_COUNT = 3800; // 04-CONTEXT.md's measured 2025 peak (3,787)

    const vprBase = new WalkForwardSimulator(allMatches).runAll([vpr], allTeams).finalStates.get(vpr.id) as Sigma1State;
    const vprPriorSource = new Map([...vprBase.teams.keys()].map((k) => [k, 1500] as const));
    const vprScaled: Sigma1State = {
      ...vprBase,
      teams: expandMap(vprBase.teams, REALISTIC_TEAM_COUNT, "frcS1_"),
      priorSeasonRatings: { lastSeason: expandMap(vprPriorSource, REALISTIC_TEAM_COUNT, "frcS1_"), yearBefore: new Map() },
    };
    expect(() => emitSeedSql(serializeState(vpr.id, vpr.version, vprScaled, STAMP), { algorithmId: "vpr", out: outPath })).not.toThrow();

    const epaBase = new WalkForwardSimulator(allMatches).runAll([epa], allTeams).finalStates.get(epa.id) as EpaState;
    const epaPriorSource = new Map([...epaBase.teamComponents.keys()].map((k) => [k, 1500] as const));
    const epaScaled: EpaState = {
      ...epaBase,
      teamComponents: expandMap(epaBase.teamComponents, REALISTIC_TEAM_COUNT, "frcEpa_"),
      teamMatchCounts: expandMap(epaBase.teamMatchCounts, REALISTIC_TEAM_COUNT, "frcEpa_", 0),
      priorSeasonRatings: { lastSeason: expandMap(epaPriorSource, REALISTIC_TEAM_COUNT, "frcEpa_"), yearBefore: new Map() },
    };
    expect(() => emitSeedSql(serializeState(epa.id, epa.version, epaScaled, STAMP), { algorithmId: "epa", out: outPath })).not.toThrow();

    const oprBase = new WalkForwardSimulator(allMatches).runAll([opr], allTeams).finalStates.get(opr.id) as any;
    const oprScaled = { ...oprBase, lastEventByTeam: expandMap(oprBase.lastEventByTeam, REALISTIC_TEAM_COUNT, "frcOpr_") };
    expect(() => emitSeedSql(serializeState(opr.id, opr.version, oprScaled, STAMP), { algorithmId: "opr", out: outPath })).not.toThrow();
  });

  // D1 rejects the whole import with `statement too long: SQLITE_TOOBIG` once
  // any single statement passes 100,000 bytes. The emitter's default cap was
  // 4,000,000 until plan 04-07 — 40x over — so every seed this project had
  // ever produced was unimportable. Nothing caught it because no test asserted
  // the property the importer actually enforces, and no plan ran the import.
  // These two tests assert it directly, at the boundary and past it.
  const D1_STATEMENT_LIMIT = 100_000;

  it("no emitted statement exceeds D1's 100,000-byte per-statement limit, even when the rows would batch into one much larger statement", () => {
    // 400 rows x ~2 KB of state_json each = ~800 KB of tuples: comfortably
    // more than one statement's worth, and under the old 4 MB default it all
    // batched into a single unimportable statement.
    const fatRows = makeRows(400).map((row, i) =>
      StateRowSchema.parse({ ...row, scopeKey: `frc${i}`, stateJson: JSON.stringify({ blob: "x".repeat(2000) }) })
    );
    emitSeedSql(fatRows, { algorithmId: "epa", out: outPath });

    const statements = readFileSync(outPath, "utf8")
      .split(/;\s*\n/)
      .filter((s) => s.trim().length > 0);

    expect(statements.length).toBeGreaterThan(1);
    for (const statement of statements) {
      expect(statement.length).toBeLessThan(D1_STATEMENT_LIMIT);
    }
  });

  it("throws SeedRowTooLargeError, naming the row, when one row alone exceeds the budget — batching cannot split a single row", () => {
    const oversized = makeRows(1, {
      algorithmId: "vpr",
      scopeKind: "league",
      scopeKey: "league",
      stateJson: JSON.stringify({ priorSeasonRatings: "x".repeat(200_000) }),
    });

    expect(() => emitSeedSql(oversized, { algorithmId: "vpr", out: outPath })).toThrow(SeedRowTooLargeError);
    // The message must identify WHICH row, or an operator cannot act on it.
    expect(() => emitSeedSql(oversized, { algorithmId: "vpr", out: outPath })).toThrow(/scopeKey="league"/);
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

describe("deserializeBprState — shape-version guard (quick task 260908-5wd)", () => {
  // BPR was the one algorithm skipping the check every other algorithm makes,
  // so a stale row would have been READ rather than rejected. `readScopedState`
  // filters on algorithm_id alone and never on algorithm_version, so this guard
  // is the only thing between an old row and a live fold.
  it("throws LeagueRowShapeVersionError for a BPR league row declaring an older shape", () => {
    const rows = [
      {
        algorithmId: "spr",
        algorithmVersion: "1.0.0+baseline",
        generation: "g",
        computedAt: "2026-09-08T00:00:00.000Z",
        scopeKind: "league" as const,
        scopeKey: "league",
        stateJson: JSON.stringify({
          snapshotShapeVersion: STATE_SNAPSHOT_SHAPE_VERSION - 1,
          season: 2026,
          logTau: 0,
          scale: 1,
          scaleCount: 1,
          phaseScale: {},
          phaseScaleCount: {},
        }),
      },
    ];
    expect(() => deserializeState("spr", rows)).toThrow(LeagueRowShapeVersionError);
  });

  it("accepts a BPR league row declaring the current shape", () => {
    const rows = [
      {
        algorithmId: "spr",
        algorithmVersion: "1.0.0+baseline",
        generation: "g",
        computedAt: "2026-09-08T00:00:00.000Z",
        scopeKind: "league" as const,
        scopeKey: "league",
        stateJson: JSON.stringify({
          snapshotShapeVersion: STATE_SNAPSHOT_SHAPE_VERSION,
          season: 2026,
          logTau: 0,
          scale: 1,
          scaleCount: 1,
          phaseScale: {},
          phaseScaleCount: {},
        }),
      },
    ];
    expect(() => deserializeState("spr", rows)).not.toThrow();
  });
});

describe("Sigma Score belief and population persistence (shape 11)", () => {
  const BELIEF = { meanWeight: 3.25, mean: 8.5, varWeight: 2.75, sumSquares: 91.5, talent: 42.25 };
  const POPULATION = { sumSquares: 12345.5, talentSquares: 98765.25, count: 4321 };

  function teamRows(): StateRow[] {
    return serializeState("spr", spr.version, spr.initState(["frc1", "frc2"]) as any, STAMP);
  }

  it("round-trips a belief through withSigmaBeliefs and readSigmaBeliefs unchanged", () => {
    const rows = withSigmaBeliefs(teamRows(), new Map([["frc1", BELIEF]]));
    expect(readSigmaBeliefs(rows).get("frc1")).toEqual(BELIEF);
  });

  it("leaves a team with no belief absent rather than writing a zero one", () => {
    const rows = withSigmaBeliefs(teamRows(), new Map([["frc1", BELIEF]]));
    const read = readSigmaBeliefs(rows);
    expect(read.has("frc2")).toBe(false);
  });

  it("SKIPS a partially written belief entirely -- a part-filled one would produce a plausible but wrong band", () => {
    const rows = teamRows().map((row) =>
      row.scopeKind === "team" && row.scopeKey === "frc1"
        ? { ...row, stateJson: JSON.stringify({ ...JSON.parse(row.stateJson), sigmascoutSigma: { meanWeight: 1, mean: 2 } }) }
        : row
    );
    expect(readSigmaBeliefs(rows).has("frc1")).toBe(false);
  });

  it("does NOT put per-team beliefs in the league row, whose size budget forbids anything scaling with team count", () => {
    const rows = withSigmaBeliefs(teamRows(), new Map([["frc1", BELIEF]]));
    for (const row of rows) {
      if (row.scopeKind !== "league") continue;
      expect(row.stateJson).not.toContain("sigmascoutSigma\"");
    }
  });

  it("round-trips the population through the LEAGUE row", () => {
    const rows = withSigmaPopulation(teamRows(), POPULATION);
    expect(readSigmaPopulation(rows)).toEqual(POPULATION);
  });

  it("returns undefined for a population that was never written, rather than fabricating one", () => {
    expect(readSigmaPopulation(teamRows())).toBeUndefined();
  });

  it("coexists with the Swing belief -- both keys survive on the same row", () => {
    const swung = withSwingBeliefs(teamRows(), new Map([["frc1", { weight: 1, weightSquares: 1, mean: 2, m2: 3 }]]));
    const both = withSigmaPopulation(withSigmaBeliefs(swung, new Map([["frc1", BELIEF]])), POPULATION);
    expect(readSwingBeliefs(both).get("frc1")).toEqual({ weight: 1, weightSquares: 1, mean: 2, m2: 3 });
    expect(readSigmaBeliefs(both).get("frc1")).toEqual(BELIEF);
    expect(readSigmaPopulation(both)).toEqual(POPULATION);
  });
});

// ──────── EPA carry-scale state, shape 12 (quick task 260911-3kc) ───────────

describe("serializeState/deserializeState — EPA's season-boundary carry scale state (shape 12) and week-1 calibration state (shape 13)", () => {
  function carriedEpaState(): EpaState {
    return {
      season: 2024,
      teamComponents: new Map<string, Record<string, number>>([
        ["frc1", { auto: 3 }],
        ["frc2", { auto: 5, adjust: 0 }],
        ["frc3", { auto: 7 }],
      ]),
      teamMatchCounts: new Map([
        ["frc1", 0],
        ["frc2", 0],
        ["frc3", 2],
      ]),
      allianceScoreStats: emptyExpandingStats(),
      allianceNoFoulStats: emptyExpandingStats(),
      allianceFoulStats: emptyExpandingStats(),
      weekOne: emptyEpaWeekOneState(),
      fallbackSkipped: 0,
      priorSeasonRatings: { lastSeason: new Map(), yearBefore: new Map() },
      breakdownParseFailureCount: 0,
      // The outgoing season's alliance-score mean: LEAGUE-scoped, one number.
      carrySeedMean: 292.5,
      // Carried-but-not-yet-materialized teams: PER TEAM, a flag on that team's
      // own row. D-13 forbids a league row whose bytes grow with team count,
      // and a few thousand team keys in one row would breach
      // MAX_LEAGUE_ROW_BYTES outright.
      carryPending: new Set(["frc1", "frc2"]),
    };
  }

  it("round-trips a non-empty pending set and a finite carrySeedMean", () => {
    const state = carriedEpaState();
    const reconstructed = deserializeState("epa", serializeState("epa", epa.version, state, STAMP)) as EpaState;
    expect(reconstructed.carrySeedMean).toBe(292.5);
    expect([...reconstructed.carryPending].sort()).toEqual(["frc1", "frc2"]);
    // frc3 was NOT pending and must not become pending by round-tripping.
    expect(reconstructed.carryPending.has("frc3")).toBe(false);
  });

  it("omits the per-team flag when false, so publish-time byte budgets are unchanged for an ordinary team", () => {
    const rows = serializeState("epa", epa.version, carriedEpaState(), STAMP);
    const frc3Row = rows.find((r) => r.scopeKind === "team" && r.scopeKey === "frc3")!;
    expect(JSON.parse(frc3Row.stateJson)).not.toHaveProperty("carryPending");
    const frc1Row = rows.find((r) => r.scopeKind === "team" && r.scopeKey === "frc1")!;
    expect(JSON.parse(frc1Row.stateJson).carryPending).toBe(true);
  });

  it("keeps carryPending OUT of the league row — D-13's bytes-must-not-grow-with-team-count rule", () => {
    const rows = serializeState("epa", epa.version, carriedEpaState(), STAMP);
    const league = JSON.parse(rows.find((r) => r.scopeKind === "league")!.stateJson);
    expect(league).not.toHaveProperty("carryPending");
    expect(league.carrySeedMean).toBe(292.5);
  });

  // -------------------------------------------------------------------------
  // Shape 13 (quick task 260911-j2w): EPA's week-1 calibration state
  // -------------------------------------------------------------------------

  it("round-trips a FROZEN week-1 aggregate, its accumulator and its sealed flag, all in the LEAGUE row", () => {
    const state: EpaState = {
      ...carriedEpaState(),
      weekOne: {
        stats: { count: 412, mean: 71.25, m2: 94_318.5 },
        frozen: { mean: 71.25, sd: 15.125 },
        noFoulStats: emptyExpandingStats(),
        foulStats: emptyExpandingStats(),
        frozenFoul: null,
        sealed: true,
      },
    };
    const rows = serializeState("epa", epa.version, state, STAMP);
    const reconstructed = deserializeState("epa", rows) as EpaState;

    expect(reconstructed.weekOne.stats).toEqual({ count: 412, mean: 71.25, m2: 94_318.5 });
    expect(reconstructed.weekOne.frozen).toEqual({ mean: 71.25, sd: 15.125 });
    expect(reconstructed.weekOne.sealed).toBe(true);

    // D-13: three scalars and an accumulator, none of which scale with team
    // count, so they belong in the league row and NOT on any team row.
    const league = JSON.parse(rows.find((r) => r.scopeKind === "league")!.stateJson);
    expect(league.weekOne.sealed).toBe(true);
    for (const teamRow of rows.filter((r) => r.scopeKind === "team")) {
      expect(JSON.parse(teamRow.stateJson)).not.toHaveProperty("weekOne");
    }
  });

  it("round-trips an UNSEALED, unfrozen week-1 state without inventing a frozen aggregate", () => {
    const state: EpaState = {
      ...carriedEpaState(),
      weekOne: {
        stats: { count: 6, mean: 40, m2: 200 },
        frozen: null,
        noFoulStats: emptyExpandingStats(),
        foulStats: emptyExpandingStats(),
        frozenFoul: null,
        sealed: false,
      },
    };
    const reconstructed = deserializeState("epa", serializeState("epa", epa.version, state, STAMP)) as EpaState;
    expect(reconstructed.weekOne.frozen).toBeNull();
    expect(reconstructed.weekOne.sealed).toBe(false);
    expect(reconstructed.weekOne.stats.count).toBe(6);
  });

  it("round-trips SEALED-with-nothing-frozen, the state a season with too little week-1 play produces", () => {
    // Distinct from the unsealed case above and NOT interchangeable with it:
    // sealed-with-null means "week 1 is over and there was too little of it",
    // which must never be retried, while unsealed means "week 1 is still
    // running". Collapsing the two would reopen a freeze that already happened.
    const state: EpaState = {
      ...carriedEpaState(),
      weekOne: {
        stats: { count: 1, mean: 55, m2: 0 },
        frozen: null,
        noFoulStats: emptyExpandingStats(),
        foulStats: emptyExpandingStats(),
        frozenFoul: null,
        sealed: true,
      },
    };
    const reconstructed = deserializeState("epa", serializeState("epa", epa.version, state, STAMP)) as EpaState;
    expect(reconstructed.weekOne.frozen).toBeNull();
    expect(reconstructed.weekOne.sealed).toBe(true);
  });

  it("throws LeagueRowShapeVersionError on a shape-12 EPA league row rather than silently running the live estimate all season", () => {
    // The load-bearing case for THIS bump, and the same mechanism as the
    // shape-11 case below: `stateStore.ts` filters by algorithm_id only, so
    // bumping epa.version 8.0.0 -> 9.0.0 does not make a stale row unreachable.
    // A shape-12 row deserializes with `weekOne` absent, so the frozen week-1
    // aggregate is permanently unavailable and the Worker runs the LIVE
    // expanding estimate for the whole season while the offline publisher runs
    // the frozen constant — disagreeing on every prediction from week 2 onward
    // with both sides looking healthy.
    const staleRow: StateRow = {
      algorithmId: "epa",
      algorithmVersion: epa.version,
      scopeKind: "league",
      scopeKey: "league",
      stateJson: JSON.stringify({
        snapshotShapeVersion: 12,
        season: 2024,
        allianceScoreStats: emptyExpandingStats(),
        carrySeedMean: 292.5,
        fallbackSkipped: 0,
        breakdownParseFailureCount: 0,
      }),
      generation: STAMP.generation,
      computedAt: STAMP.computedAt,
    };
    expect(() => deserializeState("epa", [staleRow])).toThrow(LeagueRowShapeVersionError);
  });

  it("round-trips a NaN carrySeedMean as NaN — JSON has no NaN, so this is the one that could silently become null", () => {
    const state: EpaState = { ...carriedEpaState(), carrySeedMean: Number.NaN, carryPending: new Set<string>() };
    const reconstructed = deserializeState("epa", serializeState("epa", epa.version, state, STAMP)) as EpaState;
    expect(Number.isNaN(reconstructed.carrySeedMean)).toBe(true);
    expect(reconstructed.carryPending.size).toBe(0);
  });

  it("throws LeagueRowShapeVersionError on a shape-11 EPA league row rather than silently disabling the rescale", () => {
    // The load-bearing case. `apps/worker/src/stateStore.ts`'s readScopedState
    // filters rows by algorithm_id ONLY and never by version, so bumping
    // epa.version alone leaves a stale seeded row reachable. A shape-11 row
    // deserializes with carryPending absent and carrySeedMean undefined, which
    // would disable the rescale on live traffic while the offline publisher
    // applied it — a live/offline divergence that looks healthy.
    const staleRow: StateRow = {
      algorithmId: "epa",
      algorithmVersion: epa.version,
      scopeKind: "league",
      scopeKey: "league",
      stateJson: JSON.stringify({
        snapshotShapeVersion: 11,
        season: 2024,
        allianceScoreStats: emptyExpandingStats(),
        fallbackSkipped: 0,
        breakdownParseFailureCount: 0,
      }),
      generation: STAMP.generation,
      computedAt: STAMP.computedAt,
    };
    expect(() => deserializeState("epa", [staleRow])).toThrow(LeagueRowShapeVersionError);
  });
  // -------------------------------------------------------------------------
  // Shape 14 (quick task 260911-l2k): EPA's foul rate
  // -------------------------------------------------------------------------

  it("round-trips the season-wide no-foul/foul pair and a FROZEN foul record, all in the LEAGUE row", () => {
    const state: EpaState = {
      ...carriedEpaState(),
      allianceNoFoulStats: { count: 900, mean: 64.5, m2: 120_000 },
      allianceFoulStats: { count: 900, mean: 6.75, m2: 4_200 },
      weekOne: {
        stats: { count: 412, mean: 71.25, m2: 94_318.5 },
        frozen: { mean: 71.25, sd: 15.125 },
        noFoulStats: { count: 412, mean: 65.5, m2: 80_000 },
        foulStats: { count: 412, mean: 5.75, m2: 3_100 },
        frozenFoul: { rate: 5.75 / 65.5, noFoulMean: 65.5 },
        sealed: true,
      },
    };
    const rows = serializeState("epa", epa.version, state, STAMP);
    const reconstructed = deserializeState("epa", rows) as EpaState;

    expect(reconstructed.allianceNoFoulStats).toEqual({ count: 900, mean: 64.5, m2: 120_000 });
    expect(reconstructed.allianceFoulStats).toEqual({ count: 900, mean: 6.75, m2: 4_200 });
    expect(reconstructed.weekOne.noFoulStats).toEqual({ count: 412, mean: 65.5, m2: 80_000 });
    expect(reconstructed.weekOne.foulStats).toEqual({ count: 412, mean: 5.75, m2: 3_100 });
    expect(reconstructed.weekOne.frozenFoul).toEqual({ rate: 5.75 / 65.5, noFoulMean: 65.5 });

    // D-13: two accumulator pairs and one record, none of which scale with
    // team count, so they belong in the league row and NOT on any team row.
    const leagueRow = rows.find((r) => r.scopeKind === "league");
    const league = JSON.parse((leagueRow as StateRow).stateJson);
    expect(league.weekOne.frozenFoul.noFoulMean).toBe(65.5);
    for (const teamRow of rows.filter((r) => r.scopeKind === "team")) {
      const parsed = JSON.parse(teamRow.stateJson);
      expect(parsed).not.toHaveProperty("frozenFoul");
      expect(parsed).not.toHaveProperty("allianceFoulStats");
    }
  });

  it("round-trips a NULL frozen foul record rather than inventing a zero rate for it", () => {
    // The refused-degenerate-rate state (D-5). `null` and `{ rate: 0 }` are
    // NOT interchangeable: the first means "no usable week-1 foul population
    // was found", the second means "week 1 genuinely had no fouls". Both
    // publish plain no-foul totals today, so collapsing them would be
    // invisible now and wrong the moment anything reads the distinction.
    const state: EpaState = {
      ...carriedEpaState(),
      weekOne: {
        stats: { count: 5, mean: 60, m2: 100 },
        frozen: null,
        noFoulStats: { count: 5, mean: 0, m2: 0 },
        foulStats: { count: 5, mean: 4, m2: 10 },
        frozenFoul: null,
        sealed: true,
      },
    };
    const reconstructed = deserializeState("epa", serializeState("epa", epa.version, state, STAMP)) as EpaState;
    expect(reconstructed.weekOne.frozenFoul).toBeNull();
    expect(reconstructed.weekOne.sealed).toBe(true);
  });

  it("throws LeagueRowShapeVersionError on a shape-13 EPA league row rather than silently pinning the Worker at a zero foul rate", () => {
    // The load-bearing case for THIS bump, and the same mechanism as the
    // shape-11 and shape-12 cases: `stateStore.ts` filters by algorithm_id
    // only, so bumping epa.version 9.0.0 -> 10.0.0 does not make a stale row
    // unreachable. A shape-13 row deserializes with the foul accumulators
    // absent, so the live Worker would publish every predicted score at its
    // plain no-foul total while the offline publisher applied the frozen
    // week-1 rate. Worse than its predecessors in one respect: a zero rate is
    // a LEGAL rate (EPA_FALLBACK_FOUL_RATE), so nothing downstream could flag
    // it as suspicious.
    const staleRow: StateRow = {
      algorithmId: "epa",
      algorithmVersion: epa.version,
      scopeKind: "league",
      scopeKey: "league",
      stateJson: JSON.stringify({
        snapshotShapeVersion: 13,
        season: 2024,
        allianceScoreStats: emptyExpandingStats(),
        carrySeedMean: 292.5,
        weekOne: { stats: emptyExpandingStats(), frozen: null, sealed: false },
        fallbackSkipped: 0,
        breakdownParseFailureCount: 0,
      }),
      generation: STAMP.generation,
      computedAt: STAMP.computedAt,
    };
    expect(() => deserializeState("epa", [staleRow])).toThrow(LeagueRowShapeVersionError);
  });
});

// ──────── Ranking-point beliefs, shape 15 (plan 09-08, D-21) ───────────────

describe("ranking-point belief persistence (shape 15, plan 09-08)", () => {
  /**
   * TWO variable names on purpose — 2026 tracks `hubTotalCount` and
   * `totalTowerPoints`, and a single-variable record would not exercise the
   * per-variable nesting that makes this passenger a nested record rather
   * than a flat object at all.
   */
  const BELIEFS = {
    hubTotalCount: { weight: 3.5, weightSquares: 2.25, mean: 41.75, m2: 180.5 },
    totalTowerPoints: { weight: 3.5, weightSquares: 2.25, mean: 12.25, m2: 44.75 },
  };

  function teamRows(): StateRow[] {
    return serializeState("spr", spr.version, spr.initState(["frc1", "frc2"]) as any, STAMP);
  }

  it("round-trips one team's beliefs across TWO variable names unchanged", () => {
    const rows = withRpBeliefs(teamRows(), new Map([["frc1", BELIEFS]]));
    expect(readRpBeliefs(rows).get("frc1")).toEqual(BELIEFS);
  });

  it("SKIPS the WHOLE TEAM when any one variable's m2 is a string -- momentsFor sums silently, so a part-filled record yields a confident WRONG pmf", () => {
    const rows = teamRows().map((row) =>
      row.scopeKind === "team" && row.scopeKey === "frc1"
        ? {
            ...row,
            stateJson: JSON.stringify({
              ...JSON.parse(row.stateJson),
              sigmascoutRp: { ...BELIEFS, totalTowerPoints: { ...BELIEFS.totalTowerPoints, m2: "44.75" } },
            }),
          }
        : row
    );
    expect(readRpBeliefs(rows).has("frc1")).toBe(false);
  });

  it("SKIPS the WHOLE TEAM when any one variable's m2 is NaN", () => {
    const rows = teamRows().map((row) =>
      row.scopeKind === "team" && row.scopeKey === "frc1"
        ? {
            ...row,
            stateJson: JSON.stringify({
              ...JSON.parse(row.stateJson),
              sigmascoutRp: { ...BELIEFS, hubTotalCount: { ...BELIEFS.hubTotalCount, m2: Number.NaN } },
            }),
          }
        : row
    );
    // JSON.stringify turns NaN into null, which is the on-disk reality this
    // guard actually faces -- and null is not a finite number either way.
    expect(readRpBeliefs(rows).has("frc1")).toBe(false);
  });

  it("SKIPS the WHOLE TEAM when any one variable is missing a field entirely", () => {
    const rows = teamRows().map((row) =>
      row.scopeKind === "team" && row.scopeKey === "frc1"
        ? {
            ...row,
            stateJson: JSON.stringify({
              ...JSON.parse(row.stateJson),
              sigmascoutRp: { ...BELIEFS, totalTowerPoints: { weight: 1, mean: 2 } },
            }),
          }
        : row
    );
    expect(readRpBeliefs(rows).has("frc1")).toBe(false);
  });

  it("returns NEW rows -- the input array's stateJson strings are unchanged by reference", () => {
    const input = teamRows();
    const before = input.map((r) => r.stateJson);
    const out = withRpBeliefs(input, new Map([["frc1", BELIEFS]]));
    expect(input.map((r) => r.stateJson)).toEqual(before);
    expect(out).not.toBe(input);
  });

  it("leaves a team with no belief absent rather than writing an empty record", () => {
    const rows = withRpBeliefs(teamRows(), new Map([["frc1", BELIEFS]]));
    expect(readRpBeliefs(rows).has("frc2")).toBe(false);
  });

  it("returns event and league rows untouched -- the league row's size budget forbids anything scaling with team count", () => {
    const input = teamRows();
    const out = withRpBeliefs(input, new Map([["frc1", BELIEFS]]));
    for (let i = 0; i < input.length; i++) {
      if (input[i]!.scopeKind === "team") continue;
      expect(out[i]).toBe(input[i]);
    }
    for (const row of out) {
      if (row.scopeKind === "team") continue;
      expect(row.stateJson).not.toContain("sigmascoutRp");
    }
  });

  it("coexists with BOTH the Swing and Sigma passengers on the same team row", () => {
    const swing = { weight: 1, weightSquares: 1, mean: 2, m2: 3 };
    const sigma = { meanWeight: 3.25, mean: 8.5, varWeight: 2.75, sumSquares: 91.5, talent: 42.25 };
    const all = withRpBeliefs(
      withSigmaBeliefs(withSwingBeliefs(teamRows(), new Map([["frc1", swing]])), new Map([["frc1", sigma]])),
      new Map([["frc1", BELIEFS]])
    );
    expect(readSwingBeliefs(all).get("frc1")).toEqual(swing);
    expect(readSigmaBeliefs(all).get("frc1")).toEqual(sigma);
    expect(readRpBeliefs(all).get("frc1")).toEqual(BELIEFS);
  });
});
