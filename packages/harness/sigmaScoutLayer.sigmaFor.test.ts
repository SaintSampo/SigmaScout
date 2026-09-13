/**
 * Quick task 260913-m45 Task 1: `SigmaScoutLayer.sigmaFor` — the read-only,
 * one-team accessor `publish.ts`'s fold loop reads right after `foldPlayed`,
 * to capture each match's per-team Sigma Score for the metric-history rows.
 *
 * Distinct from `consistencyByTeam()`, which scores EVERY team the layer has
 * ever seen and must never be called once per match (see that method's own
 * doc comment). `sigmaFor` delegates to the accumulator's own read-only
 * `sigmaFor`, which goes through `#readBelief` rather than `#mutableBelief` —
 * see `#readBelief`'s doc comment for the real order-dependence bug a single
 * insert-on-read accessor once caused (two orchestrations produced
 * different ranking-point pmfs for the same event because merely reading a
 * team created a belief entry).
 */
import { describe, expect, it } from "vitest";
import type { MatchResult, Prediction } from "../core/algorithms/types.js";
import { SigmaScoutLayer } from "./sigmaScoutLayer.js";

function fixtureMatch(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    matchKey: "2026casj_qm1",
    eventKey: "2026casj",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 1,
    redTeams: ["frc1", "frc2", "frc3"],
    blueTeams: ["frc4", "frc5", "frc6"],
    redSurrogates: [],
    blueSurrogates: [],
    eventType: 0,
    week: null,
    winner: "red",
    redScore: 120,
    blueScore: 95,
    redRpEarned: 2,
    blueRpEarned: 0,
    redDqs: [],
    blueDqs: [],
    hasScoreBreakdown: true,
    scoreBreakdownRaw: "{}",
    ...overrides,
  };
}

function fixturePrediction(overrides: Partial<Prediction> = {}): Prediction {
  return {
    winner: "red",
    pRedWin: 0.6234567,
    redScore: 110.123456,
    blueScore: 100.654321,
    ...overrides,
  };
}

describe("SigmaScoutLayer.sigmaFor (quick task 260913-m45)", () => {
  it("is a finite positive number before any fold, for a Sigma-enabled layer", () => {
    const layer = new SigmaScoutLayer(undefined, "spr");
    const value = layer.sigmaFor("frc1");
    expect(value).toBeDefined();
    expect(Number.isFinite(value)).toBe(true);
    expect(value as number).toBeGreaterThan(0);
  });

  it("equals consistencyByTeam().get(teamKey) for every roster team right after folding one match with talent", () => {
    const layer = new SigmaScoutLayer(undefined, "spr");
    const match = fixtureMatch();
    const prediction = fixturePrediction();
    const talentAfterMatch = new Map<string, number>([
      ["frc1", 50],
      ["frc2", 40],
      ["frc3", 30],
      ["frc4", 20],
      ["frc5", 10],
      ["frc6", 0],
    ]);

    layer.foldPlayed(match, prediction, talentAfterMatch);

    const consistency = layer.consistencyByTeam();
    for (const teamKey of [...match.redTeams, ...match.blueTeams]) {
      expect(layer.sigmaFor(teamKey)).toBe(consistency.get(teamKey));
    }
  });

  it("reading an unseen team adds no key to consistencyByTeam() or sigmaBeliefs()", () => {
    const layer = new SigmaScoutLayer(undefined, "spr");
    expect(layer.consistencyByTeam().has("frcUnseen")).toBe(false);
    expect(layer.sigmaBeliefs().has("frcUnseen")).toBe(false);

    layer.sigmaFor("frcUnseen");

    expect(layer.consistencyByTeam().has("frcUnseen")).toBe(false);
    expect(layer.sigmaBeliefs().has("frcUnseen")).toBe(false);
  });

  it("returns undefined for an algorithm with no Sigma accumulator (opr)", () => {
    const layer = new SigmaScoutLayer(undefined, "opr");
    expect(layer.sigmaFor("frc1")).toBeUndefined();
  });
});
