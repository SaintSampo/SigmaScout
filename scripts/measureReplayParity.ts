/**
 * OFFLINE REPLAY-PARITY INSTRUMENT (quick task 260917-mwu, Half A). It
 * measures and reports; it publishes nothing.
 *
 * THE QUESTION. Browser pricing of UPCOMING matches ships today, and
 * `eventStatePricing.parity.test.ts` proves it reproduces the publisher. A
 * relay architecture would need something strictly harder: the browser would
 * have to FOLD played matches — predict, then update, then the level-2 fold —
 * starting from a pre-event state block and seeing only that one event's
 * matches. Can that reproduce `publish.ts`'s published rows exactly, at the
 * shipped rounding rule?
 *
 * WHY FOLDING IS HARDER THAN PRICING, and why a clean pricing result does not
 * transfer: `logTau` and `scale` are RUNNING accumulators stepped once per
 * folded match, so a difference at match 1 feeds match 2 and compounds.
 * `spr.ts`'s own header says `scale` is a ~100-match trailing EWMA over the
 * GLOBALLY INTERLEAVED match stream — a browser that sees one event cannot see
 * the steps other events contributed.
 *
 * THE ARMS. Three of the five exist only to make the fourth interpretable; the
 * bar they are judged against was committed before this file existed (see
 * `.planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md`, section
 * `REPLAY PARITY — the bar, pre-registered BEFORE any number`).
 *
 *   P   the REAL `publishSeasons` over the local corpus, read through
 *       `publish.ts`'s inert `artifactSink`. Published truth.
 *   C   an in-process reproduction of the publisher's two-pass structure using
 *       the REAL `SigmaScoutLayer`. THE VALIDITY GATE: if C is not exact,
 *       nothing downstream means anything and the pass is discarded.
 *   M   arm C with the real layer replaced by this file's `MirrorFold`, still
 *       cold-started over the whole season. `SigmaScoutLayer` has no
 *       resume-from-state constructor, so arm R cannot use it; arm M proves the
 *       mirror that replaces it is faithful, so an arm-R difference can never be
 *       blamed on — or excused by — the re-implementation.
 *   R   THE ARM UNDER TEST. The pre-event state block through the wire, then
 *       only that event's own matches, in stream order.
 *   R'  arm R handed the in-process state object instead of the wire copy. Run
 *       only for fields arm R fails, to isolate WIRE from everything else.
 *
 * SAFETY, by construction rather than by care (copied from
 * `scripts/priceFrozenEventRow.ts`, which established the pattern):
 * - no import of `packages/harness/r2Client.ts`, no S3/signing SDK, no `fetch`
 *   (`measureReplayParity.test.ts` scans this file's own imports and source);
 * - no environment variable is read, so it needs no `.env` and must never be
 *   invoked through `--env-file`; no secret can reach a log line;
 * - `dryRun: true`, so no request is ever signed and no object ever written;
 * - `skipState: true`, so no `reports/publish/seed-*.sql` is written;
 * - `--write-budget` is never passed, so `docs/publish-budget.md` is untouched;
 * - the corpus is opened through `openCorpusReadOnly` only;
 * - the generation string is a fixed non-UUID marker that could not be mistaken
 *   for a real generation if it somehow escaped.
 *
 * USAGE (no `.env`, no network):
 *   npx tsx scripts/measureReplayParity.ts --events 2026nyro
 *   npx tsx scripts/measureReplayParity.ts --events 2026arc,2026nyro,2026auwarp
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { openCorpusReadOnly, selectMatchesChronological, selectScheduledMatches, type Corpus } from "../packages/corpus/db.js";
import { publishSeasons, resolvePublishAlgorithms } from "../packages/harness/publish.js";
import {
  actualBonusFlagsForSeason,
  type ActualBonusFlags,
} from "../packages/harness/publish.js";
import { buildSeasonStream, WalkForwardSimulator, type PredictionRecord } from "../packages/harness/replay.js";
import { corpusColdStartIndex } from "../packages/harness/corpusColdStart.js";
import { seasonBoundaryFor } from "../packages/harness/seasonBoundary.js";
import { SigmaScoutLayer } from "../packages/harness/sigmaScoutLayer.js";
import { eventPlayedRow, teamSeasonPlayedRow } from "../packages/harness/publishedRows.js";
import {
  serializeState,
  withRpBeliefs,
  withRpMeanShift,
  withSigmaBeliefs,
  withSigmaPopulation,
  type StateRow,
} from "../packages/harness/stateSnapshot.js";
import { buildEventStateBlock } from "../packages/harness/eventStatePricing.js";
import { EventStateBlockSchema, type PageKind } from "../packages/harness/pageArtifacts.js";
import { ROUNDING_RULE, roundMetric } from "../packages/harness/rounding.js";
import { SIGMA_METRIC_KEY, type SigmaBelief, type SigmaPopulation } from "../packages/harness/sigmaScore.js";
import type { RpTeamBeliefs } from "../packages/core/rankingPoints/empiricalMoments.js";
import type { RpMeanShiftState } from "../packages/core/rankingPoints/meanShift.js";
import { toLeakProofUpcoming } from "../packages/core/algorithms/leakProof.js";
import { applyColdStartTie } from "../packages/core/scoring/coldStart.js";
import { spr, type SprState } from "../packages/core/algorithms/spr.js";
import { isDemoTeamKey } from "../packages/core/algorithms/demoTeams.js";
import { RP_RULE_MODULES } from "../packages/core/rankingPoints/rules.js";
import { TOTAL_METRIC_KEY } from "../packages/core/algorithms/types.js";
import type { MatchResult, Prediction } from "../packages/core/algorithms/types.js";
import { MirrorFold, type FoldOutput } from "./replayParityMirror.js";

// ---------------------------------------------------------------------------
// Constants — every one of them inert
// ---------------------------------------------------------------------------

/** Deliberately not a UUID: if this ever escaped into a real bucket listing it would be unmistakable. */
export const PARITY_GENERATION = "REPLAY-PARITY-DRY-RUN-260917-mwu-NOT-A-GENERATION";
/** Fixed, never `new Date()`: two runs of this instrument must produce byte-identical arm-P bodies. */
export const PARITY_COMPUTED_AT = "2026-09-17T00:00:00.000Z";
/** Never used: `dryRun: true` short-circuits before any `putObject`, so no bucket name is ever contacted. */
const UNUSED_BUCKET = "replay-parity-dry-run-never-uploaded";
const CORPUS_PATH = join("data", "corpus.sqlite");
const REPORT_DIR = join("reports", "replay-parity");
/**
 * 2025 is present only as warm-up, so 2026 crosses a REAL season boundary
 * rather than cold-starting — the arm-B precedent `priceFrozenEventRow.ts`
 * already set for this corpus.
 */
export const PARITY_SEASONS = [2025, 2026] as const;
export const PRICED_SEASON = 2026;

// ---------------------------------------------------------------------------
// The pre-registered comparison — field sets, taxonomy, and a strict comparator
// ---------------------------------------------------------------------------

/** The attribution taxonomy. Every differing field gets exactly one, from this closed set. */
export type Attribution = "WIRE" | "INTERLEAVE" | "POPULATION" | "ENGINE" | "BUG";

/**
 * Event-artifact played-row fields compared exactly. The `actual*` passthroughs
 * are in the set precisely because they should be trivially equal: a difference
 * there is a plumbing bug worth catching, not a model finding.
 */
export const EVENT_ROW_FIELDS = [
  "predictedWinner",
  "pRedWin",
  "predictedRedScore",
  "predictedBlueScore",
  "redScoreVarianceOwn",
  "blueScoreVarianceOwn",
  "redMatchBandVariance",
  "blueMatchBandVariance",
  "redRpPmf",
  "blueRpPmf",
  "matchOutcomePmf",
  "redBonusRpPmf",
  "blueBonusRpPmf",
  "redBonusRp",
  "blueBonusRp",
  "actualRedBonusRp",
  "actualBlueBonusRp",
  "coldStart",
  "actualWinner",
  "actualRedScore",
  "actualBlueScore",
  "actualRedRp",
  "actualBlueRp",
] as const;

