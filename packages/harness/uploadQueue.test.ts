import { describe, expect, it, vi } from "vitest";
import { UploadQueue } from "./uploadQueue.js";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every queued microtask and resolved-promise continuation run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("UploadQueue", () => {
  it("rejects a concurrency below 1 and a maxPending below concurrency", () => {
    expect(() => new UploadQueue({ concurrency: 0 })).toThrow();
    expect(() => new UploadQueue({ concurrency: 4, maxPending: 3 })).toThrow();
  });

  it("caps concurrency: 200 tasks released in random order never exceed the cap in flight, reach it, and all complete", async () => {
    const concurrency = 8;
    const queue = new UploadQueue({ concurrency, maxPending: 16 });
    const random = mulberry32(2026);
    let inFlight = 0;
    let peak = 0;
    let completed = 0;
    const running: Deferred[] = [];

    // A releaser that settles a random running task whenever one exists.
    let producing = true;
    const releaser = (async () => {
      while (producing || running.length > 0 || completed < 200) {
        await flush();
        if (running.length > 0) {
          const index = Math.floor(random() * running.length);
          running.splice(index, 1)[0]!.resolve();
        }
        if (!producing && completed === 200) break;
      }
    })();

    for (let i = 0; i < 200; i++) {
      await queue.enqueue(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        const gate = deferred();
        running.push(gate);
        await gate.promise;
        inFlight--;
        completed++;
      });
    }
    producing = false;
    await queue.drain();
    await releaser;

    expect(peak).toBeLessThanOrEqual(concurrency);
    expect(peak).toBe(concurrency);
    expect(completed).toBe(200);
  });

  it("drains cleanly when tasks finish in reverse order, running every task exactly once", async () => {
    const queue = new UploadQueue({ concurrency: 5, maxPending: 5 });
    const gates: Deferred[] = [];
    const runs = new Array<number>(5).fill(0);
    for (let i = 0; i < 5; i++) {
      const gate = deferred();
      gates.push(gate);
      await queue.enqueue(async () => {
        runs[i]!++;
        await gate.promise;
      });
    }
    await flush();
    for (const gate of [...gates].reverse()) {
      gate.resolve();
      await flush();
    }
    await queue.drain();
    expect(runs).toEqual([1, 1, 1, 1, 1]);
  });

  it("backpressure: with concurrency 2 and maxPending 4, the fifth enqueue does not resolve until a running task settles", async () => {
    const queue = new UploadQueue({ concurrency: 2, maxPending: 4 });
    const gates = [deferred(), deferred(), deferred(), deferred()];
    for (const gate of gates) await queue.enqueue(() => gate.promise);

    let fifthAccepted = false;
    const fifth = queue.enqueue(async () => {}).then(() => {
      fifthAccepted = true;
    });
    await flush();
    expect(fifthAccepted).toBe(false);

    gates[0]!.resolve();
    await fifth;
    expect(fifthAccepted).toBe(true);

    for (const gate of gates) gate.resolve();
    await queue.drain();
  });

  it("error propagation: drain and later enqueues reject with the first error, waiting tasks never start, no unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const queue = new UploadQueue({ concurrency: 1, maxPending: 3 });
      const boom = new Error("put failed");
      const failing = deferred();
      const neverStarted = vi.fn(async () => {});

      await queue.enqueue(() => failing.promise);
      await queue.enqueue(neverStarted);
      await queue.enqueue(neverStarted);

      failing.reject(boom);
      await flush();

      await expect(queue.drain()).rejects.toBe(boom);
      await expect(queue.enqueue(async () => {})).rejects.toBe(boom);
      expect(neverStarted).not.toHaveBeenCalled();

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("an enqueue blocked on backpressure rejects with the first error once a task fails", async () => {
    const queue = new UploadQueue({ concurrency: 1, maxPending: 1 });
    const boom = new Error("put failed");
    const failing = deferred();
    await queue.enqueue(() => failing.promise);
    const blocked = queue.enqueue(async () => {});
    failing.reject(boom);
    await expect(blocked).rejects.toBe(boom);
    await expect(queue.drain()).rejects.toBe(boom);
  });

  it("drain on an empty queue resolves", async () => {
    await expect(new UploadQueue({ concurrency: 3 }).drain()).resolves.toBeUndefined();
  });

  it("abandon drops tasks still waiting for a slot and waits for in-flight tasks, ignoring their outcome", async () => {
    const queue = new UploadQueue({ concurrency: 1, maxPending: 3 });
    const inFlight = deferred();
    const waiting = vi.fn(async () => {});
    await queue.enqueue(() => inFlight.promise);
    await queue.enqueue(waiting);

    let abandoned = false;
    const abandoning = queue.abandon().then(() => {
      abandoned = true;
    });
    await flush();
    expect(abandoned).toBe(false);
    inFlight.reject(new Error("ignored"));
    await abandoning;
    expect(waiting).not.toHaveBeenCalled();
  });
});
