import { describe, expect, it, vi } from "vitest";
import type { ListedObject } from "../packages/harness/r2Client.js";
import { DEFAULT_ARTIFACT_ORIGIN } from "./verifySubsetPublish.js";
import {
  PruneRefusalError,
  assertPruneSelection,
  buildCensus,
  fetchLiveGenerations,
  pageKindOfKey,
  parseCliOptions,
  parseGenerationKey,
  runPrune,
  selectKeysForDeletion,
  type PruneDeps,
  type PruneOptions,
} from "./pruneR2Generations.js";

/**
 * Census-driven R2 prune tool (quick task 260912-tay). Every dependency is
 * injected — listing, deleting, the manifest fetch, the clock, the log and the
 * file writer — so nothing here touches the network, the environment or disk.
 * Fixture ids are limited to vpr/epa/opr/spr/zzz (the identity sweep scans this
 * file too).
 *
 * The refusal tests all assert the same two things: the thrown error's `code`,
 * and that the delete function was NEVER called. A guard that throws after the
 * first DELETE is not a guard.
 */

const NOW = new Date("2026-09-12T12:00:00.000Z");
const OLD = "2026-09-01T00:00:00.000Z";

const LIVE_OPR = "opr@3.2.0+baseline";
const LIVE_EPA = "epa@9.0.0+baseline";
const LIVE_SPR = "spr@3.0.0+baseline";
const ORPHAN_A = "vpr@10.0.0+rolling-2026-09e";
const ORPHAN_NEAR = "vpr@10.0.0+rolling-2026-09ee";
const ORPHAN_X = "xvpr@10.0.0+rolling-2026-09e";
const ORPHAN_EPA = "epa@5.0.0+baseline";

function manifestBody(entries: ReadonlyArray<{ id: unknown; version: unknown }>): string {
  return JSON.stringify({ algorithms: entries });
}

const LIVE_ENTRIES = [
  { id: "opr", version: "3.2.0+baseline" },
  { id: "epa", version: "9.0.0+baseline" },
  { id: "spr", version: "3.0.0+baseline" },
];

function okManifest(entries: ReadonlyArray<{ id: unknown; version: unknown }> = LIVE_ENTRIES): PruneDeps["fetchArtifactFresh"] {
  const body = manifestBody(entries);
  return vi.fn(async () => ({ status: 200, bytes: body.length, body }));
}

/** Keys for one generation: one of each page kind, so byKind is exercised. */
function generationObjects(generation: string, opts: { size?: number; lastModified?: string; count?: number } = {}): ListedObject[] {
  const size = opts.size ?? 100;
  const lastModified = opts.lastModified ?? OLD;
  const shapes = [
    (g: string) => `v1/teams/2024/${g}.json`,
    (g: string) => `v1/team/frc4206/2024/${g}.json`,
    (g: string) => `v1/events/2024/${g}.json`,
    (g: string) => `v1/event/2024casf/${g}.json`,
    (g: string) => `v1/presim/2026mrcmp/${g}.json`,
  ];
  const count = opts.count ?? shapes.length;
  const out: ListedObject[] = [];
  for (let i = 0; i < count; i += 1) {
    const key = i < shapes.length ? shapes[i]!(generation) : `v1/event/2019e${i}/${generation}.json`;
    out.push({ key, size, lastModified });
  }
  return out;
}

const UNVERSIONED: ListedObject[] = [
  { key: "v1/manifest/algorithms.json", size: 50, lastModified: OLD },
  { key: "v1/compare/2024.json", size: 70, lastModified: OLD },
  { key: "v1/compare/2025.json", size: 30, lastModified: OLD },
];

function baseBucket(): ListedObject[] {
  return [
    ...generationObjects(LIVE_OPR),
    ...generationObjects(LIVE_EPA),
    ...generationObjects(LIVE_SPR),
    ...generationObjects(ORPHAN_A, { size: 7 }),
    ...generationObjects(ORPHAN_NEAR, { size: 11 }),
    ...generationObjects(ORPHAN_X, { size: 13 }),
    ...generationObjects(ORPHAN_EPA, { size: 3 }),
    ...UNVERSIONED,
  ];
}

