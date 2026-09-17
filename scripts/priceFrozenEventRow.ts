/**
 * OFFLINE PRICING INSTRUMENT for the frozen-metrics event row (quick task
 * 260917-1zs). It measures and reports; it publishes nothing.
 *
 * The question: if the event artifact carried, per played match, the six
 * teams' frozen metrics as of that match, and the team-season artifact shrank
 * to a small per-robot index, what would that cost in bytes — per event,
 * across the bucket, and on the robot page's wire?
 *
 * How it sees real artifact bodies WITHOUT a network fetch: it runs the real
 * publisher (`publishSeasons`) against the local corpus with `dryRun: true`,
 * and reads every body through `publish.ts`'s inert `artifactSink`. Dry-run
 * short-circuits before any `putObject`, so no request is ever signed and no
 * object is ever written.
 *
 * SAFETY, by construction rather than by care:
 * - no import of `packages/harness/r2Client.ts`, no S3/signing SDK, no `fetch`
 *   (`priceFrozenEventRow.test.ts` scans this file's own imports and source);
 * - no environment variable is read, so it needs no `.env` and must never be
 *   invoked through `--env-file`; no secret can reach a log line;
 * - `skipState: true`, so no `reports/publish/seed-*.sql` is written;
 * - `--write-budget` is never passed, so `docs/publish-budget.md` is untouched;
 * - the generation string is a fixed non-UUID marker that could not be mistaken
 *   for a real generation if it somehow escaped.
 *
 * Output: a machine-readable JSON report under `reports/frozen-row-pricing/`
 * (gitignored) plus a console table. Every pure function below — the encoders,
 * the positional decode, the index builder, `sizeOf` — is exported and tested;
 * the CLI at the bottom is a thin shell.
 *
 * USAGE (no `.env`, no network):
 *   npx tsx scripts/priceFrozenEventRow.ts --arm a --events 2016micmp --variants A
 *   npx tsx scripts/priceFrozenEventRow.ts --arm a
 *   npx tsx scripts/priceFrozenEventRow.ts --arm b
 */
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import { publishSeasons, resolvePublishAlgorithms } from "../packages/harness/publish.js";
import { EventArtifactSchema, type PageKind } from "../packages/harness/pageArtifacts.js";
import { SIGMA_METRIC_KEY } from "../packages/harness/sigmaScore.js";
import { TOTAL_METRIC_KEY } from "../packages/core/algorithms/types.js";

// ---------------------------------------------------------------------------
// The metric record shape being priced
// ---------------------------------------------------------------------------

/**
 * Exactly what `MetricHistoryRowSchema.metrics` carries per key: `value`,
 * optional `spread`, optional `percentile`. For SPR the record ALSO carries a
 * `sigma` entry which is `{ value }` only — no `spread`, no `percentile` —
 * confirmed against `packages/harness/metricHistorySchema.ts`. Sigma is
 * therefore just another key in this record, not a parallel field.
 */
export interface FrozenMetricValue {
  value: number;
  spread?: number;
  percentile?: number;
}

export type FrozenMetricsRecord = Record<string, FrozenMetricValue>;

/** How a variant treats `percentile`: on every row, or only on a team's LAST row at the event (bar variant D). */
export type PercentileMode = "every" | "last";

export interface FrozenEncodeOptions {
  /** `false` strips the `sigma` entry, so its contribution is visible rather than buried. */
  readonly sigma: boolean;
  readonly percentile: PercentileMode;
  /**
   * When present, only these metric keys travel — the NARROWER frozen sets a
   * NO-GO verdict has to name rather than guess at. `sigma` is still gated by
   * `sigma` above, so a filter that includes it can still be measured without it.
   */
  readonly metricKeys?: readonly string[];
  /**
   * `"last"` carries only each team's END-OF-EVENT row instead of its whole
   * per-match series — the other narrowing available, and the one that costs
   * the Metric History chart and `preMatchMetrics` their inputs.
   */
  readonly rows?: "all" | "last";
  /**
   * `false` drops `spread` from every entry. The audit's finding 3 established
   * that NOTHING in `apps/web` reads `spread` off a history row — `MetricValue`
   * refuses to render it and `MetricHistoryChart` bands from `sigma` — so this
   * is the one narrowing that costs the site nothing it currently shows.
   */
  readonly spread?: boolean;
}

/** One team's frozen metrics at one played match. */
export interface FrozenCell {
  readonly matchKey: string;
  readonly teamKey: string;
  readonly metrics: FrozenMetricsRecord;
}

/** Everything an encoder needs about one event, assembled from the real published bodies. */
export interface FrozenEventInput {
  /** Played match keys in the event artifact's own `matches[]` order. */
  readonly matchKeys: readonly string[];
  /** The six (or however many) team keys on each played match, in `[...redTeams, ...blueTeams]` order. */
  readonly rosterByMatch: ReadonlyMap<string, readonly string[]>;
  /** `${matchKey}::${teamKey}` -> that team's AFTER-match metrics. */
  readonly cells: ReadonlyMap<string, FrozenMetricsRecord>;
  /** Team keys in the artifact's own `teams[]` order. */
  readonly teamKeys: readonly string[];
  /**
   * Per team, its metrics AS OF ARRIVAL at this event — the history row
   * preceding its first row here, which for a team's first event of the season
   * is deliberately ABSENT (see the audit's finding 5: an entry snapshot
   * present there would print a pre-match figure where the site prints an
   * honest absence today).
   */
  readonly entryByTeam: ReadonlyMap<string, FrozenMetricsRecord>;
}

const cellKey = (matchKey: string, teamKey: string): string => `${matchKey}::${teamKey}`;

/** `cellKey`'s inverse halves, exported so a caller can build a `cells` map without re-deriving the separator. */
export function frozenCellKey(matchKey: string, teamKey: string): string {
  return cellKey(matchKey, teamKey);
}

/**
 * Applies one variant's options to one record: strips `sigma` when
 * `options.sigma` is false, and strips `percentile` when this is not the
 * team's last row at the event under `percentile: "last"`. Never mutates.
 */
export function applyEncodeOptions(metrics: FrozenMetricsRecord, options: FrozenEncodeOptions, isLastRowForTeam: boolean): FrozenMetricsRecord {
  const keepPercentile = options.percentile === "every" || isLastRowForTeam;
  const out: FrozenMetricsRecord = {};
  for (const [key, entry] of Object.entries(metrics)) {
    if (key === SIGMA_METRIC_KEY && !options.sigma) continue;
    if (options.metricKeys !== undefined && !options.metricKeys.includes(key)) continue;
    out[key] = {
      value: entry.value,
      ...(entry.spread !== undefined && options.spread !== false ? { spread: entry.spread } : {}),
      ...(entry.percentile !== undefined && keepPercentile ? { percentile: entry.percentile } : {}),
    };
  }
  return out;
}

