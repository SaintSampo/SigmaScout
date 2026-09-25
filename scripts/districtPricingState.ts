/**
 * THE ONE SEAM that turns a corpus into walk-forward SPR state for the district
 * bake: replay the seasons ahead of the target one, replay the target season
 * TRUNCATED at an as-of instant, and hand back the state, the season's
 * `SigmaScoutLayer` and the two roster-scoped closures a bake needs.
 *
 * It MIRRORS `scripts/measureFieldAveragedRanks.ts`'s `replaySeason` rather
 * than forking it: the same offseason-inclusive stream, the same
 * corpus-global cold-start index, the same `seasonBoundaryFor` plus
 * `carrySeason` threading, the same `onMatchComplete` Sigma-talent capture and
 * the same post-replay `SigmaScoutLayer` fold.
 *
 * IT EXISTS SEPARATELY FROM `scripts/publishedSprSnapshots.ts` because that
 * module's product is a BEFORE-MATCH snapshot per played match, while this
 * one's is the state AFTER the last match replayed plus the layer and the RP
 * accumulator a bound `predict` needs. Those are different instants and
 * different shapes.
 *
 * WHICH MEMBER OF `WalkForwardSimulator.runAll`'s RETURN IS THE END STATE,
 * read from `packages/harness/replay.ts` rather than assumed: `finalStates`.
 * Its own doc comment calls it "each algorithm's state after the LAST REPLAYED
 * MATCH, whatever kind of event it belonged to — the honest 'where this replay
 * ended' value". `carryStates` is the OTHER one: it is what a season-boundary
 * threading site hands `carrySeason`, and for an algorithm declaring
 * `carryFrom: "last-official-match"` it is the state after the last OFFICIAL
 * match instead, which is deliberately NOT where the replay ended. This module
 * uses `carryStates` to thread across a season boundary and `finalStates` to
 * price, exactly as those two contracts require.
 *
 * CREDENTIALS: reads `data/corpus.sqlite` READ-ONLY through the handle the
 * caller opens and the caller closes. No network request, no environment
 * variable, no credential, no R2 and no D1. `.env` is never read, printed or
 * interpolated.
 *
 * THE DISTRICT ARTIFACT IS DELIBERATELY NOT ALGORITHM-SCOPED (see
 * `DistrictArtifactSchema`'s own reasoning) while the baked pmfs this state
 * prices ARE one algorithm's. That is exactly why the baked block carries its
 * own `algorithmId`/`algorithmVersion`/`pricedFrom`/`draws` provenance keys: a
 * published prediction whose pricing source is not readable from the artifact
 * cannot be audited by anyone reading the site.
 */
import { openCorpusReadOnly, type Corpus } from "../packages/corpus/db.js";
import { TOTAL_METRIC_KEY, type AlgorithmModule, type MatchResult, type Prediction, type UpcomingMatch } from "../packages/core/algorithms/types.js";
import type { AllianceMemberRating } from "../packages/core/algorithms/simulation/allianceWinProbability.js";
import { RP_RULE_MODULES } from "../packages/core/rankingPoints/rules.js";
import { RpMeanShiftAccumulator } from "../packages/core/rankingPoints/meanShift.js";
import { corpusColdStartIndex } from "../packages/harness/corpusColdStart.js";
import { BASE_PUBLISH_ALGORITHMS, makeRankingPointFiller } from "../packages/harness/publish.js";
import { buildSeasonStream, WalkForwardSimulator } from "../packages/harness/replay.js";
import { seasonBoundaryFor } from "../packages/harness/seasonBoundary.js";
import { SigmaScoutLayer } from "../packages/harness/sigmaScoutLayer.js";
import { usesSigmaScore } from "../packages/harness/sigmaScore.js";

/** The default corpus path, the same literal every other script in this directory uses. */
export const CORPUS_PATH = "data/corpus.sqlite";

/** Raised for a state this module refuses to hand back half-built. */
export class DistrictPricingStateError extends Error {
  constructor(message: string) {
    super(`districtPricingState: ${message}`);
    this.name = "DistrictPricingStateError";
  }
}

interface EventStartRow {
  event_key: string;
  start_date: string | null;
}

/**
 * Every event key in `season` whose `events.start_date` is STRICTLY BEFORE
 * `asOf` — that is, every event that had already started at that instant.
 *
 * A NULL START DATE READS AS STARTED, which is the exact OPPOSITE of
 * `eventStillAhead`'s default, and the asymmetry is deliberate rather than an
 * oversight. `eventStillAhead` decides whether an event can still yield points
 * to a team, so it errs toward keeping a ceiling honest and assumes an unknown
 * date is ahead. This predicate decides whether an event's REAL PLAYED ROWS
 * enter a walk-forward replay, and discarding observed results is the worse
 * error of the two: a null-dated event's matches are real, and dropping them
 * would throw away evidence the model is entitled to.
 *
 * With `asOf` at or after every start date in the corpus the returned set is
 * every event key, so the truncation is an IDENTITY and a production run
 * replays exactly the stream it replays today. That is what licenses `--as-of`
 * being the same code path as production rather than a verification-only one.
 */