/** A stateful fake bucket: deletes really remove keys, and the next listing sees that. */
function fakeBucket(initial: ListedObject[]) {
  const store = new Map(initial.map((o) => [o.key, o]));
  const listObjects = vi.fn(async () => [...store.values()]);
  const deleteObject = vi.fn(async (_bucket: string, key: string) => {
    store.delete(key);
  });
  return { store, listObjects, deleteObject };
}

interface Harness {
  deps: PruneDeps;
  bucket: ReturnType<typeof fakeBucket>;
  lines: string[];
  written: Map<string, string>;
}

function harness(initial: ListedObject[] = baseBucket(), overrides: Partial<PruneDeps> = {}): Harness {
  const bucket = fakeBucket(initial);
  const lines: string[] = [];
  const written = new Map<string, string>();
  const deps: PruneDeps = {
    listObjects: bucket.listObjects,
    deleteObject: bucket.deleteObject,
    fetchArtifactFresh: okManifest(),
    now: () => NOW,
    log: (line: string) => {
      lines.push(line);
    },
    writeFile: (path: string, contents: string) => {
      written.set(path, contents);
    },
    ...overrides,
  };
  return { deps, bucket, lines, written };
}

function options(overrides: Partial<PruneOptions> = {}): PruneOptions {
  return {
    bucket: "test-bucket",
    origin: "https://origin.test",
    generations: [],
    execute: false,
    concurrency: 4,
    minLiveGenerationObjects: 5,
    recentWriteRefusalHours: 6,
    maxDeleteFailures: 25,
    runId: "run-1",
    ...overrides,
  };
}

async function expectRefusal(promise: Promise<unknown>, code: string): Promise<PruneRefusalError> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(PruneRefusalError);
  expect((caught as PruneRefusalError).code).toBe(code);
  return caught as PruneRefusalError;
}

// ---------------------------------------------------------------------------

describe("parseGenerationKey / pageKindOfKey", () => {
  it("parses one key of each kind", () => {
    expect(parseGenerationKey("v1/teams/2024/vpr@11.0.0+rolling-2026-09g.json")).toEqual({
      generation: "vpr@11.0.0+rolling-2026-09g",
      algorithmId: "vpr",
      version: "11.0.0+rolling-2026-09g",
      kind: "teams",
    });
    expect(parseGenerationKey("v1/team/frc4206/2024/opr@3.2.0+baseline.json")?.kind).toBe("team");
    expect(parseGenerationKey("v1/events/2025/spr@3.0.0.json")?.kind).toBe("events");
    expect(parseGenerationKey("v1/event/2024casf/epa@9.0.0+baseline.json")?.kind).toBe("event");
    expect(parseGenerationKey("v1/presim/2026mrcmp/epa@10.0.0+baseline.json")).toEqual({
      generation: "epa@10.0.0+baseline",
      algorithmId: "epa",
      version: "10.0.0+baseline",
      kind: "presim",
    });
  });

  it("files a generation-shaped final segment under an unknown prefix as kind other", () => {
    expect(parseGenerationKey("v1/weird/zzz@1.0.0.json")?.kind).toBe("other");
    expect(pageKindOfKey("v1/teams/24/x.json")).toBe("other");
    expect(pageKindOfKey("v1/team/frc1/2024/x.json")).toBe("team");
  });

  it("recognises a team key the publisher wrote with a malformed team key (trailing space and slash)", () => {
    // Real key shape from the 2026-09-12 full listing: artifactKey does not validate teamKey.
    expect(parseGenerationKey("v1/team/frc58 //2019/vpr@11.0.0+rolling-2026-09g.json")).toEqual({
      generation: "vpr@11.0.0+rolling-2026-09g",
      algorithmId: "vpr",
      version: "11.0.0+rolling-2026-09g",
      kind: "team",
    });
    expect(pageKindOfKey("v1/team/frc1/24/x.json")).toBe("other");
    expect(pageKindOfKey("v1/team/2024/x.json")).toBe("other");
  });

  it("allows hyphens in the id", () => {
    expect(parseGenerationKey("v1/event/2024casf/zzz-adapt@1.0.0.json")?.algorithmId).toBe("zzz-adapt");
  });

  it("returns null for unversioned and malformed keys", () => {
    for (const key of [
      "v1/compare/2024.json",
      "v1/manifest/algorithms.json",
      "v1/x@y/foo.json",
      "v1/event/2024casf/vpr@1.0.0.json.bak",
      "v1/event/2024casf/vpr@1.0.0",
      "v1/event/2024casf/@1.0.0.json",
      "v1/event/2024casf/Vpr@1.0.0.json",
      "v1/event/2024casf/vpr@.json",
      "v1/event/2024casf/vpr@1@2.json",
    ]) {
      expect(parseGenerationKey(key), key).toBeNull();
    }
  });

  it("keeps near misses distinct", () => {
    const a = parseGenerationKey(`v1/event/2024casf/${ORPHAN_A}.json`)!;
    const near = parseGenerationKey(`v1/event/2024casf/${ORPHAN_NEAR}.json`)!;
    const x = parseGenerationKey(`v1/event/2024casf/${ORPHAN_X}.json`)!;
    expect(a.generation).not.toBe(near.generation);
    expect(near.generation).toBe(ORPHAN_NEAR);
    expect(x.algorithmId).toBe("xvpr");
    expect(x.generation).not.toBe(a.generation);
  });
});

