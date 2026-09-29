/**
 * MEASUREMENT ONLY (quick task 260929-mkn). The Node driver for the browser
 * presim pricing spike: extract a finished 2026 event's pre-event pricing state
 * and the Node bake's reference histograms, then measure the browser-safe
 * pricer (`scripts/browserPresimPricing.ts`) in Node and in a real headless
 * Chromium page at 1x/4x/6x CPU throttle.
 *
 * Nothing here publishes, deploys or writes to R2 or D1. The corpus is opened
 * READ-ONLY. No network request is made: every Chromium request is aborted and
 * counted, and the run must report `network-attempts=0`. No environment variable
 * and no credential is read; `.env` is never touched. Working files live under
 * `reports/presim-spike/` (gitignored).
 *
 * Phases (`--phase`): extract, tracer, node, browser, summarize.
 *
 *   tsx scripts/measureBrowserPresimPricing.ts --phase extract --events 2026txmca
 *   tsx scripts/measureBrowserPresimPricing.ts --phase tracer
 *   tsx scripts/measureBrowserPresimPricing.ts --phase node
 *   tsx scripts/measureBrowserPresimPricing.ts --phase browser --throttle 4 --events 2026joh
 *   tsx scripts/measureBrowserPresimPricing.ts --phase summarize
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cpus, platform, release } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { brotliCompressSync, gzipSync, constants as zlibConstants } from "node:zlib";
import type { SprState } from "../packages/core/algorithms/spr.js";
import { DEMO_PSEUDO_TEAM_KEY } from "../packages/core/algorithms/demoTeams.js";
import { isRpEligibleEventType } from "../packages/core/rankingPoints/constants.js";
import { BASE_PUBLISH_ALGORITHMS } from "../packages/harness/publish.js";
import { buildPreScheduleArtifact } from "../packages/harness/preSchedule.js";
import { PublishedPreScheduleArtifactSchema } from "../packages/harness/pageArtifacts.js";
import { DEFAULT_RESTARTS, generateSchedule, matchesPerTeamFor } from "../packages/harness/generatedSchedules.js";
import { mulberry32 } from "../packages/core/algorithms/simulation/rankSimulation.js";
import { buildDistrictPricingState, openDistrictPricingCorpus } from "./districtPricingState.js";
import {
  buildPresimPricer,
  measureCacheEffect,
  measureComponents,
  measurePricingTotal,
  prepareSchedule,
  runPresim,
  type AlliancePiece,
  type PresimBeliefTuple,
  type PresimPricingPayload,
  type PresimSprTuple,
  type PresimTeamRecord,
} from "./browserPresimPricing.js";

const OUT = "reports/presim-spike";
/** `publish:seasons`' own season list, 2021 excluded on purpose: the seasons ahead of 2026. */
const WARMUP_SEASONS = [2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025];
const FIXED_EVENTS = ["2026txmca", "2026joh"];
const CHECKPOINTS = [150, 300, 1000, 2000, 4000];
const PROGRESSIVE_CAP_MS = 240_000;
const P1_SCHEDULES = 200;
const P1_REPS = 3;
const PARITY_SCHEDULES = 1000;
const PARITY_DRAWS = 50;
/** docs/publish-budget.md line 549, the 2026-09-29 publish run's 211 presim sidecars, RAW UTF-8 bytes. */
const SIDECAR_PUBLISH_RUN = { count: 211, median: 7145, p95: 15983, max: 23806 } as const;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

interface ByteSizes {
  raw: number;
  gzip: number;
  brotli: number;
}

function sizesOf(input: string | Uint8Array): ByteSizes {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return {
    raw: buf.length,
    gzip: gzipSync(buf).length,
    brotli: brotliCompressSync(buf, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_DEFAULT_QUALITY } }).length,
  };
}

function ensureOut(): void {
  mkdirSync(OUT, { recursive: true });
}

function writeJson(name: string, value: unknown): void {
  ensureOut();
  writeFileSync(join(OUT, name), JSON.stringify(value));
}

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(OUT, name), "utf8")) as T;
}

/** Differing cells between two roster-by-rank histogram matrices; a shape mismatch counts every cell of the larger. */
function histogramDiff(a: readonly (readonly number[])[], b: readonly (readonly number[])[]): number {
  if (a.length !== b.length) return Math.max(a.length, b.length) ** 2;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    const ra = a[i]!;
    const rb = b[i]!;
    const n = Math.max(ra.length, rb.length);
    for (let j = 0; j < n; j++) if (ra[j] !== rb[j]) diff += 1;
  }
  return diff;
}

function verdict(diff: number): string {
  return diff === 0 ? "identical" : `DIFF ${diff}`;
}

interface EventFile {
  eventKey: string;
  rosterSize: number;
  quals: number;
  matchesPerTeam: number;
  asOf: string;
  sprVersion: string;
  replaySeconds: number;
  referenceBakeSeconds: number;
  sidecar: ByteSizes;
  payload: PresimPricingPayload;
  referenceHistograms: number[][];
}

