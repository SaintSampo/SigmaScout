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
| offseason and preseason events in ingest scope | INTEGRATE | 06.1 PD-01 still applies. Both live empty-alliance cases (`2025bc`, `2026wvrox`) are offseason, so excluding offseason would hide the absent-data case D-17's disabled tab exists for. See note [4] |
| `GET /event/{key}/simple` | OPT-OUT | a payload-reduced form of `/event/{key}`, which is already taken in full; two fetch paths for one fact is redundant request volume against a volunteer-run service |
| `GET /event/{key}/matches/simple` | OPT-OUT | same reasoning — a reduced form of `/event/{key}/matches`, and the omitted fields include `score_breakdown`, which is the single most load-bearing field this pipeline reads |
| `GET /event/{key}/matches/keys` | OPT-OUT | key-only form of an endpoint already taken in full; the keys are already in the corpus's own `matches` table |
| `GET /event/{key}/matches/timeseries` | OPT-OUT | live in-match telemetry with sparse historical coverage and no v1 requirement referencing it; nothing in this project reads sub-match state |
| `GET /event/{key}/teams/simple` | OPT-OUT | reduced form of `/event/{key}/teams`, already taken in full |
| `GET /event/{key}/teams/keys` | OPT-OUT | key-only form of the same; the edges are already in the corpus |
| `GET /event/{key}/teams/statuses` | OPT-OUT | duplicates facts already sourced elsewhere: standings from `/rankings`, playoff outcome from the stored alliance `status` object. A third source for one fact is the drift surface note [5] describes |
| `GET /event/{key}/awards` | OPT-OUT | no v1 requirement references awards; Phase 1's matrix already opted out of the team-scoped equivalent for the same reason and nothing in Phase 7 changed it |
| `GET /event/{key}/district_points` | OPT-OUT | district points are a separate district-ranking concept from event standing; no v1 requirement references them, and D-07's Insights column set names rank, record and RP only |
| `GET /event/{key}/insights` | OPT-OUT | a season-specific aggregate blob whose vocabulary changes yearly (same problem as `sort_order_info`), with no display slot in this phase's five-tab contract |
| `GET /event/{key}/oprs` | OPT-OUT | this project computes its own event-scoped OPR (`packages/core/algorithms/opr.ts`, `solveEventOpr`) as one of its three v1 algorithms — see note [5] |
| `GET /event/{key}/coprs` | OPT-OUT | component OPRs, same reasoning as `/oprs` plus the same walk-forward leakage hazard — see note [5] |
| `GET /event/{key}/predictions` | OPT-OUT | TBA's own match predictions are the exact quantity this project's whole reason for existing is to beat and to score itself against honestly — see note [5] |
| `Cache-Control` header respect | OPT-OUT | the corpus's `http_cache` ETag table already caches every TBA endpoint; a second header-driven TTL layer would be a parallel cache with its own independent drift |

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
| `status` ABSENT entirely (key not present) | INTEGRATE | live-discovered in the full 2022 season (07-03 Task 2, outside RESEARCH.md's sample): some alliances have no `status` key. Schema is `z.unknown().optional()`; absence gives `statusRaw: null`. Note [6] |
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

**Reconciliation-pass finding (plan 07-03 Task 3):** `status` can be **entirely absent**, not merely
variable in shape — a fact RESEARCH.md's 40-event sample did not observe and this file's plan-time
form did not record. Plan 07-03 Task 2's live `pnpm ingest:alliances --year 2022` run threw
`invalid_type: expected nonoptional, received undefined` against real 2022 alliance objects carrying
no `status` key at all — `tbaAllianceEntrySchema`'s original `status: z.unknown()` required the key
to be present, which Zod v4 treats as distinct from the value being present-but-unknown. Fixed to
`status: z.unknown().optional()` in the same commit that discovered it (Task 2), verified against the
live 2022 data, and added as a new schema test case. This is RESEARCH.md Assumption A3's named risk
("a full-corpus live ingest could surface a rarer shape variant this sample didn't hit") materializing
inside this very plan's own two-season run — not deferred to 07-05, since it blocked Task 2's live
proof from completing at all. `normalizeEventAlliances` already treated a missing `status` key as
`statusRaw: null` (the same absence-not-fabrication treatment `name` gets), so no normalize-layer
change was needed, only the schema's required-vs-optional boundary.

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

`packages/ingest/tbaClient.ts`'s `THROTTLE_INTERVAL_MS = 100` applies per request unconditionally,
including on cache-hit 304 responses, so cost scales with the corpus's event count rather than with
payload size.

**Commands run (plan 07-03 Task 2, 2026-08-28, real TBA API via `tsx --env-file=.env`):**

1. `pnpm ingest:alliances --year 2022` — the season's initial live fetch.
2. `pnpm ingest:alliances --year 2024` — the second season's live fetch.
3. `pnpm ingest:alliances --year 2022 --force` — a clean re-run of 2022 bypassing all cached
   ETags, run because command 1 mixed in 10 events served from ETags an earlier, unrelated partial
   session had already written before this plan's Task 2 status-key fix landed (see COVERAGE.md note
   [6]'s reconciliation-pass finding). Command 3's tri-state split is the clean, full-season
   measurement and is what the table below cites for 2022; command 1's own console output (238
   populated / 23 null-body / 17 empty-alliances / 10 cache hits / 0 not-found, still summing to 288)
   is recorded in Task 2's commit message for provenance but superseded here.

