/**
 * better-sqlite3 wrapper with typed queries (DATA-01/DATA-02). Applies
 * schema.sql idempotently, enables WAL, and wires the diff-on-upsert
 * replay detector (RESEARCH.md Pitfall 1): TBA exposes no "this match was
 * replayed" field, so a match already carrying a winner whose score-bearing
 * fields change on a later upsert is flagged `replayed = true` (D-08) while
 * only the final result is kept. The diff itself (`detectReplay`) is a pure
 * function in packages/ingest/normalize.ts; this module is the only place
 * that can see the previously-stored row, so it reads that row and calls
 * the pure detector before every write — a caller cannot bypass the check
 * by upserting directly.
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CompLevel, MatchResult } from "../core/algorithms/types.js";
import {
  detectReplay,
  type CorpusEvent,
  type CorpusMatch,
  type ExistingMatchScoreFields,
} from "../ingest/normalize.js";

export type Corpus = InstanceType<typeof Database>;

const SCHEMA_PATH = fileURLToPath(new URL("./schema.sql", import.meta.url));

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we lack permission to signal it —
    // still alive. Any other error (typically ESRCH) means it's gone.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Single-writer lock (T-01-08): a `<path>.lock` file records the owning
 * PID. A second concurrent `openCorpus` on the same file fails fast with a
 * readable message instead of interleaving writes into a half-built
 * corpus. A lock file left behind by a crashed process (owning PID no
 * longer alive) is treated as stale and reclaimed automatically, so an
 * interrupted run can always be resumed.
 */
function acquireWriteLock(lockPath: string): void {
  if (existsSync(lockPath)) {
    const ownerPid = Number(readFileSync(lockPath, "utf8").trim());
    if (Number.isFinite(ownerPid) && isProcessAlive(ownerPid)) {
      throw new Error(
        `Corpus is already open for writing by process ${ownerPid} (lock file: ${lockPath}). ` +
          `Wait for it to finish, or delete the lock file if you are certain that process is gone.`
      );
    }
    // Stale lock from a process that no longer exists — reclaim it.
  }
  writeFileSync(lockPath, String(process.pid), "utf8");
}

/**
 * True when the given handle's `matches` table already carries the
 * `winner_imputed` column (D-03). `schema.sql` is applied with `CREATE
 * TABLE IF NOT EXISTS`, so a database created before this column existed is
 * never migrated — this predicate is the single source of truth both
 * `openCorpus`'s open-time guard and `integrity.test.ts`'s skip guard read,
 * so the two cannot drift (per this plan's `key_links`).
 */
export function hasWinnerImputedColumn(db: Corpus): boolean {
  const columns = db.prepare(`PRAGMA table_info(matches)`).all() as { name: string }[];
  return columns.some((column) => column.name === "winner_imputed");
}

export function openCorpus(path: string): Corpus {
  mkdirSync(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  acquireWriteLock(lockPath);

  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  // D-02/01-REVIEW WR-04: a match written before its event row must fail at
  // write time — where the ordering bug is — rather than silently
  // vanishing from selectMatchesChronological's inner join at read time.
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));

  const originalClose = db.close.bind(db);
  db.close = function close(this: Corpus) {
    try {
      unlinkSync(lockPath);
    } catch {
      // Lock file already gone — nothing to clean up.
    }
    return originalClose();
  } as Corpus["close"];

  if (!hasWinnerImputedColumn(db)) {
    // Release the lock/handle before throwing so a stale-but-live-process
    // lock doesn't block the next openCorpus call in this same process.
    db.close();
    throw new Error(
      `Corpus at ${path} predates the winner_imputed column (D-03, 01-REVIEW WR-06). ` +
        `schema.sql is applied with CREATE TABLE IF NOT EXISTS, so an existing database is never migrated. ` +
        `Delete ${path} along with its -wal and -shm siblings and re-run pnpm ingest — ` +
        `the corpus is gitignored and disposable by design.`
    );
  }

  return db;
}

/**
 * Opens the corpus for read-only access (T-01-13): no write lock is
 * acquired (multiple readers, including one running alongside an open
 * writer under WAL, are safe) and the schema is not (re-)applied — the
 * corpus must already exist (`fileMustExist: true` gives a clear error
 * rather than silently creating an empty file). A write attempted through
 * this handle fails at the SQLite layer itself (`better-sqlite3`'s
 * `readonly` mode), turning "the harness only reads the corpus it scores"
 * from a convention into a runtime guarantee.
 */
