---
quick_id: 260905-lic
type: execute
mode: quick
wave: 1
depends_on: []
autonomous: false
files_modified:
  - packages/corpus/schema.sql
  - packages/corpus/db.ts
  - packages/corpus/districts.test.ts
  - packages/ingest/schemas.ts
  - packages/ingest/tbaClient.ts
  - packages/ingest/districts.ts
  - packages/ingest/districts.test.ts
  - packages/ingest/cli.ts
  - packages/core/districts/pointModel.ts
  - packages/core/districts/pointModel.test.ts
  - packages/core/districts/locks.ts
  - packages/core/districts/locks.test.ts
  - packages/core/districts/reconciliation.test.ts
  - packages/harness/pageArtifacts.ts
  - packages/harness/pageArtifacts.test.ts
  - scripts/publishDistricts.ts
  - scripts/publishDistricts.test.ts
  - package.json
  - apps/web/src/lib/searchParams.ts
  - apps/web/src/lib/api/districts.ts
  - apps/web/src/routes/districts.tsx
  - apps/web/src/routes/districts.test.tsx
  - apps/web/src/routeTree.gen.ts
  - apps/web/src/components/ribbon/Ribbon.tsx
  - apps/web/src/components/ribbon/Ribbon.test.tsx
  - apps/web/src/components/districts/DistrictSelect.tsx
  - apps/web/src/components/districts/DistrictInsightsTab.tsx
  - apps/web/src/components/districts/DistrictBreakdownTab.tsx
  - apps/web/src/components/districts/DistrictLocksTab.tsx
  - apps/web/src/components/districts/DistrictLocksTab.test.tsx

estimate:
  tokens: 300000
  raw_tokens: 150000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "A fourth ribbon link, Districts, appears on every route and navigates to /districts while preserving year and algorithm search params."
    - "Picking a district on /districts shows four tabs — Insights, Breakdown, District Locks, Champ Locks — with ?district= and ?tab= in the URL."
    - "The Breakdown tab shows every district team's official district point total broken down per event into qualification, alliance selection, playoff advancement and award points, plus rookie bonus and adjustments."
    - "The District Locks tab tells a team whether it is mathematically guaranteed a District Championship slot, mathematically eliminated, or still contending — and how many more points it needs to lock."
    - "The Champ Locks tab answers the same question for the district's FIRST Championship allocation."
    - "The point ceiling used by the lock math is proven, by a corpus-wide test, to be at or above every district point component TBA has ever actually reported across the ingested seasons."
  artifacts:
    - packages/corpus/schema.sql
    - packages/ingest/districts.ts
    - packages/core/districts/pointModel.ts
    - packages/core/districts/locks.ts
    - scripts/publishDistricts.ts
    - apps/web/src/routes/districts.tsx
    - apps/web/src/components/districts/DistrictLocksTab.tsx
  key_links:
    - "TBA /districts/{year} official_advancement_counts -> corpus districts.dcmp_slots/cmp_slots -> the `slots` argument to computeLocks. If this link breaks, every lock verdict is computed against the wrong capacity and is silently wrong."
    - "TBA /event/{key}/teams/keys -> corpus event_teams -> a team's remaining unscored district events -> maxRemaining. If registration is missing, remaining points read as zero and every team looks locked."
    - "packages/core/districts/pointModel.ts maxima -> reconciliation.test.ts corpus scan. If the maxima are ever below a real observed value, the guarantee is false; this test is the only thing that can catch it."
    - "artifactKey builders in pageArtifacts.ts -> scripts/publishDistricts.ts write path -> apps/web/src/lib/api/districts.ts read path. Three places must name the same two R2 keys."
---

<objective>
Add a Districts page as the fourth ribbon page, backed by real ingested FIRST district
point data, with Insights, Breakdown, District Locks and Champ Locks tabs.

Purpose: answer "how close am I to being mathematically guaranteed to qualify?" for both
the District Championship and the FIRST Championship, using the official district point
model and every source of district points — qualification, alliance selection, playoff
advancement, awards, and the rookie bonus.

Output: a new corpus district dataset, a tested pure lock-math core, two new published R2
artifacts, and a `/districts` route with four tabs.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md

