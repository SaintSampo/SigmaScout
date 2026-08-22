/**
 * `pnpm publish:artifacts` / `pnpm publish:seasons` entry point (D-01/D-02/
 * D-04/D-05/D-06/D-07/D-08/D-25/D-26, plan 04-01 Task 3 widened by plan
 * 04-04 Task 1 into the full offline publisher). Two modes:
 *
 *   pnpm publish:artifacts --event <event_key> --algorithm opr [--bucket <name>] [--dry-run]
 *   pnpm publish:artifacts --seasons 2022-2026 [--algorithm opr,epa,sigma1] [--bucket <name>]
 *     [--concurrency 16] [--dry-run] [--skip-state]
 *
 * `--event` is the single-event republish path (how a live-event artifact is
 * refreshed by hand after this plan; unchanged in shape from the 04-01
 * tracer, widened only to fill `upcoming`/`teams`). `--seasons` is the real
 * full-season publisher: every page kind, every requested algorithm, one
 * shared match stream per season (mirroring `cli.ts`'s `runSeasons` — see
 * `publishSeasons` below for why this orchestration is mirrored locally
 * rather than imported, per the precedent `tune.ts`'s file header already
 * records for the exact same reason).
 *
 * Every assembly function in this file (`buildEventArtifact`,
 * `buildTeamsArtifact`, `buildTeamSeasonArtifact`, `buildEventsArtifact`,
 * `buildCompareArtifact`) is pure, takes already-computed data, and PARSES
 * the candidate through its Zod schema before returning (T-04-22) — a
 * validation failure throws before any upload could possibly be attempted,
 * because the object that would have been uploaded never comes back to the
 * caller. Every numeric field that maps to one of `rounding.ts`'s
 * `ROUNDING_RULE` field classes is rounded on the way into these functions —
 * this is the only place in the codebase that rounding happens (see
 * `rounding.ts`'s file header for the full boundary argument).
 *
 * Monte Carlo note (04-04-PLAN.md's "resolving a discretion item"): D-08's
 * scheduled-match RP pmf is produced by whatever `predict()` already
 * computes for the promoted Sigma1 module (`rpMonteCarloDraws` from its
 * pinned params) — this file does not touch that computation. Changing it
 * would move the committed prediction-stream digest and require a new
 * promoted version (Phase 3 work), which is out of this phase's scope fence.
 * The 10 ms Worker question this raises is answered by the subrequest/CPU
 * budget and D-15's deferral mechanism (plans 04-05/04-07), not by changing
 * the model here.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import type {
  AlgorithmModule,
  ComponentPrediction,
  MatchResult,
  Prediction,
  SeasonBoundary,
  TeamMetric,
  TeamMetrics,
  UpcomingMatch,
} from "../core/algorithms/types.js";
import { opr, type OprState } from "../core/algorithms/opr.js";
import { epa, type EpaState } from "../core/algorithms/epa.js";
import { sigma1, type Sigma1State } from "../core/algorithms/sigma1/index.js";
import { COLD_START_SEASON } from "../core/algorithms/breakdown/index.js";
import { applyPromotedOverrides } from "./cli.js";
import {
  openCorpusReadOnly,
  selectMatchesChronological,
  selectScheduledMatches,
  type Corpus,
} from "../corpus/db.js";
import { buildSeasonStream, WalkForwardSimulator, OUTCOME_KEYS, type PredictionRecord } from "./replay.js";
import {
  artifactKey,
  CompareArtifactSchema,
  EventArtifactSchema,
  EventsArtifactSchema,
  PAGE_ARTIFACT_SCHEMA_VERSION,
  TeamsArtifactSchema,
  TeamSeasonArtifactSchema,
  type CompareArtifact,
  type EventArtifact,
  type EventsArtifact,
  type PageKind,
  type TeamsArtifact,
  type TeamSeasonArtifact,
} from "./pageArtifacts.js";
import { roundMetric, roundPmf, roundProbability, roundTo, ROUNDING_RULE } from "./rounding.js";
import { buildAlgorithmsManifest, buildLiveWindowsManifest, PUBLISHED_ALGORITHM_IDS } from "./manifests.js";
import { emitSeedSql, serializeState, type StateStamp } from "./stateSnapshot.js";
import { aggregateScores, type HarnessPredictionInput, type ScoreSlice } from "./score.js";
import type { MetricHistoryRow } from "./metricHistory.js";
import { putObject } from "./r2Client.js";

const CORPUS_PATH = "data/corpus.sqlite";
const DEFAULT_BUCKET = "sigmascout-artifacts";
const DEFAULT_CONCURRENCY = 16;
const SEED_OUT_DIR = join("reports", "publish");

/** D-03: the base (untuned/unpromoted) modules for the three published ids. `resolvePublishAlgorithms` swaps `sigma1` for the committed promoted version via `applyPromotedOverrides`, the same rule `manifests.ts`'s `buildAlgorithmsManifest` and `cli.ts`'s harness runs use — never a second, independently-derived resolution (T-04-16). */
const BASE_PUBLISH_ALGORITHMS: Record<string, AlgorithmModule<any>> = { opr, epa, sigma1 };

