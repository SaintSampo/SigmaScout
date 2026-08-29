/**
 * Fake `Env` whose KV/R2 handles return canned JSON — asserts binding-call
 * counts, the schema-failure path, and live-set filtering (including the
 * empty case), per this plan's Task 1 acceptance criteria.
 */
import { describe, expect, it } from "vitest";
import {
  ALGORITHMS_MANIFEST_KEY,
  liveEventsAt,
  LiveWindowShapeError,
  loadAlgorithmsManifest,
  loadLiveEventsAt,
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
      { id: "vpr", version: "2.0.0+tuned-2026-08", codeVersion: "2.0.0", paramSetName: "tuned-2026-08" },
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
    bad.algorithms.push({ id: "vpr-adapt", version: "2.0.0+x", codeVersion: "2.0.0", paramSetName: "x" });
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

// ---------------------------------------------------------------------------
// REGRESSION (2026-08-29 outage, cause A). `loadLiveEventsAt` replaced
// `liveEventsAt(await loadLiveWindowsManifest(env), now)` on the tick's hot
// path, because the composed form Zod-validated all ~1,581 published windows
// before answering a question about the two that mattered — 5-9 ms of the
// deployed Worker's 10 ms CPU budget spent on a tick that then did nothing.
// These tests pin BOTH halves of the contract: the selection is identical to
// the old path, and the narrowed-but-not-abandoned validation property holds.
// ---------------------------------------------------------------------------

describe("loadLiveEventsAt", () => {
  const MIXED_WINDOWS = [
    { eventKey: "2022closed", season: 2022, startMs: 0, endMs: 1_000, inferred: false },
    { eventKey: "2026zzzz", season: 2026, startMs: 4_000, endMs: 10_000, inferred: false },
    { eventKey: "2026aaaa", season: 2026, startMs: 0, endMs: 10_000, inferred: true },
    { eventKey: "2027future", season: 2027, startMs: 20_000, endMs: 30_000, inferred: false },
  ];

  function envWith(windows: unknown[]): ReturnType<typeof makeEnv> {
    return makeEnv(new Map([[LIVE_WINDOWS_MANIFEST_KEY, JSON.stringify(validLiveWindowsManifest(windows))]]));
  }

  it("selects exactly the live entries, in event-key order, skipping closed and future ones", async () => {
    const { env } = envWith(MIXED_WINDOWS);
    const live = await loadLiveEventsAt(env, 5_000);
    expect(live.map((w) => w.eventKey)).toEqual(["2026aaaa", "2026zzzz"]);
  });

  it("returns entries fully parsed, not the raw JSON objects", async () => {
    const { env } = envWith(MIXED_WINDOWS);
    const live = await loadLiveEventsAt(env, 5_000);
    expect(live[0]).toEqual({ eventKey: "2026aaaa", season: 2026, startMs: 0, endMs: 10_000, inferred: true });
  });

  it("agrees exactly with the old liveEventsAt(loadLiveWindowsManifest(...)) path it replaced", async () => {
    // The equivalence that made the swap safe. If a future change to either
    // side breaks this, the tick's selection has silently drifted from the
    // fully-validated reference implementation.
    const { env } = envWith(MIXED_WINDOWS);
    for (const epochMs of [-1, 0, 999, 1_000, 3_999, 4_000, 5_000, 9_999, 10_000, 20_000, 25_000, 30_000]) {
      const viaFastPath = await loadLiveEventsAt(env, epochMs);
      const viaFullParse = liveEventsAt(await loadLiveWindowsManifest(env), epochMs);
      expect(viaFastPath).toEqual(viaFullParse);
    }
  });

  it("returns an empty array when nothing is live — the tick's early exit", async () => {
    const { env } = envWith(MIXED_WINDOWS);
    expect(await loadLiveEventsAt(env, 15_000)).toEqual([]);
  });

  it("costs exactly one KV binding call, same as the read it replaced", async () => {
    const { env, kv, r2 } = envWith(MIXED_WINDOWS);
    await loadLiveEventsAt(env, 5_000);
    expect(kv.getCallCount).toBe(1);
    expect(r2.getCallCount).toBe(0);
  });

  it("falls back to R2 when KV has no value yet", async () => {
    const { env, kv, r2 } = makeEnv(
      new Map(),
      new Map([[LIVE_WINDOWS_MANIFEST_KEY, JSON.stringify(validLiveWindowsManifest(MIXED_WINDOWS))]])
    );
    const live = await loadLiveEventsAt(env, 5_000);
    expect(live.map((w) => w.eventKey)).toEqual(["2026aaaa", "2026zzzz"]);
    expect(kv.getCallCount).toBe(1);
    expect(r2.getCallCount).toBe(1);
  });

  it("throws ManifestReadError when neither binding holds the object", async () => {
    const { env } = makeEnv(new Map());
    await expect(loadLiveEventsAt(env, 5_000)).rejects.toBeInstanceOf(ManifestReadError);
  });

  it("throws ManifestValidationError on unparseable JSON", async () => {
    const { env } = makeEnv(new Map([[LIVE_WINDOWS_MANIFEST_KEY, "{not json"]]));
    await expect(loadLiveEventsAt(env, 5_000)).rejects.toBeInstanceOf(ManifestValidationError);
  });

  // --- the envelope is still fully validated ---

  it("still rejects a wrong schemaVersion", async () => {
    const { env } = makeEnv(
      new Map([[LIVE_WINDOWS_MANIFEST_KEY, JSON.stringify({ schemaVersion: 99, generation: "g", computedAt: "c", windows: [] })]])
    );
    await expect(loadLiveEventsAt(env, 5_000)).rejects.toBeInstanceOf(ManifestValidationError);
  });

  it("still rejects a missing generation", async () => {
    const { env } = makeEnv(
      new Map([[LIVE_WINDOWS_MANIFEST_KEY, JSON.stringify({ schemaVersion: 1, computedAt: "c", windows: [] })]])
    );
    await expect(loadLiveEventsAt(env, 5_000)).rejects.toBeInstanceOf(ManifestValidationError);
  });

  it("still rejects a windows field that is not an array", async () => {
    const { env } = makeEnv(
      new Map([[LIVE_WINDOWS_MANIFEST_KEY, JSON.stringify({ schemaVersion: 1, generation: "g", computedAt: "c", windows: { key: {} } })]])
    );
    await expect(loadLiveEventsAt(env, 5_000)).rejects.toBeInstanceOf(ManifestValidationError);
  });

  // --- live entries are still fully validated ---

  it("still rejects a LIVE entry with a malformed non-interval field", async () => {
    const { env } = envWith([{ eventKey: "", season: 2026, startMs: 0, endMs: 10_000, inferred: false }]);
    await expect(loadLiveEventsAt(env, 5_000)).rejects.toBeInstanceOf(ManifestValidationError);
  });

  it("still rejects a LIVE entry with a non-integer startMs", async () => {
    const { env } = envWith([{ eventKey: "2026casj", season: 2026, startMs: 0.5, endMs: 10_000, inferred: false }]);
    await expect(loadLiveEventsAt(env, 5_000)).rejects.toBeInstanceOf(ManifestValidationError);
  });

  // --- an entry whose LIVENESS cannot be decided is a hard failure, never a silent skip ---

  it("throws LiveWindowShapeError for an entry that is not an object, even though it is not live", async () => {
    const { env } = envWith([...MIXED_WINDOWS, "not-an-object"]);
    await expect(loadLiveEventsAt(env, 5_000)).rejects.toBeInstanceOf(LiveWindowShapeError);
  });

  it("throws LiveWindowShapeError for an entry with a non-numeric startMs", async () => {
    const { env } = envWith([{ eventKey: "2026casj", season: 2026, startMs: "0", endMs: 10_000, inferred: false }]);
    await expect(loadLiveEventsAt(env, 5_000)).rejects.toBeInstanceOf(LiveWindowShapeError);
  });

  it("throws LiveWindowShapeError for an entry with a missing endMs", async () => {
    const { env } = envWith([{ eventKey: "2026casj", season: 2026, startMs: 0, inferred: false }]);
    await expect(loadLiveEventsAt(env, 5_000)).rejects.toBeInstanceOf(LiveWindowShapeError);
  });

  it("throws LiveWindowShapeError for a null bound rather than treating it as not-live", async () => {
    // `typeof null === "object"`, and a bare `<= comparison` against null
    // would coerce to 0 and quietly answer "not live" for an entry whose real
    // window is unknown. The guard must reject on type, not on value.
    const { env } = envWith([{ eventKey: "2026casj", season: 2026, startMs: 0, endMs: null, inferred: false }]);
    await expect(loadLiveEventsAt(env, 5_000)).rejects.toBeInstanceOf(LiveWindowShapeError);
  });

  it("LiveWindowShapeError is a ManifestValidationError — callers catching the broader type still catch it", async () => {
    const { env } = envWith(["not-an-object"]);
    await expect(loadLiveEventsAt(env, 5_000)).rejects.toBeInstanceOf(ManifestValidationError);
  });

  // --- the deliberate, developer-accepted trade-off, pinned so it is visible ---

  it("ACCEPTED TRADE-OFF: tolerates a malformed non-interval field on an entry that is NOT live", async () => {
    // Documented in `loadLiveEventsAt`'s header and accepted by the developer
    // on 2026-08-29: the manifest is validated to the depth it is used. The old
    // whole-manifest parse rejected this outright; the tick could not afford
    // what that cost. Note the entry's INTERVAL is still well-formed, so its
    // liveness is decidable and it is genuinely just skipped — an entry whose
    // liveness is UNDECIDABLE still throws (the cases directly above).
    const { env } = envWith([
      { eventKey: 12345, season: "not-a-number", startMs: 20_000, endMs: 30_000, inferred: "maybe" },
      { eventKey: "2026live", season: 2026, startMs: 0, endMs: 10_000, inferred: false },
    ]);
    const live = await loadLiveEventsAt(env, 5_000);
    expect(live.map((w) => w.eventKey)).toEqual(["2026live"]);
  });

  it("REGRESSION (outage shape): answers a 1,581-window manifest with two live entries without validating the other 1,579", async () => {
    // Reproduces the deployed manifest's shape at the time of the outage. This
    // is a behavioural pin rather than a timing assertion (wall-clock timing in
    // CI is not a trustworthy oracle): every non-live entry carries a
    // deliberately schema-INVALID `season`, so the only way this can return the
    // right answer at all is by never running the per-entry schema on them.
    const windows: unknown[] = [];
    for (let i = 0; i < 1_579; i++) {
      windows.push({ eventKey: "2022e" + i, season: "invalid-on-purpose", startMs: 0, endMs: 1_000, inferred: false });
    }
    windows.push({ eventKey: "2026scsc", season: 2026, startMs: 4_000, endMs: 10_000, inferred: true });
    windows.push({ eventKey: "2026azscor", season: 2026, startMs: 4_000, endMs: 10_000, inferred: true });

    const { env } = envWith(windows);
    const live = await loadLiveEventsAt(env, 5_000);
    expect(live.map((w) => w.eventKey)).toEqual(["2026azscor", "2026scsc"]);

    // The old whole-manifest path refuses this same input outright — a direct
    // demonstration of how much more of the object it was forced to touch.
    await expect(loadLiveWindowsManifest(env)).rejects.toBeInstanceOf(ManifestValidationError);
  });
});
