/**
 * CROSS-ENGINE DETERMINISM INSTRUMENT (quick task 260917-mwu, Half B). It
 * measures and reports; it publishes nothing, deploys nothing and installs
 * nothing.
 *
 * THE QUESTION. `spr.ts` and the RP marginals path both call `Math.exp`,
 * `Math.log` and `Math.log1p`. IEEE-754 specifies `Math.sqrt` to be correctly
 * rounded — it is bit-identical on every engine — but it does NOT specify the
 * transcendentals to the last bit, and V8, JavaScriptCore and SpiderMonkey are
 * known to differ. If a relay folds matches in the browser, two visitors on
 * different browsers could see different ratings for the same match. That is a
 * correctness problem for a relay in a way it is not for a single server.
 *
 * WHY FOLDING IS A HARDER TEST than the pricing parity already shipped:
 * `logTau` is a RUNNING accumulator stepped once per folded match, so a one-ulp
 * difference in `Math.exp(logTau)` feeds `pRed`, feeds `grad`, feeds the NEXT
 * match's `logTau`. Differences compound across the fold rather than staying
 * put. A clean cross-engine result for `priceUpcomingFromState` would not
 * transfer, which is why this measurement exists at all.
 *
 * HOW IT REFUSES TO MEASURE NOTHING. The bundle is built with the repo's own
 * `esbuild` from `browserFoldEntry.ts`, and BEFORE any engine launches it is
 * asserted to contain a distinctive marker string from every source module in
 * the graph. A tree-shaken, stubbed or stale bundle therefore fails loudly
 * instead of agreeing with itself across three engines.
 *
 * HOW IT REFUSES TO OVER-CLAIM. Every engine that is absent or fails to launch
 * is reported as NOT RUN, with the reason and the exact command that would add
 * it. A two-engine agreement reported as three would be the worst possible
 * outcome of this half, so the verdict is computed from the engines that ACTUALLY
 * ran and states how many that was.
 *
 * SAFETY: no network of its own (Playwright drives a LOCAL browser against
 * `about:blank`; no page ever loads a URL), no R2 client, no signing SDK, no
 * environment variable read, and the corpus is opened read-only. It installs no
 * package: `esbuild`, `@playwright/test`, `tsx` and `better-sqlite3` are all
 * already in `node_modules`.
 *
 * USAGE (no `.env`, no network):
 *   npx tsx scripts/measureEngineDeterminism.ts --events 2026nyro
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createContext, runInContext } from "node:vm";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { openCorpusReadOnly } from "../packages/corpus/db.js";
import { buildSeasonStream } from "../packages/harness/replay.js";
import { corpusColdStartIndex } from "../packages/harness/corpusColdStart.js";
import { EventStateBlockSchema } from "../packages/harness/pageArtifacts.js";
import { buildEventStateBlock } from "../packages/harness/eventStatePricing.js";
import { ROUNDING_RULE } from "../packages/harness/rounding.js";
import type { StateRow } from "../packages/harness/stateSnapshot.js";
import type { MatchResult } from "../packages/core/algorithms/types.js";
import { MIRROR_FOLD_MARKER } from "./replayParityMirror.js";
import { browserFold, BROWSER_FOLD_ENTRY_MARKER, type BrowserFoldInput, type BrowserFoldResult } from "./browserFoldEntry.js";
import { armHarness, parseEventsArg, passengerRows, PRICED_SEASON, readRowLookups } from "./measureReplayParity.js";

const CORPUS_PATH = join("data", "corpus.sqlite");
const REPORT_DIR = join("reports", "replay-parity");
const BUNDLE_PATH = join(REPORT_DIR, "browserFoldEntry.bundle.js");

/**
 * A distinctive string from each source module the fold's transcendentals live
 * in. Present in the built bundle means that module's CODE is in it — not merely
 * that an import statement was written. Every one of these is a string literal
 * or an identifier that esbuild cannot rename away.
 */