Existing patterns this plan builds on directly — read the ones your task names, not all of them:

- `packages/corpus/schema.sql` — the additive `CREATE TABLE IF NOT EXISTS` precedent set by
  `team_media`, `event_rankings`, `event_alliances`, and the doc-comment style each carries.
- `packages/corpus/db.ts` — `openCorpus` migrations, `upsertEventRanking` / `upsertEventAlliance`
  / `selectEventRankingsForSeason` as the shape to mirror.
- `packages/ingest/alliances.ts` + `packages/ingest/rankings.ts` — the pure normalize-module
  shape (no I/O, no corpus import, honest empty results, never throw on an absent body).
- `packages/ingest/tbaClient.ts` — `fetchEventRankings` / `fetchEventAlliances` as the ETag-aware
  fetcher shape.
- `packages/ingest/cli.ts` — the `--rankings-only` / `--alliances-only` mode precedent, including
  the "a re-run over an already-ingested season REQUIRES `--force`, because a 304 carries no body"
  rule.
- `scripts/publishAlgorithmsManifest.ts` — the standalone publish-script shape: `parseArgs` from
  `node:util`, deep relative imports with `.js` extensions, `--dry-run`, `main()` guarded on being
  the process entry point, `putObject` from `packages/harness/r2Client.js`.
- `packages/harness/pageArtifacts.ts` — `artifactKey`, `PagePreambleSchema`, and the module-private
  row-schema convention.
- `apps/web/src/lib/api/compare.ts` — the algorithm-independent fetcher shape (no
  `useAlgorithmVersion`, no `enabled` gate).
- `apps/web/src/routes/event.$eventKey.tsx` — the tab-strip pattern: `REGISTERED_*_TABS` narrowing,
  `resolveActiveTab`, `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` from `@/components/ui/tabs`,
  one shared `renderTabState` branch order.
- `apps/web/src/lib/searchParams.ts` — `EVENT_TABS` / `DEFAULT_EVENT_TAB` / `EventSearchSchema`.
- `apps/web/src/lib/districtNames.ts` — `districtDisplayName()`, the existing reader-facing name map.

## Live TBA response shapes, probed 2026-09-05 (do not re-derive these)

`GET /districts/{year}` — array of:
```
{ "abbreviation": "fnc", "display_name": "FIRST North Carolina", "key": "2026fnc",
  "official_advancement_counts": { "cmp": 19, "dcmp": 54 }, "year": 2026 }
```
`official_advancement_counts` is present for every year checked (2019, 2022, 2026). This is the
capacity source — no curated slot table is needed anywhere in this plan.

`GET /district/{districtKey}/rankings` — array of:
```
{ "team_key": "frc4561", "rank": 1, "point_total": 352, "rookie_bonus": 0, "adjustments": 0,
  "event_points": [
    { "event_key": "2026ncwak", "district_cmp": false,
      "qual_points": 21, "alliance_points": 16, "elim_points": 20, "award_points": 5, "total": 62 },
    { "event_key": "2026nccmp", "district_cmp": true,
      "qual_points": 60, "alliance_points": 45, "elim_points": 90, "award_points": 30, "total": 225 } ] }
```
Note the District Championship row is exactly 3x a regular district event row across every
component. `award_points` is the official aggregate award contribution — TBA does not break it
down by which award, and this plan does not need it to.

`GET /district/{districtKey}/events/keys` — array of event key strings (7 for 2026fnc).
`GET /district/{districtKey}/teams/keys` — array of team key strings (90 for 2026fnc).
`GET /event/{eventKey}/teams/keys` — array of team key strings (29 for 2026ncwak).

## Two facts the plan depends on

1. The corpus has **no** district point data, **no** award data, and **no** event-team
   registration table today. `events.district_key` (TBA's abbreviation, not the year-prefixed
   key) is the only district-shaped thing in it. All of it is new in Task 1.
2. frclocks.com is a reference for the **concept** only. Every number in this plan comes from
   TBA's own published district point data or from the official FIRST district point model.
   Do not fetch, scrape or consult frclocks for values.

## Explicitly deferred (state these in the SUMMARY, do not silently drop them)

