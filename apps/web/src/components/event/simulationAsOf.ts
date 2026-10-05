/**
 * THE SIMULATION TAB'S SPR REWIND, AS OF THE START MATCH (quick task
 * 261005-5g0, Part 4). When the reader starts the simulation at a match the
 * event has already played, the stored per row predictions after it were each
 * made after the results before them were folded in, so the run would know
 * results it is pretending have not happened. For SPR this module rebuilds the
 * model as it stood just before the start match instead, from the published
 * as-of objects, and names the rows the Worker prices from that one state
 * (`simulationAsOfJob.ts`). Nothing here reads a stored prediction.
 *
 * THE CUT (`asOfCutBeforeMatch`), just before the start match:
 *
 *   - the start is the event's row `i > 0` in its own fold order: the cut is
 *     row `i - 1`. An exact instant, everything at or before that row in the
 *     season stream. Another event's rows between `i - 1` and the start are not
 *     in it: no published object names the season's last row before a later
 *     row of an event, so that instant cannot be rebuilt, and the row before is
 *     the closest exact one.
 *   - the start is the event's FIRST row: the cut is everything strictly before
 *     it in the season stream. Every team resolves through its segments here
 *     (its first segment's `s`, or the walk through `p`), and the league is the
 *     INDEX's `lb`, the row the season held just before it. An INDEX without
 *     `lb` (written before the field existed) cannot price that cut and falls
 *     back.
 *   - the start is not in the INDEX (a scheduled row ordered before a played
 *     one, or an INDEX behind the artifact): there is no instant to rebuild at,
 *     and the run falls back.
 *
 * REMAINING AND BASELINES use the one as-of order (`asOfQualSplit`, the Locks
 * tabs' own split): every qualification row not at or before the cut is
 * priced, folded rows by their INDEX row and then rows not folded yet; the
 * baseline is the summed actual RP of the rows at or before the cut, exactly as
 * `buildSimulationInputs`' rewind path sums it.
 *
 * FALLBACK. Any as-of object unpublished (a fetch answers `null`), an artifact
 * with no event type, a walk that cannot finish, or a copy `resolveAsOf`
 * reports out of step with another (a LOG older than its INDEX, a season
 * object behind an INDEX) that is STILL out of step after one fresh refetch:
 * the run uses the stored rows, which is today's behaviour. A fetch that FAILS
 * (an outage, a bad body) throws, and the run shows its error state.
 */
