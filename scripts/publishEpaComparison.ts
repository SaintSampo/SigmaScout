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
 * The composition below is where this task's anti-drift gates live, and
 * they are the point of this file rather than a nicety: two arm reports
 * that disagree on `epaVersion`, on their season set, or on which slot
 * (`--inclusive`/`--excluded`) their own `includeOffseason` flag actually
 * belongs to each throw a NAMED error and publish nothing. A silent version
 * mix or a silently swapped arm here is precisely the documentation-drift
 * failure this whole task exists to close (see this quick task's own
 * `<threat_model>` T-n5o-01).
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
// Composition gates — named errors, never a console warning or a best-effort merge
// ---------------------------------------------------------------------------

export class MismatchedEpaVersionError extends Error {
  constructor(inclusiveVersion: string, excludedVersion: string) {
    super(
      `publishEpaComparison: --inclusive report's epaVersion "${inclusiveVersion}" does not match ` +
        `--excluded report's epaVersion "${excludedVersion}" — refusing to publish a comparison that ` +
        `mixes two model versions in one table`
    );
    this.name = "MismatchedEpaVersionError";
  }
}

export class MismatchedSeasonSetError extends Error {
  constructor(inclusiveSeasons: readonly number[], excludedSeasons: readonly number[]) {
    super(
      `publishEpaComparison: --inclusive report's seasons [${inclusiveSeasons.join(", ")}] do not match ` +
        `--excluded report's seasons [${excludedSeasons.join(", ")}] — both arms must cover the identical ` +
        `season set or they are not an A/B at all`
    );
    this.name = "MismatchedSeasonSetError";
  }
}

export class MislabelledArmError extends Error {
  constructor(slot: "inclusive" | "excluded", expected: boolean, actual: boolean) {
    super(
      `publishEpaComparison: the report passed as --${slot} carries includeOffseason=${actual}, expected ` +
        `${expected} — this report does not belong in the --${slot} slot`
    );
    this.name = "MislabelledArmError";
  }
}

export interface ComposeEpaComparisonOptions {
  readonly generation: string;
  readonly computedAt: string;
}

/**
 * Composes the one `EpaComparisonArtifact` from both arm reports. Pure with
 * respect to I/O — the caller reads both report files and passes the parsed
 * objects in; this function performs no `fs`/`fetch` of its own, which is
 * what makes every mismatch case here unit-testable with small, hand-built
 * fixtures and no network (`scripts/publishEpaComparison.test.ts`).
 *
 * Gate order matters for a clear error on a doubly-wrong input: arm identity
 * first (a report in the wrong slot is the most basic mistake), then version
 * equality, then season-set equality — each gate throws its own named error
 * and none falls through to composing a partial object.
 */
export function composeEpaComparisonArtifact(
  inclusiveReport: EpaVsStatboticsReport,
  excludedReport: EpaVsStatboticsReport,
  options: ComposeEpaComparisonOptions
): EpaComparisonArtifact {
  if (inclusiveReport.includeOffseason !== true) {
    throw new MislabelledArmError("inclusive", true, inclusiveReport.includeOffseason);
  }
  if (excludedReport.includeOffseason !== false) {
    throw new MislabelledArmError("excluded", false, excludedReport.includeOffseason);
  }

  if (inclusiveReport.epaVersion !== excludedReport.epaVersion) {
    throw new MismatchedEpaVersionError(inclusiveReport.epaVersion, excludedReport.epaVersion);
  }

  const inclusiveSeasons = [...inclusiveReport.seasons].sort((a, b) => a - b);
  const excludedSeasons = [...excludedReport.seasons].sort((a, b) => a - b);
  const sameSeasons =
    inclusiveSeasons.length === excludedSeasons.length && inclusiveSeasons.every((season, index) => season === excludedSeasons[index]);
  if (!sameSeasons) {
    throw new MismatchedSeasonSetError(inclusiveSeasons, excludedSeasons);
  }

  // Stat block one reads the min-matches(12) arm — the same arm
  // `docs/models/epa-vs-statbotics.md`'s own committed baseline is built
  // from (low-match teams are noisy on both sides), never the all-teams arm.
  const agreement: EpaComparisonArtifact["agreement"] = [
    ...inclusiveReport.seasonEntries.map((entry) => ({
      season: entry.season,
      includeOffseason: true,
      joinedCount: entry.minMatchesFiltered.joinedCount,
      ordinaryLeastSquaresSlope: entry.minMatchesFiltered.ordinaryLeastSquaresSlope,
      pearson: entry.minMatchesFiltered.pearson,
      meanAbsoluteDifference: entry.minMatchesFiltered.meanAbsoluteDifference,
    })),
    ...excludedReport.seasonEntries.map((entry) => ({
      season: entry.season,
      includeOffseason: false,
      joinedCount: entry.minMatchesFiltered.joinedCount,
      ordinaryLeastSquaresSlope: entry.minMatchesFiltered.ordinaryLeastSquaresSlope,
      pearson: entry.minMatchesFiltered.pearson,
      meanAbsoluteDifference: entry.minMatchesFiltered.meanAbsoluteDifference,
    })),
  ];

  // Head-to-head accuracy always reads the offseason-INCLUSIVE arm — the
  // production arm the live site actually serves. Scoring excludes offseason
  // matches on both arms regardless (`aggregateScores`' own default), so
  // this is "the arm the site runs", not "the arm with different scoring".
  const headToHead: EpaComparisonArtifact["headToHead"] = inclusiveReport.seasonEntries.map((entry) => ({
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
    measuredAt: inclusiveReport.measuredAt,
    epaVersion: inclusiveReport.epaVersion,
    minMatches: inclusiveReport.minMatches,
    agreement,
    headToHead,
  });
}

// ---------------------------------------------------------------------------
// I/O — report reads, R2 write
// ---------------------------------------------------------------------------

function readReport(path: string): EpaVsStatboticsReport {
  return JSON.parse(readFileSync(path, "utf8")) as EpaVsStatboticsReport;
}

interface CliOptions {
  readonly inclusivePath: string;
  readonly excludedPath: string;
  readonly bucket: string;
  readonly dryRun: boolean;
}

function parseOptions(argv: readonly string[]): CliOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      inclusive: { type: "string" },
      excluded: { type: "string" },
      bucket: { type: "string" },
      "dry-run": { type: "boolean" },
    },
  });

  if (values.inclusive === undefined) {
    throw new Error("publishEpaComparison: --inclusive <path> is required (the offseason-inclusive report JSON)");
  }
  if (values.excluded === undefined) {
    throw new Error("publishEpaComparison: --excluded <path> is required (the offseason-excluded report JSON)");
  }

  return {
    inclusivePath: values.inclusive,
    excludedPath: values.excluded,
    bucket: values.bucket ?? DEFAULT_BUCKET,
    dryRun: values["dry-run"] === true,
  };
}

export async function run(options: CliOptions): Promise<void> {
  const inclusiveReport = readReport(options.inclusivePath);
  const excludedReport = readReport(options.excludedPath);

  const generation = new Date().toISOString();
  const artifact = composeEpaComparisonArtifact(inclusiveReport, excludedReport, {
    generation,
    computedAt: generation,
  });

  const key = epaComparisonKey();
  const body = JSON.stringify(artifact);
  console.log(`publishEpaComparison: composed "${key}" (${body.length} bytes, epaVersion ${artifact.epaVersion}, ${artifact.agreement.length} agreement rows, ${artifact.headToHead.length} head-to-head rows)`);

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
