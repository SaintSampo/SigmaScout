/**
 * D-13 (03.2-CONTEXT.md): captures the exact run behind a published or
 * retired baseline as a small, committed, schema-validated fingerprint —
 * per-season Brier/winner-accuracy plus a hash over the algorithm's full
 * prediction stream, mirroring 03-CONTEXT D-15's existing digest
 * convention (`packages/harness/promote.ts`'s `computePredictionStreamDigest`).
 *
 * This is a standalone, POST-HOC reader: it never runs a replay itself. It
 * reads one completed harness run directory (`--run-dir`) — the
 * `artifact.json` this run's `pnpm harness ...` invocation already wrote,
 * plus that run's `predictions-<season>.jsonl` sidecars — and turns them
 * into `data/baselines/<label>.json`. Two callers use it in plan 03.2-01:
 * once against the surviving `reports/tuned-v3` run behind every published
 * retired-OPR figure (Task 1), and once against D-13's mandated final full
 * run of the season-pooled implementation (Task 2) — see each task's
 * committed `sourceNote` for which is which.
 *
 * Deliberately writes to `data/baselines/`, NOT `data/algorithm-versions/`
 * (03.2-RESEARCH.md Pitfall 1 / this plan's Task 3): `digest.test.ts`'s
 * `listVersionFiles()` glob-scans `data/algorithm-versions/` and parses
 * every file there against `PromotedVersionSchema`, which requires a
 * non-optional Sigma1-shaped `params` field OPR has no equivalent of. A
 * bare OPR fingerprint placed in that directory would break that CI gate
 * with an opaque Zod error rather than living in a directory built for its
 * own shape.
 *
 * `buildBaselineFingerprint` is the pure, testable core — it takes an
 * already-parsed artifact subset and already-read per-season prediction
 * records, and does no I/O. `main()` is the thin I/O shell: it streams each
 * season's sidecar line-by-line (`readline` over `createReadStream`, never
 * buffering a whole 75-157 MB file into memory — T-03.2-12), aggregates
 * every requested season's records in memory, then performs exactly ONE
 * terminal `writeFileSync` after everything is validated — an interrupted
 * generation can never leave a partial committed fingerprint.
 *
 * Standalone-script shape matching `identifiability.ts`/`promote.ts`/
 * `fixtures/extract-digest-slice.ts`: `parseArgs`, `async function main()`,
 * an entry-point guard so importing this module (e.g. from a test) never
 * has the side effect of reading a run directory or writing a file.
 *
 * `main()` reads `artifact.json` through `ArtifactInputSchema` below — a
 * deliberately NARROW, `.passthrough()` schema covering only the fields
 * this generator actually reads (`schemaVersion`, `provenance.runTimestamp`/
 * `.corpusIdentity`, `algorithms[].id`/`.version`,
 * `slices[].{algorithmId,season,compLevelView,brierScore,winnerAccuracy,scoredCount}`)
 * — NOT the full, evolving `HarnessArtifactSchema` from `artifact.ts`. This
 * is a Rule 1 fix found running this task's real command: the surviving
 * `reports/tuned-v3/artifact.json` (generated 2026-08-17) predates plan
 * 03.1's `ExclusionCounts.quarantined` field becoming required, so the full
 * strict schema rejects it outright. A fingerprint generator whose entire
 * purpose is reading OLDER completed runs must not couple itself to
 * whichever shape `HarnessArtifactSchema` happens to have on the day it is
 * run — it only ever needs the handful of fields above, on every schema
 * version this project has shipped.
 */
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { computePredictionStreamDigest } from "./promote.js";
import type { PredictionRecord } from "./replay.js";

/** One prediction, reduced to exactly the fields `computePredictionStreamDigest` reads. */
export interface BaselineFingerprintPredictionRecord {
  readonly matchKey: string;
  readonly pRedWin: number;
  readonly redScore: number;
  readonly blueScore: number;
}

/** The narrow slice of `HarnessArtifact` this module actually reads — see `artifact.ts`'s `HarnessArtifactSchema` for the full shape. A real, schema-validated `HarnessArtifact` is always a valid value of this type (structural superset), which is what lets `main()` pass one straight through. */
export interface BaselineFingerprintSliceInput {
  readonly algorithmId: string;
  readonly season: number;
  readonly compLevelView: string;
  readonly brierScore: number | null;
  readonly winnerAccuracy: number | null;
  readonly scoredCount: number;
}

