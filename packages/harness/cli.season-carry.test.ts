/**
 * T-02-08 regression (threat register, plan 02-03): `carrySeason` is called
 * only with `fromSeason < toSeason`, and the seasons array is replayed in
 * ascending order — a season boundary must never let a LATER season's
 * information leak backward into an EARLIER season's predictions. Proven
 * here the way the plan's own `<verification>` section states it: a
 * 2022-only run's 2022 predictions must be byte-identical to the 2022
 * portion of a 2022-2023 run's predictions.
 *
 * Uses a temporary SQLite corpus (no TBA access, no `data/corpus.sqlite`
 * dependency), following `replay.season.test.ts`'s fixture pattern.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { epa } from "../core/algorithms/epa.js";
import { opr } from "../core/algorithms/opr.js";
import { openCorpus, upsertEvent, upsertMatch, type Corpus } from "../corpus/db.js";
import type { CorpusEvent, CorpusMatch } from "../ingest/normalize.js";
import { runSeasons } from "./cli.js";
import type { HarnessPredictionInput } from "./score.js";

let dir: string;
let db: Corpus;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sigmascout-season-carry-"));
  db = openCorpus(join(dir, "corpus.sqlite"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function event(overrides: Partial<CorpusEvent> = {}): CorpusEvent {
  return {
    eventKey: "2022evta",
    year: 2022,
    eventType: 0,
    isOffseason: false,
    startDate: "2022-03-01",
    ...overrides,
  };
}

/** A schema-valid 2022 (Rapid React) score_breakdown JSON. */
function breakdown2022Json(redOverrides: Record<string, number> = {}, blueOverrides: Record<string, number> = {}): string {
  const zeroedSide = {
    autoTaxiPoints: 0,
    autoCargoPoints: 0,
    teleopCargoPoints: 0,
    endgamePoints: 0,
    adjustPoints: 0,
    foulPoints: 0,
  };
  return JSON.stringify({ red: { ...zeroedSide, ...redOverrides }, blue: { ...zeroedSide, ...blueOverrides } });
}

/** A schema-valid 2023 (Charged Up) score_breakdown JSON. */
function breakdown2023Json(redOverrides: Record<string, number> = {}, blueOverrides: Record<string, number> = {}): string {
  const zeroedSide = {
    autoMobilityPoints: 0,
    autoGamePiecePoints: 0,
    autoChargeStationPoints: 0,
    teleopGamePiecePoints: 0,
    linkPoints: 0,
    endGameChargeStationPoints: 0,
    endGameParkPoints: 0,
    adjustPoints: 0,
    foulPoints: 0,
  };
  return JSON.stringify({ red: { ...zeroedSide, ...redOverrides }, blue: { ...zeroedSide, ...blueOverrides } });
}

function match(overrides: Partial<CorpusMatch> = {}): CorpusMatch {
  return {
    matchKey: "2022evta_qm1",
    eventKey: "2022evta",
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
    scoreBreakdownRaw: breakdown2022Json(),
    ...overrides,
  };
}

/** Seeds a two-season (2022, 2023) corpus, the same 6 teams playing in both, so 2023's boundary has real carry-worthy history from 2022. */
function seedTwoSeasonCorpus(): void {
  upsertEvent(db, event({ eventKey: "2022evta" }));
  upsertEvent(db, event({ eventKey: "2023evta", year: 2023, startDate: "2023-03-01" }));

  upsertMatch(
    db,
    match({
      matchKey: "2022evta_qm1",
      sortTime: 100,
      redScore: 100,
      blueScore: 50,
      scoreBreakdownRaw: breakdown2022Json({ autoCargoPoints: 12, teleopCargoPoints: 30 }, { autoCargoPoints: 6 }),
    })
  );
  upsertMatch(
    db,
    match({
      matchKey: "2022evta_qm2",
      matchNumber: 2,
      sortTime: 200,
      redScore: 80,
      blueScore: 70,
      redTeams: ["frc1", "frc2", "frc3"],
      blueTeams: ["frc4", "frc5", "frc6"],
      scoreBreakdownRaw: breakdown2022Json({ teleopCargoPoints: 20 }, { autoCargoPoints: 10, teleopCargoPoints: 15 }),
    })
  );
  upsertMatch(
    db,
    match({
      matchKey: "2023evta_qm1",
      eventKey: "2023evta",
      matchNumber: 1,
      sortTime: 300,
      redTeams: ["frc1", "frc2", "frc3"],
      blueTeams: ["frc4", "frc5", "frc6"],
      redScore: 90,
      blueScore: 60,
      scoreBreakdownRaw: breakdown2023Json({ autoGamePiecePoints: 10, teleopGamePiecePoints: 25 }, { autoGamePiecePoints: 8 }),
    })
  );
}

function sortByMatchKeyAndAlgorithm(predictions: readonly HarnessPredictionInput[]): HarnessPredictionInput[] {
  return [...predictions].sort((a, b) => a.matchKey.localeCompare(b.matchKey) || a.algorithmId.localeCompare(b.algorithmId));
}

describe("runSeasons — T-02-08: no future season leaks backward into an earlier season's predictions", () => {
  it("EPA: a 2022-only run's 2022 predictions are byte-identical to the 2022 portion of a 2022-2023 run's predictions", async () => {
    seedTwoSeasonCorpus();

    const combinedRun = await runSeasons(db, [2022, 2023], [epa], false, 2022);
    const soloRun = await runSeasons(db, [2022], [epa], false, 2022);

    const combined2022 = sortByMatchKeyAndAlgorithm(combinedRun.filter((p) => p.season === 2022));
    const solo2022 = sortByMatchKeyAndAlgorithm(soloRun);

    expect(combined2022).toEqual(solo2022);
    // Sanity: this fixture really does replay 2022 matches, so the
    // assertion above isn't vacuously true over an empty array.
    expect(combined2022.length).toBeGreaterThan(0);
  });

  it("OPR (no carrySeason): a 2022-only run's 2022 predictions are byte-identical to the 2022 portion of a 2022-2023 run's predictions", async () => {
    seedTwoSeasonCorpus();

    const combinedRun = await runSeasons(db, [2022, 2023], [opr], false, 2022);
    const soloRun = await runSeasons(db, [2022], [opr], false, 2022);

    const combined2022 = sortByMatchKeyAndAlgorithm(combinedRun.filter((p) => p.season === 2022));
    const solo2022 = sortByMatchKeyAndAlgorithm(soloRun);

    expect(combined2022).toEqual(solo2022);
    expect(combined2022.length).toBeGreaterThan(0);
  });

  it("EPA's 2023 predictions in the combined run differ from a from-scratch 2023-only run (carry is doing something, not silently no-opping)", async () => {
    seedTwoSeasonCorpus();

    const combinedRun = await runSeasons(db, [2022, 2023], [epa], false, 2022);
    const noCarryRun = await runSeasons(db, [2023], [epa], false, 2022);

    const combined2023 = sortByMatchKeyAndAlgorithm(combinedRun.filter((p) => p.season === 2023));
    const noCarry2023 = sortByMatchKeyAndAlgorithm(noCarryRun);

    expect(combined2023).not.toEqual(noCarry2023);
  });
});
