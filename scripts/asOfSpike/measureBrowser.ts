/**
 * MEASUREMENT ONLY (quick task 261005-5g0 spike). The Node driver for the
 * browser timing run, modelled on `scripts/measureBrowserPresimPricing.ts`:
 * build the season-start payload for every 2026 Michigan event from the
 * captured FILES, then time `browserRun.ts`'s three arms in Node and in a real
 * headless Chromium page at 1x/4x/6x CPU throttle.
 *
 * Nothing here publishes, deploys or writes to R2 or D1. The corpus is opened
 * READ-ONLY. No network request is made: every Chromium request is aborted and
 * counted. No environment variable and no credential is read.
 *
 *   npx tsx scripts/asOfSpike/measureBrowser.ts --phase payload
 *   npx tsx scripts/asOfSpike/measureBrowser.ts --phase bundle
 *   npx tsx scripts/asOfSpike/measureBrowser.ts --phase node
 *   npx tsx scripts/asOfSpike/measureBrowser.ts --phase browser --throttle 4 [--suffix -r2]
 */
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cpus, platform, release, totalmem } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { brotliCompressSync, gzipSync, constants as zlibConstants } from "node:zlib";
import { openCorpusReadOnly, selectMatchesChronological } from "../../packages/corpus/db.js";
import { matchesPerTeamFor } from "../../packages/harness/generatedSchedules.js";
import { SEASON_START_CUT, type TeamTuple } from "./format.js";
import { leagueAt, resolveTeamStateAt } from "./lookup.js";
import { FileSource } from "./oracleCheck.js";
import { runArm, type ArmResult, type SpikeEvent, type SpikePayload } from "./browserRun.js";

const CORPUS = "C:/Users/Jacob/Documents/GitHub/SigmaScout/data/corpus.sqlite";
const OUT = "reports/asof-spike";
const SEASON = 2026;
/** `apps/web/src/workers/simulationProtocol.ts`: `SIMULATION_DRAWS` and `DEFAULT_SIMULATION_SEED`, which `districtSimulationProtocol.ts` re-exports. */
const SITE_DRAWS = 1000;
const SITE_SEED = 20260830;
const ARMS = ["R", "B", "G"] as const;
const GROUPS = ["district", "dcmp"] as const;

interface ByteSizes {
  raw: number;
  gzip: number;
  brotli: number;
}

function sizesOf(input: string): ByteSizes {
  const buf = Buffer.from(input, "utf8");
  return {
    raw: buf.length,
    gzip: gzipSync(buf, { level: 9 }).length,
    brotli: brotliCompressSync(buf, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: buf.length } }).length,
  };
}

// ---------------------------------------------------------------------------
// payload
// ---------------------------------------------------------------------------

function payloadPhase(): void {
  const db = openCorpusReadOnly(CORPUS);
  try {
    const rows = db.prepare(`SELECT event_key AS k, event_type AS ty, week AS w FROM events WHERE year = ? AND district_key = 'fim' ORDER BY event_key`).all(SEASON) as {
      k: string;
      ty: number;
      w: number | null;
    }[];
    const source = new FileSource(join(OUT, String(SEASON)));
    const cut = SEASON_START_CUT;
    const district: SpikeEvent[] = [];
    const dcmp: SpikeEvent[] = [];
    const skipped: string[] = [];
    let vars: string[] = [];
    let algorithmVersion = "";
    for (const row of rows) {
      const matches = selectMatchesChronological(db, { eventKey: row.k });
      const quals = matches.filter((m) => m.compLevel === "qm");
      if (quals.length === 0) {
        skipped.push(`${row.k} (no qualification match; a divisioned DCMP parent, which the offline bake also excludes)`);
        continue;
      }
      const roster = [...new Set(matches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))].sort();
      const at = new Map(roster.map((teamKey, i) => [teamKey, i]));
      const index = source.getIndex(row.k);
      vars = index.vars;
      algorithmVersion = index.algorithmVersion;
      const teams: TeamTuple[] = roster.map((teamKey) => resolveTeamStateAt(teamKey, cut, row.k, source).tuple);
      const event: SpikeEvent = {
        eventKey: row.k,
        eventType: row.ty,
        week: row.w,
        tier: row.ty === 1 ? "district" : "dcmp",
        roster,
        teams,
        matchesPerTeam: matchesPerTeamFor(roster.length, quals.length),
        schedule: quals.map((m) => ({
          n: m.matchNumber,
          r: m.redTeams.map((t) => at.get(t)!),
          b: m.blueTeams.map((t) => at.get(t)!),
          rs: m.redSurrogates.map((t) => at.get(t)!),
          bs: m.blueSurrogates.map((t) => at.get(t)!),
        })),
      };
      (event.tier === "district" ? district : dcmp).push(event);
    }
    const payload: SpikePayload = { season: SEASON, algorithmVersion, vars, league: leagueAt(cut, source), draws: SITE_DRAWS, seed: SITE_SEED, district, dcmp };
    const text = JSON.stringify(payload);
    writeFileSync(join(OUT, "browser-payload.json"), text);
    const info = {
      districtEvents: district.length,
      dcmpEvents: dcmp.length,
      skipped,
      districtTeams: district.reduce((n, e) => n + e.roster.length, 0),
      districtQuals: district.reduce((n, e) => n + e.schedule.length, 0),
      dcmpTeams: dcmp.reduce((n, e) => n + e.roster.length, 0),
      dcmpQuals: dcmp.reduce((n, e) => n + e.schedule.length, 0),
      matchesPerTeam: [...district, ...dcmp].map((e) => `${e.eventKey}:${e.roster.length}t/${e.schedule.length}q/${e.matchesPerTeam}`),
      payloadBytes: sizesOf(text),
      districtOnlyBytes: sizesOf(JSON.stringify({ ...payload, dcmp: [] })),
      indexFilesRead: source.indexReads.size,
      logFilesRead: source.logReads.size,
    };
    writeFileSync(join(OUT, "browser-payload-info.json"), JSON.stringify(info, null, 1));
    console.log(`payload: ${JSON.stringify(info, null, 1)}`);
  } finally {
    db.close();
  }
}

