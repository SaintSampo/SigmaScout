---
phase: quick-261014-mii
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/scoreAwardModel.ts
  - scripts/scoreAwardModel.test.ts
  - packages/core/districts/awardBaseRates.ts
  - packages/core/districts/awardBaseRates.test.ts
  - packages/core/districts/awardOrderingTables.ts
  - packages/core/districts/awardOrderingTables.test.ts
  - packages/core/districts/dcmpAwardSlate.ts
  - packages/core/districts/dcmpAwardSlate.test.ts
  - packages/core/districts/ledgerSimulation.test.ts
  - packages/core/districts/awardModelVersion.test.ts
  - scripts/measureDistrictAwardBaseRates.ts
  - scripts/measureDistrictAwardBaseRates.test.ts
  - scripts/measureAwardOrderingTables.ts
  - scripts/measureAwardOrderingTables.test.ts
  - scripts/measureDcmpAwardSlate.ts
  - scripts/measureDcmpAwardSlate.test.ts
  - scripts/publishDistricts.ts
  - scripts/publishDistricts.test.ts
  - packages/harness/pageArtifacts.ts
  - packages/harness/pageArtifacts.test.ts
  - apps/web/src/components/methodology/districtLedgerContent.ts
  - apps/web/src/components/methodology/districtLedgerContent.test.ts
  - apps/web/src/components/methodology/awardsContent.ts
  - apps/web/src/components/methodology/awardsContent.test.ts
  - .planning/quick/261014-mii-district-award-odds-decoration-drift-sta/261014-mii-before-snapshot.json
  - .planning/quick/261014-mii-district-award-odds-decoration-drift-sta/261014-mii-after-snapshot.json
autonomous: true
requirements:
  - MII-P1-decoration-drift
  - MII-P2-stacked-awards-sold-as-impact
  - MII-P3-individual-awards-counted-as-judged

estimate:
  tokens: 210000
  raw_tokens: 420000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "A team's decoration count (published as priorJudgedAwards) counts only the 18 award types that pay district points (M-01), distinct per season, event and type, won in the three award seasons before the priced season (M-03); it is undefined before 2019 and 2021 is never a slot"
    - "A team's prior Impact count (published as priorImpactWins) uses the same three season window (M-05)"
    - "No committed district pmf prices a stack: every base rate pmf has zero mass at 13 and 15+, every residual pmf has zero mass at 10, 13 and 15+, so the drawer's Impact row equals the Impact draw itself (M-06)"
    - "Walk forward 2023 to 2026, the district any award Brier is below the BEFORE value and the said vs happened gap shrinks in each of the four review classes, while both DCMP gates still pass, or nothing that changes shipped odds was committed (A1 to A5)"
    - "District artifacts publish award profiles for every season with a complete window (2019 on) and stamp awardModelVersion 2.0.0; award table blocks only for registered seasons (2023 to 2026) (M-07, M-08)"
    - "No award prediction reaches locks.ts or moves a Locked or Locked out verdict"
    - "The methodology pages describe the shipped award model, and every figure they quote comes from the AFTER run"
  artifacts:
    - path: packages/core/districts/awardBaseRates.ts
      provides: "DISTRICT_POINT_AWARD_VALUES positive list, DECORATION_LOOKBACK_SEASONS, highestSingleAwardPoints, DISTRICT_AWARD_MODEL_VERSION, re-measured base rate literals"
    - path: scripts/measureDistrictAwardBaseRates.ts
      provides: "decorationWindow, windowed priorJudgedAwardCount, composition based outcome measurement, district point award census"
    - path: scripts/measureAwardOrderingTables.ts
      provides: "windowed priorImpactWinCount, highest single residual"
    - path: packages/core/districts/awardOrderingTables.ts
      provides: "re-measured Impact, Rookie All Star and residual literals"
    - path: packages/core/districts/dcmpAwardSlate.ts
      provides: "re-measured DCMP lift literals"
    - path: scripts/scoreAwardModel.ts
      provides: "snapshot write and read, Impact row audit, review class view, reliability bins, district acceptance gates"
    - path: packages/core/districts/awardModelVersion.test.ts
      provides: "digest of every award table pinned to DISTRICT_AWARD_MODEL_VERSION"
    - path: .planning/quick/261014-mii-district-award-odds-decoration-drift-sta/261014-mii-before-snapshot.json
      provides: "BEFORE scores the acceptance gates read"
  key_links:
    - from: scripts/scoreAwardModel.ts
      to: scripts/measureDistrictAwardBaseRates.ts
      via: "priorJudgedAwardCount and priorImpactWinCount build the scored profiles, so the scorer scores the new definition with no copy"
      pattern: "priorJudgedAwardCount"
    - from: scripts/publishDistricts.ts
      to: scripts/measureDistrictAwardBaseRates.ts
      via: "the published counts come from the same windowed helpers the tables were measured with"
      pattern: "priorJudgedAwardCount|priorImpactWinCount"
    - from: packages/core/districts/ledgerSimulation.ts
      to: packages/core/districts/awardOrderingTables.ts
      via: "the browser prices from bundled tables keyed by the published counts; tables and counts must share one definition"
      pattern: "awardResidualRate|impactOrderingProbability"
---

<objective>
Fix the three district tier award problems the 2026-10-14 review found, without moving the DCMP fix that landed in 261014-i8i (pushed 4337d8d2):

1. Decoration drift: the prior award counts reach back to the corpus start, so "none" meant three years of history in 2019 and nine in 2026, and the tables pool both.
2. Stacked awards sold as Impact: two 5 point awards at one district event (planner census: 168 team events, 2016 to 2020, 158 of them with the Safety Award; none since 2022) sit in the 10 point bin, and the drawer's Impact row prices them as Impact.
3. Individual awards counted as judged awards: the {1, 2, 14} exclusion set counts Dean's List, Woodie Flowers, Volunteer of the Year, Wildcard and Impact Finalist as team decorations.

Purpose: the district award cell is the only award prediction a reader plans around, and the review showed it compressed (undecorated said 19.9% vs 11.9%). The fix must be a principled feature definition fixed BEFORE any scoring, accepted or rejected on pre-registered bars, never tuned against 2023 to 2026.