/** The index of each team's LAST played row at this event, so variant D knows which row keeps `percentile`. */
function lastRowIndexByTeam(input: FrozenEventInput): Map<string, number> {
  const last = new Map<string, number>();
  input.matchKeys.forEach((matchKey, index) => {
    for (const teamKey of input.rosterByMatch.get(matchKey) ?? []) {
      if (input.cells.has(cellKey(matchKey, teamKey))) last.set(teamKey, index);
    }
  });
  return last;
}

// ---------------------------------------------------------------------------
// Variant A — metrics embedded per played row, keyed by team key
// ---------------------------------------------------------------------------

/** `matchKey -> { [teamKey]: record }`, index-aligned to the event artifact's played `matches[]`. */
export type VariantAPerMatch = Record<string, FrozenMetricsRecord>;

export interface VariantAOutput {
  /** One entry per played match, in `matches[]` order; the value is attached to that row as `teamMetrics`. */
  readonly perMatch: readonly VariantAPerMatch[];
  /** One entry per `teams[]` row, in order; `undefined` where the team has no entry snapshot. */
  readonly entry: readonly (FrozenMetricsRecord | undefined)[];
}

/** Variant A: one object per played row, keyed by team key. Team keys and metric keys both repeat per row. */
export function encodeVariantA(input: FrozenEventInput, options: FrozenEncodeOptions): VariantAOutput {
  const lastIndex = lastRowIndexByTeam(input);
  const perMatch = input.matchKeys.map((matchKey, index) => {
    const out: VariantAPerMatch = {};
    for (const teamKey of input.rosterByMatch.get(matchKey) ?? []) {
      const metrics = input.cells.get(cellKey(matchKey, teamKey));
      if (metrics === undefined) continue;
      const isLast = lastIndex.get(teamKey) === index;
      if (options.rows === "last" && !isLast) continue;
      out[teamKey] = applyEncodeOptions(metrics, options, isLast);
    }
    return out;
  });
  return { perMatch, entry: encodeEntrySnapshots(input, options) };
}

/** The per-team entry snapshots, shared by every variant (they differ in how the TIMELINE is laid out, not in this). */
function encodeEntrySnapshots(input: FrozenEventInput, options: FrozenEncodeOptions): (FrozenMetricsRecord | undefined)[] {
  return input.teamKeys.map((teamKey) => {
    const metrics = input.entryByTeam.get(teamKey);
    // An entry snapshot is a single as-of-arrival record, never a team's "last
    // row at this event", so variant D's last-row rule does not apply to it.
    return metrics === undefined ? undefined : applyEncodeOptions(metrics, options, true);
  });
}

// ---------------------------------------------------------------------------
// Variant B — a per-team timeline in `teams[]`, team key stated once
// ---------------------------------------------------------------------------

export interface VariantBTimelineEntry {
  readonly matchKey: string;
  readonly metrics: FrozenMetricsRecord;
}

export interface VariantBOutput {
  /** One timeline per `teams[]` row, in order. */
  readonly timelines: readonly (readonly VariantBTimelineEntry[])[];
  readonly entry: readonly (FrozenMetricsRecord | undefined)[];
}

/**
 * Variant B: the same information as A, laid out per team instead of per
 * match. The team key is stated once (it is the `teams[]` row's own
 * `teamKey`); the match key is still stated per entry, because the set of
 * matches differs per team.
 */
export function encodeVariantB(input: FrozenEventInput, options: FrozenEncodeOptions): VariantBOutput {
  const lastIndex = lastRowIndexByTeam(input);
  const byTeam = new Map<string, VariantBTimelineEntry[]>();
  input.matchKeys.forEach((matchKey, index) => {
    for (const teamKey of input.rosterByMatch.get(matchKey) ?? []) {
      const metrics = input.cells.get(cellKey(matchKey, teamKey));
      if (metrics === undefined) continue;
      const isLast = lastIndex.get(teamKey) === index;
      // `rows: "last"` keeps only the end-of-event row — the narrowing that
      // preserves `endOfEventMetrics`/`officialSnapshot` and costs the Metric
      // History chart and `preMatchMetrics` their per-match inputs.
      if (options.rows === "last" && !isLast) continue;
      const list = byTeam.get(teamKey) ?? [];
      list.push({ matchKey, metrics: applyEncodeOptions(metrics, options, isLast) });
      byTeam.set(teamKey, list);
    }
  });
  return { timelines: input.teamKeys.map((teamKey) => byTeam.get(teamKey) ?? []), entry: encodeEntrySnapshots(input, options) };
}

// ---------------------------------------------------------------------------
// Variant C — the positional encoding, metric keys stated once per artifact
// ---------------------------------------------------------------------------

/**
 * One metric's positional slot, mirroring `pageArtifacts.ts`'s
 * `PositionalMetricEntrySchema` but with `percentile` in the third position
 * where the teams row carries `tier` (a history row publishes a percentile,
 * never a tier — see `metricHistorySchema.ts`).
 *
 * - `null` — the key is absent from this row's record entirely.
 * - `[value]` — present, no `spread`, no `percentile`.
 * - `[value, spread]` — present with a real `spread` (a genuine `0` included).
 * - `[value, spread | null, percentile]` — `null` in the middle carries
 *   "percentile present, spread absent" unambiguously, because `null` and a
 *   real `0` are never the same JSON value.
 */
export type PositionalFrozenEntry = null | [number] | [number, number] | [number, number | null, number];

/** Encodes one metric into its positional slot; `undefined` (key absent) becomes `null`. */
export function encodePositionalEntry(metric: FrozenMetricValue | undefined): PositionalFrozenEntry {
  if (metric === undefined) return null;
  if (metric.percentile !== undefined) return [metric.value, metric.spread ?? null, metric.percentile];
  if (metric.spread !== undefined) return [metric.value, metric.spread];
  return [metric.value];
}

/** The exact inverse of `encodePositionalEntry`. */
export function decodePositionalEntry(entry: PositionalFrozenEntry): FrozenMetricValue | undefined {
  if (entry === null) return undefined;
  if (entry.length === 1) return { value: entry[0] };
  if (entry.length === 2) return { value: entry[0], spread: entry[1] };
  const [value, spread, percentile] = entry;
  return { value, ...(spread !== null ? { spread } : {}), percentile };
}

/** Encodes a whole record into the positional array aligned to `metricKeys`. */
export function encodePositionalRecord(metrics: FrozenMetricsRecord, metricKeys: readonly string[]): PositionalFrozenEntry[] {
  return metricKeys.map((key) => encodePositionalEntry(metrics[key]));
}

