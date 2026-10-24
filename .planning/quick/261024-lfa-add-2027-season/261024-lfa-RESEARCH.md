# Quick Task 261024-lfa: 2027 onboarding inventory (research)

**Gathered:** 2026-10-24 by a read-only code sweep plus live TBA checks. Paths are repo-relative.
Line numbers were accurate on commit 6f8bcf61; re-verify before editing.

**Short version:** two game-dependent modules block simulations and Locks. The 2027 score-breakdown
component map and the 2027 RP rules module both have to exist first. Without the component map, the
publisher crashes as soon as it carries EPA into 2027, even with zero 2027 matches. Without the RP
module, no 2027 presim sidecar can be built, and the district bake and Locks rewind cannot run.
Jacob chose NOT to fill these with a copy of 2026 (see CONTEXT.md), so this task makes the publisher
and the web tolerate a season that has events and rosters but no rules, no matches and no state.

The web side needs a new "default season" constant, because today `CURRENT_SEASON` is both the
newest dropdown entry and the default.

## 0. Registries already known

- `apps/web/src/lib/seasons.ts:34` `FIRST_SEASON`, `:37` `CURRENT_SEASON=2026`, `:44`
  `EXCLUDED_SEASONS`, `:51` `SEASONS` (built descending from `CURRENT_SEASON`). Header `:13-18`
  states the publish-then-reveal rule.
- `apps/web/src/lib/searchParams.ts:21` `KNOWN_SEASONS`, `:53` `.catch(CURRENT_SEASON)`, `:184`
  `teamsSortKeyUniverse(alg, newYear)` (throws for 2027 via the component map).
- `packages/core/rankingPoints/rules.ts:41-52` `RP_RULE_MODULES`, `:55` registered list, `:60-67`
  throws for an unmapped season.
- `packages/core/algorithms/breakdown/index.ts:47-58` `SEASON_COMPONENT_MAPS`, `:70`
  `BREAKDOWN_REGISTERED_SEASONS`, `:79-87` throws.
- `package.json` `publish:seasons` / `publish:districts` lists `2016-2020,2022-2026`;
  `verify:district-bake` uses `2026-2026`.
- NOT in the tree any more: `packages/harness/promotedVersionPath.ts`, `paramSetsBySeason`,
  `resolveParamSets` (retired with Sigma1/VPR). SPR uses one frozen parameter set for every season
  (`packages/core/algorithms/spr.ts:182` `SPR_PARAMS`, `packages/spr/frozen-params.json`).

## 1. Per-season registries and dispatch tables

### A. Game-dependent (cannot be filled before January 2027; OUT OF SCOPE, listed so call sites can be found)

- RP rules loader: `packages/core/rankingPoints/rulesLoader.ts:14-25` `LOADERS` second literal
  list; `rulesLoader.test.ts:12` pins it equal to `RP_REGISTERED_SEASONS`.
- Phase grouping: `packages/core/algorithms/breakdown/groups.ts:85-140` `GROUPS_BY_SEASON`;
  `:144-151` returns `undefined`/`[]` for an unregistered season (safe).
- Call sites that THROW without a 2027 component map:
  - `packages/core/algorithms/epa.ts:1252` EPA season carry calls `componentMapForSeason(toSeason)`;
    reached from `packages/harness/publish.ts:2132-2136` for 2027 even with zero matches.
  - `epa.ts:915` the EPA update (needs a match, so not reached with zero matches).
  - `spr.ts:837` SPR display-only phase fold via `breakdown/index.ts:161` (first 2027 match with a
    breakdown; Worker included).
  - `packages/harness/metricDirection.ts:43`.
  - `apps/web/src/lib/metricKeys.ts:44`, reached from `teams-table/columns.tsx:173`,
    `team/SeasonHeader.tsx:104`, `team/EventSection.tsx:77`, `ribbon/AlgorithmSelect.tsx:127`,
    `searchParams.ts:184`.
- Web copies of the RP registry: `apps/web/src/lib/bonusRp.ts:31-71` `BONUS_RP_BY_SEASON` (pinned by
  `bonusRp.test.ts:34`; `:74` returns `[]` for unknown); `apps/web/src/components/districts/asOfRewind.ts:614`
  `AS_OF_PRICEABLE_SEASONS` (pinned by `asOfRewind.test.ts:389`; gates `simulationAsOf.ts:100`,
  `asOfRewind.ts:629,655`).
