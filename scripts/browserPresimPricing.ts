/**
 * MEASUREMENT ONLY (quick task 260929-mkn). Not wired into the app or the
 * pipeline, and nothing imports it except `scripts/measureBrowserPresimPricing.ts`
 * and its own test.
 *
 * A browser-safe reimplementation of the pre-schedule ("Before schedule
 * release") simulation's PRICING path: the same per-event walk-forward SPR
 * state and the same ranking-point fill `packages/harness/publish.ts` runs
 * offline (`buildPreScheduleSidecarForEvent`'s predict closure, which is
 * `spr.predict` then `makeRankingPointFiller`), with an optional per-alliance
 * cache in front of the alliance-level work.
 *
 * BROWSER-SAFE BY CONSTRUCTION: imports only `packages/core/**`,
 * `packages/harness/generatedSchedules.ts`, `sigmaScore.ts` and `rounding.ts`.
 * Never a Node built-in, `preSchedule.ts` (it pulls zod), `publish.ts` or
 * `pageArtifacts.ts`. The driver bundles this file with esbuild
 * `platform: "browser"`, which is the gate.
 *
 * SEEDS ARE COPIED, not imported, from `packages/harness/preSchedule.ts`:
 *   - `fnv1a32`: lines 121-128
 *   - pairing structure k: `generate|numTeams|matchesPerTeam|k` (lines 228-233)
 *   - shuffle k: `eventKey|algorithmVersion|shuffle|k`, seeded Fisher-Yates (lines 250-260, 366-392)
 *   - baked draws k: `eventKey|algorithmVersion|baked|k` (lines 441-452)
 *   - synthetic `UpcomingMatch` and surrogate filtering: lines 267-320
 * Parity against `buildPreScheduleArtifact` is checked by the driver.
 *
 * NAMING: an "alliance-level" piece depends on one alliance's three teams only
 * and can be cached by the unordered triple; a "match-level" piece depends on
 * both alliances (or their win probability) and is recomputed per match.
 */
import { spr, type SprState, type SprTeamState } from "../packages/core/algorithms/spr.js";
import { DEMO_PSEUDO_TEAM_KEY } from "../packages/core/algorithms/demoTeams.js";
import type { UpcomingMatch } from "../packages/core/algorithms/types.js";
import { RpMomentsAccumulator, type RpPopulationState, type RpTeamBeliefs, type RpVariableBelief } from "../packages/core/rankingPoints/empiricalMoments.js";
import { RpMeanShiftAccumulator, rosterIsFullyWarm, type RpMeanShiftState } from "../packages/core/rankingPoints/meanShift.js";
import { rpRuleModuleForSeason } from "../packages/core/rankingPoints/rules.js";
import type { RpRuleModule } from "../packages/core/rankingPoints/constants.js";
import { allianceBonusRpPmf, analyticRpPmf, convolvePmf, matchOutcomeDistribution } from "../packages/core/rankingPoints/analyticPmf.js";
import { mulberry32, simulateRanks, type SimMatchInput, type SimTeamBaseline } from "../packages/core/algorithms/simulation/rankSimulation.js";
import { DEFAULT_RESTARTS, generateSchedule } from "../packages/harness/generatedSchedules.js";
import { allianceSigmaBandVariance } from "../packages/harness/sigmaScore.js";
import { roundPmf } from "../packages/harness/rounding.js";

/** DOM-free timer: Node and every browser expose `performance.now()`. */
declare const performance: { now(): number };

// ---------------------------------------------------------------------------
// The payload: the minimal per-event inputs the browser would need.
// ---------------------------------------------------------------------------

/** `[muL, pL, muS, pS]`, one roster team's SPR state. */
export type PresimSprTuple = [number, number, number, number];
/** `[weight, weightSquares, mean, m2]`, one team's belief about one threshold variable. */
export type PresimBeliefTuple = [number, number, number, number];

