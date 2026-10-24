/**
 * The roster-season read-back (quick task 261024-lfa). No network and no credential: every fetch is
 * injected, and the fixture bodies are built by the publisher's own builders so the verifier is checked
 * against the exact shapes a real `--roster-seasons-only` run uploads.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openCorpus, openCorpusReadOnly, upsertEvent, upsertEventTeam, upsertTeam, type Corpus } from "../packages/corpus/db.js";
import type { CorpusEvent } from "../packages/ingest/normalize.js";
import { buildEventArtifact, buildEventsArtifact, buildTeamsArtifact } from "../packages/harness/publish.js";
import { buildAlgorithmsManifest, PUBLISHED_ALGORITHM_MODULES } from "../packages/harness/manifests.js";
import { artifactKey } from "../packages/harness/pageArtifacts.js";
import { ALGORITHMS_MANIFEST_KEY, type FreshFetchResult } from "./verifySubsetPublish.js";
import { compareRosterSeason, verifyRosterSeasons, type VerifyRosterSeasonsDeps } from "./verifyRosterSeason.js";

const SEASON = 2027;
const NOW_MS = Date.parse("2026-10-24T12:00:00Z");
const COMPUTED_AT = "2026-10-24T12:00:00.000Z";
const GENERATION = "roster-verify-test";
/** Three real teams, inserted out of number order. The demo key `frc9999` is registered too and must never count. */
const ROSTER = ["frc254", "frc1678", "frc33"];
const NICKNAMES: Record<string, string> = { frc254: "The Cheesy Poofs", frc1678: "Citrus Circuits", frc33: "Killer Bees" };
const IDS = Object.keys(PUBLISHED_ALGORITHM_MODULES);

function event(eventKey: string, startDate: string, overrides: Partial<CorpusEvent> = {}): CorpusEvent {
  return {
    eventKey,
    year: SEASON,
    eventType: 0,
    isOffseason: false,
    startDate,
    name: `${eventKey} name`,
    week: 1,
    country: null,
    stateProv: null,
    districtKey: null,
    ...overrides,
  };
}

function seed(db: Corpus): void {
  upsertEvent(db, event("2027abca", "2027-03-05", { name: "Alberta Regional", week: 0 }));
  upsertEvent(db, event("2027micmp", "2027-04-01", { name: "Michigan Championship", eventType: 2, week: 5, districtKey: "fim" }));
  for (const teamKey of ROSTER) {
    upsertTeam(db, { teamKey, teamNumber: Number(teamKey.slice(3)), nickname: NICKNAMES[teamKey]!, rookieYear: null });
    upsertEventTeam(db, { eventKey: "2027abca", teamKey, fetchedAt: COMPUTED_AT });
  }
  upsertEventTeam(db, { eventKey: "2027abca", teamKey: "frc9999", fetchedAt: COMPUTED_AT });
}

interface FixtureOverrides {
  /** Replace a row's teamCount in every events list. */
  readonly teamCountFor?: Record<string, number>;
  /** The roster the 2027abca page carries. Defaults to the corpus roster. */
  readonly abcaPageRoster?: readonly string[];
}

