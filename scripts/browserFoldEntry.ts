/**
 * THE BROWSER ENTRY for the cross-engine determinism measurement (quick task
 * 260917-mwu, Half B). Measurement scaffolding: nothing ships this, no artifact
 * carries it, and no page imports it.
 *
 * WHAT IT PROVES, AND WHAT IT CANNOT. It runs the REAL modules — this file
 * re-implements nothing. `spr.predict`/`update`/`teamMetrics`, `analyticRpPmf`
 * and the marginals under it, `RpMomentsAccumulator`, `RpMeanShiftAccumulator`,
 * `SigmaScoreAccumulator`, the state readers in `stateSnapshot.ts`, the row
 * builders in `publishedRows.ts`, the real `SigmaScoutLayer` and the real 2026
 * rule module are all imported from source and bundled. Every `Math.exp`,
 * `Math.log` and `Math.log1p` the question is about lives inside those modules;
 * the fold DRIVER contains none.
 *
 * TWO ARMS, because one of them would leave a hole:
 *
 *   `resumed`  the relay's own shape — `MirrorFold.fromRows` over a pre-event
 *              state block, then that event's matches. This is the computation
 *              a relay would actually run in a visitor's browser.
 *   `coldLayer` the REAL `SigmaScoutLayer`, cold-started, over the same matches
 *              from a fresh SPR state. Its numbers are not the published ones
 *              (a cold start is not the publisher's state), and they are not
 *              meant to be: its job is to put the SHIPPED class itself through
 *              every engine, so a cross-engine result can never be dismissed as
 *              a property of the mirror.
 *
 * WHY A DIGEST OF BIT PATTERNS, not of decimals: a decimal rendering would hide
 * exactly the last-bit difference this half exists to find. Every float is
 * hashed as its IEEE-754 bit pattern via `DataView.getBigUint64` over a
 * `Float64Array` view, through an FNV-1a over the canonical sequence. The
 * ROUNDED published-shape rows are digested separately, because "the engines
 * differ" and "the published number differs" are different findings.
 *
 * WHY `about:blank` + `addScriptTag` rather than the dev server or the app's own
 * lazy chunk: the executor has no network and no server; `about:blank` imposes
 * no CSP and no module-resolution problem; and a single IIFE built from these
 * exact source paths is CHECKABLE — `measureEngineDeterminism.ts` asserts the
 * built bundle contains a distinctive marker string from each source module, so
 * a silently empty or tree-shaken bundle fails loudly instead of measuring
 * nothing and reporting agreement.
 *
 * BROWSER-SAFE: no Node built-in, no `packages/corpus`, no `publish.ts`, no
 * `replay.ts`. `measureReplayParity.test.ts` scans this file's import graph.
 */
import { spr, type SprState } from "../packages/core/algorithms/spr.js";
import { applyColdStartTie } from "../packages/core/scoring/coldStart.js";
import { rp2026 } from "../packages/core/rankingPoints/2026.js";
import { SigmaScoutLayer } from "../packages/harness/sigmaScoutLayer.js";
import { actualBonusFlagsForMatch, eventPlayedRow } from "../packages/harness/publishedRows.js";
import { deserializeState, type StateRow } from "../packages/harness/stateSnapshot.js";
import { SIGMA_METRIC_KEY } from "../packages/harness/sigmaScore.js";
import { TOTAL_METRIC_KEY } from "../packages/core/algorithms/types.js";
import type { MatchResult, Prediction } from "../packages/core/algorithms/types.js";
import { MirrorFold, MIRROR_FOLD_MARKER } from "./replayParityMirror.js";

/** The distinctive marker the harness asserts for THIS module. */
export const BROWSER_FOLD_ENTRY_MARKER = "replay-parity-browser-fold-entry-260917-mwu";

export interface BrowserFoldInput {
  /** The wire copy of the pre-event state block's rows. */
  readonly stateRows: StateRow[];
  /** The event's played matches, in stream order, as plain JSON. */
  readonly matches: MatchResult[];
  /** The corpus-global cold-start match keys among them — a fact one event's files cannot derive. */
  readonly coldStartMatchKeys: string[];
  readonly season: number;
  /** `sortTime` per match key, for the published row shape. */
  readonly sortTimeByMatchKey: Record<string, number>;
}

