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
  MatchResult,
  Prediction,
  TeamMetric,
  TeamMetrics,
  UpcomingMatch,
} from "../core/algorithms/types.js";
import { TOTAL_METRIC_KEY } from "../core/algorithms/types.js";
import { COMP_LEVEL_PLAY_ORDER } from "../ingest/normalize.js";
import { seasonBoundaryFor } from "./seasonBoundary.js";
import type { OprState } from "../core/algorithms/opr.js";
import type { EpaState } from "../core/algorithms/epa.js";
import { spr, type SprState } from "../core/algorithms/spr.js";
import { isDemoTeamKey } from "../core/algorithms/demoTeams.js";
import { isOfficialEventType } from "../core/algorithms/eventTypes.js";
import { RP_RULE_MODULES } from "../core/rankingPoints/rules.js";
import { isRpEligibleEventType } from "../core/rankingPoints/constants.js";
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
  OFFICIAL_EVENT_SQL,
} from "../corpus/db.js";
import { buildPreScheduleArtifact } from "./preSchedule.js";
import { eventScheduleIsCurrent } from "./eventSchedule.js";
// Moved to the browser-safe `eventSchedule.ts` (260915-m4j); re-exported so every existing importer keeps working.
export { eventScheduleIsCurrent, STATE_BLOCK_STALE_AFTER_MS } from "./eventSchedule.js";
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
  type EventTierCuts,
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
} from "./sigmaScore.js";
import type { RpMomentsAccumulator } from "../core/rankingPoints/empiricalMoments.js";
import { RpMeanShiftAccumulator, rosterIsFullyWarm } from "../core/rankingPoints/meanShift.js";
import { analyticRpPmf } from "../core/rankingPoints/analyticPmf.js";
import type { RpRuleModule } from "../core/rankingPoints/constants.js";
// The level-2 layer (Sigma Score, the band and ranking points), driven only by `publishSeasons`.
import { SigmaScoutLayer } from "./sigmaScoutLayer.js";
import { roundMetric, roundTo, ROUNDING_RULE } from "./rounding.js";
import {
  actualBonusFlagsForMatch,
  eventPlayedRow,
  eventUpcomingRow,
  teamSeasonMatchRow,
  teamSeasonPlayedRow,
  toIntegerRpOrNull,
  type ActualBonusFlags,
} from "./publishedRows.js";
// Moved to the browser-safe `publishedRows.ts` (260915-p0a) so the live Worker shares them; re-exported
// so every existing importer (`scripts/measureRpCalibration.ts`, `publish.test.ts`) keeps working.
export { toIntegerRpOrNull } from "./publishedRows.js";
export type { ActualBonusFlags } from "./publishedRows.js";
import {
  buildTierCutsFromPools,
  HISTORY_PERCENTILE_METRIC_KEYS,
  sortedPoolsByMetric,
  withPercentiles,
  withPoolPercentiles,
  type TeamMetricWithPercentile,
  type TeamMetricsWithPercentile,
} from "./percentiles.js";
import { buildAlgorithmsManifest, buildLiveWindowsManifest, probeWindowFor, PUBLISHED_ALGORITHM_IDS, PUBLISHED_ALGORITHM_MODULES } from "./manifests.js";
import { emitSeedSql, emitCursorSeedSql, writeSeedCommandsFile } from "./seedSql.js";
import {
  serializeState,
  withRpBeliefs,
  withRpMeanShift,
  withSigmaBeliefs,
  withSigmaPopulation,
  type StateRow,
  type StateStamp,
} from "./stateSnapshot.js";
import { buildEventStateBlock } from "./eventStatePricing.js";
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
/** The live Worker's D1 database name (`apps/worker/wrangler.toml`'s `[[d1_databases]]` binding) — used only to print `SEED-COMMANDS.txt`'s ready-to-run `wrangler d1 execute` invocations, never to run one. */
const D1_DATABASE_NAME = "sigmascout-state";
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
  /**
   * Playoff alliance members who never took the field at this event, so have no `teams` row. Absent or
   * `[]` emits no `allianceTeams` key. Shares `EventTeamStandingInput` with `teams` above so the two
   * arrays can never carry two shapes for one kind of row; the caller is responsible for keeping this
   * list disjoint from `teams` by team key.
   */
  readonly allianceTeams?: readonly EventTeamStandingInput[];
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
  /** TBA's `event_type` (the corpus `events.event_type`). Emitted as `eventType` when provided, for every algorithm. */
  readonly eventType?: number;
  /**
   * Rarity-tier cut points per metric name, built ONCE per `(algorithm,
   * season)` by `buildTierCutsFromPools(rankingPools)` — the SAME
   * `rankingPools` every published percentile on this event ranks against —
   * and passed unchanged to every event this season. Omitted entirely (not
   * an empty object) when not supplied, so a caller that has not computed
   * cuts (a test, a stand-in) publishes none.
   */
  readonly tierCuts?: EventTierCuts;
  /**
   * The season-final D1 seed rows for this algorithm (`seedStateRows`, through its memoized getter).
   * Called only for an SPR artifact with a non-empty `upcoming`, whose `state` block is
   * `buildEventStateBlock` over these rows and every team key on the event's played and upcoming
   * matches. Never called otherwise, so an event that needs no block costs no serialization.
   */
  readonly stateRows?: () => readonly StateRow[];
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

export function buildEventArtifact(params: BuildEventArtifactParams): EventArtifact {
  // The row body lives in the browser-safe `publishedRows.ts` (260915-p0a), so the live Worker builds
  // a played row through this exact code; this call only supplies the three per-match lookups.
  const matches = params.predictions.map((record) =>
    eventPlayedRow(record, {
      sortTime: params.sortTimeByMatchKey?.get(record.match.matchKey),
      video: params.videoByMatchKey?.get(record.match.matchKey),
      actualBonusFlags: params.actualBonusFlagsByMatchKey?.get(record.match.matchKey),
    })
  );

  const upcoming = (params.upcoming ?? []).map((record) =>
    eventUpcomingRow(record, params.sortTimeByMatchKey?.get(record.match.matchKey))
  );

  // Single row shape for BOTH `teams` and `allianceTeams`, so the two arrays can never drift apart.
  // `eventTeamRankingFields` stays in this shared mapper — an alliance-only row carrying TBA's own
  // rank/record/rp when one genuinely exists is honest, and a second mapper that omitted them would
  // be a shape that can drift from this one.
  const eventTeamRow = (t: EventTeamStandingInput) => ({
    teamKey: t.teamKey,
    teamNumber: t.teamNumber,
    nickname: t.nickname,
    ...eventTeamRankingFields(params.rankings?.get(t.teamKey)),
    metrics: roundTeamMetricRecord(t.metrics),
  });

  const teams = (params.teams ?? []).map(eventTeamRow);
  const allianceTeams = (params.allianceTeams ?? []).map(eventTeamRow);

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

  // The SPR state block a browser prices `upcoming` from: built from exactly the rows the D1 seed
  // carries, so a live Worker splicing its own writes into it keeps it equal to D1. Only an SPR
  // artifact with an upcoming match carries one; nothing else calls `stateRows`.
  const state =
    params.algorithmId === spr.id &&
    upcoming.length > 0 &&
    params.stateRows !== undefined &&
    eventScheduleIsCurrent({
      scheduledTimes: [...upcoming, ...matches].flatMap((row) => (row.sortTime !== undefined ? [row.sortTime] : [])),
      startDate: params.eventMeta?.startDate,
      computedAt: params.computedAt,
    })
      ? buildEventStateBlock(params.stateRows(), [
          ...params.predictions.flatMap(({ match }) => [...match.redTeams, ...match.blueTeams]),
          ...(params.upcoming ?? []).flatMap(({ match }) => [...match.redTeams, ...match.blueTeams]),
        ])
      : undefined;

  const candidate = {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: params.generation,
    computedAt: params.computedAt ?? new Date().toISOString(),
    algorithmId: params.algorithmId,
    algorithmVersion: params.algorithmVersion,
    eventKey: params.eventKey,
    season: params.season,
    ...identityFields,
    ...(params.eventType !== undefined ? { eventType: params.eventType } : {}),
    matches,
    upcoming,
    teams,
    ...(alliances !== undefined ? { alliances } : {}),
    ...(allianceTeams.length > 0 ? { allianceTeams } : {}),
    ...(rpOutcomeRp !== undefined ? { rpOutcomeRp } : {}),
    ...(params.tierCuts !== undefined ? { tierCuts: params.tierCuts } : {}),
    ...(state !== undefined ? { state } : {}),
  };

  return EventArtifactSchema.parse(candidate);
}

