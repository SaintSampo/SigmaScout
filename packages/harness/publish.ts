/**
 * `pnpm publish:artifacts` / `pnpm publish:seasons` entry point: the offline publisher.
 *
 *   pnpm publish:artifacts --seasons 2022-2026 [--algorithm opr,epa,spr] [--bucket <name>]
 *     [--concurrency 48] [--dry-run] [--skip-state] [--include-offseason] [--write-budget]
 *
 * `--write-budget` rewrites the fenced `json budget` block in `docs/publish-budget.md`
 * after a successful run; narrow ad-hoc runs omit it so they never clobber the full-run record.
 *
 * `--seasons` publishes every page kind for every requested algorithm from one shared match
 * stream per season. There is no single-event publish path: an event is refreshed by a full
 * `pnpm publish:seasons`, because replaying one season cold loses cross-season state.
 *
 * Every assembly function (`buildEventArtifact`, `buildTeamsArtifact`, `buildTeamSeasonArtifact`,
 * `buildEventsArtifact`, `buildCompareArtifact`) is pure and parses its result through its Zod
 * schema before returning, so a validation failure throws before any upload. Numeric fields are
 * rounded on the way in, per `rounding.ts`'s `ROUNDING_RULE`; this is the only place rounding happens.
 *
 * A scheduled match's RP pmf comes from `makeRankingPointFiller`'s call to `analyticRpPmf`, never
 * from an algorithm's own `predict()`, so it is the same for every algorithm.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type {
  AlgorithmModule,
  CompLevel,
  MatchResult,
  Prediction,
  TeamMetric,
  TeamMetrics,
  UpcomingMatch,
} from "../core/algorithms/types.js";
import { TOTAL_METRIC_KEY } from "../core/algorithms/types.js";
import { seasonBoundaryFor } from "./seasonBoundary.js";
import type { OprState } from "../core/algorithms/opr.js";
import type { EpaState } from "../core/algorithms/epa.js";
import type { SprState } from "../core/algorithms/spr.js";
import { isDemoTeamKey } from "../core/algorithms/demoTeams.js";
import { isOfficialEventType } from "../core/algorithms/eventTypes.js";
import { RP_RULE_MODULES } from "../core/rankingPoints/rules.js";
import { isBonusRpCompLevel, isRpEligibleEventType } from "../core/rankingPoints/constants.js";
import {
  openCorpusReadOnly,
  selectCorpusSeasons,
  selectEventAlliancesForSeason,
  selectEventRankingsForSeason,
  selectEventTeamsForEvents,
  selectScheduledMatches,
  selectTeamKeysForYear,
  selectTeamMediaForYear,
  type Corpus,
} from "../corpus/db.js";
import { buildPreScheduleArtifact } from "./preSchedule.js";
import { defaultMatchesPerTeam, matchesPerTeamFor, MIN_SCHEDULE_TEAMS, MAX_SCHEDULE_TEAMS } from "./generatedSchedules.js";
import { buildSeasonStream, WalkForwardSimulator, OUTCOME_KEYS, type PredictionRecord } from "./replay.js";
import { corpusColdStartIndex } from "./corpusColdStart.js";
import {
  artifactKey,
  CompareArtifactSchema,
  composeEventLocation,
  deriveMetricKeyOrder,
  encodeTeamsRowMetrics,
  EventArtifactSchema,
  EventsArtifactSchema,
  PAGE_ARTIFACT_SCHEMA_VERSION,
  preScheduleKey,
  PublishedPreScheduleArtifactSchema,
  publishedTierForPercentile,
  TeamsArtifactWireSchema,
  TeamSeasonArtifactSchema,
  type CompareArtifact,
  type CompareRpCalibration,
  type EventArtifact,
  type EventsArtifact,
  type PageKind,
  type TeamsArtifactWire,
  type TeamSeasonArtifact,
} from "./pageArtifacts.js";
import { buildTeamRankScopesByTeam, deriveTeamRegions, type RankableTeamRow, type TeamRankScope } from "./teamRanks.js";
import { sigmaMetricByTeam, type SigmaMetricEntry } from "./sigmaMetric.js";
import {
  allianceSigmaBandVariance,
  publishesRankingPoints,
  SIGMA_METRIC_KEY,
  usesSigmaScore,
  type SigmaBelief,
  type SigmaPopulation,
} from "./sigmaScore.js";
import type { RpMomentsAccumulator } from "../core/rankingPoints/empiricalMoments.js";
import { RpMeanShiftAccumulator, rosterIsFullyWarm, type RpMeanShiftState } from "../core/rankingPoints/meanShift.js";
import { analyticRpPmf } from "../core/rankingPoints/analyticPmf.js";
import type { RpRuleModule } from "../core/rankingPoints/constants.js";
// The level-2 layer (Sigma Score, the band and ranking points), driven only by `publishSeasons`.
import { SigmaScoutLayer } from "./sigmaScoutLayer.js";
import { roundMetric, roundPmf, roundProbability, roundTo, ROUNDING_RULE } from "./rounding.js";
import {
  HISTORY_PERCENTILE_METRIC_KEYS,
  sortedPoolsByMetric,
  withPercentiles,
  withPoolPercentiles,
  type TeamMetricWithPercentile,
  type TeamMetricsWithPercentile,
} from "./percentiles.js";
import { buildAlgorithmsManifest, buildLiveWindowsManifest, PUBLISHED_ALGORITHM_IDS, PUBLISHED_ALGORITHM_MODULES } from "./manifests.js";
import {
  emitSeedSql,
  serializeState,
  withRpBeliefs,
  withRpMeanShift,
  withSigmaBeliefs,
  withSigmaPopulation,
  type StateStamp,
} from "./stateSnapshot.js";
import type { RpTeamBeliefs } from "../core/rankingPoints/empiricalMoments.js";
import { aggregateScores, type HarnessPredictionInput, type ScoreSlice } from "./score.js";
import { splitManifestVersion } from "./manifestSchemas.js";
import type { MetricHistoryRow } from "./metricHistorySchema.js";
import { putObject } from "./r2Client.js";
import { UploadQueue } from "./uploadQueue.js";
import {
  assertWithinPageBudget,
  computeSizeStats,
  PAGE_BUDGET_MAX_BYTES,
  percentileOf,
  PUBLISH_BUDGET_DOC_PATH,
  renderPublishBudgetBlock,
  replacePublishBudgetBlock,
  type PageKindSizeStats,
  type PublishedObjectRecord,
} from "./publishBudget.js";

const CORPUS_PATH = "data/corpus.sqlite";
const DEFAULT_BUCKET = "sigmascout-artifacts";
const DEFAULT_CONCURRENCY = 48;
const SEED_OUT_DIR = join("reports", "publish");
/**
 * Default first season that gets pre-schedule sidecars; overridable per run via
 * `--presim-from-season`. This default is the only place the cutoff appears.
 */
const DEFAULT_PRESCHEDULE_FROM_SEASON = 2026;
/**
 * Synthetic qualification schedules per covered event. At 20, two identical runs moved the worst
 * team 10.61 ranks (sampling noise); at 1,000 it moves 1.17, below what an integer rank shows.
 * Affordable only because sidecars are aggregate-only (~24 KB each).
 */
const PRESIM_SCHEDULE_COUNT = 1000;
/**
 * Draws per schedule. Pricing, not drawing, dominates per-schedule cost, so fewer draws buy little.
 * The baked total (1,000 x 50) intentionally differs from the client's `SIMULATION_DRAWS`: the baked
 * path samples over all schedules a team might get, the live path simulates the one that exists.
 */
const PRESIM_DRAWS_PER_SCHEDULE = 50;

/** The opr/epa/spr modules keyed by wire id — `manifests.ts`'s `PUBLISHED_ALGORITHM_MODULES`, the single registry, re-exported under the name publish callers and scripts already import. */
export const BASE_PUBLISH_ALGORITHMS: Record<string, AlgorithmModule<any>> = PUBLISHED_ALGORITHM_MODULES;

// ---------------------------------------------------------------------------
// Small local helpers shared by every assembly function below
// ---------------------------------------------------------------------------

/**
 * Guards `TeamSeasonMatchSchema.actualRedRp`/`actualBlueRp`'s `.int()`: SQLite does not enforce
 * integer RP columns, and a stray non-integer (2024orbb/2025orbb's non-FRC `rp` field) would throw
 * inside `.parse()` and abort the whole publish. Degrades to `null` ("not derivable") instead of
 * rounding a fabricated RP. Exported so `scripts/measureRpCalibration.ts` shares this exact policy.
 */
export function toIntegerRpOrNull(value: number | null): number | null {
  return value !== null && Number.isInteger(value) ? value : null;
}

/**
 * Rounds a metrics record's `value`/`spread` at `ROUNDING_RULE.metric`. `percentile` passes through
 * unchanged: it was already rounded once in `percentiles.ts`.
 */
function roundTeamMetricRecord(metrics: Record<string, TeamMetricWithPercentile>): Record<string, TeamMetricWithPercentile> {
  const result: Record<string, TeamMetricWithPercentile> = {};
  for (const [key, m] of Object.entries(metrics)) {
    result[key] = {
      value: roundMetric(m.value),
      ...(m.spread !== undefined ? { spread: roundMetric(m.spread) } : {}),
      ...(m.percentile !== undefined ? { percentile: m.percentile } : {}),
      // Copied explicitly: this rebuilds each metric field by field, so an unnamed field is dropped.
      ...(m.tier !== undefined ? { tier: m.tier } : {}),
    };
  }
  return result;
}

/** Rounds one `MetricHistoryRow.metrics` entry the same way. */
function roundMetricHistoryRow(row: MetricHistoryRow): MetricHistoryRow {
  return { ...row, metrics: roundTeamMetricRecord(row.metrics) };
}

/**
 * Attaches a `percentile` to every allowlisted metric on every history row, ranked against the
 * season ranking pool (every team as of its last official match, the pool the Teams list uses), so
 * a team's last official history row and its Teams-list row get the same tier by construction.
 * Never mutates `rows`: they are reused across the per-team loop. A metric absent from
 * `HISTORY_PERCENTILE_METRIC_KEYS` or from `rankingPools` is copied through with no percentile.
 * Exported for unit tests.
 */
export function withHistoryPercentiles(rows: readonly MetricHistoryRow[], rankingPools: ReadonlyMap<string, readonly number[]>): MetricHistoryRow[] {
  return rows.map((row) => ({ ...row, metrics: withPoolPercentiles(row.metrics, rankingPools, HISTORY_PERCENTILE_METRIC_KEYS) }));
}

/**
 * Appends this team's per-match Sigma Score to each history row that has one, as the row's last
 * metrics key (`sigma: { value }`, no percentile or spread). Applied only at the team-season build,
 * after `withHistoryPercentiles`, never inside `metricHistoryForAlgo`, whose rows also feed the
 * ranking pools, the Teams row and `seasonStats`. `sigmaByMatchKey` is passed explicitly as
 * `undefined` for non-Sigma algorithms; an unmatched row gets no sigma key and passes through
 * untouched. Never mutates and never rounds.
 */
export function withHistorySigma(
  rows: readonly MetricHistoryRow[],
  sigmaByMatchKey: ReadonlyMap<string, number> | undefined
): MetricHistoryRow[] {
  return rows.map((row) => {
    const sigma = sigmaByMatchKey?.get(row.matchKey);
    if (sigma === undefined) return row;
    return { ...row, metrics: { ...row.metrics, [SIGMA_METRIC_KEY]: { value: sigma } } };
  });
}

/**
 * The Teams-list metric snapshot, scoped to official play: each team's last history row (rows are in
 * chronological stream order) whose `eventKey` is official, the same reading as the web's
 * `officialSnapshotMetrics`. An offseason-only team is omitted, never present with an empty object.
 * Returns the source metrics reference unrounded and unmutated. Exported for unit tests.
 */
export function lastOfficialMetricsByTeam(
  metricHistoryByTeam: ReadonlyMap<string, MetricHistoryRow[]>,
  officialEventKeys: ReadonlySet<string>
): TeamMetrics {
  const result: TeamMetrics = {};
  for (const [teamKey, rows] of metricHistoryByTeam) {
    let lastOfficial: MetricHistoryRow | undefined;
    for (const row of rows) {
      if (officialEventKeys.has(row.eventKey)) lastOfficial = row;
    }
    if (lastOfficial !== undefined) result[teamKey] = lastOfficial.metrics;
  }
  return result;
}

/**
 * Picks a team-season artifact's `seasonStats.metrics` basis: the already percentile-widened official
 * entry when present and non-empty (`"last-official-match"`), else the season-final entry ranked
 * against the same `rankingPools` (`"season-final"`). The emptiness check is deliberate, so an empty
 * metrics object can never publish for a team whose season-final values exist. Exported for unit tests.
 */
export function seasonStatsMetricsForTeam(
  teamKey: string,
  officialWithPercentiles: TeamMetricsWithPercentile,
  seasonFinalMetrics: TeamMetrics,
  rankingPools: ReadonlyMap<string, readonly number[]>
): { metrics: Record<string, TeamMetricWithPercentile>; metricsBasis: "last-official-match" | "season-final" } {
  const official = officialWithPercentiles[teamKey];
  if (official !== undefined && Object.keys(official).length > 0) {
    return { metrics: official, metricsBasis: "last-official-match" };
  }
  return { metrics: withPoolPercentiles(seasonFinalMetrics[teamKey] ?? {}, rankingPools), metricsBasis: "season-final" };
}

/**
 * Attaches a percentile to an as-of-event metrics record, ranked against the season ranking pool
 * built from the season's full team list. Never rank against an event's own roster: the tier box
 * renders the same colour either way, so a reader could not detect the substitution. A metric with no
 * pool entry gets no `percentile` key, never a coerced `0`. Unlike `withHistoryPercentiles` there is
 * no allowlist: Breakdown tier-boxes every column, and an event carries one metrics record per team.
 */
export function withEventPercentiles(
  metrics: Record<string, TeamMetric>,
  rankingPools: ReadonlyMap<string, readonly number[]>
): Record<string, TeamMetricWithPercentile> {
  return withPoolPercentiles(metrics, rankingPools);
}

