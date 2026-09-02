/**
 * SC-5 / D-07 (03.2-CONTEXT.md): measures what event-scoped OPR actually
 * does early in an event, in the project's own units, rather than assuming
 * a rank-deficient design matrix is benign.
 *
 * Two halves, both required (D-07 rejects either alone):
 *   1. Accuracy-by-checkpoint (this task): Brier and winner accuracy bucketed
 *      by how many qualification matches the event had completed at
 *      prediction time — states the prediction-quality COST.
 *   2. Rank-vs-team-count (plan Task 2, `eventScopeDiagnostic.test.ts`
 *      extends alongside it): explains the MECHANISM behind the curve.
 *
 * Checkpoint derivation reuses the exact chronological order
 * `predictions-<season>.jsonl` was written in (03.2-RESEARCH.md, confirmed):
 * scanning top to bottom and incrementing a per-event qm counter strictly
 * AFTER tagging a record reproduces "how many quals had this event
 * completed when this prediction was made" — the predict-before-update
 * sequencing already enforced elsewhere in this project makes that
 * `completedBefore` count exact, not an estimate.
 *
 * D-08: this script measures and documents. It introduces no cold-start
 * mitigation, seed, fallback, or floor — a bad number here is a true fact
 * about event-scoped OPR, not a bug this script's job is to fix.
 *
 * Standalone-script shape, matching `identifiability.ts`/`baselineFingerprint.ts`:
 * `parseArgs`, `async function main()`, an entry-point guard so importing
 * this module (e.g. from a test) never triggers a corpus read or a run-dir
 * read as a side effect.
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { openCorpusReadOnly, selectMatchesChronological, type Corpus } from "../corpus/db.js";
import type { CompLevel, MatchResult } from "../core/algorithms/types.js";
import { ratingEligibleTeams } from "../core/algorithms/opr.js";
import { computeDesignMatrix, type AllianceRow, type DesignMatrixResult } from "./identifiability.js";
import { aggregateScores, type HarnessPredictionInput, type ScoreSlice } from "./score.js";

const CORPUS_PATH = "data/corpus.sqlite";
const DEFAULT_RUN_DIR = join("reports", "event-scoped-v1");
const DEFAULT_SEASONS = "2022-2026";
const DEFAULT_ALGORITHM = "opr";
const DEFAULT_OUT_PATH = join("reports", "event-scope-diagnostic.json");

/**
 * Half-open checkpoint buckets on completed qualification matches at the
 * event, fixed by 03.2-CONTEXT.md's objective section (planner's discretion,
 * settled so they are not re-litigated during execution). The corpus
 * measures a median event at 38 teams / 74 quals, so 6/12/24/48 are roughly
 * one/two/four/eight alliance appearances per team on average.
 */
export const BUCKET_ORDER = ["0", "1-6", "7-12", "13-24", "25-48", "49+"] as const;
export type CheckpointBucket = (typeof BUCKET_ORDER)[number];

/** `completedBefore === 6` lands in `1-6`, `=== 7` lands in `7-12` — half-open, exactly per the objective's fixed boundaries. */
export function assignCheckpointBucket(completedBefore: number): CheckpointBucket {
  if (completedBefore <= 0) return "0";
  if (completedBefore <= 6) return "1-6";
  if (completedBefore <= 12) return "7-12";
  if (completedBefore <= 24) return "13-24";
  if (completedBefore <= 48) return "25-48";
  return "49+";
}

/** The minimal shape `tagRecordsWithCompletedQuals` needs from a record — matches both the sidecar's `PersistedPredictionRecord` and any synthetic test fixture. */
export interface TaggableRecord {
  readonly eventKey: string;
  readonly compLevel: CompLevel;
}

export interface TaggedRecord<T extends TaggableRecord> {
  readonly record: T;
  readonly completedBefore: number;
  readonly bucket: CheckpointBucket;
}

/**
 * Scans `records` in the order given (the sidecar's own chronological
 * replay order — see file header) keeping a per-event qm-completed counter.
 * `completedBefore` is read BEFORE the counter is incremented, and the
 * counter is only ever incremented on a `qm` record — a playoff record is a
 * genuine no-op on the counter (mirrors `opr.ts`'s own `update()` no-op for
 * non-qm matches, D-05), while still receiving a `completedBefore` tag from
 * whatever the event's qm count was at that point in the stream.
 */
export function tagRecordsWithCompletedQuals<T extends TaggableRecord>(
  records: readonly T[]
): TaggedRecord<T>[] {
  const qmCompletedByEvent = new Map<string, number>();
  const tagged: TaggedRecord<T>[] = [];
  for (const record of records) {
    const completedBefore = qmCompletedByEvent.get(record.eventKey) ?? 0;
    tagged.push({ record, completedBefore, bucket: assignCheckpointBucket(completedBefore) });
    if (record.compLevel === "qm") {
      qmCompletedByEvent.set(record.eventKey, completedBefore + 1);
    }
  }
  return tagged;
}

