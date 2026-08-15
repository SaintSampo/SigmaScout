/**
 * D-13/D-14/D-15: explicit version promotion. A search evaluation
 * (`tune.ts`'s `reports/tune-*.json`, gitignored) is an EXPERIMENT, not a
 * version — it becomes one only through this script: reads the winning
 * parameter set, validates it, replays it on a bounded deterministic slice,
 * hashes the full-precision prediction stream, and writes a committed,
 * schema-valid version file under `data/algorithm-versions/` (the one
 * deliberate exception to `data/`'s otherwise-gitignored convention, per
 * `.gitignore`'s `data/*` + negation).
 *
 * Same standalone-script shape as `identifiability.ts`/`tune.ts`:
 * `parseArgs`, `async function main()`, an entry-point guard.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { COLD_START_SEASON } from "../core/algorithms/breakdown/index.js";
import { makeSigma1 } from "../core/algorithms/sigma1/index.js";
import { SIGMA1_CODE_VERSION, Sigma1ParamsSchema, type Sigma1Params } from "../core/algorithms/sigma1/params.js";
import { openCorpusReadOnly, selectMatchesChronological, type Corpus } from "../corpus/db.js";
import { WalkForwardSimulator, type PredictionRecord } from "./replay.js";
import { aggregateScores, type HarnessPredictionInput } from "./score.js";

const CORPUS_PATH = "data/corpus.sqlite";
const ALGORITHM_VERSIONS_DIR = join("data", "algorithm-versions");

const HeadlineMetricSchema = z.object({
  season: z.number().int(),
  brierScore: z.number().nullable(),
  winnerAccuracy: z.number().nullable(),
});

const ProvenanceSchema = z.object({
  /** Which search produced the promoted parameter set (D-14: provenance a version must carry). */
  searchArtifact: z.string().min(1),
  corpusIdentity: z.string().min(1),
  promotedAt: z.string().min(1),
  objective: z.number(),
  tuneSeasons: z.array(z.number().int()),
});

const DigestSchema = z.object({
  sliceSeason: z.number().int(),
  /** RECORDED, not re-derivable — re-running the slice later is a data read, never a re-query whose answer could change as the corpus grows. */
  sliceEventKeys: z.array(z.string().min(1)).min(1),
  sliceMatchCount: z.number().int().nonnegative(),
  /** D-16: "unchanged" means bitwise identical — this hash is the assertion target `digest.test.ts` re-derives, never hand-edited to make a failing reproduction pass (must_haves.prohibitions). */
  predictionStreamSha256: z.string().regex(/^[0-9a-f]{64}$/),
  headlineMetrics: z.array(HeadlineMetricSchema),
});

/** D-13's committed version-file shape: a code version paired with a named, committed parameter set, plus the provenance and digest that make it SC-5-reproducible. */
export const PromotedVersionSchema = z.object({
  id: z.string().min(1),
  codeVersion: z.string().min(1),
  paramSetName: z.string().min(1),
  /** `{codeVersion}+{paramSetName}` — D-13's version identity. */
  version: z.string().min(1),
  params: Sigma1ParamsSchema,
  provenance: ProvenanceSchema,
  digest: DigestSchema,
});

export type PromotedVersion = z.infer<typeof PromotedVersionSchema>;

/**
 * D-15/D-16's digest: one line per prediction, `JSON.stringify([matchKey,
 * pRedWin, redScore, blueScore])`, newline-joined, SHA-256 hashed to a
 * lowercase hex string. `JSON.stringify`'s own number formatting is the
 * shortest round-trippable form and is spec-determined — never rounded,
 * `toFixed`'d, or truncated, since this digest is the only thing standing
 * between a real reproduction and a plausible-looking one.
 */
export function computePredictionStreamDigest(records: readonly PredictionRecord[]): string {
  const lines = records.map((r) =>
    JSON.stringify([r.match.matchKey, r.prediction.pRedWin, r.prediction.redScore, r.prediction.blueScore])
  );
  const serialized = lines.join("\n");
  return createHash("sha256").update(serialized).digest("hex");
}

/**
 * The bounded, deterministic slice: event keys in `season` with
 * `is_offseason = 0` having at least 60 played `qm` matches with
 * `has_score_breakdown = 1`, `ORDER BY event_key ASC LIMIT limit`. Returned
 * (and RECORDED in the promoted version file) rather than re-queried at
 * reproduction time, so a growing corpus can never silently change which
 * events a committed digest was computed over.
 */
function resolveSliceEventKeys(db: Corpus, season: number, limit: number): string[] {
  const rows = db
    .prepare(
      `SELECT e.event_key AS event_key
       FROM events e
       JOIN matches m ON m.event_key = e.event_key
       WHERE e.year = ? AND e.is_offseason = 0 AND m.winner IS NOT NULL
         AND m.comp_level = 'qm' AND m.has_score_breakdown = 1
       GROUP BY e.event_key
       HAVING COUNT(*) >= 60
       ORDER BY e.event_key ASC
       LIMIT ?`
    )
    .all(season, limit) as { event_key: string }[];
  return rows.map((row) => row.event_key);
}

function parseSliceSeason(spec: string): number {
  const season = Number.parseInt(spec, 10);
  if (!Number.isInteger(season) || String(season).length !== 4) {
    throw new Error(`--slice-season must be a 4-digit year, got "${spec}"`);
  }
  return season;
}

function parseSliceEvents(spec: string): number {
  const n = Number.parseInt(spec, 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`--slice-events must be a positive integer, got "${spec}"`);
  }
  return n;
}

