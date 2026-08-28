/**
 * Coverage for the two offline-published manifests (D-18/D-03, plan 04-03
 * Task 1): the live-windows half-open-interval contract, the corpus-derived
 * window builder (including the zero-match inferred fallback), and the
 * algorithms manifest's harness-only-id rejection and VPR-version
 * agreement with the committed promoted file.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openCorpus, upsertEvent, upsertMatch, type Corpus } from "../corpus/db.js";
import type { CorpusEvent, CorpusMatch } from "../ingest/normalize.js";
import { opr } from "../core/algorithms/opr.js";
import { epa } from "../core/algorithms/epa.js";
import { PromotedVersionSchema } from "./promote.js";
import {
  AlgorithmsManifestSchema,
  LIVE_WINDOW_PAD_MS,
  LiveWindowsManifestSchema,
  PUBLISHED_ALGORITHM_IDS,
  buildAlgorithmsManifest,
  buildLiveWindowsManifest,
  isLiveAt,
} from "./manifests.js";

const PROMOTED_VPR_VERSION_PATH = join("data", "algorithm-versions", "vpr@2.0.0+tuned-2026-08.json");

let dir: string;
let corpusPath: string;
let db: Corpus;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sigmascout-manifests-"));
  corpusPath = join(dir, "corpus.sqlite");
  db = openCorpus(corpusPath);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function event(overrides: Partial<CorpusEvent> = {}): CorpusEvent {
  return {
    eventKey: "2026azfg",
    year: 2026,
    eventType: 0,
    isOffseason: false,
    startDate: "2026-03-01",
    name: "2026azfg",
    week: null,
    country: null,
    stateProv: null,
    districtKey: null,
    ...overrides,
  };
}

function match(overrides: Partial<CorpusMatch> = {}): CorpusMatch {
  return {
    matchKey: "2026azfg_qm1",
    eventKey: "2026azfg",
    compLevel: "qm",
    matchNumber: 1,
    setNumber: 1,
    sortTime: 1_000_000,
    redTeams: ["frc1", "frc2", "frc3"],
    blueTeams: ["frc4", "frc5", "frc6"],
    redSurrogates: [],
    blueSurrogates: [],
    redDqs: [],
    blueDqs: [],
    winner: "red",
    winnerImputed: false,
    redScore: 100,
    blueScore: 50,
    redRpEarned: 2,
    blueRpEarned: 0,
    hasScoreBreakdown: true,
    scoreBreakdownRaw: '{"red":{}}',
    ...overrides,
  };
}

describe("isLiveAt — half-open interval contract (D-18)", () => {
  it("is false exactly at endMs and true one millisecond before it", () => {
    const window = { startMs: 1_000, endMs: 2_000 };
    expect(isLiveAt(window, window.endMs)).toBe(false);
    expect(isLiveAt(window, window.endMs - 1)).toBe(true);
  });

  it("is true at startMs (closed lower bound)", () => {
    const window = { startMs: 1_000, endMs: 2_000 };
    expect(isLiveAt(window, window.startMs)).toBe(true);
  });

  it("two touching windows [a,b) and [b,c) never both read live at t === b — exactly one does", () => {
    const first = { startMs: 1_000, endMs: 2_000 };
    const second = { startMs: 2_000, endMs: 3_000 };
    const t = 2_000;
    const liveCount = [first, second].filter((w) => isLiveAt(w, t)).length;
    expect(liveCount).toBe(1);
    expect(isLiveAt(first, t)).toBe(false);
    expect(isLiveAt(second, t)).toBe(true);
  });
});

describe("buildLiveWindowsManifest — corpus-derived windows", () => {
  it("derives a window from an event's own match sort_time span, padded by padMs", () => {
    upsertEvent(db, event({ eventKey: "2026azfg" }));
    upsertMatch(db, match({ matchKey: "2026azfg_qm1", sortTime: 1_000_000 }));
    upsertMatch(db, match({ matchKey: "2026azfg_qm2", matchNumber: 2, sortTime: 1_010_000 }));

    const manifest = buildLiveWindowsManifest(db, {
      seasons: [2026],
      padMs: 5_000,
      generation: "test-gen-1",
      computedAt: "2026-08-22T00:00:00.000Z",
    });

    expect(manifest.windows).toHaveLength(1);
    const window = manifest.windows[0]!;
    expect(window.eventKey).toBe("2026azfg");
    expect(window.season).toBe(2026);
    expect(window.startMs).toBe(1_000_000 - 5_000);
    expect(window.endMs).toBe(1_010_000 + 5_000);
    expect(window.inferred).toBe(false);
  });

  it("defaults padMs to LIVE_WINDOW_PAD_MS when not supplied", () => {
    upsertEvent(db, event({ eventKey: "2026azfg" }));
    upsertMatch(db, match({ matchKey: "2026azfg_qm1", sortTime: 1_000_000 }));

    const manifest = buildLiveWindowsManifest(db, {
      seasons: [2026],
      generation: "test-gen-2",
      computedAt: "2026-08-22T00:00:00.000Z",
    });

    const window = manifest.windows[0]!;
    expect(window.startMs).toBe(1_000_000 - LIVE_WINDOW_PAD_MS);
    expect(window.endMs).toBe(1_000_000 + LIVE_WINDOW_PAD_MS);
  });

  it("falls back to [start_date 00:00 UTC, +4 days) and flags inferred: true for an event with zero matches", () => {
    upsertEvent(db, event({ eventKey: "2026scsc", startDate: "2026-08-29" }));

    const manifest = buildLiveWindowsManifest(db, {
      seasons: [2026],
      generation: "test-gen-3",
      computedAt: "2026-08-22T00:00:00.000Z",
    });

    expect(manifest.windows).toHaveLength(1);
    const window = manifest.windows[0]!;
    expect(window.inferred).toBe(true);
    const expectedStart = Date.parse("2026-08-29T00:00:00.000Z");
    expect(window.startMs).toBe(expectedStart);
    expect(window.endMs).toBe(expectedStart + 4 * 24 * 60 * 60 * 1000);
  });

  it("restricts to the requested seasons only", () => {
    upsertEvent(db, event({ eventKey: "2025azfg", year: 2025, startDate: "2025-03-01" }));
    upsertMatch(
      db,
      match({ matchKey: "2025azfg_qm1", eventKey: "2025azfg", sortTime: 500_000 })
    );
    upsertEvent(db, event({ eventKey: "2026azfg" }));
    upsertMatch(db, match({ matchKey: "2026azfg_qm1", sortTime: 1_000_000 }));

    const manifest = buildLiveWindowsManifest(db, {
      seasons: [2026],
      generation: "test-gen-4",
      computedAt: "2026-08-22T00:00:00.000Z",
    });

    expect(manifest.windows.map((w) => w.eventKey)).toEqual(["2026azfg"]);
  });
});

describe("LiveWindowsManifestSchema — preamble required", () => {
  it("fails to parse when generation is absent", () => {
    const malformed = {
      schemaVersion: 1,
      computedAt: "2026-08-22T00:00:00.000Z",
      windows: [],
    };
    expect(() => LiveWindowsManifestSchema.parse(malformed)).toThrow();
  });

  it("fails to parse when computedAt is absent", () => {
    const malformed = {
      schemaVersion: 1,
      generation: "gen-1",
      windows: [],
    };
    expect(() => LiveWindowsManifestSchema.parse(malformed)).toThrow();
  });
});

describe("AlgorithmsManifestSchema — D-03 harness-only rejection", () => {
  function baseManifest(algorithmId: string) {
    return {
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-08-22T00:00:00.000Z",
      algorithms: [{ id: algorithmId, version: "2.0.0+defaults-adapt", codeVersion: "2.0.0", paramSetName: "defaults-adapt" }],
    };
  }

  it("rejects a manifest naming vpr-adapt, with a message naming D-03", () => {
    expect(() => AlgorithmsManifestSchema.parse(baseManifest("vpr-adapt"))).toThrow(/D-03/);
  });

  it("rejects each of the four harness-only ids", () => {
    for (const id of ["vpr-defaults", "vpr-seasonsd", "vpr-normalcdf", "vpr-adapt"]) {
      expect(() => AlgorithmsManifestSchema.parse(baseManifest(id))).toThrow();
    }
  });

  // Test 10 (plan 07-16 Task 1, T-07-16-05): the published id itself is
  // ACCEPTED in the same file that rejects all four harness-only variants —
  // the case that would fail under any prefix/substring test, since `vpr`
  // is a literal prefix of `vpr-adapt` etc. HARNESS_ONLY_ALGORITHM_IDS.has
  // is exact-equality Set membership, never `startsWith`/`includes`.
  it("accepts the published id vpr while rejecting all four harness-only variants", () => {
    expect(() => AlgorithmsManifestSchema.parse(baseManifest("vpr"))).not.toThrow();
    for (const id of ["vpr-defaults", "vpr-seasonsd", "vpr-normalcdf", "vpr-adapt"]) {
      expect(() => AlgorithmsManifestSchema.parse(baseManifest(id))).toThrow();
    }
  });

  it("fails to parse when generation is absent", () => {
    const malformed = {
      schemaVersion: 1,
      computedAt: "2026-08-22T00:00:00.000Z",
      algorithms: [],
    };
    expect(() => AlgorithmsManifestSchema.parse(malformed)).toThrow();
  });
});

describe("buildAlgorithmsManifest — D-03's published set", () => {
  // Test 1 (plan 07-16 Task 1): the manifest's third entry is `vpr`, the
  // renamed publisher-side identity — deliberately asserted against a
  // literal array, NOT `[...PUBLISHED_ALGORITHM_IDS]`. Through 07-16 Task 1
  // and 07-17's write pass, `PUBLISHED_ALGORITHM_IDS` (the browser-facing
  // tier) and this manifest's id were DELIBERATELY different values, so a
  // literal was required to avoid silently re-coupling the two tiers the
  // phase's whole safety property depended on keeping apart. Plan 07-18
  // collapsed the two tiers back into one; the literal stays as written
  // (it is still correct, and a future accidental re-split would now fail
  // this case rather than pass vacuously).
  it("returns exactly 3 entries whose ids are opr, epa, vpr — in that order", () => {
    const manifest = buildAlgorithmsManifest({ generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z" });
    expect(manifest.algorithms).toHaveLength(3);
    expect(manifest.algorithms.map((a) => a.id)).toEqual([opr.id, epa.id, "vpr"]);
  });

  it("reads opr/epa's id and version straight from the modules", () => {
    const manifest = buildAlgorithmsManifest({ generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z" });
    const oprEntry = manifest.algorithms.find((a) => a.id === "opr")!;
    const epaEntry = manifest.algorithms.find((a) => a.id === "epa")!;
    expect(oprEntry.version).toBe(opr.version);
    expect(epaEntry.version).toBe(epa.version);
    expect(oprEntry.params).toBeUndefined();
    expect(epaEntry.params).toBeUndefined();
  });

  // Test 2 (plan 07-16 Task 1): the manifest id is READ from the committed
  // version file's own `id` field, never written as a literal at the
  // construction site — a future literal reintroduced there fails THIS case
  // specifically, because it compares against the file's own parsed field
  // rather than the string "vpr".
  it("the published entry's id strictly equals the id parsed from the committed promoted version file (read, not written)", () => {
    const committed = PromotedVersionSchema.parse(JSON.parse(readFileSync(PROMOTED_VPR_VERSION_PATH, "utf8")));
    const manifest = buildAlgorithmsManifest({ generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z" });
    const vprEntry = manifest.algorithms[2]!;
    expect(vprEntry.id).toBe(committed.id);
  });

  it("the VPR entry's version equals the committed promoted version file's version field (read at test time, never hardcoded)", () => {
    const committed = PromotedVersionSchema.parse(JSON.parse(readFileSync(PROMOTED_VPR_VERSION_PATH, "utf8")));
    const manifest = buildAlgorithmsManifest({ generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z" });
    const vprEntry = manifest.algorithms.find((a) => a.id === "vpr")!;
    expect(vprEntry.version).toBe(committed.version);
    expect(vprEntry.version).toContain("+");
    expect(() => Object.freeze(vprEntry.params)).not.toThrow();
  });

  it("the VPR entry's params parse against Sigma1ParamsSchema (already enforced by AlgorithmsManifestSchema.parse inside buildAlgorithmsManifest, asserted here for presence)", () => {
    const manifest = buildAlgorithmsManifest({ generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z" });
    const vprEntry = manifest.algorithms.find((a) => a.id === "vpr")!;
    expect(vprEntry.params).toBeDefined();
  });
});

describe("PUBLISHED_ALGORITHM_IDS — the single tier again (plan 07-16 Task 2 introduced a transitional second tier, collapsed by plan 07-18 Task 1)", () => {
  // Test 9 (rewritten from 07-16 Task 2's Test 6, not deleted — that case's
  // own source comment named this plan as the one that makes the two
  // tiers equal; deleting it instead would remove the only test that ever
  // knew the transition happened): `PUBLISHED_ALGORITHM_IDS` is once again
  // the ONLY algorithm-id constant this module exports, and its members are
  // the renamed triple in the shipped order.
  it("is the module's only algorithm-id constant, and its members are the renamed triple in the shipped order", async () => {
    expect(PUBLISHED_ALGORITHM_IDS).toEqual(["opr", "epa", "vpr"]);
    expect(Object.keys(await import("./publishedAlgorithms.js"))).toEqual(["PUBLISHED_ALGORITHM_IDS"]);
  });

  // Test 7 (unchanged claim, now a literal comparison since there is only
  // one tier): the published algorithm sits THIRD — the position the
  // shipped ribbon renders it in (D-03's ordering, re-pinned through the
  // rename).
  it("places the published algorithm third", () => {
    expect(PUBLISHED_ALGORITHM_IDS[2]).not.toBe(PUBLISHED_ALGORITHM_IDS[0]);
    expect(PUBLISHED_ALGORITHM_IDS[2]).not.toBe(PUBLISHED_ALGORITHM_IDS[1]);
    expect(PUBLISHED_ALGORITHM_IDS[2]).toBe("vpr");
  });
});
