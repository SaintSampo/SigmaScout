-- SQLite corpus schema (D-05, DATA-02). Follows RESEARCH.md's "SQLite
-- corpus schema sketch". Applied idempotently by packages/corpus/db.ts's
-- openCorpus().

CREATE TABLE IF NOT EXISTS teams (
  team_key TEXT PRIMARY KEY,        -- e.g. "frc254"
  team_number INTEGER NOT NULL,
  nickname TEXT
);

CREATE TABLE IF NOT EXISTS events (
  event_key TEXT PRIMARY KEY,       -- e.g. "2024casj"
  year INTEGER NOT NULL,
  event_type INTEGER NOT NULL,      -- TBA event_type enum (0=Regional ... 99=Offseason, 100=Preseason)
  is_offseason INTEGER NOT NULL,    -- derived: event_type == 99 (D-06)
  start_date TEXT NOT NULL,
  -- EVNT-01 (plan 05-02): five new source fields, all nullable. NULL is
  -- this schema's honest starting value for a row ingested before this
  -- plan's --events-only refresh ran -- see db.ts's openCorpus migration
  -- comment for why these are additive (unlike winner_imputed's rebuild
  -- guard). name is nullable here even though TBA always provides it,
  -- because an un-refreshed corpus row predates this column entirely.
  name TEXT,
  week INTEGER,
  country TEXT,
  state_prov TEXT,
  district_key TEXT               -- TBA's short district abbreviation ("ne", "fim"), not the year-prefixed district.key
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
  winner_imputed INTEGER NOT NULL DEFAULT 0, -- synthesized flag (TBA has no such field): 1 when `winner` was derived from the score comparison rather than TBA's own `winning_alliance` (D-01/D-03, 01-REVIEW WR-06)
  red_score INTEGER,
  blue_score INTEGER,
  red_rp_earned INTEGER,            -- NULL if not derivable yet
  blue_rp_earned INTEGER,
  has_score_breakdown INTEGER NOT NULL,  -- 0 if TBA omitted it (never coerce to 0-value fields)
  score_breakdown_raw TEXT,         -- exact TBA JSON, verbatim (D-05)
  replayed INTEGER NOT NULL DEFAULT 0,   -- synthesized flag (Pitfall 1 — TBA has no such field)
  replay_detected_at TEXT           -- ISO timestamp of the upsert that first detected the replay, NULL until then
);

CREATE INDEX IF NOT EXISTS idx_matches_sort_time ON matches(sort_time);
CREATE INDEX IF NOT EXISTS idx_matches_event ON matches(event_key);

CREATE TABLE IF NOT EXISTS http_cache (
  url TEXT PRIMARY KEY,
  etag TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

-- Provenance for a single ingestion run (DATA-01/DATA-02): makes request
-- volume against a third-party service measurable, and makes an
-- interrupted run identifiable on the next start (completed = 0).
CREATE TABLE IF NOT EXISTS ingest_runs (
  run_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  season_start INTEGER NOT NULL,
  season_end INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  cache_hit_count INTEGER NOT NULL DEFAULT 0,  -- 304 responses
  completed INTEGER NOT NULL DEFAULT 0
);

-- TEAM-02 (plan 06-03): the pipeline's resolved answer to "this team's robot
-- photo for this year" — a URL, or an honest NULL when no usable photo was
-- found (~25% of teams). Additive CREATE TABLE IF NOT EXISTS, matching the
-- EVNT-01 columns' precedent, not winner_imputed's rebuild guard: an
-- existing corpus gains this table on its next openCorpus with no rebuild.
CREATE TABLE IF NOT EXISTS team_media (
  team_key TEXT NOT NULL REFERENCES teams(team_key),
  year INTEGER NOT NULL,
  image_url TEXT,        -- NULL is a real, stored answer: "checked, none found"
  media_type TEXT,        -- which allowlisted type the URL came from (provenance)
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (team_key, year)
);
