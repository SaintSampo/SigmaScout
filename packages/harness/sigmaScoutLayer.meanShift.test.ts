/**
 * The mean-shift measurement arm through the real `SigmaScoutLayer` (quick
 * task 260914-01x, SD-03, SD-05, CD-04).
 *
 * Three claims:
 *   1. INERT. No third argument and `{}` produce bitwise-equal RP fields on
 *      the committed digest slice, and neither holds an accumulator.
 *   2. PREDICT BEFORE UPDATE. The shift priced into match k is the mean of
 *      residuals from matches strictly before k, recomputed here with this
 *      test's own `RpMomentsAccumulator`, never the code under test.
 *   3. DIRECTION. On a synthetic 2020 season whose `endgamePoints` trends up,
 *      the arm matches control until warmup, then raises the Shield
 *      Operational odds on fully-warm rows, and never touches the outcome
 *      half or any non-RP field.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AlgorithmModule, MatchResult, Prediction } from "../core/algorithms/types.js";
import { TOTAL_METRIC_KEY } from "../core/algorithms/types.js";
import type { RpRuleModule } from "../core/rankingPoints/constants.js";
import { RP_RULE_MODULES } from "../core/rankingPoints/rules.js";
import { rp2020 } from "../core/rankingPoints/2020.js";
import { RpMomentsAccumulator } from "../core/rankingPoints/empiricalMoments.js";
import { allianceBonusRpPmf } from "../core/rankingPoints/analyticPmf.js";
import { SigmaScoutLayer } from "./sigmaScoutLayer.js";
import { WalkForwardSimulator, toLeakProofUpcoming, type PredictionRecord } from "./replay.js";
import { resolvePublishAlgorithms } from "./publish.js";
import { usesSigmaScore } from "./sigmaScore.js";

const DIGEST_SLICE_FIXTURE_PATH = join("packages", "harness", "fixtures", "digest-slice.json");

const RP_FIELDS = [
  "redRpPmf",
  "blueRpPmf",
  "redBonusRp",
  "blueBonusRp",
  "matchOutcomePmf",
  "redOutcomeRp",
  "blueOutcomeRp",
  "redBonusRpPmf",
  "blueBonusRpPmf",
] as const;
const BONUS_FIELDS = new Set<string>(["redRpPmf", "blueRpPmf", "redBonusRp", "blueBonusRp", "redBonusRpPmf", "blueBonusRpPmf"]);

interface DigestSliceFixture {
  sliceSeason: number;
  matches: MatchResult[];
}

function sameNumbers(a: readonly number[] | undefined, b: readonly number[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

function digestRows(
  algorithm: AlgorithmModule<unknown>,
  stream: readonly MatchResult[],
  ruleModule: RpRuleModule,
  arms: { rpMeanShift?: boolean } | undefined
): { rows: Prediction[]; layer: SigmaScoutLayer } {
  const teams = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
  const talentAfterMatch = new Map<string, Map<string, number>>();
  const records = new WalkForwardSimulator([...stream]).runAll([algorithm], teams, undefined, (match, algorithmId, state) => {
    if (!usesSigmaScore(algorithmId)) return;
    const involved = [...match.redTeams, ...match.blueTeams];
    const metrics = algorithm.teamMetrics(state, involved);
    const talent = new Map<string, number>();
    for (const teamKey of involved) {
      const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
      if (total !== undefined) talent.set(teamKey, total);
    }
    talentAfterMatch.set(match.matchKey, talent);
  });
  const layer = arms === undefined ? new SigmaScoutLayer(ruleModule, algorithm.id) : new SigmaScoutLayer(ruleModule, algorithm.id, arms);
  const rows: Prediction[] = [];
  for (const record of records) {
    rows.push(layer.foldPlayed(record.match, record.prediction, talentAfterMatch.get(record.match.matchKey)).prediction);
  }
  const finalState = records.finalStates.get(algorithm.id);
  for (const match of stream) {
    const upcoming = toLeakProofUpcoming(match);
    rows.push(layer.enrichUpcoming(upcoming, algorithm.predict(finalState, upcoming)).prediction);
  }
  return { rows, layer };
}

describe("mean-shift arm: inert when absent (260914-01x, SD-05)", () => {
  const fixture = JSON.parse(readFileSync(DIGEST_SLICE_FIXTURE_PATH, "utf8")) as DigestSliceFixture;
  const spr = resolvePublishAlgorithms(undefined).find((a) => a.id === "spr") as AlgorithmModule<unknown>;
  const ruleModule = RP_RULE_MODULES[fixture.sliceSeason]!;

  it("no third argument and {} produce bitwise-equal RP fields on every played and upcoming row", () => {
    const absent = digestRows(spr, fixture.matches, ruleModule, undefined);
    const empty = digestRows(spr, fixture.matches, ruleModule, {});
    expect(absent.rows.length).toBe(empty.rows.length);
    expect(absent.rows.filter((p) => p.redRpPmf !== undefined).length).toBeGreaterThan(0);
    for (let i = 0; i < absent.rows.length; i++) {
      for (const field of RP_FIELDS) {
        expect(sameNumbers(absent.rows[i]![field], empty.rows[i]![field]), `row ${i} ${field}`).toBe(true);
      }
      expect(JSON.stringify(empty.rows[i])).toBe(JSON.stringify(absent.rows[i]));
    }
    expect(absent.layer.rpMeanShiftState()).toBeUndefined();
    expect(empty.layer.rpMeanShiftState()).toBeUndefined();
    expect(new SigmaScoutLayer(ruleModule, "spr", { rpMeanShift: false }).rpMeanShiftState()).toBeUndefined();
  });

  it("holds no accumulator for an algorithm that publishes no ranking points, or a season with no rules", () => {
    expect(new SigmaScoutLayer(ruleModule, "opr", { rpMeanShift: true }).rpMeanShiftState()).toBeUndefined();
    expect(new SigmaScoutLayer(undefined, "spr", { rpMeanShift: true }).rpMeanShiftState()).toBeUndefined();
    expect(new SigmaScoutLayer(ruleModule, "spr", { rpMeanShift: true }).rpMeanShiftState()?.season).toBe(ruleModule.season);
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

describe("mean-shift arm on a synthetic 2020 season (260914-01x, SD-03, CD-04)", () => {
  const stream = syntheticSeason();
  expect(stream.filter((m) => m.compLevel === "qm").length).toBeGreaterThanOrEqual(120);

  interface Step {
    readonly match: MatchResult;
    readonly control: PredictionRecord;
    readonly arm: PredictionRecord;
    readonly countBefore: number;
    readonly sumBefore: number;
    readonly redWarm: boolean;
    readonly blueWarm: boolean;
    readonly expectedRed: readonly number[] | undefined;
    readonly expectedBlue: readonly number[] | undefined;
  }

  const control = new SigmaScoutLayer(rp2020, "spr");
  const armLayer = new SigmaScoutLayer(rp2020, "spr", { rpMeanShift: true });
  // The test's OWN walk-forward reference: beliefs, residual count and sum.
  const reference = new RpMomentsAccumulator(rp2020);
  let refCount = 0;
  let refSum = 0;
  const steps: Step[] = [];
  const stateMismatches: string[] = [];

  for (const match of stream) {
    const prediction = syntheticPrediction();
    const state = armLayer.rpMeanShiftState()!.variables.endgamePoints!;
    if (state.count !== refCount || state.sum !== refSum) {
      stateMismatches.push(`${match.matchKey}: layer ${state.count}/${state.sum} vs reference ${refCount}/${refSum}`);
    }
    const redWarm = match.redTeams.every((t) => reference.hasHistory(t));
    const blueWarm = match.blueTeams.every((t) => reference.hasHistory(t));
    const redMoments = reference.momentsFor(match.redTeams, 0, 0);
    const blueMoments = reference.momentsFor(match.blueTeams, 0, 0);
    const shiftBy = refCount >= 200 ? refSum / refCount : undefined;
    const shifted = (moments: typeof redMoments, warm: boolean) =>
      shiftBy !== undefined && warm && match.compLevel === "qm"
        ? allianceBonusRpPmf({ ...moments, meanVector: [moments.meanVector[0]! + shiftBy] }, rp2020, match.eventType).bonusProbabilities
        : undefined;

    steps.push({
      match,
      control: control.foldPlayed(match, prediction),
      arm: armLayer.foldPlayed(match, prediction),
      countBefore: refCount,
      sumBefore: refSum,
      redWarm,
      blueWarm,
      expectedRed: shifted(redMoments, redWarm),
      expectedBlue: shifted(blueMoments, blueWarm),
    });

    // Reference update: the probe's population, observed before the fold.
    if (match.compLevel === "qm") {
      const raw = JSON.parse(match.scoreBreakdownRaw!) as { red: { endgamePoints: number }; blue: { endgamePoints: number } };
      if (redWarm) {
        refCount += 1;
        refSum += raw.red.endgamePoints - redMoments.meanVector[0]!;
      }
      if (blueWarm) {
        refCount += 1;
        refSum += raw.blue.endgamePoints - blueMoments.meanVector[0]!;
      }
    }
    const raw = JSON.parse(match.scoreBreakdownRaw!) as { red: { endgamePoints: number }; blue: { endgamePoints: number } };
    reference.fold(match.redTeams, { endgamePoints: raw.red.endgamePoints });
    reference.fold(match.blueTeams, { endgamePoints: raw.blue.endgamePoints });
  }

  it("the shift priced into match k equals the mean of residuals from matches strictly before k", () => {
    expect(stateMismatches).toEqual([]);
    const shiftedSteps = steps.filter((s) => s.expectedRed !== undefined);
    expect(shiftedSteps.length).toBeGreaterThan(20);
    for (const s of steps) {
      if (s.expectedRed !== undefined) expect(s.arm.prediction.redBonusRp, s.match.matchKey).toEqual(s.expectedRed);
      if (s.expectedBlue !== undefined) expect(s.arm.prediction.blueBonusRp, s.match.matchKey).toEqual(s.expectedBlue);
    }
    // Residuals on a rising series are positive on balance.
    const last = steps[steps.length - 1]!;
    expect(last.sumBefore / last.countBefore).toBeGreaterThan(0);
  });

  it("no row differs from control before the warmup", () => {
    const early = steps.filter((s) => s.countBefore < 200);
    expect(early.length).toBeGreaterThan(50);
    for (const s of early) expect(JSON.stringify(s.arm), s.match.matchKey).toBe(JSON.stringify(s.control));
  });

  it("after warmup, bonus odds are at least control's on every fully-warm row and strictly greater on some", () => {
    const late = steps.filter((s) => s.countBefore >= 200 && s.match.compLevel === "qm");
    expect(late.length).toBeGreaterThan(20);
    let strictlyGreater = 0;
    for (const s of late) {
      expect(s.redWarm && s.blueWarm, s.match.matchKey).toBe(true);
      for (const side of ["redBonusRp", "blueBonusRp"] as const) {
        const a = s.arm.prediction[side]!;
        const c = s.control.prediction[side]!;
        expect(a[0]! >= c[0]!, `${s.match.matchKey} ${side}`).toBe(true);
        if (a[0]! > c[0]!) strictlyGreater++;
      }
    }
    expect(strictlyGreater).toBeGreaterThan(0);
  });

  it("the outcome half and every non-RP field are === control's on every row", () => {
    for (const s of steps) {
      expect(s.arm.match).toBe(s.control.match);
      expect(JSON.stringify(s.arm.matchBand)).toBe(JSON.stringify(s.control.matchBand));
      const a = s.arm.prediction as unknown as Record<string, unknown>;
      const c = s.control.prediction as unknown as Record<string, unknown>;
      expect(Object.keys(a).sort()).toEqual(Object.keys(c).sort());
      for (const key of Object.keys(c)) {
        if (BONUS_FIELDS.has(key)) continue;
        const cv = c[key];
        const av = a[key];
        if (Array.isArray(cv)) expect(sameNumbers(av as number[], cv as number[]), `${s.match.matchKey} ${key}`).toBe(true);
        else expect(av === cv, `${s.match.matchKey} ${key}`).toBe(true);
      }
    }
  });
});
