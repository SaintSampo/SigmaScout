# API Coverage — The Blue Alliance API v3, `/event/{event_key}/rankings`

> Full coverage by default. Opt-outs are explicit, reasoned decisions.

## Why this file exists despite a `detected: false` detector result

`gsd-tools`' api-coverage detector was run over this phase's scope and returned `detected: false`.
The detector is deterministic, not infallible, and it under-reports here the same way it did for
Phase 6's own `COVERAGE.md`: **this phase genuinely adds one new third-party endpoint** —
TBA's `/event/{event_key}/rankings` — to `packages/ingest/tbaClient.ts`
(`fetchEventRankings`, added in plan 06.1-01). Writing the matrix now is cheap and prevents a
seal-time re-detection surprise.

Scope note: TBA's API as a whole was integrated in Phase 1, and the media endpoint
(`/team/{team_key}/media/{year}`) was decided in Phase 6's own `COVERAGE.md`. This matrix decides
the capability surface of **the rankings endpoint and its response types only** (PD-08) — the one
genuinely new surface this phase opens. Every other TBA endpoint's coverage decision belongs to a
prior phase, not to this one.

## Request-level capabilities

| capability | decision | reason |
|---|---|---|
| `GET /event/{event_key}/rankings` | INTEGRATE | |
| `If-None-Match` / ETag conditional request (304) | INTEGRATE | |
| `Cache-Control` respect | OPT-OUT | the corpus's generic `http_cache` ETag table is the caching mechanism this pipeline already uses for every TBA endpoint; a second, header-driven TTL layer would be a parallel cache with its own drift |
| offseason events in ingest scope | INTEGRATE | TEAM-04's "attended... event" wording is not scoped to in-season only, and this project's own corpus shows offseason events are 553 of the corpus's 1,581 total events (35%) — excluding them would leave over a third of every attended-event section with no standing at all. TBA computes these rankings itself from official match results, not from the self-reported `score_breakdown` JSON that Phase 3's RP fold deliberately excludes offseason events from — a materially different trust boundary. The request-count cost delta is negligible (1,581 vs 1,028 events, roughly one extra minute of throttled requests at 100ms/request). Settles RESEARCH.md Open Question 1 as a decision, per PD-01. |
| `GET /event/{event_key}/district_points` | OPT-OUT | district points are a separate district-ranking concept from event standing; not requested by TEAM-04 and not part of any locked decision this phase carries |
| `GET /event/{event_key}/oprs` | OPT-OUT | this project computes its own event-scoped OPR (`packages/core/algorithms/opr.ts`, `solveEventOpr`) as one of its three v1 algorithms; ingesting TBA's own differently-computed OPR alongside it is the two-implementations-that-drift anti-pattern `.planning/research/ARCHITECTURE.md` names — a reader comparing "TBA's OPR" against "SigmaScout's OPR" for the same event would see two numbers with no way to tell which is authoritative |
| `GET /event/{event_key}/alliances` | OPT-OUT | playoff alliance selections are not requested by TEAM-04 and no locked decision in this phase or a prior one asks for them |
| `GET /event/{event_key}/insights` | OPT-OUT | TBA's per-event insights are a season-specific aggregate statistics blob (structurally similar to `sort_order_info`'s season-varying vocabulary, Pitfall 3) with no display slot in the current UI; not requested by TEAM-04 |

## Response-type and field-level capabilities

Each field on `tbaEventRankingSchema`/`tbaEventRankingsResponseSchema` (`packages/ingest/schemas.ts`)
is a separate row, since each is a separate decision with a separate consumer question. The two
top-level absent-body cases (`null`, empty `rankings: []`) are recorded as their own rows because
each is a distinct, real TBA answer this ingest must not conflate (Pitfall 2).

