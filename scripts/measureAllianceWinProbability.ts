/**
 * Measures the BROWSER'S alliance win probability against the site's own
 * published `pRedWin`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SCRIPT EXISTS
 * ---------------------------------------------------------------------------
 *
 * `packages/core/algorithms/simulation/allianceWinProbability.ts` prices any
 * two rosters from the two numbers a published event artifact carries per team
 * (`metrics["total"].value`, `metrics["sigma"].value`). 10-RESEARCH.md rates the
 * assumption behind it — that `Phi((meanA - meanB) / sqrt(varA + varB))` over
 * the uncorrected `sum Sigma^2` is an honest approximation of SPR's real
 * `predict()` — as HIGH risk and genuinely unmeasured.
 *
 * A published number with no committed harness is the failure this project's
 * log names as its original sin. This script is that harness. 10-04 prices a
 * district bracket with the function; 10-08 states the gap on the methodology
 * page. Both quote what this printed, and nothing else.
 *
 * NO CONTROL ARM CAN RECONSTRUCT `pRedWin` FROM PUBLISHED FIELDS.
 * `Prediction.variance`'s own doc comment says so outright: `pRedWin` is
 * computed from SPR's RAW uncalibrated rating-space variance through a learned
 * `tau`, while the published `spread`/`variance` fields are display-calibrated
 * and structurally different quantities. That is exactly why the substitution
 * is measured end to end here rather than argued about.
 *
 * ---------------------------------------------------------------------------
 * WALK-FORWARD BY CONSTRUCTION
 * ---------------------------------------------------------------------------
 *
 * Every number the new formula sees comes from `scripts/publishedSprSnapshots.ts`
 * and nothing else: per played match, each involved team's `total` and `sigma`
 * as of its most recently played match STRICTLY BEFORE this one — which is what
 * a published event artifact carries for that team. A first-appearance team is
 * absent from the snapshot and its row is counted `unpriceable`, never
 * defaulted. Warmup seasons are replayed and not counted.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR ARMS
 * ---------------------------------------------------------------------------
 *
 *   browser-formula   the new function over the before-match snapshot.
 *   published         `record.prediction.pRedWin` — what the site shows.
 *   coin              constant 0.5, the no-information floor that gives the
 *                     gap a scale.
 *   sign-only         clamped by the SIGN of the mean difference alone, which
 *                     separates how much of the formula's skill is the mean
 *                     from how much is the variance.
 *
 * ALL FOUR are scored through `scoreSet` from `packages/core/scoring/brier.ts`
 * and through nothing else. The published Brier counts ties against a target of
 * 0.5 and counts an exact-0.5 prediction as a no-call miss; a scratch
 * accumulator that silently drops ties has already manufactured a ~0.003
 * phantom regression on this project once. Two arms scored by two scorers is
 * not a comparison.
 *
 * ---------------------------------------------------------------------------
 * THE VARIANCE MULTIPLIER DIAGNOSTIC
 * ---------------------------------------------------------------------------
 *
 * The same mean absolute gap and Brier, recomputed with the combined variance
 * multiplied by 1, 2 and 3. The grid is chosen, not arbitrary: 3 is the roster
 * size `sigmaMatchBandVariance` multiplies in for the DISPLAY band, so the
 * multiplier-3 row directly re-tests `sigmaScore.ts`'s own documented finding
 * ("Win and tie odds keep the uncorrected variance: red's and blue's misses are
 * correlated, so widening it worsens Brier") at a new call site. EXPECTED
 * DIRECTION: multiplier 1 wins on Brier. Whatever comes out is reported in
 * whichever direction it came out. THE SHIPPED FUNCTION IS FIXED AT 1 AND THIS
 * SCRIPT PROMOTES NO MULTIPLIER.
 *
 * ---------------------------------------------------------------------------
 * CREDENTIAL-FREE AND OFFLINE
 * ---------------------------------------------------------------------------
 *
 * Read-only corpus, no network request, no R2 client, no environment variable,
 * no credential. Its `package.json` entry (`measure:alliance-win-probability`)
 * deliberately omits the `--env-file=.env` flag that `ingest:*` and `publish:*`
 * carry, joining `measure:match-band` and `measure:award-predictability`
 * instead. The safe state here is structural, not procedural.
 *
 * Usage:
 *   npx tsx scripts/measureAllianceWinProbability.ts [--seasons 2026] [--warmup-from 2026] [--json]
 *   pnpm measure:alliance-win-probability
 */

