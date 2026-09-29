/**
 * The presim rookie rule (SPR 9.0.0, quick task 260928-p8i): a presim sidecar rates a roster team with
 * no Sigma belief with SPR's unseen-team total and the prior-only Sigma at that total, read at the same
 * instant as the sidecar's SPR state. The pre-event arm freezes that map at snapshot time. It rides the
 * `sigmaCarry` switch, so `sigmaCarry: false` rebuilds the pre-9.0.0 refusal.
 *
 *   - `snapshotRankingPointFillerInputs` with a rookie source, on the committed digest slice.
 *   - `publishSeasons` end to end on a temp corpus: the pre-event arm (schedule landed, event played)
 *     and the current-state arm (schedule landed, not started) both get a sidecar for a roster with a
 *     first-time team by default, and none with `sigmaCarry: false`, which logs the one refusal line.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlgorithmModule, MatchResult } from "../core/algorithms/types.js";
import { TOTAL_METRIC_KEY } from "../core/algorithms/types.js";
import { RP_RULE_MODULES } from "../core/rankingPoints/rules.js";
import { spr } from "../core/algorithms/spr.js";
import { openCorpus, upsertEvent, upsertMatch, type Corpus } from "../corpus/db.js";
import type { CorpusEvent, CorpusMatch } from "../ingest/normalize.js";
import { WalkForwardSimulator } from "./replay.js";
import { SigmaScoutLayer } from "./sigmaScoutLayer.js";
import { publishSeasons, rookieRuleRatings, snapshotRankingPointFillerInputs } from "./publish.js";
import { PublishedPreScheduleArtifactSchema } from "./pageArtifacts.js";

vi.mock("./r2Client.js", () => ({
  putObject: vi.fn(async () => undefined),
  getObject: vi.fn(async () => ""),
}));
import { putObject } from "./r2Client.js";

// ---------------------------------------------------------------------------
// snapshotRankingPointFillerInputs with a rookie source
// ---------------------------------------------------------------------------

describe("snapshotRankingPointFillerInputs with a rookie source (the committed digest slice)", () => {
  const fixture = JSON.parse(readFileSync(join("packages", "harness", "fixtures", "digest-slice.json"), "utf8")) as {
    sliceSeason: number;
    matches: MatchResult[];
  };
  const algorithm = spr as unknown as AlgorithmModule<unknown>;
  const stream = fixture.matches;
  const teams = [...new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
  const HALF = Math.floor(stream.length / 2);

  // One replay; the SPR state right after match HALF - 1 is the snapshot instant's state.
  const talentAfterMatch = new Map<string, Map<string, number>>();
  let stateAtHalf: unknown;
  let completed = 0;
  const records = new WalkForwardSimulator(stream).runAll([algorithm], teams, undefined, (match, _id, state) => {
    const involved = [...match.redTeams, ...match.blueTeams];
    const metrics = algorithm.teamMetrics(state, involved);
    const talent = new Map<string, number>();
    for (const teamKey of involved) {
      const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
      if (total !== undefined) talent.set(teamKey, total);
    }
    talentAfterMatch.set(match.matchKey, talent);
    completed++;
    if (completed === HALF) stateAtHalf = state;
  });

  const ROOKIE = "frc999991";
  const BELIEVED = stream[0]!.redTeams[0]!;
  const TEAM_KEYS = [BELIEVED, ROOKIE, stream[0]!.blueTeams[0]!];

  function layerAtHalf(): SigmaScoutLayer {
    const layer = new SigmaScoutLayer(RP_RULE_MODULES[fixture.sliceSeason], "spr", { rpColdPrior: true });
    for (const record of records.slice(0, HALF)) layer.foldPlayed(record.match, record.prediction, talentAfterMatch.get(record.match.matchKey));
    return layer;
  }

  it("rates a team with no Sigma belief with the prior-only Sigma at SPR's unseen-team total, and keeps a believed team's own Sigma", () => {
    const layer = layerAtHalf();
    const unseen = algorithm.unseenTeamMetrics!(stateAtHalf)[TOTAL_METRIC_KEY]!.value;
    const inputs = snapshotRankingPointFillerInputs(layer, TEAM_KEYS, { algorithm, state: stateAtHalf });
    expect(layer.sigmaScoresFor([ROOKIE]).has(ROOKIE), "the rookie must have no belief").toBe(false);
    expect(inputs.sigmaByTeam.get(ROOKIE)).toBe(layer.sigmaPriorAtTalent(unseen));
    expect(inputs.sigmaByTeam.get(BELIEVED)).toBe(layer.sigmaScoresFor([BELIEVED]).get(BELIEVED));
    expect(inputs.rosterRatings?.get(ROOKIE)).toEqual({ total: unseen, sigma: layer.sigmaPriorAtTalent(unseen), unseenByAlgorithm: true, priorOnlySigma: true });
    expect(inputs.rosterRatings?.get(BELIEVED)?.priorOnlySigma).toBe(false);
    expect([...inputs.sigmaByTeam.keys()].sort()).toEqual([...TEAM_KEYS].sort());
  });

  it("freezes the map at the snapshot instant: later folds leave it unchanged while a fresh recomputation moves", () => {
    const layer = layerAtHalf();
    const source = { algorithm, state: stateAtHalf };
    const inputs = snapshotRankingPointFillerInputs(layer, TEAM_KEYS, source);
    const frozen = new Map(inputs.sigmaByTeam);
    for (const record of records.slice(HALF)) layer.foldPlayed(record.match, record.prediction, talentAfterMatch.get(record.match.matchKey));
    expect(new Map(inputs.sigmaByTeam)).toEqual(frozen);
    // Non-vacuity: the same rule read NOW, after the further folds, prices the rookie differently.
    const fresh = rookieRuleRatings(layer, TEAM_KEYS, source);
    expect(fresh.get(ROOKIE)!.sigma).not.toBe(frozen.get(ROOKIE));
  });

  it("with no rookie source the map is layer.sigmaScoresFor(teamKeys), the pre-9.0.0 map, and carries no ratings", () => {
    const layer = layerAtHalf();
    const inputs = snapshotRankingPointFillerInputs(layer, TEAM_KEYS);
    expect(inputs.sigmaByTeam).toEqual(layer.sigmaScoresFor(TEAM_KEYS));
    expect(inputs.sigmaByTeam.has(ROOKIE)).toBe(false);
    expect(inputs.rosterRatings).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// publishSeasons end to end
// ---------------------------------------------------------------------------

function event(eventKey: string, startDate: string): CorpusEvent {
  return {
    eventKey,
    year: 2024,
    eventType: 0,
    isOffseason: false,
    startDate,
    name: eventKey,
    week: null,
    country: null,
    stateProv: null,
    districtKey: null,
  };
}

/** A 2024 (Crescendo) breakdown that varies by match, so the RP beliefs and the league summary are non-degenerate. */
function breakdown2024(i: number): string {
  const side = (k: number): Record<string, unknown> => {
    const notes = (i * 7 + k * 5) % 23;
    const onStage = (i + k) % 4;
    return {
      autoAmpNoteCount: notes % 3,
      autoSpeakerNoteCount: (notes + 1) % 4,
      teleopAmpNoteCount: notes % 5,
      teleopSpeakerNoteCount: notes,
      teleopSpeakerNoteAmplifiedCount: notes % 2,
      endGameTotalStagePoints: Math.min(31, onStage * 3 + ((i * 3 + k) % 7)),
      endGameRobot1: onStage >= 1 ? "StageLeft" : "None",
      endGameRobot2: onStage >= 2 ? "StageRight" : "None",
      endGameRobot3: onStage >= 3 ? "CenterStage" : "None",
      coopertitionBonusAchieved: false,
      melodyBonusAchieved: notes >= 18,
      ensembleBonusAchieved: onStage >= 2,
      melodyBonusThresholdCoop: 15,
      melodyBonusThresholdNonCoop: 18,
      ensembleBonusStagePointsThreshold: 10,
      ensembleBonusOnStageRobotsThreshold: 2,
    };
  };
  return JSON.stringify({ red: side(0), blue: side(1) });
}

