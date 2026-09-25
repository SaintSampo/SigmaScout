/**
 * THE ONE SEAM that yields, per played match, the two PUBLISHED per-team
 * numbers a visitor's browser would have had in hand just before that match:
 * `metrics["total"].value` and `metrics["sigma"].value`.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS ONE MODULE AND NOT A LOOP PER CONSUMER
 * ---------------------------------------------------------------------------
 *
 * `scripts/measureAllianceWinProbability.ts` (the win-probability gap) and
 * `scripts/measureSelectionAgreement.ts` (the pick-order half) both need "the
 * number the browser sees". Two replays would be two chances to get the
 * walk-forward ordering wrong and two definitions that merely happen to agree.
 * One seam means one ordering to get right.
 *
 * ---------------------------------------------------------------------------
 * WALK-FORWARD BY CONSTRUCTION: READ, EMIT, THEN ADVANCE
 * ---------------------------------------------------------------------------
 *
 * Per match, in exactly this order:
 *
 *   1. Call `SigmaScoutLayer.foldPlayed` and collect this match's AFTER values
 *      — `total` from the `onMatchComplete` capture of
 *      `algorithm.teamMetrics(state, involvedTeams)`, `sigma` from
 *      `layer.sigmaFor(team)` read after the fold. `foldPlayed` writes nothing
 *      into the snapshot maps, so they still stand exactly as they did before
 *      this match.
 *   2. READ the maps as they stand — that read is the emitted snapshot.
 *   3. Only THEN advance the maps with the after values from step 1.
 *
 * Steps 2 and 3 are the single exported helper `beforeMatchSnapshot`, whose
 * body does the whole read before the first write, so the leak test in
 * `measureAllianceWinProbability.test.ts` drives the production sequencing
 * rather than a re-statement of it.
 *
 * So a team's value in any emitted snapshot comes from its most recently
 * played match STRICTLY BEFORE this one, which is precisely what a published
 * event artifact carries for that team, and a first-appearance team is simply
 * ABSENT from the map rather than defaulted.
 *
 * The machinery is the same machinery `scripts/measureMatchBandCoverage.ts`
 * drives and `packages/harness/publish.ts` ships: `buildSeasonStream` with
 * offseason included, `corpusColdStartIndex`, `resolvePublishAlgorithms`
 * filtered to Sigma algorithms by `usesSigmaScore`, `seasonBoundaryFor` plus
 * `carrySeason` threading, one `WalkForwardSimulator(...).runAll(...)` per
 * season, and one fresh `SigmaScoutLayer(RP_RULE_MODULES[season], id)` per
 * season. Warmup seasons are replayed and their rows are NOT emitted.
 *
 * ---------------------------------------------------------------------------
 * CREDENTIAL-FREE AND OFFLINE
 * ---------------------------------------------------------------------------
 *
 * This module opens no file, makes no network request and reads no environment
 * variable. The caller owns the corpus handle and closes it.
 */
import { buildSeasonStream, WalkForwardSimulator } from "../packages/harness/replay.js";
import type { MultiAlgorithmPredictionRecord } from "../packages/harness/replay.js";
import { corpusColdStartIndex } from "../packages/harness/corpusColdStart.js";
import { resolvePublishAlgorithms } from "../packages/harness/publish.js";
import { seasonBoundaryFor } from "../packages/harness/seasonBoundary.js";
import { SigmaScoutLayer } from "../packages/harness/sigmaScoutLayer.js";
import { usesSigmaScore } from "../packages/harness/sigmaScore.js";
import { RP_RULE_MODULES } from "../packages/core/rankingPoints/rules.js";
import { TOTAL_METRIC_KEY } from "../packages/core/algorithms/types.js";
import type { AlgorithmModule, MatchResult, Prediction } from "../packages/core/algorithms/types.js";
import type { AllianceMemberRating } from "../packages/core/algorithms/simulation/allianceWinProbability.js";
import type { Corpus } from "../packages/corpus/db.js";

/** One team's two published numbers as of some point in the replay. Either may be absent. */
export interface PublishedTeamSnapshot {
  readonly total: number | undefined;
  readonly sigma: number | undefined;
}

/** The running maps. Mutated only by `beforeMatchSnapshot`'s advance half. */
export interface SnapshotState {
  readonly total: Map<string, number>;
  readonly sigma: Map<string, number>;
}

export function emptySnapshotState(): SnapshotState {
  return { total: new Map(), sigma: new Map() };
}