import { pathToFileURL } from "node:url";
import { openCorpusReadOnly, type Corpus } from "../packages/corpus/db.js";
import { scoreSet, type MatchOutcome, type ScoredPrediction, type ScoreSetResult } from "../packages/core/scoring/brier.js";
import { standardNormalCdf } from "../packages/core/rankingPoints/marginals.js";
import { isFullyDemoAlliance } from "../packages/core/algorithms/demoTeams.js";
import { isFullyDqZeroScoreAlliance } from "../packages/core/algorithms/dq.js";
import {
  allianceWinProbability,
  ALLIANCE_WIN_PROBABILITY_EPSILON,
} from "../packages/core/algorithms/simulation/allianceWinProbability.js";
import {
  ratingsFromSnapshot,
  replayPublishedSprSnapshots,
  type PublishedSprSnapshotRow,
} from "./publishedSprSnapshots.js";
import { parseSeasons } from "./scriptHelpers.js";

const CORPUS_PATH = "data/corpus.sqlite";

// ═══════════════════════════════════════════════════════════════════════════
// RECORDED CONSTANTS
//
// These are what the committed script PRINTED on the date below, over the
// window below. They are not edited after being seen: changing the model means
// re-running the command, not retyping a number. The corpus-guarded describe in
// `measureAllianceWinProbability.test.ts` re-measures the same window and
// asserts each of these within 1e-4, so a model change turns that test red
// rather than leaving a stale number looking true.
//
// 10-08 quotes these on the methodology page.
// ═══════════════════════════════════════════════════════════════════════════

/** The season spec whose rows the recorded figures were measured over. */
export const MEASURED_WINDOW = "2026";
/**
 * The warmup season. Equal to the scored season, i.e. NO earlier warmup: 2026
 * is replayed from the start of its own season.
 *
 * WHY, recorded rather than silently chosen. The wider window
 * (`--seasons 2026 --warmup-from 2025`) was measured first and its
 * corpus-guarded describe ran in 25,248 ms, over the plan's 25 s bar against
 * the node project's 30 s timeout. Per the plan's own instruction the window
 * was narrowed to 2026 alone and BOTH the constants below and the test that
 * pins them were restated in the same commit. The narrowed describe runs in
 * roughly 8 s. The wider run's figures, for reference and NOT pinned anywhere:
 * 20,475 scored rows, mean gap 0.0613, winner disagreement 5.19%, browser
 * Brier 0.1430 against the published 0.1396, accuracy 79.44% against 79.81%.
 * The narrowing costs 683 rows to a larger `unpriceable` count (a team's first
 * 2026 match has no carried-in rating), and moves every figure by less than a
 * point.
 */
export const MEASURED_WARMUP_FROM = 2026;
/** The exact command that produced every recorded constant below. */
export const MEASURED_COMMAND = "npx tsx scripts/measureAllianceWinProbability.ts --seasons 2026 --warmup-from 2026";
/** The date that command was run. */
export const MEASURED_DATE = "2026-09-25";

