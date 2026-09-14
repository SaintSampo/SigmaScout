/**
 * The walk-forward mean shift through the real `SigmaScoutLayer`. The unshifted
 * reference is rebuilt from the test's own `RpMomentsAccumulator`,
 * `SigmaScoreAccumulator` and `analyticRpPmf`, never from the layer under test.
 *
 * Three claims:
 *   1. HELD BY DEFAULT. A layer that publishes ranking points holds the shift
 *      and exposes its state; one that does not holds none. On the committed
 *      digest slice the shift is live (past warmup), not vacuous.
 *   2. PREDICT BEFORE UPDATE. The shift priced into match k is the mean of
 *      residuals from matches strictly before k.
 *   3. DIRECTION. On a synthetic 2020 season whose `endgamePoints` trends up,
 *      every RP field equals the unshifted reference until warmup, then the
 *      Shield Operational odds rise on fully-warm rows, and the outcome half
 *      and every non-RP field never move.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AlgorithmModule, MatchResult, Prediction } from "../core/algorithms/types.js";
import { TOTAL_METRIC_KEY } from "../core/algorithms/types.js";
import { RP_RULE_MODULES } from "../core/rankingPoints/rules.js";
import { rp2020 } from "../core/rankingPoints/2020.js";
import { RpMomentsAccumulator } from "../core/rankingPoints/empiricalMoments.js";
import { RP_MEAN_SHIFT_WARMUP_OBSERVATIONS } from "../core/rankingPoints/meanShift.js";
import { allianceBonusRpPmf, analyticRpPmf } from "../core/rankingPoints/analyticPmf.js";
import { SigmaScoutLayer } from "./sigmaScoutLayer.js";
import { WalkForwardSimulator, type PredictionRecord } from "./replay.js";
import { resolvePublishAlgorithms } from "./publish.js";
import { SigmaScoreAccumulator, usesSigmaScore } from "./sigmaScore.js";

const DIGEST_SLICE_FIXTURE_PATH = join("packages", "harness", "fixtures", "digest-slice.json");

const RP_FIELDS = new Set<string>([
  "redRpPmf",
  "blueRpPmf",
  "redBonusRp",
  "blueBonusRp",
  "matchOutcomePmf",
  "redOutcomeRp",
  "blueOutcomeRp",
  "redBonusRpPmf",
  "blueBonusRpPmf",
]);

interface DigestSliceFixture {
  sliceSeason: number;
  matches: MatchResult[];
}

function sameNumbers(a: readonly number[] | undefined, b: readonly number[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

describe("mean shift: held by the default layer", () => {
  const fixture = JSON.parse(readFileSync(DIGEST_SLICE_FIXTURE_PATH, "utf8")) as DigestSliceFixture;
  const spr = resolvePublishAlgorithms(undefined).find((a) => a.id === "spr") as AlgorithmModule<unknown>;
  const ruleModule = RP_RULE_MODULES[fixture.sliceSeason]!;

  it("a ranking-point layer holds it with no third argument; opr and a season with no rules hold none", () => {
    expect(new SigmaScoutLayer(ruleModule, "spr").rpMeanShiftState()?.season).toBe(ruleModule.season);
    expect(new SigmaScoutLayer(ruleModule, "opr").rpMeanShiftState()).toBeUndefined();
    expect(new SigmaScoutLayer(undefined, "spr").rpMeanShiftState()).toBeUndefined();
    expect(new SigmaScoutLayer(ruleModule).rpMeanShiftState()).toBeUndefined();
  });

  it("non-vacuity: on the committed digest slice every variable passes the warmup", () => {
    const stream = fixture.matches;
    const teams = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
    const talentAfterMatch = new Map<string, Map<string, number>>();
    const records = new WalkForwardSimulator(stream).runAll([spr], teams, undefined, (match, algorithmId, state) => {
      if (!usesSigmaScore(algorithmId)) return;
      const involved = [...match.redTeams, ...match.blueTeams];
      const metrics = spr.teamMetrics(state, involved);
      const talent = new Map<string, number>();
      for (const teamKey of involved) {
        const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
        if (total !== undefined) talent.set(teamKey, total);
      }
      talentAfterMatch.set(match.matchKey, talent);
    });
    const layer = new SigmaScoutLayer(ruleModule, "spr");
    for (const record of records) layer.foldPlayed(record.match, record.prediction, talentAfterMatch.get(record.match.matchKey));
    const state = layer.rpMeanShiftState()!;
    expect(Object.keys(state.variables).sort()).toEqual(ruleModule.thresholdVariables.map((v) => v.name).sort());
    for (const [name, v] of Object.entries(state.variables)) {
      expect(v.count, name).toBeGreaterThanOrEqual(RP_MEAN_SHIFT_WARMUP_OBSERVATIONS);
      expect(v.sum, name).not.toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// A synthetic 2020 season: six teams, endgamePoints trending up.
// ---------------------------------------------------------------------------

const TEAMS = ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"];
const QM_MATCHES = 160;

function endgame(k: number, side: number): number {
  const noise = ((k * 37 + side * 11) % 21) - 10;
  return Math.max(0, Math.round(20 + 0.4 * k + noise));
}

function syntheticSeason(): MatchResult[] {
  const out: MatchResult[] = [];
  for (let k = 0; k < QM_MATCHES; k++) {
    const r = k % 6;
    const rotated = [...TEAMS.slice(r), ...TEAMS.slice(0, r)];
    const red = k % 2 === 0 ? rotated.slice(0, 3) : [rotated[0]!, rotated[2]!, rotated[4]!];
    const blue = TEAMS.filter((t) => !red.includes(t));
    const redEnd = endgame(k, 0);
    const blueEnd = endgame(k, 1);
    const redScore = 40 + redEnd;
    const blueScore = 40 + blueEnd;
    const base = {
      eventKey: "2020syn",
      setNumber: 1,
      redTeams: red,
      blueTeams: blue,
      redSurrogates: [],
      blueSurrogates: [],
      redDqs: [],
      blueDqs: [],
      eventType: 0,
      week: null,
      redScore,
      blueScore,
      winner: redScore > blueScore ? ("red" as const) : blueScore > redScore ? ("blue" as const) : ("tie" as const),
      redRpEarned: null,
      blueRpEarned: null,
      hasScoreBreakdown: true,
      scoreBreakdownRaw: JSON.stringify({
        red: { endgamePoints: redEnd, shieldOperationalRankingPoint: redEnd >= 65 },
        blue: { endgamePoints: blueEnd, shieldOperationalRankingPoint: blueEnd >= 65 },
      }),
    };
    out.push({ ...base, matchKey: `2020syn_qm${k + 1}`, compLevel: "qm", matchNumber: k + 1 });
    // An interleaved elimination match: priced, folded into beliefs, never observed by the shift.
    if (k % 40 === 39) out.push({ ...base, matchKey: `2020syn_qf${k + 1}m1`, compLevel: "qf", matchNumber: 1 });
  }
  return out;
}

function syntheticPrediction(): Prediction {
  return { winner: "red", pRedWin: 0.5, redScore: 70, blueScore: 70 };
}

describe("mean shift on a synthetic 2020 season, default layer", () => {
  const stream = syntheticSeason();
  expect(stream.filter((m) => m.compLevel === "qm").length).toBeGreaterThanOrEqual(120);

  interface Step {
    readonly match: MatchResult;
    readonly input: Prediction;
    readonly folded: PredictionRecord;
    /** The unshifted RP fields, rebuilt from the test's own accumulators; empty when the layer's gates give none. */
    readonly unshifted: Partial<Prediction>;
    readonly countBefore: number;
    readonly redWarm: boolean;
    readonly blueWarm: boolean;
    readonly expectedRed: readonly number[] | undefined;
    readonly expectedBlue: readonly number[] | undefined;
  }

  const layer = new SigmaScoutLayer(rp2020, "spr");
  // The test's OWN walk-forward reference: beliefs, band variance, residual count and sum.
  const reference = new RpMomentsAccumulator(rp2020);
  const sigma = new SigmaScoreAccumulator();
  let refCount = 0;
  let refSum = 0;
  const steps: Step[] = [];
  const stateMismatches: string[] = [];

  for (const match of stream) {
    const prediction = syntheticPrediction();
    const state = layer.rpMeanShiftState()!.variables.endgamePoints!;
    if (state.count !== refCount || state.sum !== refSum) {
      stateMismatches.push(`${match.matchKey}: layer ${state.count}/${state.sum} vs reference ${refCount}/${refSum}`);
    }
    const redWarm = match.redTeams.every((t) => reference.hasHistory(t));
    const blueWarm = match.blueTeams.every((t) => reference.hasHistory(t));
    const redVariance = sigma.bandVarianceFor(match.redTeams);
    const blueVariance = sigma.bandVarianceFor(match.blueTeams);

    let unshifted: Partial<Prediction> = {};
    if (redVariance !== undefined && blueVariance !== undefined) {
      const pmf = analyticRpPmf({
        red: reference.momentsFor(match.redTeams, prediction.redScore, redVariance),
        blue: reference.momentsFor(match.blueTeams, prediction.blueScore, blueVariance),
        ruleModule: rp2020,
        eventType: match.eventType,
        compLevel: match.compLevel,
        pRedWin: prediction.pRedWin,
      });
      unshifted = {
        redRpPmf: pmf.redPmf,
        blueRpPmf: pmf.bluePmf,
        ...(pmf.redBonusProbabilities !== undefined ? { redBonusRp: pmf.redBonusProbabilities } : {}),
        ...(pmf.blueBonusProbabilities !== undefined ? { blueBonusRp: pmf.blueBonusProbabilities } : {}),
        ...(pmf.outcome !== undefined && pmf.redBonusPmf !== undefined && pmf.blueBonusPmf !== undefined
          ? {
              matchOutcomePmf: [pmf.outcome.pRedWin, pmf.outcome.pTie, pmf.outcome.pBlueWin],
              redOutcomeRp: [pmf.outcome.winRp, pmf.outcome.tieRp, 0],
              blueOutcomeRp: [0, pmf.outcome.tieRp, pmf.outcome.winRp],
              redBonusRpPmf: pmf.redBonusPmf,
              blueBonusRpPmf: pmf.blueBonusPmf,
            }
          : {}),
      };
    }

    const redMoments = reference.momentsFor(match.redTeams, 0, 0);
    const blueMoments = reference.momentsFor(match.blueTeams, 0, 0);
    const shiftBy = refCount >= RP_MEAN_SHIFT_WARMUP_OBSERVATIONS ? refSum / refCount : undefined;
    const shifted = (moments: typeof redMoments, warm: boolean) =>
      shiftBy !== undefined && warm && match.compLevel === "qm"
        ? allianceBonusRpPmf({ ...moments, meanVector: [moments.meanVector[0]! + shiftBy] }, rp2020, match.eventType).bonusProbabilities
        : undefined;

    steps.push({
      match,
      input: prediction,
      folded: layer.foldPlayed(match, prediction),
      unshifted,
      countBefore: refCount,
      redWarm,
      blueWarm,
      expectedRed: shifted(redMoments, redWarm),
      expectedBlue: shifted(blueMoments, blueWarm),
    });

    // Reference update: the probe's population, observed before the fold.
    const raw = JSON.parse(match.scoreBreakdownRaw!) as { red: { endgamePoints: number }; blue: { endgamePoints: number } };
    if (match.compLevel === "qm") {
      if (redWarm) {
        refCount += 1;
        refSum += raw.red.endgamePoints - redMoments.meanVector[0]!;
      }
      if (blueWarm) {
        refCount += 1;
        refSum += raw.blue.endgamePoints - blueMoments.meanVector[0]!;
      }
    }
    sigma.foldMatch(match, prediction);
    reference.fold(match.redTeams, { endgamePoints: raw.red.endgamePoints });
    reference.fold(match.blueTeams, { endgamePoints: raw.blue.endgamePoints });
  }

  it("the shift priced into match k equals the mean of residuals from matches strictly before k", () => {
    expect(stateMismatches).toEqual([]);
    const shiftedSteps = steps.filter((s) => s.expectedRed !== undefined);
    expect(shiftedSteps.length).toBeGreaterThan(20);
    for (const s of steps) {
      if (s.expectedRed !== undefined) expect(s.folded.prediction.redBonusRp, s.match.matchKey).toEqual(s.expectedRed);
      if (s.expectedBlue !== undefined) expect(s.folded.prediction.blueBonusRp, s.match.matchKey).toEqual(s.expectedBlue);
    }
    // Residuals on a rising series are positive on balance.
    expect(refSum / refCount).toBeGreaterThan(0);
  });

  it("before the warmup, every RP field equals the unshifted reference", () => {
    const early = steps.filter((s) => s.countBefore < RP_MEAN_SHIFT_WARMUP_OBSERVATIONS);
    expect(early.length).toBeGreaterThan(50);
    expect(early.filter((s) => s.folded.prediction.redBonusRp !== undefined).length).toBeGreaterThan(20);
    for (const s of early) {
      const p = s.folded.prediction as unknown as Record<string, unknown>;
      const u = s.unshifted as unknown as Record<string, unknown>;
      for (const field of RP_FIELDS) {
        expect(sameNumbers(p[field] as number[] | undefined, u[field] as number[] | undefined), `${s.match.matchKey} ${field}`).toBe(true);
      }
    }
  });

  it("after the warmup, bonus odds are at least the unshifted reference's on every fully-warm row and strictly greater on some", () => {
    const late = steps.filter((s) => s.countBefore >= RP_MEAN_SHIFT_WARMUP_OBSERVATIONS && s.match.compLevel === "qm");
    expect(late.length).toBeGreaterThan(20);
    let strictlyGreater = 0;
    for (const s of late) {
      expect(s.redWarm && s.blueWarm, s.match.matchKey).toBe(true);
      for (const side of ["redBonusRp", "blueBonusRp"] as const) {
        const shiftedOdds = s.folded.prediction[side]!;
        const unshiftedOdds = s.unshifted[side]!;
        expect(shiftedOdds[0]! >= unshiftedOdds[0]!, `${s.match.matchKey} ${side}`).toBe(true);
        if (shiftedOdds[0]! > unshiftedOdds[0]!) strictlyGreater++;
      }
    }
    expect(strictlyGreater).toBeGreaterThan(0);
  });

  it("the outcome half equals the unshifted reference's on every row, and every non-RP field is the input prediction's", () => {
    for (const s of steps) {
      expect(s.folded.match).toBe(s.match);
      const p = s.folded.prediction as unknown as Record<string, unknown>;
      const u = s.unshifted as unknown as Record<string, unknown>;
      for (const field of ["matchOutcomePmf", "redOutcomeRp", "blueOutcomeRp"]) {
        expect(sameNumbers(p[field] as number[] | undefined, u[field] as number[] | undefined), `${s.match.matchKey} ${field}`).toBe(true);
      }
      const input = s.input as unknown as Record<string, unknown>;
      for (const key of Object.keys(p)) {
        if (RP_FIELDS.has(key)) continue;
        expect(p[key] === input[key], `${s.match.matchKey} ${key}`).toBe(true);
      }
      expect(Object.keys(input).every((key) => key in p)).toBe(true);
    }
  });
});
