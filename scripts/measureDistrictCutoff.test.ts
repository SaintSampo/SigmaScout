/**
 * `measureDistrictCutoff.ts`' coverage (fast task 261006, todo
 * `district-cutoff-line-backtest`; rebuilt on the as-of path by quick task
 * 261014-hx6).
 *
 * JOBS:
 *
 *   1. The backtest runs end to end on the COMMITTED 2026 PNW district fixture
 *      with its eight event artifacts and as-of objects built from them
 *      (`buildAsOfTestObjects`, the in memory world every as-of test uses),
 *      through the tab's own loader, assembly and as-of runner, and every leak
 *      check passes. The event artifacts are local only (gitignored), so this
 *      block is skipped where they are absent and runs on every machine that
 *      has them.
 *   2. The origin cache, the version guard, the pre 2023 refusal, the shards,
 *      the result files and the report's refusals.
 *   3. The pre-registered gate refuses on each failing condition, including
 *      coverage one position either side of the 72% to 88% band. Its bars are
 *      unchanged.
 *   4. The hook code the script restates has not moved (a digest pin).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DistrictArtifactSchema, EventArtifactSchema, asOfIndexKey, asOfStartKey, type DistrictArtifact, type EventArtifact } from "../packages/harness/pageArtifacts.js";
import { AsOfIndexSchema, AsOfStartSchema } from "../packages/harness/asOfState.js";
import { AAA, OBJECTS, buildAsOfTestObjects, districtArtifact as miniDistrictArtifact, type AsOfTestObjects } from "../apps/web/src/components/districts/asOfTestFixtures.js";
import type { AsOfFetchers } from "../apps/web/src/components/districts/asOfRewind.js";
import { AS_OF_UNAVAILABLE_NAME } from "../apps/web/src/components/districts/districtRunAssembly.js";
import {
  OriginCache,
  OriginCacheMissError,
  OriginFetchError,
  EventArtifactVersionError,
  asOfLeakChecks,
  assignShards,
  backtestDistrict,
  coverageInBand,
  createRunMemo,
  districtEventKeysOf,
  districtTabAtPosition,
  districtTabContext,
  districtTimelineOf,
  eventArtifactKeyFor,
  gateVerdict,
  hasResultFile,
  inShard,
  loadEventArtifactsFromCache,
  measurementPositions,
  parseShard,
  poolResultFiles,
  writeResultFile,
  calibrationBin,
  calibrationOf,
  drawArmOf,
  parseCli,
  resultDirFor,
  sumCalibrations,
  type BacktestSummary,
  type DistrictOutcome,
  type FetchLike,
  type LineStats,
  type PositionRow,
  type TabSources,
} from "./measureDistrictCutoff.js";
import { DEFAULT_SIMULATION_SEED, SIMULATION_DRAWS } from "../apps/web/src/workers/simulationProtocol.js";
import type { LockStatus } from "../packages/core/districts/locks.js";

const FINAL_STATE = { qualMatchesPlayed: 60, qualMatchesTotal: 60, alliancesPicked: true, playoffsDone: true, awardsPosted: true };
const FIXTURE_DIR = "data/fixtures/phase10";
const FIXTURE_TIMEOUT_MS = 180_000;

/** The committed fixture predates `state`; stamp an all final block on every event row, as the champ backtest's test does. */
function stampedFixture(): DistrictArtifact {
  const raw = JSON.parse(readFileSync(`${FIXTURE_DIR}/district-2026pnw.json`, "utf8")) as {
    teams: { eventPoints: Record<string, unknown>[]; remainingEvents: Record<string, unknown>[] }[];
  };
  for (const team of raw.teams) {
    for (const row of team.eventPoints) row.state = FINAL_STATE;
    for (const row of team.remainingEvents) row.state = FINAL_STATE;
  }
  return DistrictArtifactSchema.parse(raw);
}

function fixtureEvents(artifact: DistrictArtifact): Map<string, EventArtifact> {
  const out = new Map<string, EventArtifact>();
  for (const eventKey of districtEventKeysOf(artifact)) {
    const path = `${FIXTURE_DIR}/event-${eventKey}.json`;
    if (existsSync(path)) out.set(eventKey, EventArtifactSchema.parse(JSON.parse(readFileSync(path, "utf8"))));
  }
  return out;
}