/**
 * READ then ADVANCE, in that order — the whole walk-forward guarantee of this
 * module, in one pure function so a test can drive it directly.
 *
 * Returns the BEFORE-match snapshot for `teams` (built from the maps as they
 * stand on entry), and only then writes `afterTotals`/`afterSigmas` into the
 * maps. A team with no prior played match is absent from both maps and its
 * snapshot carries `undefined` for both fields.
 */
export function beforeMatchSnapshot(
  state: SnapshotState,
  teams: readonly string[],
  afterTotals: ReadonlyMap<string, number> | undefined,
  afterSigmas: ReadonlyMap<string, number> | undefined
): ReadonlyMap<string, PublishedTeamSnapshot> {
  const before = new Map<string, PublishedTeamSnapshot>();
  for (const teamKey of teams) {
    before.set(teamKey, { total: state.total.get(teamKey), sigma: state.sigma.get(teamKey) });
  }
  // ── everything below this line is the ADVANCE half; nothing above may read it ──
  if (afterTotals !== undefined) {
    for (const [teamKey, total] of afterTotals) {
      if (Number.isFinite(total)) state.total.set(teamKey, total);
    }
  }
  if (afterSigmas !== undefined) {
    for (const [teamKey, sigma] of afterSigmas) {
      if (Number.isFinite(sigma)) state.sigma.set(teamKey, sigma);
    }
  }
  return before;
}

/** One emitted row: the match, its prediction record fields, and the before-match snapshot. */
export interface PublishedSprSnapshotRow {
  readonly season: number;
  readonly algorithmId: string;
  readonly match: MatchResult;
  readonly prediction: Prediction;
  /** Present only when `true` — `pRedWin` was forced to exactly 0.5 and is not a prediction to compare against. */
  readonly coldStart?: true;
  /** Every involved team's `total`/`sigma` as of its most recently played match BEFORE this one. */
  readonly before: ReadonlyMap<string, PublishedTeamSnapshot>;
}

/**
 * Reads a roster's before-match snapshot into the alliance pricer's input
 * array, so "the number the browser sees" has one definition on both the
 * measurement side and the consumption side.
 */
export function ratingsFromSnapshot(
  roster: readonly string[],
  before: ReadonlyMap<string, PublishedTeamSnapshot>
): AllianceMemberRating[] {
  return roster.map((teamKey) => {
    const snapshot = before.get(teamKey);
    return { teamKey, total: snapshot?.total, sigma: snapshot?.sigma };
  });
}

export interface PublishedSprSnapshotOptions {
  /** Seasons whose rows are EMITTED. */
  readonly seasons: readonly number[];
  /** Replay from here forward without emitting, so the first reported season is not scored cold. */
  readonly warmupFrom?: number;
  /** Default true, matching `publish:seasons`. */
  readonly includeOffseason?: boolean;
  /** Default `"spr"`. Filtered to Sigma algorithms; a non-Sigma id yields no rows. */
  readonly algorithms?: string;
}

export interface PublishedSprSnapshotSummary {
  readonly replayedSeasons: number[];
  readonly warmupSeasons: number[];
  readonly emittedRows: number;
  readonly algorithmIds: string[];
}

/**
 * The seasons to replay, in order: from the warmup season (or the first
 * reported season, if that is earlier) through the last reported season.
 * Seasons with no matches are dropped at stream-build time, so a gapped corpus
 * (no 2021) still carries across the gap. Same rule as
 * `measureMatchBandCoverage.ts`'s `replaySeasons`, restated rather than
 * imported so this module has no dependency on a report script.
 */
export function replaySeasons(reported: readonly number[], warmupFrom: number | undefined): number[] {
  if (reported.length === 0) return [];
  const sorted = [...reported].sort((a, b) => a - b);
  const first = warmupFrom === undefined ? sorted[0]! : Math.min(warmupFrom, sorted[0]!);
  const last = sorted[sorted.length - 1]!;
  const out: number[] = [];
  for (let s = first; s <= last; s++) out.push(s);
  return out;
}

/**
 * Replays the requested window and hands every emitted row to `onRow` in
 * chronological order. The caller owns `db` and closes it.
 */
