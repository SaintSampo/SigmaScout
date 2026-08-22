/**
 * Fake `Env` whose KV/R2 handles return canned JSON — asserts binding-call
 * counts, the schema-failure path, and live-set filtering (including the
 * empty case), per this plan's Task 1 acceptance criteria.
 */
import { describe, expect, it } from "vitest";
import {
  ALGORITHMS_MANIFEST_KEY,
  liveEventsAt,
  loadAlgorithmsManifest,
  loadLiveWindowsManifest,
  loadManifests,
  LIVE_WINDOWS_MANIFEST_KEY,
  ManifestReadError,
  ManifestValidationError,
} from "../src/liveWindows.js";
import type { Env } from "../src/env.js";

// ---------------------------------------------------------------------------
// Fake KV/R2 bindings — minimal surface (`get`) with call counters.
// ---------------------------------------------------------------------------

class FakeKvNamespace {
  getCallCount = 0;
  constructor(private readonly values: Map<string, string>) {}
  async get(key: string): Promise<string | null> {
    this.getCallCount++;
    return this.values.get(key) ?? null;
  }
}

class FakeR2Object {
  constructor(private readonly value: string) {}
  async text(): Promise<string> {
    return this.value;
  }
}

class FakeR2Bucket {
  getCallCount = 0;
  constructor(private readonly values: Map<string, string>) {}
  async get(key: string): Promise<FakeR2Object | null> {
    this.getCallCount++;
    const value = this.values.get(key);
    return value === undefined ? null : new FakeR2Object(value);
  }
  async put(): Promise<void> {
    throw new Error("not used by liveWindows.ts");
  }
}

function validLiveWindowsManifest(windows: unknown[] = []): unknown {
  return {
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-08-22T00:00:00.000Z",
    windows,
  };
}

function validAlgorithmsManifest(): unknown {
  return {
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-08-22T00:00:00.000Z",
    algorithms: [
      { id: "opr", version: "3.0.0+baseline", codeVersion: "3.0.0", paramSetName: "baseline" },
      { id: "epa", version: "1.0.0+baseline", codeVersion: "1.0.0", paramSetName: "baseline" },
      { id: "sigma1", version: "2.0.0+tuned-2026-08", codeVersion: "2.0.0", paramSetName: "tuned-2026-08" },
    ],
  };
}

function makeEnv(kvValues: Map<string, string>, r2Values: Map<string, string> = new Map()): { env: Env; kv: FakeKvNamespace; r2: FakeR2Bucket } {
  const kv = new FakeKvNamespace(kvValues);
  const r2 = new FakeR2Bucket(r2Values);
  const env = { DB: {} as unknown, ARTIFACTS: r2 as unknown, MANIFEST: kv as unknown, TBA_API_KEY: "test-key" } as Env;
  return { env, kv, r2 };
}

describe("loadLiveWindowsManifest", () => {
  it("costs exactly one KV binding call in the common (KV-hit) case", async () => {
    const kvValues = new Map([[LIVE_WINDOWS_MANIFEST_KEY, JSON.stringify(validLiveWindowsManifest())]]);
    const { env, kv, r2 } = makeEnv(kvValues);
    await loadLiveWindowsManifest(env);
    expect(kv.getCallCount).toBe(1);
    expect(r2.getCallCount).toBe(0);
  });

  it("falls back to R2 when KV has no value yet", async () => {
    const r2Values = new Map([[LIVE_WINDOWS_MANIFEST_KEY, JSON.stringify(validLiveWindowsManifest())]]);
    const { env, kv, r2 } = makeEnv(new Map(), r2Values);
    const manifest = await loadLiveWindowsManifest(env);
    expect(kv.getCallCount).toBe(1);
    expect(r2.getCallCount).toBe(1);
    expect(manifest.windows).toEqual([]);
  });

  it("throws a named ManifestReadError when neither KV nor R2 has the key", async () => {
    const { env } = makeEnv(new Map());
    await expect(loadLiveWindowsManifest(env)).rejects.toBeInstanceOf(ManifestReadError);
  });

  it("throws a named ManifestValidationError rather than returning a partial manifest", async () => {
    const kvValues = new Map([[LIVE_WINDOWS_MANIFEST_KEY, JSON.stringify({ schemaVersion: 1, windows: "not-an-array" })]]);
    const { env } = makeEnv(kvValues);
    await expect(loadLiveWindowsManifest(env)).rejects.toBeInstanceOf(ManifestValidationError);
  });

  it("throws ManifestValidationError on malformed JSON text", async () => {
    const kvValues = new Map([[LIVE_WINDOWS_MANIFEST_KEY, "{not json"]]);
    const { env } = makeEnv(kvValues);
    await expect(loadLiveWindowsManifest(env)).rejects.toBeInstanceOf(ManifestValidationError);
  });
});

describe("loadAlgorithmsManifest", () => {
  it("costs exactly one KV binding call in the common case", async () => {
    const kvValues = new Map([[ALGORITHMS_MANIFEST_KEY, JSON.stringify(validAlgorithmsManifest())]]);
    const { env, kv } = makeEnv(kvValues);
    const manifest = await loadAlgorithmsManifest(env);
    expect(kv.getCallCount).toBe(1);
    expect(manifest.algorithms).toHaveLength(3);
  });

  it("rejects a harness-only algorithm id (D-03)", async () => {
    const bad = validAlgorithmsManifest() as { algorithms: unknown[] };
    bad.algorithms.push({ id: "sigma1-adapt", version: "2.0.0+x", codeVersion: "2.0.0", paramSetName: "x" });
    const kvValues = new Map([[ALGORITHMS_MANIFEST_KEY, JSON.stringify(bad)]]);
    const { env } = makeEnv(kvValues);
    await expect(loadAlgorithmsManifest(env)).rejects.toBeInstanceOf(ManifestValidationError);
  });
});

describe("loadManifests", () => {
  it("reads both manifests, one KV call each in the common case", async () => {
    const kvValues = new Map([
      [LIVE_WINDOWS_MANIFEST_KEY, JSON.stringify(validLiveWindowsManifest())],
      [ALGORITHMS_MANIFEST_KEY, JSON.stringify(validAlgorithmsManifest())],
    ]);
    const { env, kv } = makeEnv(kvValues);
    const manifests = await loadManifests(env);
    expect(kv.getCallCount).toBe(2);
    expect(manifests.liveWindows.windows).toEqual([]);
    expect(manifests.algorithms.algorithms).toHaveLength(3);
  });
});

describe("liveEventsAt", () => {
  it("returns an empty array for a manifest with no currently-open window", () => {
    const manifest = validLiveWindowsManifest([{ eventKey: "2026casj", season: 2026, startMs: 1000, endMs: 2000, inferred: false }]) as Parameters<typeof liveEventsAt>[0];
    expect(liveEventsAt(manifest, 5000)).toEqual([]);
  });

  it("returns exactly the live entries, in event-key order", () => {
    const manifest = validLiveWindowsManifest([
      { eventKey: "2026zzzz", season: 2026, startMs: 0, endMs: 10_000, inferred: false },
      { eventKey: "2026aaaa", season: 2026, startMs: 0, endMs: 10_000, inferred: false },
      { eventKey: "2026notlive", season: 2026, startMs: 20_000, endMs: 30_000, inferred: false },
    ]) as Parameters<typeof liveEventsAt>[0];
    const live = liveEventsAt(manifest, 5000);
    expect(live.map((w) => w.eventKey)).toEqual(["2026aaaa", "2026zzzz"]);
  });
});
