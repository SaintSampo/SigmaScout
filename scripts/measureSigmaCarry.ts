/**
 * THE PART 2 INSTRUMENT for the Sigma-carry CANDIDATE (`packages/harness/sigmaCarry.ts`): gates G2, G3
 * and G4 of the acceptance bar pre-registered in `.planning/debug/presim-bake-rp-filler-refuses.md`
 * ("Pre-registered Acceptance Bar (Decision 1)"). Gate G1 (winner accuracy and Brier, exact equality) is
 * `scripts/captureCompareSlices.ts --sigma-carry`; gate G5 (district bake coverage) is
 * `scripts/publishDistricts.ts --sigma-carry`. This script prints its gate lines and writes them, with
 * every figure behind them, to `--out`.
 *
 * ONE REPLAY, TWO ARMS. Every season is replayed ONCE, the way `publishSeasons` replays it (SPR only,
 * offseason included, `seasonBoundaryFor` + `carrySeason` over the published gapped season list, the
 * corpus cold-start index, Sigma talent captured after each match). The same records fold two
 * `SigmaScoutLayer`s: the INCUMBENT (constructed exactly as the publisher constructs it) and the
 * CANDIDATE (the same, started from the previous season's `sigmaCarryOut()`). The arms therefore differ
 * only by the knob, and every figure for both goes through the same functions: `insideBands` from
 * `measureMatchBandCoverage.ts`, and `buildRpCalibrationRecord` (whose `buildTotalRpSummary` /
 * `rankedProbabilityScore` produce the published `rpCalibration` block) from `measureRpCalibration.ts`.
 * A paired comparison whose two arms saw different observation counts is VOID, never quietly scored.
 *
 * WHAT IS SCORED, official play only, in the counted seasons 2017-2020 and 2022-2026 (2016 is the
 * cold-start season: replayed, never counted, because the carry has nothing to carry there):
 *
 *   G2  the published Match Band on every played alliance side, gated as `measureMatchBandCoverage.ts`
 *       gates. Calibration error is |share inside 1 band - 0.683|; pass iff the candidate's is no larger.
 *   G3  ranking-point pmfs on every played qualification match (both arms always price a played row):
 *       pooled bonus Brier and pooled total-RP ranked probability score; pass iff neither is worse.
 *   G4  PRE-EVENT pricing, the upcoming path the district bake and the presim sidecar use. At each
 *       event's first played match, before either layer folds it, every one of the event's played
 *       qualification matches is priced as an upcoming match from the pre-event SPR state through
 *       `makeRankingPointFiller`, all-or-nothing per roster. The incumbent reads its layer's
 *       `sigmaScoreByTeam()`; the candidate reads its carried layer plus the rookie rule
 *       (`candidateRosterRatings`). G4-cover: the candidate may drop nothing the incumbent prices.
 *       G4a: on the matched set, neither metric may be worse. G4b: on the newly covered set, the
 *       candidate must beat a walk-forward season-to-date climatology on both metrics.
 *
 * Coverage counts are printed beside the accuracy figures, never inside them.
 *
 * SAFETY: no network module, no environment variable, the corpus opened read-only, nothing written
 * except `--out`. `.env` is never read.
 *
 * USAGE (repo root, ~10-20 minutes; run it detached with a log):
 *   npx tsx scripts/measureSigmaCarry.ts --out <path>.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import { TOTAL_METRIC_KEY, type AlgorithmModule, type MatchResult, type Prediction } from "../packages/core/algorithms/types.js";
import { isOfficialEventType } from "../packages/core/algorithms/eventTypes.js";
import { isFullyDemoAlliance } from "../packages/core/algorithms/demoTeams.js";
import { isFullyDqZeroScoreAlliance } from "../packages/core/algorithms/dq.js";
import { RP_RULE_MODULES } from "../packages/core/rankingPoints/rules.js";
import { isBonusRpCompLevel, isRpEligibleEventType, type RpRuleModule } from "../packages/core/rankingPoints/constants.js";
import { RpMeanShiftAccumulator } from "../packages/core/rankingPoints/meanShift.js";
import { corpusColdStartIndex } from "../packages/harness/corpusColdStart.js";
import { actualBonusFlagsForSeason, makeRankingPointFiller, resolvePublishAlgorithms, toIntegerRpOrNull } from "../packages/harness/publish.js";
import { buildSeasonStream, toLeakProofUpcoming, WalkForwardSimulator } from "../packages/harness/replay.js";
import { seasonBoundaryFor } from "../packages/harness/seasonBoundary.js";
import { candidateRosterRatings, candidateSigmaMap, type SigmaSeasonCarry } from "../packages/harness/sigmaCarry.js";
import { SigmaScoutLayer } from "../packages/harness/sigmaScoutLayer.js";
import { usesSigmaScore } from "../packages/harness/sigmaScore.js";
import { CAPTURE_SEASONS } from "./captureCompareSlices.js";
import { coldestBucket, COLDEST_BUCKETS, insideBands, type ColdestBucket } from "./measureMatchBandCoverage.js";
import {
  buildRpCalibrationRecord,
  type MatchOutcomeObservation,
  type Observation,
  type TotalRpObservation,
} from "./measureRpCalibration.js";

const CORPUS_PATH = "data/corpus.sqlite";

/** The replayed seasons: the published gapped list, exactly as `captureCompareSlices` and `publish:seasons` replay it. */
export const SIGMA_CARRY_REPLAY_SEASONS: readonly number[] = CAPTURE_SEASONS;
/** The counted seasons: every replayed season with a season before it to carry from. */
export const SIGMA_CARRY_COUNTED_SEASONS: readonly number[] = CAPTURE_SEASONS.slice(1);
/** The coverage a one-standard-deviation label implies; `measureMatchBandCoverage.ts`'s own figure. */
export const NOMINAL_1SIGMA_COVERAGE = 0.683;
/** The two season groups G4b's figures are also printed for, descriptively: rookieMean was chosen on 2016-2022. */
export const DESIGN_ERA_SEASONS: ReadonlySet<number> = new Set([2016, 2017, 2018, 2019, 2020, 2022]);

