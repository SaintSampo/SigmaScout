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
/**
 * How many live events one tick processes at once, in each of the four
 * per-event passes (probe, roster, fold, live event). Cloudflare Workers allow
 * six simultaneous open outbound connections per invocation and queue the rest,
 * so six events in flight is the natural match. Defined here, beside the
 * runner, so `liveEventPass.ts` can import it without importing `scheduled.ts`
 * (which imports `liveEventPass.ts`); `scheduled.ts` re-exports it.
 */
export const EVENT_CONCURRENCY = 6;

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

/** Runs the sections handed to it one at a time, in the order they were handed over. */
export interface SerialLock {
  run<T>(section: () => Promise<T>): Promise<T>;
}

/**
 * A lock for the one part of a concurrent tick that must stay sequential: the
 * per-event state read, fold and write, which reads and rewrites each
 * algorithm's shared league row (quick task 261018-3ju). A section that
 * rejects passes its rejection to its own caller and does not block the next
 * section.
 */
export function createSerialLock(): SerialLock {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(section: () => Promise<T>): Promise<T> {
      const result = tail.then(section);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}

/** Runs the sections handed to it one at a time PER KEY, in arrival order; sections on different keys overlap. */
export interface KeyedLock {
  run<T>(key: string, section: () => Promise<T>): Promise<T>;
  /** Keys with a section queued or running. A test seam: drained chains are dropped. */
  readonly size: number;
}

/**
 * A lock per key (quick task 261019-oim). One team's page artifact is read,
 * merged and rewritten by every event that touched the team, so one team at two
 * concurrently folding events must not merge both events over the same stale
 * read: the later write would drop the earlier event's matches. Keyed by the
 * artifact's R2 key, so two different teams never wait for each other. A
 * section that rejects passes its rejection to its own caller only and does not
 * block the next section on that key. A key whose chain has drained is dropped,
 * so the map holds only keys with work queued or running.
 */
export function createKeyedLock(): KeyedLock {
  const tails = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, section: () => Promise<T>): Promise<T> {
      const result = (tails.get(key) ?? Promise.resolve()).then(section);
      const tail = result.catch(() => undefined);
      tails.set(key, tail);
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return result;
    },
    get size(): number {
      return tails.size;
    },
  };
}