describe("buildCensus", () => {
  it("classifies generations, unversioned and anomalous keys, and the totals add up", () => {
    const anomalous: ListedObject[] = [
      { key: "v1/x@y/foo.json", size: 5, lastModified: OLD },
      { key: "v1/event/2024casf/vpr@1.0.0.json.bak", size: 6, lastModified: OLD },
    ];
    const objects = [...baseBucket(), ...anomalous, { key: `v1/event/2024cur/${ORPHAN_A}.json`, size: 7, lastModified: "2026-09-05T00:00:00.000Z" }];
    const census = buildCensus(objects, new Set([LIVE_OPR, LIVE_EPA, LIVE_SPR]), NOW.toISOString());

    expect(census.takenAt).toBe(NOW.toISOString());
    expect(census.totals.objects).toBe(objects.length);
    expect(census.totals.bytes).toBe(objects.reduce((s, o) => s + o.size, 0));

    const byGen = new Map(census.generations.map((g) => [g.generation, g]));
    expect(byGen.get(LIVE_OPR)?.status).toBe("LIVE");
    expect(byGen.get(ORPHAN_A)?.status).toBe("ORPHAN");
    expect(byGen.get(ORPHAN_A)?.objects).toBe(6);
    expect(byGen.get(ORPHAN_A)?.bytes).toBe(42);
    expect(byGen.get(ORPHAN_A)?.byKind["event"]).toEqual({ objects: 2, bytes: 14 });
    expect(byGen.get(ORPHAN_A)?.byKind["presim"]).toEqual({ objects: 1, bytes: 7 });
    expect(byGen.get(ORPHAN_A)?.newestLastModified).toBe("2026-09-05T00:00:00.000Z");
    expect(byGen.get(ORPHAN_A)?.algorithmId).toBe("vpr");
    expect(byGen.get(ORPHAN_A)?.version).toBe("10.0.0+rolling-2026-09e");

    expect(census.live).toEqual({ generations: 3, objects: 15, bytes: 1500 });
    expect(census.orphan.generations).toBe(4);
    expect(census.unversioned.objects).toBe(3);
    expect(census.unversioned.bytes).toBe(150);
    expect(census.unversioned.byPrefix["v1/compare"]).toEqual({ objects: 2, bytes: 100 });
    expect(census.unversioned.byPrefix["v1/manifest"]).toEqual({ objects: 1, bytes: 50 });
    expect(census.anomalous.objects).toBe(2);
    expect(census.anomalous.bytes).toBe(11);
    expect(census.anomalous.sampleKeys).toEqual(anomalous.map((o) => o.key));

    expect(census.live.objects + census.orphan.objects + census.unversioned.objects + census.anomalous.objects).toBe(census.totals.objects);
    expect(census.live.bytes + census.orphan.bytes + census.unversioned.bytes + census.anomalous.bytes).toBe(census.totals.bytes);

    const bytes = census.generations.map((g) => g.bytes);
    expect([...bytes].sort((a, b) => b - a)).toEqual(bytes);
  });

  it("caps anomalous sample keys at 20", () => {
    const anomalous = Array.from({ length: 30 }, (_, i) => ({ key: `v1/x@${i}/foo.json`, size: 1, lastModified: OLD }));
    const census = buildCensus(anomalous, new Set(), NOW.toISOString());
    expect(census.anomalous.objects).toBe(30);
    expect(census.anomalous.sampleKeys).toHaveLength(20);
  });
});

