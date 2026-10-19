/**
 * The one `msg: "tick"` log line a tick ends with (quick task 261019-ooj).
 *
 * Both entries that start a tick emit it through this helper: the cron's
 * `scheduled()` with no extras, so its line is byte-for-byte what it was before
 * this module existed and carries no `trigger` field, and the TBA webhook
 * handler with `{ trigger: "webhook", eventKey }`. One structured JSON line per
 * tick, so an idle tick is distinguishable from a cron that never fires and
 * Workers Observability can filter on fields. Counts and durations only, never
 * a key, an artifact body or a TBA response.
 *
 * `TickResult` comes from `./scheduled.js` as a type only, so this module adds
 * no value import cycle (`scheduled.ts` imports this module by value).
 */
import type { TickResult } from "./scheduled.js";

/**
 * Waits for one tick and logs its line. On success, `console.log` of
 * `{ msg: "tick", ok: true, durationMs, ...extra, ...result }`. On failure,
 * `console.error` of `{ msg: "tick", ok: false, durationMs, ...extra, error }`,
 * then the error is rethrown: a rejected `waitUntil` is otherwise swallowed
 * silently, and rethrowing lets the dashboard record the failure.
 */
export function reportTick(run: Promise<TickResult>, startedMs: number, extra: Readonly<Record<string, string>> = {}, now: () => number = Date.now): Promise<void> {
  return run.then(
    (result) => {
      console.log(JSON.stringify({ msg: "tick", ok: true, durationMs: now() - startedMs, ...extra, ...result }));
    },
    (error: unknown) => {
      // A rejected waitUntil is otherwise swallowed silently. Log for the
      // operator, rethrow so the dashboard records the failure.
      console.error(
        JSON.stringify({
          msg: "tick",
          ok: false,
          durationMs: now() - startedMs,
          ...extra,
          error: error instanceof Error ? error.message : String(error),
        })
      );
      throw error;
    }
  );
}
