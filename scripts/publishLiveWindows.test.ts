/**
 * Coverage for the standalone one-object live-windows publisher.
 *
 * Every test here builds its OWN temp corpus and passes an INJECTED upload
 * function plus an INJECTED live-manifest reader, so the whole file is
 * offline, credential-free and CI-safe: no `data/corpus.sqlite`, no
 * `existsSync` guard, no skip, no network, and no value from `.env` is read,
 * printed, copied or interpolated anywhere in it.
 *
 * The load-bearing test is "the dry run writes nothing". A dry run that writes
 * is worse than no dry run, because an operator trusts it — so its zero-write
 * behaviour is PINNED by an injected-upload call count rather than read off
 * the code.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openCorpus, upsertDistrict, upsertEvent, upsertMatch, type Corpus } from "../packages/corpus/db.js";
import type { CorpusEvent, CorpusMatch } from "../packages/ingest/normalize.js";
import { LiveWindowsManifestSchema, MANIFEST_SCHEMA_VERSION } from "../packages/harness/manifestSchemas.js";
import { parseSeasonSpec } from "../packages/harness/seasonSpec.js";
import { DEFAULT_LIVE_WINDOWS_SEASONS, LIVE_WINDOWS_KEY, publishLiveWindows } from "./publishLiveWindows.js";

const SENTINEL_GENERATION = "sentinel-gen-0001";

let dir: string;
let db: Corpus;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sigmascout-publish-live-windows-"));
  db = openCorpus(join(dir, "corpus.sqlite"));
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

/** One district event with matches, one non-district event with matches. */
function seedTwoEvents(): void {
  upsertDistrict(db, { districtKey: "2026pnw", year: 2026, abbreviation: "pnw", displayName: "Pacific Northwest", dcmpSlots: 60, cmpSlots: 20, fetchedAt: "2026-03-01T00:00:00.000Z" });
  upsertEvent(db, event({ eventKey: "2026wabon", districtKey: "pnw" }));
  upsertMatch(db, match({ matchKey: "2026wabon_qm1", eventKey: "2026wabon", sortTime: 1_000_000 }));
  upsertEvent(db, event({ eventKey: "2026azfg", districtKey: null }));
  upsertMatch(db, match({ matchKey: "2026azfg_qm1", eventKey: "2026azfg", sortTime: 1_000_000 }));
}

interface UploadCall {
  bucket: string;
  key: string;
  body: string;
  options: { contentType: string; cacheControl: string };
}

function recorder() {
  const calls: UploadCall[] = [];
  return {
    calls,
    upload: async (bucket: string, key: string, body: string, options: { contentType: string; cacheControl: string }) => {
      calls.push({ bucket, key, body, options });
      await Promise.resolve();
    },
  };
}

function liveManifest(overrides: Record<string, unknown> = {}, windowCount = 5) {
  return {
    status: 200,
    body: {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      generation: SENTINEL_GENERATION,
      computedAt: "2026-03-01T00:00:00.000Z",
      windows: new Array(windowCount).fill({ eventKey: "2026old", season: 2026, startMs: 0, endMs: 1, inferred: false }),
      ...overrides,
    },
  };
}

function deps(readLiveManifest: () => Promise<{ status: number; body: unknown }>, upload: UploadCall extends never ? never : ReturnType<typeof recorder>["upload"]) {
  return { readLiveManifest, upload, openDb: () => db };
}

describe("publishLiveWindows — the dry run", () => {
  it("writes NOTHING: the injected upload function's call count is exactly 0", async () => {
    seedTwoEvents();
    const { calls, upload } = recorder();

    const census = await publishLiveWindows({ seasons: [2026], dryRun: true, nowMs: 0 }, deps(async () => liveManifest(), upload));

    expect(calls).toHaveLength(0);
    expect(census.wrote).toBe(false);
    expect(census.rebuiltWindowCount).toBe(2);
    expect(census.districtWindowCount).toBe(1);
  });
});