Output: a scorer that judges the change against a committed BEFORE snapshot; re-measured base rate, ordering, residual and DCMP slate tables under one definition; a publisher that writes matching counts with a model version stamp; methodology copy that matches what ships.

Shape: three sequential tasks in one plan, in the order the orchestrator fixed (BEFORE snapshot and additive definitions, then switch and re-measure with the acceptance run, then publisher, versioning and copy). The tracer first default is set aside on purpose: the architecture is the existing measurement pipeline, and re-measurement must not begin until the BEFORE snapshot is committed.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@.planning/STATE.md
@.planning/quick/261014-i8i-dcmp-award-pricing-eligibility-dcmp-rate/261014-i8i-SUMMARY.md
@scripts/scoreAwardModel.ts
@scripts/measureDistrictAwardBaseRates.ts
@packages/core/districts/awardBaseRates.ts
@packages/core/districts/awardOrderingTables.ts

<pre_registered_decisions>
Every decision below is fixed now, before any scoring. None of them may be changed in response to a score. (M ids are this plan's own decision ids; cite them in commits.)

M-01 THE AWARD LIST (problem 3). A decoration is a TEAM award that pays district points. Replace the {1, 2, 14} exclusion set export in `packages/core/districts/awardBaseRates.ts` (~L104) with a POSITIVE map, `DISTRICT_POINT_AWARD_VALUES` (award type to the district points it pays at a district event, before the tier weight), asserted by equality in a test:
- 10 points: 0 Impact (Chairman's before 2022).
- 8 points: 9 Engineering Inspiration, 10 Rookie All Star.
- 5 points: 11 Gracious Professionalism, 13 Judges', 15 Rookie Inspiration, 16 Industrial Design, 17 Quality, 18 Safety (paid at district events 2016 to 2020), 20 Creativity, 21 Excellence in Engineering, 22 Entrepreneurship, 27 Imagery, 29 Innovation in Control, 30 Team Spirit, 71 Autonomous, 82 Team Sustainability, 83 Rising All Star.
- NOT a decoration, seen at district tier events and paying 0 there: 1 Winner, 2 Finalist, 4 Dean's List Finalist and Semi Finalist, 5 Volunteer of the Year, 14 Highest Rookie Seed.
- NOT a decoration, never seen at a district tier event (no district points): 3 Woodie Flowers Finalist, 6 Volunteer Award, 8 Appreciation, 23 Design Excellence, 28 Pitch Perfect, 31 and 51 Community Catalyst, 39 Number 1 Seed, 40 Best Scoring, 49 Against All Odds, 54 Forte Teleop, 60 Community Member, 63 Play of the Day, 64 Programming, 65 Professionalism, 67 Most Improved Team, 68 Wildcard, 69 Impact Finalist, 70 Community Engagement, 74 and 75 Human Match Winner and Finalist, 77 Engineering Design, 79 Fathom Award for End Game.
Planner census (2026-10-14, data/corpus.sqlite, informational only; the executor reproduces it in code): every listed type appears as a team's only award at a district tier event with exactly its listed value (at least 103 such team events each), and summing the listed values over a team's distinct award types reproduces the recorded `award_points` for all 29,871 district tier team events at events with award rows, 2016 to 2026, with 0 mismatches. Why a positive list: a new award type FIRST adds is then excluded until someone shows it pays points, instead of silently counting because nobody added it to an exclusion set.

M-02 WHAT IS COUNTED. Unchanged distinctness: one decoration per distinct (season, event, award type), won by the team at any event in the corpus (district, DCMP, regional, Championship, as today). Only the type set (M-01) and the seasons (M-03) change.

M-03 THE WINDOW (problem 1). `DECORATION_LOOKBACK_SEASONS = 3`. The window for a season Y is the three latest AWARD SEASONS strictly before Y, where the award seasons are exactly `DISTRICT_REGISTERED_SEASONS` (2016 to 2020 and 2022 to 2026).
- 2021 is not an award season (no in person events; the corpus holds no 2021 award rows), so a window steps over it instead of spending a slot on an empty year: 2022 reads 2018, 2019, 2020; 2023 reads 2019, 2020, 2022.
- 2020 IS an award season and fills one full slot with the awards it actually gave (its week 1 to 3 events and the awards cancelled events judged remotely), neither scaled nor skipped. Scaling would invent awards, skipping would drop real ones, and either needs a hand judgment of how complete 2020 was that no committed list makes.
- A window is COMPLETE only when three award seasons exist before Y in the corpus, so 2019 is the first season with a complete window; 2016, 2017 and 2018 have none.
- Why three: it is the LONGEST window such that every priced season (2023 to 2026) and every season their tables are fit on has a complete window, while the 2023 table still has the three training seasons the unchanged registration bar requires (2019, 2020, 2022). A four season window leaves 2023 two complete training seasons and no table; a shorter one throws away history every priced season has. It also gives the unchanged bucket edges a plain reading: three or more means about one award a season.

M-04 COMPLETENESS GATES TRAINING. A team event (or DCMP championship) from a season without a complete window never enters any table: base rates, ordering, residual, or DCMP slate lifts. The registration bar is unchanged (`MIN_PRIOR_DISTRICT_SEASONS = 3`), now counted in prior seasons WITH a complete window. Consequence, stated: base rate and ordering tables register 2023 to 2026 only (2019, 2020 and 2022 lose theirs). Pre 2023 seasons price no district award cell anyway (`simulateDistrictEvent` refuses every season outside the 2023 to 2026 brackets). The DCMP slate stays registered 2023 to 2026 by its own pinned list; its lifts fit only on 2019 on championships; its judged anchors and its 2016 on census read every season as today.

M-05 THE IMPACT COUNT. `priorImpactWinCount` uses the same window: distinct (season, event) wins of type 0 in the M-03 window. One window for both ordering keys.

M-06 THE STACK FIX (problem 2). Jacob's 2026-09-25 rule is that two awards are never a predicted outcome and a stack folds onto its highest single award. The shipped fold applies that rule by POINT VALUE, and 10 is ambiguous: it is Impact alone or two 5 point awards. Fix it at the source: every measured outcome is the team event's HIGHEST SINGLE AWARD, read from its award rows with the M-01 values, instead of the summed `award_points`.
- Base rates: outcome = highest single M-01 award the team won at the event (0, 5, 8 or 10). Bins 13 and 15+ are then empty by construction and 10 means Impact only.
- Ordering residual: outcome = highest single M-01 award excluding Impact (0) and Rookie All Star (10): 0, 5 or 8. A 5 plus 5 stack is one 5; EI plus a 5 is 8.
- Cross check: for every measured team event the sum of its M-01 values must equal its recorded `award_points`; the scripts print a mismatch census and the corpus test asserts 0. A team event at an event with no award rows is excluded and censused (expected 0).
- Why fold rather than drop the retired award stacks: the team really won a judged award, so dropping it would erase a real outcome and bias the any award rate down; and a retired award list is one more hand list to maintain. `AWARD_POINT_SUPPORT` and the wire shape stay unchanged (the empty bins carry 0), and `foldStackedAwardPoints` stays as the guard for composed draws.
- The any award chance is unchanged by this fix (an award is an award); only the Impact row loses the stack mass, which moves to the one judged award row.

M-07 PUBLISHED PROFILES. The publisher publishes an award profile for every season with a complete window whose window seasons all have award rows ingested (2019 on), whether or not a table is registered, so 2019 to 2022 artifacts keep the rookie flag the Champ Locks award draws read. Award table blocks are published only for registered seasons (2023 to 2026), as today. 2016 to 2018 publish no profile, as today.

M-08 VERSIONING. Findings (verified while planning): `v1/district/{key}.json` and its presim sidecars are UNVERSIONED keys, overwritten by every publish and by the Worker's live refresh; the preamble carries the global `schemaVersion` 1 (bumping it would invalidate every artifact of every kind) and a per run `generation`; the award blocks carry only `script` and `measuredThroughSeason`; sidecars carry the match model's `algorithmId@algorithmVersion`, not the award model's. No award model version exists. This task CREATES one: `DISTRICT_AWARD_MODEL_VERSION = "2.0.0"` in `awardBaseRates.ts` (an artifact without the stamp is the model before this task), a new optional top level `awardModelVersion` on `DistrictArtifactSchema`, written by the publisher whenever it writes profiles, and a test that pins a digest of every award table and the M-01 and M-03 definitions to that version, so a future table change without a version bump turns red. No web pairing guard is added (see the threat register).

M-09 THE REVIEW CLASS VIEW. The acceptance compares the four classes the review reported. To compare the same team events BEFORE and AFTER, the scorer labels each scored team event with a frozen, report only copy of the review's rule (all prior corpus seasons, every type except {1, 2, 14}), named `LEGACY_REVIEW_EXCLUDED_TYPES` and `legacyReviewClass`. It never prices anything. The new definition's own classes are reported beside it for information.
</pre_registered_decisions>

<pre_registered_acceptance>
Fixed before any scoring. Evaluated by `npx tsx scripts/scoreAwardModel.ts --before <BEFORE snapshot>` on the AFTER tables, walk forward 2023 to 2026, exact odds.
- A1 District any award Brier AFTER is strictly lower than BEFORE (review: 0.2039; exact value from the snapshot).
- A2 In each of the four review classes (three or more; one or two; none; none rookie) under the M-09 view, |said minus happened| AFTER is strictly smaller than BEFORE (review gaps 0.8, 8.5, 8.0, 4.7 points), and each class's n AFTER equals its n BEFORE (same team events; a different n makes the comparison invalid and is a FAIL).
- A3 District Impact row: the sum of p10 (what the drawer's Impact row shows) minus the sum of the Impact draw itself is 0 within 1e-9 over district team events. Both sums and the real district Impact wins are reported BEFORE and AFTER.
- A4 DCMP any award Brier below its flat guess at the observed rate.
- A5 Impact, Engineering Inspiration and Rookie All Star mass on ineligible DCMP team events exactly 0.
- A6 Recorded, not gated: BEFORE district digest must equal 494ac134703547235b1a049ef9ff8e9983af3e508a6672accc605a5d48e45d65 (Task 1 changes no odds); the AFTER digest differs by design and is recorded as the new expected digest.
FAILURE PROTOCOL: if any of A1 to A5 FAILS, do not change any window, list, fold or threshold against 2023 to 2026. Save the working tree diff and both scorer outputs outside the repo, restore the touched files, commit nothing that changes shipped odds, and return BLOCKED with both outputs so the main context can ask Jacob.
</pre_registered_acceptance>

<caller_inventory>
Every caller of the counting helpers, of the {1, 2, 14} exclusion set, and of the decoration keyed tables, with its decision. Deleting the exclusion set export makes every missed importer a compile error, so no caller can migrate silently.
| Caller | Uses | Moves? |
|---|---|---|
| scripts/measureDistrictAwardBaseRates.ts | defines priorJudgedAwardCount (~L136), exclusion set | YES: M-01, M-03, M-04, M-06 (Task 2) |
| scripts/measureAwardOrderingTables.ts | defines priorAwardTypeCount and priorImpactWinCount (~L246 to L270), exclusion set in indexSeasonAwards (~L478), residualAwardPoints (~L230) | YES: M-01, M-03 to M-06 (Task 2) |
| scripts/measureDcmpAwardSlate.ts | priorCountsAt (~L190), lifts keyed by decorationBucket | YES: M-04 training rule, re-measured lifts (Task 2) |
| scripts/scoreAwardModel.ts | builds scored profiles with both helpers | YES automatically through the helpers; adds M-09 view (Task 1) |
| scripts/publishDistricts.ts | publishes counts and bucket (~L1085 to L1240), bake skip (~L1507) | YES: M-07, M-08 (Task 3) |
| packages/core/districts/awardBaseRates.ts | the exclusion set export, base rate literals | YES: replaced by M-01 map, re-measured (Tasks 1, 2) |
| packages/core/districts/awardOrderingTables.ts | ordering and residual literals; header claims the Impact ordering IS measureAwardPredictability's compareDecoration | YES: re-measured; header corrected (Task 2) |
| packages/core/districts/dcmpAwardSlate.ts | lift literals keyed by published counts | YES: re-measured (Task 2) |
| packages/core/districts/ledgerSimulation.ts | reads profile counts, tables, fold | NO code change; prices from the new tables |
| packages/core/districts/dcmpAwardEligibility.ts | dcmpEntrantWeight "decoration" weighting reads awardBaseRate | NO: shipped champ tuning for 2023 to 2026 is "uniform"; the 2020 to 2022 rows that chose "decoration" fall to the function's own documented weight 1 once those tables are gone (reported as a follow up) |
| packages/core/districts/hypotheticalDcmp.ts | IMPACT_AWARD_POINTS and ROOKIE_ALL_STAR_AWARD_POINTS only | NO |
| packages/harness/pageArtifacts.ts | profile schema docs | YES: docs plus awardModelVersion (Task 3) |
| packages/harness/districtRankingsMerge.ts and apps/worker | read awardProfile.rookie only; the Worker bundle carries the tables as dead code via hypotheticalDcmp's two point constants | NO logic change; Worker deploy owed only because pageArtifacts.ts gains a field its write side parse would strip |
| apps/web districtLedgerRows.ts, districtLedgerOutcomes.ts, DistrictLedger.tsx, ChampLocksLedger.tsx, dcmpAwardInputs.ts | forward or read published profiles | NO code change |
| scripts/measureAwardPredictability.ts | its own all history feature (REFERENCE_ONLY_AWARD_TYPES {1, 2}) behind the awards page study figures | NO: a separate published study; its figures stay as published |
| scripts/measureChampCutoff.ts, measureDistrictCutoff.ts, measureLocksInRange.ts, champCutoffTuning.generated.ts | read published (local publish) artifacts | NO code change; their printed figures may move on a re-run after the republish (follow up, not this task) |
</caller_inventory>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Scorer acceptance harness, BEFORE snapshot, and the new definitions as pure additions</name>
  <precondition>`git diff --quiet HEAD -- scripts/scoreAwardModel.ts scripts/scoreAwardModel.test.ts packages/core/districts/awardBaseRates.ts packages/core/districts/awardBaseRates.test.ts scripts/measureDistrictAwardBaseRates.ts scripts/measureDistrictAwardBaseRates.test.ts` exits 0 and `data/corpus.sqlite` exists; otherwise return BLOCKED naming the dirty file.</precondition>
  <files>scripts/scoreAwardModel.ts, scripts/scoreAwardModel.test.ts, packages/core/districts/awardBaseRates.ts, packages/core/districts/awardBaseRates.test.ts, scripts/measureDistrictAwardBaseRates.ts, scripts/measureDistrictAwardBaseRates.test.ts, .planning/quick/261014-mii-district-award-odds-decoration-drift-sta/261014-mii-before-snapshot.json</files>
  <behavior>
    - DISTRICT_POINT_AWARD_VALUES equals the M-01 map exactly (equality on its sorted entries); types 1, 2, 3, 4, 5, 14, 68, 69 are absent.
    - highestSingleAwardPoints: {18, 27} gives 5; {0, 18} gives 10; {9, 18} gives 8; {10, 15} gives 8; {1, 2, 14} gives 0; empty gives 0; with Impact and Rookie All Star excluded, {0, 18} gives 5 and {10, 15} gives 5.
    - decorationWindow(2019) is [2016, 2017, 2018]; (2022) is [2018, 2019, 2020]; (2023) is [2019, 2020, 2022]; (2026) is [2023, 2024, 2025]; (2018) and (2016) are undefined; DISTRICT_REGISTERED_SEASONS is pinned by equality to 2016 to 2020 and 2022 to 2026 in the same test.
    - Corpus guarded (skips cleanly without data/corpus.sqlite): the district point award census reproduces every recorded district tier award_points from the M-01 values with 0 mismatches, each M-01 type appears as a sole award at a district tier event with exactly its value, and every non M-01 type seen at a district tier event pays 0 as a sole award.
    - Scorer: a snapshot written and read back round trips; the district gates pass and fail on hand built reports exactly at the A1, A2 (including the n mismatch FAIL) and A3 boundaries; legacyReviewClass reproduces the review rule on a fixture where the {1, 2, 14} set and the M-01 list disagree (a Dean's List win moves the legacy class, not the new one).
  </behavior>
  <action>
Implements M-01, M-03 helpers, M-06 helper, M-09 and the BEFORE half of the acceptance. Nothing in this task changes a shipped number: the new definitions are additions no shipped caller reads yet.

1. `packages/core/districts/awardBaseRates.ts` (keep it zero import, zero I/O): add `DISTRICT_POINT_AWARD_VALUES` as a ReadonlyMap of the M-01 types to their points, with a doc comment naming every type on each side of the line and the census that backs it (per M-01); add `DECORATION_LOOKBACK_SEASONS = 3` with the M-03 reasoning in its doc comment; add `highestSingleAwardPoints(awardTypes, excluded?)` returning the largest M-01 value among the given types not in `excluded`, 0 when none (per M-06). Do NOT remove the old exclusion set yet (Task 2 does).

2. `scripts/measureDistrictAwardBaseRates.ts`: add `decorationWindow(season)` returning the `DECORATION_LOOKBACK_SEASONS` latest entries of `DISTRICT_REGISTERED_SEASONS` strictly before `season`, or `undefined` when fewer exist (per M-03; 2021 is skipped because it is not in that list). Add a corpus read `districtPointAwardCensus(db)` that, for every district tier team event (entry's own `district_cmp` false) at an event with award rows, compares the summed M-01 values of the team's distinct award types against `award_points`, and tabulates sole award values per type. Print it from `main` as a DISTRICT POINT AWARD CENSUS block (mismatches, then per type sole award values with counts and season span).

3. `scripts/scoreAwardModel.ts`, report only additions (per M-09 and the acceptance block):
   - `LEGACY_REVIEW_EXCLUDED_TYPES` (frozen {1, 2, 14}) and `legacyReviewClass`, which counts distinct (year, event, type) prior wins over every earlier corpus season exactly as the shipped rule did on 4337d8d2, and labels with the existing `classLabel`. Doc comment: reporting only, reproduces the review's buckets so BEFORE and AFTER compare the same team events, never prices anything. Store it on each `ScoredTeamEvent` and accumulate a second class map per tier.
   - District Impact row audit: per tier sums of `odds.p10`, of `odds.impact`, and of real Impact wins; print as "Impact row: said X (Impact draw Y, folded stacks X minus Y), real Impact wins K".
   - Ten equal width reliability bins of the predicted any award chance (said mean, happened, n), printed per tier.
   - `--write-snapshot <path>` writes a JSON snapshot: label, timestamp, per tier n, said, happened, Brier, flat, digest (district), class map, review class map, reliability bins, Impact row sums, and the DCMP audits.
   - `--before <path>` reads a snapshot and evaluates A1, A2 and A3 as district gates beside the existing DCMP gates A4 and A5; in this mode the digest equality gate is replaced by printing "district digest BEFORE x, AFTER y". Without `--before`, behavior and gates are exactly as today. Every gate prints GATE PASS or GATE FAIL; any FAIL sets exit code 1.
   - Update the header comment to describe the new flags and the 261014-mii acceptance.

4. Tests per the behavior block in `awardBaseRates.test.ts`, `measureDistrictAwardBaseRates.test.ts` (census inside the existing corpus guarded pattern) and `scoreAwardModel.test.ts`.

5. BEFORE run, from the repo root: `npx tsx scripts/scoreAwardModel.ts --expect-district-digest 494ac134703547235b1a049ef9ff8e9983af3e508a6672accc605a5d48e45d65 --write-snapshot .planning/quick/261014-mii-district-award-odds-decoration-drift-sta/261014-mii-before-snapshot.json`, with the full printed output also saved to `261014-mii-before-score.txt` in the same directory. Confirm by reading the printed lines (never by exit code alone): all three existing gates PASS; district any award said 45.6, happened 42.5, Brier 0.2039, flat 0.2444, n 14,016; classes three or more 58.6 vs 57.8 (n=7982), one or two 27.6 vs 19.1 (n=3379), none 19.9 vs 11.9 (n=1720), none rookie 48.1 vs 52.8 (n=935); the review class map equals the class map exactly. If any of these differ, STOP and return BLOCKED with the output: the BEFORE baseline does not reproduce the review.

6. Commit (stage by explicit path only; check `git diff --cached --name-only` lists exactly this task's files plus the snapshot and the before score text) as `feat(quick-261014-mii): award scorer snapshot gates and the district point award definitions (M-01, M-03, M-06, M-09)`.
  </action>
  <verify>
    <automated>npx vitest run packages/core/districts/awardBaseRates.test.ts scripts/measureDistrictAwardBaseRates.test.ts scripts/scoreAwardModel.test.ts</automated>
    <automated>npx tsx scripts/scoreAwardModel.ts --expect-district-digest 494ac134703547235b1a049ef9ff8e9983af3e508a6672accc605a5d48e45d65 (three GATE PASS lines, DISTRICT TIER DIGEST unchanged)</automated>
  </verify>
  <done>The BEFORE snapshot is committed and reproduces the review numbers and digest exactly; the census prints 0 mismatches; the scorer can evaluate A1 to A5 against a snapshot; no shipped number moved.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Switch every counting caller to the new definition, re-measure all award tables, and run the pre-registered AFTER acceptance</name>
  <precondition>Task 1 is committed and its snapshot file exists; `git diff --quiet HEAD -- packages/core/districts/awardBaseRates.ts packages/core/districts/awardBaseRates.test.ts packages/core/districts/awardOrderingTables.ts packages/core/districts/awardOrderingTables.test.ts packages/core/districts/dcmpAwardSlate.ts packages/core/districts/dcmpAwardSlate.test.ts scripts/measureDistrictAwardBaseRates.ts scripts/measureDistrictAwardBaseRates.test.ts scripts/measureAwardOrderingTables.ts scripts/measureAwardOrderingTables.test.ts scripts/measureDcmpAwardSlate.ts scripts/measureDcmpAwardSlate.test.ts scripts/publishDistricts.test.ts` exits 0; otherwise return BLOCKED naming the dirty file. `packages/core/districts/ledgerSimulation.ts` and its test were being edited by another session (quick 261014-mji) when this plan was written: never edit or stage them while `git diff --quiet HEAD -- packages/core/districts/ledgerSimulation.test.ts` fails; if the switch breaks a test there while it is dirty, return BLOCKED naming it.</precondition>
  <files>packages/core/districts/awardBaseRates.ts, packages/core/districts/awardBaseRates.test.ts, packages/core/districts/awardOrderingTables.ts, packages/core/districts/awardOrderingTables.test.ts, packages/core/districts/dcmpAwardSlate.ts, packages/core/districts/dcmpAwardSlate.test.ts, packages/core/districts/ledgerSimulation.test.ts, scripts/measureDistrictAwardBaseRates.ts, scripts/measureDistrictAwardBaseRates.test.ts, scripts/measureAwardOrderingTables.ts, scripts/measureAwardOrderingTables.test.ts, scripts/measureDcmpAwardSlate.ts, scripts/measureDcmpAwardSlate.test.ts, scripts/publishDistricts.test.ts, .planning/quick/261014-mii-district-award-odds-decoration-drift-sta/261014-mii-after-snapshot.json</files>
  <behavior>
    - priorJudgedAwardCount(instances, team, Y) counts only M-01 types won in decorationWindow(Y): a Quality win three award seasons back counts, four back does not, a 2019 win counts for 2023 (2021 skipped), a Dean's List, Woodie Flowers, Volunteer, Wildcard or Impact Finalist win never counts, a Safety win counts; it throws a named IncompleteDecorationWindowError for 2016, 2017 and 2018.
    - priorImpactWinCount uses the same window and the same refusal.
    - Base rate outcome is the highest single award: a team event with Safety plus Imagery measures 5, with Impact plus Safety measures 10; a team event whose summed M-01 values differ from award_points is censused, never counted silently.
    - Ordering residual: Safety plus Imagery measures 5, EI plus Safety measures 8, Impact plus Safety measures 5.
    - Leak half one and half two tests keep passing on fixtures moved inside complete windows; a new fixture proves a 2018 outcome never enters any table.
    - Every committed base rate pmf, at every rung and season, has exactly 0 at the 13 and 15+ bins; every committed residual pmf has exactly 0 at the 10, 13 and 15+ bins (replaces the old 0.022 fold cost test; foldStackedAwardPmf moves no mass on any committed rate).
    - DISTRICT_AWARD_BASE_RATE_SEASONS and AWARD_ORDERING_SEASONS both equal [2023, 2024, 2025, 2026] by equality.
  </behavior>
  <action>
Implements M-01 to M-06 in every measuring caller, then re-measures, then judges the result against the pre-registered acceptance. Commit NOTHING from this task until the AFTER run passes.

1. Helpers. In `scripts/measureDistrictAwardBaseRates.ts`, make `priorJudgedAwardCount` count distinct (year, event, type) wins whose type is in `DISTRICT_POINT_AWARD_VALUES` and whose year is in `decorationWindow(season)` (per M-01, M-02, M-03); add and throw `IncompleteDecorationWindowError` when the window is undefined. In `scripts/measureAwardOrderingTables.ts`, window `priorAwardTypeCount` and therefore `priorImpactWinCount` the same way (per M-05). Delete the {1, 2, 14} exclusion set export from `awardBaseRates.ts` and replace every use: `indexSeasonAwards` keeps M-01 types only. Rewrite every doc comment that described "judged awards from seasons strictly before" to describe the M-01 list and the M-03 window.

2. Base rates (per M-04, M-06): fit the table for season Y only on team events of prior seasons with a complete window; register on the unchanged bar counted in those seasons; the reported prior seasons are those training seasons. The measured outcome becomes `highestSingleAwardPoints` of the team's distinct award types at that event, read from the outcome season's own award rows (a label, not a feature, so it cannot leak into Y); print the M-06 cross check and the no award rows census.

3. Ordering and residual (per M-04, M-06): build fields only for seasons with a complete window; the residual becomes the highest single M-01 award excluding Impact and Rookie All Star; keep the AWARD POINT VALUES census on `award_points`. Correct the header of `awardOrderingTables.ts`: the shipped Impact ordering sorts on windowed counts of point paying awards, while `measureAwardPredictability.ts` keeps its own all history study feature; also restate the fold section (measured tables carry no stacked mass; the fold now guards composed draws only).

4. DCMP slate (per M-04): lift observations come only from championships whose season has a complete window; anchors and the 2016 on census unchanged; profiles for earlier championships carry no counts rather than throwing.

5. Re-measure, from the repo root, saving each full printed output into the quick directory: `npx tsx scripts/measureDistrictAwardBaseRates.ts` (and `--json`), `npx tsx scripts/measureAwardOrderingTables.ts` (and `--json`), `npx tsx scripts/measureDcmpAwardSlate.ts`. Rewrite the literal blocks in `awardBaseRates.ts`, `awardOrderingTables.ts` and `dcmpAwardSlate.ts` PROGRAMMATICALLY from that output (a throwaway transform script kept outside the repo, as 260929-imp did), never by hand; update each MEASURED_DATE and each header's "run on" line. Each script must print 0 cross check mismatches.

6. Tests: update the corpus guarded reproduce tests and every unit test the switch breaks, per the behavior block. Tests that iterate registered seasons must pin the list by equality. A test elsewhere that pins a seeded value derived from the award tables may be re-pinned only after confirming it is green at HEAD and red only because of this task's tables; list each one old to new. If a test that does not depend on award tables goes red, STOP and report.

7. AFTER acceptance: `npx tsx scripts/scoreAwardModel.ts --before .planning/quick/261014-mii-district-award-odds-decoration-drift-sta/261014-mii-before-snapshot.json --write-snapshot .planning/quick/261014-mii-district-award-odds-decoration-drift-sta/261014-mii-after-snapshot.json`, output saved to `261014-mii-after-score.txt`. Read every GATE line.
   - All of A1 to A5 PASS: commit by explicit path (check `git diff --cached --name-only` first) as `feat(quick-261014-mii): windowed point award decorations and highest single award tables, re-measured (M-01 to M-06)`, including the after snapshot and the saved measurement and score outputs.
   - Any FAIL: follow the FAILURE PROTOCOL in the acceptance block. Write `git diff` to a patch file in your scratchpad outside the repo, copy both score outputs there, confirm with `git status` that only this task's files are modified, restore exactly those paths with `git checkout --`, commit nothing, and return BLOCKED with both full outputs and the patch path. Do not retry with any other window, list or fold.
  </action>
  <verify>
    <automated>npx vitest run packages/core/districts/awardBaseRates.test.ts packages/core/districts/awardOrderingTables.test.ts packages/core/districts/dcmpAwardSlate.test.ts packages/core/districts/ledgerSimulation.test.ts scripts/measureDistrictAwardBaseRates.test.ts scripts/measureAwardOrderingTables.test.ts scripts/measureDcmpAwardSlate.test.ts scripts/scoreAwardModel.test.ts scripts/publishDistricts.test.ts</automated>
    <automated>test "$(grep -rn "NON_JUDGED_AWARD_TYPES" packages scripts apps --include=*.ts --include=*.tsx | wc -l)" -eq 0</automated>
    <automated>npx tsx scripts/scoreAwardModel.ts --before .planning/quick/261014-mii-district-award-odds-decoration-drift-sta/261014-mii-before-snapshot.json (every GATE line PASS)</automated>
  </verify>
  <done>Either (PASS) every counting caller uses one definition, the three table modules are re-measured from committed script output with 0 cross check mismatches, A1 to A5 pass, and the after snapshot with its digest is committed; or (FAIL) nothing is committed, the tree is restored, and both outputs and the patch path are returned.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Publisher profiles and the award model version stamp, methodology copy from the AFTER run, full verification</name>
  <precondition>Task 2 committed on a PASS; `git diff --quiet HEAD -- scripts/publishDistricts.ts scripts/publishDistricts.test.ts packages/harness/pageArtifacts.ts packages/harness/pageArtifacts.test.ts packages/core/districts/awardBaseRates.ts` exits 0, else BLOCKED. For each copy file (`apps/web/src/components/methodology/districtLedgerContent.ts`, `awardsContent.ts` and their tests) run the same check; a dirty copy file is SKIPPED (not edited) and reported as owed, while the rest of the task proceeds.</precondition>
  <files>scripts/publishDistricts.ts, scripts/publishDistricts.test.ts, packages/harness/pageArtifacts.ts, packages/harness/pageArtifacts.test.ts, packages/core/districts/awardBaseRates.ts, packages/core/districts/awardModelVersion.test.ts, apps/web/src/components/methodology/districtLedgerContent.ts, apps/web/src/components/methodology/districtLedgerContent.test.ts, apps/web/src/components/methodology/awardsContent.ts, apps/web/src/components/methodology/awardsContent.test.ts</files>
  <behavior>
    - buildSeasonAwardContext for 2020 and 2022 returns profiles (rookie flag, windowed counts, bucket) and no award blocks; for 2023 and 2026 profiles and both blocks; for 2018 neither; a season whose window has a season with zero ingested award rows returns no profiles and logs why.
    - A composed district artifact carries awardModelVersion equal to DISTRICT_AWARD_MODEL_VERSION exactly when it carries any awardProfile; DistrictArtifactSchema accepts an artifact without the field.
    - The bake still skips every season without registered base rates (pre 2023), so no new sidecar appears for 2019 to 2022.
    - awardModelVersion.test.ts: a sha256 over the M-01 map, DECORATION_LOOKBACK_SEASONS, every registered base rate table, every ordering table and DCMP_AWARD_SLATE_TABLES, serialized in a fixed order, equals the digest pinned beside version "2.0.0".
    - Content tests: every exported string passes the voice gate (no hyphen, en dash or em dash), structure pinned by equality, and every quoted figure matches the AFTER outputs.
  </behavior>
  <action>
Implements M-07 and M-08, then brings the methodology copy to what ships.

1. Publisher (per M-07): in `buildSeasonAwardContext` publish profiles when the season's window is complete and every window season has award rows ingested, independent of table registration; keep award blocks for registered seasons only; keep the bake skip keyed on base rates. Update the comment that says a season without a table publishes no profile.

2. Version (per M-08): add `DISTRICT_AWARD_MODEL_VERSION = "2.0.0"` to `awardBaseRates.ts` with a doc comment (an artifact without the stamp carries the model before quick task 261014-mii; bump it with every change to any award table or definition). Add optional `awardModelVersion: z.string().min(1)` at the top level of `DistrictArtifactSchema`, and rewrite the `priorJudgedAwards` and `priorImpactWins` schema docs to the M-01 and M-03 definition (the wire names stay; renaming would break the published reader). The publisher writes the stamp whenever it writes a profile. Create `packages/core/districts/awardModelVersion.test.ts` per the behavior block; pin the digest from the test's own first printed value and say in its comment that a table change must bump the version and re-pin both together.

3. Dry run, offline, from the repo root, WITHOUT any env file (never read or print .env): `npx tsx scripts/publishDistricts.ts --years 2020,2023,2026 --dry-run --no-bake`. Confirm from the printed lines: 2020 publishes profiles and no award block; 2023 and 2026 print the award census measured through 2022 and 2025; every composed artifact validates. Do not pass `--local-out` (other sessions read `data/local-publish`).

4. Methodology copy (only for files that passed the precondition). Voice: flat third person, very plain short sentences, zero hyphen or dash characters. Every figure from the saved AFTER outputs of Task 2, none from this plan or the review.
   - `districtLedgerContent.ts`: the Awards row of the categories table (~L205) says the points come from the team awards a team wins at the event (Impact 10, Engineering Inspiration and Rookie All Star 8, other team awards 5) and that a district event is priced from measured rates and a District Championship from earlier championships; the Awards row of "What decides each open category" (~L259) says a district event draws from the team's count of point paying team awards in the three seasons before, its rookie status and its place in the event's Impact order, and a District Championship from earlier championships; in the award base rates section (~L287 to L293) restate the Impact and Rookie All Star figures from the AFTER ordering output, replace the 0.022 fold sentence with the M-06 rule in plain words (a team's outcome is its single highest award, so two 5 point awards count as one 5 point award and never as Impact), and say what a team with no published profile is priced as; in the limits table drop or correct the row claiming the district table is applied at the district championship (false since 261014-i8i) and the "judged awards only" wording.
   - `awardsContent.ts` district section (~L195 to L225) and its header comment: the seasons that carry a table (2023 to 2026) and why earlier ones do not (M-03, M-04); what counts toward a team's award record (M-01, naming Dean's List, Woodie Flowers, Volunteer of the Year, Wildcard and Impact Finalist as not counted) and the three season window with 2021 skipped; the AFTER Impact and Rookie All Star figures and event count; the 2026 table caption (fit on 2019 to 2025) and rows from the AFTER base rate output, with the distribution columns reduced to the 5, 8 and 10 point outcomes since the 13 and 15 or more bins are empty by construction. Leave the study sections (the goal, the model, our results) untouched.
   - Update both content tests.

5. Full verification from the repo root: `npx vitest run` once over the whole suite (read the summary lines; a corpus guarded file that times out under load is re-run alone and reported; a failure in a file another session holds uncommitted edits to, per `git status`, is reported with its path, never fixed), then `npx tsc --noEmit`, `npx tsc --noEmit -p apps/web/tsconfig.json`, `npx tsc --noEmit -p apps/web/tsconfig.e2e.json` and `npx tsc --noEmit -p apps/worker/tsconfig.json`. Confirm nothing in this task imports from or edits `packages/core/districts/locks.ts`.

6. Commit by explicit path (check `git diff --cached --name-only`) as `feat(quick-261014-mii): award model version stamp, profiles for every complete window season, and methodology copy from the AFTER run (M-07, M-08)`; copy files may go in their own `docs(quick-261014-mii): ...` commit.

7. Return the SUMMARY text (do not write SUMMARY.md): commits; the census and the exact list on each side of M-01; BEFORE and AFTER tables for the any award line, both class views, reliability bins, the Impact row (said, Impact draw, folded stacks, real wins) and both digests; every re-pinned test old to new; skipped copy files; and the OWED block below, verbatim with values filled in.

OWED to the main context, in this order (executors have no network and run none of these):
   a. Worker deploy, because `packages/harness/pageArtifacts.ts` gained `awardModelVersion` and the Worker's write side parse strips unknown keys: from `apps/worker`, `npx wrangler deploy` on a clean tree at the final SHA (Jacob grants it in message). The Worker builds no award profile and prices nothing from the award tables, so this deploy changes no Worker behavior.
   b. `pnpm publish:districts` (2016 to 2020 and 2022 to 2026), so every artifact carries the windowed counts and the 2.0.0 stamp. Offseason now, so no district is live; the live districts guard still applies.
   c. Push main right after (b) (check origin/main..main first): Pages ships the new tables in the web bundle. Between (b) and the Pages deploy, the live site pairs the old bundled tables with new counts; offseason, this only affects rewound 2023 to 2026 views for those minutes.
   d. No R2 prune: the district keys are unversioned and overwritten in place, so nothing is superseded.
   e. Verify: a published 2026 district file carries awardModelVersion 2.0.0 and windowed counts; open a rewound 2026 District Locks view (browser or Origin header, per the Pages caching memory); rerun the live e2e specs since the methodology copy changed; the standing check becomes `pnpm score:award-model -- --expect-district-digest <AFTER digest>`.
   f. Follow ups: `npx tsx scripts/measureChampCutoff.ts --check-history` will report drift in the 2020 to 2022 tuning rows (their decoration weighting now falls to weight 1); the cutoff figures in districtLedgerContent.ts (1.2 vs 2.4 over 205 positions, 183 of 205; 17.8 vs 40.5 over 69 seasons, 49 of 69) were measured under the old award model and may move once the cutoff backtests run on republished artifacts; all award tables and the DCMP slate need a re-measure before the first 2027 event.
  </action>
  <verify>
    <automated>npx vitest run scripts/publishDistricts.test.ts packages/harness/pageArtifacts.test.ts packages/core/districts/awardModelVersion.test.ts apps/web/src/components/methodology/districtLedgerContent.test.ts apps/web/src/components/methodology/awardsContent.test.ts</automated>
    <automated>npx vitest run (full repo root suite, summary lines read)</automated>
    <automated>npx tsc --noEmit and npx tsc --noEmit -p apps/web/tsconfig.json and npx tsc --noEmit -p apps/web/tsconfig.e2e.json and npx tsc --noEmit -p apps/worker/tsconfig.json</automated>
  </verify>
  <done>Artifacts compose with windowed profiles for 2019 on and the 2.0.0 stamp; the version digest test pins every award table; both methodology pages state what ships with AFTER figures (or are reported as owed); the full suite and all four typechecks are clean; the summary text and the OWED block are returned.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| corpus to committed literals | measured numbers become shipped table literals |
| committed tables (web bundle) to published counts (R2 artifact) | the browser pairs bundled tables with published per team counts |
| shared checkout | other Claude sessions may edit or stage files concurrently |
| local credentials | .env holds live TBA and R2 secrets |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-mii-01 | Tampering | table literals in awardBaseRates.ts, awardOrderingTables.ts, dcmpAwardSlate.ts | high | mitigate | literals written programmatically from committed script output; corpus guarded reproduce tests assert every n exactly and every rate within tolerance; M-06 cross check prints 0 mismatches |
| T-mii-02 | Repudiation | published district artifacts | medium | mitigate | awardModelVersion 2.0.0 stamp plus awardModelVersion.test.ts digest pin, so a table change without a version bump fails |
| T-mii-03 | Tampering | acceptance | high | mitigate | definitions and A1 to A5 fixed in this plan before any scoring; FAILURE PROTOCOL forbids retuning against 2023 to 2026 and commits nothing on a FAIL |
| T-mii-04 | Tampering | bundle to artifact pairing during release | low | accept | release order Worker, republish, push keeps the mismatch to the Pages deploy minutes; offseason, only rewound views are priced; a web pairing guard was weighed and not added because it only protects the opposite order |
| T-mii-05 | Information disclosure | .env | high | mitigate | no task reads, prints or interpolates .env; the publisher dry run runs without an env file; no network commands in any task |
| T-mii-06 | Tampering | concurrent sessions | medium | mitigate | git diff precondition per task, staging by explicit path, `git diff --cached --name-only` before each commit, restore only this task's paths on a FAIL |
| T-mii-07 | Elevation of privilege | locks.ts verdicts | high | mitigate | no task edits or imports locks.ts; existing source tests that pin award modules away from locks.ts keep passing |
</threat_model>

<verification>
- Task 1: BEFORE snapshot reproduces the review (0.2039, four classes, digest 494ac134...65); census 0 mismatches.
- Task 2: AFTER run prints GATE PASS for A1 to A5; tables registered 2023 to 2026; no committed pmf carries stacked mass; zero references to the old exclusion set in code.
- Task 3: dry run composes 2020, 2023, 2026 as specified; full repo root suite green by summary lines; root, web, e2e and Worker typechecks clean.
</verification>

<success_criteria>
- Decoration is one pre-registered definition (M-01 to M-05) used by every measuring and publishing caller, with no silent partial migration.
- District any award Brier below BEFORE and every review class gap smaller, DCMP gates still passing, or nothing shipped changed and both outputs are reported.
- The drawer's Impact row equals the Impact draw: no 5 plus 5 stack is ever priced as Impact.
- The published artifact names the award model that produced it, and the main context has an exact owed list.
</success_criteria>

<output>
The executor returns the SUMMARY text; the orchestrator writes `.planning/quick/261014-mii-district-award-odds-decoration-drift-sta/261014-mii-SUMMARY.md`.
</output>
