/**
 * Harness entry point (EVAL-01/EVAL-02, ALGO-01):
 *
 *   pnpm harness --event <event_key> --algorithm opr [--out <dir>]
 *
 * Fetches one event from TBA (conditional requests via tbaClient), Zod-
 * validates the response, normalizes and stores it in the SQLite corpus,
 * reads the chronological match list back, replays it walk-forward through
 * the requested algorithm, scores the predictions, and writes both the
 * canonical JSON artifact and a self-contained HTML report.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { AlgorithmModule } from "../core/algorithms/types.js";
import { opr } from "../core/algorithms/opr.js";
import {
  openCorpus,
  readEtag,
  selectMatchesChronological,
  upsertEvent,
  upsertMatch,
  writeEtag,
} from "../corpus/db.js";
import { tbaMatchListSchema, tbaEventSchema } from "../ingest/schemas.js";
import { normalizeEvent, normalizeMatch } from "../ingest/normalize.js";
import { tbaFetch } from "../ingest/tbaClient.js";
import { buildArtifact, writeArtifact } from "./artifact.js";
import { renderHtmlReport } from "./report.js";
import { WalkForwardSimulator } from "./replay.js";
import { aggregateScores, type HarnessPredictionInput } from "./score.js";
import { statboticsReference } from "./statbotics.js";

// `any` here: this registry maps CLI strings to modules with different
// (incompatible) state types S; each entry is internally type-safe.
const ALGORITHMS: Record<string, AlgorithmModule<any>> = { opr };

const CORPUS_PATH = "data/corpus.sqlite";

function tbaApiKey(): string {
  const key = process.env["TBA_API_KEY"];
  if (!key) {
    throw new Error("TBA_API_KEY is not set in the environment. Populate .env from .env.example.");
  }
  return key;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      event: { type: "string" },
      algorithm: { type: "string" },
      out: { type: "string" },
    },
  });

  const eventKey = values.event;
  const algorithmName = values.algorithm;
  const outDir = values.out ?? "data/harness";

  if (!eventKey) throw new Error("--event is required");
  if (!algorithmName) throw new Error("--algorithm is required");

  const algorithm = ALGORITHMS[algorithmName];
  if (!algorithm) {
    throw new Error(`Unknown algorithm: ${algorithmName} (known: ${Object.keys(ALGORITHMS).join(", ")})`);
  }

  const apiKey = tbaApiKey();
  const db = openCorpus(CORPUS_PATH);

  try {
    const eventUrl = `/event/${eventKey}`;
    const eventFetch = await tbaFetch(eventUrl, apiKey, readEtag(db, eventUrl));
    if (eventFetch.status === 304) {
      console.log(`TBA ${eventUrl}: 304 Not Modified`);
    } else {
      console.log(`TBA ${eventUrl}: 200 OK`);
      const rawEvent = tbaEventSchema.parse(eventFetch.body);
      upsertEvent(db, normalizeEvent(rawEvent));
      if (eventFetch.etag) writeEtag(db, eventUrl, eventFetch.etag);
    }

    const matchesUrl = `/event/${eventKey}/matches`;
    const matchesFetch = await tbaFetch(matchesUrl, apiKey, readEtag(db, matchesUrl));
    if (matchesFetch.status === 304) {
      console.log(`TBA ${matchesUrl}: 304 Not Modified`);
    } else {
      console.log(`TBA ${matchesUrl}: 200 OK`);
      const rawMatches = tbaMatchListSchema.parse(matchesFetch.body);
      const eventRow = db
        .prepare("SELECT start_date FROM events WHERE event_key = ?")
        .get(eventKey) as { start_date: string } | undefined;
      const startDate = eventRow?.start_date ?? new Date().toISOString();
      for (const rawMatch of rawMatches) {
        upsertMatch(db, normalizeMatch(rawMatch, startDate));
      }
      if (matchesFetch.etag) writeEtag(db, matchesUrl, matchesFetch.etag);
    }

    const matches = selectMatchesChronological(db, { eventKey });
    if (matches.length === 0) {
      throw new Error(`No completed matches found in corpus for event ${eventKey}`);
    }

    const eventRowForOffseason = db
      .prepare("SELECT is_offseason FROM events WHERE event_key = ?")
      .get(eventKey) as { is_offseason: number } | undefined;
    const isOffseason = eventRowForOffseason?.is_offseason === 1;

    // The tracer/single-event CLI derives season from the event key's leading
    // 4 digits (TBA's own convention, e.g. "2024casj"). Plan 06 widens this
    // CLI to a --seasons range fed by packages/harness/replay.ts's
    // buildSeasonStream; this single-event path only ever sees one season.
    const season = Number.parseInt(eventKey.slice(0, 4), 10);
    if (!Number.isInteger(season)) {
      throw new Error(`Could not derive a season from event key ${eventKey} (expected a leading 4-digit year)`);
    }

    const teams = Array.from(new Set(matches.flatMap((m) => [...m.redTeams, ...m.blueTeams])));

    const simulator = new WalkForwardSimulator(matches);
    const records = simulator.run(algorithm, teams);

    const predictions: HarnessPredictionInput[] = records.map((r) => ({
      matchKey: r.match.matchKey,
      season,
      compLevel: r.match.compLevel,
      pRedWin: r.prediction.pRedWin,
      actualWinner: r.match.winner,
      isOffseason,
      isSurrogateAffected: r.match.redSurrogates.length > 0 || r.match.blueSurrogates.length > 0,
    }));

    const slices = aggregateScores(predictions);
    const statboticsRef = await statboticsReference(season, {
      cachePath: join("data", "statbotics-cache.json"),
    });

    const artifact = buildArtifact({
      algorithmId: algorithm.id,
      algorithmVersion: algorithm.version,
      corpusIdentity: CORPUS_PATH,
      slices,
      statboticsReferences: [statboticsRef],
    });

    const artifactPath = writeArtifact(outDir, artifact, apiKey);

    const html = renderHtmlReport(artifact);
    if (html.includes(apiKey)) {
      throw new Error("Refusing to write HTML report: rendered output contains a secret value.");
    }
    mkdirSync(outDir, { recursive: true });
    const htmlPath = join(outDir, "report.html");
    writeFileSync(htmlPath, html, "utf8");

    console.log(`Wrote ${artifactPath}`);
    console.log(`Wrote ${htmlPath}`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error("harness failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
