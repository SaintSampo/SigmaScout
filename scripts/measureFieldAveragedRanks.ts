/**
 * Does the FIELD-AVERAGED pre-schedule predictor reproduce the rank bands the
 * 20-schedule BAKED path produces, on real finished events?
 *
 *   `baked` — the shipped path: synthetic qualification schedules from
 *   `packages/harness/generatedSchedules.ts`, every match priced by the
 *   publisher's own `makeRankingPointFiller`, ranks baked by
 *   `buildPreScheduleArtifact`.
 *
 *   `fieldAveraged` — no schedule. Each team's per-match pmf comes from its own
 *   belief plus the roster's field statistics (mean and variance of per-team
 *   contributions) through the same `analyticRpPmf`, and its season total is an
 *   exact `convolvePmf` of `matchesPerTeam` copies.
 *
 * Both arms share the imported `simulateRanks` and `continuousQuantile`, one
 * replay, one model state and one `SigmaScoutLayer` per event; they differ only
 * in the pmf inputs. A scorer mismatch has manufactured a ~0.003 phantom
 * regression on this project before.
 *
 * Reads `data/corpus.sqlite` read-only: no network, no credential, no R2 or D1,
 * no environment variable, and `.env` is never read.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { TOTAL_METRIC_KEY, type AlgorithmModule, type MatchResult, type UpcomingMatch } from "../packages/core/algorithms/types.js";
import {
  simulateRanks,
  mulberry32,
  type SimMatchInput,
  type SimResult,
  type SimTeamBaseline,
} from "../packages/core/algorithms/simulation/rankSimulation.js";
import { continuousQuantile } from "../apps/web/src/lib/simQuantile.js";
import { openCorpusReadOnly, selectMatchesChronological, selectScheduledMatches, type Corpus } from "../packages/corpus/db.js";
import { WalkForwardSimulator, buildSeasonStream, toLeakProofUpcoming } from "../packages/harness/replay.js";
import { corpusColdStartIndex } from "../packages/harness/corpusColdStart.js";
import { seasonBoundaryFor } from "../packages/harness/seasonBoundary.js";
import { SigmaScoutLayer } from "../packages/harness/sigmaScoutLayer.js";
import { usesSigmaScore } from "../packages/harness/sigmaScore.js";
import { RP_RULE_MODULES } from "../packages/core/rankingPoints/rules.js";
import { matchesPerTeamFor } from "../packages/harness/generatedSchedules.js";
import {
  buildPreScheduleArtifact,
  buildFieldAveragedPreScheduleArtifact,
  buildFieldContributions,
} from "../packages/harness/preSchedule.js";
import { BASE_PUBLISH_ALGORITHMS, makeRankingPointFiller } from "../packages/harness/publish.js";
import type { PreScheduleArtifact } from "../packages/harness/pageArtifacts.js";
import {
  ALLIANCE_SIZE,
  fieldAveragedRankInputs,
  fieldStatistics,
} from "../packages/core/rankingPoints/fieldAveraged.js";
import { pmfMean } from "../packages/core/rankingPoints/analyticPmf.js";

const CORPUS_PATH = "data/corpus.sqlite";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export interface TargetEvent {
  readonly eventKey: string;
  readonly season: number;
  readonly expectedRoster: number;
  readonly expectedQuals: number;
}

/**
 * Six real finished events. Roster and qual counts are re-asserted at run time
 * so a re-ingest that moved one is loud rather than a silently different
 * measurement. Corpus rosters for 2022-2026 span 14 to 78 teams, and this table
 * spans that range end to end.
 */
export const DEFAULT_TARGET_EVENTS: readonly TargetEvent[] = [
  { eventKey: "2022on034", season: 2022, expectedRoster: 14, expectedQuals: 21 },
  { eventKey: "2023gaalb", season: 2023, expectedRoster: 21, expectedQuals: 42 },
  { eventKey: "2024caav", season: 2024, expectedRoster: 40, expectedQuals: 74 },
  { eventKey: "2025cur", season: 2025, expectedRoster: 76, expectedQuals: 127 },
  { eventKey: "2026joh", season: 2026, expectedRoster: 75, expectedQuals: 125 },
  { eventKey: "2026txmca", season: 2026, expectedRoster: 18, expectedQuals: 36 },
];

/** The baked arm's own product (`PRESIM_SCHEDULE_COUNT * PRESIM_DRAWS_PER_SCHEDULE`, publish.ts) — both arms rank over the same number of draws. */
export const DEFAULT_DRAWS = 1000;

/**
 * Mirrors the shipped `PRESIM_SCHEDULE_COUNT` (publish.ts) and is never written
 * back to it. `--schedules` overrides it for a run only.
 */
export const DEFAULT_SCHEDULE_COUNT = 20;

/** The resolved pair `measureEvent` hands `buildPreScheduleArtifact`. */
export interface ScheduleSplit {
  readonly scheduleCount: number;
  readonly drawsPerSchedule: number;
}

/**
 * Splits a TOTAL draw count (`--draws`) across schedules. At the default count
 * the result must stay identical to the committed n=20 record (the test pins it
 * over a table of draw counts). A non-positive-integer count throws rather than
 * clamping, so a figure's schedule count is always the one asked for.
 */
export function resolveScheduleSplit(draws: number, scheduleCount?: number): ScheduleSplit {
  const resolved = scheduleCount ?? DEFAULT_SCHEDULE_COUNT;
  if (typeof resolved !== "number" || !Number.isInteger(resolved) || resolved <= 0) {
    throw new Error(
      `measureFieldAveragedRanks: the schedule count must be a finite positive integer, but got ${String(resolved)} (type ${typeof resolved}). Pass --schedules <n> with a whole number greater than zero, or omit it for the default ${DEFAULT_SCHEDULE_COUNT}.`
    );
  }
  return { scheduleCount: resolved, drawsPerSchedule: Math.max(1, Math.round(draws / resolved)) };
}

/** SPR is the only published algorithm carrying a Sigma Score for every team it has seen. */
export const DEFAULT_ALGORITHM_ID = "spr";

export const FIELD_AVERAGED_DOC_PATH = join("docs", "models", "field-averaged-presim.md");

/** Mirrors `packages/harness/payloadBudget.test.ts`'s `BUDGET_BLOCK_PATTERN` shape exactly, including its `\r?\n` tolerance for the fence's surrounding newlines. */
export const FIELD_AVERAGED_BLOCK_PATTERN = /```json field-averaged-presim\r?\n([\s\S]*?)\r?\n```/;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** One (event, team) row of the comparison — the unit the acceptance criterion is evaluated over. */
export interface TeamQuantileRow {
  readonly eventKey: string;
  readonly teamKey: string;
  readonly bakedP10: number;
  readonly bakedMedian: number;
  readonly bakedP90: number;
  readonly fieldP10: number;
  readonly fieldMedian: number;
  readonly fieldP90: number;
}

// ---------------------------------------------------------------------------
// The field-averaged acceptance criterion
// ---------------------------------------------------------------------------

/** Thrown below six events, so a small sample can never quietly return `pass`. */
export class InsufficientSampleError extends Error {
  constructor(eventCount: number) {
    super(
      `evaluateRungOneCriterion: the criterion requires at least ${MINIMUM_EVENT_COUNT} real finished events; this sample carries ${eventCount}. Refusing to return a verdict.`
    );
    this.name = "InsufficientSampleError";
  }
}

/** Clause 1's tight half: `|median_rung1 - median_baked| <= 0.5` ranks. 0.5 is the smallest median difference a band printed to one decimal place can render as distinct. */
export const CLAUSE_1_MEDIAN_TIGHT = 0.5;
/** Clause 1's tight half: that tolerance must hold for at least 95% of teams. */
export const CLAUSE_1_TIGHT_RATE = 0.95;
/** Clause 1's hard half: no single-team outlier worse than ONE rank. */
export const CLAUSE_1_MEDIAN_HARD = 1.0;
/** Clause 2: `|p10 diff| <= 1.0` AND `|p90 diff| <= 1.0`. A real rank band's middle 80% spans only 1-5 ranks of 17, so one rank is already material. */
export const CLAUSE_2_EDGE_TOLERANCE = 1.0;
/** Clause 2: both edge tolerances must hold for at least 90% of teams. */
export const CLAUSE_2_RATE = 0.9;
/** Clause 3: the MEAN SIGNED median-rank difference must lie within +/-0.25 ranks. */
export const CLAUSE_3_MEAN_SHIFT = 0.25;
/** The criterion's own sample requirement: at least six real finished events. */
export const MINIMUM_EVENT_COUNT = 6;

// ---------------------------------------------------------------------------
// The binding noise floors
// ---------------------------------------------------------------------------

/**
 * Held at the shipped `PRESIM_DRAWS_PER_SCHEDULE` (publish.ts): varying draws
 * together with the schedule count would conflate "more schedules" with "more
 * draws".
 */
export const DRAWS_PER_SCHEDULE = 50;

/**
 * The resampling floor: the baked construction against itself with two fully
 * independent shuffle-and-draw streams. A seed-only floor reuses the same K
 * shuffles and so misses shuffle noise, which a candidate arm does face.
 *
 * The streams come from salting `algorithmVersion`, which in
 * `buildPreScheduleArtifact` feeds only the shuffle and seed hashes; pricing is
 * the same bound `predict` on both sides. A floor is a diagnostic: it may
 * explain a verdict, never overrule one.
 */
export interface ResamplingFloor {
  readonly withinTightRate: number;
  readonly meanAbsMedianDiff: number;
  readonly maxAbsMedianDiff: number;
  readonly p10WithinRate: number;
  readonly p90WithinRate: number;
  /** Every team's `|median_A - median_B|`, kept so the pooled 95th percentile (clause 1's quantity) is computed across the whole sample. */
  readonly absMedianDiffs: readonly number[];
}