export function openCorpusReadOnly(path: string): Corpus {
  return new Database(path, { readonly: true, fileMustExist: true });
}

export interface CorpusTeam {
  teamKey: string;
  teamNumber: number;
  nickname: string | null;
}

export function upsertTeam(db: Corpus, team: CorpusTeam): void {
  db.prepare(
    `INSERT INTO teams (team_key, team_number, nickname)
     VALUES (@teamKey, @teamNumber, @nickname)
     ON CONFLICT(team_key) DO UPDATE SET
       team_number = excluded.team_number,
       nickname = excluded.nickname`
  ).run({ teamKey: team.teamKey, teamNumber: team.teamNumber, nickname: team.nickname });
}

export function upsertEvent(db: Corpus, event: CorpusEvent): void {
  db.prepare(
    `INSERT INTO events (event_key, year, event_type, is_offseason, start_date)
     VALUES (@eventKey, @year, @eventType, @isOffseason, @startDate)
     ON CONFLICT(event_key) DO UPDATE SET
       year = excluded.year,
       event_type = excluded.event_type,
       is_offseason = excluded.is_offseason,
       start_date = excluded.start_date`
  ).run({
    eventKey: event.eventKey,
    year: event.year,
    eventType: event.eventType,
    isOffseason: event.isOffseason ? 1 : 0,
    startDate: event.startDate,
  });
}

export type ExistingMatchScore = ExistingMatchScoreFields;

interface ExistingMatchScoreRow {
  winner: string | null;
  red_score: number | null;
  blue_score: number | null;
  score_breakdown_raw: string | null;
  replayed: number;
  replay_detected_at: string | null;
}

/** The currently-stored score-bearing fields for a match key, or undefined if never ingested. Task 3's replay detector reads this before every upsert. */
export function selectExistingMatch(db: Corpus, matchKey: string): ExistingMatchScore | undefined {
  const row = db
    .prepare(
      `SELECT winner, red_score, blue_score, score_breakdown_raw, replayed, replay_detected_at
       FROM matches WHERE match_key = ?`
    )
    .get(matchKey) as ExistingMatchScoreRow | undefined;
  if (row === undefined) return undefined;
  return {
    winner: row.winner as "red" | "blue" | "tie" | null,
    redScore: row.red_score,
    blueScore: row.blue_score,
    scoreBreakdownRaw: row.score_breakdown_raw,
    replayed: row.replayed === 1,
    replayDetectedAt: row.replay_detected_at,
  };
}

export function upsertMatch(db: Corpus, match: CorpusMatch): void {
  const existing = selectExistingMatch(db, match.matchKey);
  const { replayed, replayDetectedAt } = detectReplay(
    existing,
    {
      winner: match.winner,
      redScore: match.redScore,
      blueScore: match.blueScore,
      scoreBreakdownRaw: match.scoreBreakdownRaw,
    },
    new Date().toISOString()
  );

  db.prepare(
    `INSERT INTO matches (
       match_key, event_key, comp_level, match_number, set_number, sort_time,
       red_teams, blue_teams, red_surrogates, blue_surrogates, red_dqs, blue_dqs,
       winner, winner_imputed, red_score, blue_score, red_rp_earned, blue_rp_earned,
       has_score_breakdown, score_breakdown_raw, replayed, replay_detected_at
     ) VALUES (
       @matchKey, @eventKey, @compLevel, @matchNumber, @setNumber, @sortTime,
       @redTeams, @blueTeams, @redSurrogates, @blueSurrogates, @redDqs, @blueDqs,
       @winner, @winnerImputed, @redScore, @blueScore, @redRpEarned, @blueRpEarned,
       @hasScoreBreakdown, @scoreBreakdownRaw, @replayed, @replayDetectedAt
     )
     ON CONFLICT(match_key) DO UPDATE SET
       comp_level = excluded.comp_level,
       match_number = excluded.match_number,
       set_number = excluded.set_number,
       sort_time = excluded.sort_time,
       red_teams = excluded.red_teams,
       blue_teams = excluded.blue_teams,
       red_surrogates = excluded.red_surrogates,
       blue_surrogates = excluded.blue_surrogates,
       red_dqs = excluded.red_dqs,
       blue_dqs = excluded.blue_dqs,
       winner = excluded.winner,
       winner_imputed = excluded.winner_imputed,
       red_score = excluded.red_score,
       blue_score = excluded.blue_score,
       red_rp_earned = excluded.red_rp_earned,
       blue_rp_earned = excluded.blue_rp_earned,
       has_score_breakdown = excluded.has_score_breakdown,
       score_breakdown_raw = excluded.score_breakdown_raw,
       replayed = excluded.replayed,
       replay_detected_at = excluded.replay_detected_at`
  ).run({
    matchKey: match.matchKey,
    eventKey: match.eventKey,
    compLevel: match.compLevel,
    matchNumber: match.matchNumber,
    setNumber: match.setNumber,
    sortTime: match.sortTime,
    redTeams: JSON.stringify(match.redTeams),
    blueTeams: JSON.stringify(match.blueTeams),
    redSurrogates: JSON.stringify(match.redSurrogates),
    blueSurrogates: JSON.stringify(match.blueSurrogates),
    redDqs: JSON.stringify(match.redDqs),
    blueDqs: JSON.stringify(match.blueDqs),
    winner: match.winner,
    winnerImputed: match.winnerImputed ? 1 : 0,
    redScore: match.redScore,
    blueScore: match.blueScore,
    redRpEarned: match.redRpEarned,
    blueRpEarned: match.blueRpEarned,
    hasScoreBreakdown: match.hasScoreBreakdown ? 1 : 0,
    scoreBreakdownRaw: match.scoreBreakdownRaw,
    replayed: replayed ? 1 : 0,
    replayDetectedAt,
  });
}

