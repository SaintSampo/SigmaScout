/**
 * THE SIMULATION TAB'S AS-OF RUN (quick task 261005-5g0, Part 4): an SPR
 * rewind priced from the model as it stood just before the start match, then
 * simulated by the unchanged `runSimulationJob`.
 *
 * The request carries the tuples `resolveAsOf` rebuilt at the cut and the
 * remaining qualification rows, never priced odds. On this side of the
 * boundary `buildAsOfPricer` rebuilds the model, `priceRowsForSimulation`
 * prices every row (rounded as a stored row is), and the priced rows replace
 * the stored per row predictions the default run reads. The draw loop, the
 * progress messages and the result are `runSimulationJob`'s own; the result
 * additionally names the rows that priced to no ranking point distribution.
 *
 * Handed to the as-of Worker entry (`simulationAsOf.worker.ts`) only, so the
 * default simulation Worker chunk carries none of the pricer: an EPA or OPR
 * run, a forward run and the stored odds fallback load exactly what they did.
 *
 * Plain TypeScript, called directly by Vitest, for the reason
 * `simulationProtocol.ts` states for itself.
 */
import { buildAsOfPricer, priceRowsForSimulation, type AsOfSimulationRows } from "../../../../packages/harness/asOfPricing.js";
import type { AsOfTeamTuple } from "../../../../packages/harness/asOfState.js";
import type { UpcomingMatch } from "../../../../packages/core/algorithms/types.js";
import type { SimTeamBaseline } from "../../../../packages/core/algorithms/simulation/rankSimulation.js";
import { INVALID_REQUEST_ERROR_NAME, MAX_SIMULATION_MATCHES, runSimulationJob, type SimulationOutboundMessage } from "./simulationProtocol.js";
import { isAsOfModelBlock, isAsOfRow } from "./asOfBlockGuards.js";

/** Upper bound on an as-of block's `teams.length`: a roster of this size and the demo pseudo team. Far above any real event's roster. */
export const MAX_SIMULATION_AS_OF_TEAMS = 257;

/** The model as it stood at the cut, and the qualification rows still to play after it, in `(t, eventKey, i)` order. */
export interface SimulationAsOfBlock {
  readonly season: number;
  readonly vars: readonly string[];
  readonly league: readonly number[];
  /** Every roster team's tuple (and the demo pseudo team's when the roster holds a demo key), sorted by key. */
  readonly teams: readonly (readonly [string, AsOfTeamTuple])[];
  readonly rows: readonly UpcomingMatch[];
}

/** One posted as-of request: `SimulationRequest` with the as-of block in place of priced matches. */
export interface SimulationAsOfRequest {
  readonly type: "runAsOf";
  readonly asOf: SimulationAsOfBlock;
  readonly baselines: readonly SimTeamBaseline[];
  readonly draws: number;
  readonly seed: number;
}

/**
 * The as-of block's shape and cost, with the shared guards
 * (`asOfBlockGuards.ts`) the Locks tabs' as-of block is checked with. Draws,
 * seed and baselines are `runSimulationJob`'s own check, which runs next.
 */
export function isSimulationAsOfRequest(value: unknown): value is SimulationAsOfRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.type !== "runAsOf") return false;
  const block = candidate.asOf;
  if (typeof block !== "object" || block === null) return false;
  const fields = block as Record<string, unknown>;
  if (!isAsOfModelBlock(fields, MAX_SIMULATION_AS_OF_TEAMS)) return false;
  if (!Array.isArray(fields.rows) || fields.rows.length > MAX_SIMULATION_MATCHES) return false;
  return fields.rows.every(isAsOfRow);
}

/** The rows priced from the block's state: what the run simulates. Exported so a test can compare exactly what the Worker draws from. */
export function priceSimulationAsOfRows(block: SimulationAsOfBlock): AsOfSimulationRows {
  const pricer = buildAsOfPricer({ season: block.season, vars: block.vars, league: [...block.league], teams: new Map(block.teams) });
  return priceRowsForSimulation(pricer, block.rows);
}

/**
 * Validates, prices, then hands the priced rows to `runSimulationJob`. A
 * pricing failure (vars that are not the season's, a league row the pricer
 * refuses) ends the run with exactly one `error` message, as any failure does.
 */
export function runSimulationAsOfJob(message: unknown, emit: (outbound: SimulationOutboundMessage) => void): void {
  if (!isSimulationAsOfRequest(message)) {
    emit({ type: "error", name: INVALID_REQUEST_ERROR_NAME, message: "runSimulationAsOfJob: payload did not conform to SimulationAsOfRequest" });
    return;
  }
  let priced: AsOfSimulationRows;
  try {
    priced = priceSimulationAsOfRows(message.asOf);
  } catch (error) {
    emit({ type: "error", name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) });
    return;
  }
  runSimulationJob({ type: "run", matches: priced.matches, baselines: message.baselines, draws: message.draws, seed: message.seed }, (outbound) => {
    emit(outbound.type === "result" ? { ...outbound, excludedMatchKeys: priced.excludedMatchKeys, simulatedMatches: priced.matches.length } : outbound);
  });
}
