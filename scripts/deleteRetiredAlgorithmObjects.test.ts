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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CorpusEvent, CorpusMatch } from "../packages/ingest/normalize.js";
import { openCorpus, upsertEvent, upsertMatch, type Corpus } from "../packages/corpus/db.js";
import { PUBLISHED_ALGORITHM_IDS } from "../packages/harness/publishedAlgorithms.js";
import {
  assertKeySegment,
  enumerateRetiredKeys,
  EnumerationOutOfBoundsError,
  KeySegmentMismatchError,
  parseCliOptions,
  RefusedLiveAlgorithmIdError,
  RETIRED_KEY_COUNT_BOUNDS,
  stratifiedSample,
} from "./deleteRetiredAlgorithmObjects.js";
import { assertSubsetEntryShape, type SubsetEntry, type TeamSubsetEntry } from "./verifySubsetPublish.js";

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