describe("fetchLiveGenerations", () => {
  it("returns the id@version set and the raw entries", async () => {
    const result = await fetchLiveGenerations("https://origin.test", "run", { fetchArtifactFresh: okManifest() });
    expect([...result.live].sort()).toEqual([LIVE_EPA, LIVE_OPR, LIVE_SPR]);
    expect(result.entries).toEqual(LIVE_ENTRIES);
  });

  const unavailable: Array<[string, PruneDeps["fetchArtifactFresh"]]> = [
    ["the fetch throws", vi.fn(async () => Promise.reject(new Error("offline")))],
    ["a non-200", vi.fn(async () => ({ status: 503, bytes: 0, body: undefined }))],
    ["invalid JSON", vi.fn(async () => ({ status: 200, bytes: 5, body: "{nope" }))],
    ["no algorithms array", vi.fn(async () => ({ status: 200, bytes: 2, body: "{}" }))],
    ["an entry without a string version", okManifest([...LIVE_ENTRIES, { id: "zzz", version: 3 }])],
    ["an entry without a string id", okManifest([{ id: null, version: "1.0.0" }, ...LIVE_ENTRIES])],
    ["zero entries", okManifest([])],
  ];

  for (const [label, fetchArtifactFresh] of unavailable) {
    it(`refuses MANIFEST_UNAVAILABLE when ${label}, before any delete`, async () => {
      await expectRefusal(fetchLiveGenerations("https://origin.test", "run", { fetchArtifactFresh }), "MANIFEST_UNAVAILABLE");

      const h = harness(baseBucket(), { fetchArtifactFresh });
      await expectRefusal(runPrune(options({ generations: [ORPHAN_A], execute: true }), h.deps), "MANIFEST_UNAVAILABLE");
      expect(h.bucket.deleteObject).not.toHaveBeenCalled();
    });
  }

  it("refuses PUBLISHED_ID_NOT_IN_MANIFEST when a published id has no entry", async () => {
    const fetchArtifactFresh = okManifest(LIVE_ENTRIES.filter((e) => e.id !== "spr"));
    const h = harness(baseBucket(), { fetchArtifactFresh });
    await expectRefusal(runPrune(options({ generations: [ORPHAN_A], execute: true }), h.deps), "PUBLISHED_ID_NOT_IN_MANIFEST");
    expect(h.bucket.deleteObject).not.toHaveBeenCalled();
  });

  it("treats a surplus manifest id as LIVE and never refuses it", async () => {
    const fetchArtifactFresh = okManifest([...LIVE_ENTRIES, { id: "vpr", version: "10.0.0+rolling-2026-09e" }]);
    const { live } = await fetchLiveGenerations("https://origin.test", "run", { fetchArtifactFresh });
    expect(live.has(ORPHAN_A)).toBe(true);

    const bucket = baseBucket();
    const h = harness(bucket, { fetchArtifactFresh });
    await expectRefusal(runPrune(options({ generations: [ORPHAN_A], execute: true }), h.deps), "REQUESTED_IS_LIVE");
    expect(h.bucket.deleteObject).not.toHaveBeenCalled();

    const h2 = harness(bucket, { fetchArtifactFresh });
    const result = await runPrune(options({ generations: [ORPHAN_EPA], execute: true }), h2.deps);
    expect(result.ok).toBe(true);
  });
});