/** Every object a correct roster publish writes for SEASON, keyed by R2 key, plus the live algorithms manifest. */
function fixtureBodies(overrides: FixtureOverrides = {}): Map<string, string> {
  const bodies = new Map<string, string>();
  bodies.set(ALGORITHMS_MANIFEST_KEY, JSON.stringify(buildAlgorithmsManifest({ generation: GENERATION, computedAt: COMPUTED_AT })));
  const abcaRoster = overrides.abcaPageRoster ?? ROSTER;
  const rosterRows = (keys: readonly string[]) =>
    keys
      .map((teamKey) => ({ teamKey, teamNumber: Number(teamKey.slice(3)), nickname: NICKNAMES[teamKey] ?? teamKey, metrics: {} }))
      .sort((a, b) => a.teamNumber - b.teamNumber);
  const rows = [
    { eventKey: "2027abca", name: "Alberta Regional", eventType: 0, isOffseason: false, startDate: "2027-03-05", week: 0, teamCount: 3, matchCount: 0, playedMatchCount: 0, country: null, stateProv: null, districtKey: null },
    { eventKey: "2027micmp", name: "Michigan Championship", eventType: 2, isOffseason: false, startDate: "2027-04-01", week: 5, teamCount: 0, matchCount: 0, playedMatchCount: 0, country: null, stateProv: null, districtKey: "fim" },
  ].map((r) => ({ ...r, teamCount: overrides.teamCountFor?.[r.eventKey] ?? r.teamCount }));
  for (const mod of Object.values(PUBLISHED_ALGORITHM_MODULES)) {
    const base = { season: SEASON, algorithmId: mod.id, algorithmVersion: mod.version, generation: GENERATION, computedAt: COMPUTED_AT };
    bodies.set(artifactKey({ page: "events", year: SEASON, algorithmId: mod.id, version: mod.version }), JSON.stringify(buildEventsArtifact({ ...base, events: rows })));
    bodies.set(artifactKey({ page: "teams", year: SEASON, algorithmId: mod.id, version: mod.version }), JSON.stringify(buildTeamsArtifact({ ...base, teams: [] })));
    for (const [eventKey, name, roster] of [
      ["2027abca", "Alberta Regional", abcaRoster],
      ["2027micmp", "Michigan Championship", []],
    ] as const) {
      const page = buildEventArtifact({
        ...base,
        eventKey,
        predictions: [],
        upcoming: [],
        teams: rosterRows(roster),
        allianceTeams: [],
        eventMeta: { name, startDate: "2027-03-05", country: null, stateProv: null, week: 1 },
        alliances: [],
        eventType: 0,
      });
      bodies.set(artifactKey({ page: "event", eventKey, algorithmId: mod.id, version: mod.version }), JSON.stringify(page));
    }
  }
  return bodies;
}

function fetcherFor(bodies: ReadonlyMap<string, string>) {
  return vi.fn(async (key: string): Promise<FreshFetchResult> => {
    const body = bodies.get(key);
    return body === undefined ? { status: 404, bytes: 0, body: undefined } : { status: 200, bytes: body.length, body };
  });
}