/** Team-season played-row fields: the same set plus `variance` and the identity stamps. */
export const TEAM_ROW_FIELDS = [
  ...EVENT_ROW_FIELDS,
  "variance",
  "season",
  "eventKey",
  "algorithmId",
  "algorithmVersion",
] as const;

/**
 * `percentile` is deliberately absent: `withHistoryPercentiles` ranks against a
 * season-wide pool one event's files do not contain. POPULATION by
 * construction, named in the pre-registration rather than dropped quietly.
 * `matchIndex` is absent for the same reason — it is a position in the SEASON's
 * chronological stream.
 */
export const HISTORY_VALUE_FIELDS = ["value", "spread"] as const;

/**
 * The pre-registered attribution for each field that can differ. `BUG` is the
 * default for the passthroughs precisely so that an unforeseen difference there
 * is loud rather than absorbed into a plausible-sounding bucket.
 *
 * `differsAtFirstRow` is the DECISIVE signal, and it outranks arm R'. At the
 * event's FIRST match no other event's match has yet been replayed, so
 * interleaving has had no opportunity to move anything: a field that is already
 * wrong there is wrong because the block did not carry what it needed, which is
 * WIRE by definition. Arm R' alone cannot see this, because it still builds its
 * state through the same `seedStateRows` passenger chain and only skips
 * `buildEventStateBlock` and the JSON round-trip — so a passenger DROPPED by the
 * chain (`withSigmaBeliefs` silently discards a belief for any team with no
 * level-1 state row) fails arm R' too and would be mislabelled INTERLEAVE.
 * Measured on `2026auwarp`, where the match band is wrong from match 1.
 */
export function attributeField(field: string, armRPrimeAlsoFails: boolean, differsAtFirstRow: boolean): Attribution {
  // A passthrough of a corpus column cannot drift for a model reason.
  if (field.startsWith("actual")) return "BUG";
  if (field === "coldStart") return "BUG";
  if (field === "season" || field === "eventKey" || field === "algorithmId" || field === "algorithmVersion") return "BUG";
  // Wrong before any other event's match could have moved anything.
  if (differsAtFirstRow) return "WIRE";
  // A field arm R' also fails is not a SERIALIZATION loss specifically.
  if (!armRPrimeAlsoFails) return "WIRE";
  return "INTERLEAVE";
}

/** `undefined` for an absent key, so an absent key and an explicit `null` compare unequal. */
function readKey(row: Record<string, unknown>, field: string): { present: boolean; value: unknown } {
  return { present: Object.prototype.hasOwnProperty.call(row, field), value: row[field] };
}

/**
 * Strict equality on a published field: key presence included, arrays element
 * by element, no tolerance anywhere. `null` and absent are different published
 * claims throughout this codebase, so they must compare unequal here.
 */
export function fieldsEqual(a: Record<string, unknown>, b: Record<string, unknown>, field: string): boolean {
  const left = readKey(a, field);
  const right = readKey(b, field);
  if (left.present !== right.present) return false;
  if (!left.present) return true;
  return deepStrictEqual(left.value, right.value);
}

/** `Object.is` at the leaves (so `-0` and `0` differ, and `NaN` equals itself), structural above them. */
export function deepStrictEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((entry, index) => deepStrictEqual(entry, b[index]));
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const aKeys = Object.keys(a as object).sort();
  const bKeys = Object.keys(b as object).sort();
  if (aKeys.length !== bKeys.length || aKeys.some((key, i) => key !== bKeys[i])) return false;
  return aKeys.every((key) => deepStrictEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

/**
 * The JSON wire form of a built row: exactly what `JSON.stringify` of the
 * artifact would carry, so an `undefined`-valued key vanishes here just as it
 * does on the wire and the comparison is against published bytes rather than
 * against an in-memory object shape.
 */
export function wireForm<T>(row: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

/** The largest absolute elementwise difference between two numbers/arrays, or `undefined` when neither side is numeric. */
export function maxAbsDiff(a: unknown, b: unknown): number | undefined {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b);
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    let worst: number | undefined;
    for (let i = 0; i < a.length; i++) {
      const d = maxAbsDiff(a[i], b[i]);
      if (d !== undefined && (worst === undefined || d > worst)) worst = d;
    }
    return worst;
  }
  return undefined;
}

/**
 * How far an unrounded value sits from the half-way point that would flip its
 * published digit: `0.5 - |x - round(x)|` in units of the last published place.
 * Near zero means "rounding absorbed this difference, but only just" — which is
 * the difference between a real guarantee and a coincidence of this corpus.
 */
export function roundingHeadroom(value: number, decimals: number): number {
  const shifted = value * 10 ** decimals;
  return 0.5 - Math.abs(shifted - Math.round(shifted));
}

/**
 * The smallest headroom across a value or every element of an array, so a pmf
 * reports the entry closest to flipping rather than no answer at all.
 */
export function minHeadroomOf(value: unknown, decimals: number): number | undefined {
  if (typeof value === "number") return roundingHeadroom(value, decimals);
  if (Array.isArray(value)) {
    let worst: number | undefined;
    for (const entry of value) {
      const h = minHeadroomOf(entry, decimals);
      if (h !== undefined && (worst === undefined || h < worst)) worst = h;
    }
    return worst;
  }
  return undefined;
}

/** The rounding rule each compared numeric field publishes under, so "does it survive rounding" is answered from the rule, never from a guess. */
export function decimalsForField(field: string): number | undefined {
  if (field === "pRedWin") return ROUNDING_RULE.probability;
  if (field === "predictedRedScore" || field === "predictedBlueScore") return ROUNDING_RULE.score;
  if (field.endsWith("VarianceOwn") || field.endsWith("MatchBandVariance") || field === "variance") return ROUNDING_RULE.variance;
  if (field.endsWith("Pmf")) return ROUNDING_RULE.pmf;
  if (field === "redBonusRp" || field === "blueBonusRp") return ROUNDING_RULE.probability;
  if (field === "value" || field === "spread") return ROUNDING_RULE.metric;
  return undefined;
}

// ---------------------------------------------------------------------------
// Arm P — the real publisher, read through its inert sink
// ---------------------------------------------------------------------------

export interface PublishedBodies {
  /** eventKey -> the published event artifact body, for the target events only. */
  readonly events: Map<string, string>;
  /** teamKey -> the published team-season artifact body, for roster teams only. */
  readonly teams: Map<string, string>;
}

function eventKeyFromArtifactKey(key: string): string | undefined {
  const parts = key.split("/");
  return parts[0] === "v1" && parts[1] === "event" ? parts[2] : undefined;
}

function teamFromArtifactKey(key: string): { teamKey: string; year: number } | undefined {
  const parts = key.split("/");
  if (parts[0] !== "v1" || parts[1] !== "team" || parts[2] === undefined || parts[3] === undefined) return undefined;
  return { teamKey: parts[2], year: Number(parts[3]) };
}

/** Runs the real publisher offline and keeps only the bodies the comparison reads. */
export async function armPublished(db: Corpus, targetEvents: readonly string[], rosterTeams: ReadonlySet<string>): Promise<PublishedBodies> {
  const events = new Map<string, string>();
  const teams = new Map<string, string>();
  const wantedEvents = new Set(targetEvents);
  const artifactSink = (pageKind: PageKind, key: string, body: string): void => {
    if (pageKind === "event") {
      const eventKey = eventKeyFromArtifactKey(key);
      if (eventKey !== undefined && wantedEvents.has(eventKey)) events.set(eventKey, body);
      return;
    }
    if (pageKind === "team") {
      const parsed = teamFromArtifactKey(key);
      if (parsed !== undefined && parsed.year === PRICED_SEASON && rosterTeams.has(parsed.teamKey)) teams.set(parsed.teamKey, body);
    }
  };
  await publishSeasons(db, {
    seasons: [...PARITY_SEASONS],
    algorithms: resolvePublishAlgorithms("spr"),
    bucket: UNUSED_BUCKET,
    dryRun: true,
    skipState: true,
    includeOffseason: true,
    // Past every priced season, so no pre-schedule sidecar is ever built.
    preScheduleFromSeason: 9999,
    generation: PARITY_GENERATION,
    computedAt: PARITY_COMPUTED_AT,
    artifactSink,
  });
  return { events, teams };
}