| capability | decision | reason |
|---|---|---|
| `rank` | INTEGRATE | the entire point of this endpoint — "Rank N of M" needs this field directly, stored as `event_rankings.rank` |
| `team_key` | INTEGRATE | the row key this ingest joins on — stored as `event_rankings.team_key`, matched against the corpus's own `teams` table (see note [1] for the one deviation this join surfaced) |
| `rankings` array length (as the standing's total, "of M") | INTEGRATE | `response.rankings.length` is the true reported pool size for the event and is stored as `event_rankings.total_teams` per row, independent of how many of those rows this corpus could resolve to a known team key |
| top-level `null` body | INTEGRATE | a distinct, real TBA answer ("no ranking structure exists for this event") — tallied in the ingest run's own `nullBodyCount` counter rather than silently coerced to an empty structure; see note [2] |
| empty `rankings: []` array | INTEGRATE | a distinct, real TBA answer ("event exists, quals have not yet run") — tallied in the ingest run's own `emptyRankingsCount` counter; see note [2] |
| `record` (wins/losses/ties) | OPT-OUT | not needed for "Rank N of M"; the team page's match table already derives win/loss/tie from each match's own `actualWinner`, so this would be a second, redundant source for the same fact |
| `matches_played` | OPT-OUT | not needed for "Rank N of M"; derivable from the team's own match list already on the team page if ever needed, with no risk of disagreeing with a second TBA-reported count |
| `dq` | OPT-OUT | not requested by TEAM-04; no disqualification-count display exists anywhere in the current UI |
| `qual_average` | OPT-OUT | observed `null` in every 2022-2026 live sample this session (RESEARCH.md Assumption A1) — TBA appears to have moved this concept into `sort_orders`; ingesting a field this project has never observed populated adds no value |
| `sort_orders` | OPT-OUT | this phase's own success criterion needs only `rank` and `rankings.length`; the array's per-index meaning is season-specific and undocumented without cross-referencing `sort_order_info` (see that row below) |
| `extra_stats` | OPT-OUT | same reasoning as `sort_orders` — undisplayed, season-specific, not needed for "Rank N of M" |
| `sort_order_info` (per-season sort-order column names) | OPT-OUT | the names genuinely differ by season — confirmed live: 2022 uses four names (Ranking Score, Avg Match, Avg Hangar, Avg Taxi + Auto Cargo), 2024 uses five (adds Avg Coop), 2026 uses three different names again (Avg Auto Fuel, Avg Tower, ...). "Rank N of M" needs none of them; building a per-season name table here would be scope creep this phase's own success criterion does not ask for (RESEARCH.md Pitfall 3) |
| `extra_stats_info` | OPT-OUT | same season-varying-vocabulary reasoning as `sort_order_info`; observed `[]` for a not-yet-played event in this session's live verification |

### Notes on the condensed rows above

**[1] `team_key`.** Some 2024 remote-league events (`2024azrl1`..`5`) report rankings for synthetic
second-robot team keys (e.g. `frc1165B`) that TBA's own `/team/{key}` 404s on and that therefore
have no row in this corpus's `teams` table at all. `ingestSeasonRankingsOnly` skips (and separately
tallies via `unknownTeamCount`) a ranking row for any team key not in the corpus's known team set,
rather than failing the whole event's upsert or fabricating a `teams` row — see plan 06.1-01's
Rule 1 deviation. Every other team's `totalTeams` for that event is unaffected, since it is read
from `response.rankings.length` (the true reported pool size), not from a count of rows this corpus
chose to store.

**[2] Null body vs. empty array.** Per PD-02 (locked in plan 06.1-01), this distinction is
preserved only in the ingest run's own log counters (`nullBodyCount`/`emptyRankingsCount`), not as
a stored corpus row — no `event_rankings` row is ever written for either case, since a row is only
ever written for a real, populated TBA ranking entry (`packages/corpus/schema.sql`'s
`event_rankings` comment: "rank/total_teams are NOT NULL because a row is only ever written for a
real populated TBA ranking entry"). The corpus layer therefore has no need to represent "checked,
nothing yet" as a stored row the way `team_media.image_url` represents "checked, no photo found" —
the team page's own event-section rendering already treats an absent `rank`/`totalTeams` pair as
"no standing to show" (both-or-neither rendering, `EventSection.tsx`), which is exactly what a
missing corpus row already produces with zero additional plumbing. Recording the null-vs-empty
split in the ingest run's counters (and in this file's measured-cost section below) is what makes
the distinction visible and auditable, without doubling the corpus's storage/query surface for a
distinction the UI does not need to render differently.

## The recurring cost this integration commits to

`packages/ingest/tbaClient.ts`'s `THROTTLE_INTERVAL_MS = 100` applies per request unconditionally,
including on cache-hit 304 responses. The full ingest, **measured from a real full 2022-2026 run
(plan 06.1-04 Task 2, run `12f17740-e573-4459-bb43-46b7c4b4a193`, 2026-08-26):**

