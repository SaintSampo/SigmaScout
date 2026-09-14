/**
 * THE D1 SEED CARRIES THE RP BELIEFS (plan 09-08, D-21).
 *
 * Without this link the rest of plan 09-08 is inert in production. The live
 * Worker resumes its RP accumulator from the team rows `publish.ts` emits into
 * `reports/publish/seed-{id}.sql`; a seed with no `sigmascoutRp` key makes
 * every resumed Worker cold-start its beliefs while the artifacts it serves
 * already carry a full season's pmfs. Live and offline then price the same
 * match from two different histories, with both sides looking healthy and
 * only the numbers differing — which is precisely the failure the state-shape
 * bump exists to turn into a loud error.
 *
 * This test pins the CHAIN rather than any one function:
 *   `SigmaScoutLayer.rpVariableBeliefs()` -> `withRpBeliefs` -> a team row ->
 *   `readRpBeliefs` -> the map the Worker rebuilds its accumulator from.
 * Break any link and a live pmf still appears, still parses, and is simply
 * wrong.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SigmaScoutLayer } from "./sigmaScoutLayer.js";
import { readRpBeliefs, readRpMeanShift, withRpBeliefs, withRpMeanShift, serializeState } from "./stateSnapshot.js";
import { makeRankingPointFiller } from "./publish.js";
import { RP_RULE_MODULES } from "../core/rankingPoints/rules.js";
import { spr } from "../core/algorithms/spr.js";
import { RpMomentsAccumulator } from "../core/rankingPoints/empiricalMoments.js";
import { RP_MEAN_SHIFT_WARMUP_OBSERVATIONS, RpMeanShiftAccumulator } from "../core/rankingPoints/meanShift.js";
import type { MatchResult, Prediction, UpcomingMatch } from "../core/algorithms/types.js";

const RULES_2026 = RP_RULE_MODULES[2026]!;
const RED = ["frc1", "frc2", "frc3"];
const BLUE = ["frc4", "frc5", "frc6"];
const ALL_TEAMS = [...RED, ...BLUE];

const STAMP = { generation: "gen-1", computedAt: "2026-09-11T00:00:00.000Z" };

function breakdown(redHub: number, blueHub: number, redTower: number, blueTower: number): string {
  const side = (hub: number, tower: number) => ({
    autoTowerPoints: Math.round(tower / 2),
    endGameTowerPoints: tower - Math.round(tower / 2),
    hubScore: { totalCount: hub },
    energizedAchieved: hub >= 100,
    superchargedAchieved: hub >= 360,
    traversalAchieved: tower >= 40,
  });
  return JSON.stringify({ red: side(redHub, redTower), blue: side(blueHub, blueTower) });
}

function match(matchNumber: number, redScore: number, blueScore: number, raw: string): MatchResult {
  return {
    matchKey: `2026casj_qm${matchNumber}`,
    eventKey: "2026casj",
    compLevel: "qm",
    setNumber: 1,
    matchNumber,
    redTeams: RED,
    blueTeams: BLUE,
    redSurrogates: [],
    blueSurrogates: [],
    redDqs: [],
    blueDqs: [],
    eventType: 0,
    week: null,
    winner: redScore > blueScore ? "red" : "blue",
    redScore,
    blueScore,
    redRpEarned: null,
    blueRpEarned: null,
    hasScoreBreakdown: true,
    scoreBreakdownRaw: raw,
  };
}

function prediction(redScore: number, blueScore: number): Prediction {
  return { winner: redScore > blueScore ? "red" : "blue", pRedWin: 0.5, redScore, blueScore };
}

/** A layer with a couple of matches folded, so its beliefs are real running state. */
function foldedLayer(): SigmaScoutLayer {
  const layer = new SigmaScoutLayer(RULES_2026, "spr");
  layer.foldPlayed(match(1, 120, 95, breakdown(140, 90, 42, 28)), prediction(118, 99));
  layer.foldPlayed(match(2, 105, 130, breakdown(118, 165, 31, 55)), prediction(110, 125));
  return layer;
}

