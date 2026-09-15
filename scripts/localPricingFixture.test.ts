/**
 * Offline tests for the local visual-check fixture (260915-m4j). The CLI's
 * network half (GETs against the public origin, the localhost server) is not
 * exercised here; every transformation it performs is.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildOfflineEventArtifactWithBlock } from "../packages/harness/fixtures/eventStateArtifactFixture.js";
import { LiveEventArtifactSchema, PAGE_ARTIFACT_SCHEMA_VERSION, TeamSeasonArtifactSchema, type TeamSeasonArtifact } from "../packages/harness/pageArtifacts.js";
import { emitSeedSql } from "../packages/harness/seedSql.js";
import type { StateRow } from "../packages/harness/stateSnapshot.js";
import { buildLocalPricingFixture, DEFAULT_UNSEEN_TEAM_KEY, parseSeedSql, resolveRequest } from "./localPricingFixture.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const NOW = Date.parse("2026-09-15T12:00:00.000Z");

describe("parseSeedSql", () => {
  const rows: StateRow[] = [
    { algorithmId: "spr", algorithmVersion: "4.0.0+baseline", scopeKind: "league", scopeKey: "league", stateJson: '{"season":2026,"note":"it\'s a \'\'quoted\'\' value"}', generation: "g-1", computedAt: "2026-09-15T00:00:00.000Z" },
    { algorithmId: "spr", algorithmVersion: "4.0.0+baseline", scopeKind: "team", scopeKey: "frc254", stateJson: '{"muL":0.1}', generation: "g-1", computedAt: "2026-09-15T00:00:00.000Z" },
  ];

  it("round-trips the real seed emitter's output, doubled single quotes included", () => {
    const out = join(mkdtempSync(join(tmpdir(), "m4j-seed-")), "seed.sql");
    emitSeedSql(rows, { algorithmId: "spr", out });
    const sql = readFileSync(out, "utf8");
    expect(sql).toContain("''");
    expect(parseSeedSql(sql)).toEqual(rows);
  });

  it("parses several INSERT statements and several tuples per statement", () => {
    const out = join(mkdtempSync(join(tmpdir(), "m4j-seed-")), "seed.sql");
    const many = Array.from({ length: 7 }, (_, i) => ({ ...rows[1]!, scopeKey: `frc${i + 1}` }));
    emitSeedSql([rows[0]!, ...many], { algorithmId: "spr", out, maxRowsPerInsert: 3 });
    const sql = readFileSync(out, "utf8");
    expect(sql.match(/INSERT INTO/g)!.length).toBeGreaterThan(1);
    expect(parseSeedSql(sql)).toHaveLength(8);
  });

  it("rejects a row the block schema does not admit", () => {
    const sql = "INSERT INTO algorithm_state (a) VALUES ('opr', '1.0.0+x', 'event', '2026x', '{}', 'g', 't');";
    expect(() => parseSeedSql(sql)).toThrow();
  });
});

describe("buildLocalPricingFixture", async () => {
  const fixture = buildOfflineEventArtifactWithBlock();
  // A "finished" event: the fixture's own played rows only, no upcoming and no block, as a published artifact of a past event looks.
  const { state: _s, ...rest } = fixture.artifact;
  void _s;
  const finished = LiveEventArtifactSchema.parse({ ...rest, upcoming: [] });
  const LAST = 8;

  const teamKey = finished.matches.filter((m) => m.compLevel === "qm").slice(-1)[0]!.blueTeams[0]!;
  const teamArtifact: TeamSeasonArtifact = TeamSeasonArtifactSchema.parse({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2022-04-10T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: finished.algorithmVersion,
    teamKey,
    teamNumber: Number(teamKey.replace("frc", "")),
    nickname: "Fixture",
    season: finished.season,
    seasonStats: { record: { wins: 0, losses: 0, ties: 0 }, metrics: {} },
    events: [
      {
        eventKey: finished.eventKey,
        eventName: "Fixture",
        startDate: "2022-04-07",
        matches: finished.matches
          .filter((m) => m.redTeams.includes(teamKey) || m.blueTeams.includes(teamKey))
          .map((m) => ({
            matchKey: m.matchKey,
            season: finished.season,
            eventKey: finished.eventKey,
            compLevel: m.compLevel,
            algorithmId: "spr",
            algorithmVersion: finished.algorithmVersion,
            predictedWinner: m.predictedWinner,
            pRedWin: m.pRedWin,
            predictedRedScore: m.predictedRedScore,
            predictedBlueScore: m.predictedBlueScore,
            actualWinner: m.actualWinner,
            actualRedScore: m.actualRedScore,
            actualBlueScore: m.actualBlueScore,
            actualRedRp: m.actualRedRp,
            actualBlueRp: m.actualBlueRp,
            setNumber: m.setNumber,
            matchNumber: m.matchNumber,
            redTeams: m.redTeams,
            blueTeams: m.blueTeams,
            video: "abc",
          })),
      },
    ],
    metricHistory: [],
  });

  // The digest slice is the replay's first season, whose SPR state carries `season: null`, so the season check is skipped here only.
  const priced = await buildLocalPricingFixture({ eventArtifact: finished, teamArtifacts: [teamArtifact], seedRows: fixture.stateRows, lastN: LAST, nowMs: NOW, priced: true, skipSeasonCheck: true });
  const unpriced = await buildLocalPricingFixture({ eventArtifact: finished, teamArtifacts: [], seedRows: fixture.stateRows, lastN: LAST, nowMs: NOW, priced: false });

  it("moves the last N played qualification matches into upcoming as schedule-only, future-dated rows", () => {
    expect(priced.movedMatchKeys).toHaveLength(LAST);
    const moved = priced.eventArtifact.upcoming.filter((row) => priced.movedMatchKeys.includes(row.matchKey));
    expect(moved).toHaveLength(LAST);
    moved.forEach((row, i) => {
      expect(Object.keys(row).sort()).toEqual(["blueTeams", "compLevel", "matchKey", "matchNumber", "redTeams", "setNumber", "sortTime"]);
      expect(row.sortTime).toBe(NOW + (i + 1) * 7 * 60_000);
    });
    expect(priced.eventArtifact.matches.some((row) => priced.movedMatchKeys.includes(row.matchKey))).toBe(false);
    expect(priced.eventArtifact.matches.length + LAST).toBe(finished.matches.length);
    expect(priced.eventArtifact.generation).toBe(`local-fixture-${NOW}`);
    expect(priced.eventArtifact.computedAt).toBe(new Date(NOW).toISOString());
  });

  it("the last moved match carries the unseen team, and the priced summary reports a one-sided band", () => {
    const last = priced.eventArtifact.upcoming.find((row) => row.matchKey === priced.movedMatchKeys[LAST - 1])!;
    expect(last.redTeams[0]).toBe(DEFAULT_UNSEEN_TEAM_KEY);
    expect(priced.summary).toBeDefined();
    expect(priced.summary!.pricedRows).toBe(LAST);
    expect(priced.summary!.oneSidedBand).toBeGreaterThanOrEqual(1);
    expect(priced.summary!.bothBands).toBeGreaterThanOrEqual(1);
    expect(priced.eventArtifact.state).toBeDefined();
    expect(priced.eventArtifact.eventType).toBe(finished.eventType);
  });

  it("the unpriced event carries no state block and no summary", () => {
    expect(unpriced.eventArtifact).not.toHaveProperty("state");
    expect(unpriced.summary).toBeUndefined();
  });

  it("refuses an unseen team that is a demo key or has a seed row", async () => {
    await expect(buildLocalPricingFixture({ eventArtifact: finished, teamArtifacts: [], seedRows: fixture.stateRows, lastN: LAST, nowMs: NOW, priced: false, unseenTeamKey: "frc9975" })).rejects.toThrow(/demo/);
    const seeded = fixture.stateRows.find((row) => row.scopeKind === "team" && row.scopeKey.startsWith("frc"))!.scopeKey;
    await expect(buildLocalPricingFixture({ eventArtifact: finished, teamArtifacts: [], seedRows: fixture.stateRows, lastN: LAST, nowMs: NOW, priced: false, unseenTeamKey: seeded })).rejects.toThrow(/seed row/);
  });

  it("refuses a seed from another season unless the check is skipped", async () => {
    const otherSeason = fixture.stateRows.map((row) => (row.scopeKind === "league" ? { ...row, stateJson: JSON.stringify({ ...JSON.parse(row.stateJson), season: 2099 }) } : row));
    await expect(buildLocalPricingFixture({ eventArtifact: finished, teamArtifacts: [], seedRows: otherSeason, lastN: LAST, nowMs: NOW, priced: true })).rejects.toThrow(/season/);
  });

  it("the team rewrite strips actuals from the moved matches, future-dates them, and leaves the other matches alone", () => {
    const rewritten = priced.teamArtifacts[0]!.events[0]!.matches;
    const original = teamArtifact.events[0]!.matches;
    expect(rewritten).toHaveLength(original.length);
    const movedRows = rewritten.filter((row) => priced.movedMatchKeys.includes(row.matchKey));
    expect(movedRows.length).toBeGreaterThan(0);
    for (const row of movedRows) {
      for (const key of ["actualWinner", "actualRedScore", "actualBlueScore", "actualRedRp", "actualBlueRp", "video"]) expect(row, key).not.toHaveProperty(key);
      expect(row.pRedWin).toBeTypeOf("number");
      expect(row.sortTime).toBeGreaterThan(NOW);
    }
    const untouched = rewritten.filter((row) => !priced.movedMatchKeys.includes(row.matchKey));
    for (const row of untouched) expect(row.actualWinner).toBeDefined();
  });
});

describe("resolveRequest", () => {
  const DIR = resolve(HERE, "..", "reports", "local-artifacts");
  const present = new Set([resolve(DIR, "v1/event/2026vache/spr@4.0.0+baseline.json")]);
  const exists = (path: string) => present.has(path);

  it("serves a present key from disk and falls through to the origin otherwise", () => {
    expect(resolveRequest(DIR, "/v1/event/2026vache/spr@4.0.0+baseline.json?cb=1", exists)).toEqual({ kind: "local", file: resolve(DIR, "v1/event/2026vache/spr@4.0.0+baseline.json") });
    expect(resolveRequest(DIR, "/v1/manifest/algorithms.json", exists)).toEqual({ kind: "remote", key: "v1/manifest/algorithms.json" });
  });

  it("refuses path traversal, raw or percent-encoded, and anything outside /v1/", () => {
    for (const url of ["/v1/../../.env", "/v1/%2e%2e/%2e%2e/.env", "/v1/..%2f..%2f.env", "/v1/event/..\\..\\.env", "/.env", "/", "/v1%2f..%2f.env"]) {
      expect(resolveRequest(DIR, url, () => true).kind, url).toBe("reject");
    }
  });
});

describe("static scan: the fixture script can never write to production", () => {
  it("imports no R2 client and no S3 or signing SDK", () => {
    const source = readFileSync(resolve(HERE, "localPricingFixture.ts"), "utf8");
    const specifiers = [...source.matchAll(/(?:^|\n)[ \t]*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]!);
    expect(specifiers.length).toBeGreaterThan(5);
    const forbidden = specifiers.filter((s) => /r2Client|@aws-sdk|aws4fetch|aws-sdk|signature|sigv4|wrangler|\bd1\b/i.test(s));
    expect(forbidden).toEqual([]);
    // Positive control: the same regex catches a synthetic forbidden import.
    const control = [...`import { putObject } from "../packages/harness/r2Client.js";`.matchAll(/(?:^|\n)[ \t]*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]!);
    expect(control.filter((s) => /r2Client/.test(s))).toHaveLength(1);
    // GET only: no write method is ever sent.
    expect(source).not.toMatch(/method:\s*["'](PUT|POST|DELETE|PATCH)["']/);
  });
});
