/**
 * The RP cold-team prior CANDIDATE (`rpColdPrior`,
 * `.planning/quick/260928-n6i-fix-the-early-season-rp-bonus-cold-start/260928-n6i-PREREG.md`)
 * through the real `SigmaScoutLayer` and `publishSeasons`.
 *
 *   - OFF IS THE INCUMBENT: a layer built with no options and one built with
 *     `rpColdPrior: false` return identical records and state; `publishSeasons`
 *     absent and `false` publish byte-identical bodies.
 *   - ON MOVES RP ONLY (PREREG item 4): scores, win odds, the match band, Sigma,
 *     the folded beliefs and the mean shift's booking are unchanged; at least
 *     one bonus probability moves (non-vacuity); every Compare page (winner
 *     accuracy and Brier) is byte-identical.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AlgorithmModule, MatchResult } from "../core/algorithms/types.js";
import { TOTAL_METRIC_KEY } from "../core/algorithms/types.js";
import { RP_RULE_MODULES } from "../core/rankingPoints/rules.js";
import { openCorpus, upsertEvent, upsertMatch, type Corpus } from "../corpus/db.js";
import type { CorpusEvent, CorpusMatch } from "../ingest/normalize.js";
import { spr } from "../core/algorithms/spr.js";
import { SigmaScoutLayer, type SigmaScoutLayerOptions } from "./sigmaScoutLayer.js";
import { WalkForwardSimulator, type PredictionRecord } from "./replay.js";
import { publishSeasons, resolvePublishAlgorithms } from "./publish.js";
import { usesSigmaScore } from "./sigmaScore.js";

const DIGEST_SLICE_FIXTURE_PATH = join("packages", "harness", "fixtures", "digest-slice.json");

interface DigestSliceFixture {
  sliceSeason: number;
  matches: MatchResult[];
}

describe("SigmaScoutLayer rpColdPrior on the committed digest slice", () => {
  const fixture = JSON.parse(readFileSync(DIGEST_SLICE_FIXTURE_PATH, "utf8")) as DigestSliceFixture;
  const sprModule = resolvePublishAlgorithms(undefined).find((a) => a.id === "spr") as AlgorithmModule<unknown>;
  const ruleModule = RP_RULE_MODULES[fixture.sliceSeason]!;

  const stream = fixture.matches;
  const teams = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
  const talentAfterMatch = new Map<string, Map<string, number>>();
  const records = new WalkForwardSimulator(stream).runAll([sprModule], teams, undefined, (match, algorithmId, state) => {
    if (!usesSigmaScore(algorithmId)) return;
    const involved = [...match.redTeams, ...match.blueTeams];
    const metrics = sprModule.teamMetrics(state, involved);
    const talent = new Map<string, number>();
    for (const teamKey of involved) {
      const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
      if (total !== undefined) talent.set(teamKey, total);
    }
    talentAfterMatch.set(match.matchKey, talent);
  });

  function replay(options: SigmaScoutLayerOptions | undefined): { layer: SigmaScoutLayer; out: PredictionRecord[] } {
    const layer = options === undefined ? new SigmaScoutLayer(ruleModule, "spr") : new SigmaScoutLayer(ruleModule, "spr", options);
    const out = records.map((record) => layer.foldPlayed(record.match, record.prediction, talentAfterMatch.get(record.match.matchKey)));
    return { layer, out };
  }

  const absent = replay(undefined);
  const off = replay({ rpColdPrior: false });
  const on = replay({ rpColdPrior: true });

  it("the slice is non-trivial", () => {
    expect(records.length).toBeGreaterThan(10);
  });

  it("off absent and off false return identical records and identical final state", () => {
    expect(off.out).toStrictEqual(absent.out);
    expect(off.layer.rpMeanShiftState()).toStrictEqual(absent.layer.rpMeanShiftState());
    expect(off.layer.rpVariableBeliefs()).toStrictEqual(absent.layer.rpVariableBeliefs());
    expect(absent.layer.rpAccumulator?.rpColdPrior).toBe(false);
    expect(off.layer.rpAccumulator?.rpColdPrior).toBe(false);
    expect(on.layer.rpAccumulator?.rpColdPrior).toBe(true);
  });

  it("on changes nothing but RP: scores, win odds, the match band, Sigma, beliefs and the mean shift are the incumbent's", () => {
    expect(on.out.length).toBe(absent.out.length);
    on.out.forEach((record, i) => {
      const incumbent = absent.out[i]!;
      expect(record.match).toStrictEqual(incumbent.match);
      expect(record.prediction.redScore).toBe(incumbent.prediction.redScore);
      expect(record.prediction.blueScore).toBe(incumbent.prediction.blueScore);
      expect(record.prediction.pRedWin).toBe(incumbent.prediction.pRedWin);
      expect(record.matchBand).toStrictEqual(incumbent.matchBand);
    });
    expect([...on.layer.sigmaScoreByTeam()]).toStrictEqual([...absent.layer.sigmaScoreByTeam()]);
    expect(on.layer.rpVariableBeliefs()).toStrictEqual(absent.layer.rpVariableBeliefs());
    expect(on.layer.rpMeanShiftState()).toStrictEqual(absent.layer.rpMeanShiftState());
  });

  it("the stream's first record is identical (n = 0 at that instant), and at least one bonus probability moves", () => {
    expect(on.out[0]).toStrictEqual(absent.out[0]);
    const moved = on.out.filter((record, i) => {
      const incumbent = absent.out[i]!.prediction;
      return (
        JSON.stringify(record.prediction.redBonusRp) !== JSON.stringify(incumbent.redBonusRp) ||
        JSON.stringify(record.prediction.blueBonusRp) !== JSON.stringify(incumbent.blueBonusRp)
      );
    });
    expect(moved.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// publishSeasons, dry run on a one-season temp corpus.

function event(eventKey: string, year: number, startDate: string): CorpusEvent {
  return {
    eventKey,
    year,
    eventType: 0,
    isOffseason: false,
    startDate,
    name: eventKey,
    week: 1,
    country: null,
    stateProv: null,
    districtKey: null,
  };
}

const TEAMS = ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6", "frc7", "frc8", "frc9"];
const ON_STAGE = ["StageLeft", "StageRight", "CenterStage"];

/** A 2024 (Crescendo) alliance breakdown whose note count and stage points vary by match and side, so the league variance is non-zero. */
function side2024(i: number, k: number): Record<string, unknown> {
  const notes = (i * 7 + k * 5) % 23;
  const onStage = (i + k) % 4;
  return {
    autoAmpNoteCount: notes % 3,
    autoSpeakerNoteCount: (notes + 1) % 4,
    teleopAmpNoteCount: notes % 5,
    teleopSpeakerNoteCount: notes,
    teleopSpeakerNoteAmplifiedCount: notes % 2,
    endGameTotalStagePoints: Math.min(31, onStage * 3 + ((i * 3 + k) % 7)),
    endGameRobot1: onStage >= 1 ? ON_STAGE[0] : "None",
    endGameRobot2: onStage >= 2 ? ON_STAGE[1] : "None",
    endGameRobot3: onStage >= 3 ? ON_STAGE[2] : "None",
    coopertitionBonusAchieved: false,
    melodyBonusAchieved: notes >= 18,
    ensembleBonusAchieved: onStage >= 2,
    melodyBonusThresholdCoop: 15,
    melodyBonusThresholdNonCoop: 18,
    ensembleBonusStagePointsThreshold: 10,
    ensembleBonusOnStageRobotsThreshold: 2,
  };
}