/** `frc254` -> `254`. Defensive fallback only — `lookupAllTeamInfo` is the real source of a team's number/nickname; this covers the edge case of a team key present on a match but absent from the `teams` table. */
function fallbackTeamNumber(teamKey: string): number {
  const parsed = Number.parseInt(teamKey.replace(/^frc/, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

// ---------------------------------------------------------------------------
// buildEventArtifact — v1/event/{eventKey}/{algorithmId}@{version}.json
// ---------------------------------------------------------------------------

export interface UpcomingPredictionRecord {
  readonly match: UpcomingMatch;
  readonly prediction: Prediction;
  /**
   * The published display band for a not-yet-played match, from every rostered team's play so far.
   * Sigma algorithms only, and never the win-odds variance. Attached by
   * `SigmaScoutLayer.enrichUpcoming`, so team and event artifacts carry the same number per match.
   */
  readonly matchBand?: { red?: number; blue?: number };
}

export interface EventTeamStandingInput {
  readonly teamKey: string;
  readonly teamNumber?: number;
  readonly nickname?: string;
  /**
   * Percentiles are attached by `withEventPercentiles` before reaching here; nothing downstream computes
   * one. For a Sigma-enabled algorithm the last key is `SIGMA_METRIC_KEY`, the season-final Sigma Score
   * the Teams row also publishes, merged in by `buildEventTeamsStanding` after the as-of-event values.
   */
  readonly metrics: Record<string, TeamMetricWithPercentile>;
}

/**
 * Fields consumed from `selectEventRankingsForSeason`, named identically. One quantity has four names:
 * corpus `ranking_score`, field `rankingScore`, ingest check `sort_order_info[0].name === "Ranking Score"`,
 * published `rp`. A model-derived fallback ordering must never be written into `rank`, which asserts
 * official provenance.
 */
export interface EventTeamRankingInput {
  readonly rank: number;
  readonly recordWins: number | null;
  readonly recordLosses: number | null;
  readonly recordTies: number | null;
  readonly rankingScore: number | null;
}

/**
 * Mirrors `EventMetaRow` field for field so call sites pass corpus rows straight through. The location
 * string is composed once, inside `buildEventArtifact`, so the event page and Events list always agree.
 */
export interface EventArtifactIdentityInput {
  readonly name: string | null;
  readonly startDate: string;
  readonly country: string | null;
  readonly stateProv: string | null;
  readonly week: number | null;
}

/**
 * Structurally `EventAllianceSelection`, declared here to keep the corpus out of this file's exported
 * surface. `picks` is TBA's ordered array: entry 0 leads, and a fourth entry is the reserve robot.
 * Never truncate it; the reserve is excluded from combined arithmetic, not from who was on the alliance.
 * `record` `undefined` and `null` both publish no `record` key.
 */
export interface EventAllianceInput {
  readonly allianceNumber: number;
  readonly name: string | null;
  readonly picks: readonly string[];
  readonly record?: { wins: number; losses: number; ties: number } | null;
}

export interface BuildEventArtifactParams {
  readonly eventKey: string;
  readonly season: number;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  readonly predictions: readonly PredictionRecord[];
  /** Not-yet-played matches with their predicted parameters. Defaults to `[]`, a valid artifact for a finished event. */
  readonly upcoming?: readonly UpcomingPredictionRecord[];
  /** The event's standings-style team list. Defaults to `[]`. */
  readonly teams?: readonly EventTeamStandingInput[];
  /** A short opaque string identifying the publish run that produced this object. */
  readonly generation: string;
  /** ISO timestamp. Defaults to `new Date().toISOString()`; overridable for deterministic tests. */
  readonly computedAt?: string;
  /**
   * `match_key` -> `sort_time`, the same contract as `BuildTeamSeasonArtifactParams.sortTimeByMatchKey`:
   * a missing entry leaves `sortTime` absent, never a synthetic default. Upcoming rows render their
   * scheduled time from it.
   */
  readonly sortTimeByMatchKey?: ReadonlyMap<string, number>;
  /** The event's identity from its corpus `events` row. Omitted: no `name`/`startDate`/`location`/`week` is emitted. */
  readonly eventMeta?: EventArtifactIdentityInput;
  /**
   * Playoff alliance selection, from `selectEventAlliancesForSeason`. Present (including `[]`) means
   * the corpus was consulted; both real call sites always supply it.
   */
  readonly alliances?: readonly EventAllianceInput[];
  /**
   * Official rank, record and ranking points keyed by team key (never array position). A team absent
   * from the map publishes none of `rank`/`record`/`rp`, the real state of events with no ranking rows.
   */
  readonly rankings?: ReadonlyMap<string, EventTeamRankingInput>;
  /**
   * `match_key` -> `ActualBonusFlags | null`, the same map and three-state contract as
   * `BuildTeamSeasonArtifactParams.actualBonusFlagsByMatchKey`; feeds the event's actual bonus-RP dots.
   */
  readonly actualBonusFlagsByMatchKey?: ReadonlyMap<string, ActualBonusFlags | null>;
  /**
   * `match_key` -> raw YouTube video key, same contract as `sortTimeByMatchKey`. Read only for played
   * rows; an unplayed match has no video.
   */
  readonly videoByMatchKey?: ReadonlyMap<string, string>;
}

/**
 * The conditionally-spread `rank`/`record`/`rp` fields for one team row. Factored out so
 * `buildEventArtifact` keeps a single `return`.
 *
 * All three are TBA's reported values (they account for DQs and surrogates), never a tally counted
 * here, and are independently optional: a half-present set is a real state. `rp` is TBA's Ranking
 * Score, a per-match average rounded at `ROUNDING_RULE.rankingPoints`, not an integer RP count. Only a
 * ranking entry reaches `rank`, never a model-derived position.
 */
function eventTeamRankingFields(
  ranking: EventTeamRankingInput | undefined
): Partial<{ rank: number; record: { wins: number; losses: number; ties: number }; rp: number }> {
  return {
    ...(ranking?.rank !== undefined ? { rank: ranking.rank } : {}),
    // All-or-nothing: missing any one of the three publishes no `record`, never a zero-filled one.
    ...(ranking !== undefined && ranking.recordWins !== null && ranking.recordLosses !== null && ranking.recordTies !== null
      ? { record: { wins: ranking.recordWins, losses: ranking.recordLosses, ties: ranking.recordTies } }
      : {}),
    // `!== null`, never truthiness, so a real `0` survives.
    ...(ranking?.rankingScore !== null && ranking?.rankingScore !== undefined
      ? { rp: roundTo(ranking.rankingScore, ROUNDING_RULE.rankingPoints) }
      : {}),
  };
}

/**
 * The per-bonus RP fields for one event match row, with the same gates `buildTeamSeasonArtifact`
 * applies: predicted marginals only for a bonus-eligible level and a prediction carrying them; actual
 * flags only for a bonus-eligible level with a map entry, `null` staying `null` (never all-false).
 * An upcoming row passes `flags === undefined` and gets the predicted pair only.
 */
function eventMatchBonusRpFields(
  compLevel: MatchResult["compLevel"],
  prediction: { readonly redBonusRp?: readonly number[]; readonly blueBonusRp?: readonly number[] },
  flags: ActualBonusFlags | null | undefined
): Partial<{ redBonusRp: number[]; blueBonusRp: number[]; actualRedBonusRp: boolean[] | null; actualBlueBonusRp: boolean[] | null }> {
  return {
    ...(isBonusRpCompLevel(compLevel) && prediction.redBonusRp ? { redBonusRp: prediction.redBonusRp.map((p) => roundProbability(p)) } : {}),
    ...(isBonusRpCompLevel(compLevel) && prediction.blueBonusRp ? { blueBonusRp: prediction.blueBonusRp.map((p) => roundProbability(p)) } : {}),
    ...(isBonusRpCompLevel(compLevel) && flags !== undefined
      ? { actualRedBonusRp: flags === null ? null : [...flags.red], actualBlueBonusRp: flags === null ? null : [...flags.blue] }
      : {}),
  };
}

/**
 * Builds the `fillRankingPoints` wrapper a pre-schedule sidecar needs, or `undefined` when there is
 * nothing to add (no rule module, or an algorithm that publishes no ranking points). Wrapping here
 * keeps `preSchedule.ts` free of pricing math. Synthetic matches have no history, so moments come from
 * every team's play so far and score variance from the same per-team Sigma Scores
 * (`allianceSigmaBandVariance`). Exported so `scripts/measureFieldAveragedRanks.ts` prices with this
 * exact closure.
 *
 * `meanShift` is the season's walk-forward RP mean shift, read at the same instant as `accumulator`;
 * each synthetic alliance gets the same fully-warm check `SigmaScoutLayer` applies. The publisher
 * always passes it; absent means unshifted pricing.
 */
export function makeRankingPointFiller(
  accumulator: RpMomentsAccumulator | undefined,
  ruleModule: RpRuleModule | undefined,
  sigmaByTeam: ReadonlyMap<string, number>,
  roster: readonly string[],
  meanShift?: RpMeanShiftAccumulator
): ((match: UpcomingMatch, prediction: Prediction) => Prediction) | undefined {
  if (accumulator === undefined || ruleModule === undefined) return undefined;

  // All-or-nothing per event: schedules shuffle alliances, so one team without a Sigma Score would make
  // the pmf vanish partway through, which `buildPreScheduleArtifact` throws on. `undefined` skips the sidecar.
  if (roster.some((teamKey) => !sigmaByTeam.has(teamKey))) return undefined;

  return (match, prediction) => {
    if (prediction.redRpPmf !== undefined) return prediction;
    if (!isRpEligibleEventType(match.eventType)) return prediction;
    const red = allianceSigmaBandVariance(match.redTeams, sigmaByTeam);
    const blue = allianceSigmaBandVariance(match.blueTeams, sigmaByTeam);
    if (red === undefined || blue === undefined) return prediction;
    const redMoments = accumulator.momentsFor(match.redTeams, prediction.redScore, red);
    const blueMoments = accumulator.momentsFor(match.blueTeams, prediction.blueScore, blue);
    const pmf = analyticRpPmf({
      red: meanShift === undefined ? redMoments : meanShift.apply(redMoments, rosterIsFullyWarm(accumulator, match.redTeams)),
      blue: meanShift === undefined ? blueMoments : meanShift.apply(blueMoments, rosterIsFullyWarm(accumulator, match.blueTeams)),
      ruleModule,
      eventType: match.eventType,
      compLevel: match.compLevel,
      pRedWin: prediction.pRedWin,
    });
    return {
      ...prediction,
      redRpPmf: pmf.redPmf,
      blueRpPmf: pmf.bluePmf,
      ...(pmf.redBonusProbabilities !== undefined ? { redBonusRp: pmf.redBonusProbabilities } : {}),
      ...(pmf.blueBonusProbabilities !== undefined ? { blueBonusRp: pmf.blueBonusProbabilities } : {}),
    };
  };
}

/**
 * One row's published display band as a spreadable object, rounded once here; a side with no band
 * has no key. Played, upcoming and team-season rows all go through this, so they cannot disagree.
 */
function matchBandFields(matchBand: { red?: number; blue?: number } | undefined): {
  redMatchBandVariance?: number;
  blueMatchBandVariance?: number;
} {
  return {
    ...(matchBand?.red !== undefined ? { redMatchBandVariance: roundTo(matchBand.red, ROUNDING_RULE.variance) } : {}),
    ...(matchBand?.blue !== undefined ? { blueMatchBandVariance: roundTo(matchBand.blue, ROUNDING_RULE.variance) } : {}),
  };
}

export function buildEventArtifact(params: BuildEventArtifactParams): EventArtifact {
  const matches = params.predictions.map(({ match, prediction, matchBand, coldStart }) => ({
    matchKey: match.matchKey,
    compLevel: match.compLevel,
    setNumber: match.setNumber,
    matchNumber: match.matchNumber,
    sortTime: params.sortTimeByMatchKey?.get(match.matchKey),
    redTeams: [...match.redTeams],
    blueTeams: [...match.blueTeams],
    predictedWinner: prediction.winner,
    pRedWin: roundProbability(prediction.pRedWin),
    predictedRedScore: roundMetric(prediction.redScore),
    predictedBlueScore: roundMetric(prediction.blueScore),
    // Each alliance's own predicted-score variance, the same quantity as
    // `TeamSeasonMatchSchema.redScoreVarianceOwn`; `undefined` for OPR/EPA. Read off `predict()`'s
    // output, never recomputed, so it cannot silently stop reflecting the model.
    redScoreVarianceOwn:
      prediction.redScoreVarianceOwn !== undefined ? roundTo(prediction.redScoreVarianceOwn, ROUNDING_RULE.variance) : undefined,
    blueScoreVarianceOwn:
      prediction.blueScoreVarianceOwn !== undefined ? roundTo(prediction.blueScoreVarianceOwn, ROUNDING_RULE.variance) : undefined,
    // Match Band: roster size times the sum of the roster's squared Sigma Scores, walk-forward. Sigma
    // algorithms only; never the win-odds variance the ranking-point pmf reads.
    ...matchBandFields(matchBand),
    // Total-RP pmfs, read off `prediction` and deliberately not gated on competition level, matching
    // the upcoming and team-season builders; absent where the model produced none.
    redRpPmf: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined,
    blueRpPmf: prediction.blueRpPmf ? roundPmf(prediction.blueRpPmf) : undefined,
    // The RP decomposition, ungated for the same reason.
    matchOutcomePmf: prediction.matchOutcomePmf ? roundPmf(prediction.matchOutcomePmf) : undefined,
    redBonusRpPmf: prediction.redBonusRpPmf ? roundPmf(prediction.redBonusRpPmf) : undefined,
    blueBonusRpPmf: prediction.blueBonusRpPmf ? roundPmf(prediction.blueBonusRpPmf) : undefined,
    ...eventMatchBonusRpFields(match.compLevel, prediction, params.actualBonusFlagsByMatchKey?.get(match.matchKey)),
    actualWinner: match.winner,
    actualRedScore: match.redScore,
    actualBlueScore: match.blueScore,
    // The key never appears as `false`.
    ...(coldStart === true ? { coldStart: true as const } : {}),
    // Always present on played rows (direct assignment), and `null` never becomes `0`: a `0` is a
    // positive claim about standing that a fallback then sums.
    actualRedRp: toIntegerRpOrNull(match.redRpEarned),
    actualBlueRp: toIntegerRpOrNull(match.blueRpEarned),
    ...(params.videoByMatchKey?.get(match.matchKey) !== undefined
      ? { video: params.videoByMatchKey.get(match.matchKey) }
      : {}),
  }));

  const upcoming = (params.upcoming ?? []).map(({ match, prediction, matchBand }) => ({
    matchKey: match.matchKey,
    compLevel: match.compLevel,
    setNumber: match.setNumber,
    matchNumber: match.matchNumber,
    sortTime: params.sortTimeByMatchKey?.get(match.matchKey),
    redTeams: [...match.redTeams],
    blueTeams: [...match.blueTeams],
    predictedWinner: prediction.winner,
    pRedWin: roundProbability(prediction.pRedWin),
    predictedRedScore: roundMetric(prediction.redScore),
    predictedBlueScore: roundMetric(prediction.blueScore),
    redScoreVarianceOwn:
      prediction.redScoreVarianceOwn !== undefined ? roundTo(prediction.redScoreVarianceOwn, ROUNDING_RULE.variance) : undefined,
    blueScoreVarianceOwn:
      prediction.blueScoreVarianceOwn !== undefined ? roundTo(prediction.blueScoreVarianceOwn, ROUNDING_RULE.variance) : undefined,
    ...matchBandFields(matchBand),
    redRpPmf: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined,
    blueRpPmf: prediction.blueRpPmf ? roundPmf(prediction.blueRpPmf) : undefined,
    matchOutcomePmf: prediction.matchOutcomePmf ? roundPmf(prediction.matchOutcomePmf) : undefined,
    redBonusRpPmf: prediction.redBonusRpPmf ? roundPmf(prediction.redBonusRpPmf) : undefined,
    blueBonusRpPmf: prediction.blueBonusRpPmf ? roundPmf(prediction.blueBonusRpPmf) : undefined,
    // No actual outcome yet, so predicted marginals only.
    ...eventMatchBonusRpFields(match.compLevel, prediction, undefined),
  }));

  const teams = (params.teams ?? []).map((t) => ({
    teamKey: t.teamKey,
    teamNumber: t.teamNumber,
    nickname: t.nickname,
    ...eventTeamRankingFields(params.rankings?.get(t.teamKey)),
    metrics: roundTeamMetricRecord(t.metrics),
  }));

  // An omitted `params.eventMeta` emits none of these keys rather than inventing an identity.
  const identityFields = params.eventMeta
    ? {
        // Falls back to the event key on a null or empty name; `??` would let `""` fail `.min(1)`.
        name: params.eventMeta.name !== null && params.eventMeta.name.length > 0 ? params.eventMeta.name : params.eventKey,
        // No honest fallback: an empty value omits the key rather than publish a fabricated date.
        ...(params.eventMeta.startDate.length > 0 ? { startDate: params.eventMeta.startDate } : {}),
        // The only call to the location composer; `null` means no recorded location.
        location: composeEventLocation(params.eventMeta.stateProv, params.eventMeta.country),
        // Passed through unchanged, including `null` and `0`.
        week: params.eventMeta.week,
      }
    : {};

  // The `alliances` key's presence, not its length, signals the corpus was consulted; `[]` is a
  // real "no selection" answer.
  const alliances = params.alliances?.map((sel) => ({
    allianceNumber: sel.allianceNumber,
    // Absent key for an absent TBA name, never `""` or a synthesized label.
    ...(sel.name !== null && sel.name.length > 0 ? { name: sel.name } : {}),
    // A fresh copy in corpus order; never sorted, filtered or sliced to three.
    picks: [...sel.picks],
    // `undefined` and `null` both omit the key, never a fabricated zero record.
    ...(sel.record !== null && sel.record !== undefined ? { record: sel.record } : {}),
  }));

  // The season's win/tie RP constants, published once per artifact and read off the predictions, so
  // this publisher holds no season rules of its own.
  const rpOutcomeRp = findRpOutcomeRp(params.predictions, params.upcoming ?? []);

  const candidate = {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: params.generation,
    computedAt: params.computedAt ?? new Date().toISOString(),
    algorithmId: params.algorithmId,
    algorithmVersion: params.algorithmVersion,
    eventKey: params.eventKey,
    season: params.season,
    ...identityFields,
    matches,
    upcoming,
    teams,
    ...(alliances !== undefined ? { alliances } : {}),
    ...(rpOutcomeRp !== undefined ? { rpOutcomeRp } : {}),
  };

  return EventArtifactSchema.parse(candidate);
}

/**
 * `{ win, tie }` from the first record (played, then upcoming) carrying both outcome-RP vectors, whose
 * `[0]`/`[1]` are `winRp`/`tieRp` by construction (`[winRp, tieRp, 0]`). `undefined` omits the key.
 */
function findRpOutcomeRp(
  predictions: readonly PredictionRecord[],
  upcoming: readonly UpcomingPredictionRecord[]
): { win: number; tie: number } | undefined {
  for (const record of predictions) {
    const { redOutcomeRp } = record.prediction;
    if (redOutcomeRp !== undefined && record.prediction.blueOutcomeRp !== undefined) {
      return { win: redOutcomeRp[0]!, tie: redOutcomeRp[1]! };
    }
  }
  for (const record of upcoming) {
    const { redOutcomeRp } = record.prediction;
    if (redOutcomeRp !== undefined && record.prediction.blueOutcomeRp !== undefined) {
      return { win: redOutcomeRp[0]!, tie: redOutcomeRp[1]! };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// buildTeamsArtifact — v1/teams/{year}/{algorithmId}@{version}.json
// ---------------------------------------------------------------------------

export interface TeamsArtifactTeamInput {
  readonly teamKey: string;
  readonly teamNumber: number;
  readonly nickname: string;
  readonly record: { wins: number; losses: number; ties: number };
  readonly metrics: Record<string, TeamMetric>;
  readonly eventCount: number;
  readonly matchCount: number;
  /** Inferred home region (`deriveTeamRegions`) for the Teams page filter; omitted, never `null`/`""`, when not derivable. */
  readonly country?: string;
  readonly stateProv?: string;
  readonly districtKey?: string;
}

export interface BuildTeamsArtifactParams {
  readonly season: number;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  readonly teams: readonly TeamsArtifactTeamInput[];
  readonly generation: string;
  readonly computedAt?: string;
}

/**
 * A payload-budget-sensitive artifact (~3,750 rows/season). Parses through the wire schema, not the decoding
 * `TeamsArtifactSchema`: the return value is what gets uploaded, and decoding positional metrics back
 * to records would discard the wire saving.
 */
export function buildTeamsArtifact(params: BuildTeamsArtifactParams): TeamsArtifactWire {
  const roundedTeams = params.teams.map((t) => ({
    teamKey: t.teamKey,
    teamNumber: t.teamNumber,
    nickname: t.nickname,
    record: t.record,
    metrics: roundTeamMetricRecord(t.metrics),
    eventCount: t.eventCount,
    matchCount: t.matchCount,
    ...(t.country !== undefined ? { country: t.country } : {}),
    ...(t.stateProv !== undefined ? { stateProv: t.stateProv } : {}),
    ...(t.districtKey !== undefined ? { districtKey: t.districtKey } : {}),
  }));
  // The key order every row's positional `metrics` array aligns to, derived from the rows (first-seen
  // order) rather than a hardcoded per-algorithm list.
  const metricKeys = deriveMetricKeyOrder(roundedTeams.map((t) => t.metrics));
  const candidate = {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: params.generation,
    computedAt: params.computedAt ?? new Date().toISOString(),
    algorithmId: params.algorithmId,
    algorithmVersion: params.algorithmVersion,
    season: params.season,
    metricKeys,
    teams: roundedTeams.map((t) => ({ ...t, metrics: encodeTeamsRowMetrics(t.metrics, metricKeys) })),
  };
  return TeamsArtifactWireSchema.parse(candidate);
}

// ---------------------------------------------------------------------------
// buildTeamSeasonArtifact — v1/team/{teamKey}/{year}/{algorithmId}@{version}.json
// ---------------------------------------------------------------------------

/** One match's algorithm-independent actual per-bonus outcome, positionally aligned to that season's `RpRuleModule.bonusNames` — see `actualBonusFlagsForSeason`'s doc comment for the full contract. */
export interface ActualBonusFlags {
  readonly red: readonly boolean[];
  readonly blue: readonly boolean[];
}

/**
 * Phase 06.1 (F-06-3, PD-09): the algorithm-independent ACTUAL per-bonus
 * outcome for every match in `stream`, computed ONCE per season — never
 * inside the per-algorithm loop below, because a match's raw score
 * breakdown and its season's own RP rule module describe the MATCH, not a
 * prediction, so computing this per algorithm would run `ruleModule.parse`
 * three times per match for an identical result (PD-09).
 *
 * Returns an EMPTY map immediately when `season` has no entry in
 * `RP_RULE_MODULES` — no registered bonus vocabulary means no bonus fact to
 * publish, and the caller's missing-map-entry behavior (leaving a row's
 * actual bonus keys absent) is already the correct representation.
 *
 * G-06.1-26 (plan 06.1-08, PD-17): a non-`qm` `compLevel` produces ABSENCE
 * (no map entry at all) rather than `null`, checked FIRST — before every
 * other eligibility check below — via the single shared
 * `isBonusRpCompLevel` predicate (`rp/constants.ts`). `null` has a specific
 * published meaning: "the pipeline looked at a match that COULD have bonus
 * RP and could not derive it" (unparseable breakdown, offseason event
 * type). A playoff match is not that — bonus RP is not a property it can
 * have AT ALL, matching the predicted side's own `rpPmfForMatch`, which
 * omits `redBonusRp`/`blueBonusRp` entirely for a non-`qm` match. Placing
 * this check before the `null`-producing checks is load-bearing: placed
 * after them, a playoff match at an offseason event would silently publish
 * `null` instead of being correctly absent.
 *
 * A match maps to `null` when its event type is not RP-eligible
 * (`isRpEligibleEventType`), when it has no score breakdown
 * (`!match.hasScoreBreakdown` / `match.scoreBreakdownRaw === null` — the two
 * are kept in sync by `MatchResult`'s own contract), or when parsing the raw
 * breakdown throws for any reason (malformed JSON, a schema mismatch on
 * self-reported data — T-06.1-19: caught here so ONE bad match cannot abort
 * a whole publish run). These are the SAME two predicates
 * the retired Sigma1 core (deleted by quick task 260913-it4)'s `update()` used to
 * decide whether to fold a match's RP observation at all (its `usedFallback
 * || !isRpEligibleEventType(...)` skip condition) — so a match whose RP
 * fold Sigma1 skips is EXACTLY a match whose actual flags this function
 * publishes as `null`. Two independently-drifting eligibility rules is the
 * exact failure mode that core's own comment there warned against;
 * this correspondence is documented, not merely coincidental.
 *
 * A successfully-parsed match's boolean array is built by mapping the rule
 * module's OWN `bonusNames` list, in order, to the boolean the parse
 * produced for that name (T-06.1-20/T-06.1-09) — never by spreading or
 * `Object.assign`-ing the parsed record, so a hostile or malformed extra key
 * in third-party JSON cannot alter the published array's shape. A name the
 * parse result did not produce defaults to `false` so the array's length
 * always equals `bonusNames.length`.
 */
export function actualBonusFlagsForSeason(stream: readonly MatchResult[], season: number): Map<string, ActualBonusFlags | null> {
  const result = new Map<string, ActualBonusFlags | null>();
  const ruleModule = RP_RULE_MODULES[season];
  if (ruleModule === undefined) return result; // no registered RP rule module for this season — no bonus vocabulary to publish at all

  for (const match of stream) {
    // G-06.1-26 (plan 06.1-08, PD-17): bonus RP is a property of a
    // qualification match and of nothing else — checked FIRST, before the
    // null-producing checks below, so a playoff match produces ABSENCE
    // (never `null`). See this function's doc comment for the full
    // absence-vs-null contract.
    if (!isBonusRpCompLevel(match.compLevel)) continue;
    if (!isRpEligibleEventType(match.eventType) || !match.hasScoreBreakdown || match.scoreBreakdownRaw === null) {
      result.set(match.matchKey, null);
      continue;
    }
    try {
      const rawJson: unknown = JSON.parse(match.scoreBreakdownRaw);
      const redParsed = ruleModule.parse(rawJson, "red", match.eventType);
      const blueParsed = ruleModule.parse(rawJson, "blue", match.eventType);
      result.set(match.matchKey, {
        red: ruleModule.bonusNames.map((name) => redParsed.bonusFlags[name] ?? false),
        blue: ruleModule.bonusNames.map((name) => blueParsed.bonusFlags[name] ?? false),
      });
    } catch {
      // T-06.1-19: a throw here (malformed JSON, or a raw breakdown that
      // fails this season's RP schema) degrades this ONE match to null
      // rather than escaping and aborting the whole ~22-minute publish run.
      result.set(match.matchKey, null);
    }
  }
  return result;
}

export interface TeamSeasonEventInput {
  readonly eventKey: string;
  readonly eventName: string;
  readonly startDate: string;
  /**
   * Phase 6 (D-08/D-09): a played match (`PredictionRecord`, `match` is a
   * `MatchResult` carrying outcome fields) or a not-yet-played one
   * (`UpcomingPredictionRecord`, `match` is an `UpcomingMatch` that omits
   * outcome fields entirely) — `buildTeamSeasonArtifact` discriminates via
   * `"winner" in match`, never a caller-supplied flag.
   */
  readonly matches: readonly (PredictionRecord | UpcomingPredictionRecord)[];
  /** TEAM-04/F-06-3 (plan 06.1-01): from `selectEventRankingsForSeason(db, season).get(eventKey)?.get(teamKey)` — see `TeamSeasonEventSchema.rank`'s doc comment for the full contract. Omitted when the corpus has no ranking for this (event, team) pair. */
  readonly rank?: number;
  /** TEAM-04/F-06-3 (plan 06.1-01): see `rank`'s doc comment. */
  readonly totalTeams?: number;
}

export interface BuildTeamSeasonArtifactParams {
  readonly teamKey: string;
  readonly teamNumber: number;
  readonly nickname: string;
  readonly season: number;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  readonly seasonStats: {
    record: { wins: number; losses: number; ties: number };
    metrics: Record<string, TeamMetricWithPercentile>;
    /**
     * Quick task 260908-wpo: required here — every caller must state which
     * basis produced `metrics` — even though `TeamSeasonArtifactSchema`
     * itself parses this field as optional for pre-260908-wpo back-compat.
     * See that schema's `seasonStats.metricsBasis` doc comment for the two
     * values' meaning.
     */
    metricsBasis: "last-official-match" | "season-final";
  };
  readonly events: readonly TeamSeasonEventInput[];
  readonly metricHistory: readonly MetricHistoryRow[];
  readonly generation: string;
  readonly computedAt?: string;
  /**
   * D-08 (Phase 6): `match_key` -> `sort_time`, from `selectScheduledMatchTimes`
   * — looked up per match to populate `TeamSeasonMatchSchema.sortTime`.
   * Omitted (undefined map, or a missing entry) simply leaves a row's
   * `sortTime` absent — never a synthetic default.
   */
  readonly sortTimeByMatchKey?: ReadonlyMap<string, number>;
  /**
   * Phase 06.1 (F-06-3, PD-09): `match_key` -> `ActualBonusFlags | null`,
   * from `actualBonusFlagsForSeason` — looked up per played match to
   * populate `TeamSeasonMatchSchema.actualRedBonusRp`/`actualBlueBonusRp`.
   * Mirrors `sortTimeByMatchKey`'s own contract exactly: an omitted map, or
   * a missing entry for a specific match key, simply leaves that row's
   * actual bonus keys absent — never a synthetic default. A present `null`
   * entry (as opposed to a missing one) publishes as an explicit `null`,
   * not absence — see `TeamSeasonMatchSchema.actualRedBonusRp`'s three-state
   * doc comment.
   */
  readonly actualBonusFlagsByMatchKey?: ReadonlyMap<string, ActualBonusFlags | null>;
  /** D-03 (Phase 6): the pipeline-resolved robot image URL for this team/season, from `selectTeamMediaForYear` — omitted (never `null`) when the corpus has no eligible photo for this team-year. */
  readonly robotImageUrl?: string;
  /** D-05 (Phase 6): the seasons this team is known to have competed in, from the `activeYearsByTeam` pre-pass — feeds the team page's constrained year dropdown (D-18). */
  readonly activeYears?: readonly number[];
  /**
   * Quick task 260905-ldu: this team's World/Country/District/State rank
   * scopes for this algorithm/season, from `teamRanks.ts`'s
   * `buildTeamRankScopes`. Both an omitted value here and an empty array
   * produce an OMITTED `ranks` key on the published artifact (never an
   * empty array on the wire) — see this function's body for that
   * normalization.
   */
  readonly ranks?: readonly TeamRankScope[];
  /**
   * Quick task 260906-7eu: `match_key` -> raw YouTube video key, from
   * `selectMatchVideoKeys` — the exact same map
   * `BuildEventArtifactParams.videoByMatchKey` already carries; see that
   * field's doc comment for the full contract, inherited verbatim.
   */
  readonly videoByMatchKey?: ReadonlyMap<string, string>;
}

/** D-07/D-05's second at-risk artifact (the 292-match outlier). Parses through `TeamSeasonArtifactSchema` before returning (T-04-22). */
export function buildTeamSeasonArtifact(params: BuildTeamSeasonArtifactParams): TeamSeasonArtifact {
  const events = params.events.map((e) => ({
    eventKey: e.eventKey,
    eventName: e.eventName,
    startDate: e.startDate,
    // TEAM-04/F-06-3 (plan 06.1-01): conditionally spread, never assigned
    // `undefined` directly — an omitted input must produce a candidate
    // object with the key genuinely ABSENT (not present-with-undefined-
    // value), which is what lets a caller assert `not.toHaveProperty`
    // rather than `toBeUndefined` on the parsed artifact.
    ...(e.rank !== undefined ? { rank: e.rank } : {}),
    ...(e.totalTeams !== undefined ? { totalTeams: e.totalTeams } : {}),
    matches: e.matches.map((record) => {
      const { match, prediction } = record;
      const sortTime = params.sortTimeByMatchKey?.get(match.matchKey);
      const row = {
        matchKey: match.matchKey,
        season: params.season,
        eventKey: match.eventKey,
        compLevel: match.compLevel,
        algorithmId: params.algorithmId,
        algorithmVersion: params.algorithmVersion,
        predictedWinner: prediction.winner,
        pRedWin: roundProbability(prediction.pRedWin),
        predictedRedScore: roundMetric(prediction.redScore),
        predictedBlueScore: roundMetric(prediction.blueScore),
        variance: prediction.variance !== undefined ? roundTo(prediction.variance, ROUNDING_RULE.variance) : undefined,
        // D-01 (Phase 6): each alliance's OWN predicted-score variance —
        // reuses ROUNDING_RULE.variance unchanged (same physical quantity as
        // `variance` above). OPR/EPA never set these on `Prediction`, so both
        // stay undefined for them, matching `variance`'s own convention.
        redScoreVarianceOwn:
          prediction.redScoreVarianceOwn !== undefined ? roundTo(prediction.redScoreVarianceOwn, ROUNDING_RULE.variance) : undefined,
        blueScoreVarianceOwn:
          prediction.blueScoreVarianceOwn !== undefined ? roundTo(prediction.blueScoreVarianceOwn, ROUNDING_RULE.variance) : undefined,
        // PUBLISHED MATCH BAND — the SAME `record.matchBand` object the event
        // artifact reads, so this row and the event page's row for this match
        // carry byte-identical numbers by construction rather than by care.
        // Sigma algorithms only (quick task 260913-g66).
        ...matchBandFields(record.matchBand),
        redRpPmf: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined,
        blueRpPmf: prediction.blueRpPmf ? roundPmf(prediction.blueRpPmf) : undefined,
        // D-08 (Phase 6): the Match column's human label, published directly
        // instead of re-derived client-side from the opaque matchKey.
        setNumber: match.setNumber,
        matchNumber: match.matchNumber,
        sortTime,
        redTeams: [...match.redTeams],
        blueTeams: [...match.blueTeams],
        // G-06.1-26 (plan 06.1-08): predicted per-bonus marginals —
        // independent probabilities, never routed through roundPmf's
        // residual redistribution (that is only meaningful for a
        // distribution required to sum to 1). Rounded once, here, at
        // ROUNDING_RULE.probability, matching pRedWin's own rounding.
        // CONDITIONALLY spread (never assigned `undefined` directly, matching
        // `rank`/`totalTeams`'s own convention above), gated on
        // `isBonusRpCompLevel(match.compLevel)` — defence in depth at the
        // artifact-assembly boundary, mirroring the actual-side gate a few
        // lines below and the client guard (`BonusRpDots`'s `applicable`
        // prop): a played PLAYOFF match's row must carry neither key even if
        // a caller-supplied `Prediction` happens to carry populated arrays
        // (vpr's own `predict()` already never does this upstream, but
        // this function does not trust that upstream discipline alone).
        ...(isBonusRpCompLevel(match.compLevel) && prediction.redBonusRp
          ? { redBonusRp: prediction.redBonusRp.map((p) => roundProbability(p)) }
          : {}),
        ...(isBonusRpCompLevel(match.compLevel) && prediction.blueBonusRp
          ? { blueBonusRp: prediction.blueBonusRp.map((p) => roundProbability(p)) }
          : {}),
        // Quick task 260906-7eu: conditional spread, matching this row's own
        // `rank`/`totalTeams`-style convention above — a row with no entry
        // in the map carries no `video` key at all. In practice this is
        // populated only for a played match (the corpus's `video_key` is
        // null for anything unplayed), but the lookup is unconditional here
        // exactly like `sortTime`'s own lookup a few lines up, rather than
        // duplicated inside the `if ("winner" in match)` branch below.
        ...(params.videoByMatchKey?.get(match.matchKey) !== undefined
          ? { video: params.videoByMatchKey.get(match.matchKey) }
          : {}),
      };
      // D-09 (Phase 6): discriminate on the presence of the outcome fields
      // themselves — a scheduled match's `UpcomingMatch` never carries
      // `winner` at all (not merely `undefined`), so `"winner" in match` is
      // the correct, flag-free discriminant `buildSeasonStream`'s leak-proof
      // convention already establishes elsewhere in this codebase.
      if ("winner" in match) {
        // Phase 06.1 (F-06-3, PD-09/PD-10): looked up by match key, never by
        // array position. A MISSING map entry (undefined) leaves both
        // actual bonus keys genuinely absent from the row below (conditional
        // spread, not `key: undefined`); a PRESENT `null` entry publishes an
        // explicit null; a present array entry is copied (never aliased) so
        // a later mutation of the source map's array cannot reach the
        // published artifact. G-06.1-26 (plan 06.1-08): ALSO gated on
        // `isBonusRpCompLevel(match.compLevel)` — defence in depth against a
        // caller-supplied map that (like the ~54,671 already-published
        // artifacts, pre-fix) carries a populated entry for a playoff match;
        // `actualBonusFlagsForSeason` itself now never produces one, but this
        // function does not trust that upstream discipline alone either.
        const flags = params.actualBonusFlagsByMatchKey?.get(match.matchKey);
        return {
          ...row,
          actualWinner: match.winner,
          actualRedScore: match.redScore,
          actualBlueScore: match.blueScore,
          // D-01/D-03 (quick task 260909-t5q): the mirror of
          // `buildEventArtifact`'s own conditional spread — see its comment
          // for the full contract. `record` is narrowed on `"winner" in
          // match`, not on its own union member, so `"coldStart" in record`
          // is the safe way to read the stamp: `UpcomingPredictionRecord`
          // never declares the field at all, not even optionally.
          ...("coldStart" in record && record.coldStart === true ? { coldStart: true as const } : {}),
          // D-02 (Phase 6): never coerced null -> 0 — see TeamSeasonMatchSchema's
          // actualRedRp/actualBlueRp doc comment for the full null contract.
          // toIntegerRpOrNull: defence-in-depth against a non-integer value
          // already sitting in the corpus (see that helper's doc comment).
          actualRedRp: toIntegerRpOrNull(match.redRpEarned),
          actualBlueRp: toIntegerRpOrNull(match.blueRpEarned),
          ...(isBonusRpCompLevel(match.compLevel) && flags !== undefined
            ? { actualRedBonusRp: flags === null ? null : [...flags.red], actualBlueBonusRp: flags === null ? null : [...flags.blue] }
            : {}),
        };
      }
      return row;
    }),
  }));

  const candidate = {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: params.generation,
    computedAt: params.computedAt ?? new Date().toISOString(),
    algorithmId: params.algorithmId,
    algorithmVersion: params.algorithmVersion,
    teamKey: params.teamKey,
    teamNumber: params.teamNumber,
    nickname: params.nickname,
    season: params.season,
    seasonStats: {
      record: params.seasonStats.record,
      metrics: roundTeamMetricRecord(params.seasonStats.metrics),
      // Quick task 260908-wpo: a string tag — passed through unmodified, no
      // rounding, no transform.
      metricsBasis: params.seasonStats.metricsBasis,
    },
    events,
    metricHistory: params.metricHistory.map(roundMetricHistoryRow),
    robotImageUrl: params.robotImageUrl,
    activeYears: params.activeYears ? [...params.activeYears] : undefined,
    // Quick task 260905-ldu: "computed, found nothing" (an empty array) and
    // "never computed" (an omitted param) both collapse to an omitted
    // `ranks` key here — neither ever emits `ranks: []` on the wire.
    ranks: params.ranks && params.ranks.length > 0 ? [...params.ranks] : undefined,
  };
  return TeamSeasonArtifactSchema.parse(candidate);
}

// ---------------------------------------------------------------------------
// buildEventsArtifact — v1/events/{year}/{algorithmId}@{version}.json
// ---------------------------------------------------------------------------

export interface EventsArtifactEventInput {
  readonly eventKey: string;
  readonly name: string;
  readonly eventType: number;
  readonly isOffseason: boolean;
  readonly startDate: string;
  readonly week: number | null;
  readonly teamCount: number;
  readonly matchCount: number;
  readonly playedMatchCount: number;
  /** plan 05-02 (EVNT-01) */
  readonly country: string | null;
  readonly stateProv: string | null;
  readonly districtKey: string | null;
}

export interface BuildEventsArtifactParams {
  readonly season: number;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  readonly events: readonly EventsArtifactEventInput[];
  readonly generation: string;
  readonly computedAt?: string;
}

/** No numeric field here maps to a `ROUNDING_RULE` class (every value is an integer count or a nullable week index) — nothing to round. Parses through `EventsArtifactSchema` before returning (T-04-22). */
export function buildEventsArtifact(params: BuildEventsArtifactParams): EventsArtifact {
  const candidate = {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: params.generation,
    computedAt: params.computedAt ?? new Date().toISOString(),
    algorithmId: params.algorithmId,
    algorithmVersion: params.algorithmVersion,
    season: params.season,
    events: params.events.map((e) => ({ ...e })),
  };
  return EventsArtifactSchema.parse(candidate);
}

// ---------------------------------------------------------------------------
// RP calibration measurement (F1, D-09, D-11, D-12 — phase 09 plan 09-01)
// ---------------------------------------------------------------------------

/** One published bonus's calibration figures, structurally identical to `pageArtifacts.ts`'s module-private `CompareRpBonusSchema`. */
const RpCalibrationBonusSchema = z.object({
  name: z.string().min(1),
  count: z.number().int().nonnegative(),
  meanPredicted: z.number(),
  observedFrequency: z.number(),
  brierScore: z.number(),
});

/**
 * The RP scorecard's TOTAL-RP block (2026-09-13, quick task 260913-qyn) —
 * `redRpPmf`/`blueRpPmf` scored against the actual alliance RP by a ranked
 * probability score, pooled per alliance-side. Structurally identical to
 * `pageArtifacts.ts`'s module-private `CompareRpTotalSchema`. OPTIONAL,
 * OMITTED when its `count` is 0 — the same absence discipline `bonuses`
 * already uses, never a coerced zero (T-09-04's convention).
 */
const RpCalibrationTotalSchema = z.object({
  count: z.number().int().nonnegative(),
  rankedProbabilityScore: z.number(),
  meanPredictedRp: z.number(),
  meanActualRp: z.number(),
  excludedNullActual: z.number().int().nonnegative(),
  excludedOutOfSupport: z.number().int().nonnegative(),
});

/**
 * The RP scorecard's OUTCOME block (2026-09-13, quick task 260913-qyn) —
 * `matchOutcomePmf` scored against `match.winner` by a three-outcome Brier,
 * pooled per match. Structurally identical to `pageArtifacts.ts`'s
 * module-private `CompareRpOutcomeSchema`. OPTIONAL, OMITTED when its
 * `count` is 0.
 */
const RpCalibrationOutcomeSchema = z.object({
  count: z.number().int().nonnegative(),
  brierScore: z.number(),
  meanPredictedTie: z.number(),
  observedTieRate: z.number(),
});

/**
 * Structurally identical to `pageArtifacts.ts`'s module-private
 * `CompareRpCalibrationSchema` — DUPLICATED, not imported, because that
 * schema is deliberately not exported (only its inferred TYPE,
 * `CompareRpCalibration`, is — see that file's own comment for why). The
 * `satisfies` clause below is the compile-time guard against the two shapes
 * silently drifting apart; `scripts/measureRpCalibration.test.ts` and
 * `packages/harness/pageArtifacts.test.ts` both additionally exercise this
 * SAME real emitted record fixture
 * (`apps/web/src/routes/__fixtures__/rp-calibration-2026-spr.json`) as a
 * runtime cross-check.
 *
 * Task 2 Step 5: no `reliabilityBins` field — dropped from the wire shape
 * (see `pageArtifacts.ts`'s `CompareRpCalibrationSchema` doc comment for the
 * measured byte-budget reason) and, for the same reason `RpCalibrationRecord`
 * is a plain alias of `CompareRpCalibration` rather than its own type, never
 * re-added here independently of that decision.
 */
const RpCalibrationRecordSchema = z.object({
  scoredCount: z.number().int().nonnegative(),
  bonuses: z.array(RpCalibrationBonusSchema),
  totalRp: RpCalibrationTotalSchema.optional(),
  outcome: RpCalibrationOutcomeSchema.optional(),
});

/** Alias, not a re-declaration — this IS `pageArtifacts.ts`'s wire type, used here so `scripts/measureRpCalibration.ts`'s emitter has one name for "the record" regardless of which file's schema last validated it. */
export type RpCalibrationRecord = CompareRpCalibration;

/**
 * Compile-time guard: if `RpCalibrationRecordSchema`'s inferred shape ever
 * stops structurally matching `CompareRpCalibration` (pageArtifacts.ts's
 * module-private schema's exported type), this line fails to typecheck —
 * `npx tsc --noEmit` catches the drift instead of a caller discovering it at
 * runtime months later.
 */
type _RpCalibrationSchemaMatchesWireType =
  z.infer<typeof RpCalibrationRecordSchema> extends CompareRpCalibration
    ? CompareRpCalibration extends z.infer<typeof RpCalibrationRecordSchema>
      ? true
      : false
    : false;
const _rpCalibrationSchemaMatchesWireType: _RpCalibrationSchemaMatchesWireType = true;
void _rpCalibrationSchemaMatchesWireType;

/**
 * The committed, dated "before" baseline (D-09's per-bonus left-hand side)
 * AND `buildCompareArtifact`'s compare-artifact input. Plan 09-06 writes a
 * NEW dated file and repoints this default rather than overwriting this one
 * (`must_haves.prohibitions`: never edit a committed baseline in place).
 */
/**
 * REPOINTED 2026-09-11 (plan 09-06) at the `-09b` re-measurement, emitted from
 * the COLLAPSED single-path code after the pre-committed bar refused all three
 * candidate RP model changes.
 *
 * The `-09` file it replaced is NOT edited and NOT deleted: it is 09-01's
 * frozen pre-phase instrument, captured before 09-04 replaced the Monte Carlo,
 * and a re-measurement gets a new dated filename so before/after stays a real
 * comparison rather than a file that was quietly overwritten. A test asserts
 * the new file is per-bonus `===` equal to the chosen arm's pre-collapse
 * figures, which is the proof that the deletion pass was a refactor.
 *
 * REPOINTED 2026-09-13 at `-09c`, measured with `--algorithm spr`. Quick task
 * 260913-it4 made SPR the only algorithm that publishes ranking points, and
 * `attachRpCalibration` matches ids literally, so `-09b`'s `opr`/`epa`/`bpr`
 * records could no longer reach any slice: the next publish would have shipped
 * a Compare page with no RP card. `-09b` stays as the frozen record its own
 * tests pin. SPR prices matches the retired gate skipped (2025: 29,642
 * alliance-sides against OPR/EPA's 25,978), so `-09c` is not comparable
 * cell-for-cell with `-09b`.
 *
 * REPOINTED 2026-09-13 at `-09d` (quick task 260913-qyn, same day as `-09c`,
 * a second re-measurement): the scorer now scores TOTAL ranking points
 * (`totalRp`, a ranked probability score against the actual alliance RP) and
 * the win/tie/loss OUTCOME (`outcome`, a three-outcome Brier against
 * `match.winner`) alongside the existing per-bonus blocks, and WIN+TIE
 * shipped on the model itself (`data/baselines/rp-outcome-arms-2026-09.json`)
 * — the algorithm's own `pRedWin` replaces the score-draw comparison as the
 * decisive share, and a genuine discrete integer-margin tie probability
 * replaces the prior structural zero. `-09c` stays as the frozen
 * bonus-only-scorer record its own tests pin; `-09d` is measured with
 * `--algorithm spr` over the same ten seasons from the POST-ship code, so its
 * per-bonus figures are the same population `-09c` measured but under the
 * shipped WIN+TIE model rather than the pre-260913-qyn one.
 *
 * REPOINTED 2026-09-14 at `-09e` (quick task 260914-01x). Lattice marginals and
 * the walk-forward mean shift shipped together on the bonus half, because the
 * bonus-arm bar (`applyRpBonusArmBar`, committed before any figure existed)
 * accepted all three arms and lattice+meanShift had the lowest pooled total-RP
 * RPS (`data/baselines/rp-bonus-arms-2026-09.json`). `-09e` is measured with
 * `--algorithm spr` over the same ten seasons as `-09d`, from the post-ship
 * tree. Its outcome blocks equal `-09d`'s in every season, because the ship
 * touched only the bonus half. `-09d` stays as the frozen pre-lattice record
 * its own tests pin.
 */
export const RP_CALIBRATION_MEASUREMENT_PATH = "data/baselines/rp-calibration-2026-09e.json";

/**
 * A committed, self-describing measurement of every registered season's
 * per-bonus calibration for every measured algorithm — `scripts/measureRpCalibration.ts`'s
 * `--emit-artifact` output. `algorithmVersions` and `command` exist so a
 * reader can tell what produced a given figure without a second file
 * (T-09-06's provenance mitigation).
 */
export const RpCalibrationMeasurementSchema = z.object({
  measuredAt: z.string().min(1),
  command: z.string().min(1),
  corpusIdentity: z.string().min(1),
  offseasonIncluded: z.boolean(),
  algorithmVersions: z.record(z.string(), z.string()),
  /**
   * D-05 AFTER D-06: the shipped RP layer combination, in words.
   *
   * D-05 required the shipped combination to be recorded in the published
   * artifact and self-describing after the fact; D-06 then deleted the config
   * object that described it. These are sequential, not contradictory, and
   * this OPTIONAL field is the seam: once there is no config to record, the
   * record is a LABEL, and it lives in the committed measurement's own header
   * rather than on the wire.
   *
   * Written by `scripts/measureRpCalibration.ts`'s emitter, READ BY NOTHING,
   * and costing ZERO WIRE BYTES — `buildCompareArtifact` attaches per-slice
   * `calibration` records and never the measurement's header. That matters:
   * 09-01 measured the `compare` page kind at 14,088 bytes against a
   * 20,000-byte ceiling, and the remedy for an overrun on this project is to
   * shrink the block, never to raise the budget.
   *
   * Optional so every measurement emitted before the collapse still parses.
   */
  rpLayer: z.string().min(1).optional(),
  records: z.array(
    z.object({
      season: z.number().int(),
      algorithmId: z.string().min(1),
      calibration: RpCalibrationRecordSchema,
    })
  ),
});
export type RpCalibrationMeasurement = z.infer<typeof RpCalibrationMeasurementSchema>;

/**
 * Reads and validates a committed `RpCalibrationMeasurement` file.
 * `undefined` when the path does not exist — a genuinely absent measurement,
 * e.g. before this phase's first emit. THROWS a named error when the path
 * exists but does not parse, rather than degrading to `undefined` (T-09-03):
 * a silent `undefined` would be indistinguishable from "measurement not run
 * yet" when the real fact is "the committed file is corrupt," and those two
 * states must never look the same to a caller.
 */
export function loadRpCalibrationMeasurement(path: string): RpCalibrationMeasurement | undefined {
  if (!existsSync(path)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `loadRpCalibrationMeasurement: "${path}" exists but is not valid JSON — ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const parsed = RpCalibrationMeasurementSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`loadRpCalibrationMeasurement: "${path}" exists but does not match RpCalibrationMeasurementSchema — ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * Attaches each matching `RpCalibrationMeasurement` record onto its slice,
 * rounding to six decimal places at this boundary (a deliberate, BOUNDED
 * narrowing for this new block only — `buildCompareArtifact`'s existing
 * policy is that calibration figures ship unrounded; six decimals is four
 * orders of magnitude finer than the one-decimal-percent the page renders,
 * and it makes the wire cost of this block deterministic against a compare
 * budget with under six kilobytes of headroom). Bonus ranking points exist
 * only in QUALIFICATION matches, so only a slice whose `compLevelView` is
 * `"qualification"` is ever eligible; every other slice — and every
 * qualification slice with no matching record — is returned UNCHANGED, with
 * the key absent rather than present-and-empty. `measurement === undefined`
 * (no committed baseline yet) is a no-op over every slice.
 *
 * Quick task 260913-qyn: `totalRp` and `outcome` are copied the same way —
 * counts pass through as integers, every other figure rounds to six decimal
 * places — each ONLY when the source record's own block is present (its
 * count-above-0 absence discipline), never synthesized when the record
 * predates the scorer.
 */
export function attachRpCalibration(
  slices: readonly ScoreSlice[],
  measurement: RpCalibrationMeasurement | undefined
): readonly (ScoreSlice & { rpCalibration?: CompareRpCalibration })[] {
  if (measurement === undefined) return slices;
  return slices.map((slice) => {
    if (slice.compLevelView !== "qualification") return slice;
    // Quick task 260913-it4: only an algorithm that publishes ranking points
    // gets an RP accuracy card. The committed measurement still carries OPR and
    // EPA records from before that decision; they never reach an artifact.
    if (!publishesRankingPoints(slice.algorithmId)) return slice;
    const record = measurement.records.find((r) => r.season === slice.season && r.algorithmId === slice.algorithmId);
    if (record === undefined) return slice;
    const { calibration } = record;
    const rpCalibration: CompareRpCalibration = {
      scoredCount: calibration.scoredCount,
      bonuses: calibration.bonuses.map((b) => ({
        name: b.name,
        count: b.count,
        meanPredicted: roundTo(b.meanPredicted, 6),
        observedFrequency: roundTo(b.observedFrequency, 6),
        brierScore: roundTo(b.brierScore, 6),
      })),
      // Quick task 260913-qyn: totalRp/outcome copied only when the record
      // carries them (its own count > 0, `RpCalibrationTotalSchema`/
      // `RpCalibrationOutcomeSchema`'s own absence discipline) — counts stay
      // integers, every other figure rounds to six decimals at this same
      // boundary, matching `bonuses` above.
      ...(calibration.totalRp !== undefined
        ? {
            totalRp: {
              count: calibration.totalRp.count,
              rankedProbabilityScore: roundTo(calibration.totalRp.rankedProbabilityScore, 6),
              meanPredictedRp: roundTo(calibration.totalRp.meanPredictedRp, 6),
              meanActualRp: roundTo(calibration.totalRp.meanActualRp, 6),
              excludedNullActual: calibration.totalRp.excludedNullActual,
              excludedOutOfSupport: calibration.totalRp.excludedOutOfSupport,
            },
          }
        : {}),
      ...(calibration.outcome !== undefined
        ? {
            outcome: {
              count: calibration.outcome.count,
              brierScore: roundTo(calibration.outcome.brierScore, 6),
              meanPredictedTie: roundTo(calibration.outcome.meanPredictedTie, 6),
              observedTieRate: roundTo(calibration.outcome.observedTieRate, 6),
            },
          }
        : {}),
    };
    return { ...slice, rpCalibration };
  });
}

// ---------------------------------------------------------------------------
// buildCompareArtifact — v1/compare/{year}.json
// ---------------------------------------------------------------------------

export interface BuildCompareArtifactParams {
  readonly algorithms: readonly { id: string; version: string }[];
  readonly slices: readonly ScoreSlice[];
  readonly generation: string;
  readonly computedAt?: string;
  /** F1/D-09/D-11 (phase 09 plan 09-01): the committed RP measurement to attach onto matching qualification slices via `attachRpCalibration`. `undefined` — the default — attaches nothing, so every existing caller is unaffected until it opts in. */
  readonly rpCalibration?: RpCalibrationMeasurement;
}

/**
 * Brier/accuracy/calibration figures are NOT rounded — they don't map to any
 * of `rounding.ts`'s five field classes: rounding happens only when a
 * downstream reader renders a value, never at the source. The ONE exception is
 * `rpCalibration`, rounded to six decimal places by `attachRpCalibration`
 * for the documented wire-budget reason on that function. Parses through
 * `CompareArtifactSchema` before returning (T-04-22).
 */
export function buildCompareArtifact(params: BuildCompareArtifactParams): CompareArtifact {
  const algorithms = params.algorithms.map((a) => {
    const { codeVersion, paramSetName } = splitManifestVersion(a.id, a.version);
    return { id: a.id, version: a.version, codeVersion, paramSetName };
  });
  const slices = attachRpCalibration(params.slices, params.rpCalibration);
  const candidate = {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: params.generation,
    computedAt: params.computedAt ?? new Date().toISOString(),
    algorithms,
    slices,
  };
  return CompareArtifactSchema.parse(candidate);
}

// ---------------------------------------------------------------------------
// Size-stat tracking (D-05) — lives in publishBudget.ts; re-exported here so
// existing importers of these names keep working
// ---------------------------------------------------------------------------

export { computeSizeStats, type PageKindSizeStats, type PublishedObjectRecord };

const UPLOAD_HEADERS = { contentType: "application/json", cacheControl: "public, max-age=60" } as const;

/**
 * The publisher's uploader (D-26: `application/json`, `max-age=60`). Records
 * every candidate object's page kind/key/byte length REGARDLESS of `dryRun`
 * — `--dry-run` assembles and validates everything and still prints the size
 * summary (the whole reason `--dry-run` exists is to re-measure budgets
 * without spending a Class-A operation), it just skips the actual
 * `putObject` call.
 *
 * Quick task 260913-nvn: every page-kind object is asserted against
 * `PAGE_BUDGET_MAX_BYTES` BEFORE it is recorded or queued, in both modes, so
 * an over-budget object is never uploaded. Real puts drain through a bounded
 * `UploadQueue` while the build loop keeps going: each publish call resolves
 * once its put is ACCEPTED, and that await is the build loop's backpressure.
 *
 * Design note — the ceiling is checked per object at enqueue, so objects from
 * EARLIER blocks may already be in R2 when a later object fails its ceiling.
 * That is the same exposure as any mid-run network failure (keys are
 * version-addressed and the next successful run overwrites them in place).
 * `--dry-run` is therefore the complete budget pre-flight; the stricter
 * "nothing uploads until everything is built" reading would forfeit the
 * build/upload overlap the queue exists to add.
 */
class BoundedUploader {
  readonly records: PublishedObjectRecord[] = [];
  /**
   * Quick task 260905-tll Task 4 (PD-01): pre-schedule sidecar uploads,
   * recorded SEPARATELY from the `PageKind`-keyed `records` array above —
   * the sidecar is deliberately not a `PageKind` (see `preScheduleKey`'s
   * doc comment in pageArtifacts.ts), so it must not enter
   * `computeSizeStats`' per-kind budget accounting or
   * `payloadBudget.test.ts`'s `PAGE_KINDS` gate, and it has no ceiling. Its
   * own size summary is printed from this array at the end of the run.
   */
  readonly sidecarRecords: { key: string; bytes: number }[] = [];
  readonly #queue: UploadQueue;

  constructor(
    private readonly bucket: string,
    concurrency: number,
    private readonly dryRun: boolean
  ) {
    this.#queue = new UploadQueue({ concurrency });
  }

  #put(key: string, body: string): Promise<void> {
    return putObject(this.bucket, key, body, UPLOAD_HEADERS);
  }

  #record(pageKind: PageKind, key: string, body: string): void {
    const bytes = Buffer.byteLength(body, "utf8");
    assertWithinPageBudget(pageKind, key, bytes, PAGE_BUDGET_MAX_BYTES);
    this.records.push({ pageKind, key, bytes });
  }

  /** Asserts the ceiling, records, and (real runs only) resolves once the put is accepted by the queue. */
  publish(pageKind: PageKind, key: string, body: string): Promise<void> {
    this.#record(pageKind, key, body);
    if (this.dryRun) return Promise.resolve();
    return this.#queue.enqueue(() => this.#put(key, body));
  }

  /**
   * Quick task 260905-tll Task 4: a sidecar and its event artifact, queued as
   * ONE task that puts the sidecar and then the event artifact, following the
   * repo's established artifacts-before-index ordering rule. The event
   * artifact's ceiling is asserted before anything is queued.
   */
  publishSidecarThenEvent(sidecarKey: string, sidecarBody: string, eventKey: string, eventBody: string): Promise<void> {
    this.#record("event", eventKey, eventBody);
    this.sidecarRecords.push({ key: sidecarKey, bytes: Buffer.byteLength(sidecarBody, "utf8") });
    if (this.dryRun) return Promise.resolve();
    return this.#queue.enqueue(async () => {
      await this.#put(sidecarKey, sidecarBody);
      await this.#put(eventKey, eventBody);
    });
  }

  /** Waits for every queued put; rejects with the first put failure. */
  drain(): Promise<void> {
    return this.#queue.drain();
  }

  /** The failure path: drops puts not yet started and lets in-flight puts settle, ignoring their outcomes. */
  abandon(): Promise<void> {
    return this.#queue.abandon();
  }
}

// ---------------------------------------------------------------------------
// Pre-schedule sidecar generation (quick task 260905-tll Task 4)
// ---------------------------------------------------------------------------

/** Everything `buildPreScheduleSidecarForEvent` needs to decide, price and serialize one (event, algorithm) pair's sidecar. */
interface PreScheduleSidecarArgs {
  readonly eventKey: string;
  readonly season: number;
  /** The REAL event's TBA `event_type` — load-bearing (PD-06): `eventTierFor` throws for an unmapped type (99/Offseason is deliberately unmapped), so RP-ineligible events must be gated out BEFORE any synthetic match exists. */
  readonly eventType: number;
  /** The REAL event's TBA competition week (`events.week`, 0-indexed), or `null` when TBA gives it none. Passed straight through to every synthetic `UpcomingMatch`. */
  readonly week: number | null;
  readonly algorithm: AlgorithmModule<any>;
  /** The event's published roster — match-derived when matches exist, registered (`event_teams`) otherwise (PD-05). */
  readonly roster: readonly string[];
  /** Qualification matches (played + scheduled) this event has in the corpus — PD-02's freeze predicate AND `matchesPerTeamFor`'s input (C-12). */
  readonly qualMatchCount: number;
  /** Whether a walk-forward pre-event state was captured for this event. Absent exactly when no completed match of this event was replayed with a predecessor state — the cold-start season's first event (PD-04), or an event whose schedule landed but has no completed matches yet. */
  readonly hasPreEventState: boolean;
  readonly preEventState: unknown;
  /** Whether ANY match of this event has been played. Distinguishes the two reasons a pre-event state can be absent: an event that has not started yet (its pre-event state is simply the current one) from the cold-start season's first event (PD-04, genuinely unavailable). */
  readonly hasCompletedMatches: boolean;
  /** Whether a season-final state exists for this algorithm — C-07's current-state pricing source for scheduleless events. */
  readonly hasSeasonFinalState: boolean;
  /**
   * Fills SigmaScout-layer ranking points onto a synthetic match's prediction
   * when the algorithm itself models none (quick task 260909).
   *
   * `buildPreScheduleArtifact` probes the injected `predict` for a pmf and
   * returns `null` without one, which is why the sidecar was VPR-only. The
   * wrapper is applied at the seam below rather than inside `preSchedule.ts`,
   * so that module still owns no pricing math and still sees exactly one
   * `predict` — it simply gets one whose RP is filled the same way every real
   * match's now is.
   */
  readonly fillRankingPoints?: (match: UpcomingMatch, prediction: Prediction) => Prediction;
  readonly seasonFinalState: unknown;
  readonly generation: string;
  readonly computedAt: string;
}

/**
 * Decides whether one (event, algorithm) pair gets a pre-schedule sidecar,
 * and builds + serializes it when it does (C-04/C-05/C-06/C-07, PD-02/PD-04/
 * PD-06). Returns `undefined` on every skip. The caller must upload the
 * returned body BEFORE the event artifact for the same event (the
 * established artifacts-before-index ordering rule).
 *
 * PD-02 — "freeze once the schedule lands" is a source-of-state switch, not
 * an R2 read-before-write: at least one qualification match row in the
 * corpus (played or scheduled) means the schedule HAS landed, so the sidecar
 * prices from the walk-forward PRE-EVENT state (C-06) — stable across
 * republishes because it is a function of the corpus prefix, not of the
 * run. Zero qualification rows means the schedule has not landed, so the
 * sidecar prices from current (season-final) state and regenerates every
 * full publish (C-07). No R2 read, no freeze flag.
 *
 * A roster outside the generator's `MIN_SCHEDULE_TEAMS..MAX_SCHEDULE_TEAMS`
 * range is skipped with a logged reason by an explicit size check before
 * building, so any error the builder throws fails the whole run.
 *
 * A `null` from `buildPreScheduleArtifact` means this algorithm does not
 * model ranking points (the ordinary opr/epa answer) — skipped silently, so
 * a full-season publish across three algorithms produces no log spam.
 *
 * 260912-2ur: the returned `body` is the PUBLISHED projection of `artifact`,
 * not `artifact` itself. `buildPreScheduleArtifact` above still returns the
 * priced `schedules` block in full — `scripts/measureFieldAveragedRanks.ts`
 * needs that block intact as its rung-1 acceptance harness — but this
 * function is the ONE place that
 * block gets serialized to bytes, and `PublishedPreScheduleArtifactSchema.
 * parse()` drops it before `JSON.stringify` ever sees it, carrying
 * `scheduleCount` forward from that block's length instead. Parsing here
 * (rather than hand-building `{ ...artifact, scheduleCount: ... }`) means the
 * count can never disagree with what was actually built, and a future raise
 * of `PRESIM_SCHEDULE_COUNT` needs no edit in this function at all. Measured
 * basis: a live `v1/presim/2026mrcmp/bpr@3.0.0+baseline.json` [pre-rename] object cost
 * 388,484 B to fetch, of which only 12,275 B (3.2%) was ever read by a
 * client — the rest was the priced block, discarded on every load. At 1,000
 * schedules that ratio only gets worse, which is exactly why this drops
 * before the count is raised rather than after.
 */
function buildPreScheduleSidecarForEvent(args: PreScheduleSidecarArgs): { key: string; body: string } | undefined {
  const label = `publish: presim skip ${args.eventKey} [${args.algorithm.id}]`;
  if (!isRpEligibleEventType(args.eventType)) {
    console.log(`${label}: event_type ${args.eventType} is not RP-eligible (PD-06)`);
    return undefined;
  }
  if (args.roster.length < MIN_SCHEDULE_TEAMS || args.roster.length > MAX_SCHEDULE_TEAMS) {
    console.log(
      `${label}: roster has ${args.roster.length} team(s), outside the generator's ${MIN_SCHEDULE_TEAMS}..${MAX_SCHEDULE_TEAMS}-team range`
    );
    return undefined;
  }

  let pricingState: unknown;
  let pricedFrom: "pre-event-walk-forward" | "current-state";
  if (args.qualMatchCount > 0) {
    if (!args.hasPreEventState) {
      // The schedule has landed but no pre-event state was captured. That
      // is two genuinely different situations, and collapsing them into one
      // skip was a real defect: an event whose schedule was just posted but
      // which has NOT started yet would stop regenerating its sidecar, so
      // the last `current-state` one kept serving unchanged through the
      // entire pre-event window — precisely when a reader most wants this
      // tab.
      //
      // If no match of this event has been played, the honest state "before
      // the event" simply IS the state now: nothing from this event has
      // entered the model. Price from it and keep regenerating, exactly as
      // the scheduleless branch below does; the sidecar switches to the
      // frozen walk-forward pricing on the first publish after the event's
      // first completed match.
      if (!args.hasCompletedMatches && args.hasSeasonFinalState) {
        pricingState = args.seasonFinalState;
        pricedFrom = "current-state";
      } else {
        // The remaining case is PD-04's: this event HAS completed matches
        // but no predecessor state exists — the cold-start season's very
        // first event, whose honest pre-event state is the algorithm's
        // internal cold-start state, which `WalkForwardSimulator` does not
        // expose. Never substitute a later state for it.
        console.log(`${label}: no pre-event walk-forward state was captured (PD-04 — the cold-start season's first event)`);
        return undefined;
      }
    } else {
      pricingState = args.preEventState;
      pricedFrom = "pre-event-walk-forward";
    }
  } else {
    if (!args.hasSeasonFinalState) {
      console.log(`${label}: no season-final state exists for this algorithm`);
      return undefined;
    }
    pricingState = args.seasonFinalState;
    pricedFrom = "current-state";
  }

  // C-12: the real schedule's own matches-per-team when it is known,
  // Statbotics' 12 (10 for Championship Divisions) when it is not.
  const matchesPerTeam =
    args.qualMatchCount > 0 ? matchesPerTeamFor(args.roster.length, args.qualMatchCount) : defaultMatchesPerTeam(args.eventType);

  const artifact = buildPreScheduleArtifact({
    eventKey: args.eventKey,
    season: args.season,
    eventType: args.eventType,
    week: args.week,
    algorithmId: args.algorithm.id,
    algorithmVersion: args.algorithm.version,
    roster: args.roster,
    matchesPerTeam,
    pricedFrom,
    scheduleCount: PRESIM_SCHEDULE_COUNT,
    drawsPerSchedule: PRESIM_DRAWS_PER_SCHEDULE,
    generation: args.generation,
    computedAt: args.computedAt,
    // The C-04 seam: bound HERE to the chosen walk-forward/current state,
    // so every published pmf is produced by the SAME `algorithm.predict()`
    // joint-covariance RP path real matches use — this module owns no
    // pricing math and no independence approximation can exist in it.
    predict: (match) => {
      const prediction = args.algorithm.predict(pricingState, match);
      return args.fillRankingPoints === undefined ? prediction : args.fillRankingPoints(match, prediction);
    },
  });
  if (artifact === null) return undefined; // RP-less algorithm — silent by design

  const key = preScheduleKey({ eventKey: args.eventKey, algorithmId: args.algorithm.id, version: args.algorithm.version });
  return { key, body: JSON.stringify(PublishedPreScheduleArtifactSchema.parse(artifact)) };
}

// ---------------------------------------------------------------------------
// Corpus lookups shared across both CLI modes
// ---------------------------------------------------------------------------

interface TeamInfo {
  readonly teamNumber: number;
  readonly nickname: string;
}

function lookupAllTeamInfo(db: Corpus): Map<string, TeamInfo> {
  const rows = db.prepare(`SELECT team_key, team_number, nickname FROM teams`).all() as {
    team_key: string;
    team_number: number;
    nickname: string | null;
  }[];
  const map = new Map<string, TeamInfo>();
  for (const row of rows) {
    map.set(row.team_key, { teamNumber: row.team_number, nickname: row.nickname ?? "" });
  }
  return map;
}

function teamInfoOrFallback(teamInfo: ReadonlyMap<string, TeamInfo>, teamKey: string): TeamInfo {
  return teamInfo.get(teamKey) ?? { teamNumber: fallbackTeamNumber(teamKey), nickname: "" };
}

/**
 * Replaces each metric's `percentile` with the compact `tier` the teams
 * table actually consumes. Common is omitted entirely (it renders unboxed),
 * so absence means "Common or unranked". Exported (quick task 260909-tgf)
 * for direct unit testing of the consistency metric's tier-stamping behaviour.
 */
export function withPublishedTiers(metrics: Record<string, { value: number; spread?: number; percentile?: number }>): Record<string, { value: number; spread?: number; tier?: "rare" | "epic" | "legendary" }> {
  const out: Record<string, { value: number; spread?: number; tier?: "rare" | "epic" | "legendary" }> = {};
  for (const [key, metric] of Object.entries(metrics)) {
    const tier = publishedTierForPercentile(metric.percentile);
    out[key] = {
      value: metric.value,
      ...(metric.spread !== undefined ? { spread: metric.spread } : {}),
      ...(tier !== undefined ? { tier } : {}),
    };
  }
  return out;
}

/**
 * D-10, D-09, D-11, plan 07-09: the metrics handed in (`metricsByTeam`) are
 * AS-OF-EVENT — the caller derives them through `metricsAsOfEvent` below —
 * while `rankingPools` is always THE season ranking pool (quick task
 * 260912-tnk: every team's metrics as of its last official match) built once
 * per (algorithm, season). This is the same split `withHistoryPercentiles`
 * applies to history rows; the merge itself is `withEventPercentiles`. Required rather than optional (PD-02): an
 * optional pool is an opt-out, and an artifact published without
 * percentiles parses, uploads, and renders a page with every tier box dark.
 *
 * Quick task 260913-jkp: `sigmaByTeam` is REQUIRED, not optional, for the
 * same PD-02 reason — an optional input is an opt-out. Sigma-enabled
 * algorithms pass the SAME `sigmaMetricForAlgo` object that already feeds the
 * Teams row and the team-season artifact (`sigmaMetricByTeam`, computed
 * once per (algorithm, season)); every other algorithm passes an empty
 * object. The entry is merged in AFTER `withEventPercentiles`, as the LAST
 * key, so the season ranking pool never sees or re-ranks Sigma: its
 * percentile is already the inverted residual percentile
 * `sigmaMetricByTeam` produced, never re-inverted or recomputed here. A
 * team with no entry gets no key at all (present-and-undefined is never
 * published). This is why SPR standings now carry the season-final sigma
 * entry beside the AS-OF-EVENT Total and phase values: the same value the
 * Teams row and team page publish, by construction (T-jkp-04).
 */
function buildEventTeamsStanding(
  metricsByTeam: TeamMetrics,
  teamKeys: readonly string[],
  teamInfo: ReadonlyMap<string, TeamInfo>,
  rankingPools: ReadonlyMap<string, readonly number[]>,
  sigmaByTeam: Readonly<Record<string, SigmaMetricEntry>>
): EventTeamStandingInput[] {
  return teamKeys.map((teamKey) => {
    const info = teamInfoOrFallback(teamInfo, teamKey);
    const metrics = withEventPercentiles(metricsByTeam[teamKey] ?? {}, rankingPools);
    const sigma = sigmaByTeam[teamKey];
    return {
      teamKey,
      teamNumber: info.teamNumber,
      nickname: info.nickname,
      metrics: sigma !== undefined ? { ...metrics, [SIGMA_METRIC_KEY]: sigma } : metrics,
    };
  });
}

/**
 * D-10, RESEARCH.md Question 3, plan 07-09: returns the walk-forward
 * metrics AS OF one event's last chronological match, captured through the
 * per-match completion hook `publishSeasons`'s replay loop already pays for
 * (D-28).
 *
 * A missing entry in `stateByEventKey` means this event produced no capture
 * for its key — an event with no completed matches,
 * for which "the state at that event's end" is not a quantity that exists
 * yet — so the season-final metrics are the only defensible answer, and are
 * exactly what was published before this plan (PD-04). This is the ONLY
 * fallback this function knows about; a missing entry for any other reason
 * is not a case it handles, and widening it would publish a page asserting
 * "what the model knew at this event" while showing what it knew at
 * season's end, with nothing anywhere able to detect it.
 *
 * The guard below is an explicit `state !== undefined` test, never
 * truthiness and never a `??`/`||` shorthand — `state` is typed `unknown`
 * and a truthiness guard would be a silent trap for a future state shape.
 */
function metricsAsOfEvent(
  algorithm: AlgorithmModule<any>,
  stateByEventKey: ReadonlyMap<string, unknown>,
  eventKey: string,
  eventTeamKeys: readonly string[],
  seasonFinalMetrics: TeamMetrics
): TeamMetrics {
  const state = stateByEventKey.get(eventKey);
  if (state !== undefined) {
    return algorithm.teamMetrics(state, eventTeamKeys);
  }
  return seasonFinalMetrics;
}

function groupByEvent<T extends { readonly match: { readonly eventKey: string } }>(records: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const record of records) {
    const list = map.get(record.match.eventKey) ?? [];
    list.push(record);
    map.set(record.match.eventKey, list);
  }
  return map;
}

/** The two per-algorithm stamps on an events-list body — re-validated when a season's shared events base is re-stamped for each algorithm (quick task 260913-nvn). */
const EventsArtifactStampSchema = EventsArtifactSchema.pick({ algorithmId: true, algorithmVersion: true });

// ---------------------------------------------------------------------------
// Phase timings (quick task 260913-nvn)
// ---------------------------------------------------------------------------

/**
 * Wall-clock milliseconds per labelled publish phase, accumulated across
 * calls with the same label. Printed as the run summary's `timing:` lines and
 * returned on `PublishSummary.timings`, so a republish documents where its
 * time went instead of reporting one end-to-end duration.
 */
class PhaseTimings {
  readonly ms: Record<string, number> = {};

  add(label: string, elapsedMs: number): void {
    this.ms[label] = (this.ms[label] ?? 0) + elapsedMs;
  }

  time<T>(label: string, fn: () => T): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      this.add(label, performance.now() - start);
    }
  }

  async timeAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.add(label, performance.now() - start);
    }
  }
}