function readPayload(): SpikePayload {
  return JSON.parse(readFileSync(join(OUT, "browser-payload.json"), "utf8")) as SpikePayload;
}

// ---------------------------------------------------------------------------
// bundle
// ---------------------------------------------------------------------------

interface EsbuildApi {
  build(options: Record<string, unknown>): Promise<{
    outputFiles: { text: string }[];
    metafile: { outputs: Record<string, { inputs: Record<string, { bytesInOutput: number }> }> };
  }>;
  version: string;
}

function loadEsbuild(): EsbuildApi {
  const rootRequire = createRequire(join(process.cwd(), "package.json"));
  const tsxPackage = realpathSync(rootRequire.resolve("tsx/package.json"));
  return createRequire(tsxPackage)("esbuild") as EsbuildApi;
}

async function buildBundle(): Promise<string> {
  const esbuild = loadEsbuild();
  const common = {
    entryPoints: [join(process.cwd(), "scripts/asOfSpike/browserRun.ts")],
    bundle: true,
    minify: true,
    format: "iife",
    globalName: "__asOfSpike",
    platform: "browser",
    target: "es2022",
    metafile: true,
    write: false,
    logLevel: "silent",
  };
  const full = await esbuild.build(common);
  const code = full.outputFiles[0]!.text;
  const inputs = Object.values(full.metafile.outputs)[0]!.inputs;
  const byGroup = new Map<string, number>();
  for (const [path, v] of Object.entries(inputs)) {
    const group = path.includes("node_modules")
      ? path.includes("zod")
        ? "zod"
        : "other node_modules"
      : path.includes("packages/core/districts")
        ? "packages/core/districts"
        : path.includes("packages/core/rankingPoints")
          ? "packages/core/rankingPoints"
          : path.includes("packages/core/algorithms")
            ? "packages/core/algorithms"
            : path.includes("packages/harness")
              ? "packages/harness"
              : path.includes("scripts/asOfSpike")
                ? "scripts/asOfSpike"
                : "other";
    byGroup.set(group, (byGroup.get(group) ?? 0) + v.bytesInOutput);
  }
  const largestInputs = Object.entries(inputs)
    .map(([path, v]) => ({ path, bytes: v.bytesInOutput }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 8);
  // SIZE ONLY, never executed: the same bundle with zod left as an external import.
  const external = await esbuild.build({ ...common, globalName: "__asOfSpikeNoZod", external: ["zod", "zod/*"], metafile: false });
  const info = {
    esbuildVersion: esbuild.version,
    minified: sizesOf(code),
    zodExternalSizeOnly: sizesOf(external.outputFiles[0]!.text),
    minifiedBytesByGroup: Object.fromEntries([...byGroup].sort((a, b) => b[1] - a[1])),
    largestInputs,
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "browser-bundle.js"), code);
  writeFileSync(join(OUT, "browser-bundle-info.json"), JSON.stringify(info, null, 1));
  console.log(`bundle: ${JSON.stringify(info, null, 1)}`);
  return code;
}