// ───────────────────────────── pure figures ─────────────────────────────

/** One arm's band tally: alliance rows, and how many landed inside one and two bands. */
export interface BandFigures {
  n: number;
  inside1: number;
  inside2: number;
}

export function emptyBand(): BandFigures {
  return { n: 0, inside1: 0, inside2: 0 };
}

/** |share inside one band - 0.683|, or NaN for an empty tally. */
export function bandCalibrationError(band: BandFigures): number {
  if (band.n === 0) return Number.NaN;
  return Math.abs(band.inside1 / band.n - NOMINAL_1SIGMA_COVERAGE);
}

/** One arm's ranking-point figures over one observation set, as the published scorer computes them. */
export interface RpFigures {
  readonly bonusCount: number;
  /** Pooled mean of (p - actual)^2 over every (side, bonus) observation. */
  readonly bonusBrier: number;
  readonly totalRpCount: number;
  readonly totalRpRps: number;
  readonly outcomeCount: number;
  readonly outcomeBrier: number;
}

export const EMPTY_RP_FIGURES: RpFigures = {
  bonusCount: 0,
  bonusBrier: Number.NaN,
  totalRpCount: 0,
  totalRpRps: Number.NaN,
  outcomeCount: 0,
  outcomeBrier: Number.NaN,
};

/**
 * The figures `buildRpCalibrationRecord` (the published `rpCalibration` builder) gives one observation
 * set. The pooled bonus Brier is the count-weighted mean of its per-bonus Brier, which is the mean over
 * every observation.
 */
export function rpFiguresOf(
  bonusNames: readonly string[],
  perBonus: readonly (readonly Observation[])[],
  totalRp: readonly TotalRpObservation[],
  outcome: readonly MatchOutcomeObservation[]
): RpFigures {
  const record = buildRpCalibrationRecord(bonusNames, perBonus, { totalRp, outcome });
  let bonusCount = 0;
  let bonusSum = 0;
  for (const bonus of record.bonuses) {
    bonusCount += bonus.count;
    bonusSum += bonus.count * bonus.brierScore;
  }
  return {
    bonusCount,
    bonusBrier: bonusCount > 0 ? bonusSum / bonusCount : Number.NaN,
    totalRpCount: record.totalRp?.count ?? 0,
    totalRpRps: record.totalRp?.rankedProbabilityScore ?? Number.NaN,
    outcomeCount: record.outcome?.count ?? 0,
    outcomeBrier: record.outcome?.brierScore ?? Number.NaN,
  };
}

/** Count-weighted pooling across seasons; an empty part contributes nothing. */
export function poolRpFigures(parts: readonly RpFigures[]): RpFigures {
  const pool = (count: (f: RpFigures) => number, value: (f: RpFigures) => number): [number, number] => {
    let n = 0;
    let sum = 0;
    for (const part of parts) {
      const c = count(part);
      if (c === 0) continue;
      n += c;
      sum += c * value(part);
    }
    return [n, n > 0 ? sum / n : Number.NaN];
  };
  const [bonusCount, bonusBrier] = pool((f) => f.bonusCount, (f) => f.bonusBrier);
  const [totalRpCount, totalRpRps] = pool((f) => f.totalRpCount, (f) => f.totalRpRps);
  const [outcomeCount, outcomeBrier] = pool((f) => f.outcomeCount, (f) => f.outcomeBrier);
  return { bonusCount, bonusBrier, totalRpCount, totalRpRps, outcomeCount, outcomeBrier };
}