describe("selection guards (each refuses before the first DELETE)", () => {
  async function refuses(generations: string[], code: string, bucket: ListedObject[] = baseBucket(), extra: Partial<PruneOptions> = {}) {
    const h = harness(bucket);
    const err = await expectRefusal(runPrune(options({ generations, execute: true, outPath: "report.json", ...extra }), h.deps), code);
    expect(h.bucket.deleteObject).not.toHaveBeenCalled();
    const report = JSON.parse(h.written.get("report.json") ?? "{}") as { refused?: { code: string }; ok?: boolean };
    expect(report.refused?.code).toBe(code);
    expect(report.ok).toBe(false);
    return err;
  }

  it("MALFORMED_GENERATION_ARG on a bad shape", async () => {
    for (const bad of ["vpr", "vpr@", "@1.0.0", "Vpr@1.0.0", "vpr@1.0.0/x", "vpr@1@2", "v1/event/2024casf/vpr@1.0.0.json"]) {
      await refuses([bad], "MALFORMED_GENERATION_ARG");
    }
  });

  it("MALFORMED_GENERATION_ARG on a duplicate", async () => {
    await refuses([ORPHAN_A, ORPHAN_A], "MALFORMED_GENERATION_ARG");
  });

  it("REQUESTED_IS_LIVE", async () => {
    await refuses([ORPHAN_A, LIVE_EPA], "REQUESTED_IS_LIVE");
  });

  it("NOT_IN_CENSUS (the typo guard)", async () => {
    await refuses(["vpr@10.0.0+rolling-2026-09g"], "NOT_IN_CENSUS");
  });

  it("LIVE_MISSING_FROM_CENSUS when a live generation is below the floor", async () => {
    const bucket = baseBucket().filter((o) => !(o.key.includes(LIVE_SPR) && o.key.startsWith("v1/presim/")));
    await refuses([ORPHAN_A], "LIVE_MISSING_FROM_CENSUS", bucket);
  });

  it("LIVE_MISSING_FROM_CENSUS when a live generation is absent entirely", async () => {
    const bucket = baseBucket().filter((o) => !o.key.includes(LIVE_OPR));
    await refuses([ORPHAN_A], "LIVE_MISSING_FROM_CENSUS", bucket);
  });

  it("RECENT_WRITE when a requested generation was written inside the window", async () => {
    const bucket = [...baseBucket(), { key: `v1/event/2024cur/${ORPHAN_A}.json`, size: 1, lastModified: "2026-09-12T09:00:00.000Z" }];
    await refuses([ORPHAN_A], "RECENT_WRITE", bucket);
  });

  it("UNKNOWN_KEY_SHAPE when a selected key has kind other", async () => {
    const bucket = [...baseBucket(), { key: `v1/weird/${ORPHAN_A}.json`, size: 1, lastModified: OLD }];
    await refuses([ORPHAN_A], "UNKNOWN_KEY_SHAPE", bucket);
  });

  it("assertPruneSelection enforces the documented order", () => {
    const live = new Set([LIVE_OPR, LIVE_EPA, LIVE_SPR]);
    const census = buildCensus(baseBucket(), live, NOW.toISOString());
    const opts = { minLiveGenerationObjects: 5, recentWriteRefusalHours: 6, now: NOW };
    expect(() => assertPruneSelection(census, [ORPHAN_A, ORPHAN_NEAR], live, opts)).not.toThrow();
    // Malformed beats live: the shape check runs first.
    expect(() => assertPruneSelection(census, ["bad", LIVE_EPA], live, opts)).toThrow(expect.objectContaining({ code: "MALFORMED_GENERATION_ARG" }));
    expect(() => assertPruneSelection(census, [], live, opts)).toThrow(expect.objectContaining({ code: "MALFORMED_GENERATION_ARG" }));
    expect(() => assertPruneSelection(census, [ORPHAN_A], live, { ...opts, minLiveGenerationObjects: 6 })).toThrow(
      expect.objectContaining({ code: "LIVE_MISSING_FROM_CENSUS" })
    );
    expect(() => assertPruneSelection(census, [ORPHAN_A], live, { ...opts, now: new Date("2026-09-01T03:00:00.000Z") })).toThrow(
      expect.objectContaining({ code: "RECENT_WRITE" })
    );
  });

  it("selectKeysForDeletion refuses SELECTION_MISMATCH when a requested generation is live", () => {
    const live = new Set([LIVE_OPR, LIVE_EPA, LIVE_SPR]);
    expect(() => selectKeysForDeletion(baseBucket(), [LIVE_EPA], live)).toThrow(expect.objectContaining({ code: "SELECTION_MISMATCH" }));
  });

  it("selectKeysForDeletion refuses UNKNOWN_KEY_SHAPE directly", () => {
    const objects = [...baseBucket(), { key: `v1/weird/${ORPHAN_A}.json`, size: 1, lastModified: OLD }];
    expect(() => selectKeysForDeletion(objects, [ORPHAN_A], new Set([LIVE_EPA]))).toThrow(expect.objectContaining({ code: "UNKNOWN_KEY_SHAPE" }));
  });
});