// ---------------------------------------------------------------------------
// publishSeasons — the full multi-season, multi-page, multi-algorithm publish
// ---------------------------------------------------------------------------

export interface PublishSeasonsOptions {
  readonly seasons: readonly number[];
  readonly algorithms: readonly AlgorithmModule<any>[];
  readonly bucket: string;
  readonly concurrency?: number;
  readonly dryRun?: boolean;
  readonly skipState?: boolean;
  /**
   * D-08, RESEARCH.md Pitfall 1, plan 07-09: defaults to `false`, so a run
   * that does not ask for offseason gets the pre-existing behavior
   * unchanged. Now settable from the CLI as `--include-offseason`
   * (`main()`'s `parseArgs`, threaded through `runSeasonsCliMode`) — before
   * plan 07-09 this field existed but nothing could set it, which meant
   * the standard `--seasons` republish published NO event artifact for any
   * of the 259 corpus events with no ranking rows, including `2025isios`
   * (68 matches), `2023cnsh` (62) and `2024auwarp` (62), the exact events
   * D-08's fallback was measured against. A run WITHOUT this flag will not
   * rewrite offseason event artifacts a previous run wrote — this function
   * deletes nothing, so those objects survive and go stale rather than
   * disappearing.
   */
  readonly includeOffseason?: boolean;
  /**
   * Quick task 260905-tll Task 4 (C-05): the first season that gets
   * pre-schedule sidecars. Defaults to `DEFAULT_PRESCHEDULE_FROM_SEASON`
   * (2026); settable from the CLI as `--presim-from-season`. A parameter
   * end to end — the cutoff appears in exactly one place (the default) and
   * nowhere inside the per-event logic.
   */
  readonly preScheduleFromSeason?: number;
  readonly generation?: string;
  readonly computedAt?: string;
  /** F1/D-09/D-11 (phase 09 plan 09-01 Task 2): the RP calibration measurement to attach onto the compare artifact's matching qualification slices. `undefined` attaches nothing — the CLI's default resolves this from `RP_CALIBRATION_MEASUREMENT_PATH` via `loadRpCalibrationMeasurement`, so an ordinary run needs no new flag once the baseline is committed. */
  readonly rpCalibration?: RpCalibrationMeasurement;
}