- **Command:** `pnpm ingest:rankings --years 2022-2026`
- **Date:** 2026-08-26
- **Total requests:** 1,582 (1,581 event-scoped `/event/{key}/rankings` requests across the five
  seasons' 1,581 corpus events, plus 1 `/status` health check at run start)
- **Cache hits (304):** 324 — every 2024 event, already ingested fresh by plan 06.1-01's tracer run;
  this is the ETag path working exactly as intended, not a shortfall
- **Fresh (200):** 1,258
- **Elapsed wall clock:** 4 min 13.8 sec (253.8 s), read from `ingest_runs.started_at`
  (`2026-08-26T22:58:43.020Z`) to `finished_at` (`2026-08-26T23:02:56.825Z`) — **not** the ingest's
  own console timing, matching this file's own T-06.1-16 repudiation-mitigation discipline of
  trusting stored state over an in-memory tally
- **Observed per-request time:** ≈160ms/request average, 60% above the 100ms throttle floor —
  within the 18–117% range Phase 6's media ingest already measured under comparable live-network
  conditions (this file's sibling `COVERAGE.md`), so no new cost-model surprise
- **Budget guidance:** a full five-season rankings re-ingest costs **4–6 minutes** of wall clock on
  this network, an order of magnitude cheaper than Phase 6's 17,231-request, 30–60-minute media
  ingest — a repeat run over an already-ingested season costs the same request count but returns
  almost entirely 304s (as 2024 did here), so re-running this command after a future season's TBA
  data changes is cheap to do liberally

**Per-season event counts** (`events` = total corpus events for the season; figures in parentheses
are this run's own tallies — `populated` / `null-body` / `empty-rankings` / cache-hits-this-run /
rows-skipped-for-an-unregistered-team-key):

| Season | Events | Populated | Null-body | Empty-rankings | Cache hits (this run) | Unregistered-team skips |
|---|---|---|---|---|---|---|
| 2022 | 288 | 236 | 0 | 52 | 0 | 48 |
| 2023 | 309 | 249 | 2 | 58 | 0 | 73 |
| 2024 | 324 | 0 (all 324 cache hits — see note [3]) | — | — | 324 | 0 |
| 2025 | 350 | 311 | 8 | 31 | 0 | 67 |
| 2026 | 310 | 246 | 40 | 24 | 0 | 21 |
| **Total** | **1,581** | **1,042 fresh + 280 already-stored = 1,322** | **50 measured (2024's split unknown, see [3])** | **165 measured (2024's split unknown, see [3])** | **324** | **209** |

**The populated / null-body / empty-rankings split, across all five seasons, as three separate
numbers:**

- **Populated (has real `event_rankings` corpus rows): 1,322** — read directly from the corpus
  (`SELECT COUNT(DISTINCT event_key) FROM event_rankings JOIN events ...`), authoritative regardless
  of which run (this one or 06.1-01's) produced each season's rows, since PD-02 guarantees a corpus
  row exists if and only if TBA reported a real populated ranking.
- **Null-body: 50** — measured directly by this run for the four seasons it fetched fresh (2022,
  2023, 2025, 2026). See note [3] for why 2024 is excluded from this figure.
- **Empty-rankings: 165** — measured directly by this run for the same four fresh-fetched seasons.
  See note [3].

This is the first real measurement of how often TBA returns a `null` body (50, concentrated almost
entirely in 2026 — 40 of the 50 — the season whose offseason events are still running as of this
ingest, 2026-08-26) versus an empty `rankings: []` array (165, spread across every season, always
outnumbering `null` roughly 3:1) — concrete evidence that PD-02's decision to preserve the
distinction in the ingest run's own counters, rather than collapse both into "no corpus row," is a
real distinction and not a theoretical one: a `null` body correlates strongly with "TBA has not set
up a ranking structure for this event at all" (skewed toward the still-in-progress current season),
while an empty array correlates with "event exists, quals just haven't run yet" (present in every
season, including fully-finished past ones, where it still means "TBA's rankings record for this
specific event was never populated," e.g. a cancelled or bracket-only event).

**[3] 2024's null-body/empty-rankings split is not separately re-measured by this run.** Plan
06.1-01's tracer already ingested 2024 fresh (280/324 events populated, recorded in its own
`06.1-01-SUMMARY.md`) but did not record the null-vs-empty split for its 44 non-populated events. In
this run, all 324 of 2024's `/event/{key}/rankings` requests returned 304 Not Modified — the correct,
expected ETag-cache behavior for an already-current season — but a 304 response carries no body, so
it cannot be re-classified as null-body or empty-rankings without a `--force` re-fetch that would
needlessly re-download 324 already-current payloads purely to recover a classification this file's
own tables already show is cosmetic (both cases already collapse to "zero corpus rows," per PD-02,
and the UI renders no standing element for either — see note [2] above). 2024's 44 non-populated
events are counted in the populated/total gap above but deliberately not force-split into
null/empty; forcing a wasteful re-fetch to fill in a number this integration has already decided is
not corpus-actionable would be measurement for its own sake, not for a real gap in decision-making.

**Acceptance-threshold note.** This plan's own Task 2 acceptance criteria assumed "at least 250
distinct events" with rankings rows per season; the real measured figures are 236 (2022), 249
(2023), 280 (2024), 311 (2025), and 246 (2026) — three of five seasons fall short of that specific
number. This is not a defect: the shortfall in each case is accounted for entirely by real TBA
answers (52 empty-rankings + 0 null-body in 2022; 58 empty + 2 null in 2023; 24 empty + 40 null in
2026 — the latter concentrated in 2026's still-ongoing offseason), not by a bug, a skipped season, or
a partial run. The plan's `must_haves.truths` — "the corpus holds `event_rankings` rows for every
season 2022 through 2026" and "every stored row satisfies `rank >= 1` and `total_teams >= 1`" — both
hold exactly as measured (zero invariant violations, all five seasons populated). The specific `250`
figure was this plan's own estimate, not a measured value at plan-writing time; this run supersedes
that estimate with the real number. See `06.1-04-SUMMARY.md`'s Deviations section for the full
accounting.