export const REQUIRED_BUNDLE_MARKERS: ReadonlyArray<{ module: string; marker: string; why: string }> = [
  { module: "scripts/replayParityMirror.ts", marker: MIRROR_FOLD_MARKER, why: "the resumable fold driver" },
  { module: "scripts/browserFoldEntry.ts", marker: BROWSER_FOLD_ENTRY_MARKER, why: "the entry itself" },
  { module: "packages/core/algorithms/spr.ts", marker: "0.3275911", why: "spr.ts's Abramowitz-Stegun erf coefficient — Math.exp lives beside it" },
  { module: "packages/core/algorithms/spr.ts", marker: "scaleMinLr", why: "the league-scoped EWMA floor, so the real update() is present" },
  { module: "packages/core/rankingPoints/marginals.ts", marker: "log1p", why: "the heaviest transcendental path in the RP marginals" },
  { module: "packages/harness/sigmaScoutLayer.ts", marker: "sigmascout", why: "the shipped level-2 layer, exercised by the coldLayer arm" },
  { module: "packages/harness/stateSnapshot.ts", marker: "snapshotShapeVersion", why: "the real state deserializer" },
  { module: "packages/harness/publishedRows.ts", marker: "actualRedBonusRp", why: "the real published-row builder" },
  { module: "packages/core/rankingPoints/2026.ts", marker: "2026", why: "the real season rule module" },
];

export class BundleMarkerError extends Error {
  constructor(readonly missing: readonly string[]) {
    super(`browser bundle is missing ${missing.length} required marker(s): ${missing.join(", ")}`);
    this.name = "BundleMarkerError";
  }
}

/** Throws unless every required marker is present, so an empty or tree-shaken bundle fails BEFORE any engine runs. */
export function assertBundleMarkers(bundle: string, markers: typeof REQUIRED_BUNDLE_MARKERS = REQUIRED_BUNDLE_MARKERS): void {
  const missing = markers.filter((m) => !bundle.includes(m.marker)).map((m) => `${m.module}:${m.marker}`);
  if (missing.length > 0) throw new BundleMarkerError(missing);
}

/**
 * Builds the single IIFE with the repo's own esbuild. Chosen over the dev server
 * and over the app's own lazy chunk for three reasons: this instrument has no
 * network and no server, `about:blank` imposes no CSP or module-resolution
 * problem, and a bundle built from these exact source paths is CHECKABLE.
 */
export function buildBundle(): string {
  mkdirSync(REPORT_DIR, { recursive: true });
  // esbuild's own JS entry, run through THIS Node, rather than the `.bin`
  // shim: `execFileSync` on a Windows `.CMD` fails with EINVAL since Node's
  // shell-injection hardening, and using `shell: true` to work around that
  // would put a shell between this script and its arguments for no benefit.
  const requireHere = createRequire(import.meta.url);
  const esbuild = requireHere.resolve("esbuild/bin/esbuild");
  execFileSync(
    process.execPath,
    [
      esbuild,
      "scripts/browserFoldEntry.ts",
      "--bundle",
      "--format=iife",
      "--platform=browser",
      "--target=es2022",
      `--outfile=${BUNDLE_PATH}`,
    ],
    { stdio: "inherit" }
  );
  const bundle = readFileSync(BUNDLE_PATH, "utf8");
  assertBundleMarkers(bundle);
  return bundle;
}

// ---------------------------------------------------------------------------
// The engines
// ---------------------------------------------------------------------------

export interface EngineArm {
  readonly id: string;
  readonly engine: string;
  readonly ran: boolean;
  /** Present only when `ran` is false: why, in words a reader can act on. */
  readonly notRunReason?: string;
  /** The command that would make this arm runnable. */
  readonly enableCommand?: string;
  readonly version?: string;
  readonly result?: BrowserFoldResult;
}

/**
 * Only the surface this instrument drives. `@playwright/test` is a dependency of
 * `apps/web`, not of the repo root, so it is resolved AT RUNTIME from there
 * rather than imported statically — adding it to the root's dependencies to
 * satisfy a measurement script would change the repo's install graph for
 * something that ships nothing.
 */
