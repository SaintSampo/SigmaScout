/**
 * Re-measures F3's mean deficit (`.planning/todos/pending/ranking-points-audit.md`)
 * — the leading cause behind F2's 2.06x under-prediction of published bonus
 * probabilities — restricted to the population `packages/core/rankingPoints/`
 * actually predicts for.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SCRIPT EXISTS (the ROADMAP's second hard sequencing constraint)
 * ---------------------------------------------------------------------------
 *
 * The original F3 probe found the predicted alliance mean below the observed
 * mean in 33 of 34 season-variables, typically 8-15% low. That probe pooled
 * EVERY alliance-side observation, including rosters where one or more teams
 * had little or no history yet — a genuinely different population from the
 * one `RpMomentsAccumulator.momentsFor` predicts for once an event is
 * underway, where most rosters are fully warm. A marginal family chosen
 * against a deficit measured on the wrong population is a fix aimed at the
 * wrong cause. This script re-measures the same deficit restricted to
 * fully-warm 3/3 rosters, so 09-05 and 09-06 have the right number to act on.
 *
 * ---------------------------------------------------------------------------
 * TWO NAMED ARMS, ONE WALK-FORWARD PASS, ONE ACCUMULATOR
 * ---------------------------------------------------------------------------
 *
 * - `all-rosters` — every alliance-side observation, the original probe's
 *   population, carried so the two arms are directly comparable.
 * - `warm-3of3` — only alliance-sides whose roster has exactly 3 teams, every
 *   one of which satisfies `RpMomentsAccumulator.hasHistory` (the accumulator's
 *   own "this prediction rests on real history" predicate — not re-derived
 *   here, see `isFullyWarmRoster` below).
 *
 * Both arms are produced by driving ONE `RpMomentsAccumulator` instance
 * chronologically through ONE walk-forward pass per season and differ by a
 * roster filter applied to the SAME (predicted mean, observed value) pair —
 * never by a second computation. This is `measureRewindGap.ts`'s two-named-
 * arms convention (D-11's same-scorer discipline) applied one level down.
 *
 * ---------------------------------------------------------------------------
 * ALGORITHM-INDEPENDENT
 * ---------------------------------------------------------------------------
 *
 * `RpMomentsAccumulator` is fed only by `ruleModule.parse`'s observed
 * threshold variables; `momentsFor`'s `scoreMean`/`scoreVariance` arguments
 * pass straight through to `AllianceRpMoments` and never touch `meanVector`
 * (`empiricalMoments.ts`). This script therefore resolves no algorithm and
 * runs no `WalkForwardSimulator` — reading a mean vector needs neither, and
 * driving ten seasons through `SigmaScoutLayer.foldPlayed` with a real
 * algorithm would pay the 4,000-draw Monte Carlo cost this phase deletes for
 * nothing this script needs.
 *
 * ---------------------------------------------------------------------------
 * D-04's SELECTION/REPORTING SLICE SPLIT
 * ---------------------------------------------------------------------------
 *
 * Output is split into a SELECTION SLICE (2016-2020, 2022) and a REPORTING
 * SLICE (2023-2026, reported but not acted on). This measurement is
 * descriptive and selects nothing — but a reader must not mistake a
 * reporting-slice number for one that informed a choice. Any decision 09-05
 * or 09-06 derive from this record must cite the selection slice.
 *
 * ---------------------------------------------------------------------------
 * CREDENTIAL-FREE
 * ---------------------------------------------------------------------------
 *
 * This script reads the corpus READ-ONLY and touches NO credential of any
 * kind: no network request, no R2 client, no environment variable, and its
 * `package.json` entry deliberately omits the environment-file flag, placing
 * it with `tune`, `promote`, `identifiability` and `measure:rewind-gap` — the
 * corpus-only offline scripts — rather than with the credentialed ones.
 * `.env` is never read, printed, copied or interpolated.
 *
 * Usage:
 *   npx tsx scripts/measureRpMeanDeficit.ts [--seasons 2016-2020,2022-2026] [--json]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { MatchResult } from "../packages/core/algorithms/types.js";
import type { RpRuleModule } from "../packages/core/rankingPoints/constants.js";
import { isRpEligibleEventType } from "../packages/core/rankingPoints/constants.js";
import { RpMomentsAccumulator } from "../packages/core/rankingPoints/empiricalMoments.js";
import { RP_RULE_MODULES } from "../packages/core/rankingPoints/rules.js";
import { openCorpusReadOnly, type Corpus } from "../packages/corpus/db.js";
import { buildSeasonStream } from "../packages/harness/replay.js";

const CORPUS_PATH = "data/corpus.sqlite";

/** D-04: the two seasons slices this record's output is split under. Selection informs a choice (none is made here); reporting is out-of-sample. */
export const SELECTION_SLICE_SEASONS = [2016, 2017, 2018, 2019, 2020, 2022] as const;
export const REPORTING_SLICE_SEASONS = [2023, 2024, 2025, 2026] as const;

