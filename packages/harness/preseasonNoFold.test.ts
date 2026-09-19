/**
 * Preseason Week 0 play (TBA `event_type` 100) is PREDICTED and never FOLDED
 * (`foldsIntoRatings`, quick task 260919-368). Until then every season's 11 to
 * 52 Week 0 matches moved the ratings official week 1 was predicted from.
 *
 * What is pinned here, at every level a fold happens:
 *   - each algorithm's `update` returns the SAME state object for a type 100
 *     match, so nothing downstream can have moved;
 *   - the walk-forward replay still RECORDS a prediction for it, and the
 *     official match after it is predicted exactly as if Week 0 had not been
 *     in the stream at all;
 *   - `SigmaScoutLayer.foldPlayed` still prices it (band, RP odds) while its
 *     Sigma beliefs, RP beliefs, Sigma population and RP mean shift do not move;
 *   - offseason play (type 99) still folds, which is the asymmetry the rule is.
 */
import { describe, expect, it } from "vitest";
import { epa } from "../core/algorithms/epa.js";
import { opr } from "../core/algorithms/opr.js";
import { spr } from "../core/algorithms/spr.js";
import { foldsIntoRatings, isOfficialEventType, OFFSEASON_EVENT_TYPE, PRESEASON_EVENT_TYPE } from "../core/algorithms/eventTypes.js";
import type { AlgorithmModule, MatchResult, Prediction } from "../core/algorithms/types.js";
import { RP_RULE_MODULES } from "../core/rankingPoints/rules.js";
import { WalkForwardSimulator } from "./replay.js";
import { SigmaScoutLayer } from "./sigmaScoutLayer.js";

const RED = ["frc1", "frc2", "frc3"];
const BLUE = ["frc4", "frc5", "frc6"];
const ALL_TEAMS = [...RED, ...BLUE];
const ALGORITHMS: readonly AlgorithmModule<any>[] = [opr, epa, spr];

function match(eventKey: string, eventType: number, matchNumber: number, redScore: number, blueScore: number): MatchResult {
  return {
    matchKey: `${eventKey}_qm${matchNumber}`,
    eventKey,
    compLevel: "qm",
    setNumber: 1,
    matchNumber,
    redTeams: RED,
    blueTeams: BLUE,
    redSurrogates: [],
    blueSurrogates: [],
    redDqs: [],
    blueDqs: [],
    eventType,
    week: eventType === 0 ? 0 : null,
    winner: redScore > blueScore ? "red" : "blue",
    redScore,
    blueScore,
    redRpEarned: null,
    blueRpEarned: null,
    hasScoreBreakdown: false,
    scoreBreakdownRaw: null,
  };
}

const WEEK0 = [match("2026week0", PRESEASON_EVENT_TYPE, 1, 210, 35), match("2026week0", PRESEASON_EVENT_TYPE, 2, 20, 190)];
const OFFICIAL = [match("2026casj", 0, 1, 120, 95), match("2026casj", 0, 2, 101, 130)];

describe("foldsIntoRatings is not isOfficialEventType, and the difference is offseason", () => {
  it("official folds, offseason folds, preseason does not, and an unknown type degrades toward folding", () => {
    expect(foldsIntoRatings(0)).toBe(true);
    expect(foldsIntoRatings(OFFSEASON_EVENT_TYPE)).toBe(true);
    expect(foldsIntoRatings(PRESEASON_EVENT_TYPE)).toBe(false);
    expect(foldsIntoRatings(-1)).toBe(true);
    // The two predicates agree everywhere except offseason.
    expect(isOfficialEventType(OFFSEASON_EVENT_TYPE)).toBe(false);
    expect(isOfficialEventType(PRESEASON_EVENT_TYPE)).toBe(false);
  });
});

describe.each(ALGORITHMS.map((algorithm) => [algorithm.id, algorithm] as const))("%s: a Week 0 match teaches nothing", (_id, algorithm) => {
  it("update returns the SAME state object for a type 100 match, and a different one for the same match at an official or an offseason event", () => {
    const state = algorithm.initState([...ALL_TEAMS]);
    expect(algorithm.update(state, WEEK0[0]!)).toBe(state);
    expect(algorithm.update(state, { ...WEEK0[0]!, eventType: 0, week: 0 })).not.toBe(state);
    expect(algorithm.update(state, { ...WEEK0[0]!, eventType: OFFSEASON_EVENT_TYPE })).not.toBe(state);
  });

  it("the replay still predicts Week 0, and predicts the official matches after it exactly as if Week 0 were not in the stream", () => {
    const withWeek0 = new WalkForwardSimulator([...WEEK0, ...OFFICIAL]).run(algorithm, ALL_TEAMS);
    const without = new WalkForwardSimulator(OFFICIAL).run(algorithm, ALL_TEAMS);
    expect(withWeek0.map((r) => r.match.matchKey)).toEqual([...WEEK0, ...OFFICIAL].map((m) => m.matchKey));
    expect(withWeek0.slice(WEEK0.length).map((r) => r.prediction)).toEqual(without.map((r) => r.prediction));
    // Non-vacuity: the second official match's prediction DID learn from the
    // first, so equality above is not two untouched priors agreeing.
    expect(without[1]!.prediction).not.toEqual(without[0]!.prediction);
  });

  it("runAll agrees with run, and its final state after a Week 0 only stream is the initial state", () => {
    const records = new WalkForwardSimulator(WEEK0).runAll([algorithm], ALL_TEAMS);
    expect(records).toHaveLength(WEEK0.length);
    const initial = new WalkForwardSimulator([]).runAll([algorithm], ALL_TEAMS).finalStates.get(algorithm.id);
    expect(records.finalStates.get(algorithm.id)).toEqual(initial);
  });
});

describe("SigmaScoutLayer.foldPlayed prices a Week 0 match and folds none of its four level-2 quantities", () => {
  const PREDICTION: Prediction = { winner: "red", pRedWin: 0.6, redScore: 110, blueScore: 100 };

  function snapshot(layer: SigmaScoutLayer): unknown {
    return {
      sigma: [...layer.sigmaBeliefs()],
      population: layer.sigmaPopulation(),
      rp: [...layer.rpVariableBeliefs()],
      meanShift: layer.rpMeanShiftState(),
    };
  }

  function warmLayer(): SigmaScoutLayer {
    const layer = new SigmaScoutLayer(RP_RULE_MODULES[2026]!, "spr");
    const talent = new Map(ALL_TEAMS.map((teamKey, i) => [teamKey, 30 + i * 4]));
    for (const m of OFFICIAL) layer.foldPlayed(m, PREDICTION, talent);
    return layer;
  }

  it("a type 100 match returns a record with a band and leaves every belief exactly where it was", () => {
    const layer = warmLayer();
    const before = snapshot(layer);
    const record = layer.foldPlayed(WEEK0[0]!, PREDICTION, new Map(ALL_TEAMS.map((teamKey) => [teamKey, 999])));
    expect(record.matchBand).toBeDefined();
    expect(snapshot(layer)).toEqual(before);
  });

  it("the same match at an official and at an offseason event DOES move the beliefs", () => {
    for (const eventType of [0, OFFSEASON_EVENT_TYPE]) {
      const layer = warmLayer();
      const before = snapshot(layer);
      layer.foldPlayed({ ...WEEK0[0]!, eventType }, PREDICTION, new Map(ALL_TEAMS.map((teamKey) => [teamKey, 999])));
      expect(snapshot(layer), `event type ${eventType}`).not.toEqual(before);
    }
  });
});