/** One roster team's slice of the pricing state, parallel to `PresimPricingPayload.roster`. */
export interface PresimTeamRecord {
  /** The SPR team state, or `null` when the state holds none (priced as a fresh team). */
  readonly s: PresimSprTuple | null;
  /** The rookie-rule Sigma the filler's all-or-nothing map carries, or `null` (the roster is then refused offline). */
  readonly g: number | null;
  /** One entry per `rp.variables`, `null` for a variable this team never folded; `null` overall when the team has no RP belief. */
  readonly b: (PresimBeliefTuple | null)[] | null;
}

/** Everything the browser needs to price one event's synthetic schedules. JSON-serializable. */
export interface PresimPricingPayload {
  readonly eventKey: string;
  readonly season: number;
  readonly eventType: number;
  readonly week: number | null;
  readonly algorithmVersion: string;
  readonly matchesPerTeam: number;
  /** Sorted; the index space for every histogram and every `teams` entry. */
  readonly roster: string[];
  readonly teams: PresimTeamRecord[];
  readonly spr: { readonly logTau: number; readonly scale: number; readonly demo: PresimSprTuple | null };
  readonly rp: {
    readonly variables: string[];
    readonly population: RpPopulationState | null;
    readonly meanShift: RpMeanShiftState | null;
  };
}

// ---------------------------------------------------------------------------
// Copied seed helpers (see the header for line references).
// ---------------------------------------------------------------------------

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function seededShuffle(count: number, rng: () => number): number[] {
  const slots = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = slots[i]!;
    slots[i] = slots[j]!;
    slots[j] = tmp;
  }
  return slots;
}

// ---------------------------------------------------------------------------
// The match-level combine, and the alliance cache key.
// ---------------------------------------------------------------------------

/** One alliance's cacheable pieces: everything `combineMatch` needs from it that does not depend on the opponent. */
export interface AlliancePiece {
  readonly scoreMean: number;
  readonly scoreVariance: number;
  readonly bonusPmf: readonly number[];
  readonly bonusProbabilities: readonly number[];
}

/** The unordered-triple key: the sorted team keys joined. All six orderings of one alliance share it. */
export function allianceKey(teams: readonly string[]): string {
  return [...teams].sort().join("|");
}

function assertNormalizedPmf(pmf: readonly number[], season: number, label: string): void {
  let sum = 0;
  for (const p of pmf) {
    if (!Number.isFinite(p) || p < 0 || p > 1) {
      throw new Error(`combineMatch: season ${season} ${label} pmf has a non-finite or out-of-[0,1] entry (${p})`);
    }
    sum += p;
  }
  if (Math.abs(sum - 1) > 1e-9) throw new Error(`combineMatch: season ${season} ${label} pmf sums to ${sum}, expected 1 within 1e-9`);
}

/** The five-line outcome pmf, copied from analyticPmf.ts's private `allianceOutcomePmf`. */
function allianceOutcomePmf(winProb: number, tieProb: number, loseProb: number, winRp: number, tieRp: number): number[] {
  const pmf = new Array<number>(winRp + 1).fill(0);
  pmf[winRp]! += winProb;
  pmf[tieRp]! += tieProb;
  pmf[0]! += loseProb;
  return pmf;
}

/**
 * The MATCH-LEVEL half of `analyticRpPmf`: the win/tie/loss split, each
 * alliance's outcome pmf, the convolution with its cached bonus pmf, and the
 * same normalization and `maxRp + 1` length checks. Returns the UNROUNDED pmfs.
 */