export interface PublishSummary {
  readonly generation: string;
  readonly computedAt: string;
  readonly objectCount: number;
  readonly totalBytes: number;
  readonly pages: Partial<Record<PageKind, PageKindSizeStats>>;
  readonly seedFiles: readonly string[];
  readonly manifestKeys: readonly string[];
  /** Wall-clock milliseconds per publish phase, keyed by label (quick task 260913-nvn): `season {year} replay|fold|compare`, `{year}/{algorithm} build|sidecars|uploadWait`, `uploadDrain`, and `total`. */
  readonly timings: Readonly<Record<string, number>>;
  /** Pre-schedule sidecar size stats — not a `PageKind`, so outside `pages` (PD-01); `undefined` when the run wrote none. */
  readonly sidecars?: PageKindSizeStats;
}

interface TeamSeasonStats {
  wins: number;
  losses: number;
  ties: number;
  eventKeys: Set<string>;
  matchCount: number;
}

function computeTeamSeasonStats(matches: readonly MatchResult[]): Map<string, TeamSeasonStats> {
  const stats = new Map<string, TeamSeasonStats>();
  const ensure = (team: string): TeamSeasonStats => {
    let s = stats.get(team);
    if (!s) {
      s = { wins: 0, losses: 0, ties: 0, eventKeys: new Set(), matchCount: 0 };
      stats.set(team, s);
    }
    return s;
  };
  for (const m of matches) {
    for (const team of m.redTeams) {
      const s = ensure(team);
      s.matchCount++;
      s.eventKeys.add(m.eventKey);
      if (m.winner === "red") s.wins++;
      else if (m.winner === "blue") s.losses++;
      else s.ties++;
    }
    for (const team of m.blueTeams) {
      const s = ensure(team);
      s.matchCount++;
      s.eventKeys.add(m.eventKey);
      if (m.winner === "blue") s.wins++;
      else if (m.winner === "red") s.losses++;
      else s.ties++;
    }
  }
  return stats;
}