function readEvent(eventKey: string): EventFile {
  return readJson<EventFile>(`event-${eventKey}.json`);
}

// ---------------------------------------------------------------------------
// extract
// ---------------------------------------------------------------------------

interface EventSummary {
  eventKey: string;
  eventType: number;
  week: number | null;
  roster: string[];
  playedQuals: number;
  scheduledQuals: number;
  firstPlayedSortTime: number | null;
}

/** Every 2026 event with its publisher-style roster (unique team keys over every played and scheduled match, all comp levels). */
function summarizeEvents(db: ReturnType<typeof openDistrictPricingCorpus>): EventSummary[] {
  const events = db.prepare(`SELECT event_key, event_type, week FROM events WHERE year = 2026`).all() as {
    event_key: string;
    event_type: number;
    week: number | null;
  }[];
  const rows = db
    .prepare(
      `SELECT m.event_key AS event_key, m.comp_level AS comp_level, m.red_teams AS red, m.blue_teams AS blue,
              m.winner AS winner, m.sort_time AS sort_time
       FROM matches m JOIN events e ON e.event_key = m.event_key WHERE e.year = 2026`
    )
    .all() as { event_key: string; comp_level: string; red: string; blue: string; winner: string | null; sort_time: number }[];
  const byEvent = new Map<string, EventSummary>();
  const rosterSets = new Map<string, Set<string>>();
  for (const e of events) {
    byEvent.set(e.event_key, { eventKey: e.event_key, eventType: e.event_type, week: e.week, roster: [], playedQuals: 0, scheduledQuals: 0, firstPlayedSortTime: null });
    rosterSets.set(e.event_key, new Set());
  }
  for (const r of rows) {
    const s = byEvent.get(r.event_key);
    if (s === undefined) continue;
    const set = rosterSets.get(r.event_key)!;
    for (const t of JSON.parse(r.red) as string[]) set.add(t);
    for (const t of JSON.parse(r.blue) as string[]) set.add(t);
    if (r.winner !== null) {
      if (r.comp_level === "qm") s.playedQuals += 1;
      if (s.firstPlayedSortTime === null || r.sort_time < s.firstPlayedSortTime) s.firstPlayedSortTime = r.sort_time;
    } else if (r.comp_level === "qm") {
      s.scheduledQuals += 1;
    }
  }
  for (const [key, s] of byEvent) s.roster = [...rosterSets.get(key)!].sort();
  return [...byEvent.values()];
}

function encodeTeams(state: NonNullable<ReturnType<typeof buildDistrictPricingState>>, roster: string[]): {
  teams: PresimTeamRecord[];
  demo: PresimSprTuple | null;
  variables: string[];
} {
  const endState = state.endState as SprState;
  const acc = state.layer.rpAccumulator;
  if (acc === undefined) throw new Error("extract: the layer has no RP accumulator");
  const variables = [...acc.variableNames];
  const beliefs = acc.beliefsByTeam();
  const ratings = state.ratingsFor(roster);
  const teams = roster.map((teamKey): PresimTeamRecord => {
    const s = endState.teams.get(teamKey);
    const sigma = ratings.get(teamKey)?.sigma;
    const belief = beliefs.get(teamKey);
    return {
      s: s === undefined ? null : [s.muL, s.pL, s.muS, s.pS],
      g: sigma === undefined ? null : sigma,
      b:
        belief === undefined
          ? null
          : variables.map((name): PresimBeliefTuple | null => {
              const v = belief[name];
              return v === undefined ? null : [v.weight, v.weightSquares, v.mean, v.m2];
            }),
    };
  });
  const demo = endState.teams.get(DEMO_PSEUDO_TEAM_KEY);
  return { teams, demo: demo === undefined ? null : [demo.muL, demo.pL, demo.muS, demo.pS], variables };
}

