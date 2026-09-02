/**
 * D-02's control run (08-CONTEXT.md): measures the rewind-overconfidence
 * gap D-01's "rewind into an already-played match" mechanism costs.
 *
 * THE TWO PREDICTION SETS, PRECISELY. The *stored* set is what the harness
 * already produces and what 08-02/08-05 publish onto played matches: each
 * match's own as-of-that-match prediction — for a rewound start match, this
 * has already absorbed results the simulation is pretending have not
 * happened. The *frozen* set is every remaining match predicted from ONE
 * state captured immediately before the chosen start match, with no
 * fold-in of any result between predictions. The frozen arm is not an
 * approximation of the honest from-here forecast — it IS the honest
 * from-here forecast: `packages/harness/publish.ts`'s scheduled-match
 * builder (`buildEventArtifact`'s `upcoming` path, fed by a single shared
 * per-algorithm `state`) predicts every scheduled match from one common
 * state, so a captured pre-start-match state is exactly what the live path
 * would use if these matches were genuinely unplayed (08-CONTEXT D-01,
 * "the live case is exact and needs nothing").
 *
 * Both arms pass through the SAME imported `simulateRanks`
 * (`packages/core/algorithms/simulation/rankSimulation.ts`, 08-03) and the
 * SAME imported `continuousQuantile` (`apps/web/src/lib/simQuantile.ts`,
 * 08-04) — never reimplemented, wrapped, or approximated here. A second
 * copy of either would make the measured gap describe the difference
 * between two implementations rather than between two prediction sets,
 * while every test on both sides of that split copy would still pass. This
 * is the exact property 08-03's module was placed under `packages/core/`
 * to guarantee, and this script is its first real test.
 *
 * The output is the trigger 08-CONTEXT.md's `<deferred>` section names for
 * revisiting the "sidecar checkpoint simulation artifact" idea: "D-02's
 * output is the trigger for revisiting this."
 *
 * This script reads the corpus READ-ONLY and touches NO credential of any
 * kind: no network request, no R2 client, no environment variable, and its
 * `package.json` entry deliberately omits the environment-file flag,
 * placing it with `tune`, `promote`, `fingerprint` and `identifiability` —
 * the corpus-only offline scripts — rather than with the credentialed
 * ones. `.env` is never read, printed, copied or interpolated.
 *
 * Standalone-script shape matching `scripts/replayRig.ts`: a long
 * explanatory header, `parseArgs`, `async function main()`, an entry-point
 * guard, deep relative imports with explicit `.js` suffixes.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import type { MatchResult, Prediction, SeasonBoundary } from "../packages/core/algorithms/types.js";
import type { PredictionRecord } from "../packages/harness/replay.js";
import {
  simulateRanks,
  mulberry32,
  type SimMatchInput,
  type SimTeamBaseline,
  type SimResult,
} from "../packages/core/algorithms/simulation/rankSimulation.js";
import { continuousQuantile } from "../apps/web/src/lib/simQuantile.js";
import { openCorpusReadOnly, selectMatchesChronological, type Corpus } from "../packages/corpus/db.js";
import { WalkForwardSimulator, toLeakProofUpcoming, buildSeasonStream } from "../packages/harness/replay.js";
import { applyPromotedOverrides } from "../packages/harness/cli.js";
import { vpr } from "../packages/core/algorithms/sigma1/index.js";
import { SIGMA1_CODE_VERSION } from "../packages/core/algorithms/sigma1/params.js";
import { COLD_START_SEASON } from "../packages/core/algorithms/breakdown/index.js";

// ---------------------------------------------------------------------------
// Constants (Task 1)
// ---------------------------------------------------------------------------

/** D-02: "roughly 5 events." All five verified against `data/corpus.sqlite` when this plan was written — see 08-08-PLAN.md's `<measured_ground_truth>` table. The driver re-asserts each event's qual count and roster size at run time, so a corpus re-ingest that changed one of these is loud rather than silently producing a different number under the same doc. */
export const DEFAULT_TARGET_EVENTS: readonly TargetEvent[] = [
  { eventKey: "2022tuis3", season: 2022, expectedQuals: 57, expectedRoster: 31 },
  { eventKey: "2023ctwat", season: 2023, expectedQuals: 76, expectedRoster: 38 },
  { eventKey: "2024nysu", season: 2024, expectedQuals: 80, expectedRoster: 48 },
  { eventKey: "2025cur", season: 2025, expectedQuals: 127, expectedRoster: 76 },
  { eventKey: "2026sccmp", season: 2026, expectedQuals: 62, expectedRoster: 31 },
];