interface EventCounts {
  teamKeys: Set<string>;
  matchCount: number;
  playedMatchCount: number;
}

function computeEventCounts(played: readonly MatchResult[], scheduled: readonly UpcomingMatch[]): Map<string, EventCounts> {
  const map = new Map<string, EventCounts>();
  const ensure = (key: string): EventCounts => {
    let e = map.get(key);
    if (!e) {
      e = { teamKeys: new Set(), matchCount: 0, playedMatchCount: 0 };
      map.set(key, e);
    }
    return e;
  };
  for (const m of played) {
    const e = ensure(m.eventKey);
    for (const t of m.redTeams) e.teamKeys.add(t);
    for (const t of m.blueTeams) e.teamKeys.add(t);
    e.matchCount++;
    e.playedMatchCount++;
  }
  for (const m of scheduled) {
    const e = ensure(m.eventKey);
    for (const t of m.redTeams) e.teamKeys.add(t);
    for (const t of m.blueTeams) e.teamKeys.add(t);
    e.matchCount++;
  }
  return map;
}

interface EventMetaRow {
  event_key: string;
  event_type: number;
  is_offseason: number;
  start_date: string;
  /** plan 05-02 (EVNT-01) — nullable: NULL until an --events-only refetch fills it. */
  name: string | null;
  week: number | null;
  country: string | null;
  state_prov: string | null;
  district_key: string | null;
}

function selectEventMeta(db: Corpus, season: number): EventMetaRow[] {
  return db
    .prepare(
      `SELECT event_key, event_type, is_offseason, start_date, name, week, country, state_prov, district_key
       FROM events WHERE year = ? ORDER BY event_key ASC`
    )
    .all(season) as EventMetaRow[];
}

interface MatchTimeRow {
  match_key: string;
  sort_time: number;
}

/**
 * D-08 (Phase 6): `match_key` -> `sort_time` for EVERY match in a season,
 * played or not — `selectScheduledMatches` (packages/corpus/db.ts) orders by
 * `sort_time` but does not return it, and `UpcomingMatch` deliberately
 * carries no time field (widening it would touch the leak-proof `predict()`
 * input surface). This module-local query is the correct seam instead,
 * mirroring `selectEventMeta`'s own local-helper style. Scoping
 * (`excludeOffseason`) mirrors the season loop's own scope so this map never
 * disagrees with which matches the rest of the run counts.
 */
function selectScheduledMatchTimes(db: Corpus, season: number, options: { excludeOffseason?: boolean } = {}): Map<string, number> {
  const clauses: string[] = ["e.year = @year"];
  const params: Record<string, string | number> = { year: season };
  if (options.excludeOffseason === true) {
    clauses.push("e.is_offseason = 0");
  }
  const rows = db
    .prepare(
      `SELECT m.match_key, m.sort_time
       FROM matches m
       JOIN events e ON e.event_key = m.event_key
       WHERE ${clauses.join(" AND ")}`
    )
    .all(params) as MatchTimeRow[];
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.match_key, row.sort_time);
  return map;
}

interface MatchVideoRow {
  match_key: string;
  video_key: string | null;
}

/**
 * Quick task 260906-7eu: `match_key` -> `video_key` for every match in a
 * season whose `video_key` column is a non-empty string — mirrors
 * `selectScheduledMatchTimes`'s shape and `excludeOffseason` scoping
 * exactly, so the two maps never disagree about which matches the rest of
 * this run counts. A `NULL`/empty `video_key` never enters the returned map
 * — absence from the map, not a `null` value inside it, is how a row with no
 * video reaches `buildEventArtifact`/`buildTeamSeasonArtifact`'s row
 * builders, both of which look the match key up with a conditional spread.
 */
function selectMatchVideoKeys(db: Corpus, season: number, options: { excludeOffseason?: boolean } = {}): Map<string, string> {
  const clauses: string[] = ["e.year = @year"];
  const params: Record<string, string | number> = { year: season };
  if (options.excludeOffseason === true) {
    clauses.push("e.is_offseason = 0");
  }
  const rows = db
    .prepare(
      `SELECT m.match_key, m.video_key
       FROM matches m
       JOIN events e ON e.event_key = m.event_key
       WHERE ${clauses.join(" AND ")}`
    )
    .all(params) as MatchVideoRow[];
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.video_key !== null && row.video_key.length > 0) map.set(row.match_key, row.video_key);
  }
  return map;
}

/** D-08 (Phase 6): the same comp-level play-order `selectScheduledMatches`'s own `CASE` clause uses, mirrored here so the two orderings cannot drift. */
const COMP_LEVEL_RANK: Record<CompLevel, number> = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 };

/**
 * D-08/TEAM-05 (Phase 6): sorts one event's played+scheduled records by
 * `sortTime` ascending, with `compLevel` rank, `setNumber`, `matchNumber`
 * and finally `matchKey` as successive tie-breaks — the same chain
 * `selectScheduledMatches` uses, so the two orderings cannot drift apart. A
 * match absent from `sortTimeByMatchKey` (should not happen for a real
 * corpus row, but defensive against a hand-built test fixture) sorts last.
 */
function sortTeamSeasonMatches(
  matches: readonly (PredictionRecord | UpcomingPredictionRecord)[],
  sortTimeByMatchKey: ReadonlyMap<string, number>
): (PredictionRecord | UpcomingPredictionRecord)[] {
  return [...matches].sort((a, b) => {
    const aTime = sortTimeByMatchKey.get(a.match.matchKey) ?? Number.POSITIVE_INFINITY;
    const bTime = sortTimeByMatchKey.get(b.match.matchKey) ?? Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    const aRank = COMP_LEVEL_RANK[a.match.compLevel];
    const bRank = COMP_LEVEL_RANK[b.match.compLevel];
    if (aRank !== bRank) return aRank - bRank;
    if (a.match.setNumber !== b.match.setNumber) return a.match.setNumber - b.match.setNumber;
    if (a.match.matchNumber !== b.match.matchNumber) return a.match.matchNumber - b.match.matchNumber;
    return a.match.matchKey.localeCompare(b.match.matchKey);
  });
}

/**
 * Widens the 04-01 tracer into the full offline publisher (D-01 through
 * D-08, D-25/D-26). Its own local season loop threads `carrySeason`
 * boundary state via `liveStates`, because this function needs D-12's
 * live-state snapshot (`finalStates`) that a predictions-only return would
 * drop. `buildSeasonStream`/
 * `WalkForwardSimulator` (the actual leak-proof replay primitives) are
 * reused unchanged; only the orchestration around them is mirrored.
 */
export async function publishSeasons(db: Corpus, options: PublishSeasonsOptions): Promise<PublishSummary> {
  const uploader = new BoundedUploader(options.bucket, options.concurrency ?? DEFAULT_CONCURRENCY, options.dryRun ?? false);
  try {
    return await publishSeasonsWith(db, options, uploader);
  } catch (err) {
    // Quick task 260913-nvn: let puts already in flight settle (ignoring their
    // outcomes) so nothing is still writing when the caller sees the failure,
    // then rethrow the ORIGINAL error.
    await uploader.abandon();
    throw err;
  }
}