**Total requests / cache hits (304) / fresh (200), read from `ingest_runs`, not an in-memory tally:**

| Run | `ingest_runs.run_id` | Requests | Cache hits (304) | Fresh (200) |
|---|---|---:|---:|---:|
| 2022 (initial) | `75aa0068` | 289 | 10 | 279 |
| 2024 | `69eb2dd7` | 325 | 0 | 325 |
| 2022 (`--force`) | `e765bb63` | 289 | 0 | 289 |

Each season's request count is one more than its event count (289 = 288 events + 1, 325 = 324 events +
1) — the extra request is `main()`'s one-time `fetchStatus` datafeed-health check, shared by every
`pnpm ingest*` mode, not a per-event cost.

**Elapsed wall clock, read from `ingest_runs.started_at`/`finished_at`, not console timing:**

| Run | Started | Finished | Elapsed |
|---|---|---|---:|
| 2022 (initial) | 2026-08-28T02:28:04.928Z | 2026-08-28T02:29:01.575Z | 56.6s |
| 2024 | 2026-08-28T02:29:10.741Z | 2026-08-28T02:30:16.004Z | 65.3s |
| 2022 (`--force`) | 2026-08-28T02:30:35.452Z | 2026-08-28T02:31:27.109Z | 51.7s |

**Observed per-request time**, computed from the two all-fresh runs (initial 2022's 10 cache hits
would understate the true per-request cost, since a 304 still pays the full `THROTTLE_INTERVAL_MS`
gate but returns no body):

- 2022 (`--force`, 289 requests, 51.657s): **178.7 ms/request.**
- 2024 (325 requests, 65.263s): **200.8 ms/request.**
- Combined (614 requests, 116.92s): **190.4 ms/request** — against the 100 ms `THROTTLE_INTERVAL_MS`
  floor and the ≈160 ms/request 06.1-04 measured for the rankings pass on this same network. The
  alliances endpoint runs measurably slower per request than rankings did (≈19% higher), consistent
  with a materially different response payload shape (a variable-length array of alliance objects,
  each carrying a nested `status` blob) rather than a network-conditions difference — both passes ran
  from the same machine on the same day.

**Per-season table** — the five counters sum exactly to the season's event count in both rows:

| Season | Events | `populatedCount` | `nullBodyCount` | `emptyAlliancesCount` | `cacheHitCount` | `notFoundCount` | Sum |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2022 (`--force`, clean) | 288 | 244 | 25 | 19 | 0 | 0 | 288 |
| 2024 | 324 | 285 | 27 | 12 | 0 | 0 | 324 |

Combined across both seasons: 612 events, 529 populated, 52 null-body, 31 empty-alliances — a
populated rate of 86.4%, close to RESEARCH.md's 40-event sample's 92.5% (37/40) but not identical,
consistent with A3's caveat that a larger sample can shift the observed split without changing the
shape decisions above (every response still parses under one of the three states this ingest already
handles).

**Budget projection for the remaining three seasons (2023, 2025, 2026), which plan 07-05 spends:**