/** In memory fetchers over one built world, as `scripts/asOfRewindWeb.test.ts`' `fetchersOf` reads its uploads. */
function fetchersOf(objects: AsOfTestObjects, season: number, version: string, overrides: Partial<AsOfFetchers> = {}): AsOfFetchers {
  return {
    index: (eventKey) => Promise.resolve(objects.indexes.get(eventKey) ?? null),
    log: (eventKey) => Promise.resolve(objects.logs.get(eventKey) ?? null),
    season: () => Promise.resolve(objects.season),
    start: () => {
      const body = objects.bodies.get(asOfStartKey({ season, algorithmId: "spr", version }));
      return Promise.resolve(body === undefined ? null : AsOfStartSchema.parse(JSON.parse(body)));
    },
    ...overrides,
  };
}

const eventFixturesPresent = existsSync(`${FIXTURE_DIR}/event-2026wabon.json`);

/**
 * Recorded from the first as-of run of the test below (2026-10-14): 1000
 * draws, seed 20260830, as-of objects built by `buildAsOfTestObjects` over
 * the fixture's eight events. Open events shrink 8, 6, 4, 2, every one of them
 * unstarted at its week end and so GENERATED.
 *
 * Re-recorded 2026-10-14 for the weighted pick draft (261014-ol6) and the
 * joint event draws (261014-qv2): the season start line moved 63 to 62, and
 * the midpoint rule, which reads each team's median predicted total, moved
 * from [59, 58, 57, 57].
 *
 * HISTORY, the retired stored odds path on the same fixture: simulated
 * [58, 57, 58, 57], midpoint [53, 53, 54, 54]; the fixed draft with
 * independent draws on the as-of path: simulated [63, 62, 62, 60], midpoint
 * [59, 58, 57, 57].
 */
const SEEDED_SIMULATED = [62, 62, 62, 60];
const SEEDED_MIDPOINT = [59, 57, 56, 56];