async function publishSeasonsWith(db: Corpus, options: PublishSeasonsOptions, uploader: BoundedUploader): Promise<PublishSummary> {
  const generation = options.generation ?? randomUUID();
  const computedAt = options.computedAt ?? new Date().toISOString();
  const dryRun = options.dryRun ?? false;
  const includeOffseason = options.includeOffseason ?? false;
  const preScheduleFromSeason = options.preScheduleFromSeason ?? DEFAULT_PRESCHEDULE_FROM_SEASON;
  const seasonsSorted = [...options.seasons].sort((a, b) => a - b);
  const stamp: StateStamp = { generation, computedAt };

  const runStart = performance.now();
  const timings = new PhaseTimings();
  const teamInfo = lookupAllTeamInfo(db);
  const seedFiles: string[] = [];
  const manifestKeys: string[] = [];

  // D-05 (Phase 6): activeYears cross-season pre-pass, run once over EVERY
  // requested season before the season loop below (which only ever touches
  // one season at a time) — inverts `selectTeamKeysForYear` per season into
  // teamKey -> the sorted list of seasons that team is known to have
  // competed in. A run narrower than the full published range under-reports
  // this by construction (it can only know about the seasons it was asked
  // to touch), so that narrowing is logged explicitly rather than silently
  // shipped — a silently under-reported activeYears would wrongly hide real
  // years from the team page's year dropdown (D-18).
  const activeYearsByTeam = new Map<string, number[]>();
  for (const activeYearsSeason of seasonsSorted) {
    const teamKeysThisSeason = selectTeamKeysForYear(db, activeYearsSeason, { excludeOffseason: !includeOffseason });
    for (const teamKey of teamKeysThisSeason) {
      const years = activeYearsByTeam.get(teamKey) ?? [];
      years.push(activeYearsSeason);
      activeYearsByTeam.set(teamKey, years);
    }
  }
  for (const years of activeYearsByTeam.values()) years.sort((a, b) => a - b);
  if (seasonsSorted.length < 5) {
    console.log(
      `publish: this run's season set (${seasonsSorted.join(", ")}) is narrower than the full published range — ` +
        `activeYears will reflect only these seasons, not a team's full competition history.`
    );
  }

  let liveStatesAcrossSeasons = new Map<string, unknown>();
  let finalSeasonStates = new Map<string, unknown>();
  /** Shape 15 (plan 09-08): the per-team RP beliefs that ride the SAME seed, from the SAME population, keyed by algorithm id. */
  let finalSeasonRp = new Map<string, ReadonlyMap<string, RpTeamBeliefs>>();
  /** Shape 16 (quick task 260914-01x): the RP mean shift that rides the LEAGUE row of the same seed. Sparse: absent for an algorithm that publishes no ranking points. */
  let finalSeasonRpMeanShift = new Map<string, RpMeanShiftState>();
  /**
   * Shape 11: the per-team Sigma Score beliefs, and the league-wide talent
   * population behind them, that ride the SAME seed — keyed by algorithm id.
   *
   * Only an algorithm in `SIGMA_SCORE_ALGORITHM_IDS` has either, so both maps
   * are SPARSE by design: an entry is absent rather than empty for an
   * algorithm that publishes no Sigma Score, and the seed for such an
   * algorithm must carry no Sigma key at all.
   */
  let finalSeasonSigma = new Map<string, ReadonlyMap<string, SigmaBelief>>();
  let finalSeasonSigmaPopulation = new Map<string, SigmaPopulation>();

  for (const [seasonIdx, season] of seasonsSorted.entries()) {
    const stream = buildSeasonStream(db, season, { includeOffseason });
    const scheduled = selectScheduledMatches(db, { year: season, excludeOffseason: !includeOffseason });
    // Published-surface exclusion (`.planning/todos/pending/exclude-offseason-demo-teams.md`
    // scope item 2): every one of the 30 `frc9970`-`frc9999` "Off-Season Demo
    // Team" keys is filtered out of the published team list HERE, the single
    // place `teamsThisSeason` is built — this is what stops a
    // `team/{teamKey}/{year}` page, a `teams/{year}` row, a search hit, or a
    // ranking entry from ever being produced for a demo key. The MODEL-side
    // exclusion (`demoTeams.ts`, `ratingEligibleTeams`) is independent of
    // this filter: even if a demo key slipped back into this list, no
    // algorithm's internal state is ever keyed by a raw demo key (every one
    // is remapped to the shared, unpublished `DEMO_PSEUDO_TEAM_KEY` before it
    // reaches any design matrix / per-team state), so `teamMetrics` would
    // simply return nothing for it — this filter's job is solely to stop an
    // empty-metrics row/page from being iterated and published at all.
    const teamsThisSeason = Array.from(
      new Set([...stream.flatMap((m) => [...m.redTeams, ...m.blueTeams]), ...scheduled.flatMap((m) => [...m.redTeams, ...m.blueTeams])])
    ).filter((teamKey) => !isDemoTeamKey(teamKey));
    const eventMeta = selectEventMeta(db, season);
    const offseasonEventKeys = new Set(eventMeta.filter((e) => e.is_offseason === 1).map((e) => e.event_key));
    // Quick task 260904-586: the Teams-list metric snapshot must be scoped
    // to official play. Built once per season, outside the per-algorithm
    // loop, from the same `eventMeta` rows `offseasonEventKeys` above reads
    // — the shared `isOfficialEventType` predicate (also read by
    // `apps/worker/src/scheduled.ts` and `apps/web/src/lib/
    // officialSnapshot.ts`) is what keeps this set from drifting from
    // either of those.
    const officialEventKeys = new Set(eventMeta.filter((e) => isOfficialEventType(e.event_type)).map((e) => e.event_key));
    // Quick task 260905-tll Task 4 (C-15/C-17): the registered-teams map for
    // every event key this season, read ONCE per season, before the
    // per-algorithm loop. `selectEventTeamsForEvents`' absence discipline is
    // respected exactly: an event with no rows is ABSENT from the map, and
    // an absent key means "unknown", not "zero teams" — it is never
    // coalesced into an empty array and published as an empty roster.
    const registeredTeamsByEvent = selectEventTeamsForEvents(
      db,
      eventMeta.map((e) => e.event_key)
    );
    // Quick task 260905-tll Task 4 (PD-02): qualification matches (played +
    // scheduled) per event — the corpus-derived "has the schedule landed?"
    // predicate, and `matchesPerTeamFor`'s qual-count input (C-12).
    const qualMatchCountByEvent = new Map<string, number>();
    for (const m of stream) {
      if (m.compLevel === "qm") qualMatchCountByEvent.set(m.eventKey, (qualMatchCountByEvent.get(m.eventKey) ?? 0) + 1);
    }
    for (const m of scheduled) {
      if (m.compLevel === "qm") qualMatchCountByEvent.set(m.eventKey, (qualMatchCountByEvent.get(m.eventKey) ?? 0) + 1);
    }
    // C-05: the season gate is checked once per season (and logged once)
    // rather than once per (event, algorithm) — the per-event skip logging
    // below covers only seasons that are actually in presim scope.
    const presimEnabled = season >= preScheduleFromSeason;
    if (!presimEnabled) {
      console.log(`publish: presim: season ${season} is below presim-from-season ${preScheduleFromSeason} — no sidecars this season.`);
    }
    // D-08 (Phase 6): match_key -> sort_time for every match this season,
    // played or not — feeds both TeamSeasonMatchSchema.sortTime and the
    // per-event match ordering below (sortTeamSeasonMatches).
    const sortTimeByMatchKey = selectScheduledMatchTimes(db, season, { excludeOffseason: !includeOffseason });
    // Quick task 260906-7eu: match_key -> raw YouTube video key for every
    // match this season, mirroring sortTimeByMatchKey's own read and scope
    // exactly — fed into both the event and team artifact builders below.
    const videoByMatchKey = selectMatchVideoKeys(db, season, { excludeOffseason: !includeOffseason });
    // D-03 (Phase 6): the robot-photo lookup, once per season (media is not
    // algorithm-scoped) — plan 06-03's team_media table, filled offline by
    // the media ingest pass. A null stored `imageUrl` (or no row at all) is
    // the resolved "this team has no usable photo this year" answer, so it
    // is passed through as `undefined` below, never fetched or guessed here.
    const teamMediaForSeason = selectTeamMediaForYear(db, season);
    // TEAM-04/F-06-3 (plan 06.1-01): the event-standing lookup, once per
    // season (like teamMediaForSeason above, this is not algorithm-scoped)
    // — event_key -> team_key -> {rank, totalTeams}, filled offline by the
    // rankings ingest pass (`pnpm ingest:rankings`). A missing outer or
    // inner entry leaves both fields undefined at the per-team assembly
    // site below — never fetched, never guessed, never zero.
    const eventRankingsForSeason = selectEventRankingsForSeason(db, season);
    // D-18 item 7, plan 07-08: this event's playoff alliance selections,
    // once per season — beside the ranking read above, both season-scoped
    // map reads sitting together rather than one per event. `?? []` at the
    // per-event call site below is what makes the published `alliances` key
    // always present post-republish while still meaning "zero rows" rather
    // than "unknown", because this call site has, by construction,
    // consulted the corpus (PD-03).
    const alliancesForSeason = selectEventAlliancesForSeason(db, season);
    // Phase 06.1 (F-06-3, PD-09): the algorithm-independent actual per-bonus
    // flag map, built ONCE per season here — outside the per-algorithm loop
    // below — since the raw score breakdown and this season's RP rule
    // module describe the match, not a prediction. See
    // `actualBonusFlagsForSeason`'s own doc comment for the full null
    // contract and its exact correspondence with the retired Sigma1 core's
    // `update()` RP-fold skip predicate.
    const actualBonusFlagsByMatchKey = actualBonusFlagsForSeason(stream, season);

    // Quick task 260903-3bv: `fromSeason` is now the ACTUAL preceding
    // element of `seasonsSorted`, not `season - 1` — see `seasonBoundary.ts`'s
    // doc comment for why a hardcoded label became a live behavioural input
    // the moment `carrySeason` started reading `fromSeason` to compute a gap.
    const boundary = seasonBoundaryFor(seasonsSorted, seasonIdx);
    let initialStates: ReadonlyMap<string, unknown> | undefined;
    if (boundary.isColdStart) {
      console.log(`publish: season ${season} is the cold-start season (first season in this run) — every algorithm starts fresh.`);
    } else {
      const carried = new Map<string, unknown>();
      for (const algorithm of options.algorithms) {
        const prior = liveStatesAcrossSeasons.get(algorithm.id);
        if (algorithm.carrySeason && prior !== undefined) {
          carried.set(algorithm.id, algorithm.carrySeason(prior, boundary));
        }
      }
      initialStates = carried;
    }

    // D-07/D-28: per-match, per-algorithm metric snapshots — the metric
    // history a team-season artifact's `metricHistory` needs, collected
    // during the same pass rather than a second corpus read.
    const matchIndexByKey = new Map(stream.map((m, i) => [m.matchKey, i]));
    const algorithmById = new Map(options.algorithms.map((a) => [a.id, a]));
    const metricHistoryByAlgoTeam = new Map<string, Map<string, MetricHistoryRow[]>>();
    for (const algorithm of options.algorithms) metricHistoryByAlgoTeam.set(algorithm.id, new Map());
    // D-10, RESEARCH.md Question 3, plan 07-09: the per-event walk-forward
    // state snapshot — a Map of eventKey -> state, per algorithm — captured
    // inside this SAME per-match completion hook D-28's metric history
    // already pays for (no new corpus query, no second replay pass, no
    // second hook). The hook is handed the state AFTER that algorithm's `update`,
    // so what is stored below is the state as of THAT match's completion;
    // the stream is chronological (`buildSeasonStream`), so the last write
    // for one event key is that event's LAST match, regardless of how many
    // events run the same weekend. Every algorithm's `update` returns a NEW
    // state object (`vpr`/`epa` a fresh literal, `opr` a fresh
    // `{ perEvent, lastEventByTeam }` or the identical state on a genuine
    // non-`qm` no-op) — so storing the reference below is a genuine
    // snapshot, never an alias of the eventually-final state. Cost, from
    // measurement rather than a guess: 9-26 ms of extra `teamMetrics`
    // compute per (season, algorithm) pair, against a replay that already
    // takes 16-29 seconds per season.
    const stateByAlgoEvent = new Map<string, Map<string, unknown>>();
    for (const algorithm of options.algorithms) stateByAlgoEvent.set(algorithm.id, new Map());
    // Quick task 260905-tll Task 4 (C-06): the PRE-event counterpart to
    // `stateByAlgoEvent` above — eventKey -> the state immediately BEFORE
    // that event's first completed match, captured inside this SAME hook.
    // Three facts recorded here rather than rediscovered later: (1) no
    // second replay pass and no second corpus read is added — the capture
    // rides the hook D-28's metric history already pays for; (2) events run
    // concurrently, so "the state before event X's first match" is genuinely
    // the GLOBAL state at that instant — the correct walk-forward answer,
    // not a defect; (3) every algorithm's `update` returns a NEW state
    // object, so storing the reference is a real snapshot, never an alias
    // of the eventually-final state. `lastStateByAlgo` holds the state after
    // the previous chronological match, which is by construction the state
    // immediately before the current event's first match. All lookups use
    // `.has()`, never truthiness — state is typed `unknown` and a falsy
    // state object is representable. `preEventCaptureSeen` exists so the
    // capture decision is made exactly ONCE per (algorithm, event), on that
    // event's FIRST completed match: without it, the cold-start season's
    // first event (which stores nothing — PD-04) would be re-visited on its
    // SECOND match and wrongly given a mid-event state as "pre-event".
    const preEventStateByAlgoEvent = new Map<string, Map<string, unknown>>();
    const preEventCaptureSeen = new Map<string, Set<string>>();
    for (const algorithm of options.algorithms) {
      preEventStateByAlgoEvent.set(algorithm.id, new Map());
      preEventCaptureSeen.set(algorithm.id, new Set());
    }
    const lastStateByAlgo = new Map<string, unknown>();
    /**
     * Per `(algorithmId, matchKey)`, each rostered team's rating AS OF AFTER
     * that match — the Sigma Score talent prior's input. Only populated for
     * algorithms in `SIGMA_SCORE_ALGORITHM_IDS`.
     */
    const talentAfterMatch = new Map<string, Map<string, number>>();
    const onMatchComplete = (match: MatchResult, algorithmId: string, state: unknown): void => {
      const algorithm = algorithmById.get(algorithmId);
      if (!algorithm) return;
      const seen = preEventCaptureSeen.get(algorithmId)!;
      if (!seen.has(match.eventKey)) {
        seen.add(match.eventKey);
        if (lastStateByAlgo.has(algorithmId)) {
          preEventStateByAlgoEvent.get(algorithmId)!.set(match.eventKey, lastStateByAlgo.get(algorithmId));
        } else if (initialStates !== undefined && initialStates.has(algorithmId)) {
          // The season's very first match: the honest pre-event state is the
          // carried (season-boundary) state this season started from.
          preEventStateByAlgoEvent.get(algorithmId)!.set(match.eventKey, initialStates.get(algorithmId));
        }
        // else: the cold-start season's very first event. Its honest
        // pre-event state is the algorithm's internal cold-start state,
        // which WalkForwardSimulator does not expose — deliberately NO
        // entry, so the sidecar path skips it (PD-04) rather than
        // fabricating a confident distribution from nothing.
      }
      lastStateByAlgo.set(algorithmId, state);
      stateByAlgoEvent.get(algorithmId)!.set(match.eventKey, state);
      const involvedTeams = [...match.redTeams, ...match.blueTeams];
      const metrics = algorithm.teamMetrics(state, involvedTeams);
      // SIGMA SCORE's talent prior. Captured from the metrics pass this hook
      // ALREADY runs for metric history, so it costs no extra `teamMetrics`
      // call. `state` here is post-update for THIS match, which is exactly the
      // admissible talent for the team's NEXT match — `SigmaScoutLayer.foldPlayed`
      // applies it after folding, so a match never informs its own prior.
      if (usesSigmaScore(algorithmId)) {
        const talent = new Map<string, number>();
        for (const teamKey of involvedTeams) {
          const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
          if (total !== undefined) talent.set(teamKey, total);
        }
        talentAfterMatch.set(`${algorithmId}:${match.matchKey}`, talent);
      }
      const byTeam = metricHistoryByAlgoTeam.get(algorithmId)!;
      for (const teamKey of involvedTeams) {
        const row: MetricHistoryRow = {
          matchKey: match.matchKey,
          season,
          eventKey: match.eventKey,
          algorithmId,
          teamKey,
          matchIndex: matchIndexByKey.get(match.matchKey) ?? 0,
          metrics: metrics[teamKey] ?? {},
        };
        const list = byTeam.get(teamKey) ?? [];
        list.push(row);
        byTeam.set(teamKey, list);
      }
    };

    // D-01 (quick task 260909-t5q): `db` is the corpus handle this whole
    // function already has open.
    const simulator = new WalkForwardSimulator(stream, corpusColdStartIndex(db));
    const records = timings.time(`season ${season} replay`, () =>
      simulator.runAll(options.algorithms, teamsThisSeason, initialStates, onMatchComplete)
    );
    const foldStart = performance.now();

    for (const algorithm of options.algorithms) {
      const carryStatus = initialStates?.has(algorithm.id) ? "carried state in" : "started cold";
      const algoCount = records.filter((r) => r.algorithmId === algorithm.id).length;
      console.log(`publish: season ${season} [${algorithm.id}]: ${algoCount} matches replayed (${carryStatus})`);
    }

    // Group by algorithm, then by event / by team — one pass over `records`.
    const perAlgoEventMatches = new Map<string, Map<string, PredictionRecord[]>>();
    const perAlgoTeamMatches = new Map<string, Map<string, PredictionRecord[]>>();
    for (const algorithm of options.algorithms) {
      perAlgoEventMatches.set(algorithm.id, new Map());
      perAlgoTeamMatches.set(algorithm.id, new Map());
    }
    // The level-2 SigmaScout layer — the band and ranking points, one instance
    // per algorithm. `records` is chronological (runAll's outer loop is the
    // match stream), so each instance walks forward with it, which is the
    // ordering `foldPlayed` requires. The per-match math itself lives in
    // `sigmaScoutLayer.ts` — see that module's own header for why it is a
    // module and not a loop body.
    const rpRuleModule = RP_RULE_MODULES[season];
    const layers = new Map<string, SigmaScoutLayer>();
    for (const algorithm of options.algorithms) layers.set(algorithm.id, new SigmaScoutLayer(rpRuleModule, algorithm.id));

    /**
     * Quick task 260913-m45 Task 1: algorithm id -> team key -> match key ->
     * that team's Sigma Score right after `foldPlayed` for that match — the
     * "after this match" reading `withHistorySigma` merges into the
     * team-season build below. Populated ONLY for algorithms where
     * `usesSigmaScore` is true (an empty map for every other algorithm).
     * Deliberately NOT written into `metricHistoryByAlgoTeam`/
     * `metricHistoryForAlgo`: those rows feed the ranking pools, the Teams
     * row and `seasonStats`, where a later spread would silently overwrite a
     * leaked per-match sigma (T-m45-02).
     */
    const sigmaByMatchKeyForAlgoTeam = new Map<string, Map<string, Map<string, number>>>();
    for (const algorithm of options.algorithms) sigmaByMatchKeyForAlgoTeam.set(algorithm.id, new Map());

    for (const r of records) {
      // One object, both maps below — the event page and the team page cannot
      // show different numbers for this match because there is only one number.
      // D-01 (quick task 260909-t5q): `foldPlayed` builds a FRESH
      // `PredictionRecord` from just `(match, prediction)` and has no
      // opinion about cold start, so the raw record's own stamp is spread
      // in here — the single source of truth threads through this fold
      // rather than being silently dropped by it.
      const layer = layers.get(r.algorithmId)!;
      const pr: PredictionRecord = {
        ...layer.foldPlayed(r.match, r.prediction, talentAfterMatch.get(`${r.algorithmId}:${r.match.matchKey}`)),
        ...(r.coldStart === true ? { coldStart: true as const } : {}),
      };
      // Quick task 260913-m45 Task 1: read right after THIS match's fold —
      // the same read-after-fold instant every other history-row metric
      // uses. One team at a time (`SigmaScoutLayer.sigmaFor`), never
      // `sigmaScoreByTeam()` (which scores every team the layer has ever
      // seen and must never be called per match).
      if (usesSigmaScore(r.algorithmId)) {
        const byTeam = sigmaByMatchKeyForAlgoTeam.get(r.algorithmId)!;
        for (const teamKey of new Set([...r.match.redTeams, ...r.match.blueTeams])) {
          const sigma = layer.sigmaFor(teamKey);
          if (sigma === undefined) continue;
          const byMatch = byTeam.get(teamKey) ?? new Map<string, number>();
          byMatch.set(r.match.matchKey, sigma);
          byTeam.set(teamKey, byMatch);
        }
      }
      const eventMap = perAlgoEventMatches.get(r.algorithmId)!;
      const eventList = eventMap.get(r.match.eventKey) ?? [];
      eventList.push(pr);
      eventMap.set(r.match.eventKey, eventList);

      const teamMap = perAlgoTeamMatches.get(r.algorithmId)!;
      for (const teamKey of new Set([...r.match.redTeams, ...r.match.blueTeams])) {
        const teamList = teamMap.get(teamKey) ?? [];
        teamList.push(pr);
        teamMap.set(teamKey, teamList);
      }
    }

    const scheduledByEvent = new Map<string, UpcomingMatch[]>();
    for (const m of scheduled) {
      const list = scheduledByEvent.get(m.eventKey) ?? [];
      list.push(m);
      scheduledByEvent.set(m.eventKey, list);
    }

    // Two populations, deliberately (quick task 260908-615).
    //
    //   `teamStatsAllPlay` covers every replayed match, offseason and
    //   preseason included. Consumed by `deriveTeamRegions` below — home
    //   region is a separate question this task does not reopen, and a team
    //   whose only events are offseason ones must keep its region.
    //
    //   `teamStatsOfficial` covers OFFICIAL play only, and is what the
    //   published W-L-T record, `matchCount` and `eventCount` draw from on
    //   both team surfaces. It filters by the already-built
    //   `officialEventKeys` set rather than re-testing event types here: that
    //   set is derived once per season from the shared `isOfficialEventType`
    //   predicate a couple hundred lines above, and a second derivation is
    //   exactly the drift this codebase has already paid for once.
    const teamStatsAllPlay = computeTeamSeasonStats(stream);
    const teamStatsOfficial = computeTeamSeasonStats(stream.filter((m) => officialEventKeys.has(m.eventKey)));
    const eventCounts = computeEventCounts(stream, scheduled);

    // Quick task 260905-ldu: a team's home region is algorithm-agnostic (it
    // does not depend on which algorithm scored the team), so it is derived
    // exactly ONCE per season here, before the per-algorithm loop below —
    // the same argument `actualBonusFlagsForSeason` above already makes for
    // a per-season-not-per-algorithm quantity. `teamStatsAllPlay`'s own
    // `eventKeys` set (built above, from the same `stream`) is reused directly
    // rather than re-walking the match stream a second time.
    //
    // Quick task 260908-615 deliberately left this input as the ALL-PLAY map
    // rather than switching it to `teamStatsOfficial` alongside the record and
    // counts. The two are equivalent HERE — `deriveTeamRegions` applies its
    // own `isRegionEligibleEvent` filter (official types, minus neutral-site
    // ones), so an offseason event cannot reach a region either way — and
    // keeping the wider input makes this site's behavior provably unchanged
    // by that task rather than merely believed to be. A future reader should
    // NOT read this line as "offseason events contribute to a region": they
    // do not, and never did.
    const teamRegions = deriveTeamRegions({
      teamEventKeys: new Map(Array.from(teamStatsAllPlay.entries(), ([teamKey, stats]) => [teamKey, stats.eventKeys])),
      events: eventMeta.map((e) => ({
        eventKey: e.event_key,
        eventType: e.event_type,
        startDate: e.start_date,
        country: e.country,
        stateProv: e.state_prov,
        districtKey: e.district_key,
      })),
    });

    // D-22: HarnessPredictionInput across every algorithm this season, for
    // the compare artifact's aggregateScores call (one CompareArtifact per
    // year, per D-02's documented exception).
    const harnessPredictions: HarnessPredictionInput[] = records.map((r) => ({
      matchKey: r.match.matchKey,
      season,
      // D-T6 (quick task 260901-trz): carried for downstream event-blocked
      // resampling — see `HarnessPredictionInput.eventKey`'s own doc comment.
      eventKey: r.match.eventKey,
      compLevel: r.match.compLevel,
      algorithmId: r.algorithmId,
      pRedWin: r.prediction.pRedWin,
      predictedRedScore: r.prediction.redScore,
      predictedBlueScore: r.prediction.blueScore,
      actualWinner: r.match.winner,
      isOffseason: offseasonEventKeys.has(r.match.eventKey),
      isSurrogateAffected: r.match.redSurrogates.length > 0 || r.match.blueSurrogates.length > 0,
      isColdStart: r.coldStart === true,
    }));

    // --- events/{year}/{algorithm}@{version}.json rows, once per season ---
    // Event summary counts reflect matches actually replayed this run
    // (respecting --include-offseason, plan 07-09: now CLI-reachable via
    // main()'s parseArgs, where before this plan nothing could set it),
    // same scope as the artifacts themselves — an offseason event shows
    // zero counts when offseason matches were excluded from this run.
    //
    // Quick task 260913-nvn: the rows come from `eventMeta` and `eventCounts`
    // alone, both algorithm-independent, so they are built and validated ONCE
    // per season here. The three `events/{year}/{algorithm}` bodies differ
    // only by their `algorithmId`/`algorithmVersion` stamps, which the loop
    // below overwrites on a spread of this base (a spread keeps key positions,
    // so serialized key order is unchanged).
    const eventsRows: EventsArtifactEventInput[] = eventMeta.map((e) => {
      const counts = eventCounts.get(e.event_key);
      return {
        eventKey: e.event_key,
        // plan 05-02 (EVNT-01): real name from the corpus's name column.
        // Falls back to the event key only when the column is null —
        // an un-refreshed corpus (never ran --events-only) degrades to
        // the pre-05-02 behavior instead of failing a required-string parse.
        name: e.name ?? e.event_key,
        eventType: e.event_type,
        isOffseason: e.is_offseason === 1,
        startDate: e.start_date,
        week: e.week,
        teamCount: counts?.teamKeys.size ?? 0,
        matchCount: counts?.matchCount ?? 0,
        playedMatchCount: counts?.playedMatchCount ?? 0,
        country: e.country,
        stateProv: e.state_prov,
        districtKey: e.district_key,
      };
    });
    const firstAlgorithm = options.algorithms[0];
    const eventsArtifactBase =
      firstAlgorithm === undefined
        ? undefined
        : buildEventsArtifact({
            season,
            algorithmId: firstAlgorithm.id,
            algorithmVersion: firstAlgorithm.version,
            events: eventsRows,
            generation,
            computedAt,
          });
    timings.add(`season ${season} fold`, performance.now() - foldStart);

    for (const algorithm of options.algorithms) {
      const blockStart = performance.now();
      let sidecarMs = 0;
      const state = records.finalStates.get(algorithm.id);
      const version = algorithm.version;
      // Season-final metrics (the algorithm's final state). NOT a ranking pool
      // (quick task 260912-tnk): still the rating axis for
      // `sigmaMetricByTeam`, the `metricsAsOfEvent` fallback, and an
      // offseason-only team's `seasonStats` values.
      const metricsByTeam = state !== undefined ? algorithm.teamMetrics(state, teamsThisSeason) : {};
      const metricHistoryForAlgo = metricHistoryByAlgoTeam.get(algorithm.id)!;
      // THE season ranking pool (quick task 260912-tnk), built exactly ONCE
      // per (algorithm, season): every team's metrics as of its LAST OFFICIAL
      // match (quick task 260904-586's Teams-list snapshot), over the
      // `teamsThisSeason` membership list. Every published percentile ranks
      // against it through `goodnessPercentileAgainstPools` — the teams row's
      // tier, `seasonStats` (including an offseason-only team's season-final
      // fallback, which is ranked against this pool, not a second one), every
      // `metricHistory` row, and every event standing — so the same value for
      // the same team gets the same tier on every page. An offseason-only team
      // is absent from `officialMetricsByTeam` and so from the pool, never
      // counted as a zero.
      //
      // Before 260912-tnk, history rows and event standings ranked against a
      // second, season-final pool, which is how spr 2026 team 6919 read Epic
      // on the Teams list and Legendary on its last official event card.
      const officialMetricsByTeam = lastOfficialMetricsByTeam(metricHistoryForAlgo, officialEventKeys);
      const rankingPools = sortedPoolsByMetric(officialMetricsByTeam, teamsThisSeason);
      const officialMetricsByTeamWithPercentiles = withPercentiles(officialMetricsByTeam, teamsThisSeason, rankingPools);
      // D-10, plan 07-09: this algorithm's per-event state capture, bound
      // once here for the event loop below — never rebuilt per event.
      const stateByEventForAlgo = stateByAlgoEvent.get(algorithm.id)!;
      // Quick task 260905-tll Task 4: this algorithm's pre-event state
      // capture, bound once here for the event loop below — never rebuilt
      // per event (mirrors stateByEventForAlgo directly above).
      const preEventStateForAlgo = preEventStateByAlgoEvent.get(algorithm.id)!;
      const eventMatchesForAlgo = perAlgoEventMatches.get(algorithm.id)!;
      const teamMatchesForAlgo = perAlgoTeamMatches.get(algorithm.id)!;

      // D-08 (Phase 6): scheduled-match predictions for THIS algorithm,
      // computed once per event key here and shared by both the event
      // branch's `upcoming` array below and the team branch's per-team
      // grouping — a single `algorithm.predict(state, match)` call per
      // scheduled match, not one per (event, team) pairing.
      const scheduledPredictionsByEvent = new Map<string, UpcomingPredictionRecord[]>();
      // Quick task 260908-5wd: this algorithm's season-final per-team
      // consistency figures, read once from the layer that walked the played
      // stream above. An unplayed match has no residual of its own, so its
      // pricing is built from everything played so far — walk-forward for it by
      // definition.
      const layerForAlgo = layers.get(algorithm.id)!;
      // Sigma Score where this algorithm publishes it, an EMPTY map otherwise —
      // ONE accessor so the presim win-odds variance and the metric entry below
      // cannot disagree about which estimator this algorithm is on. (The
      // published match band no longer reads this map: it rides each upcoming
      // record's `matchBand`, quick task 260913-g66.)
      const sigmaByTeamForAlgo = layerForAlgo.sigmaScoreByTeam();
      // Quick task 260909-tgf: the published consistency metric (value + tier on
      // the teams row, value + percentile on the team-season artifact),
      // computed ONCE here per (algorithm, season) and consumed by BOTH
      // artifacts below -- one computation feeds both, so the Teams table and
      // the team page cannot disagree on value or tier. The rating axis is the SEASON-FINAL
      // `metricsByTeam` (not `officialMetricsByTeam`): `sigmaByTeamForAlgo`
      // is itself season-final -- it reflects everything played -- so pairing
      // it with a season-final rating keeps both sides of the residual measured
      // over the same window.
      //
      // PUBLISHED ONLY where a consistency metric is wanted. Sigma-enabled
      // algorithms publish it under `SIGMA_METRIC_KEY`; every other algorithm
      // publishes NOTHING here (developer decision, 2026-09-10 — OPR and EPA
      // show no consistency column). Since quick task 260913-g66 they publish no
      // match band, and since quick task 260913-it4 no ranking-point odds.
      const sigmaMetricForAlgo = usesSigmaScore(algorithm.id)
        ? sigmaMetricByTeam({
            valueByTeam: sigmaByTeamForAlgo,
            metricsByTeam,
            teamKeys: teamsThisSeason,
            metricKey: SIGMA_METRIC_KEY,
          })
        : {};
      if (state !== undefined) {
        for (const [eventKey, matchesForEvent] of scheduledByEvent) {
          scheduledPredictionsByEvent.set(
            eventKey,
            // One record object per match, shared by the event `upcoming`
            // array and the per-team grouping below — so both carry the same
            // band and the same pmf.
            matchesForEvent.map((match) => layerForAlgo.enrichUpcoming(match, algorithm.predict(state, match)))
          );
        }
      }
      // D-08/TEAM-04 (Phase 6): the per-team counterpart, grouped from the
      // same predictions above — so a team scheduled at an event it has not
      // yet played still produces its own event section.
      const scheduledTeamMatches = new Map<string, UpcomingPredictionRecord[]>();
      for (const eventRecords of scheduledPredictionsByEvent.values()) {
        for (const record of eventRecords) {
          for (const teamKey of new Set([...record.match.redTeams, ...record.match.blueTeams])) {
            const list = scheduledTeamMatches.get(teamKey) ?? [];
            list.push(record);
            scheduledTeamMatches.set(teamKey, list);
          }
        }
      }

      // --- teams/{year}/{algorithm}@{version}.json ---
      const teamsRows: TeamsArtifactTeamInput[] = teamsThisSeason.map((teamKey) => {
        const info = teamInfoOrFallback(teamInfo, teamKey);
        // Quick task 260908-615: OFFICIAL play only, for the record and both
        // counts below. A team with no official play at all is absent from
        // this map and publishes an all-zero record with zero counts —
        // present-and-zero, never a missing row.
        const stats = teamStatsOfficial.get(teamKey);
        return {
          teamKey,
          teamNumber: info.teamNumber,
          nickname: info.nickname,
          record: { wins: stats?.wins ?? 0, losses: stats?.losses ?? 0, ties: stats?.ties ?? 0 },
          // Quick task 260904-586: the team's metrics as of its LAST
          // OFFICIAL match, not the season-final snapshot — ranked (via
          // `officialMetricsByTeamWithPercentiles` above) against the field
          // of teams that have official play, so an offseason result can
          // never move a team's position on this list.
          //
          // Quick task 260908-615: `record`, `eventCount` and `matchCount`
          // below now draw from that SAME official population, so this whole
          // row means one thing. They used to stay season-wide beside an
          // official-scoped metric snapshot, which put two populations in one
          // header row; the reason 260904-586 scoped the snapshot is the same
          // reason these three are scoped now. Offseason and preseason play
          // stays fully visible in the per-team artifact's own `events` and
          // `metricHistory` arrays — this is a re-scoping, not a hiding.
          //
          // Carries the D-17 rarity TIER, not the raw percentile. The Teams
          // table now applies the same tiers the team page does, so a
          // number does not change meaning between the table and the page
          // it links to.
          //
          // Measured on 2024/sigma1, the largest teams artifact [pre-rename]: publishing
          // `percentile` costs +42% gzipped (369KB -> 525KB); publishing
          // `tier` with Common omitted costs +10% (369KB -> 405KB), for an
          // identical rendered result. Page-load speed is the top stated UX
          // priority, so the table gets the cheap representation and the
          // small per-team artifact keeps the full percentile.
          //
          // Quick task 260909-tgf: the `sigma` entry (from `sigmaMetricForAlgo`
          // above) is merged in HERE, BEFORE `withPublishedTiers` strips
          // `percentile` and stamps `tier` -- merging after would leave a
          // `percentile` on this row and `encodeTeamMetricEntry` would throw
          // at publish time. A team with no sigma entry gets nothing merged;
          // the key stays genuinely absent, never present-and-undefined. Note
          // also that the sigma entry is SEASON-FINAL while the rest of this
          // record is the LAST-OFFICIAL-MATCH snapshot (260904-586 / 260908-wpo)
          // -- it sits INSIDE the metrics record beside official-scoped
          // values, so this says so plainly.
          metrics: withPublishedTiers({
            ...(officialMetricsByTeamWithPercentiles[teamKey] ?? {}),
            ...(sigmaMetricForAlgo[teamKey] !== undefined ? { [SIGMA_METRIC_KEY]: sigmaMetricForAlgo[teamKey] } : {}),
          }),
          eventCount: stats?.eventKeys.size ?? 0,
          matchCount: stats?.matchCount ?? 0,
          // Quick task 260905-ttv: this team's inferred home region, from the
          // once-per-season `teamRegions` map computed above (never a second
          // `deriveTeamRegions` call). Spread so an underivable field is
          // genuinely absent on the row, never a fabricated `undefined` key.
          ...teamRegions.get(teamKey),
        };
      });
      // Quick task 260905-ldu: rank the SAME rows this algorithm/season is
      // about to publish on the Teams artifact above, joined to this
      // season's derived home regions. Ranking the rows the pipeline is
      // about to publish, rather than a separately assembled set, is what
      // makes the published World rank and the Teams table's client-side
      // rank the same number BY CONSTRUCTION — `rowModel.ts`'s
      // `buildTeamRows` ranks this exact same `teamsRows` shape client-side
      // with the same shared `compareTeamsByTotal` comparator.
      const rankableTeamRows: RankableTeamRow[] = teamsRows.map((row) => ({
        teamKey: row.teamKey,
        teamNumber: row.teamNumber,
        // Quick task 260905-ttv: ranked from ROUNDED metrics, not the raw
        // `row.metrics` — `buildTeamsArtifact` below rounds every metric to
        // `ROUNDING_RULE.metric` before writing, so the browser sorts
        // ROUNDED values. Rounding can collapse two distinct totals into
        // one, and a collapsed pair is re-ordered by the team-number
        // tie-break — meaning a rank computed here from unrounded values
        // could differ by one place from the rank a client computes from
        // the published artifact. That gap was invisible while the rank was
        // only a decorative number; now that a rank card LINKS to a table
        // that recomputes the same rank, the two must agree on real data,
        // not merely on fixtures.
        metrics: roundTeamMetricRecord(row.metrics),
        ...teamRegions.get(row.teamKey),
      }));
      // Quick task 260913-nvn: every pool sorted once for the whole roster;
      // `rankableTeamRows` is 1:1 with `teamsRows`, so every row key gets an entry.
      const rankScopesByTeamKey = buildTeamRankScopesByTeam(rankableTeamRows);

      const teamsArtifact = buildTeamsArtifact({
        season,
        algorithmId: algorithm.id,
        algorithmVersion: version,
        teams: teamsRows,
        generation,
        computedAt,
      });
      const teamsKey = artifactKey({ page: "teams", year: season, algorithmId: algorithm.id, version });
      let uploadWaitMs = 0;
      /** Awaits one publish call (its queue acceptance) and books the wait as upload time, not build time. */
      const publishTimed = async (publishing: () => Promise<void>): Promise<void> => {
        const start = performance.now();
        await publishing();
        uploadWaitMs += performance.now() - start;
      };
      await publishTimed(() => uploader.publish("teams", teamsKey, JSON.stringify(teamsArtifact)));

      // --- events/{year}/{algorithm}@{version}.json ---
      // The once-per-season base above, re-stamped for this algorithm. Only
      // the two stamps are re-validated, so nothing unparsed reaches an
      // upload (T-04-22).
      const eventsArtifact: EventsArtifact = {
        ...eventsArtifactBase!,
        ...EventsArtifactStampSchema.parse({ algorithmId: algorithm.id, algorithmVersion: version }),
      };
      const eventsKey = artifactKey({ page: "events", year: season, algorithmId: algorithm.id, version });
      await publishTimed(() => uploader.publish("events", eventsKey, JSON.stringify(eventsArtifact)));

      // --- event/{eventKey}/{algorithm}@{version}.json, one per event ---
      for (const e of eventMeta) {
        const predictions = eventMatchesForAlgo.get(e.event_key) ?? [];
        const scheduledForEvent = scheduledByEvent.get(e.event_key) ?? [];
        const upcoming: UpcomingPredictionRecord[] = scheduledPredictionsByEvent.get(e.event_key) ?? [];
        const matchDerivedTeamKeys = Array.from(
          new Set([...predictions.flatMap((p) => [...p.match.redTeams, ...p.match.blueTeams]), ...scheduledForEvent.flatMap((m) => [...m.redTeams, ...m.blueTeams])])
        );
        // Quick task 260905-tll Task 4 (C-15/C-17): an event now survives
        // when it has predictions, OR upcoming matches, OR a non-empty
        // registered-team list — before this task, a scheduleless event had
        // no page at all. An `undefined` map entry means "registration
        // unknown", never "zero teams" (the absence discipline above).
        const registeredTeamKeys = registeredTeamsByEvent.get(e.event_key);
        if (predictions.length === 0 && upcoming.length === 0 && registeredTeamKeys === undefined) continue; // no data for this event under this run's scope
        // PD-05: the registered roster is used ONLY when the match-derived
        // roster is empty. Unioning it in unconditionally would add
        // registered-but-never-played teams to every already-published
        // event's standings table, changing bytes and rendered rows across
        // the whole corpus for no requirement in this task. Sorted ascending
        // so a registered-only roster publishes deterministically regardless
        // of corpus row order (match-derived rosters keep their established
        // chronological order — Test 11b pins it).
        const eventTeamKeys = matchDerivedTeamKeys.length > 0 ? matchDerivedTeamKeys : [...registeredTeamKeys!].sort();
        // D-10, plan 07-09: the value is AS-OF-EVENT (this event's last
        // chronological match, or the season-final fallback for an event
        // with no completed matches — PD-04); the pool is THE season ranking
        // pool (`rankingPools`, quick task 260912-tnk, already in scope above).
        const asOfEventMetrics = metricsAsOfEvent(algorithm, stateByEventForAlgo, e.event_key, eventTeamKeys, metricsByTeam);
        // Quick task 260913-jkp: the SAME `sigmaMetricForAlgo` object above
        // (one computation per (algorithm, season)) feeds this call too, so
        // the event standings row, the Teams row and the team-season
        // artifact cannot structurally disagree about a team's sigma entry.
        const teamsStanding = buildEventTeamsStanding(asOfEventMetrics, eventTeamKeys, teamInfo, rankingPools, sigmaMetricForAlgo);
        const eventArtifact = buildEventArtifact({
          eventKey: e.event_key,
          season,
          algorithmId: algorithm.id,
          algorithmVersion: version,
          predictions,
          upcoming,
          teams: teamsStanding,
          generation,
          computedAt,
          // D-08 (Phase 6)/D-13, plan 07-08: the SAME map already read once
          // per season above (feeds TeamSeasonMatchSchema.sortTime and
          // sortTeamSeasonMatches) — passed straight through, no second
          // query call and no re-scoping.
          sortTimeByMatchKey,
          // Quick 260905-jj8: the SAME per-season flags map the team-artifact
          // builder already consumes (computed once above from the season
          // stream) — passed straight through, no second derivation.
          actualBonusFlagsByMatchKey,
          // D-18 item 8, plan 07-08: `e` is this event's own `eventMeta` row
          // (the loop variable above), already in scope — passed straight
          // through as raw corpus columns (PD-04).
          eventMeta: { name: e.name, startDate: e.start_date, country: e.country, stateProv: e.state_prov, week: e.week },
          // D-18 item 7, plan 07-08: `?? []` is deliberate (PD-03) — this
          // call site always consulted the corpus, so the published key is
          // always present, meaning "zero rows" when the map has no entry.
          alliances: alliancesForSeason.get(e.event_key) ?? [],
          // D-18 item 6, plan 07-08: the SAME once-per-season read the team
          // loop's own `eventRankingsForSeason.get(eventKey)?.get(teamKey)`
          // lookup already uses — no second read, no move of the existing
          // one.
          rankings: eventRankingsForSeason.get(e.event_key),
          // Quick task 260906-7eu: the SAME once-per-season map read above.
          videoByMatchKey,
        });
        const key = artifactKey({ page: "event", eventKey: e.event_key, algorithmId: algorithm.id, version });
        const eventBody = JSON.stringify(eventArtifact);
        // Quick task 260905-tll Task 4: the pre-schedule sidecar for this
        // (event, algorithm) pair. Generated only for seasons in presim
        // scope (C-05, gated once per season above); every other skip reason
        // is decided and logged inside `buildPreScheduleSidecarForEvent`.
        // The sidecar is written BEFORE the event artifact for the same
        // event (the artifacts-before-index ordering rule): both puts ride
        // ONE queued task, sidecar first — the two never race.
        //
        // Quick task 260913-nvn: gated on `publishesRankingPoints` as well.
        // The layer's RP accumulator exists only for RP-publishing ids, so
        // every other id's probe returns null by construction — after loading
        // a template, building schedule 0 and pricing a probe match for nothing.
        const sidecarStart = performance.now();
        const sidecar = presimEnabled && publishesRankingPoints(algorithm.id)
          ? buildPreScheduleSidecarForEvent({
              eventKey: e.event_key,
              season,
              eventType: e.event_type,
              week: e.week,
              algorithm,
              roster: eventTeamKeys,
              qualMatchCount: qualMatchCountByEvent.get(e.event_key) ?? 0,
              hasPreEventState: preEventStateForAlgo.has(e.event_key),
              preEventState: preEventStateForAlgo.get(e.event_key),
              hasCompletedMatches: predictions.length > 0,
              hasSeasonFinalState: state !== undefined,
              seasonFinalState: state,
              generation,
              computedAt,
              // The mean shift at the same instant as the accumulator beside it,
              // rebuilt through the resume path the Worker uses (quick task 260914-01x).
              fillRankingPoints: makeRankingPointFiller(
                layerForAlgo.rpAccumulator,
                rpRuleModule,
                sigmaByTeamForAlgo,
                eventTeamKeys,
                rpRuleModule === undefined ? undefined : RpMeanShiftAccumulator.fromState(rpRuleModule, layerForAlgo.rpMeanShiftState())
              ),
            })
          : undefined;
        sidecarMs += performance.now() - sidecarStart;
        if (sidecar !== undefined) {
          await publishTimed(() => uploader.publishSidecarThenEvent(sidecar.key, sidecar.body, key, eventBody));
        } else {
          await publishTimed(() => uploader.publish("event", key, eventBody));
        }
      }

      // --- team/{teamKey}/{year}/{algorithm}@{version}.json, one per team ---
      for (const teamKey of teamsThisSeason) {
        const info = teamInfoOrFallback(teamInfo, teamKey);
        // D-08/D-09 (Phase 6): played AND scheduled matches grouped together,
        // so an event this team is only scheduled to attend still produces
        // its own section rather than being omitted.
        const teamMatches: (PredictionRecord | UpcomingPredictionRecord)[] = [
          ...(teamMatchesForAlgo.get(teamKey) ?? []),
          ...(scheduledTeamMatches.get(teamKey) ?? []),
        ];
        const byEvent = groupByEvent(teamMatches);
        const events: TeamSeasonEventInput[] = Array.from(byEvent.entries()).map(([eventKey, matches]) => {
          const meta = eventMeta.find((e) => e.event_key === eventKey);
          // TEAM-04/F-06-3 (plan 06.1-01): looked up by key (event, then
          // team), never by array position — a missing outer or inner
          // entry leaves both fields undefined.
          const ranking = eventRankingsForSeason.get(eventKey)?.get(teamKey);
          return {
            eventKey,
            // The event-name defect fix: `meta` (the same lookup the sibling
            // eventsRows builder above already uses) is in scope here — the
            // key-as-name fallback survives only when a corpus row's `name`
            // column is genuinely null (an un-refreshed corpus).
            eventName: meta?.name ?? eventKey,
            startDate: meta?.start_date ?? "",
            rank: ranking?.rank,
            totalTeams: ranking?.totalTeams,
            matches: sortTeamSeasonMatches(matches, sortTimeByMatchKey),
          };
        });
        // Quick task 260908-615: OFFICIAL play only, matching the Teams-list
        // row above so the two surfaces cannot disagree about a team's
        // record. The `events` array built just above is UNSCOPED and stays
        // that way — an offseason event keeps its own section, its matches
        // and its metric-history rows.
        const stats = teamStatsOfficial.get(teamKey);
        // Quick task 260908-wpo: official-with-fallback — see
        // `seasonStatsMetricsForTeam`'s doc comment for the full selection
        // rule and why the emptiness check matters. Quick task 260912-tnk:
        // the season-final fallback is ranked against `rankingPools` too.
        const seasonStatsMetrics = seasonStatsMetricsForTeam(teamKey, officialMetricsByTeamWithPercentiles, metricsByTeam, rankingPools);
        const teamSeasonArtifact = buildTeamSeasonArtifact({
          teamKey,
          teamNumber: info.teamNumber,
          nickname: info.nickname,
          season,
          algorithmId: algorithm.id,
          algorithmVersion: version,
          seasonStats: {
            record: { wins: stats?.wins ?? 0, losses: stats?.losses ?? 0, ties: stats?.ties ?? 0 },
            // Quick task 260909-tgf: the `sigma` entry is merged in HERE,
            // with its `percentile` KEPT (unlike the teams row above) --
            // the per-team artifact is small and carries full percentiles by
            // design (`TeamMetricSchema.tier`'s own documented size
            // argument), and the season-header tile derives its tier from
            // this percentile via the existing client `tierForPercentile`.
            metrics: {
              ...seasonStatsMetrics.metrics,
              ...(sigmaMetricForAlgo[teamKey] !== undefined ? { [SIGMA_METRIC_KEY]: sigmaMetricForAlgo[teamKey] } : {}),
            },
            metricsBasis: seasonStatsMetrics.metricsBasis,
          },
          events,
          // Quick task 260913-m45 Task 1: `withHistorySigma` is applied
          // AFTER `withHistoryPercentiles`, not before and not combined into
          // one pass — applying it after means the per-match sigma entry
          // never receives a pool percentile (a per-match pool has no
          // meaning, and the chart needs no tier), and — more importantly —
          // the SOURCE rows (`metricHistoryForAlgo`), the ranking pools built
          // from them, and the seasonStats/Teams-row merges above never see
          // sigma at all: this call site is the ONLY place the per-match
          // value reaches a published row (T-m45-02).
          metricHistory: withHistorySigma(
            withHistoryPercentiles(metricHistoryForAlgo.get(teamKey) ?? [], rankingPools),
            sigmaByMatchKeyForAlgoTeam.get(algorithm.id)?.get(teamKey)
          ),
          sortTimeByMatchKey,
          actualBonusFlagsByMatchKey,
          // D-03 (Phase 6): omitted entirely when the corpus has no row, or
          // the stored value is null — never fetched, never guessed.
          robotImageUrl: teamMediaForSeason.get(teamKey)?.imageUrl ?? undefined,
          // D-05 (Phase 6): from the activeYears pre-pass above.
          activeYears: activeYearsByTeam.get(teamKey),
          // Quick task 260905-ldu: this team's World/Country/District/State
          // rank scopes, from the once-per-algorithm pre-pass above.
          ranks: rankScopesByTeamKey.get(teamKey),
          generation,
          computedAt,
          // Quick task 260906-7eu: the SAME once-per-season map the event
          // artifact builder above already consumes.
          videoByMatchKey,
        });
        const key = artifactKey({ page: "team", teamKey, year: season, algorithmId: algorithm.id, version });
        await publishTimed(() => uploader.publish("team", key, JSON.stringify(teamSeasonArtifact)));
      }

      const blockLabel = `${season}/${algorithm.id}`;
      timings.add(`${blockLabel} build`, performance.now() - blockStart - sidecarMs - uploadWaitMs);
      timings.add(`${blockLabel} sidecars`, sidecarMs);
      timings.add(`${blockLabel} uploadWait`, uploadWaitMs);
    }

    // --- compare/{year}.json — one file, every algorithm, per D-02's exception ---
    // D-2 (quick task 260903-krp): must NOT pass this loop's own `season` —
    // `harnessPredictions` above is built from a single season, so passing
    // `[season]` here would make every published slice's `headlineEligible`
    // come back false, silently, with every test still green (Finding 1).
    // `corpusSeasons` is the corpus-held season set, never `seasonsSorted`:
    // headline eligibility is a property of the data available, so a
    // single-season republish must not flip a live key's badge.
    const compareStart = performance.now();
    const slices = aggregateScores(harnessPredictions, { corpusSeasons: selectCorpusSeasons(db), eligibility: "from-corpus-seasons" });
    const compareArtifact = buildCompareArtifact({
      algorithms: options.algorithms.map((a) => ({ id: a.id, version: a.version })),
      slices,
      generation,
      computedAt,
      // F1/D-09/D-11 (phase 09 plan 09-01 Task 2): the ONLY `buildCompareArtifact(` call site in this file — every one passes `rpCalibration`, so a second call site added later cannot silently omit it (the exact bug sigmaScoutLayer.ts was extracted to prevent, verified by `publish.test.ts`'s call-site-count assertion).
      rpCalibration: options.rpCalibration,
    });
    const compareKey = artifactKey({ page: "compare", year: season });
    await uploader.publish("compare", compareKey, JSON.stringify(compareArtifact));
    timings.add(`season ${season} compare`, performance.now() - compareStart);

    // Quick task 260908-615: these two lines read DIFFERENT maps, and the
    // split IS the point — do not collapse them back into one read.
    //
    //   `liveStatesAcrossSeasons` feeds the NEXT season's `carrySeason`
    //   boundary thread, so it takes `carryStates` — for EPA that rewinds to
    //   the state after this season's last OFFICIAL match, so an exhibition
    //   result cannot seed next season's prior.
    //
    //   `finalSeasonStates` is D-12's D1 seed, which the LIVE Worker resumes
    //   from. The Worker continues the real, offseason-inclusive season, so
    //   seeding it from a rewound snapshot would make live and offline
    //   disagree about the very same season — it must stay `finalStates`.
    liveStatesAcrossSeasons = new Map(records.carryStates);
    finalSeasonStates = new Map(records.finalStates);
    // Shape 15 (plan 09-08): the RP beliefs, read from `layers`, which walked
    // this season's offseason-INCLUSIVE record stream — deliberately the same
    // population `finalSeasonStates` takes, and for the same reason given just
    // above: the Worker continues the real season, so seeding it from a
    // rewound snapshot would make live and offline disagree about that season.
    // Empty for an algorithm that publishes no ranking points.
    finalSeasonRp = new Map(
      options.algorithms.map((algorithm) => [algorithm.id, layers.get(algorithm.id)!.rpVariableBeliefs()])
    );
    // Shape 16: the mean shift, from the same layers at the same instant, for
    // the same reason. Collected sparsely, like the Sigma maps below.
    finalSeasonRpMeanShift = new Map();
    for (const algorithm of options.algorithms) {
      const shift = layers.get(algorithm.id)!.rpMeanShiftState();
      if (shift !== undefined) finalSeasonRpMeanShift.set(algorithm.id, shift);
    }
    // Shape 11: the Sigma Score beliefs and their population, read from the
    // same `layers` map and therefore the same offseason-inclusive population
    // the line above takes, for the identical reason — the Worker
    // continues the real season.
    //
    // Both are collected SPARSELY: a non-Sigma algorithm's layer has no Sigma
    // accumulator, so it contributes no entry rather than an empty one, and
    // the seed block below then writes it no Sigma key.
    finalSeasonSigma = new Map();
    finalSeasonSigmaPopulation = new Map();
    for (const algorithm of options.algorithms) {
      const layer = layers.get(algorithm.id)!;
      if (!layer.usesSigma) continue;
      finalSeasonSigma.set(algorithm.id, layer.sigmaBeliefs());
      const population = layer.sigmaPopulation();
      if (population !== undefined) finalSeasonSigmaPopulation.set(algorithm.id, population);
    }
  }

  // Quick task 260913-nvn: every queued put settles here, once, before the
  // manifests below point readers at this run's objects. A put that failed
  // after r2Client's own retries rejects this await and fails the run.
  await timings.timeAsync("uploadDrain", () => uploader.drain());

  // --- Manifests (D-18/D-03) and D-12's state snapshot / D1 seed ---
  if (!options.skipState) {
    const liveWindows = buildLiveWindowsManifest(db, { seasons: seasonsSorted, generation, computedAt });
    const algorithmsManifest = buildAlgorithmsManifest({ generation, computedAt });
    const liveWindowsKey = "v1/manifest/live-windows.json";
    const algorithmsManifestKey = "v1/manifest/algorithms.json";
    if (!dryRun) {
      await putObject(options.bucket, liveWindowsKey, JSON.stringify(liveWindows), {
        contentType: "application/json",
        cacheControl: "public, max-age=60",
      });
      await putObject(options.bucket, algorithmsManifestKey, JSON.stringify(algorithmsManifest), {
        contentType: "application/json",
        cacheControl: "public, max-age=60",
      });
    }
    manifestKeys.push(liveWindowsKey, algorithmsManifestKey);

    // D-12: only the FINAL season's states are seeded into D1 — earlier
    // seasons' states were used solely for the carrySeason boundary thread
    // above. A reader would otherwise assume all requested seasons are
    // seeded; they are not.
    for (const algorithm of options.algorithms) {
      const state = finalSeasonStates.get(algorithm.id);
      if (state === undefined) continue;
      // The level-2 passengers ride into each row after the algorithm
      // serializer has run, so no algorithm's serializer knows they exist.
      // Quick task 260913-it4 removed the shape-10 team-row passenger (the
      // retired per-robot consistency accumulator's beliefs) without a shape
      // bump; see `stateSnapshot.ts`'s 9 -> 10 history entry.
      // Shape 15 (plan 09-08): the RP passenger chains on before
      // `emitSeedSql`. Omitting it is not a cosmetic gap — a seeded Worker
      // would cold-start every RP belief while the artifacts it serves already
      // carry a full season's pmfs, so live and offline would price the same
      // match from two different histories with both sides looking healthy.
      // Shape 11: the Sigma passenger chains on in the same place and the same
      // way, and closes the same gap for the premier published algorithm. A
      // seeded Worker without it cold-starts BPR's Sigma Score bands from the
      // flat prior while the artifacts it serves already carry fully warmed
      // ones — no error, no missing field, just live and offline pricing the
      // same match from two different histories with both sides looking
      // healthy.
      //
      // MIND THE SCOPE SPLIT, it is not symmetric with the RP passenger:
      // `withSigmaBeliefs` writes TEAM rows like it does, but
      // `withSigmaPopulation` writes the LEAGUE row — three numbers that never
      // scale with team count. Seeding the beliefs without the population is
      // not half a fix: a resumed accumulator would fall back to the flat
      // talent prior and compute different bands from the very beliefs it was
      // just handed.
      let rows = withRpBeliefs(
        withSigmaBeliefs(
          serializeState(algorithm.id, algorithm.version, state as EpaState | OprState | SprState, stamp),
          finalSeasonSigma.get(algorithm.id) ?? new Map()
        ),
        finalSeasonRp.get(algorithm.id) ?? new Map()
      );
      const sigmaPopulation = finalSeasonSigmaPopulation.get(algorithm.id);
      if (sigmaPopulation !== undefined) rows = withSigmaPopulation(rows, sigmaPopulation);
      // Shape 16 (quick task 260914-01x): the RP mean shift rides the LEAGUE
      // row beside the Sigma population, and closes the same kind of gap. A
      // seeded Worker without it resumes a fresh shift, prices every live
      // match unshifted while the artifacts it serves are shifted, and nothing
      // errors. A handful of numbers, so it cannot scale with team count.
      const rpMeanShift = finalSeasonRpMeanShift.get(algorithm.id);
      if (rpMeanShift !== undefined) rows = withRpMeanShift(rows, rpMeanShift);
      const outPath = join(SEED_OUT_DIR, `seed-${algorithm.id}.sql`);
      emitSeedSql(rows, { algorithmId: algorithm.id, out: outPath });
      seedFiles.push(outPath);
    }
  }

  const pages = computeSizeStats(uploader.records);
  const objectCount = uploader.records.length;
  const totalBytes = uploader.records.reduce((sum, r) => sum + r.bytes, 0);

  console.log(`\npublish: summary (generation=${generation})`);
  console.log(`  objects=${objectCount} totalBytes=${totalBytes}${dryRun ? " (dry-run — nothing uploaded)" : ""}`);
  for (const [kind, stats] of Object.entries(pages)) {
    console.log(
      `  ${kind}: count=${stats!.count} median=${stats!.medianBytes}B p95=${stats!.p95Bytes}B max=${stats!.maxBytes}B key=${stats!.largestKey}`
    );
  }
  // Quick task 260905-tll Task 4: the sidecar size summary, printed in the
  // same shape as the page-kind lines above — deliberately OUTSIDE
  // `computeSizeStats`/the machine-readable budget block's `pages`, because
  // the sidecar is not a `PageKind` (PD-01). `--write-budget` carries these
  // figures in the block's `run` string instead.
  let sidecars: PageKindSizeStats | undefined;
  if (uploader.sidecarRecords.length > 0) {
    const sidecarBytesSorted = uploader.sidecarRecords.map((r) => r.bytes).sort((a, b) => a - b);
    const largestSidecar = uploader.sidecarRecords.reduce((max, r) => (r.bytes > max.bytes ? r : max));
    sidecars = {
      count: uploader.sidecarRecords.length,
      medianBytes: percentileOf(sidecarBytesSorted, 50),
      p95Bytes: percentileOf(sidecarBytesSorted, 95),
      maxBytes: largestSidecar.bytes,
      largestKey: largestSidecar.key,
    };
    console.log(
      `  presim: count=${sidecars.count} median=${sidecars.medianBytes}B p95=${sidecars.p95Bytes}B max=${sidecars.maxBytes}B key=${sidecars.largestKey}`
    );
  }
  if (manifestKeys.length > 0) console.log(`  manifests: ${manifestKeys.join(", ")}`);
  if (seedFiles.length > 0) console.log(`  seed files: ${seedFiles.join(", ")}`);
  timings.add("total", performance.now() - runStart);
  for (const [label, elapsedMs] of Object.entries(timings.ms)) {
    console.log(`  timing: ${label} ${(elapsedMs / 1000).toFixed(1)}s`);
  }

  return { generation, computedAt, objectCount, totalBytes, pages, seedFiles, manifestKeys, timings: { ...timings.ms }, sidecars };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Resolves the requested `--algorithm` ids (default: `PUBLISHED_ALGORITHM_IDS`) against `BASE_PUBLISH_ALGORITHMS`, throwing on an unknown id. Exported so the default-set, artifact-key and unknown-id behavior is testable without the CLI entry point. */
export function resolvePublishAlgorithms(idsCsv: string | undefined): AlgorithmModule<any>[] {
  const ids = idsCsv
    ? idsCsv
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : [...PUBLISHED_ALGORITHM_IDS];
  const resolved: AlgorithmModule<any>[] = [];
  for (const id of ids) {
    const base = BASE_PUBLISH_ALGORITHMS[id];
    if (!base) {
      throw new Error(`Unknown algorithm for publish: "${id}" (known: ${Object.keys(BASE_PUBLISH_ALGORITHMS).join(", ")})`);
    }
    resolved.push(base);
  }
  return resolved;
}

/**
 * `--seasons "2022-2026"` -> `[2022, 2023, 2024, 2025, 2026]`, a single year
 * `--seasons "2026"` -> `[2026]`, or a comma-separated LIST of terms, each
 * itself a single year or a range, e.g. `--seasons "2019,2020,2022-2026"` ->
 * `[2019, 2020, 2022, 2023, 2024, 2025, 2026]` (harness CLI splits these into
 * two flags, `--seasons`/`--season`; this file accepts both spellings through
 * one flag). Terms may repeat or arrive out of order; the result is always
 * ascending and de-duplicated.
 *
 * The list form exists because the corpus is GAPPED: 2021 has no registered
 * component map (it was the at-home/remote season with no conventional 3v3
 * alliance matches, so there is nothing to ingest or score — permanent
 * exclusion, not a deferral), so a single contiguous `2019-2026` range would
 * include 2021 and throw at `componentMapForSeason(2021)`. Quick task
 * 260904-nt4 added this form specifically so `pnpm publish:seasons` can name
 * the real seven-season corpus (`2019,2020,2022-2026`) without a contiguous
 * range lying about what exists.
 *
 * This is now the ONE `--seasons` parser in the repo (the harness backtest
 * CLI's own duplicate copy was deleted in 260913-nvn).
 *
 * **EXPORTED** for direct test coverage, following the exported-for-test
 * precedent `resolvePublishAlgorithms` (above) already sets in this file.
 */
export function parseSeasonsRange(spec: string): number[] {
  const terms = spec
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (terms.length === 0) {
    throw new Error(`--seasons must not be empty, got "${spec}"`);
  }

  const seasons = new Set<number>();
  for (const term of terms) {
    const singleMatch = /^(\d{4})$/.exec(term);
    if (singleMatch) {
      seasons.add(Number.parseInt(singleMatch[1]!, 10));
      continue;
    }
    const rangeMatch = /^(\d{4})-(\d{4})$/.exec(term);
    if (!rangeMatch) {
      throw new Error(
        `--seasons terms must each be a single year like "2026" or a range like "2022-2026" (or a comma-separated list of these, e.g. "2019,2020,2022-2026"), got invalid term "${term}" in "${spec}"`
      );
    }
    const start = Number.parseInt(rangeMatch[1]!, 10);
    const end = Number.parseInt(rangeMatch[2]!, 10);
    if (end < start) {
      throw new Error(`--seasons range end (${end}) must be >= start (${start}), in term "${term}" of "${spec}"`);
    }
    for (let year = start; year <= end; year++) seasons.add(year);
  }

  return Array.from(seasons).sort((a, b) => a - b);
}

async function runSeasonsCliMode(
  seasonsSpec: string,
  algorithmIdsCsv: string | undefined,
  bucket: string,
  concurrency: number,
  dryRun: boolean,
  skipState: boolean,
  includeOffseason: boolean,
  preScheduleFromSeason: number | undefined,
  writeBudget: boolean
): Promise<void> {
  const seasons = parseSeasonsRange(seasonsSpec);
  const algorithms = resolvePublishAlgorithms(algorithmIdsCsv);
  // F1/D-09/D-11 (phase 09 plan 09-01 Task 2): `loadRpCalibrationMeasurement` returns `undefined`
  // for a path that does not exist, so a run without a committed baseline attaches nothing.
  const rpCalibration = loadRpCalibrationMeasurement(RP_CALIBRATION_MEASUREMENT_PATH);

  const db = openCorpusReadOnly(CORPUS_PATH);
  const startedAt = new Date();
  let summary: PublishSummary;
  try {
    summary = await publishSeasons(db, { seasons, algorithms, bucket, concurrency, dryRun, skipState, includeOffseason, preScheduleFromSeason, rpCalibration });
  } finally {
    db.close();
  }
  if (writeBudget) writePublishBudgetDoc(summary, startedAt, new Date(), dryRun);
}

/**
 * `--write-budget` (quick task 260913-nvn): replaces the fenced `json budget`
 * block in `docs/publish-budget.md` with this run's own measurements, so no
 * figure is transcribed by hand. Called only after `publishSeasons` returned
 * successfully. The `run` string is built from `process.argv` and summary
 * fields only — never from environment variables (`--env-file` is tsx's own
 * flag and never appears in `process.argv.slice(2)`).
 */
function writePublishBudgetDoc(summary: PublishSummary, startedAt: Date, finishedAt: Date, dryRun: boolean): void {
  const durationSeconds = Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000);
  const duration = `${Math.floor(durationSeconds / 3600)}h${String(Math.floor((durationSeconds % 3600) / 60)).padStart(2, "0")}m${String(durationSeconds % 60).padStart(2, "0")}s`;
  const sidecarText =
    summary.sidecars === undefined
      ? "0 presim sidecars"
      : `${summary.sidecars.count} presim sidecars (median ${summary.sidecars.medianBytes} B, p95 ${summary.sidecars.p95Bytes} B, max ${summary.sidecars.maxBytes} B)`;
  const run =
    `tsx packages/harness/publish.ts ${process.argv.slice(2).join(" ")} -- generation ${summary.generation}, ` +
    `${summary.objectCount} objects, ${summary.totalBytes} bytes total, ${sidecarText}, ` +
    `${startedAt.toISOString()} to ${finishedAt.toISOString()} (${duration})` +
    (dryRun ? " (dry-run: nothing uploaded)" : "");
  const block = renderPublishBudgetBlock({ measuredAt: finishedAt.toISOString(), run, pages: summary.pages });
  const doc = readFileSync(PUBLISH_BUDGET_DOC_PATH, "utf8");
  writeFileSync(PUBLISH_BUDGET_DOC_PATH, replacePublishBudgetBlock(doc, block));
  console.log(`publish: wrote the json budget block to ${PUBLISH_BUDGET_DOC_PATH}`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      algorithm: { type: "string" },
      bucket: { type: "string" },
      "dry-run": { type: "boolean" },
      seasons: { type: "string" },
      concurrency: { type: "string" },
      "skip-state": { type: "boolean" },
      "include-offseason": { type: "boolean" },
      // Quick task 260905-tll Task 4 (C-05): the pre-schedule sidecar
      // season cutoff, threaded through runSeasonsCliMode into
      // publishSeasons — the default lives on DEFAULT_PRESCHEDULE_FROM_SEASON.
      "presim-from-season": { type: "string" },
      // Quick task 260913-nvn: rewrite docs/publish-budget.md's json budget
      // block from this run's measurements after a successful run.
      "write-budget": { type: "boolean" },
    },
  });

  const bucket = values.bucket ?? DEFAULT_BUCKET;
  const dryRun = values["dry-run"] === true;
  let preScheduleFromSeason: number | undefined;
  if (values["presim-from-season"] !== undefined) {
    preScheduleFromSeason = Number.parseInt(values["presim-from-season"], 10);
    if (!Number.isInteger(preScheduleFromSeason)) {
      throw new Error(`--presim-from-season must be an integer year, got "${values["presim-from-season"]}"`);
    }
  }

  if (values.seasons) {
    const concurrency = values.concurrency ? Number.parseInt(values.concurrency, 10) : DEFAULT_CONCURRENCY;
    await runSeasonsCliMode(
      values.seasons,
      values.algorithm,
      bucket,
      concurrency,
      dryRun,
      values["skip-state"] === true,
      values["include-offseason"] === true,
      preScheduleFromSeason,
      values["write-budget"] === true
    );
  } else {
    throw new Error("--seasons is required");
  }
}

// Guard: only auto-run `main()` when this file is the process entry point —
// importing this module (e.g. from publish.test.ts / publish.tracer.test.ts)
// must never have the side effect of parsing `process.argv` or touching the
// corpus/network.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("publish:artifacts failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

// Re-exported so publish.test.ts's outcome-key assertion (D-08) can check
// selectScheduledMatches's output against the SAME set toLeakProofUpcoming
// guards, without a second hand-copied list.
export { OUTCOME_KEYS };
