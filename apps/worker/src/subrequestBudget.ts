/**
 * D-15/D-19: in-tick subrequest accounting, a named cap+reserve, and the
 * rotating no-starvation order — the piece 04-RESEARCH.md's Pitfall 1 names
 * directly: the worked ~46-49-subrequest budget (Pattern 1) is a per-event
 * AVERAGE, not a worst-case tick, and the platform's response to exceeding
 * its 50-subrequest cap is a throw, not a throttle. A `scheduled()`
 * invocation that iterates live events in a stable order and stops at the
 * cap serves the SAME front-of-list events every tick and never reaches the
 * tail — the tail events are not delayed, they are permanently omitted, and
 * nothing about that is visible in a log. The user's own framing was that
 * hitting the limit should mean requests catch up when they can; rotation is
 * what makes that literally true.
 *
 * OFFSET PERSISTENCE (module-scope decision, not implemented here): the
 * rotation offset a real tick advances belongs in D1's `event_cursor` table
 * (a reserved one-row key, or a dedicated one-row table — 04-06 picks the
 * concrete shape when it wires this module into the real `scheduled()`
 * handler), NEVER in KV. KV's free tier allows only 1,000 writes/day, and a
 * ten-hour live event day at one-minute ticks would burn that on rotation
 * bookkeeping alone (T-04-33) — the identical reasoning `apps/worker/
 * migrations/0001_algorithm_state.sql`'s `event_cursor` header already
 * states for `last_folded_match_key`/`tba_etag`. This module is
 * deliberately pure (no D1Database parameter anywhere in it) — persistence
 * is the caller's job, this module only owns the accounting/rotation MATH.
 */

/**
 * The documented Workers free-plan per-invocation subrequest limit — every
 * R2/D1/KV binding call and every outbound `fetch` counts against it
 * (04-RESEARCH.md Pattern 1, CITED: developers.cloudflare.com/workers/
 * platform/limits/).
 */
export const SUBREQUEST_CAP = 50;

/**
 * Reserved headroom subtracted from `SUBREQUEST_CAP` before any `tryConsume`
 * call is allowed to succeed. A tick's OWN fixed costs — the manifest read,
 * the one batched state read, the one batched state write (`stateStore.ts`)
 * — must never be the calls that get squeezed out by a busy tick's variable
 * (per-event) work; reserving headroom up front is what guarantees that.
 * Starts at 4 (1 manifest read + 1 state read + 1 state write + 1 margin) —
 * a plan 04-06/04-07 concern to tighten once the real fixed-cost count is
 * measured on a deployed Worker (this plan's own `must_haves` marks the
 * measured peak as a backstop truth, not something claimed here).
 */
export const SUBREQUEST_RESERVE = 4;

/**
 * In-tick subrequest accounting. `tryConsume` returns a boolean rather than
 * throwing — that is the whole point of D-15: work that does not fit this
 * tick is DEFERRED to the next one, never attempted-then-thrown. `consume`
 * is for the tick's own FIXED costs, where running out means something
 * upstream miscounted and failing loudly is correct.
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
   * returns `false` WITHOUT incrementing — the caller skips this work and
   * lets the next tick pick it up (D-15), rather than attempting it and
   * throwing when the platform's real cap is hit.
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
 * order and containing every input exactly once — an empty array returns an
 * empty array, and a single-element array returns that element for any
 * offset. Pure and generic: this function does not know what `T` is or how
 * to order it — see `sortEventKeys` below for producing a deterministic
 * total order BEFORE rotating (rotating an ambiguously-ordered list is not a
 * rotation over anything).
 *
 * The caller persists an offset that advances by the number of items
 * actually processed this tick, so the next tick's `rotate` call starts
 * where this one stopped — that is the mechanism D-15 asks for. A Worker
 * that always rotates from a FIXED offset (e.g. always 0) serves the same
 * front-of-list items every tick and never reaches the tail: the tail items
 * are not delayed, they are permanently omitted (see this module's own
 * `no-starvation` test and its pinned-offset counterfactual).
 */
export function rotate<T>(items: readonly T[], offset: number): T[] {
  const n = items.length;
  if (n === 0) return [];
  const start = ((offset % n) + n) % n; // defensive against a negative offset
  return [...items.slice(start), ...items.slice(0, start)];
}

/**
 * A plain, deterministic lexicographic sort of event keys — the total order
 * `rotate` should be given, matching `packages/corpus/db.ts`'s
 * `selectMatchesChronological` precedent of making an otherwise-ambiguous
 * order deterministic and documenting why. Event keys are unique, so this
 * sort has no ties to break; its whole job is to make "the list `rotate`
 * receives" independent of whatever incidental order the manifest happened
 * to enumerate events in (KV/JSON iteration order is not a contract) — two
 * ticks reading the same live-events set always rotate over the SAME
 * starting sequence, so `offset` means the same thing across ticks.
 */
export function sortEventKeys(eventKeys: readonly string[]): string[] {
  return [...eventKeys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