function played(eventKey: string, n: number, sortTime: number, red: string[], blue: string[], redScore: number, blueScore: number): CorpusMatch {
  return {
    matchKey: `${eventKey}_qm${n}`,
    eventKey,
    compLevel: "qm",
    matchNumber: n,
    setNumber: 1,
    sortTime,
    redTeams: red,
    blueTeams: blue,
    redSurrogates: [],
    blueSurrogates: [],
    redDqs: [],
    blueDqs: [],
    winner: redScore > blueScore ? "red" : "blue",
    winnerImputed: false,
    redScore,
    blueScore,
    redRpEarned: null,
    blueRpEarned: null,
    hasScoreBreakdown: true,
    scoreBreakdownRaw: breakdown2024(n + sortTime / 1_000),
    videoKey: null,
  };
}

const SIX = ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"];

/**
 * 2024ear: frc1-frc6 play eight matches (the cold-start first event, no sidecar). 2024lat (played, the
 * pre-event arm): frc7 debuts in its third match. 2024sch (scheduled, not started, the current-state
 * arm): frc8, who never plays, is on its one scheduled match.
 */
function seedCorpus(db: Corpus): void {
  upsertEvent(db, event("2024ear", "2024-03-01"));
  for (let i = 0; i < 8; i++) {
    const rotated = [...SIX.slice(i % 6), ...SIX.slice(0, i % 6)];
    const red = i % 2 === 0 ? rotated.slice(0, 3) : [rotated[0]!, rotated[2]!, rotated[4]!];
    const blue = SIX.filter((t) => !red.includes(t));
    upsertMatch(db, played("2024ear", i + 1, 1_000 + i * 1_000, red, blue, 90 + ((i * 37) % 60), 80 + ((i * 53) % 70)));
  }
  upsertEvent(db, event("2024lat", "2024-03-15"));
  upsertMatch(db, played("2024lat", 1, 20_000, ["frc1", "frc2", "frc3"], ["frc4", "frc5", "frc6"], 140, 110));
  upsertMatch(db, played("2024lat", 2, 21_000, ["frc1", "frc5", "frc6"], ["frc2", "frc3", "frc4"], 100, 150));
  upsertMatch(db, played("2024lat", 3, 22_000, ["frc7", "frc1", "frc2"], ["frc3", "frc4", "frc5"], 120, 115));
  upsertEvent(db, event("2024sch", "2024-04-01"));
  upsertMatch(db, {
    ...played("2024sch", 1, 30_000, ["frc8", "frc1", "frc2"], ["frc3", "frc4", "frc5"], 0, 0),
    redScore: null,
    blueScore: null,
    winner: null,
    hasScoreBreakdown: false,
    scoreBreakdownRaw: null,
  });
}