// ---------------------------------------------------------------------------
// Arms C and M — the publisher's two-pass structure, reproduced in process
// ---------------------------------------------------------------------------

/** One arm's rows for one event, keyed so ordering never enters the comparison. */
export interface ArmRows {
  /** matchKey -> event-artifact played row, wire form. */
  readonly eventRows: Map<string, Record<string, unknown>>;
  /** `${teamKey}|${matchKey}` -> team-season played row, wire form. */
  readonly teamRows: Map<string, Record<string, unknown>>;
  /** `${teamKey}|${matchKey}` -> that row's rounded `metrics` record, wire form. */
  readonly historyMetrics: Map<string, Record<string, unknown>>;
  /** matchKey -> the UNROUNDED prediction the row was built from, for magnitude reporting. */
  readonly rawPredictions: Map<string, Prediction>;
  /** `${teamKey}|${matchKey}` -> the UNROUNDED metric record, same purpose. */
  readonly rawHistoryMetrics: Map<string, Record<string, { value: number; spread?: number }>>;
  /**
   * The same three surfaces again, with the SAME published field names but NO
   * rounding. The magnitude, the trajectory and the rounding headroom are all
   * taken against these. Comparing two already-rounded rows would report a
   * difference measured in published digits and then label it "unrounded",
   * which is exactly the confusion this separate map exists to prevent.
   */
  readonly unroundedEventRows: Map<string, Record<string, unknown>>;
  readonly unroundedTeamRows: Map<string, Record<string, unknown>>;
  readonly unroundedHistory: Map<string, Record<string, unknown>>;
}

function emptyArmRows(): ArmRows {
  return {
    eventRows: new Map(),
    teamRows: new Map(),
    historyMetrics: new Map(),
    rawPredictions: new Map(),
    rawHistoryMetrics: new Map(),
    unroundedEventRows: new Map(),
    unroundedTeamRows: new Map(),
    unroundedHistory: new Map(),
  };
}

/**
 * The published field names a row carries, valued from the UNROUNDED prediction
 * and display band. The names are the ones `publishedRows.ts` emits, so the two
 * cannot drift; the rounding is simply not applied.
 */
export function unroundedRowOf(record: PredictionRecord): Record<string, unknown> {
  const p = record.prediction as unknown as Record<string, unknown>;
  return {
    pRedWin: p.pRedWin,
    predictedRedScore: p.redScore,
    predictedBlueScore: p.blueScore,
    redScoreVarianceOwn: p.redScoreVarianceOwn,
    blueScoreVarianceOwn: p.blueScoreVarianceOwn,
    variance: p.variance,
    redMatchBandVariance: record.matchBand?.red,
    blueMatchBandVariance: record.matchBand?.blue,
    redRpPmf: p.redRpPmf,
    blueRpPmf: p.blueRpPmf,
    matchOutcomePmf: p.matchOutcomePmf,
    redBonusRpPmf: p.redBonusRpPmf,
    blueBonusRpPmf: p.blueBonusRpPmf,
    redBonusRp: p.redBonusRp,
    blueBonusRp: p.blueBonusRp,
  };
}

/** The per-match lookups every row builder needs, read once from the corpus-derived maps. */
export interface RowLookups {
  readonly sortTimeByMatchKey: ReadonlyMap<string, number>;
  readonly videoByMatchKey: ReadonlyMap<string, string>;
  readonly actualBonusFlagsByMatchKey: ReadonlyMap<string, ActualBonusFlags | null>;
}

/** Rounds a metric record exactly as `publish.ts`'s private `roundTeamMetricRecord` does; `percentile` is not produced here at all. */
export function roundMetricsRecord(metrics: Record<string, { value: number; spread?: number }>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, m] of Object.entries(metrics)) {
    out[key] = {
      value: roundMetric(m.value),
      ...(m.spread !== undefined ? { spread: roundMetric(m.spread) } : {}),
    };
  }
  return out;
}

function addRows(
  rows: ArmRows,
  record: PredictionRecord,
  lookups: RowLookups,
  algorithmVersion: string,
  metricsByTeam: Record<string, Record<string, { value: number; spread?: number }>> | undefined,
  sigmaByTeam: ReadonlyMap<string, number> | undefined
): void {
  const matchKey = record.match.matchKey;
  rows.eventRows.set(
    matchKey,
    wireForm(
      eventPlayedRow(record, {
        sortTime: lookups.sortTimeByMatchKey.get(matchKey),
        video: lookups.videoByMatchKey.get(matchKey),
        actualBonusFlags: lookups.actualBonusFlagsByMatchKey.get(matchKey),
      })
    )
  );
  rows.rawPredictions.set(matchKey, record.prediction);
  const unrounded = unroundedRowOf(record);
  rows.unroundedEventRows.set(matchKey, unrounded);
  const roster = [...new Set([...record.match.redTeams, ...record.match.blueTeams])];
  for (const teamKey of roster) {
    rows.teamRows.set(
      `${teamKey}|${matchKey}`,
      wireForm(
        teamSeasonPlayedRow(
          record,
          {
            season: PRICED_SEASON,
            algorithmId: spr.id,
            algorithmVersion,
            sortTime: lookups.sortTimeByMatchKey.get(matchKey),
            video: lookups.videoByMatchKey.get(matchKey),
          },
          lookups.actualBonusFlagsByMatchKey.get(matchKey)
        )
      )
    );
    rows.unroundedTeamRows.set(`${teamKey}|${matchKey}`, unrounded);
    const raw = metricsByTeam?.[teamKey];
    if (raw === undefined) continue;
    const sigma = sigmaByTeam?.get(teamKey);
    const withSigma = sigma === undefined ? raw : { ...raw, [SIGMA_METRIC_KEY]: { value: sigma } };
    rows.rawHistoryMetrics.set(`${teamKey}|${matchKey}`, withSigma);
    rows.historyMetrics.set(`${teamKey}|${matchKey}`, roundMetricsRecord(withSigma));
    rows.unroundedHistory.set(`${teamKey}|${matchKey}`, JSON.parse(JSON.stringify(withSigma)) as Record<string, unknown>);
  }
}

/** Everything one season's shared pass-1 replay produced, plus the per-event captures arm R needs. */
export interface HarnessPass {
  readonly armC: Map<string, ArmRows>;
  readonly armM: Map<string, ArmRows>;
  /** eventKey -> the SPR state immediately before that event's first played match. */
  readonly preEventState: Map<string, SprState>;
  /** eventKey -> the level-2 passengers as of that same instant, deep-copied at capture. */
  readonly preEventPassengers: Map<string, PassengerSnapshot>;
  /** eventKey -> that event's played matches in stream order. */
  readonly eventStream: Map<string, MatchResult[]>;
  /**
   * matchKey -> the SPR state the publisher's own walk-forward called `predict`
   * with, for target-event matches only. This is what makes the INTERLEAVE
   * attribution a MEASUREMENT rather than an inference: with it, the instrument
   * can say which parts of the state arm R got right and which it did not.
   */
  readonly stateBeforeMatch: Map<string, SprState>;
  /** matchKey -> true for a corpus-global cold-start match. */
  readonly coldStartKeys: ReadonlySet<string>;
  readonly lookups: RowLookups;
}

/**
 * The level-2 state `seedStateRows` would ride on a block, captured mid-stream.
 * Typed with the real passenger types rather than `unknown`, so a shape change
 * in any of the four fails this file at compile time instead of silently
 * serializing something else.
 */
export interface PassengerSnapshot {
  readonly sigmaBeliefs: ReadonlyMap<string, SigmaBelief>;
  readonly sigmaPopulation: SigmaPopulation | undefined;
  readonly rpBeliefs: ReadonlyMap<string, RpTeamBeliefs>;
  readonly rpMeanShift: RpMeanShiftState | undefined;
}