- Golden files `packages/core/rankingPoints/analyticPmfGolden.json`, `predictThresholdsGolden.json`
  (`pnpm rp:golden`) only change when a season is registered. Not touched here.

### B. District and Champ rules (also out of scope; call sites matter)

- District point ceilings: `packages/core/districts/pointModel.ts:73-84` `DISTRICT_BASE_MAXIMA`,
  `:92-103` `DCMP_WEIGHT`, `:106` `DISTRICT_REGISTERED_SEASONS`. Throw sites: `qualPoints.ts:136-140`,
  `bracket.ts:327,384,429`, `selectionPoints.ts:112`, `categoryCorroboration.ts:216,255,265`,
  `ledgerSimulation.ts:1311`, `harness/districtBake.ts:395`,
  `harness/districtRankingsMerge.ts:347,372,500,991,1413` (Worker path),
  `scripts/publishDistricts.ts:436-437`; web `champLedgerRows.ts:792`,
  `champLedgerStatus.ts:761,902,944`, `districtLedgerRows.ts:2075`, `districtLedgerStatus.ts:454`.
  `hypotheticalDcmp.ts:167` returns `undefined` (safe).
- Bracket and pay rule: `bracket.ts:245` `BRACKET_REGISTERED_SEASONS=[2023..2026]`;
  `securedPlayoffPoints.ts:183-188` `PLAYOFF_PAY_RULE_BY_SEASON` (header `:166-181`: read the 2027
  manual first). Web gates: `districtLedgerOutcomes.ts:623`, `districtLedgerRows.ts:1613`,
  `districtMilestones.ts:114`, `districtTimeline.ts:361`.
- Prequalified: `prequalified.ts:87,90-96,113-182`; missing 2027 gives an empty set (safe).
- Award slate: `awardSlate.ts:222-233` `SEASON_AWARD_TYPES` (declared list, generated from awards
  given); `:236-413`, `:414-692` generated tables (`scripts/measureAwardSlate.ts`,
  `SLATE_REGISTERED_SEASONS` `:331`); `:87` `DISTRICT_AWARD_MODEL_VERSION`; digest pinned at
  `awardModelVersion.test.ts:24`. Consumers: `dcmpAwardSlate.ts:140` (throws),
  `dcmpAwardEligibility.ts:106`, `publishDistricts.ts:1477` (skips the bake). `awardSlate.ts:750`
  `hasAwardSlateTables` degrades quietly.
- Other: `qualification.ts:150` `SPECIAL_ALLOCATION_DISTRICTS` keyed by district-year;
  `packages/harness/statbotics.ts:66,148` fallbacks (scripts only); `packages/spr/cli.ts:11` research only.
- Already populated for 2027: `pickPositionTables.ts:47-52` (`pickDraft.ts:52-58` picks the greatest
  key at or below the season); `champCutoffTuning.generated.ts:19`; `hypotheticalDcmp.ts:552-558`
  falls back to the latest; `scripts/measureChampCutoff.ts:116` `TUNING_SEASONS` includes 2027.
- No code table for championship structure: Champ/DCMP slots come from TBA
  `official_advancement_counts` (`packages/ingest/districts.ts:24-25,38`); null means 0 reserved
  (`districtRankingsMerge.ts:1101`). Divisions come from event data.
- Event-type tiers are keyed by event type, not season (`rankingPoints/constants.ts:90`,
  `algorithms/eventTypes.ts:27-44`). No week calendars, no per-season score constants.
- Priors for a new season: season boundaries are positional (`packages/harness/seasonBoundary.ts:59`);
  SPR carry `spr.ts:937-990` is game-independent; EPA carry `epa.ts:1232-1300` needs the component
  map and rescales on week 1 (`stateSnapshot.ts:254` `carryPending`); OPR has no carry (`opr.ts:87`);
  Sigma carry `harness/sigmaCarry.ts` generic; RP cold prior needs a rule module and
  `SigmaScoutLayer` accepts `undefined` (`sigmaScoutLayer.ts:125`).