/** The exact inverse of `encodePositionalRecord`: a slot decoding to `undefined` is omitted, never written as an `undefined` value. */
export function decodePositionalRecord(entries: readonly PositionalFrozenEntry[], metricKeys: readonly string[]): FrozenMetricsRecord {
  const out: FrozenMetricsRecord = {};
  metricKeys.forEach((key, index) => {
    const decoded = decodePositionalEntry(entries[index] ?? null);
    if (decoded !== undefined) out[key] = decoded;
  });
  return out;
}

/** The ordered metric-key union across records, first-seen order — the same derivation `deriveMetricKeyOrder` makes for the teams artifact. */
export function deriveFrozenMetricKeys(records: readonly FrozenMetricsRecord[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key);
        ordered.push(key);
      }
    }
  }
  return ordered;
}

export interface VariantCTimeline {
  /** This team's played match keys at this event, in order. */
  readonly m: readonly string[];
  /** Index-aligned to `m`: one positional record per match. */
  readonly v: readonly PositionalFrozenEntry[][];
}

export interface VariantCOutput {
  readonly metricKeys: readonly string[];
  readonly timelines: readonly VariantCTimeline[];
  readonly entry: readonly (PositionalFrozenEntry[] | undefined)[];
}

/** Variant C: variant B's layout with the metric keys hoisted to one per-artifact header and every record positional. */
export function encodeVariantC(input: FrozenEventInput, options: FrozenEncodeOptions): VariantCOutput {
  const b = encodeVariantB(input, options);
  const allRecords: FrozenMetricsRecord[] = [];
  for (const timeline of b.timelines) for (const entry of timeline) allRecords.push(entry.metrics);
  for (const record of b.entry) if (record !== undefined) allRecords.push(record);
  const metricKeys = deriveFrozenMetricKeys(allRecords);
  return {
    metricKeys,
    timelines: b.timelines.map((timeline) => ({
      m: timeline.map((entry) => entry.matchKey),
      v: timeline.map((entry) => encodePositionalRecord(entry.metrics, metricKeys)),
    })),
    entry: b.entry.map((record) => (record === undefined ? undefined : encodePositionalRecord(record, metricKeys))),
  };
}

// ---------------------------------------------------------------------------
// Attaching a variant to a real event artifact, and sizing the result
// ---------------------------------------------------------------------------

export type VariantName = "A" | "B" | "C";

/** A variant's full identity: its layout, whether `sigma` travels, and how `percentile` is carried. */
export interface PricedVariant {
  readonly name: string;
  readonly layout: VariantName;
  readonly options: FrozenEncodeOptions;
}

/**
 * The published `total` key and the Sigma Score — the narrowest set that still
 * renders the Total ± Sigma pill the site shows today wherever a frozen row is
 * read. `TOTAL_METRIC_KEY` is imported rather than spelled, so a rename cannot
 * make this filter silently match nothing.
 */
const TOTAL_AND_SIGMA_KEYS: readonly string[] = [TOTAL_METRIC_KEY, SIGMA_METRIC_KEY];

/**
 * The 12 bar variants (three layouts x percentile-every/last x sigma on/off),
 * plus the two NARROWER frozen sets a NO-GO has to be able to name with a
 * measured number rather than a guess. Both narrower sets are built on the
 * cheapest bar layout, so they isolate the narrowing rather than the encoding.
 */
export function pricedVariants(): PricedVariant[] {
  const out: PricedVariant[] = [];
  for (const layout of ["A", "B", "C"] as const) {
    for (const percentile of ["every", "last"] as const) {
      for (const sigma of [true, false] as const) {
        const base = percentile === "every" ? layout : `D-${layout}`;
        out.push({ name: sigma ? base : `${base}/no-sigma`, layout, options: { sigma, percentile } });
      }
    }
  }
  out.push({ name: "N0-no-spread", layout: "C", options: { sigma: true, percentile: "last", spread: false } });
  out.push({ name: "N1-total+sigma", layout: "C", options: { sigma: true, percentile: "last", metricKeys: TOTAL_AND_SIGMA_KEYS } });
  out.push({ name: "N1b-total+sigma-no-spread", layout: "C", options: { sigma: true, percentile: "last", metricKeys: TOTAL_AND_SIGMA_KEYS, spread: false } });
  out.push({ name: "N2-end-of-event", layout: "C", options: { sigma: true, percentile: "last", rows: "last" } });
  return out;
}

/** A parsed event artifact body, kept as a loose record because this instrument only ADDS keys to it. */
type LooseArtifact = Record<string, unknown> & { matches?: unknown[]; teams?: unknown[] };

/**
 * Attaches one variant's output to a CLONE of the real artifact and returns
 * the serialized body. The clone is shallow-per-row (rows are spread into new
 * objects), so the caller's parsed artifact is never mutated and can be reused
 * across all 12 variants.
 */
export function attachVariant(artifact: LooseArtifact, input: FrozenEventInput, variant: PricedVariant): string {
  const matches = (artifact.matches ?? []) as Record<string, unknown>[];
  const teams = (artifact.teams ?? []) as Record<string, unknown>[];
  if (variant.layout === "A") {
    const encoded = encodeVariantA(input, variant.options);
    return JSON.stringify({
      ...artifact,
      matches: matches.map((row, index) => ({ ...row, teamMetrics: encoded.perMatch[index] ?? {} })),
      teams: teams.map((row, index) => (encoded.entry[index] === undefined ? row : { ...row, entryMetrics: encoded.entry[index] })),
    });
  }
  if (variant.layout === "B") {
    const encoded = encodeVariantB(input, variant.options);
    return JSON.stringify({
      ...artifact,
      teams: teams.map((row, index) => ({
        ...row,
        history: encoded.timelines[index] ?? [],
        ...(encoded.entry[index] === undefined ? {} : { entryMetrics: encoded.entry[index] }),
      })),
    });
  }
  const encoded = encodeVariantC(input, variant.options);
  return JSON.stringify({
    ...artifact,
    metricKeys: encoded.metricKeys,
    teams: teams.map((row, index) => ({
      ...row,
      history: encoded.timelines[index] ?? { m: [], v: [] },
      ...(encoded.entry[index] === undefined ? {} : { entryMetrics: encoded.entry[index] }),
    })),
  });
}

export interface SizeMeasurement {
  readonly raw: number;
  readonly brotli: number;
}

/** Raw UTF-8 bytes and brotli bytes at a stated quality for the same body. */
export function sizeOf(body: string, quality: number): SizeMeasurement {
  const buf = Buffer.from(body, "utf8");
  const brotli = brotliCompressSync(buf, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: quality, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: buf.length },
  });
  return { raw: buf.length, brotli: brotli.length };
}

/** Raw UTF-8 bytes only — used where brotli would cost more than the answer is worth (the whole-population raw sweep). */
export function rawBytes(body: string): number {
  return Buffer.byteLength(body, "utf8");
}

