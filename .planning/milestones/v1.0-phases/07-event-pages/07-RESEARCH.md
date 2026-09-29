# Phase 7: Event Pages - Research

**Researched:** 2026-08-27
**Domain:** Cloudflare-published FRC event detail page (5 tabs) + the pipeline batch (D-18) that feeds it, plus a site-wide `±` redefinition and a Sigma1→VPR rename
**Confidence:** HIGH — all five assigned open questions were answered by live execution (real TBA API calls, a real measurement script run against the real corpus, and direct reads of the exact source lines cited), not by reasoning from schemas alone.

## Summary

This phase is pipeline-heavy by design (user decision, "plan it whole"). The five open questions CONTEXT.md handed to research all resolve favorably: TBA's `sort_orders` is populated and its RP entry (`sort_order_info[0]`, named "Ranking Score" every season 2022–2026) is stable in position across every event type sampled; `/event/{key}/alliances` has a stable, well-understood shape with the same null/empty/populated three-state contract `/rankings` already established; as-of-event metric snapshotting costs a **measured, negligible** amount of compute (tens of milliseconds per season, not the structural risk its own name suggests); republish sequencing has a safe, resumable write→delete order using tooling that already exists; and the five-tab mobile question is **already answered** in the approved 07-UI-SPEC.md by direct precedent from Phase 5/6 shipped code.

Research also surfaced two significant findings CONTEXT.md's own itemized D-18 list did not name: (1) **`publish.ts`'s CLI never exposes `--include-offseason`**, so under the standard `pnpm publish:seasons` command every offseason/preseason event — including the exact events D-08 was written to handle (`2025isios`, `2023cnsh`, `2024auwarp`) — currently gets **zero** published event artifact and will 404 once Phase 7 wires up links from the Events list; and (2) the Sigma1→VPR rename's blast radius is wider than CONTEXT.md's file list — at least 20 non-test source files reference `sigma1`/`Sigma1` outside the ones named, plus a remote D1 table (`sigmascout-state`) that stores `algorithm_id = 'sigma1'` as row data, not just source code.