- Presim: `packages/harness/publish.ts:178` `DEFAULT_PRESCHEDULE_FROM_SEASON=2026` (fallback only;
  package.json passes 2016); gate at `:2109`.

## 2. Ingest path

- Entry `packages/ingest/cli.ts`: `--year 2027` or `--years 2027-2027` (`:181-191`, range only).
- Plain ingest (`:344-399`) fetches `/teams/2027`, `/events/2027`, each event's `/matches`; an empty
  match list parses (`schemas.ts:107`).
- Rosters need separate passes: `--event-teams-only` (`:974`, all official events) and
  `--districts-only` (`:739`: district rankings, district event lists, `event_teams`, awards,
  champ/DCMP slots). Rankings, alliances, awards use nullable schemas (`schemas.ts:245,305,314,356`).
- Nothing in ingest requires matches.
- `event_teams` is upsert-only (`packages/corpus/db.ts:1394-1401`): withdrawn teams are never
  removed, so rosters go stale between now and March.
- `scripts/rebaseline.ts:45` `INGEST_PASSES` lacks `--districts-only`; `:170` `--year` defaults to
  the clock year (2026 until January 1).
- Match-dependent lookups that leave 2027 empty: `selectTeamKeysForYear` (`db.ts:1191-1210`, team
  `activeYears` from matches, so team pages exclude 2027); `selectCorpusSeasons` (`db.ts:1608-1618`,
  official matches only, so 2027 is not a corpus season).

## 3. Publisher

- `package.json`: `publish:seasons`, `publish:districts` say `2016-2020,2022-2026`;
  `verify:district-bake` uses 2026. Tests reading the `--seasons` value: `publish.test.ts:4890`
  (equality) and `:4900` (presim tripwire).
- `packages/harness/publish.ts`:
  - `:2083-2085` season team list built from matches only: for 2027 an empty Teams list, no team
    pages, empty season-final metrics (`:2442`), event standings with no ratings (`:1602-1614`);
    events-list `teamCount` comes from matches so reads 0 (`:2411`).
  - `:2132-2136` season carry runs for every algorithm; EPA throws for 2027.
  - `:2149`, `:2246` `RP_RULE_MODULES[2027]` undefined; layer has no RP; SPR and EPA sidecars null
    (`preSchedule.ts:374-378`).
  - `:1435-1518` zero-match events already handled (priced from season-final state with the
    registered roster; roster bound `:1448`).
  - `:2597-2604` events with only a roster or only a probe window still get an event artifact.
  - `:2813-2826` as-of start object written even with no matches.
  - `:2832` + `score.ts:279-286` Week-0-only season throws in `aggregateScores` (February 2027 risk).
  - `:2846-2875` the FINAL season of the run seeds D1. The seed must stay the 2026 state (CONTEXT.md).
  - `:1878` cancelled-event detection is fine for future events.
- Probe windows: `packages/harness/manifests.ts:73-97` `probeWindowFor` (12 h before start to
  +4 days for zero-match events); builder `:192-238` uses the run's seasons.
  `scripts/publishLiveWindows.ts:58` `DEFAULT_LIVE_WINDOWS_SEASONS` literal `"2016-2020,2022-2026"`
  pinned to package.json by `publishLiveWindows.test.ts:252`; `scripts/pruneCancelledEvents.ts:60`
  reuses it. `scripts/publishProbeStubs.ts:75` defaults to the clock year and copies tier cuts from
  a played event of the same season, so it refuses 2027.
- `scripts/publishDistricts.ts`: `:228` warmup from 2016, `:1392-1394` warmup loop; `:655-736`
  district teams from `district_rankings` (null for 2027 today); `:1355` no bake when nothing is
  eligible; `scripts/districtPricingState.ts:395,415` no RP module means null priced schedules.

## 4. Worker (`apps/worker`)

- No season literals in `src/` (only `wrangler.toml:17`). Season comes from the manifest window
  (`scheduled.ts:1232`, `:1260`).
- RP looked up by index, so 2027 means "no RP", not a crash: `scheduled.ts:570`,
  `artifactMerge.ts:126`, `lateBreakdownBackfill.ts:89`; `upcomingPricing.ts:147` guards season.