describe.skipIf(!eventFixturesPresent)("backtestDistrict on the committed 2026 PNW fixture, on the as-of path", () => {
  const artifact = eventFixturesPresent ? stampedFixture() : (undefined as unknown as DistrictArtifact);
  const events = eventFixturesPresent ? fixtureEvents(artifact) : new Map<string, EventArtifact>();
  const version = [...events.values()][0]?.algorithmVersion ?? "";
  const objects = eventFixturesPresent
    ? buildAsOfTestObjects({ season: 2026, version, eventArtifacts: [...events.values()], extraTeams: artifact.teams.map((team) => team.teamKey) })
    : undefined;
  const sources = (overrides: Partial<AsOfFetchers> = {}): TabSources => ({
    eventArtifacts: events,
    unloadedEventKeys: [],
    fetchers: fetchersOf(objects!, 2026, version, overrides),
    version,
    memo: createRunMemo(),
    draws: SIMULATION_DRAWS,
    seed: DEFAULT_SIMULATION_SEED,
  });
  let outcome: DistrictOutcome;
  let rows: PositionRow[] = [];

  beforeAll(async () => {
    outcome = await backtestDistrict(artifact, sources());
    rows = outcome.ok ? outcome.backtest.outcomes.flatMap((o) => (o.kind === "scored" ? [o.row] : [])) : [];
  }, FIXTURE_TIMEOUT_MS);

  it("loads all eight district tier event artifacts, at the one run version", () => {
    expect(districtEventKeysOf(artifact)).toHaveLength(8);
    expect(events.size).toBe(8);
    expect(new Set([...events.values()].map((event) => event.algorithmVersion))).toEqual(new Set([version]));
  });

  it("scores the season start and the three week ends before the season settles, and counts the last week end as settled", () => {
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(rows.map((row) => row.label)).toEqual(["Season start", "After week 1", "After week 2", "After week 3"]);
    expect(outcome.backtest.outcomes.filter((o) => o.kind === "settled")).toHaveLength(1);
    expect(outcome.backtest.eventsWithoutArtifact).toEqual([]);
  });

  it("targets the tab's own settled cutoff and reports TBA's line beside it", () => {
    if (!outcome.ok) throw new Error(outcome.reason);
    // The District Locks tab's settled line for 2026 PNW is 59; TBA publishes 82 on a different total.
    expect(outcome.backtest.settled).toBe(59);
    expect(outcome.backtest.published).toBe(82);
  });

  it("passes every leak check at every scored position, the row checks and the as-of checks, with nothing unpriced", () => {
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.leaks).toEqual({
        awardsFromFinalEventsOnly: true,
        earnedNeverAhead: true,
        openEventsOpenInRows: true,
        realRowsAfterCut: true,
        baselinesAtOrBeforeCut: true,
        playedPlayoffsAtOrBeforeCut: true,
        generatedCarriesNoSchedule: true,
      });
      expect(row.unpricedEvents).toBe(0);
      expect(row.unavailable).toEqual({});
    }
  });

  it("prints each line inside its own likely range, at the seeded values", () => {
    for (const row of rows) {
      expect(row.p10).toBeLessThanOrEqual(row.simulated);
      expect(row.simulated).toBeLessThanOrEqual(row.p90);
    }
    expect(rows.map((row) => row.simulated)).toEqual(SEEDED_SIMULATED);
    expect(rows.map((row) => row.midpoint)).toEqual(SEEDED_MIDPOINT);
    expect(rows.map((row) => row.openEvents)).toEqual([8, 6, 4, 2]);
    expect(rows.map((row) => row.generatedEvents)).toEqual([8, 6, 4, 2]);
    expect(rows.map((row) => row.realEvents)).toEqual([0, 0, 0, 0]);
  });

  it(
    "at the season start every open event is GENERATED and its entry is baked",
    async () => {
      const tab = await districtTabAtPosition(districtTabContext(artifact, events), 0, sources());
      expect(tab.cut).toBeDefined();
      expect(tab.priced.assembled.events).toHaveLength(8);
      for (const request of tab.priced.assembled.events) expect(request.asOf?.mode).toBe("generated");
      expect(tab.priced.entries.map((entry) => entry.status)).toEqual(Array.from({ length: 8 }, () => "baked"));
    },
    FIXTURE_TIMEOUT_MS
  );

  // AT A WEEK END NO OPEN EVENT IS FOLDED: every event of the week is final
  // there and no later one has started (the GENERATED counts above). So the
  // REAL mode is exercised at a stop inside an event, a qualification row of
  // 2026wabon part way through.
  it(
    "inside an event, the event folded by the cut is REAL and its entry is ok, and the as-of leak checks hold",
    async () => {
      const ctx = districtTabContext(artifact, events);
      const positionIndex = ctx.timeline.positions.findIndex((position) => position.step?.kind === "match" && position.step.eventKey === "2026wabon" && position.step.matchKey === "2026wabon_qm40");
      expect(positionIndex).toBeGreaterThan(0);
      const tab = await districtTabAtPosition(ctx, positionIndex, sources());
      const request = tab.priced.assembled.events.find((event) => event.eventKey === "2026wabon");
      expect(request?.asOf?.mode).toBe("real");
      expect(request?.asOf?.rows?.length).toBeGreaterThan(0);
      expect(tab.priced.entries.find((entry) => entry.eventKey === "2026wabon")?.status).toBe("ok");
      expect(asOfLeakChecks({ rewind: tab.rewind, cut: tab.cut, indexes: tab.indexes, eventArtifacts: events, requests: tab.priced.assembled.events })).toEqual({
        realRowsAfterCut: true,
        baselinesAtOrBeforeCut: true,
        playedPlayoffsAtOrBeforeCut: true,
        generatedCarriesNoSchedule: true,
      });
    },
    FIXTURE_TIMEOUT_MS
  );

  it(
    "a played event whose INDEX is unpublished reads unavailable at the stop, never a stored odds run",
    async () => {
      const real = fetchersOf(objects!, 2026, version);
      const tab = await districtTabAtPosition(
        districtTabContext(artifact, events),
        0,
        sources({ index: (eventKey, options) => (eventKey === "2026wabon" ? Promise.resolve(null) : real.index(eventKey, options)) })
      );
      expect(tab.priced.unavailableEvents).toContainEqual({ eventKey: "2026wabon", name: AS_OF_UNAVAILABLE_NAME });
      expect(tab.priced.distributions.has("2026wabon")).toBe(false);
      expect(tab.priced.assembled.events.map((event) => event.eventKey)).not.toContain("2026wabon");
    },
    FIXTURE_TIMEOUT_MS
  );

  it("derives the measurement positions as season start plus the last step of each week, never now", () => {
    const timeline = districtTimelineOf(artifact, events);
    const positions = measurementPositions(timeline);
    expect(positions[0]).toEqual({ index: 0, label: "Season start" });
    expect(positions.map((p) => p.label)).toEqual(["Season start", "After week 1", "After week 2", "After week 3", "After week 4"]);
    for (const position of positions) expect(position.index).toBeLessThan(timeline.nowIndex);
  });
});

