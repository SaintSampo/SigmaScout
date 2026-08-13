/**
 * better-sqlite3 wrapper with typed queries (DATA-01/DATA-02). Applies
 * schema.sql idempotently, enables WAL, and implements the diff-on-upsert
 * replay detector (RESEARCH.md Pitfall 1): TBA exposes no "this match was
 * replayed" field, so a match already carrying a winner whose score-bearing
 * fields change on a later upsert is flagged `replayed = true` (D-08) while
 * only the final result is kept.
 */
import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CompLevel, MatchResult } from "../core/algorithms/types.js";
import type { CorpusEvent, CorpusMatch } from "../ingest/normalize.js";

export type Corpus = InstanceType<typeof Database>;

const SCHEMA_PATH = fileURLToPath(new URL("./schema.sql", import.meta.url));

export function openCorpus(path: string): Corpus {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));
  return db;
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

interface ExistingScoreRow {
  winner: string | null;
  red_score: number | null;
  blue_score: number | null;
  replayed: number;
}

export function upsertMatch(db: Corpus, match: CorpusMatch): void {
  const existing = db
    .prepare(`SELECT winner, red_score, blue_score, replayed FROM matches WHERE match_key = ?`)
    .get(match.matchKey) as ExistingScoreRow | undefined;

  // A match already had a scored result AND the new upsert changes its
  // score-bearing fields while itself producing a scored result: this is
  // TBA silently overwriting a completed match's score, i.e. a replay.
  const isReplay =
    existing !== undefined &&
    existing.winner !== null &&
    match.winner !== null &&
    (existing.winner !== match.winner ||
      existing.red_score !== match.redScore ||
      existing.blue_score !== match.blueScore);
  const replayed = isReplay || existing?.replayed === 1;

  db.prepare(
    `INSERT INTO matches (
       match_key, event_key, comp_level, match_number, set_number, sort_time,
       red_teams, blue_teams, red_surrogates, blue_surrogates, red_dqs, blue_dqs,
       winner, red_score, blue_score, red_rp_earned, blue_rp_earned,
       has_score_breakdown, score_breakdown_raw, replayed
     ) VALUES (
       @matchKey, @eventKey, @compLevel, @matchNumber, @setNumber, @sortTime,
       @redTeams, @blueTeams, @redSurrogates, @blueSurrogates, @redDqs, @blueDqs,
       @winner, @redScore, @blueScore, @redRpEarned, @blueRpEarned,
       @hasScoreBreakdown, @scoreBreakdownRaw, @replayed
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
       red_score = excluded.red_score,
       blue_score = excluded.blue_score,
       red_rp_earned = excluded.red_rp_earned,
       blue_rp_earned = excluded.blue_rp_earned,
       has_score_breakdown = excluded.has_score_breakdown,
       score_breakdown_raw = excluded.score_breakdown_raw,
       replayed = excluded.replayed`
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
    redScore: match.redScore,
    blueScore: match.blueScore,
    redRpEarned: match.redRpEarned,
    blueRpEarned: match.blueRpEarned,
    hasScoreBreakdown: match.hasScoreBreakdown ? 1 : 0,
    scoreBreakdownRaw: match.scoreBreakdownRaw,
    replayed: replayed ? 1 : 0,
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
}

/** Only rows with a recorded winner (played matches) are returned — the walk-forward harness replays completed matches. */
export function selectMatchesChronological(db: Corpus, eventKey: string): MatchResult[] {
  const rows = db
    .prepare(
      `SELECT match_key, event_key, comp_level, match_number, set_number,
              red_teams, blue_teams, red_surrogates, blue_surrogates,
              winner, red_score, blue_score, red_rp_earned, blue_rp_earned, has_score_breakdown
       FROM matches
       WHERE event_key = ? AND winner IS NOT NULL
       ORDER BY sort_time ASC`
    )
    .all(eventKey) as MatchRow[];

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
  }));
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
