/**
 * D-16/D-17's rung-1 measurement (plan 09-09): does the FIELD-AVERAGED
 * pre-schedule predictor reproduce the rank bands the 20-schedule BAKED path
 * produces, on real finished events?
 *
 * THE TWO ARMS, PRECISELY.
 *
 *   `baked` — today's shipped path: 20 synthetic qualification schedules
 *   drawn from the licensed cheesy-arena template grid, every synthetic match
 *   priced through the real RP path by `makeRankingPointFiller` (imported from
 *   `packages/harness/publish.ts`, the publisher's OWN closure, not a
 *   re-creation of it), and a rank distribution baked over all 20 by
 *   `buildPreScheduleArtifact`.
 *
 *   `fieldAveraged` — rung 1: no schedule anywhere. The event's roster is
 *   summarised into field-level statistics (the mean AND the variance of
 *   per-team contributions across that roster), each team's field-averaged
 *   per-match pmf is built from its own belief plus those statistics through
 *   the SAME `analyticRpPmf` every real match runs, and its season total is an
 *   exact `convolvePmf` of `matchesPerTeam` copies of it.
 *
 * Both arms pass through the SAME imported `simulateRanks`
 * (`packages/core/algorithms/simulation/rankSimulation.ts`) and the SAME
 * imported `continuousQuantile` (`apps/web/src/lib/simQuantile.ts`) — never
 * reimplemented, wrapped, or approximated here. The arms differ ONLY in the
 * pmf inputs handed to the simulator, never in the scorer. That is
 * `measureRewindGap.ts`'s own convention and the same-scorer discipline D-11
 * imposes on the RP side, and it is not ceremony: a scorer mismatch has
 * previously manufactured a ~0.003 phantom regression on this project.
 *
 * Both arms also come from ONE replay, ONE model state and ONE
 * `SigmaScoutLayer` per event — the instants are exactly the publisher's own
 * (pre-event walk-forward pricing state, season-final accumulator and
 * consistency map), so the baked arm this measures is the sidecar the
 * publisher would write.
 *
 * ---------------------------------------------------------------------------
 * NO CREDENTIAL, NO NETWORK, NO WRITE TO THE CORPUS
 * ---------------------------------------------------------------------------
 *
 * This script reads `data/corpus.sqlite` READ-ONLY and touches NO credential
 * of any kind: no network request, no R2 client, no D1 access, no environment
 * variable read, and its `package.json` entry deliberately omits the
 * environment-file flag, placing it with `tune`, `promote`, `fingerprint`,
 * `identifiability` and `measure:rewind-gap` — the corpus-only offline
 * scripts. `.env` is never read, printed, copied or interpolated, not even to
 * confirm a key is set. No R2 object is read, written, listed or deleted; no
 * manifest is bumped; no publish command of any kind runs.
 *
 * Standalone-script shape matching `scripts/measureRewindGap.ts`: a long
 * explanatory header, `parseArgs`, `async function main()`, an entry-point
 * guard, deep relative imports with explicit `.js` suffixes.
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
import { matchesPerTeamFor } from "../packages/harness/scheduleTemplates.js";
import {
  buildPreScheduleArtifact,
  buildFieldAveragedPreScheduleArtifact,
  buildFieldContributions,
} from "../packages/harness/preSchedule.js";
import { makeRankingPointFiller } from "../packages/harness/publish.js";
import { ALGORITHMS } from "../packages/harness/cli.js";
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
 * The measurement sample (plan 09-09 `## The measurement sample`). Six real
 * finished events, every one verified against `data/corpus.sqlite` at planning
 * time and RE-ASSERTED at run time — `measureRewindGap.ts`'s own
 * `DEFAULT_TARGET_EVENTS` discipline, so a re-ingest that moved one of these
 * numbers is LOUD rather than silently producing a different measurement under
 * the same document.
 *
 * A recorded fact about "spanning the 6-100 team range": `6-100` is the
 * SCHEDULE-TEMPLATE GRID's coverage, not the corpus's. Across every
 * non-offseason, RP-eligible, fully-played event in the corpus for 2022-2026,
 * observed rosters span 14 to 78 teams — there is no 6-team and no 100-team
 * event to sample. This table spans the observed range end to end, and the
 * script PRINTS the sample's own min and max roster size with the verdict so
 * the span is a reported number rather than a claim.
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

/** BPR is the premier published algorithm and the only one carrying a Sigma Score consistency figure for every team it has seen. */
export const DEFAULT_ALGORITHM_ID = "bpr";

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
// The rung-1 acceptance criterion, encoded as code (plan 09-09 Task 3)
// ---------------------------------------------------------------------------