describe("the D1 seed carries the RP beliefs (plan 09-08, D-21)", () => {
  it("seed rows built the way publish.ts builds them round-trip rpVariableBeliefs() back out", () => {
    const layer = foldedLayer();
    const beliefs = layer.rpVariableBeliefs();

    // Non-vacuity: a layer that folded nothing would make the round-trip
    // below compare two empty maps and prove nothing.
    expect(beliefs.size, "the fixture folded no RP beliefs at all").toBeGreaterThan(0);

    const rows = withRpBeliefs(
      serializeState("spr", spr.version, spr.initState([...ALL_TEAMS]) as never, STAMP),
      beliefs
    );

    const recovered = readRpBeliefs(rows);
    expect([...recovered.keys()].sort()).toEqual([...beliefs.keys()].sort());
    for (const [teamKey, record] of beliefs) {
      expect(recovered.get(teamKey)).toEqual(record);
    }
  });

  it("the recovered beliefs rebuild an accumulator that prices identically to the layer's own", () => {
    const layer = foldedLayer();
    const rows = withRpBeliefs(
      serializeState("spr", spr.version, spr.initState([...ALL_TEAMS]) as never, STAMP),
      layer.rpVariableBeliefs()
    );

    // This is the assertion that matters operationally: what the Worker
    // rebuilds from the seed must be the same estimator the publisher had.
    const resumed = RpMomentsAccumulator.fromBeliefs(RULES_2026, readRpBeliefs(rows));
    expect(resumed.momentsFor(RED, 130, 400)).toEqual(layer.rpAccumulator!.momentsFor(RED, 130, 400));
    expect(resumed.momentsFor(BLUE, 112, 380)).toEqual(layer.rpAccumulator!.momentsFor(BLUE, 112, 380));
  });

  it("a season with no registered RP rules yields an empty belief map rather than throwing", () => {
    // The feature is ABSENT for such a season, not empty — `publish.ts` must
    // still be able to emit a seed for it.
    const layer = new SigmaScoutLayer(undefined, "spr");
    expect(layer.rpVariableBeliefs().size).toBe(0);
    const rows = serializeState("spr", spr.version, spr.initState([...ALL_TEAMS]) as never, STAMP);
    expect(() => withRpBeliefs(rows, layer.rpVariableBeliefs())).not.toThrow();
    expect(readRpBeliefs(withRpBeliefs(rows, layer.rpVariableBeliefs())).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Shape 16 (quick task 260914-01x): the seed carries the RP mean shift on the
// LEAGUE row, and the pre-schedule filler prices with it.
// ---------------------------------------------------------------------------

const ROTATION = ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"];

/** Match `k` of a 2026 stream whose threshold inputs trend up, so the shift is positive and past warmup by k ~ 100. */
function trendingMatch(k: number): MatchResult {
  const r = k % 6;
  const rotated = [...ROTATION.slice(r), ...ROTATION.slice(0, r)];
  const red = k % 2 === 0 ? rotated.slice(0, 3) : [rotated[0]!, rotated[2]!, rotated[4]!];
  const blue = ROTATION.filter((t) => !red.includes(t));
  const hub = (side: number) => Math.max(0, Math.round(60 + 0.9 * k + (((k * 37 + side * 11) % 31) - 15)));
  const tower = (side: number) => 5 * Math.min(24, Math.max(0, Math.round(4 + 0.06 * k + (((k * 13 + side * 7) % 9) - 4))));
  const redScore = hub(0) + tower(0) + 20;
  const blueScore = hub(1) + tower(1) + 21;
  return { ...match(k + 1, redScore, blueScore, breakdown(hub(0), hub(1), tower(0), tower(1))), redTeams: red, blueTeams: blue };
}

/** A layer folded past the mean shift's warmup on every variable. */
function warmedLayer(): SigmaScoutLayer {
  const layer = new SigmaScoutLayer(RULES_2026, "spr");
  for (let k = 0; k < 130; k++) {
    const m = trendingMatch(k);
    layer.foldPlayed(m, prediction(m.redScore, m.blueScore));
  }
  return layer;
}

describe("the D1 seed carries the RP mean shift (shape 16, quick task 260914-01x)", () => {
  it("seed rows built the way publish.ts builds them carry rpMeanShiftState() on the LEAGUE row, and it resumes to the same accumulator", () => {
    const layer = warmedLayer();
    const state = layer.rpMeanShiftState()!;
    // Non-vacuity: a shift that never passed warmup round-trips just as happily and means nothing.
    for (const [name, v] of Object.entries(state.variables)) {
      expect(v.count, name).toBeGreaterThanOrEqual(RP_MEAN_SHIFT_WARMUP_OBSERVATIONS);
      expect(v.sum, name).not.toBe(0);
    }

    const rows = withRpMeanShift(
      withRpBeliefs(serializeState("spr", spr.version, spr.initState([...ALL_TEAMS]) as never, STAMP), layer.rpVariableBeliefs()),
      state
    );
    const league = rows.find((row) => row.scopeKind === "league")!;
    expect(JSON.parse(league.stateJson).sigmascoutRpMeanShift).toEqual(state);
    expect(rows.filter((row) => row.scopeKind === "team").every((row) => !row.stateJson.includes("sigmascoutRpMeanShift"))).toBe(true);

    const resumed = RpMeanShiftAccumulator.fromState(RULES_2026, readRpMeanShift(rows));
    expect(resumed.toState()).toEqual(state);
    const moments = layer.rpAccumulator!.momentsFor(RED, 130, 400);
    expect(resumed.apply(moments, true)).not.toBe(moments);
    expect(resumed.apply(moments, true)).toEqual(RpMeanShiftAccumulator.fromState(RULES_2026, state).apply(moments, true));
  });

  it("publish.ts collects the final season's shift and chains withRpMeanShift into the seed block (structural)", () => {
    const source = readFileSync(new URL("./publish.ts", import.meta.url), "utf8");
    expect(source).toContain("layers.get(algorithm.id)!.rpMeanShiftState()");
    const block = /const state = finalSeasonStates\.get\(algorithm\.id\);[\s\S]*?emitSeedSql\(/.exec(source);
    expect(block, "expected to find publish.ts's seed-emission block").not.toBeNull();
    expect(block![0]).toContain("withRpMeanShift(rows, rpMeanShift)");
  });
});

describe("makeRankingPointFiller applies the mean shift per synthetic alliance (CD-05)", () => {
  const upcoming = (red: readonly string[], blue: readonly string[]): UpcomingMatch => ({
    matchKey: "2026casj_qm999",
    eventKey: "2026casj",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 999,
    redTeams: red,
    blueTeams: blue,
    redSurrogates: [],
    blueSurrogates: [],
    eventType: 0,
    week: null,
  });

  it("absent shift prices exactly as a zero-observation shift does, and a warm shift raises the bonus odds", () => {
    const layer = warmedLayer();
    const sigma = layer.consistencyByTeam();
    const shift = RpMeanShiftAccumulator.fromState(RULES_2026, layer.rpMeanShiftState());
    const input = prediction(140, 135);
    const m = upcoming(RED, BLUE);

    const absent = makeRankingPointFiller(layer.rpAccumulator, RULES_2026, sigma, ALL_TEAMS)!(m, input);
    const fresh = makeRankingPointFiller(layer.rpAccumulator, RULES_2026, sigma, ALL_TEAMS, new RpMeanShiftAccumulator(RULES_2026))!(m, input);
    const shifted = makeRankingPointFiller(layer.rpAccumulator, RULES_2026, sigma, ALL_TEAMS, shift)!(m, input);

    expect(absent.redRpPmf).toBeDefined();
    expect(fresh).toEqual(absent);
    expect(shifted.redBonusRp).not.toEqual(absent.redBonusRp);
    // Positive residuals on a rising stream: the energized odds go up, not down.
    expect(shifted.redBonusRp![0]!).toBeGreaterThan(absent.redBonusRp![0]!);
    // The outcome half is not the shift's to move.
    expect(shifted.pRedWin).toBe(absent.pRedWin);
  });

  it("an alliance with a team lacking history prices unshifted, the other alliance still shifts", () => {
    const layer = warmedLayer();
    const sigma = new Map([...layer.consistencyByTeam(), ["frc99", 5]]);
    const shift = RpMeanShiftAccumulator.fromState(RULES_2026, layer.rpMeanShiftState());
    const input = prediction(140, 135);
    const coldRed = ["frc1", "frc2", "frc99"];
    const m = upcoming(coldRed, BLUE);
    const roster = [...ALL_TEAMS, "frc99"];

    const absent = makeRankingPointFiller(layer.rpAccumulator, RULES_2026, sigma, roster)!(m, input);
    const shifted = makeRankingPointFiller(layer.rpAccumulator, RULES_2026, sigma, roster, shift)!(m, input);
    expect(shifted.redBonusRp).toEqual(absent.redBonusRp);
    expect(shifted.blueBonusRp).not.toEqual(absent.blueBonusRp);
  });
});