- The Insights tab ships lean: capacity, cut lines, counts, lock/eliminated tallies and a
  top-N table. No charts, no join against the algorithm-scoped team metrics.
- Award-level detail (which specific award a team won) is not ingested. TBA's per-event
  `award_points` aggregate covers both earned points and the bounded future maximum.
- Declines, waitlist movement and Impact/Engineering-Inspiration wildcards are not modeled.
  Each of these can only ever move a team **up**, so ignoring them makes a `locked` verdict
  conservative — a guarantee stays a guarantee. Surface this as a caveat in the UI.
- District artifacts are refreshed only by an offline `pnpm ingest:districts` +
  `pnpm publish:districts`. The live Worker cron does not touch them.
</context>

<tasks>

<task type="tracer">
  <name>Task 1: District data from TBA into the corpus</name>
  <files>packages/corpus/schema.sql, packages/corpus/db.ts, packages/corpus/districts.test.ts, packages/ingest/schemas.ts, packages/ingest/tbaClient.ts, packages/ingest/districts.ts, packages/ingest/districts.test.ts, packages/ingest/cli.ts, package.json</files>
  <precondition>`.env` carries a working `TBA_API_KEY` and `data/corpus.sqlite` already holds ingested events for 2019, 2020 and 2022-2026 (`pnpm ingest --events-only` has run). Assert by row count, never by rendering `.env`.</precondition>
  <action>
Add the three corpus tables district data needs, the TBA fetchers and normalize rules that
fill them, and a `--districts-only` ingest mode. This is the vertical slice: a real
`pnpm ingest:districts` run must end with real rows in all three tables for every ingested
season.

**Schema** (`packages/corpus/schema.sql`, additive `CREATE TABLE IF NOT EXISTS`, matching the
`event_alliances` precedent exactly — brand-new tables, no migration, no rebuild guard):

- `districts` — primary key `district_key` (TBA's YEAR-PREFIXED key, e.g. `2026fnc`, NOT the
  bare abbreviation `events.district_key` already stores; write a doc comment saying so,
  because the two columns share a name across two tables and mean different things).
  Columns: `year`, `abbreviation`, `display_name`, `dcmp_slots`, `cmp_slots`, `fetched_at`.
  `dcmp_slots` and `cmp_slots` are nullable — a null is the honest stored answer for "TBA
  published no `official_advancement_counts` for this district-year", never a zero and never
  a guessed number.
- `district_rankings` — primary key `(district_key, team_key)`. Columns: `rank`, `point_total`,
  `rookie_bonus`, `adjustments`, `event_points_raw`, `fetched_at`. `event_points_raw` stores
  TBA's `event_points` array verbatim as JSON, following `matches.score_breakdown_raw` and
  `event_alliances.status_raw` provenance precedent — the publish layer parses it with Zod
  rather than this schema modelling it column-by-column across a model that changed in 2023.
- `event_teams` — primary key `(event_key, team_key)`, plus `fetched_at`. This is registration,
  the only way to know a team has an event still ahead of it. Carries NO
  `REFERENCES teams(team_key)` clause, for the same reason `event_alliances.picks` carries
  none: TBA's synthetic second-robot team keys (`frc1165B` and siblings) have no `/team/{key}`
  record and caused a live foreign-key failure in 06.1-01.

**Corpus accessors** (`packages/corpus/db.ts`): `upsertDistrict`, `upsertDistrictRanking`,
`upsertEventTeam`, `selectDistrictsForYear`, `selectDistrictRankings(districtKey)`,
`selectEventTeamsForEvents(eventKeys)`. Mirror `upsertEventRanking`'s prepared-statement and
`INSERT ... ON CONFLICT DO UPDATE` shape.

**TBA schemas** (`packages/ingest/schemas.ts`): Zod schemas for the three district responses
and the bare-string-array teams/keys response, using the exact field names probed above.
`official_advancement_counts` is `.nullish()` — a district-year that lacks it is a real answer.

**TBA fetchers** (`packages/ingest/tbaClient.ts`): `fetchDistrictsList(ctx, year, etag?)`,
`fetchDistrictRankings(ctx, districtKey, etag?)`, `fetchDistrictEventKeys(ctx, districtKey, etag?)`,
`fetchEventTeamKeys(ctx, eventKey, etag?)`. Same ETag-aware `TbaFetchResult` shape as
`fetchEventRankings`.