/**
 * Thrown when the sample is too small to evaluate the criterion at all. The
 * criterion says at least six events; an evaluator that quietly returns `pass`
 * on one event is how a bar gets lowered without anybody deciding to lower it.
 */
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
/** Clause 2: `|p10 diff| <= 1.0` AND `|p90 diff| <= 1.0`. The sketch measurements found the middle 80% of a real rank distribution spans only 1-5 ranks of 17, so a 1-rank band-edge error is already a material fraction of a typical band. */
export const CLAUSE_2_EDGE_TOLERANCE = 1.0;
/** Clause 2: both edge tolerances must hold for at least 90% of teams. */
export const CLAUSE_2_RATE = 0.9;
/** Clause 3: the MEAN SIGNED median-rank difference must lie within +/-0.25 ranks. */
export const CLAUSE_3_MEAN_SHIFT = 0.25;
/** The criterion's own sample requirement: at least six real finished events. */
export const MINIMUM_EVENT_COUNT = 6;

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
 * THE RUNG-1 ACCEPTANCE CRITERION.
 *
 * Quoted verbatim from `09-PLAN-OUTLINE.md` section "Answer to the open
 * question — rung 1's pass/fail bar", reproduced in `09-09-PLAN.md` section
 * `## The rung-1 acceptance criterion`. It was fixed BEFORE any measurement
 * existed. Do not paraphrase it, do not re-derive it, and do not adjust a
 * number in it after seeing a result.
 *
 * > **PLANNER ASSUMPTION (not from CONTEXT.md — recorded because D-17 rung 1
 * > states its bar in prose and RESEARCH.md Open Question 1 / assumption A4
 * > leave the statistic open).** Rung 1 passes when, measured with the **same
 * > `continuousQuantile` p10 / median / p90 rank statistics the live rank-band
 * > display already uses**, across a sample of **at least six real finished
 * > events spanning the 6-100 team template coverage range, with at least one
 * > event per season 2022-2026 where one exists**:
 * >
 * > 1. **Median rank:** `|median_rung1 - median_baked| <= 0.5` ranks for
 * >    **>= 95%** of teams, and `<= 1.0` ranks for **every** team (no
 * >    single-team outlier worse than one rank).
 * > 2. **Band edges:** `|p10_rung1 - p10_baked| <= 1.0` **and**
 * >    `|p90_rung1 - p90_baked| <= 1.0` ranks for **>= 90%** of teams.
 * > 3. **No systematic shift:** the **mean signed** median-rank difference
 * >    across all sampled teams is within `+/-0.25` ranks.
 * >
 * > Both arms must be produced by the **same imported `simulateRanks`** and
 * > the same quantile helper — the arms differ only in the pmf inputs, never
 * > in the scorer (the `measureRewindGap.ts` convention, and the same-scorer
 * > discipline D-11 imposes on the RP side).
 *
 * WHY THESE NUMBERS (outline, same section, reproduced so nobody
 * re-litigates them): the settled display convention is a 10th-90th band
 * printed to ONE DECIMAL PLACE, so `0.5` ranks is the smallest median
 * difference the rendered page can show as distinct; and the sketch
 * measurements found the middle 80% of a real rank distribution spans only
 * 1-5 RANKS OF 17, so a 1-rank band-edge error is already a material fraction
 * of a typical band rather than a rounding artefact. The tolerance is
 * deliberately in RANK UNITS, not probability units, because that is the unit
 * a human reads off the page — an abstract distributional distance
 * (Wasserstein/EMD) nobody will eyeball was considered and rejected.
 *
 * ONE RECORDED READING OF CLAUSE 1, FIXED BEFORE THE RUN SO IT CANNOT BE
 * CHOSEN AFTERWARDS: "`<= 0.5` for >= 95% of teams AND `<= 1.0` for every
 * team" is evaluated POOLED ACROSS THE WHOLE SAMPLE, not per event. A 6-event
 * sample of 30-70 teams each gives roughly 250 teams, and a per-event 95% on a
 * 22-team roster would round to "at most one team may miss", which is a
 * materially stricter bar than the sentence says. The per-event breakdown is
 * still returned and printed, so a single bad event cannot hide inside the
 * pool.
 *
 * TWO THINGS THE CRITERION DELIBERATELY DOES NOT MEASURE, named so their
 * absence is a decision: it says nothing about the two arms agreeing on WHICH
 * team holds a given rank (a permutation-level claim the bands themselves do
 * not make), and it says nothing about either arm being RIGHT about the real
 * event (that is the rewind-honesty question 08-08 already measured; neither
 * arm is validated against realised rankings here).
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

  // --- Clause 3: SIGNED, never absolute. Averaging absolute values here
  // would make clause 3 a fourth copy of clause 1 and stop it detecting the
  // systematic shift it exists to detect. ---
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