// ---------------------------------------------------------------------------
// Small local helpers shared by every assembly function below
// ---------------------------------------------------------------------------

/** Rounds one component's mean/variance at `ROUNDING_RULE.metric` (D-06's "component means/variances" row) — `undefined` in, `undefined` out. */
function roundComponents(
  components: Record<string, ComponentPrediction> | undefined
): Record<string, ComponentPrediction> | undefined {
  if (components === undefined) return undefined;
  const result: Record<string, ComponentPrediction> = {};
  for (const [key, c] of Object.entries(components)) {
    result[key] = { mean: roundMetric(c.mean), ...(c.variance !== undefined ? { variance: roundMetric(c.variance) } : {}) };
  }
  return result;
}

/** Rounds a `TeamMetrics`-shaped record's `value`/`spread` at `ROUNDING_RULE.metric` — used for `EventTeamSchema.metrics`, `TeamsTableRowSchema.metrics`, and `RecordAndMetricsSchema.metrics`. */
function roundTeamMetricRecord(metrics: Record<string, TeamMetric>): Record<string, TeamMetric> {
  const result: Record<string, TeamMetric> = {};
  for (const [key, m] of Object.entries(metrics)) {
    result[key] = { value: roundMetric(m.value), ...(m.spread !== undefined ? { spread: roundMetric(m.spread) } : {}) };
  }
  return result;
}

/** Rounds one `MetricHistoryRow.metrics` entry the same way. */
function roundMetricHistoryRow(row: MetricHistoryRow): MetricHistoryRow {
  return { ...row, metrics: roundTeamMetricRecord(row.metrics) };
}

/**
 * Splits an algorithm's `version` on its first `+` — the same D-13 identity
 * split `packages/harness/artifact.ts`'s `splitAlgorithmVersion` and
 * `packages/harness/manifests.ts`'s module-private `splitVersion` already
 * implement. Neither is exported, so this is a third small, deliberate
 * duplication of the same few lines, following the precedent both of those
 * already set for this exact situation.
 */
function splitVersion(algorithmId: string, version: string): { codeVersion: string; paramSetName: string } {
  const separatorIndex = version.indexOf("+");
  if (separatorIndex === -1) {
    throw new Error(
      `publish: algorithm "${algorithmId}"'s version "${version}" does not carry the "{codeVersion}+{paramSetName}" shape (no "+" found)`
    );
  }
  return { codeVersion: version.slice(0, separatorIndex), paramSetName: version.slice(separatorIndex + 1) };
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
}

export interface EventTeamStandingInput {
  readonly teamKey: string;
  readonly teamNumber?: number;
  readonly nickname?: string;
  readonly metrics: Record<string, TeamMetric>;
}

export interface BuildEventArtifactParams {
  readonly eventKey: string;
  readonly season: number;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  readonly predictions: readonly PredictionRecord[];
  /** D-08: not-yet-played matches with their predicted parameters. Defaults to `[]` — a fully-historical event has none, which is a valid artifact, not a missing one. */
  readonly upcoming?: readonly UpcomingPredictionRecord[];
  /** D-07: the event's standings-style team list. Defaults to `[]`. See `EventArtifactSchema`'s own doc comment in `pageArtifacts.ts` for why this field is REQUIRED (not optional) as of this plan. */
  readonly teams?: readonly EventTeamStandingInput[];
  /** D-04: a short opaque string identifying the publish run that produced this object. */
  readonly generation: string;
  /** D-04: ISO timestamp. Defaults to `new Date().toISOString()` — overridable for deterministic tests. */
  readonly computedAt?: string;
}

/**
 * The pure assembly step, widened from plan 04-01's tracer: turns one
 * event's replayed predictions, its not-yet-played matches' predicted
 * parameters, and its standings-style team list into the validated
 * `EventArtifact`. Parses through `EventArtifactSchema` before returning
 * (T-04-22) — a validation failure throws here, before any caller could
 * possibly reach a `putObject` call.
 */
