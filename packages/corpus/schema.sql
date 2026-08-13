-- SQLite corpus schema (D-05, DATA-02). Follows RESEARCH.md's "SQLite
-- corpus schema sketch", scoped to what Plan 02's tracer needs (events,
-- matches, http_cache — no teams table yet). Applied idempotently by
-- packages/corpus/db.ts's openCorpus().

CREATE TABLE IF NOT EXISTS events (
  event_key TEXT PRIMARY KEY,       -- e.g. "2024casj"
  year INTEGER NOT NULL,
  event_type INTEGER NOT NULL,      -- TBA event_type enum (0=Regional ... 99=Offseason, 100=Preseason)
  is_offseason INTEGER NOT NULL,    -- derived: event_type == 99 (D-06)
  start_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  match_key TEXT PRIMARY KEY,       -- e.g. "2024casj_qm12"
  event_key TEXT NOT NULL REFERENCES events(event_key),
  comp_level TEXT NOT NULL,         -- 'qm' | 'ef' | 'qf' | 'sf' | 'f'
  match_number INTEGER NOT NULL,
  set_number INTEGER NOT NULL,
  sort_time INTEGER NOT NULL,       -- actual_time ?? predicted_time ?? time ?? fallback (Pattern 3)
  red_teams TEXT NOT NULL,          -- JSON array of team_keys (includes surrogates)
  blue_teams TEXT NOT NULL,
  red_surrogates TEXT NOT NULL,     -- JSON array, subset of red_teams (D-07)
  blue_surrogates TEXT NOT NULL,
  red_dqs TEXT NOT NULL,            -- JSON array
  blue_dqs TEXT NOT NULL,
  winner TEXT,                      -- 'red' | 'blue' | 'tie' | NULL if unplayed
  red_score INTEGER,
  blue_score INTEGER,
  red_rp_earned INTEGER,            -- NULL if not derivable yet
  blue_rp_earned INTEGER,
  has_score_breakdown INTEGER NOT NULL,  -- 0 if TBA omitted it (never coerce to 0-value fields)
  score_breakdown_raw TEXT,         -- exact TBA JSON, verbatim (D-05)
  replayed INTEGER NOT NULL DEFAULT 0    -- synthesized flag (Pitfall 1 — TBA has no such field)
);

CREATE INDEX IF NOT EXISTS idx_matches_sort_time ON matches(sort_time);
CREATE INDEX IF NOT EXISTS idx_matches_event ON matches(event_key);

CREATE TABLE IF NOT EXISTS http_cache (
  url TEXT PRIMARY KEY,
  etag TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