/** Three start points per event (Decision 1, 08-08-PLAN.md) — the full rewind (fraction 1) is deliberately NOT included; D-01's caption fires at any already-played start match, so sampling across the event's own length (not just its worst case) gives the shape, not just one extreme. */
export const START_POINT_FRACTIONS = [0, 1 / 3, 2 / 3] as const;

/** SC-1: the same draw count the browser Worker runs. */
export const DEFAULT_DRAWS = 1000;

export const DEFAULT_SEED = 20260830;

/** Decision 3, 08-08-PLAN.md: the noise-floor control re-simulates the SAME stored predictions under a fresh seed offset from the primary one — this offset must never equal 0. */
export const NOISE_CONTROL_SEED_OFFSET = 1;

export const REWIND_GAP_DOC_PATH = join("docs", "models", "rewind-overconfidence-gap.md");

/** Mirrors `packages/harness/payloadBudget.test.ts`'s `BUDGET_BLOCK_PATTERN` shape exactly, including its `\r?\n` tolerance for the fence's surrounding newlines. */
export const REWIND_GAP_BLOCK_PATTERN = /```json rewind-gap\r?\n([\s\S]*?)\r?\n```/;

// ---------------------------------------------------------------------------
// Types (Task 1)
// ---------------------------------------------------------------------------

export interface TargetEvent {
  readonly eventKey: string;
  readonly season: number;
  readonly expectedQuals: number;
  readonly expectedRoster: number;
}

export interface StartPointResult {
  readonly startIndex: number;
  readonly startMatchKey: string;
  readonly remainingMatchCount: number;
  readonly excludedMatchCount: number;
  readonly teamCount: number;
  readonly frozenMeanBandWidth: number;
  readonly storedMeanBandWidth: number;
  readonly narrowingPercent: number;
  readonly noiseFloorPercent: number;
}

export interface EventResult {
  readonly eventKey: string;
  readonly season: number;
  readonly qualCount: number;
  readonly rosterSize: number;
  readonly startPoints: readonly StartPointResult[];
}

export interface RewindGapHeadline {
  readonly meanNarrowingPercent: number;
  readonly minNarrowingPercent: number;
  readonly maxNarrowingPercent: number;
  readonly meanNoiseFloorPercent: number;
  readonly measurementCount: number;
  readonly eventCount: number;
  readonly excludedMatchCount: number;
  readonly incompleteBaselineTeamCount: number;
  readonly verdict: "narrower" | "wider" | "indistinguishable";
}

export interface RewindGapMeasurement {
  readonly measuredAt: string;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  readonly corpusIdentity: string;
  readonly corpusMatchCount: number;
  readonly draws: number;
  readonly seed: number;
  readonly events: readonly EventResult[];
  readonly headline: RewindGapHeadline;
}

export interface BaselineBuildResult {
  readonly baselines: readonly SimTeamBaseline[];
  readonly incompleteTeamKeys: readonly string[];
}

export interface SimInputBuildResult {
  readonly inputs: readonly SimMatchInput[];
  readonly excludedMatchKeys: readonly string[];
}

// ---------------------------------------------------------------------------
// Named errors
// ---------------------------------------------------------------------------

export class RewindGapParseError extends Error {
  constructor(reason: string) {
    super(`measureRewindGap: could not read the machine-readable "json rewind-gap" block from ${REWIND_GAP_DOC_PATH} — ${reason}`);
    this.name = "RewindGapParseError";
  }
}

export class MeanBandWidthError extends Error {
  constructor(reason: string) {
    super(`meanBandWidth: ${reason}`);
    this.name = "MeanBandWidthError";
  }
}

export class NarrowingPercentError extends Error {
  constructor(reason: string) {
    super(`narrowingPercent: ${reason}`);
    this.name = "NarrowingPercentError";
  }
}

export class UnfiredBoundaryError extends Error {
  constructor(reason: string) {
    super(`measureRewindGap: ${reason}`);
    this.name = "UnfiredBoundaryError";
  }
}