interface MinimalPage {
  goto(url: string): Promise<unknown>;
  addScriptTag(options: { content: string }): Promise<unknown>;
  evaluate<R>(fn: (arg: never) => R, arg?: unknown): Promise<R>;
}
interface MinimalBrowser {
  version(): string;
  newPage(): Promise<MinimalPage>;
  close(): Promise<void>;
}
interface MinimalBrowserType {
  launch(): Promise<MinimalBrowser>;
}
interface PlaywrightModule {
  chromium: MinimalBrowserType;
  firefox: MinimalBrowserType;
  webkit: MinimalBrowserType;
}

export class PlaywrightUnavailableError extends Error {
  constructor(cause: string) {
    super(`@playwright/test could not be resolved from apps/web: ${cause}`);
    this.name = "PlaywrightUnavailableError";
  }
}

/** Resolves Playwright from `apps/web`, where it is actually installed. Throws rather than silently running zero browser arms. */
export async function loadPlaywright(): Promise<PlaywrightModule> {
  try {
    const requireFromWeb = createRequire(pathToFileURL(resolve("apps", "web", "package.json")).href);
    const entry = requireFromWeb.resolve("@playwright/test");
    const namespace = (await import(pathToFileURL(entry).href)) as Record<string, unknown>;
    // `@playwright/test` is CommonJS, so `await import()` hands back a namespace
    // whose real exports sit under `default`. Reading `namespace.chromium`
    // directly yields `undefined`, and a naive `.launch()` on it fails with
    // "Cannot read properties of undefined" — which would be reported as three
    // engines NOT RUN when all three are in fact installed. Unwrap, then VERIFY.
    const module = (namespace.chromium !== undefined ? namespace : (namespace.default as Record<string, unknown>)) as unknown as PlaywrightModule;
    const missing = ENGINE_SPECS.filter((spec) => typeof module?.[spec.id]?.launch !== "function").map((spec) => spec.id);
    if (missing.length > 0) {
      throw new PlaywrightUnavailableError(`resolved, but exposes no launchable ${missing.join("/")} — check the package shape, not the browser cache`);
    }
    return module;
  } catch (error) {
    if (error instanceof PlaywrightUnavailableError) throw error;
    throw new PlaywrightUnavailableError((error as Error).message.split("\n")[0] ?? "unknown");
  }
}

/** The three engines, and the exact command that would add an absent one. */
export const ENGINE_SPECS: ReadonlyArray<{ id: "chromium" | "webkit" | "firefox"; engine: string; install: string }> = [
  { id: "chromium", engine: "V8", install: "cd apps/web && npx playwright install chromium" },
  { id: "webkit", engine: "JavaScriptCore", install: "cd apps/web && npx playwright install webkit" },
  { id: "firefox", engine: "SpiderMonkey", install: "cd apps/web && npx playwright install firefox" },
];

/** Runs the bundled fold inside one real browser engine. A launch failure is reported, never swallowed into agreement. */
async function runEngine(
  spec: (typeof ENGINE_SPECS)[number],
  type: MinimalBrowserType,
  bundle: string,
  input: BrowserFoldInput
): Promise<EngineArm> {
  let browser: MinimalBrowser;
  try {
    browser = await type.launch();
  } catch (error) {
    return {
      id: spec.id,
      engine: spec.engine,
      ran: false,
      notRunReason: `launch failed: ${(error as Error).message.split("\n")[0]}`,
      enableCommand: spec.install,
    };
  }
  try {
    const version = browser.version();
    const page = await browser.newPage();
    await page.goto("about:blank");
    await page.addScriptTag({ content: bundle });
    const present = await page.evaluate<boolean>(() => typeof (globalThis as Record<string, unknown>).__replayParityBrowserFold === "function");
    if (!present) {
      return { id: spec.id, engine: spec.engine, ran: false, notRunReason: "the bundle evaluated but exposed no global — it measured nothing", version };
    }
    const result = (await page.evaluate<unknown>(
      (payload: never) => (globalThis as unknown as Record<string, (i: unknown) => unknown>).__replayParityBrowserFold!(payload),
      input as unknown
    )) as BrowserFoldResult;
    return { id: spec.id, engine: spec.engine, ran: true, version, result };
  } catch (error) {
    return {
      id: spec.id,
      engine: spec.engine,
      ran: false,
      notRunReason: `evaluate failed: ${(error as Error).message.split("\n")[0]}`,
      enableCommand: spec.install,
    };
  } finally {
    await browser.close();
  }
}