/** The A-FA1 additivity residual, measured on one event's played qualification matches. */
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
  /** The same-arm seed-noise control. A DIAGNOSTIC — never part of the criterion and never able to overrule it. */
  readonly noise: SeedNoiseFloor;
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

/** Reads a `SimResult`'s per-team `continuousQuantile` at `p`. ONE quantile helper, called identically for both arms. */
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

/**
 * Decodes the baked artifact's histogram block into the same `SimResult`
 * shape `simulateRanks` returns, so BOTH arms reach `continuousQuantile`
 * through one code path.
 */
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
 * Replays one season (optionally carrying in from `replayFrom`), mirroring
 * `publishSeasons`' own composition: an offseason-inclusive stream, the
 * corpus-global cold-start index, an `onMatchComplete` hook capturing the
 * PRE-EVENT state per event and the Sigma talent map per match from the
 * metrics pass it already runs, and a `SigmaScoutLayer` constructed PER SEASON
 * and folded over the returned records in chronological order AFTER the
 * replay.
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

    // The publisher's own hook, reproduced: pre-event state captured ONCE per
    // event on that event's FIRST completed match, plus the Sigma talent map
    // from the same `teamMetrics` call.
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
        // else: the cold-start season's very first event — deliberately NO
        // entry, exactly as publish.ts does (PD-04).
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
            ? `cold (target season ${season} only, assumption A-FA3)`
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
}