// ---------------------------------------------------------------------------
// The per-robot index
// ---------------------------------------------------------------------------

/**
 * The proposed per-robot index body: the team-season artifact with
 * `metricHistory` dropped entirely and each event reduced to its identity and
 * standing — no `matches[]`. Every remaining field is carried through
 * verbatim, including `seasonStats` (with `metricsBasis`), `ranks`,
 * `activeYears` and `robotImageUrl`, because the audit dispositioned all of
 * them INDEX.
 *
 * `eventKey` order is preserved, which is what makes the index able to name
 * the robot's event files for a parallel fetch AND to reconstruct the
 * season-chronological order of the frozen rows.
 */
export function buildRobotIndexBody(teamArtifact: Record<string, unknown>): string {
  const { metricHistory: _dropped, events, ...rest } = teamArtifact as Record<string, unknown> & { events?: unknown[] };
  void _dropped;
  const indexEvents = ((events ?? []) as Record<string, unknown>[]).map((event) => {
    const { matches: _matches, ...eventRest } = event;
    void _matches;
    return eventRest;
  });
  return JSON.stringify({ ...rest, events: indexEvents });
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

export function percentileOfSorted(sortedAscending: readonly number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  const idx = Math.min(sortedAscending.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAscending.length) - 1));
  return sortedAscending[idx]!;
}

// ---------------------------------------------------------------------------
// The storage extrapolation
// ---------------------------------------------------------------------------

export interface StorageExtrapolationInput {
  /** Played match rows in the corpus for the seasons the EARLY arm's rate is applied to (2016-2020). */
  readonly earlyRows: number;
  /** Played match rows for the seasons the LATE arm's rate is applied to (2022-2026). */
  readonly lateRows: number;
  /** Added bytes per played match row measured by the early arm (2016). */
  readonly earlyRate: number;
  /** Added bytes per played match row measured by the late arm (2026). */
  readonly lateRate: number;
  /** Published algorithms, each of which gets its own event object carrying the same played rows. */
  readonly algorithmCount: number;
  /** Published `team` object count. */
  readonly teamObjects: number;
  /** Bytes a single team object loses by shrinking to an index. */
  readonly freedPerTeamObject: number;
}

export interface StorageExtrapolation {
  /** The arithmetic's own inputs, echoed so the figure is never quotable without them. */
  readonly inputs: StorageExtrapolationInput;
  /** Every priced row at the EARLY rate — the optimistic bound. */
  readonly addedBytesLow: number;
  /** Every priced row at the LATE rate — the pessimistic bound. */
  readonly addedBytesHigh: number;
  /** The early rate for 2016-2020 rows and the late rate for 2022-2026 rows — the central estimate. */
  readonly addedBytesSplit: number;
  readonly freedBytes: number;
  /** freed minus the split estimate; positive means the bucket shrinks. */
  readonly netFreedBytes: number;
}

/**
 * Multiplies a measured per-played-row cost across the whole published
 * population. It is an EXTRAPOLATION from two seasons of one algorithm, and
 * every input is echoed on the result so no figure here can be quoted without
 * the assumptions that produced it.
 */
export function extrapolateStorage(inputs: StorageExtrapolationInput): StorageExtrapolation {
  const totalRows = inputs.earlyRows + inputs.lateRows;
  const addedBytesLow = totalRows * inputs.earlyRate * inputs.algorithmCount;
  const addedBytesHigh = totalRows * inputs.lateRate * inputs.algorithmCount;
  const addedBytesSplit = (inputs.earlyRows * inputs.earlyRate + inputs.lateRows * inputs.lateRate) * inputs.algorithmCount;
  const freedBytes = inputs.teamObjects * inputs.freedPerTeamObject;
  return { inputs, addedBytesLow, addedBytesHigh, addedBytesSplit, freedBytes, netFreedBytes: freedBytes - addedBytesSplit };
}

export function meanAndSd(values: readonly number[]): { mean: number; sd: number } {
  if (values.length === 0) return { mean: 0, sd: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, sd: Math.sqrt(variance) };
}

// ---------------------------------------------------------------------------
// The CLI — a thin shell over the pure functions above
// ---------------------------------------------------------------------------

/** Deliberately not a UUID: if this ever escaped into a real bucket listing it would be unmistakable. */
const PRICING_GENERATION = "PRICING-DRY-RUN-260917-1zs-NOT-A-GENERATION";
/**
 * A published UUID generation is 36 characters; `PRICING_GENERATION` is longer,
 * and every artifact carries the string exactly once, so this instrument's
 * today-bytes for any object are EXACTLY this many bytes above the published
 * figure for the same object. It is the instrument's own calibration constant,
 * not a fudge factor: `2016micmp` measured 228,978 B here against the published
 * 228,971 B, a difference of exactly 7.
 */
const GENERATION_LENGTH_OVERHEAD = PRICING_GENERATION.length - 36;
/** `docs/publish-budget.md`'s machine block, generation `03a5cc42`: the published byte count for the event this instrument calibrates against. */
const PUBLISHED_2016MICMP_BYTES = 228_971;
/** The same block's published populations, and the algorithm count they are spread across (`PUBLISHED_ALGORITHM_IDS` — opr, epa, spr). */
const PUBLISHED_EVENT_OBJECTS = 7_509;
const PUBLISHED_TEAM_OBJECTS = 101_397;
const PUBLISHED_TEAM_MEDIAN_BYTES = 28_811;
const PUBLISHED_ALGORITHM_COUNT = 3;
/** Seasons the early (2016) arm's per-row rate is applied to, and the seasons the late (2026) arm's rate is applied to. */
const EARLY_SEASONS = [2016, 2017, 2018, 2019, 2020];
const LATE_SEASONS = [2022, 2023, 2024, 2025, 2026];
/** Never used: `dryRun: true` short-circuits before any `putObject`, so no bucket name is ever contacted. */
const UNUSED_BUCKET = "pricing-dry-run-never-uploaded";
const REPORT_DIR = join("reports", "frozen-row-pricing");
const CORPUS_PATH = join("data", "corpus.sqlite");

interface CapturedSeasonBodies {
  /** eventKey -> the published event artifact body. */
  readonly events: Map<string, string>;
  /** teamKey -> the published team-season artifact body. */
  readonly teams: Map<string, string>;
}

function seasonOfEventKey(eventKey: string): number {
  return Number(eventKey.slice(0, 4));
}

/** `v1/event/{eventKey}/{algorithmId}@{version}.json` -> eventKey. */
function eventKeyFromArtifactKey(key: string): string | undefined {
  const parts = key.split("/");
  return parts[0] === "v1" && parts[1] === "event" ? parts[2] : undefined;
}