export function startedEventKeysAsOf(db: Corpus, season: number, asOf: string): ReadonlySet<string> {
  const rows = db.prepare(`SELECT event_key, start_date FROM events WHERE year = ?`).all(season) as EventStartRow[];
  const instant = Date.parse(asOf);
  if (Number.isNaN(instant)) throw new DistrictPricingStateError(`as-of instant "${asOf}" is not a parseable date`);
  const started = new Set<string>();
  for (const row of rows) {
    if (row.start_date === null) {
      started.add(row.event_key);
      continue;
    }
    const start = Date.parse(row.start_date);
    if (Number.isNaN(start) || start < instant) started.add(row.event_key);
  }
  return started;
}

export interface BuildDistrictPricingStateOptions {
  /** The season whose events are to be priced. */
  readonly season: number;
  /** Seasons replayed BEFORE the target one, ascending. `[]` replays the target season cold. */
  readonly warmupSeasons: readonly number[];
  /** The instant the run is computed at. Truncates the TARGET season's stream to events that had already started. */
  readonly asOf: string;
  /** The resolved SPR algorithm — `resolveDistrictPricingAlgorithm`'s output, or a test's own module. */
  readonly algorithm: AlgorithmModule<any>;
}

export interface DistrictPricingState {
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  /** Always `"current-state"` — the same string `buildPreScheduleSidecarForEvent` stamps for an event with no completed matches, and for the same reason: an unstarted event's pre-event state IS the current state. */
  readonly pricedFrom: "current-state";
  readonly asOf: string;
  /** Every season actually replayed, ascending, warmup first. */
  readonly replayedSeasons: readonly number[];
  /** How many matches entered the replay across every replayed season. The walk-forward boundary as a number. */
  readonly matchesReplayed: number;
  /** How many of the target season's matches were dropped by the as-of truncation. */
  readonly matchesTruncated: number;
  /** The event keys of the target season that had already started at `asOf`. */
  readonly startedEventKeys: ReadonlySet<string>;
  /** `finalStates` — the state after the last replayed match. See this file's header. */
  readonly endState: unknown;
  /** The target season's layer, folded over the truncated played stream. */
  readonly layer: SigmaScoutLayer;
  /** The published SPR pair per roster team, in `allianceWinProbability`'s own input shape. A team the replay never rated is simply absent. */
  readonly ratingsFor: (roster: readonly string[]) => ReadonlyMap<string, AllianceMemberRating>;
  /** The bound `predict` a bake needs, or `undefined` when the all-or-nothing roster rule rejects this roster. */
  readonly predictFor: (roster: readonly string[]) => ((match: UpcomingMatch) => Prediction) | undefined;
}

/**
 * The SPR algorithm the district bake prices from, or `null` when none
 * resolves. Every published algorithm that does NOT carry a Sigma Score is
 * logged with its reason and skipped, following
 * `scripts/measureMatchBandCoverage.ts`'s own line — a silent filter is how a
 * publish quietly changes which model it priced from.
 */
export function resolveDistrictPricingAlgorithm(): AlgorithmModule<any> | null {
  const resolved: AlgorithmModule<any>[] = [];
  for (const [id, algorithm] of Object.entries(BASE_PUBLISH_ALGORITHMS)) {
    if (!usesSigmaScore(id)) {
      console.log(`districtPricingState: skipping algorithm "${id}" — it publishes no Sigma Score, so it cannot price an alliance`);
      continue;
    }
    resolved.push(algorithm);
  }
  if (resolved.length === 0) return null;
  if (resolved.length > 1) {
    console.log(
      `districtPricingState: ${resolved.length} Sigma-Score algorithms resolved (${resolved.map((a) => a.id).join(", ")}) — pricing from "${resolved[0]!.id}"`
    );
  }
  return resolved[0]!;
}

/**
 * Replays `warmupSeasons` then `season`, with the TARGET season's stream
 * truncated to matches belonging to events that had already started at `asOf`,
 * and returns everything a district bake prices from.
 *
 * THE WALK-FORWARD BOUNDARY IS STRUCTURAL, NOT INTENTIONAL. The same instant
 * decides which matches enter the replay and (in the caller) which events are
 * still ahead, so an event that had not started at `asOf` contributes no
 * match to the state that prices it. There is no ordering discipline to get
 * wrong, because a leak is not expressible.
 *
 * Returns `null` when every replayed stream is empty — the honest "there is
 * nothing to price from" answer rather than a state fitted on no matches.
 */
