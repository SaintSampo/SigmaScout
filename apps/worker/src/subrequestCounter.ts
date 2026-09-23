/**
 * Two pieces of per-tick bookkeeping the tick loop uses together: a plain
 * count of subrequests actually spent, and the rotating no-starvation order
 * the event loop iterates in.
 *
 * THERE IS NO BUDGET HERE ANY MORE (quick task 260923-3w4). Until 2026-09-23
 * this module was `subrequestBudget.ts` and owned a cap, a reserve, a
 * `usableCap`, and a `tryConsume`/`consume` split whose whole purpose was to
 * defer work that would not fit inside the free plan's 50 subrequests per
 * invocation. The account moved to Workers Paid on 2026-09-22: the limit is
 * 10,000 per invocation, and this Worker's most expensive measured tick spent
 * 26. Every deferral path was therefore unreachable code that a reader still
 * had to hold in their head at every call site, so it was deleted rather than
 * left as a cap nothing approaches. `SubrequestCounter` is what survives, and
 * it survives for ONE reason: the tick's log line reports `subrequestsUsed`,
 * which is real telemetry — it is how an operator sees an event weekend's
 * shape without a tail.
 *
 * `spend` therefore CANNOT FAIL and returns nothing. If a future platform
 * limit ever needs enforcing again, do not resurrect a boolean-returning
 * consume: work out what the tick should DO at the limit first, since the old
 * design's answer (silently drop the event and try next tick) was never
 * visible in a log line.
 *
 * THE ROTATION STAYS, and it is not budget machinery even though the cap is
 * what made it necessary. A `scheduled()` invocation that iterates live events
 * in a stable order and stops early serves the same front-of-list events every
 * tick and never reaches the tail — the tail events are not delayed, they are
 * permanently omitted, and nothing about that is visible in a log. That is a
 * correctness property of the ordering itself, and a 30 s CPU cap is still a
 * per-tick cap, so an early stop is still possible for reasons that have
 * nothing to do with subrequests.
 *
 * The rotation offset a real tick advances lives in D1's `event_cursor` table,
 * beside `last_folded_match_key` and `tba_etag` — co-located with the cursor it
 * advances alongside, the same reasoning `apps/worker/migrations/
 * 0001_algorithm_state.sql`'s `event_cursor` header states for those two
 * columns. (Historical: this was once also argued from KV's free-tier cap of
 * 1,000 writes/day. KV is gone from this Worker entirely as of quick task
 * 260923-3w4, so the co-location reasoning above is the whole reason.) This
 * module is deliberately pure (no D1Database parameter anywhere in it) —
 * persistence is the caller's job, this module only owns the counting and
 * rotation math.
 */

/**
 * A running count of the subrequests one tick spent, for the tick log's
 * `subrequestsUsed` field. Nothing reads it to make a decision; `spend` never
 * refuses. See this module's header for why the cap, the reserve and the
 * deferral semantics were deleted rather than raised.
 */
export class SubrequestCounter {
  #used = 0;

  /** Total subrequests counted so far this tick. */
  get used(): number {
    return this.#used;
  }

  /** Records `n` subrequests about to be (or just) spent. Cannot fail. */
  spend(n = 1): void {
    this.#used += n;
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
 * enumerate events in (JSON iteration order is not a contract) — two ticks
 * reading the same live-events set always rotate over the same starting
 * sequence, so `offset` means the same thing across ticks.
 */
export function sortEventKeys(eventKeys: readonly string[]): string[] {
  return [...eventKeys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