/**
 * Runs the publisher's two-pass structure once, driving BOTH the real
 * `SigmaScoutLayer` (arm C) and the `MirrorFold` (arm M) over the same pass-1
 * records. Pass 1 is level-1 only and identical for both arms, so sharing it
 * costs nothing and guarantees the two arms see the same predictions.
 */
export function armHarness(db: Corpus, targetEvents: readonly string[]): HarnessPass {
  const targets = new Set(targetEvents);
  const coldStartKeys = corpusColdStartIndex(db);

  // --- season 2025, warm-up only: we need its carry state, nothing else. ---
  const warmupStream = buildSeasonStream(db, PARITY_SEASONS[0], { includeOffseason: true });
  const warmupRecords = new WalkForwardSimulator(warmupStream, coldStartKeys).runAll(
    [spr],
    teamsForSeason(db, PARITY_SEASONS[0], warmupStream)
  );
  const boundary = seasonBoundaryFor([...PARITY_SEASONS], 1);
  const carried = new Map<string, unknown>();
  const priorState = warmupRecords.carryStates.get(spr.id);
  if (spr.carrySeason && priorState !== undefined) carried.set(spr.id, spr.carrySeason(priorState as SprState, boundary));

  // --- season 2026, the priced season. ---
  const stream = buildSeasonStream(db, PRICED_SEASON, { includeOffseason: true });
  const teamsThisSeason = teamsForSeason(db, PRICED_SEASON, stream);
  const lookups = readRowLookups(db, stream);

  const metricsAfterMatch = new Map<string, Record<string, Record<string, { value: number; spread?: number }>>>();
  const talentAfterMatch = new Map<string, Map<string, number>>();
  const preEventState = new Map<string, SprState>();
  const stateBeforeMatch = new Map<string, SprState>();
  const seenEvents = new Set<string>();
  let lastState: unknown = carried.get(spr.id);

  const onMatchComplete = (match: MatchResult, _algorithmId: string, state: unknown): void => {
    if (!seenEvents.has(match.eventKey)) {
      seenEvents.add(match.eventKey);
      if (targets.has(match.eventKey) && lastState !== undefined) preEventState.set(match.eventKey, lastState as SprState);
    }
    // `lastState` is still the PRE-predict state for this match at this point:
    // `runAll` calls `predict` on it, then `update`, then this hook. Captured
    // before the reassignment below, so it is the state the publisher predicted
    // from, not the state it produced.
    if (targets.has(match.eventKey) && lastState !== undefined) stateBeforeMatch.set(match.matchKey, lastState as SprState);
    lastState = state;
    const involved = [...match.redTeams, ...match.blueTeams];
    const metrics = spr.teamMetrics(state as SprState, involved) as Record<string, Record<string, { value: number; spread?: number }>>;
    metricsAfterMatch.set(match.matchKey, metrics);
    const talent = new Map<string, number>();
    for (const teamKey of involved) {
      const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
      if (total !== undefined) talent.set(teamKey, total);
    }
    talentAfterMatch.set(match.matchKey, talent);
  };

  const records = new WalkForwardSimulator(stream, coldStartKeys).runAll([spr], teamsThisSeason, carried, onMatchComplete);

  // --- pass 2: the chronological fold, both layers side by side. ---
  const ruleModule = RP_RULE_MODULES[PRICED_SEASON];
  const realLayer = new SigmaScoutLayer(ruleModule, spr.id);
  const mirror = new MirrorFold(ruleModule, spr.id);
  const armC = new Map<string, ArmRows>();
  const armM = new Map<string, ArmRows>();
  const preEventPassengers = new Map<string, PassengerSnapshot>();
  const eventStream = new Map<string, MatchResult[]>();
  const foldSeen = new Set<string>();

  for (const r of records) {
    const isTarget = targets.has(r.match.eventKey);
    if (isTarget && !foldSeen.has(r.match.eventKey)) {
      foldSeen.add(r.match.eventKey);
      // Deep-copied at the capture instant. `beliefsByTeam()` on both
      // accumulators already returns copies and `population()`/`toState()`
      // fresh objects, which `measureReplayParity.test.ts` pins rather than
      // assumes — holding a live reference here would silently carry
      // end-of-season values into a pre-event block.
      preEventPassengers.set(r.match.eventKey, {
        sigmaBeliefs: realLayer.sigmaBeliefs(),
        sigmaPopulation: realLayer.sigmaPopulation(),
        rpBeliefs: realLayer.rpVariableBeliefs(),
        rpMeanShift: realLayer.rpMeanShiftState(),
      });
    }
    const talent = talentAfterMatch.get(r.match.matchKey);
    const foldedC: PredictionRecord = {
      ...realLayer.foldPlayed(r.match, r.prediction, talent),
      ...(r.coldStart === true ? { coldStart: true as const } : {}),
    };
    // Arm M uses the SPLIT talent path — `foldPlayed` then `observeTalent` —
    // because that is exactly the path arm R runs. Gating the inline path
    // instead would leave the split one ungated.
    const mirrorOut: FoldOutput = mirror.foldPlayed(r.match, r.prediction);
    mirror.observeTalent(talent);
    const foldedM: PredictionRecord = {
      ...mirrorOut.record,
      ...(r.coldStart === true ? { coldStart: true as const } : {}),
    };
    if (!isTarget) continue;
    const sigmaC = new Map<string, number>();
    const sigmaM = new Map<string, number>();
    for (const teamKey of new Set([...r.match.redTeams, ...r.match.blueTeams])) {
      const sc = realLayer.sigmaFor(teamKey);
      if (sc !== undefined) sigmaC.set(teamKey, sc);
      const sm = mirror.sigmaFor(teamKey);
      if (sm !== undefined) sigmaM.set(teamKey, sm);
    }
    const metrics = metricsAfterMatch.get(r.match.matchKey);
    for (const [map, folded, sigma] of [
      [armC, foldedC, sigmaC],
      [armM, foldedM, sigmaM],
    ] as const) {
      let rows = map.get(r.match.eventKey);
      if (rows === undefined) {
        rows = emptyArmRows();
        map.set(r.match.eventKey, rows);
      }
      addRows(rows, folded, lookups, spr.version, metrics, sigma);
    }
    const list = eventStream.get(r.match.eventKey) ?? [];
    list.push(r.match);
    eventStream.set(r.match.eventKey, list);
  }

  return { armC, armM, preEventState, preEventPassengers, eventStream, stateBeforeMatch, coldStartKeys, lookups };
}

/**
 * `publish.ts`'s own `teamsThisSeason`, reproduced expression for expression:
 * every team on a PLAYED match, then every team on a SCHEDULED one, de-duplicated
 * in that order, with the `frc9970`-`frc9999` demo keys filtered out.
 *
 * This is not cosmetic. `spr.initState(teams)` seeds `state.teams` with a fresh
 * entry PER TEAM, so a team list that differs from the publisher's produces a
 * different initial state. Getting this wrong is invisible on an event with no
 * demo robots and no scheduled-only teams, and wrong on one that has them — which
 * is exactly how `2026auwarp` failed the validity gate on the first three-event
 * run, and exactly what a validity gate is for.
 */
export function teamsForSeason(db: Corpus, season: number, stream: readonly MatchResult[]): string[] {
  const scheduled = selectScheduledMatches(db, { year: season, excludeOffseason: false });
  return Array.from(
    new Set([
      ...stream.flatMap((m) => [...m.redTeams, ...m.blueTeams]),
      ...scheduled.flatMap((m) => [...m.redTeams, ...m.blueTeams]),
    ])
  ).filter((teamKey) => !isDemoTeamKey(teamKey));
}