export function buildEventArtifact(params: BuildEventArtifactParams): EventArtifact {
  const matches = params.predictions.map(({ match, prediction }) => ({
    matchKey: match.matchKey,
    compLevel: match.compLevel,
    setNumber: match.setNumber,
    matchNumber: match.matchNumber,
    redTeams: [...match.redTeams],
    blueTeams: [...match.blueTeams],
    predictedWinner: prediction.winner,
    pRedWin: roundProbability(prediction.pRedWin),
    predictedRedScore: roundMetric(prediction.redScore),
    predictedBlueScore: roundMetric(prediction.blueScore),
    redComponents: roundComponents(prediction.redComponents),
    blueComponents: roundComponents(prediction.blueComponents),
    actualWinner: match.winner,
    actualRedScore: match.redScore,
    actualBlueScore: match.blueScore,
  }));

  const upcoming = (params.upcoming ?? []).map(({ match, prediction }) => ({
    matchKey: match.matchKey,
    compLevel: match.compLevel,
    setNumber: match.setNumber,
    matchNumber: match.matchNumber,
    redTeams: [...match.redTeams],
    blueTeams: [...match.blueTeams],
    predictedWinner: prediction.winner,
    pRedWin: roundProbability(prediction.pRedWin),
    predictedRedScore: roundMetric(prediction.redScore),
    predictedBlueScore: roundMetric(prediction.blueScore),
    redComponents: roundComponents(prediction.redComponents),
    blueComponents: roundComponents(prediction.blueComponents),
    redRpPmf: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined,
    blueRpPmf: prediction.blueRpPmf ? roundPmf(prediction.blueRpPmf) : undefined,
  }));

  const teams = (params.teams ?? []).map((t) => ({
    teamKey: t.teamKey,
    teamNumber: t.teamNumber,
    nickname: t.nickname,
    metrics: roundTeamMetricRecord(t.metrics),
  }));

  const candidate = {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: params.generation,
    computedAt: params.computedAt ?? new Date().toISOString(),
    algorithmId: params.algorithmId,
    algorithmVersion: params.algorithmVersion,
    eventKey: params.eventKey,
    season: params.season,
    matches,
    upcoming,
    teams,
  };

  return EventArtifactSchema.parse(candidate);
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
}

export interface BuildTeamsArtifactParams {
  readonly season: number;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  readonly teams: readonly TeamsArtifactTeamInput[];
  readonly generation: string;
  readonly computedAt?: string;
}

/** D-05's first at-risk artifact (~3,750 rows/season). Parses through `TeamsArtifactSchema` before returning (T-04-22). */
export function buildTeamsArtifact(params: BuildTeamsArtifactParams): TeamsArtifact {
  const candidate = {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: params.generation,
    computedAt: params.computedAt ?? new Date().toISOString(),
    algorithmId: params.algorithmId,
    algorithmVersion: params.algorithmVersion,
    season: params.season,
    teams: params.teams.map((t) => ({
      teamKey: t.teamKey,
      teamNumber: t.teamNumber,
      nickname: t.nickname,
      record: t.record,
      metrics: roundTeamMetricRecord(t.metrics),
      eventCount: t.eventCount,
      matchCount: t.matchCount,
    })),
  };
  return TeamsArtifactSchema.parse(candidate);
}

// ---------------------------------------------------------------------------
// buildTeamSeasonArtifact — v1/team/{teamKey}/{year}/{algorithmId}@{version}.json
// ---------------------------------------------------------------------------

export interface TeamSeasonEventInput {
  readonly eventKey: string;
  readonly eventName: string;
  readonly startDate: string;
  readonly matches: readonly PredictionRecord[];
}

export interface BuildTeamSeasonArtifactParams {
  readonly teamKey: string;
  readonly teamNumber: number;
  readonly nickname: string;
  readonly season: number;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  readonly seasonStats: { record: { wins: number; losses: number; ties: number }; metrics: Record<string, TeamMetric> };
  readonly events: readonly TeamSeasonEventInput[];
  readonly metricHistory: readonly MetricHistoryRow[];
  readonly generation: string;
  readonly computedAt?: string;
}