/** Builds one event's payload and reference bake, or returns `null` (logged) when the roster is refused. */
function extractEvent(db: ReturnType<typeof openDistrictPricingCorpus>, summary: EventSummary): EventFile | null {
  const algorithm = BASE_PUBLISH_ALGORITHMS["spr"]!;
  const roster = summary.roster;
  if (summary.firstPlayedSortTime === null) {
    console.log(`extract: ${summary.eventKey} refused: no played match`);
    return null;
  }
  const asOf = new Date(summary.firstPlayedSortTime).toISOString();
  const quals = summary.playedQuals + summary.scheduledQuals;
  const matchesPerTeam = matchesPerTeamFor(roster.length, quals);

  const t0 = Date.now();
  const state = buildDistrictPricingState(db, {
    season: 2026,
    warmupSeasons: WARMUP_SEASONS,
    asOf,
    algorithm,
    sigmaCarry: true,
    rpColdPrior: true,
  });
  const replaySeconds = (Date.now() - t0) / 1000;
  console.log(`extract: ${summary.eventKey} replay ${replaySeconds.toFixed(1)} s, as-of ${asOf}, roster ${roster.length}, quals ${quals}, matchesPerTeam ${matchesPerTeam}`);
  if (state === null) {
    console.log(`extract: ${summary.eventKey} refused: no pricing state`);
    return null;
  }
  const predict = state.predictFor(roster);
  if (predict === undefined) {
    console.log(`extract: ${summary.eventKey} refused: predictFor refused the roster (teams without Sigma: ${state.teamsWithoutSigmaFor(roster).join(",")})`);
    return null;
  }

  const { teams, demo, variables } = encodeTeams(state, roster);
  const endState = state.endState as SprState;
  const payload: PresimPricingPayload = {
    eventKey: summary.eventKey,
    season: 2026,
    eventType: summary.eventType,
    week: summary.week,
    algorithmVersion: algorithm.version,
    matchesPerTeam,
    roster,
    teams,
    spr: { logTau: endState.logTau, scale: endState.scale, demo },
    rp: {
      variables,
      population: state.layer.rpAccumulator?.populationState() ?? null,
      meanShift: state.layer.rpMeanShiftState() ?? null,
    },
  };

  const b0 = Date.now();
  const artifact = buildPreScheduleArtifact({
    eventKey: summary.eventKey,
    season: 2026,
    eventType: summary.eventType,
    week: summary.week,
    algorithmId: algorithm.id,
    algorithmVersion: algorithm.version,
    roster,
    matchesPerTeam,
    pricedFrom: "pre-event-walk-forward",
    scheduleCount: PARITY_SCHEDULES,
    drawsPerSchedule: PARITY_DRAWS,
    generation: "measure",
    computedAt: "1970-01-01T00:00:00.000Z",
    predict,
  });
  const referenceBakeSeconds = (Date.now() - b0) / 1000;
  if (artifact === null) throw new Error(`extract: the reference bake returned null for ${summary.eventKey}`);
  const body = JSON.stringify(PublishedPreScheduleArtifactSchema.parse(artifact));
  console.log(`extract: ${summary.eventKey} reference bake ${referenceBakeSeconds.toFixed(1)} s, sidecar body ${Buffer.byteLength(body, "utf8")} B`);

  return {
    eventKey: summary.eventKey,
    rosterSize: roster.length,
    quals,
    matchesPerTeam,
    asOf,
    sprVersion: algorithm.version,
    replaySeconds,
    referenceBakeSeconds,
    sidecar: sizesOf(body),
    payload,
    referenceHistograms: artifact.baked.histograms.map((row) => [...row]),
  };
}