export function combineMatch(
  red: AlliancePiece,
  blue: AlliancePiece,
  pRedWin: number,
  ruleModule: RpRuleModule
): { redPmf: number[]; bluePmf: number[] } {
  const outcome = matchOutcomeDistribution({
    redScoreMean: red.scoreMean,
    redScoreVariance: red.scoreVariance,
    blueScoreMean: blue.scoreMean,
    blueScoreVariance: blue.scoreVariance,
    winRp: ruleModule.winRp,
    tieRp: ruleModule.tieRp,
    pRedWin,
  });
  const redOutcomePmf = allianceOutcomePmf(outcome.pRedWin, outcome.pTie, outcome.pBlueWin, ruleModule.winRp, ruleModule.tieRp);
  const blueOutcomePmf = allianceOutcomePmf(outcome.pBlueWin, outcome.pTie, outcome.pRedWin, ruleModule.winRp, ruleModule.tieRp);
  const redPmf = convolvePmf(redOutcomePmf, red.bonusPmf);
  const bluePmf = convolvePmf(blueOutcomePmf, blue.bonusPmf);
  assertNormalizedPmf(redPmf, ruleModule.season, "red");
  assertNormalizedPmf(bluePmf, ruleModule.season, "blue");
  const expectedLength = ruleModule.maxRp + 1;
  if (redPmf.length !== expectedLength || bluePmf.length !== expectedLength) {
    throw new Error(`combineMatch: season ${ruleModule.season} pmf length mismatch, expected ${expectedLength}, got red=${redPmf.length} blue=${bluePmf.length}`);
  }
  return { redPmf, bluePmf };
}

// ---------------------------------------------------------------------------
// The pricer.
// ---------------------------------------------------------------------------

/** One priced match: the rounded pmfs `buildPricedSyntheticSchedules` publishes as `rp`/`bp`. */
export interface PricedMatch {
  readonly rp: number[];
  readonly bp: number[];
}

export interface PricingCounters {
  /** Matches priced. */
  calls: number;
  /** Alliance slots priced (two per match). */
  allianceSlots: number;
  /** Alliance-cache misses (cached arm only). */
  cacheMisses: number;
}

export interface PresimPricer {
  readonly payload: PresimPricingPayload;
  readonly ruleModule: RpRuleModule;
  readonly sprState: SprState;
  readonly counters: PricingCounters;
  /** The production composition: `spr.predict`, then `analyticRpPmf` on both alliances' moments. */
  priceUncached(match: UpcomingMatch): PricedMatch;
  /** `spr.predict` per match, alliance pieces from `cache` (filled on a miss), then `combineMatch`. */
  priceCached(match: UpcomingMatch, cache: Map<string, AlliancePiece>): PricedMatch;
  /** The alliance-level RP work for one alliance: band variance, moments, mean shift, bonus pmf. */
  buildPiece(teams: readonly string[], scoreMean: number): AlliancePiece;
  resetCounters(): void;
}

function decodeBelief(tuple: PresimBeliefTuple): RpVariableBelief {
  return { weight: tuple[0], weightSquares: tuple[1], mean: tuple[2], m2: tuple[3] };
}

