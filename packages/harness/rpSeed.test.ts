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
import { describe, expect, it } from "vitest";
import { SigmaScoutLayer } from "./sigmaScoutLayer.js";
import { readRpBeliefs, withRpBeliefs, serializeState } from "./stateSnapshot.js";
import { RP_RULE_MODULES } from "../core/rankingPoints/rules.js";
import { spr } from "../core/algorithms/spr.js";
import { RpMomentsAccumulator } from "../core/rankingPoints/empiricalMoments.js";
import type { MatchResult, Prediction } from "../core/algorithms/types.js";

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
