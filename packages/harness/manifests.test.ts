/**
 * Coverage for the two offline-published manifests: the live-windows
 * half-open-interval contract, the corpus-derived window builder
 * (including the zero-match inferred fallback), and the algorithms
 * manifest built from each published module, and legacy manifest keys
 * stripped on parse.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openCorpus, upsertDistrict, upsertEvent, upsertMatch, type Corpus } from "../corpus/db.js";
import type { CorpusEvent, CorpusMatch } from "../ingest/normalize.js";
import { opr } from "../core/algorithms/opr.js";
import { epa } from "../core/algorithms/epa.js";
import { spr } from "../core/algorithms/spr.js";
import { LiveWindowsManifestEnvelopeSchema } from "./manifestSchemas.js";
import {
  AlgorithmsManifestSchema,
  LIVE_WINDOW_PAD_MS,
  LiveWindowEntrySchema,
  LiveWindowsManifestSchema,
  MANIFEST_SCHEMA_VERSION,
  PROBE_WINDOW_LEAD_MS,
  PROBE_WINDOW_SPAN_MS,
  PUBLISHED_ALGORITHM_IDS,
  buildAlgorithmsManifest,
  buildLiveWindowsManifest,
  isLiveAt,
} from "./manifests.js";

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
    videoKey: null,
    ...overrides,
  };
}

describe("isLiveAt — half-open interval contract", () => {
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
  // A zero-match event's window used to be a pure guess from `start_date`,
  // silently arming a four-day span the deployed Worker treated as fully
  // live and burning its whole CPU budget on it (outage cause B). The two
  // regressions that used to live here asserted "zero matches -> no window
  // at all" — exactly the premise quick task 260920-lny reverses: a
  // zero-match event now DOES get a window (a PROBE window, `inferred:
  // true`), because TBA does not always publish an offseason event's
  // schedule before it starts (Chezy Champs 2026). What still holds from the
  // outage is that the Worker must never treat that window as fully live on
  // its own — it now proves matches exist with one cheap conditional request
  // first (`apps/worker/src/scheduled.ts`'s `runProbes`), which is what makes
  // reintroducing the window safe. See the "probe windows for zero-match
  // events" describe block below (beside the retention block) for the
  // current contract and its coverage.
  // ---------------------------------------------------------------------------

  it("REGRESSION: an OFFSEASON event that has real matches still gets a real window — the fix is zero-match, never event_type", () => {
    // Guards the fix against being "simplified" into an offseason
    // exclusion — a genuinely running offseason event must still be
    // folded live.
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

  it("a matches-only manifest still emits inferred: false on every entry — coverage for the co-located zero-match case lives in the probe describe block below", () => {
    upsertEvent(db, event({ eventKey: "2026azfg" }));
    upsertMatch(db, match({ matchKey: "2026azfg_qm1", sortTime: Date.parse("2026-03-01T18:00:00.000Z") }));

    const manifest = buildLiveWindowsManifest(db, {
      seasons: [2026],
      generation: "test-gen-inferred",
      computedAt: "2026-02-01T00:00:00.000Z",
    });

    expect(manifest.windows.every((w) => w.inferred === false)).toBe(true);
    expect(manifest.windows.map((w) => w.eventKey)).toEqual(["2026azfg"]);
  });
});

describe("buildLiveWindowsManifest — districtKey (10-03): how the Worker finds a live district with no corpus", () => {
  /** `districts.district_key` is TBA's YEAR-PREFIXED key; `events.district_key` is the bare abbreviation. The builder JOINS, never concatenates. */
  function district(overrides: Partial<{ districtKey: string; year: number; abbreviation: string }> = {}) {
    return {
      districtKey: "2026pnw",
      year: 2026,
      abbreviation: "pnw",
      displayName: "Pacific Northwest",
      dcmpSlots: 60 as number | null,
      cmpSlots: 20 as number | null,
      fetchedAt: "2026-03-01T00:00:00.000Z",
      ...overrides,
    };
  }

  function buildOne(generation: string) {
    return buildLiveWindowsManifest(db, { seasons: [2026], padMs: 5_000, generation, nowMs: 0, computedAt: "2026-08-22T00:00:00.000Z" });
  }

  it("emits the YEAR-PREFIXED district key for a district event whose events.district_key is the bare abbreviation", () => {
    upsertDistrict(db, district());
    upsertEvent(db, event({ eventKey: "2026wabon", districtKey: "pnw" }));
    upsertMatch(db, match({ matchKey: "2026wabon_qm1", eventKey: "2026wabon", sortTime: 1_000_000 }));

    const manifest = buildOne("test-gen-district-1");
    expect(manifest.windows).toHaveLength(1);
    expect(manifest.windows[0]!.districtKey).toBe("2026pnw");
  });

  it("emits null for a non-district event", () => {
    upsertDistrict(db, district());
    upsertEvent(db, event({ eventKey: "2026azfg", districtKey: null }));
    upsertMatch(db, match({ matchKey: "2026azfg_qm1", eventKey: "2026azfg", sortTime: 1_000_000 }));

    const manifest = buildOne("test-gen-district-2");
    expect(manifest.windows[0]!.districtKey).toBeNull();
  });

  it("emits null — never a fabricated key — for a district event whose abbreviation has no districts row for that year", () => {
    upsertDistrict(db, district({ districtKey: "2025pnw", year: 2025 }));
    upsertEvent(db, event({ eventKey: "2026wabon", districtKey: "pnw" }));
    upsertMatch(db, match({ matchKey: "2026wabon_qm1", eventKey: "2026wabon", sortTime: 1_000_000 }));

    const manifest = buildOne("test-gen-district-3");
    expect(manifest.windows[0]!.districtKey).toBeNull();
  });

  it("carries districtKey onto a PROBE window too — a zero-match district event stays inferred: true and is not flipped to measured by the new join", () => {
    upsertDistrict(db, district());
    upsertEvent(db, event({ eventKey: "2026wabon", districtKey: "pnw", startDate: "2026-03-05" }));

    const manifest = buildLiveWindowsManifest(db, { seasons: [2026], generation: "test-gen-district-4", computedAt: "2026-03-01T00:00:00.000Z" });
    expect(manifest.windows).toHaveLength(1);
    expect(manifest.windows[0]!.inferred).toBe(true);
    expect(manifest.windows[0]!.districtKey).toBe("2026pnw");
  });

  it("REGRESSION: the districts join moves no pre-existing window — startMs, endMs, inferred and the entry count are unchanged", () => {
    // The exact fixture and the exact values the first two tests in
    // "corpus-derived windows" above pin, rebuilt here with a districts row
    // present so the new LEFT JOIN is exercised on the same inputs.
    upsertDistrict(db, district());
    upsertEvent(db, event({ eventKey: "2026azfg" }));
    upsertMatch(db, match({ matchKey: "2026azfg_qm1", sortTime: 1_000_000 }));
    upsertMatch(db, match({ matchKey: "2026azfg_qm2", matchNumber: 2, sortTime: 1_010_000 }));

    const manifest = buildOne("test-gen-district-5");
    expect(manifest.windows).toHaveLength(1);
    expect(manifest.windows[0]!.startMs).toBe(1_000_000 - 5_000);
    expect(manifest.windows[0]!.endMs).toBe(1_010_000 + 5_000);
    expect(manifest.windows[0]!.inferred).toBe(false);
    expect(manifest.windows[0]!.season).toBe(2026);
  });

  it("counts DISTINCT match keys — `match_count` decides probe-versus-measured, and a count over join rows is exactly the shape that flips a zero-match probe into a fake measured window", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "manifests.ts"), "utf8");
    expect(source).toContain("COUNT(DISTINCT m.match_key)");
  });

  it("LiveWindowEntrySchema accepts an absent districtKey (a manifest published before this phase), a null, and a non-empty string — and rejects an empty string", () => {
    const base = { eventKey: "2026wabon", season: 2026, startMs: 0, endMs: 1, inferred: false };
    expect(() => LiveWindowEntrySchema.parse(base)).not.toThrow();
    expect(() => LiveWindowEntrySchema.parse({ ...base, districtKey: null })).not.toThrow();
    expect(() => LiveWindowEntrySchema.parse({ ...base, districtKey: "2026pnw" })).not.toThrow();
    expect(() => LiveWindowEntrySchema.parse({ ...base, districtKey: "" })).toThrow();
  });

  it("MANIFEST_SCHEMA_VERSION is still 1 — a bump would make the newly deployed Worker reject the manifest sitting in R2 for the whole window between deploy and republish", () => {
    expect(MANIFEST_SCHEMA_VERSION).toBe(1);
  });
});