/** Rebuilds the SPR state, the RP accumulator, the mean shift and the sigma map from the payload alone. */
export function buildPresimPricer(payload: PresimPricingPayload): PresimPricer {
  const ruleModule = rpRuleModuleForSeason(payload.season);

  const teams = new Map<string, SprTeamState>();
  const sigmaByTeam = new Map<string, number>();
  const beliefs = new Map<string, RpTeamBeliefs>();
  for (let i = 0; i < payload.roster.length; i++) {
    const teamKey = payload.roster[i]!;
    const record = payload.teams[i]!;
    if (record.s !== null) teams.set(teamKey, { muL: record.s[0], pL: record.s[1], muS: record.s[2], pS: record.s[3] });
    if (record.g !== null) sigmaByTeam.set(teamKey, record.g);
    if (record.b !== null) {
      const byVariable: Record<string, RpVariableBelief> = {};
      for (let v = 0; v < payload.rp.variables.length; v++) {
        const tuple = record.b[v];
        if (tuple !== null && tuple !== undefined) byVariable[payload.rp.variables[v]!] = decodeBelief(tuple);
      }
      beliefs.set(teamKey, byVariable);
    }
  }
  if (payload.spr.demo !== null) {
    const d = payload.spr.demo;
    teams.set(DEMO_PSEUDO_TEAM_KEY, { muL: d[0], pL: d[1], muS: d[2], pS: d[3] });
  }
  const sprState: SprState = { ...spr.initState([]), teams, logTau: payload.spr.logTau, scale: payload.spr.scale };

  // The RP cold-team prior is on in production, so always pass the third argument.
  const accumulator = RpMomentsAccumulator.fromBeliefs(ruleModule, beliefs, { population: payload.rp.population ?? undefined });
  const meanShift = RpMeanShiftAccumulator.fromState(ruleModule, payload.rp.meanShift ?? undefined);
  const eventType = payload.eventType;
  const counters: PricingCounters = { calls: 0, allianceSlots: 0, cacheMisses: 0 };

  function bandVarianceOf(alliance: readonly string[]): number {
    const v = allianceSigmaBandVariance(alliance, sigmaByTeam);
    if (v === undefined) throw new Error(`presim pricer: an alliance member has no Sigma in the payload (${alliance.join(",")})`);
    return v;
  }

  function buildPiece(alliance: readonly string[], scoreMean: number): AlliancePiece {
    const moments = accumulator.momentsFor(alliance, scoreMean, bandVarianceOf(alliance));
    const shifted = meanShift.apply(moments, rosterIsFullyWarm(accumulator, alliance));
    const bonus = allianceBonusRpPmf(shifted, ruleModule, eventType);
    return {
      scoreMean: shifted.scoreMean,
      scoreVariance: shifted.scoreVariance,
      bonusPmf: bonus.pmf,
      bonusProbabilities: bonus.bonusProbabilities,
    };
  }

  return {
    payload,
    ruleModule,
    sprState,
    counters,
    resetCounters() {
      counters.calls = 0;
      counters.allianceSlots = 0;
      counters.cacheMisses = 0;
    },
    buildPiece,
    priceUncached(match) {
      counters.calls += 1;
      counters.allianceSlots += 2;
      const prediction = spr.predict(sprState, match);
      const redMoments = accumulator.momentsFor(match.redTeams, prediction.redScore, bandVarianceOf(match.redTeams));
      const blueMoments = accumulator.momentsFor(match.blueTeams, prediction.blueScore, bandVarianceOf(match.blueTeams));
      const pmf = analyticRpPmf({
        red: meanShift.apply(redMoments, rosterIsFullyWarm(accumulator, match.redTeams)),
        blue: meanShift.apply(blueMoments, rosterIsFullyWarm(accumulator, match.blueTeams)),
        ruleModule,
        eventType: match.eventType,
        compLevel: match.compLevel,
        pRedWin: prediction.pRedWin,
      });
      return { rp: roundPmf(pmf.redPmf), bp: roundPmf(pmf.bluePmf) };
    },
    priceCached(match, cache) {
      counters.calls += 1;
      counters.allianceSlots += 2;
      const prediction = spr.predict(sprState, match);
      const redKey = allianceKey(match.redTeams);
      let red = cache.get(redKey);
      if (red === undefined) {
        counters.cacheMisses += 1;
        red = buildPiece(match.redTeams, prediction.redScore);
        cache.set(redKey, red);
      }
      const blueKey = allianceKey(match.blueTeams);
      let blue = cache.get(blueKey);
      if (blue === undefined) {
        counters.cacheMisses += 1;
        blue = buildPiece(match.blueTeams, prediction.blueScore);
        cache.set(blueKey, blue);
      }
      const combined = combineMatch(red, blue, prediction.pRedWin, ruleModule);
      return { rp: roundPmf(combined.redPmf), bp: roundPmf(combined.bluePmf) };
    },
  };
}

// ---------------------------------------------------------------------------
// Schedule preparation, pricing and drawing.
// ---------------------------------------------------------------------------

