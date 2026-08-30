/**
 * TDD RED-first coverage for the one-off retired-algorithm cleanup tool
 * (plan 07-19, Task 1). Every case here is proven failing against no
 * implementation before `deleteRetiredAlgorithmObjects.ts` is written, per
 * this plan's own TDD discipline — see the SUMMARY for the quoted failure.
 *
 * Seeding mirrors `packages/harness/publish.test.ts`'s established pattern
 * (`openCorpus` against a real `mkdtempSync` temp-file database, `upsertEvent`/
 * `upsertMatch`, `afterEach` cleanup) rather than inventing a second one — no
 * network, no live corpus, no credential of any kind.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CorpusEvent, CorpusMatch } from "../packages/ingest/normalize.js";
import { openCorpus, upsertEvent, upsertMatch, type Corpus } from "../packages/corpus/db.js";
import { PUBLISHED_ALGORITHM_IDS } from "../packages/harness/publishedAlgorithms.js";
import {
  assertKeySegment,
  assertVersionNotCurrentlyLive,
  enumerateRetiredKeys,
  enumerateSupersededVersionKeys,
  EnumerationOutOfBoundsError,
  KeySegmentMismatchError,
  LiveManifestFetchError,
  parseCliOptions,
  RefusedLiveAlgorithmIdError,
  RefusedLiveVersionError,
  RETIRED_KEY_COUNT_BOUNDS,
  runProbe,
  stratifiedSample,
} from "./deleteRetiredAlgorithmObjects.js";
import { assertSubsetEntryShape, type SubsetEntry, type TeamSubsetEntry } from "./verifySubsetPublish.js";

const TEST_ORIGIN = "https://example.test";

/** Mirrors `publishAlgorithmsManifest.test.ts`'s own `jsonResponse` helper — builds a `v1/manifest/algorithms.json` response body directly, no real network. */
function manifestResponse(algorithms: readonly { id: string; version: string }[], status = 200): Response {
  return new Response(JSON.stringify({ algorithms }), { status, headers: { "content-type": "application/json" } });
}

const RETIRED_ID = "sigma1";
const VERSION = "2.0.0+tuned-2026-08";

function seasonEvent(overrides: Partial<CorpusEvent> = {}): CorpusEvent {
  return {
    eventKey: "2026casj",
    year: 2026,
    eventType: 0,
    isOffseason: false,
    startDate: "2026-03-01",
    name: "2026casj",
    week: null,
    country: null,
    stateProv: null,
    districtKey: null,
    ...overrides,
  };
}

function seasonMatch(overrides: Partial<CorpusMatch> = {}): CorpusMatch {
  return {
    matchKey: "2026casj_qm1",
    eventKey: "2026casj",
    compLevel: "qm",
    matchNumber: 1,
    setNumber: 1,
    sortTime: 1_000,
    redTeams: ["frc1", "frc2", "frc3"],
    blueTeams: ["frc4", "frc5", "frc6"],
    redSurrogates: [],
    blueSurrogates: [],
    redDqs: [],
    blueDqs: [],
    winner: "red",
    winnerImputed: false,
    redScore: 100,
    blueScore: 80,
    redRpEarned: 2,
    blueRpEarned: 0,
    hasScoreBreakdown: false,
    scoreBreakdownRaw: null,
    ...overrides,
  };
}