- The Worker never runs a season carry; it resumes the D1 state the publisher seeded
  (`scheduled.ts:534-575`). If D1 holds the 2026 final state, a 2027 match would fold into it with
  no boundary and EPA would parse 2027 breakdowns with the 2026 map (`epa.ts:903`). Hence the guard
  in CONTEXT.md: never promote a 2027 event while 2027 has no registered rules.
- District pass: `districtRankingsMerge` calls the point model (and `prequalifiedTeams` `:1100`),
  so a 2027 district would fail, counted as `districtsFailed` (`districtRefresh.ts:593-681`).
- Tier cuts carried from the published artifact, never recomputed (`artifactMerge.ts:301-307,676-684`).
- Clock-year logic: `champReservedSlots.ts:169`, `dcmpFieldProof.ts:295`,
  `districtRankingsMerge.ts:1010` treat 2027 as current on 2027-01-01 (2026 flips to "season over").

## 5. Tests

Equality pins (fail loudly on a registry edit; only those touched by THIS scope matter):
- `packages/harness/publish.test.ts:4890` (publish:seasons list), `scripts/publishLiveWindows.test.ts:252`
- `apps/web/src/lib/api/compare.test.ts:83`; `apps/web/src/routes/methodology.compare.test.tsx:164`
  (`toHaveLength(10)`), fixture imports `:55-64`