export function measureEvent(
  db: Corpus,
  algorithm: AlgorithmModule<any>,
  target: TargetEvent,
  replay: SeasonReplayResult,
  options: MeasureOptions
): EventMeasurement {
  // PLAYED matches only (`selectMatchesChronological`'s own contract: rows
  // with a recorded winner). The unplayed cross-check is the separate
  // `selectScheduledMatches` read below.
  const quals = selectMatchesChronological(db, { eventKey: target.eventKey }).filter((m) => m.compLevel === "qm");

  // Re-assert the corpus against the pinned table. Loud, never silent.
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
      `measureFieldAveragedRanks: no pre-event walk-forward state was captured for ${target.eventKey} (PD-04 — the cold-start season's first event). Re-run with --replay-from an earlier season.`
    );
  }

  const layer = replay.layer;
  const consistency = layer.consistencyByTeam();
  const filler = makeRankingPointFiller(layer.rpAccumulator, ruleModule, consistency, roster);
  if (filler === undefined) {
    throw new Error(`measureFieldAveragedRanks: the ranking-point filler is unavailable for ${target.eventKey} — the all-or-nothing roster rule rejected this roster.`);
  }

  // --- Arm `baked`: the REAL publisher path, through the REAL closure. ---
  const scheduleCount = 20;
  const drawsPerSchedule = Math.max(1, Math.round(options.draws / scheduleCount));
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
    predict: (match: UpcomingMatch) => filler(match, algorithm.predict(pricingState, match)),
  });
  if (bakedArtifact === null) {
    throw new Error(`measureFieldAveragedRanks: the baked arm returned null for ${target.eventKey} — this algorithm does not model ranking points here.`);
  }
  const bakedDraws = bakedArtifact.baked.draws;
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
    consistencyByTeam: consistency,
    teamTotals,
  });
  if (contributions === null) {
    throw new Error(`measureFieldAveragedRanks: the field-averaged arm returned null for ${target.eventKey} — the all-or-nothing roster rule rejected this roster.`);
  }
  // The arm being measured is the arm that would SHIP: the bands below are
  // derived from the PARSED, ROUNDED, published-shape artifact via the shared
  // `fieldAveragedRankInputs`, not from an unrounded in-memory intermediate.
  // That is what makes this a measurement of the artifact rather than of
  // something adjacent to it.
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

  // Both arms MUST rank over the same draw count, or every difference below
  // is meaningless. Asserted, not assumed.
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

  // --- A-FA1: the additivity residual, measured not asserted. ---
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

  // --- Byte sizes, measured on the real artifacts. ---
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
  };
}

/**
 * The baked arm's own mean season-total RP per team, derived from its priced
 * pmfs: each team's expected per-match RP averaged across the schedules it
 * appears in, times `matchesPerTeam`. This is the diagnostic counterpart to
 * the rung-1 arm's `pmfMean` read — a systematic difference points at the
 * moments construction.
 */
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

/** FNV-1a 32-bit — the same hashing convention `preSchedule.ts` uses for every seed (cite, don't rederive: http://www.isthe.com/chongo/tech/comp/fnv/). */
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