**Normalize** (`packages/ingest/districts.ts`, new, pure, no I/O and no corpus import — the
`alliances.ts` contract): `normalizeDistricts(response)` and `normalizeDistrictRankings(response)`.
Both return `[]` for a null or empty body rather than throwing, and neither invents a value:
absent `official_advancement_counts` becomes `{ dcmpSlots: null, cmpSlots: null }`, and
`rookie_bonus` / `adjustments` pass through as sent.

**Ingest mode** (`packages/ingest/cli.ts`): add `--districts-only` alongside the existing
`--events-only` / `--media-only` / `--rankings-only` / `--alliances-only` flags, and an
`ingestSeasonDistrictsOnly(db, ctx, year, force)` that per season:
1. fetches `/districts/{year}` and upserts every district;
2. for each district, fetches `/district/{key}/rankings` and upserts every team row;
3. for each district, fetches `/district/{key}/events/keys` (authoritative membership), then
   `/event/{key}/teams/keys` for each of those events and upserts every registration row;
4. logs, per season, four counts: districts, ranking rows, district events, registration rows —
   and separately logs any district event key absent from the corpus `events` table, rather
   than dropping it silently.
Carry forward the `--rankings-only` caching rule verbatim in the mode's doc comment: a re-run
over an already-ingested season needs `--force`, because a cached-ETag 304 carries no body.

**package.json**: add `"ingest:districts": "tsx --env-file=.env packages/ingest/cli.ts --districts-only"`.

**Then run it for real** across 2019, 2020 and 2022-2026 and record the four per-season counts
in the SUMMARY. If the executing sandbox denies outbound network from Bash (a known constraint
on this machine), stop and hand the exact command back to the main context to run, rather than
marking the task done on unit tests alone.
  </action>
  <verify>
    <automated>npx vitest run packages/ingest/districts.test.ts packages/corpus/districts.test.ts</automated>
    <automated>npx tsx -e "import {openCorpusReadOnly} from './packages/corpus/db.ts'; const db=openCorpusReadOnly('data/corpus.sqlite'); for (const t of ['districts','district_rankings','event_teams']) { const n=db.prepare(\`SELECT COUNT(*) c FROM \${t}\`).get().c; console.log(t,n); if(n===0) throw new Error(t+' is empty'); }"</automated>
  </verify>
  <done>
- All three tables exist and hold rows for every ingested season.
- `pnpm ingest:districts --years 2026 --force` completes and prints the four per-season counts.
- Unit tests cover: a null rankings body normalizes to `[]`; a district with no
  `official_advancement_counts` normalizes to null slots (not zero); `event_points_raw` round-trips
  through the corpus byte-identically.
- Every district event key TBA reports is either found in the corpus `events` table or logged.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: District point model, lock math, and the published artifacts</name>
  <files>packages/core/districts/pointModel.ts, packages/core/districts/pointModel.test.ts, packages/core/districts/locks.ts, packages/core/districts/locks.test.ts, packages/core/districts/reconciliation.test.ts, packages/harness/pageArtifacts.ts, packages/harness/pageArtifacts.test.ts, scripts/publishDistricts.ts, scripts/publishDistricts.test.ts, package.json</files>
  <read_first>packages/harness/pageArtifacts.ts (lines 55-200, the key builders and preambles), scripts/publishAlgorithmsManifest.ts (script shape), packages/core/algorithms/sigma1/rp/reconciliation.test.ts (the corpus-scan reconciliation discipline this task copies)</read_first>
  <behavior>
`pointModel.ts`:
- `maxEventPoints(season, tier)` returns the per-component ceiling for one event, where
  `tier` is `"district"` or `"dcmp"`. Unknown season throws a named error rather than
  returning a guess.
- The `dcmp` tier's ceiling is the `district` tier's multiplied by the season's district
  championship weight (3 for every season in the corpus, confirmed against 2026fnc's live
  breakdown; declared per-season, not hardcoded once).
- `maxRookieBonus(season)` returns the once-per-season rookie bonus ceiling.

