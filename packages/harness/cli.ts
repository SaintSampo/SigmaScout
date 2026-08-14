/**
 * Harness entry point (EVAL-01/EVAL-02, ALGO-01):
 *
 *   pnpm harness --event <event_key> --algorithm opr [--out <dir>]
 *   pnpm harness --season <year> --algorithm opr [--out <dir>] [--include-offseason]
 *   pnpm harness --seasons <start>-<end> --algorithm opr [--out <dir>] [--include-offseason] [--cold-start-season <year>]
 *
 * --event fetches one event from TBA (conditional requests via tbaClient),
 * Zod-validates the response, normalizes and stores it in the SQLite
 * corpus, then replays it. --season/--seasons instead read the
 * already-ingested corpus (Plan 03's `pnpm ingest`) directly and
 * read-only — no network access, no writes (T-01-13) — replaying every
 * season in the range walk-forward across every event in it (Plan 06
 * Task 1's cross-event interleaving), scoring the whole set with one
 * combined artifact and report so the score table reads as a single
 * scoreboard rather than one file per season.
 *
 * D-16/D-19 (plan 02-03): `--seasons` threads each algorithm's state
 * across every season boundary in the range via `algorithm.carrySeason`,
 * rather than starting every season fresh — see `runSeasons` below.
 * `--cold-start-season` overrides which season is treated as having
 * nothing to carry from (defaults to `COLD_START_SEASON`), so extending
 * the corpus back to 2016 is a flag, not an edit.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import type { AlgorithmModule, SeasonBoundary } from "../core/algorithms/types.js";
import { opr } from "../core/algorithms/opr.js";
import { epa } from "../core/algorithms/epa.js";
import { COLD_START_SEASON } from "../core/algorithms/breakdown/index.js";
import {
  openCorpus,
  openCorpusReadOnly,
  readEtag,
  selectMatchesChronological,
  upsertEvent,
  upsertMatch,
  writeEtag,
  type Corpus,
} from "../corpus/db.js";
import { tbaMatchListSchema, tbaEventSchema } from "../ingest/schemas.js";
import { normalizeEvent, normalizeMatch } from "../ingest/normalize.js";
import { tbaFetch } from "../ingest/tbaClient.js";
import { buildArtifact, writeArtifact } from "./artifact.js";
import { renderHtmlReport } from "./report.js";
import { buildSeasonStream, WalkForwardSimulator } from "./replay.js";
import { aggregateScores, type HarnessPredictionInput } from "./score.js";
import { statboticsReference, type StatboticsReference } from "./statbotics.js";

// `any` here: this registry maps CLI strings to modules with different
// (incompatible) state types S; each entry is internally type-safe.
const ALGORITHMS: Record<string, AlgorithmModule<any>> = { opr, epa };

const CORPUS_PATH = "data/corpus.sqlite";
const STATBOTICS_CACHE_PATH = join("data", "statbotics-cache.json");
const DEFAULT_OUT_DIR = "reports";

function tbaApiKey(): string {
  const key = process.env["TBA_API_KEY"];
  if (!key) {
    throw new Error("TBA_API_KEY is not set in the environment. Populate .env from .env.example.");
  }
  return key;
}

/**
 * D-22: `--algorithm` now accepts a comma-separated list ("opr,epa"),
 * driving many algorithms over one shared stream in a single run. Keeps
 * the exact "Unknown algorithm" error-message shape the single-algorithm
 * resolver used, and rejects a duplicate name rather than silently
 * de-duplicating it.
 */
function resolveAlgorithms(spec: string | undefined): AlgorithmModule<any>[] {
  if (!spec) throw new Error("--algorithm is required");
  const names = spec
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0) throw new Error("--algorithm is required");

  const seen = new Set<string>();
  const algorithms: AlgorithmModule<any>[] = [];
  for (const name of names) {
    if (seen.has(name)) {
      throw new Error(`--algorithm lists "${name}" more than once`);
    }
    seen.add(name);
    const algorithm = ALGORITHMS[name];
    if (!algorithm) {
      throw new Error(`Unknown algorithm: ${name} (known: ${Object.keys(ALGORITHMS).join(", ")})`);
    }
    algorithms.push(algorithm);
  }
  return algorithms;
}

