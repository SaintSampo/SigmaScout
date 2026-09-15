/**
 * BROWSER PRICING of upcoming SPR matches from an event's `state` block.
 *
 * The offline publisher prices every scheduled match with
 * `SigmaScoutLayer.enrichUpcoming`; this module reproduces those published
 * rows from the state that layer and SPR end the replay with, so a page can
 * price the remaining schedule itself instead of the Worker tick doing it.
 * Ratings stay precomputed: the browser only evaluates the forecast.
 *
 * WHAT IT SHARES. Every primitive is the shared function: `spr.predict`,
 * `allianceSigmaBandVariance`, `sigmaMatchBandVariance`,
 * `RpMomentsAccumulator.fromBeliefs`/`momentsFor`,
 * `RpMeanShiftAccumulator.fromState`/`apply`, `rosterIsFullyWarm`,
 * `analyticRpPmf`, the state readers in `stateSnapshot.ts` and the row
 * builders in `publishedRows.ts`.
 *
 * WHAT IT MIRRORS. The level-2 read path below (the alliance band and the RP
 * fields) mirrors `SigmaScoutLayer.enrichUpcoming`, `#matchBandFields` and
 * `#rpFieldsFor` statement for statement. It is not extracted from there
 * because `sigmaScoutLayer.bandGuard.test.ts` pins `#rpFieldsFor`'s guard as
 * source text inside `sigmaScoutLayer.ts`. `eventStatePricing.parity.test.ts`
 * fails on any drift between the two.
 *
 * UNSEEN TEAMS FOLLOW THE OFFLINE RULE: a roster team with no Sigma belief
 * gives its alliance no band, and the match no RP (both variances are needed).
 * Never the Worker's price-from-prior (`SigmaScoreAccumulator.bandVarianceFor`).
 *
 * BROWSER-SAFE: never import `publish.ts`, `rules.ts`, a per-season RP file,
 * `sigmaScoutLayer.ts`, `replay.ts` or anything under `packages/corpus`. The
 * RP rule module is injected (`rulesLoader.ts` loads one season at a time).
 * `eventStatePricing.browserSafe.test.ts` guards the import graph.
 */
import type { CompLevel, Prediction, UpcomingMatch } from "../core/algorithms/types.js";
import { spr, type SprState } from "../core/algorithms/spr.js";
import { DEMO_PSEUDO_TEAM_KEY, isDemoTeamKey } from "../core/algorithms/demoTeams.js";
import { isRpEligibleEventType, type RpRuleModule } from "../core/rankingPoints/constants.js";
import { RpMomentsAccumulator } from "../core/rankingPoints/empiricalMoments.js";
import { RpMeanShiftAccumulator, rosterIsFullyWarm } from "../core/rankingPoints/meanShift.js";
import { analyticRpPmf } from "../core/rankingPoints/analyticPmf.js";
import {
  allianceSigmaBandVariance,
  publishesRankingPoints,
  SigmaScoreAccumulator,
  sigmaMatchBandVariance,
  usesSigmaScore,
} from "./sigmaScore.js";
import {
  deserializeState,
  readRpBeliefs,
  readRpMeanShift,
  readSigmaBeliefs,
  readSigmaPopulation,
  STATE_SNAPSHOT_SHAPE_VERSION,
  type StateRow,
} from "./stateSnapshot.js";
import { EventUpcomingMatchSchema, type EventStateBlock, type EventStateBlockRow, type EventUpcomingMatch } from "./pageArtifacts.js";
import { eventUpcomingRow } from "./publishedRows.js";

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

/** One not-yet-played match, schedule fields only: nothing a pricer could leak an outcome through. */
export interface ScheduledMatchInput {
  readonly matchKey: string;
  readonly compLevel: CompLevel;
  readonly setNumber: number;
  readonly matchNumber: number;
  readonly sortTime?: number;
  readonly redTeams: readonly string[];
  readonly blueTeams: readonly string[];
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

export interface PriceUpcomingResult {
  /** `EventArtifact.upcoming` rows, in input order. */
  readonly event: EventUpcomingMatch[];
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