/** `sortTime`, `video` and the actual per-bonus flags for the priced season, read once, read-only. */
export function readRowLookups(db: Corpus, stream: readonly MatchResult[]): RowLookups {
  const sortTimeByMatchKey = new Map<string, number>();
  const videoByMatchKey = new Map<string, string>();
  const rows = db
    .prepare(
      `select m.match_key, m.sort_time, m.video_key
         from matches m
         join events e on e.event_key = m.event_key
        where e.year = ?`
    )
    .all(PRICED_SEASON) as { match_key: string; sort_time: number; video_key: string | null }[];
  for (const row of rows) {
    // Exactly `publish.ts`'s own `selectScheduledMatchTimes`/`selectMatchVideoKeys`
    // policy: every match gets a time; a match with no video is ABSENT from the
    // map, never present as `null`, because the row builder spreads on presence.
    sortTimeByMatchKey.set(row.match_key, row.sort_time);
    if (row.video_key !== null && row.video_key.length > 0) videoByMatchKey.set(row.match_key, row.video_key);
  }
  return {
    sortTimeByMatchKey,
    videoByMatchKey,
    actualBonusFlagsByMatchKey: actualBonusFlagsForSeason(stream, PRICED_SEASON),
  };
}

// ---------------------------------------------------------------------------
// Arm R — the replay under test
// ---------------------------------------------------------------------------

/**
 * How many of an event's roster teams hold a level-2 belief that the passenger
 * chain CANNOT carry, because SPR has no level-1 team row for them.
 *
 * `withSigmaBeliefs`/`withRpBeliefs` inject into EXISTING team rows only and
 * silently return the row unchanged when there is none, so such a belief is
 * dropped with no error on either side. Demo robots are exactly that case:
 * `publish.ts` excludes the `frc9970`-`frc9999` keys from `teamsThisSeason`, so
 * `spr.initState` never seeds them and `remapDemoTeams` folds them into
 * `DEMO_PSEUDO_TEAM_KEY` — but the Sigma accumulator keeps a belief under each
 * RAW key. Measured rather than asserted, so the claim has a number behind it.
 */
export function droppedPassengers(rows: readonly StateRow[], passengers: PassengerSnapshot, rosterKeys: ReadonlySet<string>): {
  sigmaDropped: string[];
  rpDropped: string[];
} {
  const teamRowKeys = new Set(rows.filter((row) => row.scopeKind === "team").map((row) => row.scopeKey));
  const sigmaDropped: string[] = [];
  const rpDropped: string[] = [];
  for (const teamKey of rosterKeys) {
    if (teamRowKeys.has(teamKey)) continue;
    if (passengers.sigmaBeliefs.has(teamKey)) sigmaDropped.push(teamKey);
    if (passengers.rpBeliefs.has(teamKey)) rpDropped.push(teamKey);
  }
  return { sigmaDropped: sigmaDropped.sort(), rpDropped: rpDropped.sort() };
}

/** The `seedStateRows` chain, reproduced from a captured snapshot rather than from a live layer. */
export function passengerRows(state: SprState, passengers: PassengerSnapshot): StateRow[] {
  const stamp = { generation: PARITY_GENERATION, computedAt: PARITY_COMPUTED_AT };
  let rows = withRpBeliefs(
    withSigmaBeliefs(serializeState(spr.id, spr.version, state, stamp), passengers.sigmaBeliefs),
    passengers.rpBeliefs
  );
  if (passengers.sigmaPopulation !== undefined) rows = withSigmaPopulation(rows, passengers.sigmaPopulation);
  if (passengers.rpMeanShift !== undefined) rows = withRpMeanShift(rows, passengers.rpMeanShift);
  return rows;
}

export interface ReplayOptions {
  /** `true` sends the state through `buildEventStateBlock` + `JSON.stringify`/`parse` + `EventStateBlockSchema.parse` (arm R); `false` hands the in-process rows straight over (arm R'). */
  readonly throughWire: boolean;
}

/**
 * Folds ONE event's own matches from a pre-event state, predict before update,
 * per match, no exceptions. This is the browser-safe path a relay would run.
 */
/** One match's view of the state arm R predicted from, for the league-drift diagnostic. */
export interface LeagueTraceEntry {
  readonly matchKey: string;
  readonly scale: number;
  readonly scaleCount: number;
  readonly logTau: number;
  /** The involved teams' per-team filter state, so "league-scoped only" can be shown rather than assumed. */
  readonly teams: Record<string, { muL: number; pL: number; muS: number; pS: number }>;
}

export interface ReplayResult {
  readonly rows: ArmRows;
  readonly leagueTrace: LeagueTraceEntry[];
}

export function armReplay(
  state: SprState,
  passengers: PassengerSnapshot,
  matches: readonly MatchResult[],
  coldStartKeys: ReadonlySet<string>,
  lookups: RowLookups,
  options: ReplayOptions
): ReplayResult {
  const rosterKeys = new Set(matches.flatMap((m) => [...m.redTeams, ...m.blueTeams]));
  const builtRows = passengerRows(state, passengers);
  let rows: readonly StateRow[];
  if (options.throughWire) {
    const block = buildEventStateBlock(builtRows, rosterKeys);
    // The wire, exactly as `eventStatePricing.parity.test.ts` sends it.
    const parsed = EventStateBlockSchema.parse(JSON.parse(JSON.stringify(block)));
    rows = parsed.rows;
  } else {
    rows = builtRows;
  }

  const mirror = MirrorFold.fromRows(RP_RULE_MODULES[PRICED_SEASON], spr.id, rows);
  let live = mirror.deserializedState(rows);
  const out = emptyArmRows();
  const leagueTrace: LeagueTraceEntry[] = [];

  for (const match of matches) {
    leagueTrace.push(traceOf(match, live));
    // PREDICT BEFORE UPDATE.
    const raw = spr.predict(live, toLeakProofUpcoming(match));
    const prediction = coldStartKeys.has(match.matchKey) ? applyColdStartTie(raw) : raw;
    const folded = mirror.foldPlayed(match, prediction);
    const next = spr.update(live, match);
    const involved = [...match.redTeams, ...match.blueTeams];
    const metrics = spr.teamMetrics(next, involved) as Record<string, Record<string, { value: number; spread?: number }>>;
    // Talent after the fold, from post-update state: applying it before would
    // let a match inform its own prior. Same ordering the publisher uses, just
    // with the metrics computed here instead of handed over from pass 1.
    const talent = new Map<string, number>();
    for (const teamKey of involved) {
      const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
      if (total !== undefined) talent.set(teamKey, total);
    }
    mirror.observeTalent(talent);
    const sigma = new Map<string, number>();
    for (const teamKey of new Set(involved)) {
      const s = mirror.sigmaFor(teamKey);
      if (s !== undefined) sigma.set(teamKey, s);
    }
    const record: PredictionRecord = {
      ...folded.record,
      ...(coldStartKeys.has(match.matchKey) ? { coldStart: true as const } : {}),
    };
    addRows(out, record, lookups, spr.version, metrics, sigma);
    live = next;
  }
  return { rows: out, leagueTrace };
}

/** The league-scoped scalars and the involved teams' filters, as of one instant. */
export function traceOf(match: MatchResult, state: SprState): LeagueTraceEntry {
  const teams: Record<string, { muL: number; pL: number; muS: number; pS: number }> = {};
  for (const teamKey of new Set([...match.redTeams, ...match.blueTeams])) {
    const t = state.teams.get(teamKey);
    if (t !== undefined) teams[teamKey] = { muL: t.muL, pL: t.pL, muS: t.muS, pS: t.pS };
  }
  return { matchKey: match.matchKey, scale: state.scale, scaleCount: state.scaleCount, logTau: state.logTau, teams };
}

/** Per-match drift of the state arm R predicted from against the state the publisher predicted from. */
export interface LeagueDrift {
  readonly matchKey: string;
  readonly scaleRelative: number;
  readonly logTauAbsolute: number;
  readonly scaleCountDelta: number;
  /** Largest absolute difference in any involved team's four filter numbers; 0 means the per-team state is bit-identical. */
  readonly maxTeamStateDiff: number;
}

/**
 * THE DECISIVE DIAGNOSTIC. If every per-team number agrees at every match while
 * `scale` and `logTau` drift, the cause is not a lossy wire and not a bug — it
 * is that the league-scoped quantities stepped on other events' matches, which
 * a one-event replay structurally cannot see. That is the difference between
 * measuring INTERLEAVE and merely labelling a residual with it.
 */
