/**
 * BROWSER PRICING of upcoming SPR matches from an event's `state` block.
 *
 * DEPRECATED, WHOLE FILE, FOR QUICK TASK 260923-3w7. The `state` block is no
 * longer produced by anything: quick task 260923-3w6 reinstated the live
 * Worker's own upcoming pricing (`260923-1tu-FINDINGS.md` item C1), which is
 * what the block existed to avoid, and removed the publisher's emission of it.
 * This file survives only because the WEB still prices from a block
 * (`apps/web/src/lib/eventPricing.lazy.ts`) and because the parity tests still
 * use `buildEventStateBlock` as a wire fixture. 260923-3w7 deletes the web
 * pricing path, and this file goes with it. Do not add a caller.
 *
 * NOT deprecated, and NOT going with it: `stateBlockScopeKeys`, which is the
 * live tick's D1 read-key rule (every roster key, plus SPR's demo pseudo team)
 * and has nothing to do with blocks beyond having been written for one. Whatever
 * deletes this file must move that function, not drop it.
 *
 * The offline publisher prices every scheduled match with
 * `SigmaScoutLayer.enrichUpcoming`; this module reproduces those published
 * rows from the state that layer and SPR end the replay with. The pricing
 * ARITHMETIC lives in `upcomingPricing.ts`, shared with the live Worker; what
 * is left here is the block's own validation and deserialization.
 *
 * WHAT IT SHARES. `spr.predict`, `RpMomentsAccumulator.fromBeliefs`,
 * `RpMeanShiftAccumulator.fromState`, the state readers in `stateSnapshot.ts`,
 * and `priceUpcomingRows` itself.
 *
 * UNSEEN TEAMS FOLLOW THE OFFLINE RULE: a roster team with no Sigma belief
 * gives its alliance no band, and the match no RP (both variances are needed).
 * Never the Worker's price-from-prior (`SigmaScoreAccumulator.bandVarianceFor`).
 * That rule now lives in `upcomingPricing.ts`, structurally: this file passes
 * `scoreByTeam()`, never an accessor that invents a prior.
 *
 * BROWSER-SAFE: never import `publish.ts`, `rules.ts`, a per-season RP file,
 * `sigmaScoutLayer.ts`, `replay.ts` or anything under `packages/corpus`. The
 * RP rule module is injected (`rulesLoader.ts` loads one season at a time).
 * `eventStatePricing.browserSafe.test.ts` guards the import graph.
 */
import { spr, type SprState } from "../core/algorithms/spr.js";
import { DEMO_PSEUDO_TEAM_KEY, isDemoTeamKey } from "../core/algorithms/demoTeams.js";
import type { RpRuleModule } from "../core/rankingPoints/constants.js";
import { RpMomentsAccumulator } from "../core/rankingPoints/empiricalMoments.js";
import { RpMeanShiftAccumulator } from "../core/rankingPoints/meanShift.js";
import { publishesRankingPoints, SigmaScoreAccumulator, usesSigmaScore } from "./sigmaScore.js";
import {
  deserializeState,
  readRpBeliefs,
  readRpMeanShift,
  readSigmaBeliefs,
  readSigmaPopulation,
  STATE_SNAPSHOT_SHAPE_VERSION,
  type StateRow,
} from "./stateSnapshot.js";
import { type EventStateBlock, type EventStateBlockRow } from "./pageArtifacts.js";
import { priceUpcomingRows, type PriceUpcomingResult, type ScheduledMatchInput } from "./upcomingPricing.js";

// Re-exported unchanged so `apps/web/src/lib/eventPricing.lazy.ts` and the
// parity tests keep importing them from here while this file still exists.
export type { PriceUpcomingResult, ScheduledMatchInput } from "./upcomingPricing.js";

/** Thrown when a state block breaks an invariant, at build or at read time. A consumer falls back to the published fields. */
export class EventStateBlockError extends Error {
  constructor(message: string) {
    super(`event state block: ${message}`);
    this.name = "EventStateBlockError";
  }
}

/** Thrown when the injected RP rule module is for another season: `RpMeanShiftAccumulator.fromState` would silently discard the shift. */
export class RpRuleModuleSeasonMismatchError extends Error {
  constructor(
    readonly moduleSeason: number,
    readonly season: number
  ) {
    super(`priceUpcomingFromState: RP rule module is for season ${moduleSeason}, but the event is season ${season}`);
    this.name = "RpRuleModuleSeasonMismatchError";
  }
}

