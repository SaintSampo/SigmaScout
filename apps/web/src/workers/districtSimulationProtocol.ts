/**
 * The message contract and plumbing for the district ledger's Web Worker:
 * one joint `simulateDistrictEvent` run per district event currently in
 * progress (or reopened by the Rewind slider), progress after each event,
 * one terminal result carrying every event's marginals. All arithmetic here
 * is orchestration — request validation, per-event failure isolation, error
 * translation — never point or draw math, which stays entirely in
 * `packages/core/districts/ledgerSimulation.ts`.
 *
 * This module is plain TypeScript, importable and callable directly by
 * Vitest, for exactly the reason `simulationProtocol.ts` states for itself:
 * jsdom (this repo's test environment) implements no `Worker` API at all, so
 * `districtSimulation.worker.ts` (the actual worker entry file) is close to
 * untestable by construction. Every branch, every bound check and the whole
 * event loop live HERE instead, where a plain `it()` block can call
 * `runDistrictSimulationJob` directly.
 *
 * NOTHING IN A REQUEST OR A RESULT MAY BE A FUNCTION, a class instance or a
 * closure. A function is not structured-cloneable, so a request carrying one
 * fails at `postMessage` with a runtime `DataCloneError` that no typecheck
 * would have caught. `Map` and `Int32Array` — which every field below leans
 * on — are both structured-cloneable, which is why 10-04's own input and
 * result shapes cross this boundary unreshaped.
 */
import {
  simulateDistrictEvent,
  type DistrictLedgerEventInput,
  type DistrictLedgerResult,
} from "../../../../packages/core/districts/ledgerSimulation.js";
import {
  DEFAULT_SIMULATION_SEED,
  MAX_SIMULATION_DRAWS,
  MAX_SIMULATION_MATCHES,
  SIMULATION_DRAWS,
} from "./simulationProtocol.js";

/**
 * Re-exported, never restated: ONE draw count and ONE fixed seed across the
 * whole site. The event page's Simulation tab and this tab must agree, so
 * that any change a visitor sees is a change in the underlying data and never
 * an artifact of the draw. `ledgerSimulation.ts`'s non-perturbation pin is
 * written against exactly that shared pair.
 */
export { DEFAULT_SIMULATION_SEED, SIMULATION_DRAWS };

/**
 * Upper bound on `events.length` accepted from a request — a denial-of-service
 * ceiling on the visitor's own CPU, not an operating value. CONTEXT says a
 * district weekend puts at most two or three events live at once, and the
 * largest district in the corpus (`2026fim`) runs about a dozen district-tier
 * events across a whole season, which is the worst case a full-season rewind
 * could ever ask for. 24 is double that, so a legitimate request can never
 * reach it while a malformed or hostile one is still bounded.
 */
export const MAX_DISTRICT_SIMULATION_EVENTS = 24;

/**
 * Upper bound on one event's `baselines.length`. The largest district event
 * roster the corpus carries is well under 100 teams; 256 leaves real margin
 * while keeping a single run's cost bounded. Again a DoS ceiling on the
 * visitor's own CPU, never a value any real event approaches.
 */
export const MAX_DISTRICT_SIMULATION_ROSTER = 256;

/** The `name` an invalid `DistrictSimulationRequest` payload's `error` message carries. */
export const INVALID_DISTRICT_REQUEST_ERROR_NAME = "InvalidDistrictSimulationRequest";

/**
 * The `name` an unavailable entry carries when the core threw something that
 * is not an `Error` at all. Named rather than inlined so a test can assert the
 * non-`Error` path without retyping the string.
 */
export const UNKNOWN_DISTRICT_ERROR_NAME = "Error";

/** One event to simulate: its key, plus 10-04's own per-event input object, imported as a type and never restated field by field. */
export interface DistrictSimulationEventRequest {
  readonly eventKey: string;
  readonly input: DistrictLedgerEventInput;
}

/**
 * One posted request.
 *
 * Randomness crosses as a plain number, exactly as `SimulationRequest`'s own
 * `seed` does and for the same reason: the worker builds its generators on its
 * own side of the boundary.
 *
 * THE SAME SEED IS USED FOR EVERY EVENT, and the shared stream is safe here
 * because the grand total is an EXACT CONVOLUTION of the per-event marginals,
 * never a per-draw cross-event sum. Draw 7 of event A is never added to draw 7
 * of event B, so a shared stream cannot carry correlation into any rendered or
 * published quantity. Nothing downstream may start summing per-draw across
 * events without revisiting this choice.
 */
export interface DistrictSimulationRequest {
  readonly type: "run";
  readonly events: readonly DistrictSimulationEventRequest[];
  readonly draws: number;
  readonly seed: number;
}

/**
 * One progress update: events completed so far.
 *
 * PROGRESS IS PER EVENT, NOT PER CHUNK OF DRAWS, and the absence of
 * `simulationProtocol.ts`'s chunking-is-exact argument is deliberate rather
 * than an oversight. `simulateDistrictEvent` constructs BOTH of its generators
 * from the `seed` it is handed, so a chunked accumulation would either repeat
 * one chunk's draws `draws / chunk` times (the same seed every chunk) or
 * produce a result no single call could reproduce (a per-chunk seed). The
 * second option would additionally break 10-04's own non-perturbation pin,
 * which asserts this tab's qualification marginal is bit-identical to a bare
 * `simulateRanks` run under one seed. Per-event progress is honest at the two
 * or three live events CONTEXT says a district weekend produces.
 */
export interface DistrictSimulationProgressMessage {
  readonly type: "progress";
  readonly completedEvents: number;
  readonly totalEvents: number;
}

