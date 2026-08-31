/**
 * `pnpm publish:artifacts` / `pnpm publish:seasons` entry point (D-01/D-02/
 * D-04/D-05/D-06/D-07/D-08/D-25/D-26, plan 04-01 Task 3 widened by plan
 * 04-04 Task 1 into the full offline publisher). Two modes:
 *
 *   pnpm publish:artifacts --event <event_key> --algorithm opr [--bucket <name>] [--dry-run]
 *   pnpm publish:artifacts --seasons 2022-2026 [--algorithm opr,epa,vpr] [--bucket <name>]
 *     [--concurrency 16] [--dry-run] [--skip-state] [--include-offseason]
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
 * computes for the promoted VPR module (`rpMonteCarloDraws` from its
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
  CompLevel,
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
import { vpr, type Sigma1State } from "../core/algorithms/sigma1/index.js";
import { isDemoTeamKey } from "../core/algorithms/demoTeams.js";
import { COLD_START_SEASON } from "../core/algorithms/breakdown/index.js";
import { RP_RULE_MODULES } from "../core/algorithms/sigma1/rp/rules.js";
import { isBonusRpCompLevel, isRpEligibleEventType } from "../core/algorithms/sigma1/rp/constants.js";
import { applyPromotedOverrides } from "./cli.js";
import {
  openCorpusReadOnly,
  selectEventAlliancesForSeason,
  selectEventRankingsForSeason,
  selectScheduledMatches,
  selectTeamKeysForYear,
  selectTeamMediaForYear,
  type Corpus,
} from "../corpus/db.js";
import { buildSeasonStream, WalkForwardSimulator, OUTCOME_KEYS, type PredictionRecord } from "./replay.js";
import {
  artifactKey,
  CompareArtifactSchema,
  composeEventLocation,
  EventArtifactSchema,
  EventsArtifactSchema,
  PAGE_ARTIFACT_SCHEMA_VERSION,
  publishedTierForPercentile,
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
import {
  HISTORY_PERCENTILE_METRIC_KEYS,
  percentileAgainstSortedPool,
  sortedPoolsByMetric,
  withPercentiles,
  type TeamMetricWithPercentile,
} from "./percentiles.js";
import { buildAlgorithmsManifest, buildLiveWindowsManifest, PUBLISHED_ALGORITHM_IDS } from "./manifests.js";
import { emitSeedSql, serializeState, type StateStamp } from "./stateSnapshot.js";
import { aggregateScores, type HarnessPredictionInput, type ScoreSlice } from "./score.js";
import type { MetricHistoryRow } from "./metricHistory.js";
import { putObject } from "./r2Client.js";

const CORPUS_PATH = "data/corpus.sqlite";
const DEFAULT_BUCKET = "sigmascout-artifacts";
const DEFAULT_CONCURRENCY = 16;
const SEED_OUT_DIR = join("reports", "publish");

/** D-03 (rename D-04/D-05, plan 07-16): the base (untuned/unpromoted) modules for the three published ids. `resolvePublishAlgorithms` swaps `vpr` for the committed promoted version via `applyPromotedOverrides`, the same rule `manifests.ts`'s `buildAlgorithmsManifest` and `cli.ts`'s harness runs use — never a second, independently-derived resolution (T-04-16). Its own object key and `vpr.id` must agree — they do, because both derive from the same renamed registry export (T-07-16-01). */
const BASE_PUBLISH_ALGORITHMS: Record<string, AlgorithmModule<any>> = { opr, epa, vpr };

// ---------------------------------------------------------------------------
// Small local helpers shared by every assembly function below
// ---------------------------------------------------------------------------

/**
 * Out-of-scope fix authorized at 07-17's checkpoint:decision (not part of
 * that plan — see its own commit message). Defence-in-depth guard on
 * `TeamSeasonMatchSchema.actualRedRp`/`actualBlueRp`'s `.int()` assertion
 * (pageArtifacts.ts): `MatchResult.redRpEarned`/`blueRpEarned` is sourced
 * from the corpus's `matches.red_rp_earned`/`blue_rp_earned` columns, which
 * SQLite's loose type affinity does NOT enforce as integers — a
 * non-integer value written before `packages/ingest/normalize.ts`'s
 * `extractRp` started rejecting one (2024orbb/2025orbb, Oregon BunnyBots'
 * non-FRC `rp` field) would otherwise reach `.parse()` here and throw,
 * aborting the whole publish batch. Degrades to `null` — D-02's established
 * "not derivable" value — rather than rounding/truncating a fabricated RP
 * into existence; this function does not trust `extractRp`'s own discipline
 * alone, mirroring the `isBonusRpCompLevel` defence-in-depth precedent a
 * few lines below.
 */
function toIntegerRpOrNull(value: number | null): number | null {
  return value !== null && Number.isInteger(value) ? value : null;
}

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

/**
 * Rounds a `TeamMetrics`-shaped record's `value`/`spread` at
 * `ROUNDING_RULE.metric` — used for `EventTeamSchema.metrics`,
 * `TeamsTableRowSchema.metrics`, and `RecordAndMetricsSchema.metrics`.
 * `percentile` (D-04, Phase 6), when present on the input metric, passes
 * through UNCHANGED — it is already rounded once, at
 * `percentiles.ts`'s `withPercentiles`, and is never re-rounded here. A
 * plain `TeamMetric` (no `percentile`) is a valid input too, so every
 * existing call site — which never had a percentile to carry — is
 * unaffected.
 */