| Season | Events (from `events` table) |
|---|---:|
| 2023 | 309 |
| 2025 | 350 |
| 2026 | 310 |
| **Total** | **969** |

At ≈190 ms/request (this run's combined observed rate) that projects to roughly 969 × 0.190s ≈ **184
seconds (≈3.1 minutes)** for the remaining three seasons' alliances pass alone, against a floor of
969 × 0.100s ≈ 97 seconds (≈1.6 minutes) if TBA's response times ever matched the throttle interval
exactly. 2022 and 2024 will read as ETag cache hits during 07-05's full pass (see Handoff below), so
07-05's own alliances-specific added cost is bounded by these three seasons, not by the full
1,581-event corpus — the two seasons already fetched here do not need to be paid for again.

**Handoff, realized (plan 07-05, 2026-08-28).** Plan 07-03 ingested 2022 and 2024 live; plan 07-05
then ran all five seasons and, as predicted, saw those two as ETag **cache hits** (288 and 324
respectively, 0 populated each) — the realized form of this handoff, not a shortfall. 07-05 took the
"cite these figures" branch of the choice offered above rather than the `--force` branch: forcing
2022/2024 would have spent 612 requests re-deriving a three-state split already written down in this
same section, the exact measurement-for-its-own-sake move 06.1-04 declined for 2024 and was right to
decline. This section's 244/25/19 (2022) and 285/27/12 (2024) therefore remain the authoritative
record of those two seasons' split. See "Measured cost — the real full-corpus 2022-2026 pass (plan
07-05)" below for the remaining three seasons and the corpus-wide state after the full pass.

---
*Produced at plan time for Phase 7 (plan 07-03). Measured-cost section completed at execution. Validated at `verify:pre` by `api-coverage.verify-pre`.*

---

## Measured cost — the real full-corpus 2022-2026 pass (plan 07-05)

This section is plan 07-05's own record, added after 07-03's measured-cost section above rather than
replacing it — that section remains the authoritative record of 2022's and 2024's fresh alliance
fetch. This section covers both endpoints' full five-season pass: the forced rankings re-ingest
(D-18.6, backfilling `record_wins`/`record_losses`/`record_ties`/`ranking_score` across all five
seasons) and the unforced alliances ingest for the three seasons 07-03 had not yet fetched
(2023, 2025, 2026), plus the corpus-wide state both endpoints hold after the pass.

### Rankings subsection

**Commands run** (2026-08-28, real TBA API via `tsx --env-file=.env`), one per season:

1. `pnpm ingest:rankings --year 2022 --force`
2. `pnpm ingest:rankings --year 2023 --force`
3. `pnpm ingest:rankings --year 2024 --force`
4. `pnpm ingest:rankings --year 2025 --force`
5. `pnpm ingest:rankings --year 2026 --force`

**`--force` was mandatory, not optional, on every one of the five.** `cachedEtagFor` returns a cached
ETag unless forced, and `ingestSeasonRankingsOnly`'s 304 branch increments `cacheHitCount` and
`continue`s before reaching any upsert — so an unforced pass would have written nothing at all and
shipped all four of 07-02's new columns NULL across the entire corpus. 06.1-04 measured exactly this
failure mode: all 324 of 2024's requests returned 304 on a plain re-run. Every one of the five
invocations above reported `cacheHitCount = 0`, confirming the flag reached `parseCliOptions` on all
five.

| Season | Events | Populated | Null-body | Empty-rankings | Cache hits | 404 skips | Unregistered-team skips | Null-`ranking_score` rows | Requests | Wall clock |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2022 | 288 | 236 | 0 | 52 | 0 | 0 | 48 | 0 | 289 | 34.2s |
| 2023 | 309 | 249 | 2 | 58 | 0 | 0 | 73 | 0 | 310 | 38.7s |
| 2024 | 324 | 280 | 0 | 44 | 0 | 0 | 87 | 0 | 325 | 50.6s |
| 2025 | 350 | 311 | 8 | 31 | 0 | 0 | 67 | 0 | 351 | 62.1s |
| 2026 | 310 | 246 | 40 | 24 | 0 | 0 | 21 | 0 | 311 | 46.6s |
| **Total** | **1,581** | **1,322** | **50** | **209** | **0** | **0** | **296** | **0** | **1,586** | **232.2s** |

