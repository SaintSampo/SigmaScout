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

-- TEAM-04 / F-06-3 event rank ingest (plan 06.1-01): a team's TBA-computed
-- standing at one event, one row per (event_key, team_key). Additive
-- CREATE TABLE IF NOT EXISTS, matching team_media's precedent exactly above
-- -- not winner_imputed's rebuild guard (packages/corpus/db.ts's
-- openCorpus): this is a brand-new table, no prior rows, no migration
-- needed. rank/total_teams are NOT NULL because a row is only ever written
-- for a real populated TBA ranking entry (PD-02): a null response body or
-- an empty rankings array writes zero rows for that event, rather than a
-- placeholder row with a fabricated rank.
--
-- record_wins/record_losses/record_ties/ranking_score (D-18.6, plan 07-02
-- Task 2): four additive nullable columns, following EVNT-01's
-- ALTER-TABLE-ADD-COLUMN precedent (db.ts's openCorpus migration comment)
-- rather than this table's own CREATE-TABLE-IF-NOT-EXISTS precedent, since
-- they widen an existing table rather than create a new one — see
-- EVENT_RANKING_RECORD_COLUMNS / hasEventRankingRecordColumns in db.ts for
-- the migration that lands them on a corpus created before this plan.
-- Nullable because a row ingested before 07-04's widened ingest ran
-- genuinely has no answer for them, and NULL is that honest answer.
-- record_wins/record_losses/record_ties come from the TBA ranking entry's
-- own `record` object — the authoritative source, since it accounts for
-- DQs and surrogate appearances a matches[]-derived count would not.
-- ranking_score comes from `sort_orders[0]` and is REAL because TBA's value
-- is a per-match average, not a count; it is named for the exact string
-- `sort_order_info[0].name` carries in every one of the 40 events
-- RESEARCH.md sampled across 5 seasons and 8 event types ("Ranking
-- Score") — 07-04 asserts that string at ingest, so the column name and
-- the guard cannot drift apart.
CREATE TABLE IF NOT EXISTS event_rankings (
  event_key TEXT NOT NULL REFERENCES events(event_key),
  team_key TEXT NOT NULL REFERENCES teams(team_key),
  rank INTEGER NOT NULL,
  total_teams INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  record_wins INTEGER,   -- TBA ranking entry's record.wins; NULL until 07-04's widened ingest fills it
  record_losses INTEGER, -- TBA ranking entry's record.losses; NULL until 07-04's widened ingest fills it
  record_ties INTEGER,   -- TBA ranking entry's record.ties; NULL until 07-04's widened ingest fills it
  ranking_score REAL,    -- TBA's sort_orders[0], named for sort_order_info[0].name === "Ranking Score"; NULL until 07-04's widened ingest fills it
  PRIMARY KEY (event_key, team_key)
);

-- Playoff alliance selection ingest (D-18.7, plan 07-02 Task 1): one row per
-- (event_key, alliance_number), sourced from TBA's `/event/{key}/alliances`.
-- Additive CREATE TABLE IF NOT EXISTS, matching team_media/event_rankings's
-- precedent exactly above -- not winner_imputed's rebuild guard: this is a
-- brand-new table, no prior rows, no migration needed. An event with no
-- alliance selection stores ZERO rows here, never a placeholder row with a
-- fabricated seed (D-17's disabled-tab treatment on the site reads that
-- absence, so absence has to be real) -- matching event_rankings' own PD-02
-- discipline above.
CREATE TABLE IF NOT EXISTS event_alliances (
  event_key TEXT NOT NULL REFERENCES events(event_key),
  -- The 1-based index of the alliance object in TBA's own response array --
  -- TBA's seed order. Never parsed out of `name`, because `name` is absent
  -- entirely at some events (live-observed at 2024wvrox).
  alliance_number INTEGER NOT NULL,
  -- Nullable; NULL is the honest stored value for "TBA sent no name" --
  -- never an empty string, never a synthesized "Alliance {n}". Rendering a
  -- fallback label is 07-14's decision, not this layer's.
  name TEXT,
  -- JSON array of team keys in TBA's order, the same representation
  -- matches.red_teams already uses. picks[0] is the captain and picks[3] is
  -- the backup where a 4th team exists; TBA has no separate backup field
  -- (D-16), so this schema must not invent one. Deliberately carries no
  -- REFERENCES teams(team_key) -- same as matches.red_teams -- because
  -- 06.1-01 hit a live foreign-key failure on TBA's synthetic second-robot
  -- team keys (frc1165B and siblings at 2024azrl1..5), which have no
  -- /team/{key} record at all.
  picks TEXT NOT NULL,
  -- JSON array, "[]" when empty -- RESEARCH.md observed it empty in all 40
  -- sampled events. Stored as source provenance following
  -- matches.score_breakdown_raw's D-05 verbatim precedent. Read by nothing
  -- in Phase 7, kept so a later consumer of alliance status/playoff record
  -- does not have to spend another full-corpus live TBA pass over ~1,581
  -- events.
  declines TEXT NOT NULL,
  -- TBA's `status` object serialized verbatim, nullable. RESEARCH.md Q2
  -- measured its shape varying by playoff_type (values 0, 4, 8 and 10
  -- observed) -- precisely why it is stored whole rather than modelled
  -- column-by-column.
  status_raw TEXT,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (event_key, alliance_number)
);

-- District point data ingest (quick task 260905-lic Task 1): three brand-new
-- tables backing the Districts page's lock math. Additive CREATE TABLE IF
-- NOT EXISTS, matching event_alliances' precedent exactly above -- no
-- migration, no rebuild guard.
--
-- district_key here is TBA's YEAR-PREFIXED key (e.g. "2026fnc") -- NOT the
-- bare abbreviation events.district_key already stores (e.g. "fnc"). The two
-- columns share a name across two tables and mean DIFFERENT things: this
-- table's district_key uniquely identifies one district for one year;
-- events.district_key is the same district's abbreviation, shared across
-- every year that district existed. Do not confuse them.
CREATE TABLE IF NOT EXISTS districts (
  district_key TEXT PRIMARY KEY,    -- TBA's year-prefixed key, e.g. "2026fnc"
  year INTEGER NOT NULL,
  abbreviation TEXT NOT NULL,        -- e.g. "fnc" -- see the district_key note above
  display_name TEXT NOT NULL,
  -- Nullable: NULL is the honest stored answer for "TBA published no
  -- official_advancement_counts for this district-year" -- never a zero and
  -- never a guessed number. The lock math (Task 2) must treat null slots as
  -- "capacity unknown", not "zero capacity".
  dcmp_slots INTEGER,
  cmp_slots INTEGER,
  fetched_at TEXT NOT NULL
);

-- One row per (district, team): a team's official district point standing,
-- sourced from TBA's `/district/{key}/rankings`. Primary key
-- (district_key, team_key) -- no REFERENCES teams(team_key) clause, mirroring
-- event_alliances.picks' precedent: TBA's synthetic second-robot team keys
-- (frc1165B and siblings) have no /team/{key} record and caused a live
-- foreign-key failure in 06.1-01.
CREATE TABLE IF NOT EXISTS district_rankings (
  district_key TEXT NOT NULL REFERENCES districts(district_key),
  team_key TEXT NOT NULL,
  rank INTEGER NOT NULL,
  point_total INTEGER NOT NULL,
  rookie_bonus INTEGER NOT NULL,
  adjustments INTEGER NOT NULL,
  -- TBA's event_points array, stored VERBATIM as JSON, following
  -- matches.score_breakdown_raw / event_alliances.status_raw's provenance
  -- precedent -- the publish layer (Task 2) parses it with its own
  -- season-aware Zod schema rather than this table modelling the
  -- per-component point model column-by-column, since that model changed
  -- across the seasons this corpus ingests.
  event_points_raw TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (district_key, team_key)
);

-- Event registration: the only way to know a team has an event still ahead
-- of it (Task 2's maxRemaining computation). One row per (event, team),
-- sourced from TBA's `/event/{key}/teams/keys`. Carries NO
-- REFERENCES teams(team_key) clause, for the same reason event_alliances.picks
-- carries none -- see district_rankings' comment above. event_key DOES carry
-- a REFERENCES events(event_key) clause: a registration row for an event this
-- corpus has never ingested cannot exist, and the ingest layer must log
-- (never silently drop) any district event key it cannot resolve against the
-- corpus events table.
CREATE TABLE IF NOT EXISTS event_teams (
  event_key TEXT NOT NULL REFERENCES events(event_key),
  team_key TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (event_key, team_key)
);