/**
 * THE HARNESS CONTROL. The SAME IIFE bundle the browsers evaluate, run in a bare
 * `node:vm` context on this Node's own V8.
 *
 * Without it, a disagreement between the Node arm (which runs the TypeScript
 * SOURCE through tsx) and the Chromium arm (which runs the BUNDLE) has two
 * possible causes that cannot be told apart: a real difference between two V8
 * versions' `Math.exp`/`Math.log`, or something esbuild did to the code on the
 * way into the bundle. This arm holds the bundle fixed and varies only the
 * engine, so the two explanations separate cleanly:
 *
 *   node-bundle == node-source  -> the bundle is not the cause; the V8-vs-V8
 *                                  difference is a genuine engine difference.
 *   node-bundle == chromium     -> the BUNDLE is the cause, and the Node-source
 *                                  arm is the odd one out, not Chromium.
 */
export function runBundleInNode(bundle: string, input: BrowserFoldInput): BrowserFoldResult {
  const sandbox: Record<string, unknown> = {};
  const context = createContext(sandbox);
  // The bundle assigns its entry onto `globalThis`; in a vm context that is the
  // sandbox object itself.
  runInContext(bundle, context);
  const fold = sandbox.__replayParityBrowserFold as ((i: BrowserFoldInput) => BrowserFoldResult) | undefined;
  if (typeof fold !== "function") {
    throw new Error("the bundle evaluated in node:vm but exposed no __replayParityBrowserFold — it measured nothing");
  }
  // The input crosses the vm boundary as a structured value; JSON round-tripping
  // it keeps the shape identical to what `page.evaluate` hands a browser arm, so
  // this arm differs from those ONLY in the engine.
  return fold(JSON.parse(JSON.stringify(input)) as BrowserFoldInput);
}

// ---------------------------------------------------------------------------
// The pairwise comparison
// ---------------------------------------------------------------------------

/**
 * Distance in units in the last place between two doubles. Signed magnitudes are
 * mapped to a monotone ordering first, so a pair straddling zero is still a
 * finite ulp distance rather than nonsense.
 */
export function ulpDistance(a: number, b: number): number {
  if (Object.is(a, b)) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  const order = (value: number): bigint => {
    view.setFloat64(0, value);
    const bits = view.getBigInt64(0);
    return bits < 0n ? -9223372036854775808n - bits : bits;
  };
  const distance = order(a) - order(b);
  return Number(distance < 0n ? -distance : distance);
}

export interface PairComparison {
  readonly a: string;
  readonly b: string;
  readonly arm: "resumed" | "coldLayer";
  readonly unroundedIdentical: boolean;
  readonly roundedIdentical: boolean;
  readonly floatsCompared: number;
  readonly differingFloats: number;
  readonly maxUlpDistance: number;
  readonly maxAbsoluteDifference: number;
  /** The index of the first differing float in the canonical sequence; the sequence is emitted match by match, so a low index is an early match. */
  readonly firstDivergingIndex?: number;
}