export interface ArmDigest {
  /** FNV-1a over every unrounded float's IEEE-754 bit pattern, in canonical order, as a hex string. */
  readonly unroundedDigest: string;
  /** The same hash over `JSON.stringify` of the rounded published-shape rows. */
  readonly roundedDigest: string;
  /** How many floats went into the unrounded digest — a bundle that measured nothing would report 0. */
  readonly floatCount: number;
  /** The unrounded sequence itself, for the pairwise ulp report. Kept because one event is small. */
  readonly unrounded: number[];
  /** The rounded rows, so a rounded-digest mismatch can be localised to a field. */
  readonly rounded: unknown[];
  /**
   * The unrounded values that ACTUALLY reach a published field, split by which
   * `ROUNDING_RULE` class they publish under. Without this split the
   * "how close did anything come to flipping?" margin would have to apply one
   * rule's decimal count to every float in the sequence — including `logTau`,
   * `scale` and the raw filter state, which are never published at all — and
   * would report a margin for a number that has no published digit to flip.
   */
  readonly byRule: { probability: number[]; score: number[]; variance: number[]; pmf: number[]; metric: number[] };
}

/** Collects unrounded values under the rounding class each one publishes at. */
interface RuleBuckets {
  probability: number[];
  score: number[];
  variance: number[];
  pmf: number[];
  metric: number[];
}

function emptyBuckets(): RuleBuckets {
  return { probability: [], score: [], variance: [], pmf: [], metric: [] };
}

function bucketPrediction(buckets: RuleBuckets, prediction: Prediction): void {
  const p = prediction as unknown as Record<string, unknown>;
  buckets.probability.push(prediction.pRedWin);
  buckets.score.push(prediction.redScore, prediction.blueScore);
  for (const key of ["variance", "redScoreVarianceOwn", "blueScoreVarianceOwn"]) {
    const value = p[key];
    if (typeof value === "number") buckets.variance.push(value);
  }
  for (const key of ["redRpPmf", "blueRpPmf", "matchOutcomePmf", "redBonusRpPmf", "blueBonusRpPmf"]) {
    const value = p[key];
    if (Array.isArray(value)) buckets.pmf.push(...(value as number[]));
  }
  // Per-bonus marginals are independent probabilities, so they publish at the
  // PROBABILITY rule rather than through `roundPmf` — the same split
  // `publishedRows.ts` makes.
  for (const key of ["redBonusRp", "blueBonusRp"]) {
    const value = p[key];
    if (Array.isArray(value)) buckets.probability.push(...(value as number[]));
  }
}

export interface BrowserFoldResult {
  readonly resumed: ArmDigest;
  readonly coldLayer: ArmDigest;
  /** Echoed so a harness cannot mistake a stale bundle for a fresh one. */
  readonly markers: { mirror: string; entry: string; sprVersion: string; ruleSeason: number };
}

// ---------------------------------------------------------------------------
// The lossless digest
// ---------------------------------------------------------------------------

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/** One double's exact IEEE-754 bits. A decimal rendering here would defeat the whole measurement. */
export function bitsOf(value: number): bigint {
  const buffer = new ArrayBuffer(8);
  new Float64Array(buffer)[0] = value;
  return new DataView(buffer).getBigUint64(0, true);
}

/** FNV-1a over the bit patterns, byte by byte, so the hash depends on every bit rather than on a rendering. */
export function digestFloats(values: readonly number[]): string {
  let hash = FNV_OFFSET;
  for (const value of values) {
    let bits = bitsOf(value);
    for (let i = 0; i < 8; i++) {
      hash = ((hash ^ (bits & 0xffn)) * FNV_PRIME) & MASK64;
      bits >>= 8n;
    }
  }
  return hash.toString(16).padStart(16, "0");
}

