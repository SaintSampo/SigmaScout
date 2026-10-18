/**
 * A bounded-concurrency runner for the tick's per-event passes (quick task
 * 261018-3ju). Until 2026-10-18 the probe pass, the roster pass, the fold loop
 * and the live event pass each walked live events one at a time, so a tick's
 * wall time grew with the number of live events and a one-minute cron did not
 * mean one-minute freshness.
 *
 * `mapWithConcurrency` starts items in input order, never keeps more than
 * `limit` in flight, and returns one settled result per item in input order —
 * the same shape `Promise.allSettled` returns. A rejection is reported, never
 * thrown, and never stops the remaining items from starting. Pure: no
 * Workers types, no clock, no I/O.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error(`mapWithConcurrency: limit must be at least 1, got ${limit}`);
  }
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;

  // Each lane takes the next unstarted index synchronously, so two lanes can
  // never claim the same item and items start in input order.
  async function lane(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index] as T, index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  const lanes: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) lanes.push(lane());
  await Promise.all(lanes);
  return results;
}