export function comparePair(aId: string, a: BrowserFoldResult, bId: string, b: BrowserFoldResult, arm: "resumed" | "coldLayer"): PairComparison {
  const left = a[arm];
  const right = b[arm];
  let differingFloats = 0;
  let maxUlpDistance = 0;
  let maxAbsoluteDifference = 0;
  let firstDivergingIndex: number | undefined;
  const length = Math.min(left.unrounded.length, right.unrounded.length);
  for (let i = 0; i < length; i++) {
    const x = left.unrounded[i]!;
    const y = right.unrounded[i]!;
    if (Object.is(x, y)) continue;
    differingFloats++;
    firstDivergingIndex ??= i;
    const ulp = ulpDistance(x, y);
    if (ulp > maxUlpDistance) maxUlpDistance = ulp;
    const absolute = Math.abs(x - y);
    if (Number.isFinite(absolute) && absolute > maxAbsoluteDifference) maxAbsoluteDifference = absolute;
  }
  return {
    a: aId,
    b: bId,
    arm,
    unroundedIdentical: left.unroundedDigest === right.unroundedDigest && left.unrounded.length === right.unrounded.length,
    roundedIdentical: left.roundedDigest === right.roundedDigest,
    floatsCompared: length,
    differingFloats,
    maxUlpDistance,
    maxAbsoluteDifference,
    ...(firstDivergingIndex !== undefined ? { firstDivergingIndex } : {}),
  };
}

/**
 * The smallest margin by which any published value escaped flipping — the number
 * that says whether "rounding absorbed it" is a guarantee or a coincidence.
 * Reported only when the unrounded digests differ but the rounded ones agree.
 */
export function closestRoundingBoundary(values: readonly number[], decimals: number): number {
  let closest = 0.5;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    const shifted = value * 10 ** decimals;
    const headroom = 0.5 - Math.abs(shifted - Math.round(shifted));
    if (headroom < closest) closest = headroom;
  }
  return closest;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Builds the exact input the browser arms receive: a wire state block, the event's matches, and the cold-start facts one event cannot derive. */
export function buildBrowserInput(eventKey: string): BrowserFoldInput {
  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    const harness = armHarness(db, [eventKey]);
    const state = harness.preEventState.get(eventKey);
    const passengers = harness.preEventPassengers.get(eventKey);
    const matches = harness.eventStream.get(eventKey) ?? [];
    if (state === undefined || passengers === undefined) {
      throw new Error(`${eventKey}: no pre-event state captured — is it the corpus's first event of the season?`);
    }
    const rosterKeys = new Set(matches.flatMap((m) => [...m.redTeams, ...m.blueTeams]));
    const block = buildEventStateBlock(passengerRows(state, passengers), rosterKeys);
    // The same wire the parity test sends the block through.
    const wire = EventStateBlockSchema.parse(JSON.parse(JSON.stringify(block)));
    const sortTimeByMatchKey: Record<string, number> = {};
    for (const match of matches) {
      const t = harness.lookups.sortTimeByMatchKey.get(match.matchKey);
      if (t !== undefined) sortTimeByMatchKey[match.matchKey] = t;
    }
    return {
      // `page.evaluate` serializes its argument, so everything here must be
      // plain JSON already — which is exactly what a relay would ship anyway.
      stateRows: wire.rows as StateRow[],
      matches: JSON.parse(JSON.stringify(matches)) as MatchResult[],
      coldStartMatchKeys: matches.filter((m) => harness.coldStartKeys.has(m.matchKey)).map((m) => m.matchKey),
      season: PRICED_SEASON,
      sortTimeByMatchKey,
    };
  } finally {
    db.close();
  }
}

/** A cheap corpus-only variant for the Node arm's own sanity: unused by the browser arms. */
export function corpusColdStartCount(eventKey: string): number {
  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    const index = corpusColdStartIndex(db);
    return buildSeasonStream(db, PRICED_SEASON, { includeOffseason: true }).filter(
      (m) => m.eventKey === eventKey && index.has(m.matchKey)
    ).length;
  } finally {
    db.close();
  }
}

