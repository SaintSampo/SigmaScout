/**
 * THE ONE SEAM that turns a corpus into walk-forward SPR state for the district
 * bake: replay the seasons ahead of the target one and then the target season,
 * every one CUT at an as-of instant by each match's own timestamp, and hand back
 * the state, the season's `SigmaScoutLayer` and the two roster-scoped closures a
 * bake needs.
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
 * THE SIGMA-CARRY CANDIDATE (`options.sigmaCarry`, off by default and off on
 * every production path) is the one switch here that changes a number. With it
 * on, each warmup season also folds a Sigma-only layer so it can hand the next
 * season its carry, and the pricing closures rate a never-seen team with the
 * candidate's rookie rule. `packages/harness/sigmaCarry.ts` holds the whole
 * definition; the acceptance bar it has to pass is pre-registered in debug
 * session `presim-bake-rp-filler-refuses`.
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
import { candidateRosterRatings, candidateSigmaMap, type SigmaSeasonCarry } from "../packages/harness/sigmaCarry.js";

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

/** `asOf` as epoch milliseconds, or a typed refusal. Every as-of predicate below parses through here, so they share one refusal. */
function parseAsOf(asOf: string): number {
  const instant = Date.parse(asOf);
  if (Number.isNaN(instant)) throw new DistrictPricingStateError(`as-of instant "${asOf}" is not a parseable date`);
  return instant;
}

/**
 * Every event key in `season` whose `events.start_date` is STRICTLY BEFORE
 * `asOf` — that is, every event that had already started at that instant.
 *
 * It no longer decides which matches enter the replay: that is
 * `playedMatchKeysAtOrAfter`'s job, keyed on each match's own timestamp. Its one
 * remaining caller is `underwayEventKeysAsOf`'s fallback for an event the
 * corpus holds no played match for, where a start date is the only as-of fact
 * there is.
 *
 * A NULL START DATE READS AS STARTED, which is the exact OPPOSITE of
 * `eventStillAhead`'s default, and the asymmetry is deliberate rather than an
 * oversight. `eventStillAhead` decides whether an event can still yield points
 * to a team, so it errs toward keeping a ceiling honest and assumes an unknown
 * date is ahead. This predicate answers "had this event begun", and for an
 * event whose rows are real, reading them as not yet begun would throw away
 * evidence.
 *
 * With `asOf` at or after every start date in the corpus the returned set is
 * every event key, so at the run's own clock it is an IDENTITY.
 */