/** The same hash over a string's UTF-16 code units, for the rounded published rows. */
export function digestString(text: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    hash = ((hash ^ BigInt(code & 0xff)) * FNV_PRIME) & MASK64;
    hash = ((hash ^ BigInt((code >> 8) & 0xff)) * FNV_PRIME) & MASK64;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Pushes every float a `Prediction` carries, in a fixed order, so two engines' sequences are comparable positionally. */
function pushPrediction(out: number[], prediction: Prediction): void {
  out.push(prediction.pRedWin, prediction.redScore, prediction.blueScore);
  for (const key of ["variance", "redScoreVarianceOwn", "blueScoreVarianceOwn"] as const) {
    const value = (prediction as unknown as Record<string, number | undefined>)[key];
    // A fixed sentinel for an absent field, so an absent value and a real 0 do
    // not hash identically and a shape change is visible as a digest change.
    out.push(value ?? Number.NEGATIVE_INFINITY);
  }
  for (const key of [
    "redRpPmf",
    "blueRpPmf",
    "matchOutcomePmf",
    "redBonusRpPmf",
    "blueBonusRpPmf",
    "redBonusRp",
    "blueBonusRp",
    "redOutcomeRp",
    "blueOutcomeRp",
  ] as const) {
    const array = (prediction as unknown as Record<string, number[] | undefined>)[key];
    if (array === undefined) {
      out.push(Number.NEGATIVE_INFINITY);
      continue;
    }
    out.push(array.length);
    for (const entry of array) out.push(entry);
  }
}

/** Pushes the league-scoped scalars and the involved teams' filter state — where a compounding difference would show first. */
function pushState(out: number[], state: SprState, teamKeys: readonly string[]): void {
  out.push(state.logTau, state.scale, state.scaleCount);
  for (const teamKey of [...teamKeys].sort()) {
    const team = state.teams.get(teamKey);
    if (team === undefined) {
      out.push(Number.NEGATIVE_INFINITY);
      continue;
    }
    out.push(team.muL, team.pL, team.muS, team.pS);
  }
}

// ---------------------------------------------------------------------------
// The two arms
// ---------------------------------------------------------------------------

/** ARM `resumed`: the relay's own shape — a block, then one event's matches. */
function runResumed(input: BrowserFoldInput): ArmDigest {
  const rows: readonly StateRow[] = input.stateRows;
  const mirror = MirrorFold.fromRows(rp2026, spr.id, rows);
  let live = deserializeState(spr.id, rows) as SprState;
  const coldStart = new Set(input.coldStartMatchKeys);
  const unrounded: number[] = [];
  const rounded: unknown[] = [];
  const buckets = emptyBuckets();

  for (const match of input.matches) {
    const involved = [...match.redTeams, ...match.blueTeams];
    pushState(unrounded, live, involved);
    const raw = spr.predict(live, match);
    // The REAL `applyColdStartTie`, imported from `packages/core/scoring/coldStart.ts`
    // rather than restated here. That module has no imports of its own, so it
    // bundles for a browser; `replay.ts`, which re-exports the surrounding
    // machinery, is Node-bound and deliberately not pulled in.
    const prediction: Prediction = coldStart.has(match.matchKey) ? applyColdStartTie(raw) : raw;
    pushPrediction(unrounded, prediction);
    const folded = mirror.foldPlayed(match, prediction);
    unrounded.push(folded.redWinOddsVariance ?? Number.NEGATIVE_INFINITY, folded.blueWinOddsVariance ?? Number.NEGATIVE_INFINITY);
    pushPrediction(unrounded, folded.record.prediction);
    bucketPrediction(buckets, folded.record.prediction);
    unrounded.push(folded.record.matchBand?.red ?? Number.NEGATIVE_INFINITY, folded.record.matchBand?.blue ?? Number.NEGATIVE_INFINITY);
    if (folded.record.matchBand?.red !== undefined) buckets.variance.push(folded.record.matchBand.red);
    if (folded.record.matchBand?.blue !== undefined) buckets.variance.push(folded.record.matchBand.blue);

    const next = spr.update(live, match);
    const metrics = spr.teamMetrics(next, involved) as Record<string, Record<string, { value: number; spread?: number }>>;
    const talent = new Map<string, number>();
    for (const teamKey of involved) {
      const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
      if (total !== undefined) talent.set(teamKey, total);
    }
    mirror.observeTalent(talent);
    for (const teamKey of [...new Set(involved)].sort()) {
      const record = metrics[teamKey] ?? {};
      for (const metricKey of Object.keys(record).sort()) {
        unrounded.push(record[metricKey]!.value, record[metricKey]!.spread ?? Number.NEGATIVE_INFINITY);
        buckets.metric.push(record[metricKey]!.value);
        if (record[metricKey]!.spread !== undefined) buckets.metric.push(record[metricKey]!.spread!);
      }
      const sigmaValue = mirror.sigmaFor(teamKey);
      unrounded.push(sigmaValue ?? Number.NEGATIVE_INFINITY);
      if (sigmaValue !== undefined) buckets.metric.push(sigmaValue);
    }
    rounded.push(
      eventPlayedRow(
        { ...folded.record, match, ...(coldStart.has(match.matchKey) ? { coldStart: true as const } : {}) } as never,
        {
          sortTime: input.sortTimeByMatchKey[match.matchKey],
          video: undefined,
          actualBonusFlags: actualBonusFlagsForMatch(match, rp2026),
        }
      )
    );
    live = next;
  }

  return {
    unroundedDigest: digestFloats(unrounded),
    roundedDigest: digestString(JSON.stringify(rounded)),
    floatCount: unrounded.length,
    unrounded,
    rounded,
    byRule: buckets,
  };
}

/** ARM `coldLayer`: the SHIPPED `SigmaScoutLayer`, cold, over the same matches. Its job is to put the real class through every engine. */
function runColdLayer(input: BrowserFoldInput): ArmDigest {
  const teamKeys = [...new Set(input.matches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
  const layer = new SigmaScoutLayer(rp2026, spr.id);
  let live = spr.initState(teamKeys);
  const unrounded: number[] = [];
  const rounded: unknown[] = [];
  const buckets = emptyBuckets();

  for (const match of input.matches) {
    const involved = [...match.redTeams, ...match.blueTeams];
    pushState(unrounded, live, involved);
    const prediction = spr.predict(live, match);
    pushPrediction(unrounded, prediction);
    const next = spr.update(live, match);
    const metrics = spr.teamMetrics(next, involved) as Record<string, Record<string, { value: number; spread?: number }>>;
    const talent = new Map<string, number>();
    for (const teamKey of involved) {
      const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
      if (total !== undefined) talent.set(teamKey, total);
    }
    const record = layer.foldPlayed(match, prediction, talent);
    pushPrediction(unrounded, record.prediction);
    bucketPrediction(buckets, record.prediction);
    unrounded.push(record.matchBand?.red ?? Number.NEGATIVE_INFINITY, record.matchBand?.blue ?? Number.NEGATIVE_INFINITY);
    if (record.matchBand?.red !== undefined) buckets.variance.push(record.matchBand.red);
    if (record.matchBand?.blue !== undefined) buckets.variance.push(record.matchBand.blue);
    for (const teamKey of [...new Set(involved)].sort()) {
      const m = metrics[teamKey] ?? {};
      for (const metricKey of Object.keys(m).sort()) {
        unrounded.push(m[metricKey]!.value, m[metricKey]!.spread ?? Number.NEGATIVE_INFINITY);
        buckets.metric.push(m[metricKey]!.value);
        if (m[metricKey]!.spread !== undefined) buckets.metric.push(m[metricKey]!.spread!);
      }
      const sigmaValue = layer.sigmaFor(teamKey);
      unrounded.push(sigmaValue ?? Number.NEGATIVE_INFINITY);
      if (sigmaValue !== undefined) buckets.metric.push(sigmaValue);
    }
    rounded.push(
      eventPlayedRow({ ...record, match } as never, {
        sortTime: input.sortTimeByMatchKey[match.matchKey],
        video: undefined,
        actualBonusFlags: actualBonusFlagsForMatch(match, rp2026),
      })
    );
    live = next;
  }

  return {
    unroundedDigest: digestFloats(unrounded),
    roundedDigest: digestString(JSON.stringify(rounded)),
    floatCount: unrounded.length,
    unrounded,
    rounded,
    byRule: buckets,
  };
}

export function browserFold(input: BrowserFoldInput): BrowserFoldResult {
  // The corpus hands `redTeams`/`blueTeams` as arrays and `teams` as a Map;
  // JSON gives arrays back as arrays, which is all `spr` reads.
  return {
    resumed: runResumed(input),
    coldLayer: runColdLayer(input),
    markers: { mirror: MIRROR_FOLD_MARKER, entry: BROWSER_FOLD_ENTRY_MARKER, sprVersion: spr.version, ruleSeason: rp2026.season },
  };
}

// The IIFE bundle's single global. `page.evaluate` reaches it by this name, and
// its absence is how the harness detects a bundle that did not evaluate.
(globalThis as unknown as Record<string, unknown>).__replayParityBrowserFold = browserFold;
(globalThis as unknown as Record<string, unknown>).__replayParitySigmaMetricKey = SIGMA_METRIC_KEY;