export function printEvent(m: EventMeasurement): void {
  console.log("");
  console.log(`=== ${m.eventKey} (season ${m.season}) ===`);
  console.log(
    `roster=${m.rosterSize}  quals=${m.qualCount}  matchesPerTeam=${m.matchesPerTeam}  draws=${m.draws}  replay=${m.replayMode}  preTargetMatches=${m.preTargetMatchCount}`
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
    `A-FA1 residual (predicted alliance score minus the sum of its members' totals), over ${m.residual.allianceCount} alliances: ` +
      `mean=${m.residual.mean.toFixed(3)}  sd=${m.residual.sd.toFixed(3)}  max|.|=${m.residual.maxAbs.toFixed(3)}   ` +
      `as a fraction of the model's own score uncertainty (sqrt(meanOfBandVariances * ${ALLIANCE_SIZE}) = ${m.residual.scoreUncertainty.toFixed(3)}): ` +
      `mean=${m.residual.meanFraction.toFixed(3)}  sd=${m.residual.sdFraction.toFixed(3)}  max=${m.residual.maxAbsFraction.toFixed(3)}`
  );
  console.log(
    "A-FA1: a large residual STANDARD DEVIATION is the first thing to examine if the band-edge (clause 2) or systematic-shift (clause 3) clauses fail."
  );
  console.log(
    `diagnostics (NOT part of the criterion, and never used to overrule it): mean season-total RP per team — baked=${m.bakedMeanSeasonRp.toFixed(2)} fieldAveraged=${m.fieldMeanSeasonRp.toFixed(2)}; ` +
      `mean band width (p90-p10) — baked=${m.bakedMeanBandWidth.toFixed(2)} fieldAveraged=${m.fieldMeanBandWidth.toFixed(2)}`
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
  const algorithm = ALGORITHMS[algorithmId];
  if (algorithm === undefined) throw new Error(`measureFieldAveragedRanks: unknown algorithm "${algorithmId}"`);
  const replayFromOpt = values["replay-from"] === undefined ? undefined : Number(values["replay-from"]);

  console.log("measureFieldAveragedRanks — D-16/D-17 rung 1 vs the 20-schedule baked path");
  console.log(`algorithm=${algorithm.id}@${algorithm.version}  draws=${draws}  events=${targets.map((t) => t.eventKey).join(", ")}`);
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
        const m = measureEvent(db, algorithm, target, replay, { draws, algorithmId: algorithm.id, replayFrom });
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
  for (const e of verdict.perEvent) {
    console.log(
      `  ${e.eventKey.padEnd(11)} teams=${String(e.teamCount).padStart(3)}  clause1 rate=${pct(e.tightRate).padStart(6)}  p10=${pct(e.p10Rate).padStart(6)}  p90=${pct(e.p90Rate).padStart(6)}  mean signed median shift=${e.meanSignedMedianDiff.toFixed(3)}`
    );
  }
  console.log("");
  console.log(
    `  CLAUSE 1 (median rank): ${verdict.clause1.pass ? "PASS" : "FAIL"} — ${pct(verdict.clause1.tightRate)} of ${verdict.teamCount} teams within ${CLAUSE_1_MEDIAN_TIGHT} ranks (needs >= ${pct(CLAUSE_1_TIGHT_RATE)}); ` +
      `every team within ${CLAUSE_1_MEDIAN_HARD}: ${verdict.clause1.everyTeamWithinHard}; worst single team ${verdict.clause1.worstTeamKey} at ${verdict.clause1.worstEventKey}, |diff| ${verdict.clause1.worstAbsMedianDiff.toFixed(2)}`
  );
  console.log(
    `  CLAUSE 2 (band edges):  ${verdict.clause2.pass ? "PASS" : "FAIL"} — p10 ${pct(verdict.clause2.p10Rate)}, p90 ${pct(verdict.clause2.p90Rate)} within ${CLAUSE_2_EDGE_TOLERANCE} ranks (needs >= ${pct(CLAUSE_2_RATE)} on BOTH)`
  );
  console.log(
    `  CLAUSE 3 (no shift):    ${verdict.clause3.pass ? "PASS" : "FAIL"} — mean SIGNED median difference ${verdict.clause3.meanSignedMedianDiff.toFixed(4)} ranks (allows +/-${CLAUSE_3_MEAN_SHIFT})`
  );
  const noiseWeight = measurements.reduce((t, m) => t + m.rosterSize, 0);
  console.log("");
  console.log(
    `  seed-noise floor (DIAGNOSTIC — never part of the criterion and never able to overrule it): the BAKED arm re-simulated at two seeds ` +
      `agrees with ITSELF on ${pct(measurements.reduce((t, m) => t + m.noise.withinTightRate * m.rosterSize, 0) / noiseWeight)} of teams within ${CLAUSE_1_MEDIAN_TIGHT} ranks, ` +
      `mean |median difference| ${(measurements.reduce((t, m) => t + m.noise.meanAbsMedianDiff * m.rosterSize, 0) / noiseWeight).toFixed(3)} ranks`
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
 * The SEED-NOISE FLOOR — a same-arm control, and DELIBERATELY NOT PART OF THE
 * CRITERION.
 *
 * Both arms estimate their quantiles from a finite number of seeded draws, so
 * even two runs of the IDENTICAL arm over the IDENTICAL inputs disagree by
 * some amount. Without that number a FAIL cannot be attributed between "rung 1
 * genuinely differs from the baked path" and "1000 draws cannot resolve half a
 * rank", and the checkpoint briefing the verdict feeds would be unreadable.
 *
 * It is measured the only way that isolates the seed: the BAKED arm's own
 * priced schedules are re-simulated TWICE, at two seeds that are not the
 * published one, and the two runs are compared to each other. Both sides share
 * every other property — same pmfs, same rows, same draw count, same
 * surrogate treatment — so the whole difference is the draw stream.
 *
 * `measureRewindGap.ts` carries the same idea in its
 * `NOISE_CONTROL_SEED_OFFSET`. This number may NEVER be used to overrule the
 * criterion, which was fixed before any measurement existed (T-09-09-09); it
 * exists so a reader can tell what a measured difference means.
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
    // Two streams, NEITHER of them the published one, so the two sides are
    // symmetric: any difference between them is the seed and nothing else.
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
// The measurement record — WRITTEN BY THE SCRIPT, never transcribed
// ---------------------------------------------------------------------------

/**
 * Renders `docs/models/field-averaged-presim.md`, following
 * `docs/models/rewind-overconfidence-gap.md`'s shape: a headline sentence, a
 * fenced JSON block, the per-event table, the byte-size table, the A-FA1
 * block, and a caveats section.
 *
 * THE SCRIPT WRITES THIS; NOBODY TRANSCRIBES IT. That is deliberate and worth
 * a line in the document itself: on this project a sibling measurement
 * (`publish:seasons`' payload-budget summary) PRINTS a summary it does not
 * write, and its budget tests stay red until a human copies the numbers
 * across. This record does not reproduce that trap.
 */
export function renderDoc(measurements: readonly EventMeasurement[], verdict: RungOneVerdict, algorithmLabel: string): string {
  const rosterSizes = measurements.map((m) => m.rosterSize);
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

  const block = {
    verdict: verdict.pass ? "PASS" : "FAIL",
    algorithm: algorithmLabel,
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
    seedNoiseFloor: measurements.map((m) => ({
      eventKey: m.eventKey,
      withinTightRate: Number(m.noise.withinTightRate.toFixed(4)),
      meanAbsMedianDiff: Number(m.noise.meanAbsMedianDiff.toFixed(3)),
    })),
  };

  const lines: string[] = [];
  lines.push("# Field-averaged pre-schedule prediction — rung 1 measured against the 20-schedule baked path");
  lines.push("");
  lines.push(
    `**${verdict.pass ? "PASS" : "FAIL"}.** Across ${verdict.eventCount} real finished events (${verdict.teamCount} teams, every team of every event scored, roster sizes ${Math.min(
      ...rosterSizes
    )}-${Math.max(...rosterSizes)}), the field-averaged predictor's rank bands agree with the 20-schedule baked path's ` +
      `on ${pct(verdict.clause1.tightRate)} of teams within half a rank of median (clause 1 needs ${pct(CLAUSE_1_TIGHT_RATE)}), ` +
      `on ${pct(verdict.clause2.p10Rate)}/${pct(verdict.clause2.p90Rate)} of teams within one rank at the p10/p90 band edges (clause 2 needs ${pct(CLAUSE_2_RATE)}), ` +
      `with a mean signed median shift of ${verdict.clause3.meanSignedMedianDiff.toFixed(3)} ranks (clause 3 allows ±${CLAUSE_3_MEAN_SHIFT}).`
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
    "Quoted verbatim from `09-PLAN-OUTLINE.md`'s \"Answer to the open question — rung 1's pass/fail bar\" and encoded as named constants in the measurement script. No threshold was changed after the run."
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
  lines.push("| Clause | Outcome | Achieved | Required |");
  lines.push("|---|---|---|---|");
  lines.push(
    `| 1 — median rank | ${verdict.clause1.pass ? "PASS" : "FAIL"} | ${pct(verdict.clause1.tightRate)} within ${CLAUSE_1_MEDIAN_TIGHT}; every team within ${CLAUSE_1_MEDIAN_HARD}: ${verdict.clause1.everyTeamWithinHard} | ≥ ${pct(CLAUSE_1_TIGHT_RATE)} and every team |`
  );
  lines.push(
    `| 2 — band edges | ${verdict.clause2.pass ? "PASS" : "FAIL"} | p10 ${pct(verdict.clause2.p10Rate)}, p90 ${pct(verdict.clause2.p90Rate)} | ≥ ${pct(CLAUSE_2_RATE)} on both |`
  );
  lines.push(
    `| 3 — systematic shift | ${verdict.clause3.pass ? "PASS" : "FAIL"} | ${verdict.clause3.meanSignedMedianDiff.toFixed(3)} ranks | within ±${CLAUSE_3_MEAN_SHIFT} |`
  );
  lines.push("");
  lines.push(
    `Worst single team: **${verdict.clause1.worstTeamKey}** at **${verdict.clause1.worstEventKey}**, median difference ${verdict.clause1.worstAbsMedianDiff.toFixed(2)} ranks.`
  );
  lines.push("");
  lines.push("## Per event");
  lines.push("");
  lines.push("| Event | Season | Teams | Quals | Matches/team | Replay | Clause-1 rate | p10 rate | p90 rate | Mean signed median shift |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const m of measurements) {
    const e = verdict.perEvent.find((x) => x.eventKey === m.eventKey)!;
    lines.push(
      `| \`${m.eventKey}\` | ${m.season} | ${m.rosterSize} | ${m.qualCount} | ${m.matchesPerTeam} | ${m.replayMode} | ${pct(e.tightRate)} | ${pct(e.p10Rate)} | ${pct(e.p90Rate)} | ${e.meanSignedMedianDiff.toFixed(3)} |`
    );
  }
  lines.push("");
  lines.push("## Artifact size");
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
  lines.push("## Assumption A-FA1 — the additivity residual, measured");
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
  lines.push("| Event | Mean season RP/team (baked) | (field-avg) | Mean band width (baked) | (field-avg) | Seed-noise floor: teams within 0.5 | mean \\|Δmedian\\| |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const m of measurements) {
    lines.push(
      `| \`${m.eventKey}\` | ${m.bakedMeanSeasonRp.toFixed(2)} | ${m.fieldMeanSeasonRp.toFixed(2)} | ${m.bakedMeanBandWidth.toFixed(2)} | ${m.fieldMeanBandWidth.toFixed(2)} | ${pct(m.noise.withinTightRate)} | ${m.noise.meanAbsMedianDiff.toFixed(2)} |`
    );
  }
  lines.push("");
  lines.push(
    "A systematic season-RP difference points at the moments construction; a systematic band-width difference points at the composition-spread terms. The **seed-noise floor** is a same-arm control: the baked arm's own priced schedules re-simulated at two seeds, neither of them the published one, compared to each other. It is what a clause-1 rate would look like if the two arms were IDENTICAL and only the draw stream differed."
  );
  lines.push("");
  lines.push("## Caveats");
  lines.push("");
  lines.push(
    "- **A team's matches are assumed near-independent.** Partners differ each match, which is what makes the assumption reasonable, but the matches of one event are not literally independent draws."
  );
  lines.push(
    "- **Coupling from teams that share specific matches is washed out** — two teams scheduled against each other have correlated outcomes and nothing in the field-averaged form represents that. **And the 20-schedule arm washes that same coupling out by design**, averaging over 20 independent shuffles precisely so no particular pairing survives into the published band. It is a shared property of both forms, not a defect unique to the new one."
  );
  lines.push(
    "- **The composition-induced spread is treated as Gaussian** — the same approximation class used elsewhere in this pipeline, and the one D-16 names and accepts. The exact mixture over all partner pairs crossed with all opposing triples is computable and is deliberately not computed: roughly 5.7 million `analyticRpPmf` calls per team on a 40-team roster."
  );
  lines.push(
    "- **Assumption A-FA1 (additivity)** is measured above rather than asserted. A large residual standard deviation is the first thing to examine if clause 2 or clause 3 fails."
  );
  lines.push(
    `- **Assumption A-FA3 (replay mode).** Each event's season was replayed in the mode printed in the per-event table above. Both arms read the SAME state, so the comparison stays internally valid either way; the mode is recorded because a cold replay makes the baked arm non-identical to the production sidecar.`
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