describe("deleteRetiredAlgorithmObjects", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-delete-retired-corpus-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
  });

  afterEach(() => {
    db.close();
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------
  // Test 1 — the live-id refusal fires for every live id.
  // ---------------------------------------------------------------------
  describe("Test 1 — live-id refusal", () => {
    it("raises RefusedLiveAlgorithmIdError for every member of PUBLISHED_ALGORITHM_IDS, naming the offending id and the protected set", () => {
      upsertEvent(db, seasonEvent());
      upsertMatch(db, seasonMatch());

      for (const liveId of PUBLISHED_ALGORITHM_IDS) {
        let thrown: unknown;
        try {
          enumerateRetiredKeys(db, { retiredId: liveId, versions: [VERSION], seasons: [2026] });
        } catch (err) {
          thrown = err;
        }
        expect(thrown, `expected enumerateRetiredKeys("${liveId}") to throw`).toBeInstanceOf(RefusedLiveAlgorithmIdError);
        const message = (thrown as Error).message;
        expect(message).toContain(liveId);
        for (const protectedId of PUBLISHED_ALGORITHM_IDS) {
          expect(message).toContain(protectedId);
        }
      }
    });
  });

  // ---------------------------------------------------------------------
  // Test 2 — a missing target is a refusal, not a default.
  // ---------------------------------------------------------------------
  describe("Test 2 — no default destructive target", () => {
    it("parseCliOptions throws when --retired-id is omitted", () => {
      expect(() => parseCliOptions(["--version", VERSION])).toThrow(/--retired-id/);
    });

    it("parseCliOptions throws when --version is omitted (at least one required)", () => {
      expect(() => parseCliOptions(["--retired-id", RETIRED_ID])).toThrow(/--version/);
    });
  });

  // ---------------------------------------------------------------------
  // Test 2b — CR-01: destruction is opt-in via --execute, matching
  // deleteOrphanedDemoTeamObjects.ts's own pinned default.
  // ---------------------------------------------------------------------
  describe("Test 2b — --execute default (CR-01)", () => {
    it("defaults to execute:false — omitting --execute never deletes anything, even with --retired-id/--version supplied", () => {
      expect(parseCliOptions(["--retired-id", RETIRED_ID, "--version", VERSION]).execute).toBe(false);
    });

    it("--execute flips execute:true", () => {
      expect(parseCliOptions(["--retired-id", RETIRED_ID, "--version", VERSION, "--execute"]).execute).toBe(true);
    });

    it("--dry-run is still accepted and does not error when combined with the new flag set", () => {
      const options = parseCliOptions(["--retired-id", RETIRED_ID, "--version", VERSION, "--dry-run"]);
      expect(options.dryRun).toBe(true);
      expect(options.execute).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // Test 3 — the compare page and the manifest are unreachable.
  // ---------------------------------------------------------------------
  describe("Test 3 — compare page and manifest structurally unreachable", () => {
    it("no returned key matches the compare page shape or the manifest key", () => {
      upsertEvent(db, seasonEvent());
      upsertMatch(db, seasonMatch());

      const keys = enumerateRetiredKeys(db, {
        retiredId: RETIRED_ID,
        versions: [VERSION],
        seasons: [2026],
        bounds: { min: 0, max: Number.MAX_SAFE_INTEGER },
      });

      expect(keys.some((k) => k.startsWith("v1/compare/"))).toBe(false);
      expect(keys.some((k) => k === "v1/manifest/algorithms.json")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // Test 4 — every enumerated key carries the retired segment.
  // ---------------------------------------------------------------------
  describe("Test 4 — every key carries the retired segment", () => {
    it("every key returned by a real enumeration contains the retired id immediately followed by '@'", () => {
      upsertEvent(db, seasonEvent());
      upsertMatch(db, seasonMatch());

      const keys = enumerateRetiredKeys(db, {
        retiredId: RETIRED_ID,
        versions: [VERSION],
        seasons: [2026],
        bounds: { min: 0, max: Number.MAX_SAFE_INTEGER },
      });

      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(key).toContain(`${RETIRED_ID}@`);
      }
    });

    it("assertKeySegment rejects a deliberately corrupted key, naming it and the retired id", () => {
      const badKey = "v1/event/2026casj/vpr@2.0.0+tuned-2026-08.json"; // carries the RENAMED id, not the retired one
      let thrown: unknown;
      try {
        assertKeySegment(badKey, RETIRED_ID);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(KeySegmentMismatchError);
      const message = (thrown as Error).message;
      expect(message).toContain(badKey);
      expect(message).toContain(RETIRED_ID);
    });
  });

  // ---------------------------------------------------------------------
  // Test 5 — the count band aborts before any delete.
  // ---------------------------------------------------------------------
  describe("Test 5 — EnumerationOutOfBoundsError both directions", () => {
    it("raises EnumerationOutOfBoundsError when the real (default) bounds are breached below the minimum", () => {
      // A tiny corpus (one event, six teams) is nowhere near RETIRED_KEY_COUNT_BOUNDS.min.
      upsertEvent(db, seasonEvent());
      upsertMatch(db, seasonMatch());

      let thrown: unknown;
      try {
        enumerateRetiredKeys(db, { retiredId: RETIRED_ID, versions: [VERSION], seasons: [2026] });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(EnumerationOutOfBoundsError);
      const message = (thrown as Error).message;
      expect(message).toContain(String(RETIRED_KEY_COUNT_BOUNDS.min));
      expect(message).toContain(String(RETIRED_KEY_COUNT_BOUNDS.max));
    });

    it("raises EnumerationOutOfBoundsError when a (test-supplied) bound is breached above the maximum, reporting the observed count against both bounds", () => {
      upsertEvent(db, seasonEvent({ eventKey: "2026a" }));
      upsertMatch(db, seasonMatch({ matchKey: "2026a_qm1", eventKey: "2026a" }));
      upsertEvent(db, seasonEvent({ eventKey: "2026b", isOffseason: true }));
      upsertMatch(
        db,
        seasonMatch({
          matchKey: "2026b_qm1",
          eventKey: "2026b",
          redTeams: ["frc1", "frc2", "frc3"],
          blueTeams: ["frc7", "frc8", "frc9"],
        })
      );

      const tinyBounds = { min: 0, max: 5 };
      let thrown: unknown;
      try {
        enumerateRetiredKeys(db, { retiredId: RETIRED_ID, versions: [VERSION], seasons: [2026], bounds: tinyBounds });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(EnumerationOutOfBoundsError);
      const message = (thrown as Error).message;
      expect(message).toContain("5"); // max bound
      expect(message).toMatch(/1[0-9]/); // observed count (13) is reported
    });
  });

  // ---------------------------------------------------------------------
  // Test 6 — the enumeration covers all four algorithm-scoped page kinds
  // and the offseason.
  // ---------------------------------------------------------------------
  describe("Test 6 — page-kind coverage and offseason inclusion", () => {
    it("returns exactly one teams key, one events key, one event key per event row (including offseason), and one team key per (team, season) pair (including offseason-only teams)", () => {
      upsertEvent(db, seasonEvent({ eventKey: "2026reg", isOffseason: false }));
      upsertMatch(
        db,
        seasonMatch({
          matchKey: "2026reg_qm1",
          eventKey: "2026reg",
          redTeams: ["frc1", "frc2", "frc3"],
          blueTeams: ["frc4", "frc5", "frc6"],
        })
      );
      upsertEvent(db, seasonEvent({ eventKey: "2026off", isOffseason: true }));
      upsertMatch(
        db,
        seasonMatch({
          matchKey: "2026off_qm1",
          eventKey: "2026off",
          redTeams: ["frc1", "frc2", "frc3"],
          blueTeams: ["frc7", "frc8", "frc9"], // frc7/frc8/frc9 appear ONLY at the offseason event
        })
      );

      const keys = enumerateRetiredKeys(db, {
        retiredId: RETIRED_ID,
        versions: [VERSION],
        seasons: [2026],
        bounds: { min: 0, max: Number.MAX_SAFE_INTEGER },
      });

      const teamsKeys = keys.filter((k) => k.startsWith("v1/teams/"));
      const eventsKeys = keys.filter((k) => k.startsWith("v1/events/"));
      const eventKeys = keys.filter((k) => k.startsWith("v1/event/"));
      const teamKeys = keys.filter((k) => k.startsWith("v1/team/"));

      expect(teamsKeys).toHaveLength(1);
      expect(eventsKeys).toHaveLength(1);
      expect(eventKeys).toHaveLength(2); // one per event row, including the offseason one
      expect(eventKeys.some((k) => k.includes("2026off"))).toBe(true);
      expect(teamKeys).toHaveLength(9); // frc1..frc9, including the three offseason-only teams
      for (const teamKey of ["frc7", "frc8", "frc9"]) {
        expect(teamKeys.some((k) => k.includes(`/${teamKey}/`))).toBe(true);
      }

      expect(keys).toHaveLength(1 + 1 + 2 + 9);
    });
  });

  // ---------------------------------------------------------------------
  // Test 7 — versions multiply the key set.
  // ---------------------------------------------------------------------
  describe("Test 7 — versions multiply the key set", () => {
    it("two --version values produce exactly twice the single-version key count, every key under both", () => {
      upsertEvent(db, seasonEvent());
      upsertMatch(db, seasonMatch());

      const oneVersion = enumerateRetiredKeys(db, {
        retiredId: RETIRED_ID,
        versions: [VERSION],
        seasons: [2026],
        bounds: { min: 0, max: Number.MAX_SAFE_INTEGER },
      });
      const twoVersions = enumerateRetiredKeys(db, {
        retiredId: RETIRED_ID,
        versions: [VERSION, "2.0.0+tracer-check"],
        seasons: [2026],
        bounds: { min: 0, max: Number.MAX_SAFE_INTEGER },
      });

      expect(twoVersions).toHaveLength(oneVersion.length * 2);
      for (const key of oneVersion) {
        const withoutVersion = key.replace(`${RETIRED_ID}@${VERSION}`, `${RETIRED_ID}@__V__`);
        const otherVersionKey = withoutVersion.replace(`${RETIRED_ID}@__V__`, `${RETIRED_ID}@2.0.0+tracer-check`);
        expect(twoVersions).toContain(key);
        expect(twoVersions).toContain(otherVersionKey);
      }
    });
  });

  // ---------------------------------------------------------------------
  // stratifiedSample — reaches its requested count even when small kinds
  // (teams/events: 5 keys each) are capped well below an even split.
  // ---------------------------------------------------------------------
  describe("stratifiedSample — water-filling reaches the requested total", () => {
    it("returns exactly sampleSize keys, spanning all four page kinds, when teams/events are capped far below an even per-kind share", () => {
      const keys: string[] = [];
      for (const kind of ["teams", "events"]) {
        for (let i = 0; i < 5; i++) keys.push(`v1/${kind}/202${i}/sigma1@2.0.0+tuned-2026-08.json`);
      }
      for (let i = 0; i < 500; i++) keys.push(`v1/event/2026evt${i}/sigma1@2.0.0+tuned-2026-08.json`);
      for (let i = 0; i < 5000; i++) keys.push(`v1/team/frc${i}/2026/sigma1@2.0.0+tuned-2026-08.json`);

      const sample = stratifiedSample(keys, 60);
      expect(sample).toHaveLength(60);
      const kinds = new Set(sample.map((k) => k.split("/")[1]));
      expect(kinds).toEqual(new Set(["teams", "events", "event", "team"]));
    });
  });

  // ---------------------------------------------------------------------
  // Version-retirement mode (--supersedes-live) — 07-19-follow-up.
  // Each case is proven to bite: refusing the live version, refusing on
  // manifest fetch failure, allowing a genuinely superseded version, and
  // the probe-path live-id refusal (07-SECURITY.md Observation 1).
  // ---------------------------------------------------------------------
  describe("assertVersionNotCurrentlyLive — the version-retirement guard", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("refuses the version the live manifest currently names, naming the id, the refused version, and the live version", async () => {
      fetchMock.mockResolvedValueOnce(manifestResponse([{ id: "vpr", version: "2.1.0+tuned-2026-08" }]));

      let thrown: unknown;
      try {
        await assertVersionNotCurrentlyLive(TEST_ORIGIN, "vpr", "2.1.0+tuned-2026-08");
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(RefusedLiveVersionError);
      const message = (thrown as Error).message;
      expect(message).toContain("vpr");
      expect(message).toContain("2.1.0+tuned-2026-08");
    });

    it("fails CLOSED (refuses) when the manifest fetch itself throws — a network error never means 'proceed'", async () => {
      fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));

      let thrown: unknown;
      try {
        await assertVersionNotCurrentlyLive(TEST_ORIGIN, "vpr", "2.0.0+tuned-2026-08");
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(LiveManifestFetchError);
      expect((thrown as Error).message).toContain("ECONNRESET");
    });

    it("fails CLOSED when the manifest responds with a non-2xx status", async () => {
      fetchMock.mockResolvedValueOnce(manifestResponse([], 500));

      let thrown: unknown;
      try {
        await assertVersionNotCurrentlyLive(TEST_ORIGIN, "vpr", "2.0.0+tuned-2026-08");
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(LiveManifestFetchError);
      expect((thrown as Error).message).toContain("500");
    });

    it("fails CLOSED when the manifest body is not valid JSON", async () => {
      fetchMock.mockResolvedValueOnce(new Response("not json", { status: 200 }));

      let thrown: unknown;
      try {
        await assertVersionNotCurrentlyLive(TEST_ORIGIN, "vpr", "2.0.0+tuned-2026-08");
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(LiveManifestFetchError);
    });

    it("allows a genuinely superseded version — resolves without throwing when the manifest names a DIFFERENT version for the same live id", async () => {
      fetchMock.mockResolvedValueOnce(
        manifestResponse([
          { id: "opr", version: "3.1.0+baseline" },
          { id: "epa", version: "1.1.0+baseline" },
          { id: "vpr", version: "2.1.0+tuned-2026-08" },
        ])
      );

      await expect(assertVersionNotCurrentlyLive(TEST_ORIGIN, "vpr", "2.0.0+tuned-2026-08")).resolves.toBeUndefined();
    });
  });

  describe("enumerateSupersededVersionKeys — end to end against a seeded corpus", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("refuses via RefusedLiveVersionError before ever touching the corpus, when the target IS the live version", async () => {
      upsertEvent(db, seasonEvent());
      upsertMatch(db, seasonMatch());
      fetchMock.mockResolvedValueOnce(manifestResponse([{ id: "vpr", version: "2.1.0+tuned-2026-08" }]));

      let thrown: unknown;
      try {
        await enumerateSupersededVersionKeys(db, {
          retiredId: "vpr",
          versions: ["2.1.0+tuned-2026-08"],
          seasons: [2026],
          origin: TEST_ORIGIN,
          bounds: { min: 0, max: Number.MAX_SAFE_INTEGER },
        });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(RefusedLiveVersionError);
    });

    it("never runs the id-level RefusedLiveAlgorithmIdError check — a live algorithm id with a genuinely superseded version enumerates real keys, every one carrying the superseded segment", async () => {
      upsertEvent(db, seasonEvent());
      upsertMatch(db, seasonMatch());
      fetchMock.mockResolvedValueOnce(manifestResponse([{ id: "vpr", version: "2.1.0+tuned-2026-08" }]));

      const keys = await enumerateSupersededVersionKeys(db, {
        retiredId: "vpr",
        versions: ["2.0.0+tuned-2026-08"],
        seasons: [2026],
        origin: TEST_ORIGIN,
        bounds: { min: 0, max: Number.MAX_SAFE_INTEGER },
      });

      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(key).toContain("vpr@2.0.0+tuned-2026-08");
      }
    });

    it("still enforces EnumerationOutOfBoundsError even in version-retirement mode", async () => {
      upsertEvent(db, seasonEvent());
      upsertMatch(db, seasonMatch());
      fetchMock.mockResolvedValueOnce(manifestResponse([{ id: "vpr", version: "2.1.0+tuned-2026-08" }]));

      let thrown: unknown;
      try {
        await enumerateSupersededVersionKeys(db, {
          retiredId: "vpr",
          versions: ["2.0.0+tuned-2026-08"],
          seasons: [2026],
          origin: TEST_ORIGIN,
        });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(EnumerationOutOfBoundsError);
    });
  });

  describe("runProbe — the live-id refusal is uniform across both entry points (07-SECURITY.md Observation 1)", () => {
    it("refuses every member of PUBLISHED_ALGORITHM_IDS before issuing any PUT, matching enumerateRetiredKeys's own refusal", async () => {
      for (const liveId of PUBLISHED_ALGORITHM_IDS) {
        let thrown: unknown;
        try {
          await runProbe({ bucket: "unused-bucket", retiredId: liveId, version: "2.0.0+tuned-2026-08", origin: TEST_ORIGIN });
        } catch (err) {
          thrown = err;
        }
        expect(thrown, `expected runProbe("${liveId}") to throw before any PUT`).toBeInstanceOf(RefusedLiveAlgorithmIdError);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Test 8 — an `expectAbsent` entry requires a literal version (PD-05).
// Exercised here (not a new scripts/verifySubsetPublish.test.ts) since this
// is the one test file this task creates — `assertSubsetEntryShape` is
// exported from verifySubsetPublish.ts precisely so it can be unit-tested
// independent of a live fetch.
// ---------------------------------------------------------------------------
describe("verifySubsetPublish — expectAbsent requires a literal version (PD-05, Test 8)", () => {
  it("throws, naming the entry, when an expectAbsent:true SubsetEntry carries no version", () => {
    const badEntry: SubsetEntry = {
      eventKey: "2025isios",
      algorithmId: "sigma1",
      note: "malformed — missing version",
      expectMatches: 43,
      expectUpcoming: 25,
      expectTeams: 45,
      expectRankedTeams: 0,
      expectAlliances: "empty",
      expectVariance: "present",
      expectAbsent: true,
      // version deliberately omitted
    };
    expect(() => assertSubsetEntryShape([badEntry], "PUBLISHED_SUBSET")).toThrow(/2025isios/);
    expect(() => assertSubsetEntryShape([badEntry], "PUBLISHED_SUBSET")).toThrow(/sigma1/);
  });

  it("does not throw when an expectAbsent:true SubsetEntry carries a literal version", () => {
    const goodEntry: SubsetEntry = {
      eventKey: "2025isios",
      algorithmId: "sigma1",
      note: "well-formed",
      expectMatches: 43,
      expectUpcoming: 25,
      expectTeams: 45,
      expectRankedTeams: 0,
      expectAlliances: "empty",
      expectVariance: "present",
      expectAbsent: true,
      version: "2.0.0+tuned-2026-08",
    };
    expect(() => assertSubsetEntryShape([goodEntry], "PUBLISHED_SUBSET")).not.toThrow();
  });

  it("throws, naming the entry, for a malformed TeamSubsetEntry too (same shared shape)", () => {
    const badTeamEntry: TeamSubsetEntry = {
      teamKey: "frc4206",
      year: 2024,
      algorithmId: "sigma1",
      note: "malformed — missing version",
      expectPlayoffRows: 25,
      expectAbsent: true,
    };
    expect(() => assertSubsetEntryShape([badTeamEntry], "PUBLISHED_TEAM_SUBSET")).toThrow(/frc4206/);
  });

  it("does not throw for an ordinary presence entry carrying neither field", () => {
    const presenceEntry: SubsetEntry = {
      eventKey: "2024casf",
      algorithmId: "opr",
      note: "ordinary presence entry",
      expectMatches: 87,
      expectUpcoming: 0,
      expectTeams: 43,
      expectRankedTeams: 43,
      expectAlliances: "populated",
      expectVariance: "absent",
    };
    expect(() => assertSubsetEntryShape([presenceEntry], "PUBLISHED_SUBSET")).not.toThrow();
  });
});