/** `v1/team/{teamKey}/{year}/{algorithmId}@{version}.json` -> `{ teamKey, year }`. */
function teamFromArtifactKey(key: string): { teamKey: string; year: number } | undefined {
  const parts = key.split("/");
  if (parts[0] !== "v1" || parts[1] !== "team" || parts[2] === undefined || parts[3] === undefined) return undefined;
  return { teamKey: parts[2], year: Number(parts[3]) };
}

interface ArmSpec {
  readonly id: string;
  readonly seasons: readonly number[];
  readonly pricedSeason: number;
  readonly note: string;
}

const ARMS: Record<string, ArmSpec> = {
  a: {
    id: "a",
    seasons: [2016],
    pricedSeason: 2016,
    note: "Season 2016 alone — reproduces production's cold start for 2016micmp exactly, since 2016 is the first published season.",
  },
  b: {
    id: "b",
    seasons: [2025, 2026],
    pricedSeason: 2026,
    note: "Seasons 2025 and 2026 together, only 2026 priced; 2025 is present as warm-up so 2026 is not cold-started.",
  },
};

/** Runs the real publisher offline and captures the priced season's bodies through the inert sink. */
async function capture(arm: ArmSpec): Promise<CapturedSeasonBodies> {
  const events = new Map<string, string>();
  const teams = new Map<string, string>();
  const artifactSink = (pageKind: PageKind, key: string, body: string): void => {
    if (pageKind === "event") {
      const eventKey = eventKeyFromArtifactKey(key);
      if (eventKey !== undefined && seasonOfEventKey(eventKey) === arm.pricedSeason) events.set(eventKey, body);
      return;
    }
    if (pageKind === "team") {
      const parsed = teamFromArtifactKey(key);
      if (parsed !== undefined && parsed.year === arm.pricedSeason) teams.set(parsed.teamKey, body);
    }
  };
  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    await publishSeasons(db, {
      seasons: arm.seasons,
      algorithms: resolvePublishAlgorithms("spr"),
      bucket: UNUSED_BUCKET,
      dryRun: true,
      skipState: true,
      includeOffseason: true,
      // Past every priced season, so no pre-schedule sidecar is ever built.
      preScheduleFromSeason: 9999,
      generation: PRICING_GENERATION,
      computedAt: "2026-09-17T00:00:00.000Z",
      artifactSink,
    });
  } finally {
    db.close();
  }
  return { events, teams };
}

/** Played match rows per season, read straight from the corpus (read-only) — the extrapolation's row-count input. */
function playedRowsBySeason(): Record<string, number> {
  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    const rows = db
      .prepare(
        `select substr(event_key, 1, 4) as season, count(*) as played
           from matches
          where red_score is not null and blue_score is not null
          group by 1 order by 1`
      )
      .all() as { season: string; played: number }[];
    return Object.fromEntries(rows.map((row) => [row.season, row.played]));
  } finally {
    db.close();
  }
}

/** One row of a team's published `metricHistory`, reduced to what the pricing needs. */
export interface TeamHistoryRow {
  readonly matchKey: string;
  readonly eventKey: string;
  readonly metrics: FrozenMetricsRecord;
}

/**
 * The per-event ENTRY SNAPSHOT for one team: for each event after the team's
 * first, the metrics from the history row immediately PRECEDING its first row
 * at that event — which is the last row of the previous event.
 *
 * The team's FIRST event gets no entry: `preMatchMetrics` returns `undefined`
 * for a played row at index 0, and an entry snapshot there would start printing
 * a pre-match figure where the site prints an honest absence today (the audit's
 * finding 5). Absence here is the design, not a gap.
 */
export function deriveEventEntrySnapshots(history: readonly TeamHistoryRow[]): Map<string, FrozenMetricsRecord> {
  const out = new Map<string, FrozenMetricsRecord>();
  let previous: FrozenMetricsRecord | undefined;
  let previousEventKey: string | undefined;
  for (const row of history) {
    if (row.eventKey !== previousEventKey) {
      if (previous !== undefined) out.set(row.eventKey, previous);
      previousEventKey = row.eventKey;
    }
    previous = row.metrics;
  }
  return out;
}

/**
 * Resolves a played match's PRE-match metrics the way the proposed shape would:
 * from that event's own frozen rows plus its entry snapshot, never from a
 * whole-season array. This is the function whose output must equal the shipped
 * `preMatchMetrics`'s for every played row — the property the entire design
 * rests on, and the one the test asserts against the real resolver rather than
 * against a restatement of it.
 */
export function preMatchFromFrozenEvent(
  eventRows: readonly TeamHistoryRow[],
  entrySnapshot: FrozenMetricsRecord | undefined,
  matchKey: string
): FrozenMetricsRecord | undefined {
  const index = eventRows.findIndex((row) => row.matchKey === matchKey);
  if (index < 0) return undefined;
  if (index === 0) return entrySnapshot;
  return eventRows[index - 1]!.metrics;
}

/** Per-team derived facts the pricing needs, extracted once per team body. */
interface TeamFacts {
  readonly teamKey: string;
  readonly history: readonly TeamHistoryRow[];
  readonly eventKeys: readonly string[];
  readonly indexBody: string;
  readonly teamBody: string;
}

function extractTeamFacts(teamKey: string, body: string): TeamFacts {
  const parsed = JSON.parse(body) as Record<string, unknown>;
  const history = ((parsed.metricHistory ?? []) as Record<string, unknown>[]).map((row) => ({
    matchKey: String(row.matchKey),
    eventKey: String(row.eventKey),
    metrics: row.metrics as FrozenMetricsRecord,
  }));
  const eventKeys = ((parsed.events ?? []) as Record<string, unknown>[]).map((event) => String(event.eventKey));
  return { teamKey, history, eventKeys, indexBody: buildRobotIndexBody(parsed), teamBody: body };
}