/** Rows scored by every arm over `MEASURED_WINDOW`. */
export const MEASURED_SCORED_ROWS = 19792;
/** Mean |browser-formula − published| over the scored rows. */
export const MEASURED_MEAN_ABSOLUTE_GAP = 0.05521610065219025;
/** Median |browser-formula − published|. */
export const MEASURED_MEDIAN_ABSOLUTE_GAP = 0.04173061762050173;
/** 90th-percentile |browser-formula − published|. */
export const MEASURED_P90_ABSOLUTE_GAP = 0.12238168934831306;
/** Share of scored rows where the two arms fall on OPPOSITE sides of 0.5. */
export const MEASURED_WINNER_DISAGREEMENT_RATE = 0.04441188358932902;
/** Brier of the new browser formula. */
export const MEASURED_BROWSER_FORMULA_BRIER = 0.14622846507962675;
/** Brier of the site's own published `pRedWin`, over the identical rows. */
export const MEASURED_PUBLISHED_BRIER = 0.1442591501111827;
/** Winner accuracy of the new browser formula. */
export const MEASURED_BROWSER_FORMULA_ACCURACY = 0.7879064114250988;
/** Winner accuracy of the site's own published `pRedWin`, over the identical rows. */
export const MEASURED_PUBLISHED_ACCURACY = 0.79236301022992;

/** Rows the replay emitted for `MEASURED_WINDOW`, before any gate. */
export const MEASURED_TOTAL_ROWS = 20907;
/** Rows excluded because the whole match was a demo alliance. */
export const MEASURED_FULLY_DEMO_MATCH = 120;
/** Rows excluded because one side was a fully-DQ'd zero-score alliance. */
export const MEASURED_FULLY_DQ_ZERO_SCORE_SIDE = 41;
/** Rows excluded because `pRedWin` was forced to exactly 0.5 on a cold-start match. */
export const MEASURED_COLD_START = 0;
/** Rows the BROWSER could not price either: some team had no before-match `total`/`sigma`. */
export const MEASURED_UNPRICEABLE = 954;
/** Brier of the coin floor, over the identical rows. */
export const MEASURED_COIN_BRIER = 0.24941895715440582;
/** Brier of the sign-only arm, over the identical rows. */
export const MEASURED_SIGN_ONLY_BRIER = 0.2111960201100925;

// ───────────────────────────── pure helpers ─────────────────────────────
// Everything in this section is pure and unit-tested in
// measureAllianceWinProbability.test.ts.

export const ARM_NAMES = ["browser-formula", "published", "coin", "sign-only"] as const;
export type ArmName = (typeof ARM_NAMES)[number];

/** The no-information floor: no preference, always. */
export function coinProbability(): number {
  return 0.5;
}

/**
 * The mean difference's SIGN alone, clamped to the same bounds every other arm
 * uses. Separates how much of the formula's skill is the mean from how much is
 * the variance. An exact tie in means is an exact 0.5 — a no-call, which
 * `brier.ts` counts as a miss rather than crediting to a side.
 */
export function signOnlyProbability(meanDifference: number): number {
  const eps = ALLIANCE_WIN_PROBABILITY_EPSILON;
  if (!Number.isFinite(meanDifference) || meanDifference === 0) return 0.5;
  return meanDifference > 0 ? 1 - eps : eps;
}

/**
 * The browser formula with the combined variance scaled by `multiplier`, for
 * the diagnostic only. At `multiplier === 1` it is arithmetically identical to
 * `allianceWinProbability`, which the test asserts rather than assumes.
 */
export function browserFormulaWithMultiplier(
  meanDifference: number,
  combinedVariance: number,
  multiplier: number
): number | undefined {
  const scaled = combinedVariance * multiplier;
  if (!Number.isFinite(scaled) || scaled <= 0) return undefined;
  const z = meanDifference / Math.sqrt(scaled);
  if (!Number.isFinite(z)) return undefined;
  const eps = ALLIANCE_WIN_PROBABILITY_EPSILON;
  return Math.min(1 - eps, Math.max(eps, standardNormalCdf(z)));
}

/** Whether two probabilities fall on OPPOSITE sides of 0.5. An exact 0.5 on either side is not a disagreement about the winner; it is an abstention. */
export function disagreeOnWinner(a: number, b: number): boolean {
  return (a > 0.5 && b < 0.5) || (a < 0.5 && b > 0.5);
}

export interface GapStats {
  readonly mean: number;
  readonly median: number;
  readonly p90: number;
}

