/**
 * The offline EPA-vs-Statbotics comparison publisher (quick task 260908-n5o
 * Task 2), shaped like `scripts/publishDistricts.ts`: `parseArgs` from
 * `node:util`, deep relative imports with explicit `.js` extensions, a
 * `main()` guarded on being the process entry point, non-zero exit on
 * failure.
 *
 * This file never reads, prints or interpolates `.env` or any value from
 * it — `putObject` (`packages/harness/r2Client.js`) reads its own
 * credentials from `process.env`, exactly as every other publish tool in
 * this repo does; this file never touches `process.env` directly.
 * `--dry-run` composes, validates (through `EpaComparisonArtifactSchema`)
 * and prints the composed object's byte size without ever calling
 * `putObject`.
 *
 * Revision, same day, after reviewing the shipped page: this used to take
 * TWO report files, `--inclusive`/`--excluded`, and compose them into a
 * two-arm agreement table (offseason included vs excluded, both against
 * each team's season-final total). That table measured a quantity nobody is
 * shown anywhere on this site — see `EpaComparisonAgreementRowSchema`'s own
 * doc comment in `packages/harness/pageArtifacts.ts` for the measurement
 * that caught it. This publisher now takes ONE report file, `--report`,
 * which carries the `officialOnly` arm `scripts/epaVsStatbotics.ts` now
 * measures, and composes `agreement` from that arm alone.
 * `MismatchedEpaVersionError`, `MismatchedSeasonSetError` and
 * `MislabelledArmError` existed to stop two arm reports disagreeing with
 * each other or landing in the wrong CLI slot; with one report file there is
 * no second arm and no slot to mislabel, so all three are gone. The
 * anti-drift gate that remains, `MissingOfficialOnlyArmError`, is in the
 * same spirit: a report produced by a stale copy of `epaVsStatbotics.ts`
 * (one that predates the `officialOnly` arm) throws a NAMED error and
 * publishes nothing, rather than silently composing an artifact against the
 * wrong quantity all over again (this quick task's own `<threat_model>`
 * T-n5o-01).
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  epaComparisonKey,
  EpaComparisonArtifactSchema,
  PAGE_ARTIFACT_SCHEMA_VERSION,
  type EpaComparisonArtifact,
} from "../packages/harness/pageArtifacts.js";
import { putObject } from "../packages/harness/r2Client.js";
import type { EpaVsStatboticsReport } from "./epaVsStatbotics.js";

const DEFAULT_BUCKET = "sigmascout-artifacts";

// ---------------------------------------------------------------------------
// Composition gate — a named error, never a console warning or a best-effort merge
// ---------------------------------------------------------------------------

export class MissingOfficialOnlyArmError extends Error {
  constructor(season: number) {
    super(
      `publishEpaComparison: the report's season ${season} entry carries no officialOnly arm — refusing to ` +
        `publish a comparison against the wrong quantity (re-run scripts/epaVsStatbotics.ts to produce a report ` +
        `that carries it)`
    );
    this.name = "MissingOfficialOnlyArmError";
  }
}

export interface ComposeEpaComparisonOptions {
  readonly generation: string;
  readonly computedAt: string;
}

/**
 * Composes the one `EpaComparisonArtifact` from a single report. Pure with
 * respect to I/O — the caller reads the report file and passes the parsed
 * object in; this function performs no `fs`/`fetch` of its own, which is
 * what makes the missing-arm case here unit-testable with a small,
 * hand-built fixture and no network (`scripts/publishEpaComparison.test.ts`).
 */
export function composeEpaComparisonArtifact(report: EpaVsStatboticsReport, options: ComposeEpaComparisonOptions): EpaComparisonArtifact {
  for (const entry of report.seasonEntries) {
    if (!entry.officialOnly) {
      throw new MissingOfficialOnlyArmError(entry.season);
    }
  }

  // Stat block one reads the officialOnly arm — each team's rating as of
  // its own last official match, the exact number the Teams list and the
  // team-page header show a visitor. This is the whole reason this
  // revision exists: `minMatchesFiltered` is season-final and is never the
  // number anyone sees.
  const agreement: EpaComparisonArtifact["agreement"] = report.seasonEntries.map((entry) => ({
    season: entry.season,
    basis: "last-official-match",
    joinedCount: entry.officialOnly.joinedCount,
    ordinaryLeastSquaresSlope: entry.officialOnly.ordinaryLeastSquaresSlope,
    pearson: entry.officialOnly.pearson,
    meanAbsoluteDifference: entry.officialOnly.meanAbsoluteDifference,
  }));

  // Head-to-head accuracy always reads the offseason-INCLUSIVE report — the
  // production arm the live site actually serves. Scoring excludes offseason
  // matches regardless (`aggregateScores`' own default), so this is "the arm
  // the site runs", not "the arm with different scoring".
  const headToHead: EpaComparisonArtifact["headToHead"] = report.seasonEntries.map((entry) => ({
    season: entry.season,
    ourWinnerAccuracy: entry.winProbability.ourWinnerAccuracy,
    ourBrierScore: entry.winProbability.ourBrierScore,
    scoredCount: entry.winProbability.scoredCount,
    statboticsWinnerAccuracy: entry.winProbability.statboticsWinnerAccuracy,
    statboticsBrierScore: entry.winProbability.statboticsBrierScore,
    statboticsCapturedAt: entry.winProbability.statboticsCapturedAt,
    statboticsFetched: entry.winProbability.statboticsFetched,
  }));

  return EpaComparisonArtifactSchema.parse({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: options.generation,
    computedAt: options.computedAt,
    measuredAt: report.measuredAt,
    epaVersion: report.epaVersion,
    minMatches: report.minMatches,
    agreement,
    headToHead,
  });
}

// ---------------------------------------------------------------------------
// I/O — report read, R2 write
// ---------------------------------------------------------------------------

function readReport(path: string): EpaVsStatboticsReport {
  return JSON.parse(readFileSync(path, "utf8")) as EpaVsStatboticsReport;
}

interface CliOptions {
  readonly reportPath: string;
  readonly bucket: string;
  readonly dryRun: boolean;
}

function parseOptions(argv: readonly string[]): CliOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      report: { type: "string" },
      bucket: { type: "string" },
      "dry-run": { type: "boolean" },
    },
  });

  if (values.report === undefined) {
    throw new Error("publishEpaComparison: --report <path> is required (the report JSON carrying the officialOnly arm)");
  }

  return {
    reportPath: values.report,
    bucket: values.bucket ?? DEFAULT_BUCKET,
    dryRun: values["dry-run"] === true,
  };
}

export async function run(options: CliOptions): Promise<void> {
  const report = readReport(options.reportPath);

  const generation = new Date().toISOString();
  const artifact = composeEpaComparisonArtifact(report, {
    generation,
    computedAt: generation,
  });

  const key = epaComparisonKey();
  const body = JSON.stringify(artifact);
  console.log(
    `publishEpaComparison: composed "${key}" (${body.length} bytes, epaVersion ${artifact.epaVersion}, ${artifact.agreement.length} agreement rows, ${artifact.headToHead.length} head-to-head rows)`
  );

  if (options.dryRun) {
    console.log("publishEpaComparison: --dry-run — nothing published.");
    return;
  }

  await putObject(options.bucket, key, body, { contentType: "application/json", cacheControl: "public, max-age=60" });
  console.log(`publishEpaComparison: published "${key}" to bucket "${options.bucket}"`);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  await run(options);
}

// Guard: only auto-run `main()` when this file is the process entry point.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("publishEpaComparison failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