// ---------------------------------------------------------------------------
// Pure helpers (Task 1)
// ---------------------------------------------------------------------------

/** `"2016-2020,2022-2026"` -> every registered season in that range, in order. A season with no registered rule module (2021, and any unregistered future/past season) is silently dropped rather than throwing. */
export function parseSeasons(spec: string): number[] {
  const seasons: number[] = [];
  for (const part of spec.split(",")) {
    const range = part.split("-").map((n) => Number.parseInt(n.trim(), 10));
    if (range.length === 2 && Number.isFinite(range[0]) && Number.isFinite(range[1])) {
      for (let s = range[0]!; s <= range[1]!; s++) seasons.push(s);
    } else if (range.length === 1 && Number.isFinite(range[0])) {
      seasons.push(range[0]!);
    }
  }
  return seasons.filter((s) => RP_RULE_MODULES[s] !== undefined);
}

/**
 * `warm-3of3`'s membership predicate: exactly 3 teams, every one satisfying
 * `RpMomentsAccumulator.hasHistory` — the accumulator's own "this prediction
 * rests on real history" cue (`empiricalMoments.ts`), not re-derived here. A
 * 2-team roster (surrogate-shrunk) is a different population even if both
 * teams are individually warm, which is why the length check is exact
 * equality rather than "at least 3".
 */
export function isFullyWarmRoster(accumulator: RpMomentsAccumulator, roster: readonly string[]): boolean {
  return roster.length === 3 && roster.every((teamKey) => accumulator.hasHistory(teamKey));
}

/**
 * Signed fraction, matching the audit's "-12.2%"-style column: a predicted
 * mean BELOW observed is a POSITIVE deficit. Returns `undefined` rather than
 * `NaN`/`Infinity` when `observedMean` is 0 — a zero-observed variable must
 * never format as a 100% deficit.
 */
export function deficitFraction(observedMean: number, predictedMean: number): number | undefined {
  if (observedMean === 0) return undefined;
  return (observedMean - predictedMean) / observedMean;
}

export type Side = "red" | "blue";

/** One threshold-variable observation captured PRE-FOLD, for one (match, side, variable). */
export interface ThresholdObservationRecord {
  readonly side: Side;
  readonly variable: string;
  readonly predictedMean: number;
  readonly observedValue: number;
  /** `isFullyWarmRoster`'s answer for this side, evaluated PRE-FOLD, same as `predictedMean`. */
  readonly warm: boolean;
}

export interface SideFoldOutcome {
  readonly parsed: boolean;
  readonly records: readonly ThresholdObservationRecord[];
}

export interface FoldMatchResult {
  /** `false` when the match-level guard (event type, breakdown presence) rejected the whole match — neither side was even attempted. */
  readonly eligible: boolean;
  readonly sideResults: Readonly<Record<Side, SideFoldOutcome>>;
}

const INELIGIBLE_RESULT: FoldMatchResult = {
  eligible: false,
  sideResults: {
    red: { parsed: false, records: [] },
    blue: { parsed: false, records: [] },
  },
};

/**
 * The (a)-(f) walk-forward fold body, factored out so the equivalence test
 * can call EXACTLY the code this script's measurement runs. Reproduces
 * `SigmaScoutLayer`'s own private `#foldObservedThresholds`
 * (`packages/harness/sigmaScoutLayer.ts`) guard-for-guard:
 *
 *   a. Match-level guard: RP-eligible event type AND `hasScoreBreakdown` AND
 *      `scoreBreakdownRaw !== null`. Either failing skips the WHOLE match —
 *      neither side is attempted.
 *   b-c. Per side, capture the PRE-FOLD predicted mean vector
 *      (`momentsFor(roster, 0, 0).meanVector` — the zero score arguments
 *      cannot influence `meanVector`, see `empiricalMoments.ts`) and the
 *      PRE-FOLD `isFullyWarmRoster` verdict.
 *   d. Parse inside a try/catch that degrades to a counted skip for THAT
 *      SIDE ONLY — never aborts the match, matching the shipped layer's
 *      per-side try/catch.
 *   e. Emit one `ThresholdObservationRecord` per parsed (side, variable).
 *   f. Fold — but ONLY for a side that parsed successfully, exactly as the
 *      shipped layer's per-side try/catch does (a failed side is never
 *      folded).
 */