interface TuneSearchCandidate {
  readonly index: number;
  readonly params: unknown;
  readonly objective: number;
}

interface TuneSearchOutput {
  readonly seasons: readonly number[];
  readonly winnerIndex: number;
  readonly candidates: readonly TuneSearchCandidate[];
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      from: { type: "string" },
      name: { type: "string" },
      id: { type: "string" },
      "slice-season": { type: "string" },
      "slice-events": { type: "string" },
    },
  });

  const fromPath = values.from;
  if (!fromPath) throw new Error("--from is required (e.g. --from reports/tune-tracer.json)");
  const paramSetName = values.name;
  if (!paramSetName) throw new Error("--name is required (the paramSetName half of D-13's {codeVersion}+{paramSetName} identity)");
  const id = values.id ?? "sigma1";
  const sliceSeason = values["slice-season"] !== undefined ? parseSliceSeason(values["slice-season"]) : COLD_START_SEASON;
  const sliceEvents = values["slice-events"] !== undefined ? parseSliceEvents(values["slice-events"]) : 3;

  const searchOutput = JSON.parse(readFileSync(fromPath, "utf8")) as TuneSearchOutput;
  const winnerCandidate = searchOutput.candidates.find((c) => c.index === searchOutput.winnerIndex);
  if (!winnerCandidate) {
    throw new Error(`promote: ${fromPath} has no candidate at winnerIndex ${searchOutput.winnerIndex}`);
  }

  // T-03-08's mitigation: an unknown key, a missing key, or a NaN/Infinity
  // value in the search output's winning parameter set throws here, before
  // it can ever reach a committed version file.
  const params: Sigma1Params = Sigma1ParamsSchema.parse(winnerCandidate.params);

  const db = openCorpusReadOnly(CORPUS_PATH);
  let sliceEventKeys: string[];
  let records: PredictionRecord[];
  try {
    sliceEventKeys = resolveSliceEventKeys(db, sliceSeason, sliceEvents);
    if (sliceEventKeys.length === 0) {
      throw new Error(
        `promote: no events in season ${sliceSeason} meet the bounded-slice criteria (>= 60 played qm matches with a score breakdown)`
      );
    }

    const stream = selectMatchesChronological(db, { year: sliceSeason, excludeOffseason: true }).filter((match) =>
      sliceEventKeys.includes(match.eventKey)
    );

    const algorithm = makeSigma1({ id, linkMode: "predictive-variance", params, paramSetName });
    const teams = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
    const simulator = new WalkForwardSimulator(stream);
    records = simulator.run(algorithm, teams);
  } finally {
    db.close();
  }

  const predictionStreamSha256 = computePredictionStreamDigest(records);

  const predictions: HarnessPredictionInput[] = records.map((r) => ({
    matchKey: r.match.matchKey,
    season: sliceSeason,
    compLevel: r.match.compLevel,
    algorithmId: id,
    pRedWin: r.prediction.pRedWin,
    predictedRedScore: r.prediction.redScore,
    predictedBlueScore: r.prediction.blueScore,
    actualWinner: r.match.winner,
    isOffseason: false,
    isSurrogateAffected: r.match.redSurrogates.length > 0 || r.match.blueSurrogates.length > 0,
  }));
  const slices = aggregateScores(predictions);
  const combinedSlice = slices.find((s) => s.compLevelView === "combined" && s.season === sliceSeason);
  const headlineMetrics = combinedSlice
    ? [{ season: sliceSeason, brierScore: combinedSlice.brierScore, winnerAccuracy: combinedSlice.winnerAccuracy }]
    : [];

  const version = `${SIGMA1_CODE_VERSION}+${paramSetName}`;

  const candidate: PromotedVersion = {
    id,
    codeVersion: SIGMA1_CODE_VERSION,
    paramSetName,
    version,
    params,
    provenance: {
      searchArtifact: fromPath,
      corpusIdentity: CORPUS_PATH,
      promotedAt: new Date().toISOString(),
      objective: winnerCandidate.objective,
      tuneSeasons: [...searchOutput.seasons],
    },
    digest: {
      sliceSeason,
      sliceEventKeys,
      sliceMatchCount: records.length,
      predictionStreamSha256,
      headlineMetrics,
    },
  };

  // Validate-then-write (buildArtifact's own discipline, artifact.ts:107-112):
  // throws rather than persisting a malformed version.
  const validated = PromotedVersionSchema.parse(candidate);
  const serialized = JSON.stringify(validated, null, 2);

  // T-03-04: this path opens the corpus read-only and makes no network
  // call, so the TBA API key is never legitimately in scope here — but the
  // same refusal writeArtifact already implements (artifact.ts:140) is
  // applied anyway, defense in depth against an env leaking in unexpectedly.
  const apiKey = process.env["TBA_API_KEY"];
  if (apiKey && serialized.includes(apiKey)) {
    throw new Error("Refusing to write promoted version: serialized output contains a secret value.");
  }

  mkdirSync(ALGORITHM_VERSIONS_DIR, { recursive: true });
  const outPath = join(ALGORITHM_VERSIONS_DIR, `${id}@${version}.json`);
  writeFileSync(outPath, serialized, "utf8");
  console.log(`Wrote ${outPath}`);
  console.log(`  digest: ${predictionStreamSha256}`);
  console.log(`  slice: season ${sliceSeason}, ${sliceEventKeys.length} events, ${records.length} matches`);
}

// Guard: only auto-run `main()` when this file is the process entry point —
// importing this module (e.g. from a test) must never have the side effect
// of running a real corpus replay or writing a version file.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("promote failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