export function poolBand(parts: readonly BandFigures[]): BandFigures {
  const out = emptyBand();
  for (const part of parts) {
    out.n += part.n;
    out.inside1 += part.inside1;
    out.inside2 += part.inside2;
  }
  return out;
}

/** The G4b reference's bonus probability: Jeffreys-smoothed season-to-date frequency, `(k + 0.5) / (n + 1)`. */
export function climatologyBonusProbability(earned: number, sides: number): number {
  return (earned + 0.5) / (sides + 1);
}

/** The G4b reference's total-RP pmf over `0..maxRp`: `(c_k + 1/(maxRp + 1)) / (n + 1)`, uniform at n = 0. */
export function climatologyRpPmf(counts: readonly number[], sides: number, maxRp: number): number[] {
  if (counts.length !== maxRp + 1) throw new Error(`climatologyRpPmf: ${counts.length} counts for maxRp ${maxRp}`);
  const pseudo = 1 / (maxRp + 1);
  return counts.map((c) => (c + pseudo) / (sides + 1));
}

// ───────────────────────────── the verdict ─────────────────────────────

export type GateStatus = "PASS" | "FAIL" | "VOID";

export interface GateVerdict {
  readonly gate: "G2" | "G3" | "G4-cover" | "G4a" | "G4b";
  readonly status: GateStatus;
  readonly detail: string;
}

export interface PooledSigmaCarry {
  readonly band: { readonly incumbent: BandFigures; readonly candidate: BandFigures };
  readonly played: { readonly incumbent: RpFigures; readonly candidate: RpFigures };
  readonly matched: { readonly incumbent: RpFigures; readonly candidate: RpFigures };
  readonly fresh: { readonly candidate: RpFigures; readonly reference: RpFigures };
  readonly coverage: { readonly incumbent: number; readonly candidate: number; readonly newlyCovered: number; readonly dropped: number };
}

const fmt = (x: number): string => (Number.isFinite(x) ? x.toFixed(6) : "n/a");

/** Pass iff candidate <= incumbent on both metrics; VOID when the arms' counts differ or nothing was scored. */
function notWorse(gate: "G3" | "G4a", incumbent: RpFigures, candidate: RpFigures): GateVerdict {
  const counts = `bonus n=${incumbent.bonusCount}/${candidate.bonusCount}, total-RP n=${incumbent.totalRpCount}/${candidate.totalRpCount}`;
  if (incumbent.bonusCount !== candidate.bonusCount || incumbent.totalRpCount !== candidate.totalRpCount) {
    return { gate, status: "VOID", detail: `the arms scored different observation sets (${counts})` };
  }
  if (incumbent.bonusCount === 0 || incumbent.totalRpCount === 0) return { gate, status: "VOID", detail: `nothing scored (${counts})` };
  const pass = candidate.bonusBrier <= incumbent.bonusBrier && candidate.totalRpRps <= incumbent.totalRpRps;
  return {
    gate,
    status: pass ? "PASS" : "FAIL",
    detail: `bonus Brier incumbent ${fmt(incumbent.bonusBrier)} candidate ${fmt(candidate.bonusBrier)}; total-RP RPS incumbent ${fmt(incumbent.totalRpRps)} candidate ${fmt(candidate.totalRpRps)} (${counts})`,
  };
}