`locks.ts`, given `teams: [{ teamKey, pointTotal, maxRemaining }]` and `slots: number`:
- `floor(T) = T.pointTotal` (the worst case: T scores nothing more).
- `ceiling(R) = R.pointTotal + R.maxRemaining`.
- `threatCount(T) = count of R !== T where ceiling(R) >= floor(T)`. The comparison is
  `>=`, not `>`: a tie is settled by tiebreakers this model does not carry, so a tie must
  count as a possible loss.
- `status(T) === "locked"` exactly when `threatCount(T) < slots`.
- `status(T) === "eliminated"` exactly when `count of R !== T where floor(R) > ceiling(T)` is
  `>= slots`.
- Otherwise `status(T) === "contending"`.
- `pointsToLock(T)` is the smallest non-negative integer `d` such that T with
  `floor = pointTotal + d` would be locked. Zero when already locked. `null` when `d`
  exceeds `T.maxRemaining` — that is "not attainable this season", and it must not be
  reported as a reachable number.
- `slots` of `null` (TBA published no capacity) yields `status === "unknown"` and
  `pointsToLock === null` for every team. It never falls back to a guessed capacity.

Test cases to write first:
- 3 teams, 1 slot, leader's floor above every rival's ceiling -> leader locked, others eliminated.
- Exact tie between a rival's ceiling and the subject's floor -> subject NOT locked (the `>=` rule).
- A team whose `pointsToLock` exceeds its `maxRemaining` -> `null`, not a number.
- `slots: null` -> every team `unknown`.
- `slots` larger than the team count -> every team locked.
- A monotonicity property: adding points to one team never worsens that team's own status.
  </behavior>
  <action>
**`packages/core/districts/pointModel.ts`** — declare the FIRST district point model's
per-component maxima per season (`qual`, `alliance`, `elim`, `award`) for the regular district
tier, the district-championship weight, and the rookie bonus. Source them from the official
FIRST district point model for each season and cite the source in the doc comment. Seasons to
cover: 2019, 2020, 2022, 2023, 2024, 2025, 2026. Do not carry a wildcard default — an
unlisted season throws.

**`packages/core/districts/reconciliation.test.ts`** — this is the test that makes the word
"guaranteed" true. Open the corpus read-only, walk every `district_rankings.event_points_raw`
row across every ingested season, and assert each of the four components is at or below the
declared ceiling for that row's tier (`district_cmp` picks the tier). A violation fails with
the offending season, team key, event key, component name, observed value and declared
ceiling. Skip cleanly (do not fail) when the corpus file is absent, matching how the other
corpus-backed tests in this repo guard themselves.

**`packages/core/districts/locks.ts`** — the pure functions above. No corpus import, no I/O.
Compute `threatCount` against a pre-sorted rival ceiling array so the whole district is one
sort plus a scan, not a quadratic pairwise loop; FiM ships ~500 teams.

**`packages/harness/pageArtifacts.ts`** — add two exported key builders and two Zod schemas:

- `districtsIndexKey(year) -> "v1/districts/{year}.json"`
- `districtDetailKey(districtKey) -> "v1/district/{districtKey}.json"` (year-prefixed key)

Both are declared as their own exported functions and NOT added to `PageKind` /
`ArtifactKeyParams`. Write the reason into the doc comment: `PageKind` is the union the
Worker's live-write path (`apps/worker/src/artifactWriter.ts`'s exhaustive `SCHEMA_BY_PAGE`
record) and `publish.ts`'s per-season size budget are both keyed on, and district artifacts are
neither live-written by the Worker nor part of a per-season replay. They follow the
`v1/manifest/*.json` precedent — published keys that live outside `PageKind` on purpose.
Widening `PageKind` here would force a Worker change that buys nothing.

Schemas, both extending the existing `PagePreambleSchema`:
- `DistrictsIndexArtifactSchema`: `{ year, districts: [{ districtKey, abbreviation, displayName,
  dcmpSlots: number|null, cmpSlots: number|null, teamCount, eventCount }] }`.