/** Mean, median and 90th percentile of a gap vector. `undefined` — never NaN — for an empty vector. */
export function absoluteGapStats(gaps: readonly number[]): GapStats | undefined {
  if (gaps.length === 0) return undefined;
  const sorted = [...gaps].sort((a, b) => a - b);
  const n = sorted.length;
  let sum = 0;
  for (const g of sorted) sum += g;
  const median = n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
  const p90Index = Math.min(n - 1, Math.max(0, Math.ceil(0.9 * n) - 1));
  return { mean: sum / n, median, p90: sorted[p90Index]! };
}

/** Why a row was excluded. Each has its own counter; a lumped `skipped` count cannot be audited. */
export type SkipReason = "fullyDemoMatch" | "fullyDqZeroScoreSide" | "coldStart" | "unpriceable";

/** One scored row, carrying everything every arm and every diagnostic needs. */
export interface ScoredRow {
  readonly season: number;
  readonly matchKey: string;
  readonly meanDifference: number;
  readonly combinedVariance: number;
  readonly browserFormula: number;
  readonly published: number;
  readonly actualWinner: MatchOutcome;
}

export type RowVerdict = { readonly kind: "scored"; readonly row: ScoredRow } | { readonly kind: "skipped"; readonly reason: SkipReason };

/**
 * The gating rules, in one place so each has its own name and each is
 * separately assertable. Order matters only for which counter a doubly-bad row
 * lands in; every rule below excludes the row from every arm.
 */
export function classifyRow(snapshotRow: PublishedSprSnapshotRow): RowVerdict {
  const match = snapshotRow.match;
  if (isFullyDemoAlliance(match.redTeams) || isFullyDemoAlliance(match.blueTeams)) {
    return { kind: "skipped", reason: "fullyDemoMatch" };
  }
  if (
    isFullyDqZeroScoreAlliance(match.redTeams, match.redDqs, match.redScore) ||
    isFullyDqZeroScoreAlliance(match.blueTeams, match.blueDqs, match.blueScore)
  ) {
    return { kind: "skipped", reason: "fullyDqZeroScoreSide" };
  }
  // `pRedWin` was forced to exactly 0.5 on a cold-start match; it is not a
  // prediction to compare against.
  if (snapshotRow.coldStart === true) return { kind: "skipped", reason: "coldStart" };

  const red = ratingsFromSnapshot(match.redTeams, snapshotRow.before);
  const blue = ratingsFromSnapshot(match.blueTeams, snapshotRow.before);
  const browserFormula = allianceWinProbability(red, blue);
  const published = snapshotRow.prediction.pRedWin;
  if (browserFormula === undefined || !Number.isFinite(published)) {
    // The honest name for "the browser could not price this either".
    return { kind: "skipped", reason: "unpriceable" };
  }

  let meanDifference = 0;
  let combinedVariance = 0;
  for (const member of red) {
    meanDifference += member.total!;
    combinedVariance += member.sigma! * member.sigma!;
  }
  for (const member of blue) {
    meanDifference -= member.total!;
    combinedVariance += member.sigma! * member.sigma!;
  }

  return {
    kind: "scored",
    row: {
      season: snapshotRow.season,
      matchKey: match.matchKey,
      meanDifference,
      combinedVariance,
      browserFormula,
      published,
      actualWinner: match.winner,
    },
  };
}

/** Every arm's `scoreSet` block over one row set. One scorer, four arms. */
export function scoreArms(rows: readonly ScoredRow[]): Record<ArmName, ScoreSetResult> {
  const by: Record<ArmName, ScoredPrediction[]> = {
    "browser-formula": [],
    published: [],
    coin: [],
    "sign-only": [],
  };
  for (const row of rows) {
    by["browser-formula"].push({ pRedWin: row.browserFormula, actualWinner: row.actualWinner });
    by.published.push({ pRedWin: row.published, actualWinner: row.actualWinner });
    by.coin.push({ pRedWin: coinProbability(), actualWinner: row.actualWinner });
    by["sign-only"].push({ pRedWin: signOnlyProbability(row.meanDifference), actualWinner: row.actualWinner });
  }
  return {
    "browser-formula": scoreSet(by["browser-formula"]),
    published: scoreSet(by.published),
    coin: scoreSet(by.coin),
    "sign-only": scoreSet(by["sign-only"]),
  };
}