export interface BaselineFingerprintArtifactInput {
  readonly schemaVersion: number;
  readonly provenance: { readonly runTimestamp: string; readonly corpusIdentity: string };
  readonly slices: readonly BaselineFingerprintSliceInput[];
}

/** One algorithm's already-read-from-sidecar prediction records, keyed by season, in file (chronological) order — 03.2-RESEARCH.md confirmed sidecar lines are written in exact chronological replay order. */
export interface BaselineFingerprintAlgorithmInput {
  readonly id: string;
  readonly version: string;
  readonly perSeasonRecords: ReadonlyMap<number, readonly BaselineFingerprintPredictionRecord[]>;
}

export interface BuildBaselineFingerprintOptions {
  readonly label: string;
  readonly sourceNote: string;
  readonly runDir: string;
  readonly seasons: readonly number[];
  readonly artifact: BaselineFingerprintArtifactInput;
  readonly algorithms: readonly BaselineFingerprintAlgorithmInput[];
  /** Overridable for deterministic tests; defaults to `new Date().toISOString()`. */
  readonly generatedAt?: string;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

const BaselinePerSeasonMetricSchema = z.object({
  season: z.number().int(),
  brierScore: z.number().nullable(),
  winnerAccuracy: z.number().nullable(),
  scoredCount: z.number().int().nonnegative(),
  predictionStreamSha256: z.string().regex(SHA256_HEX),
});

const BaselineAlgorithmFingerprintSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  perSeason: z.array(BaselinePerSeasonMetricSchema).min(1),
  /** The digest over every requested season's records concatenated in ascending season order — the top-level, whole-run answer for this algorithm. */
  predictionStreamSha256: z.string().regex(SHA256_HEX),
});

/** A committed, reproducible fingerprint of one completed harness run directory — D-13's small, checkable substitute for a gitignored `reports/` tree. */
export const BaselineFingerprintSchema = z.object({
  label: z.string().min(1),
  generatedAt: z.string().min(1),
  sourceNote: z.string().min(1),
  runDir: z.string().min(1),
  runTimestamp: z.string().min(1),
  corpusIdentity: z.string().min(1),
  artifactSchemaVersion: z.number().int(),
  seasons: z.array(z.number().int()).min(1),
  algorithms: z.array(BaselineAlgorithmFingerprintSchema).min(1),
});

export type BaselineFingerprint = z.infer<typeof BaselineFingerprintSchema>;

/**
 * Deliberately narrow, `.passthrough()`-forgiving read schema for
 * `<run-dir>/artifact.json` — see the file header for why this does NOT
 * import/reuse `HarnessArtifactSchema`. `.passthrough()` on each object
 * means fields this generator does not read (`tieCount`, `exclusionCounts`,
 * `calibrationBins`, `statboticsReferences`, ...) are ignored whether they
 * are present, absent, or shaped differently across schema versions.
 */
const ArtifactSliceInputSchema = z
  .object({
    algorithmId: z.string().min(1),
    season: z.number().int(),
    compLevelView: z.string().min(1),
    brierScore: z.number().nullable(),
    winnerAccuracy: z.number().nullable(),
    scoredCount: z.number().int().nonnegative(),
  })
  .passthrough();

const ArtifactAlgorithmDescriptorInputSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
  })
  .passthrough();

const ArtifactInputSchema = z
  .object({
    schemaVersion: z.number().int(),
    provenance: z
      .object({
        runTimestamp: z.string().min(1),
        corpusIdentity: z.string().min(1),
      })
      .passthrough(),
    algorithms: z.array(ArtifactAlgorithmDescriptorInputSchema).min(1),
    slices: z.array(ArtifactSliceInputSchema),
  })
  .passthrough();

/** Thrown when a `combined` slice for the requested (algorithmId, season) is absent or ambiguous in the artifact — never silently defaulted to null (per this plan's must_haves). */
export class BaselineFingerprintSliceError extends Error {}

function findCombinedSlice(
  slices: readonly BaselineFingerprintSliceInput[],
  algorithmId: string,
  season: number
): BaselineFingerprintSliceInput {
  const matches = slices.filter(
    (s) => s.algorithmId === algorithmId && s.season === season && s.compLevelView === "combined"
  );
  if (matches.length === 0) {
    throw new BaselineFingerprintSliceError(
      `baselineFingerprint: no "combined" slice found for algorithm "${algorithmId}" season ${season}`
    );
  }
  if (matches.length > 1) {
    throw new BaselineFingerprintSliceError(
      `baselineFingerprint: ambiguous "combined" slice for algorithm "${algorithmId}" season ${season} — found ${matches.length} matching slices`
    );
  }
  return matches[0]!;
}