- `DistrictArtifactSchema`: `{ districtKey, year, abbreviation, displayName, dcmpSlots, cmpSlots,
  teams: [{ teamKey, teamNumber, nickname, rank, pointTotal, rookieBonus, adjustments,
  eventPoints: [{ eventKey, eventName, week, tier, qual, alliance, elim, award, total }],
  remainingEvents: [{ eventKey, eventName, week, tier, maxPoints }],
  maxRemainingDistrict, maxRemainingChamp,
  districtLock: { status, pointsToLock, threatCount, cutLinePoints },
  champLock: { status, pointsToLock, threatCount, cutLinePoints } }],
  insights: { teamCount, eventCount, dcmpCutLinePoints, cmpCutLinePoints, districtLockedCount,
  districtEliminatedCount, champLockedCount, champEliminatedCount } }`.

**`scripts/publishDistricts.ts`** — a standalone publish tool shaped exactly like
`scripts/publishAlgorithmsManifest.ts`: `parseArgs` from `node:util`, `--years`, `--bucket`,
`--dry-run`, deep relative imports with `.js` extensions, `main()` guarded on being the process
entry point, `putObject` for the real write. It never reads, prints or interpolates `.env` —
`putObject` reads its own credentials from `process.env`, exactly as `publish.ts` does.

Per year it: reads districts and their ranking rows from the corpus; joins event metadata
(`name`, `week`, `event_type`) from the corpus `events` table; derives each team's remaining
events as `registered district events` minus `events already present in that team's
event_points`; computes `maxRemainingDistrict` (regular-tier events only) and
`maxRemainingChamp` (regular-tier events plus, for any team not already eliminated from the
DCMP, one dcmp-tier event) plus the rookie bonus where a team is a rookie that has not yet
received it; runs `computeLocks` twice — once with `dcmpSlots`, once with `cmpSlots`; records
`cutLinePoints` as the point total currently sitting at the slot-th rank; and writes both
artifacts.

Write the artifacts-before-index ordering the retune skill already establishes: every
`v1/district/{key}.json` lands before `v1/districts/{year}.json` is overwritten, so the index
never points at an object that is not there yet.

**package.json**: add `"publish:districts": "tsx --env-file=.env scripts/publishDistricts.ts --years 2019,2020,2022-2026"`.

Run the publish with `--dry-run` first and record each artifact's serialized byte size in the
SUMMARY — FiM is the largest district and the one that could push a single object past a
comfortable payload. If a real (non-dry) publish is needed and the sandbox denies network, hand
the command back to the main context.
  </action>
  <verify>
    <automated>npx vitest run packages/core/districts/ packages/harness/pageArtifacts.test.ts scripts/publishDistricts.test.ts</automated>
    <automated>npx tsx scripts/publishDistricts.ts --years 2026 --dry-run</automated>
  </verify>
  <done>
- `locks.ts` passes every behavior case above, including the tie case and the unattainable case.
- `reconciliation.test.ts` scans the real corpus and passes, proving no observed district point
  component exceeds the declared ceiling in any ingested season.
- `--dry-run` composes and validates both artifact kinds for 2026 against their Zod schemas and
  prints per-object byte sizes.
- `districtsIndexKey`/`districtDetailKey` are exported from `pageArtifacts.ts`; `PageKind` still
  names the same five page kinds it named before this task, and `apps/worker` needed no edit.
  </done>
</task>

<task type="auto">
  <name>Task 3: The /districts route, the fourth ribbon link, and the four tabs</name>
  <files>apps/web/src/lib/searchParams.ts, apps/web/src/lib/api/districts.ts, apps/web/src/routes/districts.tsx, apps/web/src/routes/districts.test.tsx, apps/web/src/routeTree.gen.ts, apps/web/src/components/ribbon/Ribbon.tsx, apps/web/src/components/ribbon/Ribbon.test.tsx, apps/web/src/components/districts/DistrictSelect.tsx, apps/web/src/components/districts/DistrictInsightsTab.tsx, apps/web/src/components/districts/DistrictBreakdownTab.tsx, apps/web/src/components/districts/DistrictLocksTab.tsx, apps/web/src/components/districts/DistrictLocksTab.test.tsx</files>
  <read_first>apps/web/src/routes/event.$eventKey.tsx (tab strip, resolveActiveTab, renderTabState), apps/web/src/lib/api/compare.ts (algorithm-independent fetcher), apps/web/src/lib/searchParams.ts, apps/web/src/components/ribbon/Ribbon.tsx, apps/web/src/lib/districtNames.ts</read_first>
  <action>