// ---------------------------------------------------------------------------
// node
// ---------------------------------------------------------------------------

function hostInfo(): Record<string, unknown> {
  return {
    node: process.version,
    cpu: cpus()[0]?.model ?? "unknown",
    logicalCpus: cpus().length,
    memoryGb: Number((totalmem() / 2 ** 30).toFixed(0)),
    os: `${platform()} ${release()}`,
  };
}

function short(r: ArmResult): string {
  return `${r.group} arm ${r.arm}: wall ${r.wallMs.toFixed(0)} ms (build ${r.buildMs.toFixed(0)}, generate ${r.generateMs.toFixed(0)}, price ${r.priceMs.toFixed(0)}, simulate ${r.simulateMs.toFixed(0)}), ${r.events} events, ${r.matchesPriced} matches priced, checksum ${r.checksum}`;
}

function nodePhase(): void {
  const payload = readPayload();
  const results: ArmResult[] = [];
  for (const group of GROUPS) {
    for (const arm of ARMS) {
      const r = runArm(payload, arm, group);
      results.push(r);
      console.log(`node: ${short(r)}`);
    }
  }
  writeFileSync(join(OUT, "browser-node.json"), JSON.stringify({ host: hostInfo(), results }, null, 1));
}

// ---------------------------------------------------------------------------
// browser
// ---------------------------------------------------------------------------

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

async function browserPhase(rate: number, suffix: string): Promise<void> {
  const bundle = await buildBundle();
  const payloadText = readFileSync(join(OUT, "browser-payload.json"), "utf8");
  const req = createRequire(join(process.cwd(), "apps/web/package.json"));
  const { chromium } = req("@playwright/test") as { chromium: PwChromium };
  const playwrightVersion = (req("@playwright/test/package.json") as { version: string }).version;
  const browser = await chromium.launch({ headless: true });
  let networkAttempts = 0;

  /** A fresh context and page per measurement (so JIT state never leaks between arms), every request aborted and counted. */
  async function withPage<T>(fn: (page: PwPage) => Promise<T>): Promise<T> {
    const context = await browser.newContext();
    try {
      await context.route("**/*", (route) => {
        networkAttempts += 1;
        void route.abort();
      });
      const page = await context.newPage();
      await page.goto("about:blank");
      await page.addScriptTag({ content: bundle });
      // The payload is parsed before the throttle is set; parsing is not part of any timed phase.
      await page.evaluate(`globalThis.__payload = JSON.parse(${JSON.stringify(payloadText)}); 0`);
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
      return await fn(page);
    } finally {
      await context.close();
    }
  }

  try {
    const chromiumVersion = browser.version();
    const calibrationMs: number = await withPage((page) => page.evaluate(CALIBRATE_IN_PAGE));
    console.log(`browser: chromium ${chromiumVersion}, playwright ${playwrightVersion}, throttle ${rate}x, calibration ${calibrationMs.toFixed(1)} ms`);
    const results: ArmResult[] = [];
    for (const group of GROUPS) {
      for (const arm of ARMS) {
        const r = (await withPage((page) => page.evaluate(`globalThis.__asOfSpike.runArm(globalThis.__payload, ${JSON.stringify(arm)}, ${JSON.stringify(group)})`))) as ArmResult;
        results.push(r);
        console.log(`browser ${rate}x: ${short(r)}`);
      }
    }
    console.log(`browser: network-attempts=${networkAttempts}`);
    writeFileSync(
      join(OUT, `browser-${rate}x${suffix}.json`),
      JSON.stringify({ host: { ...hostInfo(), chromium: chromiumVersion, playwright: playwrightVersion }, rate, calibrationMs, networkAttempts, results }, null, 1)
    );
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { phase: { type: "string" }, throttle: { type: "string" }, suffix: { type: "string" } } });
  mkdirSync(OUT, { recursive: true });
  switch (values.phase) {
    case "payload":
      payloadPhase();
      break;
    case "bundle":
      await buildBundle();
      break;
    case "node":
      nodePhase();
      break;
    case "browser": {
      const rate = Number(values.throttle);
      if (![1, 4, 6].includes(rate)) throw new Error("browser phase needs --throttle 1|4|6");
      await browserPhase(rate, values.suffix ?? "");
      break;
    }
    default:
      throw new Error("--phase must be payload, bundle, node or browser");
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