import { asOfCutBeforeMatch, AsOfResolveError, resolveAsOf } from "../../../../../packages/harness/asOfLookup.js";
import type { AsOfCut, AsOfIndex, AsOfLog, AsOfSeason } from "../../../../../packages/harness/asOfState.js";
import type { SimTeamBaseline } from "../../../../../packages/core/algorithms/simulation/rankSimulation.js";
import type { EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { SimulationAsOfBlock } from "../../workers/simulationAsOfJob.js";
import { asOfCutId, AsOfObjectSet, asOfQualSplit, asOfStaleObjectIds, type AsOfFetchers } from "../districts/asOfRewind.js";

/** The one algorithm whose as-of state is published: the layer prices ranking points for it, and the wire format describes its state. */
export const SIMULATION_AS_OF_ALGORITHM_ID = "spr";

/** Whether a start match takes the as-of path: an SPR artifact and a rewind start. EPA and OPR, and a forward start, never do. */
export function usesSimulationAsOf(algorithmId: string, isRewindStart: boolean): boolean {
  return algorithmId === SIMULATION_AS_OF_ALGORITHM_ID && isRewindStart;
}

export interface SimulationAsOfReady {
  readonly status: "ready";
  /** `asOfRewind.ts` `asOfCutId` of the cut. */
  readonly cutId: string;
  readonly block: SimulationAsOfBlock;
  readonly baselines: readonly SimTeamBaseline[];
  /** Teams with a played row at or before the cut whose actual RP is not recorded, sorted. */
  readonly incompleteBaselineTeamKeys: readonly string[];
}

export type SimulationAsOfPlan = SimulationAsOfReady | { readonly status: "fallback"; readonly reason: string };

/** An upper bound on fetch rounds, as `asOfRewind.ts` bounds its own: each round fetches everything the last resolve named. */
const MAX_RESOLVE_ROUNDS = 32;

/** The event's played qualification rows at or before the cut whose actual RP is not a number: their teams' baselines are known incomplete. */
function incompleteAtCut(artifact: EventArtifact, index: AsOfIndex, cut: AsOfCut): string[] {
  const rowByKey = new Map<string, number>();
  index.m.forEach(([matchKey], i) => rowByKey.set(matchKey, i));
  const out = new Set<string>();
  for (const match of artifact.matches) {
    if (match.compLevel !== "qm") continue;
    const i = rowByKey.get(match.matchKey);
    if (i === undefined || i > cut.i) continue;
    if (typeof match.actualRedRp !== "number") for (const teamKey of match.redTeams) out.add(teamKey);
    if (typeof match.actualBlueRp !== "number") for (const teamKey of match.blueTeams) out.add(teamKey);
  }
  return [...out].sort();
}

/**
 * The as-of plan for an SPR rewind at `startMatchKey`: fetches the event's
 * INDEX and LOG and the season object first, then whatever `resolveAsOf`
 * names (another event's INDEX or LOG a team's walk crosses, the season start
 * object only when a team needs it), until every roster team and the league
 * are resolved. See this module's header for the cut and the fallback.
 */
export async function loadSimulationAsOf(params: { readonly artifact: EventArtifact; readonly startMatchKey: string }, fetchers: AsOfFetchers): Promise<SimulationAsOfPlan> {
  const { artifact, startMatchKey } = params;
  const eventKey = artifact.eventKey;
  if (artifact.eventType === undefined) return { status: "fallback", reason: `${eventKey}'s artifact names no event type` };

  const [cachedIndex, log, season] = await Promise.all([fetchers.index(eventKey), fetchers.log(eventKey), fetchers.season()]);
  let index = cachedIndex;
  if (index === null) return { status: "fallback", reason: `${eventKey} has no published INDEX` };
  if (season === null) return { status: "fallback", reason: "the season object is not published" };
  let cut = asOfCutBeforeMatch(index, startMatchKey);
  if (cut === undefined) {
    // The start row is in the artifact but not in this INDEX copy, which may
    // simply be older than the artifact: refetch it fresh, once.
    index = await fetchers.index(eventKey, { fresh: true });
    if (index === null) return { status: "fallback", reason: `${eventKey} has no published INDEX` };
    cut = asOfCutBeforeMatch(index, startMatchKey);
  }
  if (cut === undefined) return { status: "fallback", reason: `${startMatchKey} is not in ${eventKey}'s INDEX` };
  if (cut.i === -1 && index.lb === undefined) return { status: "fallback", reason: `${eventKey}'s INDEX carries no league row before its first match` };

  return resolveSimulationAsOfAtCut({ artifact, index, log, season, cut }, fetchers);
}

/**
 * The plan at an explicit cut, from the event's own INDEX, LOG and the season
 * object already in hand: the split, then the resolve and fetch loop.
 * `loadSimulationAsOf` names the cut; a test can name one directly to rebuild
 * the same instant in a world that never played the start match.
 */
export async function resolveSimulationAsOfAtCut(
  params: { readonly artifact: EventArtifact; readonly index: AsOfIndex; readonly log: AsOfLog | null; readonly season: AsOfSeason; readonly cut: AsOfCut },
  fetchers: AsOfFetchers
): Promise<SimulationAsOfPlan> {
  const { artifact, index, log, season, cut } = params;
  const eventKey = artifact.eventKey;
  if (artifact.eventType === undefined) return { status: "fallback", reason: `${eventKey}'s artifact names no event type` };
  // `tier` names an event type only when the artifact has none, which was refused above.
  const split = asOfQualSplit({ eventKey, tier: "district", eventArtifact: artifact, index, cut, week: artifact.week ?? null });
  const roster = split.baselines.map((baseline) => baseline.teamKey);

  const objects = new AsOfObjectSet(season, fetchers);
  objects.indexes.set(eventKey, index);
  objects.logs.set(eventKey, log);
  for (let round = 0; round < MAX_RESOLVE_ROUNDS; round++) {
    let result: ReturnType<typeof resolveAsOf>;
    try {
      result = resolveAsOf({
        cut,
        teams: roster.map((teamKey) => ({ teamKey, knownEventKeys: [eventKey] })),
        season: objects.season,
        indexes: objects.indexes,
        logs: objects.logs,
        start: objects.start,
      });
    } catch (error) {
      if (!(error instanceof AsOfResolveError)) throw error;
      return { status: "fallback", reason: error.message };
    }
    // Copies of different ages: refetch the reported ones fresh, once; still
    // out of step after that, the run falls back rather than price from them.
    const stale = asOfStaleObjectIds(result);
    if (stale.length > 0 && objects.refreshable(stale).length === 0) return { status: "fallback", reason: `the as-of objects are out of step (${stale.join(", ")})` };
    const nothingMissing = result.missingIndexes.length === 0 && result.missingLogs.length === 0 && !result.missingStart;
    if (nothingMissing && stale.length === 0) {
      if (result.league === undefined) return { status: "fallback", reason: "no league row at the cut" };
      const teams = [...result.states].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return {
        status: "ready",
        cutId: asOfCutId(cut),
        block: { season: objects.season.season, vars: objects.season.vars, league: result.league, teams, rows: split.rows },
        baselines: split.baselines,
        incompleteBaselineTeamKeys: incompleteAtCut(artifact, index, cut),
      };
    }
    if (!(await objects.load({ missingIndexes: result.missingIndexes, missingLogs: result.missingLogs, missingStart: result.missingStart, stale }))) {
      return { status: "fallback", reason: "the season object is not published" };
    }
  }
  return { status: "fallback", reason: "the as-of walk did not finish" };
}
