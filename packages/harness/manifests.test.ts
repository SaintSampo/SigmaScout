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
import { LiveWindowsManifestEnvelopeSchema } from "./manifestSchemas.js";
import {
  AlgorithmsManifestSchema,
  LIVE_WINDOW_PAD_MS,
  LiveWindowsManifestSchema,
  PUBLISHED_ALGORITHM_IDS,
  buildAlgorithmsManifest,
  buildLiveWindowsManifest,
  isLiveAt,
} from "./manifests.js";

const PROMOTED_VPR_VERSION_PATH = join("data", "algorithm-versions", "vpr@3.0.0+tuned-2026-08.json");

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
      nowMs: 0,
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
      nowMs: 0,
      computedAt: "2026-08-22T00:00:00.000Z",
    });

    const window = manifest.windows[0]!;
    expect(window.startMs).toBe(1_000_000 - LIVE_WINDOW_PAD_MS);
    expect(window.endMs).toBe(1_000_000 + LIVE_WINDOW_PAD_MS);
  });

  // ---------------------------------------------------------------------------
  // REGRESSION (2026-08-29 outage, cause B). These replace the old
  // "falls back to [start_date, +4 days) and flags inferred: true" test — the
  // behaviour that test pinned is precisely the defect. A zero-match event's
  // window was a pure guess from `start_date`, and 200 of them sat in the
  // published manifest silently arming four-day spans in which the deployed
  // Worker believed an event was live. Two opened on 2026-08-28 and every cron
  // tick thereafter was killed with `outcome:"exceededCpu"`.
  // ---------------------------------------------------------------------------

  it("REGRESSION: emits NO window at all for an event with zero matches in the corpus", () => {
    upsertEvent(db, event({ eventKey: "2026scsc", startDate: "2026-08-29" }));

    const manifest = buildLiveWindowsManifest(db, {
      seasons: [2026],
      generation: "test-gen-3",
      computedAt: "2026-08-22T00:00:00.000Z",
    });

    expect(manifest.windows).toEqual([]);
  });

  it("REGRESSION: a zero-match event is never live, at any instant across the four days its guessed window used to span", () => {
    // The exact shape of the outage: 2026scsc, offseason, zero matches,
    // start_date 2026-08-29. The old builder gave it
    // [2026-08-29T00:00Z, 2026-09-02T00:00Z) and the Worker dutifully ran its
    // full live path — 38 ms CPU against a 10 ms budget — on every tick in
    // that span. This asserts the end-to-end consequence, not just the absence
    // of a row: the liveness predicate the Worker actually calls must answer
    // "nothing is live" at every hour of the formerly-blind window.
    upsertEvent(db, event({ eventKey: "2026scsc", startDate: "2026-08-29", eventType: 99, isOffseason: true }));

    const manifest = buildLiveWindowsManifest(db, {
      seasons: [2026],
      generation: "test-gen-outage",
      computedAt: "2026-08-28T18:25:43.620Z",
    });

    const blindWindowStart = Date.parse("2026-08-29T00:00:00.000Z");
    const oneHourMs = 60 * 60 * 1000;
    for (let hour = 0; hour < 4 * 24; hour++) {
      const instant = blindWindowStart + hour * oneHourMs;
      const live = manifest.windows.filter((w) => isLiveAt(w, instant));
      expect(live).toEqual([]);
    }
  });

  it("REGRESSION: an OFFSEASON event that has real matches still gets a real window — the fix is zero-match, never event_type", () => {
    // Guards the fix against being "simplified" into an offseason exclusion.
    // Plan 07-17 deliberately made offseason events first-class; a genuinely
    // running offseason event must still be folded live.
    const startMs = Date.parse("2026-08-29T14:00:00.000Z");
    upsertEvent(db, event({ eventKey: "2026azscor", startDate: "2026-08-28", eventType: 99, isOffseason: true }));
    upsertMatch(db, match({ matchKey: "2026azscor_qm1", eventKey: "2026azscor", sortTime: startMs }));

    const manifest = buildLiveWindowsManifest(db, {
      seasons: [2026],
      padMs: 5_000,
      generation: "test-gen-offseason",
      computedAt: "2026-08-28T00:00:00.000Z",
    });

    expect(manifest.windows).toHaveLength(1);
    expect(manifest.windows[0]!.eventKey).toBe("2026azscor");
    expect(manifest.windows[0]!.inferred).toBe(false);
    expect(isLiveAt(manifest.windows[0]!, startMs)).toBe(true);
  });

  it("never emits inferred: true any more — the field survives for old manifests, the emission path does not", () => {
    upsertEvent(db, event({ eventKey: "2026azfg" }));
    upsertMatch(db, match({ matchKey: "2026azfg_qm1", sortTime: Date.parse("2026-03-01T18:00:00.000Z") }));
    upsertEvent(db, event({ eventKey: "2026noma", startDate: "2026-03-05" })); // zero matches

    const manifest = buildLiveWindowsManifest(db, {
      seasons: [2026],
      generation: "test-gen-inferred",
      computedAt: "2026-02-01T00:00:00.000Z",
    });

    expect(manifest.windows.every((w) => w.inferred === false)).toBe(true);
    expect(manifest.windows.map((w) => w.eventKey)).toEqual(["2026azfg"]);
  });
});