Every event-level closed sum (populated + null-body + empty-rankings + cache-hits + 404-skips) equals
`SELECT COUNT(*) FROM events WHERE year = ?` exactly for all five seasons — the 404-skip column is
sourced from `grep -c '404 Not Found, skipping'` over each season's tee'd log, since
`ingestSeasonRankingsOnly`'s 404 branch increments no counter (weaker than the alliances invariant
below, which needs no log grep). All five seasons measured 0 404-skips. `Unregistered-team skips` and
`Null-ranking_score rows` are ROW-level counters (`unknownTeamCount`/`nullRankingScoreCount`) and are
deliberately excluded from the event-level closed sum — 06.1-LEARNINGS.md's surprise that TBA reports
rankings for synthetic second-robot team keys is why the skip exists at all. Every wall-clock figure
above is read from that season's own `ingest_runs.finished_at` minus `started_at`, never console
timing: 2022 `6bdd6e72` (34.173s), 2023 `823eaa49` (38.741s), 2024 `f7da9be2` (50.588s), 2025
`b80a420c` (62.055s), 2026 `6fec9e67` (46.642s). Total requests 1,586 at 232.199s elapsed is
**146.4 ms/request**, below 06.1-04's measured ≈160 ms/request for the same endpoint on a comparable
network — consistent with `--force`'s single-code-path fresh-200 traffic having no 304-branch
short-circuit overhead to pay.

**2024's three-state split, measured for the first time.** 2024's null-body and empty-rankings counts
are **0 and 44**. 06.1-04's own `COVERAGE.md` note [3] recorded this split as unknown because that
plan correctly declined to spend 324 requests purely to recover a classification when all 324 of that
run's requests returned 304. This pass forced 2024 for the independent reason that the four new
`record`/`ranking_score` columns require it, so the measurement came free rather than being chased for
its own sake.

### Alliances subsection

**Commands run** (2026-08-28, real TBA API via `tsx --env-file=.env`), one per season, **no**
`--force`:

1. `pnpm ingest:alliances --year 2022`
2. `pnpm ingest:alliances --year 2023`
3. `pnpm ingest:alliances --year 2024`
4. `pnpm ingest:alliances --year 2025`
5. `pnpm ingest:alliances --year 2026`

**The absence of `--force` here is deliberate — the opposite call from the rankings pass above.**
2023, 2025 and 2026 had no cached ETag for this brand-new endpoint at all, so they fetched fresh
without any flag; 2022 and 2024 were already fetched fresh by 07-03, so forcing them would have spent
612 requests re-deriving a three-state split already written down in this same file's earlier section
— the same measurement-for-its-own-sake move 06.1-04 declined for 2024's rankings and was right to
decline.