interface MatchRow {
  match_key: string;
  event_key: string;
  comp_level: string;
  match_number: number;
  set_number: number;
  red_teams: string;
  blue_teams: string;
  red_surrogates: string;
  blue_surrogates: string;
  winner: string | null;
  red_score: number | null;
  blue_score: number | null;
  red_rp_earned: number | null;
  blue_rp_earned: number | null;
  has_score_breakdown: number;
  score_breakdown_raw: string | null;
  event_type: number;
}

export interface ChronologicalQueryOptions {
  /** Restrict to a single event. */
  eventKey?: string;
  /** Restrict to a single season. */
  year?: number;
  /** Drop matches belonging to an event flagged is_offseason (D-06's default for anything feeding ratings or scoring). */
  excludeOffseason?: boolean;
}

/**
 * Only rows with a recorded winner (played matches) are returned — the
 * walk-forward harness replays completed matches.
 *
 * Sorting by `sort_time` alone is ambiguous: matches at concurrent events
 * genuinely share timestamps, and TBA's `actual_time` is absent for some
 * historical/offseason matches, so the fallback chain in normalize.ts
 * produces collisions by construction. Ties are broken deterministically on
 * event_key, then comp-level play order (qm, ef, qf, sf, f), then
 * set_number, then match_number, making the chronological read a total
 * order rather than an ambiguous one.
 */
export function selectMatchesChronological(
  db: Corpus,
  options: ChronologicalQueryOptions = {}
): MatchResult[] {
  const clauses: string[] = ["m.winner IS NOT NULL"];
  const params: Record<string, string | number> = {};

  if (options.eventKey !== undefined) {
    clauses.push("m.event_key = @eventKey");
    params["eventKey"] = options.eventKey;
  }
  if (options.year !== undefined) {
    clauses.push("e.year = @year");
    params["year"] = options.year;
  }
  if (options.excludeOffseason === true) {
    clauses.push("e.is_offseason = 0");
  }

  const rows = db
    .prepare(
      `SELECT m.match_key, m.event_key, m.comp_level, m.match_number, m.set_number,
              m.red_teams, m.blue_teams, m.red_surrogates, m.blue_surrogates,
              m.winner, m.red_score, m.blue_score, m.red_rp_earned, m.blue_rp_earned,
              m.has_score_breakdown, m.score_breakdown_raw, e.event_type
       FROM matches m
       JOIN events e ON e.event_key = m.event_key
       WHERE ${clauses.join(" AND ")}
       ORDER BY
         m.sort_time ASC,
         m.event_key ASC,
         CASE m.comp_level
           WHEN 'qm' THEN 0 WHEN 'ef' THEN 1 WHEN 'qf' THEN 2 WHEN 'sf' THEN 3 WHEN 'f' THEN 4
           ELSE 5
         END ASC,
         m.set_number ASC,
         m.match_number ASC`
    )
    .all(params) as MatchRow[];

  return rows.map((row) => ({
    matchKey: row.match_key,
    eventKey: row.event_key,
    compLevel: row.comp_level as CompLevel,
    setNumber: row.set_number,
    matchNumber: row.match_number,
    redTeams: JSON.parse(row.red_teams) as string[],
    blueTeams: JSON.parse(row.blue_teams) as string[],
    redSurrogates: JSON.parse(row.red_surrogates) as string[],
    blueSurrogates: JSON.parse(row.blue_surrogates) as string[],
    winner: row.winner as "red" | "blue" | "tie",
    redScore: row.red_score ?? 0,
    blueScore: row.blue_score ?? 0,
    redRpEarned: row.red_rp_earned,
    blueRpEarned: row.blue_rp_earned,
    hasScoreBreakdown: row.has_score_breakdown === 1,
    scoreBreakdownRaw: row.score_breakdown_raw,
    eventType: row.event_type,
  }));
}