**Load `Skill("sketch-findings-sigmascout")` before writing any JSX in this task.** It carries the
decided palette, the uncertainty/interval display rules, and the chart-craft mechanics. The Pine
ribbon redesign is live: green is ink, not paint, and the ribbon has its own `--ribbon-*` token
vocabulary that page content never uses.

**Search params** (`apps/web/src/lib/searchParams.ts`): add
`DISTRICT_TABS = ["insights", "breakdown", "district-locks", "champ-locks"] as const`,
`DEFAULT_DISTRICT_TAB = "insights"`, and
`DistrictsSearchSchema = RootSearchSchema.extend({ district: z.string().optional(), tab: z.enum(DISTRICT_TABS).catch(DEFAULT_DISTRICT_TAB) })`.
Both `district` and `tab` are URL state so a district-and-tab view is shareable, exactly as
`?tab=` already is on the event and team pages.

**Fetchers** (`apps/web/src/lib/api/districts.ts`): mirror `compare.ts` — two fetchers, two
query-options factories, the same two named error classes from `./errors.js`, the same
`markArtifactParsed()` call after each Zod parse, the same five-levels-up import depth to
`packages/harness/pageArtifacts.js`. These artifacts carry no algorithm segment, so there is no
`useAlgorithmVersion` call and no `enabled` gate — restate that reasoning in the doc comment the
way `compare.ts` does, so nobody adds one back by symmetry.

**Ribbon** (`apps/web/src/components/ribbon/Ribbon.tsx`): add Districts as the FOURTH nav link,
appended after Compare, in `NAV_LINKS` and as a fourth explicit `<Link to="/districts">` in
`NavLinks()`. Keep the explicit-elements form and the `preserveSearch` updater — the existing doc
comment explains why a `.map()` over the tuple loses per-route overload resolution. Check the
mobile branch's second row still fits four links at the 390px width the Playwright local-phone
project uses; if it does not, shrink the gap rather than hiding a link.

**Route** (`apps/web/src/routes/districts.tsx`): `createFileRoute("/districts")` with
`validateSearch: DistrictsSearchSchema`. Fetch the index artifact for the ribbon's `year`. Render
`DistrictSelect` always. With no `?district=`, render an empty state prompting a selection — not a
silently auto-picked district. With a district selected, fetch its detail artifact and render the
tab strip using the same `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` primitives and the same
`REGISTERED_*_TABS` + `resolveActiveTab` + shared `renderTabState` branch order the event page
uses. Do not restate that branch order per tab.

**`DistrictSelect.tsx`**: a `Select` over the index artifact's districts, labelled with
`districtDisplayName(abbreviation)` (the existing map — a reader sees "FIRST NC", not "fnc").
Changing it navigates, updating `?district=` and preserving every other search param.

**`DistrictBreakdownTab.tsx`**: the standings table — rank, team, total, rookie bonus,
adjustments, and per-event columns broken out into qualification / alliance / playoff / award
points. This is the tab that makes "every source of district points" visible, so all four
components are individually readable, never collapsed into an event total alone.

**`DistrictLocksTab.tsx`**: one component, taking which lock to show (`"district"` or `"champ"`)
as a prop, rendered by both the District Locks and Champ Locks tabs. Per team: current points,
maximum still attainable, status, and the answer to the page's actual question — points still
needed to lock, or an explicit "no longer attainable" when `pointsToLock` is null. A `"unknown"`
status (TBA published no capacity for that district-year) renders as an honest "capacity not
published", never as a number. Show the capacity and the current cut line in the tab header.

Include the caveat line, plainly worded: a locked verdict is a guarantee; a team that is not
locked has not been eliminated, and declines and wildcards can only ever help. Follow the sketch
skill's plain-language-first rule and its "differences too small to call render as ties" habit.