/** Assembles every event's `FrozenEventInput` from the captured team histories. */
function buildFrozenInputs(
  eventBodies: ReadonlyMap<string, string>,
  facts: readonly TeamFacts[]
): Map<string, { artifact: LooseArtifact; input: FrozenEventInput; todayBody: string }> {
  // matchKey -> teamKey -> metrics, and eventKey -> teamKey -> entry snapshot.
  const cellsByEvent = new Map<string, Map<string, FrozenMetricsRecord>>();
  const entryByEvent = new Map<string, Map<string, FrozenMetricsRecord>>();
  for (const team of facts) {
    for (const row of team.history) {
      const cells = cellsByEvent.get(row.eventKey) ?? new Map<string, FrozenMetricsRecord>();
      cells.set(cellKey(row.matchKey, team.teamKey), row.metrics);
      cellsByEvent.set(row.eventKey, cells);
    }
    // One derivation, shared with the test — never a second copy here.
    for (const [eventKey, metrics] of deriveEventEntrySnapshots(team.history)) {
      const entries = entryByEvent.get(eventKey) ?? new Map<string, FrozenMetricsRecord>();
      entries.set(team.teamKey, metrics);
      entryByEvent.set(eventKey, entries);
    }
  }

  const out = new Map<string, { artifact: LooseArtifact; input: FrozenEventInput; todayBody: string }>();
  for (const [eventKey, body] of eventBodies) {
    const artifact = JSON.parse(body) as LooseArtifact;
    const matches = (artifact.matches ?? []) as Record<string, unknown>[];
    const teams = (artifact.teams ?? []) as Record<string, unknown>[];
    const matchKeys = matches.map((row) => String(row.matchKey));
    const rosterByMatch = new Map<string, readonly string[]>(
      matches.map((row) => [String(row.matchKey), [...((row.redTeams ?? []) as string[]), ...((row.blueTeams ?? []) as string[])]])
    );
    out.set(eventKey, {
      artifact,
      todayBody: body,
      input: {
        matchKeys,
        rosterByMatch,
        cells: cellsByEvent.get(eventKey) ?? new Map(),
        teamKeys: teams.map((row) => String(row.teamKey)),
        entryByTeam: entryByEvent.get(eventKey) ?? new Map(),
      },
    });
  }
  return out;
}

interface PerEventRow {
  eventKey: string;
  todayRaw: number;
  restringifiedRaw: number;
  playedMatches: number;
  rosterSize: number;
  proposedRaw: Record<string, number>;
  proposedBrotli?: Record<string, number>;
  todayBrotli?: number;
}

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

interface CliArgs {
  arm: string;
  summarize: boolean;
  events: string[];
  variants: string[];
  quality: number;
  out: string;
}

function parseCliArgs(argv: readonly string[]): CliArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      arm: { type: "string", default: "a" },
      events: { type: "string" },
      variants: { type: "string" },
      quality: { type: "string", default: "5" },
      out: { type: "string", default: REPORT_DIR },
      summarize: { type: "boolean", default: false },
    },
  });
  return {
    arm: String(values.arm),
    summarize: values.summarize === true,
    events:
      values.events === undefined
        ? []
        : String(values.events)
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
    variants:
      values.variants === undefined
        ? []
        : String(values.variants)
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
    quality: Number(values.quality),
    out: String(values.out),
  };
}

/**
 * Reads the two arm reports already on disk and writes the combined verdict
 * inputs: the worst case across arms for each bar condition, plus the storage
 * extrapolation, which needs BOTH arms' per-row rates and so cannot be
 * produced by either arm alone. It takes no new measurement — every number it
 * emits is arithmetic over numbers the arms already measured.
 */
function summarize(dir: string): Record<string, unknown> {
  const armA = JSON.parse(readFileSync(join(dir, "arm-a.json"), "utf8")) as Record<string, any>;
  const armB = JSON.parse(readFileSync(join(dir, "arm-b.json"), "utf8")) as Record<string, any>;
  const variantNames: string[] = armA.variants.map((v: { name: string }) => v.name);
  const combined: Record<string, unknown> = {};
  for (const name of variantNames) {
    const extrapolation = extrapolateStorage({
      earlyRows: armA.storage.earlyRows,
      lateRows: armA.storage.lateRows,
      earlyRate: armA.storage.addedPerPlayedRow[name].mean,
      lateRate: armB.storage.addedPerPlayedRow[name].mean,
      algorithmCount: PUBLISHED_ALGORITHM_COUNT,
      teamObjects: PUBLISHED_TEAM_OBJECTS,
      // The published-median anchor, not either season's own mean: the median
      // is the figure the ~2.9 GB in the bar was itself derived from, so the
      // two sides of condition 3 are computed on one basis.
      freedPerTeamObject: PUBLISHED_TEAM_MEDIAN_BYTES - (armA.storage.index.indexMeanRaw + armB.storage.index.indexMeanRaw) / 2,
    });
    const robot = (report: Record<string, any>, label: string): number =>
      report.robotPages.find((p: { label: string }) => p.label === label)?.byVariant?.[name]?.totalBrotli ?? Number.NaN;
    combined[name] = {
      maxProposedRaw: Math.max(armA.storage.maxProposedRaw[name], armB.storage.maxProposedRaw[name]),
      p95ProposedRaw: Math.max(armA.storage.p95ProposedRaw[name], armB.storage.p95ProposedRaw[name]),
      robotTwoEventBrotli: Math.max(robot(armA, "2-event"), robot(armB, "2-event")),
      robotFiveEventBrotli: Math.max(robot(armA, "5-event"), robot(armB, "5-event")),
      robotWorstCaseBrotli: Math.max(robot(armA, "worst-case"), robot(armB, "worst-case")),
      storage: extrapolation,
    };
  }
  return { task: "260917-1zs", generatedAt: new Date().toISOString(), basis: "worst case across arm a (2016) and arm b (2026)", combined };
}