**Primary recommendation:** Sequence the phase as: (1) corpus/schema/ingest changes (additive migrations, mirroring the `events` table's proven `ALTER TABLE ADD COLUMN` pattern), (2) publisher restructuring for D-10's as-of-event snapshots (cheap — reuse the existing `onMatchComplete` hook, no new corpus pass), (3) the VPR rename sweep across the *full* file list this doc identifies (not just CONTEXT.md's), (4) **add `--include-offseason` to the republish invocation**, (5) one write→verify→delete republish, (6) the five tab components, reusing Phase 5's pinned-table pattern for Insights/Breakdown and Phase 6's `MatchTable`/axis-domain pattern for Quals/Elims.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Event roster ranking (Insights) | Database/Pipeline (Node harness) | API/Backend (none — no server) | Rank/record/RP come from `event_rankings` at publish time; the browser never computes a rank |
| Per-team component breakdown (Breakdown) | Database/Pipeline | — | VPR's per-team estimate is a model output, computed once at publish time, never in-browser |
| Match prediction-vs-actual (Quals/Elims) | Database/Pipeline (values) / Browser (axis domain + merge) | — | Values are precomputed; D-13's played+upcoming interleave and D-12's per-tab axis domain are pure, cheap client-side computations over already-fetched data |
| Alliance combined metric (Alliances) | Database/Pipeline (component values) / Browser (√ sum arithmetic) | — | `√(σ₁²+σ₂²+σ₃²)` is a 3-term sum, safe and cheap client-side; the underlying per-team variances are pipeline output |
| Site-wide `±` redefinition (D-01) | Database/Pipeline | Browser (render-only) | `spread` is redefined at the point it's assembled in `sigma1/index.ts`; `MetricValue.tsx` needs zero code change |
| Sigma1→VPR rename | Database/Pipeline (artifact paths, D1 rows) + Browser (labels) + CDN/Static (R2 keys) | — | Touches every tier that has the string "sigma1" baked in — see the rename blast-radius section below |
| Tab strip / routing | Browser (Client) | — | Pure client-side tab state via `?tab=` search param, TanStack Router |

## Standard Stack

No new libraries this phase. Confirmed via `07-UI-SPEC.md`'s Registry Safety table (checker-approved): every primitive needed (`tabs`, `table`, `badge`, `skeleton`, `button`, `select`, `separator`) is already installed from Phase 5/6. `@tanstack/react-table@9.1.2` (already installed, Phase 5) is the pinned-column pattern Insights/Breakdown should reuse.

### Installation

No `npm install` needed this phase.

## Package Legitimacy Audit

**Not applicable — this phase installs no new external packages.** No audit table needed.

## Architecture Patterns

### System Architecture Diagram

```
TBA API                      Node.js Pipeline (offline)                  R2 (CDN, world-readable)
--------                     ---------------------------                 -------------------------
/event/{k}/rankings   --->   ingest (rankings.ts, cli.ts)                v1/event/{eventKey}/
  (rank, record,               |  extend event_rankings with              {algorithmId}@{version}.json
   sort_orders)                |  sort_orders + record (D-18.6)
                               v
/event/{k}/alliances  --->   NEW ingest (D-18.7)                <-------  fetch (browser, TanStack Query)
  (picks, status)              |  new corpus table
                               v
                          publish.ts: buildEventArtifact
                            - per-event teams standing snapshot        Browser (apps/web)
                              AS-OF-EVENT-END (D-10, restructured      -----------------
                              buildEventTeamsStanding)                 /event/{eventKey} route
                            - redScoreVarianceOwn/blueScoreVarianceOwn   |
                              added to EventMatchSchema (D-18.3)         +-- Insights tab  (event_rankings-ordered)
                            - event identity fields (D-18.8)             +-- Breakdown tab (VPR-rank-ordered)
                            - alliances field (D-18.7)                   +-- Quals tab     (MatchTable, per-tab axis)
                               |                                         +-- Alliances tab (client-side √ sum)
                               v                                         +-- Elims tab     (MatchTable, own axis)
                          write new vpr@... keys, verify, THEN
                          delete old sigma1@... keys (D-06)
```

A reader tracing "user clicks an event row" follows: Events list (Phase 5, already shipped) → `/event/{eventKey}` route → one `EventArtifactSchema` fetch → five tabs rendered from that single fetched object, each tab a pure function of already-fetched fields (no second network round-trip per tab).

### Recommended Project Structure

```
apps/web/src/
├── routes/
│   └── event.$eventKey.tsx        # new — mirrors team.$teamNumber.tsx's shape
├── components/
│   └── event/                     # new sibling to components/team/
│       ├── InsightsTab.tsx
│       ├── BreakdownTab.tsx
│       ├── QualsTab.tsx           # generalizes team/MatchTable.tsx
│       ├── ElimsTab.tsx
│       ├── AlliancesTab.tsx
│       └── eventMatchAxis.ts      # event-scoped sibling to team/matchAxis.ts's computeAxisDomain
├── lib/api/
│   └── event.ts                   # new — mirrors lib/api/events.ts exactly (fetch+Zod+TanStack Query)
packages/
├── ingest/
│   ├── schemas.ts                 # + tbaAllianceResponseSchema (NEW — distinct from existing tbaAllianceSchema)
│   ├── alliances.ts               # new — mirrors rankings.ts's normalize shape
│   └── cli.ts                     # + ingestSeasonAlliancesOnly, extend ingestSeasonRankingsOnly
├── corpus/
│   ├── schema.sql                 # + event_alliances table; ALTER event_rankings (record_*, sort_order columns)
│   └── db.ts                      # + hasEventRankingRecordColumns-style additive migration guard
└── harness/
    ├── pageArtifacts.ts           # EventTeamSchema += rank/record/rpValue; EventMatchSchema += redScoreVarianceOwn/blueScoreVarianceOwn; EventArtifactSchema += name/startDate/location/week, alliances[]
    └── publish.ts                 # buildEventTeamsStanding restructured for per-event snapshot (D-10)
```

### Pattern 1: Additive nullable-column corpus migration (for D-18 item 6/7)

**What:** `packages/corpus/db.ts`'s `openCorpus` already has the exact precedent needed for `event_rankings`'s new `record_wins`/`record_losses`/`record_ties` and RP columns — the EVNT-01 location-columns migration.

**When to use:** Any time a new *source field* (not a derived value) needs to land on an existing table without forcing a corpus rebuild.

**Verified pattern** `[VERIFIED: packages/corpus/db.ts:114-203]`:
```ts
const EVENT_LOCATION_COLUMNS: readonly [string, string][] = [
  ["name", "TEXT"], ["week", "INTEGER"], ["country", "TEXT"],
  ["state_prov", "TEXT"], ["district_key", "TEXT"],
];
export function hasEventLocationColumns(db: Corpus): boolean {
  const columns = db.prepare(`PRAGMA table_info(events)`).all() as { name: string }[];
  const existing = new Set(columns.map((column) => column.name));
  return EVENT_LOCATION_COLUMNS.every(([name]) => existing.has(name));
}
// ...inside openCorpus():
if (!hasEventLocationColumns(db)) {
  for (const [name, sqlType] of EVENT_LOCATION_COLUMNS) {
    if (!existing.has(name)) db.exec(`ALTER TABLE events ADD COLUMN ${name} ${sqlType}`);
  }
}
```
The doc comment at that site is explicit about WHY this is safe here and not a general migration framework: these are new source fields, honestly `NULL` until the next ingest refresh fills them — never a *derived* value that would be wrong until recomputed (that case, `winner_imputed`, instead throws and demands a corpus rebuild). D-18 item 6's `record`/RP columns are exactly the safe case: `[VERIFIED: same pattern applies — new source fields TBA already returns, currently discarded at ingest]`.

For D-18 item 7 (the new `event_alliances` table), the precedent is `team_media`/`event_rankings` themselves — `CREATE TABLE IF NOT EXISTS` needs no migration guard at all, since it's a brand-new table with no prior rows `[VERIFIED: packages/corpus/schema.sql:78-108, doc comment on event_rankings: "Additive CREATE TABLE IF NOT EXISTS, matching team_media's precedent exactly... this is a brand-new table, no prior rows, no migration needed"]`.

### Pattern 2: TanStack Table v9 pinned-column pattern (for Insights/Breakdown)

**What:** The Teams table's real, shipped pinned-column construction — the pattern Insights/Breakdown should reuse verbatim rather than inventing a second one.

**Verified** `[VERIFIED: apps/web/src/components/teams-table/columns.tsx:1-30, apps/web/src/components/teams-table/TeamsTable.tsx:133-214]`:
```ts
// columns.tsx
export const PINNED_COLUMN_IDS = ["rank", "teamNumber", "nickname"] as const;
export const features = tableFeatures({ columnPinningFeature, columnSizingFeature });
const columnHelper = createColumnHelper<typeof features, TeamRow>();
```
```ts
// TeamsTable.tsx — sticky positioning driven by the pinning feature's own offsets
<TableHeader style={{ position: "sticky", top: 0, zIndex: 3 }}>
...
style={{ position: pinned ? "sticky" : undefined, /* left offset from getStart() */ }}
```
Insights should pin `["rank", "teamNumber", "nickname"]` (reusing `PINNED_COLUMN_IDS` verbatim); Breakdown has no rank column (D-11) so pins only `["teamNumber", "nickname"]`.

### Pattern 3: Native `overflow-x-auto` scroll region (for Quals/Elims and the tab strip)

**What:** The simpler, non-tabular horizontal-scroll pattern already shipped and explicitly documented as "the highest-risk surface in the phase."

**Verified** `[VERIFIED: apps/web/src/components/team/EventSection.tsx:10-19]`:
```
"...every flex/grid ancestor of the scroller below carries `min-w-0`, and the
scroller itself is a single native `overflow-x-auto` element with
`touch-pan-x`/`overscroll-x-contain` (Tailwind utilities for `touch-action:
pan-x` / `overscroll-behavior-x: contain`), never fused with the page's own
vertical scroll."
```
```tsx
<div data-testid={`match-table-scroll-${event.eventKey}`}
     className="min-w-0 touch-pan-x overflow-x-auto overscroll-x-contain">
```
This is the exact mechanism 07-UI-SPEC.md's "Tab strip on mobile is a horizontally scrollable row" spec reuses for the 5-tab strip. See Open Question 5 below for why applying it to BOTH the tab strip (page-chrome level) and each tab's own table (content level) as **siblings, never nested**, is what avoids the risk Phase 5/6 flagged.

### Anti-Patterns to Avoid

- **Hand-rolling a second axis-domain function for Quals/Elims:** `apps/web/src/components/team/matchAxis.ts`'s `computeAxisDomain(events: readonly TeamSeasonEvent[])` is scoped to `TeamSeasonEvent`/`TeamSeasonMatch` (team-page domain) `[VERIFIED: apps/web/src/components/team/matchAxis.ts:15-16,125]`. Quals/Elims need an event-scoped sibling operating over `EventMatchSchema`/`EventUpcomingMatchSchema` rows — write a new function reusing the same `AxisDomain`/`allianceMarkPositions`/`MATCH_GEOMETRY` exports, not a copy-pasted domain computation.
- **Assuming `redScoreVarianceOwn`/`blueScoreVarianceOwn` already exist on `EventMatchSchema`:** confirmed absent by direct read `[VERIFIED: packages/harness/pageArtifacts.ts:246-262 — EventMatchSchema has no variance field of any kind, unlike TeamSeasonMatchSchema which got redScoreVarianceOwn/blueScoreVarianceOwn in Phase 6 D-01]`. Every Quals/Elims band in the UI-SPEC depends on this field landing first.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Pinned-leading-column wide table | A custom sticky-column CSS scheme | `@tanstack/react-table@9.1.2`'s `columnPinningFeature`+`columnSizingFeature`, matching `teams-table/`'s exact construction | Already solved, already tested, already proven at real data scale (Teams table) |
| Per-tab shared match axis | A second axis-math implementation | Generalize `matchAxis.ts`'s `computeAxisDomain`/`scaleToPlot`/`axisTicks`/`allianceMarkPositions` | These are already the single source of the `BAND_H=8`/`DOT_H=12`/`TICK_H=14`/`PLOT_H=44`/`PLOT_W=470` geometry constants every match plot in the app uses |
| Null-vs-empty-vs-populated tri-state ingest counters | A bespoke state machine for the new alliances ingest | Mirror `ingestSeasonRankingsOnly`'s `populatedCount`/`nullBodyCount`/`emptyRankingsCount`/`cacheHitCount` tally exactly `[VERIFIED: packages/ingest/cli.ts:356-417]` | Confirmed live (this research) that `/alliances` needs the identical three-state handling `/rankings` already solved — same PD-02 precedent, not a new problem |
| R2 bulk delete / list-then-delete | A prefix-listing helper | `deleteObject(bucket, key)` called once per key, keys enumerated the same way `publishSeasons` already enumerates every artifact it writes | `r2Client.ts` has no bulk/prefix delete capability at all `[VERIFIED: packages/harness/r2Client.ts:238-259 — deleteObject's doc comment states "deleting only, never a bulk/prefix operation"]`; don't build one — deterministic key enumeration makes it unnecessary |

**Key insight:** Almost everything this phase needs already has a shipped sibling to generalize from. The genuinely new work is data (alliances table, extended rankings, event identity, per-alliance variance, as-of-event snapshots) — not new UI mechanics.

## Runtime State Inventory

> Included because D-04/D-05 rename `sigma1` → `vpr` across the codebase and published state — this is a rename phase for that cross-cutting slice, even though the phase as a whole is not a rename phase.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data (R2) | Every `sigma1@{version}.json` object under `v1/{teams,team,event,events}/...` — measured ≈18,222 objects (see Open Question 4 below for the count derivation) | Write new `vpr@...` keys (D-05), verify, then `deleteObject` each old `sigma1@...` key (D-06) |
| Stored data (D1) | Remote `sigmascout-state` D1 database stores `algorithm_id = 'sigma1'` as **row data**, not just a code string — confirmed via `docs/publish-budget.md`'s own read-back table: `sigma1 \| league \| 1 \| 7,465` and `sigma1 \| team \| 4,598 \| 4,760` rows `[VERIFIED: docs/publish-budget.md "Import: all three algorithms present in remote D1, verified by read-back" table]`. `emitSeedSql`'s own output begins `DELETE FROM algorithm_state WHERE algorithm_id = '<id>'` `[VERIFIED: docs/publish-budget.md "Re-seed, not migrate" section, reason 1]` | Not named in CONTEXT.md's D-18 list. Re-seeding with `algorithmId: "vpr"` inserts NEW rows under the new id; the OLD `algorithm_id='sigma1'` rows are NOT auto-removed by a `vpr` reseed (the DELETE clause is scoped to the id being reseeded). Needs an explicit one-time `wrangler d1 execute sigmascout-state --remote --command "DELETE FROM algorithm_state WHERE algorithm_id = 'sigma1'"` (or equivalent) as part of the same rename pass, or the old rows become permanent dead state — a direct D1 analogue of D-06's R2 cleanup |
| Live service config | `apps/worker/src/scheduled.ts`'s `DEFAULT_LIVE_ALGORITHM_IDS = ["sigma1"]` (baked into deployed Worker code, not external config) `[VERIFIED: apps/worker/src/scheduled.ts:146]` | Code edit + `pnpm worker:deploy` (already named in CONTEXT.md D-05) |
| OS-registered state | None found — no OS-level scheduling or registration keyed to the algorithm name | None |
| Secrets/env vars | None reference `sigma1` — `TBA_API_KEY`/R2 credential names are unrelated to the algorithm id | None |
| Build artifacts | `data/algorithm-versions/sigma1@2.0.0+tracer-check.json` and `sigma1@2.0.0+tuned-2026-08.json` — exactly 2 files, confirming CONTEXT.md's count `[VERIFIED: ls data/algorithm-versions/, both files' id field reads "sigma1"]` | Rename files and their internal `"id": "sigma1"` field to `"vpr"` (already named in CONTEXT.md D-05) |

**Additional finding beyond CONTEXT.md's named blast radius:** a repo-wide search for non-test files referencing `sigma1`/`Sigma1` found **at least 20 files**, not just the ones CONTEXT.md's D-05/D-21 enumerate (`apps/worker/src/scheduled.ts`, `PUBLISHED_ALGORITHM_IDS`, the two `data/algorithm-versions/` files) `[VERIFIED: grep -rl "Sigma1\|sigma1" across apps/web/src, apps/worker/src, packages/harness/{manifests,cli}.ts, docs/, excluding *.test.*]`. Notably:
- `apps/web/src/lib/searchParams.ts:27` — `const DEFAULT_ALGORITHM: PublishedAlgorithmId = "sigma1"` `[VERIFIED: apps/web/src/lib/searchParams.ts:27,49]` — this is the exact fallback D-05's own discussion cited as evidence the rename is safe ("old `?algorithm=sigma1` links resolve to the new default"), so it MUST become `"vpr"` for that safety claim to hold.
- `apps/web/src/lib/bonusRp.ts`, `apps/web/src/lib/metricGroups.ts`, `apps/web/src/lib/metricKeys.ts`, `apps/web/src/lib/query-client.ts` — likely comment/doc-string references, not necessarily functional, but should be swept.
- `apps/worker/src/bundleSmoke.ts`, `apps/worker/src/env.ts`, `apps/worker/src/stateStore.ts` — Worker-side files beyond `scheduled.ts` alone.
- `packages/harness/manifests.ts`, `packages/harness/cli.ts` — pipeline files beyond `publish.ts`.
- 7 files under `docs/` (`docs/models/*.md`, `docs/publish-budget.md`, `docs/worker-operations.md`, `docs/first-paint-measurement.md`) — historical/measurement docs; CONTEXT.md's D-05 doesn't require rewriting historical measurement docs (those describe what WAS measured under the old name, which is honest history), but any doc making forward-looking claims should be checked.

**Planner action:** budget a full-repo grep-and-sweep task for the rename, not a fixed enumerated file list — the true blast radius is larger than CONTEXT.md's D-05 itemization.

## Common Pitfalls

### Pitfall 1: Offseason/preseason events never get a published event artifact under the standard republish command

**What goes wrong:** `publish.ts`'s CLI (`main()`) parses only `event`, `algorithm`, `bucket`, `dry-run`, `seasons`, `concurrency`, `skip-state` — there is **no `--include-offseason` flag wired through the CLI at all** `[VERIFIED: packages/harness/publish.ts:1673-1697]`, and the `publish:seasons` npm script (`tsx --env-file=.env packages/harness/publish.ts --seasons 2022-2026`) never sets it `[VERIFIED: package.json:24]`. Inside `publishSeasons`, `includeOffseason` defaults to `false` `[VERIFIED: packages/harness/publish.ts:1081]`, which excludes offseason/preseason matches from `buildSeasonStream`/`selectScheduledMatches` — so for those events, `eventMatchesForAlgo.get(eventKey)` and `scheduledPredictionsByEvent.get(eventKey)` are both empty, and `buildEventArtifact`'s call site is skipped entirely via `if (predictions.length === 0 && upcoming.length === 0) continue;` `[VERIFIED: packages/harness/publish.ts:1393]`. Meanwhile the EVENTS-LIST artifact (`events/{year}`) is unaffected — `selectEventMeta` has no offseason filter `[VERIFIED: packages/harness/publish.ts:994-1001]` — so these events **do appear as rows** in the Events list (with a real name/date), just with zeroed match/team counts, and once Phase 7 wires event rows into `/event/{eventKey}` links (a named integration point for this phase), clicking one of these rows fetches a key that was never written to R2.

**Why it happens:** the `--include-offseason` capability exists as a `publishSeasons` option but was never surfaced on the CLI, because no prior phase needed it (Phase 4-6 never published offseason event pages).

**How to avoid:** the D-18 republish must run with offseason inclusion — either add `"include-offseason": { type: "boolean" }` to `publish.ts`'s `parseArgs` options and thread it through `runSeasonsCliMode`, or call `publishSeasons` directly with `includeOffseason: true` for this phase's one authorized republish. This is a **prerequisite for D-08's fallback design to be reachable at all** — D-08 was measured and written specifically around `2025isios` (68 matches), `2023cnsh` (62 matches), `2024auwarp` (62 matches) — real, substantial offseason events that currently have zero event artifact.

**Warning signs:** any acceptance test that fetches `v1/event/2025isios/vpr@....json` (or any offseason event key) after the republish and gets a 404 from R2.

### Pitfall 2: `buildEventTeamsStanding`'s current per-season-once call site

**What goes wrong:** `buildEventTeamsStanding(metricsByTeam, teamKeys, teamInfo)` `[VERIFIED: packages/harness/publish.ts:862-871]` is called once per event inside the event loop, but `metricsByTeam` itself is computed exactly once per (algorithm, season) at line 1258 (`const metricsByTeam = ... algorithm.teamMetrics(state, teamsThisSeason)`, using `state = records.finalStates.get(algorithm.id)` — the SEASON-FINAL state). Every event in the season currently gets the same season-final metrics, which is what D-10 is rejecting.

**Why it happens:** this is a genuine architectural gap, not a bug — nothing before this phase needed as-of-event values.

**How to avoid:** see Open Question 3 below — the fix is cheap and has a proven seam (`onMatchComplete`), not a rewrite.

**Warning signs:** an Insights tab for an early-season event showing a team's LATE-season metric value (e.g., a team that improved dramatically over the season showing its final, not early, numbers at its first event).

## Code Examples

### Live TBA `/event/{key}/rankings` response shape (verified 2026-08-27)

```json
// GET /event/2022mnmi/rankings — sort_order_info's position-0 entry is
// consistently the RP-equivalent stat across every 2022-2026 season sampled.
{
  "rankings": [
    { "rank": 1, "team_key": "frc...", "matches_played": 10,
      "sort_orders": [3.6, 90.6, 17.4, 21.6, 0, 0],
      "record": { "wins": 9, "losses": 1, "ties": 0 } }
  ],
  "sort_order_info": [
    { "name": "Ranking Score" },   // index 0 — the RP column source (D-18 item 6)
    { "name": "Avg Match" },
    { "name": "Avg Hangar" },
    { "name": "Avg Taxi + Auto Cargo" }
  ]
}
```

### Live TBA `/event/{key}/alliances` response shape (verified 2026-08-27)

```json
// GET /event/2022roe/alliances — 4-team alliance (picks[3] is the "backup",
// not a separately-named field); status shape varies by playoff_type.
[
  {
    "declines": [],
    "name": "Alliance 1",
    "picks": ["frc3310", "frc67", "frc4451", "frc3539"],
    "status": {
      "current_level_record": { "wins": 1, "losses": 2, "ties": 0 },
      "level": "f",
      "playoff_type": 0,
      "record": { "wins": 5, "losses": 2, "ties": 0 },
      "status": "eliminated"
    }
  }
]
// Some offseason events omit "name" entirely (not "" — the key is ABSENT):
// GET /event/2024wvrox/alliances -> first alliance object's keys are
// exactly ["declines", "picks", "status"], no "name" key at all.
```

## State of the Art

Not applicable — no framework/library version drift concerns this phase (no new dependencies, existing stack already current per Phase 5/6 research).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Republish DELETE throughput is at least as fast as measured PUT throughput (used to project the ~7-8 min delete-pass time in Open Question 4) | Open Question 4 | If DELETE is materially slower than PUT (unlikely — no request body), the total republish time estimate undercounts; not a correctness risk, only a planning-estimate risk |
| A2 | Sigma1's byte-share of the total published corpus is 40-50% (used to bound the storage-headroom estimate during the write-verify-delete transition window) | Open Question 4 | This is a reasoned bound from measured per-page-kind totals, not a directly measured per-algorithm split; if wrong, the true transition-window storage usage differs from the stated ~3.6-3.8 GB estimate — but even a generous doubling of sigma1's whole measured share (≈2.53 GiB) stays under the 10 GB cap, so this assumption does not change the pass/fail conclusion |
| A3 | The 40-event live TBA sample (one event per year × event-type group, 2022-2026) is representative of the full ~1,581-event corpus for the sort_orders/alliances shape questions | Open Questions 1 & 2 | A full-corpus live ingest (as 06.1-04 already did for `/rankings`) could surface a rarer shape variant this sample didn't hit; D-18 items 6/7's own acceptance criteria should include running the real full-corpus ingest, which will supersede this sample |

**If this table is empty:** N/A — see above.

## Open Questions — the five assigned questions, answered

### Question 1: Is TBA's `sort_orders` populated, and which index carries RP?

**Status: RESOLVED.**

**Method:** Wrote a live probe script (`tsx --env-file=.env`, reading `TBA_API_KEY` via `process.env` only, never logged) that queried `/event/{key}/rankings` for 40 real events — one event per (year × TBA `event_type`) group, spanning 2022-2026 and event types 0 (Regional), 1 (District), 2 (District Championship), 3 (CMP Division), 4 (CMP Finals/Einstein), 5 (District CMP Division), 99 (Offseason), 100 (Preseason). Event keys were drawn from the real local corpus (`data/corpus.sqlite`), preferring the highest-match-count event per group.

**Findings:**
- `sort_order_info[0].name` is **"Ranking Score"** in every one of the 40 sampled events across all 5 seasons and all 8 event types — the position is stable even though the FULL vocabulary changes by season (2022: `["Ranking Score","Avg Match","Avg Hangar","Avg Taxi + Auto Cargo"]`; 2024: `["Ranking Score","Avg Coop","Avg Match","Avg Auto","Avg Stage"]`; 2026: `["Ranking Score","Avg Match","Avg Auto Fuel","Avg Tower"]` — 4-6 entries depending on season). `[VERIFIED: live TBA API probe, 2026-08-27, 40 events]`
- `sampleSortOrders[0]` values (e.g., 3.6, 3.83, 3.9, 5.5, 4.0 across different events) are per-match AVERAGES, not season totals — consistent with "Ranking Score" being TBA's own display name for the metric FRC calls "RP" on event ranking pages.
- All 5 sampled Championship Finals (Einstein, type 4) events — `2022cmptx`, `2023cmptx`, `2024cmptx`, `2025cmptx`, `2026cmptx` — returned `rankingsCount: 0` (a valid non-null response with an EMPTY `rankings` array, `bodyIsNull: false`), confirming D-08's claim that Einstein is playoff-only and cannot have a qualification ranking. One preseason event (`2022ispr`, 0 matches) also returned an empty array.
- No `null`-body response was observed in this 40-event sample (`bodyIsNull: false` for every one), but the full-corpus population is already independently established by 06.1-04's real live ingest, cited in `STATE.md`: 47,695 rows written, 1,322 of 1,581 events populated (259 not) — consistent with D-08's own 259-event count.
- `sort_orders` was non-null in every sampled populated ranking row — the schema's defensive `.nullable()` `[VERIFIED: packages/ingest/schemas.ts:131]` remains correctly conservative, not proven unreachable.

**Recommendation for the planner:** publish `event_rankings`'s new RP column by reading `response.sort_order_info[0].name === "Ranking Score"` at ingest time as an assertion (not a hardcoded index-0 read with no check) — if a future season's TBA response ever puts a different stat first, this assertion fails loudly rather than silently publishing the wrong column as "RP." No per-season absence rule is needed for the RP column itself: whenever `rankings` is non-empty, `sort_orders[0]` was populated in every sample.

### Question 2: What does `/event/{key}/alliances` return, and for how many events?

**Status: RESOLVED** (with a scope caveat — see A3 in the Assumptions Log).

**Method:** Same live probe, same 40 events, `GET /event/{key}/alliances`.

**Findings:**
- **Shape:** an array of alliance objects: `{ declines: string[], name?: string, picks: string[], status: {...} }`. `picks` is length 3 or 4 — a 4th entry (D-16's "backup") is simply `picks[3]`, **there is no separately-named `backup` field anywhere in the raw response.** 4-team alliances were common at District Championship / CMP Division events (`2022roe`, `2025cur`, `2026arc`, `2026nyro`, and every sampled CMP Finals/Einstein event). `declines` was an empty array in every sample (kept optional/defensive, never observed populated). `[VERIFIED: live TBA API probe, 2026-08-27]`
- **`name` is sometimes ABSENT entirely, not empty-string** — `2024wvrox` (an offseason event) returned alliance objects whose only keys are `["declines", "picks", "status"]`, no `name` key at all. The planner must render alliance identity from `name ?? \`Alliance ${index+1}\`` or similar, never assume `name` is always present.
- **`status` shape varies by `playoff_type`:** observed `playoff_type` values 0 (legacy single-elim, minimal status), 4 (2022 Einstein round-robin — adds `advanced_to_round_robin_finals`, `round_robin_rank`), 8 (2024 offseason wvrox), and 10 (2023+ standard double-elim — adds `double_elim_round`). Only `status.status` ("won"/"eliminated"), `status.record`, `status.current_level_record`, and `status.level` are reliably present across every variant observed.
- **Coverage — the same three-state contract `/rankings` already has, confirmed live:**
  - **Populated array:** 38/40 sampled events.
  - **Empty array `[]`** (valid 200, `bodyIsNull: false`, `bodyIsEmptyArray: true`): 2/40 — both offseason (`2025bc`, `2026wvrox`), despite both having real rankings data (62 and 30 ranked teams respectively) — i.e., these events ran qualification matches and published rankings but never ran an alliance selection/playoff round at all.
  - **Null body:** 1/40 — `2022ispr` (preseason, 0 matches).
- This is the identical PD-02 three-state pattern `ingestSeasonRankingsOnly` already solved for `/rankings`. **The planner should mirror that exact tallying discipline** (`populatedCount`/`nullBodyCount`/`emptyRankingsCount`/`cacheHitCount`) for the new alliances ingest, not invent a new state model. `[VERIFIED: packages/ingest/cli.ts:356-417]`

**Recommendation for D-17's disabled-tab logic:** treat BOTH a null body and an empty array as "no alliance data" (tab disabled) — this matches the empty-array case observed live (an event that DID run quals but never got to alliance selection) as well as the null case (a scarcely-populated preseason event).

### Question 3: What does as-of-event metric snapshotting cost?

**Status: RESOLVED — measured directly against the real corpus, not estimated.**

**Method:** Wrote `scripts/_measureEventSnapshotCost.ts` — an uncommitted one-off measurement tool, following the exact precedent `docs/publish-budget.md` documents for `scripts/_worstCaseTick.ts` ("an uncommitted one-off measurement tool," deleted after use). The script:
1. Opened the real corpus read-only (`data/corpus.sqlite`, 359 MB).
2. Ran the real `buildSeasonStream` + `WalkForwardSimulator.runAll([sigma1], ...)` replay for one season at a time (2022-2026), using the SAME `onMatchComplete` hook `publish.ts` already wires for D-28 metric history — capturing, per event key, the walk-forward state as it stood after that event's LAST chronological match (later calls for the same event key simply overwrite earlier ones, since the stream is already in canonical chronological order — zero extra corpus reads, zero extra replay passes).
3. Timed **(a)** the CURRENT approach — one `algorithm.teamMetrics(finalState, allTeamsThisSeason)` call — against **(b)** the PROPOSED approach — one `algorithm.teamMetrics(stateAsOfEventEnd, eventRoster)` call per distinct event in the season.
4. Deleted the script after the run (not committed — nothing in git status changed as a result).

**Measured results, sigma1, real 2022-2026 corpus:**

| Season | Matches | Distinct events | Walk-forward replay (unaffected) | (a) CURRENT: 1 call, whole-season roster | (b) PROPOSED: 1 call/event | Delta | Multiple |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2022 | 14,677 | 184 | 16,046.0 ms | 11.601 ms | 23.883 ms | +12.28 ms | 2.1x |
| 2023 | 16,353 | 185 | 16,333.0 ms | 19.642 ms | 31.343 ms | +11.70 ms | 1.6x |
| 2024 | 17,029 | 192 | 21,774.1 ms | 30.409 ms | 52.223 ms | +21.81 ms | 1.7x |
| 2025 | 17,877 | 204 | 29,239.9 ms | 15.005 ms | 24.455 ms | +9.45 ms | 1.6x |
| 2026 | 18,403 | 214 | 21,047.7 ms | 18.741 ms | 44.894 ms | +26.15 ms | 2.4x |

Per-event call cost: median 0.10–0.23 ms, max observed 3.62 ms (2026, largest roster). Heap deltas were noise-level and inconsistent in sign across runs (range roughly -35 MB to +48 MB, GC-timing-dependent, not a real signal at this call volume).

**Conclusion:** the added `teamMetrics()` compute is **9-26 ms per (season, algorithm) pair** — against a walk-forward replay that itself already takes 16-29 SECONDS per season, and a full republish measured at ~23-25 MINUTES. Across all 15 (season × algorithm) pairs in a full republish, the total added compute is on the order of **200-400 ms** — genuinely negligible, not a measurable fraction of the existing budget. **D-10 is a structural change, not a performance one.**

**What actually has to change (the real cost is engineering, not runtime):** `buildEventTeamsStanding` `[VERIFIED: packages/harness/publish.ts:862-871]` is currently called once per event but fed the SAME season-final `metricsByTeam` every time (computed once at line 1258, `const metricsByTeam = ... algorithm.teamMetrics(state, teamsThisSeason)` using `records.finalStates`). The fix threads a per-event state map (captured via the existing `onMatchComplete` hook, exactly as this measurement script did) into that call site instead — no new corpus query, no new replay pass, reusing infrastructure D-28's metric history already pays for. The percentile split (D-10: value as-of-event, percentile still season-final) additionally needs the per-event `TeamMetric` merged from two sources — the as-of-event value and the already-computed season-final `sortedPools` percentile — mirroring the exact pattern `withHistoryPercentiles` already established for `metricHistory` rows in plan 06.1-05 `[VERIFIED: packages/harness/publish.ts:187-196]`.

### Question 4: Republish sequencing (write-verify-delete, partial failure, resumability, doubled object count)

**Status: RESOLVED** (derived from measured figures + direct reads of `r2Client.ts`; the delete-throughput figure itself is a reasoned projection, flagged A1 in the Assumptions Log — not separately live-measured, since that would require actually deleting production objects).

**Tooling already exists:** `r2Client.ts` has `putObject` (with retry, 5 attempts, exponential backoff on 5xx/429/408), `getObject`, and `deleteObject` — `deleteObject` is **idempotent by S3 contract** (a 404 counts as success) and explicitly scoped to single-key deletes only, no bulk/prefix operation `[VERIFIED: packages/harness/r2Client.ts:238-259]`.

**Safe order:** write every new `vpr@...` object first (a successful `await putObject(...)` — which already throws on any non-2xx after retries exhausted — IS the verification signal; no separate GET-readback step is needed since `putObject`'s own contract already guarantees a 2xx before returning), THEN delete the corresponding old `sigma1@...` key. This is what D-18 item 9 and D-06 already specify; this research confirms the tooling supports it with no gaps.

**Object count derivation:** the measured full-republish breakdown (`docs/publish-budget.md`, run 2026-08-27) is 54,671 page objects across 3 algorithms for the algorithm-scoped kinds (`teams`, `team`, `events`, `event`) plus 5 algorithm-agnostic `compare` objects. Dividing the algorithm-scoped counts by 3: `teams` 5, `team` ≈17,231, `events` 5, `event` ≈981 — **sigma1's own key count ≈ 18,222 objects** that need a paired old-key delete (`compare/{year}` is untouched — D-02's documented exception, no algorithm segment).

**Partial-failure / resumability:**
- **Write phase:** every new key is deterministic (`artifactKey({..., algorithmId: "vpr", ...})`) and the write is idempotent (a re-run's `putObject` simply overwrites the same key) — a partial failure here is safely resumable by re-running `publish:seasons`; no corruption risk.
- **Delete phase:** a partial failure leaves some old `sigma1@...` objects orphaned alongside their already-written `vpr@...` replacements. This is **not a correctness problem** — nothing reads the old path anymore once the rename ships (browsers already default to `vpr` per `searchParams.ts`'s catch fallback) — only a cost/cleanliness one (dead storage, matching D-06's own explicit rejection of "leave them as a rollback path"). Because `deleteObject` treats a missing key as success, a resumed delete pass built from the SAME deterministic key enumeration `publishSeasons` already walks is naturally idempotent and safe to simply re-run to completion.

**Storage headroom during the transition window:** the measured total published payload is 2,714,525,205 bytes (≈2.53 GiB) against R2's 10 GB free-tier storage cap — **≈74.7% headroom already unused** `[VERIFIED: docs/publish-budget.md, "Storage and write volume" table]`. During the write→delete window, the sigma1-scoped subset (old + new) briefly coexists. Even a generous bound on sigma1's own byte-share (sigma1 carries the richest per-match fields — variance, RP pmf, per-bonus arrays — so it's reasonable to assume it's 40-50% of the total, not an even 33%, per A2 in the Assumptions Log) keeps total usage during the transition around **~3.6-3.8 GB, comfortably under 10 GB** (~62-64% headroom remaining even at the peak of the transition).

**Time cost:** the measured full republish (54,671 PUTs) took ≈22-25 minutes at concurrency 16, implying a throughput of roughly 2,400-2,500 objects/minute. Adding ≈18,222 DELETE calls (no request body, likely faster than PUT, not separately measured — A1) at the same bounded concurrency projects to roughly **7-8 additional minutes**. **Total projected republish time: ≈30-33 minutes** — NOT a doubling of the ~23-25 minute baseline, since deletes are cheap relative to the writes they follow.

### Question 5: Mobile with five tabs

**Status: RESOLVED — already answered in the approved 07-UI-SPEC.md, confirmed here against real shipped source.**

This was resolved as a "Claude's Discretion" item during UI design (07-UI-SPEC.md's Spacing Scale section), not left as an open implementation risk. Verified against the actual shipped code it cites:

- **Phase 6's proven mechanism** (`EventSection.tsx`'s match-table scroll region): `overflow-x-auto` + `touch-pan-x` + `overscroll-x-contain`, with every ancestor flex/grid container carrying `min-w-0` — explicitly documented in the component's own header comment as "the highest-risk surface in the phase" `[VERIFIED: apps/web/src/components/team/EventSection.tsx:10-19]`.
- **Phase 5's proven mechanism** (Teams table's wide-table pinning): `@tanstack/react-table@9.1.2`'s `columnPinningFeature`+`columnSizingFeature`, CSS `position: sticky` on pinned columns `[VERIFIED: apps/web/src/components/teams-table/TeamsTable.tsx:133-214]`.
- **What's genuinely new in Phase 7:** the TAB STRIP ITSELF needs to scroll horizontally (5-6 short single-word labels on a ~390px screen) — Phase 6's tab strip only ever had 2 tabs (`Overview`/`Metric History`) and never needed to scroll `[VERIFIED: apps/web/src/routes/team.$teamNumber.tsx:151 — <TabsList variant="line" ...> with no overflow handling, because 2 tabs always fit]`.
- **The resolution (already in 07-UI-SPEC.md, confirmed sound):** apply the SAME `overflow-x-auto`/`scrollbar-width:none` mechanism to the tab strip container, as a page-chrome-level element that is a SIBLING of — never nested inside — each tab's own content scroll region. This is exactly what avoids the "nested horizontal-scroll-inside-vertical-list" collision Phase 5 D-04 and Phase 6 D-10 both flagged: the tab strip's scroll region and a table's scroll region never contain one another, they sit at different DOM depths side by side.

**Concrete implementation guidance for the planner:** Insights/Breakdown tabs reuse Pattern 2 above (TanStack v9 pinned columns); Quals/Elims tabs reuse Pattern 3 (native `overflow-x-auto`, generalizing `MatchTable.tsx`); the tab strip itself is a third, independent `overflow-x-auto` region at the page level, using the exact CSS 07-UI-SPEC.md already specifies (`overflow-x-auto` with `scrollbar-width: none`, "already the convention the match-table pinned-column region uses"). No new gesture, no new risk, three independent scroll regions that never nest.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| TBA API (`thebluealliance.com/api/v3`) | D-18 items 6/7 ingest | ✓ — confirmed live, 40/40 probe requests returned 200 | v3 | — |
| Local corpus (`data/corpus.sqlite`) | Publisher, ingest, this research's own measurement | ✓ — 359 MB, present, opened read-only successfully | — | — |
| R2 credentials (`.env`) | Republish | ✓ (assumed present — `publish:seasons` is documented as already working in `docs/publish-budget.md`'s most recent run) | — | — |
| Cloudflare D1 (`sigmascout-state`) | The newly-discovered rename gap (old `sigma1` rows) | Not independently re-verified this session (no destructive D1 command run); prior phases confirm it's live and seeded | — | — |

**Missing dependencies with no fallback:** none identified.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.x (root `vitest.config.ts` + `apps/web/vitest.config.ts`) `[VERIFIED: package.json "test": "vitest run"; find confirmed both config files exist]` |
| Config file | `vitest.config.ts` (repo root, pipeline/harness), `apps/web/vitest.config.ts` (client) |
| Quick run command | `pnpm vitest run <path-to-file>` |
| Full suite command | `pnpm test` (repo root `vitest run`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EVNT-02 | Insights tab orders by official rank, falls back to VPR order with notice | unit + component | `pnpm vitest run apps/web/src/components/event/InsightsTab.test.tsx` | ❌ Wave 0 |
| EVNT-03 | Breakdown tab shows every raw component, VPR-rank-ordered, no event rank | component | `pnpm vitest run apps/web/src/components/event/BreakdownTab.test.tsx` | ❌ Wave 0 |
| EVNT-04 | Quals tab merges played+upcoming, per-tab axis domain | unit (axis) + component | `pnpm vitest run apps/web/src/components/event/eventMatchAxis.test.ts` | ❌ Wave 0 |
| EVNT-05 | Alliances tab computes `√(σ₁²+σ₂²+σ₃²)` over first 3 picks only | unit | `pnpm vitest run apps/web/src/components/event/AlliancesTab.test.tsx` | ❌ Wave 0 |
| EVNT-06 | Elims tab flat chronological list, own axis domain | component | `pnpm vitest run apps/web/src/components/event/ElimsTab.test.tsx` | ❌ Wave 0 |
| D-18.6 | `sort_order_info[0].name === "Ranking Score"` assertion holds live | integration (live TBA) | mirrors `packages/ingest/rankings.test.ts`'s pattern | ❌ Wave 0 |
| D-18.7 | Alliances ingest handles null/empty/populated exactly like rankings | unit | new `packages/ingest/alliances.test.ts` | ❌ Wave 0 |
| D-10 | As-of-event snapshot ≠ season-final value for an early-season event | unit (publish.ts) | extend `packages/harness/publish.test.ts` | ❌ Wave 0 (test exists; new cases needed) |
| D-01/D-02 | `TeamMetric.spread` equals `√(P+R)` everywhere it's published | unit | extend `packages/core/algorithms/sigma1/*.test.ts` | ❌ Wave 0 (new assertion) |
| D-05 | No `sigma1` string reachable from a published artifact path or D1 row after rename | integration | new script/test asserting zero `sigma1@` keys post-republish | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** targeted `pnpm vitest run <file>` for the file(s) touched.
- **Per wave merge:** `pnpm test` (full suite).
- **Phase gate:** full suite green, plus the one authorized live republish, before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `apps/web/src/components/event/*.test.tsx` — new component test files for all 5 tabs (no existing coverage; the route/components are new this phase).
- [ ] `packages/ingest/alliances.test.ts` — new alliances-ingest unit tests, mirroring `rankings.test.ts`'s structure.
- [ ] `apps/web/src/components/event/eventMatchAxis.test.ts` — event-scoped axis-domain tests, mirroring `matchAxis.test.ts`.
- [ ] Framework install: none — Vitest already configured and used identically by every prior phase.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Site has no accounts (REQUIREMENTS.md "Out of Scope") |
| V3 Session Management | No | No sessions |
| V4 Access Control | No | All published data is public/world-readable by design |
| V5 Input Validation | Yes | Every fetched artifact is parsed through its Zod schema before use (`EventArtifactSchema.parse`) — same pattern every prior phase's fetcher already follows `[VERIFIED: apps/web/src/lib/api/events.ts:29-38]`. The `eventKey` route param flows into `artifactKey({ page: "event", eventKey, ... })` and then a URL join (`artifactUrl`) — no path traversal risk observed in the existing `artifactKey`/`artifactUrl` construction (template-literal string join, not filesystem access; R2 keys with `../` segments are just literal characters in an object key, not a traversal vector against a flat key-value store) |
| V6 Cryptography | No | No new crypto surface this phase (R2 SigV4 signing is pre-existing, Phase 4 scope, unchanged) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Third-party (TBA) alliance `name` field rendered unsanitized (a human-entered string like "Archimedes"/"Carver"/custom team names) | Tampering (stored XSS via a compromised or malicious TBA-side name) | React's default JSX text-node escaping already neutralizes this — confirmed no `dangerouslySetInnerHTML` pattern is used anywhere in the reused component set (`MetricValue`, `MatchTable`, `teams-table`); the alliance `name` field should render through the same plain-text JSX interpolation, never raw HTML |
| Malformed/adversarial TBA response for the two new endpoints (rankings extension, alliances) | Tampering / Denial of Service (ingest crash on malformed third-party JSON) | Zod `.parse()` at the fetch boundary — the established project-wide rule (`packages/ingest/schemas.ts`'s header policy: "a parse failure throws... a loud failure on TBA drift is the point"). The new alliances schema should follow the same discipline as `tbaEventRankingsResponseSchema`'s top-level `.nullable()` |
| Route param (`eventKey`) driving both a fetch URL and page content | Tampering (crafted URL) | `EventArtifactSchema.parse()` rejects any malformed fetched body; a nonsense `eventKey` simply produces a 404 fetch (R2 has no such key) → the existing `ErrorState` component, not a crash — matching the `team.$teamNumber.tsx` route's own precedent of validating the param shape before firing a fetch (`TEAM_NUMBER_PATTERN`) |

## Sources

### Primary (HIGH confidence — direct execution/reads this session)

- Live TBA API v3 (`thebluealliance.com/api/v3`), `/event/{key}/rankings` and `/event/{key}/alliances`, probed directly against 40 real events spanning 2022-2026 and all 8 observed event types, 2026-08-27.
- `scripts/_measureEventSnapshotCost.ts` (written and run this session, then deleted — uncommitted, following `docs/publish-budget.md`'s own `scripts/_worstCaseTick.ts` precedent), run against the real `data/corpus.sqlite` for all 5 seasons.
- Direct reads of: `packages/harness/pageArtifacts.ts`, `packages/harness/publish.ts`, `packages/harness/r2Client.ts`, `packages/harness/promote.ts`, `packages/corpus/schema.sql`, `packages/corpus/db.ts`, `packages/ingest/schemas.ts`, `packages/ingest/cli.ts`, `packages/ingest/rankings.ts`, `packages/ingest/tbaClient.ts`, `docs/publish-budget.md`, `apps/web/src/components/MetricValue.tsx`, `apps/web/src/components/team/EventSection.tsx`, `apps/web/src/components/team/matchAxis.ts`, `apps/web/src/components/teams-table/columns.tsx`, `apps/web/src/components/teams-table/rowModel.ts`, `apps/web/src/components/teams-table/TeamsTable.tsx`, `apps/web/src/lib/searchParams.ts`, `apps/web/src/lib/api/events.ts`, `apps/web/src/lib/artifactOrigin.ts`, `apps/worker/src/scheduled.ts`, `apps/web/src/routes/team.$teamNumber.tsx`, `packages/harness/publishedAlgorithms.ts`, `data/algorithm-versions/*.json`, `.planning/config.json`.

### Secondary (MEDIUM confidence)

- `.planning/phases/07-event-pages/07-CONTEXT.md`, `07-UI-SPEC.md`, `07-DISCUSSION-LOG.md` — user decisions and their stated evidence.
- `.planning/STATE.md` — 06.1-04's full-corpus rankings ingest figures (1,322/1,581 events populated), cited as corroboration for this session's 40-event sample.

### Tertiary (LOW confidence)

- None — every claim in this document traces to either a direct execution this session or a direct file read this session.

## Metadata

**Confidence breakdown:**
- Open Questions 1, 2 (TBA API shape/coverage): HIGH — live-verified against real API, 40-event sample; full-population coverage is a documented scope caveat (A3), not a gap in method.
- Open Question 3 (snapshot cost): HIGH — directly measured across all 5 seasons, real corpus, real algorithm code.
- Open Question 4 (republish sequencing): HIGH for tooling/order/resumability (direct code read); MEDIUM for the exact delete-throughput time projection (A1 — reasoned from measured PUT throughput, not separately measured).
- Open Question 5 (mobile): HIGH — resolved against real shipped source, not speculation.
- Standard stack / architecture: HIGH — no new dependencies, patterns generalized from shipped, tested code.
- Pitfall 1 (offseason publish gap) and the D1/blast-radius findings: HIGH — both directly verified by reading the actual CLI arg list and the actual publish-budget.md D1 read-back table.

**Research date:** 2026-08-27
**Valid until:** 30 days (stable — no fast-moving external dependency; TBA API shape and this repo's own code are the two inputs, and TBA's rankings/alliances schema has been stable across 5 seasons in this sample)