async function main(argv: readonly string[]): Promise<void> {
  const { values } = parseArgs({ args: [...argv], options: { events: { type: "string" } }, allowPositionals: false });
  const eventKey = parseEventsArg(values.events)[0]!;
  console.log(`engine-determinism: event ${eventKey}`);

  console.log("engine-determinism: building the browser bundle with the repo's own esbuild...");
  const bundle = buildBundle();
  console.log(`engine-determinism: bundle is ${bundle.length} bytes; all ${REQUIRED_BUNDLE_MARKERS.length} source-module markers present.`);

  const input = buildBrowserInput(eventKey);
  console.log(`engine-determinism: ${input.matches.length} played matches, ${input.stateRows.length} state rows, ${input.coldStartMatchKeys.length} cold-start matches`);

  const arms: EngineArm[] = [];
  // Node's own V8 is a free control: if it disagrees with Chromium's V8, the
  // harness is wrong, not the engines.
  arms.push({ id: "node-source", engine: "V8 (Node, TS source)", ran: true, version: process.version, result: browserFold(input) });
  // The harness control: same bundle, same engine family, different engine build.
  arms.push({ id: "node-bundle", engine: "V8 (Node, bundle)", ran: true, version: process.version, result: runBundleInNode(bundle, input) });
  let playwright: PlaywrightModule | undefined;
  let playwrightError: string | undefined;
  try {
    playwright = await loadPlaywright();
  } catch (error) {
    playwrightError = (error as Error).message;
  }
  for (const spec of ENGINE_SPECS) {
    if (playwright === undefined) {
      // Every browser arm is reported as NOT RUN with the same reason, one line
      // each, rather than collapsing three missing arms into one silent absence.
      arms.push({ id: spec.id, engine: spec.engine, ran: false, notRunReason: playwrightError ?? "playwright unavailable", enableCommand: spec.install });
      console.log(`engine-determinism: ${spec.id} (${spec.engine})... NOT RUN — ${playwrightError}`);
      continue;
    }
    process.stdout.write(`engine-determinism: ${spec.id} (${spec.engine})... `);
    const arm = await runEngine(spec, playwright[spec.id], bundle, input);
    console.log(arm.ran ? `ran, ${arm.version}` : `NOT RUN — ${arm.notRunReason}`);
    arms.push(arm);
  }

  const ranArms = arms.filter((a) => a.ran && a.result !== undefined);
  const notRun = arms.filter((a) => !a.ran);
  const pairs: PairComparison[] = [];
  for (let i = 0; i < ranArms.length; i++) {
    for (let j = i + 1; j < ranArms.length; j++) {
      for (const arm of ["resumed", "coldLayer"] as const) {
        pairs.push(comparePair(ranArms[i]!.id, ranArms[i]!.result!, ranArms[j]!.id, ranArms[j]!.result!, arm));
      }
    }
  }

  const unroundedAgree = pairs.every((p) => p.unroundedIdentical);
  const roundedAgree = pairs.every((p) => p.roundedIdentical);
  // Distinct JS ENGINES, not distinct arms: the two Node arms and Chromium are
  // all V8, so counting arms would claim four engines where there are three.
  const distinctEngines = new Set(ranArms.map((a) => (a.engine.startsWith("V8") ? "V8" : a.engine))).size;
  const control = pairs.find((p) => p.a === "node-source" && p.b === "node-bundle" && p.arm === "resumed");
  const verdict =
    !roundedAgree
      ? "IT DID NOT WORK — a published number is engine-dependent"
      : distinctEngines < 3
        ? `INCONCLUSIVE — only ${distinctEngines} distinct engine(s) ran`
        : unroundedAgree
          ? "IT WORKED — every pair agrees on both the unrounded and the rounded digest"
          : "INCONCLUSIVE — the unrounded digests differ but rounding absorbed every difference on this event";

  console.log(`\n=== Half B: ${verdict} ===`);
  if (control !== undefined) {
    console.log(
      `  HARNESS CONTROL (same bundle, same Node V8): ${control.unroundedIdentical ? "IDENTICAL" : `DIFFER on ${control.differingFloats} floats`} — ` +
        `${control.unroundedIdentical ? "esbuild's bundling is not a source of difference, so an engine-to-engine difference below is the engines" : "the BUNDLE itself moves numbers; every engine comparison below is confounded"}`
    );
  }
  console.log(`  engines that RAN: ${ranArms.map((a) => `${a.id}(${a.engine})`).join(", ")} — ${distinctEngines} distinct`);
  for (const arm of notRun) {
    console.log(`  NOT RUN: ${arm.id} (${arm.engine}) — ${arm.notRunReason}; to add it: ${arm.enableCommand ?? "n/a"}`);
  }
  for (const pair of pairs) {
    console.log(
      `  ${pair.a} vs ${pair.b} [${pair.arm}]: unrounded ${pair.unroundedIdentical ? "IDENTICAL" : "DIFFER"}, ` +
        `rounded ${pair.roundedIdentical ? "IDENTICAL" : "DIFFER"}` +
        (pair.differingFloats > 0
          ? `, ${pair.differingFloats}/${pair.floatsCompared} floats differ, maxUlp=${pair.maxUlpDistance}, maxAbs=${pair.maxAbsoluteDifference.toExponential(3)}, firstIndex=${pair.firstDivergingIndex}`
          : `, ${pair.floatsCompared} floats compared, all bit-identical`)
    );
  }
  // The margin by which rounding absorbed the engine differences, per rounding
  // class. Applying one class's decimal count to every float in the sequence
  // would quote a margin for `logTau` and `scale`, which have no published digit
  // to flip at all.
  let margins: Record<string, { closestToBoundary: number; values: number; marginOverLargestEngineDifference: number }> | undefined;
  if (!unroundedAgree && roundedAgree && ranArms[0]?.result !== undefined) {
    const largestEngineDifference = Math.max(...pairs.map((p) => p.maxAbsoluteDifference));
    const byRule = ranArms[0].result.resumed.byRule;
    margins = {};
    for (const [rule, decimals] of [
      ["probability", ROUNDING_RULE.probability],
      ["score", ROUNDING_RULE.score],
      ["variance", ROUNDING_RULE.variance],
      ["pmf", ROUNDING_RULE.pmf],
      ["metric", ROUNDING_RULE.metric],
    ] as const) {
      const values = byRule[rule];
      if (values.length === 0) continue;
      const closestToBoundary = closestRoundingBoundary(values, decimals);
      // The boundary distance is in units of the LAST PUBLISHED PLACE; convert it
      // to the value's own units before comparing it to an absolute difference.
      const inValueUnits = closestToBoundary / 10 ** decimals;
      margins[rule] = {
        closestToBoundary,
        values: values.length,
        marginOverLargestEngineDifference: largestEngineDifference === 0 ? Number.POSITIVE_INFINITY : inValueUnits / largestEngineDifference,
      };
    }
    console.log(`  HOW MUCH ROOM ROUNDING HAD (largest engine difference anywhere: ${largestEngineDifference.toExponential(3)}):`);
    for (const [rule, m] of Object.entries(margins)) {
      console.log(
        `    ${rule} (${ROUNDING_RULE[rule as keyof typeof ROUNDING_RULE]} dp, ${m.values} published values): closest came within ` +
          `${m.closestToBoundary.toExponential(3)} of a boundary — ${m.marginOverLargestEngineDifference.toExponential(2)}x the largest engine difference`
      );
    }
  }

  mkdirSync(REPORT_DIR, { recursive: true });
  const path = join(REPORT_DIR, `engine-determinism-${eventKey}.json`);
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        eventKey,
        verdict,
        distinctEngines,
        bundleBytes: bundle.length,
        markers: REQUIRED_BUNDLE_MARKERS,
        matches: input.matches.length,
        stateRows: input.stateRows.length,
        floatsPerArm: ranArms[0]?.result?.resumed.floatCount ?? 0,
        arms: arms.map(({ result, ...rest }) => ({
          ...rest,
          ...(result !== undefined
            ? {
                digests: {
                  resumed: { unrounded: result.resumed.unroundedDigest, rounded: result.resumed.roundedDigest, floatCount: result.resumed.floatCount },
                  coldLayer: { unrounded: result.coldLayer.unroundedDigest, rounded: result.coldLayer.roundedDigest, floatCount: result.coldLayer.floatCount },
                },
                markers: result.markers,
              }
            : {}),
        })),
        pairs,
        harnessControl: control,
        ...(margins !== undefined ? { roundingMargins: margins } : {}),
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  console.log(`engine-determinism: report written to ${path}`);
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  void main(process.argv.slice(2));
}
