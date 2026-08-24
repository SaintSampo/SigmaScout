/**
 * Coverage for the two offline-published manifests (D-18/D-03, plan 04-03
 * Task 1): the live-windows half-open-interval contract, the corpus-derived
 * window builder (including the zero-match inferred fallback), and the
 * algorithms manifest's harness-only-id rejection and Sigma1-version
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

const PROMOTED_SIGMA1_VERSION_PATH = join("data", "algorithm-versions", "sigma1@2.0.0+tuned-2026-08.json");

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

  it("rejects a manifest naming sigma1-adapt, with a message naming D-03", () => {
    expect(() => AlgorithmsManifestSchema.parse(baseManifest("sigma1-adapt"))).toThrow(/D-03/);
  });

  it("rejects each of the four harness-only ids", () => {
    for (const id of ["sigma1-defaults", "sigma1-seasonsd", "sigma1-normalcdf", "sigma1-adapt"]) {
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
  it("returns exactly 3 entries whose ids are opr, epa, sigma1", () => {
    const manifest = buildAlgorithmsManifest({ generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z" });
    expect(manifest.algorithms).toHaveLength(3);
    expect(manifest.algorithms.map((a) => a.id)).toEqual([...PUBLISHED_ALGORITHM_IDS]);
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

  it("the Sigma1 entry's version equals the committed promoted version file's version field (read at test time, never hardcoded)", () => {
    const committed = PromotedVersionSchema.parse(JSON.parse(readFileSync(PROMOTED_SIGMA1_VERSION_PATH, "utf8")));
    const manifest = buildAlgorithmsManifest({ generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z" });
    const sigma1Entry = manifest.algorithms.find((a) => a.id === "sigma1")!;
    expect(sigma1Entry.version).toBe(committed.version);
    expect(sigma1Entry.version).toContain("+");
    expect(() => Object.freeze(sigma1Entry.params)).not.toThrow();
  });

  it("the Sigma1 entry's params parse against Sigma1ParamsSchema (already enforced by AlgorithmsManifestSchema.parse inside buildAlgorithmsManifest, asserted here for presence)", () => {
    const manifest = buildAlgorithmsManifest({ generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z" });
    const sigma1Entry = manifest.algorithms.find((a) => a.id === "sigma1")!;
    expect(sigma1Entry.params).toBeDefined();
  });
});