/** Schedule `k`'s synthetic matches: structure `k` with the roster shuffled onto its slots (preSchedule.ts 267-320, 366-392). */
export function prepareSchedule(payload: PresimPricingPayload, k: number): UpcomingMatch[] {
  const roster = payload.roster;
  const structure = generateSchedule(
    roster.length,
    payload.matchesPerTeam,
    mulberry32(fnv1a32(`generate|${roster.length}|${payload.matchesPerTeam}|${k}`)),
    DEFAULT_RESTARTS
  );
  const slots = seededShuffle(roster.length, mulberry32(fnv1a32(`${payload.eventKey}|${payload.algorithmVersion}|shuffle|${k}`)));
  return structure.map((structureMatch, matchIndex) => {
    const n = matchIndex + 1;
    const redTeams = structureMatch.red.map((slot) => roster[slots[slot]!]!);
    const blueTeams = structureMatch.blue.map((slot) => roster[slots[slot]!]!);
    return {
      matchKey: `${payload.eventKey}_presim${k}_qm${n}`,
      eventKey: payload.eventKey,
      compLevel: "qm",
      setNumber: 1,
      matchNumber: n,
      redTeams,
      blueTeams,
      redSurrogates: redTeams.filter((_, position) => structureMatch.redSurrogate[position] === true),
      blueSurrogates: blueTeams.filter((_, position) => structureMatch.blueSurrogate[position] === true),
      eventType: payload.eventType,
      week: payload.week,
    } satisfies UpcomingMatch;
  });
}

/** preSchedule.ts 267-280: a surrogate plays (so it is priced) but earns no credit, so it never reaches `simulateRanks`. */
function toSimMatchInput(upcoming: UpcomingMatch, rp: readonly number[], bp: readonly number[]): SimMatchInput {
  return {
    redTeamKeys: upcoming.redTeams.filter((teamKey) => !upcoming.redSurrogates.includes(teamKey)),
    blueTeamKeys: upcoming.blueTeams.filter((teamKey) => !upcoming.blueSurrogates.includes(teamKey)),
    redRpPmf: rp,
    blueRpPmf: bp,
  };
}

/** Prices one schedule's matches into `simulateRanks` inputs. */
export function priceSchedule(pricer: PresimPricer, matches: readonly UpcomingMatch[], cache: Map<string, AlliancePiece> | null): SimMatchInput[] {
  const inputs: SimMatchInput[] = [];
  for (const match of matches) {
    const priced = cache === null ? pricer.priceUncached(match) : pricer.priceCached(match, cache);
    inputs.push(toSimMatchInput(match, priced.rp, priced.bp));
  }
  return inputs;
}

export interface PresimCheckpoint {
  count: number;
  elapsedMs: number;
  generateMs: number;
  priceMs: number;
  drawMs: number;
}

export interface RunPresimOptions {
  readonly scheduleCount: number;
  /** Draws per schedule; 0 skips the draw phase entirely. */
  readonly drawsPerSchedule: number;
  /** Alliance-level cache on (a fresh cache for this run) or off. */
  readonly cache: boolean;
  readonly chunkSize?: number;
  readonly checkpoints?: readonly number[];
  readonly maxWallMs?: number;
  /** A pricer to reuse; built from the payload when absent. */
  readonly pricer?: PresimPricer;
}

export interface RunPresimResult {
  /** Roster-by-rank draw totals, in roster order; empty rows when `drawsPerSchedule` is 0. */
  totals: number[][];
  checkpoints: PresimCheckpoint[];
  counters: PricingCounters;
  uniqueAlliances: number;
  generateMs: number;
  priceMs: number;
  drawMs: number;
  elapsedMs: number;
  /** Schedules actually processed. */
  completed: number;
  stoppedEarly: boolean;
}

/**
 * Runs the whole pipeline in chunks: per chunk, generate the schedules, price
 * them, draw them, each phase timed once per chunk (never per call; Chromium's
 * timer is coarse outside cross-origin isolation). Records a checkpoint each
 * time the cumulative count reaches one of `checkpoints`, and stops once the
 * elapsed wall time passes `maxWallMs`.
 */