export function startedEventKeysAsOf(db: Corpus, season: number, asOf: string): ReadonlySet<string> {
  const rows = db.prepare(`SELECT event_key, start_date FROM events WHERE year = ?`).all(season) as EventStartRow[];
  const instant = parseAsOf(asOf);
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

/**
 * THE WALK-FORWARD CUT: every PLAYED match of `season` whose `sort_time` is AT
 * OR AFTER `asOf`, which is to say every match an as-of replay must not see.
 *
 * Keyed on the MATCH's own timestamp, not on its event's start date. The
 * start-date rule this replaced admitted every match of an event that had
 * started before the instant, including the ones played after it. Measured
 * 2026-09-28 on the real corpus: 491 post-as-of 2026 matches across 6 events
 * entered an as-of 2026-03-05 replay, and 850 across 20 events entered an as-of
 * 2026-04-04 one. An instant inside an event's own window is exactly what a
 * mid-season verification run asks about, so that was a live leak.
 *
 * `sort_time` is epoch milliseconds, from `packages/ingest/normalize.ts`'s
 * `matchSortTime`: TBA's actual_time, then predicted_time, then time, then a
 * composite of the event's start date and the match's play order. The cut is
 * exact for a TBA-reported time and only approximate for the composite, which
 * stamps every timeless match of an event within about 70 minutes after its
 * start date's UTC midnight. Measured 2026-09-28: zero 2026 played matches carry
 * the composite.
 *
 * A match stamped EXACTLY at the instant is cut: only strictly-before is
 * admitted, matching `startedEventKeysAsOf`'s own `start < instant`.
 *
 * At the run's own clock the set is empty, because a played match's time is in
 * the past (measured 2026-09-28: zero played matches at or after the clock). So
 * a production run replays exactly the stream it replayed before this cut
 * existed, and `--as-of` stays the same code path as production.
 */
export function playedMatchKeysAtOrAfter(db: Corpus, season: number, asOf: string): ReadonlySet<string> {
  const instant = parseAsOf(asOf);
  const rows = db
    .prepare(
      `SELECT m.match_key AS match_key FROM matches m JOIN events e ON e.event_key = m.event_key
       WHERE e.year = ? AND m.winner IS NOT NULL AND m.sort_time >= ?`
    )
    .all(season, instant) as { match_key: string }[];
  return new Set(rows.map((row) => row.match_key));
}

/**
 * Every event of `season` that was UNDERWAY at `asOf`: it had a played match
 * stamped strictly before the instant, on `playedMatchKeysAtOrAfter`'s own
 * clock. The district bake reads a team's season-final district points at an
 * event as "already earned at the instant" only for an event in this set,
 * because points at an event exist only once a match there has been played.
 *
 * AN EVENT WITH NO PLAYED MATCH IN THE CORPUS falls back to its start date
 * (`startedEventKeysAsOf`), the only as-of fact the corpus holds for it. That
 * fallback is what keeps a production run unchanged if district points ever
 * arrive before the event's matches do: a points row always belongs to an
 * event that has started, so at the run's own clock every event carrying points
 * is in this set, exactly as the season-final rule counted it. Measured
 * 2026-09-28: all 148 2026 events carrying district points have played matches,
 * and none has a played match stamped before its own start date.
 */
export function underwayEventKeysAsOf(db: Corpus, season: number, asOf: string): ReadonlySet<string> {
  const instant = parseAsOf(asOf);
  const rows = db
    .prepare(
      `SELECT e.event_key AS event_key, MIN(m.sort_time) AS first_played
       FROM events e LEFT JOIN matches m ON m.event_key = e.event_key AND m.winner IS NOT NULL
       WHERE e.year = ? GROUP BY e.event_key`
    )
    .all(season) as { event_key: string; first_played: number | null }[];
  const started = startedEventKeysAsOf(db, season, asOf);
  const underway = new Set<string>();
  for (const row of rows) {
    const isUnderway = row.first_played === null ? started.has(row.event_key) : row.first_played < instant;
    if (isUnderway) underway.add(row.event_key);
  }
  return underway;
}

export interface BuildDistrictPricingStateOptions {
  /** The season whose events are to be priced. */
  readonly season: number;
  /** Seasons replayed BEFORE the target one, ascending. `[]` replays the target season cold. */
  readonly warmupSeasons: readonly number[];
  /** The instant the run is computed at. Every replayed season's stream keeps only the played matches stamped strictly before it (`playedMatchKeysAtOrAfter`). */
  readonly asOf: string;
  /** The resolved SPR algorithm — `resolveDistrictPricingAlgorithm`'s output, or a test's own module. */
  readonly algorithm: AlgorithmModule<any>;
  /**
   * The Sigma-carry CANDIDATE (`packages/harness/sigmaCarry.ts`), for verification only
   * (`publishDistricts --sigma-carry`, which refuses to run without `--dry-run`). `true`: every
   * replayed season folds a Sigma layer and carries it into the next, the target season's layer starts
   * from that carry, and `ratingsFor`/`predictFor` rate a team the replay never saw with the
   * candidate's rookie rule. Absent or `false`: exactly the incumbent path, byte for byte.
   */
  readonly sigmaCarry?: boolean;
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
  /** How many played matches the as-of cut dropped, summed across every replayed season. Zero at the run's own clock. */
  readonly matchesTruncated: number;
  /** `finalStates` — the state after the last replayed match. See this file's header. */
  readonly endState: unknown;
  /** The target season's layer, folded over the truncated played stream. */
  readonly layer: SigmaScoutLayer;
  /** The published SPR pair per roster team, in `allianceWinProbability`'s own input shape. A team the replay never rated is simply absent. */
  readonly ratingsFor: (roster: readonly string[]) => ReadonlyMap<string, AllianceMemberRating>;
  /** The bound `predict` a bake needs, or `undefined` when the all-or-nothing roster rule rejects this roster. */
  readonly predictFor: (roster: readonly string[]) => ((match: UpcomingMatch) => Prediction) | undefined;
  /** Whether the Sigma-carry candidate priced this state. `false` on every production path. */
  readonly sigmaCarry: boolean;
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
 * Replays `warmupSeasons` then `season`, with every season's stream cut to the
 * played matches stamped strictly before `asOf`, and returns everything a
 * district bake prices from.
 *
 * THE WALK-FORWARD BOUNDARY IS EACH MATCH'S OWN TIMESTAMP. No played match
 * stamped at or after `asOf` enters the replay, in any season, so the state
 * that prices an event holds nothing that happened after the instant: not
 * that event's own results, and not a concurrent event's either.
 *
 * THIS HEADER USED TO SAY "a leak is not expressible", and that did not hold.
 * The cut was keyed on the EVENT's start date, so an instant inside an event's
 * own window admitted every one of that event's matches, the ones played after
 * the instant included (measured 2026-09-28: 491 such 2026 matches at an as-of
 * of 2026-03-05, 850 at 2026-04-04). The boundary is now per match, and it is
 * a timestamp comparison, so it is only as exact as `sort_time` is: see
 * `playedMatchKeysAtOrAfter` for the timeless-match caveat and its measurement.
 *
 * Returns `null` when every replayed stream is empty — the honest "there is
 * nothing to price from" answer rather than a state fitted on no matches.
 */
export function buildDistrictPricingState(db: Corpus, options: BuildDistrictPricingStateOptions): DistrictPricingState | null {
  const { season, asOf, algorithm } = options;
  const sigmaCarryOn = options.sigmaCarry === true;
  const seasons = [...options.warmupSeasons].filter((s) => s < season).sort((a, b) => a - b);
  seasons.push(season);

  const coldStartIndex = corpusColdStartIndex(db);

  let carriedState: unknown;
  let endState: unknown;
  let layer: SigmaScoutLayer | undefined;
  let matchesReplayed = 0;
  let matchesTruncated = 0;
  /** The Sigma-carry candidate's carry into the next replayed season. Never set when the candidate is off. */
  let sigmaCarry: SigmaSeasonCarry | undefined;

  for (const [seasonIdx, s] of seasons.entries()) {
    const fullStream = buildSeasonStream(db, s, { includeOffseason: true });
    // EVERY season is cut, the warmup ones included. A warmup season sits
    // below the target season, but nothing stops an `asOf` from falling inside
    // one (`--as-of` only refuses the future), and an offseason event of the
    // prior year can run past such an instant. The cut costs nothing when it
    // removes nothing, which is every warmup season of an in-season run.
    const cut = playedMatchKeysAtOrAfter(db, s, asOf);
    const stream = cut.size === 0 ? fullStream : fullStream.filter((m) => !cut.has(m.matchKey));
    matchesTruncated += fullStream.length - stream.length;
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

    // Candidate only: the carry into this season, or none for the cold-start season (as SPR's own).
    const layerOptions = sigmaCarryOn ? { sigmaCarry: { from: boundary.isColdStart ? undefined : sigmaCarry } } : undefined;
    if (s === season) {
      // `finalStates`, not `carryStates` — see this file's header.
      endState = records.finalStates.get(algorithm.id);
      layer = new SigmaScoutLayer(RP_RULE_MODULES[s], algorithm.id, layerOptions);
      for (const record of records) {
        if (record.algorithmId !== algorithm.id) continue;
        layer.foldPlayed(record.match, record.prediction, talentAfterMatch.get(record.match.matchKey));
      }
    } else if (sigmaCarryOn) {
      // A warmup season folds a Sigma-only layer (no rule module: its ranking points are never read),
      // purely to hand the next season its carry. Sigma folding never reads the rule module, so the
      // carry is the one a full layer would hand over.
      const warmupLayer = new SigmaScoutLayer(undefined, algorithm.id, layerOptions);
      for (const record of records) {
        if (record.algorithmId !== algorithm.id) continue;
        warmupLayer.foldPlayed(record.match, record.prediction, talentAfterMatch.get(record.match.matchKey));
      }
      sigmaCarry = warmupLayer.sigmaCarryOut();
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

  /**
   * The candidate's rating for every roster team (`candidateRosterRatings`): the published total,
   * else what SPR's own `predict` assigns an unseen team; the layer's Sigma, else the prior-only Sigma
   * at that total. Only ever called with the candidate on.
   */
  const candidateRatings = (roster: readonly string[]) => {
    const metrics = algorithm.teamMetrics(resolvedState, [...roster]);
    const totalByTeam = new Map<string, number>();
    for (const teamKey of roster) {
      const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
      if (total !== undefined) totalByTeam.set(teamKey, total);
    }
    return candidateRosterRatings({
      roster,
      totalByTeam,
      unseenTotal: algorithm.unseenTeamMetrics?.(resolvedState)?.[TOTAL_METRIC_KEY]?.value,
      sigmaByTeam,
      priorSigmaAtTalent: (talent) => resolvedLayer.sigmaPriorAtTalent(talent),
    });
  };

  return {
    algorithmId: algorithm.id,
    algorithmVersion: algorithm.version,
    pricedFrom: "current-state",
    asOf,
    replayedSeasons: seasons,
    matchesReplayed,
    matchesTruncated,
    endState: resolvedState,
    layer: resolvedLayer,
    sigmaCarry: sigmaCarryOn,
    ratingsFor: (roster) => {
      const ratings = new Map<string, AllianceMemberRating>();
      if (sigmaCarryOn) {
        for (const [teamKey, rating] of candidateRatings(roster)) ratings.set(teamKey, { teamKey, total: rating.total, sigma: rating.sigma });
        return ratings;
      }
      const metrics = algorithm.teamMetrics(resolvedState, [...roster]);
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
        sigmaCarryOn ? candidateSigmaMap(candidateRatings(roster)) : sigmaByTeam,
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