| Season | Events | Populated | Null-body | Empty-alliances | Cache hits | Not-found | Alliance rows written | Distinct events with rows | Requests | Wall clock |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2022 | 288 | 0 | 0 | 0 | 288 | 0 | 1,752 (07-03's, untouched) | 244 | 289 | 47.1s |
| 2023 | 309 | 258 | 48 | 3 | 0 | 0 | 1,983 | 258 | 310 | 44.7s |
| 2024 | 324 | 0 | 0 | 0 | 324 | 0 | 2,167 (07-03's, untouched) | 285 | 325 | 41.4s |
| 2025 | 350 | 320 | 17 | 13 | 0 | 0 | 2,446 | 320 | 351 | 49.5s |
| 2026 | 310 | 248 | 58 | 4 | 0 | 0 | 1,942 | 248 | 311 | 40.3s |
| **Total** | **1,581** | **826** | **123** | **20** | **612** | **0** | **10,290** | **1,355** | **1,586** | **223.1s** |

2022 and 2024's `288`/`324` cache hits and `0` populated are the realized form of 07-03's own recorded
handoff paragraph above, not a shortfall — those two seasons' real three-state split (244/25/19 and
285/27/12) is recorded in that earlier section, and this pass's zero counters simply confirm the ETag
path worked. Unlike the rankings tally, this endpoint's five counters close exactly against each
season's event count with **no** log grep required, because `ingestSeasonAlliancesOnly` counts its own
404s. Wall-clock figures read from `ingest_runs`: 2022 `10ec6738` (47.112s), 2023 `f50abf40`
(44.715s), 2024 `91b783d6` (41.372s), 2025 `a33553c2` (49.534s), 2026 `bf8dfafe` (40.332s). The three
freshly-fetched seasons (2023/2025/2026, 972 requests, 134.581s) measured **138.5 ms/request** —
faster than 07-03's own combined 190.4 ms/request estimate and than the earlier section's budget
projection of ≈184 seconds for these three seasons (actual: 134.6s).

**`picks` length histogram, across all five seasons:** length 2 → 10 rows, length 3 → 8,353 rows,
length 4 → 1,927 rows (10,290 total, all within the 1–4 bound). **Ten sub-three-pick alliances**
exist, all at length 2, all belonging to two events — `2022vabrb` and `2024vabrb`, five alliances each
(a small, presumably 2-robot-per-alliance offseason format) — flagged to 07-14's D-16 rule as a real
input: a length-2 alliance has no third pick to sum, so D-16's "sum the first three picks" rule needs
a stated behavior for these ten rows.

### Corpus-state subsection

Sourced from fresh read-only queries executed after all ten processes exited, never from either run's
own tally.

- **`event_rankings`:** 47,695 total rows (against 06.1-04's own 47,695 baseline — unchanged, since
  the forced pass refreshed existing rows in place rather than adding new ones; every season's row set
  was already present from 06.1-04's original ingest, only the four D-18.6 columns were NULL before
  this pass). Distinct populated events per season: 2022 236, 2023 249, 2024 280, 2025 311, 2026 246 —
  summing to **1,322 distinct populated events corpus-wide**, landing exactly on 06.1-04's own
  measured 1,322 total (this pass's own 2024 figure of 280 supersedes 06.1-04's un-force-measured
  value for that season, since 06.1-04 saw all 324 of 2024's requests as 304s and could not measure it
  directly). Corpus events with **no** `event_rankings` row at all: **259**, landing exactly on
  06.1-04's own measured 259 (within the 150–400 band this plan's census asserts). Zero rows anywhere
  carry a NULL or negative
  `record_wins`/`record_losses`/`record_ties`; 47,305 rows carry `record_wins > 0`.
- **`event_alliances`:** first corpus-wide measurement of this table's coverage. 10,290 total rows.
  Distinct events with rows per season: 2022 244, 2023 258, 2024 285, 2025 320, 2026 248 — **1,355**
  distinct events total, all clearing the census's 100-event-per-season non-vacuity floor by a wide
  margin. `2025bc`, `2026wvrox` and `2022ispr` each exist in `events` and each hold exactly 0
  `event_alliances` rows, the three live-observed absent shapes RESEARCH.md Question 2 named. Zero
  events have a non-contiguous `alliance_number` sequence. 07-03's 2022/2024 rows are proven untouched:
  `MAX(fetched_at)` over those two seasons' rows (`2026-08-28T02:31:26.963Z`) is strictly less than
  `MIN(fetched_at)` over 2023/2025/2026's rows (`2026-08-28T04:24:50.410Z`).

### Budget guidance

A future full re-ingest of the rankings endpoint (all five seasons, forced) costs roughly **4 minutes**
of wall clock (this pass: 232.2s) at ≈146 ms/request; a future full re-ingest of the alliances endpoint
costs roughly **3.7 minutes** (this pass: 223.1s) at ≈140 ms/request when unforced against a
fully-cached corpus (cache hits still pay the unconditional 100 ms throttle). **Standing warning:** any
future backfill of a column added after a prior ingest — the exact situation D-18.6's four new
`event_rankings` columns created for this plan — requires `--force`, **including on a resume**. An
aborted forced season has already written fresh ETags for the events it reached, so an unforced resume
of that season would 304-skip both the events it already finished and, on their older ETags, precisely
the events it never backfilled — producing a partial backfill indistinguishable from success. Always
re-run an aborted forced season with `--force` again; the upsert merges, so the already-done half costs
only its own re-fetch time.

---
*Measured-cost section for plan 07-05 completed at execution, 2026-08-28. Validated at `verify:pre` by `api-coverage.verify-pre`.*