describe("buildLiveWindowsManifest — retention: windows that can never be live again (2026-08-29 outage, cause A)", () => {
  // The Worker Zod-validates this manifest inside a 10 ms CPU budget on every
  // single cron tick. 1,542 of the deployed manifest's 1,581 windows belonged
  // to seasons that had ended, which made the do-nothing tick cost 5-9 ms
  // before it did anything at all. Anything that cannot be live for any reader
  // of this manifest must not be shipped in it.

  function windowEndingAt(endMs: number, padMs: number): void {
    upsertEvent(db, event({ eventKey: "2026azfg" }));
    upsertMatch(db, match({ matchKey: "2026azfg_qm1", sortTime: endMs - padMs }));
  }

  it("drops a window that had already closed when the manifest was built", () => {
    windowEndingAt(1_000_000, 5_000);

    const manifest = buildLiveWindowsManifest(db, {
      seasons: [2026],
      padMs: 5_000,
      generation: "test-gen-retention-1",
      computedAt: "2026-08-22T00:00:00.000Z",
      nowMs: 2_000_000,
    });

    expect(manifest.windows).toEqual([]);
  });

  it("drops a window at the exact boundary endMs === nowMs (half-open: it is already not live)", () => {
    windowEndingAt(1_000_000, 5_000);

    const manifest = buildLiveWindowsManifest(db, {
      seasons: [2026],
      padMs: 5_000,
      generation: "test-gen-retention-2",
      computedAt: "2026-08-22T00:00:00.000Z",
      nowMs: 1_000_000,
    });

    expect(manifest.windows).toEqual([]);
  });

  it("keeps a window one millisecond before that boundary — nowMs === endMs - 1 is still live", () => {
    windowEndingAt(1_000_000, 5_000);

    const manifest = buildLiveWindowsManifest(db, {
      seasons: [2026],
      padMs: 5_000,
      generation: "test-gen-retention-3",
      computedAt: "2026-08-22T00:00:00.000Z",
      nowMs: 999_999,
    });

    expect(manifest.windows).toHaveLength(1);
    expect(isLiveAt(manifest.windows[0]!, 999_999)).toBe(true);
  });

  it("keeps a wholly-future window", () => {
    windowEndingAt(5_000_000, 5_000);

    const manifest = buildLiveWindowsManifest(db, {
      seasons: [2026],
      padMs: 5_000,
      generation: "test-gen-retention-4",
      computedAt: "2026-08-22T00:00:00.000Z",
      nowMs: 1_000,
    });

    expect(manifest.windows).toHaveLength(1);
  });

  it("defaults the retention clock to computedAt when nowMs is omitted", () => {
    const closedEnd = Date.parse("2026-03-02T00:00:00.000Z");
    upsertEvent(db, event({ eventKey: "2026azfg" }));
    upsertMatch(db, match({ matchKey: "2026azfg_qm1", sortTime: closedEnd - 5_000 }));
    upsertEvent(db, event({ eventKey: "2026azgg" }));
    upsertMatch(db, match({ matchKey: "2026azgg_qm1", eventKey: "2026azgg", sortTime: Date.parse("2026-09-02T00:00:00.000Z") }));

    const manifest = buildLiveWindowsManifest(db, {
      seasons: [2026],
      padMs: 5_000,
      generation: "test-gen-retention-5",
      computedAt: "2026-08-22T00:00:00.000Z",
    });

    expect(manifest.windows.map((w) => w.eventKey)).toEqual(["2026azgg"]);
  });

  it("refuses to build when computedAt is unparseable and no explicit clock is supplied", () => {
    upsertEvent(db, event({ eventKey: "2026azfg" }));
    upsertMatch(db, match({ matchKey: "2026azfg_qm1" }));

    expect(() =>
      buildLiveWindowsManifest(db, {
        seasons: [2026],
        generation: "test-gen-retention-6",
        computedAt: "not-a-timestamp",
      })
    ).toThrow(/retention filter has no clock/);
  });
});

