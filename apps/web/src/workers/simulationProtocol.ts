/**
 * The message contract and plumbing for the app's first Web Worker (D-07:
 * 1000 draws in a browser Web Worker, live progress during the run, total
 * elapsed time on completion). All arithmetic here is orchestration —
 * request validation, chunked-progress accumulation, error translation —
 * never draw/rank math, which stays entirely in 08-03's
 * `packages/core/algorithms/simulation/rankSimulation.ts`.
 *
 * This module is plain TypeScript, importable and callable directly by
 * Vitest: jsdom (this repo's test environment) implements no `Worker` API
 * at all, so `simulation.worker.ts` (the actual worker entry file) is
 * close to untestable by construction. Every branch, every bound check and
 * the whole progress loop live HERE instead, where a plain `it()` block can
 * call `runSimulationJob` directly.
 */
import { simulateRanks, mulberry32 } from "../../../../packages/core/algorithms/simulation/rankSimulation.js";
import type { SimMatchInput, SimTeamBaseline } from "../../../../packages/core/algorithms/simulation/rankSimulation.js";

/** The fixed draw count EVNT-07 specifies. Single definition site — no component types the literal `1000`. */
export const SIMULATION_DRAWS = 1000;

/** Draws per progress message (20 updates across a full `SIMULATION_DRAWS` run). Chunking is how live progress is achieved against 08-03's `simulateRanks(matches, baselines, draws, rng)` signature, which has no progress callback of its own (PD-01). */
export const PROGRESS_CHUNK_DRAWS = 50;

/** Upper bound on `draws` accepted from a request — a denial-of-service ceiling on the visitor's own CPU (T-08-07-01), not a realistic operating value. */
export const MAX_SIMULATION_DRAWS = 10000;

/** Upper bound on `matches.length` accepted from a request. The corpus's measured worst case is 135 qualification matches (`2024wvrox`); this ceiling is well above that with margin for a DoS-shaped or accidentally-wrong request (T-08-07-01). */
export const MAX_SIMULATION_MATCHES = 500;

/**
 * Fixed so a simulation run is reproducible (PD-04): the same event and the
 * same start match must always yield the same rank distribution, so that
 * any change a visitor sees is a change in the underlying data, never an
 * artifact of the draw. 08-13 owns the call site and must record a reason
 * if it ever varies this value.
 */
export const DEFAULT_SIMULATION_SEED = 20260830;

/** The `name` an invalid `SimulationRequest` payload's `error` message carries. */
export const INVALID_REQUEST_ERROR_NAME = "InvalidSimulationRequest";

/** One posted request: the remaining-matches/baselines inputs `simulateRanks` expects, plus the draw count and seed. */
export interface SimulationRequest {
  readonly type: "run";
  readonly matches: readonly SimMatchInput[];
  readonly baselines: readonly SimTeamBaseline[];
  readonly draws: number;
  /**
   * Randomness crosses the thread boundary as a plain number, never as an
   * rng function (PD-03): a function is not structured-cloneable, so a
   * request carrying one would fail at `postMessage` with a runtime
   * `DataCloneError` that no typecheck would have caught. The worker
   * constructs `mulberry32(seed)` itself, on its own side of the boundary.
   * See `DEFAULT_SIMULATION_SEED` for why the value passed here is fixed.
   */
  readonly seed: number;
}

/** One progress update: cumulative draws completed so far. */
export interface SimulationProgressMessage {
  readonly type: "progress";
  readonly completedDraws: number;
  readonly totalDraws: number;
}

/** The terminal success message: the complete per-team rank-distribution histogram. */
export interface SimulationResultMessage {
  readonly type: "result";
  /**
   * `teamKey` -> a per-rank DRAW COUNT (never a probability), indexed
   * `rank - 1`, exactly as 08-03's `simulateRanks` returns it and exactly
   * as 08-04's `continuousQuantile(dist, p, draws)` consumes it
   * unconverted. The Worker computes no quantile of its own.
   */
  readonly rankHistograms: ReadonlyMap<string, Int32Array>;
  readonly draws: number;
  /**
   * The draw loop's OWN `performance.now()` duration. This is NOT the
   * figure a user should read (PD-05): 08-13 measures the user-facing
   * elapsed time on the main thread, from Run press to result arrival,
   * which also includes worker construction and message-transfer latency —
   * that is what the visitor actually waited through. `computeMs` exists so
   * SC-2's representative measurement (08-13's SUMMARY) can be split into
   * construction-plus-transfer versus compute. It must never become a
   * second user-facing number.
   */
  readonly computeMs: number;
}