/** Sums `count` priced schedules into one rank histogram per team; every arm uses the same seed derivation. */
export function aggregateOverPrefix(artifact: PreScheduleArtifact, count: number, drawSalt: number): number[][] {
  const roster = artifact.roster;
  const baselines: SimTeamBaseline[] = roster.map((teamKey) => ({ teamKey, earnedRpSum: 0, matchesPlayed: 0 }));
  const totals = roster.map(() => new Array<number>(roster.length).fill(0));
  for (const schedule of artifact.schedules.slice(0, count)) {
    const inputs: SimMatchInput[] = schedule.matches.map((m) => ({
      redTeamKeys: m.r.map((i) => roster[i]!),
      blueTeamKeys: m.b.map((i) => roster[i]!),
      redRpPmf: m.rp,
      blueRpPmf: m.bp,
    }));
    const result = simulateRanks(inputs, baselines, DRAWS_PER_SCHEDULE, mulberry32(schedule.seed ^ drawSalt));
    for (let t = 0; t < roster.length; t++) {
      const h = result.rankHistograms.get(roster[t]!)!;
      for (let rank = 0; rank < roster.length; rank++) totals[t]![rank]! += h[rank]!;
    }
  }
  return totals;
}

export const RESAMPLE_DRAW_SALT = 0x2718_2818;

export function measureResamplingFloor(
  a: PreScheduleArtifact,
  b: PreScheduleArtifact,
  count: number
): ResamplingFloor {
  const draws = count * DRAWS_PER_SCHEDULE;
  const totalsA = aggregateOverPrefix(a, count, RESAMPLE_DRAW_SALT);
  const totalsB = aggregateOverPrefix(b, count, RESAMPLE_DRAW_SALT);
  const n = a.roster.length;
  const med: number[] = [];
  const p10: number[] = [];
  const p90: number[] = [];
  for (let t = 0; t < n; t++) {
    med.push(Math.abs(continuousQuantile(totalsA[t]!, 0.5, draws) - continuousQuantile(totalsB[t]!, 0.5, draws)));
    p10.push(Math.abs(continuousQuantile(totalsA[t]!, 0.1, draws) - continuousQuantile(totalsB[t]!, 0.1, draws)));
    p90.push(Math.abs(continuousQuantile(totalsA[t]!, 0.9, draws) - continuousQuantile(totalsB[t]!, 0.9, draws)));
  }
  return {
    withinTightRate: med.filter((d) => d <= CLAUSE_1_MEDIAN_TIGHT).length / n,
    meanAbsMedianDiff: med.reduce((x, y) => x + y, 0) / n,
    maxAbsMedianDiff: Math.max(...med),
    p10WithinRate: p10.filter((d) => d <= CLAUSE_2_EDGE_TOLERANCE).length / n,
    p90WithinRate: p90.filter((d) => d <= CLAUSE_2_EDGE_TOLERANCE).length / n,
    absMedianDiffs: med,
  };
}

/** Appended to `algorithmVersion` (used only for seed hashing) to make an independent replicate of the same baked build. */
export const REPLICATE_SUFFIX = "+resample-replicate";

/**
 * `measureSeedNoiseFloor` for clause 2: the p10 and p90 edges come from the
 * distribution's tails and carry their own draw noise, so a clause-2 failure
 * needs this to be attributable. Same construction (the baked arm's schedules,
 * two non-published seeds); a diagnostic, never part of the criterion.
 */
export interface EdgeNoiseFloor {
  readonly p10WithinRate: number;
  readonly p90WithinRate: number;
  readonly meanAbsP10Diff: number;
  readonly meanAbsP90Diff: number;
}

export function measureEdgeNoiseFloor(artifact: PreScheduleArtifact, draws: number): EdgeNoiseFloor {
  const roster = artifact.roster;
  const baselines: SimTeamBaseline[] = roster.map((teamKey) => ({ teamKey, earnedRpSum: 0, matchesPlayed: 0 }));
  const drawsPerSchedule = Math.max(1, Math.round(draws / artifact.schedules.length));
  const totalsA = roster.map(() => new Array<number>(roster.length).fill(0));
  const totalsB = roster.map(() => new Array<number>(roster.length).fill(0));
  for (const schedule of artifact.schedules) {
    const inputs: SimMatchInput[] = schedule.matches.map((m) => ({
      redTeamKeys: m.r.map((i) => roster[i]!),
      blueTeamKeys: m.b.map((i) => roster[i]!),
      redRpPmf: m.rp,
      blueRpPmf: m.bp,
    }));
    const a = simulateRanks(inputs, baselines, drawsPerSchedule, mulberry32(schedule.seed ^ 0x5a5a5a5a));
    const b = simulateRanks(inputs, baselines, drawsPerSchedule, mulberry32(schedule.seed ^ 0x3c3c3c3c));
    for (let t = 0; t < roster.length; t++) {
      const ha = a.rankHistograms.get(roster[t]!)!;
      const hb = b.rankHistograms.get(roster[t]!)!;
      for (let rank = 0; rank < roster.length; rank++) {
        totalsA[t]![rank]! += ha[rank]!;
        totalsB[t]![rank]! += hb[rank]!;
      }
    }
  }
  const p10 = roster.map((_, t) => Math.abs(continuousQuantile(totalsA[t]!, 0.1, draws) - continuousQuantile(totalsB[t]!, 0.1, draws)));
  const p90 = roster.map((_, t) => Math.abs(continuousQuantile(totalsA[t]!, 0.9, draws) - continuousQuantile(totalsB[t]!, 0.9, draws)));
  return {
    p10WithinRate: p10.filter((d) => d <= CLAUSE_2_EDGE_TOLERANCE).length / p10.length,
    p90WithinRate: p90.filter((d) => d <= CLAUSE_2_EDGE_TOLERANCE).length / p90.length,
    meanAbsP10Diff: p10.reduce((a, b) => a + b, 0) / p10.length,
    meanAbsP90Diff: p90.reduce((a, b) => a + b, 0) / p90.length,
  };
}


export interface Clause1Outcome {
  readonly pass: boolean;
  /** The achieved fraction of teams within `CLAUSE_1_MEDIAN_TIGHT`, POOLED across the whole sample. */
  readonly tightRate: number;
  readonly tightCount: number;
  readonly everyTeamWithinHard: boolean;
  readonly worstAbsMedianDiff: number;
  readonly worstTeamKey: string;
  readonly worstEventKey: string;
}

export interface Clause2Outcome {
  readonly pass: boolean;
  readonly p10Rate: number;
  readonly p90Rate: number;
}

export interface Clause3Outcome {
  readonly pass: boolean;
  readonly meanSignedMedianDiff: number;
}

export interface PerEventClauseRates {
  readonly eventKey: string;
  readonly teamCount: number;
  readonly tightRate: number;
  readonly p10Rate: number;
  readonly p90Rate: number;
  readonly meanSignedMedianDiff: number;
}

export interface RungOneVerdict {
  readonly pass: boolean;
  readonly teamCount: number;
  readonly eventCount: number;
  readonly clause1: Clause1Outcome;
  readonly clause2: Clause2Outcome;
  readonly clause3: Clause3Outcome;
  /** Printed so a single bad event cannot hide inside the pool. NOT what the clauses are evaluated over. */
  readonly perEvent: readonly PerEventClauseRates[];
}

/**
 * The acceptance criterion, fixed before any measurement; do not adjust a
 * number after seeing a result. Over at least six finished events, with the
 * `continuousQuantile` p10/median/p90 the live rank band uses:
 *
 * 1. `|median_field - median_baked| <= 0.5` for >= 95% of teams and `<= 1.0`
 *    for every team.
 * 2. `|p10 diff| <= 1.0` and `|p90 diff| <= 1.0` for >= 90% of teams.
 * 3. The mean signed median difference is within +/-0.25.
 *
 * Tolerances are in rank units, the unit a reader takes off the page; 0.5 is
 * the smallest median difference a one-decimal band can show. Clause 1 is
 * pooled across the sample, not per event (a per-event 95% on a 22-team roster
 * is a stricter bar); the per-event breakdown is still returned. The criterion
 * does not test which team holds a rank, or either arm against realised
 * rankings.
 */
export function evaluateRungOneCriterion(rows: readonly TeamQuantileRow[]): RungOneVerdict {
  const eventKeys = new Set(rows.map((r) => r.eventKey));
  if (eventKeys.size < MINIMUM_EVENT_COUNT) throw new InsufficientSampleError(eventKeys.size);

  const medianDiffs = rows.map((r) => r.fieldMedian - r.bakedMedian);

  // --- Clause 1, POOLED across the sample. ---
  let tightCount = 0;
  let everyTeamWithinHard = true;
  let worstAbsMedianDiff = 0;
  let worstTeamKey = "";
  let worstEventKey = "";
  for (const [i, row] of rows.entries()) {
    const abs = Math.abs(medianDiffs[i]!);
    if (abs <= CLAUSE_1_MEDIAN_TIGHT) tightCount++;
    if (abs > CLAUSE_1_MEDIAN_HARD) everyTeamWithinHard = false;
    if (abs > worstAbsMedianDiff) {
      worstAbsMedianDiff = abs;
      worstTeamKey = row.teamKey;
      worstEventKey = row.eventKey;
    }
  }
  const tightRate = tightCount / rows.length;
  const clause1: Clause1Outcome = {
    pass: tightRate >= CLAUSE_1_TIGHT_RATE && everyTeamWithinHard,
    tightRate,
    tightCount,
    everyTeamWithinHard,
    worstAbsMedianDiff,
    worstTeamKey,
    worstEventKey,
  };

  // --- Clause 2: an AND over BOTH edges, never an OR. ---
  const p10Within = rows.filter((r) => Math.abs(r.fieldP10 - r.bakedP10) <= CLAUSE_2_EDGE_TOLERANCE).length;
  const p90Within = rows.filter((r) => Math.abs(r.fieldP90 - r.bakedP90) <= CLAUSE_2_EDGE_TOLERANCE).length;
  const p10Rate = p10Within / rows.length;
  const p90Rate = p90Within / rows.length;
  const clause2: Clause2Outcome = {
    pass: p10Rate >= CLAUSE_2_RATE && p90Rate >= CLAUSE_2_RATE,
    p10Rate,
    p90Rate,
  };

  // --- Clause 3: SIGNED, never absolute, or it could not detect a systematic shift. ---
  const meanSignedMedianDiff = medianDiffs.reduce((a, b) => a + b, 0) / medianDiffs.length;
  const clause3: Clause3Outcome = {
    pass: Math.abs(meanSignedMedianDiff) <= CLAUSE_3_MEAN_SHIFT,
    meanSignedMedianDiff,
  };

  // --- The per-event breakdown, printed but never evaluated against. ---
  const perEvent: PerEventClauseRates[] = [...eventKeys].map((eventKey) => {
    const eventRows = rows.filter((r) => r.eventKey === eventKey);
    const diffs = eventRows.map((r) => r.fieldMedian - r.bakedMedian);
    return {
      eventKey,
      teamCount: eventRows.length,
      tightRate: eventRows.filter((r) => Math.abs(r.fieldMedian - r.bakedMedian) <= CLAUSE_1_MEDIAN_TIGHT).length / eventRows.length,
      p10Rate: eventRows.filter((r) => Math.abs(r.fieldP10 - r.bakedP10) <= CLAUSE_2_EDGE_TOLERANCE).length / eventRows.length,
      p90Rate: eventRows.filter((r) => Math.abs(r.fieldP90 - r.bakedP90) <= CLAUSE_2_EDGE_TOLERANCE).length / eventRows.length,
      meanSignedMedianDiff: diffs.reduce((a, b) => a + b, 0) / diffs.length,
    };
  });

  return {
    pass: clause1.pass && clause2.pass && clause3.pass,
    teamCount: rows.length,
    eventCount: eventKeys.size,
    clause1,
    clause2,
    clause3,
    perEvent,
  };
}