describe("publishLiveWindows — the real run", () => {
  it("writes exactly ONE object, at exactly one key, with publish.ts's own headers", async () => {
    seedTwoEvents();
    const { calls, upload } = recorder();

    await publishLiveWindows({ seasons: [2026], nowMs: 0 }, deps(async () => liveManifest(), upload));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.key).toBe("v1/manifest/live-windows.json");
    expect(calls[0]!.key).toBe(LIVE_WINDOWS_KEY);
    expect(calls[0]!.options.contentType).toBe("application/json");
    expect(calls[0]!.options.cacheControl).toBe("public, max-age=60");
    expect(calls.filter((call) => call.key !== LIVE_WINDOWS_KEY)).toHaveLength(0);
  });

  it("REUSES the live generation, never mints one, and stamps a fresh computedAt", async () => {
    seedTwoEvents();
    const { calls, upload } = recorder();

    const census = await publishLiveWindows({ seasons: [2026], nowMs: 0 }, deps(async () => liveManifest(), upload));

    const body = JSON.parse(calls[0]!.body) as { generation: string; computedAt: string };
    expect(body.generation).toBe(SENTINEL_GENERATION);
    expect(census.generation).toBe(SENTINEL_GENERATION);
    // Exactly one generation-shaped value in the whole body, and it is the sentinel.
    expect([...calls[0]!.body.matchAll(/"generation":"([^"]*)"/g)].map((m) => m[1])).toEqual([SENTINEL_GENERATION]);
    // A fresh computedAt IS expected, and is not the generation.
    expect(Number.isFinite(Date.parse(body.computedAt))).toBe(true);
    expect(body.computedAt).not.toBe(body.generation);
  });

  it("carries districtKey through the round trip — the YEAR-PREFIXED key on the district event, an explicit null on the other", async () => {
    seedTwoEvents();
    const { calls, upload } = recorder();

    const census = await publishLiveWindows({ seasons: [2026], nowMs: 0 }, deps(async () => liveManifest(), upload));

    const parsed = LiveWindowsManifestSchema.parse(JSON.parse(calls[0]!.body));
    const byEvent = new Map(parsed.windows.map((window) => [window.eventKey, window] as const));
    expect(byEvent.get("2026wabon")!.districtKey).toBe("2026pnw");
    expect(byEvent.get("2026azfg")!.districtKey).toBeNull();
    expect(census.districtWindowCount).toBe(parsed.windows.filter((window) => window.districtKey != null).length);
  });

  it("reports the rebuilt window count beside the live manifest's own, and proceeds when the rebuild legitimately drops a closed window", async () => {
    seedTwoEvents();
    // A third event whose window closed long before nowMs — deliberately dropped.
    upsertEvent(db, event({ eventKey: "2026azold" }));
    upsertMatch(db, match({ matchKey: "2026azold_qm1", eventKey: "2026azold", sortTime: 1_000 }));
    const { calls, upload } = recorder();

    // 3,601,000 sits after the old event's padded end (1,000 + 3,600,000) and
    // before the other two's (1,000,000 + 3,600,000), so exactly one window is
    // legitimately dropped.
    const census = await publishLiveWindows({ seasons: [2026], nowMs: 3_601_000 }, deps(async () => liveManifest({}, 9), upload));

    expect(census.rebuiltWindowCount).toBe(2);
    expect(census.liveWindowCount).toBe(9);
    expect(census.rebuiltWindowCount).toBeLessThan(census.liveWindowCount);
    expect(calls).toHaveLength(1);
  });
});

describe("publishLiveWindows — the three refusals, each before any upload", () => {
  it("HALTS on a non-200 live manifest (404 and 503 alike), naming the key and the status", async () => {
    seedTwoEvents();
    for (const status of [404, 503]) {
      const { calls, upload } = recorder();
      await expect(publishLiveWindows({ seasons: [2026], nowMs: 0 }, deps(async () => ({ status, body: undefined }), upload))).rejects.toThrow(
        new RegExp(`${LIVE_WINDOWS_KEY.replace(/[/.]/g, "\\$&")} answered ${status}`)
      );
      expect(calls).toHaveLength(0);
    }
  });

  it("HALTS on a schemaVersion disagreement, naming both values", async () => {
    seedTwoEvents();
    const { calls, upload } = recorder();

    await expect(publishLiveWindows({ seasons: [2026], nowMs: 0 }, deps(async () => liveManifest({ schemaVersion: 7 }), upload))).rejects.toThrow(
      new RegExp(`schemaVersion 7.*MANIFEST_SCHEMA_VERSION ${MANIFEST_SCHEMA_VERSION}`)
    );
    expect(calls).toHaveLength(0);
  });

  it("HALTS on a zero-window rebuild, naming the zero count and the live manifest's own count", async () => {
    // Every event closed long ago: the rebuild is legitimately empty.
    upsertEvent(db, event({ eventKey: "2026azold" }));
    upsertMatch(db, match({ matchKey: "2026azold_qm1", eventKey: "2026azold", sortTime: 1_000 }));
    const { calls, upload } = recorder();

    await expect(publishLiveWindows({ seasons: [2026], nowMs: 9_000_000 }, deps(async () => liveManifest({}, 11), upload))).rejects.toThrow(/0 windows against the live manifest's 11/);
    expect(calls).toHaveLength(0);
  });

  it("writes the empty manifest, and says so, when --allow-empty is passed explicitly", async () => {
    upsertEvent(db, event({ eventKey: "2026azold" }));
    upsertMatch(db, match({ matchKey: "2026azold_qm1", eventKey: "2026azold", sortTime: 1_000 }));
    const { calls, upload } = recorder();

    const census = await publishLiveWindows({ seasons: [2026], nowMs: 9_000_000, allowEmpty: true }, deps(async () => liveManifest({}, 11), upload));

    expect(census.rebuiltWindowCount).toBe(0);
    expect(census.wrote).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe("publishLiveWindows — the module's own contract", () => {
  it("DEFAULT_LIVE_WINDOWS_SEASONS is the season list publish:seasons itself publishes", () => {
    expect([...DEFAULT_LIVE_WINDOWS_SEASONS]).toEqual(parseSeasonSpec("2016-2020,2022-2026", "--seasons"));
    const publishSeasons = (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts["publish:seasons"]!;
    const spec = /--seasons\s+(\S+)/.exec(publishSeasons)![1]!;
    expect([...DEFAULT_LIVE_WINDOWS_SEASONS]).toEqual(parseSeasonSpec(spec, "--seasons"));
  });

  it("carries exactly ONE live-windows key literal, in one constant", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "publishLiveWindows.ts"), "utf8");
    expect(source.split('"v1/manifest/live-windows.json"')).toHaveLength(2);
  });

  it("does not execute on import: the entry point is guarded, so every test above had to call the exported core explicitly", async () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "publishLiveWindows.ts"), "utf8");
    expect(source).toContain("const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;");
    expect(source).toContain("if (isEntryPoint) {");
    // Importing it here opened no corpus, made no request and needed no
    // credential — this import is what every test above already proved.
    const module = await import("./publishLiveWindows.js");
    expect(typeof module.publishLiveWindows).toBe("function");
  });

  it("reads no environment variable itself — putObject owns the credential boundary", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "publishLiveWindows.ts"), "utf8");
    expect(source.includes("process.env")).toBe(false);
  });
});