/**
 * Feeds `records` through `computePredictionStreamDigest` (imported from
 * `promote.ts`, never reimplemented). That function's parameter type is the
 * full `PredictionRecord` (`{ match: MatchResult; prediction: Prediction }`)
 * but only reads `match.matchKey` / `prediction.pRedWin` / `.redScore` /
 * `.blueScore` — this is the single, isolated cast site translating this
 * module's minimal record shape into that call, so the rest of the file
 * never has to.
 */
function digestOf(records: readonly BaselineFingerprintPredictionRecord[]): string {
  const asDigestInputs = records.map((r) => ({
    match: { matchKey: r.matchKey },
    prediction: { pRedWin: r.pRedWin, redScore: r.redScore, blueScore: r.blueScore },
  }));
  return computePredictionStreamDigest(asDigestInputs as unknown as PredictionRecord[]);
}

/**
 * Pure, testable core (no I/O). Builds and schema-validates one
 * `BaselineFingerprint` from an already-parsed artifact subset and
 * already-read per-season prediction records.
 */
export function buildBaselineFingerprint(options: BuildBaselineFingerprintOptions): BaselineFingerprint {
  const { label, sourceNote, runDir, seasons, artifact, algorithms, generatedAt } = options;

  const algorithmFingerprints = algorithms.map((algo) => {
    const perSeason = seasons.map((season) => {
      const records = algo.perSeasonRecords.get(season) ?? [];
      const slice = findCombinedSlice(artifact.slices, algo.id, season);
      return {
        season,
        brierScore: slice.brierScore,
        winnerAccuracy: slice.winnerAccuracy,
        scoredCount: slice.scoredCount,
        predictionStreamSha256: digestOf(records),
      };
    });

    // The whole-run digest: every requested season's records, concatenated
    // in ascending season order (`seasons` is already in the order the
    // caller requested, which both call sites in this plan pass ascending).
    const allRecords = seasons.flatMap((season) => algo.perSeasonRecords.get(season) ?? []);

    return {
      id: algo.id,
      version: algo.version,
      perSeason,
      predictionStreamSha256: digestOf(allRecords),
    };
  });

  const candidate: BaselineFingerprint = {
    label,
    generatedAt: generatedAt ?? new Date().toISOString(),
    sourceNote,
    runDir,
    runTimestamp: artifact.provenance.runTimestamp,
    corpusIdentity: artifact.provenance.corpusIdentity,
    artifactSchemaVersion: artifact.schemaVersion,
    seasons: [...seasons],
    algorithms: algorithmFingerprints,
  };

  // Validate-then-return (artifact.ts's/promote.ts's own discipline): a
  // malformed fingerprint fails here, at generation time, not at read time.
  return BaselineFingerprintSchema.parse(candidate);
}

function parseSeasonsSpec(spec: string): number[] {
  const rangeMatch = /^(\d{4})-(\d{4})$/.exec(spec);
  if (rangeMatch) {
    const start = Number.parseInt(rangeMatch[1]!, 10);
    const end = Number.parseInt(rangeMatch[2]!, 10);
    if (end < start) {
      throw new Error(`--seasons range end (${end}) must be >= start (${start})`);
    }
    const seasons: number[] = [];
    for (let year = start; year <= end; year++) seasons.push(year);
    return seasons;
  }
  const singleMatch = /^(\d{4})$/.exec(spec);
  if (singleMatch) {
    return [Number.parseInt(singleMatch[1]!, 10)];
  }
  throw new Error(`--seasons must be a 4-digit year (e.g. "2022") or a range like "2022-2026", got "${spec}"`);
}

interface SidecarLineShape {
  matchKey: string;
  algorithmId: string;
  pRedWin: number;
  predictedRedScore: number;
  predictedBlueScore: number;
}

/**
 * Streams `<runDir>/predictions-<season>.jsonl` line by line (`readline`
 * over `createReadStream` — T-03.2-12: sidecars run 75-157 MB, never
 * buffered whole into memory), splitting records into one bucket per
 * requested algorithm id, in file (chronological) order.
 */