function seedSeason(db: Corpus, year: number, eventKey: string, startSortTime: number, matches: number): void {
  upsertEvent(db, event(eventKey, year, `${year}-03-01`));
  for (let i = 0; i < matches; i++) {
    const pick = (k: number): string => TEAMS[(i * 4 + k * 2 + (i % 3)) % TEAMS.length]!;
    const red = [pick(0), pick(1), pick(2)];
    const blue = TEAMS.filter((t) => !red.includes(t)).slice(i % 4, (i % 4) + 3);
    const strength = (team: string): number => Number(team.slice(3)) * 9 + ((i * 13 + year) % 17);
    const redScore = red.reduce((s, t) => s + strength(t), 0);
    const blueScore = blue.reduce((s, t) => s + strength(t), 0);
    const match: CorpusMatch = {
      matchKey: `${eventKey}_qm${i + 1}`,
      eventKey,
      compLevel: "qm",
      matchNumber: i + 1,
      setNumber: 1,
      sortTime: startSortTime + i * 1_000,
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
      hasScoreBreakdown: true,
      scoreBreakdownRaw: JSON.stringify({ red: side2024(i, 0), blue: side2024(i, 1) }),
      videoKey: null,
    };
    upsertMatch(db, match);
  }
}

async function bodies(db: Corpus, rpColdPrior: boolean | undefined): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await publishSeasons(db, {
    seasons: [2024],
    algorithms: [spr],
    bucket: "rp-cold-prior-test-never-uploaded",
    dryRun: true,
    skipState: true,
    generation: "rp-cold-prior-test",
    computedAt: "2026-09-28T00:00:00.000Z",
    artifactSink: (_kind, key, body) => {
      out.set(key, body);
    },
    ...(rpColdPrior === undefined ? {} : { rpColdPrior }),
  });
  return out;
}

describe("publishSeasons rpColdPrior", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-rp-cold-prior-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
    seedSeason(db, 2024, "2024test", Date.parse("2024-03-01T15:00:00Z"), 30);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("absent and false publish byte-identical bodies", async () => {
    const absent = await bodies(db, undefined);
    const off = await bodies(db, false);
    expect([...off.keys()]).toEqual([...absent.keys()]);
    for (const [key, body] of absent) expect(off.get(key), key).toBe(body);
    expect(absent.size).toBeGreaterThan(0);
  });

  it("ON leaves every Compare page byte-identical (winner odds cannot move) and does move a published RP body", async () => {
    const off = await bodies(db, undefined);
    const on = await bodies(db, true);
    expect([...on.keys()]).toEqual([...off.keys()]);

    const compareKeys = [...off.keys()].filter((key) => key.startsWith("v1/compare/"));
    expect(compareKeys.length).toBeGreaterThan(0);
    for (const key of compareKeys) expect(on.get(key), key).toBe(off.get(key));

    const changed = [...off.keys()].filter((key) => !key.startsWith("v1/compare/") && on.get(key) !== off.get(key));
    expect(changed.length).toBeGreaterThan(0);
  });
});