  const event: EventUpcomingMatch[] = [];
  for (const scheduled of input.upcoming) {
    // No pricing path reads `week` or the surrogates; the parity test's offline arm uses the real values.
    const match: UpcomingMatch = {
      matchKey: scheduled.matchKey,
      eventKey,
      compLevel: scheduled.compLevel,
      setNumber: scheduled.setNumber,
      matchNumber: scheduled.matchNumber,
      redTeams: scheduled.redTeams,
      blueTeams: scheduled.blueTeams,
      redSurrogates: [],
      blueSurrogates: [],
      eventType,
      week: null,
    };
    const prediction = spr.predict(state, match);

    // --- MIRROR of SigmaScoutLayer.enrichUpcoming ---
    const redVariance = sigmaScores === undefined ? undefined : allianceSigmaBandVariance(match.redTeams, sigmaScores);
    const blueVariance = sigmaScores === undefined ? undefined : allianceSigmaBandVariance(match.blueTeams, sigmaScores);

    // --- MIRROR of SigmaScoutLayer.#rpFieldsFor ---
    let rpFields: Partial<Prediction> = {};
    if (
      prediction.redRpPmf === undefined &&
      rp !== undefined &&
      ruleModule !== undefined &&
      shift !== undefined &&
      isRpEligibleEventType(match.eventType) &&
      redVariance !== undefined &&
      blueVariance !== undefined
    ) {
      const red = rp.momentsFor(match.redTeams, prediction.redScore, redVariance);
      const blue = rp.momentsFor(match.blueTeams, prediction.blueScore, blueVariance);
      const pmf = analyticRpPmf({
        red: shift.apply(red, rosterIsFullyWarm(rp, match.redTeams)),
        blue: shift.apply(blue, rosterIsFullyWarm(rp, match.blueTeams)),
        ruleModule,
        eventType: match.eventType,
        compLevel: match.compLevel,
        pRedWin: prediction.pRedWin,
      });
      const decomposition: Partial<Prediction> =
        pmf.outcome !== undefined && pmf.redBonusPmf !== undefined && pmf.blueBonusPmf !== undefined
          ? {
              matchOutcomePmf: [pmf.outcome.pRedWin, pmf.outcome.pTie, pmf.outcome.pBlueWin],
              redOutcomeRp: [pmf.outcome.winRp, pmf.outcome.tieRp, 0],
              blueOutcomeRp: [0, pmf.outcome.tieRp, pmf.outcome.winRp],
              redBonusRpPmf: pmf.redBonusPmf,
              blueBonusRpPmf: pmf.blueBonusPmf,
            }
          : {};
      rpFields = {
        redRpPmf: pmf.redPmf,
        blueRpPmf: pmf.bluePmf,
        ...(pmf.redBonusProbabilities !== undefined ? { redBonusRp: pmf.redBonusProbabilities } : {}),
        ...(pmf.blueBonusProbabilities !== undefined ? { blueBonusRp: pmf.blueBonusProbabilities } : {}),
        ...decomposition,
      };
    }

    // --- MIRROR of SigmaScoutLayer.#matchBandFields ---
    let matchBand: { red?: number; blue?: number } | undefined;
    if (sigmaScores !== undefined) {
      const red = sigmaMatchBandVariance(match.redTeams.length, redVariance);
      const blue = sigmaMatchBandVariance(match.blueTeams.length, blueVariance);
      if (red !== undefined || blue !== undefined) {
        matchBand = { ...(red !== undefined ? { red } : {}), ...(blue !== undefined ? { blue } : {}) };
      }
    }

    const record = {
      match,
      prediction: { ...prediction, ...rpFields },
      ...(matchBand !== undefined ? { matchBand } : {}),
    };
    event.push(EventUpcomingMatchSchema.parse(eventUpcomingRow(record, scheduled.sortTime)));
  }
  return { event };
}
