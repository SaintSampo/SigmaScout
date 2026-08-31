import { describe, expect, it } from "vitest";
import { installMockWorker } from "./mockWorker.js";

describe("mockWorker — the double's own contract", () => {
  it("M1: install and restore are symmetric, including restoring an absence", () => {
    expect((globalThis as { Worker?: unknown }).Worker).toBeUndefined();
    const handle = installMockWorker();
    expect(typeof (globalThis as { Worker?: unknown }).Worker).toBe("function");
    handle.restore();
    expect((globalThis as { Worker?: unknown }).Worker).toBeUndefined();
  });

  it("M2: delivery is asynchronous in both directions", async () => {
    const received: unknown[] = [];
    const handle = installMockWorker({
      script: (message, ctx) => {
        received.push(message);
        ctx.post({ echoed: message });
      },
    });
    try {
      const worker = new Worker("m2", {});
      const delivered: unknown[] = [];
      worker.onmessage = (event: MessageEvent) => delivered.push(event.data);
      worker.postMessage({ hello: true });
      // Immediately after postMessage: the script has not yet run and
      // nothing has been delivered. A double that delivered synchronously
      // would let a consumer's test pass on an ordering a real browser
      // would not reproduce.
      expect(received.length).toBe(0);
      expect(delivered.length).toBe(0);
      // After one awaited tick: both directions have completed.
      await Promise.resolve();
      expect(received.length).toBe(1);
      expect(delivered.length).toBe(1);
    } finally {
      handle.restore();
    }
  });

  it("M3: terminate() stops delivery — a post after terminate delivers nothing, and posting to a terminated worker runs no script", async () => {
    let scriptRuns = 0;
    const handle = installMockWorker({
      script: (message, ctx) => {
        scriptRuns++;
        ctx.post({ echoed: message });
      },
    });
    try {
      const worker = new Worker("m3", {});
      const delivered: unknown[] = [];
      worker.onmessage = (event: MessageEvent) => delivered.push(event.data);
      worker.terminate();
      worker.postMessage({ afterTerminate: true });
      await Promise.resolve();
      expect(scriptRuns).toBe(0);
      expect(delivered.length).toBe(0);
    } finally {
      handle.restore();
    }
  });

  it("M4: failOnConstruct throws from the constructor — the construction half of UI-SPEC's S2", () => {
    const constructError = new Error("simulated unsupported-browser construction failure");
    const handle = installMockWorker({ failOnConstruct: constructError });
    try {
      expect(() => new Worker("m4", {})).toThrow(constructError);
    } finally {
      handle.restore();
    }
  });

  it("M5: a throwing script surfaces on onerror and delivers no further messages — the mid-run half of UI-SPEC's S2", async () => {
    const thrown = new Error("simulated mid-run failure");
    let onmessageCalls = 0;
    const handle = installMockWorker({
      script: () => {
        throw thrown;
      },
    });
    try {
      const worker = new Worker("m5", {});
      const errors: Array<{ message: string; error?: unknown }> = [];
      worker.onmessage = () => {
        onmessageCalls++;
      };
      worker.onerror = (event: ErrorEvent) => {
        errors.push(event as unknown as { message: string; error?: unknown });
      };
      worker.postMessage({ anything: true });
      await Promise.resolve();
      expect(errors.length).toBe(1);
      expect(errors[0]?.message).toBe(thrown.message);
      expect(onmessageCalls).toBe(0);
    } finally {
      handle.restore();
    }
  });
});