/** The mechanical G2-G4 verdicts, exactly as pre-registered. */
export function judgeSigmaCarryBar(pooled: PooledSigmaCarry): { gates: GateVerdict[]; overall: GateStatus } {
  const gates: GateVerdict[] = [];

  const { incumbent: bandInc, candidate: bandCand } = pooled.band;
  if (bandInc.n !== bandCand.n) {
    gates.push({ gate: "G2", status: "VOID", detail: `the arms scored different row counts (${bandInc.n}/${bandCand.n})` });
  } else if (bandInc.n === 0) {
    gates.push({ gate: "G2", status: "VOID", detail: "no rows scored" });
  } else {
    const errInc = bandCalibrationError(bandInc);
    const errCand = bandCalibrationError(bandCand);
    gates.push({
      gate: "G2",
      status: errCand <= errInc ? "PASS" : "FAIL",
      detail: `inside 1 band incumbent ${fmt(bandInc.inside1 / bandInc.n)} (error ${fmt(errInc)}) candidate ${fmt(bandCand.inside1 / bandCand.n)} (error ${fmt(errCand)}), n=${bandInc.n}`,
    });
  }

  gates.push(notWorse("G3", pooled.played.incumbent, pooled.played.candidate));

  gates.push({
    gate: "G4-cover",
    status: pooled.coverage.dropped === 0 ? "PASS" : "FAIL",
    detail: `incumbent priced ${pooled.coverage.incumbent}, candidate ${pooled.coverage.candidate}, newly covered ${pooled.coverage.newlyCovered}, dropped ${pooled.coverage.dropped}`,
  });

  gates.push(notWorse("G4a", pooled.matched.incumbent, pooled.matched.candidate));

  const { candidate: fresh, reference } = pooled.fresh;
  const freshCounts = `bonus n=${fresh.bonusCount}/${reference.bonusCount}, total-RP n=${fresh.totalRpCount}/${reference.totalRpCount}`;
  if (fresh.bonusCount !== reference.bonusCount || fresh.totalRpCount !== reference.totalRpCount) {
    gates.push({ gate: "G4b", status: "VOID", detail: `candidate and reference scored different observation sets (${freshCounts})` });
  } else if (fresh.bonusCount === 0 || fresh.totalRpCount === 0) {
    gates.push({ gate: "G4b", status: "VOID", detail: `nothing newly covered was scored (${freshCounts})` });
  } else {
    const pass = fresh.bonusBrier < reference.bonusBrier && fresh.totalRpRps < reference.totalRpRps;
    gates.push({
      gate: "G4b",
      status: pass ? "PASS" : "FAIL",
      detail: `bonus Brier candidate ${fmt(fresh.bonusBrier)} reference ${fmt(reference.bonusBrier)}; total-RP RPS candidate ${fmt(fresh.totalRpRps)} reference ${fmt(reference.totalRpRps)} (${freshCounts})`,
    });
  }

  const overall: GateStatus = gates.some((g) => g.status === "FAIL") ? "FAIL" : gates.some((g) => g.status === "VOID") ? "VOID" : "PASS";
  return { gates, overall };
}

// ───────────────────────────── observation sets ─────────────────────────────

/** Paired RP observations for two forecasters over one population. */
class PairedRp {
  readonly a: { perBonus: Observation[][]; totalRp: TotalRpObservation[]; outcome: MatchOutcomeObservation[] };
  readonly b: { perBonus: Observation[][]; totalRp: TotalRpObservation[]; outcome: MatchOutcomeObservation[] };

  constructor(readonly bonusNames: readonly string[]) {
    this.a = { perBonus: bonusNames.map(() => []), totalRp: [], outcome: [] };
    this.b = { perBonus: bonusNames.map(() => []), totalRp: [], outcome: [] };
  }

  /**
   * One match, both forecasters, added only where BOTH carry the field, so the two sets are identical by
   * construction. `flags` is the match's actual per-bonus outcome, or null/undefined when not derivable.
   */
  add(match: MatchResult, a: Prediction, b: Prediction, flags: { red: readonly boolean[]; blue: readonly boolean[] } | null | undefined): void {
    if (a.redRpPmf !== undefined && a.blueRpPmf !== undefined && b.redRpPmf !== undefined && b.blueRpPmf !== undefined) {
      const red = toIntegerRpOrNull(match.redRpEarned);
      const blue = toIntegerRpOrNull(match.blueRpEarned);
      this.a.totalRp.push({ pmf: a.redRpPmf, actual: red }, { pmf: a.blueRpPmf, actual: blue });
      this.b.totalRp.push({ pmf: b.redRpPmf, actual: red }, { pmf: b.blueRpPmf, actual: blue });
    }
    if (a.matchOutcomePmf !== undefined && b.matchOutcomePmf !== undefined) {
      this.a.outcome.push({ pmf3: a.matchOutcomePmf, winner: match.winner });
      this.b.outcome.push({ pmf3: b.matchOutcomePmf, winner: match.winner });
    }
    if (flags === null || flags === undefined) return;
    for (const side of ["red", "blue"] as const) {
      const actual = flags[side];
      const pa = side === "red" ? a.redBonusRp : a.blueBonusRp;
      const pb = side === "red" ? b.redBonusRp : b.blueBonusRp;
      if (pa === undefined || pb === undefined || pa.length !== actual.length || pb.length !== actual.length) continue;
      for (let i = 0; i < actual.length; i++) {
        this.a.perBonus[i]?.push({ predicted: pa[i]!, actual: actual[i]! });
        this.b.perBonus[i]?.push({ predicted: pb[i]!, actual: actual[i]! });
      }
    }
  }

  figures(): { a: RpFigures; b: RpFigures } {
    return {
      a: rpFiguresOf(this.bonusNames, this.a.perBonus, this.a.totalRp, this.a.outcome),
      b: rpFiguresOf(this.bonusNames, this.b.perBonus, this.b.totalRp, this.b.outcome),
    };
  }
}

