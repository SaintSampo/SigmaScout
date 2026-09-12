/**
 * THE D1 SEED CARRIES THE SIGMA SCORE BELIEFS (shape 11).
 *
 * Quick task 260910-wg8 wired Sigma resume-and-persist on the WORKER side --
 * `readSigmaBeliefs`/`readSigmaPopulation` on the way in, `withSigmaBeliefs`/
 * `withSigmaPopulation` on the way back out -- and left the SEED half
 * unwritten. Plan 09-08 found the gap while landing the RP passenger beside
 * it and filed it rather than widening its own scope. This is that fix's test.
 *
 * Without the link, a Worker resumed from a fresh seed cold-starts BPR's Sigma
 * Score bands from the flat prior while the artifacts it serves already carry
 * fully warmed ones. No error, no missing field: live and offline simply price
 * the same match from two different histories, both sides looking healthy --
 * exactly the failure the Swing and RP passengers were written to prevent, on
 * the premier published algorithm.
 *
 * These tests pin the CHAIN rather than any one function:
 *   `SigmaScoutLayer.sigmaBeliefs()`    -> `withSigmaBeliefs`    -> a TEAM row
 *   `SigmaScoutLayer.sigmaPopulation()` -> `withSigmaPopulation` -> the LEAGUE row
 * and back out through `readSigmaBeliefs`/`readSigmaPopulation` into the
 * accumulator the Worker rebuilds. Break any link and a live band still
 * appears, still parses, and is simply wrong.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SigmaScoutLayer } from "./sigmaScoutLayer.js";
import {
  readSigmaBeliefs,
  readSigmaPopulation,
  serializeState,
  withSigmaBeliefs,
  withSigmaPopulation,
  type StateRow,
} from "./stateSnapshot.js";
import { SigmaScoreAccumulator } from "./sigmaScore.js";
import { RP_RULE_MODULES } from "../core/rankingPoints/rules.js";
import { spr } from "../core/algorithms/bpr.js";
import { epa } from "../core/algorithms/epa.js";
import { opr } from "../core/algorithms/opr.js";
import type { MatchResult, Prediction } from "../core/algorithms/types.js";

const RULES_2026 = RP_RULE_MODULES[2026]!;
const RED = ["frc1", "frc2", "frc3"];
const BLUE = ["frc4", "frc5", "frc6"];
const ALL_TEAMS = [...RED, ...BLUE];

const STAMP = { generation: "gen-1", computedAt: "2026-09-11T00:00:00.000Z" };

function match(matchNumber: number, redScore: number, blueScore: number): MatchResult {
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
    hasScoreBreakdown: false,
    scoreBreakdownRaw: null,
  };
}

function prediction(redScore: number, blueScore: number): Prediction {
  return { winner: redScore > blueScore ? "red" : "blue", pRedWin: 0.5, redScore, blueScore };
}

/** Talent readings, so a seeded belief carries a real `talent` term rather than the floor. */
const TALENT = new Map(ALL_TEAMS.map((teamKey, i) => [teamKey, 20 + i * 3]));

/** A BPR layer with a few matches folded, so its Sigma state is real running state. */
function foldedLayer(): SigmaScoutLayer {
  const layer = new SigmaScoutLayer(RULES_2026, "spr");
  layer.foldPlayed(match(1, 120, 95), prediction(118, 99), TALENT);
  layer.foldPlayed(match(2, 105, 130), prediction(110, 125), TALENT);
  layer.foldPlayed(match(3, 141, 88), prediction(120, 101), TALENT);
  return layer;
}

/** Rows the way `publish.ts` builds them for the seed: team rows, then the two Sigma passengers. */
function seedRows(layer: SigmaScoutLayer): StateRow[] {
  const rows = withSigmaBeliefs(
    serializeState("spr", spr.version, spr.initState([...ALL_TEAMS]) as never, STAMP),
    layer.sigmaBeliefs()
  );
  const population = layer.sigmaPopulation();
  return population === undefined ? rows : withSigmaPopulation(rows, population);
}