export function foldObservedThresholds(accumulator: RpMomentsAccumulator, ruleModule: RpRuleModule, match: MatchResult): FoldMatchResult {
  if (!isRpEligibleEventType(match.eventType) || !match.hasScoreBreakdown || match.scoreBreakdownRaw === null) {
    return INELIGIBLE_RESULT;
  }

  const sideResults: Record<Side, { parsed: boolean; records: ThresholdObservationRecord[] }> = {
    red: { parsed: false, records: [] },
    blue: { parsed: false, records: [] },
  };

  for (const side of ["red", "blue"] as const) {
    const roster = side === "red" ? match.redTeams : match.blueTeams;
    // PRE-FOLD snapshot — predict-before-update, same discipline as every
    // other walk-forward loop in this project.
    const preFold = accumulator.momentsFor(roster, 0, 0);
    const warm = isFullyWarmRoster(accumulator, roster);

    let parsedVars: Record<string, number> | undefined;
    try {
      parsedVars = ruleModule.parse(JSON.parse(match.scoreBreakdownRaw), side, match.eventType).thresholdVariables;
    } catch {
      // Degrades to a counted skip, not an abort — the same discipline the
      // shipped layer's own per-side try/catch applies.
      parsedVars = undefined;
    }

    if (parsedVars !== undefined) {
      sideResults[side].parsed = true;
      const names = accumulator.variableNames;
      for (let i = 0; i < names.length; i++) {
        const name = names[i]!;
        const observedValue = parsedVars[name];
        if (observedValue === undefined) continue;
        sideResults[side].records.push({ side, variable: name, predictedMean: preFold.meanVector[i]!, observedValue, warm });
      }
      accumulator.fold(roster, parsedVars);
    }
  }

  return { eligible: true, sideResults };
}

// ---------------------------------------------------------------------------
// Reporting types (Task 1, steps 3-5)
// ---------------------------------------------------------------------------

export type ArmName = "all-rosters" | "warm-3of3";

export interface SeasonVariableRow {
  readonly season: number;
  readonly variable: string;
  readonly n: number;
  readonly predictedMean: number;
  readonly observedMean: number;
  readonly deficitFraction: number | undefined;
}

export interface ArmHeadline {
  readonly below: number;
  readonly total: number;
}

export interface CensusReport {
  readonly totalMatches: number;
  readonly skippedIneligibleEventType: number;
  readonly skippedMissingBreakdown: number;
  readonly skippedParseFailureSides: number;
  readonly allRostersSides: number;
  readonly warm3of3Sides: number;
  readonly warm3of3ShareOfAllRosters: number;
}

export interface MeanDeficitReport {
  readonly generatedAt: string;
  readonly command: string;
  readonly seasons: readonly number[];
  readonly selectionSeasons: readonly number[];
  readonly reportingSeasons: readonly number[];
  readonly census: CensusReport;
  readonly rows: {
    readonly allRosters: readonly SeasonVariableRow[];
    readonly warm3of3: readonly SeasonVariableRow[];
  };
  readonly headline: {
    readonly allRosters: ArmHeadline;
    readonly warm3of3: ArmHeadline;
  };
}

/** Running (n, sum-of-predicted, sum-of-observed) accumulator for one (season, variable, arm) cell. */
interface RunningSums {
  n: number;
  predictedSum: number;
  observedSum: number;
}

function emptyRunningSums(): RunningSums {
  return { n: 0, predictedSum: 0, observedSum: 0 };
}

function rowFrom(season: number, variable: string, sums: RunningSums): SeasonVariableRow {
  const predictedMean = sums.n > 0 ? sums.predictedSum / sums.n : Number.NaN;
  const observedMean = sums.n > 0 ? sums.observedSum / sums.n : Number.NaN;
  return { season, variable, n: sums.n, predictedMean, observedMean, deficitFraction: deficitFraction(observedMean, predictedMean) };
}

function headlineFrom(rows: readonly SeasonVariableRow[]): ArmHeadline {
  const withData = rows.filter((r) => r.n > 0);
  const below = withData.filter((r) => r.predictedMean < r.observedMean).length;
  return { below, total: withData.length };
}

