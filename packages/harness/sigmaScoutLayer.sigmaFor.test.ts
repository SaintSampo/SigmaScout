/**
 * `SigmaScoutLayer.sigmaFor`: the read-only, one-team accessor `publish.ts`'s
 * fold loop reads right after `foldPlayed` for metric-history rows. Unlike
 * `sigmaScoreByTeam()` it scores one team, and reading must never create a belief.
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

describe("SigmaScoutLayer.sigmaFor", () => {
  it("is a finite positive number before any fold, for a Sigma-enabled layer", () => {
    const layer = new SigmaScoutLayer(undefined, "spr");
    const value = layer.sigmaFor("frc1");
    expect(value).toBeDefined();
    expect(Number.isFinite(value)).toBe(true);
    expect(value as number).toBeGreaterThan(0);
  });

  it("equals sigmaScoreByTeam().get(teamKey) for every roster team right after folding one match with talent", () => {
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

    const sigmaScores = layer.sigmaScoreByTeam();
    for (const teamKey of [...match.redTeams, ...match.blueTeams]) {
      expect(layer.sigmaFor(teamKey)).toBe(sigmaScores.get(teamKey));
    }
  });

  it("reading an unseen team adds no key to sigmaScoreByTeam() or sigmaBeliefs()", () => {
    const layer = new SigmaScoutLayer(undefined, "spr");
    expect(layer.sigmaScoreByTeam().has("frcUnseen")).toBe(false);
    expect(layer.sigmaBeliefs().has("frcUnseen")).toBe(false);

    layer.sigmaFor("frcUnseen");

    expect(layer.sigmaScoreByTeam().has("frcUnseen")).toBe(false);
    expect(layer.sigmaBeliefs().has("frcUnseen")).toBe(false);
  });

  it("returns undefined for an algorithm with no Sigma accumulator (opr)", () => {
    const layer = new SigmaScoutLayer(undefined, "opr");
    expect(layer.sigmaFor("frc1")).toBeUndefined();
  });
});