describe("verifyRosterSeasons", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-roster-verify-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
    seed(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function deps(fetchFresh: VerifyRosterSeasonsDeps["fetchFresh"]): VerifyRosterSeasonsDeps {
    // The verifier closes what openDb hands it, so hand it a fresh read-only handle on the same file each time.
    return { fetchFresh, openDb: () => openCorpusReadOnly(join(dir, "corpus.sqlite")), nowMs: NOW_MS, log: () => undefined };
  }

  it("returns no problems and a VERIFIED line when every 2027 object matches the corpus", async () => {
    const fetchFresh = fetcherFor(fixtureBodies());
    const result = await verifyRosterSeasons({ seasons: [2026, SEASON] }, deps(fetchFresh));
    expect(result.problems).toEqual([]);
    expect(result.rosterSeasons).toEqual([SEASON]);
    const verified = result.lines.find((l) => l.startsWith("VERIFIED:"));
    expect(verified).toBe(`VERIFIED: ${SEASON} events list, teams list and event pages are live for ${IDS.join(", ")}.`);
    expect(result.lines).toContain(
      `Reveal: set CURRENT_SEASON = ${SEASON} in apps/web/src/lib/seasons.ts, run npx vitest run apps/web from the repo root, commit and push.`
    );
    // Non-vacuity: the largest roster's page was actually read for every algorithm.
    for (const mod of Object.values(PUBLISHED_ALGORITHM_MODULES)) {
      expect(fetchFresh).toHaveBeenCalledWith(artifactKey({ page: "event", eventKey: "2027abca", algorithmId: mod.id, version: mod.version }));
    }
  });

  it("names both versions and fetches no page for an algorithm whose live manifest version differs from this checkout", async () => {
    const bodies = fixtureBodies();
    const manifest = JSON.parse(bodies.get(ALGORITHMS_MANIFEST_KEY)!) as { algorithms: { id: string; version: string; codeVersion: string }[] };
    const sprEntry = manifest.algorithms.find((a) => a.id === "spr")!;
    const treeVersion = sprEntry.version;
    sprEntry.version = "99.0.0+baseline";
    sprEntry.codeVersion = "99.0.0";
    bodies.set(ALGORITHMS_MANIFEST_KEY, JSON.stringify(manifest));
    const fetchFresh = fetcherFor(bodies);

    const result = await verifyRosterSeasons({ seasons: [SEASON] }, deps(fetchFresh));
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain("spr@99.0.0+baseline");
    expect(result.problems[0]).toContain(`spr@${treeVersion}`);
    expect(result.lines.some((l) => l.startsWith("VERIFIED:"))).toBe(false);
    const fetchedKeys = fetchFresh.mock.calls.map((c) => c[0]);
    expect(fetchedKeys.filter((k) => k.includes("/spr@"))).toEqual([]);
    // Non-vacuity: the other algorithms were still read.
    expect(fetchedKeys.some((k) => k.includes("/epa@"))).toBe(true);
  });

  it("names the key when the 2027 events list for epa answers 404", async () => {
    const bodies = fixtureBodies();
    const epaVersion = PUBLISHED_ALGORITHM_MODULES["epa"]!.version;
    const key = artifactKey({ page: "events", year: SEASON, algorithmId: "epa", version: epaVersion });
    bodies.delete(key);
    const result = await verifyRosterSeasons({ seasons: [SEASON] }, deps(fetcherFor(bodies)));
    expect(result.problems.some((p) => p.includes(key) && p.includes("404"))).toBe(true);
    expect(result.lines.some((l) => l.startsWith("VERIFIED:"))).toBe(false);
  });

  it("names the event and both counts when a row's teamCount counts the demo key", async () => {
    const result = await verifyRosterSeasons({ seasons: [SEASON] }, deps(fetcherFor(fixtureBodies({ teamCountFor: { "2027abca": 4 } }))));
    expect(result.problems.length).toBeGreaterThan(0);
    for (const problem of result.problems) {
      expect(problem).toContain("2027abca");
      expect(problem).toMatch(/\b4\b/);
      expect(problem).toMatch(/\b3\b/);
    }
  });

  it("names the event and both counts when the largest event's page carries a different roster", async () => {
    const result = await verifyRosterSeasons({ seasons: [SEASON] }, deps(fetcherFor(fixtureBodies({ abcaPageRoster: ["frc254", "frc33"] }))));
    expect(result.problems).toHaveLength(IDS.length);
    for (const problem of result.problems) {
      expect(problem).toContain("2027abca");
      expect(problem).toMatch(/\b2\b/);
      expect(problem).toMatch(/\b3\b/);
    }
  });

  it("refuses a season list with no roster-only season before any fetch", async () => {
    const fetchFresh = fetcherFor(fixtureBodies());
    await expect(verifyRosterSeasons({ seasons: [2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026] }, deps(fetchFresh))).rejects.toThrow(
      /roster-only/
    );
    expect(fetchFresh).not.toHaveBeenCalled();
  });
});

describe("compareRosterSeason", () => {
  it("reports a missing teams list and a non-empty teams list as problems", () => {
    const expected = { season: SEASON, events: [{ eventKey: "2027abca", listName: "Alberta Regional", pageName: "Alberta Regional", teamKeys: ["frc33"] }] };
    const missing = compareRosterSeason(expected, {
      algorithmId: "spr",
      version: "1.0.0+baseline",
      eventsList: { key: "events-key", status: 404, body: undefined },
      teamsList: { key: "teams-key", status: 404, body: undefined },
      eventPage: { key: "event-key", status: 404, body: undefined },
    });
    expect(missing.some((p) => p.includes("teams-key"))).toBe(true);
    expect(missing.some((p) => p.includes("events-key"))).toBe(true);
    expect(missing.some((p) => p.includes("event-key"))).toBe(true);
  });
});

describe("verifyRosterSeason.ts stays credential-free", () => {
  it("never reads an environment variable and never imports the R2 client", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./verifyRosterSeason.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/from\s+["'][^"']*r2Client/);
    expect(source).not.toMatch(/from\s+["'][^"']*harness\/publish(\.js)?["']/);
  });
});
