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
  type SimResult,
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
import { buildPreScheduleArtifact } from "../packages/harness/preSchedule.js";
import { makeRankingPointFiller } from "../packages/harness/publish.js";
import { ALGORITHMS } from "../packages/harness/cli.js";
import {
  ALLIANCE_SIZE,
  fieldAveragedMatchPmf,
  fieldAveragedRankInputs,
  fieldStatistics,
  type FieldTeamContribution,
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
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function uniqueSortedRoster(quals: readonly MatchResult[]): string[] {
  const keys = new Set<string>();
  for (const m of quals) {
    for (const t of m.redTeams) keys.add(t);
    for (const t of m.blueTeams) keys.add(t);
  }
  return [...keys].sort();
}

/** Reads a `SimResult`'s per-team `continuousQuantile` at `p`. ONE quantile helper, called identically for both arms. */
function quantilesOf(result: SimResult, teamKey: string): { p10: number; median: number; p90: number } {
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
function bakedSimResult(roster: readonly string[], histograms: readonly (readonly number[])[], draws: number): SimResult {
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

interface SeasonReplayResult {
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
function replaySeason(
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

/** Builds the field contributions for one roster, inline (plan 09-09 Task 1 — Task 2 extracts this into `buildFieldContributions`). */
function inlineFieldContributions(
  roster: readonly string[],
  layer: SigmaScoutLayer,
  teamTotals: ReadonlyMap<string, number>
): FieldTeamContribution[] | null {
  const accumulator = layer.rpAccumulator;
  if (accumulator === undefined) return null;
  const consistency = layer.consistencyByTeam();
  // The ALL-OR-NOTHING roster rule, reproduced from `makeRankingPointFiller`.
  for (const teamKey of roster) {
    if (!consistency.has(teamKey) || !teamTotals.has(teamKey)) return null;
  }
  return roster.map((teamKey) => {
    // A ONE-TEAM roster: `momentsFor`'s even-split undo scales by
    // `roster.length² / contributing` = 1, so this returns the team's OWN
    // belief unscaled rather than an alliance aggregate.
    const own = accumulator.momentsFor([teamKey], 0, 0);
    const swing = consistency.get(teamKey)!;
    return {
      teamKey,
      variableMeans: own.meanVector,
      variableVariances: own.varianceBlock.map((row, i) => row[i] ?? 0),
      scoreMean: teamTotals.get(teamKey)!,
      bandVariance: swing * swing,
    };
  });
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
  const contributions = inlineFieldContributions(roster, layer, teamTotals);
  if (contributions === null) {
    throw new Error(`measureFieldAveragedRanks: the field-averaged arm returned null for ${target.eventKey} — the all-or-nothing roster rule rejected this roster.`);
  }
  const variableNames = ruleModule.thresholdVariables.map((v) => v.name);
  const stats = fieldStatistics(contributions, variableNames);
  const perTeamPmf = contributions.map((c) => fieldAveragedMatchPmf(c, stats, ruleModule, eventType));
  const fieldSeed = fnv1a32(`${target.eventKey}|${algorithm.version}|fieldAveraged`);
  const { matches, baselines } = fieldAveragedRankInputs(roster, perTeamPmf, matchesPerTeam);
  const fieldResult = simulateRanks(matches, baselines, bakedDraws, mulberry32(fieldSeed));

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
  const fieldBody = JSON.stringify({ roster, matchesPerTeam, perTeamPmf, draws: bakedDraws, seed: fieldSeed });
  const fieldAveragedBytes = Buffer.byteLength(fieldBody, "utf8");
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
  console.log("");
  console.log(
    `SAMPLE: ${measurements.length} event(s), roster sizes ${Math.min(...rosterSizes)}-${Math.max(...rosterSizes)}, ` +
      `pooled team count ${measurements.reduce((t, m) => t + m.rows.length, 0)}`
  );

  if (values["write-doc"] === true) {
    writeFileSync(FIELD_AVERAGED_DOC_PATH, renderDoc(measurements), "utf8");
    console.log(`\nwrote ${FIELD_AVERAGED_DOC_PATH}`);
  }
}

/** Placeholder until Task 3 — the document is written by the script, never transcribed. */
function renderDoc(measurements: readonly EventMeasurement[]): string {
  return `# Field-averaged pre-schedule prediction\n\n${measurements.length} event(s) measured.\n`;
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
