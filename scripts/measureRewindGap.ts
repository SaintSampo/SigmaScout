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
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { MatchResult, Prediction } from "../packages/core/algorithms/types.js";
import type { PredictionRecord } from "../packages/harness/replay.js";
import {
  simulateRanks,
  mulberry32,
  type SimMatchInput,
  type SimTeamBaseline,
  type SimResult,
} from "../packages/core/algorithms/simulation/rankSimulation.js";
import { continuousQuantile } from "../apps/web/src/lib/simQuantile.js";

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
// Driver (Task 2) and main() (Task 2/3) — added in a later task.
// ---------------------------------------------------------------------------

export { simulateRanks, mulberry32 };