/** The terminal failure message. Carries only `name`/`message` — never a stack, never a serialized object (T-08-07-06). */
export interface SimulationErrorMessage {
  readonly type: "error";
  readonly name: string;
  readonly message: string;
}

export type SimulationOutboundMessage = SimulationProgressMessage | SimulationResultMessage | SimulationErrorMessage;

/**
 * A bound on cost and shape at the thread boundary — NOT a re-validation of
 * pmf contents. Pmf validity (each entry finite, non-empty, summing to 1
 * within tolerance) is the publish boundary's job
 * (`EventMatchSchema`'s `.refine(isValidPmf, ...)`, 08-02), with 08-03's own
 * up-front pass as defence-in-depth. Duplicating a numeric tolerance here is
 * how two tolerances drift apart from each other.
 */
export function isSimulationRequest(value: unknown): value is SimulationRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.type !== "run") return false;
  if (!Array.isArray(candidate.matches)) return false;
  if (candidate.matches.length > MAX_SIMULATION_MATCHES) return false;
  if (!Array.isArray(candidate.baselines)) return false;
  if (candidate.baselines.length < 1) return false;
  if (typeof candidate.draws !== "number" || !Number.isInteger(candidate.draws)) return false;
  if (candidate.draws < 1 || candidate.draws > MAX_SIMULATION_DRAWS) return false;
  if (typeof candidate.seed !== "number" || !Number.isFinite(candidate.seed)) return false;
  return true;
}

/**
 * Runs one simulation job: validates `message`, then drives 08-03's
 * `simulateRanks` in `PROGRESS_CHUNK_DRAWS`-sized chunks sharing ONE
 * `mulberry32` rng instance, emitting one `progress` message per chunk and
 * a final `result` message. Any rejection or thrown error ends the run with
 * exactly one `error` message and nothing else — no partial result, no
 * further progress.
 *
 * Chunking is exact, not approximate (PD-01): each draw inside
 * `simulateRanks` resets its accumulators from `baselines` and consumes the
 * same number of rng values regardless of how many draws are requested in
 * one call, and per-rank draw counts are additive across calls sharing one
 * rng stream. So N calls of `PROGRESS_CHUNK_DRAWS` draws sharing one
 * `mulberry32` instance consume the identical rng stream — and therefore
 * produce the identical histograms — that one call of `draws` draws would.
 * `simulationProtocol.test.ts`'s Test 4 asserts this against the core
 * directly rather than assuming it.
 *
 * Takes `message: unknown` deliberately: the untrusted-input boundary lives
 * here, in the tested module, so `simulation.worker.ts` never has to cast
 * `event.data` itself.
 */
export function runSimulationJob(message: unknown, emit: (outbound: SimulationOutboundMessage) => void): void {
  if (!isSimulationRequest(message)) {
    emit({
      type: "error",
      name: INVALID_REQUEST_ERROR_NAME,
      message: "runSimulationJob: payload did not conform to SimulationRequest",
    });
    return;
  }

  const { matches, baselines, draws, seed } = message;

  try {
    const rng = mulberry32(seed);
    const start = performance.now();
    const accumulator = new Map<string, Int32Array>();
    let completedDraws = 0;

    while (completedDraws < draws) {
      const chunkSize = Math.min(PROGRESS_CHUNK_DRAWS, draws - completedDraws);
      const chunkResult = simulateRanks(matches, baselines, chunkSize, rng);

      for (const [teamKey, chunkHistogram] of chunkResult.rankHistograms) {
        let accumulated = accumulator.get(teamKey);
        if (accumulated === undefined) {
          accumulated = new Int32Array(chunkHistogram.length);
          accumulator.set(teamKey, accumulated);
        } else if (accumulated.length !== chunkHistogram.length) {
          throw new Error(
            `runSimulationJob: histogram length mismatch for team "${teamKey}" across chunks (${accumulated.length} vs ${chunkHistogram.length})`
          );
        }
        for (let i = 0; i < chunkHistogram.length; i++) {
          accumulated[i]! += chunkHistogram[i]!;
        }
      }

      completedDraws += chunkSize;
      emit({ type: "progress", completedDraws, totalDraws: draws });
    }

    const computeMs = performance.now() - start;
    emit({ type: "result", rankHistograms: accumulator, draws, computeMs });
  } catch (error) {
    emit({
      type: "error",
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