export interface Census {
  totalRows: number;
  fullyDemoMatch: number;
  fullyDqZeroScoreSide: number;
  coldStart: number;
  unpriceable: number;
  scored: number;
}

export function emptyCensus(): Census {
  return { totalRows: 0, fullyDemoMatch: 0, fullyDqZeroScoreSide: 0, coldStart: 0, unpriceable: 0, scored: 0 };
}

/** The share of scored rows where the browser formula and the published number pick different winners. */
export function winnerDisagreementRate(rows: readonly ScoredRow[]): number | undefined {
  if (rows.length === 0) return undefined;
  let disagree = 0;
  for (const row of rows) if (disagreeOnWinner(row.browserFormula, row.published)) disagree++;
  return disagree / rows.length;
}

export interface MultiplierDiagnosticRow {
  readonly multiplier: number;
  readonly meanAbsoluteGap: number | undefined;
  readonly brier: number | null;
  readonly winnerAccuracy: number | null;
}

export const DIAGNOSTIC_MULTIPLIERS = [1, 2, 3] as const;

export function multiplierDiagnostic(rows: readonly ScoredRow[]): MultiplierDiagnosticRow[] {
  return DIAGNOSTIC_MULTIPLIERS.map((multiplier) => {
    const gaps: number[] = [];
    const predictions: ScoredPrediction[] = [];
    for (const row of rows) {
      const p = browserFormulaWithMultiplier(row.meanDifference, row.combinedVariance, multiplier);
      if (p === undefined) continue;
      gaps.push(Math.abs(p - row.published));
      predictions.push({ pRedWin: p, actualWinner: row.actualWinner });
    }
    const scored = scoreSet(predictions);
    return {
      multiplier,
      meanAbsoluteGap: absoluteGapStats(gaps)?.mean,
      brier: scored.brierScore,
      winnerAccuracy: scored.winnerAccuracy,
    };
  });
}

// ───────────────────────────── the measurement ─────────────────────────────

export interface MeasurementResult {
  readonly rowsBySeason: Map<number, ScoredRow[]>;
  readonly censusBySeason: Map<number, Census>;
  readonly pooledRows: ScoredRow[];
  readonly pooledCensus: Census;
}

/** Replays the window and classifies every emitted row. The caller owns `db`. */
export function measureAllianceWinProbability(
  db: Corpus,
  options: { readonly seasons: readonly number[]; readonly warmupFrom?: number }
): MeasurementResult {
  const rowsBySeason = new Map<number, ScoredRow[]>();
  const censusBySeason = new Map<number, Census>();
  const pooledRows: ScoredRow[] = [];
  const pooledCensus = emptyCensus();

  replayPublishedSprSnapshots(db, { seasons: options.seasons, warmupFrom: options.warmupFrom }, (snapshotRow) => {
    const season = snapshotRow.season;
    let census = censusBySeason.get(season);
    if (census === undefined) {
      census = emptyCensus();
      censusBySeason.set(season, census);
      rowsBySeason.set(season, []);
    }
    census.totalRows++;
    pooledCensus.totalRows++;

    const verdict = classifyRow(snapshotRow);
    if (verdict.kind === "skipped") {
      census[verdict.reason]++;
      pooledCensus[verdict.reason]++;
      return;
    }
    census.scored++;
    pooledCensus.scored++;
    rowsBySeason.get(season)!.push(verdict.row);
    pooledRows.push(verdict.row);
  });

  return { rowsBySeason, censusBySeason, pooledRows, pooledCensus };
}

// ───────────────────────────── reporting ─────────────────────────────

function fmt(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return value.toFixed(digits);
}