/** D-07/D-05's second at-risk artifact (the 292-match outlier). Parses through `TeamSeasonArtifactSchema` before returning (T-04-22). */
export function buildTeamSeasonArtifact(params: BuildTeamSeasonArtifactParams): TeamSeasonArtifact {
  const events = params.events.map((e) => ({
    eventKey: e.eventKey,
    eventName: e.eventName,
    startDate: e.startDate,
    matches: e.matches.map(({ match, prediction }) => ({
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
      // TeamSeasonMatchSchema requires these present (mirrors predictions.ts's
      // PredictionRecordSchema: empty {} for an algorithm like OPR that does
      // not decompose its prediction, never omitted).
      redComponents: roundComponents(prediction.redComponents) ?? {},
      blueComponents: roundComponents(prediction.blueComponents) ?? {},
      variance: prediction.variance !== undefined ? roundTo(prediction.variance, ROUNDING_RULE.variance) : undefined,
      redRpPmf: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined,
      blueRpPmf: prediction.blueRpPmf ? roundPmf(prediction.blueRpPmf) : undefined,
      actualWinner: match.winner,
      actualRedScore: match.redScore,
      actualBlueScore: match.blueScore,
      redTeams: [...match.redTeams],
      blueTeams: [...match.blueTeams],
    })),
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
    seasonStats: { record: params.seasonStats.record, metrics: roundTeamMetricRecord(params.seasonStats.metrics) },
    events,
    metricHistory: params.metricHistory.map(roundMetricHistoryRow),
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
// buildCompareArtifact — v1/compare/{year}.json
// ---------------------------------------------------------------------------

export interface BuildCompareArtifactParams {
  readonly algorithms: readonly { id: string; version: string }[];
  readonly slices: readonly ScoreSlice[];
  readonly generation: string;
  readonly computedAt?: string;
}

/**
 * Brier/accuracy/calibration figures are NOT rounded — they don't map to any
 * of `rounding.ts`'s five field classes, and `artifact.ts`'s own
 * `HarnessArtifactSchema.slices[].brierScore` doc comment already states the
 * same policy for the harness's internal artifact ("Unrounded — rounding
 * happens only when the HTML report renders a value"). This mirrors that
 * exactly rather than inventing a sixth rounding rule. Parses through
 * `CompareArtifactSchema` before returning (T-04-22).
 */
export function buildCompareArtifact(params: BuildCompareArtifactParams): CompareArtifact {
  const algorithms = params.algorithms.map((a) => {
    const { codeVersion, paramSetName } = splitVersion(a.id, a.version);
    return { id: a.id, version: a.version, codeVersion, paramSetName };
  });
  const candidate = {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: params.generation,
    computedAt: params.computedAt ?? new Date().toISOString(),
    algorithms,
    slices: params.slices,
  };
  return CompareArtifactSchema.parse(candidate);
}

// ---------------------------------------------------------------------------
// Size-stat tracking (D-05) — shared by publishSeasons and payloadBudget.test.ts
// ---------------------------------------------------------------------------

export interface PublishedObjectRecord {
  readonly pageKind: PageKind;
  readonly key: string;
  readonly bytes: number;
}

export interface PageKindSizeStats {
  readonly count: number;
  readonly medianBytes: number;
  readonly p95Bytes: number;
  readonly maxBytes: number;
  readonly largestKey: string;
}

function percentileOf(sortedAscending: readonly number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  const idx = Math.min(sortedAscending.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAscending.length) - 1));
  return sortedAscending[idx]!;
}

/**
 * Groups published-object byte counts by page kind and computes the
 * count/median/p95/max/largestKey stats `docs/publish-budget.md`'s
 * machine-readable block records. Exported so `payloadBudget.test.ts` can
 * re-measure a fresh assembly through this SAME function rather than
 * re-implementing the size math.
 */
export function computeSizeStats(records: readonly PublishedObjectRecord[]): Partial<Record<PageKind, PageKindSizeStats>> {
  const byKind = new Map<PageKind, PublishedObjectRecord[]>();
  for (const record of records) {
    const list = byKind.get(record.pageKind) ?? [];
    list.push(record);
    byKind.set(record.pageKind, list);
  }
  const result: Partial<Record<PageKind, PageKindSizeStats>> = {};
  for (const [kind, list] of byKind) {
    const sorted = [...list].sort((a, b) => a.bytes - b.bytes);
    const bytesSorted = sorted.map((r) => r.bytes);
    const largest = sorted[sorted.length - 1]!;
    result[kind] = {
      count: sorted.length,
      medianBytes: percentileOf(bytesSorted, 50),
      p95Bytes: percentileOf(bytesSorted, 95),
      maxBytes: largest.bytes,
      largestKey: largest.key,
    };
  }
  return result;
}

/**
 * Bounded-concurrency uploader (D-26: `application/json`, `max-age=60`).
 * Records every candidate object's page kind/key/byte length REGARDLESS of
 * `dryRun` — `--dry-run` assembles and validates everything and still prints
 * the size summary (the whole reason `--dry-run` exists is to re-measure
 * budgets without spending a Class-A operation), it just skips the actual
 * `putObject` call.
 */
class BoundedUploader {
  readonly records: PublishedObjectRecord[] = [];
  #active = 0;
  readonly #queue: (() => void)[] = [];

  constructor(
    private readonly bucket: string,
    private readonly concurrency: number,
    private readonly dryRun: boolean
  ) {}

  async #withSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#active >= this.concurrency) {
      await new Promise<void>((resolve) => this.#queue.push(resolve));
    }
    this.#active++;
    try {
      return await fn();
    } finally {
      this.#active--;
      const next = this.#queue.shift();
      if (next) next();
    }
  }

  /** Returns a promise the caller collects into a batch and awaits with `Promise.all` — NOT awaited here, so the bounded semaphore actually bounds concurrency across a batch rather than serializing it. */
  publish(pageKind: PageKind, key: string, body: string): Promise<void> {
    const bytes = Buffer.byteLength(body, "utf8");
    this.records.push({ pageKind, key, bytes });
    if (this.dryRun) return Promise.resolve();
    return this.#withSlot(() =>
      putObject(this.bucket, key, body, { contentType: "application/json", cacheControl: "public, max-age=60" })
    );
  }
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

/** Builds an event's D-07 standings-style team list from a season/event-scoped `TeamMetrics` map (already computed once per algorithm per season — see `publishSeasons`). */
function buildEventTeamsStanding(
  metricsByTeam: TeamMetrics,
  teamKeys: readonly string[],
  teamInfo: ReadonlyMap<string, TeamInfo>
): EventTeamStandingInput[] {
  return teamKeys.map((teamKey) => {
    const info = teamInfoOrFallback(teamInfo, teamKey);
    return { teamKey, teamNumber: info.teamNumber, nickname: info.nickname, metrics: metricsByTeam[teamKey] ?? {} };
  });
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
  readonly includeOffseason?: boolean;
  readonly coldStartSeason?: number;
  readonly generation?: string;
  readonly computedAt?: string;
}

export interface PublishSummary {
  readonly generation: string;
  readonly computedAt: string;
  readonly objectCount: number;
  readonly totalBytes: number;
  readonly pages: Partial<Record<PageKind, PageKindSizeStats>>;
  readonly seedFiles: readonly string[];
  readonly manifestKeys: readonly string[];
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
}

function selectEventMeta(db: Corpus, season: number): EventMetaRow[] {
  return db
    .prepare(`SELECT event_key, event_type, is_offseason, start_date FROM events WHERE year = ? ORDER BY event_key ASC`)
    .all(season) as EventMetaRow[];
}

/**
 * Widens the 04-01 tracer into the full offline publisher (D-01 through
 * D-08, D-25/D-26). Mirrors `cli.ts`'s `runSeasons` orchestration (season
 * loop, `carrySeason` boundary threading via `liveStates`) rather than
 * importing it — `runSeasons` returns only predictions and drops
 * `finalStates`, which this function needs for D-12's live-state snapshot,
 * exactly the same reason `tune.ts`'s file header already documents for its
 * own local mirror of the same loop. `buildSeasonStream`/
 * `WalkForwardSimulator` (the actual leak-proof replay primitives) are
 * reused unchanged; only the orchestration around them is mirrored.
 */
export async function publishSeasons(db: Corpus, options: PublishSeasonsOptions): Promise<PublishSummary> {
  const generation = options.generation ?? randomUUID();
  const computedAt = options.computedAt ?? new Date().toISOString();
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const dryRun = options.dryRun ?? false;
  const includeOffseason = options.includeOffseason ?? false;
  const coldStartSeason = options.coldStartSeason ?? COLD_START_SEASON;
  const seasonsSorted = [...options.seasons].sort((a, b) => a - b);
  const stamp: StateStamp = { generation, computedAt };

  const uploader = new BoundedUploader(options.bucket, concurrency, dryRun);
  const teamInfo = lookupAllTeamInfo(db);
  const seedFiles: string[] = [];
  const manifestKeys: string[] = [];

  let liveStatesAcrossSeasons = new Map<string, unknown>();
  let finalSeasonStates = new Map<string, unknown>();

  for (const season of seasonsSorted) {
    const stream = buildSeasonStream(db, season, { includeOffseason });
    const scheduled = selectScheduledMatches(db, { year: season, excludeOffseason: !includeOffseason });
    const teamsThisSeason = Array.from(
      new Set([...stream.flatMap((m) => [...m.redTeams, ...m.blueTeams]), ...scheduled.flatMap((m) => [...m.redTeams, ...m.blueTeams])])
    );
    const eventMeta = selectEventMeta(db, season);
    const offseasonEventKeys = new Set(eventMeta.filter((e) => e.is_offseason === 1).map((e) => e.event_key));

    const boundary: SeasonBoundary = { fromSeason: season - 1, toSeason: season, isColdStart: season === coldStartSeason };
    let initialStates: ReadonlyMap<string, unknown> | undefined;
    if (boundary.isColdStart) {
      console.log(`publish: season ${season} is the cold-start season (${coldStartSeason}) — every algorithm starts fresh.`);
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
    const onMatchComplete = (match: MatchResult, algorithmId: string, state: unknown): void => {
      const algorithm = algorithmById.get(algorithmId);
      if (!algorithm) return;
      const involvedTeams = [...match.redTeams, ...match.blueTeams];
      const metrics = algorithm.teamMetrics(state, involvedTeams);
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

    const simulator = new WalkForwardSimulator(stream);
    const records = simulator.runAll(options.algorithms, teamsThisSeason, initialStates, onMatchComplete);

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
    for (const r of records) {
      const pr: PredictionRecord = { match: r.match, prediction: r.prediction };
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

    const teamStats = computeTeamSeasonStats(stream);
    const eventCounts = computeEventCounts(stream, scheduled);

    // D-22: HarnessPredictionInput across every algorithm this season, for
    // the compare artifact's aggregateScores call (one CompareArtifact per
    // year, per D-02's documented exception).
    const harnessPredictions: HarnessPredictionInput[] = records.map((r) => ({
      matchKey: r.match.matchKey,
      season,
      compLevel: r.match.compLevel,
      algorithmId: r.algorithmId,
      pRedWin: r.prediction.pRedWin,
      predictedRedScore: r.prediction.redScore,
      predictedBlueScore: r.prediction.blueScore,
      actualWinner: r.match.winner,
      isOffseason: offseasonEventKeys.has(r.match.eventKey),
      isSurrogateAffected: r.match.redSurrogates.length > 0 || r.match.blueSurrogates.length > 0,
    }));

    for (const algorithm of options.algorithms) {
      const state = records.finalStates.get(algorithm.id);
      const version = algorithm.version;
      const metricsByTeam = state !== undefined ? algorithm.teamMetrics(state, teamsThisSeason) : {};
      const eventMatchesForAlgo = perAlgoEventMatches.get(algorithm.id)!;
      const teamMatchesForAlgo = perAlgoTeamMatches.get(algorithm.id)!;
      const metricHistoryForAlgo = metricHistoryByAlgoTeam.get(algorithm.id)!;

      // --- teams/{year}/{algorithm}@{version}.json ---
      const teamsRows: TeamsArtifactTeamInput[] = teamsThisSeason.map((teamKey) => {
        const info = teamInfoOrFallback(teamInfo, teamKey);
        const stats = teamStats.get(teamKey);
        return {
          teamKey,
          teamNumber: info.teamNumber,
          nickname: info.nickname,
          record: { wins: stats?.wins ?? 0, losses: stats?.losses ?? 0, ties: stats?.ties ?? 0 },
          metrics: metricsByTeam[teamKey] ?? {},
          eventCount: stats?.eventKeys.size ?? 0,
          matchCount: stats?.matchCount ?? 0,
        };
      });
      const teamsArtifact = buildTeamsArtifact({
        season,
        algorithmId: algorithm.id,
        algorithmVersion: version,
        teams: teamsRows,
        generation,
        computedAt,
      });
      const teamsKey = artifactKey({ page: "teams", year: season, algorithmId: algorithm.id, version });
      const teamsPending = uploader.publish("teams", teamsKey, JSON.stringify(teamsArtifact));

      // --- events/{year}/{algorithm}@{version}.json ---
      // Event summary counts reflect matches actually replayed this run
      // (respecting --include-offseason), same scope as the artifacts
      // themselves — an offseason event shows zero counts when offseason
      // matches were excluded from this run.
      const eventsRows: EventsArtifactEventInput[] = eventMeta.map((e) => {
        const counts = eventCounts.get(e.event_key);
        return {
          eventKey: e.event_key,
          // The corpus has no event-name column (packages/corpus/schema.sql)
          // — falls back to the event key itself rather than fabricating a
          // name. See SUMMARY.md for the full deviation note.
          name: e.event_key,
          eventType: e.event_type,
          isOffseason: e.is_offseason === 1,
          startDate: e.start_date,
          week: null,
          teamCount: counts?.teamKeys.size ?? 0,
          matchCount: counts?.matchCount ?? 0,
          playedMatchCount: counts?.playedMatchCount ?? 0,
        };
      });
      const eventsArtifact = buildEventsArtifact({
        season,
        algorithmId: algorithm.id,
        algorithmVersion: version,
        events: eventsRows,
        generation,
        computedAt,
      });
      const eventsKey = artifactKey({ page: "events", year: season, algorithmId: algorithm.id, version });
      const eventsPending = uploader.publish("events", eventsKey, JSON.stringify(eventsArtifact));

      // --- event/{eventKey}/{algorithm}@{version}.json, one per event ---
      const eventPending: Promise<void>[] = [];
      for (const e of eventMeta) {
        const predictions = eventMatchesForAlgo.get(e.event_key) ?? [];
        const scheduledForEvent = scheduledByEvent.get(e.event_key) ?? [];
        const upcoming: UpcomingPredictionRecord[] =
          state !== undefined ? scheduledForEvent.map((match) => ({ match, prediction: algorithm.predict(state, match) })) : [];
        const eventTeamKeys = Array.from(
          new Set([...predictions.flatMap((p) => [...p.match.redTeams, ...p.match.blueTeams]), ...scheduledForEvent.flatMap((m) => [...m.redTeams, ...m.blueTeams])])
        );
        if (predictions.length === 0 && upcoming.length === 0) continue; // no data for this event under this run's scope
        const teamsStanding = buildEventTeamsStanding(metricsByTeam, eventTeamKeys, teamInfo);
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
        });
        const key = artifactKey({ page: "event", eventKey: e.event_key, algorithmId: algorithm.id, version });
        eventPending.push(uploader.publish("event", key, JSON.stringify(eventArtifact)));
      }

      // --- team/{teamKey}/{year}/{algorithm}@{version}.json, one per team ---
      const teamPending: Promise<void>[] = [];
      for (const teamKey of teamsThisSeason) {
        const info = teamInfoOrFallback(teamInfo, teamKey);
        const teamMatches = teamMatchesForAlgo.get(teamKey) ?? [];
        const byEvent = groupByEvent(teamMatches);
        const events: TeamSeasonEventInput[] = Array.from(byEvent.entries()).map(([eventKey, matches]) => {
          const meta = eventMeta.find((e) => e.event_key === eventKey);
          return {
            eventKey,
            eventName: eventKey, // corpus has no event-name column — see events-row comment above
            startDate: meta?.start_date ?? "",
            matches,
          };
        });
        const stats = teamStats.get(teamKey);
        const teamSeasonArtifact = buildTeamSeasonArtifact({
          teamKey,
          teamNumber: info.teamNumber,
          nickname: info.nickname,
          season,
          algorithmId: algorithm.id,
          algorithmVersion: version,
          seasonStats: {
            record: { wins: stats?.wins ?? 0, losses: stats?.losses ?? 0, ties: stats?.ties ?? 0 },
            metrics: metricsByTeam[teamKey] ?? {},
          },
          events,
          metricHistory: metricHistoryForAlgo.get(teamKey) ?? [],
          generation,
          computedAt,
        });
        const key = artifactKey({ page: "team", teamKey, year: season, algorithmId: algorithm.id, version });
        teamPending.push(uploader.publish("team", key, JSON.stringify(teamSeasonArtifact)));
      }

      await Promise.all([teamsPending, eventsPending, ...eventPending, ...teamPending]);
    }

    // --- compare/{year}.json — one file, every algorithm, per D-02's exception ---
    const slices = aggregateScores(harnessPredictions);
    const compareArtifact = buildCompareArtifact({
      algorithms: options.algorithms.map((a) => ({ id: a.id, version: a.version })),
      slices,
      generation,
      computedAt,
    });
    const compareKey = artifactKey({ page: "compare", year: season });
    await uploader.publish("compare", compareKey, JSON.stringify(compareArtifact));

    liveStatesAcrossSeasons = new Map(records.finalStates);
    finalSeasonStates = new Map(records.finalStates);
  }

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
      const rows = serializeState(algorithm.id, algorithm.version, state as Sigma1State | EpaState | OprState, stamp);
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
  if (manifestKeys.length > 0) console.log(`  manifests: ${manifestKeys.join(", ")}`);
  if (seedFiles.length > 0) console.log(`  seed files: ${seedFiles.join(", ")}`);

  return { generation, computedAt, objectCount, totalBytes, pages, seedFiles, manifestKeys };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Single-event CLI derives season from the event key's leading 4 digits (TBA's own convention), mirroring `packages/harness/cli.ts`'s `runEventMode`. */
function deriveSeasonFromEventKey(eventKey: string): number {
  const season = Number.parseInt(eventKey.slice(0, 4), 10);
  if (!Number.isInteger(season)) {
    throw new Error(`Could not derive a season from event key "${eventKey}" (expected a leading 4-digit year)`);
  }
  return season;
}

/** D-03: resolves the requested `--algorithm` ids (default: all three published ids) against the base modules, then swaps in the promoted Sigma1 the same way `manifests.ts`/`cli.ts` do (T-04-16) — never a second, independent resolution. */
function resolvePublishAlgorithms(idsCsv: string | undefined): AlgorithmModule<any>[] {
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
  return applyPromotedOverrides(resolved);
}

/**
 * `--seasons "2022-2026"` -> `[2022, 2023, 2024, 2025, 2026]`, or a single
 * year `--seasons "2026"` -> `[2026]` (harness CLI splits these into two
 * flags, `--seasons`/`--season`; this file accepts both spellings through
 * one flag). The range form is the same small parser `cli.ts`'s
 * module-private `parseSeasonsRange` implements — not exported, so
 * reimplemented here, following this file's own established
 * small-duplication precedent (`splitVersion` above).
 */
function parseSeasonsRange(spec: string): number[] {
  const singleMatch = /^(\d{4})$/.exec(spec);
  if (singleMatch) {
    return [Number.parseInt(singleMatch[1]!, 10)];
  }
  const rangeMatch = /^(\d{4})-(\d{4})$/.exec(spec);
  if (!rangeMatch) {
    throw new Error(`--seasons must be a single year like "2026" or a range like "2022-2026", got "${spec}"`);
  }
  const start = Number.parseInt(rangeMatch[1]!, 10);
  const end = Number.parseInt(rangeMatch[2]!, 10);
  if (end < start) {
    throw new Error(`--seasons range end (${end}) must be >= start (${start})`);
  }
  const seasons: number[] = [];
  for (let year = start; year <= end; year++) seasons.push(year);
  return seasons;
}

async function runEventMode(eventKey: string, algorithmIdsCsv: string | undefined, bucket: string, dryRun: boolean): Promise<void> {
  const algorithms = resolvePublishAlgorithms(algorithmIdsCsv);
  const algorithm = algorithms[0];
  if (!algorithm || algorithms.length !== 1) {
    throw new Error("--event mode requires exactly one --algorithm");
  }

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    const matches = selectMatchesChronological(db, { eventKey });
    if (matches.length === 0) {
      throw new Error(`No completed matches found in corpus for event ${eventKey}`);
    }
    const season = deriveSeasonFromEventKey(eventKey);
    const teams = Array.from(new Set(matches.flatMap((m) => [...m.redTeams, ...m.blueTeams])));

    const simulator = new WalkForwardSimulator(matches);
    const records = simulator.runAll([algorithm], teams);
    const predictions: PredictionRecord[] = records.map((r) => ({ match: r.match, prediction: r.prediction }));
    const finalState = records.finalStates.get(algorithm.id);

    const scheduled = selectScheduledMatches(db, { eventKey });
    const upcoming: UpcomingPredictionRecord[] =
      finalState !== undefined ? scheduled.map((match) => ({ match, prediction: algorithm.predict(finalState, match) })) : [];

    const teamInfo = lookupAllTeamInfo(db);
    const eventTeamKeys = Array.from(new Set([...teams, ...scheduled.flatMap((m) => [...m.redTeams, ...m.blueTeams])]));
    const metricsByTeam = finalState !== undefined ? algorithm.teamMetrics(finalState, eventTeamKeys) : {};
    const teamsStanding = buildEventTeamsStanding(metricsByTeam, eventTeamKeys, teamInfo);

    const validated = buildEventArtifact({
      eventKey,
      season,
      algorithmId: algorithm.id,
      algorithmVersion: algorithm.version,
      predictions,
      upcoming,
      teams: teamsStanding,
      generation: randomUUID(),
    });

    const key = artifactKey({ page: "event", eventKey, algorithmId: algorithm.id, version: algorithm.version });
    const body = JSON.stringify(validated);

    if (dryRun) {
      console.log(`[dry-run] Would publish "${key}" (${body.length} bytes) to bucket "${bucket}" — no upload performed.`);
      return;
    }

    await putObject(bucket, key, body, { contentType: "application/json", cacheControl: "public, max-age=60" });
    console.log(`Published "${key}" to bucket "${bucket}" (${body.length} bytes).`);
  } finally {
    db.close();
  }
}

async function runSeasonsCliMode(
  seasonsSpec: string,
  algorithmIdsCsv: string | undefined,
  bucket: string,
  concurrency: number,
  dryRun: boolean,
  skipState: boolean
): Promise<void> {
  const seasons = parseSeasonsRange(seasonsSpec);
  const algorithms = resolvePublishAlgorithms(algorithmIdsCsv);

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    await publishSeasons(db, { seasons, algorithms, bucket, concurrency, dryRun, skipState });
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      event: { type: "string" },
      algorithm: { type: "string" },
      bucket: { type: "string" },
      "dry-run": { type: "boolean" },
      seasons: { type: "string" },
      concurrency: { type: "string" },
      "skip-state": { type: "boolean" },
    },
  });

  const bucket = values.bucket ?? DEFAULT_BUCKET;
  const dryRun = values["dry-run"] === true;

  if (values.event) {
    await runEventMode(values.event, values.algorithm, bucket, dryRun);
  } else if (values.seasons) {
    const concurrency = values.concurrency ? Number.parseInt(values.concurrency, 10) : DEFAULT_CONCURRENCY;
    await runSeasonsCliMode(values.seasons, values.algorithm, bucket, concurrency, dryRun, values["skip-state"] === true);
  } else {
    throw new Error("One of --event or --seasons is required");
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