export function runPresim(payload: PresimPricingPayload, options: RunPresimOptions): RunPresimResult {
  const chunkSize = options.chunkSize ?? 50;
  const pricer = options.pricer ?? buildPresimPricer(payload);
  pricer.resetCounters();
  const cache = options.cache ? new Map<string, AlliancePiece>() : null;
  const roster = payload.roster;
  const baselines: SimTeamBaseline[] = roster.map((teamKey) => ({ teamKey, earnedRpSum: 0, matchesPlayed: 0 }));
  const totals: number[][] = roster.map(() => (options.drawsPerSchedule > 0 ? new Array<number>(roster.length).fill(0) : []));
  const pending = [...(options.checkpoints ?? [])].sort((a, b) => a - b);
  const checkpoints: PresimCheckpoint[] = [];

  let generateMs = 0;
  let priceMs = 0;
  let drawMs = 0;
  let completed = 0;
  let stoppedEarly = false;
  const start = performance.now();

  while (completed < options.scheduleCount) {
    const chunkEnd = Math.min(options.scheduleCount, completed + chunkSize);

    const g0 = performance.now();
    const prepared: UpcomingMatch[][] = [];
    for (let k = completed; k < chunkEnd; k++) prepared.push(prepareSchedule(payload, k));
    const g1 = performance.now();

    const priced: SimMatchInput[][] = [];
    for (const matches of prepared) priced.push(priceSchedule(pricer, matches, cache));
    const p1 = performance.now();

    if (options.drawsPerSchedule > 0) {
      for (let k = completed; k < chunkEnd; k++) {
        const bakedSeed = fnv1a32(`${payload.eventKey}|${payload.algorithmVersion}|baked|${k}`);
        const result = simulateRanks(priced[k - completed]!, baselines, options.drawsPerSchedule, mulberry32(bakedSeed));
        for (let teamIndex = 0; teamIndex < roster.length; teamIndex++) {
          const histogram = result.rankHistograms.get(roster[teamIndex]!)!;
          const teamTotals = totals[teamIndex]!;
          for (let rank = 0; rank < histogram.length; rank++) teamTotals[rank]! += histogram[rank]!;
        }
      }
    }
    const d1 = performance.now();

    generateMs += g1 - g0;
    priceMs += p1 - g1;
    drawMs += d1 - p1;
    completed = chunkEnd;

    const elapsedMs = d1 - start;
    while (pending.length > 0 && pending[0]! <= completed) {
      const count = pending.shift()!;
      // A checkpoint the chunk grid overshoots is recorded at the count actually reached.
      checkpoints.push({ count: count === completed ? count : completed, elapsedMs, generateMs, priceMs, drawMs });
    }
    if (options.maxWallMs !== undefined && elapsedMs > options.maxWallMs && completed < options.scheduleCount) {
      stoppedEarly = true;
      break;
    }
  }

  return {
    totals,
    checkpoints,
    counters: { ...pricer.counters },
    uniqueAlliances: cache === null ? 0 : cache.size,
    generateMs,
    priceMs,
    drawMs,
    elapsedMs: performance.now() - start,
    completed,
    stoppedEarly,
  };
}

// ---------------------------------------------------------------------------
// Price-only runs (P1) and the component micro-loops (Q1 factoring).
// ---------------------------------------------------------------------------

/** Generates schedules `0..count-1` once, so P1's six pricing runs share one generation cost. */
export function prepareSchedules(payload: PresimPricingPayload, count: number): { schedules: UpcomingMatch[][]; generateMs: number } {
  const t0 = performance.now();
  const schedules: UpcomingMatch[][] = [];
  for (let k = 0; k < count; k++) schedules.push(prepareSchedule(payload, k));
  return { schedules, generateMs: performance.now() - t0 };
}

export interface PriceOnlyResult {
  priceMs: number;
  counters: PricingCounters;
  uniqueAlliances: number;
}