// ---------------------------------------------------------------------------
// Refusals before anything loads
// ---------------------------------------------------------------------------

describe("backtestDistrict refusals", () => {
  it("refuses a pre 2023 district season before any fetcher is called", async () => {
    let calls = 0;
    const spy = (): never => {
      calls += 1;
      throw new Error("a fetcher was called");
    };
    const artifact = DistrictArtifactSchema.parse({ ...miniDistrictArtifact(), year: 2022, districtKey: "2022pnw" });
    const outcome = await backtestDistrict(artifact, {
      eventArtifacts: new Map(),
      unloadedEventKeys: [],
      fetchers: { index: spy, log: spy, season: spy, start: spy },
      version: "9.0.0+rolling",
      memo: createRunMemo(),
      draws: SIMULATION_DRAWS,
      seed: DEFAULT_SIMULATION_SEED,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/no playoff bracket model/);
    expect(calls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The origin cache and the version guard
// ---------------------------------------------------------------------------

describe("OriginCache", () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "hx6-origin-cache-"));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const indexKey = asOfIndexKey({ eventKey: "2026waaa", algorithmId: "spr", version: "9.0.0+rolling" });
  const missingKey = asOfIndexKey({ eventKey: "2026wazzz", algorithmId: "spr", version: "9.0.0+rolling" });
  const brokenKey = asOfIndexKey({ eventKey: "2026wabbb", algorithmId: "spr", version: "9.0.0+rolling" });
  const parseIndex = (body: unknown) => AsOfIndexSchema.parse(body);

  it("offline, a miss throws an error naming the key", async () => {
    const cache = new OriginCache({ root, mode: "offline" });
    await expect(cache.get(indexKey, parseIndex)).rejects.toBeInstanceOf(OriginCacheMissError);
    await expect(cache.get(indexKey, parseIndex)).rejects.toThrow(indexKey);
  });

  it("fill writes the body and the 404 marker through the injected fetch, and never caches a non 404 failure", async () => {
    const urls: string[] = [];
    const stub: FetchLike = (url) => {
      urls.push(url);
      if (url.endsWith(indexKey)) return Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve(JSON.stringify(OBJECTS.indexes.get("2026waaa"))) });
      if (url.endsWith(missingKey)) return Promise.resolve({ status: 404, ok: false, text: () => Promise.resolve("") });
      return Promise.resolve({ status: 503, ok: false, text: () => Promise.resolve("") });
    };
    const cache = new OriginCache({ root, mode: "fill", origin: "https://origin.test", fetch: stub });
    expect((await cache.get(indexKey, parseIndex))?.m.length).toBe(OBJECTS.indexes.get("2026waaa")!.m.length);
    expect(await cache.get(missingKey, parseIndex)).toBeNull();
    await expect(cache.get(brokenKey, parseIndex)).rejects.toBeInstanceOf(OriginFetchError);
    expect(urls).toContain(`https://origin.test/${indexKey}`);
    expect(existsSync(cache.pathOf(indexKey))).toBe(true);
    expect(existsSync(`${cache.pathOf(missingKey)}.404`)).toBe(true);
    expect(existsSync(cache.pathOf(brokenKey))).toBe(false);
    expect(existsSync(`${cache.pathOf(brokenKey)}.404`)).toBe(false);
    expect(cache.stats).toMatchObject({ fetched: 1, notFound: 1, failed: 1 });
  });

  it("offline, a recorded 404 marker reads null and a cached body parses, without the network", async () => {
    const cache = new OriginCache({ root, mode: "offline", fetch: () => Promise.reject(new Error("offline touched the network")) });
    expect(await cache.get(missingKey, parseIndex)).toBeNull();
    expect((await cache.get(indexKey, parseIndex))?.m.length).toBe(OBJECTS.indexes.get("2026waaa")!.m.length);
    // The failure in fill mode cached nothing, so it is still a miss.
    await expect(cache.get(brokenKey, parseIndex)).rejects.toBeInstanceOf(OriginCacheMissError);
  });

  it("the loader refuses an event artifact whose algorithmVersion differs from the run version", async () => {
    const runVersion = "11.0.0+baseline";
    const stub: FetchLike = () => Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve(JSON.stringify(AAA)) });
    const fill = new OriginCache({ root, mode: "fill", fetch: stub });
    await fill.get(eventArtifactKeyFor("2026waaa", runVersion), (body) => EventArtifactSchema.parse(body));
    expect(AAA.algorithmVersion).not.toBe(runVersion);
    const cache = new OriginCache({ root, mode: "offline" });
    await expect(loadEventArtifactsFromCache(cache, ["2026waaa"], runVersion)).rejects.toBeInstanceOf(EventArtifactVersionError);
    // At its own version it loads; an event recorded as 404 is reported missing.
    const own = new OriginCache({ root, mode: "fill", fetch: (url) => Promise.resolve(url.includes("2026waaa") ? { status: 200, ok: true, text: () => Promise.resolve(JSON.stringify(AAA)) } : { status: 404, ok: false, text: () => Promise.resolve("") }) });
    const loaded = await loadEventArtifactsFromCache(own, ["2026waaa", "2026wazzz"], AAA.algorithmVersion);
    expect([...loaded.eventArtifacts.keys()]).toEqual(["2026waaa"]);
    expect(loaded.missing).toEqual(["2026wazzz"]);
  });
});