/** One sidecar line's fields this script actually reads — a subset of `PersistedPredictionRecord` (`predictions.ts`). */
interface SidecarRecord extends TaggableRecord {
  readonly matchKey: string;
  readonly algorithmId: string;
  readonly pRedWin: number;
  readonly predictedRedScore: number;
  readonly predictedBlueScore: number;
  readonly actualWinner: "red" | "blue" | "tie";
}

/**
 * Streams `<run-dir>/predictions-<season>.jsonl` line by line (never
 * buffered whole into memory — sidecars run 75-157 MB per
 * 03.2-03-SUMMARY.md), keeping only records for `algorithmId`.
 */
// Exported for eventScopeDiagnostic.test.ts's malformed-final-line
// regression (IN-03, 03.2-REVIEW.md).
export async function readSidecarRecordsForAlgorithm(sidecarPath: string, algorithmId: string): Promise<SidecarRecord[]> {
  const records: SidecarRecord[] = [];
  const rl = createInterface({ input: createReadStream(sidecarPath, "utf8"), crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber += 1;
    if (line.trim().length === 0) continue;
    let rec: SidecarRecord;
    try {
      rec = JSON.parse(line) as SidecarRecord;
    } catch (cause) {
      // A truncated final line (process killed mid-write) must not surface
      // as a bare `SyntaxError: Unexpected end of JSON input` — that tells a
      // future reader nothing about which file or line broke. Re-throw (not
      // skip): this diagnostic's reconciliation gate exists specifically to
      // fail loudly on population mismatches, and silently dropping a
      // partial record would defeat that gate's whole purpose.
      throw new Error(
        `eventScopeDiagnostic: malformed JSON at ${sidecarPath}:${lineNumber} — ${line.slice(0, 80)}${line.length > 80 ? "…" : ""}`,
        { cause }
      );
    }
    if (rec.algorithmId !== algorithmId) continue;
    records.push(rec);
  }
  return records;
}

/** `SELECT event_key FROM events WHERE year = ? AND is_offseason = 1` — the same query `cli.ts`'s `runSeason` already uses to build its `offseasonEventKeys` set. */
function readOffseasonEventKeys(db: Corpus, season: number): Set<string> {
  const rows = db
    .prepare(`SELECT event_key FROM events WHERE year = ? AND is_offseason = 1`)
    .all(season) as { event_key: string }[];
  return new Set(rows.map((r) => r.event_key));
}

export interface PooledAccuracyResult {
  readonly brierScore: number | null;
  readonly winnerAccuracy: number | null;
  readonly scoredCount: number;
}

/**
 * Pools multiple `combined`-view `ScoreSlice`s (e.g. one per season) into a
 * single figure.
 *
 * Single-slice case (the one `buildReconciliationEntry` below actually
 * exercises, since it pools exactly one season's predictions): returns that
 * slice's own `brierScore`/`winnerAccuracy`/`scoredCount` UNCHANGED, with no
 * arithmetic performed on them at all. This is genuinely bit-for-bit exact —
 * not merely "close" — which is what keeps the reconciliation gate's strict
 * `===` comparison trustworthy.
 *
 * Two-or-more-slice case: each slice's already-computed mean is weighted by
 * its own count and summed to reconstruct the pooled mean (`brierScore` is
 * `squaredErrorSum / count` per `core/scoring/brier.ts`; `winnerAccuracy`'s
 * denominator excludes ties/no-calls, so it is reconstructed from its own
 * denominator, not from `scoredCount`). This is a standard weighted-mean-of-
 * group-means identity and is mathematically exact in real-number
 * arithmetic, but it is NOT guaranteed bit-for-bit identical to scoring the
 * full pooled population directly: `(x * n) / n` is frequently not
 * bit-identical to `x` in IEEE 754 double-precision arithmetic (empirically
 * ~12% of sampled `(x, n)` pairs mismatch). A caller that needs a strict
 * `===` guarantee — like the reconciliation gate — must only ever compare
 * against a pool built from a single slice.
 */
export function poolSlices(slices: readonly ScoreSlice[]): PooledAccuracyResult {
  if (slices.length === 1) {
    const [slice] = slices;
    return { brierScore: slice!.brierScore, winnerAccuracy: slice!.winnerAccuracy, scoredCount: slice!.scoredCount };
  }
  let squaredErrorSum = 0;
  let scoredCount = 0;
  let accuracyCorrect = 0;
  let accuracyDenominator = 0;
  for (const slice of slices) {
    scoredCount += slice.scoredCount;
    if (slice.brierScore !== null) squaredErrorSum += slice.brierScore * slice.scoredCount;
    const denom = slice.scoredCount - slice.tieCount - slice.noCallCount;
    if (slice.winnerAccuracy !== null) {
      accuracyCorrect += slice.winnerAccuracy * denom;
      accuracyDenominator += denom;
    }
  }
  return {
    brierScore: scoredCount > 0 ? squaredErrorSum / scoredCount : null,
    winnerAccuracy: accuracyDenominator > 0 ? accuracyCorrect / accuracyDenominator : null,
    scoredCount,
  };
}

/** Reuses `aggregateScores` (never a hand-rolled second scoring path) and pools its per-season `combined` slices. Returns the zero-population result for an empty input without calling `aggregateScores` at all (it would otherwise return no slices, same effect, but this short-circuit reads clearer). */
export function poolPredictions(predictions: readonly HarnessPredictionInput[]): PooledAccuracyResult {
  if (predictions.length === 0) return { brierScore: null, winnerAccuracy: null, scoredCount: 0 };
  const slices = aggregateScores(predictions).filter((s) => s.compLevelView === "combined");
  return poolSlices(slices);
}

export interface ReconciliationEntry {
  readonly season: number;
  readonly matches: boolean;
  readonly unbucketed: PooledAccuracyResult;
  readonly artifact: PooledAccuracyResult;
}

/** The narrow slice of `<run-dir>/artifact.json` this script reads — `.passthrough()` throughout, matching `baselineFingerprint.ts`'s own narrow-artifact-read convention (never couples to whichever shape `HarnessArtifactSchema` happens to have this week). */
const ArtifactSliceSchema = z
  .object({
    algorithmId: z.string().min(1),
    season: z.number().int(),
    compLevelView: z.string().min(1),
    brierScore: z.number().nullable(),
    winnerAccuracy: z.number().nullable(),
    scoredCount: z.number().int().nonnegative(),
  })
  .passthrough();

const ArtifactReadSchema = z
  .object({
    provenance: z.object({ runTimestamp: z.string().min(1) }).passthrough(),
    slices: z.array(ArtifactSliceSchema),
  })
  .passthrough();

type ArtifactRead = z.infer<typeof ArtifactReadSchema>;

function readArtifact(artifactPath: string): ArtifactRead {
  const raw: unknown = JSON.parse(readFileSync(artifactPath, "utf8"));
  return ArtifactReadSchema.parse(raw);
}

function findArtifactCombinedSlice(
  artifact: ArtifactRead,
  algorithmId: string,
  season: number
): z.infer<typeof ArtifactSliceSchema> {
  const matches = artifact.slices.filter(
    (s) => s.algorithmId === algorithmId && s.season === season && s.compLevelView === "combined"
  );
  if (matches.length === 0) {
    throw new Error(
      `eventScopeDiagnostic: no "combined" slice found in the artifact for algorithm "${algorithmId}" season ${season}`
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `eventScopeDiagnostic: ambiguous "combined" slice for algorithm "${algorithmId}" season ${season} — found ${matches.length}`
    );
  }
  return matches[0]!;
}

/**
 * The load-bearing check (T-03.2-18): asserts the bucketed curve partitions
 * EXACTLY the population the headline artifact figures were computed over,
 * to full floating-point precision — never merely "close". A bucketed curve
 * that silently scores a different population than the headline is worse
 * than no curve at all, because a reader would compare incomparable
 * numbers believing them commensurable.
 */
export function buildReconciliationEntry(season: number, unbucketed: PooledAccuracyResult, artifact: ArtifactRead, algorithmId: string): ReconciliationEntry {
  const artifactSlice = findArtifactCombinedSlice(artifact, algorithmId, season);
  const artifactResult: PooledAccuracyResult = {
    brierScore: artifactSlice.brierScore,
    winnerAccuracy: artifactSlice.winnerAccuracy,
    scoredCount: artifactSlice.scoredCount,
  };
  const matches =
    unbucketed.brierScore === artifactResult.brierScore &&
    unbucketed.winnerAccuracy === artifactResult.winnerAccuracy &&
    unbucketed.scoredCount === artifactResult.scoredCount;
  return { season, matches, unbucketed, artifact: artifactResult };
}

function parseSeasonsSpec(spec: string): number[] {
  const rangeMatch = /^(\d{4})-(\d{4})$/.exec(spec);
  if (rangeMatch) {
    const start = Number.parseInt(rangeMatch[1]!, 10);
    const end = Number.parseInt(rangeMatch[2]!, 10);
    if (end < start) throw new Error(`--seasons range end (${end}) must be >= start (${start})`);
    const seasons: number[] = [];
    for (let year = start; year <= end; year++) seasons.push(year);
    return seasons;
  }
  const singleMatch = /^(\d{4})$/.exec(spec);
  if (singleMatch) return [Number.parseInt(singleMatch[1]!, 10)];
  throw new Error(`--seasons must be a 4-digit year (e.g. "2024") or a range like "2022-2026", got "${spec}"`);
}

export interface AccuracyBucketResult extends PooledAccuracyResult {
  readonly bucket: CheckpointBucket;
}

interface TaggedPredictionWithBucket {
  readonly input: HarnessPredictionInput;
  readonly completedBefore: number;
  readonly bucket: CheckpointBucket;
}

function computeAccuracyBuckets(tagged: readonly TaggedPredictionWithBucket[]): AccuracyBucketResult[] {
  return BUCKET_ORDER.map((bucket) => {
    const predictions = tagged.filter((t) => t.bucket === bucket).map((t) => t.input);
    return { bucket, ...poolPredictions(predictions) };
  });
}

/**
 * D-07's mechanism half: the design matrix's rank against its team-column
 * count, at fixed checkpoints on completed qualification matches. Rank
 * checkpoints are DELIBERATELY courser than the accuracy buckets (fewer
 * points, same underlying "how many alliance appearances has the average
 * team had here" reasoning from the objective) — a full accuracy-bucket-
 * resolution rank curve would be six numbers with no more explanatory value
 * than these five-plus-end-of-event snapshots.
 */
export const RANK_CHECKPOINTS = [0, 6, 12, 24, 48, "event-end"] as const;
export type RankCheckpoint = (typeof RANK_CHECKPOINTS)[number];

/** The minimal per-match shape `buildCheckpointRows`/`groupQualMatchesByEvent` need — a subset of `MatchResult`, matched by any synthetic test fixture too. */
export interface QualMatchLike {
  readonly matchKey: string;
  readonly eventKey: string;
  readonly compLevel: CompLevel;
  readonly redTeams: readonly string[];
  readonly blueTeams: readonly string[];
  readonly redSurrogates: readonly string[];
  readonly blueSurrogates: readonly string[];
}

/**
 * Builds the alliance rows produced by the first `checkpoint` completed
 * qualification matches of one event (already chronologically ordered by
 * the caller — `selectMatchesChronological`'s own ORDER BY), two rows per
 * match (one per alliance), each row's `teams` filtered through
 * `ratingEligibleTeams` — the SAME surrogate policy the rewritten `opr.ts`
 * applies, so this diagnostic's design matrix is the one OPR actually
 * solves (an all-surrogate alliance contributes no row, matching
 * `opr.ts`'s own `update()` no-op for that case). `checkpoint === "event-end"`
 * uses every qualification match the event has; `checkpoint === 0` yields
 * an empty row set (no error — `computeDesignMatrix` has its own documented
 * zero-row early return).
 */
export function buildCheckpointRows(
  qualMatchesChronological: readonly QualMatchLike[],
  checkpoint: number | "event-end"
): AllianceRow[] {
  const slice = checkpoint === "event-end" ? qualMatchesChronological : qualMatchesChronological.slice(0, checkpoint);
  const rows: AllianceRow[] = [];
  for (const m of slice) {
    const redTeams = ratingEligibleTeams(m.redTeams, m.redSurrogates);
    const blueTeams = ratingEligibleTeams(m.blueTeams, m.blueSurrogates);
    if (redTeams.length > 0) rows.push({ matchKey: m.matchKey, eventKey: m.eventKey, teams: redTeams, components: {} });
    if (blueTeams.length > 0) rows.push({ matchKey: m.matchKey, eventKey: m.eventKey, teams: blueTeams, components: {} });
  }
  return rows;
}

/**
 * An event only "reaches" a numeric checkpoint if it actually completed
 * that many qualification matches — an event that finishes with fewer
 * quals than the checkpoint never experienced it, and pooling it in would
 * silently substitute its event-end state for a checkpoint that never
 * happened, mixing two different observations under one label.
 * `"event-end"` always applies to every event, by definition.
 */
function eventReachesCheckpoint(totalQualCount: number, checkpoint: number | "event-end"): boolean {
  if (checkpoint === "event-end") return true;
  return totalQualCount >= checkpoint;
}

/**
 * Groups a season's qualification matches by event, in chronological order
 * within each event (preserved because `selectMatchesChronological`'s own
 * global order already sorts by `sort_time` then `event_key`, so iterating
 * once and appending per event never reorders a single event's own
 * matches). Offseason events are excluded (D-07 measures the same
 * competitive population every other figure in this phase does) and only
 * `qm` matches are kept — D-05: only quals feed the design matrix OPR
 * actually solves.
 */
export function groupQualMatchesByEvent(
  matches: readonly MatchResult[],
  offseasonEventKeys: ReadonlySet<string>
): Map<string, QualMatchLike[]> {
  const byEvent = new Map<string, QualMatchLike[]>();
  for (const m of matches) {
    if (m.compLevel !== "qm") continue;
    if (offseasonEventKeys.has(m.eventKey)) continue;
    const list = byEvent.get(m.eventKey) ?? [];
    list.push({
      matchKey: m.matchKey,
      eventKey: m.eventKey,
      compLevel: m.compLevel,
      redTeams: m.redTeams,
      blueTeams: m.blueTeams,
      redSurrogates: m.redSurrogates,
      blueSurrogates: m.blueSurrogates,
    });
    byEvent.set(m.eventKey, list);
  }
  return byEvent;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export interface RankCheckpointSummary {
  readonly completedQuals: RankCheckpoint;
  readonly eventCount: number;
  readonly meanTeamColumnCount: number;
  readonly medianTeamColumnCount: number;
  readonly meanRank: number;
  readonly medianRank: number;
  readonly meanRankToColumnRatio: number;
  readonly fullColumnRankFraction: number;
  /** `null` when zero events at this checkpoint reached full column rank — there is no condition number to take a median of. */
  readonly medianConditionNumberAmongFullRank: number | null;
}

/** Required by D-07: a bare rank number without its column count says nothing — every figure here is reported alongside `teamColumnCount`. */
export function summarizeCheckpoint(
  completedQuals: RankCheckpoint,
  results: readonly DesignMatrixResult[]
): RankCheckpointSummary {
  const teamColumnCounts = results.map((r) => r.teamColumnCount);
  const ranks = results.map((r) => r.rank);
  const ratios = results.map((r) => (r.teamColumnCount > 0 ? r.rank / r.teamColumnCount : 0));
  const fullRankResults = results.filter((r) => r.fullColumnRank);
  const fullRankConditionNumbers = fullRankResults.map((r) => r.conditionNumber).filter((c) => Number.isFinite(c));
  return {
    completedQuals,
    eventCount: results.length,
    meanTeamColumnCount: mean(teamColumnCounts),
    medianTeamColumnCount: median(teamColumnCounts),
    meanRank: mean(ranks),
    medianRank: median(ranks),
    meanRankToColumnRatio: mean(ratios),
    fullColumnRankFraction: results.length > 0 ? fullRankResults.length / results.length : 0,
    medianConditionNumberAmongFullRank: fullRankConditionNumbers.length > 0 ? median(fullRankConditionNumbers) : null,
  };
}

/**
 * D-06/Pitfall 2 (03.2-RESEARCH.md): OPR solves the normal equations on the
 * Gram matrix `M^T M` (matching TBA's own `build_Minv_matrix` +
 * `np.linalg.pinv`), not an SVD of the raw design matrix `M` directly.
 * Forming `M^T M` squares the matrix's condition number
 * (`kappa(M^T M) = kappa(M)^2`), so some of the early-event degradation the
 * accuracy curve shows is attributable to this fidelity-preserving
 * numerical choice, not only to the design matrix's true rank deficiency.
 * Stated here, not "fixed" — switching to `SVD(M)` directly would make
 * SigmaScout's OPR a different computation than TBA's own.
 */
const NORMAL_EQUATIONS_METHODOLOGY_NOTE =
  "OPR solves the normal equations on the Gram matrix M^T M (matching TBA's own build_Minv_matrix + " +
  "np.linalg.pinv), not an SVD of the raw design matrix M directly. Forming M^T M squares the matrix's " +
  "condition number (kappa(M^T M) = kappa(M)^2), so some of the early-event degradation the accuracy " +
  "curve below shows is attributable to this fidelity-preserving numerical choice, not only to true rank " +
  "deficiency. This is not corrected — switching to SVD(M) directly would make SigmaScout's OPR a " +
  "different computation than TBA's own (03.2-RESEARCH.md Pitfall 2).";

export const WARM_CUT_MIN_COMPLETED_QUALS = 12;

export interface WarmCutResult {
  readonly allMatches: PooledAccuracyResult;
  readonly warmOnly: PooledAccuracyResult;
  readonly coldOnly: PooledAccuracyResult;
}

/**
 * D-09's own partition invariant, asserted in code rather than merely
 * hoped for: `allMatches` must equal `warmOnly + coldOnly`, exactly. This
 * task introduces no mitigation of any kind (D-08) — it partitions and
 * reports; a violated partition here would mean the cut silently dropped
 * or double-counted records, not that the underlying numbers are "bad".
 */
export function assertWarmCutPartition(
  allMatches: PooledAccuracyResult,
  warmOnly: PooledAccuracyResult,
  coldOnly: PooledAccuracyResult
): void {
  if (allMatches.scoredCount !== warmOnly.scoredCount + coldOnly.scoredCount) {
    throw new Error(
      `eventScopeDiagnostic: warm-cut partition does not sum — allMatches.scoredCount=${allMatches.scoredCount} ` +
        `but warmOnly(${warmOnly.scoredCount}) + coldOnly(${coldOnly.scoredCount}) = ${warmOnly.scoredCount + coldOnly.scoredCount} (D-09)`
    );
  }
}

export interface TaggedPrediction {
  readonly input: HarnessPredictionInput;
  readonly completedBefore: number;
}

/**
 * D-09: the warm-only cut excludes records whose event had completed FEWER
 * than 12 qualification matches at prediction time — a direct threshold on
 * `completedBefore`, deliberately NOT derived from the six accuracy-bucket
 * labels: bucket `"7-12"` spans `completedBefore` 7..12 inclusive, so a
 * record at exactly 12 would be misclassified as cold if the warm cut were
 * built from bucket membership instead of the raw tag. `allMatches` is the
 * unchanged headline (identical to the artifact's own combined slice,
 * proved by the reconciliation block) — this section partitions it, never
 * replaces it (D-09's explicit requirement).
 */
export function computeWarmCut(tagged: readonly TaggedPrediction[]): WarmCutResult {
  const warmOnly = poolPredictions(
    tagged.filter((t) => t.completedBefore >= WARM_CUT_MIN_COMPLETED_QUALS).map((t) => t.input)
  );
  const coldOnly = poolPredictions(
    tagged.filter((t) => t.completedBefore < WARM_CUT_MIN_COMPLETED_QUALS).map((t) => t.input)
  );
  const allMatches = poolPredictions(tagged.map((t) => t.input));
  assertWarmCutPartition(allMatches, warmOnly, coldOnly);
  return { allMatches, warmOnly, coldOnly };
}

/** D-09: the field-naming convention makes the hierarchy unmistakable to a reader who skims — this is the one sentence stating it explicitly, carried in the committed summary itself. */
export const WARM_CUT_NOTE =
  "allMatches is OPR's actual reported score (identical to the headline artifact combined-view figures) and is " +
  "what every comparison table in this phase quotes; warmOnly is a diagnostic cut excluding each event's opening " +
  "12 completed qualification matches, showing how much of OPR's gap is structural cold start versus modelling " +
  "— it must never be presented as OPR's score (D-09).";

/**
 * D-13-style committed-artifact convention: this schema is the executable
 * spec for `data/diagnostics/opr-event-scope-2026-08.json` (Task 2's own
 * instruction — "Define a Zod schema for the summary ... and parse the
 * object through it before writing"). The full `--out` report and the
 * `--summary-out` committed summary share this exact shape; the summary is
 * simply this same object written to a second, committed path.
 */
const PooledAccuracyResultSchema = z.object({
  brierScore: z.number().nullable(),
  winnerAccuracy: z.number().nullable(),
  scoredCount: z.number().int().nonnegative(),
});

const AccuracyBucketResultSchema = PooledAccuracyResultSchema.extend({
  bucket: z.enum(BUCKET_ORDER),
});

const RankCheckpointSummarySchema = z.object({
  completedQuals: z.union([z.number().int().nonnegative(), z.literal("event-end")]),
  eventCount: z.number().int().nonnegative(),
  meanTeamColumnCount: z.number(),
  medianTeamColumnCount: z.number(),
  meanRank: z.number(),
  medianRank: z.number(),
  meanRankToColumnRatio: z.number(),
  fullColumnRankFraction: z.number(),
  medianConditionNumberAmongFullRank: z.number().nullable(),
});

const ReconciliationEntrySchema = z.object({
  season: z.number().int(),
  matches: z.boolean(),
  unbucketed: PooledAccuracyResultSchema,
  artifact: PooledAccuracyResultSchema,
});

export const EventScopeDiagnosticReportSchema = z.object({
  generatedAt: z.string().min(1),
  algorithm: z.string().min(1),
  seasons: z.array(z.number().int()).min(1),
  provenance: z.object({
    runDir: z.string().min(1),
    artifactRunTimestamp: z.string().min(1),
    command: z.string().min(1),
  }),
  methodology: z.object({
    bucketBoundaries: z.array(z.string()).length(6),
    normalEquationsNote: z.string().min(1),
  }),
  accuracyBuckets: z.array(AccuracyBucketResultSchema).length(6),
  rankCheckpoints: z.array(RankCheckpointSummarySchema).length(6),
  reconciliation: z.array(ReconciliationEntrySchema).min(1),
  warmCut: z.object({
    allMatches: PooledAccuracyResultSchema,
    warmOnly: PooledAccuracyResultSchema,
    coldOnly: PooledAccuracyResultSchema,
    note: z.string().min(20),
  }),
});
export type EventScopeDiagnosticReport = z.infer<typeof EventScopeDiagnosticReportSchema>;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "run-dir": { type: "string" },
      seasons: { type: "string" },
      algorithm: { type: "string" },
      out: { type: "string" },
      "summary-out": { type: "string" },
    },
  });

  const runDir = values["run-dir"] ?? DEFAULT_RUN_DIR;
  const seasonsSpec = values.seasons ?? DEFAULT_SEASONS;
  const seasons = parseSeasonsSpec(seasonsSpec);
  const algorithmId = values.algorithm ?? DEFAULT_ALGORITHM;
  const outPath = values.out ?? DEFAULT_OUT_PATH;
  const summaryOutPath = values["summary-out"];

  const artifactPath = join(runDir, "artifact.json");
  if (!existsSync(artifactPath)) {
    throw new Error(
      `eventScopeDiagnostic: ${artifactPath} does not exist — --run-dir must be a completed harness run directory (default: ${DEFAULT_RUN_DIR})`
    );
  }
  const artifact = readArtifact(artifactPath);

  const db = openCorpusReadOnly(CORPUS_PATH); // read-only: this diagnostic never mutates the data every figure it reports traces back to
  const reconciliation: ReconciliationEntry[] = [];
  const taggedAll: TaggedPredictionWithBucket[] = [];
  const designResultsByCheckpoint = new Map<RankCheckpoint, DesignMatrixResult[]>(
    RANK_CHECKPOINTS.map((cp) => [cp, []])
  );
  try {
    for (const season of seasons) {
      const sidecarPath = join(runDir, `predictions-${season}.jsonl`);
      if (!existsSync(sidecarPath)) {
        throw new Error(
          `eventScopeDiagnostic: ${sidecarPath} does not exist — --run-dir must cover season ${season} (re-creating a cleaned run directory costs real wall-clock time; see this plan's Task 1 precondition)`
        );
      }

      const offseasonEventKeys = readOffseasonEventKeys(db, season);
      // Whole-season match list, offseason INCLUDED — this diagnostic needs
      // the surrogate flag for every matchKey the sidecar could reference,
      // and the sidecar itself never contains offseason predictions (the
      // harness run that produced it used the default --include-offseason
      // false), so filtering here would only discard rows nothing needs.
      const seasonMatches = selectMatchesChronological(db, { year: season });
      const surrogateAffectedByMatchKey = new Map(
        seasonMatches.map((m) => [m.matchKey, m.redSurrogates.length > 0 || m.blueSurrogates.length > 0])
      );

      const sidecarRecords = await readSidecarRecordsForAlgorithm(sidecarPath, algorithmId);
      const tagged = tagRecordsWithCompletedQuals(sidecarRecords);

      const seasonPredictions: HarnessPredictionInput[] = tagged.map(({ record }) => ({
        matchKey: record.matchKey,
        season,
        // D-T6 (quick task 260901-trz): carried for downstream event-blocked
        // resampling — see `HarnessPredictionInput.eventKey`'s own doc comment.
        eventKey: record.eventKey,
        compLevel: record.compLevel,
        algorithmId,
        pRedWin: record.pRedWin,
        predictedRedScore: record.predictedRedScore,
        predictedBlueScore: record.predictedBlueScore,
        actualWinner: record.actualWinner,
        isOffseason: offseasonEventKeys.has(record.eventKey),
        isSurrogateAffected: surrogateAffectedByMatchKey.get(record.matchKey) ?? false,
      }));

      const unbucketed = poolPredictions(seasonPredictions);
      reconciliation.push(buildReconciliationEntry(season, unbucketed, artifact, algorithmId));

      tagged.forEach((t, i) => {
        taggedAll.push({ input: seasonPredictions[i]!, completedBefore: t.completedBefore, bucket: t.bucket });
      });

      // D-07's mechanism half: rank vs. team count at fixed checkpoints,
      // pooled across every non-offseason event this season.
      const qualMatchesByEvent = groupQualMatchesByEvent(seasonMatches, offseasonEventKeys);
      for (const qualMatches of qualMatchesByEvent.values()) {
        for (const checkpoint of RANK_CHECKPOINTS) {
          if (!eventReachesCheckpoint(qualMatches.length, checkpoint)) continue;
          const rows = buildCheckpointRows(qualMatches, checkpoint);
          designResultsByCheckpoint.get(checkpoint)!.push(computeDesignMatrix(rows));
        }
      }
    }
  } finally {
    db.close();
  }

  // T-03.2-18: fail loudly rather than publish a bucketed curve that
  // partitions a different population than the headline figures.
  const mismatches = reconciliation.filter((r) => !r.matches);
  if (mismatches.length > 0) {
    const detail = mismatches
      .map(
        (m) =>
          `season ${m.season}: unbucketed={brier=${m.unbucketed.brierScore}, acc=${m.unbucketed.winnerAccuracy}, n=${m.unbucketed.scoredCount}} vs artifact={brier=${m.artifact.brierScore}, acc=${m.artifact.winnerAccuracy}, n=${m.artifact.scoredCount}}`
      )
      .join("; ");
    throw new Error(
      `eventScopeDiagnostic: reconciliation FAILED — the bucketed population does not match the artifact's own combined slice for algorithm "${algorithmId}" (${detail})`
    );
  }

  const accuracyBuckets = computeAccuracyBuckets(taggedAll);
  const bucketSum = accuracyBuckets.reduce((sum, b) => sum + b.scoredCount, 0);
  const unbucketedSum = reconciliation.reduce((sum, r) => sum + r.unbucketed.scoredCount, 0);
  if (bucketSum !== unbucketedSum) {
    throw new Error(
      `eventScopeDiagnostic: bucket partition is not exhaustive — six buckets sum to ${bucketSum} but the unbucketed total is ${unbucketedSum}`
    );
  }

  const rankCheckpoints = RANK_CHECKPOINTS.map((cp) => summarizeCheckpoint(cp, designResultsByCheckpoint.get(cp) ?? []));
  const warmCutResult = computeWarmCut(taggedAll);

  const reportCandidate: EventScopeDiagnosticReport = {
    generatedAt: new Date().toISOString(),
    algorithm: algorithmId,
    seasons,
    provenance: {
      runDir,
      artifactRunTimestamp: artifact.provenance.runTimestamp,
      command: `pnpm event-scope-diagnostic --run-dir ${runDir} --seasons ${seasonsSpec} --algorithm ${algorithmId} --out ${outPath}${summaryOutPath ? ` --summary-out ${summaryOutPath}` : ""}`,
    },
    methodology: {
      bucketBoundaries: [...BUCKET_ORDER],
      normalEquationsNote: NORMAL_EQUATIONS_METHODOLOGY_NOTE,
    },
    accuracyBuckets,
    rankCheckpoints,
    reconciliation,
    warmCut: { ...warmCutResult, note: WARM_CUT_NOTE },
  };
  // Validate-then-write (artifact.ts's/promote.ts's own discipline): a
  // malformed report fails at generation time, not at read time.
  const report = EventScopeDiagnosticReportSchema.parse(reportCandidate);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`Wrote ${outPath}`);
  for (const bucket of accuracyBuckets) {
    console.log(
      `  bucket ${bucket.bucket}: brier=${bucket.brierScore?.toFixed(4) ?? "null"} accuracy=${bucket.winnerAccuracy?.toFixed(4) ?? "null"} n=${bucket.scoredCount}`
    );
  }
  for (const cp of rankCheckpoints) {
    console.log(
      `  checkpoint ${cp.completedQuals}: rank ${cp.meanRank.toFixed(1)}/${cp.meanTeamColumnCount.toFixed(1)} full=${(cp.fullColumnRankFraction * 100).toFixed(1)}% (${cp.eventCount} events)`
    );
  }
  console.log(
    `  warmCut: all brier=${report.warmCut.allMatches.brierScore?.toFixed(4) ?? "null"} n=${report.warmCut.allMatches.scoredCount} | ` +
      `warm brier=${report.warmCut.warmOnly.brierScore?.toFixed(4) ?? "null"} n=${report.warmCut.warmOnly.scoredCount} | ` +
      `cold brier=${report.warmCut.coldOnly.brierScore?.toFixed(4) ?? "null"} n=${report.warmCut.coldOnly.scoredCount}`
  );

  if (summaryOutPath) {
    // Task 2's own instruction: keep the committed summary to the pooled
    // figures only (six buckets, six checkpoints, reconciliation booleans,
    // provenance) — per-event detail stays in the gitignored --out report.
    mkdirSync(dirname(summaryOutPath), { recursive: true });
    writeFileSync(summaryOutPath, JSON.stringify(report, null, 2), "utf8");
    console.log(`Wrote ${summaryOutPath}`);
  }
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("eventScopeDiagnostic failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