describe("the D1 seed carries the Sigma Score beliefs (shape 11, the gap plan 09-08 filed)", () => {
  it("seed rows built the way publish.ts builds them round-trip sigmaBeliefs() back out WARMED, not at the prior", () => {
    const layer = foldedLayer();
    const beliefs = layer.sigmaBeliefs();

    // Non-vacuity: a layer that folded nothing would make the round-trip below
    // compare two empty maps, and a zeroed belief would round-trip just as
    // happily as a warmed one while meaning the opposite thing.
    expect(beliefs.size, "the fixture folded no Sigma beliefs at all").toBe(ALL_TEAMS.length);
    for (const [teamKey, belief] of beliefs) {
      expect(belief.varWeight, `${teamKey} carries no folded evidence`).toBeGreaterThan(0);
      expect(belief.sumSquares, `${teamKey} carries no residual history`).toBeGreaterThan(0);
      expect(belief.talent, `${teamKey} kept the talent floor`).toBeGreaterThan(1);
    }

    const recovered = readSigmaBeliefs(seedRows(layer));
    expect([...recovered.keys()].sort()).toEqual([...beliefs.keys()].sort());
    for (const [teamKey, belief] of beliefs) {
      expect(recovered.get(teamKey)).toEqual(belief);
    }
  });

  it("the talent population round-trips through the LEAGUE row", () => {
    const layer = foldedLayer();
    const population = layer.sigmaPopulation();

    expect(population, "a BPR layer must expose a population").toBeDefined();
    // Non-vacuity again: an all-zero population is the flat prior wearing the
    // shape of a real one.
    expect(population!.count).toBeGreaterThan(0);
    expect(population!.sumSquares).toBeGreaterThan(0);
    expect(population!.talentSquares).toBeGreaterThan(0);

    expect(readSigmaPopulation(seedRows(layer))).toEqual(population);
  });

  it("the recovered beliefs and population rebuild an accumulator that scores identically to the layer's own", () => {
    const layer = foldedLayer();
    const rows = seedRows(layer);

    // The assertion that matters operationally: what the Worker rebuilds from
    // the seed must be the same estimator the publisher had.
    const resumed = SigmaScoreAccumulator.fromBeliefs(readSigmaBeliefs(rows), readSigmaPopulation(rows));
    expect(new Map(resumed.scoreByTeam())).toEqual(new Map(layer.consistencyByTeam()));
  });

  it("the LEAGUE row is load-bearing, not decoration -- beliefs WITHOUT the population score differently", () => {
    const layer = foldedLayer();
    const beliefs = readSigmaBeliefs(seedRows(layer));

    // This is why `withSigmaPopulation` must be chained alongside
    // `withSigmaBeliefs` rather than treated as optional: a resumed
    // accumulator handed beliefs but no population falls back to the flat
    // prior and computes different bands from the very beliefs it was handed.
    const withoutPopulation = SigmaScoreAccumulator.fromBeliefs(beliefs, undefined);
    expect(new Map(withoutPopulation.scoreByTeam())).not.toEqual(new Map(layer.consistencyByTeam()));
  });

  it("a non-Sigma algorithm seeds with NO Sigma key rather than an empty one", () => {
    for (const algorithm of [epa, opr]) {
      const layer = new SigmaScoutLayer(RULES_2026, algorithm.id);
      layer.foldPlayed(match(1, 120, 95), prediction(118, 99), TALENT);

      expect(layer.usesSigma, `${algorithm.id} must not use Sigma Score`).toBe(false);
      expect(layer.sigmaBeliefs().size).toBe(0);
      expect(layer.sigmaPopulation()).toBeUndefined();

      // An absent key, not a zeroed one: a zeroed belief would resume as a
      // team with real-but-empty history rather than as a team with none.
      const rows = withSigmaBeliefs(
        serializeState(algorithm.id, algorithm.version, algorithm.initState([...ALL_TEAMS]) as never, STAMP),
        layer.sigmaBeliefs()
      );
      for (const row of rows) {
        expect(row.stateJson, `${algorithm.id} seeded a Sigma key`).not.toContain("sigmascoutSigma");
      }
      expect(readSigmaBeliefs(rows).size).toBe(0);
      expect(readSigmaPopulation(rows)).toBeUndefined();
    }
  });
});

describe("publish.ts's seed block chains every level-2 passenger (structural)", () => {
  it("the one emitSeedSql call site is fed rows carrying Swing, Sigma, the Sigma population, and RP", () => {
    const source = readFileSync(new URL("./publish.ts", import.meta.url), "utf8");
    const block = /const state = finalSeasonStates\.get\(algorithm\.id\);[\s\S]*?emitSeedSql\(/.exec(source);
    expect(block, "expected to find publish.ts's seed-emission block").not.toBeNull();
    const body = block![0];

    // Each of these is a separate, silent divergence between the live Worker
    // and the artifacts it serves if it goes missing. `withSigmaPopulation` is
    // listed beside the others deliberately: it writes the LEAGUE row rather
    // than a team row, which is exactly why it is the one easy to forget.
    for (const passenger of ["withSwingBeliefs(", "withSigmaBeliefs(", "withSigmaPopulation(", "withRpBeliefs("]) {
      expect(body, `publish.ts's seed block no longer chains ${passenger}`).toContain(passenger);
    }
  });
});
