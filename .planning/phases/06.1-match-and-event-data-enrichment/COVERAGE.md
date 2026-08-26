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

_(placeholder — filled in by the full 2022-2026 ingest run and its verification query)_