export function replayPublishedSprSnapshots(
  db: Corpus,
  options: PublishedSprSnapshotOptions,
  onRow: (row: PublishedSprSnapshotRow) => void
): PublishedSprSnapshotSummary {
  const includeOffseason = options.includeOffseason ?? true;
  const reportedSet = new Set(options.seasons);
  const seasons = replaySeasons(options.seasons, options.warmupFrom);
  const algorithms = resolvePublishAlgorithms(options.algorithms ?? "spr").filter((a) => usesSigmaScore(a.id)) as AlgorithmModule<
    unknown
  >[];

  const replayedSeasons: number[] = [];
  const warmupSeasons: number[] = [];
  const algorithmIds = algorithms.map((a) => a.id);
  let emittedRows = 0;
  if (algorithms.length === 0) return { replayedSeasons, warmupSeasons, emittedRows, algorithmIds };

  const coldStartIndex = corpusColdStartIndex(db);
  const snapshotByAlgorithm = new Map<string, SnapshotState>();
  for (const algorithm of algorithms) snapshotByAlgorithm.set(algorithm.id, emptySnapshotState());

  const replayed: number[] = [];
  let carryStates: ReadonlyMap<string, unknown> | undefined;

  for (const season of seasons) {
    const stream = buildSeasonStream(db, season, { includeOffseason });
    if (stream.length === 0) continue;
    replayed.push(season);
    replayedSeasons.push(season);
    const counted = reportedSet.has(season);
    if (!counted) warmupSeasons.push(season);

    const boundary = seasonBoundaryFor(replayed, replayed.length - 1);
    let initialStates: ReadonlyMap<string, unknown> | undefined;
    if (!boundary.isColdStart && carryStates !== undefined) {
      const carried = new Map<string, unknown>();
      for (const algorithm of algorithms) {
        const prior = carryStates.get(algorithm.id);
        if (algorithm.carrySeason && prior !== undefined) carried.set(algorithm.id, algorithm.carrySeason(prior, boundary));
      }
      initialStates = carried;
    }

    const byId = new Map(algorithms.map((a) => [a.id, a]));
    const talentAfterMatch = new Map<string, Map<string, Map<string, number>>>();
    for (const algorithm of algorithms) talentAfterMatch.set(algorithm.id, new Map());
    const onMatchComplete = (match: MatchResult, algorithmId: string, state: unknown): void => {
      const algorithm = byId.get(algorithmId);
      if (!algorithm || !usesSigmaScore(algorithmId)) return;
      const involvedTeams = [...match.redTeams, ...match.blueTeams];
      const metrics = algorithm.teamMetrics(state, involvedTeams);
      const talent = new Map<string, number>();
      for (const teamKey of involvedTeams) {
        const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
        if (total !== undefined) talent.set(teamKey, total);
      }
      talentAfterMatch.get(algorithmId)!.set(match.matchKey, talent);
    };

    const teams = [...new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
    const records = new WalkForwardSimulator(stream, coldStartIndex).runAll(algorithms, teams, initialStates, onMatchComplete);
    carryStates = records.carryStates;

    for (const algorithm of algorithms) {
      const layer = new SigmaScoutLayer(RP_RULE_MODULES[season], algorithm.id);
      const state = snapshotByAlgorithm.get(algorithm.id)!;
      const algoRecords: MultiAlgorithmPredictionRecord[] = records.filter((r) => r.algorithmId === algorithm.id);
      const talentMap = talentAfterMatch.get(algorithm.id)!;

      for (const record of algoRecords) {
        const match = record.match;
        const involvedTeams = [...match.redTeams, ...match.blueTeams];

        // `foldPlayed` is called first only to COMPUTE this match's after-values.
        // It writes nothing into `state`, so the snapshot maps are still exactly
        // as they stood before this match when `beforeMatchSnapshot` reads them
        // below; that function does the read and only then the advance.
        layer.foldPlayed(match, record.prediction, talentMap.get(match.matchKey));
        const afterSigmas = new Map<string, number>();
        for (const teamKey of involvedTeams) {
          const sigma = layer.sigmaFor(teamKey);
          if (sigma !== undefined) afterSigmas.set(teamKey, sigma);
        }
        const before = beforeMatchSnapshot(state, involvedTeams, talentMap.get(match.matchKey), afterSigmas);

        if (!counted) continue;
        emittedRows++;
        onRow({
          season,
          algorithmId: algorithm.id,
          match,
          prediction: record.prediction,
          ...(record.coldStart ? { coldStart: true as const } : {}),
          before,
        });
      }
    }
  }

  return { replayedSeasons, warmupSeasons, emittedRows, algorithmIds };
}