async function readSeasonRecordsBySidecar(
  runDir: string,
  season: number,
  algorithmIds: readonly string[]
): Promise<Map<string, BaselineFingerprintPredictionRecord[]>> {
  const sidecarPath = join(runDir, `predictions-${season}.jsonl`);
  const perAlgorithm = new Map<string, BaselineFingerprintPredictionRecord[]>();
  for (const id of algorithmIds) perAlgorithm.set(id, []);

  const rl = createInterface({ input: createReadStream(sidecarPath, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim().length === 0) continue;
    const rec = JSON.parse(line) as SidecarLineShape;
    const bucket = perAlgorithm.get(rec.algorithmId);
    if (!bucket) continue; // not one of the requested algorithms — skip without buffering it
    bucket.push({
      matchKey: rec.matchKey,
      pRedWin: rec.pRedWin,
      redScore: rec.predictedRedScore,
      blueScore: rec.predictedBlueScore,
    });
  }
  return perAlgorithm;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "run-dir": { type: "string" },
      algorithm: { type: "string" },
      seasons: { type: "string" },
      label: { type: "string" },
      out: { type: "string" },
      "source-note": { type: "string" },
    },
  });

  const runDir = values["run-dir"];
  if (!runDir) throw new Error("--run-dir is required (a completed harness run directory)");
  const algorithmSpec = values.algorithm;
  if (!algorithmSpec) throw new Error("--algorithm is required (comma-separated ids, e.g. --algorithm opr)");
  const seasonsSpec = values.seasons;
  if (!seasonsSpec) throw new Error('--seasons is required (e.g. --seasons 2022-2026 or --seasons 2022)');
  const label = values.label;
  if (!label) throw new Error("--label is required");
  const outPath = values.out;
  if (!outPath) throw new Error("--out is required (output file path)");
  const sourceNote = values["source-note"];
  if (!sourceNote) throw new Error("--source-note is required (where --run-dir came from and how it was produced)");

  const algorithmIds = algorithmSpec
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (algorithmIds.length === 0) {
    throw new Error(`--algorithm produced no ids from "${algorithmSpec}"`);
  }
  const seasons = parseSeasonsSpec(seasonsSpec);

  const artifactPath = join(runDir, "artifact.json");
  const artifactRaw: unknown = JSON.parse(readFileSync(artifactPath, "utf8"));
  const artifact = ArtifactInputSchema.parse(artifactRaw);

  const perAlgorithmPerSeason = new Map<string, Map<number, BaselineFingerprintPredictionRecord[]>>();
  for (const id of algorithmIds) perAlgorithmPerSeason.set(id, new Map());

  for (const season of seasons) {
    console.log(`Reading ${join(runDir, `predictions-${season}.jsonl`)}...`);
    const bySeason = await readSeasonRecordsBySidecar(runDir, season, algorithmIds);
    for (const id of algorithmIds) {
      perAlgorithmPerSeason.get(id)!.set(season, bySeason.get(id) ?? []);
    }
  }

  const algorithms: BaselineFingerprintAlgorithmInput[] = algorithmIds.map((id) => {
    const descriptor = artifact.algorithms.find((a) => a.id === id);
    if (!descriptor) {
      throw new Error(`baselineFingerprint: ${artifactPath} has no algorithm entry for id "${id}"`);
    }
    return { id, version: descriptor.version, perSeasonRecords: perAlgorithmPerSeason.get(id)! };
  });

  const fingerprint = buildBaselineFingerprint({ label, sourceNote, runDir, seasons, artifact, algorithms });

  const serialized = JSON.stringify(fingerprint, null, 2);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, serialized, "utf8");
  console.log(`Wrote ${outPath}`);
  for (const algo of fingerprint.algorithms) {
    console.log(`  ${algo.id} (${algo.version}): predictionStreamSha256=${algo.predictionStreamSha256}`);
    for (const p of algo.perSeason) {
      console.log(
        `    ${p.season}: brier=${p.brierScore?.toFixed(4) ?? "null"} accuracy=${p.winnerAccuracy?.toFixed(4) ?? "null"} n=${p.scoredCount}`
      );
    }
  }
}

// Guard: only auto-run `main()` when this file is the process entry point —
// importing this module (e.g. from a test) must never have the side effect
// of reading a run directory or writing a fingerprint file.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("baselineFingerprint failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