- `apps/web/src/lib/metricKeys.test.ts:62` (`SEASONS[0]===CURRENT_SEASON`, conflicts with "2027
  listed, 2026 default"), `:84-86` and `:36` (every `SEASONS` entry must resolve a component map)
- Registry pins NOT touched by this scope (no 2027 entry is added): `breakdown/groups.test.ts:13`,
  `rankingPoints/rules.test.ts:43`, `rulesLoader.test.ts:12`, `districts/pointModel.test.ts:37`,
  `bracket.test.ts:283`, `pointPool.test.ts:414`, `awardSlate.test.ts:95,117,118`,
  `dcmpAwardSlate.test.ts:91`, `awardModelVersion.test.ts:24`, `analyticPmfGolden.test.ts:57`,
  `scripts/measureAwardSlate.test.ts:230`, `asOfRewind.test.ts:389`, `bonusRp.test.ts:34`.
- Tests that use 2027 as the canonical "not registered" season (must stay true): `pointModel.test.ts:33`,
  `qualPoints.test.ts:138`, `securedPlayoffPoints.test.ts:92,229`, `bracket.test.ts:278`,
  `awardSlate.test.ts:100,438`, `asOfRewind.test.ts:385-386,644`, `districtLedgerRows.test.ts:3227`,
  `scripts/simulationAsOfWeb.test.ts:239`.

Hardcoded iteration lists (silently skip 2027): `epaWeekOne.test.ts:91`,
`empiricalMoments.test.ts:146`, `rules.test.ts:35`, `packages/ingest/corpusCensus.test.ts:33` (and
its 634 bound), `packages/ingest/rankingsLive.test.ts:59`, `scripts/measureAwardSlate.test.ts:112`,
`scripts/measureRpCalibration.test.ts:974,1000`, `apps/web/src/routes/methodology.epa-vs-statbotics.test.tsx:29`,
`publish.test.ts:5544`. Relevant now only where the list is a SITE season list (events/dropdown);
algorithm-season lists legitimately exclude 2027 until January.

Web tests that assume the default year: `apps/web/src/lib/searchParams.test.ts:72,108,141,146-147`,
`apps/web/src/routes/__root.test.tsx:35,44,45,53`, `apps/web/src/routes/teams.test.tsx:306,346,363`
(literal 2026; still valid), `YearSelect.test.tsx:89,123,170` (driven by `SEASONS`).

E2E: no spec relies on the default year; `apps/web/e2e/compare-narrow-legibility.spec.ts:33` loads
`/methodology/compare` and so fetches every Compare season (Compare must not include 2027).

## 6. Docs that go stale

`.planning/PROJECT.md:56` ("the 2026 season is complete") and `:72`; `apps/web/src/lib/seasons.ts:13-18,36`;
`apps/web/src/lib/api/compare.ts:55-57`; `docs/publish-budget.md:213,238-250,593`;
`docs/worker-operations.md:780` ("all ten seasons"), `:1375`, `:1401`; `apps/worker/src/districtRefresh.ts:261`;
`docs/models/epa-vs-statbotics.md:638`, `epa-statbotics-gap.md:44`; methodology copy
`districtLedgerContent.ts:192` ("ten seasons"), `awardsContent.ts:49,209` ("covers 2023 to 2026", still
true); comments `pointModel.ts:11`, `statbotics.ts:50,210`, `packages/ingest/cli.ts` header;
`.planning/research/PITFALLS.md:107`.

## 7. Placeholder mechanisms and existing 2027 notes

- No placeholder or alias mechanism exists; RP rules and the component map throw by design
  (`rules.ts:59`, `breakdown/index.ts:74-87,137-141`); the award slate says "never a borrowed season"
  (`awardSlate.ts:739`, `dcmpAwardSlate.ts:139`). Jacob confirmed this stays.
- Quiet-degrade paths: indexed `RP_RULE_MODULES[...]` lookups (`epa.ts:423`, `publish.ts:2246`,
  Worker), `rulesLoader.ts:36`, `bonusRp.ts:74`, `groups.ts:144`, `securedPlayoffPoints.ts:191`,
  `awardSlate.ts:750`, `sigmaScoutLayer.ts:125`.
- Existing 2027 notes: `.planning/todos/pending/locks-first-live-2027-watch.md` items 8 and 11;
  `champ-locks-dcmp-sim-gaps.md`; `weighted-pick-draft-follow-ups.md` item 1;
  `presim-sidecars-worker-threads.md`; `.planning/triage-2026-09-12.md:119`.

## Live TBA facts (2026-10-24)

- `/events/2027`: 216 events. event_type counts: 0 (regional) 61, 1 (district) 129, 2 (DCMP) 14,
  5 (DCMP division) 10, 99 (offseason) 1, 100 (preseason) 1. No type 3/4 (championship).
  Official dates 2027-02-28 to 2027-04-16.
- Districts `/districts/2027`: ca, fch, fim, fin, fit, fma, fnc, fsc, isr, ne, ont, pch, pnw, tx,
  win (15; note BOTH `2027fit` and `2027tx` exist while 2026 used only `tx`; `2027cancmp` is absent
  while `2027cascmp` exists).
- `/district/2027fim/rankings` is `null`; `/district/2027fim/advancement` is `{teams:null,cutoffs:null}`;
  `/district/2027fim/teams/keys` has 515 teams; `/district/2027fnc/teams/keys` 104.
- Event rosters are partial: `2027abca` 21 teams, `2027caasv` 23, `2027micmp` 0.
- `frc254` is registered for `2027caetb` and `2027casnf`.

## Checklist from the last onboarding (2019/2020 and 2016 to 2018 backfills)

1. Ingest the season, then the rankings, districts, event-teams, awards and teams passes; check the
   census bounds (`corpusCensus.test.ts`).
2. (Skipped here: recon probes, breakdown/RP modules, registries, district ceilings; January work.)
3. Add the season to the publish lists, publish, read the artifacts back from the live origin by
   content.
4. Only then move the `seasons.ts` bound: publish first, reveal after.
5. Known trap: hardcoded iteration lists in tests pass silently; equality pins fail loudly.

## Hardest blockers for THIS scope (zero matches, no rules)

1. `publish.ts:2132-2136` EPA carry throws for 2027: the publisher needs a "roster-only season"
   path that skips carry, replay, sidecars, seed and team pages, and still writes the events list,
   event artifacts (roster, name, dates, week, district) and whatever manifest entries list them.
2. The D1 seed must come from 2026 even if 2027 is in the run (or 2027 is published by a separate
   invocation that never seeds).
3. Events list `teamCount` and event-page roster for a no-match event must come from `event_teams`.
4. Web: `DEFAULT_SEASON` vs `CURRENT_SEASON`; `metricKeys`/`teamsSortKeyUniverse`/Compare must
   tolerate a listed season with no component map and no algorithm artifacts; `KNOWN_SEASONS`.
5. Live windows: 2027 probe windows need the Worker guard (no promotion without registered rules)
   or must stay out of the manifest.
6. Release recipe for Jacob: ideally a 2027-only write that does not touch D1 or freeze live
   folding; verify how artifact keys and the manifests are generation-scoped before promising that.
