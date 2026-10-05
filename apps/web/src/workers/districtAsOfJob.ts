/**
 * THE AS-OF EVENT RUNNER (quick task 261005-5g0): one rewound stop's event,
 * priced or baked from the model as it stood at the stop. Handed to
 * `runDistrictWorkerJob` by the as-of Worker entry
 * (`districtAsOfSimulation.worker.ts`) only, so the Live Worker chunk and the
 * main bundle carry none of the pricer, the bake or the schedule generator.
 *
 * - REAL: `buildAsOfPricer` from the block's tuples, `priceRowsForSimulation`
 *   over the remaining rows (rounded as a stored row is), `ratingsFor` over the
 *   roster, then `simulateDistrictEvent`.
 * - GENERATED: the pricer's `predictFor` (the all-or-nothing roster gate) and
 *   `ratingsFor`, then `bakeDistrictEvent` with `scripts/publishDistricts.ts`'s
 *   own parameters. Its rows decode through `distributionsFromPreSim`.
 *
 * Plain TypeScript, called directly by Vitest, for the reason
 * `districtSimulationProtocol.ts` states for itself.
 */
import { simulateDistrictEvent, type DistrictLedgerEventInput } from "../../../../packages/core/districts/ledgerSimulation.js";
import { buildAsOfPricer, priceRowsForSimulation, type AsOfPricer } from "../../../../packages/harness/asOfPricing.js";
import { bakeDistrictEvent, type DistrictBakeSkipReason } from "../../../../packages/harness/districtBake.js";
import type { DistrictAsOfBlock, DistrictAsOfEventRequest, DistrictAsOfRunner } from "./districtSimulationProtocol.js";

/** The `name` a GENERATED event's unavailable entry carries when the all-or-nothing roster gate refuses (`predictFor` returned nothing). */
export const AS_OF_ROSTER_UNPRICED_ERROR_NAME = "AsOfRosterUnpricedError";

/** The `name` a GENERATED event's unavailable entry carries when `bakeDistrictEvent` skips it. */
export const AS_OF_BAKE_SKIPPED_ERROR_NAME = "DistrictBakeSkipped";

/** Raised inside the runner, and isolated by the job into a per event unavailable entry, when a GENERATED event cannot be baked. */
export class AsOfBakeSkippedError extends Error {
  readonly reason: DistrictBakeSkipReason | "roster-unpriced";
  constructor(eventKey: string, reason: DistrictBakeSkipReason | "roster-unpriced", detail: string) {
    super(`${eventKey}: ${detail}`);
    this.name = reason === "roster-unpriced" ? AS_OF_ROSTER_UNPRICED_ERROR_NAME : AS_OF_BAKE_SKIPPED_ERROR_NAME;
    this.reason = reason;
  }
}

function asOfPricerFor(block: DistrictAsOfBlock): AsOfPricer {
  return buildAsOfPricer({ season: block.season, vars: block.vars, league: [...block.league], teams: new Map(block.teams) });
}

/**
 * A REAL event's finished input: the remaining rows priced from the as-of
 * state and the roster rated by the same pricer. Exported so a test can compare
 * exactly what the Worker simulates.
 */
export function prepareAsOfRealInput(event: DistrictAsOfEventRequest): {
  readonly input: DistrictLedgerEventInput;
  readonly excludedMatchKeys: readonly string[];
} {
  const pricer = asOfPricerFor(event.asOf);
  const priced = priceRowsForSimulation(pricer, event.asOf.rows ?? []);
  const roster = event.input.baselines.map((baseline) => baseline.teamKey);
  return {
    input: { ...event.input, remainingMatches: priced.matches, ratings: pricer.ratingsFor(roster) },
    excludedMatchKeys: priced.excludedMatchKeys,
  };
}

/** Runs one as-of event: REAL simulates, GENERATED bakes. Throws a typed error for the job to isolate. */
export const runAsOfEvent: DistrictAsOfRunner = (event, draws, seed) => {
  const block = event.asOf;
  if (block.mode === "real") {
    const prepared = prepareAsOfRealInput(event);
    const result = simulateDistrictEvent(prepared.input, draws, seed);
    return { status: "ok", eventKey: event.eventKey, result, ...(prepared.excludedMatchKeys.length > 0 ? { excludedMatchKeys: prepared.excludedMatchKeys } : {}) };
  }
  const bake = block.bake!;
  const pricer = asOfPricerFor(block);
  const roster = event.input.baselines.map((baseline) => baseline.teamKey);
  const predict = pricer.predictFor(roster);
  if (predict === undefined) {
    const missing = pricer.teamsWithoutSigma(roster);
    throw new AsOfBakeSkippedError(event.eventKey, "roster-unpriced", `${String(missing.length)} roster team(s) have no Sigma Score at the stop`);
  }
  // `scripts/publishDistricts.ts`'s own call, parameter for parameter: the
  // schedule and draw counts are the bake's defaults
  // (`DISTRICT_BAKE_SCHEDULE_COUNT` x `DISTRICT_BAKE_DRAWS_PER_SCHEDULE`), and
  // the seeds come from the event key and the algorithm version inside it.
  // The job's own draw count and seed are the joint run's and are not used.
  const outcome = bakeDistrictEvent({
    districtKey: bake.districtKey,
    eventKey: event.eventKey,
    season: event.input.season,
    tier: event.input.tier,
    eventType: bake.eventType,
    week: bake.week,
    roster,
    allianceCount: event.input.allianceCount,
    fieldSize: event.input.fieldSize,
    ratings: pricer.ratingsFor(roster),
    awardProfiles: event.input.awardProfiles,
    algorithmId: bake.algorithmId,
    algorithmVersion: bake.algorithmVersion,
    matchesPerTeam: bake.matchesPerTeam,
    predict,
  });
  if (outcome.status === "skipped") throw new AsOfBakeSkippedError(event.eventKey, outcome.reason, outcome.detail);
  return { status: "baked", eventKey: event.eventKey, roster: outcome.roster, rows: outcome.rows, draws: outcome.draws };
};