/**
 * Runs the full walk-forward pass across `seasons`, one `RpMomentsAccumulator`
 * per season, and returns the report `--json`/the console printer both read
 * from — the single source both are built from.
 */
export function runMeasurement(db: Corpus, seasons: readonly number[], command: string): MeanDeficitReport {
  const allRosterSums = new Map<string, RunningSums>(); // key: `${season}::${variable}`
  const warmSums = new Map<string, RunningSums>();

  let totalMatches = 0;
  let skippedIneligibleEventType = 0;
  let skippedMissingBreakdown = 0;
  let skippedParseFailureSides = 0;
  let allRostersSides = 0;
  let warm3of3Sides = 0;

  for (const season of seasons) {
    const ruleModule = RP_RULE_MODULES[season];
    if (ruleModule === undefined) continue;
    const accumulator = new RpMomentsAccumulator(ruleModule);
    const stream = buildSeasonStream(db, season, { includeOffseason: true });
    console.log(`── season ${season} — ${stream.length} matches ──`);

    for (const match of stream) {
      totalMatches++;
      const wasIneligible = !isRpEligibleEventType(match.eventType);
      const wasMissingBreakdown = !match.hasScoreBreakdown || match.scoreBreakdownRaw === null;
      const result = foldObservedThresholds(accumulator, ruleModule, match);

      if (!result.eligible) {
        if (wasIneligible) skippedIneligibleEventType++;
        else if (wasMissingBreakdown) skippedMissingBreakdown++;
        continue;
      }

      for (const side of ["red", "blue"] as const) {
        const outcome = result.sideResults[side];
        if (!outcome.parsed) {
          skippedParseFailureSides++;
          continue;
        }
        allRostersSides++;
        const warmThisSide = outcome.records[0]?.warm ?? false;
        if (warmThisSide) warm3of3Sides++;

        for (const record of outcome.records) {
          const key = `${season}::${record.variable}`;
          let sums = allRosterSums.get(key);
          if (sums === undefined) {
            sums = emptyRunningSums();
            allRosterSums.set(key, sums);
          }
          sums.n++;
          sums.predictedSum += record.predictedMean;
          sums.observedSum += record.observedValue;

          if (record.warm) {
            let warmCell = warmSums.get(key);
            if (warmCell === undefined) {
              warmCell = emptyRunningSums();
              warmSums.set(key, warmCell);
            }
            warmCell.n++;
            warmCell.predictedSum += record.predictedMean;
            warmCell.observedSum += record.observedValue;
          }
        }
      }
    }
  }

  const allRosterRows: SeasonVariableRow[] = [];
  for (const [key, sums] of allRosterSums) {
    const [seasonStr, variable] = key.split("::");
    allRosterRows.push(rowFrom(Number.parseInt(seasonStr!, 10), variable!, sums));
  }
  const warmRows: SeasonVariableRow[] = [];
  for (const [key, sums] of warmSums) {
    const [seasonStr, variable] = key.split("::");
    warmRows.push(rowFrom(Number.parseInt(seasonStr!, 10), variable!, sums));
  }

  const sortRows = (rows: SeasonVariableRow[]) => rows.sort((a, b) => (a.season - b.season) || a.variable.localeCompare(b.variable));
  sortRows(allRosterRows);
  sortRows(warmRows);

  return {
    generatedAt: new Date().toISOString(),
    command,
    seasons: [...seasons],
    selectionSeasons: [...SELECTION_SLICE_SEASONS].filter((s) => seasons.includes(s)),
    reportingSeasons: [...REPORTING_SLICE_SEASONS].filter((s) => seasons.includes(s)),
    census: {
      totalMatches,
      skippedIneligibleEventType,
      skippedMissingBreakdown,
      skippedParseFailureSides,
      allRostersSides,
      warm3of3Sides,
      warm3of3ShareOfAllRosters: allRostersSides > 0 ? warm3of3Sides / allRostersSides : 0,
    },
    rows: { allRosters: allRosterRows, warm3of3: warmRows },
    headline: { allRosters: headlineFrom(allRosterRows), warm3of3: headlineFrom(warmRows) },
  };
}

// ---------------------------------------------------------------------------
// Console report (Task 1, steps 3-4)
// ---------------------------------------------------------------------------