/**
 * The scope keys a block must carry for these rosters: every key, plus
 * `DEMO_PSEUDO_TEAM_KEY` when any key is a demo key, because `spr.predict`
 * remaps demo robots to that pseudo team. Sorted and de-duplicated.
 */
export function stateBlockScopeKeys(teamKeys: Iterable<string>): string[] {
  const keys = new Set<string>();
  for (const teamKey of teamKeys) {
    keys.add(teamKey);
    if (isDemoTeamKey(teamKey)) keys.add(DEMO_PSEUDO_TEAM_KEY);
  }
  return [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function copyRow(row: StateRow, scopeKind: "league" | "team"): EventStateBlockRow {
  return {
    algorithmId: row.algorithmId,
    algorithmVersion: row.algorithmVersion,
    scopeKind,
    scopeKey: row.scopeKey,
    stateJson: row.stateJson,
    generation: row.generation,
    computedAt: row.computedAt,
  };
}

function shapeVersionOf(leagueRow: { stateJson: string }): unknown {
  try {
    return (JSON.parse(leagueRow.stateJson) as { snapshotShapeVersion?: unknown }).snapshotShapeVersion;
  } catch {
    throw new EventStateBlockError("the league row's stateJson does not parse");
  }
}

/**
 * The `state` block for one event: the league row, then the team rows whose
 * key is in `stateBlockScopeKeys(teamKeys)` by ascending key. Rows are copied
 * field for field, never re-stringified; event rows are ignored. A key with no
 * row is skipped, so that team prices as a fresh SPR team on both sides.
 *
 * Throws `EventStateBlockError` unless there is exactly one league row, every
 * row shares one algorithm id and version, the id is `spr`, and the league
 * row declares `STATE_SNAPSHOT_SHAPE_VERSION`.
 *
 * NO PRODUCTION CALLER SINCE QUICK TASK 260923-3w6. The publisher stopped
 * emitting blocks and the live tick stopped maintaining them; this is now a TEST
 * FIXTURE BUILDER, kept because the parity suites still send a block over the
 * wire to prove the web pricer reproduces the publisher. It goes with the rest of
 * this file in 260923-3w7.
 */
export function buildEventStateBlock(rows: readonly StateRow[], teamKeys: Iterable<string>): EventStateBlock {
  const leagueRows = rows.filter((row) => row.scopeKind === "league");
  if (leagueRows.length !== 1) throw new EventStateBlockError(`expected exactly one league row, found ${leagueRows.length}`);
  const league = leagueRows[0]!;

  const wanted = new Set(stateBlockScopeKeys(teamKeys));
  const teamRows = rows
    .filter((row) => row.scopeKind === "team" && wanted.has(row.scopeKey))
    .sort((a, b) => (a.scopeKey < b.scopeKey ? -1 : a.scopeKey > b.scopeKey ? 1 : 0));

  const selected = [league, ...teamRows];
  for (const row of selected) {
    if (row.algorithmId !== league.algorithmId || row.algorithmVersion !== league.algorithmVersion) {
      throw new EventStateBlockError(
        `row ${row.scopeKind}:${row.scopeKey} is ${row.algorithmId}@${row.algorithmVersion}, league row is ${league.algorithmId}@${league.algorithmVersion}`
      );
    }
  }
  if (league.algorithmId !== spr.id) throw new EventStateBlockError(`algorithm "${league.algorithmId}" is not "${spr.id}"`);

  const snapshotShapeVersion = shapeVersionOf(league);
  if (snapshotShapeVersion !== STATE_SNAPSHOT_SHAPE_VERSION) {
    throw new EventStateBlockError(
      `snapshotShapeVersion ${JSON.stringify(snapshotShapeVersion)} is not ${STATE_SNAPSHOT_SHAPE_VERSION}`
    );
  }

  return {
    algorithmId: league.algorithmId,
    algorithmVersion: league.algorithmVersion,
    snapshotShapeVersion,
    rows: [copyRow(league, "league"), ...teamRows.map((row) => copyRow(row, "team"))],
  };
}

export interface PriceUpcomingInput {
  readonly state: EventStateBlock;
  readonly eventKey: string;
  readonly season: number;
  /** TBA's `event_type` for the event; it gates RP eligibility. */
  readonly eventType: number;
  /** The season's RP rules, or `undefined` for a season without them (bands still price; RP does not appear). */
  readonly ruleModule: RpRuleModule | undefined;
  readonly upcoming: readonly ScheduledMatchInput[];
}

/** Re-checks the block invariants a structural schema parse cannot. */
function assertPriceableBlock(state: EventStateBlock): void {
  if (state.algorithmId !== spr.id) throw new EventStateBlockError(`algorithm "${state.algorithmId}" is not "${spr.id}"`);
  if (state.algorithmVersion !== spr.version) {
    throw new EventStateBlockError(`algorithmVersion "${state.algorithmVersion}" is not the bundled "${spr.version}"`);
  }
  if (state.snapshotShapeVersion !== STATE_SNAPSHOT_SHAPE_VERSION) {
    throw new EventStateBlockError(`snapshotShapeVersion ${state.snapshotShapeVersion} is not ${STATE_SNAPSHOT_SHAPE_VERSION}`);
  }
  const leagueRows = state.rows.filter((row) => row.scopeKind === "league");
  if (leagueRows.length !== 1) throw new EventStateBlockError(`expected exactly one league row, found ${leagueRows.length}`);
  for (const row of state.rows) {
    if (row.algorithmId !== state.algorithmId || row.algorithmVersion !== state.algorithmVersion) {
      throw new EventStateBlockError(
        `row ${row.scopeKind}:${row.scopeKey} is ${row.algorithmId}@${row.algorithmVersion}, block is ${state.algorithmId}@${state.algorithmVersion}`
      );
    }
  }
  if (shapeVersionOf(leagueRows[0]!) !== STATE_SNAPSHOT_SHAPE_VERSION) {
    throw new EventStateBlockError(`the league row does not declare snapshotShapeVersion ${STATE_SNAPSHOT_SHAPE_VERSION}`);
  }
}

/**
 * Prices every upcoming match from the block, returning the rows the offline
 * publisher would publish for the same state. Throws `EventStateBlockError`
 * for a block that breaks an invariant and `RpRuleModuleSeasonMismatchError`
 * for a rule module from another season.
 *
 * THE PRICING LOOP ITSELF LIVES IN `upcomingPricing.ts` since quick task
 * 260923-3w6, because the live Worker prices upcoming matches again and does it
 * from in-memory accumulators rather than from a wire copy of D1. This function
 * is now exactly the block half: validate the block, deserialize it into a
 * model, and hand that model to the shared pricer. Both callers therefore run
 * byte-identical arithmetic by construction rather than by review.
 */
export function priceUpcomingFromState(input: PriceUpcomingInput): PriceUpcomingResult {
  const { state: block, eventKey, season, eventType, ruleModule } = input;
  assertPriceableBlock(block);
  if (ruleModule !== undefined && ruleModule.season !== season) {
    throw new RpRuleModuleSeasonMismatchError(ruleModule.season, season);
  }

  const rows: readonly StateRow[] = block.rows;
  const state = deserializeState(spr.id, rows) as SprState;

  // Scored once per call: exactly the block teams with a belief, the key set offline `sigmaScoreByTeam()` gives each roster.
  const sigmaScores = usesSigmaScore(block.algorithmId)
    ? SigmaScoreAccumulator.fromBeliefs(readSigmaBeliefs(rows), readSigmaPopulation(rows)).scoreByTeam()
    : undefined;

  const rankingPoints = publishesRankingPoints(block.algorithmId) && ruleModule !== undefined;
  const rp = rankingPoints ? RpMomentsAccumulator.fromBeliefs(ruleModule, readRpBeliefs(rows)) : undefined;
  const shift = rankingPoints ? RpMeanShiftAccumulator.fromState(ruleModule, readRpMeanShift(rows)) : undefined;

  return priceUpcomingRows({
    // `assertPriceableBlock` already proved the block is `spr` at the BUNDLED
    // version, so the bundled module is the only admissible pricer here.
    model: { algorithm: spr, state, sigmaScores, ruleModule, rp, shift },
    eventKey,
    season,
    eventType,
    upcoming: input.upcoming,
  });
}