describe("exact selection", () => {
  it("selects only the requested generation, never a near-miss or a substring match", () => {
    const live = new Set([LIVE_OPR, LIVE_EPA, LIVE_SPR]);
    const selection = selectKeysForDeletion(baseBucket(), [ORPHAN_A], live);
    expect(selection.keys).toHaveLength(5);
    expect(selection.keys.every((o) => o.key.endsWith(`/${ORPHAN_A}.json`))).toBe(true);
    expect(selection.byGeneration).toEqual({ [ORPHAN_A]: { objects: 5, bytes: 35 } });
  });

  it("execute deletes exactly the requested generation's keys", async () => {
    const h = harness();
    const result = await runPrune(options({ generations: [ORPHAN_A], execute: true }), h.deps);
    expect(result.ok).toBe(true);
    const deleted = h.bucket.deleteObject.mock.calls.map((c) => c[1]).sort();
    expect(deleted).toEqual(generationObjects(ORPHAN_A).map((o) => o.key).sort());
    expect(h.bucket.deleteObject.mock.calls.every((c) => c[0] === "test-bucket")).toBe(true);
    expect([...h.bucket.store.keys()].some((k) => k.endsWith(`/${ORPHAN_NEAR}.json`))).toBe(true);
    expect([...h.bucket.store.keys()].some((k) => k.endsWith(`/${ORPHAN_X}.json`))).toBe(true);
  });
});