**`DistrictInsightsTab.tsx`** (lean, per this plan's deferral list): team count, event count,
DCMP and Championship capacity, both current cut-line point totals, the locked / contending /
eliminated tallies for both locks, and a top-N table by district points. No charts.

**Regenerate `routeTree.gen.ts`** — it is a tracked, plugin-generated file; run the web build (or
dev server) so the new route is registered, and commit the regenerated output.

Tests: `districts.test.tsx` covers the no-district-selected empty state, that selecting a
district puts `?district=` in the URL, and that `?tab=champ-locks` opens the Champ Locks tab.
`DistrictLocksTab.test.tsx` covers a locked row, a contending row with a points-needed number, an
eliminated row, an unattainable row, and the unknown-capacity row. `Ribbon.test.tsx` gains the
fourth link.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/routes/districts.test.tsx apps/web/src/components/districts/ apps/web/src/components/ribbon/Ribbon.test.tsx</automated>
    <automated>pnpm --filter web run typecheck</automated>
  </verify>
  <done>
- A Districts link is the fourth item in the ribbon on every route and preserves year and algorithm.
- `/districts` with no selection shows a district picker and an empty state, not a fabricated default.
- `/districts?district=2026fnc&tab=champ-locks` deep-links directly to the Champ Locks tab.
- The Breakdown tab shows qualification, alliance, playoff and award points as separate readable
  values per event, plus rookie bonus and adjustments.
- Both Locks tabs show status, points-still-needed (or an explicit not-attainable), the capacity,
  the cut line, and the conservatism caveat.
- `routeTree.gen.ts` is regenerated and committed; web typecheck is clean.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>The Districts page, its four tabs, and the district lock math behind them.</what-built>
  <how-to-verify>
1. Start the dev server against local artifacts using the recipe in
   `project_local_visual_verification_recipe` — `VITE_ARTIFACT_ORIGIN=local` activates the `/v1`
   proxy (R2 CORS blocks localhost), and use a fresh port for each restart.
2. Confirm the ribbon now reads Teams / Events / Compare / Districts. Say so if you would rather
   have Districts sit between Events and Compare — it is a one-line reorder in `NAV_LINKS` and
   `NavLinks()`.
3. Open `/districts`, pick FIRST NC (2026), and walk all four tabs.
4. On Breakdown, spot-check one team's per-event qualification / alliance / playoff / award
   numbers against that team's page on thebluealliance.com.
5. On District Locks, check that the #1 team reads as locked and that a mid-table team shows a
   real points-still-needed number rather than a placeholder.
6. Switch to a district-year where TBA published no capacity, if one exists, and confirm it says
   capacity not published rather than showing a number.
7. Confirm the conservatism caveat reads clearly to someone who has never heard the phrase
   "mathematically eliminated".
  </how-to-verify>
  <resume-signal>Type "approved", or describe what is wrong.</resume-signal>
</task>

</tasks>

<verification>
- `npx vitest run packages/core/districts/ packages/ingest/districts.test.ts packages/corpus/districts.test.ts scripts/publishDistricts.test.ts` passes.
- `npx vitest run` from the repo root is no redder than it was before this plan started. Record
  the before-count and the after-count in the SUMMARY — the repo-root run covers ~167 files and
  is not the same set as an `apps/web`-scoped run.
- `pnpm --filter web run typecheck` is clean.
- The four `packages/core/algorithms/sigma1/` files carry no edits from this plan;
  `index.ts` and `params.ts` were already modified by an unrelated in-flight change and must be
  left exactly as found.
- `docs/publish-budget.md` is a manually transcribed document. If `publish:districts` is ever
  folded into the budget summary, transcribe by hand — it is never auto-written.
</verification>

<success_criteria>
- A user can pick a district and see, for any team, whether it is mathematically guaranteed a
  District Championship slot and a FIRST Championship slot, and how many more district points it
  needs to get there.
- Every number on the page traces to TBA's own published district point data or to the declared
  FIRST point model, and the ceiling used by the lock math is proven by a corpus-wide test to be
  at or above every value TBA has actually reported.
- Nothing in this plan consulted frclocks.com for a value.
</success_criteria>

<output>
Write the summary to
`.planning/quick/260905-lic-districts-page-as-fourth-ribbon-page-wit/260905-lic-SUMMARY.md`.
Note the deferrals from the context section explicitly, and record the ingest row counts, the
dry-run artifact byte sizes, and the before/after repo-root test counts.
</output>