export function compareLeague(trace: readonly LeagueTraceEntry[], truthStates: ReadonlyMap<string, SprState>, matches: readonly MatchResult[]): LeagueDrift[] {
  const byKey = new Map(matches.map((m) => [m.matchKey, m]));
  const out: LeagueDrift[] = [];
  for (const entry of trace) {
    const truth = truthStates.get(entry.matchKey);
    const match = byKey.get(entry.matchKey);
    if (truth === undefined || match === undefined) continue;
    const truthTrace = traceOf(match, truth);
    let maxTeamStateDiff = 0;
    for (const [teamKey, t] of Object.entries(truthTrace.teams)) {
      const r = entry.teams[teamKey];
      if (r === undefined) {
        maxTeamStateDiff = Number.POSITIVE_INFINITY;
        continue;
      }
      for (const field of ["muL", "pL", "muS", "pS"] as const) {
        const d = Math.abs(t[field] - r[field]);
        if (d > maxTeamStateDiff) maxTeamStateDiff = d;
      }
    }
    out.push({
      matchKey: entry.matchKey,
      scaleRelative: truth.scale === 0 ? Number.NaN : (entry.scale - truth.scale) / truth.scale,
      logTauAbsolute: entry.logTau - truth.logTau,
      scaleCountDelta: entry.scaleCount - truth.scaleCount,
      maxTeamStateDiff,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

export interface FieldResult {
  readonly field: string;
  readonly surface: "event" | "team" | "history";
  readonly identical: boolean;
  readonly comparedRows: number;
  /**
   * How many of the compared rows actually CARRY this key in the published
   * body. Zero means the surface never publishes the field at all, so
   * "identical" is vacuously true and says nothing — the case that would
   * otherwise let an RP-ineligible event show green RP columns and imply RP had
   * been tested there.
   */
  readonly presentRows: number;
  /** `presentRows === 0`: the field was not tested here, whatever `identical` says. */
  readonly vacuous: boolean;
  /**
   * Whether the CHRONOLOGICALLY FIRST compared row already differs. At match 1
   * no other event's match has been replayed yet, so this separates "the block
   * did not carry it" from "it drifted" without a further arm.
   */
  readonly differsAtFirstRow: boolean;
  readonly differingRows: number;
  readonly firstDivergingKey?: string;
  /** Largest absolute difference on the ROUNDED published values. */
  readonly maxRoundedDiff?: number;
  /** Largest absolute difference on the UNROUNDED intermediates, when both arms produced them. */
  readonly maxUnroundedDiff?: number;
  /** `true` when the difference is visible after `ROUNDING_RULE` — i.e. it reaches the published number. */
  readonly survivesRounding: boolean;
  /** How close the closest ABSORBED value came to flipping its published digit. */
  readonly minRoundingHeadroom?: number;
  readonly attribution?: Attribution;
  /** The per-match trajectory of the first diverging field: unrounded |R − C| at match 1, 2, ... */
  readonly trajectory?: number[];
}

/**
 * The order rows are walked in, and it matters: `firstDivergingKey` is only
 * meaningful CHRONOLOGICALLY. A plain string sort puts `..._f1m1` (the finals,
 * played last) before `..._qm10`, which would report the LAST match of an event
 * as the first divergence and invert the WIRE-versus-INTERLEAVE reading
 * entirely. Keys are therefore ordered by the match's own `sortTime`, with the
 * key as a tiebreak, and a row whose match has no time sorts last rather than
 * first.
 */
function chronologicalKeys(keys: Iterable<string>, sortTimeByMatchKey: ReadonlyMap<string, number>): string[] {
  const matchKeyOf = (key: string): string => {
    const parts = key.split("|");
    // `matchKey` for an event row; `teamKey|matchKey` or `teamKey|matchKey|metricKey` otherwise.
    return parts.length === 1 ? parts[0]! : parts[1]!;
  };
  return [...keys].sort((a, b) => {
    const ta = sortTimeByMatchKey.get(matchKeyOf(a)) ?? Number.POSITIVE_INFINITY;
    const tb = sortTimeByMatchKey.get(matchKeyOf(b)) ?? Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

interface UnroundedContext {
  /** The arm's own unrounded rows, under the same keys. */
  readonly arm: ReadonlyMap<string, Record<string, unknown>>;
  /** The reference arm's unrounded rows — arm C in a real run, the only place an unrounded ground truth exists, since the published body carries rounded numbers only. */
  readonly reference: ReadonlyMap<string, Record<string, unknown>>;
  readonly sortTimeByMatchKey: ReadonlyMap<string, number>;
}

function compareSurface(
  surface: "event" | "team" | "history",
  fields: readonly string[],
  truth: ReadonlyMap<string, Record<string, unknown>>,
  arm: ReadonlyMap<string, Record<string, unknown>>,
  unroundedContext: UnroundedContext
): FieldResult[] {
  const sortTimeByMatchKey = unroundedContext.sortTimeByMatchKey;
  const keys = chronologicalKeys(truth.keys(), sortTimeByMatchKey);
  return fields.map((field) => {
    let differingRows = 0;
    let comparedRows = 0;
    let presentRows = 0;
    let differsAtFirstRow = false;
    let seenFirstComparableRow = false;
    let firstDivergingKey: string | undefined;
    let maxRoundedDiff: number | undefined;
    let maxUnroundedDiff: number | undefined;
    let minRoundingHeadroom: number | undefined;
    const decimals = decimalsForField(field);
    // The trajectory is taken over the UNROUNDED arm-versus-reference values in
    // chronological order: present at match 1 and flat reads as WIRE, starting
    // near zero and growing reads as INTERLEAVE, with no second arm needed.
    const trajectory: number[] = [];
    for (const key of keys) {
      const truthRow = truth.get(key);
      const armRow = arm.get(key);
      if (truthRow === undefined) continue;
      comparedRows++;
      if (Object.prototype.hasOwnProperty.call(truthRow, field)) presentRows++;
      const referenceRow = unroundedContext.reference.get(key);
      const armUnroundedRow = unroundedContext.arm.get(key);
      if (referenceRow !== undefined && armUnroundedRow !== undefined) {
        const unrounded = maxAbsDiff(referenceRow[field], armUnroundedRow[field]);
        if (unrounded !== undefined) {
          trajectory.push(unrounded);
          if (maxUnroundedDiff === undefined || unrounded > maxUnroundedDiff) maxUnroundedDiff = unrounded;
        }
      }
      const rowDiffers = armRow === undefined || !fieldsEqual(truthRow, armRow, field);
      if (!seenFirstComparableRow && Object.prototype.hasOwnProperty.call(truthRow, field)) {
        seenFirstComparableRow = true;
        differsAtFirstRow = rowDiffers;
      }
      if (rowDiffers) {
        differingRows++;
        firstDivergingKey ??= key;
        const d = armRow === undefined ? undefined : maxAbsDiff(truthRow[field], armRow[field]);
        if (d !== undefined && (maxRoundedDiff === undefined || d > maxRoundedDiff)) maxRoundedDiff = d;
      } else if (
        decimals !== undefined &&
        referenceRow !== undefined &&
        armUnroundedRow !== undefined &&
        Object.prototype.hasOwnProperty.call(truthRow, field)
      ) {
        // An ABSORBED difference: the unrounded values moved but the published
        // digit did not. How close it came to flipping is the honest measure of
        // how much the absorption can be relied on.
        const unrounded = maxAbsDiff(referenceRow[field], armUnroundedRow[field]);
        if (unrounded !== undefined && unrounded > 0) {
          const headroom = minHeadroomOf(armUnroundedRow[field], decimals);
          if (headroom !== undefined && (minRoundingHeadroom === undefined || headroom < minRoundingHeadroom)) {
            minRoundingHeadroom = headroom;
          }
        }
      }
    }
    return {
      field,
      surface,
      identical: differingRows === 0,
      comparedRows,
      presentRows,
      vacuous: presentRows === 0,
      differsAtFirstRow,
      differingRows,
      ...(firstDivergingKey !== undefined ? { firstDivergingKey } : {}),
      ...(maxRoundedDiff !== undefined ? { maxRoundedDiff } : {}),
      ...(maxUnroundedDiff !== undefined ? { maxUnroundedDiff } : {}),
      ...(minRoundingHeadroom !== undefined ? { minRoundingHeadroom } : {}),
      ...(trajectory.length > 0 ? { trajectory: trajectory.slice(0, 40) } : {}),
      survivesRounding: differingRows > 0,
    };
  });
}

/** History rows compare the metric record's inner `value`/`spread`, per metric key, never `percentile`. */
function flattenHistory(metrics: ReadonlyMap<string, Record<string, unknown>>): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const [rowKey, record] of metrics) {
    for (const [metricKey, entry] of Object.entries(record)) {
      const e = entry as Record<string, unknown>;
      const flat: Record<string, unknown> = {};
      for (const f of HISTORY_VALUE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(e, f)) flat[f] = e[f];
      }
      out.set(`${rowKey}|${metricKey}`, flat);
    }
  }
  return out;
}

export interface EventComparison {
  readonly eventKey: string;
  readonly playedMatches: number;
  readonly rosterTeams: number;
  readonly rpEligible: boolean;
  readonly gate: { armCExact: boolean; armMExact: boolean; passed: boolean; armCFailures: string[]; armMFailures: string[] };
  readonly armR: FieldResult[];
  readonly armRPrime: FieldResult[];
  /** The league-drift diagnostic: what arm R got right about the state, and what it could not. */
  readonly leagueDrift: LeagueDrift[];
  /** Roster teams whose level-2 beliefs the passenger chain could not carry, because SPR has no team row for them. */
  readonly droppedPassengers?: { sigmaDropped: string[]; rpDropped: string[] };
  readonly leagueDriftSummary?: {
    readonly matches: number;
    readonly perTeamStateExact: boolean;
    readonly maxTeamStateDiff: number;
    readonly firstScaleDriftMatchKey?: string;
    readonly scaleRelativeAtFirstMatch: number;
    readonly scaleRelativeAtLastMatch: number;
    readonly maxAbsScaleRelative: number;
    readonly logTauAbsoluteAtLastMatch: number;
    readonly maxAbsLogTau: number;
    readonly scaleCountDeltaAtLastMatch: number;
  };
}

export function summariseDrift(drift: readonly LeagueDrift[]): NonNullable<EventComparison["leagueDriftSummary"]> {
  const first = drift[0]!;
  const last = drift[drift.length - 1]!;
  const maxTeamStateDiff = Math.max(...drift.map((d) => d.maxTeamStateDiff));
  const firstScaleDrift = drift.find((d) => d.scaleRelative !== 0);
  return {
    matches: drift.length,
    perTeamStateExact: maxTeamStateDiff === 0,
    maxTeamStateDiff,
    ...(firstScaleDrift !== undefined ? { firstScaleDriftMatchKey: firstScaleDrift.matchKey } : {}),
    scaleRelativeAtFirstMatch: first.scaleRelative,
    scaleRelativeAtLastMatch: last.scaleRelative,
    maxAbsScaleRelative: Math.max(...drift.map((d) => Math.abs(d.scaleRelative))),
    logTauAbsoluteAtLastMatch: last.logTauAbsolute,
    maxAbsLogTau: Math.max(...drift.map((d) => Math.abs(d.logTauAbsolute))),
    scaleCountDeltaAtLastMatch: last.scaleCountDelta,
  };
}

function failuresOf(results: readonly FieldResult[]): string[] {
  return results.filter((r) => !r.identical).map((r) => `${r.surface}.${r.field} (${r.differingRows}/${r.comparedRows})`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseEventsArg(value: string | undefined): string[] {
  if (value === undefined || value.trim().length === 0) return ["2026nyro"];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Read-only: the union of every team on the target events' played matches. */
function rosterTeamsFor(db: Corpus, targetEvents: readonly string[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const stream = selectMatchesChronological(db, { year: PRICED_SEASON, excludeOffseason: false });
  for (const match of stream) {
    if (!targetEvents.includes(match.eventKey)) continue;
    const set = out.get(match.eventKey) ?? new Set<string>();
    for (const teamKey of [...match.redTeams, ...match.blueTeams]) set.add(teamKey);
    out.set(match.eventKey, set);
  }
  return out;
}

async function main(argv: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...argv],
    options: { events: { type: "string" } },
    allowPositionals: false,
  });
  const targetEvents = parseEventsArg(values.events);
  console.log(`replay-parity: events ${targetEvents.join(", ")}`);

  const db = openCorpusReadOnly(CORPUS_PATH);
  let report: unknown;
  try {
    const rosters = rosterTeamsFor(db, targetEvents);
    const allRosterTeams = new Set<string>();
    for (const set of rosters.values()) for (const teamKey of set) allRosterTeams.add(teamKey);
    console.log(`replay-parity: ${allRosterTeams.size} roster teams across ${rosters.size} events`);

    console.log("replay-parity: arm P — running the real publisher (dry run, no network)...");
    const published = await armPublished(db, targetEvents, allRosterTeams);

    console.log("replay-parity: arms C and M — reproducing the two-pass structure...");
    const harness = armHarness(db, targetEvents);

    const comparisons: EventComparison[] = [];
    for (const eventKey of targetEvents) {
      const truth = truthRowsFor(published, eventKey);
      const c = harness.armC.get(eventKey) ?? emptyArmRows();
      const m = harness.armM.get(eventKey) ?? emptyArmRows();
      const state = harness.preEventState.get(eventKey);
      const passengers = harness.preEventPassengers.get(eventKey);
      const matches = harness.eventStream.get(eventKey) ?? [];

      const gateC = compareAll(truth, c, c, harness.lookups.sortTimeByMatchKey);
      const gateM = compareAll(truth, m, c, harness.lookups.sortTimeByMatchKey);
      const armCExact = gateC.every((r) => r.identical);
      const armMExact = gateM.every((r) => r.identical);

      let armR: FieldResult[] = [];
      let armRPrime: FieldResult[] = [];
      let leagueDrift: LeagueDrift[] = [];
      let dropped: { sigmaDropped: string[]; rpDropped: string[] } | undefined;
      if (state !== undefined && passengers !== undefined) {
        const r = armReplay(state, passengers, matches, harness.coldStartKeys, harness.lookups, { throughWire: true });
        armR = compareAll(truth, r.rows, c, harness.lookups.sortTimeByMatchKey);
        leagueDrift = compareLeague(r.leagueTrace, harness.stateBeforeMatch, matches);
        dropped = droppedPassengers(
          passengerRows(state, passengers),
          passengers,
          new Set(matches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))
        );
        if (armR.some((x) => !x.identical)) {
          const rp = armReplay(state, passengers, matches, harness.coldStartKeys, harness.lookups, { throughWire: false });
          armRPrime = compareAll(truth, rp.rows, c, harness.lookups.sortTimeByMatchKey);
        }
        // Attribution, applied only to fields that actually differ.
        const primeFailing = new Set(armRPrime.filter((x) => !x.identical).map((x) => `${x.surface}.${x.field}`));
        armR = armR.map((x) =>
          x.identical
            ? x
            : {
                ...x,
                attribution: attributeField(x.field, armRPrime.length === 0 || primeFailing.has(`${x.surface}.${x.field}`), x.differsAtFirstRow),
              }
        );
      }

      comparisons.push({
        eventKey,
        playedMatches: matches.length,
        rosterTeams: rosters.get(eventKey)?.size ?? 0,
        rpEligible: truth.event.size > 0 && [...truth.event.values()].some((row) => row.redRpPmf !== undefined),
        gate: {
          armCExact,
          armMExact,
          passed: armCExact && armMExact,
          armCFailures: failuresOf(gateC),
          armMFailures: failuresOf(gateM),
        },
        armR,
        armRPrime,
        leagueDrift,
        ...(dropped !== undefined ? { droppedPassengers: dropped } : {}),
        ...(leagueDrift.length > 0 ? { leagueDriftSummary: summariseDrift(leagueDrift) } : {}),
      });
      printEvent(comparisons[comparisons.length - 1]!);
    }

    report = { generation: PARITY_GENERATION, computedAt: PARITY_COMPUTED_AT, seasons: PARITY_SEASONS, comparisons };
  } finally {
    db.close();
  }

  mkdirSync(REPORT_DIR, { recursive: true });
  const path = join(REPORT_DIR, `replay-parity-${targetEvents.join("_")}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`replay-parity: report written to ${path}`);
}

/** The published rows, split by surface, for one event. */
export interface TruthRows {
  readonly event: Map<string, Record<string, unknown>>;
  readonly team: Map<string, Record<string, unknown>>;
  readonly history: Map<string, Record<string, unknown>>;
}

export function truthRowsFor(published: PublishedBodies, eventKey: string): TruthRows {
  const event = new Map<string, Record<string, unknown>>();
  const team = new Map<string, Record<string, unknown>>();
  const history = new Map<string, Record<string, unknown>>();
  const body = published.events.get(eventKey);
  if (body !== undefined) {
    const parsed = JSON.parse(body) as { matches?: Record<string, unknown>[] };
    for (const row of parsed.matches ?? []) event.set(row.matchKey as string, row);
  }
  for (const [teamKey, teamBody] of published.teams) {
    const parsed = JSON.parse(teamBody) as {
      events?: { eventKey: string; matches: Record<string, unknown>[] }[];
      metricHistory?: Record<string, unknown>[];
    };
    for (const e of parsed.events ?? []) {
      if (e.eventKey !== eventKey) continue;
      for (const row of e.matches) {
        if (row.actualWinner === undefined) continue; // upcoming rows are not this comparison's business
        team.set(`${teamKey}|${row.matchKey as string}`, row);
      }
    }
    for (const row of parsed.metricHistory ?? []) {
      if (row.eventKey !== eventKey) continue;
      history.set(`${teamKey}|${row.matchKey as string}`, row.metrics as Record<string, unknown>);
    }
  }
  return { event, team, history };
}

/**
 * `reference` is the arm whose UNROUNDED values the magnitude and trajectory are
 * taken against — arm C in a real run, since arm C is proven equal to the
 * published rows and is the only place an unrounded ground truth exists (the
 * published body carries rounded numbers only). Pass the arm itself for a
 * self-comparison in tests.
 */
export function compareAll(truth: TruthRows, arm: ArmRows, reference: ArmRows = arm, sortTimeByMatchKey: ReadonlyMap<string, number> = new Map()): FieldResult[] {
  return [
    ...compareSurface("event", EVENT_ROW_FIELDS, truth.event, arm.eventRows, {
      arm: arm.unroundedEventRows,
      reference: reference.unroundedEventRows,
      sortTimeByMatchKey,
    }),
    ...compareSurface("team", TEAM_ROW_FIELDS, truth.team, arm.teamRows, {
      arm: arm.unroundedTeamRows,
      reference: reference.unroundedTeamRows,
      sortTimeByMatchKey,
    }),
    ...compareSurface("history", HISTORY_VALUE_FIELDS, flattenHistory(truth.history), flattenHistory(arm.historyMetrics), {
      arm: flattenHistory(arm.unroundedHistory),
      reference: flattenHistory(reference.unroundedHistory),
      sortTimeByMatchKey,
    }),
  ];
}

function printEvent(c: EventComparison): void {
  console.log(`\n=== ${c.eventKey} — ${c.playedMatches} played, ${c.rosterTeams} roster teams, RP ${c.rpEligible ? "eligible" : "INELIGIBLE (RP comparison is vacuous here)"} ===`);
  console.log(`  VALIDITY GATE: arm C ${c.gate.armCExact ? "EXACT" : "NOT EXACT"}, arm M ${c.gate.armMExact ? "EXACT" : "NOT EXACT"} -> ${c.gate.passed ? "PASSED" : "FAILED — pass DISCARDED, not interpreted"}`);
  if (!c.gate.armCExact) console.log(`    arm C failures: ${c.gate.armCFailures.join(", ") || "(none listed)"}`);
  if (!c.gate.armMExact) console.log(`    arm M failures: ${c.gate.armMFailures.join(", ") || "(none listed)"}`);
  const failing = c.armR.filter((r) => !r.identical);
  const tested = c.armR.filter((r) => !r.vacuous);
  console.log(
    `  arm R: ${tested.length - failing.length}/${tested.length} TESTED fields exactly equal ` +
      `(${c.armR.length - tested.length} further fields are not published on these rows at all)`
  );
  for (const f of failing) {
    console.log(
      `    ${f.surface}.${f.field}: ${f.differingRows}/${f.comparedRows} rows differ, ` +
        `maxRounded=${fmt(f.maxRoundedDiff)}, maxUnrounded=${fmt(f.maxUnroundedDiff)}, ` +
        `first(chrono)=${f.firstDivergingKey ?? "n/a"}, attribution=${f.attribution ?? "?"}`
    );
  }
  const vacuous = c.armR.filter((r) => r.vacuous);
  if (vacuous.length > 0) {
    console.log(`  NOT TESTED HERE (the published rows carry no such key, so "identical" is vacuous): ${vacuous.map((r) => `${r.surface}.${r.field}`).join(", ")}`);
  }
  const absorbed = c.armR.filter((r) => r.identical && !r.vacuous && r.maxUnroundedDiff !== undefined && r.maxUnroundedDiff > 0);
  if (absorbed.length > 0) {
    console.log(`  ABSORBED BY ROUNDING (unrounded values moved, the published digit did not):`);
    for (const f of absorbed) {
      console.log(
        `    ${f.surface}.${f.field}: maxUnrounded=${fmt(f.maxUnroundedDiff)}, closest to flipping by ${fmt(f.minRoundingHeadroom)} of the last published place`
      );
    }
  }
  const dp = c.droppedPassengers;
  if (dp !== undefined && (dp.sigmaDropped.length > 0 || dp.rpDropped.length > 0)) {
    console.log(
      `  PASSENGERS DROPPED BY THE CHAIN (a belief exists offline but has no SPR team row to ride on): ` +
        `${dp.sigmaDropped.length} Sigma, ${dp.rpDropped.length} RP` +
        (dp.sigmaDropped.length > 0 ? ` — e.g. ${dp.sigmaDropped.slice(0, 4).join(", ")}` : "")
    );
  }
  const d = c.leagueDriftSummary;
  if (d !== undefined) {
    console.log(`  LEAGUE DRIFT over ${d.matches} matches:`);
    console.log(`    per-team filter state exact at every match: ${d.perTeamStateExact} (max |diff| ${d.maxTeamStateDiff})`);
    console.log(`    scale: first match ${(d.scaleRelativeAtFirstMatch * 100).toFixed(4)}%, last match ${(d.scaleRelativeAtLastMatch * 100).toFixed(2)}%, worst ${(d.maxAbsScaleRelative * 100).toFixed(2)}%`);
    console.log(`    logTau: last match ${d.logTauAbsoluteAtLastMatch.toExponential(3)}, worst ${d.maxAbsLogTau.toExponential(3)}`);
    console.log(`    scaleCount short by ${-d.scaleCountDeltaAtLastMatch} observations at the last match; first scale drift at ${d.firstScaleDriftMatchKey ?? "never"}`);
  }
  const trajectoryField = c.armR.find((r) => !r.identical && r.trajectory !== undefined && r.surface === "event");
  if (trajectoryField?.trajectory !== undefined) {
    console.log(`  TRAJECTORY of event.${trajectoryField.field} (unrounded |R - C|, chronological, first 12):`);
    console.log(`    ${trajectoryField.trajectory.slice(0, 12).map((v) => v.toExponential(2)).join("  ")}`);
  }
}

function fmt(value: number | undefined): string {
  if (value === undefined) return "n/a";
  if (value === 0) return "0";
  return Math.abs(value) < 1e-3 || Math.abs(value) >= 1e6 ? value.toExponential(3) : value.toPrecision(6);
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  void main(process.argv.slice(2));
}