describe("runPrune execute", () => {
  it("happy path: ok, remaining 0 per generation, live unchanged, report written", async () => {
    const h = harness();
    const result = await runPrune(options({ generations: [ORPHAN_A, ORPHAN_EPA], execute: true, outPath: "out/report.json" }), h.deps);

    expect(result.ok).toBe(true);
    expect(h.bucket.listObjects).toHaveBeenCalledTimes(2);
    expect(h.bucket.deleteObject).toHaveBeenCalledTimes(10);
    const report = JSON.parse(h.written.get("out/report.json")!) as Record<string, unknown> & {
      remainingByGeneration: Record<string, number>;
      deletes: { issued: number; succeeded: number; failed: number };
      liveUnchanged: boolean;
      liveDiffs: unknown[];
      preCensus: { totals: { objects: number } };
      postCensus: { totals: { objects: number } };
    };
    expect(report.ok).toBe(true);
    expect(report.refused).toBeNull();
    expect(report.remainingByGeneration).toEqual({ [ORPHAN_A]: 0, [ORPHAN_EPA]: 0 });
    expect(report.deletes).toMatchObject({ issued: 10, succeeded: 10, failed: 0 });
    expect(report.liveUnchanged).toBe(true);
    expect(report.liveDiffs).toEqual([]);
    expect(report.postCensus.totals.objects).toBe(report.preCensus.totals.objects - 10);
    for (const field of ["startedAt", "finishedAt", "requested"]) expect(report).toHaveProperty(field);
  });

  it("post-census failure: a requested key still listed makes the result not ok", async () => {
    const h = harness();
    const stubborn = `v1/presim/2026mrcmp/${ORPHAN_A}.json`;
    h.bucket.deleteObject.mockImplementation(async (_b: string, key: string) => {
      if (key !== stubborn) h.bucket.store.delete(key);
    });
    const result = await runPrune(options({ generations: [ORPHAN_A], execute: true, outPath: "r.json" }), h.deps);
    expect(result.ok).toBe(false);
    const report = JSON.parse(h.written.get("r.json")!) as { remainingByGeneration: Record<string, number> };
    expect(report.remainingByGeneration[ORPHAN_A]).toBe(1);
  });

  it("live drift between pre and post census makes the result not ok", async () => {
    const h = harness();
    const pre = [...h.bucket.store.values()];
    let calls = 0;
    h.bucket.listObjects.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) return pre;
      return [...h.bucket.store.values()].map((o) => (o.key === `v1/teams/2024/${LIVE_EPA}.json` ? { ...o, size: o.size + 1 } : o));
    });
    const result = await runPrune(options({ generations: [ORPHAN_A], execute: true, outPath: "r.json" }), h.deps);
    expect(result.ok).toBe(false);
    const report = JSON.parse(h.written.get("r.json")!) as { liveUnchanged: boolean; liveDiffs: Array<{ generation: string }> };
    expect(report.liveUnchanged).toBe(false);
    expect(report.liveDiffs.map((d) => d.generation)).toEqual([LIVE_EPA]);
  });

  it("failure cap: stops issuing deletes once failures exceed the cap, still runs the post-census, not ok", async () => {
    const bucket = [...baseBucket(), ...generationObjects(ORPHAN_A, { count: 40, size: 2 }).map((o, i) => ({ ...o, key: `v1/event/2019e${i}/${ORPHAN_A}.json` }))];
    const h = harness(bucket);
    h.bucket.deleteObject.mockRejectedValue(new Error("r2Client.deleteObject: DELETE failed with status 403 Forbidden"));
    const result = await runPrune(options({ generations: [ORPHAN_A], execute: true, concurrency: 1, maxDeleteFailures: 3, outPath: "r.json" }), h.deps);
    expect(result.ok).toBe(false);
    expect(h.bucket.deleteObject).toHaveBeenCalledTimes(4);
    expect(h.bucket.listObjects).toHaveBeenCalledTimes(2);
    const report = JSON.parse(h.written.get("r.json")!) as { deletes: { issued: number; failed: number; failures: Array<{ key: string; message: string }> }; postCensus: unknown };
    expect(report.deletes.issued).toBe(4);
    expect(report.deletes.failed).toBe(4);
    expect(report.deletes.failures[0]?.message).toMatch(/403/);
    expect(report.postCensus).not.toBeNull();
  });
});