/**
 * The D1 seed rows for one algorithm's season-final state: `serializeState`, then every level-2
 * passenger, in this order. The ONE passenger chain: the D1 seed (`emitSeedSql`) and every SPR event
 * artifact's `state` block (`buildEventStateBlock`) are both built from its output, so a live Worker
 * splicing its writes into a published block keeps the block equal to D1.
 *
 * Passengers chain onto rows after the algorithm serializer, which never knows they exist. Each one
 * missing is a silent live/offline divergence, with no error on either side:
 * - Sigma beliefs (team rows): without them the Worker prices bands from the flat prior.
 * - RP beliefs (team rows): without them the Worker cold-starts every RP belief.
 * - Sigma population (LEAGUE row): without it resumed beliefs fall back to the flat talent prior.
 * - RP mean shift (LEAGUE row): without it the Worker prices live matches unshifted.
 * LEAGUE-row passengers are the easy ones to forget.
 *
 * A belief whose key has no level-1 team row is not dropped: it gets a passenger-only row. That is
 * every demo robot, which SPR keys as `DEMO_PSEUDO_TEAM_KEY` while the level-2 accumulators key it
 * raw. Until quick task 260918-wfc those beliefs were lost here, so an offseason event with a demo
 * robot priced differently live and offline.
 *
 * A non-Sigma algorithm gets an empty Sigma belief map and no population, so its seed carries no
 * Sigma key; an algorithm that publishes no ranking points gets whatever its layer holds (empty) and
 * no mean shift.
 */
function seedStateRows(algorithm: AlgorithmModule<unknown>, state: unknown, layer: SigmaScoutLayer, stamp: StateStamp): StateRow[] {
  let rows = withRpBeliefs(
    withSigmaBeliefs(
      serializeState(algorithm.id, algorithm.version, state as EpaState | OprState | SprState, stamp),
      layer.usesSigma ? layer.sigmaBeliefs() : new Map()
    ),
    layer.rpVariableBeliefs()
  );
  const sigmaPopulation = layer.usesSigma ? layer.sigmaPopulation() : undefined;
  if (sigmaPopulation !== undefined) rows = withSigmaPopulation(rows, sigmaPopulation);
  const rpMeanShift = layer.rpMeanShiftState();
  if (rpMeanShift !== undefined) rows = withRpMeanShift(rows, rpMeanShift);
  return rows;
}

/** `seedStateRows` computed at most once, on first call: a season serializes once however many event blocks need it. */
function memoizedSeedStateRows(algorithm: AlgorithmModule<unknown>, state: unknown, layer: SigmaScoutLayer, stamp: StateStamp): () => readonly StateRow[] {
  let rows: StateRow[] | undefined;
  return () => (rows ??= seedStateRows(algorithm, state, layer, stamp));
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

/**
 * The actual per-bonus outcome for every match in `stream`, computed once per season (it describes the
 * match, not a prediction). A season with no RP rule module returns an empty map.
 *
 * A non-qualification match gets no entry (absence), checked first: bonus RP is not a property it can
 * have. `null` means a match that could have bonus RP but could not be derived: an RP-ineligible event
 * type, no score breakdown, or a breakdown that fails to parse (caught so one bad match cannot abort
 * a publish). The arrays map the rule module's own `bonusNames` in order, missing names `false`,
 * never spreading the parsed record, so extra keys in third-party JSON cannot change their shape.
 */
export function actualBonusFlagsForSeason(stream: readonly MatchResult[], season: number): Map<string, ActualBonusFlags | null> {
  const result = new Map<string, ActualBonusFlags | null>();
  const ruleModule = RP_RULE_MODULES[season];
  if (ruleModule === undefined) return result;

  for (const match of stream) {
    // `undefined` (a non-qualification match) sets no entry at all; `null` and the arrays do.
    const flags = actualBonusFlagsForMatch(match, ruleModule);
    if (flags !== undefined) result.set(match.matchKey, flags);
  }
  return result;
}

export interface TeamSeasonEventInput {
  readonly eventKey: string;
  readonly eventName: string;
  readonly startDate: string;
  /** Played (`PredictionRecord`) or upcoming (`UpcomingPredictionRecord`) matches, told apart by `"winner" in match`. */
  readonly matches: readonly (PredictionRecord | UpcomingPredictionRecord)[];
  /** From `selectEventRankingsForSeason`; omitted when the corpus has no ranking for this (event, team) pair. */
  readonly rank?: number;
  /** Same source and omission rule as `rank`. */
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
    /** Required here so every caller states which basis produced `metrics`; the schema parses it as optional for older artifacts. */
    metricsBasis: "last-official-match" | "season-final";
  };
  readonly events: readonly TeamSeasonEventInput[];
  readonly metricHistory: readonly MetricHistoryRow[];
  readonly generation: string;
  readonly computedAt?: string;
  /** `match_key` -> `sort_time`, from `selectScheduledMatchTimes`; a missing entry leaves `sortTime` absent, never a synthetic default. */
  readonly sortTimeByMatchKey?: ReadonlyMap<string, number>;
  /**
   * `match_key` -> `ActualBonusFlags | null`, from `actualBonusFlagsForSeason`. A missing entry leaves
   * the actual bonus keys absent; a present `null` publishes an explicit `null`.
   */
  readonly actualBonusFlagsByMatchKey?: ReadonlyMap<string, ActualBonusFlags | null>;
  /** Robot image URL from `selectTeamMediaForYear`; omitted (never `null`) when there is no eligible photo. */
  readonly robotImageUrl?: string;
  /** Seasons this team competed in; feeds the team page's year dropdown. */
  readonly activeYears?: readonly number[];
  /** World/Country/District/State rank scopes; omitted and empty both publish no `ranks` key. */
  readonly ranks?: readonly TeamRankScope[];
  /** `match_key` -> raw YouTube video key, the same map as `BuildEventArtifactParams.videoByMatchKey`. */
  readonly videoByMatchKey?: ReadonlyMap<string, string>;
}