describe("buildLiveWindowsManifest — season scoping", () => {
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
      nowMs: 0,
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

describe("LiveWindowsManifestEnvelopeSchema — lockstep with LiveWindowsManifestSchema", () => {
  // The envelope exists so the Worker's per-tick read path can prove it has a
  // real, current-schema live-windows manifest without paying to validate all
  // ~1,581 entries (2026-08-29 outage, cause A — see
  // `apps/worker/src/liveWindows.ts`'s `loadLiveEventsAt`). That only holds if
  // the envelope keeps checking EXACTLY the preamble the full schema checks.
  // If someone adds a preamble field to one and not the other, the Worker
  // starts trusting a manifest the publisher would not have produced. These
  // tests are the drift guard the envelope's own doc comment promises.

  const PREAMBLE = { schemaVersion: 1, generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z" };

  it("declares exactly the same top-level fields", () => {
    expect(Object.keys(LiveWindowsManifestEnvelopeSchema.shape).sort()).toEqual(
      Object.keys(LiveWindowsManifestSchema.shape).sort()
    );
  });

  it("agrees with the full schema on every preamble violation", () => {
    const probes: Record<string, unknown> = {
      "valid, empty windows": { ...PREAMBLE, windows: [] },
      "wrong schemaVersion": { ...PREAMBLE, schemaVersion: 2, windows: [] },
      "missing schemaVersion": { generation: "g", computedAt: "c", windows: [] },
      "missing generation": { schemaVersion: 1, computedAt: "c", windows: [] },
      "empty generation": { ...PREAMBLE, generation: "", windows: [] },
      "missing computedAt": { schemaVersion: 1, generation: "g", windows: [] },
      "empty computedAt": { ...PREAMBLE, computedAt: "", windows: [] },
      "missing windows": { ...PREAMBLE },
      "windows is an object": { ...PREAMBLE, windows: {} },
      "windows is a string": { ...PREAMBLE, windows: "[]" },
      "not an object at all": 42,
    };

    for (const [label, probe] of Object.entries(probes)) {
      const fullAccepts = LiveWindowsManifestSchema.safeParse(probe).success;
      const envelopeAccepts = LiveWindowsManifestEnvelopeSchema.safeParse(probe).success;
      expect({ label, envelopeAccepts }).toEqual({ label, envelopeAccepts: fullAccepts });
    }
  });

  it("differs from the full schema ONLY in per-entry validation — the one intended relaxation", () => {
    const withBadEntry = { ...PREAMBLE, windows: [{ eventKey: "", season: "nope", startMs: 0, endMs: 1, inferred: "maybe" }] };
    expect(LiveWindowsManifestSchema.safeParse(withBadEntry).success).toBe(false);
    expect(LiveWindowsManifestEnvelopeSchema.safeParse(withBadEntry).success).toBe(true);
  });
});