/** The additivity residual, measured on one event's played qualification matches. */
export interface AdditivityResidual {
  readonly allianceCount: number;
  readonly mean: number;
  readonly sd: number;
  readonly maxAbs: number;
  /** The same three numbers as a fraction of `sqrt(meanOfBandVariances * ALLIANCE_SIZE)` — the score uncertainty the model already carries. */
  readonly scoreUncertainty: number;
  readonly meanFraction: number;
  readonly sdFraction: number;
  readonly maxAbsFraction: number;
}

export interface ByteSizes {
  readonly bakedBytes: number;
  readonly fieldAveragedBytes: number;
  readonly ratio: number;
  readonly fieldBytesPerTeam: number;
  readonly bakedSchedulesFraction: number;
}

export interface EventMeasurement {
  readonly eventKey: string;
  readonly season: number;
  readonly rosterSize: number;
  readonly qualCount: number;
  readonly matchesPerTeam: number;
  readonly draws: number;
  readonly replayMode: string;
  readonly preTargetMatchCount: number;
  readonly rows: readonly TeamQuantileRow[];
  readonly residual: AdditivityResidual;
  readonly bytes: ByteSizes;
  /** Mean season-total RP per team in each arm — a systematic difference points at the moments construction. */
  readonly bakedMeanSeasonRp: number;
  readonly fieldMeanSeasonRp: number;
  /** Mean band WIDTH (`p90 - p10`) in each arm — a systematic difference points at the composition-spread terms. */
  readonly bakedMeanBandWidth: number;
  readonly fieldMeanBandWidth: number;
  /** The same-arm seed-noise control; a diagnostic, never part of the criterion. */
  readonly noise: SeedNoiseFloor;
  /** The schedule count this event was measured at. */
  readonly scheduleCount: number;
  /** Draws per schedule, derived from the total. Asserted equal to the imported `DRAWS_PER_SCHEDULE` before either binding floor is read. */
  readonly drawsPerSchedule: number;
  /**
   * The floor a two-arm comparison is read against (see `ResamplingFloor`).
   * The draw-only `noise` field holds the shuffles fixed and understates it,
   * by roughly 2.5x at the shipped count. A diagnostic, never an overrule.
   */
  readonly resampling: ResamplingFloor;
  /** Clause 2's counterpart control: the band edges' own noise. */
  readonly edges: EdgeNoiseFloor;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function uniqueSortedRoster(quals: readonly MatchResult[]): string[] {
  const keys = new Set<string>();
  for (const m of quals) {
    for (const t of m.redTeams) keys.add(t);
    for (const t of m.blueTeams) keys.add(t);
  }
  return [...keys].sort();
}

/** One quantile helper, called identically for both arms. */
export function quantilesOf(result: SimResult, teamKey: string): { p10: number; median: number; p90: number } {
  const dist = result.rankHistograms.get(teamKey);
  if (dist === undefined) {
    throw new Error(`measureFieldAveragedRanks: no rank histogram for team "${teamKey}"`);
  }
  return {
    p10: continuousQuantile(dist, 0.1, result.draws),
    median: continuousQuantile(dist, 0.5, result.draws),
    p90: continuousQuantile(dist, 0.9, result.draws),
  };
}

/** Decodes baked histograms into a `SimResult` so both arms reach `continuousQuantile` through one code path. */
export function bakedSimResult(roster: readonly string[], histograms: readonly (readonly number[])[], draws: number): SimResult {
  const rankHistograms = new Map<string, Int32Array>();
  for (let i = 0; i < roster.length; i++) {
    rankHistograms.set(roster[i]!, Int32Array.from(histograms[i]!));
  }
  return { rankHistograms, draws };
}

function meanAndSd(values: readonly number[]): { mean: number; sd: number; maxAbs: number } {
  if (values.length === 0) return { mean: 0, sd: 0, maxAbs: 0 };
  let total = 0;
  let maxAbs = 0;
  for (const v of values) {
    total += v;
    maxAbs = Math.max(maxAbs, Math.abs(v));
  }
  const mean = total / values.length;
  let sq = 0;
  for (const v of values) sq += (v - mean) ** 2;
  return { mean, sd: Math.sqrt(sq / values.length), maxAbs };
}

// ---------------------------------------------------------------------------
// The per-event driver
// ---------------------------------------------------------------------------

export interface SeasonReplayResult {
  readonly layer: SigmaScoutLayer;
  readonly preEventStateByEvent: ReadonlyMap<string, unknown>;
  readonly preTargetMatchCountByEvent: ReadonlyMap<string, number>;
  readonly replayMode: string;
}

/**
 * Replays one season (carrying in from `replayFrom`) the way `publishSeasons`
 * does: offseason-inclusive stream, corpus-global cold-start index, pre-event
 * state and per-match Sigma talent captured in `onMatchComplete`, and a
 * per-season `SigmaScoutLayer` folded over the records after the replay.
 */
export function replaySeason(
  db: Corpus,
  algorithm: AlgorithmModule<any>,
  season: number,
  replayFrom: number,
  targetEventKeys: ReadonlySet<string>
): SeasonReplayResult {
  const coldStartIndex = corpusColdStartIndex(db);
  const seasons: number[] = [];
  for (let s = replayFrom; s <= season; s++) seasons.push(s);

  let carriedState: unknown;
  let result: SeasonReplayResult | undefined;

  for (const [seasonIdx, s] of seasons.entries()) {
    const stream = buildSeasonStream(db, s, { includeOffseason: true });
    const teams = [...new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
    const boundary = seasonBoundaryFor(seasons, seasonIdx);
    let initialStates: ReadonlyMap<string, unknown> | undefined;
    if (!boundary.isColdStart && carriedState !== undefined && algorithm.carrySeason) {
      initialStates = new Map<string, unknown>([[algorithm.id, algorithm.carrySeason(carriedState, boundary)]]);
    }

    // Pre-event state is captured once, on each event's first completed match.
    const preEventStateByEvent = new Map<string, unknown>();
    const preTargetMatchCountByEvent = new Map<string, number>();
    const talentAfterMatch = new Map<string, Map<string, number>>();
    const seen = new Set<string>();
    let lastState: unknown;
    let haveLastState = false;
    let replayedSoFar = 0;
    const onMatchComplete = (match: MatchResult, algorithmId: string, state: unknown): void => {
      if (algorithmId !== algorithm.id) return;
      if (!seen.has(match.eventKey)) {
        seen.add(match.eventKey);
        if (haveLastState) {
          preEventStateByEvent.set(match.eventKey, lastState);
        } else if (initialStates !== undefined && initialStates.has(algorithm.id)) {
          preEventStateByEvent.set(match.eventKey, initialStates.get(algorithm.id));
        }
        // else: the cold-start season's first event gets no entry, as in publish.ts.
        if (targetEventKeys.has(match.eventKey)) preTargetMatchCountByEvent.set(match.eventKey, replayedSoFar);
      }
      lastState = state;
      haveLastState = true;
      replayedSoFar++;
      if (usesSigmaScore(algorithmId)) {
        const involved = [...match.redTeams, ...match.blueTeams];
        const metrics = algorithm.teamMetrics(state, involved);
        const talent = new Map<string, number>();
        for (const teamKey of involved) {
          const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
          if (total !== undefined) talent.set(teamKey, total);
        }
        talentAfterMatch.set(match.matchKey, talent);
      }
    };

    const simulator = new WalkForwardSimulator(stream, coldStartIndex);
    const records = simulator.runAll([algorithm], teams, initialStates, onMatchComplete);
    carriedState = records.carryStates.get(algorithm.id);

    if (s === season) {
      const layer = new SigmaScoutLayer(RP_RULE_MODULES[s], algorithm.id);
      for (const r of records) {
        if (r.algorithmId !== algorithm.id) continue;
        layer.foldPlayed(r.match, r.prediction, talentAfterMatch.get(r.match.matchKey));
      }
      result = {
        layer,
        preEventStateByEvent,
        preTargetMatchCountByEvent,
        replayMode:
          replayFrom === season
            ? `cold (target season ${season} only, replay-mode assumption)`
            : `carried from ${replayFrom} through ${season}`,
      };
    }
  }
  if (result === undefined) throw new Error(`measureFieldAveragedRanks: season ${season} was never replayed`);
  return result;
}

export interface MeasureOptions {
  readonly draws: number;
  readonly algorithmId: string;
  readonly replayFrom?: number;
  /** Defaults to `DEFAULT_SCHEDULE_COUNT`. */
  readonly scheduleCount?: number;
}

export function measureEvent(
  db: Corpus,
  algorithm: AlgorithmModule<any>,
  target: TargetEvent,
  replay: SeasonReplayResult,
  options: MeasureOptions
): EventMeasurement {
  // Played matches only; unplayed ones are checked separately below.
  const quals = selectMatchesChronological(db, { eventKey: target.eventKey }).filter((m) => m.compLevel === "qm");

  if (quals.length !== target.expectedQuals) {
    throw new Error(
      `measureFieldAveragedRanks: ${target.eventKey}'s corpus qual count (${quals.length}) no longer matches the pinned expectation (${target.expectedQuals}) — the corpus may have been re-ingested. Update DEFAULT_TARGET_EVENTS or investigate before trusting this measurement.`
    );
  }
  const roster = uniqueSortedRoster(quals);
  if (roster.length !== target.expectedRoster) {
    throw new Error(
      `measureFieldAveragedRanks: ${target.eventKey}'s corpus roster size (${roster.length}) no longer matches the pinned expectation (${target.expectedRoster}).`
    );
  }
  const unplayed = selectScheduledMatches(db, { eventKey: target.eventKey }).filter((m) => m.compLevel === "qm");
  if (unplayed.length > 0) {
    throw new Error(
      `measureFieldAveragedRanks: ${target.eventKey} has ${unplayed.length} unplayed qualification match(es) — the sample requires FINISHED events, so the baked arm is priced against a complete schedule.`
    );
  }

  const eventType = quals[0]!.eventType;
  const week = quals[0]!.week;
  const matchesPerTeam = matchesPerTeamFor(roster.length, quals.length);
  const ruleModule = RP_RULE_MODULES[target.season];
  if (ruleModule === undefined) throw new Error(`measureFieldAveragedRanks: season ${target.season} has no RP rule module`);

  const pricingState = replay.preEventStateByEvent.get(target.eventKey);
  if (pricingState === undefined) {
    throw new Error(
      `measureFieldAveragedRanks: no pre-event walk-forward state was captured for ${target.eventKey} (the cold-start season's first event). Re-run with --replay-from an earlier season.`
    );
  }

  const layer = replay.layer;
  const sigmaScores = layer.sigmaScoreByTeam();
  const filler = makeRankingPointFiller(layer.rpAccumulator, ruleModule, sigmaScores, roster);
  if (filler === undefined) {
    throw new Error(`measureFieldAveragedRanks: the ranking-point filler is unavailable for ${target.eventKey} — the all-or-nothing roster rule rejected this roster.`);
  }

  // --- Arm `baked`: the publisher's own path and closure. ---
  const { scheduleCount, drawsPerSchedule } = resolveScheduleSplit(options.draws, options.scheduleCount);
  // One bound closure for the baked arm and its replicate, so pricing cannot differ.
  const predict = (match: UpcomingMatch) => filler(match, algorithm.predict(pricingState, match));
  const bakedArtifact = buildPreScheduleArtifact({
    eventKey: target.eventKey,
    season: target.season,
    eventType,
    week,
    algorithmId: algorithm.id,
    algorithmVersion: algorithm.version,
    roster,
    matchesPerTeam,
    pricedFrom: "pre-event-walk-forward",
    scheduleCount,
    drawsPerSchedule,
    generation: "measure",
    computedAt: "1970-01-01T00:00:00.000Z",
    predict,
  });
  if (bakedArtifact === null) {
    throw new Error(`measureFieldAveragedRanks: the baked arm returned null for ${target.eventKey} — this algorithm does not model ranking points here.`);
  }
  const bakedDraws = bakedArtifact.baked.draws;

  // --- The resampling floor's replicate: identical to the artifact above except
  // `algorithmVersion` (seed hashing only); any other difference voids the
  // control. It feeds the floor only, never a criterion number. ---
  const replicateArtifact = buildPreScheduleArtifact({
    eventKey: target.eventKey,
    season: target.season,
    eventType,
    week,
    algorithmId: algorithm.id,
    algorithmVersion: `${algorithm.version}${REPLICATE_SUFFIX}`,
    roster,
    matchesPerTeam,
    pricedFrom: "pre-event-walk-forward",
    scheduleCount,
    drawsPerSchedule,
    generation: "measure",
    computedAt: "1970-01-01T00:00:00.000Z",
    predict,
  });
  if (replicateArtifact === null) {
    throw new Error(
      `measureFieldAveragedRanks: the resampling floor's replicate artifact returned null for ${target.eventKey} — this algorithm does not model ranking points here.`
    );
  }
  const bakedResult = bakedSimResult(bakedArtifact.roster, bakedArtifact.baked.histograms, bakedDraws);

  // --- Arm `fieldAveraged`: no schedule anywhere. ---
  const metrics = algorithm.teamMetrics(pricingState, roster);
  const teamTotals = new Map<string, number>();
  for (const teamKey of roster) {
    const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
    if (total !== undefined) teamTotals.set(teamKey, total);
  }
  const contributions = buildFieldContributions({
    roster,
    rpAccumulator: layer.rpAccumulator,
    sigmaScoreByTeam: sigmaScores,
    teamTotals,
  });
  if (contributions === null) {
    throw new Error(`measureFieldAveragedRanks: the field-averaged arm returned null for ${target.eventKey} — the all-or-nothing roster rule rejected this roster.`);
  }
  // Bands come from the rounded, published-shape artifact via the shared
  // `fieldAveragedRankInputs`, so this measures what would ship.
  const fieldArtifact = buildFieldAveragedPreScheduleArtifact({
    eventKey: target.eventKey,
    season: target.season,
    eventType,
    algorithmId: algorithm.id,
    algorithmVersion: algorithm.version,
    matchesPerTeam,
    pricedFrom: "pre-event-walk-forward",
    draws: bakedDraws,
    generation: "measure",
    computedAt: "1970-01-01T00:00:00.000Z",
    ruleModule,
    contributions,
  });
  if (fieldArtifact === null) {
    throw new Error(`measureFieldAveragedRanks: buildFieldAveragedPreScheduleArtifact returned null for ${target.eventKey}.`);
  }
  const stats = fieldStatistics(contributions, ruleModule.thresholdVariables.map((v) => v.name));
  const { matches, baselines } = fieldAveragedRankInputs(fieldArtifact.roster, fieldArtifact.perTeamPmf, fieldArtifact.matchesPerTeam);
  const fieldResult = simulateRanks(matches, baselines, fieldArtifact.draws, mulberry32(fieldArtifact.seed));

  // Both arms must rank over the same draw count.
  for (const teamKey of roster) {
    const bakedSum = [...bakedResult.rankHistograms.get(teamKey)!].reduce((a, b) => a + b, 0);
    const fieldSum = [...fieldResult.rankHistograms.get(teamKey)!].reduce((a, b) => a + b, 0);
    if (bakedSum !== bakedDraws || fieldSum !== bakedDraws) {
      throw new Error(
        `measureFieldAveragedRanks: ${target.eventKey} team ${teamKey} histogram sums disagree with the draw count (baked ${bakedSum}, fieldAveraged ${fieldSum}, draws ${bakedDraws})`
      );
    }
  }

  const rows: TeamQuantileRow[] = roster.map((teamKey) => {
    const b = quantilesOf(bakedResult, teamKey);
    const f = quantilesOf(fieldResult, teamKey);
    return {
      eventKey: target.eventKey,
      teamKey,
      bakedP10: b.p10,
      bakedMedian: b.median,
      bakedP90: b.p90,
      fieldP10: f.p10,
      fieldMedian: f.median,
      fieldP90: f.p90,
    };
  });

  // --- The additivity residual. ---
  const residuals: number[] = [];
  for (const match of quals) {
    const prediction = algorithm.predict(pricingState, toLeakProofUpcoming(match));
    const redSum = match.redTeams.reduce((total, t) => total + (teamTotals.get(t) ?? 0), 0);
    const blueSum = match.blueTeams.reduce((total, t) => total + (teamTotals.get(t) ?? 0), 0);
    residuals.push(prediction.redScore - redSum);
    residuals.push(prediction.blueScore - blueSum);
  }
  const r = meanAndSd(residuals);
  const scoreUncertainty = Math.sqrt(stats.meanOfBandVariances * ALLIANCE_SIZE);
  const residual: AdditivityResidual = {
    allianceCount: residuals.length,
    mean: r.mean,
    sd: r.sd,
    maxAbs: r.maxAbs,
    scoreUncertainty,
    meanFraction: scoreUncertainty > 0 ? r.mean / scoreUncertainty : Number.NaN,
    sdFraction: scoreUncertainty > 0 ? r.sd / scoreUncertainty : Number.NaN,
    maxAbsFraction: scoreUncertainty > 0 ? r.maxAbs / scoreUncertainty : Number.NaN,
  };

  const bakedBytes = Buffer.byteLength(JSON.stringify(bakedArtifact), "utf8");
  const schedulesBytes = Buffer.byteLength(JSON.stringify(bakedArtifact.schedules), "utf8");
  const fieldAveragedBytes = Buffer.byteLength(JSON.stringify(fieldArtifact), "utf8");
  const bytes: ByteSizes = {
    bakedBytes,
    fieldAveragedBytes,
    ratio: bakedBytes / fieldAveragedBytes,
    fieldBytesPerTeam: fieldAveragedBytes / roster.length,
    bakedSchedulesFraction: schedulesBytes / bakedBytes,
  };

  // --- The two diagnostics. Neither is part of the criterion. ---
  const fieldMeanSeasonRp = matches.reduce((total, m) => total + pmfMean(m.redRpPmf), 0) / matches.length;
  const bakedMeanSeasonRp = bakedMeanSeasonRpOf(bakedArtifact, matchesPerTeam);
  const bakedMeanBandWidth = rows.reduce((t, row) => t + (row.bakedP90 - row.bakedP10), 0) / rows.length;
  const fieldMeanBandWidth = rows.reduce((t, row) => t + (row.fieldP90 - row.fieldP10), 0) / rows.length;

  const noise = measureSeedNoiseFloor(bakedArtifact, bakedDraws);

  // `measureResamplingFloor` derives its draw count from `DRAWS_PER_SCHEDULE`;
  // any other draws-per-schedule would silently compare the floor and the
  // candidate at different draw counts, so this throws.
  if (drawsPerSchedule !== DRAWS_PER_SCHEDULE) {
    throw new Error(
      `measureFieldAveragedRanks: this run resolves to ${drawsPerSchedule} draws per schedule, but measureResamplingFloor derives its own draw count from DRAWS_PER_SCHEDULE = ${DRAWS_PER_SCHEDULE}. The binding floor would be measured at a different draw count than the candidate. Re-run with --draws equal to --schedules * ${DRAWS_PER_SCHEDULE} (for ${scheduleCount} schedules that is ${scheduleCount * DRAWS_PER_SCHEDULE}).`
    );
  }
  const resampling = measureResamplingFloor(bakedArtifact, replicateArtifact, scheduleCount);
  const edges = measureEdgeNoiseFloor(bakedArtifact, bakedDraws);

  return {
    eventKey: target.eventKey,
    season: target.season,
    rosterSize: roster.length,
    qualCount: quals.length,
    matchesPerTeam,
    draws: bakedDraws,
    replayMode: replay.replayMode,
    preTargetMatchCount: replay.preTargetMatchCountByEvent.get(target.eventKey) ?? 0,
    rows,
    residual,
    bytes,
    bakedMeanSeasonRp,
    fieldMeanSeasonRp,
    bakedMeanBandWidth,
    fieldMeanBandWidth,
    noise,
    scheduleCount,
    drawsPerSchedule,
    resampling,
    edges,
  };
}

/** The baked arm's mean season-total RP per team: each team's mean per-match RP across its schedules, times `matchesPerTeam`. */
function bakedMeanSeasonRpOf(
  artifact: { roster: readonly string[]; schedules: readonly { matches: readonly { r: readonly number[]; b: readonly number[]; rp: readonly number[]; bp: readonly number[] }[] }[] },
  matchesPerTeam: number
): number {
  const totals = new Array<number>(artifact.roster.length).fill(0);
  const counts = new Array<number>(artifact.roster.length).fill(0);
  for (const schedule of artifact.schedules) {
    for (const match of schedule.matches) {
      const redMean = pmfMean(match.rp);
      const blueMean = pmfMean(match.bp);
      for (const i of match.r) {
        totals[i]! += redMean;
        counts[i]! += 1;
      }
      for (const i of match.b) {
        totals[i]! += blueMean;
        counts[i]! += 1;
      }
    }
  }
  let sum = 0;
  for (let i = 0; i < artifact.roster.length; i++) {
    sum += counts[i]! > 0 ? (totals[i]! / counts[i]!) * matchesPerTeam : 0;
  }
  return sum / artifact.roster.length;
}

/** FNV-1a 32-bit, the seed hash `preSchedule.ts` uses (http://www.isthe.com/chongo/tech/comp/fnv/). */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

function f2(n: number): string {
  return n.toFixed(2);
}

/**
 * Roster-weighted pooling, which recovers the exact pooled team fraction clause
 * 1 is about (a plain mean of per-event rates would weight a 14-team event like
 * a 76-team one). Shared by the console summary and `renderDoc`.
 */
export function rosterWeighted(measurements: readonly EventMeasurement[], pick: (m: EventMeasurement) => number): number {
  const weight = measurements.reduce((t, m) => t + m.rosterSize, 0);
  return measurements.reduce((t, m) => t + pick(m) * m.rosterSize, 0) / weight;
}

/** The binding floor's pooled 95th percentile of `|median_A − median_B|`; the floor can resolve clause 1 only once this reaches `CLAUSE_1_MEDIAN_TIGHT`. */
export function pooledBindingQ95(measurements: readonly EventMeasurement[]): number {
  const all = measurements.flatMap((m) => [...m.resampling.absMedianDiffs]).sort((a, b) => a - b);
  if (all.length === 0) return Number.NaN;
  return all[Math.min(all.length - 1, Math.ceil(0.95 * all.length) - 1)]!;
}

export function printEvent(m: EventMeasurement): void {
  console.log("");
  console.log(`=== ${m.eventKey} (season ${m.season}) ===`);
  console.log(
    `roster=${m.rosterSize}  quals=${m.qualCount}  matchesPerTeam=${m.matchesPerTeam}  draws=${m.draws}  schedules=${m.scheduleCount}  drawsPerSchedule=${m.drawsPerSchedule}  replay=${m.replayMode}  preTargetMatches=${m.preTargetMatchCount}`
  );
  console.log("");
  console.log("team        baked p10/med/p90            fieldAveraged p10/med/p90   d(p10)  d(med)  d(p90)");
  for (const row of m.rows) {
    console.log(
      `${row.teamKey.padEnd(11)} ${f2(row.bakedP10).padStart(6)} ${f2(row.bakedMedian).padStart(6)} ${f2(row.bakedP90).padStart(6)}      ` +
        `${f2(row.fieldP10).padStart(6)} ${f2(row.fieldMedian).padStart(6)} ${f2(row.fieldP90).padStart(6)}   ` +
        `${f2(row.fieldP10 - row.bakedP10).padStart(6)} ${f2(row.fieldMedian - row.bakedMedian).padStart(6)} ${f2(row.fieldP90 - row.bakedP90).padStart(6)}`
    );
  }
  console.log("");
  console.log(
    `bytes: baked=${m.bytes.bakedBytes}  fieldAveraged=${m.bytes.fieldAveragedBytes}  ratio=${m.bytes.ratio.toFixed(1)}x  ` +
      `fieldBytes/team=${m.bytes.fieldBytesPerTeam.toFixed(1)}  baked schedules block=${(m.bytes.bakedSchedulesFraction * 100).toFixed(1)}% of baked`
  );
  console.log(
    `Additivity residual (predicted alliance score minus the sum of its members' totals), over ${m.residual.allianceCount} alliances: ` +
      `mean=${m.residual.mean.toFixed(3)}  sd=${m.residual.sd.toFixed(3)}  max|.|=${m.residual.maxAbs.toFixed(3)}   ` +
      `as a fraction of the model's own score uncertainty (sqrt(meanOfBandVariances * ${ALLIANCE_SIZE}) = ${m.residual.scoreUncertainty.toFixed(3)}): ` +
      `mean=${m.residual.meanFraction.toFixed(3)}  sd=${m.residual.sdFraction.toFixed(3)}  max=${m.residual.maxAbsFraction.toFixed(3)}`
  );
  console.log(
    "Additivity assumption: a large residual STANDARD DEVIATION is the first thing to examine if the band-edge (clause 2) or systematic-shift (clause 3) clauses fail."
  );
  console.log(
    `diagnostics (NOT part of the criterion, and never used to overrule it): mean season-total RP per team — baked=${m.bakedMeanSeasonRp.toFixed(2)} fieldAveraged=${m.fieldMeanSeasonRp.toFixed(2)}; ` +
      `mean band width (p90-p10) — baked=${m.bakedMeanBandWidth.toFixed(2)} fieldAveraged=${m.fieldMeanBandWidth.toFixed(2)}`
  );
  const pctOf = (x: number): string => `${(x * 100).toFixed(1)}%`;
  console.log(
    `BINDING floor at ${m.scheduleCount} schedules (the baked construction against an independent replicate of ITSELF — the ceiling ANY method faces at this count): ` +
      `clause-1 ${pctOf(m.resampling.withinTightRate)} of teams within ${CLAUSE_1_MEDIAN_TIGHT}, mean |dmedian| ${m.resampling.meanAbsMedianDiff.toFixed(3)}, worst team ${m.resampling.maxAbsMedianDiff.toFixed(2)}; ` +
      `clause-2 edges p10 ${pctOf(m.resampling.p10WithinRate)} / p90 ${pctOf(m.resampling.p90WithinRate)}`
  );
  console.log(
    `edge-noise floor at ${m.scheduleCount} schedules (draw-only, band edges): p10 ${pctOf(m.edges.p10WithinRate)} / p90 ${pctOf(m.edges.p90WithinRate)}, mean |dp10| ${m.edges.meanAbsP10Diff.toFixed(3)} / |dp90| ${m.edges.meanAbsP90Diff.toFixed(3)}`
  );
  console.log(
    `draw-only seed-noise floor (DOES NOT BIND — it holds the priced schedules fixed, so it understates what a candidate must survive): ` +
      `clause-1 ${pctOf(m.noise.withinTightRate)}, mean |dmedian| ${m.noise.meanAbsMedianDiff.toFixed(3)}, worst team ${m.noise.maxAbsMedianDiff.toFixed(2)}`
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export async function main(argv: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      events: { type: "string" },
      "replay-from": { type: "string" },
      algorithm: { type: "string" },
      draws: { type: "string" },
      schedules: { type: "string" },
      seed: { type: "string" },
      "write-doc": { type: "boolean", default: false },
    },
  });

  const selected = values.events?.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  const targets =
    selected === undefined
      ? DEFAULT_TARGET_EVENTS
      : selected.map((eventKey) => {
          const known = DEFAULT_TARGET_EVENTS.find((t) => t.eventKey === eventKey);
          if (known === undefined) {
            throw new Error(
              `measureFieldAveragedRanks: "${eventKey}" is not in DEFAULT_TARGET_EVENTS, so no pinned season/roster/qual expectation exists to re-assert against. Add it to the table first.`
            );
          }
          return known;
        });

  const draws = values.draws === undefined ? DEFAULT_DRAWS : Number(values.draws);
  const algorithmId = values.algorithm ?? DEFAULT_ALGORITHM_ID;
  const algorithm = BASE_PUBLISH_ALGORITHMS[algorithmId];
  if (algorithm === undefined) throw new Error(`measureFieldAveragedRanks: unknown algorithm "${algorithmId}"`);
  const replayFromOpt = values["replay-from"] === undefined ? undefined : Number(values["replay-from"]);
  // Raw flag value, `undefined` when `--schedules` is absent; distinct from the resolved count.
  const scheduleCountFlag = values.schedules === undefined ? undefined : Number(values.schedules);

  // Resolved here too, so an invalid --schedules throws before any replay.
  const split = resolveScheduleSplit(draws, scheduleCountFlag);

  console.log("measureFieldAveragedRanks — rung 1 vs the BAKED path, at the schedule count printed below");
  console.log(
    `algorithm=${algorithm.id}@${algorithm.version}  draws=${draws} total  schedules=${split.scheduleCount}  drawsPerSchedule=${split.drawsPerSchedule}  events=${targets.map((t) => t.eventKey).join(", ")}`
  );
  console.log("Both arms pass through the SAME imported simulateRanks and the SAME imported continuousQuantile. The arms differ only in the pmf inputs.");

  const db: Corpus = openCorpusReadOnly(CORPUS_PATH);
  const measurements: EventMeasurement[] = [];
  try {
    const bySeason = new Map<number, TargetEvent[]>();
    for (const t of targets) {
      const list = bySeason.get(t.season) ?? [];
      list.push(t);
      bySeason.set(t.season, list);
    }
    for (const [season, seasonTargets] of [...bySeason.entries()].sort((a, b) => a[0] - b[0])) {
      const replayFrom = replayFromOpt ?? season;
      console.log(`\nmeasureFieldAveragedRanks: replaying season ${season} (from ${replayFrom})...`);
      const replay = replaySeason(db, algorithm, season, replayFrom, new Set(seasonTargets.map((t) => t.eventKey)));
      for (const target of seasonTargets) {
        const m = measureEvent(db, algorithm, target, replay, { draws, algorithmId: algorithm.id, replayFrom, scheduleCount: scheduleCountFlag });
        measurements.push(m);
        printEvent(m);
      }
    }
  } finally {
    db.close();
  }

  const rosterSizes = measurements.map((m) => m.rosterSize);
  const pooledRows = measurements.flatMap((m) => m.rows);
  console.log("");
  console.log(
    `SAMPLE: ${measurements.length} event(s) [${measurements.map((m) => `${m.eventKey}(${m.season})`).join(", ")}], ` +
      `roster sizes ${Math.min(...rosterSizes)}-${Math.max(...rosterSizes)}, pooled team count ${pooledRows.length} ` +
      `(= the sum of the sampled roster sizes: ${rosterSizes.join(" + ")})`
  );

  const verdict = evaluateRungOneCriterion(pooledRows);
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
  console.log("");
  console.log("--- THE RUNG-1 ACCEPTANCE CRITERION, fixed before this measurement existed and unchanged after it ---");
  console.log("");
  console.log("per-event clause rates (printed so a single bad event cannot hide inside the pool; the CLAUSES are evaluated POOLED):");
  // `candidate / binding floor` per event. Printed here, not in `printEvent`,
  // because the clause rates need the whole sample.
  for (const e of verdict.perEvent) {
    const m = measurements.find((x) => x.eventKey === e.eventKey)!;
    console.log(
      `  ${e.eventKey.padEnd(11)} teams=${String(e.teamCount).padStart(3)}  clause1 rate=${pct(e.tightRate).padStart(6)} / binding floor ${pct(m.resampling.withinTightRate).padStart(6)}  ` +
        `p10=${pct(e.p10Rate).padStart(6)} / ${pct(m.resampling.p10WithinRate).padStart(6)}  p90=${pct(e.p90Rate).padStart(6)} / ${pct(m.resampling.p90WithinRate).padStart(6)}  ` +
        `mean signed median shift=${e.meanSignedMedianDiff.toFixed(3)}`
    );
  }
  console.log("");
  const scheduleCount = measurements[0]!.scheduleCount;
  const bindingC1 = rosterWeighted(measurements, (m) => m.resampling.withinTightRate);
  const bindingP10 = rosterWeighted(measurements, (m) => m.resampling.p10WithinRate);
  const bindingP90 = rosterWeighted(measurements, (m) => m.resampling.p90WithinRate);
  const bindingMeanAbs = rosterWeighted(measurements, (m) => m.resampling.meanAbsMedianDiff);
  const bindingWorst = Math.max(...measurements.map((m) => m.resampling.maxAbsMedianDiff));
  const edgeP10 = rosterWeighted(measurements, (m) => m.edges.p10WithinRate);
  const edgeP90 = rosterWeighted(measurements, (m) => m.edges.p90WithinRate);

  console.log(
    `  CLAUSE 1 (median rank): ${verdict.clause1.pass ? "PASS" : "FAIL"} — ${pct(verdict.clause1.tightRate)} of ${verdict.teamCount} teams within ${CLAUSE_1_MEDIAN_TIGHT} ranks (needs >= ${pct(CLAUSE_1_TIGHT_RATE)}); ` +
      `every team within ${CLAUSE_1_MEDIAN_HARD}: ${verdict.clause1.everyTeamWithinHard}; worst single team ${verdict.clause1.worstTeamKey} at ${verdict.clause1.worstEventKey}, |diff| ${verdict.clause1.worstAbsMedianDiff.toFixed(2)}`
  );
  console.log(
    `                          CANDIDATE ${pct(verdict.clause1.tightRate)} vs BINDING FLOOR ${pct(bindingC1)} at ${scheduleCount} schedules — worst team, candidate ${verdict.clause1.worstAbsMedianDiff.toFixed(2)} vs floor ${bindingWorst.toFixed(2)} ranks; floor mean |dmedian| ${bindingMeanAbs.toFixed(3)}, pooled 95th pct ${pooledBindingQ95(measurements).toFixed(3)}`
  );
  console.log(
    `  CLAUSE 2 (band edges):  ${verdict.clause2.pass ? "PASS" : "FAIL"} — p10 ${pct(verdict.clause2.p10Rate)}, p90 ${pct(verdict.clause2.p90Rate)} within ${CLAUSE_2_EDGE_TOLERANCE} ranks (needs >= ${pct(CLAUSE_2_RATE)} on BOTH)`
  );
  console.log(
    `                          CANDIDATE ${pct(verdict.clause2.p10Rate)}/${pct(verdict.clause2.p90Rate)} vs BINDING FLOOR ${pct(bindingP10)}/${pct(bindingP90)}; draw-only edge floor ${pct(edgeP10)}/${pct(edgeP90)} (does not bind)`
  );
  console.log(
    `  CLAUSE 3 (no shift):    ${verdict.clause3.pass ? "PASS" : "FAIL"} — mean SIGNED median difference ${verdict.clause3.meanSignedMedianDiff.toFixed(4)} ranks (allows +/-${CLAUSE_3_MEAN_SHIFT})`
  );
  console.log("");
  console.log(
    `  BINDING floor, pooled and roster-weighted, at ${scheduleCount} schedules (${measurements[0]!.drawsPerSchedule} draws each): the baked construction built TWICE with independent ` +
      `shuffle-and-draw streams agrees with ITSELF on ${pct(bindingC1)} of teams within ${CLAUSE_1_MEDIAN_TIGHT} ranks; worst team ${bindingWorst.toFixed(2)} ranks. ` +
      `THIS is the ceiling any method faces at this count, and the number the candidate above must be read against.`
  );
  console.log(
    `  draw-only seed-noise floor (DIAGNOSTIC, and it DOES NOT BIND — it holds the priced schedules fixed while a candidate arm draws its own shuffles too, so it understates the ceiling): ` +
      `the BAKED arm re-simulated at two seeds agrees with ITSELF on ${pct(rosterWeighted(measurements, (m) => m.noise.withinTightRate))} of teams within ${CLAUSE_1_MEDIAN_TIGHT} ranks, ` +
      `mean |median difference| ${rosterWeighted(measurements, (m) => m.noise.meanAbsMedianDiff).toFixed(3)} ranks`
  );
  console.log("");
  console.log(verdict.pass ? "PASS" : "FAIL");

  if (values["write-doc"] === true) {
    writeFileSync(FIELD_AVERAGED_DOC_PATH, renderDoc(measurements, verdict, `${algorithm.id}@${algorithm.version}`), "utf8");
    console.log(`
wrote ${FIELD_AVERAGED_DOC_PATH}`);
  }
}

/**
 * The seed-noise floor: the baked arm's own priced schedules re-simulated at two
 * non-published seeds, so the whole difference is the draw stream. It tells a
 * reader whether finite draws can resolve half a rank; it is never part of the
 * criterion and never overrules it.
 */
export interface SeedNoiseFloor {
  /** Fraction of teams whose median rank moved by at most `CLAUSE_1_MEDIAN_TIGHT` between two seeds of the SAME arm. */
  readonly withinTightRate: number;
  readonly meanAbsMedianDiff: number;
  readonly maxAbsMedianDiff: number;
}

export function measureSeedNoiseFloor(
  artifact: PreScheduleArtifact,
  draws: number
): SeedNoiseFloor {
  const roster = artifact.roster;
  const baselines: SimTeamBaseline[] = roster.map((teamKey) => ({ teamKey, earnedRpSum: 0, matchesPlayed: 0 }));
  const drawsPerSchedule = Math.max(1, Math.round(draws / artifact.schedules.length));
  const totalsA = roster.map(() => new Array<number>(roster.length).fill(0));
  const totalsB = roster.map(() => new Array<number>(roster.length).fill(0));
  for (const [k, schedule] of artifact.schedules.entries()) {
    const inputs: SimMatchInput[] = schedule.matches.map((m) => ({
      redTeamKeys: m.r.map((i) => roster[i]!),
      blueTeamKeys: m.b.map((i) => roster[i]!),
      redRpPmf: m.rp,
      blueRpPmf: m.bp,
    }));
    // Two streams, neither the published one, so the sides are symmetric.
    const a = simulateRanks(inputs, baselines, drawsPerSchedule, mulberry32(schedule.seed ^ 0x5a5a5a5a));
    const b = simulateRanks(inputs, baselines, drawsPerSchedule, mulberry32(schedule.seed ^ 0x3c3c3c3c));
    for (let t = 0; t < roster.length; t++) {
      const ha = a.rankHistograms.get(roster[t]!)!;
      const hb = b.rankHistograms.get(roster[t]!)!;
      for (let rank = 0; rank < roster.length; rank++) {
        totalsA[t]![rank]! += ha[rank]!;
        totalsB[t]![rank]! += hb[rank]!;
      }
    }
    void k;
  }
  const diffs = roster.map((_, t) =>
    Math.abs(continuousQuantile(totalsA[t]!, 0.5, draws) - continuousQuantile(totalsB[t]!, 0.5, draws))
  );
  return {
    withinTightRate: diffs.filter((d) => d <= CLAUSE_1_MEDIAN_TIGHT).length / diffs.length,
    meanAbsMedianDiff: diffs.reduce((a, b) => a + b, 0) / diffs.length,
    maxAbsMedianDiff: Math.max(...diffs),
  };
}

// ---------------------------------------------------------------------------
// The measurement record, written by the script
// ---------------------------------------------------------------------------

/** Renders `docs/models/field-averaged-presim.md`; the script writes it so figures are never hand-transcribed. */
export function renderDoc(measurements: readonly EventMeasurement[], verdict: RungOneVerdict, algorithmLabel: string): string {
  const rosterSizes = measurements.map((m) => m.rosterSize);
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

  // Counts are read from the measurements, never passed in, so the label cannot
  // disagree with what was measured; a mixed sample throws.
  const scheduleCount = measurements[0]!.scheduleCount;
  const drawsPerSchedule = measurements[0]!.drawsPerSchedule;
  for (const m of measurements) {
    if (m.scheduleCount !== scheduleCount || m.drawsPerSchedule !== drawsPerSchedule) {
      throw new Error(
        `measureFieldAveragedRanks: renderDoc was handed a sample measured at more than one schedule split (${m.eventKey} is ${m.scheduleCount}x${m.drawsPerSchedule}, the first event is ${scheduleCount}x${drawsPerSchedule}). One document records one count.`
      );
    }
  }
  const bindingC1 = rosterWeighted(measurements, (m) => m.resampling.withinTightRate);
  const bindingP10 = rosterWeighted(measurements, (m) => m.resampling.p10WithinRate);
  const bindingP90 = rosterWeighted(measurements, (m) => m.resampling.p90WithinRate);
  const bindingMeanAbs = rosterWeighted(measurements, (m) => m.resampling.meanAbsMedianDiff);
  const bindingWorst = Math.max(...measurements.map((m) => m.resampling.maxAbsMedianDiff));
  const bindingQ95 = pooledBindingQ95(measurements);
  const edgeP10 = rosterWeighted(measurements, (m) => m.edges.p10WithinRate);
  const edgeP90 = rosterWeighted(measurements, (m) => m.edges.p90WithinRate);
  const drawOnlyC1 = rosterWeighted(measurements, (m) => m.noise.withinTightRate);

  const block = {
    verdict: verdict.pass ? "PASS" : "FAIL",
    algorithm: algorithmLabel,
    scheduleCount,
    drawsPerSchedule,
    totalDraws: scheduleCount * drawsPerSchedule,
    eventCount: verdict.eventCount,
    teamCount: verdict.teamCount,
    minRosterSize: Math.min(...rosterSizes),
    maxRosterSize: Math.max(...rosterSizes),
    clause1: {
      pass: verdict.clause1.pass,
      tightRate: Number(verdict.clause1.tightRate.toFixed(4)),
      requiredTightRate: CLAUSE_1_TIGHT_RATE,
      everyTeamWithinHard: verdict.clause1.everyTeamWithinHard,
      worstAbsMedianDiff: Number(verdict.clause1.worstAbsMedianDiff.toFixed(3)),
      worstTeamKey: verdict.clause1.worstTeamKey,
      worstEventKey: verdict.clause1.worstEventKey,
    },
    clause2: {
      pass: verdict.clause2.pass,
      p10Rate: Number(verdict.clause2.p10Rate.toFixed(4)),
      p90Rate: Number(verdict.clause2.p90Rate.toFixed(4)),
      requiredRate: CLAUSE_2_RATE,
    },
    clause3: {
      pass: verdict.clause3.pass,
      meanSignedMedianDiff: Number(verdict.clause3.meanSignedMedianDiff.toFixed(4)),
      tolerance: CLAUSE_3_MEAN_SHIFT,
    },
    bytes: measurements.map((m) => ({
      eventKey: m.eventKey,
      baked: m.bytes.bakedBytes,
      fieldAveraged: m.bytes.fieldAveragedBytes,
      ratio: Number(m.bytes.ratio.toFixed(1)),
      bakedSchedulesFraction: Number(m.bytes.bakedSchedulesFraction.toFixed(4)),
    })),
    additivityResidualAFA1: measurements.map((m) => ({
      eventKey: m.eventKey,
      mean: Number(m.residual.mean.toFixed(6)),
      sd: Number(m.residual.sd.toFixed(6)),
      maxAbs: Number(m.residual.maxAbs.toFixed(6)),
      asFractionOfScoreUncertainty: Number(m.residual.sdFraction.toFixed(6)),
    })),
    /** The binding floor, per event and pooled, at the candidate's schedule count. */
    bindingResamplingFloor: {
      pooledWithinTightRate: Number(bindingC1.toFixed(4)),
      pooledP10WithinRate: Number(bindingP10.toFixed(4)),
      pooledP90WithinRate: Number(bindingP90.toFixed(4)),
      pooledMeanAbsMedianDiff: Number(bindingMeanAbs.toFixed(3)),
      pooled95thPctAbsMedianDiff: Number(bindingQ95.toFixed(3)),
      worstTeamAbsMedianDiff: Number(bindingWorst.toFixed(3)),
      perEvent: measurements.map((m) => ({
        eventKey: m.eventKey,
        withinTightRate: Number(m.resampling.withinTightRate.toFixed(4)),
        meanAbsMedianDiff: Number(m.resampling.meanAbsMedianDiff.toFixed(3)),
        maxAbsMedianDiff: Number(m.resampling.maxAbsMedianDiff.toFixed(3)),
        p10WithinRate: Number(m.resampling.p10WithinRate.toFixed(4)),
        p90WithinRate: Number(m.resampling.p90WithinRate.toFixed(4)),
      })),
    },
    /** Clause 2's draw-only control on the band edges. */
    edgeNoiseFloor: {
      pooledP10WithinRate: Number(edgeP10.toFixed(4)),
      pooledP90WithinRate: Number(edgeP90.toFixed(4)),
      perEvent: measurements.map((m) => ({
        eventKey: m.eventKey,
        p10WithinRate: Number(m.edges.p10WithinRate.toFixed(4)),
        p90WithinRate: Number(m.edges.p90WithinRate.toFixed(4)),
        meanAbsP10Diff: Number(m.edges.meanAbsP10Diff.toFixed(3)),
        meanAbsP90Diff: Number(m.edges.meanAbsP90Diff.toFixed(3)),
      })),
    },
    /** Draw-only; not the binding floor, because it holds the priced schedules fixed. */
    seedNoiseFloor: {
      pooledWithinTightRate: Number(drawOnlyC1.toFixed(4)),
      binds: false,
      perEvent: measurements.map((m) => ({
        eventKey: m.eventKey,
        withinTightRate: Number(m.noise.withinTightRate.toFixed(4)),
        meanAbsMedianDiff: Number(m.noise.meanAbsMedianDiff.toFixed(3)),
      })),
    },
  };

  const lines: string[] = [];
  lines.push(
    `# Field-averaged pre-schedule prediction — rung 1 measured against the ${scheduleCount.toLocaleString("en-US")}-schedule baked path`
  );
  lines.push("");
  lines.push(
    `**Measured at ${scheduleCount.toLocaleString("en-US")} schedules × ${drawsPerSchedule} draws = ${(scheduleCount * drawsPerSchedule).toLocaleString(
      "en-US"
    )} total draws per arm.** Every figure in this document is a figure AT THAT COUNT and at no other. A rank tolerance is only meaningful relative to the measurement's own resolution, so the binding noise floor at the same count is quoted beside every candidate rate below rather than left to be looked up.`
  );
  lines.push("");
  lines.push(
    `**${verdict.pass ? "PASS" : "FAIL"}.** Across ${verdict.eventCount} real finished events (${verdict.teamCount} teams, every team of every event scored, roster sizes ${Math.min(
      ...rosterSizes
    )}-${Math.max(...rosterSizes)}), the field-averaged predictor's rank bands agree with the ${scheduleCount.toLocaleString("en-US")}-schedule baked path's ` +
      `on ${pct(verdict.clause1.tightRate)} of teams within half a rank of median — **against a binding floor of ${pct(bindingC1)} at the same count** — where clause 1 needs ${pct(
        CLAUSE_1_TIGHT_RATE
      )}; ` +
      `on ${pct(verdict.clause2.p10Rate)}/${pct(verdict.clause2.p90Rate)} of teams within one rank at the p10/p90 band edges — **against binding floors of ${pct(bindingP10)}/${pct(
        bindingP90
      )}** — where clause 2 needs ${pct(CLAUSE_2_RATE)}; ` +
      `with a mean signed median shift of ${verdict.clause3.meanSignedMedianDiff.toFixed(3)} ranks (clause 3 allows ±${CLAUSE_3_MEAN_SHIFT}). ` +
      `Worst single team: candidate ${verdict.clause1.worstAbsMedianDiff.toFixed(2)} ranks against a floor whose own worst team moves ${bindingWorst.toFixed(2)} ranks between two runs of the IDENTICAL construction.`
  );
  lines.push("");
  lines.push(
    `**The binding floor is the baked construction built TWICE**, with fully independent shuffle-and-draw streams at ${scheduleCount.toLocaleString(
      "en-US"
    )} schedules, obtained by salting \`algorithmVersion\` — which \`buildPreScheduleArtifact\` uses for seed hashing and nothing else. Pricing is the same bound \`predict\` closure on both sides. ` +
      `It is the ceiling **any** method faces at this count, including the one that ships. A candidate scored against a clause the measurement itself cannot resolve is scoring noise, which is why this document quotes the two together. ` +
      `Like every floor on this project it is a **diagnostic**: it may explain a verdict, never overrule one. The criterion's thresholds are unchanged and were fixed before any measurement existed.`
  );
  lines.push("");
  lines.push(
    "**This document is WRITTEN BY `scripts/measureFieldAveragedRanks.ts --write-doc`, not transcribed from its terminal output.** " +
      "That is deliberate: on this project `publish:seasons` prints a payload-budget summary it does not write, and the budget tests stay red until a human copies the numbers across. This record does not reproduce that trap."
  );
  lines.push("");
  lines.push("```json field-averaged-presim");
  lines.push(JSON.stringify(block, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## The criterion, fixed before the measurement");
  lines.push("");
  lines.push(
    "Encoded as named constants in the measurement script before the run. No threshold was changed after the run."
  );
  lines.push("");
  lines.push(
    `1. **Median rank:** \`|median_rung1 − median_baked| ≤ ${CLAUSE_1_MEDIAN_TIGHT}\` ranks for **≥ ${pct(CLAUSE_1_TIGHT_RATE)}** of teams, and \`≤ ${CLAUSE_1_MEDIAN_HARD}\` ranks for **every** team.`
  );
  lines.push(
    `2. **Band edges:** \`|p10 diff| ≤ ${CLAUSE_2_EDGE_TOLERANCE}\` **and** \`|p90 diff| ≤ ${CLAUSE_2_EDGE_TOLERANCE}\` ranks for **≥ ${pct(CLAUSE_2_RATE)}** of teams.`
  );
  lines.push(`3. **No systematic shift:** the **mean signed** median-rank difference is within \`±${CLAUSE_3_MEAN_SHIFT}\` ranks.`);
  lines.push("");
  lines.push(
    "Clause 1 is evaluated **pooled across the whole sample**, not per event — a recorded reading fixed before the run, because a per-event 95% on a 22-team roster rounds to a materially stricter bar than the sentence says. The per-event breakdown is printed below so a single bad event cannot hide inside the pool."
  );
  lines.push("");
  lines.push(
    `Both arms were produced by the **same imported \`simulateRanks\`** and the **same imported \`continuousQuantile\`**, from one replay and one model state per event. The arms differ only in the pmf inputs, never in the scorer.`
  );
  lines.push("");
  lines.push("## Verdict");
  lines.push("");
  lines.push(`| Clause | Outcome | Achieved | **Binding floor at ${scheduleCount.toLocaleString("en-US")} schedules** | Required |`);
  lines.push("|---|---|---|---|---|");
  lines.push(
    `| 1 — median rank | ${verdict.clause1.pass ? "PASS" : "FAIL"} | ${pct(verdict.clause1.tightRate)} within ${CLAUSE_1_MEDIAN_TIGHT}; every team within ${CLAUSE_1_MEDIAN_HARD}: ${verdict.clause1.everyTeamWithinHard} | **${pct(bindingC1)}** | ≥ ${pct(CLAUSE_1_TIGHT_RATE)} and every team |`
  );
  lines.push(
    `| 2 — band edges | ${verdict.clause2.pass ? "PASS" : "FAIL"} | p10 ${pct(verdict.clause2.p10Rate)}, p90 ${pct(verdict.clause2.p90Rate)} | **${pct(bindingP10)} / ${pct(bindingP90)}** | ≥ ${pct(CLAUSE_2_RATE)} on both |`
  );
  lines.push(
    `| 3 — systematic shift | ${verdict.clause3.pass ? "PASS" : "FAIL"} | ${verdict.clause3.meanSignedMedianDiff.toFixed(3)} ranks | — (a signed mean has no same-construction ceiling of this form) | within ±${CLAUSE_3_MEAN_SHIFT} |`
  );
  lines.push("");
  lines.push(
    `Worst single team: **${verdict.clause1.worstTeamKey}** at **${verdict.clause1.worstEventKey}**, median difference ${verdict.clause1.worstAbsMedianDiff.toFixed(2)} ranks. ` +
      `The binding floor's own worst team moves **${bindingWorst.toFixed(2)}** ranks between two runs of the identical construction, with a pooled mean \`|Δmedian|\` of ${bindingMeanAbs.toFixed(
        3
      )} and a pooled 95th percentile of ${bindingQ95.toFixed(3)} ranks (clause 1 is satisfiable exactly when that 95th percentile falls to ${CLAUSE_1_MEDIAN_TIGHT}).`
  );
  lines.push("");
  lines.push("## Per event");
  lines.push("");
  lines.push(
    "Each rate is read **candidate / binding floor** at the same schedule count, so the gap between a verdict and the measurement's own resolution can be attributed by reading one row."
  );
  lines.push("");
  lines.push("| Event | Season | Teams | Quals | Matches/team | Replay | Clause-1 rate | p10 rate | p90 rate | Mean signed median shift |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const m of measurements) {
    const e = verdict.perEvent.find((x) => x.eventKey === m.eventKey)!;
    lines.push(
      `| \`${m.eventKey}\` | ${m.season} | ${m.rosterSize} | ${m.qualCount} | ${m.matchesPerTeam} | ${m.replayMode} | ${pct(e.tightRate)} / **${pct(
        m.resampling.withinTightRate
      )}** | ${pct(e.p10Rate)} / **${pct(m.resampling.p10WithinRate)}** | ${pct(e.p90Rate)} / **${pct(m.resampling.p90WithinRate)}** | ${e.meanSignedMedianDiff.toFixed(3)} |`
    );
  }
  lines.push("");
  lines.push("## Artifact size");
  lines.push("");
  lines.push(
    `**Measured at ${scheduleCount.toLocaleString("en-US")} schedules, which is ${
      scheduleCount === DEFAULT_SCHEDULE_COUNT
        ? "the shipped count — these baked figures ARE the shipped artifact's"
        : `NOT the shipped count (${DEFAULT_SCHEDULE_COUNT}). The baked column below is therefore roughly ${Math.round(
            scheduleCount / DEFAULT_SCHEDULE_COUNT
          )}× the size of the artifact that actually ships, because the priced \`schedules\` block scales with the count. Read the RATIO as an artefact of this measurement's count, not as a shipping figure`
    }.** The field-averaged column does not depend on the schedule count at all — it carries no schedules — so it is the same artifact at every count.`
  );
  lines.push("");
  lines.push("| Event | Baked bytes | Field-averaged bytes | Ratio | Field bytes/team | Baked `schedules` block |");
  lines.push("|---|---|---|---|---|---|");
  for (const m of measurements) {
    lines.push(
      `| \`${m.eventKey}\` | ${m.bytes.bakedBytes.toLocaleString("en-US")} | ${m.bytes.fieldAveragedBytes.toLocaleString("en-US")} | ${m.bytes.ratio.toFixed(1)}× | ${m.bytes.fieldBytesPerTeam.toFixed(1)} | ${pct(m.bytes.bakedSchedulesFraction)} |`
    );
  }
  lines.push("");
  lines.push(
    "The `schedules` fraction is **computed from the artifacts measured here**, not quoted from `docs/simulation-architecture.md`'s recorded 95.4%."
  );
  lines.push("");
  lines.push("## The additivity assumption — its residual, measured");
  lines.push("");
  lines.push(
    "The score half of the field-averaged construction rests on `allianceScore = Σ member totals + C`, under which the per-season additive constant cancels out of the mean score difference. Measured rather than asserted: for every played qualification match of every sampled event, the residual `predict(match).redScore − Σ member totals` (and the blue counterpart)."
  );
  lines.push("");
  lines.push("| Event | Alliances | Mean | SD | Max abs | SD as a fraction of the model's own score uncertainty |");
  lines.push("|---|---|---|---|---|---|");
  for (const m of measurements) {
    lines.push(
      `| \`${m.eventKey}\` | ${m.residual.allianceCount} | ${m.residual.mean.toFixed(4)} | ${m.residual.sd.toFixed(4)} | ${m.residual.maxAbs.toFixed(4)} | ${m.residual.sdFraction.toFixed(4)} |`
    );
  }
  lines.push("");
  lines.push("## Diagnostics (not part of the criterion, and never used to overrule it)");
  lines.push("");
  lines.push(
    "**Two floors, and only one of them binds.** The **binding** floor (the one every rate above is quoted against) builds the baked construction TWICE with independent shuffle-and-draw streams: a candidate arm draws its own K shuffles, so the disagreement it has to survive includes *which K shuffles each side happened to draw*. The **draw-only** floor holds the priced schedules fixed and varies only the draw stream. Holding the shuffles fixed understates the ceiling — visibly so in the columns below — which is why the draw-only column is retained as a diagnostic and is **not** what any verdict is read against. Neither may overrule the criterion."
  );
  lines.push("");
  lines.push(
    "| Event | Mean season RP/team (baked) | (field-avg) | Mean band width (baked) | (field-avg) | **Binding floor: teams within 0.5** | binding mean \\|Δmedian\\| | binding worst team | Draw-only floor (does not bind) |"
  );
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const m of measurements) {
    lines.push(
      `| \`${m.eventKey}\` | ${m.bakedMeanSeasonRp.toFixed(2)} | ${m.fieldMeanSeasonRp.toFixed(2)} | ${m.bakedMeanBandWidth.toFixed(2)} | ${m.fieldMeanBandWidth.toFixed(2)} | **${pct(
        m.resampling.withinTightRate
      )}** | ${m.resampling.meanAbsMedianDiff.toFixed(3)} | ${m.resampling.maxAbsMedianDiff.toFixed(2)} | ${pct(m.noise.withinTightRate)} (mean ${m.noise.meanAbsMedianDiff.toFixed(2)}) |`
    );
  }
  lines.push(
    `| **POOLED** (roster-weighted) | — | — | — | — | **${pct(bindingC1)}** | ${bindingMeanAbs.toFixed(3)} | ${bindingWorst.toFixed(2)} | ${pct(drawOnlyC1)} |`
  );
  lines.push("");
  lines.push(
    `A systematic season-RP difference points at the moments construction; a systematic band-width difference points at the composition-spread terms. Clause 2 has its own **edge-noise** control, because the p10/p90 band edges are estimated from the tails of the same finite draw count and carry different noise than the median: pooled **${pct(
      edgeP10
    )} / ${pct(edgeP90)}** (draw-only), against the binding floor's **${pct(bindingP10)} / ${pct(bindingP90)}**.`
  );
  lines.push("");
  lines.push("## Caveats");
  lines.push("");
  lines.push(
    "- **A team's matches are assumed near-independent.** Partners differ each match, which is what makes the assumption reasonable, but the matches of one event are not literally independent draws."
  );
  lines.push(
    `- **Coupling from teams that share specific matches is washed out** — two teams scheduled against each other have correlated outcomes and nothing in the field-averaged form represents that. **And the baked arm washes that same coupling out by design**, averaging over ${scheduleCount.toLocaleString("en-US")} independent shuffles precisely so no particular pairing survives into the published band. It is a shared property of both forms, not a defect unique to the new one.`
  );
  lines.push(
    "- **The composition-induced spread is treated as Gaussian** — the same approximation class used elsewhere in this pipeline, and the one this pre-schedule design names and accepts. The exact mixture over all partner pairs crossed with all opposing triples is computable and is deliberately not computed: roughly 5.7 million `analyticRpPmf` calls per team on a 40-team roster."
  );
  lines.push(
    "- **The additivity assumption** is measured above rather than asserted. A large residual standard deviation is the first thing to examine if clause 2 or clause 3 fails."
  );
  lines.push(
    `- **The replay-mode assumption.** Each event's season was replayed in the mode printed in the per-event table above. Both arms read the SAME state, so the comparison stays internally valid either way; the mode is recorded because a cold replay makes the baked arm non-identical to the production sidecar.`
  );
  lines.push(
    "- **Neither arm is validated against realised rankings here.** This measures agreement between two forecasts, not the accuracy of either. The rewind-honesty question is `docs/models/rewind-overconfidence-gap.md`'s."
  );
  lines.push("");
  return lines.join("\n") + "\n";
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