/** A payload-budget-sensitive artifact (the 292-match outlier). Parses through `TeamSeasonArtifactSchema` before returning. */
export function buildTeamSeasonArtifact(params: BuildTeamSeasonArtifactParams): TeamSeasonArtifact {
  const events = params.events.map((e) => ({
    eventKey: e.eventKey,
    eventName: e.eventName,
    startDate: e.startDate,
    // Conditional spreads throughout this file keep an omitted key absent, never present-and-undefined.
    ...(e.rank !== undefined ? { rank: e.rank } : {}),
    ...(e.totalTeams !== undefined ? { totalTeams: e.totalTeams } : {}),
    matches: e.matches.map((record) => {
      const { match } = record;
      const stamps = {
        season: params.season,
        algorithmId: params.algorithmId,
        algorithmVersion: params.algorithmVersion,
        sortTime: params.sortTimeByMatchKey?.get(match.matchKey),
        video: params.videoByMatchKey?.get(match.matchKey),
      };
      // An `UpcomingMatch` never carries `winner` at all, so its presence is the discriminant.
      // The played branch's body lives in `publishedRows.ts` (260915-p0a), shared with the live
      // Worker. `record` is not narrowed by `"winner" in match`, and `UpcomingPredictionRecord` never
      // declares `coldStart`, hence the `in` check on the way in.
      if ("winner" in match) {
        return teamSeasonPlayedRow(
          { ...record, match, ...("coldStart" in record && record.coldStart === true ? { coldStart: true as const } : {}) },
          stamps,
          params.actualBonusFlagsByMatchKey?.get(match.matchKey)
        );
      }
      return teamSeasonMatchRow(record, stamps);
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
      metricsBasis: params.seasonStats.metricsBasis,
    },
    events,
    metricHistory: params.metricHistory.map(roundMetricHistoryRow),
    robotImageUrl: params.robotImageUrl,
    activeYears: params.activeYears ? [...params.activeYears] : undefined,
    // Never `ranks: []` on the wire.
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

/** Every value is an integer count or a nullable week index, so nothing rounds. Parses through `EventsArtifactSchema`. */
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
// RP calibration measurement
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
 * Total-RP block: `redRpPmf`/`blueRpPmf` scored against actual alliance RP by ranked probability score,
 * pooled per alliance-side. Mirrors `CompareRpTotalSchema`. Omitted when `count` is 0, never zeroed.
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
 * Outcome block: `matchOutcomePmf` scored against `match.winner` by a three-outcome Brier, pooled per
 * match. Mirrors `CompareRpOutcomeSchema`. Omitted when `count` is 0.
 */
const RpCalibrationOutcomeSchema = z.object({
  count: z.number().int().nonnegative(),
  brierScore: z.number(),
  meanPredictedTie: z.number(),
  observedTieRate: z.number(),
});

/**
 * Duplicates `pageArtifacts.ts`'s module-private `CompareRpCalibrationSchema`, which is deliberately
 * not exported. The type check below guards against drift; `measureRpCalibration.test.ts` and
 * `pageArtifacts.test.ts` cross-check it at runtime against a real emitted fixture. Never add
 * `reliabilityBins` here independently of the wire schema.
 */
const RpCalibrationRecordSchema = z.object({
  scoredCount: z.number().int().nonnegative(),
  bonuses: z.array(RpCalibrationBonusSchema),
  totalRp: RpCalibrationTotalSchema.optional(),
  outcome: RpCalibrationOutcomeSchema.optional(),
});

/** An alias of `pageArtifacts.ts`'s wire type, not a re-declaration. */
export type RpCalibrationRecord = CompareRpCalibration;

/** Compile-time guard: fails to typecheck if `RpCalibrationRecordSchema` stops matching `CompareRpCalibration`. */
type _RpCalibrationSchemaMatchesWireType =
  z.infer<typeof RpCalibrationRecordSchema> extends CompareRpCalibration
    ? CompareRpCalibration extends z.infer<typeof RpCalibrationRecordSchema>
      ? true
      : false
    : false;
const _rpCalibrationSchemaMatchesWireType: _RpCalibrationSchemaMatchesWireType = true;
void _rpCalibrationSchemaMatchesWireType;

/**
 * The committed RP calibration measurement `buildCompareArtifact` attaches. A re-measurement gets a new
 * dated file and this path is repointed; a committed baseline is never edited in place, because older
 * files stay pinned by their own tests. `attachRpCalibration` matches algorithm ids literally, so the
 * file must be measured for the algorithms that publish ranking points.
 */
export const RP_CALIBRATION_MEASUREMENT_PATH = "data/baselines/rp-calibration-2026-09f.json";

/**
 * `scripts/measureRpCalibration.ts --emit-artifact` output: per-season calibration for each measured
 * algorithm. `algorithmVersions` and `command` say what produced a figure without a second file.
 */
export const RpCalibrationMeasurementSchema = z.object({
  measuredAt: z.string().min(1),
  command: z.string().min(1),
  corpusIdentity: z.string().min(1),
  offseasonIncluded: z.boolean(),
  algorithmVersions: z.record(z.string(), z.string()),
  /**
   * The shipped RP layer combination, as a label. Written by the emitter and read by nothing; it stays
   * in the measurement header and never reaches the wire. Optional so older measurements still parse.
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
 * Reads and validates a committed measurement. `undefined` only when the path does not exist; a file
 * that exists but does not parse throws, so a corrupt file never looks like a missing one.
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
 * Attaches each matching measurement record onto its slice. Figures round to six decimals here (far
 * finer than the page renders, and it keeps this block's wire cost deterministic against the compare
 * budget); counts stay integers. Only qualification slices are eligible, since bonus RP exists only
 * there; any other slice, or one with no record, is returned unchanged with no key. `totalRp` and
 * `outcome` are copied only when the record carries them.
 */
export function attachRpCalibration(
  slices: readonly ScoreSlice[],
  measurement: RpCalibrationMeasurement | undefined
): readonly (ScoreSlice & { rpCalibration?: CompareRpCalibration })[] {
  if (measurement === undefined) return slices;
  return slices.map((slice) => {
    if (slice.compLevelView !== "qualification") return slice;
    // Only an algorithm that publishes ranking points gets an RP accuracy card; the measurement's OPR
    // and EPA records never reach an artifact.
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
  /** The committed RP measurement to attach onto matching qualification slices; `undefined` attaches nothing. */
  readonly rpCalibration?: RpCalibrationMeasurement;
}

/**
 * Brier/accuracy/calibration figures ship unrounded (no `rounding.ts` field class applies); the one
 * exception is `rpCalibration`, rounded by `attachRpCalibration`. Parses through `CompareArtifactSchema`.
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
// Size-stat tracking lives in publishBudget.ts; re-exported for existing importers
// ---------------------------------------------------------------------------

export { computeSizeStats, type PageKindSizeStats, type PublishedObjectRecord };

const UPLOAD_HEADERS = { contentType: "application/json", cacheControl: "public, max-age=60" } as const;

/**
 * An OPTIONAL, read-only observer of every page-kind artifact body this run
 * records — the one way an offline instrument (`scripts/priceFrozenEventRow.ts`)
 * can see real artifact bodies without a network fetch of published objects.
 *
 * Inert by construction: there is no CLI flag for it, `publishSeasons` defaults
 * it to `undefined`, and an undefined sink is never called, so every existing
 * path is byte-identical. It is handed the body AFTER the budget ceiling has
 * been asserted, so it can never observe an object the gate rejected. It must
 * not mutate anything; it is passed a string, and its return value is ignored.
 */
export type ArtifactSink = (pageKind: PageKind, key: string, body: string) => void;

/**
 * The publisher's uploader (`application/json`, `max-age=60`). Records every object's page kind, key and
 * size even under `--dry-run`, which exists to re-measure budgets without spending Class-A operations.
 *
 * Every page-kind object is asserted against `PAGE_BUDGET_MAX_BYTES` before it is recorded or queued,
 * so an over-budget object never uploads. Real puts drain through a bounded `UploadQueue`; each publish
 * resolves once its put is accepted, which is the build loop's backpressure. Because the ceiling is
 * checked per object, earlier objects may already be in R2 when a later one fails (the same exposure as
 * a mid-run network failure; keys are version-addressed), so `--dry-run` is the complete pre-flight.
 */
class BoundedUploader {
  readonly records: PublishedObjectRecord[] = [];
  /**
   * Pre-schedule sidecar uploads, kept apart from `records`: a sidecar is deliberately not a `PageKind`,
   * so it stays out of per-kind budget accounting and has no ceiling. Summarized at the end of the run.
   */
  readonly sidecarRecords: { key: string; bytes: number }[] = [];
  readonly #queue: UploadQueue;

  constructor(
    private readonly bucket: string,
    concurrency: number,
    private readonly dryRun: boolean,
    private readonly artifactSink?: ArtifactSink
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
    // Last statement, after the ceiling assertion and the record, so a sink
    // never observes a body the budget gate rejected and never changes what
    // this method does. Absent by default: no call, no behavior change.
    this.artifactSink?.(pageKind, key, body);
  }

  /** Asserts the ceiling, records, and (real runs only) resolves once the put is accepted by the queue. */
  publish(pageKind: PageKind, key: string, body: string): Promise<void> {
    this.#record(pageKind, key, body);
    if (this.dryRun) return Promise.resolve();
    return this.#queue.enqueue(() => this.#put(key, body));
  }

  /**
   * A sidecar and its event artifact queued as one task, sidecar first (artifacts before the index that
   * references them). The event artifact's ceiling is asserted before anything is queued.
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
// Pre-schedule sidecar generation
// ---------------------------------------------------------------------------

/** Everything `buildPreScheduleSidecarForEvent` needs to decide, price and serialize one (event, algorithm) pair's sidecar. */
interface PreScheduleSidecarArgs {
  readonly eventKey: string;
  readonly season: number;
  /** The real event's TBA `event_type`. `eventTierFor` throws for unmapped types (99/Offseason), so RP-ineligible events are gated out before any synthetic match exists. */
  readonly eventType: number;
  /** The real event's TBA week (0-indexed) or `null`, passed through to every synthetic `UpcomingMatch`. */
  readonly week: number | null;
  readonly algorithm: AlgorithmModule<any>;
  /** The published roster: match-derived when matches exist, registered (`event_teams`) otherwise. */
  readonly roster: readonly string[];
  /** Qualification matches (played + scheduled) in the corpus: the freeze predicate and `matchesPerTeamFor`'s input. */
  readonly qualMatchCount: number;
  /** Whether a walk-forward pre-event state was captured (absent for the cold-start season's first event, or an event with no completed matches yet). */
  readonly hasPreEventState: boolean;
  readonly preEventState: unknown;
  /** Whether any match has been played; tells a not-yet-started event apart from the cold-start season's first event. */
  readonly hasCompletedMatches: boolean;
  /** Whether a season-final state exists: the current-state pricing source for scheduleless events. */
  readonly hasSeasonFinalState: boolean;
  /** Fills SigmaScout-layer ranking points onto a synthetic prediction when the algorithm models none (see `makeRankingPointFiller`). */
  readonly fillRankingPoints?: (match: UpcomingMatch, prediction: Prediction) => Prediction;
  readonly seasonFinalState: unknown;
  readonly generation: string;
  readonly computedAt: string;
}

/**
 * Decides whether one (event, algorithm) pair gets a pre-schedule sidecar and builds it; `undefined`
 * on every skip. The caller uploads the body before the same event's artifact.
 *
 * "Freeze once the schedule lands" is a source-of-state switch, not an R2 read: any qualification row
 * in the corpus means the schedule landed, so pricing uses the walk-forward pre-event state (stable
 * across republishes). No qualification rows means pricing from current state, regenerated each publish.
 *
 * Out-of-range rosters are skipped by an explicit size check, so any error the builder throws fails
 * the run. A `null` artifact means an RP-less algorithm and is skipped silently.
 *
 * The body is `PublishedPreScheduleArtifactSchema.parse(artifact)`, which drops the priced `schedules`
 * block (most of the bytes, never read by the client) and carries `scheduleCount` from its length.
 * `buildPreScheduleArtifact` still returns that block for `scripts/measureFieldAveragedRanks.ts`.
 */
function buildPreScheduleSidecarForEvent(args: PreScheduleSidecarArgs): { key: string; body: string } | undefined {
  const label = `publish: presim skip ${args.eventKey} [${args.algorithm.id}]`;
  if (!isRpEligibleEventType(args.eventType)) {
    console.log(`${label}: event_type ${args.eventType} is not RP-eligible`);
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
      // Schedule landed but no pre-event state. If nothing has been played, the pre-event state IS the
      // current state: price from it and keep regenerating until the first completed match.
      if (!args.hasCompletedMatches && args.hasSeasonFinalState) {
        pricingState = args.seasonFinalState;
        pricedFrom = "current-state";
      } else {
        // The cold-start season's first event: its pre-event state is internal to the algorithm and
        // not exposed. Never substitute a later state.
        console.log(`${label}: no pre-event walk-forward state was captured (the cold-start season's first event)`);
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

  // The real schedule's matches-per-team when known, else Statbotics' 12 (10 for Championship Divisions).
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
    // Bound to the chosen state, so synthetic matches are priced by the same `predict()` path as real ones.
    predict: (match) => {
      const prediction = args.algorithm.predict(pricingState, match);
      return args.fillRankingPoints === undefined ? prediction : args.fillRankingPoints(match, prediction);
    },
  });
  if (artifact === null) return undefined; // RP-less algorithm, silent by design

  const key = preScheduleKey({ eventKey: args.eventKey, algorithmId: args.algorithm.id, version: args.algorithm.version });
  return { key, body: JSON.stringify(PublishedPreScheduleArtifactSchema.parse(artifact)) };
}

// ---------------------------------------------------------------------------
// Corpus lookups
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
 * so absence means "Common or unranked". Exported for unit tests.
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
 * `metricsByTeam` is as-of-event (from `metricsAsOfEvent`); `rankingPools` is the season ranking pool.
 * Both `rankingPools` and `sigmaByTeam` are required, because an optional input is an opt-out and an
 * artifact without percentiles still parses and renders every tier box dark.
 *
 * Sigma-enabled algorithms pass the same `sigmaMetricByTeam` object the Teams row and team-season
 * artifact use; others pass `{}`. It merges after `withEventPercentiles`, as the last key, so the pool
 * never re-ranks Sigma. A team with no entry gets no key. `sigmaByTeam`'s own rating axis is the
 * last-official-match Total (see `sigmaMetric.ts`'s file header), not this function's `metricsByTeam`
 * (as-of-event) or `rankingPools` (event roster) -- do not assume the three share a basis.
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
 * Walk-forward metrics as of one event's last chronological match, captured by the replay loop's
 * per-match hook. A missing capture means an event with no completed matches, whose only defensible
 * answer is season-final metrics; never widen that fallback, or a page claiming "what the model knew
 * at this event" would silently show season's end. `state` is `unknown`, so the guard is an explicit
 * `!== undefined`, never truthiness.
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

/** The two per-algorithm stamps on an events-list body, re-validated when the shared base is re-stamped per algorithm. */
const EventsArtifactStampSchema = EventsArtifactSchema.pick({ algorithmId: true, algorithmVersion: true });

// ---------------------------------------------------------------------------
// Phase timings
// ---------------------------------------------------------------------------

/** Wall-clock milliseconds per labelled publish phase, accumulated per label; printed as `timing:` lines and returned on `PublishSummary.timings`. */
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
   * `--include-offseason`; defaults to `false`. A run without it does not rewrite offseason event
   * artifacts an earlier run wrote: nothing is deleted, so those objects go stale rather than disappear.
   */
  readonly includeOffseason?: boolean;
  /** First season that gets pre-schedule sidecars (`--presim-from-season`); defaults to `DEFAULT_PRESCHEDULE_FROM_SEASON`. */
  readonly preScheduleFromSeason?: number;
  readonly generation?: string;
  readonly computedAt?: string;
  /** The RP calibration measurement for the compare artifact; `undefined` attaches nothing. The CLI loads `RP_CALIBRATION_MEASUREMENT_PATH` by default. */
  readonly rpCalibration?: RpCalibrationMeasurement;
  /** An optional read-only observer of every recorded artifact body — see `ArtifactSink`. No CLI flag; `undefined` means no call and no behavior change. */
  readonly artifactSink?: ArtifactSink;
}

export interface PublishSummary {
  readonly generation: string;
  readonly computedAt: string;
  readonly objectCount: number;
  readonly totalBytes: number;
  readonly pages: Partial<Record<PageKind, PageKindSizeStats>>;
  readonly seedFiles: readonly string[];
  readonly manifestKeys: readonly string[];
  /** Wall-clock milliseconds per publish phase: `season {year} replay|fold|compare`, `{year}/{algorithm} build|sidecars|uploadWait`, `uploadDrain`, and `total`. */
  readonly timings: Readonly<Record<string, number>>;
  /** Pre-schedule sidecar size stats (not a `PageKind`, so outside `pages`); `undefined` when the run wrote none. */
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
  /** NULL until an --events-only refetch fills it. */
  name: string | null;
  week: number | null;
  country: string | null;
  state_prov: string | null;
  district_key: string | null;
}

/**
 * The STUB artifact a probe-window event gets (quick task 260921-5qw): identity and the season's
 * `tierCuts`, with empty `matches`, `upcoming` and `teams`. The season loop reaches the same body through
 * its general path, and `publish.test.ts` pins the two equal; this entry point exists for
 * `scripts/publishProbeStubs.ts`, which publishes ONLY the stubs (about 120 objects) when a full
 * republish (about 109,000) would be the only other way to get them out.
 */
export function buildProbeStubArtifact(params: {
  readonly event: { readonly event_key: string; readonly event_type: number; readonly start_date: string; readonly name: string; readonly week: number | null; readonly country: string | null; readonly state_prov: string | null };
  readonly season: number;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  readonly generation: string;
  readonly computedAt: string;
  readonly tierCuts: EventArtifact["tierCuts"];
}): EventArtifact {
  const e = params.event;
  return buildEventArtifact({
    eventKey: e.event_key,
    season: params.season,
    algorithmId: params.algorithmId,
    algorithmVersion: params.algorithmVersion,
    predictions: [],
    upcoming: [],
    teams: [],
    allianceTeams: [],
    generation: params.generation,
    computedAt: params.computedAt,
    eventMeta: { name: e.name, startDate: e.start_date, country: e.country, stateProv: e.state_prov, week: e.week },
    alliances: [],
    eventType: e.event_type,
    tierCuts: params.tierCuts,
  });
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
 * `match_key` -> `sort_time` for every match in a season, played or not. `UpcomingMatch` deliberately
 * carries no time field (it is `predict()`'s leak-proof input), so times come from this local query.
 * `excludeOffseason` mirrors the season loop's scope.
 */
function selectScheduledMatchTimes(db: Corpus, season: number, options: { excludeOffseason?: boolean } = {}): Map<string, number> {
  const clauses: string[] = ["e.year = @year"];
  const params: Record<string, string | number> = { year: season };
  if (options.excludeOffseason === true) {
    clauses.push(OFFICIAL_EVENT_SQL);
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
 * `match_key` -> `video_key` for matches with a non-empty `video_key`, scoped exactly like
 * `selectScheduledMatchTimes`. A match with no video is absent from the map, never a `null` value.
 */
function selectMatchVideoKeys(db: Corpus, season: number, options: { excludeOffseason?: boolean } = {}): Map<string, string> {
  const clauses: string[] = ["e.year = @year"];
  const params: Record<string, string | number> = { year: season };
  if (options.excludeOffseason === true) {
    clauses.push(OFFICIAL_EVENT_SQL);
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

/** The comp-level play order of `selectScheduledMatches`'s `CASE` clause; keep the two in step. */
/**
 * Sorts one event's played and scheduled records by `sortTime`, then comp level, `setNumber`,
 * `matchNumber` and `matchKey`, the same chain as `selectScheduledMatches`. A missing time sorts last.
 */
function sortTeamSeasonMatches(
  matches: readonly (PredictionRecord | UpcomingPredictionRecord)[],
  sortTimeByMatchKey: ReadonlyMap<string, number>
): (PredictionRecord | UpcomingPredictionRecord)[] {
  return [...matches].sort((a, b) => {
    const aTime = sortTimeByMatchKey.get(a.match.matchKey) ?? Number.POSITIVE_INFINITY;
    const bTime = sortTimeByMatchKey.get(b.match.matchKey) ?? Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    const aRank = COMP_LEVEL_PLAY_ORDER[a.match.compLevel];
    const bRank = COMP_LEVEL_PLAY_ORDER[b.match.compLevel];
    if (aRank !== bRank) return aRank - bRank;
    if (a.match.setNumber !== b.match.setNumber) return a.match.setNumber - b.match.setNumber;
    if (a.match.matchNumber !== b.match.matchNumber) return a.match.matchNumber - b.match.matchNumber;
    return a.match.matchKey.localeCompare(b.match.matchKey);
  });
}

/**
 * The full offline publisher. Its own season loop threads `carrySeason` boundary state because it
 * needs the final live states for the seed, which a predictions-only replay would drop.
 * `buildSeasonStream`/`WalkForwardSimulator` are the leak-proof replay primitives, reused unchanged.
 */
export async function publishSeasons(db: Corpus, options: PublishSeasonsOptions): Promise<PublishSummary> {
  const uploader = new BoundedUploader(options.bucket, options.concurrency ?? DEFAULT_CONCURRENCY, options.dryRun ?? false, options.artifactSink);
  try {
    return await publishSeasonsWith(db, options, uploader);
  } catch (err) {
    // Let in-flight puts settle so nothing is still writing when the caller sees the original error.
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

  // activeYears pre-pass over every requested season. A narrower run under-reports it and would hide
  // real years from the team page's year dropdown, so the narrowing is logged.
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
  /**
   * The final season's seed-row getters (`memoizedSeedStateRows`), keyed by algorithm id; absent for
   * an algorithm with no final state. The D1 seed calls the same getter the season's event blocks
   * called, so both come from one serialization and one passenger chain.
   */
  let finalSeasonStateRows = new Map<string, () => readonly StateRow[]>();
  /**
   * The final season's own last-folded match key per event key, for the D1
   * seed's fourth file (`emitCursorSeedSql`, quick task 260920-q75) — built by
   * walking that season's `stream` in order and overwriting each match's
   * `eventKey` entry, so the final write per key is genuinely that event's
   * LAST folded match. `undefined` when the final season has not been
   * reached yet (or this run seeds no state at all).
   */
  let finalSeasonLastFoldedByEvent = new Map<string, string>();
  /** The final season number itself, alongside `finalSeasonLastFoldedByEvent` — `emitCursorSeedSql`'s cursor set is scoped to windows in THIS season only. */
  let finalSeasonNumber: number | undefined;
  /** Run-wide `state` block totals for the summary. */
  const stateBlockTotals = { count: 0, totalBytes: 0, maxBytes: 0, maxKey: "" };

  for (const [seasonIdx, season] of seasonsSorted.entries()) {
    const stream = buildSeasonStream(db, season, { includeOffseason });
    const scheduled = selectScheduledMatches(db, { year: season, excludeOffseason: !includeOffseason });
    // The `frc9970`-`frc9999` demo team keys are dropped here, the one place the published team list is
    // built, so no page, row, search hit or rank exists for them. The model-side exclusion in
    // `demoTeams.ts` is independent.
    const teamsThisSeason = Array.from(
      new Set([...stream.flatMap((m) => [...m.redTeams, ...m.blueTeams]), ...scheduled.flatMap((m) => [...m.redTeams, ...m.blueTeams])])
    ).filter((teamKey) => !isDemoTeamKey(teamKey));
    // Built once per season, reused by every algorithm's per-event `allianceTeams` computation below:
    // "the walk-forward saw this team, and it is not a demo key" — the same gate `teamsThisSeason`
    // itself already encodes.
    const teamsThisSeasonSet = new Set(teamsThisSeason);
    const eventMeta = selectEventMeta(db, season);
    const offseasonEventKeys = new Set(eventMeta.filter((e) => e.is_offseason === 1).map((e) => e.event_key));
    // Scopes the Teams-list snapshot to official play via the shared `isOfficialEventType`, which the
    // Worker and web also read.
    const officialEventKeys = new Set(eventMeta.filter((e) => isOfficialEventType(e.event_type)).map((e) => e.event_key));
    // Registered teams per event. An absent key means "unknown", never coalesced into an empty roster.
    const registeredTeamsByEvent = selectEventTeamsForEvents(
      db,
      eventMeta.map((e) => e.event_key)
    );
    // Qualification matches (played + scheduled) per event: "has the schedule landed?" and `matchesPerTeamFor`'s input.
    const qualMatchCountByEvent = new Map<string, number>();
    for (const m of stream) {
      if (m.compLevel === "qm") qualMatchCountByEvent.set(m.eventKey, (qualMatchCountByEvent.get(m.eventKey) ?? 0) + 1);
    }
    for (const m of scheduled) {
      if (m.compLevel === "qm") qualMatchCountByEvent.set(m.eventKey, (qualMatchCountByEvent.get(m.eventKey) ?? 0) + 1);
    }
    // Checked and logged once per season; per-event skip logs cover only in-scope seasons.
    const presimEnabled = season >= preScheduleFromSeason;
    if (!presimEnabled) {
      console.log(`publish: presim: season ${season} is below presim-from-season ${preScheduleFromSeason} — no sidecars this season.`);
    }
    // Season-scoped, algorithm-independent reads, done once per season.
    const sortTimeByMatchKey = selectScheduledMatchTimes(db, season, { excludeOffseason: !includeOffseason });
    const videoByMatchKey = selectMatchVideoKeys(db, season, { excludeOffseason: !includeOffseason });
    // A null `imageUrl` or no row means no usable photo; passed through as `undefined`, never guessed.
    const teamMediaForSeason = selectTeamMediaForYear(db, season);
    // event_key -> team_key -> {rank, totalTeams}; a missing entry leaves both undefined, never zero.
    const eventRankingsForSeason = selectEventRankingsForSeason(db, season);
    // `?? []` at the per-event call site means "zero rows", not "unknown": the corpus was consulted.
    const alliancesForSeason = selectEventAlliancesForSeason(db, season);
    const actualBonusFlagsByMatchKey = actualBonusFlagsForSeason(stream, season);

    // `fromSeason` is the actual preceding season in `seasonsSorted`, not `season - 1`: `carrySeason`
    // reads it to compute a gap.
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

    // Per-match, per-algorithm metric snapshots for `metricHistory`, collected in the same pass.
    const matchIndexByKey = new Map(stream.map((m, i) => [m.matchKey, i]));
    const algorithmById = new Map(options.algorithms.map((a) => [a.id, a]));
    const metricHistoryByAlgoTeam = new Map<string, Map<string, MetricHistoryRow[]>>();
    for (const algorithm of options.algorithms) metricHistoryByAlgoTeam.set(algorithm.id, new Map());
    // eventKey -> state after that event's last match, per algorithm, captured in the same hook. The
    // stream is chronological, so the last write per event is its last match. Every `update` returns a
    // new state object, so storing the reference is a real snapshot, never an alias of the final state.
    const stateByAlgoEvent = new Map<string, Map<string, unknown>>();
    for (const algorithm of options.algorithms) stateByAlgoEvent.set(algorithm.id, new Map());
    // eventKey -> state immediately before that event's first completed match (`lastStateByAlgo`).
    // Events overlap, so this is the global state at that instant, which is the correct walk-forward
    // answer. Lookups use `.has()` because state is `unknown`. `preEventCaptureSeen` decides once per
    // (algorithm, event), so the cold-start first event is never given a mid-event state on match two.
    const preEventStateByAlgoEvent = new Map<string, Map<string, unknown>>();
    const preEventCaptureSeen = new Map<string, Set<string>>();
    for (const algorithm of options.algorithms) {
      preEventStateByAlgoEvent.set(algorithm.id, new Map());
      preEventCaptureSeen.set(algorithm.id, new Set());
    }
    const lastStateByAlgo = new Map<string, unknown>();
    /** Per `(algorithmId, matchKey)`, each rostered team's rating after that match: the Sigma Score talent prior's input. */
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
          // The season's first match: its pre-event state is the carried season-boundary state.
          preEventStateByAlgoEvent.get(algorithmId)!.set(match.eventKey, initialStates.get(algorithmId));
        }
        // else: the cold-start season's first event. No entry, so the sidecar path skips it rather than
        // fabricating a distribution.
      }
      lastStateByAlgo.set(algorithmId, state);
      stateByAlgoEvent.get(algorithmId)!.set(match.eventKey, state);
      const involvedTeams = [...match.redTeams, ...match.blueTeams];
      const metrics = algorithm.teamMetrics(state, involvedTeams);
      // Sigma Score's talent prior, from the metrics pass already run above. Post-update state is the
      // admissible talent for the team's next match; `foldPlayed` applies it after folding, so a match
      // never informs its own prior.
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
    // One level-2 layer per algorithm. `records` is chronological, which is the order `foldPlayed` requires.
    const rpRuleModule = RP_RULE_MODULES[season];
    const layers = new Map<string, SigmaScoutLayer>();
    for (const algorithm of options.algorithms) layers.set(algorithm.id, new SigmaScoutLayer(rpRuleModule, algorithm.id));

    /**
     * algorithm id -> team key -> match key -> Sigma Score right after that match's fold, merged by
     * `withHistorySigma`. Kept out of `metricHistoryByAlgoTeam`, whose rows also feed the ranking pools,
     * the Teams row and `seasonStats`.
     */
    const sigmaByMatchKeyForAlgoTeam = new Map<string, Map<string, Map<string, number>>>();
    for (const algorithm of options.algorithms) sigmaByMatchKeyForAlgoTeam.set(algorithm.id, new Map());

    for (const r of records) {
      // One object for both maps below, so event and team pages cannot disagree. `foldPlayed` builds a
      // fresh record without the cold-start stamp, so it is spread back in here.
      const layer = layers.get(r.algorithmId)!;
      const pr: PredictionRecord = {
        ...layer.foldPlayed(r.match, r.prediction, talentAfterMatch.get(`${r.algorithmId}:${r.match.matchKey}`)),
        ...(r.coldStart === true ? { coldStart: true as const } : {}),
      };
      // Read after this match's fold, one team at a time via `sigmaFor`; never `sigmaScoreByTeam()`,
      // which scores every team the layer has seen and must never run per match.
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

    // Two populations: `teamStatsAllPlay` (every replayed match) feeds `deriveTeamRegions`;
    // `teamStatsOfficial` feeds the published W-L-T, `matchCount` and `eventCount`. It reuses
    // `officialEventKeys` rather than re-deriving event types, to avoid drift.
    const teamStatsAllPlay = computeTeamSeasonStats(stream);
    const teamStatsOfficial = computeTeamSeasonStats(stream.filter((m) => officialEventKeys.has(m.eventKey)));
    const eventCounts = computeEventCounts(stream, scheduled);

    // Home region is algorithm-agnostic, so it is derived once per season. The all-play input is
    // equivalent to the official one here: `deriveTeamRegions` applies its own `isRegionEligibleEvent`
    // filter, so offseason events never contribute to a region.
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

    // Every algorithm's predictions this season, for the compare artifact's `aggregateScores` (one per year).
    const harnessPredictions: HarnessPredictionInput[] = records.map((r) => ({
      matchKey: r.match.matchKey,
      season,
      // Carried for event-blocked resampling.
      eventKey: r.match.eventKey,
      compLevel: r.match.compLevel,
      algorithmId: r.algorithmId,
      pRedWin: r.prediction.pRedWin,
      predictedRedScore: r.prediction.redScore,
      predictedBlueScore: r.prediction.blueScore,
      actualWinner: r.match.winner,
      // UNOFFICIAL, not merely offseason: preseason Week 0 (type 100) is excluded from the scored set
      // too. The field and the published `exclusionCounts.offseason` label keep their names; until quick
      // task 260919-368 this read the corpus `is_offseason` flag, which is type 99 alone, so every
      // season's Week 0 matches were scored.
      isOffseason: !isOfficialEventType(r.match.eventType),
      isSurrogateAffected: r.match.redSurrogates.length > 0 || r.match.blueSurrogates.length > 0,
      isColdStart: r.coldStart === true,
    }));

    // --- events/{year}/{algorithm}@{version}.json rows, once per season ---
    // Counts reflect matches replayed this run, so an offseason event shows zeros without
    // --include-offseason. The rows are algorithm-independent and built once; per-algorithm bodies
    // differ only by stamps, overwritten on a spread of this base (key order is unchanged).
    const eventsRows: EventsArtifactEventInput[] = eventMeta.map((e) => {
      const counts = eventCounts.get(e.event_key);
      return {
        eventKey: e.event_key,
        // Falls back to the event key when the corpus name is null (never ran --events-only).
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

    const seasonStateRows = new Map<string, () => readonly StateRow[]>();
    for (const algorithm of options.algorithms) {
      const blockStart = performance.now();
      let sidecarMs = 0;
      const state = records.finalStates.get(algorithm.id);
      const version = algorithm.version;
      // Season-final metrics. Not a ranking pool: `sigmaMetricByTeam`'s FALLBACK rating axis (its
      // primary axis is `officialMetricsByTeam`, below), the `metricsAsOfEvent` fallback, and an
      // offseason-only team's `seasonStats` values.
      const metricsByTeam = state !== undefined ? algorithm.teamMetrics(state, teamsThisSeason) : {};
      const metricHistoryForAlgo = metricHistoryByAlgoTeam.get(algorithm.id)!;
      // The season ranking pool, built once: every team's metrics as of its last official match. Every
      // published percentile (Teams row, `seasonStats`, `metricHistory`, event standings) ranks against
      // this one pool, so a value gets the same tier on every page. An offseason-only team is absent from
      // the pool, never counted as a zero.
      const officialMetricsByTeam = lastOfficialMetricsByTeam(metricHistoryForAlgo, officialEventKeys);
      const rankingPools = sortedPoolsByMetric(officialMetricsByTeam, teamsThisSeason);
      // Built ONCE per (algorithm, season), from the SAME rankingPools every
      // percentile below ranks against, then passed unchanged to every
      // event artifact this season builds (quick task 260920-qzf). Never a
      // `sigma` key: `rankingPools` is built from `officialMetricsByTeam`,
      // which structurally never carries one (see `EventTierCutsSchema`'s
      // doc comment in `pageArtifacts.ts`).
      const eventTierCuts = buildTierCutsFromPools(rankingPools);
      const officialMetricsByTeamWithPercentiles = withPercentiles(officialMetricsByTeam, teamsThisSeason, rankingPools);
      const stateByEventForAlgo = stateByAlgoEvent.get(algorithm.id)!;
      const preEventStateForAlgo = preEventStateByAlgoEvent.get(algorithm.id)!;
      const eventMatchesForAlgo = perAlgoEventMatches.get(algorithm.id)!;
      const teamMatchesForAlgo = perAlgoTeamMatches.get(algorithm.id)!;

      // Scheduled-match predictions, one `predict()` per match, shared by the event `upcoming` array
      // and the per-team grouping.
      const scheduledPredictionsByEvent = new Map<string, UpcomingPredictionRecord[]>();
      // The layer walked the played stream above, so an unplayed match is priced from everything
      // played so far.
      const layerForAlgo = layers.get(algorithm.id)!;
      // Season-final Sigma Scores (empty for non-Sigma algorithms), one accessor so the presim win-odds
      // variance and the metric entry below agree.
      const sigmaByTeamForAlgo = layerForAlgo.sigmaScoreByTeam();
      // The season-final seed rows, serialized at most once: every SPR event block this season reads
      // them, and the D1 seed reuses this getter when this is the final season.
      const stateRowsForAlgo = state !== undefined ? memoizedSeedStateRows(algorithm, state, layerForAlgo, stamp) : undefined;
      if (stateRowsForAlgo !== undefined) seasonStateRows.set(algorithm.id, stateRowsForAlgo);
      // Event blocks only from the bundled SPR module itself: the browser prices a block with that
      // module, so a stand-in that merely shares its id (a test double) must never publish one.
      const eventStateRowsForAlgo = algorithm === spr ? stateRowsForAlgo : undefined;
      const seasonStateBlocks = { count: 0, totalBytes: 0, maxBytes: 0, maxKey: "" };
      // The published Sigma Score metric, computed once and consumed by both the Teams row and the
      // team-season artifact, so they cannot disagree. The rating axis is the last-official-match
      // Total (`officialMetricsByTeam`), falling back to season-final `metricsByTeam` only for a team
      // with no official match -- the Total the Teams page actually prints beside the tier. The
      // published Sigma VALUE itself stays season-final (`sigmaByTeamForAlgo`), a pairing asymmetry
      // documented in `sigmaMetric.ts`'s file header. OPR and EPA publish no Sigma Score.
      const sigmaMetricForAlgo = usesSigmaScore(algorithm.id)
        ? sigmaMetricByTeam({
            valueByTeam: sigmaByTeamForAlgo,
            officialMetricsByTeam: officialMetricsByTeam,
            seasonFinalMetricsByTeam: metricsByTeam,
            teamKeys: teamsThisSeason,
            metricKey: SIGMA_METRIC_KEY,
          })
        : {};
      if (state !== undefined) {
        for (const [eventKey, matchesForEvent] of scheduledByEvent) {
          scheduledPredictionsByEvent.set(
            eventKey,
            // One record per match, shared by both consumers, so both carry the same band and pmf.
            matchesForEvent.map((match) => layerForAlgo.enrichUpcoming(match, algorithm.predict(state, match)))
          );
        }
      }
      // Per-team grouping, so a team scheduled at an event it has not played yet still gets a section.
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
        // Official play only. A team with none publishes a zero record and zero counts, never a missing row.
        const stats = teamStatsOfficial.get(teamKey);
        return {
          teamKey,
          teamNumber: info.teamNumber,
          nickname: info.nickname,
          record: { wins: stats?.wins ?? 0, losses: stats?.losses ?? 0, ties: stats?.ties ?? 0 },
          // Metrics as of the last official match, so offseason results never move a team on this list;
          // record and counts use the same official population. Offseason play stays visible in the
          // team-season artifact.
          //
          // Carries the rarity tier, not the percentile: percentile costs +42% gzipped on the largest
          // teams artifact against +10% for tier with Common omitted, for an identical render.
          //
          // The sigma entry merges before `withPublishedTiers` strips `percentile`; merging after would
          // leave a percentile that `encodeTeamMetricEntry` throws on. The VALUE is season-final, unlike
          // the official-scoped values beside it; the RANK it is tiered against is official-first (see
          // `sigmaMetricByTeam`'s call above) -- value and axis are no longer the same basis.
          metrics: withPublishedTiers({
            ...(officialMetricsByTeamWithPercentiles[teamKey] ?? {}),
            ...(sigmaMetricForAlgo[teamKey] !== undefined ? { [SIGMA_METRIC_KEY]: sigmaMetricForAlgo[teamKey] } : {}),
          }),
          eventCount: stats?.eventKeys.size ?? 0,
          matchCount: stats?.matchCount ?? 0,
          // Spread so an underivable region field is absent, never an `undefined` key.
          ...teamRegions.get(teamKey),
        };
      });
      // Ranks the exact rows being published, so the published rank and the Teams table's client-side
      // rank (`buildTeamRows`, same `compareTeamsByTotal`) agree by construction.
      const rankableTeamRows: RankableTeamRow[] = teamsRows.map((row) => ({
        teamKey: row.teamKey,
        teamNumber: row.teamNumber,
        // Rounded, as the browser sorts them: rounding can collapse two totals into a team-number
        // tie-break, and unrounded ranks could then differ by one place from the table's.
        metrics: roundTeamMetricRecord(row.metrics),
        ...teamRegions.get(row.teamKey),
      }));
      // Every pool sorted once; `rankableTeamRows` is 1:1 with `teamsRows`, so every row key gets an entry.
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
      // The season base re-stamped for this algorithm; the stamps are re-validated, so nothing unparsed uploads.
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
        // An event survives with predictions, upcoming matches, or a registered roster (so scheduleless
        // events get a page). An `undefined` entry means registration unknown, never zero teams.
        const registeredTeamKeys = registeredTeamsByEvent.get(e.event_key);
        // A STUB (quick task 260921-5qw): an event with nothing at all still gets an artifact when it
        // gets a PROBE window, because the Worker can promote exactly those events to live folding and
        // its bootstrap cannot supply a name, a week or tier cuts. `probeWindowFor` is the manifest
        // builder's own rule and the same clock, so "has a window" and "has a stub" cannot disagree.
        // The stub carries identity and `tierCuts` with empty `matches`, `upcoming` and `teams`; the
        // Worker's merge carries all of it forward from its first fold.
        const hasNothing = predictions.length === 0 && upcoming.length === 0 && registeredTeamKeys === undefined;
        if (hasNothing && probeWindowFor(e.start_date, Date.parse(computedAt)) === undefined) continue; // no data for this event under this run's scope
        // The registered roster is used only when the match-derived one is empty, so never-played teams
        // are not added to standings. Sorted for determinism; match-derived rosters keep chronological order.
        const eventTeamKeys = matchDerivedTeamKeys.length > 0 ? matchDerivedTeamKeys : [...(registeredTeamKeys ?? [])].sort();
        // The corpus was consulted, so a missing entry means `[]` ("zero rows"); hoisted so both the
        // builder's `alliances` argument and the `allianceTeams` computation below read one value.
        const eventAlliances = alliancesForSeason.get(e.event_key) ?? [];
        // As-of-event values, ranked against the season ranking pool.
        const asOfEventMetrics = metricsAsOfEvent(algorithm, stateByEventForAlgo, e.event_key, eventTeamKeys, metricsByTeam);
        // The same `sigmaMetricForAlgo` object as the Teams row and team-season artifact.
        const teamsStanding = buildEventTeamsStanding(asOfEventMetrics, eventTeamKeys, teamInfo, rankingPools, sigmaMetricForAlgo);
        // Playoff alliance members who never took the field at this event: every distinct key across
        // this event's alliance picks, minus the teams `teamsStanding` above already covers (never a
        // second row for one team key), kept only when the season's walk-forward actually saw the
        // team — that one filter is both "the model has something to say about this team" and the
        // demo-key exclusion, since `teamsThisSeasonSet` already drops demo keys. Sorted for
        // determinism, matching the registered-roster fallback above.
        //
        // A SECOND, narrower `metricsAsOfEvent`/`buildEventTeamsStanding` pass rather than widening the
        // pair above: `algorithm.teamMetrics` takes the key set as an argument, and a wider set is not
        // provably value-identical for the original keys, which is the byte-identity guarantee `teams`
        // depends on. An empty list makes no second call and adds no key to the artifact — most events.
        const eventTeamKeySet = new Set(eventTeamKeys);
        const allianceOnlyKeys = Array.from(new Set(eventAlliances.flatMap((alliance) => alliance.picks)))
          .filter((teamKey) => !eventTeamKeySet.has(teamKey) && teamsThisSeasonSet.has(teamKey))
          .sort();
        let allianceTeams: EventTeamStandingInput[] = [];
        if (allianceOnlyKeys.length > 0) {
          const allianceMetrics = metricsAsOfEvent(algorithm, stateByEventForAlgo, e.event_key, allianceOnlyKeys, metricsByTeam);
          // A team with no state entry (the season's walk-forward never saw it) publishes nothing here,
          // never an invented empty-metrics row.
          const survivingAllianceKeys = allianceOnlyKeys.filter((teamKey) => Object.keys(allianceMetrics[teamKey] ?? {}).length > 0);
          allianceTeams = buildEventTeamsStanding(allianceMetrics, survivingAllianceKeys, teamInfo, rankingPools, sigmaMetricForAlgo);
        }
        const eventArtifact = buildEventArtifact({
          eventKey: e.event_key,
          season,
          algorithmId: algorithm.id,
          algorithmVersion: version,
          predictions,
          upcoming,
          teams: teamsStanding,
          allianceTeams,
          generation,
          computedAt,
          sortTimeByMatchKey,
          actualBonusFlagsByMatchKey,
          // Raw corpus columns; the location string is composed inside the builder.
          eventMeta: { name: e.name, startDate: e.start_date, country: e.country, stateProv: e.state_prov, week: e.week },
          alliances: eventAlliances,
          rankings: eventRankingsForSeason.get(e.event_key),
          videoByMatchKey,
          eventType: e.event_type,
          stateRows: eventStateRowsForAlgo,
          tierCuts: eventTierCuts,
        });
        const key = artifactKey({ page: "event", eventKey: e.event_key, algorithmId: algorithm.id, version });
        const eventBody = JSON.stringify(eventArtifact);
        if (eventArtifact.state !== undefined) {
          const stateBytes = Buffer.byteLength(JSON.stringify(eventArtifact.state), "utf8");
          for (const totals of [seasonStateBlocks, stateBlockTotals]) {
            totals.count += 1;
            totals.totalBytes += stateBytes;
            if (stateBytes > totals.maxBytes) {
              totals.maxBytes = stateBytes;
              totals.maxKey = key;
            }
          }
        }
        // The pre-schedule sidecar, only for in-scope seasons and RP-publishing algorithms (any other
        // algorithm's probe would return null after pricing a match for nothing). Other skips are decided
        // inside `buildPreScheduleSidecarForEvent`. It rides one queued task with the event artifact,
        // sidecar first, so the two never race.
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
              // The mean shift at the same instant as the accumulator, rebuilt through the Worker's resume path.
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
        // Played and scheduled matches together, so a scheduled-only event still gets a section.
        const teamMatches: (PredictionRecord | UpcomingPredictionRecord)[] = [
          ...(teamMatchesForAlgo.get(teamKey) ?? []),
          ...(scheduledTeamMatches.get(teamKey) ?? []),
        ];
        const byEvent = groupByEvent(teamMatches);
        const events: TeamSeasonEventInput[] = Array.from(byEvent.entries()).map(([eventKey, matches]) => {
          const meta = eventMeta.find((e) => e.event_key === eventKey);
          const ranking = eventRankingsForSeason.get(eventKey)?.get(teamKey);
          return {
            eventKey,
            // Key-as-name only when the corpus `name` is null.
            eventName: meta?.name ?? eventKey,
            startDate: meta?.start_date ?? "",
            rank: ranking?.rank,
            totalTeams: ranking?.totalTeams,
            matches: sortTeamSeasonMatches(matches, sortTimeByMatchKey),
          };
        });
        // Official play only, matching the Teams-list row; `events` above stays unscoped, so offseason
        // events keep their sections.
        const stats = teamStatsOfficial.get(teamKey);
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
            // The sigma entry keeps its `percentile` here (unlike the Teams row): this artifact is small,
            // and the season header derives its tier from the percentile client-side.
            metrics: {
              ...seasonStatsMetrics.metrics,
              ...(sigmaMetricForAlgo[teamKey] !== undefined ? { [SIGMA_METRIC_KEY]: sigmaMetricForAlgo[teamKey] } : {}),
            },
            metricsBasis: seasonStatsMetrics.metricsBasis,
          },
          events,
          // Sigma is applied after percentiles, so it gets no pool percentile, and this is the only place
          // the per-match value reaches a row; the source rows and pools never see it.
          metricHistory: withHistorySigma(
            withHistoryPercentiles(metricHistoryForAlgo.get(teamKey) ?? [], rankingPools),
            sigmaByMatchKeyForAlgoTeam.get(algorithm.id)?.get(teamKey)
          ),
          sortTimeByMatchKey,
          actualBonusFlagsByMatchKey,
          robotImageUrl: teamMediaForSeason.get(teamKey)?.imageUrl ?? undefined,
          activeYears: activeYearsByTeam.get(teamKey),
          ranks: rankScopesByTeamKey.get(teamKey),
          generation,
          computedAt,
          videoByMatchKey,
        });
        const key = artifactKey({ page: "team", teamKey, year: season, algorithmId: algorithm.id, version });
        await publishTimed(() => uploader.publish("team", key, JSON.stringify(teamSeasonArtifact)));
      }

      if (seasonStateBlocks.count > 0) {
        console.log(
          `publish: season ${season} ${algorithm.id}: ${seasonStateBlocks.count} event artifacts carry a state block ` +
            `(${seasonStateBlocks.totalBytes} B, max ${seasonStateBlocks.maxBytes} B ${seasonStateBlocks.maxKey})`
        );
      }

      const blockLabel = `${season}/${algorithm.id}`;
      timings.add(`${blockLabel} build`, performance.now() - blockStart - sidecarMs - uploadWaitMs);
      timings.add(`${blockLabel} sidecars`, sidecarMs);
      timings.add(`${blockLabel} uploadWait`, uploadWaitMs);
    }

    // --- compare/{year}.json — one file, every algorithm ---
    // `corpusSeasons` is the corpus-held season set, never `[season]` or `seasonsSorted`: passing this
    // season alone silently makes every slice's `headlineEligible` false, and eligibility must not
    // depend on which seasons a run republishes.
    const compareStart = performance.now();
    const slices = aggregateScores(harnessPredictions, { corpusSeasons: selectCorpusSeasons(db), eligibility: "from-corpus-seasons" });
    const compareArtifact = buildCompareArtifact({
      algorithms: options.algorithms.map((a) => ({ id: a.id, version: a.version })),
      slices,
      generation,
      computedAt,
      // Every call site passes `rpCalibration`; `publish.test.ts` pins this.
      rpCalibration: options.rpCalibration,
    });
    const compareKey = artifactKey({ page: "compare", year: season });
    await uploader.publish("compare", compareKey, JSON.stringify(compareArtifact));
    timings.add(`season ${season} compare`, performance.now() - compareStart);

    // Two different maps on purpose; never collapse them. `carryStates` feeds next season's carry (for
    // EPA it rewinds to the last official match, so exhibitions cannot seed next season's prior).
    // `finalStates` is the D1 seed the live Worker resumes, which continues the offseason-inclusive
    // season, so a rewound seed would make live and offline disagree.
    liveStatesAcrossSeasons = new Map(records.carryStates);
    // The seed rows come from `records.finalStates` and these layers' passengers (RP beliefs, the mean
    // shift, Sigma beliefs and population), all from the same offseason-inclusive population, for the
    // same reason.
    finalSeasonStateRows = seasonStateRows;
    // `stream` is this season's own chronological replay order (the SAME
    // total order `compareCorpusMatchOrder` mirrors on the Worker side) — the
    // last write per event key IS that event's last folded match.
    const lastFoldedByEvent = new Map<string, string>();
    for (const m of stream) lastFoldedByEvent.set(m.eventKey, m.matchKey);
    finalSeasonLastFoldedByEvent = lastFoldedByEvent;
    finalSeasonNumber = season;
  }

  // Every queued put settles before the manifests point readers at this run's objects; a put that
  // failed after r2Client's retries fails the run here.
  await timings.timeAsync("uploadDrain", () => uploader.drain());

  // --- Manifests and the D1 state seed ---
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

    // Only the final season's states are seeded into D1; earlier seasons only fed the carry thread.
    const algorithmIdsWithState: string[] = [];
    for (const algorithm of options.algorithms) {
      const stateRows = finalSeasonStateRows.get(algorithm.id);
      if (stateRows === undefined) continue;
      // The same memoized rows the final season's event blocks were built from (`seedStateRows`, the
      // one passenger chain), so a block and the seed can never disagree.
      const rows = stateRows();
      const outPath = join(SEED_OUT_DIR, `seed-${algorithm.id}.sql`);
      emitSeedSql(rows, { algorithmId: algorithm.id, out: outPath });
      seedFiles.push(outPath);
      algorithmIdsWithState.push(algorithm.id);
    }

    // --- The fourth seed file: event_cursor rows + state-baseline markers ---
    // (quick task 260920-q75) — pushed onto `seedFiles` LAST and always
    // printed as the file to apply last, since the cursor rewrite and the
    // permission to fold must land together.
    if (finalSeasonNumber !== undefined) {
      const skippedWindowKeys: string[] = [];
      const cursorEntries: { eventKey: string; lastFoldedMatchKey: string | null }[] = [];
      for (const window of liveWindows.windows) {
        if (window.season !== finalSeasonNumber) {
          skippedWindowKeys.push(window.eventKey);
          continue;
        }
        cursorEntries.push({ eventKey: window.eventKey, lastFoldedMatchKey: finalSeasonLastFoldedByEvent.get(window.eventKey) ?? null });
      }
      if (skippedWindowKeys.length > 0) {
        console.log(
          `publish: seed-cursors: skipped ${skippedWindowKeys.length} live-window event(s) whose season is not the final ` +
            `published season (${finalSeasonNumber}), never replayed by this run: ${skippedWindowKeys.join(", ")}`
        );
      }

      const cursorsOutPath = join(SEED_OUT_DIR, "seed-cursors.sql");
      emitCursorSeedSql({ generation, computedAt, algorithmIds: algorithmIdsWithState, cursors: cursorEntries, out: cursorsOutPath });
      seedFiles.push(cursorsOutPath);
      console.log(`publish: seed-cursors: ${cursorsOutPath} -- APPLY THIS FILE LAST, after every seed-<id>.sql.`);

      // SEED-COMMANDS.txt: this run's exact ordered `wrangler d1 execute`
      // invocations, cursors file last.
      const seedCommandsPath = join(SEED_OUT_DIR, "SEED-COMMANDS.txt");
      writeSeedCommandsFile({ databaseName: D1_DATABASE_NAME, seedFiles, out: seedCommandsPath });
      console.log(`publish: seed-commands: ${seedCommandsPath}`);
    }
  }

  const pages = computeSizeStats(uploader.records);
  const objectCount = uploader.records.length;
  const totalBytes = uploader.records.reduce((sum, r) => sum + r.bytes, 0);

  console.log(`\npublish: summary (generation=${generation})`);
  console.log(`  objects=${objectCount} totalBytes=${totalBytes}${dryRun ? " (dry-run — nothing uploaded)" : ""}`);
  if (stateBlockTotals.count > 0) {
    console.log(
      `  state blocks: count=${stateBlockTotals.count} totalBytes=${stateBlockTotals.totalBytes} maxBytes=${stateBlockTotals.maxBytes} key=${stateBlockTotals.maxKey}`
    );
  }
  for (const [kind, stats] of Object.entries(pages)) {
    console.log(
      `  ${kind}: count=${stats!.count} median=${stats!.medianBytes}B p95=${stats!.p95Bytes}B max=${stats!.maxBytes}B key=${stats!.largestKey}`
    );
  }
  // Sidecar sizes, printed like the page kinds but kept out of `pages` (a sidecar is not a `PageKind`);
  // `--write-budget` carries them in the block's `run` string.
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

/** Resolves `--algorithm` ids (default: `PUBLISHED_ALGORITHM_IDS`) against `BASE_PUBLISH_ALGORITHMS`, throwing on an unknown id. Exported for tests. */
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
 * Parses `--seasons`: a year (`"2026"`), a range (`"2022-2026"`), or a comma-separated list of either
 * (`"2019,2020,2022-2026"`). The result is ascending and de-duplicated. The list form exists because
 * the corpus is gapped: 2021 (the remote season, no 3v3 alliance matches) has no component map, so a
 * contiguous range across it throws at `componentMapForSeason(2021)`. The repo's only `--seasons`
 * parser; exported for tests.
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
  // `undefined` for a missing file, so a run without a committed baseline attaches nothing.
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
 * `--write-budget`: replaces the `json budget` block in `docs/publish-budget.md` with this run's
 * measurements, only after a successful publish. The `run` string uses `process.argv` and summary
 * fields only, never environment variables (`--env-file` is tsx's flag and never reaches `argv`).
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
      "presim-from-season": { type: "string" },
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

// Run `main()` only as the entry point; importing this module (tests) must never parse argv or touch
// the corpus or network.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("publish:artifacts failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

// Re-exported so publish.test.ts checks scheduled matches against the same set `toLeakProofUpcoming` guards.
export { OUTCOME_KEYS };
