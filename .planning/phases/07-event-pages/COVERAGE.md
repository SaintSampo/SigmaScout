# API Coverage — The Blue Alliance API v3, event-scoped endpoints

> Full coverage by default. Opt-outs are explicit, reasoned decisions.

## Why this file exists

`gsd-tools`' api-coverage detector fired on Phase 7's scope (`detected: true`): this phase
integrates a third-party API capability this repo has never called — TBA's
`/event/{event_key}/alliances`, added to `packages/ingest/tbaClient.ts` as `fetchEventAlliances` in
plan 07-03 (D-18 item 7). A malformed or absent matrix **blocks the phase seal** at `verify:pre`.

The matrix is the **subtraction record**. `INTEGRATE` is the default; every `OPT-OUT` carries a
one-line reason, because an unreasoned opt-out is not a decision — it is an undecided hole wearing a
decision's clothes.

## Scope, and the one supersession this file carries

TBA's API as a whole was integrated in **Phase 1** (`01-data-foundation-evaluation-harness/COVERAGE.md`).
`/team/{team_key}/media/{year}` was decided in **Phase 6**'s matrix. `/event/{event_key}/rankings` was
decided in **Phase 6.1**'s. This file decides TBA's **event-scoped** surface as it stands at Phase 7,
and it is the first matrix in this project to take that surface as a whole rather than one endpoint at
a time.

It carries exactly one reversal of a prior decision:

- Phase 1's matrix reads `event-alliances | OPT-OUT | not needed yet — alliance selection is EVNT-05,
  Phase 7`.
- Phase 6.1's reads `GET /event/{event_key}/alliances | OPT-OUT | playoff alliance selections are not
  requested by TEAM-04 and no locked decision in this phase or a prior one asks for them`.

Both were correctly scoped when written, and both name the condition that would flip them. **D-18 item
7 is the locked decision they were waiting for**, and EVNT-05 is the requirement Phase 1's row points
at by name. This is a supersession *by arrival*, not a correction — and neither prior file is edited.
A sealed phase's matrix records what was true for that phase; rewriting it would destroy the audit
trail that makes this reversal legible at all.

Phase 1's `event-rankings` row (`not needed yet — ... EVNT-07 rank simulation, Phase 8`) was already
superseded early by Phase 6.1 under TEAM-04, on the same by-arrival basis. Recorded here so the chain
reads consistently.

---

## Table one — request-level capabilities

| capability | decision | reason |
|---|---|---|
| `GET /event/{key}/alliances` | INTEGRATE | new this phase — `fetchEventAlliances`, plan 07-03, D-18 item 7, EVNT-05 |
| `GET /event/{key}/rankings` | INTEGRATE | already ingested by Phase 6.1 (`fetchEventRankings`); extended by plan 07-04 to persist `record` and `sort_orders[0]` |
| `GET /event/{key}` | INTEGRATE | already ingested by Phase 1 (`fetchEventDetail`) — the source of `events`' name/week/country/state_prov/district columns |
| `GET /event/{key}/matches` | INTEGRATE | already ingested by Phase 1 (`fetchEventMatches`) — the corpus's 102,877-row match spine |
| `GET /event/{key}/teams` | INTEGRATE | already ingested by Phase 1 (`fetchEventTeams`) — the team-to-event edge set |
| `If-None-Match` / ETag conditional request (304) | INTEGRATE | the mechanism that makes a repeat full pass cost bandwidth-free 304s; enforced inside `tbaFetch` for every endpoint including the new one |
| offseason and preseason events in ingest scope | INTEGRATE | 06.1's PD-01 remains in force for this endpoint, and RESEARCH.md Q2 measured **both** live empty-array alliance cases (`2025bc`, `2026wvrox`) at offseason events — excluding offseason would specifically hide the absent-data case D-17's disabled tab is designed for. See note [4] |
| `GET /event/{key}/simple` | OPT-OUT | a payload-reduced form of `/event/{key}`, which is already taken in full; two fetch paths for one fact is redundant request volume against a volunteer-run service |
| `GET /event/{key}/matches/simple` | OPT-OUT | same reasoning — a reduced form of `/event/{key}/matches`, and the omitted fields include `score_breakdown`, which is the single most load-bearing field this pipeline reads |
| `GET /event/{key}/matches/keys` | OPT-OUT | key-only form of an endpoint already taken in full; the keys are already in the corpus's own `matches` table |
| `GET /event/{key}/matches/timeseries` | OPT-OUT | live in-match telemetry with sparse historical coverage and no v1 requirement referencing it; nothing in this project reads sub-match state |
| `GET /event/{key}/teams/simple` | OPT-OUT | reduced form of `/event/{key}/teams`, already taken in full |
| `GET /event/{key}/teams/keys` | OPT-OUT | key-only form of the same; the edges are already in the corpus |
| `GET /event/{key}/teams/statuses` | OPT-OUT | overlaps facts already taken from two other endpoints — qualification standing comes from `/rankings`, playoff outcome rides verbatim inside the alliance `status` object this phase stores — and a third source for the same fact is the drift surface note [5] describes |
| `GET /event/{key}/awards` | OPT-OUT | no v1 requirement references awards; Phase 1's matrix already opted out of the team-scoped equivalent for the same reason and nothing in Phase 7 changed it |
| `GET /event/{key}/district_points` | OPT-OUT | district points are a separate district-ranking concept from event standing; no v1 requirement references them, and D-07's Insights column set names rank, record and RP only |
| `GET /event/{key}/insights` | OPT-OUT | a season-specific aggregate statistics blob whose vocabulary changes every year (the same season-varying-vocabulary problem `sort_order_info` has), with no display slot in this phase's five-tab contract |
| `GET /event/{key}/oprs` | OPT-OUT | this project computes its own event-scoped OPR (`packages/core/algorithms/opr.ts`, `solveEventOpr`) as one of its three v1 algorithms — see note [5] |
| `GET /event/{key}/coprs` | OPT-OUT | component OPRs, same reasoning as `/oprs` plus the same walk-forward leakage hazard — see note [5] |
| `GET /event/{key}/predictions` | OPT-OUT | TBA's own match predictions are the exact quantity this project's whole reason for existing is to beat and to score itself against honestly — see note [5] |
| `Cache-Control` header respect | OPT-OUT | the corpus's generic `http_cache` ETag table is the caching mechanism this pipeline already uses for every TBA endpoint; a second header-driven TTL layer would be a parallel cache with its own independent drift |

---

## Table two — `/event/{key}/alliances` response-type and field-level capabilities

Each field is a separate row, because each is a separate decision with a separate consumer question.
The two absent-body cases are their own rows because each is a distinct, real TBA answer this ingest
must not conflate — and unlike the rankings case, this distinction has a **rendered** consequence
(note [3]).

Field set confirmed live against 40 real events spanning 2022–2026 and all 8 observed TBA event types
(`07-RESEARCH.md` Open Question 2, probed 2026-08-27).

| capability | decision | reason |
|---|---|---|
| `picks` (ordered array of team keys) | INTEGRATE | the endpoint's entire point — stored verbatim as `event_alliances.picks`, a JSON array following `matches.red_teams`' own precedent |
| `picks[0]` — the alliance captain | INTEGRATE | rendered as the Captain column (D-15) and the first term of the three-pick combined metric (D-16) |
| `picks[1]` / `picks[2]` — the 2nd and 3rd picks | INTEGRATE | rendered as the Pick 2 / Pick 3 columns and the remaining two terms of D-16's arithmetic |
| `picks[3]` — the 4th team, where one exists | INTEGRATE | displayed on the row but excluded from the combined value so the column stays comparable across rows (D-16) — see note [1] |
| `name` | INTEGRATE | stored as `event_alliances.name`; rendered as alliance identity by 07-14 |
| `name` ABSENT entirely (key not present) | INTEGRATE | a real, live-observed TBA shape (`2024wvrox`), stored as SQL NULL and never as an empty string or a fabricated label — see note [2] |
| `declines` (array of declined team keys) | INTEGRATE | stored verbatim as `event_alliances.declines` for source provenance; read by nothing in Phase 7 — see note [6] |
| `status` (whole object, verbatim) | INTEGRATE | serialized whole into `event_alliances.status_raw` because its shape varies by `playoff_type` — see note [6] |
| top-level `null` response body | INTEGRATE | a distinct real TBA answer ("no alliance structure exists for this event", live at `2022ispr`) — tallied as `nullBodyCount`, stores zero rows — see note [3] |
| empty array response (`[]`) | INTEGRATE | a distinct real TBA answer ("this event ran quals but never held an alliance selection", live at `2025bc` and `2026wvrox`) — tallied as `emptyAlliancesCount`, stores zero rows — see note [3] |
| `status.status` (`"won"` / `"eliminated"`) | OPT-OUT | not modelled and not read by any Phase 7 consumer; rides verbatim inside `status_raw` — see note [6] |
| `status.level` (`"qf"`/`"sf"`/`"f"`/…) | OPT-OUT | same — the Elims tab (D-14) labels rounds from each match's own `compLevel` via `matchLabel()`, never from alliance status |
| `status.record` (alliance playoff W-L-T) | OPT-OUT | same — D-07's Insights Record column is TBA's per-**team** qualification record from `/rankings`, a different fact from an alliance's playoff record |
| `status.current_level_record` | OPT-OUT | same — no surface in the five-tab contract displays a per-round alliance record |
| `status.playoff_type` (0 / 4 / 8 / 10 observed) | OPT-OUT | same — this pipeline reads no playoff-format branch; the field's existence is precisely why `status` is stored whole rather than modelled column-by-column |
| `status.double_elim_round` (2023+ format only) | OPT-OUT | same — format-specific and absent from most seasons; a modelled column would be NULL for the majority of rows |
| `status.round_robin_rank` (2022 Einstein only) | OPT-OUT | same — appears in one format in one season across the whole 40-event sample |
| `status.advanced_to_round_robin_finals` (2022 Einstein only) | OPT-OUT | same — one format, one season; no display slot |

---

### Notes on the rows above

**[1] `picks[3]` — stored and displayed, never summed, and never given a field of its own.**
RESEARCH.md Q2 confirmed live that TBA's raw response has **no separately-named field** for a 4th
team: a 4-team alliance is simply a `picks` array of length 4, and the 4th entry is `picks[3]`.
4-team alliances were common at District Championship and CMP Division events (`2022roe`, `2025cur`,
`2026arc`, `2026nyro`, and every sampled CMP Finals event). Two consequences this project binds
itself to: the schema, the corpus column set and the normalized interface name no fourth-pick concept
that TBA does not have (inventing one would attribute a model to the source, and would then be
indistinguishable from a real TBA field to every downstream reader); and D-16 excludes it from the
combined metric so the Combined Total column means the same thing on a 3-team row and a 4-team row.

**[2] `name` is sometimes ABSENT, not empty.** `2024wvrox`'s alliance objects have keys exactly
`["declines", "picks", "status"]` — no `name` key at all. The schema therefore models `name` as
nullish with **no default of any kind**, and `normalizeEventAlliances` collapses absent, explicit
`null` and empty-string to the single representation `event_alliances.name` admits: SQL NULL. All
three are the same fact ("TBA has no name for this alliance"), and a default would make that fact
indistinguishable from a real TBA-supplied name at every layer downstream. `alliance_number` is
likewise taken from the response array's own 1-based position — TBA's seed order — and is **never**
parsed out of `name`, for exactly this reason. Rendering a fallback label is 07-14's decision to make
from an honest NULL; the ingest layer never fabricates one.

**[3] Null body vs. empty array — and why this distinction is louder here than it was for rankings.**
Both absent cases store **zero rows**: no placeholder row with a fabricated seed, no row with an empty
picks array (`event_alliances.alliance_number` and `.picks` are both `NOT NULL`, so a placeholder is
structurally impossible to write). The distinction is preserved in `ingestSeasonAlliancesOnly`'s own
counters, carrying forward 06.1's PD-02 discipline.

Where this departs from the rankings case: for `/rankings`, the distinction was purely diagnostic —
the team page rendered nothing either way. Here, **D-17's disabled Alliances tab renders exactly this
absence**, and RESEARCH.md's recommendation is explicit that both states must disable the tab. The
empty-array case is the more interesting of the two: `2025bc` and `2026wvrox` both published real
rankings (62 and 30 ranked teams) and simply never ran an alliance selection. That is a *different*
event history from `2022ispr`, a preseason event with 0 matches and a bare `null` body — and D-17
knowingly cannot tell them apart on the page. The counters are where that distinction survives.

Live three-state split across the 40-event sample: **37 populated / 2 empty array / 1 null body.**

**[4] Offseason and preseason events stay in scope.** 06.1's PD-01 settled this for `/rankings`
(TEAM-04's "attended… event" wording is not scoped to in-season; offseason events are a third of the
corpus; TBA computes these values itself from official match results, a materially different trust
boundary from the self-reported `score_breakdown` Phase 3's RP fold excludes). Two Phase-7-specific
reasons reinforce it for `/alliances`. First, the two live empty-array cases are *both* offseason —
excluding offseason would remove the exact events that exercise D-17's absent-data path. Second,
D-08's official-ranking fallback was measured against the 259 events without rankings, and
RESEARCH.md Pitfall 1 found the standard republish currently publishes **zero** event artifacts for
offseason events at all (plan 07-09 wires the missing `--include-offseason` flag). An ingest that
also excluded them would compound a gap this phase is separately fixing.

**[5] TBA's own computed values — `/oprs`, `/coprs`, `/predictions`, and by extension
`/teams/statuses`.** This project computes its own event-scoped OPR (`packages/core/algorithms/opr.ts`)
and its own match predictions; ingesting TBA's differently-computed versions alongside them is the
two-implementations-that-drift anti-pattern `.planning/research/ARCHITECTURE.md` names — a reader
comparing "TBA's OPR" against "SigmaScout's OPR" for the same event would see two numbers with no way
to tell which is authoritative. There is a sharper reason than tidiness, though, and it is the one
that makes these opt-outs non-negotiable rather than merely preferable: TBA's OPR and predictions are
**end-of-event batch values**. Using either as a feature would leak outcome information backwards into
a walk-forward run, which is precisely the methodology this project's inherited failure log exists to
protect, and precisely the failure a Brier-scored backtest would not visibly complain about. Phase 1's
matrix opted out of `/event/{key}/oprs` on this reasoning already; Phase 7 re-derives it rather than
inheriting it, and extends it to `/coprs` and `/predictions`, which Phase 1's row did not name
separately.

**[6] `declines` and `status` are stored as provenance, and read by nothing in Phase 7.** This is a
deliberate INTEGRATE-without-a-consumer, and the reason is cost asymmetry rather than optimism about
future features: recovering either field later would cost another full-corpus live TBA pass over
~1,581 events (07-05's measured pass), whereas carrying them along on the pass already being spent
costs a few bytes per row. `declines` was an empty array in all 40 sampled events and has never been
observed populated. `status` is stored **whole**, serialized verbatim into `status_raw`, following
`matches.score_breakdown_raw`'s D-05 precedent — its shape varies with `playoff_type` (values 0, 4, 8
and 10 observed, each adding or removing sub-fields), so a column-by-column model would turn a future
playoff format into a parse failure. Every one of its sub-fields is opted out at the field level in
the table above: they ride along inside `status_raw`, but no code reads them, no column is named for
them, and none of them is a fact this project asserts.

**[7] Sampling caveat — open, and owned by 07-05.** Every shape decision above rests on
RESEARCH.md's 40-event live sample (one event per year × TBA event-type group, 2022–2026, 8 event
types) plus the two full seasons plan 07-03 ingested live. That is **not** the full ~1,581-event
corpus. RESEARCH.md Assumption A3 states the risk plainly: a full-corpus pass could surface a rarer
shape variant this sample did not hit. **Plan 07-05's full 2022–2026 pass is what closes this**, and
its own acceptance criteria are where the gap is discharged. Recorded here as an open scope caveat
with a named owner rather than presented as a settled question — the honest position is that this
matrix is decided on strong evidence, not on complete evidence.

---

## The recurring cost this integration commits to

> **Placeholder — filled by plan 07-03 Task 3 from Task 2's real run.** `packages/ingest/tbaClient.ts`'s
> `THROTTLE_INTERVAL_MS = 100` applies per request unconditionally, including on cache-hit 304
> responses, so cost scales with the corpus's event count rather than with payload size.

Structure to fill, following `06.1-match-and-event-data-enrichment/COVERAGE.md`'s own measured-cost
section:

- **Commands:** the two exact `pnpm ingest:alliances` invocations run in plan 07-03 Task 2.
- **Date:** the run date.
- **Total requests / cache hits (304) / fresh (200):** read from `ingest_runs`, not from an in-memory
  tally.
- **Elapsed wall clock:** read from `ingest_runs.started_at` to `finished_at`.
- **Observed per-request time** against the 100 ms throttle floor (06.1-04 measured ≈160 ms/request on
  this network for the rankings pass).
- **Per-season table:** events, `populatedCount`, `nullBodyCount`, `emptyAlliancesCount`,
  `cacheHitCount`, `notFoundCount` — the five counters, which sum exactly to the season's event count.
- **Budget projection** for the remaining three seasons, which plan 07-05 spends.

**Handoff, recorded in advance rather than rediscovered.** Plan 07-03 ingests 2022 and 2024 live;
plan 07-05 then runs all five seasons, and will see those two as ETag **cache hits**, so its own
per-season tally for them will read as zeroes. This section is therefore the authoritative record of
2022's and 2024's three-state split, and 07-05 may either cite these figures or re-fetch those two
seasons with `--force`. This is 06.1-04's note [3] — where 2024's rankings split was permanently lost
to exactly this effect — handled up front instead of written up afterwards.

---
*Produced at plan time for Phase 7 (plan 07-03). Measured-cost section completed at execution. Validated at `verify:pre` by `api-coverage.verify-pre`.*