/** Walk-forward season-to-date climatology over official qualification alliance sides, for G4b. */
class Climatology {
  #sides = 0;
  readonly #earned: number[];
  #rpSides = 0;
  readonly #rpCounts: number[];

  constructor(readonly ruleModule: RpRuleModule) {
    this.#earned = ruleModule.bonusNames.map(() => 0);
    this.#rpCounts = Array.from({ length: ruleModule.maxRp + 1 }, () => 0);
  }

  /** The reference forecast at this instant, in `Prediction`'s RP fields. */
  forecast(): Pick<Prediction, "redRpPmf" | "blueRpPmf" | "redBonusRp" | "blueBonusRp"> {
    const bonus = this.#earned.map((k) => climatologyBonusProbability(k, this.#sides));
    const pmf = climatologyRpPmf(this.#rpCounts, this.#rpSides, this.ruleModule.maxRp);
    return { redRpPmf: pmf, blueRpPmf: [...pmf], redBonusRp: bonus, blueBonusRp: [...bonus] };
  }

  /** Folds one played match's two sides in; call only AFTER any forecast this match must not see. */
  observe(match: MatchResult, flags: { red: readonly boolean[]; blue: readonly boolean[] } | null | undefined): void {
    if (flags !== null && flags !== undefined) {
      for (const side of [flags.red, flags.blue]) {
        if (side.length !== this.#earned.length) continue;
        this.#sides++;
        side.forEach((earned, i) => {
          if (earned) this.#earned[i]!++;
        });
      }
    }
    for (const rp of [toIntegerRpOrNull(match.redRpEarned), toIntegerRpOrNull(match.blueRpEarned)]) {
      if (rp === null || rp < 0 || rp > this.ruleModule.maxRp) continue;
      this.#rpSides++;
      this.#rpCounts[rp]!++;
    }
  }
}

// ───────────────────────────── the measurement ─────────────────────────────

export interface SeasonFigures {
  readonly season: number;
  readonly band: { incumbent: BandFigures; candidate: BandFigures; byBucket: Record<ColdestBucket, { incumbent: BandFigures; candidate: BandFigures }>; noBandRows: number };
  readonly played: { incumbent: RpFigures; candidate: RpFigures };
  readonly matched: { incumbent: RpFigures; candidate: RpFigures };
  readonly fresh: { candidate: RpFigures; reference: RpFigures; ceiling: RpFigures };
  readonly coverage: { eventsPriced: number; incumbent: number; candidate: number; newlyCovered: number; dropped: number };
}

export interface MeasureSigmaCarryOptions {
  /** Replayed seasons, ascending: season boundaries follow this list, as `publishSeasons`'s do. */
  readonly seasons: readonly number[];
  readonly counted: ReadonlySet<number>;
  readonly algorithm: AlgorithmModule<any>;
  readonly streamFor: (season: number) => MatchResult[];
  readonly coldStartIndex?: ReadonlySet<string>;
  /** Progress lines; defaults to silence. */
  readonly log?: (line: string) => void;
}

/** Replays every season once and scores both arms. Seasons are processed one at a time, so only one season's stream is ever held. */
export function measureSigmaCarry(options: MeasureSigmaCarryOptions): SeasonFigures[] {
  const { algorithm } = options;
  if (!usesSigmaScore(algorithm.id)) throw new Error(`measureSigmaCarry: algorithm "${algorithm.id}" publishes no Sigma Score`);
  const log = options.log ?? (() => {});
  const out: SeasonFigures[] = [];
  let carriedState: unknown;
  let sigmaCarry: SigmaSeasonCarry | undefined;

  for (const [seasonIdx, season] of options.seasons.entries()) {
    const stream = options.streamFor(season);
    const boundary = seasonBoundaryFor(options.seasons, seasonIdx);
    const initialStates =
      !boundary.isColdStart && carriedState !== undefined && algorithm.carrySeason
        ? new Map<string, unknown>([[algorithm.id, algorithm.carrySeason(carriedState, boundary)]])
        : undefined;

    // Talent after each match, and the SPR state right before each event's first match (`publishSeasons`'s
    // `preEventStateByAlgoEvent` rule: the carried boundary state for the season's first event, none for
    // the cold-start season's first event).
    const talentAfterMatch = new Map<string, Map<string, number>>();
    const preEventState = new Map<string, unknown>();
    const seenEvents = new Set<string>();
    let hasLast = initialStates !== undefined;
    let lastState: unknown = initialStates?.get(algorithm.id);
    const onMatchComplete = (match: MatchResult, algorithmId: string, state: unknown): void => {
      if (algorithmId !== algorithm.id) return;
      if (!seenEvents.has(match.eventKey)) {
        seenEvents.add(match.eventKey);
        if (hasLast) preEventState.set(match.eventKey, lastState);
      }
      lastState = state;
      hasLast = true;
      const involved = [...match.redTeams, ...match.blueTeams];
      const metrics = algorithm.teamMetrics(state, involved);
      const talent = new Map<string, number>();
      for (const teamKey of involved) {
        const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
        if (total !== undefined) talent.set(teamKey, total);
      }
      talentAfterMatch.set(match.matchKey, talent);
    };

    const teams = [...new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
    const records = new WalkForwardSimulator(stream, options.coldStartIndex).runAll([algorithm], teams, initialStates, onMatchComplete);
    carriedState = records.carryStates.get(algorithm.id);

    const ruleModule = RP_RULE_MODULES[season];
    const counted = options.counted.has(season);
    const incumbent = new SigmaScoutLayer(ruleModule, algorithm.id);
    const candidate = new SigmaScoutLayer(ruleModule, algorithm.id, { sigmaCarry: { from: boundary.isColdStart ? undefined : sigmaCarry } });

    const bonusNames = ruleModule?.bonusNames ?? [];
    const flagsByMatch = actualBonusFlagsForSeason(stream, season);
    const played = new PairedRp(bonusNames);
    const matched = new PairedRp(bonusNames);
    const fresh = new PairedRp(bonusNames);
    const ceiling = new PairedRp(bonusNames);
    const climatology = ruleModule === undefined ? undefined : new Climatology(ruleModule);
    const band = { incumbent: emptyBand(), candidate: emptyBand() };
    const byBucket = Object.fromEntries(COLDEST_BUCKETS.map((b) => [b, { incumbent: emptyBand(), candidate: emptyBand() }])) as Record<
      ColdestBucket,
      { incumbent: BandFigures; candidate: BandFigures }
    >;
    let noBandRows = 0;
    const priorByTeam = new Map<string, number>();
    const coverage = { eventsPriced: 0, incumbent: 0, candidate: 0, newlyCovered: 0, dropped: 0 };
    const newlyCoveredKeys = new Set<string>();

    // Every event's pre-event pricing population: its played, official, RP-eligible qualification matches.
    const pricedQuals = (m: MatchResult): boolean =>
      isOfficialEventType(m.eventType) && isRpEligibleEventType(m.eventType) && isBonusRpCompLevel(m.compLevel);
    const qualsByEvent = new Map<string, MatchResult[]>();
    for (const m of stream) {
      if (!pricedQuals(m)) continue;
      const list = qualsByEvent.get(m.eventKey) ?? [];
      list.push(m);
      qualsByEvent.set(m.eventKey, list);
    }
    const pricedEvents = new Set<string>();

    for (const record of records) {
      const match = record.match;

      // ---- G4: pre-event pricing, before either layer folds the event's first match ----
      if (counted && ruleModule !== undefined && climatology !== undefined && !pricedEvents.has(match.eventKey)) {
        pricedEvents.add(match.eventKey);
        const quals = qualsByEvent.get(match.eventKey);
        if (quals !== undefined && preEventState.has(match.eventKey)) {
          coverage.eventsPriced++;
          const state = preEventState.get(match.eventKey);
          const roster = [...new Set(quals.flatMap((m) => [...m.redTeams, ...m.blueTeams]))].sort();
          const incumbentFiller = makeRankingPointFiller(
            incumbent.rpAccumulator,
            ruleModule,
            incumbent.sigmaScoreByTeam(),
            roster,
            RpMeanShiftAccumulator.fromState(ruleModule, incumbent.rpMeanShiftState())
          );
          const metrics = algorithm.teamMetrics(state, roster);
          const totalByTeam = new Map<string, number>();
          for (const teamKey of roster) {
            const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
            if (total !== undefined) totalByTeam.set(teamKey, total);
          }
          const ratings = candidateRosterRatings({
            roster,
            totalByTeam,
            unseenTotal: algorithm.unseenTeamMetrics?.(state)?.[TOTAL_METRIC_KEY]?.value,
            sigmaByTeam: candidate.sigmaScoreByTeam(),
            priorSigmaAtTalent: (talent) => candidate.sigmaPriorAtTalent(talent),
          });
          const candidateFiller = makeRankingPointFiller(
            candidate.rpAccumulator,
            ruleModule,
            candidateSigmaMap(ratings),
            roster,
            RpMeanShiftAccumulator.fromState(ruleModule, candidate.rpMeanShiftState())
          );
          const reference = climatology.forecast();
          for (const qual of quals) {
            const upcoming = toLeakProofUpcoming(qual);
            const prediction = algorithm.predict(state, upcoming);
            const incumbentPriced = incumbentFiller?.(upcoming, prediction);
            const candidatePriced = candidateFiller?.(upcoming, prediction);
            const byIncumbent = incumbentPriced?.redRpPmf !== undefined;
            const byCandidate = candidatePriced?.redRpPmf !== undefined;
            if (byIncumbent) coverage.incumbent++;
            if (byCandidate) coverage.candidate++;
            const flags = flagsByMatch.get(qual.matchKey);
            if (byCandidate && candidatePriced!.redRpPmf!.length !== ruleModule.maxRp + 1) {
              throw new Error(`measureSigmaCarry: ${qual.matchKey} priced a pmf of length ${candidatePriced!.redRpPmf!.length} against maxRp ${ruleModule.maxRp}`);
            }
            if (byIncumbent && byCandidate) matched.add(qual, incumbentPriced!, candidatePriced!, flags);
            else if (byCandidate) {
              coverage.newlyCovered++;
              newlyCoveredKeys.add(qual.matchKey);
              fresh.add(qual, candidatePriced!, { ...prediction, ...reference }, flags);
            } else if (byIncumbent) coverage.dropped++;
          }
        }
      }

      // ---- fold both arms: predict before update, inside the layer ----
      const talent = talentAfterMatch.get(match.matchKey);
      const incumbentRecord = incumbent.foldPlayed(match, record.prediction, talent);
      const candidateRecord = candidate.foldPlayed(match, record.prediction, talent);

      const official = isOfficialEventType(match.eventType);
      if (counted && official) {
        // ---- G2: the published band, gated as measureMatchBandCoverage.ts gates ----
        const demoMatch = isFullyDemoAlliance(match.redTeams) || isFullyDemoAlliance(match.blueTeams);
        const sides = [
          { teams: match.redTeams, actual: match.redScore, dqs: match.redDqs, predicted: record.prediction.redScore, inc: incumbentRecord.matchBand?.red, cand: candidateRecord.matchBand?.red },
          { teams: match.blueTeams, actual: match.blueScore, dqs: match.blueDqs, predicted: record.prediction.blueScore, inc: incumbentRecord.matchBand?.blue, cand: candidateRecord.matchBand?.blue },
        ];
        for (const side of sides) {
          if (
            demoMatch ||
            side.teams.length === 0 ||
            isFullyDqZeroScoreAlliance(side.teams, side.dqs, side.actual) ||
            !Number.isFinite(side.actual) ||
            !Number.isFinite(side.predicted)
          ) {
            continue;
          }
          if (side.inc === undefined || side.cand === undefined) {
            noBandRows++;
          } else {
            const miss = side.actual - side.predicted;
            const bucket = coldestBucket(Math.min(...side.teams.map((t) => priorByTeam.get(t) ?? 0)));
            for (const [arm, variance] of [["incumbent", side.inc], ["candidate", side.cand]] as const) {
              const in1 = insideBands(miss, variance, 1) ? 1 : 0;
              const in2 = insideBands(miss, variance, 2) ? 1 : 0;
              band[arm].n++;
              band[arm].inside1 += in1;
              band[arm].inside2 += in2;
              byBucket[bucket][arm].n++;
              byBucket[bucket][arm].inside1 += in1;
              byBucket[bucket][arm].inside2 += in2;
            }
          }
          for (const t of side.teams) priorByTeam.set(t, (priorByTeam.get(t) ?? 0) + 1);
        }

        // ---- G3: played-row ranking points; plus the ceiling for newly covered matches ----
        if (isBonusRpCompLevel(match.compLevel)) {
          const flags = flagsByMatch.get(match.matchKey);
          played.add(match, incumbentRecord.prediction, candidateRecord.prediction, flags);
          if (newlyCoveredKeys.has(match.matchKey)) ceiling.add(match, candidateRecord.prediction, candidateRecord.prediction, flags);
        }
      }

      // The climatology sees a match only after anything priced before it.
      if (climatology !== undefined && pricedQuals(match)) climatology.observe(match, flagsByMatch.get(match.matchKey));
    }

    sigmaCarry = candidate.sigmaCarryOut();

    if (counted) {
      const playedFigures = played.figures();
      const matchedFigures = matched.figures();
      const freshFigures = fresh.figures();
      out.push({
        season,
        band: { ...band, byBucket, noBandRows },
        played: { incumbent: playedFigures.a, candidate: playedFigures.b },
        matched: { incumbent: matchedFigures.a, candidate: matchedFigures.b },
        fresh: { candidate: freshFigures.a, reference: freshFigures.b, ceiling: ceiling.figures().a },
        coverage,
      });
      log(
        `measureSigmaCarry: ${season} — ${records.length} matches replayed; band rows ${band.incumbent.n}; played RP sides ${playedFigures.a.totalRpCount}; pre-event: ${coverage.eventsPriced} events, incumbent ${coverage.incumbent}, candidate ${coverage.candidate}, newly covered ${coverage.newlyCovered}, dropped ${coverage.dropped}`
      );
    } else {
      log(`measureSigmaCarry: ${season} — ${records.length} matches replayed (${boundary.isColdStart ? "cold start" : "carried in"}), not counted`);
    }
  }
  return out;
}

/** The pooled figures the gates read, over the given seasons. */
export function poolSeasons(seasons: readonly SeasonFigures[]): PooledSigmaCarry {
  return {
    band: { incumbent: poolBand(seasons.map((s) => s.band.incumbent)), candidate: poolBand(seasons.map((s) => s.band.candidate)) },
    played: { incumbent: poolRpFigures(seasons.map((s) => s.played.incumbent)), candidate: poolRpFigures(seasons.map((s) => s.played.candidate)) },
    matched: { incumbent: poolRpFigures(seasons.map((s) => s.matched.incumbent)), candidate: poolRpFigures(seasons.map((s) => s.matched.candidate)) },
    fresh: { candidate: poolRpFigures(seasons.map((s) => s.fresh.candidate)), reference: poolRpFigures(seasons.map((s) => s.fresh.reference)) },
    coverage: {
      incumbent: seasons.reduce((n, s) => n + s.coverage.incumbent, 0),
      candidate: seasons.reduce((n, s) => n + s.coverage.candidate, 0),
      newlyCovered: seasons.reduce((n, s) => n + s.coverage.newlyCovered, 0),
      dropped: seasons.reduce((n, s) => n + s.coverage.dropped, 0),
    },
  };
}

/** JSON-safe: NaN becomes null. */
function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? null : v)));
}

