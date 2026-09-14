/**
 * In-tick subrequest accounting, a named cap+reserve, and the rotating
 * no-starvation order. The worked subrequest budget is a per-event average,
 * not a worst-case tick, and the platform's response to exceeding its
 * 50-subrequest cap is a throw, not a throttle. A `scheduled()` invocation
 * that iterates live events in a stable order and stops at the cap serves
 * the same front-of-list events every tick and never reaches the tail — the
 * tail events are not delayed, they are permanently omitted, and nothing
 * about that is visible in a log. Rotation is what turns "hitting the limit
 * should mean requests catch up when they can" into something literally true.
 *
 * The rotation offset a real tick advances belongs in D1's `event_cursor`
 * table, never in KV — KV's free tier allows only 1,000 writes/day, and a
 * ten-hour live event day at one-minute ticks would burn that on rotation
 * bookkeeping alone, the same reasoning `apps/worker/migrations/
 * 0001_algorithm_state.sql`'s `event_cursor` header states for
 * `last_folded_match_key`/`tba_etag`. This module is deliberately pure (no
 * D1Database parameter anywhere in it) — persistence is the caller's job,
 * this module only owns the accounting/rotation math.
 */

/**
 * The documented Workers free-plan per-invocation subrequest limit — every
 * R2/D1/KV binding call and every outbound `fetch` counts against it.
 */
export const SUBREQUEST_CAP = 50;

/**
 * Reserved headroom subtracted from `SUBREQUEST_CAP` before any `tryConsume`
 * call is allowed to succeed. A tick's own fixed costs — the manifest read,
 * the one batched state read, the one batched state write (`stateStore.ts`)
 * — must never be the calls that get squeezed out by a busy tick's variable
 * (per-event) work; reserving headroom up front is what guarantees that.
 * Starts at 4 (1 manifest read + 1 state read + 1 state write + 1 margin),
 * to be tightened once the real fixed-cost count is measured on a deployed Worker.
 */
export const SUBREQUEST_RESERVE = 4;

/**
 * In-tick subrequest accounting. `tryConsume` returns a boolean rather than
 * throwing: work that does not fit this tick is deferred to the next one,
 * never attempted-then-thrown. `consume` is for the tick's own fixed costs,
 * where running out means something upstream miscounted and failing loudly
 * is correct.
 */
export class SubrequestBudget {
  readonly cap: number;
  readonly reserve: number;
  #used = 0;

  constructor(cap: number = SUBREQUEST_CAP, reserve: number = SUBREQUEST_RESERVE) {
    this.cap = cap;
    this.reserve = reserve;
  }

  /** The usable budget after reserving headroom for the tick's fixed costs. */
  get usableCap(): number {
    return this.cap - this.reserve;
  }

  /** Total subrequests consumed so far this tick. */
  get used(): number {
    return this.#used;
  }

  /** Never negative — floored at 0 even if `used` somehow exceeded `usableCap` (it cannot, via `tryConsume`/`consume` alone, but the getter is defensive regardless). */
  get remaining(): number {
    return Math.max(0, this.usableCap - this.#used);
  }

  /**
   * Attempts to consume `n` subrequests. Succeeds (returns `true`, increments
   * `used`) only while `used + n <= usableCap`; at the boundary and beyond,
   * returns `false` without incrementing — the caller skips this work and
   * lets the next tick pick it up, rather than attempting it and throwing
   * when the platform's real cap is hit.
   */
  tryConsume(n: number): boolean {
    if (this.#used + n > this.usableCap) return false;
    this.#used += n;
    return true;
  }

  /**
   * Consumes `n` subrequests or throws. For call sites where exceeding the
   * budget is a genuine upstream bug (the tick's own fixed costs), never for
   * variable per-event work — that path is always `tryConsume`.
   */
  consume(n: number): void {
    if (!this.tryConsume(n)) {
      throw new Error(
        `SubrequestBudget.consume: consuming ${n} would exceed the usable budget ` +
          `(${this.usableCap}, used=${this.#used}) — this call site is for FIXED costs, ` +
          `where exceeding means something upstream miscounted`
      );
    }
  }
}

/**
 * Rotates `items` to start at `offset % items.length`, preserving relative
 * order and containing every input exactly once. Pure and generic — see
 * `sortEventKeys` below for producing a deterministic total order before
 * rotating (rotating an ambiguously-ordered list is not a rotation over
 * anything).
 *
 * The caller persists an offset that advances by the number of items
 * actually processed this tick, so the next tick's `rotate` call starts
 * where this one stopped. A Worker that always rotates from a fixed offset
 * serves the same front-of-list items every tick and never reaches the
 * tail: the tail items are not delayed, they are permanently omitted.
 */
export function rotate<T>(items: readonly T[], offset: number): T[] {
  const n = items.length;
  if (n === 0) return [];
  const start = ((offset % n) + n) % n; // defensive against a negative offset
  return [...items.slice(start), ...items.slice(0, start)];
}

/**
 * A plain, deterministic lexicographic sort of event keys — the total order
 * `rotate` should be given. Event keys are unique, so this sort has no ties
 * to break; its whole job is to make "the list `rotate` receives"
 * independent of whatever incidental order the manifest happened to
 * enumerate events in (KV/JSON iteration order is not a contract) — two
 * ticks reading the same live-events set always rotate over the same
 * starting sequence, so `offset` means the same thing across ticks.
 */
export function sortEventKeys(eventKeys: readonly string[]): string[] {
  return [...eventKeys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