// ---------------------------------------------------------------------------
// Shards and result files
// ---------------------------------------------------------------------------

describe("shards", () => {
  const items = Array.from({ length: 48 }, (_unused, i) => ({ key: `20${String(23 + (i % 4))}d${String(i).padStart(2, "0")}`, weight: 1 + ((i * 37) % 91) }));

  it("assigns every district season to exactly one shard, deterministically, balanced on weight", () => {
    for (const n of [1, 4, 6]) {
      const a = assignShards(items, n);
      expect(assignShards([...items].reverse(), n)).toEqual(a);
      expect(a.size).toBe(items.length);
      const loads = Array.from({ length: n }, () => 0);
      for (const item of items) {
        const shard = a.get(item.key)!;
        expect(shard).toBeGreaterThanOrEqual(1);
        expect(shard).toBeLessThanOrEqual(n);
        loads[shard - 1]! += item.weight;
      }
      expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(Math.max(...items.map((item) => item.weight)));
    }
  });

  it("partitions the selection across k = 1..n with no overlap", () => {
    const selection = items.map((item) => ({ districtKey: item.key, weight: item.weight }));
    const seen: string[] = [];
    for (let k = 1; k <= 4; k++) seen.push(...inShard(selection, { k, n: 4 }, (item) => item.weight).map((item) => item.districtKey));
    expect(seen.sort()).toEqual(selection.map((item) => item.districtKey).sort());
    expect(inShard(selection, undefined, (item) => item.weight)).toHaveLength(48);
  });

  it("parses k/n and refuses anything else", () => {
    expect(parseShard("2/4")).toEqual({ k: 2, n: 4 });
    expect(parseShard(undefined)).toBeUndefined();
    for (const bad of ["0/4", "5/4", "2", "a/b", "2/0"]) expect(() => parseShard(bad)).toThrow();
  });
});

