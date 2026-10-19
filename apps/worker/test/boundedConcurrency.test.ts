import { describe, expect, it } from "vitest";
import { createKeyedLock, createSerialLock, mapWithConcurrency } from "../src/boundedConcurrency.js";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("mapWithConcurrency", () => {
  it("returns settled results in input order, whatever order the items finish in", async () => {
    const delays = [30, 0, 15, 5];
    const results = await mapWithConcurrency(delays, 4, async (ms, index) => {
      await sleep(ms);
      return `item-${index}`;
    });
    expect(results).toEqual([
      { status: "fulfilled", value: "item-0" },
      { status: "fulfilled", value: "item-1" },
      { status: "fulfilled", value: "item-2" },
      { status: "fulfilled", value: "item-3" },
    ]);
  });

  it("never keeps more than the limit in flight", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async (i) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(i % 2 === 0 ? 5 : 1);
      inFlight--;
      return i;
    });
    expect(maxInFlight).toBe(3);
  });

  it("starts items in input order", async () => {
    const started: number[] = [];
    await mapWithConcurrency([0, 1, 2, 3, 4], 2, async (i) => {
      started.push(i);
      await sleep(i === 0 ? 10 : 1);
      return i;
    });
    expect(started).toEqual([0, 1, 2, 3, 4]);
  });

  it("reports a rejection as { status: 'rejected' } without stopping the other items", async () => {
    const boom = new Error("boom");
    const ran: number[] = [];
    const results = await mapWithConcurrency([0, 1, 2], 1, async (i) => {
      ran.push(i);
      if (i === 1) throw boom;
      return i;
    });
    expect(ran).toEqual([0, 1, 2]);
    expect(results).toEqual([
      { status: "fulfilled", value: 0 },
      { status: "rejected", reason: boom },
      { status: "fulfilled", value: 2 },
    ]);
  });

  it("resolves an empty list to []", async () => {
    let calls = 0;
    const results = await mapWithConcurrency([], 6, async () => {
      calls++;
      return 1;
    });
    expect(results).toEqual([]);
    expect(calls).toBe(0);
  });

  it("does not let a slow first item delay a fast second item from completing", async () => {
    const completed: string[] = [];
    await mapWithConcurrency(["slow", "fast"], 2, async (name) => {
      await sleep(name === "slow" ? 30 : 0);
      completed.push(name);
      return name;
    });
    expect(completed).toEqual(["fast", "slow"]);
  });

  it("throws a plain Error when the limit is below 1", async () => {
    await expect(mapWithConcurrency([1], 0, async (x) => x)).rejects.toThrow(Error);
    await expect(mapWithConcurrency([1], -1, async (x) => x)).rejects.toThrow(/limit must be at least 1/);
  });
});

describe("createSerialLock", () => {
  it("runs sections one at a time, in the order they were handed over, even when callers run concurrently", async () => {
    const lock = createSerialLock();
    const events: string[] = [];
    let inside = 0;
    let maxInside = 0;
    await mapWithConcurrency(["a", "b", "c"], 3, (name) =>
      lock.run(async () => {
        inside++;
        maxInside = Math.max(maxInside, inside);
        events.push(`${name}:start`);
        await sleep(name === "a" ? 20 : 1);
        events.push(`${name}:end`);
        inside--;
        return name;
      })
    );
    expect(maxInside).toBe(1);
    expect(events).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
  });

  it("hands a rejecting section's error to its own caller and still runs the next section", async () => {
    const lock = createSerialLock();
    const boom = new Error("boom");
    const first = lock.run(async () => {
      throw boom;
    });
    const second = lock.run(async () => "ran");
    await expect(first).rejects.toBe(boom);
    await expect(second).resolves.toBe("ran");
  });
});

describe("createKeyedLock (quick task 261019-oim)", () => {
  it("runs two sections on the same key one at a time, in arrival order", async () => {
    const lock = createKeyedLock();
    const events: string[] = [];
    let inside = 0;
    let maxInside = 0;
    const section = (name: string, ms: number) =>
      lock.run("team-1", async () => {
        inside++;
        maxInside = Math.max(maxInside, inside);
        events.push(`${name}:start`);
        await sleep(ms);
        events.push(`${name}:end`);
        inside--;
        return name;
      });
    const results = await Promise.all([section("a", 20), section("b", 1), section("c", 1)]);
    expect(results).toEqual(["a", "b", "c"]);
    expect(maxInside).toBe(1);
    expect(events).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
  });

  it("lets sections on different keys overlap: neither waits for the other", async () => {
    const lock = createKeyedLock();
    const events: string[] = [];
    await Promise.all([
      lock.run("team-1", async () => {
        events.push("1:start");
        await sleep(20);
        events.push("1:end");
      }),
      lock.run("team-2", async () => {
        events.push("2:start");
        await sleep(1);
        events.push("2:end");
      }),
    ]);
    expect(events).toEqual(["1:start", "2:start", "2:end", "1:end"]);
  });

  it("hands a rejecting section's error to its own caller only, and the next section on that key still runs", async () => {
    const lock = createKeyedLock();
    const boom = new Error("boom");
    const first = lock.run("team-1", async () => {
      await sleep(5);
      throw boom;
    });
    const second = lock.run("team-1", async () => "ran");
    await expect(first).rejects.toBe(boom);
    await expect(second).resolves.toBe("ran");
  });

  it("drops a key once every section on it has settled, so size returns to 0", async () => {
    const lock = createKeyedLock();
    const pending = [
      lock.run("team-1", async () => sleep(5)),
      lock.run("team-1", async () => {
        throw new Error("boom");
      }),
      lock.run("team-2", async () => sleep(1)),
    ];
    expect(lock.size).toBe(2);
    await Promise.allSettled(pending);
    // The bookkeeping that drops a drained key runs one turn after the last section settles.
    await sleep(0);
    expect(lock.size).toBe(0);
  });
});