async function main(argv: readonly string[]): Promise<void> {
  const { values } = parseArgs({ args: [...argv], options: { out: { type: "string" } } });
  if (values.out === undefined) throw new Error("measureSigmaCarry: --out <path>.json is required");
  const [algorithm] = resolvePublishAlgorithms("spr");
  if (algorithm === undefined) throw new Error("measureSigmaCarry: spr did not resolve");
  const startedAt = new Date().toISOString();
  console.log(`measureSigmaCarry: ${algorithm.id}@${algorithm.version}; replay ${SIGMA_CARRY_REPLAY_SEASONS.join(", ")}; counted ${SIGMA_CARRY_COUNTED_SEASONS.join(", ")}`);

  const db = openCorpusReadOnly(CORPUS_PATH);
  let seasons: SeasonFigures[];
  try {
    seasons = measureSigmaCarry({
      seasons: SIGMA_CARRY_REPLAY_SEASONS,
      counted: new Set(SIGMA_CARRY_COUNTED_SEASONS),
      algorithm,
      streamFor: (season) => buildSeasonStream(db, season, { includeOffseason: true }),
      coldStartIndex: corpusColdStartIndex(db),
      log: (line) => console.log(line),
    });
  } finally {
    db.close();
  }

  const pooled = poolSeasons(seasons);
  const verdict = judgeSigmaCarryBar(pooled);
  const designEra = poolSeasons(seasons.filter((s) => DESIGN_ERA_SEASONS.has(s.season)));
  const later = poolSeasons(seasons.filter((s) => !DESIGN_ERA_SEASONS.has(s.season)));

  console.log("");
  for (const gate of verdict.gates) console.log(`GATE ${gate.gate} ${gate.status}: ${gate.detail}`);
  console.log(`GATES G2-G4 OVERALL: ${verdict.overall}`);
  console.log(
    `descriptive G4b split: 2017-2020+2022 candidate/reference bonus Brier ${fmt(designEra.fresh.candidate.bonusBrier)}/${fmt(designEra.fresh.reference.bonusBrier)}; 2023-2026 ${fmt(later.fresh.candidate.bonusBrier)}/${fmt(later.fresh.reference.bonusBrier)}`
  );

  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(
    values.out,
    `${JSON.stringify(
      jsonSafe({
        instrument: "scripts/measureSigmaCarry.ts",
        algorithm: `${algorithm.id}@${algorithm.version}`,
        startedAt,
        finishedAt: new Date().toISOString(),
        seasonsReplayed: SIGMA_CARRY_REPLAY_SEASONS,
        seasonsCounted: SIGMA_CARRY_COUNTED_SEASONS,
        verdicts: verdict,
        pooled,
        descriptive: { designEra2017to2022: designEra, later2023to2026: later },
        seasons,
      }),
      null,
      1
    )}\n`
  );
  console.log(`measureSigmaCarry: DONE, wrote ${values.out}`);
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main(process.argv.slice(2)).catch((err) => {
    console.error("measureSigmaCarry failed:", err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  });
}