/** Times pricing alone over prepared schedules, with a fresh cache when `cache` is on. */
export function priceOnly(pricer: PresimPricer, schedules: readonly (readonly UpcomingMatch[])[], cache: boolean): PriceOnlyResult {
  pricer.resetCounters();
  const alliances = cache ? new Map<string, AlliancePiece>() : null;
  let sink = 0;
  const t0 = performance.now();
  for (const matches of schedules) {
    const inputs = priceSchedule(pricer, matches, alliances);
    sink += inputs.length;
  }
  const priceMs = performance.now() - t0;
  if (sink < 0) throw new Error("unreachable"); // keeps the loop observable
  return { priceMs, counters: { ...pricer.counters }, uniqueAlliances: alliances === null ? 0 : alliances.size };
}

export interface CacheEffectResult {
  scheduleCount: number;
  generateMs: number;
  /** Per repetition, in run order: uncached then cached, interleaved U,C,U,C,U,C in the same process or page. */
  reps: { uncachedMs: number; cachedMs: number; ratio: number }[];
  calls: number;
  allianceSlots: number;
  uniqueAlliances: number;
  cacheMisses: number;
  uncachedUsPerCall: number[];
  cachedUsPerCall: number[];
  /** Median of the per-rep cached/uncached ratios, and their range. */
  medianRatio: number;
  minRatio: number;
  maxRatio: number;
}

/** P1: K schedules priced uncached and cached, interleaved, on one pricer and one set of prepared schedules. */
export function measureCacheEffect(payload: PresimPricingPayload, options: { scheduleCount: number; reps: number }): CacheEffectResult {
  const pricer = buildPresimPricer(payload);
  const { schedules, generateMs } = prepareSchedules(payload, options.scheduleCount);
  const reps: CacheEffectResult["reps"] = [];
  const uncachedUsPerCall: number[] = [];
  const cachedUsPerCall: number[] = [];
  let last: PriceOnlyResult | undefined;
  let lastUncached: PriceOnlyResult | undefined;
  for (let r = 0; r < options.reps; r++) {
    const u = priceOnly(pricer, schedules, false);
    const c = priceOnly(pricer, schedules, true);
    reps.push({ uncachedMs: u.priceMs, cachedMs: c.priceMs, ratio: c.priceMs / u.priceMs });
    uncachedUsPerCall.push((u.priceMs * 1000) / u.counters.calls);
    cachedUsPerCall.push((c.priceMs * 1000) / c.counters.calls);
    last = c;
    lastUncached = u;
  }
  const ratios = reps.map((rep) => rep.ratio).sort((a, b) => a - b);
  const medianRatio = ratios[Math.floor(ratios.length / 2)]!;
  return {
    scheduleCount: options.scheduleCount,
    generateMs,
    reps,
    calls: lastUncached!.counters.calls,
    allianceSlots: lastUncached!.counters.allianceSlots,
    uniqueAlliances: last!.uniqueAlliances,
    cacheMisses: last!.counters.cacheMisses,
    uncachedUsPerCall,
    cachedUsPerCall,
    medianRatio,
    minRatio: ratios[0]!,
    maxRatio: ratios[ratios.length - 1]!,
  };
}

export interface PricingTotalResult {
  scheduleCount: number;
  generateMs: number;
  uncachedMs: number;
  cachedMs: number;
  calls: number;
  allianceSlots: number;
  uniqueAlliances: number;
  cacheMisses: number;
}

/** The direct per-event pricing total: K schedules priced once uncached and once cached (no draws, generation reported apart). */
export function measurePricingTotal(payload: PresimPricingPayload, options: { scheduleCount: number }): PricingTotalResult {
  const pricer = buildPresimPricer(payload);
  const { schedules, generateMs } = prepareSchedules(payload, options.scheduleCount);
  const u = priceOnly(pricer, schedules, false);
  const c = priceOnly(pricer, schedules, true);
  return {
    scheduleCount: options.scheduleCount,
    generateMs,
    uncachedMs: u.priceMs,
    cachedMs: c.priceMs,
    calls: u.counters.calls,
    allianceSlots: u.counters.allianceSlots,
    uniqueAlliances: c.uniqueAlliances,
    cacheMisses: c.counters.cacheMisses,
  };
}