/** One event that ran: 10-04's result object forwarded UNRESHAPED — a second opinion at this boundary would be a second place for the two to drift. */
export interface DistrictSimulationEventSuccess {
  readonly status: "ok";
  readonly eventKey: string;
  readonly result: DistrictLedgerResult;
}

/**
 * One event that could not be simulated. Carries `name` so a test can assert
 * WHICH class produced it (10-04's `UnratedTeamError` is the named handoff);
 * the rendered cell prints fixed copy from `districtLedgerCopy.ts` and never
 * this `message`.
 */
export interface DistrictSimulationEventUnavailable {
  readonly status: "unavailable";
  readonly eventKey: string;
  readonly name: string;
  readonly message: string;
}

export type DistrictSimulationEventEntry = DistrictSimulationEventSuccess | DistrictSimulationEventUnavailable;

/** The terminal success message: one entry per requested event, in request order. */
export interface DistrictSimulationResultMessage {
  readonly type: "result";
  readonly events: readonly DistrictSimulationEventEntry[];
  readonly draws: number;
  /**
   * The event loop's OWN `performance.now()` duration, for the same reason
   * `SimulationResultMessage.computeMs` exists and under the same rule: it
   * must never become a second user-facing number.
   */
  readonly computeMs: number;
}

/** The terminal failure message — a MALFORMED REQUEST and nothing else. Carries only `name`/`message`, never a stack, never a serialized object. */
export interface DistrictSimulationErrorMessage {
  readonly type: "error";
  readonly name: string;
  readonly message: string;
}

export type DistrictSimulationOutboundMessage =
  | DistrictSimulationProgressMessage
  | DistrictSimulationResultMessage
  | DistrictSimulationErrorMessage;

function isEventRequest(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.eventKey !== "string" || candidate.eventKey.length === 0) return false;
  const input = candidate.input;
  if (typeof input !== "object" || input === null) return false;
  const eventInput = input as Record<string, unknown>;
  if (!Array.isArray(eventInput.remainingMatches)) return false;
  if (eventInput.remainingMatches.length > MAX_SIMULATION_MATCHES) return false;
  if (!Array.isArray(eventInput.baselines)) return false;
  if (eventInput.baselines.length < 1) return false;
  if (eventInput.baselines.length > MAX_DISTRICT_SIMULATION_ROSTER) return false;
  return true;
}

/**
 * A bound on COST AND SHAPE at the thread boundary — NOT a re-validation of
 * pmf contents, and not a second copy of 10-04's own pre-loop validation pass.
 * `isSimulationRequest`'s stated reason applies verbatim: duplicating a
 * numeric tolerance here is how two tolerances drift apart from each other.
 * Pmf validity belongs to the publish boundary (`EventMatchSchema`'s
 * `.refine(isValidPmf, ...)`); roster pricing, field size and alliance
 * validity belong to `simulateDistrictEvent`'s own up-front pass, which throws
 * a TYPED error precisely so this module can turn it into a per-event
 * unavailable entry rather than a terminal failure.
 */
export function isDistrictSimulationRequest(value: unknown): value is DistrictSimulationRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.type !== "run") return false;
  if (!Array.isArray(candidate.events)) return false;
  if (candidate.events.length < 1) return false;
  if (candidate.events.length > MAX_DISTRICT_SIMULATION_EVENTS) return false;
  if (typeof candidate.draws !== "number" || !Number.isInteger(candidate.draws)) return false;
  if (candidate.draws < 1 || candidate.draws > MAX_SIMULATION_DRAWS) return false;
  if (typeof candidate.seed !== "number" || !Number.isFinite(candidate.seed)) return false;
  for (const event of candidate.events) {
    if (!isEventRequest(event)) return false;
  }
  return true;
}

/**
 * Runs one district simulation job: validates `message`, then loops the events
 * calling `simulateDistrictEvent` once each under the SAME seed, emitting one
 * `progress` message per completed event and exactly one `result` at the end.
 *
 * PER-EVENT FAILURE IS ISOLATED. One event whose roster cannot be priced must
 * not blank another event's cells: 10-04 throws `UnratedTeamError` precisely so
 * the caller can make that call, and the call is made here. A malformed
 * request, and ONLY a malformed request, produces the terminal `error` message.
 *
 * Takes `message: unknown` deliberately: the untrusted-input boundary lives
 * here, in the tested module, so `districtSimulation.worker.ts` never has to
 * cast `event.data` itself.
 */
export function runDistrictSimulationJob(
  message: unknown,
  emit: (outbound: DistrictSimulationOutboundMessage) => void
): void {
  if (!isDistrictSimulationRequest(message)) {
    emit({
      type: "error",
      name: INVALID_DISTRICT_REQUEST_ERROR_NAME,
      message: "runDistrictSimulationJob: payload did not conform to DistrictSimulationRequest",
    });
    return;
  }

  const { events, draws, seed } = message;
  const start = performance.now();
  const entries: DistrictSimulationEventEntry[] = [];
  const totalEvents = events.length;

  for (let i = 0; i < totalEvents; i++) {
    const event = events[i]!;
    try {
      const result = simulateDistrictEvent(event.input, draws, seed);
      entries.push({ status: "ok", eventKey: event.eventKey, result });
    } catch (error) {
      entries.push({
        status: "unavailable",
        eventKey: event.eventKey,
        name: error instanceof Error ? error.name : UNKNOWN_DISTRICT_ERROR_NAME,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    emit({ type: "progress", completedEvents: i + 1, totalEvents });
  }

  emit({ type: "result", events: entries, draws, computeMs: performance.now() - start });
}