describe("publishSeasons presim sidecars under the rookie rule", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-presim-rookie-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
    seedCorpus(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function run(sigmaCarry: boolean | undefined): Promise<{ sidecar: (eventKey: string) => string | undefined; skipLines: string[] }> {
    vi.mocked(putObject).mockClear();
    const logSpy = vi.spyOn(console, "log");
    try {
      await publishSeasons(db, {
        seasons: [2024],
        algorithms: [spr],
        bucket: "presim-rookie-test-never-uploaded",
        dryRun: false,
        skipState: true,
        preScheduleFromSeason: 2024,
        generation: "presim-rookie-test",
        // Inside the unplayed 2024sch event's span (start 2024-04-01): in progress, so not cancelled (quick task 260929-mcf).
        computedAt: "2024-04-02T00:00:00.000Z",
        ...(sigmaCarry === undefined ? {} : { sigmaCarry }),
      });
      const puts = vi.mocked(putObject).mock.calls.map(([, key, body]) => [key as string, body as string] as const);
      // Refusals only: the cold-start first event's own skip line ("no pre-event walk-forward state") is not one.
      const skipLines = logSpy.mock.calls
        .map((args) => String(args[0]))
        .filter((line) => line.startsWith("publish: presim skip") && line.includes("refused this roster"));
      return { sidecar: (eventKey) => puts.find(([key]) => key.startsWith(`v1/presim/${eventKey}/${spr.id}@`))?.[1], skipLines };
    } finally {
      logSpy.mockRestore();
    }
  }

  it("by default both arms get a sidecar for a roster with a first-time team, and no refusal line is logged", async () => {
    const { sidecar, skipLines } = await run(undefined);
    const preEvent = sidecar("2024lat");
    expect(preEvent, "the pre-event arm (frc7 debuts at the event) must get a sidecar").toBeDefined();
    const preEventArtifact = PublishedPreScheduleArtifactSchema.parse(JSON.parse(preEvent!));
    expect(preEventArtifact.pricedFrom).toBe("pre-event-walk-forward");
    expect(preEventArtifact.roster).toContain("frc7");

    const current = sidecar("2024sch");
    expect(current, "the current-state arm (frc8 never played) must get a sidecar").toBeDefined();
    const currentArtifact = PublishedPreScheduleArtifactSchema.parse(JSON.parse(current!));
    expect(currentArtifact.pricedFrom).toBe("current-state");
    expect(currentArtifact.roster).toContain("frc8");

    expect(skipLines).toEqual([]);
    // The cold-start first event still gets none: it has no pre-event state at all.
    expect(sidecar("2024ear")).toBeUndefined();
  });

  it("sigmaCarry: false keeps the pre-9.0.0 refusal: no sidecar for either arm, and one log line per event naming the team", async () => {
    const { sidecar, skipLines } = await run(false);
    expect(sidecar("2024lat")).toBeUndefined();
    expect(sidecar("2024sch")).toBeUndefined();
    expect(skipLines).toEqual([
      `publish: presim skip 2024lat [${spr.id}]: the all-or-nothing ranking-point filler refused this roster; 1 of 7 team(s) have no pre-event Sigma Score: frc7`,
      `publish: presim skip 2024sch [${spr.id}]: the all-or-nothing ranking-point filler refused this roster; 1 of 6 team(s) have no current Sigma Score: frc8`,
    ]);
  });
});