export interface ComponentTimings {
  scheduleCount: number;
  matches: number;
  allianceSlots: number;
  uniqueAlliances: number;
  /** SPR `predict` alone, per match. */
  sprPredictUsPerMatch: number;
  /** The alliance-level RP pieces (band variance, moments, mean shift, bonus pmf), per UNIQUE alliance. */
  alliancePieceUsPerAlliance: number;
  /** The match-level combine (`combineMatch`, unrounded), per match. */
  combineUsPerMatch: number;
  /** `roundPmf` over the two pmfs of a match, per match. */
  roundUsPerMatch: number;
  sprPredictMs: number;
  alliancePieceMs: number;
  combineMs: number;
  roundMs: number;
}

/** Times three whole loops over K schedules' matches: SPR predict, alliance pieces once per unique alliance, match-level combine over cached pieces. */
export function measureComponents(payload: PresimPricingPayload, options: { scheduleCount: number }): ComponentTimings {
  const pricer = buildPresimPricer(payload);
  const { schedules } = prepareSchedules(payload, options.scheduleCount);
  const matches = schedules.flat();
  const predictions = new Array<{ pRedWin: number; redScore: number; blueScore: number }>(matches.length);

  const a0 = performance.now();
  for (let i = 0; i < matches.length; i++) {
    const p = spr.predict(pricer.sprState, matches[i]!);
    predictions[i] = { pRedWin: p.pRedWin, redScore: p.redScore, blueScore: p.blueScore };
  }
  const a1 = performance.now();

  const pieces = new Map<string, AlliancePiece>();
  const firstScore = new Map<string, { teams: readonly string[]; score: number }>();
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const rk = allianceKey(m.redTeams);
    if (!firstScore.has(rk)) firstScore.set(rk, { teams: m.redTeams, score: predictions[i]!.redScore });
    const bk = allianceKey(m.blueTeams);
    if (!firstScore.has(bk)) firstScore.set(bk, { teams: m.blueTeams, score: predictions[i]!.blueScore });
  }
  const b0 = performance.now();
  for (const [key, entry] of firstScore) pieces.set(key, pricer.buildPiece(entry.teams, entry.score));
  const b1 = performance.now();

  let sink = 0;
  const combined: { redPmf: number[]; bluePmf: number[] }[] = new Array(matches.length);
  const c0 = performance.now();
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const out = combineMatch(pieces.get(allianceKey(m.redTeams))!, pieces.get(allianceKey(m.blueTeams))!, predictions[i]!.pRedWin, pricer.ruleModule);
    combined[i] = out;
    sink += out.redPmf.length;
  }
  const c1 = performance.now();

  const r0 = performance.now();
  for (let i = 0; i < combined.length; i++) {
    sink += roundPmf(combined[i]!.redPmf).length + roundPmf(combined[i]!.bluePmf).length;
  }
  const r1 = performance.now();
  if (sink < 0) throw new Error("unreachable");

  // The combine loop above includes the two key lookups per match, which is part of the cached arm's real cost.
  return {
    scheduleCount: options.scheduleCount,
    matches: matches.length,
    allianceSlots: matches.length * 2,
    uniqueAlliances: pieces.size,
    sprPredictUsPerMatch: ((a1 - a0) * 1000) / matches.length,
    alliancePieceUsPerAlliance: ((b1 - b0) * 1000) / pieces.size,
    combineUsPerMatch: ((c1 - c0) * 1000) / matches.length,
    roundUsPerMatch: ((r1 - r0) * 1000) / matches.length,
    sprPredictMs: a1 - a0,
    alliancePieceMs: b1 - b0,
    combineMs: c1 - c0,
    roundMs: r1 - r0,
  };
}

// The `RpPopulationState`/`RpTeamBeliefs` types are re-exported so the driver's payload encoder needs no second import path.
export type { RpPopulationState, RpTeamBeliefs, RpMeanShiftState };
