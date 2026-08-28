-- D1 schema for the Worker's live algorithm state and per-event cron
-- bookkeeping (D-12/D-13/D-09, plan 04-03 Task 3). Applied with `wrangler d1
-- migrations apply` / `wrangler d1 execute --file` (`packages/corpus/schema.sql`'s
-- own CREATE TABLE IF NOT EXISTS / comment-header conventions, mirrored here).
--
-- algorithm_state (D-12/D-13/D-09):
--   D-12: the offline pipeline is the AUTHORITY. A scheduled re-baseline
--   overwrites this table's rows in place (see packages/harness/stateSnapshot.ts's
--   emitSeedSql, which leads every seed with a DELETE ... WHERE algorithm_id
--   = '<id>' guard) — the Worker only LOADS and ADVANCES; incremental drift
--   is corrected on the next re-baseline rather than compounding across a
--   season.
--   D-13: `scope_kind`/`scope_key` (never a bare `team_key` column) is what
--   makes a Worker's per-tick read a slice, never the whole league — a tick
--   only ever needs `WHERE algorithm_id = ? AND scope_kind = ? AND scope_key
--   IN (...)`, an indexed lookup against `PRIMARY KEY (algorithm_id,
--   scope_kind, scope_key)` below.
--   D-09: the three shipped algorithms do NOT share a granularity —
--   VPR/EPA accumulate per TEAM (VPR renamed from Sigma1 by plan 07-16,
--   D-04/D-05 — this schema's SQL text is unchanged by that rename, only
--   this comment's naming is), but event-scoped OPR accumulates per
--   EVENT (`OprState.perEvent`, keyed by `eventKey` — Phase 3.2's whole
--   reason for existing was that season-pooled OPR's per-team state
--   exceeded a Worker's memory outright). A `team_state` table would have
--   forced OPR's event-shaped state into a per-team column; this schema
--   says `scope` instead, exactly as `stateSnapshot.ts`'s `StateRowSchema`
--   does.
--
--   `algorithm_version` is deliberately NOT part of the primary key — it is
--   stored as a plain column so every row says which version produced it,
--   but keying on it would mean a version bump silently accumulates a
--   SECOND full copy of the league's state alongside the first, against
--   D1's 500 MB per-database free-tier ceiling. Instead a re-baseline
--   overwrites in place (the DELETE-then-INSERT seed above) and a row's own
--   `algorithm_version` column tells a reader what produced it — the same
--   stable-path-plus-stamp shape D-04 already chose for published R2
--   artifacts, applied here to D1 rows instead of JSON files.
CREATE TABLE IF NOT EXISTS algorithm_state (
  algorithm_id      TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  scope_kind        TEXT NOT NULL,   -- 'team' | 'event' | 'league'
  scope_key         TEXT NOT NULL,
  state_json        TEXT NOT NULL,
  generation        TEXT NOT NULL,
  computed_at       TEXT NOT NULL,
  PRIMARY KEY (algorithm_id, scope_kind, scope_key)
);

CREATE INDEX IF NOT EXISTS idx_algorithm_state_scope ON algorithm_state(algorithm_id, scope_kind);

-- event_cursor: per-event cron bookkeeping (D-15/D-19/D-22). Lives in D1,
-- never KV — 04-RESEARCH.md's anti-pattern list explicitly forbids
-- per-event-per-tick writes against KV's 1,000 writes/day free cap, and a
-- live event day can tick this table far more often than that. KV holds
-- only the small, hot manifest pointer; this table holds everything a tick
-- needs to remember about ONE event between invocations.
--   `last_folded_match_key`: the idempotency anchor plan 04-05's incremental
--   update builds on — a tick knows exactly which of an event's matches it
--   has already folded into algorithm_state, so a retried or overlapping
--   tick cannot double-apply a match's update().
--   `tba_etag`: what makes D-22's conditional TBA requests possible from the
--   Worker (the same ETag-conditional discipline packages/ingest/tbaClient.ts
--   already uses offline) — a 304 costs the same subrequest as a 200 but
--   saves the bandwidth/parse cost of a body the Worker already has.
CREATE TABLE IF NOT EXISTS event_cursor (
  event_key             TEXT PRIMARY KEY,
  tba_etag              TEXT,
  last_folded_match_key TEXT,
  last_polled_at        TEXT,
  last_advanced_at      TEXT
);