export class PairingMismatchError extends Error {
  constructor(reason: string) {
    super(`measureRewindGap: ${reason}`);
    this.name = "PairingMismatchError";
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (Task 1 — corpus-free, unit-tested directly)
// ---------------------------------------------------------------------------

/**
 * Maps `START_POINT_FRACTIONS` through `Math.floor(f * qualCount)`,
 * de-duplicating while preserving ascending order (the fractions are
 * already non-decreasing, so `floor` alone keeps the result ascending — no
 * separate sort is needed for correctness, but the de-dup pass is what
 * collapses a small event's degenerate cases into fewer, distinct jobs
 * rather than several identical ones). Returns `[]` for a zero qual count
 * so the caller can skip the event with a named reason instead of crashing
 * mid-run.
 */
export function selectStartIndices(qualCount: number): number[] {
  if (qualCount <= 0) return [];
  const seen = new Set<number>();
  const result: number[] = [];
  for (const fraction of START_POINT_FRACTIONS) {
    const idx = Math.floor(fraction * qualCount);
    if (!seen.has(idx)) {
      seen.add(idx);
      result.push(idx);
    }
  }
  return result;
}

/**
 * One pass over `playedBefore`, accumulating a running RP total and match
 * count per team key, seeded from `roster` so every roster team is present
 * at zero (08-03's `simulateRanks` throws on the first match naming a team
 * absent from `baselines`). `earnedRpSum` is a TOTAL, matching 08-03's
 * `SimTeamBaseline` contract exactly — never a per-match average.
 *
 * A `null` alliance RP (a genuinely un-derivable actual value — D-12)
 * increments that alliance's teams' `matchesPlayed` but contributes
 * NOTHING to their `earnedRpSum`, and every one of those team keys is
 * recorded in `incompleteTeamKeys`. A `null` is never coerced to `0`: `0`
 * is a positive claim about a team's standing, and this project's own D-12
 * decision states that plainly for the exact same field.
 */
export function buildBaselines(playedBefore: readonly MatchResult[], roster: readonly string[]): BaselineBuildResult {
  const sumByTeam = new Map<string, number>();
  const matchesByTeam = new Map<string, number>();
  const incompleteTeamKeys = new Set<string>();
  for (const teamKey of roster) {
    sumByTeam.set(teamKey, 0);
    matchesByTeam.set(teamKey, 0);
  }

  const foldAlliance = (teamKeys: readonly string[], rpEarned: number | null): void => {
    for (const teamKey of teamKeys) {
      matchesByTeam.set(teamKey, (matchesByTeam.get(teamKey) ?? 0) + 1);
      if (rpEarned === null) {
        incompleteTeamKeys.add(teamKey);
      } else {
        sumByTeam.set(teamKey, (sumByTeam.get(teamKey) ?? 0) + rpEarned);
      }
    }
  };

  for (const match of playedBefore) {
    foldAlliance(match.redTeams, match.redRpEarned);
    foldAlliance(match.blueTeams, match.blueRpEarned);
  }

  const baselines: SimTeamBaseline[] = roster.map((teamKey) => ({
    teamKey,
    earnedRpSum: sumByTeam.get(teamKey) ?? 0,
    matchesPlayed: matchesByTeam.get(teamKey) ?? 0,
  }));

  return { baselines, incompleteTeamKeys: [...incompleteTeamKeys] };
}

/**
 * Maps each `(match, prediction)` record to a `SimMatchInput`, skipping and
 * recording any record whose prediction lacks either pmf. Exclusion must
 * be PAIRED at the caller: the caller applies the UNION of both arms' own
 * `excludedMatchKeys` to both arms, never one arm's exclusions to itself
 * alone — a one-sided exclusion would change one arm's match list and
 * silently invalidate the pairing this measurement rests on. Surviving
 * inputs keep their original relative order, which is what lets the caller
 * assert the two arms cover an identical match list element-by-element.
 */
export function toSimMatchInputs(records: readonly PredictionRecord[]): SimInputBuildResult {
  const inputs: SimMatchInput[] = [];
  const excludedMatchKeys: string[] = [];
  for (const record of records) {
    const { redRpPmf, blueRpPmf } = record.prediction;
    if (redRpPmf === undefined || blueRpPmf === undefined) {
      excludedMatchKeys.push(record.match.matchKey);
      continue;
    }
    inputs.push({
      redTeamKeys: [...record.match.redTeams],
      blueTeamKeys: [...record.match.blueTeams],
      redRpPmf,
      blueRpPmf,
    });
  }
  return { inputs, excludedMatchKeys };
}

/**
 * `matches.map((match) => ({ match, prediction: predictOnly(match) }))`.
 * `predictOnly`'s type is deliberately narrowed to a single-argument
 * `(match: MatchResult) => Prediction` callback — no algorithm module and
 * no fold-in ("update") method is in scope to call, even by accident. That
 * structural narrowing, not a comment or a rule someone must remember, is
 * what makes the frozen set's "no fold-in between predictions" property
 * auditable: this function's own type signature has nothing in it capable
 * of mutating state between calls.
 */
export function collectFrozenPredictions(
  matches: readonly MatchResult[],
  predictOnly: (match: MatchResult) => Prediction
): PredictionRecord[] {
  return matches.map((match) => ({ match, prediction: predictOnly(match) }));
}

/**
 * The mean, over every team in `result.rankHistograms`, of
 * `continuousQuantile(hist, 0.90, result.draws) - continuousQuantile(hist, 0.10, result.draws)`
 * — the same p90-p10 band width the UI renders (08-04's `simQuantile.ts`),
 * computed by the identical imported estimator. Throws a named error on an
 * empty map rather than returning `NaN` from a zero-division: a mean over
 * no teams is not a measurement.
 */
export function meanBandWidth(result: SimResult): number {
  if (result.rankHistograms.size === 0) {
    throw new MeanBandWidthError("SimResult.rankHistograms is empty — a mean over no teams is not a measurement");
  }
  let total = 0;
  for (const histogram of result.rankHistograms.values()) {
    const p90 = continuousQuantile(histogram, 0.9, result.draws);
    const p10 = continuousQuantile(histogram, 0.1, result.draws);
    total += p90 - p10;
  }
  return total / result.rankHistograms.size;
}

/**
 * `((frozenWidth - storedWidth) / frozenWidth) * 100`. The denominator is
 * the FROZEN width, because the claim being quantified is "narrower *than
 * a true from-here forecast*" — the frozen arm IS that forecast (see this
 * file's header). Positive means the rewind (stored) arm is narrower than
 * the honest forecast — the direction D-01 predicts. Negative is a
 * legitimate finding, never an error and never clamped to zero: D-02
 * explicitly permits either direction. Throws a named error when
 * `frozenWidth` is not finite and strictly positive — given 08-04's proven
 * 0.8-rank-unit structural floor this is unreachable from real data, which
 * is exactly why it must fail loudly here rather than silently returning
 * `Infinity`/`NaN` into a headline figure.
 */
export function narrowingPercent(frozenWidth: number, storedWidth: number): number {
  if (!Number.isFinite(frozenWidth) || frozenWidth <= 0) {
    throw new NarrowingPercentError(`frozenWidth must be finite and > 0, got ${frozenWidth}`);
  }
  return ((frozenWidth - storedWidth) / frozenWidth) * 100;
}

/**
 * `"narrower"` when `meanNarrowing` exceeds the noise floor on the positive
 * side, `"wider"` on the negative side, `"indistinguishable"` when
 * `|meanNarrowing| <= meanNoiseFloor` (inclusive on the humble side: a gap
 * exactly equal to the measurement's own scatter is not a finding). The
 * comparison is on the ABSOLUTE value of `meanNarrowing`, so a small gap in
 * either direction lands in the same honest bucket.
 */
export function classifyVerdict(meanNarrowing: number, meanNoiseFloor: number): RewindGapHeadline["verdict"] {
  if (Math.abs(meanNarrowing) <= meanNoiseFloor) return "indistinguishable";
  return meanNarrowing > 0 ? "narrower" : "wider";
}

/** Extracted so `describe("parser robustness")` can drive it against a fixture string with no real file on disk — mirrors `packages/harness/payloadBudget.test.ts`'s `parsePublishBudget` exactly. */
export function parseRewindGap(markdown: string): RewindGapMeasurement {
  const match = REWIND_GAP_BLOCK_PATTERN.exec(markdown);
  if (!match) {
    throw new RewindGapParseError(`no fenced \`\`\`json rewind-gap block found`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]!);
  } catch (err) {
    throw new RewindGapParseError(`the block did not parse as JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return parsed as RewindGapMeasurement;
}

/**
 * Replaces the existing block's contents in place, leaving every byte
 * outside the fence untouched. Throws `RewindGapParseError` when no block
 * exists rather than appending one — the doc's prose is written by a
 * human, and a script able to invent the block's location could invent it
 * in the wrong place in a doc that lost it. Serializes with
 * `JSON.stringify(measurement, null, 2)`.
 */
export function writeRewindGapBlock(markdown: string, measurement: RewindGapMeasurement): string {
  const match = REWIND_GAP_BLOCK_PATTERN.exec(markdown);
  if (!match) {
    throw new RewindGapParseError(`no fenced \`\`\`json rewind-gap block found to replace`);
  }
  const serialized = JSON.stringify(measurement, null, 2);
  const start = match.index;
  const end = match.index + match[0].length;
  return `${markdown.slice(0, start)}\`\`\`json rewind-gap\n${serialized}\n\`\`\`${markdown.slice(end)}`;
}

// ---------------------------------------------------------------------------
// Driver (Task 2) — one threaded season pass per replayed season, boundary
// snapshots taken inside onMatchComplete, three simulations per job.
// ---------------------------------------------------------------------------

export const CORPUS_PATH = join("data", "corpus.sqlite");
/** Mirrors `packages/harness/cli.ts`'s own (module-private) `PROMOTED_VPR_VERSION_PATH` — duplicated here rather than imported, since that constant is `cli.ts`-internal, matching `replayRig.ts`'s own precedent for duplicating a small named value across an isolation boundary. */
const PROMOTED_VPR_VERSION_PATH = join("data", "algorithm-versions", `vpr@${SIGMA1_CODE_VERSION}+tuned-2026-08.json`);

/** The stream-position sentinel for a job whose start index is 0 — there is no preceding match in that event, so the job's "frozen state" is the season's own initial state (cold-start `initState`, or this season's carried-in state) rather than any `onMatchComplete` snapshot. */
const SEASON_START_SENTINEL = "__SEASON_START__";

interface EventPreparation {
  readonly quals: readonly MatchResult[];
  readonly roster: readonly string[];
  readonly startIndices: readonly number[];
}

interface RewindJob {
  readonly eventKey: string;
  readonly startIndex: number;
}

function jobKeyOf(job: RewindJob): string {
  return `${job.eventKey}#${job.startIndex}`;
}

function uniqueTeamKeysInOrder(matches: readonly MatchResult[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of matches) {
    for (const teamKey of [...match.redTeams, ...match.blueTeams]) {
      if (!seen.has(teamKey)) {
        seen.add(teamKey);
        result.push(teamKey);
      }
    }
  }
  return result;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Asserts the two local, gitignored-or-committed inputs this script needs
 * exist before any corpus read is attempted, per this task's own
 * `<precondition>`: `data/corpus.sqlite` and the promoted VPR version
 * pin. Neither is created by plan ordering — they are local machine state
 * — so a named, actionable halt here is what stands between a missing
 * file and a cryptic mid-run SQLite/JSON error.
 */
function assertPreconditions(): void {
  if (!existsSync(CORPUS_PATH)) {
    throw new Error(`measureRewindGap: precondition failed — ${CORPUS_PATH} does not exist. Run the ingest pipeline first.`);
  }
  if (!existsSync(PROMOTED_VPR_VERSION_PATH)) {
    throw new Error(
      `measureRewindGap: precondition failed — ${PROMOTED_VPR_VERSION_PATH} does not exist, so applyPromotedOverrides would resolve the untuned default vpr rather than the promoted version this measurement needs.`
    );
  }
}

/**
 * Runs the full D-02 control measurement over `targetEvents`: one threaded,
 * offseason-inclusive season replay per season from `COLD_START_SEASON`
 * through the newest target season, boundary snapshots captured inside
 * `onMatchComplete` with no fold-in ever called on a frozen state, three
 * start points per event, and a paired frozen-vs-stored-vs-noise-control
 * comparison per job through the SAME imported `simulateRanks`.
 */
export async function runMeasurement(targetEvents: readonly TargetEvent[], draws: number, seed: number): Promise<RewindGapMeasurement> {
  const db: Corpus = openCorpusReadOnly(CORPUS_PATH);
  try {
    const algorithm = applyPromotedOverrides([vpr])[0]!;

    // --- Per-event prep: quals, roster, start indices — asserted against the corpus up front. ---
    const eventPrep = new Map<string, EventPreparation>();
    for (const target of targetEvents) {
      const quals = selectMatchesChronological(db, { eventKey: target.eventKey }).filter((m) => m.compLevel === "qm");
      if (quals.length !== target.expectedQuals) {
        throw new Error(
          `measureRewindGap: ${target.eventKey}'s corpus qual count (${quals.length}) no longer matches DEFAULT_TARGET_EVENTS' pinned expectation (${target.expectedQuals}) — the corpus may have been re-ingested. Update DEFAULT_TARGET_EVENTS or investigate before trusting this measurement.`
        );
      }
      const roster = uniqueTeamKeysInOrder(quals);
      if (roster.length !== target.expectedRoster) {
        throw new Error(
          `measureRewindGap: ${target.eventKey}'s corpus roster size (${roster.length}) no longer matches DEFAULT_TARGET_EVENTS' pinned expectation (${target.expectedRoster}) — the corpus may have been re-ingested. Update DEFAULT_TARGET_EVENTS or investigate before trusting this measurement.`
        );
      }
      eventPrep.set(target.eventKey, { quals, roster, startIndices: selectStartIndices(quals.length) });
    }

    const maxTargetSeason = Math.max(...targetEvents.map((t) => t.season));
    const seasons: number[] = [];
    for (let season = COLD_START_SEASON; season <= maxTargetSeason; season++) seasons.push(season);

    const frozenRecordsByJobKey = new Map<string, PredictionRecord[]>();
    const storedRecordsByEventKey = new Map<string, Map<string, PredictionRecord>>();
    let priorSeasonFinalStates = new Map<string, unknown>();
    let corpusMatchCount = 0;

    for (const season of seasons) {
      // Offseason-inclusive, matching `publish:seasons`' own stream
      // composition exactly (`includeOffseason: true`) — the published
      // predictions this control compares against were produced from an
      // offseason-inclusive stream, so the STORED arm must be too.
      let stream = buildSeasonStream(db, season, { includeOffseason: true });
      const seasonTargets = targetEvents.filter((t) => t.season === season);

      // Decision 6, 08-08-PLAN.md: truncate the NEWEST target season's stream
      // immediately after the last target match's position — nothing after
      // it affects any measurement and no further carry is consumed, which
      // is what makes a single-event smoke run finish in seconds.
      if (season === maxTargetSeason && seasonTargets.length > 0) {
        let lastIndex = -1;
        for (const target of seasonTargets) {
          const prep = eventPrep.get(target.eventKey)!;
          const lastQualKey = prep.quals[prep.quals.length - 1]!.matchKey;
          const idx = stream.findIndex((m) => m.matchKey === lastQualKey);
          if (idx === -1) {
            throw new Error(`measureRewindGap: could not locate ${target.eventKey}'s last qual match in season ${season}'s stream`);
          }
          lastIndex = Math.max(lastIndex, idx);
        }
        stream = stream.slice(0, lastIndex + 1);
      }

      corpusMatchCount += stream.length;
      const teams = uniqueTeamKeysInOrder(stream);

      const boundary: SeasonBoundary = { fromSeason: season - 1, toSeason: season, isColdStart: season === COLD_START_SEASON };
      let initialStates: ReadonlyMap<string, unknown> | undefined;
      if (boundary.isColdStart) {
        console.log(`measureRewindGap: season ${season} — cold-start (COLD_START_SEASON=${COLD_START_SEASON}), stream length ${stream.length}`);
      } else {
        const carried = new Map<string, unknown>();
        const prior = priorSeasonFinalStates.get(algorithm.id);
        if (algorithm.carrySeason && prior !== undefined) {
          carried.set(algorithm.id, algorithm.carrySeason(prior, boundary));
        }
        initialStates = carried;
        console.log(`measureRewindGap: season ${season} — carried state in, stream length ${stream.length}`);
      }

      // --- Register this season's boundaries. ---
      const boundaryKeyToJobs = new Map<string, RewindJob[]>();
      const unfiredBoundaries = new Set<string>();
      for (const target of seasonTargets) {
        const prep = eventPrep.get(target.eventKey)!;
        for (const startIndex of prep.startIndices) {
          const startMatchKey = prep.quals[startIndex]!.matchKey;
          const streamIdx = stream.findIndex((m) => m.matchKey === startMatchKey);
          if (streamIdx === -1) {
            throw new Error(
              `measureRewindGap: start match ${startMatchKey} for ${target.eventKey} (startIndex ${startIndex}) was not found in season ${season}'s stream — the truncation likely cut it off`
            );
          }
          const boundaryKey = streamIdx === 0 ? SEASON_START_SENTINEL : stream[streamIdx - 1]!.matchKey;
          const job: RewindJob = { eventKey: target.eventKey, startIndex };
          const list = boundaryKeyToJobs.get(boundaryKey) ?? [];
          list.push(job);
          boundaryKeyToJobs.set(boundaryKey, list);
          unfiredBoundaries.add(boundaryKey);
        }
      }

      const fireBoundary = (boundaryKey: string, state: unknown): void => {
        const jobs = boundaryKeyToJobs.get(boundaryKey);
        if (!jobs) return;
        for (const job of jobs) {
          const prep = eventPrep.get(job.eventKey)!;
          const remainingMatches = prep.quals.slice(job.startIndex);
          const records = collectFrozenPredictions(remainingMatches, (m) => algorithm.predict(state, toLeakProofUpcoming(m)));
          frozenRecordsByJobKey.set(jobKeyOf(job), records);
          console.log(
            `measureRewindGap: boundary fired [${boundaryKey}] ${job.eventKey} start=${job.startIndex} remaining=${remainingMatches.length}`
          );
        }
        unfiredBoundaries.delete(boundaryKey);
      };

      // A start index of 0 has no preceding match — its frozen state IS the
      // season's own initial state (carried-in, or cold `initState`).
      if (boundaryKeyToJobs.has(SEASON_START_SENTINEL)) {
        const seasonInitialState = initialStates?.get(algorithm.id) ?? algorithm.initState([...teams]);
        fireBoundary(SEASON_START_SENTINEL, seasonInitialState);
      }

      const onMatchComplete = (match: MatchResult, algorithmId: string, state: unknown): void => {
        if (algorithmId !== algorithm.id) return;
        fireBoundary(match.matchKey, state);
      };

      const simulator = new WalkForwardSimulator(stream);
      const records = simulator.runAll([algorithm], teams, initialStates, onMatchComplete);

      if (unfiredBoundaries.size > 0) {
        throw new UnfiredBoundaryError(
          `season ${season}: the following registered boundary key(s) never fired — a missing measurement would otherwise be silently absorbed by a mean over fewer jobs: ${[...unfiredBoundaries].join(", ")}`
        );
      }

      // Collect STORED predictions restricted to this season's target
      // events' qm rows, then discard the rest of this season's records so
      // at most one season's records are resident at a time.
      const seasonTargetEventKeys = new Set(seasonTargets.map((t) => t.eventKey));
      for (const r of records) {
        if (r.match.compLevel !== "qm" || !seasonTargetEventKeys.has(r.match.eventKey)) continue;
        let byMatchKey = storedRecordsByEventKey.get(r.match.eventKey);
        if (!byMatchKey) {
          byMatchKey = new Map();
          storedRecordsByEventKey.set(r.match.eventKey, byMatchKey);
        }
        byMatchKey.set(r.match.matchKey, { match: r.match, prediction: r.prediction });
      }

      priorSeasonFinalStates = new Map(records.finalStates);
      console.log(`measureRewindGap: season ${season} complete — ${records.length} matches replayed`);
    }

    // --- Per job: three simulations, paired by construction. ---
    const eventResults: EventResult[] = [];
    const incompleteBaselineTeamKeysGlobal = new Set<string>();

    for (const target of targetEvents) {
      const prep = eventPrep.get(target.eventKey)!;
      const storedByMatchKey = storedRecordsByEventKey.get(target.eventKey);
      if (!storedByMatchKey) {
        throw new Error(`measureRewindGap: no stored predictions were collected for ${target.eventKey} — its season may not have been replayed`);
      }
      const startPoints: StartPointResult[] = [];

      for (const startIndex of prep.startIndices) {
        const jobKey = jobKeyOf({ eventKey: target.eventKey, startIndex });
        const frozenRecords = frozenRecordsByJobKey.get(jobKey);
        if (!frozenRecords) {
          throw new Error(`measureRewindGap: no frozen predictions collected for ${target.eventKey} start=${startIndex} — its boundary never fired`);
        }

        const remainingMatches = prep.quals.slice(startIndex);
        const playedBefore = prep.quals.slice(0, startIndex);
        const { baselines, incompleteTeamKeys } = buildBaselines(playedBefore, prep.roster);
        for (const teamKey of incompleteTeamKeys) incompleteBaselineTeamKeysGlobal.add(teamKey);

        const storedRecords = remainingMatches.map((m) => {
          const record = storedByMatchKey.get(m.matchKey);
          if (!record) throw new Error(`measureRewindGap: no stored prediction found for ${target.eventKey}'s ${m.matchKey}`);
          return record;
        });

        // Union of both arms' exclusions, applied to BOTH arms — never one arm's own exclusions to itself alone.
        const storedExcluded = new Set(toSimMatchInputs(storedRecords).excludedMatchKeys);
        const frozenExcluded = new Set(toSimMatchInputs(frozenRecords).excludedMatchKeys);
        const excludedUnion = new Set([...storedExcluded, ...frozenExcluded]);

        const storedFiltered = storedRecords.filter((r) => !excludedUnion.has(r.match.matchKey));
        const frozenFiltered = frozenRecords.filter((r) => !excludedUnion.has(r.match.matchKey));

        if (storedFiltered.length !== frozenFiltered.length) {
          throw new PairingMismatchError(
            `${target.eventKey} start=${startIndex}: post-exclusion match counts diverge (stored=${storedFiltered.length}, frozen=${frozenFiltered.length})`
          );
        }
        for (let i = 0; i < storedFiltered.length; i++) {
          if (storedFiltered[i]!.match.matchKey !== frozenFiltered[i]!.match.matchKey) {
            throw new PairingMismatchError(
              `${target.eventKey} start=${startIndex}: arms diverge at index ${i} — stored=${storedFiltered[i]!.match.matchKey}, frozen=${frozenFiltered[i]!.match.matchKey}`
            );
          }
        }

        const storedInputs = toSimMatchInputs(storedFiltered).inputs;
        const frozenInputs = toSimMatchInputs(frozenFiltered).inputs;

        const storedResult = simulateRanks(storedInputs, baselines, draws, mulberry32(seed));
        const frozenResult = simulateRanks(frozenInputs, baselines, draws, mulberry32(seed));
        const noiseResult = simulateRanks(storedInputs, baselines, draws, mulberry32(seed + NOISE_CONTROL_SEED_OFFSET));

        const storedWidth = meanBandWidth(storedResult);
        const frozenWidth = meanBandWidth(frozenResult);
        const noiseWidth = meanBandWidth(noiseResult);

        const narrowing = narrowingPercent(frozenWidth, storedWidth);
        const noiseFloor = Math.abs(narrowingPercent(storedWidth, noiseWidth));

        startPoints.push({
          startIndex,
          startMatchKey: prep.quals[startIndex]!.matchKey,
          remainingMatchCount: remainingMatches.length,
          excludedMatchCount: excludedUnion.size,
          teamCount: prep.roster.length,
          frozenMeanBandWidth: frozenWidth,
          storedMeanBandWidth: storedWidth,
          narrowingPercent: narrowing,
          noiseFloorPercent: noiseFloor,
        });

        console.log(
          `measureRewindGap: job complete [${target.eventKey} start=${startIndex}] frozen=${frozenWidth.toFixed(4)} stored=${storedWidth.toFixed(4)} narrowing=${narrowing.toFixed(2)}% noiseFloor=${noiseFloor.toFixed(2)}%`
        );
      }

      eventResults.push({
        eventKey: target.eventKey,
        season: target.season,
        qualCount: prep.quals.length,
        rosterSize: prep.roster.length,
        startPoints,
      });
    }

    const allNarrowing = eventResults.flatMap((e) => e.startPoints.map((sp) => sp.narrowingPercent));
    const allNoiseFloor = eventResults.flatMap((e) => e.startPoints.map((sp) => sp.noiseFloorPercent));
    const meanNarrowing = mean(allNarrowing);
    const meanNoiseFloor = mean(allNoiseFloor);

    const headline: RewindGapHeadline = {
      meanNarrowingPercent: meanNarrowing,
      minNarrowingPercent: Math.min(...allNarrowing),
      maxNarrowingPercent: Math.max(...allNarrowing),
      meanNoiseFloorPercent: meanNoiseFloor,
      measurementCount: allNarrowing.length,
      eventCount: eventResults.length,
      excludedMatchCount: eventResults.flatMap((e) => e.startPoints).reduce((sum, sp) => sum + sp.excludedMatchCount, 0),
      incompleteBaselineTeamCount: incompleteBaselineTeamKeysGlobal.size,
      verdict: classifyVerdict(meanNarrowing, meanNoiseFloor),
    };

    return {
      measuredAt: new Date().toISOString(),
      algorithmId: algorithm.id,
      algorithmVersion: algorithm.version,
      corpusIdentity: CORPUS_PATH,
      corpusMatchCount,
      draws,
      seed,
      events: eventResults,
      headline,
    };
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
  readonly targetEvents: readonly TargetEvent[];
  readonly draws: number;
  readonly seed: number;
  readonly writeDoc: boolean;
}

function parseOptions(): CliOptions {
  const { values } = parseArgs({
    options: {
      events: { type: "string" },
      draws: { type: "string" },
      seed: { type: "string" },
      "write-doc": { type: "boolean" },
    },
  });

  let targetEvents: readonly TargetEvent[] = DEFAULT_TARGET_EVENTS;
  if (values.events) {
    const requested = values.events
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const missing = requested.filter((key) => !DEFAULT_TARGET_EVENTS.some((e) => e.eventKey === key));
    if (missing.length > 0) {
      throw new Error(`measureRewindGap: --events named event key(s) not in DEFAULT_TARGET_EVENTS: ${missing.join(", ")}`);
    }
    targetEvents = DEFAULT_TARGET_EVENTS.filter((e) => requested.includes(e.eventKey));
  }

  return {
    targetEvents,
    draws: values.draws ? Number.parseInt(values.draws, 10) : DEFAULT_DRAWS,
    seed: values.seed ? Number.parseInt(values.seed, 10) : DEFAULT_SEED,
    writeDoc: values["write-doc"] ?? false,
  };
}

async function main(): Promise<void> {
  assertPreconditions();
  const options = parseOptions();
  const measurement = await runMeasurement(options.targetEvents, options.draws, options.seed);
  console.log(JSON.stringify(measurement, null, 2));

  if (options.writeDoc) {
    if (!existsSync(REWIND_GAP_DOC_PATH)) {
      throw new Error(`measureRewindGap: --write-doc requires ${REWIND_GAP_DOC_PATH} to already exist with a placeholder json rewind-gap block`);
    }
    const doc = readFileSync(REWIND_GAP_DOC_PATH, "utf8");
    const updated = writeRewindGapBlock(doc, measurement);
    writeFileSync(REWIND_GAP_DOC_PATH, updated, "utf8");
    console.log(`measureRewindGap: wrote ${REWIND_GAP_DOC_PATH}`);
  }
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("measureRewindGap failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