function share(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(2)}%`;
}

function reportBlock(label: string, rows: readonly ScoredRow[], census: Census): void {
  const gaps = rows.map((r) => Math.abs(r.browserFormula - r.published));
  const stats = absoluteGapStats(gaps);
  const arms = scoreArms(rows);

  console.log(`── ${label} ──`);
  console.log(`   scored rows: ${census.scored} of ${census.totalRows} replayed`);
  console.log(
    `   |browser-formula − published|   mean ${fmt(stats?.mean)}   median ${fmt(stats?.median)}   p90 ${fmt(stats?.p90)}`
  );
  console.log(`   winner disagreement (opposite sides of 0.5): ${share(winnerDisagreementRate(rows))}`);
  console.log(`   ARM                 Brier      accuracy    no-calls   ties     n`);
  for (const arm of ARM_NAMES) {
    const s = arms[arm];
    console.log(
      `   ${arm.padEnd(18)} ${fmt(s.brierScore).padStart(8)}   ${share(s.winnerAccuracy).padStart(8)}   ` +
        `${String(s.noCallCount).padStart(8)}   ${String(s.tieCount).padStart(5)}   ${String(s.count).padStart(6)}`
    );
  }
  console.log(
    `   CENSUS  total ${census.totalRows}   fullyDemoMatch ${census.fullyDemoMatch}   fullyDqZeroScoreSide ${census.fullyDqZeroScoreSide}   ` +
      `coldStart ${census.coldStart}   unpriceable ${census.unpriceable} (${share(census.totalRows === 0 ? undefined : census.unpriceable / census.totalRows)} of total)`
  );
  console.log("");
}

function reportMultiplierDiagnostic(rows: readonly ScoredRow[]): void {
  console.log(`── VARIANCE MULTIPLIER DIAGNOSTIC ──`);
  console.log(`   multiplier   mean |gap|   Brier      accuracy`);
  for (const row of multiplierDiagnostic(rows)) {
    console.log(
      `   ${String(row.multiplier).padStart(10)}   ${fmt(row.meanAbsoluteGap).padStart(10)}   ${fmt(row.brier).padStart(8)}   ${share(
        row.winnerAccuracy
      ).padStart(8)}`
    );
  }
  console.log(`   Multiplier 3 is the roster size sigmaMatchBandVariance multiplies in for the DISPLAY band.`);
  console.log(`   THE SHIPPED FUNCTION USES MULTIPLIER 1. THIS PLAN PROMOTES NO MULTIPLIER.`);
  console.log("");
}

function reportPracticalAnswer(rows: readonly ScoredRow[]): void {
  const gaps = rows.map((r) => Math.abs(r.browserFormula - r.published));
  const stats = absoluteGapStats(gaps);
  const arms = scoreArms(rows);
  const disagreement = winnerDisagreementRate(rows);
  const brierGap =
    arms["browser-formula"].brierScore !== null && arms.published.brierScore !== null
      ? arms["browser-formula"].brierScore - arms.published.brierScore
      : null;

  console.log(`── PRACTICAL ANSWER ──`);
  console.log(
    `   Over ${rows.length} played matches, the number a visitor's browser can compute for itself from a\n` +
      `   published event artifact sits ${fmt(stats?.mean, 3)} away from the number the site itself shows, on average;\n` +
      `   half the time it is within ${fmt(stats?.median, 3)}, and one match in ten is off by more than ${fmt(stats?.p90, 3)}.\n` +
      `   The two pick DIFFERENT winners on ${share(disagreement)} of those matches. Scored against what actually\n` +
      `   happened, the browser formula's Brier is ${fmt(arms["browser-formula"].brierScore)} against the published\n` +
      `   ${fmt(arms.published.brierScore)} (a gap of ${fmt(brierGap)}), and it calls the winner right ${share(
        arms["browser-formula"].winnerAccuracy
      )} of the\n` +
      `   time against the published ${share(arms.published.winnerAccuracy)}. Both are far better than the coin floor\n` +
      `   (Brier ${fmt(arms.coin.brierScore)}), and better than the sign of the mean difference alone\n` +
      `   (Brier ${fmt(arms["sign-only"].brierScore)}), so the variance term is doing real work.\n` +
      `   For a bracket priced with it: the ORDER of two alliances is right the large majority of the time,\n` +
      `   but the CONFIDENCE is not the site's confidence, so a bracket probability built this way should be\n` +
      `   read as an approximation of the site's own number rather than as the same number.`
  );
  console.log("");
}