/**
 * Count of `matches` rows with no matching `events` row (D-04). This
 * population is never legitimate — `openCorpus`'s `foreign_keys = ON`
 * pragma (D-02) prevents new orphans going forward, so this count is
 * asserted at 0, forever, by `integrity.test.ts`.
 */
export function selectOrphanMatchCount(db: Corpus): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as n FROM matches m
       LEFT JOIN events e ON e.event_key = m.event_key
       WHERE e.event_key IS NULL`
    )
    .get() as { n: number };
  return row.n;
}

/**
 * Count of `matches` rows whose winner was derived from the score
 * comparison rather than reported by TBA (D-01/D-03). Unlike
 * `selectOrphanMatchCount`, a nonzero value here is valid TBA data the
 * project wants surfaced, not an invariant violation — `integrity.test.ts`
 * reports this count and never asserts it, so correct behavior can never
 * turn the suite red (D-04's explicit asymmetry).
 */
export function selectImputedWinnerCount(db: Corpus): number {
  const row = db.prepare(`SELECT COUNT(*) as n FROM matches WHERE winner_imputed = 1`).get() as { n: number };
  return row.n;
}

export function readEtag(db: Corpus, url: string): string | undefined {
  const row = db.prepare(`SELECT etag FROM http_cache WHERE url = ?`).get(url) as
    | { etag: string }
    | undefined;
  return row?.etag;
}

export function writeEtag(db: Corpus, url: string, etag: string): void {
  db.prepare(
    `INSERT INTO http_cache (url, etag, fetched_at) VALUES (@url, @etag, @fetchedAt)
     ON CONFLICT(url) DO UPDATE SET etag = excluded.etag, fetched_at = excluded.fetched_at`
  ).run({ url, etag, fetchedAt: new Date().toISOString() });
}

export interface IngestRunRecord {
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  seasonStart: number;
  seasonEnd: number;
  requestCount: number;
  cacheHitCount: number;
  completed: boolean;
}

/**
 * Upserts an ingest run's provenance row (T-01-06). Called once to start a
 * run (completed: false, finishedAt: null), then again as progress is made
 * and once more to mark completion — each call is durable immediately, so
 * an interrupted process leaves an accurate, identifiable partial record
 * rather than an all-or-nothing write.
 */
export function recordIngestRun(db: Corpus, run: IngestRunRecord): void {
  db.prepare(
    `INSERT INTO ingest_runs (
       run_id, started_at, finished_at, season_start, season_end,
       request_count, cache_hit_count, completed
     ) VALUES (
       @runId, @startedAt, @finishedAt, @seasonStart, @seasonEnd,
       @requestCount, @cacheHitCount, @completed
     )
     ON CONFLICT(run_id) DO UPDATE SET
       finished_at = excluded.finished_at,
       request_count = excluded.request_count,
       cache_hit_count = excluded.cache_hit_count,
       completed = excluded.completed`
  ).run({
    runId: run.runId,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    seasonStart: run.seasonStart,
    seasonEnd: run.seasonEnd,
    requestCount: run.requestCount,
    cacheHitCount: run.cacheHitCount,
    completed: run.completed ? 1 : 0,
  });
}

interface IngestRunRow {
  run_id: string;
  started_at: string;
  finished_at: string | null;
  season_start: number;
  season_end: number;
  request_count: number;
  cache_hit_count: number;
  completed: number;
}

/** Runs previously started but never marked complete — evidence of an interrupted process (T-01-06). */
export function findIncompleteIngestRuns(db: Corpus): IngestRunRecord[] {
  const rows = db
    .prepare(`SELECT * FROM ingest_runs WHERE completed = 0 ORDER BY started_at ASC`)
    .all() as IngestRunRow[];
  return rows.map((row) => ({
    runId: row.run_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    seasonStart: row.season_start,
    seasonEnd: row.season_end,
    requestCount: row.request_count,
    cacheHitCount: row.cache_hit_count,
    completed: row.completed === 1,
  }));
}