describe("result files", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "hx6-results-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("writes atomically (no temp file left behind) and a rerun can see the file", () => {
    writeResultFile(dir, "2026pnw", { version: "11.0.0+baseline", value: 1 });
    expect(readdirSync(dir)).toEqual(["2026pnw.json"]);
    expect(hasResultFile(dir, "2026pnw")).toBe(true);
    expect(hasResultFile(dir, "2026fim")).toBe(false);
  });

  it("the report refuses a set with a missing district season and names it, and a file at another version", () => {
    expect(poolResultFiles(dir, ["2026fim", "2026pnw"], "11.0.0+baseline")).toEqual({ status: "incomplete", missing: ["2026fim"] });
    writeResultFile(dir, "2026fim", { version: "10.0.0+baseline" });
    expect(poolResultFiles(dir, ["2026fim", "2026pnw"], "11.0.0+baseline")).toEqual({ status: "versionMismatch", keys: ["2026fim"] });
    writeResultFile(dir, "2026fim", { version: "11.0.0+baseline" });
    const pooled = poolResultFiles<{ version: string }>(dir, ["2026fim", "2026pnw"], "11.0.0+baseline");
    expect(pooled.status).toBe("complete");
  });
});

// ---------------------------------------------------------------------------
// The restated hook code has not moved
// ---------------------------------------------------------------------------

describe("the restated useDistrictLedgerData.ts code", () => {
  // `pricedRunAtStop` and its three helpers restate the hook's rewound memos
  // because the hook module cannot be imported in node. This digest covers
  // exactly those spans. When it fails, re-read the hook's changed code,
  // carry the change into `measureDistrictCutoff.ts`, then update the digest.
  const HOOK_DIGEST = "2863f9ae4bbc26e71e3553516fc5c0f4ec4ec243bbd7ae6fe61538e8453ba6db";

  it("matches the digest the restatement was written against", () => {
    const src = readFileSync("apps/web/src/components/districts/useDistrictLedgerData.ts", "utf8").replace(/\r\n/g, "\n");
    const span = (from: string, to: string): string => {
      const a = src.indexOf(from);
      expect(a, from).toBeGreaterThanOrEqual(0);
      const b = src.indexOf(to, a);
      expect(b, to).toBeGreaterThanOrEqual(0);
      return src.slice(a, b + to.length);
    };
    const parts = [
      span("export function securedElimForRequest(", "\n}\n"),
      span("export function attachRequestFacts(", "\n}\n"),
      span("export function divisionedDcmpBracketFacts(", "\n}\n"),
      span("  const assembled = useMemo((): AssembledDistrictEvents => {", "}, [entries, assembled.eventsWithExcludedMatches]);"),
      span("function openEventKeys(", "\n}\n"),
    ];
    expect(createHash("sha256").update(parts.join("\n---\n")).digest("hex")).toBe(HOOK_DIGEST);
  });

  it("the script carries no stored odds pricing in executable code", () => {
    const code = readFileSync("scripts/measureDistrictCutoff.ts", "utf8")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\/|\/\*\*)/.test(line))
      .join("\n");
    expect(code).not.toMatch(/startMatchKeyAtPosition/);
    expect(code).not.toMatch(/\.metrics\b/);
  });
});

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

function stats(mae: number, bias: number, n = 500): LineStats {
  return { n, mae, bias };
}

function passingSummary(overrides: Partial<BacktestSummary> = {}): BacktestSummary {
  return {
    n: 500,
    simulatedVsSettled: stats(6, 1),
    midpointVsSettled: stats(9, -4),
    coveredSettled: 400,
    simulatedVsPublished: stats(20, -15),
    midpointVsPublished: stats(24, -20),
    nPublished: 500,
    coveredPublished: 100,
    ...overrides,
  };
}