describe("runPrune preview and census", () => {
  it("preview runs every guard, reports per-generation counts, and deletes nothing", async () => {
    const h = harness();
    const result = await runPrune(options({ generations: [ORPHAN_A, ORPHAN_NEAR] }), h.deps);
    expect(result.ok).toBe(true);
    expect(h.bucket.deleteObject).toHaveBeenCalledTimes(0);
    const text = h.lines.join("\n");
    expect(text).toMatch(new RegExp(`${ORPHAN_A.replace(/[.+]/g, "\\$&")}\\s.*\\b5\\b`));
    expect(text).toContain("PREVIEW");

    const h2 = harness(baseBucket().filter((o) => !o.key.includes(LIVE_OPR)));
    await expectRefusal(runPrune(options({ generations: [ORPHAN_A] }), h2.deps), "LIVE_MISSING_FROM_CENSUS");
    expect(h2.bucket.deleteObject).not.toHaveBeenCalled();
  });

  it("census mode prints the table and one copy-pasteable --generation line covering every orphan, and writes census and keys", async () => {
    const h = harness();
    const result = await runPrune(options({ outPath: "census.json", keysOutPath: "keys.tsv" }), h.deps);
    expect(result.ok).toBe(true);
    expect(h.bucket.deleteObject).not.toHaveBeenCalled();

    const flagLine = h.lines.find((l) => l.trim().startsWith("--generation"));
    expect(flagLine).toBeDefined();
    const flags = [...flagLine!.matchAll(/--generation (\S+)/g)].map((m) => m[1]).sort();
    expect(flags).toEqual([ORPHAN_A, ORPHAN_NEAR, ORPHAN_X, ORPHAN_EPA].sort());

    const census = JSON.parse(h.written.get("census.json")!) as { generations: Array<{ status: string }>; totals: { objects: number } };
    expect(census.totals.objects).toBe(baseBucket().length);
    expect(census.generations.filter((g) => g.status === "LIVE")).toHaveLength(3);

    const tsv = h.written.get("keys.tsv")!.trim().split("\n");
    expect(tsv).toHaveLength(baseBucket().length);
    expect(tsv[0]!.split("\t")).toHaveLength(3);
  });
});

describe("parseCliOptions", () => {
  it("defaults bucket, origin and concurrency", () => {
    const parsed = parseCliOptions([]);
    expect(parsed.bucket).toBe("sigmascout-artifacts");
    expect(parsed.origin).toBe(DEFAULT_ARTIFACT_ORIGIN);
    expect(parsed.concurrency).toBe(24);
    expect(parsed.execute).toBe(false);
    expect(parsed.generations).toEqual([]);
  });

  it("collects repeated --generation values", () => {
    const parsed = parseCliOptions(["--generation", ORPHAN_A, "--generation", ORPHAN_EPA, "--execute", "--out", "r.json"]);
    expect(parsed.generations).toEqual([ORPHAN_A, ORPHAN_EPA]);
    expect(parsed.execute).toBe(true);
    expect(parsed.outPath).toBe("r.json");
  });

  it("rejects --execute with no --generation", () => {
    expect(() => parseCliOptions(["--execute"])).toThrow();
  });

  it("rejects --prefix combined with --generation or --execute", () => {
    expect(() => parseCliOptions(["--prefix", "v1/manifest/", "--generation", ORPHAN_A])).toThrow();
    expect(() => parseCliOptions(["--prefix", "v1/manifest/", "--execute"])).toThrow();
    expect(parseCliOptions(["--prefix", "v1/manifest/"]).prefix).toBe("v1/manifest/");
  });

  it("rejects --concurrency outside 1..64 or non-integer", () => {
    for (const bad of ["0", "65", "1.5", "abc", "-3"]) {
      expect(() => parseCliOptions(["--concurrency", bad]), bad).toThrow();
    }
    expect(parseCliOptions(["--concurrency", "64"]).concurrency).toBe(64);
    expect(parseCliOptions(["--concurrency", "1"]).concurrency).toBe(1);
  });

  it("rejects unknown flags", () => {
    expect(() => parseCliOptions(["--force"])).toThrow();
  });
});