/** Parses `--seasons "2022-2026"` into an inclusive array of season years. */
function parseSeasonsRange(spec: string): number[] {
  const rangeMatch = /^(\d{4})-(\d{4})$/.exec(spec);
  if (!rangeMatch) {
    throw new Error(`--seasons must be a range like "2022-2026", got "${spec}"`);
  }
  const start = Number.parseInt(rangeMatch[1]!, 10);
  const end = Number.parseInt(rangeMatch[2]!, 10);
  if (end < start) {
    throw new Error(`--seasons range end (${end}) must be >= start (${start})`);
  }
  const seasons: number[] = [];
  for (let year = start; year <= end; year++) seasons.push(year);
  return seasons;
}

function parseSingleSeason(spec: string): number {
  const season = Number.parseInt(spec, 10);
  if (!Number.isInteger(season)) {
    throw new Error(`--season must be a 4-digit year, got "${spec}"`);
  }
  return season;
}

async function writeReport(outDir: string, artifact: Parameters<typeof renderHtmlReport>[0]): Promise<void> {
  const html = renderHtmlReport(artifact);
  mkdirSync(outDir, { recursive: true });
  const htmlPath = join(outDir, "report.html");
  writeFileSync(htmlPath, html, "utf8");
  console.log(`Wrote ${htmlPath}`);
}

/** Result of replaying one season: predictions tagged for scoring, plus every algorithm's state after the season's last match — the value plan 02-03's `runSeasons` threads across the next boundary via `carrySeason`. */
interface SeasonRunResult {
  predictions: HarnessPredictionInput[];
  finalStates: ReadonlyMap<string, unknown>;
}

/**
 * Replays one season (every event in it, cross-event interleaved) through
 * every supplied `algorithms` over one shared stream (D-22) and returns
 * predictions tagged for scoring, one per (match, algorithm), plus each
 * algorithm's final state. `initialStates`, when supplied (plan 02-03's
 * `runSeasons`), seeds an algorithm's replay from a carried-over state
 * instead of `initState` — see `WalkForwardSimulator.runAll`. Prints a
 * progress line carrying both the replayed match count and the excluded
 * count PER algorithm so a season that silently scored far fewer matches
 * than expected is visible while the run happens, not after, plus whether
 * this algorithm carried state into the season or started cold (D-16: a
 * silent regression to per-season resets must be visible in the run log,
 * not just in the numbers).
 */
async function runSeason(
  db: Corpus,
  season: number,
  algorithms: readonly AlgorithmModule<any>[],
  includeOffseason: boolean,
  initialStates?: ReadonlyMap<string, unknown>
): Promise<SeasonRunResult> {
  const stream = buildSeasonStream(db, season, { includeOffseason });

  const offseasonEventKeys = new Set(
    (
      db.prepare(`SELECT event_key FROM events WHERE year = ? AND is_offseason = 1`).all(season) as {
        event_key: string;
      }[]
    ).map((row) => row.event_key)
  );

  const teams = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
  const simulator = new WalkForwardSimulator(stream);
  const records = simulator.runAll(algorithms, teams, initialStates);

  const predictions: HarnessPredictionInput[] = records.map((r) => ({
    matchKey: r.match.matchKey,
    season,
    compLevel: r.match.compLevel,
    algorithmId: r.algorithmId,
    pRedWin: r.prediction.pRedWin,
    predictedRedScore: r.prediction.redScore,
    predictedBlueScore: r.prediction.blueScore,
    actualWinner: r.match.winner,
    isOffseason: offseasonEventKeys.has(r.match.eventKey),
    isSurrogateAffected: r.match.redSurrogates.length > 0 || r.match.blueSurrogates.length > 0,
  }));

  for (const algorithm of algorithms) {
    const algorithmPredictions = predictions.filter((p) => p.algorithmId === algorithm.id);
    const excludedCount = algorithmPredictions.filter((p) => p.isOffseason || p.isSurrogateAffected).length;
    const carryStatus = initialStates?.has(algorithm.id) ? "carried state in" : "started cold";
    console.log(
      `Season ${season} [${algorithm.id}]: ${algorithmPredictions.length} matches replayed, ${algorithmPredictions.length - excludedCount} scorable, ${excludedCount} excluded (${carryStatus})`
    );
  }

  return { predictions, finalStates: records.finalStates };
}