describe("buildLiveWindowsManifest — retention: windows that can never be live again (the live-windows outage's cause A)", () => {
  // The Worker Zod-validates this manifest on every single cron tick (inside
  // a 10 ms CPU budget when this was learned; 30 s on Workers Paid since
  // 2026-09-22). Anything that cannot be live for any reader of this
  // manifest must not be shipped in it.

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

describe("buildLiveWindowsManifest — probe windows for zero-match events (260920-lny)", () => {
  // TBA does not always publish an offseason event's match schedule before
  // the event starts. Chezy Champs 2026 (`2026cc`) published 86 real matches
  // whose first `sort_time` landed two minutes AFTER the manifest that
  // should have carried its window was built; the corpus held zero matches
  // for it at build time, so under the old rule it got no window at all and
  // was never picked up live. A zero-match event now gets a calendar PROBE
  // window instead — `inferred: true`, proven safe only because the Worker
  // treats `inferred: true` as "answer liveness with one cheap conditional
  // request before doing anything expensive" (`scheduled.test.ts`'s "the
  // tick probes a probe window" coverage), never as foldable on its own.

  it("a zero-match event whose calendar window is still open yields exactly one probe entry, spanning the lead and the span constants", () => {
    upsertEvent(db, event({ eventKey: "2026azpx", startDate: "2026-09-25" })); // zero matches

    const manifest = buildLiveWindowsManifest(db, {
      seasons: [2026],
      generation: "test-gen-probe-1",
      computedAt: "2026-09-20T00:00:00.000Z",
    });

    expect(manifest.windows).toHaveLength(1);
    const window = manifest.windows[0]!;
    const midnightUtc = Date.parse("2026-09-25T00:00:00.000Z");
    expect(window.eventKey).toBe("2026azpx");
    expect(window.season).toBe(2026);
    expect(window.startMs).toBe(midnightUtc - PROBE_WINDOW_LEAD_MS);
    expect(window.endMs).toBe(midnightUtc + PROBE_WINDOW_SPAN_MS);
    expect(window.inferred).toBe(true);
  });

  it("REGRESSION, named for the failure: a zero-match event is live at 2026cc's real first match time, 2026-09-19T16:50:31Z", () => {
    // Reproduces 2026cc's own recorded state at the moment the last manifest
    // publish before the outage was built: start_date 2026-09-19, zero
    // matches in the corpus yet.
    upsertEvent(db, event({ eventKey: "2026cc", startDate: "2026-09-19", eventType: 99, isOffseason: true }));

    const manifest = buildLiveWindowsManifest(db, {
      seasons: [2026],
      generation: "test-gen-probe-2026cc",
      computedAt: "2026-09-19T16:48:47.000Z", // the real last manifest publish before the outage
    });

    expect(manifest.windows).toHaveLength(1);
    const window = manifest.windows[0]!;
    expect(window.inferred).toBe(true);
    expect(isLiveAt(window, Date.parse("2026-09-19T16:50:31.000Z"))).toBe(true);
  });

  it("drops a zero-match event's probe window when it had already closed at build time — retention rule 2 applies to probe entries too", () => {
    upsertEvent(db, event({ eventKey: "2026longgone", startDate: "2026-01-01" })); // zero matches

    const manifest = buildLiveWindowsManifest(db, {
      seasons: [2026],
      generation: "test-gen-probe-closed",
      computedAt: "2026-09-20T00:00:00.000Z", // months after the probe window's own end
    });

    expect(manifest.windows).toEqual([]);
  });

  it("an event WITH matches is unchanged: one inferred: false entry from its own span, no probe entry added alongside it", () => {
    upsertEvent(db, event({ eventKey: "2026azfg" }));
    upsertMatch(db, match({ matchKey: "2026azfg_qm1", sortTime: Date.parse("2026-03-01T18:00:00.000Z") }));

    const manifest = buildLiveWindowsManifest(db, {
      seasons: [2026],
      generation: "test-gen-probe-haswindow",
      computedAt: "2026-02-01T00:00:00.000Z",
    });

    expect(manifest.windows).toHaveLength(1);
    expect(manifest.windows[0]!.eventKey).toBe("2026azfg");
    expect(manifest.windows[0]!.inferred).toBe(false);
  });

  it("an event whose start_date does not parse yields no entry at all, never a NaN interval", () => {
    upsertEvent(db, event({ eventKey: "2026badstart", startDate: "not-a-date" })); // zero matches

    const manifest = buildLiveWindowsManifest(db, {
      seasons: [2026],
      generation: "test-gen-probe-baddate",
      computedAt: "2026-09-20T00:00:00.000Z",
    });

    expect(manifest.windows).toEqual([]);
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

describe("AlgorithmsManifestSchema — legacy keys", () => {
  function baseManifest(algorithmId: string) {
    return {
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-08-22T00:00:00.000Z",
      algorithms: [{ id: algorithmId, version: "2.0.0+defaults-adapt", codeVersion: "2.0.0", paramSetName: "defaults-adapt" }],
    };
  }

  // The entry schema no longer declares a tuned-parameter field.
  // Already-published manifests may still carry that key, so it must be
  // stripped on parse, never rejected.
  it("strips a legacy params key from an already-published entry instead of rejecting it", () => {
    const legacy = baseManifest("spr");
    const withParams = { ...legacy, algorithms: [{ ...legacy.algorithms[0]!, params: { anything: 1 } }] };
    const parsed = AlgorithmsManifestSchema.parse(withParams);
    expect(parsed).toEqual(AlgorithmsManifestSchema.parse(legacy));
    expect(Object.keys(parsed.algorithms[0]!)).not.toContain("params");
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

describe("buildAlgorithmsManifest — the published set", () => {
  it("returns one entry per published id, in PUBLISHED_ALGORITHM_IDS order", () => {
    const manifest = buildAlgorithmsManifest({ generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z" });
    expect(manifest.algorithms).toHaveLength(PUBLISHED_ALGORITHM_IDS.length);
    expect(manifest.algorithms.map((a) => a.id)).toEqual([...PUBLISHED_ALGORITHM_IDS]);
  });

  it("reads opr/epa's id and version straight from the modules", () => {
    const manifest = buildAlgorithmsManifest({ generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z" });
    const oprEntry = manifest.algorithms.find((a) => a.id === "opr")!;
    const epaEntry = manifest.algorithms.find((a) => a.id === "epa")!;
    expect(oprEntry.version).toBe(opr.version);
    expect(epaEntry.version).toBe(epa.version);
    expect(Object.keys(oprEntry)).not.toContain("params");
    expect(Object.keys(epaEntry)).not.toContain("params");
  });

  // Test 2 (plan 07-16 Task 1): the manifest id is READ from the committed
  // version file's own `id` field, never written as a literal at the
  // construction site — a future literal reintroduced there fails THIS case
  // specifically, because it compares against the file's own parsed field
  // rather than the string "vpr".
  // 2026-09-09, VPR's retirement: four cases here described the PROMOTED-VERSION
  // entry — its id read from the committed pinned file, its version, its params,
  // and `paramsSeason` round-tripping onto it alone. VPR was the only
  // promoted-version algorithm, so that path is gone from
  // `buildAlgorithmsManifest` entirely rather than left reading a retired
  // algorithm's file on every publish. These replace them with the contract
  // that is now true.
  it("builds EVERY entry from its own module — no entry is read from a pinned version file", () => {
    const manifest = buildAlgorithmsManifest({ generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z" });
    expect(manifest.algorithms.map((a) => a.id)).toEqual([...PUBLISHED_ALGORITHM_IDS]);
    expect(manifest.algorithms.find((a) => a.id === "opr")!.version).toBe(opr.version);
    expect(manifest.algorithms.find((a) => a.id === "epa")!.version).toBe(epa.version);
    // The premier entry's id and version are read straight from the `spr`
    // module — no override, since 260912-ivg Stage 5 deleted the transitional
    // id-substitution mapping that existed while `PUBLISHED_ALGORITHM_IDS`
    // still named the pre-rename premier id.
    expect(manifest.algorithms.find((a) => a.id === "spr")!.version).toBe(spr.version);
  });

  it("carries no tunable params or paramsSeason on any entry, since no published algorithm is promoted-versioned any more", () => {
    const manifest = buildAlgorithmsManifest({ generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z" });
    for (const entry of manifest.algorithms) {
      expect(Object.keys(entry), `${entry.id} must carry no params`).not.toContain("params");
      expect(entry.paramsSeason, `${entry.id} must carry no paramsSeason`).toBeUndefined();
    }
  });

  it("does NOT advertise the retired vpr id", () => {
    const manifest = buildAlgorithmsManifest({ generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z" });
    expect(manifest.algorithms.some((a) => a.id === "vpr")).toBe(false);
  });
});

describe("PUBLISHED_ALGORITHM_IDS — the single tier", () => {
  // Test 9 (rewritten from the two-tier suite's Test 6, not deleted, since
  // that case was the only test that knew the tier transition happened):
  // `PUBLISHED_ALGORITHM_IDS` is once again
  // the ONLY algorithm-id constant this module exports, and its members are
  // the renamed triple in the shipped order.
  it("is the module's only algorithm-id constant, and its members are the published triple in the shipped order", async () => {
    // vpr removed 2026-09-09 on its retirement from the site.
    // 260912-ivg Stage 1 reopened the two-tier split (mirroring 07-16/07-18)
    // for the bpr -> spr identifier rename; Stage 5 (this test) collapses it
    // back — `PIPELINE_ALGORITHM_IDS` is gone from `publishedAlgorithms.js`
    // entirely, and `PUBLISHED_ALGORITHM_IDS` itself now names the renamed id.
    expect(PUBLISHED_ALGORITHM_IDS).toEqual(["opr", "epa", "spr"]);
    expect(Object.keys(await import("./publishedAlgorithms.js"))).toEqual(["PUBLISHED_ALGORITHM_IDS"]);
  });

  // Test 7 (unchanged claim, now a literal comparison since there is only
  // one tier): the published algorithm sits THIRD — the position the
  // shipped ribbon renders it in (D-03's ordering, re-pinned through the
  // rename).
  // BPR (renamed to SPR by quick task 260912-ivg) replaced VPR as
  // SigmaScout's premier algorithm on 2026-09-09 and holds the same third
  // position the ribbon renders it in.
  it("places the premier algorithm third", () => {
    expect(PUBLISHED_ALGORITHM_IDS[2]).not.toBe(PUBLISHED_ALGORITHM_IDS[0]);
    expect(PUBLISHED_ALGORITHM_IDS[2]).not.toBe(PUBLISHED_ALGORITHM_IDS[1]);
    expect(PUBLISHED_ALGORITHM_IDS[2]).toBe("spr");
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
