-- `ingest_log`: the durable, queryable record of what the live tick saw and when
-- (quick task 261004-uyc). One row per observation worth analysing, never one per
-- tick: an unchanged poll (304) writes nothing, so the table grows with what
-- TBA actually did and not with the cron's cadence.
--
-- WHAT A ROW IS. `kind` is one of
--   endpoint : a TBA endpoint answered with a changed body this tick. `subject`
--              is the endpoint name (matches, rankings, alliances, teams).
--              `tba_last_modified` is TBA's own Last-Modified header, so the
--              gap between it and `observed_at` is how late the tick was.
--   match    : one newly folded match. `subject` is the match key. It carries
--              TBA's `actual_time` and `post_result_time` (epoch seconds, as
--              TBA states them) beside the Worker's own `observed_at`,
--              `folded_at` and `published_at` (ISO strings), which is the whole
--              post to published latency chain on one row.
--   phase    : the event moved to a new phase. `subject` is the new phase.
--   failure  : something the tick swallowed. `subject` is the failing stage,
--              `detail` a message cut to 300 characters.
-- `phase` is the event's phase at the time of the row, for per phase summaries.
--
-- WHY D1 AND NOT WORKERS LOGS. Logs expire, and a finished event must stay
-- queryable for as long as anyone wants to ask why a page was late. D1 is also
-- the one store `pnpm live:report` can read with the operator's own session.
--
-- IDEMPOTENT. Every statement is IF NOT EXISTS, so applying this file twice is
-- harmless (unlike 0002's ALTER TABLE). Times are ISO strings except the two TBA
-- columns, which keep TBA's epoch seconds untouched.
--
-- APPLY ORDER. Apply this migration BEFORE deploying the Worker that writes to
-- it. A Worker that runs against a missing table loses nothing but this log: the
-- flush never throws, it warns once per changed tick and the fold goes on.
CREATE TABLE IF NOT EXISTS ingest_log (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key            TEXT NOT NULL,
  tick_at              TEXT NOT NULL,
  kind                 TEXT NOT NULL,
  subject              TEXT NOT NULL,
  phase                TEXT,
  tba_last_modified    TEXT,
  tba_actual_time      INTEGER,
  tba_post_result_time INTEGER,
  observed_at          TEXT NOT NULL,
  folded_at            TEXT,
  published_at         TEXT,
  detail               TEXT
);

CREATE INDEX IF NOT EXISTS idx_ingest_log_event ON ingest_log(event_key, id);
CREATE INDEX IF NOT EXISTS idx_ingest_log_observed ON ingest_log(observed_at);