async function main(argv: readonly string[]): Promise<void> {
  const args = parseCliArgs(argv);
  if (args.summarize) {
    const summary = summarize(args.out);
    const outPath = join(args.out, "summary.json");
    writeFileSync(outPath, JSON.stringify(summary, null, 2), "utf8");
    log(`combined summary written to ${outPath}`);
    for (const [name, value] of Object.entries(summary.combined as Record<string, any>)) {
      log(
        `${name.padEnd(16)} max ${value.maxProposedRaw} B, p95 ${value.p95ProposedRaw} B | robots br 2ev ${kb(value.robotTwoEventBrotli)}, ` +
          `5ev ${kb(value.robotFiveEventBrotli)}, worst ${kb(value.robotWorstCaseBrotli)} | added ${(value.storage.addedBytesSplit / 1e9).toFixed(3)} GB ` +
          `[${(value.storage.addedBytesLow / 1e9).toFixed(3)}-${(value.storage.addedBytesHigh / 1e9).toFixed(3)}], freed ${(value.storage.freedBytes / 1e9).toFixed(3)} GB, ` +
          `net ${(value.storage.netFreedBytes / 1e9).toFixed(3)} GB`
      );
    }
    return;
  }
  const arm = ARMS[args.arm];
  if (arm === undefined) throw new Error(`unknown arm "${args.arm}" — expected one of ${Object.keys(ARMS).join(", ")}`);

  log(`arm ${arm.id}: seasons ${arm.seasons.join(",")}, pricing ${arm.pricedSeason}`);
  log(arm.note);
  const started = Date.now();
  const captured = await capture(arm);
  log(`captured ${captured.events.size} event bodies and ${captured.teams.size} team bodies in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  const facts = [...captured.teams].map(([teamKey, body]) => extractTeamFacts(teamKey, body));
  const eventBodies =
    args.events.length === 0 ? captured.events : new Map([...captured.events].filter(([eventKey]) => args.events.includes(eventKey)));
  const inputs = buildFrozenInputs(eventBodies, facts);

  const allVariants = pricedVariants();
  const variants = args.variants.length === 0 ? allVariants : allVariants.filter((v) => args.variants.includes(v.name));
  if (variants.length === 0) throw new Error(`no variant matched ${args.variants.join(",")} — known: ${allVariants.map((v) => v.name).join(", ")}`);

  // ---- per-event raw sweep over every event in the priced season ----
  const perEvent: PerEventRow[] = [];
  for (const [eventKey, { artifact, input, todayBody }] of inputs) {
    const proposedRaw: Record<string, number> = {};
    for (const variant of variants) proposedRaw[variant.name] = rawBytes(attachVariant(artifact, input, variant));
    perEvent.push({
      eventKey,
      todayRaw: rawBytes(todayBody),
      restringifiedRaw: rawBytes(JSON.stringify(artifact)),
      playedMatches: input.matchKeys.length,
      rosterSize: input.teamKeys.length,
      proposedRaw,
    });
  }
  perEvent.sort((a, b) => b.todayRaw - a.todayRaw);

  // ---- the five named events, brotli'd under every variant ----
  const withPlayed = perEvent.filter((row) => row.playedMatches > 0);
  const byTodayAsc = [...perEvent].sort((a, b) => a.todayRaw - b.todayRaw).map((r) => r.eventKey);
  const named: Record<string, string | undefined> = {
    max: perEvent[0]?.eventKey,
    p95: byTodayAsc[Math.min(byTodayAsc.length - 1, Math.max(0, Math.ceil(0.95 * byTodayAsc.length) - 1))],
    median: byTodayAsc[Math.min(byTodayAsc.length - 1, Math.max(0, Math.ceil(0.5 * byTodayAsc.length) - 1))],
    largestRoster: [...perEvent].sort((a, b) => b.rosterSize - a.rosterSize)[0]?.eventKey,
    smallestOffseasonWithPlay: [...withPlayed].sort((a, b) => a.todayRaw - b.todayRaw)[0]?.eventKey,
  };
  const namedKeys = [...new Set(Object.values(named).filter((k): k is string => k !== undefined))];
  const rowByKey = new Map(perEvent.map((row) => [row.eventKey, row]));
  for (const eventKey of namedKeys) {
    const entry = inputs.get(eventKey);
    const row = rowByKey.get(eventKey);
    if (entry === undefined || row === undefined) continue;
    row.todayBrotli = sizeOf(entry.todayBody, args.quality).brotli;
    row.proposedBrotli = {};
    for (const variant of variants) row.proposedBrotli[variant.name] = sizeOf(attachVariant(entry.artifact, entry.input, variant), args.quality).brotli;
  }

  // ---- brotli calibration against the two known wire figures ----
  const calibrationTeams = ["frc254", "frc2481"];
  const calibration = calibrationTeams.map((teamKey) => {
    const body = captured.teams.get(teamKey);
    return {
      teamKey,
      present: body !== undefined,
      raw: body === undefined ? 0 : rawBytes(body),
      brotli: body === undefined ? {} : Object.fromEntries([4, 5, 6, 11].map((q) => [String(q), sizeOf(body, q).brotli])),
    };
  });

  // ---- the index population ----
  const indexRaw = facts.map((team) => rawBytes(team.indexBody));
  const teamRaw = facts.map((team) => rawBytes(team.teamBody));

  // ---- robot pages ----
  const byEventCount = [...facts].sort((a, b) => b.eventKeys.length - a.eventKeys.length);
  const pickRobot = (want: number): TeamFacts | undefined =>
    facts.find((t) => t.teamKey === (want === 2 ? "frc2481" : "frc254") && t.eventKeys.length === want) ?? facts.find((t) => t.eventKeys.length === want);
  const robotPicks: { label: string; team: TeamFacts | undefined }[] = [
    { label: "2-event", team: pickRobot(2) },
    { label: "5-event", team: pickRobot(5) },
    { label: "worst-case", team: byEventCount[0] },
  ];
  const robotPages = robotPicks.map(({ label, team }) => {
    if (team === undefined) return { label, teamKey: null, eventCount: 0, incomplete: true, byVariant: {} as Record<string, unknown> };
    const index = sizeOf(team.indexBody, args.quality);
    const today = sizeOf(team.teamBody, args.quality);
    const present = team.eventKeys.filter((eventKey) => inputs.has(eventKey));
    const todayEventBrotli = present.reduce((a, eventKey) => a + sizeOf(inputs.get(eventKey)!.todayBody, args.quality).brotli, 0);
    const byVariant: Record<string, { totalRaw: number; totalBrotli: number; eventFilesBrotli: number }> = {};
    for (const variant of variants) {
      let raw = 0;
      let brotli = 0;
      for (const eventKey of present) {
        const entry = inputs.get(eventKey)!;
        const measured = sizeOf(attachVariant(entry.artifact, entry.input, variant), args.quality);
        raw += measured.raw;
        brotli += measured.brotli;
      }
      byVariant[variant.name] = { totalRaw: index.raw + raw, totalBrotli: index.brotli + brotli, eventFilesBrotli: brotli };
    }
    return {
      label,
      teamKey: team.teamKey,
      eventCount: team.eventKeys.length,
      eventKeys: team.eventKeys,
      /** True when any of this robot's event files was outside the priced set (an `--events` filter run) — its totals then UNDERSTATE and must not be read as a price. */
      incomplete: present.length !== team.eventKeys.length,
      indexRaw: index.raw,
      indexBrotli: index.brotli,
      todayTeamRaw: today.raw,
      todayTeamBrotli: today.brotli,
      /** What this robot's event files cost TODAY, unchanged — the floor the proposed shape cannot go below. */
      todayEventFilesBrotli: todayEventBrotli,
      byVariant,
      /** index + one request per event file. The `events/{year}` artifact the team page already fetches for `officialSnapshot` is counted separately in the report. */
      requestCount: 1 + present.length,
      serialHops: 2,
    };
  });

  // ---- per-played-row added bytes, the storage extrapolation's input ----
  const addedPerRow: Record<string, { mean: number; sd: number }> = {};
  for (const variant of variants) {
    const samples = perEvent
      .filter((row) => row.playedMatches > 0)
      .map((row) => ((row.proposedRaw[variant.name] ?? 0) - row.restringifiedRaw) / row.playedMatches);
    addedPerRow[variant.name] = meanAndSd(samples);
  }

  const playedRows = playedRowsBySeason();
  const sampleRecord = (() => {
    for (const { input } of inputs.values()) {
      for (const metrics of input.cells.values()) return metrics;
    }
    return undefined;
  })();

  const report = {
    task: "260917-1zs",
    generatedAt: new Date().toISOString(),
    arms: [{ ...arm, capturedEvents: captured.events.size, capturedTeams: captured.teams.size, pricedEvents: inputs.size }],
    variants: variants.map((v) => ({ name: v.name, layout: v.layout, ...v.options })),
    brotliQuality: args.quality,
    brotliCalibration: calibration,
    instrumentCalibration: {
      generationLengthOverheadBytes: GENERATION_LENGTH_OVERHEAD,
      publishedEventKey: "2016micmp",
      publishedBytes: PUBLISHED_2016MICMP_BYTES,
      measuredBytes: rowByKey.get("2016micmp")?.todayRaw ?? null,
      residualAfterOverhead:
        rowByKey.get("2016micmp") === undefined ? null : rowByKey.get("2016micmp")!.todayRaw - GENERATION_LENGTH_OVERHEAD - PUBLISHED_2016MICMP_BYTES,
    },
    named,
    perEvent,
    storage: {
      addedPerPlayedRow: addedPerRow,
      pricedSeasonTotals: Object.fromEntries(
        variants.map((v) => [
          v.name,
          {
            todayRaw: perEvent.reduce((a, r) => a + r.todayRaw, 0),
            proposedRaw: perEvent.reduce((a, r) => a + (r.proposedRaw[v.name] ?? 0), 0),
          },
        ])
      ),
      maxProposedRaw: Object.fromEntries(variants.map((v) => [v.name, Math.max(...perEvent.map((r) => r.proposedRaw[v.name] ?? 0))])),
      p95ProposedRaw: Object.fromEntries(
        variants.map((v) => [v.name, percentileOfSorted([...perEvent.map((r) => r.proposedRaw[v.name] ?? 0)].sort((a, b) => a - b), 95)])
      ),
      playedRowsBySeason: playedRows,
      earlyRows: EARLY_SEASONS.reduce((a, s) => a + (playedRows[String(s)] ?? 0), 0),
      lateRows: LATE_SEASONS.reduce((a, s) => a + (playedRows[String(s)] ?? 0), 0),
      publishedEventObjects: PUBLISHED_EVENT_OBJECTS,
      publishedTeamObjects: PUBLISHED_TEAM_OBJECTS,
      publishedAlgorithmCount: PUBLISHED_ALGORITHM_COUNT,
      index: {
        teamCount: facts.length,
        indexMeanRaw: meanAndSd(indexRaw).mean,
        indexMedianRaw: percentileOfSorted([...indexRaw].sort((a, b) => a - b), 50),
        indexMaxRaw: Math.max(0, ...indexRaw),
        teamMeanRaw: meanAndSd(teamRaw).mean,
        teamMedianRaw: percentileOfSorted([...teamRaw].sort((a, b) => a - b), 50),
        /** What one team object loses by shrinking to an index, measured two ways: this season's own mean, and the published median anchor. */
        freedPerTeamObjectMeasured: meanAndSd(teamRaw).mean - meanAndSd(indexRaw).mean,
        freedPerTeamObjectPublishedAnchor: PUBLISHED_TEAM_MEDIAN_BYTES - meanAndSd(indexRaw).mean,
      },
    },
    /**
     * One real metrics record from this season's frozen rows, verbatim. It is
     * here because the per-played-row rate differs sharply between the arms,
     * and a reader has to be able to SEE why rather than take it on trust.
     */
    sampleRecord,
    robotPages,
  };

  mkdirSync(args.out, { recursive: true });
  const outPath = join(args.out, `arm-${arm.id}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  // ---- console table ----
  log("");
  log(`brotli quality ${args.quality}; report written to ${outPath}`);
  if (report.instrumentCalibration.measuredBytes !== null) {
    log(
      `instrument calibration: 2016micmp measured ${report.instrumentCalibration.measuredBytes} B vs published ${PUBLISHED_2016MICMP_BYTES} B; ` +
        `generation-string overhead ${GENERATION_LENGTH_OVERHEAD} B; residual ${report.instrumentCalibration.residualAfterOverhead} B`
    );
  }
  for (const entry of calibration) {
    log(`calibration ${entry.teamKey}: raw ${kb(entry.raw)}, brotli ${Object.entries(entry.brotli).map(([q, b]) => `q${q}=${kb(b as number)}`).join(" ")}`);
  }
  log("");
  log(`named events (${Object.entries(named).map(([k, v]) => `${k}=${v ?? "-"}`).join(", ")})`);
  for (const eventKey of namedKeys) {
    const row = rowByKey.get(eventKey);
    if (row === undefined) continue;
    log(`  ${eventKey}: today ${row.todayRaw} B raw${row.todayBrotli === undefined ? "" : ` / ${row.todayBrotli} B br`}, ${row.playedMatches} played, ${row.rosterSize} teams`);
    for (const variant of variants) {
      const raw = row.proposedRaw[variant.name] ?? 0;
      const br = row.proposedBrotli?.[variant.name];
      log(`     ${variant.name.padEnd(16)} ${raw} B raw (+${raw - row.todayRaw})${br === undefined ? "" : `, ${br} B br (+${br - (row.todayBrotli ?? 0)})`}`);
    }
  }
  log("");
  for (const variant of variants) {
    log(
      `${variant.name.padEnd(16)} max ${report.storage.maxProposedRaw[variant.name]} B, p95 ${report.storage.p95ProposedRaw[variant.name]} B, ` +
        `added/played-row ${addedPerRow[variant.name]!.mean.toFixed(0)} +/- ${addedPerRow[variant.name]!.sd.toFixed(0)} B`
    );
  }
  log("");
  log(`index: n=${facts.length}, mean ${report.storage.index.indexMeanRaw.toFixed(0)} B vs team mean ${report.storage.index.teamMeanRaw.toFixed(0)} B`);
  for (const page of robotPages) {
    if (page.teamKey === null) {
      log(`robot ${page.label}: none found`);
      continue;
    }
    log(
      `robot ${page.label} ${page.teamKey} (${page.eventCount} events): today ${kb(page.todayTeamBrotli!)} br in 1 request; ` +
        `index ${kb(page.indexBrotli!)}; its event files TODAY already cost ${kb(page.todayEventFilesBrotli!)} br; ` +
        `${page.requestCount} requests, ${page.serialHops} serial hops${page.incomplete ? " [INCOMPLETE]" : ""}`
    );
    for (const variant of variants) {
      const entry = (page.byVariant as Record<string, { totalBrotli: number }>)[variant.name];
      if (entry === undefined) continue;
      log(`     ${variant.name.padEnd(16)} ${kb(entry.totalBrotli)} br total`);
    }
  }
}

/** Parses an augmented body back through the shipped schema — exported so the test can assert an augmented artifact still parses. */
export function parsesAsEventArtifact(body: string): boolean {
  return EventArtifactSchema.safeParse(JSON.parse(body)).success;
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