/**
 * D-16/D-19: threads each algorithm's state across every season boundary
 * in `seasons`, so replaying 2022-2026 in one invocation lets 2026's
 * predictions be informed by 2022-2025 rather than starting every season
 * from a fresh cold start.
 *
 * At each season after `coldStartSeason`, every algorithm that implements
 * `carrySeason` is carried forward from its live state via
 * `algorithm.carrySeason(state, boundary)`; the carried states become that
 * season's `initialStates` for `runSeason`/`WalkForwardSimulator.runAll`.
 * An algorithm with no `carrySeason` (OPR) is deliberately left OUT of
 * `initialStates` for every season — `runAll` falls back to `initState`
 * for any algorithm id missing from the map, exactly reproducing Phase 1's
 * per-season-fresh-start behavior. This is intentional, not an oversight:
 * OPR is season-pooled by design (see `opr.ts`'s file header), and a
 * cross-season OPR would be a different algorithm, not a bug fix.
 *
 * An algorithm that HAS carried-in live state from a prior season in this
 * same run, but whose current live state is `undefined` (it was never
 * replayed at all, e.g. added to `--algorithm` partway through a manually
 * assembled multi-run pipeline), is also left out of `initialStates` for
 * that boundary — there is nothing to carry, so it starts that season
 * cold rather than the run throwing.
 */
// Exported for `cli.season-carry.test.ts`'s T-02-08 regression: a
// 2022-2023 run's 2022 predictions must be byte-identical to a
// 2022-only run's, proving carrySeason cannot leak a later season's
// information backward into an earlier one's predictions.
export async function runSeasons(
  db: Corpus,
  seasons: readonly number[],
  algorithms: readonly AlgorithmModule<any>[],
  includeOffseason: boolean,
  coldStartSeason: number
): Promise<HarnessPredictionInput[]> {
  const all: HarnessPredictionInput[] = [];
  let liveStates = new Map<string, unknown>();

  for (const season of seasons) {
    const boundary: SeasonBoundary = {
      fromSeason: season - 1,
      toSeason: season,
      isColdStart: season === coldStartSeason,
    };

    let initialStates: ReadonlyMap<string, unknown> | undefined;
    if (boundary.isColdStart) {
      console.log(`Season ${season}: cold-start season (--cold-start-season=${coldStartSeason}) — every algorithm starts fresh.`);
    } else {
      const carried = new Map<string, unknown>();
      for (const algorithm of algorithms) {
        const priorState = liveStates.get(algorithm.id);
        if (algorithm.carrySeason && priorState !== undefined) {
          carried.set(algorithm.id, algorithm.carrySeason(priorState, boundary));
        }
      }
      initialStates = carried;
    }

    const { predictions, finalStates } = await runSeason(db, season, algorithms, includeOffseason, initialStates);
    all.push(...predictions);
    liveStates = new Map(finalStates);
  }
  return all;
}

/**
 * The season/multi-season path: reads the already-ingested corpus
 * read-only (T-01-13 — a scoring run cannot mutate the data it scores),
 * replays every requested season cross-event-interleaved for every
 * supplied algorithm (D-22), and writes one combined artifact and report
 * covering the whole range and every algorithm (D-20).
 */
async function runSeasonsMode(
  seasons: readonly number[],
  algorithms: readonly AlgorithmModule<any>[],
  outDir: string,
  includeOffseason: boolean,
  coldStartSeason: number
): Promise<void> {
  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    const predictions = await runSeasons(db, seasons, algorithms, includeOffseason, coldStartSeason);
    const slices = aggregateScores(predictions);

    const statboticsReferences: StatboticsReference[] = [];
    for (const season of seasons) {
      statboticsReferences.push(await statboticsReference(season, { cachePath: STATBOTICS_CACHE_PATH }));
    }

    const artifact = buildArtifact({
      algorithms: algorithms.map((a) => ({ id: a.id, version: a.version })),
      corpusIdentity: CORPUS_PATH,
      slices,
      statboticsReferences,
    });

    const artifactPath = writeArtifact(outDir, artifact);
    console.log(`Wrote ${artifactPath}`);
    await writeReport(outDir, artifact);
  } finally {
    db.close();
  }
}