function roundTeamMetricRecord(metrics: Record<string, TeamMetricWithPercentile>): Record<string, TeamMetricWithPercentile> {
  const result: Record<string, TeamMetricWithPercentile> = {};
  for (const [key, m] of Object.entries(metrics)) {
    result[key] = {
      value: roundMetric(m.value),
      ...(m.spread !== undefined ? { spread: roundMetric(m.spread) } : {}),
      ...(m.percentile !== undefined ? { percentile: m.percentile } : {}),
      // `tier` passes through unchanged, exactly like `percentile`. It is a
      // categorical label, not a number, so there is nothing to round — but
      // it must be copied explicitly: this function rebuilds each metric
      // field-by-field, so anything not named here is silently dropped.
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
 * D-06.1-A (Phase 06.1, plan 06.1-05 Task 3): attaches a `percentile` to
 * every ALLOWLISTED metric on every history row, ranked against the
 * SEASON-FINAL pool `sortedPools` was built from
 * (`percentiles.ts`'s `sortedPoolsByMetric`) — never a pool assembled from
 * the history rows themselves, and never a pool restricted to this team's
 * own events. This reads as "where this team stood at that point, against
 * the final field" — deliberately not "the field as of that match index",
 * the more expensive option 06-UAT.md records as rejected.
 *
 * Returns a NEW array of NEW row objects, each carrying a NEW metrics
 * record — `rows` (and every nested metric object) is never mutated, since
 * `metricHistoryForAlgo`'s rows are reused across the per-team loop this is
 * called inside. Row order is preserved exactly; a row's percentile depends
 * only on its own value and the pool, never its position in `rows`.
 *
 * A metric attaches a percentile only when BOTH its name is in
 * `HISTORY_PERCENTILE_METRIC_KEYS` AND `sortedPools` has an entry for that
 * name (a metric name no team in the pool has at all is omitted from
 * `sortedPools` entirely, per `sortedPoolsByMetric`'s PD-07 contract) —
 * otherwise the metric is copied through unchanged, with no percentile key
 * and no thrown error.
 *
 * Exported (like `computeSizeStats`/`OUTCOME_KEYS` above it in this file)
 * for direct unit testing of its allowlist/pool/immutability/order-
 * independence behavior — an internal pipeline helper, not part of the
 * published artifact's own public surface.
 */
export function withHistoryPercentiles(rows: readonly MetricHistoryRow[], sortedPools: ReadonlyMap<string, number[]>): MetricHistoryRow[] {
  return rows.map((row) => {
    const newMetrics: MetricHistoryRow["metrics"] = {};
    for (const [name, metric] of Object.entries(row.metrics)) {
      const pool = HISTORY_PERCENTILE_METRIC_KEYS.includes(name) ? sortedPools.get(name) : undefined;
      newMetrics[name] = pool !== undefined ? { ...metric, percentile: percentileAgainstSortedPool(pool, metric.value) } : { ...metric };
    }
    return { ...row, metrics: newMetrics };
  });
}

/**
 * D-10, D-09, D-11, plan 07-09: attaches the SEASON-FINAL percentile to an
 * AS-OF-EVENT metrics record — the split D-10 locks and which 06.1-05
 * already established for `metricHistory` rows (`withHistoryPercentiles`
 * just above); see that function's doc comment for the shared reasoning,
 * not restated here.
 *
 * `sortedPools` is always the pool built once per (algorithm, season) from
 * that season's FULL team list (`sortedPoolsByMetric`) — ranking against an
 * event's own roster is forbidden (T-07-09-01): the tier box this feeds
 * renders in the identical colour whichever pool produced the number, so a
 * reader cannot detect the substitution. A metric name with no entry in
 * `sortedPools` is copied through with NO `percentile` key — never a
 * coerced `0` — inheriting `sortedPoolsByMetric`'s own PD-07 omission
 * contract.
 *
 * Unlike `withHistoryPercentiles`, this function applies NO metric-name
 * allowlist (PD-03): Breakdown tier-boxes every `metricKeysFor(algorithmId,
 * season)` column, and the payload argument that justifies the
 * history-row sibling's four-name cut (292 rows per team-season) runs the
 * opposite way here, where an event artifact carries exactly ONE metrics
 * record per team.
 * <!-- planner-discipline-allow: HISTORY_PERCENTILE_METRIC_KEYS -->
 */
export function withEventPercentiles(
  metrics: Record<string, TeamMetric>,
  sortedPools: ReadonlyMap<string, number[]>
): Record<string, TeamMetricWithPercentile> {
  const result: Record<string, TeamMetricWithPercentile> = {};
  for (const [name, metric] of Object.entries(metrics)) {
    const pool = sortedPools.get(name);
    result[name] = pool !== undefined ? { ...metric, percentile: percentileAgainstSortedPool(pool, metric.value) } : { ...metric };
  }
  return result;
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
  /**
   * D-10, plan 07-09: widened from `Record<string, TeamMetric>` — the
   * percentile is attached by `withEventPercentiles` BEFORE the value
   * reaches this interface, so nothing downstream (`buildEventArtifact`'s
   * `roundTeamMetricRecord`) computes one. A plain `TeamMetric` (no
   * `percentile`) is still assignable, so no existing caller is affected.
   */
  readonly metrics: Record<string, TeamMetricWithPercentile>;
}

/**
 * D-18 item 6, D-07, D-08, plan 07-08: the fields consumed from
 * `selectEventRankingsForSeason`'s inner map value (`packages/corpus/db.ts`),
 * named identically to it. Two things recorded here that a later reader has
 * no other source for. First, the naming hop: the corpus column is
 * `ranking_score`, `selectEventRankingsForSeason`'s field is
 * `rankingScore`, 07-04's ingest guards it with
 * `sort_order_info[0].name === "Ranking Score"`, and the published field is
 * `rp` — one quantity, four names, and the hop is now written down at every
 * end so no two ends can drift. Second, the provenance constraint: D-08's
 * fallback ordering is rendered by 07-11 and must NEVER be written into
 * `rank`, because a model-derived position under a name that asserts
 * official provenance is a false attribution the reader has no way to
 * detect. `totalTeams` is deliberately NOT consumed here — 07-07 PD-06
 * declined to add it to `EventTeamSchema`, and a field consumed but never
 * published is a question about what happened to it.
 * <!-- planner-discipline-allow: totalTeams -->
 */
export interface EventTeamRankingInput {
  readonly rank: number;
  readonly recordWins: number | null;
  readonly recordLosses: number | null;
  readonly recordTies: number | null;
  readonly rankingScore: number | null;
}

/**
 * D-18 item 8, plan 07-08: mirrors `EventMetaRow`'s own field names and
 * nullability field-for-field, so a call site passes a corpus row's fields
 * straight through with no per-site logic. Composition (the
 * `stateProv`/`country` join into one display string) happens exactly ONCE,
 * inside `buildEventArtifact`, through the exported location composer
 * (`pageArtifacts.ts`) — never at a call site — so the event page and the
 * Events list can never disagree about one event's location string (PD-04).
 */
export interface EventArtifactIdentityInput {
  readonly name: string | null;
  readonly startDate: string;
  readonly country: string | null;
  readonly stateProv: string | null;
  readonly week: number | null;
}

/**
 * D-18 item 7, D-15, D-16, plan 07-08: structurally `EventAllianceSelection`
 * (`packages/corpus/db.ts`), declared here so this file's exported parameter
 * surface does not depend on a corpus interface. `picks` is TBA's own
 * ordered array — entry 0 is the alliance leader and a fourth entry where
 * present is the reserve robot TBA lists with no field of its own. D-16
 * excludes that fourth team from 07-14's combined arithmetic; it does NOT
 * exclude the team from the published record of who was on the alliance, so
 * truncating this array anywhere would erase a real team's competition
 * result from the only published account of that event's selection.
 * <!-- planner-discipline-allow: captain --> <!-- planner-discipline-allow: backup -->
 *
 * `record` (07-UAT.md G-8, plan 07-21): optional (unlike
 * `EventAllianceSelection.record`, which the corpus always computes as
 * either an object or `null`) so every existing direct-construction call
 * site of this interface — every test in this file that builds an
 * `EventAllianceInput` literal without a corpus round trip — keeps
 * compiling unchanged. `undefined` and `null` are treated identically by
 * `buildEventArtifact` below: neither publishes a `record` key.
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
  /** D-08: not-yet-played matches with their predicted parameters. Defaults to `[]` — a fully-historical event has none, which is a valid artifact, not a missing one. */
  readonly upcoming?: readonly UpcomingPredictionRecord[];
  /** D-07: the event's standings-style team list. Defaults to `[]`. See `EventArtifactSchema`'s own doc comment in `pageArtifacts.ts` for why this field is REQUIRED (not optional) as of this plan. */
  readonly teams?: readonly EventTeamStandingInput[];
  /** D-04: a short opaque string identifying the publish run that produced this object. */
  readonly generation: string;
  /** D-04: ISO timestamp. Defaults to `new Date().toISOString()` — overridable for deterministic tests. */
  readonly computedAt?: string;
  /**
   * D-08 (Phase 6), plan 07-08, routed from a 07-12 finding: `match_key` ->
   * `sort_time`, the same map and the same name
   * `BuildTeamSeasonArtifactParams.sortTimeByMatchKey` already carries — see
   * that field's doc comment for the full contract, inherited verbatim
   * rather than restated: an omitted map, or a missing entry for a specific
   * match key, leaves that row's `sortTime` absent — never a synthetic
   * default, never a zero epoch, never a value derived from the match key
   * or from the clock. `07-UI-SPEC.md`'s Quals paragraph renders an
   * upcoming row's Actual column as a scheduled-time string, and this field
   * was found published on the team artifact but on neither event schema
   * and absent from every match row of the live `2024casf` artifact — so
   * without it that column ships as an em-dash.
   */
  readonly sortTimeByMatchKey?: ReadonlyMap<string, number>;
  /**
   * D-18 item 8, plan 07-08: the event's own identity, from the corpus
   * `events` row. Omitted entirely means "no caller told me" — none of
   * `name`/`startDate`/`location`/`week` is emitted on the candidate; a
   * caller passing raw corpus columns straight through is what makes
   * `location`'s single composition point (PD-04) actually hold.
   */
  readonly eventMeta?: EventArtifactIdentityInput;
  /**
   * D-18 item 7, D-15, D-16, D-17, plan 07-08: this event's playoff alliance
   * selection, from `selectEventAlliancesForSeason`. Optional so the key's
   * presence itself carries meaning (PD-03): present (including `[]`) means
   * the caller consulted the corpus, absent means this artifact predates the
   * field. Both real call sites supply this unconditionally — an event with
   * genuinely zero alliance rows publishes `[]`, never an omitted key.
   */
  readonly alliances?: readonly EventAllianceInput[];
  /**
   * D-18 item 6, D-07, D-08, plan 07-08: this event's official rank,
   * authoritative record and ranking points, keyed by team key — sourced
   * from the same once-per-season event-ranking read `TeamSeasonEventInput
   * .rank`'s own call site already consumes for this data. Looked up by KEY
   * inside `buildEventArtifact`, never by array position. A team key absent
   * from this map publishes none of `rank`/`record`/`rp` — the real state
   * of every event with no ranking rows (D-08's measured 259-of-1,581
   * count).
   */
  readonly rankings?: ReadonlyMap<string, EventTeamRankingInput>;
}

/**
 * D-18 item 6, D-07, D-08, plan 07-08: the conditionally-spread `rank`/
 * `record`/`rp` fields for one team row, given that team's (possibly
 * absent) ranking entry. Deliberately factored OUT of `buildEventArtifact`
 * itself — a block-bodied `.map()` callback needing its own local `const`
 * would need its own explicit `return`, which would leave
 * `buildEventArtifact`'s own function range with TWO `return` statements
 * instead of one, undermining the very literal single-return check
 * T-07-08-02's mitigation rests on (a second return is syntactically
 * harmless here but indistinguishable AT A GLANCE from the early return
 * this file's parse-through-schema discipline guards against). This
 * helper's own `return` lives outside that counted range.
 *
 * These three carry TBA's own reported values, which account for
 * disqualifications and surrogate appearances — never a tally this
 * pipeline counted from the match stream. They are independently optional
 * and a half-present set is a REAL state (an `event_rankings` row written
 * before 07-04's widened ingest carries a rank with a NULL record and a
 * NULL ranking score), so there is deliberately no cross-field requirement
 * here. `rp` is TBA's Ranking Score, a per-match average and therefore a
 * real number rather than an integer count — explicitly NOT the same
 * quantity as `TeamSeasonMatchSchema.actualRedRp`/`actualBlueRp`'s integer
 * bonus-RP counts, which share three letters with it and nothing else, and
 * rounds through 07-07's own `ROUNDING_RULE.rankingPoints` key rather than
 * the model-metric one, so a future change to model-display precision
 * cannot silently move a number TBA reported.
 * <!-- planner-discipline-allow: ROUNDING_RULE.metric -->
 * D-08's fallback ordering (07-11's render) must NEVER be written into
 * `rank` — this helper takes only a ranking entry, never a model metric, so
 * a model-derived position cannot reach this TBA-provenance-asserting
 * field (T-07-08-01).
 */
function eventTeamRankingFields(
  ranking: EventTeamRankingInput | undefined
): Partial<{ rank: number; record: { wins: number; losses: number; ties: number }; rp: number }> {
  return {
    // `rank` passed through unchanged; 07-07 typed it `.int().positive()`
    // so a fabricated `0` is unrepresentable at the schema layer and must
    // not be synthesized here either.
    ...(ranking?.rank !== undefined ? { rank: ranking.rank } : {}),
    // All-or-nothing (PD-06): a row missing any one of the three publishes
    // no `record` key at all — never a partial record with a zero
    // substituted for the gap. Every comparison is an explicit `!== null`
    // (never truthiness), so a real `0` survives (PD-07).
    ...(ranking !== undefined && ranking.recordWins !== null && ranking.recordLosses !== null && ranking.recordTies !== null
      ? { record: { wins: ranking.recordWins, losses: ranking.recordLosses, ties: ranking.recordTies } }
      : {}),
    // `!== null` guard (never truthiness) so a real `0` ranking score
    // survives (PD-07).
    ...(ranking?.rankingScore !== null && ranking?.rankingScore !== undefined
      ? { rp: roundTo(ranking.rankingScore, ROUNDING_RULE.rankingPoints) }
      : {}),
  };
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
    // D-13, plan 07-08 (routed from 07-12): see this interface's matching
    // param field just above for the full contract. Written inline (not
    // hoisted to a `const`) — this row builder's body is a concise arrow
    // expression, and hoisting would reindent every field below in a diff a
    // reviewer has to read for the variance change too.
    sortTime: params.sortTimeByMatchKey?.get(match.matchKey),
    redTeams: [...match.redTeams],
    blueTeams: [...match.blueTeams],
    predictedWinner: prediction.winner,
    pRedWin: roundProbability(prediction.pRedWin),
    predictedRedScore: roundMetric(prediction.redScore),
    predictedBlueScore: roundMetric(prediction.blueScore),
    redComponents: roundComponents(prediction.redComponents),
    blueComponents: roundComponents(prediction.blueComponents),
    // D-18 item 3, plan 07-08: each alliance's OWN predicted-score variance
    // — the same quantity, under the same field name, that
    // `TeamSeasonMatchSchema.redScoreVarianceOwn` has carried since Phase 6
    // (see that field's doc comment for the full contract; not restated
    // here). `undefined` for OPR/EPA, neither of which models an
    // alliance-level own variance. Rounded exactly once, here, at the
    // publish boundary, at `ROUNDING_RULE.variance` — reusing that existing
    // rule deliberately (07-07 PD-03: the same physical quantity as the
    // team artifact's pair, so a second rounding key would be drift wearing
    // documentation's clothes). Read directly off `predict()`'s own output
    // and never recomputed here: a recomputed value agrees with the model
    // by construction and would keep agreeing after this function stopped
    // reading the model's output at all (D-01, folded todo
    // `publish-match-predictive-variance.md`).
    redScoreVarianceOwn:
      prediction.redScoreVarianceOwn !== undefined ? roundTo(prediction.redScoreVarianceOwn, ROUNDING_RULE.variance) : undefined,
    blueScoreVarianceOwn:
      prediction.blueScoreVarianceOwn !== undefined ? roundTo(prediction.blueScoreVarianceOwn, ROUNDING_RULE.variance) : undefined,
    // D-03, plan 08-02 Task 1: each alliance's predicted distribution over
    // its total ranking points for this match — the same quantity, same
    // field names, same rounding rule as the `upcoming` builder's own pair
    // just below (see it rather than this comment restating it). Not gated
    // on the competition level, deliberately: sigma1 returns a real
    // one-entry degenerate distribution for a non-qualification match rather
    // than nothing, and both the `upcoming` builder here and
    // `buildTeamSeasonArtifact` publish that ungated already, so a gate here
    // would make this the only surface in the pipeline that drops what the
    // model returned (PD-02). Read directly off `prediction`, the same
    // `Prediction` object the walk-forward replay's own `predict()` call
    // produced for this match, and never synthesized — where the model
    // produced no distribution the key stays absent, which is a real
    // published state OPR and EPA occupy for every match they will ever
    // have.
    redRpPmf: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined,
    blueRpPmf: prediction.blueRpPmf ? roundPmf(prediction.blueRpPmf) : undefined,
    actualWinner: match.winner,
    actualRedScore: match.redScore,
    actualBlueScore: match.blueScore,
  }));

  const upcoming = (params.upcoming ?? []).map(({ match, prediction }) => ({
    matchKey: match.matchKey,
    compLevel: match.compLevel,
    setNumber: match.setNumber,
    matchNumber: match.matchNumber,
    /** D-13, plan 07-08: see the `matches` row builder's `sortTime` comment above for the full contract. */
    sortTime: params.sortTimeByMatchKey?.get(match.matchKey),
    redTeams: [...match.redTeams],
    blueTeams: [...match.blueTeams],
    predictedWinner: prediction.winner,
    pRedWin: roundProbability(prediction.pRedWin),
    predictedRedScore: roundMetric(prediction.redScore),
    predictedBlueScore: roundMetric(prediction.blueScore),
    redComponents: roundComponents(prediction.redComponents),
    blueComponents: roundComponents(prediction.blueComponents),
    /** D-18 item 3, plan 07-08: see the `matches` row builder's `redScoreVarianceOwn`/`blueScoreVarianceOwn` comment above for the full contract. */
    redScoreVarianceOwn:
      prediction.redScoreVarianceOwn !== undefined ? roundTo(prediction.redScoreVarianceOwn, ROUNDING_RULE.variance) : undefined,
    blueScoreVarianceOwn:
      prediction.blueScoreVarianceOwn !== undefined ? roundTo(prediction.blueScoreVarianceOwn, ROUNDING_RULE.variance) : undefined,
    redRpPmf: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined,
    blueRpPmf: prediction.blueRpPmf ? roundPmf(prediction.blueRpPmf) : undefined,
  }));

  const teams = (params.teams ?? []).map((t) => ({
    teamKey: t.teamKey,
    teamNumber: t.teamNumber,
    nickname: t.nickname,
    // D-18 item 6, D-07, D-08, plan 07-08: `eventTeamRankingFields` looks
    // this team up by KEY, never by array position — matching the by-key
    // discipline the team loop's own
    // `eventRankingsForSeason.get(eventKey)?.get(teamKey)` lookup already
    // establishes for this same data (`publishSeasons`). See that helper's
    // own doc comment (declared above this function, deliberately, so
    // `buildEventArtifact`'s own range keeps exactly one `return`
    // statement — T-07-08-02) for the full rank/record/rp contract,
    // including why the model's own per-team metrics (`t.metrics` below)
    // can never reach these TBA-provenance-asserting fields (T-07-08-01).
    ...eventTeamRankingFields(params.rankings?.get(t.teamKey)),
    metrics: roundTeamMetricRecord(t.metrics),
  }));

  // D-18 item 8, plan 07-08: the event's own identity. An omitted
  // `params.eventMeta` emits NONE of the four keys below — "no caller told
  // me" — inventing an identity from silence would be the same fault PD-03
  // forbids for `alliances`.
  const identityFields = params.eventMeta
    ? {
        // `name` falls back to the event key on a null OR EMPTY corpus
        // value (PD-05) — an explicit non-empty test, never `??`, because
        // `??` lets `""` straight through into a `.min(1)` parse failure.
        // The corpus `name` column is NULL until an `--events-only` refetch
        // fills it; mirrors `buildEventsArtifact`'s own `e.name ?? e.event_key`
        // intent while closing the empty-string hole a bare `??` leaves.
        name: params.eventMeta.name !== null && params.eventMeta.name.length > 0 ? params.eventMeta.name : params.eventKey,
        // `startDate` has no honest fallback (there is no key to fall back
        // to, unlike `name`) — an empty corpus value omits the key entirely
        // rather than publish a fabricated date.
        ...(params.eventMeta.startDate.length > 0 ? { startDate: params.eventMeta.startDate } : {}),
        // The ONLY call to the location composer in this pipeline (PD-04) —
        // `null` is a real published answer (no recorded location), never an
        // omission. Never reimplement the "{stateProv}, {country}" join
        // anywhere else in this file.
        location: composeEventLocation(params.eventMeta.stateProv, params.eventMeta.country),
        // Passed through unchanged, including `null` and including `0` — a
        // real week index is never conflated with "not derivable" (PD-07).
        week: params.eventMeta.week,
      }
    : {};

  // D-18 item 7, D-15, D-16, D-17, plan 07-08: this event's playoff alliance
  // selection. `undefined` (never assigned) when `params.alliances` was not
  // supplied, an array (possibly `[]`) otherwise — this is what lets
  // `candidate` below emit the `alliances` key exactly when the caller
  // consulted the corpus (PD-03): the key's PRESENCE, not its length, is
  // the "did anyone ask" signal, and `[]` is the honest "zero rows" answer
  // for an event that ran quals and rankings but held no selection.
  const alliances = params.alliances?.map((sel) => ({
    allianceNumber: sel.allianceNumber,
    // Conditional spread (never `""`, never a synthesized label) — an
    // absent key for an absent TBA name, isomorphic to the source shape
    // live-observed at `2024wvrox`. Choosing a display fallback is 07-14's
    // decision to make from this honest absence.
    ...(sel.name !== null && sel.name.length > 0 ? { name: sel.name } : {}),
    // A fresh copy, never aliased (T-07-08-07) — 07-02's ORDER BY is the
    // ordering contract and this function neither sorts, filters, dedupes
    // nor truncates it. Never sliced to three: D-16 excludes a fourth pick
    // from 07-14's summed arithmetic, not from this published record of who
    // was on the alliance.
    picks: [...sel.picks],
    // 07-UAT.md G-8, plan 07-21: `undefined` and `null` both omit the key —
    // no playoff record exists to publish, never a fabricated `{wins: 0,
    // losses: 0, ties: 0}`. Two explicit `!==` comparisons (never truthiness,
    // never a loose `!=`), matching `eventTeamRankingFields`'s own style
    // just above for the identical undefined-or-null shape.
    ...(sel.record !== null && sel.record !== undefined ? { record: sel.record } : {}),
  }));

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
 * `packages/core/algorithms/sigma1/index.ts`'s `update()` already uses to
 * decide whether to fold a match's RP observation at all (its `usedFallback
 * || !isRpEligibleEventType(...)` skip condition) — so a match whose RP
 * fold Sigma1 skips is EXACTLY a match whose actual flags this function
 * publishes as `null`. Two independently-drifting eligibility rules is the
 * exact failure mode `sigma1/index.ts`'s own comment there warns against;
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
  readonly seasonStats: { record: { wins: number; losses: number; ties: number }; metrics: Record<string, TeamMetricWithPercentile> };
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
        // TeamSeasonMatchSchema requires these present (mirrors predictions.ts's
        // PredictionRecordSchema: empty {} for an algorithm like OPR that does
        // not decompose its prediction, never omitted).
        redComponents: roundComponents(prediction.redComponents) ?? {},
        blueComponents: roundComponents(prediction.blueComponents) ?? {},
        variance: prediction.variance !== undefined ? roundTo(prediction.variance, ROUNDING_RULE.variance) : undefined,
        // D-01 (Phase 6): each alliance's OWN predicted-score variance —
        // reuses ROUNDING_RULE.variance unchanged (same physical quantity as
        // `variance` above). OPR/EPA never set these on `Prediction`, so both
        // stay undefined for them, matching `variance`'s own convention.
        redScoreVarianceOwn:
          prediction.redScoreVarianceOwn !== undefined ? roundTo(prediction.redScoreVarianceOwn, ROUNDING_RULE.variance) : undefined,
        blueScoreVarianceOwn:
          prediction.blueScoreVarianceOwn !== undefined ? roundTo(prediction.blueScoreVarianceOwn, ROUNDING_RULE.variance) : undefined,
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
    seasonStats: { record: params.seasonStats.record, metrics: roundTeamMetricRecord(params.seasonStats.metrics) },
    events,
    metricHistory: params.metricHistory.map(roundMetricHistoryRow),
    robotImageUrl: params.robotImageUrl,
    activeYears: params.activeYears ? [...params.activeYears] : undefined,
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

/**
 * Replaces each metric's `percentile` with the compact `tier` the teams
 * table actually consumes. Common is omitted entirely (it renders unboxed),
 * so absence means "Common or unranked".
 */
function withPublishedTiers(metrics: Record<string, { value: number; spread?: number; percentile?: number }>): Record<string, { value: number; spread?: number; tier?: "rare" | "epic" | "legendary" }> {
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
 * while `sortedPools` is always the SEASON-FINAL pool built once per
 * (algorithm, season) at its existing single site. This is the same split
 * `withHistoryPercentiles` applies to history rows; the merge itself is
 * `withEventPercentiles`. Required rather than optional (PD-02): an
 * optional pool is an opt-out, and an artifact published without
 * percentiles parses, uploads, and renders a page with every tier box dark.
 */
function buildEventTeamsStanding(
  metricsByTeam: TeamMetrics,
  teamKeys: readonly string[],
  teamInfo: ReadonlyMap<string, TeamInfo>,
  sortedPools: ReadonlyMap<string, number[]>
): EventTeamStandingInput[] {
  return teamKeys.map((teamKey) => {
    const info = teamInfoOrFallback(teamInfo, teamKey);
    return {
      teamKey,
      teamNumber: info.teamNumber,
      nickname: info.nickname,
      metrics: withEventPercentiles(metricsByTeam[teamKey] ?? {}, sortedPools),
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

  for (const season of seasonsSorted) {
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
    // D-08 (Phase 6): match_key -> sort_time for every match this season,
    // played or not — feeds both TeamSeasonMatchSchema.sortTime and the
    // per-event match ordering below (sortTeamSeasonMatches).
    const sortTimeByMatchKey = selectScheduledMatchTimes(db, season, { excludeOffseason: !includeOffseason });
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
    // contract and its exact correspondence with `sigma1/index.ts`'s
    // `update()` RP-fold skip predicate.
    const actualBonusFlagsByMatchKey = actualBonusFlagsForSeason(stream, season);

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
    const onMatchComplete = (match: MatchResult, algorithmId: string, state: unknown): void => {
      const algorithm = algorithmById.get(algorithmId);
      if (!algorithm) return;
      stateByAlgoEvent.get(algorithmId)!.set(match.eventKey, state);
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
      // D-04 (Phase 6): the mid-rank percentile pass, run exactly once per
      // (algorithm, season) at this single reuse point — before either
      // downstream consumer reads `metricsByTeam`. Only the per-team
      // artifact's `seasonStats.metrics` below consumes the widened result
      // this phase; `teamsRows` (the teams/{year} artifact) deliberately
      // keeps reading the unwidened `metricsByTeam` — see percentiles.ts's
      // file header and 06-RESEARCH.md's Open Question 2 for why widening
      // the teams artifact's published surface is out of this phase's scope.
      const metricsByTeamWithPercentiles = withPercentiles(metricsByTeam, teamsThisSeason);
      // D-06.1-A (Phase 06.1, plan 06.1-05 Task 3): the season-final sorted
      // pool per metric name, built exactly ONCE per (algorithm, season)
      // here — never once per team — from the SAME pool membership list
      // (`teamsThisSeason`) `withPercentiles` above is given, so the two
      // rankings can never disagree about who is in the field. This ranks
      // an as-of-that-match metricHistory value against the SEASON-FINAL
      // field ("where this team stood at that point, against the final
      // field"), deliberately not "the field as of that match index" — the
      // more expensive option 06-UAT.md records as rejected.
      const sortedPools = sortedPoolsByMetric(metricsByTeam, teamsThisSeason);
      // D-10, plan 07-09: this algorithm's per-event state capture, bound
      // once here for the event loop below — never rebuilt per event.
      const stateByEventForAlgo = stateByAlgoEvent.get(algorithm.id)!;
      const eventMatchesForAlgo = perAlgoEventMatches.get(algorithm.id)!;
      const teamMatchesForAlgo = perAlgoTeamMatches.get(algorithm.id)!;
      const metricHistoryForAlgo = metricHistoryByAlgoTeam.get(algorithm.id)!;

      // D-08 (Phase 6): scheduled-match predictions for THIS algorithm,
      // computed once per event key here and shared by both the event
      // branch's `upcoming` array below and the team branch's per-team
      // grouping — a single `algorithm.predict(state, match)` call per
      // scheduled match, not one per (event, team) pairing.
      const scheduledPredictionsByEvent = new Map<string, UpcomingPredictionRecord[]>();
      if (state !== undefined) {
        for (const [eventKey, matchesForEvent] of scheduledByEvent) {
          scheduledPredictionsByEvent.set(
            eventKey,
            matchesForEvent.map((match) => ({ match, prediction: algorithm.predict(state, match) }))
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
        const stats = teamStats.get(teamKey);
        return {
          teamKey,
          teamNumber: info.teamNumber,
          nickname: info.nickname,
          record: { wins: stats?.wins ?? 0, losses: stats?.losses ?? 0, ties: stats?.ties ?? 0 },
          // Carries the D-17 rarity TIER, not the raw percentile (was the
          // unwidened `metricsByTeam`, scoped out in Phase 6 as
          // 06-RESEARCH.md Open Question 2). The Teams table now applies the
          // same tiers the team page does, so a number does not change
          // meaning between the table and the page it links to.
          //
          // Measured on 2024/sigma1, the largest teams artifact [pre-rename]: publishing
          // `percentile` costs +42% gzipped (369KB -> 525KB); publishing
          // `tier` with Common omitted costs +10% (369KB -> 405KB), for an
          // identical rendered result. Page-load speed is the top stated UX
          // priority, so the table gets the cheap representation and the
          // small per-team artifact keeps the full percentile.
          metrics: withPublishedTiers(metricsByTeamWithPercentiles[teamKey] ?? {}),
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
      // (respecting --include-offseason, plan 07-09: now CLI-reachable via
      // main()'s parseArgs, where before this plan nothing could set it),
      // same scope as the artifacts themselves — an offseason event shows
      // zero counts when offseason matches were excluded from this run.
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
        const upcoming: UpcomingPredictionRecord[] = scheduledPredictionsByEvent.get(e.event_key) ?? [];
        const eventTeamKeys = Array.from(
          new Set([...predictions.flatMap((p) => [...p.match.redTeams, ...p.match.blueTeams]), ...scheduledForEvent.flatMap((m) => [...m.redTeams, ...m.blueTeams])])
        );
        if (predictions.length === 0 && upcoming.length === 0) continue; // no data for this event under this run's scope
        // D-10, plan 07-09: the value is AS-OF-EVENT (this event's last
        // chronological match, or the season-final fallback for an event
        // with no completed matches — PD-04); the pool is SEASON-FINAL
        // (`sortedPools`, already in scope above).
        const asOfEventMetrics = metricsAsOfEvent(algorithm, stateByEventForAlgo, e.event_key, eventTeamKeys, metricsByTeam);
        const teamsStanding = buildEventTeamsStanding(asOfEventMetrics, eventTeamKeys, teamInfo, sortedPools);
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
        });
        const key = artifactKey({ page: "event", eventKey: e.event_key, algorithmId: algorithm.id, version });
        eventPending.push(uploader.publish("event", key, JSON.stringify(eventArtifact)));
      }

      // --- team/{teamKey}/{year}/{algorithm}@{version}.json, one per team ---
      const teamPending: Promise<void>[] = [];
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
            // D-04 (Phase 6): the percentile-widened record — the ONLY
            // consumer of `metricsByTeamWithPercentiles` this phase wires.
            metrics: metricsByTeamWithPercentiles[teamKey] ?? {},
          },
          events,
          metricHistory: withHistoryPercentiles(metricHistoryForAlgo.get(teamKey) ?? [], sortedPools),
          sortTimeByMatchKey,
          actualBonusFlagsByMatchKey,
          // D-03 (Phase 6): omitted entirely when the corpus has no row, or
          // the stored value is null — never fetched, never guessed.
          robotImageUrl: teamMediaForSeason.get(teamKey)?.imageUrl ?? undefined,
          // D-05 (Phase 6): from the activeYears pre-pass above.
          activeYears: activeYearsByTeam.get(teamKey),
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

/** D-03 (rename D-04/D-05, plan 07-16/07-18): resolves the requested `--algorithm` ids (default: `PUBLISHED_ALGORITHM_IDS` — the single tier again, collapsed by 07-18 once 07-17's write pass made the `vpr@` objects live) against the base modules, then swaps in the promoted VPR the same way `manifests.ts`/`cli.ts` do (T-04-16) — never a second, independent resolution. Exported (plan 07-16 Task 2) so the rename's default-set/artifact-key/unknown-id behavior is directly testable rather than only reachable through the CLI entry point. */
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
    const season = deriveSeasonFromEventKey(eventKey);
    // D-10, PD-05, plan 07-09 Task 2: this mode now replays the target
    // event's WHOLE SEASON, not just the one event, so the percentile it
    // publishes is ranked against a genuine season-wide pool rather than
    // the event's own roster — which `TeamMetricSchema.percentile`'s own
    // definition forbids. Cost: one season replay per invocation, 16-29
    // seconds measured (RESEARCH.md Question 3), against a previously
    // near-instant command. Honest remaining limitation, not hidden: this
    // mode still carries no CROSS-SEASON state (no season-boundary
    // threading), so a value it writes is close to but not identical to
    // what a full seasons run produces — and that full run overwrites
    // every key it touches. This is the path a subset publish runs on, so
    // an artifact written here is what the rendered tabs are verified
    // against.
    //
    // PD-06: offseason matches are always included in this season replay,
    // with no flag of its own — `--event <key>` is an explicit request for
    // that one event; an excluding stream would be empty (and throw on
    // data that plainly exists) for an offseason event, and the phase's
    // authorized full republish always widens its own scope the same way,
    // so this matches the trajectory that run will write.
    const stream = buildSeasonStream(db, season, { includeOffseason: true });
    const scheduled = selectScheduledMatches(db, { year: season });
    const teamsThisSeason = Array.from(
      new Set([...stream.flatMap((m) => [...m.redTeams, ...m.blueTeams]), ...scheduled.flatMap((m) => [...m.redTeams, ...m.blueTeams])])
    );

    // PD-07: the loud zero-completed-matches guard and its exact message
    // are unchanged from 07-08/Phase 4 — never widened to silently publish
    // a scheduled-only event.
    const matches = stream.filter((m) => m.eventKey === eventKey);
    if (matches.length === 0) {
      throw new Error(`No completed matches found in corpus for event ${eventKey}`);
    }
    const teams = Array.from(new Set(matches.flatMap((m) => [...m.redTeams, ...m.blueTeams])));

    // D-10, plan 07-09 Task 2: the same one-line per-event state capture
    // Task 1 added to the seasons path's own per-match completion hook —
    // one Map, no season-boundary threading (this mode publishes no
    // team-season artifact and needs none).
    const stateByEventKey = new Map<string, unknown>();
    const onMatchComplete = (match: MatchResult, _algorithmId: string, state: unknown): void => {
      stateByEventKey.set(match.eventKey, state);
    };
    const simulator = new WalkForwardSimulator(stream);
    const records = simulator.runAll([algorithm], teamsThisSeason, undefined, onMatchComplete);
    const predictions: PredictionRecord[] = records
      .filter((r) => r.match.eventKey === eventKey)
      .map((r) => ({ match: r.match, prediction: r.prediction }));
    const finalState = records.finalStates.get(algorithm.id);

    const scheduledForEvent = scheduled.filter((m) => m.eventKey === eventKey);
    const upcoming: UpcomingPredictionRecord[] =
      finalState !== undefined ? scheduledForEvent.map((match) => ({ match, prediction: algorithm.predict(finalState, match) })) : [];

    const teamInfo = lookupAllTeamInfo(db);
    const eventTeamKeys = Array.from(new Set([...teams, ...scheduledForEvent.flatMap((m) => [...m.redTeams, ...m.blueTeams])]));

    // D-10, plan 07-09 Task 2: derived exactly as the seasons path's own
    // per-algorithm block derives them — season-final metrics over the
    // WHOLE season's team list, the pool built from that same map, and the
    // as-of-event record through the shared helper.
    const seasonFinalMetrics = finalState !== undefined ? algorithm.teamMetrics(finalState, teamsThisSeason) : {};
    const sortedPools = sortedPoolsByMetric(seasonFinalMetrics, teamsThisSeason);
    const asOfEventMetrics = metricsAsOfEvent(algorithm, stateByEventKey, eventKey, eventTeamKeys, seasonFinalMetrics);
    const teamsStanding = buildEventTeamsStanding(asOfEventMetrics, eventTeamKeys, teamInfo, sortedPools);
    // D-08 (Phase 6)/D-13, plan 07-08: this single-event mode had no
    // sort-time read at all before that plan — `--event <key>` is an
    // explicit request to publish that one event, so this call is made with
    // NO options object (offseason matches included), unlike the
    // seasons-path read this file's season loop makes above.
    const sortTimeByMatchKey = selectScheduledMatchTimes(db, season);
    // D-18 items 6/7/8, plan 07-08: this single-event mode had no identity,
    // alliance or ranking reads at all before this plan — `--event <key>`
    // is 07-10's ONLY subset-publish path, so an artifact written here
    // missing any of these leaves 07-11/07-14/07-15 with nothing to build
    // against. A missing `events` row (a corpus with matches but no event
    // metadata — a degraded corpus, not a reason to refuse to publish this
    // event's matches) yields an OMITTED `eventMeta` parameter, never a
    // throw.
    const eventMetaRow = selectEventMeta(db, season).find((e) => e.event_key === eventKey);
    const alliancesForEvent = selectEventAlliancesForSeason(db, season).get(eventKey) ?? [];
    const rankingsForEvent = selectEventRankingsForSeason(db, season).get(eventKey);

    const validated = buildEventArtifact({
      eventKey,
      season,
      algorithmId: algorithm.id,
      algorithmVersion: algorithm.version,
      predictions,
      upcoming,
      teams: teamsStanding,
      generation: randomUUID(),
      sortTimeByMatchKey,
      eventMeta: eventMetaRow
        ? { name: eventMetaRow.name, startDate: eventMetaRow.start_date, country: eventMetaRow.country, stateProv: eventMetaRow.state_prov, week: eventMetaRow.week }
        : undefined,
      alliances: alliancesForEvent,
      rankings: rankingsForEvent,
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
  skipState: boolean,
  includeOffseason: boolean
): Promise<void> {
  const seasons = parseSeasonsRange(seasonsSpec);
  const algorithms = resolvePublishAlgorithms(algorithmIdsCsv);

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    await publishSeasons(db, { seasons, algorithms, bucket, concurrency, dryRun, skipState, includeOffseason });
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
      "include-offseason": { type: "boolean" },
    },
  });

  const bucket = values.bucket ?? DEFAULT_BUCKET;
  const dryRun = values["dry-run"] === true;

  if (values.event) {
    await runEventMode(values.event, values.algorithm, bucket, dryRun);
  } else if (values.seasons) {
    const concurrency = values.concurrency ? Number.parseInt(values.concurrency, 10) : DEFAULT_CONCURRENCY;
    await runSeasonsCliMode(
      values.seasons,
      values.algorithm,
      bucket,
      concurrency,
      dryRun,
      values["skip-state"] === true,
      values["include-offseason"] === true
    );
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