function extractPhase(eventsArg: string[]): void {
  const db = openDistrictPricingCorpus();
  try {
    const summaries = summarizeEvents(db);
    const byKey = new Map(summaries.map((s) => [s.eventKey, s]));
    const tokens = eventsArg.length > 0 ? eventsArg : [...FIXED_EVENTS, "mid40"];
    for (const token of tokens) {
      if (token === "mid40") {
        if (existsSync(join(OUT, "mid40.txt"))) {
          console.log(`extract: mid40 already extracted as ${readFileSync(join(OUT, "mid40.txt"), "utf8")}`);
          continue;
        }
        const candidates = summaries
          .filter(
            (s) =>
              !FIXED_EVENTS.includes(s.eventKey) &&
              isRpEligibleEventType(s.eventType) &&
              s.playedQuals > 0 &&
              s.scheduledQuals === 0 &&
              s.roster.length >= 6
          )
          .sort((a, b) => Math.abs(a.roster.length - 40) - Math.abs(b.roster.length - 40) || (a.eventKey < b.eventKey ? -1 : 1));
        console.log(`extract: mid40 candidates, closest first: ${candidates.slice(0, 5).map((c) => `${c.eventKey}(${c.roster.length})`).join(" ")}`);
        let done = false;
        for (const candidate of candidates) {
          const extracted = extractEvent(db, candidate);
          if (extracted === null) continue;
          writeJson(`event-${candidate.eventKey}.json`, extracted);
          writeFileSync(join(OUT, "mid40.txt"), candidate.eventKey);
          console.log(`extract: mid40 = ${candidate.eventKey} (${candidate.roster.length} teams)`);
          done = true;
          break;
        }
        if (!done) throw new Error("extract: no mid40 candidate could be priced");
        continue;
      }
      const summary = byKey.get(token);
      if (summary === undefined) throw new Error(`extract: unknown 2026 event ${token}`);
      const extracted = extractEvent(db, summary);
      if (extracted === null) throw new Error(`extract: ${token} was refused`);
      writeJson(`event-${token}.json`, extracted);
    }
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// The esbuild bundle and Playwright (both resolved through createRequire, never by bare name)
// ---------------------------------------------------------------------------

interface BundleInfo {
  code: string;
  minified: ByteSizes;
  largestInputs: { path: string; bytes: number }[];
}

interface EsbuildApi {
  build(options: Record<string, unknown>): Promise<{
    outputFiles: { text: string }[];
    metafile: { outputs: Record<string, { inputs: Record<string, { bytesInOutput: number }> }> };
  }>;
  version: string;
}

async function buildBundle(): Promise<BundleInfo> {
  const rootRequire = createRequire(join(process.cwd(), "package.json"));
  const tsxPackage = realpathSync(rootRequire.resolve("tsx/package.json"));
  const esbuild = createRequire(tsxPackage)("esbuild") as EsbuildApi;
  const result = await esbuild.build({
    entryPoints: [join(process.cwd(), "scripts/browserPresimPricing.ts")],
    bundle: true,
    minify: true,
    format: "iife",
    globalName: "__presimSpike",
    platform: "browser",
    target: "es2022",
    metafile: true,
    write: false,
    logLevel: "silent",
  });
  const code = result.outputFiles[0]!.text;
  const inputs = Object.values(result.metafile.outputs)[0]!.inputs;
  const largestInputs = Object.entries(inputs)
    .map(([path, v]) => ({ path, bytes: v.bytesInOutput }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 5);
  const info: BundleInfo = { code, minified: sizesOf(code), largestInputs };
  ensureOut();
  writeFileSync(join(OUT, "bundle.js"), code);
  writeJson("bundle-info.json", { esbuildVersion: esbuild.version, minified: info.minified, largestInputs });
  console.log(`bundle: esbuild ${esbuild.version}, minified ${info.minified.raw} B raw, ${info.minified.gzip} B gzip, ${info.minified.brotli} B brotli`);
  return info;
}

interface PwPage {
  addScriptTag(options: { content: string }): Promise<unknown>;
  evaluate(pageFunction: string, arg?: unknown): Promise<any>;
  goto(url: string): Promise<unknown>;
}
interface PwCdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}
interface PwContext {
  route(url: string, handler: (route: { abort(): Promise<void> }) => void): Promise<void>;
  newPage(): Promise<PwPage>;
  newCDPSession(page: PwPage): Promise<PwCdpSession>;
  close(): Promise<void>;
}
interface PwBrowser {
  newContext(): Promise<PwContext>;
  version(): string;
  close(): Promise<void>;
}
interface PwChromium {
  launch(options: { headless: boolean }): Promise<PwBrowser>;
}

interface BrowserSession {
  browser: PwBrowser;
  networkAttempts: { count: number };
}

async function launchBrowser(): Promise<BrowserSession> {
  const req = createRequire(join(process.cwd(), "apps/web/package.json"));
  const { chromium } = req("@playwright/test") as { chromium: PwChromium };
  const browser = await chromium.launch({ headless: true });
  return { browser, networkAttempts: { count: 0 } };
}

/** A fresh context and page (so JIT state never leaks between measurements), every request aborted and counted, bundle injected, throttle set. */
async function withPage<T>(session: BrowserSession, bundle: string, rate: number, fn: (page: PwPage) => Promise<T>): Promise<T> {
  const context = await session.browser.newContext();
  try {
    await context.route("**/*", (route) => {
      session.networkAttempts.count += 1;
      void route.abort();
    });
    const page = await context.newPage();
    await page.goto("about:blank");
    await page.addScriptTag({ content: bundle });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    return await fn(page);
  } finally {
    await context.close();
  }
}

const CALIBRATE_IN_PAGE = `(() => {
  const samples = [];
  for (let r = 0; r < 3; r++) {
    const t = performance.now();
    let x = 0;
    for (let i = 0; i < 30000000; i++) x += Math.sqrt(i);
    samples.push(performance.now() - t);
    if (x < 0) throw new Error("unreachable");
  }
  samples.sort((a, b) => a - b);
  return samples[1];
})()`;

function callInPage(page: PwPage, fn: string, payload: PresimPricingPayload, options: unknown): Promise<any> {
  return page.evaluate(`globalThis.__presimSpike[${JSON.stringify(fn)}](JSON.parse(${JSON.stringify(JSON.stringify(payload))}), ${JSON.stringify(options)})`);
}

// ---------------------------------------------------------------------------
// tracer
// ---------------------------------------------------------------------------

function stripTotals<T extends { totals: number[][] }>(result: T): Omit<T, "totals"> {
  const { totals: _totals, ...rest } = result;
  return rest;
}

async function tracerPhase(): Promise<void> {
  const eventKey = "2026txmca";
  const ev = readEvent(eventKey);
  const opts = (cache: boolean) => ({ scheduleCount: PARITY_SCHEDULES, drawsPerSchedule: PARITY_DRAWS, cache });

  const nU0 = Date.now();
  const nodeUncached = runPresim(ev.payload, opts(false));
  const nodeUncachedWall = (Date.now() - nU0) / 1000;
  const nC0 = Date.now();
  const nodeCached = runPresim(ev.payload, opts(true));
  const nodeCachedWall = (Date.now() - nC0) / 1000;
  const diffNodeUncached = histogramDiff(nodeUncached.totals, ev.referenceHistograms);
  const diffNodeCached = histogramDiff(nodeCached.totals, ev.referenceHistograms);

  const bundle = await buildBundle();
  const session = await launchBrowser();
  let diffBrowser: number;
  let browserWall: number;
  try {
    const t0 = Date.now();
    const result = await withPage(session, bundle.code, 1, (page) => callInPage(page, "runPresim", ev.payload, opts(true)));
    browserWall = (Date.now() - t0) / 1000;
    diffBrowser = histogramDiff(result.totals, ev.referenceHistograms);
    console.log(`tracer: chromium ${session.browser.version()}, in-page elapsed ${(result.elapsedMs / 1000).toFixed(2)} s (generate ${(result.generateMs / 1000).toFixed(2)}, price ${(result.priceMs / 1000).toFixed(2)}, draw ${(result.drawMs / 1000).toFixed(2)})`);
  } finally {
    await session.browser.close();
  }
  console.log(
    `tracer: node uncached ${nodeUncachedWall.toFixed(2)} s (price ${(nodeUncached.priceMs / 1000).toFixed(2)}), node cached ${nodeCachedWall.toFixed(2)} s (price ${(nodeCached.priceMs / 1000).toFixed(2)}), chromium-1x cached wall ${browserWall.toFixed(2)} s, reference bake ${ev.referenceBakeSeconds.toFixed(2)} s`
  );
  console.log(
    `PARITY ${eventKey} node-uncached=${verdict(diffNodeUncached)} node-cached=${verdict(diffNodeCached)} chromium-1x-cached=${verdict(diffBrowser)} network-attempts=${session.networkAttempts.count}`
  );
}

// ---------------------------------------------------------------------------
// node
// ---------------------------------------------------------------------------

/** Structures for schedules 0..count-1 as the six-bytes-per-match encoding, raw and gzip. */
function structureBytes(ev: EventFile, count: number): { matchesPerSchedule: number; raw: number; gzip: number } {
  const numTeams = ev.rosterSize;
  const chunks: Uint8Array[] = [];
  let matchesPerSchedule = 0;
  for (let k = 0; k < count; k++) {
    const structure = generateSchedule(numTeams, ev.matchesPerTeam, mulberry32(fnv1a32(`generate|${numTeams}|${ev.matchesPerTeam}|${k}`)), DEFAULT_RESTARTS);
    matchesPerSchedule = structure.length;
    const encoded = new Uint8Array(structure.length * 6);
    for (let m = 0; m < structure.length; m++) {
      const match = structure[m]!;
      for (let pos = 0; pos < 3; pos++) {
        encoded[m * 6 + pos] = match.red[pos]! | (match.redSurrogate[pos] === true ? 0x80 : 0);
        encoded[m * 6 + 3 + pos] = match.blue[pos]! | (match.blueSurrogate[pos] === true ? 0x80 : 0);
      }
    }
    chunks.push(encoded);
  }
  const all = Buffer.concat(chunks);
  return { matchesPerSchedule, raw: all.length, gzip: gzipSync(all).length };
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Matches whose rounded rp/bp differ between the uncached and the cached arm, over `count` schedules with one shared cache. */
function armDifferences(payload: PresimPricingPayload, count: number): { matches: number; matchesDiffering: number; maxAbsDiff: number } {
  const pricer = buildPresimPricer(payload);
  const cache = new Map<string, AlliancePiece>();
  let matches = 0;
  let matchesDiffering = 0;
  let maxAbsDiff = 0;
  for (let k = 0; k < count; k++) {
    for (const match of prepareSchedule(payload, k)) {
      const u = pricer.priceUncached(match);
      const c = pricer.priceCached(match, cache);
      matches += 1;
      let differs = false;
      for (const [x, y] of [
        [u.rp, c.rp],
        [u.bp, c.bp],
      ] as const) {
        for (let i = 0; i < x.length; i++) {
          const d = Math.abs(x[i]! - y[i]!);
          if (d > 0) differs = true;
          if (d > maxAbsDiff) maxAbsDiff = d;
        }
      }
      if (differs) matchesDiffering += 1;
    }
  }
  return { matches, matchesDiffering, maxAbsDiff };
}

function nodeEvents(eventsArg: string[]): string[] {
  if (eventsArg.length > 0) return eventsArg.map(resolveEventToken);
  return [...FIXED_EVENTS, resolveEventToken("mid40")];
}

function resolveEventToken(token: string): string {
  if (token !== "mid40") return token;
  return readFileSync(join(OUT, "mid40.txt"), "utf8").trim();
}

function nodePhase(eventsArg: string[]): void {
  for (const eventKey of nodeEvents(eventsArg)) {
    const ev = readEvent(eventKey);
    console.log(`node: ${eventKey} (${ev.rosterSize} teams, ${ev.quals} quals, ${ev.matchesPerTeam} per team)`);

    // Q3 first, on the coldest state this process has.
    const progressive = runPresim(ev.payload, {
      scheduleCount: 4000,
      drawsPerSchedule: PARITY_DRAWS,
      cache: true,
      checkpoints: CHECKPOINTS,
      maxWallMs: PROGRESSIVE_CAP_MS,
    });
    console.log(`node: ${eventKey} progressive reached ${progressive.completed}, elapsed ${(progressive.elapsedMs / 1000).toFixed(1)} s, stoppedEarly=${progressive.stoppedEarly}`);

    // P2 parity, 1000 x 50, both arms.
    const uncached = runPresim(ev.payload, { scheduleCount: PARITY_SCHEDULES, drawsPerSchedule: PARITY_DRAWS, cache: false });
    const cached = runPresim(ev.payload, { scheduleCount: PARITY_SCHEDULES, drawsPerSchedule: PARITY_DRAWS, cache: true });
    const arms = armDifferences(ev.payload, PARITY_SCHEDULES);
    const nodeUncachedDiff = histogramDiff(uncached.totals, ev.referenceHistograms);
    const nodeCachedDiff = histogramDiff(cached.totals, ev.referenceHistograms);
    console.log(
      `node: ${eventKey} parity uncached=${verdict(nodeUncachedDiff)} cached=${verdict(nodeCachedDiff)}, arms differ on ${arms.matchesDiffering}/${arms.matches} matches (max abs pmf diff ${arms.maxAbsDiff})`
    );

    const p1 = measureCacheEffect(ev.payload, { scheduleCount: P1_SCHEDULES, reps: P1_REPS });
    console.log(`node: ${eventKey} P1 median cached/uncached ratio ${p1.medianRatio.toFixed(3)} [${p1.minRatio.toFixed(3)}, ${p1.maxRatio.toFixed(3)}]`);
    const pricing1000 = measurePricingTotal(ev.payload, { scheduleCount: 1000 });
    const components = measureComponents(ev.payload, { scheduleCount: P1_SCHEDULES });

    const payloadJson = JSON.stringify(ev.payload);
    writeJson(`node-${eventKey}.json`, {
      eventKey,
      parity: { nodeUncachedDiff, nodeCachedDiff, arms },
      p1,
      pricing1000,
      components,
      progressive: stripTotals(progressive),
      payloadBytes: sizesOf(payloadJson),
      structuresBytes: structureBytes(ev, 1000),
    });
  }
}

// ---------------------------------------------------------------------------
// browser
// ---------------------------------------------------------------------------

async function browserPhase(eventsArg: string[], rate: number, only: string | undefined, suffix: string): Promise<void> {
  const bundle = await buildBundle();
  const session = await launchBrowser();
  try {
    const chromiumVersion = session.browser.version();
    for (const eventKey of nodeEvents(eventsArg)) {
      const ev = readEvent(eventKey);
      console.log(`browser: ${eventKey} at ${rate}x (${ev.rosterSize} teams), chromium ${chromiumVersion}`);
      const calibrationMs: number = await withPage(session, bundle.code, rate, (page) => page.evaluate(CALIBRATE_IN_PAGE));
      const out: Record<string, unknown> = { eventKey, rate, chromiumVersion, calibrationMs };

      // Q3 in a fresh page so the first chunk carries cold JIT, as a real visit would.
      const progressive = await withPage(session, bundle.code, rate, (page) =>
        callInPage(page, "runPresim", ev.payload, {
          scheduleCount: 4000,
          drawsPerSchedule: PARITY_DRAWS,
          cache: true,
          checkpoints: CHECKPOINTS,
          maxWallMs: PROGRESSIVE_CAP_MS,
        })
      );
      out["progressive"] = stripTotals(progressive as { totals: number[][] });
      console.log(`browser: ${eventKey} ${rate}x progressive reached ${progressive.completed}, elapsed ${(progressive.elapsedMs / 1000).toFixed(1)} s, stoppedEarly=${progressive.stoppedEarly}`);

      if (only !== "progressive") {
        const p1 = await withPage(session, bundle.code, rate, (page) =>
          callInPage(page, "measureCacheEffect", ev.payload, { scheduleCount: P1_SCHEDULES, reps: P1_REPS })
        );
        out["p1"] = p1;
        console.log(`browser: ${eventKey} ${rate}x P1 median ratio ${p1.medianRatio.toFixed(3)} [${p1.minRatio.toFixed(3)}, ${p1.maxRatio.toFixed(3)}]`);

        if (rate === 1) {
          const opts = (cache: boolean) => ({ scheduleCount: PARITY_SCHEDULES, drawsPerSchedule: PARITY_DRAWS, cache });
          const uncached = await withPage(session, bundle.code, rate, (page) => callInPage(page, "runPresim", ev.payload, opts(false)));
          const cachedRun = await withPage(session, bundle.code, rate, (page) => callInPage(page, "runPresim", ev.payload, opts(true)));
          const diffU = histogramDiff(uncached.totals, ev.referenceHistograms);
          const diffC = histogramDiff(cachedRun.totals, ev.referenceHistograms);
          out["parity"] = { chromiumUncachedDiff: diffU, chromiumCachedDiff: diffC };
          console.log(`browser: ${eventKey} 1x parity uncached=${verdict(diffU)} cached=${verdict(diffC)}`);
          out["pricing1000"] = await withPage(session, bundle.code, rate, (page) =>
            callInPage(page, "measurePricingTotal", ev.payload, { scheduleCount: 1000 })
          );
          out["components"] = await withPage(session, bundle.code, rate, (page) =>
            callInPage(page, "measureComponents", ev.payload, { scheduleCount: P1_SCHEDULES })
          );
        }
      }
      out["networkAttemptsSoFar"] = session.networkAttempts.count;
      writeJson(`browser-${rate}-${eventKey}${suffix}.json`, out);
    }
    console.log(`browser: network-attempts=${session.networkAttempts.count}`);
  } finally {
    await session.browser.close();
  }
}

// ---------------------------------------------------------------------------
// summarize
// ---------------------------------------------------------------------------

function summarizePhase(): void {
  const eventKeys = [...FIXED_EVENTS, resolveEventToken("mid40")];
  const files = new Set(readdirSync(OUT));
  const bundleInfo = readJson<{ esbuildVersion: string; minified: ByteSizes; largestInputs: { path: string; bytes: number }[] }>("bundle-info.json");

  interface NodeFile {
    parity: { nodeUncachedDiff: number; nodeCachedDiff: number; arms: { matches: number; matchesDiffering: number; maxAbsDiff: number } };
    p1: any;
    pricing1000: any;
    components: any;
    progressive: any;
    payloadBytes: ByteSizes;
    structuresBytes: { matchesPerSchedule: number; raw: number; gzip: number };
  }

  const events: unknown[] = [];
  const parity: Record<string, unknown> = {};
  const q1: Record<string, unknown> = {};
  const components: Record<string, unknown> = {};
  const q2Events: Record<string, unknown> = {};
  const q3: Record<string, unknown> = {};
  let chromiumVersion = "";
  let maxAttempts = 0;
  const calibration: Record<string, Record<string, number>> = {};

  for (const key of eventKeys) {
    const ev = readEvent(key);
    const node = readJson<NodeFile>(`node-${key}.json`);
    events.push({
      eventKey: key,
      rosterSize: ev.rosterSize,
      quals: ev.quals,
      matchesPerTeam: ev.matchesPerTeam,
      asOf: ev.asOf,
      sprVersion: ev.sprVersion,
      replaySeconds: Number(ev.replaySeconds.toFixed(1)),
      referenceBakeSeconds: Number(ev.referenceBakeSeconds.toFixed(1)),
    });

    const browserByRate: Record<number, any> = {};
    const browserRun2: any = files.has(`browser-1-${key}-r2.json`) ? readJson(`browser-1-${key}-r2.json`) : undefined;
    for (const rate of [1, 4, 6]) {
      const name = `browser-${rate}-${key}.json`;
      if (files.has(name)) browserByRate[rate] = readJson(name);
    }
    for (const b of Object.values(browserByRate)) {
      if (typeof b.chromiumVersion === "string") chromiumVersion = b.chromiumVersion;
      if (typeof b.networkAttemptsSoFar === "number") maxAttempts = Math.max(maxAttempts, b.networkAttemptsSoFar);
      (calibration[key] ??= {})[String(b.rate)] = Number((b.calibrationMs as number).toFixed(1));
    }

    parity[key] = {
      nodeUncachedDiff: node.parity.nodeUncachedDiff,
      nodeCachedDiff: node.parity.nodeCachedDiff,
      chromium1xUncachedDiff: browserByRate[1]?.parity?.chromiumUncachedDiff ?? null,
      chromium1xCachedDiff: browserByRate[1]?.parity?.chromiumCachedDiff ?? null,
      armMatches: node.parity.arms.matches,
      armMatchesDiffering: node.parity.arms.matchesDiffering,
      armMaxAbsPmfDiff: node.parity.arms.maxAbsDiff,
    };

    const n = ev.rosterSize;
    const distinctAlliances = (n * (n - 1) * (n - 2)) / 6;
    const cell = (p1: any, pricing1000: any, progressive: any, rate: number | "node") => {
      const cachedAt1000 = (progressive.checkpoints as { count: number; priceMs: number }[]).find((c) => c.count === 1000)?.priceMs ?? null;
      return {
        rate,
        p1: {
          uncachedUsPerCall: p1.uncachedUsPerCall,
          cachedUsPerCall: p1.cachedUsPerCall,
          reps: p1.reps,
          medianRatio: p1.medianRatio,
          minRatio: p1.minRatio,
          maxRatio: p1.maxRatio,
        },
        perEventTotalMsAt1000: {
          uncachedMs: pricing1000 !== undefined ? pricing1000.uncachedMs : p1.reps.map((r: any) => r.uncachedMs).sort((a: number, b: number) => a - b)[1] * 5,
          uncachedExtrapolated: pricing1000 === undefined,
          uncachedBasis: pricing1000 !== undefined ? "measured at K=1000" : "K=200 median-rep uncached ms x 5",
          cachedMs: cachedAt1000,
          cachedBasis: "progressive run's 1000-schedule checkpoint, price phase only, measured",
          cachedDirectAtK1000Ms: pricing1000?.cachedMs ?? null,
        },
      };
    };
    q1[key] = {
      distinctAlliancesPossible: distinctAlliances,
      alliancePricingSlotsAt1000: node.pricing1000.allianceSlots,
      uniqueAlliancesAt1000: node.pricing1000.uniqueAlliances,
      cacheHitRateAt1000: 1 - node.pricing1000.cacheMisses / node.pricing1000.allianceSlots,
      node: cell(node.p1, node.pricing1000, node.progressive, "node"),
      browser: Object.fromEntries(Object.entries(browserByRate).map(([rate, b]) => [rate, cell(b.p1, b.pricing1000, b.progressive, Number(rate))])),
    };

    components[key] = { node: node.components, chromium1x: browserByRate[1]?.components ?? null };

    q2Events[key] = {
      payloadBytes: node.payloadBytes,
      rebuiltSidecarBytes: ev.sidecar,
      structuresBytesFor1000: node.structuresBytes,
    };

    const q3Cell = (progressive: any) => ({
      checkpoints: progressive.checkpoints,
      completed: progressive.completed,
      stoppedEarly: progressive.stoppedEarly,
      capMs: PROGRESSIVE_CAP_MS,
      elapsedMs: progressive.elapsedMs,
    });
    q3[key] = {
      node: q3Cell(node.progressive),
      browser: Object.fromEntries(Object.entries(browserByRate).map(([rate, b]) => [rate, q3Cell(b.progressive)])),
      ...(browserRun2 !== undefined ? { browser1xRun2: q3Cell(browserRun2.progressive) } : {}),
    };
  }

  const results = {
    host: {
      node: process.version,
      chromium: chromiumVersion,
      cpu: cpus()[0]?.model ?? "unknown",
      logicalCpus: cpus().length,
      os: `${platform()} ${release()}`,
      esbuild: bundleInfo.esbuildVersion,
      throttleMeaning: "CDP Emulation.setCPUThrottlingRate on a desktop host, main thread; 4x is Lighthouse's mobile preset, 6x read as a low-end phone; approximations only",
      throttleCalibrationMs: calibration,
      browserNetworkAttemptsMaxPerInvocation: maxAttempts,
    },
    events,
    parity,
    q1,
    components,
    q2: {
      events: q2Events,
      sidecarPublishRun: SIDECAR_PUBLISH_RUN,
      bundle: { minified: bundleInfo.minified, largestInputs: bundleInfo.largestInputs },
    },
    q3,
  };
  writeFileSync(
    ".planning/quick/260929-mkn-browser-presim-pricing-measurement-spike/260929-mkn-results.json",
    JSON.stringify(results, null, 1) + "\n"
  );
  console.log(`summarize: wrote results for ${eventKeys.join(", ")}`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      phase: { type: "string" },
      events: { type: "string" },
      throttle: { type: "string" },
      only: { type: "string" },
      suffix: { type: "string" },
    },
  });
  ensureOut();
  const eventsArg = values.events === undefined ? [] : values.events.split(",").filter((s) => s.length > 0);
  switch (values.phase) {
    case "extract":
      extractPhase(eventsArg);
      break;
    case "tracer":
      await tracerPhase();
      break;
    case "node":
      nodePhase(eventsArg);
      break;
    case "browser": {
      const rate = Number(values.throttle);
      if (![1, 4, 6].includes(rate)) throw new Error("browser phase needs --throttle 1|4|6");
      await browserPhase(eventsArg, rate, values.only, values.suffix ?? "");
      break;
    }
    case "summarize":
      summarizePhase();
      break;
    default:
      throw new Error("--phase must be extract, tracer, node, browser or summarize");
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