function printSlice(title: string, seasons: readonly number[], rows: { allRosters: readonly SeasonVariableRow[]; warm3of3: readonly SeasonVariableRow[] }): void {
  console.log(`\n${title}`);
  for (const season of seasons) {
    console.log(`  season ${season}:`);
    for (const arm of ["all-rosters", "warm-3of3"] as const) {
      const rowsForArm = arm === "all-rosters" ? rows.allRosters : rows.warm3of3;
      for (const row of rowsForArm.filter((r) => r.season === season)) {
        const gap = row.deficitFraction === undefined ? "  n/a" : `${(row.deficitFraction * 100).toFixed(1)}%`;
        console.log(
          `    [${arm}] ${row.variable}: n=${row.n}  predicted=${row.predictedMean.toFixed(4)}  observed=${row.observedMean.toFixed(4)}  deficit=${gap}`
        );
      }
    }
  }
}

function printReport(report: MeanDeficitReport): void {
  printSlice("SELECTION SLICE (2016-2020, 2022)", report.selectionSeasons, report.rows);
  printSlice("REPORTING SLICE (2023-2026 — reported, not acted on)", report.reportingSeasons, report.rows);
  console.log(`\nAny decision derived from this record cites the SELECTION SLICE (2016-2020, 2022), never the reporting slice.`);

  console.log(`\nHeadline — season-variables with a predicted mean below the observed mean:`);
  console.log(`  all-rosters: ${report.headline.allRosters.below} of ${report.headline.allRosters.total}`);
  console.log(`  warm-3of3:   ${report.headline.warm3of3.below} of ${report.headline.warm3of3.total}`);

  console.log(`\nCensus:`);
  console.log(`  total matches seen:              ${report.census.totalMatches}`);
  console.log(`  skipped — ineligible event type:  ${report.census.skippedIneligibleEventType}`);
  console.log(`  skipped — missing breakdown:      ${report.census.skippedMissingBreakdown}`);
  console.log(`  skipped — parse failure (sides):  ${report.census.skippedParseFailureSides}`);
  console.log(`  alliance-sides in all-rosters:    ${report.census.allRostersSides}`);
  console.log(`  alliance-sides in warm-3of3:      ${report.census.warm3of3Sides}`);
  console.log(`  warm-3of3 share of all-rosters:   ${(report.census.warm3of3ShareOfAllRosters * 100).toFixed(2)}%`);
}

export const RP_MEAN_DEFICIT_DOC_PATH = "docs/models/rp-mean-deficit-warm-rosters.md";
export const RP_MEAN_DEFICIT_BLOCK_PATTERN = /```json rp-mean-deficit\r?\n([\s\S]*?)\r?\n```/;

function writeDeficitBlock(doc: string, report: MeanDeficitReport): string {
  const block = "```json rp-mean-deficit\n" + JSON.stringify(report, null, 2) + "\n```";
  if (RP_MEAN_DEFICIT_BLOCK_PATTERN.test(doc)) return doc.replace(RP_MEAN_DEFICIT_BLOCK_PATTERN, block);
  return `${doc}\n${block}\n`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonsSpec = args[args.indexOf("--seasons") + 1] ?? "2016-2020,2022-2026";
  const emitJson = args.includes("--json");
  const writeDoc = args.includes("--write-doc");
  const seasons = parseSeasons(seasonsSpec);
  const command = `npx tsx scripts/measureRpMeanDeficit.ts --seasons ${seasonsSpec}`;

  console.log(`RP mean-deficit re-measurement — seasons ${seasons.join(", ")}`);
  console.log(`Two arms, one walk-forward pass, one accumulator per season: all-rosters vs warm-3of3.\n`);

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    const report = runMeasurement(db, seasons, command);
    printReport(report);
    if (emitJson) console.log(`\n${JSON.stringify(report, null, 2)}`);
    if (writeDoc) {
      if (!existsSync(RP_MEAN_DEFICIT_DOC_PATH)) {
        throw new Error(`measureRpMeanDeficit: --write-doc requires ${RP_MEAN_DEFICIT_DOC_PATH} to already exist with a placeholder rp-mean-deficit block`);
      }
      const doc = readFileSync(RP_MEAN_DEFICIT_DOC_PATH, "utf8");
      writeFileSync(RP_MEAN_DEFICIT_DOC_PATH, writeDeficitBlock(doc, report), "utf8");
      console.log(`\nmeasureRpMeanDeficit: wrote ${RP_MEAN_DEFICIT_DOC_PATH}`);
    }
  } finally {
    db.close();
  }
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("measureRpMeanDeficit failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