/**
 * The legacy single-event path (unchanged from the tracer/Plan 05 scope,
 * extended for D-22 to drive several algorithms over the one event's
 * shared stream): fetches one event from TBA, normalizes and upserts it
 * into the corpus, then replays and scores just that event. Kept for quick
 * single-event smoke tests; --season/--seasons is the path Phase 1's full
 * backtest uses.
 */
async function runEventMode(eventKey: string, algorithms: readonly AlgorithmModule<any>[], outDir: string): Promise<void> {
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

    // The single-event CLI derives season from the event key's leading
    // 4 digits (TBA's own convention, e.g. "2024casj").
    const season = Number.parseInt(eventKey.slice(0, 4), 10);
    if (!Number.isInteger(season)) {
      throw new Error(`Could not derive a season from event key ${eventKey} (expected a leading 4-digit year)`);
    }

    const teams = Array.from(new Set(matches.flatMap((m) => [...m.redTeams, ...m.blueTeams])));

    const simulator = new WalkForwardSimulator(matches);
    const records = simulator.runAll(algorithms, teams);

    const predictions: HarnessPredictionInput[] = records.map((r) => ({
      matchKey: r.match.matchKey,
      season,
      compLevel: r.match.compLevel,
      algorithmId: r.algorithmId,
      pRedWin: r.prediction.pRedWin,
      predictedRedScore: r.prediction.redScore,
      predictedBlueScore: r.prediction.blueScore,
      actualWinner: r.match.winner,
      isOffseason,
      isSurrogateAffected: r.match.redSurrogates.length > 0 || r.match.blueSurrogates.length > 0,
    }));

    const slices = aggregateScores(predictions);
    const statboticsRef = await statboticsReference(season, { cachePath: STATBOTICS_CACHE_PATH });

    const artifact = buildArtifact({
      algorithms: algorithms.map((a) => ({ id: a.id, version: a.version })),
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

/** `--cold-start-season <year>` (D-19): parses to a 4-digit year, defaulting to `COLD_START_SEASON` when omitted. */
function parseColdStartSeason(spec: string | undefined): number {
  if (spec === undefined) return COLD_START_SEASON;
  const season = Number.parseInt(spec, 10);
  if (!Number.isInteger(season)) {
    throw new Error(`--cold-start-season must be a 4-digit year, got "${spec}"`);
  }
  return season;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      event: { type: "string" },
      season: { type: "string" },
      seasons: { type: "string" },
      algorithm: { type: "string" },
      out: { type: "string" },
      "include-offseason": { type: "boolean" },
      "cold-start-season": { type: "string" },
    },
  });

  const algorithms = resolveAlgorithms(values.algorithm);
  const outDir = values.out ?? DEFAULT_OUT_DIR;
  const includeOffseason = values["include-offseason"] === true;
  const coldStartSeason = parseColdStartSeason(values["cold-start-season"]);

  if (values.event) {
    await runEventMode(values.event, algorithms, outDir);
  } else if (values.seasons || values.season) {
    const seasons = values.seasons ? parseSeasonsRange(values.seasons) : [parseSingleSeason(values.season!)];
    await runSeasonsMode(seasons, algorithms, outDir, includeOffseason, coldStartSeason);
  } else {
    throw new Error("One of --event, --season, or --seasons is required");
  }
}

// Guard: only auto-run `main()` when this file is the process entry point
// (`pnpm harness ...`), never on a bare `import` — `cli.season-carry.test.ts`
// imports `runSeasons` directly for the T-02-08 regression, and importing a
// module must never have the side effect of parsing `process.argv` and
// invoking a real corpus run.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("harness failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
