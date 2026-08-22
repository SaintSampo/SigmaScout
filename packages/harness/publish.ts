/**
 * `pnpm publish:artifacts` entry point (D-01/D-02/D-04/D-25/D-26, plan 04-01
 * Task 3). Single-event mode only — this is the phase's tracer: the
 * thinnest real path that touches every layer the phase will use, wired end
 * to end and published to production R2. It is production code, widened by
 * later plans, never thrown away.
 *
 *   pnpm publish:artifacts --event <event_key> --algorithm opr [--bucket <name>] [--dry-run]
 *
 * Flow: read the event's played matches from the already-ingested corpus
 * (read-only — T-01-13, this path never writes to the corpus it reads),
 * derive the team list the way `packages/harness/cli.ts`'s `runSeason`
 * does, replay the event through the requested algorithm via
 * `WalkForwardSimulator`, assemble the artifact (`buildEventArtifact`,
 * exported separately from this I/O shell so it is testable without network
 * or corpus access), parse it through `EventArtifactSchema` — and only if
 * that parse succeeds, `putObject` exactly once. A validation failure
 * performs zero uploads (T-04-04).
 */
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import type { AlgorithmModule } from "../core/algorithms/types.js";
import { opr } from "../core/algorithms/opr.js";
import { openCorpusReadOnly, selectMatchesChronological } from "../corpus/db.js";
import { WalkForwardSimulator, type PredictionRecord } from "./replay.js";
import { artifactKey, EventArtifactSchema, PAGE_ARTIFACT_SCHEMA_VERSION, type EventArtifact } from "./pageArtifacts.js";
import { putObject } from "./r2Client.js";

const CORPUS_PATH = "data/corpus.sqlite";
const DEFAULT_BUCKET = "sigmascout-artifacts";

/** This tracer only needs `opr` — widened by later plans as more algorithms are published. */
const ALGORITHMS: Record<string, AlgorithmModule<any>> = { opr };

export interface BuildEventArtifactParams {
  readonly eventKey: string;
  readonly season: number;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  readonly predictions: readonly PredictionRecord[];
  /** D-04: a short opaque string identifying the publish run that produced this object. */
  readonly generation: string;
  /** D-04: ISO timestamp. Defaults to `new Date().toISOString()` — overridable for deterministic tests. */
  readonly computedAt?: string;
}

/**
 * The pure assembly step: turns one event's replayed predictions into the
 * candidate object `EventArtifactSchema` validates. `upcoming` is always an
 * empty array here — D-08, filled by plan 04-02. Does no I/O and throws
 * nothing on its own; validation happens at the call site via
 * `EventArtifactSchema.parse`.
 */
export function buildEventArtifact(params: BuildEventArtifactParams): EventArtifact {
  const matches = params.predictions.map(({ match, prediction }) => ({
    matchKey: match.matchKey,
    compLevel: match.compLevel,
    setNumber: match.setNumber,
    matchNumber: match.matchNumber,
    redTeams: [...match.redTeams],
    blueTeams: [...match.blueTeams],
    predictedWinner: prediction.winner,
    pRedWin: prediction.pRedWin,
    predictedRedScore: prediction.redScore,
    predictedBlueScore: prediction.blueScore,
    redComponents: prediction.redComponents,
    blueComponents: prediction.blueComponents,
    actualWinner: match.winner,
    actualRedScore: match.redScore,
    actualBlueScore: match.blueScore,
  }));

  return {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: params.generation,
    computedAt: params.computedAt ?? new Date().toISOString(),
    algorithmId: params.algorithmId,
    algorithmVersion: params.algorithmVersion,
    eventKey: params.eventKey,
    season: params.season,
    matches,
    upcoming: [],
  };
}

/** Single-event CLI derives season from the event key's leading 4 digits (TBA's own convention), mirroring `packages/harness/cli.ts`'s `runEventMode`. */
function deriveSeasonFromEventKey(eventKey: string): number {
  const season = Number.parseInt(eventKey.slice(0, 4), 10);
  if (!Number.isInteger(season)) {
    throw new Error(`Could not derive a season from event key "${eventKey}" (expected a leading 4-digit year)`);
  }
  return season;
}

function resolveAlgorithm(id: string | undefined): AlgorithmModule<any> {
  if (!id) throw new Error("--algorithm is required");
  const algorithm = ALGORITHMS[id];
  if (!algorithm) {
    throw new Error(`Unknown algorithm: ${id} (known: ${Object.keys(ALGORITHMS).join(", ")})`);
  }
  return algorithm;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      event: { type: "string" },
      algorithm: { type: "string" },
      bucket: { type: "string" },
      "dry-run": { type: "boolean" },
    },
  });

  if (!values.event) throw new Error("--event is required");
  const algorithm = resolveAlgorithm(values.algorithm);
  const bucket = values.bucket ?? DEFAULT_BUCKET;
  const dryRun = values["dry-run"] === true;

  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    const matches = selectMatchesChronological(db, { eventKey: values.event });
    if (matches.length === 0) {
      throw new Error(`No completed matches found in corpus for event ${values.event}`);
    }
    const season = deriveSeasonFromEventKey(values.event);
    const teams = Array.from(new Set(matches.flatMap((m) => [...m.redTeams, ...m.blueTeams])));

    const simulator = new WalkForwardSimulator(matches);
    const predictions = simulator.run(algorithm, teams);

    const candidate = buildEventArtifact({
      eventKey: values.event,
      season,
      algorithmId: algorithm.id,
      algorithmVersion: algorithm.version,
      predictions,
      generation: randomUUID(),
    });

    // T-04-04: validate before any upload can occur — a validation failure
    // performs zero uploads.
    const validated = EventArtifactSchema.parse(candidate);
    const key = artifactKey({ page: "event", eventKey: values.event, algorithmId: algorithm.id, version: algorithm.version });
    const body = JSON.stringify(validated);

    if (dryRun) {
      console.log(`[dry-run] Would publish "${key}" (${body.length} bytes) to bucket "${bucket}" — no upload performed.`);
      return;
    }

    await putObject(bucket, key, body, { contentType: "application/json", cacheControl: "public, max-age=60" });
    console.log(`Published "${key}" to bucket "${bucket}" (${body.length} bytes).`);
  } finally {
    db.close();
  }
}

// Guard: only auto-run `main()` when this file is the process entry point,
// matching cli.ts's own guard — importing this module (e.g. from
// publish.tracer.test.ts, which imports `buildEventArtifact` only) must
// never have the side effect of parsing `process.argv` or touching the
// corpus/network.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("publish:artifacts failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