export function buildDistrictPricingState(db: Corpus, options: BuildDistrictPricingStateOptions): DistrictPricingState | null {
  const { season, asOf, algorithm } = options;
  const seasons = [...options.warmupSeasons].filter((s) => s < season).sort((a, b) => a - b);
  seasons.push(season);

  const coldStartIndex = corpusColdStartIndex(db);
  const startedEventKeys = startedEventKeysAsOf(db, season, asOf);

  let carriedState: unknown;
  let endState: unknown;
  let layer: SigmaScoutLayer | undefined;
  let matchesReplayed = 0;
  let matchesTruncated = 0;

  for (const [seasonIdx, s] of seasons.entries()) {
    const fullStream = buildSeasonStream(db, s, { includeOffseason: true });
    // Only the TARGET season is truncated: a warmup season is entirely in the
    // past relative to `asOf` by construction (`seasons` is ascending and every
    // warmup season is strictly below the target), so truncating it would be a
    // no-op that only obscured the rule.
    const stream = s === season ? fullStream.filter((m) => startedEventKeys.has(m.eventKey)) : fullStream;
    if (s === season) matchesTruncated = fullStream.length - stream.length;
    matchesReplayed += stream.length;

    const teams = [...new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
    const boundary = seasonBoundaryFor(seasons, seasonIdx);
    let initialStates: ReadonlyMap<string, unknown> | undefined;
    if (!boundary.isColdStart && carriedState !== undefined && algorithm.carrySeason) {
      initialStates = new Map<string, unknown>([[algorithm.id, algorithm.carrySeason(carriedState, boundary)]]);
    }

    const talentAfterMatch = new Map<string, Map<string, number>>();
    const onMatchComplete = (match: MatchResult, algorithmId: string, state: unknown): void => {
      if (algorithmId !== algorithm.id) return;
      if (!usesSigmaScore(algorithmId)) return;
      const involved = [...match.redTeams, ...match.blueTeams];
      const metrics = algorithm.teamMetrics(state, involved);
      const talent = new Map<string, number>();
      for (const teamKey of involved) {
        const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
        if (total !== undefined) talent.set(teamKey, total);
      }
      talentAfterMatch.set(match.matchKey, talent);
    };

    const simulator = new WalkForwardSimulator(stream, coldStartIndex);
    const records = simulator.runAll([algorithm], teams, initialStates, onMatchComplete);
    carriedState = records.carryStates.get(algorithm.id);

    if (s === season) {
      // `finalStates`, not `carryStates` — see this file's header.
      endState = records.finalStates.get(algorithm.id);
      layer = new SigmaScoutLayer(RP_RULE_MODULES[s], algorithm.id);
      for (const record of records) {
        if (record.algorithmId !== algorithm.id) continue;
        layer.foldPlayed(record.match, record.prediction, talentAfterMatch.get(record.match.matchKey));
      }
    }
  }

  if (layer === undefined || matchesReplayed === 0) return null;

  const ruleModule = RP_RULE_MODULES[season];
  const sigmaByTeam = layer.sigmaScoreByTeam();
  if (ruleModule !== undefined && layer.rpAccumulator === undefined) {
    throw new DistrictPricingStateError(
      `season ${season} replayed ${matchesReplayed} match(es) but algorithm "${algorithm.id}" published no ranking-point accumulator — refusing to hand back a half-built pricing state`
    );
  }
  const resolvedLayer = layer;
  const resolvedState = endState;

  return {
    algorithmId: algorithm.id,
    algorithmVersion: algorithm.version,
    pricedFrom: "current-state",
    asOf,
    replayedSeasons: seasons,
    matchesReplayed,
    matchesTruncated,
    startedEventKeys,
    endState: resolvedState,
    layer: resolvedLayer,
    ratingsFor: (roster) => {
      const metrics = algorithm.teamMetrics(resolvedState, [...roster]);
      const ratings = new Map<string, AllianceMemberRating>();
      for (const teamKey of roster) {
        const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
        const sigma = sigmaByTeam.get(teamKey);
        ratings.set(teamKey, { teamKey, total, sigma });
      }
      return ratings;
    },
    predictFor: (roster) => {
      const filler = makeRankingPointFiller(
        resolvedLayer.rpAccumulator,
        ruleModule,
        sigmaByTeam,
        roster,
        ruleModule === undefined ? undefined : RpMeanShiftAccumulator.fromState(ruleModule, resolvedLayer.rpMeanShiftState())
      );
      if (filler === undefined) return undefined;
      return (match: UpcomingMatch) => filler(match, algorithm.predict(resolvedState, match));
    },
  };
}

/** Opens the corpus read-only at the default path. The CALLER closes the handle. */
export function openDistrictPricingCorpus(path: string = CORPUS_PATH): Corpus {
  return openCorpusReadOnly(path);
}