interface JsonOutput {
  window: string;
  warmupFrom: number | undefined;
  command: string;
  date: string;
  seasons: Array<{
    season: number;
    census: Census;
    gap: GapStats | undefined;
    winnerDisagreementRate: number | undefined;
    arms: Record<ArmName, ScoreSetResult>;
  }>;
  pooled: {
    census: Census;
    gap: GapStats | undefined;
    winnerDisagreementRate: number | undefined;
    arms: Record<ArmName, ScoreSetResult>;
    multiplierDiagnostic: MultiplierDiagnosticRow[];
  };
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonSpec = flagValue(args, "--seasons") ?? MEASURED_WINDOW;
  const seasons = parseSeasons(seasonSpec);
  const warmupSpec = flagValue(args, "--warmup-from") ?? String(MEASURED_WARMUP_FROM);
  const parsedWarmup = Number.parseInt(warmupSpec, 10);
  const warmupFrom = Number.isFinite(parsedWarmup) ? parsedWarmup : undefined;
  const asJson = args.includes("--json");

  if (!asJson) {
    console.log(`ALLIANCE WIN PROBABILITY — the browser's formula against the site's own pRedWin.`);
    console.log(`seasons:    ${seasons.join(", ")} counted; warmup from ${warmupFrom ?? "none"} (replayed, not counted)`);
    console.log(`arms:       ${ARM_NAMES.join(", ")} — every one scored through packages/core/scoring/brier.ts's scoreSet`);
    console.log(`variance:   the UNCORRECTED sum of squared Sigma Scores, never sigmaMatchBandVariance's display band`);
    console.log(`credential: none. Read-only corpus, no network request, no environment variable.`);
    console.log(``);
  }

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    const result = measureAllianceWinProbability(db, { seasons, warmupFrom });

    if (asJson) {
      const out: JsonOutput = {
        window: seasonSpec,
        warmupFrom,
        command: MEASURED_COMMAND,
        date: MEASURED_DATE,
        seasons: [...result.rowsBySeason.keys()]
          .sort((a, b) => a - b)
          .map((season) => {
            const rows = result.rowsBySeason.get(season)!;
            return {
              season,
              census: result.censusBySeason.get(season)!,
              gap: absoluteGapStats(rows.map((r) => Math.abs(r.browserFormula - r.published))),
              winnerDisagreementRate: winnerDisagreementRate(rows),
              arms: scoreArms(rows),
            };
          }),
        pooled: {
          census: result.pooledCensus,
          gap: absoluteGapStats(result.pooledRows.map((r) => Math.abs(r.browserFormula - r.published))),
          winnerDisagreementRate: winnerDisagreementRate(result.pooledRows),
          arms: scoreArms(result.pooledRows),
          multiplierDiagnostic: multiplierDiagnostic(result.pooledRows),
        },
      };
      console.log(JSON.stringify(out, null, 2));
      return;
    }

    for (const season of [...result.rowsBySeason.keys()].sort((a, b) => a - b)) {
      reportBlock(`${season}`, result.rowsBySeason.get(season)!, result.censusBySeason.get(season)!);
    }
    if (result.rowsBySeason.size > 1) {
      reportBlock(`POOLED ${seasons[0]} to ${seasons[seasons.length - 1]}`, result.pooledRows, result.pooledCensus);
    }
    reportMultiplierDiagnostic(result.pooledRows);
    reportPracticalAnswer(result.pooledRows);
  } finally {
    db.close();
  }
}

// Guard: only auto-run `main()` when this file is the process entry point, so
// the pure helpers above can be imported by the test file without opening a
// corpus.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("measure:alliance-win-probability failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