describe("gateVerdict", () => {
  it("is GO when both conditions hold, at both ends of the coverage band", () => {
    expect(gateVerdict(passingSummary()).go).toBe(true);
    expect(gateVerdict(passingSummary({ coveredSettled: 360 })).go).toBe(true);
    expect(gateVerdict(passingSummary({ coveredSettled: 440 })).go).toBe(true);
  });

  it("is NO-GO when the simulated MAE does not beat the midpoint rule's", () => {
    const verdict = gateVerdict(passingSummary({ simulatedVsSettled: stats(9, 1) }));
    expect(verdict.go).toBe(false);
    expect(verdict.conditions[0]!.pass).toBe(false);
  });

  it("is NO-GO one position outside the band on either side", () => {
    expect(gateVerdict(passingSummary({ coveredSettled: 359 })).go).toBe(false);
    expect(gateVerdict(passingSummary({ coveredSettled: 441 })).go).toBe(false);
    expect(gateVerdict(passingSummary({ coveredSettled: 359 })).conditions[1]!.pass).toBe(false);
  });

  it("is NO-GO with nothing scored", () => {
    expect(gateVerdict(passingSummary({ n: 0, coveredSettled: 0, simulatedVsSettled: stats(Number.NaN, Number.NaN, 0), midpointVsSettled: stats(Number.NaN, Number.NaN, 0) })).go).toBe(false);
  });

  it("states the coverage band in integers", () => {
    expect(coverageInBand(17, 25)).toBe(false);
    expect(coverageInBand(18, 25)).toBe(true);
    expect(coverageInBand(22, 25)).toBe(true);
    expect(coverageInBand(23, 25)).toBe(false);
  });
});

describe("the two draw arms and the chance calibration (quick task 261014-qv2)", () => {
  it("parses --independent-draws, defaults to the joint arm, and sends the arms to sibling directories", () => {
    expect(parseCli([]).independentDraws).toBe(false);
    expect(parseCli(["--independent-draws"]).independentDraws).toBe(true);
    expect(parseCli(["--report", "--independent-draws"]).report).toBe(true);
    expect(drawArmOf(parseCli([]))).toBe("joint");
    expect(drawArmOf(parseCli(["--independent-draws"]))).toBe("independent");
    expect(resultDirFor("11.0.0+baseline", "district-cutoff-independent", "base").split("\\").join("/")).toBe("base/spr@11.0.0+baseline/district-cutoff-independent");
    expect(resultDirFor("11.0.0+baseline", "district-cutoff", "base").split("\\").join("/")).toBe("base/spr@11.0.0+baseline/district-cutoff");
  });

  it("bins chances into ten equal widths with 1 in the top bin", () => {
    expect(calibrationBin(0)).toBe(0);
    expect(calibrationBin(0.09999)).toBe(0);
    expect(calibrationBin(0.1)).toBe(1);
    expect(calibrationBin(0.95)).toBe(9);
    expect(calibrationBin(1)).toBe(9);
  });

  it("pairs printed chances with the final verdict, leaves award, prequalified and unknown finals out, and sums", () => {
    const printed = new Map([
      ["frc1", 0.8],
      ["frc2", 0.3],
      ["frc3", 0.5],
      ["frc4", 0.6],
      ["frc5", 0.2],
      ["frc6", 0.9],
    ]);
    const finals = new Map<string, LockStatus>([
      ["frc1", "locked"],
      ["frc2", "eliminated"],
      ["frc3", "contending"],
      ["frc4", "lockedAward"],
      ["frc5", "prequalified"],
    ]);
    const calibration = calibrationOf(printed, finals);
    expect(calibration.pairs).toBe(3);
    expect(calibration.brierSum).toBeCloseTo(0.2 ** 2 + 0.3 ** 2 + 0.5 ** 2, 12);
    expect(calibration.leftOut).toEqual({ lockedAward: 1, prequalified: 1, unknown: 1 });
    expect(calibration.bins[8]).toEqual({ count: 1, chanceSum: 0.8, outcomeSum: 1 });
    expect(calibration.bins[3]).toEqual({ count: 1, chanceSum: 0.3, outcomeSum: 0 });
    const doubled = sumCalibrations([calibration, calibration]);
    expect(doubled.pairs).toBe(6);
    expect(doubled.leftOut.unknown).toBe(2);
    expect(doubled.bins[5]!.count).toBe(2);
  });
});
